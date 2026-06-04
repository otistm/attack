/**
 * BrawlAttackReveal — continuous element brawl combat after lock-in.
 *
 * Both sides fire on independent cooldown timers (5s base, −1s per extra
 * card in the longest affirmed chain), cycling their bond list until one
 * HP pill hits 0. HP and shield update instantly on each bond resolve;
 * projectiles are cosmetic streaks (shield/heal bonds skip the projectile).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence, useAnimationControls } from "motion/react";
import {
  BrawlImpactCanvas,
  type BrawlImpact,
  type BrawlAura,
} from "./BrawlImpactCanvas";
import type { Element } from "../../lib/brawlElements";
import { applyElementCombatHit } from "../../lib/elementAbilities";
import {
  ELEMENT_LABEL,
  brawlCardOverlayCooldownMs,
  FREEZE_COOLDOWN_PAUSE_MS,
  consumeAttackerFreeze,
  isSelfBuffBond,
  tickCombatDotStacks,
  BRAWL_DOT_TICK_MS,
  freshElementCombatState,
  type ElementBond,
  type ElementCombatState,
} from "../../lib/brawlElements";
import {
  applySandstormTick,
  BRAWL_SANDSTORM_TICK_MS,
  BRAWL_SANDSTORM_WARNING_MS,
  shouldActivateSandstorm,
} from "../../lib/brawlSandstorm";
import {
  buildCombatReport,
  logCardCombatEvent,
  logDotTickEvents,
  logSandstormEvent,
  type BrawlCombatEvent,
  type BrawlCombatReport,
} from "../../lib/brawlCombatLog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single card committed to attack in this brawl reveal. */
export interface BrawlAttackCard {
  /** Left card id; matched against `data-brawl-card-id` for the projectile origin. */
  id: string;
  /** Right card in the bond when an element connection applies. */
  rightCardId?: string;
  /** Display power. Shown on impact. */
  power: number;
  /** Display name (short) for impact floaters. */
  label?: string;
  /** Element brawl: bond element (fire/poison/freeze/shield/heal). */
  element?: Element;
  /** Right-hand bond partner — skips its own attack when the chain fires. */
  skipAttack?: boolean;
  /** Affirmed group size — freeze chip = power (solo) or power − N (chain). */
  combineCount?: number;
  /** Catalog ids in the attacker's locked hand (Oil Flask). */
  attackerHandCatalogIds?: readonly string[];
}

