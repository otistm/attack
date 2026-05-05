import { CardDefinition, CombineConstraint } from "./cards";
import { ShapeType } from "../components/cardShapes";
import { canConnect } from "./connect";

/**
 * Pre-scoring pass that lets cards mutate hands BEFORE the connection engine
 * runs. This is the "round-level constraint layer" called out in the Phase 1
 * roadmap: it covers auto shape transforms (b-5), opponent shape transforms
 * (p-49), wildcard / shape bans (p-31, p-35, p-78), value caps (p-42), shape
 * flattening (p-47) and general-card nullification (b-23).
 *
 * Each registered transform reports two patches: `ownHandPatch` mutates the
 * hand the card itself is in; `opponentHandPatch` mutates the OTHER hand. The
 * applier collects every triggered patch from both hands (snapshotted at entry
 * so a later transform can't accidentally re-trigger an earlier one) and runs
 * them sequentially so ordering inside a category remains deterministic.
 *
 * Cards interactively choosing what to transform (b-12, p-56, p-41) are NOT
 * wired here yet -- they need the pending-choice modal infrastructure first
 * and will land in Phase 2 once the modal hook is real.
 */

export interface TransformPatch {
  /** Patch applied to the hand the trigger card is in. */
  ownHandPatch?: (cards: CardDefinition[]) => CardDefinition[];
  /** Patch applied to the other side's hand. */
  opponentHandPatch?: (cards: CardDefinition[]) => CardDefinition[];
}

type TransformFn = () => TransformPatch;

// ============ helper transforms ============

const reverseShapes = (c: CardDefinition): CardDefinition => ({
  ...c,
  leftShape: c.rightShape,
  rightShape: c.leftShape,
});

const replaceShape =
  (target: ShapeType, replacement: ShapeType) =>
  (c: CardDefinition): CardDefinition => {
    if (c.leftShape !== target && c.rightShape !== target) return c;
    return {
      ...c,
      leftShape: c.leftShape === target ? replacement : c.leftShape,
      rightShape: c.rightShape === target ? replacement : c.rightShape,
    };
  };

const stripWildcards = (c: CardDefinition): CardDefinition => {
  const cc = c.combineConstraint;
  const hasShapeWild = c.leftShape === "wildcard" || c.rightShape === "wildcard";
  const hasFlagWild = Boolean(cc?.leftWildcard || cc?.rightWildcard);
  if (!hasShapeWild && !hasFlagWild) return c;
  const nextConstraint: CombineConstraint | undefined = cc
    ? { ...cc, leftWildcard: undefined, rightWildcard: undefined }
    : undefined;
  return {
    ...c,
    leftShape: c.leftShape === "wildcard" ? "none" : c.leftShape,
    rightShape: c.rightShape === "wildcard" ? "none" : c.rightShape,
    combineConstraint: nextConstraint,
  };
};

const capBaseValue = (cap: number) => (c: CardDefinition): CardDefinition =>
  c.baseValue > cap ? { ...c, baseValue: cap } : c;

const nullifyGenerals = (c: CardDefinition): CardDefinition => {
  if (c.abilityType !== "General Draw") return c;
  return {
    ...c,
    baseValue: 0,
    disabled: true,
    combineConstraint: { ...(c.combineConstraint ?? {}), noCombine: true },
  };
};

/**
 * b-119 Quick Bat: shave -2 baseValue off every General card in the pitcher
 * hand. Floors at 0 so a 1-Value general can't go negative -- the description
 * says "-2 Value" not "subtract 2 Value", and a negative card would land us
 * in undefined territory at the score pill. Disabled cards (already nuked by
 * b-23 etc.) are left alone since their baseValue is locked at 0.
 */
const debuffGenerals = (c: CardDefinition): CardDefinition => {
  if (c.abilityType !== "General Draw") return c;
  if (c.disabled) return c;
  return {
    ...c,
    baseValue: Math.max(0, c.baseValue - 2),
  };
};

/**
 * b-125 Green Monster: every DIAMOND slot on the batter's hand turns into a
 * wildcard for the round. Both shape-based and `*Wildcard` constraint
 * placements need to apply -- we rewrite the shape and clear any conflicting
 * constraints so the connect engine treats the slot as truly free.
 */
