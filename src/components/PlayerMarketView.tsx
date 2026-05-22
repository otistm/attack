/**
 * PlayerMarketView — Free Agency stand. Bazaar-style cyan vibe so it
 * reads as a distinct encounter type next to merchants (amber) and
 * events (purple). Player tiles use the SAME footer-style visual
 * (`FooterStylePlayerCard`) as the always-on SZN bottom rail AND the
 * Wildcard Sticker / roster pickers -- the user reads every SZN
 * "player chip" surface with the same vocabulary.
 *
 * Pick-spend is fired by the PARENT `FrontOfficeScreen.closeEncounter`
 * unconditionally on close -- opening the encounter is the commitment.
 * Walking away without signing still spends the slot.
 */

import { useEffect } from "react";
import { DollarSign, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { type PlayerMarketOffer } from "../lib/run";
import { PLAYERS } from "../lib/players";
import { getSznPlayer, isSznPlayer } from "../lib/sznPlayers";
import { MLB_TEAMS } from "../lib/sznTeams";
import { FooterStylePlayerCard } from "./FooterStylePlayerCard";
import { resolveSznPlayerEdges } from "../lib/cardDisplay";
import { RARITY_BASE_VALUE } from "../lib/run";
import {
  EncounterFocusPanel,
  type EncounterFocusCardData,
} from "./EncounterFocusOverlay";
import { useSznGamepad, useFocusIndex } from "../lib/useSznGamepad";

export function PlayerMarketView({
  slotIndex,
  offer,
  onClose,
}: {
  slotIndex: number;
  offer: PlayerMarketOffer;
  onClose: () => void;
}) {
  const run = useGameStore((s) => s.run);
  const buy = useGameStore((s) => s.buyPlayerFromMarket);
  const cash = run?.cash ?? 0;
  // Gamepad focus surface. When the user has dropped focus into the
  // persistent footer rail (`'footer'`), every press in this overlay
  // becomes pass-through so the footer router (priority 50) can run
  // its own DPAD nav / collapse / activate. Without this gate the
  // priority-100 handler below would swallow the footer's input the
  // moment the encounter view mounted.
  const focusSurface = useGameStore((s) => s.sznGamepadFocus);

  const handleSign = (i: number) => {
    // `buyPlayerFromMarket` is internally a no-op on cash mismatch /
    // duplicate / unknown player, so a misclick won't accidentally
    // sign anyone. The encounter pick is committed by the parent on
    // close regardless of outcome.
    buy(slotIndex, i);
  };

  // Controller navigation. DPad cycles through the listing row PLUS
  // a trailing "Leave" slot so a gamepad user can navigate to the
  // Leave button and activate it with CROSS (matches mouse UX).
  // TRIANGLE / CIRCLE still close from anywhere as the shortcut path.
  const leaveIdx = offer.listings.length; // last cursor slot is "Leave"
  const [focusIdx, setFocusIdx] = useFocusIndex(offer.listings.length + 1);
  const leaveFocused = focusIdx === leaveIdx;

  // Floating overlay payload for the currently focused free-agent
  // tile. Same shape as the merchant overlay, but the "value" slot
  // shows the player's base score (so the user reads identity +
  // power at a glance) and the subtitle stitches together franchise
  // / position / rarity / price. Null when the cursor is on Leave or
  // an unresolvable id (defensive).
  const focusedPlayerOverlay: EncounterFocusCardData | null = (() => {
    if (leaveFocused) return null;
    const listing = offer.listings[focusIdx];
    if (!listing) return null;
    const player =
      getSznPlayer(listing.playerId) ??
      PLAYERS.find((p) => p.id === listing.playerId);
    if (!player) return null;
    const szn = isSznPlayer(player);
    // Subtitle: team short-name · position · rarity. Price is
    // intentionally NOT included -- the price chip directly under
    // the player card already shows it, and the user explicitly
    // asked for no duplicate price text in the description area.
    const subtitleParts: string[] = [];
    if (szn) {
      const team = MLB_TEAMS[player.teamId];
      if (team) subtitleParts.push(team.shortName);
      subtitleParts.push(player.position);
    } else {
      subtitleParts.push(player.role);
    }
    subtitleParts.push("Common");
    // SZN player edges flow through the shared resolver so the
    // focus panel paints the same chips as the listing card AND
    // the in-run footer rail for the same player.
    const edges = szn
      ? resolveSznPlayerEdges(player)
      : { leftEdge: null, rightEdge: null };
    return {
      label: player.name,
      subtitle: subtitleParts.join(" · "),
      description: szn ? player.flavor : undefined,
      value: szn ? player.baseScoreCommon : undefined,
      leftEdge: edges.leftEdge,
      rightEdge: edges.rightEdge,
    };
  })();

  // Mirror the merchant view: publish the focused free-agent's edges
  // to the global encounter-focus state so the persistent footer
  // rail can lift any chip that snaps to either side of the focused
  // player. Clear on unmount so the highlight doesn't leak forward.
  const setEncounterFocusEdges = useGameStore(
    (s) => s.setEncounterFocusEdges,
  );
  useEffect(() => {
    setEncounterFocusEdges(
      focusedPlayerOverlay
        ? {
            leftEdge: focusedPlayerOverlay.leftEdge ?? null,
            rightEdge: focusedPlayerOverlay.rightEdge ?? null,
          }
        : null,
    );
    return () => setEncounterFocusEdges(null);
  }, [
    focusedPlayerOverlay?.leftEdge,
    focusedPlayerOverlay?.rightEdge,
    setEncounterFocusEdges,
  ]);

  useSznGamepad({
    id: "player-market-view",
    priority: 100,
    enabled: true,
    handler: (btn) => {
      // Footer ownership escape: when the user has dropped focus into
      // the persistent SZN footer (`'footer'` surface), bail on every
      // input so the priority-50 footer router runs unimpeded -- it
      // handles DPAD nav, CROSS to deal/swap, and DPAD_UP to flip
      // focus back to the screen surface (i.e. back to this overlay).
      // Without this gate the listing nav below would silently swallow
      // the footer's input while the encounter was open.
      if (focusSurface !== "screen") return false;
      // 2D nav: free-agent listings on row 0, [Leave] on row 1.
      // DPAD_DOWN from a listing jumps straight to Leave instead of
      // continuing to scroll the listing row (which was the source
      // of the "DOWN slides through cards until Leave is reached"
      // bug). DPAD_LEFT/RIGHT cycle within the current row.
      if (btn === "DPAD_LEFT") {
        if (!leaveFocused && focusIdx > 0) setFocusIdx(focusIdx - 1);
      } else if (btn === "DPAD_RIGHT") {
        if (!leaveFocused) {
          if (focusIdx < leaveIdx - 1) setFocusIdx(focusIdx + 1);
          else if (focusIdx === leaveIdx - 1) setFocusIdx(leaveIdx);
        }
      } else if (btn === "DPAD_DOWN") {
        // Bottom action row already focused -> let the footer router
        // catch this press and flip focus into the persistent SZN
        // rail so the user can explore their roster + bag without
        // closing the overlay. Returning `false` is how
        // `useSznGamepad` propagates the press down the priority
        // stack to the footer (priority 50).
        if (leaveFocused) return false;
        setFocusIdx(leaveIdx);
      } else if (btn === "DPAD_UP") {
        if (leaveFocused && leaveIdx > 0) setFocusIdx(leaveIdx - 1);
      } else if (btn === "CROSS") {
        if (leaveFocused) onClose();
        else handleSign(focusIdx);
      } else if (btn === "TRIANGLE" || btn === "CIRCLE") onClose();
    },
  });

  return (
    <div className="relative rounded-2xl bg-gradient-to-br from-cyan-700 via-cyan-950 to-slate-950 ring-2 ring-cyan-400/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] p-6 flex flex-col gap-5 overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-10 -right-6 text-[160px] opacity-10 select-none pointer-events-none"
      >
        🪪
      </div>

      <div className="flex items-start justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-slate-950/60 border-2 border-white/10 text-4xl shadow-inner">
            🪪
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-cyan-300 block">
              Player Market
            </span>
            <h3 className="dugout-font-sport text-3xl sm:text-4xl uppercase tracking-widest text-white drop-shadow">
              {offer.label}
            </h3>
            {/* offer.blurb (the encounter narrative line --
                "agents flood the lobby" etc.) is rendered on the
                EncounterCard tile in FrontOfficeScreen. Repeating
                it here was verbatim duplication of the line the
                user just clicked through. The opened view keeps
                the pill + title for visual continuity but drops
                the blurb so it doesn't read as duplicate. */}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-300 hover:text-white p-1 rounded hover:bg-white/10"
          aria-label="Close player market"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 justify-items-center relative z-10">
        {offer.listings.map((listing, i) => {
          // SZN players are the primary catalog; legacy `MlbPlayer` is
          // the safety fallback (used only when every SZN player is
          // owned -- see `freeAgencyOffer` in items.ts). Looking up
          // SZN first means the cards render with the semantic
          // `SznEdgeHalf` connectors (matching combat / footer rail /
          // pack-rip) instead of the legacy geometric shapes.
          const player =
            getSznPlayer(listing.playerId) ??
            PLAYERS.find((p) => p.id === listing.playerId);
          if (!player) return null;
          const owned = !!run?.roster.some((r) => r.player.id === listing.playerId);
          // Roster-full is NO LONGER a buy-blocking gate -- the store's
          // overflow flow queues a pending player grant + flips the
          // persistent SZN footer rail into release mode so the user
          // picks the cut from the same row they use for the rest of
          // FO. The encounter listing stays clickable; the cull lives
          // in the footer.
          const cashShortBy = Math.max(0, listing.price - cash);
          const disabled = owned || cash < listing.price;
          const badge = owned ? "OWNED" : null;
          const badgeClass = owned ? "bg-emerald-700" : "bg-slate-800";
          const focused = focusIdx === i;
          // Disabled-row reason -- playtest flagged "disabled price chip
          // with no explanation" as confusing. We now surface the gate
          // both as a tooltip (covers desktop/mouse) AND as a visible
          // subtitle under the price chip (covers touch/controller +
          // accessibility), in priority order so the most actionable
          // ungate appears first.
          //
          // Owned beats cash-short (no point telling the user how much
          // they need when they already own the player); a pure cash
          // shortage spells out the exact amount needed. Roster-full
          // is no longer a blocking state, so it doesn't appear here.
          let disabledReason: string | null = null;
          if (owned) disabledReason = "Already on roster";
          else if (cashShortBy > 0)
            disabledReason = `Need $${cashShortBy} more`;
          // Edge + team resolution flows through the shared
          // `cardDisplay.resolveSznPlayerEdges` helper so the
          // free-agency listing renders the same edges (and the
          // same `team-logo` synthetic) as the in-run footer rail
          // and the at-bat hero card.
          const szn = isSznPlayer(player);
          const { leftEdge, rightEdge } = szn
            ? resolveSznPlayerEdges(player)
            : { leftEdge: null, rightEdge: null };
          // Score readout flows through the shared rarity floor --
          // the listing is signed at `listing.rarity` (always "common"
          // for v1, typed forward for promotions), so the displayed
          // value matches the actual score the player will contribute
          // once on the roster. Previously this surfaced
          // `player.baseScoreCommon` (a designer-facing balance
          // number, e.g. Aaron Judge=85) which read way higher than
          // the rest of the cards and gave the false impression that
          // free agents were dramatically stronger than the user's
          // existing roster.
          const value = RARITY_BASE_VALUE[listing.rarity];
          const teamCode = szn ? player.teamId : null;
          return (
            <div
              key={listing.listingId}
              className="flex flex-col items-center gap-3"
              title={disabledReason ?? undefined}
            >
              {/* Outer focus wrapper. The previous render piped
                  `focused` straight to `FooterStylePlayerCard`, which
                  collapses `focused` into the inner `state` only when
                  NOT `disabled` -- so a focused-AND-disabled card
                  (cursor on an unaffordable listing) was rendering
                  with NO focus indicator at all. Wrapping here means
                  the ring reads regardless of the inner disabled
                  state, and matches every other gamepad-focus surface
                  in SZN. */}
              <div
                className={`rounded-lg p-1 transition-transform ${
                  focused
                    ? "ring-2 ring-amber-300 -translate-y-1 shadow-[0_8px_18px_rgba(251,191,36,0.4)]"
                    : "ring-0"
                }`}
              >
                <FooterStylePlayerCard
                  name={player.name}
                  role={player.role}
                  value={value}
                  teamCode={teamCode}
                  rarity={listing.rarity}
                  leftEdge={leftEdge}
                  rightEdge={rightEdge}
                  focused={focused}
                  disabled={disabled}
                  badge={badge}
                  badgeClass={badgeClass}
                  onHover={() => setFocusIdx(i)}
                  onPick={() => handleSign(i)}
                  ariaLabel={`Sign ${player.name}`}
                />
              </div>
              {/* Price chip below the card -- same shape and tint as
                  the merchant listings so the Free Agency stand reads
                  as the player-flavored sibling of the merchant
                  view. Owned listings show an OWNED chip; otherwise
                  the price is always painted (even when the user
                  can't afford it / their roster is full) so the
                  reader can scan all four prices at once. The chip
                  just dims in those gated states. */}
              <div
                className={`mt-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-black text-base shadow-md ${
                  owned
                    ? "bg-emerald-700 text-white"
                    : disabled
                      ? "bg-slate-800 text-slate-500"
                      : "bg-amber-500 text-slate-900"
                }`}
              >
                {owned ? (
                  "OWNED"
                ) : (
                  <>
                    <DollarSign className="w-4 h-4" />
                    {listing.price}
                  </>
                )}
              </div>
              {/* Inline disabled-row reason. Always visible (not just on
                  hover) so touch/controller users get the same context
                  as desktop, and so the gate explains itself to a user
                  scanning the row without poking at each card. Owned
                  rows skip this because the OWNED chip above already
                  carries the message. */}
              {disabled && !owned && disabledReason && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-[0.15em] ${
                    cashShortBy > 0 ? "text-amber-300/80" : "text-rose-300/80"
                  }`}
                >
                  {disabledReason}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer row: focused-player detail on the LEFT, Leave button
          on the right. Mirrors the MerchantView footer layout so the
          two encounter views feel consistent. Cash on hand is
          intentionally NOT surfaced here -- the RunHud strip already
          shows live cash so this row stays focused on the listing
          detail the user is acting on. */}
      <div className="flex items-stretch gap-3 pt-3 border-t border-white/10 relative z-10">
        <div className="flex-1 min-w-0 flex items-center">
          <EncounterFocusPanel card={focusedPlayerOverlay} variant="player" />
        </div>
        <div className="flex items-center">
          <button
            type="button"
            onClick={onClose}
            onMouseEnter={() => setFocusIdx(leaveIdx)}
            className={`px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold uppercase tracking-widest text-white border border-white/20 transition-all ${
              leaveFocused
                ? "ring-2 ring-amber-400/80 -translate-y-1 border-amber-300/60"
                : ""
            }`}
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
