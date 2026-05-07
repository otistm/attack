import { create } from "zustand";
import { CardDefinition } from "./cards";
import { BATTERS, dealHand, MlbPlayer, PITCHERS } from "./players";
import { HitOutcome, resolveHitScale, scoreHand, ScoringContext, ScoringResult } from "./scoring";
import { canConnect, seamKey } from "./connect";
import { applyCardEffect, EffectContext, highestValueCard } from "./cardEffects";
import { applyHandTransforms } from "./handTransforms";
import { applyDealEffects } from "./dealEffects";
import { applyResolveStep, PendingDebuff, RunnerSlot } from "./resolveStep";
import type { ShapeType } from "../components/cardShapes";
import {
  aiBidAmount,
  aiBidDecision,
  aiNominate,
  buildQuickMatchDraft,
  type DraftState,
  initDraftState,
  nominate as draftNominateFn,
  passBid as draftPassFn,
  placeBid as draftPlaceBidFn,
  repairDraftStall,
} from "./draft";
import { TUTORIAL_STEPS } from "./tutorialSteps";
import {
  applyQuestTickToAll,
  initialQuestProgress,
  rollQuestSlate,
  QUEST_REGISTRY,
  type QuestProgressState,
} from "./quests";
import {
  applyWildcardToFirstGeneral,
  mergeQuestReward,
  QUEST_REWARD_INITIAL,
} from "./questRewards";
import { playSfx } from "./sfx";

export type Half = "top" | "bottom";
export type Team = "HOME" | "AWAY";
export type Side = "Batting" | "Pitching";
/**
 * Which lane the player committed to from the StartGameScreen. Drives the
 * in-game "New Game" rematch button so it stays inside the chosen lane
 * instead of always punting to an auction draft. `null` means the player
 * hasn't picked a lane yet (initial boot, post-`reset`); the StartGameScreen
 * is the source of truth in that case.
 */
export type GameMode = "draft" | "quick-match" | null;
/**
 * `revealing` sits between `selecting` and `between-at-bats`. lockIn computes
 * the final outcome (and applies bases / runs / outs) but parks the phase here
 * so the UI can play through `revealScript` -- per-card self mods, then
 * targeted opponent debuffs, then aggregates / cross-at-bat / guess-pitch
 * beats -- before transitioning to the resolved state. The destination phase
 * (between-at-bats or game-over) is stashed in `pendingResolvedPhase`.
 */
export type Phase =
  | "drafting"
  | "selecting"
  | "resolving"
  | "revealing"
  | "between-at-bats"
  | "game-over";

/**
 * One step of the lock-in reveal animation. The orchestrator in
 * `CardGameOverlay` walks this list with a setTimeout chain and translates
 * each beat into:
 *   - a card highlight (source) and optional drop-pulse (target),
 *   - an override of the affected card's displayed value,
 *   - a tween of the affected ScorePill toward the running total,
 *   - and an optional banner near the affected ScorePill (aggregate beats).
 *
 * Keep this list sorted in the order the player should see them; see
 * `buildRevealScript` for the canonical ordering.
 */
export type ResolutionBeat =
  | {
      kind: "selfModifier";
      cardId: string;
      side: "Batting" | "Pitching";
      baseValue: number;
      finalValue: number;
    }
  | {
      kind: "targetedDebuff";
      sourceCardId: string;
      sourceSide: "Batting" | "Pitching";
      targetCardId: string;
      targetSide: "Batting" | "Pitching";
      delta: number;
    }
  | {
      kind: "aggregateDebuff";
      sourceCardId: string;
      sourceSide: "Batting" | "Pitching";
      affectedSide: "Batting" | "Pitching";
      delta: number;
      label: string;
    }
  | {
      kind: "guessPitchHit";
      /** Always the b-65 card id. Carried so the reveal orchestrator can
       *  light up the source card the same way other source-attributable
       *  beats (selfModifier, targetedDebuff, aggregateDebuff) do -- the
       *  player should SEE Guess Pitch fire, not just see a banner. */
      sourceCardId: string;
      delta: number;
    }
  | {
      kind: "crossDebuff";
      affectedSide: "Batting" | "Pitching";
      delta: number;
      label: string;
    };
export type Bases = [boolean, boolean, boolean]; // [1B, 2B, 3B]

/**
 * Which side of the matchup the human player is currently in.
 *
 * Derived from `userTeam` + `half`:
 *  - AWAY team bats in the top, pitches in the bottom.
 *  - HOME team bats in the bottom, pitches in the top.
 *
 * UI components and engine branches that used to read the `USER_SIDE`
 * constant now select this through `useGameStore(getUserSide)` (or call
 * `getUserSide(get())` from inside actions). The result drives:
 *  - `PlayerChoiceModal` / `InfoRevealOverlay` filtering (the user only
 *    ever sees prompts/peeks for the seat they're in).
 *  - `CardGameOverlay` UI inversion (bottom strip belongs to whichever
 *    role the user has this half).
 *  - `CameraRig` pose selection (mirrored to behind-the-pitcher when on
 *    defense).
 *  - The naive AI policy in the engine for the OTHER seat.
 */
export function getUserSide(s: { userTeam: Team; half: Half }): Side {
  if (s.userTeam === "HOME") return s.half === "bottom" ? "Batting" : "Pitching";
  return s.half === "top" ? "Batting" : "Pitching";
}

/**
 * Seat the HUD should treat as "the user's" for layout (hand strips, camera).
 * While `phase === "revealing"`, this stays on the seat they had for the at-bat
 * that just locked in so an immediate half flip (side retired) does not swap
 * hands mid-animation or replay deal-in stagger. Otherwise matches
 * {@link getUserSide}.
 */
export function getUiUserSide(s: {
  revealUiUserSide: Side | null;
  userTeam: Team;
  half: Half;
}): Side {
  return s.revealUiUserSide ?? getUserSide(s);
}

/**
 * Open question presented to the player after the hand is dealt and before
 * lock-in. The PlayerChoiceModal turns each entry into a panel the player
 * resolves via `resolveChoice`. Unanswered choices simply drop their effect
 * (the engine treats them as "the player declined").
 *
 * Discriminated by `type`:
 *   - `guessShape`: pick one shape (b-65 Guess Pitch). Options are typed as
 *     `ShapeType[]` so the modal can render shape buttons without casts.
 *   - `pickShape`: full 3-step picker (target card + side + shape).
 *     `targets` enumerates the eligible card IDs in the prompting player's
 *     hand. Options are typed as `ShapeType[]`.
 *   - `pickGeneral` / `pickConnection`: reserved for later phases. Options
 *     are arbitrary string IDs (card ids / seam keys); the modal must NOT
 *     forward these to the shape-resolved path without validation.
 */
export type PendingChoice =
  | {
      cardId: string;
      side: "Batting" | "Pitching";
      type: "guessShape";
      options: ShapeType[];
    }
  | {
      cardId: string;
      side: "Batting" | "Pitching";
      type: "pickShape";
      options: ShapeType[];
      /** Eligible target card IDs for the modify-shape wizard. */
      targets: string[];
    }
  | {
      cardId: string;
      side: "Batting" | "Pitching";
      type: "pickGeneral" | "pickConnection";
      options: string[];
      targets?: string[];
    };

/**
 * Structured payload the modal hands back to `resolveChoice`. The discriminator
 * keeps the value type honest for downstream readers (e.g. the b-65 guess
 * bonus inspects `kind === 'shape'`; the b-12/p-56 mutators inspect
 * `kind === 'modifyShape'`).
 */
export type ResolvedChoice =
  | { kind: "shape"; shape: ShapeType }
  | {
      kind: "modifyShape";
      targetCardId: string;
      side: "left" | "right";
      shape: ShapeType;
    };

/** Information-reveal request. Phase 1 stores the request; the overlay UI is wired in Phase 2. */
export interface PendingReveal {
  forSide: "Batting" | "Pitching";
  /**
   * Reveal kind:
   *  - opponentHand:       full opponent hand (cards + values)
   *  - opponentUncombined: opponent's currently-uncombined cards only
   *  - opponentLayout:     opponent's hand ordering (left/right per slot)
   *  - signatureShapes:    only the L/R shapes of opponent SIGNATURE cards.
   *    (b-121 Catcher's Eye -- narrower than opponentHand, lets the catcher
   *    plan around pitch shapes without seeing values or generals.)
   */
  reveal: "opponentHand" | "opponentUncombined" | "opponentLayout" | "signatureShapes";
  source: string;
}

export type { PendingDebuff } from "./resolveStep";

/**
 * Logical slot a runner sits on. `'scored'` means they crossed home and
 * should exit the field. `'out'` means they were retired without scoring
 * (used for pickoffs so the 3D scene doesn't animate a removed runner
 * across the plate as if they had scored). Used to drive baserunning
 * animations between at-bats.
 */
export type BaseSlot = "home" | "first" | "second" | "third" | "scored" | "out";

/**
 * Per-base runner identity, indexed identically to `Bases` (1B, 2B, 3B). A
 * `null` slot means either nobody is on that base, or the slot is occupied
 * by an "extra runner" spawned from a card effect (e.g. b-135 Stolen Bag)
 * for which there is no specific drafted player to credit. The boolean
 * `bases` array remains the source of truth for occupancy in gameplay
 * logic; `baseRunners` is parallel display data for showing each runner's
 * name above their head in the 3D scene.
 */
export type BaseRunners = [
  MlbPlayer | null,
  MlbPlayer | null,
  MlbPlayer | null,
];

export interface RunnerMove {
  /** Stable id for the move – used as the React key for the animated runner. */
  id: string;
  from: BaseSlot;
  to: BaseSlot;
  /**
   * 'batter' moves originate at home; 'runner' moves originate on a base;
   * 'pickoff' moves are runners removed off-base WITHOUT scoring.
   */
  kind: "batter" | "runner" | "pickoff";
  /**
   * The player making this move, when known. Carries the moving player's
   * name into the 3D scene so the animated runner can label themselves
   * mid-travel. `null` for phantom additions like b-135 Stolen Bag where
   * the runner doesn't correspond to a specific drafted player.
   */
  player: MlbPlayer | null;
}

/** Matchup breakdown captured at lock-in for reveal / result phase UI. */
export interface RevealMathSnapshot {
  batter: {
    chainSum: number;
    pitcherDelta: number;
    carryoverDelta: number;
    guessDelta: number;
    total: number;
    ignoresDebuffs: boolean;
    chainOf: number;
    handSize: number;
  };
  pitcher: {
    chainSum: number;
    batterDelta: number;
    carryoverDelta: number;
    total: number;
    chainOf: number;
    handSize: number;
  };
}

export interface GameState {
  // Clock state.
  inning: number;
  half: Half;
  outs: number;
  isFirstAtBatOfInning: boolean;
  totalInnings: number;

  /**
   * Which team the human player is on. Combined with `half` (via
   * `getUserSide`) this decides whether the user is batting or pitching at
   * any given moment, which drives UI inversion, the camera flip, and which
   * seat the engine auto-plays. Persists across `reset()` unless the New
   * Game picker explicitly reassigns it.
   */
  userTeam: Team;

  /**
   * Which lane the player is in. `'draft'` means the auction-draft path was
   * chosen via {@link startDraft}; `'quick-match'` means the random-roster
   * path via {@link startQuickMatch}. `null` before any lane is committed
   * (initial boot, post-`reset`).
   *
   * The in-game "New Game" button uses this to start a fresh match in the
   * SAME lane: locking in your cards in a quick match shouldn't suddenly
   * drop you into an auction the next time you tap New Game. Anything that
   * exits gameplay back to the StartGameScreen (legacy `reset`, tutorial
   * end) clears this so the lane chooser is the source of truth again.
   */
  gameMode: GameMode;

  // Score.
  homeScore: number;
  awayScore: number;
  bases: Bases;
  /**
   * Parallel to `bases` — when `bases[i]` is true, `baseRunners[i]` may
   * carry the `MlbPlayer` who is on that base. Used by the 3D scene to
   * label runners with their drafted-player names. May be `null` even
   * when `bases[i]` is true (phantom runners spawned by card effects).
   */
  baseRunners: BaseRunners;

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
   * Player-facing log lines produced by the resolve step of the most recent
   * at-bat (e.g. "Stolen Bag: extra runner placed on 1B"). Surfaced under the
   * hit-result banner so post-hit card effects don't read as visual glitches:
   * before this, b-135 Stolen Bag silently dropped a phantom runner on 1B and
   * playtest reports flagged the field as showing "duplicate runners". The
   * raw resolveStep log carries a "p-44 ", "b-135 ", ... prefix; we strip the
   * card id when persisting so the UI can render the clean tail directly.
   * Cleared at the start of each new at-bat (and on reset).
   */
  lastResolveLog: string[];
  /**
   * Snapshot of the per-card modifier values (from scoreBatter / scorePitcher)
   * captured at lock-in time. The result phase reads these instead of the live
   * preview so cards keep the numbers they had when the swing was committed.
   * Without this, state-trigger cards like b-91 RBI Threat re-evaluate after
   * the play (bases just cleared on a HR -> the +3 evaporates) and the player
   * watches their card value drop from 7 to 4 with no explanation. The score
   * pill stays correct because lastBatter/PitcherScore is also frozen, but
   * the card-level numbers used to silently drift. Cleared at start of next
   * at-bat so the next selection sees fresh, live previews. Empty on a fresh
   * game / mid-selection.
   */
  lastBatterCardModifiers: Record<string, { value: number; color?: string }>;
  lastPitcherCardModifiers: Record<string, { value: number; color?: string }>;
  /**
   * Matchup math breakdown captured at lock-in for the reveal + result UI.
   * Cleared when a new at-bat starts (`selecting`).
   */
  lastRevealMathSnapshot: RevealMathSnapshot | null;
  /**
   * Per-runner movement list produced by the most recent at-bat. Drives the 3D
   * runner travel animation while the camera is zoomed out. Cleared at the
   * start of the next at-bat (and on reset).
   */
  runnerMoves: RunnerMove[];

