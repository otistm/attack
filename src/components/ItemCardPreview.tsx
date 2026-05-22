/**
 * ItemCardPreview — visual-only render of a `CardDefinition` that mirrors
 * the in-game `CardItem` look (white body, shape connectors, big value
 * number, name plate). Used everywhere outside of an active hand:
 *   - Merchant listings
 *   - Dugout drawer
 *   - Event reward reveal
 *   - Roster bag
 *
 * Keeping this strictly presentational means the user sees the same
 * physical card across the entire run -- buying it, looking at it in
 * the bag, and dealing it into combat are all the same object visually,
 * which dissolves the "where is this thing in the game?" question.
 *
 * The footprint matches `CardItem`'s 5:7 ratio (`w-32 h-44`) with a
 * compact variant for tight grids.
 *
 * Hover-ability tooltip
 * ---------------------
 * Mirrors the in-combat `HandCard` ability tooltip: pointer-enter opens
 * a portal-rendered slate-800 panel anchored above the card with the
 * card's name + ability type chip + description; pointer-leave schedules
 * a 120ms close (so the tooltip itself can be hovered for slow-readers).
 * Skipped for cards without a description, for `Player` cards (those
 * are MLB-player tokens with no card-ability text), and when explicitly
 * disabled via `interactiveTooltip={false}`. The tooltip portal lives on
 * `document.body` so it can escape any clipping container (drawer, list,
 * modal) and always lands above the card surface.
 *
 * SZN-mode "hide player attribution"
 * ----------------------------------
 * In SZN mode the user signs MLB players to fill their roster slots,
 * so the legacy `card.player` field on items (e.g. "Mike Trout (2024)")
 * is misleading flavor that doesn't reflect anything the user actually
 * owns. We auto-hide it whenever `gameMode === "szn"`. Callers can
 * force-show via `forceShowPlayer` if a future non-SZN site needs the
 * attribution back.
 */

import { useId, type CSSProperties } from "react";
import { motion } from "motion/react";
import type { CardDefinition } from "../lib/cards";
import { ShapeHalf } from "./CardGameOverlay";
import { shapeModeForSide } from "../lib/connect";
import { useGameStore } from "../lib/gameStore";
import type { SznEdgeId } from "../lib/sznEdges";
import { SznEdgeHalf } from "./SznEdgeHalf";
import { useAbilityHover } from "./useAbilityHover";
import {
  ENCOUNTER_UTILITY_TAGS,
  resolveCardEdges,
} from "../lib/cardDisplay";

// Utility-tag table now lives in `cardDisplay.ts` as
// `ENCOUNTER_UTILITY_TAGS` so the footer rail, the merchant
// preview, the bag picker, and combat all agree on the short-form
// label for a zero-base utility item. Imported above and used in
// the `utilityTag` derivation below.

export interface ItemCardPreviewProps {
  card: CardDefinition;
  /** Compact variant -- 80x112 instead of 128x176. */
  compact?: boolean;
  /** Slightly larger than default for hero reveals (160x224). */
  large?: boolean;
  /** Hover scale on parent click handlers. */
  interactive?: boolean;
  /** Override the displayed value (e.g. show "+3" instead of base 3). */
  valueOverride?: number | null;
  /** Dim the card -- "owned", "out of stock", etc. */
  dimmed?: boolean;
  /** Optional badge text rendered top-right (e.g., "OWNED", "+1"). */
  badge?: string;
  /** Optional badge bg utility class. Defaults to amber. */
  badgeClass?: string;
  /** Optional ribbon at the bottom (e.g. price). */
  footer?: React.ReactNode;
  /**
   * Disable the hover-ability tooltip. Defaults to enabled. Disable for
   * decorative-only renders (e.g. background previews, screenshots).
   */
  interactiveTooltip?: boolean;
  /**
   * Force the player-attribution line back on for non-SZN sites.
   * Defaults `false` (auto-hide in SZN mode).
   */
  forceShowPlayer?: boolean;
}

