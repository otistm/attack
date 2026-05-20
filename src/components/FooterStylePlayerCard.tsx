/**
 * FooterStylePlayerCard — compact, role-tinted player card that
 * mirrors the always-on SZN footer rail (`SznFooterDecks` `Card`
 * component) so encounter surfaces -- Player Market listings, the
 * Wildcard Sticker / Swing Adjuster / etc. roster pickers, and any
 * future "pick a player" UI -- read the same way the bottom rail
 * does. The user shouldn't have to context-switch between two
 * different player-card visuals depending on which surface they're
 * looking at.
 *
 * Visual contract
 * ---------------
 *   - 96x136 footprint (same as the footer rail's `CARD_WIDTH_PX` /
 *     `CARD_HEIGHT_PX`).
 *   - Role-tinted gradient: red for batters, green for pitchers
 *     (matches `SznFooterDecks.Card`).
 *   - Big rarity-aware score number centered in the card body.
 *   - Full name label across the bottom (two-line clamp).
 *   - `SznEdgeHalf` connectors poking out the left/right edges --
 *     same component the footer + combat hand use.
 *   - Focused state: amber border + `-translate-y-1` lift (matches
 *     merchant/market focus styling).
 *   - Disabled state: dim + grayscale (greyed-out listings, e.g.
 *     OWNED or ROSTER FULL).
 *   - Optional `badge` chip painted in the top-right corner so
 *     callers can label state without forcing the caller to drop
 *     another node on top of the card.
 *
 * This component is intentionally presentation-only. Callers own
 * value derivation (rarity base + overrides + boosts), edge
 * resolution (overrides + team-logo synthetic), and click semantics
 * (Pick / Sign / Swap). The wrapper button registers hover for
 * gamepad-focus sync so the bottom detail panel updates as the
 * mouse moves.
 */

import { SznEdgeHalf } from "./SznEdgeHalf";
import type { SznEdgeId } from "../lib/sznEdges";
import { teamPalette } from "../lib/teamColors";

export interface FooterStylePlayerCardProps {
  /** Player display name; rendered as the bottom-edge label. */
  name: string;
  /** Drives the gradient tint (red for batters, green for pitchers). */
  role: "Batter" | "Pitcher";
  /**
   * Optional MLB / SZN team code (`NYY`, `LAD`, etc.). When set the
   * card paints with the team palette gradient instead of the
   * fallback red / green role tint -- matches the in-combat
   * `PlayerCard` and the `SznFooterDecks` player chip so the same
   * player reads identically across every surface (footer rail,
   * Series Intro marquee, at-bat lineup, encounter pickers). The
   * role distinction stays legible via the optional `roleTag` corner
   * chip below.
   */
  teamCode?: string | null;
  /**
   * The big number painted in the card body. Callers should pre-apply
   * rarity base + permanent boost + score override so this is just
   * "what the user reads".
   */
  value: number;
  /**
   * SZN edge halves to render on each side. `null` hides the half on
   * that side -- legacy `MlbPlayer` market listings (which lack
   * semantic edges) pass null/null.
   */
  leftEdge: SznEdgeId | null;
  rightEdge: SznEdgeId | null;
  /** Focus ring + lift treatment for keyboard / gamepad focus. */
  focused?: boolean;
  /**
   * Greyed-out, non-interactive state for listings the user can't
   * commit on (already owned, roster cap reached, unaffordable). The
   * click still bubbles but visually the card reads as inert.
   */
  disabled?: boolean;
  /** Optional top-right corner chip (e.g. "OWNED", "ROSTER FULL"). */
  badge?: string | null;
  /** Color class for the badge background ("bg-rose-700", etc.). */
  badgeClass?: string;
  /** Mouse-enter / focus sync for the focused-card detail panel. */
  onHover?: () => void;
  onPick?: () => void;
  tileRef?: (el: HTMLButtonElement | null) => void;
  /** Accessible label override; defaults to `Pick ${name}`. */
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
  onHover,
  onPick,
  tileRef,
  ariaLabel,
}: FooterStylePlayerCardProps) {
  const isPitcher = role === "Pitcher";
  // Prefer the team palette (matches `PlayerCard` + the in-rail
  // SznFooterDecks chip); fall back to the legacy role-tinted
  // red/green gradient when the caller didn't pass a team code.
  let gradient: string;
  if (teamCode) {
    const palette = teamPalette(teamCode);
    gradient = `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`;
  } else {
    gradient = isPitcher
      ? "linear-gradient(135deg, #15803d, #4ade80)"
      : "linear-gradient(135deg, #e53935, #ef5350)";
  }
  const roleTag = isPitcher ? "PIT" : "BAT";
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
        focused ? "-translate-y-1" : ""
      } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div
        className={`relative flex items-center justify-center rounded-lg font-bold text-white ${
          disabled ? "opacity-50 grayscale" : ""
        }`}
        style={{
          width: "96px",
          height: "136px",
          background: gradient,
          border: `3px solid ${focused ? "#fbbf24" : "rgba(255,255,255,0.18)"}`,
          boxShadow: focused
            ? "0 10px 15px rgba(251,191,36,0.4)"
            : "0 4px 6px rgba(0,0,0,0.3)",
          fontSize: "2.5rem",
          textShadow: "1px 1px 4px rgba(0,0,0,0.5)",
        }}
      >
        {value}
        {/* Team + role corner chip mirrors the in-combat `PlayerCard`
            header (team code top-left, role pill). Surfaces the role
            distinction now that team-coded callers paint over the
            legacy red/green role tint. Suppressed when no `teamCode`
            is set so legacy callers keep their original visual. */}
        {teamCode && (
          <span
            aria-hidden
            className="absolute top-1 left-1 rounded bg-black/55 px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-white/95"
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
          >
            {teamCode} · {roleTag}
          </span>
        )}
        {/* Optional state badge -- caller passes "OWNED" / "ROSTER
            FULL" / etc. Lives in the top-right corner so it stacks
            cleanly above the SznEdgeHalf on that side without
            colliding with the name label at the bottom. */}
        {badge && (
          <span
            aria-hidden
            className={`absolute top-1 right-1 rounded px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-white ${badgeClass}`}
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
          >
            {badge}
          </span>
        )}
        <span
          className="absolute bottom-1 left-1 right-1 line-clamp-2 rounded bg-black/55 px-1 py-0.5 text-center text-[9px] font-bold uppercase tracking-tight leading-[1.1] text-white"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
        >
          {name}
        </span>
        {leftEdge && (
          <SznEdgeHalf
            edge={leftEdge}
            side="left"
            isConnected={false}
            compact
          />
        )}
        {rightEdge && (
          <SznEdgeHalf
            edge={rightEdge}
            side="right"
            isConnected={false}
            compact
          />
        )}
      </div>
    </button>
  );
}
