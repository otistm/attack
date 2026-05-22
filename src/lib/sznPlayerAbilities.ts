/**
 * SZN Mode Player Ability registry.
 *
 * Every SZN player carries one always-on Passive plus 0-3 Potentials that
 * unlock as the player's rarity climbs (common -> none revealed, allstar
 * -> potentials[0], veteran -> potentials[0..1], legend -> potentials[0..2]).
 *
 * Abilities are pure data: a discriminated-union trigger paired with a
 * flat effect payload. The four engine entry points exposed at the bottom
 * of this file walk the user's roster, fire any abilities whose trigger
 * matches the current game event, and accumulate the resulting deltas
 * into a single patch the caller folds back into its own accumulators.
 *
 * Mirrors the badge architecture in `badges.ts` -- badges trigger team-
 * wide passives, abilities trigger player-flavored passives. Both layers
 * share the same `SznSnapEvent` stream emitted by `scoring.ts` so wiring
 * is additive, not invasive.
 */

import type { ClassTag, Rarity, RosterPlayer, DayOfWeek } from "./run";
import type { SznSnapEvent } from "./scoring";
import type { SznEdgeId, SznEdgeFamily } from "./sznEdges";
import { familyOf } from "./sznEdges";
import { isSznPlayer, type SznPlayer } from "./sznPlayers";
import { RARITY_ORDER } from "./run";

// =========================================================================
// Schema
// =========================================================================

/**
 * What game event causes the ability to fire.
 *
 * Triggers are intentionally narrow so the engine entry points stay flat
 * `switch` statements instead of generic predicate evaluators. New trigger
 * types should match an existing engine hook (snap event, lock-in, week
 * rollover, etc.) so wiring is one new branch each.
 */
export type PlayerAbilityTrigger =
  | {
      kind: "onSnap";
      /** Filter by specific edge id (e.g. "power"). */
      edge?: SznEdgeId;
      /** Filter by edge family (e.g. "offensive"). Stacks with `edge`. */
      family?: SznEdgeFamily;
      /**
       * Which side of THIS player's own card must the snap touch?
       *   - "left":   the player's left edge is the snap's right participant
       *   - "right":  the player's right edge is the snap's left participant
       *   - "either": (default) any snap involving this player's anchor
       */
      sideOfSelf?: "left" | "right" | "either";
    }
  | {
      kind: "onTeammateSnap";
      /** Match snaps where the matched edge equals this. */
      edge?: SznEdgeId;
      /** Match snaps whose participants carry this tag. */
      tag?: ClassTag;
    }
  | {
      kind: "onLockIn";
      /** Restrict to one side; default fires for whichever side the player is on. */
      whenRole?: "Batter" | "Pitcher";
    }
  | { kind: "onMatchupReveal" }
  | { kind: "onMatchupWin" }
  | { kind: "onWeekStart" }
  | { kind: "onDayStart"; day?: DayOfWeek }
  | { kind: "passive"; description: string };

/**
 * Flat effect payload. Any subset may be set; engine entry points sum
 * them and surface the totals back to the caller. Re-uses the same
 * primitive deltas the scoring engine already accumulates so a wiring
 * change is one new accumulator each, not a fresh code path.
 *
 * "self" below means the side the firing player is on (Batter side or
 * Pitcher side); "opponent" means the other side.
 */
export interface PlayerAbilityEffect {
  /** Added to self side total. */
  scoreBonus?: number;
  /** Added to opponent total. Negative numbers are debuffs. */
  opponentScoreDelta?: number;
  /** Added to self side hit-scale bonus. */
  hitScaleBonus?: number;
  /** Added to pitcher combined delta. */
  pitcherCombinedDelta?: number;
  /** Queued into RunState.nextWeekCashBonus. */
  nextWeekCashBonus?: number;
  /** 0..1 probability to shatter the opponent's chain. */
  chainShatterChance?: number;
  /** Replaces the default 1.25x speed multiplier when set (max of all firing). */
  speedMultiplier?: number;
  /** Permanent base-score boost stamped onto the snapping rookie. */
  permanentBoostOnRookie?: number;
  /** Flip ties to the pitcher (only meaningful for pitcher-side abilities). */
  pitcherWinsTies?: true;
  /** Treats the chain as N cards longer for requireChainLength checks. */
  chainLengthForgiveness?: number;
  /** When true, the ability only fires the first time per matchup. */
  oneShotPerMatchup?: true;
  /** Tooltip copy. */
  flavor?: string;
}

