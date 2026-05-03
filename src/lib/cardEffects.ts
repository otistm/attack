import { CardDefinition } from "./cards";
import { ShapeType } from "../components/cardShapes";
import { canConnect } from "./connect";
import type { ScoringContext } from "./scoring";

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
  // Bonus added to the Hit Scale calculation only (not the head-to-head total).
  hitScaleBonus: number;
  // Tier shift for the Hit Scale ladder. +5 typically means "upgrade one tier".
  hitScaleTierShift: number;
  // Force the entire play to a specific outcome regardless of score.
  forcedOutcome?: "single" | "homerun";
  // Pitcher wins ties this round.
  pitcherWinsTies?: boolean;
  // Adjustment to pitcher's combined values (b-17 Line Drive: -2).
  pitcherCombinedDelta: number;
  // Optional debug log.
  log?: string[];
}

const NOOP: EffectResult = {
  selfValueDelta: 0,
  opponentValueDelta: 0,
  hitScaleBonus: 0,
  hitScaleTierShift: 0,
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
  "b-2": () => r({ opponentValueDelta: -2 }),

  // b-3 Barrel It Up: +3 if combined (combine constraint enforced by canConnect).
  "b-3": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 3 }) : NOOP),

  // b-4 Unicorn Swing: high base, cannot be combined (enforced by combineConstraint).
  "b-4": () => NOOP,

  // b-5 Opposite Field Power: shape-reversal effect handled at hand-build time.
  "b-5": () => NOOP,

  // b-6 50/50 Club: if you win the round, upgrade Hit Scale by +5 tier.
  "b-6": () => r({ hitScaleTierShift: 5 }),

  // b-7 Soto Shuffle: information-only, no scoring impact.
  "b-7": () => NOOP,

  // b-8 Elite Eye: +3 to highest UNCOMBINED card.
  "b-8": (ctx) => {
    if (ctx.isCombined) return NOOP;
    const uncombinedSingles = ctx.hand.filter((_, i) => isCardUncombined(ctx, i));
    const highest = highestValueCard(uncombinedSingles);
    if (highest && highest.id === ctx.group[ctx.indexInGroup].id) return r({ selfValueDelta: 3 });
    return NOOP;
  },

  // b-9 Generational Discipline: ignores all pitcher debuffs (handled in resolve step).
  "b-9": () => NOOP,

  // b-10 Electric Speed: pure wildcard - no value change.
  "b-10": () => NOOP,

  // b-11 Chaos on the Basepaths: forced single if uncombined and you win.
  "b-11": (ctx) => (!ctx.isCombined ? r({ forcedOutcome: "single" }) : NOOP),

  // b-12 Switch Hitter: shape-mod effect handled at hand-build time.
  "b-12": () => NOOP,

  // b-13 Leadoff Magic: +4 if first at-bat of inning.
  "b-13": (ctx) => (ctx.isFirstAtBatOfInning ? r({ selfValueDelta: 4 }) : NOOP),

  // b-14 Bowling Strike: +3 to total if combined.
  "b-14": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 3 }) : NOOP),

  // b-15 Mookie's Hustle: per-side wildcard handled in canConnect.
  "b-15": () => NOOP,

  // b-16 Junior's Jump: +4 if combined with a Diamond.
  "b-16": (ctx) => {
    if (!ctx.isCombined) return NOOP;
    if (groupHasNeighborWithShape(ctx, "diamond")) return r({ selfValueDelta: 4 });
    return NOOP;
  },

  // b-17 Line Drive: pitcher's combined values reduced by 2.
  "b-17": () => r({ pitcherCombinedDelta: -2 }),

  // b-18 In The Gap: +3 to Hit Scale only (if you win).
  "b-18": () => r({ hitScaleBonus: 3 }),

  // b-19 Philly Clutch: +5 if your team has 2 outs.
  "b-19": (ctx) => (ctx.outs === 2 ? r({ selfValueDelta: 5 }) : NOOP),

  // b-20 Showman: if combined on BOTH sides, base value becomes 12.
  "b-20": (ctx) => {
    if (ctx.indexInGroup > 0 && ctx.indexInGroup < ctx.group.length - 1) {
      return r({ selfValueDelta: 12 - ctx.group[ctx.indexInGroup].baseValue });
    }
    return NOOP;
  },

  // b-21 The Pandemonium: destroys an opponent card (resolve-step handler).
  "b-21": () => NOOP,

  // b-22 Power/Speed Threat: coin flip; resolves at lock-in. We pick a deterministic average for preview (+3) when combined.
  "b-22": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 3, log: ["b-22 coin flip avg +3"] }) : NOOP),

  // b-23 Stolen Base Threat: pitcher cannot use general cards (resolve-step).
  "b-23": () => NOOP,

  // b-24 Deep Drive: combine constraint already enforced; no value change.
  "b-24": () => NOOP,

  // b-25 Rookie of the Year: +2 per uncombined card you leave on the table.
  "b-25": (ctx) => {
    const uncombinedCount = ctx.hand.filter((_, i) => isCardUncombined(ctx, i)).length;
    return r({ selfValueDelta: 2 * uncombinedCount });
  },

  // b-26 Shortstop Slap: +4 to total if combined.
  "b-26": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 4 }) : NOOP),

  // b-27 Camden Power: +3 if pitcher's base card is a Fastball.
  "b-27": (ctx) => (ctx.opponentBaseCard?.tags?.includes("fastball") ? r({ selfValueDelta: 3 }) : NOOP),

  // b-28 Vlad's Vengeance: cannot combine on left side (canConnect handles).
  "b-28": () => NOOP,

  // b-29 Home Run Derby: +1 per Circle on the board (in your hand).
  "b-29": (ctx) => {
    const circles = countShapesInHand(ctx.hand, "circle");
    return r({ selfValueDelta: circles });
  },

  // b-30 Laser Show: opponent's base card halved (resolve-step plumbing).
  "b-30": (ctx) => {
    if (!ctx.opponentBaseCard) return NOOP;
    const half = Math.floor(ctx.opponentBaseCard.baseValue / 2);
    const reduction = ctx.opponentBaseCard.baseValue - half;
    return r({ opponentValueDelta: -reduction });
  },

  // ============ PITCHING SIGNATURES (p-31..p-60) ============

  // p-31 Splinker: high base; opponent cannot use wildcards (resolve-step).
  "p-31": () => NOOP,

  // p-32 Triple Digits: +2 if uncombined.
  "p-32": (ctx) => (!ctx.isCombined ? r({ selfValueDelta: 2 }) : NOOP),

  // p-33 The Mustache: batter's Hit Scale requirements +3 (negative tier shift).
  "p-33": () => r({ hitScaleTierShift: -3, log: ["p-33 raises batter Hit Scale +3"] }),

  // p-34 Cole Train: +3 if combined on the right side.
  "p-34": (ctx) => {
    if (ctx.indexInGroup < ctx.group.length - 1) return r({ selfValueDelta: 3 });
    return NOOP;
  },

  // p-35 Knuckle Curve: batter cannot combine squares (resolve-step / hand-build).
  "p-35": () => NOOP,

  // p-36 Ace's Command: nullify mechanic of batter's highest valued card (resolve-step).
  "p-36": () => NOOP,

  // p-37 Cy Young Heat: +2 if batter is left-handed.
  "p-37": (ctx) => (ctx.batterHandedness === "L" ? r({ selfValueDelta: 2 }) : NOOP),

  // p-38 Wipeout Changeup: subtract 3 from batter's final combined score.
  "p-38": () => r({ opponentValueDelta: -3 }),

  // p-39 Mound Presence: batter must discard 1 general (resolve-step).
  "p-39": () => NOOP,

  // p-40 Wheeler's Workhorse: +1 per card the batter combines.
  "p-40": (ctx) => {
    if (!ctx.opponentHand) return NOOP;
    const combinedCount = countCombinedCards(ctx.opponentHand);
    return r({ selfValueDelta: combinedCount });
  },

  // p-41 Sweeping Slider: break batter's combo (resolve-step).
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
    const longestCombo = longestRunIn(ctx.opponentHand);
    return longestCombo >= 3 ? r({ opponentValueDelta: -6 }) : NOOP;
  },

  // p-51 Veteran Savvy: information-only.
  "p-51": () => NOOP,

  // p-52 Sweeper (Ohtani Pitching): if uncombined, batter's highest gets -3.
  "p-52": (ctx) => (!ctx.isCombined ? r({ opponentValueDelta: -3 }) : NOOP),

  // p-53 Splitter: value becomes equal to batter's highest combined total.
  "p-53": (ctx) => {
    if (!ctx.opponentHand) return NOOP;
    const oppGroups = buildGroupsFor(ctx.opponentHand);
    const oppMax = Math.max(0, ...oppGroups.map((g) => g.reduce((a, c) => a + c.baseValue, 0)));
    const card = ctx.group[ctx.indexInGroup];
    return r({ selfValueDelta: oppMax - card.baseValue });
  },

  // p-54 Dual Threat: draw an extra pitching general (resolve-step).
  "p-54": () => NOOP,

  // p-55 Rainbow Curve: +3 if combined on the left side.
  "p-55": (ctx) => (ctx.indexInGroup > 0 ? r({ selfValueDelta: 3 }) : NOOP),

  // p-56 Pinpoint Control: shape edit on draw (resolve-step / hand-build).
  "p-56": () => NOOP,

  // p-57 The Japanese Ace: +4 if batter uses no combinations.
  "p-57": (ctx) => {
    if (!ctx.opponentHand) return NOOP;
    const anyCombined = ctx.opponentHand.some((_, i) => !isCardUncombinedAt(ctx.opponentHand!, i));
    return !anyCombined ? r({ selfValueDelta: 4 }) : NOOP;
  },

  // p-58 Strikeout Artist: future-batter debuff if win by >5 (resolve-step).
  "p-58": () => NOOP,

  // p-59 Nasty Slider: information-only.
  "p-59": () => NOOP,

  // p-60 Filthy Stuff: -1 to batter's score for every card they play (hand-level).

  // ============ BATTING GENERAL DRAW (b-61..b-70) ============

  // b-61 Power Swing: shape constraint (S/D); otherwise stat-only.
  "b-61": () => NOOP,

  // b-62 Contact Swing: +2 if combined.
  "b-62": (ctx) => (ctx.isCombined ? r({ selfValueDelta: 2 }) : NOOP),

  // b-63 Bunt Attempt: forced single if you win.
  "b-63": () => r({ forcedOutcome: "single" }),

  // b-64 Good Eye: +4 if pitcher uses a fastball.
  "b-64": (ctx) => {
    const fastball = ctx.opponentHand?.some((c) => c.tags?.includes("fastball")) ?? false;
    return fastball ? r({ selfValueDelta: 4 }) : NOOP;
  },

  // b-65 Guess Pitch: +4 if pitcher uses named shape (placeholder: assume not guessed).
  "b-65": () => NOOP,

  // b-66 Solid Contact: +1 to Hit Scale.
  "b-66": () => r({ hitScaleBonus: 1 }),

  // b-67 Foul Ball: re-draw effect (resolve-step).
  "b-67": () => NOOP,

  // b-68 Steal Sign: per-side wildcard via canConnect.
  "b-68": () => NOOP,

  // b-69 Sacrifice Fly: scores runner from 3rd if combined and you lose (resolve-step).
  "b-69": () => NOOP,

  // b-70 The Sweet Spot: forced HR if combined on both sides.
  "b-70": (ctx) => {
    if (ctx.indexInGroup > 0 && ctx.indexInGroup < ctx.group.length - 1) {
      return r({ forcedOutcome: "homerun" });
    }
    return NOOP;
  },

  // ============ PITCHING GENERAL DRAW (p-71..p-80) ============

  // p-71 Four-Seam Fastball: +1 if uncombined.
  "p-71": (ctx) => (!ctx.isCombined ? r({ selfValueDelta: 1 }) : NOOP),

  // p-72 12-to-6 Curveball: -3 to batter's total.
  "p-72": () => r({ opponentValueDelta: -3 }),

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

  // p-75 Pickoff Move: removes a runner if you win (resolve-step).
  "p-75": () => NOOP,

  // p-76 Pitch Framing: +2 to your highest uncombined card.
  "p-76": (ctx) => {
    if (ctx.isCombined) return NOOP;
    const uncombined = ctx.hand.filter((_, i) => isCardUncombined(ctx, i));
    const highest = highestValueCard(uncombined);
    if (highest && highest.id === ctx.group[ctx.indexInGroup].id) return r({ selfValueDelta: 2 });
    return NOOP;
  },

  // p-77 Mound Visit: deck swap (resolve-step).
  "p-77": () => NOOP,

  // p-78 The Shift: nullify batter's star combos (resolve-step).
  "p-78": () => NOOP,

  // p-79 Intentional Walk: skip at-bat -> forced single for batter.
  "p-79": () => r({ forcedOutcome: "single" }),

  // p-80 Umpire's Call: pitcher wins all ties.
  "p-80": () => r({ pitcherWinsTies: true }),
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
    if (card.id === "p-60") {
      // Filthy Stuff: -1 per opponent card played.
      const oppCount = ctx.opponentHand?.length ?? 0;
      opponentModifier -= oppCount;
      log.push(`p-60 Filthy Stuff: -${oppCount}`);
    }
  }

  return { opponentModifier, pitcherCombinedDelta, pitcherWinsTies, log };
}

