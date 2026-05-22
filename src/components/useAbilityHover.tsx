/**
 * Hover/focus tooltip primitives shared across encounter surfaces.
 *
 * Two hooks live here:
 *
 *   useAbilityHover(card)   - card-ability tooltip (item chips,
 *                             ItemCardPreview, in-combat ability
 *                             hover). Body = card.description.
 *   useChoiceHover(choice)  - event-choice tooltip (Yard Sale et al.).
 *                             Body = choice.resultBlurb. Used by
 *                             EventEncounterView's ChoiceCard so an
 *                             event choice's description surfaces as
 *                             an overlay above the tile rather than
 *                             in a separate footer panel.
 *
 * Both hooks share the same anchor/open machinery (`useHoverAnchor`)
 * and the same slate-800 portal panel (`TooltipPortal`) so the
 * description overlay looks IDENTICAL whether the user is reading
 * a merchant item card or a Yard Sale narrative choice. This was
 * the explicit design ask from the audit: "card and choice
 * description overlays should look the same."
 *
 * Why portals: the tooltip needs to escape every clipping ancestor
 * (modal `overflow: hidden`, the merchant grid, the bag drawer scroll
 * container, etc.) and always sit above the chip surface. Rendering
 * at `document.body` is the only place we can guarantee that.
 *
 * Why `forceOpen`: gamepad users navigate with DPAD and have no
 * pointer events to trigger an `onPointerEnter`. The caller passes
 * `forceOpen` (typically `focused && gamepadPresent`) to drive the
 * tooltip programmatically so the focused chip/choice's description
 * shows up the same way it does on mouse hover.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { CardDefinition } from "../lib/cards";
import type { EventChoice } from "../lib/run";
import { abilityHintFor } from "../lib/cardDisplay";

const HOVER_LAYER_Z_CLASS = "z-[10000]";

export interface UseHoverOpts {
  /**
   * When true, the tooltip stays open regardless of pointer state.
   * Use for gamepad-driven focus where there's no mouse hover.
   */
  forceOpen?: boolean;
  /**
   * Hide the player-attribution line ("Mike Trout (2024)"). In SZN
   * mode the legacy attribution is meaningless flavor; outside SZN
   * it provides the card's printed origin. Only consumed by
   * `useAbilityHover`.
   */
  hidePlayerName?: boolean;
}

export type UseAbilityHoverOpts = UseHoverOpts;

interface HoverAnchorResult {
  surfaceRef: RefObject<HTMLDivElement | null>;
  /**
   * Spread onto the same element for mouse / pen / touch hover.
   * Undefined when the caller has nothing to show (no description).
   */
  pointerHandlers:
    | {
        onPointerEnter: () => void;
        onPointerLeave: () => void;
        onPointerMove: () => void;
      }
    | undefined;
  open: boolean;
  anchor: { cx: number; top: number } | null;
  openHover: () => void;
  scheduleClose: () => void;
}

/**
 * Shared "open/close + measure anchor + pointerHandlers" machinery
 * for any tooltip primitive in this module. Returns the bits both
 * tooltip hooks need so they only have to define their portal body.
 *
 * `hasContent` gates whether the pointer handlers are wired (no
 * point in opening a tooltip with nothing to show) and whether the
 * `forceOpen` flag actually paints anything.
 */
