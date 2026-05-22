/**
 * MerchantView — Bazaar-style merchant stall. The user browses the
 * four listings (rendered with the SAME footer-rail chip visual the
 * user will see once the card is in their bag), buys whatever fits
 * their budget, and leaves.
 *
 * Pick-spend is fired by the PARENT `FrontOfficeScreen.closeEncounter`
 * unconditionally on close -- opening the encounter is the commitment.
 * That means walking away without buying still spends the slot, which
 * is the intended run-loop tension. This view just signals "I'm done"
 * via `onClose` and does NOT call `commitEncounter` directly.
 *
 * Visual language: amber/gold accents for merchants, persona glyph in
 * the header, and item listings using the same `FooterStyleAbilityCard`
 * the persistent footer rail renders. No intermediate "focused card
 * detail" panel -- the chip IS the preview, and committing a buy
 * animates the card straight into the bag rail via `startPurchaseFlight`.
 *
 * Roster-upgrade listings show the same card chip but with a
 * "DUP" / "REPL" badge in the top-right; their click bumps a
 * roster slot's rarity instead of adding to the bag, so they skip the
 * fly-to-footer animation (there's no new chip to animate to).
 */

import { useEffect, useRef, useState } from "react";
import { DollarSign, RefreshCw, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import {
  MERCHANT_LABEL,
  MERCHANT_REROLLS_PER_VISIT,
  type MerchantOffer,
  type MerchantListing,
  type MerchantId,
} from "../lib/run";
import { SESSION_CARDS } from "../lib/cards";
import { priceForTier, rerollCost } from "../lib/items";
import { nextTier, tierLabel, type ItemTier } from "../lib/itemTiers";
import { FooterStyleAbilityCard } from "./FooterStyleAbilityCard";
import { SZN_EDGES, type SznEdgeId } from "../lib/sznEdges";
import { useSznGamepad, useFocusIndex } from "../lib/useSznGamepad";

const MERCHANT_GLYPH: Record<MerchantId, string> = {
  scouting_director: "🔭",
  shady_trainer: "💉",
  equipment_manager: "⚾",
  concessions: "🌭",
};

// Per-persona visual tints for the merchant container.
const MERCHANT_VIBE: Record<
  MerchantId,
  { gradient: string; ring: string }
> = {
  scouting_director: {
    gradient: "from-emerald-700 via-emerald-900 to-slate-950",
    ring: "ring-emerald-500/60",
  },
  shady_trainer: {
    gradient: "from-rose-800 via-rose-950 to-slate-950",
    ring: "ring-rose-500/60",
  },
  equipment_manager: {
    gradient: "from-amber-700 via-amber-950 to-slate-950",
    ring: "ring-amber-500/60",
  },
  concessions: {
    gradient: "from-orange-700 via-rose-900 to-slate-950",
    ring: "ring-orange-500/60",
  },
};

export function MerchantView({
  slotIndex,
  offer,
  onClose,
}: {
  slotIndex: number;
  offer: MerchantOffer;
  onClose: () => void;
}) {
  const run = useGameStore((s) => s.run);
  const purchase = useGameStore((s) => s.purchaseFromMerchant);
  const rerollMerchant = useGameStore((s) => s.rerollMerchant);
  const startPurchaseFlight = useGameStore((s) => s.startPurchaseFlight);
  // Gamepad focus surface (see PlayerMarketView for the matching
  // pattern). The handler below is registered at priority 100 -- when
  // focus has been dropped into the persistent SZN footer rail, every
  // press here becomes pass-through so the priority-50 footer router
  // owns DPAD nav / CROSS / collapse without us silently stealing it.
  const focusSurface = useGameStore((s) => s.sznGamepadFocus);
  const cash = run?.cash ?? 0;
  const week = run?.week ?? 1;
  const vibe = MERCHANT_VIBE[offer.merchantId];
  // Bazaar reroll economy: each merchant visit gets at most
  // MERCHANT_REROLLS_PER_VISIT (2) rerolls. The cost rises with the
  // week (cheap early to encourage experimenting, pricier late so
  // it's a real budget call). Visit counter is stored on the offer
  // itself so it survives re-renders without a local-state race.
  const rerollsUsed = offer.rerollsUsed ?? 0;
  const rerollsLeft = MERCHANT_REROLLS_PER_VISIT - rerollsUsed;
  const rerollPrice = rerollCost(week);
  const canReroll = rerollsLeft > 0 && cash >= rerollPrice;
  // Themed merchant encounters (Hobby Shop, Clearance Bin) override
  // the base persona's label / glyph so the header matches the
  // encounter tile the user just clicked.
  const headerLabel = offer.displayLabel ?? MERCHANT_LABEL[offer.merchantId];
  const headerGlyph = offer.displayGlyph ?? MERCHANT_GLYPH[offer.merchantId];

  // Track which listings have already been purchased so the UI can
  // disable / mark them and prevent accidental double-purchase clicks
  // (each click would mint another bag entry OR no-op silently for
  // upgrades, neither of which the user wants).
  const [boughtListingIds, setBoughtListingIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Per-listing tile refs so we can capture the source bounding rect
  // for the fly-to-footer flight at the exact moment of purchase
  // (after the buy commits but before the user notices a "new card
  // just appeared in the rail" pop).
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Read the footer abilities-row rect from the DOM so we know where
   * to land the flight ghost. `SznFooterDecks` tags the wrapper with
   * `id="szn-footer-row-right"` for exactly this lookup. Returns null
   * if the footer isn't mounted -- the buy still completes silently,
   * just without the animation.
   */
  const getFooterTargetRect = () => {
    const el = document.getElementById("szn-footer-row-right");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  const handleBuy = (listingIndex: number) => {
    const listing = offer.listings[listingIndex];
    if (!listing) return;
    // Capture the source rect BEFORE the purchase fires -- post-buy
    // the listing's "BOUGHT" treatment may shift the tile's transform
    // and we want the ghost to lift off from where the user clicked.
    const tile = tileRefs.current[listingIndex];
    const sourceRect = tile?.getBoundingClientRect() ?? null;
    // Only flip the per-listing "bought" flag when the store action
    // actually applied the purchase. A failed purchase (cash mismatch,
    // tier mismatch on a roster upgrade, etc.) is a true no-op so the
    // user can keep browsing without the listing locking out.
    const ok = purchase(slotIndex, listingIndex);
    if (!ok) return;
    setBoughtListingIds((prev) => {
      const next = new Set(prev);
      next.add(listing.listingId);
      return next;
    });
    // Only item listings produce a new chip in the bag rail -- roster
    // upgrades and intel-resolve items (Faded Scouting Report) don't
    // mint a chip so there's nothing to fly to. Skip the animation
    // for those so we don't paint a ghost that lands on an empty
    // patch of the footer.
    const mintsBagChip =
      !listing.rosterUpgrade && listing.cardId !== "enc-faded-scouting-report";
    if (!mintsBagChip) return;
    if (!sourceRect) return;
    const targetRect = getFooterTargetRect();
    if (!targetRect) return;
    startPurchaseFlight({
      flightId: listing.listingId,
      cardId: listing.cardId,
      source: {
        x: sourceRect.x,
        y: sourceRect.y,
        width: sourceRect.width,
        height: sourceRect.height,
      },
      target: targetRect,
    });
  };

  // Controller navigation. Focus is modeled as two rows so DPAD_DOWN
  // can jump from the listings row down to the action row (Reroll +
  // Leave) instead of cycling through the listings to the right
  // until it eventually lands on Leave (and never on Reroll).
  //
  //   Slot indices:
  //     0 .. N-1 -> listing cards (row 0)
  //     N        -> Reroll        (row 1, col 0)
  //     N+1      -> Leave         (row 1, col 1)
  //
  //   DPAD_LEFT  / DPAD_RIGHT cycle within the current row.
  //   DPAD_DOWN  jumps cards -> Reroll (first action slot).
  //   DPAD_UP    jumps actions -> last-focused card (defaults to 0).
  const rerollIdx = offer.listings.length;
  const leaveIdx = offer.listings.length + 1;
  const [focusIdx, setFocusIdx] = useFocusIndex(offer.listings.length + 2);
  const inActionsRow = focusIdx >= rerollIdx;
  const rerollFocused = focusIdx === rerollIdx;
  const leaveFocused = focusIdx === leaveIdx;
  // Remember the last card the user was on so DPAD_UP from the
  // action row lands back where they were instead of always
  // snapping to slot 0.
  const lastCardIdxRef = useRef(0);
  useEffect(() => {
    if (focusIdx < rerollIdx) lastCardIdxRef.current = focusIdx;
  }, [focusIdx, rerollIdx]);

  // Compute the focused listing's edges so the global encounter-focus
  // state can drive the footer's compat-lift hint. Doesn't power any
  // visible panel in this view -- the chip itself IS the preview.
  const focusedEdges: {
    leftEdge: SznEdgeId | null;
    rightEdge: SznEdgeId | null;
  } | null = (() => {
    if (leaveFocused) return null;
    const listing = offer.listings[focusIdx];
    if (!listing) return null;
    const card = SESSION_CARDS.find((c) => c.id === listing.cardId);
    if (!card) return null;
    const left =
      card.sznLeftEdge && card.sznLeftEdge in SZN_EDGES
        ? (card.sznLeftEdge as SznEdgeId)
        : null;
    const right =
      card.sznRightEdge && card.sznRightEdge in SZN_EDGES
        ? (card.sznRightEdge as SznEdgeId)
        : null;
    if (!left && !right) return null;
    return { leftEdge: left, rightEdge: right };
  })();

  // Push focused edges to global state so the persistent footer can
  // lift any chip that snaps to the focused merchant card. Clears on
  // unmount so the hint doesn't leak into the next surface.
  const setEncounterFocusEdges = useGameStore(
    (s) => s.setEncounterFocusEdges,
  );
  useEffect(() => {
    setEncounterFocusEdges(focusedEdges);
    return () => setEncounterFocusEdges(null);
  }, [
    focusedEdges?.leftEdge,
    focusedEdges?.rightEdge,
    setEncounterFocusEdges,
  ]);

  useSznGamepad({
    id: "merchant-view",
    priority: 100,
    enabled: true,
    handler: (btn) => {
      // Footer ownership escape: when the user has handed input over
      // to the persistent SZN footer rail (`'footer'` surface), pass
      // every press through so the footer router (priority 50) gets
      // it untouched. Without this gate the listing nav below would
      // silently swallow DPAD presses while the overlay was open.
      if (focusSurface !== "screen") return false;
      // 2D nav: listings on row 0, [Reroll, Leave] on row 1. DOWN
      // from a card jumps to the Reroll button (the FIRST action),
      // so a user that opens the merchant with the controller can
      // actually reach Reroll without DPAD_RIGHT'ing all the way
      // through the listings to Leave. UP from the action row jumps
      // back to the last-focused card.
      if (btn === "DPAD_LEFT") {
        if (inActionsRow) {
          // Reroll <-> Leave; clamp at row edge.
          if (focusIdx > rerollIdx) setFocusIdx(focusIdx - 1);
        } else {
          if (focusIdx > 0) setFocusIdx(focusIdx - 1);
        }
      } else if (btn === "DPAD_RIGHT") {
        if (inActionsRow) {
          if (focusIdx < leaveIdx) setFocusIdx(focusIdx + 1);
        } else {
          if (focusIdx < rerollIdx - 1) setFocusIdx(focusIdx + 1);
          // From the last card, RIGHT slides down into Reroll so the
          // user can keep pressing the same direction to reach the
          // action row without ever using DOWN explicitly.
          else if (focusIdx === rerollIdx - 1) setFocusIdx(rerollIdx);
        }
      } else if (btn === "DPAD_DOWN") {
        // Already on the action row -> let the footer router catch
        // this press so it can flip focus into the persistent SZN
        // footer (roster + bag). Returning `false` propagates the
        // press down to the priority-50 footer handler.
        if (inActionsRow) return false;
        setFocusIdx(rerollIdx);
      } else if (btn === "DPAD_UP") {
        if (inActionsRow) {
          setFocusIdx(Math.min(lastCardIdxRef.current, rerollIdx - 1));
        }
      } else if (btn === "CROSS") {
        if (leaveFocused) onClose();
        else if (rerollFocused) {
          if (canReroll) rerollMerchant(slotIndex);
        } else handleBuy(focusIdx);
      } else if (btn === "TRIANGLE" || btn === "CIRCLE") onClose();
    },
  });

  return (
    <div
      className={`relative rounded-2xl bg-gradient-to-br ${vibe.gradient} ring-2 ${vibe.ring} shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-5 overflow-hidden`}
    >
      {/* Atmospheric flourish: pulsing glyph behind the title. */}
      <div
        aria-hidden
        className="absolute -top-10 -right-6 text-[160px] opacity-10 select-none pointer-events-none"
      >
        {headerGlyph}
      </div>

      <div className="flex items-start justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div
            className={`w-16 h-16 flex items-center justify-center rounded-2xl bg-slate-950/60 border-2 border-white/10 text-4xl shadow-inner`}
          >
            {headerGlyph}
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-300 block">
              Merchant
            </span>
            <h3 className="dugout-font-sport text-3xl sm:text-4xl uppercase tracking-widest text-white drop-shadow">
              {headerLabel}
            </h3>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-300 hover:text-white p-1 rounded hover:bg-white/10"
          aria-label="Close merchant"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Listings -- one click to buy. Each card uses the same chip
          visual the footer rail uses so the user reads "this is the
          card I'm about to add to my bag". The intermediate "select
          to see details" panel was removed: the chip IS the preview,
          and committing a buy animates it straight into the rail. */}
      <div className="flex flex-wrap justify-center gap-4 pt-3 relative z-10">
        {offer.listings.map((listing, i) => {
          const bought = boughtListingIds.has(listing.listingId);
          // ----- Bazaar tier-aware buy state -----
          // Item listings:
          //   - Not owned  -> standard bronze listing price, BUY CTA.
          //                    A full bag opens the ItemBagReplacePicker
          //                    rather than disabling the buy.
          //   - Owned at bronze/silver -> button shows an UPGRADE CTA
          //                    priced at the silver/gold tier curve.
          //   - Owned at gold -> click-locked with MAXED badge.
          // Roster-upgrade listings still pay listing.price as
          // printed (rarity bumps were never tiered).
          const isItemListing = !listing.rosterUpgrade;
          const card = SESSION_CARDS.find((c) => c.id === listing.cardId);
          const owned = isItemListing
            ? run?.itemBag.find((it) => it.cardId === listing.cardId)
            : undefined;
          const ownedTier: ItemTier | null = owned ? (owned.tier ?? "bronze") : null;
          const target = ownedTier ? nextTier(ownedTier) : null;
          const isMaxed = ownedTier !== null && target === null;
          const isUpgrade = ownedTier !== null && target !== null;
          // Display price: upgrade listings reprice at the silver/gold
          // multiplier so the cost mirrors the strength gain.
          const displayPrice =
            isUpgrade && card
              ? priceForTier(card, week, target!)
              : listing.price;
          const upgradeBadge = isUpgrade
            ? `UPG → ${tierLabel(target!).toUpperCase()}`
            : isMaxed
              ? "MAXED"
              : undefined;
          const upgradeBadgeClass = isMaxed
            ? "bg-slate-700"
            : isUpgrade
              ? "bg-amber-500 text-slate-900"
              : undefined;
          const disabledForCash = !bought && cash < displayPrice;
          return (
            <ListingCard
              key={listing.listingId}
              listing={listing}
              displayPrice={displayPrice}
              disabled={(!bought && (disabledForCash || isMaxed)) || bought}
              bought={bought}
              upgradeBadge={upgradeBadge}
              upgradeBadgeClass={upgradeBadgeClass}
              ownedTier={ownedTier}
              focused={focusIdx === i}
              onHover={() => setFocusIdx(i)}
              onBuy={() => handleBuy(i)}
              tileRef={(el) => {
                tileRefs.current[i] = el;
              }}
            />
          );
        })}
      </div>

      {/* Footer row: Reroll CTA + Leave. The reroll button rebuilds
          this merchant's listings for a small cash cost (1/3/5 by
          week) and is capped at 2 per visit so it can't be spammed.
          Counter chip shows remaining rerolls; greys when out. */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10 relative z-10">
        <button
          type="button"
          onClick={() => {
            if (canReroll) rerollMerchant(slotIndex);
          }}
          onMouseEnter={() => setFocusIdx(rerollIdx)}
          disabled={!canReroll}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold uppercase tracking-widest border transition-all ${
            canReroll
              ? "bg-slate-900/70 hover:bg-slate-800 text-amber-200 border-amber-400/40 hover:border-amber-300/70"
              : "bg-slate-900/40 text-slate-500 border-slate-700 cursor-not-allowed"
          } ${
            rerollFocused
              ? "ring-2 ring-amber-400/80 -translate-y-1 border-amber-300/60"
              : ""
          }`}
          title={
            rerollsLeft <= 0
              ? "No rerolls left this visit"
              : cash < rerollPrice
                ? "Not enough cash"
                : `Reroll stock for $${rerollPrice}`
          }
        >
          <RefreshCw className="w-4 h-4" />
          Reroll ${rerollPrice}
          <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-slate-950/70 text-[10px] tracking-wider text-slate-300 border border-white/10">
            {rerollsLeft}/{MERCHANT_REROLLS_PER_VISIT}
          </span>
        </button>
        <button
          type="button"
          onClick={onClose}
          onMouseEnter={() => setFocusIdx(leaveIdx)}
          className={`px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold uppercase tracking-widest text-white border border-white/20 transition-all ${
            leaveFocused
              ? "ring-2 ring-amber-400/80 -translate-y-1 border-amber-300/60"
              : ""
          }`}
        >
          Leave
        </button>
      </div>
    </div>
  );
}

function ListingCard({
  listing,
  displayPrice,
  disabled,
  bought,
  upgradeBadge,
  upgradeBadgeClass,
  ownedTier,
  focused,
  onHover,
  onBuy,
  tileRef,
}: {
  listing: MerchantListing;
  /** Live price shown on the chip + sub-chip. Equals the printed
   *  listing price for fresh acquires; switches to the tier upgrade
   *  price (silver/gold) when the user already owns the card. */
  displayPrice: number;
  disabled: boolean;
  bought: boolean;
  /** Bazaar-style upgrade CTA copy: `UPG → SILVER` / `MAXED`.
   *  Falls back to `undefined` for fresh acquires (the parent paints
   *  the standard chip without a corner badge). */
  upgradeBadge?: string;
  upgradeBadgeClass?: string;
  /** Owned bag tier for the listing's cardId, if any. Drives the
   *  top-left B/S/G glyph on the chip so the user reads the
   *  current tier at the same instant they read the upgrade CTA. */
  ownedTier?: ItemTier | null;
  focused: boolean;
  /** Mouse-enter sync drives the parent's focus index. */
  onHover: () => void;
  onBuy: () => void;
  /** Forwarded to the chip's button so the parent can measure its rect. */
  tileRef: (el: HTMLButtonElement | null) => void;
}) {
  const card = SESSION_CARDS.find((c) => c.id === listing.cardId);
  if (!card) return null;
  const isRosterUpgrade = !!listing.rosterUpgrade;
  // Badge precedence: bought > upgrade-state > roster-upgrade-tag.
  // The Bazaar upgrade/MAXED chip wins over the legacy DUP/REPL
  // chip because item listings don't carry rosterUpgrade at all (one
  // listing is either an item OR a roster duplicate, never both).
  const badge = bought
    ? "BOUGHT"
    : upgradeBadge ??
      (isRosterUpgrade
        ? listing.rosterUpgrade!.isReplacement
          ? `${listing.rosterUpgrade!.duplicateRarity.toUpperCase()} REPL`
          : `${listing.rosterUpgrade!.duplicateRarity.toUpperCase()} DUP`
        : undefined);
  const badgeClass = bought
    ? "bg-emerald-600"
    : upgradeBadgeClass ?? "bg-emerald-500";
  const interactive = !disabled && !bought;
  return (
    <div className="flex flex-col items-center gap-2.5">
      <FooterStyleAbilityCard
        card={card}
        focused={focused}
        disabled={!interactive}
        badge={badge}
        badgeClass={badgeClass}
        itemTier={ownedTier ?? null}
        onHover={onHover}
        onPick={interactive ? onBuy : undefined}
        tileRef={tileRef}
        ariaLabel={`${card.name} ${badge ?? ""}`.trim()}
      />
      {/* Price chip sits below the chip silhouette. Keeps the
          purchasing decision legible at a glance without bolting more
          text onto the chip itself. */}
      <div
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-black text-base shadow-md ${
          bought
            ? "bg-emerald-700 text-white"
            : disabled
              ? "bg-slate-800 text-slate-500"
              : "bg-amber-500 text-slate-900"
        }`}
      >
        <DollarSign className="w-4 h-4" />
        {displayPrice}
      </div>
    </div>
  );
}
