/**
 * Per-mage battle meter and one-shot arena actions during reveal combat.
 */
import type { BrawlClass } from "./elementClassPools";
import type { Element, ElementCombatState } from "./brawlElements";
import { applyDamageToDefender, BRAWL_START_HP } from "./brawlElements";

export const CLASS_METER_MAX = 100;

export type ClassPendingEffect =
  | "flashover"
  | "glacial_focus"
  | "catalyze"
  | "discharge"
  | null;

export interface ClassCombatRuntime {
  meter: number;
  pendingEffect: ClassPendingEffect;
}

export function freshClassCombatRuntime(): ClassCombatRuntime {
  return { meter: 0, pendingEffect: null };
}

export interface ClassTraitUi {
  mageLabel: string;
  meterLabel: string;
  actionLabel: string;
  actionDescription: string;
  accentClass: string;
}

const TRAIT_UI: Record<BrawlClass, ClassTraitUi> = {
  fire: {
    mageLabel: "Ignis",
    meterLabel: "Overheat",
    actionLabel: "Flashover",
    actionDescription: "Next fire hit adds +2 burn stacks.",
    accentClass: "border-orange-500/80 text-orange-200",
  },
  freeze: {
    mageLabel: "Ren",
    meterLabel: "Permafrost",
    actionLabel: "Glacial Focus",
    actionDescription: "Next freeze hit applies +2 chill stacks.",
    accentClass: "border-sky-400/80 text-sky-200",
  },
  poison: {
    mageLabel: "Lumi",
    meterLabel: "Venom Reserve",
    actionLabel: "Catalyze",
    actionDescription: "Next poison hit adds +2 poison stacks.",
    accentClass: "border-violet-400/80 text-violet-200",
  },
  volt: {
    mageLabel: "Volta",
    meterLabel: "Capacitor",
    actionLabel: "Discharge",
    actionDescription: "Instant 4 shock damage — ignores shield.",
    accentClass: "border-amber-400/80 text-amber-200",
  },
};

export function classTraitUi(brawlClass: BrawlClass): ClassTraitUi {
  return TRAIT_UI[brawlClass];
}

export function isClassActionReady(meter: number): boolean {
  return meter >= CLASS_METER_MAX;
}

/** Gain meter from class-aligned hits during combat. */
export function meterGainForHit(
  brawlClass: BrawlClass,
  element: Element | undefined,
  hpDamage: number,
  dotFire: number,
  dotPoison: number,
  freezeApplied: number,
): number {
  if (hpDamage <= 0 && !dotFire && !dotPoison && !freezeApplied) return 0;
  switch (brawlClass) {
    case "fire":
      return element === "fire" ? 18 + dotFire * 4 : dotFire > 0 ? 8 : 0;
    case "freeze":
      return element === "freeze" ? 16 + freezeApplied * 6 : freezeApplied > 0 ? 10 : 0;
    case "poison":
      return element === "poison" ? 18 + dotPoison * 4 : dotPoison > 0 ? 8 : 0;
    case "volt":
      return element === "volt" ? 20 : hpDamage > 0 ? 10 : 0;
    default:
      return 0;
  }
}

export function addMeter(meter: number, gain: number): number {
  return Math.min(CLASS_METER_MAX, meter + gain);
}

function pendingEffectForClass(brawlClass: BrawlClass): ClassPendingEffect {
  switch (brawlClass) {
    case "fire":
      return "flashover";
    case "freeze":
      return "glacial_focus";
    case "poison":
      return "catalyze";
    case "volt":
      return "discharge";
    default:
      return null;
  }
}

/** @deprecated Manual spend removed — use autoTriggerClassTrait. */
export function spendClassAction(
  brawlClass: BrawlClass,
  runtime: ClassCombatRuntime,
): ClassCombatRuntime | null {
  if (!isClassActionReady(runtime.meter)) return null;
  return { meter: 0, pendingEffect: pendingEffectForClass(brawlClass) };
}

/**
 * When the meter is full, arm the class effect automatically (no player input).
 * Volta Discharge fires immediately on the next sync tick in combat reveal.
 */
