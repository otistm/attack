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
import { type Item, type Rarity, type RosterPlayer } from '../lib/run';
import { SESSION_CARDS } from '../lib/cards';
import type { CardDefinition } from '../lib/cards';
import { getSznPlayer, isSznPlayer } from '../lib/sznPlayers';
import {
  revealedAbilities,
  totalPotentialSlots,
  triggerGlyph,
  triggerLabel,
} from '../lib/sznPlayerAbilities';
import { PLAYERS } from '../lib/players';
import { SZN_EDGES, canSznSnap, type SznEdgeId } from '../lib/sznEdges';
import { SznEdgeHalf } from './SznEdgeHalf';
import { teamPalette } from '../lib/teamColors';
import { sellValueFor } from '../lib/items';
import { TIER_GLYPH, TIER_TINT, type ItemTier } from '../lib/itemTiers';

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
   * Drives the team-code chip painted in the top-left corner of the
   * card so the user can still read which team the player belongs to
   * (the card body itself is now painted with a rarity gradient,
   * not a team gradient -- see `rarity` below).
   * Null on ability/item cards (they keep the neutral blue gradient).
   */
  teamCode?: string | null;
  /**
   * Roster-slot rarity. Drives the player chip body gradient
   * (copper / silver / gold / cosmic) and the rarity badge. The
   * audit asked for rarity, not team, to be the dominant color
   * signal across every player surface so the user can scan a
   * row of chips and see tiering at a glance. `undefined` on
   * ability cards (they don't carry a rarity).
   */
  rarity?: Rarity;
  /**
   * Role tag for the chip's accent ("BAT" / "PIT"). Surfaces the
   * batter / pitcher distinction even when the rarity gradient
   * swallows the old red/green role tint. Always `null` on ability
   * cards.
   */
  roleTag?: 'BAT' | 'PIT' | null;
  /**
   * Bazaar tier of the source bag item (only set on ability cards;
   * always `undefined` for player cards). Drives the tier glyph
   * (B/S/G) painted in the top-left corner and the live sell-value
   * subtitle. Defaults to "bronze" everywhere it's read.
   */
  itemTier?: ItemTier;
  /**
   * Source card's `abilityType` (Signature, General Draw, EncounterItem,
   * MegaHalf, etc) -- used to look up the body gradient via
   * {@link abilityCardGradient}. Always undefined for player cards.
   */
  abilityType?: string;
  /**
   * Live cash-back if the user sells this item from the footer's
   * sell tray. Only set on item cards; `undefined` for players (the
   * roster sell tray lives elsewhere).
   */
  sellValue?: number;
}

type ActiveSide = 'left' | 'right';

interface DeckState {
  left: FooterCardData[];
  right: FooterCardData[];
}

const FOOTER_HEIGHT_PX = 240;
const CARD_WIDTH_PX = 96;
const CARD_HEIGHT_PX = 136;

// Rarity label, utility-tag table, value resolver, subtitle, and
// description ALL live in `cardDisplay.ts` now so the footer rail
// matches every other card-shaped surface in SZN mode pixel-for-pixel.
// Previously each surface kept its own copy and the tables drifted
// (`all-star` vs `allstar`, `SHIELD` vs `DEF`, etc.).
import {
  rosterSubtitle as sharedRosterSubtitle,
  displayValueFor,
  resolvePlayerEdges,
  playerDisplayValue,
  RARITY_GRADIENT,
  abilityCardGradient,
} from '../lib/cardDisplay';

function rosterSubtitle(rp: RosterPlayer): string {
  return sharedRosterSubtitle(rp);
}

function rosterDescription(rp: RosterPlayer): string | undefined {
  if (isSznPlayer(rp.player) && rp.player.flavor) return rp.player.flavor;
  if (isSznPlayer(rp.player)) {
    const left = SZN_EDGES[rp.player.leftEdge]?.label ?? rp.player.leftEdge;
    const right = SZN_EDGES[rp.player.rightEdge]?.label ?? rp.player.rightEdge;
    return `${left} ← → ${right}`;
  }
  return undefined;
}

