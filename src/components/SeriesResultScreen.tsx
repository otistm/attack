/**
 * SeriesResultScreen — the dedicated "weekend wrap" splash shown
 * after `reportSeriesGameResult` closes the single weekend Game of
 * the Week. Sits between the game's `CardGameOverlay` (game-over
 * phase) and the Monday Front Office (or the EndRunScreen for 10W /
 * 3L terminals).
 *
 * The weekend used to be a Bo3 series so this screen still rides on
 * the same `lastSeriesSummary` snapshot; with single-game weekends
 * the per-side `userGameWins / ghostGameWins` are always {1, 0} (or
 * {0, 1}) -- the user-facing scoreline therefore surfaces the
 * `userRunsTotal / ghostRunsTotal` runs scored in the actual game
 * instead of the binary game-win count, which would just echo the
 * already-stated win/loss headline.
 *
 * Reads exclusively off `run.lastSeriesSummary`, which is captured in
 * the same `set()` call that rolls the week over so the BEFORE/AFTER
 * values on buff timers / cash are authoritative even though the rest
 * of the store has already moved on to next week. The user dismisses
 * via the "Continue" button (or CROSS / TRIANGLE on a gamepad), which
 * calls `dismissSeriesSummary` and nulls the snapshot. We deliberately
 * do NOT animate the cash counter -- the audit flagged "no rollover
 * messaging" as the gap, so the priority is making the numbers
 * legible, not flashy.
 *
 * Renders nothing when no snapshot is queued, so it can sit alongside
 * the FrontOfficeScreen / EndRunScreen mounts in App.tsx without any
 * external gating.
 */

import { motion } from "motion/react";
import { Trophy, Skull, ArrowRight, Coins } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { useSznGamepad } from "../lib/useSznGamepad";

