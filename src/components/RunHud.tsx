/**
 * RunHud — top-bar HUD for SZN Mode runs. Surfaces the meta-loop state
 * (week, day, W/L, cash) so the player always knows where they are in the
 * 12-week journey. Mounted only when `gameMode === "szn"` and a run is
 * active; legacy lanes do not show this strip.
 *
 * Includes the "Abandon Run" entry point (combat only — outside of
 * combat the user can already navigate back via the Front Office
 * surfaces). The button is wrapped in a confirm modal so a casual tap
 * can't drop a multi-week run.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Briefcase, CalendarDays, DollarSign, LogOut, Trophy, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { RUN_LOSS_LIMIT, RUN_WIN_TARGET, type SeriesScoreline, type WeekDay } from "../lib/run";
import { useSznGamepad } from "../lib/useSznGamepad";
import { BADGES, type BadgeId } from "../lib/badges";

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
  const endRun = useGameStore((s) => s.endRun);
  const footerHeight = useGameStore((s) => s.sznFooterHeight);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
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

  // TRIANGLE = open Abandon modal. Only enabled in combat (the only
  // place the Abandon button itself is rendered). Priority 50 wedges
  // between footer (0) / screen (20) and any modal (100) so the
  // PlayerChoiceModal can't accidentally bind TRIANGLE.
  useSznGamepad({
    id: "run-hud-abandon",
    priority: 50,
    enabled: inGameplayCombat && !confirmingAbandon,
    handler: (btn) => {
      if (btn === "TRIANGLE") setConfirmingAbandon(true);
    },
  });

  // Confirm modal binding — CROSS abandons, CIRCLE keeps playing.
  // Priority 200 wins over any modal already open (PlayerChoiceModal
  // is 200 too but this binding only registers when its own modal is
  // open, and that requires the user to have already pressed
  // TRIANGLE while the choice modal was inactive).
  useSznGamepad({
    id: "run-hud-abandon-confirm",
    priority: 200,
    enabled: confirmingAbandon,
    handler: (btn) => {
      if (btn === "CROSS") {
        setConfirmingAbandon(false);
        endRun("manual");
      } else if (btn === "CIRCLE") {
        setConfirmingAbandon(false);
      }
    },
  });

  if (!run || gameMode !== "szn") return null;

  // Two layouts: centered banner (out of combat) vs. corner stack
  // (during combat). The dugout toggle used to live here above the
  // week strip; with the always-on `SznFooterDecks` it's no longer
  // needed -- the bag is permanently in the deck footer instead.
  // "WEEK X/12" framing was removed -- the actual terminators are
  // 10W / 3L, not a calendar cap, and showing "/12" implied the run
  // ends at week 12 even when the user is still mid-record.
  const stripClass =
    "flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-slate-950/85 px-3 py-2 shadow-xl backdrop-blur-sm pointer-events-auto";

  // Front Office pill only renders on management days (Mon-Thu). On the
  // SERIES day the day pill already reads "SERIES" which is self-
  // descriptive, so we'd just be duplicating context. The pill replaces
  // the removed `FrontOfficeScreen` hero header so the FO label still
  // sits prominently alongside week / W-L / cash.
  const isFrontOffice = run.day !== "series";
  const stripInner = (
    <>
      {/* WEEK chip. Switches to a "FINAL WEEK" amber pill at the cap
          (12) so the user knows budget tiers won't escalate further
          and the regular season ladder is one weekend from terminal. */}
      <Pill
        icon={<CalendarDays className="w-3.5 h-3.5" />}
        label={run.week >= 12 ? `WEEK ${run.week} · FINAL` : `WEEK ${run.week}`}
        accent={run.week >= 12 ? "amber" : "slate"}
      />
      <BadgeStrip badges={run.badges} />
      <SznEncounterChips
        defenseShields={run.defenseShields}
        bangingSchemeWeeksLeft={run.bangingSchemeWeeksLeft}
        karmaDoubleTriggers={run.karmaDoubleTriggers}
        rallyFireWeeksLeft={run.rallyFireWeeksLeft}
      />
      {/* "Last Series" recap chip lives between the buff strip and the
          day pill. Only renders during the Front Office week (the chip
          self-clears on `startSeries`, see gameStore), so it's never
          double-shown alongside an in-progress series. */}
      {run.lastSeriesScoreline && (
        <LastSeriesChip line={run.lastSeriesScoreline} />
      )}
      <span className="opacity-60 text-[10px]">·</span>
      {isFrontOffice && (
        <>
          <Pill
            icon={<Briefcase className="w-3.5 h-3.5" />}
            label="FRONT OFFICE"
            accent="sky"
          />
          <span className="opacity-60 text-[10px]">·</span>
        </>
      )}
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
        label={`${run.cash}${run.nextWeekCashBonus > 0 ? ` (+${run.nextWeekCashBonus})` : ""}`}
        accent="amber"
      />
    </>
  );

  if (inGameplayCombat) {
    // Lift the corner pill above the always-on `SznFooterDecks` (which
    // lives at z-40 with live measured `sznFooterHeight`). Without
    // this lift the run pill literally hides behind the deck strip
    // mid-game. +12px gives the same breathing-room as the hand lift.
    const liftPx = Math.max(0, footerHeight) + 12;
    return (
      <>
        <div
          className="absolute right-3 z-30 flex flex-col items-end gap-2 pointer-events-none dugout-font-base text-xs sm:text-sm"
          style={{ bottom: `${liftPx}px` }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={stripClass}
          >
            {stripInner}
          </motion.div>
          <button
            type="button"
            onClick={() => setConfirmingAbandon(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-500/40 bg-slate-950/85 text-rose-200 hover:bg-rose-700/40 hover:text-white text-[10px] font-black uppercase tracking-widest shadow-lg backdrop-blur-sm pointer-events-auto"
            title="Forfeit this run and return to the lane chooser."
          >
            <LogOut className="w-3 h-3" />
            Abandon Run
          </button>
        </div>
        <AbandonConfirmModal
          open={confirmingAbandon}
          run={{ wins: run.wins, losses: run.losses, week: run.week }}
          onCancel={() => setConfirmingAbandon(false)}
          onConfirm={() => {
            setConfirmingAbandon(false);
            // 'manual' is the explicit "I quit" path. endRun records it
            // as a fired-style run end so the EndRunScreen takes over.
            endRun("manual");
          }}
        />
      </>
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

function AbandonConfirmModal({
  open,
  run,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  run: { wins: number; losses: number; week: number };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="abandon-confirm"
          className="absolute inset-0 z-50 flex items-center justify-center px-4 pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-slate-950/80"
            onClick={onCancel}
            aria-hidden
          />
          <motion.div
            initial={{ scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 12 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="relative max-w-sm w-full rounded-2xl border border-rose-500/50 bg-slate-900 p-6 shadow-2xl"
          >
            <h3 className="dugout-font-sport text-xl uppercase tracking-widest text-rose-200 mb-2">
              Abandon Run?
            </h3>
            <p className="text-sm text-slate-300 leading-snug mb-5">
              You'll forfeit this series mid-game.{" "}
              <span className="text-rose-200 font-bold">
                Week {run.week} · {run.wins}W / {run.losses}L
              </span>{" "}
              progress will be lost.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-md border border-slate-600 text-slate-200 hover:border-slate-400 text-xs font-bold uppercase tracking-widest"
              >
                Keep Playing
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="px-4 py-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-widest shadow"
              >
                Abandon
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Compact horizontal strip of passive badge chips. Grows as the user
 * acquires badges through the run; each chip uses the badge's icon +
 * tint and exposes a tooltip with the full flavor text.
 *
 * Rendered between the WEEK pill and the DAY pill in `stripInner` so
 * the player's permanent passives are read in the same eyeline as the
 * core run metadata.
 */
function BadgeStrip({ badges }: { badges: BadgeId[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 ml-1">
      {badges.map((id) => {
        const def = BADGES[id];
        if (!def) return null;
        return (
          <motion.span
            key={id}
            title={`${def.name} -- ${def.flavor}`}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 280, damping: 20 }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-widest text-white shadow-sm"
            style={{
              backgroundColor: `${def.tint}cc`,
              borderColor: "rgba(255,255,255,0.4)",
            }}
          >
            <span aria-hidden>{def.icon}</span>
            <span className="hidden sm:inline">{def.name.replace(/^The\s+/i, "")}</span>
          </motion.span>
        );
      })}
    </span>
  );
}

/**
 * SZN encounter status strip. Sits next to the badge strip and renders
 * one chip per active encounter buff:
 *   - Defense Shield count (Encounter #9)
 *   - Banging Scheme weeks left (Encounter #10)
 *   - Karma double-trigger (Encounter #10 alt)
 *   - Rally Fire weeks left (Encounter #7)
 *
 * Chips don't render when the corresponding counter is 0/false so the
 * HUD only widens for the buffs the user actually has.
 */
function SznEncounterChips({
  defenseShields,
  bangingSchemeWeeksLeft,
  karmaDoubleTriggers,
  rallyFireWeeksLeft,
}: {
  defenseShields: number;
  bangingSchemeWeeksLeft: number;
  karmaDoubleTriggers: boolean;
  rallyFireWeeksLeft: number;
}) {
  // `permanent: true` chips render with a dashed double-ring border so
  // the user can tell at a glance which buffs decrement at week
  // rollover (Rally Fire, Banging Scheme — both timer chips) vs which
  // persist for the rest of the run (Karma, queued defense shields).
  // Without this differentiation the playtester reported "Karma 2x"
  // looking like a 2-week timer instead of an indefinite buff.
  const chips: {
    key: string;
    icon: string;
    label: string;
    tint: string;
    title: string;
    permanent: boolean;
  }[] = [];
  if (defenseShields > 0) {
    // Defense shields are consumed per-snap (count goes down on use),
    // not on a week timer — labeled with an `x` so the readout matches
    // the "queued count" semantics.
    chips.push({
      key: "shield",
      icon: "🛡️",
      label: `×${defenseShields}`,
      tint: "#22d3ee",
      title: `Defense Shield -- nullifies the opponent's next ${defenseShields} pitching scores. Consumed per snap, not per week.`,
      permanent: true,
    });
  }
  if (bangingSchemeWeeksLeft > 0) {
    chips.push({
      key: "peek",
      icon: "🔔",
      label: `${bangingSchemeWeeksLeft}w`,
      tint: "#fbbf24",
      title: `Banging Scheme -- peek opponent's first card for the next ${bangingSchemeWeeksLeft} series. Ticks down at week rollover.`,
      permanent: false,
    });
  }
  if (karmaDoubleTriggers) {
    chips.push({
      key: "karma",
      icon: "✨",
      label: "2×",
      tint: "#c084fc",
      title: "Karma -- passive badge triggers fire twice. Permanent for the rest of the run.",
      permanent: true,
    });
  }
  if (rallyFireWeeksLeft > 0) {
    chips.push({
      key: "rally",
      icon: "🔥",
      label: `${rallyFireWeeksLeft}w`,
      tint: "#ef4444",
      title: `Rally Fire -- adjacent-card +10% aura for the next ${rallyFireWeeksLeft} series. Ticks down at week rollover.`,
      permanent: false,
    });
  }
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 ml-1">
      {chips.map((c) => (
        <motion.span
          key={c.key}
          title={c.title}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 20 }}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest text-white shadow-sm ${
            c.permanent
              ? "border-2 border-dashed ring-1 ring-white/30"
              : "border border-solid"
          }`}
          style={{
            backgroundColor: `${c.tint}cc`,
            borderColor: c.permanent ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)",
          }}
        >
          <span aria-hidden>{c.icon}</span>
          <span>{c.label}</span>
          {c.permanent && (
            <span aria-hidden className="text-[8px] opacity-80">∞</span>
          )}
        </motion.span>
      ))}
    </span>
  );
}

/**
 * "Last Series" inline chip rendered in `stripInner` between the buff
 * strip and the day pill. Self-clears via `gameStore.startSeries`, so
 * presence == "a series just finished AND the next one hasn't started
 * yet" -- exactly the FO-week window the user needs the reminder.
 */
function LastSeriesChip({ line }: { line: SeriesScoreline }) {
  const tint = line.userWon ? "#10b981" : "#f43f5e";
  const verb = line.userWon ? "WON" : "LOST";
  const score = `${line.userGameWins}-${line.ghostGameWins}`;
  return (
    <motion.span
      title={`Week ${line.weekJustPlayed}: ${verb} ${score}`}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 280, damping: 20 }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-widest text-white shadow-sm ml-1"
      style={{ backgroundColor: `${tint}cc`, borderColor: "rgba(255,255,255,0.4)" }}
    >
      <span aria-hidden>{line.userWon ? "🏆" : "💀"}</span>
      <span>{verb} {score}</span>
    </motion.span>
  );
}

function Pill({
  icon,
  label,
  accent = "slate",
}: {
  icon?: React.ReactNode;
  label: string;
  accent?: "slate" | "emerald" | "amber" | "rose" | "sky";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "amber"
        ? "text-amber-300"
        : accent === "rose"
          ? "text-rose-300"
          : accent === "sky"
            ? "text-sky-300"
            : "text-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider ${color}`}>
      {icon}
      {label}
    </span>
  );
}
