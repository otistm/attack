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
  Rarity,
} from "./run";
import { makeRunId, nextRarity, MAX_PICKS_PER_DAY } from "./run";
import { PLAYERS } from "./players";
import { ALL_SZN_PLAYERS } from "./sznPlayers";
import { rollSznEncounterSlate } from "./sznEncounters";

// Random-pool item rolls (addItemRandom event effect) and merchant
// listings must never surface SZN encounter items -- those are granted
// only through deliberate encounter dispatches.
const isEncounterId = (id: string) => id.startsWith("enc-");
const BATTING_CARDS = SESSION_CARDS.filter((c) => c.type === "Batting" && !isEncounterId(c.id));
const PITCHING_CARDS = SESSION_CARDS.filter((c) => c.type === "Pitching" && !isEncounterId(c.id));
const ALL_CARDS = SESSION_CARDS.filter((c) => !isEncounterId(c.id));

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
  // Week 1 caps every listing at $2 so the $14 starter cash always
  // clears the early shop. Floor drops to $1 (was $2) so genuinely
  // low-impact role cards can actually be cheap impulse buys.
  if (week === 1) return Math.min(2, Math.max(1, raw));
  return Math.max(1, raw);
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
 * with record (common dup $2..5 through legend replacement ~$22 by week 12).
 */
function dupPrice(rarity: Rarity, week: number): number {
  const base =
    rarity === "legend" ? 8 : rarity === "veteran" ? 5 : rarity === "allstar" ? 3 : 2;
  // Floor dropped from $2 → $1 so Common dupes in mid-weeks can land at
  // $1-$2 instead of always being clamped up — the user feels the
  // pricing curve, the dupe market doesn't price-lock at the floor.
  const p = Math.max(1, Math.round(base * weekFactor(week)));
  if (week === 1) return Math.min(2, p);
  return p;
}

/** Free-agent sign price by role. Week 1 max $2. */
function signPrice(role: "Pitcher" | "Batter", week: number): number {
  // Was 4/3; now 3/2 so signing a fresh face is reachable on the same
  // budget as a cheap item rather than a premium decision.
  const base = role === "Pitcher" ? 3 : 2;
  const p = Math.max(1, Math.round(base * weekFactor(week)));
  if (week === 1) return Math.min(2, p);
  return p;
}

/**
 * Build offers for the Scouting Director. Mostly roster duplicates that
 * upgrade existing players, with one filler item card. Falls back to pure
 * item listings when the roster is at full Legend (no upgrades possible).
 *
 * Legacy `MlbPlayer` slots expose `signatureCardIds`; new SZN players
 * don't (their "signature" is the player card itself), so we fall back
 * to the player id as the duplicate cardId for SZN slots.
 */
