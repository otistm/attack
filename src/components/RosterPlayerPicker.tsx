/**
 * RosterPlayerPicker — generic "pick a player from your roster" modal.
 *
 * Used by every encounter that needs to point at a specific player:
 *   - Wildcard Sticker / Swing Adjuster / Velocity Program (edge mutations)
 *   - Position Converter / Pro Batting Gloves / Pitcher's Toe Plate
 *   - City Connect Jersey / The Torch / Special Dirt
 *   - Suspend Instigators, Bet-a-Player wager, Clubhouse Prank step 1
 *
 * Optional `roleFilter` narrows the visible roster (e.g. Pitcher-only
 * for Velocity Program / Special Dirt). Cancel returns the encounter
 * to its choice list so the user can pick a different consequence.
 *
 * Card visual
 * -----------
 * Roster tiles render with the SAME compact, color-coded visual
 * vocabulary used by the `SznFooterDecks` rail at the bottom of the
 * screen -- big rarity-based score, role-tinted gradient (red for
 * batters / green for pitchers), full name label, and the same
 * `SznEdgeHalf` connectors poking out the sides. The user can scan
 * the picker, glance at the footer, and read both surfaces the same
 * way.
 *
 * Description panel
 * -----------------
 * Below the grid we mount an `EncounterFocusPanel` that mirrors the
 * focused-card detail used by `MerchantView` / `PlayerMarketView` /
 * `EventEncounterView`. As the gamepad or mouse moves between
 * candidates, the panel updates with the player's full name, team /
 * position / rarity subtitle, flavor / edge readout, and live score
 * so the user always has the full context for the player they're
 * about to commit to.
 */

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RARITY_BASE_VALUE, type RosterPlayer } from "../lib/run";
import { isSznPlayer } from "../lib/sznPlayers";
import { MLB_TEAMS, teamLogoEdge } from "../lib/sznTeams";
import { SZN_EDGES, type SznEdgeId } from "../lib/sznEdges";
import { FooterStylePlayerCard } from "./FooterStylePlayerCard";
import {
  EncounterFocusPanel,
  type EncounterFocusCardData,
} from "./EncounterFocusOverlay";
import { useSznGamepad } from "../lib/useSznGamepad";

export interface RosterPlayerPickerProps {
  open: boolean;
  roster: RosterPlayer[];
  /** Subset filter; when omitted, the entire roster is selectable. */
  roleFilter?: "Batter" | "Pitcher";
  /** Header copy (e.g. "Pick a Batter to receive +40 score"). */
  title?: string;
  prompt?: string;
  onPick: (playerId: string) => void;
  onCancel: () => void;
}

const RARITY_LABEL: Record<string, string> = {
  common: "Common",
  "all-star": "All-Star",
  veteran: "Veteran",
  legend: "Legend",
};

