/**
 * SZN Mode semantic edge taxonomy.
 *
 * Replaces the shape-based snap system for SZN-mode players only. Quick
 * Match / Auction Draft cards continue to use the shape engine in
 * `connect.ts` / `cardShapes.ts`. SZN players carry `leftEdge` / `rightEdge`
 * (`SznEdgeId`); the snap rule in `canSznSnap` matches by id with two
 * specialty escape hatches:
 *
 *   - `wildcard` on either side matches anything (Cabrera's utility-man left).
 *   - `blank` never matches (Stanton/Weaver chain enders).
 *
 * Edge "family" controls color/grouping in UI (offensive / defensive /
 * positional / franchise / specialty) and is also how badge triggers and
 * scoring effects classify snaps without enumerating every edge id.
 */

export type SznEdgeFamily =
  | "offensive"
  | "defensive"
  | "positional"
  | "franchise"
  | "specialty";

export type SznEdgeId =
  // ----- Offensive (batter-side) -----
  | "power"
  | "speed"
  | "contact"
  | "patience"
  // ----- Defensive (pitcher-side) -----
  | "velocity"
  | "movement"
  | "control"
  | "deception"
  // ----- Positional -----
  | "infield"
  | "outfield"
  | "battery"
  | "lefty"
  | "righty"
  // ----- Franchise (per-team logos) -----
  | "yankees-logo"
  | "redsox-logo"
  | "bluejays-logo"
  | "orioles-logo"
  | "rays-logo"
  | "guardians-logo"
  | "tigers-logo"
  | "royals-logo"
  | "twins-logo"
  | "whitesox-logo"
  | "astros-logo"
  | "mariners-logo"
  | "rangers-logo"
  | "angels-logo"
  | "athletics-logo"
  | "braves-logo"
  | "mets-logo"
  | "phillies-logo"
  | "marlins-logo"
  | "nationals-logo"
  | "brewers-logo"
  | "cubs-logo"
  | "cardinals-logo"
  | "reds-logo"
  | "pirates-logo"
  | "dodgers-logo"
  | "padres-logo"
  | "giants-logo"
  | "diamondbacks-logo"
  | "rockies-logo"
  // ----- Franchise (division patches) -----
  | "al-east-patch"
  | "al-central-patch"
  | "al-west-patch"
  | "nl-east-patch"
  | "nl-central-patch"
  | "nl-west-patch"
  // ----- Specialty -----
  | "rookie"
  /** Distinct from Rarity.veteran -- this is the "veteran" specialty edge. */
  | "veteran-tag"
  | "wildcard"
  | "blank"
  // ----- Encounter-introduced edges (Phase 2 overhaul) -----
  /**
   * Special-edition uniform edge granted by the City Connect Jersey
   * encounter item. Snaps only to other `city-connect` edges, which
   * pushes the player into a single-edge mega-chain build.
   */
  | "city-connect"
  /**
   * Ultra-rare pitcher edge granted by the Velocity Program encounter.
   * Designed to snap into Battery (catcher right edge) for the spec's
   * "massive pitching score" payoff -- canSznSnap treats it as a
   * synonym for `velocity` AND `battery`.
   */
  | "fastball-102"
  /**
   * Synthetic "current team logo" sentinel. When an item or override
   * carries this edge, the snap resolver rewrites it to the holding
   * player's actual team-logo edge at snap time (see resolveEdge in
   * `connect.ts`). Lets edge-changing items like Franchise Journeyman
   * adapt to whichever franchise the user is playing as.
   */
  | "team-logo"
  /**
   * Mega-Card seam (Encounter #4). Only the left-half / right-half
   * encounter items carry this. `buildGroups` collapses two adjacent
   * mega-seam cards into a single 500-score hero card; nothing else
   * snaps to this edge.
   */
  | "mega-seam"
  /**
   * Defense Shield sentinel (Encounter #9 Platinum Glove). Snaps to
   * anything on the chain-outside edge but doesn't add score; carrying
   * this card on lock-in queues a defensive-shield consumption that
   * zeroes the opponent's next pitching total.
   */
  | "defense-shield";

export interface SznEdgeMeta {
  id: SznEdgeId;
  family: SznEdgeFamily;
  /** Short display label (e.g. "Power", "Yankees Logo"). */
  label: string;
  /** Tailwind-style color token used for tint chips / borders. */
  tint: string;
  /** One-line UI description. */
  blurb?: string;
}

const F = (
  id: SznEdgeId,
  family: SznEdgeFamily,
  label: string,
  tint: string,
  blurb?: string,
): SznEdgeMeta => ({ id, family, label, tint, blurb });

