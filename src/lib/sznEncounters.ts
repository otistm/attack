/**
 * SZN Encounter catalog.
 *
 * Twenty thematic encounters (per the spec attached to the Encounter
 * Overhaul plan) shipped as either an `EventOffer` (multi-choice modal)
 * or a `MerchantOffer` (multi-listing shop). Encounters that lean on
 * mechanics not yet built (off-roster player trades, expanded 4-edge
 * cards) ship as `locked: true` "COMING SOON" buttons next to active
 * alternative choices so the encounter is always playable.
 *
 * `rollDailyOffers` in `items.ts` reads from this table directly --
 * the legacy 3-event / 4-merchant hard-coded constants in that file
 * are now thin wrappers around the catalog entries.
 *
 * Encounter budget: one weekend ramps cost / power tier by week
 * (`weekTier(week)` below). Cheap-only weeks 1-2, mid weeks 3-5,
 * expensive everything else.
 */

import { makeRunId } from "./run";
import type {
  EncounterOffer,
  EventChoice,
  EventOffer,
  MerchantListing,
  MerchantOffer,
} from "./run";

/** Stable id surface for every encounter the table can roll. */
export type SznEncounterId =
  | "enc-yard-sale"
  | "enc-friendly-trade"
  | "enc-private-coach"
  | "enc-mystery-box"
  | "enc-international-pipeline"
  | "enc-old-school-gm"
  | "enc-suspicious-grandpa"
  | "enc-clubhouse-prank"
  | "enc-defense-charity"
  | "enc-shady-radio-host"
  | "enc-rain-delay"
  | "enc-streetball"
  | "enc-vacant-lot"
  | "enc-mlb-loophole"
  | "enc-museum"
  | "enc-hobby-shop"
  | "enc-pro-shop"
  | "enc-rival-clubhouse"
  | "enc-cinderella-camp"
  | "enc-clearance-bin";

/**
 * Bucket weeks 1-12 into cheap / mid / expensive tiers. Tier governs
 * which encounters surface AND the cost/power of merchant listings
 * rolled by `items.ts`.
 */
export function weekTier(week: number): "cheap" | "mid" | "expensive" {
  if (week <= 2) return "cheap";
  if (week <= 5) return "mid";
  return "expensive";
}

/** Build a `MerchantListing` quickly. */
function listing(cardId: string, price: number): MerchantListing {
  return { listingId: makeRunId("lst"), cardId, price };
}

// ---------------------------------------------------------------------
// Encounter authors
// ---------------------------------------------------------------------
//
// Each builder takes nothing (encounters are pure data) and returns a
// fully-formed `EncounterOffer`. Encounters with player-pool grants
// (off-roster) are stubbed with `locked: true` choices that surface a
// "COMING SOON" call out alongside an active fallback choice so the
// encounter is never a dead-end.

function enc1_YardSale(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-yard-sale",
    prompt:
      "An old equipment manager is selling junk for cheap. You spot two oddities.",
    choices: [
      {
        choiceId: "wildcard-sticker",
        label: "Wildcard Sticker ($3)",
        resultBlurb: "Pick a player. One of their edges becomes Wildcard.",
        effect: {
          kind: "mutateRosterEdge",
          playerId: "",
          side: "left",
          edge: "wildcard",
        },
        requiresPicker: "player",
        costPreview: 3,
      },
      {
        choiceId: "statcast-optimizer",
        label: "Statcast Optimizer ($4)",
        resultBlurb: "Pick a batter. +Contact left, blank right, +5 score.",
        effect: {
          kind: "mutateRosterEdge",
          playerId: "",
          side: "left",
          edge: "contact",
          alsoBlank: "right",
        },
        requiresPicker: "batter",
        costPreview: 4,
      },
      {
        choiceId: "leave",
        label: "Trust your gut and walk away",
        resultBlurb: "Confidence is a +1 boost on every roster player.",
        effect: { kind: "permanentBoostAll", delta: 1 },
      },
    ],
  };
}

