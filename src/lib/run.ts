/**
 * SZN Mode run state — the 12-week single-player run.
 *
 * Core flow:
 *   pack-rip -> Mon..Thu Front Office (3 encounters/day) -> Fri-Sun Bo3 series
 *   vs locally generated Ghost -> +win or +loss -> next week, or run end at
 *   10W (champion) or 3L (fired).
 *
 * Combat reuses the existing shape-connecting at-bat engine. Items in the
 * bag are referenced by `CardDefinition.id`; the player at the plate is the
 * connection root (see `MlbPlayer.leftShape` / `rightShape`).
 */

import type { CardDefinition } from "./cards";
import type { MlbPlayer } from "./players";

export type Tier = "bronze" | "silver" | "gold" | "diamond";

/**
 * Player class tag — drives team-wide synergy buffs when enough roster
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

export const TIER_ORDER: Tier[] = ["bronze", "silver", "gold", "diamond"];

export function nextTier(t: Tier): Tier | null {
  const i = TIER_ORDER.indexOf(t);
  if (i < 0 || i >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[i + 1];
}

/**
 * Per-tier base value the player at the plate contributes to combat. Items
 * stack on top via the existing chain-scoring engine.
 */
export const TIER_BASE_VALUE: Record<Tier, number> = {
  bronze: 4,
  silver: 7,
  gold: 11,
  diamond: 16,
};

/**
 * One slot on the 10-man roster. The roster is 9 batters + 1 pitcher; the
 * pitcher is treated as the "fielder" the user controls during the half
 * they're on defense.
 */
export interface RosterPlayer {
  /** Source MlbPlayer record. */
  player: MlbPlayer;
  tier: Tier;
  /** Frozen at run-start; doesn't change with merges. */
  tag: ClassTag;
}

/**
 * Purchased item instance that lives in the manager's bag. References the
 * existing CardDefinition catalog by id; the card's `baseValue`, shapes, and
 * (later) ability fields are the items's combat data.
 */
export interface Item {
  instanceId: string;
  cardId: string;
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
  scouting_director: "Roster duplicates and high-tier replacements.",
  shady_trainer: "High-risk, high-reward items.",
  equipment_manager: "Bats, gloves, and gear cards.",
  concessions: "Cheap utility items and stadium snacks.",
};

/** Narrative events. */
export type EventId = "ringing_phone" | "microphone" | "injury_report";

export const EVENT_LABEL: Record<EventId, string> = {
  ringing_phone: "Ringing Phone",
  microphone: "Microphone",
  injury_report: "Injury Report",
};

export const EVENT_BLURB: Record<EventId, string> = {
  ringing_phone: "A rival GM has a trade offer.",
  microphone: "Press wants a comment. Spin it.",
  injury_report: "Trainer rushes in with grim news.",
};

/** Stall listing the user can buy. */
export interface MerchantListing {
  /** Stable id for React keys + purchase routing. */
  listingId: string;
  /** Card to acquire as an Item. */
  cardId: string;
  price: number;
  /**
   * If set, this listing is a roster-tier upgrade or replacement keyed to
   * a specific player + tier. Buying it consumes the existing bronze/silver
   * roster instance and bumps the tier.
   */
  rosterUpgrade?: {
    playerId: string;
    /** Which tier the duplicate represents (the user's roster is 1 tier below). */
    duplicateTier: Tier;
    /** True for "buy this same player at the next tier directly" listings. */
    isReplacement: boolean;
  };
}

export interface MerchantOffer {
  kind: "merchant";
  merchantId: MerchantId;
  listings: MerchantListing[];
}

/** Outcome branches the user can pick on a narrative event. */
export interface EventChoice {
  choiceId: string;
  label: string;
  /** Player-facing flavor for the consequence. */
  resultBlurb: string;
  /** Effect applied when chosen. */
  effect: EventEffect;
}

export type EventEffect =
  | { kind: "cash"; delta: number }
  | { kind: "addItemRandom"; pool: "any" | "batting" | "pitching" }
  | { kind: "removeRandomItem" }
  | { kind: "noop" };

export interface EventOffer {
  kind: "event";
  eventId: EventId;
  prompt: string;
  choices: EventChoice[];
}

/**
 * A "Player Market" listing — a fresh MLB player the user can sign onto
 * the roster for cash. Players sold this way always come in at Bronze and
 * inherit their intrinsic class tag.
 */
export interface PlayerMarketListing {
  listingId: string;
  playerId: string;
  /** Always "bronze" for v1, but typed forward in case promotions sell tiers. */
  tier: Tier;
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
 * Three encounter slots presented for one Front Office day. The slate
 * REFRESHES after every pick the user commits -- the user always sees
 * three live offers until they exhaust the day's pick budget. We track
 * the running pick count instead of a per-slot consumed flag because
 * the slot identities change every refresh.
 */
export interface DayEncounters {
  day: DayOfWeek;
  /** Always length 3; mutated to a fresh slate after each commit. */
  offers: EncounterOffer[];
  /** 0..MAX_PICKS_PER_DAY; auto-advances the day at the cap. */
  picksUsed: number;
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

/**
 * Monday Scouting Report — tactical preview of the weekend ghost before
 * the user spends Front Office picks. Generated from the same ghost
 * roster seeded at the start of each Mon..Thu block.
 */
export interface WeekendScouting {
  /** "This weekend you face the Hoboken Hounds." */
  opponentLine: string;
  /** Pitcher-focused intel (archetype / tendency). */
  pitcherLine: string;
  /** Batter synergy / lineup cluster (e.g. Speedsters). */
  synergyLine: string;
}

export const RUN_WIN_TARGET = 10;
export const RUN_LOSS_LIMIT = 3;
export const STARTER_PACK_BATTERS = 9;
export const STARTER_PACK_PITCHERS = 1;
export const STARTER_PACK_TOTAL = STARTER_PACK_BATTERS + STARTER_PACK_PITCHERS;
export const STARTER_CASH = 10;
export const WEEKLY_CASH = 12;
export const ENCOUNTERS_PER_DAY = 3;
export const MAX_PICKS_PER_DAY = 3;
export const SERIES_GAME_INNINGS = 3;
export const SERIES_LENGTH_BO = 3;

/**
 * Full SZN run state. Persisted on the gameStore as `run: RunState | null`.
 * `null` = not in a SZN run.
 */
export interface RunState {
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
   * Intel for the upcoming weekend, shown Monday before the first encounter.
   * Cleared/replaced when a new week begins; derived from `ghost`.
   */
  weekendScouting: WeekendScouting | null;
  /** After the player dismisses the Monday report for the current week. */
  weekScoutingAcknowledged: boolean;
  /** True while pack-rip animation is in flight. */
  packRipPending: boolean;
  /** Set when the run has ended; UI shows the end screen. */
  endState: "champion" | "fired" | null;
}

export function emptyRunState(): RunState {
  return {
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
    weekendScouting: null,
    weekScoutingAcknowledged: false,
    packRipPending: true,
    endState: null,
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
 * item count and a flat per-tier bump on the player at the plate. Synergies
 * layer on top via `synergies.ts`.
 */
export function rosterBaseValue(player: RosterPlayer): number {
  return TIER_BASE_VALUE[player.tier];
}

/** Find a roster slot by player id. Returns -1 if absent. */
export function indexOfRosterPlayer(
  roster: RosterPlayer[],
  playerId: string,
): number {
  return roster.findIndex((r) => r.player.id === playerId);
}
