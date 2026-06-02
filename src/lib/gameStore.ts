/**
 * Element brawl game state — player vs CPU, no baseball/SZN/draft paths.
 */
import { create } from "zustand";
import type { CardDefinition } from "./cards";
import { dealBrawlElementHand } from "./elementDeal";
import { ELEMENT_CARD_IDS } from "./elementCards";
import { computeElementBondsWithAbilities } from "./elementAbilities";
import {
  freshElementCombatState,
  optimizeElementHand,
  type ElementBond,
  type ElementCombatState,
} from "./brawlElements";
import type { BrawlCombatReport } from "./brawlCombatLog";
import { canConnectAny, seamKey } from "./connect";
import { playCardSnap, startStadiumAmbience } from "./gameAudio";
import type { ScoringResult } from "./scoring";

export type Team = "PLAYER" | "CPU";
export type Side = "Player" | "Opponent";
/** @deprecated Legacy alias used by overlay layout helpers. */
export type SideLegacy = "Batting" | "Pitching";
export type GameMode = "brawl" | null;
export type Phase =
  | "selecting"
  | "revealing"
  | "between-at-bats"
  | "game-over";

export interface SeatIdentity {
  id: string;
  name: string;
  handedness?: "L" | "R" | "S";
}

// Legacy reveal beat types — element brawl uses an empty reveal script.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RevealBeatAnimation = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResolutionBeat = any;

export interface PendingChoice {
  side: SideLegacy;
  cardId: string;
}

export interface MatchupPreview {
  batterDisplay: number;
  pitcherDisplay: number;
  batterWins: boolean;
  batterScoringResult: ScoringResult;
  pitcherScoringResult: ScoringResult;
}

export const BRAWL_SNAP_DURATION_MS = 60_000;

export function brawlSnapSpeedBonus(_remainingMs: number): number {
  return 0;
}

export function getUserSide(s: {
  userTeam: Team;
  gameMode?: GameMode | null;
}): SideLegacy {
  if (s.gameMode === "brawl") {
    return s.userTeam === "PLAYER" ? "Batting" : "Pitching";
  }
  return "Batting";
}

export function getUiUserSide(s: {
  revealUiUserSide: SideLegacy | null;
  userTeam: Team;
  gameMode?: GameMode | null;
}): SideLegacy {
  if (s.gameMode === "brawl") {
    return s.revealUiUserSide ?? getUserSide(s);
  }
  return s.revealUiUserSide ?? "Batting";
}

export function isLowLeverageAtBat(_s: unknown): boolean {
  return false;
}

const PLAYER_SEAT: SeatIdentity = { id: "player", name: "You" };
const CPU_SEAT: SeatIdentity = { id: "cpu", name: "CPU" };

function emptyScoringResult(): ScoringResult {
  return { totalValue: 0, bestGroup: [], cardModifiers: {} };
}

function computeBrawlOpponentPrep(
  s: Pick<
    GameState,
    "gameMode" | "batterHand" | "pitcherHand" | "userTeam"
  >,
): Partial<GameState> | null {
  if (s.gameMode !== "brawl") return null;
  const userSide = getUserSide(s);
  const opponentHand =
    userSide === "Batting" ? s.pitcherHand : s.batterHand;
  if (opponentHand.length === 0) return null;
  const optimized = optimizeElementHand(opponentHand);
  return {
    brawlOpponentPlanHand: optimized.hand,
    brawlOpponentSeams: new Set(optimized.affirmedSeams),
  };
}

function dealFreshAtBat() {
  const seed = Math.floor(Math.random() * 0x7fffffff);
  return {
    batter: PLAYER_SEAT,
    pitcher: CPU_SEAT,
    batterHand: dealBrawlElementHand(5, ELEMENT_CARD_IDS, seed),
    pitcherHand: dealBrawlElementHand(5, ELEMENT_CARD_IDS, seed + 7919),
    pendingChoices: [] as PendingChoice[],
    pendingReveals: [] as unknown[],
    pitcherTransformsImpactingBatter: [] as string[],
  };
}

export interface GameState {
  userTeam: Team;
  gameMode: GameMode;
  phase: Phase;

