/**
 * EndRunScreen — championship (10 wins) or fired (3 losses) end-of-run
 * payoff screen. Offers "Start New Run" which kicks back to PackRip and
 * "Back to Menu" which returns to the StartGameScreen lane chooser.
 */

import { motion } from "motion/react";
import { Trophy, Frown } from "lucide-react";
import { useGameStore } from "../lib/gameStore";

export function EndRunScreen() {
  const run = useGameStore((s) => s.run);
  const userTeam = useGameStore((s) => s.userTeam);
  const startSznRun = useGameStore((s) => s.startSznRun);
  const exitSznToMenu = useGameStore((s) => s.exitSznToMenu);

  if (!run || !run.endState) return null;
  const won = run.endState === "champion";

  return (
    <motion.div
      key="end-run-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-slate-950/95 px-4 dugout-font-base text-white pointer-events-auto"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className={`flex flex-col items-center text-center gap-4 max-w-md ${
          won ? "text-amber-200" : "text-rose-200"
        }`}
      >
        {won ? (
          <Trophy className="w-20 h-20 text-amber-300" />
        ) : (
          <Frown className="w-20 h-20 text-rose-400" />
        )}
        <h2 className="dugout-font-sport text-4xl sm:text-5xl uppercase tracking-widest">
          {won ? "Champion" : "Fired"}
        </h2>
        <p className="text-sm text-slate-300 leading-snug">
          {won
            ? `You finished the season ${run.wins}-${run.losses} and lifted the trophy.`
            : `Owner cleaned out your office at ${run.wins}-${run.losses}. Brutal year.`}
        </p>
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={() => startSznRun(userTeam)}
            className="px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest dugout-font-sport text-sm shadow-lg"
          >
            Start New Run
          </button>
          <button
            type="button"
            onClick={() => exitSznToMenu()}
            className="px-5 py-3 rounded-lg border border-slate-600 text-slate-200 hover:border-amber-300 hover:text-amber-200 font-bold uppercase tracking-widest text-sm"
          >
            Back to Menu
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
