import type { CardDefinition } from "./cards";
import { ELEMENT_CARDS, ELEMENT_CARD_IDS } from "./elementCards";

/** Strip the runtime instance suffix from a dealt element card id. */
export function elementCatalogId(id: string): string {
  const sep = id.indexOf("~");
  return sep === -1 ? id : id.slice(0, sep);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deal `count` element cards from the shared pool (no signatures).
 */
export function dealBrawlElementHand(
  count = 5,
  poolIds: readonly string[] = ELEMENT_CARD_IDS,
  seed = Math.floor(Math.random() * 0x7fffffff),
): CardDefinition[] {
  const pool = poolIds
    .map((id) => ELEMENT_CARDS.find((c) => c.id === id))
    .filter((c): c is CardDefinition => !!c);
  if (pool.length === 0) throw new Error("dealBrawlElementHand: empty pool");
  const rng = mulberry32(seed);
  const hand: CardDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * pool.length);
    const template = pool[idx];
    // Each dealt copy needs a unique id so React keys, Reorder.Item values,
    // affirmed seam keys, and entry-animation tracking stay 1:1 with slots.
    hand.push({ ...template, id: `${template.id}~${seed}-${i}` });
  }
  return hand;
}

/**
 * Draw one replacement card during setup, avoiding catalog ids already in hand.
 */
export function dealBrawlReplacementCard(
  poolIds: readonly string[],
  seed: number,
  excludeCatalogIds: readonly string[],
): CardDefinition {
  const exclude = new Set(excludeCatalogIds);
  const pool = poolIds
    .map((id) => ELEMENT_CARDS.find((c) => c.id === id))
    .filter((c): c is CardDefinition => !!c && !exclude.has(c.id));
  if (pool.length === 0) {
    throw new Error("dealBrawlReplacementCard: no cards left in pool");
  }
  const rng = mulberry32(seed);
  const idx = Math.floor(rng() * pool.length);
  const template = pool[idx]!;
  return { ...template, id: `${template.id}~r${seed}` };
}
