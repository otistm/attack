/**
 * FooterStyleAbilityCard — compact ability/item chip used on every
 * non-bag encounter surface (merchant listings, encounter previews,
 * purchase-flight ghost). Renders through the unified `<SznCard>` so
 * the chip is visually indistinguishable from the always-on footer
 * rail entry for the same card.
 *
 * Responsibilities that live here (and not in `SznCard`):
 *   - Click semantics (button + disabled state)
 *   - Gamepad-focus sync via `onHover`
 *   - Hover-ability tooltip via `useAbilityHover`
 *   - `tileRef` exposure so callers can measure the chip for the
 *     fly-to-footer purchase animation.
 */

import { useGameStore } from "../lib/gameStore";
import { useAbilityHover } from "./useAbilityHover";
import type { CardDefinition } from "../lib/cards";
import { SznCard } from "./SznCard";
import {
  displayValueFor,
  resolveCardEdges,
  type ItemTier,
} from "../lib/cardDisplay";

/**
 * Re-exported display helper so callers that previously imported
 * `valueForAbilityCard` from this module keep working. The
 * implementation lives in `cardDisplay.ts`; this name is preserved
 * for backwards compatibility with `MerchantView.ListingCard` and
 * any other consumer.
 */
export function valueForAbilityCard(def: CardDefinition): number | string {
  return displayValueFor(def);
}

export interface FooterStyleAbilityCardProps {
  card: CardDefinition;
  focused?: boolean;
  disabled?: boolean;
  badge?: string | null;
  badgeClass?: string;
  /** Optional ability tier glyph in the top-left (B / S / G). */
  itemTier?: ItemTier | null;
  onHover?: () => void;
  onPick?: () => void;
  tileRef?: (el: HTMLButtonElement | null) => void;
  ariaLabel?: string;
  /** Enable the shared ability hover tooltip. Defaults `true`. */
  showDescriptionTooltip?: boolean;
}

export function FooterStyleAbilityCard({
  card,
  focused = false,
  disabled = false,
  badge,
  badgeClass = "bg-slate-800",
  itemTier = null,
  onHover,
  onPick,
  tileRef,
  ariaLabel,
  showDescriptionTooltip = true,
}: FooterStyleAbilityCardProps) {
  const value = displayValueFor(card);
  const { leftEdge, rightEdge } = resolveCardEdges(card);
  const sznMode = useGameStore((s) => s.gameMode === "szn");
  const { surfaceRef, pointerHandlers, tooltip } = useAbilityHover(card, {
    hidePlayerName: sznMode,
    forceOpen: focused,
  });
  const tooltipEnabled = showDescriptionTooltip && !!card.description;
  const boundPointerHandlers = tooltipEnabled ? pointerHandlers : undefined;
  const state = disabled ? "disabled" : focused ? "focused" : "default";
  return (
    <>
      {tooltipEnabled && tooltip}
      <button
        ref={tileRef}
        type="button"
        onMouseEnter={onHover}
        onFocus={onHover}
        onClick={disabled ? undefined : onPick}
        disabled={disabled}
        aria-label={ariaLabel ?? `Pick ${card.name}`}
        className={`appearance-none p-0 m-0 outline-none rounded-lg transition-transform ${
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        {...boundPointerHandlers}
      >
        <SznCard
          variant="ability"
          size="chip"
          state={state}
          value={value}
          label={card.name}
          itemTier={itemTier}
          abilityType={card.abilityType}
          edges={{ left: leftEdge, right: rightEdge }}
          badge={badge ?? null}
          badgeClass={badgeClass}
          containerRef={surfaceRef}
          ariaLabel={ariaLabel ?? `Pick ${card.name}`}
        />
      </button>
    </>
  );
}
