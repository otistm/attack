import { ShapeType } from "../components/cardShapes";
// Type-only import: cards.ts stores SZN edges as `string` to avoid a
// cyclic runtime dependency, but the per-run randomizer below needs
// to pull from the typed `SznEdgeId` union so the chosen edges stay
// in the registry. `sznEdges.ts` doesn't import from `cards.ts`, so
// the type-only import doesn't create a real cycle.
import type { SznEdgeId } from "./sznEdges";
// Brawl Mode taglines: pure data, no back-reference into cards.ts,
// stamped onto SESSION_CARDS at module load (see bottom of file).
import { BRAWL_TAGLINE_DRAFT } from "./brawlTaglines";

export type CardType = "Batting" | "Pitching";
export type CardAbilityType = string;
export type Handedness = "L" | "R" | "S";

export interface CombineConstraint {
  // If set, this card can only combine when the OTHER side's shape is in this list.
  allowedShapes?: ShapeType[];
  // Card cannot be combined at all (overrides shape matching).
  noCombine?: boolean;
  // Card's left side cannot be combined (right side may still combine).
  leftNoCombine?: boolean;
  // Card's right side cannot be combined.
  rightNoCombine?: boolean;
  // Treat the left side as a wildcard for matching, even though leftShape is a real shape.
  leftWildcard?: boolean;
  // Treat the right side as a wildcard for matching.
  rightWildcard?: boolean;
  /**
   * Hard floor on the chain length this card needs to score. When the card is
   * scored as part of a chain shorter than `requireChainLength`, the scoring
   * engine zeros BOTH the card's baseValue and its registered effect for the
   * round (functionally identical to `disabled`, but conditional on chain
   * structure rather than a hand-transform kill switch).
   *
   * Chains here count cards mechanically AND user-affirmed-connected (the
   * same group the scoring engine builds), so a card with `requireChainLength: 4`
   * sitting in a chain of 3 contributes 0 even if the player intended otherwise.
   * Pure data: the constraint is enforced in `scoring.ts` (see `scoreGroup`).
   */
  requireChainLength?: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  player?: string;
  type: CardType;
  abilityType: CardAbilityType;
  baseValue: number;
  leftShape: ShapeType;
  rightShape: ShapeType;
  description: string;
  /**
   * Brawl-only one-line ability text rendered DIRECTLY on the card face
   * (between the name and the value) instead of in the hover tooltip. The
   * 15s snap timer leaves no room to hover-read multi-clause descriptions,
   * so every brawl-eligible card carries a ≤28-char tagline drafted in
   * `brawlTaglines.ts`. When absent, the card is excluded from the brawl
   * general pool. Full-game modes ignore this field.
   */
  brawlTagline?: string;
  color?: string;
  /**
   * Tags that other cards' effects key off. Free-form strings, but the live
   * taxonomy is enumerated in `TAGS` below -- new cards should reuse those
   * literals rather than coining one-off strings, so the synergy graph stays
   * legible and tests can audit "every new tag has at least 2 keyers".
   */
  tags?: TagLiteral[];
  // Player handedness, referenced by p-37 Cy Young Heat.
  handedness?: Handedness;
  // Structured combine rules consulted by the connection engine.
  combineConstraint?: CombineConstraint;
  /**
   * Round-level kill switch set by hand-transforms (b-23 Stolen Base Threat
   * uses it to silence pitcher generals). When true the scoring engine zeros
   * the card's effect AND its base value, and the UI renders the X-mark
   * blocked silhouette across both sides. Cards never declare this themselves
   * -- it's only ever spliced on by `applyHandTransforms`.
   */
  disabled?: boolean;
  /**
   * SZN-only: when this card was dealt from the run's item bag, the
   * source `Item.instanceId` is stamped onto the dealt clone so the
   * `SznFooterDecks` Abilities column can hide only the specific
   * instance that's in the hand (not every bag entry that happens to
   * share the same `cardId`). Never set on static `SESSION_CARDS` entries.
   */
  sznInstanceId?: string;
  /**
   * SZN-only: Bazaar-style item tier (`bronze` | `silver` | `gold`).
   * Stamped onto the dealt clone in `sznDealItem` from the source
   * bag {@link Item.tier} so the scoring engine + per-card hooks can
   * scale this item's contribution at scoring time. Treated as
   * `"bronze"` when absent (every legacy / non-item card path).
   * Imported as `string` to avoid a cyclic type dep with
   * `itemTiers.ts`; runtime callers cast to `ItemTier`.
   */
  sznItemTier?: string;
  /**
   * SZN-only: semantic left/right edge ids carried by player-as-card
   * adapters for SZN players (see `playerAsCard` in `connect.ts`).
   * When present, the SZN combat path consults these via `canSznConnect`
   * INSTEAD of the geometric shape engine. Item cards never set these.
   *
   * Imported as `string` to avoid a cyclic type dependency with
   * `sznEdges.ts`; runtime callers cast to `SznEdgeId` after retrieval.
   */
  sznLeftEdge?: string;
  sznRightEdge?: string;
}

/**
 * Tag taxonomy (Phase 5 expansion). Each tag has at least one card that *carries*
 * the tag and at least one card whose effect *keys off* the tag, so any new
 * tagging shows up in real gameplay rather than as dead metadata.
 *
 * Pitch-shape tags describe what the card represents at the plate:
 * - `fastball`    : straight heat (squares, raw velocity).
 * - `breaking-ball`: curve/slider movement (diamonds).
 * - `off-speed`   : changeup-style velocity drop (circles, splitters).
 *
 * Player-archetype tags describe the player on the card:
 * - `power-hitter`: bat speed / HR threats (Judge, Vlad, Harper, Acuña).
 * - `speedster`   : stolen-base / contact runners (De La Cruz, Witt, Acuña).
 * - `clutch`      : late-inning specialists (Harper, Betts, Witt).
 * - `lefty`       : left-handed batter or pitcher (Ohtani, Soto, Harper, Sale).
 * - `veteran`     : multi-year established (Judge, Cole, Wheeler, Sale).
 * - `rookie`      : recent debut / breakout (Skenes, De La Cruz).
 * - `closer`      : 9th-inning bullpen role (Clase, Miller).
 * - `starter`     : multi-inning rotation arm (most pitcher signatures).
 */
export const TAGS = {
  fastball: "fastball",
  breakingBall: "breaking-ball",
  offSpeed: "off-speed",
  powerHitter: "power-hitter",
  speedster: "speedster",
  clutch: "clutch",
  lefty: "lefty",
  veteran: "veteran",
  rookie: "rookie",
  closer: "closer",
  starter: "starter",
} as const;

export type TagLiteral = (typeof TAGS)[keyof typeof TAGS];

/** Convenience: full set of tag values, ordered. */
export const ALL_TAGS: TagLiteral[] = Object.values(TAGS);

