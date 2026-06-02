/**
 * Combat event log for brawl battle result screen.
 */
import type { Element, ElementCombatState } from "./brawlElements";
import { ELEMENT_LABEL } from "./brawlElements";
import { elementCardById } from "./elementCards";
import { elementCatalogId } from "./elementDeal";

export type BrawlCombatEventKind =
  | "card_hit"
  | "dot_tick"
  | "sandstorm";

export interface BrawlCombatEvent {
  kind: BrawlCombatEventKind;
  /** Who acted (player UI side). */
  actorSide: "user" | "opponent";
  /** Instance id at lock-in (e.g. el-01~2). */
  cardId?: string;
  cardName?: string;
  element?: Element;
  /** Bond / hit power before mitigation. */
  power: number;
  /** HP removed from defender (player or cpu seat). */
  hpDamage: number;
  shieldAbsorbed: number;
  heal?: number;
  shieldGain?: number;
  dotApplied?: { fire?: number; poison?: number };
  freezeApplied?: number;
  cleanse?: number;
  detail: string;
}

export interface BrawlCombatReport {
  startPlayerHp: number;
  startCpuHp: number;
  endPlayerHp: number;
  endCpuHp: number;
  events: BrawlCombatEvent[];
  sandstormTicks: number;
  /** True when the human (player seat) won this fight. */
  userWon: boolean;
}

/** Per-card totals for the battle breakdown screen. */
export interface BrawlCardBreakdown {
  catalogId: string;
  cardName: string;
  actorSide: "user" | "opponent";
  element?: Element;
  activations: number;
  totalHpDamage: number;
  totalShieldAbsorbed: number;
  totalHeal: number;
  totalShieldGain: number;
  totalFireStacks: number;
  totalPoisonStacks: number;
  totalFreeze: number;
  totalCleanse: number;
}

export interface BrawlEnvironmentalBreakdown {
  kind: "sandstorm" | "dot_to_opponent" | "dot_to_you";
  label: string;
  totalDamage: number;
  detail: string;
}

export interface BrawlBreakdownSummary {
  cards: BrawlCardBreakdown[];
  environmental: BrawlEnvironmentalBreakdown[];
}

export function formatCardBreakdownSummary(row: BrawlCardBreakdown): string {
  const parts: string[] = [];
  if (row.totalHpDamage > 0) {
    parts.push(`${row.totalHpDamage} damage dealt`);
  }
  if (row.totalShieldAbsorbed > 0) {
    parts.push(`${row.totalShieldAbsorbed} blocked by shield`);
  }
  if (row.totalHeal > 0) {
    parts.push(`${row.totalHeal} HP healed`);
  }
  if (row.totalShieldGain > 0) {
    parts.push(`${row.totalShieldGain} shield gained`);
  }
  if (row.totalFireStacks > 0) {
    parts.push(`${row.totalFireStacks} burn applied`);
  }
  if (row.totalPoisonStacks > 0) {
    parts.push(`${row.totalPoisonStacks} poison applied`);
  }
  if (row.totalFreeze > 0) {
    parts.push(`${row.totalFreeze} freeze applied`);
  }
  if (row.totalCleanse > 0) {
    parts.push(`cleansed ${row.totalCleanse}`);
  }
  if (parts.length === 0) {
    return row.activations > 1 ? `${row.activations} activations` : "No effect";
  }
  if (row.activations > 1) {
    return `${row.activations}× · ${parts.join(" · ")}`;
  }
  return parts.join(" · ");
}

