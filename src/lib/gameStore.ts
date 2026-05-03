import { create } from "zustand";
import { CardDefinition } from "./cards";
import { BATTERS, dealHand, MlbPlayer, PITCHERS } from "./players";
import { HitOutcome, resolveHitScale, scoreHand, ScoringContext, ScoringResult } from "./scoring";

export type Half = "top" | "bottom";
export type Phase = "selecting" | "resolving" | "between-at-bats" | "game-over";
export type Bases = [boolean, boolean, boolean]; // [1B, 2B, 3B]

/**
 * Logical slot a runner sits on. 'scored' means they crossed home and should
 * exit the field. Used to drive baserunning animations between at-bats.
 */
export type BaseSlot = "home" | "first" | "second" | "third" | "scored";

export interface RunnerMove {
  /** Stable id for the move – used as the React key for the animated runner. */
  id: string;
  from: BaseSlot;
  to: BaseSlot;
  /** 'batter' moves originate at home, 'runner' moves originate on a base. */
  kind: "batter" | "runner";
}

export interface GameState {
  // Clock state.
  inning: number;
  half: Half;
  outs: number;
  isFirstAtBatOfInning: boolean;
  totalInnings: number;

  // Score.
  homeScore: number;
  awayScore: number;
  bases: Bases;

  // Current at-bat.
  phase: Phase;
  batter: MlbPlayer;
  pitcher: MlbPlayer;
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  // Monotonic counter that increments every time a fresh at-bat is dealt.
  // Used as a stable key for hand strips so reordering within an at-bat does
  // not remount/redeal the cards.
  atBatId: number;

  // Last play summary, for animations / readouts.
  lastOutcome: HitOutcome | null;
  lastBatterScore: number;
  lastPitcherScore: number;
  lastResultMessage: string;
  /**
   * Per-runner movement list produced by the most recent at-bat. Drives the 3D
   * runner travel animation while the camera is zoomed out. Cleared at the
   * start of the next at-bat (and on reset).
   */
  runnerMoves: RunnerMove[];

