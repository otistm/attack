/**
 * Post-combat win/lose screen with optional battle breakdown.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { BrawlCombatReport } from "../../lib/brawlCombatLog";
import {
  aggregateCardBreakdown,
  formatCardBreakdownSummary,
  type BrawlCardBreakdown,
  type BrawlEnvironmentalBreakdown,
} from "../../lib/brawlCombatLog";
import { ELEMENT_LABEL } from "../../lib/brawlElements";
import type { Element } from "../../lib/brawlElements";
import type { BrawlClass } from "../../lib/elementClassPools";
import { classTipForReport } from "../../lib/classCombatTraits";

export interface BrawlBattleResultScreenProps {
  report: BrawlCombatReport;
  phase: "between-at-bats" | "game-over";
  onContinue: () => void;
  brawlUserClass?: BrawlClass | null;
}

type ResultView = "menu" | "breakdown";

const ELEMENT_CHIP: Record<Element, string> = {
  fire: "bg-orange-500/20 text-orange-100 ring-orange-400/40",
  poison: "bg-lime-500/20 text-lime-100 ring-lime-400/40",
  freeze: "bg-sky-500/20 text-sky-100 ring-sky-400/40",
  shield: "bg-slate-400/20 text-slate-100 ring-slate-300/40",
  heal: "bg-emerald-500/20 text-emerald-100 ring-emerald-400/40",
  volt: "bg-amber-500/20 text-amber-100 ring-amber-400/40",
};

function CardBreakdownRow({ row }: { row: BrawlCardBreakdown }) {
  const elementChip =
    row.element != null
      ? ELEMENT_CHIP[row.element]
      : "bg-white/10 text-white/80 ring-white/20";

  return (
    <li className="rounded-lg bg-black/25 px-3 py-2.5 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">
              {row.cardName}
            </span>
            {row.element && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${elementChip}`}
              >
                {ELEMENT_LABEL[row.element]}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/70">
            {formatCardBreakdownSummary(row)}
          </p>
        </div>
        {row.totalHpDamage > 0 && (
          <span className="shrink-0 text-sm font-bold tabular-nums text-rose-300">
            −{row.totalHpDamage}
          </span>
        )}
      </div>
    </li>
  );
}

function EnvironmentalRow({ row }: { row: BrawlEnvironmentalBreakdown }) {
  const chipClass =
    row.kind === "sandstorm"
      ? "bg-orange-500/20 text-orange-100 ring-orange-400/30"
      : "bg-amber-500/20 text-amber-100 ring-amber-400/30";

  return (
    <li className="rounded-lg bg-black/20 px-3 py-2.5 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${chipClass}`}
          >
            {row.label}
          </span>
          <p className="mt-1 text-xs leading-relaxed text-white/65">
            {row.detail}
          </p>
        </div>
        {row.totalDamage > 0 && (
          <span className="shrink-0 text-sm font-bold tabular-nums text-rose-300">
            −{row.totalDamage}
          </span>
        )}
      </div>
    </li>
  );
}

function BreakdownPanel({ report }: { report: BrawlCombatReport }) {
  const { cards, environmental } = aggregateCardBreakdown(
    report.events,
    report.sandstormTicks,
  );
  const yourCards = cards.filter((c) => c.actorSide === "user");
  const theirCards = cards.filter((c) => c.actorSide === "opponent");
  const isEmpty =
    yourCards.length === 0 && theirCards.length === 0 && environmental.length === 0;

  return (
    <div
      className="mx-4 mb-4 mt-3 max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain rounded-xl bg-black/20 px-1 py-1 ring-1 ring-white/10 touch-pan-y"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {isEmpty ? (
        <p className="px-3 py-6 text-center text-sm text-white/50">
          No card activity recorded.
        </p>
      ) : (
        <div className="space-y-4 px-2 py-2">
          {yourCards.length > 0 && (
            <section>
              <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300/70">
                Your cards
              </h3>
              <ul className="space-y-2">
                {yourCards.map((row) => (
                  <CardBreakdownRow key={`user-${row.catalogId}`} row={row} />
                ))}
              </ul>
            </section>
          )}
          {theirCards.length > 0 && (
            <section>
              <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-rose-300/70">
                Opponent cards
              </h3>
              <ul className="space-y-2">
                {theirCards.map((row) => (
                  <CardBreakdownRow
                    key={`opp-${row.catalogId}`}
                    row={row}
                  />
                ))}
              </ul>
            </section>
          )}
          {environmental.length > 0 && (
            <section>
              <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-white/40">
                Other effects
              </h3>
              <ul className="space-y-2">
                {environmental.map((row) => (
                  <EnvironmentalRow key={row.kind} row={row} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export function BrawlBattleResultScreen({
  report,
  phase,
  onContinue,
  brawlUserClass = null,
}: BrawlBattleResultScreenProps) {
  const [view, setView] = useState<ResultView>("menu");
  const classTip = classTipForReport(brawlUserClass, report);

  useEffect(() => {
    setView("menu");
  }, [report]);

  const playAgainClass =
    phase === "game-over"
      ? "bg-rose-500 text-rose-950 hover:bg-rose-400"
      : "bg-emerald-500 text-emerald-950 hover:bg-emerald-400";

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Post-battle actions"
    >
      <motion.div
        className={`pointer-events-auto w-full overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900/95 to-slate-950/98 shadow-2xl ring-1 ring-white/20 backdrop-blur-md ${
          view === "menu" ? "max-w-xs" : "max-w-lg"
        }`}
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {view === "menu" ? (
            <motion.div
              key="menu"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-2 px-4 py-4"
            >
              <button
                type="button"
                onClick={() => setView("breakdown")}
                className="w-full rounded-xl bg-white/10 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-white/15 active:scale-[0.98]"
              >
                View battle report
              </button>
              <button
                type="button"
                onClick={onContinue}
                className={`w-full rounded-xl px-4 py-3.5 text-sm font-bold uppercase tracking-wide transition active:scale-[0.98] ${playAgainClass}`}
              >
                Play again
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="breakdown"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col"
            >
              <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white/80 transition hover:bg-white/15"
                  aria-label="Back to menu"
                >
                  Back
                </button>
                <h2 className="min-w-0 flex-1 text-center text-sm font-bold uppercase tracking-wide text-white/70">
                  Battle report
                </h2>
                <div className="w-[52px] shrink-0" aria-hidden />
              </header>

              {classTip ? (
                <p className="mx-4 mt-3 text-xs leading-relaxed text-center text-violet-200/90">
                  {classTip}
                </p>
              ) : null}

              <BreakdownPanel report={report} />

              <footer className="border-t border-white/10 px-4 py-3">
                <button
                  type="button"
                  onClick={onContinue}
                  className={`w-full rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wide transition active:scale-[0.98] ${playAgainClass}`}
                >
                  Play again
                </button>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
