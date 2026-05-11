/**
 * SZN Mode ghost opponent generator + AI script.
 *
 * Locally generated only (no backend). Builds a procedural opponent that
 * scales with the user's current Win/Loss tally so series stay competitive
 * as the player levels up.
 */

import { SESSION_CARDS } from "./cards";
import { BATTERS, PITCHERS } from "./players";
import type {
  ClassTag,
  GhostSnapshot,
  Item,
  RosterPlayer,
  RunState,
  Tier,
  WeekendScouting,
} from "./run";
import {
  STARTER_PACK_BATTERS,
  STARTER_PACK_PITCHERS,
  TIER_ORDER,
  makeRunId,
} from "./run";

function sample<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function tierForRecord(wins: number, losses: number): Tier {
  // Ghost tier loosely scales with opponent wins; a 5-win user faces silvers,
  // 8-win user faces golds, etc. Losses pull the tier back to keep early
  // skids forgiving.
  const score = Math.max(0, wins - losses);
  if (score >= 8) return "diamond";
  if (score >= 5) return "gold";
  if (score >= 2) return "silver";
  return "bronze";
}

function buildGhostRoster(wins: number, losses: number): RosterPlayer[] {
  const baseTier = tierForRecord(wins, losses);
  const baseIdx = TIER_ORDER.indexOf(baseTier);
  const batters = sample(BATTERS, STARTER_PACK_BATTERS).map((p) => ({
    player: p,
    tier: TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, baseIdx + (Math.random() < 0.3 ? 1 : 0)))],
    tag: p.tag,
  }));
  const pitchers = sample(PITCHERS, STARTER_PACK_PITCHERS).map((p) => ({
    player: p,
    tier: baseTier,
    tag: p.tag,
  }));
  return [...batters, ...pitchers];
}

function buildGhostBag(wins: number, losses: number): Item[] {
  const itemCount = 4 + Math.min(8, wins) - Math.min(2, losses);
  const cards = sample(SESSION_CARDS, Math.max(2, itemCount));
  return cards.map((c) => ({ instanceId: makeRunId("g-itm"), cardId: c.id }));
}

const TEAM_NICKNAMES = [
  "Hounds",
  "Outlaws",
  "Specters",
  "Sluggers",
  "Tritons",
  "Bandits",
  "Aces",
  "Rovers",
  "Static",
  "Reapers",
];

const TEAM_CITIES = [
  "Hoboken",
  "Tulsa",
  "Bismarck",
  "Tacoma",
  "Daytona",
  "Lansing",
  "Akron",
  "Reno",
  "Spokane",
  "Topeka",
];

function ghostLabel(): string {
  const city = TEAM_CITIES[Math.floor(Math.random() * TEAM_CITIES.length)];
  const nick = TEAM_NICKNAMES[Math.floor(Math.random() * TEAM_NICKNAMES.length)];
  return `${city} ${nick}`;
}

export function buildGhostSnapshot(run: RunState): GhostSnapshot {
  return {
    label: `Ghost: ${ghostLabel()}`,
    roster: buildGhostRoster(run.wins, run.losses),
    itemBag: buildGhostBag(run.wins, run.losses),
  };
}

/** Class-tag copy for the opposing starter (pitcher) on the Monday report. */
const PITCHER_SCOUT_COPY: Partial<Record<ClassTag, string>> = {
  Strikeout:
    "They run an elite swing-and-miss starter — expect chase pitches; contact and foul-management cards pay off.",
  Control:
    "Their ace is a weak-contact / groundball-leaning arm — stack launch angle and barrel paths if you have them.",
  Starter:
    "Workhorse starter who floods the zone — stamina answers and value depth in the chain matter.",
  Veteran:
    "Crafty veteran on the bump — reads sequencing; bring versatility, not one-trick shapes.",
  Closer:
    "Short-burst closer profile ported into a start — expect high-leverage stuff early; don't sleep on the first trip.",
  Groundball:
    "True groundball tendencies — keep the ball off the deck; lift and line-drive tools are at a premium.",
};

/**
 * Build the three-line Monday scouting brief from a ghost that is already
 * locked in for the upcoming series (same object used at-bat Fri–Sun).
 */
export function weekendScoutingFromGhost(ghost: GhostSnapshot): WeekendScouting {
  const pitcher = ghost.roster.find((r) => r.player.role === "Pitcher");
  const batters = ghost.roster.filter((r) => r.player.role === "Batter");
  const tag = pitcher?.tag ?? "Veteran";
  const pitcherLine =
    PITCHER_SCOUT_COPY[tag] ??
    `Their listed starter profiles as ${tag} — shape your connectors for that tendency.`;

  const counts = new Map<ClassTag, number>();
  for (const b of batters) {
    counts.set(b.tag, (counts.get(b.tag) ?? 0) + 1);
  }
  let bestTag: ClassTag = "Contact";
  let bestN = 0;
  for (const [t, n] of counts) {
    if (n > bestN) {
      bestTag = t;
      bestN = n;
    }
  }
  const synergyLine =
    bestN >= 3
      ? `Opponent synergy: ${bestTag}s — ${bestN} of 9 bats in that mold.`
      : `Lineup leans ${bestTag} (${bestN} bats); the rest is mixed — shop for holes.`;

  const cleanLabel = ghost.label.replace(/^Ghost:\s*/i, "").trim();
  const opponentLine = `This weekend, you face the ${cleanLabel}.`;

  return { opponentLine, pitcherLine, synergyLine };
}

/**
 * Trigger script for the ghost during an at-bat. v1: dead simple — when
 * the ghost is trailing by a comfortable margin, it plays an extra item
 * from its bag (reuses its existing items since combat is symmetric).
 *
 * Returns a list of item card ids the ghost wants to attach this at-bat.
 * The store layers this in on top of the ghost's "default" item picks.
 */
export interface GhostTriggerContext {
  inning: number;
  trailingBy: number;
  bagCardIds: string[];
}

export function ghostTriggerItems(ctx: GhostTriggerContext): string[] {
  const out: string[] = [];
  if (ctx.trailingBy >= 5 && ctx.inning === 3 && ctx.bagCardIds.length > 0) {
    // Comeback: play a high-value card from the bag.
    out.push(ctx.bagCardIds[0]);
  }
  if (ctx.trailingBy >= 8 && ctx.bagCardIds.length > 1) {
    out.push(ctx.bagCardIds[1]);
  }
  return out;
}
