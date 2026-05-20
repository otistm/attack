/**
 * SZN Mode player pool.
 *
 * Distinct from the legacy `MlbPlayer` catalog in `players.ts` (which still
 * powers Quick Match / Auction Draft and uses geometric shape sockets). SZN
 * players carry semantic `leftEdge` / `rightEdge` ids from `sznEdges.ts`
 * plus rich position / role / base-score data the run economy needs.
 *
 * v1 ships the full New York Yankees roster (20 players) per the spec; the
 * other 29 franchises register as empty pools so the picker can disable
 * them with "COMING SOON" without crashing the rest of the pipeline.
 */

import type { ShapeType } from "../components/cardShapes";
import type { Handedness } from "./cards";
import type { ClassTag } from "./run";
import type { MlbPlayer } from "./players";
import type { SznEdgeId } from "./sznEdges";
import type { MlbTeamId } from "./sznTeams";

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
  /** Optional flavor blurb for tooltips. */
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
  flavor,
});

// ---------------------------------------------------------------------------
// New York Yankees (NYY) -- the spec roster.
// ---------------------------------------------------------------------------

const NYY: SznPlayer[] = [
  // ----- Batters (1-12) -----
  P("NYY", "nyy-judge", "Aaron Judge", "Batter", "OF", "R", "yankees-logo", "power", 85, "Slugger",
    "The ultimate anchor for a power chain."),
  P("NYY", "nyy-dominguez", "Jasson Dominguez", "Batter", "OF", "S", "speed", "power", 75, "Speedster",
    "The Martian -- versatile superstar slugger."),
  P("NYY", "nyy-stanton", "Giancarlo Stanton", "Batter", "DH", "R", "power", "blank", 75, "Slugger",
    "Massive score, but his low speed means he acts as a dead-end."),
  P("NYY", "nyy-chisholm", "Jazz Chisholm Jr.", "Batter", "3B", "L", "infield", "speed", 65, "Speedster",
    "Essential for creating fast, high-multiplier infield chains."),
  P("NYY", "nyy-volpe", "Anthony Volpe", "Batter", "SS", "R", "infield", "contact", 55, "Contact",
    "Snaps perfectly to keep chains alive without breaking."),
  P("NYY", "nyy-wells", "Austin Wells", "Batter", "C", "L", "power", "battery", 55, "Contact",
    "The critical bridge card from your batting chain into your pitching chain."),
  P("NYY", "nyy-lemahieu", "DJ LeMahieu", "Batter", "INF", "R", "veteran-tag", "al-east-patch", 40, "Veteran",
    "Snap a Rookie to his left edge for a permanent stat boost."),
  P("NYY", "nyy-cabrera", "Oswaldo Cabrera", "Batter", "UTL", "S", "wildcard", "contact", 35, "Contact",
    "Utility man -- his left side can snap to absolutely anything to save a broken chain."),
  P("NYY", "nyy-grisham", "Trent Grisham", "Batter", "OF", "L", "outfield", "patience", 35, "Contact",
    "Great for extending chains easily."),
  P("NYY", "nyy-rice", "Ben Rice", "Batter", "1B", "L", "rookie", "infield", 40, "Rookie"),
  P("NYY", "nyy-jones", "Spencer Jones", "Batter", "OF", "L", "rookie", "power", 25, "Rookie",
    "High-risk call-up with a ton of upside if chained correctly."),
  P("NYY", "nyy-durbin", "Caleb Durbin", "Batter", "INF", "R", "speed", "rookie", 20, "Rookie"),

  // ----- Pitchers (13-20) -----
  P("NYY", "nyy-cole", "Gerrit Cole", "Pitcher", "SP", "R", "battery", "velocity", 90, "Veteran",
    "Bridges perfectly from your Catcher. Pure heat to guarantee strikeouts."),
  P("NYY", "nyy-gil", "Luis Gil", "Pitcher", "SP", "R", "velocity", "movement", 75, "Strikeout",
    "Elite two-edge combo for racking up strikeout scores."),
  P("NYY", "nyy-rodon", "Carlos Rodón", "Pitcher", "SP", "L", "lefty", "velocity", 70, "Strikeout"),
  P("NYY", "nyy-weaver", "Luke Weaver", "Pitcher", "CP", "R", "movement", "blank", 65, "Closer",
    "Slams the door. Nothing can snap after him."),
  P("NYY", "nyy-cortes", "Nestor Cortes", "Pitcher", "SP", "L", "yankees-logo", "deception", 60, "Control",
    "Funky delivery -- 25% chance to shatter the enemy's chain."),
  P("NYY", "nyy-stroman", "Marcus Stroman", "Pitcher", "SP", "R", "movement", "righty", 55, "Groundball",
    "Movement applies a debuff to the enemy batter."),
  P("NYY", "nyy-schmidt", "Clarke Schmidt", "Pitcher", "SP", "R", "control", "yankees-logo", 55, "Starter",
    "Highly flexible bridging edge for the pitching staff."),
  P("NYY", "nyy-hamilton", "Ian Hamilton", "Pitcher", "RP", "R", "battery", "control", 45, "Control",
    "The 'Slambio' specialist, perfect for middle relief chains."),
];

/**
 * Per-team roster pool keyed by `MlbTeamId`. Only NYY is populated in v1.
 * The starter pack samples 10 from this pool.
 */
export const SZN_PLAYERS_BY_TEAM: Record<MlbTeamId, SznPlayer[]> = {
  NYY,
  BOS: [],
  TOR: [],
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
  PHI: [],
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

// Module-load sanity check: every Yankees player must reference an edge id
// that exists in the registry. We import lazily here to avoid a circular
// import in extremely unusual bundler graphs.
import { SZN_EDGES } from "./sznEdges";
for (const p of NYY) {
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
}
if (NYY.length !== 20) {
  throw new Error(
    `sznPlayers.ts: NYY roster expected 20 players, got ${NYY.length}.`,
  );
}
