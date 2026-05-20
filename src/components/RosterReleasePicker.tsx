/**
 * RosterReleasePicker — mandatory roster cull modal.
 *
 * Triggered when an encounter would grant a new player while the
 * roster is already at `STARTER_PACK_TOTAL` (10). The user MUST pick
 * someone to release before the pending grant lands; cancelling the
 * picker cancels the encounter (the parent view handles that).
 *
 * Gamepad-aware: DPAD navigates the roster grid, CROSS releases the
 * focused player, CIRCLE cancels. Priority 200 (above other modals)
 * because release is always a hard-stop dialog -- nothing else can
 * resolve until the user makes the call.
 *
 * Visual: matches `SznTeamSelect`'s `bg-slate-950/95 backdrop-blur-md`
 * full-viewport overlay so the two pickers feel like the same family
 * of decision surfaces.
 */

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlayerCard } from "./PlayerCard";
import type { RosterPlayer } from "../lib/run";
import { useSznGamepad } from "../lib/useSznGamepad";

export interface RosterReleasePickerProps {
  open: boolean;
  roster: RosterPlayer[];
  /** Title of the pending grant (e.g. "Sign Setup Man"). */
  pendingGrantLabel?: string;
  onRelease: (playerId: string) => void;
  onCancel: () => void;
}

export function RosterReleasePicker({
  open,
  roster,
  pendingGrantLabel,
  onRelease,
  onCancel,
}: RosterReleasePickerProps) {
  // Stable display order: pitchers first (the user usually cuts a
  // bench bat before the rotation, but it varies by run), then bats.
  // We sort once on render so the focus index stays consistent across
  // re-renders without forcing a memo on `roster` identity.
  const ordered = useMemo<RosterPlayer[]>(() => {
    const pitchers = roster.filter((r) => r.player.role === "Pitcher");
    const batters = roster.filter((r) => r.player.role === "Batter");
    return [...pitchers, ...batters];
  }, [roster]);

  const [focusIdx, setFocusIdx] = useState(0);
  useEffect(() => {
    if (!open) return;
    setFocusIdx(0);
  }, [open]);

  // Keep the focused tile in view; same `scrollIntoView` pattern as
  // SznTeamSelect so long rosters don't lose the highlight when the
  // grid wraps below the viewport.
  const tileRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    if (!open) return;
    const focused = ordered[focusIdx];
    if (!focused) return;
    const el = tileRefs.current.get(focused.player.id);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open, ordered, focusIdx]);

  useSznGamepad({
    id: "szn-release-picker",
    priority: 200,
    enabled: open,
    handler: (btn) => {
      if (!open) return;
      switch (btn) {
        case "CIRCLE":
          onCancel();
          return;
        case "DPAD_LEFT":
          setFocusIdx((i) => Math.max(0, i - 1));
          return;
        case "DPAD_RIGHT":
          setFocusIdx((i) => Math.min(ordered.length - 1, i + 1));
          return;
        case "DPAD_UP":
          // 5-wide grid matches the SznTeamSelect cadence; up/down jumps
          // one row.
          setFocusIdx((i) => Math.max(0, i - 5));
          return;
        case "DPAD_DOWN":
          setFocusIdx((i) => Math.min(ordered.length - 1, i + 5));
          return;
        case "CROSS": {
          const focused = ordered[focusIdx];
          if (focused) onRelease(focused.player.id);
          return;
        }
      }
    },
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="szn-release-picker"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-md flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Release a roster player"
        >
          <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
            >
              <ArrowLeft className="w-4 h-4" />
              Cancel
            </button>
            <h1 className="dugout-font-sport text-2xl uppercase tracking-widest text-amber-200">
              Release a Player
            </h1>
            <div className="w-[80px]" />
          </header>

          <div className="px-6 pt-4 pb-2 text-center">
            <p className="text-sm text-slate-300">
              Roster is full at 10. Pick a player to release before
              {pendingGrantLabel ? ` ${pendingGrantLabel.toLowerCase()}` : " the new grant"} lands.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 place-items-center">
              {ordered.map((rp, idx) => {
                const isFocused = idx === focusIdx;
                return (
                  <button
                    key={rp.player.id}
                    ref={(el) => {
                      if (el) tileRefs.current.set(rp.player.id, el);
                      else tileRefs.current.delete(rp.player.id);
                    }}
                    type="button"
                    onMouseEnter={() => setFocusIdx(idx)}
                    onClick={() => onRelease(rp.player.id)}
                    className={[
                      "rounded-lg p-1 transition-transform",
                      isFocused
                        ? "ring-2 ring-amber-300 -translate-y-1 shadow-[0_8px_18px_rgba(251,191,36,0.4)]"
                        : "ring-0",
                    ].join(" ")}
                  >
                    <PlayerCard
                      player={rp.player}
                      rarity={rp.rarity}
                      rosterSlot={rp}
                      compact
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <footer className="border-t border-white/10 bg-slate-900/80 backdrop-blur-sm px-6 py-3 text-center text-xs uppercase tracking-widest text-slate-400">
            <span className="text-slate-300">CROSS</span> release
            &nbsp;·&nbsp; <span className="text-slate-300">CIRCLE</span> cancel
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
