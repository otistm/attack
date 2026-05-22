/**
 * FooterStylePlayerCard — compact player chip used on every non-bag
 * surface that needs to show a roster player at the footer-rail
 * scale (player market, encounter pickers, series intro). Renders
 * through the unified `<SznCard>` so the chip is identical to the
 * footer rail entry for the same player.
 *
 * Responsibilities that live here:
 *   - Click semantics (button + disabled state)
 *   - Gamepad-focus sync via `onHover`
 *   - `tileRef` exposure for any wrapping animation.
 */

import type { SznEdgeId } from "../lib/sznEdges";
import type { Rarity } from "../lib/run";
import { SznCard } from "./SznCard";

export interface FooterStylePlayerCardProps {
  name: string;
  role: "Batter" | "Pitcher";
  /**
   * Optional MLB / SZN team code. Drives the team-code chip in the
   * card's top-left corner so the user can still read which team
   * the player belongs to. The card BODY gradient is driven by
   * `rarity` (see below) -- the audit asked for rarity, not team,
   * to be the dominant color signal across every player surface.
   */
  teamCode?: string | null;
  /**
   * Player rarity. Drives the card-body gradient (copper / silver /
   * gold / cosmic) and the top-right rarity badge. Defaults to
   * `common` so legacy callers that don't pass rarity still get a
   * sensible color (instead of falling back to the old role tint).
   */
  rarity?: Rarity;
  value: number;
  leftEdge: SznEdgeId | null;
  rightEdge: SznEdgeId | null;
  focused?: boolean;
  disabled?: boolean;
  badge?: string | null;
  badgeClass?: string;
  onHover?: () => void;
  onPick?: () => void;
  tileRef?: (el: HTMLButtonElement | null) => void;
  ariaLabel?: string;
}

export function FooterStylePlayerCard({
  name,
  role,
  value,
  leftEdge,
  rightEdge,
  focused = false,
  disabled = false,
  badge,
  badgeClass = "bg-slate-800",
  teamCode,
  rarity = "common",
  onHover,
  onPick,
  tileRef,
  ariaLabel,
}: FooterStylePlayerCardProps) {
  const state = disabled ? "disabled" : focused ? "focused" : "default";
  return (
    <button
      ref={tileRef}
      type="button"
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={disabled ? undefined : onPick}
      disabled={disabled}
      aria-label={ariaLabel ?? `Pick ${name}`}
      className={`appearance-none p-0 m-0 outline-none rounded-lg transition-transform ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <SznCard
        variant="player"
        size="chip"
        state={state}
        value={value}
        label={name}
        role={role}
        teamCode={teamCode}
        rarity={rarity}
        edges={{ left: leftEdge, right: rightEdge }}
        badge={badge ?? null}
        badgeClass={badgeClass}
        ariaLabel={ariaLabel ?? `Pick ${name}`}
      />
    </button>
  );
}
