/**
 * FrontOfficeScreen — the Mon..Thu prep cadence in SZN Mode.
 *
 * Bazaar-style flow:
 *   - Three big, vivid encounter cards in the center
 *   - Each pick refreshes the slate with three new offers
 *   - When the user has spent all `MAX_PICKS_PER_DAY` picks, the day
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

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Briefcase, Telescope } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import {
  FRONT_OFFICE_DAYS,
  MERCHANT_BLURB,
  MERCHANT_LABEL,
  EVENT_BLURB,
  EVENT_LABEL,
  type DayOfWeek,
  type EncounterOffer,
  type WeekendScouting,
} from "../lib/run";
import { MerchantView } from "./MerchantView";
import { EventEncounterView } from "./EventEncounterView";
import { PlayerMarketView } from "./PlayerMarketView";
import { RosterDrawer } from "./RosterDrawer";
import { PlayerCard } from "./PlayerCard";

const DAY_DISPLAY: Record<DayOfWeek, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
};

/** Monday full-screen scouting intel — blocks encounters until dismissed. */
function MondayScoutingReport({
  scouting,
  onDismiss,
}: {
  scouting: WeekendScouting;
  onDismiss: () => void;
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
              Weekend Series Intel
            </h3>
          </div>
        </div>

        <div className="space-y-3 text-sm sm:text-base text-slate-200 leading-snug border-t border-emerald-500/20 pt-4">
          <p className="font-semibold text-white">{scouting.opponentLine}</p>
          <p>{scouting.pitcherLine}</p>
          <p>{scouting.synergyLine}</p>
        </div>

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
  const acknowledgeWeekScouting = useGameStore((s) => s.acknowledgeWeekScouting);
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Closing the encounter modal ALWAYS spends the day's pick, even if
  // the user walked away without buying / signing / resolving anything.
  // Per the run-loop design, opening a slot IS the choice -- the other
  // two slots disappear from the slate the moment the user commits to
  // one, so window-shopping all three on the same pick budget isn't
  // allowed. `commitEncounter` already handles idempotency + day
  // auto-advance internally.
  const closeEncounter = () => {
    commitEncounter();
    setOpenSlot(null);
  };

  if (!run || run.day === "series") return null;
  const dayKey = run.day as DayOfWeek;
  const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
  const today = run.weekEncounters[dayIdx];
  if (!today) return null;

  const showMondayScouting =
    dayKey === "mon" &&
    run.weekendScouting !== null &&
    !run.weekScoutingAcknowledged;

  return (
    <motion.div
      key="front-office-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // pointer-events-auto so descendant SlotModal / RosterDrawer keep
      // their click handlers (CSS `pointer-events: none` cascades to
      // descendants and silently breaks every overlay button if set on
      // this outer container).
      // We pad the bottom by enough room for the persistent roster
      // dock (h-80) so the encounter grid never tucks under it.
      className="absolute inset-0 z-30 flex flex-col px-4 pt-16 pb-80 dugout-font-base text-white pointer-events-auto overflow-hidden"
    >
      <AnimatePresence>
        {showMondayScouting && run.weekendScouting ? (
          <MondayScoutingReport
            key="mon-scouting"
            scouting={run.weekendScouting}
            onDismiss={acknowledgeWeekScouting}
          />
        ) : null}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto w-full flex flex-col gap-5 flex-1 min-h-0">
        <DayBreadcrumb activeDayIdx={dayIdx} />

        {/* Day header — same 3D white + black stack + shine as the start
            screen "DUGOUT" logo (`dugout-title-3d` / `dugout-title-shine`).
            `data-text` drives the clipping gradient on the shine overlay. */}
        <div className="text-center">
          <h2
            data-text={`Front Office · ${DAY_DISPLAY[dayKey]}`}
            className="relative dugout-font-title dugout-title-3d dugout-title-shine text-3xl sm:text-5xl md:text-6xl uppercase tracking-wider m-0 leading-none text-white select-none"
          >
            Front Office · {DAY_DISPLAY[dayKey]}
          </h2>
        </div>

        {/* Encounter slate. Re-renders with a fresh key when picksUsed
            changes so the new offers fly in like a real Bazaar refresh. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`offers-${today.picksUsed}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.32 }}
            className="grid grid-cols-3 gap-4 mb-2"
          >
            {today.offers.map((offer, idx) => (
              <EncounterCard
                key={`offer-${today.picksUsed}-${idx}`}
                offer={offer}
                index={idx}
                onOpen={() => setOpenSlot(idx)}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Persistent bottom dock that mirrors the in-game user-hand
          treatment (gradient backdrop, centered horizontal row) and
          surfaces the DUGOUT button styled like the in-game Lock In
          CTA. Sits OUTSIDE the inner `max-w-6xl` column so the
          gradient stretches the full viewport like the gameplay
          version. */}
      <RosterDock onOpenDrawer={() => setDrawerOpen(true)} />

      {openSlot !== null && (
        <SlotModal slotIndex={openSlot} onClose={closeEncounter} />
      )}
      {drawerOpen && <RosterDrawer onClose={() => setDrawerOpen(false)} />}
    </motion.div>
  );
}

/* ---------------------------------------------------------------------------
 * Day breadcrumb
 *
 * Seven-node horizontal trail spanning the full week:
 *   Mon - Tue - Wed - Thu - Game 1 - Game 2 - Game 3
 *
 * The first four are tiny dot nodes (the front-office days); the last
 * three replace the dot with a "GAME N" pill so the user can see at a
 * glance "I'm Wednesday, three games still ahead". Active state pulses
 * amber; past nodes/segments fill emerald; future nodes/segments stay
 * dim slate so the trail reads as progression-along-a-path.
 *
 * Active-index semantics:
 *   0..3  -> the corresponding front-office day (Mon..Thu)
 *   4..6  -> the corresponding weekend game (1..3 of the best-of-3)
 *   -1    -> nothing active (e.g., between weeks)
 * --------------------------------------------------------------------------- */

interface BreadcrumbNode {
  key: string;
  /** Front-office days render a small dot; game nodes render a pill label. */
  kind: "day" | "game";
  /** Display label under the dot (e.g. "Mon") or inside the pill ("Game 1"). */
  label: string;
}

const BREADCRUMB_NODES: BreadcrumbNode[] = [
  { key: "mon", kind: "day", label: "Mon" },
  { key: "tue", kind: "day", label: "Tue" },
  { key: "wed", kind: "day", label: "Wed" },
  { key: "thu", kind: "day", label: "Thu" },
  { key: "game-1", kind: "game", label: "Game 1" },
  { key: "game-2", kind: "game", label: "Game 2" },
  { key: "game-3", kind: "game", label: "Game 3" },
];

function DayBreadcrumb({ activeDayIdx }: { activeDayIdx: number }) {
  return (
    <div className="flex items-center justify-center w-full max-w-3xl mx-auto pt-1 pb-2">
      {BREADCRUMB_NODES.map((node, i) => {
        const isActive = i === activeDayIdx;
        const isPast = i < activeDayIdx;
        const segmentDone = i < activeDayIdx;
        // Game pills get a wider min-width so the labels don't crowd
        // the dot nodes; day dots stay compact.
        const colMinWidth = node.kind === "game" ? "min-w-[72px]" : "min-w-[56px]";
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
        kindLabel: "Merchant",
        title: MERCHANT_LABEL[offer.merchantId],
        blurb: MERCHANT_BLURB[offer.merchantId],
        glyph: merchantGlyph(offer.merchantId),
        gradient: "from-amber-700 via-amber-900 to-slate-950",
        ring: "ring-amber-400/60 hover:ring-amber-300",
        accent: "text-amber-200",
        textTint: "text-amber-100",
      };
    case "event":
      return {
        kindLabel: "Event",
        title: EVENT_LABEL[offer.eventId],
        blurb: EVENT_BLURB[offer.eventId],
        glyph: eventGlyph(offer.eventId),
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

function eventGlyph(id: string): string {
  switch (id) {
    case "ringing_phone":
      return "📞";
    case "microphone":
      return "🎙️";
    case "injury_report":
      return "🩼";
    default:
      return "✨";
  }
}

function EncounterCard({
  offer,
  index,
  onOpen,
}: {
  offer: EncounterOffer;
  index: number;
  onOpen: () => void;
}) {
  const style = styleForOffer(offer);
  return (
    <motion.button
      type="button"
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: index * 0.07, type: "spring", stiffness: 240, damping: 22 }}
      whileHover={{
        y: -8,
        scale: 1.02,
      }}
      whileTap={{ scale: 0.98 }}
      onClick={onOpen}
      className={`relative rounded-2xl bg-gradient-to-br ${style.gradient} ring-2 ${style.ring} p-5 text-left flex flex-col gap-3 min-h-[200px] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.6)] overflow-hidden transition-shadow hover:shadow-[0_30px_60px_-10px_rgba(0,0,0,0.8)]`}
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
 * Roster dock — always-on bottom rail
 *
 * Mirrors the in-game user-hand visual treatment: a full-width gradient
 * backdrop fading up from the slate floor to transparent, the player
 * cards laid out in a centered horizontal row above it, and a single
 * primary CTA below the cards. The CTA is the DUGOUT button -- shaped
 * and positioned exactly like the in-combat "Lock In" pill so the user
 * trains a single muscle-memory motion across the run loop.
 *
 * The cards use the standard (non-compact) `PlayerCard` size so the
 * row reads at the same scale as the user-hand strip during a game.
 * --------------------------------------------------------------------------- */

function RosterDock({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const run = useGameStore((s) => s.run);

  // Drag-to-scroll state. The flat `useRef`-based stash keeps everything
  // out of React's render cycle so a flick gesture never reflows the
  // tree. `moved` flips true once the pointer has shifted >4px from its
  // start, which we use to short-circuit accidental click-throughs on
  // child cards (a slow drag should never register as a card tap).
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef({
    pointerId: -1,
    startX: 0,
    startScroll: 0,
    moved: false,
  });
  const [isDragging, setIsDragging] = useState(false);

  if (!run) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollerRef.current) return;
    // Skip non-primary buttons (right-click, middle-click) so they
    // still bubble for context menus / autoscroll.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: scrollerRef.current.scrollLeft,
      moved: false,
    };
    scrollerRef.current.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (s.pointerId !== e.pointerId || !scrollerRef.current) return;
    const dx = e.clientX - s.startX;
    if (!s.moved && Math.abs(dx) > 4) s.moved = true;
    scrollerRef.current.scrollLeft = s.startScroll - dx;
  };

  const releasePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (s.pointerId !== e.pointerId) return;
    if (scrollerRef.current?.hasPointerCapture(e.pointerId)) {
      scrollerRef.current.releasePointerCapture(e.pointerId);
    }
    dragStateRef.current.pointerId = -1;
    setIsDragging(false);
  };

  return (
    // Mirrors the in-game user-hand container exactly:
    //   `absolute inset-x-0 bottom-0 ... pb-8 bg-gradient-to-t
    //    from-slate-900/80 via-slate-900/40 to-transparent pt-32 h-80`
    // -- so the front-office bottom rail reads as the same physical
    // surface as the in-combat hand.
    <div
      className="absolute inset-x-0 bottom-0 pointer-events-none flex flex-col items-center justify-end pb-8 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent pt-32 h-80"
    >
      <div className="pointer-events-auto flex flex-col items-center gap-4 w-full">
        {/* Player row -- drag-and-scrollable horizontally so a 10-man
            roster never overflows the viewport unreachably.
            - `overflow-x-auto`: native wheel + touch panning (mobile gets
              this for free).
            - Pointer handlers: desktop mouse drag-to-scroll. We capture
              the pointer on down so the gesture survives even if the
              cursor leaves the row mid-drag.
            - `touch-action: pan-x`: tells the browser we're handling
              the horizontal axis ourselves while still letting vertical
              page scroll bubble (important on phones where the dock
              sits at the bottom of the page).
            - `cursor-grab` / `cursor-grabbing`: standard drag-affordance
              toggling so the user reads the row as draggable.
            - `pt-12 pb-2`: gives the hover-lifted card headroom inside
              the scroller's own box. CSS coerces `overflow-y` to `auto`
              the moment `overflow-x` is non-visible (so we can't just
              let the lift escape the container), but a generous top
              pad keeps the focused card's translated/scaled top edge
              inside the visible area. The `-mt-12` on the wrapper
              cancels that visually so the dock height doesn't change.
            - `w-full` (no max-w cap): the previous `max-w-6xl` cap
              made a 10-man roster (~1352px wide) overflow on any
              viewport <1153px wide, and combined with center-justify
              caused the left edge of the first card to be clipped
              behind the unreachable left overflow. Letting the row
              span the full dock gives the natural layout case the
              widest possible runway before overflow even kicks in.
            - `justifyContent: "safe center"` (inline style; Tailwind
              doesn't ship a utility for the safe keyword): when the
              row fits, it centers; when it doesn't, the browser
              auto-falls-back to `flex-start` so the leftmost card is
              always reachable via scroll/drag instead of stranded
              behind scrollLeft=0. This is THE fix for the "first card
              25%-clipped" bug. */}
        <div
          ref={scrollerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          style={{ justifyContent: "safe center" }}
          className={`flex items-end gap-2 w-full px-6 pt-12 pb-2 -mt-12 overflow-x-auto select-none touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            isDragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          {run.roster.map((slot, i) => (
            <motion.div
              key={`${slot.player.id}-${i}`}
              whileHover={
                // Suppress hover-lift while a drag is in flight --
                // otherwise every card the cursor passes over during
                // the drag would y/scale-pop, making the row feel
                // jittery rather than glide-scrolly.
                isDragging ? undefined : { y: -8, scale: 1.03 }
              }
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="flex-shrink-0"
            >
              <PlayerCard
                player={slot.player}
                tier={slot.tier}
                showSockets={false}
              />
            </motion.div>
          ))}
        </div>

        {/* DUGOUT button. Mirrors the in-combat Lock In styling
            (`px-12 py-3 bg-blue-600 ... rounded-full ... text-lg
            uppercase tracking-wider`) so the user reads it as the same
            class of "primary commit" affordance. The Briefcase glyph
            differentiates it from Lock In and matches the dugout pill
            in the in-game SznDugoutPanel. */}
        <button
          type="button"
          onClick={onOpenDrawer}
          className="px-12 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full shadow-lg shadow-blue-900/50 transition-all hover:scale-105 active:scale-95 text-lg uppercase tracking-wider inline-flex items-center gap-2"
        >
          <Briefcase className="w-5 h-5" />
          Dugout
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Slot modal
 *
 * The opened encounter overlays the screen as a centered card with its
 * own colored backdrop. The offer is snapshotted once on mount so a
 * mid-modal slate refresh (commitEncounter rolls fresh offers) doesn't
 * yank the data out from underneath the user.
 * --------------------------------------------------------------------------- */

function SlotModal({
  slotIndex,
  onClose,
}: {
  slotIndex: number;
  onClose: () => void;
}) {
  const run = useGameStore((s) => s.run);
  // Snapshot the offer at mount so the modal stays stable even after
  // the underlying slate refreshes mid-interaction.
  const [snapshot] = useState<EncounterOffer | null>(() => {
    if (!run || run.day === "series") return null;
    const dayKey = run.day as DayOfWeek;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
    return run.weekEncounters[dayIdx]?.offers[slotIndex] ?? null;
  });
  if (!snapshot) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        className="w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {snapshot.kind === "merchant" ? (
          <MerchantView slotIndex={slotIndex} offer={snapshot} onClose={onClose} />
        ) : snapshot.kind === "playerMarket" ? (
          <PlayerMarketView
            slotIndex={slotIndex}
            offer={snapshot}
            onClose={onClose}
          />
        ) : (
          <EventEncounterView
            slotIndex={slotIndex}
            offer={snapshot}
            onClose={onClose}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
