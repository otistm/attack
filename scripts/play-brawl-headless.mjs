// Polyfill `window` because gameStore uses window.setTimeout in completeReveal.
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

// Headless brawl player + auditor.
//
// Imports the actual Zustand store + scoring engine via Vite's TS module
// resolution (run with `tsx` so the project's tsconfig path mappings apply).
// Runs N full 3-inning brawls and emits a transcript plus mechanic-coverage
// stats. The user side ALWAYS plays optimally (uses the existing brawl AI
// optimizer inverted on its own hand); the opponent uses the same optimizer
// already wired into the store. The match is the cleanest possible "best
// snap vs best snap" baseline -- anything that feels degenerate at this
// level is a design-time concern, not a player-skill concern.
//
// Side effects: none on the running app (this script is process-local).
// Output: stdout transcript + JSON summary.

import { useGameStore } from "../src/lib/gameStore.ts";
import { scoreHand, resolveBrawlOutcome } from "../src/lib/scoring.ts";
import { canConnectAny, seamKey } from "../src/lib/connect.ts";

const TEAM = "AWAY";
const GAMES = Number(process.argv[2] ?? 12);

// Mirror gameStore.scoreHandFor for an arbitrary candidate hand+seams so
// the optimizer can probe permutations without mutating the store.
function probeFactory(side) {
  return (hand, seams) => {
    const s = useGameStore.getState();
    const ctx = {
      side,
      inning: s.inning,
      isFirstAtBatOfInning: s.isFirstAtBatOfInning,
      outs: s.outs,
      isFinalInning: s.inning === s.totalInnings,
      batterHandedness: s.batter.handedness,
      pitcherHandedness: s.pitcher.handedness,
      opponentHand: side === "Batting" ? s.pitcherHand : s.batterHand,
      opponentBaseCard:
        (side === "Batting" ? s.pitcherHand : s.batterHand).reduce(
          (h, c) => (!h || c.baseValue > h.baseValue ? c : h),
          null,
        ),
      coinFlips: s.coinFlips,
      bases: s.bases,
      half: s.half,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      affirmedSeams: seams,
      opponentAffirmedSeams: null,
      gameMode: "brawl",
    };
    const result = scoreHand(hand, ctx);
    const opp = scoreHand(side === "Batting" ? s.pitcherHand : s.batterHand, {
      ...ctx,
      side: side === "Batting" ? "Pitching" : "Batting",
      opponentHand: hand,
      opponentBaseCard: hand.reduce(
        (h, c) => (!h || c.baseValue > h.baseValue ? c : h),
        null,
      ),
      affirmedSeams: null,
      opponentAffirmedSeams: seams,
    });
    return side === "Batting"
      ? { batterDisplay: result.maxValue, pitcherDisplay: opp.maxValue }
      : { batterDisplay: opp.maxValue, pitcherDisplay: result.maxValue };
  };
}

function userSide(s) {
  const battingTeam = s.half === "top" ? "AWAY" : "HOME";
  return battingTeam === s.userTeam ? "Batting" : "Pitching";
}

function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    const tail = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const rest of permutations(tail)) out.push([head, ...rest]);
  }
  return out;
}

function seamSubsets(hand) {
  const keys = [];
  for (let i = 1; i < hand.length; i++) {
    if (canConnectAny(hand[i - 1], hand[i])) keys.push(seamKey(hand[i - 1].id, hand[i].id));
  }
  if (keys.length === 0) return [new Set()];
  const out = [];
  const total = 1 << keys.length;
  for (let mask = 0; mask < total; mask++) {
    const set = new Set();
    for (let bit = 0; bit < keys.length; bit++) {
      if (mask & (1 << bit)) set.add(keys[bit]);
    }
    out.push(set);
  }
  return out;
}

