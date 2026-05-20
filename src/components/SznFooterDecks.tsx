/**
 * SznFooterDecks — the persistent two-row card surface at the bottom of
 * every SZN screen. Pure inventory rail: left row = roster players,
 * right row = item bag. ALL chain-building happens in the in-combat
 * `HandStrip`; this row's only job is to move cards FROM the run state
 * INTO the live combat hand (or swap the seat to a different roster
 * player).
 *
 * Why this file used to be a chain UI and is not anymore
 * ------------------------------------------------------
 * The previous baseline ran a parallel "play area" above the footer
 * with its own grab/attach/separate gamepad gymnastics. That pile
 * duplicated the chain the `HandStrip` already renders -- so when the
 * user dealt an ability the card appeared in TWO places (the footer
 * play area AND the actual hand strip), and mouse users had no way to
 * deal cards at all because the entire flow was gamepad-only.
 *
 * This pass collapses the footer to a one-tap inventory rail:
 *   - Right row click → `sznDealItem(instanceId)` (combat only)
 *   - Left row click  → `sznSwapPlayer(playerId)` when the seat role
 *                       matches; visual no-op otherwise
 *   - Gamepad CROSS does the same as the click for the focused card
 *   - All `decks` state is DERIVED from `(roster, itemBag, hand)` --
 *     no local optimistic mutation, no drift between footer and combat
 *
 * Gamepad focus router
 * --------------------
 * `gameStore.sznGamepadFocus` is still the single source of truth for
 * `'screen'` vs `'footer'` ownership. Priority 50 router:
 *   - `'screen'` mode: only DPAD_DOWN (grab focus) and TRIANGLE
 *     (toggle collapse) are consumed; everything else falls through.
 *   - `'footer'` mode: DPAD nav + L1/R1 side-switch + CROSS act +
 *     TRIANGLE collapse + CIRCLE release-focus. SQUARE is currently
 *     a no-op (no grab/move semantics left to bind).
 *
 * Footer-height reporting
 * -----------------------
 * `setSznFooterHeight` still publishes 240px while expanded / 0 while
 * collapsed so `CardGameOverlay` can lift its hand strip and the
 * `FrontOfficeScreen` can pad its scroll bottom to clear the rail.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useGameStore,
  isInSznCombat,
  isInSznFrontOffice,
  getUserSide,
} from '../lib/gameStore';
import { useSznGamepad, type GamepadButton } from '../lib/useSznGamepad';
import { RARITY_BASE_VALUE, type Item, type RosterPlayer } from '../lib/run';
import { SESSION_CARDS } from '../lib/cards';
import type { CardDefinition } from '../lib/cards';
import { isSznPlayer } from '../lib/sznPlayers';
import { teamLogoEdge } from '../lib/sznTeams';
import { SZN_EDGES, type SznEdgeId } from '../lib/sznEdges';
import { SznEdgeHalf } from './SznEdgeHalf';
import { MLB_TEAMS } from '../lib/sznTeams';
import { teamPalette } from '../lib/teamColors';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

type CardType = 'batter' | 'pitcher' | 'ability';

interface FooterCardData {
  /**
   * Unique row key. For player cards this is the player id (used by
   * `sznSwapPlayer`); for ability cards it is the item INSTANCE id
   * (used by `sznDealItem` so two copies of the same encounter card
   * don't collide on the bag filter).
   */
  id: string;
  value: number | string;
  type: CardType;
  /**
   * Full display name shown on the card itself AND echoed in the
   * focused-card overlay above the footer. Previously this was an
   * abbreviated last-name / first-word so the 96x136 chip could
   * single-line render; the card-label render now wraps to two
   * lines so the full name fits without truncating.
   */
  label?: string;
  /**
   * One-line context that pairs with the name in the focused-card
   * overlay -- e.g., "Yankees · OF · Common" for a roster player or
   * "Encounter Item" for a card-bag entry. Optional because not every
   * card has a meaningful subtitle (legacy fallback rosters get
   * `undefined` and the overlay just renders the name).
   */
  subtitle?: string;
  /**
   * Long-form description shown below the subtitle in the overlay.
   * Items use `CardDefinition.description` (the ability text); players
   * fall back to `SznPlayer.flavor` when present, otherwise a
   * synthesized "left-edge -> right-edge" line so the overlay isn't
   * empty for a flavorless legacy player.
   */
  description?: string;
  /**
   * Click semantics: `'deal'` calls `sznDealItem`, `'swap'` calls
   * `sznSwapPlayer`, `'inert'` is non-actionable (mismatched role, the
   * seated player, or outside combat). Drives what `activateCard`
   * does -- the visual treatment is owned by `state` (below) so an
   * inert card outside combat reads as "inventory" while an inert
   * card inside combat reads as "disabled / can't deal that here".
   */
  action: 'deal' | 'swap' | 'inert';
  /**
   * Visual treatment owner. Split from `action` because the same
   * `'inert'` action has FOUR different meanings depending on the
   * surrounding state:
   *
   *   - `'inventory'` : outside combat. The rail is a view-only
   *     inventory; cards render at full color, no DEAL/SWAP pip, no
   *     grayscale, no not-allowed cursor. The user is just BROWSING
   *     what they own.
   *   - `'actionable'`: in combat AND the action is legal. Full color,
   *     hover lift + glow, DEAL/SWAP pip in the corner. Click fires.
   *   - `'disabled'`  : in combat AND the action is illegal (wrong
   *     role for the current seat). Dimmed + grayscale + not-allowed
   *     cursor so the user understands this card cannot help RIGHT
   *     NOW (e.g., a pitcher chip while you're at the plate).
   *   - `'seated'`    : in combat AND THIS player is currently at the
   *     plate/mound. Full color with an amber outline; no DEAL/SWAP
   *     pip (swapping the seated player onto themselves is a no-op).
   *     Reads as "this is the one already in".
   */
  state: 'inventory' | 'actionable' | 'disabled' | 'seated';
  /** Tooltip / title shown on hover. */
  title?: string;
  /**
   * Semantic edges -- the same `SznEdgeHalf` connectors the in-combat
   * `PlayerCard` shows on either side. Resolved at build time so the
   * footer chip matches the in-hand chip exactly:
   *   - Players: `leftEdgeOverride` / `rightEdgeOverride` first, then
   *     the player's printed leftEdge / rightEdge; `team-logo`
   *     synthetic gets resolved to the player's franchise logo.
   *   - Items: `sznLeftEdge` / `sznRightEdge` from the card def.
   * `null` when the card has no SZN edges to render (legacy quick-match
   * decks, placeholder rows).
   */
  leftEdge: SznEdgeId | null;
  rightEdge: SznEdgeId | null;
  /**
   * Team code (SZN `teamId` or legacy `team`) for the player chip's
   * gradient. Drives the body color so the footer chip is painted with
   * the SAME team gradient the in-combat `PlayerCard` uses for the
   * same player -- the user reads "Yankees Aaron Judge" identically
   * whether they're looking at the footer rail or the at-bat lineup.
   * Null on ability/item cards (they keep the neutral blue gradient).
   */
  teamCode?: string | null;
  /**
   * Role tag for the chip's accent ("BAT" / "PIT"). Surfaces the
   * batter / pitcher distinction even when the team gradient swallows
   * the old red/green role tint. Always `null` on ability cards.
   */
  roleTag?: 'BAT' | 'PIT' | null;
}

