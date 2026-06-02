/**
 * Brawl element deck — 20 value-only cards. Shapes map to elements at the seam.
 */
import type { CardDefinition } from "./cards";
import { shapeToDefaultColor } from "./cardModel";

function el(
  id: string,
  name: string,
  baseValue: number,
  leftShape: CardDefinition["leftShape"],
  rightShape: CardDefinition["rightShape"],
  brawlTagline?: string,
): CardDefinition {
  return {
    id,
    name,
    type: "Player",
    abilityType: "General Draw",
    kind: "value",
    baseValue,
    leftShape,
    rightShape,
    leftColor: shapeToDefaultColor(leftShape),
    rightColor: shapeToDefaultColor(rightShape),
    description: `${baseValue} · ${leftShape} → ${rightShape}`,
    faceText: String(baseValue),
    ...(brawlTagline ? { brawlTagline } : {}),
  };
}

/** Twenty cards with varied values (1–4) and seam shapes for multi-bond hands. */
export const ELEMENT_CARDS: CardDefinition[] = [
  el("el-01", "Ember", 1, "circle", "square", "worth 2 in a chain"),
  el("el-02", "Flare", 2, "square", "circle"),
  el("el-03", "Toxin", 3, "triangle", "diamond", "poison pierces shield"),
  el("el-04", "Vial", 1, "diamond", "triangle"),
  el("el-05", "Blaze", 4, "square", "square", "double fire, no burn"),
  el("el-06", "Mend", 2, "hexagon", "circle", "heal and cleanse"),
  el("el-07", "Salve", 1, "circle", "hexagon"),
  el("el-08", "Bloom", 3, "hexagon", "triangle"),
  el("el-09", "Aegis", 2, "diamond", "diamond", "extra shield"),
  el("el-10", "Bane", 4, "triangle", "triangle", "solo hit deals 6"),
  el("el-11", "Glacia", 2, "circle", "circle", "double freeze slow"),
  el("el-12", "Kindle", 1, "square", "triangle", "burn only, no chip"),
  el("el-13", "Syphon", 3, "triangle", "hexagon", "poison heals you half"),
  el("el-14", "Bastion", 2, "diamond", "hexagon", "shield also heals 1"),
  el("el-15", "Purge", 1, "hexagon", "diamond", "heal melts 2 freeze"),
  el("el-16", "Flint", 1, "square", "diamond", "lead chain is worth 3"),
  el("el-17", "Nightshade", 4, "triangle", "circle", "+1 per poison on foe"),
  el("el-18", "Hoarfrost", 3, "circle", "hexagon", "freeze chips HP too"),
  el("el-19", "Sparks", 2, "square", "hexagon"),
  el("el-20", "Dreg", 1, "diamond", "circle"),
];

export const ELEMENT_CARD_IDS: string[] = ELEMENT_CARDS.map((c) => c.id);

const byId = new Map(ELEMENT_CARDS.map((c) => [c.id, c]));

export function elementCardById(id: string): CardDefinition {
  const catalogId = id.includes("~") ? id.slice(0, id.indexOf("~")) : id;
  const c = byId.get(catalogId);
  if (!c) throw new Error(`Unknown element card: ${id}`);
  return c;
}
