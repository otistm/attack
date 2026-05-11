/**
 * SeriesIntroScreen — the splash before each weekend Bo3 game. Reads
 * like a national-broadcast tale-of-the-tape: just the two starting
 * pitchers face-to-face, the series ledger between them, and a big
 * "Play Ball" CTA. We deliberately do NOT spoil the ghost lineup --
 * the user gets to know their opponent through the live at-bats.
 */

import { motion } from "motion/react";
import { Trophy, Ghost as GhostIcon } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { PlayerCard } from "./PlayerCard";

export function SeriesIntroScreen() {
  const run = useGameStore((s) => s.run);
  const startSeries = useGameStore((s) => s.startSeries);
  if (!run || run.day !== "series" || !run.series || !run.ghost) return null;
  const ghost = run.ghost;

  // Surface the active pitcher on each side. v1 picks the first
  // pitcher entry from the roster -- that's the "ace" until we add
  // rotation logic. If the ghost (or the user, after a sell) somehow
  // has zero pitchers we fall back to the first roster slot so the
  // tale-of-the-tape still renders something.
  const userStarter = run.roster.find((r) => r.player.role === "Pitcher")
    ?? run.roster[0];
  const ghostStarter = ghost.roster.find((r) => r.player.role === "Pitcher")
    ?? ghost.roster[0];

  if (!userStarter || !ghostStarter) return null;

  return (
    <motion.div
      key="series-intro"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center px-4 dugout-font-base text-white pointer-events-auto overflow-hidden"
    >
      {/* Atmospheric backdrop -- twin diagonal shafts of light, one
          per side, themed to the series tension. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 20% 50%, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0) 45%), radial-gradient(circle at 80% 50%, rgba(168,85,247,0.18) 0%, rgba(168,85,247,0) 45%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 max-w-5xl w-full">
        {/* Header */}
        <div className="text-center">
          <motion.span
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-[11px] uppercase tracking-[0.45em] text-amber-300 font-black block"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
          >
            Week {run.week} · Weekend Series
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="dugout-font-sport text-4xl sm:text-6xl uppercase tracking-widest text-white mt-2"
            style={{ textShadow: "0 4px 18px rgba(0,0,0,0.8)" }}
          >
            Game {run.series.gameIndex + 1} of 3
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-sm text-slate-300 mt-1"
            style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
          >
            Tonight's pitching matchup
          </motion.p>
        </div>

        {/* Tale of the tape: user starter vs ghost starter. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-8 w-full">
          <StarterPanel
            label="You"
            sublabel="Starting Pitcher"
            icon={<Trophy className="w-5 h-5 text-amber-300" />}
            tone="amber"
            seriesScore={run.series.userGameWins}
          >
            <motion.div
              initial={{ x: -40, opacity: 0, rotateY: -25 }}
              animate={{ x: 0, opacity: 1, rotateY: 0 }}
              transition={{ delay: 0.25, type: "spring", stiffness: 240, damping: 22 }}
            >
              <PlayerCard
                player={userStarter.player}
                tier={userStarter.tier}
                showSockets={false}
              />
            </motion.div>
          </StarterPanel>

          <motion.div
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              delay: 0.4,
              type: "spring",
              stiffness: 220,
              damping: 14,
            }}
            className="flex items-center justify-center"
          >
            <span
              className="dugout-font-sport text-6xl sm:text-8xl text-white/90 select-none"
              style={{
                textShadow: "0 0 18px rgba(251,191,36,0.55), 0 4px 12px rgba(0,0,0,0.8)",
              }}
            >
              VS
            </span>
          </motion.div>

          <StarterPanel
            label={ghost.label}
            sublabel="Ghost Ace"
            icon={<GhostIcon className="w-5 h-5 text-purple-300" />}
            tone="purple"
            seriesScore={run.series.ghostGameWins}
          >
            <motion.div
              initial={{ x: 40, opacity: 0, rotateY: 25 }}
              animate={{ x: 0, opacity: 1, rotateY: 0 }}
              transition={{ delay: 0.25, type: "spring", stiffness: 240, damping: 22 }}
            >
              <PlayerCard
                player={ghostStarter.player}
                tier={ghostStarter.tier}
                showSockets={false}
              />
            </motion.div>
          </StarterPanel>
        </div>

        {/* CTA */}
        <motion.button
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.55 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          type="button"
          onClick={() => startSeries()}
          className="px-10 py-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-[0.35em] dugout-font-sport text-lg shadow-[0_0_40px_rgba(16,185,129,0.55)]"
        >
          Play Ball
        </motion.button>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-[10px] uppercase tracking-[0.4em] text-slate-500"
        >
          First to 2 wins takes the series
        </motion.p>
      </div>
    </motion.div>
  );
}

function StarterPanel({
  label,
  sublabel,
  icon,
  tone,
  seriesScore,
  children,
}: {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  tone: "amber" | "purple";
  seriesScore: number;
  children: React.ReactNode;
}) {
  // Pre-baked literal class strings: Tailwind v4's JIT scanner only
  // emits classes it can see verbatim in the source, so building
  // `${accent.text}/80` at runtime previously generated zero CSS for
  // the sublabel. Both color-stop variants are spelled out below.
  const accent =
    tone === "amber"
      ? {
          ring: "ring-amber-400/40",
          bg: "from-amber-900/40 to-slate-950/0",
          text: "text-amber-200",
          textDim: "text-amber-200/80",
        }
      : {
          ring: "ring-purple-400/40",
          bg: "from-purple-900/40 to-slate-950/0",
          text: "text-purple-200",
          textDim: "text-purple-200/80",
        };
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-b ${accent.bg} ring-1 ${accent.ring}`}
      >
        {icon}
        <span
          className={`text-xs uppercase tracking-widest font-bold ${accent.text}`}
        >
          {label}
        </span>
      </div>
      <span
        className={`text-[9px] uppercase tracking-[0.4em] ${accent.textDim}`}
        style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
      >
        {sublabel}
      </span>
      {children}
      <div className="flex items-center gap-1 mt-2">
        <span className="text-[10px] uppercase tracking-widest text-slate-400">
          series
        </span>
        <span
          className={`text-2xl font-black ${
            tone === "amber" ? "text-amber-300" : "text-purple-300"
          }`}
        >
          {seriesScore}
        </span>
      </div>
    </div>
  );
}
