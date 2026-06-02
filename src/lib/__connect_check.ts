/**
 * Element brawl + connect smoke tests.
 */
import { seamKey, canConnectAny } from "./connect";
import { ELEMENT_CARDS } from "./elementCards";
import {
  applyElementCombatHit,
  computeElementBondsWithAbilities,
  resolvedSnapDisplayValue,
} from "./elementAbilities";
import { freshElementCombatState } from "./brawlElements";

function assert(cond: boolean, msg: string, detail?: unknown) {
  if (!cond) {
    console.error("FAIL ", msg, detail ?? "");
    process.exitCode = 1;
  }
}

const ember = { ...ELEMENT_CARDS[0], id: "el-01~t" };
const flare = { ...ELEMENT_CARDS[1], id: "el-02~t" };
const seams = new Set([seamKey(ember.id, flare.id)]);

assert(canConnectAny(ember, flare), "ember connects to flare");
const bonds = computeElementBondsWithAbilities([ember, flare], seams);
assert(bonds.length === 1 && bonds[0].power === 4, "ember chain bond power", bonds[0]?.power);

let combat = freshElementCombatState();
combat = applyElementCombatHit(
  combat,
  { element: "fire", power: 6, leftCardId: ELEMENT_CARDS[4].id },
  true,
);
assert(combat.cpuHP === 88, "blaze-style double fire", combat.cpuHP);

const snap = resolvedSnapDisplayValue(ember, [ember, flare], seams);
assert(snap.value === 2, "ember snap value in chain", snap);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("connect + element checks passed");
