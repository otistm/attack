/**
 * MLB team primary + secondary colors, used everywhere we render a player
 * nameplate (draft pool, draft dugouts, in-game matchup header, etc.) so a
 * given player wears the same team identity across screens.
 *
 * Hex values are sourced from each team's published brand guidelines / cap
 * colorways, picked for legibility on a dark UI (no near-blacks paired
 * against near-blacks). When a team isn't in the map we fall back to a
 * neutral slate gradient -- the UI never breaks for a future roster
 * expansion, it just renders without the team flavor.
 *
 * The shape (primary, secondary) is the minimum surface needed to draw a
 * gradient header band + a contrasting badge circle. Callers compose those
 * however they want -- this module is data, not presentation.
 */

export interface TeamPalette {
  primary: string;
  secondary: string;
}

export const TEAM_COLORS: Record<string, TeamPalette> = {
  NYY: { primary: '#003087', secondary: '#C4CED4' },
  LAD: { primary: '#005A9C', secondary: '#EF3E42' },
  HOU: { primary: '#EB6E1F', secondary: '#002D62' },
  ATL: { primary: '#CE1141', secondary: '#13274F' },
  NYM: { primary: '#002D72', secondary: '#FF5910' },
  BOS: { primary: '#BD3039', secondary: '#0C2340' },
  PHI: { primary: '#E81828', secondary: '#002D72' },
  CHC: { primary: '#0E3386', secondary: '#CC3433' },
  LAA: { primary: '#BA0021', secondary: '#003263' },
  TOR: { primary: '#134A8E', secondary: '#E8291C' },
  TEX: { primary: '#003278', secondary: '#C0111F' },
  DET: { primary: '#0C2C56', secondary: '#FA4616' },
  KCR: { primary: '#004687', secondary: '#BD9B60' },
  BAL: { primary: '#DF4601', secondary: '#000000' },
  CLE: { primary: '#E31937', secondary: '#0C2340' },
  CIN: { primary: '#C6011F', secondary: '#000000' },
  SDP: { primary: '#FFC425', secondary: '#2F241D' },
  SF: { primary: '#FD5A1E', secondary: '#000000' },
  PIT: { primary: '#FDB827', secondary: '#000000' },
  OAK: { primary: '#003831', secondary: '#EFB21E' },
  MIA: { primary: '#00A3E0', secondary: '#EF3340' },
  MIL: { primary: '#12284B', secondary: '#FFC52F' },
  SEA: { primary: '#0C2C56', secondary: '#005C5C' },
  TBR: { primary: '#092C5C', secondary: '#8FBCE6' },
  COL: { primary: '#33006F', secondary: '#C4CED4' },
  WSN: { primary: '#AB0003', secondary: '#14225A' },
  ARI: { primary: '#A71930', secondary: '#000000' },
  CHW: { primary: '#000000', secondary: '#C4CED4' },
  MIN: { primary: '#002B5C', secondary: '#D31145' },
  STL: { primary: '#C41E3A', secondary: '#0C2340' },
};

export const FALLBACK_TEAM: TeamPalette = {
  primary: '#475569',
  secondary: '#1e293b',
};

export function teamPalette(team: string): TeamPalette {
  return TEAM_COLORS[team] ?? FALLBACK_TEAM;
}