function enc2_FriendlyTrade(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-friendly-trade",
    prompt: "A buddy GM offers you their clubhouse leftovers.",
    choices: [
      {
        choiceId: "sticky-stuff",
        label: "Sticky Stuff ($2)",
        resultBlurb: "Bag +1: snaps any two cards together. 15% destroy risk at lock-in.",
        effect: { kind: "grantItem", cardId: "enc-sticky-stuff" },
        costPreview: 2,
      },
      {
        choiceId: "legal-rosin",
        label: "Legal Rosin ($3)",
        resultBlurb: "Bag +1: snap to any pitcher right-edge, +15 score.",
        effect: { kind: "grantItem", cardId: "enc-legal-rosin" },
        costPreview: 3,
      },
      {
        choiceId: "pass",
        label: "Walk away",
        resultBlurb: "Saved your cash. +$2.",
        effect: { kind: "cash", delta: 2 },
      },
    ],
  };
}

function enc3_PrivateCoach(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-private-coach",
    prompt: "A retired pro offers you off-season player development sessions.",
    choices: [
      {
        choiceId: "swing-adjuster",
        label: "Swing Adjuster ($4)",
        resultBlurb: "Pick a batter. Their edges swap left↔right permanently.",
        effect: { kind: "swapPlayerEdges", playerId: "" },
        requiresPicker: "batter",
        costPreview: 4,
      },
      {
        choiceId: "velocity-program",
        label: "Velocity Program ($5)",
        resultBlurb: "Pick a pitcher. Right edge becomes 102 MPH Fastball.",
        effect: {
          kind: "mutateRosterEdge",
          playerId: "",
          side: "right",
          edge: "fastball-102",
        },
        requiresPicker: "pitcher",
        costPreview: 5,
      },
      {
        choiceId: "pass",
        label: "Pass on the offer",
        resultBlurb: "Coach respects the patience. +$1.",
        effect: { kind: "cash", delta: 1 },
      },
    ],
  };
}

function enc4_MysteryBox(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-mystery-box",
    prompt: "A sealed crate at the warehouse. Worth a roll?",
    choices: [
      {
        choiceId: "left-half",
        label: "Take the Left Mega-Card half ($3)",
        resultBlurb: "Bag +1: find the right half to merge for a 500-score hero card.",
        effect: { kind: "grantItem", cardId: "enc-mega-left" },
        costPreview: 3,
      },
      {
        choiceId: "right-half",
        label: "Take the Right Mega-Card half ($3)",
        resultBlurb: "Bag +1: find the left half to merge for a 500-score hero card.",
        effect: { kind: "grantItem", cardId: "enc-mega-right" },
        costPreview: 3,
      },
      {
        choiceId: "autograph",
        label: "Trade an autograph for cash",
        resultBlurb: "Quick $4.",
        effect: { kind: "cash", delta: 4 },
      },
    ],
  };
}

function enc5_InternationalPipeline(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-international-pipeline",
    prompt: "A scout brings paperwork on overseas free agents.",
    choices: [
      {
        choiceId: "franchise-journeyman",
        label: "Sign a Franchise Journeyman",
        resultBlurb: "Coming soon.",
        effect: { kind: "noop" },
        locked: true,
      },
      {
        choiceId: "position-converter",
        label: "Position Converter ($3)",
        resultBlurb: "Pick a player. Edges convert to Infield + Outfield.",
        effect: {
          kind: "mutateRosterEdge",
          playerId: "",
          side: "both",
          edge: "infield",
        },
        requiresPicker: "player",
        costPreview: 3,
      },
      {
        choiceId: "pass",
        label: "File the paperwork later",
        resultBlurb: "+$1.",
        effect: { kind: "cash", delta: 1 },
      },
    ],
  };
}

function enc6_OldSchoolGm(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-old-school-gm",
    prompt:
      "A grizzled veteran GM pitches you a trade. The fine print is creative.",
    choices: [
      {
        choiceId: "trade-ace",
        label: "Trade for an Ace pitcher",
        resultBlurb: "Coming soon.",
        effect: { kind: "noop" },
        locked: true,
      },
      {
        choiceId: "trade-slugger",
        label: "Trade for a Slugger",
        resultBlurb: "Coming soon.",
        effect: { kind: "noop" },
        locked: true,
      },
      {
        choiceId: "hold-line",
        label: "Hold the line",
        resultBlurb: "Every roster player gets +3 score next series.",
        effect: { kind: "boostNextGameAll", delta: 3 },
      },
    ],
  };
}

