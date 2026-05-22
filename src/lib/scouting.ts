/**
 * Weekly Scouting Report — SZN-mode worldbuilding system.
 *
 * The Monday scouting report shown at the start of every week. The
 * previous iteration framed each slot as a paragraph of flavor text;
 * that read like a wall of copy at the start of every week. This
 * version keeps the three thematic slots (world / ability / player)
 * but produces SHORT one-line headlines plus structured entity hooks
 * so the renderer can pair each line with a real visual:
 *
 *   - world   → team-mark badge for the franchise the headline is
 *               about (or a league-wide stand-in when nobody is
 *               named)
 *   - ability → an actual ability-card preview for the card on the
 *               wire this week (falls back to a tinted edge chip when
 *               no live data is on offer)
 *   - player  → a player chip for the rumored free agent / trade
 *               target
 *
 * Design goals
 * ------------
 *   1. Every report ALWAYS has the same set of slots (the renderer
 *      doesn't have to special-case missing data). The
 *      `WeeklyScoutingReport` interface enforces this at the type
 *      level: every slot is required.
 *   2. Every slot carries BOTH a punchy headline (≤ 8 words) and a
 *      mood tag (≤ 2 words) so the renderer can paint a big visual
 *      with a tiny caption instead of a paragraph.
 *   3. Adding a new slot is a one-file change. The `SCOUT_SLOTS`
 *      registry exports the canonical slot list + presentation
 *      metadata; the renderer iterates the registry and switches on
 *      `kind` for the slot-specific hero visual.
 *
 * Wiring
 * ------
 *   - `gameStore.openStarterPack` and the rollover branch of
 *     `gameStore.reportSeriesGameResult` are the only places that
 *     mint a fresh report. Both call `rollWeeklyScout(run)`.
 *   - The `MondayScoutingReport` ("Dugout News") renderer that used
 *     to live in `FrontOfficeScreen` was retired -- there is no
 *     active consumer of this data in the UI right now. The data
 *     layer is kept intact (cheap to compute, deterministic) so a
 *     future Dugout News revival doesn't have to rebuild it. If you
 *     need a renderer, iterate `SCOUT_SLOTS` and dispatch on `kind`
 *     to a per-slot hero visual (see the deleted `ScoutSlotHero`
 *     in `FrontOfficeScreen` for the prior reference implementation).
 */

import type { RunState, EncounterOffer } from "./run";
import { MLB_TEAMS, type MlbTeamId } from "./sznTeams";
import { ALL_SZN_PLAYERS } from "./sznPlayers";
import { sessionCardById } from "./cards";
import { SZN_EDGES, type SznEdgeId } from "./sznEdges";

/* ---------------------------------------------------------------------------
 * Public types
 * --------------------------------------------------------------------------- */

/**
 * "Around the league" slot — atmosphere about the league or the
 * user's chosen franchise. The headline is the one line the renderer
 * paints; `tag` is the small mood chip (e.g. "TRADE WINDS"); `teamId`
 * is the franchise the headline centers on so the renderer can paint
 * the team mark next to it (null = league-wide).
 */
export interface ScoutingWorld {
  headline: string;
  tag: string;
  teamId: MlbTeamId | null;
}

/**
 * "Whispers from the wire" slot — foreshadow about an ability/edge
 * the user may see this week. `cardId` is the live-data hook: when
 * set the renderer paints the actual `ItemCardPreview`. When the
 * generator could only tease an edge family (no live card on offer)
 * it sets `edgeId` instead and the renderer falls back to a tinted
 * edge chip.
 */
export interface ScoutingAbility {
  headline: string;
  tag: string;
  cardId: string | null;
  edgeId: SznEdgeId | null;
}

/**
 * "Trade block buzz" slot — rumor about a player who might surface
 * on the free-agent wire this week. `playerId` is the live-data
 * hook for the rendered chip; null only in the degenerate case where
 * every SZN player is already on the user's roster.
 */
export interface ScoutingPlayer {
  headline: string;
  tag: string;
  playerId: string | null;
}

/**
 * One Monday scouting report. Every slot is REQUIRED so the renderer
 * never has to render a conditional empty state.
 */
export interface WeeklyScoutingReport {
  world: ScoutingWorld;
  ability: ScoutingAbility;
  player: ScoutingPlayer;
}

/* ---------------------------------------------------------------------------
 * Slot registry — the typed contract that drives rendering
 * --------------------------------------------------------------------------- */

/**
 * Discriminator on each slot definition; the renderer switches on
 * `kind` to pick the hero visual (team badge / ability card / player
 * chip).
 */
export type ScoutSlotKind = "world" | "ability" | "player";

export interface ScoutSlotDef {
  kind: ScoutSlotKind;
  /** Pill label in the renderer (e.g. "Around the League"). */
  label: string;
  /** Emoji glyph -- intentionally text so the UI doesn't pull an icon lib. */
  glyph: string;
  /** Tailwind-friendly hex tint used for the slot's pill + border. */
  tint: string;
}

/**
 * Canonical slot list. Order in this array IS the render order. Each
 * `kind` value must round-trip to the matching field on
 * {@link WeeklyScoutingReport}.
 */
