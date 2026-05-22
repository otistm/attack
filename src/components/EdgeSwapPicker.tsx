/**
 * EdgeSwapPicker — two-step "swap two cards' edges" modal.
 *
 * Used by Encounter #8 Clubhouse Prank (manual swap branch). The user:
 *   1. Picks Player A.
 *   2. Picks Player B (other than A).
 *   3. Picks which edge to swap: left, right, or both.
 *
 * On commit the parent receives `{ a, b, side }` and dispatches two
 * `mutateRosterEdge` effects (one per side per player).
 *
 * Reuses the same gamepad bindings as the other pickers (DPAD nav,
 * CROSS commit, CIRCLE step back / cancel). Priority 200 -- modal
 * level, no other surface can resolve until the user finishes or
 * cancels.
 */

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FooterStylePlayerCard } from "./FooterStylePlayerCard";
import { isSznPlayer } from "../lib/sznPlayers";
import {
  playerDisplayValue,
  resolvePlayerEdges,
} from "../lib/cardDisplay";
import type { RosterPlayer } from "../lib/run";
import { useSznGamepad } from "../lib/useSznGamepad";

export type EdgeSwapSide = "left" | "right" | "both";

export interface EdgeSwapPickerProps {
  open: boolean;
  roster: RosterPlayer[];
  /** Called with two player ids + which sides to swap. */
  onCommit: (a: string, b: string, side: EdgeSwapSide) => void;
  onCancel: () => void;
}

type Stage = "pickA" | "pickB" | "pickSide";

