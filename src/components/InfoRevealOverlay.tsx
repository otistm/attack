import { motion, AnimatePresence } from 'motion/react';
import { useMemo, useState } from 'react';
import { useGameStore, getUserSide, type PendingReveal } from '../lib/gameStore';
import { canConnect } from '../lib/connect';
import { Eye, X } from 'lucide-react';
import type { CardDefinition } from '../lib/cards';
import { SHAPE_COLORS, SHAPE_DEFAULTS, SHAPE_LABEL, type ShapeType } from './cardShapes';

/**
 * Renders the information-reveal queue. b-7 Soto Shuffle reveals the
 * pitcher's UNCOMBINED cards before lock-in; p-51 Veteran Savvy reveals the
 * full batter hand to the pitcher; p-59 Nasty Slider reveals the batter's
 * layout. The overlay is always available while there are pending reveals --
 * on the bottom-right as a stack of toggleable peek pills, clear of the
 * left-rail PlayerHero panels.
 *
 * Only reveals belonging to the user's CURRENT seat
 * (`getUserSide(state)`) are surfaced -- showing opponent-side peeks would
 * let the user see what the AI is "supposed" to know about their hand,
 * breaking the fog-of-war. When the half flips and the user changes
 * roles, the previously hidden reveals on the new seat surface
 * automatically.
 *
 * No state is mutated on view; the queue stays populated until the at-bat
 * resets so the player can re-open the peek if they want a second look.
 */
