/**
 * Pre-game auction draft.
 *
 * The user picks HOME/AWAY, then drafts a 7-batter / 3-pitcher roster against
 * an AI in an alternating-nomination open auction. Both sides start with $100
 * and a "safety reserve" of $1 per remaining slot, so neither can ever blow
 * the entire budget on one player and softlock the draft.
 *
 * This module is pure -- no React, no zustand. The store wraps these helpers
 * to drive UI; tests in `__effects_check.ts` exercise them deterministically.
 *
 * State machine:
 *
 *   nominating -> (nominate) -> bidding -> (pass by non-leader) -> award ->
 *   alternate nominator -> nominating ... -> complete
 *
 * Force-fill: at the end of every award, if a side's `budget < slotsRemaining`
 * the engine drips them the cheapest remaining-pool player at $1/each until
 * they can either bid normally again or their roster is full. This punishes
 * overspending without ever leaving the player softlocked at the menu.
 */
import { CardDefinition, SESSION_CARDS, TagLiteral } from "./cards";
import { BATTERS, MlbPlayer, PITCHERS } from "./players";

export type DraftSide = "user" | "ai";
export type DraftArchetype = "POWER" | "SPEED" | "CLUTCH" | "VETERAN";
export type PlayerTier = "ELITE" | "STAR" | "SOLID" | "FILLER";
export type DraftPhase = "nominating" | "bidding" | "complete";

export interface DraftRoster {
  batters: MlbPlayer[];
  pitchers: MlbPlayer[];
}

export interface DraftRequirements {
  batters: number;
  pitchers: number;
}

export interface ActiveAuction {
  player: MlbPlayer;
  nominator: DraftSide;
  /** Always >= 1; the nominator implicitly opens at $1. */
  currentBid: number;
  /** Whoever currently holds the high bid -- starts as the nominator. */
  highBidder: DraftSide;
  /** A side that has passed cannot bid again on THIS auction. */
  passed: { user: boolean; ai: boolean };
}

export interface DraftLogEntry {
  player: MlbPlayer;
  winner: DraftSide;
  price: number;
  /** 'forced-fill' = awarded for $1 because winner was broke / sole eligible. */
  reason: "auction" | "forced-fill";
}

export interface DraftState {
  pool: MlbPlayer[];
  budget: { user: number; ai: number };
  roster: { user: DraftRoster; ai: DraftRoster };
  requirements: DraftRequirements;
  aiArchetype: DraftArchetype;
  activeAuction: ActiveAuction | null;
  /** Whose turn it is to nominate (only consulted while `phase === "nominating"`). */
  nominator: DraftSide;
  log: DraftLogEntry[];
  phase: DraftPhase;
  /**
   * Set to true when the engine had to mark the draft "complete" without
   * finishing both rosters because neither side could legally nominate AND
   * deterministic recovery (force-fill across roles) couldn't make progress.
   * The UI can surface this as a soft warning instead of silently shipping
   * an undersized roster into the game phase.
   */
  deadlocked?: boolean;
}

// ----- constants ------------------------------------------------------------

export const STARTING_BUDGET = 100;
export const DEFAULT_REQUIREMENTS: DraftRequirements = { batters: 7, pitchers: 3 };

const ARCHETYPES: DraftArchetype[] = ["POWER", "SPEED", "CLUTCH", "VETERAN"];

/**
 * Tags that map onto an archetype. Carrying any of these is a green flag for
 * the AI's bid valuation. Ordered by primacy (first tag is the strongest fit).
 */
const ARCHETYPE_TAGS: Record<DraftArchetype, TagLiteral[]> = {
  POWER: ["power-hitter", "fastball", "veteran"],
  SPEED: ["speedster", "off-speed", "rookie"],
  CLUTCH: ["clutch", "veteran", "lefty"],
  VETERAN: ["veteran", "starter", "closer"],
};

export const ARCHETYPE_LABEL: Record<DraftArchetype, string> = {
  POWER: "Power Lineup",
  SPEED: "Speed & Slap",
  CLUTCH: "Clutch Closer",
  VETERAN: "Veteran Bullpen",
};

