/**
 * Ren (freeze class) playtest — 10 simulated brawls with full combat loop.
 * Approximates per-card freeze pause by delaying random defender group timers.
 * Run: tsx src/lib/__ren_playtest.ts
 */
import { dealBrawlElementHand, elementCatalogId } from "./elementDeal";
import {
  buildHandAttackGroupsWithAbilities,
  computeElementBondsWithAbilities,
  applyElementCombatHit,
} from "./elementAbilities";
import {
  brawlCardOverlayCooldownMs,
  FREEZE_COOLDOWN_PAUSE_MS,
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
import { canConnectAny } from "./connect";
import { applySandstormTick, BRAWL_SANDSTORM_WARNING_MS } from "./brawlSandstorm";

const GAMES = 10;
const USER_CLASS: BrawlClass = "freeze";
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
  freezeBonds: number;
  won: boolean;
  combatMs: number;
  userHp: number;
  oppHp: number;
  oppFreezeStacks: number;
  sandstorm: boolean;
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

function delayRandomGroup(
  timers: GroupTimer[],
  delayMs: number,
): void {
  if (timers.length === 0) return;
  const idx = Math.floor(Math.random() * timers.length);
  timers[idx]!.nextFireAt += delayMs;
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
        const before = state.freezeOnCpu;
        state = fireGroupAttack(state, g, true, userHandCatalogIds);
        if (state.freezeOnCpu > before) {
          delayRandomGroup(oppTimers, FREEZE_COOLDOWN_PAUSE_MS);
        }
        const slot = brawlCardOverlayCooldownMs(g.length);
        g.nextFireAt = t + slot;
      }
    }
    for (const g of oppTimers) {
      if (t >= g.nextFireAt) {
        const before = state.freezeOnPlayer;
        state = fireGroupAttack(state, g, false, oppHandCatalogIds);
        if (state.freezeOnPlayer > before) {
          delayRandomGroup(userTimers, FREEZE_COOLDOWN_PAUSE_MS);
        }
        const slot = brawlCardOverlayCooldownMs(g.length);
        g.nextFireAt = t + slot;
      }
    }

    if (state.playerHP <= 0 || state.cpuHP <= 0) break;
  }

  return { state, ms: Math.min(t, MAX_COMBAT_MS), sandstorm };
}

function countFreezeBonds(
  hand: ReturnType<typeof optimizeElementHand>["hand"],
  seams: ReadonlySet<string>,
): number {
  const bonds = computeElementBondsWithAbilities(hand, seams);
  return bonds.filter((b) => b.element === "freeze").length;
}

function countPossibleSeams(hand: ReturnType<typeof optimizeElementHand>["hand"]): number {
  let n = 0;
  for (let i = 1; i < hand.length; i++) {
    if (canConnectAny(hand[i - 1], hand[i])) n++;
  }
  return n;
}

const reports: GameReport[] = [];
const cardPickCounts: Record<string, number> = {};
const supportInHand = { mend: 0, aegis: 0 };
let wins = 0;
let sandstormGames = 0;
let avgCombatMs = 0;
let zeroSeamGames = 0;
let lowSeamGames = 0;
let avalancheSoloGames = 0;
let totalOppFreeze = 0;

let icicleGames = 0;
let shiverGames = 0;
let snowglobeGames = 0;
let rimeShardGames = 0;
let snowglobeSavedSeams = 0;
let rimeShardSavedSeams = 0;
let permafrostGames = 0;