export const ALL_CARDS: CardDefinition[] = [
  {
    "id": "b-1",
    "name": "All Rise",
    "player": "Aaron Judge (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "If combined, +4 Value.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"]
  },
  {
    "id": "b-2",
    "name": "Judge's Chamber",
    "player": "Aaron Judge (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "Pitcher's highest uncombined card gets -2 Value.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"]
  },
  {
    "id": "b-3",
    "name": "Barrel It Up",
    "player": "Aaron Judge (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "Can only combine with SQUARE or DIAMOND. If combined, +3 Value.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"],
    "combineConstraint": { "allowedShapes": ["square", "diamond"] }
  },
  {
    "id": "b-4",
    "name": "Unicorn Swing",
    "player": "Shohei Ohtani (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 9,
    "leftShape": "star",
    "rightShape": "star",
    "description": "Cannot be combined. High base value.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "veteran"],
    "handedness": "L",
    "combineConstraint": { "noCombine": true }
  },
  {
    "id": "b-5",
    "name": "Opposite Field Power",
    "player": "Shohei Ohtani (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "Reverses your Left and Right shapes on all your cards this round.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "veteran"],
    "handedness": "L"
  },
  {
    "id": "b-6",
    "name": "50/50 Club",
    "player": "Shohei Ohtani (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+5 Hit Scale (your hit goes further when you win).",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "veteran"],
    "handedness": "L"
  },
  {
    "id": "b-7",
    "name": "Soto Shuffle",
    "player": "Juan Soto (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "Reveal the Pitcher's uncombined cards before you lock in your layout.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "veteran"]
  },
  {
    "id": "b-8",
    "name": "Elite Eye",
    "player": "Juan Soto (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 3,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+3 Value to your highest uncombined card.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "veteran"]
  },
  {
    "id": "b-9",
    "name": "Generational Discipline",
    "player": "Juan Soto (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "square",
    "description": "Ignores all Pitcher debuff mechanics this round.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "veteran"]
  },
  {
    "id": "b-10",
    "name": "Electric Speed",
    "player": "Elly De La Cruz (CIN)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "wildcard",
    "rightShape": "wildcard",
    "description": "Both sides are Wildcards and match any shape.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "rookie"]
  },
  {
    "id": "b-11",
    "name": "Chaos on the Basepaths",
    "player": "Elly De La Cruz (CIN)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "If you win with this card uncombined, an automatic Single is awarded regardless of score.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "rookie"]
  },
  {
    "id": "b-12",
    "name": "Switch Hitter",
    "player": "Elly De La Cruz (CIN)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "Change the shape on one side of one of your General cards this round.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "rookie"]
  },
  {
    "id": "b-13",
    "name": "Leadoff Magic",
    "player": "Mookie Betts (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "diamond",
    "rightShape": "diamond",
    "description": "+4 Value if this is the first at-bat of the inning.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },
  {
    "id": "b-14",
    "name": "Bowling Strike",
    "player": "Mookie Betts (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "star",
    "description": "If combined with a SQUARE, +3 Value.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },
  {
    "id": "b-15",
    "name": "Mookie's Hustle",
    "player": "Mookie Betts (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "Left side acts as a Wildcard.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"],
    "combineConstraint": { "leftWildcard": true }
  },
  {
    "id": "b-16",
    "name": "Junior's Jump",
    "player": "Bobby Witt Jr. (KCR)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "If combined with a DIAMOND, +4 Value.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "clutch"]
  },
  {
    "id": "b-17",
    "name": "Line Drive",
    "player": "Bobby Witt Jr. (KCR)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "Pitcher's combined values are reduced by 2.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "clutch"]
  },
  {
    "id": "b-18",
    "name": "In The Gap",
    "player": "Bobby Witt Jr. (KCR)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "square",
    "rightShape": "star",
    "description": "If combined and you win, +3 Hit Scale.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "clutch"]
  },
  {
    "id": "b-19",
    "name": "Philly Clutch",
    "player": "Bryce Harper (PHI)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "star",
    "rightShape": "diamond",
    "description": "+5 Value if your team has 2 Outs.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "clutch", "veteran"]
  },
  {
    "id": "b-20",
    "name": "Showman",
    "player": "Bryce Harper (PHI)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "If this card is between two combined neighbors, base value becomes 12.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "clutch", "veteran"]
  },
  {
    "id": "b-21",
    "name": "The Pandemonium",
    "player": "Bryce Harper (PHI)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "Destroys one of the Pitcher's uncombined General cards.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty", "clutch", "veteran"]
  },
  {
    "id": "b-22",
    "name": "Power/Speed Threat",
    "player": "Ronald Acuña Jr. (ATL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "square",
    "description": "If combined, flip a coin. Heads: +5 Value. Tails: +1 Value.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "speedster"]
  },
  {
    "id": "b-23",
    "name": "Stolen Base Threat",
    "player": "Ronald Acuña Jr. (ATL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "Pitcher cannot use any General cards this round.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "speedster"]
  },
  {
    "id": "b-24",
    "name": "Deep Drive",
    "player": "Ronald Acuña Jr. (ATL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "Can only combine with CIRCLE.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "speedster"],
    "combineConstraint": { "allowedShapes": ["circle"] }
  },
  {
    "id": "b-25",
    "name": "Rookie of the Year",
    "player": "Gunnar Henderson (BAL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+2 Value for every uncombined card you leave on the table.",
    "color": "bg-emerald-500",
    "tags": ["rookie", "lefty", "speedster"]
  },
  {
    "id": "b-26",
    "name": "Shortstop Slap",
    "player": "Gunnar Henderson (BAL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "square",
    "description": "If combined on the right, +4 Value.",
    "color": "bg-emerald-500",
    "tags": ["rookie", "lefty", "speedster"]
  },
  {
    "id": "b-27",
    "name": "Camden Power",
    "player": "Gunnar Henderson (BAL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+3 Value if the Pitcher's base card is a Fastball.",
    "color": "bg-emerald-500",
    "tags": ["rookie", "lefty", "speedster"]
  },
  {
    "id": "b-28",
    "name": "Vlad's Vengeance",
    "player": "Vladimir Guerrero Jr. (TOR)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "Cannot be combined on the left side.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"],
    "combineConstraint": { "leftNoCombine": true }
  },
  {
    "id": "b-29",
    "name": "Home Run Derby",
    "player": "Vladimir Guerrero Jr. (TOR)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+1 Value for every CIRCLE on the board.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"]
  },
  {
    "id": "b-30",
    "name": "Laser Show",
    "player": "Vladimir Guerrero Jr. (TOR)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "Pitcher's base card value is halved (rounded down).",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"]
  },
  {
    "id": "p-31",
    "name": "Splinker",
    "player": "Paul Skenes (PIT)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 9,
    "leftShape": "square",
    "rightShape": "square",
    "description": "High base value. Batter cannot use Wildcards.",
    "color": "bg-blue-500",
    "tags": ["fastball", "rookie", "starter"]
  },
  {
    "id": "p-32",
    "name": "Triple Digits",
    "player": "Paul Skenes (PIT)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "Cannot be combined. If played uncombined, +2 Value.",
    "color": "bg-blue-500",
    "tags": ["fastball", "rookie", "starter"],
    "combineConstraint": { "noCombine": true }
  },
  {
    "id": "p-33",
    "name": "The Mustache",
    "player": "Paul Skenes (PIT)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "Shrinks the Batter's hit by 3 — pushes the Batter one rung down the Hit Scale ladder.",
    "color": "bg-blue-500",
    "tags": ["rookie", "starter"]
  },
  {
    "id": "p-34",
    "name": "Cole Train",
    "player": "Gerrit Cole (NYY)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "star",
    "rightShape": "diamond",
    "description": "+3 Value if combined on the right side.",
    "color": "bg-blue-500",
    "tags": ["fastball", "veteran", "starter"]
  },
  {
    "id": "p-35",
    "name": "Knuckle Curve",
    "player": "Gerrit Cole (NYY)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "Batter cannot combine SQUAREs this round.",
    "color": "bg-blue-500",
    "tags": ["breaking-ball", "veteran", "starter"]
  },
  {
    "id": "p-36",
    "name": "Ace's Command",
    "player": "Gerrit Cole (NYY)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "Nullifies the mechanic of the Batter's highest valued card.",
    "color": "bg-blue-500",
    "tags": ["veteran", "starter"]
  },
  {
    "id": "p-37",
    "name": "Cy Young Heat",
    "player": "Tarik Skubal (DET)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+2 Value if the Batter is using a left-handed player.",
    "color": "bg-blue-500",
    "tags": ["fastball", "lefty", "starter"]
  },
  {
    "id": "p-38",
    "name": "Wipeout Changeup",
    "player": "Tarik Skubal (DET)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "If combined, subtract 3 from the Batter's score.",
    "color": "bg-blue-500",
    "tags": ["off-speed", "lefty", "starter"]
  },
  {
    "id": "p-39",
    "name": "Mound Presence",
    "player": "Tarik Skubal (DET)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "square",
    "description": "Batter must discard 1 General card before playing.",
    "color": "bg-blue-500",
    "tags": ["lefty", "starter"]
  },
  {
    "id": "p-40",
    "name": "Wheeler's Workhorse",
    "player": "Zack Wheeler (PHI)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+1 Value for every card the Batter combines.",
    "color": "bg-blue-500",
    "tags": ["fastball", "veteran", "starter"]
  },
  {
    "id": "p-41",
    "name": "Sweeping Slider",
    "player": "Zack Wheeler (PHI)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "Break the Batter's combo (Choose one connection to nullify).",
    "color": "bg-blue-500",
    "tags": ["breaking-ball", "veteran", "starter"]
  },
  {
    "id": "p-42",
    "name": "Paint the Corners",
    "player": "Zack Wheeler (PHI)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "diamond",
    "description": "Batter's base value is capped at 6 before combos.",
    "color": "bg-blue-500",
    "tags": ["veteran", "starter"]
  },
  {
    "id": "p-43",
    "name": "100 MPH Cutter",
    "player": "Emmanuel Clase (CLE)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 9,
    "leftShape": "none",
    "rightShape": "none",
    "description": "Flat edges. Cannot be combined. Pure overpowering heat.",
    "color": "bg-blue-500",
    "tags": ["fastball", "closer", "veteran"],
    "combineConstraint": { "noCombine": true }
  },
  {
    "id": "p-44",
    "name": "Unhittable",
    "player": "Emmanuel Clase (CLE)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "If you win the round, it counts as 2 Outs instead of 1.",
    "color": "bg-blue-500",
    "tags": ["closer", "veteran"]
  },
  {
    "id": "p-45",
    "name": "Game Over",
    "player": "Emmanuel Clase (CLE)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+5 Value if it is the 9th Inning (or final inning).",
    "color": "bg-blue-500",
    "tags": ["closer", "veteran"]
  },
  {
    "id": "p-46",
    "name": "Pure Gas",
    "player": "Mason Miller (OAK)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "+2 Value if you have no combinations this round.",
    "color": "bg-blue-500",
    "tags": ["fastball", "closer", "rookie"]
  },
  {
    "id": "p-47",
    "name": "Rising Fastball",
    "player": "Mason Miller (OAK)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "star",
    "rightShape": "diamond",
    "description": "Batter's DIAMOND shapes are treated as None (Flat).",
    "color": "bg-blue-500",
    "tags": ["fastball", "closer", "rookie"]
  },
  {
    "id": "p-48",
    "name": "Lights Out",
    "player": "Mason Miller (OAK)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "If Batter's total is exactly equal to yours, Pitcher wins the tie.",
    "color": "bg-blue-500",
    "tags": ["closer", "rookie"]
  },
  {
    "id": "p-49",
    "name": "The Condor",
    "player": "Chris Sale (ATL)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "square",
    "rightShape": "square",
    "description": "Reverses the Batter's Left and Right shapes.",
    "color": "bg-blue-500",
    "tags": ["lefty", "veteran", "starter"]
  },
  {
    "id": "p-50",
    "name": "Devastating Slider",
    "player": "Chris Sale (ATL)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "If Batter combines 3 cards, subtract 6 from their score.",
    "color": "bg-blue-500",
    "tags": ["breaking-ball", "lefty", "veteran", "starter"]
  },
  {
    "id": "p-51",
    "name": "Veteran Savvy",
    "player": "Chris Sale (ATL)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "Reveal the Batter's hand before you lock in your layout.",
    "color": "bg-blue-500",
    "tags": ["lefty", "veteran", "starter"]
  },
  {
    "id": "p-52",
    "name": "Sweeper",
    "player": "Shohei Ohtani (LAD)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "If uncombined, Batter's highest uncombined card gets -3 Value.",
    "color": "bg-blue-500",
    "tags": ["breaking-ball", "starter", "veteran"]
  },
  {
    "id": "p-53",
    "name": "Splitter",
    "player": "Shohei Ohtani (LAD)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "Value becomes equal to the Batter's highest combined total.",
    "color": "bg-blue-500",
    "tags": ["off-speed", "starter", "veteran"]
  },
  {
    "id": "p-54",
    "name": "Dual Threat",
    "player": "Shohei Ohtani (LAD)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "Draw 1 extra Pitching General card this round.",
    "color": "bg-blue-500",
    "tags": ["starter", "veteran"]
  },
  {
    "id": "p-55",
    "name": "Rainbow Curve",
    "player": "Yoshinobu Yamamoto (LAD)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "+3 Value if combined on the left side.",
    "color": "bg-blue-500",
    "tags": ["breaking-ball", "starter"]
  },
  {
    "id": "p-56",
    "name": "Pinpoint Control",
    "player": "Yoshinobu Yamamoto (LAD)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "Change the shape of one side of one of your cards this round.",
    "color": "bg-blue-500",
    "tags": ["off-speed", "starter"]
  },
  {
    "id": "p-57",
    "name": "The Japanese Ace",
    "player": "Yoshinobu Yamamoto (LAD)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "star",
    "rightShape": "square",
    "description": "+4 Value if the Batter uses no combinations.",
    "color": "bg-blue-500",
    "tags": ["starter"]
  },
  {
    "id": "p-58",
    "name": "Strikeout Artist",
    "player": "Dylan Cease (SDP)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "If Pitcher wins by more than 5 points, next Batter starts with -2.",
    "color": "bg-blue-500",
    "tags": ["breaking-ball", "starter", "veteran"]
  },
  {
    "id": "p-59",
    "name": "Nasty Slider",
    "player": "Dylan Cease (SDP)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "Batter must reveal their layout before Pitcher locks in.",
    "color": "bg-blue-500",
    "tags": ["breaking-ball", "starter", "veteran"]
  },
  {
    "id": "p-60",
    "name": "Filthy Stuff",
    "player": "Dylan Cease (SDP)",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "Subtract 1 from the Batter's score for every SQUARE card they play.",
    "color": "bg-blue-500",
    "tags": ["starter", "veteran"]
  },
  {
    "id": "b-61",
    "name": "Power Swing",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "Can only combine with SQUARE or DIAMOND.",
    "color": "bg-amber-500",
    "tags": ["power-hitter"],
    "combineConstraint": { "allowedShapes": ["square", "diamond"] }
  },
  {
    "id": "b-62",
    "name": "Contact Swing",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "If combined, +2 Value.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-63",
    "name": "Bunt Attempt",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "star",
    "description": "+2 Value. If you win, your hit is capped at a Single (no double-play risk).",
    "color": "bg-amber-500",
    "tags": ["speedster"]
  },
  {
    "id": "b-64",
    "name": "Good Eye",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 3,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "+4 Value if the Pitcher uses a Fastball.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-65",
    "name": "Guess Pitch",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "star",
    "description": "Name a shape. If Pitcher uses it, +4 Value. Otherwise +1.",
    "color": "bg-amber-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-66",
    "name": "Solid Contact",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "If combined and you win, +2 Hit Scale.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-67",
    "name": "Foul Ball",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "Discard this to redraw 2 Batting General cards.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-68",
    "name": "Steal Sign",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 3,
    "leftShape": "diamond",
    "rightShape": "diamond",
    "description": "Left side acts as a Wildcard.",
    "color": "bg-amber-500",
    "tags": ["speedster"],
    "combineConstraint": { "leftWildcard": true }
  },
  {
    "id": "b-69",
    "name": "Sacrifice Fly",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 3,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "If you lose, a runner on 3rd still scores.",
    "color": "bg-amber-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-70",
    "name": "The Sweet Spot",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 7,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "If this card is between two combined neighbors and you win, +15 Hit Scale.",
    "color": "bg-amber-500",
    "tags": ["power-hitter"]
  },
  {
    "id": "b-71",
    "name": "Manager's Challenge",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 3,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "Batter wins all ties this round (overrides Pitcher tie-breakers).",
    "color": "bg-amber-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-72",
    "name": "Walk-Off Swing",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "star",
    "description": "+1 Value for each other CLUTCH card in your hand.",
    "color": "bg-amber-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-73",
    "name": "Stolen Sign Read",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "If your hand has 2+ other SPEEDSTER cards, +3 Hit Scale.",
    "color": "bg-amber-500",
    "tags": ["speedster"]
  },
  {
    "id": "b-74",
    "name": "Veteran Presence",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "+1 Value for each other VETERAN card in your hand.",
    "color": "bg-amber-500",
    "tags": ["veteran"]
  },
  {
    "id": "b-75",
    "name": "Rookie Energy",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+5 Value if another ROOKIE card is in your hand.",
    "color": "bg-amber-500",
    "tags": ["rookie"]
  },
  {
    "id": "b-76",
    "name": "Power Stance",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "If combined and another POWER-HITTER is in your hand, +3 Value.",
    "color": "bg-amber-500",
    "tags": ["power-hitter"]
  },
  {
    "id": "b-77",
    "name": "Closer Hunter",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "square",
    "description": "+5 Value if the Pitcher is a CLOSER.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-78",
    "name": "Bullpen Beater",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "diamond",
    "description": "Subtract 2 from the Pitcher's score if they are a STARTER.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-79",
    "name": "Lefty Killer",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+4 Value if the Pitcher is LEFTY.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-80",
    "name": "Off-Speed Spotter",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "+3 Value if the Pitcher uses an OFF-SPEED pitch.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-91",
    "name": "RBI Threat",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+3 Value with a runner in scoring position (2nd or 3rd).",
    "color": "bg-amber-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-92",
    "name": "Grand Slam Threat",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "star",
    "description": "+6 Value with the bases loaded.",
    "color": "bg-amber-500",
    "tags": ["power-hitter"]
  },
  {
    "id": "b-93",
    "name": "Comeback Kid",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "+4 Value if your team is losing.",
    "color": "bg-amber-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-94",
    "name": "Front-Runner",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+2 Value if your team is leading.",
    "color": "bg-amber-500",
    "tags": ["veteran"]
  },
  {
    "id": "b-95",
    "name": "Late Innings Hero",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+4 Value in the 7th inning or later.",
    "color": "bg-amber-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-96",
    "name": "Home Cookin'",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "+2 Value during the bottom of any inning (home at-bat).",
    "color": "bg-amber-500"
  },
  {
    "id": "p-71",
    "name": "Four-Seam Fastball",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "square",
    "description": "Standard Heat. +1 Value if uncombined.",
    "color": "bg-violet-500",
    "tags": ["fastball"]
  },
  {
    "id": "p-72",
    "name": "12-to-6 Curveball",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "If combined with a DIAMOND, subtract 3 from the Batter's score.",
    "color": "bg-violet-500",
    "tags": ["breaking-ball"]
  },
  {
    "id": "p-73",
    "name": "Changeup",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+3 Value if combined with a Fastball card.",
    "color": "bg-violet-500",
    "tags": ["off-speed"]
  },
  {
    "id": "p-74",
    "name": "Backdoor Slider",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "+1 Value for every CIRCLE the Batter has in play.",
    "color": "bg-violet-500",
    "tags": ["breaking-ball"]
  },
  {
    "id": "p-75",
    "name": "Pickoff Move",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 3,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+2 Value vs SPEEDSTER batters. Automatically erases one base runner if you win the round.",
    "color": "bg-violet-500"
  },
  {
    "id": "p-76",
    "name": "Pitch Framing",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "+2 Value to your highest uncombined card.",
    "color": "bg-violet-500"
  },
  {
    "id": "p-77",
    "name": "Mound Visit",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 2,
    "leftShape": "diamond",
    "rightShape": "diamond",
    "description": "Swap your lowest-Value card for a fresh General Pitching card.",
    "color": "bg-violet-500"
  },
  {
    "id": "p-78",
    "name": "The Shift",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "square",
    "description": "Batter's STAR combos are nullified.",
    "color": "bg-violet-500"
  },
  {
    "id": "p-79",
    "name": "Intentional Walk",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 0,
    "leftShape": "none",
    "rightShape": "none",
    "description": "Skip this at-bat. Batter gets a Base Hit. (Use to avoid giving up a HR).",
    "color": "bg-violet-500",
    "combineConstraint": { "noCombine": true }
  },
  {
    "id": "p-80",
    "name": "Umpire's Call",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 2,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "Pitcher wins all ties this round.",
    "color": "bg-violet-500"
  },
  {
    "id": "p-81",
    "name": "Slider",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "+2 Value if combined with another BREAKING-BALL.",
    "color": "bg-violet-500",
    "tags": ["breaking-ball"]
  },
  {
    "id": "p-82",
    "name": "Splitter",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+3 Value if combined with a FASTBALL.",
    "color": "bg-violet-500",
    "tags": ["off-speed"]
  },
  {
    "id": "p-83",
    "name": "Sinker",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "square",
    "description": "+1 Value for each SQUARE the Batter has in play.",
    "color": "bg-violet-500",
    "tags": ["fastball"]
  },
  {
    "id": "p-84",
    "name": "Cutter",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+2 Value if uncombined.",
    "color": "bg-violet-500",
    "tags": ["fastball"]
  },
  {
    "id": "p-85",
    "name": "Closer's Mentality",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "+4 Value if another CLOSER card is in your hand.",
    "color": "bg-violet-500",
    "tags": ["closer"]
  },
  {
    "id": "p-86",
    "name": "Veteran Wisdom",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+1 Value for each other VETERAN card in your hand.",
    "color": "bg-violet-500",
    "tags": ["veteran"]
  },
  {
    "id": "p-87",
    "name": "Rookie Heat",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "square",
    "description": "+3 Value if another ROOKIE card is in your hand.",
    "color": "bg-violet-500",
    "tags": ["rookie"]
  },
  {
    "id": "p-88",
    "name": "Starter's Stamina",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "Raises the Batter's Hit Scale requirements by 2.",
    "color": "bg-violet-500",
    "tags": ["starter"]
  },
  {
    "id": "p-89",
    "name": "Lefty Specialist",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+4 Value if the Batter is LEFTY.",
    "color": "bg-violet-500",
    "tags": ["lefty"]
  },
  {
    "id": "p-90",
    "name": "Power-Hitter Killer",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "Subtract 3 from the Batter's score if they have a POWER-HITTER.",
    "color": "bg-violet-500"
  },
  {
    "id": "p-91",
    "name": "Bases Empty Heat",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "star",
    "description": "+3 Value with no runners on base.",
    "color": "bg-violet-500",
    "tags": ["fastball"]
  },
  {
    "id": "p-92",
    "name": "Damage Control",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "+4 Value with 2 or more runners on base.",
    "color": "bg-violet-500",
    "tags": ["starter"]
  },
  {
    "id": "p-93",
    "name": "Save Situation",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "+5 Value if your team is leading by 3 runs or fewer.",
    "color": "bg-violet-500",
    "tags": ["closer"]
  },
  {
    "id": "p-94",
    "name": "Closer Mode",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+3 Value in the 8th inning or later.",
    "color": "bg-violet-500",
    "tags": ["closer"]
  },

  // ============================================================================
  // Phase 7 -- Draft-pool batter expansion (b-100..b-135).
  //
  // 12 new batters x 3 signature cards. IDs intentionally jump to 100 to leave
  // b-31..b-60 and b-81..b-90 reserved for future signatures/generals without
  // collision risk. Every ability here is unique vs. b-1..b-30 and b-61..b-96
  // (see plan); novel mechanics are wired through handTransforms / resolveStep
  // / scoring helpers rather than coining new effect-result fields.
  // ============================================================================

  // ---- Mike Trout (LAA, R) ----
  {
    "id": "b-100",
    "name": "Five-Tool Threat",
    "player": "Mike Trout (LAA)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "If combined and the Pitcher's base card is a FASTBALL, +5 Value.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"]
  },
  {
    "id": "b-101",
    "name": "MVP Resume",
    "player": "Mike Trout (LAA)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+1 Value for every other VETERAN card in the Pitcher's hand.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"]
  },
  {
    "id": "b-102",
    "name": "Halo Bomb",
    "player": "Mike Trout (LAA)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "Cannot be combined on the right side.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "veteran"],
    "combineConstraint": { "rightNoCombine": true }
  },

  // ---- Freddie Freeman (LAD, L) ----
  {
    "id": "b-103",
    "name": "1B Smooth",
    "player": "Freddie Freeman (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "diamond",
    "description": "+1 Value for every DIAMOND on the board.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-104",
    "name": "Calm at the Plate",
    "player": "Freddie Freeman (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+3 Value if your team has 0 Outs.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-105",
    "name": "Atlanta-LA Ring",
    "player": "Freddie Freeman (LAD)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "The Pitcher's base card mechanic is nullified.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran", "lefty"],
    "handedness": "L"
  },

  // ---- Yordan Alvarez (HOU, L) ----
  {
    "id": "b-106",
    "name": "Cuban Crusher",
    "player": "Yordan Alvarez (HOU)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 9,
    "leftShape": "star",
    "rightShape": "star",
    "description": "If combined, base value becomes 14.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-107",
    "name": "Crawford Boxes",
    "player": "Yordan Alvarez (HOU)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+2 Value for every other POWER-HITTER card in your hand.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-108",
    "name": "DH Threat",
    "player": "Yordan Alvarez (HOU)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "The Pitcher's OFF-SPEED cards have their effect nullified.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty"],
    "handedness": "L"
  },

  // ---- Corey Seager (TEX, L) ----
  {
    "id": "b-109",
    "name": "World Series MVP",
    "player": "Corey Seager (TEX)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "star",
    "rightShape": "diamond",
    "description": "+3 Value in the 4th inning or later.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-110",
    "name": "Smooth Stroke",
    "player": "Corey Seager (TEX)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "If combined on the left, +4 Value.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-111",
    "name": "October Hero",
    "player": "Corey Seager (TEX)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+5 Value if the score is tied.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran", "lefty"],
    "handedness": "L"
  },

  // ---- Jose Ramirez (CLE, S) ----
  {
    "id": "b-112",
    "name": "Switch Slasher",
    "player": "Jose Ramirez (CLE)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+2 Value for every unique shape on the board (max +6).",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "speedster"]
  },
  {
    "id": "b-113",
    "name": "Cleveland Cutter",
    "player": "Jose Ramirez (CLE)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+1 Value for every card you have combined.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "speedster"]
  },
  {
    "id": "b-114",
    "name": "30-30 Threat",
    "player": "Jose Ramirez (CLE)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "+3 Value if your hand has another SPEEDSTER and another POWER-HITTER.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "speedster"]
  },

  // ---- Pete Alonso (NYM, R) ----
  {
    "id": "b-115",
    "name": "Polar Power",
    "player": "Pete Alonso (NYM)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "square",
    "rightShape": "star",
    "description": "+1 Value for every STAR on the board.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter"]
  },
  {
    "id": "b-116",
    "name": "HR Derby Champ",
    "player": "Pete Alonso (NYM)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "diamond",
    "rightShape": "diamond",
    "description": "If combined, +3 to the Hit Scale.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter"]
  },
  {
    "id": "b-117",
    "name": "Citi Bomb",
    "player": "Pete Alonso (NYM)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "If combined, +2 Value and +2 to the Hit Scale.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter"]
  },

  // ---- Trea Turner (PHI, R) ----
  {
    "id": "b-118",
    "name": "Track Star",
    "player": "Trea Turner (PHI)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "+5 Value if you have no combinations this round.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "veteran"]
  },
  {
    "id": "b-119",
    "name": "Quick Bat",
    "player": "Trea Turner (PHI)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "The Pitcher's General cards each get -2 Value.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "veteran"]
  },
  {
    "id": "b-120",
    "name": "Steal Home",
    "player": "Trea Turner (PHI)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "If combined and you win, all base runners advance an extra base.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "veteran"]
  },

  // ---- Adley Rutschman (BAL, S) ----
  {
    "id": "b-121",
    "name": "Catcher's Eye",
    "player": "Adley Rutschman (BAL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "Reveal the Pitcher's signature shapes before you lock in your layout.",
    "color": "bg-emerald-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-122",
    "name": "Pitch Caller",
    "player": "Adley Rutschman (BAL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "star",
    "description": "+5 Value if the Pitcher's base card is a BREAKING-BALL.",
    "color": "bg-emerald-500",
    "tags": ["clutch"]
  },
  {
    "id": "b-123",
    "name": "Future Captain",
    "player": "Adley Rutschman (BAL)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "+1 Value to every other card in your hand.",
    "color": "bg-emerald-500",
    "tags": ["clutch"]
  },

  // ---- Rafael Devers (BOS, L) ----
  {
    "id": "b-124",
    "name": "Carita's Cannon",
    "player": "Rafael Devers (BOS)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "If this card is between two combined neighbors, +6 Value.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-125",
    "name": "Green Monster",
    "player": "Rafael Devers (BOS)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "Your DIAMOND shapes are Wildcards this round.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-126",
    "name": "Lefty Mash",
    "player": "Rafael Devers (BOS)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+3 Value if the Pitcher is right-handed.",
    "color": "bg-emerald-500",
    "tags": ["power-hitter", "lefty"],
    "handedness": "L"
  },

  // ---- Francisco Lindor (NYM, S) ----
  {
    "id": "b-127",
    "name": "Mr. Smile",
    "player": "Francisco Lindor (NYM)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "star",
    "description": "If combined, the Pitcher's lowest uncombined card is nullified.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },
  {
    "id": "b-128",
    "name": "Switch-Cap",
    "player": "Francisco Lindor (NYM)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "diamond",
    "description": "+2 Value and +2 to the Hit Scale if the Pitcher is LEFTY.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },
  {
    "id": "b-129",
    "name": "Captain Lindor",
    "player": "Francisco Lindor (NYM)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "+1 Value to every uncombined card you leave.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },

  // ---- Jose Altuve (HOU, R) ----
  {
    "id": "b-130",
    "name": "Postseason Tuve",
    "player": "Jose Altuve (HOU)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+5 Value if your team is losing or tied.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },
  {
    "id": "b-131",
    "name": "Tiny Terror",
    "player": "Jose Altuve (HOU)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "+3 Value if your hand has 2 or more other CLUTCH cards.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },
  {
    "id": "b-132",
    "name": "Champion's Heart",
    "player": "Jose Altuve (HOU)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+1 Value for every Run your team has scored this game.",
    "color": "bg-emerald-500",
    "tags": ["clutch", "veteran"]
  },

  // ---- Jazz Chisholm Jr. (NYY, L) ----
  {
    "id": "b-133",
    "name": "Jazz Hands",
    "player": "Jazz Chisholm Jr. (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "diamond",
    "description": "If uncombined, both sides act as Wildcards.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-134",
    "name": "Bronx Hustle",
    "player": "Jazz Chisholm Jr. (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "If uncombined and you win, +5 to the Hit Scale.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "lefty"],
    "handedness": "L"
  },
  {
    "id": "b-135",
    "name": "Stolen Bag",
    "player": "Jazz Chisholm Jr. (NYY)",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "star",
    "description": "If you win, place an additional runner on 1st base.",
    "color": "bg-emerald-500",
    "tags": ["speedster", "lefty"],
    "handedness": "L"
  },

  // ============================================================================
  // Phase A puzzle-card expansion (b-81..b-88, p-95, p-96).
  //
  // Three directions cover patterns inside the chain (palindrome, sandwich,
  // alternation, ordered run), hard chain-length floors, and lineup-slot
  // effects. All are GENERAL DRAW cards so they live in the per-round deal
  // pool rather than being attached to a specific player. Effects in
  // src/lib/cardEffects.ts; the requireChainLength enforcement is in
  // src/lib/scoring.ts (scoreGroup).
  //
  // Why these IDs: b-81..b-90 was deliberately reserved when the Phase 7
  // batter expansion jumped to b-100, and p-95..p-99 was unused after the
  // p-91..p-94 game-state batch. Both windows are still wide enough for the
  // remaining puzzle directions if/when they ship.
  // ============================================================================

  // ---- Direction 1: pattern-aware effects ----
  {
    "id": "b-81",
    "name": "Sandwich Single",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "square",
    "description": "If sandwiched between two DIAMOND-carrying neighbors in your chain, +6 Value.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-82",
    "name": "Three-Pitch Sequence",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "If your chain reads SQUARE \u2192 DIAMOND \u2192 CIRCLE in order, +6 Value.",
    "color": "bg-amber-500"
  },

  // ---- Direction 2: long-chain tiers ----
  {
    "id": "b-83",
    "name": "Triple Threat",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 3,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "+8 Value if you're in a chain of 3 or more cards.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-84",
    "name": "Five-Tool Run",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "Scores 0 unless in a 4-card chain. If your chain has 4+ cards, +8 Value.",
    "color": "bg-amber-500",
    "combineConstraint": { "requireChainLength": 4 }
  },
  {
    "id": "b-85",
    "name": "Cleanup Stacker",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+1 Value for each card to your right in the same chain.",
    "color": "bg-amber-500"
  },

  // ---- Direction 4: lineup-position effects ----
  {
    "id": "b-86",
    "name": "Leadoff Spark",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "+5 Value as the leftmost card in your lineup.",
    "color": "bg-amber-500",
    "tags": ["speedster"]
  },
  {
    "id": "b-87",
    "name": "Cleanup Crew",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+5 Value as the 4th card in your lineup.",
    "color": "bg-amber-500",
    "tags": ["power-hitter"]
  },
  {
    "id": "b-88",
    "name": "Anchor",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "diamond",
    "rightShape": "star",
    "description": "+3 Value when uncombined and in the rightmost slot of your lineup.",
    "color": "bg-amber-500",
    "tags": ["veteran"]
  },

  // ---- Direction 1: pattern-aware effects (pitcher side) ----
  {
    "id": "p-95",
    "name": "Mirror Image",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 4,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "If your chain reads as a shape palindrome, +5 Value and subtract 3 from the Batter's score.",
    "color": "bg-violet-500"
  },
  {
    "id": "p-96",
    "name": "Alternating Heat",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 3,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "+2 Value for each SQUARE\u2194DIAMOND alternation in your chain.",
    "color": "bg-violet-500",
    "tags": ["fastball"]
  }
];

// ============================================================================
// Per-session shape randomization
//
// `ALL_CARDS` above is the CANONICAL definition of every card -- used by the
// engine tests (`__effects_check.ts`, `__connect_check.ts`, `__copy_check.ts`,
// `__patterns_check.ts`) and by anything else that needs a stable, replayable
// reference. The actual game runs on `SESSION_CARDS`: a one-shot per-page-load
// remix of every card's `leftShape` / `rightShape`, so each play session has
// a fresh "deck layout". Combine constraints, tags, abilities, descriptions,
// and base values are all preserved -- only the literal shapes on each side
// are re-rolled.
//
// Preserved as-is:
//   - "none" / "wildcard" shape literals. `none` is a structural flag (p-79
//     Intentional Walk relies on it) and `wildcard` is itself a design
//     statement (b-10 Electric Speed wants both sides to be free combiners).
//     Re-rolling those would silently change card identity in ways players
//     would notice.
//   - Every other CardDefinition field. Constraints like `allowedShapes`,
//     `leftWildcard`, `rightWildcard`, `noCombine`, `leftNoCombine`,
//     `rightNoCombine`, and `requireChainLength` keep their semantics; the
//     "picky" / "blocked" / "wildcard-via-flag" indicators still render as
//     before because the constraint and the side-shape are independent
//     concerns.
//
// The session seed is derived from `Math.random()` at module load and logged
// to the console so a player who hits a weird-looking deck can report or
// replay it. `randomizeCardShapes(cards, seed)` is exported so tests can pin
// a fixed seed for deterministic shape assertions when needed.
// ============================================================================

const RANDOMIZABLE_SHAPES: ShapeType[] = ["square", "diamond", "circle", "star"];

function isRandomizableShape(s: ShapeType): boolean {
  return s !== "none" && s !== "wildcard";
}

/**
 * Mulberry32-style seeded PRNG. Local copy so cards.ts has no runtime
 * dependency on players.ts / draft.ts (both define their own copies, but
 * pulling from one of those would create an awkward import cycle).
 */
function makeShapeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Return a new array of cards with randomized leftShape / rightShape values.
 * Cards are deep-copied at the top level (each entry is a fresh object) so
 * mutating one card -- e.g. hand-transforms splicing on `disabled` -- never
 * leaks back into the canonical `ALL_CARDS`. Nested objects (e.g.
 * `combineConstraint`) are shared by reference because they are treated as
 * immutable by the engine.
 *
 * `seed` is required so callers can opt into deterministic remix sets (tests,
 * "replay this session" features, etc.). Pass `Math.floor(Math.random() *
 * 0x7fffffff)` for a fresh deck.
 */
export function randomizeCardShapes(
  cards: readonly CardDefinition[],
  seed: number,
): CardDefinition[] {
  const rng = makeShapeRng(seed);
  const pick = (): ShapeType =>
    RANDOMIZABLE_SHAPES[Math.floor(rng() * RANDOMIZABLE_SHAPES.length)];
  return cards.map((c) => ({
    ...c,
    leftShape: isRandomizableShape(c.leftShape) ? pick() : c.leftShape,
    rightShape: isRandomizableShape(c.rightShape) ? pick() : c.rightShape,
  }));
}

/**
 * Per-session seed. Stable across the lifetime of this module (one play
 * session) and logged to the console so issues can be reported with a
 * reproducer. New page load = new seed = new shape layout.
 */
export const SESSION_SEED: number = Math.floor(Math.random() * 0x7fffffff);

if (typeof console !== "undefined") {
  console.info(`[dugout] session seed = ${SESSION_SEED}`);
}

// ============================================================================
// SZN-mode per-run EDGE randomization
// ============================================================================
//
// Player cards (SznPlayer) carry FIXED `leftEdge` / `rightEdge` per their
// printed identity -- Aaron Judge is always Yankees-Logo / Power, that's
// who he IS. Item / ability cards are the opposite: their printed shape
// pool was always randomized session-to-session via `randomizeCardShapes`
// above, and the SZN edge layer needs the same treatment so each run
// remixes the snap puzzle. Without this, every ability card would render
// with bare geometric `ShapeHalf` in the SZN encounter UI (the rendering
// in `ItemCardPreview` already gates on `sznLeftEdge && sznRightEdge`),
// so the user never sees the semantic SZN edge connector on a merchant
// listing or random reward.
//
// `randomizeCardEdges(cards, seed)` mutates each entry IN PLACE so the
// existing `SESSION_CARDS` array and the `SESSION_CARDS_BY_ID` lookup
// keep pointing at the same objects, and downstream merchant rolls /
// encounter rewards pick up the new edges automatically. Encounter-only
// items (`enc-*`) are skipped because their `sznLeftEdge` /
// `sznRightEdge` are deliberately authored to drive specific snap
// puzzles (mega-seam, defense-shield, team-logo, etc.).
//
// Pools are split by card `type` so a Batting card never gets a
// pitcher-side edge (and vice versa) -- a "Sweeping Slider" pitcher
// rolling `power` would feel like a tooling bug, not a fresh remix.
// `wildcard` appears in both pools with low frequency so the
// "snap-anywhere" escape hatch shows up sometimes without flooding the
// run. Edges that are exclusive to specific encounter mechanics
// (`team-logo`, `mega-seam`, `defense-shield`, `fastball-102`,
// `city-connect`) are intentionally EXCLUDED here -- those should only
// appear when an encounter explicitly grants them.
// ============================================================================

/** Batting-card edge pool. Offensive + positional + low-rate wildcard. */
const BATTING_EDGE_POOL: SznEdgeId[] = [
  "power", "power",
  "speed", "speed",
  "contact", "contact",
  "patience",
  "infield",
  "outfield",
  "battery",
  "lefty",
  "righty",
  "wildcard", // single entry → ~5–8% of rolls
];

/** Pitching-card edge pool. Defensive + positional + low-rate wildcard. */
const PITCHING_EDGE_POOL: SznEdgeId[] = [
  "velocity", "velocity",
  "movement", "movement",
  "control", "control",
  "deception",
  "battery",
  "infield",
  "lefty",
  "righty",
  "wildcard",
];

/**
 * Mutate each card's `sznLeftEdge` / `sznRightEdge` in place, drawing
 * from the appropriate type-aware pool. Encounter-only items
 * (`enc-*` ids) are skipped so their curated edges don't get blown
 * away. Re-runnable: calling with a fresh seed mid-session reshuffles
 * the edges for the next run.
 */
export function randomizeCardEdges(
  cards: CardDefinition[],
  seed: number,
): void {
  const rng = makeShapeRng(seed);
  const pickFrom = (pool: SznEdgeId[]): SznEdgeId =>
    pool[Math.floor(rng() * pool.length)];
  for (const c of cards) {
    // Skip encounter-only items (curated edges drive their mechanics).
    if (c.id.startsWith("enc-")) continue;
    const pool = c.type === "Pitching" ? PITCHING_EDGE_POOL : BATTING_EDGE_POOL;
    c.sznLeftEdge = pickFrom(pool);
    c.sznRightEdge = pickFrom(pool);
  }
}

// ---------------------------------------------------------------------
// SZN-mode encounter items
// ---------------------------------------------------------------------
//
// These items only enter play via SZN encounters (not the Quick Match
// shape-engine pool, and not the random draft). They carry semantic
// `sznLeftEdge` / `sznRightEdge` so the SZN combat path can chain them
// into player hands. Legacy shape sockets fall back to `wildcard` so
// nothing crashes if a non-SZN code path ever inspects them.
//
// IDs use the `enc-*` prefix so callers (encounter dispatcher, footer
// dealer, registry lookups) can cheaply distinguish encounter items
// from the legacy Quick Match card catalog. The 30-card limit on the
// shape randomizer doesn't apply to these because `randomizeCardShapes`
// only touches the legacy entries; the encounter cards keep their
// declared (always wildcard) shapes.

export const SZN_ENCOUNTER_ITEM_CARDS: CardDefinition[] = [
  {
    id: "enc-sticky-stuff",
    name: "Sticky Stuff",
    type: "Pitching",
    abilityType: "EncounterItem",
    baseValue: 0,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description:
      "Wildcard snap — joins any two cards. 15% chance the umpire ejects the snapped batter (suspended next series).",
    sznLeftEdge: "wildcard",
    sznRightEdge: "wildcard",
  },
  {
    id: "enc-legal-rosin",
    name: "Legal Rosin",
    type: "Pitching",
    abilityType: "EncounterItem",
    baseValue: 15,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description: "Snap onto any pitcher's right edge for +15 Pitching Score.",
    sznLeftEdge: "wildcard",
    sznRightEdge: "velocity",
  },
  // Mega-Card halves (Encounter #4). Same name on both so the merged
  // visual reads as a single hero card; the seam side is `mega-seam`
  // (which only snaps to itself), the outside side is `blank` so the
  // halves can't chain anywhere else.
  {
    id: "enc-mega-left",
    name: "Mega-Card (Left)",
    type: "Batting",
    abilityType: "MegaHalf",
    baseValue: 0,
    leftShape: "none",
    rightShape: "wildcard",
    description: "Combines with the right half into a single 500-score hero card.",
    sznLeftEdge: "blank",
    sznRightEdge: "mega-seam",
  },
  {
    id: "enc-mega-right",
    name: "Mega-Card (Right)",
    type: "Batting",
    abilityType: "MegaHalf",
    baseValue: 0,
    leftShape: "wildcard",
    rightShape: "none",
    description: "Combines with the left half into a single 500-score hero card.",
    sznLeftEdge: "mega-seam",
    sznRightEdge: "blank",
  },
  {
    id: "enc-corked-bat",
    name: "Corked Bat",
    type: "Batting",
    abilityType: "EncounterItem",
    baseValue: 100,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description: "Snap to any Outfielder or Infielder edge for +100 Batting Score.",
    sznLeftEdge: "infield",
    sznRightEdge: "outfield",
  },
  {
    id: "enc-rally-fire",
    name: "Rally Fire",
    type: "Batting",
    abilityType: "EncounterItem",
    baseValue: 0,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description: "Lights up the dugout the moment it lands in your bag: cards adjacent to your team-logo edge get +10% score for the rest of the week.",
    sznLeftEdge: "team-logo",
    sznRightEdge: "team-logo",
  },
  {
    id: "enc-platinum-glove",
    name: "Platinum Glove",
    type: "Pitching",
    abilityType: "EncounterItem",
    baseValue: 0,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description: "Banks +1 Defense Shield the moment it lands in your bag. Snap it into a pitching chain to bank another shield. (A shield nullifies the opponent's next pitching score.)",
    sznLeftEdge: "wildcard",
    sznRightEdge: "defense-shield",
  },
  {
    id: "enc-drip-cleats",
    name: "Drip Cleats",
    type: "Batting",
    abilityType: "EncounterItem",
    baseValue: 40,
    leftShape: "wildcard",
    rightShape: "wildcard",
    // Description rewrite (vs. original "Forces the next card to be a
    // Pitcher"): the right edge is `blank`, which structurally caps the
    // chain at this card -- nothing can snap onto Drip Cleats' right
    // side. That IS the "force next" promise, expressed in mechanics
    // the user can see at a glance.  +40 is the upside; chain
    // termination is the cost.
    description: "Snap to any Batter for +40 Batting Score. Ends the chain — nothing snaps to its right.",
    sznLeftEdge: "speed",
    sznRightEdge: "blank",
  },
  {
    id: "enc-classic-spikes",
    name: "Classic Spikes",
    type: "Batting",
    abilityType: "EncounterItem",
    baseValue: 0,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description: "Wildcard snap. On snap, mirrors the partner's facing edge onto Spikes — so the chain can keep going AND any badges that fire on that edge still trigger.",
    sznLeftEdge: "wildcard",
    sznRightEdge: "wildcard",
  },
  {
    id: "enc-the-torch",
    name: "The Torch",
    type: "Batting",
    abilityType: "EncounterItem",
    baseValue: 0,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description: "Wildcard snap onto a player. Carries the player's left edge through to the next card in the chain.",
    sznLeftEdge: "wildcard",
    sznRightEdge: "wildcard",
  },
  {
    id: "enc-duct-tape",
    name: "Duct Tape",
    type: "Batting",
    abilityType: "EncounterItem",
    baseValue: 0,
    leftShape: "wildcard",
    rightShape: "wildcard",
    description: "Snap two non-matching cards together. Both sides take -50% base score.",
    sznLeftEdge: "wildcard",
    sznRightEdge: "wildcard",
  },
  {
    id: "enc-faded-scouting-report",
    name: "Faded Scouting Report",
    type: "Pitching",
    abilityType: "EncounterItem",
    baseValue: 0,
    leftShape: "none",
    rightShape: "none",
    description: "Intel only. Reveals the opponent's first card next series.",
    sznLeftEdge: "blank",
    sznRightEdge: "blank",
    combineConstraint: { noCombine: true },
  },
];

/**
 * Registry lookup for encounter items. Used by the encounter dispatcher
 * to grant items by id without searching SESSION_CARDS.
 */
export const SZN_ENCOUNTER_ITEMS_BY_ID: Record<string, CardDefinition> = {};
for (const c of SZN_ENCOUNTER_ITEM_CARDS) SZN_ENCOUNTER_ITEMS_BY_ID[c.id] = c;

/**
 * The card array the GAME uses. Identical to `ALL_CARDS` in every field
 * except `leftShape` / `rightShape`, which are re-rolled per session via
 * `randomizeCardShapes`. Tests should keep using `ALL_CARDS` -- it's the
 * canonical reference -- but every gameplay-facing path (dealing hands,
 * drafting, draft visualization, collection screen, pending-choice modal)
 * reads from this one so the player sees one consistent shape layout for
 * the whole session.
 *
 * SZN encounter items are appended verbatim (NOT shuffled by
 * `randomizeCardShapes`) so their declared sznLeftEdge / sznRightEdge
 * remain stable and the wildcard fallback shapes don't get rerolled
 * into something restrictive.
 */
export const SESSION_CARDS: CardDefinition[] = [
  ...randomizeCardShapes(ALL_CARDS, SESSION_SEED),
  ...SZN_ENCOUNTER_ITEM_CARDS,
];

// Stamp `brawlTagline` onto every SESSION_CARDS entry that has a tagline
// drafted in `brawlTaglines.ts`. Mutation rather than a render-time lookup
// keeps the field directly available on `CardDefinition` everywhere
// (engine tests, type-checks, debug serialization), and the draft map is
// pure data with no back-reference to `cards.ts`, so no import cycle.
for (const c of SESSION_CARDS) {
  const entry = (BRAWL_TAGLINE_DRAFT as Record<string, { tagline?: string }>)[c.id];
  if (entry?.tagline && entry.tagline !== "—") {
    c.brawlTagline = entry.tagline;
  }
}

const SESSION_CARDS_BY_ID: Record<string, CardDefinition> = {};
for (const c of SESSION_CARDS) SESSION_CARDS_BY_ID[c.id] = c;

/**
 * Lookup helper that mirrors `Array.find` against `SESSION_CARDS` but in O(1).
 * Returns `undefined` for unknown ids -- callers that hold a known-good id
 * (e.g. dealHand resolving signatureCardIds) typically assert non-null at
 * the call site since a missing id is a data-integrity bug.
 */
export function sessionCardById(id: string): CardDefinition | undefined {
  return SESSION_CARDS_BY_ID[id];
}
