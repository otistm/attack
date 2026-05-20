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
  MAX_BAG_SIZE,
  MERCHANT_LABEL,
  type MerchantOffer,
  type MerchantListing,
  type MerchantId,
} from "../lib/run";
import { SESSION_CARDS } from "../lib/cards";
import { ItemCardPreview } from "./ItemCardPreview";
import {
  EncounterFocusPanel,
  type EncounterFocusCardData,
} from "./EncounterFocusOverlay";
import { SZN_EDGES, type SznEdgeId } from "../lib/sznEdges";
import { useSznGamepad, useFocusIndex } from "../lib/useSznGamepad";

const MERCHANT_GLYPH: Record<MerchantId, string> = {
  scouting_director: "🔭",
  shady_trainer: "💉",
  equipment_manager: "⚾",
  concessions: "🌭",
};

// Per-persona visual tints for the merchant container. The `tint`
// slot used to drive the persona blurb color but the blurb was
// removed from the opened header (it's already rendered on the
// EncounterCard tile), so the type now carries only the gradient +
// ring used by the container shell.
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
  const cash = run?.cash ?? 0;
  const vibe = MERCHANT_VIBE[offer.merchantId];
  // Themed merchant encounters (Hobby Shop, Clearance Bin) override
  // the base persona's label / glyph so the header matches the
  // encounter tile the user just clicked. The blurb override is
  // intentionally NOT read here -- the blurb is rendered on the
  // tile and removed from the opened header to avoid duplication.
  const headerLabel = offer.displayLabel ?? MERCHANT_LABEL[offer.merchantId];
  const headerGlyph = offer.displayGlyph ?? MERCHANT_GLYPH[offer.merchantId];

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

  // Controller navigation. DPad cycles through the listing row PLUS
  // a trailing "Leave" slot so a gamepad user can navigate to the
  // Leave button and activate it with CROSS (matches mouse UX).
  // TRIANGLE / CIRCLE still close from anywhere as the shortcut path.
  const leaveIdx = offer.listings.length; // last cursor slot is "Leave"
  const [focusIdx, setFocusIdx, focusHelpers] = useFocusIndex(offer.listings.length + 1);
  const leaveFocused = focusIdx === leaveIdx;

  // Derive the focused-listing payload for the floating overlay above
  // the modal. Mouse hover and gamepad DPAD both drive `focusIdx`, so
  // either input shows the detail panel for whichever listing is hot.
  // `null` when the cursor is on the Leave button (no card to detail).
  const focusedCardOverlay: EncounterFocusCardData | null = (() => {
    if (leaveFocused) return null;
    const listing = offer.listings[focusIdx];
    if (!listing) return null;
    const card = SESSION_CARDS.find((c) => c.id === listing.cardId);
    if (!card) return null;
    // Subtitle surfaces "UPGRADE" / "DUPLICATE" / abilityType context
    // for the focused listing. Price is intentionally NOT included
    // here -- the amber price chip directly under the card already
    // shows it, and the user explicitly asked for no duplicate
    // price text in the description area.
    const subtitleParts: string[] = [];
    if (listing.rosterUpgrade) {
      subtitleParts.push(
        listing.rosterUpgrade.isReplacement
          ? `${listing.rosterUpgrade.duplicateRarity.toUpperCase()} REPLACEMENT`
          : `${listing.rosterUpgrade.duplicateRarity.toUpperCase()} DUPLICATE`,
      );
    } else {
      subtitleParts.push(card.abilityType);
    }
    // Edge resolution mirrors ItemCardPreview's gate: only surface
    // edges when BOTH sides are registered SznEdgeIds so the chips
    // don't render for legacy quick-match items the SZN snap engine
    // wouldn't understand.
    const left =
      card.sznLeftEdge && card.sznLeftEdge in SZN_EDGES
        ? (card.sznLeftEdge as SznEdgeId)
        : null;
    const right =
      card.sznRightEdge && card.sznRightEdge in SZN_EDGES
        ? (card.sznRightEdge as SznEdgeId)
        : null;
    return {
      label: card.name,
      subtitle: subtitleParts.join(" · "),
      description: card.description,
      value: card.baseValue,
      leftEdge: left,
      rightEdge: right,
    };
  })();
  useSznGamepad({
    id: "merchant-view",
    priority: 100,
    enabled: true,
    handler: (btn) => {
      if (btn === "DPAD_LEFT" || btn === "DPAD_UP") focusHelpers.prev();
      else if (btn === "DPAD_RIGHT" || btn === "DPAD_DOWN") focusHelpers.next();
      else if (btn === "CROSS") {
        if (leaveFocused) onClose();
        else handleBuy(focusIdx);
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
            {/* Persona blurb (e.g. "a streetball legend stops you
                outside the park") is rendered ONCE -- on the
                EncounterCard tile in `FrontOfficeScreen`. Repeating
                it in the opened merchant header was a verbatim copy
                the user had already just read to commit to the
                pick. The opened view keeps the pill + title for
                visual continuity but drops the blurb so it doesn't
                read as duplicate. */}
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
          // SZN ownership / capacity gates: item listings already in
          // the bag are click-locked with an OWNED badge (the store
          // also blocks the buy), and once the bag is at MAX_BAG_SIZE
          // every item listing greys out with a BAG FULL badge.
          const isItemListing = !listing.rosterUpgrade;
          const alreadyOwned =
            isItemListing &&
            !!run?.itemBag.some((it) => it.cardId === listing.cardId);
          const bagFull =
            isItemListing && (run?.itemBag.length ?? 0) >= MAX_BAG_SIZE;
          return (
            <ListingCard
              key={listing.listingId}
              listing={listing}
              disabled={
                !bought && (cash < listing.price || alreadyOwned || bagFull)
              }
              bought={bought}
              alreadyOwned={alreadyOwned}
              bagFull={bagFull && !alreadyOwned}
              focused={focusIdx === i}
              onHover={() => setFocusIdx(i)}
              onBuy={() => handleBuy(i)}
            />
          );
        })}
      </div>

      {/* Footer row: focused-card detail on the LEFT, Leave button on
          the right. The detail panel sizes itself to fill the
          available horizontal space (flex-1) so long descriptions
          truncate cleanly without pushing the action button off the
          row. When nothing is focused the panel returns null and the
          Leave button simply right-aligns on its own.
          Cash on hand intentionally NOT surfaced here -- the RunHud
          strip already shows live cash so this row stays focused on
          the listing-detail context the user is acting on. */}
      <div className="flex items-stretch gap-3 pt-3 border-t border-white/10 relative z-10">
        <div className="flex-1 min-w-0 flex items-center">
          <EncounterFocusPanel card={focusedCardOverlay} variant="ability" />
        </div>
        <div className="flex items-center">
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
    </div>
  );
}

