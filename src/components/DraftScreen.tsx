/**
 * Pre-game auction draft screen — STADIUM EDITION (v2 layout).
 *
 * Layout shift from v1: the pool moved from a bottom strip to the *center*
 * of the screen as a 2-column grid. The reason is that the player names
 * alone don't tell you much; what matters is which 3 ability cards each
 * player brings. v1 hid those behind a click. v2 puts them on display by
 * default so users can compare ability packages side by side while bidding
 * decisions are forming.
 *
 *   +---------------------------------------------------------------+
 *   |  thin header: round X/Y + progress + team pill                |
 *   +-----------+-------------------------------------+-------------+
 *   |           |                                     |             |
 *   |  YOUR     |   POOL GRID (player + 3 ability     |  OPPONENT   |
 *   |  DUGOUT   |   cards per cell, scrollable)       |   DUGOUT    |
 *   |           |   --- OR ---                        |             |
 *   |  [BUDGET] |   AUCTION STAGE during bidding      |   [BUDGET]  |
 *   |           |                                     |             |
 *   |  slots    |                                     |   slots     |
 *   |  (price)  |                                     |   (price)   |
 *   +-----------+-------------------------------------+-------------+
 *
 * Other dials in this pass:
 *   - Big amber-LED budget display in each dugout (was a small inline tile)
 *   - Roster slots show price paid instead of tier stars (stars carried no
 *     real meaning to the player)
 *   - Pool cards omit tier stars and the abstract "value" number for the
 *     same reason
 *   - Tier glow + ribbon stay (color-coded so the tier signal is preserved
 *     visually, just without the noise text)
 *
 * AI turns still autopilot through `draftAiTick` after the visible "AI
 * thinking" delay; logic layer is untouched, just reskinned.
 */
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Coins, Crown, Hammer, Sparkles, Zap } from 'lucide-react';
import {
  type ActiveAuction,
  ARCHETYPE_LABEL,
  type DraftArchetype,
  type DraftLogEntry,
  type DraftSide,
  type DraftState,
  type PlayerTier,
  canSideBid,
  eligiblePoolForSide,
  isDraftComplete,
  maxAffordableBid,
  playerSignatureValue,
  playerTagSet,
  playerTier,
  rosterTagDistribution,
  slotsRemainingForRole,
  teamIdentityHeadline,
  totalSlotsRemaining,
} from '../lib/draft';
import { useGameStore } from '../lib/gameStore';
import { type MlbPlayer } from '../lib/players';
import { ALL_CARDS, type CardDefinition, type TagLiteral } from '../lib/cards';
import { teamPalette } from '../lib/teamColors';

const CARDS_BY_ID: Record<string, CardDefinition> = {};
for (const c of ALL_CARDS) CARDS_BY_ID[c.id] = c;

// ---- Tier visual identity ------------------------------------------------
//
// Tier is communicated through *color only* now -- we don't print "ELITE" or
// pip count anywhere user-facing. The tier still drives the glow/ring/text
// hue so a marquee player visually pops, but the abstract number / star
// pip language is gone (it confused players who reasonably asked "what does
// the count actually do?").

interface TierStyle {
  ring: string;
  text: string;
  pillBg: string;
  glow: string;
  hoverGlow: string;
  hex: string;
}

const TIER_STYLE: Record<PlayerTier, TierStyle> = {
  ELITE: {
    ring: 'ring-amber-300',
    text: 'text-amber-200',
    pillBg: 'bg-amber-400',
    glow: 'shadow-[0_0_28px_rgba(251,191,36,0.55)]',
    hoverGlow: 'hover:shadow-[0_0_38px_rgba(251,191,36,0.85)]',
    hex: '#fbbf24',
  },
  STAR: {
    ring: 'ring-pink-300',
    text: 'text-pink-200',
    pillBg: 'bg-pink-500',
    glow: 'shadow-[0_0_22px_rgba(244,114,182,0.5)]',
    hoverGlow: 'hover:shadow-[0_0_32px_rgba(244,114,182,0.8)]',
    hex: '#f472b6',
  },
  SOLID: {
    ring: 'ring-cyan-300',
    text: 'text-cyan-200',
    pillBg: 'bg-cyan-400',
    glow: 'shadow-[0_0_16px_rgba(34,211,238,0.4)]',
    hoverGlow: 'hover:shadow-[0_0_26px_rgba(34,211,238,0.7)]',
    hex: '#22d3ee',
  },
  FILLER: {
    ring: 'ring-slate-400',
    text: 'text-slate-200',
    pillBg: 'bg-slate-400',
    glow: '',
    hoverGlow: 'hover:shadow-[0_0_12px_rgba(148,163,184,0.5)]',
    hex: '#94a3b8',
  },
};

const ARCHETYPE_BLURB: Record<DraftArchetype, string> = {
  POWER: 'Stacking power-hitters and fastball arms — they want to mash.',
  SPEED: 'Hunting speedsters and off-speed deception — chaos on the bases.',
  CLUTCH: 'Loading clutch + veteran — lethal late.',
  VETERAN: 'Bullpen-first, starter heavy — the long game.',
};

const TAG_BLURB: Partial<Record<TagLiteral, string>> = {
  'power-hitter': 'Bat speed, HR threat',
  speedster: 'Steals, contact',
  clutch: 'Late-inning monster',
  lefty: 'L/L matchup edge',
  veteran: 'Multi-year proven',
  rookie: 'Recent debut',
  closer: '9th-inning bullpen',
  starter: 'Multi-inning rotation arm',
  fastball: 'Straight heat',
  'breaking-ball': 'Curve / slider movement',
  'off-speed': 'Changeup velocity drop',
};

const AI_TICK_DELAY_MS = 900;
const AI_NOMINATE_DELAY_MS = 1200;

function lastName(player: MlbPlayer): string {
  const parts = player.name.replace(/Jr\.?$/, '').replace(/Sr\.?$/, '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : player.name;
}

function firstName(player: MlbPlayer): string {
  const parts = player.name.split(/\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
}

/**
 * Find the price the user/AI paid for a roster player by walking the draft
 * log. Used to label dugout slots. Falls back to `null` if the player isn't
 * in the log yet (shouldn't happen post-award, but defensive).
 */
function priceForRosterPlayer(
  log: DraftLogEntry[],
  side: DraftSide,
  playerId: string,
): number | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.winner === side && e.player.id === playerId) return e.price;
  }
  return null;
}

