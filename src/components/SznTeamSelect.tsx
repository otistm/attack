/**
 * SznTeamSelect — full-screen horizontal carousel team picker.
 *
 * Replaces the 6-row grid with a single focused-team-in-center carousel
 * so the passive ability gets equal billing with the franchise mark.
 * Each team's primary color fills the background of its hero card, with
 * the team abbreviation / mascot rendered in giant typography as a
 * stand-in for the actual licensed logo (we ship no MLB image assets).
 *
 * Navigation parity across input devices:
 *   - Mouse: click side peeks to focus them, click center to commit (if
 *     available), or use the floating ◀/▶ arrows.
 *   - Keyboard: ArrowLeft / ArrowRight cycle focus, Enter commits,
 *     Escape backs out.
 *   - Gamepad: DPAD LEFT/RIGHT cycle, CROSS commits, CIRCLE backs out.
 *
 * The 29 placeholder franchises stay browsable so the player can see
 * what's planned; their hero card surfaces a "Coming Soon" treatment
 * and the commit button disables itself.
 */

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MLB_DIVISIONS,
  MLB_TEAMS,
  type MlbTeam,
  type MlbTeamId,
} from "../lib/sznTeams";
import { BADGES, type BadgeDefinition } from "../lib/badges";
import { useGameStore } from "../lib/gameStore";
import { useSznGamepad } from "../lib/useSznGamepad";

// Carousel render slots. Each visible card occupies one slot
// (-2 .. +2 around the focused index). Slots further out are smaller
// and more faded so the focused card always wins the eye.
type SlotOffset = -2 | -1 | 0 | 1 | 2;

interface SlotStyle {
  /** Horizontal translate in px applied via x. */
  x: number;
  /** Visual scale -- center 1, peek 0.7, far peek 0.45. */
  scale: number;
  /** Opacity ramp so far cards don't fight the center for attention. */
  opacity: number;
  /** Subtle Y rotation to give the row a slight perspective curve. */
  rotateY: number;
  /** z-index so the center card always paints over the peeks. */
  zIndex: number;
  /** Filter blur on far cards. */
  blurPx: number;
}

const SLOT_STYLE: Record<SlotOffset, SlotStyle> = {
  [-2]: { x: -560, scale: 0.45, opacity: 0.25, rotateY: 28, zIndex: 1, blurPx: 4 },
  [-1]: { x: -320, scale: 0.7, opacity: 0.55, rotateY: 18, zIndex: 2, blurPx: 1.5 },
  [0]: { x: 0, scale: 1, opacity: 1, rotateY: 0, zIndex: 3, blurPx: 0 },
  [1]: { x: 320, scale: 0.7, opacity: 0.55, rotateY: -18, zIndex: 2, blurPx: 1.5 },
  [2]: { x: 560, scale: 0.45, opacity: 0.25, rotateY: -28, zIndex: 1, blurPx: 4 },
};

const SLOT_OFFSETS: SlotOffset[] = [-2, -1, 0, 1, 2];