function useHoverAnchor(
  hasContent: boolean,
  opts: UseHoverOpts,
): HoverAnchorResult {
  const { forceOpen = false } = opts;
  const surfaceRef = useRef<HTMLDivElement>(null);
  // Two independent truth sources: pointer over the chip vs. external
  // "the parent says this is focused" (gamepad nav). The open state
  // is the OR of both -- losing one but keeping the other should NOT
  // close the tooltip; losing both should close it after the leave
  // debounce. Earlier revisions conflated the two and a gamepad chip
  // that lost focus to mouse hover on a sibling left its tooltip
  // stuck open because the "I'm hovered" flag was set by the gamepad
  // path and never cleared when focus moved.
  const pointerHoverRef = useRef(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pointerOpen, setPointerOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ cx: number; top: number } | null>(
    null,
  );

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current != null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const measureAnchor = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ cx: r.left + r.width / 2, top: r.top });
  }, []);

  const openHover = useCallback(() => {
    clearLeaveTimer();
    pointerHoverRef.current = true;
    measureAnchor();
    setPointerOpen(true);
  }, [clearLeaveTimer, measureAnchor]);

  const scheduleClose = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => {
      pointerHoverRef.current = false;
      setPointerOpen(false);
      leaveTimerRef.current = null;
    }, 120);
  }, [clearLeaveTimer]);

  // The tooltip is open whenever EITHER the pointer is over the chip
  // OR the parent has flagged it as focused. Anchor measurement runs
  // any time we transition into open (from either path) so the portal
  // never paints at a stale top/left.
  const open = (pointerOpen || forceOpen) && hasContent;
  useEffect(() => {
    if (open) measureAnchor();
    else setAnchor(null);
  }, [open, measureAnchor]);

  // When the parent stops flagging us as focused, also forget any
  // stale pointer hover state. Disabled buttons (e.g. a Merchant chip
  // the user just bought, marked BOUGHT) have `pointer-events: none`
  // applied by the browser's default UA stylesheet, which silently
  // suppresses the `onPointerLeave` we'd otherwise rely on. Without
  // this sync the tooltip would stay pinned open over a chip the
  // user has already moved past. The MerchantView wires mouse hover
  // to the same focus index, so focus leaving us is a reliable
  // proxy for "the user is no longer reading this chip."
  useEffect(() => {
    if (!forceOpen) {
      clearLeaveTimer();
      pointerHoverRef.current = false;
      setPointerOpen(false);
    }
  }, [forceOpen, clearLeaveTimer]);

  useEffect(() => () => clearLeaveTimer(), [clearLeaveTimer]);

  // Re-anchor on viewport scroll/resize so a flick or pinch-zoom
  // doesn't leave the tooltip stranded over the wrong card. `true`
  // capture-phase scroll catches scrolling containers too.
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => measureAnchor();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, measureAnchor]);

  const onPointerMove = useCallback(() => {
    if (pointerHoverRef.current) measureAnchor();
  }, [measureAnchor]);

  return {
    surfaceRef,
    pointerHandlers: hasContent
      ? { onPointerEnter: openHover, onPointerLeave: scheduleClose, onPointerMove }
      : undefined,
    open,
    anchor,
    openHover,
    scheduleClose,
  };
}

interface TooltipPortalProps {
  anchor: { cx: number; top: number };
  /** Re-open the tooltip when the cursor enters it (sticky reads). */
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  /** Pill header label ("Ability", "Choice"). */
  heading: string;
  /** Main title line, e.g. card name or choice label. */
  title: string;
  /** Optional right-aligned tag pill (card.abilityType, choice cost). */
  tag?: { text: string; className?: string };
  /** Optional sub-line (player attribution, etc.). */
  subline?: string;
  /** Long-form description -- the reason the tooltip exists. */
  description: string;
  /**
   * Optional one-line glossary hint rendered between the description
   * and the player-attribution subline. Used by `useAbilityHover` to
   * explain what an ability-type / utility-tag actually does (e.g.
   * "AURA — boosts adjacent cards in the chain") so first-time
   * players don't need a separate glossary screen. Hidden when null.
   */
  hint?: string | null;
}

/**
 * Shared portal panel painted by every description-overlay hook in
 * this module. Centralizing the markup is what guarantees the
 * "card and choice description overlays look the same" invariant
 * from the audit -- if you change the styling here, every consumer
 * (cards + choices) updates together.
 */
function TooltipPortal({
  anchor,
  onPointerEnter,
  onPointerLeave,
  heading,
  title,
  tag,
  subline,
  description,
  hint,
}: TooltipPortalProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`pointer-events-auto fixed ${HOVER_LAYER_Z_CLASS} w-64 max-w-[calc(100vw-1.25rem)] max-h-[min(85vh,32rem)] overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 p-3 shadow-2xl sm:w-72`}
      style={{
        left: anchor.cx,
        top: anchor.top,
        transform: "translate(-50%, calc(-100% - 8px))",
      }}
      role="tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="mb-1.5 border-b border-slate-700 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
        {heading}
      </div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="truncate text-[11px] font-black uppercase tracking-tight leading-none text-white">
          {title}
        </div>
        {tag && (
          <div
            className={`shrink-0 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white ${tag.className ?? "bg-slate-700"}`}
          >
            {tag.text}
          </div>
        )}
      </div>
      {subline && (
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
          {subline}
        </div>
      )}
      <div className="text-xs font-medium leading-snug text-slate-300">
        {description}
      </div>
      {hint && (
        <div className="mt-2 border-t border-slate-700 pt-2 text-[10px] font-medium italic leading-snug text-slate-400">
          {hint}
        </div>
      )}
    </div>,
    document.body,
  );
}

export interface UseAbilityHoverResult {
  surfaceRef: RefObject<HTMLDivElement | null>;
  pointerHandlers:
    | {
        onPointerEnter: () => void;
        onPointerLeave: () => void;
        onPointerMove: () => void;
      }
    | undefined;
  tooltip: React.ReactNode;
}