export interface PlayerAbility {
  /** Stable id, unique within a player. e.g. "all-rise", "schwarbomb". */
  id: string;
  /** Display name (e.g. "All Rise"). */
  name: string;
  trigger: PlayerAbilityTrigger;
  effect: PlayerAbilityEffect;
}

// =========================================================================
// Reveal logic
// =========================================================================

/**
 * Returns the abilities currently revealed for a given player + rarity:
 * always the passive, plus the first N potentials where N = rarity index.
 */
export function revealedAbilities(player: SznPlayer, rarity: Rarity): PlayerAbility[] {
  const idx = Math.max(0, RARITY_ORDER.indexOf(rarity));
  const pots = player.potentials ?? [];
  return [player.passive, ...pots.slice(0, idx)];
}

/** Count of currently-revealed potential slots (0-3). */
export function revealedPotentialCount(rarity: Rarity): number {
  return Math.max(0, RARITY_ORDER.indexOf(rarity));
}

/** Total potential slot count (revealed + locked). Clamped to 3. */
export function totalPotentialSlots(player: SznPlayer): number {
  return Math.min(3, player.potentials?.length ?? 0);
}

// =========================================================================
// Internal: snap-event matching
// =========================================================================

/** Is the given snap event a "self" snap for the given player anchor id? */
function snapInvolvesAnchor(ev: SznSnapEvent, anchorId: string): "left" | "right" | null {
  if (ev.leftCardId === anchorId) return "right"; // anchor is on the left of the snap -> snap's right edge of self
  if (ev.rightCardId === anchorId) return "left"; // anchor is on the right of the snap -> snap's left edge of self
  return null;
}

function matchesEdgeFilters(
  ev: SznSnapEvent,
  edge?: SznEdgeId,
  family?: SznEdgeFamily,
): boolean {
  if (ev.wildcard) {
    // Wildcard snaps have no specific edge to match against; only fire
    // when the trigger is unfiltered (any snap).
    return edge === undefined && family === undefined;
  }
  if (edge !== undefined && ev.edge !== edge) return false;
  if (family !== undefined && familyOf(ev.edge) !== family) return false;
  return true;
}

// =========================================================================
// Engine entry points
// =========================================================================

/**
 * Aggregate side-bonus + side-effects produced by all `onSnap` /
 * `onTeammateSnap` abilities on the user's roster for a single side's
 * scoring result.
 *
 * Returns the totals the caller folds into the matchup math AFTER
 * `scoreHand` has run. Only the user's side fires (mirrors the badge
 * convention -- the ghost doesn't carry abilities).
 *
 * Anchor-bound triggers (`onSnap` with default `sideOfSelf = either`)
 * only fire if the firing player's anchor card is in `bestGroup`. The
 * lock-in side's only valid anchor per matchup is the player at-plate
 * (batter side) or the pitcher on-mound (pitcher side); abilities on
 * bench / bullpen players sit idle until their player is at the plate.
 */
export interface SnapAbilityResult {
  scoreBonus: number;
  opponentScoreDelta: number;
  hitScaleBonus: number;
  pitcherCombinedDelta: number;
  nextWeekCashBonus: number;
  /** 0..1 cumulative shatter probability (caller composes a single roll). */
  chainShatterChance: number;
  /** Rookie permanentBoost grants accumulated this matchup. */
  rookieBoosts: { rookiePlayerId: string; boost: number }[];
}

const EMPTY_SNAP_RESULT: SnapAbilityResult = {
  scoreBonus: 0,
  opponentScoreDelta: 0,
  hitScaleBonus: 0,
  pitcherCombinedDelta: 0,
  nextWeekCashBonus: 0,
  chainShatterChance: 0,
  rookieBoosts: [],
};

