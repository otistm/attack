import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGameStore } from "../lib/gameStore";
import { QUEST_REGISTRY, type QuestRarity } from "../lib/quests";
import { questRewardDescription } from "../lib/questRewards";
import { ParticleBurst } from "./effects/ParticleBurst";

const RARITY_MS: Record<QuestRarity, number> = {
  common: 1500,
  rare: 2000,
  legendary: 2800,
};

const RARITY_TINT: Record<QuestRarity, string> = {
  common: "from-slate-700/95 via-slate-900/98 to-slate-950",
  rare: "from-amber-900/90 via-slate-950 to-amber-950/95",
  legendary: "from-fuchsia-900/85 via-slate-950 to-sky-950/90",
};

const BURST_COLORS: Record<QuestRarity, string[]> = {
  common: ["#94a3b8", "#cbd5e1", "#fbbf24", "#ffffff"],
  rare: ["#fbbf24", "#f59e0b", "#fef08a", "#ffffff"],
  legendary: ["#e879f9", "#38bdf8", "#fbbf24", "#fef08a", "#ffffff"],
};

/** Jagged comic "POW" plate (normalized polygon for viewBox 0 0 100 60) */
function PowPlate({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 60"
      fill="currentColor"
      aria-hidden
    >
      <polygon points="8,25 0,12 18,8 22,0 38,6 52,2 68,10 85,0 95,12 100,22 92,32 98,45 85,52 72,58 55,54 38,60 22,50 10,48 2,38" />
    </svg>
  );
}

export function QuestCompleteOverlay() {
  const queue = useGameStore((s) => s.questCelebrationQueue);
  const head = queue[0] ?? null;
  const complete = useGameStore((s) => s.completeQuestCelebration);

  const def = head ? QUEST_REGISTRY[head] : null;
  const rarity: QuestRarity = def?.rarity ?? "common";
  const durationMs = RARITY_MS[rarity];

  useEffect(() => {
    if (!head || !def) return;
    const t = window.setTimeout(() => complete(), durationMs);
    return () => window.clearTimeout(t);
  }, [head, def, complete, durationMs]);

  const rewardLine = def ? questRewardDescription(def.reward) : "";

  const motionLines = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        rot: (360 / 18) * i + (head?.length ?? 0) * 3,
        len: 38 + (i % 5) * 14,
      })),
    [head],
  );

  return (
    <AnimatePresence>
      {def && (
        <motion.div
          key={head}
          className="fixed inset-0 z-[45] flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          <div
            className={`absolute inset-0 bg-gradient-to-br ${RARITY_TINT[rarity]} opacity-95`}
          />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.12)_0%,transparent_55%)]" />

          {motionLines.map((ln) => (
            <motion.div
              key={ln.id}
              className="absolute left-1/2 top-1/2 w-[2px] origin-bottom bg-gradient-to-t from-transparent via-white/45 to-white/20 rounded-full"
              style={{
                height: ln.len,
                marginLeft: -1,
                marginTop: -ln.len,
              }}
              initial={{ opacity: 0.15, scaleY: 0.35, rotate: ln.rot }}
              animate={{ opacity: [0.15, 0.55, 0.22], scaleY: [0.35, 1, 1.06], rotate: ln.rot }}
              transition={{ duration: 0.48, ease: "easeOut" }}
            />
          ))}

          <ParticleBurst variant="complete" colors={BURST_COLORS[rarity]} />

          <motion.div
            className="relative flex flex-col items-center gap-3 px-6 max-w-lg text-center"
            initial={{ scale: 0.65, y: 40, rotate: -4 }}
            animate={{
              scale: [0.65, 1.05, 1],
              y: [40, -6, 0],
              rotate: [-4, 2, 0],
            }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 18,
              mass: 0.9,
            }}
          >
            <div className="relative w-[min(92vw,420px)] aspect-[5/3] flex items-center justify-center">
              <PowPlate className="absolute inset-0 w-full h-full text-yellow-400 drop-shadow-[0_6px_0_#78350f] opacity-95" />
              <span
                className="relative z-[1] dugout-font-title dugout-title-3d text-5xl sm:text-6xl md:text-7xl leading-none tracking-tight text-yellow-300"
                style={{ WebkitTextStroke: "2px #451a03" }}
              >
                POW!
              </span>
            </div>

            <motion.div
              className="relative z-[2] -mt-2 px-5 py-3 rounded-lg border border-amber-500/40 bg-slate-950/80 shadow-lg"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, type: "spring", stiffness: 220, damping: 22 }}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-300/90 mb-1">
                Quest complete
              </p>
              <h2 className="dugout-font-sport text-2xl sm:text-3xl uppercase text-white tracking-wide">
                {def.title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 dugout-font-base">
                {def.flavor}
              </p>
              <p className="text-[11px] font-bold text-emerald-300 mt-2 uppercase tracking-wide">
                Reward: {rewardLine}
              </p>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
