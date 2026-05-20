import { CardGameOverlay } from './CardGameOverlay';
import { CollectionScreen } from './CollectionScreen';
import { PlayerChoiceModal } from './PlayerChoiceModal';
import { InfoRevealOverlay } from './InfoRevealOverlay';
import { QuestCompleteOverlay } from './QuestCompleteOverlay';
import { ScreenShake } from './effects/ScreenShake';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Calendar, Layers, LogOut, RotateCcw, ChevronDown, Trophy, Zap } from 'lucide-react';
import { useGameStore, getUserSide, type Team, type GameMode } from '../lib/gameStore';

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

  // The "Let's Play Dugout!" splash is a Quick-Match / Victory-Mode
  // beat -- the lane buttons paint the user into the Stadium scene
  // and the splash is the welcome flourish over that scene. SZN Mode
  // has its own dedicated entry surfaces (team picker overlay -> Front
  // Office) and the splash painting behind those surfaces just looks
  // like a leftover artifact (it lives at z-40, pointer-events-none,
  // so it bleeds visually behind the SZN UI but isn't interactive).
  //
  // Yank the splash the instant the user signals ANY intent to play
  // SZN Mode: either the team picker is open (`showSznTeamSelect`) OR
  // a run is already active (`sznRunActive`, set the moment they pick
  // a franchise and `startSznRun` mints a run). Together these cover
  // both halves of the SZN entry flow so the splash never paints
  // behind a SZN surface.
  const sznRunActive = useGameStore((s) => s.gameMode === 'szn' && !!s.run);
  const sznTeamPickerOpen = useGameStore((s) => s.showSznTeamSelect);
  const sznIntentActive = sznRunActive || sznTeamPickerOpen;
  useEffect(() => {
    if (!sznIntentActive) return;
    setSplashVisible(false);
    setCardsReady(true);
  }, [sznIntentActive]);

  const inning = useGameStore((s) => s.inning);
  const half = useGameStore((s) => s.half);
  const homeScore = useGameStore((s) => s.homeScore);
  const awayScore = useGameStore((s) => s.awayScore);
  const outs = useGameStore((s) => s.outs);
  const phase = useGameStore((s) => s.phase);
  const bases = useGameStore((s) => s.bases);
  const userTeam = useGameStore((s) => s.userTeam);
  const startDraft = useGameStore((s) => s.startDraft);
  const startQuickMatch = useGameStore((s) => s.startQuickMatch);
  // Which lane the player committed to. The header's "New Game" button
  // rematches in the SAME lane so locking in cards mid-quick-match doesn't
  // surprise the player by punting them into an auction draft on the next
  // tap. `null` (no lane committed yet) falls back to the auction path,
  // which matches the legacy default behavior.
  const gameMode = useGameStore((s) => s.gameMode);
  // While the Learn-to-Play tutorial is running, the header's "New Game"
  // dropdown is replaced with an "End Tutorial" button that bails the
  // walkthrough and pops the start screen back up. Subscribed here so
  // the swap is reactive without prop-drilling through the picker.
  const tutorialActive = useGameStore((s) => s.tutorialActive);
  const tutorialExit = useGameStore((s) => s.tutorialExit);
  const setShowStartScreen = useGameStore((s) => s.setShowStartScreen);
  const questShakeRequestId = useGameStore((s) => s.questShakeRequestId);
  // SZN Mode: while the user is in the Front Office (or pre-pack/pre-series
  // splash), suppress the in-game header + gameplay overlay so the screen
  // floats over an empty field. The dedicated SZN screens own that surface.
  const sznOutsideGameplay = useGameStore((s) => {
    if (s.gameMode !== 'szn' || !s.run) return false;
    if (s.run.packRipPending) return true;
    if (s.run.endState !== null) return true;
    if (s.run.day !== 'series') return true;
    if (s.run.series && !s.run.series.gameInProgress) return true;
    return false;
  });

  const phaseLabel: Record<typeof phase, string> = {
    drafting: 'Draft',
    shop: 'Shop',
    selecting: 'Card Selection',
    resolving: 'Resolving',
    revealing: 'Revealing',
    'between-at-bats': 'Result',
    'game-over': 'Game Over',
  };
  const phaseTone: Record<typeof phase, string> = {
    drafting: 'text-violet-400',
    shop: 'text-cyan-400',
    selecting: 'text-amber-400',
    resolving: 'text-sky-400',
    revealing: 'text-fuchsia-400',
    'between-at-bats': 'text-emerald-400',
    'game-over': 'text-rose-400',
  };

  const battingTeam = half === 'top' ? 'AWAY' : 'HOME';

  return (
    <ScreenShake
      className="absolute inset-0 z-20 pointer-events-none"
      requestId={questShakeRequestId}
      magnitude={phase === 'game-over' ? 14 : 11}
      duration={0.42}
    >
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between overflow-hidden font-sans text-slate-100">

      {!sznOutsideGameplay && (
      <header className="w-full grid grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)] items-stretch gap-4 px-6 py-3 bg-slate-900/85 border-b border-slate-700 backdrop-blur-sm pointer-events-auto shadow-md">
        {/* Left: game mode badge. Was previously the at-bat / pitcher
            matchup nameplate; replaced because the batter and pitcher
            identity is already carried by the left-rail PlayerHero panels
            and the top-of-screen real estate is better spent labelling
            which lane (Quick Match / Victory Mode) the player is in. */}
        <div className="flex items-center" data-tutorial="game-mode">
          <GameModeBadge gameMode={gameMode} />
        </div>

        {/* Center: scoreboard */}
        <div data-tutorial="scoreboard" className="flex">
          <Scoreboard
            inning={inning}
            half={half}
            homeScore={homeScore}
            awayScore={awayScore}
            outs={outs}
            bases={bases}
            battingTeam={battingTeam}
            userTeam={userTeam}
          />
        </div>

        {/* Right: phase + actions */}
        <div className="flex items-center justify-end gap-3">
          <div
            className="flex flex-col items-end pr-2"
            data-tutorial="phase"
          >
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
          {tutorialActive ? (
            <button
              type="button"
              onClick={() => {
                // Bail out of the walkthrough AND surface the lane
                // chooser. The in-flight quick-match game state is left
                // alone -- whichever lane the player picks next will
                // overwrite it via `startDraft` / `startQuickMatch`.
                tutorialExit();
                setShowStartScreen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/90 hover:bg-amber-500 rounded-md text-[11px] font-bold text-white transition-colors uppercase tracking-wide"
              title="Exit the tutorial and return to the Start screen"
            >
              <LogOut className="w-3.5 h-3.5" />
              End Tutorial
            </button>
          ) : gameMode !== 'szn' ? (
            // SZN suppresses the header's "New Game" picker entirely —
            // a casual click here used to silently wipe the in-flight
            // run (no confirm, no warning). The dedicated Abandon Run
            // button in RunHud is now the only entry point that ends
            // an active SZN run.
            <NewGamePicker
              onPick={(team) => {
                // Rematch in the lane the player is already in. Quick Match
                // stays Quick Match; auction Draft stays Draft; legacy null
                // falls back to the auction path.
                if (gameMode === 'quick-match') {
                  startQuickMatch(team);
                } else {
                  startDraft(team);
                }
              }}
              currentTeam={userTeam}
            />
          ) : null}
        </div>
      </header>
      )}

      {cardsReady && !sznOutsideGameplay && (
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

      {/* Splash is suppressed entirely whenever the user has expressed
          intent to play SZN Mode -- the picker overlay and the Front
          Office own that surface, and the splash painting behind
          them (z-40, pointer-events-none) reads as a leftover. The
          render-time guard is belt-and-suspenders next to the
          `useEffect` that flips `splashVisible` -- it covers the
          mount-frame race where the timer hasn't fired yet but the
          user has already clicked into the SZN lane. */}
      <AnimatePresence>
        {splashVisible && !sznIntentActive && <IntroSplash key="intro-splash" />}
      </AnimatePresence>

      <AnimatePresence>
        {showCollection && <CollectionScreen key="collection-screen" onClose={() => setShowCollection(false)} />}
      </AnimatePresence>

      {cardsReady && !sznOutsideGameplay && <PlayerChoiceModal />}
      {cardsReady && !sznOutsideGameplay && <InfoRevealOverlay />}
      {cardsReady && !sznOutsideGameplay && <InningTransitionBanner />}
    </div>
    <QuestCompleteOverlay />
    </ScreenShake>
  );
}

/**
 * Transient banner that briefly takes over the screen whenever the half-
 * inning changes (top -> bottom, or bottom -> top of the next inning).
 * Driven by watching `inning` + `half` for changes via a ref-based "previous
 * value" diff, so the banner fires once per transition without requiring a
 * dedicated event in the store. Skips the very first mount so the player
 * doesn't see "TOP OF 1ST" pop in over the splash exit.
 *
 * When the half flip also flips the user's seat (e.g. user is HOME and
 * the half goes top -> bottom: they were pitching, now they're up to
 * bat), the banner appends "YOU'RE UP TO BAT" / "YOU'RE PITCHING NOW"
 * so the role swap is unmissable -- without it, players were missing
 * that the bottom strip had become their pitcher hand.
 */
function InningTransitionBanner() {
  const inning = useGameStore((s) => s.inning);
  const half = useGameStore((s) => s.half);
  const phase = useGameStore((s) => s.phase);
  const userSide = useGameStore(getUserSide);
  const lastSig = useRef<string | null>(null);
  const [message, setMessage] = useState<{
    title: string;
    subtitle: string;
    seatCue: string | null;
    key: number;
  } | null>(null);

  useEffect(() => {
    const sig = `${inning}-${half}`;
    if (lastSig.current === null) {
      lastSig.current = sig;
      return;
    }
    if (lastSig.current === sig) return;
    // `lockIn` advances `half`/`inning` while `phase` is still `revealing`.
    // Defer the banner until reveal completes so it does not overlap the
    // scoring sequence or advance lastSig while the prior at-bat is on screen.
    if (phase === 'revealing') return;
    lastSig.current = sig;
    if (phase === 'game-over') return;
    const ordinal = ordinalSuffix(inning);
    const title = `${half === 'top' ? 'TOP' : 'BOTTOM'} OF THE ${ordinal}`;
    // Seat cue only fires on the half flip (which is the only transition
    // this banner watches), so the user always sees a side-change line
    // here. Built off `userSide` directly -- whichever role they're now
    // in, that's the cue.
    const seatCue =
      userSide === 'Batting' ? "YOU'RE UP TO BAT" : "YOU'RE PITCHING NOW";
    setMessage({ title, subtitle: 'Side Retired', seatCue, key: Date.now() });
    const t = setTimeout(() => setMessage(null), 1900);
    return () => clearTimeout(t);
  }, [inning, half, phase, userSide]);

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
            {message.seatCue && (
              <span className="text-[11px] sm:text-sm font-black uppercase tracking-[0.3em] text-amber-300 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
                {message.seatCue}
              </span>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * "New Game" entry point. Replaces the bare reset button with a small
 * dropdown so the player can pick which team they're playing AS for the
 * fresh game. Picking rematches in whichever lane the player is already
 * in (Quick Match or auction Draft) -- the parent passes a single
 * `onPick(team)` that already encodes the lane choice. The store carries
 * the team across the next New Game unless the player picks a different
 * one here.
 *
 * The current `userTeam` is highlighted in the dropdown so they can tell
 * which side they're already on without opening it twice. Closes on
 * outside-click via a transparent fullscreen catcher (no portal needed).
 */
function NewGamePicker({
  onPick,
  currentTeam,
}: {
  onPick: (team: Team) => void;
  currentTeam: Team;
}) {
  const [open, setOpen] = useState(false);
  return (
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
        className="flex items-center gap-1.5 px-3 py-2 bg-slate-700/80 hover:bg-rose-600 rounded-md text-[11px] font-bold text-slate-200 hover:text-white transition-colors uppercase tracking-wide"
        title="Start a fresh game and pick your team"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        New Game
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
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
            exit={{ opacity: 0, y: -6, scale: 0.96, transition: { duration: 0.12 } }}
          >
            <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 border-b border-slate-800">
              Play as...
            </div>
            <PickerOption
              team="AWAY"
              accent="text-rose-300"
              hint="Bats first (top of inning)"
              isCurrent={currentTeam === 'AWAY'}
              onPick={() => {
                onPick('AWAY');
                setOpen(false);
              }}
            />
            <PickerOption
              team="HOME"
              accent="text-blue-300"
              hint="Pitches first (top of inning)"
              isCurrent={currentTeam === 'HOME'}
              onPick={() => {
                onPick('HOME');
                setOpen(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
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
  return (
    <button
      onClick={onPick}
      className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors flex items-center justify-between gap-2 group"
    >
      <div className="flex flex-col">
        <span className={`text-xs font-black uppercase tracking-wider ${accent}`}>
          {team}
        </span>
        <span className="text-[9px] text-slate-500 group-hover:text-slate-400 transition-colors">
          {hint}
        </span>
      </div>
      {isCurrent && (
        <span className="text-[8px] font-black text-amber-300 bg-amber-500/20 border border-amber-400/40 rounded px-1.5 py-0.5 tracking-widest leading-none">
          CURRENT
        </span>
      )}
    </button>
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

/**
 * Compact field-view badge that names the lane the player committed to on
 * the StartGameScreen ("Victory Mode" for the auction draft, "Quick Match"
 * for the random-roster lane). Replaces the previous batter / pitcher
 * matchup nameplate that lived in the top-left of the header -- the
 * batter and pitcher identity is already carried by the left-rail
 * PlayerHero panels, so the header slot is repurposed to surface the
 * mode the player is currently in.
 *
 * Visual language mirrors the StartGameScreen lane buttons: rose accent
 * for Victory Mode (Trophy icon, matches the red lane), amber accent for
 * Quick Match (Zap icon, matches the gold lane). When `gameMode` is
 * `null` (initial boot before a lane is committed; legacy reset state)
 * we fall back to a neutral "Match" label rather than rendering an empty
 * badge, so the slot never collapses to whitespace mid-screen.
 */
function GameModeBadge({ gameMode }: { gameMode: GameMode }) {
  const config: { label: string; icon: React.ReactNode; accent: string; iconColor: string } =
    gameMode === 'quick-match'
      ? {
          label: 'Quick Match',
          icon: <Zap className="w-4 h-4" />,
          accent: 'from-amber-500/90 to-amber-600/90',
          iconColor: 'text-amber-300',
        }
      : gameMode === 'draft'
      ? {
          label: 'Victory Mode',
          icon: <Trophy className="w-4 h-4" />,
          accent: 'from-rose-600/90 to-rose-700/90',
          iconColor: 'text-rose-300',
        }
      : gameMode === 'szn'
      ? {
          label: 'SZN Mode',
          icon: <Calendar className="w-4 h-4" />,
          accent: 'from-emerald-600/90 to-emerald-700/90',
          iconColor: 'text-emerald-300',
        }
      : {
          label: 'Match',
          icon: <Trophy className="w-4 h-4" />,
          accent: 'from-slate-600/90 to-slate-700/90',
          iconColor: 'text-slate-300',
        };

  return (
    <div className="relative flex flex-col bg-slate-800/70 border border-slate-700/80 rounded-md overflow-hidden min-w-[180px] shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
      <div className={`flex items-center gap-1.5 px-2 py-1 text-white bg-gradient-to-r ${config.accent}`}>
        <span className={`shrink-0 ${config.iconColor}`}>{config.icon}</span>
        <span className="text-[8px] font-black uppercase tracking-[0.2em] opacity-90">
          Game Mode
        </span>
      </div>
      <div className="px-3 py-1.5">
        <div className="font-black text-white text-[13px] leading-tight truncate uppercase tracking-wide">
          {config.label}
        </div>
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
  userTeam: Team;
}

function Scoreboard({ inning, half, homeScore, awayScore, outs, bases, battingTeam, userTeam }: ScoreboardProps) {
  return (
    <div className="flex items-stretch gap-px bg-slate-700 rounded-md overflow-hidden border border-slate-700 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.6)]">
      {/* Team scores */}
      <div className="bg-slate-950 px-4 py-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 items-center">
        <TeamRow
          label="AWAY"
          score={awayScore}
          batting={battingTeam === 'AWAY'}
          accent="text-rose-300"
          isUser={userTeam === 'AWAY'}
        />
        <TeamRow
          label="HOME"
          score={homeScore}
          batting={battingTeam === 'HOME'}
          accent="text-blue-300"
          isUser={userTeam === 'HOME'}
        />
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

function TeamRow({
  label,
  score,
  batting,
  accent,
  isUser,
}: {
  label: string;
  score: number;
  batting: boolean;
  accent: string;
  isUser: boolean;
}) {
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
        {isUser && (
          <span
            className="text-[7px] font-black tracking-[0.2em] text-amber-300 bg-amber-500/15 border border-amber-400/40 rounded px-1 leading-none"
            title="This is your team"
          >
            YOU
          </span>
        )}
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