  batter: SeatIdentity;
  pitcher: SeatIdentity;
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  atBatId: number;

  lastOutcome: null;
  lastBatterScore: number;
  lastPitcherScore: number;
  lastResultMessage: string;
  lastBrawlResolution: null;
  lastResolveLog: string[];
  lastBatterCardModifiers: Record<string, { value: number }>;
  lastPitcherCardModifiers: Record<string, { value: number }>;
  lastRevealMathSnapshot: null;

  affirmedSeams: Set<string>;
  brawlOpponentSeams: Set<string>;
  brawlOpponentPlanHand: CardDefinition[];
  brawlElementCombat: ElementCombatState;
  lastElementBonds: { user: ElementBond[]; opponent: ElementBond[] } | null;
  lastElementCombatStart: { playerHP: number; cpuHP: number } | null;
  lastBrawlCombatReport: BrawlCombatReport | null;
  brawlSnapStartedAt: number | null;

  revealScript: ResolutionBeat[];
  pendingResolvedPhase: Phase | null;
  revealUiUserSide: SideLegacy | null;

  /** Legacy fields — kept for overlay compatibility, unused in element brawl. */
  inning: number;
  half: "top" | "bottom";
  outs: number;
  isFirstAtBatOfInning: boolean;
  totalInnings: number;
  homeScore: number;
  awayScore: number;
  bases: [boolean, boolean, boolean];
  baseRunners: [null, null, null];
  runnerMoves: unknown[];
  pendingDebuffs: unknown[];
  resolvedChoices: Record<string, unknown>;
  activeChoiceCardId: string | null;
  coinFlips: Record<string, "heads" | "tails">;
  pendingChoices: PendingChoice[];
  pendingReveals: unknown[];
  pitcherTransformsImpactingBatter: string[];
  equippedItems: Record<string, string[]>;
  brawlStreakBatter: number;
  brawlStreakPitcher: number;
  brawlDraftChoice: null;
  questPendingBattingHitScale: number;
  questShakeRequestId: number;
  quickResolveEnabled: boolean;
  resolveInningTarget: null;
  tutorialActive: boolean;
  run: null;
  sznGamepadFocus: string;
  brawlUserPool: string[];
  brawlOpponentPool: string[];

  reorderBatterHand: (cards: CardDefinition[]) => void;
  reorderPitcherHand: (cards: CardDefinition[]) => void;
  affirmDraggedCard: (cardId: string) => void;
  lockIn: () => void;
  completeReveal: () => void;
  commitElementCombatResult: (
    combat: ElementCombatState,
    report: BrawlCombatReport,
  ) => void;
  dismissBrawlBattleReport: () => void;
  startNextAtBat: () => void;
  prepareBrawlOpponent: () => void;
  startBrawl: (team: Team) => void;
  returnToBrawlMenu: () => void;
  reset: (team?: Team) => void;
  scoreBatter: () => ScoringResult;
  scorePitcher: () => ScoringResult;
  previewMatchup: () => MatchupPreview;
  setQuickResolveEnabled: (enabled: boolean) => void;
  requestResolveInning: (_target: number) => void;
  setSznGamepadFocus: (_focus: string) => void;
  triggerChoice: (_cardId: string) => void;
  resolveChoice: (_cardId: string, _value: unknown) => void;
  dismissChoice: () => void;
  sznRecallItem: (_instanceId: string) => void;
  reportSeriesGameResult: (
    _result?: string,
    _userScore?: number,
    _ghostScore?: number,
  ) => void;
}

const INITIAL = dealFreshAtBat();

