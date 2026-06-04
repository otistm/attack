/**
 * Shared headless brawl simulator for class playtests.
 */
import type { CardDefinition } from "./cards";
import { dealBrawlElementHand, elementCatalogId } from "./elementDeal";
import {
  buildHandAttackGroupsWithAbilities,
  computeElementBondsWithAbilities,
  applyElementCombatHit,
  type DefenderLayoutMetrics,
} from "./elementAbilities";
import {
  brawlCardOverlayCooldownMs,
  consumeAttackerFreeze,
  defenderLayoutMetrics,
  FREEZE_BACKLASH_THRESHOLD,
  FREEZE_COOLDOWN_PAUSE_MS,
  freshElementCombatState,
  optimizeElementHand,
  sumBondPower,
  tickCombatDotStacks,
  type BrawlHandAttack,
  type ElementCombatState,
} from "./brawlElements";
import type { BrawlClass } from "./elementClassPools";
import { classPoolIds, randomOpponentClass } from "./elementClassPools";
import { applySandstormTick, BRAWL_SANDSTORM_WARNING_MS } from "./brawlSandstorm";

export const PLAYTEST_GAMES_PER_CLASS = 10;
const STEP_MS = 50;
const DOT_TICK_MS = 1000;
const MAX_COMBAT_MS = 120_000;

export interface GroupTimer {
  attacks: BrawlHandAttack[];
  length: number;
  nextFireAt: number;
}

export interface PlaytestGameResult {
  won: boolean;
  combatMs: number;
  userHp: number;
  oppHp: number;
  userSeams: number;
  userBondPower: number;
  opponentClass: BrawlClass;
  sandstorm: boolean;
}

