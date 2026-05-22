/**
 * SznCard — the unified card surface for SZN mode.
 *
 * Every card-shaped UI in the franchise mode renders through this
 * component: footer rail chips, merchant listings, player market
 * listings, encounter pickers, item previews, pack-rip reveal, hero
 * rail, combat hand (data layer). Picking one shell means the user
 * reads the same fonts, padding, borders, focus state, rarity
 * treatment, edge connectors, and CTA placement at every surface —
 * there is exactly one "card design" in SZN mode, with size variants
 * for context (chip in the footer, standard in combat, large on the
 * pack-rip table).
 *
 * Props are intentionally small:
 *   - `variant`     — player vs. ability (drives header/footer rows)
 *   - `size`        — chip / compact / standard / large (drives px + font)
 *   - `state`       — visual focus/selected/connected/sell/disabled
 *   - `value`       — what number / utility tag to print in the body
 *   - `label`       — the bottom-edge name strip
 *   - `teamCode`    — drives the gradient on player cards
 *   - `rarity`      — drives the top-right tier badge on player cards
 *   - `itemTier`    — drives the top-left B/S/G glyph on ability cards
 *   - `edges`       — `{ left, right }` semantic edge halves
 *   - `badge`       — top-right state chip ("OWNED", "BAG FULL", ...)
 *   - `cta`         — optional ribbon BELOW the card body (price chip, etc.)
 *   - `topLeftSlot` — escape hatch for a custom corner (e.g. tier glyph
 *                     when the caller already paints its own)
 *
 * Click semantics, animation, hover-tooltip, and per-surface state
 * machine logic live OUTSIDE this component — wrappers like
 * `FooterStyleAbilityCard` or `PlayerCard` provide context-specific
 * affordances (gamepad focus sync, ability tooltip, score override)
 * by composing SznCard inside their own button / motion shell.
 */

import React from "react";
import { SznEdgeHalf } from "./SznEdgeHalf";
import { ShapeHalf } from "./CardGameOverlay";
import type { ShapeMode, ShapeType } from "./cardShapes";
import type { SznEdgeId } from "../lib/sznEdges";
import {
  SZN_CARD_SIZES,
  SZN_CARD_STATE,
  type SznCardSize,
  type SznCardState,
  TIER_GLYPH,
  TIER_LABEL,
  TIER_TINT,
  RARITY_TEXT,
  RARITY_GRADIENT,
  rarityLabel,
  isUtilityValue,
  abilityCardGradient,
  type ItemTier,
} from "../lib/cardDisplay";
import type { Rarity } from "../lib/run";

export type SznCardVariant = "player" | "ability";

/**
 * Background gradient for the unified card body.
 *
 * Player cards paint with a RARITY-driven gradient (copper / silver /
 * gold / cosmic) so the card body itself communicates tier at a
 * glance. The team is still legible via the team-code chip in the
 * top-left corner -- pulling team off the body removes the "every
 * Yankee is blue" wall and lets a single card's rarity be the
 * primary visual signal. Falls back to the role-tinted gradient
 * only when no rarity OR team is available (defensive: legacy
 * MlbPlayer rendering paths).
 *
 * Ability cards used to share a single fixed blue rail gradient
 * which made every Encounter Item, Signature, MegaHalf, and General
 * Draw read as the same chip. They now route through
 * {@link abilityCardGradient} so each {@link CardAbilityType} (and
 * each item tier) paints a distinct body, while still falling back
 * to the legacy blue for cards whose abilityType isn't registered
 * in the token map.
 */
function bodyGradient(
  variant: SznCardVariant,
  _teamCode: string | null | undefined,
  role: "Batter" | "Pitcher" | undefined,
  rarity: Rarity | undefined,
  abilityType: string | undefined | null,
  itemTier: ItemTier | undefined | null,
): string {
  if (variant === "ability") {
    const { primary, secondary, overlay } = abilityCardGradient(
      abilityType,
      itemTier ?? null,
    );
    // Stack the tier overlay ON TOP of the ability-type body. CSS
    // background accepts comma-separated layered gradients; the
    // first layer wins for opacity at the same stop, so we paint
    // the tier overlay (transparent at bronze, soft silver / gold
    // wash at the higher tiers) above the type-tinted body.
    if (overlay) {
      return [
        `linear-gradient(135deg, ${overlay.primary}, ${overlay.secondary})`,
        `linear-gradient(135deg, ${primary}, ${secondary})`,
      ].join(", ");
    }
    return `linear-gradient(135deg, ${primary}, ${secondary})`;
  }
  if (rarity) {
    const { primary, secondary } = RARITY_GRADIENT[rarity];
    return `linear-gradient(135deg, ${primary}, ${secondary})`;
  }
  if (role === "Pitcher") {
    return "linear-gradient(135deg, #15803d, #4ade80)";
  }
  return "linear-gradient(135deg, #e53935, #ef5350)";
}