for (let g = 0; g < GAMES; g++) {
  const seed = 4000 + g * 7919;
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
  totalOppFreeze += state.freezeOnCpu;

  if (userOpt.affirmedSeams.size === 0) zeroSeamGames++;
  if (userOpt.affirmedSeams.size <= 1) lowSeamGames++;

  const hasAvalanche = userRaw.some((c) => elementCatalogId(c.id) === "el-40");
  if (hasAvalanche && userOpt.affirmedSeams.size === 0) avalancheSoloGames++;

  const hadSnowglobe = userRaw.some((c) => elementCatalogId(c.id) === "el-53");
  const hadRimeShard = userRaw.some((c) => elementCatalogId(c.id) === "el-61");
  const hadIcicle = userRaw.some((c) => elementCatalogId(c.id) === "el-54");
  const hadShiver = userRaw.some((c) => elementCatalogId(c.id) === "el-59");
  const hadPermafrost = userRaw.some((c) => elementCatalogId(c.id) === "el-60");
  if (hadSnowglobe) {
    snowglobeGames++;
    if (userOpt.affirmedSeams.size > 0) snowglobeSavedSeams++;
  }
  if (hadRimeShard) {
    rimeShardGames++;
    if (userOpt.affirmedSeams.size > 0) rimeShardSavedSeams++;
  }
  if (hadIcicle) icicleGames++;
  if (hadShiver) shiverGames++;
  if (hadPermafrost) permafrostGames++;

  for (const c of userRaw) {
    const cat = elementCatalogId(c.id);
    cardPickCounts[cat] = (cardPickCounts[cat] ?? 0) + 1;
    if (cat === "el-06") supportInHand.mend++;
    if (cat === "el-09") supportInHand.aegis++;
  }

  reports.push({
    game: g + 1,
    opponentClass: oppClass,
    userHand: userRaw.map((c) => catalogName(c.id)),
    oppHand: oppRaw.map((c) => catalogName(c.id)),
    userLayout: userOpt.hand.map((c) => catalogName(c.id)),
    userSeams: userOpt.affirmedSeams.size,
    userBondPower: userOpt.bondPower,
    freezeBonds: countFreezeBonds(userOpt.hand, userOpt.affirmedSeams),
    won,
    combatMs: ms,
    userHp: state.playerHP,
    oppHp: state.cpuHP,
    oppFreezeStacks: state.freezeOnCpu,
    sandstorm,
  });
}

avgCombatMs /= GAMES;

console.log("=== REN (FREEZE) PLAYTEST (10 games, tuned chip + pause) ===\n");
for (const r of reports) {
  console.log(
    `Game ${r.game} vs ${r.opponentClass}: ${r.won ? "WIN" : "LOSS"} | ` +
      `HP ${r.userHp}-${r.oppHp} | ${(r.combatMs / 1000).toFixed(1)}s` +
      `${r.sandstorm ? " (sandstorm)" : ""}`,
  );
  console.log(`  Dealt: ${r.userHand.join(", ")}`);
  console.log(
    `  Optimal: ${r.userLayout.join(" → ")} (${r.userSeams} seams, power ${r.userBondPower}, ${r.freezeBonds} freeze bonds)`,
  );
  console.log(`  Foe freeze stacks: ${r.oppFreezeStacks}`);
  console.log(`  Foe: ${r.oppHand.join(", ")}`);
  console.log("");
}

console.log(`Record: ${wins}-${GAMES - wins}`);
console.log(`Avg combat: ${(avgCombatMs / 1000).toFixed(1)}s`);
console.log(`Sandstorm reached: ${sandstormGames}/${GAMES}`);
console.log(`Avg foe freeze stacks at end: ${(totalOppFreeze / GAMES).toFixed(1)}`);
console.log(`Zero-seam optimal hands: ${zeroSeamGames}/${GAMES}`);
console.log(`≤1 seam optimal hands: ${lowSeamGames}/${GAMES}`);
console.log(`Avalanche dealt with 0 seams: ${avalancheSoloGames}/${GAMES}`);
console.log(`Snowglobe dealt: ${snowglobeGames}/${GAMES} (formed seams: ${snowglobeSavedSeams})`);
console.log(`Rime Shard dealt: ${rimeShardGames}/${GAMES} (formed seams: ${rimeShardSavedSeams})`);
console.log(`Icicle dealt: ${icicleGames}/${GAMES}`);
console.log(`Shiver dealt: ${shiverGames}/${GAMES}`);
console.log(`Permafrost dealt: ${permafrostGames}/${GAMES}`);

console.log("\nCard appearance frequency (user hands):");
const sortedCards = Object.entries(cardPickCounts).sort((a, b) => b[1] - a[1]);
for (const [id, n] of sortedCards) {
  console.log(`  ${catalogName(id)} (${id}): ${n}/${GAMES}`);
}
console.log("\nSupport cards in hands:");
console.log(`  Mend ${supportInHand.mend}, Aegis ${supportInHand.aegis}`);
