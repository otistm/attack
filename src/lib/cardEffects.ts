import { CardDefinition, TagLiteral } from "./cards";
import { ShapeType } from "../components/cardShapes";
import { canConnect, canConnectAny, seamKey } from "./connect";
import type { ScoringContext } from "./scoring";
import {
  batterTeamLead,
  batterTeamRunsThisGame,
  runnersOnCount,
  scoreHand,
  uniqueShapeCount,
} from "./scoring";

// Note: cardEffects <-> scoring is a soft cycle (scoring imports applyCardEffect /
// applyOpponentTotalAdjustments from here, and we import the Phase 6 helpers
// from scoring). It's safe because every binding on either side is a function
// reference accessed at call time, not at module-init time.

export interface EffectContext extends ScoringContext {
  hand: CardDefinition[];
  group: CardDefinition[];
  indexInGroup: number;
  isCombined: boolean;
}

export interface EffectResult {
  // Delta applied to THIS card's value (added to baseValue).
  selfValueDelta: number;
  // Delta applied to the opponent's total this round.
  opponentValueDelta: number;
  /**
   * Optional attribution: when the description targets a specific opponent
   * card (e.g. b-2 "opponent's highest single -2", b-30 "opponent's base card
   * halved"), the effect can name the card that took the hit. The math still
   * lands as `opponentValueDelta` on the opponent's total -- this field is
   * purely presentational so the reveal animator can drop the correct
   * opponent card's number visibly. Aggregate debuffs (p-38, p-72, p-60)
   * leave it undefined.
   */
  opponentTargetCardId?: string;
  // Additive bonus to the Hit Scale calculation (does not affect head-to-head total).
  // On the BATTING side a positive value pushes the batter UP the Hit Scale ladder.
  // On the PITCHING side a positive value RAISES the requirements (debuff to batter).
  // Negative values are valid on either side.
  hitScaleBonus: number;
  // Force the entire play to a specific outcome regardless of score.
  forcedOutcome?: "single" | "homerun";
  // Pitcher wins ties this round.
  pitcherWinsTies?: boolean;
  // Adjustment to pitcher's combined values (b-17 Line Drive: -2).
  pitcherCombinedDelta: number;
  /**
   * Per-pitcher-card breakdown of `pitcherCombinedDelta`. b-17 Line Drive's
   * description ("pitcher's combined cards each get -2") implies one tick per
   * combined opponent card, so we surface that list for the animator. Engine
   * math still folds to `pitcherCombinedDelta` for back-compat.
   */
  pitcherCombinedDebuffs?: { targetCardId: string; delta: number }[];
  // Optional debug log.
  log?: string[];
}

const NOOP: EffectResult = {
  selfValueDelta: 0,
  opponentValueDelta: 0,
  hitScaleBonus: 0,
  pitcherCombinedDelta: 0,
};

function r(partial: Partial<EffectResult>): EffectResult {
  return { ...NOOP, ...partial };
}

/**
 * Effect registry. Each entry receives the per-card context and returns the
 * deltas the scoring engine should apply for that card. Cards without an entry
 * are no-ops (just contribute their baseValue).
 *
 * Effects that depend on game state (innings, outs, opponent cards) gate on
 * the relevant fields of `EffectContext` and return zero when the field is
 * missing — keeps the engine safe to call before Phase 4 wires up game state.
 */
type EffectFn = (ctx: EffectContext) => EffectResult;

