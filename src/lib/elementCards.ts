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
    description:
      brawlTagline ?? `${baseValue} · ${leftShape} → ${rightShape}`,
    faceText: String(baseValue),
    ...(brawlTagline ? { brawlTagline } : {}),
    ...(combineConstraint ? { combineConstraint } : {}),
  };
}

/** Sixty-one cards with seam shapes for multi-activation hands. */
export const ELEMENT_CARDS: CardDefinition[] = [
  el("el-01", "Ember", 1, "circle", "square", "Snapped: value becomes 2."),
  el("el-02", "Flare", 2, "square", "circle", "If activated: +1 burn if foe is burning."),
  el("el-03", "Toxin", 3, "triangle", "diamond", "If activated: ignores 2 shield."),
  el("el-04", "Vial", 1, "diamond", "triangle", "If activated: stacks poison on foe."),
  el("el-05", "Blaze", 4, "square", "square", "If activated: 2x damage, no burn."),
  el("el-06", "Mend", 2, "hexagon", "circle", "If activated: heal and cleanse 2."),
  el("el-07", "Salve", 1, "circle", "hexagon", "If activated: restore HP from snap."),
  el("el-08", "Bloom", 3, "hexagon", "triangle", "If activated: restore HP from snap."),
  el("el-09", "Aegis", 2, "diamond", "diamond", "If activated: +2 shield."),
  el("el-10", "Bane", 4, "triangle", "triangle", "Solo finisher: deals 6."),
  el("el-11", "Glacia", 2, "circle", "circle", "If activated: apply chill twice."),
  el("el-12", "Kindle", 1, "square", "triangle", "If activated: burn only, no chip."),
  el("el-13", "Syphon", 3, "triangle", "hexagon", "If activated: heal half damage dealt."),
  el("el-14", "Bastion", 2, "diamond", "hexagon", "If activated: +shield and heal 1."),
  el("el-15", "Purge", 1, "hexagon", "diamond", "If activated: heal and remove 2 chill."),
  el("el-16", "Flint", 1, "square", "diamond", "Snapped left end: value becomes 3."),
  el("el-17", "Nightshade", 4, "triangle", "circle", "If activated: +1 per poison on foe."),
  el("el-18", "Hoarfrost", 3, "circle", "hexagon", "If activated: chip and chill stacks."),
  el("el-19", "Sparks", 2, "square", "hexagon", "If activated: steady chip damage."),
  el("el-20", "Dreg", 1, "diamond", "circle", "Solo: deals printed damage."),
  el("el-21", "Jolt", 2, "star", "square", "If activated: instant chip damage."),
  el("el-22", "Surge", 3, "star", "star", "If activated: deals 2x chip."),
  el("el-23", "Static", 1, "circle", "star", "If activated: thaw 1 chill after hit."),
  el("el-24", "Arc", 2, "star", "diamond", "If activated: ignores 2 shield."),
  el("el-25", "Grind", 3, "triangle", "star", "If activated: +1 per burn or poison."),
  el("el-26", "Fuse", 4, "square", "star", "If activated: +2 chip after fire hit."),
  el("el-27", "Tailwind", 2, "hexagon", "star", "Snapped right end: value becomes 2."),
  el("el-28", "Snipe", 4, "star", "triangle", "Solo: deals 6 shock."),
  el("el-29", "Relay", 2, "star", "hexagon", "If activated: steady shock damage."),
  el("el-30", "Prong", 1, "diamond", "star", "If activated: instant chip damage."),
  // Fire class expansion
  el("el-31", "Cinder", 1, "square", "square", "Snapped: value becomes 2."),
  el("el-32", "Brand", 2, "square", "circle", "If activated: ignores 1 shield."),
  el("el-33", "Wildfire", 2, "square", "hexagon", "If activated: +1 burn."),
  el("el-34", "Scorch", 3, "square", "square", "If activated: +1 if foe is burning."),
  el("el-35", "Inferno", 4, "square", "diamond", "Solo: deals 5 fire."),
  // Freeze class expansion
  el("el-36", "Rime", 1, "circle", "circle", "Snapped: value becomes 2."),
  el("el-37", "Bitter", 2, "circle", "circle", "If activated: +shield and 1 chill."),
  el("el-38", "Frostbite", 2, "circle", "hexagon", "If activated: heal you 1."),
  el("el-39", "Hail", 3, "circle", "circle", "If activated: +1 per 4 chill on foe."),
  el("el-40", "Avalanche", 4, "circle", "star", "Solo: deals 5 freeze."),
  // Volt class expansion
  el("el-41", "Spark", 1, "star", "star", "Snapped: value becomes 2."),
  el("el-42", "Conduit", 2, "star", "hexagon", "If activated: heal you 1."),
  el("el-43", "Cascade", 2, "star", "square", "If activated: +2 if foe was chipped."),
  el("el-44", "Overload", 3, "star", "star", "If activated: deals 2x damage."),
  el("el-45", "Breaker", 4, "star", "diamond", "Solo: deals 5 shock."),
  el(
    "el-62",
    "Grid Surge",
    2,
    "star",
    "square",
    "If activated: +1 shock per foe seam snapped.",
  ),
  el(
    "el-63",
    "Chain Lightning",
    3,
    "star",
    "star",
    "If activated: +2 shock per card in foe's longest chain.",
  ),
  // Poison class expansion
  el("el-46", "Venin", 1, "triangle", "triangle", "Snapped: value becomes 2."),
  el("el-47", "Rot", 2, "triangle", "diamond", "If activated: ignores 1 shield."),
  el("el-48", "Toxicity", 2, "triangle", "circle", "If activated: +1 if foe burning or poisoned."),
  el("el-49", "Plague", 3, "triangle", "hexagon", "If activated: heal you 1."),
  el("el-50", "Miasma", 4, "triangle", "triangle", "Solo: deals 5 poison."),
  // Ignis bridge cards
  el(
    "el-51",
    "Tinderbox",
    1,
    "square",
    "square",
    "Right seam: connects to any shape.",
    { rightWildcard: true, rightColorWildcard: true },
  ),
  el("el-52", "Matchstick", 1, "square", "square", "Solo: deals 2, stacks 1 burn."),
  el(
    "el-57",
    "Kindling",
    1,
    "square",
    "square",
    "Left seam: connects to any shape.",
    { leftWildcard: true, leftColorWildcard: true },
  ),
  el("el-58", "Oil Flask", 1, "square", "square", "Your fire hits: +1 burn."),
  // Ren (freeze) bridge + solo cards
  el(
    "el-53",
    "Snowglobe",
    1,
    "circle",
    "circle",
    "Right seam: connects to any shape.",
    { rightWildcard: true, rightColorWildcard: true },
  ),
  el("el-54", "Icicle", 1, "circle", "circle", "Solo: deals 2, applies 1 chill."),
  el("el-55", "Chilltouch", 2, "circle", "circle", "If activated: +1 chill if foe is chilled."),
  el("el-56", "Black Ice", 2, "circle", "circle", "If activated: ignores 1 shield."),
  el("el-59", "Shiver", 1, "circle", "hexagon", "Solo: deals 2, applies 2 chill."),
  el("el-60", "Permafrost", 2, "circle", "hexagon", "If activated: +1 chip vs chilled foes."),
  el(
    "el-61",
    "Rime Shard",
    1,
    "circle",
    "circle",
    "Left seam: connects to any shape.",
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