// Convert a brawl `outcome` into the number of runs the user scores
// given the current `bases` array `[1B, 2B, 3B]`. The engine's
// actual base advancement is a tick more nuanced (e.g. forced
// advances on walks, runner-by-runner sequencing), but for an
// optimizer tie-break this matches the common-case bat result
// closely enough to bias picks toward situational power.
//
// Without this, `snapOptimal` treats "single with bases loaded" the
// same as "single with bases empty" — both score `winnerHP * 10` on
// the score column. The runner conversion fold-in raises the value
// of an at-bat that ACTUALLY CASHES IN runners, so the sim's user
// stops trading a bases-loaded single for an empty-base homerun on
// the same hand of cards.
function estimateRunsForOutcome(outcome, bases) {
  const [r1, r2, r3] = bases;
  switch (outcome) {
    case "out":
      return 0;
    case "single":
      // runners advance 1; the runner on 3rd scores.
      return r3 ? 1 : 0;
    case "double":
      // runners advance 2; 3rd + 2nd score, 1st advances to 3rd.
      return (r3 ? 1 : 0) + (r2 ? 1 : 0);
    case "triple":
      // every runner scores; batter ends on 3rd.
      return (r1 ? 1 : 0) + (r2 ? 1 : 0) + (r3 ? 1 : 0);
    case "homerun":
      // batter + all runners score.
      return 1 + (r1 ? 1 : 0) + (r2 ? 1 : 0) + (r3 ? 1 : 0);
    default:
      return 0;
  }
}

// Optimize the USER's hand for their OWN benefit. (The shipped
// `optimizeBrawlOpponentHand` is wired to maximize OPPONENT advantage --
// using it on the user's hand inverts the optimization and sabotages
// the player. This is the symmetric counterpart.)
function snapOptimal(state) {
  const side = userSide(state);
  const myHand = side === "Batting" ? state.batterHand : state.pitcherHand;
  const probe = probeFactory(side);
  const bases = state.bases;
  let best = { hand: myHand, seams: new Set(), score: -Infinity };
  for (const order of permutations(myHand)) {
    for (const seams of seamSubsets(order)) {
      const { batterDisplay, pitcherDisplay } = probe(order, seams);
      const res = resolveBrawlOutcome(batterDisplay, pitcherDisplay);
      const userWon = side === "Batting" ? res.batterWon : !res.batterWon;
      const userHP = side === "Batting" ? res.batterRemainingHP : res.pitcherRemainingHP;
      const oppHP = side === "Batting" ? res.pitcherRemainingHP : res.batterRemainingHP;
      // Higher = better for user: win first, then RUNS-SCORED on this
      // at-bat (the runner-conversion fold), then HP margin, then hit
      // type as a final tie-break. Runs are weighted strongly because
      // brawl is ultimately won on the scoreboard, not on HP swings.
      let s = 0;
      if (userWon) s += 1_000_000;
      const runs =
        side === "Batting" && userWon
          ? estimateRunsForOutcome(res.outcome, bases)
          : 0;
      s += runs * 10_000;
      s += (userHP - oppHP) * 1000;
      if (side === "Batting" && userWon) {
        s += res.winnerHP * 10;
        if (res.grandSlam) s += 500;
      }
      if (s > best.score) best = { hand: order, seams, score: s };
    }
  }
  const reorder =
    side === "Batting"
      ? useGameStore.getState().reorderBatterHand
      : useGameStore.getState().reorderPitcherHand;
  reorder([...best.hand]);
  useGameStore.setState({ affirmedSeams: new Set(best.seams) });
  return { hand: best.hand, affirmedSeams: best.seams };
}

function summarizeHand(hand, seams) {
  const ids = hand.map((c) => c.id).join("→");
  const seamCount = seams instanceof Set ? seams.size : seams.size ?? 0;
  return `${ids} [seams=${seamCount}]`;
}

// Simulated player "think time" in ms. Defaults to 9000 (≈9s) so the
// snap-speed HP bonus tiers (≥10s = +4, ≥5s = +2) read as +2 most of
// the time -- realistic for a thinking player. Override with the 2nd
// CLI arg to model a snap-locker (e.g. 1000) or a deliberate player
// (e.g. 14000 to force the timer to auto-lock without a bonus).
const SIM_THINK_MS = Number(process.argv[3] ?? 9000);

