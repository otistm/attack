import { CardGameOverlay } from './CardGameOverlay';
import { CollectionScreen } from './CollectionScreen';
import { PlayerChoiceModal } from './PlayerChoiceModal';
import { InfoRevealOverlay } from './InfoRevealOverlay';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Layers, RotateCcw } from 'lucide-react';
import { useGameStore } from '../lib/gameStore';

const SPLASH_DURATION_MS = 3000;

export function UIOverlay() {
  const [showCollection, setShowCollection] = useState(false);
  // Splash screen on first load. `splashVisible` drives the AnimatePresence
  // exit; `cardsReady` mounts the game overlay at the SAME moment the splash
  // starts exiting so the two animations cross-fade rather than stutter-cut.
  const [splashVisible, setSplashVisible] = useState(true);
  const [cardsReady, setCardsReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSplashVisible(false);
      setCardsReady(true);
    }, SPLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

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
    revealing: 'Revealing',
    'between-at-bats': 'Result',
    'game-over': 'Game Over',
  };
  const phaseTone: Record<typeof phase, string> = {
    selecting: 'text-amber-400',
    resolving: 'text-sky-400',
    revealing: 'text-fuchsia-400',
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

      <AnimatePresence>
        {splashVisible && <IntroSplash key="intro-splash" />}
      </AnimatePresence>

      <AnimatePresence>
        {showCollection && <CollectionScreen key="collection-screen" onClose={() => setShowCollection(false)} />}
      </AnimatePresence>

      {cardsReady && <PlayerChoiceModal />}
      {cardsReady && <InfoRevealOverlay />}
      {cardsReady && <InningTransitionBanner />}
    </div>
  );
}

/**
 * Transient banner that briefly takes over the screen whenever the half-
 * inning changes (top -> bottom, or bottom -> top of the next inning).
 * Driven by watching `inning` + `half` for changes via a ref-based "previous
 * value" diff, so the banner fires once per transition without requiring a
 * dedicated event in the store. Skips the very first mount so the player
 * doesn't see "TOP OF 1ST" pop in over the splash exit.
 */
function InningTransitionBanner() {
  const inning = useGameStore((s) => s.inning);
  const half = useGameStore((s) => s.half);
  const phase = useGameStore((s) => s.phase);
  const lastSig = useRef<string | null>(null);
  const [message, setMessage] = useState<{
    title: string;
    subtitle: string;
    key: number;
  } | null>(null);

  useEffect(() => {
    const sig = `${inning}-${half}`;
    if (lastSig.current === null) {
      lastSig.current = sig;
      return;
    }
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    if (phase === 'game-over') return;
    const ordinal = ordinalSuffix(inning);
    const title = `${half === 'top' ? 'TOP' : 'BOTTOM'} OF THE ${ordinal}`;
    setMessage({ title, subtitle: 'Side Retired', key: Date.now() });
    const t = setTimeout(() => setMessage(null), 1900);
    return () => clearTimeout(t);
  }, [inning, half, phase]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message.key}
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeOut' } }}
        >
          <motion.div
            className="absolute inset-x-0 h-40 bg-gradient-to-r from-amber-600/0 via-amber-600/35 to-amber-600/0"
            initial={{ scaleX: 0.6, opacity: 0 }}
            animate={{
              scaleX: 1,
              opacity: 1,
              transition: { type: 'spring', stiffness: 200, damping: 24 },
            }}
            exit={{ scaleX: 1.1, opacity: 0, transition: { duration: 0.35 } }}
            style={{ transformOrigin: 'center' }}
          />
          <motion.div
            className="relative flex flex-col items-center gap-1 px-12 py-5 bg-slate-950/85 border-y border-amber-500/40"
            initial={{ y: -16, opacity: 0 }}
            animate={{
              y: 0,
              opacity: 1,
              transition: { type: 'spring', stiffness: 280, damping: 22 },
            }}
            exit={{ y: -16, opacity: 0, transition: { duration: 0.3 } }}
          >
            <span className="text-[10px] font-black uppercase tracking-[0.5em] text-amber-300/80">
              {message.subtitle}
            </span>
            <h2 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              {message.title}
            </h2>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ordinalSuffix(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function IntroSplash() {
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.45, ease: 'easeOut' } }}
      exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeInOut' } }}
    >
      {/* Soft radial backdrop so the headline reads on the busy stadium scene */}
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.55) 35%, rgba(15,23,42,0) 75%)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.4 } }}
        exit={{ opacity: 0, transition: { duration: 0.45, ease: 'easeInOut' } }}
      />

      <motion.div
        className="relative flex flex-col items-center gap-3 px-10"
        initial={{ scale: 0.6, y: 20, opacity: 0 }}
        animate={{
          scale: 1,
          y: 0,
          opacity: 1,
          transition: { type: 'spring', stiffness: 220, damping: 18 },
        }}
        exit={{
          scale: 1.18,
          y: -22,
          opacity: 0,
          transition: { duration: 0.45, ease: [0.4, 0, 0.6, 1] },
        }}
      >
        <span className="text-[10px] sm:text-xs font-black uppercase tracking-[0.6em] text-amber-400/80">
          Welcome to
        </span>
        <h1 className="text-5xl sm:text-7xl md:text-8xl font-black uppercase tracking-tight text-white text-center leading-none drop-shadow-[0_6px_24px_rgba(0,0,0,0.65)]">
          Let&apos;s Play{' '}
          <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 bg-clip-text text-transparent">
            Dugout!
          </span>
        </h1>
        <motion.span
          className="mt-1 text-[11px] sm:text-xs font-bold uppercase tracking-[0.4em] text-slate-300/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.35, duration: 0.4 } }}
          exit={{ opacity: 0, transition: { duration: 0.25, ease: 'easeOut' } }}
        >
          Step up to the plate
        </motion.span>
      </motion.div>
    </motion.div>
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
  // 2-way matchups (Ohtani vs Ohtani): the two seats happen to be the same
  // real player. Tag both cards so the player understands the pairing isn't
  // a bug -- and so the immersive read ("Shohei vs Shohei") gets a wink.
  const isTwoWay = batterName === pitcherName && batterTeam === pitcherTeam;
  return (
    <div className="flex items-stretch gap-3 text-[11px] uppercase tracking-wide">
      <PlayerCard
        role="At Bat"
        name={batterName}
        team={batterTeam}
        color={batterColor}
        twoWay={isTwoWay}
      />
      <div className="flex items-center text-slate-500 font-black text-xs">VS</div>
      <PlayerCard
        role="Pitching"
        name={pitcherName}
        team={pitcherTeam}
        color={pitcherColor}
        twoWay={isTwoWay}
      />
    </div>
  );
}

function PlayerCard({
  role,
  name,
  team,
  color,
  twoWay = false,
}: {
  role: string;
  name: string;
  team: string;
  color: string;
  twoWay?: boolean;
}) {
  return (
    <div className="relative flex flex-col justify-center bg-slate-800/70 border border-slate-700/80 rounded-md px-3 py-1.5 min-w-[140px]">
      <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">{role}</div>
      <div className={`font-black ${color} text-[13px] leading-tight truncate`}>{name}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] text-slate-400 font-bold tracking-widest leading-tight">{team}</span>
        {twoWay && (
          <span className="text-[8px] font-black text-amber-300 bg-amber-500/20 border border-amber-400/40 rounded px-1.5 py-0.5 tracking-widest leading-none">
            2-WAY
          </span>
        )}
      </div>
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
