/**
 * BrawlAttackReveal — Brawl Mode's bespoke reveal sequence.
 *
 * Visual concept: the moment the 5-second snap timer auto-locks, the
 * cards on both sides leap off the hand strip and *fly at the opposing
 * HP pill*, each card dealing damage equal to its power level. Impacts
 * spawn dramatic VFX (sparks, shockwave rings, screen shake) and tick
 * the defender's pill HP downward in real time. Whichever side hits 0
 * HP loses; the winner's leftover HP lands on the existing
 * HitResultBanner via `lastBrawlResolution`.
 *
 * Architecture:
 *   - `useBrawlAttackReveal` owns the *timeline* + *HP state* + *impact
 *     queue*. It schedules the attack waves, ticks the displayed pill
 *     HPs down, queues impact events for the R3F overlay to render,
 *     and signals the parent when the sequence is done.
 *   - `BrawlAttackOverlay` is the JSX side: it mounts the
 *     `BrawlImpactCanvas` (R3F VFX) and renders flying-card DOM ghosts
 *     that arc from each card's hand position to the opposing pill via
 *     Framer Motion. The ghosts read source / target rects off
 *     `data-brawl-card-id` / `data-brawl-pill` anchors the parent sets
 *     on the live hand strip + pills.
 *
 * Why a hybrid DOM + R3F approach: the cards are already richly styled
 * DOM (existing card visuals, fonts, edges, shapes) so animating them
 * via Framer Motion gives the player a 1:1 "their card" experience. The
 * impacts themselves need crisp additive particle blending and
 * shockwave rings -- R3F is the cleanest way to ship that punch.
 *
 * Lifecycle:
 *   - `enabled` flips true when `phase === 'revealing' && gameMode ===
 *     'brawl'`. The hook captures a snapshot of the at-bat state at the
 *     instant it activates and runs its own timeline from there.
 *   - Calls `onComplete` once the final impact lands AND a short
 *     denouement pause expires. The parent wires `onComplete` to
 *     `completeReveal()` so the engine advances to `between-at-bats`.
 *   - Re-running the parent (new at-bat) tears down + rebuilds the
 *     timeline cleanly via the `runId` dep.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { motion, AnimatePresence, useAnimationControls } from "motion/react";
import {
  BrawlImpactCanvas,
  type BrawlImpact,
  type BrawlAura,
} from "./BrawlImpactCanvas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single card committed to attack in this brawl reveal. */
export interface BrawlAttackCard {
  /** Card id; matched against `data-brawl-card-id` to find the source rect. */
  id: string;
  /** Display power. Damage dealt on impact AND used to size the burst. */
  power: number;
  /** Display name (short) so the flying sigil can label the projectile. */
  label?: string;
}

export interface BrawlRevealInput {
  /** True when phase === 'revealing' && gameMode === 'brawl'. */
  enabled: boolean;
  /** Cards on the batter side, in order, that will attack the pitcher pill. */
  batterAttackers: BrawlAttackCard[];
  /** Cards on the pitcher side, in order, that will attack the batter pill. */
  pitcherAttackers: BrawlAttackCard[];
  /** Starting HP for the batter pill (matchup total at lock-in). */
  batterHP: number;
  /** Starting HP for the pitcher pill. */
  pitcherHP: number;
  /**
   * Which side the user holds this at-bat. Drives the user / opponent
   * tagging on each impact (purely a VFX-tint concern -- the damage
   * math itself just deducts attacker power from defender HP).
   */
  userIsBatting: boolean;
  /** True if this is a 21+ HP grand-slam swing; pumps up the VFX intensity. */
  grandSlam: boolean;
  /** Reveal complete callback. Parent wires this to `completeReveal()`. */
  onComplete: () => void;
  /** Fired on every impact so the parent can ping the screen-shake. */
  onImpact?: (power: number, grand: boolean) => void;
  /**
   * A monotonically increasing id for the parent's at-bat. Bump it to
   * force the timeline to tear down + rebuild even if the other inputs
   * happen to round-trip back to the same identity. We use this so two
   * sequential brawl at-bats can't have the second one inherit timers
   * from the first.
   */
  runId: number;
}

/**
 * Which "side" the brawl reveal is currently driving:
 *   - 'idle'    : reveal isn't running
 *   - 'intro'   : both pills shown at full HP, no attacks have launched
 *   - 'user'    : user's cards are flying / impacting the opponent pill
 *   - 'mid'     : pause between user phase and opponent phase
 *   - 'opponent': opponent's cards are flying / impacting the user pill
 *   - 'done'    : all impacts have landed; brief denouement before phase advances
 */
