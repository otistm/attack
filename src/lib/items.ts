/**
 * SZN Mode merchant offer + event generators.
 *
 * Every merchant draws from the existing `CardDefinition` pool and exposes
 * cards as priced listings. Equipment merchants are mechanically identical
 * to other merchants (per design); the differentiator is the card subset
 * each persona pulls from.
 */

import { SESSION_CARDS, type CardDefinition } from "./cards";
import type {
  EncounterOffer,
  EventChoice,
  EventOffer,
  EventId,
  MerchantId,
  MerchantListing,
  MerchantOffer,
  PlayerMarketOffer,
  RosterPlayer,
  Tier,
} from "./run";
import { makeRunId, nextTier } from "./run";
import { PLAYERS } from "./players";

const BATTING_CARDS = SESSION_CARDS.filter((c) => c.type === "Batting");
const PITCHING_CARDS = SESSION_CARDS.filter((c) => c.type === "Pitching");
const ALL_CARDS = SESSION_CARDS;

function sample<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * Week-aware base price for an item card.
 *
 * Pricing curve targets:
 *   - Week 1: **every** listing (items, dupes, free agents) is capped at
 *     $2 so $10 starter cash can always clear the shop.
 *   - `weekFactor(week)` ramps from 1.0 at week 1 to ~2.5 at week 12
 *     (applied from week 2 onward for scaling).
 *
 * Implementation:
 *   - `units(card.baseValue)` produces a 1.0..4.0 "size" factor that
 *     scales with how impactful the card's printed value is (a 6-value
 *     general is bigger than a 1-value role card).
 *   - Week 1 item prices: clamped to $1–$2 (never above $2). Week 2+:
 *     floored at $2, scaled by `weekFactor`.
 */
function units(card: CardDefinition): number {
  const v = card.baseValue;
  if (v <= 1) return 1;
  if (v <= 2) return 1.4;
  if (v <= 3) return 1.8;
  if (v <= 4) return 2.3;
  if (v <= 5) return 2.8;
  return 3.5;
}

function weekFactor(week: number): number {
  // Week 1 -> 1.0, Week 12 -> 2.5. Linear ramp keeps the curve
  // predictable for tuning; we can swap in a piecewise/exponential
  // scaler later if the early game still feels too cheap or the late
  // game still feels too lopsided.
  const w = Math.max(1, Math.min(12, week));
  return 1 + ((w - 1) / 11) * 1.5;
}

function priceFor(card: CardDefinition, week: number): number {
  const raw = Math.round(units(card) * weekFactor(week));
  if (week === 1) return Math.min(2, Math.max(1, raw));
  return Math.max(2, raw);
}

function listingForCard(
  card: CardDefinition,
  week: number,
  priceOverride?: number,
): MerchantListing {
  let price = priceOverride ?? priceFor(card, week);
  if (week === 1) price = Math.min(2, price);
  return {
    listingId: makeRunId("lst"),
    cardId: card.id,
    price,
  };
}

/**
 * Roster duplicate / replacement prices. Week 1 max $2; later weeks scale
 * with record (bronze dup $2..5 through diamond replacement ~$22 by week 12).
 */
function dupPrice(tier: Tier, week: number): number {
  const base =
    tier === "diamond" ? 9 : tier === "gold" ? 6 : tier === "silver" ? 4 : 2;
  const p = Math.max(2, Math.round(base * weekFactor(week)));
  if (week === 1) return Math.min(2, p);
  return p;
}

/** Free-agent sign price by role. Week 1 max $2. */
function signPrice(role: "Pitcher" | "Batter", week: number): number {
  const base = role === "Pitcher" ? 4 : 3;
  const p = Math.max(2, Math.round(base * weekFactor(week)));
  if (week === 1) return Math.min(2, p);
  return p;
}

/**
 * Build offers for the Scouting Director. Mostly roster duplicates that
 * upgrade existing players, with one filler item card. Falls back to pure
 * item listings when the roster is at full Diamond (no upgrades possible).
 */
