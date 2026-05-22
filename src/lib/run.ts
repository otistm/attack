/**
 * SZN Mode run state — the 12-week single-player run.
 *
 * Core flow:
 *   pack-rip -> Mon..Thu Front Office (1–3 encounters/day) -> Fri-Sun Bo3 series
 *   vs locally generated Ghost -> +win or +loss -> next week, or run end at
 *   10W (champion) or 3L (fired).
 *
 * Combat reuses the existing chain-connecting at-bat engine. Items in the
 * bag are referenced by `CardDefinition.id`; the player at the plate is the
 * connection root. SZN players carry semantic `leftEdge` / `rightEdge`
 * sockets from `sznEdges.ts`; legacy Quick Match / Draft players keep
 * their shape sockets.
 */

import type { BadgeId } from "./badges";
import type { CardDefinition } from "./cards";
import type { MlbPlayer } from "./players";
import type { SznPlayer } from "./sznPlayers";
import type { MlbTeamId } from "./sznTeams";
// Type-only import keeps the build cycle-free at runtime (scouting.ts
// also imports from run.ts for `RunState` / `EncounterOffer`). The
// scouting report type lives in `scouting.ts` because that's where
// it's *authored*; we re-export it here so `RunState` consumers
// don't need a second import path.
import type { WeeklyScoutingReport } from "./scouting";
export type { WeeklyScoutingReport };
/** @deprecated Renamed to {@link WeeklyScoutingReport}. */
export type WeekendScouting = WeeklyScoutingReport;

/**
 * SZN Mode card rarity. Replaces the legacy bronze/silver/gold/diamond
 * tier with the rebranded Common -> All Star -> Veteran -> Legend path.
 * The numerical curve and gameplay role are unchanged; only the labels +
 * id strings rotated.
 *
 * NOTE: `Rarity.veteran` is distinct from the `Veteran` ClassTag and from
 * the `veteran-tag` SznEdgeId. Three different namespaces, same word.
 */
export type Rarity = "common" | "allstar" | "veteran" | "legend";

/**
 * Player class tag — drives team-wide synergy when enough **adjacent** roster
 * players share a tag (see `synergies.ts`). One tag per player; assigned
 * deterministically off the player's id (see `players.ts`).
 */
export type ClassTag =
  | "Slugger"
  | "Speedster"
  | "Contact"
  | "Veteran"
  | "Rookie"
  | "Closer"
  | "Starter"
  | "Control"
  | "Strikeout"
  | "Groundball";

export const RARITY_ORDER: Rarity[] = ["common", "allstar", "veteran", "legend"];

export function nextRarity(r: Rarity): Rarity | null {
  const i = RARITY_ORDER.indexOf(r);
  if (i < 0 || i >= RARITY_ORDER.length - 1) return null;
  return RARITY_ORDER[i + 1];
}

/**
 * Per-rarity base value the player at the plate contributes to combat. Items
 * stack on top via the existing chain-scoring engine.
 */
export const RARITY_BASE_VALUE: Record<Rarity, number> = {
  common: 4,
  allstar: 7,
  veteran: 11,
  legend: 16,
};

/**
 * One slot on the 10-man roster. The roster is 9 batters + 1 pitcher; the
 * pitcher is treated as the "fielder" the user controls during the half
 * they're on defense.
 *
 * `player` is a union to accommodate both the legacy `MlbPlayer` (Quick
 * Match / Auction Draft) and the new SZN-specific `SznPlayer` carrying
 * semantic edges. Use `isSznPlayer` to discriminate at call sites that
 * care about edge vs. shape sockets.
 */
export interface RosterPlayer {
  /** Source player record. */
  player: MlbPlayer | SznPlayer;
  rarity: Rarity;
  /** Frozen at run-start; doesn't change with merges. */
  tag: ClassTag;
  /**
   * Optional permanent base-score boost applied on top of `RARITY_BASE_VALUE`.
   * Set when a `rookie`-edged card snaps into this player's `veteran-tag`
   * left edge during scoring (see Yankees DJ LeMahieu mechanic). Each
   * snapping-rookie pair counts only once per run, tracked by
   * {@link RunState.veteranBoostedBy}.
   */
  permanentBoost?: number;
  /**
   * Encounter-applied edge overrides. When present, `playerAsCard` reads
   * these ahead of the static `SznPlayer.leftEdge` / `rightEdge`. Lets
   * Wildcard Sticker, Swing Adjuster, City Connect Jersey, etc. mutate
   * what a player snaps with for the rest of the run without touching
   * the immutable `SznPlayer` defs.
   */
  leftEdgeOverride?: import("./sznEdges").SznEdgeId;
  rightEdgeOverride?: import("./sznEdges").SznEdgeId;
  /**
   * Encounter-applied permanent base-score offset. Stacks on top of
   * `RARITY_BASE_VALUE` + `permanentBoost`. Examples:
   *   - Special Dirt: +30 to the chosen pitcher for the rest of the run.
   *   - Statcast Optimizer: +baseScore (and blank the other edge) on a batter.
   *   - Drip Cleats / Corked Bat one-shot bonuses are NOT here (they
   *     fire per-snap in scoring, not as a permanent player tweak).
   */
  scoreOverride?: number;
}