/**
 * Conceptual "opposite" archetype, used by AI nomination strategy when it
 * wants to BAIT the user -- it nominates a player whose strong tags don't
 * match the AI's own archetype, hoping the user will sink budget into them.
 */
const ANTI_ARCHETYPE: Record<DraftArchetype, DraftArchetype> = {
  POWER: "SPEED",
  SPEED: "POWER",
  CLUTCH: "VETERAN",
  VETERAN: "CLUTCH",
};

// ----- deterministic RNG ----------------------------------------------------

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- card lookup (built once) --------------------------------------------

// Sourced from SESSION_CARDS. Draft AI valuation reads `baseValue` and
// `tags` (both identical to ALL_CARDS), so this swap is functionally a
// no-op for pricing -- but it keeps any downstream consumer that snapshots
// these objects (e.g. UI tooltips on hovered nominees) on the same shape
// layout the player will see in-hand.
const CARD_BY_ID: Record<string, CardDefinition> = {};
for (const c of SESSION_CARDS) CARD_BY_ID[c.id] = c;

// ----- player metrics -------------------------------------------------------

export function playerSignatureValue(player: MlbPlayer): number {
  let sum = 0;
  for (const id of player.signatureCardIds) {
    const c = CARD_BY_ID[id];
    if (c) sum += c.baseValue;
  }
  return sum;
}

export function playerTagSet(player: MlbPlayer): Set<TagLiteral> {
  const set = new Set<TagLiteral>();
  for (const id of player.signatureCardIds) {
    const c = CARD_BY_ID[id];
    if (c?.tags) for (const t of c.tags) set.add(t);
  }
  return set;
}

/**
 * Visible market-tier badge displayed on each pool card. Computed off the
 * sum of the player's signature card baseValues plus the breadth of their
 * tag carriage (more tag synergies = more deck-build options).
 */
export function playerTier(player: MlbPlayer): PlayerTier {
  const sig = playerSignatureValue(player);
  const tagCount = playerTagSet(player).size;
  if (sig >= 26 && tagCount >= 2) return "ELITE";
  if (sig >= 23) return "STAR";
  if (sig >= 21 && tagCount >= 2) return "STAR";
  if (sig >= 18) return "SOLID";
  return "FILLER";
}

// ----- AI valuation ---------------------------------------------------------

/**
 * AI's perceived dollar value for a given player. Used both to decide how
 * high to bid and to rank the AI's own targets at nomination time.
 *
 * Components:
 *  - baseline 4
 *  - +(sig sum / 3): rewards strong-card players proportionally
 *  - +4 per archetype-tag carried (primary fit)
 *  - +0.5 per any tag (depth)
 *  - +/-2 noise so AI doesn't bid identical numbers every game
 */
export function aiPlayerValue(
  player: MlbPlayer,
  archetype: DraftArchetype,
  rng: () => number = Math.random,
): number {
  const sig = playerSignatureValue(player);
  const tags = playerTagSet(player);
  let v = 4 + sig / 3;
  for (const t of tags) {
    if (ARCHETYPE_TAGS[archetype].includes(t)) v += 4;
  }
  v += tags.size * 0.5;
  v += rng() * 4 - 2;
  return Math.max(1, Math.round(v));
}

// ----- slot / budget helpers ------------------------------------------------

export function slotsRemainingForRole(
  roster: DraftRoster,
  requirements: DraftRequirements,
  role: "Batter" | "Pitcher",
): number {
  return role === "Batter"
    ? Math.max(0, requirements.batters - roster.batters.length)
    : Math.max(0, requirements.pitchers - roster.pitchers.length);
}

export function totalSlotsRemaining(
  roster: DraftRoster,
  requirements: DraftRequirements,
): number {
  return (
    slotsRemainingForRole(roster, requirements, "Batter") +
    slotsRemainingForRole(roster, requirements, "Pitcher")
  );
}

/**
 * The most a side can legally bid right now. Always reserves $1 per future
 * slot so the side can finish drafting at the safety floor.
 *
 * Example: $100 budget with 10 slots left -> max bid = $91. Fewer slots
 * remaining = bigger bid ceiling, which lets the late draft heat up.
 */
