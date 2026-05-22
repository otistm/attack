/**
 * SZN Mode team registry.
 *
 * The team picker shown at the start of a SZN run renders one tile per
 * franchise from this registry. Each team carries the passive badge it
 * grants for the run and a `available` flag that gates the rest of the
 * pipeline (player pool, special edge effects, etc.) -- only Yankees is
 * fully implemented in v1; the other 29 are present as placeholders so
 * the picker doesn't shift layout when we backfill them later.
 */

import type { BadgeId } from "./badges";
import type { SznEdgeId } from "./sznEdges";

export type MlbDivision =
  | "AL East"
  | "AL Central"
  | "AL West"
  | "NL East"
  | "NL Central"
  | "NL West";

export type MlbTeamId =
  // AL East
  | "NYY"
  | "BOS"
  | "TOR"
  | "BAL"
  | "TBR"
  // AL Central
  | "CLE"
  | "DET"
  | "KCR"
  | "MIN"
  | "CHW"
  // AL West
  | "HOU"
  | "SEA"
  | "TEX"
  | "LAA"
  | "OAK"
  // NL East
  | "ATL"
  | "NYM"
  | "PHI"
  | "MIA"
  | "WSN"
  // NL Central
  | "MIL"
  | "CHC"
  | "STL"
  | "CIN"
  | "PIT"
  // NL West
  | "LAD"
  | "SDP"
  | "SFG"
  | "ARI"
  | "COL";

export interface MlbTeam {
  id: MlbTeamId;
  /** Full franchise name, e.g. "New York Yankees". */
  name: string;
  /** Mascot only, e.g. "Yankees". */
  shortName: string;
  /** Three-letter team code (matches the source code conventions). */
  abbr: string;
  division: MlbDivision;
  /** Primary uniform color (hex). */
  primaryColor: string;
  /** Secondary uniform color (hex). */
  secondaryColor: string;
  /** Passive badge granted at the start of a run with this team. */
  passiveBadgeId: BadgeId;
  /** False = "COMING SOON" tile in the picker. */
  available: boolean;
}

/**
 * Convenience builder for placeholders so backfill is a one-line change
 * (flip `available: true` once the player pool + badge are wired).
 */
const T = (
  id: MlbTeamId,
  name: string,
  shortName: string,
  division: MlbDivision,
  primary: string,
  secondary: string,
  passive: BadgeId,
  available = false,
): MlbTeam => ({
  id,
  name,
  shortName,
  abbr: id,
  division,
  primaryColor: primary,
  secondaryColor: secondary,
  passiveBadgeId: passive,
  available,
});

