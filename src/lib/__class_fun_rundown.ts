/**
 * Extended class playtest — fun/puzzle metrics for design review.
 * Run: npx tsx src/lib/__class_fun_rundown.ts
 */
import {
  BRAWL_CLASSES,
  classOptionFor,
  classPoolIds,
  type BrawlClass,
} from "./elementClassPools";
import { ELEMENT_CARDS } from "./elementCards";
import { dealBrawlElementHand, elementCatalogId } from "./elementDeal";
import { runClassPlaytest } from "./__brawl_playtest_core";
import { optimizeElementHand } from "./brawlElements";
import { isWildcardBridgeCatalogId } from "./elementClassPools";

const GAMES = 50;
const DEAL_SAMPLES = 200;

function catalogName(id: string): string {
  return ELEMENT_CARDS.find((c) => c.id === id)?.name ?? id;
}

function poolCardSummary(cls: BrawlClass): string {
  return classPoolIds(cls)
    .map((id) => {
      const c = ELEMENT_CARDS.find((x) => x.id === id);
      const tag = c?.brawlTagline?.split(":")[0] ?? "?";
      return `${c?.name ?? id} (${tag})`;
    })
    .join(", ");
}

function dealMetrics(cls: BrawlClass) {
  let zero = 0;
  let one = 0;
  let twoPlus = 0;
  let wildcardHands = 0;
  let soloViable = 0;

  for (let i = 0; i < DEAL_SAMPLES; i++) {
    const hand = dealBrawlElementHand(5, classPoolIds(cls), 77_000 + i * 31 + cls.charCodeAt(0));
    const opt = optimizeElementHand(hand);
    const seams = opt.affirmedSeams.size;
    if (seams === 0) zero++;
    else if (seams === 1) one++;
    else twoPlus++;
    if (hand.some((c) => isWildcardBridgeCatalogId(elementCatalogId(c.id)))) {
      wildcardHands++;
    }
    const hasSolo = hand.some((c) => {
      const line = ELEMENT_CARDS.find((x) => x.id === elementCatalogId(c.id))?.brawlTagline ?? "";
      return /^solo/i.test(line);
    });
    if (seams <= 1 && hasSolo) soloViable++;
  }

  return { zero, one, twoPlus, wildcardHands, soloViable };
}

console.log(`=== CLASS FUN RUNDOWN (${GAMES} combat sims + ${DEAL_SAMPLES} deal samples/class) ===\n`);

for (const cls of BRAWL_CLASSES) {
  const opt = classOptionFor(cls);
  const results = runClassPlaytest(cls, GAMES, 88_000 + cls.charCodeAt(0) * 1000);
  const wins = results.filter((r) => r.won).length;
  const losses = GAMES - wins;
  const avgHp = results.reduce((s, r) => s + r.userHp, 0) / GAMES;
  const avgOppHp = results.reduce((s, r) => s + r.oppHp, 0) / GAMES;
  const avgMs = results.reduce((s, r) => s + r.combatMs, 0) / GAMES;
  const avgSeams = results.reduce((s, r) => s + r.userSeams, 0) / GAMES;
  const avgBond = results.reduce((s, r) => s + r.userBondPower, 0) / GAMES;
  const sandstorm = results.filter((r) => r.sandstorm).length;
  const closeWins = results.filter((r) => r.won && r.userHp <= 35).length;
  const blowouts = results.filter((r) => r.won && r.oppHp <= 0 && r.userHp >= 60).length;
  const seam0wins = results.filter((r) => r.won && r.userSeams === 0).length;
  const seam0games = results.filter((r) => r.userSeams === 0).length;

  const oppWins: Record<string, number> = {};
  const oppLosses: Record<string, number> = {};
  for (const r of results) {
    const k = r.opponentClass;
    if (r.won) oppWins[k] = (oppWins[k] ?? 0) + 1;
    else oppLosses[k] = (oppLosses[k] ?? 0) + 1;
  }

  const dm = dealMetrics(cls);

  console.log(`## ${opt.mageName} — ${opt.title} (${cls})`);
  console.log(`Bio: ${opt.bio}`);
  console.log(`Pool (${classPoolIds(cls).length}): ${poolCardSummary(cls)}`);
  console.log("");
  console.log("Combat (optimal AI layout, random opponents):");
  console.log(`  Record: ${wins}-${losses} (${((100 * wins) / GAMES).toFixed(0)}% win)`);
  console.log(`  Avg HP remaining: ${avgHp.toFixed(1)} (foe ${avgOppHp.toFixed(1)})`);
  console.log(`  Close wins (≤35 HP): ${closeWins} | Blowouts (≥60 HP): ${blowouts}`);
  console.log(`  Avg combat: ${(avgMs / 1000).toFixed(1)}s | Sandstorm games: ${sandstorm}/${GAMES}`);
  console.log(`  Avg affirmed seams: ${avgSeams.toFixed(2)} | Avg bond power: ${avgBond.toFixed(1)}`);
  console.log(`  Wins with 0 seams: ${seam0wins}/${seam0games} zero-seam games`);
  console.log("  Matchups (W-L vs class):");
  for (const oc of BRAWL_CLASSES) {
    if (oc === cls) continue;
    const w = oppWins[oc] ?? 0;
    const l = oppLosses[oc] ?? 0;
    if (w + l > 0) console.log(`    vs ${oc}: ${w}-${l}`);
  }
  console.log("");
  console.log("Setup puzzle (deal samples, optimal seams):");
  console.log(
    `  0 seams: ${((100 * dm.zero) / DEAL_SAMPLES).toFixed(0)}% | 1 seam: ${((100 * dm.one) / DEAL_SAMPLES).toFixed(0)}% | 2+: ${((100 * dm.twoPlus) / DEAL_SAMPLES).toFixed(0)}%`,
  );
  console.log(
    `  Hands with wildcard bridge: ${((100 * dm.wildcardHands) / DEAL_SAMPLES).toFixed(0)}%`,
  );
  console.log(
    `  Solo-friendly deals (≤1 seam + solo card): ${((100 * dm.soloViable) / DEAL_SAMPLES).toFixed(0)}%`,
  );
  console.log("\n---\n");
}
