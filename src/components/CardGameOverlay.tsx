import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Reorder, motion, AnimatePresence } from 'motion/react';
import { CardDefinition } from '../lib/cards';
import { canConnect, shapeModeForSide, seamKey } from '../lib/connect';
import { useGameStore, getUserSide, ResolutionBeat, Phase } from '../lib/gameStore';
import { HitOutcome } from '../lib/scoring';
import { ConnectHint, ShapeMode, SHAPE_COLORS, SHAPE_DEFAULTS, SHAPE_LABEL, ShapeHalfProps, ShapeType } from './cardShapes';

/**
 * Reveal-sequence orchestrator timing. Tuned so a typical 3-5 beat hand
 * resolves in 2-3s and a worst-case 8-10 beat hand stays under 6s. If reveal
 * playthrough starts feeling sluggish in practice, drop BEAT_MS first.
 *
 * FLIP_WAIT covers the slowest pitcher-card flip (0.1 + N*0.12 + 0.7s for
 * N=signatureCount-1; 3 cards = ~1.05s). DWELL gives the player a breath to
 * read the freshly-revealed pitcher hand before any beats start ticking
 * numbers around.
 */
// Reveal-orchestrator pacing. Bumped from 480/280/320 to 720/520/520 after
// playtest feedback that the per-beat sequence felt "imperceptible" -- the
// pill tween and card highlight were finishing inside the same blink as the
// next beat starting, so the player saw a single number jump instead of a
// readable cascade. The new pacing leaves enough headroom for the highlight
// ring to pulse and the pill to actually animate to its new value before the
// next beat fires.
const REVEAL_FLIP_WAIT_MS = 1100;
const REVEAL_DWELL_MS = 350;
const REVEAL_BEAT_MS = 720;
const REVEAL_TWEEN_MS = 520;
const REVEAL_FINAL_PAUSE_MS = 520;

