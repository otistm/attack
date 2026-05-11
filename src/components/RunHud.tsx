/**
 * RunHud — top-bar HUD for SZN Mode runs. Surfaces the meta-loop state
 * (week, day, W/L, cash) so the player always knows where they are in the
 * 12-week journey. Mounted only when `gameMode === "szn"` and a run is
 * active; legacy lanes do not show this strip.
 */

import { motion } from "motion/react";
import { Briefcase, CalendarDays, DollarSign, Trophy, X } from "lucide-react";
import { getUserSide, useGameStore } from "../lib/gameStore";
import { RUN_LOSS_LIMIT, RUN_WIN_TARGET, type WeekDay } from "../lib/run";

const DAY_LABEL: Record<WeekDay, string> = {
  mon: "MON",
  tue: "TUE",
  wed: "WED",
  thu: "THU",
  series: "SERIES",
};

export function RunHud() {
  const run = useGameStore((s) => s.run);
  const gameMode = useGameStore((s) => s.gameMode);
  // The in-game header (scoreboard, action bar) lives at top: 0 during
  // combat. To prevent the run pill from clipping over it we slide
  // the pill out to the bottom-right corner during combat. Outside of
  // combat (pack-rip / front office / series intro) it stays centered
  // at the top so it can act as the page-level run header.
  // Read `s.gameMode` directly inside the selector instead of closing
  // over the outer `gameMode` value -- the latter would only refresh
  // when the selector function reference itself changes, which is a
  // foot-gun if this selector ever gets memoized or shared.
  const inGameplayCombat = useGameStore((s) => {
    if (!s.run || s.gameMode !== "szn") return false;
    if (s.run.packRipPending) return false;
    if (s.run.endState !== null) return false;
    if (s.run.day !== "series") return false;
    if (!s.run.series?.gameInProgress) return false;
    return true;
  });
  const showDugoutToggle = useGameStore((s) => {
    if (!s.run || s.gameMode !== "szn") return false;
    if (s.run.packRipPending) return false;
    if (s.run.endState !== null) return false;
    if (s.run.day !== "series") return false;
    if (!s.run.series?.gameInProgress) return false;
    return s.phase === "selecting";
  });
  if (!run || gameMode !== "szn") return null;

  // Two layouts: centered banner (out of combat) vs. corner stack
  // (during combat): Dugout above the week strip so it never stacks on
  // Lock In; the in-game scoreboard owns the top-center anchor.
  const stripClass =
    "flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-slate-950/85 px-3 py-2 shadow-xl backdrop-blur-sm pointer-events-auto";

  const stripInner = (
    <>
      <Pill icon={<CalendarDays className="w-3.5 h-3.5" />} label={`WEEK ${run.week}/12`} />
      <span className="opacity-60 text-[10px]">·</span>
      <Pill label={DAY_LABEL[run.day]} accent={run.day === "series" ? "emerald" : "amber"} />
      <span className="opacity-60 text-[10px]">·</span>
      <Pill
        icon={<Trophy className="w-3.5 h-3.5" />}
        label={`${run.wins}/${RUN_WIN_TARGET}`}
        accent="emerald"
      />
      <Pill
        icon={<X className="w-3.5 h-3.5" />}
        label={`${run.losses}/${RUN_LOSS_LIMIT}`}
        accent="rose"
      />
      <span className="opacity-60 text-[10px]">·</span>
      {/* DollarSign icon already conveys "this is cash"; the leading
          literal `$` produced a duplicate ($\10) in the rendered pill. */}
      <Pill
        icon={<DollarSign className="w-3.5 h-3.5" />}
        label={`${run.cash}`}
        accent="amber"
      />
    </>
  );

  if (inGameplayCombat) {
    return (
      <div className="absolute bottom-3 right-3 z-30 flex flex-col items-end gap-2 pointer-events-none dugout-font-base text-xs sm:text-sm">
        {showDugoutToggle ? <SznCombatDugoutToggle /> : null}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={stripClass}
        >
          {stripInner}
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 ${stripClass}`}
    >
      {stripInner}
    </motion.div>
  );
}

function SznCombatDugoutToggle() {
  const run = useGameStore((s) => s.run);
  const open = useGameStore((s) => s.sznDugoutOpen);
  const setOpen = useGameStore((s) => s.setSznDugoutOpen);
  const userHand = useGameStore((s) =>
    getUserSide(s) === "Batting" ? s.batterHand : s.pitcherHand,
  );
  const userSide = useGameStore((s) => getUserSide(s));
  if (!run) return null;
  const dealtFromBag = userHand.filter((c) => !c.id.startsWith("player:"));
  const seatLabel = userSide === "Batting" ? "BAT" : "PIT";

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="pointer-events-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-black uppercase tracking-widest shadow-lg border border-emerald-400/40"
    >
      <Briefcase className="w-4 h-4" />
      Dugout
      <span className="ml-1 text-emerald-200">
        {dealtFromBag.length}/{run.itemBag.length}
      </span>
      <span className="ml-1 text-emerald-300/70">· {seatLabel}</span>
    </button>
  );
}

function Pill({
  icon,
  label,
  accent = "slate",
}: {
  icon?: React.ReactNode;
  label: string;
  accent?: "slate" | "emerald" | "amber" | "rose";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "amber"
        ? "text-amber-300"
        : accent === "rose"
          ? "text-rose-300"
          : "text-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider ${color}`}>
      {icon}
      {label}
    </span>
  );
}