export const CARD_EFFECTS: Record<string, EffectFn> = {
  // ============ BATTING SIGNATURES (b-1..b-30) ============

  // b-1 All Rise: +4 to final score if combined on either side.
  "b-1": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 4 }) : NOOP),

  // b-2 Judge's Chamber: opponent's highest single card -2.
  // Attribution targets the highest-value UNCOMBINED card if any exist
  // ("single" in the description), otherwise falls back to the overall highest
  // (opponentBaseCard) so the reveal animator always has a card to point at.
  "b-2": (ctx) => {
    const target =
      highestUncombinedInHand(ctx.opponentHand ?? [], ctx.opponentAffirmedSeams ?? null) ??
      ctx.opponentBaseCard;
    return r({ opponentValueDelta: -2, opponentTargetCardId: target?.id });
  },

  // b-3 Barrel It Up: +3 if combined (combine constraint enforced by canConnect).
  "b-3": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 3 }) : NOOP),

  // b-4 Unicorn Swing: high base, cannot be combined (enforced by combineConstraint).
  "b-4": () => NOOP,

  // b-5 Opposite Field Power: shape-reversal effect handled at hand-build time.
  "b-5": () => NOOP,

  // b-6 50/50 Club: if you win the round, +5 to Hit Scale (typically upgrades the tier).
  "b-6": () => r({ hitScaleBonus: 5 }),

  // b-7 Soto Shuffle: information-only. Queues an opponentUncombined reveal
  // request (gameStore.derivePendingReveals) shown by InfoRevealOverlay.
  "b-7": () => NOOP,

  // b-8 Elite Eye: +3 to highest UNCOMBINED card.
  "b-8": (ctx) => {
    if (ctx.isCombined) return NOOP;
    const uncombinedSingles = ctx.hand.filter((_, i) => isCardUncombined(ctx, i));
    const highest = highestValueCard(uncombinedSingles);
    if (highest && highest.id === ctx.group[ctx.indexInGroup].id) return r({ selfValueDelta: 3 });
    return NOOP;
  },

  // b-9 Generational Discipline: ignores pitcher debuffs. Handled in
  // gameStore.lockIn -- the per-card hook is intentionally a no-op because
  // the cancellation is global to the round, not local to the card.
  "b-9": () => NOOP,

  // b-10 Electric Speed: pure wildcard - no value change.
  "b-10": () => NOOP,

  // b-11 Chaos on the Basepaths: forced single if uncombined and you win.
  "b-11": (ctx) => (!ctx.isCombined ? r({ forcedOutcome: "single" }) : NOOP),

  // b-12 Switch Hitter: queues a pickShape choice in derivePendingChoices.
  // The chosen shape replaces the left shape of the lowest-value general in
  // the batter's hand (resolveChoice mutation).
  "b-12": () => NOOP,

  // b-13 Leadoff Magic: +4 if first at-bat of inning.
  "b-13": (ctx) => (ctx.isFirstAtBatOfInning ? r({ selfValueDelta: 4 }) : NOOP),

  // b-14 Bowling Strike: +3 if combined with a SQUARE neighbor (Phase 4
  // tighten -- previously a flat +3 on any combine, which made it an auto-
  // include in any 2+ card combo).
  "b-14": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    if (groupHasNeighborWithShape(ctx, "square")) return r({ selfValueDelta: 3 });
    return NOOP;
  },

  // b-15 Mookie's Hustle: per-side wildcard handled in canConnect.
  "b-15": () => NOOP,

  // b-16 Junior's Jump: +4 if combined with a Diamond.
  "b-16": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    if (groupHasNeighborWithShape(ctx, "diamond")) return r({ selfValueDelta: 4 });
    return NOOP;
  },

  // b-17 Line Drive: "Pitcher's combined values are reduced by 2." Reads as
  // one tick per combined pitcher card. Emits a per-card breakdown so the
  // reveal animator can drop each combined pitcher card individually; the
  // flat `pitcherCombinedDelta` aggregate is the sum of the breakdown so the
  // head-to-head math in `lockIn` keeps the same shape.
  "b-17": (ctx) => {
    const oppGroups = buildGroupsFor(
      ctx.opponentHand ?? [],
      ctx.opponentAffirmedSeams ?? null,
    );
    const combined = oppGroups.flatMap((g) => (g.length > 1 ? g : []));
    if (combined.length === 0) return r({ pitcherCombinedDelta: 0 });
    const debuffs = combined.map((c) => ({ targetCardId: c.id, delta: -2 }));
    const sum = debuffs.reduce((a, d) => a + d.delta, 0);
    return r({ pitcherCombinedDelta: sum, pitcherCombinedDebuffs: debuffs });
  },

  // b-18 In The Gap: +3 to Hit Scale, but only when combined (Phase 4 nerf
  // -- requires playing it through a connection rather than as a 1-card brick).
  // The description's "and you win" clause is structurally implicit: Hit
  // Scale is only consulted by `resolveHitScale` after the batter wins
  // head-to-head; a losing batter never reads the bonus, so we don't gate
  // on win here. Same pattern for b-66 and b-134 below.
  "b-18": (ctx) => (ctx.isCombined ? r({ hitScaleBonus: 3 }) : NOOP),

  // b-19 Philly Clutch: +5 if your team has 2 outs.
  "b-19": (ctx) => (ctx.outs === 2 ? r({ selfValueDelta: 5 }) : NOOP),

  // b-20 Showman: if combined on BOTH sides, base value becomes 12.
  "b-20": (ctx) => {
    if (ctx.indexInGroup > 0 && ctx.indexInGroup < ctx.group.length - 1) {
      return r({ selfValueDelta: 12 - ctx.group[ctx.indexInGroup].baseValue });
    }
    return NOOP;
  },

  // b-21 The Pandemonium: destroys an opponent card. Handled in
  // handTransforms (Phase 2) by zeroing & noCombining the highest-value
  // pitcher general the round the batter holds b-21.
  "b-21": () => NOOP,

  // b-22 Power/Speed Threat: actual coin flip when combined. Heads = +5,
  // tails = +1. The flip is generated at lock-in (gameStore stores it on
  // ctx.coinFlips) so the result is deterministic during the reveal. The
  // live preview has no flip yet, so it falls back to the average (+3) --
  // keeps the matchup pill stable while the player arranges cards.
  "b-22": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    const flip = ctx.coinFlips?.["b-22"];
    if (flip === "heads") return r({ selfValueDelta: 5, log: ["b-22 coin flip HEADS +5"] });
    if (flip === "tails") return r({ selfValueDelta: 1, log: ["b-22 coin flip TAILS +1"] });
    return r({ selfValueDelta: 3, log: ["b-22 coin flip avg +3 (preview)"] });
  },

  // b-23 Stolen Base Threat: pitcher cannot use general cards (resolve-step).
  "b-23": () => NOOP,

  // b-24 Deep Drive: combine constraint already enforced; no value change.
  "b-24": () => NOOP,

  // b-25 Rookie of the Year: +2 per uncombined card you leave on the table.
  "b-25": (ctx) => {
    const uncombinedCount = ctx.hand.filter((_, i) => isCardUncombined(ctx, i)).length;
    return r({ selfValueDelta: 2 * uncombinedCount });
  },

  // b-26 Shortstop Slap: +4 if combined on the RIGHT side (Phase 4 tighten
  // -- previously +4 on any combine, this version asks the player to leave
  // a partner on b-26's right shape, which is the natural combine direction
  // for its star/square pair).
  "b-26": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    if (ctx.indexInGroup < ctx.group.length - 1) return r({ selfValueDelta: 4 });
    return NOOP;
  },

  // b-27 Camden Power: +3 if pitcher's base card is a Fastball.
  "b-27": (ctx) => (ctx.opponentBaseCard?.tags?.includes("fastball") ? r({ selfValueDelta: 3 }) : NOOP),

  // b-28 Vlad's Vengeance: cannot combine on left side (canConnect handles).
  "b-28": () => NOOP,

  // b-29 Home Run Derby: +1 per Circle on the board (in your hand).
  "b-29": (ctx) => {
    const circles = countShapesInHand(ctx.hand, "circle");
    return r({ selfValueDelta: circles });
  },

  // b-30 Laser Show: opponent's base card halved. Fires here in the
  // scoring effect (per-card opponentValueDelta against the opponent's
  // base card) -- there's no resolve-step hook for this card.
  "b-30": (ctx) => {
    if (!ctx.opponentBaseCard) return NOOP;
    const half = Math.floor(ctx.opponentBaseCard.baseValue / 2);
    const reduction = ctx.opponentBaseCard.baseValue - half;
    return r({
      opponentValueDelta: -reduction,
      opponentTargetCardId: ctx.opponentBaseCard.id,
    });
  },

  // ============ PITCHING SIGNATURES (p-31..p-60) ============

  // p-31 Splinker: high base; opponent cannot use wildcards (resolve-step).
  "p-31": () => NOOP,

  // p-32 Triple Digits: +2 (always uncombined - noCombine is enforced by combineConstraint).
  "p-32": () => r({ selfValueDelta: 2 }),

  // p-33 The Mustache: shrinks the batter's hit by 3 rungs on the Hit
  // Scale ladder (a HR becomes a Triple, a Triple becomes a Double, etc).
  // Implementation note: positive `hitScaleBonus` on the PITCHER side
  // becomes `effPitcherHitScaleWall` in `computeMatchup`, which
  // subtracts from the batter's `hitScaleValue` BEFORE the ladder is
  // resolved. The wall only matters when the batter wins (a losing
  // batter never reads the ladder anyway), so the previous card text
  // "If the Batter wins, subtract 3 from the Batter's score" was
  // functionally identical to the new "shrinks the Batter's hit" text
  // -- both describe the same downstream behaviour.
  "p-33": () => r({ hitScaleBonus: 3, log: ["p-33 shrinks batter hit by 3 (Hit Scale wall)"] }),

  // p-34 Cole Train: +3 if combined on the right side.
  "p-34": (ctx) => {
    if (ctx.indexInGroup < ctx.group.length - 1) return r({ selfValueDelta: 3 });
    return NOOP;
  },

  // p-35 Knuckle Curve: batter cannot combine squares (resolve-step / hand-build).
  "p-35": () => NOOP,

  // p-36 Ace's Command: nullifies the mechanic of the batter's highest card.
  // Handled in gameStore.scoreBatter via ScoringContext.nullifiedCardIds --
  // the targeted card still scores its base value, just not its ability.
  "p-36": () => NOOP,

  // p-37 Cy Young Heat: +2 if batter is left-handed.
  "p-37": (ctx) => (ctx.batterHandedness === "L" ? r({ selfValueDelta: 2 }) : NOOP),

  // p-38 Wipeout Changeup: subtract 3 from batter's score, but only if this
  // pitch combines with another (Phase 4 nerf -- previously fired flat from
  // any hand, which made it an auto-include).
  "p-38": (ctx) => (ctx.isCombined ? r({ opponentValueDelta: -3 }) : NOOP),

  // p-39 Mound Presence: batter discards 1 general at deal time. Handled in
  // dealEffects -- auto-discards the lowest-value general until the picker UI
  // exists.
  "p-39": () => NOOP,

  // p-40 Wheeler's Workhorse: +1 per card the batter combines.
  "p-40": (ctx) => {
    if (!ctx.opponentHand) return NOOP;
    const combinedCount = countCombinedCards(
      ctx.opponentHand,
      ctx.opponentAffirmedSeams ?? null,
    );
    return r({ selfValueDelta: combinedCount });
  },

  // p-41 Sweeping Slider: break the batter's strongest combo. Handled in
  // gameStore.lockIn -- it scores once to find the best group, then nullifies
  // its first seam and re-scores. Auto-targets the strongest combo until the
  // player-choice modal can offer a manual pick.
  "p-41": () => NOOP,

  // p-42 Paint the Corners: batter's base value capped at 6 before combos (resolve-step).
  "p-42": () => NOOP,

  // p-43 100 MPH Cutter: cannot be combined (already enforced by None/None + noCombine).
  "p-43": () => NOOP,

  // p-44 Unhittable: if you win, counts as 2 outs (resolve-step).
  "p-44": () => NOOP,

  // p-45 Game Over: +5 if final inning.
  "p-45": (ctx) => (ctx.isFinalInning ? r({ selfValueDelta: 5 }) : NOOP),

  // p-46 Pure Gas: +2 if you have no combinations this round.
  "p-46": (ctx) => {
    const anyCombined = ctx.hand.some((_, i) => !isCardUncombined(ctx, i));
    return !anyCombined ? r({ selfValueDelta: 2 }) : NOOP;
  },

  // p-47 Rising Fastball: batter's diamonds become flat (resolve-step).
  "p-47": () => NOOP,

  // p-48 Lights Out: pitcher wins ties.
  "p-48": () => r({ pitcherWinsTies: true }),

  // p-49 The Condor: reverses batter's left/right (resolve-step / hand-build).
  "p-49": () => NOOP,

  // p-50 Devastating Slider: -6 if batter combines 3 cards.
  "p-50": (ctx) => {
    if (!ctx.opponentHand) return NOOP;
    const longestCombo = longestRunIn(
      ctx.opponentHand,
      ctx.opponentAffirmedSeams ?? null,
    );
    return longestCombo >= 3 ? r({ opponentValueDelta: -6 }) : NOOP;
  },

  // p-51 Veteran Savvy: information-only. Queues an opponentHand reveal
  // request shown by InfoRevealOverlay.
  "p-51": () => NOOP,

  // p-52 Sweeper (Ohtani Pitching): if uncombined, batter's highest gets -3.
  // Description names the batter's highest as the target -- attribute the
  // debuff to opponentBaseCard so the reveal animator can drop that card.
  "p-52": (ctx) => {
    if (ctx.isCombined) return NOOP;
    return r({
      opponentValueDelta: -3,
      opponentTargetCardId: ctx.opponentBaseCard?.id,
    });
  },

  // p-53 Splitter: value becomes equal to batter's highest combined total.
  // "Combined total" = the batter's bestGroup maxValue (i.e. effective
  // total after all modifiers like b-20 Showman doubling). Computing it
  // from raw baseValue sums (the previous implementation) silently
  // undershot whenever the batter ran any in-group buff. We re-score the
  // opponent hand under a side-flipped context so we get the same
  // maxValue scoring.scoreHand would derive at lock-in. Recursion is
  // bounded: only pitcher cards carry the "p-53" id, so the recursive
  // scoreHand call (on the batter hand) never re-enters this effect.
  "p-53": (ctx) => {
    if (!ctx.opponentHand || ctx.opponentHand.length === 0) return NOOP;
    const oppCtx: ScoringContext = {
      ...ctx,
      side: ctx.side === "Batting" ? "Pitching" : "Batting",
      opponentHand: ctx.hand,
      opponentBaseCard: highestValueCard(ctx.hand) ?? null,
      affirmedSeams: ctx.opponentAffirmedSeams ?? null,
      opponentAffirmedSeams: ctx.affirmedSeams ?? null,
      // Silencers attached to OUR ctx targeted us (or our base card from
      // the opponent's POV). They don't flip into the recursive call.
      nullifiedCardIds: undefined,
      nullifyOpponentBaseMechanic: undefined,
      nullifyOpponentTagMechanics: undefined,
    };
    const oppResult = scoreHand(ctx.opponentHand, oppCtx);
    const oppMax = Math.max(0, oppResult.maxValue);
    const card = ctx.group[ctx.indexInGroup];
    return r({ selfValueDelta: oppMax - card.baseValue });
  },

  // p-54 Dual Threat: draw an extra pitching general at deal time. Handled
  // in dealEffects -- always taken since extra cards are pure upside for the
  // pitcher.
  "p-54": () => NOOP,

  // p-55 Rainbow Curve: +3 if combined on the left side.
  "p-55": (ctx) => (ctx.indexInGroup > 0 ? r({ selfValueDelta: 3 }) : NOOP),

  // p-56 Pinpoint Control: queues a pickShape choice in derivePendingChoices.
  // The chosen shape replaces p-56's own right shape so it can match a drawn
  // general's left shape (resolveChoice mutation).
  "p-56": () => NOOP,

  // p-57 The Japanese Ace: +4 if batter uses no combinations.
  "p-57": (ctx) => {
    if (!ctx.opponentHand) return NOOP;
    const oppSeams = ctx.opponentAffirmedSeams ?? null;
    const anyCombined = ctx.opponentHand.some((_, i) => !isCardUncombinedAt(ctx.opponentHand!, i, oppSeams));
    return !anyCombined ? r({ selfValueDelta: 4 }) : NOOP;
  },

  // p-58 Strikeout Artist: future-batter debuff if win by >5 (resolve-step).
  "p-58": () => NOOP,

  // p-59 Nasty Slider: information-only. Queues an opponentLayout reveal
  // request shown by InfoRevealOverlay.
  "p-59": () => NOOP,

  // p-60 Filthy Stuff: -1 to batter's score for every card they play (hand-level).

  // ============ BATTING GENERAL DRAW (b-61..b-70) ============

  // b-61 Power Swing: shape constraint (S/D); otherwise stat-only.
  "b-61": () => NOOP,

  // b-62 Contact Swing: +2 if combined.
  "b-62": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 2 }) : NOOP),

  // b-63 Bunt Attempt: forced single if you win, plus +2 Value to actually
  // help you win the head-to-head. Previously this card emitted +2/+1 Hit
  // Scale, but `forcedOutcome` short-circuits the hit-scale ladder so those
  // points were dead -- the description "guaranteed Single AND +2 Hit Scale"
  // misled playtesters into expecting a double or triple. Re-routing the
  // bonus through `selfValueDelta` makes it land on the head-to-head
  // comparison, where it can swing a close at-bat without contradicting the
  // single-cap. Phase 5 STARTER bonus stays in the same channel.
  "b-63": (ctx) => {
    const result = r({ forcedOutcome: "single", selfValueDelta: 2 });
    if (handHasTag(ctx.opponentHand ?? [], "starter")) {
      result.selfValueDelta = (result.selfValueDelta ?? 0) + 1;
    }
    return result;
  },

  // b-64 Good Eye: +4 if pitcher uses a fastball.
  "b-64": (ctx) => {
    const fastball = ctx.opponentHand?.some((c) => c.tags?.includes("fastball")) ?? false;
    return fastball ? r({ selfValueDelta: 4 }) : NOOP;
  },

  // b-65 Guess Pitch: +4 if pitcher uses named shape (placeholder: assume not guessed).
  "b-65": () => NOOP,

  // b-66 Solid Contact: +2 to Hit Scale, but only when combined (Phase 4
  // nerf -- the +1 free-include is now a +2 with a real condition, so it has
  // to interact with the rest of the hand to matter).
  "b-66": (ctx) => (ctx.isCombined ? r({ hitScaleBonus: 2 }) : NOOP),

  // b-67 Foul Ball: discard b-67 + 1 other general -> draw 2 fresh generals.
  // Handled at deal time in dealEffects (auto-targets the lowest-value
  // general partner).
  "b-67": () => NOOP,

  // b-68 Steal Sign: per-side wildcard via canConnect.
  "b-68": () => NOOP,

  // b-69 Sacrifice Fly: scores the runner from 3rd when the batter loses
  // the at-bat (the rest of the runners hold). Implemented in
  // resolveStep.ts; the per-card hook stays a no-op here. Earlier drafts
  // also required b-69 to be combined, but Phase 4 dropped the combine
  // gate so the card is more often relevant.
  "b-69": () => NOOP,

  // b-70 The Sweet Spot: +15 Hit Scale when combined on BOTH sides (Phase 4
  // rebalance -- previously forced an automatic Home Run, which bypassed the
  // win check entirely and made it the most lopsided card in the deck). The
  // +15 still pushes a winning batter to a Home Run on the Hit Scale ladder
  // but only when they actually win the head-to-head.
  "b-70": (ctx) => {
    if (ctx.indexInGroup > 0 && ctx.indexInGroup < ctx.group.length - 1) {
      return r({ hitScaleBonus: 15 });
    }
    return NOOP;
  },

  // b-71 Manager's Challenge: hand-level tie-breaker; the batter wins all
  // ties this round and overrides any pitcher tie-breaker (p-48 Lights Out,
  // p-80 Umpire's Call). Detected directly from batterHand in computeMatchup
  // -- mirrors the way b-9 Generational Discipline is hand-level rather than
  // running through the per-card effect registry.
  "b-71": () => NOOP,

  // b-72 Walk-Off Swing: +1 per OTHER CLUTCH card in your hand. b-72 is
  // itself tagged CLUTCH so we exclude self -- a solo b-72 pays nothing,
  // the synergy reward kicks in when other clutch cards (b-65 Guess
  // Pitch, b-69 Sacrifice Fly, b-71 Manager's Challenge, Mookie / Harper /
  // Witt signatures) ride along. Matches `cards.ts` description: "+1
  // Value for each OTHER CLUTCH card in your hand."
  "b-72": (ctx) => {
    const clutch = countOtherHandTag(ctx, "clutch");
    return clutch > 0 ? r({ selfValueDelta: clutch }) : NOOP;
  },

  // b-73 Stolen Sign Read: +3 Hit Scale when your hand carries 2+ OTHER
  // SPEEDSTER cards. Self-tagged SPEEDSTER, so we exclude the source -- the
  // intent is "two speedsters surrounding it" not "I count myself for one".
  "b-73": (ctx) => (countOtherHandTag(ctx, "speedster") >= 2 ? r({ hitScaleBonus: 3 }) : NOOP),

  // b-74 Veteran Presence: +1 per OTHER VETERAN card in your hand. Self-tagged
  // VETERAN, so it must be paired with another veteran to do anything.
  "b-74": (ctx) => {
    const v = countOtherHandTag(ctx, "veteran");
    return v > 0 ? r({ selfValueDelta: v }) : NOOP;
  },

  // b-75 Rookie Energy: +5 if any OTHER ROOKIE-tagged card is in your hand.
  // Self-tagged rookie, so the bonus only fires when the batter signature
  // (De La Cruz, Henderson) is actually a rookie alongside it.
  "b-75": (ctx) => (handHasOtherTag(ctx, "rookie") ? r({ selfValueDelta: 5 }) : NOOP),

  // b-76 Power Stance: +3 when combined AND your hand has another POWER-HITTER
  // card. Self-tagged power-hitter, so the synergy must include a different
  // power-hitter card (Judge, Vlad, Acuña, Harper signatures).
  "b-76": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    if (!handHasOtherTag(ctx, "power-hitter")) return NOOP;
    return r({ selfValueDelta: 3 });
  },

  // b-77 Closer Hunter: +5 when the OPPONENT has a CLOSER tag. Rewards
  // matchups against Clase/Miller specifically, scales the threat against
  // the hardest pitches in the deck.
  "b-77": (ctx) => (handHasTag(ctx.opponentHand ?? [], "closer") ? r({ selfValueDelta: 5 }) : NOOP),

  // b-78 Bullpen Beater: hand-level "always fires when held" debuff. The
  // per-card path here is intentionally a no-op -- the math lives in
  // `applyOpponentTotalAdjustments` so the effect lands even if b-78 is in a
  // group that didn't win the head-to-head (the description "if they are a
  // starter" reads as an always-on condition; gating it on best-group
  // arrangement was a Phase 5 oversight playtesters flagged as a bug).
  "b-78": () => NOOP,

  // b-79 Lefty Killer: +4 when the pitcher's hand carries a LEFTY tag (Sale,
  // Skubal). Mirror of p-37 Cy Young Heat in the opposite direction.
  "b-79": (ctx) => (handHasTag(ctx.opponentHand ?? [], "lefty") ? r({ selfValueDelta: 4 }) : NOOP),

  // b-80 Off-Speed Spotter: +3 when the pitcher uses an OFF-SPEED pitch
  // (Skubal Wipeout, Yamamoto Pinpoint, p-73 Changeup, p-82 Splitter).
  // Same shape as b-64 Good Eye but for a different pitch family.
  "b-80": (ctx) => (handHasTag(ctx.opponentHand ?? [], "off-speed") ? r({ selfValueDelta: 3 }) : NOOP),

  // ============ PITCHING GENERAL DRAW (p-71..p-90) ============

  // p-71 Four-Seam Fastball: +1 if uncombined.
  "p-71": (ctx) => (!ctx.isCombined ? r({ selfValueDelta: 1 }) : NOOP),

  // p-72 12-to-6 Curveball: -3 to batter when this pitch combines with a
  // DIAMOND or another BREAKING-BALL neighbor (Phase 4 nerf gated it on
  // Diamond; Phase 5 also lets it trigger off the breaking-ball *tag* so
  // breaker chains play nice without requiring a specific shape).
  "p-72": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    const neighbors = neighborsInGroup(ctx);
    const hasBreakerTag = neighbors.some((n) => n.tags?.includes("breaking-ball"));
    if (groupHasNeighborWithShape(ctx, "diamond") || hasBreakerTag) {
      return r({ opponentValueDelta: -3 });
    }
    return NOOP;
  },

  // p-73 Changeup: +3 if combined with a fastball.
  "p-73": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    const neighbors = neighborsInGroup(ctx);
    if (neighbors.some((n) => n.tags?.includes("fastball"))) return r({ selfValueDelta: 3 });
    return NOOP;
  },

  // p-74 Backdoor Slider: +1 per Circle in batter's hand.
  "p-74": (ctx) => {
    const circles = ctx.opponentHand ? countShapesInHand(ctx.opponentHand, "circle") : 0;
    return r({ selfValueDelta: circles });
  },

  // p-75 Pickoff Move: removes a runner if you win (resolve-step). Phase 5
  // also adds +2 Value if the batter has any SPEEDSTER cards -- the pickoff
  // hits hardest against runners who threaten to steal.
  "p-75": (ctx) =>
    handHasTag(ctx.opponentHand ?? [], "speedster") ? r({ selfValueDelta: 2 }) : NOOP,

  // p-76 Pitch Framing: +2 to your highest uncombined card.
  "p-76": (ctx) => {
    if (ctx.isCombined) return NOOP;
    const uncombined = ctx.hand.filter((_, i) => isCardUncombined(ctx, i));
    const highest = highestValueCard(uncombined);
    if (highest && highest.id === ctx.group[ctx.indexInGroup].id) return r({ selfValueDelta: 2 });
    return NOOP;
  },

  // p-77 Mound Visit: swap one card with the top of the deck. Handled at
  // deal time in dealEffects -- auto-swaps the lowest-value pitcher card.
  "p-77": () => NOOP,

  // p-78 The Shift: nullify batter's star combos (resolve-step).
  "p-78": () => NOOP,

  // p-79 Intentional Walk: skip at-bat -> forced single for batter.
  "p-79": () => r({ forcedOutcome: "single" }),

  // p-80 Umpire's Call: pitcher wins all ties. Phase 5 also adds +2 Value
  // when the batter brings CLUTCH cards -- the umpire's strike-three call
  // bites hardest in late-and-close situations the batter built around.
  "p-80": (ctx) => {
    const result = r({ pitcherWinsTies: true });
    if (handHasTag(ctx.opponentHand ?? [], "clutch")) {
      result.selfValueDelta = (result.selfValueDelta ?? 0) + 2;
    }
    return result;
  },

  // p-81 Slider: +2 when combined with another BREAKING-BALL neighbor.
  // Pairs with p-72 12-to-6 Curveball, p-74 Backdoor Slider, Cole's Knuckle
  // Curve, Wheeler's Sweeping Slider, Cease's Nasty Slider/Strikeout Artist,
  // Sale's Devastating Slider, Yamamoto's Rainbow Curve, Ohtani's Sweeper.
  "p-81": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    const neighbors = neighborsInGroup(ctx);
    return neighbors.some((n) => n.tags?.includes("breaking-ball"))
      ? r({ selfValueDelta: 2 })
      : NOOP;
  },

  // p-82 Splitter: +3 when combined with a FASTBALL neighbor, OR +2 when
  // combined with another OFF-SPEED neighbor. Mirrors p-73 Changeup and lets
  // off-speed sequences (splitter -> changeup) reward themselves.
  "p-82": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    const neighbors = neighborsInGroup(ctx);
    if (neighbors.some((n) => n.tags?.includes("fastball"))) return r({ selfValueDelta: 3 });
    if (neighbors.some((n) => n.tags?.includes("off-speed"))) return r({ selfValueDelta: 2 });
    return NOOP;
  },

  // p-83 Sinker: +1 per SQUARE shape on the batter's cards. Aggregate buff
  // (rewards heat-stacked batter hands -- Acuña's Power/Speed Threat, b-22
  // double squares, etc).
  "p-83": (ctx) => {
    const squares = ctx.opponentHand ? countShapesInHand(ctx.opponentHand, "square") : 0;
    return squares > 0 ? r({ selfValueDelta: squares }) : NOOP;
  },

  // p-84 Cutter: +2 when uncombined. Mirror of b-25 Rookie of the Year on
  // the pitcher side -- rewards the pitcher for not chaining (the cutter
  // wants its own runway).
  "p-84": (ctx) => (!ctx.isCombined ? r({ selfValueDelta: 2 }) : NOOP),

  // p-85 Closer's Mentality: +4 if another CLOSER signature is in your hand
  // (Clase, Miller). Self-tagged closer, so the bonus requires a true closer
  // pitcher to back it up.
  "p-85": (ctx) => (handHasOtherTag(ctx, "closer") ? r({ selfValueDelta: 4 }) : NOOP),

  // p-86 Veteran Wisdom: +1 per OTHER VETERAN card in your hand. Self-tagged
  // veteran. Most pitcher signatures are tagged veteran so the upside is
  // reliable but capped.
  "p-86": (ctx) => {
    const v = countOtherHandTag(ctx, "veteran");
    return v > 0 ? r({ selfValueDelta: v }) : NOOP;
  },

  // p-87 Rookie Heat: +3 if another ROOKIE-tagged card is in your hand
  // (Skenes, Miller). Self-tagged rookie, mirrors b-75 with a smaller bonus
  // because rookie pitcher signatures already start strong.
  "p-87": (ctx) => (handHasOtherTag(ctx, "rookie") ? r({ selfValueDelta: 3 }) : NOOP),

  // p-88 Starter's Stamina: +2 to the pitcher's hit-scale wall (raises the
  // batter's required Hit Scale by 2). Doesn't move head-to-head, just makes
  // every winning batter total resolve as a smaller hit. Stacks with p-33.
  "p-88": () => r({ hitScaleBonus: 2, log: ["p-88 Starter's Stamina raises batter Hit Scale +2"] }),

  // p-89 Lefty Specialist: +4 when the BATTER is left-handed. Reads from
  // ScoringContext.batterHandedness like p-37 Cy Young Heat. Generalizes
  // the lefty matchup off Skubal so any pitcher hand can punish an Ohtani /
  // Soto / Harper / Henderson at-bat.
  "p-89": (ctx) => (ctx.batterHandedness === "L" ? r({ selfValueDelta: 4 }) : NOOP),

  // p-90 Power-Hitter Killer: hand-level "always fires when held" debuff.
  // Same reasoning as b-78 -- the description doesn't gate on combination
  // status, so the math lives in `applyOpponentTotalAdjustments`.
  "p-90": () => NOOP,

  // ============ PHASE 6 STATE-TRIGGER CARDS (b-91..b-96, p-91..p-94) ============

  // b-91 RBI Threat: +3 Value when a runner is in scoring position (2B or 3B).
  // Reads `bases` from the live game-state. With nobody in scoring position
  // it's a vanilla 4-Value card -- the bonus only fires when the situation
  // actually has a runner waiting to score.
  "b-91": (ctx) => {
    const bases = ctx.bases;
    if (!bases) return NOOP;
    const runnerOn2or3 = bases[1] || bases[2];
    return runnerOn2or3 ? r({ selfValueDelta: 3 }) : NOOP;
  },

  // b-92 Grand Slam Threat: +6 Value with the bases loaded. Big swing card --
  // dead weight when bases are empty, league-leading when all three bags are
  // occupied. Forces the player to actually engineer (or wait for) a loaded
  // situation rather than always-on power.
  "b-92": (ctx) => {
    const bases = ctx.bases;
    if (!bases) return NOOP;
    const loaded = bases[0] && bases[1] && bases[2];
    return loaded ? r({ selfValueDelta: 6 }) : NOOP;
  },

  // b-93 Comeback Kid: +4 Value when the batter's team is losing. Reads from
  // the live `homeScore` / `awayScore` / `half` so the comparison flips with
  // who's at-bat. Tied counts as "not losing" -- explicit losing-only is
  // closer to the late-inning rally flavor than a "tied or behind" buff.
  "b-93": (ctx) => (batterTeamLead(ctx) < 0 ? r({ selfValueDelta: 4 }) : NOOP),

  // b-94 Front-Runner: +2 Value when the batter's team is leading. Smaller
  // bonus than b-93 because being ahead is already the comfortable state --
  // this just keeps the lead momentum going.
  "b-94": (ctx) => (batterTeamLead(ctx) > 0 ? r({ selfValueDelta: 2 }) : NOOP),

  // b-95 Late Innings Hero: +4 Value in the 7th inning or later. Mirrors
  // b-13 Leadoff Magic on the opposite axis -- early-inning Magic vs late-
  // inning Heroics. Total innings is small (typically 9), so this isn't a
  // free buff -- it requires the at-bat to actually land in the late game.
  "b-95": (ctx) => ((ctx.inning ?? 0) >= 7 ? r({ selfValueDelta: 4 }) : NOOP),

  // b-96 Home Cookin': +2 Value during the bottom half of the inning (the
  // home team's at-bat). Modest but reliable in any "home" matchup.
  "b-96": (ctx) => (ctx.half === "bottom" ? r({ selfValueDelta: 2 }) : NOOP),

  // p-91 Bases Empty Heat: +3 Value with no runners on. The fastball-flavored
  // pitcher who thrives without traffic on the bases.
  "p-91": (ctx) => (runnersOnCount(ctx) === 0 ? r({ selfValueDelta: 3 }) : NOOP),

  // p-92 Damage Control: +4 Value when 2 or more runners are on. Inverse of
  // p-91 -- the starter who locks in only when the jam is real.
  "p-92": (ctx) => (runnersOnCount(ctx) >= 2 ? r({ selfValueDelta: 4 }) : NOOP),

  // p-93 Save Situation: +5 Value when the pitcher's team is leading by 3 or
  // fewer runs. Exact MLB save rule. Pitcher's-team lead = -batterTeamLead.
  "p-93": (ctx) => {
    const pitcherLead = -batterTeamLead(ctx);
    return pitcherLead > 0 && pitcherLead <= 3 ? r({ selfValueDelta: 5 }) : NOOP;
  },

  // p-94 Closer Mode: +3 Value in the 8th inning or later. Same shape as
  // b-95 but pitcher-side and one inning later, since closers usually enter
  // 8th-9th specifically.
  "p-94": (ctx) => ((ctx.inning ?? 0) >= 8 ? r({ selfValueDelta: 3 }) : NOOP),

  // ============ PHASE 7 BATTER EXPANSION (b-100..b-135) ============

  // b-100 Five-Tool Threat: +5 if combined AND pitcher's base is fastball.
  // Two gates so it doesn't dwarf b-1 (a flat +4 on combine) -- you have to
  // both arrange a chain AND face a fastball-tagged base card.
  "b-100": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    if (!ctx.opponentBaseCard?.tags?.includes("fastball")) return NOOP;
    return r({ selfValueDelta: 5 });
  },

  // b-101 MVP Resume: +1 per OTHER VETERAN card in the pitcher's hand.
  // Mirror of b-74 (own hand veteran scaling) into the opposite hand --
  // rewards facing veteran-stacked pitchers.
  "b-101": (ctx) => {
    const v = ctx.opponentHand
      ? ctx.opponentHand.reduce(
          (n, c) => (c.tags?.includes("veteran") ? n + 1 : n),
          0,
        )
      : 0;
    // "every other" excludes b-101 itself, but b-101 is BATTER-side so it
    // can never appear in opponentHand -- the count is naturally "other".
    return v > 0 ? r({ selfValueDelta: v }) : NOOP;
  },

  // b-102 Halo Bomb: combine constraint already enforces rightNoCombine.
  "b-102": () => NOOP,

  // b-103 1B Smooth: +1 per DIAMOND on the BOARD (across both hands).
  // Mirrors b-29 Home Run Derby's circle-counter, but board-wide so the
  // pitcher's diamonds also scale Freeman up -- it reads as "every diamond
  // on the table" rather than "every diamond you brought".
  "b-103": (ctx) => {
    const own = countShapesInHand(ctx.hand, "diamond");
    const opp = ctx.opponentHand ? countShapesInHand(ctx.opponentHand, "diamond") : 0;
    const total = own + opp;
    return total > 0 ? r({ selfValueDelta: total }) : NOOP;
  },

  // b-104 Calm at the Plate: +3 if your team has 0 outs.
  "b-104": (ctx) => (ctx.outs === 0 ? r({ selfValueDelta: 3 }) : NOOP),

  // b-105 Atlanta-LA Ring: pitcher's BASE card mechanic is nullified. The
  // silencing flag flows through ScoringContext.nullifyOpponentBaseMechanic
  // (set in gameStore.scorePitcher when the batter holds b-105). This per-
  // card hook stays a no-op -- b-105 itself doesn't change its own value.
  "b-105": () => NOOP,

  // b-106 Cuban Crusher: if combined, base value becomes 14.
  "b-106": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    const card = ctx.group[ctx.indexInGroup];
    return r({ selfValueDelta: 14 - card.baseValue });
  },

  // b-107 Crawford Boxes: +2 per OTHER POWER-HITTER card in your hand.
  "b-107": (ctx) => {
    const p = countOtherHandTag(ctx, "power-hitter");
    return p > 0 ? r({ selfValueDelta: 2 * p }) : NOOP;
  },

  // b-108 DH Threat: nullifies pitcher's OFF-SPEED card abilities. Wired
  // through ScoringContext.nullifyOpponentTagMechanics (set in
  // gameStore.scorePitcher). Self hook is a no-op like b-105.
  "b-108": () => NOOP,

  // b-109 World Series MVP: +3 in the 4th inning or later.
  "b-109": (ctx) => ((ctx.inning ?? 0) >= 4 ? r({ selfValueDelta: 3 }) : NOOP),

  // b-110 Smooth Stroke: +4 if combined on the LEFT side. Mirror of b-26
  // Shortstop Slap which fires on the right side.
  "b-110": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    if (ctx.indexInGroup > 0) return r({ selfValueDelta: 4 });
    return NOOP;
  },

  // b-111 October Hero: +5 if the score is tied.
  "b-111": (ctx) => (batterTeamLead(ctx) === 0 ? r({ selfValueDelta: 5 }) : NOOP),

  // b-112 Switch Slasher: +2 per unique shape on the board (max +6).
  // "Board" = both hands. Wildcards count as their own slot. Cap mirrors
  // the description -- without it, every full board would push +8.
  "b-112": (ctx) => {
    const board = [...ctx.hand, ...(ctx.opponentHand ?? [])];
    const shapes = uniqueShapeCount(board);
    const bonus = Math.min(6, shapes * 2);
    return bonus > 0 ? r({ selfValueDelta: bonus }) : NOOP;
  },

  // b-113 Cleveland Cutter: +1 per card YOU have combined. Mirror of p-40
  // Wheeler's Workhorse on the batter side; counts the batter's own combined
  // cards (incl. b-113 if it's combined too).
  "b-113": (ctx) => {
    const combined = countCombinedCards(ctx.hand, ctx.affirmedSeams ?? null);
    return combined > 0 ? r({ selfValueDelta: combined }) : NOOP;
  },

  // b-114 30-30 Threat: +3 if your hand has another SPEEDSTER and another
  // POWER-HITTER. Self-tagged BOTH speedster and power-hitter, so each
  // count must exclude b-114 itself.
  "b-114": (ctx) => {
    const speedster = countOtherHandTag(ctx, "speedster") >= 1;
    const power = countOtherHandTag(ctx, "power-hitter") >= 1;
    return speedster && power ? r({ selfValueDelta: 3 }) : NOOP;
  },

  // b-115 Polar Power: +1 per STAR shape on the board (both hands).
  "b-115": (ctx) => {
    const own = countShapesInHand(ctx.hand, "star");
    const opp = ctx.opponentHand ? countShapesInHand(ctx.opponentHand, "star") : 0;
    const total = own + opp;
    return total > 0 ? r({ selfValueDelta: total }) : NOOP;
  },

  // b-116 HR Derby Champ: +3 to Hit Scale on combine alone (no win check).
  "b-116": (ctx) => (ctx.isCombined ? r({ hitScaleBonus: 3 }) : NOOP),

  // b-117 Citi Bomb: +2 Value AND +2 Hit Scale on combine. Dual-buff.
  "b-117": (ctx) =>
    ctx.isCombined ? r({ selfValueDelta: 2, hitScaleBonus: 2 }) : NOOP,

  // b-118 Track Star: +5 if no combinations this round (mirror of p-46
  // Pure Gas on the batter side).
  "b-118": (ctx) => {
    const anyCombined = ctx.hand.some((_, i) => !isCardUncombined(ctx, i));
    return !anyCombined ? r({ selfValueDelta: 5 }) : NOOP;
  },

  // b-119 Quick Bat: pitcher's General cards each get -2 Value. The
  // hand-transform layer mutates pitcher cards directly, so per-card hook
  // stays a no-op (the deltas already land on the pitcher's baseValues).
  "b-119": () => NOOP,

  // b-120 Steal Home: runner-advance boost handled by resolveStep. Per-card
  // hook is a no-op -- the bonus only fires after the at-bat resolves.
  "b-120": () => NOOP,

  // b-121 Catcher's Eye: information-only. derivePendingReveals queues a
  // signatureShapes reveal for the batter side.
  "b-121": () => NOOP,

  // b-122 Pitch Caller: +5 if pitcher's base card is a BREAKING-BALL.
  "b-122": (ctx) =>
    ctx.opponentBaseCard?.tags?.includes("breaking-ball")
      ? r({ selfValueDelta: 5 })
      : NOOP,

  // b-123 Future Captain: +1 to every OTHER card in your hand. Implemented
  // as +N to b-123 itself where N = (handSize - 1), which keeps the bonus
  // on b-123's pill without bleeding the buff back into the OTHER cards'
  // mechanics. The visual reading "+1 to every other card" still holds at
  // the head-to-head total: the team's score moves by exactly the same
  // delta either way (+1 * (handSize - 1)).
  "b-123": (ctx) => {
    const otherCount = ctx.hand.length - 1;
    return otherCount > 0 ? r({ selfValueDelta: otherCount }) : NOOP;
  },

  // b-124 Carita's Cannon: +6 if combined on BOTH sides (interior of group).
  "b-124": (ctx) => {
    if (ctx.indexInGroup > 0 && ctx.indexInGroup < ctx.group.length - 1) {
      return r({ selfValueDelta: 6 });
    }
    return NOOP;
  },

  // b-125 Green Monster: hand-transform replaces the batter's diamonds with
  // wildcards. Per-card hook stays a no-op -- the conversion already lands.
  "b-125": () => NOOP,

  // b-126 Lefty Mash: +3 if pitcher is right-handed. Mirror of p-37 Cy Young
  // Heat (which reads `batterHandedness`). Switch hitters ("S") are not
  // gated either way -- the bonus needs an explicitly right-handed pitcher.
  "b-126": (ctx) => (ctx.pitcherHandedness === "R" ? r({ selfValueDelta: 3 }) : NOOP),

  // b-127 Mr. Smile: if combined, the pitcher's lowest UNCOMBINED card has
  // its mechanic nullified. Implemented by attaching the target card id
  // through `nullifiedCardIds` in scoreBatter / scorePitcher pipelines --
  // we surface it here via opponentTargetCardId for the reveal animator,
  // but the silencing flag itself is set on the pitcher context in the
  // store layer. Per-card hook leaves the math alone.
  "b-127": () => NOOP,

  // b-128 Switch-Cap: +2 Value AND +2 Hit Scale if pitcher is LEFTY.
  // "Pitcher is LEFTY" -> opponent hand has a lefty-tagged card. Same read
  // as b-79 Lefty Killer.
  "b-128": (ctx) =>
    handHasTag(ctx.opponentHand ?? [], "lefty")
      ? r({ selfValueDelta: 2, hitScaleBonus: 2 })
      : NOOP,

  // b-129 Captain Lindor: +1 to every uncombined card you leave. Same
  // attribution trick as b-123 -- credit the buff onto b-129 itself so the
  // team total still moves by the right amount. Counts uncombined cards
  // OTHER than b-129; if b-129 is itself uncombined we don't count it
  // (you don't get to "leave yourself behind" as a buff target).
  "b-129": (ctx) => {
    const selfId = ctx.group[ctx.indexInGroup].id;
    let n = 0;
    for (let i = 0; i < ctx.hand.length; i++) {
      if (ctx.hand[i].id === selfId) continue;
      if (isCardUncombined(ctx, i)) n++;
    }
    return n > 0 ? r({ selfValueDelta: n }) : NOOP;
  },

  // b-130 Postseason Tuve: +5 if your team is losing or tied.
  "b-130": (ctx) => (batterTeamLead(ctx) <= 0 ? r({ selfValueDelta: 5 }) : NOOP),

  // b-131 Tiny Terror: +3 if your hand has 2 or more OTHER CLUTCH cards.
  // Self-tagged clutch, so the threshold counts neighbors only.
  "b-131": (ctx) => (countOtherHandTag(ctx, "clutch") >= 2 ? r({ selfValueDelta: 3 }) : NOOP),

  // b-132 Champion's Heart: +1 per Run your team has scored this game.
  // Reads from the running batter-team total via the helper -- doesn't
  // care about the at-bat that's about to score (those runs land AFTER
  // lock-in resolves).
  "b-132": (ctx) => {
    const runs = batterTeamRunsThisGame(ctx);
    return runs > 0 ? r({ selfValueDelta: runs }) : NOOP;
  },

  // b-133 Jazz Hands: hand-transform conditionally swaps b-133's shapes to
  // wildcard. Per-card hook is a no-op -- the wildcard form is already in
  // the scoring data by the time effects evaluate.
  "b-133": () => NOOP,

  // b-134 Bronx Hustle: +5 Hit Scale if uncombined. The "and you win" gate
  // is implicit in the Hit Scale ladder (it only fires when the batter
  // wins head-to-head), so we don't need a separate win check.
  "b-134": (ctx) => (!ctx.isCombined ? r({ hitScaleBonus: 5 }) : NOOP),

  // b-135 Stolen Bag: extra runner placed in resolveStep. Per-card hook
  // stays a no-op.
  "b-135": () => NOOP,

  // ============ Phase A puzzle-card expansion (b-81..b-88, p-95, p-96) ============
  //
  // Cards are GENERAL DRAW so they hit the dealer pool without needing player
  // attribution; their data and copy live alongside the existing generals at
  // the bottom of `cards.ts`. See the helpers in this file (chainShapeReading,
  // hasABA, isPalindromeShapes, alternates, countAlternations, containsSequence,
  // runOfShape, indexInHand) and the `requireChainLength` enforcement in
  // scoring.ts (scoreGroup) for the supporting machinery.

  // ---- Direction 1: pattern-aware effects ----

  // b-81 Sandwich Single: +6 if combined AND both immediate neighbors in the
  // chain carry a DIAMOND on either side. Mirrors "I sit between two diamonds"
  // by reading the LITERAL neighbor shapes (not the dedup chain) so the card
  // can clearly point at "the cards next to me", not a global pattern check.
  "b-81": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    const neighbors = neighborsInGroup(ctx);
    if (neighbors.length < 2) return NOOP;
    const allDiamond = neighbors.every(
      (n) => n.leftShape === "diamond" || n.rightShape === "diamond",
    );
    return allDiamond ? r({ selfValueDelta: 6 }) : NOOP;
  },

  // b-82 Three-Pitch Sequence: +6 if the chain dedup-shape sequence reads
  // SQUARE -> DIAMOND -> CIRCLE in order somewhere. Pattern check is
  // contiguous on the dedup sequence, so any chain that "moves through"
  // those three shapes in that order qualifies.
  "b-82": (ctx) =>
    containsSequence(ctx.group, ["square", "diamond", "circle"])
      ? r({ selfValueDelta: 6 })
      : NOOP,

  // ---- Direction 2: long-chain tiers ----

  // b-83 Triple Threat: +8 once the chain reaches 3+ cards. Pure structural
  // gate -- doesn't care about shape composition, just length.
  "b-83": (ctx) => (ctx.group.length >= 3 ? r({ selfValueDelta: 8 }) : NOOP),

  // b-84 Five-Tool Run: pairs with `requireChainLength: 4` so the card scores
  // 0 in chains shorter than 4 (enforced in scoring.ts). When the floor is
  // satisfied, this effect tacks +8 on top of the baseValue for a clean +12
  // payout. The ctx.group.length check is redundant given the constraint
  // gate but keeps the hook self-consistent if requireChainLength is ever
  // edited away in card data.
  "b-84": (ctx) => (ctx.group.length >= 4 ? r({ selfValueDelta: 8 }) : NOOP),

  // b-85 Cleanup Stacker: +1 per card to your right inside the same chain.
  // Reads `indexInGroup` (NOT `indexInHand`) -- only counts cards that
  // actually CHAIN to this one, so a long unchained tail doesn't pay out.
  "b-85": (ctx) => {
    const rightCount = ctx.group.length - 1 - ctx.indexInGroup;
    return rightCount > 0 ? r({ selfValueDelta: rightCount }) : NOOP;
  },

  // ---- Direction 4: lineup-position effects ----

  // b-86 Leadoff Spark: +5 when in slot 0 of the LINEUP (ctx.hand), regardless
  // of whether it's combined or not. Encourages the player to lead with this
  // card; pairing with a chain bonus is just gravy.
  "b-86": (ctx) => {
    const card = ctx.group[ctx.indexInGroup];
    return indexInHand(card, ctx.hand) === 0 ? r({ selfValueDelta: 5 }) : NOOP;
  },

  // b-87 Cleanup Crew: +5 when in slot 3 (the 4th card) of the LINEUP. Slot
  // is fixed regardless of how the chain assembles around it. Lineups
  // shorter than 4 cards (rare in normal play) silently skip the bonus.
  "b-87": (ctx) => {
    const card = ctx.group[ctx.indexInGroup];
    return indexInHand(card, ctx.hand) === 3 ? r({ selfValueDelta: 5 }) : NOOP;
  },

  // b-88 Anchor: +3 when uncombined AND in the rightmost slot of the lineup.
  // Pairs the position check with an explicit !isCombined gate so a stray
  // chain reaching the right edge of the lineup doesn't trigger it.
  "b-88": (ctx) => {
    if (ctx.isCombined) return NOOP;
    const card = ctx.group[ctx.indexInGroup];
    const idx = indexInHand(card, ctx.hand);
    return idx === ctx.hand.length - 1 ? r({ selfValueDelta: 3 }) : NOOP;
  },

  // ---- Direction 1 (continued): pattern-aware effects on the pitcher side ----

  // p-95 Mirror Image: +5 self AND -3 opponent when the chain dedup-shape
  // sequence is a palindrome. Even a solo p-95 chain qualifies (the dedup
  // collapses [c,c] to [c], a trivial palindrome) -- the card carries
  // circle/circle so it self-rewards on a clean uncombined draw too.
  "p-95": (ctx) =>
    isPalindromeShapes(ctx.group)
      ? r({ selfValueDelta: 5, opponentValueDelta: -3 })
      : NOOP,

  // p-96 Alternating Heat: +2 per SQUARE<->DIAMOND alternation in the chain
  // dedup sequence. Counts EVERY a<->b flip, so longer alternating runs
  // scale linearly (a perfect [s,d,s,d,s] reads 4 alternations -> +8).
  "p-96": (ctx) => {
    const flips = countAlternations(ctx.group, "square", "diamond");
    return flips > 0 ? r({ selfValueDelta: flips * 2 }) : NOOP;
  },
};

