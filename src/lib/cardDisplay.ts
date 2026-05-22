/**
 * cardDisplay — the single source of truth for *visual* card data
 * across SZN mode. Every card-shaped surface in the game (footer rail
 * chips, merchant listings, player market, encounter pickers, item
 * preview, combat hand, pack reveal) reads from this module so the
 * label, value, edge resolution, rarity treatment, and utility-tag
 * fallback are identical end-to-end.
 *
 * Background
 * ----------
 * Before this module existed there were three diverged copies of the
 * utility-tag table (`ItemCardPreview.UTILITY_TAGS`,
 * `FooterStyleAbilityCard.ABILITY_UTILITY_TAG`,
 * `SznFooterDecks.FOOTER_UTILITY_TAG`) — so the same zero-base
 * encounter item rendered as `SHIELD` in a hover preview, `DEF` in
 * the bag, and a literal `0` in combat. Two separate `valueFor…`
 * helpers existed (one for player chips, one for ability chips) and
 * three different rarity-label maps (one of which used the
 * mis-spelled `all-star` key against the run-state value `allstar`,
 * so subtitles silently rendered the raw enum). Player edge resolution
 * had two implementations (`PlayerCard` + `SznFooterDecks`) that
 * disagreed on whether to follow `team-logo` synthetic overrides.
 *
 * Consolidating all of that here keeps the audit fix one-edit-wide:
 * change the utility tag for `enc-rally-fire` once and every surface
 * in the game updates in lockstep.
 */

import type { CardDefinition } from "./cards";
import type { Rarity, RosterPlayer } from "./run";
import { RARITY_BASE_VALUE } from "./run";
import { SZN_EDGES, type SznEdgeId } from "./sznEdges";
import { teamLogoEdge, type MlbTeamId } from "./sznTeams";
import { isSznPlayer } from "./sznPlayers";
import type { ItemTier } from "./itemTiers";
import { TIER_GLYPH, TIER_LABEL, TIER_TINT } from "./itemTiers";

// ---------------------------------------------------------------------------
// Rarity helpers.
// ---------------------------------------------------------------------------

/**
 * Display label for each `Rarity` token. Used everywhere a rarity
 * tier needs to read as a human-friendly chip ("ALL STAR" vs the
 * raw enum value "allstar"). The previous footer-only copy keyed
 * the table by the dashed `all-star` slug, which silently fell
 * through to the raw `allstar` in subtitles.
 */
export const RARITY_LABEL: Record<Rarity, string> = {
  common: "COMMON",
  allstar: "ALL STAR",
  veteran: "VETERAN",
  legend: "LEGEND",
};

/** Soft Title-cased label for prose subtitles ("Yankees · OF · Common"). */
export const RARITY_TITLE: Record<Rarity, string> = {
  common: "Common",
  allstar: "All-Star",
  veteran: "Veteran",
  legend: "Legend",
};

/** Tailwind text-color class for the rarity badge on the player card. */
export const RARITY_TEXT: Record<Rarity, string> = {
  common: "text-orange-300",
  allstar: "text-slate-200",
  veteran: "text-amber-300",
  legend: "text-cyan-200",
};

/**
 * Body-gradient stops for the player card surface, KEYED BY RARITY.
 * The user explicitly asked for the player card body color to read
 * as rarity (bronze / silver / gold / cosmic) instead of as a team
 * tint -- the team is still legible via the team-code chip in the
 * top-left corner, but the dominant gradient is now a Bazaar-style
 * tier readout that scales the card's importance at a glance.
 *
 * Stops chosen to MATCH the existing `RARITY_TEXT` tints so the
 * rarity badge in the top-right reads as a brighter spotlight on
 * the same color the body already paints:
 *
 *   common  -> copper / orange   (low tier, warm + humble)
 *   allstar -> silver / slate    (mid tier, cool sheen)
 *   veteran -> gold / amber      (high tier, aged elegance)
 *   legend  -> cosmic cyan/teal  (top tier, electric standout)
 */
export const RARITY_GRADIENT: Record<Rarity, { primary: string; secondary: string }> = {
  common: { primary: "#7c2d12", secondary: "#ea580c" }, // orange-900 -> orange-600
  allstar: { primary: "#334155", secondary: "#94a3b8" }, // slate-700 -> slate-400
  veteran: { primary: "#854d0e", secondary: "#facc15" }, // yellow-900 -> yellow-400
  legend: { primary: "#155e75", secondary: "#22d3ee" }, // cyan-800  -> cyan-400
};

