/**
 * Per-card snap and fight abilities for the 67-card mage arena deck.
 */
import type { CardDefinition } from "./cards";
import { printedNumericValue } from "./cardModel";
import { seamKey } from "./connect";
import { buildGroups } from "./scoring";
import { elementCatalogId } from "./elementDeal";
import { isWildcardBridgeCatalogId } from "./elementClassPools";
import {
  applyGenericCombatHit,
  applyInstantCombatBond,
  applyDamageToDefender,
  applyFreezeBondEffect,
  applyFreezeStrike,
  applyPoisonStrike,
  grantVoltBarrier,
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
  flare: "el-02",
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
  surge: "el-22",
  static: "el-23",
  arc: "el-24",
  grind: "el-25",
  fuse: "el-26",
  tailwind: "el-27",
  snipe: "el-28",
  cinder: "el-31",
  brand: "el-32",
  wildfire: "el-33",
  scorch: "el-34",
  inferno: "el-35",
  rime: "el-36",
  bitter: "el-37",
  frostbite: "el-38",
  hail: "el-39",
  avalanche: "el-40",
  spark: "el-41",
  conduit: "el-42",
  cascade: "el-43",
  overload: "el-44",
  breaker: "el-45",
  venin: "el-46",
  rot: "el-47",
  toxicity: "el-48",
  plague: "el-49",
  miasma: "el-50",
  tinderbox: "el-51",
  matchstick: "el-52",
  kindling: "el-57",
  oilFlask: "el-58",
  snowglobe: "el-53",
  icicle: "el-54",
  chilltouch: "el-55",
  blackIce: "el-56",
  shiver: "el-59",
  permafrost: "el-60",
  rimeShard: "el-61",
  gridSurge: "el-62",
  chainLightning: "el-63",
  viperFang: "el-64",
  hemlockNeedle: "el-65",
  snowHare: "el-66",
  frostMite: "el-67",
  faradayCage: "el-68",
  staticWard: "el-69",
} as const;

const BANE_SOLO_POWER = 5;
const SNIPE_SOLO_POWER = 6;
const CLASS_SOLO_POWER = 5;
const MIASMA_POISON_STACK_MULT = 0.75;
const MATCHSTICK_SOLO_POWER = 2;
const MATCHSTICK_SOLO_BURN = 1;
const ICICLE_SOLO_POWER = 3;
const ICICLE_SOLO_FREEZE = 1;
const SHIVER_SOLO_POWER = 3;
const SHIVER_SOLO_FREEZE = 2;
const VIPER_FANG_SOLO_POWER = 2;
const VIPER_FANG_SOLO_POISON = 1;
const VIPER_FANG_ACTIVATED_POISON = 2;
const HEMLOCK_ACTIVATED_POISON = 1;
const SNOW_HARE_SOLO_POWER = 2;
const SNOW_HARE_SOLO_CHILL = 1;
const SNOW_HARE_ACTIVATED_CHILL = 1;
const FROST_MITE_SOLO_POWER = 2;
const FROST_MITE_SOLO_CHILL = 1;
const FROST_MITE_ACTIVATED_CHILL = 2;
const JOLT_SOLO_POWER = 3;
const FARADAY_SOLO_POWER = 3;
const FARADAY_BARRIER = 4;
const FARADAY_ACTIVATE_CHIP = 2;
const STATIC_BARRIER = 3;
const STATIC_ACTIVATE_CHIP = 2;
const CHILLTOUCH_FREEZE_BONUS = 1;
const PERMAFROST_CHIP_BONUS = 2;
const TOXIN_SHIELD_PIERCE = 2;
const ARC_SHIELD_PIERCE = 2;
const BRAND_SHIELD_PIERCE = 1;
const BLACK_ICE_SHIELD_PIERCE = 1;
const ROT_SHIELD_PIERCE = 1;
const MEND_CLEANSE = 2;
const AEGIS_BONUS_SHIELD = 2;
const EMBER_CHAIN_VALUE = 2;
const TAILWIND_CHAIN_TAIL_VALUE = 2;
const NIGHTSHADE_POISON_BONUS_CAP = 3;
const GRIND_DOT_BONUS_CAP = 3;
const HAIL_FREEZE_BONUS_CAP = 2;
const PURGE_FREEZE_CLEANSE = 2;
const FLINT_CHAIN_HEAD_VALUE = 3;
const BASTION_HEAL = 1;
const STATIC_FREEZE_THAW = 1;
const FUSE_VOLT_BONUS = 2;
const WILDFIRE_EXTRA_BURN = 1;
export const OIL_FLASK_BURN_BONUS = 1;
const SCORCH_BURN_BONUS = 1;
const FLARE_BURN_BONUS = 1;
const CASCADE_CHIP_BONUS = 3;
const CHAIN_LIGHTNING_PER_CARD = 3;
const AVALANCHE_CHIP_BONUS = 3;
const HEAL_ON_HIT = 1;
/** Bond power reduction when a wildcard bridge card is on the seam. */
export const WILDCARD_BRIDGE_BOND_PENALTY = 1;

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