export function maxAffordableBid(budget: number, slotsLeft: number): number {
  return Math.max(0, budget - Math.max(0, slotsLeft - 1));
}

export function canSideBid(state: DraftState, side: DraftSide, player: MlbPlayer): boolean {
  if (slotsRemainingForRole(state.roster[side], state.requirements, player.role) <= 0) {
    return false;
  }
  const total = totalSlotsRemaining(state.roster[side], state.requirements);
  return maxAffordableBid(state.budget[side], total) >= 1;
}

export function eligiblePoolForSide(state: DraftState, side: DraftSide): MlbPlayer[] {
  return state.pool.filter((p) => canSideBid(state, side, p));
}

export function eligibleNominees(state: DraftState): MlbPlayer[] {
  return state.pool.filter(
    (p) => canSideBid(state, "user", p) || canSideBid(state, "ai", p),
  );
}

export function isDraftComplete(state: {
  roster: { user: DraftRoster; ai: DraftRoster };
  requirements: DraftRequirements;
}): boolean {
  return (
    totalSlotsRemaining(state.roster.user, state.requirements) === 0 &&
    totalSlotsRemaining(state.roster.ai, state.requirements) === 0
  );
}

// ----- AI nomination strategy ----------------------------------------------

/**
 * Pick the player the AI wants to nominate. Always filters to the CURRENT
 * NOMINATOR's eligible pool -- a side cannot nominate a player they
 * themselves can't open the auction on.
 *
 * Two modes:
 *  - Drain mode (early draft, AI flush): nominate STAR/ELITE players whose
 *    tags don't fit the AI's archetype, betting the user values them and
 *    will sink budget. Burns down user's reserve before AI's own targets
 *    come up.
 *  - Self mode (mid-late or AI thrifty): nominate the AI's highest-valued
 *    eligible player; AI is willing to win this auction.
 *
 * Used by the AI's actual turn AND by the test harness as a stand-in
 * "user agent" so the entire draft can be simulated deterministically.
 */
export function aiNominate(
  state: DraftState,
  rng: () => number = Math.random,
): MlbPlayer | null {
  const side = state.nominator;
  const eligible = eligiblePoolForSide(state, side);
  if (eligible.length === 0) return null;

  // Drain heuristic: AI is flush AND draft is still early. Only the AI side
  // ever pursues drain mode -- the user agent in tests just picks the top
  // archetype value.
  const aiSlots = totalSlotsRemaining(state.roster.ai, state.requirements);
  const draftRound = state.log.length;
  const drainMode =
    side === "ai" && state.budget.ai > 60 && draftRound < 6 && aiSlots > 4;

  if (drainMode) {
    const archAnti = ANTI_ARCHETYPE[state.aiArchetype];
    const ranked = eligible
      .map((p) => ({
        p,
        userPull: aiPlayerValue(p, archAnti, rng),
        aiPull: aiPlayerValue(p, state.aiArchetype, rng),
        tierWeight: tierWeight(playerTier(p)),
      }))
      .sort((a, b) => {
        const aScore = a.userPull * 1.0 + a.tierWeight - a.aiPull * 0.4;
        const bScore = b.userPull * 1.0 + b.tierWeight - b.aiPull * 0.4;
        return bScore - aScore;
      });
    return ranked[0]?.p ?? null;
  }

  const ranked = eligible
    .map((p) => ({ p, v: aiPlayerValue(p, state.aiArchetype, rng) }))
    .sort((a, b) => b.v - a.v);
  return ranked[0]?.p ?? null;
}

function tierWeight(tier: PlayerTier): number {
  switch (tier) {
    case "ELITE":
      return 6;
    case "STAR":
      return 3;
    case "SOLID":
      return 1;
    case "FILLER":
      return 0;
  }
}

// ----- AI bid decision ------------------------------------------------------

/**
 * Decide whether the AI should raise on the active auction. AI never bids
 * against itself (passes when high bidder), and never violates safety
 * reserve.
 */