export function SznTeamSelect() {
  const open = useGameStore((s) => s.showSznTeamSelect);
  const run = useGameStore((s) => s.run);
  const setOpen = useGameStore((s) => s.setShowSznTeamSelect);
  const setShowStartScreen = useGameStore((s) => s.setShowStartScreen);
  const startSznRun = useGameStore((s) => s.startSznRun);

  const close = useCallback(() => {
    setOpen(false);
    if (!run) setShowStartScreen(true);
  }, [run, setOpen, setShowStartScreen]);

  // Stable flat order: division-grouped (AL East -> NL West) so the
  // carousel sequence mirrors the standings sidebar most baseball fans
  // already have memorised.
  const teams = useMemo<MlbTeam[]>(
    () =>
      MLB_DIVISIONS.flatMap((d) =>
        (Object.values(MLB_TEAMS) as MlbTeam[]).filter((t) => t.division === d),
      ),
    [],
  );

  const firstAvailableIdx = useMemo(
    () => Math.max(0, teams.findIndex((t) => t.available)),
    [teams],
  );
  const [focusIdx, setFocusIdx] = useState(firstAvailableIdx);
  useEffect(() => {
    if (open) setFocusIdx(firstAvailableIdx);
  }, [open, firstAvailableIdx]);

  const focused = teams[focusIdx];
  const focusedBadge: BadgeDefinition | null = focused
    ? BADGES[focused.passiveBadgeId] ?? null
    : null;

  const goPrev = useCallback(() => {
    setFocusIdx((i) => (i - 1 + teams.length) % teams.length);
  }, [teams.length]);
  const goNext = useCallback(() => {
    setFocusIdx((i) => (i + 1) % teams.length);
  }, [teams.length]);
  const commit = useCallback(() => {
    const t = teams[focusIdx];
    if (t && t.available) startSznRun(t.id);
  }, [teams, focusIdx, startSznRun]);

  // Keyboard parity (Arrow keys + Enter + Escape). The picker is the
  // top of the input stack while open, so capturing on `window` is
  // safe; the gamepad hook runs in parallel below.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, goPrev, goNext, commit, close]);

  useSznGamepad({
    id: "szn-team-select",
    // 100 sits above the StartGameScreen (10) so navigation here
    // can't bleed into the lane chooser still mounted underneath.
    priority: 100,
    enabled: open,
    handler: (btn) => {
      if (!open) return;
      if (btn === "CIRCLE") {
        close();
        return;
      }
      if (btn === "DPAD_LEFT" || btn === "L1") {
        goPrev();
        return;
      }
      if (btn === "DPAD_RIGHT" || btn === "R1") {
        goNext();
        return;
      }
      if (btn === "CROSS") {
        commit();
      }
    },
  });

  // Build the visible slot list (center +/- 2) every render. Wraps
  // around so the carousel feels endless instead of stopping at the
  // div boundaries.
  const visibleSlots = useMemo(() => {
    if (teams.length === 0) return [];
    return SLOT_OFFSETS.map((offset) => {
      const idx = (focusIdx + offset + teams.length) % teams.length;
      return { team: teams[idx], offset, idx };
    });
  }, [teams, focusIdx]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="szn-team-select"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-slate-950"
          role="dialog"
          aria-modal="true"
          aria-label="Select your team for SZN run"
        >
          {/* Ambient background: cross-faded radial gradient driven by
              the focused team's colors. Switches via AnimatePresence so
              the previous wash dissolves under the new one instead of
              hard-cutting. */}
          <AmbientBackdrop team={focused} />

          <header className="relative z-20 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-950/40 backdrop-blur-sm">
            <button
              type="button"
              onClick={close}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <h1 className="dugout-font-sport text-2xl sm:text-3xl uppercase tracking-widest text-amber-200">
              Select Your Team
            </h1>
            <div className="text-xs uppercase tracking-widest text-slate-400 hidden sm:block">
              {focusIdx + 1} / {teams.length}
            </div>
          </header>

          {/* Main stage. Carousel up top; passive panel + CTA below. */}
          <main className="relative z-10 flex-1 flex flex-col items-stretch justify-between min-h-0">
            {/* Carousel stage. Fills the upper half so the hero card
                has the room to breathe. Overflow-hidden clips the far
                peeks at the edges as they slide off. */}
            <div className="relative flex-1 flex items-center justify-center overflow-hidden">
              <div
                className="relative w-full h-full flex items-center justify-center"
                style={{ perspective: 1400 }}
              >
                <AnimatePresence initial={false}>
                  {visibleSlots.map(({ team, offset, idx }) => (
                    <CarouselCard
                      key={team.id}
                      team={team}
                      offset={offset}
                      onClick={() => {
                        if (offset === 0) {
                          commit();
                        } else {
                          setFocusIdx(idx);
                        }
                      }}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {/* Floating nav arrows. Big tap targets for mouse;
                  hidden behind the focused card's z-index so they
                  don't clip its glow. */}
              <NavArrow direction="left" onClick={goPrev} />
              <NavArrow direction="right" onClick={goNext} />
            </div>

            {/* Passive ability panel + CTA + dots. */}
            <div className="relative z-20 px-4 sm:px-8 pb-6 pt-2 flex flex-col items-center gap-4">
              <PassivePanel
                team={focused}
                badge={focusedBadge}
              />
              <CommitButton
                team={focused}
                onClick={commit}
              />
              <DotsStrip
                total={teams.length}
                focusIdx={focusIdx}
                onJump={setFocusIdx}
              />
              <ControlsHint />
            </div>
          </main>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Carousel card — the giant focused hero + the smaller peeks
// ---------------------------------------------------------------------------

function CarouselCard({
  team,
  offset,
  onClick,
}: {
  team: MlbTeam;
  offset: SlotOffset;
  onClick: () => void;
}) {
  const style = SLOT_STYLE[offset];
  const isFocused = offset === 0;
  const disabled = !team.available;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      // Each card sits on an absolute origin in the parent and slides
      // to its slot's transform. Spring matches the dots strip / arrows
      // so the whole stage feels like one moving system.
      initial={{ opacity: 0, scale: style.scale * 0.9, x: style.x }}
      animate={{
        opacity: style.opacity,
        scale: style.scale,
        x: style.x,
        rotateY: style.rotateY,
        filter: style.blurPx ? `blur(${style.blurPx}px)` : "blur(0px)",
      }}
      exit={{ opacity: 0, scale: style.scale * 0.85 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      whileHover={isFocused ? undefined : { scale: style.scale * 1.04 }}
      whileTap={!disabled ? { scale: style.scale * 0.98 } : undefined}
      className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 select-none ${
        isFocused ? "cursor-pointer" : "cursor-pointer"
      }`}
      style={{ zIndex: style.zIndex, transformStyle: "preserve-3d" }}
      aria-label={
        isFocused
          ? `${team.name} (focused)`
          : `Focus ${team.name}`
      }
      aria-current={isFocused ? "true" : undefined}
    >
      <TeamHero team={team} focused={isFocused} disabled={disabled} />
    </motion.button>
  );
}

/**
 * The actual team "card" graphic. A vertically-stacked composition:
 *   1. Big rounded panel with the team's primary -> secondary gradient
 *      as the fill -- evokes a jersey color block.
 *   2. Circular logo treatment (no licensed logos, so we render the
 *      three-letter abbreviation in giant Teko inside a secondary-color
 *      ring against a darker plate).
 *   3. Mascot name in Alfa Slab One ("YANKEES") below the badge.
 *   4. Division + city in smaller all-caps.
 *
 * The focused card paints a 2px amber border + amber glow so the
 * controller / mouse user can never lose track of which card the
 * "Run with" button will commit.
 */
function TeamHero({
  team,
  focused,
  disabled,
}: {
  team: MlbTeam;
  focused: boolean;
  disabled: boolean;
}) {
  return (
    <div
      className={`relative w-[280px] h-[380px] sm:w-[320px] sm:h-[430px] rounded-3xl overflow-hidden flex flex-col items-center justify-between p-6 ${
        focused
          ? "border-2 border-amber-300 shadow-[0_0_60px_8px_rgba(252,211,77,0.45)]"
          : "border border-white/15"
      }`}
      style={{
        background: `linear-gradient(155deg, ${team.primaryColor} 0%, ${team.secondaryColor} 100%)`,
      }}
    >
      {/* Sheen overlay so flat color blocks have a hint of depth. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(140deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 40%, rgba(0,0,0,0.28) 100%)",
        }}
      />

      {/* Division pill (top). */}
      <div className="relative z-10 w-full flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/85 bg-black/40 rounded px-2 py-1">
          {team.division}
        </span>
        {disabled && (
          <span className="text-white/80 bg-black/45 rounded p-1.5" title="Coming soon">
            <Lock className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      {/* Logo treatment. Big ring + abbreviation; the abbreviation is
          the "logo" stand-in until we ship licensed marks. */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-3">
        <div
          className="w-40 h-40 sm:w-44 sm:h-44 rounded-full flex items-center justify-center border-[6px]"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${team.secondaryColor} 0%, ${team.primaryColor} 65%)`,
            borderColor: team.secondaryColor,
            boxShadow:
              "inset 0 6px 18px rgba(255,255,255,0.18), inset 0 -8px 18px rgba(0,0,0,0.35)",
          }}
        >
          <span
            className="dugout-font-sport text-7xl sm:text-8xl leading-none text-white tracking-tighter"
            style={{
              textShadow:
                "0 4px 0 rgba(0,0,0,0.35), 0 0 18px rgba(255,255,255,0.25)",
            }}
          >
            {team.abbr}
          </span>
        </div>
        <h2
          className="dugout-font-title text-3xl sm:text-4xl uppercase text-white text-center leading-none"
          style={{ textShadow: "0 2px 0 rgba(0,0,0,0.55)" }}
        >
          {team.shortName}
        </h2>
      </div>

      {/* City line (bottom). */}
      <div className="relative z-10 w-full text-center">
        <div className="text-[11px] font-black uppercase tracking-[0.25em] text-white/85">
          {/* City = team.name minus the mascot suffix. */}
          {team.name.replace(` ${team.shortName}`, "")}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passive ability panel below the carousel
// ---------------------------------------------------------------------------

function PassivePanel({
  team,
  badge,
}: {
  team: MlbTeam | undefined;
  badge: BadgeDefinition | null;
}) {
  if (!team || !badge) return null;
  return (
    <motion.div
      key={team.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.22 }}
      className="w-full max-w-2xl rounded-2xl border border-white/15 bg-slate-900/85 backdrop-blur-md px-5 py-4 flex items-center gap-4 shadow-[0_12px_30px_rgba(0,0,0,0.4)]"
      style={{ borderLeft: `4px solid ${badge.tint}` }}
    >
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl shrink-0 border border-white/20"
        style={{ background: badge.tint }}
        aria-hidden
      >
        <span>{badge.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300/80">
          Team Passive
        </div>
        <div className="dugout-font-sport text-xl sm:text-2xl uppercase tracking-wide text-white leading-tight">
          {badge.name}
        </div>
        <p className="text-xs sm:text-sm text-slate-300 leading-snug mt-0.5">
          {badge.flavor}
        </p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Commit button (Run with X / Coming Soon)
// ---------------------------------------------------------------------------

function CommitButton({
  team,
  onClick,
}: {
  team: MlbTeam | undefined;
  onClick: () => void;
}) {
  if (!team) return null;
  const available = team.available;
  return (
    <motion.button
      key={team.id}
      type="button"
      onClick={onClick}
      disabled={!available}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={available ? { scale: 1.04 } : undefined}
      whileTap={available ? { scale: 0.96 } : undefined}
      transition={{ duration: 0.18 }}
      className={`px-10 py-3 rounded-full font-black uppercase tracking-[0.18em] text-sm transition-colors ${
        available
          ? "bg-amber-300 hover:bg-amber-200 text-slate-950 shadow-[0_0_32px_rgba(252,211,77,0.6)]"
          : "bg-slate-800 text-slate-500 cursor-not-allowed"
      }`}
    >
      {available ? `Run with ${team.shortName}` : "Coming Soon"}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Dots strip indicator
// ---------------------------------------------------------------------------

function DotsStrip({
  total,
  focusIdx,
  onJump,
}: {
  total: number;
  focusIdx: number;
  onJump: (idx: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const active = i === focusIdx;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onJump(i)}
            className={`rounded-full transition-all ${
              active
                ? "w-6 h-2 bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.7)]"
                : "w-2 h-2 bg-white/25 hover:bg-white/45"
            }`}
            aria-label={`Jump to team ${i + 1} of ${total}`}
            aria-current={active ? "true" : undefined}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating nav arrows (mouse)
// ---------------------------------------------------------------------------

function NavArrow({
  direction,
  onClick,
}: {
  direction: "left" | "right";
  onClick: () => void;
}) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${
        direction === "left" ? "left-4 sm:left-8" : "right-4 sm:right-8"
      } z-30 w-12 h-12 rounded-full bg-slate-900/70 hover:bg-slate-800/90 border border-white/20 text-white flex items-center justify-center shadow-lg transition-colors`}
      aria-label={direction === "left" ? "Previous team" : "Next team"}
    >
      <Icon className="w-6 h-6" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Controls hint footer
// ---------------------------------------------------------------------------

function ControlsHint() {
  return (
    <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.22em] text-slate-400/80">
      <span>
        <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-bold mr-1">
          ◀
        </kbd>
        <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-bold">
          ▶
        </kbd>
        <span className="ml-1">Browse</span>
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-bold">
          ✕
        </kbd>
        <span className="ml-1">Select</span>
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-bold">
          ◯
        </kbd>
        <span className="ml-1">Back</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ambient backdrop: large soft gradient tied to the focused team's colors
// ---------------------------------------------------------------------------

function AmbientBackdrop({ team }: { team: MlbTeam | undefined }) {
  return (
    <AnimatePresence mode="sync">
      {team && (
        <motion.div
          key={team.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.85 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="absolute inset-0 z-0 pointer-events-none"
          aria-hidden
          style={{
            background: `
              radial-gradient(ellipse 80% 60% at 50% 35%, ${hexToRgba(team.primaryColor, 0.55)} 0%, transparent 60%),
              radial-gradient(ellipse 60% 50% at 50% 80%, ${hexToRgba(team.secondaryColor, 0.35)} 0%, transparent 70%),
              linear-gradient(180deg, #020617 0%, #0b1224 100%)
            `,
          }}
        />
      )}
    </AnimatePresence>
  );
}

// Used by the ambient backdrop only. Naive `#rrggbb` -> rgba(); we
// pass solid 6-digit hex strings throughout the team registry so the
// fast path is enough -- no need to pull in a color helper library.
function hexToRgba(hex: string, alpha: number): string {
  const trimmed = hex.replace("#", "");
  if (trimmed.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(trimmed.slice(0, 2), 16);
  const g = parseInt(trimmed.slice(2, 4), 16);
  const b = parseInt(trimmed.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Type re-export so the parent (StartGameScreen) didn't break when the
// old `MlbTeamId` import path was dropped. Internal callers should
// import directly from `sznTeams.ts`.
export type { MlbTeamId };
