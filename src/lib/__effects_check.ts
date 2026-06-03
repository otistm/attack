/**
 * Element card ability tests.
 */
import { seamKey } from "./connect";
import { ELEMENT_CARDS } from "./elementCards";
import {
  applyElementCombatHit,
  buildHandAttackQueueWithAbilities,
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

{
  const inst = (template: (typeof ELEMENT_CARDS)[number], suffix: string) => ({
    ...template,
    id: `${template.id}~${suffix}`,
  });
  const ember = inst(ELEMENT_CARDS[0], "t");
  const flare = inst(ELEMENT_CARDS[1], "t");
  const blaze = inst(ELEMENT_CARDS[4], "t");
  const bane = inst(ELEMENT_CARDS[9], "t");
  const glacia = inst(ELEMENT_CARDS[10], "t");
  const salve = inst(ELEMENT_CARDS[6], "t");

  const emberFlareSeams = new Set([seamKey(ember.id, flare.id)]);
  const bonds = computeElementBondsWithAbilities([ember, flare], emberFlareSeams);
  assert(bonds[0]?.power === 4, "ember+flare bond power", bonds[0]?.power);

  const baneQueue = buildHandAttackQueueWithAbilities([bane], [], null);
  assert(baneQueue[0]?.power === 6, "bane solo hit", baneQueue[0]?.power);

  let combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "fire", power: 6, leftCardId: blaze.id, rightCardId: flare.id },
    true,
  );
  assert(combat.cpuHP === 88, "blaze double fire", combat.cpuHP);

  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "freeze", power: 3, leftCardId: glacia.id, rightCardId: salve.id },
    true,
  );
  assert(combat.freezeOnCpu === 6, "glacia double freeze", combat.freezeOnCpu);

  const flint = inst(ELEMENT_CARDS[15], "t");
  const aegis = inst(ELEMENT_CARDS[8], "t");
  const flintSeams = new Set([seamKey(flint.id, aegis.id)]);
  const flintSnap = resolvedSnapDisplayValue(flint, [flint, aegis], flintSeams);
  assert(flintSnap.value === 3, "flint chain head", flintSnap.value);
}

{
  const {
    brawlAttackCooldownMs,
    brawlGroupReattackMs,
    brawlGroupInitialCooldownMs,
    brawlEffectiveAttackCooldownMs,
  } = await import("./brawlElements");
  assert(brawlAttackCooldownMs(1) === 5000, "solo side interval 5s");
  assert(brawlAttackCooldownMs(3) === 3000, "3-chain side interval 3s");
  assert(
    brawlGroupReattackMs(1, brawlAttackCooldownMs(3)) === 3000,
    "fully connected hand re-attacks every side interval",
  );
  assert(
    brawlGroupReattackMs(3, brawlAttackCooldownMs(1)) === 15000,
    "3 attack slots rotate at 5s each",
  );
  assert(
    brawlGroupReattackMs(2, 5000, 2) ===
      2 * brawlEffectiveAttackCooldownMs(5000, 2),
    "freeze extends group re-attack timing",
  );
  assert(
    brawlGroupInitialCooldownMs(0, 5000, 1000) === 6000,
    "first slot waits intro lead + one side interval",
  );
  assert(
    brawlGroupInitialCooldownMs(2, 5000, 1000) === 16000,
    "third slot staggers two extra side intervals",
  );
}

{
  const { sandstormTickDamage, BRAWL_SANDSTORM_TICK_MS } = await import(
    "./brawlSandstorm"
  );
  assert(BRAWL_SANDSTORM_TICK_MS === 1000, "sandstorm ticks once per second");
  assert(sandstormTickDamage(1) === 1, "sandstorm second 1 = 1 dmg");
  assert(sandstormTickDamage(2) === 2, "sandstorm second 2 = 2 dmg");
  assert(sandstormTickDamage(5) === 5, "sandstorm second 5 = 5 dmg");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("element effects checks passed");
