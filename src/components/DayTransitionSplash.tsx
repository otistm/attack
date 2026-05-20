/**
 * DayTransitionSplash — quick "Monday / Tuesday / Wednesday / Thursday"
 * full-screen flash shown at the start of each Front Office day.
 *
 * Trigger model
 * -------------
 * The splash watches the run's `day` field and fires every time it
 * transitions to a NEW front-office day:
 *
 *   - Monday: the splash defers until the user has dismissed the
 *     Monday scouting report. Otherwise the splash and the scouting
 *     modal would race for the same vertical real estate.
 *   - Tue / Wed / Thu: fires the moment `advanceDay` flips the day.
 *   - `series`: skipped entirely -- the SeriesIntroScreen owns the
 *     "now we're playing baseball" beat instead.
 *
 * The component owns a "last day announced" ref so the splash
 * doesn't re-fire on unrelated re-renders (encounter commits, pick
 * counter updates, etc). It only re-arms when the day key actually
 * changes -- including the rollover Monday after a series ends,
 * because the rollover branch in `reportSeriesGameResult` resets
 * `day` to `"mon"` and `weekScoutingAcknowledged` to `false`, which
 * is a fresh transition by every measure.
 *
 * Input
 * -----
 * The splash registers a HIGH-priority gamepad binding so any input
 * dismisses it early. It also covers the screen with
 * `pointer-events-auto` so clicks/taps do the same. Either way the
 * splash auto-dismisses after `DURATION_MS` so it can never block
 * the loop.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGameStore } from "../lib/gameStore";
import { useSznGamepad } from "../lib/useSznGamepad";
import type { DayOfWeek } from "../lib/run";

/** Full-name day labels keyed by the run's `day` enum. */
const DAY_FULL_LABEL: Record<DayOfWeek, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
};

/**
 * Color tints per day -- borrowed from the Front Office accent
 * palette (amber for "today" in the breadcrumb) but with a small
 * per-day rotation so the days feel distinct. Tuesday cyan,
 * Wednesday emerald, Thursday rose mirrors the encounter-type
 * color language (merchant amber, market cyan, event purple, etc.)
 * but stays tonally consistent with the rest of the screen.
 */
const DAY_TINT: Record<DayOfWeek, string> = {
  mon: "#fbbf24", // amber
  tue: "#22d3ee", // cyan
  wed: "#10b981", // emerald
  thu: "#f43f5e", // rose
};

/** How long the splash stays on screen before auto-dismissing. */
const DURATION_MS = 1400;

export function DayTransitionSplash() {
  const day = useGameStore((s) => s.run?.day);
  const week = useGameStore((s) => s.run?.week);
  const acknowledged = useGameStore(
    (s) => s.run?.weekScoutingAcknowledged ?? false,
  );
  // Track the most recently-announced (day, week) so the same day
  // doesn't re-fire when unrelated run state updates. The week is
  // part of the key so the Week 2 Monday splash plays even though
  // its day key matches the Week 1 Monday that already fired.
  const lastAnnounced = useRef<string | null>(null);
  const [activeDay, setActiveDay] = useState<DayOfWeek | null>(null);

  useEffect(() => {
    if (!day || day === "series") return;
    // Monday defers until the user has dismissed the scouting
    // report. The scouting modal owns the screen at z-55 so showing
    // the splash beneath it would be invisible AND the splash
    // would auto-dismiss while the user was reading the scout.
    if (day === "mon" && !acknowledged) return;
    const key = `${week ?? "?"}-${day}`;
    if (lastAnnounced.current === key) return;
    lastAnnounced.current = key;
    setActiveDay(day as DayOfWeek);
    const t = setTimeout(() => setActiveDay(null), DURATION_MS);
    return () => clearTimeout(t);
  }, [day, week, acknowledged]);

  // Any controller button dismisses the splash early. Priority 80
  // sits ABOVE the front-office encounter grid (20) and Monday
  // scouting (60) but BELOW true app-level modals (100+), so the
  // splash never eats input meant for a higher-priority surface.
  useSznGamepad({
    id: "day-transition-splash",
    priority: 80,
    enabled: activeDay !== null,
    handler: () => setActiveDay(null),
  });

  return (
    <AnimatePresence>
      {activeDay && (
        <motion.div
          key={`day-splash-${activeDay}-${week ?? 0}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={() => setActiveDay(null)}
          className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-950/85 backdrop-blur-md pointer-events-auto cursor-pointer"
          aria-live="polite"
          aria-label={`${DAY_FULL_LABEL[activeDay]} begins`}
        >
          {/* Center stack -- big "MONDAY" / "TUESDAY" etc with a
              subtitle below. The text uses the dugout-font-sport
              treatment and a per-day tint glow so each day reads as
              a distinct beat. */}
          <div className="flex flex-col items-center gap-3 select-none">
            {week !== undefined && week !== null && (
              <motion.span
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05, duration: 0.3 }}
                className="text-[11px] sm:text-xs font-black uppercase tracking-[0.45em] text-slate-300"
                style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
              >
                Week {week}
              </motion.span>
            )}
            <motion.h2
              initial={{ scale: 0.6, opacity: 0, letterSpacing: "0.05em" }}
              animate={{ scale: 1, opacity: 1, letterSpacing: "0.18em" }}
              exit={{ scale: 1.05, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 220,
                damping: 18,
                mass: 0.8,
              }}
              className="dugout-font-sport text-6xl sm:text-8xl md:text-9xl uppercase text-white leading-none"
              style={{
                textShadow: `0 0 32px ${DAY_TINT[activeDay]}aa, 0 6px 22px rgba(0,0,0,0.85)`,
              }}
            >
              {DAY_FULL_LABEL[activeDay]}
            </motion.h2>
            {/* Per-day rule -- short colored bar that sweeps in
                from the sides. Visual heartbeat under the title so
                the splash doesn't feel like just text on a void. */}
            <motion.div
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: 0.18, duration: 0.35, ease: "easeOut" }}
              className="h-[3px] w-40 sm:w-56 rounded-full origin-center"
              style={{
                background: `linear-gradient(90deg, transparent, ${DAY_TINT[activeDay]}, transparent)`,
                boxShadow: `0 0 16px ${DAY_TINT[activeDay]}`,
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