export function aiBidDecision(
  state: DraftState,
  rng: () => number = Math.random,
): "raise" | "pass" {
  const auction = state.activeAuction;
  if (!auction) return "pass";
  if (auction.highBidder === "ai") return "pass";
  if (auction.passed.ai) return "pass";
  if (!canSideBid(state, "ai", auction.player)) return "pass";

  const aiSlots = totalSlotsRemaining(state.roster.ai, state.requirements);
  const value = aiPlayerValue(auction.player, state.aiArchetype, rng);
  const maxAffordable = maxAffordableBid(state.budget.ai, aiSlots);
  const ceiling = Math.min(value, maxAffordable);
  return auction.currentBid + 1 <= ceiling ? "raise" : "pass";
}

/**
 * AI's chosen raise amount given a "raise" decision. Always +1 over current
 * bid -- keeps auctions taut and reactive instead of sniping by huge jumps.
 */
export function aiBidAmount(state: DraftState): number {
  if (!state.activeAuction) return 0;
  return state.activeAuction.currentBid + 1;
}

// ----- state mutations ------------------------------------------------------

/**
 * Build initial draft state. Pool is full BATTERS + PITCHERS (no shuffling
 * needed -- order's irrelevant). User always nominates first; AI archetype
 * is randomized off the seed for replayability.
 */
export function initDraftState(
  seed: number = Math.floor(Math.random() * 1_000_000),
): DraftState {
  const rng = makeRng(seed);
  const aiArchetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
  return {
    pool: [...BATTERS, ...PITCHERS],
    budget: { user: STARTING_BUDGET, ai: STARTING_BUDGET },
    roster: {
      user: { batters: [], pitchers: [] },
      ai: { batters: [], pitchers: [] },
    },
    requirements: { ...DEFAULT_REQUIREMENTS },
    aiArchetype,
    activeAuction: null,
    nominator: "user",
    log: [],
    phase: "nominating",
  };
}

/**
 * Fisher-Yates shuffle using the seeded RNG. Returns a fresh array; doesn't
 * mutate the input. Pulled out so quick-match builds are deterministic in
 * tests when called with a fixed seed.
 */
function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build a "Quick Match" draft state -- the auction-skipping lane. Both sides
 * get a randomly-shuffled 7 batters / 3 pitchers and `phase` lands on
 * "complete" so the gameplay layer treats it identically to an auction that
 * just finished. The leftover players stay in `pool` so any code that reads
 * the pool for diagnostics behaves the same as the auction path.
 *
 * `log` is populated with one `forced-fill` entry per drafted player so
 * downstream UI (which iterates the log to render team rosters) sees a
 * symmetric shape. Reusing the existing `forced-fill` reason avoids widening
 * the union; price 0 reflects that no auction took place.
 *
 * Pure function -- consume the returned state from a store action and let
 * the gameplay layer perform the at-bat seeding.
 */
export function buildQuickMatchDraft(
  seed: number = Math.floor(Math.random() * 1_000_000),
): DraftState {
  const rng = makeRng(seed);
  const aiArchetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
  const requirements = { ...DEFAULT_REQUIREMENTS };

  const batters = shuffleWithRng(BATTERS, rng);
  const pitchers = shuffleWithRng(PITCHERS, rng);

  const userBatters = batters.slice(0, requirements.batters);
  const aiBatters = batters.slice(
    requirements.batters,
    requirements.batters * 2,
  );
  const userPitchers = pitchers.slice(0, requirements.pitchers);
  const aiPitchers = pitchers.slice(
    requirements.pitchers,
    requirements.pitchers * 2,
  );

  const drafted = new Set<string>([
    ...userBatters.map((p) => p.id),
    ...aiBatters.map((p) => p.id),
    ...userPitchers.map((p) => p.id),
    ...aiPitchers.map((p) => p.id),
  ]);
  const remainingPool = [...BATTERS, ...PITCHERS].filter(
    (p) => !drafted.has(p.id),
  );

  // Build a symmetric log: alternate user/ai per slot, batters first, then
  // pitchers. Mirrors the order the auction path tends to produce.
  const log: DraftLogEntry[] = [];
  for (let i = 0; i < requirements.batters; i++) {
    log.push({ player: userBatters[i], winner: "user", price: 0, reason: "forced-fill" });
    log.push({ player: aiBatters[i], winner: "ai", price: 0, reason: "forced-fill" });
  }
  for (let i = 0; i < requirements.pitchers; i++) {
    log.push({ player: userPitchers[i], winner: "user", price: 0, reason: "forced-fill" });
    log.push({ player: aiPitchers[i], winner: "ai", price: 0, reason: "forced-fill" });
  }

  return {
    pool: remainingPool,
    budget: { user: STARTING_BUDGET, ai: STARTING_BUDGET },
    roster: {
      user: { batters: userBatters, pitchers: userPitchers },
      ai: { batters: aiBatters, pitchers: aiPitchers },
    },
    requirements,
    aiArchetype,
    activeAuction: null,
    nominator: "user",
    log,
    phase: "complete",
  };
}