export const useGameStore = create<GameState>((set, get) => ({
  userTeam: "PLAYER",
  gameMode: "brawl",
  phase: "selecting",
  ...INITIAL,
  atBatId: 1,

  lastOutcome: null,
  lastBatterScore: 100,
  lastPitcherScore: 100,
  lastResultMessage: "",
  lastBrawlResolution: null,
  lastResolveLog: [],
  lastBatterCardModifiers: {},
  lastPitcherCardModifiers: {},
  lastRevealMathSnapshot: null,

  affirmedSeams: new Set(),
  brawlOpponentSeams: new Set(),
  brawlOpponentPlanHand: [],
  brawlElementCombat: freshElementCombatState(),
  lastElementBonds: null,
  lastElementCombatStart: null,
  lastBrawlCombatReport: null,
  brawlSnapStartedAt: Date.now(),

  revealScript: [],
  pendingResolvedPhase: null,
  revealUiUserSide: null,

  inning: 1,
  half: "top",
  outs: 0,
  isFirstAtBatOfInning: true,
  totalInnings: 99,
  homeScore: 0,
  awayScore: 0,
  bases: [false, false, false],
  baseRunners: [null, null, null],
  runnerMoves: [],
  pendingDebuffs: [],
  resolvedChoices: {},
  activeChoiceCardId: null,
  coinFlips: {},
  pendingChoices: [],
  equippedItems: {},
  brawlStreakBatter: 0,
  brawlStreakPitcher: 0,
  brawlDraftChoice: null,
  questPendingBattingHitScale: 0,
  questShakeRequestId: 0,
  quickResolveEnabled: false,
  resolveInningTarget: null,
  tutorialActive: false,
  run: null,
  sznGamepadFocus: "screen",
  brawlUserPool: [...ELEMENT_CARD_IDS],
  brawlOpponentPool: [...ELEMENT_CARD_IDS],

  reorderBatterHand: (cards) => set({ batterHand: cards }),
  reorderPitcherHand: (cards) => set({ pitcherHand: cards }),

  affirmDraggedCard: (cardId) =>
    set((s) => {
      const userSide = getUserSide(s);
      const hand =
        userSide === "Batting" ? s.batterHand : s.pitcherHand;
      const idx = hand.findIndex((c) => c.id === cardId);
      if (idx === -1) return {};

      const next = new Set<string>();
      for (let i = 1; i < hand.length; i++) {
        const a = hand[i - 1];
        const b = hand[i];
        const key = seamKey(a.id, b.id);
        if (s.affirmedSeams.has(key) && canConnectAny(a, b)) {
          next.add(key);
        }
      }
      if (idx > 0) {
        const left = hand[idx - 1];
        const me = hand[idx];
        if (canConnectAny(left, me)) next.add(seamKey(left.id, me.id));
      }
      if (idx < hand.length - 1) {
        const me = hand[idx];
        const right = hand[idx + 1];
        if (canConnectAny(me, right)) next.add(seamKey(me.id, right.id));
      }
      if (s.gameMode === "brawl") {
        for (const key of next) {
          if (!s.affirmedSeams.has(key)) {
            playCardSnap();
            break;
          }
        }
      }
      return { affirmedSeams: next };
    }),

  lockIn: () => {
    const s = get();
    if (s.phase !== "selecting") return;
    if (s.batterHand.length === 0 || s.pitcherHand.length === 0) return;

    const userSide = getUserSide(s);
    const opponentSideKey: "pitcherHand" | "batterHand" =
      userSide === "Batting" ? "pitcherHand" : "batterHand";
    const planned = s.brawlOpponentPlanHand;
    if (planned && planned.length === s[opponentSideKey].length) {
      set({ [opponentSideKey]: planned } as Partial<GameState>);
    }

    const state = get();
    const userHand =
      userSide === "Batting" ? state.batterHand : state.pitcherHand;
    const oppHand =
      userSide === "Batting" ? state.pitcherHand : state.batterHand;
    const userBonds = computeElementBondsWithAbilities(
      userHand,
      state.affirmedSeams,
    );
    const oppBonds = computeElementBondsWithAbilities(
      oppHand,
      state.brawlOpponentSeams,
    );
    const combatStart = state.brawlElementCombat;

    set({
      lastElementBonds: { user: userBonds, opponent: oppBonds },
      lastElementCombatStart: {
        playerHP: combatStart.playerHP,
        cpuHP: combatStart.cpuHP,
      },
      lastBatterScore: combatStart.playerHP,
      lastPitcherScore: combatStart.cpuHP,
      phase: "revealing",
      pendingResolvedPhase: "between-at-bats",
      revealScript: [],
      revealUiUserSide: userSide,
      activeChoiceCardId: null,
    });
  },

  completeReveal: () => {
    const s = get();
    if (s.phase !== "revealing") return;
    set({
      phase: s.pendingResolvedPhase ?? "between-at-bats",
      pendingResolvedPhase: null,
      revealScript: [],
      revealUiUserSide: null,
    });
  },

  commitElementCombatResult: (combat, report) => {
    const gameOver = combat.playerHP <= 0 || combat.cpuHP <= 0;
    set({
      brawlElementCombat: combat,
      lastBatterScore: combat.playerHP,
      lastPitcherScore: combat.cpuHP,
      lastBrawlCombatReport: report,
      pendingResolvedPhase: gameOver ? "game-over" : "between-at-bats",
    });
  },

  dismissBrawlBattleReport: () => {
    const s = get();
    if (!s.lastBrawlCombatReport) return;
    const phase = s.phase;
    set({ lastBrawlCombatReport: null });
    if (phase === "between-at-bats") {
      get().startNextAtBat();
    } else if (phase === "game-over") {
      get().returnToBrawlMenu();
    }
  },

  startNextAtBat: () => {
    const s = get();
    if (s.phase === "game-over") return;
    if (s.phase !== "between-at-bats") return;
    const ab = dealFreshAtBat();
    set({
      ...ab,
      atBatId: s.atBatId + 1,
      phase: "selecting",
      lastOutcome: null,
      lastResultMessage: "",
      lastResolveLog: [],
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      affirmedSeams: new Set(),
      brawlOpponentSeams: new Set(),
      brawlOpponentPlanHand: [],
      brawlSnapStartedAt: Date.now(),
      lastBrawlCombatReport: null,
      revealScript: [],
      pendingResolvedPhase: null,
      revealUiUserSide: null,
    });
    const prep = computeBrawlOpponentPrep(get());
    if (prep) set(prep);
  },

  prepareBrawlOpponent: () => {
    const s = get();
    if (s.gameMode !== "brawl" || s.phase !== "selecting") return;
    const prep = computeBrawlOpponentPrep(s);
    if (prep) set(prep);
  },

  startBrawl: (team) => {
    const ab = dealFreshAtBat();
    set({
      gameMode: "brawl",
      phase: "selecting",
      userTeam: team,
      ...ab,
      atBatId: get().atBatId + 1,
      affirmedSeams: new Set(),
      brawlOpponentSeams: new Set(),
      brawlOpponentPlanHand: [],
      brawlElementCombat: freshElementCombatState(),
      lastElementBonds: null,
      lastElementCombatStart: null,
      lastBrawlCombatReport: null,
      brawlSnapStartedAt: Date.now(),
      lastBatterScore: 100,
      lastPitcherScore: 100,
      brawlUserPool: [...ELEMENT_CARD_IDS],
      brawlOpponentPool: [...ELEMENT_CARD_IDS],
    });
    const prep = computeBrawlOpponentPrep(get());
    if (prep) set(prep);
    startStadiumAmbience();
  },

  returnToBrawlMenu: () => {
    get().startBrawl(get().userTeam);
  },

  reset: (team) => {
    get().startBrawl(team ?? get().userTeam);
  },

  scoreBatter: () => emptyScoringResult(),
  scorePitcher: () => emptyScoringResult(),
  previewMatchup: () => {
    const empty = emptyScoringResult();
    return {
      batterDisplay: get().lastBatterScore,
      pitcherDisplay: get().lastPitcherScore,
      batterWins: get().lastBatterScore >= get().lastPitcherScore,
      batterScoringResult: empty,
      pitcherScoringResult: empty,
    };
  },
  setQuickResolveEnabled: (enabled) => set({ quickResolveEnabled: enabled }),
  requestResolveInning: () => {},
  setSznGamepadFocus: (focus) => set({ sznGamepadFocus: focus }),
  triggerChoice: () => {},
  resolveChoice: () => {},
  dismissChoice: () => set({ activeChoiceCardId: null }),
  sznRecallItem: () => {},
  reportSeriesGameResult: () => {},
}));