/** Roll hit-by-hit card events into one row per card per side. */
export function aggregateCardBreakdown(
  events: BrawlCombatEvent[],
  sandstormTicks: number,
): BrawlBreakdownSummary {
  const byKey = new Map<string, BrawlCardBreakdown>();

  for (const event of events) {
    if (event.kind !== "card_hit" || !event.cardName) continue;
    const catalogId = event.cardId
      ? elementCatalogId(event.cardId)
      : event.cardName;
    const key = `${event.actorSide}:${catalogId}`;
    const existing = byKey.get(key);
    const dotFire = event.dotApplied?.fire ?? 0;
    const dotPoison = event.dotApplied?.poison ?? 0;

    if (existing) {
      existing.activations += 1;
      existing.totalHpDamage += event.hpDamage;
      existing.totalShieldAbsorbed += event.shieldAbsorbed;
      existing.totalHeal += event.heal ?? 0;
      existing.totalShieldGain += event.shieldGain ?? 0;
      existing.totalFireStacks += dotFire;
      existing.totalPoisonStacks += dotPoison;
      existing.totalFreeze += event.freezeApplied ?? 0;
      existing.totalCleanse += event.cleanse ?? 0;
    } else {
      byKey.set(key, {
        catalogId,
        cardName: event.cardName,
        actorSide: event.actorSide,
        element: event.element,
        activations: 1,
        totalHpDamage: event.hpDamage,
        totalShieldAbsorbed: event.shieldAbsorbed,
        totalHeal: event.heal ?? 0,
        totalShieldGain: event.shieldGain ?? 0,
        totalFireStacks: dotFire,
        totalPoisonStacks: dotPoison,
        totalFreeze: event.freezeApplied ?? 0,
        totalCleanse: event.cleanse ?? 0,
      });
    }
  }

  const cards = [...byKey.values()].sort((a, b) => {
    if (a.actorSide !== b.actorSide) {
      return a.actorSide === "user" ? -1 : 1;
    }
    return a.cardName.localeCompare(b.cardName);
  });

  const environmental: BrawlEnvironmentalBreakdown[] = [];

  let dotToOpponent = 0;
  let dotToYou = 0;
  for (const event of events) {
    if (event.kind !== "dot_tick") continue;
    if (event.actorSide === "user") {
      dotToOpponent += event.hpDamage;
    } else {
      dotToYou += event.hpDamage;
    }
  }
  if (dotToOpponent > 0) {
    environmental.push({
      kind: "dot_to_opponent",
      label: "Burn & Poison",
      totalDamage: dotToOpponent,
      detail: `${dotToOpponent} damage to opponent from ongoing stacks`,
    });
  }
  if (dotToYou > 0) {
    environmental.push({
      kind: "dot_to_you",
      label: "Burn & Poison",
      totalDamage: dotToYou,
      detail: `${dotToYou} damage to you from ongoing stacks`,
    });
  }

  if (sandstormTicks > 0) {
    const stormEvents = events.filter((e) => e.kind === "sandstorm");
    const perSide = stormEvents.reduce((sum, e) => sum + e.hpDamage, 0);
    const peak = stormEvents.reduce((max, e) => Math.max(max, e.power), 0);
    environmental.push({
      kind: "sandstorm",
      label: "Sandstorm",
      totalDamage: perSide,
      detail: `${sandstormTicks} ticks · ${perSide} HP lost on each side · peak tick ${peak}`,
    });
  }

  return { cards, environmental };
}

export function cardDisplayName(cardId: string): string {
  try {
    return elementCardById(cardId).name;
  } catch {
    return cardId.split("~")[0] ?? cardId;
  }
}

function defenderHpDelta(
  before: ElementCombatState,
  after: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  if (attackerIsPlayer) {
    return Math.max(0, before.cpuHP - after.cpuHP);
  }
  return Math.max(0, before.playerHP - after.playerHP);
}

function defenderShieldDelta(
  before: ElementCombatState,
  after: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  if (attackerIsPlayer) {
    return Math.max(0, before.shieldOnCpu - after.shieldOnCpu);
  }
  return Math.max(0, before.shieldOnPlayer - after.shieldOnPlayer);
}

function selfHealDelta(
  before: ElementCombatState,
  after: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  if (attackerIsPlayer) {
    return Math.max(0, after.playerHP - before.playerHP);
  }
  return Math.max(0, after.cpuHP - before.cpuHP);
}

function selfShieldGain(
  before: ElementCombatState,
  after: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  if (attackerIsPlayer) {
    return Math.max(0, after.shieldOnPlayer - before.shieldOnPlayer);
  }
  return Math.max(0, after.shieldOnCpu - before.shieldOnCpu);
}

function cleanseAmount(before: ElementCombatState, after: ElementCombatState, attackerIsPlayer: boolean): number {
  if (attackerIsPlayer) {
    const burn = Math.max(0, before.burnOnPlayer - after.burnOnPlayer);
    const poison = Math.max(0, before.poisonOnPlayer - after.poisonOnPlayer);
    return burn + poison;
  }
  const burn = Math.max(0, before.burnOnCpu - after.burnOnCpu);
  const poison = Math.max(0, before.poisonOnCpu - after.poisonOnCpu);
  return burn + poison;
}