function scoutingOffer(roster: RosterPlayer[], week: number): MerchantOffer {
  const upgradable = roster.filter((r) => nextRarity(r.rarity) !== null);
  const listings: MerchantListing[] = [];
  // Up to 3 roster upgrades.
  for (const target of sample(upgradable, 3)) {
    const isReplacement = Math.random() < 0.5;
    const dupRarity = isReplacement
      ? (nextRarity(target.rarity) as Rarity)
      : target.rarity;
    const legacySig =
      "signatureCardIds" in target.player
        ? target.player.signatureCardIds[0]
        : `player:${target.player.id}`;
    listings.push({
      listingId: makeRunId("lst"),
      cardId: legacySig,
      price: dupPrice(dupRarity, week),
      rosterUpgrade: {
        playerId: target.player.id,
        duplicateRarity: dupRarity,
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
  // High baseValue cards at a slight premium. Week-1 listings clamp
  // to the $2 cap; later weeks tack +1 on top of the standard price.
  const pool = ALL_CARDS.filter((c) => c.baseValue >= 4);
  const listings = sample(pool, 4).map((c) =>
    listingForCard(c, week, week === 1 ? priceFor(c, week) : priceFor(c, week) + 1),
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
 * Build a "Free Agency" offer — N fresh players the user doesn't own
 * yet, priced at common-rarity sign value. Sources the pool from
 * `ALL_SZN_PLAYERS` so the cards rendered on the market match the
 * semantic-edge SZN player card design used everywhere else (combat
 * lineup, footer rail, pack-rip reveal). The legacy `MlbPlayer` pool
 * is kept as a safety fallback for the (currently impossible) case
 * where every SZN player on the registry is already owned, so the
 * market always has SOMEONE to sign even on degenerate save states.
 *
 * `preferRole` lets future callers bias the four listings toward
 * batters or pitchers — useful when the user just sold a position
 * and we want the next market refresh to surface a replacement.
 */
function freeAgencyOffer(
  roster: RosterPlayer[],
  week: number,
  preferRole?: "Batter" | "Pitcher",
): PlayerMarketOffer {
  const owned = new Set(roster.map((r) => r.player.id));
  let pool = ALL_SZN_PLAYERS.filter((p) => !owned.has(p.id));
  if (preferRole) {
    const filtered = pool.filter((p) => p.role === preferRole);
    if (filtered.length >= 3) pool = filtered;
  }
  // Last-ditch fallback: every SZN player is owned -> sample legacy
  // MlbPlayers so the market isn't empty. In practice the NYY pool is
  // 20 players and the roster cap is 10, so we never reach this.
  let picks: { id: string; role: "Batter" | "Pitcher" }[];
  if (pool.length === 0) {
    const legacyPool = PLAYERS.filter((p) => !owned.has(p.id));
    picks = sample(legacyPool, 4).map((p) => ({ id: p.id, role: p.role }));
  } else {
    picks = sample(pool, 4).map((p) => ({ id: p.id, role: p.role }));
  }
  return {
    kind: "playerMarket",
    label: "Free Agency",
    blurb: "Sign new MLB talent. Players come in at Common.",
    listings: picks.map((p) => ({
      listingId: makeRunId("plst"),
      playerId: p.id,
      rarity: "common" as Rarity,
      // Pitchers a touch more than bats; both ramp with the week.
      price: signPrice(p.role, week),
    })),
  };
}


function shuffleOffers<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Week-1 introductory discount for encounter event-choice costs.
 *
 * The encounter spec hard-codes per-choice prices on top of the
 * merchant listing curve (Drip Cleats $4, Corked Bat $5, etc.). Those
 * prices are authored for mid-run feel; on opening week the user only
 * has the $14 starter stipend, so a single $5 encounter wipes the
 * budget for the rest of the week. We clamp every Week-1 encounter
 * `costPreview` down to $2 so the user can actually take 2-3 encounter
 * items on day one, AND rewrite the choice label so the UI matches
 * the price the dispatcher will actually charge (otherwise the button
 * says "($5)" but only $2 is deducted -- confusing instead of
 * delightful). Pure cash choices (`kind: "cash"`) skip this branch
 * because their delta is the effect, not a `costPreview`.
 *
 * Weeks 2+ leave the printed cost unchanged so the curve still bites.
 */
function applyWeekDiscountToOffers(
  offers: EncounterOffer[],
  week: number,
): EncounterOffer[] {
  if (week !== 1) return offers;
  return offers.map((o) => {
    if (o.kind !== "event") return o;
    return {
      ...o,
      choices: o.choices.map((c) => {
        if (!c.costPreview || c.costPreview <= 2) return c;
        const newCost = 2;
        return {
          ...c,
          costPreview: newCost,
          // Rewrite the trailing "($N)" tag the encounter author
          // baked into the label; safe no-op if the label doesn't
          // have one.
          label: c.label.replace(/\(\$\d+\)/, `($${newCost})`),
        };
      }),
    };
  });
}

/**
 * Build the day's encounter slots (1–3). Mostly draws from the SZN
 * encounter table (20 spec encounters in `sznEncounters.ts`); the
 * legacy scouting-director / shady-trainer / equipment-manager /
 * concessions merchants are retained as a small chance per day for
 * the existing roster-upgrade / dupe market the SZN table doesn't
 * cover. Free-agency player market still surfaces a fraction of the
 * time so the user always has a "sign a fresh face" outlet.
 *
 * `excludeEncounterIds` is the week-level dedupe set. Callers pass the
 * union of every encounter id already rendered this week (other days
 * + previously committed picks) so the user never sees the same
 * encounter twice across a single Monday→Thursday Front Office stretch.
 * When the eligible pool is exhausted the slate quietly allows repeats
 * so the day still surfaces `slotCount` offers.
 */
export function rollDailyOffers(
  roster: RosterPlayer[],
  week: number,
  slotCount: number = MAX_PICKS_PER_DAY,
  excludeEncounterIds?: ReadonlySet<string>,
): EncounterOffer[] {
  const n = Math.max(1, Math.min(MAX_PICKS_PER_DAY, Math.floor(slotCount)));
  const slate = rollSznEncounterSlate(week, n, excludeEncounterIds);

  // Sprinkle in legacy front-office offers so roster upgrades, the
  // free-agency lane, and the legacy event flavors still appear:
  //   - 35% chance one slot becomes a legacy merchant (preserves the
  //     Scouting Director's roster upgrade path that the SZN table
  //     doesn't replicate).
  //   - 20% chance one slot becomes a Free Agency player market.
  // Sampling is over the SZN slate to keep slot count constant.
  // Legacy merchants and the Free Agency market are ALSO filtered
  // against the week-level dedupe set (matching by their
  // `encounterOfferId` -- `merchant:concessions`, `market:Free Agency`,
  // etc.) so the no-repeat-this-week rule covers them too. Without
  // this filter a Concessions merchant rolled on Monday could
  // resurface on a Tuesday re-roll because the SZN-table dedupe
  // only knows about SZN encounter ids.
  const offers: EncounterOffer[] = [...slate];
  if (offers.length > 0 && Math.random() < 0.35) {
    const merchantCandidates = ALL_MERCHANTS.filter(
      (id) => !excludeEncounterIds?.has(`merchant:${id}`),
    );
    if (merchantCandidates.length > 0) {
      const idx = Math.floor(Math.random() * offers.length);
      offers[idx] = buildMerchantOffer(
        sample(merchantCandidates, 1)[0],
        roster,
        week,
      );
    }
  }
  if (offers.length > 0 && Math.random() < 0.2) {
    const market = freeAgencyOffer(roster, week);
    if (!excludeEncounterIds?.has(`market:${market.label}`)) {
      const idx = Math.floor(Math.random() * offers.length);
      offers[idx] = market;
    }
  }
  return shuffleOffers(applyWeekDiscountToOffers(offers, week));
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

export type MerchantType = "Bat Manufacturer" | "Pitching Guru" | "Shady Trainer";

export type ItemTarget = "Batting" | "Pitching" | "Any";

export interface ItemDefinition {
  id: string;
  name: string;
  merchant: MerchantType;
  target: ItemTarget;
  cost: number;
  description: string;
  
  // Modifiers
  valueModifier?: number;
  hitScaleModifier?: number;
  
  // Shady Trainer specific
  suspendsPlayerNextGame?: boolean;
}

export const ITEMS: Record<string, ItemDefinition> = {
  // --- Bat Manufacturer ---
  "bat-maple": {
    id: "bat-maple",
    name: "Maple Bat",
    merchant: "Bat Manufacturer",
    target: "Batting",
    cost: 50,
    description: "+1 Value.",
    valueModifier: 1,
  },
  "bat-corked": {
    id: "bat-corked",
    name: "Corked Bat",
    merchant: "Bat Manufacturer",
    target: "Batting",
    cost: 150,
    description: "+3 Value.",
    valueModifier: 3,
  },
  "gloves-grip": {
    id: "gloves-grip",
    name: "Sticky Gloves",
    merchant: "Bat Manufacturer",
    target: "Batting",
    cost: 80,
    description: "+1 Hit Scale.",
    hitScaleModifier: 1,
  },

  // --- Pitching Guru ---
  "rosin-bag": {
    id: "rosin-bag",
    name: "Fresh Rosin",
    merchant: "Pitching Guru",
    target: "Pitching",
    cost: 50,
    description: "+1 Value.",
    valueModifier: 1,
  },
  "pine-tar": {
    id: "pine-tar",
    name: "Hidden Pine Tar",
    merchant: "Pitching Guru",
    target: "Pitching",
    cost: 150,
    description: "+3 Value.",
    valueModifier: 3,
  },
  "grip-trainer": {
    id: "grip-trainer",
    name: "Grip Trainer",
    merchant: "Pitching Guru",
    target: "Pitching",
    cost: 80,
    description: "Pitcher wins ties this at-bat.",
  },

  // --- Shady Trainer ---
  "juice": {
    id: "juice",
    name: "Performance Enhancer",
    merchant: "Shady Trainer",
    target: "Any",
    cost: 200,
    description: "+5 Value, but player is suspended for the next game.",
    valueModifier: 5,
    suspendsPlayerNextGame: true,
  },
  "mysterious-vial": {
    id: "mysterious-vial",
    name: "Mysterious Vial",
    merchant: "Shady Trainer",
    target: "Any",
    cost: 100,
    description: "+8 Hit Scale, but player is suspended for the next game.",
    hitScaleModifier: 8,
    suspendsPlayerNextGame: true,
  },
};
