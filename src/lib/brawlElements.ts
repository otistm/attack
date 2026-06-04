/**
 * Brawl element bonds — shape snaps map to elements; bond power drives effects.
 *
 * Fire (burn) and poison: instant hit damage on impact, then the bond power
 * also stacks as DoT that ticks down the defender's HP over time.
 */
import type { CardDefinition } from "./cards";
import type { ShapeType } from "../components/cardShapes";
import { SHAPE_COLORS } from "../components/cardShapes";
import { canConnectAny, seamKey } from "./connect";
import { printedNumericValue } from "./cardModel";
import { buildGroups } from "./scoring";

export type Element = "fire" | "freeze" | "poison" | "shield" | "heal" | "volt";

/** Shapes that participate in brawl element bonds. */
export const ELEMENT_SHAPES: ShapeType[] = [
  "square",
  "circle",
  "triangle",
  "diamond",
  "hexagon",
  "star",
];

export const ELEMENT_LABEL: Record<Element, string> = {
  fire: "Fire",
  freeze: "Freeze",
  poison: "Poison",
  shield: "Shield",
  heal: "Heal",
  volt: "Volt",
};

export function shapeToElement(shape: ShapeType): Element | null {
  switch (shape) {
    case "square":
      return "fire";
    case "circle":
      return "freeze";
    case "triangle":
      return "poison";
    case "diamond":
      return "shield";
    case "hexagon":
      return "heal";
    case "star":
      return "volt";
    default:
      return null;
  }
}

/** Border pulse tokens for affirmed brawl connections (matches shape colors). */
export const BRAWL_ELEMENT_BORDER: Record<
  Element,
  { rest: string; pulse: string; shadowLow: string; shadowHigh: string }
> = {
  fire: {
    rest: SHAPE_COLORS.square,
    pulse: "#f87171",
    shadowLow: "rgba(239,68,68,0.4)",
    shadowHigh: "rgba(239,68,68,0.75)",
  },
  freeze: {
    rest: SHAPE_COLORS.circle,
    pulse: "#60a5fa",
    shadowLow: "rgba(59,130,246,0.4)",
    shadowHigh: "rgba(59,130,246,0.75)",
  },
  poison: {
    rest: SHAPE_COLORS.triangle,
    pulse: "#c084fc",
    shadowLow: "rgba(168,85,247,0.4)",
    shadowHigh: "rgba(168,85,247,0.75)",
  },
  shield: {
    rest: SHAPE_COLORS.diamond,
    pulse: "#fde047",
    shadowLow: "rgba(234,179,8,0.4)",
    shadowHigh: "rgba(234,179,8,0.75)",
  },
  heal: {
    rest: SHAPE_COLORS.hexagon,
    pulse: "#34d399",
    shadowLow: "rgba(16,185,129,0.4)",
    shadowHigh: "rgba(16,185,129,0.75)",
  },
  volt: {
    rest: SHAPE_COLORS.star,
    pulse: "#fbbf24",
    shadowLow: "rgba(245,158,11,0.4)",
    shadowHigh: "rgba(245,158,11,0.75)",
  },
};

/**
 * Border tone for an affirmed brawl seam. The left card of a bond uses its
 * right shape; the right partner uses its left shape (the matching seam).
 */
export function brawlConnectionBorderTone(
  leftShape: ShapeType,
  rightShape: ShapeType,
  isConnectedLeft: boolean,
  isConnectedRight: boolean,
): (typeof BRAWL_ELEMENT_BORDER)[Element] | null {
  if (!isConnectedLeft && !isConnectedRight) return null;
  const seamShape = isConnectedRight ? rightShape : leftShape;
  const element = shapeToElement(seamShape);
  if (!element) return null;
  return BRAWL_ELEMENT_BORDER[element];
}

export interface ElementBond {
  leftCardId: string;
  rightCardId: string;
  element: Element;
  /** Sum of the two snapped cards' printed values. */
  power: number;
}

/** Pending DoT on a side — fire and poison both land here. */
export interface DotStack {
  /** Remaining damage to tick off. */
  remaining: number;
  /** Visual flavor only; resolver treats fire and poison identically. */
  flavor: "fire" | "poison";
}

