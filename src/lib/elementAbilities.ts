/**
 * Per-card snap and fight abilities for the 20-card element brawl deck.
 */
import type { CardDefinition } from "./cards";
import { printedNumericValue } from "./cardModel";
import { seamKey } from "./connect";
import { buildGroups } from "./scoring";
import { elementCatalogId } from "./elementDeal";
import {
  applyGenericCombatHit,
  applyInstantCombatBond,
  applyDamageToDefender,
  buildHandAttackQueue,
  computeElementBonds,
  BRAWL_START_HP,
  type BrawlHandAttack,
  type Element,
  type ElementBond,
  type ElementCombatState,
} from "./brawlElements";

export const ELEMENT_ABILITY_CATALOG = {
  ember: "el-01",
  toxin: "el-03",
  blaze: "el-05",
  mend: "el-06",
  aegis: "el-09",
  bane: "el-10",
  glacia: "el-11",
  kindle: "el-12",
  syphon: "el-13",
  bastion: "el-14",
  purge: "el-15",
  flint: "el-16",
  nightshade: "el-17",
  hoarfrost: "el-18",
} as const;

const BANE_SOLO_POWER = 6;
const TOXIN_SHIELD_PIERCE = 2;
const MEND_CLEANSE = 2;
const AEGIS_BONUS_SHIELD = 2;
const EMBER_CHAIN_VALUE = 2;
const NIGHTSHADE_POISON_BONUS_CAP = 4;
const PURGE_FREEZE_CLEANSE = 2;
const FLINT_CHAIN_HEAD_VALUE = 3;
const BASTION_HEAL = 1;

/** Card is part of an affirmed chain (group ≥ 2 with a seam touching it). */
export function isInAffirmedChain(
  cardId: string,
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): boolean {
  if (!affirmedSeams || affirmedSeams.size === 0) return false;
  for (const group of buildGroups(hand, affirmedSeams)) {
    if (group.length < 2) continue;
    if (!group.some((c) => c.id === cardId)) continue;
    for (let i = 1; i < group.length; i++) {
      const left = group[i - 1];
      const right = group[i];
      if (left.id !== cardId && right.id !== cardId) continue;
      if (affirmedSeams.has(seamKey(left.id, right.id))) return true;
    }
  }
  return false;
}

/** True when the card is the leftmost card in an affirmed group of length ≥ 2. */
export function isLeftmostInAffirmedChain(
  cardId: string,
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): boolean {
  if (!affirmedSeams || affirmedSeams.size === 0) return false;
  for (const group of buildGroups(hand, affirmedSeams)) {
    if (group.length < 2) continue;
    if (group[0].id !== cardId) continue;
    if (affirmedSeams.has(seamKey(group[0].id, group[1].id))) return true;
  }
  return false;
}

function snapBondContribution(
  card: CardDefinition,
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): number {
  return resolvedSnapDisplayValue(card, hand, affirmedSeams).value;
}

/** Live hand display: printed value, or snap-adjusted when an ability applies. */
export function resolvedSnapDisplayValue(
  card: CardDefinition,
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): { value: number; boosted: boolean } {
  const base = printedNumericValue(card);
  const inChain = isInAffirmedChain(card.id, hand, affirmedSeams);
  const catalogId = elementCatalogId(card.id);

  if (catalogId === ELEMENT_ABILITY_CATALOG.ember && inChain) {
    return {
      value: EMBER_CHAIN_VALUE,
      boosted: EMBER_CHAIN_VALUE > base,
    };
  }
  if (catalogId === ELEMENT_ABILITY_CATALOG.bane && !inChain) {
    return {
      value: BANE_SOLO_POWER,
      boosted: BANE_SOLO_POWER > base,
    };
  }
  if (
    catalogId === ELEMENT_ABILITY_CATALOG.flint &&
    isLeftmostInAffirmedChain(card.id, hand, affirmedSeams)
  ) {
    return {
      value: FLINT_CHAIN_HEAD_VALUE,
      boosted: FLINT_CHAIN_HEAD_VALUE > base,
    };
  }
  return { value: base, boosted: false };
}

