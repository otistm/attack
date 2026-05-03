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
  // Free-form tags used by other cards' effects (e.g. ['fastball'] referenced by b-27, b-64, p-73).
  tags?: string[];
  // Player handedness, referenced by p-37 Cy Young Heat.
  handedness?: Handedness;
  // Structured combine rules consulted by the connection engine.
  combineConstraint?: CombineConstraint;
}

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
    "description": "If combined on either side, add +4 to final score.",
    "color": "bg-emerald-500"
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
    "description": "Opponent's highest single card gets -2 Value.",
    "color": "bg-emerald-500"
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
    "description": "Can only combine with S or D. If successful, +3 Value.",
    "color": "bg-emerald-500",
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
    "description": "Reverses your Left and Right shapes on all your cards this turn.",
    "color": "bg-emerald-500",
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
    "description": "If you win the round, automatically upgrade the Hit Scale by +5 (e.g., Single becomes Double).",
    "color": "bg-emerald-500",
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
    "description": "Reveal the Pitcher's uncombined cards before you lock in.",
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "description": "Ignores all Pitcher debuff mechanics this turn.",
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "description": "You may change the shape of one of your drawn General cards.",
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "description": "If successfully combined, add +3 to your total score.",
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "description": "If you win, +3 to your score specifically for calculating the Hit Scale.",
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "description": "Destroys one of the Pitcher's uncombined general cards.",
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
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
    "description": "Can only combine with C shapes.",
    "color": "bg-emerald-500",
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
    "color": "bg-emerald-500"
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
    "description": "If combined with another card, +4 to your total.",
    "color": "bg-emerald-500"
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
    "color": "bg-emerald-500"
  },
  {
    "id": "b-28",
    "name": "Vlad's Vengeance",
    "player": "Vladimir Guerrero Jr",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 8,
    "leftShape": "circle",
    "rightShape": "circle",
    "description": "Cannot be combined on the left side.",
    "color": "bg-emerald-500",
    "combineConstraint": { "leftNoCombine": true }
  },
  {
    "id": "b-29",
    "name": "Home Run Derby",
    "player": "Vladimir Guerrero Jr",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+1 Value for every CIRCLE shapes currently on the board.",
    "color": "bg-emerald-500"
  },
  {
    "id": "b-30",
    "name": "Laser Show",
    "player": "Vladimir Guerrero Jr",
    "type": "Batting",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "diamond",
    "rightShape": "square",
    "description": "Opponent's base card value is halved (rounded down).",
    "color": "bg-emerald-500"
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
    "description": "High base value. Opponent cannot use Wildcards.",
    "color": "bg-blue-500",
    "tags": ["fastball"]
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
    "tags": ["fastball"],
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
    "description": "Intimidates batter: Batter's Hit Scale requirements increase by 3.",
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "description": "Batter cannot combine any SQUARE shapes this turn.",
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "tags": ["fastball"]
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
    "description": "Subtract 3 from the Batter's final combined score.",
    "color": "bg-blue-500"
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
    "description": "Batter must discard 1 general draw card before playing.",
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "tags": ["fastball"],
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
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "tags": ["fastball"]
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
    "tags": ["fastball"]
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
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "description": "If Batter successfully combines 3 cards, subtract 6 from their total.",
    "color": "bg-blue-500"
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
    "description": "Look at the Batter's 5 cards before you lock in your layout.",
    "color": "bg-blue-500"
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
    "description": "If uncombined, Batter's highest card gets -3.",
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "description": "You may draw 1 extra Pitching General Card this turn.",
    "color": "bg-blue-500"
  },
  {
    "id": "p-55",
    "name": "Rainbow Curve",
    "player": "Yoshinobu Yamamoto",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 6,
    "leftShape": "diamond",
    "rightShape": "circle",
    "description": "+3 Value if combined on the left side.",
    "color": "bg-blue-500"
  },
  {
    "id": "p-56",
    "name": "Pinpoint Control",
    "player": "Yoshinobu Yamamoto",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "star",
    "description": "Change one of your card's shapes to match a drawn general card.",
    "color": "bg-blue-500"
  },
  {
    "id": "p-57",
    "name": "The Japanese Ace",
    "player": "Yoshinobu Yamamoto",
    "type": "Pitching",
    "abilityType": "Signature",
    "baseValue": 7,
    "leftShape": "star",
    "rightShape": "square",
    "description": "+4 Value if the Batter uses no combinations.",
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "color": "bg-blue-500"
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
    "description": "Subtract 1 from the Batter's score for every card they play.",
    "color": "bg-blue-500"
  },
  {
    "id": "b-61",
    "name": "Power Swing",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 6,
    "leftShape": "square",
    "rightShape": "diamond",
    "description": "Can only be combined with D or S shapes.",
    "color": "bg-amber-500",
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
    "description": "If combined, +2 to your base card value.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-63",
    "name": "Bunt Attempt",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 2,
    "leftShape": "star",
    "rightShape": "star",
    "description": "If you win, guarantees exactly a Base Hit (prevents double plays).",
    "color": "bg-amber-500"
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
    "description": "Name a shape. If Pitcher uses it, +4 Value.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-66",
    "name": "Solid Contact",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "circle",
    "rightShape": "diamond",
    "description": "+1 to the Hit Scale score.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-67",
    "name": "Foul Ball",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 2,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "Discard this to re-draw 2 General Batting cards.",
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
    "combineConstraint": { "leftWildcard": true }
  },
  {
    "id": "b-69",
    "name": "Sacrifice Fly",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 1,
    "leftShape": "square",
    "rightShape": "circle",
    "description": "If combined and you lose, a runner on 3rd still scores.",
    "color": "bg-amber-500"
  },
  {
    "id": "b-70",
    "name": "The Sweet Spot",
    "type": "Batting",
    "abilityType": "General Draw",
    "baseValue": 7,
    "leftShape": "circle",
    "rightShape": "square",
    "description": "If successfully combined on both sides, automatic Home Run.",
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
    "description": "-3 to the Batter's total combined score.",
    "color": "bg-violet-500"
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
    "color": "bg-violet-500"
  },
  {
    "id": "p-74",
    "name": "Backdoor Slider",
    "type": "Pitching",
    "abilityType": "General Draw",
    "baseValue": 5,
    "leftShape": "star",
    "rightShape": "circle",
    "description": "+1 Value for every CIRCLE shape currently in play by Batter.",
    "color": "bg-violet-500"
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
    "description": "Swap one card from your hand with the top card of your deck.",
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
  }
];
