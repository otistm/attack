/**
 * PlayerCard — a Topps-style card visualization for an MLB player. Uses the
 * same physical dimensions and shape-connector treatment as `CardItem` in
 * `CardGameOverlay`, but the body is themed with the player's team colors
 * so each card carries its team identity.
 *
 * One source of truth for "what does an MLB player look like as a card?"
 * Rendered everywhere a player appears: the in-game hero rail, the pack-rip
 * reveal screen, the merchant listings, the always-on deck footer, and the SZN
 * combat lineup strip.
 *
 * Visual contract:
 *   - 200×176 standard (`PLAY_CARD`), 125×112 compact.
 *   - Team-color gradient body so the user reads the team at a glance.
 *   - Tier badge in the top-right; class tag chip at the bottom.
 *   - Big numeric readout in the lower-center is the player's combat value
 *     (tier base value, optionally with synergy already folded in).
 *   - Optional shape connectors on the left/right edges so the card can be
 *     dropped into the hand strip and chain to items via the existing
 *     shape engine (the sockets come from `MlbPlayer.leftShape/rightShape`).
 */

import { motion } from "motion/react";
import type { MlbPlayer } from "../lib/players";
import { RARITY_BASE_VALUE, type Rarity, type RosterPlayer } from "../lib/run";
import type { SznPlayer } from "../lib/sznPlayers";
import { isSznPlayer } from "../lib/sznPlayers";
import {
  revealedAbilities,
  totalPotentialSlots,
  triggerGlyph,
} from "../lib/sznPlayerAbilities";
import { PLAY_CARD } from "../lib/cardDisplay";
import { teamPalette } from "../lib/teamColors";
import { ShapeHalf } from "./CardGameOverlay";
import { colorModeForSide, edgeColorForSide, playerAsCard, shapeModeForSide } from "../lib/connect";
import { SznEdgeHalf } from "./SznEdgeHalf";
import {
  RARITY_TEXT,
  RARITY_GRADIENT,
  rarityLabel,
  resolvePlayerEdges,
  resolveSznPlayerEdges,
} from "../lib/cardDisplay";

export interface PlayerCardProps {
  player: MlbPlayer | SznPlayer;
  /** SZN rarity; defaults to common when the card is shown outside a run. */
  rarity?: Rarity;
  /** Override the displayed combat value. Defaults to rarity base value. */
  value?: number;
  /** Hide the value readout entirely (e.g., when used as a profile chip). */
  hideValue?: boolean;
  /** Render shape connectors on the edges. Defaults true. */
  showSockets?: boolean;
  /** Smaller variant for grid listings (24x32 / 96x128 instead of 128x176). */
  compact?: boolean;
  /**
   * Larger variant for hero reveals (e.g. the pack-rip grid). Overrides
   * `compact` when both are passed — large always wins so a future
   * caller passing both can't accidentally collapse to the small size.
   * Footprint: 220×176.
   */
  large?: boolean;
  /** When true, render with `cursor-grab`. The drag handler lives on the parent. */
  draggable?: boolean;
  /** Current connection state on each socket — drives the existing pulse styling. */
  isConnectedLeft?: boolean;
  isConnectedRight?: boolean;
  /** Optional click handler for selection-style interactions. */
  onClick?: () => void;
  /** Highlight ring when picked / focused. */
  selected?: boolean;
  /** Subtle "ghosted" rendering for AI / opponent cards. */
  dimmed?: boolean;
  /** Tag chip override label (e.g. show "Bench" or "Active" in the lineup). */
  badge?: string;
  /**
   * Optional roster slot so the card can render encounter-applied
   * edge overrides + score overrides. When omitted, falls back to the
   * static `SznPlayer` edges and `RARITY_BASE_VALUE[rarity]`.
   */
  rosterSlot?: RosterPlayer;
}

// Rarity label + text colors live in `cardDisplay.ts` so every
// card surface (chip, Topps, combat hand) renders the same color
// and same label for a given rarity. Imported above.

