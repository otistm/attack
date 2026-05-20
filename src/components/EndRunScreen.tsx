/**
 * EndRunScreen — championship (10 wins) or fired (3 losses) end-of-run
 * payoff screen. Offers "Start New Run" which kicks back to PackRip and
 * "Back to Menu" which returns to the StartGameScreen lane chooser.
 */

import { useState } from "react";
import { motion } from "motion/react";
import { Trophy, Frown } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { useSznGamepad } from "../lib/useSznGamepad";

type EndRunCta = "new" | "menu";

export function EndRunScreen() {
  const run = useGameStore((s) => s.run);
  const startSznRun = useGameStore((s) => s.startSznRun);
  const exitSznToMenu = useGameStore((s) => s.exitSznToMenu);
  const setShowSznTeamSelect = useGameStore((s) => s.setShowSznTeamSelect);
  const [focus, setFocus] = useState<EndRunCta>("new");

  // "Start New Run" reuses the same MLB team the user picked for this
  // run when possible. If the selected-team id was lost (older save,
  // edge case), we drop back to the team picker so the user can pick
  // fresh -- never silently force a generic AWAY/HOME default.
  const restartRun = () => {
    if (run?.selectedTeamId) {
      startSznRun(run.selectedTeamId);
    } else {
      setShowSznTeamSelect(true);
    }
  };

  useSznGamepad({
    id: "end-run-screen",
    priority: 20,
    enabled: !!run?.endState,
    handler: (btn) => {
      if (btn === "DPAD_LEFT" || btn === "DPAD_UP") setFocus("new");
      else if (btn === "DPAD_RIGHT" || btn === "DPAD_DOWN") setFocus("menu");
      else if (btn === "CROSS") {
        if (focus === "new") restartRun();
        else exitSznToMenu();
      } else if (btn === "CIRCLE") {
        exitSznToMenu();
      }
    },
  });

  if (!run || !run.endState) return null;
  const won = run.endState === "champion";

  return (
    <motion.div
      key="end-run-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // z-50 so the end-of-run payoff sits ABOVE the always-on
      // SznFooterDecks (z-40). The footer auto-hides on endState!=null
      // anyway, but raising z-order keeps the modal canonical even if
      // the gate races a re-render.
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 px-4 dugout-font-base text-white pointer-events-auto"
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
            onClick={restartRun}
            onMouseEnter={() => setFocus("new")}
            onFocus={() => setFocus("new")}
            className={`px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest dugout-font-sport text-sm shadow-lg transition-shadow ${
              focus === "new"
                ? "ring-2 ring-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.45)]"
                : ""
            }`}
          >
            Start New Run
          </button>
          <button
            type="button"
            onClick={() => exitSznToMenu()}
            onMouseEnter={() => setFocus("menu")}
            onFocus={() => setFocus("menu")}
            className={`px-5 py-3 rounded-lg border border-slate-600 text-slate-200 hover:border-amber-300 hover:text-amber-200 font-bold uppercase tracking-widest text-sm transition-colors ${
              focus === "menu"
                ? "ring-2 ring-amber-400/80 border-amber-300 text-amber-200"
                : ""
            }`}
          >
            Back to Menu
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