/**
 * Body-gradient stops keyed by `CardAbilityType`. Used by the SZN
 * unified card shell (`SznCard.bodyGradient`) to differentiate
 * ability / item / signature chips visually instead of painting
 * every non-player card with the same fixed blue. Player cards
 * still take their body color from {@link RARITY_GRADIENT} via the
 * roster slot, so `Player` here is unused at the shell level (kept
 * for completeness; if a non-roster Player card ever leaks through
 * we fall back to a generic blue).
 *
 * Color language matches the gameplay role:
 *   - General Draw (one-shot batting/pitching ability) -> indigo
 *   - Signature (a card's signature mechanic, e.g. b-6, p-44)   -> violet
 *   - EncounterItem (consumable utility from encounters)        -> teal
 *   - MegaHalf (linkable mega-card halves)                      -> fuchsia
 *   - Test (unit-test fixtures, never rendered live)            -> slate
 *
 * Surface-shared so the merchant chip, footer rail, and hover
 * preview all read the same.
 */
export const ABILITY_TYPE_GRADIENT: Record<
  string,
  { primary: string; secondary: string }
> = {
  "General Draw": { primary: "#312e81", secondary: "#6366f1" }, // indigo-900 -> indigo-500
  Signature: { primary: "#581c87", secondary: "#a855f7" }, // purple-900 -> purple-500
  EncounterItem: { primary: "#134e4a", secondary: "#2dd4bf" }, // teal-900 -> teal-400
  MegaHalf: { primary: "#701a75", secondary: "#e879f9" }, // fuchsia-900 -> fuchsia-400
  Test: { primary: "#1e293b", secondary: "#475569" }, // slate-800 -> slate-600
  Player: { primary: "#1e3a8a", secondary: "#3b82f6" }, // blue-900 -> blue-500 (fallback)
};

/**
 * Fallback gradient when an `abilityType` isn't in
 * {@link ABILITY_TYPE_GRADIENT}. Keeps the previous "fixed blue"
 * look so legacy callers don't regress.
 */
export const ABILITY_TYPE_FALLBACK_GRADIENT = {
  primary: "#1e3a8a", // blue-900
  secondary: "#3b82f6", // blue-500
};

/**
 * Body-gradient stops keyed by `ItemTier`. Layered ON TOP of the
 * ability-type body via `SznCard.bodyGradient` so a Silver Rally
 * Fire reads as "rally-fire teal with a metallic silver overlay"
 * instead of an ability-type teal that's visually identical at
 * every tier. Bronze stays neutral (no overlay, base color reads
 * through).
 *
 * Stops loosely mirror the {@link TIER_TINT} corner glyph color so
 * the body + glyph reinforce each other.
 */
export const TIER_BODY_GRADIENT: Record<
  ItemTier,
  { primary: string; secondary: string } | null
> = {
  bronze: null, // base ability-type gradient passes through.
  silver: { primary: "rgba(203,213,225,0.45)", secondary: "rgba(241,245,249,0.15)" },
  gold: { primary: "rgba(251,191,36,0.55)", secondary: "rgba(252,211,77,0.2)" },
};

/**
 * Resolve the body gradient for any ability / item card. Centralized
 * here (instead of inline in `SznCard.bodyGradient`) so the footer
 * rail's duplicate gradient logic can import the same helper and
 * stay in lock-step.
 *
 * Returns either:
 *   - the ability-type gradient (modulated by `itemTier` overlay
 *     when the card is a tiered item), OR
 *   - the legacy blue fallback if `abilityType` is unknown.
 */
export function abilityCardGradient(
  abilityType: string | undefined | null,
  itemTier?: ItemTier | null,
): { primary: string; secondary: string; overlay: { primary: string; secondary: string } | null } {
  const base = abilityType
    ? ABILITY_TYPE_GRADIENT[abilityType] ?? ABILITY_TYPE_FALLBACK_GRADIENT
    : ABILITY_TYPE_FALLBACK_GRADIENT;
  const overlay = itemTier ? TIER_BODY_GRADIENT[itemTier] : null;
  return { primary: base.primary, secondary: base.secondary, overlay };
}

/**
 * Convert the run-state rarity enum to a display label. Single
 * helper so a future rename (e.g. "allstar" → "all-star") only has
 * to update this module.
 */
export function rarityLabel(rarity: Rarity): string {
  return RARITY_LABEL[rarity];
}

