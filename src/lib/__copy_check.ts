/**
 * Copy-style enforcement for every card description in ALL_CARDS.
 *
 * Run with:   npx tsx src/lib/__copy_check.ts
 *
 * The rules below codify the canonical wording standardized in Phase 3:
 *
 *   C1 — Value notation:    "+N Value" (per-card) | "+N to the Hit Scale"
 *                           | "Subtract N from the [Side]'s score"
 *                           Never "to your total / score / final / base card value".
 *   C2 — Combination:       "If combined" (drop "successfully", drop "with another card").
 *   C3 — Shape naming:      Full word in CAPS — CIRCLE / DIAMOND / SQUARE / STAR.
 *                           No abbreviations (S/D/C). No trailing "shapes" filler.
 *   C4 — Side references:   "Batter" / "Pitcher" capitalized. Never "Opponent".
 *   C5 — Timing:            "this round" everywhere. Never "this turn".
 *   C6 — Punctuation:       Description ends with a period. No double spaces.
 *                           No leading or trailing whitespace.
 *   C7 — Hit Scale:         "Hit Scale" alone or "Hit Scale requirements +N".
 *                           Never "Hit Scale score".
 *   C8 — General-card:      "General card(s)" — capitalized "General", lowercase
 *                           "card", no "draw" word. Reveal verb is "Reveal"
 *                           (not "Look at").
 *
 * Note: an earlier iteration added a C9 rule that BANNED the words
 * "shape"/"shapes" in card text and required "pitch type"/"pitches"
 * instead, mapping each geometric shape to a baseball pitch label. That
 * was reverted -- the user's BATTER cards also have shapes, so calling
 * their own circle "Off-Speed" was nonsense (the batter isn't pitching).
 * Card text is back to talking about shapes.
 *
 * Each rule is a regex applied to every description. A match means the rule
 * fires (i.e. the wording is forbidden). Pass `allowFor` to exempt specific
 * cards whose flavor text intentionally bends a rule.
 */

import { ALL_CARDS, CardDefinition } from "./cards";

interface CopyRule {
  /** Audit-doc category, surfaced in the failure message. */
  id: "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8";
  /** Short rule label used in the failure message. */
  name: string;
  /** Regex applied to each card description. A match = a violation. */
  pattern: RegExp;
  /** Human-readable explanation of what to do instead. */
  reason: string;
  /** Card IDs explicitly exempted (flavor text, intentional exception). */
  allowFor?: ReadonlySet<string>;
}