export type BrawlAttackPhase =
  | "idle"
  | "intro"
  | "user"
  | "mid"
  | "opponent"
  | "done";

export interface BrawlRevealOutput {
  /** Live HP shown in the batter pill (decreases as the pitcher attacks). */
  displayedBatterHP: number;
  /** Live HP shown in the pitcher pill (decreases as the batter attacks). */
  displayedPitcherHP: number;
  /** Active impacts the VFX canvas should render. */
  impacts: BrawlImpact[];
  /** Cards currently in flight (DOM ghosts). */
  flying: FlyingCard[];
  /** Floating "-N" numbers spawned at impact. */
  hitNumbers: HitNumber[];
  /** True iff at least one card is mid-arc. Useful for masking other UI. */
  attacking: boolean;
  /**
   * The "phase chip" state the parent UI can show ("Your Attack" /
   * "Opponent's Attack"). Drives the BrawlPhaseBanner inside the
   * overlay. Idle outside of brawl reveal.
   */
  attackPhase: BrawlAttackPhase;
}

interface FlyingCard {
  /** Unique key for the ghost element. */
  key: string;
  /** Source rect (screen-space px, top-left origin). */
  sx: number;
  sy: number;
  /** Target rect (screen-space px). */
  tx: number;
  ty: number;
  /** The original card id (for visual fingerprint -- color tint, label). */
  cardId: string;
  /** Damage this card deals. Shown as a glowing sigil on the ghost. */
  power: number;
  /** Which side launched this attack. Colors the trail / sigil. */
  attacker: "user" | "opponent";
  /** Defender side -- used by the VFX impact event for tinting. */
  defender: "user" | "opponent";
  /** Born timestamp. Drives the framer-motion exit window. */
  bornAt: number;
  /** Display name (or short id) for the source card. */
  label: string;
  /** Per-card flight duration (ms); opponent dives run longer. */
  flightMs: number;
}

interface HitNumber {
  id: string;
  x: number;
  y: number;
  value: number;
  defender: "user" | "opponent";
  bornAt: number;
  grand?: boolean;
}

