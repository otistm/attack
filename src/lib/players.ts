import { CardDefinition, Handedness, SESSION_CARDS } from "./cards";
import type { ShapeType } from "../components/cardShapes";
import type { ClassTag } from "./run";

/**
 * Brawl Mode playstyle flavor. Drives the curated 2-card general
 * subset each player draws from during brawl dealHand so the SAME
 * player always feels "powery" / "speedy" / "tricky" between brawls.
 *
 * Coverage:
 *  - power   : sluggers, big chain rewards, raw HP swings
 *  - speed   : speedsters, low-chain bonuses, comeback/state cards
 *  - guile   : vets, situational/conditional, wild-edge tricks
 *  - heat    : fastball pitchers, raw debuffs, "blank their card" cuts
 *  - control : command pitchers, ties/blanks, anti-chain tools
 */
export type BrawlFlavor = "power" | "speed" | "guile" | "heat" | "control";

export interface MlbPlayer {
  id: string;
  name: string;
  team: string;
  role: "Batter" | "Pitcher";
  handedness: Handedness;
  signatureCardIds: string[];
  /**
   * Shape sockets exposed by the player at the plate in SZN Mode. Items
   * connect to the player via these sides through the existing shape engine.
   * Defaults are derived from each player's first signature card so legacy
   * paths (Quick Match, Auction Draft) don't need to deal with them.
   */
  leftShape: ShapeType;
  rightShape: ShapeType;
  /** SZN Mode class tag. */
  tag: ClassTag;
  /**
   * Brawl Mode playstyle flavor. Selects the curated brawl-only general
   * pool the player drafts 2 cards from on a brawl deal. Outside brawl
   * the field is ignored; the full general pools still apply.
   */
  brawlFlavor: BrawlFlavor;
}

/**
 * SZN Mode class tag per player. Drives team-wide synergy when identical tags
 * sit next to each other on the roster (see `synergies.ts`). Defined here next
 * to PLAYERS so adding a player can't silently leak into SZN mode without a tag.
 */
const PLAYER_TAGS: Record<string, ClassTag> = {
  judge: "Slugger",
  "ohtani-bat": "Slugger",
  soto: "Contact",
  delacruz: "Speedster",
  betts: "Contact",
  witt: "Speedster",
  harper: "Slugger",
  acuna: "Speedster",
  henderson: "Contact",
  vlad: "Slugger",
  trout: "Veteran",
  freeman: "Veteran",
  alvarez: "Slugger",
  seager: "Contact",
  jramirez: "Veteran",
  alonso: "Slugger",
  tturner: "Speedster",
  rutschman: "Rookie",
  devers: "Slugger",
  lindor: "Veteran",
  altuve: "Veteran",
  chisholm: "Speedster",
  skenes: "Strikeout",
  cole: "Veteran",
  skubal: "Strikeout",
  wheeler: "Starter",
  clase: "Closer",
  miller: "Closer",
  sale: "Veteran",
  "ohtani-pit": "Strikeout",
  yamamoto: "Control",
  cease: "Strikeout",
};

/**
 * Brawl Mode playstyle per player. Curated so the same player always
 * feels the same in brawl while still rotating in fresh cards each
 * deal (the curated subset is ~10 cards per flavor, larger than the
 * 2 we actually draw). See `BrawlFlavor` for the design intent.
 */
const PLAYER_BRAWL_FLAVORS: Record<string, BrawlFlavor> = {
  judge: "power",
  "ohtani-bat": "power",
  soto: "guile",
  delacruz: "speed",
  betts: "guile",
  witt: "speed",
  harper: "power",
  acuna: "speed",
  henderson: "guile",
  vlad: "power",
  trout: "guile",
  freeman: "guile",
  alvarez: "power",
  seager: "guile",
  jramirez: "guile",
  alonso: "power",
  tturner: "speed",
  rutschman: "guile",
  devers: "power",
  lindor: "guile",
  altuve: "speed",
  chisholm: "speed",
  skenes: "heat",
  cole: "heat",
  skubal: "heat",
  wheeler: "heat",
  clase: "control",
  miller: "control",
  sale: "heat",
  "ohtani-pit": "heat",
  yamamoto: "control",
  cease: "control",
};

