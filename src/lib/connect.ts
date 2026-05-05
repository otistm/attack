import { CardDefinition } from "./cards";
import { ShapeMode, ShapeType } from "../components/cardShapes";

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