type ActiveSide = 'left' | 'right';

interface DeckState {
  left: FooterCardData[];
  right: FooterCardData[];
}

const FOOTER_HEIGHT_PX = 240;
const CARD_WIDTH_PX = 96;
const CARD_HEIGHT_PX = 136;

/**
 * Human-readable label for each `Rarity` token so the focused-card
 * overlay can render "Aaron Judge — Yankees · OF · Common" instead of
 * the raw lowercase enum value.
 */
const RARITY_LABEL: Record<string, string> = {
  common: 'Common',
  'all-star': 'All-Star',
  veteran: 'Veteran',
  legend: 'Legend',
};

/**
 * Build the one-line subtitle for a roster player ("Yankees · OF ·
 * Common"). Drops the franchise segment if the player is on a legacy
 * placeholder team that isn't in `MLB_TEAMS` (older fallback rosters).
 */
function rosterSubtitle(rp: RosterPlayer): string {
  const parts: string[] = [];
  if (isSznPlayer(rp.player)) {
    const team = MLB_TEAMS[rp.player.teamId];
    if (team) parts.push(team.shortName);
    if (rp.player.position) parts.push(rp.player.position);
  } else {
    parts.push(rp.player.role);
  }
  parts.push(RARITY_LABEL[rp.rarity] ?? rp.rarity);
  return parts.join(' · ');
}

/**
 * Long-form description for a roster player. Prefers the curated
 * `flavor` text; falls back to a synthesized edge-pair readout so the
 * overlay always has SOMETHING informative under the subtitle.
 */
function rosterDescription(rp: RosterPlayer): string | undefined {
  if (isSznPlayer(rp.player) && rp.player.flavor) return rp.player.flavor;
  // Synthetic: "Power → Velocity" so the user knows what this card
  // can snap to even without a flavor blurb.
  if (isSznPlayer(rp.player)) {
    const left = SZN_EDGES[rp.player.leftEdge]?.label ?? rp.player.leftEdge;
    const right = SZN_EDGES[rp.player.rightEdge]?.label ?? rp.player.rightEdge;
    return `${left} ← → ${right}`;
  }
  return undefined;
}

/**
 * Utility-item value display tag — mirrors `ItemCardPreview.UTILITY_TAGS`
 * so the footer chip and the merchant preview agree on how
 * baseValue-0 utility cards present themselves. Keeps the user from
 * reading "0" as "useless".
 */
const FOOTER_UTILITY_TAG: Record<string, string> = {
  'enc-sticky-stuff': 'SNAP',
  'enc-rally-fire': 'AURA',
  'enc-platinum-glove': 'DEF',
  'enc-classic-spikes': 'CPY',
  'enc-the-torch': 'CPY',
  'enc-duct-tape': 'SNAP',
  'enc-faded-scouting-report': 'INTL',
  'enc-mega-left': 'MEGA',
  'enc-mega-right': 'MEGA',
};

function valueForCard(def: CardDefinition | undefined): number | string {
  if (!def) return 0;
  if (def.baseValue === 0 && def.abilityType === 'EncounterItem') {
    return FOOTER_UTILITY_TAG[def.id] ?? '—';
  }
  return def.baseValue;
}

/**
 * Convert a `RosterPlayer` into the footer's display shape. Score is
 * the rarity base + any permanent boosts (Veteran specialty edge) so
 * the user sees the live, in-run value rather than the printed Common
 * baseline.
 *
 * `action` is derived from the current seat:
 *   - `'swap'` when the player's role matches the user's batting seat
 *     AND the user is in combat AND the player isn't currently
 *     seated.
 *   - `'inert'` otherwise.
 */
