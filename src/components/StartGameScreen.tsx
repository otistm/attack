import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Calendar,
  ChevronRight,
  GraduationCap,
  Layers,
  Lock,
  Play,
  Settings,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import { useGameStore, type Team } from '../lib/gameStore';
import { BATTERS, PITCHERS, type MlbPlayer } from '../lib/players';
import { teamPalette } from '../lib/teamColors';
import { QUEST_REGISTRY, rollQuestSlate, rerollQuestSlotAt, type QuestRarity } from '../lib/quests';
import { useSznGamepad } from '../lib/useSznGamepad';

/**
 * Pre-game lane chooser. Shown on first boot (after the splash) and again on
 * the game-over screen via `setShowStartScreen(true)`. The player picks
 * between two lanes:
 *
 *   - Auction Draft -> `startDraft(team)` -> the existing DraftScreen flow.
 *   - Quick Match   -> `startQuickMatch(team)` -> random rosters dealt to
 *     both sides, skip straight into gameplay.
 *
 * Visibility is owned by `gameStore.showStartScreen` so any component can
 * open the screen (e.g. the game-over button). `startDraft` and
 * `startQuickMatch` both close it implicitly when the player commits.
 *
 * Visual language follows the supplied "DUGOUT" main-menu reference: a 3D
 * block title, ambient floating cards in the background, two stacked
 * primary buttons in the center, and a row of disabled "coming soon"
 * secondary buttons beneath. FontAwesome from the reference is replaced
 * with `lucide-react` icons; Tailwind CDN classes are replaced with the
 * project's Tailwind v4 utilities + the dugout-* class set in `index.css`.
 */