/**
 * Purchased item instance that lives in the manager's bag. References the
 * existing CardDefinition catalog by id; the card's `baseValue`, shapes, and
 * (later) ability fields are the items's combat data.
 *
 * Tier: Bazaar-inspired progression. Items always enter the bag at
 * `bronze` (the printed values). Buying a duplicate at a merchant
 * upgrades the owned copy one rung — bronze → silver → gold — instead
 * of failing the buy with a "DUPLICATE" early-return. Silver / gold
 * scale BOTH the printed `baseValue` and the numeric outputs of the
 * card's effect hooks (see {@link applyTierMultiplier} in
 * `itemTiers.ts`). Optional on persisted save loads — readers default
 * absent tiers to `"bronze"` to keep legacy bag entries valid.
 */
export interface Item {
  instanceId: string;
  cardId: string;
  /** Defaults to `"bronze"` when absent on legacy saves. */
  tier?: import("./itemTiers").ItemTier;
}

export type DayOfWeek = "mon" | "tue" | "wed" | "thu";
export const FRONT_OFFICE_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu"];

export type WeekDay = DayOfWeek | "series";

/** Merchant personas. */
export type MerchantId =
  | "scouting_director"
  | "shady_trainer"
  | "equipment_manager"
  | "concessions";

export const MERCHANT_LABEL: Record<MerchantId, string> = {
  scouting_director: "Scouting Director",
  shady_trainer: "Shady Trainer",
  equipment_manager: "Equipment Manager",
  concessions: "Concessions",
};

export const MERCHANT_BLURB: Record<MerchantId, string> = {
  scouting_director: "Roster duplicates and high-rarity replacements.",
  shady_trainer: "High-risk, high-reward items.",
  equipment_manager: "Bats, gloves, and gear cards.",
  concessions: "Cheap utility items and stadium snacks.",
};

/**
 * Narrative event ids. Free-form strings so the encounter table in
 * `sznEncounters.ts` can register its 20 spec encounters by stable id
 * (`enc-yard-sale`, `enc-banging-scheme`, etc.) without each one
 * needing its own enum branch.
 *
 * Legacy ids `ringing_phone` / `microphone` / `injury_report` still
 * appear in the `EVENT_LABEL` / `EVENT_BLURB` maps for backward
 * compatibility with persisted saves.
 */
export type EventId = string;

/**
 * Display labels keyed by `EventOffer.eventId`. The first three rows are
 * the original legacy event suite (kept for save-file compatibility — the
 * encounter dispatcher no longer rolls them, but persisted in-flight
 * `weekEncounters` may still reference them); everything below is the
 * SZN-spec encounter suite registered in `sznEncounters.ts`.
 *
 * Source of truth for BOTH the Front Office encounter tile and the
 * `EventEncounterView` modal header. Adding a new SZN encounter requires
 * adding an entry here too — without it the tile and modal both render
 * blank.
 */
export const EVENT_LABEL: Record<string, string> = {
  ringing_phone: "Ringing Phone",
  microphone: "Microphone",
  injury_report: "Injury Report",

  "enc-yard-sale": "Yard Sale",
  "enc-friendly-trade": "Friendly Trade",
  "enc-private-coach": "Private Coach",
  "enc-mystery-box": "Mystery Box",
  "enc-international-pipeline": "International Pipeline",
  "enc-old-school-gm": "Old-School GM",
  "enc-suspicious-grandpa": "Suspicious Grandpa",
  "enc-clubhouse-prank": "Clubhouse Prank",
  "enc-defense-charity": "Defense Charity",
  "enc-shady-radio-host": "Shady Radio Host",
  "enc-rain-delay": "Rain Delay",
  "enc-streetball": "Streetball Legend",
  "enc-vacant-lot": "Vacant Lot",
  "enc-mlb-loophole": "MLB Loophole",
  "enc-museum": "Baseball Museum",
  "enc-pro-shop": "Stadium Pro Shop",
  "enc-rival-clubhouse": "Rival Clubhouse",
  "enc-cinderella-camp": "Cinderella Camp",
};

export const EVENT_BLURB: Record<string, string> = {
  ringing_phone: "A rival GM has a trade offer.",
  microphone: "Press wants a comment. Spin it.",
  injury_report: "Trainer rushes in with grim news.",

  "enc-yard-sale": "An equipment manager peddles odds and ends — cheap.",
  "enc-friendly-trade": "A buddy GM dangles clubhouse leftovers.",
  "enc-private-coach": "Off-season player development from a retired pro.",
  "enc-mystery-box": "A sealed warehouse crate. Worth the gamble?",
  "enc-international-pipeline": "Paperwork on overseas free agents lands on your desk.",
  "enc-old-school-gm": "A grizzled GM dangles a creative trade.",
  "enc-suspicious-grandpa": "A wiry old man swears his memorabilia is lucky.",
  "enc-clubhouse-prank": "Rookie prank war derails the locker room.",
  "enc-defense-charity": "Defensive specialists collecting signatures.",
  "enc-shady-radio-host": "Late-night radio wants an interview — with edge.",
  "enc-rain-delay": "Rain delay. The team starts a poker game.",
  "enc-streetball": "A streetball legend flags you down outside the park.",
  "enc-vacant-lot": "Grounds crew offers shady clubhouse turf.",
  "enc-mlb-loophole": "Your lawyer found something interesting in the bylaws.",
  "enc-museum": "A relic for your roster — in exchange for a display.",
  "enc-pro-shop": "Fresh gear in the back room.",
  "enc-rival-clubhouse": "A rival GM's office is empty. The binder is open.",
  "enc-cinderella-camp": "Free crate from your minor-league camp.",
};

