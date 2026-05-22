/**
 * SZN Mode player pool.
 *
 * Distinct from the legacy `MlbPlayer` catalog in `players.ts` (which still
 * powers Quick Match / Auction Draft and uses geometric shape sockets). SZN
 * players carry semantic `leftEdge` / `rightEdge` ids from `sznEdges.ts`
 * plus rich position / role / base-score data the run economy needs.
 *
 * Each player now also carries a `passive` ability (always-on once at
 * common rarity) and an optional `potentials` array (up to 3 abilities
 * progressively revealed as the player levels from allstar -> legend).
 * See `sznPlayerAbilities.ts` for the schema and engine entry points.
 *
 * v2 ships three fully-rostered franchises: New York Yankees (NYY),
 * Philadelphia Phillies (PHI), and Toronto Blue Jays (TOR). The remaining
 * 27 franchises register as empty pools so the picker disables them with
 * "COMING SOON" without crashing the rest of the pipeline.
 */

import type { ShapeType } from "../components/cardShapes";
import type { Handedness } from "./cards";
import type { ClassTag } from "./run";
import type { MlbPlayer } from "./players";
import type { SznEdgeId } from "./sznEdges";
import type { MlbTeamId } from "./sznTeams";
import type { PlayerAbility } from "./sznPlayerAbilities";

/**
 * Concrete position on the diamond. Includes bullpen + DH labels because the
 * SZN roster spec discriminates closer/relief/starter and DH-only sluggers.
 */
export type Position =
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "INF"
  | "OF"
  | "UTL"
  | "DH"
  | "SP"
  | "RP"
  | "CP";

export interface SznPlayer {
  id: string;
  name: string;
  teamId: MlbTeamId;
  role: "Batter" | "Pitcher";
  position: Position;
  handedness: Handedness;
  /** Left-side connector edge (semantic). */
  leftEdge: SznEdgeId;
  /** Right-side connector edge (semantic). */
  rightEdge: SznEdgeId;
  /** Base score at Common rarity. Higher rarities multiply this. */
  baseScoreCommon: number;
  /** SZN-wide class tag (existing synergy system). */
  tag: ClassTag;
  /** Always-on signature ability, revealed at common rarity. */
  passive: PlayerAbility;
  /**
   * Up to 3 potentials, unlocked progressively as the player's rarity
   * climbs:
   *   common  -> none revealed
   *   allstar -> potentials[0]
   *   veteran -> potentials[0..1]
   *   legend  -> potentials[0..2]
   * Unrevealed slots render as "???" in tooltips and never fire.
   */
  potentials?: PlayerAbility[];
  /** Optional flavor blurb for tooltips. Pure flavor only -- mechanical
   * effects live on `passive` / `potentials`. */
  flavor?: string;
}

/**
 * Convenience: tighter constructor so the per-team blocks below stay
 * readable. Centralizes the "no-team-mismatch" invariant.
 */
const P = (
  teamId: MlbTeamId,
  id: string,
  name: string,
  role: "Batter" | "Pitcher",
  position: Position,
  handedness: Handedness,
  leftEdge: SznEdgeId,
  rightEdge: SznEdgeId,
  baseScoreCommon: number,
  tag: ClassTag,
  passive: PlayerAbility,
  potentials?: PlayerAbility[],
  flavor?: string,
): SznPlayer => ({
  teamId,
  id,
  name,
  role,
  position,
  handedness,
  leftEdge,
  rightEdge,
  baseScoreCommon,
  tag,
  passive,
  potentials,
  flavor,
});

/**
 * Convenience builder for an ability. Keeps the per-team blocks below
 * scanning as data, not boilerplate.
 */
function A(
  id: string,
  name: string,
  trigger: PlayerAbility["trigger"],
  effect: PlayerAbility["effect"],
): PlayerAbility {
  return { id, name, trigger, effect };
}

// ---------------------------------------------------------------------------
// New York Yankees (NYY)
// ---------------------------------------------------------------------------