export function useAbilityHover(
  card: CardDefinition,
  opts: UseAbilityHoverOpts = {},
): UseAbilityHoverResult {
  const { hidePlayerName = false } = opts;
  const hasAbility = !!card.description;
  const {
    surfaceRef,
    pointerHandlers,
    open,
    anchor,
    openHover,
    scheduleClose,
  } = useHoverAnchor(hasAbility, opts);

  // Glossary hint -- explains the broad ability-type / utility-tag
  // jargon ("AURA", "CPY", "Signature", etc.) inline so a first-time
  // SZN player can read it WITHOUT being kicked to a separate
  // glossary screen. Falls back to null when neither table has a
  // matching row, in which case the hint row is skipped entirely.
  const hint = abilityHintFor(card);

  const tooltip =
    open && anchor ? (
      <TooltipPortal
        anchor={anchor}
        onPointerEnter={openHover}
        onPointerLeave={scheduleClose}
        heading="Ability"
        title={card.name}
        // SZN mode prints "EncounterItem" on every item, which is
        // noise the user already understands from the surface they're
        // on (merchant chip, bag chip, etc.). Suppress the tag for
        // EncounterItem so the description overlay stays clean.
        tag={
          card.abilityType && card.abilityType !== "EncounterItem"
            ? {
                text: card.abilityType,
                className: card.color || "bg-slate-700",
              }
            : undefined
        }
        subline={!hidePlayerName && card.player ? card.player : undefined}
        description={card.description ?? ""}
        hint={hint}
      />
    ) : null;

  return { surfaceRef, pointerHandlers, tooltip };
}

export interface UseChoiceHoverResult {
  surfaceRef: RefObject<HTMLDivElement | null>;
  pointerHandlers:
    | {
        onPointerEnter: () => void;
        onPointerLeave: () => void;
        onPointerMove: () => void;
      }
    | undefined;
  tooltip: React.ReactNode;
}

/**
 * Description tooltip for an event-encounter choice tile.
 *
 * Mirrors `useAbilityHover` so the description overlay for a Yard
 * Sale choice ("Pick a player. One of their edges becomes Wildcard.")
 * paints in the same slate-800 portal panel as a merchant item's
 * ability description. This is the bridge that delivers the audit's
 * "all encounter descriptions should look the same" goal.
 *
 * The label is run through `stripChoicePriceTail` so the title line
 * doesn't double-print the cost ("Wildcard Sticker ($3)" → "Wildcard
 * Sticker") -- the price chip already lives directly below the tile.
 */
export function useChoiceHover(
  choice: EventChoice,
  opts: UseHoverOpts = {},
): UseChoiceHoverResult {
  const hasBlurb = !!choice.resultBlurb;
  const {
    surfaceRef,
    pointerHandlers,
    open,
    anchor,
    openHover,
    scheduleClose,
  } = useHoverAnchor(hasBlurb, opts);

  // Surface the cost on the tooltip header so the user reads both
  // the result blurb AND the spend in one place. "FREE" for zero-
  // cost choices so the absence of a number doesn't read as missing
  // data.
  const cost = choice.costPreview ?? 0;
  const costTag =
    cost > 0
      ? { text: `$${cost}`, className: "bg-amber-500 text-slate-900" }
      : { text: "FREE", className: "bg-emerald-600 text-white" };

  const tooltip =
    open && anchor ? (
      <TooltipPortal
        anchor={anchor}
        onPointerEnter={openHover}
        onPointerLeave={scheduleClose}
        heading="Choice"
        title={stripChoicePriceTail(choice.label)}
        tag={costTag}
        description={choice.resultBlurb ?? ""}
      />
    ) : null;

  return { surfaceRef, pointerHandlers, tooltip };
}

/**
 * Trim a price tail from a choice label so the title line in the
 * tooltip doesn't echo the cost already painted on the price chip.
 * Matches the same patterns `EncounterFocusPanel.stripPriceTail`
 * handled before the description was moved into a hover overlay:
 *   - parenthetical price suffix: "Wildcard Sticker ($3)"
 *   - dash/em-dash + price tail: "Outfield Patch — $4"
 *   - bare trailing dollar token: "Cheap Glove $2"
 */
function stripChoicePriceTail(s: string): string {
  return s
    .replace(/\s*\(\s*\$\d+(?:\.\d+)?\s*\)\s*$/u, "")
    .replace(/\s*[—\-–]\s*\$\d+(?:\.\d+)?\s*$/u, "")
    .replace(/\s+\$\d+(?:\.\d+)?\s*$/u, "")
    .trim();
}