export function autoTriggerClassTrait(
  brawlClass: BrawlClass,
  runtime: ClassCombatRuntime,
): { runtime: ClassCombatRuntime; dischargeNow: boolean } {
  if (!isClassActionReady(runtime.meter) || runtime.pendingEffect) {
    return { runtime, dischargeNow: false };
  }
  const effect = pendingEffectForClass(brawlClass);
  if (brawlClass === "volt") {
    return {
      runtime: { meter: 0, pendingEffect: "discharge" },
      dischargeNow: true,
    };
  }
  return {
    runtime: { meter: 0, pendingEffect: effect },
    dischargeNow: false,
  };
}

/** Apply pending effect to a combat hit; clears effect when consumed (except discharge). */
export function applyPendingEffectToHit(
  state: ElementCombatState,
  runtime: ClassCombatRuntime,
  params: {
    element?: Element;
    power: number;
    attackerIsPlayer: boolean;
  },
): { state: ElementCombatState; runtime: ClassCombatRuntime } {
  const effect = runtime.pendingEffect;
  if (!effect) return { state, runtime };

  let next = state;
  let pendingEffect: ClassPendingEffect = runtime.pendingEffect;

  if (effect === "flashover" && params.element === "fire") {
    if (params.attackerIsPlayer) {
      next = { ...next, burnOnCpu: next.burnOnCpu + 2 };
    } else {
      next = { ...next, burnOnPlayer: next.burnOnPlayer + 2 };
    }
    pendingEffect = null;
  } else if (effect === "glacial_focus" && params.element === "freeze") {
    if (params.attackerIsPlayer) {
      next = { ...next, freezeOnCpu: next.freezeOnCpu + 2 };
    } else {
      next = { ...next, freezeOnPlayer: next.freezeOnPlayer + 2 };
    }
    pendingEffect = null;
  } else if (effect === "catalyze" && params.element === "poison") {
    if (params.attackerIsPlayer) {
      next = { ...next, poisonOnCpu: next.poisonOnCpu + 2 };
    } else {
      next = { ...next, poisonOnPlayer: next.poisonOnPlayer + 2 };
    }
    pendingEffect = null;
  }

  return {
    state: next,
    runtime: { ...runtime, pendingEffect },
  };
}

/** Instant discharge — bypasses shield. */
export function applyDischarge(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
): ElementCombatState {
  return applyDamageToDefender(state, attackerIsPlayer, 4);
}

export function classTipForReport(
  brawlClass: BrawlClass | null,
  report: {
    userWon: boolean;
    events: { element?: Element; actorSide: string }[];
  },
): string | null {
  if (!brawlClass) return null;
  const userFire = report.events.filter(
    (e) => e.actorSide === "user" && e.element === "fire",
  ).length;
  const userFreeze = report.events.filter(
    (e) => e.actorSide === "user" && e.element === "freeze",
  ).length;
  const userPoison = report.events.filter(
    (e) => e.actorSide === "user" && e.element === "poison",
  ).length;
  const userVolt = report.events.filter(
    (e) => e.actorSide === "user" && e.element === "volt",
  ).length;

  if (report.userWon) return null;

  switch (brawlClass) {
    case "fire":
      return userFire < 2
        ? "Ignis tip: snap more fire activations before you lock in — burn stacks win long fights."
        : "Ignis tip: Overheat auto-triggers Flashover on your next fire activation.";
    case "freeze":
      return userFreeze < 2
        ? "Ren tip: affirmed freeze chains slow the enemy arena — snap more circle seams."
        : "Ren tip: full Permafrost auto-boosts your next freeze hit.";
    case "poison":
      return userPoison < 2
        ? "Lumi tip: stack poison early; Venom Reserve auto-catalyzes when full."
        : "Lumi tip: pierce shields with Toxin and Rot before the finisher.";
    case "volt":
      return userVolt < 2
        ? "Volta tip: volt hits instantly — shorter chains still chip HP. Weave star seams."
        : "Volta tip: a full Capacitor auto-Discharges — shield break then burst.";
    default:
      return null;
  }
}

export { BRAWL_START_HP };