export function applySnapAbilities(
  roster: RosterPlayer[],
  side: "Batting" | "Pitching",
  bestGroup: readonly { id: string }[],
  snapEvents: readonly SznSnapEvent[],
): SnapAbilityResult {
  if (snapEvents.length === 0) return { ...EMPTY_SNAP_RESULT, rookieBoosts: [] };
  const out: SnapAbilityResult = {
    scoreBonus: 0,
    opponentScoreDelta: 0,
    hitScaleBonus: 0,
    pitcherCombinedDelta: 0,
    nextWeekCashBonus: 0,
    chainShatterChance: 0,
    rookieBoosts: [],
  };
  const desiredRole = side === "Batting" ? "Batter" : "Pitcher";
  const bestGroupIds = new Set(bestGroup.map((c) => c.id));
  for (const rp of roster) {
    if (rp.player.role !== desiredRole) continue;
    if (!isSznPlayer(rp.player)) continue;
    const anchorId = `player:${rp.player.id}`;
    const anchorInGroup = bestGroupIds.has(anchorId);
    const abilities = revealedAbilities(rp.player, rp.rarity);
    for (const ab of abilities) {
      const trig = ab.trigger;
      // onSnap: requires self anchor in group.
      if (trig.kind === "onSnap") {
        if (!anchorInGroup) continue;
        const sideOfSelf = trig.sideOfSelf ?? "either";
        let fired = 0;
        for (const ev of snapEvents) {
          const involved = snapInvolvesAnchor(ev, anchorId);
          if (!involved) continue;
          if (sideOfSelf !== "either" && involved !== sideOfSelf) continue;
          if (!matchesEdgeFilters(ev, trig.edge, trig.family)) continue;
          fired += 1;
          if (ab.effect.oneShotPerMatchup) break;
        }
        if (fired > 0) {
          accumulate(out, ab.effect, fired);
          // permanentBoostOnRookie -> stamp the snapped-rookie's id
          if (ab.effect.permanentBoostOnRookie && ab.effect.permanentBoostOnRookie > 0) {
            for (const ev of snapEvents) {
              if (snapInvolvesAnchor(ev, anchorId) !== "left") continue; // veteran is on the right
              if (ev.edge !== "veteran-tag" && ev.edge !== "rookie") continue;
              if (ev.wildcard) continue;
              // The rookie is the LEFT participant; map to its anchor id.
              const rookieAnchorId = ev.leftCardId;
              if (!rookieAnchorId.startsWith("player:")) continue;
              out.rookieBoosts.push({
                rookiePlayerId: rookieAnchorId.slice("player:".length),
                boost: ab.effect.permanentBoostOnRookie,
              });
            }
          }
        }
        continue;
      }
      // onTeammateSnap: requires self anchor in group (player has to be
      // on the field for their ability to fire). Excludes self-touching
      // snaps so the buff only rewards OTHER teammates' work.
      if (trig.kind === "onTeammateSnap") {
        if (!anchorInGroup) continue;
        let fired = 0;
        for (const ev of snapEvents) {
          if (snapInvolvesAnchor(ev, anchorId) !== null) continue;
          if (!matchesEdgeFilters(ev, trig.edge, undefined)) continue;
          // Optional tag filter checks the OTHER participants in the snap.
          if (trig.tag !== undefined) {
            const left = findRosterPlayerByCardId(roster, ev.leftCardId);
            const right = findRosterPlayerByCardId(roster, ev.rightCardId);
            const tagged =
              (left && left.tag === trig.tag) || (right && right.tag === trig.tag);
            if (!tagged) continue;
          }
          fired += 1;
          if (ab.effect.oneShotPerMatchup) break;
        }
        if (fired > 0) accumulate(out, ab.effect, fired);
        continue;
      }
    }
  }
  return out;
}

/**
 * Accumulator helper: fold effect deltas into the running total, scaling
 * per-fire counts by `multiplier` (how many qualifying snaps occurred).
 * `oneShotPerMatchup` short-circuits the multiplier to 1 inside
 * `applySnapAbilities` via the `break` above.
 */
function accumulate(
  out: SnapAbilityResult,
  eff: PlayerAbilityEffect,
  multiplier: number,
): void {
  if (eff.scoreBonus) out.scoreBonus += eff.scoreBonus * multiplier;
  if (eff.opponentScoreDelta) out.opponentScoreDelta += eff.opponentScoreDelta * multiplier;
  if (eff.hitScaleBonus) out.hitScaleBonus += eff.hitScaleBonus * multiplier;
  if (eff.pitcherCombinedDelta) out.pitcherCombinedDelta += eff.pitcherCombinedDelta * multiplier;
  if (eff.nextWeekCashBonus) out.nextWeekCashBonus += eff.nextWeekCashBonus * multiplier;
  if (eff.chainShatterChance && eff.chainShatterChance > out.chainShatterChance) {
    // Multiple shatter sources don't stack additively -- we keep the max.
    out.chainShatterChance = eff.chainShatterChance;
  }
}

/** Find the roster player whose anchor card id matches `cardId`. */
function findRosterPlayerByCardId(
  roster: RosterPlayer[],
  cardId: string,
): RosterPlayer | null {
  if (!cardId.startsWith("player:")) return null;
  const pid = cardId.slice("player:".length);
  return roster.find((rp) => rp.player.id === pid) ?? null;
}