const diamondToWildcard = (c: CardDefinition): CardDefinition => {
  const leftDiamond = c.leftShape === "diamond";
  const rightDiamond = c.rightShape === "diamond";
  if (!leftDiamond && !rightDiamond) return c;
  return {
    ...c,
    leftShape: leftDiamond ? "wildcard" : c.leftShape,
    rightShape: rightDiamond ? "wildcard" : c.rightShape,
  };
};

/**
 * b-133 Jazz Hands: if b-133 has no mechanically-connectable neighbor in the
 * current batter arrangement, swap its own shapes to dual-wildcard so it can
 * still chain. Conditional pre-pass -- when b-133 is already adjacent to a
 * compatible neighbor it stays as star/diamond and the player gets no extra
 * help. The check runs BEFORE any other transform mutates the hand so the
 * "uncombined" reading is anchored to the player's deliberate arrangement.
 */
const jazzHandsConditional = (cards: CardDefinition[]): CardDefinition[] => {
  const idx = cards.findIndex((c) => c.id === "b-133");
  if (idx === -1) return cards;
  const b133 = cards[idx];
  const left = idx > 0 ? cards[idx - 1] : null;
  const right = idx < cards.length - 1 ? cards[idx + 1] : null;
  const leftConnects = left ? canConnect(left, b133) : false;
  const rightConnects = right ? canConnect(b133, right) : false;
  if (leftConnects || rightConnects) return cards;
  return cards.map((c, i) =>
    i === idx
      ? { ...c, leftShape: "wildcard" as ShapeType, rightShape: "wildcard" as ShapeType }
      : c,
  );
};

/**
 * Destroy the highest-value general in the given hand: zero the value, flag
 * the card as `disabled` (so the engine NOOPs its effect and the UI renders
 * the blocked silhouette) and disable combine. Used by b-21 The Pandemonium.
 * Auto-picks "highest" because the player-choice modal doesn't yet exist for
 * opponent-card selection.
 *
 * If there are no generals to destroy, returns the hand untouched.
 */
const destroyHighestGeneral = (cards: CardDefinition[]): CardDefinition[] => {
  let targetIdx = -1;
  let targetVal = -Infinity;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (c.abilityType !== "General Draw") continue;
    if (c.baseValue > targetVal) {
      targetVal = c.baseValue;
      targetIdx = i;
    }
  }
  if (targetIdx === -1) return cards;
  return cards.map((c, i) =>
    i === targetIdx
      ? {
          ...c,
          baseValue: 0,
          disabled: true,
          combineConstraint: { ...(c.combineConstraint ?? {}), noCombine: true },
        }
      : c,
  );
};

// ============ registry ============

export const HAND_TRANSFORMS: Record<string, TransformFn> = {
  // b-5 Opposite Field Power: reverse YOUR L/R on every card in your hand.
  "b-5": () => ({ ownHandPatch: (cards) => cards.map(reverseShapes) }),

  // b-21 The Pandemonium: destroy one of the pitcher's uncombined generals.
  // Auto-targets the highest-value general (max impact). The "uncombined"
  // qualifier is honored at lockIn time -- a future player-choice modal will
  // let the batter pick which general gets nuked.
  "b-21": () => ({ opponentHandPatch: destroyHighestGeneral }),

  // b-23 Stolen Base Threat: pitcher cannot use general cards this round.
  "b-23": () => ({ opponentHandPatch: (cards) => cards.map(nullifyGenerals) }),

  // p-31 Splinker: opponent cannot use wildcards.
  "p-31": () => ({ opponentHandPatch: (cards) => cards.map(stripWildcards) }),

  // p-35 Knuckle Curve: batter cannot combine SQUARE shapes (treat as flat).
  "p-35": () => ({
    opponentHandPatch: (cards) => cards.map(replaceShape("square", "none")),
  }),

  // p-42 Paint the Corners: batter's base values capped at 6.
  "p-42": () => ({ opponentHandPatch: (cards) => cards.map(capBaseValue(6)) }),

  // p-47 Rising Fastball: batter's DIAMOND shapes treated as None.
  "p-47": () => ({
    opponentHandPatch: (cards) => cards.map(replaceShape("diamond", "none")),
  }),

  // p-49 The Condor: reverse the BATTER's L/R on every card in their hand.
  "p-49": () => ({ opponentHandPatch: (cards) => cards.map(reverseShapes) }),

  // p-78 The Shift: nullify batter's STAR combos by treating stars as flat.
  "p-78": () => ({
    opponentHandPatch: (cards) => cards.map(replaceShape("star", "none")),
  }),

  // b-119 Quick Bat: -2 to every pitcher General card's value.
  "b-119": () => ({ opponentHandPatch: (cards) => cards.map(debuffGenerals) }),

  // b-125 Green Monster: own DIAMONDs become Wildcards for the round.
  "b-125": () => ({ ownHandPatch: (cards) => cards.map(diamondToWildcard) }),

  // b-133 Jazz Hands: conditional dual-Wildcard when b-133 is uncombined.
  // The conditional runs over the WHOLE hand at once (it needs neighbor
  // context) rather than card-by-card, hence the direct array transform.
  "b-133": () => ({ ownHandPatch: jazzHandsConditional }),
};

