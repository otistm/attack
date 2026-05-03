import { useMemo, useState, useCallback } from 'react';
import { Reorder, motion, AnimatePresence } from 'motion/react';
import { CardDefinition } from '../lib/cards';
import { canConnect, shapeModeForSide } from '../lib/connect';
import { useGameStore } from '../lib/gameStore';
import { ConnectHint, ShapeMode, SHAPE_COLORS, SHAPE_DEFAULTS, ShapeHalfProps } from './cardShapes';

const TEXT_COLORS: Record<string, string> = {
  'bg-blue-500': 'text-blue-500',
  'bg-indigo-500': 'text-indigo-500',
  'bg-violet-500': 'text-violet-500',
  'bg-teal-500': 'text-teal-500',
  'bg-cyan-500': 'text-cyan-500',
  'bg-orange-500': 'text-orange-500',
  'bg-red-600': 'text-red-600',
  'bg-slate-500': 'text-slate-500',
  'bg-green-500': 'text-green-500',
  'bg-amber-500': 'text-amber-500',
  'bg-lime-500': 'text-lime-500',
  'bg-fuchsia-500': 'text-fuchsia-500',
  'bg-pink-500': 'text-pink-500',
  'bg-emerald-500': 'text-emerald-500',
  'bg-emerald-600': 'text-emerald-600',
  'bg-blue-600': 'text-blue-600',
  'bg-sky-500': 'text-sky-500'
};

