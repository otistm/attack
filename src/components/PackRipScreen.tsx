/**
 * PackRipScreen — kickoff moment of an SZN run. Hosts the full-screen
 * 3D pack opening (Pack3D) and dismisses straight to the Front Office
 * once the user clicks "Head to the Front Office" inside the 3D scene.
 *
 * The 3D scene owns its own copy and CTAs (Diamond Pulls header, click
 * instructions, continue button); this screen is just the route shell
 * that wires the run roster in and forwards the dismiss action.
 *
 * Controller bindings — CROSS does the obvious thing based on which
 * sub-phase the pack is in:
 *   - PACK     : rip the pack open (same as clicking the pack 3D mesh
 *                or the "Tap to rip" fallback button)
 *   - OPENING  : ignored (animation in flight)
 *   - REVEALED : advance to the Front Office (same as the "Head to the
 *                Front Office" button)
 *
 * Priority 20 so the binding wins over the always-on footer (0) but
 * leaves room for any future modal stacked over the pack rip.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useGameStore } from "../lib/gameStore";
import { Pack3D } from "./Pack3D";
import { useSznGamepad } from "../lib/useSznGamepad";

type PackPhase = "PACK" | "OPENING" | "REVEALED";

export function PackRipScreen() {
  const roster = useGameStore((s) => s.run?.roster);
  const openStarterPack = useGameStore((s) => s.openStarterPack);
  const dismissPackRip = useGameStore((s) => s.dismissPackRip);
  const rosterLength = roster?.length ?? 0;
  const [phase, setPhase] = useState<PackPhase>("PACK");
  // Pack3D hands us an imperative "rip" callback once mounted; we
  // stash it in a ref so the controller handler can call it without
  // re-registering on every Pack3D re-render.
  const ripRef = useRef<() => void>(() => undefined);
  const onRequestRip = useCallback((rip: () => void) => {
    ripRef.current = rip;
  }, []);
  const onStateChange = useCallback((s: PackPhase) => setPhase(s), []);

  // Materialize the starter roster on mount. The Pack3D scene reads
  // the resulting roster directly to render the cards inside the pack.
  // We key the effect on `rosterLength` instead of the whole `run`
  // object so it doesn't re-fire on every unrelated run mutation
  // (cash, day, picksUsed, etc.). `openStarterPack` itself is
  // idempotent against an already-populated roster.
  useEffect(() => {
    if (rosterLength === 0) {
      openStarterPack();
    }
  }, [rosterLength, openStarterPack]);

  useSznGamepad({
    id: "pack-rip-screen",
    priority: 20,
    enabled: rosterLength > 0,
    handler: (btn) => {
      if (btn !== "CROSS") return;
      if (phase === "PACK") {
        ripRef.current();
      } else if (phase === "REVEALED") {
        dismissPackRip();
      }
      // OPENING phase deliberately ignores Cross — the rip animation
      // is uninterruptible by design (it's <2s and is the visual
      // payoff the whole screen exists for).
    },
  });

  if (!roster || roster.length === 0) return null;

  return (
    <motion.div
      key="pack-rip-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // z-50 so the pack rip sits ABOVE the always-on SznFooterDecks
      // (which lives at z-40). Without this the footer's collapsed
      // tab leaks through the pack-rip backdrop and the CTA gets
      // partially occluded by the deck strip.
      className="absolute inset-0 z-50 dugout-font-base text-white pointer-events-auto bg-slate-950"
    >
      <Pack3D
        roster={roster}
        onComplete={() => dismissPackRip()}
        onStateChange={onStateChange}
        onRequestRip={onRequestRip}
      />
    </motion.div>
  );
}
