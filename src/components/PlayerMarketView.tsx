/**
 * PlayerMarketView — Free Agency stand. Bazaar-style cyan vibe so it
 * reads as a distinct encounter type next to merchants (amber) and
 * events (purple). Players are shown as the SAME `PlayerCard` the user
 * sees in their lineup so the visual identity is consistent.
 *
 * Pick-spend is fired by the PARENT `FrontOfficeScreen.closeEncounter`
 * unconditionally on close -- opening the encounter is the commitment.
 * Walking away without signing still spends the slot.
 */

import { DollarSign, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import type { PlayerMarketOffer } from "../lib/run";
import { PLAYERS } from "../lib/players";
import { PlayerCard } from "./PlayerCard";

export function PlayerMarketView({
  slotIndex,
  offer,
  onClose,
}: {
  slotIndex: number;
  offer: PlayerMarketOffer;
  onClose: () => void;
}) {
  const run = useGameStore((s) => s.run);
  const buy = useGameStore((s) => s.buyPlayerFromMarket);
  const cash = run?.cash ?? 0;

  const handleSign = (i: number) => {
    // `buyPlayerFromMarket` is internally a no-op on cash mismatch /
    // duplicate / unknown player, so a misclick won't accidentally
    // sign anyone. The encounter pick is committed by the parent on
    // close regardless of outcome.
    buy(slotIndex, i);
  };

  return (
    <div className="relative rounded-2xl bg-gradient-to-br from-cyan-700 via-cyan-950 to-slate-950 ring-2 ring-cyan-400/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-5 overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-10 -right-6 text-[160px] opacity-10 select-none pointer-events-none"
      >
        🪪
      </div>

      <div className="flex items-start justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-slate-950/60 border-2 border-white/10 text-4xl shadow-inner">
            🪪
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-cyan-300 block">
              Player Market
            </span>
            <h3 className="dugout-font-sport text-3xl sm:text-4xl uppercase tracking-widest text-white drop-shadow">
              {offer.label}
            </h3>
            <p className="text-sm text-cyan-200 mt-1">{offer.blurb}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-300 hover:text-white p-1 rounded hover:bg-white/10"
          aria-label="Close player market"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 justify-items-center relative z-10">
        {offer.listings.map((listing, i) => {
          const player = PLAYERS.find((p) => p.id === listing.playerId);
          if (!player) return null;
          const owned = !!run?.roster.some((r) => r.player.id === listing.playerId);
          const disabled = owned || cash < listing.price;
          return (
            <button
              key={listing.listingId}
              type="button"
              onClick={disabled ? undefined : () => handleSign(i)}
              disabled={disabled}
              className={`relative flex flex-col items-center gap-3 p-2 rounded-xl transition-all ${
                disabled ? "cursor-not-allowed" : "cursor-pointer hover:-translate-y-1"
              }`}
            >
              <div className={disabled ? "opacity-50 grayscale" : ""}>
                <PlayerCard player={player} tier={listing.tier} />
              </div>
              <div
                className={`mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-black text-base shadow-md ${
                  owned
                    ? "bg-emerald-700 text-white"
                    : disabled
                      ? "bg-slate-800 text-slate-500"
                      : "bg-amber-500 text-slate-900"
                }`}
              >
                {owned ? (
                  "OWNED"
                ) : (
                  <>
                    <DollarSign className="w-4 h-4" />
                    {listing.price}
                  </>
                )}
              </div>
            </button>
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
          the parent on close regardless of whether the user signed
          anyone, so the button copy is just "Leave". */}
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