export interface ElementCombatState {
  playerHP: number;
  cpuHP: number;
  /** Pending burn damage on the player (ticks down over time). */
  burnOnPlayer: number;
  poisonOnPlayer: number;
  burnOnCpu: number;
  poisonOnCpu: number;
  /** Remaining absorb pool — blocks HP loss until depleted by incoming damage. */
  shieldOnPlayer: number;
  shieldOnCpu: number;
  /** Freeze stack — adds delay to that side's attack cooldown (stacks). */
  freezeOnPlayer: number;
  freezeOnCpu: number;
}

export const BRAWL_START_HP = 100;
/** How often burn/poison stacks tick during combat. */
export const BRAWL_DOT_TICK_MS = 1000;
/** Damage dealt per DoT tick (1 point of stack consumed per damage). */
export const BRAWL_DOT_DAMAGE_PER_TICK = 1;

export function freshElementCombatState(): ElementCombatState {
  return {
    playerHP: BRAWL_START_HP,
    cpuHP: BRAWL_START_HP,
    burnOnPlayer: 0,
    poisonOnPlayer: 0,
    burnOnCpu: 0,
    poisonOnCpu: 0,
    shieldOnPlayer: 0,
    shieldOnCpu: 0,
    freezeOnPlayer: 0,
    freezeOnCpu: 0,
  };
}

/** Base interval between projectiles when no cards are connected (5s). */
export const BRAWL_ATTACK_COOLDOWN_BASE_MS = 5000;

/**
 * Attack cooldown for a side given its longest affirmed chain.
 * 2 connected cards → −1s (4s), 3 → −2s (3s), etc.
 * A lone card (length 1) keeps the full 5s gap.
 */
export function brawlAttackCooldownMs(maxChainLength: number): number {
  const reductionSec = Math.max(0, maxChainLength - 1);
  return Math.max(0, BRAWL_ATTACK_COOLDOWN_BASE_MS - reductionSec * 1000);
}

/** Cooldown slot for one attack group from its card count (solo = 5s, pair = 4s, …). */
export function brawlGroupSlotCooldownMs(groupLength: number): number {
  return brawlAttackCooldownMs(Math.max(1, groupLength));
}

/**
 * Per-card cooldown overlay duration — always ≤ 5s (chain-reduced), never the
 * full multi-group rotation period.
 */
export function brawlCardOverlayCooldownMs(groupLength: number): number {
  return Math.min(
    BRAWL_ATTACK_COOLDOWN_BASE_MS,
    brawlGroupSlotCooldownMs(groupLength),
  );
}

/** Full side rotation — sum of each attack group's slot. */
export function brawlSideRotationPeriodMs(
  groups: ReadonlyArray<{ length: number }>,
): number {
  if (groups.length === 0) return brawlAttackCooldownMs(1);
  return groups.reduce(
    (sum, group) => sum + brawlGroupSlotCooldownMs(group.length),
    0,
  );
}

/** Ms from lock-in until an attack group's first fire (intro + staggered slots). */
export function brawlGroupFirstFireMs(
  groupIndex: number,
  groups: ReadonlyArray<{ length: number }>,
  combatLeadMs: number,
): number {
  let ms = combatLeadMs;
  for (let i = 0; i <= groupIndex; i++) {
    ms += brawlGroupSlotCooldownMs(groups[i]?.length ?? 1);
  }
  return ms;
}

/** Ms added to one random defender card's cooldown each time freeze lands. */
export const FREEZE_COOLDOWN_PAUSE_MS = 1500;

/** Side attack slot duration (chain-reduced base). Freeze pauses timers separately. */
export function brawlEffectiveAttackCooldownMs(
  baseMs: number,
  _freezeStack: number = 0,
): number {
  return baseMs;
}

/**
 * Cooldown overlay duration on each card — one side slot (~5s base), not the
 * full multi-group rotation period. Freeze pauses the countdown; it does not
 * add extra ms to this value.
 */
export function brawlCooldownDisplayMs(
  sideCooldownMs: number,
  _freezeStack: number = 0,
): number {
  return sideCooldownMs;
}