/** True when the card is the rightmost card in an affirmed group of length ≥ 2. */
export function isRightmostInAffirmedChain(
  cardId: string,
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): boolean {
  if (!affirmedSeams || affirmedSeams.size === 0) return false;
  for (const group of buildGroups(hand, affirmedSeams)) {
    if (group.length < 2) continue;
    const last = group[group.length - 1];
    if (last.id !== cardId) continue;
    const prev = group[group.length - 2];
    if (affirmedSeams.has(seamKey(prev.id, last.id))) return true;
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

  if (isChainEnabler(catalogId) && inChain) {
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
  if (isClassSoloFinisher(catalogId) && !inChain) {
    return {
      value: CLASS_SOLO_POWER,
      boosted: CLASS_SOLO_POWER > base,
    };
  }
  if (isSoloChipFinisher(catalogId) && !inChain) {
    const solo = soloChipFinisherPower(catalogId);
    return { value: solo, boosted: solo > base };
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
  if (
    catalogId === ELEMENT_ABILITY_CATALOG.tailwind &&
    isRightmostInAffirmedChain(card.id, hand, affirmedSeams)
  ) {
    return {
      value: TAILWIND_CHAIN_TAIL_VALUE,
      boosted: TAILWIND_CHAIN_TAIL_VALUE > base,
    };
  }
  return { value: base, boosted: false };
}

function bondPowerAfterSnap(
  left: CardDefinition,
  right: CardDefinition,
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): number {
  let power =
    snapBondContribution(left, hand, affirmedSeams) +
    snapBondContribution(right, hand, affirmedSeams);
  if (
    isWildcardBridgeCatalogId(elementCatalogId(left.id)) ||
    isWildcardBridgeCatalogId(elementCatalogId(right.id))
  ) {
    power = Math.max(1, power - WILDCARD_BRIDGE_BOND_PENALTY);
  }
  return power;
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
      power: bondPowerAfterSnap(left, right, hand, affirmedSeams),
    };
  });
}