export function applyCardEffect(card: CardDefinition, ctx: EffectContext): EffectResult {
  const fn = CARD_EFFECTS[card.id];
  if (!fn) return NOOP;
  return fn(ctx);
}

/**
 * Hand-level adjustments that don't fit cleanly into per-card effects, like
 * Filthy Stuff which scales -1 per opponent card played.
 */
export function applyOpponentTotalAdjustments(
  hand: CardDefinition[],
  ctx: ScoringContext,
): { opponentModifier: number; pitcherCombinedDelta: number; pitcherWinsTies: boolean; log: string[] } {
  let opponentModifier = 0;
  let pitcherCombinedDelta = 0;
  let pitcherWinsTies = false;
  const log: string[] = [];

  for (const card of hand) {
    // Disabled cards (b-23 Stolen Base Threat nullifies pitcher generals)
    // don't fire even at the hand level, so a Filthy Stuff turned off by b-23
    // doesn't keep ticking the batter down.
    if (card.disabled) continue;
    if (card.id === "p-60") {
      // Filthy Stuff: -1 per SQUARE shape on the batter's cards (Phase 4
      // nerf -- previously -1 per card flat, which was an auto-include from
      // any pitcher hand). Squares are the fastball shape, so the flavor
      // tightens to "filthy stuff eats fastball-shaped swings".
      const squareCount = countShapesInHand(ctx.opponentHand ?? [], "square");
      opponentModifier -= squareCount;
      log.push(`p-60 Filthy Stuff: -${squareCount} (one per batter SQUARE)`);
    }
    if (card.id === "b-78") {
      // Bullpen Beater: -2 to the pitcher's score when they carry STARTER.
      // Lives at hand-level so it always fires when held, not only when in
      // the best group. Symmetric with p-90.
      if (handHasTag(ctx.opponentHand ?? [], "starter")) {
        opponentModifier -= 2;
        log.push("b-78 Bullpen Beater: -2 vs STARTER");
      }
    }
    if (card.id === "p-90") {
      // Power-Hitter Killer: -3 to the batter's score when they carry
      // POWER-HITTER. Hand-level so it always fires when held.
      if (handHasTag(ctx.opponentHand ?? [], "power-hitter")) {
        opponentModifier -= 3;
        log.push("p-90 Power-Hitter Killer: -3 vs POWER-HITTER");
      }
    }
  }

  return { opponentModifier, pitcherCombinedDelta, pitcherWinsTies, log };
}

