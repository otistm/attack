import type { CardDefinition } from "./cards";
import { canConnectAny, seamKey } from "./connect";

/** Legacy type — element brawl does not use hit outcomes. */
export type HitOutcome =
  | "single"
  | "double"
  | "triple"
  | "homerun"
  | "grandSlam"
  | "out"
  | "walk";

export type BrawlOutcomeResolution = {
  outcome: HitOutcome;
  winnerHP: number;
  grandSlam: boolean;
  batterWon?: boolean;
  batterRemainingHP?: number;
  pitcherRemainingHP?: number;
};

export interface ScoringResult {
  totalValue: number;
  bestGroup: CardDefinition[];
  cardModifiers: Record<string, { value: number; highlight?: string }>;
  forcedOutcome?: HitOutcome;
}

export interface MatchupPreview {
  batterDisplay: number;
  pitcherDisplay: number;
  batterWins: boolean;
  batterScoringResult?: ScoringResult;
  pitcherScoringResult?: ScoringResult;
}

export interface ScoringContext {
  side: "Batting" | "Pitching";
  affirmedSeams?: ReadonlySet<string> | null;
}

/**
 * Build contiguous groups from affirmed seams (or auto-connect when null).
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

export function scoreHand(
  hand: CardDefinition[],
  ctx: ScoringContext,
): ScoringResult {
  const groups = buildGroups(hand, ctx.affirmedSeams ?? null);
  const bestGroup = groups.reduce(
    (best, g) => (g.length > best.length ? g : best),
    groups[0] ?? [],
  );
  const totalValue = hand.reduce((sum, c) => sum + c.baseValue, 0);
  return {
    totalValue,
    bestGroup,
    cardModifiers: {},
  };
}
