/**
 * Self-contained sanity check for the card connection engine.
 *
 * Run with:   npx tsx src/lib/__connect_check.ts
 *
 * Exits 0 on success, 1 on any failure. Designed to be import-free of any
 * React/Vite-only modules so it executes cleanly in plain Node via `tsx`.
 */

import { ALL_CARDS, CardDefinition, CombineConstraint } from "./cards";
import { canConnect, shapeModeForSide } from "./connect";
import { ShapeType } from "../components/cardShapes";

let failures = 0;
let checks = 0;

function assert(cond: boolean, label: string, detail?: unknown): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL  ${label}` + (detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""));
  }
}

// ---------------------------------------------------------------------------
// Tiny card factory so the canConnect tests don't depend on real card IDs.
// ---------------------------------------------------------------------------
let cardCounter = 0;
function makeCard(left: ShapeType, right: ShapeType, constraint?: CombineConstraint): CardDefinition {
  cardCounter += 1;
  return {
    id: `t-${cardCounter}`,
    name: `Test ${cardCounter}`,
    type: "Batting",
    abilityType: "Test",
    baseValue: 0,
    leftShape: left,
    rightShape: right,
    description: "",
    combineConstraint: constraint,
  };
}

// ---------------------------------------------------------------------------
// 1. Plain shape match.
// ---------------------------------------------------------------------------
{
  const allShapes: ShapeType[] = ["circle", "diamond", "square", "star"];
  for (const a of allShapes) {
    for (const b of allShapes) {
      const left = makeCard("circle", a);
      const right = makeCard(b, "circle");
      const expected = a === b;
      assert(canConnect(left, right) === expected, `shape match ${a} vs ${b}`, { expected });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 'none' shape on either side never connects.
// ---------------------------------------------------------------------------
{
  const flatLeft = makeCard("circle", "none");
  const normalRight = makeCard("circle", "circle");
  assert(canConnect(flatLeft, normalRight) === false, "left.right=none blocks");

  const normalLeft = makeCard("circle", "circle");
  const flatRight = makeCard("none", "circle");
  assert(canConnect(normalLeft, flatRight) === false, "right.left=none blocks");
}

// ---------------------------------------------------------------------------
// 3. noCombine on either side blocks unconditionally.
// ---------------------------------------------------------------------------
{
  const blockedLeft = makeCard("circle", "circle", { noCombine: true });
  const normalRight = makeCard("circle", "circle");
  assert(canConnect(blockedLeft, normalRight) === false, "left noCombine blocks");
  assert(canConnect(normalRight, blockedLeft) === false, "right noCombine blocks");
}

// ---------------------------------------------------------------------------
// 4. leftNoCombine / rightNoCombine block only the matching side.
// ---------------------------------------------------------------------------
{
  // rightNoCombine on the LEFT card means its right side cannot combine.
  const noRight = makeCard("circle", "circle", { rightNoCombine: true });
  const partner = makeCard("circle", "circle");
  assert(canConnect(noRight, partner) === false, "rightNoCombine on left card blocks");
  // But the same card placed on the RIGHT side (its left side) should still combine.
  assert(canConnect(partner, noRight) === true, "rightNoCombine does not affect left side");

  const noLeft = makeCard("circle", "circle", { leftNoCombine: true });
  assert(canConnect(partner, noLeft) === false, "leftNoCombine on right card blocks");
  assert(canConnect(noLeft, partner) === true, "leftNoCombine does not affect right side");
}

// ---------------------------------------------------------------------------
// 5. Wildcards: shape='wildcard' AND constraint flags both connect to anything
//    non-blocked, non-none.
// ---------------------------------------------------------------------------
{
  const wildShape = makeCard("circle", "wildcard");
  const partners: ShapeType[] = ["circle", "diamond", "square", "star"];
  for (const s of partners) {
    const partner = makeCard(s, "circle");
    assert(canConnect(wildShape, partner) === true, `wildcard shape connects to ${s}`);
  }

  // Wildcard via constraint flag (rightWildcard) on a literal star.
  const wildConstraint = makeCard("circle", "star", { rightWildcard: true });
  for (const s of partners) {
    const partner = makeCard(s, "circle");
    assert(canConnect(wildConstraint, partner) === true, `rightWildcard flag connects to ${s}`);
  }

  // leftWildcard on the right card.
  const leftWild = makeCard("star", "circle", { leftWildcard: true });
  for (const s of partners) {
    const partner = makeCard("circle", s);
    assert(canConnect(partner, leftWild) === true, `leftWildcard flag connects from ${s}`);
  }

  // Wildcards still respect 'none' on the opposite side.
  const flat = makeCard("none", "circle");
  assert(canConnect(wildShape, flat) === false, "wildcard does not connect through 'none'");

  // Wildcards still respect noCombine on the opposite side.
  const blocked = makeCard("circle", "circle", { noCombine: true });
  assert(canConnect(wildShape, blocked) === false, "wildcard does not bypass noCombine");
}

// ---------------------------------------------------------------------------
// 6. allowedShapes constrains the OPPOSITE side of each card.
// ---------------------------------------------------------------------------
{
  const picky = makeCard("circle", "square", { allowedShapes: ["square", "diamond"] });

  // From the picky card's right side: opposite (right card's left) must be
  // square or diamond.
  const okSquare = makeCard("square", "circle");
  const okDiamond = makeCard("diamond", "circle");
  const badCircle = makeCard("circle", "circle");
  const badStar = makeCard("star", "circle");
  assert(canConnect(picky, okSquare) === true, "picky right -> square allowed");
  assert(canConnect(picky, okDiamond) === false, "picky right -> diamond NOT a literal shape match (right needs to also match its own shape rule)");
  // Note: picky's right shape is 'square'. Even though allowedShapes accepts
  // diamond, the literal shape match still requires square===diamond, so the
  // call returns false. That matches the rules: allowedShapes whitelists
  // partners but does not loosen literal matching.
  assert(canConnect(picky, badCircle) === false, "picky right -> circle blocked");
  assert(canConnect(picky, badStar) === false, "picky right -> star blocked");

  // Wildcard partner is always allowed by the picky check (isShapeAllowed
  // returns true when isWild=true).
  const wild = makeCard("wildcard", "circle");
  assert(canConnect(picky, wild) === true, "picky right -> wildcard allowed");
}

// ---------------------------------------------------------------------------
// 7. shapeModeForSide returns the correct mode for each constraint.
// ---------------------------------------------------------------------------
{
  const noCombine = makeCard("circle", "square", { noCombine: true });
  assert(shapeModeForSide(noCombine, "left") === "blocked", "noCombine -> left blocked");
  assert(shapeModeForSide(noCombine, "right") === "blocked", "noCombine -> right blocked");

  const leftNo = makeCard("circle", "square", { leftNoCombine: true });
  assert(shapeModeForSide(leftNo, "left") === "blocked", "leftNoCombine -> left blocked");
  assert(shapeModeForSide(leftNo, "right") === "normal", "leftNoCombine -> right normal");

  const leftWild = makeCard("star", "circle", { leftWildcard: true });
  assert(shapeModeForSide(leftWild, "left") === "wildcard", "leftWildcard -> left wildcard");
  assert(shapeModeForSide(leftWild, "right") === "normal", "leftWildcard -> right normal");

  const wildShape = makeCard("wildcard", "wildcard");
  assert(shapeModeForSide(wildShape, "left") === "wildcard", "wildcard shape -> wildcard mode");

  const picky = makeCard("circle", "square", { allowedShapes: ["square"] });
  assert(shapeModeForSide(picky, "left") === "picky", "allowedShapes -> picky");

  const plain = makeCard("circle", "square");
  assert(shapeModeForSide(plain, "left") === "normal", "no constraint -> normal");
}

// ---------------------------------------------------------------------------
// 8. Real-card sanity spot checks (against the published deck definitions).
// ---------------------------------------------------------------------------
{
  const cardById = (id: string) => {
    const c = ALL_CARDS.find((c) => c.id === id);
    if (!c) throw new Error(`Card ${id} missing from ALL_CARDS`);
    return c;
  };

  // b-4 Unicorn Swing: noCombine.
  const unicorn = cardById("b-4");
  const anyCircle = makeCard("circle", "circle");
  assert(canConnect(unicorn, anyCircle) === false, "b-4 Unicorn Swing never combines (right)");
  assert(canConnect(anyCircle, unicorn) === false, "b-4 Unicorn Swing never combines (left)");

  // b-15 Mookie's Hustle: leftWildcard. Its left=star but should accept any
  // non-none, non-blocked shape on the left card's right side.
  const hustle = cardById("b-15");
  const circleRight = makeCard("circle", "diamond"); // right of left card = diamond
  assert(canConnect(circleRight, hustle) === true, "b-15 left side acts as wildcard for diamond");
  const squareRight = makeCard("circle", "square");
  assert(canConnect(squareRight, hustle) === true, "b-15 left side acts as wildcard for square");

  // b-28 Vlad's Vengeance: leftNoCombine.
  const vlad = cardById("b-28");
  assert(canConnect(anyCircle, vlad) === false, "b-28 Vlad cannot combine on left");
  // Its right side (circle) should still combine with another circle.
  const otherCircle = makeCard("circle", "circle");
  assert(canConnect(vlad, otherCircle) === true, "b-28 Vlad right side combines normally");

  // b-3 Barrel It Up: allowedShapes [square, diamond] on its square right.
  // Right side connects to square (literal match). Diamond doesn't match
  // 'square' literally, so it's blocked even though allowedShapes lists it.
  const barrel = cardById("b-3");
  const squareLeft = makeCard("circle", "square"); // dummy, square left
  // canConnect(barrel, squareLeft): barrel.right=square, squareLeft.left=circle
  const circleLeftCard = makeCard("circle", "circle");
  assert(canConnect(barrel, circleLeftCard) === false, "b-3 right cannot connect to circle (allowedShapes blocks)");

  // p-43 100 MPH Cutter: noCombine + none/none.
  const cutter = cardById("p-43");
  assert(canConnect(cutter, anyCircle) === false, "p-43 100 MPH Cutter never combines");

  // p-79 Intentional Walk: shape=none/none with no explicit noCombine in data.
  // Should still block via the 'none' check.
  const walk = cardById("p-79");
  assert(canConnect(walk, anyCircle) === false, "p-79 Intentional Walk blocks via none shapes");
  assert(canConnect(anyCircle, walk) === false, "p-79 Intentional Walk blocks via none shapes (left)");
}

// ---------------------------------------------------------------------------
// 9. Data audit: every card's description text and combineConstraint should
//    agree. We text-match on phrases used in the spec and assert the matching
//    constraint is set. A failure here means either the data or the wording
//    is wrong and they need to be reconciled.
// ---------------------------------------------------------------------------
{
  const auditPhrases: Array<{
    test: (desc: string) => boolean;
    requires: (c: CombineConstraint | undefined) => boolean;
    name: string;
  }> = [
    {
      name: "leftNoCombine ('cannot be combined on the left')",
      test: (d) => /cannot be combined on the left/i.test(d),
      requires: (c) => Boolean(c?.leftNoCombine || c?.noCombine),
    },
    {
      name: "rightNoCombine ('cannot be combined on the right')",
      test: (d) => /cannot be combined on the right/i.test(d),
      requires: (c) => Boolean(c?.rightNoCombine || c?.noCombine),
    },
    {
      name: "noCombine ('cannot be combined' without left/right qualifier)",
      test: (d) => /cannot be combined(?! on the (left|right))/i.test(d) || /flat edges\.\s*cannot be combined/i.test(d),
      requires: (c) => Boolean(c?.noCombine),
    },
    {
      name: "leftWildcard ('left shape acts as a wildcard')",
      test: (d) => /left shape acts as a wildcard/i.test(d),
      requires: (c) => Boolean(c?.leftWildcard),
    },
    {
      name: "rightWildcard ('right shape acts as a wildcard')",
      test: (d) => /right shape acts as a wildcard/i.test(d),
      requires: (c) => Boolean(c?.rightWildcard),
    },
    {
      name: "allowedShapes ('can only combine/be combined with X')",
      test: (d) => /can only (be )?combined? with [A-Z]/i.test(d),
      requires: (c) => Array.isArray(c?.allowedShapes) && (c?.allowedShapes?.length ?? 0) > 0,
    },
  ];

  for (const card of ALL_CARDS) {
    for (const phrase of auditPhrases) {
      if (phrase.test(card.description)) {
        assert(
          phrase.requires(card.combineConstraint),
          `${card.id} (${card.name}) description suggests ${phrase.name} but constraint missing`,
          { description: card.description, constraint: card.combineConstraint },
        );
      }
    }

    // Reverse: a noCombine card should usually say so in the description.
    // Exception: cards whose shapes are both 'none' (already structurally
    // unconnectable) like p-79 Intentional Walk; we don't require text.
    if (card.combineConstraint?.noCombine && card.leftShape !== "none" && card.rightShape !== "none") {
      assert(
        /cannot be combined|flat edges/i.test(card.description),
        `${card.id} (${card.name}) has noCombine but description doesn't mention it`,
        { description: card.description },
      );
    }
  }

  // Spot-check: p-79 Intentional Walk has none/none shapes and is structurally
  // unconnectable; verify it stays that way.
  const walk = ALL_CARDS.find((c) => c.id === "p-79");
  assert(
    walk?.leftShape === "none" && walk?.rightShape === "none",
    "p-79 Intentional Walk should have both shapes set to 'none'",
    walk,
  );
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures}/${checks} checks FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll ${checks} connection checks passed.`);
}
