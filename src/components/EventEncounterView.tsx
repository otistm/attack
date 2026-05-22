/**
 * EventEncounterView — Bazaar-style narrative encounter.
 *
 * Two phases:
 *   1) Choice phase: prompt + 2-4 choices laid out as fat buttons.
 *      Locked choices ("COMING SOON") render disabled, gamepad skips
 *      them when navigating, but still display the label + cost so
 *      the user can see what's coming.
 *   2) Picker phase (optional): when a choice declares
 *      `requiresPicker`, opening the encounter modal first opens the
 *      matching picker (player / batter / pitcher / edge-swap /
 *      release). Resolving the picker calls `resolveEventChoice` with
 *      the chosen player id; cancelling returns to the choice list.
 *   3) Result phase: shows the resolution blurb plus the reward card
 *      (if the choice handed out an item) so the user sees exactly
 *      what they earned. Continue closes the modal.
 *
 * Pick-spend is fired by the PARENT `FrontOfficeScreen.closeEncounter`
 * unconditionally on close — opening the encounter is the commitment.
 * Walking away from the choice phase still spends the slot.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { DollarSign, Lock, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import {
  EVENT_GLYPH,
  EVENT_LABEL,
  type EventOffer,
  type EventChoice,
} from "../lib/run";
import { SESSION_CARDS, SZN_ENCOUNTER_ITEMS_BY_ID, type CardDefinition } from "../lib/cards";
import { SznCard } from "./SznCard";
import { displayValueFor, resolveCardEdges } from "../lib/cardDisplay";
import { useChoiceHover } from "./useAbilityHover";
import { useSznGamepad, useFocusIndex } from "../lib/useSznGamepad";
import { RosterPlayerPicker } from "./RosterPlayerPicker";
import { EdgeSwapPicker } from "./EdgeSwapPicker";

const DEFAULT_GLYPH = "🎲";

export function EventEncounterView({
  slotIndex,
  offer,
  onClose,
}: {
  slotIndex: number;
  offer: EventOffer;
  onClose: () => void;
}) {
  const resolveEventChoice = useGameStore((s) => s.resolveEventChoice);
  const startPurchaseFlight = useGameStore((s) => s.startPurchaseFlight);
  // Gamepad focus surface (see PlayerMarketView / MerchantView for the
  // matching pattern). The handler below registers at priority 100 --
  // when the user drops focus into the persistent SZN footer rail
  // we let every press fall through so the priority-50 footer router
  // owns DPAD nav / CROSS / collapse without this overlay swallowing
  // it.
  const focusSurface = useGameStore((s) => s.sznGamepadFocus);
  const [initialBagIds] = useState<string[]>(() => {
    const s = useGameStore.getState();
    return s.run ? s.run.itemBag.map((i) => i.instanceId) : [];
  });
  const bag = useGameStore((s) => s.run?.itemBag);
  const roster = useGameStore((s) => s.run?.roster ?? []);
  const cash = useGameStore((s) => s.run?.cash ?? 0);
  const [resolved, setResolved] = useState<EventChoice | null>(null);
  const [rewardCard, setRewardCard] = useState<CardDefinition | null>(null);
  // Per-choice tile refs so we can capture the source rect at click
  // time for the fly-to-footer animation on item-granting choices.
  const choiceRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Source rect captured at commit time. Held across the
  // `resolveEventChoice` → `rewardCard` resolution gap so the flight
  // we eventually fire lifts off from where the user actually clicked,
  // not from wherever the focus happened to be when the bag diff
  // resolved.
  const flightSourceRef = useRef<DOMRect | null>(null);
  const flightFiredForRef = useRef<string | null>(null);
  // When a picker is open, `pickerFor` holds the choice that triggered
  // it. Closing the picker via cancel returns to the choice list;
  // committing fires `resolveEventChoice` with the chosen target id.
  const [pickerFor, setPickerFor] = useState<EventChoice | null>(null);

  // Reward-card resolution. Items earned via `grantItem` resolve to a
  // known CardDefinition immediately (no random roll); items earned
  // via `addItemRandom` need to be looked up in the bag diff.
  useEffect(() => {
    if (!resolved) return;
    if (resolved.effect.kind === "grantItem") {
      const grantId = resolved.effect.cardId;
      const card =
        SZN_ENCOUNTER_ITEMS_BY_ID[grantId] ??
        SESSION_CARDS.find((c) => c.id === grantId) ??
        null;
      setRewardCard(card);
      return;
    }
    if (resolved.effect.kind !== "addItemRandom") return;
    if (!bag) return;
    const newOne = bag.find((i) => !initialBagIds.includes(i.instanceId));
    if (!newOne) return;
    const card = SESSION_CARDS.find((c) => c.id === newOne.cardId) ?? null;
    setRewardCard(card);
  }, [resolved, bag, initialBagIds]);

  // Fire the fly-to-footer flight once both the resolved choice and
  // its rewardCard land. Source rect was captured at click time
  // (`flightSourceRef`); target rect is the live footer abilities row.
  // `flightFiredForRef` guards against re-firing on store re-renders
  // (the effect's deps change when `bag` ticks for unrelated reasons).
  useEffect(() => {
    if (!resolved || !rewardCard) return;
    if (flightFiredForRef.current === resolved.choiceId) return;
    const source = flightSourceRef.current;
    if (!source) return;
    const targetEl = document.getElementById("szn-footer-row-right");
    if (!targetEl) return;
    const target = targetEl.getBoundingClientRect();
    flightFiredForRef.current = resolved.choiceId;
    startPurchaseFlight({
      flightId: `event-${resolved.choiceId}`,
      cardId: rewardCard.id,
      source: {
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
      },
      target: { x: target.x, y: target.y, width: target.width, height: target.height },
    });
  }, [resolved, rewardCard, startPurchaseFlight]);

  // Persist the picked target so the resolution panel can name them
  // ("Stanton's left edge is now Wildcard.") instead of echoing the
  // original choice prompt. `null` for non-picker choices keeps the
  // legacy behavior (just shows `c.resultBlurb`).
  const [resolvedTargetId, setResolvedTargetId] = useState<string | null>(null);
  // Two-target picker (EdgeSwap) writes a "Judge ↔ Stanton" headline
  // here since the single-target path doesn't apply.
  const [swapHeadline, setSwapHeadline] = useState<string | null>(null);

  const commitChoice = (c: EventChoice, targetPlayerId?: string) => {
    resolveEventChoice(slotIndex, c.choiceId, targetPlayerId);
    setResolved(c);
    setResolvedTargetId(targetPlayerId ?? null);
    setPickerFor(null);
  };

  // Build the post-resolution text. For picker-driven choices we
  // prepend the picked player's display name so the user sees who
  // the effect actually landed on -- the audit flagged the original
  // "echo the choice prompt" rendering as confusing because it never
  // referenced the user's selection.
  const resolvedTargetName: string | null = (() => {
    if (!resolvedTargetId) return null;
    const slot = roster.find((r) => r.player.id === resolvedTargetId);
    return slot?.player.name ?? null;
  })();

  const unaffordable = (c: EventChoice) =>
    !!(c.costPreview && c.costPreview > 0 && cash < c.costPreview);

  const handleChoice = (c: EventChoice, index: number) => {
    if (c.locked) return; // gamepad nav also skips, this is a click guard
    if (unaffordable(c)) return;
    // Capture the source rect for the fly-to-footer flight BEFORE we
    // commit -- the commit triggers the resolved-state re-render and
    // the choice tile unmounts immediately after, so we'd lose the
    // rect if we tried to measure post-commit. Only meaningful for
    // item-granting choices; non-item choices ignore the rect.
    const tile = choiceRefs.current[index];
    flightSourceRef.current = tile?.getBoundingClientRect() ?? null;
    if (c.requiresPicker) {
      setPickerFor(c);
      return;
    }
    commitChoice(c);
  };

  // Choices the gamepad considers focusable — skip locked + unaffordable
  // entries so focus never lands on a button CROSS would no-op.
  const focusable = useMemo(() => {
    return offer.choices
      .map((c, i) => ({ c, i }))
      .filter((entry) => !entry.c.locked && !(entry.c.costPreview && entry.c.costPreview > 0 && cash < entry.c.costPreview));
  }, [offer.choices, cash]);

  // Add a trailing "Walk away" slot so the gamepad cursor can DPAD
  // past the last focusable choice and land on the close button --
  // same affordance as `leaveIdx` in MerchantView / PlayerMarketView.
  // The slot is only meaningful in the choice phase; the resolution
  // phase short-circuits gamepad handling on `resolved`.
  const walkAwayIdx = focusable.length; // last cursor slot
  const [focusableIdx, setFocusableIdx, focusHelpers] = useFocusIndex(
    focusable.length + 1,
  );
  const walkAwayFocused = focusableIdx === walkAwayIdx;
  const focusedRealIdx = walkAwayFocused
    ? -1
    : focusable[focusableIdx]?.i ?? -1;

  // Mouse-hover sync. Translate a choice-list index back into the
  // focusable-list index so hovering a choice card moves the focus
  // ring AND the focused-card detail panel just like DPAD nav does.
  // Hover over a locked/unaffordable choice is a no-op (no matching
  // focusable entry).
  const setFocusByChoiceIndex = (choiceIdx: number) => {
    const fi = focusable.findIndex((e) => e.i === choiceIdx);
    if (fi >= 0) setFocusableIdx(fi);
  };

  useSznGamepad({
    id: "event-encounter-view",
    // Picker overlays own focus at 200; this view drops out when a
    // picker is open so its DPAD nav doesn't bleed into the picker.
    priority: 100,
    enabled: pickerFor === null,
    handler: (btn) => {
      // Footer ownership escape: while the user has dropped focus
      // into the persistent SZN footer rail, hand every press through
      // to the priority-50 footer router. Without this gate the
      // listing nav below would swallow DPAD presses while the
      // overlay was open.
      if (focusSurface !== "screen") return false;
      if (resolved) {
        if (btn === "CROSS" || btn === "CIRCLE" || btn === "TRIANGLE") {
          onClose();
          return;
        }
        // Outcome panel only owns its three "dismiss" buttons -- any
        // other press (DPAD_DOWN to drop into the footer rail, etc.)
        // is passed through to the next handler so the user can still
        // explore their roster + bag from this screen.
        return false;
      }
      // 2D nav: choice tiles on row 0, [Walk Away] on row 1.
      // DPAD_DOWN from a choice jumps straight to Walk Away rather
      // than continuing to scroll the choice row -- matches the
      // merchant + player-market overlays so all three encounter
      // surfaces share the same "DOWN reaches the action row" rule.
      // LEFT/RIGHT remain a linear walk within the focusable choice
      // list (the choice grid wraps but is dense, so a true 2D
      // mapping isn't worth the bookkeeping here).
      if (btn === "DPAD_LEFT") {
        if (!walkAwayFocused) focusHelpers.prev();
      } else if (btn === "DPAD_RIGHT") {
        if (!walkAwayFocused) focusHelpers.next();
      } else if (btn === "DPAD_DOWN") {
        // Walk-Away row already focused -> propagate the press to
        // the footer router so it can flip focus into the persistent
        // rail (roster + bag) without forcing the user to close the
        // encounter. Returning `false` is how `useSznGamepad`
        // forwards a press down the priority stack (here to the
        // priority-50 footer handler).
        if (walkAwayFocused) return false;
        setFocusableIdx(walkAwayIdx);
      } else if (btn === "DPAD_UP") {
        if (walkAwayFocused && walkAwayIdx > 0) setFocusableIdx(walkAwayIdx - 1);
      } else if (btn === "CROSS") {
        if (walkAwayFocused) {
          onClose();
        } else {
          const c = offer.choices[focusedRealIdx];
          if (c) handleChoice(c, focusedRealIdx);
        }
      } else if (btn === "CIRCLE") onClose();
    },
  });

  const glyph = EVENT_GLYPH[offer.eventId] ?? DEFAULT_GLYPH;
  const label = EVENT_LABEL[offer.eventId] ?? humanize(offer.eventId);
  // EVENT_BLURB (the short "what kind of encounter this is" line --
  // e.g. "a streetball legend stops you outside the park") is the
  // SAME copy painted on the EncounterCard tile in the
  // FrontOfficeScreen. Reading it again at the top of the opened
  // event view is verbatim duplication of the line the user just
  // committed to. The opened view drops it (header keeps the pill
  // + title for continuity); the body's `{offer.prompt}` quoted
  // bubble is the unique per-encounter scenario text and stays.

  return (
    <div className="relative rounded-2xl bg-gradient-to-br from-purple-800 via-purple-950 to-slate-950 ring-2 ring-purple-500/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-5 overflow-hidden">
      {/* Glyph backdrop */}
      <div
        aria-hidden
        className="absolute -top-12 -right-6 text-[180px] opacity-10 select-none pointer-events-none"
      >
        {glyph}
      </div>

      <div className="flex items-start justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-slate-950/60 border-2 border-white/10 text-4xl shadow-inner">
            {glyph}
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-purple-300 block">
              Event
            </span>
            <h3 className="dugout-font-sport text-3xl sm:text-4xl uppercase tracking-widest text-white drop-shadow">
              {label}
            </h3>
            {/* Event tile blurb was here -- removed to avoid the
                verbatim duplication described above. */}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-300 hover:text-white p-1 rounded hover:bg-white/10"
          aria-label="Close event"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <p className="text-base sm:text-lg text-white/95 leading-snug bg-black/30 border border-white/10 rounded-xl px-4 py-3 relative z-10">
        “{offer.prompt}”
      </p>

      {!resolved ? (
        // Choices render as card-shaped tiles with a price chip below
        // -- same vertical rhythm as merchant listings (item card +
        // price chip) and player market listings (player card + price
        // chip). For free choices we still surface a chip ("FREE")
        // so all choices share the same height and the grid stays
        // visually balanced.
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 justify-items-center relative z-10">
          {offer.choices.map((c, i) => {
            const focused = i === focusedRealIdx;
            const locked = !!c.locked;
            const broke = unaffordable(c);
            return (
              <ChoiceCard
                key={c.choiceId}
                choice={c}
                index={i}
                locked={locked}
                broke={broke}
                focused={focused}
                onHover={() => setFocusByChoiceIndex(i)}
                onPick={() => handleChoice(c, i)}
                tileRef={(el) => {
                  choiceRefs.current[i] = el;
                }}
              />
            );
          })}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border-2 border-emerald-400/50 bg-emerald-950/40 p-4 flex flex-col gap-4 relative z-10"
        >
          {swapHeadline ? (
            <p className="text-base sm:text-lg text-emerald-100 leading-snug">
              <span className="font-black tracking-wide uppercase text-emerald-50">
                {swapHeadline}:
              </span>{" "}
              {resolved.resultBlurb}
            </p>
          ) : resolvedTargetName ? (
            <p className="text-base sm:text-lg text-emerald-100 leading-snug">
              <span className="font-black tracking-wide uppercase text-emerald-50">
                {resolvedTargetName}:
              </span>{" "}
              {resolved.resultBlurb}
            </p>
          ) : (
            <p className="text-base sm:text-lg text-emerald-100 leading-snug">
              {resolved.resultBlurb}
            </p>
          )}
          {/* Reward card preview removed -- when a choice grants an
              item, the card now flies from the choice tile straight
              into the footer abilities row via `startPurchaseFlight`,
              so re-rendering the same chip here would just be a
              second "look at the card you got" panel competing with
              the flight animation. The resolution blurb above
              ({resolved.resultBlurb}) is the only narrative payload
              the panel needs; the bag chip itself lives in the
              footer rail from this point on. */}
        </motion.div>
      )}

      {/* Footer row: action button only. The focused-choice
          description used to live on the LEFT side of this row, but
          the audit asked for choice descriptions to surface as
          hover/focus overlays ABOVE each choice tile (same slate
          tooltip as item cards) instead of in a separate footer
          panel. The ChoiceCard now owns its own description tooltip
          via `useChoiceHover`, so this row collapses to just the
          Walk away / Continue CTA. The Walk away button is still a
          focusable cursor slot (`walkAwayIdx` -- the last slot after
          every focusable choice), so the gamepad can DPAD past the
          choice row and land on it. */}
      <div className="flex items-stretch gap-3 relative z-10 justify-end">
        <div className="flex items-center">
          <button
            type="button"
            onClick={onClose}
            onMouseEnter={
              resolved ? undefined : () => setFocusableIdx(walkAwayIdx)
            }
            className={`px-5 py-2.5 rounded-lg text-sm font-bold uppercase tracking-widest border transition-all ${
              resolved
                ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-300/40"
                : "bg-white/10 hover:bg-white/20 text-white border-white/20"
            } ${
              !resolved && walkAwayFocused
                ? "ring-2 ring-amber-400/80 -translate-y-1 border-amber-300/60"
                : ""
            }`}
          >
            {resolved ? "Continue" : "Walk away"}
          </button>
        </div>
      </div>

      {/* Picker overlays. Always mounted; gate purely on `open` props
          so the gamepad routers register/unregister correctly. */}
      <RosterPlayerPicker
        open={
          pickerFor?.requiresPicker === "player" ||
          pickerFor?.requiresPicker === "batter" ||
          pickerFor?.requiresPicker === "pitcher"
        }
        roster={roster}
        roleFilter={
          pickerFor?.requiresPicker === "batter"
            ? "Batter"
            : pickerFor?.requiresPicker === "pitcher"
              ? "Pitcher"
              : undefined
        }
        title={pickerFor?.label}
        prompt={pickerFor?.resultBlurb}
        onPick={(playerId) => pickerFor && commitChoice(pickerFor, playerId)}
        onCancel={() => setPickerFor(null)}
      />
      <EdgeSwapPicker
        open={pickerFor?.requiresPicker === "edgeSwap"}
        roster={roster}
        onCommit={(a, b, side) => {
          if (!pickerFor) return;
          // Encoded as a `:` separated triple so the dispatcher can
          // decode after the fact. The swap actually fires here as two
          // separate `mutateRosterEdge` mutations rather than one
          // round-trip through resolveEventChoice -- keeps the
          // EventEffect schema small.
          const { getState } = useGameStore;
          const slotA = getState().run?.roster.find((r) => r.player.id === a);
          const slotB = getState().run?.roster.find((r) => r.player.id === b);
          if (!slotA || !slotB) {
            setPickerFor(null);
            return;
          }
          // Read the live edges (overrides first) so the swap reflects
          // any in-run mutations. Falls back to player.leftEdge /
          // rightEdge when the player is an SznPlayer.
          const liveLeft = (rp: typeof slotA) =>
            rp.leftEdgeOverride ??
            ("leftEdge" in rp.player ? rp.player.leftEdge : "wildcard");
          const liveRight = (rp: typeof slotA) =>
            rp.rightEdgeOverride ??
            ("rightEdge" in rp.player ? rp.player.rightEdge : "wildcard");
          const aLeft = liveLeft(slotA);
          const aRight = liveRight(slotA);
          const bLeft = liveLeft(slotB);
          const bRight = liveRight(slotB);
          if (side === "left" || side === "both") {
            getState().resolveEventChoice(slotIndex, pickerFor.choiceId, a);
            // Manual application via run patch -- pull the live store
            // and apply the swap directly so the user doesn't see the
            // event resolve twice.
            useGameStore.setState((s) => {
              if (!s.run) return s;
              const nextRoster = s.run.roster.map((rp) => {
                if (rp.player.id === a) return { ...rp, leftEdgeOverride: bLeft };
                if (rp.player.id === b) return { ...rp, leftEdgeOverride: aLeft };
                return rp;
              });
              return { run: { ...s.run, roster: nextRoster } };
            });
          }
          if (side === "right" || side === "both") {
            useGameStore.setState((s) => {
              if (!s.run) return s;
              const nextRoster = s.run.roster.map((rp) => {
                if (rp.player.id === a) return { ...rp, rightEdgeOverride: bRight };
                if (rp.player.id === b) return { ...rp, rightEdgeOverride: aRight };
                return rp;
              });
              return { run: { ...s.run, roster: nextRoster } };
            });
          }
          // Two-target picker — surface "A ↔ B" on the resolution
          // panel so the user can verify which slots got swapped.
          const aSlot = useGameStore.getState().run?.roster.find((r) => r.player.id === a);
          const bSlot = useGameStore.getState().run?.roster.find((r) => r.player.id === b);
          const swapName =
            aSlot && bSlot
              ? `${aSlot.player.name.split(" ").slice(-1)[0]} ↔ ${bSlot.player.name.split(" ").slice(-1)[0]}`
              : null;
          setResolved(pickerFor);
          setResolvedTargetId(null);
          if (swapName) {
            // Re-use the resolvedTargetName path by writing a synthetic
            // id; the UI just needs a name so we cache one with a
            // sentinel id the slot lookup won't ever match (no real
            // player id starts with "swap:"). The render path falls
            // through to the plain resolved.resultBlurb if no slot is
            // found, so we instead override with a custom label via
            // a separate state.
            setSwapHeadline(swapName);
          }
          setPickerFor(null);
        }}
        onCancel={() => setPickerFor(null)}
      />
    </div>
  );
}