// ============ helpers ============

function isCardUncombined(ctx: EffectContext, indexInHand: number): boolean {
  const groups = buildGroupsFor(ctx.hand, ctx.affirmedSeams ?? null);
  for (const g of groups) {
    if (g.length === 1 && g[0].id === ctx.hand[indexInHand].id) return true;
  }
  return false;
}

function isCardUncombinedAt(
  hand: CardDefinition[],
  indexInHand: number,
  affirmedSeams: ReadonlySet<string> | null = null,
): boolean {
  const groups = buildGroupsFor(hand, affirmedSeams);
  for (const g of groups) {
    if (g.length === 1 && g[0].id === hand[indexInHand].id) return true;
  }
  return false;
}

/**
 * Mirrors `scoring.buildGroups`: chains adjacent cards by `canConnect` AND
 * (when `affirmedSeams` is non-null) requires the seam to be in the affirmed
 * set. Pass `null` for legacy auto-connect (the AI / opponent's hand when
 * the user is not on that side).
 *
 * Used by the combo-aware helpers below; the previous implementation
 * unconditionally auto-connected, which silently disagreed with scoring
 * whenever the user left a mechanically-legal seam unaffirmed.
 */
function buildGroupsFor(
  cards: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null = null,
): CardDefinition[][] {
  const groups: CardDefinition[][] = [];
  if (cards.length === 0) return groups;
  let cur: CardDefinition[] = [cards[0]];
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1];
    const curr = cards[i];
    const mechConnect = canConnectAny(prev, curr);
    const userAffirmed =
      affirmedSeams === null ? true : affirmedSeams.has(seamKey(prev.id, curr.id));
    if (mechConnect && userAffirmed) {
      cur.push(curr);
    } else {
      groups.push(cur);
      cur = [curr];
    }
  }
  groups.push(cur);
  return groups;
}

