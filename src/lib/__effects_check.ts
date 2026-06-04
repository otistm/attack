/**
 * Element card ability tests.
 */
import { seamKey, canConnectAny } from "./connect";
import { ELEMENT_CARDS } from "./elementCards";
import {
  applyElementCombatHit,
  buildHandAttackQueueWithAbilities,
  computeElementBondsWithAbilities,
  ELEMENT_ABILITY_CATALOG,
  resolvedSnapDisplayValue,
} from "./elementAbilities";
import {
  freshElementCombatState,
  tickCombatDotStacks,
  VOLT_BARRIER_RETALIATE,
  grantVoltBarrier,
} from "./brawlElements";

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
  assert(baneQueue[0]?.power === 5, "bane solo hit", baneQueue[0]?.power);

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
  assert(combat.freezeOnCpu === 6 && combat.cpuHP === 97, "glacia double freeze + chip", {
    freeze: combat.freezeOnCpu,
    hp: combat.cpuHP,
  });

  const flint = inst(ELEMENT_CARDS[15], "t");
  const aegis = inst(ELEMENT_CARDS[8], "t");
  const flintSeams = new Set([seamKey(flint.id, aegis.id)]);
  const flintSnap = resolvedSnapDisplayValue(flint, [flint, aegis], flintSeams);
  assert(flintSnap.value === 3, "flint chain head", flintSnap.value);

  const tailwind = inst(ELEMENT_CARDS[26], "t");
  const jolt = inst(ELEMENT_CARDS[20], "t");
  const tailSeams = new Set([seamKey(tailwind.id, jolt.id)]);
  const tailSnap = resolvedSnapDisplayValue(
    tailwind,
    [jolt, tailwind],
    tailSeams,
  );
  assert(tailSnap.value === 2, "tailwind chain tail", tailSnap.value);

  const surge = inst(ELEMENT_CARDS[21], "t");
  const relay = inst(ELEMENT_CARDS[28], "t");
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "volt", power: 5, leftCardId: surge.id, rightCardId: relay.id },
    true,
  );
  assert(combat.cpuHP === 90, "surge double volt", combat.cpuHP);

  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "volt", power: 3, leftCardId: jolt.id, rightCardId: flare.id },
    true,
  );
  assert(combat.cpuHP === 97 && combat.burnOnCpu === 0, "volt instant no burn", {
    hp: combat.cpuHP,
    burn: combat.burnOnCpu,
  });

  const arc = inst(ELEMENT_CARDS[23], "t");
  combat = freshElementCombatState();
  combat.shieldOnCpu = 5;
  combat = applyElementCombatHit(
    combat,
    { element: "volt", power: 4, leftCardId: arc.id, rightCardId: relay.id },
    true,
  );
  assert(combat.shieldOnCpu === 0 && combat.cpuHP === 99, "arc pierce + shock", {
    shield: combat.shieldOnCpu,
    hp: combat.cpuHP,
  });

  const staticCard = inst(ELEMENT_CARDS[22], "t");
  combat = freshElementCombatState();
  combat.freezeOnPlayer = 4;
  combat = applyElementCombatHit(
    combat,
    { element: "volt", power: 2, leftCardId: staticCard.id, rightCardId: jolt.id },
    true,
  );
  assert(combat.freezeOnPlayer === 3 && combat.cpuHP === 98, "static thaw", {
    freeze: combat.freezeOnPlayer,
    hp: combat.cpuHP,
  });

  const grind = inst(ELEMENT_CARDS[24], "t");
  combat = freshElementCombatState();
  combat.burnOnCpu = 3;
  combat.poisonOnCpu = 2;
  combat = applyElementCombatHit(
    combat,
    { element: "poison", power: 4, leftCardId: grind.id, rightCardId: jolt.id },
    true,
  );
  assert(combat.cpuHP === 93, "grind +3 from DoT stacks (capped)", combat.cpuHP);

  const fuse = inst(ELEMENT_CARDS[25], "t");
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "fire", power: 4, leftCardId: fuse.id, rightCardId: jolt.id },
    true,
  );
  assert(combat.cpuHP === 94 && combat.burnOnCpu === 4, "fuse fire + volt chip", {
    hp: combat.cpuHP,
    burn: combat.burnOnCpu,
  });

  const snipe = inst(ELEMENT_CARDS[27], "t");
  const snipeQueue = buildHandAttackQueueWithAbilities([snipe], [], null);
  assert(snipeQueue[0]?.power === 6, "snipe solo shock", snipeQueue[0]?.power);

  const cinder = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-31")!,
    "t",
  );
  const flare2 = inst(ELEMENT_CARDS[1], "t2");
  const cinderSeams = new Set([seamKey(cinder.id, flare2.id)]);
  const cinderSnap = resolvedSnapDisplayValue(
    cinder,
    [cinder, flare2],
    cinderSeams,
  );
  assert(cinderSnap.value === 2, "cinder chain enabler", cinderSnap.value);

  const inferno = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-35")!,
    "t",
  );
  const infernoQueue = buildHandAttackQueueWithAbilities([inferno], [], null);
  assert(infernoQueue[0]?.power === 5, "inferno solo fire", infernoQueue[0]?.power);

  combat = freshElementCombatState();
  combat.burnOnCpu = 2;
  const scorch = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-34")!,
    "t",
  );
  combat = applyElementCombatHit(
    combat,
    { element: "fire", power: 4, leftCardId: scorch.id, rightCardId: flare2.id },
    true,
  );
  assert(combat.cpuHP === 95, "scorch +1 vs burning foe", combat.cpuHP);

  const hail = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-39")!,
    "t",
  );
  combat = freshElementCombatState();
  combat.freezeOnCpu = 8;
  combat = applyElementCombatHit(
    combat,
    { element: "freeze", power: 3, leftCardId: hail.id, rightCardId: salve.id },
    true,
  );
  assert(
    combat.freezeOnCpu === 13 && combat.cpuHP === 96,
    "hail +2 freeze at 8 stacks + chip (chilled bonus)",
    { freeze: combat.freezeOnCpu, hp: combat.cpuHP },
  );

  const overload = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-44")!,
    "t",
  );
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "volt", power: 4, leftCardId: overload.id, rightCardId: relay.id },
    true,
  );
  assert(combat.cpuHP === 92, "overload double volt", combat.cpuHP);

  const miasma = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-50")!,
    "t",
  );
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "poison", power: 4, leftCardId: miasma.id, rightCardId: bane.id },
    true,
  );
  assert(
    combat.cpuHP === 96 && combat.poisonOnCpu === 6,
    "miasma poison stack (trimmed)",
    { hp: combat.cpuHP, poison: combat.poisonOnCpu },
  );

  const matchstick = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-52")!,
    "t",
  );
  const matchQueue = buildHandAttackQueueWithAbilities([matchstick], [], null);
  assert(matchQueue[0]?.power === 2, "matchstick solo spark", matchQueue[0]?.power);
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { power: 2, leftCardId: matchstick.id },
    true,
  );
  assert(
    combat.cpuHP === 98 && combat.burnOnCpu === 1,
    "matchstick solo chip + burn",
    { hp: combat.cpuHP, burn: combat.burnOnCpu },
  );

  const tinderbox = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-51")!,
    "t",
  );
  const fuseForTinder = inst(ELEMENT_CARDS[25], "t2");
  assert(
    canConnectAny(tinderbox, fuseForTinder),
    "tinderbox wildcard links to fuse",
  );

  const kindling = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-57")!,
    "t",
  );
  const fuseForKindling = inst(ELEMENT_CARDS[25], "t3");
  assert(
    canConnectAny(fuseForKindling, kindling),
    "kindling wildcard links from fuse",
  );

  const oilFlaskHand = [ELEMENT_ABILITY_CATALOG.oilFlask];
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    {
      element: "fire",
      power: 3,
      leftCardId: inst(ELEMENT_CARDS[0], "of1").id,
      rightCardId: inst(ELEMENT_CARDS[1], "of2").id,
      attackerHandCatalogIds: oilFlaskHand,
    },
    true,
  );
  assert(
    combat.burnOnCpu === 4,
    "oil flask +1 burn on fire hit",
    { burn: combat.burnOnCpu },
  );

  const snowglobe = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-53")!,
    "t",
  );
  const hoarfrostForGlobe = inst(ELEMENT_CARDS.find((c) => c.id === "el-18")!, "t2");
  assert(
    canConnectAny(snowglobe, hoarfrostForGlobe),
    "snowglobe wildcard links to hoarfrost",
  );

  const icicle = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-54")!,
    "t",
  );
  const icicleQueue = buildHandAttackQueueWithAbilities([icicle], [], null);
  assert(icicleQueue[0]?.power === 3, "icicle solo chill", icicleQueue[0]?.power);
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { power: 3, leftCardId: icicle.id },
    true,
  );
  assert(
    combat.cpuHP === 97 && combat.freezeOnCpu === 1,
    "icicle solo chip + freeze",
    { hp: combat.cpuHP, freeze: combat.freezeOnCpu },
  );

  const chilltouch = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-55")!,
    "t",
  );
  const rime = inst(ELEMENT_CARDS.find((c) => c.id === "el-36")!, "t2");
  combat = freshElementCombatState();
  combat.freezeOnCpu = 2;
  combat = applyElementCombatHit(
    combat,
    { element: "freeze", power: 4, leftCardId: chilltouch.id, rightCardId: rime.id },
    true,
  );
  assert(
    combat.cpuHP === 94 && combat.freezeOnCpu === 7,
    "chilltouch +1 freeze vs chilled foe + chip",
    { hp: combat.cpuHP, freeze: combat.freezeOnCpu },
  );

  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    {
      element: "freeze",
      power: 4,
      leftCardId: rime.id,
      rightCardId: salve.id,
      combineCount: 1,
    },
    true,
  );
  assert(
    combat.cpuHP === 96 && combat.freezeOnCpu === 4,
    "solo freeze card full chip (combine 1)",
    { hp: combat.cpuHP, freeze: combat.freezeOnCpu },
  );

  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { element: "freeze", power: 8, leftCardId: hail.id, rightCardId: glacia.id, combineCount: 5 },
    true,
  );
  assert(
    combat.cpuHP === 95 && combat.freezeOnCpu === 8,
    "5-card freeze chain chip = power - N + buffer",
    { hp: combat.cpuHP, freeze: combat.freezeOnCpu },
  );

  const blackIce = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-56")!,
    "t",
  );
  combat = freshElementCombatState();
  combat.shieldOnCpu = 3;
  combat = applyElementCombatHit(
    combat,
    { element: "freeze", power: 4, leftCardId: blackIce.id, rightCardId: rime.id },
    true,
  );
  assert(
    combat.shieldOnCpu === 0 && combat.freezeOnCpu === 4 && combat.cpuHP === 98,
    "black ice pierces 1 shield on freeze + chip",
    { shield: combat.shieldOnCpu, freeze: combat.freezeOnCpu, hp: combat.cpuHP },
  );

  const shiver = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-59")!,
    "t",
  );
  const shiverQueue = buildHandAttackQueueWithAbilities([shiver], [], null);
  assert(shiverQueue[0]?.power === 3, "shiver solo chill", shiverQueue[0]?.power);
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { power: 3, leftCardId: shiver.id },
    true,
  );
  assert(
    combat.cpuHP === 97 && combat.freezeOnCpu === 2,
    "shiver solo chip + deep chill",
    { hp: combat.cpuHP, freeze: combat.freezeOnCpu },
  );

  const rimeShard = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-61")!,
    "t",
  );
  const rimeForShard = inst(ELEMENT_CARDS.find((c) => c.id === "el-36")!, "t2");
  assert(
    canConnectAny(rimeForShard, rimeShard),
    "rime shard wildcard links from rime",
  );

  const permafrost = inst(
    ELEMENT_CARDS.find((c) => c.id === "el-60")!,
    "t",
  );
  combat = freshElementCombatState();
  combat.freezeOnCpu = 3;
  combat = applyElementCombatHit(
    combat,
    {
      element: "freeze",
      power: 4,
      leftCardId: permafrost.id,
      rightCardId: rime.id,
      combineCount: 2,
    },
    true,
  );
  assert(
    combat.cpuHP === 93 && combat.freezeOnCpu === 7,
    "permafrost +2 chip vs chilled foe",
    { hp: combat.cpuHP, freeze: combat.freezeOnCpu },
  );

  const viperFang = inst(
    ELEMENT_CARDS.find((c) => c.id === ELEMENT_ABILITY_CATALOG.viperFang)!,
    "t",
  );
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { power: 2, leftCardId: viperFang.id },
    true,
  );
  assert(
    combat.cpuHP === 98 && combat.poisonOnCpu === 1,
    "viper fang solo chip + poison",
    { hp: combat.cpuHP, poison: combat.poisonOnCpu },
  );

  const hemlock = inst(
    ELEMENT_CARDS.find((c) => c.id === ELEMENT_ABILITY_CATALOG.hemlockNeedle)!,
    "t",
  );
  const venin = inst(ELEMENT_CARDS.find((c) => c.id === "el-46")!, "t2");
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    {
      element: "poison",
      power: 4,
      leftCardId: hemlock.id,
      rightCardId: venin.id,
      combineCount: 2,
    },
    true,
  );
  assert(
    combat.cpuHP === 96 && combat.poisonOnCpu === 1,
    "hemlock needle activated chip + 1 poison",
    { hp: combat.cpuHP, poison: combat.poisonOnCpu },
  );

  const snowHare = inst(
    ELEMENT_CARDS.find((c) => c.id === ELEMENT_ABILITY_CATALOG.snowHare)!,
    "t",
  );
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    { power: 2, leftCardId: snowHare.id },
    true,
  );
  assert(
    combat.cpuHP === 98 && combat.freezeOnCpu === 1,
    "snow hare solo chip + chill",
    { hp: combat.cpuHP, freeze: combat.freezeOnCpu },
  );

  const faraday = inst(
    ELEMENT_CARDS.find((c) => c.id === ELEMENT_ABILITY_CATALOG.faradayCage)!,
    "t",
  );
  const aegisPartner = inst(ELEMENT_CARDS.find((c) => c.id === "el-09")!, "t2");
  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    {
      element: "volt",
      power: 4,
      leftCardId: faraday.id,
      rightCardId: aegisPartner.id,
      combineCount: 2,
    },
    true,
  );
  assert(
    combat.cpuHP === 96 &&
      combat.voltBarrierOnPlayer === 4,
    "faraday cage barrier + activate chip",
    { hp: combat.cpuHP, barrier: combat.voltBarrierOnPlayer },
  );

  combat = freshElementCombatState();
  combat.voltBarrierOnCpu = 2;
  combat = applyElementCombatHit(
    combat,
    { power: 3, leftCardId: viperFang.id },
    true,
  );
  assert(
    combat.cpuHP === 98 &&
      combat.voltBarrierOnCpu === 1 &&
      combat.playerHP === 100 - VOLT_BARRIER_RETALIATE &&
      VOLT_BARRIER_RETALIATE === 3,
    "volt barrier retaliates on card hit",
    {
      hp: combat.cpuHP,
      barrier: combat.voltBarrierOnCpu,
      playerHp: combat.playerHP,
    },
  );

  combat = freshElementCombatState();
  combat.voltBarrierOnCpu = 2;
  combat.poisonOnCpu = 5;
  const beforeDot = { ...combat };
  combat = tickCombatDotStacks(combat);
  assert(
    combat.voltBarrierOnCpu === beforeDot.voltBarrierOnCpu &&
      combat.playerHP === beforeDot.playerHP,
    "DoT tick does not trigger barrier retaliate",
    {
      barrier: combat.voltBarrierOnCpu,
      playerHp: combat.playerHP,
    },
  );

  combat = grantVoltBarrier(freshElementCombatState(), true, 2);
  assert(combat.voltBarrierOnPlayer === 2, "grant volt barrier", {
    barrier: combat.voltBarrierOnPlayer,
  });
}