function enc7_SuspiciousGrandpa(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-suspicious-grandpa",
    prompt:
      "A wiry old man offers you his prized memorabilia. He swears it's lucky.",
    choices: [
      {
        choiceId: "corked-bat",
        label: "Corked Bat ($5)",
        resultBlurb: "Bag +1: +100 batting score if snapped to OF/INF.",
        effect: { kind: "grantItem", cardId: "enc-corked-bat" },
        costPreview: 5,
      },
      {
        choiceId: "rally-fire",
        label: "Rally Fire Torch ($4)",
        resultBlurb: "Bag +1 AND fires the +10% adjacent-card aura for the rest of the week.",
        effect: { kind: "grantItem", cardId: "enc-rally-fire" },
        costPreview: 4,
      },
      {
        choiceId: "pass",
        label: "Walk away",
        resultBlurb: "Saved $2 for a rainy day.",
        effect: { kind: "cash", delta: 2 },
      },
    ],
  };
}

function enc8_ClubhousePrank(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-clubhouse-prank",
    prompt:
      "The rookies are running a prank war. The clubhouse is chaos.",
    choices: [
      {
        choiceId: "chaos-randomize",
        label: "Let chaos reign",
        resultBlurb: "3 random roster players get re-rolled edges.",
        effect: { kind: "randomizeRosterEdges", count: 3 },
      },
      {
        choiceId: "manual-swap",
        label: "Swap two players' edges (manual pick)",
        resultBlurb: "Pick two players, then which edge(s) to swap.",
        effect: { kind: "swapPlayerEdges", playerId: "" },
        requiresPicker: "edgeSwap",
      },
      {
        choiceId: "suspend",
        label: "Suspend the instigators",
        resultBlurb: "Top scorer on each side suspended next series.",
        effect: { kind: "suspendTopScorers", sides: ["Batting", "Pitching"] },
      },
    ],
  };
}

function enc9_DefenseCharity(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-defense-charity",
    prompt: "A defensive specialist charity drive. The reps want signatures.",
    choices: [
      {
        choiceId: "platinum-glove",
        label: "Platinum Glove ($6)",
        // Grant the actual item card. The SZN item registry's
        // `onAcquire` hook for `enc-platinum-glove` queues +1
        // Defense Shield the moment the card lands in the bag, so
        // the user gets the shield AND a reusable pitching-chain
        // chip in one effect dispatch.
        resultBlurb: "Bag +1 AND +1 Defense Shield charge. Snap it into a pitching chain to bank another.",
        effect: { kind: "grantItem", cardId: "enc-platinum-glove" },
        costPreview: 6,
      },
      {
        choiceId: "city-connect",
        label: "City Connect Jersey ($4)",
        resultBlurb: "Pick a player. Both edges become City Connect.",
        effect: {
          kind: "mutateRosterEdge",
          playerId: "",
          side: "both",
          edge: "city-connect",
        },
        requiresPicker: "player",
        costPreview: 4,
      },
      {
        choiceId: "donate",
        label: "Just donate $2",
        resultBlurb: "Karma bump.",
        effect: { kind: "cash", delta: -2 },
      },
    ],
  };
}

function enc10_ShadyRadioHost(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-shady-radio-host",
    prompt:
      "A late-night radio host wants an interview. The producer hints at... 'edge'.",
    choices: [
      {
        choiceId: "banging-scheme",
        label: "Run a banging scheme (1 series)",
        resultBlurb: "Peek opponent's first card next series.",
        effect: { kind: "queueBangingScheme", weeks: 1 },
      },
      {
        choiceId: "karma",
        label: "Turn on Karma double-trigger",
        resultBlurb: "Passive badge cash + score deposits fire 2x.",
        effect: { kind: "setKarmaDouble", on: true },
      },
      {
        choiceId: "pass",
        label: "Decline the interview",
        resultBlurb: "Your reputation thanks you. +$3.",
        effect: { kind: "cash", delta: 3 },
      },
    ],
  };
}

function enc11_RainDelay(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-rain-delay",
    prompt:
      "Rain delay. The team starts a poker game. Want in?",
    choices: [
      {
        choiceId: "bet-cash",
        label: "Bet $4 for a $10 win (50/50)",
        resultBlurb: "Lose → top pitcher exhausted next series.",
        effect: {
          kind: "pokerCashWager",
          bet: 4,
          winPayout: 10,
          loseExhaustsPitcher: true,
        },
      },
      {
        choiceId: "bet-player",
        label: "Bet a player card on the showdown",
        resultBlurb: "Pick a player. Win → wildcard both edges. Lose → blanked + 0.",
        effect: { kind: "pokerPlayerWager", playerId: "" },
        requiresPicker: "player",
      },
      {
        choiceId: "pass",
        label: "Sit it out",
        resultBlurb: "Manager respects the discipline. +$2.",
        effect: { kind: "cash", delta: 2 },
      },
    ],
  };
}

