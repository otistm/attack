/**
 * PlayerHero -- Topps-card hero panel for the live batter and pitcher.
 * Pinned to the LEFT screen margin by the parent overlay so the panel
 * occupies otherwise-empty whitespace and never overlaps the field or
 * the centered hand strips.
 *
 * Why this exists: the small ScorePill above each hand was the only visible
 * link between hand-reordering and the "BATTER 12 / PITCHER 9" totals.
 * Playtesters described the pill as a HUD readout rather than the player
 * themselves taking the hit, which made manipulating the hand feel
 * disconnected from the avatar in the field. This component re-centers the
 * total ON the player: the card art carries the team identity, the
 * MVP-style wordmark next to it carries the live total, and a pulse + color
 * flash on every value change reads as "you just buffed/debuffed this
 * player".
 *
 * Asset story (placeholders):
 *   The first cut ships with two licensed-style Topps NOW placeholders
 *   (Aaron Judge for batters, Cam Schlittler for pitchers) served from
 *   `public/cards/`. These are intentional placeholders -- every batter
 *   currently shows the Judge card and every pitcher the Schlittler card --
 *   until the rest of the per-player art is uploaded. To wire a per-player
 *   asset later, swap the `imageSrc` derivation below to look up
 *   `player.id` in a sprite map.
 *
 * Visual contract (intentional, do not "simplify"):
 *   - Card art is a vertical 5:7 (140x196 px) Topps frame with a thin
 *     white-silver border and a drop shadow, so the user instantly reads
 *     it as a player card rather than a generic info panel.
 *   - The total readout sits to the RIGHT of the card (toward the field)
 *     as a BARE big number (no chip, no border, no role label) -- per
 *     follow-up direction "just display a big number next to the card".
 *     The number is white with a strong drop shadow so it stays legible
 *     over the green-and-tan field.
 *   - Pulse magnitude scales with |delta|, clamped per-target so a +1
 *     trim is a nudge and a +12 swing visibly punches.
 *   - Positive deltas glow emerald, negative glow rose -- both on the
 *     card frame's boxShadow AND on the number's textShadow + color --
 *     so the user can read direction at a glance without parsing digits.
 *   - On player identity change (new at-bat) we treat it as a fresh
 *     mount instead of pulsing, so swapping from a 28-total slugger to a
 *     fresh batter at 12 doesn't read as "the batter just lost 16".
 *
 * Wiring constraints (see CardGameOverlay):
 *   - Mounted with `pointer-events-none` so clicks fall through to the
 *     hand strip / 3D scene underneath.
 *   - Hidden below `xl` because the left rail only exists at >=1280px;
 *     the existing ScorePill remains the readout on narrower screens.
 */
import { useEffect, useRef } from "react";
import { motion, useAnimationControls } from "motion/react";
import type { MlbPlayer } from "../lib/players";

interface PlayerHeroProps {
  player: MlbPlayer;
  /**
   * Live displayed total. `null` means "fog of war" (e.g., AI selecting in
   * secret) and renders the readout as `?` without triggering a pulse.
   */
  value: number | null;
  role: "BATTER" | "PITCHER";
  /**
   * Mirrors the existing ScorePill fog-of-war: while the AI is selecting,
   * their identity stays visible (player card) but their total is hidden.
   */
  dimmed?: boolean;
}

/**
 * Placeholder card art served from `public/cards/`. We deliberately split
 * by role rather than by player.id today because the repo only ships two
 * Topps NOW placeholders -- every batter shows Aaron Judge, every pitcher
 * shows Cam Schlittler -- until the user uploads per-player art. When that
 * lands, replace this lookup with a `player.id`-keyed sprite map and keep
 * the role-based path as the fallback.
 */
const PLACEHOLDER_CARD_SRC: Record<"BATTER" | "PITCHER", string> = {
  BATTER: "/cards/aaron-judge.png",
  PITCHER: "/cards/cam-schlittler.png",
};

/**
 * Per-role entry-tween delay. The pitcher arrives first (top of the rail),
 * the batter trails by a beat -- this stagger keeps the load-in reading as
 * a deliberate "deal pitcher, then batter, then their hands" rather than
 * having both heroes pop on the same frame.
 *
 * The total entry envelope is `delay + ENTRY_DURATION` (~0.48s for the
 * batter); the hand strip's `SIGNATURE_DELAY_CHILDREN` is bumped just
 * past that so the first signature card never starts flying in before
 * the hero card it belongs to is in place.
 */
const ENTRY_DELAY_BY_ROLE: Record<"BATTER" | "PITCHER", number> = {
  PITCHER: 0,
  BATTER: 0.08,
};
const ENTRY_DURATION = 0.4;
const ENTRY_X_OFFSET = -64;