export const SZN_EDGES: Record<SznEdgeId, SznEdgeMeta> = {
  // Offensive
  power: F("power", "offensive", "Power", "#ef4444", "Anchor of the heart-of-the-order."),
  speed: F("speed", "offensive", "Speed", "#22d3ee", "Multiplies the next card in the chain."),
  contact: F("contact", "offensive", "Contact", "#10b981", "Keeps chains alive without breaking."),
  patience: F("patience", "offensive", "Patience", "#a3e635", "Eye for extending chains."),

  // Defensive
  velocity: F("velocity", "defensive", "Velocity", "#f97316", "Pure heat."),
  movement: F("movement", "defensive", "Movement", "#8b5cf6", "Debuffs the enemy batter."),
  control: F("control", "defensive", "Control", "#0ea5e9", "Flexible bridging for the staff."),
  deception: F("deception", "defensive", "Deception", "#d946ef", "25% chance to shatter the enemy's chain."),

  // Positional
  infield: F("infield", "positional", "Infield", "#facc15", "Dirt-dog positional bridge."),
  outfield: F("outfield", "positional", "Outfield", "#84cc16", "Range and arms."),
  battery: F("battery", "positional", "The Battery", "#fb923c", "Bridges your batter chain into your pitching chain."),
  lefty: F("lefty", "positional", "Lefty", "#60a5fa"),
  righty: F("righty", "positional", "Righty", "#fb7185"),

  // Franchise -- logos
  "yankees-logo": F("yankees-logo", "franchise", "Yankees Logo", "#0c1a4a"),
  "redsox-logo": F("redsox-logo", "franchise", "Red Sox Logo", "#bd3039"),
  "bluejays-logo": F("bluejays-logo", "franchise", "Blue Jays Logo", "#134a8e"),
  "orioles-logo": F("orioles-logo", "franchise", "Orioles Logo", "#df4601"),
  "rays-logo": F("rays-logo", "franchise", "Rays Logo", "#092c5c"),
  "guardians-logo": F("guardians-logo", "franchise", "Guardians Logo", "#00385d"),
  "tigers-logo": F("tigers-logo", "franchise", "Tigers Logo", "#0c2340"),
  "royals-logo": F("royals-logo", "franchise", "Royals Logo", "#004687"),
  "twins-logo": F("twins-logo", "franchise", "Twins Logo", "#002b5c"),
  "whitesox-logo": F("whitesox-logo", "franchise", "White Sox Logo", "#27251f"),
  "astros-logo": F("astros-logo", "franchise", "Astros Logo", "#002d62"),
  "mariners-logo": F("mariners-logo", "franchise", "Mariners Logo", "#0c2c56"),
  "rangers-logo": F("rangers-logo", "franchise", "Rangers Logo", "#003278"),
  "angels-logo": F("angels-logo", "franchise", "Angels Logo", "#ba0021"),
  "athletics-logo": F("athletics-logo", "franchise", "Athletics Logo", "#003831"),
  "braves-logo": F("braves-logo", "franchise", "Braves Logo", "#ce1141"),
  "mets-logo": F("mets-logo", "franchise", "Mets Logo", "#002d72"),
  "phillies-logo": F("phillies-logo", "franchise", "Phillies Logo", "#e81828"),
  "marlins-logo": F("marlins-logo", "franchise", "Marlins Logo", "#00a3e0"),
  "nationals-logo": F("nationals-logo", "franchise", "Nationals Logo", "#ab0003"),
  "brewers-logo": F("brewers-logo", "franchise", "Brewers Logo", "#0a2351"),
  "cubs-logo": F("cubs-logo", "franchise", "Cubs Logo", "#0e3386"),
  "cardinals-logo": F("cardinals-logo", "franchise", "Cardinals Logo", "#c41e3a"),
  "reds-logo": F("reds-logo", "franchise", "Reds Logo", "#c6011f"),
  "pirates-logo": F("pirates-logo", "franchise", "Pirates Logo", "#fdb827"),
  "dodgers-logo": F("dodgers-logo", "franchise", "Dodgers Logo", "#005a9c"),
  "padres-logo": F("padres-logo", "franchise", "Padres Logo", "#2f241d"),
  "giants-logo": F("giants-logo", "franchise", "Giants Logo", "#fd5a1e"),
  "diamondbacks-logo": F("diamondbacks-logo", "franchise", "Diamondbacks Logo", "#a71930"),
  "rockies-logo": F("rockies-logo", "franchise", "Rockies Logo", "#33006f"),

  // Franchise -- division patches
  "al-east-patch": F("al-east-patch", "franchise", "AL East Patch", "#1e3a8a"),
  "al-central-patch": F("al-central-patch", "franchise", "AL Central Patch", "#0f766e"),
  "al-west-patch": F("al-west-patch", "franchise", "AL West Patch", "#7c2d12"),
  "nl-east-patch": F("nl-east-patch", "franchise", "NL East Patch", "#9d174d"),
  "nl-central-patch": F("nl-central-patch", "franchise", "NL Central Patch", "#5b21b6"),
  "nl-west-patch": F("nl-west-patch", "franchise", "NL West Patch", "#92400e"),

  // Specialty
  rookie: F("rookie", "specialty", "Rookie", "#f43f5e", "High upside if chained correctly."),
  "veteran-tag": F("veteran-tag", "specialty", "Veteran", "#a16207", "Snap a Rookie to his left edge for a permanent stat boost."),
  wildcard: F("wildcard", "specialty", "Wildcard", "#10b981", "Snaps to absolutely anything."),
  blank: F("blank", "specialty", "Blank", "#1f2937", "Chain dead-ends here."),

  // Encounter-introduced
  "city-connect": F("city-connect", "specialty", "City Connect", "#0ea5e9", "Special-edition uniform that only snaps to other City Connect edges."),
  "fastball-102": F("fastball-102", "specialty", "102 MPH Fastball", "#dc2626", "Snaps to Battery for a massive pitching score."),
  "team-logo": F("team-logo", "franchise", "Team Logo", "#9ca3af", "Synthetic edge -- resolves to the holder's franchise logo at snap time."),
  "mega-seam": F("mega-seam", "specialty", "Mega Seam", "#f59e0b", "Half of a Mega-Card. Find both halves to merge into a 500-score hero card."),
  "defense-shield": F("defense-shield", "specialty", "Defense Shield", "#22d3ee", "Nullifies the opponent's next pitching score when this card locks in."),
};

