import { CardDefinition, TagLiteral } from "./cards";
import { isAbilityCard, isValueCard } from "./cardModel";
import { ITEMS } from "./items";
import { ShapeType } from "../components/cardShapes";
import { canConnect, canConnectAny, seamKey } from "./connect";
import { applyCardEffect, applyOpponentTotalAdjustments, EffectContext, EffectResult, highestValueCard } from "./cardEffects";
import { canSznSnap, type SznEdgeId } from "./sznEdges";
import {
  applySznItemGroupEdgeMutations,
  applySznItemGroupScoringEffects,
  applySznItemSnapPairEffects,
} from "./sznItemEffects";
import { TIER_MULTIPLIER, type ItemTier } from "./itemTiers";

/**
 * One semantic-edge snap event captured while scoring a chain. Emitted
 * whenever two adjacent cards in the best group both carry SZN edges
 * that connect via {@link canSznSnap}. Consumed by the matchup
 * pipeline in `gameStore.computeMatchup` to feed badge triggers
 * (e.g. Bronx Bombers +10 / +$1 on Power), Speed multipliers, the
 * Battery bridge bonus, Deception RNG, and Movement debuff stacking.
 */
export interface SznSnapEvent {
  leftCardId: string;
  rightCardId: string;
  /** Edge id the two cards matched on (either side's edge after canSznSnap). */
  edge: SznEdgeId;
  /** True if `wildcard` was involved on either side (no specific edge bonus). */
  wildcard: boolean;
}

export interface ScoringContext {
  // Whose hand is being scored ('Batting' or 'Pitching').
  side: "Batting" | "Pitching";
  // Game state used by various card effects. All fields are optional so the
  // engine works before the Phase 4 game-state store is wired up.
  inning?: number;
  isFirstAtBatOfInning?: boolean;
  outs?: number;
  isFinalInning?: boolean;
  /**
   * Game mode the at-bat is being scored under. Currently used by Brawl
   * Mode to remap effects whose original semantics don't fit the 15s
   * snap timer or the HP-only resolution path -- e.g. Hit Scale cards
   * (b-6 / b-18 / b-116 / b-117 / b-128 / b-134 / p-33) get a flat HP
   * bonus instead of an irrelevant hit-ladder push, and coin-flip cards
   * (b-22) settle on their average automatically. Undefined in tests
   * and the standard game so the legacy effects remain untouched.
   */
  gameMode?: "draft" | "quick-match" | "szn" | "brawl";
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

  /**
   * In-game quest reward applied once on the batting hand's Hit Scale ladder.
   */
  questHitScaleBonus?: number;

  /**
   * Manager's-hand item cards equipped onto roster card IDs (draft/quick-match
   * lane). Each key is a card id; values are item ids from `ITEMS`.
   */
  equippedItems?: Record<string, string[]>;

  /**
   * SZN Encounter #7 Rally Fire aura. When true, every card immediately
   * adjacent (in the same scoring group) to a card carrying the
   * synthetic `team-logo` edge gets a +10% boost. Plumbed in from the
   * gameStore when `run.rallyFireWeeksLeft > 0`.
   */
  sznRallyFireActive?: boolean;

  /**
   * SZN player-ability speed multiplier override. When set, replaces the
   * default 1.25x speed-edge multiplier with the larger value. Driven by
   * abilities like Jazz Chisholm Jr.'s "Jazz" or Trea Turner's "Triple
   * Threat" (both speedMultiplier: 1.5). Falls through to the default
   * when undefined or smaller than 1.25.
   */
  sznSpeedMultiplierBonus?: number;

