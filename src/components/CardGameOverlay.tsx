import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Reorder, motion, AnimatePresence } from 'motion/react';
import { CardDefinition } from '../lib/cards';
import { canConnect, canConnectAny, shapeModeForSide, seamKey } from '../lib/connect';
import { useGameStore, getUiUserSide, isLowLeverageAtBat, ResolutionBeat, RevealBeatAnimation, Phase, BRAWL_SNAP_DURATION_MS as BRAWL_SNAP_DURATION_MS_STORE } from '../lib/gameStore';
import { HitOutcome, type BrawlOutcomeResolution } from '../lib/scoring';
import { playSfx } from '../lib/sfx';
import { ConnectHint, ShapeMode, SHAPE_COLORS, SHAPE_DEFAULTS, SHAPE_LABEL, ShapeHalfProps, ShapeType } from './cardShapes';
import { SznEdgeHalf } from './SznEdgeHalf';
import type { SznEdgeId } from '../lib/sznEdges';
import { PlayerHero } from './PlayerHero';
import { ManagerHand } from './ManagerHand';
import { QuestStrip } from './QuestStrip';
import {
  BrawlAttackOverlay,
  useBrawlAttackReveal,
  type BrawlShakePulse,
} from './brawl/BrawlAttackReveal';
import { BrawlDraftOverlay } from './brawl/BrawlDraftOverlay';
import type { BrawlAura } from './brawl/BrawlImpactCanvas';
import { teamPalette } from '../lib/teamColors';
import { RARITY_BASE_VALUE } from '../lib/run';
import { displayValueFor, rarityLabel, RARITY_GRADIENT } from '../lib/cardDisplay';
import { activeSynergies, teamBatterBonus, teamPitcherBonus } from '../lib/synergies';
import { PLAYERS } from '../lib/players';
import { ALL_SZN_PLAYERS, isSznPlayer } from '../lib/sznPlayers';
import { useSznGamepad, useGamepadPresent } from '../lib/useSznGamepad';

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

/** Portaled hover UI: above modals (≈50–60), tutorial (45), and overflow clips. */
const HOVER_LAYER_Z_CLASS = 'z-[10000]';

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

// Exported so the BrawlDraftOverlay can render draft picks in the
// same visual language as the in-hand cards. The component is large
// and mostly hand-specific (drag hints, equipped item slots, reveal
// highlights), but `readOnly` + neutral connection flags make it
// safe to mount in a static picker context too.
export const CardItem = ({
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
  readOnly = false,
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
  /**
   * Selection-only hand: false. After lock-in / during reveal+result the strip
   * is non-draggable but should still receive hover (ability tooltips).
   */
  readOnly?: boolean;
}) => {
  const equippedItemIdsRaw = useGameStore((s) => s.equippedItems[card.id]);
  const equippedItemIds = equippedItemIdsRaw || [];
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
  // SZN Mode: cards whose abilityType is "Player" represent an MLB player
  // dropped into the hand strip. They're rendered with team colors, the
  // tier-based combat value, and no ability tooltip. The id format is
  // `player:${player.id}` (set by `playerAsCard` in connect.ts).
  //
  // The lookup spans BOTH player registries (legacy `PLAYERS` for
  // Quick-Match / Auction Draft + `ALL_SZN_PLAYERS` for SZN runs). The
  // previous baseline only checked legacy PLAYERS, so every SZN
  // player-card landed with `playerForCard = null`, which collapsed
  // `playerPalette` to null and fell through the team-gradient inline
  // style -- the card body then rendered fully transparent (no
  // background class either) and the user saw a colorless, see-through
  // card during at-bats. Joining both registries restores the team
  // gradient for every SZN player while still preserving the legacy
  // path for the non-SZN modes.
  const isPlayerCard = card.abilityType === 'Player';
  const playerForCard = isPlayerCard
    ? (PLAYERS.find((p) => `player:${p.id}` === card.id) ??
        ALL_SZN_PLAYERS.find((p) => `player:${p.id}` === card.id)) ?? null
    : null;
  const playerRarity = useGameStore((s) => {
    if (!isPlayerCard || !playerForCard || !s.run) return 'common' as const;
    // Look in both the user's roster and the ghost's roster so the AI
    // hand also renders with the correct rarity value during a series.
    const inUser = s.run.roster.find((r) => r.player.id === playerForCard.id);
    if (inUser) return inUser.rarity;
    const inGhost = s.run.ghost?.roster.find(
      (r) => r.player.id === playerForCard.id,
    );
    return inGhost?.rarity ?? 'common';
  });
  // SZN mode: the legacy `card.player` field on items is real-world
  // attribution (e.g. "Mike Trout (2024)") that has nothing to do with
  // the user's signed roster. Hide it on item cards so the only player
  // names visible in SZN combat are the actual MlbPlayer cards. Player
  // cards (`isPlayerCard`) skip this branch entirely -- they render
  // their own portrait + team chrome.
  const sznMode = useGameStore((s) => s.gameMode === 'szn');
  // Brawl Mode: replaces the hover-tooltip ability flow with an inline
  // one-line `brawlTagline` rendered on the card face. The 15s snap
  // timer leaves no room to hover-read multi-clause descriptions, so we
  // also skip the tooltip wiring entirely when this is true.
  const cardBrawlMode = useGameStore((s) => s.gameMode === 'brawl');
  const hideCardPlayer = sznMode && !isPlayerCard;
  // Normalized team + role lookup that works for BOTH player types:
  // SZN players carry `teamId` + `role`, legacy MLB players carry
  // `team` + `role`. Mirroring `PlayerCard.tsx` here keeps the at-bat
  // hand visual identical to every other surface that renders a
  // player.
  const playerTeamCode = playerForCard
    ? (isSznPlayer(playerForCard) ? playerForCard.teamId : playerForCard.team)
    : null;
  const playerRoleCode: 'Batter' | 'Pitcher' | null = playerForCard
    ? playerForCard.role
    : null;
  // Player card body now reads as RARITY first (mirrors `PlayerCard.tsx`
  // and `SznCard` so every player-shaped surface in SZN paints with the
  // same dominant signal). Team is still painted in the top-left team-
  // code chip below. Falls back to the team gradient only when no
  // rarity is resolvable -- defensive against external callers that
  // haven't wired rarity through (legacy MlbPlayer code paths).
  const rarityPalette = isPlayerCard
    ? (RARITY_GRADIENT[playerRarity] ?? null)
    : null;
  const teamPalette_ = playerTeamCode ? teamPalette(playerTeamCode) : null;
  const playerPalette = rarityPalette ?? teamPalette_;
  const playerBaseValue = isPlayerCard ? RARITY_BASE_VALUE[playerRarity] : null;
  // Player cards: `modifier.value` comes from scoring (includes rarity via
  // `baseValue` on the SZN player-as-card). When a modifier exists,
  // `playerBaseValue + playerDelta` equals `modifier.value`.
  const playerDelta =
    isPlayerCard && modifier ? modifier.value - card.baseValue : 0;
  // Combat display value. Player cards build their value from the
  // rarity floor + scoring delta. Item cards use the scored modifier
  // when present; when absent (no snap math contributed) we fall
  // through to `displayValueFor`, which prints the encounter
  // utility tag (SNAP / AURA / DEF / etc.) for zero-base encounter
  // items instead of a literal "0". This is the same helper the
  // footer rail, the merchant preview, and the bag picker use, so
  // a utility item reads the same way in every surface of the game.
  const displayValue: number | string = valueOverride ?? (
    isPlayerCard && playerBaseValue != null
      ? playerBaseValue + playerDelta
      : modifier?.value !== undefined && modifier.value !== 0
        ? modifier.value
        : displayValueFor(card)
  );
  // General Draw cards take on their label color as their card body so they
  // stand out from signature cards (which stay white) on a busy field view.
  // In SZN Mode we also color every Signature card body with its `card.color`
  // so encounter-acquired buff cards (All Rise, etc.) don't show up as a
  // blank white tile in the at-bat hand strip. Legacy Victory / Quick Match
  // still use the classic white-body-with-colored-band design.
  const isGeneralDraw = card.abilityType === 'General Draw';
  const tintAllSignatureCards = sznMode && !isPlayerCard;
  const shouldUseCardColorBody =
    (isGeneralDraw || tintAllSignatureCards) && !!card.color;
  const cardBgClass = isPlayerCard
    // Body color is applied via inline `style.background` for player
    // cards (team gradient). `bg-slate-700` is a safety floor for the
    // theoretical case where neither player registry can resolve the
    // card id -- prevents the legacy "see-through card" bug from ever
    // returning if a future code path ships a player card with an
    // unknown id. Live SZN play always paints over this with the team
    // gradient below.
    ? (playerPalette ? '' : 'bg-slate-700')
    : shouldUseCardColorBody ? card.color! : 'bg-white';
  const defaultValueColor = isPlayerCard
    ? 'text-white'
    : shouldUseCardColorBody ? 'text-white' : 'text-slate-800';
  // Modifier colors recolor the value text to match the source ability -- but
  // only on signature cards. General cards keep white text to stay readable on
  // their colored body (an orange-tagged buff on an orange general would paint
  // the value invisible against the background otherwise). Player cards
  // (SZN Mode) also stay white so the team-color body never washes the
  // tier value into a low-contrast smear.
  const valueColorClass = shouldUseCardColorBody || isPlayerCard
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

  const cardSurfaceRef = useRef<HTMLDivElement>(null);
  const abilityHoverRef = useRef(false);
  const abilityLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [abilityHoverOpen, setAbilityHoverOpen] = useState(false);
  const [abilityAnchor, setAbilityAnchor] = useState<{ cx: number; top: number } | null>(null);

  const clearAbilityLeaveTimer = useCallback(() => {
    if (abilityLeaveTimerRef.current != null) {
      clearTimeout(abilityLeaveTimerRef.current);
      abilityLeaveTimerRef.current = null;
    }
  }, []);

  const openAbilityHover = useCallback(() => {
    clearAbilityLeaveTimer();
    abilityHoverRef.current = true;
    const el = cardSurfaceRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setAbilityAnchor({ cx: r.left + r.width / 2, top: r.top });
    }
    setAbilityHoverOpen(true);
  }, [clearAbilityLeaveTimer]);

  const scheduleCloseAbilityHover = useCallback(() => {
    clearAbilityLeaveTimer();
    abilityLeaveTimerRef.current = setTimeout(() => {
      abilityHoverRef.current = false;
      setAbilityHoverOpen(false);
      setAbilityAnchor(null);
      abilityLeaveTimerRef.current = null;
    }, 120);
  }, [clearAbilityLeaveTimer]);

  useEffect(
    () => () => {
      clearAbilityLeaveTimer();
    },
    [clearAbilityLeaveTimer],
  );

  const syncAbilityAnchor = useCallback(() => {
    const el = cardSurfaceRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAbilityAnchor({ cx: r.left + r.width / 2, top: r.top });
  }, []);

  useEffect(() => {
    if (!abilityHoverOpen) return;
    const onScrollOrResize = () => syncAbilityAnchor();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [abilityHoverOpen, syncAbilityAnchor]);

  const abilityTooltip =
    !cardBrawlMode &&
    abilityHoverOpen &&
    abilityAnchor &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        data-tutorial={tutorialRegions ? 'card-ability' : undefined}
        className={`pointer-events-auto fixed ${HOVER_LAYER_Z_CLASS} w-64 max-w-[calc(100vw-1.25rem)] max-h-[min(85vh,32rem)] overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 p-3 shadow-2xl sm:w-72`}
        style={{
          left: abilityAnchor.cx,
          top: abilityAnchor.top,
          transform: 'translate(-50%, calc(-100% - 8px))',
        }}
        role="tooltip"
        onPointerEnter={openAbilityHover}
        onPointerLeave={scheduleCloseAbilityHover}
      >
        <div className="mb-1.5 border-b border-slate-700 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
          Ability
        </div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="truncate text-[11px] font-black uppercase tracking-tight leading-none text-white">
            {card.name}
          </div>
          {/* Hide the "EncounterItem" pill -- it's tagged on every SZN
              item and adds no signal next to the card name. Other
              ability types (General Draw, Player, signature roles)
              still render their tag for context. */}
          {card.abilityType !== 'EncounterItem' && (
            <div
              className={`shrink-0 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white ${card.color || 'bg-slate-700'}`}
            >
              {card.abilityType}
            </div>
          )}
        </div>
        {!hideCardPlayer && card.player && (
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
            {card.player}
          </div>
        )}
        <div className="text-xs font-medium leading-snug text-slate-300">{card.description}</div>
      </div>,
      document.body,
    );

  return (
    <>
      {abilityTooltip}
      <motion.div
        ref={cardSurfaceRef}
        data-tutorial={tutorialRegions ? 'card-shapes' : undefined}
        data-card-id={card.id}
        className={`
        relative ${sz.card} ${cardBgClass} border-2 overflow-hidden
        flex flex-col items-center justify-center
        ${readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
      `}
        onPointerEnter={isPlayerCard || cardBrawlMode ? undefined : openAbilityHover}
        onPointerLeave={isPlayerCard || cardBrawlMode ? undefined : scheduleCloseAbilityHover}
        onPointerMove={() => {
          if (!cardBrawlMode && abilityHoverRef.current) syncAbilityAnchor();
        }}
        animate={revealAnimate ?? baseAnimate}
        transition={revealAnimate ? revealTransition : baseTransition}
        style={{
          marginLeft: noMargin ? 0 : isConnectedLeft ? `${sz.connectedGap}px` : `${sz.gap}px`,
          marginRight: noMargin ? 0 : isConnectedRight ? `${sz.connectedGap}px` : `${sz.gap}px`,
          ...(isPlayerCard && playerPalette
            ? {
                background: `linear-gradient(160deg, ${playerPalette.primary} 0%, ${playerPalette.secondary} 100%)`,
              }
            : {}),
        }}
      >
        {card.sznLeftEdge ? (
          <SznEdgeHalf
            edge={card.sznLeftEdge as SznEdgeId}
            side="left"
            isConnected={isConnectedLeft}
            compact={compact}
            hint={leftHint}
            dragActive={dragActive}
          />
        ) : (
          <ShapeHalf
            shape={card.leftShape}
            side="left"
            isConnected={isConnectedLeft}
            compact={compact}
            mode={leftMode}
            hint={leftHint}
            dragActive={dragActive}
          />
        )}
        {card.sznRightEdge ? (
          <SznEdgeHalf
            edge={card.sznRightEdge as SznEdgeId}
            side="right"
            isConnected={isConnectedRight}
            compact={compact}
            hint={rightHint}
            dragActive={dragActive}
          />
        ) : (
          <ShapeHalf
            shape={card.rightShape}
            side="right"
            isConnected={isConnectedRight}
            compact={compact}
            mode={rightMode}
            hint={rightHint}
            dragActive={dragActive}
          />
        )}

      {isPlayerCard && playerForCard ? (
        <>
          {/* Diagonal sheen so the player card reads as a Topps-style card. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.18) 100%)',
            }}
          />
          <div
            className={`absolute ${sz.topPad} left-0 right-0 flex justify-between items-start z-30 px-2`}
          >
            <span
              className={`${sz.playerText} font-black uppercase tracking-widest text-white/90`}
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
            >
              {playerTeamCode ?? ''}
            </span>
            <span
              className={`${sz.playerText} font-black uppercase tracking-widest bg-black/40 rounded px-1 text-amber-200`}
            >
              {rarityLabel(playerRarity)}
            </span>
          </div>
          <div className="absolute left-0 right-0 z-30 flex flex-col items-center gap-0.5" style={{ top: '36%' }}>
            <span
              className={`${sz.nameText} font-black uppercase tracking-tight text-white leading-tight bg-black/40 rounded px-1.5 py-0.5 max-w-[88%] line-clamp-2 text-center`}
              style={{ textShadow: '0 1px 1px rgba(0,0,0,0.6)' }}
            >
              {card.name}
            </span>
            {/* Brawl Mode tagline directly below the player-card name.
                Both sizes wrap to 2 lines for the same readability
                reason as the non-player card variant. */}
            {cardBrawlMode && card.brawlTagline && (
              <motion.span
                key={`tagline-${highlightTone ?? 'idle'}`}
                className={`${compact ? 'text-[7px] leading-[1.1]' : 'text-[9px] leading-[1.15]'} font-bold uppercase tracking-tight text-amber-900 bg-amber-200/95 rounded px-1 py-0.5 max-w-[92%] text-center border border-amber-400/60 shadow-sm line-clamp-2`}
                animate={
                  highlightTone === 'source'
                    ? {
                        backgroundColor: ['rgba(254,243,199,0.95)', 'rgba(250,204,21,0.98)', 'rgba(254,243,199,0.95)'],
                        scale: [1, 1.18, 1.06],
                        x: [0, -2, 2, -1, 1, 0],
                        boxShadow: [
                          '0 0 0 0 rgba(250,204,21,0)',
                          '0 0 14px 4px rgba(250,204,21,0.85)',
                          '0 0 4px 1px rgba(250,204,21,0.35)',
                        ],
                      }
                    : { scale: 1, x: 0 }
                }
                transition={{ duration: 0.5, ease: 'easeOut' }}
              >
                {card.brawlTagline}
              </motion.span>
            )}
          </div>
          {/* "ON DECK" role pill so the user immediately reads the card as
              their active batter/pitcher and not just a portrait. The text
              comes straight off the underlying MLB role so a reliever and
              a starter both surface "PITCHING" -- the seat IS the role. */}
          <div className="absolute left-1/2 -translate-x-1/2 z-30" style={{ bottom: '20%' }}>
            <span
              className="text-[8px] font-black uppercase tracking-[0.2em] bg-emerald-400/90 text-emerald-950 rounded-full px-1.5 py-[1px] shadow-md"
              style={{ textShadow: 'none' }}
            >
              {playerRoleCode === 'Pitcher' ? 'Pitching' : 'Batting'}
            </span>
          </div>
        </>
      ) : (
        <div className={`absolute ${sz.topPad} left-0 right-0 flex flex-col items-center z-30 px-1 text-center w-full`}>
          {!hideCardPlayer && card.player && (
            <div className={`${sz.playerText} font-extrabold text-slate-400 uppercase tracking-widest leading-none mb-0.5 truncate max-w-[80%]`}>
              {card.player.split(' (')[0]}
            </div>
          )}
          <div className={`${sz.nameText} leading-tight font-bold text-slate-700 uppercase tracking-wide bg-white/95 rounded px-1 py-0.5 line-clamp-2 text-center border border-slate-200 shadow-sm`} style={{ maxWidth: '70%' }}>
            {card.name}
          </div>
          {/* Brawl Mode: replace the hover tooltip with an inline tagline
              rendered directly on the card face. Both card sizes wrap to
              2 lines because the 15s snap timer punishes any moment the
              user spends squinting at a truncated ability -- letting the
              chip overflow to a second line keeps every brawl tagline
              fully readable. Clamp at 2 so a malformed long tagline can't
              push the value text out of position. */}
          {cardBrawlMode && card.brawlTagline && (
            <motion.div
              key={`tagline-${highlightTone ?? 'idle'}`}
              className={`${compact ? 'text-[7px] leading-[1.1]' : 'text-[9px] leading-[1.15]'} mt-0.5 font-bold uppercase tracking-tight text-amber-900 bg-amber-200/95 rounded px-1 py-0.5 text-center border border-amber-400/60 shadow-sm line-clamp-2`}
              style={{ maxWidth: '92%' }}
              animate={
                highlightTone === 'source'
                  ? {
                      // Brawl reveal: tagline IS the ability. Pulse it gold
                      // + shake + glow when the source-card beat triggers so
                      // the user reads "this is the card that just fired"
                      // straight from the chip without needing the spotlight
                      // overlay to spell it out. ~500ms run keeps the visual
                      // beat-locked to the existing RevealBeatSpotlight tween.
                      backgroundColor: ['rgba(254,243,199,0.95)', 'rgba(250,204,21,0.98)', 'rgba(254,243,199,0.95)'],
                      scale: [1, 1.18, 1.06],
                      x: [0, -2, 2, -1, 1, 0],
                      boxShadow: [
                        '0 0 0 0 rgba(250,204,21,0)',
                        '0 0 14px 4px rgba(250,204,21,0.85)',
                        '0 0 4px 1px rgba(250,204,21,0.35)',
                      ],
                    }
                  : { scale: 1, x: 0 }
              }
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              {card.brawlTagline}
            </motion.div>
          )}
        </div>
      )}
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
    </motion.div>
    </>
  );
};

