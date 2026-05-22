/**
 * Module-load sanity tests for the SZN player + ability registries.
 *
 * - Every player carries a passive ability with a non-empty name + id.
 * - Every ability id is unique within its player (passive + potentials).
 * - Every edge id referenced by an ability trigger resolves in `SZN_EDGES`.
 * - Every player has a resolvable left/right edge.
 * - NYY, PHI, TOR rosters each contain exactly 20 players (12 batters + 8 pitchers).
 * - No two players share an id across teams.
 *
 * Mirrors the in-module validation in `sznPlayers.ts` for an explicit,
 * runnable test that CI can fail on without needing to import the
 * full game store. Importing `sznPlayers` from this script is enough
 * to trigger the in-module assertions too -- this file then layers a
 * second pass of explicit assertions on top.
 *
 * Run with:   npx tsx src/lib/__szn_players_check.ts
 */

import { SZN_EDGES } from "./sznEdges";
import {
  ALL_SZN_PLAYERS,
  SZN_PLAYERS_BY_TEAM,
  isSznPlayer,
  type SznPlayer,
} from "./sznPlayers";
import {
  revealedAbilities,
  triggerLabel,
  triggerGlyph,
  type PlayerAbility,
  type PlayerAbilityTrigger,
} from "./sznPlayerAbilities";

let failures = 0;
let checks = 0;

function assert(cond: unknown, label: string, ctx?: object): void {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error(`FAIL  ${label}`, ctx ?? "");
  }
}

const ABILITY_TRIGGER_KINDS: PlayerAbilityTrigger["kind"][] = [
  "onSnap",
  "onTeammateSnap",
  "onLockIn",
  "onMatchupReveal",
  "onMatchupWin",
  "onWeekStart",
  "onDayStart",
  "passive",
];

function checkAbility(player: SznPlayer, ab: PlayerAbility, slot: string): void {
  assert(
    typeof ab.id === "string" && ab.id.length > 0,
    `${player.id} :: ${slot} ability has a non-empty id`,
  );
  assert(
    typeof ab.name === "string" && ab.name.length > 0,
    `${player.id} :: ${slot} ability has a non-empty name`,
  );
  assert(
    ABILITY_TRIGGER_KINDS.includes(ab.trigger.kind),
    `${player.id} :: ${slot} ability trigger kind is recognized`,
    { kind: ab.trigger.kind },
  );
  // Edge id references inside triggers must resolve.
  const edgeOnTrigger = (ab.trigger as { edge?: string }).edge;
  if (typeof edgeOnTrigger === "string") {
    assert(
      Boolean(SZN_EDGES[edgeOnTrigger as keyof typeof SZN_EDGES]),
      `${player.id} :: ${slot} trigger edge resolves`,
      { edge: edgeOnTrigger },
    );
  }
  // triggerGlyph + triggerLabel shouldn't throw.
  assert(
    typeof triggerGlyph(ab.trigger) === "string",
    `${player.id} :: ${slot} triggerGlyph returns a string`,
  );
  assert(
    typeof triggerLabel(ab.trigger) === "string",
    `${player.id} :: ${slot} triggerLabel returns a string`,
  );
}

// ---------------------------------------------------------------------------
// Roster-level checks
// ---------------------------------------------------------------------------

const seenIdsGlobal = new Set<string>();
for (const teamId of ["NYY", "PHI", "TOR"] as const) {
  const roster = SZN_PLAYERS_BY_TEAM[teamId];
  assert(
    Array.isArray(roster) && roster.length === 20,
    `${teamId} roster has exactly 20 players`,
    { len: roster.length },
  );
  const batters = roster.filter((p) => p.role === "Batter").length;
  const pitchers = roster.filter((p) => p.role === "Pitcher").length;
  assert(batters === 12, `${teamId} roster has 12 batters`, { batters });
  assert(pitchers === 8, `${teamId} roster has 8 pitchers`, { pitchers });

  for (const p of roster) {
    assert(isSznPlayer(p), `${p.id} is a SznPlayer`);
    assert(
      Boolean(SZN_EDGES[p.leftEdge]),
      `${p.id} leftEdge resolves`,
      { edge: p.leftEdge },
    );
    assert(
      Boolean(SZN_EDGES[p.rightEdge]),
      `${p.id} rightEdge resolves`,
      { edge: p.rightEdge },
    );
    assert(Boolean(p.passive), `${p.id} has a passive ability`);
    // Cross-team uniqueness check on player id.
    assert(
      !seenIdsGlobal.has(p.id),
      `${p.id} player id is unique across teams`,
    );
    seenIdsGlobal.add(p.id);
    // Per-player ability id uniqueness.
    const abilityIds = [p.passive.id, ...(p.potentials ?? []).map((a) => a.id)];
    const uniqueAbilityIds = new Set(abilityIds);
    assert(
      uniqueAbilityIds.size === abilityIds.length,
      `${p.id} ability ids are unique within player`,
      { abilityIds },
    );
    // Validate passive + every potential.
    checkAbility(p, p.passive, "passive");
    (p.potentials ?? []).forEach((ab, i) => {
      checkAbility(p, ab, `potential[${i}]`);
    });
    // Potentials capped at 3 (legend max).
    assert(
      (p.potentials ?? []).length <= 3,
      `${p.id} has at most 3 potentials`,
      { count: (p.potentials ?? []).length },
    );
  }
}

// ---------------------------------------------------------------------------
// Reveal logic spot checks
// ---------------------------------------------------------------------------

{
  // Aaron Judge should reveal passive only at common, then +1 potential per tier.
  const judge = ALL_SZN_PLAYERS.find((p) => p.id === "nyy-judge");
  assert(judge !== undefined, "nyy-judge resolves in ALL_SZN_PLAYERS");
  if (judge) {
    assert(
      revealedAbilities(judge, "common").length === 1,
      "Judge common reveals 1 ability (passive only)",
    );
    assert(
      revealedAbilities(judge, "allstar").length === 2,
      "Judge allstar reveals 2 abilities",
    );
    assert(
      revealedAbilities(judge, "veteran").length === 3,
      "Judge veteran reveals 3 abilities",
    );
    assert(
      revealedAbilities(judge, "legend").length === 4,
      "Judge legend reveals 4 abilities (passive + 3 potentials)",
    );
  }
}

// ---------------------------------------------------------------------------
// Engine-touchpoint: every player with `permanentBoostOnRookie` carries
// a `veteran-tag` on at least one edge (so a rookie's `rookie` edge can
// snap into it). The gameStore's lock-in side-effect loop handles BOTH
// orientations (rookie | veteran AND veteran | rookie).
// ---------------------------------------------------------------------------
for (const p of ALL_SZN_PLAYERS) {
  const ab = p.passive;
  if (!ab.effect.permanentBoostOnRookie) continue;
  const hasVeteranEdge = p.leftEdge === "veteran-tag" || p.rightEdge === "veteran-tag";
  assert(
    hasVeteranEdge,
    `${p.id} passive with permanentBoostOnRookie carries a veteran-tag on one of its edges`,
    { leftEdge: p.leftEdge, rightEdge: p.rightEdge },
  );
}

// ---------------------------------------------------------------------------
// Final summary
// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\nFAILED ${failures}/${checks} SZN player sanity checks.`);
  process.exit(1);
}
console.log(`All ${checks} SZN player sanity checks passed across 3 teams.`);
