import { CardDefinition } from "./cards";
import { canConnect } from "./connect";
import { applyCardEffect, applyOpponentTotalAdjustments, EffectContext, EffectResult } from "./cardEffects";

export interface ScoringContext {
  // Whose hand is being scored ('Batting' or 'Pitching').
  side: "Batting" | "Pitching";
  // Game state used by various card effects. All fields are optional so the
  // engine works before the Phase 4 game-state store is wired up.
  inning?: number;
  isFirstAtBatOfInning?: boolean;
  outs?: number;
  isFinalInning?: boolean;
  // Handedness of the at-bat batter, used by p-37 Cy Young Heat.
  batterHandedness?: "L" | "R" | "S";
  // Opposing player's hand (only the lock-in resolution needs this).
  opponentHand?: CardDefinition[];
  // Opposing player's locked base card (the highest-value or selected card).
  opponentBaseCard?: CardDefinition | null;
}

export interface CardModifier {
  // Final per-card value used in the per-card sum (after own bonuses).
  value: number;
  // Tailwind text color class to highlight modified cards. Optional.
  color?: string;
}

export interface ScoringResult {
  // Cards split into consecutive connection groups.
  groups: CardDefinition[][];
  // The best (highest-value) group that drives the play.
  bestGroup: CardDefinition[];
  // Best group's total value.
  maxValue: number;
  // Modifier applied to the OPPONENT's total (negative = debuff).
  opponentModifier: number;
  // Per-card display modifiers, keyed by card id.
  cardModifiers: Record<string, CardModifier>;
  // Hit-scale-only bonus that should not affect the head-to-head total.
  hitScaleBonus: number;
  // Flat hit-scale outcome upgrade in tiers (e.g. 50/50 Club +5 -> upgrade tier).
  hitScaleTierShift: number;
  // If set, the play resolves as an automatic outcome regardless of score comparison.
  forcedOutcome?: "single" | "homerun";
  // Whether ties go to the pitcher (set by p-48 Lights Out, p-80 Umpire's Call).
  pitcherWinsTies: boolean;
  // Whether the pitcher's combined values are reduced (by b-17 Line Drive).
  pitcherCombinedDelta: number;
  // Soft "hint" debug log for development; not displayed.
  log: string[];
}

const EMPTY_RESULT: ScoringResult = {
  groups: [],
  bestGroup: [],
  maxValue: 0,
  opponentModifier: 0,
  cardModifiers: {},
  hitScaleBonus: 0,
  hitScaleTierShift: 0,
  pitcherWinsTies: false,
  pitcherCombinedDelta: 0,
  log: [],
};

/**
 * Pure scoring function. Splits the hand into connection groups, applies each
 * card's effect via the registry, picks the highest-scoring group, and returns
 * everything the UI needs to render the play.
 */
export function scoreHand(cards: CardDefinition[], ctx: ScoringContext): ScoringResult {
  if (!cards || cards.length === 0) return EMPTY_RESULT;

  const groups = buildGroups(cards);

  let bestGroup: CardDefinition[] = [];
  let maxValue = 0;
  let opponentModifier = 0;
  let hitScaleBonus = 0;
  let hitScaleTierShift = 0;
  let forcedOutcome: ScoringResult["forcedOutcome"];
  let pitcherWinsTies = false;
  let pitcherCombinedDelta = 0;
  const cardModifiers: Record<string, CardModifier> = {};
  const log: string[] = [];

  for (const group of groups) {
    const groupResult = scoreGroup(group, ctx, cards);

    Object.assign(cardModifiers, groupResult.cardModifiers);

    if (groupResult.totalValue > maxValue || bestGroup.length === 0) {
      maxValue = groupResult.totalValue;
      bestGroup = group;
      opponentModifier = groupResult.opponentModifier;
      hitScaleBonus = groupResult.hitScaleBonus;
      hitScaleTierShift = groupResult.hitScaleTierShift;
      forcedOutcome = groupResult.forcedOutcome;
      pitcherWinsTies = groupResult.pitcherWinsTies;
      pitcherCombinedDelta = groupResult.pitcherCombinedDelta;
    }

    log.push(...groupResult.log);
  }

  // Per-hand effects that adjust the opponent total based on the WHOLE hand
  // (e.g. Filthy Stuff -1 per card the batter plays). These run regardless of
  // which group ended up best.
  const handAdjust = applyOpponentTotalAdjustments(cards, ctx);
  opponentModifier += handAdjust.opponentModifier;
  pitcherCombinedDelta += handAdjust.pitcherCombinedDelta;
  if (handAdjust.pitcherWinsTies) pitcherWinsTies = true;
  log.push(...handAdjust.log);

  return {
    groups,
    bestGroup,
    maxValue,
    opponentModifier,
    cardModifiers,
    hitScaleBonus,
    hitScaleTierShift,
    forcedOutcome,
    pitcherWinsTies,
    pitcherCombinedDelta,
    log,
  };
}