/**
 * Open an auction. Validates ownership of the turn, the player being in the
 * pool, and that at least one side can bid. The nominator implicitly opens at
 * $1 -- if both sides can't bid (or the only-bidder is the nominator and the
 * other is pre-passed), the auction immediately resolves to the nominator.
 */
export function nominate(
  state: DraftState,
  playerId: string,
  by: DraftSide,
): DraftState {
  if (state.phase !== "nominating") return state;
  if (state.nominator !== by) return state;
  const player = state.pool.find((p) => p.id === playerId);
  if (!player) return state;
  if (!canSideBid(state, by, player)) return state;
  if (!eligibleNominees(state).some((p) => p.id === playerId)) return state;

  const userCantBid = !canSideBid(state, "user", player);
  const aiCantBid = !canSideBid(state, "ai", player);
  // Nominator must be able to bid (we just checked); the other side may already be locked out.
  const next: DraftState = {
    ...state,
    activeAuction: {
      player,
      nominator: by,
      currentBid: 1,
      highBidder: by,
      passed: { user: by === "user" ? false : userCantBid, ai: by === "ai" ? false : aiCantBid },
    },
    phase: "bidding",
  };
  // If the non-nominator was pre-passed, resolve immediately.
  return maybeAwardAuction(next);
}

export function placeBid(
  state: DraftState,
  side: DraftSide,
  amount: number,
): DraftState {
  if (state.phase !== "bidding" || !state.activeAuction) return state;
  const auction = state.activeAuction;
  if (auction.passed[side]) return state;
  if (auction.highBidder === side) return state;
  if (amount <= auction.currentBid) return state;
  const total = totalSlotsRemaining(state.roster[side], state.requirements);
  const max = maxAffordableBid(state.budget[side], total);
  if (amount > max) return state;
  if (
    slotsRemainingForRole(state.roster[side], state.requirements, auction.player.role) <= 0
  ) {
    return state;
  }
  const other = otherSide(side);
  return {
    ...state,
    activeAuction: {
      ...auction,
      currentBid: amount,
      highBidder: side,
      passed: { ...auction.passed, [other]: false },
    },
  };
}

export function passBid(state: DraftState, side: DraftSide): DraftState {
  if (state.phase !== "bidding" || !state.activeAuction) return state;
  const auction = state.activeAuction;
  if (auction.highBidder === side) return state;
  if (auction.passed[side]) return state;
  const next: DraftState = {
    ...state,
    activeAuction: {
      ...auction,
      passed: { ...auction.passed, [side]: true },
    },
  };
  return maybeAwardAuction(next);
}

function maybeAwardAuction(state: DraftState): DraftState {
  const auction = state.activeAuction;
  if (!auction) return state;
  const challenger = otherSide(auction.highBidder);
  if (!auction.passed[challenger]) return state;
  return advanceAfterAward(awardAuction(state));
}

