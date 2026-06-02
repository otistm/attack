import type { ShapeType } from "../components/cardShapes";
import {
  type CardKind,
  type EdgeColor,
  abilityFaceText,
  isAbilityCard,
  isValueCard,
  printedNumericValue,
  shapeToDefaultColor,
} from "./cardModel";

export type CardType = "Player" | "Opponent";
export type CardAbilityType = string;
export type Handedness = "L" | "R" | "S";

export type { CardKind, EdgeColor } from "./cardModel";
export {
  EDGE_COLORS,
  EDGE_COLOR_LABEL,
  isValueCard,
  isAbilityCard,
  abilityFaceText,
  printedNumericValue,
  isRetiredCard,
  RETIRED_CARD_IDS,
} from "./cardModel";

export interface CombineConstraint {
  allowedShapes?: ShapeType[];
  allowedColors?: EdgeColor[];
  noCombine?: boolean;
  leftNoCombine?: boolean;
  rightNoCombine?: boolean;
  leftWildcard?: boolean;
  rightWildcard?: boolean;
  leftColorWildcard?: boolean;
  rightColorWildcard?: boolean;
  requireChainLength?: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  player?: string;
  type: CardType;
  abilityType: CardAbilityType;
  baseValue: number;
  kind?: CardKind;
  leftShape: ShapeType;
  rightShape: ShapeType;
  leftColor?: EdgeColor;
  rightColor?: EdgeColor;
  description: string;
  faceText?: string;
  brawlTagline?: string;
  color?: string;
  tags?: string[];
  handedness?: Handedness;
  combineConstraint?: CombineConstraint;
  disabled?: boolean;
}

/** Legacy alias — element cards still use Batting in a few call sites. */
export function normalizeCardDefinition(card: CardDefinition): CardDefinition {
  const leftColor = card.leftColor ?? shapeToDefaultColor(card.leftShape);
  const rightColor = card.rightColor ?? shapeToDefaultColor(card.rightShape);
  const kind = card.kind ?? (card.abilityType === "General Draw" ? "value" : "ability");
  return { ...card, leftColor, rightColor, kind };
}