  /** Cross-at-bat debuffs queued by resolve-step effects. Drained one at-bat at a time. */
  pendingDebuffs: PendingDebuff[];
  /** Open player-choice prompts for the current at-bat. Defaults applied if unanswered. */
  pendingChoices: PendingChoice[];
  /**
   * Card id whose choice modal is currently open, or null if no modal is
   * showing. Choices no longer auto-open the moment they're queued in
   * `pendingChoices` -- the player has to actively trigger them via the
   * "USE" pill on their hand strip. This gives the user agency over WHEN
   * to commit a guess / shape change instead of blocking selection while
   * the player is still arranging cards.
   *
   * Cleared by:
   *  - `resolveChoice` once the player picks (the choice is also removed
   *    from `pendingChoices`).
   *  - `dismissChoice` if the player closes without picking (the choice
   *    stays in `pendingChoices` so they can re-trigger it later).
   *  - `lockIn`, `startNextAtBat`, `reset` -- the modal can't survive a
   *    phase change.
   */
  activeChoiceCardId: string | null;
  /** Resolved choices keyed by cardId. See `ResolvedChoice` for shape variants. */
  resolvedChoices: Record<string, ResolvedChoice>;
  /** Information-reveal requests the UI should render this at-bat. */
  pendingReveals: PendingReveal[];
  /**
   * Pitcher card IDs whose hand-transform actually mutated the batter's hand
   * this round (e.g. p-31 only listed if the batter actually had a wildcard).
   * Drives the BatterStatusStrip chips so they only render when there's a
   * real, observable impact -- prevents leaking pitcher info on no-op trigger
   * cards. Reset every fresh at-bat.
   */
  pitcherTransformsImpactingBatter: string[];

  /**
   * Set of user-affirmed connection seams in the USER'S hand (whichever
   * side they're playing this half -- batter when on offense, pitcher
   * when on defense). Each entry is a `seamKey(idA, idB)` (cards.ts ids,
   * lex-sorted). A seam is active in the UI and the scoring engine ONLY
   * when the cards are currently adjacent, `canConnect` allows it, AND
   * the seam id is in this set -- even two perfectly-mateable cards
   * sitting next to each other do NOTHING until the player drags one
   * onto the other.
   *
   * Why a Set instead of recomputing from layout: previously the engine
   * auto-chained any adjacent canConnect pair, which playtest feedback
   * called out as "no agency -- the deal solves itself". Routing
   * connections through this set turns chain-building into a deliberate
   * action.
   *
   * The AI's hand (the seat the user is NOT on) auto-connects on
   * adjacency -- the AI has no drag UI, so we leave its scoring path on
   * legacy semantics by passing `affirmedSeams: null` into its
   * `ScoringContext`.
   *
   * Reset to an empty set on every fresh deal, on reset, on
   * startNextAtBat, AND when the half flips and the user changes seats
   * (a brand-new hand on the new role starts with NO connections).
   */
  affirmedSeams: ReadonlySet<string>;

  /**
   * Coin flips resolved at lock-in time for cards whose effect tosses (e.g.
   * b-22 Power/Speed Threat). Keyed by cardId; absent during the selecting
   * phase so previews fall back to deterministic averages. Cleared on
   * `startNextAtBat` and `reset`.
   */
  coinFlips: Record<string, "heads" | "tails">;

  /**
   * FIFO histories of the last few batter / pitcher IDs picked for an at-bat.
   * `freshAtBat` consults these to AVOID repeating the same player in quick
   * succession -- before this, a 10-player roster + uniform random pick
   * routinely produced 3-in-a-row Soto / Skubal matchups that made the lineup
   * feel shallow during playtests. Trimmed to ROSTER_REPEAT_AVOIDANCE entries.
   */
  recentBatterIds: string[];
  recentPitcherIds: string[];

  /**
   * Ordered animation script populated by lockIn and consumed by the UI
   * orchestrator. Empty (and ignored) outside `phase === "revealing"`.
   */
  revealScript: ResolutionBeat[];
  /**
   * Where the at-bat ends up after the reveal animation finishes
   * (between-at-bats, or game-over if this swing closed the final inning).
   * Stashed by lockIn so completeReveal can flip the phase without re-running
   * the outcome math. Null whenever we're not mid-reveal.
   */
  pendingResolvedPhase: Phase | null;
  /**
   * During `revealing`, card strips and camera use this seat instead of
   * {@link getUserSide} so the UI does not swap batter/pitcher lanes until
   * {@link completeReveal} — the engine applies the next half's `half` in the
   * same tick as `lockIn`, but the reveal is still for the prior at-bat.
   */
  revealUiUserSide: Side | null;

  /**
   * Active draft state when `phase === "drafting"`. Null whenever the user
   * isn't mid-draft -- e.g. during gameplay AND on first load (the initial
   * game seed is dealt from the global pool so existing tests + the dev
   * boot-up still work without touching the auction flow). Replaced wholesale
   * by `startDraft` and cleared by `completeDraft`.
   *
   * The store actions (`draftNominate`, `draftBid`, `draftPass`, `draftAiTick`)
   * are thin wrappers that thread this slice through the pure helpers in
   * `./draft.ts`.
   */
  draft: DraftState | null;

  /** In-game quests (3 active ids for this game). */
  activeQuests: string[];
  questProgress: Record<string, QuestProgressState>;
  /** Quest ids finished this game (for trophy strip / dedupe). */
  completedQuests: string[];
  /** FIFO celebration queue → QuestCompleteOverlay. */
  questCelebrationQueue: string[];
  /** Bumped when any quest progress changes (HUD pulse). */
  questTick: number;
  questPendingBattingHitScale: number;
  questForceHomerunOnce: boolean;
  questWildcardNextBatterHand: boolean;
  questLegendaryCelebratePulse: boolean;
  /** Bumped when quest celebration should shake the HUD (ScreenShake). */
  questShakeRequestId: number;

  // Actions.
  reorderBatterHand: (cards: CardDefinition[]) => void;
  reorderPitcherHand: (cards: CardDefinition[]) => void;
  /**
   * Called by the BATTER strip on drag-end. Recomputes the
   * `affirmedSeams` set against the current `batterHand` order:
   *   1. Prunes seams that are no longer current adjacencies (the cards
   *      moved apart) or that lost `canConnect` eligibility (e.g. a shape
   *      transform after the user-affirmed it).
   *   2. Adds the dragged card's NEW left/right adjacencies if those pairs
   *      are mechanically connectable.
   *
   * The drop is the affirming gesture: even if the user picks up a card
   * and drops it back in place without reordering, the new neighbors get
   * affirmed so a "tap to confirm" workflow exists.
   */
  affirmDraggedCard: (cardId: string) => void;
  scoreBatter: () => ScoringResult;
  scorePitcher: () => ScoringResult;
  /**
   * Comprehensive matchup preview the UI binds to. Mirrors `lockIn`'s math so
   * what the player sees during selection (the score number on each pill)
   * equals what they'll see after the swing -- including opponent debuffs,
   * cross-at-bat debuffs, b-9 immunity, the b-65 guess bonus, and (when the
   * batter is winning) the hit-scale ladder bonus folded in. This replaces the
   * old "show maxValue + a separate Pitcher debuff badge" presentation, which
   * forced players to do mental math and exposed engine-internal vocabulary.
   *
   * Skips p-41 Sweeping Slider's post-arrangement combo break -- that fires
   * only at lock-in so it can't be reverse-engineered from the preview.
   */
  previewMatchup: () => MatchupPreview;
  lockIn: () => void;
  /**
   * Called by the UI when the reveal animation finishes its last beat.
   * Transitions `revealing -> pendingResolvedPhase` (between-at-bats or
   * game-over) and clears the script. Idempotent: a no-op when not in the
   * `revealing` phase, so multiple stale callbacks (e.g. setTimeout race with
   * a manual `reset`) don't double-advance.
   */
  completeReveal: () => void;
  startNextAtBat: () => void;
  /**
   * Reset to a fresh game. If `team` is provided, the user plays as that
   * team for the new game; otherwise the existing `userTeam` is reused so
   * the New Game button can carry the player's team across rematches.
   */
  reset: (team?: Team) => void;
  setUserTeam: (team: Team) => void;

  // ----- Start Game screen visibility -----
  /**
   * The pre-game lane chooser (auction vs quick match) renders when this
   * is true and `phase !== "drafting"`. Owned by the store so any component
   * can open it -- e.g. the game-over button. Closed automatically by
   * `startDraft` and `startQuickMatch` once the player commits.
   */
  showStartScreen: boolean;
  setShowStartScreen: (open: boolean) => void;

  // ----- Learn-to-Play tutorial -----
  /**
   * When true, the `TutorialOverlay` renders a step-by-step walkthrough on
   * top of a fresh Quick Match. The overlay's backdrop captures clicks so
   * the engine effectively pauses while a step is up; `lockIn` and
   * `startNextAtBat` short-circuit while this is true (the only exception
   * is the FINAL step, where `lockIn` clears the flag and resolves the
   * at-bat normally so the tutorial dissolves into live play).
   *
   * Cleared by every game-state-resetting action (`reset`, `startDraft`,
   * `startQuickMatch`) so tutorial state can never bleed into a real game.
   */
  tutorialActive: boolean;
  /** 0-based index into `TUTORIAL_STEPS`. */
  tutorialStepIndex: number;
  startTutorial: () => void;
  tutorialNext: () => void;
  tutorialPrev: () => void;
  tutorialExit: () => void;
  resolveChoice: (cardId: string, value: ResolvedChoice) => void;
  /**
   * Open the choice modal for the given card. The card must currently
   * have an entry in `pendingChoices` -- otherwise the call is a no-op
   * (defensive: stale clicks after `lockIn` shouldn't pop a modal). Used
   * by the per-card "USE" pill on the user's hand strip.
   */
  triggerChoice: (cardId: string) => void;
  /**
   * Close the active choice modal without resolving. The pending choice
   * stays queued so the player can re-trigger it; only `lockIn` finalizes
   * unresolved choices into "declined".
   */
  dismissChoice: () => void;

  // ----- Draft (auction) actions -----

  /**
   * Replace the historical reset path: pick a team AND open the pre-game
   * auction draft. Sets `phase = "drafting"` and seeds `draft` with a
   * fresh DraftState (empty rosters, full pool, AI archetype rolled).
   * The user is always the first nominator.
   */
  startDraft: (team: Team) => void;
  /**
   * "Quick Match" lane -- skip the auction. Builds a `DraftState` with
   * randomized 7-batter / 3-pitcher rosters for both sides (phase already
   * "complete") and drops straight into `phase = "selecting"`. The
   * gameplay layer reads `s.draft.roster` for every at-bat exactly the
   * same way it does after a finished auction, so once this lands, the
   * downstream flow is indistinguishable from the auction path.
   */
  /**
   * Quick Match lane. Optional `questSlate` (exactly 3 quest ids) when the
   * player confirms a custom roll from the pre-game quest picker.
   */
  startQuickMatch: (team: Team, questSlate?: string[]) => void;
  /**
   * Open an auction on the given player. No-op unless `phase === "drafting"`,
   * the user is the current nominator, and the player is in the pool. The
   * user implicitly opens at $1.
   */
  draftNominate: (playerId: string) => void;
  /** Place a bid for the user side. No-op outside the bidding sub-phase. */
  draftBid: (amount: number) => void;
  /** Pass for the user side. May immediately resolve the auction. */
  draftPass: () => void;
  /**
   * Drive the AI's turn (nominate / bid / pass) once. The DraftScreen calls
   * this from a `useEffect` whenever it detects the AI is the current actor;
   * the small artificial delay used by the UI is what produces the
   * "AI considering..." pulse the player sees.
   */
  draftAiTick: () => void;
  /**
   * Move from completed draft to gameplay. Transitions `phase` from
   * "drafting" to "selecting" and seeds the first at-bat using the drafted
   * rosters (so the dealer pulls from `draft.roster.user.batters` etc.
   * instead of the global pool). Idempotent: a no-op if the draft isn't
   * complete or we're already in gameplay.
   */
  completeDraft: () => void;

  /** Dismiss current quest celebration and show next in queue if any. */
  completeQuestCelebration: () => void;
}

export interface MatchupPreview {
  /** Comprehensive batter score the UI displays. */
  batterDisplay: number;
  /** Comprehensive pitcher score the UI displays. */
  pitcherDisplay: number;
  /** Whether the batter would win the head-to-head if locked in right now. */
  batterWinning: boolean;
  /**
   * Net Hit Scale ladder bonus the batter would currently apply ON TOP of the
   * head-to-head score, IF they win. Already accounts for the pitcher's
   * `hitScaleBonus` wall and b-9 immunity. Surfaced as a "+N HIT SCALE"
   * badge near the batter pill so the player sees the bonus is in play
   * without the pill itself silently jumping by N once they actually win.
   */
  batterHitScaleBonus: number;

  // ============ Per-side ScoringResults on the same hand the pill uses ===
  // The strip's per-card values, the "Best chain" subtitle, and the math
  // breakdown all read from these so they can never desync from the pill.
  // (Previously `CardGameOverlay` called `scoreBatter()` directly with the
  //  unmutated hand while the pill went through `previewMatchup` with the
  //  p-41 Sweeping Slider seam-break applied -- chain shown vs pill total
  //  could disagree by several points, with no UI to reconcile.)

  /** Full scoring result on the (possibly p-41-mutated) working batter hand. */
  batterScoringResult: ScoringResult;
  /** Full scoring result on the pitcher hand. */
  pitcherScoringResult: ScoringResult;

  // ============ Components of `batterDisplay` =============================
  // pillTotal === chainSum + pitcherDelta + carryoverDelta + guessDelta.
  // When any of the cross-side deltas is non-zero, the UI shows a math
  // breakdown so the player can see WHY their visible card sum doesn't
  // match the pill -- previously these effects (p-38 / p-50 / p-60 / p-72 /
  // p-90 aggregate debuffs, cross-at-bat carryover, b-65 guess bonus) only
  // moved the pill, never the per-card numbers.