/** Bonds with Ember chain value and other snap adjustments applied. */
export function computeElementBondsWithAbilities(
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): ElementBond[] {
  const bonds = computeElementBonds(hand, affirmedSeams);
  return bonds.map((bond) => {
    const left = hand.find((c) => c.id === bond.leftCardId);
    const right = hand.find((c) => c.id === bond.rightCardId);
    if (!left || !right) return bond;
    return {
      ...bond,
      power:
        snapBondContribution(left, hand, affirmedSeams) +
        snapBondContribution(right, hand, affirmedSeams),
    };
  });
}

/** Attack queue with Bane solo snap applied. */
export function buildHandAttackQueueWithAbilities(
  hand: CardDefinition[],
  bonds: ElementBond[],
  affirmedSeams: ReadonlySet<string> | null,
): BrawlHandAttack[] {
  const queue = buildHandAttackQueue(hand, bonds);
  return queue.map((attack) => {
    if (attack.element || attack.skipAttack) return attack;
    if (elementCatalogId(attack.id) !== ELEMENT_ABILITY_CATALOG.bane) return attack;
    if (isInAffirmedChain(attack.id, hand, affirmedSeams)) return attack;
    return { ...attack, power: BANE_SOLO_POWER, label: "Solo Hit" };
  });
}

export function buildHandAttackGroupsWithAbilities(
  hand: CardDefinition[],
  bonds: ElementBond[],
  affirmedSeams: ReadonlySet<string> | null,
): BrawlHandAttack[][] {
  const byId = new Map(
    buildHandAttackQueueWithAbilities(hand, bonds, affirmedSeams).map((a) => [
      a.id,
      a,
    ]),
  );
  return buildGroups(hand, affirmedSeams).map((group) =>
    group
      .map((c) => byId.get(c.id))
      .filter((a): a is BrawlHandAttack => a != null),
  );
}

function cleanseAttacker(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
  amount: number,
): ElementCombatState {
  const next = { ...state };
  const n = Math.max(0, amount);
  if (attackerIsPlayer) {
    if (next.burnOnPlayer > 0) {
      next.burnOnPlayer = Math.max(0, next.burnOnPlayer - n);
    } else {
      next.poisonOnPlayer = Math.max(0, next.poisonOnPlayer - n);
    }
  } else if (next.burnOnCpu > 0) {
    next.burnOnCpu = Math.max(0, next.burnOnCpu - n);
  } else {
    next.poisonOnCpu = Math.max(0, next.poisonOnCpu - n);
  }
  return next;
}

function thawAttacker(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
  amount: number,
): ElementCombatState {
  const next = { ...state };
  const n = Math.max(0, amount);
  if (attackerIsPlayer) {
    next.freezeOnPlayer = Math.max(0, next.freezeOnPlayer - n);
  } else {
    next.freezeOnCpu = Math.max(0, next.freezeOnCpu - n);
  }
  return next;
}

function healAttacker(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
  amount: number,
): ElementCombatState {
  const next = { ...state };
  const n = Math.max(0, amount);
  if (attackerIsPlayer) {
    next.playerHP = Math.min(BRAWL_START_HP, next.playerHP + n);
  } else {
    next.cpuHP = Math.min(BRAWL_START_HP, next.cpuHP + n);
  }
  return next;
}

function pierceDefenderShield(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
  amount: number,
): ElementCombatState {
  const next = { ...state };
  const pierce = Math.max(0, amount);
  if (attackerIsPlayer) {
    next.shieldOnCpu = Math.max(0, next.shieldOnCpu - pierce);
  } else {
    next.shieldOnPlayer = Math.max(0, next.shieldOnPlayer - pierce);
  }
  return next;
}

function defenderPoisonStack(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  return attackerIsPlayer ? state.poisonOnCpu : state.poisonOnPlayer;
}

function bondIncludesCatalog(
  catalogKey: keyof typeof ELEMENT_ABILITY_CATALOG,
  leftCardId: string,
  rightCardId?: string,
): boolean {
  const id = ELEMENT_ABILITY_CATALOG[catalogKey];
  if (elementCatalogId(leftCardId) === id) return true;
  if (rightCardId && elementCatalogId(rightCardId) === id) return true;
  return false;
}

