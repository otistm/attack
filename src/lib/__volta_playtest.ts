/**
 * Volta (volt class) playtest — 10 simulated brawls with full combat loop.
 * Run: tsx src/lib/__volta_playtest.ts
 */
import { dealBrawlElementHand } from "./elementDeal";
import { elementCatalogId } from "./elementDeal";
import {
  buildHandAttackGroupsWithAbilities,
  computeElementBondsWithAbilities,
  applyElementCombatHit,
} from "./elementAbilities";
import {
  BRAWL_START_HP,
  brawlCardOverlayCooldownMs,
  freshElementCombatState,
  optimizeElementHand,
  tickCombatDotStacks,
  type BrawlHandAttack,
  type ElementCombatState,
} from "./brawlElements";
import {
  classPoolIds,
  randomOpponentClass,
  type BrawlClass,
} from "./elementClassPools";
import { elementCardById } from "./elementCards";
import { applySandstormTick, BRAWL_SANDSTORM_WARNING_MS } from "./brawlSandstorm";

const GAMES = 10;
const USER_CLASS: BrawlClass = "volt";
const STEP_MS = 50;
const DOT_TICK_MS = 1000;
const MAX_COMBAT_MS = 120_000;

interface GroupTimer {
  attacks: BrawlHandAttack[];
  length: number;
  nextFireAt: number;
}

interface GameReport {
  game: number;
  opponentClass: BrawlClass;
  userHand: string[];
  oppHand: string[];
  userLayout: string[];
  userSeams: number;
  userBondPower: number;
  won: boolean;
  combatMs: number;
  userHp: number;
  oppHp: number;
  userBurnDealt: number;
  oppBurnDealt: number;
  oppBurnStacks: number;
  sandstorm: boolean;
  cardAppearances: Record<string, number>;
  abilityTriggers: Record<string, number>;
}

function cardName(id: string): string {
  return elementCardById(elementCatalogId(id)).name;
}

function catalogName(id: string): string {
  return elementCardById(elementCatalogId(id)).name;
}

function fireGroup(
  attacks: BrawlHandAttack[],
  length: number,
  startMs: number,
): GroupTimer {
  const slot = brawlCardOverlayCooldownMs(length);
  return { attacks, length, nextFireAt: startMs + slot };
}

function applyHit(
  state: ElementCombatState,
  attack: BrawlHandAttack,
  attackerIsPlayer: boolean,
  attackerHandCatalogIds: readonly string[],
): ElementCombatState {
  if (attack.skipAttack) return state;
  const hitParams = {
    power: attack.power,
    leftCardId: attack.id,
    rightCardId: attack.rightCardId,
    combineCount: attack.combineCount,
    attackerHandCatalogIds,
  };
  if (attack.element) {
    return applyElementCombatHit(
      state,
      { ...hitParams, element: attack.element },
      attackerIsPlayer,
    );
  }
  return applyElementCombatHit(state, hitParams, attackerIsPlayer);
}

function fireGroupAttack(
  state: ElementCombatState,
  group: GroupTimer,
  attackerIsPlayer: boolean,
  attackerHandCatalogIds: readonly string[],
): ElementCombatState {
  let next = state;
  for (const attack of group.attacks) {
    next = applyHit(next, attack, attackerIsPlayer, attackerHandCatalogIds);
  }
  return next;
}

function simulateCombat(
  userGroups: BrawlHandAttack[][],
  oppGroups: BrawlHandAttack[][],
  userHandCatalogIds: readonly string[],
  oppHandCatalogIds: readonly string[],
): { state: ElementCombatState; ms: number; sandstorm: boolean } {
  let state = freshElementCombatState();
  const introMs = 1500;
  const userTimers = userGroups.map((g) => fireGroup(g, g.length, introMs));
  const oppTimers = oppGroups.map((g) => fireGroup(g, g.length, introMs));
  let sandstorm = false;
  let sandstormTick = 0;
  let lastDotTick = 0;

  let t = 0;
  for (t = STEP_MS; t <= MAX_COMBAT_MS; t += STEP_MS) {
    if (state.playerHP <= 0 || state.cpuHP <= 0) break;

    if (t - lastDotTick >= DOT_TICK_MS) {
      state = tickCombatDotStacks(state);
      lastDotTick = t;
    }

    if (t >= BRAWL_SANDSTORM_WARNING_MS) {
      sandstorm = true;
      if ((t - BRAWL_SANDSTORM_WARNING_MS) % DOT_TICK_MS === 0) {
        sandstormTick++;
        const tick = applySandstormTick(state, sandstormTick);
        state = tick.next;
        if (tick.instantEnd) break;
      }
    }

    for (const g of userTimers) {
      if (t >= g.nextFireAt) {
        state = fireGroupAttack(state, g, true, userHandCatalogIds);
        const slot = brawlCardOverlayCooldownMs(g.length);
        g.nextFireAt = t + slot;
      }
    }
    for (const g of oppTimers) {
      if (t >= g.nextFireAt) {
        state = fireGroupAttack(state, g, false, oppHandCatalogIds);
        const slot = brawlCardOverlayCooldownMs(g.length);
        g.nextFireAt = t + slot;
      }
    }

    if (state.playerHP <= 0 || state.cpuHP <= 0) break;
  }

  return { state, ms: Math.min(t, MAX_COMBAT_MS), sandstorm };
}

