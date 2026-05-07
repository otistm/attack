import { Trophy, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useGameStore } from "../lib/gameStore";
import {
  QUEST_REGISTRY,
  questProgressLabel,
  questProgressRatio,
  type QuestRarity,
} from "../lib/quests";
import { questRewardDescription } from "../lib/questRewards";

const RARITY_BAR: Record<QuestRarity, string> = {
  common: "bg-slate-400",
  rare: "bg-amber-400",
  legendary: "bg-gradient-to-r from-fuchsia-500 via-amber-400 to-sky-400",
};

const RARITY_LABEL: Record<QuestRarity, string> = {
  common: "Common",
  rare: "Rare",
  legendary: "Legendary",
};

const RARITY_TEXT: Record<QuestRarity, string> = {
  common: "text-slate-300",
  rare: "text-amber-300",
  legendary: "text-fuchsia-300",
};

const RARITY_PANEL: Record<QuestRarity, string> = {
  common: "border-slate-500/60 from-slate-800/95 to-slate-950/95",
  rare: "border-amber-500/50 from-amber-950/90 to-slate-950/95",
  legendary:
    "border-fuchsia-500/50 from-fuchsia-950/85 via-slate-950/95 to-sky-950/85",
};

/** Same stacking as card ability tooltips — above modals and overflow clips. */
const QUEST_FOCUS_Z = "z-[10000]";