function enc12_Streetball(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-streetball",
    prompt: "A streetball legend stops you outside the park.",
    choices: [
      {
        choiceId: "drip-cleats",
        label: "Drip Cleats ($4)",
        resultBlurb: "Bag +1: +40 batting score on snap.",
        effect: { kind: "grantItem", cardId: "enc-drip-cleats" },
        costPreview: 4,
      },
      {
        choiceId: "classic-spikes",
        label: "Classic Spikes ($3)",
        resultBlurb: "Bag +1: copies adjacent edge on snap.",
        effect: { kind: "grantItem", cardId: "enc-classic-spikes" },
        costPreview: 3,
      },
      {
        choiceId: "pass",
        label: "Take a photo and bounce",
        resultBlurb: "Social cred only. +$1.",
        effect: { kind: "cash", delta: 1 },
      },
    ],
  };
}

function enc13_VacantLot(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-vacant-lot",
    prompt:
      "A grounds crew member offers to ship you some 'special' clubhouse turf.",
    choices: [
      {
        choiceId: "special-dirt",
        label: "Special Dirt ($5)",
        resultBlurb: "Pick a pitcher. +30 base score for the run.",
        effect: { kind: "scoreOverridePlayer", playerId: "", delta: 30 },
        requiresPicker: "pitcher",
        costPreview: 5,
      },
      {
        choiceId: "blank-edge",
        label: "Punish slackers (-10 every player)",
        resultBlurb: "Every roster player permanently -10.",
        effect: { kind: "permanentBoostAll", delta: -10 },
      },
      {
        choiceId: "pass",
        label: "Cover your tracks",
        resultBlurb: "+$2 from quietly walking away.",
        effect: { kind: "cash", delta: 2 },
      },
    ],
  };
}

function enc14_MlbLoophole(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-mlb-loophole",
    prompt:
      "Your front office lawyer found something in the bylaws. Read it through?",
    choices: [
      {
        choiceId: "execute-loophole",
        label: "Execute the loophole (Expanded 4-edge Card)",
        resultBlurb: "Coming soon.",
        effect: { kind: "noop" },
        locked: true,
      },
      {
        choiceId: "safe-play",
        label: "Play it safe (+$4)",
        resultBlurb: "+$4 from a quiet settlement.",
        effect: { kind: "cash", delta: 4 },
      },
      {
        choiceId: "pass",
        label: "Put the file in a drawer",
        resultBlurb: "+$1.",
        effect: { kind: "cash", delta: 1 },
      },
    ],
  };
}

function enc15_Museum(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-museum",
    prompt:
      "A baseball museum offers your players a relic in exchange for a display.",
    choices: [
      {
        choiceId: "the-torch",
        label: "The Torch ($4)",
        resultBlurb: "Bag +1: snaps onto a player and copies their left edge.",
        effect: { kind: "grantItem", cardId: "enc-the-torch" },
        costPreview: 4,
      },
      {
        choiceId: "display-case",
        label: "Lend a display ($5)",
        resultBlurb: "Sponsorship pays out +$5 next week.",
        effect: { kind: "queueNextWeekCash", delta: 5 },
      },
      {
        choiceId: "pass",
        label: "Decline",
        resultBlurb: "+$1.",
        effect: { kind: "cash", delta: 1 },
      },
    ],
  };
}

function enc16_HobbyShop(): MerchantOffer {
  // Hobby Shop -- general-purpose encounter items, mid-tier prices.
  // Stamped with `sznEncounterId` so the cross-week dedupe ring treats
  // Hobby Shop and the legacy Equipment Manager as DISTINCT encounters
  // even though both flatten to `merchantId: "equipment_manager"` for
  // pricing purposes.
  return {
    kind: "merchant",
    merchantId: "equipment_manager",
    sznEncounterId: "enc-hobby-shop",
    displayLabel: "Hobby Shop",
    displayBlurb: "Mid-tier gear and the season's collectibles.",
    displayGlyph: "🃏",
    listings: [
      listing("enc-legal-rosin", 3),
      listing("enc-rally-fire", 4),
      listing("enc-drip-cleats", 4),
      listing("enc-classic-spikes", 3),
    ],
  };
}

