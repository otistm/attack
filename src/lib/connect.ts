import { CardDefinition } from "./cards";
import type { MlbPlayer } from "./players";
import { isSznPlayer, type SznPlayer } from "./sznPlayers";
import { canSznSnap, type SznEdgeId } from "./sznEdges";
import { teamLogoEdge, type MlbTeamId } from "./sznTeams";
import { ShapeMode, ShapeType } from "../components/cardShapes";

/**
 * SZN Mode adapter: turn a player (legacy `MlbPlayer` OR new `SznPlayer`)
 * into a `CardDefinition`-shaped record so the existing `canConnect`
 * rules apply when items connect to the player at the plate. The player
 * carries no abilities or combineConstraints; only its left/right
 * sockets matter for chaining.
 *
 * `baseValue` defaults to 0 here; the real rarity value is applied at
 * hand seed time inside `freshAtBat` (SZN branch in `gameStore.ts`),
 * which looks up the player's `rarity` on the run roster and writes the
 * corresponding `RARITY_BASE_VALUE` onto the dealt card clone. Treat
 * this 0 as "unscored until seeded".
 *
 * For legacy `MlbPlayer`, the card uses the shape sockets and the
 * existing shape-based `canConnect` engine. For SZN `SznPlayer`, the
 * card stamps `sznLeftEdge` / `sznRightEdge` onto the CardDefinition so
 * the SZN-aware snap dispatch in `canSznConnect` can route through
 * `canSznSnap`. Shape sockets fall back to `wildcard` so legacy paths
 * that ignore the szn fields still produce a "matches anything" anchor
 * (this keeps the user-affirmed-seam UI sane while SZN edges are the
 * source of truth).
 */
/**
 * Optional per-roster overrides applied on top of the player's static
 * edges. Powers FO encounters that mutate edges (Wildcard Sticker,
 * Swing Adjuster, City Connect Jersey, etc.) without rewriting the
 * underlying `SznPlayer` def. Resolved here so combat-time consumers
 * (scoring, dispatcher) all see the same edges as the renderer.
 */
export interface PlayerCardOverrides {
  leftEdgeOverride?: SznEdgeId;
  rightEdgeOverride?: SznEdgeId;
  /**
   * Synthetic `team-logo` resolution context. When any override or
   * source edge is `team-logo`, we rewrite it to this team's franchise
   * logo edge. Passed in by `gameStore` callers that know the team.
   */
  teamLogoFor?: MlbTeamId;
}

/** Internal: turn synthetic `team-logo` into the holder's real logo. */
function resolveEdge(edge: SznEdgeId, teamLogoFor?: MlbTeamId): SznEdgeId {
  if (edge !== "team-logo" || !teamLogoFor) return edge;
  return teamLogoEdge(teamLogoFor);
}

export function playerAsCard(
  player: MlbPlayer | SznPlayer,
  overrides?: PlayerCardOverrides,
): CardDefinition {
  if (isSznPlayer(player)) {
    // Apply overrides ahead of the static edges. `team-logo` syntheticas
    // (set when an item stamped "the player's team logo" on an edge)
    // resolve into the actual franchise edge via the resolver above
    // so downstream consumers can compare ids directly.
    const rawLeft = overrides?.leftEdgeOverride ?? player.leftEdge;
    const rawRight = overrides?.rightEdgeOverride ?? player.rightEdge;
    const teamCtx = overrides?.teamLogoFor ?? player.teamId;
    const left = resolveEdge(rawLeft, teamCtx);
    const right = resolveEdge(rawRight, teamCtx);
    return {
      id: `player:${player.id}`,
      name: player.name,
      player: player.name,
      type: player.role === "Batter" ? "Batting" : "Pitching",
      abilityType: "Player",
      baseValue: 0,
      leftShape: "wildcard",
      rightShape: "wildcard",
      description: "",
      handedness: player.handedness,
      sznLeftEdge: left,
      sznRightEdge: right,
    };
  }
  return {
    id: `player:${player.id}`,
    name: player.name,
    player: player.name,
    type: player.role === "Batter" ? "Batting" : "Pitching",
    abilityType: "Player",
    baseValue: 0,
    leftShape: player.leftShape,
    rightShape: player.rightShape,
    description: "",
    handedness: player.handedness,
  };
}

/**
 * Convenience: can a card connect to either side of the player at the
 * plate? Returns `{ left, right }` booleans the UI can use to drive
 * drop-zone hints in SZN Mode. Routes through the SZN edge engine when
 * the player is a `SznPlayer`, otherwise the legacy shape engine.
 */
export function canConnectToPlayer(
  player: MlbPlayer | SznPlayer,
  itemCard: CardDefinition,
): { left: boolean; right: boolean } {
  const playerCard = playerAsCard(player);
  return {
    // Item sits to the LEFT of the player => itemCard's right meets player's left.
    left: canConnectAny(itemCard, playerCard),
    // Item sits to the RIGHT of the player => player's right meets item's left.
    right: canConnectAny(playerCard, itemCard),
  };
}