const RULES: CopyRule[] = [
  // ============ C1 ============
  {
    id: "C1",
    name: "no '+N to your total/score/final/base card value'",
    pattern: /[+-]?\d+\s+to\s+(?:your\s+)?(?:total|score|final|base\s+card\s+value)\b/i,
    reason: "Use '+N Value' per-card, or '+N to the Hit Scale' for the ladder.",
  },
  {
    id: "C1",
    name: "no 'add +N to ...'",
    pattern: /\badd\s+[+-]?\d+\s+to\b/i,
    reason: "Drop the verb 'add'. Use '+N Value' or '+N to the Hit Scale'.",
  },

  // ============ C2 ============
  {
    id: "C2",
    name: "no 'successfully combined'",
    pattern: /\bsuccessfully\s+combined?\b/i,
    reason: "'combined' is sufficient -- drop 'successfully'.",
  },
  {
    id: "C2",
    name: "no 'combined with another card'",
    pattern: /\bcombined?\s+with\s+another\s+card\b/i,
    reason: "'If combined' already implies 'with another card'.",
  },

  // ============ C3 ============
  {
    id: "C3",
    name: "no '[Letter] or [Letter]' shape lists",
    pattern: /\b[CDS]\s+or\s+[CDS]\b/,
    reason: "Spell out shape names (CIRCLE, DIAMOND, SQUARE, STAR) in lists.",
  },
  {
    id: "C3",
    name: "no '[Letter] shapes' suffix",
    pattern: /\b[CDS]\s+shapes?\b/,
    reason: "Spell out shape names; drop the trailing 'shapes' filler.",
  },
  {
    id: "C3",
    name: "no 'with [Letter]'",
    pattern: /\bwith\s+[CDS]\b(?!\w)/,
    reason: "Spell out the shape name (e.g. 'with CIRCLE').",
  },
  // ============ C4 ============
  {
    id: "C4",
    name: "no 'Opponent' in card text",
    // Match 'Opponent' as a standalone word (case-insensitive). Lowercase
    // 'opponent' shouldn't appear either, but the case-insensitive match
    // covers both.
    pattern: /\bopponent('?s)?\b/i,
    reason: "Name the side explicitly: 'Batter' or 'Pitcher'.",
  },

  // ============ C5 ============
  {
    id: "C5",
    name: "no 'this turn' (use 'this round')",
    pattern: /\bthis\s+turn\b/i,
    reason: "Use 'this round' for round-duration effects.",
  },

  // ============ C6 ============
  {
    id: "C6",
    name: "must end with '.'",
    pattern: /[^.!?]$/,
    reason: "Terminate the description with a period.",
  },
  {
    id: "C6",
    name: "no double space",
    pattern: /  /,
    reason: "Collapse whitespace runs to a single space.",
  },
  {
    id: "C6",
    name: "no leading/trailing whitespace",
    pattern: /(^\s)|(\s$)/,
    reason: "Trim leading/trailing whitespace.",
  },

  // ============ C7 ============
  {
    id: "C7",
    name: "no 'Hit Scale score'",
    pattern: /\bHit\s+Scale\s+score\b/i,
    reason: "Just 'Hit Scale' (or 'Hit Scale requirements' for thresholds).",
  },
  {
    id: "C7",
    name: "no 'Hit Scale requirements increase by'",
    pattern: /\bHit\s+Scale\s+requirements?\s+increase(s)?\s+by\b/i,
    reason: "Use the additive form: 'Hit Scale requirements +N'.",
  },

  // ============ C8 ============
  {
    id: "C8",
    name: "no lowercase 'general card'",
    // Match 'general' (lowercase) followed by ' card' or ' draw card'. Will
    // NOT match 'General card' (capitalized G), which is the canonical form.
    pattern: /\bgeneral\s+(draw\s+)?cards?\b/,
    reason: "Capitalize 'General' (e.g. 'General card', 'Pitching General card').",
  },
  {
    id: "C8",
    name: "no 'general draw card'",
    pattern: /\b[Gg]eneral\s+draw\s+cards?\b/,
    reason: "Drop 'draw' -- 'General card' is the canonical form.",
  },
  {
    id: "C8",
    name: "no 'General Card' (title case 'Card')",
    pattern: /\bGeneral\s+Cards?\b/,
    reason: "Use lowercase 'card' after 'General' (e.g. 'Pitching General card').",
  },
  {
    id: "C8",
    name: "no 'Look at' for reveals",
    pattern: /\bLook\s+at\b/i,
    reason: "Use 'Reveal' for information-reveal effects.",
  },
];

interface Failure {
  card: CardDefinition;
  rule: CopyRule;
  match: string;
}

const failures: Failure[] = [];
let checks = 0;

for (const card of ALL_CARDS) {
  for (const rule of RULES) {
    checks++;
    if (rule.allowFor?.has(card.id)) continue;
    const m = card.description.match(rule.pattern);
    if (m) {
      failures.push({ card, rule, match: m[0] });
    }
  }
}

if (failures.length > 0) {
  console.error("Copy-style check FAILED:\n");
  for (const f of failures) {
    console.error(`  [${f.rule.id}] ${f.card.id} (${f.card.name}): ${f.rule.name}`);
    console.error(`        match:  "${f.match}"`);
    console.error(`        text:   "${f.card.description}"`);
    console.error(`        reason: ${f.rule.reason}\n`);
  }
  console.error(`\n${failures.length} violations across ${checks} checks (${ALL_CARDS.length} cards x ${RULES.length} rules).`);
  process.exit(1);
} else {
  console.log(`All ${checks} copy checks passed across ${ALL_CARDS.length} cards.`);
}