/**
 * Highest-baseValue card. Tie-breaker: lexicographically smallest id so
 * reordering the hand doesn't change which card "wins" the tie.
 *
 * Single source of truth for the rule -- gameStore and scoring both import
 * this so the "highest card" any silence/buff targets stays consistent
 * across the engine. Previously each module had its own copy of the same
 * reduce loop and it was easy for them to drift.
 */
export function highestValueCard(cards: CardDefinition[]): CardDefinition | undefined {
  if (cards.length === 0) return undefined;
  return cards.reduce((a, b) => {
    if (b.baseValue > a.baseValue) return b;
    if (b.baseValue === a.baseValue && b.id < a.id) return b;
    return a;
  });
}

/**
 * Highest-value UNCOMBINED card in the given hand, or undefined if every card
 * is part of a multi-card group. Used by b-2 Judge's Chamber so the visual
 * attribution matches the description ("opponent's highest single card").
 *
 * When inspecting the OPPONENT hand from inside an effect, callers should
 * pass `ctx.opponentAffirmedSeams ?? null` so the singleton detection
 * matches how the opponent's hand will actually be grouped at scoring time.
 */
function highestUncombinedInHand(
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null = null,
): CardDefinition | undefined {
  if (hand.length === 0) return undefined;
  const groups = buildGroupsFor(hand, affirmedSeams);
  const singles = groups.filter((g) => g.length === 1).map((g) => g[0]);
  return highestValueCard(singles);
}