export function EdgeSwapPicker({
  open,
  roster,
  onCommit,
  onCancel,
}: EdgeSwapPickerProps) {
  const visible = useMemo<RosterPlayer[]>(() => {
    const pitchers = roster.filter((r) => r.player.role === "Pitcher");
    const batters = roster.filter((r) => r.player.role === "Batter");
    return [...pitchers, ...batters];
  }, [roster]);

  const [stage, setStage] = useState<Stage>("pickA");
  const [playerA, setPlayerA] = useState<string | null>(null);
  const [playerB, setPlayerB] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [sideFocusIdx, setSideFocusIdx] = useState(0);

  // Reset all state when the modal opens so a previous run doesn't
  // leak partially-completed selections into the new picker session.
  useEffect(() => {
    if (!open) return;
    setStage("pickA");
    setPlayerA(null);
    setPlayerB(null);
    setFocusIdx(0);
    setSideFocusIdx(0);
  }, [open]);

  // The visible list for the active stage. pickB removes player A so
  // the user can't pick the same slot twice.
  const stageList = useMemo<RosterPlayer[]>(() => {
    if (stage === "pickA") return visible;
    if (stage === "pickB") return visible.filter((r) => r.player.id !== playerA);
    return [];
  }, [stage, visible, playerA]);

  const tileRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    if (!open || stage === "pickSide") return;
    const focused = stageList[focusIdx];
    if (!focused) return;
    const el = tileRefs.current.get(focused.player.id);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open, stage, stageList, focusIdx]);

  const sides: EdgeSwapSide[] = ["left", "right", "both"];

  useSznGamepad({
    id: "szn-edge-swap-picker",
    priority: 200,
    enabled: open,
    handler: (btn) => {
      if (!open) return;
      if (btn === "CIRCLE") {
        // Step back through the wizard: pickSide -> pickB -> pickA -> cancel.
        if (stage === "pickSide") {
          setStage("pickB");
          setSideFocusIdx(0);
          return;
        }
        if (stage === "pickB") {
          setStage("pickA");
          setPlayerB(null);
          setFocusIdx(0);
          return;
        }
        onCancel();
        return;
      }

      if (stage === "pickSide") {
        if (btn === "DPAD_LEFT") setSideFocusIdx((i) => Math.max(0, i - 1));
        else if (btn === "DPAD_RIGHT") setSideFocusIdx((i) => Math.min(sides.length - 1, i + 1));
        else if (btn === "CROSS" && playerA && playerB) {
          onCommit(playerA, playerB, sides[sideFocusIdx]);
        }
        return;
      }

      switch (btn) {
        case "DPAD_LEFT":
          setFocusIdx((i) => Math.max(0, i - 1));
          return;
        case "DPAD_RIGHT":
          setFocusIdx((i) => Math.min(stageList.length - 1, i + 1));
          return;
        case "DPAD_UP":
          setFocusIdx((i) => Math.max(0, i - 5));
          return;
        case "DPAD_DOWN":
          setFocusIdx((i) => Math.min(stageList.length - 1, i + 5));
          return;
        case "CROSS": {
          const focused = stageList[focusIdx];
          if (!focused) return;
          if (stage === "pickA") {
            setPlayerA(focused.player.id);
            setStage("pickB");
            setFocusIdx(0);
          } else if (stage === "pickB") {
            setPlayerB(focused.player.id);
            setStage("pickSide");
          }
          return;
        }
      }
    },
  });

  const headerTitle =
    stage === "pickA"
      ? "Pick First Player"
      : stage === "pickB"
        ? "Pick Second Player"
        : "Swap Which Edges?";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="szn-edge-swap-picker"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-md flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Swap edges between two players"
        >
          <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <button
              type="button"
              onClick={() => {
                if (stage === "pickA") onCancel();
                else if (stage === "pickB") {
                  setStage("pickA");
                  setPlayerB(null);
                  setFocusIdx(0);
                } else {
                  setStage("pickB");
                  setSideFocusIdx(0);
                }
              }}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
            >
              <ArrowLeft className="w-4 h-4" />
              {stage === "pickA" ? "Cancel" : "Back"}
            </button>
            <h1 className="dugout-font-sport text-2xl uppercase tracking-widest text-amber-200">
              {headerTitle}
            </h1>
            <div className="w-[80px]" />
          </header>

          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            {stage !== "pickSide" ? (
              <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 place-items-center">
                {stageList.map((rp, idx) => {
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
                      onClick={() => {
                        if (stage === "pickA") {
                          setPlayerA(rp.player.id);
                          setStage("pickB");
                          setFocusIdx(0);
                        } else if (stage === "pickB") {
                          setPlayerB(rp.player.id);
                          setStage("pickSide");
                        }
                      }}
                      className={[
                        "rounded-lg p-1 transition-transform",
                        isFocused
                          ? "ring-2 ring-amber-300 -translate-y-1 shadow-[0_8px_18px_rgba(251,191,36,0.4)]"
                          : "ring-0",
                      ].join(" ")}
                    >
                      <FooterStylePlayerCard
                        name={rp.player.name}
                        role={rp.player.role}
                        value={playerDisplayValue(rp)}
                        teamCode={
                          isSznPlayer(rp.player) ? rp.player.teamId : null
                        }
                        rarity={rp.rarity}
                        {...resolvePlayerEdges(rp)}
                        focused={isFocused}
                        ariaLabel={`Pick ${rp.player.name}`}
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="max-w-3xl mx-auto pt-12">
                <div className="text-center text-sm text-slate-300 pb-6">
                  Which edge(s) do you want to swap between the two players?
                </div>
                <div className="flex justify-center gap-4">
                  {sides.map((side, idx) => {
                    const isFocused = idx === sideFocusIdx;
                    return (
                      <button
                        key={side}
                        type="button"
                        onMouseEnter={() => setSideFocusIdx(idx)}
                        onClick={() => {
                          if (playerA && playerB) onCommit(playerA, playerB, side);
                        }}
                        className={[
                          "min-w-[120px] rounded-lg border-2 px-6 py-4 text-sm font-black uppercase tracking-widest transition-colors",
                          isFocused
                            ? "border-amber-300 bg-amber-300/15 text-amber-100"
                            : "border-white/20 bg-white/5 text-slate-300 hover:border-white/40",
                        ].join(" ")}
                      >
                        {side === "both" ? "Both" : side === "left" ? "Left" : "Right"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <footer className="border-t border-white/10 bg-slate-900/80 backdrop-blur-sm px-6 py-3 text-center text-xs uppercase tracking-widest text-slate-400">
            <span className="text-slate-300">CROSS</span>{" "}
            {stage === "pickSide" ? "commit" : "pick"}
            &nbsp;·&nbsp; <span className="text-slate-300">CIRCLE</span>{" "}
            {stage === "pickA" ? "cancel" : "back"}
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
