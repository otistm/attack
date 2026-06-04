/**
 * Each attack group runs its own cooldown — fires when overlay hits zero.
 */
import {
  BRAWL_ATTACK_COOLDOWN_BASE_MS,
  brawlCardOverlayCooldownMs,
} from "./brawlElements";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function simIndependentGroups(groupLengths: number[]) {
  const groups = groupLengths.map((length) => ({
    length,
    overlayRemaining: brawlCardOverlayCooldownMs(length),
    nextFireAt: brawlCardOverlayCooldownMs(length),
  }));
  const misfires: string[] = [];

  for (let t = 50; t <= 60000; t += 50) {
    for (const g of groups) {
      g.overlayRemaining = Math.max(0, g.overlayRemaining - 50);
    }

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (t >= g.nextFireAt) {
        if (g.overlayRemaining > 100) {
          misfires.push(
            `g${i}@${t} rem=${Math.round(g.overlayRemaining)} slot=${g.nextFireAt}`,
          );
        }
        const slot = brawlCardOverlayCooldownMs(g.length);
        g.overlayRemaining = slot;
        g.nextFireAt = t + slot;
      }
    }
  }

  return misfires;
}

assert(brawlCardOverlayCooldownMs(1) === 5000, "solo starts at 5s");
assert(brawlCardOverlayCooldownMs(2) === 4000, "pair starts at 4s");
assert(brawlCardOverlayCooldownMs(3) === 3000, "trio starts at 3s");
for (let len = 1; len <= 5; len++) {
  assert(
    brawlCardOverlayCooldownMs(len) <= BRAWL_ATTACK_COOLDOWN_BASE_MS,
    "overlay never exceeds 5s",
  );
}

const tripleSolo = simIndependentGroups([1, 1, 1]);
assert(
  tripleSolo.length === 0,
  `independent solo groups fire at zero; got: ${tripleSolo.slice(0, 2).join(", ")}`,
);

const mixed = simIndependentGroups([2, 1, 3]);
assert(
  mixed.length === 0,
  `mixed chain lengths fire at zero; got: ${mixed.slice(0, 2).join(", ")}`,
);

const fullChain = simIndependentGroups([5]);
assert(fullChain.length === 0, "single connected hand fires at zero");

console.log("cooldown simulation checks passed");
