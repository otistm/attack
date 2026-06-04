/**
 * Brief KO / finisher banner after an arena round resolves.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/** How long the finisher chip stays before the post-battle menu can appear. */
export const MAGE_FINISHER_DISPLAY_MS = 2200;

export interface MageFinisherBannerProps {
  atBatId: number;
  userWon: boolean;
  phase: "between-at-bats" | "game-over";
  /** Fired when the banner auto-dismisses so the action overlay can show. */
  onDismissed?: () => void;
}

export function MageFinisherBanner({
  atBatId,
  userWon,
  phase,
  onDismissed,
}: MageFinisherBannerProps) {
  const [visible, setVisible] = useState(false);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  useEffect(() => {
    if (phase !== "between-at-bats" && phase !== "game-over") {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      onDismissedRef.current?.();
    }, MAGE_FINISHER_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [atBatId, phase, userWon]);

  const title = userWon ? "Victory" : phase === "game-over" ? "Defeated" : "Round Over";
  const sub = userWon
    ? "Your weave shattered their ward."
    : "Regroup — snap stronger activations next round.";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={`finisher-${atBatId}`}
          className="fixed inset-x-0 top-24 z-[60] flex justify-center pointer-events-none"
          initial={{ opacity: 0, y: -24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ duration: 0.35, ease: [0.2, 0.9, 0.2, 1] }}
        >
          <div
            className={`rounded-xl px-8 py-4 text-center shadow-2xl ring-2 backdrop-blur-md ${
              userWon
                ? "bg-emerald-950/90 ring-emerald-400/50"
                : "bg-rose-950/90 ring-rose-400/50"
            }`}
          >
            <p
              className={`text-3xl font-black uppercase tracking-[0.15em] ${
                userWon ? "text-emerald-200" : "text-rose-200"
              }`}
            >
              {title}
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-white/70">
              {sub}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