export function SeriesResultScreen() {
  const summary = useGameStore((s) => s.run?.lastSeriesSummary ?? null);
  const dismiss = useGameStore((s) => s.dismissSeriesSummary);

  // Gamepad: CROSS / TRIANGLE both dismiss. Priority 80 so a stray
  // FO-screen press at 20 can't steal focus, but the encounter modals
  // (≥100) still win if anything else somehow stacks above.
  useSznGamepad({
    id: "series-result-screen",
    priority: 80,
    enabled: !!summary,
    handler: (btn) => {
      if (btn === "CROSS" || btn === "TRIANGLE" || btn === "CIRCLE") dismiss();
    },
  });

  if (!summary) return null;

  const {
    userWonSeries,
    // userGameWins / ghostGameWins are still on the snapshot for
    // historical compatibility (and any future stat surfaces), but
    // the single-game weekend renders runs, not game-wins, so they
    // are deliberately not destructured here.
    userRunsTotal,
    ghostRunsTotal,
    weekJustPlayed,
    newWins,
    newLosses,
    endState,
    cashBefore,
    cashAfter,
    weeklyRefill,
    triggerBonus,
    ghostLabel,
    bangingSchemeBefore,
    bangingSchemeAfter,
    rallyFireBefore,
    rallyFireAfter,
    nextGameBoostExpired,
    scoutingIntelExpired,
    suspensionsExpired,
    karmaActive,
    defenseShieldsActive,
  } = summary;

  const accent = userWonSeries
    ? { ring: "ring-emerald-400/60", border: "border-emerald-400/50", bg: "from-emerald-900/40", text: "text-emerald-300" }
    : { ring: "ring-rose-400/60", border: "border-rose-400/50", bg: "from-rose-900/40", text: "text-rose-300" };

  // Margin frames the game's competitiveness ("by 4" vs "in a
  // blowout"). The headline uses it to inflect tone: a 1-run nail-biter
  // and a 12-run rout shouldn't read the same way to the user.
  const runMargin = Math.abs(userRunsTotal - ghostRunsTotal);
  const isShutout = (userWonSeries && ghostRunsTotal === 0) || (!userWonSeries && userRunsTotal === 0);
  const isBlowout = runMargin >= 6 && !isShutout;
  const isNailBiter = runMargin <= 1;

  const headline = endState === "champion"
    ? "Pennant Clinched"
    : endState === "fired"
      ? "Front Office Pulled the Plug"
      : userWonSeries
        ? isShutout
          ? "Shutout Win"
          : isBlowout
            ? "Blowout Win"
            : isNailBiter
              ? "Walk-Off Win"
              : "Game Won"
        : isShutout
          ? "Shutout Loss"
          : isBlowout
            ? "Blowout Loss"
            : isNailBiter
              ? "Heartbreaker"
              : "Game Lost";

  const subhead = endState
    ? `Run record ${newWins}W · ${newLosses}L`
    : `vs ${ghostLabel ?? "Opponent"} · Week ${weekJustPlayed}`;

  // "Why we won / lost" tagline pulled straight off the runs ledger.
  // Reads underneath the scoreline so the user knows the margin
  // without doing the subtraction themselves.
  const marginTag = userWonSeries
    ? isShutout
      ? `Held them scoreless · won by ${userRunsTotal}`
      : `Won by ${runMargin} run${runMargin === 1 ? "" : "s"}`
    : isShutout
      ? `Couldn't put one on the board · lost by ${ghostRunsTotal}`
      : `Lost by ${runMargin} run${runMargin === 1 ? "" : "s"}`;

  // Build the "what changed at rollover" rows. We render zero rows
  // when nothing changed so the panel doesn't look hollow.
  const timerRows: { key: string; label: string; before: string; after: string; expired: boolean }[] = [];
  if (bangingSchemeBefore > 0) {
    timerRows.push({
      key: "banging",
      label: "Banging Scheme",
      before: `${bangingSchemeBefore}w`,
      after: bangingSchemeAfter === 0 ? "expired" : `${bangingSchemeAfter}w`,
      expired: bangingSchemeAfter === 0,
    });
  }
  if (rallyFireBefore > 0) {
    timerRows.push({
      key: "rally",
      label: "Rally Fire",
      before: `${rallyFireBefore}w`,
      after: rallyFireAfter === 0 ? "expired" : `${rallyFireAfter}w`,
      expired: rallyFireAfter === 0,
    });
  }
  if (nextGameBoostExpired) {
    timerRows.push({ key: "boost", label: "Hold-the-Line Boost", before: "active", after: "spent", expired: true });
  }
  if (scoutingIntelExpired) {
    timerRows.push({ key: "intel", label: "Scouting Intel", before: "queued", after: "consumed", expired: true });
  }
  if (suspensionsExpired > 0) {
    timerRows.push({
      key: "susp",
      label: `${suspensionsExpired === 1 ? "Suspension" : "Suspensions"}`,
      before: `${suspensionsExpired}`,
      after: "lifted",
      expired: true,
    });
  }

  const stillActive: { key: string; label: string; tint: string }[] = [];
  if (karmaActive) stillActive.push({ key: "karma", label: "Karma 2×", tint: "#c084fc" });
  if (defenseShieldsActive > 0) stillActive.push({ key: "shield", label: `Defense ×${defenseShieldsActive}`, tint: "#22d3ee" });

  // Cash row only renders the weekly refill / trigger bonus when the
  // run is continuing -- on a terminal run we just show "$Cash held".
  const showCashDelta = !endState;

  return (
    <motion.div
      key="series-result"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-950/92 backdrop-blur-md px-4 pointer-events-auto dugout-font-base text-white"
    >
      <motion.div
        initial={{ scale: 0.94, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 24 }}
        className={`w-full max-w-xl rounded-2xl border-2 ${accent.border} bg-gradient-to-br ${accent.bg} via-slate-950/80 to-slate-950 p-6 shadow-[0_28px_80px_-12px_rgba(0,0,0,0.8)] ring-1 ${accent.ring}`}
      >
        {/* Headline strip */}
        <div className="flex items-center gap-3 mb-1">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center border ${accent.border} bg-slate-900/60`}
            aria-hidden
          >
            {endState === "champion" || (userWonSeries && !endState) ? (
              <Trophy className={`w-6 h-6 ${accent.text}`} />
            ) : (
              <Skull className={`w-6 h-6 ${accent.text}`} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className={`text-[10px] font-black uppercase tracking-[0.35em] ${accent.text} block`}>
              Game of the Week · Recap
            </span>
            <h3 className="dugout-font-sport text-2xl sm:text-3xl uppercase tracking-wide text-white leading-tight truncate">
              {headline}
            </h3>
            <span className="text-[11px] uppercase tracking-widest text-slate-400">{subhead}</span>
          </div>
        </div>

        {/* Final score. Single-game weekend, so the big numbers are
            the RUNS each side put up in the game (not a series
            win-tally). The 1-0/0-1 game-wins ledger is implicit in
            the headline already and would only echo "you won". */}
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
          <div className="text-center flex-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 block">You</span>
            <span className="text-4xl sm:text-5xl font-black text-white leading-none tabular-nums">{userRunsTotal}</span>
            <span className="text-[10px] uppercase tracking-widest text-slate-500 block mt-1">
              run{userRunsTotal === 1 ? "" : "s"}
            </span>
          </div>
          <span className="text-slate-600 text-2xl">·</span>
          <div className="text-center flex-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 block">{ghostLabel ?? "Opp"}</span>
            <span className="text-4xl sm:text-5xl font-black text-white leading-none tabular-nums">{ghostRunsTotal}</span>
            <span className="text-[10px] uppercase tracking-widest text-slate-500 block mt-1">
              run{ghostRunsTotal === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {/* "Why" tagline: turns the raw scoreline above into a
            decisive English sentence. Surfaces the run margin / shutout
            framing so the user reads the result, not just the digits.
            Outside of terminal runs only -- the champion / fired
            headlines are decisive enough on their own. */}
        {!endState && (
          <div className="mt-2 text-center">
            <span
              className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border ${
                userWonSeries
                  ? "bg-emerald-500/20 border-emerald-300/40 text-emerald-200"
                  : "bg-rose-500/20 border-rose-300/40 text-rose-200"
              }`}
            >
              {marginTag}
            </span>
          </div>
        )}

        {/* Run record after */}
        <div className="mt-3 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-300">
          <span>Run</span>
          <span className="text-emerald-300 font-bold tabular-nums">{newWins}W</span>
          <span className="text-slate-600">·</span>
          <span className="text-rose-300 font-bold tabular-nums">{newLosses}L</span>
        </div>

        {/* Cash delta + buff changes */}
        {showCashDelta && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 flex items-center gap-3">
            <Coins className="w-5 h-5 text-amber-300" aria-hidden />
            <div className="flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-xs uppercase tracking-widest text-amber-200/80">Cash</span>
              <span className="text-amber-200 tabular-nums font-bold">${cashBefore}</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-300/70" aria-hidden />
              <span className="text-amber-100 tabular-nums font-black text-lg">${cashAfter}</span>
              <span className="text-[10px] uppercase tracking-widest text-amber-300/70 ml-1">
                +${weeklyRefill} weekly
                {triggerBonus > 0 ? ` +$${triggerBonus} triggers` : ""}
              </span>
            </div>
          </div>
        )}

        {timerRows.length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 block mb-2">
              Buff Changes
            </span>
            <ul className="space-y-1.5 text-sm">
              {timerRows.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <span className="text-slate-200 flex-1">{row.label}</span>
                  <span className="text-slate-500 tabular-nums text-xs">{row.before}</span>
                  <ArrowRight className="w-3 h-3 text-slate-500" aria-hidden />
                  <span
                    className={`tabular-nums text-xs font-bold ${
                      row.expired ? "text-rose-300" : "text-emerald-300"
                    }`}
                  >
                    {row.after}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stillActive.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest text-slate-400">Still Active:</span>
            {stillActive.map((b) => (
              <span
                key={b.key}
                className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-widest text-white"
                style={{ backgroundColor: `${b.tint}cc`, borderColor: "rgba(255,255,255,0.4)" }}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={dismiss}
          className={`mt-6 w-full px-5 py-3 rounded-xl font-black uppercase tracking-widest text-sm border shadow-lg transition-colors ${
            userWonSeries
              ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-300/60"
              : "bg-purple-500 hover:bg-purple-400 text-slate-950 border-purple-300/60"
          }`}
        >
          {endState === "champion"
            ? "View the Trophy"
            : endState === "fired"
              ? "Pack Up the Office"
              : "Continue to Front Office"}
        </button>
      </motion.div>
    </motion.div>
  );
}