export function StartGameScreen() {
  const showStartScreen = useGameStore((s) => s.showStartScreen);
  const setShowStartScreen = useGameStore((s) => s.setShowStartScreen);
  const phase = useGameStore((s) => s.phase);
  const startDraft = useGameStore((s) => s.startDraft);
  const startQuickMatch = useGameStore((s) => s.startQuickMatch);
  const setShowBrawlRules = useGameStore((s) => s.setShowBrawlRules);
  const setShowSznTeamSelect = useGameStore((s) => s.setShowSznTeamSelect);
  const startTutorial = useGameStore((s) => s.startTutorial);

  // The screen never paints over an in-flight auction. App.tsx also gates
  // on `phase !== 'drafting'`, but we double-check here so the inline team
  // picker can't keep mounting after a lane action fires (which both flips
  // `showStartScreen` to false and -- for the auction lane -- pushes us
  // into `phase === 'drafting'`).
  const visible = showStartScreen && phase !== 'drafting';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="start-game-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.4, ease: 'easeOut' } }}
          exit={{ opacity: 0, transition: { duration: 0.25, ease: 'easeIn' } }}
          className="absolute inset-0 z-30 dugout-stadium-bg dugout-font-base text-white overflow-hidden pointer-events-auto"
          aria-modal="true"
          role="dialog"
          aria-label="Start a new game"
        >
          <AmbientLighting />
          <BackgroundCards />

          <div className="relative z-20 w-full h-full flex flex-col items-center justify-center px-4">
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center">
              <Logo />
              <MainMenu
                onAuction={(team) => startDraft(team)}
                onQuickConfirm={(team, questSlate) => startQuickMatch(team, questSlate)}
                onSzn={() => setShowSznTeamSelect(true)}
                onBrawl={() => {
                  setShowBrawlRules(true);
                  setShowStartScreen(false);
                }}
                onLearn={() => {
                  // Tutorial always plays as AWAY so the user bats in the
                  // top of the 1st -- the modal copy assumes that seat.
                  startQuickMatch('AWAY');
                  startTutorial();
                }}
              />
            </div>

            <footer className="absolute bottom-4 inset-x-0 text-center text-gray-500 text-[10px] sm:text-xs dugout-font-base tracking-[0.3em] pointer-events-none">
              <p>(c) 2026 DUGOUT - MLB CARD BATTLER</p>
            </footer>
          </div>

          <ForegroundCards />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------------
 * Logo + ambient layers
 * --------------------------------------------------------------------------- */

function AmbientLighting() {
  return (
    <>
      <div className="dugout-light-beam" style={{ left: '10%' }} />
      <div className="dugout-light-beam opacity-50" style={{ left: '30%' }} />
      <div className="dugout-light-beam dugout-light-beam-right" style={{ right: '10%' }} />
    </>
  );
}

function Logo() {
  return (
    <div className="text-center mb-10">
      <div className="flex items-center justify-center gap-4 mb-2">
        <div className="h-[2px] w-12 sm:w-16 bg-gradient-to-r from-transparent to-rose-600" />
        <span
          aria-hidden="true"
          className="text-rose-600 text-2xl"
          style={{ fontFamily: 'serif' }}
        >
          {'\u26be'}
        </span>
        <div className="h-[2px] w-12 sm:w-16 bg-gradient-to-l from-transparent to-rose-600" />
      </div>
      <h1
        data-text="DUGOUT"
        className="dugout-font-title dugout-title-3d dugout-title-shine text-5xl sm:text-7xl md:text-8xl tracking-widest m-0 leading-none select-none"
      >
        DUGOUT
      </h1>
      <h2 className="dugout-font-base text-base sm:text-xl md:text-2xl font-bold tracking-[0.3em] text-amber-300 uppercase mt-2 select-none">
        MLB Card Battler
      </h2>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Main menu controls
 * --------------------------------------------------------------------------- */

type Lane = 'auction' | 'quick' | 'szn' | 'brawl';

function QuickQuestPickerModal({
  team,
  slate,
  rerollSpent,
  onRerollSlot,
  onConfirm,
  onCancel,
}: {
  team: Team;
  slate: [string, string, string];
  rerollSpent: boolean;
  onRerollSlot: (idx: 0 | 1 | 2) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rarities: QuestRarity[] = ['common', 'rare', 'legendary'];
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center px-3 bg-black/75 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-slate-950/95 p-5 shadow-2xl dugout-font-base"
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      >
        <h3 className="dugout-font-sport text-2xl uppercase text-amber-200 text-center mb-1">
          Pick Your Run
        </h3>
        <p className="text-center text-xs text-slate-400 mb-4">
          Three quests for this {team} quick match. Re-roll{' '}
          <span className="text-amber-300 font-bold">one</span> card if you want a different objective.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {slate.map((id, i) => {
            const def = QUEST_REGISTRY[id];
            if (!def) return null;
            const rar = rarities[i] ?? 'common';
            return (
              <div
                key={`${id}-${i}`}
                className="rounded-lg border border-slate-700 bg-slate-900/90 p-3 flex flex-col gap-2"
              >
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {rar}
                </span>
                <span className="dugout-font-sport text-lg uppercase text-white leading-tight">
                  {def.title}
                </span>
                <p className="text-[10px] text-slate-400 leading-snug flex-1">{def.hint}</p>
                <button
                  type="button"
                  disabled={rerollSpent}
                  onClick={() => onRerollSlot(i as 0 | 1 | 2)}
                  className="mt-1 text-[10px] font-bold uppercase tracking-wide py-1.5 rounded border border-slate-600 text-slate-300 hover:border-amber-400 hover:text-amber-200 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Re-roll slot
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-5 justify-center">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm font-bold uppercase"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg dugout-btn-gold text-stone-900 font-black uppercase text-sm"
          >
            Start with these quests
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function MainMenu({
  onAuction,
  onQuickConfirm,
  onSzn,
  onBrawl,
  onLearn,
}: {
  onAuction: (team: Team) => void;
  onQuickConfirm: (team: Team, questSlate: string[]) => void;
  /**
   * SZN entry no longer takes an AWAY/HOME seat — picking SZN opens the
   * MLB team-selection overlay (see `SznTeamSelect`), where the user
   * chooses a franchise. The seat is always AWAY for SZN runs.
   */
  onSzn: () => void;
  /**
   * Brawl Mode entry. Single-game arena fight using the same engine as
   * Quick Match for now -- skips the AWAY/HOME team picker (the seat is
   * always AWAY so the user bats first, matching SZN convention).
   */
  onBrawl: () => void;
  onLearn: () => void;
}) {
  const [openLane, setOpenLane] = useState<Lane | null>(null);
  const [quickQuest, setQuickQuest] = useState<null | {
    team: Team;
    slate: [string, string, string];
    rerollSpent: boolean;
  }>(null);

  // Controller focus over the 5 active lane buttons (brawl / szn /
  // auction / quick / learn). Brawl Mode anchors the top of the list as
  // the newest flagship single-game lane, but SZN stays the default
  // focus (the most-finished roguelike loop) so the existing muscle
  // memory -- mash CROSS -> SZN picker -- is preserved. DPad cycles;
  // CROSS activates. The brawl / szn lanes both skip the AWAY/HOME team
  // picker so CROSS launches the lane directly. The auction / quick
  // lanes expand into a team picker — CROSS expands and CROSS again
  // picks AWAY (the first option in the picker grid). The quick lane
  // additionally opens the quest picker modal (which owns higher-
  // priority input).
  const lanes = ['brawl', 'szn', 'auction', 'quick', 'learn'] as const;
  // Default focus = index of 'szn' so the existing controller flow is
  // preserved when Brawl Mode is added above it.
  const [focus, setFocus] = useState<number>(lanes.indexOf('szn'));
  useSznGamepad({
    id: 'start-game-screen',
    priority: 10,
    enabled: quickQuest === null,
    handler: (btn) => {
      if (btn === 'DPAD_UP') setFocus((i) => Math.max(0, i - 1));
      else if (btn === 'DPAD_DOWN') setFocus((i) => Math.min(lanes.length - 1, i + 1));
      else if (btn === 'CROSS') {
        const lane = lanes[focus];
        if (lane === 'brawl') onBrawl();
        else if (lane === 'szn') onSzn();
        else if (lane === 'learn') onLearn();
        else if (lane === 'auction') onAuction('AWAY');
        else if (lane === 'quick') {
          const s = rollQuestSlate();
          setQuickQuest({
            team: 'AWAY',
            slate: [s[0]!, s[1]!, s[2]!],
            rerollSpent: false,
          });
        }
      }
    },
  });

  // Quick-match quest picker handler. CROSS confirms (starts run with
  // current slate), CIRCLE cancels, SQUARE re-rolls the focused slot
  // once. Priority 100 because it's a modal stacked over the lane
  // grid.
  const [questFocus, setQuestFocus] = useState(0);
  useSznGamepad({
    id: 'start-game-quest-picker',
    priority: 100,
    enabled: quickQuest !== null,
    handler: (btn) => {
      if (!quickQuest) return;
      if (btn === 'DPAD_LEFT') setQuestFocus((i) => Math.max(0, i - 1));
      else if (btn === 'DPAD_RIGHT') setQuestFocus((i) => Math.min(2, i + 1));
      else if (btn === 'CIRCLE') setQuickQuest(null);
      else if (btn === 'SQUARE' && !quickQuest.rerollSpent) {
        setQuickQuest({
          ...quickQuest,
          rerollSpent: true,
          slate: rerollQuestSlotAt(quickQuest.slate, questFocus as 0 | 1 | 2),
        });
      } else if (btn === 'CROSS') {
        onQuickConfirm(quickQuest.team, [...quickQuest.slate]);
        setQuickQuest(null);
      }
    },
  });

  const toggle = (lane: Lane) =>
    setOpenLane((prev) => (prev === lane ? null : lane));

  return (
    <div className="flex flex-col gap-4 w-full max-w-md">
      {/* Brawl Mode anchors the top of the list — newest flagship lane,
          a single-game arena fight built on the SZN ability + edge
          engine. Skips the AWAY/HOME picker (the seat is always AWAY,
          matching SZN convention) so CROSS launches the match
          directly. */}
      <LaneButton
        lane="brawl"
        title="Brawl Mode"
        subtitle="Single-game arena fight"
        icon={<Swords className="w-6 h-6" />}
        variant="violet"
        expanded={openLane === 'brawl'}
        focused={focus === 0}
        onHover={() => setFocus(0)}
        onToggle={() => toggle('brawl')}
        onPickTeam={() => onBrawl()}
      />
      {/* SZN Mode anchors the second slot — the flagship roguelike loop
          that skips straight into a full run instead of a single-game
          flow. Default gamepad focus lives here (see `focus` init
          above) so the existing controller muscle memory survives. */}
      <LaneButton
        lane="szn"
        title="SZN Mode"
        subtitle="Pick your franchise"
        icon={<Calendar className="w-6 h-6" />}
        variant="emerald"
        expanded={openLane === 'szn'}
        focused={focus === 1}
        onHover={() => setFocus(1)}
        onToggle={() => toggle('szn')}
        onPickTeam={() => onSzn()}
      />
      <LaneButton
        lane="auction"
        title="Victory Mode"
        subtitle="Bid and draft players"
        icon={<Trophy className="w-6 h-6" />}
        variant="red"
        expanded={openLane === 'auction'}
        focused={focus === 2}
        onHover={() => setFocus(2)}
        onToggle={() => toggle('auction')}
        onPickTeam={(team) => onAuction(team)}
      />
      <LaneButton
        lane="quick"
        title="Quick Match"
        subtitle="Skip the draft - random rosters"
        icon={<Zap className="w-6 h-6" />}
        variant="gold"
        expanded={openLane === 'quick'}
        focused={focus === 3}
        onHover={() => setFocus(3)}
        onToggle={() => toggle('quick')}
        onPickTeam={(team) => {
          const s = rollQuestSlate();
          setQuickQuest({
            team,
            slate: [s[0]!, s[1]!, s[2]!],
            rerollSpent: false,
          });
        }}
      />

      {/* Tertiary "Learn to Play" entry. Smaller and ghost-styled so it
          doesn't compete with the two primary lane buttons. Skips the
          team picker entirely (tutorial copy assumes the AWAY seat). */}
      <button
        type="button"
        onClick={onLearn}
        onMouseEnter={() => setFocus(4)}
        onFocus={() => setFocus(4)}
        className={`group w-full flex items-center justify-center gap-2 mt-1 px-4 py-3 rounded-lg border bg-slate-900/40 hover:bg-slate-800/70 transition-colors dugout-font-base text-sm font-bold uppercase tracking-widest text-amber-200 hover:text-amber-100 ${
          focus === 4
            ? 'border-amber-300 ring-2 ring-amber-400/70'
            : 'border-amber-400/40 hover:border-amber-300/70'
        }`}
      >
        <GraduationCap className="w-5 h-5" />
        Learn to Play
      </button>

      <div className="grid grid-cols-3 gap-3 mt-2">
        <DisabledMenuButton icon={<Layers className="w-5 h-5" />} label="Deck Builder" />
        <DisabledMenuButton icon={<BookOpen className="w-5 h-5" />} label="Rulebook" />
        <DisabledMenuButton icon={<Settings className="w-5 h-5" />} label="Settings" />
      </div>

      <AnimatePresence>
        {quickQuest && (
          <QuickQuestPickerModal
            key="quest-picker"
            team={quickQuest.team}
            slate={quickQuest.slate}
            rerollSpent={quickQuest.rerollSpent}
            onRerollSlot={(idx) => {
              if (quickQuest.rerollSpent) return;
              setQuickQuest({
                ...quickQuest,
                rerollSpent: true,
                slate: rerollQuestSlotAt(quickQuest.slate, idx),
              });
            }}
            onConfirm={() => {
              onQuickConfirm(quickQuest.team, [...quickQuest.slate]);
              setQuickQuest(null);
            }}
            onCancel={() => setQuickQuest(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function LaneButton({
  lane,
  title,
  subtitle,
  icon,
  variant,
  expanded,
  focused = false,
  onHover,
  onToggle,
  onPickTeam,
}: {
  lane: Lane;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  variant: 'red' | 'gold' | 'emerald' | 'violet';
  expanded: boolean;
  focused?: boolean;
  onHover?: () => void;
  onToggle: () => void;
  onPickTeam: (team: Team) => void;
}) {
  const buttonClass =
    variant === 'red'
      ? 'dugout-btn-primary text-white shadow-[0_0_20px_rgba(227,24,55,0.4)] hover:shadow-[0_0_30px_rgba(227,24,55,0.7)]'
      : variant === 'emerald'
        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_rgba(16,185,129,0.7)] transition-colors'
        : variant === 'violet'
          ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-[0_0_20px_rgba(139,92,246,0.45)] hover:shadow-[0_0_30px_rgba(139,92,246,0.7)] transition-colors'
          : 'dugout-btn-gold text-stone-900 shadow-[0_0_20px_rgba(255,215,0,0.35)] hover:shadow-[0_0_30px_rgba(255,215,0,0.6)]';
  // SZN Mode and Brawl Mode both skip the AWAY/HOME team picker -- the
  // seat distinction is meaningless to a player just committing to a
  // headline lane (SZN is an asynchronous weekend-baseball run; Brawl
  // is a one-off arena fight). Both launch with the user batting first
  // (AWAY) so the controller-first flow stays one CROSS press deep.
  const skipTeamPicker = lane === 'szn' || lane === 'brawl';
  const handleClick = () => {
    if (skipTeamPicker) {
      onPickTeam('AWAY');
      return;
    }
    onToggle();
  };
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={onHover}
        onFocus={onHover}
        aria-expanded={skipTeamPicker ? undefined : expanded}
        className={`${buttonClass} w-full py-4 px-6 rounded-xl dugout-font-sport text-2xl sm:text-3xl uppercase tracking-wider flex items-center justify-between gap-3 transition-shadow ${
          focused ? 'ring-2 ring-amber-300/90 ring-offset-2 ring-offset-slate-950' : ''
        }`}
      >
        <span className="flex items-center gap-3">
          {icon}
          <span className="flex flex-col items-start leading-tight">
            <span>{title}</span>
            <span className="text-[10px] sm:text-xs dugout-font-base font-bold tracking-widest opacity-80 normal-case">
              {subtitle}
            </span>
          </span>
        </span>
        {/* Lanes that expand into a team picker show a chevron that
            rotates to indicate "drawer opens"; lanes that jump straight
            into a run (currently SZN Mode) show a play glyph so the
            user reads the click as a commit rather than an expand. */}
        {skipTeamPicker ? (
          <Play className="w-5 h-5" />
        ) : (
          <ChevronRight
            className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && !skipTeamPicker && (
          <motion.div
            key="team-picker"
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: { duration: 0.22, ease: 'easeOut' },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { duration: 0.18, ease: 'easeIn' },
            }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-3 pt-3">
              <TeamPickerCard
                team="AWAY"
                hint="Bats first"
                onPick={() => onPickTeam('AWAY')}
              />
              <TeamPickerCard
                team="HOME"
                hint="Pitches first"
                onPick={() => onPickTeam('HOME')}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TeamPickerCard({
  team,
  hint,
  onPick,
}: {
  team: Team;
  hint: string;
  onPick: () => void;
}) {
  // AWAY/HOME aren't mapped in TEAM_COLORS (they're meta-teams, not MLB
  // franchises) -- color them by the existing tone language used elsewhere
  // in the UI: rose for AWAY, blue for HOME. Matches the header
  // NewGamePicker dropdown, so the cue stays consistent across screens.
  const accent = team === 'AWAY' ? 'rose' : 'blue';
  const textClass = team === 'AWAY' ? 'text-rose-300' : 'text-blue-300';
  const ringClass =
    accent === 'rose'
      ? 'border-rose-700/60 hover:border-rose-400 hover:bg-rose-950/40'
      : 'border-blue-700/60 hover:border-blue-400 hover:bg-blue-950/40';
  return (
    <button
      type="button"
      onClick={onPick}
      className={`group relative bg-slate-900/80 backdrop-blur-sm border-2 ${ringClass} rounded-lg px-4 py-3 transition-colors flex flex-col items-start gap-1`}
    >
      <span className="text-[9px] dugout-font-base font-black uppercase tracking-[0.3em] text-slate-500 group-hover:text-slate-300 transition-colors">
        Play as
      </span>
      <span className={`dugout-font-sport text-2xl uppercase tracking-wide ${textClass}`}>
        {team}
      </span>
      <span className="text-[10px] dugout-font-base text-slate-400 group-hover:text-slate-200 transition-colors">
        {hint}
      </span>
    </button>
  );
}

function DisabledMenuButton({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      aria-label={`${label} - coming soon`}
      className="relative bg-gray-800/50 border border-gray-700 backdrop-blur-sm w-full py-3 px-3 rounded-lg dugout-font-base font-bold text-[11px] tracking-wider uppercase flex flex-col items-center gap-1.5 text-gray-500 cursor-not-allowed select-none"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500">{icon}</span>
        <Lock className="w-3 h-3" />
      </div>
      <span>{label}</span>
      <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest text-gray-400 bg-gray-900/70 border border-gray-700">
        SOON
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Ambient cards (background + foreground)
 *
 * Reference uses external Unsplash photos; we substitute solid gradients
 * keyed off the player's own team palette so the screen still loads
 * offline and we don't ship third-party image dependencies. Each card
 * decorates with the half-shape connectors from the in-game card
 * vocabulary so the menu visually previews the play surface.
 * --------------------------------------------------------------------------- */

interface AmbientCard {
  player: MlbPlayer;
  className: string;
  badgeText: string;
  badgeBg: string;
  shapes: Array<'square' | 'circle' | 'diamond'>;
  /** 0-2: 0=blurry & faint, 2=foreground & big. */
  depth: 0 | 1 | 2;
  rotate: string;
  /** "BATTING" / "PITCHING" pill text. */
  role: string;
  rating: number;
}

function pickByName(list: MlbPlayer[], name: string): MlbPlayer | undefined {
  return list.find((p) => p.name === name);
}

function buildAmbientCards(): {
  background: AmbientCard[];
  foreground: AmbientCard[];
} {
  // Use real roster names. If a name happens to be missing from a future
  // roster trim, the optional-chained `pickByName` returns undefined and
  // we silently drop the card -- the screen never crashes.
  const ohtaniBat = pickByName(BATTERS, 'Shohei Ohtani');
  const skenes = pickByName(PITCHERS, 'Paul Skenes');
  const harper = pickByName(BATTERS, 'Bryce Harper');
  const skubal = pickByName(PITCHERS, 'Tarik Skubal');
  const judge = pickByName(BATTERS, 'Aaron Judge');
  const clase = pickByName(PITCHERS, 'Emmanuel Clase');

  const background: AmbientCard[] = [];
  const foreground: AmbientCard[] = [];

  if (ohtaniBat) {
    background.push({
      player: ohtaniBat,
      className:
        'absolute left-[12%] top-[18%] w-56 h-72 rotate-[-12deg] blur-[4px] opacity-60 dugout-anim-float-slow',
      badgeText: '9',
      badgeBg: 'bg-amber-400 text-black',
      shapes: ['circle', 'square'],
      depth: 0,
      rotate: '-12deg',
      role: 'BATTING',
      rating: 9,
    });
  }
  if (skenes) {
    background.push({
      player: skenes,
      className:
        'absolute right-[14%] top-[14%] w-56 h-72 rotate-[6deg] blur-[4px] opacity-60 dugout-anim-float-medium',
      badgeText: '9',
      badgeBg: 'bg-white text-black',
      shapes: ['square', 'diamond'],
      depth: 0,
      rotate: '6deg',
      role: 'PITCHING',
      rating: 9,
    });
  }
  if (harper) {
    background.push({
      player: harper,
      className:
        'absolute left-[5%] bottom-[10%] w-44 h-60 rotate-[12deg] blur-[3px] opacity-40 dugout-anim-float-medium',
      badgeText: '7',
      badgeBg: 'bg-white text-black',
      shapes: ['square', 'diamond'],
      depth: 0,
      rotate: '12deg',
      role: 'BATTING',
      rating: 7,
    });
  }
  if (skubal) {
    background.push({
      player: skubal,
      className:
        'absolute right-[8%] top-[42%] w-48 h-60 rotate-[-12deg] blur-[2px] opacity-50 dugout-anim-float-slow',
      badgeText: '8',
      badgeBg: 'bg-white text-black',
      shapes: ['circle', 'square'],
      depth: 1,
      rotate: '-12deg',
      role: 'PITCHING',
      rating: 8,
    });
  }
  if (judge) {
    foreground.push({
      player: judge,
      className:
        'absolute -left-[5%] -bottom-[15%] w-72 h-[24rem] rotate-[12deg] scale-110 blur-[6px] opacity-80 dugout-anim-float-medium',
      badgeText: '8',
      badgeBg: 'bg-amber-400 text-black',
      shapes: ['square', 'diamond'],
      depth: 2,
      rotate: '12deg',
      role: 'BATTING',
      rating: 8,
    });
  }
  if (clase) {
    foreground.push({
      player: clase,
      className:
        'absolute -right-[5%] -top-[15%] w-72 h-[24rem] rotate-[-12deg] scale-110 blur-[8px] opacity-70 dugout-anim-float-slow',
      badgeText: '9',
      badgeBg: 'bg-white text-black',
      shapes: ['circle', 'diamond'],
      depth: 2,
      rotate: '-12deg',
      role: 'PITCHING',
      rating: 9,
    });
  }

  return { background, foreground };
}

function BackgroundCards() {
  const { background } = buildAmbientCards();
  return (
    <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center overflow-hidden">
      {background.map((card) => (
        <AmbientCardView key={card.player.id} card={card} />
      ))}
    </div>
  );
}

function ForegroundCards() {
  const { foreground } = buildAmbientCards();
  return (
    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center overflow-hidden">
      {foreground.map((card) => (
        <AmbientCardView key={card.player.id} card={card} />
      ))}
    </div>
  );
}

function AmbientCardView({ card }: { card: AmbientCard }) {
  const palette = teamPalette(card.player.team);
  const roleAccent = card.role === 'BATTING' ? 'bg-rose-600' : 'bg-blue-600';
  return (
    <div
      className={`${card.className} rounded-xl border-2 border-white/20 p-1`}
      style={{
        background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
      }}
    >
      <div className="absolute top-2 left-2 z-10">
        <span
          className={`${roleAccent} text-white text-[10px] dugout-font-base font-bold px-2 py-0.5 rounded`}
        >
          {card.role}
        </span>
      </div>
      <div className="absolute top-2 right-2 z-10">
        <span
          className={`${card.badgeBg} dugout-font-base font-black text-base sm:text-xl rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center`}
        >
          {card.badgeText}
        </span>
      </div>

      {card.shapes[0] && (
        <div
          className={`dugout-shape-connector dugout-shape-left dugout-shape-${card.shapes[0]}`}
        />
      )}
      {card.shapes[1] && (
        <div
          className={`dugout-shape-connector dugout-shape-right dugout-shape-${card.shapes[1]}`}
        />
      )}

      <div
        className="h-full w-full rounded-lg border border-white/10 p-3 sm:p-4 flex flex-col justify-end relative overflow-hidden shadow-inner"
        style={{
          background: `linear-gradient(160deg, ${palette.primary}cc, ${palette.secondary}99 60%, #000a)`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
        <div className="relative z-10">
          <h3 className="dugout-font-sport text-3xl sm:text-5xl uppercase leading-none">
            {lastWord(card.player.name)}
          </h3>
          <p className="text-[10px] sm:text-xs text-white/70 dugout-font-base font-bold tracking-wider">
            {card.player.team}
          </p>
        </div>
      </div>
    </div>
  );
}

function lastWord(name: string): string {
  // "Bryce Harper" -> "HARPER"; works for "Acuna Jr." too because we want
  // the surname-anchor anyway -- "JR." would still read fine.
  const parts = name.replace(/[.]/g, '').trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toUpperCase();
}
