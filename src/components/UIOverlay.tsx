import { CardGameOverlay } from './CardGameOverlay';
import { ClassSelectScreen } from './ClassSelectScreen';
import { ScreenShake } from './effects/ScreenShake';
import { useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, ChevronDown } from 'lucide-react';
import { useGameStore, type Team } from '../lib/gameStore';
import { classOptionFor } from '../lib/elementClassPools';

export function UIOverlay() {
  const gameMode = useGameStore((s) => s.gameMode);
  const phase = useGameStore((s) => s.phase);
  const userTeam = useGameStore((s) => s.userTeam);
  const brawlUserClass = useGameStore((s) => s.brawlUserClass);
  const selectBrawlClass = useGameStore((s) => s.selectBrawlClass);
  const returnToClassSelect = useGameStore((s) => s.returnToClassSelect);
  const startBrawl = useGameStore((s) => s.startBrawl);
  const questShakeRequestId = useGameStore((s) => s.questShakeRequestId);
  const cardsReady = gameMode === 'brawl';
  const classSelectOpen = phase === 'class-select';

  const classSubtitle =
    brawlUserClass != null
      ? classOptionFor(brawlUserClass).mageName
      : null;

  return (
    <ScreenShake
      className="absolute inset-0 z-20 pointer-events-none"
      requestId={questShakeRequestId}
      magnitude={phase === 'game-over' ? 14 : 11}
      duration={0.42}
    >
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between overflow-hidden font-sans text-slate-100">
        {classSelectOpen ? (
          <ClassSelectScreen onSelect={selectBrawlClass} />
        ) : (
          <>
            <header className="w-full flex items-center justify-between px-6 py-3 bg-slate-900/85 border-b border-slate-700 backdrop-blur-sm pointer-events-auto shadow-md">
              <div>
                <h1 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">
                  When Things Attack
                </h1>
                {classSubtitle && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">
                    {classSubtitle}
                  </p>
                )}
              </div>
              <NewGamePicker
                onPick={(team) => startBrawl(team)}
                onReturnToClassSelect={returnToClassSelect}
                currentTeam={userTeam}
                showClassSelect
              />
            </header>

            {cardsReady && (
              <motion.div
                key="game-overlay"
                className="absolute inset-0 pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              >
                <CardGameOverlay />
              </motion.div>
            )}
          </>
        )}
      </div>
    </ScreenShake>
  );
}

function NewGamePicker({
  onPick,
  onReturnToClassSelect,
  currentTeam,
  showClassSelect,
}: {
  onPick: (team: Team) => void;
  onReturnToClassSelect: () => void;
  currentTeam: Team;
  showClassSelect: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center gap-2">
      {showClassSelect && (
        <button
          onClick={onReturnToClassSelect}
          className="px-3 py-2 bg-slate-700/80 hover:bg-slate-600 rounded-md text-[11px] font-bold text-slate-200 hover:text-white transition-colors uppercase tracking-wide"
          title="Return to class select"
        >
          Change Class
        </button>
      )}
      <div className="relative">
        {open && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-700/80 hover:bg-violet-600 rounded-md text-[11px] font-bold text-slate-200 hover:text-white transition-colors uppercase tracking-wide"
          title="Start a fresh brawl"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          New Game
          <ChevronDown
            className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {open && (
          <motion.div
            className="absolute right-0 mt-2 z-50 w-48 bg-slate-900 border border-slate-700 rounded-md shadow-2xl overflow-hidden"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { type: 'spring', stiffness: 320, damping: 24 },
            }}
          >
            <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-slate-800">
              Play as...
            </div>
            <PickerOption
              team="PLAYER"
              accent="text-emerald-300"
              hint="Bottom hand · attacks first"
              isCurrent={currentTeam === 'PLAYER'}
              onPick={() => {
                onPick('PLAYER');
                setOpen(false);
              }}
            />
            <PickerOption
              team="CPU"
              accent="text-violet-300"
              hint="Top hand · attacks second"
              isCurrent={currentTeam === 'CPU'}
              onPick={() => {
                onPick('CPU');
                setOpen(false);
              }}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}

function PickerOption({
  team,
  accent,
  hint,
  isCurrent,
  onPick,
}: {
  team: Team;
  accent: string;
  hint: string;
  isCurrent: boolean;
  onPick: () => void;
}) {
  const label = team === 'PLAYER' ? 'You' : 'CPU (mirror)';
  return (
    <button
      onClick={onPick}
      className={`w-full text-left px-3 py-2.5 hover:bg-slate-800 transition-colors border-b border-slate-800/60 last:border-0 ${
        isCurrent ? 'bg-slate-800/60' : ''
      }`}
    >
      <div className={`text-[11px] font-bold uppercase tracking-wide ${accent}`}>
        {label}
        {isCurrent && (
          <span className="ml-2 text-[9px] text-slate-500 font-normal normal-case">
            current
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>
    </button>
  );
}