export interface SznCardProps {
  variant: SznCardVariant;
  size?: SznCardSize;
  state?: SznCardState;
  /** Big body readout: a number for normal cards, a tag string for utility items. */
  value: number | string;
  /** Bottom-edge name strip. */
  label: string;
  /** Player team code drives the gradient when variant is "player". */
  teamCode?: string | null;
  /** Player role drives the fallback gradient + corner role chip. */
  role?: "Batter" | "Pitcher";
  /** Player rarity drives the top-right rarity badge (player variant only). */
  rarity?: Rarity;
  /** Ability item tier drives the top-left B/S/G glyph (ability variant only). */
  itemTier?: ItemTier | null;
  /**
   * `CardAbilityType` for ability variant cards (Signature, General
   * Draw, EncounterItem, MegaHalf, etc). Drives the body gradient
   * through {@link abilityCardGradient} so each type reads as a
   * distinct chip. Player variant ignores this. Omit / null falls
   * back to the legacy blue rail gradient so existing callers
   * don't regress.
   */
  abilityType?: string | null;
  /** Optional semantic edge halves on the left/right. */
  edges?: {
    left?: SznEdgeId | null;
    right?: SznEdgeId | null;
  };
  /**
   * Optional legacy shape connectors on the left/right (for
   * non-SZN MlbPlayer cards in the pack-rip / collection screens).
   * Mutually exclusive with `edges` — caller should pick one
   * connector style.
   */
  legacyShapes?: {
    leftShape: ShapeType;
    rightShape: ShapeType;
    isConnectedLeft?: boolean;
    isConnectedRight?: boolean;
    leftMode?: ShapeMode;
    rightMode?: ShapeMode;
  };
  /** True if the player's leftEdge is currently connected to a partner. */
  isConnectedLeft?: boolean;
  /** True if the player's rightEdge is currently connected to a partner. */
  isConnectedRight?: boolean;
  /** Optional state chip in the top-right corner (e.g. "OWNED"). */
  badge?: string | null;
  /** Tailwind background class for the badge. Defaults to slate. */
  badgeClass?: string;
  /** Optional node rendered immediately BELOW the card body (price chip, etc.). */
  cta?: React.ReactNode;
  /** Custom top-left slot — overrides the default tier glyph / team chip. */
  topLeftSlot?: React.ReactNode;
  /** Hide the bottom name strip (used by the hero rail where the name lives elsewhere). */
  hideLabel?: boolean;
  /** Hide the big body value (e.g. the hero rail paints the value beside the card). */
  hideValue?: boolean;
  /** Render in a "ghosted" / dimmed style without disabling pointer events. */
  dimmed?: boolean;
  /**
   * Forwarded to the inner card body so parents can measure the
   * bounding rect (e.g. for the fly-to-footer purchase animation,
   * for the ability-hover tooltip anchor). Accepts either a React
   * RefObject or a callback ref.
   */
  containerRef?: React.Ref<HTMLDivElement>;
  /** Optional aria-label override; defaults to the card label. */
  ariaLabel?: string;
  /** Optional extra classes appended to the outer wrapper. */
  className?: string;
}

/**
 * Resolve the final card state. `disabled` always wins because it's
 * the most restrictive; otherwise the caller-provided state is
 * honored. Falls back to `default` so callers can simply omit
 * `state` for unfocused cards.
 */
function resolveState(state: SznCardState | undefined): SznCardState {
  return state ?? "default";
}