/**
 * Curated brawl-only general pools per flavor. Each list contains
 * 8-12 brawl-eligible general cards that thematically pair with the
 * flavor; dealHand draws ONE of the 2 generals from this pool (or
 * skips to the universal pool if the curated list is exhausted for
 * the role). Cards intentionally overlap across flavors so the
 * sub-pools don't collapse to "5 unique cards per player". A card
 * listed here MUST exist in the broader BRAWL_GENERAL_{BATTING,
 * PITCHING} pool -- the module-load assert below enforces this so a
 * typo can't silently fall through.
 */
const BRAWL_FLAVOR_BATTING_POOL: Record<BrawlFlavor, string[]> = {
  power: ["b-62", "b-76", "b-79", "b-80", "b-81", "b-83", "b-84", "b-86", "b-87"],
  speed: ["b-71", "b-72", "b-78", "b-85", "b-88", "b-93", "b-94", "b-96"],
  guile: ["b-61", "b-64", "b-68", "b-71", "b-72", "b-74", "b-75", "b-77", "b-95"],
  // Pitching flavors never deal from the batting curated pool -- but
  // we still need keys so the type stays exhaustive. Empty lists fall
  // through to the universal batting pool, which is fine for the
  // (never-reached) pitching-side batting deal in brawl.
  heat: [],
  control: [],
};

const BRAWL_FLAVOR_PITCHING_POOL: Record<BrawlFlavor, string[]> = {
  heat: ["p-73", "p-74", "p-81", "p-82", "p-85", "p-89", "p-90", "p-93"],
  control: ["p-71", "p-80", "p-84", "p-86", "p-91", "p-92", "p-94", "p-96"],
  guile: ["p-72", "p-76", "p-83", "p-87"],
  power: [],
  speed: [],
};

interface PlayerSeed {
  id: string;
  name: string;
  team: string;
  role: "Batter" | "Pitcher";
  handedness: Handedness;
  signatureCardIds: string[];
}