function SegmentBar({ ratio, pulse }: { ratio: number; pulse: boolean }) {
  const segs = 8;
  const lit = Math.round(ratio * segs);
  return (
    <div className="flex gap-0.5 mt-1">
      {Array.from({ length: segs }, (_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-sm ${
            i < lit ? "bg-amber-300/90" : "bg-slate-700"
          } ${pulse && i === lit - 1 ? "dugout-anim-pulse-glow" : ""}`}
        />
      ))}
    </div>
  );
}

export function QuestStrip() {
  const activeQuests = useGameStore((s) => s.activeQuests);
  const questProgress = useGameStore((s) => s.questProgress);
  const questTick = useGameStore((s) => s.questTick);
  const phase = useGameStore((s) => s.phase);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusAnchor, setFocusAnchor] = useState<{ left: number; top: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!focusedId) {
      setFocusAnchor(null);
      return;
    }
    const sync = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-quest-focus-anchor="${focusedId}"]`,
      );
      if (!el) {
        setFocusAnchor(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setFocusAnchor({ left: r.right + 12, top: r.top });
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [focusedId, questTick]);

  if (
    activeQuests.length === 0 ||
    phase === "drafting" ||
    phase === "game-over"
  ) {
    return null;
  }

  let bestId = activeQuests[0]!;
  let bestRatio = -1;
  for (const id of activeQuests) {
    const p = questProgress[id];
    const def = QUEST_REGISTRY[id];
    if (!p || !def) continue;
    const r = questProgressRatio(id, p);
    if (r > bestRatio) {
      bestRatio = r;
      bestId = id;
    }
  }
  const bestDef = QUEST_REGISTRY[bestId];
  const bestP = questProgress[bestId];

  const focusedDef = focusedId ? QUEST_REGISTRY[focusedId] : null;
  const focusedP = focusedId ? questProgress[focusedId] : null;

  return (
    <>
    <div
      data-tutorial="quests"
      className="pointer-events-none absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-20"
    >
      {/*
       * Inner wrapper holds ONLY the strip cards. Quest detail panel is
       * portaled to document.body (see createPortal below) so it stacks above
       * overflow clips and stays aligned via data-quest-focus-anchor + layout.
       */}
      <div className="relative flex flex-col gap-2 w-[200px] max-w-[200px]">
      <div className="hidden xl:flex flex-col gap-2 w-[200px]">
        {activeQuests.map((id) => {
          const def = QUEST_REGISTRY[id];
          const p = questProgress[id];
          if (!def || !p) return null;
          const ratio = questProgressRatio(id, p);
          const almost = !p.completed && ratio >= 0.75 && ratio < 1;
          return (
            <motion.button
              type="button"
              key={`${id}-${questTick}`}
              data-quest-focus-anchor={id}
              onMouseEnter={() => setFocusedId(id)}
              onMouseLeave={() =>
                setFocusedId((curr) => (curr === id ? null : curr))
              }
              onFocus={() => setFocusedId(id)}
              onBlur={() =>
                setFocusedId((curr) => (curr === id ? null : curr))
              }
              onClick={() =>
                setFocusedId((curr) => (curr === id ? null : id))
              }
              aria-expanded={focusedId === id}
              aria-label={`Quest: ${def.title}. ${def.hint}`}
              className={`pointer-events-auto text-left rounded-md border bg-slate-900/85 shadow-lg px-2 py-1.5 transition-colors hover:bg-slate-800/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                p.completed
                  ? "ring-1 ring-amber-400/70 border-amber-400/60"
                  : focusedId === id
                  ? "border-amber-300/80"
                  : "border-slate-600/90"
              }`}
              initial={{ opacity: 0.85, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
            >
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-1 w-6 shrink-0 rounded-full ${RARITY_BAR[def.rarity]}`}
                />
                {p.completed ? (
                  <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] font-black uppercase tracking-wide text-slate-300 truncate leading-tight">
                    {def.title}
                  </div>
                  {!p.completed ? (
                    <SegmentBar ratio={ratio} pulse={almost} />
                  ) : (
                    <div className="text-[8px] text-amber-200/90 font-bold uppercase mt-0.5">
                      Done
                    </div>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {bestDef && bestP ? (
        <button
          type="button"
          data-quest-focus-anchor={bestId}
          onMouseEnter={() => setFocusedId(bestId)}
          onMouseLeave={() =>
            setFocusedId((curr) => (curr === bestId ? null : curr))
          }
          onFocus={() => setFocusedId(bestId)}
          onBlur={() =>
            setFocusedId((curr) => (curr === bestId ? null : curr))
          }
          onClick={() =>
            setFocusedId((curr) => (curr === bestId ? null : bestId))
          }
          aria-expanded={focusedId === bestId}
          aria-label={`Quest: ${bestDef.title}. ${bestDef.hint}`}
          className={`pointer-events-auto flex xl:hidden text-left rounded-md border bg-slate-900/90 shadow-md px-2 py-1.5 w-[min(42vw,168px)] transition-colors hover:bg-slate-800/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
            focusedId === bestId
              ? "border-amber-300/80"
              : "border-slate-600/90"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className={`h-8 w-1 shrink-0 rounded-full ${RARITY_BAR[bestDef.rarity]}`}
            />
            {bestP.completed ? (
              <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
            ) : null}
            <div className="min-w-0">
              <div className="text-[8px] font-black uppercase tracking-wide text-slate-400 leading-tight">
                Quest
              </div>
              <div className="text-[9px] font-black uppercase tracking-wide text-slate-200 truncate">
                {bestDef.title}
              </div>
              {!bestP.completed ? (
                <SegmentBar
                  ratio={questProgressRatio(bestId, bestP)}
                  pulse={
                    questProgressRatio(bestId, bestP) >= 0.75 &&
                    questProgressRatio(bestId, bestP) < 1
                  }
                />
              ) : (
                <div className="text-[8px] text-amber-200 font-bold uppercase">
                  Done
                </div>
              )}
            </div>
          </div>
        </button>
      ) : null}

      </div>
    </div>
    {typeof document !== "undefined" &&
      createPortal(
        <AnimatePresence>
          {focusedDef && focusedP && focusAnchor ? (
            <QuestFocusOverlay
              key={focusedDef.id}
              def={focusedDef}
              progress={focusedP}
              anchor={focusAnchor}
            />
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function QuestFocusOverlay({
  def,
  progress,
  anchor,
}: {
  def: (typeof QUEST_REGISTRY)[string];
  progress: import("../lib/quests").QuestProgressState;
  anchor: { left: number; top: number };
}) {
  const ratio = questProgressRatio(def.id, progress);
  const detail = questProgressLabel(def.id, progress);
  const reward = questRewardDescription(def.reward);
  const almost = !progress.completed && ratio >= 0.75 && ratio < 1;

  return (
    <motion.aside
      role="dialog"
      aria-label={`${def.title} details`}
      className={`pointer-events-none fixed ${QUEST_FOCUS_Z} w-[260px] sm:w-[300px] rounded-lg border bg-gradient-to-br ${RARITY_PANEL[def.rarity]} shadow-2xl backdrop-blur-md px-3.5 py-3 text-left`}
      style={{ left: anchor.left, top: anchor.top }}
      initial={{ opacity: 0, x: -8, scale: 0.97 }}
      animate={{
        opacity: 1,
        x: 0,
        scale: 1,
        transition: { type: "spring", stiffness: 380, damping: 28 },
      }}
      exit={{
        opacity: 0,
        x: -6,
        scale: 0.97,
        transition: { duration: 0.14, ease: "easeIn" },
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className={`text-[9px] font-black uppercase tracking-[0.25em] ${RARITY_TEXT[def.rarity]}`}
        >
          {RARITY_LABEL[def.rarity]} Quest
        </span>
        <div className={`h-1 w-10 rounded-full ${RARITY_BAR[def.rarity]}`} />
      </div>

      <h3 className="dugout-font-sport text-xl uppercase text-white leading-tight tracking-wide">
        {def.title}
      </h3>
      <p className="text-[11px] text-slate-300/95 italic mt-0.5">
        {def.flavor}
      </p>

      <div className="mt-3 rounded-md bg-slate-950/55 border border-slate-700/70 px-2.5 py-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
          Objective
        </div>
        <p className="text-[12px] text-slate-100 leading-snug">{def.hint}</p>
      </div>

      <div className="mt-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            Progress
          </span>
          <span
            className={`text-[10px] font-bold ${
              progress.completed ? "text-emerald-300" : "text-amber-200"
            }`}
          >
            {detail}
          </span>
        </div>
        <SegmentBar ratio={ratio} pulse={almost} />
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-2">
        <Sparkles className="w-3.5 h-3.5 text-emerald-300 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-[9px] font-black uppercase tracking-widest text-emerald-300/90">
            Reward
          </div>
          <p className="text-[11px] text-emerald-100 leading-snug">{reward}</p>
        </div>
      </div>
    </motion.aside>
  );
}
