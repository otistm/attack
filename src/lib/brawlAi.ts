import type { CardDefinition } from "./cards";
import { canConnectAny, seamKey } from "./connect";
import { resolveBrawlOutcome } from "./scoring";

export type BrawlUserSide = "Batting" | "Pitching";

/** How the optimizer scores a candidate opponent layout. */
export type BrawlProbeFn = (
  opponentHand: CardDefinition[],
  opponentSeams: ReadonlySet<string>,
) => { batterDisplay: number; pitcherDisplay: number };

export interface BrawlOptimizeResult {
  hand: CardDefinition[];
  affirmedSeams: ReadonlySet<string>;
  /** Positive when the layout favors the opponent seat. */
  advantage: number;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    const tail = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const rest of permutations(tail)) {
      out.push([head, ...rest]);
    }
  }
  return out;
}

/** Every subset of mechanically valid seams for a fixed left-to-right order. */
function seamSubsets(hand: CardDefinition[]): ReadonlySet<string>[] {
  const keys: string[] = [];
  for (let i = 1; i < hand.length; i++) {
    const a = hand[i - 1];
    const b = hand[i];
    if (canConnectAny(a, b)) keys.push(seamKey(a.id, b.id));
  }
  if (keys.length === 0) return [new Set<string>()];
  const out: ReadonlySet<string>[] = [];
  const total = 1 << keys.length;
  for (let mask = 0; mask < total; mask++) {
    const set = new Set<string>();
    for (let bit = 0; bit < keys.length; bit++) {
      if (mask & (1 << bit)) set.add(keys[bit]);
    }
    out.push(set);
  }
  return out;
}

function brawlAdvantage(
  batterDisplay: number,
  pitcherDisplay: number,
  userSide: BrawlUserSide,
): number {
  const res = resolveBrawlOutcome(batterDisplay, pitcherDisplay);
  if (userSide === "Batting") {
    return res.pitcherRemainingHP - res.batterRemainingHP;
  }
  return res.batterRemainingHP - res.pitcherRemainingHP;
}

/** Composite score: prefer winning, then HP margin, then bigger hits when user loses. */
function brawlLayoutScore(
  batterDisplay: number,
  pitcherDisplay: number,
  userSide: BrawlUserSide,
): number {
  const res = resolveBrawlOutcome(batterDisplay, pitcherDisplay);
  const opponentWon = userSide === "Batting" ? !res.batterWon : res.batterWon;
  const adv = brawlAdvantage(batterDisplay, pitcherDisplay, userSide);

  let score = adv * 1000;
  if (opponentWon) {
    score += 1_000_000;
    if (userSide === "Pitching" && res.batterWon) {
      score += res.winnerHP * 10;
      if (res.grandSlam) score += 500;
      else if (res.outcome === "homerun") score += 200;
      else if (res.outcome === "triple") score += 100;
      else if (res.outcome === "double") score += 50;
    }
  } else if (userSide === "Batting" && res.batterWon) {
    score -= res.winnerHP * 10;
    if (res.grandSlam) score -= 500;
  }
  return score;
}

/**
 * Exhaustively search opponent card order + seam forging for the best
 * brawl HP outcome. Hands are tiny (≤5 cards) so permutations × seam
 * masks stay well under a few thousand probes.
 */
export function optimizeBrawlOpponentHand(
  opponentHand: CardDefinition[],
  userSide: BrawlUserSide,
  probe: BrawlProbeFn,
): BrawlOptimizeResult {
  if (opponentHand.length === 0) {
    return { hand: [], affirmedSeams: new Set(), advantage: -Infinity };
  }

  let bestHand = opponentHand;
  let bestSeams = new Set<string>();
  let bestScore = -Infinity;
  let bestAdv = -Infinity;
  let bestDisplay = -Infinity;

  for (const order of permutations(opponentHand)) {
    for (const seams of seamSubsets(order)) {
      const { batterDisplay, pitcherDisplay } = probe(order, seams);
      const adv = brawlAdvantage(batterDisplay, pitcherDisplay, userSide);
      const layoutScore = brawlLayoutScore(batterDisplay, pitcherDisplay, userSide);
      const oppDisplay = userSide === "Batting" ? pitcherDisplay : batterDisplay;

      if (
        layoutScore > bestScore ||
        (layoutScore === bestScore && adv > bestAdv) ||
        (layoutScore === bestScore &&
          adv === bestAdv &&
          oppDisplay > bestDisplay) ||
        (layoutScore === bestScore &&
          adv === bestAdv &&
          oppDisplay === bestDisplay &&
          seams.size > bestSeams.size)
      ) {
        bestScore = layoutScore;
        bestAdv = adv;
        bestDisplay = oppDisplay;
        bestHand = order;
        bestSeams = new Set(seams);
      }
    }
  }

  return {
    hand: bestHand,
    affirmedSeams: bestSeams,
    advantage: bestAdv,
  };
}