/**
 * Ms until an attack group fires again. Each group slot uses its own chain
 * length; a fully connected hand is one group and re-attacks every slot.
 */
export function brawlGroupReattackMs(
  groups: ReadonlyArray<{ length: number }>,
  _legacyGroupCount?: number,
  _legacySideCooldownMs?: number,
): number {
  return brawlSideRotationPeriodMs(groups);
}

/**
 * @deprecated Use {@link brawlGroupFirstFireMs} with attack groups.
 */
export function brawlGroupInitialCooldownMs(
  groupIndex: number,
  sideCooldownMs: number,
  combatLeadMs: number,
  _freezeStack: number = 0,
): number {
  return combatLeadMs + (groupIndex + 1) * sideCooldownMs;
}

/** Freeze wears down as the chilled side attacks. */
export function consumeAttackerFreeze(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
  amount: number,
): ElementCombatState {
  const next = { ...state };
  const burn = Math.max(0, amount);
  if (attackerIsPlayer) {
    next.freezeOnPlayer = Math.max(0, next.freezeOnPlayer - burn);
  } else {
    next.freezeOnCpu = Math.max(0, next.freezeOnCpu - burn);
  }
  return next;
}

/** Longest adjacent affirmed group in the hand (minimum 1). */
export function maxAffirmedChainLength(
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): number {
  if (!affirmedSeams || affirmedSeams.size === 0) return 1;
  const groups = buildGroups(hand, affirmedSeams);
  let max = 1;
  for (const group of groups) {
    if (group.length >= 2) max = Math.max(max, group.length);
  }
  return max;
}

/**
 * Parse affirmed seams into element bonds. Only consecutive pairs inside a
 * group of length ≥ 2 with an affirmed seam emit a bond.
 */
export function computeElementBonds(
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): ElementBond[] {
  if (!affirmedSeams || affirmedSeams.size === 0) return [];
  const groups = buildGroups(hand, affirmedSeams);
  const bonds: ElementBond[] = [];

  for (const group of groups) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      const left = group[i - 1];
      const right = group[i];
      if (!canConnectAny(left, right)) continue;
      if (!affirmedSeams.has(seamKey(left.id, right.id))) continue;
      const shape = left.rightShape;
      const element = shapeToElement(shape);
      if (!element) continue;
      if (shape !== right.leftShape) continue;
      bonds.push({
        leftCardId: left.id,
        rightCardId: right.id,
        element,
        power:
          printedNumericValue(left) + printedNumericValue(right),
      });
    }
  }
  return bonds;
}

/** One card's slot in the continuous attack rotation. */
export interface BrawlHandAttack {
  id: string;
  /** Bond partner when this card applies an element from a connection. */
  rightCardId?: string;
  power: number;
  element?: Element;
  label: string;
  /**
   * Right-hand partner in a bond — contributes to the left card's effect but
   * does not attack on its own when the chain fires together.
   */
  skipAttack?: boolean;
  /** Cards in the affirmed attack group — drives freeze chip scaling. */
  combineCount?: number;
}

/** Extra chip on freeze chains so long Ren weaves still pressure HP. */
export const FREEZE_CHIP_CHAIN_BUFFER = 2;

/** Chip damage from a freeze bond or solo freeze card. */
export function freezeChipDamage(
  power: number,
  combineCount: number,
): number {
  if (combineCount <= 1) return Math.max(0, power);
  return Math.max(1, power - combineCount + FREEZE_CHIP_CHAIN_BUFFER);
}

/** Apply freeze stacks plus scaled chip damage. */
export function applyFreezeBondEffect(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
  bondPower: number,
  freezeStacks: number,
  combineCount: number = 2,
): ElementCombatState {
  const chip = freezeChipDamage(bondPower, combineCount);
  let next: ElementCombatState = { ...state };
  if (chip > 0) {
    next = applyDamageToDefender(next, attackerIsPlayer, chip);
  }
  const stacks = Math.max(0, freezeStacks);
  if (attackerIsPlayer) next.freezeOnCpu += stacks;
  else next.freezeOnPlayer += stacks;
  return next;
}

/**
 * Every card in the hand attacks on cooldown. Only cards that are the left
 * card of an affirmed bond apply that bond's element effect.
 */