/** Attack queue with Bane solo snap applied. */
export function buildHandAttackQueueWithAbilities(
  hand: CardDefinition[],
  bonds: ElementBond[],
  affirmedSeams: ReadonlySet<string> | null,
): BrawlHandAttack[] {
  const queue = buildHandAttackQueue(hand, bonds, affirmedSeams);
  return queue.map((attack) => {
    if (attack.element || attack.skipAttack) return attack;
    const catalogId = elementCatalogId(attack.id);
    if (catalogId === ELEMENT_ABILITY_CATALOG.bane && !isInAffirmedChain(attack.id, hand, affirmedSeams)) {
      return { ...attack, power: BANE_SOLO_POWER, label: "Solo Hit" };
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.snipe && !isInAffirmedChain(attack.id, hand, affirmedSeams)) {
      return { ...attack, power: SNIPE_SOLO_POWER, label: "Solo Shock" };
    }
    if (
      isClassSoloFinisher(catalogId) &&
      !isInAffirmedChain(attack.id, hand, affirmedSeams)
    ) {
      const label =
        catalogId === ELEMENT_ABILITY_CATALOG.inferno
          ? "Solo Fire"
          : catalogId === ELEMENT_ABILITY_CATALOG.avalanche
            ? "Solo Freeze"
            : catalogId === ELEMENT_ABILITY_CATALOG.breaker
              ? "Solo Shock"
              : "Solo Poison";
      return { ...attack, power: CLASS_SOLO_POWER, label };
    }
    if (
      catalogId === ELEMENT_ABILITY_CATALOG.matchstick &&
      !isInAffirmedChain(attack.id, hand, affirmedSeams)
    ) {
      return { ...attack, power: MATCHSTICK_SOLO_POWER, label: "Solo Spark" };
    }
    if (
      catalogId === ELEMENT_ABILITY_CATALOG.icicle &&
      !isInAffirmedChain(attack.id, hand, affirmedSeams)
    ) {
      return { ...attack, power: ICICLE_SOLO_POWER, label: "Solo Chill" };
    }
    if (
      catalogId === ELEMENT_ABILITY_CATALOG.shiver &&
      !isInAffirmedChain(attack.id, hand, affirmedSeams)
    ) {
      return { ...attack, power: SHIVER_SOLO_POWER, label: "Deep Shiver" };
    }
    if (isSoloChipFinisher(catalogId) && !isInAffirmedChain(attack.id, hand, affirmedSeams)) {
      const power = soloChipFinisherPower(catalogId);
      const label =
        catalogId === ELEMENT_ABILITY_CATALOG.viperFang
          ? "Solo Venom"
          : catalogId === ELEMENT_ABILITY_CATALOG.snowHare
            ? "Solo Chill"
            : catalogId === ELEMENT_ABILITY_CATALOG.frostMite
              ? "Solo Chill"
              : catalogId === ELEMENT_ABILITY_CATALOG.faradayCage
                ? "Solo Shock"
                : catalogId === ELEMENT_ABILITY_CATALOG.jolt
                  ? "Solo Shock"
                  : "Solo Hit";
      return { ...attack, power, label };
    }
    return attack;
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

function defenderDotStackTotal(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  if (attackerIsPlayer) {
    return state.burnOnCpu + state.poisonOnCpu;
  }
  return state.burnOnPlayer + state.poisonOnPlayer;
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

function isChainEnabler(catalogId: string): boolean {
  return (
    catalogId === ELEMENT_ABILITY_CATALOG.ember ||
    catalogId === ELEMENT_ABILITY_CATALOG.cinder ||
    catalogId === ELEMENT_ABILITY_CATALOG.rime ||
    catalogId === ELEMENT_ABILITY_CATALOG.spark ||
    catalogId === ELEMENT_ABILITY_CATALOG.venin
  );
}

function isClassSoloFinisher(catalogId: string): boolean {
  return (
    catalogId === ELEMENT_ABILITY_CATALOG.inferno ||
    catalogId === ELEMENT_ABILITY_CATALOG.avalanche ||
    catalogId === ELEMENT_ABILITY_CATALOG.breaker ||
    catalogId === ELEMENT_ABILITY_CATALOG.miasma
  );
}

function isSoloChipFinisher(catalogId: string): boolean {
  return (
    catalogId === ELEMENT_ABILITY_CATALOG.matchstick ||
    catalogId === ELEMENT_ABILITY_CATALOG.icicle ||
    catalogId === ELEMENT_ABILITY_CATALOG.shiver ||
    catalogId === ELEMENT_ABILITY_CATALOG.viperFang ||
    catalogId === ELEMENT_ABILITY_CATALOG.snowHare ||
    catalogId === ELEMENT_ABILITY_CATALOG.frostMite ||
    catalogId === ELEMENT_ABILITY_CATALOG.faradayCage ||
    catalogId === ELEMENT_ABILITY_CATALOG.jolt
  );
}

function soloChipFinisherPower(catalogId: string): number {
  if (catalogId === ELEMENT_ABILITY_CATALOG.icicle) return ICICLE_SOLO_POWER;
  if (catalogId === ELEMENT_ABILITY_CATALOG.shiver) return SHIVER_SOLO_POWER;
  if (catalogId === ELEMENT_ABILITY_CATALOG.viperFang) return VIPER_FANG_SOLO_POWER;
  if (catalogId === ELEMENT_ABILITY_CATALOG.snowHare) return SNOW_HARE_SOLO_POWER;
  if (catalogId === ELEMENT_ABILITY_CATALOG.frostMite) return FROST_MITE_SOLO_POWER;
  if (catalogId === ELEMENT_ABILITY_CATALOG.faradayCage) return FARADAY_SOLO_POWER;
  if (catalogId === ELEMENT_ABILITY_CATALOG.jolt) return JOLT_SOLO_POWER;
  return MATCHSTICK_SOLO_POWER;
}

function defenderBurnStack(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  return attackerIsPlayer ? state.burnOnCpu : state.burnOnPlayer;
}

function defenderFreezeStack(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
): number {
  return attackerIsPlayer ? state.freezeOnCpu : state.freezeOnPlayer;
}

function defenderWasChipped(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
): boolean {
  return attackerIsPlayer
    ? state.cpuHP < BRAWL_START_HP
    : state.playerHP < BRAWL_START_HP;
}

function attackerHandHasOilFlask(handCatalogIds?: readonly string[]): boolean {
  return handCatalogIds?.includes(ELEMENT_ABILITY_CATALOG.oilFlask) ?? false;
}

/** +1 burn when Oil Flask is in the attacker's locked hand and a fire hit applied burn. */
function applyOilFlaskBurnBonus(
  before: ElementCombatState,
  after: ElementCombatState,
  params: {
    element?: Element;
    leftCardId: string;
  },
  attackerIsPlayer: boolean,
  handCatalogIds?: readonly string[],
): ElementCombatState {
  if (!attackerHandHasOilFlask(handCatalogIds)) return after;
  const burnBefore = defenderBurnStack(before, attackerIsPlayer);
  const burnAfter = defenderBurnStack(after, attackerIsPlayer);
  if (burnAfter <= burnBefore) return after;
  const next = { ...after };
  if (attackerIsPlayer) {
    next.burnOnCpu += OIL_FLASK_BURN_BONUS;
  } else {
    next.burnOnPlayer += OIL_FLASK_BURN_BONUS;
  }
  return next;
}

function finishCombatHit(
  before: ElementCombatState,
  after: ElementCombatState,
  params: {
    element?: Element;
    leftCardId: string;
    attackerHandCatalogIds?: readonly string[];
  },
  attackerIsPlayer: boolean,
): ElementCombatState {
  return applyOilFlaskBurnBonus(
    before,
    after,
    params,
    attackerIsPlayer,
    params.attackerHandCatalogIds,
  );
}

/** Resolve one card hit with catalog fight abilities. */
export type DefenderLayoutMetrics = {
  maxChainLength: number;
  connectedCardCount: number;
  seamCount: number;
};

export function applyElementCombatHit(
  state: ElementCombatState,
  params: {
    element?: Element;
    power: number;
    leftCardId: string;
    rightCardId?: string;
    /** Affirmed group size for freeze chip scaling (solo = 1, chain = N). */
    combineCount?: number;
    /** Catalog ids in the attacker's locked hand (Oil Flask passive). */
    attackerHandCatalogIds?: readonly string[];
    /** Foe layout at lock-in — scales Grid Surge / Chain Lightning. */
    defenderLayout?: DefenderLayoutMetrics;
  },
  attackerIsPlayer: boolean,
): ElementCombatState {
  const before = state;
  const after = resolveElementCombatHit(state, params, attackerIsPlayer);
  return finishCombatHit(before, after, params, attackerIsPlayer);
}

function resolveElementCombatHit(
  state: ElementCombatState,
  params: {
    element?: Element;
    power: number;
    leftCardId: string;
    rightCardId?: string;
    combineCount?: number;
    attackerHandCatalogIds?: readonly string[];
    defenderLayout?: DefenderLayoutMetrics;
  },
  attackerIsPlayer: boolean,
): ElementCombatState {
  const freezeOpts =
    params.combineCount != null
      ? { combineCount: params.combineCount }
      : undefined;

  if (!params.element) {
    const catalogId = elementCatalogId(params.leftCardId);
    if (catalogId === ELEMENT_ABILITY_CATALOG.matchstick) {
      const hit = applyGenericCombatHit(state, params.power, attackerIsPlayer);
      if (attackerIsPlayer) {
        hit.burnOnCpu += MATCHSTICK_SOLO_BURN;
      } else {
        hit.burnOnPlayer += MATCHSTICK_SOLO_BURN;
      }
      return hit;
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.icicle) {
      const hit = applyGenericCombatHit(state, params.power, attackerIsPlayer);
      if (attackerIsPlayer) {
        hit.freezeOnCpu += ICICLE_SOLO_FREEZE;
      } else {
        hit.freezeOnPlayer += ICICLE_SOLO_FREEZE;
      }
      return hit;
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.shiver) {
      const hit = applyGenericCombatHit(state, params.power, attackerIsPlayer);
      if (attackerIsPlayer) {
        hit.freezeOnCpu += SHIVER_SOLO_FREEZE;
      } else {
        hit.freezeOnPlayer += SHIVER_SOLO_FREEZE;
      }
      return hit;
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.viperFang) {
      return applyPoisonStrike(
        state,
        attackerIsPlayer,
        VIPER_FANG_SOLO_POWER,
        VIPER_FANG_SOLO_POISON,
      );
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.snowHare) {
      return applyFreezeStrike(
        state,
        attackerIsPlayer,
        SNOW_HARE_SOLO_POWER,
        SNOW_HARE_SOLO_CHILL,
        1,
      );
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.frostMite) {
      return applyFreezeStrike(
        state,
        attackerIsPlayer,
        FROST_MITE_SOLO_POWER,
        FROST_MITE_SOLO_CHILL,
        1,
      );
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.faradayCage) {
      return applyGenericCombatHit(
        state,
        FARADAY_SOLO_POWER,
        attackerIsPlayer,
      );
    }
    if (catalogId === ELEMENT_ABILITY_CATALOG.jolt) {
      return applyGenericCombatHit(
        state,
        JOLT_SOLO_POWER,
        attackerIsPlayer,
      );
    }
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
    return applyDamageToDefender(state, attackerIsPlayer, bond.power * 2, {
      fromCardAttack: true,
    });
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.surge &&
    bond.element === "volt"
  ) {
    return applyDamageToDefender(state, attackerIsPlayer, bond.power * 2, {
      fromCardAttack: true,
    });
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.overload &&
    bond.element === "volt"
  ) {
    return applyDamageToDefender(state, attackerIsPlayer, bond.power * 2, {
      fromCardAttack: true,
    });
  }

  if (
    bond.element === "fire" &&
    bondIncludesCatalog("brand", params.leftCardId, params.rightCardId)
  ) {
    const pierced = pierceDefenderShield(
      state,
      attackerIsPlayer,
      BRAND_SHIELD_PIERCE,
    );
    return applyInstantCombatBond(pierced, bond, attackerIsPlayer);
  }

  if (
    bond.element === "fire" &&
    bondIncludesCatalog("wildfire", params.leftCardId, params.rightCardId)
  ) {
    const fired = applyInstantCombatBond(state, bond, attackerIsPlayer);
    if (attackerIsPlayer) {
      fired.burnOnCpu += WILDFIRE_EXTRA_BURN;
    } else {
      fired.burnOnPlayer += WILDFIRE_EXTRA_BURN;
    }
    return fired;
  }

  if (
    bond.element === "fire" &&
    bondIncludesCatalog("scorch", params.leftCardId, params.rightCardId) &&
    defenderBurnStack(state, attackerIsPlayer) > 0
  ) {
    return applyInstantCombatBond(
      state,
      { ...bond, power: bond.power + SCORCH_BURN_BONUS },
      attackerIsPlayer,
    );
  }

  if (
    bond.element === "fire" &&
    bondIncludesCatalog("flare", params.leftCardId, params.rightCardId) &&
    defenderBurnStack(state, attackerIsPlayer) > 0
  ) {
    const fired = applyInstantCombatBond(state, bond, attackerIsPlayer);
    if (attackerIsPlayer) {
      fired.burnOnCpu += FLARE_BURN_BONUS;
    } else {
      fired.burnOnPlayer += FLARE_BURN_BONUS;
    }
    return fired;
  }

  if (
    bond.element === "fire" &&
    bondIncludesCatalog("fuse", params.leftCardId, params.rightCardId)
  ) {
    const fired = applyInstantCombatBond(state, bond, attackerIsPlayer);
    return applyDamageToDefender(fired, attackerIsPlayer, FUSE_VOLT_BONUS, {
      fromCardAttack: true,
    });
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
    bondIncludesCatalog("blackIce", params.leftCardId, params.rightCardId)
  ) {
    const pierced = pierceDefenderShield(
      state,
      attackerIsPlayer,
      BLACK_ICE_SHIELD_PIERCE,
    );
    return applyInstantCombatBond(pierced, bond, attackerIsPlayer, freezeOpts);
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("frostbite", params.leftCardId, params.rightCardId)
  ) {
    const frozen = applyInstantCombatBond(
      state,
      bond,
      attackerIsPlayer,
      freezeOpts,
    );
    return healAttacker(frozen, attackerIsPlayer, HEAL_ON_HIT);
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("hail", params.leftCardId, params.rightCardId)
  ) {
    const bonus = Math.min(
      HAIL_FREEZE_BONUS_CAP,
      Math.floor(defenderFreezeStack(state, attackerIsPlayer) / 4),
    );
    return applyFreezeBondEffect(
      state,
      attackerIsPlayer,
      bond.power,
      bond.power + bonus,
      params.combineCount ?? 2,
    );
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("chilltouch", params.leftCardId, params.rightCardId) &&
    defenderFreezeStack(state, attackerIsPlayer) > 0
  ) {
    return applyInstantCombatBond(
      state,
      { ...bond, power: bond.power + CHILLTOUCH_FREEZE_BONUS },
      attackerIsPlayer,
      freezeOpts,
    );
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("permafrost", params.leftCardId, params.rightCardId) &&
    defenderFreezeStack(state, attackerIsPlayer) > 0
  ) {
    const frozen = applyInstantCombatBond(
      state,
      bond,
      attackerIsPlayer,
      freezeOpts,
    );
    return applyDamageToDefender(
      frozen,
      attackerIsPlayer,
      PERMAFROST_CHIP_BONUS,
      { fromCardAttack: true },
    );
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("avalanche", params.leftCardId, params.rightCardId)
  ) {
    const frozen = applyInstantCombatBond(
      state,
      bond,
      attackerIsPlayer,
      freezeOpts,
    );
    return applyDamageToDefender(
      frozen,
      attackerIsPlayer,
      AVALANCHE_CHIP_BONUS,
      { fromCardAttack: true },
    );
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("glacia", params.leftCardId, params.rightCardId)
  ) {
    return applyFreezeBondEffect(
      state,
      attackerIsPlayer,
      bond.power,
      bond.power * 2,
      params.combineCount ?? 2,
    );
  }

  if (
    bond.element === "freeze" &&
    bondIncludesCatalog("hoarfrost", params.leftCardId, params.rightCardId)
  ) {
    return applyInstantCombatBond(state, bond, attackerIsPlayer, freezeOpts);
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.viperFang &&
    bond.element === "poison"
  ) {
    return applyPoisonStrike(
      state,
      attackerIsPlayer,
      bond.power,
      VIPER_FANG_ACTIVATED_POISON,
    );
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.hemlockNeedle &&
    bond.element === "poison"
  ) {
    return applyPoisonStrike(
      state,
      attackerIsPlayer,
      bond.power,
      HEMLOCK_ACTIVATED_POISON,
    );
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.snowHare &&
    bond.element === "freeze"
  ) {
    return applyFreezeStrike(
      state,
      attackerIsPlayer,
      bond.power,
      SNOW_HARE_ACTIVATED_CHILL,
      params.combineCount ?? 2,
    );
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.frostMite &&
    bond.element === "freeze"
  ) {
    return applyFreezeStrike(
      state,
      attackerIsPlayer,
      bond.power,
      FROST_MITE_ACTIVATED_CHILL,
      params.combineCount ?? 2,
    );
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.faradayCage &&
    bond.element === "volt"
  ) {
    const barrier = grantVoltBarrier(state, attackerIsPlayer, FARADAY_BARRIER);
    return applyDamageToDefender(
      barrier,
      attackerIsPlayer,
      Math.max(FARADAY_ACTIVATE_CHIP, bond.power),
      { fromCardAttack: true },
    );
  }

  if (
    catalogId === ELEMENT_ABILITY_CATALOG.staticWard &&
    bond.element === "volt"
  ) {
    const barrier = grantVoltBarrier(state, attackerIsPlayer, STATIC_BARRIER);
    return applyDamageToDefender(
      barrier,
      attackerIsPlayer,
      Math.max(STATIC_ACTIVATE_CHIP, bond.power),
      { fromCardAttack: true },
    );
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
    bondIncludesCatalog("rot", params.leftCardId, params.rightCardId)
  ) {
    const pierced = pierceDefenderShield(
      state,
      attackerIsPlayer,
      ROT_SHIELD_PIERCE,
    );
    return applyInstantCombatBond(pierced, bond, attackerIsPlayer);
  }

  if (
    bond.element === "poison" &&
    bondIncludesCatalog("toxicity", params.leftCardId, params.rightCardId) &&
    defenderDotStackTotal(state, attackerIsPlayer) > 0
  ) {
    return applyInstantCombatBond(
      state,
      { ...bond, power: bond.power + 1 },
      attackerIsPlayer,
    );
  }

  if (
    bond.element === "poison" &&
    bondIncludesCatalog("plague", params.leftCardId, params.rightCardId)
  ) {
    const poisoned = applyInstantCombatBond(state, bond, attackerIsPlayer);
    return healAttacker(poisoned, attackerIsPlayer, HEAL_ON_HIT);
  }

  if (
    bond.element === "poison" &&
    bondIncludesCatalog("miasma", params.leftCardId, params.rightCardId)
  ) {
    const poisoned = applyInstantCombatBond(state, bond, attackerIsPlayer);
    const extra = Math.max(1, Math.floor(bond.power * MIASMA_POISON_STACK_MULT));
    if (attackerIsPlayer) {
      poisoned.poisonOnCpu += extra;
    } else {
      poisoned.poisonOnPlayer += extra;
    }
    return poisoned;
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

  if (bondIncludesCatalog("grind", params.leftCardId, params.rightCardId)) {
    const bonus = Math.min(
      defenderDotStackTotal(state, attackerIsPlayer),
      GRIND_DOT_BONUS_CAP,
    );
    return applyInstantCombatBond(
      state,
      { ...bond, power: bond.power + bonus },
      attackerIsPlayer,
    );
  }

  if (
    bond.element === "volt" &&
    bondIncludesCatalog("conduit", params.leftCardId, params.rightCardId)
  ) {
    const shocked = applyDamageToDefender(state, attackerIsPlayer, bond.power, {
      fromCardAttack: true,
    });
    return healAttacker(shocked, attackerIsPlayer, HEAL_ON_HIT);
  }

  if (
    bond.element === "volt" &&
    bondIncludesCatalog("gridSurge", params.leftCardId, params.rightCardId)
  ) {
    const seams = params.defenderLayout?.seamCount ?? 0;
    return applyDamageToDefender(
      state,
      attackerIsPlayer,
      bond.power + seams,
      { fromCardAttack: true },
    );
  }

  if (
    bond.element === "volt" &&
    bondIncludesCatalog("chainLightning", params.leftCardId, params.rightCardId)
  ) {
    const chain = Math.max(1, params.defenderLayout?.maxChainLength ?? 1);
    return applyDamageToDefender(
      state,
      attackerIsPlayer,
      bond.power + chain * CHAIN_LIGHTNING_PER_CARD,
      { fromCardAttack: true },
    );
  }

  if (
    bond.element === "volt" &&
    bondIncludesCatalog("cascade", params.leftCardId, params.rightCardId) &&
    defenderWasChipped(state, attackerIsPlayer)
  ) {
    return applyDamageToDefender(
      state,
      attackerIsPlayer,
      bond.power + CASCADE_CHIP_BONUS,
      { fromCardAttack: true },
    );
  }

  if (
    bond.element === "volt" &&
    bondIncludesCatalog("breaker", params.leftCardId, params.rightCardId)
  ) {
    const pierced = pierceDefenderShield(
      state,
      attackerIsPlayer,
      ARC_SHIELD_PIERCE,
    );
    return applyDamageToDefender(pierced, attackerIsPlayer, bond.power, {
      fromCardAttack: true,
    });
  }

  if (
    bond.element === "volt" &&
    bondIncludesCatalog("arc", params.leftCardId, params.rightCardId)
  ) {
    const pierced = pierceDefenderShield(
      state,
      attackerIsPlayer,
      ARC_SHIELD_PIERCE,
    );
    return applyDamageToDefender(pierced, attackerIsPlayer, bond.power, {
      fromCardAttack: true,
    });
  }

  if (
    bond.element === "volt" &&
    bondIncludesCatalog("static", params.leftCardId, params.rightCardId)
  ) {
    const shocked = applyDamageToDefender(state, attackerIsPlayer, bond.power, {
      fromCardAttack: true,
    });
    return thawAttacker(shocked, attackerIsPlayer, STATIC_FREEZE_THAW);
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
    if (
      bondIncludesCatalog("bitter", params.leftCardId, params.rightCardId)
    ) {
      if (attackerIsPlayer) {
        result.freezeOnCpu += HEAL_ON_HIT;
      } else {
        result.freezeOnPlayer += HEAL_ON_HIT;
      }
    }
    return result;
  }

  return applyInstantCombatBond(state, bond, attackerIsPlayer, freezeOpts);
}