export function rarityTitle(rarity: Rarity): string {
  return RARITY_TITLE[rarity];
}

// ---------------------------------------------------------------------------
// Utility-tag table for zero-base encounter items.
// ---------------------------------------------------------------------------

/**
 * Three-letter (or short word) label printed where the big numeric
 * value normally lives on a card whose `baseValue` is 0 and whose
 * `abilityType` is `EncounterItem`. Without this table the card
 * reads "0", which is wrong — these items DO things, the value just
 * isn't expressed as a chain-score number.
 *
 * Standardized on the SHORT 3-4 letter form previously used by the
 * footer rail (DEF / CPY / INTL) so the chip footprint stays single-
 * line at 1rem font-size and the legible-from-the-couch
 * footer rail and the hover-distance ItemCardPreview render the
 * same string.
 */
export const ENCOUNTER_UTILITY_TAGS: Record<string, string> = {
  "enc-sticky-stuff": "SNAP",
  "enc-rally-fire": "AURA",
  "enc-platinum-glove": "DEF",
  "enc-classic-spikes": "CPY",
  "enc-the-torch": "CPY",
  "enc-duct-tape": "SNAP",
  "enc-faded-scouting-report": "INTL",
  "enc-mega-left": "MEGA",
  "enc-mega-right": "MEGA",
};

/**
 * What number / tag to show in the big body slot of a card. Returns
 * the raw `baseValue` for normal cards; returns the utility tag for
 * zero-base EncounterItems; returns "—" for unknown utility items so
 * the surface never goes blank.
 */
export function displayValueFor(card: CardDefinition | undefined): number | string {
  if (!card) return 0;
  if (card.baseValue === 0 && card.abilityType === "EncounterItem") {
    return ENCOUNTER_UTILITY_TAGS[card.id] ?? "—";
  }
  return card.baseValue;
}

/** True when the value should render as a short text tag (1rem) instead of a big numeric. */
export function isUtilityValue(value: number | string): value is string {
  return typeof value === "string";
}

/**
 * One-line "what does this jargon actually mean?" hints, surfaced in
 * the `useAbilityHover` tooltip body so first-time players don't have
 * to bounce out to a separate glossary screen to learn that "AURA"
 * means "boosts adjacent cards" or that "Signature" means a card is
 * locked to one player.
 *
 * Two tables: one keyed by `card.abilityType` (the broad slot the
 * card lives in -- Signature, General Draw, EncounterItem, etc.) and
 * one keyed by the SZN encounter-item utility tag (`AURA`, `CPY`,
 * `DEF`, `INTL`, `SNAP`, `MEGA`). The tooltip prefers the utility-tag
 * hint when present (more specific), and falls back to the
 * ability-type hint otherwise. Either can be `undefined`, in which
 * case the tooltip simply skips the hint row.
 */
export const ABILITY_TYPE_HINT: Record<string, string> = {
  Signature: "Player-locked ability — only fires when that player is at the plate.",
  "General Draw": "Roster-wide ability — eligible to fire for any matching player.",
  EncounterItem: "Bag item bought from an encounter. Effect fires from the bag.",
  MegaHalf: "Replaces one edge half. Snap-eligible at the new edge.",
  Player: "The player at bat. Anchored — can't be recalled or replaced mid at-bat.",
};

export const UTILITY_TAG_HINT: Record<string, string> = {
  AURA: "Aura — boosts cards adjacent to this one in the chain.",
  CPY: "Copy — duplicates an adjacent card's effect onto this slot.",
  DEF: "Defense — reduces incoming pitcher debuffs on this lane.",
  INTL: "Intel — peek at hidden state (pitch type, ghost roster, etc.).",
  SNAP: "Snap — locks an edge match so the chain can't break at this seam.",
  MEGA: "Mega Half — replaces one edge half and counts as a stronger snap target.",
};

/**
 * Look up the best one-line hint for a card. Prefers the utility-tag
 * hint (more specific) and falls back to the ability-type hint, so a
 * Rally Fire bag item paints "AURA — boosts adjacent" rather than the
 * generic "EncounterItem — bag item bought from an encounter."
 *
 * Returns `null` when neither table has a row -- callers should skip
 * rendering the hint line in that case rather than printing an empty
 * row.
 */