const PLAYER_SEEDS: PlayerSeed[] = [
  // ===== Batters =====
  { id: "judge", name: "Aaron Judge", team: "NYY", role: "Batter", handedness: "R", signatureCardIds: ["b-1", "b-2", "b-3"] },
  { id: "ohtani-bat", name: "Shohei Ohtani", team: "LAD", role: "Batter", handedness: "L", signatureCardIds: ["b-4", "b-5", "b-6"] },
  { id: "soto", name: "Juan Soto", team: "NYY", role: "Batter", handedness: "L", signatureCardIds: ["b-7", "b-8", "b-9"] },
  { id: "delacruz", name: "Elly De La Cruz", team: "CIN", role: "Batter", handedness: "S", signatureCardIds: ["b-10", "b-11", "b-12"] },
  { id: "betts", name: "Mookie Betts", team: "LAD", role: "Batter", handedness: "R", signatureCardIds: ["b-13", "b-14", "b-15"] },
  { id: "witt", name: "Bobby Witt Jr.", team: "KCR", role: "Batter", handedness: "R", signatureCardIds: ["b-16", "b-17", "b-18"] },
  { id: "harper", name: "Bryce Harper", team: "PHI", role: "Batter", handedness: "L", signatureCardIds: ["b-19", "b-20", "b-21"] },
  { id: "acuna", name: "Ronald Acuña Jr.", team: "ATL", role: "Batter", handedness: "R", signatureCardIds: ["b-22", "b-23", "b-24"] },
  { id: "henderson", name: "Gunnar Henderson", team: "BAL", role: "Batter", handedness: "L", signatureCardIds: ["b-25", "b-26", "b-27"] },
  { id: "vlad", name: "Vladimir Guerrero Jr.", team: "TOR", role: "Batter", handedness: "R", signatureCardIds: ["b-28", "b-29", "b-30"] },
  { id: "trout", name: "Mike Trout", team: "LAA", role: "Batter", handedness: "R", signatureCardIds: ["b-100", "b-101", "b-102"] },
  { id: "freeman", name: "Freddie Freeman", team: "LAD", role: "Batter", handedness: "L", signatureCardIds: ["b-103", "b-104", "b-105"] },
  { id: "alvarez", name: "Yordan Alvarez", team: "HOU", role: "Batter", handedness: "L", signatureCardIds: ["b-106", "b-107", "b-108"] },
  { id: "seager", name: "Corey Seager", team: "TEX", role: "Batter", handedness: "L", signatureCardIds: ["b-109", "b-110", "b-111"] },
  { id: "jramirez", name: "Jose Ramirez", team: "CLE", role: "Batter", handedness: "S", signatureCardIds: ["b-112", "b-113", "b-114"] },
  { id: "alonso", name: "Pete Alonso", team: "NYM", role: "Batter", handedness: "R", signatureCardIds: ["b-115", "b-116", "b-117"] },
  { id: "tturner", name: "Trea Turner", team: "PHI", role: "Batter", handedness: "R", signatureCardIds: ["b-118", "b-119", "b-120"] },
  { id: "rutschman", name: "Adley Rutschman", team: "BAL", role: "Batter", handedness: "S", signatureCardIds: ["b-121", "b-122", "b-123"] },
  { id: "devers", name: "Rafael Devers", team: "BOS", role: "Batter", handedness: "L", signatureCardIds: ["b-124", "b-125", "b-126"] },
  { id: "lindor", name: "Francisco Lindor", team: "NYM", role: "Batter", handedness: "S", signatureCardIds: ["b-127", "b-128", "b-129"] },
  { id: "altuve", name: "Jose Altuve", team: "HOU", role: "Batter", handedness: "R", signatureCardIds: ["b-130", "b-131", "b-132"] },
  { id: "chisholm", name: "Jazz Chisholm Jr.", team: "NYY", role: "Batter", handedness: "L", signatureCardIds: ["b-133", "b-134", "b-135"] },

  // ===== Pitchers =====
  { id: "skenes", name: "Paul Skenes", team: "PIT", role: "Pitcher", handedness: "R", signatureCardIds: ["p-31", "p-32", "p-33"] },
  { id: "cole", name: "Gerrit Cole", team: "NYY", role: "Pitcher", handedness: "R", signatureCardIds: ["p-34", "p-35", "p-36"] },
  { id: "skubal", name: "Tarik Skubal", team: "DET", role: "Pitcher", handedness: "L", signatureCardIds: ["p-37", "p-38", "p-39"] },
  { id: "wheeler", name: "Zack Wheeler", team: "PHI", role: "Pitcher", handedness: "R", signatureCardIds: ["p-40", "p-41", "p-42"] },
  { id: "clase", name: "Emmanuel Clase", team: "CLE", role: "Pitcher", handedness: "R", signatureCardIds: ["p-43", "p-44", "p-45"] },
  { id: "miller", name: "Mason Miller", team: "OAK", role: "Pitcher", handedness: "R", signatureCardIds: ["p-46", "p-47", "p-48"] },
  { id: "sale", name: "Chris Sale", team: "ATL", role: "Pitcher", handedness: "L", signatureCardIds: ["p-49", "p-50", "p-51"] },
  { id: "ohtani-pit", name: "Shohei Ohtani", team: "LAD", role: "Pitcher", handedness: "R", signatureCardIds: ["p-52", "p-53", "p-54"] },
  { id: "yamamoto", name: "Yoshinobu Yamamoto", team: "LAD", role: "Pitcher", handedness: "R", signatureCardIds: ["p-55", "p-56", "p-57"] },
  { id: "cease", name: "Dylan Cease", team: "SDP", role: "Pitcher", handedness: "R", signatureCardIds: ["p-58", "p-59", "p-60"] },
];

/**
 * Build the live `MlbPlayer` list. We derive each player's left/right shape
 * from their first signature card's shapes so SZN mode connectors are
 * authentic to the player's pitch/hit identity.
 *
 * Falls back to ('square', 'circle') if the signature card is missing. The
 * existing module-load assertion below catches that case as a startup error,
 * but the fallback keeps tooling-only paths (typecheck before assertions
 * run) from crashing.
 */
const _seedShapeFor = (cardId: string): { left: ShapeType; right: ShapeType } => {
  const card = SESSION_CARDS.find((c) => c.id === cardId);
  if (!card) return { left: "square", right: "circle" };
  return { left: card.leftShape, right: card.rightShape };
};

export const PLAYERS: MlbPlayer[] = PLAYER_SEEDS.map((seed) => {
  const tag = PLAYER_TAGS[seed.id];
  if (!tag) {
    throw new Error(
      `players.ts: ${seed.id} (${seed.name}) is missing a SZN Mode class tag in PLAYER_TAGS.`,
    );
  }
  const brawlFlavor = PLAYER_BRAWL_FLAVORS[seed.id];
  if (!brawlFlavor) {
    throw new Error(
      `players.ts: ${seed.id} (${seed.name}) is missing a Brawl Mode flavor in PLAYER_BRAWL_FLAVORS.`,
    );
  }
  const shapes = _seedShapeFor(seed.signatureCardIds[0]);
  return {
    ...seed,
    leftShape: shapes.left,
    rightShape: shapes.right,
    tag,
    brawlFlavor,
  };
});