/** Cheap predicate -- any of the 30 franchise logo edge ids. */
export function isLogoEdge(edge: SznEdgeId): boolean {
  return SZN_EDGES[edge]?.family === "franchise" && edge.endsWith("-logo");
}

/**
 * Can the right edge of one SZN card snap to the left edge of the next?
 *
 *   - `blank` on either participating side -> never connects (chain ender).
 *   - `mega-seam` -> ONLY connects to another `mega-seam` (no wildcard
 *     bypass, no franchise hop -- the merge has to be exact).
 *   - `wildcard` on either side -> connects (utility-man bridge).
 *   - `team-logo` synthetic -> matches any `*-logo` edge AND itself.
 *     The synthetic is meant to be resolved by `playerAsCard` before
 *     it ever reaches this function, but if it leaks through (e.g.
 *     on a generic item card) we keep the "matches any logo" semantic.
 *   - `fastball-102` -> synonym for both `velocity` AND `battery`, so
 *     it snaps into a Catcher's right edge or another velocity arm.
 *   - same id -> connects (semantic match).
 *   - otherwise -> no.
 */
export function canSznSnap(
  leftRightEdge: SznEdgeId,
  rightLeftEdge: SznEdgeId,
): boolean {
  if (leftRightEdge === "blank" || rightLeftEdge === "blank") return false;
  // Mega-seam must be exact -- a wildcard mid-chain would otherwise
  // bypass the "find both halves" puzzle.
  if (leftRightEdge === "mega-seam" || rightLeftEdge === "mega-seam") {
    return leftRightEdge === "mega-seam" && rightLeftEdge === "mega-seam";
  }
  if (leftRightEdge === "wildcard" || rightLeftEdge === "wildcard") return true;
  // Synthetic `team-logo`: matches any team logo edge (the resolver in
  // connect.ts will usually replace this with the real franchise logo
  // first; this branch keeps mismatched item-side syntheticas useful).
  if (leftRightEdge === "team-logo" && (isLogoEdge(rightLeftEdge) || rightLeftEdge === "team-logo")) return true;
  if (rightLeftEdge === "team-logo" && (isLogoEdge(leftRightEdge) || leftRightEdge === "team-logo")) return true;
  // 102 MPH Fastball -- synonym for velocity OR battery so the spec's
  // "snaps to a Catcher element for massive score" payoff fires.
  if (leftRightEdge === "fastball-102" && (rightLeftEdge === "velocity" || rightLeftEdge === "battery" || rightLeftEdge === "fastball-102")) return true;
  if (rightLeftEdge === "fastball-102" && (leftRightEdge === "velocity" || leftRightEdge === "battery" || leftRightEdge === "fastball-102")) return true;
  return leftRightEdge === rightLeftEdge;
}

/** Convenience: edge family lookup for badge / scoring classifiers. */
export function familyOf(edge: SznEdgeId): SznEdgeFamily {
  return SZN_EDGES[edge].family;
}

/** Convenience: short label for tooltips / chips. */
export function labelOf(edge: SznEdgeId): string {
  return SZN_EDGES[edge].label;
}

/** Convenience: tint color for chips / borders. */
export function tintOf(edge: SznEdgeId): string {
  return SZN_EDGES[edge].tint;
}