function flushAtBat(transcript) {
  const before = useGameStore.getState();
  const snap = snapOptimal(before);
  const sideAtSnap = userSide(before);
  // Mirror the live game's 2.5s-cadence AI re-plan: after the user
  // reorders cards, the brawl AI has SEEN the new layout and has a
  // chance to optimize against it BEFORE lockIn freezes its plan.
  // Without this call the AI's plan stays anchored to the deal order
  // and the sim grossly underestimates how good the AI is in practice.
  useGameStore.getState().prepareBrawlOpponent();
  // Simulate the player taking SIM_THINK_MS to lock by rewinding the
  // snap-start anchor before invoking lockIn. The bonus reads
  // (Date.now() - brawlSnapStartedAt) so we just push the anchor back
  // SIM_THINK_MS milliseconds.
  const snapStart = useGameStore.getState().brawlSnapStartedAt;
  if (snapStart != null) {
    useGameStore.setState({ brawlSnapStartedAt: snapStart - SIM_THINK_MS });
  }
  const preview = useGameStore.getState().previewMatchup();
  useGameStore.getState().lockIn();
  // Drain the reveal phase synchronously; the brawl orchestrator drives
  // animation timers, but the store has the final outcome the moment
  // lockIn finishes (lastBrawlResolution + lastOutcome).
  const post = useGameStore.getState();
  // Force-complete the reveal so the next at-bat can be dealt; in headless
  // we don't need the animation cascade.
  if (post.phase === "revealing") {
    useGameStore.getState().completeReveal();
  }
  const after = useGameStore.getState();
  transcript.push({
    inning: before.inning,
    half: before.half,
    userSide: sideAtSnap,
    userHand: summarizeHand(snap.hand, snap.affirmedSeams),
    aiHand: summarizeHand(
      sideAtSnap === "Batting" ? after.pitcherHand : after.batterHand,
      sideAtSnap === "Batting" ? after.brawlOpponentSeams : after.brawlOpponentSeams,
    ),
    preview: `B:${preview.batterDisplay ?? preview.batterTotal} vs P:${preview.pitcherDisplay ?? preview.pitcherTotal}`,
    outcome: after.lastOutcome,
    brawl: after.lastBrawlResolution
      ? `B-HP=${after.lastBrawlResolution.batterRemainingHP} P-HP=${after.lastBrawlResolution.pitcherRemainingHP} winnerHP=${after.lastBrawlResolution.winnerHP}`
      : "—",
    score: `${after.awayScore}-${after.homeScore}`,
    msg: after.lastResultMessage,
  });
  // Advance past `between-at-bats` to the next selecting phase. brawl's
  // auto-deal path uses setTimeout, so in headless we fall back to
  // startNextAtBat directly.
  if (after.phase === "between-at-bats" && (after.phase !== "game-over")) {
    useGameStore.getState().startNextAtBat?.();
  }
}

// Brawl drafts (innings 2 and 3 only) are resolved inline when
// `startNextAtBat` opens the picker. In the live
// UI the user picks deliberately; in the sim a random pick is good
// enough -- we're validating that the mechanic + downstream deal-flow
// stays healthy, not that the AI plays the draft optimally.

const summary = {
  games: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  outcomes: {},
  unhandledChoices: 0,
  cardAppearances: {},
  shortHands: 0,        // hands dealt with !=5 cards (deal effects collapsing the hand)
  inningsReached: {},   // distribution of max inning reached in each game
  safetyHits: 0,        // games that hit the 80-atbat safety cap
  atBatsPerGame: [],    // distribution of total at-bats per game
  draftPicks: {},       // count of each card ID picked at the per-inning draft
  draftedInnings: 0,    // total drafts resolved (sanity: should be 2 × games)
};