export const BATTERS = PLAYERS.filter((p) => p.role === "Batter");
export const PITCHERS = PLAYERS.filter((p) => p.role === "Pitcher");

// Sourced from SESSION_CARDS so dealt hands carry the per-session
// shape layout. Card IDs / abilityType / tags / baseValue are identical to
// ALL_CARDS; only leftShape / rightShape differ (see `randomizeCardShapes`
// in cards.ts).
const cardsById: Record<string, CardDefinition> = {};
for (const c of SESSION_CARDS) cardsById[c.id] = c;

// Module-load assertion: every player's signatureCardIds must resolve to a
// real CardDefinition. Previously a typo'd id silently dropped via
// `.filter(Boolean)` in `dealHand`, leaving that player with a 4-card hand
// (3 sig + 2 general) becoming 4 cards (2 sig + 2 general) -- breaking the
// implicit "5 cards per hand" invariant the rest of the engine relies on.
// This throws at startup so a data drift surfaces immediately instead of
// limping into the game with an under-sized hand.
for (const p of PLAYERS) {
  for (const id of p.signatureCardIds) {
    if (!cardsById[id]) {
      throw new Error(
        `players.ts: ${p.id} (${p.name}) references signatureCardId "${id}" which does not exist in SESSION_CARDS.`,
      );
    }
  }
  if (p.signatureCardIds.length !== 3) {
    throw new Error(
      `players.ts: ${p.id} must have exactly 3 signatureCardIds, got ${p.signatureCardIds.length}.`,
    );
  }
}

const GENERAL_BATTING = SESSION_CARDS.filter((c) => c.type === "Batting" && c.abilityType === "General Draw");
const GENERAL_PITCHING = SESSION_CARDS.filter((c) => c.type === "Pitching" && c.abilityType === "General Draw");

// Brawl Mode general pools: curated subset that pulls only cards whose
// effect is one-line-readable on the card face. The full general pool
// contains Hit-Scale-only cards, modal triggers, base-running effects,
// and discard/reveal mechanics that don't fit the 15s snap timer. Any
// card without a `brawlTagline` is excluded; the static set of "this
// card is brawl-eligible" is the single source of truth in
// `brawlTaglines.ts` -> stamped onto SESSION_CARDS at module load.
const BRAWL_GENERAL_BATTING = GENERAL_BATTING.filter((c) => !!c.brawlTagline);
const BRAWL_GENERAL_PITCHING = GENERAL_PITCHING.filter((c) => !!c.brawlTagline);

// Resolve curated brawl flavor pools to live CardDefinitions on
// startup so the deal-time hot path never re-scans the global card
// list. The assertion below throws if any tagged card id isn't in
// the broader brawl pool, which usually means the tag list and the
// brawl-eligibility tag in `brawlTaglines.ts` drifted out of sync.
const BRAWL_FLAVOR_POOLS_BATTING: Record<BrawlFlavor, CardDefinition[]> = (() => {
  const out: Record<BrawlFlavor, CardDefinition[]> = {
    power: [], speed: [], guile: [], heat: [], control: [],
  };
  for (const flavor of Object.keys(BRAWL_FLAVOR_BATTING_POOL) as BrawlFlavor[]) {
    const ids = BRAWL_FLAVOR_BATTING_POOL[flavor];
    for (const id of ids) {
      const card = BRAWL_GENERAL_BATTING.find((c) => c.id === id);
      if (!card) {
        throw new Error(
          `players.ts: BRAWL_FLAVOR_BATTING_POOL.${flavor} references "${id}" but it is not in BRAWL_GENERAL_BATTING (missing brawlTagline or wrong type).`,
        );
      }
      out[flavor].push(card);
    }
  }
  return out;
})();

