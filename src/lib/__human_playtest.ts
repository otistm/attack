/**
 * Human-style playtest — shuffled order, partial seam affirmation (not AI-optimal).
 * Opponent still plays optimal layout (skill gap model).
 * Run: npm run test:human-playtest
 */
import type { CardDefinition } from "./cards";
import { canConnectAny, seamKey } from "./connect";
import {
  BRAWL_CLASSES,
  classOptionFor,
  classPoolIds,
  type BrawlClass,
} from "./elementClassPools";
import { dealBrawlElementHand } from "./elementDeal";
import { optimizeElementHand } from "./brawlElements";
import {
  simulateBrawlCombat,
  simulateBrawlGame,
  type PlaytestGameResult,
} from "./__brawl_playtest_core";
import { randomOpponentClass } from "./elementClassPools";

const GAMES = 50;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Shuffled order; ~55% chance per connectable seam; cap at 2 seams. */
export function humanHandLayout(
  hand: CardDefinition[],
  seed: number,
): { hand: CardDefinition[]; affirmedSeams: Set<string> } {
  const rng = mulberry32(seed);
  const order = shuffle(hand, rng);
  const seams = new Set<string>();
  for (let i = 1; i < order.length; i++) {
    const left = order[i - 1];
    const right = order[i];
    if (!canConnectAny(left, right)) continue;
    if (rng() < 0.55) seams.add(seamKey(left.id, right.id));
  }
  if (seams.size > 2) {
    const keys = [...seams];
    seams.clear();
    shuffle(keys, rng)
      .slice(0, 2)
      .forEach((k) => seams.add(k));
  }
  return { hand: order, affirmedSeams: seams };
}

function simulateHumanGame(userClass: BrawlClass, seed: number): PlaytestGameResult {
  const oppClass = randomOpponentClass(userClass);
  const userRaw = dealBrawlElementHand(5, classPoolIds(userClass), seed);
  const oppRaw = dealBrawlElementHand(5, classPoolIds(oppClass), seed + 5000);
  const userHuman = humanHandLayout(userRaw, seed + 99);
  const oppOpt = optimizeElementHand(oppRaw);
  return simulateBrawlCombat(
    { hand: userHuman.hand, affirmedSeams: userHuman.affirmedSeams },
    { hand: oppOpt.hand, affirmedSeams: oppOpt.affirmedSeams },
    oppClass,
  );
}

console.log(
  `=== HUMAN-STYLE PLAYTEST (${GAMES} games/class) ===\n` +
    "User: shuffled order, ~55% seam affirm (max 2). Opponent: optimal AI.\n",
);

for (const cls of BRAWL_CLASSES) {
  const opt = classOptionFor(cls);
  let humanWins = 0;
  let optimalWins = 0;
  let humanSeamSum = 0;
  let optimalSeamSum = 0;
  let humanHpSum = 0;
  let optimalHpSum = 0;

  for (let g = 0; g < GAMES; g++) {
    const seed = 120_000 + g * 9973 + cls.charCodeAt(0);
    const human = simulateHumanGame(cls, seed);
    const optimal = simulateBrawlGame(cls, seed);
    if (human.won) humanWins++;
    if (optimal.won) optimalWins++;
    humanSeamSum += human.userSeams;
    optimalSeamSum += optimal.userSeams;
    humanHpSum += human.userHp;
    optimalHpSum += optimal.userHp;
  }

  console.log(`## ${opt.mageName} (${cls})`);
  console.log(
    `  Optimal AI:  ${optimalWins}/${GAMES} (${((100 * optimalWins) / GAMES).toFixed(0)}%) | avg seams ${(optimalSeamSum / GAMES).toFixed(2)} | avg HP ${(optimalHpSum / GAMES).toFixed(1)}`,
  );
  console.log(
    `  Human-style: ${humanWins}/${GAMES} (${((100 * humanWins) / GAMES).toFixed(0)}%) | avg seams ${(humanSeamSum / GAMES).toFixed(2)} | avg HP ${(humanHpSum / GAMES).toFixed(1)}`,
  );
  const drop = optimalWins - humanWins;
  const gapLabel =
    humanWins < optimalWins ? "human weaker" : "human stronger or equal";
  console.log(
    `  Skill gap: ${drop >= 0 ? "-" : "+"}${Math.abs(drop)} wins vs optimal (${gapLabel})`,
  );
  console.log("");
}

console.log("human playtest complete");