// -------------------------------------------------------------------------
// Lock-in / matchup-reveal
// -------------------------------------------------------------------------

export interface LockInAbilityResult {
  scoreBonus: number;
  opponentScoreDelta: number;
  hitScaleBonus: number;
  nextWeekCashBonus: number;
  pitcherWinsTies: boolean;
}

const EMPTY_LOCKIN_RESULT: LockInAbilityResult = {
  scoreBonus: 0,
  opponentScoreDelta: 0,
  hitScaleBonus: 0,
  nextWeekCashBonus: 0,
  pitcherWinsTies: false,
};

/**
 * Walk the at-bat / on-mound player's abilities and fold any `onLockIn`
 * triggers that match. Fires once per matchup; `oneShotPerMatchup` is
 * implicit (lock-in only happens once anyway).
 */
export function applyLockInAbilities(
  roster: RosterPlayer[],
  side: "Batting" | "Pitching",
  bestGroup: readonly { id: string }[],
): LockInAbilityResult {
  const out = { ...EMPTY_LOCKIN_RESULT };
  const desiredRole = side === "Batting" ? "Batter" : "Pitcher";
  const bestGroupIds = new Set(bestGroup.map((c) => c.id));
  for (const rp of roster) {
    if (rp.player.role !== desiredRole) continue;
    if (!isSznPlayer(rp.player)) continue;
    const anchorId = `player:${rp.player.id}`;
    if (!bestGroupIds.has(anchorId)) continue;
    const abilities = revealedAbilities(rp.player, rp.rarity);
    for (const ab of abilities) {
      if (ab.trigger.kind !== "onLockIn") continue;
      if (ab.trigger.whenRole && ab.trigger.whenRole !== desiredRole) continue;
      if (ab.effect.scoreBonus) out.scoreBonus += ab.effect.scoreBonus;
      if (ab.effect.opponentScoreDelta) out.opponentScoreDelta += ab.effect.opponentScoreDelta;
      if (ab.effect.hitScaleBonus) out.hitScaleBonus += ab.effect.hitScaleBonus;
      if (ab.effect.nextWeekCashBonus) out.nextWeekCashBonus += ab.effect.nextWeekCashBonus;
      if (ab.effect.pitcherWinsTies) out.pitcherWinsTies = true;
    }
  }
  return out;
}

/**
 * Walk the at-bat / on-mound player's abilities and fold any
 * `onMatchupReveal` triggers. Used by the pre-score pass to contribute
 * into the matchup totals before scoring runs (e.g. Stroman / Scherzer
 * flat reveal bonus, Cortes hitScale tempo).
 */
