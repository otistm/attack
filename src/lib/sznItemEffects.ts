/**
 * SZN Item Effect Registry
 * ========================
 *
 * Central per-card-id registry for SZN EncounterItem effects that
 * don't fit cleanly into the printed `baseValue` / `sznLeftEdge` /
 * `sznRightEdge` triple. Before this file existed every item's
 * special effect was either hand-rolled in `scoring.ts` (mega-card
 * merge, rally-fire aura), wired through an encounter-only path
 * (`queueRallyFire`, `queueDefenseShields`), or simply absent (most
 * "snap + do thing" items). Six items shipped with descriptions that
 * the engine did nothing with -- this registry is their home.
 *
 * Hook surface
 * ------------
 * Effects fire from three call sites, each chosen to keep the
 * subsystem the user already touches authoritative:
 *
 *   • `onAcquire(state, mutate)` -- fires from `gameStore.resolveEventChoice`
 *     immediately after the item lands in the bag (and from
 *     `purchaseFromMerchant` for parity). Used by items whose
 *     description promises a passive run-flag (Rally Fire's +10%
 *     adjacent aura ticks for the rest of the week the moment the
 *     item is acquired, even before the user snaps it into a chain).
 *
 *   • `mutateGroupEdges(group)` -- fires from `scoring.scoreGroup`
 *     BEFORE the per-card effect loop and BEFORE
 *     `collectSnapEvents`. The hook returns a shallow-cloned group
 *     with `sznLeftEdge`/`sznRightEdge` rewritten on the item card
 *     so the downstream engine sees the copied / mirrored edges as
 *     if they were the card's printed edges. Used by Classic Spikes
 *     (copies the partner's facing edge onto the item's opposite
 *     side so badges/snap events fire on the copied edge) and The
 *     Torch (duplicates the player's left edge onto its right).
 *
 *   • `scoreSnapPair(left, right, modifiers)` -- fires from
 *     `scoring.scoreGroup` AFTER the per-card effect loop. Used by
 *     items that adjust both halves of the snapped pair (Duct Tape's
 *     -50% to both cards).
 *
 *   • `onLockIn(item, group, ctx)` -- fires from
 *     `applySznLockInSideEffects` once per item card present in the
 *     winning chain. Returns a list of "side effects" the caller
 *     folds into the run patch (suspend a player, queue a defense
 *     shield, etc.). Sticky Stuff lives here -- 15% roll per
 *     snapped player.
 *
 * Why a registry vs. inlining at the call site: the previous baseline
 * scattered edge-of-network behavior across six files. New encounter
 * items routinely shipped with a description and no engine wiring
 * because adding the wiring required touching files unrelated to the
 * card definition. This registry collapses the "where do I add the
 * code?" decision to "add another entry in `SZN_ITEM_EFFECTS`". The
 * three integration points are stable; everything else fans out
 * from this map.
 */

import type { CardDefinition } from "./cards";
import type { SznEdgeId } from "./sznEdges";
import {
  TIER_BINARY_PROC_BONUS,
  TIER_BINARY_STACK_BONUS,
  type ItemTier,
} from "./itemTiers";

/**
 * Helper: read the Bazaar tier off a dealt card, defaulting to bronze
 * for any card without an `sznItemTier` stamp (player anchors, legacy
 * cards, or any item card that was minted before the tier system shipped).
 */
function tierOf(card: CardDefinition): ItemTier {
  return (card.sznItemTier as ItemTier | undefined) ?? "bronze";
}

/**
 * Mutable subset of run state an `onAcquire` hook may touch. We
 * pass a thin patch object instead of the live `RunState` so this
 * file stays free of the broader gameStore type web -- callers
 * (`gameStore.ts`) read the patch and fold it into the real run
 * object next to all the other encounter side-effect deltas.
 */
export interface RunAcquirePatch {
  /** Increment Rally Fire's adjacent-card +10% aura window. */
  rallyFireWeeksAdd?: number;
  /** Increment per-batter Defense Shield charges. */
  defenseShieldAdd?: number;
}

