import { CardDefinition, TagLiteral } from "./cards";
import { ShapeType } from "../components/cardShapes";
import { canConnect, seamKey } from "./connect";
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
  /**
   * Handedness of the active pitcher. Lives on the MlbPlayer record (not on
   * the card), so the gameStore plumbs it through here for batter-side cards
   * that key off the pitcher's hand: b-126 Lefty Mash (vs RHP), b-128
   * Switch-Cap (already reads tags) etc.
   */
  pitcherHandedness?: "L" | "R" | "S";
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

  /**
   * User-affirmed connections, keyed by `seamKey(idA, idB)`. When provided,
   * `buildGroups` ONLY chains adjacent cards whose seam is BOTH mechanically
   * connectable (`canConnect`) AND in this set -- the user must explicitly
   * forge a connection by dragging one card next to another for it to score
   * as a chain.
   *
   * Undefined / null = legacy auto-connect: every mechanically-connectable
   * adjacent pair chains. The pitcher hand uses this mode (the AI doesn't
   * drag), as do all engine tests written before user agency existed.
   */
  affirmedSeams?: ReadonlySet<string> | null;

  /**
   * The OPPONENT side's affirmed seams -- used by effect helpers that need
   * to inspect the opponent's combo state (e.g. p-50 The Sweep counting the
   * opponent's longest chain, b-127 Mr. Smile silencing an uncombined
   * pitcher card). When the user is on side X, the opponent (AI) always
   * uses null/auto-connect; when the user is on the opposite side, the
   * opponent IS the user and this field carries the user's seams so
   * combo-aware effects agree with how scoring would group that hand.
   *
   * Without this, helpers that called `buildGroupsFor(opponentHand)` saw a
   * different chain layout than scoring would, and side X effects keyed off
   * "is the opponent's b-foo combined?" silently disagreed with reality.
   */
  opponentAffirmedSeams?: ReadonlySet<string> | null;

  // ============ Phase 7 batter-expansion fields ============
  /**
   * b-105 Atlanta-LA Ring -- when set, the opponent's base card's per-card
   * ability is treated as no-op (its base value still counts). Symmetric with
   * `nullifiedCardIds` but indexed by "whichever card the opponent picks as
   * base", which lockIn resolves at scoring time so b-105 doesn't have to
   * peek into the pitcher's bestGroup ahead of time.
   */
  nullifyOpponentBaseMechanic?: boolean;
  /**
   * b-108 DH Threat -- list of tags whose carriers in the opponent hand have
   * their abilities suppressed this round. Mirrors `nullifiedCardIds` but
   * targeted by tag rather than by id, so `b-108: ["off-speed"]` silences
   * every off-speed pitch the pitcher plays.
   *
   * Note: b-132 Champion's Heart reads runs from existing `homeScore`/
   * `awayScore`/`half` and doesn't need a dedicated field.
   */
  nullifyOpponentTagMechanics?: ReadonlyArray<TagLiteral>;
}

/**
 * Phase 7 helper: number of Runs the BATTER'S TEAM has scored this game,
 * derived from the cumulative score going into this at-bat. Drives b-132
 * Champion's Heart. Mirrors `batterTeamLead` -- "top" half = away batting,
 * "bottom" half = home batting. Falls back to 0 when score isn't plumbed
 * (engine works before gameStore is initialized in tests).
 */
export function batterTeamRunsThisGame(ctx: ScoringContext): number {
  if (ctx.half === "bottom") return ctx.homeScore ?? 0;
  return ctx.awayScore ?? 0;
}

/**
 * Local helper: highest-baseValue card (or undefined for empty hand).
 * Tie-breaker: lexicographically smallest card id, so reordering the hand
 * doesn't change which card "wins" the tie.
 */
function highestValueCard(cards: CardDefinition[]): CardDefinition | undefined {
  if (cards.length === 0) return undefined;
  return cards.reduce((a, b) => {
    if (b.baseValue > a.baseValue) return b;
    if (b.baseValue === a.baseValue && b.id < a.id) return b;
    return a;
  });
}

/**
 * Phase 7 helper: number of distinct shapes appearing on any card in the hand
 * (left or right side). Drives b-112 Switch Slasher. Wildcards count as their
 * own "shape" -- they appear on the card visually as a unique slot, so the
 * batter who plays a wildcard alongside a circle/diamond/star/square gets
 * credit for the wildcard slot too.
 */
