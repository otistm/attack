/**
 * PurchaseFlightOverlay — renders the "card flies into the footer"
 * animation that fires whenever an encounter (Merchant, Event) commits
 * a new item card to the bag. The encounter view publishes a
 * `purchaseFlight` payload to the store with source / target DOMRects
 * (source = the listing tile the user clicked, target = the abilities
 * row on the persistent footer). This overlay portals a `motion.div`
 * to the document body and tweens it from source → target, then
 * clears the store so the chip the bag just gained becomes visually
 * authoritative.
 *
 * Why a portal: every encounter view sits inside its own modal
 * container with its own `overflow` clipping. A flight that lands
 * outside the modal (the footer rail is anchored to the bottom of
 * the viewport) would otherwise get clipped at the modal's edge.
 * Mounting at `document.body` sidesteps every clipping ancestor and
 * keeps the trajectory smooth all the way to the footer.
 *
 * The actual footer chip mounts immediately when the bag updates --
 * we DON'T suppress it during the flight. The ghost is intentionally
 * a separate visual that fades out on landing; the chip behind it is
 * the persistent "real" card the user will interact with from now on.
 * The brief visual overlap is invisible because both render the same
 * tile artwork in roughly the same place at the moment of landing.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useGameStore } from "../lib/gameStore";
import { SESSION_CARDS } from "../lib/cards";
import { FooterStyleAbilityCard } from "./FooterStyleAbilityCard";

const FLIGHT_DURATION_S = 0.55;

export function PurchaseFlightOverlay() {
  const flight = useGameStore((s) => s.purchaseFlight);
  const endPurchaseFlight = useGameStore((s) => s.endPurchaseFlight);

  // Safety: if a flight publishes but the consumer never fires the
  // motion onAnimationComplete (e.g. the source tile unmounts during
  // the flight and React tears the motion node down before it gets a
  // chance to settle), expire the payload on a hard timeout so a
  // stale flight can't pin the overlay open forever.
  useEffect(() => {
    if (!flight) return;
    const tid = window.setTimeout(
      () => endPurchaseFlight(),
      Math.ceil(FLIGHT_DURATION_S * 1000) + 600,
    );
    return () => window.clearTimeout(tid);
  }, [flight, endPurchaseFlight]);

  if (!flight) return null;

  const card = SESSION_CARDS.find((c) => c.id === flight.cardId);
  if (!card) return null;

  // Center the 96x136 chip inside whichever rect we landed in -- the
  // source is the listing tile (typically taller than the chip, so we
  // dead-center it), the target is the whole abilities row (height ~
  // 176px, we land in the vertical middle and the horizontal trailing
  // edge since the new bag item appends to the end).
  const CHIP_W = 96;
  const CHIP_H = 136;
  const HORIZONTAL_INSET = 24; // matches the row's [&>*:last-child]:mr-5 padding
  const sourceX = flight.source.x + (flight.source.width - CHIP_W) / 2;
  const sourceY = flight.source.y + (flight.source.height - CHIP_H) / 2;
  const targetX =
    flight.target.x + flight.target.width - CHIP_W - HORIZONTAL_INSET;
  const targetY = flight.target.y + (flight.target.height - CHIP_H) / 2;

  return createPortal(
    <motion.div
      // Fixed-position layer so source/target rects (which are viewport
      // coords from `getBoundingClientRect()`) translate directly into
      // top/left without scroll-compensation math.
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: CHIP_W,
        height: CHIP_H,
        pointerEvents: "none",
        zIndex: 9999,
      }}
      initial={{
        x: sourceX,
        y: sourceY,
        scale: 1.1,
        opacity: 1,
      }}
      animate={{
        x: targetX,
        y: targetY,
        scale: 1,
        opacity: [1, 1, 0],
      }}
      transition={{
        duration: FLIGHT_DURATION_S,
        ease: [0.22, 1, 0.36, 1], // tight cubic-out for a satisfying snap
        opacity: { duration: FLIGHT_DURATION_S, times: [0, 0.8, 1] },
      }}
      onAnimationComplete={endPurchaseFlight}
    >
      <FooterStyleAbilityCard card={card} showDescriptionTooltip={false} />
    </motion.div>,
    document.body,
  );
}