/**
 * Single-emoji thumbnail per event id. Shared by the Front Office
 * encounter tile (`FrontOfficeScreen`) and the `EventEncounterView`
 * modal header so the visual identity is identical across both
 * surfaces. Falls back to a generic die in callers when the id is
 * unmapped (legacy events not yet glyph'd).
 */
export const EVENT_GLYPH: Record<string, string> = {
  ringing_phone: "📞",
  microphone: "🎙️",
  injury_report: "🩼",

  "enc-yard-sale": "🛒",
  "enc-friendly-trade": "🤝",
  "enc-private-coach": "🥎",
  "enc-mystery-box": "📦",
  "enc-international-pipeline": "🌍",
  "enc-old-school-gm": "🗂️",
  "enc-suspicious-grandpa": "👴",
  "enc-clubhouse-prank": "🤡",
  "enc-defense-charity": "🛡️",
  "enc-shady-radio-host": "📻",
  "enc-rain-delay": "☔",
  "enc-streetball": "🏙️",
  "enc-vacant-lot": "🪣",
  "enc-mlb-loophole": "⚖️",
  "enc-museum": "🏛️",
  "enc-pro-shop": "🧤",
  "enc-rival-clubhouse": "🕵️",
  "enc-cinderella-camp": "🍀",
};

/** Stall listing the user can buy. */
export interface MerchantListing {
  /** Stable id for React keys + purchase routing. */
  listingId: string;
  /** Card to acquire as an Item. */
  cardId: string;
  price: number;
  /**
   * If set, this listing is a roster-rarity upgrade or replacement keyed to
   * a specific player + rarity. Buying it consumes the existing common/all-star
   * roster instance and bumps the rarity.
   */
  rosterUpgrade?: {
    playerId: string;
    /** Which rarity the duplicate represents (the user's roster is 1 rarity below). */
    duplicateRarity: Rarity;
    /** True for "buy this same player at the next rarity directly" listings. */
    isReplacement: boolean;
  };
}

export interface MerchantOffer {
  kind: "merchant";
  merchantId: MerchantId;
  listings: MerchantListing[];
  /**
   * Optional display overrides for SZN themed merchants (Hobby Shop,
   * Clearance Bin, etc.) that piggy-back on a base persona's pricing
   * curve but want their own identity on the Front Office tile and
   * `MerchantView` header. When omitted, the existing `MERCHANT_LABEL`
   * / `MERCHANT_BLURB` / merchant-glyph defaults apply.
   */
  displayLabel?: string;
  displayBlurb?: string;
  displayGlyph?: string;
  /**
   * SZN-themed merchants (Hobby Shop -> equipment_manager, Clearance
   * Bin -> concessions, etc.) carry the originating SZN encounter id
   * here so the dedupe namespace stays disambiguated from the legacy
   * Front Office merchant injection. Without this field, two distinct
   * encounters that happen to reuse the same `merchantId` would
   * silently collapse into the same dedupe key -- seeing Hobby Shop
   * on Monday would block the legacy Equipment Manager from rolling
   * on Tuesday, even though they're different encounters with
   * different stock.
   *
   * Optional: legacy merchant injections (Scouting Director, plain
   * Equipment Manager, plain Concessions, Shady Trainer) leave this
   * undefined so they share the original `merchant:<merchantId>`
   * dedupe namespace as before.
   */
  sznEncounterId?: string;
  /**
   * How many times the user has rerolled this merchant's stock
   * during the current visit. The Reroll Stock CTA in `MerchantView`
   * disables once this hits {@link MERCHANT_REROLLS_PER_VISIT}.
   * Optional on persisted saves — undefined treated as 0.
   */
  rerollsUsed?: number;
}

/** Outcome branches the user can pick on a narrative event. */
export interface EventChoice {
  choiceId: string;
  label: string;
  /** Player-facing flavor for the consequence. */
  resultBlurb: string;
  /** Effect applied when chosen. */
  effect: EventEffect;
  /**
   * When set, picking this choice opens a picker FIRST. The picker's
   * result is passed back as `targetPlayerId` to `resolveEventChoice`.
   *   - `"player"`    : generic roster player picker.
   *   - `"batter"`    : roster picker filtered to Batters.
   *   - `"pitcher"`   : roster picker filtered to Pitchers.
   *   - `"edgeSwap"`  : two-step EdgeSwapPicker.
   *   - `"release"`   : (legacy) full-screen release picker. Replaced
   *                     by the SZN footer rail's release mode; kept
   *                     in the type for back-compat with any future
   *                     event encounter that needs a modal cull.
   * Omit for choices that resolve immediately.
   */
  requiresPicker?: "player" | "batter" | "pitcher" | "edgeSwap" | "release";
  /**
   * Optional cost preview shown on the button when set; UI-only.
   * Encounter dispatcher does NOT charge this -- the effect itself
   * carries any cash delta.
   */
  costPreview?: number;
  /** UI-only: render as "COMING SOON" disabled button. */
  locked?: boolean;
}

