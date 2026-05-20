/**
 * Weekly Scouting Report — SZN-mode worldbuilding system.
 *
 * This module owns the Monday scouting report shown at the start of
 * every week. The legacy implementation framed the report as a
 * "weekend series intel" preview of the upcoming ghost opponent;
 * that framing no longer fits the game's loop. Scouting is now a
 * window into the *world* the run lives in: league atmosphere,
 * hints about ability cards that might surface, and rumors about
 * players who could be on the move.
 *
 * Design goals
 * ------------
 *   1. Every report ALWAYS has the same set of slots (the renderer
 *      doesn't have to special-case missing data). The
 *      `WeeklyScoutingReport` interface enforces this at the type
 *      level: every key is required.
 *   2. Adding a new slot is a one-file change. The
 *      `SCOUT_SLOTS` registry exports the canonical slot list +
 *      presentation metadata (label, glyph, tint). Renderers iterate
 *      this registry instead of hand-listing slots, so the moment a
 *      new slot is added to the interface, TypeScript forces the
 *      registry update and the renderer immediately shows it.
 *   3. Each slot has its own generator that ALWAYS returns a
 *      non-empty string. Generators try to pull from actual upcoming
 *      content (this week's encounters, players in the free agency
 *      slate, edges showing up in merchant listings) so the report
 *      foreshadows the real run; if no live data hooks up, a
 *      curated fallback pool keeps the report flavorful.
 *
 * Wiring
 * ------
 *   - `gameStore.openStarterPack` and the rollover branch of
 *     `gameStore.reportSeriesGameResult` are the only places that
 *     mint a fresh report. Both call `rollWeeklyScout(run)`.
 *   - `FrontOfficeScreen.MondayScoutingReport` is the only renderer.
 *     It iterates `SCOUT_SLOTS` so every slot is guaranteed to show.
 */

import type { RunState, EncounterOffer } from "./run";
import { MLB_TEAMS } from "./sznTeams";
import { ALL_SZN_PLAYERS } from "./sznPlayers";
import { sessionCardById } from "./cards";
import { SZN_EDGES, type SznEdgeId } from "./sznEdges";

/* ---------------------------------------------------------------------------
 * Public type
 * --------------------------------------------------------------------------- */

/**
 * One Monday scouting report. Every slot is REQUIRED so the renderer
 * never has to render a conditional empty state. New slots are added
 * by:
 *   1. Extending this interface.
 *   2. Adding the matching entry to {@link SCOUT_SLOTS}.
 *   3. Adding the matching generator branch in {@link rollWeeklyScout}.
 * The compiler enforces all three.
 */
export interface WeeklyScoutingReport {
  /** "Around the league" atmospheric headline. */
  worldLine: string;
  /** Foreshadow about an ability/edge that may show up this week. */
  abilityLine: string;
  /** Rumor about a player who might be on the wire / market this week. */
  playerLine: string;
}

/* ---------------------------------------------------------------------------
 * Slot registry — the typed contract that drives rendering
 * --------------------------------------------------------------------------- */

export interface ScoutSlotDef {
  /** Which key on {@link WeeklyScoutingReport} this slot reads. */
  key: keyof WeeklyScoutingReport;
  /** Pill label in the renderer (e.g. "Around the League"). */
  label: string;
  /** Emoji glyph -- intentionally text so the UI doesn't pull an icon lib. */
  glyph: string;
  /** Tailwind-friendly hex tint used for the slot's pill. */
  tint: string;
}

/**
 * Canonical slot list. Order in this array IS the render order. Each
 * slot's `key` must exactly match a field on
 * {@link WeeklyScoutingReport} -- TypeScript will fail the build if
 * the interface changes and this registry is not updated.
 */
