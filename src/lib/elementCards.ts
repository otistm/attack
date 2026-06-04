/**
 * Brawl element deck — 61 hand cards. Shapes map to elements at the seam.
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
  combineConstraint?: CardDefinition["combineConstraint"],
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
    ...(combineConstraint ? { combineConstraint } : {}),
  };
}

/** Thirty cards with varied values (1–4) and seam shapes for multi-bond hands. */
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
  el("el-21", "Jolt", 2, "star", "square", "volt hits instantly"),
  el("el-22", "Surge", 3, "star", "star", "double volt chip"),
  el("el-23", "Static", 1, "circle", "star", "shock thaws 1 freeze"),
  el("el-24", "Arc", 2, "star", "diamond", "volt pierces 2 shield"),
  el("el-25", "Grind", 3, "triangle", "star", "+1 per foe burn or poison"),
  el("el-26", "Fuse", 4, "square", "star", "fire adds 2 volt chip"),
  el("el-27", "Tailwind", 2, "hexagon", "star", "chain tail worth 2"),
  el("el-28", "Snipe", 4, "star", "triangle", "solo shock hits 6"),
  el("el-29", "Relay", 2, "star", "hexagon"),
  el("el-30", "Prong", 1, "diamond", "star"),
  // Fire class expansion
  el("el-31", "Cinder", 1, "square", "square", "worth 2 in a chain"),
  el("el-32", "Brand", 2, "square", "circle", "fire pierces 1 shield"),
  el("el-33", "Wildfire", 2, "square", "hexagon", "fire adds extra burn"),
  el("el-34", "Scorch", 3, "square", "square", "+1 if foe is burning"),
  el("el-35", "Inferno", 4, "square", "diamond", "solo fire hits 5"),
  // Freeze class expansion
  el("el-36", "Rime", 1, "circle", "circle", "worth 2 in a chain"),
  el("el-37", "Bitter", 2, "circle", "circle", "shield also chills"),
  el("el-38", "Frostbite", 2, "circle", "hexagon", "freeze heals you 1"),
  el("el-39", "Hail", 3, "circle", "circle", "+1 per 4 freeze on foe"),
  el("el-40", "Avalanche", 4, "circle", "star", "solo freeze hits 5"),
  // Volt class expansion
  el("el-41", "Spark", 1, "star", "star", "worth 2 in a chain"),
  el("el-42", "Conduit", 2, "star", "hexagon", "volt heals you 1"),
  el("el-43", "Cascade", 2, "star", "square", "+2 if foe was chipped"),
  el("el-44", "Overload", 3, "star", "star", "double volt, clean hit"),
  el("el-45", "Breaker", 4, "star", "diamond", "solo shock hits 5"),
  // Poison class expansion
  el("el-46", "Venin", 1, "triangle", "triangle", "worth 2 in a chain"),
  el("el-47", "Rot", 2, "triangle", "diamond", "poison shreds shield"),
  el("el-48", "Toxicity", 2, "triangle", "circle", "+1 if foe has DoT"),
  el("el-49", "Plague", 3, "triangle", "hexagon", "poison heals you 1"),
  el("el-50", "Miasma", 4, "triangle", "triangle", "solo poison hits 5"),
  // Ignis bridge cards
  el(
    "el-51",
    "Tinderbox",
    1,
    "square",
    "square",
    "right seam links anywhere",
    { rightWildcard: true, rightColorWildcard: true },
  ),
  el("el-52", "Matchstick", 1, "square", "square", "solo hit chips 2, burns 1"),
  el(
    "el-57",
    "Kindling",
    1,
    "square",
    "square",
    "left seam links anywhere",
    { leftWildcard: true, leftColorWildcard: true },
  ),
  el("el-58", "Oil Flask", 1, "square", "square", "+1 burn on all your fire hits"),
  // Ren (freeze) bridge + solo cards
  el(
    "el-53",
    "Snowglobe",
    1,
    "circle",
    "circle",
    "right seam links anywhere",
    { rightWildcard: true, rightColorWildcard: true },
  ),
  el("el-54", "Icicle", 1, "circle", "circle", "solo hit chips 2, chills 1"),
  el("el-55", "Chilltouch", 2, "circle", "circle", "+1 freeze if foe is chilled"),
  el("el-56", "Black Ice", 2, "circle", "circle", "freeze pierces 1 shield"),
  el("el-59", "Shiver", 1, "circle", "hexagon", "solo hit chips 2, chills 1"),
  el("el-60", "Permafrost", 2, "circle", "hexagon", "+1 chip vs chilled foes"),
  el(
    "el-61",
    "Rime Shard",
    1,
    "circle",
    "circle",
    "left seam links anywhere",
    { leftWildcard: true, leftColorWildcard: true },
  ),
];

export const ELEMENT_CARD_IDS: string[] = ELEMENT_CARDS.map((c) => c.id);

const byId = new Map(ELEMENT_CARDS.map((c) => [c.id, c]));

export function elementCardById(id: string): CardDefinition {
  const catalogId = id.includes("~") ? id.slice(0, id.indexOf("~")) : id;
  const c = byId.get(catalogId);
  if (!c) throw new Error(`Unknown element card: ${id}`);
  return c;
}
