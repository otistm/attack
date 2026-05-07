/**
 * Smoke checks for the per-session shape randomization in cards.ts.
 *
 * Pins the contract:
 *   - `randomizeCardShapes` is deterministic for a fixed seed.
 *   - Different seeds produce visibly different shape layouts.
 *   - `none` and `wildcard` shape literals are PRESERVED -- only literal
 *     square / diamond / circle / star sides get re-rolled.
 *   - Every other CardDefinition field is preserved (id, name, baseValue,
 *     description, color, abilityType, type, tags, combineConstraint,
 *     handedness, etc.).
 *   - `SESSION_CARDS` matches `randomizeCardShapes(ALL_CARDS, SESSION_SEED)`
 *     -- i.e. the module-load-time export uses the documented seed.
 *   - `sessionCardById(id)` resolves to the same object as the array.
 *   - The randomized array has the same length as the canonical one.
 *
 * Run with:   npx tsx src/lib/__session_check.ts
 */

import {
  ALL_CARDS,
  CardDefinition,
  randomizeCardShapes,
  SESSION_CARDS,
  SESSION_SEED,
  sessionCardById,
} from "./cards";
import { canConnect } from "./connect";

let failures = 0;
let checks = 0;

function assert(cond: boolean, label: string, detail?: unknown): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(
      `FAIL  ${label}` + (detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""),
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Determinism: same seed -> same shapes.
// ---------------------------------------------------------------------------
{
  const a = randomizeCardShapes(ALL_CARDS, 12345);
  const b = randomizeCardShapes(ALL_CARDS, 12345);
  assert(a.length === b.length, "deterministic: equal lengths", { a: a.length, b: b.length });
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].leftShape !== b[i].leftShape) mismatch++;
    if (a[i].rightShape !== b[i].rightShape) mismatch++;
  }
  assert(mismatch === 0, "deterministic: same seed -> same shape layout", { mismatch });
}

// ---------------------------------------------------------------------------
// 2. Diversity: different seeds usually produce different layouts.
// ---------------------------------------------------------------------------
{
  const a = randomizeCardShapes(ALL_CARDS, 1);
  const b = randomizeCardShapes(ALL_CARDS, 2);
  let differs = false;
  for (let i = 0; i < a.length && !differs; i++) {
    if (a[i].leftShape !== b[i].leftShape || a[i].rightShape !== b[i].rightShape) {
      differs = true;
    }
  }
  assert(differs, "diverse: seed 1 vs seed 2 produces a different layout");
}