export const ShapeHalf = ({
  shape,
  side,
  isConnected,
  compact = false,
  mode = 'normal',
  hint,
}: ShapeHalfProps) => {
  // Wildcard override: render as the emerald hexagon regardless of literal shape.
  const visualShape = mode === 'wildcard' ? 'wildcard' : shape;

  // 'blocked' edges still need to take up space so card layout matches; we
  // render a darkened nub and an X overlay so the player can see the side
  // can't combine.
  const isBlocked = mode === 'blocked';

  if (visualShape === 'none' && !isBlocked) return null;

  const { rotate, baseScale, borderRadius, clipPath } =
    SHAPE_DEFAULTS[isBlocked ? 'square' : visualShape];
  const color = isBlocked ? '#475569' /* slate-600 */ : SHAPE_COLORS[visualShape];

  // Wrapper is the visible "half" cut at the card edge. Shape is twice as wide
  // so half of it appears outside the wrapper's clip and the other half forms
  // the visible bump on the card.
  const wrapperW = compact ? 14 : 24;
  const wrapperH = compact ? 30 : 48;
  const shapeSize = compact ? 28 : 48;
  const edgeOffset = compact ? 1 : 2;
  const burstSize = compact ? 8 : 12; // diameter for the connect-burst ring

  // Hint glow color: green for allow, red for block.
  const hintColor = hint === 'allow' ? '#10b981' : hint === 'block' ? '#ef4444' : null;

  // 'picky' sides get a dashed slate outline on their shape so the player can
  // see at a glance that this edge has shape restrictions. Slate-900 reads
  // clearly against every shape color in the palette.
  const isPicky = mode === 'picky';
  const borderStyle = isPicky
    ? { border: '2.5px dashed #0f172a' /* slate-900 */ }
    : { border: '1.5px solid rgba(0,0,0,0.1)' };

  return (
    <>
      <div
        className="absolute top-1/2 -translate-y-1/2 overflow-hidden z-20 flex items-center"
        style={{
          width: `${wrapperW}px`,
          height: `${wrapperH}px`,
          [side === 'left' ? 'left' : 'right']: `-${edgeOffset}px`,
        }}
      >
          <motion.div
            className="absolute shadow-sm"
            style={{
              width: `${shapeSize}px`,
              height: `${shapeSize}px`,
              backgroundColor: color,
              borderRadius,
              clipPath,
              [side === 'left' ? 'right' : 'left']: 0,
              rotate,
              opacity: isBlocked ? 0.55 : 1,
              ...borderStyle,
            }}
            initial={{ scale: baseScale }}
            animate={
              hintColor
                ? {
                    scale: [baseScale, baseScale * 1.18, baseScale],
                    boxShadow: [
                      `0px 0px 0px ${hintColor}00`,
                      `0px 0px 14px ${hintColor}`,
                      `0px 0px 6px ${hintColor}`,
                    ],
                  }
                : isConnected
                ? {
                    scale: [baseScale, baseScale * 1.3, baseScale],
                    filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)'],
                    boxShadow: ['0px 0px 0px rgba(0,0,0,0)', `0px 0px 20px ${color}`, '0px 0px 0px rgba(0,0,0,0)']
                  }
                : { scale: baseScale, filter: 'brightness(1)', boxShadow: '0px 0px 0px rgba(0,0,0,0)' }
            }
            transition={
              hintColor
                ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.5, ease: 'easeOut' }
            }
          />

          {isBlocked && (
            // Diagonal X over the blocked edge, contained in the same wrapper
            // so it doesn't poke out beyond the card silhouette.
            <div
              className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center"
              aria-hidden
            >
              <div
                className="absolute"
                style={{
                  width: '2px',
                  height: `${wrapperH * 0.85}px`,
                  background: '#f87171', // red-400
                  transform: 'rotate(45deg)',
                  borderRadius: '2px',
                }}
              />
              <div
                className="absolute"
                style={{
                  width: '2px',
                  height: `${wrapperH * 0.85}px`,
                  background: '#f87171',
                  transform: 'rotate(-45deg)',
                  borderRadius: '2px',
                }}
              />
            </div>
          )}
      </div>

      {isConnected && !hintColor && (
         <div className={`absolute top-1/2 -translate-y-1/2 w-0 h-0 z-30 pointer-events-none
           ${side === 'left' ? 'left-0' : 'right-0'}
         `}>
           <motion.div
             className="absolute rounded-full border-4"
             style={{
               borderColor: color,
               width: `${burstSize * 4}px`,
               height: `${burstSize * 4}px`,
               top: `-${burstSize * 2}px`,
               left: `-${burstSize * 2}px`,
             }}
             initial={{ scale: 0.5, opacity: 1 }}
             animate={{ scale: 2.5, opacity: 0 }}
             transition={{ duration: 0.6, ease: "easeOut" }}
           />
           {[...Array(5)].map((_, i) => {
             const angle = (i * Math.PI * 2) / 5 + (side === 'left' ? 0.3 : 0);
             const distance = compact ? 24 : 40;
             const x = Math.cos(angle) * distance;
             const y = Math.sin(angle) * distance;
             return (
               <motion.div
                 key={i}
                 className="absolute -top-1 -left-1 w-2 h-2 rounded-full"
                 style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
                 initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                 animate={{
                   x,
                   y,
                   scale: [0, 1.5, 0],
                   opacity: [1, 1, 0]
                 }}
                 transition={{ duration: 0.6 + Math.random() * 0.2, ease: "easeOut" }}
               />
             );
           })}
         </div>
      )}
    </>
  );
};

