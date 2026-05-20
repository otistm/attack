/**
 * PlayerHero -- left-rail hero panel for the live batter and pitcher.
 *
 * Renders the player using the shared `PlayerCard` so the at-bat hero
 * carries the same team-colored card identity used everywhere else in
 * SZN Mode (pack-rip, merchants, deck footer, lineup strip). The
 * playtest-derived rules from the previous Topps-image cut still apply:
 * pulse on value change, color-tint by delta sign, treat player identity
 * change as a fresh entry tween.
 */
import { useEffect, useRef } from "react";
import { motion, useAnimationControls } from "motion/react";
import type { MlbPlayer } from "../lib/players";
import type { SznPlayer } from "../lib/sznPlayers";
import { PlayerCard } from "./PlayerCard";
import { useGameStore } from "../lib/gameStore";
import type { Rarity } from "../lib/run";

interface PlayerHeroProps {
  player: MlbPlayer | SznPlayer;
  /**
   * Live displayed total. `null` means "fog of war" (e.g., AI selecting in
   * secret) and renders the readout as `?` without triggering a pulse.
   */
  value: number | null;
  role: "BATTER" | "PITCHER";
  /**
   * Mirrors the existing ScorePill fog-of-war: while the AI is selecting,
   * their identity stays visible (player card) but their total is hidden.
   */
  dimmed?: boolean;
  /** When false, omit the large total beside the card (pill-only readout). */
  showTotalBesideCard?: boolean;
}

const ENTRY_DELAY_BY_ROLE: Record<"BATTER" | "PITCHER", number> = {
  PITCHER: 0,
  BATTER: 0.08,
};
const ENTRY_DURATION = 0.4;
const ENTRY_X_OFFSET = -64;

export function PlayerHero({
  player,
  value,
  role,
  dimmed = false,
  showTotalBesideCard = true,
}: PlayerHeroProps) {
  const cardControls = useAnimationControls();
  const numberControls = useAnimationControls();

  // Pull the SZN rarity for this player when in a run, so the team-colored
  // card shows the correct rarity badge (Common / All Star / Veteran / Legend).
  // Outside a run, defaults to common.
  const rarity = useGameStore((s) => {
    if (s.gameMode !== "szn" || !s.run) return "common" as Rarity;
    const slot = s.run.roster.find((r) => r.player.id === player.id);
    return (slot?.rarity ?? "common") as Rarity;
  });

  const prevValueRef = useRef<number | null>(null);
  const prevPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevPlayerIdRef.current !== player.id) {
      prevPlayerIdRef.current = player.id;
      prevValueRef.current = value;
      const delay = ENTRY_DELAY_BY_ROLE[role];
      cardControls.start({
        x: [ENTRY_X_OFFSET, 0],
        opacity: [0, 1],
        scale: [0.88, 1],
        boxShadow: "0 10px 22px rgba(0,0,0,0.5)",
        transition: { duration: ENTRY_DURATION, ease: "easeOut", delay },
      });
      numberControls.start({
        x: [ENTRY_X_OFFSET / 2, 0],
        opacity: [0, 1],
        scale: [0.88, 1],
        color: "#ffffff",
        textShadow:
          "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        transition: {
          duration: ENTRY_DURATION,
          ease: "easeOut",
          delay: delay + 0.12,
        },
      });
      return;
    }

    const prev = prevValueRef.current;
    prevValueRef.current = value;

    if (value === null || prev === null || value === prev) return;

    const delta = value - prev;
    const cardMagnitude = Math.min(0.14, Math.max(0.04, Math.abs(delta) * 0.015));
    const numberMagnitude = Math.min(0.22, Math.max(0.06, Math.abs(delta) * 0.022));
    const flashColor = delta > 0 ? "#10b981" : "#f43f5e";

    cardControls.start({
      scale: [1, 1 + cardMagnitude, 1],
      boxShadow: [
        "0 10px 22px rgba(0,0,0,0.5)",
        `0 0 36px ${flashColor}, 0 0 14px ${flashColor}`,
        "0 10px 22px rgba(0,0,0,0.5)",
      ],
      transition: { duration: 0.55, ease: "easeOut" },
    });

    numberControls.start({
      scale: [1, 1 + numberMagnitude, 1],
      color: ["#ffffff", flashColor, "#ffffff"],
      textShadow: [
        "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
        `0 0 32px ${flashColor}, 0 0 14px ${flashColor}, 0 4px 14px rgba(0,0,0,0.7)`,
        "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
      ],
      transition: { duration: 0.55, ease: "easeOut" },
    });
  }, [value, player.id, role, cardControls, numberControls]);

  const showNumber = !dimmed && value !== null;

  return (
    <div className="flex items-center gap-4">
      <motion.div
        animate={cardControls}
        initial={{
          x: 0,
          opacity: 1,
          scale: 1,
          boxShadow: "0 10px 22px rgba(0,0,0,0.5)",
        }}
        className="relative"
      >
        {/* Sockets are off here -- the hero rail is the player's identity
            chip, not a chain target. The actual connection sockets show
            up on the lineup strip during a SZN at-bat. */}
        <PlayerCard player={player} rarity={rarity} hideValue showSockets={false} />
      </motion.div>

      {showTotalBesideCard ? (
        <motion.span
          animate={numberControls}
          initial={{
            x: 0,
            opacity: 1,
            scale: 1,
            color: "#ffffff",
            textShadow:
              "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
          }}
          className="inline-block font-black tabular-nums leading-none select-none"
          style={{
            fontSize: 110,
            letterSpacing: "-0.04em",
            color: "#ffffff",
            textShadow:
              "0 4px 14px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.6)",
          }}
        >
          {showNumber ? value : "?"}
        </motion.span>
      ) : null}
    </div>
  );
}
