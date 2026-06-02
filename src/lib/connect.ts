import { CardDefinition, EdgeColor } from "./cards";
import { shapeToDefaultColor } from "./cardModel";
import { ShapeMode, ShapeType } from "../components/cardShapes";

export type ColorMode = "normal" | "wildcard" | "blocked" | "picky";

function edgeColor(card: CardDefinition, side: "left" | "right"): EdgeColor {
  const shape = side === "left" ? card.leftShape : card.rightShape;
  return shapeToDefaultColor(shape);
}

export function edgeColorForSide(
  card: CardDefinition,
  side: "left" | "right",
): EdgeColor {
  if (side === "left") {
    return card.leftColor ?? shapeToDefaultColor(card.leftShape);
  }
  return card.rightColor ?? shapeToDefaultColor(card.rightShape);
}

export function seamKey(leftId: string, rightId: string): string {
  return `${leftId}|${rightId}`;
}

function sideShape(card: CardDefinition, side: "left" | "right"): ShapeType {
  return side === "left" ? card.leftShape : card.rightShape;
}

function sideConstraint(card: CardDefinition, side: "left" | "right") {
  const c = card.combineConstraint;
  if (!c) return null;
  if (side === "left" && c.leftNoCombine) return { blocked: true as const };
  if (side === "right" && c.rightNoCombine) return { blocked: true as const };
  return c;
}

function shapesMatch(
  leftShape: ShapeType,
  rightShape: ShapeType,
  leftWildcard?: boolean,
  rightWildcard?: boolean,
): boolean {
  if (leftWildcard || rightWildcard) return true;
  if (leftShape === "wildcard" || rightShape === "wildcard") return true;
  if (leftShape === "none" || rightShape === "none") return false;
  return leftShape === rightShape;
}

function colorsMatch(
  left: EdgeColor,
  right: EdgeColor,
  leftWildcard?: boolean,
  rightWildcard?: boolean,
): boolean {
  if (leftWildcard || rightWildcard) return true;
  if (left === "wildcard" || right === "wildcard") return true;
  if (left === "none" || right === "none") return false;
  return left === right;
}

export function canConnect(
  leftCard: CardDefinition,
  rightCard: CardDefinition,
): boolean {
  const leftC = sideConstraint(leftCard, "right");
  const rightC = sideConstraint(rightCard, "left");
  if (leftC && "blocked" in leftC && leftC.blocked) return false;
  if (rightC && "blocked" in rightC && rightC.blocked) return false;
  if (leftCard.combineConstraint?.noCombine || rightCard.combineConstraint?.noCombine) {
    return false;
  }

  const leftShape = sideShape(leftCard, "right");
  const rightShape = sideShape(rightCard, "left");
  const leftColor = edgeColor(leftCard, "right");
  const rightColor = edgeColor(rightCard, "left");

  const shapeOk = shapesMatch(
    leftShape,
    rightShape,
    leftCard.combineConstraint?.rightWildcard,
    rightCard.combineConstraint?.leftWildcard,
  );
  const colorOk = colorsMatch(
    leftColor,
    rightColor,
    leftCard.combineConstraint?.rightColorWildcard,
    rightCard.combineConstraint?.leftColorWildcard,
  );

  if (!shapeOk || !colorOk) return false;

  const allowedOnLeft = leftCard.combineConstraint?.allowedShapes;
  if (allowedOnLeft && !allowedOnLeft.includes(rightShape) && rightShape !== "wildcard") {
    return false;
  }
  const allowedOnRight = rightCard.combineConstraint?.allowedShapes;
  if (allowedOnRight && !allowedOnRight.includes(leftShape) && leftShape !== "wildcard") {
    return false;
  }

  return true;
}

export function canConnectAny(
  leftCard: CardDefinition,
  rightCard: CardDefinition,
): boolean {
  return canConnect(leftCard, rightCard);
}

export function shapeModeForSide(
  card: CardDefinition,
  side: "left" | "right",
): ShapeMode {
  const c = sideConstraint(card, side);
  if (c && "blocked" in c && c.blocked) return "blocked";
  const wildcard =
    side === "left"
      ? card.combineConstraint?.leftWildcard
      : card.combineConstraint?.rightWildcard;
  if (wildcard) return "wildcard";
  const allowed = card.combineConstraint?.allowedShapes;
  if (allowed && allowed.length > 0) return "picky";
  return "normal";
}

export function colorModeForSide(
  card: CardDefinition,
  side: "left" | "right",
): ColorMode {
  const c = sideConstraint(card, side);
  if (c && "blocked" in c && c.blocked) return "blocked";
  const wildcard =
    side === "left"
      ? card.combineConstraint?.leftColorWildcard
      : card.combineConstraint?.rightColorWildcard;
  if (wildcard) return "wildcard";
  return "normal";
}
