/**
 * Smoke checks for the Phase A pattern helpers in cardEffects.ts.
 *
 * Helpers exercised:
 *   - chainShapeReading
 *   - isPalindromeShapes
 *   - hasABA
 *   - alternates
 *   - countAlternations
 *   - containsSequence
 *   - runOfShape
 *   - indexInHand
 *
 * These are pure functions over CardDefinition arrays, so the tests build
 * tiny synthetic chains and assert structural reads. We use stub cards with
 * minimal shape data; any other field (baseValue, abilityType, etc.) is
 * irrelevant to the helpers themselves.
 *
 * Run with:   npx tsx src/lib/__patterns_check.ts
 */

import { CardDefinition } from "./cards";
import { ShapeType } from "../components/cardShapes";
import {
  alternates,
  chainShapeReading,
  containsSequence,
  countAlternations,
  hasABA,
  indexInHand,
  isPalindromeShapes,
  runOfShape,
} from "./cardEffects";

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

function eq<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let counter = 0;
function stub(left: ShapeType, right: ShapeType): CardDefinition {
  counter++;
  return {
    id: `stub-${counter}`,
    name: "Stub",
    type: "Batting",
    abilityType: "General Draw",
    baseValue: 1,
    leftShape: left,
    rightShape: right,
    description: "stub",
  };
}

// ---------------------------------------------------------------------------
// chainShapeReading -- adjacent-duplicate dedup over [left, right] of each card.
// ---------------------------------------------------------------------------
{
  // Empty chain -> empty reading.
  assert(eq(chainShapeReading([]), []), "empty chain -> empty reading");

  // Single card with two distinct sides -> both shapes.
  assert(
    eq(chainShapeReading([stub("square", "diamond")]), ["square", "diamond"]),
    "solo distinct sides reads both",
  );

  // Single card with same shape both sides -> dedup to one entry.
  assert(
    eq(chainShapeReading([stub("circle", "circle")]), ["circle"]),
    "solo c/c reads single c",
  );

  // 2-card chain with matching seam -> seam collapses.
  // [s/d, d/s] -> [s, d, d, s] -> dedup [s, d, s].
  assert(
    eq(
      chainShapeReading([stub("square", "diamond"), stub("diamond", "square")]),
      ["square", "diamond", "square"],
    ),
    "2-card matching seam dedups",
  );

  // 3-card chain.
  // [star/sq, sq/d, d/c] -> [star, sq, sq, d, d, c] -> [star, sq, d, c].
  assert(
    eq(
      chainShapeReading([
        stub("star", "square"),
        stub("square", "diamond"),
        stub("diamond", "circle"),
      ]),
      ["star", "square", "diamond", "circle"],
    ),
    "3-card S-D-C run reads as 4-shape sequence",
  );
}

// ---------------------------------------------------------------------------
// isPalindromeShapes
// ---------------------------------------------------------------------------
{
  assert(isPalindromeShapes([stub("circle", "circle")]), "c/c solo is palindrome");
  assert(
    isPalindromeShapes([
      stub("square", "diamond"),
      stub("diamond", "square"),
    ]),
    "[s/d, d/s] is palindrome",
  );
  assert(
    isPalindromeShapes([
      stub("square", "circle"),
      stub("circle", "circle"),
      stub("circle", "square"),
    ]),
    "[s/c, c/c, c/s] palindrome",
  );
  assert(
    !isPalindromeShapes([
      stub("square", "diamond"),
      stub("diamond", "circle"),
    ]),
    "[s/d, d/c] is not palindrome",
  );
  assert(!isPalindromeShapes([]), "empty chain is not palindrome");
}

// ---------------------------------------------------------------------------
// hasABA
// ---------------------------------------------------------------------------
{
  // Chain that reads [diamond, square, diamond] in dedup -> diamond sandwiches square.
  // Build [diamond/square, square/diamond]. Dedup = [d, s, d]. hasABA d s = true.
  const chain = [stub("diamond", "square"), stub("square", "diamond")];
  assert(hasABA(chain, "diamond", "square"), "diamond sandwiches square");
  assert(!hasABA(chain, "square", "diamond"), "square does NOT sandwich diamond here");
  assert(!hasABA(chain, "circle", "square"), "circle is absent");

  // No ABA pattern present.
  const flat = [stub("square", "diamond"), stub("diamond", "circle")];
  assert(!hasABA(flat, "square", "diamond"), "non-sandwich chain rejects hasABA");
}