function countShapesInHand(hand: CardDefinition[], shape: ShapeType): number {
  let n = 0;
  for (const c of hand) {
    if (c.leftShape === shape) n++;
    if (c.rightShape === shape) n++;
  }
  return n;
}

function countCombinedCards(
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null = null,
): number {
  const groups = buildGroupsFor(hand, affirmedSeams);
  let combined = 0;
  for (const g of groups) if (g.length > 1) combined += g.length;
  return combined;
}

function longestRunIn(
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null = null,
): number {
  const groups = buildGroupsFor(hand, affirmedSeams);
  return Math.max(0, ...groups.map((g) => g.length));
}

function groupHasNeighborWithShape(ctx: EffectContext, shape: ShapeType): boolean {
  const i = ctx.indexInGroup;
  const left = ctx.group[i - 1];
  const right = ctx.group[i + 1];
  if (left && (left.leftShape === shape || left.rightShape === shape)) return true;
  if (right && (right.leftShape === shape || right.rightShape === shape)) return true;
  return false;
}

function handHasTag(hand: CardDefinition[], tag: TagLiteral): boolean {
  return hand.some((c) => c.tags?.includes(tag));
}

function countHandTag(hand: CardDefinition[], tag: TagLiteral): number {
  return hand.reduce((n, c) => (c.tags?.includes(tag) ? n + 1 : n), 0);
}

