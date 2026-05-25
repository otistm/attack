import type { CardDefinition } from "./cards";
import { canConnectAny, seamKey } from "./connect";
import { homerunRunsFromBases, resolveBrawlOutcome } from "./scoring";

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

/**
 * Multi-at-bat context the optimizer uses to bias its scoring. A pure
 * one-at-bat HP search ignores the surrounding fight — the AI happily
 * trades a "minor win this at-bat" for a "major loss in two at-bats"
 * because the search horizon is a single matchup. This context lets us
 * fold the meta-state in without expanding the search depth:
 *
 *  - `runDiff` (AI runs − user runs at decision time). Positive means
 *    the AI is leading and should value LOSS-PREVENTION over upside.
 *  - `userAtBatsRemaining` — including the current one. Late-game the
 *    AI should be much less willing to give up grand-slam variance.
 *  - `userSnapBonusFloor` — pessimistic baseline assumption about the
 *    user's snap-speed bonus this at-bat. Defaults to 3 (high tier),
 *    so the optimizer plans against the user's best-case clicking
 *    speed instead of assuming the user fumbles the timer.
 *  - `isFinalHalf` — bumps the trailing-AI variance preference further.
 */
export interface BrawlPlanContext {
  runDiff: number;
  userAtBatsRemaining: number;
  userSnapBonusFloor: number;
  isFinalHalf: boolean;
  /** Diamond state at decision time — homerun RBI use occupied bases. */
  bases: readonly [boolean, boolean, boolean];
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
  ctx?: BrawlPlanContext,
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

  // Multi-at-bat awareness. The base score above optimizes a single
  // matchup in isolation; the bias below nudges the AI to play to the
  // SCOREBOARD rather than to the at-bat.
  if (ctx) {
    const userScored = userSide === "Batting" && res.batterWon;
    // Effective runs the user banks from THIS at-bat. Grand slams count
    // 4 because the bases reset and four runners score; we approximate
    // singles/doubles/triples as 1 run (the engine's typical conversion
    // with empty bases; runner conversion is modeled separately in the
    // headless sim's P3 work).
    const userRunsThisAtBat = userScored
      ? res.outcome === "homerun"
        ? homerunRunsFromBases(ctx.bases)
        : 1
      : 0;
    // After this at-bat, the user closes the gap by `userRunsThisAtBat`.
    // The AI's score baseline 1e6 already says "win this matchup". The
    // bias below adjusts WHICH winning / losing branches it prefers.
    const projectedDiffAfter = ctx.runDiff - userRunsThisAtBat;
    const aiTrailing = ctx.runDiff < 0;
    const aiLeading = ctx.runDiff > 0;
    const lateGame = ctx.isFinalHalf || ctx.userAtBatsRemaining <= 1;

    if (aiLeading) {
      // Holding a lead: prefer outcomes that DENY user run-scoring,
      // even if a margin-positive layout would technically win this
      // at-bat with the same HP swing. Stomp big homers hardest.
      if (userScored) {
        const denyWeight =
          res.outcome === "homerun"
            ? 1_500 + homerunRunsFromBases(ctx.bases) * 650
            : 1_500;
        score -= denyWeight;
        if (lateGame) score -= denyWeight * 2;
      }
    } else if (aiTrailing) {
      // Down: variance becomes our friend. Tie-break toward layouts
      // that yield a CLOSER margin loss (= bigger HP delta) only when
      // we can't win — the engine maps "more HP swing on opponent"
      // into a better hit type when the AI is BATTING, so this is
      // mostly already captured; the late-game branch below adds a
      // stronger signal when we MUST score.
      if (lateGame && userSide === "Pitching" && res.batterWon) {
        // Even if we lose this at-bat as the pitcher, prefer layouts
        // where our HP swing was bigger (we forced the user to spend).
        score += res.winnerHP * 5;
      }
      if (projectedDiffAfter <= -3) {
        // Late-game blowout territory: bias even more toward big
        // swings on our own attack so we're not nickel-and-diming.
        if (!opponentWon && userSide === "Batting" && !res.batterWon) {
          // AI is the pitcher in a deficit; reward layouts that
          // produce an OUT — we MUST stack outs to keep the lead from
          // running away. (Already captured in opponentWon branch.)
        }
      }
    }
  }

  return score;
}

/**
 * Exhaustively search opponent card order + seam forging for the best
 * brawl HP outcome. Hands are tiny (≤5 cards) so permutations × seam
 * masks stay well under a few thousand probes.
 *
 * `planContext` (optional) folds the surrounding fight state into the
 * tie-break: lead protection, deficit aggression, late-game variance.
 * Omit it to fall back to the pure one-at-bat optimum.
 */
export function optimizeBrawlOpponentHand(
  opponentHand: CardDefinition[],
  userSide: BrawlUserSide,
  probe: BrawlProbeFn,
  planContext?: BrawlPlanContext,
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
      const layoutScore = brawlLayoutScore(
        batterDisplay,
        pitcherDisplay,
        userSide,
        planContext,
      );
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