export const MLB_TEAMS: Record<MlbTeamId, MlbTeam> = {
  // ----- AL East -----
  NYY: T("NYY", "New York Yankees", "Yankees", "AL East", "#0c1a4a", "#c4ced4", "bronx-bombers", true),
  BOS: T("BOS", "Boston Red Sox", "Red Sox", "AL East", "#bd3039", "#0c2340", "tbd-passive"),
  TOR: T("TOR", "Toronto Blue Jays", "Blue Jays", "AL East", "#134a8e", "#1d2d5c", "north-of-the-border", true),
  BAL: T("BAL", "Baltimore Orioles", "Orioles", "AL East", "#df4601", "#000000", "tbd-passive"),
  TBR: T("TBR", "Tampa Bay Rays", "Rays", "AL East", "#092c5c", "#8fbce6", "tbd-passive"),

  // ----- AL Central -----
  CLE: T("CLE", "Cleveland Guardians", "Guardians", "AL Central", "#00385d", "#e50022", "tbd-passive"),
  DET: T("DET", "Detroit Tigers", "Tigers", "AL Central", "#0c2340", "#fa4616", "tbd-passive"),
  KCR: T("KCR", "Kansas City Royals", "Royals", "AL Central", "#004687", "#bd9b60", "tbd-passive"),
  MIN: T("MIN", "Minnesota Twins", "Twins", "AL Central", "#002b5c", "#d31145", "tbd-passive"),
  CHW: T("CHW", "Chicago White Sox", "White Sox", "AL Central", "#27251f", "#c4ced4", "tbd-passive"),

  // ----- AL West -----
  HOU: T("HOU", "Houston Astros", "Astros", "AL West", "#002d62", "#eb6e1f", "tbd-passive"),
  SEA: T("SEA", "Seattle Mariners", "Mariners", "AL West", "#0c2c56", "#005c5c", "tbd-passive"),
  TEX: T("TEX", "Texas Rangers", "Rangers", "AL West", "#003278", "#c0111f", "tbd-passive"),
  LAA: T("LAA", "Los Angeles Angels", "Angels", "AL West", "#ba0021", "#003263", "tbd-passive"),
  OAK: T("OAK", "Oakland Athletics", "Athletics", "AL West", "#003831", "#efb21e", "tbd-passive"),

  // ----- NL East -----
  ATL: T("ATL", "Atlanta Braves", "Braves", "NL East", "#ce1141", "#13274f", "tbd-passive"),
  NYM: T("NYM", "New York Mets", "Mets", "NL East", "#002d72", "#ff5910", "tbd-passive"),
  PHI: T("PHI", "Philadelphia Phillies", "Phillies", "NL East", "#e81828", "#002d72", "liberty-bell", true),
  MIA: T("MIA", "Miami Marlins", "Marlins", "NL East", "#00a3e0", "#ef3340", "tbd-passive"),
  WSN: T("WSN", "Washington Nationals", "Nationals", "NL East", "#ab0003", "#14225a", "tbd-passive"),

  // ----- NL Central -----
  MIL: T("MIL", "Milwaukee Brewers", "Brewers", "NL Central", "#0a2351", "#b6922e", "tbd-passive"),
  CHC: T("CHC", "Chicago Cubs", "Cubs", "NL Central", "#0e3386", "#cc3433", "tbd-passive"),
  STL: T("STL", "St. Louis Cardinals", "Cardinals", "NL Central", "#c41e3a", "#0c2340", "tbd-passive"),
  CIN: T("CIN", "Cincinnati Reds", "Reds", "NL Central", "#c6011f", "#000000", "tbd-passive"),
  PIT: T("PIT", "Pittsburgh Pirates", "Pirates", "NL Central", "#fdb827", "#27251f", "tbd-passive"),

  // ----- NL West -----
  LAD: T("LAD", "Los Angeles Dodgers", "Dodgers", "NL West", "#005a9c", "#ef3e42", "tbd-passive"),
  SDP: T("SDP", "San Diego Padres", "Padres", "NL West", "#2f241d", "#ffc425", "tbd-passive"),
  SFG: T("SFG", "San Francisco Giants", "Giants", "NL West", "#fd5a1e", "#27251f", "tbd-passive"),
  ARI: T("ARI", "Arizona Diamondbacks", "Diamondbacks", "NL West", "#a71930", "#e3d4ad", "tbd-passive"),
  COL: T("COL", "Colorado Rockies", "Rockies", "NL West", "#33006f", "#c4ced4", "tbd-passive"),
};

export const MLB_DIVISIONS: MlbDivision[] = [
  "AL East",
  "AL Central",
  "AL West",
  "NL East",
  "NL Central",
  "NL West",
];

/** All team ids, in stable display order (AL East → NL West). */
export const MLB_TEAM_IDS: MlbTeamId[] = MLB_DIVISIONS.flatMap((d) =>
  (Object.values(MLB_TEAMS) as MlbTeam[])
    .filter((t) => t.division === d)
    .map((t) => t.id),
);

/**
 * Map an `MlbTeamId` to the matching franchise-logo `SznEdgeId`. Used by
 * the synthetic `team-logo` edge resolver (see `connect.ts`) so encounter
 * items that grant "this player's team logo" can stamp the correct edge.
 */
const TEAM_LOGO_EDGE: Record<MlbTeamId, SznEdgeId> = {
  NYY: "yankees-logo",
  BOS: "redsox-logo",
  TOR: "bluejays-logo",
  BAL: "orioles-logo",
  TBR: "rays-logo",
  CLE: "guardians-logo",
  DET: "tigers-logo",
  KCR: "royals-logo",
  MIN: "twins-logo",
  CHW: "whitesox-logo",
  HOU: "astros-logo",
  SEA: "mariners-logo",
  TEX: "rangers-logo",
  LAA: "angels-logo",
  OAK: "athletics-logo",
  ATL: "braves-logo",
  NYM: "mets-logo",
  PHI: "phillies-logo",
  MIA: "marlins-logo",
  WSN: "nationals-logo",
  MIL: "brewers-logo",
  CHC: "cubs-logo",
  STL: "cardinals-logo",
  CIN: "reds-logo",
  PIT: "pirates-logo",
  LAD: "dodgers-logo",
  SDP: "padres-logo",
  SFG: "giants-logo",
  ARI: "diamondbacks-logo",
  COL: "rockies-logo",
};

export function teamLogoEdge(teamId: MlbTeamId): SznEdgeId {
  return TEAM_LOGO_EDGE[teamId];
}

/** Teams grouped by division for picker layout. */
export function teamsByDivision(): Record<MlbDivision, MlbTeam[]> {
  const out: Record<MlbDivision, MlbTeam[]> = {
    "AL East": [],
    "AL Central": [],
    "AL West": [],
    "NL East": [],
    "NL Central": [],
    "NL West": [],
  };
  for (const t of Object.values(MLB_TEAMS) as MlbTeam[]) {
    out[t.division].push(t);
  }
  return out;
}
