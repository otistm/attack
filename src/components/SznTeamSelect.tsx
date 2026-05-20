/**
 * SznTeamSelect — full-screen MLB franchise picker shown when the user
 * clicks "SZN Mode" on the StartGameScreen.
 *
 * Each team has its own passive badge + 20-player pool (see `sznTeams.ts`
 * / `sznPlayers.ts`). Picking a team commits the run:
 *   1. `startSznRun(mlbTeamId)` seeds the run state with the chosen team
 *      + the team's starter badge.
 *   2. The pack-rip flow then deals 10 from that team's player pool.
 *
 * v1 ships only the Yankees as a complete team; the other 29 render as
 * disabled "COMING SOON" tiles to preview the scope.
 *
 * Tile design uses each franchise's primary/secondary uniform colors as
 * a diagonal gradient so the picker reads as "thirty different jerseys",
 * not "thirty interchangeable buttons".
 */

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MLB_DIVISIONS,
  MLB_TEAMS,
  teamsByDivision,
  type MlbTeam,
  type MlbTeamId,
} from "../lib/sznTeams";
import { BADGES } from "../lib/badges";
import { useGameStore } from "../lib/gameStore";
import { useSznGamepad } from "../lib/useSznGamepad";

export function SznTeamSelect() {
  const open = useGameStore((s) => s.showSznTeamSelect);
  const setOpen = useGameStore((s) => s.setShowSznTeamSelect);
  const startSznRun = useGameStore((s) => s.startSznRun);

  // Stable per-division layout so focus indices and hover order are
  // both predictable across renders.
  const byDivision = useMemo(() => teamsByDivision(), []);
  const flatTeams = useMemo<MlbTeam[]>(
    () => MLB_DIVISIONS.flatMap((d) => byDivision[d]),
    [byDivision],
  );

  // Default focus to the first available (enabled) team — almost always
  // Yankees in v1, but resilient if we backfill team availability.
  const firstAvailableIdx = useMemo(
    () => Math.max(0, flatTeams.findIndex((t) => t.available)),
    [flatTeams],
  );
  const [focusIdx, setFocusIdx] = useState(firstAvailableIdx);
  useEffect(() => setFocusIdx(firstAvailableIdx), [firstAvailableIdx, open]);

  const focused = flatTeams[focusIdx];
  const focusedBadge = focused ? BADGES[focused.passiveBadgeId] : null;

  // Keep the focused tile in view when the gamepad pushes focus past
  // the visible window. Without this the user can dpad-down past the
  // bottom of the viewport and the highlight effectively vanishes
  // because the grid container doesn't auto-scroll the focus rect.
  // `block: "nearest"` scrolls the minimum amount needed (so navigating
  // within the visible window doesn't pointlessly recenter the page).
  const tileRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    if (!open || !focused) return;
    const el = tileRefs.current.get(focused.id);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open, focused, focusIdx]);

  useSznGamepad({
    id: "szn-team-select",
    // 100 sits above the StartGameScreen (10) so navigation here can't
    // bleed into the lane chooser still mounted underneath.
    priority: 100,
    enabled: open,
    handler: (btn) => {
      if (!open) return;
      if (btn === "CIRCLE") {
        setOpen(false);
        return;
      }
      if (btn === "DPAD_LEFT") {
        setFocusIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (btn === "DPAD_RIGHT") {
        setFocusIdx((i) => Math.min(flatTeams.length - 1, i + 1));
        return;
      }
      if (btn === "DPAD_UP") {
        setFocusIdx((i) => Math.max(0, i - 5));
        return;
      }
      if (btn === "DPAD_DOWN") {
        setFocusIdx((i) => Math.min(flatTeams.length - 1, i + 5));
        return;
      }
      if (btn === "CROSS") {
        const t = flatTeams[focusIdx];
        if (t && t.available) startSznRun(t.id);
      }
    },
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="szn-team-select"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0 z-40 bg-slate-950/95 backdrop-blur-md flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Select your team for SZN run"
        >
          <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <h1 className="dugout-font-sport text-2xl sm:text-3xl uppercase tracking-widest text-amber-200">
              Select Your Team
            </h1>
            <div className="w-[80px]" />
          </header>

          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <div className="max-w-6xl mx-auto space-y-6">
              {MLB_DIVISIONS.map((division) => (
                <section key={division} className="space-y-2">
                  <h2 className="text-xs font-black uppercase tracking-[0.25em] text-amber-300/80 px-1">
                    {division}
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {byDivision[division].map((team) => {
                      const flatIdx = flatTeams.findIndex((t) => t.id === team.id);
                      const isFocused = flatIdx === focusIdx;
                      return (
                        <TeamTile
                          key={team.id}
                          team={team}
                          focused={isFocused}
                          tileRef={(el) => {
                            if (el) tileRefs.current.set(team.id, el);
                            else tileRefs.current.delete(team.id);
                          }}
                          onHover={() => setFocusIdx(flatIdx)}
                          onPick={() => {
                            if (!team.available) return;
                            startSznRun(team.id);
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* Focused-team preview rail. Surfaces the passive badge copy
              so the player can read what they're committing to before
              they slam the CROSS button. */}
          <footer className="border-t border-white/10 bg-slate-900/80 backdrop-blur-sm px-6 py-4">
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-lg border-2 border-white/40 flex items-center justify-center text-2xl shrink-0"
                  style={{ backgroundColor: focusedBadge?.tint ?? "#1f2937" }}
                  aria-hidden
                >
                  <span>{focusedBadge?.icon ?? "?"}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    {focused?.name}
                  </div>
                  <div className="text-sm font-black text-white truncate">
                    {focusedBadge?.name ?? "Team Passive"}
                  </div>
                  <div className="text-xs text-slate-300 max-w-2xl leading-snug">
                    {focusedBadge?.flavor ?? "Passive ability TBD."}
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={!focused?.available}
                onClick={() => focused && startSznRun(focused.id)}
                className={`px-6 py-3 rounded-lg font-black uppercase tracking-wider text-sm transition-colors ${
                  focused?.available
                    ? "bg-emerald-500 hover:bg-emerald-400 text-slate-900 shadow-[0_0_18px_rgba(16,185,129,0.45)]"
                    : "bg-slate-700 text-slate-400 cursor-not-allowed"
                }`}
              >
                {focused?.available ? `Run with ${focused.shortName}` : "Coming Soon"}
              </button>
            </div>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TeamTile({
  team,
  focused,
  tileRef,
  onHover,
  onPick,
}: {
  team: MlbTeam;
  focused: boolean;
  tileRef?: (el: HTMLButtonElement | null) => void;
  onHover: () => void;
  onPick: () => void;
}) {
  const disabled = !team.available;
  return (
    <motion.button
      ref={tileRef}
      type="button"
      onClick={onPick}
      onMouseEnter={onHover}
      onFocus={onHover}
      disabled={disabled}
      whileHover={!disabled ? { y: -3 } : undefined}
      whileTap={!disabled ? { scale: 0.98 } : undefined}
      className={`relative w-full aspect-[4/5] rounded-xl overflow-hidden border-2 text-left transition-shadow ${
        disabled ? "cursor-not-allowed grayscale opacity-60" : "cursor-pointer"
      } ${
        focused
          ? "border-amber-300 ring-2 ring-amber-300/70 shadow-[0_0_24px_rgba(251,191,36,0.45)]"
          : "border-white/20"
      }`}
      style={{
        background: `linear-gradient(160deg, ${team.primaryColor} 0%, ${team.secondaryColor} 100%)`,
      }}
      aria-label={`${team.name}${disabled ? " (coming soon)" : ""}`}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.18) 100%)",
        }}
      />
      <div className="relative z-10 h-full p-2 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-white/85 bg-black/40 rounded px-1.5 py-0.5">
            {team.abbr}
          </span>
          {disabled && (
            <span className="text-white/70 bg-black/40 rounded p-1" title="Coming soon">
              <Lock className="w-3 h-3" />
            </span>
          )}
        </div>
        <div className="space-y-1">
          <div
            className="text-sm font-black uppercase tracking-tight text-white leading-tight line-clamp-2"
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.75)" }}
          >
            {team.shortName}
          </div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/70">
            {team.division}
          </div>
        </div>
      </div>
    </motion.button>
  );
}