const NYY: SznPlayer[] = [
  // ----- Batters (1-12) -----
  P("NYY", "nyy-judge", "Aaron Judge", "Batter", "OF", "R", "yankees-logo", "power", 85, "Slugger",
    A("all-rise", "All Rise",
      { kind: "onSnap" },
      { scoreBonus: 5, flavor: "+5 to the matchup score per snap touching Judge." }),
    [
      A("mvp", "MVP",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 20, oneShotPerMatchup: true, flavor: "+20 score when Judge anchors the at-bat." }),
      A("captain", "Captain",
        { kind: "onTeammateSnap", tag: "Slugger" },
        { scoreBonus: 3, flavor: "+3 score per Slugger snap on the chain." }),
      A("sixty-two", "62",
        { kind: "passive", description: "Chain treated as 1 longer for length requirements." },
        { chainLengthForgiveness: 1, flavor: "Judge's chain counts as one card longer." }),
    ],
    "The ultimate anchor for a power chain."),

  P("NYY", "nyy-dominguez", "Jasson Dominguez", "Batter", "OF", "S", "speed", "power", 75, "Speedster",
    A("the-martian", "The Martian",
      { kind: "onSnap", edge: "speed" },
      { hitScaleBonus: 2, flavor: "+2 Hit Scale per Speed snap." }),
    [
      A("switch", "Switch",
        { kind: "passive", description: "Pitcher handedness penalties don't apply." },
        { flavor: "Switch-hitter ignores pitcher hand penalty." }),
      A("top-prospect", "Top Prospect",
        { kind: "onTeammateSnap", tag: "Rookie" },
        { scoreBonus: 3, flavor: "+3 score per Rookie snap on the chain." }),
    ],
    "The Martian -- versatile superstar slugger."),

  P("NYY", "nyy-stanton", "Giancarlo Stanton", "Batter", "DH", "R", "power", "blank", 75, "Slugger",
    A("stantonia", "Stantonia",
      { kind: "onLockIn", whenRole: "Batter" },
      { scoreBonus: 15, oneShotPerMatchup: true, flavor: "+15 score on lock-in." }),
    [
      A("statcast-king", "Statcast King",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score if any Power edge snapped." }),
    ],
    "Massive score, but his low speed means he acts as a dead-end."),

  P("NYY", "nyy-chisholm", "Jazz Chisholm Jr.", "Batter", "3B", "L", "infield", "speed", 65, "Speedster",
    A("jazz", "Jazz",
      { kind: "onSnap", edge: "speed" },
      { speedMultiplier: 1.5, flavor: "Speed multiplier becomes 1.5x next card." }),
    [
      A("triple-threat-jazz", "Triple Threat",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 if Speed + Power + Infield all snapped." }),
    ],
    "Essential for creating fast, high-multiplier infield chains."),

  P("NYY", "nyy-volpe", "Anthony Volpe", "Batter", "SS", "R", "infield", "contact", 55, "Contact",
    A("captain-volpe", "Captain Volpe",
      { kind: "onSnap", edge: "contact" },
      { scoreBonus: 2, nextWeekCashBonus: 1, flavor: "+2 score and +$1 future cash per Contact snap." }),
    [
      A("gold-glove", "Gold Glove",
        { kind: "passive", description: "+5 score when chained with any pitcher card." },
        { scoreBonus: 5, flavor: "+5 if Volpe is chained with a pitcher." }),
    ],
    "Snaps perfectly to keep chains alive without breaking."),

  P("NYY", "nyy-wells", "Austin Wells", "Batter", "C", "L", "power", "battery", 55, "Contact",
    A("backstop-wells", "Backstop",
      { kind: "onSnap", edge: "battery" },
      { pitcherCombinedDelta: 10, flavor: "Pitcher in chain gains +10 score per Battery snap." }),
    [
      A("pitch-framing", "Pitch Framing",
        { kind: "passive", description: "Opposing pitcher loses 3 when Wells is chained." },
        { opponentScoreDelta: -3, flavor: "Opponent pitcher score -3 when Wells is chained." }),
    ],
    "The critical bridge card from your batting chain into your pitching chain."),

  P("NYY", "nyy-lemahieu", "DJ LeMahieu", "Batter", "INF", "R", "veteran-tag", "al-east-patch", 40, "Veteran",
    A("veteran-boost", "Veteran Boost",
      { kind: "onSnap", edge: "veteran-tag", sideOfSelf: "left" },
      { permanentBoostOnRookie: 2, flavor: "Snapping rookie gets +2 permanent base score." }),
    [
      A("le-machine", "Le Machine",
        { kind: "onWeekStart" },
        { nextWeekCashBonus: 1, flavor: "+$1 cash on week start." }),
    ],
    "Snap a Rookie to his left edge for a permanent stat boost."),

  P("NYY", "nyy-cabrera", "Oswaldo Cabrera", "Batter", "UTL", "S", "wildcard", "contact", 35, "Contact",
    A("utility-man", "Utility Man",
      { kind: "onSnap" },
      { scoreBonus: 1, flavor: "+1 score on every snap touching Cabrera." }),
    [
      A("switch-cap", "Switch-Cap",
        { kind: "passive", description: "Pitcher handedness penalties don't apply." },
        { flavor: "Switch-hitter ignores pitcher hand penalty." }),
    ],
    "Utility man -- his left side can snap to absolutely anything to save a broken chain."),

  P("NYY", "nyy-grisham", "Trent Grisham", "Batter", "OF", "L", "outfield", "patience", 35, "Contact",
    A("eye", "Eye",
      { kind: "onSnap", edge: "patience" },
      { scoreBonus: 3, hitScaleBonus: 1, flavor: "+3 score, +1 Hit Scale per Patience snap." }),
    [
      A("lead-off-grisham", "Lead-Off",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 2, oneShotPerMatchup: true, flavor: "+2 score on lock-in." }),
    ],
    "Great for extending chains easily."),

  P("NYY", "nyy-rice", "Ben Rice", "Batter", "1B", "L", "rookie", "infield", 40, "Rookie",
    A("call-up", "Call-Up",
      { kind: "onSnap", edge: "rookie", sideOfSelf: "right" },
      { scoreBonus: 3, flavor: "+3 score when snapped INTO a Veteran." }),
    [
      A("first-year-power", "First-Year Power",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 if Power-tagged teammate in chain." }),
    ]),

  P("NYY", "nyy-jones", "Spencer Jones", "Batter", "OF", "L", "rookie", "power", 25, "Rookie",
    A("high-upside", "High Upside",
      { kind: "passive", description: "Scales aggressively with rarity." },
      { flavor: "Base score scales aggressively as Jones levels up." }),
    [
      A("debut-bomb", "Debut Bomb",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 10, oneShotPerMatchup: true, flavor: "+10 score on first lock-in of the week." }),
    ],
    "High-risk call-up with a ton of upside if chained correctly."),

  P("NYY", "nyy-durbin", "Caleb Durbin", "Batter", "INF", "R", "speed", "rookie", 20, "Rookie",
    A("hustle", "Hustle",
      { kind: "onSnap", edge: "speed" },
      { hitScaleBonus: 2, flavor: "+2 Hit Scale per Speed snap." }),
    [
      A("spring-training", "Spring Training",
        { kind: "onWeekStart" },
        { nextWeekCashBonus: 1, flavor: "+$1 cash on week start." }),
    ]),

  // ----- Pitchers (13-20) -----
  P("NYY", "nyy-cole", "Gerrit Cole", "Pitcher", "SP", "R", "battery", "velocity", 90, "Veteran",
    A("ace-cole", "Ace",
      { kind: "onLockIn", whenRole: "Pitcher" },
      { scoreBonus: 10, pitcherWinsTies: true, oneShotPerMatchup: true, flavor: "+10 score and wins ties." }),
    [
      A("cy-young", "Cy Young",
        { kind: "onSnap", edge: "velocity" },
        { scoreBonus: 5, flavor: "+5 score per Velocity snap." }),
      A("captain-of-staff", "Captain of the Staff",
        { kind: "onTeammateSnap", tag: "Strikeout" },
        { scoreBonus: 2, flavor: "+2 score per Strikeout teammate snap." }),
    ],
    "Bridges perfectly from your Catcher. Pure heat to guarantee strikeouts."),

  P("NYY", "nyy-gil", "Luis Gil", "Pitcher", "SP", "R", "velocity", "movement", 75, "Strikeout",
    A("k-machine", "K Machine",
      { kind: "onSnap", family: "defensive" },
      { opponentScoreDelta: -3, flavor: "Opponent batter -3 per Velocity / Movement snap." }),
    [
      A("roy", "Rookie of the Year",
        { kind: "onLockIn", whenRole: "Pitcher" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score on lock-in." }),
    ],
    "Elite two-edge combo for racking up strikeout scores."),

  P("NYY", "nyy-rodon", "Carlos Rodón", "Pitcher", "SP", "L", "lefty", "velocity", 70, "Strikeout",
    A("lefty-heat", "Lefty Heat",
      { kind: "onSnap", edge: "lefty" },
      { scoreBonus: 5, speedMultiplier: 1.25, flavor: "+5 score per Lefty snap." }),
    [
      A("big-game-lefty", "Big Game Lefty",
        { kind: "onLockIn", whenRole: "Pitcher" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score on lock-in vs R-batter." }),
    ]),

  P("NYY", "nyy-weaver", "Luke Weaver", "Pitcher", "CP", "R", "movement", "blank", 65, "Closer",
    A("slam-the-door", "Slam the Door",
      { kind: "onLockIn", whenRole: "Pitcher" },
      { scoreBonus: 15, oneShotPerMatchup: true, flavor: "+15 score on lock-in." }),
    [
      A("backup-closer", "Backup Closer",
        { kind: "passive", description: "+5 score if no other CP in chain." },
        { scoreBonus: 5, flavor: "+5 score for sole Closer in chain." }),
    ],
    "Slams the door. Nothing can snap after him."),

  P("NYY", "nyy-cortes", "Nestor Cortes", "Pitcher", "SP", "L", "yankees-logo", "deception", 60, "Control",
    A("funky-delivery", "Funky Delivery",
      { kind: "onSnap", edge: "deception" },
      { chainShatterChance: 0.25, flavor: "25% to shatter opponent's chain." }),
    [
      A("funky-tempo", "Funky Tempo",
        { kind: "onMatchupReveal" },
        { hitScaleBonus: 3, flavor: "+3 Hit Scale on reveal." }),
    ],
    "Funky delivery -- 25% chance to shatter the enemy's chain."),

  P("NYY", "nyy-stroman", "Marcus Stroman", "Pitcher", "SP", "R", "movement", "righty", 55, "Groundball",
    A("movement-stroman", "Movement",
      { kind: "onSnap", edge: "movement" },
      { opponentScoreDelta: -5, flavor: "Opponent batter -5 per Movement snap." }),
    [
      A("hdmh", "HDMH",
        { kind: "onMatchupReveal" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score on reveal." }),
    ],
    "Movement applies a debuff to the enemy batter."),

  P("NYY", "nyy-schmidt", "Clarke Schmidt", "Pitcher", "SP", "R", "control", "yankees-logo", 55, "Starter",
    A("flexibility", "Flexibility",
      { kind: "onSnap", edge: "control" },
      { scoreBonus: 3, flavor: "+3 score per Control snap." }),
    [
      A("sinker-king", "Sinker King",
        { kind: "onSnap", edge: "yankees-logo" },
        { scoreBonus: 5, flavor: "+5 score per Yankees Logo snap." }),
    ],
    "Highly flexible bridging edge for the pitching staff."),

  P("NYY", "nyy-hamilton", "Ian Hamilton", "Pitcher", "RP", "R", "battery", "control", 45, "Control",
    A("slambio", "Slambio",
      { kind: "onSnap", edge: "battery" },
      { scoreBonus: 5, flavor: "+5 score per Battery snap." }),
    [
      A("middle-relief", "Middle Relief",
        { kind: "onSnap" },
        { scoreBonus: 3, flavor: "+3 score on every snap if chain is long." }),
    ],
    "The 'Slambio' specialist, perfect for middle relief chains."),
];

// ---------------------------------------------------------------------------
// Philadelphia Phillies (PHI)
// ---------------------------------------------------------------------------

const PHI: SznPlayer[] = [
  // ----- Batters (1-12) -----
  P("PHI", "phi-harper", "Bryce Harper", "Batter", "1B", "L", "phillies-logo", "power", 85, "Slugger",
    A("pinstripe-mvp", "Pinstripe MVP",
      { kind: "onLockIn", whenRole: "Batter" },
      { scoreBonus: 15, oneShotPerMatchup: true, flavor: "+15 score on lock-in." }),
    [
      A("october-reds", "October Reds",
        { kind: "onMatchupReveal" },
        { scoreBonus: 10, oneShotPerMatchup: true, flavor: "+10 score on series-day reveal." }),
      A("big-bryce", "Big Bryce",
        { kind: "onTeammateSnap", edge: "power" },
        { scoreBonus: 3, flavor: "+3 score per Power teammate snap." }),
    ]),

  P("PHI", "phi-turner", "Trea Turner", "Batter", "SS", "R", "infield", "speed", 75, "Speedster",
    A("triple-threat-turner", "Triple Threat",
      { kind: "onSnap", edge: "speed" },
      { speedMultiplier: 1.5, flavor: "Speed multiplier becomes 1.5x next card." }),
    [
      A("bag-to-bag", "Bag to Bag",
        { kind: "onSnap" },
        { hitScaleBonus: 2, flavor: "+2 Hit Scale per snap." }),
    ]),

  P("PHI", "phi-schwarber", "Kyle Schwarber", "Batter", "DH", "L", "power", "blank", 75, "Slugger",
    A("schwarbomb", "Schwarbomb",
      { kind: "onLockIn", whenRole: "Batter" },
      { scoreBonus: 20, oneShotPerMatchup: true, flavor: "+20 score on lock-in." }),
    [
      A("lead-off-spark-schwarber", "Lead-Off Spark",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 if first card in chain." }),
    ]),

  P("PHI", "phi-bohm", "Alec Bohm", "Batter", "3B", "R", "infield", "contact", 55, "Contact",
    A("hot-corner", "Hot Corner",
      { kind: "onSnap", edge: "infield" },
      { scoreBonus: 3, flavor: "+3 score per Infield snap." }),
    [
      A("clutch-hot", "Clutch Hot",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 8, oneShotPerMatchup: true, flavor: "+8 score with bases loaded." }),
    ]),

  P("PHI", "phi-castellanos", "Nick Castellanos", "Batter", "OF", "R", "outfield", "power", 65, "Slugger",
    A("castellanos", "Castellanos",
      { kind: "onSnap", edge: "power" },
      { scoreBonus: 5, flavor: "+5 score per Power snap." }),
    [
      A("right-field-hero", "Right Field Hero",
        { kind: "onMatchupWin" },
        { nextWeekCashBonus: 1, flavor: "+$1 future cash on matchup win." }),
    ]),

  P("PHI", "phi-marsh", "Brandon Marsh", "Batter", "OF", "L", "outfield", "patience", 40, "Contact",
    A("marshmallow-eye", "Marshmallow Eye",
      { kind: "onSnap", edge: "patience" },
      { hitScaleBonus: 3, flavor: "+3 Hit Scale per Patience snap." }),
    [
      A("catch-and-hit", "Catch & Hit",
        { kind: "onSnap", edge: "outfield" },
        { scoreBonus: 2, flavor: "+2 score per Outfield snap." }),
    ]),

  P("PHI", "phi-realmuto", "J.T. Realmuto", "Batter", "C", "R", "contact", "battery", 60, "Contact",
    A("best-in-game", "Best in Game",
      { kind: "onSnap", edge: "battery" },
      { pitcherCombinedDelta: 12, flavor: "Pitcher in chain gains +12 score per Battery snap." }),
    [
      A("cannon-arm", "Cannon Arm",
        { kind: "passive", description: "Opposing batter loses 3 when Realmuto is chained." },
        { opponentScoreDelta: -3, flavor: "Opponent batter -3 when Realmuto is chained." }),
    ]),

  P("PHI", "phi-stott", "Bryson Stott", "Batter", "2B", "L", "infield", "contact", 45, "Contact",
    A("stott-switch", "Stott Switch",
      { kind: "onSnap", edge: "contact" },
      { scoreBonus: 3, flavor: "+3 score per Contact snap." }),
    [
      A("pesky-bat", "Pesky Bat",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score with chain length 4+." }),
    ]),

  P("PHI", "phi-sosa", "Edmundo Sosa", "Batter", "INF", "R", "wildcard", "infield", 35, "Contact",
    A("super-utility", "Super Utility",
      { kind: "onSnap" },
      { scoreBonus: 1, flavor: "+1 score on every snap." }),
    [
      A("spark", "Spark",
        { kind: "onSnap", edge: "speed" },
        { scoreBonus: 2, flavor: "+2 score per Speed snap." }),
    ]),

  P("PHI", "phi-pache", "Cristian Pache", "Batter", "OF", "R", "outfield", "speed", 35, "Speedster",
    A("defensive-replacement", "Defensive Replacement",
      { kind: "onSnap", edge: "outfield" },
      { hitScaleBonus: 2, flavor: "+2 Hit Scale per Outfield snap." }),
    [
      A("late-game-legs", "Late-Game Legs",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score in final inning." }),
    ]),

  P("PHI", "phi-miller", "Aidan Miller", "Batter", "INF", "R", "rookie", "infield", 30, "Rookie",
    A("top-prospect-miller", "Top Prospect",
      { kind: "onSnap", edge: "rookie", sideOfSelf: "right" },
      { scoreBonus: 3, flavor: "+3 score when snapped INTO a Veteran." }),
    [
      A("power-potential", "Power Potential",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score with chain length 5+." }),
    ]),

  P("PHI", "phi-crawford", "Justin Crawford", "Batter", "OF", "L", "rookie", "speed", 25, "Rookie",
    A("crawford-speed", "Crawford Speed",
      { kind: "onSnap", edge: "speed" },
      { hitScaleBonus: 3, flavor: "+3 Hit Scale per Speed snap." }),
    [
      A("five-tool-bloom", "Five-Tool Bloom",
        { kind: "onMatchupReveal" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score on reveal." }),
    ]),

  // ----- Pitchers (13-20) -----
  P("PHI", "phi-wheeler", "Zack Wheeler", "Pitcher", "SP", "R", "velocity", "control", 90, "Veteran",
    A("ace-2", "Ace 2",
      { kind: "onLockIn", whenRole: "Pitcher" },
      { scoreBonus: 12, pitcherWinsTies: true, oneShotPerMatchup: true, flavor: "+12 score and wins ties." }),
    [
      A("cy-vote", "Cy Vote",
        { kind: "onSnap", edge: "velocity" },
        { scoreBonus: 5, flavor: "+5 score per Velocity snap." }),
      A("wheels", "Wheels",
        { kind: "onMatchupWin" },
        { nextWeekCashBonus: 1, flavor: "+$1 future cash on matchup win." }),
    ]),

  P("PHI", "phi-nola", "Aaron Nola", "Pitcher", "SP", "R", "control", "movement", 80, "Strikeout",
    A("knuckle-curve", "Knuckle Curve",
      { kind: "onSnap", edge: "control" },
      { opponentScoreDelta: -3, flavor: "Opponent batter -3 per Control snap." }),
    [
      A("long-innings", "Long Innings",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score with chain length 5+." }),
    ]),

  P("PHI", "phi-sanchez", "Cristopher Sánchez", "Pitcher", "SP", "L", "lefty", "movement", 65, "Groundball",
    A("tall-lefty", "Tall Lefty",
      { kind: "onSnap", edge: "movement" },
      { opponentScoreDelta: -4, flavor: "Opponent batter -4 per Movement snap." }),
    [
      A("sinker", "Sinker",
        { kind: "onMatchupReveal" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score on reveal." }),
    ]),

  P("PHI", "phi-suarez", "Ranger Suárez", "Pitcher", "SP", "L", "lefty", "control", 70, "Control",
    A("lefty-cutter", "Lefty Cutter",
      { kind: "onSnap", edge: "lefty" },
      { scoreBonus: 4, flavor: "+4 score per Lefty snap." }),
    [
      A("money-pitcher", "Money Pitcher",
        { kind: "onLockIn", whenRole: "Pitcher" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score vs L-batter on lock-in." }),
    ]),

  P("PHI", "phi-luzardo", "Jesús Luzardo", "Pitcher", "SP", "L", "lefty", "velocity", 70, "Strikeout",
    A("luzardo-heat", "Luzardo Heat",
      { kind: "onSnap", edge: "velocity" },
      { scoreBonus: 5, flavor: "+5 score per Velocity snap." }),
    [
      A("rebound-arm", "Rebound Arm",
        { kind: "onMatchupReveal" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score after a loss." }),
    ]),

  P("PHI", "phi-kerkering", "Orion Kerkering", "Pitcher", "RP", "R", "movement", "velocity", 55, "Strikeout",
    A("sweeper", "Sweeper",
      { kind: "onSnap", edge: "movement" },
      { scoreBonus: 3, opponentScoreDelta: -3, flavor: "+3 score and opponent batter -3 per Movement snap." }),
    [
      A("setup-man", "Setup Man",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score if CP in chain." }),
    ]),

  P("PHI", "phi-hoffman", "Jeff Hoffman", "Pitcher", "RP", "R", "velocity", "control", 55, "Strikeout",
    A("hoffman-heat", "Hoffman Heat",
      { kind: "onSnap", edge: "velocity" },
      { scoreBonus: 4, flavor: "+4 score per Velocity snap." }),
    [
      A("late-inning-heat", "Late-Inning Heat",
        { kind: "onLockIn", whenRole: "Pitcher" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score in final inning." }),
    ]),

  P("PHI", "phi-alvarado", "José Alvarado", "Pitcher", "CP", "L", "lefty", "blank", 65, "Closer",
    A("cutter-king", "Cutter King",
      { kind: "onLockIn", whenRole: "Pitcher" },
      { scoreBonus: 14, oneShotPerMatchup: true, flavor: "+14 score on lock-in." }),
    [
      A("sinker-closer", "Sinker Closer",
        { kind: "onTeammateSnap", edge: "movement" },
        { scoreBonus: 5, flavor: "+5 score per Movement teammate snap." }),
    ]),
];

// ---------------------------------------------------------------------------
// Toronto Blue Jays (TOR)
// ---------------------------------------------------------------------------

const TOR: SznPlayer[] = [
  // ----- Batters (1-12) -----
  P("TOR", "tor-vlad", "Vladimir Guerrero Jr.", "Batter", "1B", "R", "bluejays-logo", "power", 85, "Slugger",
    A("vladdy", "Vladdy",
      { kind: "onSnap", edge: "power" },
      { scoreBonus: 5, flavor: "+5 score per Power snap." }),
    [
      A("all-star-1b", "All-Star First Baseman",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 12, oneShotPerMatchup: true, flavor: "+12 score on lock-in." }),
      A("heart-of-order", "Heart of Order",
        { kind: "onTeammateSnap" },
        { scoreBonus: 1, flavor: "+1 score per teammate snap." }),
    ]),

  P("TOR", "tor-bichette", "Bo Bichette", "Batter", "SS", "R", "infield", "contact", 65, "Contact",
    A("bichette", "Bichette",
      { kind: "onSnap", edge: "infield" },
      { scoreBonus: 4, flavor: "+4 score per Infield snap." }),
    [
      A("hair-flow", "Hair Flow",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score with chain length 4+." }),
    ]),

  P("TOR", "tor-springer", "George Springer", "Batter", "OF", "R", "outfield", "veteran-tag", 60, "Veteran",
    A("vet-lift", "Vet Lift",
      { kind: "onSnap", edge: "veteran-tag", sideOfSelf: "right" },
      { permanentBoostOnRookie: 2, flavor: "Snapping rookie gets +2 permanent base score." }),
    [
      A("lead-off-hitter-springer", "Lead-Off Hitter",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score on lock-in." }),
    ]),

  P("TOR", "tor-varsho", "Daulton Varsho", "Batter", "OF", "L", "outfield", "speed", 55, "Speedster",
    A("varshos-glove", "Varsho's Glove",
      { kind: "onSnap", edge: "outfield" },
      { hitScaleBonus: 3, flavor: "+3 Hit Scale per Outfield snap." }),
    [
      A("web-gem", "Web Gem",
        { kind: "onMatchupReveal" },
        { opponentScoreDelta: -3, oneShotPerMatchup: true, flavor: "Opponent -3 on reveal." }),
    ]),

  P("TOR", "tor-santander", "Anthony Santander", "Batter", "OF", "S", "power", "outfield", 60, "Slugger",
    A("tony-taters", "Tony Taters",
      { kind: "onSnap", edge: "power" },
      { scoreBonus: 5, flavor: "+5 score per Power snap." }),
    [
      A("switch-power", "Switch Power",
        { kind: "passive", description: "Pitcher handedness penalties don't apply." },
        { flavor: "Switch-hitter ignores pitcher hand penalty." }),
    ]),

  P("TOR", "tor-gimenez", "Andrés Giménez", "Batter", "2B", "L", "infield", "speed", 50, "Speedster",
    A("glove-gimmer", "Glove Gimmer",
      { kind: "onSnap", edge: "infield" },
      { hitScaleBonus: 3, flavor: "+3 Hit Scale per Infield snap." }),
    [
      A("stolen-base-threat", "Stolen Base Threat",
        { kind: "onSnap", edge: "speed" },
        { opponentScoreDelta: -3, flavor: "Opponent pitcher -3 per Speed snap." }),
    ]),

  P("TOR", "tor-clement", "Ernie Clement", "Batter", "INF", "R", "contact", "infield", 35, "Contact",
    A("clement-contact", "Clement Contact",
      { kind: "onSnap", edge: "contact" },
      { scoreBonus: 3, flavor: "+3 score per Contact snap." }),
    [
      A("utility-bench", "Utility Bench",
        { kind: "onSnap" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score with chain length 5+." }),
    ]),

  P("TOR", "tor-kirk", "Alejandro Kirk", "Batter", "C", "R", "contact", "battery", 55, "Contact",
    A("backstop-kirk", "Backstop Kirk",
      { kind: "onSnap", edge: "battery" },
      { pitcherCombinedDelta: 10, flavor: "Pitcher in chain gains +10 score per Battery snap." }),
    [
      A("heavy-bat-catcher", "Heavy Bat Catcher",
        { kind: "onLockIn", whenRole: "Batter" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 if Power in chain." }),
    ]),

  P("TOR", "tor-schneider", "Davis Schneider", "Batter", "UTL", "R", "wildcard", "contact", 40, "Contact",
    A("mustache-magic", "Mustache Magic",
      { kind: "onSnap" },
      { scoreBonus: 1, flavor: "+1 score on every snap." }),
    [
      A("lefty-killer", "Lefty Killer",
        { kind: "onSnap" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score vs L-pitcher." }),
    ]),

  P("TOR", "tor-wagner", "Will Wagner", "Batter", "INF", "L", "rookie", "contact", 30, "Rookie",
    A("wagner-eye", "Wagner Eye",
      { kind: "onSnap", edge: "rookie", sideOfSelf: "right" },
      { scoreBonus: 3, flavor: "+3 score when snapped INTO a Veteran." }),
    [
      A("rookie-contact", "Rookie Contact",
        { kind: "onSnap", edge: "contact" },
        { scoreBonus: 2, flavor: "+2 score per Contact snap." }),
    ]),

  P("TOR", "tor-barger", "Addison Barger", "Batter", "UTL", "L", "contact", "wildcard", 35, "Contact",
    A("barger-switch", "Barger Switch",
      { kind: "onSnap" },
      { scoreBonus: 1, flavor: "+1 score on every snap." }),
    [
      A("cup-of-coffee", "Cup of Coffee",
        { kind: "onMatchupReveal" },
        { scoreBonus: 2, oneShotPerMatchup: true, flavor: "+2 score on reveal." }),
    ]),

  P("TOR", "tor-heineman", "Tyler Heineman", "Batter", "C", "S", "contact", "battery", 35, "Contact",
    A("backup-backstop", "Backup Backstop",
      { kind: "onSnap", edge: "battery" },
      { scoreBonus: 5, flavor: "+5 score per Battery snap." }),
    [
      A("game-caller", "Game Caller",
        { kind: "onSnap" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score if pitcher in chain." }),
    ]),

  // ----- Pitchers (13-20) -----
  P("TOR", "tor-berrios", "José Berríos", "Pitcher", "SP", "R", "velocity", "control", 80, "Veteran",
    A("berrios", "Berríos",
      { kind: "onSnap", edge: "velocity" },
      { scoreBonus: 5, flavor: "+5 score per Velocity snap." }),
    [
      A("innings-eater", "Innings Eater",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score with chain length 5+." }),
      A("ace-3", "Ace 3",
        { kind: "onLockIn", whenRole: "Pitcher" },
        { scoreBonus: 10, oneShotPerMatchup: true, flavor: "+10 score on lock-in." }),
    ]),

  P("TOR", "tor-gausman", "Kevin Gausman", "Pitcher", "SP", "R", "velocity", "movement", 75, "Strikeout",
    A("splitter", "Splitter",
      { kind: "onSnap", edge: "movement" },
      { opponentScoreDelta: -4, flavor: "Opponent batter -4 per Movement snap." }),
    [
      A("splitty-king", "Splitty King",
        { kind: "onTeammateSnap", edge: "deception" },
        { scoreBonus: 5, flavor: "+5 score per Deception teammate snap." }),
    ]),

  P("TOR", "tor-bassitt", "Chris Bassitt", "Pitcher", "SP", "R", "control", "deception", 65, "Control",
    A("bassitt-funk", "Bassitt Funk",
      { kind: "onSnap", edge: "deception" },
      { chainShatterChance: 0.2, flavor: "20% to shatter opponent's chain." }),
    [
      A("eephus", "Eephus",
        { kind: "onMatchupReveal" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score on reveal." }),
    ]),

  P("TOR", "tor-francis", "Bowden Francis", "Pitcher", "SP", "R", "movement", "control", 55, "Groundball",
    A("knuckle-movement", "Knuckle-Movement",
      { kind: "onSnap", edge: "movement" },
      { scoreBonus: 3, opponentScoreDelta: -3, flavor: "+3 score and opponent batter -3 per Movement snap." }),
    [
      A("no-hit-pace", "No-Hit Pace",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 score with chain length 5+." }),
    ]),

  P("TOR", "tor-scherzer", "Max Scherzer", "Pitcher", "SP", "R", "velocity", "bluejays-logo", 80, "Veteran",
    A("mad-max", "Mad Max",
      { kind: "onLockIn", whenRole: "Pitcher" },
      { scoreBonus: 8, pitcherWinsTies: true, oneShotPerMatchup: true, flavor: "+8 score and wins ties." }),
    [
      A("heterochromia", "Heterochromia",
        { kind: "onSnap", edge: "velocity" },
        { scoreBonus: 5, flavor: "+5 score per Velocity snap." }),
      A("future-hof", "Future HOF",
        { kind: "passive", description: "Chain treated as 1 longer for length requirements." },
        { chainLengthForgiveness: 1, flavor: "Scherzer's chain counts as one card longer." }),
    ]),

  P("TOR", "tor-rodriguez", "Yariel Rodríguez", "Pitcher", "RP", "R", "deception", "velocity", 50, "Strikeout",
    A("yariel-sweep", "Yariel Sweep",
      { kind: "onSnap", edge: "deception" },
      { chainShatterChance: 0.25, flavor: "25% to shatter opponent's chain." }),
    [
      A("cuban-connection", "Cuban Connection",
        { kind: "onSnap" },
        { scoreBonus: 2, flavor: "+2 score per snap." }),
    ]),

  P("TOR", "tor-yimi", "Yimi García", "Pitcher", "RP", "R", "control", "battery", 45, "Control",
    A("yimi", "Yimi",
      { kind: "onSnap", edge: "control" },
      { opponentScoreDelta: -3, flavor: "Opponent batter -3 per Control snap." }),
    [
      A("setup", "Setup",
        { kind: "onSnap" },
        { scoreBonus: 3, oneShotPerMatchup: true, flavor: "+3 score if CP in chain." }),
    ]),

  P("TOR", "tor-romano", "Jordan Romano", "Pitcher", "CP", "R", "velocity", "blank", 65, "Closer",
    A("major-slider", "Major Slider",
      { kind: "onLockIn", whenRole: "Pitcher" },
      { scoreBonus: 14, oneShotPerMatchup: true, flavor: "+14 score on lock-in." }),
    [
      A("canadian-closer", "Canadian Closer",
        { kind: "onSnap" },
        { scoreBonus: 5, oneShotPerMatchup: true, flavor: "+5 if 2+ TOR teammates chained." }),
    ]),
];

/**
 * Per-team roster pool keyed by `MlbTeamId`. Three franchises (NYY, PHI,
 * TOR) are populated in v2. The remaining 27 register as empty pools.
 * The starter pack samples 10 from this pool.
 */
export const SZN_PLAYERS_BY_TEAM: Record<MlbTeamId, SznPlayer[]> = {
  NYY,
  BOS: [],
  TOR,
  BAL: [],
  TBR: [],
  CLE: [],
  DET: [],
  KCR: [],
  MIN: [],
  CHW: [],
  HOU: [],
  SEA: [],
  TEX: [],
  LAA: [],
  OAK: [],
  ATL: [],
  NYM: [],
  PHI,
  MIA: [],
  WSN: [],
  MIL: [],
  CHC: [],
  STL: [],
  CIN: [],
  PIT: [],
  LAD: [],
  SDP: [],
  SFG: [],
  ARI: [],
  COL: [],
};

/** Flat list of every SZN player across all teams (useful for lookups). */
export const ALL_SZN_PLAYERS: SznPlayer[] = Object.values(SZN_PLAYERS_BY_TEAM).flat();

const _byId: Record<string, SznPlayer> = {};
for (const p of ALL_SZN_PLAYERS) _byId[p.id] = p;

export function getSznPlayer(id: string): SznPlayer | undefined {
  return _byId[id];
}

/**
 * Type guard distinguishing SZN players from the legacy `MlbPlayer`. SZN
 * players are the only ones carrying `leftEdge` -- legacy players use
 * `leftShape`.
 */
export function isSznPlayer(p: unknown): p is SznPlayer {
  return (
    !!p &&
    typeof p === "object" &&
    typeof (p as SznPlayer).leftEdge === "string" &&
    typeof (p as SznPlayer).rightEdge === "string"
  );
}

/**
 * Adapter that satisfies the legacy `MlbPlayer` contract using a SZN player.
 * SZN combat passes the player through the same scoring engine which reads a
 * few MlbPlayer-only fields (`team`, `signatureCardIds`, `leftShape`,
 * `rightShape`) for historic shape-based reasons. We stub those with
 * neutral defaults so the engine doesn't crash on a SZN-only roster, while
 * the semantic edge fields drive the actual snap logic via `canSznSnap`.
 *
 * Returns the original object unchanged when already an MlbPlayer so call
 * sites can blindly pipe `MlbPlayer | SznPlayer` through this.
 */
export function asMlbPlayerCompat(p: MlbPlayer | SznPlayer): MlbPlayer {
  if (!isSznPlayer(p)) return p;
  const WILD: ShapeType = "wildcard";
  return {
    id: p.id,
    name: p.name,
    team: p.teamId,
    role: p.role,
    handedness: p.handedness,
    signatureCardIds: [],
    leftShape: WILD,
    rightShape: WILD,
    tag: p.tag,
  };
}

// ---------------------------------------------------------------------------
// Module-load sanity checks
// ---------------------------------------------------------------------------

import { SZN_EDGES } from "./sznEdges";

function validateTeam(label: string, roster: SznPlayer[], expectedCount: number): void {
  if (roster.length !== expectedCount) {
    throw new Error(
      `sznPlayers.ts: ${label} roster expected ${expectedCount} players, got ${roster.length}.`,
    );
  }
  const batters = roster.filter((p) => p.role === "Batter").length;
  const pitchers = roster.filter((p) => p.role === "Pitcher").length;
  if (batters !== 12 || pitchers !== 8) {
    throw new Error(
      `sznPlayers.ts: ${label} roster expected 12 batters + 8 pitchers, got ${batters} + ${pitchers}.`,
    );
  }
  const seenPlayerIds = new Set<string>();
  for (const p of roster) {
    if (seenPlayerIds.has(p.id)) {
      throw new Error(`sznPlayers.ts: duplicate player id "${p.id}" in ${label}.`);
    }
    seenPlayerIds.add(p.id);
    if (!SZN_EDGES[p.leftEdge]) {
      throw new Error(
        `sznPlayers.ts: ${p.id} (${p.name}) has unknown leftEdge "${p.leftEdge}".`,
      );
    }
    if (!SZN_EDGES[p.rightEdge]) {
      throw new Error(
        `sznPlayers.ts: ${p.id} (${p.name}) has unknown rightEdge "${p.rightEdge}".`,
      );
    }
    if (!p.passive || !p.passive.id || !p.passive.name) {
      throw new Error(
        `sznPlayers.ts: ${p.id} (${p.name}) is missing a passive ability.`,
      );
    }
    const allAbilityIds = [p.passive.id, ...(p.potentials ?? []).map((a) => a.id)];
    const dup = allAbilityIds.find((id, i) => allAbilityIds.indexOf(id) !== i);
    if (dup) {
      throw new Error(
        `sznPlayers.ts: ${p.id} (${p.name}) has duplicate ability id "${dup}".`,
      );
    }
    // Edge id references inside ability triggers must resolve too.
    const triggers: { edge?: SznEdgeId }[] = [
      p.passive.trigger as { edge?: SznEdgeId },
      ...((p.potentials ?? []).map((a) => a.trigger as { edge?: SznEdgeId })),
    ];
    for (const t of triggers) {
      if (t.edge !== undefined && !SZN_EDGES[t.edge]) {
        throw new Error(
          `sznPlayers.ts: ${p.id} (${p.name}) references unknown edge "${t.edge}" in an ability trigger.`,
        );
      }
    }
  }
}

validateTeam("NYY", NYY, 20);
validateTeam("PHI", PHI, 20);
validateTeam("TOR", TOR, 20);

// Cross-team uniqueness on the player id namespace.
{
  const seen = new Set<string>();
  for (const p of ALL_SZN_PLAYERS) {
    if (seen.has(p.id)) {
      throw new Error(`sznPlayers.ts: duplicate player id across teams: "${p.id}".`);
    }
    seen.add(p.id);
  }
}
