/**
 * Player-facing copy for the card focus overlay.
 */
import type { CardDefinition } from "./cards";
import { buildGroups } from "./scoring";
import { brawlCardOverlayCooldownMs } from "./brawlElements";

const ELEMENT_ACTIVATED_PREFIX =
  /^(Fire|Freeze|Volt|Poison|Shield|Heal)\s+activated:\s*/i;

/** Catalog lines: strip element name; UI shows element tags when snapped. */
export function normalizeIfActivatedCopy(text: string): string {
  return text.replace(ELEMENT_ACTIVATED_PREFIX, "If activated: ");
}

/** Ability line on the card face and focus panel (no element prefix). */
export function cardDisplayAbilityText(card: CardDefinition): string {
  const raw = card.brawlTagline ?? card.description?.trim() ?? "";
  return normalizeIfActivatedCopy(raw);
}

/** @deprecated alias — use `cardDisplayAbilityText`. */
export function cardAbilityDescription(card: CardDefinition): string {
  return cardDisplayAbilityText(card);
}

/** Cooldown in whole seconds (planning: from chain length; combat: live remaining). */
export function cardFocusCooldownSeconds(
  cardId: string,
  hand: readonly CardDefinition[] | undefined,
  affirmedSeams: ReadonlySet<string> | null | undefined,
  combatRemainingMs: number | null,
): number {
  if (combatRemainingMs != null) {
    return Math.max(0, Math.ceil(combatRemainingMs / 1000));
  }
  if (!hand?.length) {
    return Math.round(brawlCardOverlayCooldownMs(1) / 1000);
  }
  const groups = buildGroups([...hand], affirmedSeams ?? null);
  for (const group of groups) {
    if (group.some((c) => c.id === cardId)) {
      return Math.round(brawlCardOverlayCooldownMs(group.length) / 1000);
    }
  }
  return Math.round(brawlCardOverlayCooldownMs(1) / 1000);
}
