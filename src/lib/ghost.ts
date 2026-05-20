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
  GhostSnapshot,
  Item,
  RosterPlayer,
  RunState,
  Rarity,
} from "./run";
import {
  STARTER_PACK_BATTERS,
  STARTER_PACK_PITCHERS,
  RARITY_ORDER,
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

function rarityForRecord(wins: number, losses: number): Rarity {
  // Ghost rarity loosely scales with opponent wins; a 5-win user faces all-stars,
  // 8-win user faces veterans, etc. Losses pull the rarity back to keep early
  // skids forgiving.
  const score = Math.max(0, wins - losses);
  if (score >= 8) return "legend";
  if (score >= 5) return "veteran";
  if (score >= 2) return "allstar";
  return "common";
}

function buildGhostRoster(wins: number, losses: number): RosterPlayer[] {
  const baseRarity = rarityForRecord(wins, losses);
  const baseIdx = RARITY_ORDER.indexOf(baseRarity);
  const batters = sample(BATTERS, STARTER_PACK_BATTERS).map((p) => ({
    player: p,
    rarity: RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, Math.max(0, baseIdx + (Math.random() < 0.3 ? 1 : 0)))],
    tag: p.tag,
  }));
  const pitchers = sample(PITCHERS, STARTER_PACK_PITCHERS).map((p) => ({
    player: p,
    rarity: baseRarity,
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

// NOTE: The Monday scouting brief is no longer derived from the
// weekend ghost. The report has been reframed as worldbuilding
// flavor (league atmosphere + ability rumors + player buzz) and is
// authored by `rollWeeklyScout` in `scouting.ts`. The ghost itself
// is still built here and still drives the Fri-Sun series; only
// the scouting text generation moved out.

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
