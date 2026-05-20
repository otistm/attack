/**
 * SznEdgeHalf — physical-connector renderer for SZN semantic edges.
 *
 * Mirrors the quick-match `ShapeHalf` layout contract (wrapper clipped by
 * `overflow:hidden`, inner shape twice as wide so half pokes out beyond
 * the card silhouette and half forms the visible bump on the card body)
 * so SZN cards present as physical interlocking pieces instead of UI
 * stickers floating near a border.
 *
 * Visual language
 * ---------------
 * The 58 SZN edges resolve to a per-family base shape (offensive=circle,
 * defensive=diamond, positional=square, franchise=star, specialty=hexagon)
 * plus a per-edge tint pulled from `SZN_EDGES[edge].tint`. A handful of
 * marquee edges (`wildcard`, `blank`, `mega-seam`, `defense-shield`,
 * `fastball-102`, `city-connect`) override the family shape so they read
 * with their own personality.
 *
 * Split-glyph readout
 * -------------------
 * Each half also renders the edge's 2-3 letter glyph centered ON the seam
 * axis. The wrapper's `overflow:hidden` naturally clips the outer half of
 * the glyph; the visible half stays inside the card body. When two cards
 * snap together (same edge id on both sides of the seam), their two
 * visible halves combine into a complete glyph reading across the seam —
 * a quiet "ah, that's why they connected" payoff that mirrors the way
 * `ShapeHalf` halves fuse into a complete shape across a snap.
 *
 * Drop-in for `SznEdgeBadge`
 * --------------------------
 * Same prop shape as the deprecated chip component plus the optional
 * `hint`/`dragActive` props `ShapeHalf` exposes — call sites only need to
 * swap the import. Outside-combat surfaces (footer rail, merchant,
 * reward reveal) pass `isConnected={false}` and skip the celebration
 * burst; in-combat surfaces (`PlayerCard` / `CardItem`) forward the
 * neighbor-snap booleans so the burst fires the moment the snap lands.
 */

import { motion } from "motion/react";
import {
  SZN_EDGES,
  type SznEdgeFamily,
  type SznEdgeId,
} from "../lib/sznEdges";
import {
  SHAPE_DEFAULTS,
  type ConnectHint,
  type ShapeType,
} from "./cardShapes";

/**
 * Each SZN edge family maps to a quick-match `ShapeType` so a SZN card
 * sitting next to a quick-match card uses the same geometric alphabet.
 * Per-edge overrides below win where a marquee edge wants its own look.
 */
const SHAPE_BY_FAMILY: Record<SznEdgeFamily, ShapeType> = {
  offensive: "circle",
  defensive: "diamond",
  positional: "square",
  franchise: "star",
  specialty: "wildcard",
};

/**
 * Per-edge silhouette overrides. Anything not listed inherits its
 * family's shape from `SHAPE_BY_FAMILY` above.
 */
const PER_EDGE_OVERRIDE: Partial<Record<SznEdgeId, ShapeType>> = {
  // Specialty wildcards already canonically use the hexagon (matches
  // ShapeHalf's wildcard treatment).
  wildcard: "wildcard",
  // Blank still occupies a slot so card layout doesn't reflow, but is
  // rendered with the same darkened-square + X overlay ShapeHalf uses
  // for `blocked` edges.
  blank: "square",
  // Mega-seam is the "find the other half" puzzle edge -- a literal
  // half-star reads as "this card is half of something larger."
  "mega-seam": "star",
  // Encounter-introduced edges with distinctive personalities.
  "defense-shield": "diamond",
  "fastball-102": "diamond",
  "city-connect": "wildcard",
};

function resolveShape(edge: SznEdgeId): ShapeType {
  return PER_EDGE_OVERRIDE[edge] ?? SHAPE_BY_FAMILY[SZN_EDGES[edge].family];
}

/**
 * 2-3 letter glyph for the edge. Wildcard/blank get their canonical
 * single-character readouts; everything else derives initials from the
 * label so a typo in the registry doesn't fail loudly here.
 */
