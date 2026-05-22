/**
 * SZN Item Tier System
 * ====================
 *
 * Bag items in SZN runs carry a `tier` (`bronze` | `silver` | `gold`)
 * that scales BOTH their printed `baseValue` and the numeric outputs
 * of their `cardEffects` / `sznItemEffects` hooks. The tier system is
 * the Bazaar-style "items get better the more you commit to them"
 * lever: buying a duplicate of a card you already own UPGRADES the
 * owned copy one rung (bronze -> silver -> gold) rather than failing
 * the buy as a duplicate.
 *
 * Linear vs. binary effects
 * -------------------------
 * Numeric / "value" effects (a card that adds +15 to its own score,
 * or contributes +1 to a side counter) scale by {@link TIER_MULTIPLIER}.
 * Binary / "did the thing happen?" effects (Sticky Stuff's 15% suspend
 * roll, Platinum Glove's shield bank) instead use
 * {@link TIER_BINARY_PROC_BONUS} / {@link TIER_BINARY_STACK_BONUS}
 * to lift the trigger chance and/or stack count. Per-effect call sites
 * pick whichever scaling makes sense for the description so a "snap
 * anywhere" item doesn't accidentally become a 2x super-snap.
 *
 * Pricing
 * -------
 * `items.priceFor` reads {@link TIER_PRICE_MULTIPLIER} when minting
 * merchant listings for higher-tier items (event grants always land at
 * bronze; tiers go up via in-bag upgrades, never via fresh acquires).
 * The sell-back curve is a strict half of the buy price; see
 * {@link sellValueFor} in `items.ts`.
 */

export type ItemTier = "bronze" | "silver" | "gold";

/**
 * Canonical tier rung order. Index acts as a stable progression key
 * (0 = bronze ... 2 = gold) -- callers use {@link nextTier} instead of
 * indexing this directly so the relationship stays expressible.
 */
export const TIER_ORDER: readonly ItemTier[] = ["bronze", "silver", "gold"];

/**
 * Numeric multiplier applied to value-style effects (baseValue, +X
 * score, +N delta, etc.). Bronze == 1.0 (no-op) so existing data and
 * pricing stay unchanged for the dominant case.
 */
export const TIER_MULTIPLIER: Record<ItemTier, number> = {
  bronze: 1.0,
  silver: 1.5,
  gold: 2.0,
};

/**
 * Buy-price multiplier for upgrade purchases at a merchant. Silver
 * costs 1.5x the bronze listing price; gold costs 2.0x. Same shape as
 * {@link TIER_MULTIPLIER} so the upgrade cost mirrors the strength
 * gain (no "free silvers" arbitrage).
 */
export const TIER_PRICE_MULTIPLIER: Record<ItemTier, number> = {
  bronze: 1.0,
  silver: 1.5,
  gold: 2.0,
};

/**
 * Additive proc-chance bonus applied to BINARY effects (one-shot
 * coin-flips like Sticky Stuff's destroy roll). Bronze inherits the
 * card's printed chance (+0). Silver adds 5 percentage points. Gold
 * adds 10. The number is in 0-1 units to match `Math.random()`-style
 * comparisons callers do (`if (rng() >= chance)`).
 */
export const TIER_BINARY_PROC_BONUS: Record<ItemTier, number> = {
  bronze: 0.0,
  silver: 0.05,
  gold: 0.1,
};

/**
 * Additive stack bonus for binary "did one thing happen N times" effects
 * (Platinum Glove banking shields per pitching snap). Bronze = 1 stack
 * per fire (no change). Silver = +1 extra stack. Gold = +2 extra stacks.
 * Callers add this to the baseline stack count produced by their hook.
 */
export const TIER_BINARY_STACK_BONUS: Record<ItemTier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
};

/**
 * Display label for the tier — used in merchant CTAs ("UPGRADE → SILVER"),
 * the ItemBagReplacePicker sell-value subtitle, and the footer chip.
 */
export const TIER_LABEL: Record<ItemTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

/**
 * One-character glyph for the tiny "B / S / G" chip painted on each
 * bag item card in {@link SznFooterDecks}. Kept ASCII so the chip
 * renders identically across every font + platform.
 */
export const TIER_GLYPH: Record<ItemTier, string> = {
  bronze: "B",
  silver: "S",
  gold: "G",
};

/**
 * Tint per tier — used by the footer chip + merchant CTA so the user
 * reads bronze→silver→gold without parsing the letter. Tones loosely
 * match real metal: brown-orange for bronze, slate-silver, and warm
 * gold for the top tier.
 */
export const TIER_TINT: Record<ItemTier, string> = {
  bronze: "#b08968",
  silver: "#cbd5e1",
  gold: "#fbbf24",
};

/**
 * Return the next tier in the progression or `null` if `tier` is
 * already at the cap. Used by upgrade dispatch + the merchant CTA
 * (`UPGRADE → SILVER` vs `MAXED`).
 */
export function nextTier(tier: ItemTier): ItemTier | null {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx < 0) return null;
  const next = TIER_ORDER[idx + 1];
  return next ?? null;
}

/**
 * Tier-aware multiplier on a value-style number. Pure passthrough at
 * bronze; callers may use this directly for `baseValue` and effect
 * deltas. We `Math.round` so the displayed value stays whole.
 */
export function applyTierMultiplier(value: number, tier: ItemTier): number {
  if (tier === "bronze") return value;
  return Math.round(value * TIER_MULTIPLIER[tier]);
}

/**
 * Convenience: human-readable label like "Silver" or "Gold" for use
 * in upgrade CTAs and tooltips.
 */
export function tierLabel(tier: ItemTier): string {
  return TIER_LABEL[tier];
}

/**
 * Convenience: single-character glyph for the footer chip.
 */
export function tierGlyph(tier: ItemTier): string {
  return TIER_GLYPH[tier];
}
