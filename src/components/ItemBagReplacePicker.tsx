/**
 * ItemBagReplacePicker — Bazaar-style "bag is full, pick a slot to sell"
 * modal. Mounts above the Front Office whenever
 * `run.pendingItemGrant !== null`. The user picks one current bag item
 * to sell back for cash; the sale clears one slot and the pending
 * grant lands in its place. Cancelling refunds the pre-computed
 * `refundOnCancel` consolation so the encounter pick is never
 * silently wasted.
 *
 * Mirrors the legacy `RosterReleasePicker` modal that the SZN footer
 * release flow replaced: same overlay class
 * (`bg-slate-950/95 backdrop-blur-md`), same DPAD/CROSS/CIRCLE gamepad
 * contract (priority 200 so nothing else resolves under it), same
 * scroll-into-view focus tracking, same Cancel link in the header.
 * The grid uses `ItemCardPreview` so the rendered bag items match
 * the visuals the user sees on the footer rail / merchant view /
 * pack-rip reveal -- one card identity across every surface.
 *
 * Cards expose two lines of supplementary text:
 *   - Tier glyph chip (B/S/G) so the user knows what they're giving
 *     up before they confirm.
 *   - "Sell for $N" subtitle (live `sellValueFor` curve) so the cash
 *     impact of the swap is legible up-front.
 */

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Item, PendingItemGrant } from "../lib/run";
import { SESSION_CARDS, type CardDefinition } from "../lib/cards";
import { sellValueFor } from "../lib/items";
import { TIER_GLYPH, TIER_TINT, type ItemTier } from "../lib/itemTiers";
import { ItemCardPreview } from "./ItemCardPreview";
import { useSznGamepad } from "../lib/useSznGamepad";

export interface ItemBagReplacePickerProps {
  open: boolean;
  bag: Item[];
  /** Current run week — drives the live `sellValueFor` curve. */
  week: number;
  pending: PendingItemGrant | null;
  onReplace: (instanceId: string) => void;
  onCancel: () => void;
}

interface BagSlotView {
  item: Item;
  card: CardDefinition;
  tier: ItemTier;
  sellValue: number;
}

export function ItemBagReplacePicker({
  open,
  bag,
  week,
  pending,
  onReplace,
  onCancel,
}: ItemBagReplacePickerProps) {
  // Resolve each bag instance into a renderable slot once per
  // (bag, week) tuple. Cards missing from SESSION_CARDS are skipped
  // defensively -- a persisted save that referenced a removed
  // encounter would otherwise crash this modal.
  const slots = useMemo<BagSlotView[]>(() => {
    const out: BagSlotView[] = [];
    for (const it of bag) {
      const card = SESSION_CARDS.find((c) => c.id === it.cardId);
      if (!card) continue;
      const tier: ItemTier = it.tier ?? "bronze";
      out.push({
        item: it,
        card,
        tier,
        sellValue: sellValueFor(card, week, tier),
      });
    }
    return out;
  }, [bag, week]);

  const [focusIdx, setFocusIdx] = useState(0);
  useEffect(() => {
    if (!open) return;
    setFocusIdx(0);
  }, [open, pending?.cardId]);

  const tileRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    if (!open) return;
    const focused = slots[focusIdx];
    if (!focused) return;
    const el = tileRefs.current.get(focused.item.instanceId);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open, slots, focusIdx]);

  useSznGamepad({
    id: "szn-item-replace-picker",
    priority: 200,
    enabled: open,
    handler: (btn) => {
      if (!open) return;
      switch (btn) {
        case "CIRCLE":
          onCancel();
          return;
        case "DPAD_LEFT":
          setFocusIdx((i) => Math.max(0, i - 1));
          return;
        case "DPAD_RIGHT":
          setFocusIdx((i) => Math.min(slots.length - 1, i + 1));
          return;
        case "DPAD_UP":
          setFocusIdx((i) => Math.max(0, i - 3));
          return;
        case "DPAD_DOWN":
          setFocusIdx((i) => Math.min(slots.length - 1, i + 3));
          return;
        case "CROSS": {
          const focused = slots[focusIdx];
          if (focused) onReplace(focused.item.instanceId);
          return;
        }
      }
    },
  });

  const pendingLabel = pending?.label ?? pending?.cardId ?? "the new item";
  const refundOnCancel = pending?.refundOnCancel ?? 0;
  const sourceVerb = pending?.source === "merchant" ? "buy" : "receive";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="szn-item-replace-picker"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-md flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Sell a bag item to make room"
        >
          <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
            >
              <ArrowLeft className="w-4 h-4" />
              Cancel (+${refundOnCancel})
            </button>
            <h1 className="dugout-font-sport text-2xl uppercase tracking-widest text-amber-200">
              Bag is Full
            </h1>
            <div className="w-[140px]" />
          </header>

          <div className="px-6 pt-4 pb-2 text-center">
            <p className="text-sm text-slate-300">
              All 6 slots are in use. Sell one to make room for{" "}
              <span className="text-amber-200 font-bold">{pendingLabel}</span> — or cancel
              to {sourceVerb === "buy" ? "skip the purchase" : "decline the grant"} and
              pocket a <span className="text-emerald-300 font-bold">${refundOnCancel}</span>{" "}
              consolation refund.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-4 place-items-center">
              {slots.map((slot, idx) => {
                const isFocused = idx === focusIdx;
                return (
                  <button
                    key={slot.item.instanceId}
                    ref={(el) => {
                      if (el) tileRefs.current.set(slot.item.instanceId, el);
                      else tileRefs.current.delete(slot.item.instanceId);
                    }}
                    type="button"
                    onMouseEnter={() => setFocusIdx(idx)}
                    onClick={() => onReplace(slot.item.instanceId)}
                    className={[
                      "rounded-lg p-1 transition-transform flex flex-col items-center gap-2",
                      isFocused
                        ? "ring-2 ring-amber-300 -translate-y-1 shadow-[0_8px_18px_rgba(251,191,36,0.4)]"
                        : "ring-0",
                    ].join(" ")}
                  >
                    <div className="relative">
                      <ItemCardPreview
                        card={slot.card}
                        compact
                        interactiveTooltip={false}
                      />
                      {slot.tier !== "bronze" && (
                        <span
                          className="absolute -top-1 -left-1 inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-900 shadow"
                          style={{ background: TIER_TINT[slot.tier] }}
                          aria-label={`Tier ${slot.tier}`}
                        >
                          {TIER_GLYPH[slot.tier]}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                      Sell · ${slot.sellValue}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <footer className="border-t border-white/10 bg-slate-900/80 backdrop-blur-sm px-6 py-3 text-center text-xs uppercase tracking-widest text-slate-400">
            <span className="text-slate-300">CROSS</span> sell &amp; swap
            &nbsp;·&nbsp; <span className="text-slate-300">CIRCLE</span> cancel for refund
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