export interface SznLockInCtx {
  /** Side the item card was committed on. Sticky Stuff only triggers
   *  on the BATTING side -- the destroy roll targets the snapped
   *  player, and pitchers don't carry the "player at the plate"
   *  semantics the same way. */
  side: "Batting" | "Pitching";
  /** RNG hook so tests can pin sticky-stuff's coin flip without
   *  patching `Math.random` globally. Defaults to `Math.random`
   *  when omitted by the caller. */
  rng?: () => number;
}

/**
 * Per-item lock-in side effect. Returned from `onLockIn` -- the
 * gameStore caller folds these into the run patch + extraDebuffs
 * stream alongside its other side effects.
 */
export interface SznItemLockInEffect {
  /** Suspend a specific roster player for the next series. Uses
   *  the same `suspendedPlayerIds` channel `suspendTopScorers` /
   *  `pokerPlayerWager` use; the series-setup code resolves the id
   *  back into a concrete player. */
  suspendPlayerId?: string;
  /** Inline log entry that surfaces in the resolved-phase reveal so
   *  the user sees "Sticky Stuff destroyed Aaron Judge" rather than
   *  a silent roster mutation. */
  logEntry?: string;
  /** Queue +N Defense Shield charges (Platinum Glove). The shield is
   *  consumed by `computeMatchup` when the user is BATTING and faces
   *  a non-zero pitcher score, which is conceptually the "nullify
   *  opponent's next pitching score" promised by the card text. */
  defenseShieldAdd?: number;
}

export interface SznItemEffect {
  cardId: string;
  /**
   * Fires when the item lands in the bag (encounter grant OR
   * merchant purchase). Receives the tier the item is landing at
   * (always `"bronze"` on a fresh acquire today; upgrade-from-duplicate
   * goes through a separate `upgradeOwnedItem` path that doesn't
   * re-fire this hook). Returns a patch the caller folds into the
   * run delta; absent return = no-op.
   */
  onAcquire?: (tier: ItemTier) => RunAcquirePatch | void;
  /**
   * Rewrite the group's edges before scoring. Receives the live
   * group; should return either the same group (no-op) or a new
   * array with item-card `sznLeftEdge`/`sznRightEdge` rewritten via
   * a SHALLOW CLONE of just the cards we're mutating. Never mutate
   * the input array or its members.
   */
  mutateGroupEdges?: (group: CardDefinition[]) => CardDefinition[];
  /**
   * Fires once per adjacent pair where this item card is one half.
   * Receives the pair + the live per-card score modifiers map; may
   * mutate the map in place to adjust either card's contribution.
   * Returns nothing.
   *
   * Pair-symmetric effects (Duct Tape: -50% to both halves) belong
   * here. For "any-neighbor-matches" gating (Legal Rosin: +15 if
   * EITHER neighbor is a Pitcher), use `scoreInGroup` instead --
   * the per-pair API processes pairs in chain order and would
   * clobber a first-pair "pitcher matched" decision on the second
   * pair where the other neighbor is a Batter.
   */
  scoreSnapPair?: (
    selfIsLeft: boolean,
    partner: CardDefinition,
    modifiers: Record<string, { value: number; color?: string }>,
    selfId: string,
    selfTier: ItemTier,
  ) => void;
  /**
   * Fires once per occurrence of this item in the group. Receives
   * the full group + the item's index so the hook can read BOTH
   * neighbors at once -- needed for "valid if either neighbor is X"
   * gates that the per-pair hook can't express.
   */
  scoreInGroup?: (
    selfIndex: number,
    group: CardDefinition[],
    modifiers: Record<string, { value: number; color?: string }>,
  ) => void;
  /**
   * Fires once per copy of this item card that ended up in the
   * winning chain. Receives the item's left/right partners (either
   * may be null at an end) plus the side context. Returns a list of
   * side effects the caller folds into the run patch.
   */
  onLockIn?: (
    self: CardDefinition,
    leftNeighbor: CardDefinition | null,
    rightNeighbor: CardDefinition | null,
    ctx: SznLockInCtx,
  ) => SznItemLockInEffect[];
}

// ---------------------------------------------------------------------------
// Edge-mutation helpers (shared by Classic Spikes + The Torch)
// ---------------------------------------------------------------------------