export interface BrawlRevealInput {
  /** True when phase === 'revealing' && gameMode === 'brawl'. */
  enabled: boolean;
  /** Element brawl: bond-based attacks instead of chain HP scaling. */
  elementMode?: boolean;
  /** Element brawl: persist combat + battle log when the reveal finishes. */
  onCombatResolved?: (combat: ElementCombatState, report: BrawlCombatReport) => void;
  /** Element brawl: combat snapshot at lock-in for incremental resolution. */
  elementCombatStart?: ElementCombatState;
  /** Ms between attack waves for the user's side (chain-reduced). */
  userAttackCooldownMs?: number;
  /** Ms between attack waves for the opponent's side. */
  opponentAttackCooldownMs?: number;
  /** Catalog ids in the user's locked hand. */
  userHandCatalogIds?: readonly string[];
  /** Catalog ids in the opponent's locked hand. */
  opponentHandCatalogIds?: readonly string[];
  /** Connected attack groups on the batter side (each group shares cooldown). */
  batterAttackGroups: BrawlAttackCard[][];
  /** Connected attack groups on the pitcher side. */
  pitcherAttackGroups: BrawlAttackCard[][];
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
  /**
   * Ms to wait after reveal starts for the CPU hand deal-in (face-up entry)
   * before Player 1's attack phase begins.
   */
  opponentRevealDelayMs: number;
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
  | "combat"
  | "done";

export interface BrawlRevealOutput {
  /** Live HP shown in the batter pill. */
  displayedBatterHP: number;
  /** Live HP shown in the pitcher pill. */
  displayedPitcherHP: number;
  /** Shield absorb on the batter seat pill. */
  displayedBatterShield: number;
  /** Shield absorb on the pitcher seat pill. */
  displayedPitcherShield: number;
  /** Burn stack on batter / pitcher pills. */
  displayedBatterBurn: number;
  displayedPitcherBurn: number;
  displayedBatterPoison: number;
  displayedPitcherPoison: number;
  /** Incremented when heal lands on each seat — drives pill burst VFX. */
  displayedBatterHealPulse: number;
  displayedPitcherHealPulse: number;
  /** Active impacts the VFX canvas should render. */
  impacts: BrawlImpact[];
  /** Active projectiles in flight (DOM streaks). */
  projectiles: BrawlProjectile[];
  /** @deprecated Use `projectiles`. Kept for callers that haven't migrated. */
  flying: BrawlProjectile[];
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
  /** Per-card cooldown fill — keyed by card id after each bond fires. */
  cardCooldowns: Record<string, CardCooldownPulse>;
  /** True once sandstorm damage ticks are running. */
  sandstormActive: boolean;
  /** Current sandstorm tick index (ramps damage). */
  sandstormTickIndex: number;
}

/** Drives the bottom-up cooldown fill on a card after it fires. */
export interface CardCooldownPulse {
  /** Bump to restart the CSS fill animation. */
  pulseKey: number;
  /** Ms shown on the card overlay — one side slot (~5s), not full rotation. */
  durationMs: number;
  side: "user" | "opponent";
  /** True while this card's cooldown timer is paused by freeze. */
  frozen?: boolean;
}

interface BrawlProjectile {
  /** Unique key for the projectile element. */
  key: string;
  /** Source rect (screen-space px, top-left origin). */
  sx: number;
  sy: number;
  /** Target rect (screen-space px). */
  tx: number;
  ty: number;
  /** The source card id (for DOM lookup). */
  cardId: string;
  /** Bond power shown on impact. */
  power: number;
  /** Which side launched this attack. Colors the trail. */
  attacker: "user" | "opponent";
  /** Defender side -- used by the VFX impact event for tinting. */
  defender: "user" | "opponent";
  /** Born timestamp. */
  bornAt: number;
  /** Element label for impact floaters. */
  label: string;
  /** Element tint for the projectile streak. */
  element?: Element;
  /** Flight duration (ms). */
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
  label?: string;
  /** Sandstorm ticks use a shared warm tint on both pills. */
  variant?: "sandstorm";
}

export interface BrawlShakePulse {
  id: number;
  power: number;
  grand: boolean;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Pause after lock-in before the first projectile fires. */
const ARM_DELAY_MS = 320;
/** Hold time after pills snap to full HP before the first projectile. */
const PHASE_INTRO_MS = 750;
/** Brief beat after a KO before the phase advances. */
const DENOUEMENT_MS = 800;
/** Cosmetic projectile flight (HP updates immediately on launch). */
const PROJECTILE_MS = 280;
/** How long a screen-space impact stays in the queue before we GC it. */
const IMPACT_GC_MS = 1100;
const HIT_NUMBER_LIFETIME_MS = 820;
/** How long a projectile stays mounted after impact (dissolve). */
const PROJECTILE_TAIL_MS = 180;

// ---------------------------------------------------------------------------
// Hook: timeline + state
// ---------------------------------------------------------------------------

export function useBrawlAttackReveal(input: BrawlRevealInput): BrawlRevealOutput {
  const { enabled, batterHP, pitcherHP, runId } = input;

  // Latest-prop refs so the timeline effect doesn't fight React re-renders.
  const inputRef = useRef(input);
  inputRef.current = input;
  const onCompleteRef = useRef(input.onComplete);
  const onImpactRef = useRef(input.onImpact);
  const onCombatResolvedRef = useRef(input.onCombatResolved);
  useEffect(() => {
    onCompleteRef.current = input.onComplete;
  }, [input.onComplete]);
  useEffect(() => {
    onImpactRef.current = input.onImpact;
  }, [input.onImpact]);
  useEffect(() => {
    onCombatResolvedRef.current = input.onCombatResolved;
  }, [input.onCombatResolved]);

  const [displayedBatterHP, setDisplayedBatterHP] = useState(batterHP);
  const [displayedPitcherHP, setDisplayedPitcherHP] = useState(pitcherHP);
  const [displayedBatterShield, setDisplayedBatterShield] = useState(0);
  const [displayedPitcherShield, setDisplayedPitcherShield] = useState(0);
  const [displayedBatterBurn, setDisplayedBatterBurn] = useState(0);
  const [displayedPitcherBurn, setDisplayedPitcherBurn] = useState(0);
  const [displayedBatterPoison, setDisplayedBatterPoison] = useState(0);
  const [displayedPitcherPoison, setDisplayedPitcherPoison] = useState(0);
  const [displayedBatterHealPulse, setDisplayedBatterHealPulse] = useState(0);
  const [displayedPitcherHealPulse, setDisplayedPitcherHealPulse] = useState(0);
  const [impacts, setImpacts] = useState<BrawlImpact[]>([]);
  const [projectiles, setProjectiles] = useState<BrawlProjectile[]>([]);
  const [hitNumbers, setHitNumbers] = useState<HitNumber[]>([]);
  const [attackPhase, setAttackPhase] = useState<BrawlAttackPhase>("idle");
  const [cardCooldowns, setCardCooldowns] = useState<
    Record<string, CardCooldownPulse>
  >({});
  const [sandstormActive, setSandstormActive] = useState(false);
  const [sandstormTickIndex, setSandstormTickIndex] = useState(0);
  const attackingRef = useRef(false);
  const [attacking, setAttacking] = useState(false);

  useEffect(() => {
    const snap = inputRef.current;

    // Reset visual state whenever we leave / re-enter the reveal phase.
    if (!enabled) {
      setDisplayedBatterHP(snap.batterHP);
      setDisplayedPitcherHP(snap.pitcherHP);
      setDisplayedBatterShield(0);
      setDisplayedPitcherShield(0);
      setDisplayedBatterBurn(0);
      setDisplayedPitcherBurn(0);
      setDisplayedBatterPoison(0);
      setDisplayedPitcherPoison(0);
      setDisplayedBatterHealPulse(0);
      setDisplayedPitcherHealPulse(0);
      setImpacts([]);
      setProjectiles([]);
      setHitNumbers([]);
      setAttackPhase("idle");
      setCardCooldowns({});
      setSandstormActive(false);
      setSandstormTickIndex(0);
      attackingRef.current = false;
      setAttacking(false);
      return;
    }

    const {
      batterAttackGroups,
      pitcherAttackGroups,
      batterHP: startB,
      pitcherHP: startP,
      userIsBatting,
      opponentRevealDelayMs,
      elementCombatStart,
      userAttackCooldownMs = 5000,
      opponentAttackCooldownMs = 5000,
    } = snap;

    setDisplayedBatterHP(startB);
    setDisplayedPitcherHP(startP);
    setDisplayedBatterShield(0);
    setDisplayedPitcherShield(0);
    setDisplayedBatterBurn(0);
    setDisplayedPitcherBurn(0);
    setDisplayedBatterPoison(0);
    setDisplayedPitcherPoison(0);
    setDisplayedBatterHealPulse(0);
    setDisplayedPitcherHealPulse(0);
    setImpacts([]);
    setProjectiles([]);
    setHitNumbers([]);
    setAttackPhase("intro");
    setCardCooldowns({});
    setSandstormActive(false);
    setSandstormTickIndex(0);
    attackingRef.current = true;
    setAttacking(true);

    let combat: ElementCombatState = elementCombatStart
      ? { ...freshElementCombatState(), ...elementCombatStart }
      : {
          ...freshElementCombatState(),
          playerHP: userIsBatting ? startB : startP,
          cpuHP: userIsBatting ? startP : startB,
        };

    const combatStartSnapshot: ElementCombatState = { ...combat };
    const combatEvents: BrawlCombatEvent[] = [];
    let sandstormTickCount = 0;

    const applyHitAndLog = (
      before: ElementCombatState,
      card: BrawlAttackCard,
      isUser: boolean,
    ): ElementCombatState => {
      const input = inputRef.current;
      const attackerHandCatalogIds = isUser
        ? input.userHandCatalogIds ?? []
        : input.opponentHandCatalogIds ?? [];
      const after = applyElementCombatHit(
        before,
        {
          element: card.element,
          power: card.power,
          leftCardId: card.id,
          rightCardId: card.rightCardId,
          combineCount: card.combineCount,
          attackerHandCatalogIds,
        },
        isUser,
      );
      combatEvents.push(
        logCardCombatEvent(before, after, {
          cardId: card.id,
          rightCardId: card.rightCardId,
          power: card.power,
          element: card.element,
          label: card.label,
          attackerIsPlayer: isUser,
        }),
      );
      return after;
    };

    const userAttackGroups = userIsBatting
      ? batterAttackGroups
      : pitcherAttackGroups;
    const opponentAttackGroups = userIsBatting
      ? pitcherAttackGroups
      : batterAttackGroups;

    const pulseHealOnSeat = (seat: "batter" | "pitcher") => {
      if (seat === "batter") {
        setDisplayedBatterHealPulse((n) => n + 1);
      } else {
        setDisplayedPitcherHealPulse((n) => n + 1);
      }
    };

    let combatOver = false;
    let sideTick = 0;

    const lookup = (selector: string): DOMRect | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return null;
      return el.getBoundingClientRect();
    };
    const center = (r: DOMRect | null) =>
      r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;

    const userPillFallback = {
      x: window.innerWidth / 2,
      y: window.innerHeight - 160,
    };
    const opponentPillFallback = {
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
      return attacker === "user" ? userPillFallback : opponentPillFallback;
    };

    const pillAt = (side: "user" | "opponent") => {
      const c = center(lookup(`[data-brawl-pill="${side}"]`));
      return side === "user"
        ? (c ?? userPillFallback)
        : (c ?? opponentPillFallback);
    };

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

    const uiSideForSeat = (seat: "batter" | "pitcher"): "user" | "opponent" =>
      seat === "batter"
        ? userIsBatting
          ? "user"
          : "opponent"
        : userIsBatting
          ? "opponent"
          : "user";

    const gcImpacts = () => {
      const now = performance.now();
      setImpacts((prev) =>
        prev.filter((i) => now - i.bornAt < IMPACT_GC_MS),
      );
    };

    const isCombatOver = () =>
      combat.playerHP <= 0 || combat.cpuHP <= 0;

    const timers: ReturnType<typeof setTimeout>[] = [];

    const endCombat = () => {
      if (combatOver) return;
      combatOver = true;
      setAttackPhase("done");
      timers.push(
        setTimeout(() => {
          attackingRef.current = false;
          setAttacking(false);
          onCombatResolvedRef.current?.(
            combat,
            buildCombatReport(
              combatStartSnapshot,
              combat,
              combatEvents,
              sandstormTickCount,
            ),
          );
          onCompleteRef.current();
        }, DENOUEMENT_MS),
      );
    };

    let combatSteps = 0;
    const maxCombatSteps =
      Math.max(
        400,
        (userAttackGroups.length + opponentAttackGroups.length) * 200,
      );

    const cardPauseUntil: Record<string, number> = {};
    let lastFreezeOnPlayer = combat.freezeOnPlayer;
    let lastFreezeOnCpu = combat.freezeOnCpu;

    const isCardCooldownPaused = (cardId: string) =>
      performance.now() < (cardPauseUntil[cardId] ?? 0);

    const isGroupCooldownPaused = (group: BrawlAttackCard[]) =>
      group.some((card) => isCardCooldownPaused(card.id));

    const attackableCardIds = (groups: BrawlAttackCard[][]) => {
      const ids: string[] = [];
      for (const group of groups) {
        for (const card of group) {
          if (!card.skipAttack) ids.push(card.id);
        }
      }
      return ids;
    };

    const pickRandomCardId = (groups: BrawlAttackCard[][]) => {
      const ids = attackableCardIds(groups);
      if (ids.length === 0) return null;
      return ids[Math.floor(Math.random() * ids.length)] ?? null;
    };

    const pauseCardCooldown = (cardId: string) => {
      const now = performance.now();
      cardPauseUntil[cardId] = Math.max(cardPauseUntil[cardId] ?? 0, now) +
        FREEZE_COOLDOWN_PAUSE_MS;
    };

    const noteFreezeApplied = (state: ElementCombatState) => {
      if (state.freezeOnPlayer > lastFreezeOnPlayer) {
        const cardId = pickRandomCardId(userAttackGroups);
        if (cardId) pauseCardCooldown(cardId);
      }
      if (state.freezeOnCpu > lastFreezeOnCpu) {
        const cardId = pickRandomCardId(opponentAttackGroups);
        if (cardId) pauseCardCooldown(cardId);
      }
      lastFreezeOnPlayer = state.freezeOnPlayer;
      lastFreezeOnCpu = state.freezeOnCpu;
    };

    const syncCardCooldownOverlays = () => {
      setCardCooldowns((prev) => {
        if (Object.keys(prev).length === 0) return prev;
        let changed = false;
        const next = { ...prev };
        for (const [id, pulse] of Object.entries(prev)) {
          const frozen = isCardCooldownPaused(id) && pulse.durationMs > 0;
          if (pulse.frozen !== frozen) {
            next[id] = { ...pulse, frozen };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const syncDisplayInstant = (state: ElementCombatState) => {
      const batterHp = userIsBatting ? state.playerHP : state.cpuHP;
      const pitcherHp = userIsBatting ? state.cpuHP : state.playerHP;
      const batterShield = userIsBatting ? state.shieldOnPlayer : state.shieldOnCpu;
      const pitcherShield = userIsBatting ? state.shieldOnCpu : state.shieldOnPlayer;
      const batterBurn = userIsBatting ? state.burnOnPlayer : state.burnOnCpu;
      const pitcherBurn = userIsBatting ? state.burnOnCpu : state.burnOnPlayer;
      const batterPoison = userIsBatting ? state.poisonOnPlayer : state.poisonOnCpu;
      const pitcherPoison = userIsBatting ? state.poisonOnCpu : state.poisonOnPlayer;
      setDisplayedBatterHP(batterHp);
      setDisplayedPitcherHP(pitcherHp);
      setDisplayedBatterShield(batterShield);
      setDisplayedPitcherShield(pitcherShield);
      setDisplayedBatterBurn(batterBurn);
      setDisplayedPitcherBurn(pitcherBurn);
      setDisplayedBatterPoison(batterPoison);
      setDisplayedPitcherPoison(pitcherPoison);
      noteFreezeApplied(state);
      syncCardCooldownOverlays();
    };

    const pushGroupCooldown = (
      group: BrawlAttackCard[],
      side: "user" | "opponent",
    ) => {
      const durationMs = brawlCardOverlayCooldownMs(group.length);
      setCardCooldowns((prev) => {
        const next = { ...prev };
        const pulseKey =
          Math.max(
            0,
            ...group.map((c) => prev[c.id]?.pulseKey ?? 0),
          ) + 1;
        for (const card of group) {
          next[card.id] = {
            pulseKey,
            durationMs,
            side,
            frozen: isCardCooldownPaused(card.id),
          };
        }
        return next;
      });
    };

    const seedAllGroupCooldowns = () => {
      setCardCooldowns(() => {
        const next: Record<string, CardCooldownPulse> = {};
        const seedSide = (
          side: "user" | "opponent",
          groups: BrawlAttackCard[][],
        ) => {
          for (const group of groups) {
            const durationMs = brawlCardOverlayCooldownMs(group.length);
            for (const card of group) {
              next[card.id] = {
                pulseKey: 0,
                durationMs,
                side,
                frozen: isCardCooldownPaused(card.id),
              };
            }
          }
        };
        seedSide("user", userAttackGroups);
        seedSide("opponent", opponentAttackGroups);
        return next;
      });
    };

    syncDisplayInstant(combat);

    const resolveCardHit = (card: BrawlAttackCard, isUser: boolean) => {
      combat = applyHitAndLog(combat, card, isUser);
      syncDisplayInstant(combat);
      if (isCombatOver()) endCombat();
    };

    const fireCardAttack = (
      card: BrawlAttackCard,
      side: "user" | "opponent",
      groupIdx: number,
      cardIdx: number,
    ) => {
      const isUser = side === "user";
      const attackerUi = isUser ? "user" : "opponent";
      const selfSeat: "batter" | "pitcher" = isUser
        ? userIsBatting
          ? "batter"
          : "pitcher"
        : userIsBatting
          ? "pitcher"
          : "batter";
      const foeSeat: "batter" | "pitcher" =
        selfSeat === "batter" ? "pitcher" : "batter";
      const selfPill = pillForSeat(selfSeat);
      const foePill = pillForSeat(foeSeat);
      const defenderUi = uiSideForSeat(foeSeat);
      const fxKey = `${runId}-${side}-${sideTick++}-${groupIdx}-${cardIdx}`;

      if (card.element && isSelfBuffBond(card.element)) {
        combat = applyHitAndLog(combat, card, isUser);
        syncDisplayInstant(combat);
        if (isCombatOver()) {
          endCombat();
          return;
        }
        if (card.element === "heal") {
          pulseHealOnSeat(selfSeat);
        }
        const buffLabel =
          card.element === "heal"
            ? `+${card.power} Heal`
            : `+${card.power} Shield`;
        const hitNumber: HitNumber = {
          id: `${fxKey}-buff`,
          x: selfPill.x,
          y: selfPill.y,
          value: card.power,
          defender: attackerUi,
          bornAt: performance.now(),
          label: buffLabel,
        };
        setHitNumbers((prev) => [...prev, hitNumber]);
        timers.push(
          setTimeout(() => {
            setHitNumbers((prev) =>
              prev.filter((n) => n.id !== `${fxKey}-buff`),
            );
          }, HIT_NUMBER_LIFETIME_MS),
        );
        return;
      }

      const src = cardRectFor(card.id, attackerUi);
      const hitLabel = card.element
        ? `${card.power} ${ELEMENT_LABEL[card.element]}`
        : `${card.power} Hit`;

      setProjectiles((prev) => [
        ...prev,
        {
          key: fxKey,
          sx: src.x,
          sy: src.y,
          tx: foePill.x,
          ty: foePill.y,
          cardId: card.id,
          power: card.power,
          attacker: attackerUi,
          defender: defenderUi,
          bornAt: performance.now(),
          label: card.label ?? card.id,
          element: card.element,
          flightMs: PROJECTILE_MS,
        },
      ]);

      timers.push(
        setTimeout(() => {
          resolveCardHit(card, isUser);

          const impactPayload: BrawlImpact = {
            id: fxKey,
            x: foePill.x,
            y: foePill.y,
            power: card.power,
            bornAt: performance.now(),
            defender: defenderUi,
            grand: false,
          };
          setImpacts((prev) => [...prev, impactPayload]);
          setHitNumbers((prev) => [
            ...prev,
            {
              id: `${fxKey}-hit`,
              x: foePill.x,
              y: foePill.y,
              value: card.power,
              defender: defenderUi,
              bornAt: performance.now(),
              label: hitLabel,
            },
          ]);
          onImpactRef.current?.(card.power, false);

          timers.push(
            setTimeout(() => {
              setHitNumbers((prev) =>
                prev.filter((n) => n.id !== `${fxKey}-hit`),
              );
            }, HIT_NUMBER_LIFETIME_MS),
          );
        }, PROJECTILE_MS),
      );

      timers.push(
        setTimeout(() => {
          setProjectiles((prev) => prev.filter((f) => f.key !== fxKey));
          gcImpacts();
        }, PROJECTILE_MS + PROJECTILE_TAIL_MS),
      );
    };

    const fireGroupAttack = (
      group: BrawlAttackCard[],
      side: "user" | "opponent",
      groupIdx: number,
    ) => {
      if (combatOver || group.length === 0) return;

      const isUser = side === "user";
      const groups = isUser ? userAttackGroups : opponentAttackGroups;
      pushGroupCooldown(group, side);

      let groupPower = 0;
      for (let cardIdx = 0; cardIdx < group.length; cardIdx++) {
        if (++combatSteps >= maxCombatSteps) {
          endCombat();
          return;
        }
        const card = group[cardIdx];
        if (card.skipAttack) continue;
        groupPower += card.power;
        fireCardAttack(card, side, groupIdx, cardIdx);
        if (combatOver) return;
      }

      combat = consumeAttackerFreeze(combat, isUser, groupPower);
      syncDisplayInstant(combat);
    };

    const scheduleGroupLoop = (
      side: "user" | "opponent",
      groupIndex: number,
    ) => {
      const groups = side === "user" ? userAttackGroups : opponentAttackGroups;
      const group = groups[groupIndex];
      if (!group || group.length === 0 || combatOver) return;

      const slotMs = () => brawlCardOverlayCooldownMs(group.length);

      const runCycle = (delayMs: number, fireAtMs?: number) => {
        const targetAt = fireAtMs ?? performance.now() + delayMs;

        const poll = () => {
          if (combatOver) return;
          const now = performance.now();

          if (isGroupCooldownPaused(group)) {
            timers.push(setTimeout(poll, 50));
            return;
          }

          const waitMs = targetAt - now;
          if (waitMs > 0) {
            timers.push(setTimeout(poll, Math.min(waitMs, 50)));
            return;
          }

          fireGroupAttack(group, side, groupIndex);
          if (combatOver) return;
          runCycle(slotMs());
        };

        timers.push(
          setTimeout(poll, Math.max(0, Math.min(delayMs, 50))),
        );
      };

      runCycle(slotMs());
    };

    const scheduleAllGroupLoops = () => {
      for (let i = 0; i < userAttackGroups.length; i++) {
        scheduleGroupLoop("user", i);
      }
      for (let i = 0; i < opponentAttackGroups.length; i++) {
        scheduleGroupLoop("opponent", i);
      }
    };

    const spawnSandstormFloaters = (damage: number, tick: number) => {
      const bornAt = performance.now();
      const userP = pillAt("user");
      const oppP = pillAt("opponent");
      const label = `-${damage}`;
      setHitNumbers((prev) => [
        ...prev,
        {
          id: `sandstorm-user-${tick}-${bornAt}`,
          x: userP.x,
          y: userP.y,
          value: damage,
          defender: "user",
          bornAt,
          label,
          variant: "sandstorm",
        },
        {
          id: `sandstorm-opp-${tick}-${bornAt}`,
          x: oppP.x,
          y: oppP.y,
          value: damage,
          defender: "opponent",
          bornAt,
          label,
          variant: "sandstorm",
        },
      ]);
      timers.push(
        setTimeout(() => {
          setHitNumbers((prev) =>
            prev.filter(
              (n) =>
                n.id !== `sandstorm-user-${tick}-${bornAt}` &&
                n.id !== `sandstorm-opp-${tick}-${bornAt}`,
            ),
          );
        }, HIT_NUMBER_LIFETIME_MS),
      );
    };

    let sandstormTick = 0;
    let sandstormInterval: ReturnType<typeof setInterval> | null = null;

    const activateSandstorm = () => {
      if (combatOver || !shouldActivateSandstorm(combat)) return;
      setSandstormActive(true);
      sandstormTick = 0;

      sandstormInterval = setInterval(() => {
        if (combatOver) return;
        sandstormTick += 1;
        sandstormTickCount = sandstormTick;
        const { next, damage, instantEnd } = applySandstormTick(
          combat,
          sandstormTick,
        );
        combat = next;
        combatEvents.push(logSandstormEvent(damage, sandstormTick));
        syncDisplayInstant(combat);
        spawnSandstormFloaters(damage, sandstormTick);
        setSandstormTickIndex(sandstormTick);
        onImpactRef.current?.(damage, instantEnd);
        if (instantEnd || isCombatOver()) endCombat();
      }, BRAWL_SANDSTORM_TICK_MS);
    };

    const combatStartMs =
      ARM_DELAY_MS +
      PHASE_INTRO_MS +
      (snap.elementMode ? 480 : Math.max(0, opponentRevealDelayMs));

    const dotTick = () => {
      if (combatOver) return;
      const beforeDot = combat;
      combat = tickCombatDotStacks(combat);
      combatEvents.push(...logDotTickEvents(beforeDot, combat));
      syncDisplayInstant(combat);
      if (isCombatOver()) endCombat();
    };
    const dotInterval = setInterval(dotTick, BRAWL_DOT_TICK_MS);
    const pauseSyncInterval = setInterval(() => {
      if (combatOver) return;
      syncCardCooldownOverlays();
    }, 100);

    timers.push(
      setTimeout(() => {
        if (combatOver) return;
        setAttackPhase("combat");
        if (userAttackGroups.length === 0 && opponentAttackGroups.length === 0) {
          endCombat();
          return;
        }
        seedAllGroupCooldowns();
        scheduleAllGroupLoops();
        timers.push(
          setTimeout(() => {
            if (combatOver) return;
            activateSandstorm();
          }, BRAWL_SANDSTORM_WARNING_MS),
        );
      }, combatStartMs),
    );

    return () => {
      combatOver = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(dotInterval);
      clearInterval(pauseSyncInterval);
      if (sandstormInterval) clearInterval(sandstormInterval);
      attackingRef.current = false;
      setAttacking(false);
    };
    // Pin the timeline to the at-bat id only. All other inputs are read
    // from `inputRef` so HP tweens / projectile state updates can't
    // restart the schedule mid-sequence (which was cancelling attacks).
  }, [enabled, runId]);

  return {
    displayedBatterHP,
    displayedPitcherHP,
    displayedBatterShield,
    displayedPitcherShield,
    displayedBatterBurn,
    displayedPitcherBurn,
    displayedBatterPoison,
    displayedPitcherPoison,
    displayedBatterHealPulse,
    displayedPitcherHealPulse,
    impacts,
    projectiles,
    flying: projectiles,
    hitNumbers,
    attacking,
    attackPhase,
    cardCooldowns,
    sandstormActive,
    sandstormTickIndex,
  };
}

// ---------------------------------------------------------------------------
// Per-card cooldown fill (mounted on each bond card in the hand strip)
// ---------------------------------------------------------------------------

const COOLDOWN_TONE: Record<
  "user" | "opponent",
  { veil: string; edge: string; glow: string }
> = {
  user: {
    veil: "bg-slate-950/58",
    edge: "bg-amber-400/90",
    glow: "0 0 10px rgba(251,191,36,0.85)",
  },
  opponent: {
    veil: "bg-slate-950/58",
    edge: "bg-rose-400/90",
    glow: "0 0 10px rgba(251,113,133,0.85)",
  },
};

/** Bottom-up veil shrink — card is ready when the overlay reaches zero height. */
export function BrawlCardCooldownOverlay({
  pulse,
  compact = false,
}: {
  pulse: CardCooldownPulse;
  compact?: boolean;
}) {
  const totalMs = pulse.durationMs;
  const remainingRef = useRef(totalMs);
  const frozenRef = useRef(!!pulse.frozen);
  const [remainingMs, setRemainingMs] = useState(totalMs);
  const [heightPct, setHeightPct] = useState(100);

  useEffect(() => {
    remainingRef.current = totalMs;
    setRemainingMs(totalMs);
    setHeightPct(100);
    frozenRef.current = !!pulse.frozen;
  }, [pulse.pulseKey, totalMs]);

  useEffect(() => {
    frozenRef.current = !!pulse.frozen;
  }, [pulse.frozen]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const paused = frozenRef.current && remainingRef.current > 0;
      if (!paused) {
        const dt = now - last;
        if (dt > 0) {
          remainingRef.current = Math.max(0, remainingRef.current - dt);
          setRemainingMs(remainingRef.current);
          setHeightPct(
            totalMs > 0 ? (remainingRef.current / totalMs) * 100 : 0,
          );
        }
      }
      last = now;
      if (remainingRef.current > 0) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pulse.pulseKey, totalMs]);

  const remainingSec = Math.ceil(remainingMs / 1000);
  const showFrozen = pulse.frozen && remainingSec > 0;
  const tone = showFrozen
    ? {
        veil: "bg-cyan-950/65",
        edge: "bg-cyan-300/95",
        glow: "0 0 12px rgba(56,189,248,0.9)",
        text: "text-cyan-50",
      }
    : {
        ...COOLDOWN_TONE[pulse.side],
        text: pulse.side === "user" ? "text-amber-100" : "text-rose-100",
      };

  return (
    <div
      className={`absolute inset-0 z-40 pointer-events-none overflow-hidden rounded-[inherit] ${
        compact ? "rounded-lg" : "rounded-xl"
      }`}
      aria-hidden="true"
    >
      <div
        className={`absolute inset-x-0 bottom-0 origin-bottom ${tone.veil} backdrop-blur-[1px] transition-none`}
        style={{ height: `${heightPct}%` }}
      >
        <div
          className={`absolute inset-x-0 top-0 h-[3px] ${tone.edge}`}
          style={{ boxShadow: tone.glow }}
        />
      </div>
      {remainingSec > 0 && (
        <div className="absolute inset-x-0 bottom-1.5 z-50 flex justify-center pointer-events-none">
          <span
            className={`font-black tabular-nums leading-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)] ${
              compact ? "text-[10px]" : "text-xs"
            } ${tone.text}`}
          >
            {remainingSec}
          </span>
        </div>
      )}
      {showFrozen && (
        <div className="absolute inset-x-0 top-1 z-[60] flex justify-center pointer-events-none">
          <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest text-cyan-100 bg-cyan-900/80 border border-cyan-400/50">
            Frozen
          </span>
        </div>
      )}
    </div>
  );
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
// JSX shell: mounts the R3F canvas + projectile streaks.
// ---------------------------------------------------------------------------

export function BrawlAttackOverlay({
  impacts,
  flying,
  projectiles,
  auras,
  hitNumbers,
  shakePulse,
  attackPhase,
}: {
  impacts: BrawlImpact[];
  /** @deprecated Prefer `projectiles`. */
  flying?: BrawlProjectile[];
  projectiles?: BrawlProjectile[];
  auras: BrawlAura[];
  hitNumbers: HitNumber[];
  shakePulse: BrawlShakePulse;
  attackPhase: BrawlAttackPhase;
}) {
  const activeProjectiles = projectiles ?? flying ?? [];
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
    <>
      {/* R3F canvas stays outside the shake wrapper — CSS transforms on a
          WebGL parent often blank the framebuffer to white. */}
      <div className="fixed inset-0 z-[53] pointer-events-none">
        <BrawlImpactCanvas impacts={impacts} auras={auras} />
      </div>
      <motion.div
        className="fixed inset-0 z-[54] pointer-events-none"
        initial={false}
        animate={shake}
      >
        <ProjectileLayer projectiles={activeProjectiles} />
        <HitNumberLayer numbers={hitNumbers} />
        <BrawlPhaseBanner phase={attackPhase} />
      </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Phase banner — center-of-screen chip that calls out which side is
// currently attacking. Driven by `attackPhase` so the colors swap
// cleanly between user (amber) and opponent (rose) phases without any
// extra parent state.
// ---------------------------------------------------------------------------

function BrawlPhaseBanner({ phase }: { phase: BrawlAttackPhase }) {
  // The mid-attack pills ("Your Cards Attack", "Opponent's Cards
  // Attack", "Switching Sides", "Combat") all duplicated information the
  // animation itself was already shouting via projectiles + HP pill impacts.
  // Only the pre-attack "Locked In" intro pill survives — it bridges the
  // dead air between lockIn and the first card launch.
  const config =
    phase === "intro"
      ? {
          label: "Locked In",
          chip:
            "bg-slate-700/85 text-slate-100 border-slate-400/60 shadow-slate-500/25",
          glow: "0 0 18px rgba(148,163,184,0.35)",
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
// DOM projectile streaks from card origin → opposing HP pill.
// ---------------------------------------------------------------------------

const ELEMENT_PROJECTILE_TONE: Record<
  Element,
  { core: string; glow: string; trail: string }
> = {
  fire: {
    core: "rgba(251,146,60,0.95)",
    glow: "0 0 22px rgba(251,146,60,0.75)",
    trail: "rgba(249,115,22,0.55)",
  },
  poison: {
    core: "rgba(192,132,252,0.95)",
    glow: "0 0 22px rgba(168,85,247,0.75)",
    trail: "rgba(147,51,234,0.55)",
  },
  freeze: {
    core: "rgba(125,211,252,0.95)",
    glow: "0 0 22px rgba(56,189,248,0.75)",
    trail: "rgba(14,165,233,0.55)",
  },
  shield: {
    core: "rgba(250,204,21,0.95)",
    glow: "0 0 22px rgba(234,179,8,0.75)",
    trail: "rgba(202,138,4,0.55)",
  },
  heal: {
    core: "rgba(74,222,128,0.95)",
    glow: "0 0 22px rgba(34,197,94,0.75)",
    trail: "rgba(22,163,74,0.55)",
  },
  volt: {
    core: "rgba(251,191,36,0.95)",
    glow: "0 0 22px rgba(245,158,11,0.75)",
    trail: "rgba(217,119,6,0.55)",
  },
};

function ProjectileLayer({ projectiles }: { projectiles: BrawlProjectile[] }) {
  return (
    <div className="absolute inset-0 z-[52] pointer-events-none" aria-hidden="true">
      <AnimatePresence>
        {projectiles.map((proj) => (
          <BrawlProjectileStreak key={proj.key} proj={proj} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function BrawlProjectileStreak({ proj }: { proj: BrawlProjectile }) {
  const dx = proj.tx - proj.sx;
  const dy = proj.ty - proj.sy;
  const distance = Math.hypot(dx, dy);
  const midX = proj.sx + dx * 0.5 + (dx >= 0 ? 1 : -1) * Math.max(24, distance * 0.08);
  const midY = proj.sy + dy * 0.5 - Math.max(32, distance * 0.12);
  const flightDuration = (proj.flightMs + 120) / 1000;

  const sideTone =
    proj.attacker === "user"
      ? {
          core: "rgba(251,191,36,0.95)",
          glow: "0 0 20px rgba(251,191,36,0.65)",
          trail: "rgba(251,191,36,0.45)",
        }
      : {
          core: "rgba(244,63,94,0.95)",
          glow: "0 0 20px rgba(244,63,94,0.65)",
          trail: "rgba(244,63,94,0.45)",
        };
  const elementTone = proj.element ? ELEMENT_PROJECTILE_TONE[proj.element] : sideTone;

  return (
    <>
      <motion.div
        style={{ position: "absolute", left: 0, top: 0, willChange: "transform" }}
        initial={{ x: proj.sx - 10, y: proj.sy - 10, opacity: 0, scale: 0.35 }}
        animate={{
          x: [proj.sx - 10, midX - 10, proj.tx - 10],
          y: [proj.sy - 10, midY - 10, proj.ty - 10],
          opacity: [0, 1, 1, 0],
          scale: [0.35, 1, 1, 0.6],
        }}
        transition={{
          duration: flightDuration,
          times: [0, 0.35, 0.88, 1],
          ease: [0.35, 0, 0.2, 1],
        }}
      >
        <div
          className="rounded-full"
          style={{
            width: 20,
            height: 20,
            background: `radial-gradient(circle, ${elementTone.core} 0%, ${elementTone.trail} 55%, transparent 100%)`,
            boxShadow: elementTone.glow,
            filter: "blur(1px)",
          }}
        />
      </motion.div>
      <motion.div
        style={{ position: "absolute", left: 0, top: 0, willChange: "transform" }}
        initial={{ x: proj.sx, y: proj.sy, opacity: 0 }}
        animate={{
          x: [proj.sx, midX, proj.tx],
          y: [proj.sy, midY, proj.ty],
          opacity: [0, 0.85, 0],
        }}
        transition={{ duration: flightDuration, ease: "easeOut" }}
      >
        <div
          style={{
            width: Math.max(48, distance * 0.35),
            height: 4,
            borderRadius: 9999,
            background: `linear-gradient(90deg, transparent, ${elementTone.trail}, transparent)`,
            transform: `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)`,
            transformOrigin: "left center",
          }}
        />
      </motion.div>
    </>
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
              n.variant === "sandstorm"
                ? "bg-orange-600/90 border-orange-200/80 text-orange-50 shadow-[0_0_12px_rgba(251,146,60,0.65)]"
                : n.defender === "user"
                  ? "bg-rose-500/85 border-rose-200/80 text-rose-50"
                  : "bg-amber-500/85 border-amber-200/80 text-amber-50"
            }`}
            style={{ left: n.x, top: n.y }}
            initial={{ y: 0, opacity: 0, scale: 0.72 }}
            animate={{ y: -42, opacity: 1, scale: n.grand ? 1.18 : 1 }}
            exit={{ y: -68, opacity: 0, scale: 0.82 }}
            transition={{ duration: 0.62, ease: [0.2, 0.82, 0.2, 1] }}
          >
            {n.label ?? `-${n.value}`}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