function awardAuction(state: DraftState): DraftState {
  const auction = state.activeAuction;
  if (!auction) return state;
  const winner = auction.highBidder;
  const price = auction.currentBid;
  const player = auction.player;

  const updatedRoster = addToRoster(state.roster[winner], player);
  const newRoster = { ...state.roster, [winner]: updatedRoster };
  return {
    ...state,
    budget: { ...state.budget, [winner]: state.budget[winner] - price },
    roster: newRoster,
    pool: state.pool.filter((p) => p.id !== player.id),
    activeAuction: null,
    log: [...state.log, { player, winner, price, reason: "auction" }],
    phase: "nominating",
    // Alternate nomination after every award.
    nominator: otherSide(state.nominator),
  };
}

/**
 * After awarding, run the post-award reconciliation:
 *  - force-fill any side that has gone insolvent (budget < slotsRemaining)
 *  - skip the next nominator if they're full (or completed)
 *  - flag draft complete if both sides full
 */
function advanceAfterAward(state: DraftState): DraftState {
  let s = forceFillIfBroke(state);
  if (isDraftComplete(s)) return { ...s, phase: "complete" };
  s = ensureValidNominator(s);
  return s;
}

/**
 * Public recovery shim used by the store's `draftAiTick` when the AI is
 * nominating but `eligiblePoolForSide` is empty for it (no legal pick).
 *
 * The normal `ensureValidNominator` only runs after every auction award;
 * if the AI's first tick lands in this stalled state (e.g. mid-draft when
 * the AI is suddenly priced out of every remaining nominee), the autopilot
 * would loop on `aiNominate -> null` forever. Calling this from the tick
 * promotes nomination to the user (or runs deadlock recovery) so the UI
 * always has SOMETHING to do next.
 */
export function repairDraftStall(state: DraftState): DraftState {
  return ensureValidNominator(state);
}

function ensureValidNominator(state: DraftState): DraftState {
  if (state.phase !== "nominating") return state;
  if (canNominate(state, state.nominator)) return state;
  const other = otherSide(state.nominator);
  if (canNominate(state, other)) return { ...state, nominator: other };
  // Neither side can legally open an auction. If rosters are STILL unfilled
  // (e.g. one side already at slot cap, the other side flush but only the
  // wrong role left in pool), do not silently flip to "complete" -- that
  // ships an undersized roster into the game phase. Try a deterministic
  // deadlock recovery first; fall through to a flagged complete only if
  // the pool genuinely can't satisfy the open slots.
  if (!isDraftComplete(state)) {
    return resolveDeadlock(state);
  }
  return { ...state, phase: "complete" };
}

/**
 * Final-resort recovery when force-fill couldn't make progress under normal
 * solvency rules and neither side can nominate. Force-assigns the cheapest
 * pool players that match each side's open role slots at $1 (or $0 if the
 * side is broke) until either rosters are full or the pool runs out.
 *
 * If the pool can't satisfy the remaining slots (data-level deadlock), the
 * state is marked `deadlocked: true` so the UI / store can detect it.
 */
function resolveDeadlock(state: DraftState): DraftState {
  let s = state;
  const sides: DraftSide[] = ["user", "ai"];
  let progressed = true;
  while (progressed && !isDraftComplete(s)) {
    progressed = false;
    for (const side of sides) {
      const slots = totalSlotsRemaining(s.roster[side], s.requirements);
      if (slots === 0) continue;
      const pick = cheapestEligiblePoolPick(s, side);
      if (!pick) continue;
      const charge = Math.min(1, Math.max(0, s.budget[side]));
      s = {
        ...s,
        roster: { ...s.roster, [side]: addToRoster(s.roster[side], pick) },
        pool: s.pool.filter((p) => p.id !== pick.id),
        budget: {
          ...s.budget,
          [side]: Math.max(0, s.budget[side] - charge),
        },
        log: [
          ...s.log,
          { player: pick, winner: side, price: charge, reason: "forced-fill" },
        ],
      };
      progressed = true;
    }
  }
  if (isDraftComplete(s)) return { ...s, phase: "complete" };
  if (typeof console !== "undefined") {
    console.warn("[draft] deadlock: pool cannot satisfy remaining slots", {
      userSlotsRemaining: totalSlotsRemaining(s.roster.user, s.requirements),
      aiSlotsRemaining: totalSlotsRemaining(s.roster.ai, s.requirements),
      poolSize: s.pool.length,
    });
  }
  return { ...s, phase: "complete", deadlocked: true };
}

