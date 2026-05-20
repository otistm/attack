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
 *   - 5:7 ratio (`w-32 h-44` standard, `w-24 h-32` compact).
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
import { teamPalette } from "../lib/teamColors";
import { ShapeHalf } from "./CardGameOverlay";
import { shapeModeForSide } from "../lib/connect";
import { playerAsCard } from "../lib/connect";
import type { SznEdgeId } from "../lib/sznEdges";
import { teamLogoEdge } from "../lib/sznTeams";
import { SznEdgeHalf } from "./SznEdgeHalf";

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
   * Footprint: 176x240 (`w-44 h-60`).
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

const RARITY_LABEL: Record<Rarity, string> = {
  common: "COMMON",
  allstar: "ALL STAR",
  veteran: "VETERAN",
  legend: "LEGEND",
};

const RARITY_TEXT: Record<Rarity, string> = {
  common: "text-orange-300",
  allstar: "text-slate-200",
  veteran: "text-amber-300",
  legend: "text-cyan-200",
};

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
  const palette = teamPalette(teamCode);
  // Score readout: encounter `scoreOverride` and rookie/veteran
  // `permanentBoost` both stack on the rarity floor when no explicit
  // value override is provided.
  const baseValue =
    value ??
    RARITY_BASE_VALUE[rarity] +
      (rosterSlot?.permanentBoost ?? 0) +
      (rosterSlot?.scoreOverride ?? 0);
  // Encounter edge overrides take precedence over the static SznPlayer
  // edges. team-logo syntheticas resolve to the holder's franchise
  // logo so a Wildcard Sticker stamped as "team-logo" reads as
  // "yankees-logo" on a Yankees player card.
  const sznLeftRaw = isSzn ? (rosterSlot?.leftEdgeOverride ?? player.leftEdge) : null;
  const sznRightRaw = isSzn ? (rosterSlot?.rightEdgeOverride ?? player.rightEdge) : null;
  const sznLeft: SznEdgeId | null =
    isSzn && sznLeftRaw
      ? sznLeftRaw === "team-logo"
        ? teamLogoEdge(player.teamId)
        : sznLeftRaw
      : null;
  const sznRight: SznEdgeId | null =
    isSzn && sznRightRaw
      ? sznRightRaw === "team-logo"
        ? teamLogoEdge(player.teamId)
        : sznRightRaw
      : null;
  // Legacy MlbPlayer uses the shape engine; SZN players render their
  // semantic edge badge instead. We only build the playerCard adapter
  // for legacy players so the shape-mode lookup stays scoped.
  const playerCard = !isSzn ? playerAsCard(player) : null;
  const leftMode = playerCard ? shapeModeForSide(playerCard, "left") : "normal";
  const rightMode = playerCard ? shapeModeForSide(playerCard, "right") : "normal";

  // `large` wins over `compact` if both are set — defensive against a
  // caller passing both (probably accidentally) and getting the wrong
  // size. Sockets / shape connectors automatically scale with this
  // because the underlying `ShapeHalf` only knows two visual modes
  // (compact + default), so `large` reuses the default sockets.
  const sz = large
    ? {
        card: "w-44 h-60 rounded-xl",
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
          card: "w-24 h-32 rounded-lg",
          nameText: "text-[8px]",
          teamText: "text-[7px]",
          valueText: "text-3xl",
          topPad: "top-1",
          bottomPad: "bottom-1",
          tierText: "text-[7px]",
          tagText: "text-[7px]",
        }
      : {
          card: "w-32 h-44 rounded-xl",
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
        background: `linear-gradient(160deg, ${palette.primary} 0%, ${palette.secondary} 100%)`,
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
            side="left"
            isConnected={isConnectedLeft}
            compact={compact}
            mode={leftMode}
          />
          <ShapeHalf
            shape={player.rightShape}
            side="right"
            isConnected={isConnectedRight}
            compact={compact}
            mode={rightMode}
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
          {badge ?? RARITY_LABEL[rarity]}
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