export interface BrawlHandLayout {
  hand: CardDefinition[];
  affirmedSeams: ReadonlySet<string>;
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
  defenderLayout: DefenderLayoutMetrics,
): ElementCombatState {
  if (attack.skipAttack) return state;
  const hitParams = {
    power: attack.power,
    leftCardId: attack.id,
    rightCardId: attack.rightCardId,
    combineCount: attack.combineCount,
    attackerHandCatalogIds,
    defenderLayout,
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
  defenderLayout: DefenderLayoutMetrics,
): ElementCombatState {
  let next = state;
  for (const attack of group.attacks) {
    next = applyHit(
      next,
      attack,
      attackerIsPlayer,
      attackerHandCatalogIds,
      defenderLayout,
    );
  }
  return next;
}

function delayRandomGroup(timers: GroupTimer[], delayMs: number): void {
  if (timers.length === 0) return;
  const idx = Math.floor(Math.random() * timers.length);
  timers[idx]!.nextFireAt += delayMs;
}

function pauseRandomGroupCards(
  cardPauseUntil: Record<string, number>,
  groups: BrawlHandAttack[][],
  nowMs: number,
): void {
  const eligible = groups.filter((g) => g.some((c) => !c.skipAttack));
  if (eligible.length === 0) return;
  const group = eligible[Math.floor(Math.random() * eligible.length)]!;
  const until = nowMs + FREEZE_COOLDOWN_PAUSE_MS;
  for (const card of group) {
    cardPauseUntil[card.id] = Math.max(cardPauseUntil[card.id] ?? 0, until);
  }
}

function noteFreezeApplied(
  state: ElementCombatState,
  last: { player: number; cpu: number },
  userTimers: GroupTimer[],
  oppTimers: GroupTimer[],
  userGroups: BrawlHandAttack[][],
  oppGroups: BrawlHandAttack[][],
  cardPauseUntil: Record<string, number>,
  nowMs: number,
): void {
  const playerDelta = state.freezeOnPlayer - last.player;
  const cpuDelta = state.freezeOnCpu - last.cpu;

  if (cpuDelta > 0) {
    delayRandomGroup(oppTimers, FREEZE_COOLDOWN_PAUSE_MS);
    pauseRandomGroupCards(cardPauseUntil, oppGroups, nowMs);
    if (state.freezeOnCpu >= FREEZE_BACKLASH_THRESHOLD) {
      delayRandomGroup(userTimers, FREEZE_COOLDOWN_PAUSE_MS);
      pauseRandomGroupCards(cardPauseUntil, userGroups, nowMs);
    }
  }
  if (playerDelta > 0) {
    delayRandomGroup(userTimers, FREEZE_COOLDOWN_PAUSE_MS);
    pauseRandomGroupCards(cardPauseUntil, userGroups, nowMs);
    if (state.freezeOnPlayer >= FREEZE_BACKLASH_THRESHOLD) {
      delayRandomGroup(oppTimers, FREEZE_COOLDOWN_PAUSE_MS);
      pauseRandomGroupCards(cardPauseUntil, oppGroups, nowMs);
    }
  }

  last.player = state.freezeOnPlayer;
  last.cpu = state.freezeOnCpu;
}

export function simulateBrawlCombat(
  userLayout: BrawlHandLayout,
  oppLayout: BrawlHandLayout,
  opponentClass: BrawlClass,
): PlaytestGameResult {
  const userBonds = computeElementBondsWithAbilities(
    userLayout.hand,
    userLayout.affirmedSeams,
  );
  const oppBonds = computeElementBondsWithAbilities(
    oppLayout.hand,
    oppLayout.affirmedSeams,
  );
  const userGroups = buildHandAttackGroupsWithAbilities(
    userLayout.hand,
    userBonds,
    userLayout.affirmedSeams,
  );
  const oppGroups = buildHandAttackGroupsWithAbilities(
    oppLayout.hand,
    oppBonds,
    oppLayout.affirmedSeams,
  );

  const userCatalogIds = userLayout.hand.map((c) => elementCatalogId(c.id));
  const oppCatalogIds = oppLayout.hand.map((c) => elementCatalogId(c.id));
  const userDefLayout = defenderLayoutMetrics(
    userLayout.hand,
    userLayout.affirmedSeams,
  );
  const oppDefLayout = defenderLayoutMetrics(
    oppLayout.hand,
    oppLayout.affirmedSeams,
  );

  let state = freshElementCombatState();
  const introMs = 1500;
  const userTimers = userGroups.map((g) => fireGroup(g, g.length, introMs));
  const oppTimers = oppGroups.map((g) => fireGroup(g, g.length, introMs));
  const cardPauseUntil: Record<string, number> = {};
  const freezeLast = { player: 0, cpu: 0 };
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

    const pollSide = (
      timers: GroupTimer[],
      groups: BrawlHandAttack[][],
      attackerIsPlayer: boolean,
      attackerCatalog: readonly string[],
      defenderLayout: DefenderLayoutMetrics,
    ) => {
      for (const g of timers) {
        if (t < g.nextFireAt) continue;
        const blocked = g.attacks.some(
          (a) => t < (cardPauseUntil[a.id] ?? 0),
        );
        if (blocked) continue;
        state = fireGroupAttack(
          state,
          g,
          attackerIsPlayer,
          attackerCatalog,
          defenderLayout,
        );
        noteFreezeApplied(
          state,
          freezeLast,
          userTimers,
          oppTimers,
          userGroups,
          oppGroups,
          cardPauseUntil,
          t,
        );
        const slot = brawlCardOverlayCooldownMs(g.length);
        g.nextFireAt = t + slot;
      }
    };

    pollSide(
      userTimers,
      userGroups,
      true,
      userCatalogIds,
      oppDefLayout,
    );
    pollSide(
      oppTimers,
      oppGroups,
      false,
      oppCatalogIds,
      userDefLayout,
    );

    if (state.playerHP <= 0 || state.cpuHP <= 0) break;
  }

  return {
    won: state.playerHP > 0 && state.cpuHP <= 0,
    combatMs: Math.min(t, MAX_COMBAT_MS),
    userHp: state.playerHP,
    oppHp: state.cpuHP,
    userSeams: userLayout.affirmedSeams.size,
    userBondPower: sumBondPower(userBonds),
    opponentClass,
    sandstorm,
  };
}

export function simulateBrawlGame(
  userClass: BrawlClass,
  seed: number,
): PlaytestGameResult {
  const oppClass = randomOpponentClass(userClass);
  const userRaw = dealBrawlElementHand(5, classPoolIds(userClass), seed);
  const oppRaw = dealBrawlElementHand(5, classPoolIds(oppClass), seed + 5000);
  const userOpt = optimizeElementHand(userRaw);
  const oppOpt = optimizeElementHand(oppRaw);
  return simulateBrawlCombat(
    { hand: userOpt.hand, affirmedSeams: userOpt.affirmedSeams },
    { hand: oppOpt.hand, affirmedSeams: oppOpt.affirmedSeams },
    oppClass,
  );
}

export function runClassPlaytest(
  userClass: BrawlClass,
  games: number = PLAYTEST_GAMES_PER_CLASS,
  seedBase = 9000,
): PlaytestGameResult[] {
  const results: PlaytestGameResult[] = [];
  for (let g = 0; g < games; g++) {
    results.push(simulateBrawlGame(userClass, seedBase + g * 9973));
  }
  return results;
}