function ListingCard({
  listing,
  disabled,
  bought,
  alreadyOwned,
  bagFull,
  focused,
  onHover,
  onBuy,
}: {
  listing: MerchantListing;
  disabled: boolean;
  bought: boolean;
  alreadyOwned: boolean;
  bagFull: boolean;
  focused: boolean;
  /**
   * Mouse-enter sync. Mouse hover should drive the parent's focus
   * index so the floating `EncounterFocusOverlay` updates as the
   * pointer moves between listings, matching the gamepad DPAD path.
   */
  onHover: () => void;
  onBuy: () => void;
}) {
  const card = SESSION_CARDS.find((c) => c.id === listing.cardId);
  if (!card) return null;
  const isUpgrade = !!listing.rosterUpgrade;
  // Roster upgrades take an "UPGRADE" / "COMMON DUP" / "ALL STAR REPL"
  // badge in normal state; once bought, every listing -- regardless of
  // type -- shows the green "BOUGHT" badge so the user can see at a
  // glance which slots they've already cleared. Item-only badges:
  // OWNED (already in bag, store blocks duplicate purchases) and
  // BAG FULL (bag hit MAX_BAG_SIZE).
  const badge = bought
    ? "BOUGHT"
    : alreadyOwned
      ? "OWNED"
      : bagFull
        ? "BAG FULL"
        : isUpgrade
          ? listing.rosterUpgrade!.isReplacement
            ? `${listing.rosterUpgrade!.duplicateRarity.toUpperCase()} REPL`
            : `${listing.rosterUpgrade!.duplicateRarity.toUpperCase()} DUP`
          : undefined;
  const badgeClass = bought
    ? "bg-emerald-600"
    : alreadyOwned
      ? "bg-slate-700"
      : bagFull
        ? "bg-rose-600"
        : "bg-emerald-500";
  // Bought listings are click-locked so the user can't accidentally
  // buy the same item twice (each click would mint another bag entry
  // OR no-op silently for upgrades).
  const interactive = !disabled && !bought;
  return (
    <button
      type="button"
      onClick={interactive ? onBuy : undefined}
      onMouseEnter={onHover}
      disabled={!interactive}
      className={`group relative flex flex-col items-center gap-3 p-2 rounded-xl transition-all ${
        interactive
          ? "cursor-pointer hover:-translate-y-1"
          : "cursor-not-allowed"
      } ${focused ? "ring-2 ring-amber-400/80 -translate-y-1" : ""}`}
    >
      <ItemCardPreview
        card={card}
        dimmed={disabled || bought}
        badge={badge}
        badgeClass={badgeClass}
        // Encounter context already mounts an EncounterFocusPanel
        // at the bottom of the merchant view that renders the
        // SAME card name + ability type + description on focus.
        // Letting the hover tooltip fire here would mean every
        // mouse pass over a listing pops a transient panel that
        // exactly duplicates the always-on focus readout. Disable
        // the tooltip in this surface so the focus panel is the
        // sole source of truth for the focused-card description.
        interactiveTooltip={false}
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
