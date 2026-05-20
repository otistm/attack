/**
 * FrontOfficeScreen — the Mon..Thu prep cadence in SZN Mode.
 *
 * Bazaar-style flow:
 *   - One to three big encounter cards in the center (varies by day)
 *   - Each pick refreshes the slate with new offers (same slot count that day)
 *   - When the user has spent that day's pick budget, the day
 *     auto-advances (no "Skip Remaining" button -- the budget IS the
 *     pacing tool)
 *   - The user's full roster is always visible as a strip at the
 *     bottom so decisions stay grounded in the actual lineup, not
 *     abstract memory
 *
 * Encounter colors:
 *   - Merchant      → amber/gold
 *   - Event         → purple
 *   - Player Market → cyan
 *
 * The "End Day" affordance is gone; the only way out is to actually
 * make picks. This is the central tension the run was designed for.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Telescope } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import {
  FRONT_OFFICE_DAYS,
  MERCHANT_BLURB,
  MERCHANT_LABEL,
  EVENT_BLURB,
  EVENT_GLYPH,
  EVENT_LABEL,
  dayPickBudget,
  type DayEncounters,
  type DayOfWeek,
  type EncounterOffer,
  type RunState,
  type WeeklyScoutingReport,
} from "../lib/run";
import { SCOUT_SLOTS } from "../lib/scouting";
import { MerchantView } from "./MerchantView";
import { EventEncounterView } from "./EventEncounterView";
import { PlayerMarketView } from "./PlayerMarketView";
import { DayTransitionSplash } from "./DayTransitionSplash";
import { useSznGamepad } from "../lib/useSznGamepad";
/**
 * Roll the live encounter buffs the user is carrying into a small
 * chip-style array the MondayScoutingReport can render verbatim. Mirrors
 * the `SznEncounterChips` shape in RunHud so the readouts match across
 * the two surfaces -- only the styling layer is per-host.
 */
function collectActiveBuffs(run: RunState): { key: string; label: string; tint: string }[] {
  const chips: { key: string; label: string; tint: string }[] = [];
  if (run.defenseShields > 0) {
    chips.push({ key: "shield", label: `🛡️ ×${run.defenseShields}`, tint: "#22d3ee" });
  }
  if (run.bangingSchemeWeeksLeft > 0) {
    chips.push({ key: "peek", label: `🔔 ${run.bangingSchemeWeeksLeft}w`, tint: "#fbbf24" });
  }
  if (run.karmaDoubleTriggers) {
    chips.push({ key: "karma", label: "✨ 2×", tint: "#c084fc" });
  }
  if (run.rallyFireWeeksLeft > 0) {
    chips.push({ key: "rally", label: `🔥 ${run.rallyFireWeeksLeft}w`, tint: "#ef4444" });
  }
  if (run.nextGameRosterBoost > 0) {
    chips.push({ key: "hold", label: `📈 +${run.nextGameRosterBoost}`, tint: "#10b981" });
  }
  if (run.mlbScoutingIntel) {
    chips.push({ key: "intel", label: "🔎 INTEL", tint: "#0ea5e9" });
  }
  return chips;
}

/**
 * Monday full-screen scouting intel — blocks encounters until dismissed.
 *
 * The report's slot list (worldLine / abilityLine / playerLine) is
 * NOT hand-coded here. It iterates the `SCOUT_SLOTS` registry from
 * `scouting.ts`, so adding a new slot is a single-file change in
 * `scouting.ts` (extend the interface + the registry + the
 * generator) and this renderer automatically picks it up.
 */
