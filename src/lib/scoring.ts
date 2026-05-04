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
  // Card IDs whose effect should be NOOP'd this round (e.g. p-36 Ace's Command
  // nullifies the batter's highest card). Base value still counts; only the
  // ability is suppressed.
  nullifiedCardIds?: ReadonlySet<string>;
  /**
   * Resolved coin flips for cards that toss at lock-in (b-22 Power/Speed
   * Threat). Keyed by cardId. Empty / undefined during the live preview --
   * effects fall back to a deterministic average so the matchup pill stays
   * stable while the player is arranging cards.
   */
  coinFlips?: Record<string, "heads" | "tails">;

  // ============ Phase 6 game-state triggers ============
  /**
   * Bases occupancy at the start of THIS at-bat: [1B, 2B, 3B]. true means a
   * runner is on that base. Drives "RBI threat", "bases loaded", "bases empty"
   * style cards (b-91 RBI Threat, b-92 Grand Slam Threat, p-91 Bases Empty
   * Heat, p-92 Damage Control). Empty/undefined treated as bases empty.
   */
  bases?: readonly [boolean, boolean, boolean];
  /** Top vs bottom half of the inning. Drives b-96 Home Cookin'. */
  half?: "top" | "bottom";
  /**
   * Live home/away score going INTO this at-bat. Used together with `half` to
   * compute who is leading the game from each side's perspective. b-93 Walk-Off
   * Watch, b-94 Front-Runner, p-93 Save Situation read from this.
   */
  homeScore?: number;
  awayScore?: number;
}

/**
 * Phase 6 helper: returns the at-bat batter's team's score lead going into
 * this at-bat. Positive = batter's team is ahead; negative = behind; 0 = tied.
 * Falls back to 0 when the score / half hasn't been plumbed yet (engine works
 * before gameStore is initialized in tests).
 */
export function batterTeamLead(ctx: ScoringContext): number {
  const home = ctx.homeScore ?? 0;
  const away = ctx.awayScore ?? 0;
  // half="top" -> away team batting; half="bottom" -> home team batting.
  if (ctx.half === "bottom") return home - away;
  return away - home;
}

/** Phase 6 helper: total runners currently on base. */
export function runnersOnCount(ctx: ScoringContext): number {
  const b = ctx.bases;
  if (!b) return 0;
  return (b[0] ? 1 : 0) + (b[1] ? 1 : 0) + (b[2] ? 1 : 0);
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
  /**
   * Per-source attribution for opponent debuffs whose card descriptions name a
   * specific target (b-2 highest single, b-30 base card, p-52 highest, b-17
   * combined cards). Drives the reveal animator -- it can drop the named
   * opponent card's value visibly while the score pill ticks down. Aggregate
   * debuffs (p-38, p-72, p-60) are NOT listed here; they only appear in
   * `opponentModifier`. The deltas in this list still sum into
   * `opponentModifier` / `pitcherCombinedDelta`, so engine math is unchanged.
   */
  targetedOpponentDebuffs: Array<{
    sourceCardId: string;
    targetCardId: string;
    delta: number;
  }>;
  // Additive Hit-Scale-only bonus. On the BATTING side this pushes the batter
  // up the ladder; on the PITCHING side it raises the wall (lockIn subtracts it
  // from the batter's effective Hit Scale value). See cardEffects.EffectResult.
  hitScaleBonus: number;
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
  targetedOpponentDebuffs: [],
  hitScaleBonus: 0,
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
  let forcedOutcome: ScoringResult["forcedOutcome"];
  let pitcherWinsTies = false;
  let pitcherCombinedDelta = 0;
  let targetedOpponentDebuffs: ScoringResult["targetedOpponentDebuffs"] = [];
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
      forcedOutcome = groupResult.forcedOutcome;
      pitcherWinsTies = groupResult.pitcherWinsTies;
      pitcherCombinedDelta = groupResult.pitcherCombinedDelta;
      // Attribution mirrors the opponentModifier / pitcherCombinedDelta
      // contract: only the BEST group's effects fire, so only its targeted
      // debuffs survive into the public ScoringResult.
      targetedOpponentDebuffs = groupResult.targetedOpponentDebuffs;
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
    targetedOpponentDebuffs,
    hitScaleBonus,
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
  forcedOutcome?: ScoringResult["forcedOutcome"];
  pitcherWinsTies: boolean;
  pitcherCombinedDelta: number;
  cardModifiers: Record<string, CardModifier>;
  targetedOpponentDebuffs: ScoringResult["targetedOpponentDebuffs"];
  log: string[];
}

