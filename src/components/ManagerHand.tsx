import { useGameStore } from "../lib/gameStore";
import { ITEMS } from "../lib/items";
import { motion } from "motion/react";

export function ManagerHand({ side }: { side: "Batting" | "Pitching" }) {
  const inventory = useGameStore((s) => s.inventory);
  const phase = useGameStore((s) => s.phase);
  const gameMode = useGameStore((s) => s.gameMode);

  // SZN replaces the legacy Manager's Hand panel with the always-on
  // `SznFooterDecks` Abilities column. Mounting both stacks two
  // duplicate item rails on the same screen, so this component bows
  // out entirely whenever a SZN run owns the surface.
  if (gameMode === "szn") return null;

  // Only show the manager's hand during the selecting phase
  if (phase !== "selecting") return null;

  return (
    <div className="absolute bottom-24 right-4 z-40">
      <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border-2 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
        <h3 className="text-emerald-400 font-black text-sm uppercase tracking-widest mb-3 text-center">
          Manager's Hand
        </h3>
        
        {inventory.length === 0 ? (
          <div className="text-slate-500 text-xs text-center p-4 border border-slate-800 rounded bg-slate-950/50">
            No items available.
          </div>
        ) : (
          <div className="flex gap-2">
            {inventory.map((itemId, i) => {
              const item = ITEMS[itemId];
              if (!item) return null;
              
              // Only highlight items that can be played by this side
              const isPlayable = item.target === "Any" || item.target === side;
              
              return (
                <motion.div
                  key={`${itemId}-${i}`}
                  drag
                  dragSnapToOrigin
                  whileDrag={{ scale: 1.1, zIndex: 50 }}
                  className={`
                    w-20 h-24 rounded-lg p-2 flex flex-col justify-between cursor-grab active:cursor-grabbing border-2
                    ${isPlayable ? 'bg-slate-800 border-slate-600' : 'bg-slate-900 border-slate-800 opacity-50'}
                  `}
                  onDragEnd={(e, info) => {
                    // Simple drop heuristic: if dragged far left (into the play area), auto-equip to top card for now
                    if (info.offset.x < -100 && isPlayable) {
                      const hand = side === "Batting" ? useGameStore.getState().draft.roster.user.batters : useGameStore.getState().draft.roster.user.pitchers;
                      if (hand.length > 0) {
                        useGameStore.getState().equipItem(itemId, hand[0].id);
                      }
                    }
                  }}
                >
                  <div className="text-[10px] font-bold text-slate-300 leading-tight">
                    {item.name}
                  </div>
                  {item.valueModifier && (
                    <div className="text-emerald-400 font-black text-sm text-right">
                      +{item.valueModifier}
                    </div>
                  )}
                  {item.hitScaleModifier && (
                    <div className="text-sky-400 font-black text-sm text-right">
                      +{item.hitScaleModifier}HS
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
