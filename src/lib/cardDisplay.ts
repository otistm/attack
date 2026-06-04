/**
 * Visual tokens for element brawl card surfaces.
 */
import type { CardDefinition } from "./cards";
import { printedNumericValue } from "./cardModel";

export function displayValueFor(card: CardDefinition | undefined): number {
  if (!card) return 0;
  return printedNumericValue(card);
}

export function cardHeaderClassName(compact: boolean, onColoredBody = false): string {
  const pad = compact ? "px-1.5 py-1" : "px-2 py-1.5";
  const surface = onColoredBody
    ? "bg-black/30 border-white/25"
    : "bg-white border-slate-200";
  return `${pad} border-b ${surface}`;
}

export function cardHeaderPlayerClassName(compact: boolean, onColoredBody = false): string {
  const color = onColoredBody ? "text-white/85" : "text-slate-500";
  return compact
    ? `text-[8px] font-extrabold uppercase tracking-widest leading-none truncate ${color}`
    : `text-[10px] font-extrabold uppercase tracking-widest leading-none truncate ${color}`;
}

export function cardHeaderNameClassName(compact: boolean, onColoredBody = false): string {
  const color = onColoredBody ? "text-white" : "text-slate-800";
  return compact
    ? `text-[10px] font-black uppercase tracking-wide leading-tight truncate ${color}`
    : `text-xs font-black uppercase tracking-wide leading-tight truncate ${color}`;
}

export function abilityFooterClassName(compact: boolean): string {
  return compact ? "px-1.5 py-1" : "px-2 py-1.5";
}

/** Brawl value-card ability strip — pinned to card bottom, clear of center value. */
export function cardBrawlFooterClassName(
  compact: boolean,
  onColoredBody = false,
): string {
  const pad = abilityFooterClassName(compact);
  const surface = onColoredBody
    ? "bg-black/35 border-white/25"
    : "bg-white/95 border-slate-200";
  return `${pad} border-t ${surface}`;
}

/** Centers the printed value on the card face (header/footer are absolute). */
export function cardCenterValueClass(): string {
  return "absolute inset-0 z-20 flex items-center justify-center text-center leading-none pointer-events-none";
}

export const PLAY_CARD = {
  widthPx: 200,
  heightPx: 176,
  compactWidthPx: 125,
  compactHeightPx: 112,
  cardClass: "w-[200px] h-[176px] rounded-xl",
  compactCardClass: "w-[125px] h-[112px] rounded-lg",
} as const;