export interface TransformResult {
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  log: string[];
  /**
   * Pitcher card IDs whose `opponentHandPatch` actually mutated at least one
   * batter card. Lets the UI surface "Squares Flat" / "Values Capped" chips
   * only when there's a real impact -- without this we were leaking pitcher
   * hand info even when the transform wouldn't touch a single batter card
   * (e.g. p-31 Splinker firing into a Judge hand with no wildcards).
   */
  pitcherTransformsImpactingBatter: Set<string>;
}

/**
 * Shallow-compare two hands by stable identity. Returns true when at least one
 * card slot differs by reference -- the transform helpers always return new
 * card objects when they mutate, so reference equality is a safe diff.
 */
function handsDiffer(a: CardDefinition[], b: CardDefinition[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/**
 * Applies every registered hand transform from both hands and returns the
 * mutated copies. Pure function -- the input hands are not modified.
 */
export function applyHandTransforms(
  batterHand: CardDefinition[],
  pitcherHand: CardDefinition[],
): TransformResult {
  let bh = batterHand;
  let ph = pitcherHand;
  const log: string[] = [];
  const pitcherTransformsImpactingBatter = new Set<string>();

  // Snapshot trigger sources so mid-loop mutations cannot re-trigger or skip.
  const batterTriggers = batterHand.filter((c) => HAND_TRANSFORMS[c.id]);
  const pitcherTriggers = pitcherHand.filter((c) => HAND_TRANSFORMS[c.id]);

  for (const card of batterTriggers) {
    const patch = HAND_TRANSFORMS[card.id]();
    if (patch.ownHandPatch) {
      bh = patch.ownHandPatch(bh);
      log.push(`${card.id} ownHandPatch -> batter`);
    }
    if (patch.opponentHandPatch) {
      ph = patch.opponentHandPatch(ph);
      log.push(`${card.id} opponentHandPatch -> pitcher`);
    }
  }

  // b-9 Generational Discipline ignores ALL pitcher debuff mechanics this
  // round. That includes hand-transform patches the pitcher would otherwise
  // splice onto the batter's hand (p-31 Splinker, p-35 Knuckle Curve, p-42
  // Paint the Corners, p-47 Rising Fastball, p-49 The Condor, p-78 The
  // Shift). Without this, b-9's protection appeared selectively broken to
  // playtesters: it cancelled per-card debuffs but silently allowed the
  // pitcher to reverse / cap / flatten the batter's cards. Pitcher own-hand
  // patches still fire (they only modify the pitcher's own cards).
  const batterIgnoresDebuffs = batterHand.some((c) => c.id === "b-9");

  for (const card of pitcherTriggers) {
    const patch = HAND_TRANSFORMS[card.id]();
    if (patch.ownHandPatch) {
      ph = patch.ownHandPatch(ph);
      log.push(`${card.id} ownHandPatch -> pitcher`);
    }
    if (patch.opponentHandPatch) {
      if (batterIgnoresDebuffs) {
        log.push(`${card.id} opponentHandPatch -> batter SKIPPED (b-9 immunity)`);
      } else {
        const before = bh;
        bh = patch.opponentHandPatch(bh);
        const changed = handsDiffer(before, bh);
        log.push(
          `${card.id} opponentHandPatch -> batter${changed ? "" : " (no-op)"}`,
        );
        if (changed) pitcherTransformsImpactingBatter.add(card.id);
      }
    }
  }

  return {
    batterHand: bh,
    pitcherHand: ph,
    log,
    pitcherTransformsImpactingBatter,
  };
}