function rosterToFooterCard(
  rp: RosterPlayer,
  ctx: { inCombat: boolean; userSide: 'Batting' | 'Pitching'; seatedId: string | null },
): FooterCardData {
  const value = RARITY_BASE_VALUE[rp.rarity] + (rp.permanentBoost ?? 0) + (rp.scoreOverride ?? 0);
  const type: CardType = rp.player.role === 'Pitcher' ? 'pitcher' : 'batter';
  const roleMatches =
    (ctx.userSide === 'Batting' && rp.player.role === 'Batter') ||
    (ctx.userSide === 'Pitching' && rp.player.role === 'Pitcher');
  const isSeated = ctx.seatedId === rp.player.id;
  // Action + visual state derive from the same combat / role / seat
  // check but live in separate fields so the visual treatment can
  // differentiate "you don't own this action right now" (disabled)
  // from "the rail is just inventory at the moment" (inventory).
  const { action, state }: Pick<FooterCardData, 'action' | 'state'> =
    !ctx.inCombat
      ? { action: 'inert', state: 'inventory' }
      : isSeated
        ? { action: 'inert', state: 'seated' }
        : !roleMatches
          ? { action: 'inert', state: 'disabled' }
          : { action: 'swap', state: 'actionable' };
  const title = !ctx.inCombat
    ? `${rp.player.name} — inventory view`
    : isSeated
      ? `${rp.player.name} — currently at the plate/mound`
      : !roleMatches
        ? `${rp.player.name} — wrong role for this seat`
        : `Swap ${rp.player.name} into your ${ctx.userSide.toLowerCase()} seat`;

  // Edge resolution mirrors `PlayerCard.tsx`: overrides win, then the
  // printed leftEdge / rightEdge, with `team-logo` resolving to the
  // player's franchise logo so a Wildcard Sticker stamped as
  // `team-logo` reads as `yankees-logo` on a Yankees player.
  let leftEdge: SznEdgeId | null = null;
  let rightEdge: SznEdgeId | null = null;
  if (isSznPlayer(rp.player)) {
    const leftRaw = (rp.leftEdgeOverride ?? rp.player.leftEdge) as SznEdgeId;
    const rightRaw = (rp.rightEdgeOverride ?? rp.player.rightEdge) as SznEdgeId;
    leftEdge = leftRaw === 'team-logo' ? teamLogoEdge(rp.player.teamId) : leftRaw;
    rightEdge = rightRaw === 'team-logo' ? teamLogoEdge(rp.player.teamId) : rightRaw;
  }

  // Team code drives the gradient on the footer chip so the rail
  // matches the at-bat card visually. SZN players use `teamId`;
  // legacy MLB players use `team`. Same lookup `PlayerCard.tsx` uses
  // for the in-combat card.
  const teamCode = isSznPlayer(rp.player) ? rp.player.teamId : rp.player.team;

  return {
    id: rp.player.id,
    value,
    type,
    // Full player name on the card -- the CardLabel below renders
    // multi-line, so "Vladimir Guerrero Jr." wraps to two rows
    // instead of getting clipped to "Vlad…" the way the old
    // surname-only short label would have.
    label: rp.player.name || rp.player.id,
    subtitle: rosterSubtitle(rp),
    description: rosterDescription(rp),
    action,
    state,
    title,
    leftEdge,
    rightEdge,
    teamCode,
    roleTag: rp.player.role === 'Pitcher' ? 'PIT' : 'BAT',
  };
}

/**
 * Footer-card view of an inventory item. Score mirrors the card def's
 * baseValue (or utility tag) so the chip the user sees matches the
 * Merchant / Bag preview elsewhere. `action` is `'deal'` whenever the
 * user is in combat AND the item is not already dealt to the hand;
 * outside combat the card flips to `'inventory'` state (full color,
 * no DEAL pip) so the user sees their bag instead of a wall of
 * grayscale.
 */
function itemToFooterCard(
  item: Item,
  ctx: {
    inCombat: boolean;
    dealtInstanceIds: Set<string>;
  },
): FooterCardData | null {
  const def = SESSION_CARDS.find((c) => c.id === item.cardId);
  if (ctx.dealtInstanceIds.has(item.instanceId)) return null;
  const { action, state }: Pick<FooterCardData, 'action' | 'state'> = ctx.inCombat
    ? { action: 'deal', state: 'actionable' }
    : { action: 'inert', state: 'inventory' };
  const title = !ctx.inCombat
    ? `${def?.name ?? item.cardId} — deal during a series at-bat`
    : `Deal ${def?.name ?? item.cardId} into your hand`;

  // Items declare their snap edges via `sznLeftEdge` / `sznRightEdge`
  // (typed as `string` on the def to dodge a cyclic import). We coerce
  // to SznEdgeId here and drop anything the edge registry doesn't
  // recognise so a typo can't poison the badge render.
  const leftEdge = sznEdgeFromString(def?.sznLeftEdge);
  const rightEdge = sznEdgeFromString(def?.sznRightEdge);

  return {
    id: item.instanceId,
    value: valueForCard(def),
    type: 'ability',
    // Full item name on the card; multi-line wrap in CardLabel keeps
    // long names like "Faded Scouting Report" readable.
    label: def?.name ?? item.cardId,
    subtitle: def?.abilityType
      ? humanizeAbilityType(def.abilityType)
      : undefined,
    description: def?.description,
    action,
    state,
    title,
    leftEdge,
    rightEdge,
  };
}

/**
 * Friendlier label for the focused-card overlay subtitle. Reads enum
 * tokens like "EncounterItem" as "Encounter Item" so the overlay
 * doesn't bleed engine vocabulary into the player-facing readout.
 */