function enc17_ProShop(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-pro-shop",
    prompt: "The Stadium Pro Shop has fresh gear in the back.",
    choices: [
      {
        choiceId: "pro-batting-gloves",
        label: "Pro Batting Gloves ($5)",
        resultBlurb: "Pick a batter. Left edge becomes Contact.",
        effect: {
          kind: "mutateRosterEdge",
          playerId: "",
          side: "left",
          edge: "contact",
        },
        requiresPicker: "batter",
        costPreview: 5,
      },
      {
        choiceId: "pitchers-toe-plate",
        label: "Pitcher's Toe Plate ($5)",
        resultBlurb: "Pick a pitcher. Right edge becomes Velocity.",
        effect: {
          kind: "mutateRosterEdge",
          playerId: "",
          side: "right",
          edge: "velocity",
        },
        requiresPicker: "pitcher",
        costPreview: 5,
      },
      {
        choiceId: "browse",
        label: "Browse only",
        resultBlurb: "Walked out empty-handed. +$1.",
        effect: { kind: "cash", delta: 1 },
      },
    ],
  };
}

function enc18_RivalClubhouse(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-rival-clubhouse",
    prompt:
      "A rival GM's office is empty. There's an open binder on the desk.",
    choices: [
      {
        choiceId: "poach-prospect",
        label: "Poach an overseas prospect",
        resultBlurb: "Coming soon.",
        effect: { kind: "noop" },
        locked: true,
      },
      {
        choiceId: "intel",
        label: "Grab the scouting report",
        resultBlurb: "Banging Scheme +1 series.",
        effect: { kind: "queueBangingScheme", weeks: 1 },
      },
      {
        choiceId: "leave",
        label: "Leave it alone",
        resultBlurb: "Karma +$3 next week.",
        effect: { kind: "queueNextWeekCash", delta: 3 },
      },
    ],
  };
}

function enc19_CinderellaCamp(): EventOffer {
  return {
    kind: "event",
    eventId: "enc-cinderella-camp",
    prompt:
      "Your minor-league camp produced a free crate of replacement parts.",
    choices: [
      {
        choiceId: "free-crate",
        label: "Take the free crate",
        resultBlurb: "Bag +1 random utility item.",
        effect: { kind: "addItemRandom", pool: "any" },
      },
      {
        choiceId: "rally-fire-aura",
        label: "Run Rally Fire next 2 weeks",
        resultBlurb: "Adjacent-card aura for 2 series.",
        effect: { kind: "queueRallyFire", weeks: 2 },
      },
      {
        choiceId: "pass",
        label: "Wave it off",
        resultBlurb: "Sponsor sends you $2.",
        effect: { kind: "cash", delta: 2 },
      },
    ],
  };
}

function enc20_ClearanceBin(): MerchantOffer {
  // Stamped with `sznEncounterId` so the dedupe ring treats Clearance
  // Bin and the legacy Concessions cart as DISTINCT encounters even
  // though both ride the `concessions` merchantId for pricing.
  return {
    kind: "merchant",
    merchantId: "concessions",
    sznEncounterId: "enc-clearance-bin",
    displayLabel: "Clearance Bin",
    displayBlurb: "Picked-over leftovers. Deep discounts.",
    displayGlyph: "🏷️",
    listings: [
      listing("enc-faded-scouting-report", 2),
      listing("enc-duct-tape", 2),
      listing("enc-sticky-stuff", 3),
      listing("enc-legal-rosin", 4),
    ],
  };
}

// ---------------------------------------------------------------------
// Registry + week-tier sampler
// ---------------------------------------------------------------------

type EncounterBuilder = () => EncounterOffer;

interface EncounterEntry {
  id: SznEncounterId;
  build: EncounterBuilder;
  /** Which week tiers this encounter is eligible for. */
  tiers: ("cheap" | "mid" | "expensive")[];
  /** Relative weight inside its tier(s). */
  weight: number;
}