export interface BrawlShakePulse {
  id: number;
  power: number;
  grand: boolean;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Pause after lock-in before the first card flies (lets the user breathe). */
const ARM_DELAY_MS = 320;
/**
 * Hold time after the pills "snap to full HP" so the player can read both
 * locked-in totals before user's first card launches. The phase banner
 * ("Your Attack") fades in during this window.
 */
const PHASE_INTRO_MS = 750;
/** Gap between sequential cards in the SAME phase (one side's cards). */
const ATTACK_GAP_MS = 320;
/**
 * Pause between user phase ending and opponent phase starting. Long enough
 * for the player to register "their turn is done, mine is starting" via the
 * phase banner color swap, short enough that the reveal doesn't drag.
 */
const MID_PHASE_PAUSE_MS = 650;
/** Pause after the last impact before completeReveal fires. */
const DENOUEMENT_MS = 1000;
/** Card flight time for user-phase projectiles. */
const FLIGHT_MS = 460;
/** Opponent dives travel farther (top strip -> bottom hand); give them
 *  extra air time so the cross-field drop reads clearly. */
const OPPONENT_DIVE_MS = 640;
/** How long an in-flight ghost stays mounted after impact (dissolve). */
const FLIGHT_TAIL_MS = 220;
/** How long a screen-space impact stays in the queue before we GC it. */
const IMPACT_GC_MS = 1100;
/** HP tween duration on the pill side, per impact. */
const HP_TWEEN_MS = 360;
const HIT_NUMBER_LIFETIME_MS = 820;

// ---------------------------------------------------------------------------
// Hook: timeline + state
// ---------------------------------------------------------------------------

export function useBrawlAttackReveal(input: BrawlRevealInput): BrawlRevealOutput {
  const {
    enabled,
    batterAttackers,
    pitcherAttackers,
    batterHP,
    pitcherHP,
    userIsBatting,
    grandSlam,
    onComplete,
    onImpact,
    runId,
  } = input;

  // Latest-prop refs so the timeline effect doesn't fight React.
  const onCompleteRef = useRef(onComplete);
  const onImpactRef = useRef(onImpact);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    onImpactRef.current = onImpact;
  }, [onImpact]);

  const [displayedBatterHP, setDisplayedBatterHP] = useState(batterHP);
  const [displayedPitcherHP, setDisplayedPitcherHP] = useState(pitcherHP);
  const [impacts, setImpacts] = useState<BrawlImpact[]>([]);
  const [flying, setFlying] = useState<FlyingCard[]>([]);
  const [hitNumbers, setHitNumbers] = useState<HitNumber[]>([]);
  const [attackPhase, setAttackPhase] = useState<BrawlAttackPhase>("idle");
  const attackingRef = useRef(false);
  const [attacking, setAttacking] = useState(false);

  useEffect(() => {
    // Reset visual state whenever we leave / re-enter the reveal phase.
    if (!enabled) {
      setDisplayedBatterHP(batterHP);
      setDisplayedPitcherHP(pitcherHP);
      setImpacts([]);
      setFlying([]);
      setHitNumbers([]);
      setAttackPhase("idle");
      attackingRef.current = false;
      setAttacking(false);
      return;
    }

    // Snapshot starting HPs at the moment the reveal starts -- if the
    // store's batterHP / pitcherHP shift later (they shouldn't during
    // reveal, but defensively) we ignore them.
    const startB = batterHP;
    const startP = pitcherHP;
    setDisplayedBatterHP(startB);
    setDisplayedPitcherHP(startP);
    setImpacts([]);
    setFlying([]);
    setHitNumbers([]);
    setAttackPhase("intro");
    attackingRef.current = true;
    setAttacking(true);

    let runningB = startB;
    let runningP = startP;

    // Locate the user / opponent pills + each card's hand rect via the
    // DOM anchors the parent component placed. We capture these
    // *immediately* at reveal start so a later DOM reflow (the cards
    // disappearing as they "fly", for example) can't trash the math.
    const lookup = (selector: string): DOMRect | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return null;
      return el.getBoundingClientRect();
    };
    const userPillRect = lookup('[data-brawl-pill="user"]');
    const opponentPillRect = lookup('[data-brawl-pill="opponent"]');
    const center = (r: DOMRect | null) =>
      r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    const userPill = center(userPillRect);
    const opponentPill = center(opponentPillRect);

    // Defensive fallback: if the pills haven't mounted yet (race), aim
    // at viewport-relative anchors so the timeline still resolves and
    // calls completeReveal. The visual would just be "card flies to
    // mid-screen" instead of "to pill", which is degraded but not
    // broken.
    const userPillFallback = userPill ?? {
      x: window.innerWidth / 2,
      y: window.innerHeight - 160,
    };
    const opponentPillFallback = opponentPill ?? {
      x: window.innerWidth / 2,
      y: 220,
    };

    const cardRectFor = (
      id: string,
      attacker: "user" | "opponent",
    ): { x: number; y: number } => {
      const scope =
        attacker === "user"
          ? '[data-brawl-hand="user"]'
          : '[data-brawl-hand="opponent"]';
      const scoped = lookup(
        `${scope} [data-brawl-card-id="${cssEscape(id)}"]`,
      );
      const pick = (r: DOMRect | null) =>
        r && r.width > 0 && r.height > 0
          ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          : null;
      const fromScoped = pick(scoped);
      if (fromScoped) return fromScoped;
      // Never fall back to an unscoped lookup — shared general-pool ids
      // exist on both strips and querySelector would grab the wrong hand.
      return attacker === "user" ? userPillFallback : opponentPillFallback;
    };

    const pillAt = (side: "user" | "opponent") => {
      const c = center(lookup(`[data-brawl-pill="${side}"]`));
      return side === "user"
        ? (c ?? userPillFallback)
        : (c ?? opponentPillFallback);
    };

    /** Resolve the on-screen pill for a batter/pitcher *seat* (not UI side). */
    const pillForSeat = (seat: "batter" | "pitcher") => {
      const c = center(lookup(`[data-brawl-pill-seat="${seat}"]`));
      if (c) return c;
      const uiSide =
        seat === "batter"
          ? userIsBatting
            ? "user"
            : "opponent"
          : userIsBatting
            ? "opponent"
            : "user";
      return pillAt(uiSide);
    };

    const damagedSeat = (isBatterCard: boolean): "batter" | "pitcher" =>
      isBatterCard ? "pitcher" : "batter";

    const uiSideForSeat = (seat: "batter" | "pitcher"): "user" | "opponent" =>
      seat === "batter"
        ? userIsBatting
          ? "user"
          : "opponent"
        : userIsBatting
          ? "opponent"
          : "user";

    /** Hand-strip center; `bottom` biases toward the lower edge for long dives. */
    const handAt = (
      side: "user" | "opponent",
      depth: "center" | "bottom" = "center",
    ) => {
      const el = document.querySelector<HTMLElement>(
        `[data-brawl-hand="${side}"]`,
      );
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return {
            x: r.left + r.width / 2,
            y:
              depth === "bottom"
                ? r.bottom - Math.min(32, r.height * 0.1)
                : r.top + r.height / 2,
          };
        }
      }
      return pillAt(side);
    };

    /**
     * Ghost flight destination. User cards strike the damaged seat's
     * pill. Opponent cards dive to the user's hand strip at the screen
     * bottom so the cross-field attack reads at full length.
     */
    const attackTarget = (step: {
      attacker: "user" | "opponent";
      isBatterCard: boolean;
    }) => {
      const seat = damagedSeat(step.isBatterCard);
      if (step.attacker === "opponent") {
        return handAt(uiSideForSeat(seat), "bottom");
      }
      return pillForSeat(seat);
    };

    const flightMsFor = (attacker: "user" | "opponent") =>
      attacker === "opponent" ? OPPONENT_DIVE_MS : FLIGHT_MS;

    // Build a SEQUENTIAL attack schedule: user's cards launch first
    // (all in order), then a brief mid-phase pause, then opponent's
    // cards launch (all in order). Previous reveal interleaved sides
    // every other card; playtesters reported they couldn't tell which
    // side was doing what damage. Sequential by side makes the
    // narrative obvious: "first I attack their HP bar, then they
    // attack mine."
    //
    // Mapping from "batter / pitcher seat" -> "user / opponent VFX
    // tint" comes from `userIsBatting`. The damage math is unchanged:
    // batter-seat cards deplete pitcher HP, pitcher-seat cards deplete
    // batter HP, regardless of who attacks first visually.
    interface Step {
      tMs: number;
      /** "user" if it's the user's card flying out; otherwise "opponent". */
      attacker: "user" | "opponent";
      /** Which pill takes the hit. */
      defender: "user" | "opponent";
      card: BrawlAttackCard;
      /** True if this card belongs to the batter seat (deducts pitcher HP).
       *  False -> pitcher seat card (deducts batter HP). */
      isBatterCard: boolean;
    }
    const steps: Step[] = [];

    // Resolve which queue maps to "user" vs "opponent" based on the
    // current seat. The user phase always plays first regardless of
    // whether the user is batting or pitching this at-bat.
    const userPhaseQueue = userIsBatting ? batterAttackers : pitcherAttackers;
    const opponentPhaseQueue = userIsBatting ? pitcherAttackers : batterAttackers;
    // `isBatterCard` is true when the queue belongs to the batter
    // seat -- batter cards always damage the pitcher pill.
    const userPhaseIsBatterSeat = userIsBatting;
    const opponentPhaseIsBatterSeat = !userIsBatting;

    let cursor = ARM_DELAY_MS + PHASE_INTRO_MS;
    const userPhaseStartMs = cursor;

    // ---- Phase 1: user's cards attack opponent's pill -----------------
    for (const card of userPhaseQueue) {
      steps.push({
        tMs: cursor,
        attacker: "user",
        defender: "opponent",
        card,
        isBatterCard: userPhaseIsBatterSeat,
      });
      cursor += ATTACK_GAP_MS;
    }
    // Last user-phase impact lands at (last launch + FLIGHT_MS). Move
    // cursor past that impact, then add the mid-phase pause so the
    // banner has time to swap from "Your Attack" -> "Opponent's
    // Attack" before the first opponent ghost lifts off.
    const lastUserLaunchMs = cursor - ATTACK_GAP_MS;
    const userPhaseEndMs =
      userPhaseQueue.length > 0 ? lastUserLaunchMs + FLIGHT_MS : userPhaseStartMs;
    cursor = userPhaseEndMs + MID_PHASE_PAUSE_MS;
    const opponentPhaseStartMs = cursor;

    // ---- Phase 2: opponent's cards attack user's pill -----------------
    for (const card of opponentPhaseQueue) {
      steps.push({
        tMs: cursor,
        attacker: "opponent",
        defender: "user",
        card,
        isBatterCard: opponentPhaseIsBatterSeat,
      });
      cursor += ATTACK_GAP_MS;
    }
    const lastOpponentLaunchMs = cursor - ATTACK_GAP_MS;
    const opponentPhaseEndMs =
      opponentPhaseQueue.length > 0
        ? lastOpponentLaunchMs + OPPONENT_DIVE_MS
        : opponentPhaseStartMs;

    // Schedule the phase-banner transitions independent of any
    // individual step timer so the banner colors swap cleanly even if
    // a phase has zero attackers (e.g. the user has an empty hand,
    // which shouldn't happen in real brawl but is defensive).
    const phaseSchedule: Array<{ at: number; to: BrawlAttackPhase }> = [];
    if (userPhaseQueue.length > 0) {
      phaseSchedule.push({ at: userPhaseStartMs, to: "user" });
    }
    if (opponentPhaseQueue.length > 0) {
      phaseSchedule.push({ at: userPhaseEndMs, to: "mid" });
      phaseSchedule.push({ at: opponentPhaseStartMs, to: "opponent" });
    }
    phaseSchedule.push({ at: opponentPhaseEndMs, to: "done" });

    // Precompute step metadata; source/target rects are resolved when each
    // step fires so opponent cards (which flip face-up at reveal start)
    // and pill positions stay accurate after layout settles.
    const precomputed = steps.map((step, i) => ({ ...step, i }));

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Fire the phase-banner transitions. Each scheduled change just
    // flips the React state -- the BrawlPhaseBanner reads `attackPhase`
    // and animates its own copy in / out from that.
    for (const change of phaseSchedule) {
      timers.push(setTimeout(() => setAttackPhase(change.to), change.at));
    }

    // Garbage-collect old impacts so the array doesn't grow without
    // bound. We could just rely on the canvas's per-impact `bornAt`
    // ttl, but trimming React state keeps reconciliation light.
    const gcImpacts = () => {
      const now = performance.now();
      setImpacts((prev) =>
        prev.filter((i) => now - i.bornAt < IMPACT_GC_MS),
      );
    };

    const lastStepIndex = steps.length - 1;

    for (const step of precomputed) {
      timers.push(
        setTimeout(() => {
          const src = cardRectFor(step.card.id, step.attacker);
          const dst = attackTarget(step);
          const impactAt = pillForSeat(damagedSeat(step.isBatterCard));
          const defenderUi = uiSideForSeat(damagedSeat(step.isBatterCard));

          // Spawn ghost card flying source -> dst.
          const ghostKey = `${runId}-${step.card.id}-${step.tMs}`;
          const stepFlightMs = flightMsFor(step.attacker);
          const ghost: FlyingCard = {
            key: ghostKey,
            sx: src.x,
            sy: src.y,
            tx: dst.x,
            ty: dst.y,
            cardId: step.card.id,
            power: step.card.power,
            attacker: step.attacker,
            defender: defenderUi,
            bornAt: performance.now(),
            label: step.card.label ?? step.card.id,
            flightMs: stepFlightMs,
          };
          setFlying((prev) => [...prev, ghost]);

          // Schedule the impact event for the moment the ghost lands.
          timers.push(
            setTimeout(() => {
              // Deplete the defender's HP. Floor at 0 -- the side that
              // hits 0 first stays at 0 even if more attacks land.
              // Damage routing is by *seat* (batter / pitcher), not by
              // VFX tint -- a batter-side card always hits pitcher HP.
              const damage = Math.max(0, step.card.power);
              if (step.isBatterCard) {
                runningP = Math.max(0, runningP - damage);
                tweenHP(runningP, HP_TWEEN_MS, setDisplayedPitcherHP);
              } else {
                runningB = Math.max(0, runningB - damage);
                tweenHP(runningB, HP_TWEEN_MS, setDisplayedBatterHP);
              }

              const impactPayload: BrawlImpact = {
                id: ghostKey,
                x: impactAt.x,
                y: impactAt.y,
                power: step.card.power,
                bornAt: performance.now(),
                defender: defenderUi,
                grand: grandSlam && step.i === lastStepIndex,
              };
              setImpacts((prev) => [...prev, impactPayload]);
              const hitNumber: HitNumber = {
                id: `${ghostKey}-hit`,
                x: impactAt.x,
                y: impactAt.y,
                value: damage,
                defender: defenderUi,
                bornAt: performance.now(),
                grand: impactPayload.grand,
              };
              setHitNumbers((prev) => [...prev, hitNumber]);
              onImpactRef.current?.(step.card.power, !!impactPayload.grand);

              // Despawn the ghost after a short dissolve window.
              timers.push(
                setTimeout(() => {
                  setFlying((prev) => prev.filter((f) => f.key !== ghostKey));
                  gcImpacts();
                }, FLIGHT_TAIL_MS),
              );
              timers.push(
                setTimeout(() => {
                  setHitNumbers((prev) => prev.filter((n) => n.id !== `${ghostKey}-hit`));
                }, HIT_NUMBER_LIFETIME_MS),
              );
            }, stepFlightMs),
          );
        }, step.tMs),
      );
    }

    // Wrap-up timer: opponentPhaseEndMs is when the last impact lands.
    // Add a brief dissolve + denouement before completeReveal flips the
    // phase forward so the player gets a beat to see the final pill HP.
    const totalMs =
      opponentPhaseEndMs + FLIGHT_TAIL_MS + DENOUEMENT_MS;
    timers.push(
      setTimeout(() => {
        attackingRef.current = false;
        setAttacking(false);
        onCompleteRef.current();
      }, totalMs),
    );

    return () => {
      for (const t of timers) clearTimeout(t);
      attackingRef.current = false;
      setAttacking(false);
    };
  }, [enabled, runId, batterAttackers, pitcherAttackers, batterHP, pitcherHP, userIsBatting, grandSlam]);

  return {
    displayedBatterHP,
    displayedPitcherHP,
    impacts,
    flying,
    hitNumbers,
    attacking,
    attackPhase,
  };
}