export function PlayerHero({
  player,
  value,
  role,
  dimmed = false,
}: PlayerHeroProps) {
  const cardControls = useAnimationControls();
  const numberControls = useAnimationControls();

  const prevValueRef = useRef<number | null>(null);
  // `null` sentinel so the first render is treated as an identity change and
  // plays the entry tween. Without this, the initial mount would skip the
  // slide-in because `prevPlayerIdRef.current === player.id` from the start.
  const prevPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevPlayerIdRef.current !== player.id) {
      // First mount OR fresh at-bat: play the load-in entry tween (slide
      // from left + fade + scale), reset the value baseline so the next
      // render's value isn't diff'd against the previous player's number
      // (otherwise a new batter at 12 reads as "the previous batter just
      // lost N").
      //
      // We use explicit keyframe arrays (e.g. `x: [-64, 0]`) instead of
      // relying on the `initial` prop to set the from-state. Two reasons:
      //   1. The motion `initial` prop is set to the RESTING state, so if
      //      this effect ever fails to fire (React Strict Mode's
      //      double-invoke can interrupt mid-animation, and a remount
      //      between commits would leave us frozen at off-screen-left)
      //      the cards still paint visibly. Defaulting to visible is the
      //      least-bad failure mode.
      //   2. Keyframe arrays force motion to drive from-to imperatively
      //      every time the effect runs, so the second strict-mode pass
      //      replays the entry cleanly even after the ref mutated.
      prevPlayerIdRef.current = player.id;
      prevValueRef.current = value;

      const delay = ENTRY_DELAY_BY_ROLE[role];

      cardControls.start({
        x: [ENTRY_X_OFFSET, 0],
        opacity: [0, 1],
        scale: [0.88, 1],
        boxShadow: "0 10px 22px rgba(0,0,0,0.5)",
        transition: { duration: ENTRY_DURATION, ease: "easeOut", delay },
      });
      numberControls.start({
        x: [ENTRY_X_OFFSET / 2, 0],
        opacity: [0, 1],
        scale: [0.88, 1],
        color: "#ffffff",
        textShadow:
          "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        transition: {
          duration: ENTRY_DURATION,
          ease: "easeOut",
          // Number trails the card by a hair so the eye reads "card slides
          // in, then the number lands beside it".
          delay: delay + 0.12,
        },
      });
      return;
    }

    const prev = prevValueRef.current;
    prevValueRef.current = value;

    if (value === null || prev === null || value === prev) return;

    const delta = value - prev;
    const cardMagnitude = Math.min(0.14, Math.max(0.04, Math.abs(delta) * 0.015));
    // Number gets a punchier pulse than the card frame -- without a chip
    // bg the scale is the only thing carrying the "hit lands" beat.
    const numberMagnitude = Math.min(0.22, Math.max(0.06, Math.abs(delta) * 0.022));
    const flashColor = delta > 0 ? "#10b981" : "#f43f5e";

    cardControls.start({
      scale: [1, 1 + cardMagnitude, 1],
      boxShadow: [
        "0 10px 22px rgba(0,0,0,0.5)",
        `0 0 36px ${flashColor}, 0 0 14px ${flashColor}`,
        "0 10px 22px rgba(0,0,0,0.5)",
      ],
      transition: { duration: 0.55, ease: "easeOut" },
    });

    numberControls.start({
      scale: [1, 1 + numberMagnitude, 1],
      color: ["#ffffff", flashColor, "#ffffff"],
      textShadow: [
        "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        `0 0 32px ${flashColor}, 0 0 14px ${flashColor}, 0 4px 14px rgba(0,0,0,0.7)`,
        "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
      ],
      transition: { duration: 0.55, ease: "easeOut" },
    });
  }, [value, player.id, role, cardControls, numberControls]);

  const showNumber = !dimmed && value !== null;
  const imageSrc = PLACEHOLDER_CARD_SRC[role];

  return (
    <div className="flex items-center gap-4">
      {/* Card art always renders at full fidelity -- no fog-of-war dim,
          no "?" overlay. Earlier iterations grayscaled the AI's card and
          stamped a "?" on top during selection, but per direction the
          card itself should stay clean and identity-readable; the bare
          big-number readout next to the card carries the fog-of-war
          signal by rendering "?" until lock-in. */}
      <motion.div
        animate={cardControls}
        // Resting state on first paint -- the entry tween (driven by
        // cardControls in useEffect) replays from off-screen-left via
        // explicit keyframe arrays, so this `initial` is purely the
        // failure-mode default if the entry effect is interrupted.
        initial={{
          x: 0,
          opacity: 1,
          scale: 1,
          boxShadow: "0 10px 22px rgba(0,0,0,0.5)",
        }}
        className="relative overflow-hidden bg-slate-900"
        style={{
          width: 140,
          height: 196,
          border: "2px solid rgba(255,255,255,0.85)",
        }}
      >
        <img
          src={imageSrc}
          alt={`${player.name} card`}
          className="w-full h-full object-cover select-none pointer-events-none"
          draggable={false}
        />
      </motion.div>

      {/* Bare MVP-style wordmark next to the card. No chip, no role label,
          no border -- just the digits, white with a strong drop shadow so
          they read against the field. Tabular-nums keeps the digit width
          steady when the orchestrator ticks the value during reveal so
          the number doesn't jitter horizontally. */}
      <motion.span
        animate={numberControls}
        // Resting state on first paint -- see card motion.div above for
        // the rationale. Off-screen entry runs through keyframe arrays in
        // the useEffect, not via `initial`, so a missed effect leaves the
        // number visible rather than stuck at opacity 0.
        initial={{
          x: 0,
          opacity: 1,
          scale: 1,
          color: "#ffffff",
          textShadow:
            "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        }}
        // `inline-block` lets the transform on a span actually paint --
        // inline elements ignore translate/scale, so without this the
        // entry slide-in never animates visibly.
        //
        // Font: intentionally left to inherit the Tailwind default sans
        // stack so this readout matches the big number rendered on each
        // playing card (CardGameOverlay's CardItem `displayValue`). When
        // a card lands and the total ticks, the eye should read both
        // digits as the same typographic family rather than the prior
        // monospace/sans split.
        className="inline-block font-black tabular-nums leading-none select-none"
        style={{
          fontSize: 110,
          letterSpacing: "-0.04em",
          color: "#ffffff",
          textShadow:
            "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        }}
      >
        {showNumber ? value : "?"}
      </motion.span>
    </div>
  );
}