export const SCOUT_SLOTS: readonly ScoutSlotDef[] = [
  { kind: "world", label: "Around the League", glyph: "📰", tint: "#22d3ee" },
  { kind: "ability", label: "Whispers from the Wire", glyph: "📡", tint: "#f59e0b" },
  { kind: "player", label: "Trade Block Buzz", glyph: "💬", tint: "#ef4444" },
];

/* ---------------------------------------------------------------------------
 * Roll entry point
 * --------------------------------------------------------------------------- */

/**
 * Mint a fresh report for the run's CURRENT week + encounters.
 * Callers should invoke this AFTER the new week's `weekEncounters`
 * have been seeded onto the run so the ability + player generators
 * can foreshadow real upcoming content.
 *
 * Always returns a fully-populated report -- every slot's generator
 * falls back to a curated headline if no live data is available.
 */
export function rollWeeklyScout(run: RunState): WeeklyScoutingReport {
  return {
    world: pickWorld(run),
    ability: pickAbility(run),
    player: pickPlayer(run),
  };
}

/* ---------------------------------------------------------------------------
 * Slot generators
 * ---------------------------------------------------------------------------
 *
 * Each generator follows the same shape:
 *   1. Try to source a "live" hook from the run (upcoming encounters,
 *      selected team, etc.).
 *   2. If found, write a templated headline that names the hook.
 *   3. Otherwise, sample from a curated fallback pool.
 *
 * Generators NEVER throw. Headlines are deliberately short (≤ 8
 * words) so the renderer can paint them at a big size without
 * wrapping into a paragraph.
 */

/* -- world ----------------------------------------------------------------- */

type WeekPhase = "early" | "middle" | "late";
function weekPhase(week: number): WeekPhase {
  if (week <= 4) return "early";
  if (week <= 8) return "middle";
  return "late";
}

// Each league-wide entry is a tag + short headline. The tag is the
// small chip the renderer paints above the headline; the headline is
// the big line. teamId stays null because these are league-wide.
const WORLD_LEAGUE_POOL: Record<WeekPhase, { tag: string; headline: string }[]> = {
  early: [
    { tag: "Opening Notes", headline: "Every clubhouse selling 'this is our year'." },
    { tag: "Health Watch", headline: "Beat writers: nobody is healthy yet." },
    { tag: "Analytics Era", headline: "Front offices hoarded analysts all winter." },
    { tag: "Camp Notes", headline: "Bullpen catchers already overworked." },
    { tag: "Equipment", headline: "Helmets reportedly hand-painted overnight." },
  ],
  middle: [
    { tag: "Trade Winds", headline: "Three GMs working the phones late." },
    { tag: "Hot Stove", headline: "Half the rumors are fake. Others worse." },
    { tag: "Injury Bug", headline: "League-wide IL ticked up this week." },
    { tag: "All-Star Push", headline: "Role players quietly campaigning hard." },
    { tag: "Awards Buzz", headline: "Metrics crowd is subtweeting MVP voters." },
  ],
  late: [
    { tag: "Stretch Run", headline: "Contenders pressing, pretenders planning ahead." },
    { tag: "Seeding Math", headline: "Tiebreaker scenarios leaked from the league." },
    { tag: "Call-Ups", headline: "New September faces show up cheap." },
    { tag: "Wild Card", headline: "Races tightening. Moving boxes appearing." },
    { tag: "Audition Time", headline: "Bad teams auditioning every minor leaguer." },
  ],
};

// Per-franchise flavor pool (sampled when the user picked a real
// team). Returns a headline + the team's id so the renderer can
// paint the team mark beside the line.
function teamFlavorLine(run: RunState): { tag: string; headline: string; teamId: MlbTeamId } | null {
  const team = run.selectedTeamId ? MLB_TEAMS[run.selectedTeamId] : null;
  if (!team) return null;
  const div = team.division;
  const pool: { tag: string; headline: string }[] = [
    { tag: "Clubhouse Mood", headline: `${team.shortName} clubhouse "fine, actually."` },
    { tag: "Division Race", headline: `${team.shortName} in the ${div} mix.` },
    { tag: "Front Office", headline: `${team.shortName} ownership "monitoring the situation."` },
    { tag: "Pundit Pick", headline: `${team.shortName} are the team to watch.` },
    { tag: "Beat Notes", headline: `Writers covering the ${team.shortName} look bored.` },
  ];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return pick ? { tag: pick.tag, headline: pick.headline, teamId: team.id } : null;
}

function pickWorld(run: RunState): ScoutingWorld {
  // 55% of the time pull a franchise-flavored line so the world
  // feels tethered to the user's team identity. (Bumped from 35%
  // now that the renderer leans on the team mark for the hero
  // visual -- a generic "league-wide" slot draws a less interesting
  // hero, so we'd rather lead with the franchise-themed line.)
  if (Math.random() < 0.55) {
    const flav = teamFlavorLine(run);
    if (flav) {
      return { tag: flav.tag, headline: flav.headline, teamId: flav.teamId };
    }
  }
  const pool = WORLD_LEAGUE_POOL[weekPhase(run.week)];
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? pool[0]!;
  return { tag: pick.tag, headline: pick.headline, teamId: null };
}

