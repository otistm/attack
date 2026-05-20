/**
 * SeriesIntroScreen — the splash before the weekend Game of the Week.
 * Reads like a national-broadcast tale-of-the-tape: the two starters
 * face-to-face and a big "Play Ball" CTA. The weekend is a SINGLE
 * game (no more Bo3 series tally), so no per-side series score chip
 * — the only thing at stake is the one game we're about to play.
 *
 * We deliberately do NOT spoil the ghost lineup -- the user gets to
 * know their opponent through the live at-bats.
 *
 * The starter cards render in the same compact, role-tinted footprint
 * the persistent `SznFooterDecks` rail uses (via
 * `FooterStylePlayerCard`) so the user sees the SAME card visual on
 * the marquee that they've been managing in the bottom rail all
 * week. Edge resolution mirrors the footer (overrides win, then the
 * printed edge, with `team-logo` synthetics resolving to the player's
 * franchise logo) so a Wildcard Sticker applied during the week
 * shows up here too.
 */

import { motion } from "motion/react";
import { Trophy, Ghost as GhostIcon } from "lucide-react";
import { useGameStore } from "../lib/gameStore";
import { FooterStylePlayerCard } from "./FooterStylePlayerCard";
import { useSznGamepad } from "../lib/useSznGamepad";
import { RARITY_BASE_VALUE, type RosterPlayer } from "../lib/run";
import { isSznPlayer } from "../lib/sznPlayers";
import { teamLogoEdge } from "../lib/sznTeams";
import type { SznEdgeId } from "../lib/sznEdges";

/**
 * Resolve a roster slot into the {value, leftEdge, rightEdge} the
 * FooterStylePlayerCard expects. Mirrors `rosterToFooterCard` inside
 * `SznFooterDecks` so the marquee card matches the bottom-rail chip
 * pixel-for-pixel: rarity base + permanent boost + score override for
 * the big number, plus override-aware edges with `team-logo` resolved
 * to the player's franchise logo.
 */
function footerCardPropsFor(rp: RosterPlayer): {
  value: number;
  leftEdge: SznEdgeId | null;
  rightEdge: SznEdgeId | null;
  teamCode: string | null;
} {
  const value =
    RARITY_BASE_VALUE[rp.rarity] +
    (rp.permanentBoost ?? 0) +
    (rp.scoreOverride ?? 0);
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
  // Team code lets the FooterStylePlayerCard paint with the team
  // palette so the marquee starter cards match the in-combat
  // `PlayerCard` and the persistent footer rail exactly. SZN players
  // use `teamId`; legacy MLB players use `team`. Mirrors the lookup
  // in `SznFooterDecks.rosterToFooterCard`.
  const teamCode = isSznPlayer(rp.player) ? rp.player.teamId : rp.player.team;
  return { value, leftEdge, rightEdge, teamCode: teamCode ?? null };
}