/** Resolve one card hit with catalog fight abilities. */
export function applyElementCombatHit(
  state: ElementCombatState,
  params: {
    element?: Element;
    power: number;
    leftCardId: string;
    rightCardId?: string;
  },
  attackerIsPlayer: boolean,
): ElementCombatState {
  if (!params.element) {
    return applyGenericCombatHit(state, params.power, attackerIsPlayer);
  }

  const catalogId = elementCatalogId(params.leftCardId);
  const bond: ElementBond = {
    leftCardId: params.leftCardId,
    rightCardId: params.rightCardId ?? params.leftCardId,
    element: params.element,
    power: params.power,
  };

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.blaze &&
    bond.element === "fire"
  ) {
    return applyDamageToDefender(
      state,
      attackerIsPlayer,
      bond.power * 2,
    );
  }

  if (
    bond.element === "fire" &&
    bondIncludesCatalog("kindle", params.leftCardId, params.rightCardId)
  ) {
    const next = { ...state };
    if (attackerIsPlayer) {
      next.burnOnCpu += bond.power;
    } else {
      next.burnOnPlayer += bond.power;
    }
    return next;
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("glacia", params.leftCardId, params.rightCardId)
  ) {
    const next = { ...state };
    const freezePower = bond.power * 2;
    if (attackerIsPlayer) {
      next.freezeOnCpu += freezePower;
    } else {
      next.freezeOnPlayer += freezePower;
    }
    return next;
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("hoarfrost", params.leftCardId, params.rightCardId)
  ) {
    const frozen = applyInstantCombatBond(state, bond, attackerIsPlayer);
    return applyDamageToDefender(frozen, attackerIsPlayer, bond.power);
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.toxin &&
    bond.element === "poison"
  ) {
    const pierced = pierceDefenderShield(
      state,
      attackerIsPlayer,
      TOXIN_SHIELD_PIERCE,
    );
    return applyInstantCombatBond(pierced, bond, attackerIsPlayer);
  }

  if (
    bond.element === "poison" &&
    bondIncludesCatalog("nightshade", params.leftCardId, params.rightCardId)
  ) {
    const bonus = Math.min(
      defenderPoisonStack(state, attackerIsPlayer),
      NIGHTSHADE_POISON_BONUS_CAP,
    );
    return applyInstantCombatBond(
      state,
      { ...bond, power: bond.power + bonus },
      attackerIsPlayer,
    );
  }

  if (
    bond.element === "poison" &&
    bondIncludesCatalog("syphon", params.leftCardId, params.rightCardId)
  ) {
    const poisoned = applyInstantCombatBond(state, bond, attackerIsPlayer);
    return healAttacker(
      poisoned,
      attackerIsPlayer,
      Math.floor(bond.power / 2),
    );
  }

  if (catalogId === ELEMENT_ABILITY_CATALOG.mend && bond.element === "heal") {
    const healed = applyInstantCombatBond(state, bond, attackerIsPlayer);
    return cleanseAttacker(healed, attackerIsPlayer, MEND_CLEANSE);
  }

  if (
    bond.element === "heal" &&
    bondIncludesCatalog("purge", params.leftCardId, params.rightCardId)
  ) {
    const healed = applyInstantCombatBond(state, bond, attackerIsPlayer);
    return thawAttacker(healed, attackerIsPlayer, PURGE_FREEZE_CLEANSE);
  }

  if (bond.element === "shield") {
    let result = applyInstantCombatBond(state, bond, attackerIsPlayer);
    if (catalogId === ELEMENT_ABILITY_CATALOG.aegis) {
      if (attackerIsPlayer) {
        result.shieldOnPlayer += AEGIS_BONUS_SHIELD;
      } else {
        result.shieldOnCpu += AEGIS_BONUS_SHIELD;
      }
    }
    const bastionInBond = bondIncludesCatalog(
      "bastion",
      params.leftCardId,
      params.rightCardId,
    );
    if (bastionInBond) {
      result = healAttacker(result, attackerIsPlayer, BASTION_HEAL);
    }
    return result;
  }

  return applyInstantCombatBond(state, bond, attackerIsPlayer);
}
