/**
 * RosterDrawer — slide-up drawer showing the run's 10 roster slots, the
 * item bag, and the live tag-synergy bar. The drawer is read-only for
 * tier upgrades from this surface (those happen at the Scouting Director
 * merchant), but it's the source of truth for what the player has built.
 */

import { motion } from "motion/react";
import { Trash2, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { type RosterPlayer } from "../lib/run";
import { activeSynergies } from "../lib/synergies";
import { SESSION_CARDS } from "../lib/cards";
import { PlayerCard } from "./PlayerCard";

export function RosterDrawer({ onClose }: { onClose: () => void }) {
  const run = useGameStore((s) => s.run);
  const sellPlayer = useGameStore((s) => s.sellPlayerForCash);
  if (!run) return null;
  const synergies = activeSynergies(run.roster);
  const batters = run.roster.filter((r) => r.player.role === "Batter");
  const pitchers = run.roster.filter((r) => r.player.role === "Pitcher");

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 200, damping: 28 }}
      className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] rounded-t-2xl border-t border-emerald-500/40 bg-slate-950/97 shadow-2xl pointer-events-auto overflow-y-auto"
    >
      <div className="max-w-5xl mx-auto p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="dugout-font-sport text-2xl uppercase tracking-widest text-amber-200">
            Front Office Roster
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Synergy bar */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            Active Synergies
          </div>
          <div className="flex flex-wrap gap-2">
            {synergies.length === 0 ? (
              <span className="text-xs text-slate-500">
                No synergies yet — duplicate class tags to activate buffs.
              </span>
            ) : (
              synergies.map((s) => (
                <span
                  key={s.tag}
                  className="px-2 py-1 rounded border border-emerald-500/60 bg-emerald-900/30 text-[11px] font-bold uppercase tracking-wide text-emerald-200"
                >
                  {s.threshold.label}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Roster */}
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            Lineup ({batters.length} batters · {pitchers.length} pitcher
            {pitchers.length === 1 ? "" : "s"})
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[...batters, ...pitchers].map((slot, i) => (
              <RosterSlot
                key={`${slot.player.id}-${i}`}
                slot={slot}
                onSell={() => sellPlayer(slot.player.id)}
                canSell={run.roster.length > 1}
              />
            ))}
          </div>
        </div>

        {/* Bag */}
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            Item Bag ({run.itemBag.length})
          </div>
          {run.itemBag.length === 0 ? (
            <p className="text-xs text-slate-500">
              Bag is empty. Visit a merchant to stock items.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {run.itemBag.map((item) => {
                const card = SESSION_CARDS.find((c) => c.id === item.cardId);
                return (
                  <div
                    key={item.instanceId}
                    className="px-2 py-1 rounded border border-slate-700 bg-slate-900/60 text-[11px] flex items-center gap-2"
                  >
                    <span className="font-bold text-white">{card?.name ?? item.cardId}</span>
                    <span className="text-amber-300 font-black">{card?.baseValue ?? 0}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function RosterSlot({
  slot,
  onSell,
  canSell,
}: {
  slot: RosterPlayer;
  onSell: () => void;
  canSell: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center gap-1.5 group">
      <PlayerCard player={slot.player} tier={slot.tier} compact showSockets={false} />
      {canSell && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!confirm(`Sell ${slot.player.name} for cash?`)) return;
            onSell();
          }}
          className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
          title="Sell player"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