/**
 * SZN-aware connection check. When BOTH cards carry SZN edges (i.e. both
 * are SZN players or items decorated with edge data), defer to
 * `canSznSnap`. Otherwise fall back to the legacy shape engine. Items
 * without edges connecting to an SZN player succeed iff the player's
 * exposed edge is `wildcard` -- since `playerAsCard` stamps wildcard
 * shape sockets onto SZN players, the shape engine accepts these too
 * for legacy paths that haven't been migrated to the edge dispatch yet.
 */
export function canConnectAny(
  leftCard: CardDefinition,
  rightCard: CardDefinition,
): boolean {
  const lEdge = leftCard.sznRightEdge as SznEdgeId | undefined;
  const rEdge = rightCard.sznLeftEdge as SznEdgeId | undefined;
  if (lEdge && rEdge) {
    return canSznSnap(lEdge, rEdge);
  }
  return canConnect(leftCard, rightCard);
}

/**
 * Stable identifier for a seam between two cards, regardless of which side of
 * the seam each card is on. Used by the user-affirmed-connections set so a
 * seam between cards X and Y is the same key whether the order is X-Y or
 * Y-X (e.g. when the user drags one over the other and back).
 *
 * The key always sorts the two ids lexically so the call site doesn't have
 * to know who's left and who's right.
 */
export function seamKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/**
 * Determine whether the right side of `leftCard` can connect to the left side of `rightCard`.
 *
 * Rules (in evaluation order):
 *   1. Either side flagged `noCombine` -> never connect.
 *   2. The participating side flagged `*NoCombine` -> never connect (e.g. b-28 left).
 *   3. `none` shape on either participating side -> never connect.
 *   4. Either participating side is a wildcard (shape OR `*Wildcard` constraint) -> connect.
 *   5. If a card has `allowedShapes`, the OTHER side's shape must be in that list.
 *   6. Otherwise: shapes must match.
 */
export function canConnect(leftCard: CardDefinition, rightCard: CardDefinition): boolean {
  const lc = leftCard.combineConstraint;
  const rc = rightCard.combineConstraint;

  if (lc?.noCombine || rc?.noCombine) return false;
  if (lc?.rightNoCombine) return false;
  if (rc?.leftNoCombine) return false;

  const leftShape = leftCard.rightShape;
  const rightShape = rightCard.leftShape;

  if (leftShape === "none" || rightShape === "none") return false;

  const leftIsWild = leftShape === "wildcard" || lc?.rightWildcard === true;
  const rightIsWild = rightShape === "wildcard" || rc?.leftWildcard === true;

  if (leftIsWild || rightIsWild) {
    if (lc?.allowedShapes && !leftIsWild) {
      if (!isShapeAllowed(rightShape, lc.allowedShapes, rightIsWild)) return false;
    }
    if (rc?.allowedShapes && !rightIsWild) {
      if (!isShapeAllowed(leftShape, rc.allowedShapes, leftIsWild)) return false;
    }
    return true;
  }

  if (lc?.allowedShapes && !isShapeAllowed(rightShape, lc.allowedShapes, false)) return false;
  if (rc?.allowedShapes && !isShapeAllowed(leftShape, rc.allowedShapes, false)) return false;

  return leftShape === rightShape;
}

function isShapeAllowed(shape: ShapeType, allowed: ShapeType[], isWild: boolean): boolean {
  if (isWild) return true;
  return allowed.includes(shape);
}

/**
 * Resolve the visual mode for a single side of a card, given its connection
 * constraints. The UI uses this to render wildcard/blocked/picky indicators on
 * the matching edge so what the player SEES on the card matches the rule the
 * connection engine actually enforces.
 *
 *   - `noCombine`              -> both sides 'blocked'
 *   - `leftNoCombine`          -> left side 'blocked'
 *   - `rightNoCombine`         -> right side 'blocked'
 *   - `leftWildcard` (+ shape) -> left side 'wildcard' (renders emerald hexagon)
 *   - `rightWildcard`          -> right side 'wildcard'
 *   - shape === 'wildcard'     -> 'wildcard'
 *   - `allowedShapes` (with no wildcard/blocked override) -> 'picky'
 *   - otherwise                -> 'normal'
 */
export function shapeModeForSide(card: CardDefinition, side: 'left' | 'right'): ShapeMode {
  const c = card.combineConstraint;
  if (c?.noCombine) return 'blocked';
  if (side === 'left' && c?.leftNoCombine) return 'blocked';
  if (side === 'right' && c?.rightNoCombine) return 'blocked';
  if (side === 'left' && c?.leftWildcard) return 'wildcard';
  if (side === 'right' && c?.rightWildcard) return 'wildcard';
  const shape = side === 'left' ? card.leftShape : card.rightShape;
  if (shape === 'wildcard') return 'wildcard';
  if (c?.allowedShapes && c.allowedShapes.length > 0) return 'picky';
  return 'normal';
}