/**
 * Return a shallow-cloned card with one or both SZN edges
 * overridden. Used by the edge-copy items so the engine downstream
 * sees the rewritten edges without us touching the source
 * `CardDefinition` (which lives in module-level constants and would
 * leak the mutation across at-bats if rewritten in place).
 */
function withEdges(
  card: CardDefinition,
  patch: { left?: SznEdgeId; right?: SznEdgeId },
): CardDefinition {
  return {
    ...card,
    sznLeftEdge: patch.left ?? card.sznLeftEdge,
    sznRightEdge: patch.right ?? card.sznRightEdge,
  };
}

/**
 * Walk a group and, for each occurrence of `cardId`, copy a chosen
 * edge from the adjacent partner card onto the item card's opposite
 * side. The returned group is a NEW array with the rewritten item
 * cards swapped in; non-item cards are referenced verbatim.
 *
 * `direction` is the side the COPY targets:
 *   - "mirrorRightFromLeftPartner": copy left-partner's right-edge
 *      onto this card's right-edge. Used by Classic Spikes when it
 *      sits to the RIGHT of its snap partner (the typical case --
 *      Spikes' wildcard left edge accepts the partner's right edge,
 *      then Spikes mirrors that same edge onto its own right so the
 *      next card in the chain sees a "real" edge instead of a
 *      generic wildcard).
 *   - "mirrorLeftFromRightPartner": symmetric for items placed to
 *      the LEFT of their partner.
 *   - "mirrorLeftFromPartner": copy partner's left-edge onto own
 *      right (used by The Torch's "duplicate left onto right"
 *      semantics, with the partner being the player anchor).
 */
