import fs from "fs";

const path = "src/lib/__effects_check.ts";
let s = fs.readFileSync(path, "utf8");

// cardById("id").baseValue + N  ->  expectedCardMod("id", N)
s = s.replace(
  /cardById\("([^"]+)"\)\.baseValue \+ (\d+)/g,
  'expectedCardMod("$1", $2)',
);

// cardById("id").baseValue (solo / no bonus) in assert comparisons - careful
// Only replace when NOT already inside expectedCardMod
s = s.replace(
  /=== cardById\("([^"]+)"\)\.baseValue\b/g,
  '=== expectedCardMod("$1", 0)',
);
s = s.replace(
  /== cardById\("([^"]+)"\)\.baseValue\b/g,
  '== expectedCardMod("$1", 0)',
);

// Phase A: general draws are value-only — effect bonuses become 0
const phaseAIds = [
  "sandwich", "threePitch", "tripleThreat", "fiveTool", "stacker",
  "leadoff", "cleanup", "anchor", "mirror", "alt",
];
for (const v of phaseAIds) {
  s = s.replace(
    new RegExp(`expectedCardMod\\("${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^)]*\\)`, "g"),
    (m) => m, // noop placeholder
  );
}

// Fix Phase A variable-based asserts (sandwich.baseValue + 6 etc.)
s = s.replace(/(\w+)\.baseValue \+ (\d+)/g, (match, varName, n) => {
  const phaseAVars = new Set([
    "sandwich", "threePitch", "tripleThreat", "fiveTool", "stacker",
    "leadoff", "cleanup", "anchor", "mirror", "alt",
  ]);
  if (phaseAVars.has(varName)) return `${varName}.baseValue`;
  return match;
});

fs.writeFileSync(path, s);
console.log("patched", path);