  /**
   * SZN player-ability chain-length forgiveness. Added to the group's
   * length when scoring checks `requireChainLength` so a card that
   * requires a 5-chain to fire considers the chain as longer than it
   * actually is. Driven by Aaron Judge's "62" and Max Scherzer's
   * "Future HOF" (both +1).
   */
  sznChainLengthForgiveness?: number;
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
  /**
   * SZN-only: semantic edge snaps that occurred inside `bestGroup`. The
   * matchup layer uses these to fire passive badges and the rolling
   * Yankees edge effects (Speed multiplier is applied inline in
   * `scoreGroup`; the rest fire at matchup-resolution time).
   */
  sznSnapEvents?: SznSnapEvent[];
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
  sznSnapEvents: [],
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
  type GroupRank = {
    totalValue: number;
    hitScaleBonus: number;
    opponentDebuff: number;
    forcedRank: number;
    length: number;
  };

  const groupRankBeats = (candidate: GroupRank, best: GroupRank | null): boolean =>
    best === null ||
    candidate.totalValue > best.totalValue ||
    (candidate.totalValue === best.totalValue && candidate.hitScaleBonus > best.hitScaleBonus) ||
    (candidate.totalValue === best.totalValue &&
      candidate.hitScaleBonus === best.hitScaleBonus &&
      candidate.opponentDebuff > best.opponentDebuff) ||
    (candidate.totalValue === best.totalValue &&
      candidate.hitScaleBonus === best.hitScaleBonus &&
      candidate.opponentDebuff === best.opponentDebuff &&
      candidate.forcedRank > best.forcedRank) ||
    (candidate.totalValue === best.totalValue &&
      candidate.hitScaleBonus === best.hitScaleBonus &&
      candidate.opponentDebuff === best.opponentDebuff &&
      candidate.forcedRank === best.forcedRank &&
      candidate.length > best.length);

  type ScoredGroup = {
    group: CardDefinition[];
    result: GroupResult;
    rank: GroupRank;
  };

  const scored: ScoredGroup[] = [];

  for (const group of groups) {
    const groupResult = scoreGroup(group, ctx, cards);

    Object.assign(cardModifiers, groupResult.cardModifiers);

    scored.push({
      group,
      result: groupResult,
      rank: {
        totalValue: groupResult.totalValue,
        hitScaleBonus: groupResult.hitScaleBonus,
        // opponentModifier is signed (negative = bigger debuff = better).
        // Compare on the magnitude of damage to the opponent.
        opponentDebuff: -groupResult.opponentModifier,
        forcedRank: groupResult.forcedOutcome ? FORCED_RANK[groupResult.forcedOutcome] : 0,
        length: group.length,
      },
    });

    log.push(...groupResult.log);
  }

  const pickBest = (candidates: ScoredGroup[]): ScoredGroup | null => {
    if (candidates.length === 0) return null;
    return candidates.reduce((best, cur) =>
      groupRankBeats(cur.rank, best.rank) ? cur : best,
    );
  };

  // Brawl manual-chain seats: once the player has snapped a multi-card
  // chain, score against THAT chain instead of a higher solo card. The
  // pill, card faces, and chain-length bonus all key off `bestGroup`, so
  // letting a lone card steal the group made snapped chains look inert.
  let winner = pickBest(scored);
  if (ctx.gameMode === "brawl" && ctx.affirmedSeams != null) {
    const chained = scored.filter((entry) => entry.group.length >= 2);
    const chainedWinner = pickBest(chained);
    if (chainedWinner) winner = chainedWinner;
  }

  if (winner) {
    maxValue = winner.result.totalValue;
    bestGroup = winner.group;
    opponentModifier = winner.result.opponentModifier;
    hitScaleBonus = winner.result.hitScaleBonus;
    forcedOutcome = winner.result.forcedOutcome;
    pitcherWinsTies = winner.result.pitcherWinsTies;
    pitcherCombinedDelta = winner.result.pitcherCombinedDelta;
    // Attribution mirrors the opponentModifier / pitcherCombinedDelta
    // contract: only the BEST group's effects fire, so only its targeted
    // debuffs survive into the public ScoringResult.
    targetedOpponentDebuffs = winner.result.targetedOpponentDebuffs;
  }