export function uniqueShapeCount(hand: CardDefinition[]): number {
  const seen = new Set<ShapeType>();
  for (const c of hand) {
    seen.add(c.leftShape);
    seen.add(c.rightShape);
  }
  return seen.size;
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

  const groups = buildGroups(cards, ctx.affirmedSeams ?? null);

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

  // Tie-break ordering when two groups end up with the same `totalValue`.
  // Previously the engine kept the FIRST group it saw (strict `>`), which
  // discarded ancillary effects (hitScaleBonus, opponentModifier, forced
  // outcomes) of any equally-strong group encountered later. The explicit
  // ordering below picks the chain that's strictly more useful at the same
  // value -- larger Hit Scale bonus first, then bigger opponent debuff,
  // then a stronger forced outcome (homerun > single), then the longer
  // chain (more visible "best combo" attribution), then the leftmost
  // chain as a deterministic fallback.
  const FORCED_RANK: Record<NonNullable<ScoringResult["forcedOutcome"]>, number> = {
    homerun: 2,
    single: 1,
  };
  let bestRank: {
    totalValue: number;
    hitScaleBonus: number;
    opponentDebuff: number;
    forcedRank: number;
    length: number;
  } | null = null;

  for (const group of groups) {
    const groupResult = scoreGroup(group, ctx, cards);

    Object.assign(cardModifiers, groupResult.cardModifiers);

    const candidate = {
      totalValue: groupResult.totalValue,
      hitScaleBonus: groupResult.hitScaleBonus,
      // opponentModifier is signed (negative = bigger debuff = better).
      // Compare on the magnitude of damage to the opponent.
      opponentDebuff: -groupResult.opponentModifier,
      forcedRank: groupResult.forcedOutcome ? FORCED_RANK[groupResult.forcedOutcome] : 0,
      length: group.length,
    };

    const beats =
      bestRank === null ||
      candidate.totalValue > bestRank.totalValue ||
      (candidate.totalValue === bestRank.totalValue && candidate.hitScaleBonus > bestRank.hitScaleBonus) ||
      (candidate.totalValue === bestRank.totalValue &&
        candidate.hitScaleBonus === bestRank.hitScaleBonus &&
        candidate.opponentDebuff > bestRank.opponentDebuff) ||
      (candidate.totalValue === bestRank.totalValue &&
        candidate.hitScaleBonus === bestRank.hitScaleBonus &&
        candidate.opponentDebuff === bestRank.opponentDebuff &&
        candidate.forcedRank > bestRank.forcedRank) ||
      (candidate.totalValue === bestRank.totalValue &&
        candidate.hitScaleBonus === bestRank.hitScaleBonus &&
        candidate.opponentDebuff === bestRank.opponentDebuff &&
        candidate.forcedRank === bestRank.forcedRank &&
        candidate.length > bestRank.length);

    if (beats) {
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
      bestRank = candidate;
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

/**
 * Build connection groups by walking adjacent pairs and checking BOTH:
 *   1. `canConnect(prev, curr)` -- the mechanic still has to allow it (shape
 *      / wildcard / `noCombine` rules).
 *   2. The user has affirmed this seam, when `affirmedSeams` is provided.
 *
 * `affirmedSeams === null` falls back to legacy auto-connect (any
 * mechanically-eligible adjacent pair chains). This is what the pitcher hand
 * uses and what the engine tests assume by default.
 */
export function buildGroups(
  cards: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): CardDefinition[][] {
  const groups: CardDefinition[][] = [];
  if (cards.length === 0) return groups;

  let current: CardDefinition[] = [cards[0]];
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1];
    const curr = cards[i];
    const mechConnect = canConnect(prev, curr);
    const userAffirmed =
      affirmedSeams === null ? true : affirmedSeams.has(seamKey(prev.id, curr.id));
    if (mechConnect && userAffirmed) {
      current.push(curr);
    } else {
      groups.push(current);
      current = [curr];
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

  // The "self base card" of the hand currently being scored. b-105
  // Atlanta-LA Ring sets `nullifyOpponentBaseMechanic` from the BATTER side --
  // when that flag is on while we're scoring the PITCHER hand, the targeted
  // card is the pitcher's own highest-value card (its base from the batter's
  // POV). Computing it from `hand` keeps the silencer self-contained: the
  // batter doesn't have to peek at the pitcher's bestGroup to figure out
  // which card to nullify.
  const selfBaseCard = highestValueCard(hand);

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
    //
    // Phase 7 additions:
    //  - `nullifyOpponentBaseMechanic` (b-105 Atlanta-LA Ring) suppresses the
    //    opponent's BASE card mechanic. Only flagged when scoring the opponent
    //    hand whose base matches `ctx.opponentBaseCard`.
    //  - `nullifyOpponentTagMechanics` (b-108 DH Threat) suppresses every
    //    opponent card whose tags overlap with the listed tags. Same shape as
    //    `nullifiedCardIds` but tag-indexed.
    const baseSilenced =
      ctx.nullifyOpponentBaseMechanic === true &&
      !!selfBaseCard &&
      selfBaseCard.id === card.id;
    const tagSilenced =
      (ctx.nullifyOpponentTagMechanics?.length ?? 0) > 0 &&
      (card.tags?.some((t) => ctx.nullifyOpponentTagMechanics!.includes(t)) ?? false);
    const isNullified =
      (ctx.nullifiedCardIds?.has(card.id) ?? false) ||
      card.disabled === true ||
      baseSilenced ||
      tagSilenced;
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
    // forcedOutcome precedence: when two cards in the same group both want
    // to force, prefer the stronger result (homerun > single) instead of
    // taking whichever appeared first in iteration order. Equal-strength
    // duplicates fall through to the existing first-wins behavior.
    if (effect.forcedOutcome) {
      const existingRank = forcedOutcome === "homerun" ? 2 : forcedOutcome === "single" ? 1 : 0;
      const incomingRank = effect.forcedOutcome === "homerun" ? 2 : 1;
      if (incomingRank > existingRank) forcedOutcome = effect.forcedOutcome;
    }
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