export function SeriesIntroScreen() {
  const run = useGameStore((s) => s.run);
  const userTeam = useGameStore((s) => s.userTeam);
  const startSeries = useGameStore((s) => s.startSeries);
  const visible =
    !!run && run.day === "series" && !!run.series && !!run.ghost &&
    !run.series.gameInProgress;
  // CROSS = Play Ball. Priority 20 so the footer (0) can't accidentally
  // steal the press, but anything modal (≥100) still wins.
  useSznGamepad({
    id: "series-intro-screen",
    priority: 20,
    enabled: visible,
    handler: (btn) => {
      if (btn === "CROSS") startSeries();
    },
  });
  if (!run || run.day !== "series" || !run.series || !run.ghost) return null;
  const ghost = run.ghost;

  // Tonight's tale-of-the-tape: who is at the plate and who is on the
  // mound. Derived from `userTeam` — the user bats first when AWAY
  // (top of the 1st), which means the user's lead-off batter is in
  // the box and the GHOST starting pitcher is on the mound for the
  // opening at-bat. Mirror that when the user is HOME.
  //
  // Previously this screen labeled the USER's starting pitcher as
  // "Starting Pitcher" regardless of which team was batting first, so
  // a HOME user (who is pitching first) saw their batter card in the
  // pitcher slot, and an AWAY user (batting first) saw their pitcher
  // card with no batter callout for the opening at-bat.
  const userIsAway = userTeam === "AWAY";
  // The seat-that-owns-the-mound for the first at-bat is the HOME side.
  const userOnMoundFirst = !userIsAway;
  const userPitcher =
    run.roster.find((r) => r.player.role === "Pitcher") ?? run.roster[0];
  const userBatter =
    run.roster.find((r) => r.player.role === "Batter") ?? run.roster[0];
  const ghostPitcher =
    ghost.roster.find((r) => r.player.role === "Pitcher") ?? ghost.roster[0];
  const ghostBatter =
    ghost.roster.find((r) => r.player.role === "Batter") ?? ghost.roster[0];

  const userStarter = userOnMoundFirst ? userPitcher : userBatter;
  const userSublabel = userOnMoundFirst
    ? "Starting Pitcher"
    : "Tonight's Leadoff";
  const ghostStarter = userOnMoundFirst ? ghostBatter : ghostPitcher;
  const ghostSublabel = userOnMoundFirst
    ? "Tonight's Leadoff"
    : "Ghost Ace";

  if (!userStarter || !ghostStarter) return null;

  return (
    <motion.div
      key="series-intro"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center px-4 dugout-font-base text-white pointer-events-auto overflow-hidden"
    >
      {/* Solid dark backdrop -- the screen used to be transparent over
          whatever was rendered underneath (Front Office grid, footer
          rail) which made the tale-of-the-tape look like a floating
          modal instead of the marquee "we are now in a series" beat
          it was designed to be. Painting a near-opaque slate layer
          isolates the matchup visually so the eye lands on the two
          starter cards. The radial-gradient atmospheric layer sits
          ON TOP of the dark backdrop so the green/purple shafts of
          light still tint the scene. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-slate-950/95 pointer-events-none"
      />
      {/* Atmospheric backdrop -- twin diagonal shafts of light, one
          per side, themed to the series tension. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 20% 50%, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0) 45%), radial-gradient(circle at 80% 50%, rgba(168,85,247,0.18) 0%, rgba(168,85,247,0) 45%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 max-w-5xl w-full">
        {/* Header */}
        <div className="text-center">
          <motion.span
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-[11px] uppercase tracking-[0.45em] text-amber-300 font-black block"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
          >
            Week {run.week} · Weekend Series
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="dugout-font-sport text-4xl sm:text-6xl uppercase tracking-widest text-white mt-2"
            style={{ textShadow: "0 4px 18px rgba(0,0,0,0.8)" }}
          >
            Game of the Week
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-sm text-slate-300 mt-1"
            style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
          >
            {userOnMoundFirst
              ? "You take the mound first"
              : "You step to the plate first"}
          </motion.p>
        </div>

        {/* Tale of the tape: user starter vs ghost starter. Cards are
            the same `FooterStylePlayerCard` chips the persistent
            `SznFooterDecks` rail paints, so the marquee references
            the same visual the user has been managing all week. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-8 w-full">
          <StarterPanel
            label="You"
            sublabel={userSublabel}
            icon={<Trophy className="w-5 h-5 text-amber-300" />}
            tone="amber"
          >
            <motion.div
              initial={{ x: -40, opacity: 0, rotateY: -25 }}
              animate={{ x: 0, opacity: 1, rotateY: 0 }}
              transition={{ delay: 0.25, type: "spring", stiffness: 240, damping: 22 }}
            >
              {(() => {
                const props = footerCardPropsFor(userStarter);
                return (
                  <FooterStylePlayerCard
                    name={userStarter.player.name}
                    role={userStarter.player.role}
                    value={props.value}
                    leftEdge={props.leftEdge}
                    rightEdge={props.rightEdge}
                    teamCode={props.teamCode}
                    ariaLabel={`Your starter ${userStarter.player.name}`}
                  />
                );
              })()}
            </motion.div>
          </StarterPanel>

          <motion.div
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              delay: 0.4,
              type: "spring",
              stiffness: 220,
              damping: 14,
            }}
            className="flex items-center justify-center"
          >
            <span
              className="dugout-font-sport text-6xl sm:text-8xl text-white/90 select-none"
              style={{
                textShadow: "0 0 18px rgba(251,191,36,0.55), 0 4px 12px rgba(0,0,0,0.8)",
              }}
            >
              VS
            </span>
          </motion.div>

          <StarterPanel
            label={ghost.label}
            sublabel={ghostSublabel}
            icon={<GhostIcon className="w-5 h-5 text-purple-300" />}
            tone="purple"
          >
            <motion.div
              initial={{ x: 40, opacity: 0, rotateY: 25 }}
              animate={{ x: 0, opacity: 1, rotateY: 0 }}
              transition={{ delay: 0.25, type: "spring", stiffness: 240, damping: 22 }}
            >
              {(() => {
                const props = footerCardPropsFor(ghostStarter);
                return (
                  <FooterStylePlayerCard
                    name={ghostStarter.player.name}
                    role={ghostStarter.player.role}
                    value={props.value}
                    leftEdge={props.leftEdge}
                    rightEdge={props.rightEdge}
                    teamCode={props.teamCode}
                    ariaLabel={`Opponent starter ${ghostStarter.player.name}`}
                  />
                );
              })()}
            </motion.div>
          </StarterPanel>
        </div>

        {/* CTA */}
        {run.mlbScoutingIntel && (
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-400/50 bg-cyan-900/40 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.35)] max-w-2xl text-center"
            title="Faded Scouting Report"
          >
            <span aria-hidden className="text-base">🔎</span>
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wide">
              {run.mlbScoutingIntel}
            </span>
          </motion.div>
        )}

        <motion.button
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.55 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          type="button"
          onClick={() => startSeries()}
          className="px-10 py-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-[0.35em] dugout-font-sport text-lg shadow-[0_0_40px_rgba(16,185,129,0.55)]"
        >
          Play Ball
        </motion.button>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-[10px] uppercase tracking-[0.4em] text-slate-500"
        >
          Win the game, move the run record one game closer to the pennant
        </motion.p>
      </div>
    </motion.div>
  );
}