// =========================================================================

export function DraftScreen() {
  const phase = useGameStore((s) => s.phase);
  const draft = useGameStore((s) => s.draft);
  const userTeam = useGameStore((s) => s.userTeam);
  const draftAiTick = useGameStore((s) => s.draftAiTick);
  const completeDraft = useGameStore((s) => s.completeDraft);

  const [aiThinking, setAiThinking] = useState(false);

  useEffect(() => {
    if (phase !== 'drafting' || !draft || draft.phase === 'complete') {
      setAiThinking(false);
      return;
    }
    let aiActs = false;
    if (draft.phase === 'nominating') {
      aiActs = draft.nominator === 'ai';
    } else if (draft.phase === 'bidding' && draft.activeAuction) {
      const a = draft.activeAuction;
      aiActs = a.highBidder !== 'ai' && !a.passed.ai;
    }
    if (!aiActs) {
      setAiThinking(false);
      return;
    }
    setAiThinking(true);
    const delay =
      draft.phase === 'nominating' ? AI_NOMINATE_DELAY_MS : AI_TICK_DELAY_MS;
    const t = setTimeout(() => {
      draftAiTick();
      setAiThinking(false);
    }, delay);
    return () => {
      clearTimeout(t);
      setAiThinking(false);
    };
  }, [draft, phase, draftAiTick]);

  if (phase !== 'drafting' || !draft) return null;

  const isComplete = draft.phase === 'complete' || isDraftComplete(draft);

  return (
    <div className="absolute inset-0 z-30 flex flex-col text-slate-100 font-sans pointer-events-auto overflow-hidden">
      <StadiumBackdrop />
      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        {isComplete ? (
          <DraftSummary
            draft={draft}
            userTeam={userTeam}
            onPlay={() => completeDraft()}
          />
        ) : (
          <>
            <ThinHeader draft={draft} userTeam={userTeam} />
            <DraftBoard draft={draft} aiThinking={aiThinking} />
          </>
        )}
      </div>
    </div>
  );
}

// ====== BACKDROP ===========================================================

function StadiumBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-b from-[#0A1F3D] via-[#143560] to-[#0F2A4D]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[85%] h-[35%] bg-[radial-gradient(ellipse_at_top,_rgba(255,236,180,0.18)_0%,_transparent_70%)]" />
      <div
        className="absolute inset-x-0 top-[10%] h-24 opacity-25"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1.5px)',
          backgroundSize: '10px 10px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_50%,_rgba(0,0,0,0.55)_100%)]" />
    </>
  );
}

// ====== THIN HEADER ========================================================
//
// One-row strip: round counter on the left, progress bar in the middle, team
// pill on the right. Sized to ~36px tall. Replaces the v1 multi-line scoreboard
// tile, which felt over-styled for what was just "we're on round 3".

function ThinHeader({
  draft,
  userTeam,
}: {
  draft: DraftState;
  userTeam: 'HOME' | 'AWAY';
}) {
  const round = draft.log.length + 1;
  const totalPicks =
    draft.requirements.batters * 2 + draft.requirements.pitchers * 2;
  const pct = Math.min(100, (draft.log.length / totalPicks) * 100);
  return (
    <header className="flex items-center gap-3 px-4 py-1.5 bg-black/45 border-b border-amber-300/15 backdrop-blur-sm">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[8px] uppercase tracking-[0.4em] text-amber-300/80 font-black">
          Round
        </span>
        <span className="font-mono font-black text-base text-amber-300 tabular-nums leading-none drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]">
          {String(round).padStart(2, '0')}
        </span>
        <span className="text-[8px] text-slate-500 font-mono">/ {totalPicks}</span>
      </div>
      <div className="flex-1 h-1 bg-black/50 rounded-full overflow-hidden ring-1 ring-amber-300/15">
        <motion.div
          className="h-full bg-gradient-to-r from-amber-400 via-pink-400 via-cyan-400 to-emerald-400"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 26 }}
        />
      </div>
      <span
        className={`px-2 py-0.5 rounded font-black tracking-widest text-[10px] uppercase ${
          userTeam === 'HOME'
            ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-300/40'
            : 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-300/40'
        }`}
      >
        Playing as {userTeam}
      </span>
    </header>
  );
}

// ====== BOARD =============================================================

function DraftBoard({
  draft,
  aiThinking,
}: {
  draft: DraftState;
  aiThinking: boolean;
}) {
  return (
    <div className="flex-1 grid grid-cols-[200px_minmax(0,1fr)_200px] gap-3 px-3 pb-3 pt-2 min-h-0 min-w-0">
      <Dugout
        draft={draft}
        side="user"
        label="YOUR DUGOUT"
        accent="emerald"
      />
      <Center draft={draft} aiThinking={aiThinking} />
      <Dugout draft={draft} side="ai" label="OPP. DUGOUT" accent="rose" />
    </div>
  );
}

function Center({ draft, aiThinking }: { draft: DraftState; aiThinking: boolean }) {
  if (draft.phase === 'bidding' && draft.activeAuction) {
    return (
      <AuctionStage
        draft={draft}
        auction={draft.activeAuction}
        aiThinking={aiThinking}
      />
    );
  }
  return <PoolGrid draft={draft} aiThinking={aiThinking} />;
}

// ====== DUGOUT ============================================================
//
// Each dugout is now organised top-to-bottom as:
//   1. Header strip (label + active dot)
//   2. BIG budget LED (focal point — animated count-down on change)
//   3. Slot counters (X/Y BAT, X/Y PIT)
//   4. Roster shelves (each slot shows team color + name + price paid)