  // Actions.
  reorderBatterHand: (cards: CardDefinition[]) => void;
  reorderPitcherHand: (cards: CardDefinition[]) => void;
  scoreBatter: () => ScoringResult;
  scorePitcher: () => ScoringResult;
  lockIn: () => void;
  startNextAtBat: () => void;
  reset: () => void;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function freshAtBat(): {
  batter: MlbPlayer;
  pitcher: MlbPlayer;
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
} {
  const batter = pickRandom(BATTERS);
  const pitcher = pickRandom(PITCHERS);
  return {
    batter,
    pitcher,
    batterHand: dealHand(batter),
    pitcherHand: dealHand(pitcher),
  };
}

const INITIAL_AT_BAT = freshAtBat();

export const useGameStore = create<GameState>((set, get) => ({
  inning: 1,
  half: "top",
  outs: 0,
  isFirstAtBatOfInning: true,
  totalInnings: 9,

  homeScore: 0,
  awayScore: 0,
  bases: [false, false, false],

  phase: "selecting",
  ...INITIAL_AT_BAT,
  atBatId: 1,

  lastOutcome: null,
  lastBatterScore: 0,
  lastPitcherScore: 0,
  lastResultMessage: "",
  runnerMoves: [],

  reorderBatterHand: (cards) => set({ batterHand: cards }),
  reorderPitcherHand: (cards) => set({ pitcherHand: cards }),

  scoreBatter: () => {
    const s = get();
    const ctx: ScoringContext = {
      side: "Batting",
      inning: s.inning,
      isFirstAtBatOfInning: s.isFirstAtBatOfInning,
      outs: s.outs,
      isFinalInning: s.inning === s.totalInnings,
      batterHandedness: s.batter.handedness,
      opponentHand: s.pitcherHand,
      opponentBaseCard: highestValueCard(s.pitcherHand),
    };
    return scoreHand(s.batterHand, ctx);
  },

  scorePitcher: () => {
    const s = get();
    const ctx: ScoringContext = {
      side: "Pitching",
      inning: s.inning,
      isFirstAtBatOfInning: s.isFirstAtBatOfInning,
      outs: s.outs,
      isFinalInning: s.inning === s.totalInnings,
      batterHandedness: s.batter.handedness,
      opponentHand: s.batterHand,
      opponentBaseCard: highestValueCard(s.batterHand),
    };
    return scoreHand(s.pitcherHand, ctx);
  },

  lockIn: () => {
    const s = get();
    if (s.phase !== "selecting") return;

    const batterResult = s.scoreBatter();
    const pitcherResult = s.scorePitcher();

    // Apply opponent modifiers to each side's total.
    const batterTotal = batterResult.maxValue + pitcherResult.opponentModifier;
    const pitcherTotal =
      pitcherResult.maxValue + batterResult.opponentModifier + batterResult.pitcherCombinedDelta;

    // Determine winner (with tie rules).
    const tiePitcher = batterResult.pitcherWinsTies || pitcherResult.pitcherWinsTies;
    const batterWins = batterTotal > pitcherTotal || (batterTotal === pitcherTotal && !tiePitcher);

    // Hit Scale uses the batter's effective score plus their Hit Scale bonus.
    let outcome: HitOutcome;
    if (batterResult.forcedOutcome) {
      outcome = batterResult.forcedOutcome;
    } else if (!batterWins) {
      outcome = "out";
    } else {
      outcome = resolveHitScale(batterTotal + batterResult.hitScaleBonus, batterResult.hitScaleTierShift);
    }

    // Apply outcome to bases / outs / score.
    const next = applyOutcome(s, outcome);
    const message = formatOutcome(outcome, batterTotal, pitcherTotal, s.batter.name);

    set({
      ...next,
      lastOutcome: outcome,
      lastBatterScore: batterTotal,
      lastPitcherScore: pitcherTotal,
      lastResultMessage: message,
      phase: next.phase,
      runnerMoves: next.runnerMoves,
    });
  },

  startNextAtBat: () => {
    const s = get();
    if (s.phase === "game-over") return;
    const ab = freshAtBat();
    set({
      ...ab,
      atBatId: s.atBatId + 1,
      phase: "selecting",
      lastOutcome: null,
      lastResultMessage: "",
      runnerMoves: [],
      // isFirstAtBatOfInning gets set to false after the first at-bat of the half.
      isFirstAtBatOfInning: false,
    });
  },

  reset: () => {
    const s = get();
    const ab = freshAtBat();
    set({
      inning: 1,
      half: "top",
      outs: 0,
      isFirstAtBatOfInning: true,
      homeScore: 0,
      awayScore: 0,
      bases: [false, false, false],
      phase: "selecting",
      ...ab,
      atBatId: s.atBatId + 1,
      lastOutcome: null,
      lastBatterScore: 0,
      lastPitcherScore: 0,
      lastResultMessage: "",
      runnerMoves: [],
    });
  },
}));

// ============ helpers ============

function highestValueCard(hand: CardDefinition[]): CardDefinition | null {
  if (!hand || hand.length === 0) return null;
  return hand.reduce((a, b) => (b.baseValue > a.baseValue ? b : a));
}

interface OutcomeApplyResult {
  inning: number;
  half: Half;
  outs: number;
  bases: Bases;
  homeScore: number;
  awayScore: number;
  isFirstAtBatOfInning: boolean;
  phase: Phase;
  runnerMoves: RunnerMove[];
}

const BASE_INDEX_TO_SLOT: BaseSlot[] = ["first", "second", "third", "scored"];

let _moveSeq = 0;
function nextMoveId(): string {
  _moveSeq += 1;
  return `m${_moveSeq}`;
}

function applyOutcome(s: GameState, outcome: HitOutcome): OutcomeApplyResult {
  let { inning, half, outs, homeScore, awayScore, totalInnings } = s;
  let bases: Bases = [...s.bases] as Bases;
  const runnerMoves: RunnerMove[] = [];

  // Advance runners by N bases. Returns the new bases array and runs scored,
  // and records each runner's logical journey so the 3D scene can animate it.
  const advance = (steps: number) => {
    let runs = 0;
    const newBases: boolean[] = [false, false, false, false]; // last slot = home (scoring)
    // Existing runners.
    for (let b = 0; b < 3; b++) {
      if (bases[b]) {
        const dest = b + 1 + steps;
        const fromSlot = BASE_INDEX_TO_SLOT[b]; // bases[0] = 1B, etc.
        const toSlot = dest >= 4 ? "scored" : BASE_INDEX_TO_SLOT[dest - 1];
        runnerMoves.push({ id: nextMoveId(), from: fromSlot, to: toSlot, kind: "runner" });
        if (dest >= 4) runs++;
        else newBases[dest] = true;
      }
    }
    // The batter takes their own bases.
    const batterDest = steps;
    if (batterDest === 0) {
      // Out path doesn't reach here (advance only called for hits).
    } else {
      const toSlot: BaseSlot = batterDest >= 4 ? "scored" : BASE_INDEX_TO_SLOT[batterDest - 1];
      runnerMoves.push({ id: nextMoveId(), from: "home", to: toSlot, kind: "batter" });
      if (batterDest >= 4) runs++;
      else newBases[batterDest] = true;
    }
    bases = [newBases[1], newBases[2], newBases[3]] as Bases;
    return runs;
  };

  let runs = 0;
  switch (outcome) {
    case "out":
      outs += 1;
      break;
    case "single":
      runs = advance(1);
      break;
    case "double":
      runs = advance(2);
      break;
    case "triple":
      runs = advance(3);
      break;
    case "homerun":
      runs = advance(4);
      break;
  }

  if (half === "top") awayScore += runs;
  else homeScore += runs;

  let isFirstAtBatOfInning = false;
  let phase: Phase = "between-at-bats";

  if (outs >= 3) {
    // Side retired; flip half-inning, reset outs/bases.
    outs = 0;
    bases = [false, false, false];
    isFirstAtBatOfInning = true;
    if (half === "top") {
      half = "bottom";
    } else {
      half = "top";
      inning += 1;
    }
    if (inning > totalInnings) {
      phase = "game-over";
    }
  }

  return { inning, half, outs, bases, homeScore, awayScore, isFirstAtBatOfInning, phase, runnerMoves };
}

function formatOutcome(outcome: HitOutcome, batter: number, pitcher: number, batterName: string): string {
  const score = `${batter} vs ${pitcher}`;
  switch (outcome) {
    case "out":
      return `${batterName}: OUT (${score})`;
    case "single":
      return `${batterName}: SINGLE (${score})`;
    case "double":
      return `${batterName}: DOUBLE (${score})`;
    case "triple":
      return `${batterName}: TRIPLE (${score})`;
    case "homerun":
      return `${batterName}: HOME RUN (${score})`;
  }
}