function MondayScoutingReport({
  scouting,
  onDismiss,
  activeBuffs,
  week,
}: {
  scouting: WeeklyScoutingReport;
  onDismiss: () => void;
  /**
   * Live encounter buffs the user is carrying into the new week. Shown
   * as a small "Active Buffs" footer so the Monday briefing doubles as
   * a "what's still cooking" check — supplements the chip strip in the
   * RunHud, which is easy to miss during the splash transition.
   */
  activeBuffs: { key: string; label: string; tint: string }[];
  /** Current week number, used in the report header subline. */
  week: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/90 backdrop-blur-md px-4 pointer-events-auto"
    >
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="w-full max-w-lg rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-slate-900 via-emerald-950/80 to-slate-950 p-6 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.75)]"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
            <Telescope className="w-6 h-6 text-emerald-300" aria-hidden />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-300/90 block">
              Monday Scouting Report
            </span>
            <h3 className="dugout-font-sport text-2xl sm:text-3xl uppercase tracking-wide text-white leading-tight">
              The Scout's Notebook · Week {week}
            </h3>
          </div>
        </div>

        {/* Registry-driven slot list. The order here is whatever
            order SCOUT_SLOTS exports -- which is the canonical
            slot order across the whole game. Each slot gets a
            tinted pill (label + glyph) and the body text from the
            corresponding key on the report object. Adding a slot
            is one entry in `scouting.ts`; this renderer needs no
            edits. */}
        <div className="space-y-4 text-sm sm:text-base text-slate-200 leading-snug border-t border-emerald-500/20 pt-4">
          {SCOUT_SLOTS.map((slot) => (
            <div key={slot.key} className="flex flex-col gap-1.5">
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-widest text-white self-start"
                style={{
                  backgroundColor: `${slot.tint}33`,
                  borderColor: `${slot.tint}cc`,
                  color: slot.tint,
                }}
              >
                <span aria-hidden>{slot.glyph}</span>
                {slot.label}
              </span>
              <p className="text-slate-100">{scouting[slot.key]}</p>
            </div>
          ))}
        </div>

        {activeBuffs.length > 0 && (
          <div className="mt-5 border-t border-emerald-500/20 pt-4">
            <span className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-300/80 block mb-2">
              Active Buffs
            </span>
            <div className="flex flex-wrap gap-1.5">
              {activeBuffs.map((b) => (
                <span
                  key={b.key}
                  className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-widest text-white"
                  style={{ backgroundColor: `${b.tint}cc`, borderColor: "rgba(255,255,255,0.4)" }}
                >
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="mt-6 w-full px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-widest text-sm border border-emerald-300/50 shadow-lg transition-colors"
        >
          Got it — open the Front Office
        </button>
      </motion.div>
    </motion.div>
  );
}

export function FrontOfficeScreen() {
  const run = useGameStore((s) => s.run);
  const commitEncounter = useGameStore((s) => s.commitEncounter);
  const advanceDay = useGameStore((s) => s.advanceDay);
  const acknowledgeWeekScouting = useGameStore((s) => s.acknowledgeWeekScouting);
  // Live SZN footer height so the bottom of the encounter grid clears
  // the always-on deck. Bumped by 1.5rem of breathing room (the
  // legacy `+ 5rem` reserved space for an extra "Roster" button that
  // no longer exists — the footer IS the roster surface now).
  const sznFooterHeight = useGameStore((s) => s.sznFooterHeight);
  // Unified gamepad focus surface — `'screen'` when this grid owns
  // input, `'footer'` when the persistent SZN deck row at the bottom
  // does. We use it to gate the per-tile `focused` prop so the
  // currently focused encounter tile collapses back to its rest
  // scale the moment focus crosses over to the footer (otherwise
  // `focusIdx` here keeps the last-focused tile visually expanded
  // even though the cursor is no longer on it).
  const sznGamepadFocus = useGameStore((s) => s.sznGamepadFocus);
  const screenOwnsFocus = sznGamepadFocus === "screen";
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  // Controller cursor over the encounter grid. Only meaningful when
  // no slot modal is open — the modal owns input above us via the
  // priority-100 binding inside `SlotModal`. The cursor STAYS at its
  // last position even when focus transfers to the footer so that
  // returning with `DPAD_UP` lands the player on the same tile they
  // left; visual focus is gated separately on `screenOwnsFocus`.
  const [focusIdx, setFocusIdx] = useState(0);

  // Closing the encounter modal ALWAYS spends the day's pick, even if
  // the user walked away without buying / signing / resolving anything.
  // Per the run-loop design, opening a slot IS the choice -- the other
  // open slots disappear from the slate the moment the user commits to
  // one, so window-shopping the whole row on the same pick budget isn't
  // allowed. `commitEncounter` already handles idempotency + day
  // auto-advance internally.
  const closeEncounter = () => {
    commitEncounter();
    setOpenSlot(null);
  };

  const dayKey = run && run.day !== "series" ? (run.day as DayOfWeek) : null;
  const dayIdx = dayKey ? FRONT_OFFICE_DAYS.indexOf(dayKey) : -1;
  const today = dayKey ? run!.weekEncounters[dayIdx] ?? null : null;
  const offersLen = today?.offers.length ?? 0;
  const showMondayScouting =
    dayKey === "mon" &&
    !!run?.weeklyScout &&
    !run.weekScoutingAcknowledged;

  // Clamp the focused encounter when the slate refreshes (commit
  // shrinks the list, fresh day repopulates it). Without this guard
  // the focus ring could point at a removed offer index.
  useEffect(() => {
    if (focusIdx >= offersLen && offersLen > 0) setFocusIdx(0);
  }, [offersLen, focusIdx]);

  // Safety net for the "endless encounter loop" bug. If a day enters
  // with picksUsed already at or beyond its effective budget (e.g., a
  // persisted run rolled pickBudget=3 under the old cap and the new
  // MAX_PICKS_PER_DAY clamped the budget down to 2 mid-run; or any
  // future state-sync hiccup leaves picksUsed inflated), auto-advance
  // the calendar so the player isn't stuck staring at refreshed
  // encounters that no commit will ever consume. Only fires outside an
  // open slot modal and outside the Monday scouting toast so we don't
  // yank state out from under a flow the user is mid-input on.
  useEffect(() => {
    if (!run || run.day === "series") return;
    if (openSlot !== null) return;
    if (showMondayScouting) return;
    if (!today) return;
    const budget = dayPickBudget(today);
    if (today.picksUsed >= budget) {
      advanceDay();
    }
  }, [run, openSlot, showMondayScouting, today, advanceDay]);

  // Encounter-grid controller binding. Suppressed while a slot modal
  // OR the Monday scouting toast is open — both register their own
  // higher-priority bindings, and we'd otherwise also fire CROSS on
  // the encounter under the modal.
  useSznGamepad({
    id: "front-office-screen",
    priority: 20,
    enabled:
      run !== null &&
      run.day !== "series" &&
      openSlot === null &&
      !showMondayScouting,
    handler: (btn) => {
      if (!today) return;
      if (btn === "DPAD_LEFT") {
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (btn === "DPAD_RIGHT") {
        setFocusIdx((i) => Math.min(offersLen - 1, i + 1));
      } else if (btn === "DPAD_UP") {
        // Multi-row grids on lg+ wrap on a 3-col layout; for the
        // dominant ≤sm 1-col layout UP/DOWN behaves like LEFT/RIGHT
        // so the cursor still cycles linearly.
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (btn === "DPAD_DOWN") {
        setFocusIdx((i) => Math.min(offersLen - 1, i + 1));
      } else if (btn === "CROSS") {
        if (offersLen > 0) setOpenSlot(focusIdx);
      }
    },
  });

  // Monday-scouting toast handler. TRIANGLE dismisses (same as the
  // "Got it" button) so the user can clear the report without
  // chasing the on-screen CTA.
  useSznGamepad({
    id: "front-office-monday-scouting",
    priority: 60,
    enabled: showMondayScouting,
    handler: (btn) => {
      if (btn === "TRIANGLE" || btn === "CROSS" || btn === "CIRCLE") {
        acknowledgeWeekScouting();
      }
    },
  });

  if (!run || !dayKey || !today) return null;

  const pickBudget = dayPickBudget(today);
  const encounterGridClass =
    pickBudget <= 1
      ? "grid grid-cols-1 gap-4 mb-2 max-w-lg mx-auto w-full"
      : pickBudget === 2
        ? "grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2"
        : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-2";

  return (
    <motion.div
      key="front-office-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // pointer-events-auto so descendant SlotModal keeps its click
      // handlers (CSS `pointer-events: none` cascades to descendants
      // and silently breaks every overlay button if set on this
      // outer container). Bottom padding reserves room for the
      // always-on `SznFooterDecks` (live height) plus 1.5rem of
      // breathing room. The legacy `+ 5rem` reserved space for the
      // dedicated Roster button that no longer exists — the footer
      // itself surfaces the roster + sell tray + synergy strip now.
      style={{
        paddingBottom: `calc(${sznFooterHeight}px + 1.5rem)`,
      }}
      className="absolute inset-0 z-30 flex flex-col px-4 pt-16 dugout-font-base text-white pointer-events-auto overflow-hidden"
    >
      <AnimatePresence>
        {showMondayScouting && run.weeklyScout ? (
          <MondayScoutingReport
            key="mon-scouting"
            scouting={run.weeklyScout}
            onDismiss={acknowledgeWeekScouting}
            activeBuffs={collectActiveBuffs(run)}
            week={run.week}
          />
        ) : null}
      </AnimatePresence>

      {/* Day transition splash -- mounts unconditionally and watches
          `run.day` internally. Fires Monday once the scouting report
          is dismissed and on every advanceDay() flip for the rest
          of the week. Sits at z-58 so it paints above the encounter
          grid but defers to the Monday scouting modal (z-55 is
          inside that flow before the splash arms). */}
      <DayTransitionSplash />


      <div className="max-w-6xl mx-auto w-full flex flex-col gap-5 flex-1 min-h-0">
        <DayBreadcrumb
          activeDayIdx={dayIdx}
          weekEncounters={run.weekEncounters}
        />

        {/* Day header removed — the "Front Office · {day}" context now
            lives in the `RunHud` strip alongside week / W-L / cash so
            the screen leads directly into the encounter slate without
            burning vertical real estate on a hero title. */}

        {/* Encounter slate. Re-renders with a fresh key when picksUsed
            changes so the new offers fly in like a real Bazaar refresh.
            The `flex-1` wrapper soaks up the remaining vertical space
            between the day breadcrumb and the deck footer and centers
            the grid inside it, so the tiles sit in the visual middle
            of the screen rather than hugging the breadcrumb.
            -----------------------------------------------------------
            When a slot opens (`openSlot !== null`), the SAME slot in
            the layout switches to render the chosen encounter view
            (Merchant / Player Market / Event) inline. There is no
            full-screen dimmed/blurred backdrop — the footer rail and
            HUD stay fully visible and interactive so the user can
            still consult their roster + buffs while picking an
            encounter outcome. AnimatePresence `mode="wait"` glues
            the grid → view (and view → grid) crossfade so the
            transition feels intentional. */}
        <div className="flex-1 min-h-0 flex items-center justify-center w-full -translate-y-[100px]">
          <AnimatePresence mode="wait">
            {openSlot !== null ? (
              <motion.div
                key={`slot-${openSlot}`}
                initial={{ opacity: 0, scale: 0.94, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -10 }}
                transition={{
                  type: "spring",
                  stiffness: 280,
                  damping: 24,
                }}
                // The parent flex container applies a global
                // `-translate-y-[100px]` so the tile grid sits in the
                // optical center of the screen (above the heavy SZN
                // footer rail). The encounter panel is taller than a
                // tile so we partially cancel that lift with a
                // 70px down-shift -- net result: the encounter
                // panel sits ~30px above true center, which reads as
                // "right above the footer" instead of "floating high
                // in the upper third".
                className="w-full max-w-3xl translate-y-[70px]"
              >
                <SlotPanel slotIndex={openSlot} onClose={closeEncounter} />
              </motion.div>
            ) : (
              <motion.div
                key={`offers-${today.picksUsed}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.32 }}
                className={encounterGridClass}
              >
                {today.offers.map((offer, idx) => (
                  <EncounterCard
                    key={`offer-${today.picksUsed}-${idx}`}
                    offer={offer}
                    index={idx}
                    // `focused` flips off as soon as the gamepad cursor
                    // moves into the footer band — that's what shrinks
                    // the previously focused tile back to its rest size.
                    focused={screenOwnsFocus && focusIdx === idx}
                    // Click opens the slot AND syncs focus to it, so
                    // after the modal closes the gamepad cursor lands on
                    // the slot the user just dismissed (instead of
                    // whatever they were on before clicking with the
                    // mouse). Mouse hover no longer touches `focusIdx`
                    // — see the `EncounterCard` body for why.
                    onOpen={() => {
                      setFocusIdx(idx);
                      setOpenSlot(idx);
                    }}
                    onHover={() => setFocusIdx(idx)}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------------------
 * Day breadcrumb
 *
 * Five-node horizontal trail spanning the full week:
 *   Mon - Tue - Wed - Thu - Game of the Week
 *
 * The first four are tiny dot nodes (the front-office days); the
 * weekend replaces the dot with a "GAME OF THE WEEK" pill so the user
 * can see at a glance "I'm Wednesday, the game is still ahead". The
 * week now culminates in a single Friday game (no more best-of-3), so
 * the trail terminates on one pill instead of three. Active state pulses amber; past nodes
 * /segments fill emerald; future nodes/segments stay dim slate so the
 * trail reads as progression-along-a-path.
 *
 * Active-index semantics:
 *   0..3  -> the corresponding front-office day (Mon..Thu)
 *   4     -> Friday game day (the series)
 *   -1    -> nothing active (e.g., between weeks)
 * --------------------------------------------------------------------------- */

interface BreadcrumbNode {
  key: string;
  /** Front-office days render a small dot; game nodes render a pill label. */
  kind: "day" | "game";
  /** Display label under the dot (e.g. "Mon") or inside the pill ("Game of the Week"). */
  label: string;
}

const BREADCRUMB_NODES: BreadcrumbNode[] = [
  { key: "mon", kind: "day", label: "Mon" },
  { key: "tue", kind: "day", label: "Tue" },
  { key: "wed", kind: "day", label: "Wed" },
  { key: "thu", kind: "day", label: "Thu" },
  { key: "friday", kind: "game", label: "Game of the Week" },
];

function DayBreadcrumb({
  activeDayIdx,
  weekEncounters,
}: {
  activeDayIdx: number;
  weekEncounters: DayEncounters[];
}) {
  return (
    <div className="flex items-center justify-center w-full max-w-3xl mx-auto pt-1 pb-2">
      {BREADCRUMB_NODES.map((node, i) => {
        const isActive = i === activeDayIdx;
        const isPast = i < activeDayIdx;
        const segmentDone = i < activeDayIdx;
        // Per-day pick progress. Only meaningful for Mon..Thu dots
        // (game pill has its own visual). Defensive against partial
        // saves: clamp through `dayPickBudget` and fall back to a
        // 1-pip default if the entry is missing entirely.
        const dayState = node.kind === "day" ? weekEncounters[i] : undefined;
        const dayBudget = dayState ? dayPickBudget(dayState) : 1;
        const dayUsed = dayState
          ? Math.min(dayState.picksUsed ?? 0, dayBudget)
          : 0;
        // Game pills get a wider min-width so the labels don't crowd
        // the dot nodes; day dots stay compact. "Game of the Week" is
        // the longest label, so the game column needs ~140px to seat
        // the pill without overlapping the connecting line.
        const colMinWidth = node.kind === "game" ? "min-w-[140px]" : "min-w-[56px]";
        return (
          <div
            key={node.key}
            className="flex items-center flex-1 last:flex-initial"
          >
            {/* Node */}
            <div className={`flex flex-col items-center ${colMinWidth}`}>
              {node.kind === "day" ? (
                <>
                  {/* Front-office dot */}
                  <div
                    className={`relative w-4 h-4 rounded-full border-2 transition-all ${
                      isActive
                        ? "bg-amber-300 border-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.85)] scale-125"
                        : isPast
                          ? "bg-emerald-500 border-emerald-300"
                          : "bg-slate-800 border-slate-600"
                    }`}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute -inset-1 rounded-full border-2 border-amber-200/60 animate-pulse"
                      />
                    )}
                  </div>
                  <span
                    className={`text-[10px] mt-1 uppercase tracking-[0.3em] font-black transition-colors ${
                      isActive
                        ? "text-amber-100"
                        : isPast
                          ? "text-emerald-200"
                          : "text-slate-500"
                    }`}
                    style={{
                      textShadow: isActive
                        ? "0 1px 4px rgba(0,0,0,0.7)"
                        : undefined,
                    }}
                  >
                    {node.label}
                  </span>
                  {/* Pick-budget pip row. Tells the player at a glance
                      "how many encounters does this day take" and how
                      many they've already spent — past days fill all
                      pips emerald, the active day fills `picksUsed`
                      pips amber + leaves the rest hollow, future days
                      stay slate so the user can read the week's
                      cadence (e.g. "Mon ●, Tue ●●, Wed ●") without
                      hunting the cap in the HUD. Solves the playtest
                      complaint that the Front Office "loops forever"
                      because there was no visible budget indicator. */}
                  <span
                    aria-hidden
                    className="inline-flex items-center gap-0.5 mt-1"
                  >
                    {Array.from({ length: dayBudget }, (_, p) => {
                      const filled = isPast || (isActive && p < dayUsed);
                      const pipClass = isPast
                        ? "bg-emerald-400"
                        : isActive
                          ? filled
                            ? "bg-amber-300"
                            : "bg-amber-200/20 border border-amber-200/60"
                          : "bg-slate-700/80 border border-slate-600";
                      return (
                        <span
                          key={p}
                          className={`w-1.5 h-1.5 rounded-full ${pipClass}`}
                        />
                      );
                    })}
                  </span>
                </>
              ) : (
                <>
                  {/* Game pill -- replaces the dot entirely so the
                      weekend nodes read as their own thing on the
                      trail rather than "more dots that happen to say
                      Game". The pill itself is the node, and there's
                      no day-abbrev text below it. We add a stub
                      spacer the same height as the day-dot's label
                      row so the dots and pills stay vertically
                      aligned along the connecting line. */}
                  <div
                    className={`relative px-2.5 py-0.5 rounded-full border-2 text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
                      isActive
                        ? "bg-amber-300 border-amber-200 text-slate-900 shadow-[0_0_14px_rgba(251,191,36,0.85)] scale-105"
                        : isPast
                          ? "bg-emerald-500 border-emerald-300 text-emerald-950"
                          : "bg-slate-800 border-slate-600 text-slate-400"
                    }`}
                    style={{
                      textShadow: isActive
                        ? "0 1px 2px rgba(255,255,255,0.4)"
                        : undefined,
                    }}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute -inset-1 rounded-full border-2 border-amber-200/60 animate-pulse pointer-events-none"
                      />
                    )}
                    {node.label}
                  </div>
                  {/* Invisible label spacer so the pill row stays at
                      the same Y as the dot row (the dot has a label
                      below it; without this spacer the connecting
                      line would zig-zag between dots and pills). */}
                  <span aria-hidden className="text-[10px] mt-1 leading-none invisible">
                    —
                  </span>
                  {/* Matching invisible pip-row spacer. Day dots paint
                      a real pip row under the label so the pill column
                      needs the same vertical block here, otherwise the
                      pill sits ~6px higher than the day labels and the
                      breadcrumb connecting line zig-zags up at the
                      Game-of-the-Week node. */}
                  <span
                    aria-hidden
                    className="inline-flex items-center gap-0.5 mt-1 invisible"
                  >
                    <span className="w-1.5 h-1.5 rounded-full" />
                  </span>
                </>
              )}
            </div>
            {/* Connecting segment (omit after the last node) */}
            {i < BREADCRUMB_NODES.length - 1 && (
              <div className="flex-1 h-0.5 mx-1 -mt-4 relative overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  initial={false}
                  animate={{ width: segmentDone ? "100%" : "0%" }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 bg-emerald-400"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Encounter card
 *
 * Colors per kind:
 *   merchant      -> amber gradient
 *   event         -> purple gradient
 *   playerMarket  -> cyan gradient
 *
 * Each card has a big glyph + name + blurb so the encounter type reads
 * even from the back of the room.
 * --------------------------------------------------------------------------- */

interface EncounterStyle {
  kindLabel: string;
  title: string;
  blurb: string;
  glyph: string;
  gradient: string;
  ring: string;
  accent: string;
  textTint: string;
}

function styleForOffer(offer: EncounterOffer): EncounterStyle {
  switch (offer.kind) {
    case "merchant":
      return {
        // Themed merchant encounters (Hobby Shop, Clearance Bin) ship
        // optional `display*` overrides that take precedence over the
        // base persona's MERCHANT_LABEL / MERCHANT_BLURB / persona
        // glyph. Falls back to the persona defaults when an offer is
        // a plain merchant roll (legacy 35%-chance Scouting Director
        // / Shady Trainer etc.) so the existing rolls keep their
        // identity.
        kindLabel: "Merchant",
        title: offer.displayLabel ?? MERCHANT_LABEL[offer.merchantId],
        blurb: offer.displayBlurb ?? MERCHANT_BLURB[offer.merchantId],
        glyph: offer.displayGlyph ?? merchantGlyph(offer.merchantId),
        gradient: "from-amber-700 via-amber-900 to-slate-950",
        ring: "ring-amber-400/60 hover:ring-amber-300",
        accent: "text-amber-200",
        textTint: "text-amber-100",
      };
    case "event":
      return {
        kindLabel: "Event",
        // Falls back to a humanized eventId if the spec registry is
        // missing an entry (defensive against a brand-new encounter
        // being added without a matching label/blurb).
        title: EVENT_LABEL[offer.eventId] ?? humanizeEventId(offer.eventId),
        blurb: EVENT_BLURB[offer.eventId] ?? "Something is happening in the front office.",
        glyph: EVENT_GLYPH[offer.eventId] ?? "✨",
        gradient: "from-purple-700 via-purple-950 to-slate-950",
        ring: "ring-purple-400/60 hover:ring-purple-300",
        accent: "text-purple-200",
        textTint: "text-purple-100",
      };
    case "playerMarket":
      return {
        kindLabel: "Player Market",
        title: offer.label,
        blurb: offer.blurb,
        glyph: "🪪",
        gradient: "from-cyan-700 via-cyan-950 to-slate-950",
        ring: "ring-cyan-400/60 hover:ring-cyan-300",
        accent: "text-cyan-200",
        textTint: "text-cyan-100",
      };
  }
}

function merchantGlyph(id: string): string {
  switch (id) {
    case "scouting_director":
      return "🔭";
    case "shady_trainer":
      return "💉";
    case "equipment_manager":
      return "⚾";
    case "concessions":
      return "🌭";
    default:
      return "🛒";
  }
}

/** Fallback: convert `enc-some-encounter-id` into "Some Encounter Id". */
function humanizeEventId(id: string): string {
  return id
    .replace(/^enc-/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function EncounterCard({
  offer,
  index,
  focused,
  onOpen,
  onHover,
}: {
  offer: EncounterOffer;
  index: number;
  focused: boolean;
  onOpen: () => void;
  onHover: () => void;
}) {
  const style = styleForOffer(offer);
  return (
    <motion.button
      type="button"
      // Rest-state scale is small (`0.88`); the focused tile pops up
      // to `1.04` so the cursor is unmistakable.
      //
      // Mouse hover used to call `onHover` (which sets `focusIdx` in
      // the parent), which left tiles stuck at the focused scale
      // after the mouse left — there was no `onMouseLeave` to
      // undo the focus sync. We now decouple mouse hover from focus
      // state: mouse hover scales up via Framer's `whileHover`
      // (which auto-reverts to the `animate` target on mouse leave),
      // and `focused` (driven by `focusIdx`) stays gamepad / keyboard
      // owned. A mouse click still syncs focus via `onOpen` in the
      // parent so the gamepad picks up where the mouse left off when
      // the slot modal closes.
      initial={{ y: 16, opacity: 0, scale: 0.88 }}
      animate={{
        y: 0,
        opacity: 1,
        scale: focused ? 1.04 : 0.88,
      }}
      // Entry stagger only on opacity / y so a focus-change later
      // doesn't replay the per-tile delay. The top-level spring
      // (used by `scale`) snaps without any wait so navigating
      // between tiles feels responsive — and shrinks the previously
      // focused tile back to `0.88` the moment `focusIdx` moves on.
      transition={{
        type: "spring",
        stiffness: 280,
        damping: 24,
        opacity: { delay: index * 0.07, duration: 0.32 },
        y: {
          delay: index * 0.07,
          type: "spring",
          stiffness: 240,
          damping: 22,
        },
      }}
      whileHover={{ scale: 1.04, y: -8 }}
      whileTap={{ scale: 0.95 }}
      onClick={onOpen}
      onFocus={onHover}
      className={`relative rounded-2xl bg-gradient-to-br ${style.gradient} ring-2 ${
        focused ? "ring-amber-400/90 shadow-[0_0_28px_rgba(251,191,36,0.45)]" : style.ring
      } p-5 text-left flex flex-col gap-3 min-h-[200px] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.6)] overflow-hidden transition-shadow hover:shadow-[0_30px_60px_-10px_rgba(0,0,0,0.8)]`}
    >
      {/* Big glyph backdrop -- low-opacity decorative anchor that
          gives the card a personality silhouette before the user
          even reads the title. */}
      <div
        aria-hidden
        className="absolute -bottom-6 -right-4 text-[140px] opacity-10 select-none pointer-events-none leading-none"
      >
        {style.glyph}
      </div>

      <div className="relative z-10 flex items-center gap-3">
        <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-slate-950/60 border-2 border-white/15 text-2xl shadow-inner">
          {style.glyph}
        </div>
        <span
          className={`text-[10px] font-black uppercase tracking-[0.35em] ${style.accent}`}
        >
          {style.kindLabel}
        </span>
      </div>

      <h3
        className="dugout-font-sport text-2xl sm:text-3xl uppercase leading-tight tracking-wider text-white relative z-10"
        style={{ textShadow: "0 2px 8px rgba(0,0,0,0.7)" }}
      >
        {style.title}
      </h3>

      <p
        className={`text-sm leading-snug flex-1 ${style.textTint}`}
        style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
      >
        {style.blurb}
      </p>
    </motion.button>
  );
}

/* ---------------------------------------------------------------------------
 * Slot panel
 *
 * The opened encounter renders inline inside the FrontOfficeScreen's
 * central area -- the SAME slot where the encounter tile grid sits when
 * no slot is open. No full-screen dimmed/blurred backdrop, no `fixed
 * inset-0` shell: the footer rail and HUD stay fully visible so the
 * user can keep glancing at their roster / active buffs while making
 * the encounter pick. Crossfade between the tile grid and this panel
 * is owned by the parent's `AnimatePresence`.
 *
 * Closing the encounter is gated on the explicit "Leave" button (mouse)
 * or CIRCLE on the gamepad -- we deliberately drop the previous
 * "click backdrop to close" affordance because there is no backdrop
 * anymore to click. The CIRCLE binding here is intentionally lower
 * priority than the inner encounter view's keymap so the encounter's
 * own DPAD nav + CROSS activation still wins.
 *
 * The offer is snapshotted once on mount so a mid-encounter slate
 * refresh (commitEncounter rolls fresh offers when the day advances)
 * doesn't yank the data out from underneath the user.
 * --------------------------------------------------------------------------- */

function SlotPanel({
  slotIndex,
  onClose,
}: {
  slotIndex: number;
  onClose: () => void;
}) {
  const run = useGameStore((s) => s.run);
  // Snapshot the offer at mount so the panel stays stable even after
  // the underlying slate refreshes mid-interaction.
  const [snapshot] = useState<EncounterOffer | null>(() => {
    if (!run || run.day === "series") return null;
    const dayKey = run.day as DayOfWeek;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
    return run.weekEncounters[dayIdx]?.offers[slotIndex] ?? null;
  });
  // Shell-level controller binding. The inner encounter view (Merchant
  // / PlayerMarket / Event) registers its own higher-priority binding
  // for grid navigation + CROSS activation. We only handle CIRCLE here
  // so escape-out works regardless of which encounter is loaded.
  useSznGamepad({
    id: "slot-panel-shell",
    priority: 90,
    enabled: snapshot !== null,
    handler: (btn) => {
      if (btn === "CIRCLE") onClose();
    },
  });
  if (!snapshot) return null;
  if (snapshot.kind === "merchant") {
    return (
      <MerchantView slotIndex={slotIndex} offer={snapshot} onClose={onClose} />
    );
  }
  if (snapshot.kind === "playerMarket") {
    return (
      <PlayerMarketView
        slotIndex={slotIndex}
        offer={snapshot}
        onClose={onClose}
      />
    );
  }
  return (
    <EventEncounterView
      slotIndex={slotIndex}
      offer={snapshot}
      onClose={onClose}
    />
  );
}