  /** Sum of the batter's best-chain card values (the visible chain total). */
  batterChainSum: number;
  /** Aggregate pitcher pressure on the batter's pill (typically negative). */
  batterPitcherDelta: number;
  /** Cross-at-bat debuff carryover applied to the batter's pill. */
  batterCarryoverDelta: number;
  /** b-65 Guess Pitch bonus applied at lock-in (0/1/4). */
  batterGuessDelta: number;
  /** True when b-9 Generational Discipline is in play (debuffs zeroed). */
  batterIgnoresDebuffs: boolean;

  /** Pitcher pill: best-chain sum (same arithmetic as pitcherDisplay). */
  pitcherChainSum: number;
  /** Pitcher pill: aggregate batter pressure (opponentModifier + pitcherCombinedDelta). */
  pitcherBatterDelta: number;
  /** Pitcher pill: cross-at-bat carryover on pitching side. */
  pitcherCarryoverDelta: number;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Lineup-variety knob: how many recently-used player IDs to exclude when
 * dealing the next at-bat. With 10 batters / 10 pitchers, dropping the last 6
 * batters and 5 pitchers from the candidate pool keeps each new at-bat feeling
 * fresh while still leaving 4+ / 5+ valid picks (so the random draw never
 * starves). Earlier values (4/3) let Harper / Soto reappear after only 5
 * at-bats, which playtest reports flagged as "I just played this guy".
 */
const RECENT_BATTER_LIMIT = 6;
const RECENT_PITCHER_LIMIT = 5;

function pickAvoidingRecent<T extends { id: string }>(pool: T[], recent: string[]): T {
  const fresh = pool.filter((p) => !recent.includes(p.id));
  const candidates = fresh.length > 0 ? fresh : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Pitcher-pick variant that ALSO filters out same-team / same-name as the
 * already-chosen batter. Two-way Ohtani lives in both `BATTERS` and
 * `PITCHERS` (`ohtani-bat` and `ohtani-pit`) and was the headline case --
 * the HUD literally read "SHOHEI OHTANI" on both sides of the matchup. The
 * same-team filter rules out other surreal pairings like Aaron Judge (NYY)
 * batting against Gerrit Cole (NYY), which broke the fiction even when the
 * mechanics worked correctly.
 *
 * Falls back through filter tiers (recent + team + name -> recent + name ->
 * recent only -> raw pool) so the pick never starves on a pool small enough
 * to make every option overlap on something.
 */
function pickPitcherForBatter(
  pool: MlbPlayer[],
  recent: string[],
  batter: MlbPlayer,
): MlbPlayer {
  const tiers: ((p: MlbPlayer) => boolean)[] = [
    (p) => !recent.includes(p.id) && p.team !== batter.team && p.name !== batter.name,
    (p) => !recent.includes(p.id) && p.name !== batter.name,
    (p) => !recent.includes(p.id),
  ];
  for (const filter of tiers) {
    const candidates = pool.filter(filter);
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function pushRecent(list: string[], id: string, limit: number): string[] {
  const next = [id, ...list.filter((x) => x !== id)];
  return next.slice(0, limit);
}

/**
 * Resolve which drafted player pools should staff the next at-bat. The
 * batting team's drafted batters fill the batter slot; the fielding team's
 * drafted pitchers fill the pitcher slot. Returns empty pools when no
 * draft has been completed -- `freshAtBat` then falls back to the global
 * BATTERS / PITCHERS lists, preserving back-compat for tests and the
 * INITIAL_AT_BAT seed.
 */
function rosterPoolsFor(s: { draft: DraftState | null; userTeam: Team; half: Half }): {
  battersPool?: MlbPlayer[];
  pitchersPool?: MlbPlayer[];
} {
  if (!s.draft || s.draft.phase !== "complete") return {};
  const battingTeam: Team = s.half === "top" ? "AWAY" : "HOME";
  const battingSide = battingTeam === s.userTeam ? "user" : "ai";
  const fieldingSide = battingSide === "user" ? "ai" : "user";
  return {
    battersPool: s.draft.roster[battingSide].batters,
    pitchersPool: s.draft.roster[fieldingSide].pitchers,
  };
}

interface FreshAtBat {
  batter: MlbPlayer;
  pitcher: MlbPlayer;
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  pendingChoices: PendingChoice[];
  pendingReveals: PendingReveal[];
  /**
   * Pitcher card IDs whose hand-transform actually changed at least one batter
   * card this round. The UI's BatterStatusStrip uses this to show "Squares
   * Flat", "Values Capped", etc. ONLY when the effect would produce a visible
   * difference. Without this filter the chip would render whenever the pitcher
   * happened to be holding the trigger card, which leaked the pitcher's hand
   * (the cards are face-down) and surfaced confusing irrelevant warnings.
   */
  pitcherTransformsImpactingBatter: string[];
}

/**
 * Build the next at-bat: pick a random batter & pitcher, deal both hands,
 * then run the hand-transform pre-pass so any round-level shape mods, value
 * caps or ban effects are baked in BEFORE the player starts arranging cards.
 *
 * Also derives the pending choice/reveal queues from cards in either hand so
 * the eventual modal/peek UI knows what to ask about.
 */
/**
 * Optional roster pools to draw from. After a completed draft, the store
 * passes in the BATTING TEAM's drafted batters and the FIELDING TEAM's
 * drafted pitchers so each at-bat is staffed from the team the user (or AI)
 * actually built. When omitted, falls back to the full BATTERS / PITCHERS
 * pool -- preserves the existing seed-deal-on-import flow and keeps tests
 * that don't run a draft happy.
 */
interface FreshAtBatOptions {
  recent?: { batters?: string[]; pitchers?: string[] };
  battersPool?: MlbPlayer[];
  pitchersPool?: MlbPlayer[];
}

function freshAtBat(opts: FreshAtBatOptions = {}): FreshAtBat {
  const battersPool = opts.battersPool && opts.battersPool.length > 0 ? opts.battersPool : BATTERS;
  const pitchersPool = opts.pitchersPool && opts.pitchersPool.length > 0 ? opts.pitchersPool : PITCHERS;
  const batter = pickAvoidingRecent(battersPool, opts.recent?.batters ?? []);
  const pitcher = pickPitcherForBatter(
    pitchersPool,
    opts.recent?.pitchers ?? [],
    batter,
  );
  const rawBatter = dealHand(batter);
  const rawPitcher = dealHand(pitcher);

  // Phase 2 ordering: roster mods (add/remove/swap) run BEFORE shape/value
  // transforms, so b-21 / p-31 / p-47 etc. see the final hand composition.
  // Per-at-bat seed: applyDealEffects used to pull `Math.random()` directly
  // which made b-67 / p-54 / p-77 redraws non-reproducible (and triggered a
  // documented ~10% flaky test in `__effects_check`). Threading a single
  // mulberry seed in lets bug reports / tests pin a specific outcome.
  const dealSeed = Math.floor(Math.random() * 0x7fffffff);
  const dealResult = applyDealEffects(rawBatter, rawPitcher, dealSeed);
  const transformed = applyHandTransforms(dealResult.batterHand, dealResult.pitcherHand);

  // Choices & reveals key off the post-deal hands (e.g. b-67 may have
  // dropped itself, in which case there is no "guess" to ask about).
  const pendingChoices = derivePendingChoices(transformed.batterHand, transformed.pitcherHand);
  const pendingReveals = derivePendingReveals(transformed.batterHand, transformed.pitcherHand);

  return {
    batter,
    pitcher,
    batterHand: transformed.batterHand,
    pitcherHand: transformed.pitcherHand,
    pendingChoices,
    pendingReveals,
    pitcherTransformsImpactingBatter: Array.from(transformed.pitcherTransformsImpactingBatter),
  };
}

function derivePendingChoices(
  batterHand: CardDefinition[],
  pitcherHand: CardDefinition[],
): PendingChoice[] {
  const SHAPE_OPTIONS: ShapeType[] = ["circle", "diamond", "square", "star"];
  const out: PendingChoice[] = [];

  // b-12 Switch Hitter: change the shape of one of YOUR General cards.
  // Eligible targets are batting generals only -- skip the prompt entirely if
  // the batter happens to have no generals (rare, but possible after b-67 or
  // p-39 fire at deal time).
  if (batterHand.some((c) => c.id === "b-12")) {
    const targets = batterHand
      .filter((c) => c.abilityType === "General Draw")
      .map((c) => c.id);
    if (targets.length > 0) {
      out.push({
        cardId: "b-12",
        side: "Batting",
        type: "pickShape",
        options: SHAPE_OPTIONS,
        targets,
      });
    }
  }

  if (batterHand.some((c) => c.id === "b-65")) {
    out.push({ cardId: "b-65", side: "Batting", type: "guessShape", options: SHAPE_OPTIONS });
  }

  // p-56 Pinpoint Control: change the shape of any of YOUR pitcher cards
  // (signatures included -- the pitcher can shape any pitch in his arsenal,
  // and giving the player p-56 itself as a target is intentional).
  if (pitcherHand.some((c) => c.id === "p-56")) {
    const targets = pitcherHand.map((c) => c.id);
    out.push({
      cardId: "p-56",
      side: "Pitching",
      type: "pickShape",
      options: SHAPE_OPTIONS,
      targets,
    });
  }

  // p-41 Sweeping Slider's "pickConnection" lands in a later phase once the
  // seam-selection UI exists. Until then lockIn auto-targets the strongest seam.
  return out;
}

export function derivePendingReveals(
  batterHand: CardDefinition[],
  pitcherHand: CardDefinition[],
): PendingReveal[] {
  const out: PendingReveal[] = [];
  if (batterHand.some((c) => c.id === "b-7")) {
    out.push({ forSide: "Batting", reveal: "opponentUncombined", source: "Soto Shuffle" });
  }
  if (batterHand.some((c) => c.id === "b-121")) {
    out.push({ forSide: "Batting", reveal: "signatureShapes", source: "Catcher's Eye" });
  }
  if (pitcherHand.some((c) => c.id === "p-51")) {
    out.push({ forSide: "Pitching", reveal: "opponentHand", source: "Veteran Savvy" });
  }
  if (pitcherHand.some((c) => c.id === "p-59")) {
    out.push({ forSide: "Pitching", reveal: "opponentLayout", source: "Nasty Slider" });
  }
  return out;
}

function seedQuestState(): {
  activeQuests: string[];
  questProgress: Record<string, QuestProgressState>;
  completedQuests: string[];
  questCelebrationQueue: string[];
  questTick: number;
} & typeof QUEST_REWARD_INITIAL {
  const activeQuests = rollQuestSlate();
  const questProgress: Record<string, QuestProgressState> = {};
  for (const id of activeQuests) {
    questProgress[id] = initialQuestProgress();
  }
  return {
    activeQuests,
    questProgress,
    completedQuests: [],
    questCelebrationQueue: [],
    questTick: 0,
    ...QUEST_REWARD_INITIAL,
  };
}

function questStateFromManualIds(ids: string[]): ReturnType<typeof seedQuestState> {
  const valid = ids.filter((id) => QUEST_REGISTRY[id]);
  if (valid.length !== 3) return seedQuestState();
  const questProgress: Record<string, QuestProgressState> = {};
  for (const id of valid) {
    questProgress[id] = initialQuestProgress();
  }
  return {
    activeQuests: valid,
    questProgress,
    completedQuests: [],
    questCelebrationQueue: [],
    questTick: 0,
    ...QUEST_REWARD_INITIAL,
  };
}

const INITIAL_AT_BAT = freshAtBat();

// Boot the app into a quiescent "selecting" phase with the placeholder
// at-bat above sitting idle behind the StartGameScreen. The start screen
// (gated by `showStartScreen`) renders on top until the player picks a
// lane (auction or quick match), at which point the appropriate action
// (`startDraft` or `startQuickMatch`) takes over and replaces the
// placeholder at-bat with one drawn from the actual rosters.
//
// Booting at "selecting" rather than "drafting" means we don't open the
// auction overlay before the player has even chosen the lane. `draft`
// stays null until a lane action populates it -- gameplay code already
// tolerates a null draft (falls back to the global player pool via
// `rosterPoolsFor`), so the scene behind the start screen renders fine.

export const useGameStore = create<GameState>((set, get) => ({
  inning: 1,
  half: "top",
  outs: 0,
  isFirstAtBatOfInning: true,
  totalInnings: 9,

  // Default AWAY preserves the historical "user bats in the top of the
  // 1st" cadence -- existing tests and playtest muscle memory carry over.
  userTeam: "AWAY",
  // No lane committed yet -- the StartGameScreen will set this when the
  // player picks a lane. Cleared by `reset` so the post-`reset` boot still
  // shows the lane chooser instead of leaking the prior session's mode.
  gameMode: null,

  homeScore: 0,
  awayScore: 0,
  bases: [false, false, false],
  baseRunners: [null, null, null],

  phase: "selecting",
  ...INITIAL_AT_BAT,
  atBatId: 1,

  // The lane chooser is up by default on first boot. Closes when the
  // player commits via `startDraft` / `startQuickMatch`; reopens from the
  // game-over screen via `setShowStartScreen(true)`.
  showStartScreen: true,

  // Tutorial defaults to off. Activated by `startTutorial()` (called
  // immediately after `startQuickMatch('AWAY')` from the Learn to Play
  // button on the StartGameScreen).
  tutorialActive: false,
  tutorialStepIndex: 0,

  lastOutcome: null,
  lastBatterScore: 0,
  lastPitcherScore: 0,
  lastResultMessage: "",
  lastResolveLog: [],
  lastBatterCardModifiers: {},
  lastPitcherCardModifiers: {},
  lastRevealMathSnapshot: null,
  runnerMoves: [],

  pendingDebuffs: [],
  resolvedChoices: {},
  activeChoiceCardId: null,
  coinFlips: {},
  // Fresh hand = zero affirmed connections. Even if the dealt order
  // happens to put two mateable cards next to each other, they don't
  // chain until the player drags one of them in place.
  affirmedSeams: new Set<string>(),
  recentBatterIds: [INITIAL_AT_BAT.batter.id],
  recentPitcherIds: [INITIAL_AT_BAT.pitcher.id],

  revealScript: [],
  pendingResolvedPhase: null,
  revealUiUserSide: null,

  // Empty until the player picks a lane on the StartGameScreen. Auction
  // path: `startDraft` populates with `initDraftState()` and the user
  // builds it via the auction. Quick-match path: `startQuickMatch`
  // populates with `buildQuickMatchDraft()` and skips straight to play.
  draft: null,

  activeQuests: [],
  questProgress: {},
  completedQuests: [],
  questCelebrationQueue: [],
  questTick: 0,
  questShakeRequestId: 0,
  ...QUEST_REWARD_INITIAL,

  reorderBatterHand: (cards) => set({ batterHand: cards }),
  reorderPitcherHand: (cards) => set({ pitcherHand: cards }),

  affirmDraggedCard: (cardId) =>
    set((s) => {
      // Recompute against whichever hand the user is currently playing.
      // When pitching, drags happen on the pitcher hand, so its seams
      // are the ones that affirm/de-affirm.
      const hand = getUserSide(s) === "Batting" ? s.batterHand : s.pitcherHand;
      const idx = hand.findIndex((c) => c.id === cardId);
      if (idx === -1) return {};

      // Build the next set in two passes:
      //   1. Carry over any previously-affirmed seams that are STILL valid
      //      (still adjacent, still canConnect). Anything else falls off --
      //      moved-apart cards lose their bond, even if the user re-adjacent
      //      them later (re-adjacency is a fresh decision).
      //   2. Affirm the dragged card's new left + right seams if those
      //      neighbors mechanically connect.
      const next = new Set<string>();
      for (let i = 1; i < hand.length; i++) {
        const a = hand[i - 1];
        const b = hand[i];
        const key = seamKey(a.id, b.id);
        if (s.affirmedSeams.has(key) && canConnect(a, b)) {
          next.add(key);
        }
      }
      if (idx > 0) {
        const left = hand[idx - 1];
        const me = hand[idx];
        if (canConnect(left, me)) next.add(seamKey(left.id, me.id));
      }
      if (idx < hand.length - 1) {
        const me = hand[idx];
        const right = hand[idx + 1];
        if (canConnect(me, right)) next.add(seamKey(me.id, right.id));
      }
      return { affirmedSeams: next };
    }),

  resolveChoice: (cardId, value) =>
    set((s) => {
      const remainingChoices = s.pendingChoices.filter((c) => c.cardId !== cardId);
      const resolvedChoices = { ...s.resolvedChoices, [cardId]: value };
      // Always close the modal once the player commits -- the trigger pill
      // for this card disappears in the same render because the choice is
      // now in `resolvedChoices` and out of `pendingChoices`.
      const activeChoiceCardId =
        s.activeChoiceCardId === cardId ? null : s.activeChoiceCardId;

      // Modify-shape choices (b-12 Switch Hitter, p-56 Pinpoint Control):
      // the modal hands us {targetCardId, side, shape}. The player owns the
      // pick of card AND side; the engine just applies it to the right hand.
      if (value.kind === "modifyShape") {
        const owningHandKey = cardId === "b-12" ? "batterHand" : cardId === "p-56" ? "pitcherHand" : null;
        if (!owningHandKey) {
          return { resolvedChoices, pendingChoices: remainingChoices, activeChoiceCardId };
        }
        const hand = s[owningHandKey];
        const idx = hand.findIndex((c) => c.id === value.targetCardId);
        if (idx === -1) {
          // Target not in the prompting player's hand -- ignore silently.
          return { resolvedChoices, pendingChoices: remainingChoices, activeChoiceCardId };
        }
        // b-12 only allows the player to retarget their own General cards;
        // refuse a sneaky signature pick that bypasses the modal's filter.
        if (cardId === "b-12" && hand[idx].abilityType !== "General Draw") {
          return { resolvedChoices, pendingChoices: remainingChoices, activeChoiceCardId };
        }
        const updated = [...hand];
        updated[idx] =
          value.side === "left"
            ? { ...updated[idx], leftShape: value.shape }
            : { ...updated[idx], rightShape: value.shape };
        return {
          resolvedChoices,
          pendingChoices: remainingChoices,
          activeChoiceCardId,
          [owningHandKey]: updated,
        };
      }

      // b-65 Guess Pitch (kind === "shape"): just record the answer; lockIn
      // applies the bonus during scoring.
      return { resolvedChoices, pendingChoices: remainingChoices, activeChoiceCardId };
    }),

  triggerChoice: (cardId) =>
    set((s) => {
      // Defensive: only open the modal if this card actually has an open
      // pending choice on the user's side. Stale clicks (e.g. a queued
      // pointer event firing after lockIn cleared `pendingChoices`) become
      // a no-op so we never strand the modal on a non-existent choice.
      const userSide = getUserSide(s);
      const exists = s.pendingChoices.some(
        (c) => c.cardId === cardId && c.side === userSide,
      );
      if (!exists) return {};
      return { activeChoiceCardId: cardId };
    }),

  dismissChoice: () => set({ activeChoiceCardId: null }),

  scoreBatter: () => {
    const s = get();
    // p-36 Ace's Command: nullify the mechanic of the batter's highest card.
    const aceCommand = s.pitcherHand.some((c) => c.id === "p-36");
    const nullified = new Set<string>();
    if (aceCommand) {
      const top = highestValueCard(s.batterHand);
      if (top) nullified.add(top.id);
    }
    const ctx: ScoringContext = {
      side: "Batting",
      inning: s.inning,
      isFirstAtBatOfInning: s.isFirstAtBatOfInning,
      outs: s.outs,
      isFinalInning: s.inning === s.totalInnings,
      batterHandedness: s.batter.handedness,
      pitcherHandedness: s.pitcher.handedness,
      opponentHand: s.pitcherHand,
      opponentBaseCard: highestValueCard(s.pitcherHand),
      nullifiedCardIds: nullified,
      coinFlips: s.coinFlips,
      // Phase 6: live game-state triggers for runners / score / half.
      bases: s.bases,
      half: s.half,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      // Manual-chain mechanic: the user's side reads from `affirmedSeams`,
      // the AI's side stays on legacy auto-connect (`null`). Branch on
      // current seat -- when the user is pitching, the batter is the AI.
      affirmedSeams: getUserSide(s) === "Batting" ? s.affirmedSeams : null,
      // The OPPOSITE seat's seams: when the user is batting, the pitcher
      // (AI) uses null/auto-connect; when the user is pitching, the
      // batter (AI) uses null. Effects keyed off opponent combo state
      // (b-2, p-50, p-57, ...) read from this so combo detection on the
      // opponent's hand matches the seam set scoring will actually use.
      opponentAffirmedSeams: getUserSide(s) === "Pitching" ? s.affirmedSeams : null,
      questHitScaleBonus:
        s.questPendingBattingHitScale > 0 ? s.questPendingBattingHitScale : undefined,
    };
    return scoreHand(s.batterHand, ctx);
  },

  scorePitcher: () => {
    const s = get();
    // Phase 7: batter-side cards that suppress pitcher mechanics this round.
    //  - b-105 Atlanta-LA Ring: nullifies the pitcher's BASE card ability.
    //  - b-108 DH Threat: nullifies any off-speed pitch ability.
    //  - b-127 Mr. Smile: when combined, nullifies the pitcher's lowest
    //    UNCOMBINED card. Adds an id to `nullifiedCardIds` (same channel
    //    p-36 Ace's Command uses).
    //
    // All three flags only fire when the BATTER holds the card -- they're
    // indexed off `s.batterHand` regardless of who the user is playing as, so
    // the AI batter's b-105/b-108/b-127 still apply when the user is pitching.
    const nullifyOpponentBaseMechanic = s.batterHand.some((c) => c.id === "b-105");
    const offSpeedThreat = s.batterHand.some((c) => c.id === "b-108");
    const nullifyOpponentTagMechanics = offSpeedThreat
      ? (["off-speed"] as const)
      : undefined;

    const nullifiedSet = new Set<string>();
    const batterAffirmed =
      getUserSide(s) === "Batting" ? s.affirmedSeams : null;
    if (
      s.batterHand.some((c) => c.id === "b-127") &&
      isCardCombinedInHand(s.batterHand, "b-127", batterAffirmed)
    ) {
      // M3 fix: pass the SAME affirmedSeams that scorePitcher will use to
      // group the pitcher hand. Previously this used `null` (auto-connect),
      // which could mark a card "uncombined" here that scorePitcher would
      // then group into a chain -- silencing the wrong card.
      const pitcherAffirmed =
        getUserSide(s) === "Pitching" ? s.affirmedSeams : null;
      const target = lowestUncombinedInHand(s.pitcherHand, pitcherAffirmed);
      if (target) nullifiedSet.add(target.id);
    }

    const ctx: ScoringContext = {
      side: "Pitching",
      inning: s.inning,
      isFirstAtBatOfInning: s.isFirstAtBatOfInning,
      outs: s.outs,
      isFinalInning: s.inning === s.totalInnings,
      batterHandedness: s.batter.handedness,
      pitcherHandedness: s.pitcher.handedness,
      opponentHand: s.batterHand,
      opponentBaseCard: highestValueCard(s.batterHand),
      nullifiedCardIds: nullifiedSet.size > 0 ? nullifiedSet : undefined,
      coinFlips: s.coinFlips,
      // Phase 6: live game-state triggers for runners / score / half.
      bases: s.bases,
      half: s.half,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
      // Phase 7 silencers (set above).
      nullifyOpponentBaseMechanic,
      nullifyOpponentTagMechanics,
      // Mirror of scoreBatter: route affirmedSeams to whichever side
      // the user is currently playing. AI keeps legacy auto-connect.
      affirmedSeams: getUserSide(s) === "Pitching" ? s.affirmedSeams : null,
      // Opposite seat's seams (see scoreBatter for rationale).
      opponentAffirmedSeams: getUserSide(s) === "Batting" ? s.affirmedSeams : null,
    };
    return scoreHand(s.pitcherHand, ctx);
  },

  previewMatchup: () => {
    const s = get();
    // Mirror lockIn's p-41 Sweeping Slider seam-break here so the preview
    // pill matches the eventual locked-in score. Without this, hands facing
    // p-41 silently dropped a few points at lock-in (the seam break is hidden
    // until then), which read as a "score jumped from 27 to 23" surprise to
    // playtesters. The mutation is deterministic (always the first card of
    // the best group's right seam) so a stable preview is fair: the player
    // can still rearrange their hand, but they can't reverse-engineer their
    // way out of the seam break.
    const workingBatter = applySweepingSliderMutation(s);
    const batterResult =
      workingBatter === s.batterHand
        ? s.scoreBatter()
        : scoreHandFor(s, workingBatter, "Batting");
    const pitcherResult = s.scorePitcher();
    // Selection-phase preview: hide the guess-pitch bonus from the pill so
    // the player doesn't get a free "did I guess right?" tell from the
    // pitcher's still-face-down hand. lockIn calls computeMatchup with the
    // default `revealsGuess: true` so the final score still reflects it.
    const m = computeMatchup(s, batterResult, pitcherResult, /* revealsGuess */ false);
    return {
      batterDisplay: m.batterDisplay,
      pitcherDisplay: m.pitcherDisplay,
      batterWinning: m.batterWins,
      batterHitScaleBonus: m.batterHitScaleNet,
      // The strip and "Best chain" / breakdown UI all key off the same
      // ScoringResult that fed the pill -- when p-41 mutates the working
      // hand, the per-card values, the bestGroup membership ring, and the
      // pill total all stay in lockstep.
      batterScoringResult: batterResult,
      pitcherScoringResult: pitcherResult,
      batterChainSum: m.batterChainSum,
      batterPitcherDelta: m.batterPitcherDelta,
      batterCarryoverDelta: m.batterCarryoverDelta,
      batterGuessDelta: m.batterGuessDelta,
      batterIgnoresDebuffs: m.batterIgnoresDebuffs,
      pitcherChainSum: m.pitcherChainSum,
      pitcherBatterDelta: m.pitcherBatterDelta,
      pitcherCarryoverDelta: m.pitcherCarryoverDelta,
    };
  },

  lockIn: () => {
    const sBefore = get();
    if (sBefore.phase !== "selecting") return;
    // Tutorial gate: while the walkthrough is active, lockIn is a no-op
    // EXCEPT on the very last step (the interactive "Press Lock In" beat).
    // On that step, lockIn implicitly dismisses the tutorial and then
    // resolves the at-bat normally, so the walkthrough dissolves into
    // live play without a separate confirmation.
    if (sBefore.tutorialActive) {
      const isFinalStep =
        sBefore.tutorialStepIndex >= TUTORIAL_STEPS.length - 1;
      if (!isFinalStep) return;
      set({ tutorialActive: false, tutorialStepIndex: 0 });
    }
    // Invariant guard: lockIn requires non-empty hands on both sides.
    // Empty hands would silently produce empty `bestGroup`s and many
    // resolveStep / scoring effects would no-op against `false`. We
    // surface the violation in dev so a corruption upstream is caught
    // early instead of resolving as a bizarre stalemate.
    if (sBefore.batterHand.length === 0 || sBefore.pitcherHand.length === 0) {
      if (typeof console !== "undefined") {
        console.error("[lockIn] aborting: empty hand", {
          batter: sBefore.batterHand.length,
          pitcher: sBefore.pitcherHand.length,
        });
      }
      return;
    }

    // Coin flips resolve at lock-in (b-22 Power/Speed Threat). We populate
    // the store BEFORE any scoring call so scoreBatter / scoreHandFor pick
    // them up via ScoringContext. Re-grab state after the set so the rest of
    // lockIn reads the resolved flips. The probe score for p-41 below also
    // sees the resolved flip, but b-22 only contributes when combined, so a
    // re-score after p-41 mutates the hand will use the same flip.
    const nextFlips: Record<string, "heads" | "tails"> = { ...sBefore.coinFlips };
    if (sBefore.batterHand.some((c) => c.id === "b-22") && nextFlips["b-22"] === undefined) {
      nextFlips["b-22"] = Math.random() < 0.5 ? "heads" : "tails";
    }
    if (nextFlips !== sBefore.coinFlips) {
      set({ coinFlips: nextFlips });
    }
    const s = get();

    // p-41 Sweeping Slider: post-arrangement combo break. The seam break
    // mutation lives only inside the scoring path -- the visible batterHand
    // is not changed (Phase 5 will surface the mutated card in the UI).
    // Shared with `previewMatchup` so what the player sees during selection
    // is identical to what they get at lock-in.
    const workingBatterHand = applySweepingSliderMutation(s);

    // Re-derive scoring against the (possibly mutated) batter hand. We pass
    // the working hand through a temporary state shim so scoreBatter sees it.
    const batterResult = workingBatterHand === s.batterHand
      ? s.scoreBatter()
      : scoreHandFor(s, workingBatterHand, "Batting");
    const pitcherResult = s.scorePitcher();

    const m = computeMatchup(s, batterResult, pitcherResult);

    const consumedForceHomer =
      s.questForceHomerunOnce && m.batterWins && !batterResult.forcedOutcome;
    const effectiveBatterResult = consumedForceHomer
      ? { ...batterResult, forcedOutcome: "homerun" as const }
      : batterResult;

    let outcome: HitOutcome;
    if (effectiveBatterResult.forcedOutcome && m.batterWins) {
      outcome = effectiveBatterResult.forcedOutcome;
    } else if (pitcherResult.forcedOutcome && !m.batterWins) {
      outcome = pitcherResult.forcedOutcome;
    } else if (!m.batterWins) {
      outcome = "out";
    } else {
      outcome = resolveHitScale(m.hitScaleValue);
    }

    // Resolve-step hook: cards may bend the outcome (extra outs, pickoff,
    // sacrifice fly, queue cross-at-bat debuffs).
    const resolveDelta = applyResolveStep({
      batterHand: s.batterHand,
      pitcherHand: s.pitcherHand,
      bases: s.bases,
      batterResult,
      pitcherResult,
      batterTotal: m.batterTotal,
      pitcherTotal: m.pitcherTotal,
      batterWins: m.batterWins,
    });

    const next = applyOutcome(s, outcome, resolveDelta);
    const message = formatOutcome(outcome, m.batterDisplay, m.pitcherDisplay, s.batter.name);

    const battingTeam: Team = s.half === "top" ? "AWAY" : "HOME";
    const isUserTeamBatting = battingTeam === s.userTeam;
    const humanSide = getUserSide(s);
    const humanWonMatchup =
      humanSide === "Batting" ? m.batterWins : !m.batterWins;
    const inningTransitioned = next.half !== s.half || next.inning !== s.inning;

    let rs = {
      questPendingBattingHitScale:
        s.questPendingBattingHitScale > 0 ? 0 : s.questPendingBattingHitScale,
      questForceHomerunOnce: consumedForceHomer ? false : s.questForceHomerunOnce,
      questWildcardNextBatterHand: s.questWildcardNextBatterHand,
      questLegendaryCelebratePulse: s.questLegendaryCelebratePulse,
    };

    const questPatch: Partial<GameState> = { ...rs };

    if (s.activeQuests.length > 0) {
      const { nextProgress, newlyCompleted } = applyQuestTickToAll(
        s.activeQuests,
        s.questProgress,
        {
          phase: "afterLockIn",
          userTeam: s.userTeam,
          inningAtAbStart: s.inning,
          halfAtAbStart: s.half,
          isUserTeamBatting,
          humanWonMatchup,
          lastOutcome: outcome,
          prePlayHomeScore: s.homeScore,
          prePlayAwayScore: s.awayScore,
          postPlayHomeScore: next.homeScore,
          postPlayAwayScore: next.awayScore,
          phaseAfter: next.phase,
          batterBestChainLength: batterResult.bestGroup.length,
          inningTransitioned,
        },
      );
      for (const id of newlyCompleted) {
        const def = QUEST_REGISTRY[id];
        if (def) rs = mergeQuestReward(rs, def.reward);
      }
      const progressChanged =
        JSON.stringify(nextProgress) !== JSON.stringify(s.questProgress);
      if (progressChanged && newlyCompleted.length === 0) {
        playSfx("questTick");
      }
      if (newlyCompleted.length > 0) {
        const anyLeg = newlyCompleted.some(
          (id) => QUEST_REGISTRY[id]?.rarity === "legendary",
        );
        playSfx(anyLeg ? "legendary" : "questComplete");
      }
      Object.assign(questPatch, {
        questProgress: nextProgress,
        questCelebrationQueue: [...s.questCelebrationQueue, ...newlyCompleted],
        completedQuests: Array.from(new Set([...s.completedQuests, ...newlyCompleted])),
        questTick:
          s.questTick +
          (newlyCompleted.length > 0 || progressChanged ? 1 : 0),
        questShakeRequestId:
          s.questShakeRequestId + (newlyCompleted.length > 0 ? 1 : 0),
        questPendingBattingHitScale: rs.questPendingBattingHitScale,
        questForceHomerunOnce: rs.questForceHomerunOnce,
        questWildcardNextBatterHand: rs.questWildcardNextBatterHand,
        questLegendaryCelebratePulse: rs.questLegendaryCelebratePulse,
      });
    }

    // Drain expired debuffs (they served this at-bat) and append newly queued ones.
    const drainedDebuffs = s.pendingDebuffs
      .map((d) => ({ ...d, remainingAtBats: d.remainingAtBats - 1 }))
      .filter((d) => d.remainingAtBats > 0);
    const nextDebuffs = [...drainedDebuffs, ...resolveDelta.pendingDebuffs];

    // Reveal-sequence orchestrator: park the at-bat in `revealing` while the
    // UI animates each scoring beat. The resolved-state phase (between-at-bats
    // or game-over) is stashed and applied by `completeReveal` once the UI
    // finishes the script. Other state mutations (bases, runs, outs, message,
    // score) still flush now so the orchestrator and the post-reveal banner
    // share the same numbers.
    const script = buildRevealScript(s, batterResult, pitcherResult, m);

    const lastRevealMathSnapshot: RevealMathSnapshot = {
      batter: {
        chainSum: m.batterChainSum,
        pitcherDelta: m.batterPitcherDelta,
        carryoverDelta: m.batterCarryoverDelta,
        guessDelta: m.batterGuessDelta,
        total: m.batterDisplay,
        ignoresDebuffs: m.batterIgnoresDebuffs,
        chainOf: batterResult.bestGroup.length,
        handSize: s.batterHand.length,
      },
      pitcher: {
        chainSum: m.pitcherChainSum,
        batterDelta: m.pitcherBatterDelta,
        carryoverDelta: m.pitcherCarryoverDelta,
        total: m.pitcherDisplay,
        chainOf: pitcherResult.bestGroup.length,
        handSize: s.pitcherHand.length,
      },
    };

    set({
      ...next,
      ...questPatch,
      lastOutcome: outcome,
      // Persist the COMPREHENSIVE display values (not the raw head-to-head
      // totals) so the resolved view matches the live preview pill.
      lastBatterScore: m.batterDisplay,
      lastPitcherScore: m.pitcherDisplay,
      // Snapshot the per-card modifier values at lock-in so the result phase
      // displays exactly what the player committed to. Otherwise state-trigger
      // cards (b-91 RBI Threat, b-93 Comeback Kid, b-96 Home Cookin', etc.)
      // re-evaluate against the post-resolution world (bases just cleared on
      // a HR, score just changed, half just flipped) and the player watches
      // their card numbers silently shift between lock-in and the result
      // banner with no in-game explanation.
      lastBatterCardModifiers: batterResult.cardModifiers,
      lastPitcherCardModifiers: pitcherResult.cardModifiers,
      lastRevealMathSnapshot,
      lastResultMessage: message,
      // Strip the "b-NN " / "p-NN " card-id prefix the resolveStep prepends
      // for debugging; the player only needs the human-readable tail (e.g.
      // "Stolen Bag: extra runner placed on 1B").
      lastResolveLog: resolveDelta.log.map((line) => line.replace(/^[bp]-\d+\s+/, "")),
      phase: "revealing",
      pendingResolvedPhase: next.phase,
      revealScript: script,
      runnerMoves: next.runnerMoves,
      pendingDebuffs: nextDebuffs,
      // Phase change closes any modal the player left open. The choice is
      // already snapshot into resolvedChoices (or auto-declined) by the
      // scoring path -- the modal is just visual at this point.
      activeChoiceCardId: null,
      revealUiUserSide: getUserSide(s),
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

  completeQuestCelebration: () =>
    set((st) => ({
      questCelebrationQueue: st.questCelebrationQueue.slice(1),
    })),

  startNextAtBat: () => {
    const s = get();
    if (s.phase === "game-over") return;
    // Defensive: while the tutorial is active, never advance the at-bat.
    // The linear walkthrough doesn't reach this codepath (it ends at the
    // first lockIn, which clears tutorialActive before falling through),
    // but a stray external call from a debug action shouldn't sneak past.
    if (s.tutorialActive) return;
    const pools = rosterPoolsFor(s);
    const ab = freshAtBat({
      recent: { batters: s.recentBatterIds, pitchers: s.recentPitcherIds },
      battersPool: pools.battersPool,
      pitchersPool: pools.pitchersPool,
    });
    const userNext = getUserSide(s);
    let batterHand = ab.batterHand;
    if (s.questWildcardNextBatterHand && userNext === "Batting") {
      batterHand = applyWildcardToFirstGeneral(ab.batterHand);
    }
    set({
      ...ab,
      batterHand,
      atBatId: s.atBatId + 1,
      phase: "selecting",
      lastOutcome: null,
      lastResultMessage: "",
      lastResolveLog: [],
      // Drop the lock-in modifier snapshot so the new at-bat shows live previews.
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      lastRevealMathSnapshot: null,
      runnerMoves: [],
      // Preserve `isFirstAtBatOfInning` from the snapshot. `applyOutcome` sets
      // this flag to true on the third out (i.e. the first at-bat of the
      // newly-flipped half is still pending here), and lockIn -> normal at-bat
      // flow leaves it false. Forcing it to false unconditionally was a bug
      // that broke leadoff effects (b-13 Leadoff Magic, etc.) for every half
      // after the first.
      isFirstAtBatOfInning: s.isFirstAtBatOfInning,
      resolvedChoices: {},
      activeChoiceCardId: null,
      coinFlips: {},
      // Fresh hand -> zero affirmed connections. Player must re-forge any
      // chain by dragging cards in place.
      affirmedSeams: new Set<string>(),
      recentBatterIds: pushRecent(s.recentBatterIds, ab.batter.id, RECENT_BATTER_LIMIT),
      recentPitcherIds: pushRecent(s.recentPitcherIds, ab.pitcher.id, RECENT_PITCHER_LIMIT),
      revealScript: [],
      pendingResolvedPhase: null,
      revealUiUserSide: null,
      questWildcardNextBatterHand: false,
      questLegendaryCelebratePulse: false,
    });
  },

  reset: (team) => {
    const s = get();
    const ab = freshAtBat();
    set({
      inning: 1,
      half: "top",
      outs: 0,
      isFirstAtBatOfInning: true,
      // Preserve the player's team across New Game unless they explicitly
      // re-pick. Default keeps backward-compat for callers that pass nothing.
      userTeam: team ?? s.userTeam,
      homeScore: 0,
      awayScore: 0,
      bases: [false, false, false],
      baseRunners: [null, null, null],
      phase: "selecting",
      ...ab,
      atBatId: s.atBatId + 1,
      lastOutcome: null,
      lastBatterScore: 0,
      lastPitcherScore: 0,
      lastResultMessage: "",
      lastResolveLog: [],
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      lastRevealMathSnapshot: null,
      runnerMoves: [],
      pendingDebuffs: [],
      resolvedChoices: {},
      activeChoiceCardId: null,
      coinFlips: {},
      affirmedSeams: new Set<string>(),
      recentBatterIds: [ab.batter.id],
      recentPitcherIds: [ab.pitcher.id],
      revealScript: [],
      pendingResolvedPhase: null,
      revealUiUserSide: null,
      // `reset` is the legacy "play with random pools" path -- clear any
      // active draft so freshAtBat falls back to the global lists.
      draft: null,
      // Drop the lane commitment too so the StartGameScreen treats the
      // next start as a fresh choice (rather than the in-game New Game
      // button rematching the prior lane).
      gameMode: null,
      // Tutorial state never survives a fresh game.
      tutorialActive: false,
      tutorialStepIndex: 0,
      activeQuests: [],
      questProgress: {},
      completedQuests: [],
      questCelebrationQueue: [],
      questTick: 0,
      questShakeRequestId: 0,
      ...QUEST_REWARD_INITIAL,
    });
  },

  setUserTeam: (team) => set({ userTeam: team }),

  setShowStartScreen: (open) => set({ showStartScreen: open }),

  startTutorial: () => set({ tutorialActive: true, tutorialStepIndex: 0 }),

  tutorialNext: () => {
    const s = get();
    if (!s.tutorialActive) return;
    const next = s.tutorialStepIndex + 1;
    if (next >= TUTORIAL_STEPS.length) {
      // Reached the end without going through the interactive lock-in
      // exit (defensive -- the final step shouldn't expose Next, but if
      // it ever does, fall through to a clean dismiss).
      set({ tutorialActive: false, tutorialStepIndex: 0 });
      return;
    }
    set({ tutorialStepIndex: next });
  },

  tutorialPrev: () => {
    const s = get();
    if (!s.tutorialActive) return;
    if (s.tutorialStepIndex === 0) return;
    set({ tutorialStepIndex: s.tutorialStepIndex - 1 });
  },

  tutorialExit: () => set({ tutorialActive: false, tutorialStepIndex: 0 }),

  // ============ Draft (auction) actions ====================================

  startDraft: (team) => {
    const s = get();
    // Re-deal a placeholder at-bat from the global pools so the 3D backdrop
    // has SOMETHING idle to render behind the draft overlay. `completeDraft`
    // will overwrite this with a real at-bat sourced from the drafted
    // rosters, so this is purely scenery.
    const ab = freshAtBat();
    const draft = initDraftState();
    // Full gameplay reset (matches `reset`) so leftover bases / scores /
    // reveal scripts from a prior game can't bleed through the overlay.
    // Without this, the backdrop visibly carried runners and a half-finished
    // inning into a fresh draft.
    set({
      phase: "drafting",
      userTeam: team,
      gameMode: "draft",
      draft,
      inning: 1,
      half: "top",
      outs: 0,
      isFirstAtBatOfInning: true,
      homeScore: 0,
      awayScore: 0,
      bases: [false, false, false],
      baseRunners: [null, null, null],
      ...ab,
      atBatId: s.atBatId + 1,
      lastOutcome: null,
      lastBatterScore: 0,
      lastPitcherScore: 0,
      lastResultMessage: "",
      lastResolveLog: [],
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      lastRevealMathSnapshot: null,
      runnerMoves: [],
      pendingDebuffs: [],
      resolvedChoices: {},
      activeChoiceCardId: null,
      coinFlips: {},
      affirmedSeams: new Set<string>(),
      recentBatterIds: [ab.batter.id],
      recentPitcherIds: [ab.pitcher.id],
      revealScript: [],
      pendingResolvedPhase: null,
      revealUiUserSide: null,
      activeQuests: [],
      questProgress: {},
      completedQuests: [],
      questCelebrationQueue: [],
      questTick: 0,
      questShakeRequestId: 0,
      ...QUEST_REWARD_INITIAL,
      // Player committed to a lane -- the start screen has done its job.
      showStartScreen: false,
      // Auction draft is never wrapped in a tutorial.
      tutorialActive: false,
      tutorialStepIndex: 0,
    });
  },

  startQuickMatch: (team, questSlate) => {
    const s = get();
    const draft = buildQuickMatchDraft();
    // Same seeding as `completeDraft` -- batting team is determined by
    // the half (top = AWAY) and `userTeam`. The Quick Match path is
    // designed to be indistinguishable from a finished auction once we
    // reach gameplay, so we mirror every reset field `completeDraft`
    // sets, just with `phase: "selecting"` directly (no drafting beat
    // in between).
    const battingTeam: Team = "AWAY"; // half === "top" on a fresh game
    const battingSide = battingTeam === team ? "user" : "ai";
    const fieldingSide = battingSide === "user" ? "ai" : "user";
    const ab = freshAtBat({
      battersPool: draft.roster[battingSide].batters,
      pitchersPool: draft.roster[fieldingSide].pitchers,
    });
    set({
      phase: "selecting",
      userTeam: team,
      gameMode: "quick-match",
      draft,
      inning: 1,
      half: "top",
      outs: 0,
      isFirstAtBatOfInning: true,
      homeScore: 0,
      awayScore: 0,
      bases: [false, false, false],
      baseRunners: [null, null, null],
      ...ab,
      atBatId: s.atBatId + 1,
      lastOutcome: null,
      lastBatterScore: 0,
      lastPitcherScore: 0,
      lastResultMessage: "",
      lastResolveLog: [],
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      lastRevealMathSnapshot: null,
      runnerMoves: [],
      pendingDebuffs: [],
      resolvedChoices: {},
      activeChoiceCardId: null,
      coinFlips: {},
      affirmedSeams: new Set<string>(),
      recentBatterIds: [ab.batter.id],
      recentPitcherIds: [ab.pitcher.id],
      revealScript: [],
      pendingResolvedPhase: null,
      revealUiUserSide: null,
      ...(questSlate && questSlate.length === 3
        ? questStateFromManualIds(questSlate)
        : seedQuestState()),
      questShakeRequestId: 0,
      showStartScreen: false,
      // Tutorial-cleared by default; the "Learn to Play" entry point
      // re-arms it via `startTutorial()` immediately after this call.
      tutorialActive: false,
      tutorialStepIndex: 0,
    });
  },

  draftNominate: (playerId) => {
    const s = get();
    if (s.phase !== "drafting" || !s.draft) return;
    if (s.draft.nominator !== "user") return;
    const next = draftNominateFn(s.draft, playerId, "user");
    if (next === s.draft) return;
    set({ draft: next });
  },

  draftBid: (amount) => {
    const s = get();
    if (s.phase !== "drafting" || !s.draft) return;
    const next = draftPlaceBidFn(s.draft, "user", amount);
    if (next === s.draft) return;
    set({ draft: next });
  },

  draftPass: () => {
    const s = get();
    if (s.phase !== "drafting" || !s.draft) return;
    const next = draftPassFn(s.draft, "user");
    if (next === s.draft) return;
    set({ draft: next });
  },

  draftAiTick: () => {
    const s = get();
    if (s.phase !== "drafting" || !s.draft) return;
    const d = s.draft;
    if (d.phase === "complete") return;
    if (d.phase === "nominating") {
      if (d.nominator !== "ai") return;
      const pick = aiNominate(d);
      if (!pick) {
        // AI has no legal nomination right now (eligible pool empty for
        // its side). Without recovery, the autopilot would loop on this
        // tick forever. `repairDraftStall` either hands nomination to the
        // user (if they have legal picks) or runs deadlock recovery /
        // marks the draft complete with a `deadlocked` flag.
        const repaired = repairDraftStall(d);
        if (repaired !== d) set({ draft: repaired });
        return;
      }
      const next = draftNominateFn(d, pick.id, "ai");
      if (next === d) return;
      set({ draft: next });
      return;
    }
    if (d.phase === "bidding" && d.activeAuction) {
      const auction = d.activeAuction;
      // Only act when AI is the side facing the bid (not the high bidder).
      if (auction.highBidder === "ai") return;
      if (auction.passed.ai) return;
      const decision = aiBidDecision(d);
      if (decision === "raise") {
        const amount = aiBidAmount(d);
        const next = draftPlaceBidFn(d, "ai", amount);
        if (next === d) return;
        set({ draft: next });
      } else {
        const next = draftPassFn(d, "ai");
        if (next === d) return;
        set({ draft: next });
      }
    }
  },

  completeDraft: () => {
    const s = get();
    if (s.phase !== "drafting" || !s.draft) return;
    if (s.draft.phase !== "complete") return;
    // Seed the first at-bat from the drafted rosters.
    const battingTeam: Team = s.half === "top" ? "AWAY" : "HOME";
    const battingSide = battingTeam === s.userTeam ? "user" : "ai";
    const fieldingSide = battingSide === "user" ? "ai" : "user";
    const ab = freshAtBat({
      battersPool: s.draft.roster[battingSide].batters,
      pitchersPool: s.draft.roster[fieldingSide].pitchers,
    });
    set({
      phase: "selecting",
      ...ab,
      atBatId: s.atBatId + 1,
      inning: 1,
      half: "top",
      outs: 0,
      isFirstAtBatOfInning: true,
      homeScore: 0,
      awayScore: 0,
      bases: [false, false, false],
      baseRunners: [null, null, null],
      lastOutcome: null,
      lastBatterScore: 0,
      lastPitcherScore: 0,
      lastResultMessage: "",
      lastResolveLog: [],
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      lastRevealMathSnapshot: null,
      runnerMoves: [],
      pendingDebuffs: [],
      resolvedChoices: {},
      activeChoiceCardId: null,
      coinFlips: {},
      affirmedSeams: new Set<string>(),
      recentBatterIds: [ab.batter.id],
      recentPitcherIds: [ab.pitcher.id],
      revealScript: [],
      pendingResolvedPhase: null,
      revealUiUserSide: null,
      ...seedQuestState(),
      questShakeRequestId: 0,
      // Draft state stays in place AFTER completion -- gameplay reads
      // `draft.roster` to pick the next batter/pitcher each at-bat. Cleared
      // by `reset` or replaced by the next `startDraft`.
    });
  },
}));

/**
 * Score a hand using the same context the store would build, but with an
 * arbitrary card list substituted in. Used by lockIn / previewMatchup when
 * p-41 Sweeping Slider mutates the batter hand mid-resolution.
 *
 * Must mirror EVERY field that `scoreBatter` / `scorePitcher` populate, or
 * the substituted-hand path will silently drop effects (e.g. p-41 was
 * dropping `pitcherHandedness`, which broke b-126 Lefty Mash on the
 * mutation path while preview/normal-path still showed it).
 */
function scoreHandFor(
  s: GameState,
  hand: CardDefinition[],
  side: "Batting" | "Pitching",
): ScoringResult {
  const isBatting = side === "Batting";
  const opponent = isBatting ? s.pitcherHand : s.batterHand;
  const nullified = new Set<string>();

  if (isBatting) {
    // p-36 Ace's Command: nullify the mechanic of the batter's highest card.
    if (s.pitcherHand.some((c) => c.id === "p-36")) {
      const top = highestValueCard(hand);
      if (top) nullified.add(top.id);
    }
  } else {
    // Mirror scorePitcher: b-127 Mr. Smile silences the lowest UNCOMBINED
    // pitcher card when b-127 itself is combined. We pass the same affirmed
    // seams the pitcher hand would actually be scored under so the silence
    // target matches the player's manual chain (M3).
    const batterAffirmed =
      getUserSide(s) === "Batting" ? s.affirmedSeams : null;
    if (
      s.batterHand.some((c) => c.id === "b-127") &&
      isCardCombinedInHand(s.batterHand, "b-127", batterAffirmed)
    ) {
      const pitcherAffirmed =
        getUserSide(s) === "Pitching" ? s.affirmedSeams : null;
      const target = lowestUncombinedInHand(hand, pitcherAffirmed);
      if (target) nullified.add(target.id);
    }
  }

  // Pitching-side silencers carried by the BATTER hand.
  const nullifyOpponentBaseMechanic =
    !isBatting && s.batterHand.some((c) => c.id === "b-105");
  const offSpeedThreat = !isBatting && s.batterHand.some((c) => c.id === "b-108");
  const nullifyOpponentTagMechanics = offSpeedThreat
    ? (["off-speed"] as const)
    : undefined;

  const ctx: ScoringContext = {
    side,
    inning: s.inning,
    isFirstAtBatOfInning: s.isFirstAtBatOfInning,
    outs: s.outs,
    isFinalInning: s.inning === s.totalInnings,
    batterHandedness: s.batter.handedness,
    pitcherHandedness: s.pitcher.handedness,
    opponentHand: opponent,
    opponentBaseCard: highestValueCard(opponent),
    nullifiedCardIds: nullified.size > 0 ? nullified : undefined,
    coinFlips: s.coinFlips,
    // Phase 6: keep state-trigger context aligned with the live store
    // values so probe scores (p-41 Sweeping Slider) see the same world.
    bases: s.bases,
    half: s.half,
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    nullifyOpponentBaseMechanic: nullifyOpponentBaseMechanic || undefined,
    nullifyOpponentTagMechanics,
    // The user's seat reads from affirmedSeams; the AI's seat stays on
    // legacy auto-connect (null = "any adjacent canConnect pair chains").
    affirmedSeams: side === getUserSide(s) ? s.affirmedSeams : null,
    opponentAffirmedSeams: side !== getUserSide(s) ? s.affirmedSeams : null,
    questHitScaleBonus:
      isBatting && s.questPendingBattingHitScale > 0
        ? s.questPendingBattingHitScale
        : undefined,
  };
  return scoreHand(hand, ctx);
}

function sumPendingDebuffs(queue: PendingDebuff[], side: "Batting" | "Pitching"): number {
  let delta = 0;
  for (const d of queue) {
    if (d.appliesToSide !== side) continue;
    delta += d.totalValueDelta ?? 0;
  }
  return delta;
}

/**
 * b-65 Guess Pitch: the batter names a shape; if the pitcher uses it, +4.
 * Phase 4 buff: a missed guess still pays out +1 so the player is never
 * fully punished for committing to the prompt. No guess at all = 0 (the
 * player declined to play the mini-game).
 */
function computeGuessPitchBonus(s: GameState): number {
  if (!s.batterHand.some((c) => c.id === "b-65")) return 0;
  const guess = s.resolvedChoices["b-65"];
  if (!guess || guess.kind !== "shape") return 0;
  const shape = guess.shape;
  const usesShape = s.pitcherHand.some(
    (c) => c.leftShape === shape || c.rightShape === shape,
  );
  return usesShape ? 4 : 1;
}

/**
 * Single source of truth for the per-side scores the UI shows AND the engine
 * compares at lock-in. Combines:
 *  - Each side's `maxValue` (best-group total).
 *  - The opponent's `opponentModifier` (per-card debuffs like p-2 Filthy Stuff).
 *  - The batter's `pitcherCombinedDelta` (b-17 Line Drive style penalties to
 *    the pitcher for combining).
 *  - Cross-at-bat `pendingDebuffs` (p-58 Strikeout Artist).
 *  - The b-65 Guess Pitch bonus.
 *  - b-9 Generational Discipline immunity (zeroes pitcher debuffs + wall +
 *    queued batter debuffs).
 *  - The hit-scale ladder bonus folded into the BATTER'S display ONLY when
 *    the batter is winning the head-to-head (matching the ladder semantics:
 *    "if you win, +N to your hit"). Pitcher's `hitScaleBonus` is treated as
 *    a wall on the batter, so it subtracts from the batter's display rather
 *    than adding to the pitcher's.
 *
 * Returning both the head-to-head totals (for resolve-step / win comparison)
 * and the displayed totals (for UI) lets `lockIn` and `previewMatchup` share
 * the exact same arithmetic; previously the preview pill only showed
 * `maxValue` and surfaced the rest as ad-hoc "Pitcher debuff -N" badges.
 */
interface ComputedMatchup {
  batterTotal: number;
  pitcherTotal: number;
  batterWins: boolean;
  hitScaleValue: number;
  batterDisplay: number;
  pitcherDisplay: number;
  /**
   * Signed net Hit Scale modifier (batter bonus minus pitcher wall, after
   * b-9 immunity). Lives separately from `batterDisplay` so the UI can
   * render a "+N HIT SCALE" badge instead of silently folding the bonus
   * into the pill -- avoiding the playtest "score jumps from 24 to 28
   * between preview and final" surprise.
   */
  batterHitScaleNet: number;
  // Per-component breakdown of `batterTotal` so the UI can surface
  // "chain + pitcher + carryover + guess = pill" math under the BATTER
  // pill. These already exist inside computeMatchup as locals; lifting
  // them onto the return type lets `previewMatchup` forward them to the
  // UI without re-deriving (and without leaking the pillage of cross-side
  // effects from per-card values).
  batterChainSum: number;
  batterPitcherDelta: number;
  batterCarryoverDelta: number;
  batterGuessDelta: number;
  batterIgnoresDebuffs: boolean;
  /** Best-chain value sum for the pitcher's pill (head-to-head total). */
  pitcherChainSum: number;
  /**
   * Batter-side pressure folded into the pitcher's pill: opponentModifier +
   * pitcherCombinedDelta from the batter scoring pass.
   */
  pitcherBatterDelta: number;
  /** Cross-at-bat carryover applied to the pitcher's pill. */
  pitcherCarryoverDelta: number;
}

/**
 * Walk both scoring results and produce the ordered reveal animation script.
 * Ordering (matches the spec from `reveal-sequence-orchestrator.plan.md`):
 *   1. Per-card self modifiers (batter side first, then pitcher side).
 *   2. Targeted opponent debuffs -- batter cards firing at pitcher cards
 *      first (the player's own cards "popping off"), then pitcher-on-batter.
 *   3. Aggregate / non-targeted opponent debuffs (residual from
 *      `opponentModifier` after subtracting the attributed targeted entries,
 *      plus hand-level p-60 Filthy Stuff which lives in the log not the
 *      registry, plus any unattributed `pitcherCombinedDelta` residual).
 *   4. The b-65 Guess Pitch hit (+4 to the batter when correct).
 *   5. Cross-at-bat debuffs draining from `pendingDebuffs` (e.g. p-58
 *      Strikeout Artist hangover).
 *
 * A signature card whose effect contributes through several of these channels
 * gets one beat per channel -- e.g. a hypothetical card that buffs itself AND
 * targets an opponent card would produce both a `selfModifier` beat and a
 * `targetedDebuff` beat.
 */
export function buildRevealScript(
  s: GameState,
  batterResult: ScoringResult,
  pitcherResult: ScoringResult,
  // The fully-resolved matchup is currently unused but kept in the signature
  // so a future final-score "land" beat can reference it without forcing
  // every caller to pass `undefined`. Optional to keep test ergonomics nice.
  matchup?: ComputedMatchup,
): ResolutionBeat[] {
  const beats: ResolutionBeat[] = [];

  const batterIgnoresDebuffs = s.batterHand.some((c) => c.id === "b-9");

  // (1) Self modifiers. Walk the BEST group only -- effects from groups that
  // didn't win don't actually fire, so showing them would mislead.
  const pushSelfMods = (
    side: "Batting" | "Pitching",
    result: ScoringResult,
  ) => {
    for (const card of result.bestGroup) {
      const mod = result.cardModifiers[card.id];
      if (!mod) continue;
      if (mod.value === card.baseValue) continue;
      beats.push({
        kind: "selfModifier",
        cardId: card.id,
        side,
        baseValue: card.baseValue,
        finalValue: mod.value,
      });
    }
  };
  pushSelfMods("Batting", batterResult);
  // b-9 immunity wipes pitcher debuffs -- but those debuffs are in
  // opponentModifier / pitcherCombinedDelta, not selfMods. Pitcher self mods
  // (e.g. p-32 +2) are unaffected by b-9 and still play.
  pushSelfMods("Pitching", pitcherResult);

  // (2) Targeted opponent debuffs. Skip the pitcher's targeted debuffs
  // entirely if b-9 is in the batter's hand -- the engine zeroes them in
  // `computeMatchup`, so the animation must zero them too.
  for (const t of batterResult.targetedOpponentDebuffs) {
    if (t.delta === 0) continue;
    beats.push({
      kind: "targetedDebuff",
      sourceCardId: t.sourceCardId,
      sourceSide: "Batting",
      targetCardId: t.targetCardId,
      targetSide: "Pitching",
      delta: t.delta,
    });
  }
  if (!batterIgnoresDebuffs) {
    for (const t of pitcherResult.targetedOpponentDebuffs) {
      if (t.delta === 0) continue;
      beats.push({
        kind: "targetedDebuff",
        sourceCardId: t.sourceCardId,
        sourceSide: "Pitching",
        targetCardId: t.targetCardId,
        targetSide: "Batting",
        delta: t.delta,
      });
    }
  }

  // (3) Aggregate residuals. Anything in `opponentModifier` that the targeted
  // list didn't account for is an aggregate (p-38 Wipeout Changeup, p-72
  // 12-to-6 Curveball, p-60 Filthy Stuff, etc). The batter's
  // pitcherCombinedDelta is treated the same way.
  const batterTargetedSum = sumDeltas(batterResult.targetedOpponentDebuffs);
  const batterAggregateResidual = batterResult.opponentModifier - batterTargetedSum;
  if (batterAggregateResidual !== 0) {
    // b-78 Bullpen Beater fires at hand-level (so it always hits even when
    // held outside the best group). Detect it directly from batterHand before
    // falling back to the per-card scan, otherwise findAggregateSource won't
    // find a match because the per-card effect is intentionally a no-op.
    const bullpen = s.batterHand.find((c) => c.id === "b-78");
    const source =
      bullpen ?? findAggregateSource(s.batterHand, batterResult, s, "Batting");
    if (source) {
      beats.push({
        kind: "aggregateDebuff",
        sourceCardId: source.id,
        sourceSide: "Batting",
        affectedSide: "Pitching",
        delta: batterAggregateResidual,
        label: source.name,
      });
    }
  }

  if (!batterIgnoresDebuffs) {
    const pitcherTargetedSum = sumDeltas(pitcherResult.targetedOpponentDebuffs);
    const pitcherAggregateResidual = pitcherResult.opponentModifier - pitcherTargetedSum;
    if (pitcherAggregateResidual !== 0) {
      // p-60 Filthy Stuff and p-90 Power-Hitter Killer both live in
      // `applyOpponentTotalAdjustments`, not in any bestGroup card's effect,
      // so detect them directly from pitcherHand before falling back to the
      // per-card scan.
      const filthy = s.pitcherHand.find((c) => c.id === "p-60");
      const phKiller = s.pitcherHand.find((c) => c.id === "p-90");
      const source =
        filthy ?? phKiller ?? findAggregateSource(s.pitcherHand, pitcherResult, s, "Pitching");
      if (source) {
        beats.push({
          kind: "aggregateDebuff",
          sourceCardId: source.id,
          sourceSide: "Pitching",
          affectedSide: "Batting",
          delta: pitcherAggregateResidual,
          label: source.name,
        });
      }
    }
  }

  // pitcherCombinedDelta residual -- b-17 attribution covers the per-card
  // breakdown, so this should usually be zero. Defensive in case future cards
  // contribute aggregate combine debuffs.
  const lineDriveTargeted = batterResult.targetedOpponentDebuffs
    .filter((t) => t.sourceCardId === "b-17")
    .reduce((a, t) => a + t.delta, 0);
  const combinedResidual = batterResult.pitcherCombinedDelta - lineDriveTargeted;
  if (combinedResidual !== 0) {
    const source = s.batterHand.find((c) => c.id === "b-17");
    if (source) {
      beats.push({
        kind: "aggregateDebuff",
        sourceCardId: source.id,
        sourceSide: "Batting",
        affectedSide: "Pitching",
        delta: combinedResidual,
        label: source.name,
      });
    }
  }

  // (4) b-65 Guess Pitch +4 if the pitcher actually used the named shape.
  // computeGuessPitchBonus already guarantees b-65 is in the batter hand
  // when this returns non-zero, so attaching its id is safe.
  const guessBonus = computeGuessPitchBonus(s);
  if (guessBonus !== 0) {
    beats.push({ kind: "guessPitchHit", sourceCardId: "b-65", delta: guessBonus });
  }

  // (5) Cross-at-bat debuffs (p-58 Strikeout Artist hangover, etc). These
  // attach to *this* at-bat even though their source card was on the field a
  // round ago -- the UI plays a generic banner since the source is no longer
  // visible.
  const batterPendingDelta = batterIgnoresDebuffs
    ? 0
    : sumPendingDebuffs(s.pendingDebuffs, "Batting");
  if (batterPendingDelta !== 0) {
    beats.push({
      kind: "crossDebuff",
      affectedSide: "Batting",
      delta: batterPendingDelta,
      label: "Carryover",
    });
  }
  const pitcherPendingDelta = sumPendingDebuffs(s.pendingDebuffs, "Pitching");
  if (pitcherPendingDelta !== 0) {
    beats.push({
      kind: "crossDebuff",
      affectedSide: "Pitching",
      delta: pitcherPendingDelta,
      label: "Carryover",
    });
  }

  void matchup;
  return beats;
}

function sumDeltas(list: { delta: number }[]): number {
  return list.reduce((a, d) => a + d.delta, 0);
}

/**
 * Aggregate-source detection: re-walk a hand's BEST group, re-run each card's
 * effect, and return the first card whose effect emits a non-zero
 * `opponentValueDelta` WITHOUT setting `opponentTargetCardId`. That's the
 * card responsible for the unattributed residual. Returns null if no such
 * card exists (in which case the residual is likely from a hand-level adjust
 * like p-60 -- the caller handles that explicitly).
 */
function findAggregateSource(
  hand: CardDefinition[],
  result: ScoringResult,
  s: GameState,
  side: "Batting" | "Pitching",
): CardDefinition | null {
  if (result.bestGroup.length === 0) return null;
  const opponent = side === "Batting" ? s.pitcherHand : s.batterHand;
  for (let i = 0; i < result.bestGroup.length; i++) {
    const card = result.bestGroup[i];
    const ctx: EffectContext = {
      side,
      inning: s.inning,
      isFirstAtBatOfInning: s.isFirstAtBatOfInning,
      outs: s.outs,
      isFinalInning: s.inning === s.totalInnings,
      batterHandedness: s.batter.handedness,
      opponentHand: opponent,
      opponentBaseCard: highestValueCard(opponent),
      hand,
      group: result.bestGroup,
      indexInGroup: i,
      isCombined: result.bestGroup.length > 1,
    };
    const eff = applyCardEffect(card, ctx);
    if (eff.opponentValueDelta !== 0 && !eff.opponentTargetCardId) {
      return card;
    }
  }
  return null;
}

/**
 * p-41 Sweeping Slider seam-break: probe the batter's best group, then return
 * a copy of the hand with the first card's right seam locked off so the
 * combo breaks at lock-in. Returns the original hand reference (no copy)
 * when p-41 is absent or the batter's best group is a singleton (nothing to
 * break). Pure function -- no store mutation.
 *
 * Shared by `previewMatchup` and `lockIn` so the displayed score during
 * selection matches the eventual locked-in score; otherwise the seam break
 * was a hidden mid-resolution surprise.
 */
function applySweepingSliderMutation(s: GameState): CardDefinition[] {
  if (!s.pitcherHand.some((c) => c.id === "p-41")) return s.batterHand;
  const probe = s.scoreBatter();
  if (probe.bestGroup.length <= 1) return s.batterHand;

  // Candidate seams to break: every "right seam" of every multi-card group
  // in the original scoring (the cards whose `rightNoCombine` we'd toggle).
  // Iterating across ALL multi-card groups (not just the current best)
  // matters when breaking the current best group merely promotes a tied or
  // close-second group to win -- in that case we want to evaluate breaks
  // from BOTH groups and pick whichever drives the post-mutation `maxValue`
  // lower. Without this, the slider could pick a seam that did almost
  // nothing while a different seam would have been strictly stronger.
  const seamCandidates: CardDefinition[] = [];
  for (const group of probe.groups) {
    if (group.length <= 1) continue;
    for (let i = 0; i < group.length - 1; i++) seamCandidates.push(group[i]);
  }
  if (seamCandidates.length === 0) return s.batterHand;

  let bestMutated: CardDefinition[] | null = null;
  let bestPostMax = Infinity;

  for (const target of seamCandidates) {
    const mutated = s.batterHand.map((c) =>
      c.id === target.id
        ? {
            ...c,
            combineConstraint: { ...(c.combineConstraint ?? {}), rightNoCombine: true },
          }
        : c,
    );
    // Score the mutated hand under the same context the eventual lock-in
    // will use. Lower post-mutation maxValue == stronger slider effect.
    const probeAfter = scoreHandFor(s, mutated, "Batting");
    if (probeAfter.maxValue < bestPostMax) {
      bestPostMax = probeAfter.maxValue;
      bestMutated = mutated;
    }
  }

  // Fallback: every candidate produced the same maxValue (rare, but
  // possible if the seam doesn't actually impact a chain). Stick with the
  // legacy behavior: break the first seam of the original best group.
  return bestMutated ?? s.batterHand.map((c) =>
    c.id === probe.bestGroup[0].id
      ? {
          ...c,
          combineConstraint: { ...(c.combineConstraint ?? {}), rightNoCombine: true },
        }
      : c,
  );
}

function computeMatchup(
  s: GameState,
  batterResult: ScoringResult,
  pitcherResult: ScoringResult,
  /**
   * Whether the b-65 Guess Pitch bonus should fold into the live totals.
   *
   * `lockIn` and other "the answer is now known" callers leave this `true`
   * so the bonus is baked into `lastBatterScore` and the reveal-script's
   * `guessPitchHit` beat can tween it onto the pill in front of the player.
   *
   * `previewMatchup` (the selection-phase HUD) passes `false`. The bonus
   * is computed from the pitcher's still-face-down hand, so revealing it
   * during selection effectively SPOILS the guess: a +4 leaks "you nailed
   * the pitch", a +1 leaks "you missed". The bonus belongs to the result
   * phase, when the pitcher hand has already flipped.
   */
  revealsGuess: boolean = true,
): ComputedMatchup {
  const batterDebuffDelta = sumPendingDebuffs(s.pendingDebuffs, "Batting");
  const pitcherDebuffDelta = sumPendingDebuffs(s.pendingDebuffs, "Pitching");

  const batterIgnoresDebuffs = s.batterHand.some((c) => c.id === "b-9");
  const effPitcherOpponentMod = batterIgnoresDebuffs ? 0 : pitcherResult.opponentModifier;
  const effPitcherHitScaleWall = batterIgnoresDebuffs ? 0 : pitcherResult.hitScaleBonus;
  const effBatterDebuffDelta = batterIgnoresDebuffs ? 0 : batterDebuffDelta;

  const guessPitchBonus = revealsGuess ? computeGuessPitchBonus(s) : 0;

  const batterTotal =
    batterResult.maxValue + effPitcherOpponentMod + effBatterDebuffDelta + guessPitchBonus;
  const pitcherTotal =
    pitcherResult.maxValue +
    batterResult.opponentModifier +
    batterResult.pitcherCombinedDelta +
    pitcherDebuffDelta;

  // Tie-breakers: pitchers (p-48 Lights Out, p-80 Umpire's Call) flip ties
  // to themselves; b-71 Manager's Challenge is the batter mirror and beats
  // any pitcher tie-breaker (the manager always gets the last word). Default
  // is unchanged: ties go to the batter.
  const tiePitcher = batterResult.pitcherWinsTies || pitcherResult.pitcherWinsTies;
  const batterChallenges = s.batterHand.some((c) => c.id === "b-71");
  const tieGoesToPitcher = tiePitcher && !batterChallenges;
  const batterWins =
    batterTotal > pitcherTotal || (batterTotal === pitcherTotal && !tieGoesToPitcher);

  const batterHitScaleNet = batterResult.hitScaleBonus - effPitcherHitScaleWall;
  const hitScaleValue = batterTotal + batterHitScaleNet;

  // The displayed pill is now ALWAYS the head-to-head total -- the hit-scale
  // modifier rides as a separate badge in the UI. Previously the pill silently
  // folded in `batterHitScaleNet` only when the batter was winning, which
  // produced the playtest "score jumps from 24 to 28 between preview and
  // final" surprise whenever an at-bat flipped from losing to winning at
  // lock-in (e.g. b-22 coin flip resolving). Keeping the pill in one
  // arithmetic universe means lockIn and previewMatchup always return the
  // same number for the same hand state -- the badge tells the player what
  // additional bonus is in play if they win.
  const batterDisplay = batterTotal;

  const pitcherChainSum = pitcherResult.maxValue;
  const pitcherBatterDelta =
    batterResult.opponentModifier + batterResult.pitcherCombinedDelta;
  const pitcherCarryoverDelta = pitcherDebuffDelta;

  return {
    batterTotal,
    pitcherTotal,
    batterWins,
    hitScaleValue,
    batterDisplay,
    pitcherDisplay: pitcherTotal,
    batterHitScaleNet,
    batterChainSum: batterResult.maxValue,
    batterPitcherDelta: effPitcherOpponentMod,
    batterCarryoverDelta: effBatterDebuffDelta,
    batterGuessDelta: guessPitchBonus,
    batterIgnoresDebuffs,
    pitcherChainSum,
    pitcherBatterDelta,
    pitcherCarryoverDelta,
  };
}

// ============ helpers ============

/**
 * Phase 7 helper: builds connection groups using the same "canConnect AND
 * affirmedSeams" rule the scoring engine uses, then reports whether the
 * named card ended up in a multi-card group. Used by b-127 Mr. Smile to
 * gate its pitcher silencing on actual combine status (mirrors the way
 * `scoreHand` picks `bestGroup`).
 */
function isCardCombinedInHand(
  hand: CardDefinition[],
  cardId: string,
  affirmedSeams: ReadonlySet<string> | null,
): boolean {
  if (!hand.some((c) => c.id === cardId)) return false;
  let group: CardDefinition[] = [hand[0]];
  for (let i = 1; i < hand.length; i++) {
    const prev = hand[i - 1];
    const curr = hand[i];
    const mechConnect = canConnect(prev, curr);
    const userAffirmed =
      affirmedSeams === null ? true : affirmedSeams.has(seamKey(prev.id, curr.id));
    if (mechConnect && userAffirmed) {
      group.push(curr);
    } else {
      if (group.length > 1 && group.some((c) => c.id === cardId)) return true;
      group = [curr];
    }
  }
  return group.length > 1 && group.some((c) => c.id === cardId);
}

/**
 * Phase 7 helper: lowest-baseValue card in the hand whose seam group has size
 * 1 (i.e. uncombined). Drives b-127's silencing target. Disabled cards are
 * skipped so the silence can't be wasted on a card that's already neutralized
 * by another effect (b-23, p-36 etc.).
 */
function lowestUncombinedInHand(
  hand: CardDefinition[],
  affirmedSeams: ReadonlySet<string> | null,
): CardDefinition | null {
  if (hand.length === 0) return null;
  const groups: CardDefinition[][] = [];
  let current: CardDefinition[] = [hand[0]];
  for (let i = 1; i < hand.length; i++) {
    const prev = hand[i - 1];
    const curr = hand[i];
    const mechConnect = canConnect(prev, curr);
    const userAffirmed =
      affirmedSeams === null ? true : affirmedSeams.has(seamKey(prev.id, curr.id));
    if (mechConnect && userAffirmed) {
      current.push(curr);
    } else {
      groups.push(current);
      current = [curr];
    }
  }
  groups.push(current);
  const singletons = groups
    .filter((g) => g.length === 1)
    .map((g) => g[0])
    .filter((c) => !c.disabled);
  if (singletons.length === 0) return null;
  return singletons.reduce((a, b) => (b.baseValue < a.baseValue ? b : a));
}

interface OutcomeApplyResult {
  inning: number;
  half: Half;
  outs: number;
  bases: Bases;
  /**
   * Runner identities aligned to `bases`. Always returned alongside `bases`
   * so callers can blanket-spread the result and keep the two arrays
   * synchronized. A `null` slot can mean "empty" or "phantom runner from
   * a card effect"; consumers must read `bases[i]` for occupancy.
   */
  baseRunners: BaseRunners;
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

function applyOutcome(
  s: GameState,
  outcome: HitOutcome,
  resolveDelta: {
    outsAdjustment: number;
    removeRunnerHint: RunnerSlot | null;
    forceRunFromThird: boolean;
    runnerAdvanceBoost: number;
    extraRunnerOn: RunnerSlot | null;
  },
): OutcomeApplyResult {
  let { inning, half, outs, homeScore, awayScore, totalInnings } = s;
  let bases: Bases = [...s.bases] as Bases;
  // Mirror of `bases` carrying the actual MlbPlayer per occupied slot.
  // Mutated in lockstep so the 3D scene's name labels track the same
  // events as the gameplay logic. `null` is permitted for phantom
  // additions like b-135 Stolen Bag (no specific drafted player).
  let baseRunners: BaseRunners = [...s.baseRunners] as BaseRunners;
  const runnerMoves: RunnerMove[] = [];

  // Advance runners by N bases. Returns the new bases array and runs scored,
  // and records each runner's logical journey so the 3D scene can animate it.
  // `runnerBoost` is added on top of `steps` ONLY for existing runners (b-120
  // Steal Home -- the batter still takes the natural N bases). Boost is 0 for
  // every outcome except b-120's combine+win path.
  const advance = (steps: number, runnerBoost: number = 0) => {
    let runs = 0;
    const newBases: boolean[] = [false, false, false, false]; // last slot = home (scoring)
    const newBaseRunners: (MlbPlayer | null)[] = [null, null, null, null];
    const existingRunnerSteps = steps + Math.max(0, runnerBoost);
    // Existing runners.
    for (let b = 0; b < 3; b++) {
      if (bases[b]) {
        const dest = b + 1 + existingRunnerSteps;
        const fromSlot = BASE_INDEX_TO_SLOT[b]; // bases[0] = 1B, etc.
        const toSlot = dest >= 4 ? "scored" : BASE_INDEX_TO_SLOT[dest - 1];
        const movingPlayer = baseRunners[b];
        runnerMoves.push({
          id: nextMoveId(),
          from: fromSlot,
          to: toSlot,
          kind: "runner",
          player: movingPlayer,
        });
        if (dest >= 4) {
          runs++;
        } else {
          newBases[dest] = true;
          newBaseRunners[dest] = movingPlayer;
        }
      }
    }
    // The batter takes their own bases.
    const batterDest = steps;
    if (batterDest === 0) {
      // Out path doesn't reach here (advance only called for hits).
    } else {
      const toSlot: BaseSlot = batterDest >= 4 ? "scored" : BASE_INDEX_TO_SLOT[batterDest - 1];
      runnerMoves.push({
        id: nextMoveId(),
        from: "home",
        to: toSlot,
        kind: "batter",
        player: s.batter,
      });
      if (batterDest >= 4) {
        runs++;
      } else {
        newBases[batterDest] = true;
        newBaseRunners[batterDest] = s.batter;
      }
    }
    bases = [newBases[1], newBases[2], newBases[3]] as Bases;
    baseRunners = [
      newBaseRunners[1],
      newBaseRunners[2],
      newBaseRunners[3],
    ] as BaseRunners;
    return runs;
  };

  let runs = 0;
  const runnerBoost = resolveDelta.runnerAdvanceBoost ?? 0;
  switch (outcome) {
    case "out":
      outs += 1 + Math.max(0, resolveDelta.outsAdjustment);
      // b-69 Sacrifice Fly: even though the batter is out, the runner from
      // 3rd scores. Other runners hold.
      if (resolveDelta.forceRunFromThird && bases[2]) {
        runnerMoves.push({
          id: nextMoveId(),
          from: "third",
          to: "scored",
          kind: "runner",
          player: baseRunners[2],
        });
        bases = [bases[0], bases[1], false] as Bases;
        baseRunners = [baseRunners[0], baseRunners[1], null] as BaseRunners;
        runs += 1;
      }
      break;
    case "single":
      runs = advance(1, runnerBoost);
      break;
    case "double":
      runs = advance(2, runnerBoost);
      break;
    case "triple":
      runs = advance(3, runnerBoost);
      break;
    case "homerun":
      runs = advance(4, runnerBoost);
      break;
  }

  // b-135 Stolen Bag: drop an additional runner on the named base after the
  // natural outcome resolves. If the slot is already occupied (e.g. a single
  // already left a runner on 1B) the bag is silently spent -- no double
  // stacking. Only fires when the resolve step requested it (gated on win).
  //
  // The phantom runner has no specific drafted player attached, so the
  // RunnerMove and baseRunners slot both record `null`. The 3D label
  // renderer treats null as "anonymous" and falls back to a generic
  // "RUNNER" tag.
  if (resolveDelta.extraRunnerOn) {
    const idx =
      resolveDelta.extraRunnerOn === "first"
        ? 0
        : resolveDelta.extraRunnerOn === "second"
          ? 1
          : 2;
    if (!bases[idx]) {
      const slot = BASE_INDEX_TO_SLOT[idx];
      runnerMoves.push({
        id: nextMoveId(),
        from: "home",
        to: slot,
        kind: "runner",
        player: null,
      });
      bases = [
        idx === 0 ? true : bases[0],
        idx === 1 ? true : bases[1],
        idx === 2 ? true : bases[2],
      ] as Bases;
      // baseRunners stays null for this phantom slot (already null since
      // we only enter this branch when the slot was unoccupied).
    }
  }

  // p-75 Pickoff Move: if the resolve step asked us to erase a runner, do it
  // here so the change persists into the next at-bat. Uses the dedicated
  // `pickoff` kind / `out` slot so the 3D scene and any analytics that key
  // off `to: "scored"` don't mistakenly count this as a run.
  if (resolveDelta.removeRunnerHint) {
    const idx =
      resolveDelta.removeRunnerHint === "first"
        ? 0
        : resolveDelta.removeRunnerHint === "second"
          ? 1
          : 2;
    if (bases[idx]) {
      const slot = BASE_INDEX_TO_SLOT[idx];
      runnerMoves.push({
        id: nextMoveId(),
        from: slot,
        to: "out",
        kind: "pickoff",
        player: baseRunners[idx],
      });
      bases = [
        idx === 0 ? false : bases[0],
        idx === 1 ? false : bases[1],
        idx === 2 ? false : bases[2],
      ] as Bases;
      baseRunners = [
        idx === 0 ? null : baseRunners[0],
        idx === 1 ? null : baseRunners[1],
        idx === 2 ? null : baseRunners[2],
      ] as BaseRunners;
    }
  }

  if (half === "top") awayScore += runs;
  else homeScore += runs;

  let isFirstAtBatOfInning = false;
  let phase: Phase = "between-at-bats";

  // ============ Half / inning advancement & end-of-game ============
  //
  // Walk-off: home team takes the lead at any point during the bottom of
  // the final inning (or any extra-inning bottom half). Game ends
  // immediately, mid-inning, with fewer than three outs allowed.
  const isFinalOrLater = inning >= totalInnings;
  if (half === "bottom" && isFinalOrLater && homeScore > awayScore) {
    return {
      inning,
      half,
      outs,
      bases,
      baseRunners,
      homeScore,
      awayScore,
      isFirstAtBatOfInning,
      phase: "game-over",
      runnerMoves,
    };
  }

  if (outs >= 3) {
    // Side retired; flip half-inning, reset outs/bases.
    outs = 0;
    bases = [false, false, false];
    baseRunners = [null, null, null];
    isFirstAtBatOfInning = true;
    if (half === "top") {
      half = "bottom";
      // Skip the bottom of the final (or extra) inning when the home team
      // already leads after the visitors have batted -- the home team's
      // lead is mathematically safe and standard baseball ends the game.
      if (isFinalOrLater && homeScore > awayScore) {
        phase = "game-over";
      }
    } else {
      half = "top";
      inning += 1;
      // Past regulation: end ONLY when the score is decided. Tied games
      // continue into extras (each pair of half-innings until somebody
      // leads after the bottom completes / the home team walks off above).
      if (inning > totalInnings && homeScore !== awayScore) {
        phase = "game-over";
      }
    }
  }

  return {
    inning,
    half,
    outs,
    bases,
    baseRunners,
    homeScore,
    awayScore,
    isFirstAtBatOfInning,
    phase,
    runnerMoves,
  };
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
