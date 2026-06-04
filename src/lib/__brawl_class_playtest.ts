/**
 * All-class brawl balance gate — 10 sims per mage with freeze backlash + volt scaling.
 * Run: npm run test:playtest
 */
import { BRAWL_CLASSES, type BrawlClass } from "./elementClassPools";
import { classOptionFor } from "./elementClassPools";
import {
  PLAYTEST_GAMES_PER_CLASS,
  runClassPlaytest,
} from "./__brawl_playtest_core";
import { applyElementCombatHit, ELEMENT_ABILITY_CATALOG } from "./elementAbilities";
import { freshElementCombatState } from "./brawlElements";

function assert(cond: boolean, msg: string, detail?: unknown) {
  if (!cond) {
    console.error("FAIL ", msg, detail ?? "");
    process.exitCode = 1;
  }
}

// Volt scaling cards
{
  let combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    {
      element: "volt",
      power: 2,
      leftCardId: `${ELEMENT_ABILITY_CATALOG.gridSurge}~t`,
      rightCardId: `${ELEMENT_ABILITY_CATALOG.gridSurge}~t2`,
      defenderLayout: { maxChainLength: 3, connectedCardCount: 4, seamCount: 3 },
    },
    true,
  );
  assert(combat.cpuHP === 95, "grid surge +3 seams", combat.cpuHP);

  combat = freshElementCombatState();
  combat = applyElementCombatHit(
    combat,
    {
      element: "volt",
      power: 3,
      leftCardId: `${ELEMENT_ABILITY_CATALOG.chainLightning}~t`,
      rightCardId: `${ELEMENT_ABILITY_CATALOG.chainLightning}~t2`,
      defenderLayout: { maxChainLength: 4, connectedCardCount: 4, seamCount: 2 },
    },
    true,
  );
  assert(combat.cpuHP === 89, "chain lightning +8 (4 chain)", combat.cpuHP);
}

/** 10-game sample: no class should be auto-win or auto-loss. */

console.log(`=== BRAWL CLASS PLAYTEST (${PLAYTEST_GAMES_PER_CLASS} games × ${BRAWL_CLASSES.length} classes) ===\n`);

for (const cls of BRAWL_CLASSES) {
  const opt = classOptionFor(cls);
  const results = runClassPlaytest(cls);
  const wins = results.filter((r) => r.won).length;
  const rate = wins / results.length;
  const avgMs =
    results.reduce((s, r) => s + r.combatMs, 0) / results.length;
  const avgSeams =
    results.reduce((s, r) => s + r.userSeams, 0) / results.length;

  console.log(
    `${opt.mageName} (${cls}): ${wins}/${results.length} (${(rate * 100).toFixed(0)}%) | avg ${(avgMs / 1000).toFixed(1)}s | avg seams ${avgSeams.toFixed(1)}`,
  );

  assert(
    wins > 0 && wins < results.length,
    `${opt.mageName} must not go ${wins === 0 ? "0-10" : "10-0"} in ${results.length} sims`,
    { wins, games: results.length },
  );
}

console.log(
  process.exitCode ? "\nSome checks failed." : "\nAll class playtest gates passed.",
);