/** Build a log line for one card / bond hit. */
export function logCardCombatEvent(
  before: ElementCombatState,
  after: ElementCombatState,
  params: {
    cardId: string;
    power: number;
    element?: Element;
    label?: string;
    attackerIsPlayer: boolean;
  },
): BrawlCombatEvent {
  const actorSide: "user" | "opponent" = params.attackerIsPlayer
    ? "user"
    : "opponent";
  const name = cardDisplayName(params.cardId);
  const hpDamage = defenderHpDelta(before, after, params.attackerIsPlayer);
  const shieldAbsorbed = defenderShieldDelta(before, after, params.attackerIsPlayer);
  const heal = selfHealDelta(before, after, params.attackerIsPlayer);
  const shieldGain = selfShieldGain(before, after, params.attackerIsPlayer);
  const cleanse = cleanseAmount(before, after, params.attackerIsPlayer);

  const dotApplied: { fire?: number; poison?: number } = {};
  if (params.attackerIsPlayer) {
    const fire = after.burnOnCpu - before.burnOnCpu;
    const poison = after.poisonOnCpu - before.poisonOnCpu;
    if (fire > 0) dotApplied.fire = fire;
    if (poison > 0) dotApplied.poison = poison;
  } else {
    const fire = after.burnOnPlayer - before.burnOnPlayer;
    const poison = after.poisonOnPlayer - before.poisonOnPlayer;
    if (fire > 0) dotApplied.fire = fire;
    if (poison > 0) dotApplied.poison = poison;
  }

  let freezeApplied = 0;
  if (params.attackerIsPlayer) {
    freezeApplied = Math.max(0, after.freezeOnCpu - before.freezeOnCpu);
  } else {
    freezeApplied = Math.max(0, after.freezeOnPlayer - before.freezeOnPlayer);
  }

  const el = params.element;
  const parts: string[] = [];
  if (!el) {
    if (hpDamage > 0) parts.push(`${hpDamage} damage`);
    if (shieldAbsorbed > 0) parts.push(`${shieldAbsorbed} blocked by shield`);
  } else if (el === "fire" || el === "poison") {
    if (hpDamage > 0) parts.push(`${hpDamage} instant HP`);
    if (shieldAbsorbed > 0) parts.push(`${shieldAbsorbed} absorbed by shield`);
    const dot = dotApplied.fire ?? dotApplied.poison ?? 0;
    if (dot > 0) parts.push(`+${dot} ${el} stack`);
    if (el === "fire" && elementCatalogId(params.cardId) === "el-05") {
      parts.push("no burn (Blaze)");
    }
    if (
      el === "fire" &&
      elementCatalogId(params.cardId) === "el-12" &&
      hpDamage === 0 &&
      (dotApplied.fire ?? 0) > 0
    ) {
      parts.push("burn only (Kindle)");
    }
    if (
      el === "poison" &&
      elementCatalogId(params.cardId) === "el-17"
    ) {
      const defenderPoisonBefore = params.attackerIsPlayer
        ? before.poisonOnCpu
        : before.poisonOnPlayer;
      if (defenderPoisonBefore > 0) {
        parts.push("stacked poison bonus");
      }
    }
  } else if (el === "heal") {
    if (heal > 0) parts.push(`+${heal} HP`);
    if (cleanse > 0) parts.push(`cleansed ${cleanse}`);
  } else if (el === "shield") {
    if (shieldGain > 0) parts.push(`+${shieldGain} shield`);
    if (elementCatalogId(params.cardId) === "el-09" && shieldGain > params.power) {
      parts.push("includes Aegis bonus");
    }
  } else if (el === "freeze") {
    if (freezeApplied > 0) parts.push(`+${freezeApplied} freeze slow`);
    if (elementCatalogId(params.cardId) === "el-11" && freezeApplied > 0) {
      parts.push("double freeze (Glacia)");
    }
  }

  const elementLabel = el ? ELEMENT_LABEL[el] : params.label ?? "Hit";
  const detail =
    parts.length > 0
      ? `${elementLabel} · ${parts.join(" · ")}`
      : `${elementLabel} · power ${params.power}`;

  return {
    kind: "card_hit",
    actorSide,
    cardId: params.cardId,
    cardName: name,
    element: el,
    power: params.power,
    hpDamage,
    shieldAbsorbed,
    heal: heal || undefined,
    shieldGain: shieldGain || undefined,
    dotApplied: Object.keys(dotApplied).length ? dotApplied : undefined,
    freezeApplied: freezeApplied || undefined,
    cleanse: cleanse || undefined,
    detail,
  };
}

/** Log burn/poison DoT ticks for both sides. */
export function logDotTickEvents(
  before: ElementCombatState,
  after: ElementCombatState,
): BrawlCombatEvent[] {
  const events: BrawlCombatEvent[] = [];
  const playerLoss = Math.max(0, before.playerHP - after.playerHP);
  const cpuLoss = Math.max(0, before.cpuHP - after.cpuHP);
  if (cpuLoss > 0) {
    events.push({
      kind: "dot_tick",
      actorSide: "user",
      power: cpuLoss,
      hpDamage: cpuLoss,
      shieldAbsorbed: 0,
      detail: `Burn/poison tick · ${cpuLoss} damage to opponent`,
    });
  }
  if (playerLoss > 0) {
    events.push({
      kind: "dot_tick",
      actorSide: "opponent",
      power: playerLoss,
      hpDamage: playerLoss,
      shieldAbsorbed: 0,
      detail: `Burn/poison tick · ${playerLoss} damage to you`,
    });
  }
  return events;
}

export function logSandstormEvent(damage: number, tickIndex: number): BrawlCombatEvent {
  return {
    kind: "sandstorm",
    actorSide: "user",
    power: damage,
    hpDamage: damage,
    shieldAbsorbed: 0,
    detail: `Sandstorm tick ${tickIndex} · ${damage} damage to both sides`,
  };
}

export function buildCombatReport(
  start: ElementCombatState,
  end: ElementCombatState,
  events: BrawlCombatEvent[],
  sandstormTicks: number,
): BrawlCombatReport {
  return {
    startPlayerHp: start.playerHP,
    startCpuHp: start.cpuHP,
    endPlayerHp: end.playerHP,
    endCpuHp: end.cpuHP,
    events,
    sandstormTicks,
    userWon: end.playerHP > 0 && end.cpuHP <= 0,
  };
}
