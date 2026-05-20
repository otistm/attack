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

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { DollarSign, Lock, Sparkles, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import {
  EVENT_GLYPH,
  EVENT_LABEL,
  type EventOffer,
  type EventChoice,
} from "../lib/run";
import { SESSION_CARDS, SZN_ENCOUNTER_ITEMS_BY_ID, type CardDefinition } from "../lib/cards";
import { ItemCardPreview } from "./ItemCardPreview";
import {
  EncounterFocusPanel,
  type EncounterFocusCardData,
} from "./EncounterFocusOverlay";
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
  const [initialBagIds] = useState<string[]>(() => {
    const s = useGameStore.getState();
    return s.run ? s.run.itemBag.map((i) => i.instanceId) : [];
  });
  const bag = useGameStore((s) => s.run?.itemBag);
  const roster = useGameStore((s) => s.run?.roster ?? []);
  const cash = useGameStore((s) => s.run?.cash ?? 0);
  const [resolved, setResolved] = useState<EventChoice | null>(null);
  const [rewardCard, setRewardCard] = useState<CardDefinition | null>(null);
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

  const handleChoice = (c: EventChoice) => {
    if (c.locked) return; // gamepad nav also skips, this is a click guard
    if (unaffordable(c)) return;
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

  // Focused-choice detail payload for the footer panel. Mirrors the
  // merchant + player-market overlays: shows the focused choice's
  // label and full result blurb so the user can read the *complete*
  // description even when the choice tile truncated it. Price is
  // deliberately omitted -- the chip below the choice tile already
  // surfaces it, and the user explicitly asked for no duplicate
  // price text in the description area. `null` when the resolution
  // panel is showing (no choice grid to focus) or no focusable
  // choice is selected.
  const focusedChoice = !resolved ? offer.choices[focusedRealIdx] ?? null : null;
  const focusedChoiceDetail: EncounterFocusCardData | null = (() => {
    if (!focusedChoice) return null;
    return {
      label: focusedChoice.label,
      description: focusedChoice.resultBlurb,
      // No subtitle / numeric value / edge chips -- event choices
      // aren't playable cards. Omitting these keeps the panel tight
      // (just label + description) instead of forcing chip rendering
      // for slots that don't apply.
    };
  })();

  useSznGamepad({
    id: "event-encounter-view",
    // Picker overlays own focus at 200; this view drops out when a
    // picker is open so its DPAD nav doesn't bleed into the picker.
    priority: 100,
    enabled: pickerFor === null,
    handler: (btn) => {
      if (resolved) {
        if (btn === "CROSS" || btn === "CIRCLE" || btn === "TRIANGLE") {
          onClose();
        }
        return;
      }
      if (btn === "DPAD_LEFT" || btn === "DPAD_UP") focusHelpers.prev();
      else if (btn === "DPAD_RIGHT" || btn === "DPAD_DOWN") focusHelpers.next();
      else if (btn === "CROSS") {
        if (walkAwayFocused) {
          onClose();
        } else {
          const c = offer.choices[focusedRealIdx];
          if (c) handleChoice(c);
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
                onPick={() => handleChoice(c)}
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
          {rewardCard && (
            <div className="flex flex-col items-center gap-2 pt-2 border-t border-emerald-500/20">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.4em] text-emerald-200">
                <Sparkles className="w-3.5 h-3.5" />
                Added to your bag
              </span>
              <motion.div
                initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 240, damping: 20 }}
              >
                {/* Reward card preview KEEPS its hover tooltip --
                    the reward reveal panel doesn't carry an
                    EncounterFocusPanel underneath it, so the
                    hover-tooltip is the only place the user can
                    read the ability description for what they
                    just earned. */}
                <ItemCardPreview card={rewardCard} large />
              </motion.div>
              {/* Reward-card name label was rendered here as a
                  caption -- removed because the card preview
                  already paints the name plate prominently across
                  the top of the card. Reading the same name twice
                  in a row (on the card AND beneath it) was the
                  textbook duplication the audit flagged. */}
            </div>
          )}
        </motion.div>
      )}

      {/* Footer row: focused-choice detail panel on the LEFT, action
          button on the right -- mirrors MerchantView /
          PlayerMarketView so the three encounter surfaces share the
          same vertical anchor for the focused-card readout + close
          control. The panel returns `null` when the resolution view
          is showing, so the action button gets the full row to
          itself for the "Continue" CTA. The Walk away button is
          ALSO a focusable cursor slot (`walkAwayIdx` -- the last
          slot after every focusable choice), so the gamepad can
          DPAD past the choice row and land on it. */}
      <div className="flex items-stretch gap-3 relative z-10">
        <div className="flex-1 min-w-0 flex items-center">
          <EncounterFocusPanel card={focusedChoiceDetail} variant="ability" />
        </div>
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
 * The tile inherits the ItemCardPreview / PlayerCard footprint
 * (`w-32 h-44`) so the event-choice grid lines up cleanly against
 * the other encounter views and the user can scan all encounter types
 * with the same visual grammar.
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
}: {
  choice: EventChoice;
  index: number;
  locked: boolean;
  broke: boolean;
  focused: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const interactive = !locked && !broke;
  const cost = choice.costPreview ?? 0;
  const hasCost = cost > 0;
  return (
    <button
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
      {/* Card-shaped tile. 5:7 ratio (`w-32 h-44`) matches the
          ItemCardPreview / PlayerCard default footprint so the
          encounter views all line up. The tile renders ONLY the
          choice title -- the price is the chip below (so it does
          NOT need to be repeated on the tile) and the full
          description lives in the focused-choice detail panel docked
          to the left of the Walk away button. A small lock icon
          stays inside the tile for locked-state legibility since
          the chip below is a generic "—" placeholder. */}
      <div
        className={`w-32 h-44 rounded-xl border-2 flex items-center justify-center p-3 shadow-md overflow-hidden relative transition-colors ${
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
            className="w-4 h-4 text-slate-500 absolute top-2 right-2"
            aria-hidden
          />
        )}
        <div
          className={`dugout-font-sport text-base leading-tight uppercase tracking-wide text-center line-clamp-5 ${
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