// ============ helpers ============

function isCardUncombined(ctx: EffectContext, indexInHand: number): boolean {
  const groups = buildGroupsFor(ctx.hand);
  for (const g of groups) {
    if (g.length === 1 && g[0].id === ctx.hand[indexInHand].id) return true;
  }
  return false;
}

function isCardUncombinedAt(hand: CardDefinition[], indexInHand: number): boolean {
  const groups = buildGroupsFor(hand);
  for (const g of groups) {
    if (g.length === 1 && g[0].id === hand[indexInHand].id) return true;
  }
  return false;
}

function buildGroupsFor(cards: CardDefinition[]): CardDefinition[][] {
  const groups: CardDefinition[][] = [];
  if (cards.length === 0) return groups;
  let cur: CardDefinition[] = [cards[0]];
  for (let i = 1; i < cards.length; i++) {
    if (canConnect(cards[i - 1], cards[i])) cur.push(cards[i]);
    else {
      groups.push(cur);
      cur = [cards[i]];
    }
  }
  groups.push(cur);
  return groups;
}

function highestValueCard(cards: CardDefinition[]): CardDefinition | undefined {
  if (cards.length === 0) return undefined;
  return cards.reduce((a, b) => (b.baseValue > a.baseValue ? b : a));
}

function countShapesInHand(hand: CardDefinition[], shape: ShapeType): number {
  let n = 0;
  for (const c of hand) {
    if (c.leftShape === shape) n++;
    if (c.rightShape === shape) n++;
  }
  return n;
}

function countCombinedCards(hand: CardDefinition[]): number {
  const groups = buildGroupsFor(hand);
  let combined = 0;
  for (const g of groups) if (g.length > 1) combined += g.length;
  return combined;
}

function longestRunIn(hand: CardDefinition[]): number {
  const groups = buildGroupsFor(hand);
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

function neighborsInGroup(ctx: EffectContext): CardDefinition[] {
  const out: CardDefinition[] = [];
  const left = ctx.group[ctx.indexInGroup - 1];
  const right = ctx.group[ctx.indexInGroup + 1];
  if (left) out.push(left);
  if (right) out.push(right);
  return out;
}