const CardItem = ({
  card,
  isConnectedLeft,
  isConnectedRight,
  modifier,
  compact = false,
  noMargin = false,
  leftHint,
  rightHint,
}: {
  card: CardDefinition;
  isConnectedLeft: boolean;
  isConnectedRight: boolean;
  modifier?: { value: number; color?: string };
  compact?: boolean;
  // When true the card renders flush with no outer margins. Used inside the
  // pitcher flip-card where margins are owned by the parent slot instead.
  noMargin?: boolean;
  // Live drag-time can-connect hints applied to each edge.
  leftHint?: ConnectHint;
  rightHint?: ConnectHint;
}) => {
  const isConnected = isConnectedLeft || isConnectedRight;
  const displayValue = modifier?.value ?? card.baseValue;
  const valueColorClass = modifier?.color ? (TEXT_COLORS[modifier.color] || 'text-slate-800') : 'text-slate-800';
  const leftMode = shapeModeForSide(card, 'left');
  const rightMode = shapeModeForSide(card, 'right');

  // Sizing tokens that swap together for the compact pitcher-hand variant.
  // `gap` = outer gutter when NOT connected.
  // `connectedGap` = outer gutter when adjacent cards connect; 0 means cards
  // sit flush against each other so the half-shapes meet seamlessly without
  // the cards themselves overlapping.
  const sz = compact
    ? {
        card: 'w-20 h-28 rounded-lg',
        nameText: 'text-[7px]',
        playerText: 'text-[6px]',
        valueText: 'text-3xl',
        valueMargin: 'mt-2',
        gap: 4,
        connectedGap: 0,
        topPad: 'top-1',
      }
    : {
        card: 'w-32 h-44 rounded-xl',
        nameText: 'text-[9px]',
        playerText: 'text-[8px]',
        valueText: 'text-5xl',
        valueMargin: 'mt-4',
        gap: 8,
        connectedGap: 0,
        topPad: 'top-2',
      };

  return (
    <motion.div
      className={`
        relative ${sz.card} bg-white border-2 group
        flex flex-col items-center justify-center cursor-grab active:cursor-grabbing
      `}
      animate={isConnected ? {
        borderColor: ['#3b82f6', '#60a5fa', '#3b82f6'],
        boxShadow: [
          '0 0 15px rgba(59,130,246,0.4)',
          '0 0 30px rgba(59,130,246,0.8)',
          '0 0 15px rgba(59,130,246,0.4)'
        ]
      } : {
        borderColor: '#e2e8f0',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
      }}
      transition={isConnected ? {
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut"
      } : {
        duration: 0.3
      }}
      style={{
        marginLeft: noMargin ? 0 : isConnectedLeft ? `${sz.connectedGap}px` : `${sz.gap}px`,
        marginRight: noMargin ? 0 : isConnectedRight ? `${sz.connectedGap}px` : `${sz.gap}px`,
      }}
    >
      <ShapeHalf
        shape={card.leftShape}
        side="left"
        isConnected={isConnectedLeft}
        compact={compact}
        mode={leftMode}
        hint={leftHint}
      />
      <ShapeHalf
        shape={card.rightShape}
        side="right"
        isConnected={isConnectedRight}
        compact={compact}
        mode={rightMode}
        hint={rightHint}
      />

      <div className={`absolute ${sz.topPad} left-0 right-0 flex flex-col items-center z-30 px-1 text-center w-full`}>
        {card.player && (
          <div className={`${sz.playerText} font-extrabold text-slate-400 uppercase tracking-widest leading-none mb-0.5 truncate max-w-[80%]`}>
            {card.player.split(' (')[0]}
          </div>
        )}
        <div className={`${sz.nameText} leading-tight font-bold text-slate-700 uppercase tracking-wide bg-white/95 rounded px-1 py-0.5 line-clamp-2 text-center border border-slate-200 shadow-sm`} style={{ maxWidth: '70%' }}>
          {card.name}
        </div>
      </div>
      <motion.div
        key={displayValue}
        initial={{ scale: 1.5, opacity: 0.5 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 15 }}
        className={`${sz.valueText} font-black z-30 drop-shadow-sm transition-colors duration-300 ${valueColorClass} ${sz.valueMargin}`}
      >
        {displayValue}
      </motion.div>

      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-56 bg-slate-800 rounded-lg p-3 shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="text-[11px] font-black text-white uppercase tracking-tight leading-none truncate">
            {card.name}
          </div>
          <div className={`text-[9px] font-bold text-white uppercase tracking-wider px-2 py-0.5 rounded shrink-0 ${card.color || 'bg-slate-700'}`}>
            {card.abilityType}
          </div>
        </div>
        {card.player && (
          <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
            {card.player}
          </div>
        )}
        <div className="text-xs text-slate-300 font-medium leading-snug">
          {card.description}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-slate-800 rotate-45" />
      </div>
    </motion.div>
  );
};