function scoutingOffer(roster: RosterPlayer[], week: number): MerchantOffer {
  const upgradable = roster.filter((r) => nextTier(r.tier) !== null);
  const listings: MerchantListing[] = [];
  // Up to 3 roster upgrades.
  for (const target of sample(upgradable, 3)) {
    // Half the time offer a same-tier duplicate, half a same-player
    // higher-tier "replacement". The user pays for both the same way; the
    // merge effect differs.
    const isReplacement = Math.random() < 0.5;
    const dupTier = isReplacement
      ? (nextTier(target.tier) as Tier)
      : target.tier;
    listings.push({
      listingId: makeRunId("lst"),
      cardId: target.player.signatureCardIds[0],
      price: dupPrice(dupTier, week),
      rosterUpgrade: {
        playerId: target.player.id,
        duplicateTier: dupTier,
        isReplacement,
      },
    });
  }
  // Pad with a couple of random batting items so the row is never empty.
  while (listings.length < 4) {
    const card = sample(BATTING_CARDS, 1)[0];
    if (!card) break;
    listings.push(listingForCard(card, week));
  }
  return { kind: "merchant", merchantId: "scouting_director", listings };
}

function shadyTrainerOffer(week: number): MerchantOffer {
  // High baseValue cards at a slight premium.
  const pool = ALL_CARDS.filter((c) => c.baseValue >= 4);
  const listings = sample(pool, 4).map((c) =>
    listingForCard(c, week, priceFor(c, week) + 1),
  );
  return { kind: "merchant", merchantId: "shady_trainer", listings };
}

function equipmentManagerOffer(week: number): MerchantOffer {
  // Equipment-flavored items: any card, but at standard price.
  const listings = sample(ALL_CARDS, 4).map((c) => listingForCard(c, week));
  return { kind: "merchant", merchantId: "equipment_manager", listings };
}

function concessionsOffer(week: number): MerchantOffer {
  // Cheap utility: low baseValue cards at a discount.
  const pool = ALL_CARDS.filter((c) => c.baseValue <= 3);
  const listings = sample(pool, 4).map((c) => {
    const p = Math.max(2, priceFor(c, week) - 1);
    return listingForCard(c, week, p);
  });
  return { kind: "merchant", merchantId: "concessions", listings };
}

export function buildMerchantOffer(
  merchantId: MerchantId,
  roster: RosterPlayer[],
  week: number,
): MerchantOffer {
  switch (merchantId) {
    case "scouting_director":
      return scoutingOffer(roster, week);
    case "shady_trainer":
      return shadyTrainerOffer(week);
    case "equipment_manager":
      return equipmentManagerOffer(week);
    case "concessions":
      return concessionsOffer(week);
  }
}

const RINGING_PHONE_CHOICES: EventChoice[] = [
  {
    choiceId: "answer",
    label: "Take the call",
    resultBlurb: "Rival GM unloads a card on you. +1 random item.",
    effect: { kind: "addItemRandom", pool: "any" },
  },
  {
    choiceId: "decline",
    label: "Let it ring",
    resultBlurb: "Press waits. +$2.",
    effect: { kind: "cash", delta: 2 },
  },
];

const MICROPHONE_CHOICES: EventChoice[] = [
  {
    choiceId: "spin",
    label: "Spin the story",
    resultBlurb: "Owner approves your bonus check. +$4.",
    effect: { kind: "cash", delta: 4 },
  },
  {
    choiceId: "candid",
    label: "Speak candidly",
    resultBlurb: "Players love the honesty. +1 random item.",
    effect: { kind: "addItemRandom", pool: "any" },
  },
];

const INJURY_CHOICES: EventChoice[] = [
  {
    choiceId: "trainer",
    label: "Pay for the specialist",
    resultBlurb: "Star is fine. -$3.",
    effect: { kind: "cash", delta: -3 },
  },
  {
    choiceId: "ride",
    label: "Walk it off",
    resultBlurb: "Tools fall out of the bag. -1 random item.",
    effect: { kind: "removeRandomItem" },
  },
];