export type EventEffect =
  | { kind: "cash"; delta: number }
  | { kind: "addItemRandom"; pool: "any" | "batting" | "pitching" }
  | { kind: "removeRandomItem" }
  /**
   * Grant a specific encounter item by `CardDefinition.id`. Used by the
   * 20 spec encounters (Wildcard Sticker, Legal Rosin, etc.) so the
   * grant is deterministic instead of rolling from the random pool.
   */
  | { kind: "grantItem"; cardId: string }
  /**
   * Mutate an existing roster player's edge in place. `side: "both"`
   * stamps the edge on both sides (City Connect Jersey). `alsoBlank`
   * blanks the OPPOSITE side after stamping (Statcast Optimizer).
   * `playerId` is filled in by the picker before dispatch.
   */
  | {
      kind: "mutateRosterEdge";
      playerId: string;
      side: "left" | "right" | "both";
      edge: import("./sznEdges").SznEdgeId;
      alsoBlank?: "left" | "right";
    }
  /**
   * Swap a single player's left/right edges (Swing Adjuster).
   * `playerId` filled in by the picker.
   */
  | { kind: "swapPlayerEdges"; playerId: string }
  /**
   * Add a permanent +delta to a single player's base score
   * (Special Dirt, Statcast Optimizer's bonus value).
   */
  | { kind: "scoreOverridePlayer"; playerId: string; delta: number }
  /** One-game boost applied to every roster player's score. */
  | { kind: "boostNextGameAll"; delta: number }
  /** Permanent +delta to every roster player's base score. */
  | { kind: "permanentBoostAll"; delta: number }
  /** Add a passive badge for the rest of the run. */
  | { kind: "addBadge"; badgeId: BadgeId }
  /** Toggle Karma Double-Trigger on/off. */
  | { kind: "setKarmaDouble"; on: boolean }
  /** Queue N defense-shield consumption tokens. */
  | { kind: "queueDefenseShields"; count: number }
  /** Banging Scheme — peek opponent's first card for N weeks. */
  | { kind: "queueBangingScheme"; weeks: number }
  /** Cash payout deferred to the next week's rollover. */
  | { kind: "queueNextWeekCash"; delta: number }
  /** Rally Fire aura active for N upcoming weeks. */
  | { kind: "queueRallyFire"; weeks: number }
  /** Randomly randomize N players' edges (Clubhouse Prank chaos). */
  | { kind: "randomizeRosterEdges"; count: number }
  /** Suspend the next series' top scorer on the named side(s). */
  | { kind: "suspendTopScorers"; sides: ("Batting" | "Pitching")[] }
  /**
   * Cash wager. `winPayout` is the net payout when the user wins;
   * `loseExhaustsPitcher: true` documents that the loss outcome
   * suspends the user's pitcher (handled in the dispatcher).
   */
  | { kind: "pokerCashWager"; bet: number; winPayout: number; loseExhaustsPitcher: true }
  /**
   * Player-card wager. On win → granted player gets wildcard/wildcard.
   * On loss → player is removed AND replaced by a 0-score Common.
   */
  | { kind: "pokerPlayerWager"; playerId: string }
  | { kind: "noop" };

export interface EventOffer {
  kind: "event";
  eventId: EventId;
  prompt: string;
  choices: EventChoice[];
}

/**
 * A "Player Market" listing — a fresh MLB player the user can sign onto
 * the roster for cash. Players sold this way always come in at Common and
 * inherit their intrinsic class tag.
 */
export interface PlayerMarketListing {
  listingId: string;
  playerId: string;
  /** Always "common" for v1, but typed forward in case promotions sell rarities. */
  rarity: Rarity;
  price: number;
}

export interface PlayerMarketOffer {
  kind: "playerMarket";
  /** Display label e.g. "Free Agency". */
  label: string;
  blurb: string;
  listings: PlayerMarketListing[];
}

export type EncounterOffer = MerchantOffer | EventOffer | PlayerMarketOffer;

/**
 * Encounter slots for one Front Office day. The slate refreshes after every
 * pick; {@link pickBudget} controls how many slots (and picks) the day has
 * (1–2, rolled per week).
 */
export interface DayEncounters {
  day: DayOfWeek;
  /** Length matches {@link dayPickBudget} for this day. */
  offers: EncounterOffer[];
  /** 0..pickBudget; auto-advances the day at the cap. */
  picksUsed: number;
  /**
   * 1 to 2 encounter slots for this day. Rolled once per week via
   * {@link rollWeekPickBudgets}. Omit on older persisted runs → clamped
   * to {@link MAX_PICKS_PER_DAY}.
   */
  pickBudget?: number;
}

/**
 * One game inside the weekend Bo3. Tracks which game we're on and the
 * series tally. The current at-bat lives in the rest of GameState
 * (batter/pitcher/handed) — this slice is the meta-controller.
 */
export interface SeriesState {
  /** 0/1/2 (best of 3). */
  gameIndex: number;
  /** Wins toward this series (first to 2 wins the series). */
  userGameWins: number;
  ghostGameWins: number;
  /**
   * Cumulative runs scored across played games this series. Used as
   * the tiebreaker when ties produce equal `userGameWins`/`ghostGameWins`
   * at series end (e.g. user 1-W / 1-D / 1-L vs ghost 1-W / 1-D / 1-L).
   * Optional for older saves: deserialized runs default to 0.
   */
  userRunsTotal?: number;
  ghostRunsTotal?: number;
  /**
   * True while the live at-bat engine is mid-game. False between games
   * (intro splash showing) so App.tsx can route to the SeriesIntroScreen
   * instead of showing the gameplay overlay.
   */
  gameInProgress: boolean;
}

/** Minimal procedurally-generated opponent for one weekend series. */
export interface GhostSnapshot {
  /** Display name for the screen ("Ghost: Hoboken Hounds"). */
  label: string;
  roster: RosterPlayer[];
  itemBag: Item[];
}