export const SCOUT_SLOTS: readonly ScoutSlotDef[] = [
  {
    key: "worldLine",
    label: "Around the League",
    glyph: "📰",
    tint: "#22d3ee",
  },
  {
    key: "abilityLine",
    label: "Whispers from the Wire",
    glyph: "📡",
    tint: "#f59e0b",
  },
  {
    key: "playerLine",
    label: "Trade Block Buzz",
    glyph: "💬",
    tint: "#ef4444",
  },
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
 * falls back to a curated pool if no live data is available.
 */
export function rollWeeklyScout(run: RunState): WeeklyScoutingReport {
  return {
    worldLine: pickWorldLine(run),
    abilityLine: pickAbilityLine(run),
    playerLine: pickPlayerLine(run),
  };
}

/* ---------------------------------------------------------------------------
 * Slot generators
 * ---------------------------------------------------------------------------
 *
 * Each generator follows the same shape:
 *   1. Try to source a "live" hook from the run (upcoming encounters,
 *      selected team, etc.).
 *   2. If found, write a templated line that references the hook.
 *   3. Otherwise, sample from a curated fallback pool.
 *
 * Generators NEVER throw and NEVER return empty strings. The renderer
 * trusts every slot will have content.
 */

/* -- worldLine ------------------------------------------------------------- */

/**
 * Week-phase buckets are used to color the world line so the pool
 * matches the season's natural arc:
 *   - "early"   weeks 1-4 -- season-opening tone
 *   - "middle"  weeks 5-8 -- midseason / trade deadline tone
 *   - "late"    weeks 9-12 -- stretch run / playoff push tone
 */
type WeekPhase = "early" | "middle" | "late";
function weekPhase(week: number): WeekPhase {
  if (week <= 4) return "early";
  if (week <= 8) return "middle";
  return "late";
}

const WORLD_POOL: Record<WeekPhase, string[]> = {
  early: [
    "Around the league: every clubhouse is selling 'this is our year' to the writers. Half of them believe it.",
    "The commish opened the season with a 12-minute speech nobody remembers. The bullpen catchers are stretched.",
    "Equipment trucks are still rolling in. A few teams are reportedly hand-painting helmets the night before games.",
    "Beat reporters are filing 'who's healthy' columns. Nobody is healthy.",
    "Front offices spent the off-season hoarding analysts. Watch for weird matchups.",
  ],
  middle: [
    "Trade deadline whispers are starting. Three GMs are reportedly working the phones late.",
    "Midseason awards chatter is heating up. The metric folks are tweeting subtweets.",
    "Hot stove rumors are leaking out of every dugout. Half are fake; the other half are worse.",
    "League-wide injury list ticked up this week. Bullpens are stretched, opportunists are circling.",
    "The All-Star ballot dropped. Several role players are mysteriously campaigning hard.",
  ],
  late: [
    "Stretch run. Contenders are pressing; pretenders are 'planning for next year' in print.",
    "Playoff seeding math is getting ugly. Tiebreaker scenarios are leaking out of the league office.",
    "September call-ups are landing. Watch the dugouts -- new faces tend to show up cheap.",
    "Wild card races are tightening. A couple of front offices already have moving boxes in the visitor's clubhouse.",
    "Bad teams are auditioning every minor leaguer they own. The 'who's that?' factor is real.",
  ],
};

/**
 * Optional franchise-flavored line that fires when the player picked
 * a recognizable franchise. Keeps the report grounded in the user's
 * chosen identity without hard-coding 30 unique blurbs (we just lean
 * on team name + division).
 */
function teamFlavorLine(run: RunState): string | null {
  const team = run.selectedTeamId ? MLB_TEAMS[run.selectedTeamId] : null;
  if (!team) return null;
  const div = team.division;
  const pool = [
    `Down ${team.shortName} way, the radio guys say the clubhouse mood is "fine, actually." That usually means it isn't.`,
    `The ${team.shortName} are getting a closer look in the ${div} race -- not necessarily a friendly one.`,
    `Ownership in ${team.shortName} country is "monitoring the situation." Translation: someone's job is in play.`,
    `${div} pundits keep pegging the ${team.shortName} as the team to watch this week. Take that for what it's worth.`,
    `Beat writers covering the ${team.shortName} are openly bored. Quiet usually breaks loud.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function pickWorldLine(run: RunState): string {
  // 35% of the time pull a franchise-flavored line so the world feels
  // tethered to the user's team identity; the rest of the time the
  // league-wide pool keeps the broader "scope of the league" feel.
  if (Math.random() < 0.35) {
    const flav = teamFlavorLine(run);
    if (flav) return flav;
  }
  const pool = WORLD_POOL[weekPhase(run.week)];
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0]!;
}

/* -- abilityLine ----------------------------------------------------------- */

/**
 * Pull every ability card on offer this week (merchant listings +
 * event-reward grants) so the ability hint can foreshadow REAL
 * upcoming content. Caller may receive an empty list, in which case
 * the abilityLine generator falls back to a generic edge teaser.
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

function pickAbilityLine(run: RunState): string {
  const ids = collectUpcomingCardIds(run);
  // Live-data path: pick a card actually on offer this week and write
  // a "rumor" about it. Players that have already played the week
  // will see those cards show up in merchants / event rewards and the
  // foreshadowing pays off in real gameplay.
  if (ids.length > 0) {
    const id = ids[Math.floor(Math.random() * ids.length)]!;
    const card = sessionCardById(id);
    if (card) {
      const variants = [
        `Equipment manager rumor: a "${card.name}" is supposed to surface this week. Worth the wait if you can swing it.`,
        `A scout swears he saw a ${card.name} in a back-room deal. If it shows up, don't sleep on it.`,
        `Word is moving fast on a ${card.name} this week. Half the league is asking after it.`,
        `A clubhouse attendant overheard "${card.name}" three times today. Might want to keep room in your bag.`,
        `Hobby shops in town are stocking ${card.name} this week. First one through the door tends to grab it.`,
      ];
      return variants[Math.floor(Math.random() * variants.length)]!;
    }
  }
  // Fallback: tease an edge family by name. We still want the line
  // to feel diegetic, so we lean on edge labels from SZN_EDGES.
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
  return `A ${meta.label} edge is supposedly moving through the league this week. Chain it right and the score climbs.`;
}

