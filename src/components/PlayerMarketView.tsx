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

import { DollarSign, X } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { STARTER_PACK_TOTAL, type PlayerMarketOffer } from "../lib/run";
import { PLAYERS } from "../lib/players";
import { getSznPlayer, isSznPlayer } from "../lib/sznPlayers";
import { MLB_TEAMS, teamLogoEdge } from "../lib/sznTeams";
import { SZN_EDGES, type SznEdgeId } from "../lib/sznEdges";
import { FooterStylePlayerCard } from "./FooterStylePlayerCard";
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
  const [focusIdx, setFocusIdx, focusHelpers] = useFocusIndex(offer.listings.length + 1);
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
    // SZN player edges drive the chip strip. `team-logo` synthetic
    // resolves to the holder's real franchise logo so the chip
    // matches the half-shape connector on the card. Legacy
    // MlbPlayers don't carry edges -> null chips.
    const leftRaw = szn ? player.leftEdge : null;
    const rightRaw = szn ? player.rightEdge : null;
    const left: SznEdgeId | null = !szn
      ? null
      : leftRaw === "team-logo"
        ? teamLogoEdge(player.teamId)
        : (leftRaw as SznEdgeId);
    const right: SznEdgeId | null = !szn
      ? null
      : rightRaw === "team-logo"
        ? teamLogoEdge(player.teamId)
        : (rightRaw as SznEdgeId);
    return {
      label: player.name,
      subtitle: subtitleParts.join(" · "),
      description: szn ? player.flavor : undefined,
      value: szn ? player.baseScoreCommon : undefined,
      leftEdge: left && left in SZN_EDGES ? left : null,
      rightEdge: right && right in SZN_EDGES ? right : null,
    };
  })();
  useSznGamepad({
    id: "player-market-view",
    priority: 100,
    enabled: true,
    handler: (btn) => {
      if (btn === "DPAD_LEFT" || btn === "DPAD_UP") focusHelpers.prev();
      else if (btn === "DPAD_RIGHT" || btn === "DPAD_DOWN") focusHelpers.next();
      else if (btn === "CROSS") {
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
          // Hard cap matching `buyPlayerFromMarket` — once the roster
          // is at STARTER_PACK_TOTAL (9 batters + 1 pitcher = 10), no
          // new signings are possible until the user sells. The store
          // gate refuses the buy; the badge tells the user why.
          const rosterFull = (run?.roster.length ?? 0) >= STARTER_PACK_TOTAL;
          const disabled = owned || rosterFull || cash < listing.price;
          const badge = owned
            ? "OWNED"
            : rosterFull
              ? "ROSTER FULL"
              : null;
          const badgeClass = owned
            ? "bg-emerald-700"
            : rosterFull
              ? "bg-rose-700"
              : "bg-slate-800";
          const focused = focusIdx === i;
          // Edge resolution mirrors the focus overlay derivation
          // below + `SznFooterDecks.rosterToFooterCard`: SZN players
          // render their printed left/right edge with `team-logo`
          // resolved to the franchise logo; legacy MlbPlayers pass
          // null/null so the footer-style card just omits the halves.
          const szn = isSznPlayer(player);
          const leftRaw = szn ? player.leftEdge : null;
          const rightRaw = szn ? player.rightEdge : null;
          const leftEdge: SznEdgeId | null = !szn
            ? null
            : leftRaw === "team-logo"
              ? teamLogoEdge(player.teamId)
              : (leftRaw as SznEdgeId);
          const rightEdge: SznEdgeId | null = !szn
            ? null
            : rightRaw === "team-logo"
              ? teamLogoEdge(player.teamId)
              : (rightRaw as SznEdgeId);
          const value = szn ? player.baseScoreCommon : 0;
          return (
            <div
              key={listing.listingId}
              className="flex flex-col items-center gap-3"
              title={
                rosterFull && !owned
                  ? "Sell a player from the deck footer first."
                  : undefined
              }
            >
              <FooterStylePlayerCard
                name={player.name}
                role={player.role}
                value={value}
                leftEdge={leftEdge && leftEdge in SZN_EDGES ? leftEdge : null}
                rightEdge={
                  rightEdge && rightEdge in SZN_EDGES ? rightEdge : null
                }
                focused={focused}
                disabled={disabled}
                badge={badge}
                badgeClass={badgeClass}
                onHover={() => setFocusIdx(i)}
                onPick={() => handleSign(i)}
                ariaLabel={`Sign ${player.name}`}
              />
              {/* Price chip below the card -- same shape and tint as
                  the merchant listings so the Free Agency stand reads
                  as the player-flavored sibling of the merchant
                  view. Owned / Roster Full listings collapse the
                  chip to a state-colored placeholder so the user
                  doesn't see a misleading dollar sign on a tile
                  they can't actually buy. */}
              <div
                className={`mt-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-black text-base shadow-md ${
                  owned
                    ? "bg-emerald-700 text-white"
                    : rosterFull
                      ? "bg-rose-700 text-white"
                      : disabled
                        ? "bg-slate-800 text-slate-500"
                        : "bg-amber-500 text-slate-900"
                }`}
              >
                {badge ? (
                  badge
                ) : (
                  <>
                    <DollarSign className="w-4 h-4" />
                    {listing.price}
                  </>
                )}
              </div>
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