export function buildHandAttackQueue(
  hand: CardDefinition[],
  bonds: ElementBond[],
  affirmedSeams: ReadonlySet<string> | null = null,
): BrawlHandAttack[] {
  const bondByLeft = new Map(bonds.map((b) => [b.leftCardId, b]));
  const bondRightIds = new Set(bonds.map((b) => b.rightCardId));
  const bondLeftIds = new Set(bonds.map((b) => b.leftCardId));
  const groupSizeByCard = new Map<string, number>();
  for (const group of buildGroups(hand, affirmedSeams)) {
    for (const card of group) {
      groupSizeByCard.set(card.id, group.length);
    }
  }
  return hand.map((card) => {
    const combineCount = groupSizeByCard.get(card.id) ?? 1;
    const bond = bondByLeft.get(card.id);
    if (bond) {
      return {
        id: card.id,
        rightCardId: bond.rightCardId,
        power: bond.power,
        element: bond.element,
        label: ELEMENT_LABEL[bond.element],
        combineCount,
      };
    }
    const power = printedNumericValue(card);
    const skipAttack = bondRightIds.has(card.id) && !bondLeftIds.has(card.id);
    return {
      id: card.id,
      power,
      label: "Hit",
      skipAttack,
      combineCount,
    };
  });
}

/**
 * Connected hand segments share one attack slot and one cooldown timer.
 * Isolated cards each form a group of one.
 */
export function buildHandAttackGroups(
  hand: CardDefinition[],
  bonds: ElementBond[],
  affirmedSeams: ReadonlySet<string> | null,
): BrawlHandAttack[][] {
  const byId = new Map(
    buildHandAttackQueue(hand, bonds, affirmedSeams).map((a) => [a.id, a]),
  );
  return buildGroups(hand, affirmedSeams).map((group) =>
    group
      .map((c) => byId.get(c.id))
      .filter((a): a is BrawlHandAttack => a != null),
  );
}

/** Apply damage to the defender's HP (through shield). */
export function applyDamageToDefender(
  state: ElementCombatState,
  attackerIsPlayer: boolean,
  damage: number,
): ElementCombatState {
  const dmg = Math.max(0, damage);
  const next = { ...state };
  if (attackerIsPlayer) {
    const res = applyDamageThroughShield(next.cpuHP, next.shieldOnCpu, dmg);
    next.cpuHP = res.hp;
    next.shieldOnCpu = res.shield;
  } else {
    const res = applyDamageThroughShield(next.playerHP, next.shieldOnPlayer, dmg);
    next.playerHP = res.hp;
    next.shieldOnPlayer = res.shield;
  }
  return next;
}
/** Plain card hit — instant HP damage, no element effect. */
export function applyGenericCombatHit(
  state: ElementCombatState,
  power: number,
  attackerIsPlayer: boolean,
): ElementCombatState {
  return applyDamageToDefender(state, attackerIsPlayer, power);
}

/** Tick burn/poison stacks once during continuous combat. */
export function tickCombatDotStacks(state: ElementCombatState): ElementCombatState {
  const next = { ...state };
  const tickSide = (
    burn: number,
    poison: number,
    hp: number,
    shield: number,
  ): { burn: number; poison: number; hp: number; shield: number } => {
    let b = burn;
    let p = poison;
    let h = hp;
    let s = shield;
    const applyTick = (stack: number): number => {
      if (stack <= 0) return stack;
      const dmg = Math.min(stack, BRAWL_DOT_DAMAGE_PER_TICK);
      const res = applyDamageThroughShield(h, s, dmg);
      h = res.hp;
      s = res.shield;
      return stack - dmg;
    };
    b = applyTick(b);
    p = applyTick(p);
    return { burn: b, poison: p, hp: h, shield: s };
  };

  const player = tickSide(
    next.burnOnPlayer,
    next.poisonOnPlayer,
    next.playerHP,
    next.shieldOnPlayer,
  );
  next.burnOnPlayer = player.burn;
  next.poisonOnPlayer = player.poison;
  next.playerHP = player.hp;
  next.shieldOnPlayer = player.shield;

  const cpu = tickSide(
    next.burnOnCpu,
    next.poisonOnCpu,
    next.cpuHP,
    next.shieldOnCpu,
  );
  next.burnOnCpu = cpu.burn;
  next.poisonOnCpu = cpu.poison;
  next.cpuHP = cpu.hp;
  next.shieldOnCpu = cpu.shield;

  return next;
}