export const SZN_ENCOUNTER_TABLE: EncounterEntry[] = [
  { id: "enc-yard-sale", build: enc1_YardSale, tiers: ["cheap", "mid"], weight: 3 },
  { id: "enc-friendly-trade", build: enc2_FriendlyTrade, tiers: ["cheap", "mid"], weight: 3 },
  { id: "enc-private-coach", build: enc3_PrivateCoach, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-mystery-box", build: enc4_MysteryBox, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-international-pipeline", build: enc5_InternationalPipeline, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-old-school-gm", build: enc6_OldSchoolGm, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-suspicious-grandpa", build: enc7_SuspiciousGrandpa, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-clubhouse-prank", build: enc8_ClubhousePrank, tiers: ["cheap", "mid", "expensive"], weight: 3 },
  { id: "enc-defense-charity", build: enc9_DefenseCharity, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-shady-radio-host", build: enc10_ShadyRadioHost, tiers: ["expensive"], weight: 2 },
  { id: "enc-rain-delay", build: enc11_RainDelay, tiers: ["cheap", "mid"], weight: 3 },
  { id: "enc-streetball", build: enc12_Streetball, tiers: ["cheap", "mid"], weight: 3 },
  { id: "enc-vacant-lot", build: enc13_VacantLot, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-mlb-loophole", build: enc14_MlbLoophole, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-museum", build: enc15_Museum, tiers: ["cheap", "mid"], weight: 3 },
  { id: "enc-hobby-shop", build: enc16_HobbyShop, tiers: ["cheap", "mid"], weight: 3 },
  { id: "enc-pro-shop", build: enc17_ProShop, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-rival-clubhouse", build: enc18_RivalClubhouse, tiers: ["mid", "expensive"], weight: 2 },
  { id: "enc-cinderella-camp", build: enc19_CinderellaCamp, tiers: ["cheap", "mid"], weight: 3 },
  { id: "enc-clearance-bin", build: enc20_ClearanceBin, tiers: ["mid", "expensive"], weight: 2 },
];

/**
 * Stable id for any `EncounterOffer`. The "no repeat encounters this
 * week" rule keys off this string so an EventOffer / MerchantOffer /
 * PlayerMarketOffer all flatten into the same dedupe namespace.
 *
 * Encounters share an id ⇒ they're the same encounter for the rule.
 * The id format mirrors what `rollSznEncounterSlate` used internally
 * before being promoted to module scope; lifting it lets the gameStore
 * and `rollDailyOffers` filter against the same vocabulary.
 */
export function encounterOfferId(offer: EncounterOffer): string {
  if (offer.kind === "event") return offer.eventId;
  if (offer.kind === "merchant") {
    // SZN-themed merchants (Hobby Shop, Clearance Bin) carry their
    // originating SZN encounter id so the dedupe namespace stays
    // disambiguated from the legacy `merchant:<merchantId>` namespace
    // -- otherwise seeing Hobby Shop would silently block the legacy
    // Equipment Manager (both flatten to the same merchantId for
    // pricing, but they're different encounters with different stock
    // and flavor). The SZN encounter id is identical to the
    // SZN_ENCOUNTER_TABLE entry's `id`, which is what
    // `rollSznEncounter` filters its exclude set against -- so this
    // also fixes the prior bug where rolling Hobby Shop didn't
    // actually prevent Hobby Shop from rolling again later in the
    // same week.
    if (offer.sznEncounterId) return offer.sznEncounterId;
    return `merchant:${offer.merchantId}`;
  }
  return `market:${offer.label}`;
}

/**
 * Pull one encounter at random for the given week. Weighted sampling
 * within the eligible tier; encounters that don't match the current
 * tier are skipped. `excludeIds` optionally narrows the eligible pool
 * so already-seen encounters this week don't surface again.
 */
export function rollSznEncounter(
  week: number,
  excludeIds?: ReadonlySet<string>,
): EncounterOffer {
  const tier = weekTier(week);
  const baseEligible = SZN_ENCOUNTER_TABLE.filter((e) => e.tiers.includes(tier));
  const eligible =
    excludeIds && excludeIds.size > 0
      ? baseEligible.filter((e) => !excludeIds.has(e.id))
      : baseEligible;
  // If excludes wiped the eligible pool clean (entire tier exhausted),
  // fall back to the unfiltered tier so we always return SOMETHING --
  // the caller would otherwise crash on an empty array.
  const pool = eligible.length > 0 ? eligible : baseEligible;
  const totalWeight = pool.reduce((acc, e) => acc + e.weight, 0);
  let r = Math.random() * totalWeight;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return e.build();
  }
  return pool[0].build();
}

/**
 * Pull N unique encounters for one Front Office day. Dedupes WITHIN the
 * slate so the same encounter never appears twice in one day, AND
 * filters against the optional `excludeIds` set (week-level dedupe) so
 * the caller can enforce "no encounter twice in a week" by passing the
 * union of every encounter that has already been rendered this week.
 *
 * `recentRing` is an OPTIONAL cross-week "recently seen" ring. The
 * rule: if applying `recentRing` would still leave at least one
 * eligible entry in the current tier, we apply it (so last week's
 * Thursday slate can't bleed into this week's Monday Front Office).
 * If applying it would drain the tier dry the ring is ignored for
 * THIS slate (better to show a recent encounter than an empty slot)
 * and a dev-only `console.debug` is emitted so playtest can spot
 * pool exhaustion.
 *
 * If the eligible pool is exhausted even after dropping the recent
 * ring, the tail allows repeats so the slate always fills the
 * requested length.
 */
export function rollSznEncounterSlate(
  week: number,
  n: number,
  excludeIds?: ReadonlySet<string>,
  recentRing?: ReadonlySet<string>,
): EncounterOffer[] {
  const tier = weekTier(week);
  const baseTier = SZN_ENCOUNTER_TABLE.filter((e) => e.tiers.includes(tier));
  // Effective pool size after week-level excludes. If the week has burned
  // through almost the whole tier already, we relax the dedupe at the
  // tail so the day still surfaces N offers (better to show a re-roll
  // than an empty slot).
  const remainingAfterExcludes = excludeIds
    ? baseTier.filter((e) => !excludeIds.has(e.id)).length
    : baseTier.length;
  // Only honor the cross-week recent ring when applying it would still
  // leave the tier with enough headroom to fill the slate. Otherwise
  // the ring "wins" and we'd loop the safety counter trying to find a
  // candidate that doesn't exist.
  let effectiveRing: ReadonlySet<string> | undefined;
  if (recentRing && recentRing.size > 0) {
    const remainingAfterRing = baseTier.filter(
      (e) => !excludeIds?.has(e.id) && !recentRing.has(e.id),
    ).length;
    if (remainingAfterRing >= 1) {
      effectiveRing = recentRing;
    } else if (process.env.NODE_ENV !== "production") {
      // Dev-only telemetry so playtest can spot pool exhaustion: the
      // cross-week ring would drain this tier dry, so we're falling
      // back to "anything not seen this week" for this slate.
      console.debug(
        `[sznEncounters] tier="${tier}" week=${week} recent ring drained pool; skipping cross-week filter for this slate`,
      );
    }
  }

  const offers: EncounterOffer[] = [];
  const seenInSlate = new Set<string>();
  let fellBackToRepeat = false;
  let safety = 0;
  while (offers.length < n && safety < 64) {
    safety += 1;
    // Combine week-level excludes with the optional cross-week ring
    // and the in-slate dedupe; the union is what we hand to
    // `rollSznEncounter` so it filters before sampling instead of
    // looping us up to the safety cap.
    const combined = new Set<string>(excludeIds ?? []);
    if (effectiveRing) for (const id of effectiveRing) combined.add(id);
    for (const id of seenInSlate) combined.add(id);
    const next = rollSznEncounter(week, combined);
    const id = encounterOfferId(next);
    // If we've genuinely exhausted unique candidates (week-level dedupe
    // drained the tier), allow repeats to fill the slot.
    if (seenInSlate.has(id) && offers.length < remainingAfterExcludes) continue;
    if (seenInSlate.has(id)) fellBackToRepeat = true;
    seenInSlate.add(id);
    offers.push(next);
  }
  if (fellBackToRepeat && process.env.NODE_ENV !== "production") {
    console.debug(
      `[sznEncounters] tier="${tier}" week=${week} allowed repeats to fill slate (pool exhausted)`,
    );
  }
  return offers;
}

// Helpers so encounter ids and lookup remain accessible to debug tools.
export { enc1_YardSale, enc2_FriendlyTrade, enc4_MysteryBox };