export function PlayerCard({
  player,
  rarity = "common",
  value,
  hideValue = false,
  showSockets = true,
  compact = false,
  large = false,
  draggable = false,
  isConnectedLeft = false,
  isConnectedRight = false,
  onClick,
  selected = false,
  dimmed = false,
  badge,
  rosterSlot,
}: PlayerCardProps) {
  const isSzn = isSznPlayer(player);
  const teamCode = isSzn ? player.teamId : player.team;
  // Rarity gradient is the dominant body color now (audit moved
  // team off the card body so rarity reads as the primary signal).
  // The team is still painted in the top-left team-code chip below.
  // Fall back to the legacy team palette only when no rarity is
  // resolvable -- defensive against external callers that haven't
  // wired rarity yet.
  const rarityStops = RARITY_GRADIENT[rosterSlot?.rarity ?? rarity];
  const fallbackPalette = teamPalette(teamCode);
  const bodyStops = rarityStops ?? fallbackPalette;
  // Score readout flows through the shared `cardDisplay` resolver
  // when a roster slot is supplied — that guarantees the Topps card
  // shows the same number as the footer chip, the at-bat hero, and
  // the merchant preview for a given player. Falls back to the
  // rarity floor when the card is rendered outside a run (collection
  // / preview screens) and no slot is available.
  const baseValue =
    value ??
    (rosterSlot
      ? RARITY_BASE_VALUE[rosterSlot.rarity] +
        (rosterSlot.permanentBoost ?? 0) +
        (rosterSlot.scoreOverride ?? 0)
      : RARITY_BASE_VALUE[rarity]);
  // Edges flow through the shared resolver too — honors encounter
  // overrides + `team-logo` synthetic. When a rosterSlot is supplied
  // we use `resolvePlayerEdges` (override-aware); otherwise we fall
  // back to the raw printed edges via `resolveSznPlayerEdges`.
  const { leftEdge: sznLeft, rightEdge: sznRight } = isSzn
    ? rosterSlot
      ? resolvePlayerEdges(rosterSlot)
      : resolveSznPlayerEdges(player)
    : { leftEdge: null, rightEdge: null };
  // Legacy MlbPlayer uses the shape engine; SZN players render their
  // semantic edge badge instead. We only build the playerCard adapter
  // for legacy players so the shape-mode lookup stays scoped.
  const playerCard = !isSzn ? playerAsCard(player) : null;
  const leftMode = playerCard ? shapeModeForSide(playerCard, "left") : "normal";
  const rightMode = playerCard ? shapeModeForSide(playerCard, "right") : "normal";
  const leftColorMode = playerCard ? colorModeForSide(playerCard, "left") : "normal";
  const rightColorMode = playerCard ? colorModeForSide(playerCard, "right") : "normal";
  const leftEdgeColor = playerCard ? edgeColorForSide(playerCard, "left") : undefined;
  const rightEdgeColor = playerCard ? edgeColorForSide(playerCard, "right") : undefined;

  // `large` wins over `compact` if both are set — defensive against a
  // caller passing both (probably accidentally) and getting the wrong
  // size. Sockets / shape connectors automatically scale with this
  // because the underlying `ShapeHalf` only knows two visual modes
  // (compact + default), so `large` reuses the default sockets.
  const sz = large
    ? {
        card: "w-[220px] h-[176px] rounded-xl",
        nameText: "text-xs",
        teamText: "text-[10px]",
        valueText: "text-6xl",
        topPad: "top-2.5",
        bottomPad: "bottom-2.5",
        tierText: "text-[10px]",
        tagText: "text-[10px]",
      }
    : compact
      ? {
          card: PLAY_CARD.compactCardClass,
          nameText: "text-[8px]",
          teamText: "text-[7px]",
          valueText: "text-3xl",
          topPad: "top-1",
          bottomPad: "bottom-1",
          tierText: "text-[7px]",
          tagText: "text-[7px]",
        }
      : {
          card: PLAY_CARD.cardClass,
          nameText: "text-[10px]",
          teamText: "text-[8px]",
          valueText: "text-5xl",
          topPad: "top-2",
          bottomPad: "bottom-2",
          tierText: "text-[8px]",
          tagText: "text-[8px]",
        };

  return (
    <motion.div
      onClick={onClick}
      whileHover={onClick ? { scale: 1.03 } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      className={`
        relative ${sz.card} border-2 overflow-hidden flex flex-col items-center justify-center
        ${draggable ? "cursor-grab active:cursor-grabbing" : ""}
        ${dimmed ? "opacity-60" : ""}
        ${selected ? "ring-2 ring-amber-300" : ""}
      `}
      style={{
        background: `linear-gradient(160deg, ${bodyStops.primary} 0%, ${bodyStops.secondary} 100%)`,
        borderColor: selected ? "#fbbf24" : "rgba(255,255,255,0.85)",
        boxShadow: selected
          ? "0 0 18px rgba(251, 191, 36, 0.55)"
          : "0 6px 16px rgba(0,0,0,0.5)",
      }}
    >
      {/* Diagonal sheen for a Topps-card feel. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.12) 100%)",
        }}
      />

      {showSockets && !isSzn && (
        <>
          <ShapeHalf
            shape={player.leftShape}
            edgeColor={leftEdgeColor}
            side="left"
            isConnected={isConnectedLeft}
            compact={compact}
            mode={leftMode}
            colorMode={leftColorMode}
          />
          <ShapeHalf
            shape={player.rightShape}
            edgeColor={rightEdgeColor}
            side="right"
            isConnected={isConnectedRight}
            compact={compact}
            mode={rightMode}
            colorMode={rightColorMode}
          />
        </>
      )}
      {showSockets && isSzn && sznLeft && sznRight && (
        <>
          <SznEdgeHalf edge={sznLeft} side="left" isConnected={isConnectedLeft} compact={compact} />
          <SznEdgeHalf edge={sznRight} side="right" isConnected={isConnectedRight} compact={compact} />
        </>
      )}

      {/* Header: team + rarity */}
      <div className={`absolute ${sz.topPad} left-0 right-0 flex justify-between items-start px-2 z-30`}>
        <span
          className={`${sz.teamText} font-black uppercase tracking-widest text-white/90`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
        >
          {teamCode}
        </span>
        <span
          className={`${sz.tierText} font-black uppercase tracking-widest ${RARITY_TEXT[rarity]} bg-black/40 rounded px-1`}
        >
          {badge ?? rarityLabel(rarity)}
        </span>
      </div>

      {/* Name + value. Stacked so the player wordmark sits ABOVE the
          combat number, letting the user read identity first then math. */}
      <div className="relative z-30 flex flex-col items-center justify-center px-1 text-center w-full mt-3">
        <div
          className={`${sz.nameText} font-black uppercase tracking-tight text-white leading-tight bg-black/40 rounded px-1.5 py-0.5 max-w-[88%] line-clamp-2`}
          style={{ textShadow: "0 1px 1px rgba(0,0,0,0.6)" }}
        >
          {player.name}
        </div>
        {!hideValue && (
          <div
            className={`${sz.valueText} font-black text-white drop-shadow mt-2 leading-none`}
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
          >
            {baseValue}
          </div>
        )}
      </div>

      {/* Abilities strip: passive glyph plus a row of revealed /
          locked potential slots. SZN-only -- legacy MlbPlayer carries no
          ability data so the row collapses to null for those. Skips the
          compact (chip-scale) variant where there's no room. */}
      {isSzn && !compact && (
        <AbilitiesStrip
          player={player}
          rarity={rosterSlot?.rarity ?? rarity}
        />
      )}

      {/* Footer: role + tag chip. */}
      <div className={`absolute ${sz.bottomPad} left-0 right-0 flex justify-between items-end px-2 z-30`}>
        <span
          className={`${sz.tagText} font-black uppercase tracking-widest text-white/85`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
        >
          {player.role === "Batter" ? "BAT" : "PIT"} · {player.handedness}
        </span>
        <span
          className={`${sz.tagText} font-black uppercase tracking-wider text-emerald-200 bg-emerald-900/60 rounded px-1`}
        >
          {player.tag}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * Mini strip rendered between the value readout and the role / tag
 * footer on the Topps PlayerCard. Shows the passive's trigger glyph
 * plus 1-3 potential pips (filled if revealed at the current rarity,
 * hollow / muted if still locked). The user gets a visual cue that
 * the player has growth room WITHOUT needing the focused tooltip.
 */
function AbilitiesStrip({
  player,
  rarity,
}: {
  player: SznPlayer;
  rarity: Rarity;
}) {
  const revealed = revealedAbilities(player, rarity);
  const totalSlots = totalPotentialSlots(player);
  const revealedPotentialCount = revealed.length - 1;
  return (
    <div
      aria-hidden
      className="absolute left-0 right-0 z-30 flex items-center justify-center gap-1"
      style={{ bottom: "26px" }}
      title={`Passive: ${player.passive.name}`}
    >
      <span
        className="text-[10px] leading-none rounded-full bg-black/60 px-1.5 py-0.5 text-amber-200"
        style={{ textShadow: "0 1px 1px rgba(0,0,0,0.7)" }}
      >
        {triggerGlyph(player.passive.trigger)}
      </span>
      {Array.from({ length: totalSlots }).map((_, i) => {
        const unlocked = i < revealedPotentialCount;
        return (
          <span
            key={i}
            className="block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: unlocked ? "rgba(249, 226, 175, 0.9)" : "rgba(255, 255, 255, 0.18)",
              boxShadow: unlocked ? "0 0 4px rgba(249, 226, 175, 0.6)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