function StarterPanel({
  label,
  sublabel,
  icon,
  tone,
  children,
}: {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  tone: "amber" | "purple";
  children: React.ReactNode;
}) {
  // Pre-baked literal class strings: Tailwind v4's JIT scanner only
  // emits classes it can see verbatim in the source, so building
  // `${accent.text}/80` at runtime previously generated zero CSS for
  // the sublabel. Both color-stop variants are spelled out below.
  //
  // The per-side "series" tally readout (e.g. "2") was removed when
  // the weekend collapsed from a Bo3 series into a single Game of
  // the Week — there's nothing to count between two halves of one
  // game, and the run-level W/L lives in the persistent `RunHud`
  // strip above.
  const accent =
    tone === "amber"
      ? {
          ring: "ring-amber-400/40",
          bg: "from-amber-900/40 to-slate-950/0",
          text: "text-amber-200",
          textDim: "text-amber-200/80",
        }
      : {
          ring: "ring-purple-400/40",
          bg: "from-purple-900/40 to-slate-950/0",
          text: "text-purple-200",
          textDim: "text-purple-200/80",
        };
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-b ${accent.bg} ring-1 ${accent.ring}`}
      >
        {icon}
        <span
          className={`text-xs uppercase tracking-widest font-bold ${accent.text}`}
        >
          {label}
        </span>
      </div>
      <span
        className={`text-[9px] uppercase tracking-[0.4em] ${accent.textDim}`}
        style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}
      >
        {sublabel}
      </span>
      {children}
    </div>
  );
}
