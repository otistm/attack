import { CardDefinition } from "./cards";
import { ScoringResult } from "./scoring";
import type { Bases } from "./gameStore";

/**
 * Cross-at-bat debuff queued by a resolve-step effect (currently only p-58
 * Strikeout Artist). Drained one at-bat at a time in `gameStore.lockIn`.
 */
export interface PendingDebuff {
  appliesToSide: "Batting" | "Pitching";
  /** Number of FUTURE at-bats this debuff applies to. Decremented after use. */
  remainingAtBats: number;
  /** Flat adjustment to that side's `maxValue` during scoring. */
  totalValueDelta?: number;
  /** Which card emitted the debuff (for tooltips / logging). */
  source: string;
}

export interface ResolveContext {
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  bases: Bases;
  batterResult: ScoringResult;
  pitcherResult: ScoringResult;
  batterTotal: number;
  pitcherTotal: number;
  batterWins: boolean;
}

export type RunnerSlot = "first" | "second" | "third";

export interface ResolveDelta {
  /** Extra outs to add on top of the natural outcome (p-44 Unhittable). */
  outsAdjustment: number;
  /** Pickoff hint -- the highest-priority runner to erase. */
  removeRunnerHint: RunnerSlot | null;
  /** b-69 Sacrifice Fly: a runner on 3rd scores even though the batter is out. */
  forceRunFromThird: boolean;
  /** Cross-at-bat debuffs to enqueue (drained next at-bat). */
  pendingDebuffs: PendingDebuff[];
  log: string[];
}

const EMPTY: ResolveDelta = {
  outsAdjustment: 0,
  removeRunnerHint: null,
  forceRunFromThird: false,
  pendingDebuffs: [],
  log: [],
};

type ResolveFn = (ctx: ResolveContext) => Partial<ResolveDelta>;

function bestGroupContains(result: ScoringResult, cardId: string): boolean {
  return result.bestGroup.some((c) => c.id === cardId);
}

export const RESOLVE_STEPS: Record<string, ResolveFn> = {
  // p-44 Unhittable: if the pitcher wins, the play counts as 2 outs instead of 1.
  "p-44": (ctx) => {
    if (ctx.batterWins) return {};
    return { outsAdjustment: 1, log: ["p-44 Unhittable: +1 extra out"] };
  },

  // p-75 Pickoff Move: if pitcher wins, erase a base runner. Picks the
  // furthest-along runner so the player gets the most game-state value.
  "p-75": (ctx) => {
    if (ctx.batterWins) return {};
    if (ctx.bases[2]) return { removeRunnerHint: "third", log: ["p-75 Pickoff: erase runner on 3rd"] };
    if (ctx.bases[1]) return { removeRunnerHint: "second", log: ["p-75 Pickoff: erase runner on 2nd"] };
    if (ctx.bases[0]) return { removeRunnerHint: "first", log: ["p-75 Pickoff: erase runner on 1st"] };
    return {};
  },

  // b-69 Sacrifice Fly: any time you lose, a runner on 3rd still scores
  // (Phase 4 buff -- previously also required b-69 to be combined, which
  // doubled the failure mode and made the card almost never relevant).
  "b-69": (ctx) => {
    if (ctx.batterWins) return {};
    if (!ctx.batterHand.some((c) => c.id === "b-69")) return {};
    if (!ctx.bases[2]) return {};
    return { forceRunFromThird: true, log: ["b-69 Sacrifice Fly: runner on 3rd scores"] };
  },

  // p-58 Strikeout Artist: if pitcher wins by more than 5, the next batter
  // starts with -2 to their effective hand total.
  "p-58": (ctx) => {
    if (ctx.batterWins) return {};
    if (!bestGroupContains(ctx.pitcherResult, "p-58")) return {};
    const margin = ctx.pitcherTotal - ctx.batterTotal;
    if (margin <= 5) return {};
    return {
      pendingDebuffs: [
        {
          appliesToSide: "Batting",
          remainingAtBats: 1,
          totalValueDelta: -2,
          source: "p-58 Strikeout Artist",
        },
      ],
      log: [`p-58 Strikeout Artist: queued -2 for next batter (margin ${margin})`],
    };
  },
};

export function applyResolveStep(ctx: ResolveContext): ResolveDelta {
  const result: ResolveDelta = {
    outsAdjustment: 0,
    removeRunnerHint: null,
    forceRunFromThird: false,
    pendingDebuffs: [],
    log: [],
  };

  const allCards = [...ctx.batterHand, ...ctx.pitcherHand];
  for (const card of allCards) {
    const fn = RESOLVE_STEPS[card.id];
    if (!fn) continue;
    const partial = fn(ctx);
    result.outsAdjustment += partial.outsAdjustment ?? 0;
    if (partial.removeRunnerHint && !result.removeRunnerHint) {
      result.removeRunnerHint = partial.removeRunnerHint;
    }
    if (partial.forceRunFromThird) result.forceRunFromThird = true;
    if (partial.pendingDebuffs?.length) result.pendingDebuffs.push(...partial.pendingDebuffs);
    if (partial.log?.length) result.log.push(...partial.log);
  }
  return result;
}

export const EMPTY_RESOLVE_DELTA: ResolveDelta = EMPTY;