function buildGroups(cards: CardDefinition[]): CardDefinition[][] {
  const groups: CardDefinition[][] = [];
  if (cards.length === 0) return groups;

  let current: CardDefinition[] = [cards[0]];
  for (let i = 1; i < cards.length; i++) {
    if (canConnect(cards[i - 1], cards[i])) {
      current.push(cards[i]);
    } else {
      groups.push(current);
      current = [cards[i]];
    }
  }
  groups.push(current);
  return groups;
}

interface GroupResult {
  totalValue: number;
  opponentModifier: number;
  hitScaleBonus: number;
  hitScaleTierShift: number;
  forcedOutcome?: ScoringResult["forcedOutcome"];
  pitcherWinsTies: boolean;
  pitcherCombinedDelta: number;
  cardModifiers: Record<string, CardModifier>;
  log: string[];
}

function scoreGroup(group: CardDefinition[], ctx: ScoringContext, hand: CardDefinition[]): GroupResult {
  const cardModifiers: Record<string, CardModifier> = {};
  let opponentModifier = 0;
  let hitScaleBonus = 0;
  let hitScaleTierShift = 0;
  let forcedOutcome: GroupResult["forcedOutcome"];
  let pitcherWinsTies = false;
  let pitcherCombinedDelta = 0;
  const log: string[] = [];

  const isCombined = group.length > 1;

  for (let i = 0; i < group.length; i++) {
    const card = group[i];
    const effectCtx: EffectContext = {
      ...ctx,
      hand,
      group,
      indexInGroup: i,
      isCombined,
    };
    const effect: EffectResult = applyCardEffect(card, effectCtx);
    const finalValue = card.baseValue + effect.selfValueDelta;
    cardModifiers[card.id] = {
      value: finalValue,
      color: effect.selfValueDelta !== 0 ? card.color : undefined,
    };
    opponentModifier += effect.opponentValueDelta;
    hitScaleBonus += effect.hitScaleBonus;
    hitScaleTierShift += effect.hitScaleTierShift;
    pitcherCombinedDelta += effect.pitcherCombinedDelta;
    if (effect.pitcherWinsTies) pitcherWinsTies = true;
    if (effect.forcedOutcome && !forcedOutcome) forcedOutcome = effect.forcedOutcome;
    if (effect.log) log.push(...effect.log);
  }

  const totalValue = Object.values(cardModifiers).reduce((acc, m) => acc + m.value, 0);

  return {
    totalValue,
    opponentModifier,
    hitScaleBonus,
    hitScaleTierShift,
    forcedOutcome,
    pitcherWinsTies,
    pitcherCombinedDelta,
    cardModifiers,
    log,
  };
}

/**
 * Hit Scale resolution. Mirrors the spec: 5-9 Single, 10-14 Double, 15-19 Triple, 20+ HR.
 * `tierShift` lets cards bump the tier (e.g. 50/50 Club +5 -> upgrade one tier).
 */
export type HitOutcome = "out" | "single" | "double" | "triple" | "homerun";

export function resolveHitScale(score: number, tierShift = 0): HitOutcome {
  let tier: HitOutcome = "out";
  if (score >= 20) tier = "homerun";
  else if (score >= 15) tier = "triple";
  else if (score >= 10) tier = "double";
  else if (score >= 5) tier = "single";

  if (tierShift > 0) {
    const ladder: HitOutcome[] = ["out", "single", "double", "triple", "homerun"];
    const stepsToShift = Math.floor(tierShift / 5);
    const idx = Math.min(ladder.length - 1, ladder.indexOf(tier) + stepsToShift);
    tier = ladder[idx];
  }
  return tier;
}