export function buildEventOffer(eventId: EventId): EventOffer {
  switch (eventId) {
    case "ringing_phone":
      return {
        kind: "event",
        eventId,
        prompt: "A phone rings on your desk. Caller ID: a rival GM.",
        choices: RINGING_PHONE_CHOICES,
      };
    case "microphone":
      return {
        kind: "event",
        eventId,
        prompt: "A reporter shoves a microphone in your face.",
        choices: MICROPHONE_CHOICES,
      };
    case "injury_report":
      return {
        kind: "event",
        eventId,
        prompt: "The trainer slides a clipboard across the desk. Tight hammy.",
        choices: INJURY_CHOICES,
      };
  }
}

const ALL_MERCHANTS: MerchantId[] = [
  "scouting_director",
  "shady_trainer",
  "equipment_manager",
  "concessions",
];
const ALL_EVENTS: EventId[] = ["ringing_phone", "microphone", "injury_report"];

/**
 * Build a "Free Agency" offer — N fresh MLB players the user doesn't own
 * yet, priced at bronze-tier sign value. Falls back to anyone if all
 * players in the pool are already on the roster (unlikely with a 30+ pool
 * vs. a 10-man roster).
 */
function freeAgencyOffer(
  roster: RosterPlayer[],
  week: number,
  preferRole?: "Batter" | "Pitcher",
): PlayerMarketOffer {
  const owned = new Set(roster.map((r) => r.player.id));
  let pool = PLAYERS.filter((p) => !owned.has(p.id));
  if (preferRole) {
    const filtered = pool.filter((p) => p.role === preferRole);
    if (filtered.length >= 3) pool = filtered;
  }
  if (pool.length === 0) pool = PLAYERS;
  const picks = sample(pool, 4);
  return {
    kind: "playerMarket",
    label: "Free Agency",
    blurb: "Sign new MLB talent. Players come in at Bronze.",
    listings: picks.map((p) => ({
      listingId: makeRunId("plst"),
      playerId: p.id,
      tier: "bronze" as Tier,
      // Pitchers a touch more than bats; both ramp with the week.
      price: signPrice(p.role, week),
    })),
  };
}

/**
 * Build the day's 3 encounter slots. Mix of merchants, events and (sometimes)
 * a free-agency player market. Roughly: 50% chance the day has a player
 * market slot replacing one of the merchant slots, so the user encounters
 * a player-shopping moment ~every other day.
 */
export function rollDailyOffers(
  roster: RosterPlayer[],
  week: number,
): EncounterOffer[] {
  const offers: EncounterOffer[] = [];
  const merchants = sample(ALL_MERCHANTS, 2);
  for (const m of merchants) offers.push(buildMerchantOffer(m, roster, week));
  offers.push(buildEventOffer(sample(ALL_EVENTS, 1)[0]));
  if (Math.random() < 0.55) {
    // Replace one of the merchant slots with a free-agency player market.
    // Index 0 or 1 (we just pushed two merchants in those positions).
    const idx = Math.random() < 0.5 ? 0 : 1;
    offers[idx] = freeAgencyOffer(roster, week);
  }
  // Shuffle so the event slot isn't always last.
  for (let i = offers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offers[i], offers[j]] = [offers[j], offers[i]];
  }
  return offers;
}

/**
 * Pick a random card id from the global card pool, optionally filtered to
 * Batting / Pitching for the addItemRandom event effect.
 */
export function rollRandomItemCardId(pool: "any" | "batting" | "pitching"): string {
  const arr = pool === "batting" ? BATTING_CARDS : pool === "pitching" ? PITCHING_CARDS : ALL_CARDS;
  return arr[Math.floor(Math.random() * arr.length)].id;
}

/** Lookup helper used by store actions. */
export function findPlayerById(playerId: string) {
  return PLAYERS.find((p) => p.id === playerId) ?? null;
}
