import type { CardDefinition } from "./cards";

export type QuestReward =
  | { kind: "battingHitScale"; amount: number }
  | { kind: "forceHomerunOnce" }
  | { kind: "wildcardNextBatterHand" }
  | { kind: "cosmeticLegendary" };

export interface QuestRewardStateSlice {
  questPendingBattingHitScale: number;
  questForceHomerunOnce: boolean;
  questWildcardNextBatterHand: boolean;
  /** Stadium / overlay: trigger extended legendary VFX once */
  questLegendaryCelebratePulse: boolean;
}

export const QUEST_REWARD_INITIAL: QuestRewardStateSlice = {
  questPendingBattingHitScale: 0,
  questForceHomerunOnce: false,
  questWildcardNextBatterHand: false,
  questLegendaryCelebratePulse: false,
};

export function mergeQuestReward(
  prev: QuestRewardStateSlice,
  reward: QuestReward,
): QuestRewardStateSlice {
  switch (reward.kind) {
    case "battingHitScale":
      return {
        ...prev,
        questPendingBattingHitScale: prev.questPendingBattingHitScale + reward.amount,
      };
    case "forceHomerunOnce":
      return { ...prev, questForceHomerunOnce: true };
    case "wildcardNextBatterHand":
      return { ...prev, questWildcardNextBatterHand: true };
    case "cosmeticLegendary":
      return { ...prev, questLegendaryCelebratePulse: true };
    default:
      return prev;
  }
}

export function questRewardDescription(reward: QuestReward): string {
  switch (reward.kind) {
    case "battingHitScale":
      return `+${reward.amount} Hit Scale on your next batting trip`;
    case "forceHomerunOnce":
      return "Next batting win can be crushed for a home run";
    case "wildcardNextBatterHand":
      return "Next batting hand: left edge of first General is a wildcard";
    case "cosmeticLegendary":
      return "Legendary fireworks + celebration";
    default:
      return "Mystery loot";
  }
}

/**
 * Patch the first General Draw card's left edge to wildcard for combining.
 */
export function applyWildcardToFirstGeneral(batterHand: CardDefinition[]): CardDefinition[] {
  const idx = batterHand.findIndex((c) => c.abilityType === "General Draw");
  if (idx < 0) return batterHand;
  return batterHand.map((c, i) => {
    if (i !== idx) return c;
    return {
      ...c,
      combineConstraint: {
        ...c.combineConstraint,
        leftWildcard: true,
      },
    };
  });
}
