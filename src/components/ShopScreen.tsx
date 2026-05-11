import { useGameStore } from "../lib/gameStore";
import { ITEMS, ItemDefinition } from "../lib/items";
import { motion } from "motion/react";

export function ShopScreen() {
  const budget = useGameStore((s) => s.teamBudget);
  const inventory = useGameStore((s) => s.inventory);
  
  const allItems = Object.values(ITEMS);
  const batItems = allItems.filter(i => i.merchant === "Bat Manufacturer");
  const pitchItems = allItems.filter(i => i.merchant === "Pitching Guru");
  const shadyItems = allItems.filter(i => i.merchant === "Shady Trainer");

  const buyItem = (item: ItemDefinition) => {
    useGameStore.setState((s) => {
      if (s.teamBudget >= item.cost) {
        return {
          teamBudget: s.teamBudget - item.cost,
          inventory: [...s.inventory, item.id]
        };
      }
      return s;
    });
  };

  const startNextGame = () => {
    // Transition to the battle phase (currently 'selecting')
    useGameStore.setState({ phase: "selecting" });
  };

  const MerchantSection = ({ title, items, description }: { title: string, items: ItemDefinition[], description: string }) => (
    <div className="bg-slate-800/80 p-6 rounded-xl border border-slate-700 backdrop-blur-sm">
      <h3 className="text-xl font-bold mb-2 text-emerald-400">{title}</h3>
      <p className="text-slate-400 text-sm mb-6">{description}</p>
      
      <div className="space-y-4">
        {items.map(item => {
          const canAfford = budget >= item.cost;
          return (
            <div key={item.id} className="flex items-center justify-between bg-slate-900 p-4 rounded-lg">
              <div>
                <div className="font-bold text-slate-200">{item.name}</div>
                <div className="text-sm text-slate-400">{item.description}</div>
              </div>
              <button
                onClick={() => buyItem(item)}
                disabled={!canAfford}
                className={`px-4 py-2 rounded font-bold transition-colors ${canAfford ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-900' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
              >
                ${item.cost}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-8"
    >
      <div className="max-w-6xl w-full h-full flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-end mb-8 border-b border-slate-700 pb-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-white">Front Office</h1>
            <p className="text-slate-400 mt-2">Spend your budget wisely before the next game.</p>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">Team Budget</div>
            <div className="text-3xl font-black text-emerald-400">${budget}</div>
          </div>
        </div>

        {/* Merchants Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 overflow-y-auto min-h-0 pr-4">
          <MerchantSection 
            title="The Bat Manufacturer" 
            description="Premium lumber and grip gear. Equippable only to position players."
            items={batItems} 
          />
          <MerchantSection 
            title="The Pitching Guru" 
            description="Rosin, pine tar, and throwing aides. Equippable only to pitchers."
            items={pitchItems} 
          />
          <MerchantSection 
            title="The Shady Trainer" 
            description="High-risk, high-reward performance enhancers. Comes with consequences."
            items={shadyItems} 
          />
        </div>

        {/* Footer / Inventory */}
        <div className="mt-8 pt-6 border-t border-slate-700 flex justify-between items-center">
          <div className="flex gap-2">
            <span className="text-slate-400 flex items-center">Inventory:</span>
            {inventory.length === 0 ? (
              <span className="text-slate-600 flex items-center">Empty</span>
            ) : (
              inventory.map((id, i) => (
                <div key={i} className="bg-slate-800 px-3 py-1 text-sm rounded border border-slate-700 text-slate-300">
                  {ITEMS[id]?.name || id}
                </div>
              ))
            )}
          </div>
          
          <button 
            onClick={startNextGame}
            className="bg-blue-500 hover:bg-blue-400 text-white font-black px-8 py-4 rounded-xl text-lg transition-transform hover:scale-105 active:scale-95 shadow-lg shadow-blue-500/20"
          >
            Take the Field
          </button>
        </div>
      </div>
    </motion.div>
  );
}
