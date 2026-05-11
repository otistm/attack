/**
 * PackRipScreen — kickoff moment of an SZN run. Hosts the full-screen
 * 3D pack opening (Pack3D) and dismisses straight to the Front Office
 * once the user clicks "Head to the Front Office" inside the 3D scene.
 *
 * The 3D scene owns its own copy and CTAs (Diamond Pulls header, click
 * instructions, continue button); this screen is just the route shell
 * that wires the run roster in and forwards the dismiss action.
 */

import { useEffect } from "react";
import { motion } from "motion/react";
import { useGameStore } from "../lib/gameStore";
import { Pack3D } from "./Pack3D";

export function PackRipScreen() {
  const roster = useGameStore((s) => s.run?.roster);
  const openStarterPack = useGameStore((s) => s.openStarterPack);
  const dismissPackRip = useGameStore((s) => s.dismissPackRip);
  const rosterLength = roster?.length ?? 0;

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

  if (!roster || roster.length === 0) return null;

  return (
    <motion.div
      key="pack-rip-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 dugout-font-base text-white pointer-events-auto bg-slate-950"
    >
      <Pack3D roster={roster} onComplete={() => dismissPackRip()} />
    </motion.div>
  );
}