/* -- ability --------------------------------------------------------------- */

/**
 * Pull every ability card on offer this week (merchant listings +
 * event-reward grants) so the ability hint can foreshadow REAL
 * upcoming content. Caller may receive an empty list, in which case
 * the ability generator falls back to a generic edge teaser.
 */
function collectUpcomingCardIds(run: RunState): string[] {
  const ids: string[] = [];
  for (const day of run.weekEncounters) {
    for (const offer of day.offers as EncounterOffer[]) {
      if (offer.kind === "merchant") {
        for (const l of offer.listings) ids.push(l.cardId);
      } else if (offer.kind === "event") {
        for (const c of offer.choices) {
          const eff = c.effect;
          if (eff && (eff as { kind?: string }).kind === "grantItem") {
            const cardId = (eff as { cardId?: string }).cardId;
            if (cardId) ids.push(cardId);
          }
        }
      }
    }
  }
  return Array.from(new Set(ids));
}

// Tag pool for the ability slot. Used regardless of whether we hit
// the live-data path (card id) or the fallback (edge id) so the chip
// always carries some flavor without echoing the headline verbatim.
const ABILITY_TAG_POOL = [
  "Hot Commodity",
  "On the Wire",
  "Equipment Rumor",
  "Backroom Buzz",
  "Hobby Shop Buzz",
];

function pickAbility(run: RunState): ScoutingAbility {
  const ids = collectUpcomingCardIds(run);
  const tag = ABILITY_TAG_POOL[Math.floor(Math.random() * ABILITY_TAG_POOL.length)]!;
  // Live-data path: pick a card actually on offer this week.
  if (ids.length > 0) {
    const id = ids[Math.floor(Math.random() * ids.length)]!;
    const card = sessionCardById(id);
    if (card) {
      const headlineVariants = [
        `"${card.name}" surfacing this week.`,
        `Scouts swear ${card.name} is on the move.`,
        `Word is moving on ${card.name}.`,
        `${card.name} expected on the wire.`,
        `Hobby shops stocking ${card.name}.`,
      ];
      const headline =
        headlineVariants[Math.floor(Math.random() * headlineVariants.length)]!;
      return { tag, headline, cardId: id, edgeId: null };
    }
  }
  // Fallback: tease an edge family by name. Headline references the
  // edge label so the chip in the renderer carries the same name.
  const edgePool: SznEdgeId[] = [
    "power",
    "speed",
    "contact",
    "patience",
    "velocity",
    "movement",
    "control",
    "deception",
    "battery",
    "city-connect",
    "fastball-102",
  ];
  const eid = edgePool[Math.floor(Math.random() * edgePool.length)]!;
  const meta = SZN_EDGES[eid];
  return {
    tag,
    headline: `${meta.label} edges moving through the league.`,
    cardId: null,
    edgeId: eid,
  };
}

/* -- player ---------------------------------------------------------------- */

// Tag pool for the player slot. Same rationale as ABILITY_TAG_POOL.
const PLAYER_TAG_POOL = [
  "Wants Out",
  "Trade Target",
  "Testing Market",
  "Clubhouse Leak",
  "Agent Bar Buzz",
];

function pickPlayer(run: RunState): ScoutingPlayer {
  const rosterIds = new Set(run.roster.map((r) => r.player.id));
  const marketIds: string[] = [];
  for (const day of run.weekEncounters) {
    for (const offer of day.offers as EncounterOffer[]) {
      if (offer.kind === "playerMarket") {
        for (const l of offer.listings) marketIds.push(l.playerId);
      }
    }
  }
  const primary = marketIds
    .map((id) => ALL_SZN_PLAYERS.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p && !rosterIds.has(p.id));
  const pool =
    primary.length > 0
      ? primary
      : ALL_SZN_PLAYERS.filter((p) => !rosterIds.has(p.id));
  const tag = PLAYER_TAG_POOL[Math.floor(Math.random() * PLAYER_TAG_POOL.length)]!;
  if (pool.length === 0) {
    // Defensive: every SZN player is on the roster (impossible at
    // STARTER_PACK_TOTAL=10, but typed-safe). Generic rumor instead.
    return {
      tag: "Agent Bar Buzz",
      headline: "Somebody big is unhappy with their deal.",
      playerId: null,
    };
  }
  const p = pool[Math.floor(Math.random() * pool.length)]!;
  const team = MLB_TEAMS[p.teamId];
  const teamName = team?.shortName ?? p.teamId;
  const headlineVariants = [
    `${p.name} testing the market.`,
    `${teamName} taking calls on ${p.name}.`,
    `${p.name} reportedly wants out of ${teamName}.`,
    `${p.name} cleared his locker. Twice.`,
    `Scouts caught ${p.name} eating alone.`,
  ];
  const headline =
    headlineVariants[Math.floor(Math.random() * headlineVariants.length)]!;
  return { tag, headline, playerId: p.id };
}
