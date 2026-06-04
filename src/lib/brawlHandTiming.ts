import type { CardDefinition } from "./cards";

/** Stagger timing shared by hand deal-in animations (user + CPU reveal). */
export const SIGNATURE_DELAY_CHILDREN = 0.55;
export const SIGNATURE_STAGGER = 0.1;
export const SIGNATURE_SETTLE_PAD = 0.55;
export const GENERAL_STAGGER = 0.45;

/** Milliseconds until the last card in a strip finishes its deal-in spring. */
export function computeHandDealCompleteMs(hand: CardDefinition[]): number {
  if (hand.length === 0) return 0;
  const signatureCount = hand.filter((c) => c.abilityType !== "General Draw").length;
  const lastSigIdx = Math.max(signatureCount - 1, 0);
  const signaturesEndAt = SIGNATURE_DELAY_CHILDREN + lastSigIdx * SIGNATURE_STAGGER;
  const signaturesSettled = signaturesEndAt + SIGNATURE_SETTLE_PAD;

  // All-general hands (element brawl) skip the phantom signature phase.
  const allGeneral = signatureCount === 0;

  let maxDelaySec = 0;
  for (let mountIndex = 0; mountIndex < hand.length; mountIndex++) {
    const isGeneral = hand[mountIndex].abilityType === "General Draw";
    const delay = isGeneral
      ? (allGeneral ? 0 : signaturesSettled) +
        Math.max(allGeneral ? mountIndex : mountIndex - signatureCount, 0) *
          GENERAL_STAGGER
      : SIGNATURE_DELAY_CHILDREN + mountIndex * SIGNATURE_STAGGER;
    maxDelaySec = Math.max(maxDelaySec, delay);
  }
  return Math.ceil(maxDelaySec * 1000 + 650);
}

/** Ms until one card's deal-in spring should finish (stagger delay + settle). */
export function cardEntryAnimDurationMs(delaySec: number): number {
  return Math.ceil(delaySec * 1000 + 650);
}

/** Pause after the CPU hand deal-in before brawl combat projectiles launch. */
export const BRAWL_CPU_DEAL_SETTLE_MS = 200;

/** Delay from reveal start until Player 1's attack phase may begin. */
export function cpuHandRevealDelayMs(hand: CardDefinition[]): number {
  if (hand.length === 0) return 500;
  return computeHandDealCompleteMs(hand) + BRAWL_CPU_DEAL_SETTLE_MS;
}