export function applyMatchupRevealAbilities(
  roster: RosterPlayer[],
  side: "Batting" | "Pitching",
  bestGroup: readonly { id: string }[],
): LockInAbilityResult {
  const out = { ...EMPTY_LOCKIN_RESULT };
  const desiredRole = side === "Batting" ? "Batter" : "Pitcher";
  const bestGroupIds = new Set(bestGroup.map((c) => c.id));
  for (const rp of roster) {
    if (rp.player.role !== desiredRole) continue;
    if (!isSznPlayer(rp.player)) continue;
    const anchorId = `player:${rp.player.id}`;
    if (!bestGroupIds.has(anchorId)) continue;
    const abilities = revealedAbilities(rp.player, rp.rarity);
    for (const ab of abilities) {
      if (ab.trigger.kind !== "onMatchupReveal") continue;
      if (ab.effect.scoreBonus) out.scoreBonus += ab.effect.scoreBonus;
      if (ab.effect.opponentScoreDelta) out.opponentScoreDelta += ab.effect.opponentScoreDelta;
      if (ab.effect.hitScaleBonus) out.hitScaleBonus += ab.effect.hitScaleBonus;
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// Week / day transitions
// -------------------------------------------------------------------------

export interface RolloverAbilityResult {
  nextWeekCashBonus: number;
}

/** Sum all `onWeekStart` abilities across the user's roster. */
export function applyWeekStartAbilities(roster: RosterPlayer[]): RolloverAbilityResult {
  let nextWeekCashBonus = 0;
  for (const rp of roster) {
    if (!isSznPlayer(rp.player)) continue;
    const abilities = revealedAbilities(rp.player, rp.rarity);
    for (const ab of abilities) {
      if (ab.trigger.kind !== "onWeekStart") continue;
      if (ab.effect.nextWeekCashBonus) nextWeekCashBonus += ab.effect.nextWeekCashBonus;
      // scoreBonus on a week-start trigger queues into nextWeekCashBonus as
      // a $-equivalent flat token (treat 5 score == $1 for now).
      if (ab.effect.scoreBonus) nextWeekCashBonus += Math.floor(ab.effect.scoreBonus / 5);
    }
  }
  return { nextWeekCashBonus };
}

/** Sum all `onDayStart` abilities for the given day across the roster. */
export function applyDayStartAbilities(
  roster: RosterPlayer[],
  day: DayOfWeek,
): RolloverAbilityResult {
  let nextWeekCashBonus = 0;
  for (const rp of roster) {
    if (!isSznPlayer(rp.player)) continue;
    const abilities = revealedAbilities(rp.player, rp.rarity);
    for (const ab of abilities) {
      if (ab.trigger.kind !== "onDayStart") continue;
      if (ab.trigger.day && ab.trigger.day !== day) continue;
      if (ab.effect.nextWeekCashBonus) nextWeekCashBonus += ab.effect.nextWeekCashBonus;
    }
  }
  return { nextWeekCashBonus };
}

// -------------------------------------------------------------------------
// Speed multiplier + chain-length forgiveness lookups (consumed by scoring.ts)
// -------------------------------------------------------------------------

/**
 * Resolve the speed multiplier in effect for a given anchor card id when
 * a `speed` edge snaps INTO it. Returns 1.25 (the default speed-edge
 * multiplier) unless the anchor's roster player has a stronger one.
 *
 * Callers pass `null`/`undefined` roster to opt out (legacy paths /
 * non-SZN games).
 */
export function speedMultiplierForAnchor(
  roster: RosterPlayer[] | null | undefined,
  anchorId: string,
): number {
  const DEFAULT = 1.25;
  if (!roster || !anchorId.startsWith("player:")) return DEFAULT;
  const pid = anchorId.slice("player:".length);
  const rp = roster.find((r) => r.player.id === pid);
  if (!rp || !isSznPlayer(rp.player)) return DEFAULT;
  let best = DEFAULT;
  for (const ab of revealedAbilities(rp.player, rp.rarity)) {
    if (ab.effect.speedMultiplier && ab.effect.speedMultiplier > best) {
      best = ab.effect.speedMultiplier;
    }
  }
  return best;
}

/**
 * How many "extra" chain-length credits the holder of `anchorId` gets
 * via their abilities (Judge's "62", Scherzer's "Future HOF").
 */
export function chainLengthForgivenessForAnchor(
  roster: RosterPlayer[] | null | undefined,
  anchorId: string,
): number {
  if (!roster || !anchorId.startsWith("player:")) return 0;
  const pid = anchorId.slice("player:".length);
  const rp = roster.find((r) => r.player.id === pid);
  if (!rp || !isSznPlayer(rp.player)) return 0;
  let total = 0;
  for (const ab of revealedAbilities(rp.player, rp.rarity)) {
    if (ab.effect.chainLengthForgiveness) total += ab.effect.chainLengthForgiveness;
  }
  return total;
}

// -------------------------------------------------------------------------
// Tooltip glyphs for the UI
// -------------------------------------------------------------------------

export function triggerGlyph(trigger: PlayerAbilityTrigger): string {
  switch (trigger.kind) {
    case "onSnap":
    case "onTeammateSnap":
      return "🔗";
    case "onLockIn":
      return "🔒";
    case "onMatchupReveal":
      return "👁";
    case "onMatchupWin":
      return "🏆";
    case "onWeekStart":
      return "📅";
    case "onDayStart":
      return "☀";
    case "passive":
      return "∞";
  }
}

export function triggerLabel(trigger: PlayerAbilityTrigger): string {
  switch (trigger.kind) {
    case "onSnap":
      return trigger.edge ? `On snap (${trigger.edge})` : "On snap";
    case "onTeammateSnap":
      return trigger.edge ? `On teammate snap (${trigger.edge})` : "On teammate snap";
    case "onLockIn":
      return "On lock-in";
    case "onMatchupReveal":
      return "On matchup reveal";
    case "onMatchupWin":
      return "On matchup win";
    case "onWeekStart":
      return "On week start";
    case "onDayStart":
      return trigger.day ? `On ${trigger.day}` : "On day start";
    case "passive":
      return "Passive";
  }
}