/**
 * Self-aware variants used by cards whose own tag matches what they're
 * counting (e.g. b-74 Veteran Presence is itself tagged VETERAN). Without the
 * exclude, the card would always self-trigger its bonus by one even when held
 * solo, which confused playtesters watching their value tick up "for free".
 * The natural reading of "+1 per VETERAN card in your hand" is "per OTHER
 * VETERAN card", so we drop the source card from the count.
 */
function handHasOtherTag(ctx: EffectContext, tag: TagLiteral): boolean {
  const selfId = ctx.group[ctx.indexInGroup].id;
  return ctx.hand.some((c) => c.id !== selfId && c.tags?.includes(tag));
}

function countOtherHandTag(ctx: EffectContext, tag: TagLiteral): number {
  const selfId = ctx.group[ctx.indexInGroup].id;
  return ctx.hand.reduce(
    (n, c) => (c.id !== selfId && c.tags?.includes(tag) ? n + 1 : n),
    0,
  );
}

function neighborsInGroup(ctx: EffectContext): CardDefinition[] {
  const out: CardDefinition[] = [];
  const left = ctx.group[ctx.indexInGroup - 1];
  const right = ctx.group[ctx.indexInGroup + 1];
  if (left) out.push(left);
  if (right) out.push(right);
  return out;
}