function rewriteEdgesForItem(
  group: CardDefinition[],
  cardId: string,
  rewrite: (
    leftPartner: CardDefinition | null,
    rightPartner: CardDefinition | null,
  ) => { left?: SznEdgeId; right?: SznEdgeId } | null,
): CardDefinition[] {
  let mutated = false;
  const next = group.slice();
  for (let i = 0; i < next.length; i++) {
    if (next[i].id !== cardId) continue;
    const leftPartner = i > 0 ? next[i - 1] : null;
    const rightPartner = i < next.length - 1 ? next[i + 1] : null;
    const patch = rewrite(leftPartner, rightPartner);
    if (!patch) continue;
    next[i] = withEdges(next[i], patch);
    mutated = true;
  }
  return mutated ? next : group;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const STICKY_DESTROY_CHANCE = 0.15;
const DUCT_TAPE_SHARE_FACTOR = 0.5;

export const SZN_ITEM_EFFECTS: Record<string, SznItemEffect> = {
  // -------------------------------------------------------------------------
  // Rally Fire -- "Adjacent cards get +10% score for the rest of the week."
  // The +10% aura already exists in `scoring.scoreGroup` keyed off
  // `ctx.sznRallyFireActive`, but the previous baseline only enabled
  // it when an encounter EXPLICITLY called `queueRallyFire`. The
  // `Suspicious Grandpa` encounter granted the item itself, not the
  // queueRallyFire flag, so a player who acquired Rally Fire from
  // that branch held the card forever and never saw the aura land.
  // The acquire hook closes that gap -- the moment Rally Fire enters
  // the bag, it queues one week of aura (additive with any future
  // queueRallyFire from a different encounter so the user can stack).
  // -------------------------------------------------------------------------
  "enc-rally-fire": {
    cardId: "enc-rally-fire",
    // Binary "duration" effect: bronze pays the standard 1 week of
    // aura. Silver adds +1, gold adds +2 (per TIER_BINARY_STACK_BONUS)
    // so committing to Rally Fire via a duplicate upgrade extends the
    // window instead of doubling the per-snap math.
    onAcquire: (tier) => ({
      rallyFireWeeksAdd: 1 + TIER_BINARY_STACK_BONUS[tier],
    }),
  },

  // -------------------------------------------------------------------------
  // Sticky Stuff -- "Snap two cards that don't normally match. 15%
  // chance to destroy the targeted player at lock-in."
  // The "snap any two" half is satisfied by the printed wildcard
  // edges; this hook handles the destroy roll. Fires once per copy
  // of Sticky Stuff in the winning chain (in practice always one --
  // we cap one of each item id in the bag) and targets the player
  // anchor adjacent to it. We deliberately only target the BATTING
  // anchor: the destroy roll is conceptually "the umpire ejects the
  // batter for sticky pine tar," and the pitcher hand never sits
  // adjacent to a player anchor the user controls.
  // -------------------------------------------------------------------------
  "enc-sticky-stuff": {
    cardId: "enc-sticky-stuff",
    onLockIn: (self, leftNeighbor, rightNeighbor, ctx) => {
      if (ctx.side !== "Batting") return [];
      const rng = ctx.rng ?? Math.random;
      // Binary "did the umpire catch it?" effect: bronze inherits the
      // printed 15% chance; silver/gold add a flat +5% / +10% via
      // TIER_BINARY_PROC_BONUS so committing to Sticky Stuff at higher
      // tier makes the destroy more reliable instead of stronger.
      const tier = tierOf(self);
      const chance = STICKY_DESTROY_CHANCE + TIER_BINARY_PROC_BONUS[tier];
      if (rng() >= chance) return [];
      // Prefer the player neighbor (id starts with `player:`); fall
      // back to whichever neighbor exists. If the pine tar lands
      // between two ability cards (no player adjacency) it produces
      // no destroy target -- the description's "targeted player"
      // language anchors the effect to a real roster slot.
      const target =
        (leftNeighbor && leftNeighbor.id.startsWith("player:") && leftNeighbor) ||
        (rightNeighbor && rightNeighbor.id.startsWith("player:") && rightNeighbor) ||
        null;
      if (!target) return [];
      const playerId = target.id.replace(/^player:/, "");
      return [
        {
          suspendPlayerId: playerId,
          logEntry: `Sticky Stuff caught: ${target.name} suspended next series.`,
        },
      ];
    },
  },

  // -------------------------------------------------------------------------
  // Legal Rosin -- "Snap onto any pitcher's right edge for +15
  // Pitching Score."
  // The card's printed `sznRightEdge: "velocity"` already enforces
  // the "pitcher's right edge" half via the edge engine, but its
  // wildcard LEFT side lets non-pitcher partners snap from the
  // left and still cash the +15 baseValue. This hook keeps the +15
  // honest: when Rosin's actual snapped partner is NOT a Pitching
  // card, we strip the baseValue contribution back down to 0 so
  // the card only pays out on its advertised use case.
  //
  // We check both neighbors -- Rosin can sit between two pitchers
  // (e.g. velocity-Rosin-velocity bridge) and still earn the
  // bonus on either side.
  // -------------------------------------------------------------------------
  "enc-legal-rosin": {
    cardId: "enc-legal-rosin",
    scoreInGroup: (selfIndex, group, modifiers) => {
      const self = group[selfIndex];
      const selfMod = modifiers[self.id];
      if (!selfMod || selfMod.value <= 0) return;
      const left = selfIndex > 0 ? group[selfIndex - 1] : null;
      const right = selfIndex < group.length - 1 ? group[selfIndex + 1] : null;
      const eitherIsPitcher =
        (left && left.type === "Pitching") ||
        (right && right.type === "Pitching");
      if (eitherIsPitcher) return;
      modifiers[self.id] = { ...selfMod, value: 0, color: "text-rose-400" };
    },
  },

  // -------------------------------------------------------------------------
  // Corked Bat -- "Snap to any Outfielder or Infielder edge for
  // +100 Batting Score."
  // Printed edges `infield` / `outfield` already enforce the IF/OF
  // half via the edge engine (those edges only appear on batter
  // anchors). This hook adds a defensive belt-and-suspenders: if
  // somehow both neighbors are non-batters (e.g. a future encounter
  // grants a non-batter card with an infield/outfield edge for some
  // reason), the +100 is suppressed. In practice today it's a
  // no-op for the live catalog -- it's the registry's job to make
  // the description self-enforcing as new cards ship.
  // -------------------------------------------------------------------------
  "enc-corked-bat": {
    cardId: "enc-corked-bat",
    scoreInGroup: (selfIndex, group, modifiers) => {
      const self = group[selfIndex];
      const selfMod = modifiers[self.id];
      if (!selfMod || selfMod.value <= 0) return;
      const left = selfIndex > 0 ? group[selfIndex - 1] : null;
      const right = selfIndex < group.length - 1 ? group[selfIndex + 1] : null;
      const eitherIsBatter =
        (left && left.type === "Batting") ||
        (right && right.type === "Batting");
      if (eitherIsBatter) return;
      modifiers[self.id] = { ...selfMod, value: 0, color: "text-rose-400" };
    },
  },

  // -------------------------------------------------------------------------
  // Duct Tape -- "Snap two non-matching cards together. Both sides
  // take -50% base score."
  // Wildcard edges already let it snap anywhere; this hook applies
  // the 50% haircut to BOTH cards in the snapped pair. We mutate the
  // per-card modifier map instead of returning a multiplier so the
  // reveal phase paints both cards in the debuff color (the same way
  // `applyCardEffect` marks debuffed cards), making the cost legible
  // rather than a silent total drop.
  //
  // The Duct Tape card's own contribution is also halved -- the
  // description applies the penalty to "both sides" without
  // exempting itself, and halving the +0-base Tape produces a 0
  // either way so the user-facing penalty is entirely on the
  // attached cards.
  // -------------------------------------------------------------------------
  "enc-duct-tape": {
    cardId: "enc-duct-tape",
    scoreSnapPair: (_selfIsLeft, partner, modifiers, selfId, selfTier) => {
      // Tier upgrade SOFTENS the penalty so the user gets paid back
      // for committing to Duct Tape:
      //   bronze  -> -50% to both halves (the printed text)
      //   silver  -> -25% to both halves
      //   gold    ->  0% penalty (free wildcard snap)
      // The selfMod still gets the same haircut because Duct Tape's
      // baseValue is 0; the penalty surface is the partner half.
      const tierBonus =
        selfTier === "gold" ? 0.5 : selfTier === "silver" ? 0.25 : 0;
      const effectiveFactor = Math.min(1, DUCT_TAPE_SHARE_FACTOR + tierBonus);
      const isPenalty = effectiveFactor < 1;
      const partnerMod = modifiers[partner.id];
      if (partnerMod) {
        modifiers[partner.id] = {
          ...partnerMod,
          value: Math.floor(partnerMod.value * effectiveFactor),
          color: isPenalty ? "text-rose-400" : partnerMod.color,
        };
      }
      const selfMod = modifiers[selfId];
      if (selfMod) {
        modifiers[selfId] = {
          ...selfMod,
          value: Math.floor(selfMod.value * effectiveFactor),
          color: isPenalty ? "text-rose-400" : selfMod.color,
        };
      }
    },
  },

  // -------------------------------------------------------------------------
  // Platinum Glove -- "Snap into your pitching chain. Nullifies the
  // opponent's next pitching score."
  // The shield is consumed by `computeMatchup` when the user is on
  // the BATTING seat and the opposing pitcher would otherwise post
  // a non-zero score (see `consumeShield` in gameStore). The card
  // queues exactly one charge per copy that lands in the user's
  // winning PITCHING chain -- the run system already handles
  // accumulation and consumption.
  //
  // We require the item to actually sit in a SNAPPED chain (group
  // length >= 2): a 1-card brick wouldn't have "snapped into" the
  // pitching chain in any meaningful sense.
  // -------------------------------------------------------------------------
  "enc-platinum-glove": {
    cardId: "enc-platinum-glove",
    // Acquire bonus: matches the Defense Charity encounter's
    // promise of "Bag +1 AND +1 Defense Shield charge" -- the
    // moment Platinum Glove enters the bag, the user banks one
    // free shield charge. Subsequent shields come from the lock-in
    // hook below when the card actually snaps into a pitching
    // chain.
    //
    // Tier scaling is binary (stack count): bronze banks 1 shield,
    // silver banks 2, gold banks 3. Higher tiers stretch the shield
    // count rather than scaling each shield's strength.
    onAcquire: (tier) => ({
      defenseShieldAdd: 1 + TIER_BINARY_STACK_BONUS[tier],
    }),
    onLockIn: (self, leftNeighbor, rightNeighbor, ctx) => {
      if (ctx.side !== "Pitching") return [];
      const hasNeighbor = leftNeighbor !== null || rightNeighbor !== null;
      if (!hasNeighbor) return [];
      const tier = tierOf(self);
      return [
        {
          defenseShieldAdd: 1 + TIER_BINARY_STACK_BONUS[tier],
          logEntry: "Platinum Glove banks a Defense Shield for next at-bat.",
        },
      ];
    },
  },

  // -------------------------------------------------------------------------
  // Classic Spikes -- "Snap to any card. Copies the other card's
  // edge onto its own."
  // Pre-scoring edge mutation: when Spikes sits adjacent to a card
  // with a real (non-wildcard) edge, the Spikes card swaps its
  // matching wildcard side for a copy of the partner's facing edge.
  // The downstream snap-event collector then emits the partner's
  // edge type for the snap, which feeds badges (Bronx Bombers
  // counts power snaps, etc.) and per-edge scoring multipliers.
  //
  // We prefer copying the LEFT partner's right edge first (matches
  // the natural chain build direction); fall through to the right
  // partner's left edge for the leftmost-Spikes case.
  // -------------------------------------------------------------------------
  "enc-classic-spikes": {
    cardId: "enc-classic-spikes",
    mutateGroupEdges: (group) =>
      rewriteEdgesForItem(group, "enc-classic-spikes", (left, right) => {
        const fromLeft = left?.sznRightEdge as SznEdgeId | undefined;
        const fromRight = right?.sznLeftEdge as SznEdgeId | undefined;
        if (fromLeft && fromLeft !== "wildcard") {
          // Adopt the LEFT partner's right edge on BOTH sides so the
          // snap event surfaces the partner's edge type AND the
          // chain can continue rightward on the copied edge.
          return { left: fromLeft, right: fromLeft };
        }
        if (fromRight && fromRight !== "wildcard") {
          return { left: fromRight, right: fromRight };
        }
        return null;
      }),
  },

  // -------------------------------------------------------------------------
  // The Torch -- "Snap onto any player. Duplicates their left edge
  // onto its right side."
  // Same edge-mutation pattern as Classic Spikes but specifically
  // targets the PLAYER anchor's LEFT edge (not the partner's facing
  // edge). The Torch sits to the right of the player (typical chain
  // anchor placement) and projects the player's defining edge
  // forward into the chain, giving the next card a "real" edge to
  // snap against and feeding any badges that care about the
  // player's edge type.
  //
  // We tolerate the rare "Torch on the LEFT of the player" layout
  // by reading whichever neighbor is the player anchor.
  // -------------------------------------------------------------------------
  "enc-the-torch": {
    cardId: "enc-the-torch",
    mutateGroupEdges: (group) =>
      rewriteEdgesForItem(group, "enc-the-torch", (left, right) => {
        const player =
          (left && left.id.startsWith("player:") && left) ||
          (right && right.id.startsWith("player:") && right) ||
          null;
        if (!player) return null;
        const playerLeft = player.sznLeftEdge as SznEdgeId | undefined;
        if (!playerLeft || playerLeft === "wildcard") return null;
        // Description: duplicates the player's LEFT edge onto the
        // Torch's RIGHT side. Mirror on left too so the snap event
        // we just emitted to the player still resolves cleanly --
        // if the player is to our LEFT the wildcard-to-player snap
        // becomes a player-edge-to-player-edge same-id snap.
        return { left: playerLeft, right: playerLeft };
      }),
  },
};

// ---------------------------------------------------------------------------
// Public helpers consumed by the engine call sites
// ---------------------------------------------------------------------------

/**
 * Aggregate `onAcquire` patches into a single delta. Used by
 * `gameStore.requestAddItem` so every path an item enters the bag
 * (encounter grant, merchant purchase, full-bag replace) fires the
 * same passive triggers. `tier` is the tier the item is landing at
 * (always `"bronze"` on a fresh acquire today; upgrade-from-duplicate
 * fires through `upgradeOwnedItem` and does NOT re-fire this hook --
 * binary-stack effects like Rally Fire / Platinum Glove already
 * banked their bronze stack at the original acquire).
 */
export function sznItemAcquirePatch(
  cardId: string,
  tier: ItemTier = "bronze",
): RunAcquirePatch | null {
  const eff = SZN_ITEM_EFFECTS[cardId];
  if (!eff || !eff.onAcquire) return null;
  return eff.onAcquire(tier) || null;
}

/**
 * Walk the group and apply every registered `mutateGroupEdges`
 * hook in registry-iteration order. The returned group is the
 * fully-mutated version the rest of `scoreGroup` should use.
 *
 * We intentionally re-feed each hook the previous hook's output so
 * two items in the same chain compose cleanly (e.g. Classic Spikes
 * sitting between two Torch-projected edges sees the projected
 * edges, not the raw wildcards).
 */
export function applySznItemGroupEdgeMutations(
  group: CardDefinition[],
): CardDefinition[] {
  let current = group;
  for (const cardId of Object.keys(SZN_ITEM_EFFECTS)) {
    const eff = SZN_ITEM_EFFECTS[cardId];
    if (!eff.mutateGroupEdges) continue;
    if (!current.some((c) => c.id === cardId)) continue;
    current = eff.mutateGroupEdges(current);
  }
  return current;
}

/**
 * Walk the group and fire every registered `scoreSnapPair` hook for
 * each adjacent pair where the registered item is one of the two
 * cards. Mutates the `modifiers` map in place.
 */
export function applySznItemSnapPairEffects(
  group: CardDefinition[],
  modifiers: Record<string, { value: number; color?: string }>,
): void {
  if (group.length < 2) return;
  for (let i = 1; i < group.length; i++) {
    const left = group[i - 1];
    const right = group[i];
    const leftEff = SZN_ITEM_EFFECTS[left.id];
    if (leftEff?.scoreSnapPair) {
      leftEff.scoreSnapPair(true, right, modifiers, left.id, tierOf(left));
    }
    const rightEff = SZN_ITEM_EFFECTS[right.id];
    if (rightEff?.scoreSnapPair) {
      rightEff.scoreSnapPair(false, left, modifiers, right.id, tierOf(right));
    }
  }
}

/**
 * Walk the group and fire every registered `scoreInGroup` hook for
 * each occurrence of a registered item. Mutates the `modifiers`
 * map in place. Used for any-neighbor-matches gating that the
 * per-pair hook can't express (Legal Rosin, Corked Bat target-type
 * enforcement).
 *
 * Important: call this AFTER `applySznItemSnapPairEffects` so
 * per-pair edits (Duct Tape -50%) are already baked into
 * `modifiers` when the group-context hook reads them. Per-pair
 * effects always apply; per-group gates can either preserve or
 * suppress whatever the chain math has produced so far.
 */
export function applySznItemGroupScoringEffects(
  group: CardDefinition[],
  modifiers: Record<string, { value: number; color?: string }>,
): void {
  for (let i = 0; i < group.length; i++) {
    const card = group[i];
    const eff = SZN_ITEM_EFFECTS[card.id];
    if (!eff?.scoreInGroup) continue;
    eff.scoreInGroup(i, group, modifiers);
  }
}

/**
 * Walk the group and fire every registered `onLockIn` hook for each
 * occurrence of a registered item in the chain. Returns the
 * aggregated list of side effects the gameStore caller folds into
 * its run patch.
 */
export function applySznItemLockInEffects(
  group: CardDefinition[],
  ctx: SznLockInCtx,
): SznItemLockInEffect[] {
  const out: SznItemLockInEffect[] = [];
  for (let i = 0; i < group.length; i++) {
    const card = group[i];
    const eff = SZN_ITEM_EFFECTS[card.id];
    if (!eff || !eff.onLockIn) continue;
    const left = i > 0 ? group[i - 1] : null;
    const right = i < group.length - 1 ? group[i + 1] : null;
    const fired = eff.onLockIn(card, left, right, ctx);
    if (fired.length > 0) out.push(...fired);
  }
  return out;
}