// (The Monday scouting report type is declared at the top of this
// file as a re-export from `scouting.ts`. It used to live inline
// here as `WeekendScouting` -- see the deprecated alias above the
// re-export for backwards-compat.)

export const RUN_WIN_TARGET = 10;
export const RUN_LOSS_LIMIT = 3;
export const STARTER_PACK_BATTERS = 7;
export const STARTER_PACK_PITCHERS = 3;
export const STARTER_PACK_TOTAL = STARTER_PACK_BATTERS + STARTER_PACK_PITCHERS;
// Bumped from $10 → $14 so the user can clear 3 cheap items on day one
// (instead of the old 2-item ceiling). Pairs with the Week-1 listing
// floor drop in `items.ts` (min $1) to widen the early-week shopping
// surface without making any single item feel disposable.
export const STARTER_CASH = 14;
/**
 * Legacy flat weekly stipend, retained as a fallback constant for any
 * caller that still wants a "what's the base weekly cash flow?" number
 * (UI tooltips, balance docs). The live `reportSeriesGameResult`
 * payout has been split into the per-result components below
 * ({@link SERIES_BASE_PAYOUT} + {@link SERIES_WIN_BONUS} +
 * streak/comeback bonuses). A typical winning week with a streak still
 * pays out in the same ~$16-20 neighborhood the old flat number sat
 * at; losses now pay only the appearance fee.
 */
export const WEEKLY_CASH = 16;

/**
 * Series-payout components (Bazaar-style "appearance fee + win bonus
 * + streak bonus + comeback bonus"). Replaces the old flat
 * {@link WEEKLY_CASH} payout in `reportSeriesGameResult`.
 *
 * Curve goals:
 *   - Losses always pay $8 (the user keeps building, no death-spiral).
 *   - Single wins pay the same $16 the old flat curve did.
 *   - Hot streaks reward sustained play (+$2 per consecutive win,
 *     capped so a perfect run can't snowball the price curve into
 *     irrelevance).
 *   - Comeback bonus (after a 2+ loss skid) gives a one-time spike
 *     so the recovery week feels rewarding instead of "back to baseline".
 */
export const SERIES_BASE_PAYOUT = 8;
export const SERIES_WIN_BONUS = 8;
export const STREAK_BONUS_STEP = 2;
export const STREAK_BONUS_CAP = 10;
export const COMEBACK_BONUS = 3;
export const COMEBACK_LOSS_THRESHOLD = 2;
export const ENCOUNTERS_PER_DAY = 2;
/**
 * Hard cap on merchant rerolls per visit. Per the Bazaar-inspired
 * economy redesign, every merchant overlay exposes a "Reroll Stock
 * ($X)" CTA that re-rolls `offer.listings` for a cash cost. This cap
 * prevents an infinite-spam exploit — once the user has rerolled this
 * many times during a single visit, the CTA greys out until the next
 * encounter pick.
 */
export const MERCHANT_REROLLS_PER_VISIT = 2;
/**
 * Hard cap on items the player can carry in the run bag. Caps merchant
 * purchases and event rewards so the chain math (and the always-visible
 * `SznFooterDecks` Abilities column) never has to deal with an unbounded
 * inventory.
 */
export const MAX_BAG_SIZE = 6;
/**
 * Hard cap on front-office picks per day; actual budget is
 * {@link DayEncounters.pickBudget} (1–2).
 *
 * Capped at 2 (down from a legacy 3) so the week always terminates in a
 * predictable number of clicks — playtesting flagged days that rolled 3
 * as a soft "infinite encounter loop" because there was no in-UI budget
 * readout and 3 chained encounters per day (with picker sub-flows) made
 * Game of the Week feel unreachable. Lowering the cap also auto-heals
 * any persisted runs whose day rolled a 3: `dayPickBudget` clamps the
 * persisted value to the new cap, so the next pick on that day advances
 * the calendar instead of refreshing the slate yet again.
 */
export const MAX_PICKS_PER_DAY = ENCOUNTERS_PER_DAY;

/**
 * FIFO size of the cross-week "recently seen" encounter ring stored on
 * {@link RunState.recentEncounterRing}. Tuned so the union of last
 * week's Thursday slate and this week's Monday slate never accidentally
 * repeats: a single week can surface up to ~10 unique encounter ids
 * (4 days * up to 2 picks * the day's slate count, capped by the
 * encounter table), so 12 covers "everything from last week + a small
 * buffer" without locking the entire tier table out for two weeks.
 *
 * The ring is consulted by `rollSznEncounterSlate` only when the tier
 * pool can still satisfy the union; if the cross-week excludes would
 * drain a tier dry the ring is skipped so a slate still fills.
 */
export const RECENT_ENCOUNTER_RING_SIZE = 12;

/**
 * Roll Mon..Thu pick budgets (1–2 each). Avoids “four identical days” so the
 * week has lighter and heavier front-office days.
 */
export function rollWeekPickBudgets(): number[] {
  const out: number[] = [];
  for (let i = 0; i < FRONT_OFFICE_DAYS.length; i++) {
    out.push(1 + Math.floor(Math.random() * MAX_PICKS_PER_DAY));
  }
  if (out.every((v) => v === out[0])) {
    const idx = Math.floor(Math.random() * out.length);
    let replacement = 1 + Math.floor(Math.random() * MAX_PICKS_PER_DAY);
    while (replacement === out[0]) {
      replacement = 1 + Math.floor(Math.random() * MAX_PICKS_PER_DAY);
    }
    out[idx] = replacement;
  }
  return out;
}

