/**
 * Card model v2: value cards (numbers only) vs ability cards (text + effects).
 * Each shape has a dedicated edge color; colors are derived from shape, not randomized separately.
 */
import type { CardDefinition } from "./cards";
import type { ShapeType } from "../components/cardShapes";

export type CardKind = "value" | "ability";

export type EdgeColor =
  | "red"
  | "yellow"
  | "blue"
  | "purple"
  | "emerald"
  | "wildcard"
  | "none";

export const EDGE_COLORS: Record<EdgeColor, string> = {
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
  purple: "#a855f7",
  emerald: "#10b981",
  wildcard: "#10b981",
  none: "transparent",
};

export const EDGE_COLOR_LABEL: Record<EdgeColor, string> = {
  red: "Red",
  yellow: "Yellow",
  blue: "Blue",
  purple: "Purple",
  emerald: "Emerald",
  wildcard: "Wildcard",
  none: "None",
};

export const RANDOMIZABLE_COLORS: EdgeColor[] = ["red", "yellow", "blue", "purple"];

/** Dedicated palette: each geometric shape maps to one edge color. */
export function shapeToDefaultColor(shape: ShapeType): EdgeColor {
  switch (shape) {
    case "square":
      return "red";
    case "diamond":
      return "yellow";
    case "circle":
      return "blue";
    case "star":
      return "purple";
    case "wildcard":
      return "emerald";
    default:
      return "none";
  }
}

/** Cards removed from live play — debuff opponent per-card values. */
export const RETIRED_CARD_IDS = new Set([
  "b-2",   // Judge's Chamber: -2 opponent highest
  "b-17",  // Line Drive: -2 per combined pitcher card
  "b-21",  // The Pandemonium: destroy opponent general
  "b-23",  // Stolen Base Threat: nullify opponent generals
  "b-30",  // Laser Show: halve opponent base card
  "b-119", // Quick Bat: -2 all pitcher generals
  "p-42",  // Paint the Corners: cap opponent base at 6
  "p-52",  // Sweeper: -3 opponent base card
  "p-99",  // Ace Anchor: -4 opponent base when chained
]);

export function isRetiredCard(id: string): boolean {
  return RETIRED_CARD_IDS.has(id);
}

/** Printed numeric value before ability cards were zeroed (balance bridge). */
export const LEGACY_PRINTED_VALUE: Record<string, number> = {};

export function inferCardKind(card: Pick<CardDefinition, "kind" | "abilityType" | "id" | "baseValue">): CardKind {
  if (card.kind) return card.kind;
  if (card.abilityType === "General Draw") {
    if (card.baseValue <= 0) return "ability";
    return "value";
  }
  if (card.abilityType === "Player") return "value";
  return "ability";
}

export function isValueCard(card: Pick<CardDefinition, "kind" | "abilityType" | "id" | "baseValue">): boolean {
  return inferCardKind(card) === "value";
}

export function isAbilityCard(card: Pick<CardDefinition, "kind" | "abilityType" | "id" | "baseValue">): boolean {
  return inferCardKind(card) === "ability";
}

export function printedNumericValue(card: CardDefinition): number {
  if (isValueCard(card)) return card.baseValue;
  return LEGACY_PRINTED_VALUE[card.id] ?? 0;
}

export function truncateFaceText(text: string, maxLen = 72): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export function abilityFaceText(card: CardDefinition): string {
  return (
    card.faceText ??
    card.brawlTagline ??
    truncateFaceText(card.description)
  );
}

/**
 * Normalize a legacy catalog entry into the v2 model. Captures pre-zero
 * baseValue into LEGACY_PRINTED_VALUE for ability cards so effects that
 * referenced printed numbers stay balanced.
 */
export function normalizeCardDefinition(card: CardDefinition): CardDefinition {
  const kind = inferCardKind(card);
  const leftColor = shapeToDefaultColor(card.leftShape);
  const rightColor = shapeToDefaultColor(card.rightShape);

  if (kind === "ability") {
    if (card.baseValue > 0 && LEGACY_PRINTED_VALUE[card.id] === undefined) {
      LEGACY_PRINTED_VALUE[card.id] = card.baseValue;
    }
    return {
      ...card,
      kind,
      leftColor,
      rightColor,
      baseValue: 0,
      faceText: card.faceText ?? card.brawlTagline ?? truncateFaceText(card.description),
    };
  }

  return {
    ...card,
    kind,
    leftColor,
    rightColor,
  };
}

export function normalizeCardCatalog(cards: readonly CardDefinition[]): CardDefinition[] {
  return cards.map(normalizeCardDefinition);
}

export function isRandomizableColor(c: EdgeColor): boolean {
  return c !== "none" && c !== "wildcard" && c !== "emerald";
}

export function validateCardDefinition(card: CardDefinition): string[] {
  const errors: string[] = [];
  const kind = inferCardKind(card);

  if (kind === "value") {
    if (card.baseValue <= 0 && card.abilityType !== "Player") {
      errors.push(`${card.id}: value card must have baseValue > 0`);
    }
    if (card.faceText) {
      errors.push(`${card.id}: value card must not have faceText`);
    }
  } else {
    if (card.baseValue !== 0) {
      errors.push(`${card.id}: ability card must have baseValue === 0`);
    }
    if (!card.description?.trim() && card.abilityType !== "Player") {
      errors.push(`${card.id}: ability card needs description`);
    }
  }

  if (!card.leftColor || !card.rightColor) {
    errors.push(`${card.id}: missing edge colors`);
  }

  return errors;
}

export function validateCardCatalog(cards: readonly CardDefinition[]): string[] {
  return cards.flatMap(validateCardDefinition);
}