/** Apply a DoT stack — fire and poison use the same path. */
export function applyDot(
  existing: DotStack | null,
  flavor: "fire" | "poison",
  power: number,
): DotStack {
  const add = Math.max(0, power);
  if (!existing) return { remaining: add, flavor };
  return {
    remaining: existing.remaining + add,
    // Keep the first flavor for VFX; stacking is additive either way.
    flavor: existing.flavor,
  };
}

/**
 * Resolve one bond against the defender's combat state.
 * Returns HP delta applied immediately (shield/freeze/heal) and side-effect
 * patches. Fire and poison defer damage — they only grow the DoT stack.
 */
export interface BondResolveResult {
  immediateHpDelta: number;
  dotOnDefender?: DotStack | null;
  shieldOnDefender?: number;
  freezeOnDefender?: number;
  healOnAttacker?: number;
}

export function resolveBondHit(
  bond: ElementBond,
  defender: Pick<
    ElementCombatState,
    | "shieldOnPlayer"
    | "shieldOnCpu"
    | "freezeOnPlayer"
    | "freezeOnCpu"
    | "burnOnPlayer"
    | "poisonOnPlayer"
    | "burnOnCpu"
    | "poisonOnCpu"
  >,
  defenderIsPlayer: boolean,
): BondResolveResult {
  const power = Math.max(0, bond.power);

  switch (bond.element) {
    case "fire":
      return { immediateHpDelta: 0 };
    case "poison":
      return { immediateHpDelta: 0 };
    case "freeze":
      return {
        immediateHpDelta: 0,
        freezeOnDefender: power,
      };
    case "shield":
      return {
        immediateHpDelta: 0,
        shieldOnDefender: power,
      };
    case "heal":
      return {
        immediateHpDelta: 0,
        healOnAttacker: power,
      };
    case "volt":
      return { immediateHpDelta: power };
    default:
      return { immediateHpDelta: 0 };
  }
}

/**
 * Tick DoT stacks once (end of attack phase or start of next at-bat).
 * Returns HP lost per side this tick.
 */
export function applyDamageThroughShield(
  hp: number,
  shield: number,
  damage: number,
): { hp: number; shield: number; dealt: number } {
  let remaining = Math.max(0, damage);
  let nextShield = shield;
  let nextHp = hp;
  if (nextShield > 0 && remaining > 0) {
    const absorbed = Math.min(nextShield, remaining);
    nextShield -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    nextHp = Math.max(0, nextHp - remaining);
  }
  return { hp: nextHp, shield: nextShield, dealt: damage - remaining + Math.min(shield, damage) };
}

export function tickDotStacks(state: ElementCombatState): {
  playerLoss: number;
  cpuLoss: number;
  next: ElementCombatState;
} {
  const beforePlayer = state.playerHP;
  const beforeCpu = state.cpuHP;
  const next = tickCombatDotStacks(state);
  return {
    playerLoss: beforePlayer - next.playerHP,
    cpuLoss: beforeCpu - next.cpuHP,
    next,
  };
}

/** Bonds that buff the attacker — no projectile, applied to the attacker's bar. */
export function isSelfBuffBond(element: Element): boolean {
  return element === "shield" || element === "heal";
}

/** @deprecated Use {@link isSelfBuffBond}. */
export function isShieldBond(element: Element): boolean {
  return isSelfBuffBond(element);
}