function canNominate(state: DraftState, side: DraftSide): boolean {
  const slots = totalSlotsRemaining(state.roster[side], state.requirements);
  if (slots === 0) return false;
  if (state.budget[side] < 1) return false;
  // Nominator must be able to bid on at least one pool player. Otherwise
  // they have no legal nomination to make and the auction would softlock.
  return eligiblePoolForSide(state, side).length > 0;
}

/**
 * Force-fill: when a side has slots left but cannot afford to keep bidding
 * within the safety reserve, drip-feed them the cheapest pool players at
 * $1 each (or $0 once their budget hits zero) until they are either solvent
 * or full. Keeps the draft from softlocking and turns "I overspent" into a
 * graceful B-string roster instead of a stuck modal.
 */
export function forceFillIfBroke(state: DraftState): DraftState {
  let s = state;
  for (const side of ["user", "ai"] as DraftSide[]) {
    while (true) {
      const slotsLeft = totalSlotsRemaining(s.roster[side], s.requirements);
      if (slotsLeft <= 0) break;
      if (s.budget[side] >= slotsLeft) break;
      const pick = cheapestEligiblePoolPick(s, side);
      if (!pick) break;
      const newRoster = { ...s.roster, [side]: addToRoster(s.roster[side], pick) };
      const charge = Math.min(1, s.budget[side]);
      s = {
        ...s,
        roster: newRoster,
        pool: s.pool.filter((p) => p.id !== pick.id),
        budget: { ...s.budget, [side]: s.budget[side] - charge },
        log: [
          ...s.log,
          { player: pick, winner: side, price: charge, reason: "forced-fill" },
        ],
      };
    }
  }
  if (isDraftComplete(s)) return { ...s, phase: "complete" };
  return s;
}

function cheapestEligiblePoolPick(state: DraftState, side: DraftSide): MlbPlayer | null {
  const slotBatter = slotsRemainingForRole(state.roster[side], state.requirements, "Batter");
  const slotPitcher = slotsRemainingForRole(state.roster[side], state.requirements, "Pitcher");
  const candidates = state.pool.filter((p) =>
    p.role === "Batter" ? slotBatter > 0 : slotPitcher > 0,
  );
  if (candidates.length === 0) return null;
  return candidates
    .map((p) => ({ p, v: playerSignatureValue(p) }))
    .sort((a, b) => a.v - b.v)[0].p;
}

function addToRoster(roster: DraftRoster, player: MlbPlayer): DraftRoster {
  if (player.role === "Batter") {
    return { ...roster, batters: [...roster.batters, player] };
  }
  return { ...roster, pitchers: [...roster.pitchers, player] };
}

function otherSide(side: DraftSide): DraftSide {
  return side === "user" ? "ai" : "user";
}

// ----- summary helpers ------------------------------------------------------

/** Histogram of tags across the user's drafted roster. Drives summary chart. */
export function rosterTagDistribution(roster: DraftRoster): Record<TagLiteral, number> {
  const counts: Record<string, number> = {};
  for (const p of [...roster.batters, ...roster.pitchers]) {
    for (const t of playerTagSet(p)) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return counts as Record<TagLiteral, number>;
}

/**
 * Read a "team identity" headline off the user's roster. Picks the most
 * common archetype tag in the user's tag distribution and returns a label
 * for the summary screen ("Your lineup leans CLUTCH"). Falls back to
 * BALANCED when no clear winner emerges.
 */
export function teamIdentityHeadline(roster: DraftRoster): string {
  const dist = rosterTagDistribution(roster);
  let best: { archetype: DraftArchetype; score: number } | null = null;
  for (const arch of ARCHETYPES) {
    let score = 0;
    for (const tag of ARCHETYPE_TAGS[arch]) score += (dist[tag] ?? 0);
    if (!best || score > best.score) best = { archetype: arch, score };
  }
  if (!best || best.score < 3) return "BALANCED";
  return ARCHETYPE_LABEL[best.archetype];
}