export function ItemCardPreview({
  card,
  compact = false,
  large = false,
  interactive = false,
  valueOverride,
  dimmed = false,
  badge,
  badgeClass,
  footer,
  interactiveTooltip = true,
  forceShowPlayer = false,
}: ItemCardPreviewProps) {
  // Match the CardItem visual size tokens.
  const sz = large
    ? {
        card: "w-40 h-56 rounded-xl",
        nameText: "text-[11px]",
        playerText: "text-[10px]",
        valueText: "text-6xl",
        valueMargin: "mt-3",
        topPad: "top-2",
      }
    : compact
      ? {
          card: "w-20 h-28 rounded-lg",
          nameText: "text-[7px]",
          playerText: "text-[6px]",
          valueText: "text-3xl",
          valueMargin: "mt-2",
          topPad: "top-1",
        }
      : {
          card: "w-32 h-44 rounded-xl",
          nameText: "text-[9px]",
          playerText: "text-[8px]",
          valueText: "text-5xl",
          valueMargin: "mt-3",
          topPad: "top-2",
        };

  const isGeneralDraw = card.abilityType === "General Draw";
  const isPlayerCard = card.abilityType === "Player";
  // General Draw cards take their label color as the body fill so they
  // stand out in a strip; signature cards stay white.
  const bgClass = isGeneralDraw && card.color ? card.color : "bg-white";
  const valueColor = isGeneralDraw ? "text-white" : "text-slate-800";
  const playerNameColor = isGeneralDraw ? "text-white/80" : "text-slate-400";
  const cardNameClass = isGeneralDraw
    ? "text-white bg-black/20 border-white/30"
    : "text-slate-700 bg-white/95 border-slate-200";

  const leftMode = shapeModeForSide(card, "left");
  const rightMode = shapeModeForSide(card, "right");

  // SZN edge resolution flows through the shared `resolveCardEdges`
  // helper so the merchant preview, the bag picker, the focused
  // detail panel, and combat all paint the same left/right halves
  // for a given card. Same registry gate (drops unregistered ids)
  // applied in every consumer.
  const { leftEdge: sznLeftEdge, rightEdge: sznRightEdge }: {
    leftEdge: SznEdgeId | null;
    rightEdge: SznEdgeId | null;
  } = resolveCardEdges(card);

  const displayValue = valueOverride ?? card.baseValue;
  // Encounter "utility" items intentionally have baseValue 0 -- their
  // effect lives in the snap/aura/instant logic, not the per-card
  // score. Rendering "0" in the big value slot mis-reads as "this
  // does nothing". We map known utility cards to a readable mini-tag
  // (AURA / INTEL / SNAP) so the user sees the card has a job; falls
  // back to an em-dash for any unmapped 0-value encounter card.
  const utilityTag: string | null =
    valueOverride == null && card.baseValue === 0 && card.abilityType === "EncounterItem"
      ? ENCOUNTER_UTILITY_TAGS[card.id] ?? "—"
      : null;

  // SZN-mode strips the legacy real-world player attribution from item
  // cards (it's flavor that has nothing to do with the user's signed
  // roster). `forceShowPlayer` is the escape hatch for any future
  // non-SZN surface that wants the attribution back.
  const sznMode = useGameStore((s) => s.gameMode === "szn");
  const hidePlayerName = sznMode && !forceShowPlayer;

  const hasAbility =
    interactiveTooltip && !isPlayerCard && !!card.description;

  // The hook is always called (React rules-of-hooks); when this
  // surface has decided NOT to show the tooltip (player card / no
  // description / explicit opt-out) we just drop the handlers + the
  // portal stays inert because card.description is missing.
  const { surfaceRef, pointerHandlers, tooltip } = useAbilityHover(card, {
    hidePlayerName,
  });

  const tooltipId = useId();

  const boundPointerHandlers = hasAbility ? pointerHandlers : undefined;

  return (
    <>
      {hasAbility && tooltip}
      <motion.div
        ref={surfaceRef}
        whileHover={interactive ? { scale: 1.04, y: -2 } : undefined}
        whileTap={interactive ? { scale: 0.98 } : undefined}
        className={`${sz.card} ${bgClass} relative border-2 border-slate-200 overflow-visible flex flex-col items-center justify-center shadow-md ${
          dimmed ? "opacity-50 grayscale" : ""
        }`}
        style={
          {
            boxShadow:
              "0 10px 15px -3px rgba(0, 0, 0, 0.25), 0 4px 6px -2px rgba(0, 0, 0, 0.1)",
          } as CSSProperties
        }
        aria-describedby={hasAbility ? tooltipId : undefined}
        {...boundPointerHandlers}
      >
        {/* Edge / shape connectors. SZN-mode cards that declare
            `sznLeftEdge` / `sznRightEdge` render the physical
            half-shape connector (the same `SznEdgeHalf` the in-combat
            `PlayerCard` uses) so the bump the user sees in the
            merchant, reward reveal, and bag matches the bump the card
            snaps with at the plate. Quick-match items (no szn edges)
            and SZN cards that never got semantic edges assigned fall
            back to the geometric shape connector so the legacy snap
            engine still reads correctly. */}
        {sznMode && sznLeftEdge && sznRightEdge ? (
          <>
            <SznEdgeHalf edge={sznLeftEdge} side="left" isConnected={false} compact={compact} />
            <SznEdgeHalf edge={sznRightEdge} side="right" isConnected={false} compact={compact} />
          </>
        ) : (
          <>
            <ShapeHalf
              shape={card.leftShape}
              side="left"
              isConnected={false}
              compact={compact}
              mode={leftMode}
            />
            <ShapeHalf
              shape={card.rightShape}
              side="right"
              isConnected={false}
              compact={compact}
              mode={rightMode}
            />
          </>
        )}

        {/* Player + card name plate (stacked) -- mirrors CardItem signature
            layout. Player name is the small uppercase header; card name
            is the larger plate sitting just below. The player line is
            suppressed in SZN mode (see `hidePlayerName` comment above). */}
        <div
          className={`absolute ${sz.topPad} left-0 right-0 flex flex-col items-center z-30 px-1 text-center w-full`}
        >
          {!hidePlayerName && card.player && (
            <div
              className={`${sz.playerText} font-extrabold uppercase tracking-widest leading-none mb-0.5 truncate max-w-[80%] ${playerNameColor}`}
            >
              {card.player.split(" (")[0]}
            </div>
          )}
          <div
            className={`${sz.nameText} leading-tight font-bold uppercase tracking-wide rounded px-1 py-0.5 line-clamp-2 text-center border shadow-sm ${cardNameClass}`}
            style={{ maxWidth: "78%" }}
          >
            {card.name}
          </div>
        </div>

        {/* Big numeric value -- THE single number that travels with the
            card across every UI surface (in-hand, bag, merchant). Matches
            the in-game CardItem position so the user reads the same
            thing everywhere. Utility cards (encounter items with
            baseValue 0) render their effect tag here instead of "0". */}
        {utilityTag !== null ? (
          <div
            className={`font-black z-20 drop-shadow-sm tracking-widest ${valueColor} ${sz.valueMargin} ${
              large ? "text-xl" : compact ? "text-[10px]" : "text-base"
            }`}
            title="Utility item -- effect is in the snap/aura/instant logic, not a per-card score."
          >
            {utilityTag}
          </div>
        ) : (
          <div
            className={`${sz.valueText} font-black z-20 drop-shadow-sm ${valueColor} ${sz.valueMargin}`}
          >
            {displayValue}
          </div>
        )}

        {/* Optional top-right badge ("OWNED", "+1", etc). */}
        {badge && (
          <div
            className={`absolute -top-2 -right-2 z-40 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest text-white shadow-md ${
              badgeClass ?? "bg-amber-500"
            }`}
          >
            {badge}
          </div>
        )}

        {/* Optional footer ribbon -- price or other meta the caller wants
            to attach without breaking the card silhouette. */}
        {footer && (
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-40 whitespace-nowrap">
            {footer}
          </div>
        )}
      </motion.div>
    </>
  );
}
