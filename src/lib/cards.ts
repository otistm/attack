import { ShapeType } from "../components/cardShapes";

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
    "description": "If combined on either side, +4 Value.",
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
    "description": "If you win, +5 Value.",
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
    "description": "Change the shape of one of your General cards this round.",
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
    "description": "Left shape acts as a Wildcard.",
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
    "description": "If combined on both sides, base value becomes 12.",
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
    "description": "If the Batter wins, subtract 3 from the Batter's score.",
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
    "description": "Left shape acts as a Wildcard.",
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
    "description": "If combined on both sides and you win, +15 Hit Scale.",
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
    "description": "Automatically erases one base runner if you win the round.",
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
  }
];