/**
 * Resolve a day's effective pick budget. Older saves without `pickBudget`
 * default to {@link MAX_PICKS_PER_DAY}; persisted values higher than the
 * current cap are clamped down so a run that started on the old 1–3
 * spread can never get stuck waiting for a third pick that the new UI
 * won't surface.
 */
export function dayPickBudget(day: { pickBudget?: number }): number {
  const raw = day.pickBudget;
  const n = raw === undefined ? MAX_PICKS_PER_DAY : raw;
  return Math.min(MAX_PICKS_PER_DAY, Math.max(1, Math.floor(n)));
}
export const SERIES_GAME_INNINGS = 3;
export const SERIES_LENGTH_BO = 3;

/**
 * Full SZN run state. Persisted on the gameStore as `run: RunState | null`.
 * `null` = not in a SZN run.
 */
export interface RunState {
  /** Picked MLB franchise the user is running with this run. Null only on legacy save loads. */
  selectedTeamId: MlbTeamId | null;
  /** Passive badges accumulated this run. Seeded with the team passive. */
  badges: BadgeId[];
  /**
   * Cash queued to be added at the next week rollover (from per-snap badge
   * triggers like Bronx Bombers' +$1 / Power snap). Drained into `cash` in
   * `reportSeriesGameResult`.
   */
  nextWeekCashBonus: number;
  /**
   * Pairs of (rookieCardId, veteranPlayerId) that have already granted the
   * +5 permanent boost so the Veteran specialty edge can only proc once per
   * pair in a run.
   */
  veteranBoostedBy: string[];
  /** 1..12 inclusive. */
  week: number;
  day: WeekDay;
  wins: number;
  losses: number;
  cash: number;
  /** 9 batters + 1 pitcher (in any order). */
  roster: RosterPlayer[];
  itemBag: Item[];
  /**
   * Pre-generated encounters for the current week. Length 4 (Mon..Thu) once
   * the week starts; empty during the weekend or before pack-rip.
   */
  weekEncounters: DayEncounters[];
  /** Active series during the weekend; null otherwise. */
  series: SeriesState | null;
  ghost: GhostSnapshot | null;
  /**
   * Weekly scouting report shown Monday before the first encounter.
   * Authored by `rollWeeklyScout` (see `scouting.ts`); no longer
   * derived from the weekend ghost. Cleared/replaced when a new week
   * begins.
   */
  weeklyScout: WeeklyScoutingReport | null;
  /** After the player dismisses the Monday report for the current week. */
  weekScoutingAcknowledged: boolean;
  /** True while pack-rip animation is in flight. */
  packRipPending: boolean;
  /** Set when the run has ended; UI shows the end screen. */
  endState: "champion" | "fired" | null;
  /**
   * Encounter #9 Platinum Glove: charges that nullify the opponent's
   * next pitching score. `computeMatchup` decrements one per opposing
   * pitching snap that would land. Re-rendered as a HUD chip.
   */
  defenseShields: number;
  /**
   * Encounter #10 Banging Scheme: how many upcoming series the user
   * can peek the opponent's first card for. Decremented at series
   * rollover in `reportSeriesGameResult`.
   */
  bangingSchemeWeeksLeft: number;
  /**
   * Encounter #10 alt: doubles badge-trigger payouts (Bronx Bombers
   * fires twice per Power snap). Persists for the rest of the run.
   */
  karmaDoubleTriggers: boolean;
  /**
   * Encounter #7 Rally Fire: +10% adjacent boost per team-logo card
   * for N upcoming weeks. Decremented at series rollover.
   */
  rallyFireWeeksLeft: number;
  /**
   * Suspend Instigators (Encounter #8): playerIds that won't be dealt
   * the next series. Cleared after the series wraps.
   */
  suspendedPlayerIds: string[];
  /**
   * Encounter #6 Hold-the-line: one-game flat boost for every roster
   * player's base score next series. Drained at series end.
   */
  nextGameRosterBoost: number;
  /**
   * Encounter #20 Faded Scouting Report: human-readable intel about
   * the upcoming ghost. null when no intel is queued. Cleared on
   * series end.
   */
  mlbScoutingIntel: string | null;
  /**
   * One-shot snapshot built when a series ends, consumed by
   * `SeriesResultScreen` to show the user how the weekend went and what
   * the rollover changed. The user dismisses the screen, which clears
   * this back to null so the Monday Front Office takes over. Lives on
   * `RunState` so it survives mid-render route changes and lets the
   * end-run path (10W / 3L) also surface the same summary before
   * showing the EndRunScreen.
   *
   * Fields are deliberately denormalized -- the buff-decrement summary
   * uses the BEFORE values so the screen can render "Rally Fire 2w
   * → 1w" without re-computing from the post-rollover state.
   */
  lastSeriesSummary: SeriesSummary | null;
  /**
   * Slim version of the previous series result kept around for the
   * Front Office HUD ("Last series: WON 2-1") chip until the user
   * starts their next series. Cleared the moment the next series
   * begins via `startSeries`. Independent of `lastSeriesSummary`
   * (which is one-shot and cleared by SeriesResultScreen dismissal).
   */
  lastSeriesScoreline: SeriesScoreline | null;
  /**
   * Encounter ids the user has been shown ANYWHERE this week (across
   * all 4 Front Office days AND every re-roll triggered by an earlier
   * pick). Drives the "no encounter twice in a week" rule -- every
   * roll filters this set out of the eligible pool, every freshly
   * generated offer is appended back into it. Cleared at week
   * rollover so each week starts with the full encounter table
   * available again. Optional on older saves; treated as empty when
   * absent.
   */
  seenEncountersThisWeek?: string[];
  /**
   * Rolling ring of encounter ids the user has recently SEEN across
   * multiple weeks. Persists past week rollover (where
   * {@link seenEncountersThisWeek} resets) so a Yard Sale that just
   * appeared on Thursday-week-1 can't show up again on Monday-week-2.
   *
   * FIFO ring capped at {@link RECENT_ENCOUNTER_RING_SIZE}: appended
   * to whenever an encounter is rendered into a Front Office slate.
   * Roll callers union this ring with `seenEncountersThisWeek` when
   * building their exclude set, BUT only when the tier pool can still
   * satisfy the request -- if the cross-week ring would drain the
   * tier dry, the ring is skipped so a slate still fills. Optional on
   * older saves; treated as empty when absent.
   */
  recentEncounterRing?: string[];
  /**
   * Bazaar-style "no silent drops" routing surface. When an item grant
   * (merchant buy, encounter `grantItem`, encounter `addItemRandom`)
   * lands while the bag is already at {@link MAX_BAG_SIZE}, the
   * dispatcher parks the would-be acquisition here and the
   * `ItemBagReplacePicker` modal mounts above the Front Office. The
   * user picks an existing bag item to sell for cash (clearing one
   * slot) and the pending grant lands. Cancelling the picker refunds
   * `refundOnCancel` cash as consolation so the encounter pick is
   * never wasted. `null` when nothing is pending. Optional on older
   * saves; treated as null.
   */
  pendingItemGrant?: PendingItemGrant | null;
  /**
   * Bazaar-style "no silent drops" routing surface for free-agency
   * signings. When `buyPlayerFromMarket` lands while the roster is
   * already at {@link STARTER_PACK_TOTAL} (10), the dispatcher
   * charges the listing price, parks the would-be signing here, and
   * the persistent SZN footer rail flips into "release" mode -- the
   * left deck paints each roster chip with a red RELEASE overlay so
   * the user picks the cut directly from the same card row they use
   * for the rest of FO (no separate modal mounts). The user picks an
   * existing roster slot to release (no cash refund — the cull is
   * what frees the slot), and the queued player lands in their
   * place. Cancelling refunds the listing price as full undo. `null`
   * when nothing is pending. Optional on older saves; treated as
   * null.
   */
  pendingPlayerGrant?: PendingPlayerGrant | null;
  /**
   * Series-result streak counters used by the new payout formula in
   * `reportSeriesGameResult`. `seriesWinStreak` = consecutive series
   * wins ending with the most recent series; `seriesLossStreak` =
   * consecutive losses. Exactly one of them is non-zero at any time
   * (a win zeroes the loss streak and vice versa). Drives both the
   * +$2/win streak bonus (capped at {@link STREAK_BONUS_CAP}) and the
   * +$3 comeback bonus when the user breaks a 2+ loss skid by winning.
   * Optional on older saves; treated as 0.
   */
  seriesWinStreak?: number;
  seriesLossStreak?: number;
}

