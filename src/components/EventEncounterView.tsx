/**
 * EventEncounterView — Bazaar-style narrative encounter. Vivid purple
 * vibe to distinguish from merchants (amber) and player markets (cyan).
 *
 * Two phases:
 *   1) Choice phase: prompt + 2-4 choices laid out as fat buttons.
 *   2) Result phase: shows the resolution blurb plus the reward card
 *      (if the choice handed out an item) so the user sees exactly
 *      what they earned. Continue closes the modal.
 *
 * Pick-spend is fired by the PARENT `FrontOfficeScreen.closeEncounter`
 * unconditionally on close -- opening the encounter is the commitment.
 * Walking away from the choice phase still spends the slot.
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import {
  EVENT_BLURB,
  EVENT_LABEL,
  type EventOffer,
  type EventChoice,
  type EventId,
} from "../lib/run";
import { SESSION_CARDS, type CardDefinition } from "../lib/cards";
import { ItemCardPreview } from "./ItemCardPreview";

const EVENT_GLYPH: Record<EventId, string> = {
  ringing_phone: "📞",
  microphone: "🎙️",
  injury_report: "🩼",
};

export function EventEncounterView({
  slotIndex,
  offer,
  onClose,
}: {
  slotIndex: number;
  offer: EventOffer;
  onClose: () => void;
}) {
  const resolveEventChoice = useGameStore((s) => s.resolveEventChoice);
  // Capture the bag's pre-choice instanceIds ONCE on mount via a state
  // initializer pulling directly from `useGameStore.getState()`. A live
  // selector (`useGameStore((s) => s.run?.itemBag.map(...))`) would
  // re-run on every store update, so the moment `resolveEventChoice`
  // adds the new item the snapshot would already contain it -- and the
  // diff below would never find a "new" entry to surface as the reward.
  const [initialBagIds] = useState<string[]>(() => {
    const s = useGameStore.getState();
    return s.run ? s.run.itemBag.map((i) => i.instanceId) : [];
  });
  // Subscribe to itemBag itself (not the `?? []` fallback) so the
  // reference stays stable across renders that don't actually mutate
  // the bag; an inline `?? []` minted a fresh array literal every tick.
  const bag = useGameStore((s) => s.run?.itemBag);
  const [resolved, setResolved] = useState<EventChoice | null>(null);
  const [rewardCard, setRewardCard] = useState<CardDefinition | null>(null);

  // After a choice resolves, peek at the bag for a new instance and
  // resolve it back to its CardDefinition for the reveal panel.
  useEffect(() => {
    if (!resolved) return;
    if (resolved.effect.kind !== "addItemRandom") return;
    if (!bag) return;
    const newOne = bag.find((i) => !initialBagIds.includes(i.instanceId));
    if (!newOne) return;
    const card = SESSION_CARDS.find((c) => c.id === newOne.cardId) ?? null;
    setRewardCard(card);
  }, [resolved, bag, initialBagIds]);

  const handleChoice = (c: EventChoice) => {
    resolveEventChoice(slotIndex, c.choiceId);
    setResolved(c);
  };

  return (
    <div className="relative rounded-2xl bg-gradient-to-br from-purple-800 via-purple-950 to-slate-950 ring-2 ring-purple-500/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-5 overflow-hidden">
      {/* Glyph backdrop */}
      <div
        aria-hidden
        className="absolute -top-12 -right-6 text-[180px] opacity-10 select-none pointer-events-none"
      >
        {EVENT_GLYPH[offer.eventId]}
      </div>

      <div className="flex items-start justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-slate-950/60 border-2 border-white/10 text-4xl shadow-inner">
            {EVENT_GLYPH[offer.eventId]}
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-purple-300 block">
              Event
            </span>
            <h3 className="dugout-font-sport text-3xl sm:text-4xl uppercase tracking-widest text-white drop-shadow">
              {EVENT_LABEL[offer.eventId]}
            </h3>
            <p className="text-sm text-purple-200 mt-1">
              {EVENT_BLURB[offer.eventId]}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-300 hover:text-white p-1 rounded hover:bg-white/10"
          aria-label="Close event"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <p className="text-base sm:text-lg text-white/95 leading-snug bg-black/30 border border-white/10 rounded-xl px-4 py-3 relative z-10">
        “{offer.prompt}”
      </p>

      {!resolved ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
          {offer.choices.map((c) => (
            <motion.button
              key={c.choiceId}
              type="button"
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleChoice(c)}
              className="rounded-xl border-2 border-purple-400/40 bg-slate-950/60 p-4 text-left flex flex-col gap-1 hover:border-purple-300 hover:bg-purple-900/40 transition-colors"
            >
              <span className="dugout-font-sport text-lg sm:text-xl uppercase tracking-wide text-white leading-tight">
                {c.label}
              </span>
            </motion.button>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border-2 border-emerald-400/50 bg-emerald-950/40 p-4 flex flex-col gap-4 relative z-10"
        >
          <p className="text-base sm:text-lg text-emerald-100 leading-snug">
            {resolved.resultBlurb}
          </p>
          {rewardCard && (
            <div className="flex flex-col items-center gap-2 pt-2 border-t border-emerald-500/20">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.4em] text-emerald-200">
                <Sparkles className="w-3.5 h-3.5" />
                Added to your bag
              </span>
              <motion.div
                initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 240, damping: 20 }}
              >
                <ItemCardPreview card={rewardCard} large />
              </motion.div>
              <span className="text-[10px] uppercase tracking-widest text-emerald-300/80 mt-2">
                {rewardCard.name}
              </span>
            </div>
          )}
        </motion.div>
      )}

      <div className="flex justify-end gap-2 relative z-10">
        <button
          type="button"
          onClick={onClose}
          className={`px-5 py-2.5 rounded-lg text-sm font-bold uppercase tracking-widest border ${
            resolved
              ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-300/40"
              : "bg-white/10 hover:bg-white/20 text-white border-white/20"
          }`}
        >
          {resolved ? "Continue" : "Walk away"}
        </button>
      </div>
    </div>
  );
}
