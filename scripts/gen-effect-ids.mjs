import fs from "fs";
const t = fs.readFileSync("src/lib/cardEffects.ts", "utf8");
const ids = [...t.matchAll(/^\s+"([^"]+)":/gm)].map((m) => m[1]);
fs.writeFileSync(
  "src/lib/cardEffectIds.ts",
  `/** Auto-synced CARD_EFFECTS registry keys for card-kind inference. */\nexport const CARD_EFFECT_IDS: ReadonlySet<string> = new Set(${JSON.stringify(ids, null, 2)});\n`,
);