// Tailwind classes used to highlight card values when an effect modifies them.
// Buffs (positive selfValueDelta) keep the card's signature color; debuffs
// (negative selfValueDelta) get a clear red highlight regardless of which side
// the card belongs to.
const DEBUFF_HIGHLIGHT = "bg-red-500";

function scoreGroup(group: CardDefinition[], ctx: ScoringContext, hand: CardDefinition[]): GroupResult {
  const cardModifiers: Record<string, CardModifier> = {};
  let opponentModifier = 0;
  let hitScaleBonus = 0;
  let forcedOutcome: GroupResult["forcedOutcome"];
  let pitcherWinsTies = false;
  let pitcherCombinedDelta = 0;
  const targetedOpponentDebuffs: GroupResult["targetedOpponentDebuffs"] = [];
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
    // p-36 Ace's Command nullifies a single card by ID (ability off, base
    // value still counts). `card.disabled` is the round-level kill switch
    // spliced on by hand-transforms (b-23 Stolen Base Threat) -- it zeros the
    // baseValue too AND must NOOP the ability so the card is fully off.
    const isNullified =
      (ctx.nullifiedCardIds?.has(card.id) ?? false) || card.disabled === true;
    const effect: EffectResult = isNullified
      ? { selfValueDelta: 0, opponentValueDelta: 0, hitScaleBonus: 0, pitcherCombinedDelta: 0 }
      : applyCardEffect(card, effectCtx);
    const finalValue = card.baseValue + effect.selfValueDelta;
    let highlightColor: string | undefined;
    if (effect.selfValueDelta > 0) highlightColor = card.color;
    else if (effect.selfValueDelta < 0) highlightColor = DEBUFF_HIGHLIGHT;
    cardModifiers[card.id] = {
      value: finalValue,
      color: highlightColor,
    };
    opponentModifier += effect.opponentValueDelta;
    hitScaleBonus += effect.hitScaleBonus;
    pitcherCombinedDelta += effect.pitcherCombinedDelta;
    if (effect.pitcherWinsTies) pitcherWinsTies = true;
    if (effect.forcedOutcome && !forcedOutcome) forcedOutcome = effect.forcedOutcome;
    if (effect.log) log.push(...effect.log);

    // Attribution: a single source card can target the opponent in two ways.
    // (1) `opponentTargetCardId` names the card hit by `opponentValueDelta`.
    // (2) `pitcherCombinedDebuffs` is b-17's per-combined-card breakdown of
    //     the flat pitcherCombinedDelta. Both flow into the same animator
    //     stream so the reveal can drop each opponent card individually.
    if (effect.opponentTargetCardId && effect.opponentValueDelta !== 0) {
      targetedOpponentDebuffs.push({
        sourceCardId: card.id,
        targetCardId: effect.opponentTargetCardId,
        delta: effect.opponentValueDelta,
      });
    }
    if (effect.pitcherCombinedDebuffs) {
      for (const d of effect.pitcherCombinedDebuffs) {
        if (d.delta === 0) continue;
        targetedOpponentDebuffs.push({
          sourceCardId: card.id,
          targetCardId: d.targetCardId,
          delta: d.delta,
        });
      }
    }
  }

  const totalValue = Object.values(cardModifiers).reduce((acc, m) => acc + m.value, 0);

  return {
    totalValue,
    opponentModifier,
    hitScaleBonus,
    forcedOutcome,
    pitcherWinsTies,
    pitcherCombinedDelta,
    cardModifiers,
    targetedOpponentDebuffs,
    log,
  };
}

/**
 * Hit Scale resolution. Mirrors the spec: 5-9 Single, 10-14 Double, 15-19 Triple, 20+ HR.
 *
 * Cards no longer use a "tier shift" abstraction. Instead, they emit additive
 * `hitScaleBonus` values which the caller folds into `score` before calling
 * this function. That keeps the ladder math monotonic in both directions and
 * lets a debuff like p-33 The Mustache push the batter DOWN the ladder.
 */
export type HitOutcome = "out" | "single" | "double" | "triple" | "homerun";

export function resolveHitScale(score: number): HitOutcome {
  if (score >= 20) return "homerun";
  if (score >= 15) return "triple";
  if (score >= 10) return "double";
  if (score >= 5) return "single";
  return "out";
}