function valueForCard(def: CardDefinition | undefined): number | string {
  return displayValueFor(def);
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
  const value = playerDisplayValue(rp);
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

  // Edge resolution flows through `cardDisplay.resolvePlayerEdges` so
  // the footer rail, the at-bat hero, the pickers, and the Series
  // intro all render the SAME edges for a given slot. Honors
  // encounter overrides + `team-logo` synthetic resolution.
  const { leftEdge, rightEdge } = resolvePlayerEdges(rp);

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
    // Surface the slot rarity so the Card render below can paint
    // the body with the rarity gradient (copper / silver / gold /
    // cosmic) instead of the team palette.
    rarity: rp.rarity,
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
    week: number;
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

  const itemTier: ItemTier = item.tier ?? 'bronze';
  const sellValue = def ? sellValueFor(def, ctx.week, itemTier) : undefined;

  return {
    id: item.instanceId,
    value: valueForCard(def),
    type: 'ability',
    // Full item name on the card; multi-line wrap in CardLabel keeps
    // long names like "Faded Scouting Report" readable.
    label: def?.name ?? item.cardId,
    // Skip the humanized "Encounter Item" subtitle for SZN items --
    // the user already knows they're looking at an item (they're on
    // the bag rail / merchant / event grant), so reading "Encounter
    // Item" on every overlay is pure noise. Other ability types
    // (General Draw, Player, etc.) still surface their humanized
    // label for context.
    subtitle:
      def?.abilityType && def.abilityType !== "EncounterItem"
        ? humanizeAbilityType(def.abilityType)
        : undefined,
    description: def?.description,
    action,
    state,
    title,
    leftEdge,
    rightEdge,
    itemTier,
    abilityType: def?.abilityType,
    sellValue,
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
    week: number;
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
  const week = useGameStore((s) => s.run?.week ?? 1);
  const userSide = useGameStore(getUserSide);
  const batter = useGameStore((s) => s.batter);
  const pitcher = useGameStore((s) => s.pitcher);
  const batterHand = useGameStore((s) => s.batterHand);
  const pitcherHand = useGameStore((s) => s.pitcherHand);

  const sznDealItem = useGameStore((s) => s.sznDealItem);
  const sznSwapPlayer = useGameStore((s) => s.sznSwapPlayer);
  const sznSwapRoster = useGameStore((s) => s.sznSwapRoster);
  const sznSwapItemBag = useGameStore((s) => s.sznSwapItemBag);
  const sellItemForCash = useGameStore((s) => s.sellItemForCash);

  // Free-agency overflow flow. When `run.pendingPlayerGrant` is set,
  // the user signed a player while the roster was already at the
  // starter-pack cap; the cull must come out of the existing roster
  // before the queued sign can land. We surface this entirely on the
  // footer rail now (previously a separate full-screen
  // `RosterReleasePicker` modal): the left deck paints each player
  // chip with a red "RELEASE" overlay, CROSS / click confirms the
  // cut, and CIRCLE cancels with a full refund.
  const pendingPlayerGrant = useGameStore(
    (s) => s.run?.pendingPlayerGrant ?? null,
  );
  const confirmReleaseAndSignPlayer = useGameStore(
    (s) => s.confirmReleaseAndSignPlayer,
  );
  const cancelPendingPlayerGrant = useGameStore(
    (s) => s.cancelPendingPlayerGrant,
  );

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
        week,
      }),
    [roster, itemBag, inCombat, userSide, seatedId, dealtInstanceIds, week],
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
  // Sell mode is a sibling toggle to move mode -- entered via L2 (or
  // the per-card `$` corner button on the abilities row, see Card
  // below). While on, each ability card paints a red "SELL $X"
  // overlay and clicking sells the item for cash. Gated to FO; combat
  // owns the rail's deal surface and shouldn't lose items mid-at-bat.
  // Move mode and sell mode are mutually exclusive -- entering one
  // disables the other so the user can't accidentally swap-then-sell.
  const [sellMode, setSellMode] = useState(false);
  // If the user leaves FO mid-shuffle (e.g., series starts), bounce
  // out of move/sell mode so the in-combat rail is back to its
  // actionable baseline.
  useEffect(() => {
    if (!canMove && moveMode) setMoveMode(false);
    if (!canMove && sellMode) setSellMode(false);
  }, [canMove, moveMode, sellMode]);

  // ----- Release mode (free-agency overflow cull) ---------------------
  // Active whenever `run.pendingPlayerGrant` is set. The user just
  // bought a free agent while the roster was already at the cap, so
  // they MUST pick one current roster slot to release before the new
  // sign can land. Drives:
  //   - Auto-focus into the left deck so the user lands on the
  //     release picker without an extra DPAD press.
  //   - A red "RELEASE" overlay on every player chip (mirrors sell
  //     mode's per-card treatment for items).
  //   - A `ReleaseTrayBanner` callout above the rail describing the
  //     pending sign + CIRCLE-to-refund escape hatch.
  //   - Per-player release validity: the same `sameRoleCount > 1 ||
  //     incoming.role === releasing.role` rule
  //     `confirmReleaseAndSignPlayer` enforces, surfaced visually so
  //     the user can't click into a no-op.
  const releaseMode = pendingPlayerGrant !== null;
  // Resolve the incoming player from the same catalog gameStore uses
  // (SZN pool first, legacy MLB fallback) so we know which role the
  // grant fills. Needed to compute the per-player release validity
  // below; null while there's no pending grant.
  const incomingPlayerRole: 'Batter' | 'Pitcher' | null = useMemo(() => {
    if (!pendingPlayerGrant) return null;
    const p =
      getSznPlayer(pendingPlayerGrant.playerId) ??
      PLAYERS.find((pl) => pl.id === pendingPlayerGrant.playerId);
    return p?.role ?? null;
  }, [pendingPlayerGrant]);
  // Set of roster player ids that can be safely released for the
  // current pending grant. A slot is INVALID when releasing it would
  // leave its role at zero AND the incoming player doesn't backfill
  // that role -- exactly the gate `confirmReleaseAndSignPlayer`
  // enforces. We surface it here so the chips that would no-op are
  // visibly disabled instead of silently rejecting CROSS.
  const releaseValidIds: Set<string> = useMemo(() => {
    const out = new Set<string>();
    if (!releaseMode || !roster) return out;
    const batterCount = roster.filter((r) => r.player.role === 'Batter').length;
    const pitcherCount = roster.filter(
      (r) => r.player.role === 'Pitcher',
    ).length;
    for (const rp of roster) {
      const sameRoleCount =
        rp.player.role === 'Batter' ? batterCount : pitcherCount;
      const incomingBackfills = incomingPlayerRole === rp.player.role;
      if (sameRoleCount > 1 || incomingBackfills) {
        out.add(rp.player.id);
      }
    }
    return out;
  }, [releaseMode, roster, incomingPlayerRole]);

  // Enter release mode: pin focus to the footer + left deck and pop
  // collapse / move / sell so the user lands directly on a clean
  // release-picker surface. `pendingPlayerGrant?.playerId` is the
  // re-trigger key -- a second pending grant queued after the first
  // (defensive; the store currently refuses concurrent grants) would
  // still re-snap focus to the new pick. Gated on `shouldRender` so
  // a pending grant queued outside the FO / combat surfaces (a
  // future caller path) doesn't strand focus on a rail that isn't
  // mounted.
  useEffect(() => {
    if (!releaseMode || !shouldRender) return;
    setFocusSurface('footer');
    setActiveSide('left');
    if (footerCollapsed) setFooterCollapsed(false);
    if (moveMode) setMoveMode(false);
    if (sellMode) setSellMode(false);
    // Land on the first VALID release target so the user doesn't have
    // to walk past a disabled chip on entry. Falls back to slot 0 if
    // every chip happens to be invalid (defensive — the store-side
    // guard prevents that, but we don't want to NaN here).
    setFooterIndex(() => {
      const first = roster?.findIndex((r) =>
        releaseValidIds.has(r.player.id),
      );
      return first !== undefined && first >= 0 ? first : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseMode, shouldRender, pendingPlayerGrant?.playerId]);

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
      // Release mode (free-agency overflow cull) takes precedence over
      // every other activation path -- when a pending grant is queued
      // the only legal action on the left deck is releasing one of
      // the focused player slots. Invalid targets (slot would leave
      // the role at zero AND incoming player doesn't backfill) no-op
      // so the user gets the same dead-click feedback the visual
      // dim/grey treatment is telegraphing.
      if (releaseMode && (card.type === 'batter' || card.type === 'pitcher')) {
        if (!releaseValidIds.has(card.id)) return false;
        confirmReleaseAndSignPlayer(card.id);
        return true;
      }
      // Sell mode overrides normal activation for ability cards. The
      // user explicitly opted into the sell tray (via L2 / the per-
      // card $ chip / SQUARE if they're already in sell mode); a
      // click on an item card commits the sale instead of dealing.
      // Players are untouched by sell mode -- the roster sell loop
      // lives in `sellPlayerForCash` elsewhere.
      if (sellMode && card.type === 'ability') {
        sellItemForCash(card.id);
        return true;
      }
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
    [
      sznDealItem,
      sznSwapPlayer,
      sellItemForCash,
      sellMode,
      releaseMode,
      releaseValidIds,
      confirmReleaseAndSignPlayer,
    ],
  );

  const toggleSellMode = useCallback(() => {
    if (!canMove) return;
    setSellMode((prev) => {
      const next = !prev;
      if (next && moveMode) setMoveMode(false);
      return next;
    });
  }, [canMove, moveMode]);

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
      // ---- Release mode overrides -------------------------------------
      // While a free-agency overflow pick is pending the rail becomes a
      // forced cull picker -- focus is pinned to the left deck, every
      // non-release input is swallowed (so a stray TRIANGLE doesn't
      // collapse the rail and hide the very chips the user needs to
      // click), and only the explicit confirm / cancel keys advance.
      // Mirrors the modal contract the legacy `RosterReleasePicker`
      // exposed, but routed entirely through the footer's existing
      // focus-router so the user never leaves the rail context.
      if (releaseMode) {
        switch (btn) {
          case 'DPAD_LEFT': {
            const list = decks.left;
            if (list.length === 0) return true;
            setFooterIndex((idx) => Math.max(0, idx - 1));
            return true;
          }
          case 'DPAD_RIGHT': {
            const list = decks.left;
            if (list.length === 0) return true;
            setFooterIndex((idx) => Math.min(list.length - 1, idx + 1));
            return true;
          }
          case 'CROSS': {
            const card = decks.left[footerIndex];
            activateCard(card);
            return true;
          }
          case 'CIRCLE':
            cancelPendingPlayerGrant();
            return true;
          default:
            // Everything else (DPAD_UP/DOWN, L1/R1, SQUARE, TRIANGLE,
            // L2) is intentionally inert during release -- the user
            // has one job, pick a player or cancel. Returning true
            // consumes the press so a higher-priority handler doesn't
            // get a second crack at it either.
            return true;
        }
      }

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
          if (sellMode) {
            // While the sell tray is open, SQUARE is the explicit exit
            // affordance so the user can bail out of selling without
            // accidentally dealing the focused card.
            setSellMode(false);
            return true;
          }
          toggleMoveMode();
          return true;
        case 'L2':
          // L2 toggles the sell tray (Bazaar parity: shoulder button
          // surfaces the "I want to sell stuff" overlay). Gated to
          // FO; entering sell mode also drops the move-mode grab so
          // the user can't accidentally swap-then-sell.
          if (!canMove) return false;
          toggleSellMode();
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
      sellMode,
      canMove,
      shiftFocused,
      toggleMoveMode,
      toggleSellMode,
      releaseMode,
      cancelPendingPlayerGrant,
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
      {sellMode && canMove && <SellTrayBanner onClose={() => setSellMode(false)} />}
      {releaseMode && (
        <ReleaseTrayBanner
          pendingLabel={pendingPlayerGrant?.label ?? 'the new signing'}
          refund={pendingPlayerGrant?.refundOnCancel ?? 0}
          onCancel={() => cancelPendingPlayerGrant()}
        />
      )}
      <FooterBand
      decks={decks}
      activeSide={activeSide}
      footerIndex={footerIndex}
      collapsed={footerCollapsed}
      focused={footerOwnsFocus}
      moveMode={moveMode}
      sellMode={sellMode && canMove}
      releaseMode={releaseMode}
      releaseValidIds={releaseValidIds}
      onSell={(instanceId) => sellItemForCash(instanceId)}
      onCardClick={(side, idx) => {
        const card = decks[side][idx];
        if (focusSurface !== 'footer') setFocusSurface('footer');
        // Release mode: clicking a left-deck player commits the cull
        // (or no-ops on an invalid target -- same gate the gamepad
        // CROSS path uses via `activateCard`). Right-deck clicks are
        // intentionally inert during release because the cull MUST
        // come out of the roster, not the bag.
        if (releaseMode) {
          if (side !== 'left') return;
          setActiveSide('left');
          setFooterIndex(idx);
          activateCard(card);
          return;
        }
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
        // Release mode keeps the active side pinned to the roster --
        // hovering the bag side would otherwise yank the focused card
        // detail off-screen mid-pick.
        if (releaseMode) return;
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
        {/* Player abilities: passive (always) + potentials with rarity-
            gated locks. Bag items / non-player cards skip the block via
            the type/id guards inside PlayerAbilitiesSection. */}
        <PlayerAbilitiesSection card={card} accent={ringColor} />
      </div>
    </div>
  );
}

/**
 * Inline subcomponent: renders the focused player's passive + the
 * full potential strip (locked slots greyed out as "???"). Bag /
 * ability cards skip rendering by returning `null`.
 */
function PlayerAbilitiesSection({
  card,
  accent,
}: {
  card: FooterCardData;
  accent: string;
}) {
  if (card.type !== 'batter' && card.type !== 'pitcher') return null;
  const player = getSznPlayer(card.id);
  if (!player) return null;
  const rarity = card.rarity ?? 'common';
  const revealed = revealedAbilities(player, rarity);
  const totalSlots = totalPotentialSlots(player);
  const revealedPotentialCount = revealed.length - 1; // first entry is passive
  const lockedCount = Math.max(0, totalSlots - revealedPotentialCount);
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-white/10 pt-2">
      <div
        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: accent }}
      >
        <span>Abilities</span>
        <span className="text-[#a6adc8] font-normal">
          ({revealedPotentialCount}/{totalSlots} potentials revealed)
        </span>
      </div>
      {revealed.map((ab, idx) => (
        <div
          key={ab.id}
          className="flex items-start gap-2 rounded bg-white/5 px-2 py-1"
        >
          <span aria-hidden className="mt-0.5 text-sm">
            {triggerGlyph(ab.trigger)}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                className="text-[11px] font-black uppercase tracking-wide"
                style={{ color: idx === 0 ? accent : '#f9e2af' }}
              >
                {ab.name}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#a6adc8]">
                {idx === 0 ? 'Passive' : `Potential ${idx}`} · {triggerLabel(ab.trigger)}
              </span>
            </div>
            {ab.effect.flavor && (
              <div className="text-[11px] leading-snug text-[#e6e6f0]">
                {ab.effect.flavor}
              </div>
            )}
          </div>
        </div>
      ))}
      {Array.from({ length: lockedCount }).map((_, i) => (
        <div
          key={`locked-${i}`}
          className="flex items-start gap-2 rounded border border-dashed border-white/10 bg-white/[0.02] px-2 py-1 opacity-60"
        >
          <span aria-hidden className="mt-0.5 text-sm text-[#6c7086]">
            ?
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-[#6c7086]">
                ???
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#6c7086]">
                Potential {revealedPotentialCount + i + 1} · Locked
              </span>
            </div>
            <div className="text-[11px] leading-snug text-[#6c7086]">
              Reveals at the next rarity tier.
            </div>
          </div>
        </div>
      ))}
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
  sellMode,
  releaseMode,
  releaseValidIds,
  onSell,
  onCardClick,
  onSideHover,
}: {
  decks: DeckState;
  activeSide: ActiveSide;
  footerIndex: number;
  collapsed: boolean;
  focused: boolean;
  moveMode: boolean;
  sellMode: boolean;
  /** True while a free-agency overflow cull is pending. Paints the
   *  left deck with the RELEASE overlay + locks the active side. */
  releaseMode: boolean;
  /** Player ids that survive the role-floor check (`sameRoleCount > 1
   *  || incoming.role === slot.role`). Slots not in this set render
   *  as disabled release targets so CROSS / click no-op gracefully. */
  releaseValidIds: Set<string>;
  onSell: (instanceId: string) => void;
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
        sellMode={false}
        releaseMode={releaseMode}
        releaseValidIds={releaseValidIds}
        onSell={onSell}
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
        sellMode={sellMode}
        // Right deck is non-actionable during release -- no overlay
        // paints there and no slot is a valid target.
        releaseMode={false}
        releaseValidIds={EMPTY_RELEASE_SET}
        onSell={onSell}
        onCardClick={(idx) => onCardClick('right', idx)}
        onHover={() => onSideHover('right')}
      />
    </div>
  );
}