// ---------------------------------------------------------------------------
// 3. Preservation of "none" and "wildcard" literals.
// ---------------------------------------------------------------------------
{
  // p-79 Intentional Walk has both shapes set to "none" -- structural marker.
  const walk = ALL_CARDS.find((c) => c.id === "p-79")!;
  assert(walk.leftShape === "none" && walk.rightShape === "none", "p-79 baseline none/none");

  // Re-roll across many seeds; "none" must NEVER mutate.
  for (let seed = 0; seed < 30; seed++) {
    const remixed = randomizeCardShapes(ALL_CARDS, seed);
    const w = remixed.find((c) => c.id === "p-79")!;
    assert(w.leftShape === "none", `p-79 left preserved as 'none' at seed=${seed}`, {
      got: w.leftShape,
    });
    assert(w.rightShape === "none", `p-79 right preserved as 'none' at seed=${seed}`, {
      got: w.rightShape,
    });
  }

  // b-10 Electric Speed has both sides set to "wildcard" -- a literal
  // design statement that the card is a free combiner. The "none" preservation
  // rule applies symmetrically here.
  const electric = ALL_CARDS.find((c) => c.id === "b-10")!;
  if (electric.leftShape === "wildcard" && electric.rightShape === "wildcard") {
    for (let seed = 0; seed < 30; seed++) {
      const remixed = randomizeCardShapes(ALL_CARDS, seed);
      const e = remixed.find((c) => c.id === "b-10")!;
      assert(e.leftShape === "wildcard", `b-10 left preserved as 'wildcard' at seed=${seed}`, {
        got: e.leftShape,
      });
      assert(e.rightShape === "wildcard", `b-10 right preserved as 'wildcard' at seed=${seed}`, {
        got: e.rightShape,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Random pool restricts to the four real shapes.
// ---------------------------------------------------------------------------
{
  const remixed = randomizeCardShapes(ALL_CARDS, 42);
  for (const c of remixed) {
    const baseline = ALL_CARDS.find((x) => x.id === c.id)!;
    if (baseline.leftShape !== "none" && baseline.leftShape !== "wildcard") {
      assert(
        c.leftShape === "square" ||
          c.leftShape === "diamond" ||
          c.leftShape === "circle" ||
          c.leftShape === "star",
        `${c.id} left re-rolled into the basic shape pool`,
        { left: c.leftShape },
      );
    }
    if (baseline.rightShape !== "none" && baseline.rightShape !== "wildcard") {
      assert(
        c.rightShape === "square" ||
          c.rightShape === "diamond" ||
          c.rightShape === "circle" ||
          c.rightShape === "star",
        `${c.id} right re-rolled into the basic shape pool`,
        { right: c.rightShape },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Every non-shape field is identical to the canonical card.
// ---------------------------------------------------------------------------
{
  const remixed = randomizeCardShapes(ALL_CARDS, 99);
  assert(remixed.length === ALL_CARDS.length, "remix preserves array length");
  for (let i = 0; i < remixed.length; i++) {
    const a = remixed[i];
    const b = ALL_CARDS[i];
    assert(a.id === b.id, `idx ${i}: id preserved`);
    assert(a.name === b.name, `${a.id}: name preserved`);
    assert(a.baseValue === b.baseValue, `${a.id}: baseValue preserved`);
    assert(a.description === b.description, `${a.id}: description preserved`);
    assert(a.abilityType === b.abilityType, `${a.id}: abilityType preserved`);
    assert(a.type === b.type, `${a.id}: type preserved`);
    assert(a.color === b.color, `${a.id}: color preserved`);
    assert(a.player === b.player, `${a.id}: player preserved`);
    assert(a.handedness === b.handedness, `${a.id}: handedness preserved`);
    // Constraint object is shared by reference (treated as immutable).
    assert(a.combineConstraint === b.combineConstraint, `${a.id}: constraint preserved`);
    // Tags array is shared by reference too.
    assert(a.tags === b.tags, `${a.id}: tags preserved`);
  }
}

// ---------------------------------------------------------------------------
// 6. Re-roll does not mutate the source array.
// ---------------------------------------------------------------------------
{
  const before = ALL_CARDS.map((c) => `${c.id}:${c.leftShape}:${c.rightShape}`).join("|");
  randomizeCardShapes(ALL_CARDS, 7);
  randomizeCardShapes(ALL_CARDS, 8);
  const after = ALL_CARDS.map((c) => `${c.id}:${c.leftShape}:${c.rightShape}`).join("|");
  assert(before === after, "remix never mutates the canonical ALL_CARDS source");
}

// ---------------------------------------------------------------------------
// 7. SESSION_CARDS matches randomizeCardShapes(ALL_CARDS, SESSION_SEED).
// ---------------------------------------------------------------------------
{
  const expected = randomizeCardShapes(ALL_CARDS, SESSION_SEED);
  assert(
    SESSION_CARDS.length === expected.length,
    "SESSION_CARDS has the same length as the seed-derived layout",
  );
  let mismatch = 0;
  for (let i = 0; i < SESSION_CARDS.length; i++) {
    if (
      SESSION_CARDS[i].leftShape !== expected[i].leftShape ||
      SESSION_CARDS[i].rightShape !== expected[i].rightShape
    ) {
      mismatch++;
    }
  }
  assert(
    mismatch === 0,
    "SESSION_CARDS shapes match randomizeCardShapes(ALL_CARDS, SESSION_SEED)",
    { mismatch, seed: SESSION_SEED },
  );
}

// ---------------------------------------------------------------------------
// 8. sessionCardById resolves to the SAME object as the array.
// ---------------------------------------------------------------------------
{
  const sample: string[] = ["b-1", "b-30", "b-81", "b-100", "p-31", "p-79", "p-95", "p-96"];
  for (const id of sample) {
    const fromArray = SESSION_CARDS.find((c) => c.id === id);
    const fromLookup: CardDefinition | undefined = sessionCardById(id);
    assert(fromArray === fromLookup, `sessionCardById('${id}') is the same object as the array entry`);
  }
  assert(sessionCardById("does-not-exist") === undefined, "sessionCardById returns undefined for unknown ids");
}

// ---------------------------------------------------------------------------
// 9. Session-card hands stay puzzle-game playable: across many seeds, the
//    randomized layout always leaves AT LEAST one mechanically-connectable
//    seam somewhere among the general-card pool. (Sanity check that the
//    re-roll doesn't accidentally produce un-playable decks.)
// ---------------------------------------------------------------------------
{
  let solvableSeeds = 0;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (const seed of seeds) {
    const remix = randomizeCardShapes(ALL_CARDS, seed);
    let foundChain = false;
    for (let i = 0; i < remix.length && !foundChain; i++) {
      for (let j = 0; j < remix.length; j++) {
        if (i === j) continue;
        if (canConnect(remix[i], remix[j])) {
          foundChain = true;
          break;
        }
      }
    }
    if (foundChain) solvableSeeds++;
  }
  assert(
    solvableSeeds === seeds.length,
    "every test seed produces at least one connectable card pair",
    { solvableSeeds, total: seeds.length },
  );
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures}/${checks} session randomization checks FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll ${checks} session randomization checks passed.`);
}