// ---------------------------------------------------------------------------
// Tween helper — animate a numeric state down to `target` over `durationMs`.
// ---------------------------------------------------------------------------

function tweenHP(
  target: number,
  durationMs: number,
  setter: Dispatch<SetStateAction<number>>,
) {
  let start: number | null = null;
  let raf = 0;
  // Sample the current value lazily via a setter closure -- we kick
  // tweens off every impact and they shouldn't fight each other (the
  // most recent tween always wins because React batches setter calls).
  let from: number | null = null;
  const step = (ts: number) => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 2);
    setter((prev) => {
      if (from === null) from = prev;
      const next = from + (target - from) * eased;
      return next;
    });
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  // We don't expose cancellation -- new tweens overwrite the React
  // setter ordering naturally. `raf` is held in closure only for the
  // lifetime of this tween.
  void raf;
}

// ---------------------------------------------------------------------------
// CSS escape helper -- card ids are usually safe but we'll be defensive
// (a leading digit or punctuation in an id would break the selector).
// ---------------------------------------------------------------------------

function cssEscape(s: string): string {
  // CSS.escape is widely supported; we polyfill very conservatively for
  // the small chance we're running in an old test runner without it.
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// JSX shell: mounts the R3F canvas + the flying-card ghosts.
// ---------------------------------------------------------------------------

export function BrawlAttackOverlay({
  impacts,
  flying,
  auras,
  hitNumbers,
  shakePulse,
  attackPhase,
}: {
  impacts: BrawlImpact[];
  flying: FlyingCard[];
  auras: BrawlAura[];
  hitNumbers: HitNumber[];
  shakePulse: BrawlShakePulse;
  attackPhase: BrawlAttackPhase;
}) {
  const shake = useAnimationControls();
  const lastShake = useRef(0);
  useEffect(() => {
    if (shakePulse.id === 0 || shakePulse.id === lastShake.current) return;
    lastShake.current = shakePulse.id;
    const dir = shakePulse.id % 2 === 0 ? 1 : -1;
    const mag = Math.min(
      26,
      6 + Math.max(0, shakePulse.power) * 0.65 + (shakePulse.grand ? 8 : 0),
    );
    void shake.start({
      x: [0, dir * mag, -dir * mag * 0.72, dir * mag * 0.28, 0],
      y: [0, -mag * 0.35, mag * 0.24, -mag * 0.14, 0],
      transition: { duration: 0.34, ease: [0.24, 0.8, 0.24, 1] },
    });
  }, [shakePulse, shake]);

  return (
    <motion.div
      className="fixed inset-0 z-[53] pointer-events-none"
      initial={false}
      animate={shake}
    >
      <BrawlImpactCanvas impacts={impacts} auras={auras} />
      <FlyingCardLayer flying={flying} />
      <HitNumberLayer numbers={hitNumbers} />
      <BrawlPhaseBanner phase={attackPhase} />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Phase banner — center-of-screen chip that calls out which side is
// currently attacking. Driven by `attackPhase` so the colors swap
// cleanly between user (amber) and opponent (rose) phases without any
// extra parent state.
// ---------------------------------------------------------------------------

function BrawlPhaseBanner({ phase }: { phase: BrawlAttackPhase }) {
  const config =
    phase === "intro"
      ? {
          label: "Locked In",
          chip:
            "bg-slate-700/85 text-slate-100 border-slate-400/60 shadow-slate-500/25",
          glow: "0 0 18px rgba(148,163,184,0.35)",
        }
      : phase === "mid"
        ? {
            label: "Switching Sides",
            chip:
              "bg-violet-600/80 text-violet-50 border-violet-300/70 shadow-violet-400/30",
            glow: "0 0 18px rgba(167,139,250,0.4)",
          }
        : phase === "user"
          ? {
              label: "Your Cards Attack",
              chip:
                "bg-amber-500/85 text-amber-50 border-amber-200/80 shadow-amber-400/35",
              glow: "0 0 24px rgba(251,191,36,0.45)",
            }
          : phase === "opponent"
            ? {
                label: "Opponent's Cards Attack",
                chip:
                  "bg-rose-500/85 text-rose-50 border-rose-200/80 shadow-rose-400/35",
                glow: "0 0 24px rgba(244,63,94,0.45)",
              }
            : null;

  return (
    <div
      className="absolute inset-x-0 top-1/2 -translate-y-[60%] z-[55] pointer-events-none flex justify-center"
      aria-hidden="true"
    >
      <AnimatePresence mode="wait">
        {config && (
          <motion.div
            key={phase}
            initial={{ opacity: 0, scale: 0.7, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.7, y: -8 }}
            transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
            className={`px-5 py-2 rounded-full border-2 backdrop-blur-sm text-sm font-black uppercase tracking-[0.22em] shadow-2xl ${config.chip}`}
            style={{ boxShadow: config.glow }}
          >
            {config.label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOM ghost cards (Framer Motion) flying from source rect to target rect.
// ---------------------------------------------------------------------------

function FlyingCardLayer({ flying }: { flying: FlyingCard[] }) {
  // Pointer-events: none so the ghosts never block the cards underneath
  // (and the pills the user might be staring at). Fixed positioning so
  // we can pass viewport-space coordinates straight in. Sits one layer
  // above the R3F impact canvas so the flying card silhouette reads
  // clearly against the shockwave burst.
  return (
    <div
      className="absolute inset-0 z-[52] pointer-events-none"
      aria-hidden="true"
    >
      <AnimatePresence>
        {flying.map((card) => (
          <FlyingCard key={card.key} card={card} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function FlyingCard({ card }: { card: FlyingCard }) {
  // Translate the rect-center coordinates into a Framer Motion
  // initial/animate pair. We compute a control offset so the card arcs
  // upward through the field instead of cutting flat across the screen
  // -- arcs read way more "attacking" than a straight glide.
  const dx = card.tx - card.sx;
  const dy = card.ty - card.sy;
  const distance = Math.hypot(dx, dy);
  const diveDown = card.attacker === "opponent" && dy > 0;
  const arcLift = diveDown
    ? Math.max(80, distance * 0.2 + Math.abs(dx) * 0.1)
    : Math.max(48, distance * 0.14 + Math.abs(dx) * 0.06);
  const midX =
    card.sx + dx * 0.5 + (dx >= 0 ? 1 : -1) * arcLift * (diveDown ? 0.42 : 0.32);
  // When the target sits below the source (opponent diving down-field),
  // bow through the middle of the drop — never lift above the source,
  // which read as "attacking upward / themselves" in playtests.
  const midY = diveDown
    ? card.sy + dy * 0.62
    : dy > 0
      ? card.sy + dy * 0.46
      : Math.min(card.sy, card.ty) - arcLift;
  const flightDuration = (card.flightMs + 200) / 1000;

  // The Framer waypoints are absolute viewport pixels but we render the
  // card with translate from the rect's top-left. To keep the card
  // centered on the path we offset by half its width/height.
  const cardW = 84;
  const cardH = 112;
  const halfW = cardW / 2;
  const halfH = cardH / 2;

  // Color flavor: the user's outgoing attacks are amber, opponent's are
  // rose. Mirrors the BrawlImpactCanvas tinting so the ghost + impact
  // burst read as one continuous strike.
  const tone =
    card.attacker === "user"
      ? {
          border: "border-amber-300/80",
          bg: "from-amber-500/80 via-amber-600/70 to-orange-700/80",
          glow: "0 0 24px rgba(251,191,36,0.55), 0 0 60px rgba(251,191,36,0.35)",
          ring: "ring-amber-200/70",
          text: "text-amber-50",
        }
      : {
          border: "border-rose-300/80",
          bg: "from-rose-500/80 via-rose-600/70 to-red-700/80",
          glow: "0 0 24px rgba(244,63,94,0.55), 0 0 60px rgba(244,63,94,0.35)",
          ring: "ring-rose-200/70",
          text: "text-rose-50",
        };

  return (
    <motion.div
      // Absolutely positioned at the source center, then animated along
      // the three waypoints. We translate by negative half-size in CSS
      // so the (x,y) coordinate stays on the *center* of the card.
      style={{ position: "absolute", left: 0, top: 0, willChange: "transform" }}
      initial={{
        x: card.sx - halfW,
        y: card.sy - halfH,
        scale: 0.6,
        rotate: card.attacker === "user" ? -8 : 8,
        opacity: 0.95,
      }}
      animate={{
        x: [card.sx - halfW, midX - halfW, card.tx - halfW],
        y: [card.sy - halfH, midY - halfH, card.ty - halfH],
        scale: [0.78, 1.18, 0.85],
        rotate: [
          card.attacker === "user" ? -8 : 8,
          card.attacker === "user" ? 18 : -18,
          card.attacker === "user" ? 40 : -40,
        ],
        opacity: [0.95, 1, 0],
        transition: {
          duration: flightDuration,
          times: [0, 0.72, 1],
          ease: diveDown ? [0.22, 0.03, 0.26, 1] : [0.4, 0, 0.2, 1],
        },
      }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
    >
      <div
        className={`relative w-[84px] h-[112px] rounded-xl border-2 ${tone.border} ring-2 ${tone.ring} bg-gradient-to-br ${tone.bg} backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.55)] flex flex-col items-center justify-center select-none`}
        style={{ boxShadow: tone.glow }}
      >
        {/* Glyph: stylized strike emoji + the card id stub in tiny type
            (no real card art, just a "this came from card X" hint). */}
        <span
          className={`text-[42px] leading-none font-black ${tone.text} drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]`}
          style={{ textShadow: "0 0 12px rgba(255,255,255,0.5)" }}
        >
          {card.power}
        </span>
        <span
          className={`mt-1 text-[7px] font-black uppercase tracking-[0.24em] ${tone.text} opacity-90 max-w-[74px] text-center truncate`}
        >
          {card.label}
        </span>
        {/* Comet streak behind the card -- a thin gradient that trails
            outward to fake the motion blur Drei's <Trail> would give
            us in 3D. Sits underneath the card body via z-[-1]. */}
        <div
          aria-hidden="true"
          className="absolute -z-10 inset-0 rounded-xl blur-md"
          style={{
            background:
              card.attacker === "user"
                ? "radial-gradient(ellipse, rgba(251,191,36,0.45), transparent 70%)"
                : "radial-gradient(ellipse, rgba(244,63,94,0.45), transparent 70%)",
          }}
        />
      </div>
    </motion.div>
  );
}

function HitNumberLayer({ numbers }: { numbers: HitNumber[] }) {
  return (
    <div className="absolute inset-0 z-[54] pointer-events-none" aria-hidden="true">
      <AnimatePresence>
        {numbers.map((n) => (
          <motion.div
            key={n.id}
            className={`absolute -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded-md border text-xs font-black tracking-[0.14em] ${
              n.defender === "user"
                ? "bg-rose-500/85 border-rose-200/80 text-rose-50"
                : "bg-amber-500/85 border-amber-200/80 text-amber-50"
            }`}
            style={{ left: n.x, top: n.y }}
            initial={{ y: 0, opacity: 0, scale: 0.72 }}
            animate={{ y: -42, opacity: 1, scale: n.grand ? 1.18 : 1 }}
            exit={{ y: -68, opacity: 0, scale: 0.82 }}
            transition={{ duration: 0.62, ease: [0.2, 0.82, 0.2, 1] }}
          >
            -{n.value}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