export function RosterPlayerPicker({
  open,
  roster,
  roleFilter,
  title = "Pick a Player",
  prompt,
  onPick,
  onCancel,
}: RosterPlayerPickerProps) {
  // Memoize the visible slice so focus indices stay stable when
  // unrelated store updates re-run the parent.
  const visible = useMemo<RosterPlayer[]>(() => {
    const base = roleFilter ? roster.filter((r) => r.player.role === roleFilter) : roster;
    // Same pitchers-first sort the release picker uses, for consistency.
    const pitchers = base.filter((r) => r.player.role === "Pitcher");
    const batters = base.filter((r) => r.player.role === "Batter");
    return [...pitchers, ...batters];
  }, [roster, roleFilter]);

  const [focusIdx, setFocusIdx] = useState(0);
  useEffect(() => {
    if (!open) return;
    setFocusIdx(0);
  }, [open, visible.length]);

  const tileRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  useEffect(() => {
    if (!open) return;
    const focused = visible[focusIdx];
    if (!focused) return;
    const el = tileRefs.current.get(focused.player.id);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open, visible, focusIdx]);

  useSznGamepad({
    id: "szn-player-picker",
    priority: 200,
    enabled: open,
    handler: (btn) => {
      if (!open) return;
      switch (btn) {
        case "CIRCLE":
          onCancel();
          return;
        case "DPAD_LEFT":
          setFocusIdx((i) => Math.max(0, i - 1));
          return;
        case "DPAD_RIGHT":
          setFocusIdx((i) => Math.min(visible.length - 1, i + 1));
          return;
        case "DPAD_UP":
          setFocusIdx((i) => Math.max(0, i - 5));
          return;
        case "DPAD_DOWN":
          setFocusIdx((i) => Math.min(visible.length - 1, i + 5));
          return;
        case "CROSS": {
          const focused = visible[focusIdx];
          if (focused) onPick(focused.player.id);
          return;
        }
      }
    },
  });

  // Derive the focused-player payload for the bottom detail panel.
  // Same shape used across all SZN encounter views so the readout
  // grammar stays identical (label, team/position subtitle, flavor
  // description, score value, edge chips).
  const focusedPlayer = visible[focusIdx] ?? null;
  const focusedDetail: EncounterFocusCardData | null = (() => {
    if (!focusedPlayer) return null;
    const rp = focusedPlayer;
    const subtitleParts: string[] = [];
    if (isSznPlayer(rp.player)) {
      const team = MLB_TEAMS[rp.player.teamId];
      if (team) subtitleParts.push(team.shortName);
      if (rp.player.position) subtitleParts.push(rp.player.position);
    } else {
      subtitleParts.push(rp.player.role);
    }
    subtitleParts.push(RARITY_LABEL[rp.rarity] ?? rp.rarity);
    let description: string | undefined;
    if (isSznPlayer(rp.player) && rp.player.flavor) {
      description = rp.player.flavor;
    } else if (isSznPlayer(rp.player)) {
      const left = SZN_EDGES[rp.player.leftEdge]?.label ?? rp.player.leftEdge;
      const right = SZN_EDGES[rp.player.rightEdge]?.label ?? rp.player.rightEdge;
      description = `${left} ← → ${right}`;
    }
    // Edge resolution mirrors `rosterToFooterCard` in SznFooterDecks
    // and `PlayerCard`: overrides first, then printed edges, with
    // `team-logo` synthetic resolving to the holder's real franchise
    // logo edge. Legacy MlbPlayer rosters lack edges -> null chips.
    let leftEdge: SznEdgeId | null = null;
    let rightEdge: SznEdgeId | null = null;
    if (isSznPlayer(rp.player)) {
      const leftRaw = (rp.leftEdgeOverride ?? rp.player.leftEdge) as SznEdgeId;
      const rightRaw = (rp.rightEdgeOverride ?? rp.player.rightEdge) as SznEdgeId;
      leftEdge =
        leftRaw === "team-logo" ? teamLogoEdge(rp.player.teamId) : leftRaw;
      rightEdge =
        rightRaw === "team-logo" ? teamLogoEdge(rp.player.teamId) : rightRaw;
    }
    return {
      label: rp.player.name,
      subtitle: subtitleParts.join(" · "),
      description,
      value:
        RARITY_BASE_VALUE[rp.rarity] +
        (rp.permanentBoost ?? 0) +
        (rp.scoreOverride ?? 0),
      leftEdge: leftEdge && leftEdge in SZN_EDGES ? leftEdge : null,
      rightEdge: rightEdge && rightEdge in SZN_EDGES ? rightEdge : null,
    };
  })();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="szn-player-picker"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-md flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <h1 className="dugout-font-sport text-2xl uppercase tracking-widest text-amber-200">
              {title}
            </h1>
            <div className="w-[80px]" />
          </header>

          {prompt && (
            <div className="px-6 pt-4 pb-2 text-center">
              <p className="text-sm text-slate-300">{prompt}</p>
            </div>
          )}

          {/* Roster is capped at STARTER_PACK_TOTAL (10) so the 5-col
              grid is at most 2 rows -- it fits without scrolling on
              any reasonable viewport. `overflow-hidden` kills the
              scrollbar so the picker reads as a clean modal rather
              than a scrollable list. */}
          <div className="flex-1 overflow-hidden px-4 sm:px-8 py-6">
            {visible.length === 0 ? (
              <div className="text-center text-sm text-slate-400 pt-8">
                No eligible players on the roster.
              </div>
            ) : (
              <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 place-items-center">
                {visible.map((rp, idx) => (
                  <PickerPlayerCard
                    key={rp.player.id}
                    rp={rp}
                    focused={idx === focusIdx}
                    tileRef={(el) => {
                      if (el) tileRefs.current.set(rp.player.id, el);
                      else tileRefs.current.delete(rp.player.id);
                    }}
                    onHover={() => setFocusIdx(idx)}
                    onPick={() => onPick(rp.player.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Bottom detail panel -- mirrors the encounter focused-card
              panel so the user reads the full player context (name,
              team/position/rarity subtitle, flavor, edges) without
              hunting through tiles. Replaces the previous "CROSS pick
              / CIRCLE cancel" keymap footer, which was redundant with
              the on-screen Back button + the always-on gamepad map. */}
          <footer className="border-t border-white/10 bg-slate-900/80 backdrop-blur-sm px-6 py-3">
            <div className="mx-auto max-w-3xl">
              <EncounterFocusPanel card={focusedDetail} variant="player" />
            </div>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------------
 * PickerPlayerCard
 *
 * Picker-specific wrapper around `FooterStylePlayerCard` -- handles
 * the RosterPlayer -> (name, role, value, edges) normalization
 * (rarity-aware score, encounter edge overrides, team-logo synthetic
 * resolution) and forwards the rest to the shared visual.
 * --------------------------------------------------------------------------- */
function PickerPlayerCard({
  rp,
  focused,
  tileRef,
  onHover,
  onPick,
}: {
  rp: RosterPlayer;
  focused: boolean;
  tileRef: (el: HTMLButtonElement | null) => void;
  onHover: () => void;
  onPick: () => void;
}) {
  const value =
    RARITY_BASE_VALUE[rp.rarity] +
    (rp.permanentBoost ?? 0) +
    (rp.scoreOverride ?? 0);

  // Edge resolution mirrors `SznFooterDecks.rosterToFooterCard` so
  // the picker card shows the SAME `SznEdgeHalf` halves the user
  // sees in the always-on bottom rail. Encounter overrides win;
  // `team-logo` synthetic resolves to the franchise logo edge.
  let leftEdge: SznEdgeId | null = null;
  let rightEdge: SznEdgeId | null = null;
  if (isSznPlayer(rp.player)) {
    const leftRaw = (rp.leftEdgeOverride ?? rp.player.leftEdge) as SznEdgeId;
    const rightRaw = (rp.rightEdgeOverride ?? rp.player.rightEdge) as SznEdgeId;
    leftEdge =
      leftRaw === "team-logo" ? teamLogoEdge(rp.player.teamId) : leftRaw;
    rightEdge =
      rightRaw === "team-logo" ? teamLogoEdge(rp.player.teamId) : rightRaw;
    if (leftEdge && !(leftEdge in SZN_EDGES)) leftEdge = null;
    if (rightEdge && !(rightEdge in SZN_EDGES)) rightEdge = null;
  }
  return (
    <FooterStylePlayerCard
      name={rp.player.name}
      role={rp.player.role}
      value={value}
      leftEdge={leftEdge}
      rightEdge={rightEdge}
      focused={focused}
      onHover={onHover}
      onPick={onPick}
      tileRef={tileRef}
    />
  );
}