/**
 * Pending player grant queued when a signing lands while the roster
 * is already at {@link STARTER_PACK_TOTAL}. Surfaced via the SZN
 * footer rail's "release" mode (see `SznFooterDecks`) -- the user
 * picks one current roster slot to release directly from the
 * persistent card row, the released player drops off the roster,
 * and the queued player takes their spot.
 *
 * Mirrors {@link PendingItemGrant} for the bag-full flow so the
 * "no silent drops" invariant holds for both items AND players.
 * Cash is charged at queue time (so the listing price is locked in
 * the moment the user committed to the sign); cancelling the
 * pending release refunds it in full.
 */
export interface PendingPlayerGrant {
  /** SZN / legacy player id being signed (matches `RosterPlayer.player.id`). */
  playerId: string;
  /** Rarity the signing lands at. Mirrors the listing's rarity. */
  rarity: Rarity;
  /** Originating subsystem — drives the banner copy. v1 only emits "freeAgency". */
  source: "freeAgency";
  /**
   * Cash refund handed back on cancel. Equal to the price the user
   * paid at queue time so cancelling fully undoes the transaction
   * (no consolation discount, unlike `PendingItemGrant.refundOnCancel`
   * — pulling out of a sign should be cost-neutral, not punitive).
   */
  refundOnCancel: number;
  /**
   * Optional human-readable label (e.g. "Aaron Judge") so the
   * footer banner can render `Cut a player to sign Aaron Judge`.
   * Falls back to the playerId when omitted.
   */
  label?: string;
}

/**
 * Pending item grant queued when an acquisition lands at a full bag.
 * Mounted by the `ItemBagReplacePicker` modal in `FrontOfficeScreen`
 * -- items still use a modal flow because they don't have a card-row
 * equivalent to the player release surface in `SznFooterDecks`.
 */