for (let g = 0; g < GAMES; g++) {
  useGameStore.getState().startBrawl(TEAM);
  const transcript = [];
  let safety = 0;
  let maxInning = 1;
  while (
    useGameStore.getState().phase !== "game-over" &&
    safety < 80
  ) {
    const s = useGameStore.getState();
    // Innings 2–3 draft fires inside `startNextAtBat`. Resolve
    // before reading the hand so the user pool already includes the
    // new card for downstream deals (the deal itself happens BEFORE
    // the draft, so the new card affects subsequent at-bats this
    // inning -- same as the live UI).
    if (s.brawlDraftChoice) {
      const pick = s.brawlDraftChoice.cardIds[
        Math.floor(Math.random() * s.brawlDraftChoice.cardIds.length)
      ];
      summary.draftPicks[pick] = (summary.draftPicks[pick] || 0) + 1;
      useGameStore.getState().selectBrawlDraftCard(pick);
      summary.draftedInnings++;
    }
    maxInning = Math.max(maxInning, s.inning);
    if (s.phase === "selecting") {
      if (s.batterHand.length !== 5) summary.shortHands++;
      if (s.pitcherHand.length !== 5) summary.shortHands++;
      // Track which cards appeared this snap
      for (const c of [...s.batterHand, ...s.pitcherHand]) {
        summary.cardAppearances[c.id] = (summary.cardAppearances[c.id] || 0) + 1;
      }
      if (s.pendingChoices.length > 0) {
        summary.unhandledChoices++;
        console.log("[unhandled choice]", s.pendingChoices.map(c => `${c.cardId} (${c.type})`).join(", "), "in batter:", s.batterHand.map(c => c.id), "pitcher:", s.pitcherHand.map(c => c.id));
      }
      flushAtBat(transcript);
    } else if (s.phase === "revealing") {
      useGameStore.getState().completeReveal();
    } else if (s.phase === "between-at-bats") {
      useGameStore.getState().startNextAtBat?.();
    } else {
      break;
    }
    safety++;
  }
  summary.atBatsPerGame.push(transcript.length);
  summary.inningsReached[maxInning] = (summary.inningsReached[maxInning] || 0) + 1;
  if (safety >= 80) summary.safetyHits++;
  const final = useGameStore.getState();
  const userIsHome = TEAM === "HOME";
  const userScore = userIsHome ? final.homeScore : final.awayScore;
  const oppScore = userIsHome ? final.awayScore : final.homeScore;
  summary.games++;
  if (userScore > oppScore) summary.wins++;
  else if (userScore < oppScore) summary.losses++;
  else summary.ties++;
  for (const beat of transcript) {
    const o = beat.outcome;
    if (o) summary.outcomes[o] = (summary.outcomes[o] || 0) + 1;
  }
  if (g < 3) {
    console.log(`\n=== Game ${g + 1} === final ${userScore}-${oppScore} (${userScore > oppScore ? "WIN" : userScore < oppScore ? "LOSS" : "TIE"}) safety=${safety}`);
    for (const beat of transcript) {
      console.log(
        `  I${beat.inning}/${beat.half[0]} ${beat.userSide.padEnd(8)} ${beat.outcome?.padEnd(10) || "?"} ${beat.brawl} score=${beat.score}`,
      );
      console.log(`    user: ${beat.userHand}`);
      console.log(`    ai  : ${beat.aiHand}`);
    }
  }
}

console.log("\n========== SUMMARY ==========");
console.log(`Games: ${summary.games}  Wins: ${summary.wins}  Losses: ${summary.losses}  Ties: ${summary.ties}`);
console.log(`Outcome distribution:`, summary.outcomes);
console.log(`Unhandled choices during snap (should be 0):`, summary.unhandledChoices);
console.log(`Short hands (≠5 cards) observed:`, summary.shortHands);
console.log(`Games hitting 80-atbat safety cap (should be 0):`, summary.safetyHits);
console.log(`Innings reached distribution:`, summary.inningsReached);
console.log(`At-bats per game (avg/min/max):`, {
  avg: (summary.atBatsPerGame.reduce((a, b) => a + b, 0) / summary.atBatsPerGame.length).toFixed(1),
  min: Math.min(...summary.atBatsPerGame),
  max: Math.max(...summary.atBatsPerGame),
});
const top = Object.entries(summary.cardAppearances)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
console.log(`Top appearing cards (id, # appearances):`, top);
console.log(
  `Brawl drafts resolved: ${summary.draftedInnings} (expected ~${summary.games * 2})`,
);
const topPicks = Object.entries(summary.draftPicks)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
console.log(`Top drafted cards (id, # times picked):`, topPicks);
