/**
 * Short definitions for brawl terms on card ability lines.
 * Player copy uses "activated" (not "bond"): two snapped halves make a whole element.
 */
export type BrawlGlossaryEntry = {
  id: string;
  term: string;
  pattern: RegExp;
  explain: string;
};

const GLOSSARY: BrawlGlossaryEntry[] = [
  {
    id: "fire-activated",
    term: "Fire activated",
    pattern: /\bfire\s+activated\b/i,
    explain:
      "Snap square seams so fire is whole. The left card attacks with both values and stacks burn.",
  },
  {
    id: "freeze-activated",
    term: "Freeze activated",
    pattern: /\bfreeze\s+activated\b/i,
    explain:
      "Snap circle seams so freeze is whole. The left card chips HP and applies chill stacks.",
  },
  {
    id: "volt-activated",
    term: "Volt activated",
    pattern: /\bvolt\s+activated\b/i,
    explain:
      "Snap star seams so volt is whole. The left card deals instant shock damage (chip).",
  },
  {
    id: "poison-activated",
    term: "Poison activated",
    pattern: /\bpoison\s+activated\b/i,
    explain:
      "Snap triangle seams so poison is whole. The left card stacks poison that ticks foe HP.",
  },
  {
    id: "shield-activated",
    term: "Shield activated",
    pattern: /\bshield\s+activated\b/i,
    explain:
      "Snap diamond seams so shield is whole. The left card adds shield to you instead of hitting.",
  },
  {
    id: "heal-activated",
    term: "Heal activated",
    pattern: /\bheal\s+activated\b/i,
    explain:
      "Snap hexagon seams so heal is whole. The left card restores your HP.",
  },
  {
    id: "if-activated",
    term: "If activated",
    pattern: /\bif\s+activated\b/i,
    explain:
      "When this card is the left attacker on an affirmed element seam, its bonus applies.",
  },
  {
    id: "activated",
    term: "Activated",
    pattern: /\bactivated\b/i,
    explain:
      "Two snapped cards complete an element. The left card fires; the right adds its value but does not attack alone.",
  },
  {
    id: "snapped-left",
    term: "Snapped left end",
    pattern: /\bsnapped\s+left\s+end\b/i,
    explain: "Leftmost card in a snap — its printed value is replaced while connected.",
  },
  {
    id: "snapped-right",
    term: "Snapped right end",
    pattern: /\bsnapped\s+right\s+end\b/i,
    explain: "Rightmost card in a snap — its printed value is replaced while connected.",
  },
  {
    id: "snapped",
    term: "Snapped",
    pattern: /\bsnapped\b/i,
    explain:
      "Connected to a neighbor on a matching seam. Snaps share cooldown and may change this card's value.",
  },
  {
    id: "solo-finisher",
    term: "Solo finisher",
    pattern: /\bsolo\s+finisher\b/i,
    explain: "Attacks alone (not snapped) for a large one-shot bonus damage.",
  },
  {
    id: "solo",
    term: "Solo",
    pattern: /\bsolo\b/i,
    explain: "This card attacks alone — not snapped to a partner — on a longer cooldown.",
  },
  {
    id: "chip",
    term: "Chip",
    pattern: /\b(?:chips?|chipped|chipping)\b/i,
    explain: "Instant HP damage on impact (after shield). Not burn or poison over time.",
  },
  {
    id: "left-seam",
    term: "Left seam",
    pattern: /\bleft\s+seam\b/i,
    explain: "This card's left edge — a wildcard seam can snap to any neighbor shape.",
  },
  {
    id: "right-seam",
    term: "Right seam",
    pattern: /\bright\s+seam\b/i,
    explain: "This card's right edge — a wildcard seam can snap to any neighbor shape.",
  },
  {
    id: "seam",
    term: "Seam",
    pattern: /\bseam\b/i,
    explain: "Edge between two cards. Matching shapes snap; that may activate an element.",
  },
  {
    id: "burn",
    term: "Burn",
    pattern: /\bburn(s|ing|t)?\b/i,
    explain: "Damage-over-time on the foe. Ticks HP after fire hits stack burn.",
  },
  {
    id: "poison",
    term: "Poison",
    pattern: /\bpoison(ed|s)?\b/i,
    explain: "Damage-over-time stack on the foe (like burn). Some cards scale with poison present.",
  },
  {
    id: "chill",
    term: "Chill",
    pattern: /\bchill(s|ed)?\b/i,
    explain:
      "Freeze stacks on the foe. Chill pauses one random snapped segment — every card in that chain.",
  },
  {
    id: "shock",
    term: "Shock",
    pattern: /\bshock(s|ed)?\b/i,
    explain: "Volt damage — usually instant chip. Can thaw chill on you or the foe.",
  },
  {
    id: "volt-barrier",
    term: "Volt barrier",
    pattern: /\bvolt\s+barrier\b/i,
    explain:
      "Protective stacks on you. When a card hit chips your HP or shield, lose 1 stack and zap the attacker for 2.",
  },
  {
    id: "volt",
    term: "Volt",
    pattern: /\bvolt\b/i,
    explain: "Star element: instant chip damage. Often ignores shield.",
  },
  {
    id: "ignores-shield",
    term: "Ignores shield",
    pattern: /\bignores?\s+\d*\s*shield\b/i,
    explain: "Removes shield points before the rest of the effect applies.",
  },
  {
    id: "shield",
    term: "Shield",
    pattern: /\bshield\b/i,
    explain: "Absorbs incoming damage before HP. Shown on your HP pill.",
  },
  {
    id: "heal",
    term: "Heal",
    pattern: /\bheal(s|ing)?\b/i,
    explain: "Restores your HP (up to max). Mend also cleanses burn or poison on you.",
  },
  {
    id: "cleanse",
    term: "Cleanse",
    pattern: /\bcleanse(s|d)?\b/i,
    explain: "Removes burn or poison stacks from you.",
  },
  {
    id: "finisher",
    term: "Finisher",
    pattern: /\bfinisher\b/i,
    explain: "Strong solo attack bonus when this card is not snapped to a partner.",
  },
  {
    id: "weave",
    term: "Weave",
    pattern: /\bweave\b/i,
    explain: "Your locked-in hand — which cards are snapped together.",
  },
];

const MATCH_ORDER: string[] = [
  "fire-activated",
  "freeze-activated",
  "volt-activated",
  "poison-activated",
  "shield-activated",
  "heal-activated",
  "if-activated",
  "snapped-left",
  "snapped-right",
  "solo-finisher",
  "left-seam",
  "right-seam",
  "ignores-shield",
  "solo",
  "snapped",
  "activated",
  "chip",
  "seam",
  "burn",
  "poison",
  "chill",
  "shock",
  "volt",
  "shield",
  "heal",
  "cleanse",
  "finisher",
  "weave",
];

const BY_ID = new Map(GLOSSARY.map((e) => [e.id, e]));
const ORDERED = MATCH_ORDER.map((id) => BY_ID.get(id)).filter(
  (e): e is BrawlGlossaryEntry => e != null,
);

export function glossaryForAbilityText(
  abilityText: string,
): ReadonlyArray<Pick<BrawlGlossaryEntry, "id" | "term" | "explain">> {
  if (!abilityText.trim()) return [];
  const seen = new Set<string>();
  const out: Pick<BrawlGlossaryEntry, "id" | "term" | "explain">[] = [];
  for (const entry of ORDERED) {
    if (seen.has(entry.id)) continue;
    if (entry.pattern.test(abilityText)) {
      seen.add(entry.id);
      out.push({ id: entry.id, term: entry.term, explain: entry.explain });
    }
  }
  return out;
}
