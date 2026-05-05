import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, GraduationCap, X } from 'lucide-react';
import { useGameStore } from '../lib/gameStore';
import {
  TUTORIAL_STEPS,
  type TutorialPlacement,
  type TutorialStep,
} from '../lib/tutorialSteps';

/**
 * "Learn to Play" walkthrough overlay.
 *
 * Renders only when `tutorialActive` is true. For each step:
 *
 *   - Looks up the anchor element via `document.querySelector(step.anchor)`
 *     and reads its `getBoundingClientRect`. If the anchor is missing or
 *     null we render a centered modal with no spotlight.
 *   - Draws a full-viewport SVG dim with a rounded-rect cutout around the
 *     anchor (via `<mask>`) so only that element shines through.
 *   - Positions the explanatory modal opposite the anchor's screen
 *     quadrant (top half -> modal below, bottom half -> modal above), or
 *     pinned to the user's preferred placement when set.
 *
 * Engine pause: the SVG dim has `pointer-events: auto`, so clicks on the
 * dimmed area never reach the underlying UI. The cutout itself has
 * `pointer-events: none` ONLY on the final "Press Lock In" step, which
 * lets the player's click reach the real button to advance out of the
 * tutorial. Every other step keeps the cutout pointer-blocking too --
 * the player's only forward path is the modal's Next button.
 */
export function TutorialOverlay() {
  const tutorialActive = useGameStore((s) => s.tutorialActive);
  const tutorialStepIndex = useGameStore((s) => s.tutorialStepIndex);
  const tutorialNext = useGameStore((s) => s.tutorialNext);
  const tutorialPrev = useGameStore((s) => s.tutorialPrev);
  const tutorialExit = useGameStore((s) => s.tutorialExit);
  // Re-measure the anchor whenever the at-bat changes (signature card
  // re-deal can shift the bounding rects), the phase flips, the user
  // resizes the window, or the page scrolls.
  const atBatId = useGameStore((s) => s.atBatId);
  const phase = useGameStore((s) => s.phase);

  const step: TutorialStep | null = tutorialActive
    ? TUTORIAL_STEPS[tutorialStepIndex] ?? null
    : null;

  return (
    <AnimatePresence>
      {step && (
        <TutorialFrame
          key="tutorial-overlay"
          step={step}
          stepIndex={tutorialStepIndex}
          totalSteps={TUTORIAL_STEPS.length}
          atBatId={atBatId}
          phase={phase}
          onNext={tutorialNext}
          onPrev={tutorialPrev}
          onExit={tutorialExit}
        />
      )}
    </AnimatePresence>
  );
}

interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function TutorialFrame({
  step,
  stepIndex,
  totalSteps,
  atBatId,
  phase,
  onNext,
  onPrev,
  onExit,
}: {
  step: TutorialStep;
  stepIndex: number;
  totalSteps: number;
  atBatId: number;
  phase: string;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
}) {
  const [rect, setRect] = useState<AnchorRect | null>(null);
  const [viewport, setViewport] = useState(() => readViewport());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    setViewport(readViewport());
    if (!step.anchor) {
      setRect(null);
      return;
    }
    // querySelectorAll, not querySelector: callers may attach the same
    // anchor key to multiple elements (e.g. "user-hand" wrapping both
    // batter and pitcher strips). We pick whichever is currently visible
    // in the viewport so the spotlight matches what the user actually
    // sees in their seat.
    const matches = document.querySelectorAll<HTMLElement>(step.anchor);
    if (matches.length === 0) {
      setRect(null);
      return;
    }
    let chosen: HTMLElement | null = null;
    for (const el of Array.from(matches)) {
      if (isVisibleInViewport(el)) {
        chosen = el;
        break;
      }
    }
    chosen = chosen ?? matches[0];
    const r = chosen.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setRect(null);
      return;
    }
    const padding = step.highlightPadding ?? 8;
    setRect({
      x: Math.max(0, r.left - padding),
      y: Math.max(0, r.top - padding),
      width: r.width + padding * 2,
      height: r.height + padding * 2,
    });
  }, [step]);

  useLayoutEffect(() => {
    measure();
  }, [measure, atBatId, phase]);

  useEffect(() => {
    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    // One additional measurement on the next animation frame catches
    // motion-driven layout shifts that fire after our initial pass
    // (e.g. cards finishing their entry tween).
    const raf = requestAnimationFrame(() => measure());
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit();
      } else if (e.key === 'ArrowRight') {
        if (!step.interactive) onNext();
      } else if (e.key === 'ArrowLeft') {
        onPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit, onNext, onPrev, step.interactive]);

  const modalPos = computeModalPlacement(rect, viewport, step.placement ?? 'auto');
  const isFinal = step.interactive === true;
  const isFirst = stepIndex === 0;

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } }}
      exit={{ opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
      // The wrapper itself MUST be pointer-events-none so clicks pass
      // through to whichever child opts back in. The SpotlightBackdrop
      // dim panels re-enable `pointer-events: auto` to block clicks on
      // the dimmed area (engine pause), the modal re-enables it for its
      // own buttons, and the spotlight cutout is intentionally a hole
      // where clicks fall through to the underlying anchor (only used
      // by the final interactive Lock In step). Without this, the
      // wrapper itself intercepts every click.
      className="fixed inset-0 z-[45] pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Tutorial step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
    >
      <SpotlightBackdrop
        rect={rect}
        viewport={viewport}
        allowClickThrough={isFinal}
      />

      <motion.div
        key={step.id}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { type: 'spring', stiffness: 280, damping: 24 },
        }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        className="absolute pointer-events-auto bg-slate-950/95 border border-amber-500/40 rounded-xl shadow-2xl backdrop-blur-md px-5 py-4 max-w-sm"
        style={modalPos.style}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 text-amber-300">
            <GraduationCap className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em]">
              How to Play
            </span>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="text-slate-500 hover:text-slate-200 transition-colors"
            title="Exit tutorial"
            aria-label="Exit tutorial"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 className="text-lg font-black text-white leading-tight mb-1.5">
          {step.title}
        </h3>
        <p className="text-sm text-slate-300 leading-relaxed">{step.body}</p>

        {isFinal && (
          <p className="mt-3 text-xs text-amber-300 font-bold uppercase tracking-widest">
            Press Lock In below to finish
          </p>
        )}

        <div className="flex items-center justify-between mt-4 gap-2">
          <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">
            Step {stepIndex + 1} / {totalSteps}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={isFirst}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-slate-800/70 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold uppercase tracking-wider text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            {!isFinal && (
              <button
                type="button"
                onClick={onNext}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-stone-900 text-xs font-bold uppercase tracking-wider transition-colors"
                autoFocus
              >
                Next
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Pulsing ring around the spotlight, drawn separately from the mask
          so we can use Tailwind / Motion for the animation. Only renders
          when there's a rect (centered narrative steps skip it). */}
      {rect && (
        <motion.div
          key={`ring-${step.id}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.25 } }}
          exit={{ opacity: 0 }}
          className="absolute pointer-events-none border-2 border-amber-300 rounded-lg"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow:
              '0 0 0 9999px rgba(0,0,0,0.0), 0 0 24px rgba(251, 191, 36, 0.55)',
          }}
        />
      )}
    </motion.div>
  );
}

/**
 * Full-viewport dim with a rounded-rect "hole" cut over `rect`. Built with
 * an SVG `<mask>`: a white-filled rect under the whole viewport (visible)
 * minus a black-filled rounded rect over the spotlight (transparent).
 *
 * `pointer-events` semantics:
 *   - The SVG itself has pointer-events: auto so it captures clicks on
 *     the dimmed area. This is what enforces the engine pause.
 *   - When `allowClickThrough` is true (final lock-in step), we add a
 *     transparent "click-through window" element over the cutout area
 *     with pointer-events: none, BUT we also drop pointer-events on the
 *     SVG to let clicks reach the underlying anchor.
 */
function SpotlightBackdrop({
  rect,
  viewport,
  allowClickThrough,
}: {
  rect: AnchorRect | null;
  viewport: { width: number; height: number };
  allowClickThrough: boolean;
}) {
  if (!rect) {
    // No anchor -> full dim, no cutout.
    return (
      <div
        className="absolute inset-0 bg-black/70"
        style={{ pointerEvents: 'auto' }}
        aria-hidden="true"
      />
    );
  }

  const radius = 10;

  if (allowClickThrough) {
    // Render four absolutely-positioned dim panels framing the cutout
    // (top, bottom, left, right strips) so the cutout itself is just
    // empty space. Clicks naturally pass through to the underlying
    // anchor element.
    const top = rect.y;
    const left = rect.x;
    const bottom = viewport.height - (rect.y + rect.height);
    const right = viewport.width - (rect.x + rect.width);
    return (
      <>
        <div
          aria-hidden="true"
          className="absolute bg-black/70"
          style={{ top: 0, left: 0, right: 0, height: top, pointerEvents: 'auto' }}
        />
        <div
          aria-hidden="true"
          className="absolute bg-black/70"
          style={{
            top: viewport.height - bottom,
            left: 0,
            right: 0,
            height: bottom,
            pointerEvents: 'auto',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute bg-black/70"
          style={{
            top: top,
            left: 0,
            width: left,
            height: rect.height,
            pointerEvents: 'auto',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute bg-black/70"
          style={{
            top: top,
            left: viewport.width - right,
            width: right,
            height: rect.height,
            pointerEvents: 'auto',
          }}
        />
      </>
    );
  }

  // Standard non-interactive backdrop: SVG mask cuts a rounded hole.
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'auto' }}
      aria-hidden="true"
    >
      <defs>
        <mask id="dugout-tutorial-cutout">
          <rect width="100%" height="100%" fill="white" />
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            rx={radius}
            ry={radius}
            fill="black"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.7)"
        mask="url(#dugout-tutorial-cutout)"
      />
    </svg>
  );
}

function readViewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function isVisibleInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (r.bottom < 0 || r.top > window.innerHeight) return false;
  if (r.right < 0 || r.left > window.innerWidth) return false;
  // Also check the element isn't `display: none` somewhere up the chain.
  const cs = window.getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  return true;
}

interface ModalPlacement {
  style: React.CSSProperties;
}

const MODAL_WIDTH = 360;
const MODAL_GAP = 16;
/**
 * Generous height assumption used for clamp math. We don't know the modal's
 * real height before render; this is a conservative upper bound so we can
 * decide which side has room. Slightly over-sized to favor center fallback
 * when the viewport is short rather than risk a clipped modal.
 */
const MODAL_ASSUMED_HEIGHT = 240;
const VIEWPORT_EDGE_PAD = 16;

/**
 * Decide where the modal goes relative to the spotlight rect.
 *
 *   - `center`: pin to viewport center.
 *   - `top` / `bottom` / `left` / `right`: pin to that side of the rect.
 *   - `auto` (default): pick the side with the most room.
 *
 * Vertical placements (`top` / `bottom`) ALWAYS use a `top` CSS coordinate
 * (no mixing with `bottom`) so a single clamp keeps the modal on-screen.
 * If neither side has enough room (very short viewport, oversized anchor)
 * we fall back to centering -- the dim still cues the player to read the
 * modal even if the spotlight isn't visually tied to it.
 */
function computeModalPlacement(
  rect: AnchorRect | null,
  viewport: { width: number; height: number },
  placement: TutorialPlacement,
): ModalPlacement {
  const width = Math.min(MODAL_WIDTH, viewport.width - VIEWPORT_EDGE_PAD * 2);
  // Use absolute pixel positioning instead of `left: 50%; transform:
  // translate(-50%, -50%)`. Motion's `animate` sets its own `transform`
  // (for the scale/y entry tween), which overrides any inline transform
  // we set here -- the centering translate would be silently dropped and
  // the modal's LEFT edge would land at viewport center.
  const center = (): ModalPlacement => ({
    style: {
      left: Math.max(VIEWPORT_EDGE_PAD, (viewport.width - width) / 2),
      top: Math.max(
        VIEWPORT_EDGE_PAD,
        (viewport.height - MODAL_ASSUMED_HEIGHT) / 2,
      ),
      width,
    },
  });

  if (!rect || placement === 'center') return center();

  // Available space on each side of the rect.
  const spaceAbove = rect.y;
  const spaceBelow = viewport.height - (rect.y + rect.height);
  const requiredVertical = MODAL_ASSUMED_HEIGHT + MODAL_GAP;

  // Resolve `auto` to whichever vertical side has more room. If neither
  // side has enough room (anchor takes most of the viewport), bail to
  // center -- avoids a clipped modal.
  let resolved: TutorialPlacement = placement;
  if (resolved === 'auto') {
    if (spaceAbove < requiredVertical && spaceBelow < requiredVertical) {
      return center();
    }
    resolved = spaceBelow >= spaceAbove ? 'bottom' : 'top';
  }

  // Same not-enough-room safeguard for explicit top/bottom: if the user
  // picked a side that won't fit, swap to the other side, then fall back
  // to center if both sides are still too small.
  if (resolved === 'top' && spaceAbove < requiredVertical) {
    resolved = spaceBelow >= requiredVertical ? 'bottom' : 'center';
  } else if (resolved === 'bottom' && spaceBelow < requiredVertical) {
    resolved = spaceAbove >= requiredVertical ? 'top' : 'center';
  }
  if (resolved === 'center') return center();

  const horizontalLeft = rect.x + rect.width / 2 - width / 2;

  switch (resolved) {
    case 'top': {
      // Modal sits above the anchor. Compute top so the modal's BOTTOM
      // edge sits at `rect.y - MODAL_GAP`. Since the modal's height is
      // unknown, use the assumed height; the real modal may be shorter
      // (it'll just sit higher above the anchor than ideal) but never
      // taller than the assumption.
      const top = clamp(
        rect.y - MODAL_GAP - MODAL_ASSUMED_HEIGHT,
        VIEWPORT_EDGE_PAD,
        viewport.height - VIEWPORT_EDGE_PAD - MODAL_ASSUMED_HEIGHT,
      );
      return {
        style: {
          left: clamp(
            horizontalLeft,
            VIEWPORT_EDGE_PAD,
            viewport.width - width - VIEWPORT_EDGE_PAD,
          ),
          top,
          width,
        },
      };
    }
    case 'bottom': {
      const top = clamp(
        rect.y + rect.height + MODAL_GAP,
        VIEWPORT_EDGE_PAD,
        viewport.height - VIEWPORT_EDGE_PAD - MODAL_ASSUMED_HEIGHT,
      );
      return {
        style: {
          left: clamp(
            horizontalLeft,
            VIEWPORT_EDGE_PAD,
            viewport.width - width - VIEWPORT_EDGE_PAD,
          ),
          top,
          width,
        },
      };
    }
    case 'left': {
      const left = rect.x - width - MODAL_GAP;
      return {
        style: {
          left: clamp(
            left,
            VIEWPORT_EDGE_PAD,
            viewport.width - width - VIEWPORT_EDGE_PAD,
          ),
          top: clamp(
            rect.y,
            VIEWPORT_EDGE_PAD,
            viewport.height - VIEWPORT_EDGE_PAD - MODAL_ASSUMED_HEIGHT,
          ),
          width,
        },
      };
    }
    case 'right': {
      const left = rect.x + rect.width + MODAL_GAP;
      return {
        style: {
          left: clamp(
            left,
            VIEWPORT_EDGE_PAD,
            viewport.width - width - VIEWPORT_EDGE_PAD,
          ),
          top: clamp(
            rect.y,
            VIEWPORT_EDGE_PAD,
            viewport.height - VIEWPORT_EDGE_PAD - MODAL_ASSUMED_HEIGHT,
          ),
          width,
        },
      };
    }
    default:
      return center();
  }
}

function clamp(value: number, min: number, max: number): number {
  // Guard against `min > max` (e.g. modal taller than the viewport): when
  // that happens, bias toward the top of the viewport so the modal header
  // stays visible even if the bottom is clipped.
  if (min > max) return min;
  return Math.max(min, Math.min(max, value));
}
