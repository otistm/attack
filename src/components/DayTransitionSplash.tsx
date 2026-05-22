/**
 * DayTransitionSplash — quick "Monday / Tuesday / Wednesday / Thursday"
 * full-screen flash shown at the start of each Front Office day.
 *
 * Trigger model
 * -------------
 * The splash watches the run's `day` field and fires every time it
 * transitions to a NEW front-office day:
 *
 *   - Mon / Tue / Wed / Thu: fires the moment `advanceDay` flips the
 *     day key (also fires on the rollover Monday after a series, since
 *     `reportSeriesGameResult` resets `day` to `"mon"` -- a fresh
 *     transition by every measure).
 *   - `series`: skipped entirely -- the SeriesIntroScreen owns the
 *     "now we're playing baseball" beat instead.
 *
 * Historical: Monday used to defer on `weekScoutingAcknowledged`
 * because a full-screen "Dugout News" scouting modal owned the
 * screen first. That modal was removed (see FrontOfficeScreen) so
 * Monday now plays the splash immediately on day entry.
 *
 * The component owns a "last day announced" ref so the splash
 * doesn't re-fire on unrelated re-renders (encounter commits, pick
 * counter updates, etc). It only re-arms when the (week, day) key
 * actually changes.
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

/**
 * How long the splash stays on screen before auto-dismissing. Shortened
 * from 1400ms after playtest feedback that the full-screen overlay felt
 * like it was eating click input on the Front Office grid for too long
 * between days. 700ms is enough for the per-day label spring + the
 * sweep-rule animation to read, and clicks / gamepad input still skip
 * the rest of the dwell.
 */
const DURATION_MS = 700;

export function DayTransitionSplash() {
  const day = useGameStore((s) => s.run?.day);
  const week = useGameStore((s) => s.run?.week);
  // Suppress the splash while a SeriesResultScreen is still active --
  // otherwise the Monday rollover after a weekend stacks the recap +
  // the day splash on top of each other (both at z-[58]) and the
  // player has to dismiss two overlays back-to-back before they can
  // touch the new week's encounter grid.
  const seriesSummaryPending = useGameStore(
    (s) => s.run?.lastSeriesSummary != null,
  );
  // Track the most recently-announced (day, week) so the same day
  // doesn't re-fire when unrelated run state updates. The week is
  // part of the key so the Week 2 Monday splash plays even though
  // its day key matches the Week 1 Monday that already fired.
  const lastAnnounced = useRef<string | null>(null);
  // Holds the in-flight auto-dismiss timer so a rapid-fire day
  // transition (rare, but possible if `advanceDay` is called twice
  // in the same tick) cancels the prior timer before scheduling a
  // new one. We deliberately DO NOT clear this from a useEffect
  // cleanup (see comment in the effect below) -- StrictMode's
  // transient mount->unmount->mount cycle would otherwise cancel
  // the only timer we ever schedule and the splash would hang.
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeDay, setActiveDay] = useState<DayOfWeek | null>(null);

  useEffect(() => {
    if (!day || day === "series") return;
    // While the weekend recap is still on screen, queue but don't fire
    // the day splash. The effect re-runs once `seriesSummaryPending`
    // flips back to false (the user dismissed the recap) and the
    // splash plays as part of the Monday entrance instead of stacking
    // on top of the recap.
    if (seriesSummaryPending) return;
    const key = `${week ?? "?"}-${day}`;
    if (lastAnnounced.current === key) return;
    lastAnnounced.current = key;
    setActiveDay(day as DayOfWeek);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      setActiveDay(null);
      dismissTimer.current = null;
    }, DURATION_MS);
    // IMPORTANT: no cleanup. React StrictMode mounts effects
    // twice in development (mount -> unmount -> mount). A
    // useEffect cleanup that called `clearTimeout(t)` would
    // cancel the dismiss timer during that transient unmount;
    // the `lastAnnounced` ref persists across the cycle, so the
    // second mount's effect would early-return and never
    // reschedule -- leaving `activeDay` stuck on its current
    // value forever. The timer firing after a true unmount is
    // harmless: `setActiveDay(null)` on an unmounted component
    // is a no-op in React 18+.
  }, [day, week, seriesSummaryPending]);

  /** Explicit dismiss helper -- clears the dwell timer so the splash
   *  exit animation starts immediately instead of letting the timer
   *  redundantly fire after the user already tapped through. */
  const dismissNow = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    setActiveDay(null);
  };

  // Any controller button dismisses the splash early. Priority 80
  // sits ABOVE the front-office encounter grid (20) but BELOW true
  // app-level modals (100+), so the splash never eats input meant
  // for a higher-priority surface.
  useSznGamepad({
    id: "day-transition-splash",
    priority: 80,
    enabled: activeDay !== null,
    handler: dismissNow,
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
          onClick={dismissNow}
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