// ---------------------------------------------------------------------------
// alternates
// ---------------------------------------------------------------------------
{
  // Pure square-diamond alternation across 3 cards.
  // [s/d, d/s, s/d] -> dedup [s, d, s, d].
  const sdsd = [
    stub("square", "diamond"),
    stub("diamond", "square"),
    stub("square", "diamond"),
  ];
  assert(alternates(sdsd, "square", "diamond"), "[s,d,s,d] alternates s/d");
  assert(alternates(sdsd, "diamond", "square"), "alternates is symmetric in args");
  assert(!alternates(sdsd, "square", "circle"), "rejects when shape absent");

  // Has a third shape -> not strict alternation.
  const withThird = [stub("square", "diamond"), stub("diamond", "circle")];
  assert(!alternates(withThird, "square", "diamond"), "third shape breaks alternation");

  // Same shape twice -> rejected.
  assert(!alternates([stub("square", "square")], "square", "square"), "a===b rejects");

  // Single-shape sequence -> not alternating.
  assert(
    !alternates([stub("square", "square")], "square", "diamond"),
    "single dedup shape is not alternation",
  );
}

// ---------------------------------------------------------------------------
// countAlternations
// ---------------------------------------------------------------------------
{
  const sdsd = [
    stub("square", "diamond"),
    stub("diamond", "square"),
    stub("square", "diamond"),
  ];
  assert(
    countAlternations(sdsd, "square", "diamond") === 3,
    "3 flips in [s,d,s,d]",
    { got: countAlternations(sdsd, "square", "diamond") },
  );
  // Pairs not involving both target shapes don't count.
  const mixed = [
    stub("square", "diamond"),
    stub("diamond", "circle"),
    stub("circle", "square"),
  ];
  // Dedup = [s, d, c, s]. Pairs: (s,d) counts, (d,c) doesn't, (c,s) doesn't.
  assert(
    countAlternations(mixed, "square", "diamond") === 1,
    "only 1 flip when mixed shapes",
    { got: countAlternations(mixed, "square", "diamond") },
  );
  // a===b returns 0.
  assert(countAlternations(sdsd, "square", "square") === 0, "a===b -> 0 alternations");
  // Empty group -> 0.
  assert(countAlternations([], "square", "diamond") === 0, "empty group -> 0 alternations");
}

// ---------------------------------------------------------------------------
// containsSequence
// ---------------------------------------------------------------------------
{
  const sdc = [
    stub("star", "square"),
    stub("square", "diamond"),
    stub("diamond", "circle"),
  ];
  // Dedup = [star, sq, d, c]. Contains [sq, d, c].
  assert(
    containsSequence(sdc, ["square", "diamond", "circle"]),
    "[star,sq,d,c] contains [sq,d,c]",
  );
  // Out-of-order pattern not present.
  assert(
    !containsSequence(sdc, ["diamond", "square", "circle"]),
    "[d,sq,c] is NOT contiguous in [star,sq,d,c]",
  );
  // Empty pattern is vacuously present.
  assert(containsSequence(sdc, []), "empty pattern always present");
  // Pattern longer than chain rejected.
  assert(
    !containsSequence([stub("circle", "circle")], ["a" as ShapeType, "b" as ShapeType, "c" as ShapeType]),
    "pattern longer than dedup chain rejected",
  );
}

// ---------------------------------------------------------------------------
// runOfShape
// ---------------------------------------------------------------------------
{
  // Three consecutive cards each touching square.
  const threeSq = [
    stub("square", "diamond"),
    stub("circle", "square"),
    stub("square", "square"),
  ];
  assert(runOfShape(threeSq, "square", 3), "3 consecutive square-touching cards");
  assert(runOfShape(threeSq, "square", 1), "trivially holds at n=1");
  assert(!runOfShape(threeSq, "star", 1), "no star-touching card");

  // Run is reset by a non-touching card.
  const broken = [
    stub("square", "diamond"),
    stub("circle", "circle"),
    stub("square", "square"),
  ];
  assert(!runOfShape(broken, "square", 2), "non-touching card breaks the run");
  assert(runOfShape(broken, "square", 1), "still has at least 1 square-touching card");

  // n <= 0 trivially true.
  assert(runOfShape([], "square", 0), "n=0 always true");
}

// ---------------------------------------------------------------------------
// indexInHand
// ---------------------------------------------------------------------------
{
  const a = stub("square", "square");
  const b = stub("circle", "circle");
  const c = stub("star", "diamond");
  assert(indexInHand(a, [a, b, c]) === 0, "indexInHand finds slot 0");
  assert(indexInHand(b, [a, b, c]) === 1, "indexInHand finds slot 1");
  assert(indexInHand(c, [a, b, c]) === 2, "indexInHand finds slot 2");
  // Missing -> -1.
  const ghost = stub("none", "none");
  assert(indexInHand(ghost, [a, b, c]) === -1, "indexInHand returns -1 when missing");
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures}/${checks} pattern helper checks FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll ${checks} pattern helper checks passed.`);
}
