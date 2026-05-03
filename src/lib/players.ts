import { ALL_CARDS, CardDefinition, Handedness } from "./cards";

export interface MlbPlayer {
  id: string;
  name: string;
  team: string;
  role: "Batter" | "Pitcher";
  handedness: Handedness;
  signatureCardIds: string[];
}

export const PLAYERS: MlbPlayer[] = [
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

export const BATTERS = PLAYERS.filter((p) => p.role === "Batter");
export const PITCHERS = PLAYERS.filter((p) => p.role === "Pitcher");

const cardsById: Record<string, CardDefinition> = {};
for (const c of ALL_CARDS) cardsById[c.id] = c;

const GENERAL_BATTING = ALL_CARDS.filter((c) => c.type === "Batting" && c.abilityType === "General Draw");
const GENERAL_PITCHING = ALL_CARDS.filter((c) => c.type === "Pitching" && c.abilityType === "General Draw");

/**
 * Build a 5-card hand for an at-bat: the player's 3 signature cards plus 2 random
 * cards drawn from the corresponding general pool. Uses a seeded RNG so the same
 * (player, seed) pair produces the same hand for a given inning.
 */
export function dealHand(player: MlbPlayer, seed = Math.floor(Math.random() * 1_000_000)): CardDefinition[] {
  const signatures = player.signatureCardIds.map((id) => cardsById[id]).filter(Boolean);
  const generalPool = player.role === "Batter" ? GENERAL_BATTING : GENERAL_PITCHING;
  const generals = pickRandomTwo(generalPool, seed);
  return [...signatures, ...generals];
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