export function InfoRevealOverlay() {
  const pendingReveals = useGameStore((s) => s.pendingReveals);
  const phase = useGameStore((s) => s.phase);
  const batterHand = useGameStore((s) => s.batterHand);
  const pitcherHand = useGameStore((s) => s.pitcherHand);
  const userSide = useGameStore(getUserSide);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Filter to the user's seat. openIdx indexes the filtered list, so an
  // opponent-side reveal can never be opened even if its index would line up
  // with a user-side one in the unfiltered queue.
  const visibleReveals = useMemo(
    () => pendingReveals.filter((r) => r.forSide === userSide),
    [pendingReveals, userSide],
  );

  if (phase !== 'selecting' || visibleReveals.length === 0) return null;

  return (
    <div className="absolute right-4 bottom-44 z-40 flex flex-col items-end gap-2 pointer-events-auto sm:right-5">
      <AnimatePresence>
        {visibleReveals.map((reveal, idx) => (
          <RevealPill
            key={`${reveal.source}-${idx}`}
            reveal={reveal}
            onToggle={() => setOpenIdx(openIdx === idx ? null : idx)}
            isOpen={openIdx === idx}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {openIdx !== null && visibleReveals[openIdx] && (
          <RevealPanel
            key={`panel-${openIdx}`}
            reveal={visibleReveals[openIdx]}
            batterHand={batterHand}
            pitcherHand={pitcherHand}
            onClose={() => setOpenIdx(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RevealPill({ reveal, onToggle, isOpen }: { reveal: PendingReveal; onToggle: () => void; isOpen: boolean }) {
  const tone = reveal.forSide === 'Batting' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500';
  return (
    <motion.button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg ${tone} text-white text-[11px] font-bold uppercase tracking-widest`}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
    >
      <Eye className="w-3.5 h-3.5" />
      <span>{reveal.source}</span>
      <span className="text-[9px] opacity-75">{isOpen ? '· hide' : '· peek'}</span>
    </motion.button>
  );
}

function RevealPanel({
  reveal,
  batterHand,
  pitcherHand,
  onClose,
}: {
  reveal: PendingReveal;
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  onClose: () => void;
}) {
  const cardsToShow = computeRevealedCards(reveal, batterHand, pitcherHand);
  const title = REVEAL_TITLES[reveal.reveal];
  const subtitle = REVEAL_SUBTITLES[reveal.reveal];
  const isShapesOnly = reveal.reveal === 'signatureShapes';

  return (
    <motion.div
      className="bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl backdrop-blur p-4 w-72 max-h-[60vh] overflow-y-auto"
      initial={{ opacity: 0, x: 20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1, transition: { type: 'spring', stiffness: 240, damping: 22 } }}
      exit={{ opacity: 0, x: 20, scale: 0.95, transition: { duration: 0.16 } }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-sm font-black text-white leading-tight">{title}</div>
          <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{subtitle}</div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 -m-1">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-col gap-2 mt-3">
        {cardsToShow.length === 0 && (
          <div className="text-[11px] text-slate-500 italic py-2">No cards to reveal.</div>
        )}
        {cardsToShow.map((card, i) =>
          isShapesOnly ? (
            <SignatureShapeRow key={`${card.id}-${i}`} card={card} />
          ) : (
            <RevealedCard key={`${card.id}-${i}`} card={card} />
          ),
        )}
      </div>
    </motion.div>
  );
}

/**
 * b-121 Catcher's Eye row: shows ONLY the L/R shapes of an opponent
 * signature card. No name, no team, no value -- the catcher knows what
 * pitch shapes are coming, not who's throwing them or how strong each is.
 */
function SignatureShapeRow({ card }: { card: CardDefinition }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-md p-2">
      <ShapeBadge shape={card.leftShape} />
      <span className="text-[10px] uppercase tracking-widest text-slate-500">+</span>
      <ShapeBadge shape={card.rightShape} />
      <div className="ml-auto text-[9px] uppercase tracking-widest text-slate-500">Signature</div>
    </div>
  );
}

function ShapeBadge({ shape }: { shape: ShapeType }) {
  const def = SHAPE_DEFAULTS[shape];
  return (
    <div
      className="w-8 h-8 flex items-center justify-center"
      aria-label={SHAPE_LABEL[shape]}
      title={SHAPE_LABEL[shape]}
    >
      <div
        style={{
          width: 22 * def.baseScale,
          height: 22 * def.baseScale,
          backgroundColor: SHAPE_COLORS[shape],
          borderRadius: def.borderRadius,
          clipPath: def.clipPath,
          transform: `rotate(${def.rotate}deg)`,
        }}
      />
    </div>
  );
}

function RevealedCard({ card }: { card: CardDefinition }) {
  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-md p-2">
      <div className={`w-1 h-10 rounded-full ${card.color ?? 'bg-slate-600'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-black text-white truncate">{card.name}</div>
        <div className="text-[9px] uppercase tracking-widest text-slate-500 truncate">
          {card.abilityType === 'General Draw' ? 'General' : 'Signature'}
        </div>
      </div>
      <div className="text-2xl font-black text-amber-400 tabular-nums leading-none">{card.baseValue}</div>
    </div>
  );
}

const REVEAL_TITLES: Record<PendingReveal['reveal'], string> = {
  opponentHand: "Opponent's Full Hand",
  opponentUncombined: "Opponent's Uncombined Cards",
  opponentLayout: "Opponent's Layout",
  signatureShapes: "Pitcher's Signature Shapes",
};

const REVEAL_SUBTITLES: Record<PendingReveal['reveal'], string> = {
  opponentHand: 'all 5 cards visible',
  opponentUncombined: 'cards that cannot connect',
  opponentLayout: 'current arrangement',
  signatureShapes: 'shapes only -- no values',
};

function computeRevealedCards(
  reveal: PendingReveal,
  batterHand: CardDefinition[],
  pitcherHand: CardDefinition[],
): CardDefinition[] {
  // The "for" side gets to peek at the OPPONENT'S hand.
  const opponentHand = reveal.forSide === 'Batting' ? pitcherHand : batterHand;
  switch (reveal.reveal) {
    case 'opponentHand':
    case 'opponentLayout':
      return opponentHand;
    case 'opponentUncombined':
      return uncombinedCards(opponentHand);
    case 'signatureShapes':
      // b-121 Catcher's Eye: only signature cards' shapes are visible. Filter
      // out generals / disabled cards so the catcher's peek matches the
      // description ("the Pitcher's signature shapes").
      return opponentHand.filter(
        (c) => c.abilityType === 'Signature' && !c.disabled,
      );
  }
}

function uncombinedCards(hand: CardDefinition[]): CardDefinition[] {
  if (hand.length === 0) return [];
  // Re-run the same connection grouping the engine uses, then surface the
  // singletons so the peek mirrors what scoreHand will see.
  const groups: CardDefinition[][] = [];
  let cur: CardDefinition[] = [hand[0]];
  for (let i = 1; i < hand.length; i++) {
    if (canConnect(hand[i - 1], hand[i])) cur.push(hand[i]);
    else {
      groups.push(cur);
      cur = [hand[i]];
    }
  }
  groups.push(cur);
  return groups.filter((g) => g.length === 1).flat();
}
