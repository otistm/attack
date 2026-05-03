import { CardGameOverlay } from './CardGameOverlay';
import { CollectionScreen } from './CollectionScreen';
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Layers, RotateCcw } from 'lucide-react';
import { useGameStore } from '../lib/gameStore';

export function UIOverlay() {
  const [showCollection, setShowCollection] = useState(false);
  const inning = useGameStore((s) => s.inning);
  const half = useGameStore((s) => s.half);
  const homeScore = useGameStore((s) => s.homeScore);
  const awayScore = useGameStore((s) => s.awayScore);
  const outs = useGameStore((s) => s.outs);
  const phase = useGameStore((s) => s.phase);
  const batter = useGameStore((s) => s.batter);
  const pitcher = useGameStore((s) => s.pitcher);
  const bases = useGameStore((s) => s.bases);
  const reset = useGameStore((s) => s.reset);

  const phaseLabel: Record<typeof phase, string> = {
    selecting: 'Card Selection',
    resolving: 'Resolving',
    'between-at-bats': 'Result',
    'game-over': 'Game Over',
  };
  const phaseTone: Record<typeof phase, string> = {
    selecting: 'text-amber-400',
    resolving: 'text-sky-400',
    'between-at-bats': 'text-emerald-400',
    'game-over': 'text-rose-400',
  };

  const battingTeam = half === 'top' ? 'AWAY' : 'HOME';

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between overflow-hidden font-sans text-slate-100 z-20">

      <header className="w-full grid grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)] items-stretch gap-4 px-6 py-3 bg-slate-900/85 border-b border-slate-700 backdrop-blur-sm pointer-events-auto shadow-md">
        {/* Left: at-bat matchup */}
        <div className="flex items-center">
          <Matchup
            batterName={batter.name}
            batterTeam={batter.team}
            pitcherName={pitcher.name}
            pitcherTeam={pitcher.team}
            battingTeam={battingTeam}
          />
        </div>

        {/* Center: scoreboard */}
        <Scoreboard
          inning={inning}
          half={half}
          homeScore={homeScore}
          awayScore={awayScore}
          outs={outs}
          bases={bases}
          battingTeam={battingTeam}
        />

        {/* Right: phase + actions */}
        <div className="flex items-center justify-end gap-3">
          <div className="flex flex-col items-end pr-2">
            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Phase</span>
            <span className={`font-black uppercase tracking-tight text-base leading-tight ${phaseTone[phase]}`}>
              {phaseLabel[phase]}
            </span>
          </div>
          <button
            onClick={() => setShowCollection(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700/80 hover:bg-slate-600 rounded-md text-[11px] font-bold text-slate-200 hover:text-white transition-colors uppercase tracking-wide"
          >
            <Layers className="w-3.5 h-3.5" />
            Collection
          </button>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700/80 hover:bg-rose-600 rounded-md text-[11px] font-bold text-slate-200 hover:text-white transition-colors uppercase tracking-wide"
            title="Reset to a new game"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New Game
          </button>
        </div>
      </header>

      <CardGameOverlay />

      <AnimatePresence>
        {showCollection && <CollectionScreen key="collection-screen" onClose={() => setShowCollection(false)} />}
      </AnimatePresence>
    </div>
  );
}

interface MatchupProps {
  batterName: string;
  batterTeam: string;
  pitcherName: string;
  pitcherTeam: string;
  battingTeam: 'HOME' | 'AWAY';
}

function Matchup({ batterName, batterTeam, pitcherName, pitcherTeam, battingTeam }: MatchupProps) {
  const batterColor = battingTeam === 'HOME' ? 'text-blue-300' : 'text-rose-300';
  const pitcherColor = battingTeam === 'HOME' ? 'text-rose-300' : 'text-blue-300';
  return (
    <div className="flex items-stretch gap-3 text-[11px] uppercase tracking-wide">
      <PlayerCard role="At Bat" name={batterName} team={batterTeam} color={batterColor} />
      <div className="flex items-center text-slate-500 font-black text-xs">VS</div>
      <PlayerCard role="Pitching" name={pitcherName} team={pitcherTeam} color={pitcherColor} />
    </div>
  );
}

function PlayerCard({ role, name, team, color }: { role: string; name: string; team: string; color: string }) {
  return (
    <div className="flex flex-col justify-center bg-slate-800/70 border border-slate-700/80 rounded-md px-3 py-1.5 min-w-[140px]">
      <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">{role}</div>
      <div className={`font-black ${color} text-[13px] leading-tight truncate`}>{name}</div>
      <div className="text-[9px] text-slate-400 font-bold tracking-widest leading-tight">{team}</div>
    </div>
  );
}

interface ScoreboardProps {
  inning: number;
  half: 'top' | 'bottom';
  homeScore: number;
  awayScore: number;
  outs: number;
  bases: [boolean, boolean, boolean];
  battingTeam: 'HOME' | 'AWAY';
}

function Scoreboard({ inning, half, homeScore, awayScore, outs, bases, battingTeam }: ScoreboardProps) {
  return (
    <div className="flex items-stretch gap-px bg-slate-700 rounded-md overflow-hidden border border-slate-700 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.6)]">
      {/* Team scores */}
      <div className="bg-slate-950 px-4 py-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 items-center">
        <TeamRow label="AWAY" score={awayScore} batting={battingTeam === 'AWAY'} accent="text-rose-300" />
        <TeamRow label="HOME" score={homeScore} batting={battingTeam === 'HOME'} accent="text-blue-300" />
      </div>

      {/* Inning indicator */}
      <div className="bg-slate-950 px-4 py-1.5 flex flex-col items-center justify-center min-w-[64px]">
        <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-0.5">Inn</div>
        <div className="flex items-center gap-1.5 leading-none">
          <span className="font-mono font-black text-amber-400 text-2xl tabular-nums">{inning}</span>
          <span className={`text-amber-400 text-base leading-none ${half === 'top' ? '' : 'rotate-180'}`}>▲</span>
        </div>
      </div>

      {/* Outs */}
      <div className="bg-slate-950 px-4 py-1.5 flex flex-col items-center justify-center">
        <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">Outs</div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={
                'w-2.5 h-2.5 rounded-full ' +
                (i < outs
                  ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]'
                  : 'bg-slate-700 ring-1 ring-inset ring-slate-600')
              }
            />
          ))}
        </div>
      </div>

      {/* Bases mini-diamond */}
      <div className="bg-slate-950 px-4 py-1.5 flex flex-col items-center justify-center">
        <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">Bases</div>
        <BasesDiamond bases={bases} />
      </div>
    </div>
  );
}