const TEXT_COLORS: Record<string, string> = {
  'bg-blue-500': 'text-blue-500',
  'bg-indigo-500': 'text-indigo-500',
  'bg-violet-500': 'text-violet-500',
  'bg-teal-500': 'text-teal-500',
  'bg-cyan-500': 'text-cyan-500',
  'bg-orange-500': 'text-orange-500',
  'bg-red-600': 'text-red-600',
  'bg-red-500': 'text-red-500',
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
  dragActive = false,
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

  // Hover-tooltip the shape with its plain capitalized name so descriptions
  // like "+2 if combined with a SQUARE neighbor" stay anchored in the same
  // vocabulary the player sees on the card. Skipped for blocked / wildcard
  // sides because the title would lie about the underlying meaning.
  const shapeTitle =
    !isBlocked && visualShape !== 'wildcard' && visualShape !== 'none'
      ? SHAPE_LABEL[visualShape as ShapeType]
      : undefined;

  return (
    <>
      <div
        className="absolute top-1/2 -translate-y-1/2 overflow-hidden z-20 flex items-center"
        title={shapeTitle}
        aria-label={shapeTitle}
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
            // Three states (priority order): (1) drag hint pulse on the
            // dragged card's adjacent edges -- highest priority because the
            // player needs the legality feedback NOW; (2) drag-active static
            // suppression for everyone else -- prevents the keyframe pulse
            // from replaying every time Reorder.Group flips an unrelated
            // seam mid-drag; (3) normal celebration animations when no drag
            // is in flight (entry, settled, post-drop).
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
                : dragActive
                ? {
                    scale: baseScale,
                    filter: isConnected ? 'brightness(1.2)' : 'brightness(1)',
                    boxShadow: isConnected
                      ? `0px 0px 8px ${color}`
                      : '0px 0px 0px rgba(0,0,0,0)',
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
                : dragActive
                ? { duration: 0 }
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

      {/* Connection burst (ring + particles) deliberately gated on
          !dragActive: each false->true flip mounts the block fresh and
          plays its initial animation, so without this gate every reorder
          tick mid-drag re-fires bursts on cards far from the user's hand.
          Once the drag releases, the settled state shows bursts normally. */}
      {isConnected && !hintColor && !dragActive && (
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
  isConnectedLeft: rawIsConnectedLeft,
  isConnectedRight: rawIsConnectedRight,
  modifier,
  compact = false,
  noMargin = false,
  leftHint,
  rightHint,
  valueOverride,
  highlightTone,
  dragActive = false,
  tutorialRegions = false,
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
  /**
   * Reveal-sequence override: when set, displays this number INSTEAD of the
   * modifier/baseValue. Lets the orchestrator pin a card's number mid-script
   * (e.g. drop p-31's 9 -> 7 when b-2 fires) without mutating engine state.
   */
  valueOverride?: number;
  /**
   * Reveal-sequence highlight: 'source' = the firing card (cool ring + pulse);
   * 'target' = the card being hit (warm ring + shake). Null/undefined renders
   * the normal connection-aware border the card would otherwise show.
   */
  highlightTone?: 'source' | 'target' | null;
  /**
   * True while the parent HandStrip has an active drag in flight. Forwarded
   * straight to ShapeHalf to suppress the burst + pulse celebrations, AND
   * used here to swap the outer card's repeating keyframe border-pulse for a
   * static border so the card itself doesn't strobe blue every time
   * Reorder.Group re-evaluates seams underneath the dragged card.
   */
  dragActive?: boolean;
  /**
   * When true, the card's value, shape connectors, and ability hover panel
   * each get a `data-tutorial="card-{value,shapes,ability}"` attribute so
   * the Learn-to-Play overlay can spotlight them individually.
   */
  tutorialRegions?: boolean;
}) => {
  // While the player is dragging, freeze ALL non-dragged cards' connection
  // state to "not connected" so we don't trigger margin shifts (8px <-> 0px),
  // border flips, or shape brightness flips on cards the user isn't holding.
  // Reorder.Group recomputes the live `isConnectedLeft/Right` on every pointer
  // tick as cards swap places; without this freeze the whole strip strobes
  // (margins snap, shapes brighten, borders re-color) every few pixels of
  // drag motion -- the "reload" the player has been seeing. The dragged
  // card's own seam hints (leftHint/rightHint = 'allow'/'block') still give
  // live can-connect feedback, so the player isn't flying blind.
  const isConnectedLeft = dragActive ? false : rawIsConnectedLeft;
  const isConnectedRight = dragActive ? false : rawIsConnectedRight;
  const isConnected = isConnectedLeft || isConnectedRight;
  const displayValue = valueOverride ?? modifier?.value ?? card.baseValue;
  // General Draw cards take on their label color as their card body so they
  // stand out from signature cards (which stay white) on a busy field view.
  const isGeneralDraw = card.abilityType === 'General Draw';
  const cardBgClass = isGeneralDraw && card.color ? card.color : 'bg-white';
  const defaultValueColor = isGeneralDraw ? 'text-white' : 'text-slate-800';
  // Modifier colors recolor the value text to match the source ability -- but
  // only on signature cards. General cards keep white text to stay readable on
  // their colored body (an orange-tagged buff on an orange general would paint
  // the value invisible against the background otherwise).
  const valueColorClass = isGeneralDraw
    ? defaultValueColor
    : modifier?.color
      ? TEXT_COLORS[modifier.color] || defaultValueColor
      : defaultValueColor;
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

  // Reveal-sequence overrides take precedence over the connection pulse so
  // the player can clearly see which card is the source/target of a beat.
  const revealAnimate =
    highlightTone === 'source'
      ? {
          borderColor: '#facc15', // amber-400
          boxShadow: '0 0 0 3px rgba(250, 204, 21, 0.55), 0 0 28px rgba(250, 204, 21, 0.45)',
          scale: 1.06,
        }
      : highlightTone === 'target'
      ? {
          borderColor: '#f43f5e', // rose-500
          boxShadow: '0 0 0 3px rgba(244, 63, 94, 0.55), 0 0 24px rgba(244, 63, 94, 0.45)',
          scale: 1.04,
          x: [0, -3, 3, -2, 2, 0],
        }
      : null;
  // Connection celebration on the OUTER border. Three branches:
  //  - dragActive + isConnected : freeze on the "lit" mid-pulse color so the
  //    card stays visibly connected without strobing every Reorder tick.
  //  - dragActive + !isConnected: static slate border, no shadow drama.
  //  - no drag                  : the original infinite blue keyframe pulse
  //    when connected, or the resting card shadow when not.
  const baseAnimate = dragActive
    ? isConnected
      ? {
          borderColor: '#60a5fa',
          boxShadow: '0 0 18px rgba(59,130,246,0.55)',
        }
      : {
          borderColor: '#e2e8f0',
          boxShadow:
            '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        }
    : isConnected
    ? {
        borderColor: ['#3b82f6', '#60a5fa', '#3b82f6'],
        boxShadow: [
          '0 0 15px rgba(59,130,246,0.4)',
          '0 0 30px rgba(59,130,246,0.8)',
          '0 0 15px rgba(59,130,246,0.4)',
        ],
      }
    : {
        borderColor: '#e2e8f0',
        boxShadow:
          '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      };
  const baseTransition = dragActive
    ? { duration: 0 }
    : isConnected
    ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' as const }
    : { duration: 0.3 };
  const revealTransition =
    highlightTone === 'target'
      ? { duration: 0.45, ease: 'easeOut' as const }
      : { duration: 0.35, ease: 'easeOut' as const };

  return (
    <motion.div
      data-tutorial={tutorialRegions ? 'card-shapes' : undefined}
      className={`
        relative ${sz.card} ${cardBgClass} border-2 group
        flex flex-col items-center justify-center cursor-grab active:cursor-grabbing
      `}
      animate={revealAnimate ?? baseAnimate}
      transition={revealAnimate ? revealTransition : baseTransition}
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
        dragActive={dragActive}
      />
      <ShapeHalf
        shape={card.rightShape}
        side="right"
        isConnected={isConnectedRight}
        compact={compact}
        mode={rightMode}
        hint={rightHint}
        dragActive={dragActive}
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
      {/* The value text used to be keyed by `displayValue`, which forced a
          full remount + entry pop (scale 1.5 -> 1, opacity 0.5 -> 1) every
          time the number changed. Reorder.Group recomputes scoring on every
          drag move, so cards whose modifier value depended on hand position
          (e.g. a +2 buff fluctuating with combination state) appeared to
          "reload" mid-drag. We still pop on RevealOverride landings (the
          orchestrator pins the value with a fresh key to celebrate beats),
          but plain modifier changes during selection now update silently. */}
      <motion.div
        data-tutorial={tutorialRegions ? 'card-value' : undefined}
        key={valueOverride !== undefined ? `override-${valueOverride}` : 'live'}
        initial={
          valueOverride !== undefined
            ? { scale: 1.5, opacity: 0.5 }
            : false
        }
        animate={
          valueOverride !== undefined
            ? { scale: 1, opacity: 1 }
            : undefined
        }
        transition={{ type: 'spring', stiffness: 300, damping: 15 }}
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
  const setShowStartScreen = useGameStore((s) => s.setShowStartScreen);
  const lastOutcome = useGameStore((s) => s.lastOutcome);
  const lastBatterScore = useGameStore((s) => s.lastBatterScore);
  const lastPitcherScore = useGameStore((s) => s.lastPitcherScore);
  const lastResultMessage = useGameStore((s) => s.lastResultMessage);
  const scoreBatterFn = useGameStore((s) => s.scoreBatter);
  const scorePitcherFn = useGameStore((s) => s.scorePitcher);
  const previewMatchupFn = useGameStore((s) => s.previewMatchup);
  const revealScript = useGameStore((s) => s.revealScript);
  const completeReveal = useGameStore((s) => s.completeReveal);
  // Which seat is the human in this half? When pitching, the bottom strip
  // becomes the pitcher hand (drag, lock-in, status chips on the user's
  // side) and the top strip becomes the AI batter (face-down -> revealed).
  const userSide = useGameStore(getUserSide);
  const userIsBatting = userSide === 'Batting';
  // atBatId scopes per-card keys to a single at-bat so general-pool cards
  // shared between consecutive batters/pitchers remount cleanly (the pitcher
  // flip-back, in particular, depends on this).
  const atBatId = useGameStore((s) => s.atBatId);
  // Subset of pitcherHand IDs whose hand-transforms ACTUALLY mutated the
  // batter's hand this round; passed to BatterStatusStrip so it only renders
  // chips for transforms that produced a visible difference (no leaking the
  // pitcher's face-down hand through irrelevant warnings).
  const pitcherTransformsImpactingBatter = useGameStore(
    (s) => s.pitcherTransformsImpactingBatter,
  );

  // Extra state slices that ALSO move the matchup pill but historically were
  // missing from the `matchup` memo's dep list. Including them ensures the
  // BATTER pill refreshes the moment any of these change. Without them the
  // pill silently went stale between phases:
  //  - resolvedChoices: b-65 Guess Pitch bonus, b-12 / p-56 modify-shape
  //    target, etc. -- player picks "Fastball" from the modal but the pill
  //    didn't include the +1/+4 until lockIn re-ran scoring (the playtest
  //    "score jumps from X to X+1 between preview and final" surprise).
  //  - coinFlips: b-22 Power/Speed Threat resolves at lockIn currently, but
  //    any future card that flips pre-lock would land in here.
  //  - pendingDebuffs: cross-at-bat carryover from previous innings.
  //  - bases / half / homeScore / awayScore / inning: live game-state
  //    triggers (b-91 RBI Threat, Home Cookin', late-inning bonuses, etc.)
  //    feed into per-card scoring through the ScoringContext.
  const resolvedChoices = useGameStore((s) => s.resolvedChoices);
  const coinFlips = useGameStore((s) => s.coinFlips);
  const pendingDebuffs = useGameStore((s) => s.pendingDebuffs);
  const bases = useGameStore((s) => s.bases);
  const half = useGameStore((s) => s.half);
  const homeScore = useGameStore((s) => s.homeScore);
  const awayScore = useGameStore((s) => s.awayScore);
  const inning = useGameStore((s) => s.inning);

  // User-affirmed connection seams + the action that updates them. The
  // strip reads `affirmedSeams` to decide which adjacent pairs render as
  // chained, and dispatches `affirmDraggedCard` on drag-end so the seam set
  // refreshes against the new layout.
  const affirmedSeams = useGameStore((s) => s.affirmedSeams);
  const affirmDraggedCard = useGameStore((s) => s.affirmDraggedCard);
  // Pending player-choice prompts (e.g. b-12 Switch Hitter). The user has
  // to actively trigger these via the per-card "USE" pill -- the modal
  // doesn't auto-open anymore. We only forward user-side prompts to the
  // strip; AI-side prompts stay invisible and silently default to declined.
  const pendingChoices = useGameStore((s) => s.pendingChoices);
  const activeChoiceCardId = useGameStore((s) => s.activeChoiceCardId);
  const triggerChoice = useGameStore((s) => s.triggerChoice);
  // Per-card modifier snapshots captured at lock-in. Used in lieu of the live
  // preview during the reveal + result phases so state-trigger cards keep the
  // numbers they had when the swing was committed (otherwise b-91 RBI Threat
  // and friends silently drop their bonus the moment bases clear / score
  // changes / half flips, and the player sees their card values shift with
  // no in-game explanation).
  const lastBatterCardModifiers = useGameStore((s) => s.lastBatterCardModifiers);
  const lastPitcherCardModifiers = useGameStore((s) => s.lastPitcherCardModifiers);

  // Live preview. Single source of truth: `previewMatchup` runs both sides
  // through the same scoring pass that feeds the pill (including p-41's
  // Sweeping Slider seam-break on the working batter hand), then exposes
  // both ScoringResults plus the per-component breakdown. The strip's
  // per-card values and the BATTER pill all read from this one matchup --
  // they can never desync from each other or from what locks in.
  //
  // CRITICAL: the memo dep list MUST include every slice that
  // `previewMatchup` reads from the store. An incomplete dep list silently
  // froze the pill on stale values until lockIn re-ran the engine -- the
  // playtest "pill jumped +1 between preview and final" symptom that
  // looked like an engine discrepancy was actually this stale memo (b-65
  // Guess Pitch's +1/+4 bonus depended on `resolvedChoices`, which wasn't
  // in deps).
  const matchup = useMemo(
    () => previewMatchupFn(),
    [
      previewMatchupFn,
      batterHand,
      pitcherHand,
      phase,
      resolvedChoices,
      coinFlips,
      pendingDebuffs,
      bases,
      half,
      homeScore,
      awayScore,
      inning,
      affirmedSeams,
    ],
  );
  const batterPreview = matchup.batterScoringResult;
  const pitcherPreview = matchup.pitcherScoringResult;
  // Reference scoreBatterFn / scorePitcherFn so swap-in alternatives during
  // tests still get the latest store action; no longer called per-render.
  void scoreBatterFn;
  void scorePitcherFn;

  const isSelecting = phase === 'selecting';
  const isRevealing = phase === 'revealing';
  const isResolved = phase === 'between-at-bats' || phase === 'game-over';

  // Decide which per-card modifier set the strips render against. While the
  // player is selecting we want LIVE previews so the numbers update as cards
  // get rearranged. The moment we leave selecting (revealing -> resolved) we
  // freeze on the lock-in snapshot so post-resolution state changes (bases
  // cleared, score changed, half flipped) can't silently mutate the displayed
  // values out from under the player. Falls back to the live preview if the
  // snapshot hasn't been populated yet (game start, manual reset).
  const batterModifiersForStrip = isSelecting
    ? batterPreview.cardModifiers
    : Object.keys(lastBatterCardModifiers).length > 0
      ? lastBatterCardModifiers
      : batterPreview.cardModifiers;
  const pitcherModifiersForStrip = isSelecting
    ? pitcherPreview.cardModifiers
    : Object.keys(lastPitcherCardModifiers).length > 0
      ? lastPitcherCardModifiers
      : pitcherPreview.cardModifiers;

  // Reveal-sequence orchestrator. While `revealing`, the score pills and a
  // few per-card values are driven off this local state instead of the live
  // matchup. It walks `revealScript` with a setTimeout chain, pinning the
  // affected card's number for a beat and tweening the affected ScorePill
  // toward the running total. When the chain finishes it snaps to the final
  // lockIn totals and signals the store to leave the `revealing` phase.
  const reveal = useRevealOrchestrator({
    phase,
    script: revealScript,
    batterHand,
    pitcherHand,
    finalBatterScore: lastBatterScore,
    finalPitcherScore: lastPitcherScore,
    onComplete: completeReveal,
  });

  // ScorePill values: live preview while selecting, orchestrator-driven while
  // revealing, locked-in score after that. Pitcher pill stays hidden during
  // selection so the player has to commit before peeking at the pitcher's
  // total -- but we DO want to show it during the reveal even though `?`
  // would otherwise apply, since the whole point is to watch the number land.
  const batterDisplayValue = isResolved
    ? lastBatterScore
    : isRevealing
    ? reveal.displayedBatter
    : matchup.batterDisplay;
  const pitcherDisplayValue = isResolved
    ? lastPitcherScore
    : isRevealing
    ? reveal.displayedPitcher
    : matchup.pitcherDisplay;
  const outcomeBadgeStyle = outcomeStyle(lastOutcome);

  // After a hit the camera zooms out to follow the runner. Previously the
  // pitcher hand slid completely off the top of the viewport here, which
  // playtesters flagged as a bug -- the hand the player JUST saw flipped
  // open vanished before they could analyze the matchup. Now the strip
  // stays in place during `between-at-bats` so the player can read the
  // resolved pitcher hand for as long as they want, and only resets to its
  // mounted-from-deck animation when `startNextAtBat` flips the phase back
  // to `selecting`.
  const _ignoredHitZoom = phase === 'between-at-bats' && lastOutcome !== null && lastOutcome !== 'out';
  void _ignoredHitZoom;

  // Map per-side data into "user vs AI" lanes so the bottom strip is
  // always the user's hand and the top strip is always the AI's. This
  // keeps the rest of the JSX agnostic to which role the user is in.
  const userHand = userIsBatting ? batterHand : pitcherHand;
  const aiHand = userIsBatting ? pitcherHand : batterHand;
  const userModifiers = userIsBatting ? batterModifiersForStrip : pitcherModifiersForStrip;
  const aiModifiers = userIsBatting ? pitcherModifiersForStrip : batterModifiersForStrip;
  const reorderUser = userIsBatting ? reorderBatter : reorderPitcher;
  const userValueOverrides = userIsBatting ? reveal.batterValueOverrides : reveal.pitcherValueOverrides;
  const aiValueOverrides = userIsBatting ? reveal.pitcherValueOverrides : reveal.batterValueOverrides;
  const userHighlights = userIsBatting ? reveal.batterHighlights : reveal.pitcherHighlights;
  const aiHighlights = userIsBatting ? reveal.pitcherHighlights : reveal.batterHighlights;
  const userBanner = userIsBatting ? reveal.batterBanner : reveal.pitcherBanner;
  const aiBanner = userIsBatting ? reveal.pitcherBanner : reveal.batterBanner;
  const userPillValue = userIsBatting ? batterDisplayValue : pitcherDisplayValue;
  const aiPillValue = userIsBatting ? pitcherDisplayValue : batterDisplayValue;
  const userLabel = userIsBatting ? 'Batter' : 'Pitcher';
  const aiLabel = userIsBatting ? 'Pitcher' : 'Batter';
  const userTone = userIsBatting ? 'batter' : 'pitcher';
  const aiTone = userIsBatting ? 'pitcher' : 'batter';

  // Set of cardIds in the user's hand that have an unresolved player-choice
  // prompt. The HandStrip uses this to render the "USE" pill on the
  // matching card. We filter by `userSide` so an AI-side prompt that
  // happens to share an id (in theory impossible since hands are
  // disjoint) can never light up the user's strip.
  const userPendingChoiceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of pendingChoices) {
      if (c.side === userSide) ids.add(c.cardId);
    }
    return ids;
  }, [pendingChoices, userSide]);

  return (
    <>
      {/* Big dramatic outcome banner -- pops over the field for a beat after
          the reveal sequence resolves. Adds the "punchy moment" the playtest
          report flagged as missing: a strikeout/home run currently shrinks
          to a tiny chip on the score pill, which makes hits feel anticlimactic
          even when the engine has done all the work. Self-dismisses after
          ~1.6s so the player can immediately read the matchup and tap Next. */}
      <HitResultBanner outcome={lastOutcome} phase={phase} atBatId={atBatId} />

      {/* AI hand - top of screen. Face-down during selection regardless of
          whether the AI is playing batter or pitcher this half (same
          fog-of-war either direction). */}
      <motion.div
        className="absolute inset-x-0 top-24 pointer-events-none flex flex-col items-center pt-4 pb-3 bg-gradient-to-b from-slate-900/70 via-slate-900/30 to-transparent"
        initial={false}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          <ScorePill
            label={aiLabel}
            tone={aiTone}
            value={isSelecting ? null : aiPillValue}
            outcomeStyle={outcomeBadgeStyle}
            compact
            banner={aiBanner}
          />
          <div data-tutorial="opponent-hand">
            <FlipPitcherStrip
              hand={aiHand}
              modifiers={aiModifiers}
              revealed={!isSelecting}
              atBatId={atBatId}
              compact
              valueOverrides={aiValueOverrides}
              highlightTones={aiHighlights}
            />
          </div>
        </div>
      </motion.div>

      {/* User hand - bottom of screen. Always interactive: drag, connect,
          lock-in. Whether the user is the batter or the pitcher this half
          is decided by `userTeam` + `half` via getUserSide. */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none flex flex-col items-center justify-end pb-8 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent pt-32 h-80">

        <div className="pointer-events-auto flex flex-col items-center gap-4">
          <ScorePill
            label={userLabel}
            tone={userTone}
            value={userPillValue}
            outcome={isResolved ? lastResultMessage : undefined}
            outcomeStyle={outcomeBadgeStyle}
            atBatId={atBatId}
            banner={userBanner}
            // Hit Scale hint is a batter-only concept ("if you win, +N to
            // your hit"). Only show it when the user IS the batter.
            hitScaleHint={
              userIsBatting && isSelecting && matchup.batterWinning && matchup.batterHitScaleBonus !== 0
                ? matchup.batterHitScaleBonus
                : null
            }
          />

          {/* Math breakdown: explains why the pill differs from the visible
              chain sum when an opponent debuff (p-38 / p-50 / p-60 / p-72 /
              p-90 etc.), a cross-at-bat carryover, or a b-65 guess bonus is
              moving the pill. Hides itself entirely when the chain sum IS
              the pill so we don't pollute the UI in vanilla matchups.
              Batter-side concept: skip it when the user is pitching --
              showing the AI batter's chain breakdown during selection
              would leak their face-down hand. */}
          {userIsBatting && isSelecting && (
            <MatchupMath
              chainSum={matchup.batterChainSum}
              pitcherDelta={matchup.batterPitcherDelta}
              carryoverDelta={matchup.batterCarryoverDelta}
              guessDelta={matchup.batterGuessDelta}
              total={matchup.batterDisplay}
              ignoresDebuffs={matchup.batterIgnoresDebuffs}
              chainOf={batterPreview.bestGroup.length}
              handSize={batterHand.length}
            />
          )}

          {/* Anonymous status chips for any pitcher debuff currently affecting
              the batter. Surfaces hidden hand-transforms (shape mirror, value
              cap, shape flatten, generals nullified) so the player isn't left
              wondering why their cards changed shape or value. Hides on b-9
              Generational Discipline since the immunity already cancels these
              effects. Only renders during selection AND only when the user
              is the batter (otherwise we'd be telling the user about
              effects they themselves dealt to the AI). */}
          {userIsBatting && (
            <BatterStatusStrip
              batterHand={batterHand}
              pitcherHand={pitcherHand}
              pitcherTransformsImpactingBatter={pitcherTransformsImpactingBatter}
              visible={isSelecting}
            />
          )}

          <div data-tutorial="user-hand">
            <HandStrip
              hand={userHand}
              onReorder={reorderUser}
              modifiers={userModifiers}
              disabled={!isSelecting}
              atBatId={atBatId}
              direction="bottom"
              valueOverrides={userValueOverrides}
              highlightTones={userHighlights}
              // Manual-connection mechanic: only seams the player has dragged
              // into place chain. We pass affirmedSeams in EVERY phase so the
              // visible chain art always matches what the engine actually
              // scored at lock-in -- showing legacy auto-connect during the
              // reveal would surface ghost chains the engine didn't credit.
              // The drag-end action only fires during selection; outside
              // that we leave `onAffirmConnections` undefined so even if
              // Reorder.Item somehow fires a stale drag, nothing mutates.
              // `affirmedSeams` and `affirmDraggedCard` both target the
              // current user-side hand (gameStore branches on getUserSide).
              affirmedSeams={affirmedSeams}
              onAffirmConnections={isSelecting ? affirmDraggedCard : undefined}
              // Per-card "USE" pill plumbing. Only enable the pill during
              // selection -- once the swing locks in, the modal can't
              // resolve anyway. The pill auto-hides per-card once the
              // choice leaves `userPendingChoiceIds` (resolved or expired).
              pendingChoiceIds={isSelecting ? userPendingChoiceIds : undefined}
              activeChoiceCardId={activeChoiceCardId}
              onTriggerChoice={isSelecting ? triggerChoice : undefined}
              // Mark the FIRST card so the tutorial overlay can spotlight
              // distinct regions (value, shapes, ability hover panel).
              tutorialFirstCard={true}
            />
          </div>

          <AnimatePresence mode="wait">
            {isSelecting && (
              <motion.button
                key="lockin"
                data-tutorial="lock-in"
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
                    onClick={() => setShowStartScreen(true)}
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

/**
 * Big, transient outcome banner that pops over the field for ~1.6s right
 * after the reveal sequence finishes. Replaces the old "tiny chip on the
 * batter pill" treatment that playtest reports flagged as flat: hits should
 * feel celebratory, strikeouts should sting, and the player should know the
 * answer at a glance without parsing a sentence on a small chip.
 *
 * Keys off (atBatId, outcome) so the banner re-mounts only once per resolved
 * at-bat -- the AnimatePresence enter/exit takes care of the pop + fade.
 * Auto-hides after the timeout so it never blocks the Next At-Bat button.
 */
const HitResultBanner = ({
  outcome,
  phase,
  atBatId,
}: {
  outcome: HitOutcome | null;
  phase: Phase;
  atBatId: number;
}) => {
  const [visible, setVisible] = useState(false);
  // Re-enter every time a fresh resolved-state lands. We key on atBatId so a
  // second OUT in a row still pops a fresh banner. We ALSO synchronously
  // hide the moment the phase leaves the resolved states (B1 fix): without
  // this, tapping `Next At-Bat` while the banner's 3.6s timer was still
  // ticking would leave the prior at-bat's "OUT!" / "TRIPLE!" plate floating
  // over the new at-bat's card selection.
  useEffect(() => {
    if (phase !== 'between-at-bats' && phase !== 'game-over') {
      setVisible(false);
      return;
    }
    if (outcome === null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    // 3.6s gives the player time to actually savor (or stew on) the
    // outcome label. 2.2s was too brisk in playtest -- the banner faded
    // before the eye even tracked to it. The post-banner state still
    // shows the outcome chip on the score pill so the info isn't lost
    // when this auto-hides ahead of a Next At-Bat tap.
    const t = setTimeout(() => setVisible(false), 3600);
    return () => clearTimeout(t);
  }, [phase, outcome, atBatId]);

  const cfg = HIT_BANNER_CONFIG[outcome ?? 'out'];
  if (!cfg) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={`hit-banner-${atBatId}`}
          initial={{ opacity: 0, scale: 0.6, y: 30 }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
            transition: { type: 'spring', stiffness: 280, damping: 18 },
          }}
          exit={{ opacity: 0, scale: 1.15, transition: { duration: 0.4 } }}
          className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center"
        >
          <div
            className={`px-10 py-4 rounded-3xl shadow-2xl border-4 ${cfg.classes} flex flex-col items-center gap-1`}
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
          >
            <span className="text-5xl font-black uppercase tracking-[0.18em] leading-none">
              {cfg.label}
            </span>
            {cfg.sub && (
              <span className="text-xs font-bold uppercase tracking-[0.32em] opacity-80">
                {cfg.sub}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const HIT_BANNER_CONFIG: Record<
  HitOutcome,
  { label: string; sub?: string; classes: string }
> = {
  homerun: {
    label: 'Home Run!',
    sub: 'Around the bases',
    classes:
      'bg-gradient-to-br from-amber-300 via-orange-500 to-rose-500 text-slate-900 border-amber-100',
  },
  triple: {
    label: 'Triple!',
    sub: 'Three-bagger',
    classes:
      'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white border-emerald-200',
  },
  double: {
    label: 'Double!',
    sub: 'Two-bagger',
    classes:
      'bg-gradient-to-br from-sky-400 to-sky-600 text-white border-sky-200',
  },
  single: {
    label: 'Single',
    sub: 'On Base',
    classes:
      'bg-gradient-to-br from-blue-500 to-blue-700 text-white border-blue-200',
  },
  out: {
    label: 'Out!',
    sub: '',
    classes:
      'bg-gradient-to-br from-rose-600 to-rose-800 text-white border-rose-200',
  },
};

/**
 * Anonymous status chips surfaced above the batter's hand whenever a pitcher
 * effect is silently rewriting the round. Maps the pitcher cards that drive
 * `applyHandTransforms` to short, neutral flavor text the batter can read
 * without revealing which signature is causing it (the pitcher's hand is
 * face-down during selection). Pitcher-side per-card abilities (p-36 Ace's
 * Command nullifying the highest card) are surfaced too -- the batter can
 * see one of their cards land at 0 with a red highlight, but without this
 * chip there's no explanation for why.
 *
 * Hides entirely when b-9 Generational Discipline is held (the immunity
 * already cancels these effects, so showing chips would lie about state).
 */
const PITCHER_TRANSFORM_LABELS: Record<string, string> = {
  'p-31': 'Wildcards Locked',
  'p-35': 'Squares Flat',
  'p-42': 'Values Capped',
  'p-47': 'Diamonds Flat',
  'p-49': 'Shapes Mirrored',
  'p-78': 'Stars Flat',
};

/**
 * One-sentence plain-English explanations for every status chip the BATTER
 * sees during selection. Keyed by the same `chip.key` we already build the
 * chip list with, so the lookup is a single map. Surfaced via the chip's
 * native `title` attribute so the explanation is one hover away -- the
 * chips themselves stay terse for at-a-glance reading.
 *
 * Strings reference cards by their display NAME only -- the engine ids
 * (`b-9`, `p-31`, ...) are an internal naming convention with no meaning to
 * the player and have no business in user-facing text.
 */
const STATUS_CHIP_EXPLANATIONS: Record<string, string> = {
  discipline:
    'Generational Discipline — your hand ignores all pitcher debuffs this round.',
  'p-31':
    'Splinker — the pitcher locked the wildcards in your hand to fixed shapes.',
  'p-35':
    'Knuckle Curve — your SQUARE shapes are treated as flat (none) and cannot connect.',
  'p-42':
    'Paint the Corners — every card in your hand has its value capped at 6.',
  'p-47':
    'Rising Fastball — your DIAMOND shapes are treated as flat (none) and cannot connect.',
  'p-49':
    'The Condor — every card in your hand has had its left and right shapes mirrored.',
  'p-78':
    'The Shift — your STAR shapes are treated as flat (none) and cannot connect.',
  'p-36':
    "Ace's Command — your highest-value card's ability is silenced. The base value still scores; the effect does not.",
  'p-41':
    'Sweeping Slider — at lock-in one seam in your best chain will break, dropping that card from the chain.',
  'b-23':
    'Stolen Base Threat — the pitcher cannot use any General cards this round (their generals are zeroed at scoring).',
};

const BatterStatusStrip = ({
  batterHand,
  pitcherHand,
  pitcherTransformsImpactingBatter,
  visible,
}: {
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  /**
   * IDs of pitcher cards whose hand-transform ACTUALLY mutated the batter's
   * hand this round. We render a chip only for these IDs so the strip never
   * surfaces an irrelevant warning (e.g. "Wildcards Locked" when the batter
   * has no wildcards to lock) -- which would also leak the pitcher's
   * face-down hand to the player.
   */
  pitcherTransformsImpactingBatter: string[];
  visible: boolean;
}) => {
  const chips: { key: string; label: string }[] = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    const hasDiscipline = batterHand.some((c) => c.id === 'b-9');
    const hasStolenBaseThreat = batterHand.some((c) => c.id === 'b-23');
    if (hasDiscipline) {
      // Show the protective chip instead so the player knows debuffs ARE
      // being neutralized this round.
      out.push({ key: 'discipline', label: 'Discipline: Pitcher Debuffs Off' });
      return out;
    }
    const impacting = new Set(pitcherTransformsImpactingBatter);
    for (const card of pitcherHand) {
      const label = PITCHER_TRANSFORM_LABELS[card.id];
      if (!label) continue;
      if (!impacting.has(card.id)) continue;
      out.push({ key: card.id, label });
    }
    // p-36 Ace's Command always silences the batter's highest card -- the
    // player will see the red highlight + zeroed value during reveal, but
    // without this chip there's no warning during selection.
    if (pitcherHand.some((c) => c.id === 'p-36')) {
      out.push({ key: 'p-36', label: 'Highest Card Silenced' });
    }
    // p-41 Sweeping Slider breaks a seam in the batter's best combo at
    // lock-in. Now that the preview folds the seam break in (so the
    // displayed score matches the resolved score), this chip is the only
    // hint the batter gets about why their score landed lower than the
    // raw hand math suggested.
    if (pitcherHand.some((c) => c.id === 'p-41')) {
      out.push({ key: 'p-41', label: 'Seam Break Risk' });
    }
    if (hasStolenBaseThreat) {
      out.push({ key: 'b-23', label: 'Pitcher Generals Disabled' });
    }
    return out;
  }, [batterHand, pitcherHand, pitcherTransformsImpactingBatter]);

  return (
    <AnimatePresence>
      {visible && chips.length > 0 && (
        <motion.div
          key="status-strip"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="flex flex-wrap items-center justify-center gap-1.5 -mt-2"
        >
          {chips.map((c) => (
            <span
              key={c.key}
              // Native `title` is enough here: the chip already says WHAT
              // the impact is; the tooltip's job is just "what does this
              // mean / which card caused it" for players who don't have
              // the whole roster memorized.
              title={STATUS_CHIP_EXPLANATIONS[c.key] ?? c.label}
              className={
                c.key === 'discipline'
                  ? 'px-2 py-0.5 rounded-full bg-emerald-900/70 border border-emerald-500/60 text-emerald-200 text-[10px] font-bold uppercase tracking-wider cursor-help'
                  : 'px-2 py-0.5 rounded-full bg-rose-900/70 border border-rose-500/60 text-rose-200 text-[10px] font-bold uppercase tracking-wider cursor-help'
              }
            >
              {c.label}
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * Reveal-sequence banner attached to a ScorePill. Floats just below the pill
 * during aggregate / cross / guess-pitch beats so the player sees the source
 * + delta even when no specific opponent card is being targeted.
 */
export interface ScoreBanner {
  /** Stable key per beat -- triggers AnimatePresence enter/exit. */
  key: string;
  /** Source card name or "Carryover" / "Guess Pitch" tag. */
  label: string;
  /** Signed integer delta. Sign drives the swatch color. */
  delta: number;
  /** Optional bg color class for accenting (the source card's `card.color`). */
  accentClass?: string;
}

interface ScorePillProps {
  label: string;
  tone: 'batter' | 'pitcher';
  value: number | null;
  outcome?: string;
  outcomeStyle: string;
  compact?: boolean;
  /** Reveal-sequence banner shown beneath the pill while a beat plays. */
  banner?: ScoreBanner | null;
  /**
   * Optional Hit-Scale ladder modifier (signed) the player would apply on
   * top of the pill value if they win the play. Rendered as a small badge
   * tucked beside the pill (only when non-zero) so the player sees the
   * ladder bonus without it silently changing the pill's number on lock-in.
   */
  hitScaleHint?: number | null;
  /**
   * Current at-bat id. Used to scope the outcome chip's exit-animation key so
   * that when `Next At-Bat` is clicked the prior chip ("ELLY DE LA CRUZ: OUT
   * (17 vs 24)") force-unmounts crisply instead of bleeding 200-300ms of
   * default exit fade into the next at-bat's card-selection HUD (B1 fix).
   */
  atBatId?: number;
}

/**
 * Single-number score readout for each side. The displayed value is the
 * comprehensive matchup total from `previewMatchup` (or `lastBatter/PitcherScore`
 * after lock-in) -- it already bakes in opponent debuffs, the b-65 guess
 * bonus, b-9 immunity, cross-at-bat debuffs, and (when the batter is winning)
 * the hit-scale ladder bonus. We deliberately do NOT render a separate
 * "Pitcher debuff -2" badge: that framing leaked engine vocabulary and forced
 * the player to do mental math, and -- worst of all -- showed the user (the
 * batter) the opponent's effect tagged with the opponent's role, which read
 * as a notification on the wrong seat.
 *
 * Reveal-sequence beats override the pill's number via the `value` prop and
 * additionally surface a transient banner via `banner`.
 */
const ScorePill = ({
  label,
  tone,
  value,
  outcome,
  outcomeStyle,
  compact = false,
  banner = null,
  hitScaleHint = null,
  atBatId,
}: ScorePillProps) => {
  const valueColor = tone === 'batter' ? 'text-blue-600' : 'text-rose-600';
  const containerSize = compact
    ? 'px-4 py-1 text-sm gap-2'
    : 'px-6 py-2 text-xl gap-4';
  return (
    // `z-30` lifts the pill (and the BeatBanner anchored absolute below it)
    // above sibling cards in the user's column. Without this the banner
    // anchored at `top-full mt-1.5` floats into the flex gap between the
    // pill and the hand strip, and the cards -- whose Framer-applied
    // transforms create their own stacking contexts -- paint over it. The
    // banner only renders during reveal beats, so this z-index is moot
    // during selection / between-at-bats.
    <div className="relative z-30 flex flex-col items-center">
      <motion.div
        layout
        className={`bg-white/95 backdrop-blur rounded-full font-bold text-slate-900 shadow-xl border-2 border-white/50 flex items-center ${containerSize}`}
      >
        <span className="flex items-center gap-2">
          <span className={compact ? 'text-[10px] font-extrabold uppercase tracking-widest text-slate-500' : 'text-xs font-extrabold uppercase tracking-widest text-slate-500'}>
            {label}
          </span>
          <motion.span
            key={value === null ? 'na' : value}
            initial={{ scale: 1.18, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className={`font-black ${valueColor} ${compact ? 'text-base' : 'text-2xl'} ${value === null ? 'opacity-40' : ''}`}
          >
            {value === null ? '?' : value}
          </motion.span>
        </span>

        <AnimatePresence>
          {hitScaleHint !== null && hitScaleHint !== 0 && (
            <motion.span
              key={`hsh-${hitScaleHint}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 340, damping: 22 }}
              className={`font-black uppercase tracking-widest rounded-full ring-1 ${
                hitScaleHint > 0
                  ? 'bg-amber-400/95 text-slate-900 ring-amber-200/60'
                  : 'bg-rose-500/95 text-white ring-rose-200/60'
              } ${compact ? 'text-[9px] px-2 py-0.5' : 'text-[11px] px-2.5 py-0.5'}`}
              title="Hit Scale ladder bonus -- applies to your hit if you win"
            >
              {hitScaleHint > 0 ? `+${hitScaleHint}` : `${hitScaleHint}`} HIT
            </motion.span>
          )}
        </AnimatePresence>

        {/* AnimatePresence keyed by atBatId in addition to the outcome string
            so that `Next At-Bat` (which flips phase out of `between-at-bats`,
            making `outcome` undefined) drops the chip immediately rather than
            tweening it ~300ms into the next at-bat's CARD SELECTION HUD. The
            tight 0.12s exit also keeps in-at-bat outcome swaps from feeling
            laggy. (B1 fix.) */}
        <AnimatePresence>
          {outcome && (
            <motion.span
              key={`${atBatId ?? 'na'}-${outcome}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
              className={`font-black uppercase tracking-widest rounded-full shadow-inner ${outcomeStyle} ${compact ? 'text-[10px] px-2.5 py-0.5' : 'text-sm px-3.5 py-1'}`}
            >
              {outcome}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Banner sits in flow below the pill so it doesn't visually shove the
          rest of the column when it animates in. The pill itself gets `layout`
          so its width tween reads naturally if a large value lands. `z-10`
          here keeps the banner above the pill's own children if the chip
          ever grows tall enough to overlap. */}
      <div className="absolute top-full mt-1.5 pointer-events-none z-10">
        <AnimatePresence>
          {banner && <BeatBanner key={banner.key} banner={banner} />}
        </AnimatePresence>
      </div>
    </div>
  );
};

const BeatBanner = ({ banner }: { banner: ScoreBanner }) => {
  const positive = banner.delta > 0;
  const sign = positive ? '+' : '';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.9 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full shadow-lg bg-slate-900/90 text-white text-[10px] font-bold uppercase tracking-widest border border-white/20 whitespace-nowrap"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          banner.accentClass ?? (positive ? 'bg-emerald-400' : 'bg-rose-400')
        }`}
      />
      <span>{banner.label}</span>
      <span className={positive ? 'text-emerald-300' : 'text-rose-300'}>
        {sign}
        {banner.delta}
      </span>
    </motion.div>
  );
};

interface MatchupMathProps {
  /** Sum of card values in the player's current best chain. */
  chainSum: number;
  /** Aggregate pitcher pressure (typically negative). */
  pitcherDelta: number;
  /** Cross-at-bat carryover debuff (typically negative). */
  carryoverDelta: number;
  /** b-65 Guess Pitch bonus at lock-in (0/1/4). */
  guessDelta: number;
  /** chainSum + pitcherDelta + carryoverDelta + guessDelta -- mirrors the pill. */
  total: number;
  /** True when b-9 Generational Discipline is in play (debuffs zeroed). */
  ignoresDebuffs: boolean;
  /** How many cards form the best chain. */
  chainOf: number;
  /** Total cards in hand (for the X of Y caption). */
  handSize: number;
}

/**
 * Math breakdown rendered directly under the BATTER score pill during card
 * selection. Decomposes the pill into its components so the player can see
 * WHY the visible card sum doesn't always match the pill total -- previously
 * cross-side effects (p-38 / p-50 / p-52 / p-60 / p-72 / p-90 aggregate
 * debuffs, cross-at-bat carryover, b-65 guess bonus) silently moved the pill
 * without ever touching the per-card numbers, which playtesters read as the
 * pill being broken.
 *
 * Hides itself entirely when no cross-side delta applies (i.e. the chain sum
 * IS the pill) so vanilla matchups stay uncluttered. Always shows when ANY
 * delta is non-zero, even if it's just guess +1.
 */
const MatchupMath = ({
  chainSum,
  pitcherDelta,
  carryoverDelta,
  guessDelta,
  total,
  ignoresDebuffs,
  chainOf,
  handSize,
}: MatchupMathProps) => {
  const hasDelta = pitcherDelta !== 0 || carryoverDelta !== 0 || guessDelta !== 0;
  if (!hasDelta && !ignoresDebuffs) return null;
  const components: Array<{ label: string; value: number; tone: 'neutral' | 'pos' | 'neg'; title?: string }> = [
    {
      label: handSize > chainOf ? `Chain ${chainOf}/${handSize}` : 'Chain',
      value: chainSum,
      tone: 'neutral',
      title: handSize > chainOf
        ? `${chainOf} of ${handSize} cards form your best combined chain. Drag cards together to build a longer chain.`
        : 'All cards combine into a single chain that feeds the pill.',
    },
  ];
  if (pitcherDelta !== 0) {
    components.push({
      label: 'Pitcher',
      value: pitcherDelta,
      tone: pitcherDelta < 0 ? 'neg' : 'pos',
      title: "Aggregate pressure from the pitcher's ability cards (e.g. Wipeout Changeup, Devastating Slider, Filthy Stuff).",
    });
  }
  if (carryoverDelta !== 0) {
    components.push({
      label: 'Carryover',
      value: carryoverDelta,
      tone: carryoverDelta < 0 ? 'neg' : 'pos',
      title: 'Debuffs queued by a previous at-bat that bleed into this one (e.g. Strikeout Artist hangover).',
    });
  }
  if (guessDelta !== 0) {
    components.push({
      label: 'Guess',
      value: guessDelta,
      tone: 'pos',
      title:
        guessDelta >= 4
          ? 'Guess Pitch: pitcher used the shape you named (+4).'
          : 'Guess Pitch: pitcher did not use the shape you named (+1 consolation).',
    });
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/85 backdrop-blur border border-white/10 shadow-lg flex-wrap justify-center max-w-[420px]"
    >
      {components.map((c, idx) => {
        const sign = c.value > 0 ? '+' : c.value < 0 ? '−' : '';
        const magnitude = Math.abs(c.value);
        const valueColor =
          c.tone === 'pos' ? 'text-emerald-300' : c.tone === 'neg' ? 'text-rose-300' : 'text-slate-100';
        return (
          <div key={c.label} className="flex items-center gap-1.5">
            {idx > 0 && (
              <span className="text-slate-600 text-[10px] font-bold select-none">·</span>
            )}
            <span
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest"
              title={c.title}
            >
              <span className="text-slate-400">{c.label}</span>
              <span className={`${valueColor} font-mono tabular-nums`}>
                {sign}
                {magnitude}
              </span>
            </span>
          </div>
        );
      })}
      {hasDelta && (
        <>
          <span className="text-slate-600 text-[10px] font-bold select-none">=</span>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-300 font-mono tabular-nums">
            {total}
          </span>
        </>
      )}
      {ignoresDebuffs && (
        <span
          className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-[9px] font-bold uppercase tracking-widest text-emerald-300"
          title="Generational Discipline: pitcher debuffs are zeroed for this at-bat."
        >
          Discipline
        </span>
      )}
    </motion.div>
  );
};

/**
 * Face-down card art shared by the pitcher hand (and any future face-down
 * batter slots). Rendered as a single SVG with a fixed 320x448 viewBox so it
 * scales perfectly inside both the compact (80x112) and full (128x176) card
 * frames -- both share the same 5:7 aspect ratio.
 *
 * The DUGOUT wordmark uses Montserrat Black (loaded in `index.html`) and
 * falls back gracefully to any system sans if the font hasn't loaded yet.
 */
const CardBack = () => (
  <svg
    viewBox="0 0 320 448"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="xMidYMid meet"
    className="w-full h-full block"
    style={{ backgroundColor: '#0A1E31' }}
  >
    <defs>
      <radialGradient id="dugoutCardBackGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#143657" />
        <stop offset="100%" stopColor="#0A1E31" />
      </radialGradient>
    </defs>
    <rect width="320" height="448" fill="url(#dugoutCardBackGlow)" />

    {/* Notched outer borders */}
    <path
      d="M 12 24 L 24 12 L 296 12 L 308 24 L 308 424 L 296 436 L 24 436 L 12 424 Z"
      fill="none"
      stroke="#E4B83F"
      strokeWidth="2.5"
    />
    <path
      d="M 20 30 L 30 20 L 290 20 L 300 30 L 300 418 L 290 428 L 30 428 L 20 418 Z"
      fill="none"
      stroke="#E4B83F"
      strokeWidth="1"
    />

    {/* Baseball stitching (left + right arcs) */}
    <path
      d="M 40 -20 A 160 250 0 0 0 40 468"
      fill="none"
      stroke="#E31837"
      strokeWidth="1.5"
      opacity="0.6"
    />
    <path
      d="M 40 -20 A 160 250 0 0 0 40 468"
      fill="none"
      stroke="#E31837"
      strokeWidth="7"
      strokeDasharray="2 12"
      opacity="0.9"
    />
    <path
      d="M 280 -20 A 160 250 0 0 1 280 468"
      fill="none"
      stroke="#E31837"
      strokeWidth="1.5"
      opacity="0.6"
    />
    <path
      d="M 280 -20 A 160 250 0 0 1 280 468"
      fill="none"
      stroke="#E31837"
      strokeWidth="7"
      strokeDasharray="2 12"
      opacity="0.9"
    />

    {/* Infield dirt + foul lines + diamonds */}
    <circle
      cx="160"
      cy="224"
      r="100"
      fill="none"
      stroke="#E4B83F"
      strokeWidth="1"
      strokeDasharray="6 6"
      opacity="0.4"
    />
    <line
      x1="160"
      y1="324"
      x2="20"
      y2="184"
      stroke="#E4B83F"
      strokeWidth="1.5"
      strokeDasharray="3 3"
      opacity="0.8"
    />
    <line
      x1="160"
      y1="324"
      x2="300"
      y2="184"
      stroke="#E4B83F"
      strokeWidth="1.5"
      strokeDasharray="3 3"
      opacity="0.8"
    />
    <polygon
      points="160,124 260,224 160,324 60,224"
      fill="none"
      stroke="#E4B83F"
      strokeWidth="2.5"
    />
    <polygon
      points="160,134 250,224 160,314 70,224"
      fill="none"
      stroke="#E4B83F"
      strokeWidth="1"
      opacity="0.7"
    />

    {/* Bases */}
    <polygon points="160,118 166,124 160,130 154,124" fill="#E4B83F" />
    <polygon points="260,218 266,224 260,230 254,224" fill="#E4B83F" />
    <polygon points="60,218 66,224 60,230 54,224" fill="#E4B83F" />
    <polygon points="160,332 166,324 166,316 154,316 154,324" fill="#E4B83F" />

    {/* Pitcher's mound + rubber */}
    <circle
      cx="160"
      cy="224"
      r="12"
      fill="#0A1E31"
      stroke="#E4B83F"
      strokeWidth="1.5"
    />
    <rect x="157" y="222" width="6" height="3" fill="#E4B83F" />

    {/* Outfield grandstand tick marks (radiating from 2nd base) */}
    <g
      transform="translate(160, 124)"
      stroke="#E4B83F"
      strokeWidth="2"
      opacity="0.6"
    >
      {[-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75].map((deg) => (
        <line
          key={`out-${deg}`}
          x1="0"
          y1="-25"
          x2="0"
          y2="-38"
          transform={`rotate(${deg})`}
        />
      ))}
    </g>

    {/* Home-plate grandstand tick marks (radiating from home) */}
    <g
      transform="translate(160, 324)"
      stroke="#E4B83F"
      strokeWidth="2"
      opacity="0.6"
    >
      {[-75, -60, -45, -30, -15, 15, 30, 45, 60, 75].map((deg) => (
        <line
          key={`home-${deg}`}
          x1="0"
          y1="25"
          x2="0"
          y2="38"
          transform={`rotate(${deg})`}
        />
      ))}
    </g>

    {/* Central banner (DUGOUT wordmark) */}
    <polygon
      points="-2,224 40,165 280,165 322,224 280,283 40,283"
      fill="#0A1E31"
      stroke="#E4B83F"
      strokeWidth="3"
    />
    <polygon
      points="12,224 48,174 272,174 308,224 272,274 48,274"
      fill="none"
      stroke="#E4B83F"
      strokeWidth="1"
    />
    <line x1="55" y1="182" x2="265" y2="182" stroke="#E4B83F" strokeWidth="1" />
    <line x1="55" y1="266" x2="265" y2="266" stroke="#E4B83F" strokeWidth="1" />

    {/* Top emblem: crossed bats with diamond pip */}
    <g transform="translate(160, 52)">
      <line
        x1="-14"
        y1="-14"
        x2="14"
        y2="14"
        stroke="#E4B83F"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="14"
        y1="-14"
        x2="-14"
        y2="14"
        stroke="#E4B83F"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line x1="-12" y1="-12" x2="-7" y2="-7" stroke="#0A1E31" strokeWidth="1.5" />
      <line x1="12" y1="-12" x2="7" y2="-7" stroke="#0A1E31" strokeWidth="1.5" />
      <polygon
        points="0,-6 6,0 0,6 -6,0"
        fill="#0A1E31"
        stroke="#E4B83F"
        strokeWidth="1.5"
      />
    </g>

    {/* Bottom emblem: stylised baseball */}
    <g transform="translate(160, 396)">
      <circle cx="0" cy="0" r="12" fill="none" stroke="#E4B83F" strokeWidth="2.5" />
      <path
        d="M -7 -8 A 10 10 0 0 0 -7 8"
        fill="none"
        stroke="#E4B83F"
        strokeWidth="1.5"
      />
      <path
        d="M 7 -8 A 10 10 0 0 1 7 8"
        fill="none"
        stroke="#E4B83F"
        strokeWidth="1.5"
      />
    </g>

    {/* Wordmark: SVG <text> so it scales pixel-perfect with the viewBox */}
    <text
      x="160"
      y="244"
      textAnchor="middle"
      fontFamily='"Montserrat", system-ui, sans-serif'
      fontWeight={900}
      fontSize={56}
      fill="#E4B83F"
      letterSpacing="-2"
    >
      DUGOUT
    </text>
  </svg>
);

type DealDirection = 'top' | 'bottom';

// ---------------------------------------------------------------------------
// Animation orchestration shared by the batter HandStrip and the pitcher
// FlipPitcherStrip. Signature cards fly in from the strip's edge with a
// stagger; general-draw cards then sweep in one-by-one from off-screen right
// like they're being pulled from an off-screen deck.
//
// We deliberately do NOT use Framer Motion variants for the per-card entry
// animation. Variants resolve relative to a `custom` prop, and that prop has
// to include the card's index + the strip's signature count to compute the
// stagger delay. While the player drags a card, indices shift on every
// reorder pass; a `custom`-dependent variant therefore re-evaluates on every
// shuffle and motion treats it as a fresh animation target -- which causes
// every card in the strip to look like it's "reloading" mid-drag.
//
// Instead each card snapshots its entry config once at mount via useMemo(())
// and feeds plain `initial` / `animate` objects into its motion component.
// After the entry plays, motion never sees a new target so it can't replay.
// Layout shifts (reorder, drop snap-back) still use ITEM_LAYOUT_TRANSITION,
// keeping drag interactions snappy and decoupled from the entry stagger.
// ---------------------------------------------------------------------------

const SIGNATURE_DELAY_CHILDREN = 0.18;
const SIGNATURE_STAGGER = 0.1;
// Pause after the last signature settles before the deck draw starts.
const SIGNATURE_SETTLE_PAD = 0.55;
// Spacing between successive deck draws; long enough that each card reads as
// an individual "draw" rather than a flurry.
const GENERAL_STAGGER = 0.45;
// Off-screen "deck" position: cards begin far to the right with a slight tilt.
const DECK_OFFSET_X = 700;

interface EntryConfig {
  initial: { opacity: number; x: number; y: number; rotate: number; scale: number };
  animate: {
    opacity: number;
    x: number;
    y: number;
    rotate: number;
    scale: number;
    transition: { type: 'spring'; stiffness: number; damping: number; delay: number };
  };
}

function buildEntryConfig(
  isGeneral: boolean,
  mountIndex: number,
  signatureCount: number,
  fromY: number,
  fromRot: number,
): EntryConfig {
  const lastSigIdx = Math.max(signatureCount - 1, 0);
  const signaturesEndAt = SIGNATURE_DELAY_CHILDREN + lastSigIdx * SIGNATURE_STAGGER;
  const signaturesSettled = signaturesEndAt + SIGNATURE_SETTLE_PAD;

  let delay: number;
  let initial: EntryConfig['initial'];
  if (isGeneral) {
    const generalIdx = mountIndex - signatureCount;
    delay = signaturesSettled + Math.max(generalIdx, 0) * GENERAL_STAGGER;
    initial = { opacity: 0, x: DECK_OFFSET_X, y: 0, rotate: 22, scale: 0.7 };
  } else {
    delay = SIGNATURE_DELAY_CHILDREN + mountIndex * SIGNATURE_STAGGER;
    initial = { opacity: 0, x: 0, y: fromY, rotate: fromRot, scale: 0.55 };
  }

  return {
    initial,
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      rotate: 0,
      scale: 1,
      transition: {
        type: 'spring',
        stiffness: isGeneral ? 200 : 220,
        damping: 22,
        delay,
      },
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
// Used as the `initial` and `animate` props for cards that have already had
// their fly-in animation in this at-bat (e.g. the dragged card on a
// Reorder.Item remount). Forces an immediate paint at the resting position
// with no tween, so the staggered entry never replays mid-drag.
const RESTING_STATE = { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 } as const;
const RESTING_ANIMATE = {
  opacity: 1,
  x: 0,
  y: 0,
  rotate: 0,
  scale: 1,
  transition: { duration: 0 },
} as const;

interface FlipPitcherStripProps {
  hand: CardDefinition[];
  modifiers: Record<string, { value: number; color?: string }>;
  revealed: boolean;
  // Scopes per-card keys so general-pool cards shared between consecutive
  // pitchers don't bleed their flipped state from the previous at-bat.
  atBatId: number;
  compact?: boolean;
  /** Reveal-sequence per-card value pins, keyed by card id. */
  valueOverrides?: Record<string, number>;
  /** Reveal-sequence per-card highlight tones, keyed by card id. */
  highlightTones?: Record<string, 'source' | 'target'>;
}

/**
 * Pitcher hand that always renders the real cards underneath but presents them
 * face-down until `revealed` flips to true. Cards only mount/unmount when the
 * dealt hand actually changes (between at-bats); within the same at-bat the
 * cards stay mounted and flip in place via a 3D rotateY.
 */
const FlipPitcherStrip = ({
  hand,
  modifiers,
  revealed,
  atBatId,
  compact = true,
  valueOverrides,
  highlightTones,
}: FlipPitcherStripProps) => {
  const sz = compact
    ? { card: 'w-20 h-28 rounded-lg', gap: 4, connectedGap: 0 }
    : { card: 'w-32 h-44 rounded-xl', gap: 8, connectedGap: 0 };

  // Deal-in matches the batter strip's vertical fly-in but mirrored on top.
  const fromY = -180;
  const fromRot = -12;
  const signatureCount = hand.filter((c) => c.abilityType !== 'General Draw').length;

  return (
    <motion.div
      className="flex flex-row items-center justify-center"
      style={{ perspective: '1200px' }}
    >
      <AnimatePresence>
        {hand.map((card, index) => {
          const isConnectedLeft = index > 0 && canConnect(hand[index - 1], card);
          const isConnectedRight = index < hand.length - 1 && canConnect(card, hand[index + 1]);
          const modifier = modifiers[card.id];
          const isGeneral = card.abilityType === 'General Draw';
          return (
            <PitcherCard
              key={`${atBatId}-${card.id}`}
              card={card}
              index={index}
              handLength={hand.length}
              signatureCount={signatureCount}
              isGeneral={isGeneral}
              isConnectedLeft={isConnectedLeft}
              isConnectedRight={isConnectedRight}
              modifier={modifier}
              revealed={revealed}
              compact={compact}
              sz={sz}
              fromY={fromY}
              fromRot={fromRot}
              valueOverride={valueOverrides?.[card.id]}
              highlightTone={highlightTones?.[card.id]}
            />
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
};

interface PitcherCardProps {
  card: CardDefinition;
  index: number;
  handLength: number;
  signatureCount: number;
  isGeneral: boolean;
  isConnectedLeft: boolean;
  isConnectedRight: boolean;
  modifier: { value: number; color?: string } | undefined;
  revealed: boolean;
  compact: boolean;
  sz: { card: string; gap: number; connectedGap: number };
  fromY: number;
  fromRot: number;
  valueOverride?: number;
  highlightTone?: 'source' | 'target' | null;
}

/**
 * Single pitcher card. Captures its entry stagger delay at MOUNT only, so a
 * later re-render (e.g. driven by a sibling drag) cannot replay the flight.
 */
const PitcherCard = ({
  card,
  index,
  handLength,
  signatureCount,
  isGeneral,
  isConnectedLeft,
  isConnectedRight,
  modifier,
  revealed,
  compact,
  sz,
  fromY,
  fromRot,
  valueOverride,
  highlightTone,
}: PitcherCardProps) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => buildEntryConfig(isGeneral, index, signatureCount, fromY, fromRot), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const exitConfig = useMemo(
    () => ({
      opacity: 0,
      y: -fromY * 0.5,
      rotate: -fromRot,
      scale: 0.6,
      transition: makeItemExitTransition(handLength, index),
    }),
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flipDelay = useMemo(() => 0.1 + index * 0.12, []);

  return (
    <motion.div
      layout
      className={`relative ${sz.card}`}
      style={{
        marginLeft: isConnectedLeft ? `${sz.connectedGap}px` : `${sz.gap}px`,
        marginRight: isConnectedRight ? `${sz.connectedGap}px` : `${sz.gap}px`,
        transformStyle: 'preserve-3d',
      }}
      initial={entry.initial}
      animate={entry.animate}
      exit={exitConfig}
      transition={ITEM_LAYOUT_TRANSITION}
    >
      {/* Inner element does the in-place flip from back -> front. */}
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: revealed ? 180 : 0 }}
        transition={{
          duration: 0.7,
          delay: revealed ? flipDelay : 0,
          ease: [0.4, 0, 0.2, 1],
        }}
      >
        {/* Back face (face-down card design). */}
        <div
          className={`absolute inset-0 ${sz.card} shadow-xl overflow-hidden`}
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          <CardBack />
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
            valueOverride={valueOverride}
            highlightTone={highlightTone}
          />
        </div>
      </motion.div>
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
  /** Reveal-sequence per-card value pins, keyed by card id. */
  valueOverrides?: Record<string, number>;
  /** Reveal-sequence per-card highlight tones, keyed by card id. */
  highlightTones?: Record<string, 'source' | 'target'>;
  /**
   * User-affirmed connection seams (seamKey-encoded). When provided, two
   * adjacent cards are only rendered as connected if their seam is in this
   * set -- the player must drag one onto the other for a connection to
   * form. When omitted (pitcher strip / reveal phases), the strip falls
   * back to legacy auto-connect on canConnect alone.
   */
  affirmedSeams?: ReadonlySet<string>;
  /**
   * Called on drag-end with the dropped card's id so the store can affirm
   * its new neighbors. Optional -- read-only strips (reveal phase, pitcher
   * peek) leave it undefined.
   */
  onAffirmConnections?: (cardId: string) => void;
  /**
   * Card ids that have an unresolved player-choice prompt for the user's
   * current seat. Cards in this set render a "USE" trigger pill. Omit on
   * the AI strip (no AI-side prompts are user-triggerable).
   */
  pendingChoiceIds?: ReadonlySet<string>;
  /**
   * Card id whose choice modal is currently open, if any. Used to highlight
   * the corresponding pill so the player can tell which card the modal
   * belongs to once it's open.
   */
  activeChoiceCardId?: string | null;
  /**
   * Click handler for the "USE" pill. Receives the card id; the store's
   * `triggerChoice` opens the modal. Required when `pendingChoiceIds` is
   * provided.
   */
  onTriggerChoice?: (cardId: string) => void;
  /**
   * When true, the FIRST card in this strip gets `data-tutorial-card="true"`
   * plus `data-tutorial="card-{value,shapes,ability}"` markers on its
   * value, shape-connector, and hover-panel regions. The Learn-to-Play
   * overlay uses these for region-specific spotlights. Other strips
   * (opponent, reveal-only) leave this off.
   */
  tutorialFirstCard?: boolean;
}

const HandStrip = ({
  hand,
  onReorder,
  modifiers,
  disabled = false,
  atBatId,
  compact = false,
  direction = 'bottom',
  valueOverrides,
  highlightTones,
  affirmedSeams,
  onAffirmConnections,
  pendingChoiceIds,
  activeChoiceCardId,
  onTriggerChoice,
  tutorialFirstCard = false,
}: HandStripProps) => {
  // Signature cards fly in from the screen edge they belong to (pitcher drops
  // from above, batter rises up from below); general-draw cards then sweep in
  // horizontally from off-screen right like they're being drawn from a deck.
  const fromY = direction === 'top' ? -180 : 180;
  const fromRot = direction === 'top' ? -12 : 12;
  const signatureCount = hand.filter((c) => c.abilityType !== 'General Draw').length;

  // Live drag-time can-connect feedback. While the user is dragging a card we
  // mark each side of each card with 'allow' (green) or 'block' (red) based on
  // whether the current arrangement would form a connection at that seam. Only
  // the seams that touch the dragged card light up, so the hint is focused.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Capture the in-flight drag id in a ref so handleDragEnd can fire the
  // affirm action without recreating its callback on every render (the
  // setState path in handleDragEnd is async, so reading state directly
  // there is unreliable).
  const draggingIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
    draggingIdRef.current = id;
  }, []);
  const handleDragEnd = useCallback(() => {
    const id = draggingIdRef.current;
    draggingIdRef.current = null;
    setDraggingId(null);
    // The drop is the affirming gesture: tell the store to recompute
    // affirmedSeams against the fresh hand order. Re-affirms the dropped
    // card's new left/right seams (if mechanically connectable) and prunes
    // any seams the reorder broke.
    if (id && onAffirmConnections) onAffirmConnections(id);
  }, [onAffirmConnections]);

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

  // Track which cards have already played their entry animation in this at-bat.
  // We need this because Framer Motion's `Reorder.Item` internally unmounts +
  // remounts the dragged card during reorder swaps. Without this guard, every
  // swap replays the staggered entry animation (which starts at opacity:0,
  // scale:0.55) -- to the user, the dragged card "disappears and reloads in"
  // every time it crosses over a sibling. Storing a Set in a ref lets us
  // remember "this card already had its entry" across remounts, since the
  // `key` (atBatId-cardId) stays stable across the bug.
  const entryPlayedRef = useRef<{ atBatId: number; cards: Set<string> }>({
    atBatId,
    cards: new Set(),
  });
  if (entryPlayedRef.current.atBatId !== atBatId) {
    entryPlayedRef.current = { atBatId, cards: new Set() };
  }
  const markEntryPlayed = useCallback((cardId: string) => {
    entryPlayedRef.current.cards.add(cardId);
  }, []);

  return (
    <Reorder.Group
      axis="x"
      values={hand}
      onReorder={onReorder}
      className="flex flex-row items-center justify-center list-none p-0 m-0"
      style={{ pointerEvents: disabled ? 'none' : undefined }}
    >
      {/*
        Intentionally NO <AnimatePresence> here: cards in the batter hand are
        never added/removed mid-at-bat (deal-time discards happen before this
        renders), and wrapping in AnimatePresence with `layout` Reorder.Item
        children plays badly with Framer's reorder swaps.
      */}
      {hand.map((card, index) => {
          // A seam is "connected" only if (a) the mechanic allows it
          // (canConnect) AND (b) the user has affirmed it. When the strip
          // doesn't get an `affirmedSeams` set (pitcher strip, reveal phase),
          // we fall back to legacy auto-connect so existing flows aren't
          // broken.
          const seamLeftAffirmed =
            index > 0 &&
            (affirmedSeams === undefined ||
              affirmedSeams.has(seamKey(hand[index - 1].id, card.id)));
          const seamRightAffirmed =
            index < hand.length - 1 &&
            (affirmedSeams === undefined ||
              affirmedSeams.has(seamKey(card.id, hand[index + 1].id)));
          const isConnectedLeft =
            index > 0 && canConnect(hand[index - 1], card) && seamLeftAffirmed;
          const isConnectedRight =
            index < hand.length - 1 &&
            canConnect(card, hand[index + 1]) &&
            seamRightAffirmed;
          const modifier = modifiers[card.id];
          const hintForCard = hints[index];
          const isGeneral = card.abilityType === 'General Draw';
          const skipEntryAnim = entryPlayedRef.current.cards.has(card.id);
          const hasPendingChoice =
            pendingChoiceIds?.has(card.id) ?? false;
          return (
            <HandCard
              key={`${atBatId}-${card.id}`}
              card={card}
              index={index}
              handLength={hand.length}
              signatureCount={signatureCount}
              isGeneral={isGeneral}
              isConnectedLeft={isConnectedLeft}
              isConnectedRight={isConnectedRight}
              modifier={modifier}
              compact={compact}
              leftHint={hintForCard?.left}
              rightHint={hintForCard?.right}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              fromY={fromY}
              fromRot={fromRot}
              skipEntryAnim={skipEntryAnim}
              onEntryPlayed={markEntryPlayed}
              valueOverride={valueOverrides?.[card.id]}
              highlightTone={highlightTones?.[card.id]}
              dragActive={draggingId !== null}
              hasPendingChoice={hasPendingChoice}
              isChoiceActive={
                hasPendingChoice && activeChoiceCardId === card.id
              }
              onTriggerChoice={
                hasPendingChoice && onTriggerChoice
                  ? () => onTriggerChoice(card.id)
                  : undefined
              }
              tutorialRegions={tutorialFirstCard && index === 0}
            />
          );
        })}
    </Reorder.Group>
  );
};

interface HandCardProps {
  card: CardDefinition;
  index: number;
  handLength: number;
  signatureCount: number;
  isGeneral: boolean;
  isConnectedLeft: boolean;
  isConnectedRight: boolean;
  modifier: { value: number; color?: string } | undefined;
  compact: boolean;
  leftHint?: ConnectHint;
  rightHint?: ConnectHint;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  fromY: number;
  fromRot: number;
  valueOverride?: number;
  highlightTone?: 'source' | 'target' | null;
  /**
   * True while ANY card in the strip is being actively dragged. Forwarded
   * to CardItem -> ShapeHalf so the connection celebrations stay quiet
   * while the player is rearranging their hand.
   */
  dragActive?: boolean;
  /**
   * True if this card has already played its entry animation in the current
   * at-bat. When true, the card mounts directly at its resting state instead
   * of replaying the staggered fly-in (this matters because Framer Motion's
   * `Reorder.Item` internally remounts the dragged card on every reorder
   * swap, which without this guard would look like the card "disappears and
   * reloads in" mid-drag).
   */
  skipEntryAnim?: boolean;
  /**
   * Called once after the first commit so the parent can remember "this card
   * already had its entry" and feed `skipEntryAnim` back on remount.
   */
  onEntryPlayed: (cardId: string) => void;
  /**
   * True when this card has an unresolved player-choice prompt waiting for
   * the user. Renders a "USE" pill above the card; clicking it fires
   * `onTriggerChoice` to open the modal.
   */
  hasPendingChoice?: boolean;
  /**
   * True when the choice modal is currently open for this card. Used to
   * upgrade the pill's tone (filled amber vs. outlined) so the player can
   * see at a glance which card the modal belongs to.
   */
  isChoiceActive?: boolean;
  /**
   * Click handler for the "USE" pill. Defined only when the card has an
   * actual pending choice -- otherwise the pill is suppressed entirely.
   */
  onTriggerChoice?: () => void;
  /**
   * When true, region-specific `data-tutorial` attributes are added to
   * this card so the Learn-to-Play overlay can spotlight value, shape
   * connectors, and the ability hover panel individually. Only the FIRST
   * card in the user's hand strip flips this flag.
   */
  tutorialRegions?: boolean;
}

/**
 * Single batter card. Captures its entry stagger delay at MOUNT only -- never
 * recomputed when the parent re-renders, so reorder shuffles cannot replay
 * the deck-draw / fly-in animations mid-drag.
 */
const HandCard = ({
  card,
  index,
  handLength,
  signatureCount,
  isGeneral,
  isConnectedLeft,
  isConnectedRight,
  modifier,
  compact,
  leftHint,
  rightHint,
  onDragStart,
  onDragEnd,
  fromY,
  fromRot,
  valueOverride,
  highlightTone,
  dragActive = false,
  skipEntryAnim = false,
  onEntryPlayed,
  hasPendingChoice = false,
  isChoiceActive = false,
  onTriggerChoice,
  tutorialRegions = false,
}: HandCardProps) => {
  useEffect(() => {
    onEntryPlayed(card.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => buildEntryConfig(isGeneral, index, signatureCount, fromY, fromRot), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const exitConfig = useMemo(
    () => ({
      opacity: 0,
      y: -fromY * 0.5,
      rotate: -fromRot,
      scale: 0.6,
      transition: makeItemExitTransition(handLength, index),
    }),
    [],
  );
  const handleDragStart = useCallback(() => onDragStart(card.id), [onDragStart, card.id]);

  return (
    <Reorder.Item
      value={card}
      className="relative"
      layout
      // When this card has already played its entry once in this at-bat, skip
      // the staggered fly-in on subsequent mounts. We can't use
      // `initial={false}` here because Framer's Reorder.Item still applies
      // entry's offset/scale/rotation when remounted mid-drag (verified via
      // computed-style logging: `initial={false}` left the dragged card at
      // opacity:0, scale:0.55, y:+212 mid-swap). We also have to override
      // `animate` to drop the staggered entry delay -- otherwise Framer
      // tweens from RESTING_STATE -> entry.animate over the original
      // (delayed) transition, which still leaks the staggered initial.
      // Setting both ends to the resting state with a 0-duration transition
      // makes the remounted card paint immediately at its slot.
      initial={skipEntryAnim ? RESTING_STATE : entry.initial}
      animate={skipEntryAnim ? RESTING_ANIMATE : entry.animate}
      exit={exitConfig}
      transition={ITEM_LAYOUT_TRANSITION}
      dragTransition={ITEM_DRAG_TRANSITION}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
    >
      <CardItem
        card={card}
        isConnectedLeft={isConnectedLeft}
        isConnectedRight={isConnectedRight}
        modifier={modifier}
        compact={compact}
        leftHint={leftHint}
        rightHint={rightHint}
        valueOverride={valueOverride}
        highlightTone={highlightTone}
        dragActive={dragActive}
        tutorialRegions={tutorialRegions}
      />
      {hasPendingChoice && onTriggerChoice && (
        <UseAbilityPill
          active={isChoiceActive}
          onClick={onTriggerChoice}
        />
      )}
    </Reorder.Item>
  );
};

/**
 * Floating "USE" pill anchored just above a card. Renders only when the
 * card has an unresolved player-choice prompt for the user; clicking it
 * fires `triggerChoice` to open the modal. We stop pointer/click
 * propagation so Framer's Reorder.Item drag doesn't kick in when the
 * player taps the pill (the card body is still draggable normally).
 *
 * Two visual states:
 *  - resting (active=false): amber pulse + soft shadow, the "you have an
 *    ability ready" hint.
 *  - active (active=true): solid filled chip in the same amber, signals
 *    "the modal you see right now belongs to this card".
 */
function UseAbilityPill({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: 6, scale: 0.85 }}
      animate={
        active
          ? { opacity: 1, y: 0, scale: 1 }
          : {
              opacity: 1,
              y: 0,
              scale: [1, 1.06, 1],
              transition: { scale: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } },
            }
      }
      exit={{ opacity: 0, y: 6, scale: 0.85, transition: { duration: 0.15 } }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.92 }}
      className={`absolute -top-3 left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg cursor-pointer select-none whitespace-nowrap border transition-colors ${
        active
          ? 'bg-amber-400 text-slate-900 border-amber-300 shadow-amber-500/50'
          : 'bg-slate-900 text-amber-300 border-amber-400 shadow-amber-500/40 hover:bg-amber-400 hover:text-slate-900'
      }`}
      aria-label="Use ability"
    >
      ⚡ Use
    </motion.button>
  );
}

// ===========================================================================
// Reveal-sequence orchestrator
// ===========================================================================

interface RevealOrchestratorInput {
  phase: string;
  script: ResolutionBeat[];
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  finalBatterScore: number;
  finalPitcherScore: number;
  onComplete: () => void;
}

interface RevealOrchestratorOutput {
  displayedBatter: number;
  displayedPitcher: number;
  batterValueOverrides: Record<string, number>;
  pitcherValueOverrides: Record<string, number>;
  batterHighlights: Record<string, 'source' | 'target'>;
  pitcherHighlights: Record<string, 'source' | 'target'>;
  batterBanner: ScoreBanner | null;
  pitcherBanner: ScoreBanner | null;
}

/**
 * Walks `script` with a setTimeout chain, exposing the current displayed
 * scores, per-card value overrides, per-card highlights, and any active
 * banners. Idle (returns the final lock-in totals untouched) when the phase
 * isn't `revealing`. Always cleans up its timers on unmount or phase change
 * so a `reset` mid-sequence can't leak handles.
 */
function useRevealOrchestrator({
  phase,
  script,
  batterHand,
  pitcherHand,
  finalBatterScore,
  finalPitcherScore,
  onComplete,
}: RevealOrchestratorInput): RevealOrchestratorOutput {
  const [displayedBatter, setDisplayedBatter] = useState(finalBatterScore);
  const [displayedPitcher, setDisplayedPitcher] = useState(finalPitcherScore);
  const [batterOverrides, setBatterOverrides] = useState<Record<string, number>>({});
  const [pitcherOverrides, setPitcherOverrides] = useState<Record<string, number>>({});
  const [batterHighlights, setBatterHighlights] = useState<Record<string, 'source' | 'target'>>({});
  const [pitcherHighlights, setPitcherHighlights] = useState<Record<string, 'source' | 'target'>>({});
  const [batterBanner, setBatterBanner] = useState<ScoreBanner | null>(null);
  const [pitcherBanner, setPitcherBanner] = useState<ScoreBanner | null>(null);

  // Stash latest props in refs so the orchestrator effect can read them
  // without re-running every time React re-renders the parent.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  const finalRef = useRef({ b: finalBatterScore, p: finalPitcherScore });
  useEffect(() => {
    finalRef.current = { b: finalBatterScore, p: finalPitcherScore };
  }, [finalBatterScore, finalPitcherScore]);

  useEffect(() => {
    if (phase !== 'revealing') {
      // Reset visual state so the next reveal starts clean.
      setBatterOverrides({});
      setPitcherOverrides({});
      setBatterHighlights({});
      setPitcherHighlights({});
      setBatterBanner(null);
      setPitcherBanner(null);
      // Snap displayed scores to current finals (even outside revealing the
      // pills should track the source of truth).
      setDisplayedBatter(finalRef.current.b);
      setDisplayedPitcher(finalRef.current.p);
      return;
    }

    // Build the at-bat baseline: each side's displayed total BEFORE any
    // beats fire. We start from the final score and back out every beat's
    // delta so the sequence walks forward from baseline -> final.
    const initialBatter = computeBaseline(finalRef.current.b, script, 'Batting');
    const initialPitcher = computeBaseline(finalRef.current.p, script, 'Pitching');
    let runningBatter = initialBatter;
    let runningPitcher = initialPitcher;
    setDisplayedBatter(initialBatter);
    setDisplayedPitcher(initialPitcher);
    setBatterOverrides({});
    setPitcherOverrides({});
    setBatterHighlights({});
    setPitcherHighlights({});
    setBatterBanner(null);
    setPitcherBanner(null);

    const cardLookup = new Map<string, CardDefinition>();
    for (const c of batterHand) cardLookup.set(c.id, c);
    for (const c of pitcherHand) cardLookup.set(c.id, c);

    const timers: ReturnType<typeof setTimeout>[] = [];
    const tweens: Array<() => void> = [];

    const schedule = (delayMs: number, fn: () => void) => {
      timers.push(setTimeout(fn, delayMs));
    };

    // Each beat occupies a fixed window. Drives the highlight, the override,
    // the score-pill tween, and the banner. Cleared at end-of-window.
    let cursor = REVEAL_FLIP_WAIT_MS + REVEAL_DWELL_MS;

    if (script.length === 0) {
      // Empty script: still wait for the flip + a dwell so the player sees
      // the cards turn over, then snap and complete.
      schedule(cursor + REVEAL_FINAL_PAUSE_MS, () => {
        setDisplayedBatter(finalRef.current.b);
        setDisplayedPitcher(finalRef.current.p);
        onCompleteRef.current();
      });
    } else {
      for (let i = 0; i < script.length; i++) {
        const beat = script[i];
        const startAt = cursor;
        const endAt = cursor + REVEAL_BEAT_MS;

        schedule(startAt, () => {
          applyBeatStart(beat, {
            cardLookup,
            runningBatter,
            runningPitcher,
            setDisplayedBatter,
            setDisplayedPitcher,
            setBatterOverrides,
            setPitcherOverrides,
            setBatterHighlights,
            setPitcherHighlights,
            setBatterBanner,
            setPitcherBanner,
            beatIndex: i,
            tweens,
          });
        });

        // Update running totals so the NEXT beat tweens from the right place.
        const next = applyBeatToRunning(beat, runningBatter, runningPitcher);
        runningBatter = next.batter;
        runningPitcher = next.pitcher;

        schedule(endAt, () => {
          // Clear highlights + banner at the end of each beat window so the
          // next beat starts visually fresh. Value overrides PERSIST so the
          // affected card keeps its new number for the rest of the sequence.
          setBatterHighlights({});
          setPitcherHighlights({});
          setBatterBanner(null);
          setPitcherBanner(null);
        });

        cursor = endAt;
      }

      // Final pause + snap + complete. The snap protects against rounding
      // drift in the rAF lerps and ensures the banner-less end state matches
      // `lastBatter/PitcherScore` exactly.
      schedule(cursor + REVEAL_FINAL_PAUSE_MS, () => {
        setDisplayedBatter(finalRef.current.b);
        setDisplayedPitcher(finalRef.current.p);
        onCompleteRef.current();
      });
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      for (const stop of tweens) stop();
    };
    // batterHand / pitcherHand are stable across the reveal; including them
    // would re-trigger the effect mid-sequence on the rare deal-time mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, script]);

  return {
    displayedBatter,
    displayedPitcher,
    batterValueOverrides: batterOverrides,
    pitcherValueOverrides: pitcherOverrides,
    batterHighlights,
    pitcherHighlights,
    batterBanner,
    pitcherBanner,
  };
}

/**
 * Walk the script in reverse subtracting each beat's effect from the final
 * total to recover the pre-effect baseline. Used as the orchestrator's start
 * point so beats visibly tick the score upward (or downward) toward the
 * locked-in final.
 */
function computeBaseline(
  finalScore: number,
  script: ResolutionBeat[],
  side: 'Batting' | 'Pitching',
): number {
  let v = finalScore;
  for (const beat of script) {
    const delta = scoreDeltaForSide(beat, side);
    v -= delta;
  }
  return v;
}

function scoreDeltaForSide(
  beat: ResolutionBeat,
  side: 'Batting' | 'Pitching',
): number {
  switch (beat.kind) {
    case 'selfModifier': {
      // A self-modifier on side X moves side X's score by (final - base).
      if (beat.side !== side) return 0;
      return beat.finalValue - beat.baseValue;
    }
    case 'targetedDebuff': {
      // The delta lands on the targetSide (the affected side).
      if (beat.targetSide !== side) return 0;
      return beat.delta;
    }
    case 'aggregateDebuff': {
      if (beat.affectedSide !== side) return 0;
      return beat.delta;
    }
    case 'crossDebuff': {
      if (beat.affectedSide !== side) return 0;
      return beat.delta;
    }
    case 'guessPitchHit': {
      // Always hits the batter (b-65 is a batter card).
      if (side !== 'Batting') return 0;
      return beat.delta;
    }
  }
}

interface ApplyBeatStartCtx {
  cardLookup: Map<string, CardDefinition>;
  runningBatter: number;
  runningPitcher: number;
  setDisplayedBatter: (v: number) => void;
  setDisplayedPitcher: (v: number) => void;
  setBatterOverrides: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setPitcherOverrides: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setBatterHighlights: React.Dispatch<React.SetStateAction<Record<string, 'source' | 'target'>>>;
  setPitcherHighlights: React.Dispatch<React.SetStateAction<Record<string, 'source' | 'target'>>>;
  setBatterBanner: React.Dispatch<React.SetStateAction<ScoreBanner | null>>;
  setPitcherBanner: React.Dispatch<React.SetStateAction<ScoreBanner | null>>;
  beatIndex: number;
  tweens: Array<() => void>;
}

function applyBeatStart(beat: ResolutionBeat, ctx: ApplyBeatStartCtx) {
  const next = applyBeatToRunning(beat, ctx.runningBatter, ctx.runningPitcher);
  const stopBatter = tweenNumber(ctx.setDisplayedBatter, ctx.runningBatter, next.batter, REVEAL_TWEEN_MS);
  const stopPitcher = tweenNumber(ctx.setDisplayedPitcher, ctx.runningPitcher, next.pitcher, REVEAL_TWEEN_MS);
  ctx.tweens.push(stopBatter, stopPitcher);

  switch (beat.kind) {
    case 'selfModifier': {
      const setter = beat.side === 'Batting' ? ctx.setBatterOverrides : ctx.setPitcherOverrides;
      const highlightSetter = beat.side === 'Batting' ? ctx.setBatterHighlights : ctx.setPitcherHighlights;
      setter((prev) => ({ ...prev, [beat.cardId]: beat.finalValue }));
      highlightSetter((prev) => ({ ...prev, [beat.cardId]: 'source' }));
      break;
    }
    case 'targetedDebuff': {
      const sourceSetter = beat.sourceSide === 'Batting' ? ctx.setBatterHighlights : ctx.setPitcherHighlights;
      const targetSetter = beat.targetSide === 'Batting' ? ctx.setBatterHighlights : ctx.setPitcherHighlights;
      const targetOverride = beat.targetSide === 'Batting' ? ctx.setBatterOverrides : ctx.setPitcherOverrides;
      sourceSetter((prev) => ({ ...prev, [beat.sourceCardId]: 'source' }));
      targetSetter((prev) => ({ ...prev, [beat.targetCardId]: 'target' }));
      // Drop the target card's number by `delta`. We add to whatever override
      // already pinned that card (e.g. b-2 + b-2 stack visually).
      targetOverride((prev) => {
        const card = ctx.cardLookup.get(beat.targetCardId);
        const baseline = prev[beat.targetCardId] ?? card?.baseValue ?? 0;
        return { ...prev, [beat.targetCardId]: baseline + beat.delta };
      });
      break;
    }
    case 'aggregateDebuff': {
      const sourceSetter = beat.sourceSide === 'Batting' ? ctx.setBatterHighlights : ctx.setPitcherHighlights;
      const bannerSetter = beat.affectedSide === 'Batting' ? ctx.setBatterBanner : ctx.setPitcherBanner;
      sourceSetter((prev) => ({ ...prev, [beat.sourceCardId]: 'source' }));
      const card = ctx.cardLookup.get(beat.sourceCardId);
      bannerSetter({
        key: `agg-${ctx.beatIndex}`,
        label: beat.label,
        delta: beat.delta,
        accentClass: card?.color,
      });
      break;
    }
    case 'crossDebuff': {
      const bannerSetter = beat.affectedSide === 'Batting' ? ctx.setBatterBanner : ctx.setPitcherBanner;
      bannerSetter({
        key: `cross-${ctx.beatIndex}`,
        label: beat.label,
        delta: beat.delta,
      });
      break;
    }
    case 'guessPitchHit': {
      // Light up the b-65 card itself so the player SEES Guess Pitch
      // fire alongside the banner -- same treatment any other source-
      // attributable effect gets. Without this, the +4 / +1 used to
      // appear on the pill with no visual anchor on the strip and read
      // as "the pill just changed for some reason".
      ctx.setBatterHighlights((prev) => ({ ...prev, [beat.sourceCardId]: 'source' }));
      ctx.setBatterBanner({
        key: `guess-${ctx.beatIndex}`,
        label: 'Guess Pitch',
        delta: beat.delta,
        accentClass: 'bg-amber-400',
      });
      break;
    }
  }
}

function applyBeatToRunning(
  beat: ResolutionBeat,
  runningBatter: number,
  runningPitcher: number,
): { batter: number; pitcher: number } {
  return {
    batter: runningBatter + scoreDeltaForSide(beat, 'Batting'),
    pitcher: runningPitcher + scoreDeltaForSide(beat, 'Pitching'),
  };
}

/**
 * Lightweight rAF-driven number tween. Returns a cancel function. Rounded so
 * the score pill never shows a non-integer score during a beat.
 */
function tweenNumber(
  setter: (v: number) => void,
  from: number,
  to: number,
  durationMs: number,
): () => void {
  if (from === to || durationMs <= 0) {
    setter(to);
    return () => {};
  }
  const start = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    setter(Math.round(from + (to - from) * eased));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

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