function resolveGlyph(edge: SznEdgeId): string {
  if (edge === "wildcard") return "*";
  if (edge === "blank") return "X";
  return SZN_EDGES[edge].label
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export interface SznEdgeHalfProps {
  edge: SznEdgeId;
  side: "left" | "right";
  /**
   * True when the neighbor on this seam carries a compatible edge AND
   * is currently snapped. Drives the celebration burst (ring + 5
   * particle pop) and the in-shape brightness/scale pulse.
   */
  isConnected?: boolean;
  /** Half the wrapper / shape size for footer-rail and compact previews. */
  compact?: boolean;
  /**
   * Drag-time legality hint (forwarded to a SZN-mode drag interaction
   * the moment one exists). Today no SZN surface drags-to-place so
   * callers can omit it; keeping the prop keeps parity with `ShapeHalf`
   * so the eventual SZN drag UX can reuse the same legality semantics.
   */
  hint?: ConnectHint;
  /**
   * Suppresses the celebration burst + scale pulse while any card in
   * the parent strip is mid-drag. Same `Reorder.Group` rationale as
   * `ShapeHalf.dragActive` -- prevents seams far from the dragged card
   * from re-firing their connect animations every time the lineup
   * reorders underneath the grabbed card.
   */
  dragActive?: boolean;
}

export function SznEdgeHalf({
  edge,
  side,
  isConnected = false,
  compact = false,
  hint,
  dragActive = false,
}: SznEdgeHalfProps) {
  const meta = SZN_EDGES[edge];
  const isBlank = edge === "blank";
  const visualShape = resolveShape(edge);
  const { rotate, baseScale, borderRadius, clipPath } =
    SHAPE_DEFAULTS[visualShape];
  const color = isBlank ? "#475569" /* slate-600 */ : meta.tint;
  const glyph = resolveGlyph(edge);

  // Dimensions deliberately match `ShapeHalf` so a SZN card sits flush
  // next to a quick-match card and seams align pixel-perfectly.
  const wrapperW = compact ? 14 : 24;
  const wrapperH = compact ? 30 : 48;
  const shapeSize = compact ? 28 : 48;
  const edgeOffset = compact ? 1 : 2;
  const burstSize = compact ? 8 : 12;
  // Glyph size is set so a 3-letter readout (NYY, ALE, etc.) fits
  // across the visible half plus its clipped seam-side neighbor.
  const glyphFontSize = compact ? 7 : 10;

  const hintColor =
    hint === "allow" ? "#10b981" : hint === "block" ? "#ef4444" : null;

  return (
    <>
      <div
        className="absolute top-1/2 -translate-y-1/2 overflow-hidden z-20 flex items-center"
        title={`${meta.label}${meta.blurb ? ` — ${meta.blurb}` : ""}`}
        aria-label={meta.label}
        style={{
          width: `${wrapperW}px`,
          height: `${wrapperH}px`,
          [side === "left" ? "left" : "right"]: `-${edgeOffset}px`,
        }}
      >
        <motion.div
          className="absolute shadow-sm"
          style={{
            width: `${shapeSize}px`,
            height: `${shapeSize}px`,
            backgroundColor: color,
            borderRadius,
            clipPath,
            // Anchor the inner shape to the OPPOSITE side of the wrapper
            // from the card's edge so the visible half of the shape is
            // the half that sits ON the card body. Identical to
            // `ShapeHalf`'s anchoring rule.
            [side === "left" ? "right" : "left"]: 0,
            rotate,
            opacity: isBlank ? 0.55 : 1,
            border: "1.5px solid rgba(0,0,0,0.15)",
          }}
          initial={{ scale: baseScale }}
          animate={
            hintColor
              ? {
                  scale: [baseScale, baseScale * 1.18, baseScale],
                  boxShadow: [
                    `0px 0px 0px ${hintColor}00`,
                    `0px 0px 14px ${hintColor}`,
                    `0px 0px 6px ${hintColor}`,
                  ],
                }
              : dragActive
                ? {
                    scale: baseScale,
                    filter: isConnected ? "brightness(1.2)" : "brightness(1)",
                    boxShadow: isConnected
                      ? `0px 0px 8px ${color}`
                      : "0px 0px 0px rgba(0,0,0,0)",
                  }
                : isConnected
                  ? {
                      scale: [baseScale, baseScale * 1.3, baseScale],
                      filter: [
                        "brightness(1)",
                        "brightness(1.5)",
                        "brightness(1)",
                      ],
                      boxShadow: [
                        "0px 0px 0px rgba(0,0,0,0)",
                        `0px 0px 20px ${color}`,
                        "0px 0px 0px rgba(0,0,0,0)",
                      ],
                    }
                  : {
                      scale: baseScale,
                      filter: "brightness(1)",
                      boxShadow: "0px 0px 0px rgba(0,0,0,0)",
                    }
          }
          transition={
            hintColor
              ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" }
              : dragActive
                ? { duration: 0 }
                : { duration: 0.5, ease: "easeOut" }
          }
        />

        {/* Split-glyph readout. The shape's center sits ON the seam
            axis (wrapper's outer edge in card coords), and the glyph is
            centered on that same axis. The wrapper's `overflow:hidden`
            clips the seam-side half of the glyph; what remains visible
            is the card-side half. Snapped neighbors combine their two
            visible halves into a complete glyph straddling the seam. */}
        <div
          className="absolute top-1/2 font-black uppercase tracking-tight z-30 pointer-events-none whitespace-nowrap leading-none"
          style={{
            fontSize: `${glyphFontSize}px`,
            color: isBlank ? "#94a3b8" : "#ffffff",
            textShadow: "0 1px 2px rgba(0,0,0,0.75)",
            ...(side === "left"
              ? { left: 0, transform: "translate(-50%, -50%)" }
              : { right: 0, transform: "translate(50%, -50%)" }),
          }}
          aria-hidden
        >
          {glyph}
        </div>

        {isBlank && (
          // Diagonal X over the blank edge, mirrors `ShapeHalf`'s
          // `blocked` overlay so the chain-ender reads identically in
          // both modes.
          <div
            className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center"
            aria-hidden
          >
            <div
              className="absolute"
              style={{
                width: "2px",
                height: `${wrapperH * 0.85}px`,
                background: "#f87171" /* red-400 */,
                transform: "rotate(45deg)",
                borderRadius: "2px",
              }}
            />
            <div
              className="absolute"
              style={{
                width: "2px",
                height: `${wrapperH * 0.85}px`,
                background: "#f87171",
                transform: "rotate(-45deg)",
                borderRadius: "2px",
              }}
            />
          </div>
        )}
      </div>

      {/* Connection burst (ring + 5 particles). Gated on
          `!dragActive` for the same reason as `ShapeHalf`: every
          false->true flip mounts the block fresh and replays its
          initial animation, so without this gate every Reorder.Group
          tick mid-drag re-fires bursts on cards far from the user's
          hand. Once the drag releases, the settled state shows bursts
          normally. */}
      {isConnected && !hintColor && !dragActive && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-0 h-0 z-30 pointer-events-none ${
            side === "left" ? "left-0" : "right-0"
          }`}
        >
          <motion.div
            className="absolute rounded-full border-4"
            style={{
              borderColor: color,
              width: `${burstSize * 4}px`,
              height: `${burstSize * 4}px`,
              top: `-${burstSize * 2}px`,
              left: `-${burstSize * 2}px`,
            }}
            initial={{ scale: 0.5, opacity: 1 }}
            animate={{ scale: 2.5, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
          {[...Array(5)].map((_, i) => {
            const angle =
              (i * Math.PI * 2) / 5 + (side === "left" ? 0.3 : 0);
            const distance = compact ? 24 : 40;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;
            return (
              <motion.div
                key={i}
                className="absolute -top-1 -left-1 w-2 h-2 rounded-full"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 0 8px ${color}`,
                }}
                initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                animate={{
                  x,
                  y,
                  scale: [0, 1.5, 0],
                  opacity: [1, 1, 0],
                }}
                transition={{
                  duration: 0.6 + Math.random() * 0.2,
                  ease: "easeOut",
                }}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