// Stable empty set so the right deck's release props don't churn the
// memoization on every render (Set identity matters for the per-card
// `releaseDisabled` derived bool).
const EMPTY_RELEASE_SET: Set<string> = new Set();

function RowContainer({
  label,
  side,
  active,
  cards,
  focusedIndex,
  moveMode,
  sellMode,
  releaseMode,
  releaseValidIds,
  onSell,
  onCardClick,
  onHover,
}: {
  label: string;
  side: ActiveSide;
  active: boolean;
  cards: FooterCardData[];
  focusedIndex: number;
  moveMode: boolean;
  sellMode: boolean;
  /** True only on the left row while a free-agency cull is pending. */
  releaseMode: boolean;
  /** Player ids the cull picker considers valid release targets. */
  releaseValidIds: Set<string>;
  onSell: (instanceId: string) => void;
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
        // Stable id so encounter views (Merchant, Event) can measure
        // the abilities-row rect and animate a purchased / claimed
        // card into its final resting position. Side is encoded in the
        // id so the same lookup pattern works for any future "fly
        // into the player rail" affordance (e.g. Player Market signs).
        id={`szn-footer-row-${side}`}
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
              // Release target = a roster player chip on the left row
              // while a cull is pending. Items on the right row never
              // qualify -- the cull MUST come out of the roster.
              const isReleaseTarget =
                releaseMode && card.type !== 'ability';
              const releaseDisabled =
                isReleaseTarget && !releaseValidIds.has(card.id);
              return (
                <Card
                  key={card.id}
                  card={card}
                  focused={focused}
                  moveMode={moveMode}
                  sellMode={sellMode}
                  releaseTarget={isReleaseTarget}
                  releaseDisabled={releaseDisabled}
                  onSell={() => onSell(card.id)}
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

/**
 * Does this footer card share a connectable edge with the encounter
 * card the user is currently focused on? Drives the "compat lift"
 * visual treatment below so the user can see at a glance which roster
 * / bag chips would chain off the encounter listing they're eyeing.
 *
 * Returns true when ANY directional snap check passes:
 *   - focused card sits left of footer card  (focused.right ↔ footer.left)
 *   - footer card sits left of focused card  (footer.right ↔ focused.left)
 *
 * `null` edges (legacy chips, blank slots) are treated as non-matching.
 * The compat check skips cards that are already in a louder visual
 * state (focused, grabbed, seated) so we never stack hints on top of
 * affordances the user is actively working with.
 */
function isCompatibleWithEncounter(
  card: FooterCardData,
  focusEdges: { leftEdge: SznEdgeId | null; rightEdge: SznEdgeId | null } | null,
): boolean {
  if (!focusEdges) return false;
  const fLeft = focusEdges.leftEdge;
  const fRight = focusEdges.rightEdge;
  const cLeft = card.leftEdge;
  const cRight = card.rightEdge;
  if (fRight && cLeft && canSznSnap(fRight, cLeft)) return true;
  if (cRight && fLeft && canSznSnap(cRight, fLeft)) return true;
  return false;
}

function Card({
  card,
  focused,
  moveMode,
  sellMode,
  releaseTarget,
  releaseDisabled,
  onSell,
  onClick,
}: {
  card: FooterCardData;
  focused: boolean;
  moveMode: boolean;
  sellMode: boolean;
  /** True when a free-agency cull is pending AND this is a roster
   *  chip on the left row. Paints the red "RELEASE" overlay and
   *  routes clicks through to `confirmReleaseAndSignPlayer` upstream. */
  releaseTarget: boolean;
  /** True when releasing this slot would leave its role empty (and
   *  the incoming player doesn't backfill it). Renders dimmed +
   *  non-interactive so the user gets the same dead-click feedback
   *  the store-side gate would silently produce. */
  releaseDisabled: boolean;
  /** Direct sell handler (fires when the user clicks the per-card $
   *  chip OR taps the card while sell mode is on). */
  onSell: () => void;
  onClick: () => void;
}) {
  // Encounter compatibility hint. Encounter views (Merchant, Player
  // Market) push the edges of the focused listing to
  // `encounterFocusEdges`; any footer card whose edge can SZN-snap to
  // either side of that listing pops up a notch with an emerald glow
  // so the user can immediately see "these chips chain off the thing
  // I'm eyeing". Suppressed during move-mode / focus / seated so the
  // hint never fights louder affordances the user is operating on.
  const encounterFocusEdges = useGameStore((s) => s.encounterFocusEdges);
  const compatible =
    !moveMode &&
    !releaseTarget &&
    !focused &&
    card.state !== 'seated' &&
    card.state !== 'disabled' &&
    isCompatibleWithEncounter(card, encounterFocusEdges);
  // Player chips paint with a RARITY gradient (copper / silver /
  // gold / cosmic) so the rail scans as tiering at a glance --
  // matches the at-bat `PlayerCard` and `<SznCard>` now that the
  // audit pulled team color off the card body. The team is still
  // legible via the team-code chip painted in the top-left corner
  // (see `card.teamCode` block further down). Ability chips paint
  // per-`abilityType` via the shared `abilityCardGradient` helper
  // (in `cardDisplay.ts`) -- previously this file kept its own
  // inline `linear-gradient(135deg, #89b4fa, #74c7ec)` copy that
  // made every Encounter Item / Signature / General Draw read as
  // the same blue chip. The shared helper also layers a tier
  // overlay (silver / gold) on top of the ability-type body.
  // Falls back to the legacy red / green role tints only when
  // neither rarity nor team is available (legacy quick-match
  // rosters); `roleTag` carries the role distinction for player
  // chips regardless of which gradient we land on.
  let gradient: string;
  if (card.type !== 'ability' && card.rarity) {
    const { primary, secondary } = RARITY_GRADIENT[card.rarity];
    gradient = `linear-gradient(135deg, ${primary}, ${secondary})`;
  } else if (card.type === 'ability') {
    const { primary, secondary, overlay } = abilityCardGradient(
      card.abilityType,
      card.itemTier ?? null,
    );
    gradient = overlay
      ? [
          `linear-gradient(135deg, ${overlay.primary}, ${overlay.secondary})`,
          `linear-gradient(135deg, ${primary}, ${secondary})`,
        ].join(', ')
      : `linear-gradient(135deg, ${primary}, ${secondary})`;
  } else if (card.teamCode) {
    const palette = teamPalette(card.teamCode);
    gradient = `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`;
  } else {
    gradient =
      card.type === 'batter'
        ? 'linear-gradient(135deg, #e53935, #ef5350)'
        : 'linear-gradient(135deg, #15803d, #4ade80)';
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

  // ItemTier is going to be needed for the corner glyph below — declared
  // up here so the variable is in scope for both the style block and
  // the corner-chip render. Same goes for the sell-target gate: it's
  // computed once up top because the border/shadow/transform block
  // and the JSX below both branch on it.
  const itemTier: ItemTier | null = card.type === 'ability' ? (card.itemTier ?? 'bronze') : null;
  const isSellTarget = sellMode && card.type === 'ability';
  // Release-target chips get the same red treatment as sell targets
  // (border / shadow / overlay) but with a "RELEASE" callout instead
  // of a sell price, since the cost of a release is one roster slot,
  // not cash. Invalid release targets (would leave a role empty) get
  // the same red border but desaturated body + grey overlay so the
  // user can see the slot exists but can't pick it.
  const borderColor = isSellTarget || (releaseTarget && !releaseDisabled)
    ? '#f87171' /* red sell- or release-target */
    : releaseTarget && releaseDisabled
      ? 'rgba(248,113,113,0.45)' /* dimmed red -- role-locked release */
      : isGrabbed
        ? '#cba6f7' /* purple grab */
        : focused
          ? '#f9e2af' /* yellow focus */
          : isSeated
            ? '#fbbf24'
            : compatible
              ? '#a6e3a1' /* emerald compat hint */
              : isInventory
                ? 'rgba(255,255,255,0.18)'
                : isActionable
                  ? 'rgba(255,255,255,0.12)'
                  : 'transparent';
  const shadow = isSellTarget || (releaseTarget && !releaseDisabled)
    ? '0 10px 18px rgba(248,113,113,0.45)' /* red sell / release glow */
    : isGrabbed
      ? '0 15px 20px rgba(203,166,247,0.5)' /* purple drop shadow */
      : focused
        ? '0 10px 15px rgba(249,226,175,0.4)'
        : isSeated
          ? '0 6px 12px rgba(251,191,36,0.45)'
          : compatible
            ? '0 10px 18px rgba(166,227,161,0.45)' /* emerald compat glow */
            : '0 4px 6px rgba(0,0,0,0.3)';
  const transform = isGrabbed
    ? 'translateY(-25px) scale(1.05)' /* extra lift + scale */
    : focused
      ? 'translateY(-15px)'
      : compatible
        ? 'translateY(-12px) scale(1.03)' /* compat lift -- between rest + focused */
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

  // Sell mode short-circuits the normal click semantics for item
  // cards -- a click commits the sale instead of dealing. Player
  // cards stay on their normal swap rail (sell mode is
  // ability-only). The tray banner above tells the user CIRCLE /
  // SQUARE exits.
  return (
    <button
      type="button"
      // Click semantics:
      //   - Sell mode (ability cards): commit the sale and refund cash.
      //   - Move mode: the parent handler swaps the grabbed (focused)
      //     card with this card and re-focuses to follow the swap.
      //     Forward unconditionally so non-actionable cards (a seated
      //     player) can still be swapped during move mode.
      //   - Outside both modes: only actionable cards fire the
      //     deal/swap call.
      onClick={
        isSellTarget
          ? onSell
          : releaseTarget
            ? releaseDisabled
              ? undefined
              : onClick
            : moveMode
              ? onClick
              : isActionable
                ? onClick
                : undefined
      }
      // Only hard-disable cards the user genuinely can't use right
      // now (wrong role for the current seat OR a role-locked
      // release target). Inventory and seated cards stay focusable
      // so the user can navigate to them and read their tooltip /
      // inspect their edges. In move mode we never disable so every
      // card stays a swap target. In sell mode every ability card is
      // interactive (and players stay clickable for context / focus
      // tracking).
      disabled={
        (!moveMode && !isSellTarget && !releaseTarget && isDisabled) ||
        (releaseTarget && releaseDisabled)
      }
      title={
        isSellTarget
          ? `Sell ${card.label ?? card.id} for $${card.sellValue ?? 0}`
          : releaseTarget
            ? releaseDisabled
              ? `${card.label ?? card.id} — only ${card.type === 'pitcher' ? 'pitcher' : 'batter'} on roster; cancel or pick a different slot`
              : `Release ${card.label ?? card.id} to free a roster slot`
            : moveMode
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
        zIndex: isGrabbed ? 20 : focused ? 10 : isSeated ? 5 : compatible ? 4 : 1,
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
      {/* Bazaar tier glyph on ability cards. Bronze items still get a
          chip so the system reads as "items have tiers" even before
          the user upgrades anything; the tint shifts brown→silver→
          gold so the upgrade story is legible at a glance. Suppressed
          when sell mode paints the red overlay (the overlay needs the
          whole face for the SELL/$X readout). */}
      {itemTier && !isSellTarget && (
        <span
          aria-hidden
          className="absolute top-1 left-1 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-900 shadow-sm"
          style={{ background: TIER_TINT[itemTier] }}
        >
          {TIER_GLYPH[itemTier]}
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
      {pip && !isSellTarget && (
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
      {/* Sell-mode overlay: paints the whole card face with a red
          translucent gradient + a giant "SELL $X" callout so the user
          confirms the action visually. Only ability cards opt in --
          player sells live in a different tray entirely. */}
      {isSellTarget && (
        <div
          aria-hidden
          className="absolute inset-0 flex flex-col items-center justify-center rounded-md pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(248,113,113,0.55), rgba(127,29,29,0.85))',
          }}
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-white">
            Sell
          </span>
          <span className="text-2xl font-black text-white drop-shadow">
            ${card.sellValue ?? 0}
          </span>
        </div>
      )}
      {/* Release-mode overlay: same red treatment as sell, but the
          callout reads "RELEASE" / "CUT" so the user understands the
          cost is a roster slot (not cash). Disabled targets paint a
          darker / grey overlay so the user can see why the slot
          can't be picked (role floor). */}
      {releaseTarget && (
        <div
          aria-hidden
          className="absolute inset-0 flex flex-col items-center justify-center rounded-md pointer-events-none"
          style={{
            background: releaseDisabled
              ? 'linear-gradient(180deg, rgba(71,85,105,0.55), rgba(15,23,42,0.85))'
              : 'linear-gradient(180deg, rgba(248,113,113,0.55), rgba(127,29,29,0.85))',
          }}
        >
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white">
            {releaseDisabled ? 'Locked' : 'Release'}
          </span>
          <span className="text-lg font-black uppercase tracking-widest text-white drop-shadow">
            {releaseDisabled ? 'Last' : 'Cut'}
          </span>
          {releaseDisabled && (
            <span className="text-[8px] font-bold uppercase tracking-widest text-slate-300">
              {card.type === 'pitcher' ? 'Pitcher' : 'Batter'}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * Mini info banner that floats just above the footer band whenever
 * the sell tray is open. Tells the user what's happening + offers a
 * mouse-clickable exit (the gamepad path is SQUARE / CIRCLE). Painted
 * red so it visually pairs with the SELL $X overlays on the rail.
 *
 * Anchored at `bottom: FOOTER_HEIGHT_PX + 12` to clear the focused-
 * card detail (also above the footer); we drop a few z-indices lower
 * than the detail so the description still wins when both render.
 */
function SellTrayBanner({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[9999] -translate-x-1/2"
      style={{ bottom: `${FOOTER_HEIGHT_PX + 92}px` }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-rose-400/40 bg-rose-950/85 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-rose-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur">
        <span>Sell Tray Open · Click an item to sell</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-rose-300/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-rose-100 hover:bg-rose-800/60"
        >
          Done (L2)
        </button>
      </div>
    </div>
  );
}

/**
 * Release-tray callout that floats above the footer while a free-
 * agency cull is pending. Tells the user which sign is queued + how
 * much cash they'll get back if they bail. Cancel routes through
 * `cancelPendingPlayerGrant` (refunds the listing price in full --
 * pulling out of a sign is cost-neutral, mirroring the modal's old
 * contract).
 *
 * Same anchor + z-index as the sell tray banner so the two overlays
 * never stack visually (they're mutually exclusive at the gameStore
 * level too: release pinning the focus to the left deck disables
 * sell mode in the same effect).
 */
function ReleaseTrayBanner({
  pendingLabel,
  refund,
  onCancel,
}: {
  pendingLabel: string;
  refund: number;
  onCancel: () => void;
}) {
  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[9999] -translate-x-1/2"
      style={{ bottom: `${FOOTER_HEIGHT_PX + 92}px` }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-rose-400/40 bg-rose-950/85 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-rose-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur">
        <span>
          Roster Full · Cut a player to sign{' '}
          <span className="text-amber-200">{pendingLabel}</span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-rose-300/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-rose-100 hover:bg-rose-800/60"
        >
          Cancel · ${refund} (CIRCLE)
        </button>
      </div>
    </div>
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
