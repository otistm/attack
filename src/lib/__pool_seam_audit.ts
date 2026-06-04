/**
 * Class pool seam difficulty audit — optimal layouts over many deals.
 */
import { elementCatalogId } from "./elementDeal";
import { dealBrawlElementHand } from "./elementDeal";
import { ELEMENT_CARDS } from "./elementCards";
import {
  BRAWL_CLASSES,
  classPoolIds,
  type BrawlClass,
} from "./elementClassPools";
import {
  computeElementBonds,
  optimizeElementHand,
} from "./brawlElements";
import { computeElementBondsWithAbilities } from "./elementAbilities";
import { isWildcardBridgeCatalogId } from "./elementClassPools";

const DEALS_PER_CLASS = 500;
const HAND_SIZE = 5;

function copyKind(catalogId: string): string {
  const card = ELEMENT_CARDS.find((c) => c.id === catalogId);
  const line = card?.brawlTagline ?? card?.description ?? "";
  if (card?.combineConstraint?.leftWildcard || card?.combineConstraint?.rightWildcard) {
    return "wildcard";
  }
  if (/^solo/i.test(line)) return "solo";
  if (/^snapped/i.test(line)) return "snapped";
  if (/^if activated/i.test(line)) return "ifActivated";
  if (/^your /i.test(line)) return "passive";
  if (/seam:/i.test(line)) return "seamNote";
  return "other";
}

function leftProcCount(
  hand: ReturnType<typeof optimizeElementHand>["hand"],
  seams: ReadonlySet<string>,
): number {
  const bonds = computeElementBonds(hand, seams);
  const leftIds = new Set(bonds.map((b) => b.leftCardId));
  let n = 0;
  for (const c of hand) {
    if (!leftIds.has(c.id)) continue;
    const cat = elementCatalogId(c.id);
    const line = ELEMENT_CARDS.find((x) => x.id === cat)?.brawlTagline ?? "";
    if (/^if activated/i.test(line)) n++;
  }
  return n;
}

interface ClassAudit {
  classId: BrawlClass;
  deals: number;
  seamHist: Record<number, number>;
  seamSum: number;
  zeroSeams: number;
  oneSeam: number;
  twoPlusSeams: number;
  withWildcardDealt: number;
  withWildcardTwoPlusSeams: number;
  copyKinds: Record<string, number>;
  bondPowerSum: number;
  leftProcSum: number;
}

function auditClass(cls: BrawlClass): ClassAudit {
  const pool = classPoolIds(cls);
  const seamHist: Record<number, number> = {};
  const copyKinds: Record<string, number> = {};
  let seamSum = 0;
  let zeroSeams = 0;
  let oneSeam = 0;
  let twoPlusSeams = 0;
  let withWildcardDealt = 0;
  let withWildcardTwoPlusSeams = 0;
  let bondPowerSum = 0;
  let leftProcSum = 0;

  for (let i = 0; i < DEALS_PER_CLASS; i++) {
    const hand = dealBrawlElementHand(HAND_SIZE, pool, 10_000 + i * 17 + cls.charCodeAt(0));
    const opt = optimizeElementHand(hand);
    const seams = opt.affirmedSeams.size;
    seamHist[seams] = (seamHist[seams] ?? 0) + 1;
    seamSum += seams;
    if (seams === 0) zeroSeams++;
    else if (seams === 1) oneSeam++;
    else twoPlusSeams++;

    const bonds = computeElementBondsWithAbilities(opt.hand, opt.affirmedSeams);
    bondPowerSum += bonds.reduce((s, b) => s + b.power, 0);
    leftProcSum += leftProcCount(opt.hand, opt.affirmedSeams);

    const hasWildcard = hand.some((c) =>
      isWildcardBridgeCatalogId(elementCatalogId(c.id)),
    );
    if (hasWildcard) {
      withWildcardDealt++;
      if (seams >= 2) withWildcardTwoPlusSeams++;
    }

    for (const c of hand) {
      const kind = copyKind(elementCatalogId(c.id));
      copyKinds[kind] = (copyKinds[kind] ?? 0) + 1;
    }
  }

  return {
    classId: cls,
    deals: DEALS_PER_CLASS,
    seamHist,
    seamSum,
    zeroSeams,
    oneSeam,
    twoPlusSeams,
    withWildcardDealt,
    withWildcardTwoPlusSeams,
    copyKinds,
    bondPowerSum,
    leftProcSum,
  };
}

function medianFromHist(hist: Record<number, number>, total: number): number {
  const target = Math.floor(total / 2);
  let acc = 0;
  const keys = Object.keys(hist)
    .map(Number)
    .sort((a, b) => a - b);
  for (const k of keys) {
    acc += hist[k] ?? 0;
    if (acc > target) return k;
  }
  return 0;
}

let failed = 0;

console.log(`=== POOL SEAM AUDIT (${DEALS_PER_CLASS} deals/class, hand=${HAND_SIZE}) ===\n`);

for (const cls of BRAWL_CLASSES) {
  const a = auditClass(cls);
  const avgSeams = a.seamSum / a.deals;
  const medSeams = medianFromHist(a.seamHist, a.deals);
  const avgBondPower = a.bondPowerSum / a.deals;
  const avgLeftProc = a.leftProcSum / a.deals;

  console.log(`--- ${cls.toUpperCase()} (pool ${classPoolIds(cls).length} cards) ---`);
  console.log(`  Optimal seams: avg ${avgSeams.toFixed(2)}, median ${medSeams}`);
  console.log(
    `  Distribution: 0=${a.zeroSeams} (${((100 * a.zeroSeams) / a.deals).toFixed(1)}%) ` +
      `1=${a.oneSeam} (${((100 * a.oneSeam) / a.deals).toFixed(1)}%) ` +
      `2+=${a.twoPlusSeams} (${((100 * a.twoPlusSeams) / a.deals).toFixed(1)}%)`,
  );
  console.log(`  Seam histogram: ${JSON.stringify(a.seamHist)}`);
  console.log(`  Avg bond power (optimal): ${avgBondPower.toFixed(1)}`);
  console.log(`  Avg If-activated left procs (optimal): ${avgLeftProc.toFixed(2)}`);
  console.log(
    `  Wildcard in hand: ${a.withWildcardDealt}/${a.deals} ` +
      `(${((100 * a.withWildcardDealt) / a.deals).toFixed(1)}%), ` +
      `2+ seams when wildcard: ${a.withWildcardTwoPlusSeams}/${Math.max(1, a.withWildcardDealt)}`,
  );
  console.log(`  Dealt copy mix: ${JSON.stringify(a.copyKinds)}`);
  console.log("");

  // Soft gates after balance pass
  const maxAvg =
    cls === "freeze" ? 2.55 : cls === "fire" ? 2.35 : cls === "poison" ? 2.0 : 1.85;
  if (avgSeams > maxAvg) {
    console.error(
      `  [${cls}] avg optimal seams ${avgSeams.toFixed(2)} > ${maxAvg}`,
    );
    failed++;
  }
}

if (failed > 0) {
  console.error(`pool seam audit: ${failed} class(es) above seam target`);
  process.exit(1);
}

console.log("pool seam audit passed");