function trackAbilityTriggers(
  hand: ReturnType<typeof optimizeElementHand>["hand"],
  seams: ReadonlySet<string>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const bonds = computeElementBondsWithAbilities(hand, seams);
  for (const card of hand) {
    const cat = elementCatalogId(card.id);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  for (const bond of bonds) {
    if (bond.element === "fire") {
      counts["__fire_bond"] = (counts["__fire_bond"] ?? 0) + 1;
    }
  }
  return counts;
}

const reports: GameReport[] = [];
const cardPickCounts: Record<string, number> = {};
const supportInHand = { mend: 0, aegis: 0, bastion: 0, purge: 0 };
let wins = 0;
let sandstormGames = 0;
let avgCombatMs = 0;

let zeroSeamGames = 0;
let tinderboxGames = 0;
let matchstickGames = 0;
let tinderboxSavedSeams = 0;

let totalOppBurn = 0;

for (let g = 0; g < GAMES; g++) {
  const seed = 5000 + g * 9973;
  const oppClass = randomOpponentClass(USER_CLASS);
  const userRaw = dealBrawlElementHand(5, classPoolIds(USER_CLASS), seed);
  const oppRaw = dealBrawlElementHand(5, classPoolIds(oppClass), seed + 5000);
  const userOpt = optimizeElementHand(userRaw);
  const oppOpt = optimizeElementHand(oppRaw);

  const userBonds = computeElementBondsWithAbilities(
    userOpt.hand,
    userOpt.affirmedSeams,
  );
  const oppBonds = computeElementBondsWithAbilities(
    oppOpt.hand,
    oppOpt.affirmedSeams,
  );
  const userGroups = buildHandAttackGroupsWithAbilities(
    userOpt.hand,
    userBonds,
    userOpt.affirmedSeams,
  );
  const oppGroups = buildHandAttackGroupsWithAbilities(
    oppOpt.hand,
    oppBonds,
    oppOpt.affirmedSeams,
  );

  const userCatalogIds = userOpt.hand.map((c) => elementCatalogId(c.id));
  const oppCatalogIds = oppOpt.hand.map((c) => elementCatalogId(c.id));

  const { state, ms, sandstorm } = simulateCombat(
    userGroups,
    oppGroups,
    userCatalogIds,
    oppCatalogIds,
  );
  const won = state.playerHP > 0 && state.cpuHP <= 0;
  if (won) wins++;
  if (sandstorm) sandstormGames++;
  avgCombatMs += ms;

  if (userOpt.affirmedSeams.size === 0) zeroSeamGames++;

  const hadTinderbox = userRaw.some((c) => elementCatalogId(c.id) === "el-51");
  const hadMatchstick = userRaw.some((c) => elementCatalogId(c.id) === "el-52");
  if (hadTinderbox) {
    tinderboxGames++;
    if (userOpt.affirmedSeams.size > 0) tinderboxSavedSeams++;
  }
  if (hadMatchstick) matchstickGames++;
  totalOppBurn += state.burnOnCpu;

  for (const c of userRaw) {
    const cat = elementCatalogId(c.id);
    cardPickCounts[cat] = (cardPickCounts[cat] ?? 0) + 1;
    if (cat === "el-06") supportInHand.mend++;
    if (cat === "el-09") supportInHand.aegis++;
    if (cat === "el-14") supportInHand.bastion++;
    if (cat === "el-15") supportInHand.purge++;
  }

  reports.push({
    game: g + 1,
    opponentClass: oppClass,
    userHand: userRaw.map((c) => catalogName(c.id)),
    oppHand: oppRaw.map((c) => catalogName(c.id)),
    userLayout: userOpt.hand.map((c) => catalogName(c.id)),
    userSeams: userOpt.affirmedSeams.size,
    userBondPower: userOpt.bondPower,
    won,
    combatMs: ms,
    userHp: state.playerHP,
    oppHp: state.cpuHP,
    userBurnDealt: 100 - state.cpuHP,
    oppBurnDealt: 100 - state.playerHP,
    oppBurnStacks: state.burnOnCpu,
    sandstorm,
    cardAppearances: trackAbilityTriggers(userOpt.hand, userOpt.affirmedSeams),
    abilityTriggers: {},
  });
}

avgCombatMs /= GAMES;

console.log("=== VOLTA (VOLT) PLAYTEST (10 games, current pool) ===\n");
for (const r of reports) {
  console.log(
    `Game ${r.game} vs ${r.opponentClass}: ${r.won ? "WIN" : "LOSS"} | ` +
      `HP ${r.userHp}-${r.oppHp} | ${(r.combatMs / 1000).toFixed(1)}s` +
      `${r.sandstorm ? " (sandstorm)" : ""}`,
  );
  console.log(`  Dealt: ${r.userHand.join(", ")}`);
  console.log(
    `  Optimal: ${r.userLayout.join(" → ")} (${r.userSeams} seams, power ${r.userBondPower})`,
  );
  console.log(`  Foe: ${r.oppHand.join(", ")}`);
  console.log("");
}

console.log(`Record: ${wins}-${GAMES - wins}`);
console.log(`Avg combat: ${(avgCombatMs / 1000).toFixed(1)}s`);
console.log(`Sandstorm reached: ${sandstormGames}/${GAMES}`);
console.log("\nCard appearance frequency (user hands):");
const sortedCards = Object.entries(cardPickCounts).sort((a, b) => b[1] - a[1]);
for (const [id, n] of sortedCards) {
  console.log(`  ${catalogName(id)} (${id}): ${n}/${GAMES}`);
}
console.log(`Zero-seam optimal hands: ${zeroSeamGames}/${GAMES}`);
console.log("\nSupport cards in hands:");
console.log(`  Mend ${supportInHand.mend}, Aegis ${supportInHand.aegis}, Bastion ${supportInHand.bastion}, Purge ${supportInHand.purge}`);