{
  const {
    brawlAttackCooldownMs,
    brawlGroupReattackMs,
    brawlGroupFirstFireMs,
    brawlGroupSlotCooldownMs,
    brawlSideRotationPeriodMs,
    brawlCooldownDisplayMs,
    FREEZE_COOLDOWN_PAUSE_MS,
  } = await import("./brawlElements");
  assert(brawlAttackCooldownMs(1) === 5000, "solo side interval 5s");
  assert(brawlAttackCooldownMs(2) === 4000, "2-chain side interval 4s");
  assert(brawlAttackCooldownMs(3) === 3000, "3-chain side interval 3s");
  assert(
    brawlGroupSlotCooldownMs(2) === 4000,
    "pair attack group uses 4s slot",
  );
  const trio = [{ length: 3 }];
  assert(
    brawlGroupReattackMs(trio) === 3000,
    "fully connected trio re-attacks every 3s slot",
  );
  const tripleSolo = [{ length: 1 }, { length: 1 }, { length: 1 }];
  assert(
    brawlGroupReattackMs(tripleSolo) === 15000,
    "three solo slots rotate at 5s each",
  );
  assert(
    brawlSideRotationPeriodMs([
      { length: 1 },
      { length: 2 },
      { length: 1 },
    ]) === 14000,
    "mixed groups sum their slot durations",
  );
  assert(
    brawlGroupFirstFireMs(0, tripleSolo, 1000) === 6000,
    "first solo slot waits intro lead + 5s",
  );
  assert(
    brawlGroupFirstFireMs(2, tripleSolo, 1000) === 16000,
    "third solo slot waits intro + three 5s slots",
  );
  assert(
    FREEZE_COOLDOWN_PAUSE_MS === 1200,
    "each freeze hit pauses one random snapped group for 1.5s",
  );
  assert(
    brawlCooldownDisplayMs(5000) === 5000,
    "UI overlay uses one side slot not full rotation",
  );
  assert(
    brawlCooldownDisplayMs(5000) !==
      brawlSideRotationPeriodMs([
        { length: 1 },
        { length: 1 },
        { length: 1 },
      ]),
    "display must not multiply by attack group count",
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