/** Brawl Mode snap window before auto-lock. Shared by timer + hint UI.
 *  Re-exported from the store so the snap-speed HP bonus reads from
 *  the exact same wall-clock budget. */
const BRAWL_SNAP_DURATION_MS = BRAWL_SNAP_DURATION_MS_STORE;
/** How often the AI re-optimizes its hand against the user's current layout. */
const BRAWL_AI_REEVAL_MS = 2500;
/** Delay between each opponent card shuffle / seam snap during selection. */
const BRAWL_OPPONENT_ARRANGE_STEP_MS = 420;
/** Show "snap to attack" nudge when timer drops below this threshold. */
const BRAWL_SNAP_HINT_THRESHOLD_MS = 5000;

export const CardGameOverlay = () => {
  // SZN deck-footer height (the always-visible two-row decks rendered by
  // `SznFooterDecks` at the App level). Read it from the store so the
  // user-hand container lifts by exactly the deck's footprint -- the
  // score pill / lock-in button can never disappear behind the deck.
  // Stays at 0 outside of SZN so the legacy combat lanes are unaffected.
  const footerDeckHeight = useGameStore((s) => s.sznFooterHeight);
  const batter = useGameStore((s) => s.batter);
  const pitcher = useGameStore((s) => s.pitcher);
  const batterHand = useGameStore((s) => s.batterHand);
  const pitcherHand = useGameStore((s) => s.pitcherHand);
  const reorderBatter = useGameStore((s) => s.reorderBatterHand);
  const reorderPitcher = useGameStore((s) => s.reorderPitcherHand);
  const phase = useGameStore((s) => s.phase);
  const lockIn = useGameStore((s) => s.lockIn);
  const startNextAtBat = useGameStore((s) => s.startNextAtBat);
  const setShowStartScreen = useGameStore((s) => s.setShowStartScreen);
  // SZN Mode: when the run is active and a series game just finished, the
  // "New Game" button becomes "Continue Run" and reports the result back
  // to the run controller (advances to game 2/3 or ends the series).
  const sznRunActive = useGameStore((s) => s.gameMode === 'szn' && !!s.run);
  // Brawl Mode flag. Strips the at-bat down to its core combat loop:
  // no Manager's Hand, no Quest strip, no Lock-In button (a 15-second
  // timer auto-locks for both sides). The opponent's value pill flips
  // to sit BELOW their cards, and both PlayerHero rails are hidden so
  // the pills are the canonical HP readouts during the snap.
  const brawlMode = useGameStore((s) => s.gameMode === 'brawl');
  // True while the inning-start draft overlay is up. We unmount the
  // snap timer in that case so the 15s countdown can't tick down
  // behind the picker -- it re-anchors fresh once the user picks
  // (see `selectBrawlDraftCard` in gameStore).
  const brawlDraftActive = useGameStore((s) => s.brawlDraftChoice !== null);
  const run = useGameStore((s) => s.run);
  const reportSeriesGameResult = useGameStore((s) => s.reportSeriesGameResult);
  // Tri-state result for the SZN "Continue Run" handoff: ties cap at one
  // extra inning then declare draw (see `applyOutcome`), so the user can
  // legitimately finish in any of the three states.
  // `userIsAway` reflects which side bats first (top of 1st), which is
  // the same as which raw score belongs to the user. The actual
  // `seriesGameResult` derivation is memoised further down (after the
  // primitive score / userTeam selectors) — derived objects must NEVER
  // be returned straight out of a zustand selector because
  // `useSyncExternalStore` compares with `Object.is` and would loop
  // ("getSnapshot should be cached" → "Maximum update depth").
  const userTeam = useGameStore((s) => s.userTeam);
  const lastOutcome = useGameStore((s) => s.lastOutcome);
  const lastResolveLog = useGameStore((s) => s.lastResolveLog);
  const lastBatterScore = useGameStore((s) => s.lastBatterScore);
  const lastPitcherScore = useGameStore((s) => s.lastPitcherScore);
  const lastResultMessage = useGameStore((s) => s.lastResultMessage);
  // Brawl Mode HP-ladder snapshot. Feeds the HitResultBanner so the
  // scoreline reads as HP and the 21+ swing pops a GRAND SLAM cue.
  // Null on every non-brawl at-bat; the banner falls back to the
  // standard chain-math copy.
  const lastBrawlResolution = useGameStore((s) => s.lastBrawlResolution);
  const scoreBatterFn = useGameStore((s) => s.scoreBatter);
  const scorePitcherFn = useGameStore((s) => s.scorePitcher);
  const previewMatchupFn = useGameStore((s) => s.previewMatchup);
  const revealScript = useGameStore((s) => s.revealScript);
  const completeReveal = useGameStore((s) => s.completeReveal);
  // Quick Resolve: a small SZN-only toggle that auto-runs the
  // lockIn -> completeReveal -> startNextAtBat chain on at-bats the
  // `isLowLeverageAtBat` guard marks as boring (blowouts, garbage-time
  // empty-bases two-outs, user pitching with a lead, etc.). The
  // moment leverage spikes (RISP, tied late, open USE prompt) the
  // chain stops and the player gets the normal Lock In UX back.
  const quickResolveEnabled = useGameStore((s) => s.quickResolveEnabled);
  const setQuickResolveEnabled = useGameStore((s) => s.setQuickResolveEnabled);
  const resolveInningTarget = useGameStore((s) => s.resolveInningTarget);
  const requestResolveInning = useGameStore((s) => s.requestResolveInning);
  const tutorialActive = useGameStore((s) => s.tutorialActive);
  const totalInnings = useGameStore((s) => s.totalInnings);
  const outs = useGameStore((s) => s.outs);
  const gameMode = useGameStore((s) => s.gameMode);
  // Which seat is the human in this half? When pitching, the bottom strip
  // becomes the pitcher hand (drag, lock-in, status chips on the user's
  // side) and the top strip becomes the AI batter (face-down -> revealed).
  const userSide = useGameStore(getUiUserSide);
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

  // Series-game winner / loser derivation. See the comment above
  // (where `userTeam` is selected) for why this MUST be a useMemo over
  // primitive selections and not a single combined zustand selector.
  const seriesGameResult = useMemo(() => {
    const userIsAway = userTeam === 'AWAY';
    const userScore = userIsAway ? awayScore : homeScore;
    const ghostScore = userIsAway ? homeScore : awayScore;
    let result: 'user' | 'ghost' | 'draw';
    if (userScore > ghostScore) result = 'user';
    else if (ghostScore > userScore) result = 'ghost';
    else result = 'draw';
    return { result, userScore, ghostScore };
  }, [userTeam, awayScore, homeScore]);

  // User-affirmed connection seams + the action that updates them. The
  // strip reads `affirmedSeams` to decide which adjacent pairs render as
  // chained, and dispatches `affirmDraggedCard` on drag-end so the seam set
  // refreshes against the new layout.
  const affirmedSeams = useGameStore((s) => s.affirmedSeams);
  const brawlOpponentSeams = useGameStore((s) => s.brawlOpponentSeams);
  const brawlOpponentPlanHand = useGameStore((s) => s.brawlOpponentPlanHand);
  const affirmDraggedCard = useGameStore((s) => s.affirmDraggedCard);
  // Bag <-> hand recall. The footer rail's CROSS / mouse-click already
  // wires the deal direction (bag -> hand); the in-hand controller
  // CIRCLE handler below wires the recall direction (hand -> bag) so
  // a player who dealt the wrong ability can back out without leaving
  // the hand surface. Player cards (`id` starts with "player:") are
  // never recallable -- the store's `sznRecallItem` guards against
  // emptying the seat, but we also gate the binding here so CIRCLE on
  // the anchor still pops back to the screen surface (Lock In).
  const sznRecallItem = useGameStore((s) => s.sznRecallItem);
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
  const lastRevealMathSnapshot = useGameStore((s) => s.lastRevealMathSnapshot);

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
      brawlOpponentSeams,
      brawlOpponentPlanHand,
    ],
  );
  const batterPreview = matchup.batterScoringResult;
  const pitcherPreview = matchup.pitcherScoringResult;
  // Reference scoreBatterFn / scorePitcherFn so swap-in alternatives during
  // tests still get the latest store action; no longer called per-render.
  void scoreBatterFn;
  void scorePitcherFn;

  const isSelecting = phase === 'selecting';
  // Hand lift: always lift the user-hand column by the live footer-
  // deck height when a SZN run is active so the score pill and
  // lock-in button stay clear of the always-on decks. Non-SZN lanes
  // never see this lift because `footerDeckHeight` stays at 0 there.
  const handLiftPx = sznRunActive && footerDeckHeight > 0 ? -footerDeckHeight : 0;
  const isRevealing = phase === 'revealing';
  const isResolved = phase === 'between-at-bats' || phase === 'game-over';

  // Non-SZN post-at-bat CTA controller binding. CROSS advances:
  //   - between-at-bats   -> startNextAtBat
  //   - game-over non-SZN -> setShowStartScreen(true) (back to lanes)
  // SZN runs go through the unified priority-60 handler below (which
  // also drives hand-surface focus during the resolved phase). Keeping
  // this one alive for non-SZN lanes preserves the Quick Match / Draft
  // controller flow that was already shipped.
  useSznGamepad({
    id: 'card-game-overlay-cta',
    priority: 10,
    enabled: isResolved && !sznRunActive,
    handler: (btn) => {
      if (btn !== 'CROSS') return;
      if (phase === 'between-at-bats') {
        startNextAtBat();
      } else if (phase === 'game-over') {
        setShowStartScreen(true);
      }
    },
  });
  /** Opponent total stays hidden only while hands are still locked (selection). During
   *  `revealing`, both pills follow the beat-by-beat orchestrator; after that, finals. */
  const hideOpponentTotals = isSelecting;

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
    // Brawl Mode disables the standard per-beat orchestrator; the
    // BrawlAttackReveal below owns the reveal timeline + pill HP
    // depletion and is responsible for calling `completeReveal()`.
    disabled: brawlMode,
  });

  // -------------------------------------------------------------------------
  // Brawl Mode attack reveal: cards fly at HP pills, R3F VFX on impact.
  // -------------------------------------------------------------------------
  // Bumped on every impact so the parent ScreenShake re-fires for each
  // card landing. Starts at the gameStore's quest shake counter and
  // increments locally so we don't fight the quest-completion shake
  // (which already lives on the outer ScreenShake wrapper).
  const [brawlShake, setBrawlShake] = useState<BrawlShakePulse>({
    id: 0,
    power: 0,
    grand: false,
  });
  const [brawlSnapRemainingMs, setBrawlSnapRemainingMs] = useState(BRAWL_SNAP_DURATION_MS);
  // Attacker queues are derived from the locked-in card chains in the
  // reveal math snapshot. Falling back to the raw hand keeps us
  // resilient if the snapshot hasn't populated yet.
  //
  // CRITICAL: each side's per-card damage values are SCALED so they sum
  // EXACTLY to that side's locked-in pill total (`lastBatterScore` /
  // `lastPitcherScore`). The raw per-card modifiers only capture the
  // best-chain contribution; they ignore comprehensive bonuses like
  // synergies, opponentModifier debuffs, edge stacking, etc. that move
  // the pill. Without scaling, the bar drains by a number smaller (or
  // larger) than the pill total and the winner's residual HP doesn't
  // match `winnerHP = winnerTotal - loserTotal` -- which is the number
  // resolveBrawlOutcome uses to pick single / double / triple / HR /
  // grand slam. Scaling guarantees the visual depletion lands on the
  // exact value the at-bat ladder is judged against.
  const brawlAttackers = useMemo(() => {
    if (!brawlMode) return { batter: [], pitcher: [] };
    const buildSide = (
      hand: typeof batterHand,
      cardMods: Record<string, { value: number }>,
      sideTotal: number,
    ) => {
      // Only include cards that actually SCORED into a group on this
      // at-bat. `scoreGroup` only writes a `cardModifiers` entry when
      // it processes a card inside a group; singletons / unconnected
      // cards never land in the map. Those cards didn't contribute to
      // the pill total and so they shouldn't launch a projectile here
      // -- otherwise an unsnapped card would visibly attack and look
      // like it dealt phantom damage. Cards with a 0 modifier value
      // (chain-too-short, fully debuffed) are also filtered so the
      // reveal doesn't fire empty ghosts.
      const raw = hand
        .filter((c) => {
          const mod = cardMods[c.id];
          return mod !== undefined && Math.max(0, Math.round(mod.value)) > 0;
        })
        .map((c) => ({
          id: c.id,
          power: Math.max(0, Math.round(cardMods[c.id].value)),
          label: c.name ?? c.id,
        }));
      const target = Math.max(0, Math.round(sideTotal));
      if (target === 0) return [];
      if (raw.length === 0) {
        // Side has HP but no per-card modifier entries (aggregate-only
        // bonuses). Still animate every hand card so the opponent's
        // projectiles visibly fly on phase 2.
        if (hand.length === 0) return [];
        const base = Math.floor(target / hand.length);
        const remainder = target - base * hand.length;
        return hand.map((c, i) => ({
          id: c.id,
          power: base + (i === hand.length - 1 ? remainder : 0),
          label: c.name ?? c.id,
        }));
      }
      const rawSum = raw.reduce((s, c) => s + c.power, 0);
      // Defensive: if every contributing card somehow rounds to 0
      // (target > 0 but rawSum === 0), distribute the target evenly so
      // the bar still drains visibly.
      if (rawSum === 0) {
        const base = Math.floor(target / raw.length);
        const remainder = target - base * raw.length;
        return raw.map((c, i) => ({
          ...c,
          power: base + (i === raw.length - 1 ? remainder : 0),
        }));
      }
      // Common path: scale proportionally so sum === target. Cards
      // that contributed more to the raw chain hit harder; the relative
      // weighting is preserved.
      const scaled = raw.map((c) => ({
        ...c,
        power: Math.max(0, Math.round((c.power * target) / rawSum)),
      }));
      // Push any rounding residual into the highest-damage card so the
      // sum lands exactly on `target`. We pick the heaviest card (not
      // just the last) so the "finishing blow" feels like a heavyweight
      // landed it rather than a chip card silently absorbing slack.
      let residual = target - scaled.reduce((s, c) => s + c.power, 0);
      if (residual !== 0) {
        let idx = 0;
        for (let i = 1; i < scaled.length; i++) {
          if (scaled[i].power > scaled[idx].power) idx = i;
        }
        scaled[idx] = {
          ...scaled[idx],
          power: Math.max(0, scaled[idx].power + residual),
        };
      }
      return scaled;
    };
    return {
      batter: buildSide(batterHand, lastBatterCardModifiers, lastBatterScore),
      pitcher: buildSide(pitcherHand, lastPitcherCardModifiers, lastPitcherScore),
    };
  }, [
    brawlMode,
    batterHand,
    pitcherHand,
    lastBatterCardModifiers,
    lastPitcherCardModifiers,
    lastBatterScore,
    lastPitcherScore,
  ]);

  const brawlReveal = useBrawlAttackReveal({
    enabled: brawlMode && phase === 'revealing',
    batterAttackers: brawlAttackers.batter,
    pitcherAttackers: brawlAttackers.pitcher,
    batterHP: lastBatterScore,
    pitcherHP: lastPitcherScore,
    userIsBatting,
    grandSlam: lastBrawlResolution?.grandSlam === true,
    opponentHandLength: (userIsBatting ? pitcherHand : batterHand).length,
    onComplete: completeReveal,
    onImpact: (power, grand) => {
      // Scope shake to the brawl overlay and scale by impact power so
      // big swings read heavier than chip hits.
      setBrawlShake((prev) => ({
        id: prev.id + 1,
        power,
        grand,
      }));
      // Impact thud sfx: short, low, punchy. Plays once per attack
      // beat so the cascade of cards reads as a steady percussion line.
      playSfx("impactThud");
    },
    // runId pins the timeline to the current at-bat -- two sequential
    // brawl at-bats can't have the second one inherit timers from the
    // first because atBatId increments on every deal.
    runId: atBatId,
  });
  // ---- end brawl reveal wiring -----------------------------------------

  // The pills in brawl mode read from `brawlReveal.displayed*HP` during
  // the reveal phase; outside reveal they fall back to `lastBatterScore`
  // / `lastPitcherScore` (which already are the locked-in totals).
  // Auras hover next to the pills so the R3F canvas can paint ambient
  // sparkles at the live pill coordinates. We update them lazily via a
  // small DOM-rect probe inside an effect (cheap; runs once on reveal
  // start) so we don't measure on every render.
  const [brawlAuras, setBrawlAuras] = useState<BrawlAura[]>([]);
  useEffect(() => {
    if (!brawlMode || phase !== 'revealing') {
      setBrawlAuras([]);
      return;
    }
    const probe = () => {
      const user = document.querySelector<HTMLElement>('[data-brawl-pill="user"]');
      const opp = document.querySelector<HTMLElement>('[data-brawl-pill="opponent"]');
      const center = (el: HTMLElement | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const u = center(user);
      const o = center(opp);
      const auras: BrawlAura[] = [];
      if (u) auras.push({ side: 'user', x: u.x, y: u.y, defeated: brawlReveal.displayedBatterHP === 0 && userIsBatting || brawlReveal.displayedPitcherHP === 0 && !userIsBatting });
      if (o) auras.push({ side: 'opponent', x: o.x, y: o.y, defeated: brawlReveal.displayedPitcherHP === 0 && userIsBatting || brawlReveal.displayedBatterHP === 0 && !userIsBatting });
      setBrawlAuras(auras);
    };
    probe();
    // Re-probe on resize so the aura tracks if the user shrinks the window.
    window.addEventListener('resize', probe);
    return () => window.removeEventListener('resize', probe);
  }, [brawlMode, phase, brawlReveal.displayedBatterHP, brawlReveal.displayedPitcherHP, userIsBatting]);

  // Batter/pitcher numbers used for pills: during `revealing`, both lanes follow
  // the orchestrator; in `selecting` the matchup preview still computes both
  // totals but the opponent readout is fogged via `hideOpponentTotals`.
  // Brawl Mode swaps the reveal source so the pills tick DOWN (HP depletion)
  // instead of UP -- the brawl reveal owns the displayed values until its
  // attack sequence completes. After resolve, pills show post-combat
  // remaining HP (the shield depleted), not the pre-attack starting totals.
  const batterDisplayValue = isResolved
    ? brawlMode && lastBrawlResolution
      ? lastBrawlResolution.batterRemainingHP
      : lastBatterScore
    : isRevealing
      ? brawlMode
        ? Math.round(brawlReveal.displayedBatterHP)
        : reveal.displayedBatter
      : matchup.batterDisplay;
  const pitcherDisplayValue = isResolved
    ? brawlMode && lastBrawlResolution
      ? lastBrawlResolution.pitcherRemainingHP
      : lastPitcherScore
    : isRevealing
      ? brawlMode
        ? Math.round(brawlReveal.displayedPitcherHP)
        : reveal.displayedPitcher
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
  // True when the user has snapped at least one adjacent pair in their
  // hand. Brawl's attack phase only credits chained cards, so we nudge
  // the player when the timer is winding down and they haven't snapped yet.
  const userHasSnapChain = useMemo(() => {
    for (let i = 0; i < userHand.length - 1; i++) {
      if (affirmedSeams.has(seamKey(userHand[i].id, userHand[i + 1].id))) {
        return true;
      }
    }
    return false;
  }, [userHand, affirmedSeams]);
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
  // Brawl pill fill: always on in brawl mode. During selection the bar
  // tracks the live preview (full). During reveal it drains against the
  // locked-in shield. After the result it stays visible showing
  // remaining HP vs the starting shield max.
  const userBrawlHpMax =
    !brawlMode
      ? null
      : isSelecting
        ? Math.max(1, userPillValue ?? 0)
        : lastBrawlResolution
          ? userIsBatting
            ? lastBrawlResolution.batterStartingHP
            : lastBrawlResolution.pitcherStartingHP
          : isRevealing
            ? userIsBatting
              ? lastBatterScore
              : lastPitcherScore
            : Math.max(1, userPillValue ?? 0);
  const opponentBrawlHpMax =
    !brawlMode
      ? null
      : isSelecting && hideOpponentTotals
        ? null
        : isSelecting
          ? Math.max(1, aiPillValue ?? 0)
          : lastBrawlResolution
            ? userIsBatting
              ? lastBrawlResolution.pitcherStartingHP
              : lastBrawlResolution.batterStartingHP
            : isRevealing
              ? userIsBatting
                ? lastPitcherScore
                : lastBatterScore
              : Math.max(1, aiPillValue ?? 0);
  const userBrawlHpFill = brawlMode && userBrawlHpMax != null;
  const opponentBrawlHpFill = brawlMode && opponentBrawlHpMax != null;
  const userLabel = userIsBatting ? 'Batter' : 'Pitcher';
  const aiLabel = userIsBatting ? 'Pitcher' : 'Batter';
  const userTone = userIsBatting ? 'batter' : 'pitcher';
  const aiTone = userIsBatting ? 'pitcher' : 'batter';

  const showFrozenMatchupMath =
    lastRevealMathSnapshot !== null && (isRevealing || isResolved);

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

  const batterCardIds = useMemo(() => new Set(batterHand.map((c) => c.id)), [batterHand]);

  // ---- In-game controller surface (selecting + resolved) ---------------
  // Two new gamepad capabilities for SZN's selecting AND resolved
  // phases:
  //   1. 'screen' surface CROSS fires whichever CTA is on-screen: Lock
  //      In while selecting; Next At-Bat / Continue Run / New Game once
  //      resolved. The visible button itself also paints an amber focus
  //      ring whenever this surface is active, so the user can SEE what
  //      Cross is going to do (the playtest complaint was "I can't tell
  //      where the cursor is").
  //   2. A 'hand' focus surface that walks the cards in the user's
  //      hand. During selecting, SQUARE grabs and DPAD shifts the
  //      grabbed card via the same reorderUser + affirmDraggedCard path
  //      mouse drag uses, so chains snap with identical seam-affirm
  //      semantics. During the resolved phase the hand is read-only
  //      (the strip is `disabled`), so SQUARE is a no-op and we expose
  //      navigation-only so the user can still review the cards that
  //      just played.
  //
  // Focus/grab are tracked by id (not index) so the highlight follows
  // the card across reorders / SZN deal/recall hand mutations. The
  // derived index is recomputed every render against the live hand.
  const sznGamepadFocus = useGameStore((s) => s.sznGamepadFocus);
  const setSznGamepadFocus = useGameStore((s) => s.setSznGamepadFocus);
  const [gamepadFocusedHandCardId, setGamepadFocusedHandCardId] = useState<
    string | null
  >(null);
  const [gamepadGrabbedHandCardId, setGamepadGrabbedHandCardId] = useState<
    string | null
  >(null);

  // Reset focus + grab + surface on at-bat boundaries. atBatId
  // increments every time `startNextAtBat` fires, so this fires once
  // per new at-bat and lands the controller back on the 'screen'
  // surface (Lock In). Without this, a player who left focus on the
  // hand at the end of one at-bat would still be on 'hand' surface on
  // the next, and CROSS would lock in immediately on the first press.
  useEffect(() => {
    setGamepadFocusedHandCardId(null);
    setGamepadGrabbedHandCardId(null);
    if (sznGamepadFocus === 'hand') setSznGamepadFocus('screen');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atBatId]);

  // Drop grab state when the hand becomes read-only (revealing,
  // between-at-bats, game-over). Focus itself is preserved across
  // resolve so the user can navigate cards while results are on
  // screen -- only the in-progress grab needs to be cancelled because
  // the strip stops accepting reorders.
  const handReorderable = isSelecting;
  useEffect(() => {
    if (!handReorderable && gamepadGrabbedHandCardId !== null) {
      setGamepadGrabbedHandCardId(null);
    }
  }, [handReorderable, gamepadGrabbedHandCardId]);

  // Reconcile the focused / grabbed IDs against the live hand. If the
  // focused card disappeared (recalled to the bag, transformed away by
  // an ability, or the player anchor got swapped), snap focus to a
  // sensible neighbor instead of stranding the ring on a ghost id.
  useEffect(() => {
    const ids = userHand.map((c) => c.id);
    if (ids.length === 0) {
      if (gamepadFocusedHandCardId !== null) setGamepadFocusedHandCardId(null);
      if (gamepadGrabbedHandCardId !== null) setGamepadGrabbedHandCardId(null);
      return;
    }
    if (gamepadFocusedHandCardId && !ids.includes(gamepadFocusedHandCardId)) {
      setGamepadFocusedHandCardId(ids[0]);
    }
    if (gamepadGrabbedHandCardId && !ids.includes(gamepadGrabbedHandCardId)) {
      setGamepadGrabbedHandCardId(null);
    }
  }, [userHand, gamepadFocusedHandCardId, gamepadGrabbedHandCardId]);

  // Helper: move the grabbed card by `dir` (-1 left, +1 right) within
  // the current user hand, push the new order through the store's
  // reorder action, and fire `affirmDraggedCard` so the seam set
  // updates exactly like a mouse drag-end. Returns true on success so
  // the caller can swallow the controller input.
  const shiftGrabbedHandCard = useCallback(
    (dir: -1 | 1): boolean => {
      const id = gamepadGrabbedHandCardId;
      if (!id) return false;
      const idx = userHand.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      const target = idx + dir;
      if (target < 0 || target >= userHand.length) return false;
      const next = userHand.slice();
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      reorderUser(next);
      // Mirror HandStrip.handleDragEnd: affirming on the moved card id
      // is what re-derives the seam set (prunes broken seams, adds new
      // ones for mechanically valid adjacencies). Without this the snap
      // visual + chain credit never appears.
      affirmDraggedCard(id);
      return true;
    },
    [gamepadGrabbedHandCardId, userHand, reorderUser, affirmDraggedCard],
  );

  // Resolved-phase CTA dispatcher. Mirrors the on-screen Next At-Bat /
  // Continue Run / New Game branches so CROSS from any in-game surface
  // fires the same action the user would click. Kept inside the
  // component (not pulled into a top-level helper) because it closes
  // over a handful of store-bound callbacks + the memoised
  // seriesGameResult tuple.
  const fireResolvedCta = useCallback(() => {
    if (phase === 'between-at-bats') {
      startNextAtBat();
      return;
    }
    if (phase === 'game-over' && sznRunActive) {
      reportSeriesGameResult(
        seriesGameResult.result,
        seriesGameResult.userScore,
        seriesGameResult.ghostScore,
      );
      return;
    }
    if (phase === 'game-over') {
      setShowStartScreen(true);
    }
  }, [
    phase,
    sznRunActive,
    startNextAtBat,
    reportSeriesGameResult,
    seriesGameResult,
    setShowStartScreen,
  ]);

  // Unified in-game handler. Sits ABOVE the SznFooterDecks router
  // (priority 50) so it wins DPAD_DOWN from the 'hand' surface
  // (re-routes back to 'screen' instead of dropping into the rail), and
  // wins CROSS from the 'screen' surface so the user gets Lock In /
  // Next At-Bat without the footer's default Cross deal stealing
  // focus. When the player is on 'footer' surface, we explicitly
  // return false so the footer router keeps driving its rail
  // navigation.
  useSznGamepad({
    id: 'card-game-overlay-selecting',
    priority: 60,
    enabled: sznRunActive && (isSelecting || isResolved),
    handler: (btn) => {
      if (sznGamepadFocus === 'footer') return false;

      // 'screen' surface: fire the visible primary CTA, or pop into
      // the hand for review/rearrange.
      if (sznGamepadFocus === 'screen') {
        if (btn === 'CROSS') {
          if (isSelecting) lockIn();
          else fireResolvedCta();
          return true;
        }
        if (btn === 'DPAD_UP') {
          if (userHand.length === 0) return false;
          // Restore the previous focus if the card is still there,
          // else seed the rightmost card so the player lands on the
          // most recently dealt ability rather than the player anchor.
          const ids = userHand.map((c) => c.id);
          const restore =
            gamepadFocusedHandCardId && ids.includes(gamepadFocusedHandCardId)
              ? gamepadFocusedHandCardId
              : ids[ids.length - 1];
          setGamepadFocusedHandCardId(restore);
          setSznGamepadFocus('hand');
          return true;
        }
        // DPAD_DOWN / TRIANGLE / etc. fall through so the footer
        // router can intercept them (its priority-50 listener handles
        // the rail drop-in + collapse toggle).
        return false;
      }

      // 'hand' surface from here down.
      const grabbing = gamepadGrabbedHandCardId !== null;

      // Move mode: lock the user into LEFT/RIGHT shift + drop/cancel.
      // Mirrors the footer's move-mode lockdown so a held card can't
      // be stranded by an accidental DPAD_UP into another surface.
      if (grabbing) {
        // Helper: clear the grab AND fire affirmDraggedCard on the
        // card we just released, mirroring mouse drag-end's
        // "drop = affirm" contract. Every shift already affirmed on
        // its own, so this is redundant when the user moved at least
        // once, but it matters when the user grabs and drops in place
        // without shifting (mouse equivalent: pick up + drop = affirm
        // current adjacencies).
        const dropGrabbed = () => {
          const id = gamepadGrabbedHandCardId;
          setGamepadGrabbedHandCardId(null);
          if (id) affirmDraggedCard(id);
        };
        switch (btn) {
          case 'DPAD_LEFT':
            shiftGrabbedHandCard(-1);
            return true;
          case 'DPAD_RIGHT':
            shiftGrabbedHandCard(1);
            return true;
          case 'SQUARE':
          case 'CROSS':
            dropGrabbed();
            return true;
          case 'CIRCLE':
            // Cancel: same drop semantics. We don't unwind the moves
            // because each shift was already a real reorder under
            // the hood; reverting would surprise the user more than
            // it'd help. The grabbed-state clears + we still affirm
            // so the user gets a final "snap" on the position they
            // settled on.
            dropGrabbed();
            return true;
          case 'DPAD_UP':
          case 'DPAD_DOWN':
            // Drop + exit the hand surface back to 'screen'. Escape
            // hatch when a user grabs and then realizes they want
            // to lock in or deal another card.
            dropGrabbed();
            setSznGamepadFocus('screen');
            return true;
          default:
            return true;
        }
      }

      // Normal hand-surface navigation.
      const ids = userHand.map((c) => c.id);
      const focusIdx = gamepadFocusedHandCardId
        ? ids.indexOf(gamepadFocusedHandCardId)
        : -1;
      const safeIdx = focusIdx < 0 ? 0 : focusIdx;

      switch (btn) {
        case 'DPAD_LEFT': {
          if (ids.length === 0) return true;
          const next = Math.max(0, safeIdx - 1);
          setGamepadFocusedHandCardId(ids[next]);
          return true;
        }
        case 'DPAD_RIGHT': {
          if (ids.length === 0) return true;
          const next = Math.min(ids.length - 1, safeIdx + 1);
          setGamepadFocusedHandCardId(ids[next]);
          return true;
        }
        case 'SQUARE': {
          // Grab the focused card. Only meaningful while the hand is
          // reorderable (selecting phase); during reveal/result the
          // strip ignores reorders, so we silently consume the press
          // instead of leaving a phantom violet ring.
          if (!handReorderable) return true;
          if (ids.length === 0) return true;
          const id = ids[safeIdx];
          if (!id) return true;
          setGamepadGrabbedHandCardId(id);
          return true;
        }
        case 'CROSS': {
          // CROSS priority:
          //  - During selecting: USE prompt on the focused card if
          //    one is pending, else Lock In (commit without leaving
          //    the hand surface).
          //  - During resolved: fire the visible CTA (Next At-Bat /
          //    Continue Run / New Game) so the user can advance from
          //    the hand surface too.
          if (!isSelecting) {
            fireResolvedCta();
            return true;
          }
          const id = ids[safeIdx];
          if (id && userPendingChoiceIds.has(id)) {
            triggerChoice(id);
            return true;
          }
          lockIn();
          return true;
        }
        case 'CIRCLE': {
          // CIRCLE on the focused hand card:
          //   - Ability card (anything that isn't the player anchor and
          //     is recallable while the hand is still reorderable):
          //     send it BACK TO THE BAG. This is the mouse-equivalent
          //     of dragging the ability chip off the strip, which the
          //     gamepad path was missing -- previously CIRCLE jumped
          //     focus down to Lock In, which felt like the controller
          //     "swallowed" the press because nothing happened to the
          //     ability the user was clearly trying to undo.
          //   - Player anchor (or no focused card / read-only hand):
          //     fall back to the legacy behaviour and pop focus down
          //     to the 'screen' surface (Lock In / next CTA). The
          //     anchor can't be recalled (would empty the seat) and
          //     during reveal/result the hand is read-only so recall
          //     would be ignored anyway.
          const focusId = ids[safeIdx];
          const focusedCard = focusId
            ? userHand.find((c) => c.id === focusId) ?? null
            : null;
          const isPlayerAnchor =
            !focusedCard || focusedCard.id.startsWith('player:');
          if (handReorderable && focusedCard && !isPlayerAnchor) {
            sznRecallItem(focusedCard.id);
            return true;
          }
          setSznGamepadFocus('screen');
          return true;
        }
        case 'DPAD_UP':
        case 'DPAD_DOWN': {
          // Either direction backs out of the hand surface. DPAD_DOWN
          // additionally feeds the footer router on the NEXT press
          // (the user can chain DPAD_DOWN twice to skip from hand
          // into the rail). We don't auto-drop into the footer here
          // because the intermediate 'screen' surface holds the CTA,
          // which is the more common target after rearranging.
          setSznGamepadFocus('screen');
          return true;
        }
        default:
          return false;
      }
    },
  });

  // Derived: the 'screen' surface has focus on the visible CTA button.
  // Used by the Lock In / Next At-Bat / Continue Run / New Game JSX
  // below to paint an amber ring + glow that matches the hand card
  // focus visual, so CROSS's target is never ambiguous.
  //
  // Gated on `useGamepadPresent()` so mouse-only players never see
  // the amber halo on their primary button -- the ring is purely a
  // controller affordance.
  const gamepadPresent = useGamepadPresent();
  const screenCtaFocused =
    sznRunActive && gamepadPresent && sznGamepadFocus === 'screen';

  /** SZN: flat team tag bonus folded into the matchup pill via `sznSideBonus`. */
  const userSznRosterSynergyAmount = useMemo(() => {
    if (!sznRunActive || !run) return null;
    const amt = userIsBatting ? teamBatterBonus(run.roster) : teamPitcherBonus(run.roster);
    return amt > 0 ? amt : null;
  }, [sznRunActive, run, userIsBatting]);

  const userSznRosterSynergyTitle = useMemo(() => {
    if (!run || userSznRosterSynergyAmount == null) return undefined;
    const lines = activeSynergies(run.roster)
      .filter((s) =>
        userIsBatting ? s.threshold.batterBonus > 0 : s.threshold.pitcherBonus > 0,
      )
      .map((s) => s.threshold.label);
    if (lines.length === 0) return 'Adjacent roster tag synergy — added to your matchup total.';
    return `${lines.join(' · ')} — counted in your matchup total.`;
  }, [run, userIsBatting, userSznRosterSynergyAmount]);

  // ---- Quick Resolve auto-chain --------------------------------------------
  // Cheap recompute on every render -- the helper is a few branches over
  // primitive store fields, so a memo would cost more than it saves.
  const isLowLeverage = isLowLeverageAtBat({
    gameMode,
    run,
    phase,
    inning,
    totalInnings,
    half,
    outs,
    bases,
    homeScore,
    awayScore,
    userTeam,
    pendingChoices,
    activeChoiceCardId,
    tutorialActive,
  });
  // "Resolve Inning" one-shot burst: when the player clicked the
  // Resolve Inning button this inning, treat every at-bat as low-
  // leverage until the inning ticks. Pairs with `quickResolveEnabled`
  // -- the burst doesn't require Quick Resolve to be ON, it acts as
  // its own one-inning override of the leverage gate.
  const resolveInningArmed =
    resolveInningTarget !== null && resolveInningTarget === inning;
  const effectiveLowLeverage = isLowLeverage || resolveInningArmed;
  // Surface the auto-pilot state to the toggle UI so the player can see
  // at a glance whether the toggle is "armed and waiting" (on but the
  // current spot is high-leverage) vs "actively driving" (on AND
  // currently auto-running the chain).
  const quickResolveActive =
    (quickResolveEnabled && isLowLeverage) || resolveInningArmed;
  // Latch the toggle-on moment so we ONLY auto-resolve at-bats that the
  // player explicitly opted into via the toggle. Without this, flipping
  // the toggle ON during a between-at-bats pause would immediately fire
  // startNextAtBat() under the player's finger before they could read
  // the result of the at-bat that just finished. The latch arms once
  // both conditions hold (toggle on AND we're in `selecting` phase) and
  // disarms whenever the toggle goes off.
  const autoChainArmedRef = useRef(false);
  useEffect(() => {
    if (!quickResolveEnabled && !resolveInningArmed) {
      autoChainArmedRef.current = false;
      return;
    }
    if (phase === 'selecting' && effectiveLowLeverage) {
      autoChainArmedRef.current = true;
    }
  }, [quickResolveEnabled, resolveInningArmed, phase, effectiveLowLeverage]);
  // The actual auto-advance driver. Fires whenever phase / leverage
  // changes; each transition along the chain re-triggers the effect
  // with fresh state, so the chain "walks itself" through the
  // selecting -> revealing -> between-at-bats loop with no manual
  // sequencing. completeReveal/startNextAtBat are both idempotent
  // outside their valid phase, so a stale fire is a safe no-op.
  useEffect(() => {
    if (!quickResolveEnabled && !resolveInningArmed) return;
    if (tutorialActive) return;
    if (!autoChainArmedRef.current) return;
    if (phase === 'selecting') {
      if (!effectiveLowLeverage) return; // leverage spiked; hand control back
      // Defer one tick so any in-flight render (USE prompt, dealing
      // animation) commits first, and so React's strict-mode double
      // invoke can't drive two simultaneous lockIns.
      const t = setTimeout(() => {
        const s = useGameStore.getState();
        if (s.phase !== 'selecting') return;
        const burstArmed =
          s.resolveInningTarget !== null && s.resolveInningTarget === s.inning;
        if (!s.quickResolveEnabled && !burstArmed) return;
        if (s.activeChoiceCardId !== null) return;
        if (s.pendingChoices.length > 0) return;
        s.lockIn();
      }, 60);
      return () => clearTimeout(t);
    }
    if (phase === 'revealing') {
      // Skip the ~2s+ reveal orchestrator entirely. The outcome math
      // has already been applied to inning/outs/bases/scores inside
      // lockIn, so completeReveal just flips the phase forward.
      const t = setTimeout(() => {
        const s = useGameStore.getState();
        if (s.phase !== 'revealing') return;
        const burstArmed =
          s.resolveInningTarget !== null && s.resolveInningTarget === s.inning;
        if (!s.quickResolveEnabled && !burstArmed) return;
        s.completeReveal();
      }, 80);
      return () => clearTimeout(t);
    }
    if (phase === 'between-at-bats') {
      // Quick "tap the result and roll" pause -- long enough for the
      // user to glance at the new score, short enough that auto-pilot
      // still feels like auto-pilot.
      const t = setTimeout(() => {
        const s = useGameStore.getState();
        if (s.phase !== 'between-at-bats') return;
        const burstArmed =
          s.resolveInningTarget !== null && s.resolveInningTarget === s.inning;
        if (!s.quickResolveEnabled && !burstArmed) return;
        s.startNextAtBat();
      }, 320);
      return () => clearTimeout(t);
    }
    if (phase === 'game-over') {
      // Game ended mid auto-chain; disarm so the player gets manual
      // control over the Continue Run CTA.
      autoChainArmedRef.current = false;
    }
  }, [
    quickResolveEnabled,
    resolveInningArmed,
    effectiveLowLeverage,
    phase,
    tutorialActive,
    // Re-running the effect when these change is safe (idempotent
    // calls inside) and keeps the chain reactive to mid-resolve
    // mutations like a new pendingChoice popping during reveal.
    activeChoiceCardId,
    pendingChoices,
    atBatId,
  ]);
  // --------------------------------------------------------------------------

  return (
    <>
      {/* Big dramatic outcome banner -- pops over the field for a beat after
          the reveal sequence resolves. Adds the "punchy moment" the playtest
          report flagged as missing: a strikeout/home run currently shrinks
          to a tiny chip on the score pill, which makes hits feel anticlimactic
          even when the engine has done all the work. Self-dismisses after
          ~1.6s so the player can immediately read the matchup and tap Next. */}
      <HitResultBanner
        outcome={lastOutcome}
        phase={phase}
        atBatId={atBatId}
        resolveLog={lastResolveLog}
        batterTotal={lastRevealMathSnapshot?.batter.total ?? null}
        pitcherTotal={lastRevealMathSnapshot?.pitcher.total ?? null}
        batterName={batter?.name ?? null}
        pitcherName={pitcher?.name ?? null}
        userIsBatting={userIsBatting}
        brawlResolution={lastBrawlResolution}
      />

      {!brawlMode && <QuestStrip />}

      {/* Brawl Mode owns its own reveal spotlight via the BrawlAttackOverlay
          mounted at the end of this file -- the per-beat highlight ring
          is the wrong vocabulary for "cards smash into HP pill" so we
          suppress it whenever the brawl reveal is active. */}
      {!brawlMode && (
        <RevealBeatSpotlight
          active={isRevealing}
          spotlight={reveal.revealSpotlight}
          batterCardIds={batterCardIds}
          batterModifiers={batterModifiersForStrip}
          pitcherModifiers={pitcherModifiersForStrip}
          batterOverrides={reveal.batterValueOverrides}
          pitcherOverrides={reveal.pitcherValueOverrides}
        />
      )}

      {/* Card-vs-card attack & floating-counter overlay. Lives beside the
          spotlight so the spotlight's stage-center caption + the attack
          layer's lane-anchored animations coexist without fighting for
          the same DOM rect. The overlay self-gates on `isRevealing`, so
          it's a true no-op during selection / between-at-bats. */}
      <RevealAttackOverlay active={isRevealing} currentAnimation={reveal.currentAnimation} />

      {/* Brawl: half-inning summary flashcard. Fades in during the
          2.1s side-switch window (`between-at-bats` after a half flip)
          and reads the snapshotted highlights from the just-completed
          half (W/L vs the AI, longest chain forged, peak hit). Cleared
          on `startNextAtBat`. Self-gates so non-brawl modes never see it. */}
      <BrawlInningSummaryOverlay />

      {/* Brawl: inning-start "concessions" draft. Full-screen dark
          overlay with three random cards; user picks one to add to
          their 15-card general-draw pool. Titled per inning
          ("CONCESSIONS" / "BATHROOM BREAK" / "HOME STRETCH"). Self-
          gates on `brawlDraftChoice` so non-brawl modes never see it. */}
      <BrawlDraftOverlay />

      {/* Player hero rail: top slot = opponent (fog `?` only during selection),
          bottom = you (live total once that side has a committed layout). Pairs
          with your hand at the bottom whether you bat or pitch.
          Brawl Mode strips BOTH rails -- the HP pills above/below the cards
          are the canonical reads for that lane, and a side-rail hero would
          just duplicate the matchup total beside the pill. */}
      {!brawlMode && (
        <div className="hidden md:block pointer-events-none absolute left-8 top-32 z-20">
          <PlayerHero
            player={userIsBatting ? pitcher : batter}
            value={hideOpponentTotals ? null : aiPillValue}
            role={userIsBatting ? 'PITCHER' : 'BATTER'}
            dimmed={hideOpponentTotals}
            showTotalBesideCard={false}
          />
        </div>
      )}
      {/* SZN Mode: the user's player already shows as a card in the
          bottom hand strip, so the left-rail hero would just duplicate
          the same identity (same name, same team colors). Suppress it
          for SZN runs to keep the player rail clean; non-SZN lanes keep
          the hero rail because their hand is dealt cards (no player).
          Brawl Mode also bows out -- the user's pill is the HP readout. */}
      {!sznRunActive && !brawlMode && (
        <div className="hidden md:block pointer-events-none absolute left-8 bottom-32 z-20">
          <PlayerHero
            player={userIsBatting ? batter : pitcher}
            value={userPillValue}
            role={userIsBatting ? 'BATTER' : 'PITCHER'}
            dimmed={false}
          />
        </div>
      )}

      {/* AI hand - top of screen. Face-down during selection regardless of
          whether the AI is playing batter or pitcher this half (same
          fog-of-war either direction).
          Brawl Mode flips the inner column so the opponent's HP pill sits
          BELOW their cards (the user requested the value pill on the side
          farther from the player on their opponent's side, mirroring how
          the user's pill sits above the user's cards on the bottom). The
          cards stay anchored to the top edge of the screen so the field
          stays visible between the two strips. */}
      <motion.div
        className="absolute inset-x-0 top-24 pointer-events-none flex flex-col items-center pt-4 pb-3 bg-gradient-to-b from-slate-900/70 via-slate-900/30 to-transparent"
        initial={false}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
      >
        <div
          className={`pointer-events-auto flex flex-col items-center gap-2 ${
            brawlMode ? 'flex-col-reverse' : ''
          }`}
        >
          {/* Wrap the AI's ScorePill so the brawl reveal can locate the
              opponent HP pill via a stable selector. Wrapper is purely a
              positional reference; it doesn't change layout. */}
          <div
            data-brawl-pill="opponent"
            data-brawl-pill-seat={userIsBatting ? 'pitcher' : 'batter'}
            className="flex flex-col items-center gap-1"
          >
            <ScorePill
              label={aiLabel}
              tone={aiTone}
              value={hideOpponentTotals ? null : aiPillValue}
              outcomeStyle={outcomeBadgeStyle}
              compact
              banner={hideOpponentTotals ? null : aiBanner}
              heroHasValue={false}
              brawlHpMax={opponentBrawlHpMax}
              brawlHpSide="opponent"
              brawlHpFill={opponentBrawlHpFill}
            />
            {brawlMode && (
              <BrawlBonusToast side={userIsBatting ? 'pitcher' : 'batter'} />
            )}
          </div>
          <div data-tutorial="opponent-hand" data-brawl-hand="opponent">
            {brawlMode && isSelecting ? (
              <BrawlOpponentArrangeStrip
                dealtHand={aiHand}
                planHand={
                  brawlOpponentPlanHand.length > 0 ? brawlOpponentPlanHand : aiHand
                }
                planSeams={brawlOpponentSeams}
                modifiers={aiModifiers}
                atBatId={atBatId}
                compact
              />
            ) : (
              <FlipPitcherStrip
                hand={aiHand}
                modifiers={aiModifiers}
                revealed={!isSelecting}
                atBatId={atBatId}
                compact
                valueOverrides={aiValueOverrides}
                highlightTones={aiHighlights}
                affirmedSeams={brawlMode ? brawlOpponentSeams : undefined}
              />
            )}
          </div>
        </div>
      </motion.div>

      {/* User hand - bottom of screen. Always interactive: drag, connect,
          lock-in. Whether the user is the batter or the pitcher this half
          is decided by `userTeam` + `half` via getUserSide.
          In SZN combat the entire hand column is lifted upward by the
          live `sznFooterHeight` so the always-on `SznFooterDecks` (the
          persistent two-column roster/bag rail at the bottom of the
          screen) doesn't overlap the hand. Card dealing from the bag
          is a one-tap action on the rail itself (click an ability,
          or press CROSS on the focused gamepad slot) -- there's no
          drag-to-hand handshake to wire up on this end. */}
      <motion.div
        animate={{ y: handLiftPx }}
        transition={{ type: 'spring', stiffness: 220, damping: 28 }}
        className="absolute inset-x-0 bottom-0 pointer-events-none flex flex-col items-center justify-end pb-8 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent pt-32 h-80"
      >

        <div className="pointer-events-auto flex flex-col items-center gap-4">
          {/* User pill wrapper carries the brawl reveal anchor so the
              flying-card ghosts the AI launches can land on the right
              screen coordinate. */}
          <div
            data-brawl-pill="user"
            data-brawl-pill-seat={userIsBatting ? 'batter' : 'pitcher'}
            className="flex flex-col items-center gap-1"
          >
            <ScorePill
              label={userLabel}
              tone={userTone}
              value={userPillValue}
              outcome={isResolved && !brawlMode ? lastResultMessage : undefined}
              outcomeStyle={outcomeBadgeStyle}
              atBatId={atBatId}
              banner={userBanner}
              // SZN hides the bottom PlayerHero rail; keep the matchup total in
              // the pill at md+. Brawl Mode also hides the rail (the pill IS
              // the HP readout) so it's likewise canonical there.
              heroHasValue={!sznRunActive && !brawlMode}
              // Hit Scale hint is a batter-only concept ("if you win, +N to
              // your hit"). Only show it when the user IS the batter.
              hitScaleHint={
                userIsBatting && isSelecting && matchup.batterWinning && matchup.batterHitScaleBonus !== 0
                  ? matchup.batterHitScaleBonus
                  : null
              }
              rosterSynergyHint={userSznRosterSynergyAmount}
              rosterSynergyTitle={userSznRosterSynergyTitle}
              brawlHpMax={userBrawlHpMax}
              brawlHpSide="user"
              brawlHpFill={userBrawlHpFill}
            />
            {brawlMode && (
              <BrawlBonusToast side={userIsBatting ? 'batter' : 'pitcher'} />
            )}
          </div>

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

          {showFrozenMatchupMath && lastRevealMathSnapshot && userIsBatting && (
            <MatchupMath
              caption={isRevealing ? 'Locked-in math (reveal)' : 'Locked-in math'}
              chainSum={lastRevealMathSnapshot.batter.chainSum}
              pitcherDelta={lastRevealMathSnapshot.batter.pitcherDelta}
              carryoverDelta={lastRevealMathSnapshot.batter.carryoverDelta}
              guessDelta={lastRevealMathSnapshot.batter.guessDelta}
              total={lastRevealMathSnapshot.batter.total}
              ignoresDebuffs={lastRevealMathSnapshot.batter.ignoresDebuffs}
              chainOf={lastRevealMathSnapshot.batter.chainOf}
              handSize={lastRevealMathSnapshot.batter.handSize}
            />
          )}

          {showFrozenMatchupMath && lastRevealMathSnapshot && !userIsBatting && (
            <MatchupMath
              caption={
                isRevealing ? 'Your pitching total (locked in)' : 'Your pitching total — how it was built'
              }
              chainSum={lastRevealMathSnapshot.pitcher.chainSum}
              pitcherDelta={lastRevealMathSnapshot.pitcher.batterDelta}
              carryoverDelta={lastRevealMathSnapshot.pitcher.carryoverDelta}
              guessDelta={0}
              total={lastRevealMathSnapshot.pitcher.total}
              ignoresDebuffs={false}
              chainOf={lastRevealMathSnapshot.pitcher.chainOf}
              handSize={lastRevealMathSnapshot.pitcher.handSize}
              crossSideLabel="Batter"
              crossSideTitle="Aggregate pressure from the batter's side on your pitching total. Individual batter cards stay hidden; this row is the credited modifier total only."
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

          {brawlMode && isSelecting && (
            <BrawlSnapAttackHint
              remainingMs={brawlSnapRemainingMs}
              hasSnapChain={userHasSnapChain}
            />
          )}

          <div data-tutorial="user-hand" data-brawl-hand="user">
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
              // Controller surface: amber ring on focused card, violet
              // ring + pulse on grabbed card. Gated on
              // `gamepadPresent` so a disconnect (or mouse-only player)
              // never leaves a stale highlight on the strip; entering
              // the 'hand' surface also requires gamepad DPAD_UP, so
              // this is the canonical "controller is driving" check.
              gamepadFocusedCardId={
                gamepadPresent && sznGamepadFocus === 'hand'
                  ? gamepadFocusedHandCardId
                  : null
              }
              gamepadGrabbedCardId={
                gamepadPresent ? gamepadGrabbedHandCardId : null
              }
            />
          </div>

          <AnimatePresence mode="wait">
            {isSelecting && (
              <motion.div
                key="lockin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex flex-col items-center gap-2"
              >
                {brawlMode ? (
                  // Brawl Mode replaces the manual Lock In commit with the
                  // snap timer. The countdown is the user's only
                  // pre-resolution affordance: snap cards together until 0
                  // and the engine commits whatever they've built. While
                  // the inning-start draft overlay is up we UNMOUNT the
                  // timer so it re-anchors fresh once the user picks --
                  // otherwise the 15s would tick down behind the picker.
                  brawlDraftActive ? null : (
                    <BrawlSnapTimer
                      phase={phase}
                      atBatId={atBatId}
                      onTimeout={lockIn}
                      onRemainingMsChange={setBrawlSnapRemainingMs}
                    />
                  )
                ) : (
                  <CtaButton
                    data-tutorial="lock-in"
                    onClick={lockIn}
                    focused={screenCtaFocused}
                    tone="blue"
                    size="lg"
                  >
                    Lock In
                  </CtaButton>
                )}
                {sznRunActive && !tutorialActive && !brawlMode && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <QuickResolveToggle
                      enabled={quickResolveEnabled}
                      active={quickResolveActive}
                      onChange={setQuickResolveEnabled}
                    />
                    {/* One-shot "Resolve Inning" burst -- bypasses the
                        leverage gate for this inning only. Useful in
                        blowouts where Quick Resolve's leverage check
                        is being too conservative (e.g. RISP with a
                        12-run lead). Highlights when armed so the
                        user knows the burst is active. */}
                    <button
                      type="button"
                      onClick={requestResolveInning}
                      disabled={resolveInningArmed}
                      title={
                        resolveInningArmed
                          ? 'Resolve Inning is armed — auto-resolving every at-bat this inning.'
                          : 'Burn through the rest of THIS inning with no leverage check.'
                      }
                      className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] ring-1 transition-all shadow ${
                        resolveInningArmed
                          ? 'bg-emerald-500/90 text-emerald-950 ring-emerald-300 shadow-emerald-900/40 cursor-default'
                          : 'bg-slate-700/60 text-slate-300 ring-slate-500/40 hover:bg-slate-700/80 hover:text-slate-100'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          resolveInningArmed
                            ? 'bg-emerald-900 animate-pulse'
                            : 'bg-slate-400'
                        }`}
                      />
                      {resolveInningArmed
                        ? `Bursting Inning ${inning}`
                        : 'Resolve Inning'}
                    </button>
                  </div>
                )}
                {/* Discoverability nudge: the QuickResolveToggle pill is
                    small enough that first-time SZN players were missing
                    it entirely during playtest. When we hit a verifiable
                    low-leverage spot but the toggle is OFF, surface a
                    one-line hint right under the toggle pill so the player
                    learns the feature exists exactly at the moment it
                    would help them. Auto-hides the moment the toggle is
                    flipped on (active OR armed) so it doesn't compete with
                    the pill's own state visuals. */}
                {sznRunActive &&
                  !tutorialActive &&
                  !brawlMode &&
                  !quickResolveEnabled &&
                  isLowLeverage && (
                    <button
                      type="button"
                      onClick={() => setQuickResolveEnabled(true)}
                      className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/80 hover:text-emerald-100 underline decoration-dotted underline-offset-4 transition-colors"
                      title="Auto-resolves this and other low-leverage at-bats. Toggle off any time."
                    >
                      Boring spot — tap Quick Resolve to skip
                    </button>
                  )}
              </motion.div>
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
                  <CtaButton
                    onClick={startNextAtBat}
                    focused={screenCtaFocused}
                    tone="emerald"
                    size="md"
                  >
                    Next At-Bat
                  </CtaButton>
                ) : sznRunActive ? (
                  <CtaButton
                    onClick={() =>
                      reportSeriesGameResult(
                        seriesGameResult.result,
                        seriesGameResult.userScore,
                        seriesGameResult.ghostScore,
                      )
                    }
                    focused={screenCtaFocused}
                    tone="emerald"
                    size="md"
                  >
                    Continue Run
                  </CtaButton>
                ) : (
                  <CtaButton
                    onClick={() => setShowStartScreen(true)}
                    focused={screenCtaFocused}
                    tone="rose"
                    size="md"
                  >
                    New Game
                  </CtaButton>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {!brawlMode && <ManagerHand side={userSide} />}

      {/* SZN deck footer is mounted at App level so it persists across
          the entire SZN experience (front office, draft, series intro,
          combat). It self-locates this overlay's user-hand container
          via the `data-szn-hand-drop-zone` attribute set above. */}

      {/* Brawl Mode reveal: cards fly at HP pills, R3F-driven particle
          impacts. Mounted *outside* the inner layout so the fullscreen
          fixed overlay (canvas + DOM ghosts) draws above the field but
          below the HitResultBanner that sits at the top of this
          fragment. The components themselves are no-ops when there's
          nothing in-flight (empty impacts + empty flying arrays). */}
      {brawlMode && phase === 'revealing' && (
        <BrawlAttackOverlay
          impacts={brawlReveal.impacts}
          flying={brawlReveal.flying}
          auras={brawlAuras}
          hitNumbers={brawlReveal.hitNumbers}
          shakePulse={brawlShake}
          attackPhase={brawlReveal.attackPhase}
        />
      )}
    </>
  );
};

/**
 * Compact pill toggle that lives right under the Lock In button during
 * SZN combat. Drives the auto-resolve chain in `CardGameOverlay` via
 * the `quickResolveEnabled` store flag. The pill has three visual
 * states so the player always knows what auto-pilot is doing:
 *   - OFF: dim slate -- toggle is off, every at-bat is manual.
 *   - ARMED: amber outline -- toggle is on but the current spot is
 *     high-leverage (RISP, tied late, etc.), so the chain is paused
 *     and the player has to lock in by hand.
 *   - ACTIVE: emerald solid -- toggle is on AND auto-pilot is
 *     currently driving the chain through low-leverage at-bats.
 */
const QuickResolveToggle = ({
  enabled,
  active,
  onChange,
}: {
  enabled: boolean;
  active: boolean;
  onChange: (next: boolean) => void;
}) => {
  // Three-state visual: OFF / ARMED (on but waiting) / ACTIVE (running).
  const state: 'off' | 'armed' | 'active' = !enabled
    ? 'off'
    : active
      ? 'active'
      : 'armed';
  const palette =
    state === 'active'
      ? 'bg-emerald-500/90 text-emerald-950 ring-emerald-300 shadow-emerald-900/40'
      : state === 'armed'
        ? 'bg-amber-400/20 text-amber-100 ring-amber-300/70 shadow-amber-900/30'
        : 'bg-slate-700/60 text-slate-300 ring-slate-500/40 hover:bg-slate-700/80 hover:text-slate-100';
  const label =
    state === 'active'
      ? 'Quick Resolve · ON'
      : state === 'armed'
        ? 'Quick Resolve · Armed'
        : 'Quick Resolve';
  const dotClass =
    state === 'active'
      ? 'bg-emerald-900 animate-pulse'
      : state === 'armed'
        ? 'bg-amber-300'
        : 'bg-slate-400';
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      title={
        state === 'active'
          ? 'Auto-resolving low-leverage at-bats. Click to turn off.'
          : state === 'armed'
            ? 'Quick Resolve is on, but this spot is high-leverage. The chain will resume on the next boring at-bat.'
            : 'Auto-resolve obvious blowouts and garbage-time at-bats.'
      }
      className={`relative flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] ring-1 transition-all shadow ${palette} ${
        // "Armed but waiting" used to read as just a faint amber pill --
        // playtest reports flagged the state as easy to miss, so we now
        // add a wider amber ring + a soft pulsing border so the user
        // sees at a glance that auto-pilot is active and paused on a
        // high-leverage spot.
        state === 'armed' ? 'ring-2 ring-amber-300/70 animate-pulse' : ''
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {label}
    </button>
  );
};

/**
 * Brawl Mode snap timer. Replaces the manual Lock In button: the user has
 * exactly 15 seconds (BRAWL_SNAP_DURATION_MS) to snap cards together and
 * pump their HP pill before the at-bat auto-commits. Renders a chunky
 * countdown directly under the user's hand so the urgency is unmissable;
 * the bar drains left-to-right and the digit ticks down once per second.
 *
 * Mounts only during `phase === "selecting"`. Resets every time the phase
 * re-enters selecting (next at-bat), so a 0s leftover from the previous
 * play can't auto-lock the fresh one. The timeout calls `onTimeout` once
 * and only once via a ref-guarded effect -- otherwise an `effect` re-run
 * could fire the auto-commit twice (which would silently re-run `lockIn`
 * after the engine already moved into `revealing`, no-op now but a tax on
 * future refactors).
 *
 * Visual tone: amber-orange to read as "decision pressure" rather than
 * the blue/emerald of the existing Lock In CTA -- a different vocabulary
 * for a different lane. Pulses the ring on the final 2 seconds so the
 * user feels the squeeze.
 */
function BrawlSnapAttackHint({
  remainingMs,
  hasSnapChain,
}: {
  remainingMs: number;
  hasSnapChain: boolean;
}) {
  const show =
    remainingMs <= BRAWL_SNAP_HINT_THRESHOLD_MS && remainingMs > 0 && !hasSnapChain;
  const urgent = remainingMs <= 2000;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="brawl-snap-hint"
          initial={{ opacity: 0, y: 8, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.96 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          className={`px-4 py-2 rounded-xl border-2 backdrop-blur-sm shadow-lg select-none ${
            urgent
              ? 'border-rose-300/80 bg-rose-950/85 text-rose-100 ring-2 ring-rose-400/35 animate-pulse'
              : 'border-amber-300/70 bg-amber-950/80 text-amber-100 ring-1 ring-amber-400/25'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="text-[10px] font-black uppercase tracking-[0.28em] text-center">
            Snap to Attack
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-center opacity-90">
            Drag adjacent cards together before time runs out
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BrawlSnapTimer({
  phase,
  atBatId,
  onTimeout,
  onRemainingMsChange,
}: {
  phase: Phase;
  /** Resets the countdown when a fresh at-bat deals in. */
  atBatId: number;
  onTimeout: () => void;
  /** Fires every animation frame while selecting so sibling UI (hints) can react. */
  onRemainingMsChange?: (ms: number) => void;
}) {
  const prepareBrawlOpponent = useGameStore((s) => s.prepareBrawlOpponent);
  const [remainingMs, setRemainingMs] = useState(BRAWL_SNAP_DURATION_MS);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  const onRemainingMsChangeRef = useRef(onRemainingMsChange);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);
  useEffect(() => {
    onRemainingMsChangeRef.current = onRemainingMsChange;
  }, [onRemainingMsChange]);

  // Re-run the brawl optimizer while the user rearranges cards so the
  // opponent adapts to the player's current order and forged seams.
  useEffect(() => {
    if (phase !== 'selecting') return;
    prepareBrawlOpponent();
    const id = window.setInterval(() => prepareBrawlOpponent(), BRAWL_AI_REEVAL_MS);
    return () => window.clearInterval(id);
  }, [phase, atBatId, prepareBrawlOpponent]);

  // Drive the countdown off a fresh start time each time we (re)enter
  // selecting. Without re-anchoring, the user could "save" leftover
  // time between at-bats by ripping fast on the previous one.
  useEffect(() => {
    if (phase !== 'selecting') {
      onRemainingMsChangeRef.current?.(BRAWL_SNAP_DURATION_MS);
      return;
    }
    firedRef.current = false;
    const startedAt = Date.now();
    setRemainingMs(BRAWL_SNAP_DURATION_MS);
    onRemainingMsChangeRef.current?.(BRAWL_SNAP_DURATION_MS);
    // Track the last full-second the snap-tick SFX fired so the timer
    // ticks exactly once per second across the final 5 seconds even
    // though we drive the countdown off requestAnimationFrame.
    let lastTickSecond = -1;
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const next = Math.max(0, BRAWL_SNAP_DURATION_MS - elapsed);
      setRemainingMs(next);
      onRemainingMsChangeRef.current?.(next);
      // Snap-timer tick SFX: only fires inside the final 5s window so
      // the audio cue tracks the visible urgency state (timer pulses
      // amber → rose at the same threshold). The `> 0` guard keeps
      // the auto-lock chime as the sole sound at 0s.
      if (next > 0 && next <= 5000) {
        const secondsLeft = Math.ceil(next / 1000);
        if (secondsLeft !== lastTickSecond) {
          lastTickSecond = secondsLeft;
          playSfx("snapTick");
        }
      }
      if (next <= 0) {
        if (!firedRef.current) {
          firedRef.current = true;
          // Auto-lock chime once, paired with the lockIn call.
          playSfx("snapLock");
          // Defer the lockIn call by a frame so React can finish the
          // current render before the store mutates the phase out from
          // under us. Same trick the reveal orchestrator uses.
          raf = requestAnimationFrame(() => onTimeoutRef.current());
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [phase, atBatId]);

  if (phase !== 'selecting') return null;

  const seconds = Math.ceil(remainingMs / 1000);
  const fillPct = Math.max(0, Math.min(100, (remainingMs / BRAWL_SNAP_DURATION_MS) * 100));
  const fillScale = fillPct / 100;
  const urgent = remainingMs <= 2000;

  return (
    <div
      className={`relative flex items-center gap-3 px-5 py-3 rounded-xl bg-slate-950/85 border-2 shadow-[0_4px_24px_rgba(0,0,0,0.55)] backdrop-blur-sm select-none ${
        urgent
          ? 'border-rose-400/80 ring-2 ring-rose-400/40 animate-pulse'
          : 'border-amber-400/70 ring-2 ring-amber-300/30'
      }`}
      role="timer"
      aria-live="off"
      aria-label={`Brawl snap timer: ${seconds} seconds remaining`}
    >
      <div className="flex flex-col items-start gap-1">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-200/90">
          Snap Timer
        </span>
        {/* Drains horizontally so the user reads "time slipping away"
            without having to track the digit. Width is clamped to a
            fixed 96px so the bar doesn't visually stretch the pill. */}
        <div className="relative h-1.5 w-24 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full w-full origin-left rounded-full ${
              urgent ? 'bg-rose-400' : 'bg-amber-300'
            }`}
            style={{ transform: `scaleX(${fillScale})` }}
          />
        </div>
      </div>
      <div
        className={`tabular-nums font-black text-4xl leading-none ${
          urgent ? 'text-rose-300 drop-shadow-[0_0_12px_rgba(251,113,133,0.6)]' : 'text-amber-200'
        }`}
      >
        {seconds}
      </div>
    </div>
  );
}

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
/**
 * Brawl bonus toast — a tight strip of badges that floats beside each
 * HP pill after lock-in, surfacing the snap-speed / chain / hot-streak
 * HP rewards that `lockIn` actually applied. Reads `lastBrawlBonusBreakdown`
 * from the store (kept alive across the next at-bat by design so the player
 * sees their reward for the previous snap until the next deal settles).
 *
 * Hidden during `selecting` (the bonuses for the upcoming at-bat haven't
 * been resolved yet) and during non-brawl modes. Self-mutes when the
 * breakdown is null OR every component is zero so we don't render an
 * empty pill on at-bats where nothing notable happened.
 */
const BrawlBonusToast = ({
  side,
}: {
  /** Which seat this toast attaches to — drives both color polarity
   *  and which sub-fields of the breakdown to read. */
  side: 'batter' | 'pitcher';
}) => {
  const breakdown = useGameStore((s) => s.lastBrawlBonusBreakdown);
  const phase = useGameStore((s) => s.phase);
  const gameMode = useGameStore((s) => s.gameMode);
  const atBatId = useGameStore((s) => s.atBatId);
  // Toast lifetime: pop in at reveal-start, hold through the resolve
  // pause, fade after BONUS_TOAST_LIFETIME_MS. Keyed on atBatId so a
  // fresh at-bat re-triggers the entry animation cleanly even though
  // lastBrawlBonusBreakdown persists across the deal.
  const [visible, setVisible] = useState(true);
  const inWindow =
    gameMode === 'brawl' &&
    !!breakdown &&
    (phase === 'revealing' ||
      phase === 'between-at-bats' ||
      phase === 'game-over');
  useEffect(() => {
    if (!inWindow) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const BONUS_TOAST_LIFETIME_MS = 2800;
    const t = window.setTimeout(() => setVisible(false), BONUS_TOAST_LIFETIME_MS);
    return () => window.clearTimeout(t);
  }, [atBatId, inWindow]);
  if (gameMode !== 'brawl') return null;
  if (!breakdown) return null;
  if (!inWindow) return null;
  const snap =
    side === 'batter' ? breakdown.batterSnapBonus : breakdown.pitcherSnapBonus;
  const chain =
    side === 'batter' ? breakdown.batterChainBonus : breakdown.pitcherChainBonus;
  const streak =
    side === 'batter'
      ? breakdown.batterStreakBonus
      : breakdown.pitcherStreakBonus;
  if (snap === 0 && chain === 0 && streak === 0) return null;
  const badges: Array<{ key: string; label: string; tone: string }> = [];
  if (snap > 0) {
    badges.push({
      key: 'snap',
      label: `SNAP +${snap}`,
      tone: 'bg-sky-500/30 border-sky-300/70 text-sky-100',
    });
  }
  if (chain > 0) {
    badges.push({
      key: 'chain',
      label: `CHAIN +${chain}`,
      tone: 'bg-emerald-500/30 border-emerald-300/70 text-emerald-100',
    });
  }
  if (streak > 0) {
    badges.push({
      key: 'streak',
      label: `HOT STREAK +${streak}`,
      tone: 'bg-amber-500/30 border-amber-300/70 text-amber-100',
    });
  }
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={`brawl-bonus-${side}-${atBatId}`}
          initial={{ opacity: 0, y: -8, scale: 0.7 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.92, transition: { duration: 0.32 } }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="flex flex-wrap items-center justify-center gap-1 pointer-events-none"
        >
          {badges.map((b, i) => (
            <motion.span
              key={b.key}
              initial={{ opacity: 0, y: -4, scale: 0.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 420,
                damping: 18,
                // Cascade so multiple bonuses read sequentially rather
                // than as one indistinct blob — the player wants to
                // register each reward (e.g. "Snap... then Chain...
                // then Hot Streak").
                delay: 0.05 + i * 0.12,
              }}
              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.18em] leading-none border shadow-sm ${b.tone}`}
              style={{ textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
            >
              {b.label}
            </motion.span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const HitResultBanner = ({
  outcome,
  phase,
  atBatId,
  resolveLog,
  batterTotal,
  pitcherTotal,
  batterName,
  pitcherName,
  userIsBatting,
  brawlResolution,
}: {
  outcome: HitOutcome | null;
  phase: Phase;
  atBatId: number;
  /**
   * Player-facing resolve-step lines (e.g. "Stolen Bag: extra runner placed
   * on 1B"). Rendered as small chips beneath the hit label so post-hit card
   * effects don't read as visual glitches when a phantom runner pops onto
   * the field.
   */
  resolveLog: string[];
  /**
   * Locked-in totals from the reveal math snapshot. Drives the
   * "why this happened" scoreline chip ("Batter 58 vs Pitcher 40 ·
   * Wins by 18") so the user can see at-a-glance why the outcome
   * landed the way it did. Both null on the very first render (no
   * at-bat has resolved yet) -- the chip just hides itself.
   */
  batterTotal: number | null;
  pitcherTotal: number | null;
  batterName: string | null;
  pitcherName: string | null;
  /** Drives the "You won by X" / "Beat you by X" wording polarity. */
  userIsBatting: boolean;
  /**
   * Brawl Mode HP-ladder snapshot from the last lock-in. When present
   * we override the banner copy with the HP scoreline ("Batter HP 24
   * vs Pitcher HP 3 · Grand Slam by 21") and pop a louder GRAND SLAM!
   * sub-label on `grandSlam` outcomes. Null in non-brawl lanes -- the
   * banner falls back to the regular chain-math scoreline.
   */
  brawlResolution: BrawlOutcomeResolution | null;
}) => {
  const [visible, setVisible] = useState(false);
  const brawlDraftActive = useGameStore((s) => s.brawlDraftChoice !== null);
  const inResolvedPhase =
    phase === 'between-at-bats' || phase === 'game-over';
  // Side-switch suppression: during the ~2s window after a half retires
  // (i.e. the at-bat that produced this outcome was the 3rd out), the
  // `InningTransitionBanner` ("TOP OF THE 2ND · YOU'RE PITCHING NOW") and
  // (in brawl) the `BrawlInningSummaryOverlay` recap card BOTH light up
  // in the screen center. Stacking the hit video on top of those reads
  // as a pile of unrelated chrome -- the player can't tell which one to
  // read first. The score pill already shows the outcome, so we just
  // skip the hit banner for the at-bat that flipped the half.
  const isFirstAtBatOfInning = useGameStore((s) => s.isFirstAtBatOfInning);
  const sideJustSwitched =
    isFirstAtBatOfInning &&
    (phase === 'between-at-bats' || phase === 'game-over');
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
    if (sideJustSwitched) {
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
  }, [phase, outcome, atBatId, sideJustSwitched]);

  const cfg = HIT_BANNER_CONFIG[outcome ?? 'out'];
  if (!cfg) return null;

  // The banner now only shows the final scoreline -- the per-beat math
  // (per-card buffs, debuffs, carryovers) is conveyed visually during the
  // reveal phase by `RevealAttackOverlay` (cards lunging at each other +
  // floating damage / buff counters). Adding a "Pitcher held you off by 18"
  // verb chip on top of those counters duplicates information the player
  // already watched land, so the verb line has been removed. The totals
  // chip stays because it summarizes the matchup at a glance after the
  // animations have finished.
  const hasMath = batterTotal !== null && pitcherTotal !== null;
  const batterWon = hasMath && batterTotal! > pitcherTotal!;
  const margin = hasMath ? Math.abs(batterTotal! - pitcherTotal!) : 0;
  const userWonMatchup = userIsBatting ? batterWon : !batterWon;
  const verb = batterWon
    ? userIsBatting
      ? `You out-hit by ${margin}`
      : `Hit through you by ${margin}`
    : userIsBatting
      ? `Pitcher held you off by ${margin}`
      : `You shut it down by ${margin}`;

  // Brawl Mode overrides. The "scoreline" reads as HP ("Batter HP 24
  // vs Pitcher HP 3") instead of head-to-head chain totals, and the
  // margin label uses HP-flavored verbiage so the user reads the
  // ladder thresholds in the same vocabulary as the snap timer + pill.
  const inBrawl = brawlResolution !== null;
  const brawlBatterWon = inBrawl ? brawlResolution.batterWon : batterWon;
  const brawlMargin = inBrawl ? brawlResolution.winnerHP : margin;
  const brawlUserWon = userIsBatting ? brawlBatterWon : !brawlBatterWon;
  const brawlVerb = inBrawl
    ? brawlBatterWon
      ? userIsBatting
        ? `Finished with ${brawlMargin} HP`
        : `They finished with ${brawlMargin} HP`
      : userIsBatting
        ? `Shield broken (${brawlResolution!.pitcherRemainingHP} HP left)`
        : `Shut down — ${brawlResolution!.pitcherRemainingHP} HP left`
    : verb;
  const scorelineBatterLabel = inBrawl
    ? `${batterName ?? 'Batter'} HP ${brawlResolution!.batterRemainingHP}`
    : `${batterName ?? 'Batter'} ${batterTotal}`;
  const scorelinePitcherLabel = inBrawl
    ? `${pitcherName ?? 'Pitcher'} HP ${brawlResolution!.pitcherRemainingHP}`
    : `${pitcherName ?? 'Pitcher'} ${pitcherTotal}`;
  const isGrandSlam = brawlResolution?.grandSlam === true;

  // Ball-in-play outcomes: video + a single HTML hit-type chyron overlaid
  // on the clip. Scorelines, resolve-log chips, grand-slam badges, and
  // confetti were removed from this beat — matchup math already landed
  // during reveal; the center should read as one broadcast cut-in.
  const hitVideo =
    outcome === 'single' ||
    outcome === 'double' ||
    outcome === 'triple' ||
    outcome === 'homerun'
      ? HIT_VIDEOS[outcome]
      : null;
  const hitTypeLabel = isGrandSlam ? 'Grand Slam!' : cfg.label;
  const hitVideoAria = hitVideo ? hitTypeLabel : '';
  // Synchronous gate (don't rely on the visibility timeout alone).
  // When the inning-start draft opens (`selecting` + brawlDraftChoice)
  // or we leave the resolved beat, unmount immediately so a lingering
  // `fixed z-[200]` hit-video layer can't paint over the draft scrim
  // and trap the player on a dark fullscreen.
  const shouldShow =
    visible && inResolvedPhase && !sideJustSwitched && !brawlDraftActive;

  return (
    <AnimatePresence>
      {shouldShow && (
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
          className={
            hitVideo
              ? // Fixed + high z so the clip paints above score pills,
                // hands, CTAs, and UIOverlay chrome during the result
                // beat only. Draft overlay uses z-[220] so it stays on top.
                'fixed inset-0 z-[200] pointer-events-none flex items-center justify-center'
              : 'absolute inset-0 z-30 pointer-events-none flex items-center justify-center'
          }
        >
          {hitVideo ? (
            <div className="relative w-[min(72vw,540px)] rounded-2xl overflow-hidden shadow-2xl">
              <video
                key={`hit-video-${atBatId}-${outcome}`}
                src={hitVideo.src}
                autoPlay
                muted
                playsInline
                aria-label={hitVideoAria}
                className="block w-full h-auto"
              />
              <div
                className="absolute inset-x-0 bottom-0 flex items-end justify-center pb-5 pt-16 bg-gradient-to-t from-black/80 via-black/35 to-transparent pointer-events-none"
                aria-hidden="true"
              >
                <span
                  className={`text-4xl sm:text-5xl font-black uppercase tracking-[0.2em] leading-none ${
                    isGrandSlam
                      ? 'text-amber-200'
                      : outcome === 'homerun'
                        ? 'text-orange-200'
                        : outcome === 'triple'
                          ? 'text-emerald-200'
                          : outcome === 'double'
                            ? 'text-sky-200'
                            : 'text-blue-100'
                  }`}
                  style={{ textShadow: '0 2px 12px rgba(0,0,0,0.85)' }}
                >
                  {hitTypeLabel}
                </span>
              </div>
            </div>
          ) : (
          <div
            className={`px-10 py-4 rounded-3xl shadow-2xl border-4 ${cfg.classes} flex flex-col items-center gap-1`}
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
          >
            <span className="text-5xl font-black uppercase tracking-[0.18em] leading-none">
              {isGrandSlam ? 'GRAND SLAM!' : cfg.label}
            </span>
            {/* Grand-slam swap: replace the standard "HOMERUN" / "FOUR-
                BAGGER" sub-label with a louder bases-cleared cue so
                the 21+ HP swing reads as the apex outcome the brawl
                ladder promises. Falls back to the normal `cfg.sub`
                for everything else. */}
            {isGrandSlam ? (
              <span className="text-xs font-black uppercase tracking-[0.32em] opacity-90 text-amber-200 drop-shadow-[0_0_8px_rgba(251,191,36,0.65)]">
                Bases cleared · 4 RBI · {brawlResolution!.winnerHP} HP swing
              </span>
            ) : (
              cfg.sub && (
                <span className="text-xs font-bold uppercase tracking-[0.32em] opacity-80">
                  {cfg.sub}
                </span>
              )
            )}
            {/* Broadcaster bark -- italic single-line PA-system
                quote that adds in-stadium texture without crowding
                the score breakdown below. Deterministic per
                atBatId so the line is stable across the banner's
                3.6s visibility window. */}
            {outcome && (
              <span
                className="mt-0.5 text-xs italic opacity-80 font-medium tracking-normal normal-case"
                style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
              >
                &ldquo;{pickBark(outcome, atBatId)}&rdquo;
              </span>
            )}
            {/* Scoreline chip -- the final totals after every per-card
                effect has resolved. The matchup margin / "you out-hit
                by X" verb chip used to live below this row, but it
                duplicates what the in-flight attack/buff counters
                already showed the player; the totals stay as a
                post-reveal "scoreboard" anchor. */}
            {hasMath && (
              <div className="mt-2 flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] opacity-95">
                  <span className="rounded-md bg-slate-900/40 px-2 py-0.5 border border-white/25">
                    {scorelineBatterLabel}
                  </span>
                  <span className="opacity-70">vs</span>
                  <span className="rounded-md bg-slate-900/40 px-2 py-0.5 border border-white/25">
                    {scorelinePitcherLabel}
                  </span>
                </div>
                <span
                  className={`mt-0.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] border ${
                    (inBrawl ? brawlUserWon : userWonMatchup)
                      ? 'bg-emerald-500/30 border-emerald-200/60'
                      : 'bg-rose-500/30 border-rose-200/60'
                  }`}
                >
                  {brawlVerb}
                </span>
              </div>
            )}
            {/* Resolve-step log: tells the player WHY follow-on effects fired
                (e.g. an extra phantom runner from b-135 Stolen Bag). Renders
                as compact chips under the hit label so the field doesn't
                look glitched when more than one runner appears on a single
                at-bat. */}
            {resolveLog.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 max-w-[420px]">
                {resolveLog.map((line, i) => (
                  <span
                    key={`${atBatId}-rlog-${i}`}
                    className="px-2 py-0.5 rounded-full bg-slate-900/35 text-[10px] font-bold uppercase tracking-[0.18em] leading-none border border-white/30"
                    style={{ textShadow: 'none' }}
                  >
                    {line}
                  </span>
                ))}
              </div>
            )}
          </div>
          )}
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
 * Ball-in-play video clips. One per hit outcome. Rendered by
 * `HitResultBanner` in place of the styled gradient pill so a hit feels
 * like an actual broadcast cut-in (animated play type chyron over a
 * looping highlight clip) rather than a text card. Lives under
 * `public/videos/` so the paths are static-served by Vite/Next at the
 * leading-slash URL below.
 */
const HIT_VIDEOS: Record<
  Exclude<HitOutcome, 'out'>,
  { src: string; label: string }
> = {
  single: { src: '/videos/single.mp4', label: 'Single!' },
  double: { src: '/videos/double.mp4', label: 'Double!' },
  triple: { src: '/videos/triple.mp4', label: 'Triple!' },
  homerun: { src: '/videos/home-run.mp4', label: 'Home Run!' },
};

/**
 * Per-outcome broadcaster barks. Picked deterministically by
 * `atBatId` so the same at-bat keeps the same call across the
 * banner's 3.6s visibility window (no mid-banner reshuffle) but
 * each new at-bat rolls a fresh line. Pure flavor — adds the
 * "in-stadium PA system" texture the playtest report asked for
 * without touching any gameplay state.
 *
 * Lines stay short (≤8 words, no punctuation that wraps) so the
 * pill stays a single readable line under the result label.
 */
const HIT_BANNER_BARKS: Record<HitOutcome, string[]> = {
  homerun: [
    "Going, going, GONE.",
    "Crowd's on their feet!",
    "See ya later, baseball.",
    "Touch 'em all.",
    "That ball is OUTTA HERE.",
    "Bomb to the bleachers.",
  ],
  triple: [
    "Wheels for days.",
    "He's gonna stretch this!",
    "Slides in safe at third.",
    "Gap shot, all the way.",
    "Race against the throw — SAFE.",
  ],
  double: [
    "Stand-up double.",
    "Splits the gap.",
    "Off the wall, in play.",
    "Coast into second.",
    "Two bags, no problem.",
  ],
  single: [
    "Base knock.",
    "Found the hole.",
    "Bloop hit drops in.",
    "Hard contact, base knock.",
    "On the board.",
  ],
  out: [
    "Sat him down.",
    "Caught looking.",
    "Routine play.",
    "Inning over.",
    "Strike three — he's gone.",
    "Webbed it.",
  ],
};

function pickBark(outcome: HitOutcome, atBatId: number): string {
  const pool = HIT_BANNER_BARKS[outcome];
  if (!pool || pool.length === 0) return "";
  // Mix the atBatId so different at-bats roll different barks but
  // a re-render of the same at-bat keeps the same line.
  const idx = Math.abs((atBatId * 2654435761) >>> 0) % pool.length;
  return pool[idx];
}

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

/*
 * The toggleable `SznDugoutPanel` drawer was removed; bag items now
 * live in the always-visible `SznFooterDecks` row alongside the bench
 * players. See `src/components/SznFooterDecks.tsx`.
 */

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
    // p-36 Ace's Command nullifies the ABILITY of the batter's highest card,
    // not the card itself -- the base value still scores. The previous chip
    // text ("Highest Card Silenced") read like the whole card was nuked, so
    // playtesters saw the card's value count anyway and assumed a bug.
    // "Top Card Ability Off" lines up with the longer tooltip below.
    if (pitcherHand.some((c) => c.id === 'p-36')) {
      out.push({ key: 'p-36', label: 'Top Card Ability Off' });
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
   * SZN Mode: roster tag synergy bonus included in `value`. Shown as a small
   * "+N ROSTER" chip when non-zero so the pill gap vs chain MLB card(s) reads
   * intentionally.
   */
  rosterSynergyHint?: number | null;
  /** Tooltip / a11y title for `rosterSynergyHint` (active synergy labels). */
  rosterSynergyTitle?: string;
  /**
   * Current at-bat id. Used to scope the outcome chip's exit-animation key so
   * that when `Next At-Bat` is clicked the prior chip ("ELLY DE LA CRUZ: OUT
   * (17 vs 24)") force-unmounts crisply instead of bleeding 200-300ms of
   * default exit fade into the next at-bat's card-selection HUD (B1 fix).
   */
  atBatId?: number;
  /**
   * When true, the live BATTER/PITCHER total is also being rendered by the
   * left-rail PlayerHero (md-and-up only). The pill's label+value span is
   * then hidden at the `md` breakpoint so the user isn't reading the same
   * number twice; the pill bg itself collapses too when there's nothing
   * else to anchor (no outcome chip, no hit-scale hint). Below `md` -- where
   * the hero rail is hidden -- the pill stays the canonical readout.
   */
  heroHasValue?: boolean;
  /**
   * Brawl reveal: locked-in max HP. When set alongside a numeric `value`,
   * the pill renders an internal left-to-right fill so the pill itself
   * reads as an HP bar while keeping its rounded shape.
   */
  brawlHpMax?: number | null;
  /** Brawl fill tint — user (amber) vs opponent (rose). */
  brawlHpSide?: 'user' | 'opponent';
  /** When true the pill always renders as an HP bar (track + fill). */
  brawlHpFill?: boolean;
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
  rosterSynergyHint = null,
  rosterSynergyTitle,
  atBatId,
  heroHasValue = false,
  brawlHpMax = null,
  brawlHpSide = 'user',
  brawlHpFill = false,
}: ScorePillProps) => {
  const showBrawlFill = brawlHpFill && value != null && value >= 0;
  const safeMax = Math.max(1, brawlHpMax ?? value ?? 1);
  const clampedHp = showBrawlFill
    ? Math.max(0, Math.min(safeMax, value!))
    : 0;
  const fillPct = showBrawlFill ? (clampedHp / safeMax) * 100 : 100;
  const critical = showBrawlFill && fillPct > 0 && fillPct <= 25;
  const brawlFillClass =
    brawlHpSide === 'user'
      ? 'bg-gradient-to-r from-amber-500/90 via-amber-400/85 to-yellow-300/80'
      : 'bg-gradient-to-r from-rose-500/90 via-rose-400/85 to-red-300/80';
  const brawlFillGlow =
    brawlHpSide === 'user'
      ? '0 0 16px rgba(251,191,36,0.45)'
      : '0 0 16px rgba(244,63,94,0.45)';

  const valueColor = showBrawlFill
    ? 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]'
    : tone === 'batter'
      ? 'text-blue-600'
      : 'text-rose-600';
  const labelColor = showBrawlFill
    ? 'text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]'
    : 'text-slate-500';
  const containerSize = compact
    ? 'px-4 py-1 text-sm gap-2'
    : 'px-6 py-2 text-xl gap-4';

  // At md+ the PlayerHero rail carries the live total, so the pill's
  // label+value span is dropped to avoid a redundant readout. The pill bg
  // itself only stays at md when there's *something else* inside it worth
  // showing (an outcome chip after lock-in, or a hit-scale hint badge mid
  // selection). Below md the heroes are hidden and the pill is the
  // canonical readout, so this collapsing logic is a no-op. The threshold
  // here MUST stay in sync with the `hidden md:block` gate on the hero
  // wrappers above -- otherwise either the pill collapses while no hero
  // shows (no readout at all) or both render and the value is duplicated.
  const hasOutcomeChip = !!outcome;
  const hasRosterSynergyBadge = rosterSynergyHint !== null && rosterSynergyHint > 0;
  const hasHintBadge =
    (hitScaleHint !== null && hitScaleHint !== 0) || hasRosterSynergyBadge;
  const valueGroupClass = heroHasValue ? 'md:hidden' : '';
  const pillBgHiddenAtMd = heroHasValue && !hasOutcomeChip && !hasHintBadge;

  return (
    // `z-30` lifts the pill (and the BeatBanner anchored absolute below it)
    // above sibling cards in the user's column. Without this the banner
    // anchored at `top-full mt-1.5` floats into the flex gap between the
    // pill and the hand strip, and the cards -- whose Framer-applied
    // transforms create their own stacking contexts -- paint over it. The
    // banner only renders during reveal beats, so this z-index is moot
    // during selection / between-at-bats.
    <div className="relative z-30 flex flex-col items-center" data-score-pill={tone}>
      <motion.div
        layout
        className={`relative overflow-hidden rounded-full font-bold shadow-xl border-2 flex flex-wrap items-center justify-center gap-1 ${containerSize} ${pillBgHiddenAtMd ? 'md:hidden' : ''} ${
          showBrawlFill
            ? 'bg-slate-950/55 border-white/35 text-white'
            : 'bg-white/95 backdrop-blur text-slate-900 border-white/50'
        }`}
      >
        {showBrawlFill && (
          <>
            <motion.div
              className={`absolute inset-y-0 left-0 ${brawlFillClass}`}
              initial={false}
              animate={{
                width: `${fillPct}%`,
                filter: critical
                  ? 'brightness(1.2) saturate(1.3)'
                  : 'brightness(1) saturate(1)',
              }}
              transition={{
                width: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
                filter: { duration: 0.3 },
              }}
              style={{ boxShadow: brawlFillGlow }}
              aria-hidden="true"
            />
            {[25, 50, 75].map((t) => (
              <div
                key={t}
                className="absolute top-0 bottom-0 w-px bg-white/12 z-[1]"
                style={{ left: `${t}%` }}
                aria-hidden="true"
              />
            ))}
            {critical && (
              <motion.div
                className="absolute inset-y-0 left-0 z-[1] pointer-events-none"
                initial={false}
                animate={{ opacity: [0.25, 0.55, 0.25] }}
                transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  width: `${fillPct}%`,
                  background:
                    'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
                }}
                aria-hidden="true"
              />
            )}
          </>
        )}
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-1">
        <span className={`flex items-center gap-2 ${valueGroupClass}`}>
          <span className={compact ? `text-[10px] font-extrabold uppercase tracking-widest ${labelColor}` : `text-xs font-extrabold uppercase tracking-widest ${labelColor}`}>
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

        <AnimatePresence>
          {hasRosterSynergyBadge && (
            <motion.span
              key={`rsy-${rosterSynergyHint}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 340, damping: 22 }}
              className={`font-black uppercase tracking-widest rounded-full ring-1 bg-emerald-600/95 text-white ring-emerald-300/50 ${
                compact ? 'text-[9px] px-2 py-0.5' : 'text-[11px] px-2.5 py-0.5'
              }`}
              title={rosterSynergyTitle}
            >
              +{rosterSynergyHint} roster
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
        </div>
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
  /**
   * Label for the aggregate cross-side pressure row. Defaults to
   * "Pitcher" (batter selection); use "Batter" when showing the pitcher's
   * locked-in breakdown from defense.
   */
  crossSideLabel?: string;
  /** Tooltip for the cross-side pressure row. */
  crossSideTitle?: string;
  /** Optional caption above the chips (e.g. reveal / result context). */
  caption?: string;
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
  crossSideLabel = 'Pitcher',
  crossSideTitle = "Aggregate pressure from the pitcher's ability cards (e.g. Wipeout Changeup, Devastating Slider, Filthy Stuff).",
  caption,
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
      label: crossSideLabel,
      value: pitcherDelta,
      tone: pitcherDelta < 0 ? 'neg' : 'pos',
      title: crossSideTitle,
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
      className="flex flex-col items-center gap-0.5 max-w-[420px]"
    >
      {caption ? (
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 text-center px-1 leading-tight">
          {caption}
        </p>
      ) : null}
      <div className="flex flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/85 backdrop-blur border border-white/10 shadow-lg flex-wrap justify-center w-full">
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
      </div>
    </motion.div>
  );
};

type RevealSpotlight =
  | { kind: 'card'; card: CardDefinition; tone: 'source' | 'target'; caption: string }
  | { kind: 'text'; caption: string };

/** Large centered card (or text panel) for the scoring beat driving the reveal sequence. */
const RevealBeatSpotlight = ({
  active,
  spotlight,
  batterCardIds,
  batterModifiers,
  pitcherModifiers,
  batterOverrides,
  pitcherOverrides,
}: {
  active: boolean;
  spotlight: RevealSpotlight | null;
  batterCardIds: Set<string>;
  batterModifiers: Record<string, { value: number; color?: string }>;
  pitcherModifiers: Record<string, { value: number; color?: string }>;
  batterOverrides: Record<string, number>;
  pitcherOverrides: Record<string, number>;
}) => {
  if (!active || !spotlight) return null;

  if (spotlight.kind === 'text') {
    return (
      <div className="fixed inset-0 z-[32] pointer-events-none flex items-center justify-center px-6">
        <motion.div
          key={spotlight.caption}
          initial={{ opacity: 0, scale: 0.92, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="max-w-md rounded-2xl border border-white/15 bg-slate-950/92 px-6 py-5 shadow-2xl backdrop-blur-md"
        >
          <p className="text-center text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
            Scoring effect
          </p>
          <p className="text-center text-sm font-bold leading-snug text-slate-100">{spotlight.caption}</p>
        </motion.div>
      </div>
    );
  }

  const { card, tone, caption } = spotlight;
  const modifier = batterCardIds.has(card.id) ? batterModifiers[card.id] : pitcherModifiers[card.id];
  const valueOverride = batterOverrides[card.id] ?? pitcherOverrides[card.id];

  return (
    <div className="fixed inset-0 z-[32] pointer-events-none flex items-center justify-center px-4">
      <motion.div
        key={card.id + tone + caption}
        className="flex flex-col items-center"
        initial={{ opacity: 0, scale: 0.88, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
      >
        <CardItem
          card={card}
          isConnectedLeft={false}
          isConnectedRight={false}
          modifier={modifier}
          compact={false}
          noMargin
          valueOverride={valueOverride}
          highlightTone={tone}
        />
        <p className="mt-4 max-w-[min(24rem,calc(100vw-2rem))] text-center text-[11px] font-semibold leading-snug text-slate-200 drop-shadow-lg">
          {caption}
        </p>
      </motion.div>
    </div>
  );
};

/**
 * Brawl Mode: per-half summary flashcard. Renders the user-side
 * highlights of the just-completed half-inning (W/L vs AI, longest
 * chain, peak hit outcome) as a centered card during the side-switch
 * window. Reads `brawlInningSummary` from the store -- populated at
 * lockIn when the half flips, cleared at startNextAtBat. Self-mutes
 * when the slot is null OR we're outside brawl OR we're not in the
 * `between-at-bats` pause, so non-brawl modes never see it.
 *
 * Auto-fades on a 2s tween (matches the 2.1s side-switch timer so the
 * overlay exits just before the next at-bat deals in).
 */
const BrawlInningSummaryOverlay = () => {
  const summary = useGameStore((s) => s.brawlInningSummary);
  const gameMode = useGameStore((s) => s.gameMode);
  const phase = useGameStore((s) => s.phase);
  // Live seat read so the "YOU'RE UP TO BAT / PITCHING NOW" cue inside
  // the recap card reflects whichever side the user is sitting in for
  // the NEXT half (UIOverlay's generic InningTransitionBanner is
  // suppressed in brawl, so this card is the only place the side flip
  // is surfaced).
  const userSide = useGameStore(getUiUserSide);
  if (gameMode !== 'brawl') return null;
  if (phase !== 'between-at-bats' && phase !== 'game-over') return null;
  if (!summary) return null;
  // The summary snapshots the JUST-ENDED half; the NEXT half is the
  // mirror image (top -> bottom, bottom -> top of inning+1). Compute
  // the "now playing" line from that so the inning header reads as
  // forward motion ("Top of the 2nd · You're Up to Bat") instead of a
  // backward recap headline.
  const nextHalf: 'top' | 'bottom' = summary.half === 'top' ? 'bottom' : 'top';
  const nextInning = summary.half === 'top' ? summary.inning : summary.inning + 1;
  const nextHalfLabel = nextHalf === 'top' ? 'TOP' : 'BOTTOM';
  const ordinal = (() => {
    const n = nextInning;
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  })();
  const seatCue = userSide === 'Batting' ? "YOU'RE UP TO BAT" : "YOU'RE PITCHING NOW";
  const halfLabel = summary.half === 'top' ? 'Top' : 'Bottom';
  const wlNarrator =
    summary.userWins > summary.userLosses
      ? 'YOU TOOK THE INNING'
      : summary.userWins < summary.userLosses
        ? 'AI TOOK THE INNING'
        : 'EVEN INNING';
  const peakOutcomeCopy = summary.peakUserOutcome
    ? summary.peakUserOutcome === 'homerun'
      ? 'HOME RUN'
      : summary.peakUserOutcome === 'triple'
        ? 'TRIPLE'
        : summary.peakUserOutcome === 'double'
          ? 'DOUBLE'
          : summary.peakUserOutcome === 'single'
            ? 'SINGLE'
            : 'OUT'
    : 'NO HIT';
  const chainLabel = summary.longestUserChain >= 2 ? `${summary.longestUserChain}-chain` : 'No chain';
  return (
    <div className="fixed inset-0 z-[33] pointer-events-none flex items-center justify-center px-4">
      <motion.div
        key={`brawl-summary-${summary.inning}-${summary.half}-${summary.userWins}-${summary.userLosses}`}
        initial={{ opacity: 0, scale: 0.85, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="min-w-[320px] max-w-[440px] rounded-2xl border-2 border-amber-400/80 bg-slate-950/95 px-8 py-6 shadow-[0_8px_48px_rgba(0,0,0,0.6)] backdrop-blur-md"
      >
        {/* Side-switch header: the generic InningTransitionBanner is
            suppressed in brawl so this row carries the "Top of the 2nd ·
            YOU'RE UP TO BAT" line that the player needs to register the
            seat flip. Hidden on the final-game card because there's no
            next half to telegraph. */}
        {!summary.isGameEnd && (
          <div className="flex flex-col items-center mb-3">
            <span className="text-[9px] font-black uppercase tracking-[0.32em] text-amber-300/80">
              {nextHalfLabel} OF THE {ordinal}
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-200 mt-0.5">
              {seatCue}
            </span>
          </div>
        )}
        <p className="text-center text-[10px] font-black uppercase tracking-[0.28em] text-amber-400 mb-1">
          {summary.isGameEnd ? 'Final Inning Recap' : `${halfLabel} of ${summary.inning} -- Recap`}
        </p>
        <p className="text-center text-base font-black uppercase tracking-wider text-slate-100 mb-4">
          {wlNarrator}
        </p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-slate-900/80 border border-slate-700/50 px-2 py-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Record</p>
            <p className="text-lg font-black tabular-nums text-slate-100">
              {summary.userWins}<span className="text-slate-500">-</span>{summary.userLosses}
            </p>
          </div>
          <div className="rounded-lg bg-slate-900/80 border border-slate-700/50 px-2 py-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Best Chain</p>
            <p className="text-lg font-black tabular-nums text-amber-300">{chainLabel}</p>
          </div>
          <div className="rounded-lg bg-slate-900/80 border border-slate-700/50 px-2 py-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Peak Swing</p>
            <p className="text-[11px] font-black uppercase tracking-tight text-emerald-300 leading-tight pt-1">{peakOutcomeCopy}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

/**
 * Card-vs-card attack & floating-counter overlay that rides on top of the
 * existing reveal pipeline. Reads {@link RevealBeatAnimation} hints
 * attached to each beat by `buildRevealScript` and renders:
 *  - `attack`: a tinted "projectile" + impact flash from source to target,
 *    plus a red `-N` damage counter that arcs off the impact point.
 *  - `buff`: a soft glow ring + green/amber `+N` counter that rises off
 *    the source card.
 *  - `flash` (carryover): a small `-N`/`+N` counter near the affected
 *    side's score pill.
 *  - `snap` (reserved): no-op for now; edge-snap value effects already
 *    flow through `selfModifier` beats, so emitting a second snap beat
 *    would double-count.
 *
 * Card positions are looked up by `data-card-id` on the outermost
 * `CardItem` motion.div (and `data-score-pill` for side-anchored
 * targets), so the overlay never needs ref plumbing or layout effects --
 * it just measures the live DOM at fire time.
 *
 * Honors `prefers-reduced-motion`: counters still pop (instantly, no
 * arc) so the player always sees the damage attribution, but the lunge
 * tween + projectile streak are collapsed to a brief flash.
 *
 * Z-index sits at `z-[31]`, just above {@link RevealBeatSpotlight}'s
 * `z-[32]`-anchored caption card. The overlay is `pointer-events-none`
 * end-to-end so it never steals clicks from the hand strip.
 */
const ATTACK_FX_LIFETIME_MS = 900;
const ATTACK_FX_LUNGE_MS = 320;
const ATTACK_FX_COUNTER_MS = 760;

type AttackFxItem =
  | {
      id: number;
      kind: 'attack';
      sourceRect: DOMRect;
      targetRect: DOMRect;
      magnitude: number;
      reducedMotion: boolean;
    }
  | {
      id: number;
      kind: 'buff';
      sourceRect: DOMRect;
      magnitude: number;
      flavor: 'value' | 'hitScale';
      reducedMotion: boolean;
    }
  | {
      id: number;
      kind: 'flash';
      pillRect: DOMRect;
      magnitude: number;
      tone: 'debuff' | 'buff';
      reducedMotion: boolean;
    };

function rectForCardId(cardId: string): DOMRect | null {
  if (typeof document === 'undefined') return null;
  // Prefer the user's hand strip over face-down clones. Multiple elements
  // can share a card id (face-down preview + face-up CardItem on reveal),
  // so iterate and pick the first VISIBLE one (non-zero size).
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-card-id="${CSS.escape(cardId)}"]`,
  );
  for (const el of Array.from(candidates)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return null;
}

function rectForScorePill(side: 'Batting' | 'Pitching'): DOMRect | null {
  if (typeof document === 'undefined') return null;
  const tone = side === 'Batting' ? 'batter' : 'pitcher';
  const el = document.querySelector<HTMLElement>(`[data-score-pill="${tone}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

function resolveFxItem(
  id: number,
  animation: RevealBeatAnimation,
  reducedMotion: boolean,
): AttackFxItem | null {
  switch (animation.kind) {
    case 'attack': {
      const sourceRect = rectForCardId(animation.sourceCardId);
      if (!sourceRect) return null;
      const targetRect = animation.targetCardId
        ? rectForCardId(animation.targetCardId)
        : rectForScorePill(animation.targetSide);
      if (!targetRect) return null;
      return {
        id,
        kind: 'attack',
        sourceRect,
        targetRect,
        magnitude: animation.magnitude,
        reducedMotion,
      };
    }
    case 'buff': {
      const sourceRect = rectForCardId(animation.sourceCardId);
      if (!sourceRect) return null;
      return {
        id,
        kind: 'buff',
        sourceRect,
        magnitude: animation.magnitude,
        flavor: animation.flavor ?? 'value',
        reducedMotion,
      };
    }
    case 'flash': {
      const pillRect = rectForScorePill(animation.affectedSide);
      if (!pillRect) return null;
      return {
        id,
        kind: 'flash',
        pillRect,
        magnitude: animation.magnitude,
        tone: animation.tone,
        reducedMotion,
      };
    }
    case 'snap':
      // Snap effects already surface through selfModifier beats; emitting
      // a second visual would double-attribute the bonus. Reserved for a
      // future "chain seam pulse" pass that doesn't move the score.
      return null;
  }
}

const RevealAttackOverlay = ({
  active,
  currentAnimation,
}: {
  active: boolean;
  currentAnimation: { tick: number; animation: RevealBeatAnimation } | null;
}) => {
  const [items, setItems] = useState<AttackFxItem[]>([]);
  const reducedMotion = useReducedMotionPref();

  useEffect(() => {
    if (!active || !currentAnimation) return;
    const item = resolveFxItem(
      currentAnimation.tick,
      currentAnimation.animation,
      reducedMotion,
    );
    if (!item) return;
    setItems((prev) => [...prev, item]);
    const t = setTimeout(() => {
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
    }, ATTACK_FX_LIFETIME_MS);
    return () => clearTimeout(t);
    // tick changes every emission; we explicitly only want to fire on
    // currentAnimation transitions, not on `active` flipping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAnimation]);

  useEffect(() => {
    if (!active) setItems([]);
  }, [active]);

  if (!active || items.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[31] pointer-events-none overflow-hidden">
      <AnimatePresence>
        {items.map((item) => {
          switch (item.kind) {
            case 'attack':
              return <AttackBeat key={item.id} item={item} />;
            case 'buff':
              return <BuffBeat key={item.id} item={item} />;
            case 'flash':
              return <FlashBeat key={item.id} item={item} />;
          }
        })}
      </AnimatePresence>
    </div>
  );
};

function rectCenter(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const AttackBeat = ({ item }: { item: Extract<AttackFxItem, { kind: 'attack' }> }) => {
  const src = rectCenter(item.sourceRect);
  const tgt = rectCenter(item.targetRect);
  const magnitudeLabel = `${item.magnitude > 0 ? '+' : ''}${item.magnitude}`;
  const counterColor = item.magnitude < 0 ? 'text-rose-400' : 'text-emerald-300';
  const counterFontSize = Math.min(48, 22 + Math.abs(item.magnitude) * 1.5);

  return (
    <>
      {/* Projectile streak from source center -> target center. Tinted by
          attack direction (red lance for damage, emerald for rare positive
          aggregate effects). Skipped under reduced-motion -- the impact
          flash + counter still tells the story. */}
      {!item.reducedMotion && (
        <motion.div
          className="absolute"
          initial={{ x: src.x, y: src.y, opacity: 0, scale: 0.4 }}
          animate={{ x: tgt.x, y: tgt.y, opacity: [0, 1, 1, 0], scale: [0.4, 1, 1, 0.7] }}
          transition={{ duration: ATTACK_FX_LUNGE_MS / 1000, ease: [0.5, 0, 0.5, 1], times: [0, 0.2, 0.85, 1] }}
          style={{
            translateX: '-50%',
            translateY: '-50%',
            width: 28,
            height: 28,
            borderRadius: 9999,
            background:
              item.magnitude < 0
                ? 'radial-gradient(circle, rgba(239,68,68,0.95) 0%, rgba(190,18,60,0.55) 60%, rgba(190,18,60,0) 100%)'
                : 'radial-gradient(circle, rgba(52,211,153,0.95) 0%, rgba(5,150,105,0.55) 60%, rgba(5,150,105,0) 100%)',
            filter: 'blur(2px)',
            boxShadow:
              item.magnitude < 0
                ? '0 0 24px rgba(244,63,94,0.6)'
                : '0 0 24px rgba(16,185,129,0.6)',
          }}
        />
      )}
      {/* Impact flash centered on the target card. Brief pulse with a
          ring so the target reads as "just got hit". */}
      <motion.div
        className="absolute rounded-2xl"
        initial={{ x: tgt.x, y: tgt.y, opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0.85, 0], scale: [0.7, 1.25, 1.45] }}
        transition={{
          duration: 0.45,
          delay: item.reducedMotion ? 0 : ATTACK_FX_LUNGE_MS / 1000,
          ease: 'easeOut',
        }}
        style={{
          translateX: '-50%',
          translateY: '-50%',
          width: Math.max(item.targetRect.width, 96),
          height: Math.max(item.targetRect.height, 96),
          border:
            item.magnitude < 0
              ? '3px solid rgba(244,63,94,0.85)'
              : '3px solid rgba(16,185,129,0.85)',
          boxShadow:
            item.magnitude < 0
              ? '0 0 28px rgba(244,63,94,0.55)'
              : '0 0 28px rgba(16,185,129,0.55)',
        }}
      />
      {/* Floating damage counter. Arc upward off the impact point. Under
          reduced motion it just fades in place. */}
      <motion.div
        className={`absolute font-black ${counterColor} drop-shadow-lg select-none`}
        initial={{
          x: tgt.x,
          y: tgt.y,
          opacity: 0,
          scale: 0.6,
        }}
        animate={
          item.reducedMotion
            ? { opacity: [0, 1, 1, 0], scale: [0.6, 1, 1, 1] }
            : { y: tgt.y - 60, opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 0.95] }
        }
        transition={{
          duration: ATTACK_FX_COUNTER_MS / 1000,
          delay: item.reducedMotion ? 0 : ATTACK_FX_LUNGE_MS / 1000,
          ease: 'easeOut',
          times: [0, 0.15, 0.7, 1],
        }}
        style={{
          translateX: '-50%',
          translateY: '-50%',
          fontSize: counterFontSize,
          textShadow: '0 2px 8px rgba(0,0,0,0.7)',
          letterSpacing: '-0.02em',
        }}
      >
        {magnitudeLabel}
      </motion.div>
    </>
  );
};

const BuffBeat = ({ item }: { item: Extract<AttackFxItem, { kind: 'buff' }> }) => {
  const src = rectCenter(item.sourceRect);
  const magnitudeLabel = `${item.magnitude > 0 ? '+' : ''}${item.magnitude}`;
  // Hit-scale boosts read as amber to match the ScorePill's hit-scale chip;
  // regular value buffs stay green. Negative buffs (self-debuffs) tinted red.
  const counterColor =
    item.magnitude < 0
      ? 'text-rose-400'
      : item.flavor === 'hitScale'
        ? 'text-amber-300'
        : 'text-emerald-300';
  const glowColor =
    item.magnitude < 0
      ? 'rgba(244,63,94,0.55)'
      : item.flavor === 'hitScale'
        ? 'rgba(251,191,36,0.6)'
        : 'rgba(52,211,153,0.6)';
  const counterFontSize = Math.min(46, 22 + Math.abs(item.magnitude) * 1.5);

  return (
    <>
      {/* Soft pulse ring on the source card. */}
      <motion.div
        className="absolute rounded-2xl"
        initial={{ x: src.x, y: src.y, opacity: 0, scale: 0.85 }}
        animate={{ opacity: [0, 0.75, 0], scale: [0.85, 1.2, 1.35] }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{
          translateX: '-50%',
          translateY: '-50%',
          width: Math.max(item.sourceRect.width, 96),
          height: Math.max(item.sourceRect.height, 96),
          border: `2px solid ${glowColor}`,
          boxShadow: `0 0 24px ${glowColor}`,
        }}
      />
      {/* Floating buff counter. */}
      <motion.div
        className={`absolute font-black ${counterColor} drop-shadow-lg select-none`}
        initial={{ x: src.x, y: src.y, opacity: 0, scale: 0.6 }}
        animate={
          item.reducedMotion
            ? { opacity: [0, 1, 1, 0], scale: [0.6, 1, 1, 1] }
            : { y: src.y - 70, opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 0.95] }
        }
        transition={{
          duration: ATTACK_FX_COUNTER_MS / 1000,
          ease: 'easeOut',
          times: [0, 0.15, 0.7, 1],
        }}
        style={{
          translateX: '-50%',
          translateY: '-50%',
          fontSize: counterFontSize,
          textShadow: '0 2px 8px rgba(0,0,0,0.7)',
          letterSpacing: '-0.02em',
        }}
      >
        {magnitudeLabel}
      </motion.div>
    </>
  );
};

const FlashBeat = ({ item }: { item: Extract<AttackFxItem, { kind: 'flash' }> }) => {
  const center = rectCenter(item.pillRect);
  const magnitudeLabel = `${item.magnitude > 0 ? '+' : ''}${item.magnitude}`;
  const counterColor = item.tone === 'debuff' ? 'text-rose-400' : 'text-emerald-300';
  const counterFontSize = Math.min(38, 20 + Math.abs(item.magnitude) * 1.5);

  return (
    <motion.div
      className={`absolute font-black ${counterColor} drop-shadow-lg select-none`}
      initial={{ x: center.x, y: center.y, opacity: 0, scale: 0.6 }}
      animate={
        item.reducedMotion
          ? { opacity: [0, 1, 1, 0], scale: [0.6, 1, 1, 1] }
          : { y: center.y - 50, opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 0.95] }
      }
      transition={{
        duration: ATTACK_FX_COUNTER_MS / 1000,
        ease: 'easeOut',
        times: [0, 0.15, 0.7, 1],
      }}
      style={{
        translateX: '-50%',
        translateY: '-50%',
        fontSize: counterFontSize,
        textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        letterSpacing: '-0.02em',
      }}
    >
      {magnitudeLabel}
    </motion.div>
  );
};

/**
 * Lightweight `prefers-reduced-motion` watcher. The reveal layer uses this
 * to collapse lunge / arc tweens into in-place pops while still firing
 * counters so screen-reader-equivalent users see the magnitude.
 */
function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari < 14 only supports addListener; modern Chromium/Firefox use
    // addEventListener. Try both for max compatibility.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    // Legacy fallback for old Safari builds.
    mq.addListener(handler);
    return () => {
      mq.removeListener(handler);
    };
  }, []);
  return reduced;
}

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

// Bumped from 0.18 to 0.55 so the signature cards wait for the left-rail
// PlayerHero entry tween to finish (~0.48s for the batter row including
// its 0.08s role stagger) before the first hand card flies in. The user-
// facing sequence is then: pitcher hero -> batter hero -> signature cards
// -> general-draw cards.
const SIGNATURE_DELAY_CHILDREN = 0.55;
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

/** Milliseconds until the last card in a strip finishes its deal-in spring. */
function computeHandDealCompleteMs(hand: CardDefinition[]): number {
  if (hand.length === 0) return 0;
  const signatureCount = hand.filter((c) => c.abilityType !== 'General Draw').length;
  const lastSigIdx = Math.max(signatureCount - 1, 0);
  const signaturesEndAt = SIGNATURE_DELAY_CHILDREN + lastSigIdx * SIGNATURE_STAGGER;
  const signaturesSettled = signaturesEndAt + SIGNATURE_SETTLE_PAD;

  let maxDelaySec = 0;
  for (let mountIndex = 0; mountIndex < hand.length; mountIndex++) {
    const isGeneral = hand[mountIndex].abilityType === 'General Draw';
    const delay = isGeneral
      ? signaturesSettled +
        Math.max(mountIndex - signatureCount, 0) * GENERAL_STAGGER
      : SIGNATURE_DELAY_CHILDREN + mountIndex * SIGNATURE_STAGGER;
    maxDelaySec = Math.max(maxDelaySec, delay);
  }
  // Buffer for the spring to settle after the last card's delayed start.
  return Math.ceil(maxDelaySec * 1000 + 650);
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
  /** When set, only affirmed adjacent pairs render as connected. */
  affirmedSeams?: ReadonlySet<string>;
}

/** Move one card one slot closer to its target index in `plan`. */
function stepHandTowardPlan(
  display: CardDefinition[],
  plan: CardDefinition[],
): { hand: CardDefinition[]; movedId: string | null } {
  for (let i = 0; i < plan.length; i++) {
    if (display[i]?.id === plan[i]?.id) continue;
    const targetId = plan[i].id;
    const currentIdx = display.findIndex((c) => c.id === targetId);
    if (currentIdx === -1) return { hand: display, movedId: null };
    const next = [...display];
    if (currentIdx > i) {
      [next[currentIdx - 1], next[currentIdx]] = [next[currentIdx], next[currentIdx - 1]];
    } else {
      [next[currentIdx], next[currentIdx + 1]] = [next[currentIdx + 1], next[currentIdx]];
    }
    return { hand: next, movedId: targetId };
  }
  return { hand: display, movedId: null };
}

function nextOpponentSeamToAffirm(
  hand: CardDefinition[],
  displaySeams: ReadonlySet<string>,
  planSeams: ReadonlySet<string>,
): string | null {
  for (let i = 1; i < hand.length; i++) {
    const key = seamKey(hand[i - 1].id, hand[i].id);
    if (
      planSeams.has(key) &&
      !displaySeams.has(key) &&
      canConnectAny(hand[i - 1], hand[i])
    ) {
      return key;
    }
  }
  return null;
}

interface BrawlOpponentArrangeStripProps {
  dealtHand: CardDefinition[];
  planHand: CardDefinition[];
  planSeams: ReadonlySet<string>;
  modifiers: Record<string, { value: number; color?: string }>;
  atBatId: number;
  compact?: boolean;
}

/**
 * Brawl snap phase: opponent cards deal in loose, then shuffle and forge
 * seams face-down toward the AI plan — mirroring the user's snap UX.
 */
const BrawlOpponentArrangeStrip = ({
  dealtHand,
  planHand,
  planSeams,
  modifiers,
  atBatId,
  compact = true,
}: BrawlOpponentArrangeStripProps) => {
  const [displayHand, setDisplayHand] = useState(dealtHand);
  const [displaySeams, setDisplaySeams] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [arrangingId, setArrangingId] = useState<string | null>(null);
  const [dealComplete, setDealComplete] = useState(false);
  const displayHandRef = useRef(displayHand);
  const displaySeamsRef = useRef(displaySeams);
  displayHandRef.current = displayHand;
  displaySeamsRef.current = displaySeams;

  useEffect(() => {
    setDisplayHand(dealtHand);
    setDisplaySeams(new Set());
    setArrangingId(null);
    setDealComplete(false);
  }, [atBatId, dealtHand]);

  // Wait for the staggered deal-in (signature fly + general draws) to finish
  // before the opponent starts shuffling cards into their target layout.
  useEffect(() => {
    const ms = computeHandDealCompleteMs(dealtHand);
    const t = window.setTimeout(() => setDealComplete(true), ms);
    return () => window.clearTimeout(t);
  }, [atBatId, dealtHand]);

  useEffect(() => {
    if (!arrangingId) return;
    const t = window.setTimeout(() => setArrangingId(null), 320);
    return () => window.clearTimeout(t);
  }, [arrangingId]);

  useEffect(() => {
    if (!dealComplete) return;
    const effectivePlan = planHand.length > 0 ? planHand : dealtHand;
    const tick = () => {
      const current = displayHandRef.current;
      const orderMatch =
        current.length === effectivePlan.length &&
        current.every((c, i) => c.id === effectivePlan[i]?.id);

      if (!orderMatch) {
        const { hand: next, movedId } = stepHandTowardPlan(current, effectivePlan);
        if (movedId) setArrangingId(movedId);
        setDisplayHand(next);
        return;
      }

      const seamKeyToAdd = nextOpponentSeamToAffirm(
        current,
        displaySeamsRef.current,
        planSeams,
      );
      if (seamKeyToAdd) {
        for (let i = 1; i < current.length; i++) {
          if (seamKey(current[i - 1].id, current[i].id) === seamKeyToAdd) {
            setArrangingId(current[i].id);
            break;
          }
        }
        setDisplaySeams((prev) => {
          const next = new Set(prev);
          next.add(seamKeyToAdd);
          return next;
        });
      }
    };

    tick();
    const id = window.setInterval(tick, BRAWL_OPPONENT_ARRANGE_STEP_MS);
    return () => window.clearInterval(id);
  }, [dealComplete, atBatId, dealtHand, planHand, planSeams]);

  const sz = compact
    ? { card: 'w-20 h-28 rounded-lg', gap: 4, connectedGap: 0 }
    : { card: 'w-32 h-44 rounded-xl', gap: 8, connectedGap: 0 };
  const fromY = -180;
  const fromRot = -12;
  const signatureCount = displayHand.filter((c) => c.abilityType !== 'General Draw').length;

  return (
    <motion.div
      className="flex flex-row items-center justify-center"
      style={{ perspective: '1200px' }}
    >
      <AnimatePresence>
        {displayHand.map((card, index) => {
          const seamLeftAffirmed =
            index > 0 &&
            displaySeams.has(seamKey(displayHand[index - 1].id, card.id));
          const seamRightAffirmed =
            index < displayHand.length - 1 &&
            displaySeams.has(seamKey(card.id, displayHand[index + 1].id));
          const isConnectedLeft =
            index > 0 &&
            canConnectAny(displayHand[index - 1], card) &&
            seamLeftAffirmed;
          const isConnectedRight =
            index < displayHand.length - 1 &&
            canConnectAny(card, displayHand[index + 1]) &&
            seamRightAffirmed;
          const modifier = modifiers[card.id];
          const isGeneral = card.abilityType === 'General Draw';
          return (
            <PitcherCard
              key={`${atBatId}-${card.id}`}
              card={card}
              index={index}
              handLength={displayHand.length}
              signatureCount={signatureCount}
              isGeneral={isGeneral}
              isConnectedLeft={isConnectedLeft}
              isConnectedRight={isConnectedRight}
              modifier={modifier}
              revealed={false}
              compact={compact}
              sz={sz}
              fromY={fromY}
              fromRot={fromRot}
              isArranging={arrangingId === card.id}
            />
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
};

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
  affirmedSeams,
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
          const seamLeftAffirmed =
            index > 0 &&
            (affirmedSeams === undefined ||
              affirmedSeams.has(seamKey(hand[index - 1].id, card.id)));
          const seamRightAffirmed =
            index < hand.length - 1 &&
            (affirmedSeams === undefined ||
              affirmedSeams.has(seamKey(card.id, hand[index + 1].id)));
          const isConnectedLeft =
            index > 0 && canConnectAny(hand[index - 1], card) && seamLeftAffirmed;
          const isConnectedRight =
            index < hand.length - 1 &&
            canConnectAny(card, hand[index + 1]) &&
            seamRightAffirmed;
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
  /** Brawl snap phase: lift the card being shuffled into place. */
  isArranging?: boolean;
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
  isArranging = false,
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
      animate={{
        ...entry.animate,
        scale: isArranging ? 1.07 : 1,
        y: isArranging ? -10 : 0,
        zIndex: isArranging ? 20 : 0,
      }}
      exit={exitConfig}
      transition={ITEM_LAYOUT_TRANSITION}
      // Brawl Mode reveal anchor -- the flying ghost launches from this
      // card's bounding rect. See `useBrawlAttackReveal` for the lookup.
      data-brawl-card-id={card.id}
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
  /**
   * When true: no reorder drag (reveal / result / game-over), but cards stay
   * pointer-interactive so ability hover tooltips still work.
   */
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
  /**
   * Card id under the gamepad focus ring (amber). When set, that card
   * renders a controller-focus highlight on top of its normal styling.
   * Distinct from `gamepadGrabbedCardId` so we can show "focused but not
   * grabbed" vs "actively held" with different tints. Mouse-only users
   * never see this because the controller never assigns a focus.
   */
  gamepadFocusedCardId?: string | null;
  /**
   * Card id currently "grabbed" via the gamepad SQUARE button (violet).
   * Mirrors the move-mode lockdown the footer uses: while one card is
   * grabbed, DPAD LEFT/RIGHT shifts that card and re-fires
   * `onAffirmConnections` so chains snap exactly like a mouse drag.
   */
  gamepadGrabbedCardId?: string | null;
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
  gamepadFocusedCardId = null,
  gamepadGrabbedCardId = null,
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

  // Treat the controller "grabbed" card as a synthetic drag for hint /
  // dragActive / dragging-id purposes. Mouse drag and gamepad grab are
  // the same gesture semantically (pick up -> shift -> drop), so the
  // strip's visual feedback (connect-allow/block chips on the touching
  // seams, dragActive silencing celebration animations, the lift in
  // HandCard) should fire from both. We never have both at once -- mouse
  // drag and controller grab require different input devices to start --
  // so `??` is safe.
  const effectiveDraggingId = draggingId ?? gamepadGrabbedCardId ?? null;

  // Pre-compute hint state for each card index when a drag (mouse or
  // gamepad grab) is in progress. Each entry is `{ left, right }`
  // ConnectHints for the card at that index.
  const hints: Array<{ left?: ConnectHint; right?: ConnectHint }> = useMemo(() => {
    if (!effectiveDraggingId) return hand.map(() => ({}));
    const dragIdx = hand.findIndex((c) => c.id === effectiveDraggingId);
    if (dragIdx === -1) return hand.map(() => ({}));

    const out = hand.map(() => ({} as { left?: ConnectHint; right?: ConnectHint }));

    // Left seam of the dragged card (between dragIdx-1 and dragIdx).
    if (dragIdx > 0) {
      const ok = canConnectAny(hand[dragIdx - 1], hand[dragIdx]);
      const tag: ConnectHint = ok ? 'allow' : 'block';
      out[dragIdx - 1].right = tag;
      out[dragIdx].left = tag;
    }
    // Right seam of the dragged card (between dragIdx and dragIdx+1).
    if (dragIdx < hand.length - 1) {
      const ok = canConnectAny(hand[dragIdx], hand[dragIdx + 1]);
      const tag: ConnectHint = ok ? 'allow' : 'block';
      out[dragIdx].right = tag;
      out[dragIdx + 1].left = tag;
    }
    return out;
  }, [effectiveDraggingId, hand]);

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
    >
      {/*
        Intentionally NO <AnimatePresence> here. In legacy / quick-match
        lanes the hand is set once by `dealHand` and never mutated until
        the at-bat resolves, so there's nothing for AnimatePresence to
        track. In SZN the player CAN deal/recall items mid-at-bat via
        the persistent footer — those operations route through the
        store's `reconcileSznHandState()` which rebuilds the hand atomically;
        the reorder list re-renders fresh on the new `hand` reference,
        which is enough animation continuity for the deck-style swap UX
        (wrapping with AnimatePresence + Reorder.Item `layout` together
        plays badly with Framer's reorder swap math).
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
            index > 0 && canConnectAny(hand[index - 1], card) && seamLeftAffirmed;
          const isConnectedRight =
            index < hand.length - 1 &&
            canConnectAny(card, hand[index + 1]) &&
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
              dragActive={effectiveDraggingId !== null}
              lockReorder={disabled}
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
              gamepadFocused={gamepadFocusedCardId === card.id}
              gamepadGrabbed={gamepadGrabbedCardId === card.id}
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
  /**
   * Hand strip is read-only (reveal / result / game-over): disable reorder
   * drag but keep hover so ability tooltips still work.
   */
  lockReorder?: boolean;
  /**
   * Controller focus highlight (amber ring). Rendered on top of the
   * card so it's visible regardless of the underlying card art. Decoupled
   * from `gamepadGrabbed` so we can show "focused but not grabbed" (the
   * D-Pad cursor sits on this card) vs "grabbed" (SQUARE has picked it up
   * for shifting) as separate tints.
   */
  gamepadFocused?: boolean;
  /** Controller grab highlight (violet ring + pulse), see above. */
  gamepadGrabbed?: boolean;
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
  lockReorder = false,
  gamepadFocused = false,
  gamepadGrabbed = false,
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
      drag={lockReorder ? false : true}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      // Brawl Mode reveal needs a stable selector to grab each card's
      // screen-space rect so the flying-card ghost can launch from the
      // right coordinate. The attribute is otherwise inert.
      data-brawl-card-id={card.id}
    >
      {/* Gamepad-grab lift wrapper. Mirrors the visual rise the user
          gets from Framer's pointer-drag (Reorder.Item only lifts on a
          real pointer drag, so for controller grab we synthesize the
          same affordance here: a small y-translate + scale-up under a
          gentle spring). Wrapping the CardItem instead of animating the
          Reorder.Item itself keeps the layout / entry animations on the
          parent untouched, and we tag the wrapper with z-50 so the
          lifted card visually crosses over its neighbors the same way
          the dragged card does. */}
      <motion.div
        animate={
          gamepadGrabbed
            ? { y: -14, scale: 1.06 }
            : { y: 0, scale: 1 }
        }
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        className={`relative ${gamepadGrabbed ? 'z-50' : ''}`}
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
          readOnly={lockReorder}
        />
        {hasPendingChoice && onTriggerChoice && (
          <UseAbilityPill
            active={isChoiceActive}
            onClick={onTriggerChoice}
          />
        )}
        {(gamepadFocused || gamepadGrabbed) && (
          <GamepadFocusRing grabbed={gamepadGrabbed} />
        )}
      </motion.div>
    </Reorder.Item>
  );
};

/**
 * Lock In / Next At-Bat / Continue Run / New Game pill. Wraps a plain
 * <button> with a tone-aware base style + an OPTIONAL controller focus
 * affordance (`focused`). When `focused` is true the button gets a
 * bright amber ring + animated halo + scale-up so a controller user
 * can see at a glance which CTA CROSS will fire. When `focused` is
 * false the button renders exactly like the original inline JSX did,
 * so mouse-only players see no behavioural change.
 */
type CtaTone = 'blue' | 'emerald' | 'rose';
type CtaSize = 'md' | 'lg';

const CTA_TONE_BASE: Record<CtaTone, string> = {
  blue: 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/50',
  emerald: 'bg-emerald-600 hover:bg-emerald-500',
  rose: 'bg-rose-600 hover:bg-rose-500',
};

const CTA_SIZE_BASE: Record<CtaSize, string> = {
  md: 'px-10 py-2.5 text-sm',
  lg: 'px-12 py-3 text-lg',
};

function CtaButton({
  onClick,
  focused,
  tone,
  size,
  children,
  ...rest
}: {
  onClick: () => void;
  focused: boolean;
  tone: CtaTone;
  size: CtaSize;
  children: React.ReactNode;
  'data-tutorial'?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      animate={
        focused
          ? {
              scale: [1.04, 1.08, 1.04],
              transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
            }
          : { scale: 1, transition: { duration: 0.2 } }
      }
      whileHover={{ scale: focused ? 1.1 : 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`${CTA_SIZE_BASE[size]} ${CTA_TONE_BASE[tone]} text-white font-bold rounded-full shadow-lg uppercase tracking-wider relative ${
        focused
          ? 'ring-4 ring-amber-300 ring-offset-2 ring-offset-transparent shadow-[0_0_28px_8px_rgba(252,211,77,0.7)]'
          : ''
      }`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/**
 * Controller focus / grab indicator. Renders as a pointer-events-none
 * overlay so it never steals clicks from the underlying CardItem (the
 * card must stay mouse-draggable and hover-tooltip-able). Two visual
 * states:
 *  - focused (grabbed=false): amber 4-pixel ring + bright glow with a
 *    subtle constant pulse so the D-Pad cursor is impossible to miss
 *    against the busy at-bat surface (the previous 2-pixel ring was
 *    drowning behind player card art / shape chips during playtest).
 *  - grabbed (grabbed=true): violet ring + stronger pulsing glow, the
 *    "SQUARE picked this up, DPAD LEFT/RIGHT shifts it" affordance.
 *    Mirrors the footer's grab visual so the controller language stays
 *    uniform across surfaces.
 *
 * We render the ring slightly OUTSIDE the card (-inset-1.5 + scale up)
 * so the bright border doesn't crop the underlying card art — important
 * because the previous inset:0 ring was sitting on top of the value
 * pill and shape-connector chips, which optically dimmed it.
 */
function GamepadFocusRing({ grabbed }: { grabbed: boolean }) {
  return (
    <motion.div
      key={grabbed ? 'grabbed' : 'focused'}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={
        grabbed
          ? {
              opacity: [0.9, 1, 0.9],
              scale: [1.04, 1.08, 1.04],
              transition: {
                duration: 0.8,
                repeat: Infinity,
                ease: 'easeInOut',
              },
            }
          : {
              opacity: [0.85, 1, 0.85],
              scale: [1.02, 1.04, 1.02],
              transition: {
                duration: 1.4,
                repeat: Infinity,
                ease: 'easeInOut',
              },
            }
      }
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.15 }}
      className={`pointer-events-none absolute -inset-1.5 z-40 rounded-2xl border-4 ${
        grabbed
          ? 'border-violet-300 shadow-[0_0_32px_8px_rgba(167,139,250,0.85),inset_0_0_18px_rgba(167,139,250,0.55)]'
          : 'border-amber-300 shadow-[0_0_28px_8px_rgba(252,211,77,0.85),inset_0_0_14px_rgba(252,211,77,0.45)]'
      }`}
      aria-hidden
    />
  );
}

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

function formatRevealBeatCaption(
  beat: ResolutionBeat,
  lookup: Map<string, CardDefinition>,
): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  switch (beat.kind) {
    case 'selfModifier': {
      const c = lookup.get(beat.cardId);
      const name = c?.name ?? beat.cardId;
      const d = beat.finalValue - beat.baseValue;
      return `${name} ${beat.baseValue}→${beat.finalValue} (${sign(d)})`;
    }
    case 'targetedDebuff': {
      const s = lookup.get(beat.sourceCardId);
      const t = lookup.get(beat.targetCardId);
      return `${s?.name ?? '?'} → ${t?.name ?? '?'} (${sign(beat.delta)})`;
    }
    case 'aggregateDebuff':
      return `${beat.label} (${sign(beat.delta)})`;
    case 'guessPitchHit':
      return `Guess Pitch (${sign(beat.delta)})`;
    case 'crossDebuff':
      return `${beat.label} (${sign(beat.delta)})`;
  }
}

function spotlightForBeat(
  beat: ResolutionBeat,
  lookup: Map<string, CardDefinition>,
): RevealSpotlight | null {
  const caption = formatRevealBeatCaption(beat, lookup);
  switch (beat.kind) {
    case 'crossDebuff':
      return { kind: 'text', caption };
    case 'selfModifier': {
      const card = lookup.get(beat.cardId);
      if (!card) return { kind: 'text', caption };
      return { kind: 'card', card, tone: 'source', caption };
    }
    case 'targetedDebuff': {
      const card = lookup.get(beat.sourceCardId);
      if (!card) return { kind: 'text', caption };
      return { kind: 'card', card, tone: 'source', caption };
    }
    case 'aggregateDebuff': {
      const card = lookup.get(beat.sourceCardId);
      if (!card) return { kind: 'text', caption };
      return { kind: 'card', card, tone: 'source', caption };
    }
    case 'guessPitchHit': {
      const card = lookup.get(beat.sourceCardId);
      if (!card) return { kind: 'text', caption };
      return { kind: 'card', card, tone: 'source', caption };
    }
  }
}

function revealBeatDurationMs(beat: ResolutionBeat): number {
  const dB = scoreDeltaForSide(beat, 'Batting');
  const dP = scoreDeltaForSide(beat, 'Pitching');
  return dB !== 0 || dP !== 0 ? Math.round(REVEAL_BEAT_MS * 1.32) : REVEAL_BEAT_MS;
}

interface RevealOrchestratorInput {
  phase: string;
  script: ResolutionBeat[];
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  finalBatterScore: number;
  finalPitcherScore: number;
  onComplete: () => void;
  /**
   * Brawl Mode owns its own reveal timeline (cards fly at HP pills via
   * `useBrawlAttackReveal`). When `disabled` is true the standard
   * orchestrator goes inert: no script-walking, no per-beat highlights,
   * no spotlight banners, and -- critically -- no auto `onComplete()`
   * fire (the brawl reveal calls completeReveal itself when its attack
   * sequence wraps). The displayed scores still snap to the final
   * totals so any pill that DOES read off this output (e.g. an opaque
   * "between-at-bats" landing surface) shows the right numbers.
   */
  disabled?: boolean;
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
  revealSpotlight: RevealSpotlight | null;
  /**
   * Most-recent reveal beat's animation hint. `tick` increments on every
   * emission so the attack overlay can re-mount a fresh element even when
   * two consecutive beats reuse the same `animation` shape (e.g. two
   * targetedDebuff beats from the same source). Null while not revealing.
   */
  currentAnimation: { tick: number; animation: RevealBeatAnimation } | null;
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
  disabled = false,
}: RevealOrchestratorInput): RevealOrchestratorOutput {
  const [displayedBatter, setDisplayedBatter] = useState(finalBatterScore);
  const [displayedPitcher, setDisplayedPitcher] = useState(finalPitcherScore);
  const [batterOverrides, setBatterOverrides] = useState<Record<string, number>>({});
  const [pitcherOverrides, setPitcherOverrides] = useState<Record<string, number>>({});
  const [batterHighlights, setBatterHighlights] = useState<Record<string, 'source' | 'target'>>({});
  const [pitcherHighlights, setPitcherHighlights] = useState<Record<string, 'source' | 'target'>>({});
  const [batterBanner, setBatterBanner] = useState<ScoreBanner | null>(null);
  const [pitcherBanner, setPitcherBanner] = useState<ScoreBanner | null>(null);
  const [revealSpotlight, setRevealSpotlight] = useState<RevealSpotlight | null>(null);
  const [currentAnimation, setCurrentAnimation] = useState<{
    tick: number;
    animation: RevealBeatAnimation;
  } | null>(null);
  const animationTickRef = useRef(0);

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
    if (phase !== 'revealing' || disabled) {
      // Reset visual state so the next reveal starts clean.
      setBatterOverrides({});
      setPitcherOverrides({});
      setBatterHighlights({});
      setPitcherHighlights({});
      setBatterBanner(null);
      setPitcherBanner(null);
      setRevealSpotlight(null);
      setCurrentAnimation(null);
      // Snap displayed scores to current finals (even outside revealing the
      // pills should track the source of truth).
      setDisplayedBatter(finalRef.current.b);
      setDisplayedPitcher(finalRef.current.p);
      // When `disabled` is true (brawl mode), the brawl reveal hook is
      // the sole driver -- it owns the pill values during its sequence
      // and calls `completeReveal()` when done. We intentionally do NOT
      // fire onComplete here; doing so would race the brawl timeline
      // and immediately advance the phase before the cards have flown.
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
    setRevealSpotlight(null);

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
        const beatMs = revealBeatDurationMs(beat);
        const startAt = cursor;
        const endAt = cursor + beatMs;
        const nextTotals = applyBeatToRunning(beat, runningBatter, runningPitcher);

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
          setRevealSpotlight(spotlightForBeat(beat, cardLookup));
          if (beat.animation) {
            animationTickRef.current += 1;
            setCurrentAnimation({
              tick: animationTickRef.current,
              animation: beat.animation,
            });
          }
        });

        runningBatter = nextTotals.batter;
        runningPitcher = nextTotals.pitcher;

        schedule(endAt, () => {
          // Clear highlights + banner at the end of each beat window so the
          // next beat starts visually fresh. Value overrides PERSIST so the
          // affected card keeps its new number for the rest of the sequence.
          setBatterHighlights({});
          setPitcherHighlights({});
          setBatterBanner(null);
          setPitcherBanner(null);
          setRevealSpotlight(null);
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
    // `disabled` is included because brawl mode toggles the orchestrator on
    // and off based on which lane is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, script, disabled]);

  return {
    displayedBatter,
    displayedPitcher,
    batterValueOverrides: batterOverrides,
    pitcherValueOverrides: pitcherOverrides,
    batterHighlights,
    pitcherHighlights,
    batterBanner,
    pitcherBanner,
    revealSpotlight,
    currentAnimation,
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