// ============ Phase A pattern / position helpers ============
// These helpers read structural properties of a chain (palindrome, ABA
// sandwich, alternation, ordered sequence, run-length) or a card's
// position in the WHOLE hand (vs. its group). They power the "puzzle card"
// expansion (Sandwich Single, Mirror Image, Alternating Heat, Three-Pitch
// Sequence, Triple Threat, Five-Tool Run, Cleanup Stacker, Leadoff Spark,
// Cleanup Crew, Anchor) without changing scoring math -- each card's effect
// just reads one of these and emits the standard EffectResult deltas.

/**
 * Walk the chain left-to-right, concatenating each card's [leftShape,
 * rightShape], then collapse consecutive duplicates. The resulting sequence
 * is what a player "reads" off the chain by colour/shape, with seam-matched
 * shapes counted once.
 *
 * Examples:
 *   [s/d, d/s]              -> [s, d, s]
 *   [s/c, c/c, c/s]         -> [s, c, s]    (Mirror Image palindrome)
 *   [star/sq, sq/d, d/c]    -> [star, sq, d, c]
 *
 * Shapes are kept literal (`wildcard`, `none` are treated as their own
 * tokens). Cards using `*Wildcard` constraint flags do NOT have their literal
 * leftShape/rightShape rewritten -- the helpers operate on the raw shape data
 * so a card displayed as wildcard via constraint still reads as its underlying
 * shape here. Card data should match what the player sees on the card face.
 */
export function chainShapeReading(group: CardDefinition[]): ShapeType[] {
  const all: ShapeType[] = [];
  for (const c of group) {
    all.push(c.leftShape, c.rightShape);
  }
  const out: ShapeType[] = [];
  for (const s of all) {
    if (out.length === 0 || out[out.length - 1] !== s) out.push(s);
  }
  return out;
}

/**
 * True when the chain reads the same forwards and backwards by the dedup
 * shape sequence above. Single-card chains are trivially palindromes.
 * Empty chains return false (defensive — `scoreGroup` never invokes effects
 * on empty groups, but callers should not get a false-positive on no data).
 */
export function isPalindromeShapes(group: CardDefinition[]): boolean {
  if (group.length === 0) return false;
  const seq = chainShapeReading(group);
  for (let i = 0, j = seq.length - 1; i < j; i++, j--) {
    if (seq[i] !== seq[j]) return false;
  }
  return true;
}

/**
 * True when somewhere in the chain dedup sequence the shape `a` sandwiches
 * the shape `b`, i.e. the contiguous triple `[a, b, a]` appears. Useful for
 * "I sit between two X" checks where the card data carries the b in the
 * middle. Also handy for non-self structural reads (any A-B-A anywhere).
 */
export function hasABA(group: CardDefinition[], a: ShapeType, b: ShapeType): boolean {
  const seq = chainShapeReading(group);
  for (let i = 0; i + 2 < seq.length; i++) {
    if (seq[i] === a && seq[i + 1] === b && seq[i + 2] === a) return true;
  }
  return false;
}

/**
 * True when the chain dedup sequence is strictly an alternation of `a` and
 * `b` (either `a-b-a-b...` or `b-a-b-a...`) using ONLY those two shapes.
 * Single-shape sequences return false (no alternation present). Sequences
 * containing any third shape return false.
 */
export function alternates(group: CardDefinition[], a: ShapeType, b: ShapeType): boolean {
  const seq = chainShapeReading(group);
  if (seq.length < 2) return false;
  if (a === b) return false;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== a && seq[i] !== b) return false;
    if (i > 0 && seq[i] === seq[i - 1]) return false;
  }
  return true;
}

/**
 * Count the number of `a<->b` flips in the chain dedup sequence. A run of
 * `[a, b, a, b]` returns 3. Pairs that don't involve both `a` and `b` are
 * ignored, so a sequence like `[a, b, c, a]` returns 1 (only the first
 * a->b flip counts). Used by Alternating Heat to scale its bonus with how
 * "fastball-y" the chain reads.
 */
export function countAlternations(group: CardDefinition[], a: ShapeType, b: ShapeType): number {
  if (a === b) return 0;
  const seq = chainShapeReading(group);
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1];
    const curr = seq[i];
    if ((prev === a && curr === b) || (prev === b && curr === a)) n++;
  }
  return n;
}

/**
 * True when the dedup chain shape sequence contains `pattern` as a
 * CONTIGUOUS run somewhere. Empty patterns return true (vacuously). Patterns
 * longer than the chain return false. Used by Three-Pitch Sequence (S->D->C).
 */
export function containsSequence(group: CardDefinition[], pattern: ShapeType[]): boolean {
  if (pattern.length === 0) return true;
  const seq = chainShapeReading(group);
  if (pattern.length > seq.length) return false;
  for (let i = 0; i + pattern.length <= seq.length; i++) {
    let match = true;
    for (let k = 0; k < pattern.length; k++) {
      if (seq[i + k] !== pattern[k]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * True when the chain has at least `n` consecutive cards each "touching"
 * `shape` (leftShape === shape OR rightShape === shape). Card-level (not
 * dedup-shape-level) so a square/square card counts as a single touch, not
 * two. Used for "run of pitches" style cards.
 */
export function runOfShape(group: CardDefinition[], shape: ShapeType, n: number): boolean {
  if (n <= 0) return true;
  let cur = 0;
  for (const c of group) {
    if (c.leftShape === shape || c.rightShape === shape) {
      cur++;
      if (cur >= n) return true;
    } else {
      cur = 0;
    }
  }
  return false;
}

/**
 * Position of `card` in the WHOLE hand (the lineup), not the group. Returns
 * -1 if not found. Position-aware effects (Leadoff Spark, Cleanup Crew,
 * Anchor) use this to key off the lineup slot instead of the chain slot.
 */
export function indexInHand(card: CardDefinition, hand: CardDefinition[]): number {
  return hand.findIndex((c) => c.id === card.id);
}