export function SznCard({
  variant,
  size = "chip",
  state,
  value,
  label,
  teamCode,
  role,
  rarity,
  itemTier,
  abilityType,
  edges,
  legacyShapes,
  isConnectedLeft,
  isConnectedRight,
  badge,
  badgeClass = "bg-slate-800",
  cta,
  topLeftSlot,
  hideLabel = false,
  hideValue = false,
  dimmed = false,
  containerRef,
  ariaLabel,
  className,
}: SznCardProps) {
  const sz = SZN_CARD_SIZES[size];
  const visualState = resolveState(state);
  const stateTokens = SZN_CARD_STATE[visualState];
  const gradient = bodyGradient(variant, teamCode, role, rarity, abilityType, itemTier);
  const isUtility = isUtilityValue(value);
  // Border width: standard/large cards stay at 2px (Topps look);
  // chip / compact cards use the 3px footer rail border so the
  // focus state pops on a smaller surface without competing with
  // the body label.
  const borderWidth = size === "standard" || size === "large" ? 2 : 3;
  // Padding for the header/footer absolute strips: scales with
  // size so the larger cards aren't crowded by the rarity badge.
  const headerTop = size === "large" ? "top-2.5" : size === "standard" ? "top-2" : "top-1";
  const footerBot =
    size === "large" ? "bottom-2.5" : size === "standard" ? "bottom-2" : "bottom-1";

  // Compose the per-variant top-right badge:
  //  - player: rarity label (e.g. "ALL STAR") unless `badge` overrides.
  //  - ability: caller-supplied `badge` only; no auto badge.
  const playerRarityBadge =
    variant === "player" && rarity && !badge
      ? {
          text: rarityLabel(rarity),
          className: `${RARITY_TEXT[rarity]} bg-black/40 rounded px-1`,
        }
      : null;
  const callerBadge = badge
    ? {
        text: badge,
        className: `${badgeClass} text-white rounded px-1 py-0.5`,
      }
    : null;

  // Top-left slot precedence:
  //   1. Caller-supplied topLeftSlot (escape hatch).
  //   2. Player + teamCode: team code + role chip.
  //   3. Ability + itemTier: B/S/G tier glyph.
  let topLeft: React.ReactNode = topLeftSlot;
  if (!topLeft) {
    if (variant === "player" && teamCode) {
      const roleTag = role === "Pitcher" ? "PIT" : "BAT";
      topLeft = (
        <span
          aria-hidden
          className={`${sz.teamTextClass} font-black uppercase tracking-widest text-white/95 bg-black/55 rounded px-1 py-0.5`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
        >
          {teamCode} · {roleTag}
        </span>
      );
    } else if (variant === "ability" && itemTier) {
      topLeft = (
        <span
          aria-hidden
          className={`${sz.teamTextClass} font-black uppercase tracking-widest rounded px-1 py-0.5`}
          style={{
            color: TIER_TINT[itemTier],
            background: "rgba(0,0,0,0.55)",
            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          }}
          aria-label={`${TIER_LABEL[itemTier]} tier`}
        >
          {TIER_GLYPH[itemTier]}
        </span>
      );
    }
  }

  const body = (
    <div
      ref={containerRef}
      className={`relative overflow-hidden flex items-center justify-center font-bold text-white ${sz.radiusClass} ${stateTokens.transformClass} transition-transform ${dimmed ? "opacity-60" : ""}`}
      style={{
        width: `${sz.widthPx}px`,
        height: `${sz.heightPx}px`,
        background: gradient,
        border: `${borderWidth}px solid ${stateTokens.borderColor}`,
        boxShadow: stateTokens.boxShadow,
        textShadow: "1px 1px 4px rgba(0,0,0,0.5)",
      }}
      aria-label={ariaLabel ?? label}
    >
      {/* Diagonal sheen for a Topps-card feel. Only painted on the
          standard/large player surfaces — chip-size cards are too
          small for the sheen to read and it muddies the value. */}
      {variant === "player" && (size === "standard" || size === "large") && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.12) 100%)",
          }}
        />
      )}

      {/* Edge halves — semantic SZN edges win; legacy shape sockets
          render only when the caller explicitly opts in via
          `legacyShapes` AND no SZN edge resolved on that side. */}
      {edges?.left ? (
        <SznEdgeHalf
          edge={edges.left}
          side="left"
          isConnected={!!isConnectedLeft}
          compact={size === "chip" || size === "compact"}
        />
      ) : legacyShapes ? (
        <ShapeHalf
          shape={legacyShapes.leftShape}
          side="left"
          isConnected={!!legacyShapes.isConnectedLeft}
          compact={size === "chip" || size === "compact"}
          mode={legacyShapes.leftMode ?? "normal"}
        />
      ) : null}
      {edges?.right ? (
        <SznEdgeHalf
          edge={edges.right}
          side="right"
          isConnected={!!isConnectedRight}
          compact={size === "chip" || size === "compact"}
        />
      ) : legacyShapes ? (
        <ShapeHalf
          shape={legacyShapes.rightShape}
          side="right"
          isConnected={!!legacyShapes.isConnectedRight}
          compact={size === "chip" || size === "compact"}
          mode={legacyShapes.rightMode ?? "normal"}
        />
      ) : null}

      {/* Top-left: tier glyph for abilities, team chip for players. */}
      {topLeft && (
        <span className={`absolute ${headerTop} left-1 z-30 flex items-start`}>
          {topLeft}
        </span>
      )}

      {/* Top-right: caller badge wins; rarity badge for players is fallback. */}
      {(callerBadge || playerRarityBadge) && (
        <span
          aria-hidden
          className={`absolute ${headerTop} right-1 z-30 ${sz.badgeTextClass} font-black uppercase tracking-widest ${
            callerBadge ? callerBadge.className : playerRarityBadge!.className
          }`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
        >
          {callerBadge ? callerBadge.text : playerRarityBadge!.text}
        </span>
      )}

      {/* Big body value. Numeric → big font; utility tag → small. */}
      {!hideValue && (
        <span
          className="relative z-20 font-black leading-none"
          style={{
            fontSize: isUtility ? sz.utilityFontSize : sz.valueFontSize,
            letterSpacing: isUtility ? "0.05em" : "normal",
            textShadow: "0 2px 6px rgba(0,0,0,0.7)",
          }}
        >
          {value}
        </span>
      )}

      {/* Bottom name strip — shared rendering for player + ability. */}
      {!hideLabel && (
        <span
          className={`absolute ${footerBot} left-1 right-1 z-30 line-clamp-2 rounded bg-black/55 ${sz.padClass} py-0.5 text-center ${sz.nameTextClass} font-bold uppercase tracking-tight leading-[1.1] text-white`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
        >
          {label}
        </span>
      )}
    </div>
  );

  if (!cta) {
    return className ? <div className={className}>{body}</div> : body;
  }

  return (
    <div className={`flex flex-col items-center gap-1 ${className ?? ""}`}>
      {body}
      {cta}
    </div>
  );
}