export const CardGameOverlay = () => {
  const batterHand = useGameStore((s) => s.batterHand);
  const pitcherHand = useGameStore((s) => s.pitcherHand);
  const reorderBatter = useGameStore((s) => s.reorderBatterHand);
  const reorderPitcher = useGameStore((s) => s.reorderPitcherHand);
  const phase = useGameStore((s) => s.phase);
  const lockIn = useGameStore((s) => s.lockIn);
  const startNextAtBat = useGameStore((s) => s.startNextAtBat);
  const reset = useGameStore((s) => s.reset);
  const lastOutcome = useGameStore((s) => s.lastOutcome);
  const lastBatterScore = useGameStore((s) => s.lastBatterScore);
  const lastPitcherScore = useGameStore((s) => s.lastPitcherScore);
  const lastResultMessage = useGameStore((s) => s.lastResultMessage);
  const scoreBatterFn = useGameStore((s) => s.scoreBatter);
  const scorePitcherFn = useGameStore((s) => s.scorePitcher);
  // atBatId scopes per-card keys to a single at-bat so general-pool cards
  // shared between consecutive batters/pitchers remount cleanly (the pitcher
  // flip-back, in particular, depends on this).
  const atBatId = useGameStore((s) => s.atBatId);

  // Live score previews (re-run whenever hand reorders or phase changes).
  const batterPreview = useMemo(() => scoreBatterFn(), [scoreBatterFn, batterHand, pitcherHand, phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const pitcherPreview = useMemo(() => scorePitcherFn(), [scorePitcherFn, batterHand, pitcherHand, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSelecting = phase === 'selecting';
  const isResolved = phase === 'between-at-bats' || phase === 'game-over';

  const batterDisplayValue = isResolved ? lastBatterScore : batterPreview.maxValue;
  const pitcherDisplayValue = isResolved ? lastPitcherScore : pitcherPreview.maxValue;
  const outcomeBadgeStyle = outcomeStyle(lastOutcome);

  // When a hit just happened the camera zooms out to follow the runner. The
  // pitcher hand sits at the top of the screen and would otherwise cover the
  // outfield, so we slide the entire strip off the top of the viewport while
  // the camera is wide. A small delay before sliding off lets the player see
  // the pitcher's flipped-over cards first.
  const isHitZoomedOut =
    phase === 'between-at-bats' && lastOutcome !== null && lastOutcome !== 'out';

  return (
    <>
      {/* Pitcher hand - top of screen */}
      <motion.div
        className="absolute inset-x-0 top-24 pointer-events-none flex flex-col items-center pt-4 pb-3 bg-gradient-to-b from-slate-900/70 via-slate-900/30 to-transparent"
        initial={false}
        animate={{
          y: isHitZoomedOut ? -260 : 0,
          opacity: isHitZoomedOut ? 0 : 1,
        }}
        transition={{
          duration: 0.55,
          // Hold a beat after the flip reveal before clearing the field, then
          // snap back in immediately when the next at-bat starts.
          delay: isHitZoomedOut ? 1.4 : 0,
          ease: [0.4, 0, 0.2, 1],
        }}
      >
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          <ScorePill
            label="Pitcher"
            tone="pitcher"
            value={isSelecting ? null : pitcherDisplayValue}
            opponentModifier={isSelecting ? 0 : batterPreview.opponentModifier}
            opponentLabel="Batter debuff"
            outcomeStyle={outcomeBadgeStyle}
            compact
          />
          <FlipPitcherStrip
            hand={pitcherHand}
            modifiers={pitcherPreview.cardModifiers}
            revealed={!isSelecting}
            atBatId={atBatId}
            compact
          />
        </div>
      </motion.div>

      {/* Batter hand - bottom of screen */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none flex flex-col items-center justify-end pb-8 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent pt-32 h-80">

        <div className="pointer-events-auto flex flex-col items-center gap-4">
          <ScorePill
            label="Batter"
            tone="batter"
            value={batterDisplayValue}
            opponentModifier={pitcherPreview.opponentModifier}
            opponentLabel="Pitcher debuff"
            outcome={isResolved ? lastResultMessage : undefined}
            outcomeStyle={outcomeBadgeStyle}
          />

          <HandStrip
            hand={batterHand}
            onReorder={reorderBatter}
            modifiers={batterPreview.cardModifiers}
            disabled={!isSelecting}
            atBatId={atBatId}
            direction="bottom"
          />

          <AnimatePresence mode="wait">
            {isSelecting && (
              <motion.button
                key="lockin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={lockIn}
                className="px-12 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full shadow-lg shadow-blue-900/50 transition-all hover:scale-105 active:scale-95 text-lg uppercase tracking-wider"
              >
                Lock In
              </motion.button>
            )}
            {isResolved && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex items-center gap-3"
              >
                {phase === 'between-at-bats' ? (
                  <button
                    onClick={startNextAtBat}
                    className="px-10 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-full shadow-lg uppercase tracking-wider text-sm transition-all hover:scale-105 active:scale-95"
                  >
                    Next At-Bat
                  </button>
                ) : (
                  <button
                    onClick={reset}
                    className="px-10 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-full shadow-lg uppercase tracking-wider text-sm transition-all hover:scale-105 active:scale-95"
                  >
                    New Game
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
};

interface ScorePillProps {
  label: string;
  tone: 'batter' | 'pitcher';
  value: number | null;
  opponentModifier: number;
  opponentLabel: string;
  outcome?: string;
  outcomeStyle: string;
  compact?: boolean;
}

const ScorePill = ({ label, tone, value, opponentModifier, opponentLabel, outcome, outcomeStyle, compact = false }: ScorePillProps) => {
  const valueColor = tone === 'batter' ? 'text-blue-600' : 'text-rose-600';
  const containerSize = compact
    ? 'px-4 py-1 text-sm gap-2'
    : 'px-6 py-2 text-xl gap-4';
  return (
    <motion.div
      layout
      className={`bg-white/95 backdrop-blur rounded-full font-bold text-slate-900 shadow-xl border-2 border-white/50 flex items-center ${containerSize}`}
    >
      <span className="flex items-center gap-2">
        <span className={compact ? 'text-[10px] font-extrabold uppercase tracking-widest text-slate-500' : 'text-xs font-extrabold uppercase tracking-widest text-slate-500'}>
          {label}
        </span>
        <span className={`font-black ${valueColor} ${compact ? 'text-base' : 'text-2xl'} ${value === null ? 'opacity-40' : ''}`}>
          {value === null ? '?' : value}
        </span>
      </span>

      {opponentModifier !== 0 && (
        <span className={`bg-red-100 text-red-600 border border-red-200 rounded-md font-semibold uppercase tracking-wide ${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'}`}>
          {opponentLabel} {opponentModifier > 0 ? '+' : ''}{opponentModifier}
        </span>
      )}

      <AnimatePresence>
        {outcome && (
          <motion.span
            key={outcome}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className={`font-black uppercase tracking-widest rounded-full shadow-inner ${outcomeStyle} ${compact ? 'text-[10px] px-2.5 py-0.5' : 'text-sm px-3.5 py-1'}`}
          >
            {outcome}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

type DealDirection = 'top' | 'bottom';

// ---------------------------------------------------------------------------
// Animation orchestration shared by the batter HandStrip and the pitcher
// FlipPitcherStrip. The stagger/delay lives ONLY on the parent container's
// variants so it never bleeds into per-item drag, drop, or layout springs.
// ---------------------------------------------------------------------------
const STRIP_CONTAINER_VARIANTS = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.18 },
  },
};

function makeItemEnterVariants(fromY: number, fromRot: number) {
  return {
    hidden: { opacity: 0, y: fromY, rotate: fromRot, scale: 0.55 },
    visible: {
      opacity: 1,
      y: 0,
      rotate: 0,
      scale: 1,
      transition: { type: 'spring' as const, stiffness: 220, damping: 22 },
    },
  };
}

function makeItemExitTransition(reverseStaggerCount: number, index: number) {
  return {
    duration: 0.28,
    delay: (reverseStaggerCount - 1 - index) * 0.04,
    ease: 'easeIn' as const,
  };
}

// Snappy spring used for ALL non-stagger transitions on the cards: layout
// shifts during reorder, drop snap-back, and re-layout when neighbors arrive.
const ITEM_LAYOUT_TRANSITION = { type: 'spring' as const, stiffness: 400, damping: 32 } as const;
const ITEM_DRAG_TRANSITION = { bounceStiffness: 600, bounceDamping: 35 } as const;

interface FlipPitcherStripProps {
  hand: CardDefinition[];
  modifiers: Record<string, { value: number; color?: string }>;
  revealed: boolean;
  // Scopes per-card keys so general-pool cards shared between consecutive
  // pitchers don't bleed their flipped state from the previous at-bat.
  atBatId: number;
  compact?: boolean;
}

/**
 * Pitcher hand that always renders the real cards underneath but presents them
 * face-down until `revealed` flips to true. Cards only mount/unmount when the
 * dealt hand actually changes (between at-bats); within the same at-bat the
 * cards stay mounted and flip in place via a 3D rotateY.
 */
const FlipPitcherStrip = ({ hand, modifiers, revealed, atBatId, compact = true }: FlipPitcherStripProps) => {
  const sz = compact
    ? { card: 'w-20 h-28 rounded-lg', logo: 'text-lg', gap: 4, connectedGap: 0 }
    : { card: 'w-32 h-44 rounded-xl', logo: 'text-2xl', gap: 8, connectedGap: 0 };

  // Deal-in/out matches the batter strip's vertical fly-in but mirrored on top.
  const fromY = -180;
  const fromRot = -12;
  const itemVariants = makeItemEnterVariants(fromY, fromRot);

  return (
    <motion.div
      className="flex flex-row items-center justify-center"
      style={{ perspective: '1200px' }}
      variants={STRIP_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
    >
      <AnimatePresence initial={false}>
        {hand.map((card, index) => {
          const isConnectedLeft = index > 0 && canConnect(hand[index - 1], card);
          const isConnectedRight = index < hand.length - 1 && canConnect(card, hand[index + 1]);
          const modifier = modifiers[card.id];

          return (
            <motion.div
              key={`${atBatId}-${card.id}`}
              layout
              className={`relative ${sz.card}`}
              style={{
                marginLeft: isConnectedLeft ? `${sz.connectedGap}px` : `${sz.gap}px`,
                marginRight: isConnectedRight ? `${sz.connectedGap}px` : `${sz.gap}px`,
                transformStyle: 'preserve-3d',
              }}
              variants={itemVariants}
              exit={{
                opacity: 0,
                y: -fromY * 0.5,
                rotate: -fromRot,
                scale: 0.6,
                transition: makeItemExitTransition(hand.length, index),
              }}
              transition={ITEM_LAYOUT_TRANSITION}
            >
              {/* Inner element does the in-place flip from back -> front. */}
              <motion.div
                className="absolute inset-0"
                style={{ transformStyle: 'preserve-3d' }}
                animate={{ rotateY: revealed ? 180 : 0 }}
                transition={{
                  duration: 0.7,
                  delay: revealed ? 0.1 + index * 0.12 : 0,
                  ease: [0.4, 0, 0.2, 1],
                }}
              >
                {/* Back face (face-down card design). */}
                <div
                  className={`absolute inset-0 ${sz.card} border-2 border-slate-700 shadow-xl flex items-center justify-center overflow-hidden`}
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    background:
                      'repeating-linear-gradient(45deg, #1e293b, #1e293b 6px, #0f172a 6px, #0f172a 12px)',
                  }}
                >
                  <div className="absolute inset-1 rounded-md border border-slate-600/60" />
                  <div className={`relative font-black text-white/90 tracking-widest ${sz.logo}`}>D</div>
                  <div className="absolute bottom-1 inset-x-0 text-center text-[7px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    Dugout
                  </div>
                </div>

                {/* Front face (real CardItem). */}
                <div
                  className="absolute inset-0"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <CardItem
                    card={card}
                    isConnectedLeft={isConnectedLeft}
                    isConnectedRight={isConnectedRight}
                    modifier={modifier}
                    compact={compact}
                    noMargin
                  />
                </div>
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
};

interface HandStripProps {
  hand: CardDefinition[];
  onReorder: (cards: CardDefinition[]) => void;
  modifiers: Record<string, { value: number; color?: string }>;
  disabled?: boolean;
  // Scopes per-card keys so the same general-pool card across two batters
  // doesn't carry over reorder state from the previous at-bat.
  atBatId: number;
  compact?: boolean;
  direction?: DealDirection;
}

const HandStrip = ({ hand, onReorder, modifiers, disabled = false, atBatId, compact = false, direction = 'bottom' }: HandStripProps) => {
  // Cards fly in from the screen edge they belong to: pitcher cards drop in
  // from above, batter cards rise up from below.
  const fromY = direction === 'top' ? -180 : 180;
  const fromRot = direction === 'top' ? -12 : 12;
  const itemVariants = makeItemEnterVariants(fromY, fromRot);

  // Live drag-time can-connect feedback. While the user is dragging a card we
  // mark each side of each card with 'allow' (green) or 'block' (red) based on
  // whether the current arrangement would form a connection at that seam. Only
  // the seams that touch the dragged card light up, so the hint is focused.
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);
  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  // Pre-compute hint state for each card index when a drag is in progress.
  // Each entry is `{ left, right }` ConnectHints for the card at that index.
  const hints: Array<{ left?: ConnectHint; right?: ConnectHint }> = useMemo(() => {
    if (!draggingId) return hand.map(() => ({}));
    const dragIdx = hand.findIndex((c) => c.id === draggingId);
    if (dragIdx === -1) return hand.map(() => ({}));

    const out = hand.map(() => ({} as { left?: ConnectHint; right?: ConnectHint }));

    // Left seam of the dragged card (between dragIdx-1 and dragIdx).
    if (dragIdx > 0) {
      const ok = canConnect(hand[dragIdx - 1], hand[dragIdx]);
      const tag: ConnectHint = ok ? 'allow' : 'block';
      out[dragIdx - 1].right = tag;
      out[dragIdx].left = tag;
    }
    // Right seam of the dragged card (between dragIdx and dragIdx+1).
    if (dragIdx < hand.length - 1) {
      const ok = canConnect(hand[dragIdx], hand[dragIdx + 1]);
      const tag: ConnectHint = ok ? 'allow' : 'block';
      out[dragIdx].right = tag;
      out[dragIdx + 1].left = tag;
    }
    return out;
  }, [draggingId, hand]);

  return (
    <Reorder.Group
      axis="x"
      values={hand}
      onReorder={onReorder}
      className="flex flex-row items-center justify-center list-none p-0 m-0"
      style={{ pointerEvents: disabled ? 'none' : undefined }}
      variants={STRIP_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
    >
      <AnimatePresence initial={false}>
        {hand.map((card, index) => {
          const isConnectedLeft = index > 0 && canConnect(hand[index - 1], card);
          const isConnectedRight = index < hand.length - 1 && canConnect(card, hand[index + 1]);
          const modifier = modifiers[card.id];
          const hintForCard = hints[index];
          return (
            <Reorder.Item
              key={`${atBatId}-${card.id}`}
              value={card}
              className="relative"
              layout
              variants={itemVariants}
              exit={{
                opacity: 0,
                y: -fromY * 0.5,
                rotate: -fromRot,
                scale: 0.6,
                transition: makeItemExitTransition(hand.length, index),
              }}
              transition={ITEM_LAYOUT_TRANSITION}
              dragTransition={ITEM_DRAG_TRANSITION}
              onDragStart={() => handleDragStart(card.id)}
              onDragEnd={handleDragEnd}
            >
              <CardItem
                card={card}
                isConnectedLeft={isConnectedLeft}
                isConnectedRight={isConnectedRight}
                modifier={modifier}
                compact={compact}
                leftHint={hintForCard?.left}
                rightHint={hintForCard?.right}
              />
            </Reorder.Item>
          );
        })}
      </AnimatePresence>
    </Reorder.Group>
  );
};

function outcomeStyle(outcome: string | null): string {
  switch (outcome) {
    case 'homerun':
      return 'bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 border-2 border-amber-200';
    case 'triple':
      return 'bg-emerald-500 text-white border-2 border-emerald-300';
    case 'double':
      return 'bg-sky-500 text-white border-2 border-sky-300';
    case 'single':
      return 'bg-blue-500 text-white border-2 border-blue-300';
    case 'out':
      return 'bg-rose-600 text-white border-2 border-rose-300';
    default:
      return 'bg-slate-600 text-white';
  }
}