const BRAWL_FLAVOR_POOLS_PITCHING: Record<BrawlFlavor, CardDefinition[]> = (() => {
  const out: Record<BrawlFlavor, CardDefinition[]> = {
    power: [], speed: [], guile: [], heat: [], control: [],
  };
  for (const flavor of Object.keys(BRAWL_FLAVOR_PITCHING_POOL) as BrawlFlavor[]) {
    const ids = BRAWL_FLAVOR_PITCHING_POOL[flavor];
    for (const id of ids) {
      const card = BRAWL_GENERAL_PITCHING.find((c) => c.id === id);
      if (!card) {
        throw new Error(
          `players.ts: BRAWL_FLAVOR_PITCHING_POOL.${flavor} references "${id}" but it is not in BRAWL_GENERAL_PITCHING (missing brawlTagline or wrong type).`,
        );
      }
      out[flavor].push(card);
    }
  }
  return out;
})();

/** Expected hand size for a fresh at-bat. */
const EXPECTED_HAND_SIZE = 5;

/**
 * Build a 5-card hand for an at-bat: the player's 3 signature cards plus 2 random
 * cards drawn from the corresponding general pool. Uses a seeded RNG so the same
 * (player, seed) pair produces the same hand for a given inning.
 *
 * Throws if the player's data is broken (missing signature card, empty
 * pool); silently shrinking the hand was previously a flaky failure mode.
 */
export function dealHand(
  player: MlbPlayer,
  seed = Math.floor(Math.random() * 1_000_000),
  opts?: { brawlMode?: boolean },
): CardDefinition[] {
  const signatures = player.signatureCardIds.map((id) => cardsById[id]);
  if (signatures.some((c) => !c)) {
    const missing = player.signatureCardIds.filter((id) => !cardsById[id]);
    throw new Error(
      `dealHand: ${player.id} (${player.name}) has unresolved signatureCardIds [${missing.join(", ")}].`,
    );
  }
  // Brawl swaps in a curated general pool so every dealt general carries
  // a one-line `brawlTagline` the player can read inside the 15s snap
  // window. Other modes keep the full pool. (Signatures are always
  // dealt as-is; their brawl simplifications live in `brawlTaglines`.)
  const battingPool = opts?.brawlMode ? BRAWL_GENERAL_BATTING : GENERAL_BATTING;
  const pitchingPool = opts?.brawlMode ? BRAWL_GENERAL_PITCHING : GENERAL_PITCHING;
  const generalPool = player.role === "Batter" ? battingPool : pitchingPool;
  // Per-player brawl flavoring: in brawl mode draw ONE of the two
  // generals from the player's curated flavor pool (so e.g. Aaron
  // Judge "feels" power-y every brawl) and the other from the wider
  // brawl pool (so the player doesn't see the same 5 cards every
  // deal). Falls back to the wide pool if the flavor pool is empty
  // for the role (intentional: pitching-flavor batters etc.).
  let generals: CardDefinition[];
  if (opts?.brawlMode) {
    const flavorPool =
      player.role === "Batter"
        ? BRAWL_FLAVOR_POOLS_BATTING[player.brawlFlavor]
        : BRAWL_FLAVOR_POOLS_PITCHING[player.brawlFlavor];
    if (flavorPool.length > 0) {
      const [flavored] = pickRandomTwo(flavorPool, seed);
      // Draw the second general from the wide pool, but EXCLUDE the
      // flavor card we already picked so duplicates can't co-occur.
      const widePoolMinusFlavored = generalPool.filter(
        (c) => c.id !== flavored.id,
      );
      const [wide] = pickRandomTwo(widePoolMinusFlavored, seed + 1);
      generals = [flavored, wide];
    } else {
      generals = pickRandomTwo(generalPool, seed);
    }
  } else {
    generals = pickRandomTwo(generalPool, seed);
  }
  const hand = [...signatures, ...generals];
  if (hand.length !== EXPECTED_HAND_SIZE) {
    throw new Error(
      `dealHand: produced ${hand.length}-card hand for ${player.id} (expected ${EXPECTED_HAND_SIZE}). General pool size = ${generalPool.length}.`,
    );
  }
  return hand;
}

function pickRandomTwo<T>(pool: T[], seed: number): T[] {
  if (pool.length <= 2) return [...pool];
  const rng = mulberry32(seed);
  const indices = new Set<number>();
  while (indices.size < 2) indices.add(Math.floor(rng() * pool.length));
  return [...indices].map((i) => pool[i]);
}

// Small deterministic PRNG so a given seed reproducibly deals the same hand.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