function humanizeAbilityType(t: string): string {
  if (!t) return '';
  return t
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Narrow a free-form `sznLeftEdge` / `sznRightEdge` string from a
 * `CardDefinition` into a verified `SznEdgeId`. Anything not registered
 * in `SZN_EDGES` returns `null` so the badge render gracefully omits
 * the chip instead of crashing or surfacing an unstyled placeholder.
 */
function sznEdgeFromString(raw: string | undefined): SznEdgeId | null {
  if (!raw) return null;
  return raw in SZN_EDGES ? (raw as SznEdgeId) : null;
}

/**
 * Build the footer deck state from the run roster + inventory + live
 * combat hand. Pitchers lead the left row because the active pitcher
 * anchors the defensive chain every at-bat; abilities currently in the
 * hand are filtered out of the right row so the rail accurately
 * reflects what's still deal-able.
 */
function decksFromRun(
  roster: RosterPlayer[] | null | undefined,
  itemBag: Item[] | null | undefined,
  ctx: {
    inCombat: boolean;
    userSide: 'Batting' | 'Pitching';
    seatedId: string | null;
    dealtInstanceIds: Set<string>;
  },
): DeckState {
  const left: FooterCardData[] = [];
  const right: FooterCardData[] = [];
  if (roster && roster.length > 0) {
    // Render in the underlying roster array order so footer "move
    // mode" reordering survives across renders. The team-selection
    // path seeds pitchers-first so the default visual layout still
    // matches the legacy runtime-sorted look; from there the user's
    // curated order wins.
    for (const rp of roster) {
      left.push(rosterToFooterCard(rp, ctx));
    }
  }
  if (itemBag && itemBag.length > 0) {
    for (const it of itemBag) {
      const card = itemToFooterCard(it, ctx);
      if (card) right.push(card);
    }
  }
  return { left, right };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SznFooterDecks() {
  const inCombat = useGameStore(isInSznCombat);
  const inFrontOffice = useGameStore(isInSznFrontOffice);
  const shouldRender = inCombat || inFrontOffice;

  const setStoreFooterHeight = useGameStore((s) => s.setSznFooterHeight);
  const focusSurface = useGameStore((s) => s.sznGamepadFocus);
  const setFocusSurface = useGameStore((s) => s.setSznGamepadFocus);

  // Live state used to derive what the footer renders. Everything is
  // selected as a primitive / stable reference so the memo below
  // doesn't fire on unrelated store updates.
  const roster = useGameStore((s) => s.run?.roster ?? null);
  const itemBag = useGameStore((s) => s.run?.itemBag ?? null);
  const userSide = useGameStore(getUserSide);
  const batter = useGameStore((s) => s.batter);
  const pitcher = useGameStore((s) => s.pitcher);
  const batterHand = useGameStore((s) => s.batterHand);
  const pitcherHand = useGameStore((s) => s.pitcherHand);

  const sznDealItem = useGameStore((s) => s.sznDealItem);
  const sznSwapPlayer = useGameStore((s) => s.sznSwapPlayer);
  const sznSwapRoster = useGameStore((s) => s.sznSwapRoster);
  const sznSwapItemBag = useGameStore((s) => s.sznSwapItemBag);

  // Set of bag instance ids currently held in the user's hand. We
  // derive this every render from the live hand (whichever seat the
  // user is in) so the footer right deck is always exactly
  // "bag minus already-dealt". This is the canonical filter -- the
  // previous baseline duplicated this state into a local mirror and
  // drifted whenever the at-bat advanced.
  const dealtInstanceIds = useMemo(() => {
    const set = new Set<string>();
    const hand = userSide === 'Batting' ? batterHand : pitcherHand;
    for (const c of hand) {
      if (c.sznInstanceId) set.add(c.sznInstanceId);
    }
    return set;
  }, [userSide, batterHand, pitcherHand]);

  // Currently-seated player id (so the left deck can mark them and
  // skip the swap action). When the user is in pitching we look at
  // the pitcher; in batting we look at the batter.
  const seatedId: string | null = inCombat
    ? userSide === 'Batting'
      ? batter?.id ?? null
      : pitcher?.id ?? null
    : null;

  const decks: DeckState = useMemo(
    () =>
      decksFromRun(roster, itemBag, {
        inCombat,
        userSide,
        seatedId,
        dealtInstanceIds,
      }),
    [roster, itemBag, inCombat, userSide, seatedId, dealtInstanceIds],
  );

  // ----- Local UI state (focus + collapse + move mode) -----------------
  const [activeSide, setActiveSide] = useState<ActiveSide>('left');
  const [footerIndex, setFooterIndex] = useState(0);
  const [footerCollapsed, setFooterCollapsed] = useState(false);
  // Move mode is a sticky toggle the user enters during Front Office to
  // shuffle their roster + bag order. While on, DPAD LEFT/RIGHT swaps
  // the focused card with its neighbor (instead of moving focus to a
  // different card), and each inventory card surfaces hover arrows so
  // mouse users can shift cards without a keyboard. Gated to FO via
  // `canMove` below because the combat code reads role / suspension
  // filters off the same roster array.
  const [moveMode, setMoveMode] = useState(false);
  const canMove = inFrontOffice && !inCombat;
  // If the user leaves FO mid-shuffle (e.g., series starts), bounce
  // out of move mode so the in-combat rail is back to its actionable
  // baseline.
  useEffect(() => {
    if (!canMove && moveMode) setMoveMode(false);
  }, [canMove, moveMode]);

  // Keep the focused index inside the current deck's bounds. When the
  // deck shrinks (item dealt out, player swapped in/out) we clamp so
  // the focus ring never points at an empty slot.
  useEffect(() => {
    const list = decks[activeSide];
    if (list.length === 0) {
      setFooterIndex(0);
      return;
    }
    if (footerIndex >= list.length) setFooterIndex(list.length - 1);
  }, [activeSide, decks, footerIndex]);

  // ----- Footer height reporting --------------------------------------
  useLayoutEffect(() => {
    if (!shouldRender) {
      setStoreFooterHeight(0);
      return;
    }
    setStoreFooterHeight(footerCollapsed ? 0 : FOOTER_HEIGHT_PX);
  }, [shouldRender, footerCollapsed, setStoreFooterHeight]);

  useEffect(() => {
    return () => setStoreFooterHeight(0);
  }, [setStoreFooterHeight]);

  useEffect(() => {
    if (!shouldRender && focusSurface === 'footer') {
      setFocusSurface('screen');
    }
  }, [shouldRender, focusSurface, setFocusSurface]);

  // ----- Card activation (click OR CROSS) ------------------------------
  // Single entry point so mouse / touch / gamepad all converge on
  // identical store mutations. Returns `true` when the activation
  // actually fired a store action so the focus-router can swallow the
  // input. `false` for inert clicks keeps the input available for any
  // future router.
  const activateCard = useCallback(
    (card: FooterCardData | undefined): boolean => {
      if (!card) return false;
      if (card.action === 'deal') {
        sznDealItem(card.id);
        return true;
      }
      if (card.action === 'swap') {
        sznSwapPlayer(card.id);
        return true;
      }
      return false;
    },
    [sznDealItem, sznSwapPlayer],
  );

  // ----- Move mode shift (click arrows OR DPAD in move mode) ----------
  // Swap the focused card in `side` with its neighbor at `dir`. Returns
  // true on success so the gamepad router can swallow the press AND
  // bump `footerIndex` to follow the moved card.
  const shiftFocused = useCallback(
    (side: ActiveSide, idx: number, dir: 'left' | 'right'): boolean => {
      const list = decks[side];
      const target = idx + (dir === 'left' ? -1 : 1);
      if (target < 0 || target >= list.length) return false;
      const a = list[idx];
      const b = list[target];
      if (!a || !b) return false;
      const ok =
        side === 'left' ? sznSwapRoster(a.id, b.id) : sznSwapItemBag(a.id, b.id);
      return ok;
    },
    [decks, sznSwapRoster, sznSwapItemBag],
  );

  const toggleMoveMode = useCallback(() => {
    if (!canMove) return;
    setMoveMode((prev) => !prev);
  }, [canMove]);

  const toggleCollapse = useCallback(() => {
    setFooterCollapsed((prev) => {
      const next = !prev;
      if (next && focusSurface === 'footer') {
        setFocusSurface('screen');
      }
      return next;
    });
  }, [focusSurface, setFocusSurface]);

  // ----- Gamepad focus router -----------------------------------------
  const onGamepadButton = useCallback(
    (btn: GamepadButton): boolean | void => {
      if (focusSurface !== 'footer') {
        // Either 'screen' or 'hand' surface owns input — the footer is
        // only a passive listener here. We grab DPAD_DOWN as the
        // canonical "drop into the rail" shortcut and TRIANGLE for
        // collapse, then let everything else pass through to the
        // surface-owning handler (lock-in / hand navigation / etc.).
        //
        // CardGameOverlay's hand router runs at higher priority and
        // re-routes DPAD_DOWN from 'hand' to 'screen' BEFORE this
        // listener sees it, so this branch effectively only fires from
        // 'screen' surface DPAD_DOWN -> 'footer'. Treating 'hand' as
        // non-footer keeps DPAD_LEFT/RIGHT navigation in the hand from
        // accidentally walking the footer's grabbed card.
        if (btn === 'DPAD_DOWN') {
          if (footerCollapsed) setFooterCollapsed(false);
          setFocusSurface('footer');
          return true;
        }
        if (btn === 'TRIANGLE') {
          toggleCollapse();
          return true;
        }
        return false;
      }

      // focusSurface === 'footer' from here down.
      //
      // While in move mode (a card is "grabbed"), the reference
      // implementation locks the user out of every cross-cutting
      // navigation -- L1/R1 switch decks, DPAD UP releases focus,
      // TRIANGLE collapses, CROSS deals/swaps. Each of those would
      // strand the held card mid-flight, so we BLOCK them and force
      // the user to drop (SQUARE) or cancel (CIRCLE) first. Only
      // DPAD LEFT/RIGHT remain live so the held card can walk
      // through the row.
      switch (btn) {
        case 'DPAD_UP':
          if (moveMode) return true;
          // No play area to escape to anymore -- DPAD_UP always
          // releases focus back to the screen surface.
          setFocusSurface('screen');
          return true;
        case 'DPAD_DOWN':
          if (moveMode) return true;
          // Already on the footer; second press collapses so the rail
          // can be hidden via gamepad-only.
          toggleCollapse();
          return true;
        case 'DPAD_LEFT': {
          const list = decks[activeSide];
          if (list.length === 0) return true;
          // Move mode: DPAD swaps the grabbed card with its neighbor
          // and the focus index follows so the card stays under the
          // cursor. Outside move mode it's plain navigation.
          if (moveMode && canMove) {
            const moved = shiftFocused(activeSide, footerIndex, 'left');
            if (moved) setFooterIndex((i) => Math.max(0, i - 1));
            return true;
          }
          setFooterIndex((idx) => Math.max(0, idx - 1));
          return true;
        }
        case 'DPAD_RIGHT': {
          const list = decks[activeSide];
          if (list.length === 0) return true;
          if (moveMode && canMove) {
            const moved = shiftFocused(activeSide, footerIndex, 'right');
            if (moved) setFooterIndex((i) => Math.min(list.length - 1, i + 1));
            return true;
          }
          setFooterIndex((idx) => Math.min(list.length - 1, idx + 1));
          return true;
        }
        case 'L1':
          if (moveMode) return true;
          setActiveSide('left');
          setFooterIndex(0);
          return true;
        case 'R1':
          if (moveMode) return true;
          setActiveSide('right');
          setFooterIndex(0);
          return true;
        case 'TRIANGLE':
          if (moveMode) return true;
          toggleCollapse();
          return true;
        case 'CROSS': {
          if (moveMode) return true;
          const card = decks[activeSide][footerIndex];
          activateCard(card);
          return true;
        }
        case 'CIRCLE':
          // CIRCLE exits move mode first (one press to drop, second
          // press to release focus) so the user has a clear escape
          // hatch from the rearrange flow.
          if (moveMode) {
            setMoveMode(false);
            return true;
          }
          setFocusSurface('screen');
          return true;
        case 'SQUARE':
          // SQUARE grabs the focused card or drops the grabbed card.
          // Gated to FO -- combat owns the rail's deal/swap surface.
          if (!canMove) return false;
          toggleMoveMode();
          return true;
        default:
          return false;
      }
    },
    [
      focusSurface,
      setFocusSurface,
      footerCollapsed,
      toggleCollapse,
      decks,
      activeSide,
      footerIndex,
      activateCard,
      moveMode,
      canMove,
      shiftFocused,
      toggleMoveMode,
    ],
  );

  useSznGamepad({
    id: 'szn-footer-focus-router',
    priority: 50,
    enabled: shouldRender,
    handler: onGamepadButton,
  });

  if (!shouldRender) return null;

  const footerOwnsFocus = focusSurface === 'footer';
  // Live focused card -- drives the detail overlay above the footer.
  // We resolve it on every render so the overlay tracks the user's
  // current focus as they DPAD through the row (or click between
  // cards) without an extra effect.
  const focusedCard: FooterCardData | null = footerOwnsFocus
    ? decks[activeSide][footerIndex] ?? null
    : null;

  return (
    <>
      <FocusedCardDetail card={focusedCard} collapsed={footerCollapsed} moveMode={moveMode} />
      <FooterBand
      decks={decks}
      activeSide={activeSide}
      footerIndex={footerIndex}
      collapsed={footerCollapsed}
      focused={footerOwnsFocus}
      moveMode={moveMode}
      onCardClick={(side, idx) => {
        const card = decks[side][idx];
        if (focusSurface !== 'footer') setFocusSurface('footer');
        // Move mode: the focused card is the GRABBED card. Clicking
        // another card in the same deck swaps them and follows the
        // grabbed card to its new slot; clicking the grabbed card
        // itself is a no-op (the gamepad SQUARE / DONE button is the
        // explicit drop affordance). Cross-deck clicks are also
        // suppressed because you can't shuffle a roster player into
        // the abilities bag.
        if (moveMode) {
          if (side !== activeSide) return;
          if (idx === footerIndex) return;
          const grabbed = decks[activeSide][footerIndex];
          if (!grabbed) return;
          const ok =
            activeSide === 'left'
              ? sznSwapRoster(grabbed.id, card.id)
              : sznSwapItemBag(grabbed.id, card.id);
          if (ok) setFooterIndex(idx);
          return;
        }
        // Outside move mode: click acts as focus + activate (deal /
        // swap player if the card is actionable).
        setActiveSide(side);
        setFooterIndex(idx);
        activateCard(card);
      }}
      onSideHover={(side) => {
        if (side === activeSide) return;
        setActiveSide(side);
        setFooterIndex(0);
      }}
    />
    </>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

/**
 * Detail overlay that floats just above the footer band whenever a
 * footer card has focus. Shows the FULL card name (vs. the 88px-clipped
 * label on the chip), a one-line subtitle (team · position · rarity or
 * ability type), and the long-form description (player flavor or item
 * ability text).
 *
 * Position-wise we anchor `fixed bottom = FOOTER_HEIGHT_PX + 12px` so
 * the overlay sits in the gap above the footer band -- in combat it
 * floats above the chain area without obscuring it; in FO it sits
 * above the rail labels. The overlay is `pointer-events: none` so it
 * never intercepts clicks on whatever's underneath it.
 *
 * Hidden when the footer is collapsed (no card is visible to anchor
 * the detail to) and dimmed in move mode (the user is rearranging,
 * not inspecting -- but we still show name + edges so they can
 * confirm which card they're holding).
 */
function FocusedCardDetail({
  card,
  collapsed,
  moveMode,
}: {
  card: FooterCardData | null;
  collapsed: boolean;
  moveMode: boolean;
}) {
  if (!card || collapsed) return null;
  // Border tint matches the card's role palette so the overlay reads
  // as "this is about the focused card" even mid-DPAD-shuffle.
  const accent =
    card.type === 'batter'
      ? '#ef5350'
      : card.type === 'pitcher'
        ? '#4ade80'
        : '#89b4fa';
  // Purple when grabbed so the overlay matches the in-row grabbed
  // highlight without losing the role-tint context.
  const ringColor = moveMode ? '#cba6f7' : accent;
  return (
    // z-[10000] matches the project-wide "hover/focus layer" convention
    // (see HOVER_LAYER_Z_CLASS in CardGameOverlay/ItemCardPreview/QuestStrip).
    // The footer band itself stays at z-[5] because it lives at the bottom
    // edge of the viewport and doesn't visually overlap mid-screen UI, but
    // this detail popup floats UP above the footer into the gameplay area,
    // where the rest of the in-game UI (matchup math z-30, Lock In z-30,
    // ManagerHand z-40/z-50, banners z-[32]) would otherwise paint over it
    // and make the description unreadable.
    <div
      className="pointer-events-none fixed left-1/2 z-[10000] -translate-x-1/2"
      style={{ bottom: `${FOOTER_HEIGHT_PX + 12}px` }}
    >
      <div
        className="flex w-[460px] max-w-[90vw] flex-col items-stretch gap-1.5 rounded-xl border-2 bg-[#11111b]/95 px-4 py-3 text-white shadow-[0_10px_25px_rgba(0,0,0,0.6)] backdrop-blur"
        style={{ borderColor: ringColor }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span
            className="truncate text-base font-black uppercase tracking-wide"
            style={{ color: ringColor }}
          >
            {card.label ?? card.id}
          </span>
          <span className="flex-none text-[10px] font-bold uppercase tracking-widest text-[#a6adc8]">
            {typeof card.value === 'number' ? `Score ${card.value}` : card.value}
          </span>
        </div>
        {card.subtitle && (
          <div className="text-[11px] font-semibold uppercase tracking-widest text-[#a6adc8]">
            {card.subtitle}
          </div>
        )}
        {card.description && (
          <div className="text-xs leading-snug text-[#e6e6f0]">
            {card.description}
          </div>
        )}
        {(card.leftEdge || card.rightEdge) && (
          // Show the snap edges so the user can plan a chain without
          // having to memorize the half-glyph language.
          <div className="mt-1 flex items-center justify-center gap-3 text-[10px] font-bold uppercase tracking-widest text-[#a6adc8]">
            {card.leftEdge && (
              <span
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5"
                style={{
                  backgroundColor: `${SZN_EDGES[card.leftEdge].tint}33`,
                  color: SZN_EDGES[card.leftEdge].tint,
                }}
              >
                <span aria-hidden>◀</span>
                {SZN_EDGES[card.leftEdge].label}
              </span>
            )}
            {card.rightEdge && (
              <span
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5"
                style={{
                  backgroundColor: `${SZN_EDGES[card.rightEdge].tint}33`,
                  color: SZN_EDGES[card.rightEdge].tint,
                }}
              >
                {SZN_EDGES[card.rightEdge].label}
                <span aria-hidden>▶</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FooterBand({
  decks,
  activeSide,
  footerIndex,
  collapsed,
  focused,
  moveMode,
  onCardClick,
  onSideHover,
}: {
  decks: DeckState;
  activeSide: ActiveSide;
  footerIndex: number;
  collapsed: boolean;
  focused: boolean;
  moveMode: boolean;
  onCardClick: (side: ActiveSide, idx: number) => void;
  onSideHover: (side: ActiveSide) => void;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[5] flex items-center justify-center gap-2 bg-[#11111b] px-5 transition-transform duration-[400ms] ease-out"
      style={{
        height: `${FOOTER_HEIGHT_PX}px`,
        boxShadow: '0 -10px 20px rgba(0,0,0,0.5)',
        transform: collapsed ? `translateY(${FOOTER_HEIGHT_PX}px)` : 'none',
        pointerEvents: 'auto',
      }}
    >
      <RowContainer
        label="players (L1)"
        side="left"
        active={focused && activeSide === 'left'}
        cards={decks.left}
        focusedIndex={
          focused && activeSide === 'left' ? footerIndex : -1
        }
        moveMode={moveMode}
        onCardClick={(idx) => onCardClick('left', idx)}
        onHover={() => onSideHover('left')}
      />
      <RowContainer
        label="abilities (R1)"
        side="right"
        active={focused && activeSide === 'right'}
        cards={decks.right}
        focusedIndex={
          focused && activeSide === 'right' ? footerIndex : -1
        }
        moveMode={moveMode}
        onCardClick={(idx) => onCardClick('right', idx)}
        onHover={() => onSideHover('right')}
      />
    </div>
  );
}

function RowContainer({
  label,
  side,
  active,
  cards,
  focusedIndex,
  moveMode,
  onCardClick,
  onHover,
}: {
  label: string;
  side: ActiveSide;
  active: boolean;
  cards: FooterCardData[];
  focusedIndex: number;
  moveMode: boolean;
  onCardClick: (idx: number) => void;
  onHover: () => void;
}) {
  // The wrapper / track split is the SAME mechanism the original used
  // (see https://www.w3.org/TR/css-overflow-3/#overflow-properties):
  // `overflow-x: clip` + `overflow-y: visible` is the only combo that
  // lets the focused-card lift (translateY -15px) escape the wrapper's
  // top edge without re-introducing a y-axis scroll bar. Don't collapse
  // to `overflow-hidden` or you'll re-clip the halo.
  const SCROLL_MARGIN_PX = 20;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrollX, setScrollX] = useState(0);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const track = trackRef.current;
    if (!wrapper || !track) return;

    const wrapperW = wrapper.clientWidth;
    const trackW = track.scrollWidth;

    if (trackW <= wrapperW) {
      setScrollX((wrapperW - trackW) / 2);
      return;
    }

    const maxScroll = trackW - wrapperW;

    if (focusedIndex < 0) {
      setScrollX((prev) => Math.max(-maxScroll, Math.min(0, prev)));
      return;
    }
    if (focusedIndex === 0) {
      setScrollX(0);
      return;
    }
    if (focusedIndex === cards.length - 1) {
      setScrollX(-maxScroll);
      return;
    }

    const card = track.children[focusedIndex] as HTMLElement | undefined;
    if (!card) return;

    const cardLeftInTrack = card.offsetLeft;
    const cardRightInTrack = cardLeftInTrack + card.offsetWidth;

    setScrollX((prev) => {
      const visLeft = -prev;
      const visRight = -prev + wrapperW;
      if (cardLeftInTrack < visLeft + SCROLL_MARGIN_PX) {
        return Math.min(0, -(cardLeftInTrack - SCROLL_MARGIN_PX));
      }
      if (cardRightInTrack > visRight - SCROLL_MARGIN_PX) {
        return Math.max(
          -maxScroll,
          -(cardRightInTrack - wrapperW + SCROLL_MARGIN_PX),
        );
      }
      return prev;
    });
  }, [focusedIndex, cards.length]);

  const emptyMsg = side === 'left' ? 'Roster is empty.' : 'No abilities in bag.';

  return (
    <div
      className="flex flex-1 flex-col items-center gap-1.5 min-w-0"
      onMouseEnter={onHover}
    >
      <div className="text-lg font-bold tracking-wider text-[#a6adc8]">
        {label}
      </div>
      <div
        ref={wrapperRef}
        className={[
          'w-full rounded-xl border-[3px] py-5 transition-[border-color,background-color] duration-300',
          '[overflow-x:clip] [overflow-y:visible]',
          active
            ? 'border-[#a6e3a1] bg-[rgba(166,227,161,0.1)]'
            : 'border-transparent bg-transparent',
        ].join(' ')}
        style={{ minHeight: `${CARD_HEIGHT_PX}px` }}
      >
        {cards.length === 0 ? (
          <div
            className="flex items-center justify-center text-[#6c7086] text-xs uppercase tracking-widest"
            style={{ minHeight: `${CARD_HEIGHT_PX}px` }}
          >
            {emptyMsg}
          </div>
        ) : (
          <div
            ref={trackRef}
            className="flex w-max flex-nowrap gap-2.5 transition-transform duration-300 ease-out [&>*:first-child]:ml-5 [&>*:last-child]:mr-5"
            style={{
              transform: `translateX(${scrollX}px)`,
              willChange: 'transform',
            }}
          >
            {cards.map((card, i) => {
              const focused = i === focusedIndex;
              return (
                <Card
                  key={card.id}
                  card={card}
                  focused={focused}
                  moveMode={moveMode}
                  onClick={() => onCardClick(i)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  card,
  focused,
  moveMode,
  onClick,
}: {
  card: FooterCardData;
  focused: boolean;
  moveMode: boolean;
  onClick: () => void;
}) {
  // Player chips paint with the player's team palette so the footer
  // rail matches the in-combat `PlayerCard` exactly -- the user reads
  // "Yankees Aaron Judge" the same way in both places. Ability chips
  // keep the neutral blue gradient. Falls back to the legacy red /
  // green role tints if the team palette is unavailable (e.g., legacy
  // quick-match rosters without an MLB team), and `roleTag` (below)
  // carries the role distinction for player chips regardless of which
  // gradient we land on.
  let gradient: string;
  if (card.teamCode) {
    const palette = teamPalette(card.teamCode);
    gradient = `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`;
  } else {
    gradient =
      card.type === 'batter'
        ? 'linear-gradient(135deg, #e53935, #ef5350)'
        : card.type === 'pitcher'
          ? 'linear-gradient(135deg, #15803d, #4ade80)'
          : 'linear-gradient(135deg, #89b4fa, #74c7ec)';
  }

  // Visual treatment is owned by `card.state` -- four buckets so the
  // user can tell at a glance whether the rail is acting as INVENTORY
  // (between at-bats, full color, no pips), as an ACTION rail (mid
  // at-bat, hover lift + pip), as a DISABLED card (wrong role for
  // this seat), or as the SEATED player (currently at the plate or
  // mound). Previously every non-actionable state collapsed onto the
  // same dim+grayscale "broken" treatment, which made the Mon-Thu
  // Front Office rail read as a wall of dead chips.
  const isActionable = card.state === 'actionable';
  const isDisabled = card.state === 'disabled';
  const isSeated = card.state === 'seated';
  const isInventory = card.state === 'inventory';

  // Reference-aligned "grabbed" treatment: when move mode is on, the
  // FOCUSED card alone gets the purple highlight + extra lift + scale.
  // Every other card renders normally so the user can read at a
  // glance which card they're currently holding. (DPAD LEFT/RIGHT
  // then walks the grabbed card through the row; the focus follows.)
  const isGrabbed = moveMode && focused;

  const borderColor = isGrabbed
    ? '#cba6f7' /* purple grab */
    : focused
      ? '#f9e2af' /* yellow focus */
      : isSeated
        ? '#fbbf24'
        : isInventory
          ? 'rgba(255,255,255,0.18)'
          : isActionable
            ? 'rgba(255,255,255,0.12)'
            : 'transparent';
  const shadow = isGrabbed
    ? '0 15px 20px rgba(203,166,247,0.5)' /* purple drop shadow */
    : focused
      ? '0 10px 15px rgba(249,226,175,0.4)'
      : isSeated
        ? '0 6px 12px rgba(251,191,36,0.45)'
        : '0 4px 6px rgba(0,0,0,0.3)';
  const transform = isGrabbed
    ? 'translateY(-25px) scale(1.05)' /* extra lift + scale */
    : focused
      ? 'translateY(-15px)'
      : 'none';

  // Hover behavior also scoped to state. While move mode is on the
  // OTHER cards become "swap targets" -- pointer cursor + brighten
  // hover -- so mouse users can click any neighbor to swap the
  // grabbed card into that slot (the gamepad analog of DPAD nav).
  const hoverClass = isGrabbed
    ? 'cursor-grab'
    : moveMode
      ? 'cursor-pointer hover:brightness-110'
      : isActionable
        ? 'cursor-pointer hover:-translate-y-[15px] hover:shadow-[0_10px_15px_rgba(249,226,175,0.35)]'
        : isInventory
          ? 'cursor-default hover:brightness-110'
          : isSeated
            ? 'cursor-default'
            : 'cursor-not-allowed opacity-50 grayscale';

  // Corner pip vocabulary -- only show when the state communicates
  // something the card visual itself doesn't. Move mode suppresses
  // pips so the corner is clean (the purple halo IS the affordance).
  const pip: string | null = moveMode
    ? null
    : isActionable && !focused
      ? card.action === 'deal'
        ? 'DEAL'
        : 'SWAP'
      : isSeated && !focused
        ? card.type === 'pitcher'
          ? 'ON MOUND'
          : 'AT PLATE'
        : null;

  return (
    <button
      type="button"
      // Click semantics:
      //   - In move mode: the parent handler swaps the grabbed
      //     (focused) card with this card and re-focuses to follow
      //     the swap. We forward the click unconditionally so
      //     non-actionable cards (e.g., a seated player) can still
      //     be swapped during move mode.
      //   - Outside move mode: only actionable cards fire the
      //     deal/swap call.
      onClick={moveMode ? onClick : isActionable ? onClick : undefined}
      // Only hard-disable cards the user genuinely can't use right
      // now (wrong role for the current seat). Inventory and seated
      // cards stay focusable so the user can navigate to them and
      // read their tooltip / inspect their edges. In move mode we
      // never disable so every card stays a swap target.
      disabled={!moveMode && isDisabled}
      title={
        moveMode
          ? isGrabbed
            ? `Grabbed: ${card.label ?? card.id} (SQUARE to drop, DPAD to shift)`
            : `Swap into this slot: ${card.label ?? card.id}`
          : card.title
      }
      aria-label={card.title ?? card.label ?? card.id}
      aria-grabbed={isGrabbed || undefined}
      className={[
        // `appearance-none` + `p-0 m-0` strip the browser's default
        // button chrome so the card visual matches the legacy <div>
        // baseline exactly. `focus-visible` keeps keyboard a11y while
        // hiding the dotted outline on mouse activations.
        'appearance-none p-0 m-0 outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
        'relative flex flex-none items-center justify-center rounded-lg font-bold text-white transition-[transform,box-shadow,border-color,filter] duration-150',
        hoverClass,
      ].join(' ')}
      style={{
        width: `${CARD_WIDTH_PX}px`,
        height: `${CARD_HEIGHT_PX}px`,
        background: gradient,
        border: `3px solid ${borderColor}`,
        fontSize: typeof card.value === 'number' ? '2.5rem' : '1rem',
        letterSpacing: typeof card.value === 'number' ? 'normal' : '0.05em',
        textShadow: '1px 1px 4px rgba(0,0,0,0.5)',
        boxShadow: shadow,
        transform,
        zIndex: isGrabbed ? 20 : focused ? 10 : isSeated ? 5 : 1,
      }}
    >
      {card.value}
      {/* Team + role corner chip on player cards -- mirrors the
          at-bat `PlayerCard` header (team code top-left, role pill).
          Surfaces the role distinction now that the body gradient
          carries team colors instead of the legacy red/green role
          tint. Suppressed when a state pip (DEAL / SWAP / AT PLATE /
          ON MOUND) is in the same corner to avoid stacking. */}
      {card.teamCode && (
        <span
          aria-hidden
          className="absolute top-1 left-1 rounded bg-black/55 px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-white/95"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
        >
          {card.teamCode}
          {card.roleTag ? ` · ${card.roleTag}` : ''}
        </span>
      )}
      {card.label && <CardLabel label={card.label} />}
      {/* Physical edge connectors -- same `SznEdgeHalf` the in-combat
          `PlayerCard` and `CardItem` use. The half-shape pokes out
          flush with the card border so the rail card visually matches
          the combat hand; `compact` keeps the half proportional to the
          96x136 footer card. */}
      {card.leftEdge && (
        <SznEdgeHalf edge={card.leftEdge} side="left" isConnected={false} compact />
      )}
      {card.rightEdge && (
        <SznEdgeHalf edge={card.rightEdge} side="right" isConnected={false} compact />
      )}
      {pip && (
        <span
          aria-hidden
          className={[
            'absolute top-1 right-1 rounded px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-white',
            isSeated ? 'bg-amber-500/85' : 'bg-black/55',
          ].join(' ')}
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
        >
          {pip}
        </span>
      )}
    </button>
  );
}

function CardLabel({ label }: { label: string }) {
  return (
    // Two-line clamp + tighter tracking so the FULL name fits in the
    // 88-wide chip without truncating. Anything that still overflows
    // two rows gets an ellipsis, but the overlay above the footer
    // always renders the un-clipped name + subtitle + description so
    // overflowing the chip doesn't lose information.
    <span
      className="absolute bottom-1 left-1 right-1 line-clamp-2 rounded bg-black/55 px-1 py-0.5 text-center text-[9px] font-bold uppercase tracking-tight leading-[1.1] text-white"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
    >
      {label}
    </span>
  );
}