export function abilityHintFor(card: {
  id?: string;
  abilityType?: string | null;
}): string | null {
  const tag = card.id ? ENCOUNTER_UTILITY_TAGS[card.id] : undefined;
  if (tag && UTILITY_TAG_HINT[tag]) return UTILITY_TAG_HINT[tag];
  if (card.abilityType && ABILITY_TYPE_HINT[card.abilityType]) {
    return ABILITY_TYPE_HINT[card.abilityType];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Player score readout.
// ---------------------------------------------------------------------------

/**
 * What number to print on a player card. Stacks rarity floor +
 * permanent boosts + encounter score overrides. Single helper so
 * the merchant / market / footer / combat / hero all agree on
 * "what does this player score?".
 */
export function playerDisplayValue(rp: RosterPlayer): number {
  return (
    RARITY_BASE_VALUE[rp.rarity] +
    (rp.permanentBoost ?? 0) +
    (rp.scoreOverride ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Edge resolution.
// ---------------------------------------------------------------------------

/**
 * Resolve a raw `SznEdgeId` slot value to the edge the user should
 * see. Handles the `team-logo` synthetic (replaces it with the
 * franchise logo for the holder's team) and drops anything not in
 * the `SZN_EDGES` registry so the renderer never gets a dangling id.
 */
function resolveEdgeId(
  raw: SznEdgeId | null | undefined,
  teamId: MlbTeamId | null | undefined,
): SznEdgeId | null {
  if (!raw) return null;
  if (raw === "team-logo") {
    if (!teamId) return null;
    const synth = teamLogoEdge(teamId);
    return SZN_EDGES[synth] ? synth : null;
  }
  return SZN_EDGES[raw] ? raw : null;
}

/**
 * Resolve the left/right semantic edges for a roster player slot.
 * Encounter `leftEdgeOverride` / `rightEdgeOverride` take precedence
 * over the static SznPlayer edges so a stamped sticker reads on the
 * card; team-logo synthetics resolve through `teamLogoEdge`.
 *
 * Returns `(null, null)` for legacy `MlbPlayer` players so the
 * caller can fall back to the `ShapeHalf` connector.
 */
export function resolvePlayerEdges(rp: RosterPlayer): {
  leftEdge: SznEdgeId | null;
  rightEdge: SznEdgeId | null;
} {
  if (!isSznPlayer(rp.player)) {
    return { leftEdge: null, rightEdge: null };
  }
  const teamId = rp.player.teamId as MlbTeamId;
  const leftRaw = (rp.leftEdgeOverride ?? rp.player.leftEdge) as SznEdgeId | null;
  const rightRaw = (rp.rightEdgeOverride ?? rp.player.rightEdge) as SznEdgeId | null;
  return {
    leftEdge: resolveEdgeId(leftRaw, teamId),
    rightEdge: resolveEdgeId(rightRaw, teamId),
  };
}

/**
 * Resolve the left/right semantic edges directly off a `CardDefinition`
 * (used by item / ability cards that aren't backed by a roster slot).
 * No team-logo handling — items never carry a synthetic team edge.
 */
export function resolveCardEdges(card: CardDefinition): {
  leftEdge: SznEdgeId | null;
  rightEdge: SznEdgeId | null;
} {
  const leftRaw = (card.sznLeftEdge ?? null) as SznEdgeId | null;
  const rightRaw = (card.sznRightEdge ?? null) as SznEdgeId | null;
  return {
    leftEdge: resolveEdgeId(leftRaw, null),
    rightEdge: resolveEdgeId(rightRaw, null),
  };
}

/**
 * Resolve the left/right semantic edges for an SZN player that
 * isn't yet on a roster (free-agency listings, scouting reports,
 * any place where we have the raw `SznPlayer` def without a
 * `RosterPlayer` wrapper). Honors the `team-logo` synthetic the
 * same way `resolvePlayerEdges` does, so a free-agent Yankee with
 * a `team-logo` left edge reads as `yankees-logo` even before the
 * sign happens.
 */
export function resolveSznPlayerEdges(player: {
  teamId: MlbTeamId;
  leftEdge: SznEdgeId | null;
  rightEdge: SznEdgeId | null;
}): { leftEdge: SznEdgeId | null; rightEdge: SznEdgeId | null } {
  return {
    leftEdge: resolveEdgeId(player.leftEdge, player.teamId),
    rightEdge: resolveEdgeId(player.rightEdge, player.teamId),
  };
}

// ---------------------------------------------------------------------------
// Tier display helpers (re-export to keep cardDisplay a one-stop shop).
// ---------------------------------------------------------------------------

export { TIER_GLYPH, TIER_LABEL, TIER_TINT };
export type { ItemTier };

// ---------------------------------------------------------------------------
// Roster subtitle (e.g. "Yankees · OF · Common").
// ---------------------------------------------------------------------------

import { MLB_TEAMS } from "./sznTeams";

/**
 * One-line subtitle for a roster player. Used in the focused-card
 * detail panel + any picker preview. Centralized so a future change
 * (e.g. show position as an emoji) only edits this module.
 */
export function rosterSubtitle(rp: RosterPlayer): string {
  const parts: string[] = [];
  if (isSznPlayer(rp.player)) {
    const team = MLB_TEAMS[rp.player.teamId];
    if (team) parts.push(team.shortName);
    if (rp.player.position) parts.push(rp.player.position);
  } else {
    parts.push(rp.player.role);
  }
  parts.push(rarityTitle(rp.rarity));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Shared visual tokens.
// ---------------------------------------------------------------------------

/**
 * Canonical size table for the unified `<SznCard>` shell. Every
 * card-shaped surface in SZN mode picks one of these sizes; the
 * actual pixel dimensions, border radius, font scale, and padding
 * stay locked across surfaces so the user reads the same visual
 * grammar everywhere.
 *
 * "chip"     — 96×136, footer rail / merchant / market / pickers
 * "compact"  — 96×128 (slightly shorter), tight grids
 * "standard" — 128×176, the canonical 5:7 playable card
 * "large"    — 176×240, pack reveal hero
 */
export const SZN_CARD_SIZES = {
  chip: {
    widthPx: 96,
    heightPx: 136,
    radiusClass: "rounded-lg",
    nameTextClass: "text-[9px]",
    teamTextClass: "text-[8px]",
    valueFontSize: "2.5rem",
    utilityFontSize: "1rem",
    badgeTextClass: "text-[8px]",
    padClass: "px-2",
  },
  compact: {
    widthPx: 96,
    heightPx: 128,
    radiusClass: "rounded-lg",
    nameTextClass: "text-[8px]",
    teamTextClass: "text-[7px]",
    valueFontSize: "2.25rem",
    utilityFontSize: "0.875rem",
    badgeTextClass: "text-[7px]",
    padClass: "px-1.5",
  },
  standard: {
    widthPx: 128,
    heightPx: 176,
    radiusClass: "rounded-xl",
    nameTextClass: "text-[10px]",
    teamTextClass: "text-[8px]",
    valueFontSize: "3rem",
    utilityFontSize: "1.125rem",
    badgeTextClass: "text-[8px]",
    padClass: "px-2",
  },
  large: {
    widthPx: 176,
    heightPx: 240,
    radiusClass: "rounded-xl",
    nameTextClass: "text-xs",
    teamTextClass: "text-[10px]",
    valueFontSize: "3.75rem",
    utilityFontSize: "1.5rem",
    badgeTextClass: "text-[10px]",
    padClass: "px-2.5",
  },
} as const;

export type SznCardSize = keyof typeof SZN_CARD_SIZES;

/**
 * Focus / state styling tokens shared across the unified card
 * shell. Standardized so the focus ring color, lift distance, and
 * disabled appearance is identical on every surface — no more
 * "the merchant lift is different from the footer lift" drift.
 */
export const SZN_CARD_STATE = {
  default: {
    borderColor: "rgba(255,255,255,0.85)",
    boxShadow: "0 6px 16px rgba(0,0,0,0.5)",
    transformClass: "",
  },
  focused: {
    borderColor: "#fbbf24", // amber-400
    boxShadow: "0 10px 18px rgba(251,191,36,0.45)",
    transformClass: "-translate-y-1",
  },
  selected: {
    borderColor: "#fbbf24",
    boxShadow: "0 0 18px rgba(251,191,36,0.55)",
    transformClass: "",
  },
  connected: {
    borderColor: "#7dd3fc", // sky-300
    boxShadow: "0 6px 18px rgba(125,211,252,0.5)",
    transformClass: "",
  },
  disabled: {
    borderColor: "rgba(255,255,255,0.25)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
    transformClass: "",
  },
  sell: {
    borderColor: "#f87171", // rose-400
    boxShadow: "0 0 18px rgba(248,113,113,0.55)",
    transformClass: "",
  },
} as const;

export type SznCardState = keyof typeof SZN_CARD_STATE;
