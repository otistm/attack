/**
 * EncounterFocusPanel — focused-card detail readout for an encounter
 * view (Merchant, Player Market, etc.). Displays the full name +
 * value + subtitle + description + SZN edge readout for whichever
 * listing the user is currently focused on.
 *
 * Renders INLINE inside the encounter view's footer row (immediately
 * to the left of the Leave button). NOT a fixed-position overlay --
 * the previous implementation floated this above the encounter card
 * which cluttered the viewport and competed with the always-on HUD.
 *
 * Returns `null` when nothing is focused so the footer just shows
 * the Leave button on its own. Callers should wrap the panel in a
 * `flex-1 min-w-0` container so it can grow horizontally and ellipsis
 * its long lines without pushing the Leave button off the row.
 *
 * Variants
 * --------
 *   - `ability` (amber tint): a CardDefinition-shaped focused listing
 *     -- merchant items, encounter reward cards, bag chips.
 *   - `player`  (cyan tint) : a SznPlayer / RosterPlayer-shaped
 *     listing -- free-agent player market tiles, roster picker tiles.
 */

import { SZN_EDGES, type SznEdgeId } from "../lib/sznEdges";

export type EncounterFocusVariant = "ability" | "player";

export interface EncounterFocusCardData {
  /** Single-line title displayed in the panel header. */
  label: string;
  /** Optional one-line context line under the title. */
  subtitle?: string;
  /** Long-form description (ability text, player flavor, etc.). */
  description?: string;
  /**
   * Right-aligned readout next to the title. Numbers render as
   * "Score N" (mirroring the in-card value); strings render verbatim
   * so callers can pass "$4", "+5", "AURA", etc.
   */
  value?: number | string;
  /** Left snap edge for the chip strip. `null` to hide. */
  leftEdge?: SznEdgeId | null;
  /** Right snap edge for the chip strip. `null` to hide. */
  rightEdge?: SznEdgeId | null;
}

export interface EncounterFocusPanelProps {
  /** Focused-listing payload. `null` hides the panel entirely. */
  card: EncounterFocusCardData | null;
  variant: EncounterFocusVariant;
}

const VARIANT_TINT: Record<EncounterFocusVariant, string> = {
  ability: "#fbbf24", // amber for items
  player: "#22d3ee", // cyan for player market
};

/**
 * Defense-in-depth guard for the focused-card readout. Encounter
 * data sometimes flows through templated strings that include the
 * listing's price ("Drip Cleats ($4)", "Outfield Patch — $3", etc).
 * The price is already rendered as a chip directly under each card
 * tile, so surfacing it again inside the focused-card description
 * is the textbook duplication this panel was redesigned to avoid.
 *
 * This stripper runs at the LAST mile (right before render) so even
 * if a caller forgets the convention, the panel never paints a
 * duplicate price next to the card name. Matches:
 *   - "( $4 )" / "($4)" parenthetical price suffixes
 *   - "  -  $4" / " — $4" em-dash or hyphen + price tails
 *   - bare trailing "$4" tokens at the end of a line
 * Leaves inline dollar signs that aren't the textbook
 * "price tail" alone (so a legitimate "$2 off this week" stays).
 */
function stripPriceTail(s: string): string {
  return s
    .replace(/\s*\(\s*\$\d+(?:\.\d+)?\s*\)\s*$/u, "")
    .replace(/\s*[—\-–]\s*\$\d+(?:\.\d+)?\s*$/u, "")
    .replace(/\s+\$\d+(?:\.\d+)?\s*$/u, "")
    .trim();
}

export function EncounterFocusPanel({
  card,
  variant,
}: EncounterFocusPanelProps) {
  if (!card) return null;
  const ringColor = VARIANT_TINT[variant];
  const label = stripPriceTail(card.label);
  const subtitle = card.subtitle ? stripPriceTail(card.subtitle) : undefined;
  const description = card.description
    ? stripPriceTail(card.description)
    : undefined;
  return (
    <div
      // Inline footer panel. The parent provides flex sizing -- we
      // just fill the slot we're given and keep our own internal
      // padding/border consistent with the encounter's accent tint.
      className="flex w-full min-w-0 flex-col items-stretch gap-1 rounded-lg border bg-black/30 px-3 py-2 text-left text-white"
      style={{ borderColor: `${ringColor}66` }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="truncate text-sm font-black uppercase tracking-wide"
          style={{ color: ringColor }}
        >
          {label}
        </span>
        {card.value !== undefined && (
          <span className="flex-none text-[10px] font-bold uppercase tracking-widest text-white/60">
            {typeof card.value === "number" ? `Score ${card.value}` : card.value}
          </span>
        )}
      </div>
      {subtitle && (
        <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-white/60">
          {subtitle}
        </div>
      )}
      {description && (
        <div className="line-clamp-2 text-xs leading-snug text-white/85">
          {description}
        </div>
      )}
      {(card.leftEdge || card.rightEdge) && (
        // Same edge chips as the footer's `FocusedCardDetail` so the
        // visual language stays identical across inventory + encounter.
        <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/60">
          {card.leftEdge && (
            <span
              className="flex items-center gap-1 rounded px-1.5 py-0.5"
              style={{
                backgroundColor: `${SZN_EDGES[card.leftEdge].tint}33`,
                color: SZN_EDGES[card.leftEdge].tint,
              }}
            >
              <span aria-hidden>◀</span>
              {SZN_EDGES[card.leftEdge].label}
            </span>
          )}
          {card.rightEdge && (
            <span
              className="flex items-center gap-1 rounded px-1.5 py-0.5"
              style={{
                backgroundColor: `${SZN_EDGES[card.rightEdge].tint}33`,
                color: SZN_EDGES[card.rightEdge].tint,
              }}
            >
              {SZN_EDGES[card.rightEdge].label}
              <span aria-hidden>▶</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * @deprecated Renamed to `EncounterFocusPanel` -- the component now
 * renders inline inside the encounter footer instead of as a fixed
 * top-of-screen overlay. Kept as a re-export so any external imports
 * don't break, but new callers should use `EncounterFocusPanel`.
 */
export const EncounterFocusOverlay = EncounterFocusPanel;
