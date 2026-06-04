/**
 * Card copy lint — player-facing descriptions must follow CARD_VOICE rules.
 */
import { ELEMENT_CARDS } from "./elementCards";
import {
  BRAWL_CLASS_POOLS,
  type BrawlClass,
} from "./elementClassPools";

const STAT_LINE = /^\d+\s*·\s*\S+\s*→\s*\S+$/;
const BANNED = [
  { pattern: /\bbond\b/i, label: "bond (use activated)" },
  { pattern: /\bDoT\b/, label: "DoT (spell out burning or poisoned)" },
  { pattern: /\bclean\s+hit\b/i, label: "clean hit" },
];

const inPoolIds = new Set<string>();
for (const cls of Object.keys(BRAWL_CLASS_POOLS) as BrawlClass[]) {
  for (const id of BRAWL_CLASS_POOLS[cls]) {
    inPoolIds.add(id);
  }
}

let failed = 0;

for (const card of ELEMENT_CARDS) {
  const desc = card.description?.trim() ?? "";
  for (const ban of BANNED) {
    if (ban.pattern.test(desc)) {
      console.error(`[${card.id}] ${card.name}: banned token "${ban.label}" in "${desc}"`);
      failed++;
    }
  }
  if (inPoolIds.has(card.id)) {
    if (!desc || STAT_LINE.test(desc)) {
      console.error(
        `[${card.id}] ${card.name}: in-pool card needs ability line, not stat fallback`,
      );
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`card copy checks failed: ${failed} issue(s)`);
  process.exit(1);
}

console.log("card copy checks passed");