/* -- playerLine ------------------------------------------------------------ */

/**
 * Players the user might actually see in this week's free agency.
 * Foreshadowing real listings is the strongest version of the hint,
 * so we look at PlayerMarketOffer entries first; if none, we sample
 * from the global SZN player pool minus anyone already on the
 * user's roster (so the rumor never tells the player about someone
 * they already signed).
 */
function pickPlayerLine(run: RunState): string {
  const rosterIds = new Set(run.roster.map((r) => r.player.id));
  const marketIds: string[] = [];
  for (const day of run.weekEncounters) {
    for (const offer of day.offers as EncounterOffer[]) {
      if (offer.kind === "playerMarket") {
        for (const l of offer.listings) marketIds.push(l.playerId);
      }
    }
  }
  // First-choice pool: free-agent listings the user will actually
  // see this week. Second-choice pool: anyone not on the roster.
  const primary = marketIds
    .map((id) => ALL_SZN_PLAYERS.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p && !rosterIds.has(p.id));
  const pool =
    primary.length > 0
      ? primary
      : ALL_SZN_PLAYERS.filter((p) => !rosterIds.has(p.id));
  if (pool.length === 0) {
    // Defensive: every SZN player is on the roster (impossible at
    // STARTER_PACK_TOTAL=10, but typed-safe). Generic rumor instead.
    return "The agents' bar is buzzing tonight -- somebody big is unhappy with their deal, nobody's saying who.";
  }
  const p = pool[Math.floor(Math.random() * pool.length)]!;
  const team = MLB_TEAMS[p.teamId];
  const teamName = team?.shortName ?? p.teamId;
  const variants = [
    `${p.name} (${teamName}) is reportedly testing the market. Front offices are watching.`,
    `${teamName} brass deny it, but ${p.name} is said to be quietly open to a move.`,
    `Whispers from the agents' bar: ${p.name} wants out of ${teamName}.`,
    `The ${teamName} are taking calls on ${p.name}. The asking price isn't friendly.`,
    `Clubhouse leaks say ${p.name} has cleaned out his locker twice this month. The ${teamName} say it's nothing.`,
    `A scout caught ${p.name} eating alone at the team hotel. In ${teamName} circles, that means something.`,
  ];
  return variants[Math.floor(Math.random() * variants.length)]!;
}