function Dugout({
  draft,
  side,
  label,
  accent,
}: {
  draft: DraftState;
  side: DraftSide;
  label: string;
  accent: 'emerald' | 'rose';
}) {
  const roster = draft.roster[side];
  const slotBatter = slotsRemainingForRole(roster, draft.requirements, 'Batter');
  const slotPitcher = slotsRemainingForRole(
    roster,
    draft.requirements,
    'Pitcher',
  );
  const totalSlots = totalSlotsRemaining(roster, draft.requirements);
  const budget = draft.budget[side];
  const lowOnBudget = budget < 5 * Math.max(1, totalSlots);

  const accentRing =
    accent === 'emerald' ? 'ring-emerald-400/40' : 'ring-rose-400/40';
  const accentText = accent === 'emerald' ? 'text-emerald-200' : 'text-rose-200';
  const accentDot = accent === 'emerald' ? 'bg-emerald-400' : 'bg-rose-400';

  return (
    <section
      className={`relative rounded-xl bg-gradient-to-b from-[#1a2540] to-[#0e1830] ring-2 ${accentRing} flex flex-col min-h-0 overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.4)]`}
    >
      <header className="px-3 pt-2.5 pb-1.5 bg-black/30 border-b border-amber-300/15">
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${accentDot} animate-pulse shadow-[0_0_8px_currentColor]`}
          />
          <span
            className={`text-[10px] uppercase tracking-[0.3em] font-black ${accentText}`}
          >
            {label}
          </span>
        </div>
      </header>

      <BigBudgetTile budget={budget} lowOnBudget={lowOnBudget} />

      <div className="px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-slate-400 font-mono flex items-center justify-between border-b border-white/5">
        <span>
          <span className="text-slate-200 font-black">
            {draft.requirements.batters - slotBatter}
          </span>
          <span className="text-slate-500">/{draft.requirements.batters}</span>
          {' '}BAT
        </span>
        <span>
          <span className="text-slate-200 font-black">
            {draft.requirements.pitchers - slotPitcher}
          </span>
          <span className="text-slate-500">/{draft.requirements.pitchers}</span>
          {' '}PIT
        </span>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {Array.from({ length: draft.requirements.batters }).map((_, i) => {
          const player = roster.batters[i] ?? null;
          const price = player
            ? priceForRosterPlayer(draft.log, side, player.id)
            : null;
          return (
            <RosterSlot
              key={`b-${i}`}
              player={player}
              role="Batter"
              accent={accent}
              price={price}
            />
          );
        })}
        <div className="my-1 mx-1 h-px bg-amber-300/15" />
        {Array.from({ length: draft.requirements.pitchers }).map((_, i) => {
          const player = roster.pitchers[i] ?? null;
          const price = player
            ? priceForRosterPlayer(draft.log, side, player.id)
            : null;
          return (
            <RosterSlot
              key={`p-${i}`}
              player={player}
              role="Pitcher"
              accent={accent}
              price={price}
            />
          );
        })}
      </div>
    </section>
  );
}

/**
 * BIG amber-LED budget readout. Uses a Motion `useMotionValue` so the number
 * counts down rather than snap-changing — the ticker effect makes spending
 * feel weighty, especially at the moment of award. Red-pulses when budget
 * gets dangerously low so the user has a visual "ammo low" warning.
 */
function BigBudgetTile({
  budget,
  lowOnBudget,
}: {
  budget: number;
  lowOnBudget: boolean;
}) {
  const motionValue = useMotionValue(budget);
  const display = useTransform(motionValue, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(motionValue, budget, {
      duration: 0.55,
      ease: [0.32, 0.72, 0.35, 1],
    });
    return () => controls.stop();
  }, [budget, motionValue]);
  return (
    <div className="px-3 py-2.5 bg-black/45 border-b border-amber-300/10 flex flex-col items-center">
      <div className="text-[8px] uppercase tracking-[0.4em] text-amber-300/60 font-black mb-0.5 flex items-center gap-1">
        <Coins className="w-2.5 h-2.5" />
        Budget
      </div>
      <motion.div
        animate={lowOnBudget ? { scale: [1, 1.04, 1] } : { scale: 1 }}
        transition={{
          duration: 0.9,
          repeat: lowOnBudget ? Infinity : 0,
          ease: 'easeInOut',
        }}
        className="flex items-baseline gap-0.5 leading-none"
      >
        <span
          className={`text-2xl font-mono font-black tabular-nums ${
            lowOnBudget ? 'text-rose-300' : 'text-amber-200'
          } drop-shadow-[0_0_8px_currentColor]`}
        >
          $
        </span>
        <motion.span
          className={`text-5xl font-mono font-black tabular-nums leading-none ${
            lowOnBudget ? 'text-rose-300' : 'text-amber-200'
          } drop-shadow-[0_0_12px_currentColor]`}
        >
          {display}
        </motion.span>
      </motion.div>
    </div>
  );
}

function RosterSlot({
  player,
  role,
  accent,
  price,
}: {
  player: MlbPlayer | null;
  role: 'Batter' | 'Pitcher';
  accent: 'emerald' | 'rose';
  price: number | null;
}) {
  if (!player) {
    return (
      <div className="rounded-md border border-dashed border-slate-700/60 px-2 py-1.5 flex items-center justify-between text-slate-600">
        <span className="text-[9px] uppercase tracking-widest">
          {role === 'Batter' ? 'Batter' : 'Pitcher'} slot
        </span>
        <span className="text-[10px] font-mono">—</span>
      </div>
    );
  }
  const tp = teamPalette(player.team);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: accent === 'emerald' ? -20 : 20, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
      className="relative rounded-md ring-1 ring-white/10 px-2 py-1.5 flex items-center gap-2 overflow-hidden shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
      style={{
        background: `linear-gradient(90deg, ${tp.primary} 0%, ${tp.primary} 28px, rgba(15,23,42,0.92) 28px, rgba(15,23,42,0.92) 100%)`,
      }}
      title={`${player.name} (${player.team}) · ${role}${
        price !== null ? ` · paid $${price}` : ''
      }`}
    >
      <span
        className="relative w-6 h-6 -ml-1 rounded-full flex items-center justify-center text-[8px] font-black tracking-tight text-white ring-1 ring-white/40 shrink-0"
        style={{ background: tp.secondary }}
      >
        {player.team}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-black uppercase tracking-tight truncate text-white leading-tight">
          {lastName(player)}
        </div>
        <div className="text-[8px] uppercase tracking-widest text-slate-400 leading-none">
          {role === 'Batter' ? 'BAT' : 'PIT'}
        </div>
      </div>
      {price !== null && (
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-400 text-slate-900 text-[10px] font-mono font-black tabular-nums leading-none ring-1 ring-amber-200/60 shadow-[0_0_6px_rgba(251,191,36,0.5)]">
          ${price}
        </span>
      )}
    </motion.div>
  );
}

// ====== POOL GRID =========================================================
//
// Center area when nominating. Shows every still-available player as a card
// PLUS their three signature ability cards laid out beside them. The 3
// cards matter more than the player name does to bidding decisions, so they
// get the visual real estate.

function PoolGrid({
  draft,
  aiThinking,
}: {
  draft: DraftState;
  aiThinking: boolean;
}) {
  const draftNominate = useGameStore((s) => s.draftNominate);
  const isUserNominator =
    draft.phase === 'nominating' && draft.nominator === 'user';
  const eligibleForUser = useMemo(
    () => new Set(eligiblePoolForSide(draft, 'user').map((p) => p.id)),
    [draft],
  );

  const sorted = useMemo(() => {
    const tierRank: Record<PlayerTier, number> = {
      ELITE: 0,
      STAR: 1,
      SOLID: 2,
      FILLER: 3,
    };
    return [...draft.pool].sort((a, b) => {
      const ta = tierRank[playerTier(a)];
      const tb = tierRank[playerTier(b)];
      if (ta !== tb) return ta - tb;
      return playerSignatureValue(b) - playerSignatureValue(a);
    });
  }, [draft.pool]);

  const lastPick = draft.log[draft.log.length - 1];

  return (
    <section className="relative rounded-xl bg-gradient-to-b from-[#0e1830]/70 to-[#06101e]/70 ring-2 ring-amber-300/15 backdrop-blur-sm flex flex-col min-h-0 overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
      <header className="flex items-center justify-between gap-3 px-4 py-2 bg-black/30 border-b border-amber-300/10">
        <div className="flex items-baseline gap-2">
          <AnimatePresence mode="wait">
            <motion.h2
              key={isUserNominator ? 'you' : 'opp'}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18 }}
              className={`text-base font-black uppercase tracking-tight italic skew-x-[-4deg] ${
                isUserNominator
                  ? 'text-emerald-300 drop-shadow-[0_2px_8px_rgba(16,185,129,0.5)]'
                  : 'text-rose-300 drop-shadow-[0_2px_8px_rgba(244,63,94,0.4)]'
              }`}
            >
              {isUserNominator ? 'Pick a player' : 'Opp. scouting…'}
            </motion.h2>
          </AnimatePresence>
          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-black">
            {draft.pool.length} on the field
          </span>
          {!isUserNominator && aiThinking && <ThinkingDots />}
        </div>
        {lastPick && <RecapPill entry={lastPick} />}
      </header>

      <div className="flex-1 overflow-auto px-3 py-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <AnimatePresence initial={false}>
            {sorted.map((p) => {
              let disabledReason: string | null = null;
              if (draft.phase === 'bidding') {
                disabledReason = 'Auction in progress';
              } else if (!isUserNominator) {
                disabledReason = 'Opponent is on the clock';
              } else if (!eligibleForUser.has(p.id)) {
                disabledReason =
                  p.role === 'Batter'
                    ? 'No batter slot left or budget too low'
                    : 'No pitcher slot left or budget too low';
              }
              return (
                <PoolCell
                  key={p.id}
                  player={p}
                  clickable={isUserNominator && eligibleForUser.has(p.id)}
                  onClick={() => draftNominate(p.id)}
                  disabledReason={disabledReason}
                />
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function PoolCell({
  player,
  clickable,
  onClick,
  disabledReason,
}: {
  player: MlbPlayer;
  clickable: boolean;
  onClick?: () => void;
  disabledReason: string | null;
}) {
  const tier = playerTier(player);
  const tierStyle = TIER_STYLE[tier];
  const tagSet = playerTagSet(player);
  const tp = teamPalette(player.team);
  const cards = useMemo(
    () => player.signatureCardIds.map((id) => CARDS_BY_ID[id]).filter(Boolean),
    [player],
  );
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85 }}
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      whileHover={clickable ? { y: -3, scale: 1.015 } : undefined}
      whileTap={clickable ? { scale: 0.99 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      title={
        disabledReason ?? `${player.name} (${player.team}) — click to put on the block`
      }
      className={`group relative rounded-xl overflow-hidden text-left bg-gradient-to-b from-slate-900 to-slate-950 ring-2 transition-all flex flex-col ${
        clickable
          ? `${tierStyle.ring} ${tierStyle.hoverGlow} cursor-pointer`
          : 'ring-slate-700/50 opacity-80 cursor-not-allowed'
      } ${tierStyle.glow}`}
    >
      {/* Player nameplate strip across the top */}
      <div
        className="relative flex items-center gap-2 px-3 py-2 text-white"
        style={{
          background: `linear-gradient(110deg, ${tp.primary} 0%, ${tp.primary} 60%, ${tp.secondary} 100%)`,
        }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-black tracking-tight ring-2 ring-white/60 shrink-0 shadow-md"
          style={{ background: tp.secondary }}
        >
          {player.team}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[8px] uppercase tracking-[0.3em] opacity-80 leading-none font-black">
            {firstName(player)}
          </div>
          <div className="text-base font-black uppercase italic skew-x-[-3deg] leading-tight tracking-tight truncate">
            {lastName(player)}
          </div>
        </div>
        <span className="shrink-0 text-[9px] uppercase tracking-[0.2em] opacity-90 font-black">
          {player.role === 'Batter' ? 'Bat' : 'Pit'}
        </span>
      </div>
      {/* Tag chips (1 row max, very compact) */}
      <div className="px-2 pt-1.5 pb-1 flex flex-wrap gap-1">
        {[...tagSet].slice(0, 4).map((t) => (
          <span
            key={t}
            className="text-[8px] uppercase tracking-tight px-1.5 py-0.5 bg-slate-800 ring-1 ring-slate-700 text-slate-300 rounded-sm font-bold"
            title={TAG_BLURB[t] ?? t}
          >
            {t}
          </span>
        ))}
      </div>
      {/* Three ability cards laid out side by side */}
      <div className="flex gap-1.5 px-2 pb-2 pt-1">
        {cards.map((c) => (
          <MiniAbilityCard key={c.id} card={c} tierAccent={tierStyle.hex} />
        ))}
      </div>
      {clickable && (
        <div className="absolute inset-0 rounded-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-b from-white/5 to-transparent" />
      )}
    </motion.button>
  );
}

/**
 * One signature ability card. Compact baseball-card stock — cream paper,
 * italic name, value chip, description body. The tier accent is reflected
 * in the value chip so the player can quickly tell which packages are
 * marquee tier without needing tier text.
 */
function MiniAbilityCard({
  card,
  tierAccent,
}: {
  card: CardDefinition;
  tierAccent: string;
}) {
  return (
    <div
      className="flex-1 min-w-0 rounded-md bg-gradient-to-b from-amber-50 to-amber-100 ring-1 ring-amber-700/20 shadow-sm flex flex-col p-1.5 text-slate-900 leading-tight"
      title={`${card.name} (${card.baseValue}) — ${card.description}`}
    >
      <div className="flex items-start gap-1 mb-0.5">
        <div className="text-[8px] font-black uppercase italic skew-x-[-3deg] line-clamp-2 flex-1 leading-[1.1]">
          {card.name}
        </div>
        <span
          className="shrink-0 px-1 rounded text-[9px] font-mono font-black tabular-nums leading-tight text-white"
          style={{
            background: tierAccent,
            textShadow: '0 1px 1px rgba(0,0,0,0.35)',
          }}
        >
          {card.baseValue}
        </span>
      </div>
      <div className="text-[7.5px] leading-[1.2] text-slate-700 line-clamp-5 flex-1">
        {card.description}
      </div>
    </div>
  );
}

// ====== AUCTION STAGE =====================================================

function AuctionStage({
  draft,
  auction,
  aiThinking,
}: {
  draft: DraftState;
  auction: ActiveAuction;
  aiThinking: boolean;
}) {
  const draftBid = useGameStore((s) => s.draftBid);
  const draftPass = useGameStore((s) => s.draftPass);
  const player = auction.player;
  const tp = teamPalette(player.team);
  const tier = playerTier(player);
  const tierStyle = TIER_STYLE[tier];
  const userPassed = auction.passed.user;
  const userIsHigh = auction.highBidder === 'user';
  const userTotalSlots = totalSlotsRemaining(
    draft.roster.user,
    draft.requirements,
  );
  const maxBid = maxAffordableBid(draft.budget.user, userTotalSlots);
  const required = auction.currentBid + 1;
  const canRaise =
    !userPassed &&
    !userIsHigh &&
    canSideBid(draft, 'user', player) &&
    required <= maxBid;

  return (
    <section className="relative rounded-xl bg-gradient-to-b from-[#0e1830] to-[#06101e] ring-2 ring-amber-300/15 flex flex-col items-stretch px-4 py-3 min-h-0 overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[70%] h-full opacity-50"
        style={{
          background: `radial-gradient(ellipse at top, ${tp.primary}66 0%, transparent 60%)`,
        }}
      />
      <div
        className="absolute inset-x-10 top-0 h-1/2 opacity-40"
        style={{
          background: `radial-gradient(ellipse at center, ${tierStyle.hex}33 0%, transparent 70%)`,
        }}
      />

      <OnTheBlockBanner />

      <div className="relative z-10 flex-1 grid grid-rows-[auto_1fr_auto] gap-3 min-h-0 mt-1">
        <BidShowdown
          draft={draft}
          auction={auction}
          aiThinking={aiThinking}
        />
        <div className="flex items-center justify-center min-h-0">
          <NomineeCard player={player} />
        </div>
        <BidPaddleRow
          userIsHigh={userIsHigh}
          userPassed={userPassed}
          maxBid={maxBid}
          currentBid={auction.currentBid}
          required={required}
          canRaise={canRaise}
          onBid={(amount) => draftBid(amount)}
          onPass={() => draftPass()}
        />
      </div>
    </section>
  );
}

function OnTheBlockBanner() {
  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 px-6 py-1 bg-amber-400 text-slate-900 font-black uppercase tracking-[0.4em] text-[11px] rounded-b-lg shadow-[0_4px_12px_rgba(251,191,36,0.5)] flex items-center gap-2">
      <Hammer className="w-3 h-3" />
      On The Block
      <Hammer className="w-3 h-3 -scale-x-100" />
    </div>
  );
}

function BidShowdown({
  draft,
  auction,
  aiThinking,
}: {
  draft: DraftState;
  auction: ActiveAuction;
  aiThinking: boolean;
}) {
  const userIsHigh = auction.highBidder === 'user';
  const aiIsHigh = auction.highBidder === 'ai';
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <BidderPlaque
        side="user"
        label="YOU"
        budget={draft.budget.user}
        isHigh={userIsHigh}
        isThinking={false}
      />
      <CenterBidPlaque amount={auction.currentBid} />
      <BidderPlaque
        side="ai"
        label="OPPONENT"
        budget={draft.budget.ai}
        isHigh={aiIsHigh}
        isThinking={aiThinking}
      />
    </div>
  );
}

function BidderPlaque({
  side,
  label,
  budget,
  isHigh,
  isThinking,
}: {
  side: DraftSide;
  label: string;
  budget: number;
  isHigh: boolean;
  isThinking: boolean;
}) {
  const palette =
    side === 'user'
      ? {
          ring: isHigh ? 'ring-emerald-400' : 'ring-emerald-400/25',
          glow: isHigh
            ? 'shadow-[0_0_28px_rgba(52,211,153,0.55)]'
            : 'shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]',
          text: 'text-emerald-300',
          bg: 'bg-emerald-500/10',
          dot: 'bg-emerald-400',
        }
      : {
          ring: isHigh ? 'ring-rose-400' : 'ring-rose-400/25',
          glow: isHigh
            ? 'shadow-[0_0_28px_rgba(251,113,133,0.55)]'
            : 'shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)]',
          text: 'text-rose-300',
          bg: 'bg-rose-500/10',
          dot: 'bg-rose-400',
        };
  return (
    <motion.div
      animate={{ scale: isHigh ? 1.05 : 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      className={`relative rounded-lg ${palette.bg} ring-2 ${palette.ring} ${palette.glow} px-3 py-2.5 transition-all bg-black/50`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`w-1.5 h-1.5 rounded-full ${palette.dot} ${
            isHigh ? 'animate-pulse' : ''
          }`}
        />
        <span
          className={`text-[10px] uppercase tracking-[0.3em] font-black ${palette.text}`}
        >
          {label}
        </span>
        {isHigh && (
          <span
            className={`text-[8px] uppercase tracking-widest font-black ${palette.text}`}
          >
            ★ leading
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <Coins className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xl font-mono font-black text-amber-200 tabular-nums leading-none drop-shadow-[0_0_4px_rgba(251,191,36,0.4)]">
          ${budget}
        </span>
        <span className="text-[8px] uppercase tracking-widest text-slate-500">
          left
        </span>
      </div>
      {isThinking && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -bottom-2 right-2 px-2 py-0.5 rounded-full bg-slate-900 ring-1 ring-rose-400/50"
        >
          <ThinkingDots compact />
        </motion.div>
      )}
    </motion.div>
  );
}

function CenterBidPlaque({ amount }: { amount: number }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 -m-1 rounded-md bg-amber-300/20 blur-md" />
      <motion.div
        key={amount}
        initial={{ scale: 0.7, rotate: -4, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 16 }}
        className="relative bg-black/80 ring-2 ring-amber-300/50 rounded-md px-5 py-2 flex flex-col items-center shadow-[inset_0_2px_8px_rgba(0,0,0,0.8),0_0_24px_rgba(251,191,36,0.3)]"
      >
        <span className="text-[9px] uppercase tracking-[0.4em] text-amber-300/70 font-black mb-0.5">
          Top Bid
        </span>
        <span className="text-5xl font-black font-mono tracking-tighter tabular-nums text-amber-300 drop-shadow-[0_2px_12px_rgba(251,191,36,0.8)] leading-none">
          ${amount}
        </span>
      </motion.div>
    </div>
  );
}

function ThinkingDots({ compact = false }: { compact?: boolean }) {
  const size = compact ? 'w-1 h-1' : 'w-1.5 h-1.5';
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={`${size} rounded-full bg-rose-400`}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
      {!compact && (
        <span className="ml-1.5 text-[10px] uppercase tracking-widest text-rose-300 font-black">
          Scouting
        </span>
      )}
    </div>
  );
}

// ====== NOMINEE CARD =======================================================

function NomineeCard({ player }: { player: MlbPlayer }) {
  const tier = playerTier(player);
  const tierStyle = TIER_STYLE[tier];
  const tagSet = playerTagSet(player);
  const tp = teamPalette(player.team);
  const sigCards = useMemo(
    () => player.signatureCardIds.map((id) => CARDS_BY_ID[id]).filter(Boolean),
    [player],
  );
  return (
    <motion.div
      key={`nominee-${player.id}`}
      initial={{ opacity: 0, y: 30, scale: 0.85, rotateY: -25 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotateY: 0 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      className={`relative w-[320px] rounded-2xl bg-gradient-to-b from-slate-100 to-slate-300 ring-4 ${tierStyle.ring} ${tierStyle.glow} flex flex-col overflow-hidden`}
    >
      <div
        className="relative h-10 flex items-center px-3 gap-2 text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
        style={{
          background: `linear-gradient(135deg, ${tp.primary} 0%, ${tp.primary} 60%, ${tp.secondary} 100%)`,
        }}
      >
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-[8px] font-black tracking-tight ring-2 ring-white/60 shadow-md"
          style={{ background: tp.secondary, color: '#fff' }}
        >
          {player.team}
        </span>
        <span className="text-[10px] uppercase tracking-[0.35em] font-black opacity-90">
          {player.role === 'Batter' ? 'Batter' : 'Pitcher'}
        </span>
      </div>
      <div className={`relative ${tierStyle.pillBg} h-2`} />
      <div className="px-4 py-3 bg-gradient-to-b from-slate-100 to-slate-200">
        <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-black leading-none mb-0.5">
          {firstName(player)}
        </div>
        <h3 className="text-[28px] font-black uppercase italic skew-x-[-4deg] text-slate-900 leading-tight tracking-tight">
          {lastName(player)}
        </h3>
        <div className="mt-2 flex flex-wrap gap-1">
          {[...tagSet].slice(0, 5).map((t) => (
            <span
              key={t}
              className="text-[9px] uppercase tracking-tight px-1.5 py-0.5 rounded-sm ring-1 ring-slate-400 bg-white text-slate-700 font-bold"
              title={TAG_BLURB[t] ?? t}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="bg-slate-900 px-3 py-2 grid gap-1">
        <div className="text-[9px] uppercase tracking-[0.3em] text-slate-500 font-black mb-0.5">
          Signature
        </div>
        {sigCards.map((c) => (
          <div
            key={c.id}
            className="px-2 py-1 rounded bg-slate-800 ring-1 ring-slate-700/70 flex items-start gap-2"
            title={c.description}
          >
            <span
              className="shrink-0 mt-0.5 text-[10px] font-mono font-black w-5 text-center tabular-nums px-1 rounded text-white"
              style={{ background: tierStyle.hex }}
            >
              {c.baseValue}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black text-slate-100 truncate">
                {c.name}
              </div>
              <div className="text-[8px] text-slate-400 line-clamp-2 leading-tight">
                {c.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ====== BID PADDLES ========================================================

function BidPaddleRow({
  userIsHigh,
  userPassed,
  maxBid,
  currentBid,
  required,
  canRaise,
  onBid,
  onPass,
}: {
  userIsHigh: boolean;
  userPassed: boolean;
  maxBid: number;
  currentBid: number;
  required: number;
  canRaise: boolean;
  onBid: (amount: number) => void;
  onPass: () => void;
}) {
  if (userIsHigh) {
    return (
      <div className="text-center text-[12px] uppercase tracking-[0.3em] text-emerald-300 font-black flex items-center justify-center gap-2 py-3">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_currentColor]" />
        Your bid leads — opponent on the clock
      </div>
    );
  }
  if (userPassed) {
    return (
      <div className="text-center text-[12px] uppercase tracking-[0.3em] text-slate-500 italic py-3">
        You passed.
      </div>
    );
  }
  const presets = [
    { label: '+$1', amount: required, palette: 'blue' as const },
    { label: '+$5', amount: currentBid + 5, palette: 'yellow' as const },
    { label: '+$10', amount: currentBid + 10, palette: 'red' as const },
  ];
  const showAllIn = canRaise && maxBid > currentBid + 10;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-end gap-2 flex-wrap justify-center">
        {presets.map((p) => {
          const valid = canRaise && p.amount > currentBid && p.amount <= maxBid;
          return (
            <Paddle
              key={p.label}
              valid={valid}
              palette={p.palette}
              onClick={() => onBid(p.amount)}
              label={p.label}
              sub={`$${p.amount}`}
            />
          );
        })}
        {showAllIn && (
          <Paddle
            valid={canRaise && maxBid > currentBid}
            palette="gold"
            onClick={() => onBid(maxBid)}
            label="ALL-IN"
            sub={`$${maxBid}`}
          />
        )}
        <Paddle valid={true} palette="black" onClick={onPass} label="Pass" sub="" />
      </div>
      <div className="text-[9px] uppercase tracking-[0.3em] text-slate-500 font-black">
        Max bid{' '}
        <span className="text-amber-300 font-mono tabular-nums">${maxBid}</span>
      </div>
    </div>
  );
}

type PaddlePalette = 'blue' | 'yellow' | 'red' | 'gold' | 'black';

const PADDLE_STYLES: Record<
  PaddlePalette,
  { handle: string; head: string; text: string; glow: string }
> = {
  blue: {
    handle: 'bg-gradient-to-b from-blue-700 to-blue-900',
    head: 'bg-gradient-to-b from-blue-400 to-blue-600',
    text: 'text-white',
    glow: 'shadow-[0_4px_16px_rgba(59,130,246,0.5)]',
  },
  yellow: {
    handle: 'bg-gradient-to-b from-yellow-700 to-yellow-900',
    head: 'bg-gradient-to-b from-yellow-300 to-yellow-500',
    text: 'text-slate-900',
    glow: 'shadow-[0_4px_16px_rgba(234,179,8,0.5)]',
  },
  red: {
    handle: 'bg-gradient-to-b from-red-800 to-red-950',
    head: 'bg-gradient-to-b from-red-500 to-red-700',
    text: 'text-white',
    glow: 'shadow-[0_4px_16px_rgba(239,68,68,0.5)]',
  },
  gold: {
    handle: 'bg-gradient-to-b from-amber-700 to-amber-900',
    head: 'bg-gradient-to-b from-amber-300 to-amber-500',
    text: 'text-slate-900',
    glow: 'shadow-[0_6px_24px_rgba(251,191,36,0.6)]',
  },
  black: {
    handle: 'bg-gradient-to-b from-slate-700 to-slate-900',
    head: 'bg-gradient-to-b from-slate-600 to-slate-800',
    text: 'text-slate-200',
    glow: 'shadow-[0_4px_12px_rgba(0,0,0,0.5)]',
  },
};

function Paddle({
  valid,
  palette,
  onClick,
  label,
  sub,
}: {
  valid: boolean;
  palette: PaddlePalette;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  const style = PADDLE_STYLES[palette];
  return (
    <motion.button
      type="button"
      disabled={!valid}
      onClick={onClick}
      whileHover={valid ? { y: -3, rotate: -1 } : undefined}
      whileTap={valid ? { y: 2, rotate: 1, scale: 0.97 } : undefined}
      transition={{ type: 'spring', stiffness: 600, damping: 22 }}
      className={`relative flex flex-col items-center group ${
        valid ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
      }`}
    >
      <div
        className={`relative px-4 py-2 rounded-md ring-2 ring-black/40 ${style.head} ${style.glow} ${style.text} font-black uppercase tracking-widest flex flex-col items-center gap-0 leading-tight`}
      >
        <span className="text-[12px]">{label}</span>
        {sub && (
          <span className="text-[9px] font-mono opacity-80 tabular-nums">
            {sub}
          </span>
        )}
      </div>
      <div
        className={`w-2.5 h-3 -mt-px rounded-b-sm ${style.handle} ring-1 ring-black/40`}
      />
    </motion.button>
  );
}

// ====== RECAP PILL ========================================================

function RecapPill({ entry }: { entry: DraftLogEntry }) {
  const { player, winner, price } = entry;
  const tag = pickReactionTag(entry);
  const tp = teamPalette(player.team);
  return (
    <motion.div
      key={`recap-${entry.player.id}-${price}`}
      initial={{ opacity: 0, x: 12, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 20 }}
      className="flex items-center gap-2"
    >
      <span
        className={`px-2 py-0.5 rounded-md ring-1 font-black tracking-[0.2em] text-[9px] uppercase flex items-center gap-1 ${tag.bg} ${tag.ring} ${tag.text}`}
      >
        {tag.icon}
        {tag.label}
      </span>
      <span className="px-2 py-0.5 rounded-full bg-black/45 ring-1 ring-amber-300/15 flex items-center gap-1.5 text-[10px]">
        <span
          className="w-3 h-3 rounded-full ring-1 ring-white/30 shrink-0"
          style={{ background: tp.primary }}
        />
        <span className="font-black text-white uppercase tracking-tight">
          {lastName(player)}
        </span>
        <span className="text-slate-600">→</span>
        <span
          className={`font-black tracking-widest text-[9px] ${
            winner === 'user' ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {winner === 'user' ? 'YOU' : 'OPP'}
        </span>
        <span className="font-mono font-black text-amber-300 tabular-nums">
          ${price}
        </span>
      </span>
    </motion.div>
  );
}

function pickReactionTag(entry: DraftLogEntry): {
  label: string;
  icon: React.ReactNode;
  bg: string;
  ring: string;
  text: string;
} {
  const sig = playerSignatureValue(entry.player);
  const tier = playerTier(entry.player);
  if (entry.reason === 'forced-fill') {
    return {
      label: 'Bailed Out',
      icon: <Hammer className="w-3 h-3" />,
      bg: 'bg-slate-700/60',
      ring: 'ring-slate-500/40',
      text: 'text-slate-200',
    };
  }
  if (tier === 'ELITE' && entry.price >= 25) {
    return {
      label: 'Marquee Pick',
      icon: <Crown className="w-3 h-3" />,
      bg: 'bg-amber-400/30',
      ring: 'ring-amber-300/60',
      text: 'text-amber-200',
    };
  }
  if (entry.price >= sig * 1.0 && sig >= 18) {
    return {
      label: 'Paid Up',
      icon: <Coins className="w-3 h-3" />,
      bg: 'bg-rose-500/25',
      ring: 'ring-rose-400/50',
      text: 'text-rose-200',
    };
  }
  if (entry.price <= Math.max(2, sig * 0.4)) {
    return {
      label: 'Steal!',
      icon: <Zap className="w-3 h-3" />,
      bg: 'bg-emerald-500/30',
      ring: 'ring-emerald-300/60',
      text: 'text-emerald-200',
    };
  }
  return {
    label: 'Solid Move',
    icon: <Sparkles className="w-3 h-3" />,
    bg: 'bg-cyan-500/20',
    ring: 'ring-cyan-300/40',
    text: 'text-cyan-200',
  };
}

// ====== SUMMARY ============================================================

function DraftSummary({
  draft,
  userTeam,
  onPlay,
}: {
  draft: DraftState;
  userTeam: 'HOME' | 'AWAY';
  onPlay: () => void;
}) {
  const headline = teamIdentityHeadline(draft.roster.user);
  const userTags = rosterTagDistribution(draft.roster.user);
  const aiTags = rosterTagDistribution(draft.roster.ai);

  const allTags = useMemo(() => {
    const set = new Set<TagLiteral>();
    for (const t of Object.keys(userTags)) set.add(t as TagLiteral);
    for (const t of Object.keys(aiTags)) set.add(t as TagLiteral);
    return [...set].sort();
  }, [userTags, aiTags]);

  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          className="text-center mb-8"
        >
          <div className="text-[10px] uppercase tracking-[0.5em] text-amber-300 mb-1 font-black drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]">
            Draft Complete
          </div>
          <h1 className="text-6xl font-black tracking-tighter italic skew-x-[-4deg]">
            Your team is{' '}
            <span className="text-amber-300 drop-shadow-[0_2px_12px_rgba(251,191,36,0.6)]">
              {headline}
            </span>
          </h1>
          <div className="mt-3 text-sm text-slate-400">
            Opponent went{' '}
            <span className="font-black text-rose-300">
              {ARCHETYPE_LABEL[draft.aiArchetype]}
            </span>{' '}
            — {ARCHETYPE_BLURB[draft.aiArchetype]}
          </div>
        </motion.div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <SummaryRosterPanel
            label="YOUR LINEUP"
            accent="emerald"
            roster={draft.roster.user}
            budget={draft.budget.user}
            log={draft.log}
            side="user"
          />
          <SummaryRosterPanel
            label="OPPONENT"
            accent="rose"
            roster={draft.roster.ai}
            budget={draft.budget.ai}
            log={draft.log}
            side="ai"
          />
        </div>

        <div className="bg-black/40 ring-2 ring-amber-300/20 rounded-xl p-4 mb-8">
          <div className="text-[10px] uppercase tracking-[0.3em] text-amber-300 font-black mb-3">
            Tag distribution — you vs them
          </div>
          <div className="space-y-1.5">
            {allTags.map((t) => {
              const u = userTags[t] ?? 0;
              const a = aiTags[t] ?? 0;
              const max = Math.max(u, a, 1);
              return (
                <div
                  key={t}
                  className="grid grid-cols-[120px_1fr_auto] items-center gap-3"
                >
                  <span className="text-[10px] uppercase tracking-tight text-slate-300 font-black">
                    {t}
                  </span>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="flex justify-end">
                      <motion.div
                        className="h-2 bg-emerald-400 rounded-l-sm shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(u / max) * 100}%` }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                      />
                    </div>
                    <div>
                      <motion.div
                        className="h-2 bg-rose-400 rounded-r-sm shadow-[0_0_6px_rgba(251,113,133,0.6)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(a / max) * 100}%` }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] font-mono tabular-nums">
                    <span className="text-emerald-300">{u}</span>
                    <span className="text-slate-500 mx-1">/</span>
                    <span className="text-rose-300">{a}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-center">
          <motion.button
            type="button"
            onClick={onPlay}
            whileHover={{ y: -3, scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className="px-12 py-4 bg-gradient-to-b from-amber-300 to-amber-500 hover:from-amber-200 hover:to-amber-400 rounded-xl text-lg font-black uppercase tracking-[0.3em] text-slate-900 shadow-[0_8px_32px_rgba(251,191,36,0.6)]"
          >
            ⚾ Play Ball ({userTeam})
          </motion.button>
          <div className="mt-3 text-[10px] uppercase tracking-[0.3em] text-slate-500 font-black">
            First batter steps in{' '}
            {userTeam === 'AWAY' ? 'top of the 1st' : 'bottom of the 1st'}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRosterPanel({
  label,
  accent,
  roster,
  budget,
  log,
  side,
}: {
  label: string;
  accent: 'emerald' | 'rose';
  roster: { batters: MlbPlayer[]; pitchers: MlbPlayer[] };
  budget: number;
  log: DraftLogEntry[];
  side: DraftSide;
}) {
  const accentRing =
    accent === 'emerald' ? 'ring-emerald-400/40' : 'ring-rose-400/40';
  const accentText =
    accent === 'emerald' ? 'text-emerald-200' : 'text-rose-200';
  const totalSpent = log
    .filter((e) => e.winner === side)
    .reduce((s, e) => s + e.price, 0);
  return (
    <section className={`rounded-xl bg-black/40 ring-2 ${accentRing} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-[10px] uppercase tracking-[0.3em] font-black ${accentText}`}
        >
          {label}
        </span>
        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono tabular-nums">
          spent ${totalSpent} · ${budget} left
        </span>
      </div>
      <div className="space-y-2">
        <SummaryList
          title="Batters"
          players={roster.batters}
          accent={accent}
          log={log}
          side={side}
        />
        <SummaryList
          title="Pitchers"
          players={roster.pitchers}
          accent={accent}
          log={log}
          side={side}
        />
      </div>
    </section>
  );
}

function SummaryList({
  title,
  players,
  accent,
  log,
  side,
}: {
  title: string;
  players: MlbPlayer[];
  accent: 'emerald' | 'rose';
  log: DraftLogEntry[];
  side: DraftSide;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.3em] text-slate-500 mb-1 font-black">
        {title}
      </div>
      <div className="flex flex-wrap gap-1">
        {players.map((p) => {
          const tp = teamPalette(p.team);
          const price = priceForRosterPlayer(log, side, p.id);
          return (
            <span
              key={p.id}
              className={`text-[10px] px-2 py-1 rounded-md ring-1 ${
                accent === 'emerald'
                  ? 'ring-emerald-700/40 bg-emerald-500/5 text-emerald-100'
                  : 'ring-rose-700/40 bg-rose-500/5 text-rose-100'
              } flex items-center gap-1.5`}
              title={`${p.name} · ${p.team}${
                price !== null ? ` · paid $${price}` : ''
              }`}
            >
              <span
                className="w-3 h-3 rounded-full ring-1 ring-white/30 shrink-0"
                style={{ background: tp.primary }}
              />
              <span>{lastName(p)}</span>
              {price !== null && (
                <span className="text-[9px] font-mono tabular-nums text-amber-300">
                  ${price}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