function TeamRow({ label, score, batting, accent }: { label: string; score: number; batting: boolean; accent: string }) {
  return (
    <>
      <div className={`flex items-center gap-1.5 ${accent}`}>
        <span
          className={
            'w-1 h-1 rounded-full ' +
            (batting ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]' : 'bg-transparent')
          }
        />
        <span className="text-[10px] font-extrabold tracking-widest">{label}</span>
      </div>
      <div className="font-mono font-black text-2xl tabular-nums text-amber-400 text-right leading-none">{score}</div>
    </>
  );
}

function BasesDiamond({ bases }: { bases: [boolean, boolean, boolean] }) {
  const [first, second, third] = bases;
  return (
    <div className="relative w-9 h-9">
      <BaseDiamond occupied={second} className="top-0 left-1/2 -translate-x-1/2" />
      <BaseDiamond occupied={third} className="top-1/2 left-0 -translate-y-1/2" />
      <BaseDiamond occupied={first} className="top-1/2 right-0 -translate-y-1/2" />
    </div>
  );
}

function BaseDiamond({ occupied, className }: { occupied: boolean; className: string }) {
  return (
    <div
      className={
        'absolute w-2.5 h-2.5 rotate-45 ' +
        (occupied
          ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
          : 'bg-slate-700 ring-1 ring-inset ring-slate-600') +
        ' ' +
        className
      }
    />
  );
}
