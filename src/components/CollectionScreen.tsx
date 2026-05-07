import { CardDefinition, SESSION_CARDS } from '../lib/cards';
import { BATTERS, PITCHERS, MlbPlayer } from '../lib/players';
import { ShapeHalf } from './CardGameOverlay';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

const CollectionCard = ({ card }: { card: CardDefinition }) => {
  return (
    <div className="flex flex-col items-center gap-4 group cursor-pointer transition-transform hover:scale-105">
      <div 
        className={`relative w-32 h-44 bg-white rounded-xl border-2 flex flex-col items-center justify-center transition-all duration-300 shadow-md ${card.color ? card.color.replace('bg-', 'border-') : 'border-slate-200'}`}
      >
        <ShapeHalf shape={card.leftShape} side="left" isConnected={false} />
        <ShapeHalf shape={card.rightShape} side="right" isConnected={false} />
        
        <div className="text-[10px] leading-tight text-center font-bold text-slate-400 uppercase tracking-widest mb-2 z-30 bg-white/90 px-2 rounded">
          {card.name}
        </div>
        <div className="text-5xl font-black text-slate-800 z-30 drop-shadow-sm">
          {card.baseValue}
        </div>
      </div>
      
      <div className="w-32 text-center flex flex-col items-center">
        <span className={`text-[9px] font-bold text-white uppercase tracking-wider mb-1 px-2 py-0.5 rounded ${card.color || 'bg-slate-700'}`}>
          {card.abilityType}
        </span>
        <div className="text-[10px] text-slate-400 font-medium italic leading-snug break-words">
          {card.description}
        </div>
      </div>
    </div>
  );
};

type FilterType = 'All' | 'Batting' | 'Pitching';

const PlayerListItem = ({
  player,
  isSelected,
  onSelect,
}: {
  player: MlbPlayer;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const dotColor = player.role === 'Batter' ? 'bg-emerald-500' : 'bg-blue-500';
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ${
        isSelected
          ? 'bg-slate-700/80 text-white shadow-inner'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold truncate">{player.name}</span>
        <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          {player.team} · {player.handedness}HB
        </span>
      </span>
    </button>
  );
};

export const CollectionScreen = ({ onClose }: { onClose: () => void }) => {
  const [filter, setFilter] = useState<FilterType>('All');
  const [search, setSearch] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const handleFilterChange = (next: FilterType) => {
    setFilter(next);
    setSelectedPlayerId(null);
  };

  const selectedPlayer = useMemo(
    () => [...BATTERS, ...PITCHERS].find((p) => p.id === selectedPlayerId) ?? null,
    [selectedPlayerId],
  );

  const filteredCards = SESSION_CARDS.filter(c => {
    if (filter !== 'All' && c.type !== filter) return false;
    if (selectedPlayer && !selectedPlayer.signatureCardIds.includes(c.id)) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.abilityType.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const battingCards = filteredCards.filter(c => c.type === 'Batting');
  const pitchingCards = filteredCards.filter(c => c.type === 'Pitching');

  const showBatters = filter === 'All' || filter === 'Batting';
  const showPitchers = filter === 'All' || filter === 'Pitching';

  return (
    <motion.div 
      className="absolute inset-0 z-50 bg-slate-900 flex flex-col font-sans pointer-events-auto"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
    >
      <header className="h-24 px-8 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">CARD COLLECTION</h1>
          <p className="text-slate-400 text-sm font-medium">View your deck and abilities</p>
        </div>
        
        <button 
          onClick={onClose}
          className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </header>

      <div className="h-16 px-8 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/50 backdrop-blur">
        <div className="flex gap-2">
          {(['All', 'Batting', 'Pitching'] as FilterType[]).map(f => (
            <button 
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${
                filter === f 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search cards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-800 text-white pl-10 pr-4 py-2 rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 border border-slate-700"
          />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
          <button
            onClick={() => setSelectedPlayerId(null)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all border ${
              selectedPlayerId === null
                ? 'bg-blue-600/20 border-blue-500/40 text-white'
                : 'bg-slate-800/40 border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-black tracking-tight">All Players</span>
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Show every card
              </span>
            </span>
          </button>

          {showBatters && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest px-3 mb-1">
                Batters
              </h3>
              {BATTERS.map((p) => (
                <PlayerListItem
                  key={p.id}
                  player={p}
                  isSelected={selectedPlayerId === p.id}
                  onSelect={() => setSelectedPlayerId(p.id)}
                />
              ))}
            </div>
          )}

          {showPitchers && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest px-3 mb-1">
                Pitchers
              </h3>
              {PITCHERS.map((p) => (
                <PlayerListItem
                  key={p.id}
                  player={p}
                  isSelected={selectedPlayerId === p.id}
                  onSelect={() => setSelectedPlayerId(p.id)}
                />
              ))}
            </div>
          )}
        </aside>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {selectedPlayer && (
            <div className="mb-6 flex items-center gap-3 text-slate-400 text-sm">
              <span>Showing signature cards for</span>
              <span className="px-3 py-1 rounded-full bg-slate-800 text-white font-bold text-xs uppercase tracking-wider">
                {selectedPlayer.name} · {selectedPlayer.team}
              </span>
            </div>
          )}

          {filter !== 'Pitching' && battingCards.length > 0 && (
            <div className="mb-12">
               <h2 className="text-xl font-black text-slate-300 uppercase mb-6 flex items-center gap-3">
                 Batting Cards
                 <div className="h-px bg-slate-800 flex-1 ml-4" />
               </h2>
               <div className="flex flex-wrap gap-6">
                  {battingCards.map(card => <CollectionCard key={card.id} card={card} />)}
               </div>
            </div>
          )}

          {filter !== 'Batting' && pitchingCards.length > 0 && (
            <div className="mb-12">
               <h2 className="text-xl font-black text-slate-300 uppercase mb-6 flex items-center gap-3">
                 Pitching Cards
                 <div className="h-px bg-slate-800 flex-1 ml-4" />
               </h2>
               <div className="flex flex-wrap gap-6">
                  {pitchingCards.map(card => <CollectionCard key={card.id} card={card} />)}
               </div>
            </div>
          )}
          
          {filteredCards.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center pt-24 text-slate-500">
              <div className="w-16 h-16 border-2 border-dashed border-slate-700 rounded-xl mb-4" />
              <p className="font-bold">No cards found matching your criteria.</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