/** Convert a snake-or-kebab encounter id into a friendly label. */
function humanize(id: string): string {
  return id
    .replace(/^enc-/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/* ---------------------------------------------------------------------------
 * ChoiceCard
 *
 * Card-shaped tile for an event choice. Mirrors the merchant /
 * player market vertical rhythm:
 *
 *   [ card-shaped tile  ]   <- label + result blurb, gradient background
 *   [   price chip      ]   <- "$N" cost, "FREE" pill, or "—" for locked
 *
 * The tile shares the 96×136 `chip` footprint used by every other
 * encounter overlay (MerchantView's `FooterStyleAbilityCard` and
 * PlayerMarketView's `FooterStylePlayerCard` both render through
 * `SznCard size="chip"`), so the event-choice grid lines up
 * pixel-for-pixel against the other encounter views and the user
 * can scan all encounter types with the same visual grammar.
 *
 * State styling
 * -------------
 *   - locked     : slate border + "Coming Soon" foot, no hover lift
 *   - broke      : rose border + "Need $N" foot, click no-ops
 *   - focused    : amber ring + lift (matches merchant/market focus)
 *   - default    : purple-tinted border, hover lifts on mouse / DPAD
 *
 * Hover hooks the parent's focus index so DPAD nav and mouse hover
 * stay in lockstep -- same pattern as ListingCard in MerchantView.
 * --------------------------------------------------------------------------- */
function ChoiceCard({
  choice,
  index,
  locked,
  broke,
  focused,
  onHover,
  onPick,
  tileRef,
}: {
  choice: EventChoice;
  index: number;
  locked: boolean;
  broke: boolean;
  focused: boolean;
  onHover: () => void;
  onPick: () => void;
  /**
   * Forwarded to the button element so the parent can measure the
   * tile's bounding rect at click time for the fly-to-footer flight
   * animation on item-granting choices.
   */
  tileRef?: (el: HTMLButtonElement | null) => void;
}) {
  const interactive = !locked && !broke;
  const cost = choice.costPreview ?? 0;
  const hasCost = cost > 0;
  // When the choice grants a specific item, surface the actual card
  // preview behind the choice label so the user reads exactly what
  // they're about to acquire — same unified `<SznCard>` shell the
  // merchant, footer rail, and bag picker render. Falls back to the
  // standard purple tile when the effect doesn't grant a known card
  // (cash, scoreOverride, addItemRandom from a pool, etc.).
  const grantedCard: CardDefinition | undefined = (() => {
    const eff = choice.effect;
    if (eff && eff.kind === "grantItem") {
      return SESSION_CARDS.find((c) => c.id === eff.cardId);
    }
    return undefined;
  })();
  const grantedEdges = grantedCard
    ? (() => {
        const e = resolveCardEdges(grantedCard);
        return { left: e.leftEdge, right: e.rightEdge };
      })()
    : null;
  // Description tooltip lives ABOVE the focused tile. Same slate
  // portal as the merchant / bag chip ability hover, so a Yard Sale
  // choice ("Pick a player. One of their edges becomes Wildcard.")
  // reads in the same overlay style as an item description. `focused`
  // drives `forceOpen` so the gamepad surfaces the same description
  // the mouse hover would. Locked / broke tiles intentionally skip
  // the overlay -- the disabled chip already communicates the gate
  // ("Coming Soon" / "Need $N"), and surfacing a hover description
  // for a choice the user can't take is just noise.
  const choiceHover = useChoiceHover(choice, {
    forceOpen: focused && interactive,
  });
  return (
    <button
      ref={tileRef}
      type="button"
      onClick={interactive ? onPick : undefined}
      onMouseEnter={onHover}
      disabled={!interactive}
      className={`group relative flex flex-col items-center gap-3 p-2 rounded-xl transition-all ${
        interactive
          ? "cursor-pointer hover:-translate-y-1"
          : "cursor-not-allowed"
      } ${focused ? "ring-2 ring-amber-400/80 -translate-y-1" : ""}`}
      aria-label={`Choice ${index + 1}: ${choice.label}`}
    >
      {choiceHover.tooltip}
      {/* Card-shaped tile. When the choice grants a specific item we
          render the unified `<SznCard>` preview so the user sees the
          exact card they're about to acquire (same font, edge, tier
          glyph treatment as the merchant / footer / bag). The choice
          label rides on a small ribbon below the card. For
          non-grant choices (cash, score override, locked) we keep
          the purple narrative tile with the choice label inside.
          ----------------------------------------------------------
          `choiceHover.surfaceRef` + `pointerHandlers` are spread on
          the tile (NOT the outer button) so the description portal
          anchors over the card surface rather than over the button
          rect (which includes the price chip below the tile, which
          would push the tooltip too low and partially hide it
          behind the price chip on tight viewports). */}
      {grantedCard && !locked && !broke ? (
        <div
          ref={choiceHover.surfaceRef}
          className="flex flex-col items-center gap-1"
          {...(choiceHover.pointerHandlers ?? {})}
        >
          <SznCard
            variant="ability"
            // Match the 96x136 chip footprint used by MerchantView's
            // FooterStyleAbilityCard and PlayerMarketView's
            // FooterStylePlayerCard so all three encounter overlays
            // render cards at the same scale -- previously the event
            // grant rendered as `size="standard"` (128x176) and stuck
            // out as visually larger than the sibling overlays.
            size="chip"
            state={focused ? "focused" : "default"}
            value={displayValueFor(grantedCard)}
            label={grantedCard.name}
            abilityType={grantedCard.abilityType}
            edges={grantedEdges ?? undefined}
          />
          <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded bg-purple-700/70 text-purple-50 text-[9px] font-bold uppercase tracking-widest border border-purple-300/40 max-w-[6rem] text-center line-clamp-2 leading-tight">
            {choice.label}
          </span>
        </div>
      ) : (
        <div
          ref={interactive ? choiceHover.surfaceRef : undefined}
          {...(interactive ? choiceHover.pointerHandlers ?? {} : {})}
          // Hard-pinned to 96x136 (the SZN_CARD_SIZES.chip footprint)
          // so non-grant choices (cash, score override, locked) line
          // up flush with the SznCard preview above and the chips in
          // the sibling encounter overlays.
          style={{ width: 96, height: 136 }}
          className={`rounded-lg border-2 flex items-center justify-center p-2 shadow-md overflow-hidden relative transition-colors ${
            locked
              ? "border-slate-700 bg-slate-900/60 opacity-70"
              : broke
                ? "border-rose-600/50 bg-slate-900/60 opacity-80"
                : focused
                  ? "border-amber-300 bg-gradient-to-br from-purple-700 via-purple-900 to-slate-950"
                  : "border-purple-400/40 bg-gradient-to-br from-purple-800/80 via-purple-950 to-slate-950 group-hover:border-purple-300"
          }`}
        >
          {locked && (
            <Lock
              className="w-3.5 h-3.5 text-slate-500 absolute top-1.5 right-1.5"
              aria-hidden
            />
          )}
          <div
            className={`dugout-font-sport text-[10px] leading-tight uppercase tracking-wide text-center line-clamp-6 ${
              locked
                ? "text-slate-400"
                : broke
                  ? "text-rose-100"
                  : "text-white drop-shadow"
            }`}
          >
            {choice.label}
          </div>
        </div>
      )}

      {/* Price chip below the tile -- same shape & vertical position
          as the merchant / player market chips so all three encounter
          views share the same anchor line for the price callout. */}
      <div
        className={`mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-black text-base shadow-md ${
          locked
            ? "bg-slate-800 text-slate-500"
            : broke
              ? "bg-rose-900 text-rose-200"
              : hasCost
                ? "bg-amber-500 text-slate-900 group-hover:bg-amber-400"
                : "bg-emerald-600 text-white group-hover:bg-emerald-500"
        }`}
      >
        {locked ? (
          <span className="tracking-widest text-[11px]">—</span>
        ) : hasCost ? (
          <>
            <DollarSign className="w-4 h-4" />
            {cost}
          </>
        ) : (
          <span className="tracking-widest text-[11px]">FREE</span>
        )}
      </div>
    </button>
  );
}