  // Per-hand effects that adjust the opponent total based on the WHOLE hand
  // (e.g. Filthy Stuff -1 per card the batter plays). These run regardless of
  // which group ended up best.
  const handAdjust = applyOpponentTotalAdjustments(cards, ctx);
  opponentModifier += handAdjust.opponentModifier;
  pitcherCombinedDelta += handAdjust.pitcherCombinedDelta;
  if (handAdjust.pitcherWinsTies) pitcherWinsTies = true;
  log.push(...handAdjust.log);

  if (ctx.side === "Batting" && ctx.questHitScaleBonus) {
    hitScaleBonus += ctx.questHitScaleBonus;
  }

  const sznSnapEvents = collectSnapEvents(bestGroup);

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
    sznSnapEvents,
  };
}

/**
 * Walk the winning chain and emit one {@link SznSnapEvent} per adjacent
 * pair where both sides carry SZN semantic edges that {@link canSznSnap}
 * accepts. Wildcard snaps still emit (with `wildcard: true`) so badges
 * can choose whether to fire on them (Bronx Bombers does not).
 */
function collectSnapEvents(group: CardDefinition[]): SznSnapEvent[] {
  if (group.length < 2) return [];
  const events: SznSnapEvent[] = [];
  for (let i = 1; i < group.length; i++) {
    const left = group[i - 1];
    const right = group[i];
    const lEdge = left.sznRightEdge as SznEdgeId | undefined;
    const rEdge = right.sznLeftEdge as SznEdgeId | undefined;
    if (!lEdge || !rEdge) continue;
    if (!canSznSnap(lEdge, rEdge)) continue;
    const wildcard = lEdge === "wildcard" || rEdge === "wildcard";
    // Pick the non-wildcard side as the canonical matched edge when one
    // side is wildcard; same-id snaps keep that id verbatim.
    const edge: SznEdgeId =
      lEdge === rEdge
        ? lEdge
        : lEdge === "wildcard"
          ? rEdge
          : rEdge === "wildcard"
            ? lEdge
            : lEdge;
    events.push({
      leftCardId: left.id,
      rightCardId: right.id,
      edge,
      wildcard,
    });
  }
  return events;
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
    const mechConnect = canConnectAny(prev, curr);
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

function scoreGroup(rawGroup: CardDefinition[], ctx: ScoringContext, hand: CardDefinition[]): GroupResult {
  // ---- SZN item edge mutations ----------------------------------------
  // Edge-copy items (Classic Spikes, The Torch) rewrite their own
  // sznLeftEdge/sznRightEdge to mirror an adjacent partner's edge.
  // Doing this BEFORE the per-card scoring loop AND before
  // `collectSnapEvents` (which runs on the resolved bestGroup later)
  // means the downstream engine -- per-card effects that key off
  // edges, snap-event emission, and the speed multiplier loop below
  // -- all see the projected edges as if they were the card's
  // printed edges. The mutation is a SHALLOW clone of the affected
  // item cards; non-item cards are referenced verbatim so we don't
  // bloat the per-group allocation.
  const group = applySznItemGroupEdgeMutations(rawGroup);

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
    // requireChainLength is a per-card hard floor: when the card sits in a
    // chain shorter than its required length, both its baseValue and its
    // effect zero out for the round. Treated identically to `disabled` from
    // the engine's POV (NOOP effect, zero contribution to totalValue).
    //
    // SZN player abilities (Judge's "62", Scherzer's "Future HOF") can
    // contribute a chain-length forgiveness bonus that makes the chain
    // count as if it were N cards longer for THIS check only.
    const chainLengthRequirement = card.combineConstraint?.requireChainLength;
    const effectiveChainLength = group.length + (ctx.sznChainLengthForgiveness ?? 0);
    const chainTooShort =
      typeof chainLengthRequirement === "number" &&
      effectiveChainLength < chainLengthRequirement;
    const isNullified =
      (ctx.nullifiedCardIds?.has(card.id) ?? false) ||
      card.disabled === true ||
      baseSilenced ||
      tagSilenced ||
      chainTooShort;

    const effect: EffectResult =
      isNullified || isValueCard(card)
        ? { selfValueDelta: 0, opponentValueDelta: 0, hitScaleBonus: 0, pitcherCombinedDelta: 0 }
        : applyCardEffect(card, effectCtx);
    // chainTooShort zeros the baseValue too (mirrors `disabled` semantics).
    
    let itemValueBonus = 0;
    if (ctx.equippedItems?.[card.id]) {
      for (const itemId of ctx.equippedItems[card.id]) {
        const item = ITEMS[itemId];
        if (item?.valueModifier) itemValueBonus += item.valueModifier;
        if (item?.hitScaleModifier) hitScaleBonus += item.hitScaleModifier;
      }
    }
    // Bazaar tier scaling: bag items dealt at silver / gold scale BOTH
    // their printed baseValue and their per-card effect's selfValueDelta
    // by TIER_MULTIPLIER. Items only -- non-item cards (player anchors,
    // legacy ability cards) have no sznItemTier stamp and fall through
    // to the bronze (1.0x) passthrough. Binary effects (Sticky Stuff's
    // suspend chance, Platinum Glove's stack count) scale inside the
    // hook itself in `sznItemEffects.ts` so the value scaling here
    // doesn't double-dip.
    const tier = (card.sznItemTier as ItemTier | undefined) ?? "bronze";
    const tierMul = TIER_MULTIPLIER[tier];
    const scaledBase =
      isValueCard(card) && !chainTooShort
        ? tier === "bronze"
          ? card.baseValue
          : Math.round(card.baseValue * tierMul)
        : 0;
    const scaledDelta =
      isAbilityCard(card) && !chainTooShort
        ? tier === "bronze"
          ? effect.selfValueDelta
          : Math.round(effect.selfValueDelta * tierMul)
        : 0;
    const finalValue = chainTooShort ? 0 : scaledBase + scaledDelta + itemValueBonus;

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

  // ---- SZN Speed edge multiplier --------------------------------------
  // The Speed semantic edge "acts as a multiplier for the next card in
  // the chain". When card[i-1].rightEdge resolves to `speed` AND the
  // SZN snap engine accepts the pair, bump card[i]'s contribution by
  // 1.25x. We do this here instead of inline above so the multiplier
  // applies to the FINAL value (including item bonuses + effect deltas)
  // rather than just the printed baseValue.
  //
  // Player abilities (Jazz Chisholm Jr.'s "Jazz", Trea Turner's
  // "Triple Threat") can declare a `speedMultiplier` effect that
  // overrides the 1.25 default with a larger value. The gameStore
  // plumbs the max into ctx.sznSpeedMultiplierBonus.
  if (group.length >= 2) {
    const speedMul = Math.max(1.25, ctx.sznSpeedMultiplierBonus ?? 1.25);
    for (let i = 1; i < group.length; i++) {
      const left = group[i - 1];
      const right = group[i];
      const lEdge = left.sznRightEdge as SznEdgeId | undefined;
      const rEdge = right.sznLeftEdge as SznEdgeId | undefined;
      if (!lEdge || !rEdge) continue;
      if (lEdge !== "speed") continue;
      if (!canSznSnap(lEdge, rEdge)) continue;
      const mod = cardModifiers[right.id];
      if (!mod) continue;
      const boosted = Math.round(mod.value * speedMul);
      cardModifiers[right.id] = { ...mod, value: boosted };
    }
  }

  // ---- SZN Rally Fire aura --------------------------------------------
  // Encounter #7 Rally Fire: while the run flag is on, every card
  // adjacent (in this group) to one carrying a `team-logo` edge on
  // either side gets a flat +10% boost on its current contribution.
  // We round-down so a 50-score card becomes 55 rather than 56 (keeps
  // the aura modest enough to NOT instantly trivialize a chain).
  if (ctx.sznRallyFireActive && group.length >= 2) {
    const isRally = (c: CardDefinition) =>
      (c.sznLeftEdge as SznEdgeId | undefined) === "team-logo" ||
      (c.sznRightEdge as SznEdgeId | undefined) === "team-logo";
    for (let i = 0; i < group.length; i++) {
      const here = group[i];
      const left = i > 0 ? group[i - 1] : null;
      const right = i < group.length - 1 ? group[i + 1] : null;
      const auraNeighbors = (left && isRally(left) ? 1 : 0) + (right && isRally(right) ? 1 : 0);
      if (auraNeighbors === 0) continue;
      if (isRally(here)) continue; // don't aura-boost the rally card itself
      const mod = cardModifiers[here.id];
      if (!mod) continue;
      // +10% per adjacent team-logo card; stacks if both sides have one.
      const factor = 1 + 0.1 * auraNeighbors;
      cardModifiers[here.id] = { ...mod, value: Math.floor(mod.value * factor) };
    }
  }

  // ---- SZN Mega-Card merge --------------------------------------------
  // Encounter #4 Mega-Card: when both halves (enc-mega-left and
  // enc-mega-right) live in the same group AND their `mega-seam` edges
  // sit adjacent (canSznSnap("mega-seam","mega-seam") === true), they
  // collapse into a single synthetic 500-score hero card.
  //
  // We don't synthesize a CardDefinition here -- the renderer will
  // detect both halves in the rendered hand and overlay the merged
  // visual itself. From scoring's POV we just zero each half's
  // contribution and route the +500 onto one of them so the totalValue
  // stays honest and the per-card modifier readout shows where the
  // points came from.
  for (let i = 1; i < group.length; i++) {
    const left = group[i - 1];
    const right = group[i];
    const isLeftHalf = left.id === "enc-mega-left" && right.id === "enc-mega-right";
    const isRightHalf = left.id === "enc-mega-right" && right.id === "enc-mega-left";
    if (!isLeftHalf && !isRightHalf) continue;
    const lEdge = left.sznRightEdge as SznEdgeId | undefined;
    const rEdge = right.sznLeftEdge as SznEdgeId | undefined;
    if (!lEdge || !rEdge) continue;
    if (!canSznSnap(lEdge, rEdge)) continue;
    cardModifiers[left.id] = { ...(cardModifiers[left.id] ?? { value: 0 }), value: 250 };
    cardModifiers[right.id] = { ...(cardModifiers[right.id] ?? { value: 0 }), value: 250 };
  }

  // ---- SZN item snap-pair score modifiers ------------------------------
  // Runs AFTER per-card effects, Speed multiplier, Rally Fire aura,
  // and the Mega-Card merge so this layer always sees the "final"
  // per-card value before totaling. Currently used by Duct Tape's
  // -50% to both halves of its snap pair; new items that need to
  // adjust both cards in a snap (e.g. an item that buffs the player
  // it snaps onto) drop in here without touching scoring.ts again.
  applySznItemSnapPairEffects(group, cardModifiers);

  // ---- SZN item group-context gates ------------------------------------
  // Runs LAST so any-neighbor-matches gating (Legal Rosin requires a
  // Pitcher neighbor for its +15 to land; Corked Bat requires a
  // Batter) reads the post-pair-effects values. Items can suppress
  // their own contribution back to zero here when the description's
  // target-type requirement isn't satisfied.
  applySznItemGroupScoringEffects(group, cardModifiers);

  let totalValue = Object.values(cardModifiers).reduce((acc, m) => acc + m.value, 0);

  // p-58 Brawl Dominance: +3 when this group's locked total leads the
  // opponent batter's best chain by 6+. Evaluated after the group is fully
  // scored so chained buffs count toward the margin (the inline hook used
  // raw baseValues only, which desynced card modifiers from the pill).
  if (
    ctx.gameMode === "brawl" &&
    ctx.opponentHand &&
    group.some((c) => c.id === "p-58")
  ) {
    const oppCtx: ScoringContext = {
      ...ctx,
      side: "Batting",
      opponentHand: hand,
      opponentBaseCard: highestValueCard(hand) ?? null,
      affirmedSeams: ctx.opponentAffirmedSeams ?? null,
      opponentAffirmedSeams: ctx.affirmedSeams ?? null,
      nullifiedCardIds: undefined,
      nullifyOpponentBaseMechanic: undefined,
      nullifyOpponentTagMechanics: undefined,
    };
    const oppResult = scoreHand(ctx.opponentHand, oppCtx);
    if (totalValue - oppResult.maxValue >= 6) {
      const mod = cardModifiers["p-58"];
      if (mod) {
        cardModifiers["p-58"] = { ...mod, value: mod.value + 3 };
        totalValue += 3;
      }
    }
  }

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

/** RBI from a home run given who is on base before the swing (batter + runners). */
export function homerunRunsFromBases(bases: readonly [boolean, boolean, boolean]): number {
  return 1 + bases.filter(Boolean).length;
}

/**
 * Brawl Mode outcome resolution.
 *
 * Each side enters combat with HP equal to their locked-in matchup total
 * (the "shield" built by snapping cards during the snap timer). Cards
 * attack in sequence — user's cards first, then opponent's — each side
 * dealing damage equal to its locked-in total. After both waves:
 *
 *   batterRemaining  = max(0, batterStarting − pitcherStarting)
 *   pitcherRemaining = max(0, pitcherStarting − batterStarting)
 *
 * The side with HP left wins. The WINNER's remaining HP ladders into the
 * at-bat result from the batter's POV:
 *
 *   - 0 - 5  : single
 *   - 6 - 10 : double
 *   - 11 - 15: triple
 *   - 16 - 20: homerun
 *   - 21 +   : homerun, flagged `grandSlam` (cosmetic tier; RBI use live bases)
 *
 * If the pitcher's remaining HP exceeds the batter's, the at-bat is an out.
 * Ties (both 0) go to the batter as a single.
 */
export interface BrawlOutcomeResolution {
  outcome: HitOutcome;
  batterWon: boolean;
  /** Winner's remaining HP after combat — drives the hit ladder. */
  winnerHP: number;
  /** Batter HP remaining after the pitcher's cards attack. */
  batterRemainingHP: number;
  /** Pitcher HP remaining after the batter's cards attack. */
  pitcherRemainingHP: number;
  /** Locked-in batter total at combat start (shield max). */
  batterStartingHP: number;
  /** Locked-in pitcher total at combat start (shield max). */
  pitcherStartingHP: number;
  grandSlam: boolean;
}

export function resolveBrawlOutcome(
  batterTotal: number,
  pitcherTotal: number,
): BrawlOutcomeResolution {
  const batterStartingHP = Math.max(0, batterTotal);
  const pitcherStartingHP = Math.max(0, pitcherTotal);

  const batterRemainingHP = Math.max(0, batterStartingHP - pitcherStartingHP);
  const pitcherRemainingHP = Math.max(0, pitcherStartingHP - batterStartingHP);

  const base = {
    batterRemainingHP,
    pitcherRemainingHP,
    batterStartingHP,
    pitcherStartingHP,
  };

  if (pitcherRemainingHP > batterRemainingHP) {
    return {
      ...base,
      outcome: "out",
      batterWon: false,
      winnerHP: pitcherRemainingHP,
      grandSlam: false,
    };
  }

  const winnerHP = batterRemainingHP;
  if (winnerHP >= 21) {
    return { ...base, outcome: "homerun", batterWon: true, winnerHP, grandSlam: true };
  }
  if (winnerHP >= 16) {
    return { ...base, outcome: "homerun", batterWon: true, winnerHP, grandSlam: false };
  }
  if (winnerHP >= 11) {
    return { ...base, outcome: "triple", batterWon: true, winnerHP, grandSlam: false };
  }
  if (winnerHP >= 6) {
    return { ...base, outcome: "double", batterWon: true, winnerHP, grandSlam: false };
  }
  return { ...base, outcome: "single", batterWon: true, winnerHP, grandSlam: false };
}
