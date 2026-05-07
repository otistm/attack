import { CardDefinition, SESSION_CARDS } from "./cards";

/**
 * Deal-time roster mods. These run BEFORE handTransforms in freshAtBat and
 * change which cards end up in each hand (add / remove / swap), as opposed to
 * handTransforms which only mutates existing cards in-place.
 *
 * Phase 2 wires:
 *   p-54 Dual Threat:   pitcher draws +1 extra general
 *   p-39 Mound Presence: batter must discard 1 general (auto: lowest-value)
 *   b-67 Foul Ball:     discard b-67 + 1 other general -> draw 2 fresh generals
 *   p-77 Mound Visit:   swap pitcher's lowest-value card with a fresh draw
 *
 * Auto-defaults are used until Phase 4 surfaces an interactive picker. Each
 * effect is silently a no-op if the relevant pool is empty.
 */

// Sourced from SESSION_CARDS so freshly-dealt cards (b-67 Foul Ball redraw,
// p-54 Dual Threat extra general, p-77 Mound Visit swap) carry the same
// per-session shape layout the rest of the player's hand already does.
const GENERAL_BATTING_POOL = SESSION_CARDS.filter(
  (c) => c.type === "Batting" && c.abilityType === "General Draw",
);
const GENERAL_PITCHING_POOL = SESSION_CARDS.filter(
  (c) => c.type === "Pitching" && c.abilityType === "General Draw",
);

type RngFn = () => number;

/**
 * Small deterministic PRNG (mulberry32). Mirrors the implementation in
 * `players.ts` so a (player, seed) pair already used for dealing can be
 * folded into the deal-effects pass without forcing callers to move to a
 * different random algorithm.
 */
function mulberry32(seed: number): RngFn {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandomNotIn(
  pool: CardDefinition[],
  avoid: CardDefinition[],
  rng: RngFn,
): CardDefinition | null {
  const avoidIds = new Set(avoid.map((c) => c.id));
  const candidates = pool.filter((c) => !avoidIds.has(c.id));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

function lowestValueGeneralIdx(hand: CardDefinition[]): number {
  let idx = -1;
  let val = Infinity;
  for (let i = 0; i < hand.length; i++) {
    if (hand[i].abilityType !== "General Draw") continue;
    if (hand[i].baseValue < val) {
      val = hand[i].baseValue;
      idx = i;
    }
  }
  return idx;
}

function lowestValueAnyIdx(hand: CardDefinition[]): number {
  let idx = -1;
  let val = Infinity;
  for (let i = 0; i < hand.length; i++) {
    if (hand[i].baseValue < val) {
      val = hand[i].baseValue;
      idx = i;
    }
  }
  return idx;
}

export interface DealEffectResult {
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  log: string[];
}

/**
 * Apply deal-time roster mods. `seed` is optional -- when supplied, every
 * random pick this pass makes is driven by a seeded PRNG so the (seed, hand,
 * hand) triple reproduces exactly. When omitted, falls back to Math.random
 * for the legacy non-deterministic behavior. gameStore feeds a per-at-bat
 * seed so reproductions / bug reports can pin a specific deal pattern.
 */
export function applyDealEffects(
  batterHand: CardDefinition[],
  pitcherHand: CardDefinition[],
  seed?: number,
): DealEffectResult {
  let bh = batterHand;
  let ph = pitcherHand;
  const log: string[] = [];
  const rng: RngFn = seed === undefined ? Math.random : mulberry32(seed);
  // Track every card that ever leaves the batter's hand during this deal-time
  // pass so subsequent random redraws (b-67 Foul Ball) can't immediately
  // re-deal a card we already discarded. Without this, p-39 -> b-67 sequences
  // would intermittently restore the very b-69 the batter just lost, which
  // surfaced as a flaky test ("b-69 dropped, b-67 spent" failed ~10% of runs).
  const batterDiscarded: CardDefinition[] = [];

  // p-54 Dual Threat: pitcher draws an extra general. Auto-take is always a
  // win for the pitcher (more cards, no downside) so we always accept.
  if (ph.some((c) => c.id === "p-54")) {
    const extra = pickRandomNotIn(GENERAL_PITCHING_POOL, ph, rng);
    if (extra) {
      ph = [...ph, extra];
      log.push(`p-54 Dual Threat: drew extra general ${extra.id}`);
    }
  }

  // p-39 Mound Presence: batter is forced to discard 1 general. Auto-pick the
  // lowest-value general so the batter loses the smallest possible amount.
  if (ph.some((c) => c.id === "p-39")) {
    const idx = lowestValueGeneralIdx(bh);
    if (idx !== -1) {
      const removed = bh[idx];
      bh = bh.filter((_, i) => i !== idx);
      batterDiscarded.push(removed);
      log.push(`p-39 Mound Presence: batter discarded ${removed.id}`);
    }
  }

  // b-67 Foul Ball: spend b-67 (and a partner general if one is available) to
  // refresh the batter's general pool with 2 fresh draws. Always fires when
  // b-67 is in hand -- previously this silently fizzled when no partner
  // general existed, which happens whenever p-39 Mound Presence had already
  // docked the batter's only other general. In that fizzle case b-67 sat in
  // the hand as a useless 2-cost stub and the batter ended up with a
  // 4-card / 1-general hand and no recourse. Now b-67 always discards
  // itself, optionally pulls a partner along with it, and redraws 2 fresh
  // generals from the pool -- so it doubles as a clean counter to p-39.
  // Excluded cards (current hand + b-67 + partner + ANY card discarded
  // earlier in this same deal-time pass) are kept out of the draw pool so
  // the refresh can't immediately re-deal what we just discarded.
  if (bh.some((c) => c.id === "b-67")) {
    const partnerIdx = bh.findIndex(
      (c) => c.id !== "b-67" && c.abilityType === "General Draw",
    );
    const consumed: CardDefinition[] = [bh.find((c) => c.id === "b-67")!];
    if (partnerIdx !== -1) consumed.push(bh[partnerIdx]);
    const consumedIds = new Set(consumed.map((c) => c.id));
    bh = bh.filter((c) => !consumedIds.has(c.id));
    batterDiscarded.push(...consumed);
    const draws: CardDefinition[] = [];
    for (let i = 0; i < 2; i++) {
      const next = pickRandomNotIn(
        GENERAL_BATTING_POOL,
        [...bh, ...draws, ...batterDiscarded],
        rng,
      );
      if (next) draws.push(next);
    }
    bh = [...bh, ...draws];
    const partnerNote = consumed.length > 1 ? ` + ${consumed[1].id}` : "";
    log.push(
      `b-67 Foul Ball: discarded b-67${partnerNote}, drew ${draws.map((d) => d.id).join("+")}`,
    );
  }

  // p-77 Mound Visit: swap pitcher's lowest-value card with a fresh general.
  // Auto-swaps the lowest baseValue card in the hand (could be p-77 itself,
  // which is a 2-cost). The fresh draw avoids cards already in hand.
  if (ph.some((c) => c.id === "p-77")) {
    const idx = lowestValueAnyIdx(ph);
    if (idx !== -1) {
      const fresh = pickRandomNotIn(GENERAL_PITCHING_POOL, ph, rng);
      if (fresh) {
        const removed = ph[idx];
        ph = ph.map((c, i) => (i === idx ? fresh : c));
        log.push(`p-77 Mound Visit: swapped ${removed.id} for ${fresh.id}`);
      }
    }
  }

  return { batterHand: bh, pitcherHand: ph, log };
}
