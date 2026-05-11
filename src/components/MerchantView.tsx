/**
 * MerchantView — Bazaar-style merchant stall. The user enters, browses
 * the four listings (rendered as the SAME card visuals they'd see in
 * combat), buys whatever fits their budget, and leaves.
 *
 * Pick-spend is fired by the PARENT `FrontOfficeScreen.closeEncounter`
 * unconditionally on close -- opening the encounter is the commitment.
 * That means walking away without buying still spends the slot, which
 * is the intended run-loop tension. This view just signals "I'm done"
 * via `onClose` and does NOT call `commitEncounter` directly.
 *
 * Visual language: amber/gold accents for merchants, vivid persona
 * portrait, item cards laid out in a row that mirrors the in-game hand
 * strip so the user reads "this is the same card I'll be playing with".
 *
 * Roster-upgrade listings get an emerald accent + "UPGRADE" badge so
 * they're visually distinct from plain item buys.
 */

import { useState } from "react";
import { DollarSign, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import {
  MERCHANT_BLURB,
  MERCHANT_LABEL,
  type MerchantOffer,
  type MerchantListing,
  type MerchantId,
} from "../lib/run";
import { SESSION_CARDS } from "../lib/cards";
import { ItemCardPreview } from "./ItemCardPreview";

const MERCHANT_GLYPH: Record<MerchantId, string> = {
  scouting_director: "🔭",
  shady_trainer: "💉",
  equipment_manager: "⚾",
  concessions: "🌭",
};

const MERCHANT_VIBE: Record<
  MerchantId,
  { gradient: string; ring: string; tint: string }
> = {
  scouting_director: {
    gradient: "from-emerald-700 via-emerald-900 to-slate-950",
    ring: "ring-emerald-500/60",
    tint: "text-emerald-200",
  },
  shady_trainer: {
    gradient: "from-rose-800 via-rose-950 to-slate-950",
    ring: "ring-rose-500/60",
    tint: "text-rose-200",
  },
  equipment_manager: {
    gradient: "from-amber-700 via-amber-950 to-slate-950",
    ring: "ring-amber-500/60",
    tint: "text-amber-200",
  },
  concessions: {
    gradient: "from-orange-700 via-rose-900 to-slate-950",
    ring: "ring-orange-500/60",
    tint: "text-orange-200",
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
  const cash = run?.cash ?? 0;
  const vibe = MERCHANT_VIBE[offer.merchantId];

  // Track which listings have already been purchased so the UI can
  // disable / mark them and prevent accidental double-purchase clicks
  // (each click would mint another bag entry OR no-op silently for
  // upgrades, neither of which the user wants).
  const [boughtListingIds, setBoughtListingIds] = useState<Set<string>>(
    () => new Set(),
  );

  const handleBuy = (listingIndex: number) => {
    const listing = offer.listings[listingIndex];
    if (!listing) return;
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
  };

  return (
    <div
      className={`relative rounded-2xl bg-gradient-to-br ${vibe.gradient} ring-2 ${vibe.ring} shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-5 overflow-hidden`}
    >
      {/* Atmospheric flourish: pulsing glyph behind the title. */}
      <div
        aria-hidden
        className="absolute -top-10 -right-6 text-[160px] opacity-10 select-none pointer-events-none"
      >
        {MERCHANT_GLYPH[offer.merchantId]}
      </div>

      <div className="flex items-start justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div
            className={`w-16 h-16 flex items-center justify-center rounded-2xl bg-slate-950/60 border-2 border-white/10 text-4xl shadow-inner`}
          >
            {MERCHANT_GLYPH[offer.merchantId]}
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-300 block">
              Merchant
            </span>
            <h3 className="dugout-font-sport text-3xl sm:text-4xl uppercase tracking-widest text-white drop-shadow">
              {MERCHANT_LABEL[offer.merchantId]}
            </h3>
            <p className={`text-sm mt-1 ${vibe.tint}`}>
              {MERCHANT_BLURB[offer.merchantId]}
            </p>
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

      {/* Listings -- rendered at large size so the cards read as
          inviting, not as a tight inventory list. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 justify-items-center pt-3">
        {offer.listings.map((listing, i) => {
          const bought = boughtListingIds.has(listing.listingId);
          return (
            <ListingCard
              key={listing.listingId}
              listing={listing}
              disabled={!bought && cash < listing.price}
              bought={bought}
              onBuy={() => handleBuy(i)}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-white/10 relative z-10">
        <span className="text-xs uppercase tracking-widest text-white/60">
          Cash on hand
        </span>
        <span className="inline-flex items-center gap-1 font-black text-amber-300 text-xl">
          <DollarSign className="w-5 h-5" />
          {cash}
        </span>
      </div>

      {/* Single primary action -- the encounter pick is committed by
          the parent on close regardless of whether the user bought
          anything, so the button copy is just "Leave". */}
      <div className="flex items-center justify-end gap-3 relative z-10">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold uppercase tracking-widest text-white border border-white/20"
        >
          Leave
        </button>
      </div>
    </div>
  );
}

function ListingCard({
  listing,
  disabled,
  bought,
  onBuy,
}: {
  listing: MerchantListing;
  disabled: boolean;
  bought: boolean;
  onBuy: () => void;
}) {
  const card = SESSION_CARDS.find((c) => c.id === listing.cardId);
  if (!card) return null;
  const isUpgrade = !!listing.rosterUpgrade;
  // Roster upgrades take an "UPGRADE" / "BRONZE DUP" / "SILVER REPL"
  // badge in normal state; once bought, every listing -- regardless of
  // type -- shows the green "BOUGHT" badge so the user can see at a
  // glance which slots they've already cleared.
  const badge = bought
    ? "BOUGHT"
    : isUpgrade
      ? listing.rosterUpgrade!.isReplacement
        ? `${listing.rosterUpgrade!.duplicateTier.toUpperCase()} REPL`
        : `${listing.rosterUpgrade!.duplicateTier.toUpperCase()} DUP`
      : undefined;
  const badgeClass = bought ? "bg-emerald-600" : "bg-emerald-500";
  // Bought listings are click-locked so the user can't accidentally
  // buy the same item twice (each click would mint another bag entry
  // OR no-op silently for upgrades).
  const interactive = !disabled && !bought;
  return (
    <button
      type="button"
      onClick={interactive ? onBuy : undefined}
      disabled={!interactive}
      className={`group relative flex flex-col items-center gap-3 p-2 rounded-xl transition-all ${
        interactive
          ? "cursor-pointer hover:-translate-y-1"
          : "cursor-not-allowed"
      }`}
    >
      <ItemCardPreview
        card={card}
        dimmed={disabled || bought}
        badge={badge}
        badgeClass={badgeClass}
      />
      {/* Price chip sits below the card silhouette. */}
      <div
        className={`mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-black text-base shadow-md ${
          bought
            ? "bg-emerald-700 text-white"
            : disabled
              ? "bg-slate-800 text-slate-500"
              : "bg-amber-500 text-slate-900 group-hover:bg-amber-400"
        }`}
      >
        <DollarSign className="w-4 h-4" />
        {listing.price}
      </div>
    </button>
  );
}