export interface PendingItemGrant {
  /** CardDefinition id of the item that wants into the bag. */
  cardId: string;
  /** Originating subsystem — drives the modal copy. */
  source: "merchant" | "event";
  /**
   * Cash refund handed back if the user cancels the picker without
   * picking a replacement. Computed at queue time from the item's
   * sell value so newer / more expensive grants pay a bigger
   * consolation if dismissed. Already in cash units; the dispatcher
   * adds this to `run.cash` on cancel.
   */
  refundOnCancel: number;
  /**
   * Optional human-readable label (e.g. "Sticky Stuff") so the
   * picker can render `Pick a slot to sell for Sticky Stuff` instead
   * of a card id. Falls back to the cardId when omitted.
   */
  label?: string;
}

/**
 * One-shot end-of-series snapshot. Captured at the same set() call
 * that rolls the week over -- so `before`/`after` references are
 * authoritative and never need re-derivation.
 */
export interface SeriesSummary {
  userWonSeries: boolean;
  userGameWins: number;
  ghostGameWins: number;
  userRunsTotal: number;
  ghostRunsTotal: number;
  /** Pre-rollover week (the week that just finished). */
  weekJustPlayed: number;
  /** Cumulative wins AFTER this series result is applied. */
  newWins: number;
  /** Cumulative losses AFTER this series result is applied. */
  newLosses: number;
  /** "champion" | "fired" | null. Mirrors the post-result endState. */
  endState: "champion" | "fired" | null;
  /** Cash held BEFORE the rollover refill. */
  cashBefore: number;
  /** Cash held AFTER the rollover refill (cashBefore + weeklyRefill + triggerBonus). */
  cashAfter: number;
  /**
   * Total cash paid out by the new payout formula at rollover. Equal
   * to {@link payoutBase} + {@link payoutWinBonus} +
   * {@link payoutStreakBonus} + {@link payoutComebackBonus}. Kept
   * alongside the legacy `weeklyRefill` field so older readers (the
   * SeriesResultScreen used to render a single number) stay valid
   * while new readers can break the line item out.
   */
  weeklyRefill: number;
  /** Appearance fee component (always paid; equals {@link SERIES_BASE_PAYOUT}). */
  payoutBase: number;
  /** Win-bonus component ($0 on a loss; {@link SERIES_WIN_BONUS} on a win). */
  payoutWinBonus: number;
  /** Streak bonus component (+$2 per consecutive win, capped at {@link STREAK_BONUS_CAP}). */
  payoutStreakBonus: number;
  /** Comeback bonus ($3 when this win broke a 2+ loss streak; $0 otherwise). */
  payoutComebackBonus: number;
  /** Karma-multiplied trigger bonus that was queued via nextWeekCashBonus. */
  triggerBonus: number;
  /** Win streak AFTER this series result is folded in. */
  newWinStreak: number;
  /** Loss streak AFTER this series result is folded in. */
  newLossStreak: number;
  /** Ghost franchise label of the team the user just faced. */
  ghostLabel: string | null;
  /** Buff-timer deltas for the chip strip. */
  bangingSchemeBefore: number;
  bangingSchemeAfter: number;
  rallyFireBefore: number;
  rallyFireAfter: number;
  /** True when these buffs were active at series start and got drained on rollover. */
  nextGameBoostExpired: boolean;
  scoutingIntelExpired: boolean;
  suspensionsExpired: number;
  /** Permanent buffs the screen lists as "still active" (no decrement). */
  karmaActive: boolean;
  defenseShieldsActive: number;
}

/** Slim FO-HUD chip data — wholly derived from a SeriesSummary. */
export interface SeriesScoreline {
  userWon: boolean;
  userGameWins: number;
  ghostGameWins: number;
  weekJustPlayed: number;
}

export function emptyRunState(): RunState {
  return {
    selectedTeamId: null,
    badges: [],
    nextWeekCashBonus: 0,
    veteranBoostedBy: [],
    week: 1,
    day: "mon",
    wins: 0,
    losses: 0,
    cash: STARTER_CASH,
    roster: [],
    itemBag: [],
    weekEncounters: [],
    series: null,
    ghost: null,
    weeklyScout: null,
    weekScoutingAcknowledged: false,
    packRipPending: true,
    endState: null,
    defenseShields: 0,
    bangingSchemeWeeksLeft: 0,
    karmaDoubleTriggers: false,
    rallyFireWeeksLeft: 0,
    suspendedPlayerIds: [],
    nextGameRosterBoost: 0,
    mlbScoutingIntel: null,
    lastSeriesSummary: null,
    lastSeriesScoreline: null,
    pendingItemGrant: null,
    pendingPlayerGrant: null,
    seriesWinStreak: 0,
    seriesLossStreak: 0,
    seenEncountersThisWeek: [],
    recentEncounterRing: [],
  };
}

/** Stable id for items, encounters, listings — short, monotonic-ish. */
let _idSeq = 0;
export function makeRunId(prefix = "rid"): string {
  _idSeq = (_idSeq + 1) | 0;
  return `${prefix}-${Date.now().toString(36)}-${_idSeq.toString(36)}`;
}

/**
 * Cumulative items in the bag plus the player's intrinsic bonus. v1: just the
 * item count and a flat per-rarity bump on the player at the plate. Synergies
 * layer on top via `synergies.ts`.
 */
export function rosterBaseValue(player: RosterPlayer): number {
  return RARITY_BASE_VALUE[player.rarity] + (player.permanentBoost ?? 0);
}

/** Find a roster slot by player id. Returns -1 if absent. */
export function indexOfRosterPlayer(
  roster: RosterPlayer[],
  playerId: string,
): number {
  return roster.findIndex((r) => r.player.id === playerId);
}