/** Apply one bond with immediate HP/shield effects (continuous combat). */
export function applyInstantCombatBond(
  state: ElementCombatState,
  bond: ElementBond,
  attackerIsPlayer: boolean,
  options?: { combineCount?: number },
): ElementCombatState {
  const power = Math.max(0, bond.power);
  const next: ElementCombatState = { ...state };
  const combineCount = options?.combineCount ?? 2;

  switch (bond.element) {
    case "fire":
    case "poison": {
      // Instant hit damage on impact, then DoT stack ticks down over time.
      const afterHit = applyDamageToDefender(next, attackerIsPlayer, power);
      if (attackerIsPlayer) {
        if (bond.element === "fire") afterHit.burnOnCpu += power;
        else afterHit.poisonOnCpu += power;
      } else {
        if (bond.element === "fire") afterHit.burnOnPlayer += power;
        else afterHit.poisonOnPlayer += power;
      }
      return afterHit;
    }
    case "freeze":
      return applyFreezeBondEffect(
        next,
        attackerIsPlayer,
        power,
        power,
        combineCount,
      );
    case "shield":
      if (attackerIsPlayer) next.shieldOnPlayer += power;
      else next.shieldOnCpu += power;
      break;
    case "heal":
      if (attackerIsPlayer) {
        next.playerHP = Math.min(BRAWL_START_HP, next.playerHP + power);
      } else {
        next.cpuHP = Math.min(BRAWL_START_HP, next.cpuHP + power);
      }
      break;
    case "volt":
      return applyDamageToDefender(next, attackerIsPlayer, power);
  }
  return next;
}

/** Headless combat sim — alternates bonds until one side hits 0 HP. */
export function simulateElementCombat(
  start: ElementCombatState,
  userBonds: ElementBond[],
  opponentBonds: ElementBond[],
): ElementCombatState {
  let combat: ElementCombatState = { ...start };
  if (userBonds.length === 0 && opponentBonds.length === 0) return combat;

  let userIdx = 0;
  let oppIdx = 0;
  let userTurn = true;
  let guard = 0;
  const maxSteps = (userBonds.length + opponentBonds.length) * 200;

  while (
    combat.playerHP > 0 &&
    combat.cpuHP > 0 &&
    guard++ < maxSteps
  ) {
    const bonds = userTurn ? userBonds : opponentBonds;
    if (bonds.length === 0) {
      userTurn = !userTurn;
      continue;
    }
    const idx = userTurn ? userIdx++ : oppIdx++;
    const bond = bonds[idx % bonds.length];
    combat = applyInstantCombatBond(combat, bond, userTurn);
    userTurn = !userTurn;
  }
  return combat;
}

/** @deprecated Use {@link simulateElementCombat}. */
export const simulateElementAtBat = simulateElementCombat;

/** Sum bond power for a hand (preview during selection). */
export function sumBondPower(bonds: ElementBond[]): number {
  return bonds.reduce((s, b) => s + b.power, 0);
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    const tail = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const rest of permutations(tail)) {
      out.push([head, ...rest]);
    }
  }
  return out;
}

function seamSubsets(hand: CardDefinition[]): ReadonlySet<string>[] {
  const keys: string[] = [];
  for (let i = 1; i < hand.length; i++) {
    const a = hand[i - 1];
    const b = hand[i];
    if (canConnectAny(a, b)) keys.push(seamKey(a.id, b.id));
  }
  if (keys.length === 0) return [new Set<string>()];
  const out: ReadonlySet<string>[] = [];
  const total = 1 << keys.length;
  for (let mask = 0; mask < total; mask++) {
    const set = new Set<string>();
    for (let bit = 0; bit < keys.length; bit++) {
      if (mask & (1 << bit)) set.add(keys[bit]);
    }
    out.push(set);
  }
  return out;
}

/** Pick card order + seams that maximize total bond power. */
export function optimizeElementHand(hand: CardDefinition[]): {
  hand: CardDefinition[];
  affirmedSeams: ReadonlySet<string>;
  bondPower: number;
} {
  if (hand.length === 0) {
    return { hand: [], affirmedSeams: new Set(), bondPower: 0 };
  }
  let bestHand = hand;
  let bestSeams: ReadonlySet<string> = new Set();
  let bestPower = -1;
  for (const perm of permutations(hand)) {
    for (const seams of seamSubsets(perm)) {
      const bonds = computeElementBonds(perm, seams as Set<string>);
      const power = sumBondPower(bonds);
      if (power > bestPower) {
        bestPower = power;
        bestHand = perm;
        bestSeams = seams;
      }
    }
  }
  return { hand: bestHand, affirmedSeams: bestSeams, bondPower: bestPower };
}
