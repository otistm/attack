import { create } from "zustand";
import { CardDefinition, SESSION_CARDS, randomizeCardEdges } from "./cards";
import { BATTERS, dealHand, MlbPlayer, PITCHERS, PLAYERS } from "./players";
import { HitOutcome, resolveHitScale, scoreHand, ScoringContext, ScoringResult } from "./scoring";
import {
  applySznItemLockInEffects,
  sznItemAcquirePatch,
} from "./sznItemEffects";
import { canConnect, canConnectAny, playerAsCard, seamKey } from "./connect";
import { applyCardEffect, EffectContext, highestValueCard } from "./cardEffects";
import { applyHandTransforms, HAND_TRANSFORMS } from "./handTransforms";
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
import {
  emptyRunState,
  FRONT_OFFICE_DAYS,
  dayPickBudget,
  indexOfRosterPlayer,
  makeRunId,
  MAX_BAG_SIZE,
  MERCHANT_REROLLS_PER_VISIT,
  nextRarity as nextRunRarity,
  rollWeekPickBudgets,
  RUN_LOSS_LIMIT,
  RUN_WIN_TARGET,
  STARTER_PACK_BATTERS,
  STARTER_PACK_PITCHERS,
  STARTER_PACK_TOTAL,
  RARITY_BASE_VALUE,
  RECENT_ENCOUNTER_RING_SIZE,
  SERIES_BASE_PAYOUT,
  SERIES_WIN_BONUS,
  STREAK_BONUS_STEP,
  STREAK_BONUS_CAP,
  COMEBACK_BONUS,
  COMEBACK_LOSS_THRESHOLD,
  WEEKLY_CASH,
  type DayOfWeek,
  type EncounterOffer,
  type EventEffect,
  type Item,
  type PendingItemGrant,
  type PendingPlayerGrant,
  type RosterPlayer,
  type RunState,
  type Rarity,
  type SeriesSummary,
  type SeriesScoreline,
} from "./run";
import { nextTier, type ItemTier } from "./itemTiers";
import { MLB_TEAMS, type MlbTeamId } from "./sznTeams";
import { SZN_PLAYERS_BY_TEAM, asMlbPlayerCompat, getSznPlayer, isSznPlayer, type SznPlayer } from "./sznPlayers";
import { BADGES, isSnapTrigger, type BadgeId } from "./badges";
import {
  applyLockInAbilities,
  applyMatchupRevealAbilities,
  applySnapAbilities,
  applyDayStartAbilities,
  applyWeekStartAbilities,
  revealedAbilities,
} from "./sznPlayerAbilities";
import {
  buildMerchantOffer,
  priceFor,
  priceForTier,
  rerollCost,
  rollDailyOffers,
  rollRandomItemCardId,
  sellValueFor,
} from "./items";
import { encounterOfferId } from "./sznEncounters";
import { buildGhostSnapshot, ghostTriggerItems } from "./ghost";
import { rollWeeklyScout } from "./scouting";
import { teamBatterBonus, teamPitcherBonus } from "./synergies";

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
export type GameMode = "draft" | "quick-match" | "szn" | null;
/**
 * `revealing` sits between `selecting` and `between-at-bats`. lockIn computes
 * the final outcome (and applies bases / runs / outs) but parks the phase here
 * so the UI can play through `revealScript` -- per-card self mods, then
 * targeted opponent debuffs, then aggregates / cross-at-bat / guess-pitch
 * beats -- before transitioning to the resolved state. The destination phase
 * (between-at-bats or game-over) is stashed in `pendingResolvedPhase`.
 */
export type Phase =
  | "shop"
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
/**
 * Per-beat presentation hint consumed by the reveal layer to render
 * card-vs-card "attack" animations + floating damage/buff counters on top
 * of the existing pill tweens and highlights. The engine still owns the
 * math (each variant of {@link ResolutionBeat} already carries the source
 * card id and delta); `RevealBeatAnimation` is purely descriptive so the
 * UI can pick a motion + counter style without re-deriving who hit whom.
 *
 * - `attack` -- card lunges from its lane toward an opponent card (or the
 *   opponent's score pill when no specific target is named) and pops a red
 *   `-N` floating counter at the impact point.
 * - `buff` -- card pulses with a colored glow and pops a green/amber `+N`
 *   floating counter above itself. Used for self-modifiers and Guess
 *   Pitch's batter-side bonus.
 * - `snap` -- short connector beam between two snapped cards in a chain;
 *   pops a small cyan counter at the seam. Reserved for future use; not
 *   currently emitted by `buildRevealScript` because edge-snap value
 *   effects already flow through `selfModifier` / `aggregateDebuff`.
 * - `flash` -- no source card; tints the affected side and pops a counter
 *   near its score pill. Used for `crossDebuff` carryovers.
 */
export type RevealBeatAnimation =
  | {
      kind: "attack";
      sourceCardId: string;
      sourceSide: "Batting" | "Pitching";
      targetCardId?: string;
      targetSide: "Batting" | "Pitching";
      magnitude: number;
    }
  | {
      kind: "buff";
      sourceCardId: string;
      sourceSide: "Batting" | "Pitching";
      magnitude: number;
      flavor?: "value" | "hitScale";
    }
  | {
      kind: "snap";
      leftCardId: string;
      rightCardId: string;
      side: "Batting" | "Pitching";
      magnitude: number;
    }
  | {
      kind: "flash";
      affectedSide: "Batting" | "Pitching";
      magnitude: number;
      tone: "debuff" | "buff";
    };

export type ResolutionBeat =
  | {
      kind: "selfModifier";
      cardId: string;
      side: "Batting" | "Pitching";
      baseValue: number;
      finalValue: number;
      animation?: RevealBeatAnimation;
    }
  | {
      kind: "targetedDebuff";
      sourceCardId: string;
      sourceSide: "Batting" | "Pitching";
      targetCardId: string;
      targetSide: "Batting" | "Pitching";
      delta: number;
      animation?: RevealBeatAnimation;
    }
  | {
      kind: "aggregateDebuff";
      sourceCardId: string;
      sourceSide: "Batting" | "Pitching";
      affectedSide: "Batting" | "Pitching";
      delta: number;
      label: string;
      animation?: RevealBeatAnimation;
    }
  | {
      kind: "guessPitchHit";
      /** Always the b-65 card id. Carried so the reveal orchestrator can
       *  light up the source card the same way other source-attributable
       *  beats (selfModifier, targetedDebuff, aggregateDebuff) do -- the
       *  player should SEE Guess Pitch fire, not just see a banner. */
      sourceCardId: string;
      delta: number;
      animation?: RevealBeatAnimation;
    }
  | {
      kind: "crossDebuff";
      affectedSide: "Batting" | "Pitching";
      delta: number;
      label: string;
      animation?: RevealBeatAnimation;
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
 * Push the freshly-rendered encounter ids onto the cross-week
 * "recently seen" ring stored on {@link RunState.recentEncounterRing}.
 *
 * FIFO bounded at {@link RECENT_ENCOUNTER_RING_SIZE}: oldest ids fall
 * off the front so the ring always reflects the last N unique
 * encounters the user has seen, regardless of week. Dedupes within
 * the same push so we don't waste ring slots when a slate of 3
 * happens to roll the same id twice (which is also blocked by the
 * intra-slate dedupe, but defensive doesn't hurt).
 *
 * Pure: returns a new array, never mutates the input.
 */
export function pushEncounterRing(
  current: ReadonlyArray<string> | undefined,
  newIds: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Start with the new ids at the END (so they sort as "most recent"),
  // but build the working array in order so the FIFO truncation lops
  // off the *oldest* ids first.
  for (const id of current ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of newIds) {
    if (seen.has(id)) {
      // Promote already-known id to "most recently seen" by removing
      // its earlier position and re-appending. Keeps the FIFO honest
      // when the same id shows up in two consecutive weeks.
      const idx = out.indexOf(id);
      if (idx >= 0) out.splice(idx, 1);
    }
    seen.add(id);
    out.push(id);
  }
  // Trim FROM THE FRONT (drop oldest) when we exceed the cap.
  if (out.length > RECENT_ENCOUNTER_RING_SIZE) {
    return out.slice(out.length - RECENT_ENCOUNTER_RING_SIZE);
  }
  return out;
}

/**
 * True when the user is actively in a SZN weekend at-bat (not pack rip,
 * not Front Office, not the series intro splash, not end-of-run).
 * Centralizes the "should SZN combat-only interactions fire?" gate so
 * the always-on `SznFooterDecks` doesn't mutate hand state during the
 * pre-combat screens (where `phase` legitimately sits at `'selecting'`
 * for the dormant placeholder at-bat).
 *
 * Mirror of the visibility selector inside `UIOverlay`/`RunHud` so the
 * footer's "interactive" gate stays in lock-step with the screens that
 * actually own combat (PackRip / Front Office / SeriesIntro all suppress
 * the in-game overlay).
 */
export function isInSznCombat(s: {
  gameMode: GameMode;
  run: RunState | null;
  phase: Phase;
}): boolean {
  if (s.gameMode !== "szn" || !s.run) return false;
  if (s.run.packRipPending) return false;
  if (s.run.endState !== null) return false;
  if (s.run.day !== "series") return false;
  if (!s.run.series?.gameInProgress) return false;
  return s.phase === "selecting";
}

/**
 * "Low leverage" gate used by the Quick Resolve toggle to decide whether
 * the next at-bat is boring enough to auto-advance. The rule purposely
 * errs on the side of NOT auto-resolving: any swing that could plausibly
 * change the game's outcome (tied late, RISP, loaded bases, an open USE
 * prompt) is treated as high leverage and the player gets the normal
 * Lock In UX.
 *
 * SZN Games of the Week are 3 innings (`SERIES_GAME_INNINGS`), so the
 * thresholds below are tuned for that short format -- "inning >= 2" is
 * already mid-to-late game, and a 3-run lead is comfortable.
 *
 * Inputs are intentionally a wide `GameState`-shaped object (and not the
 * full `GameState` type) so callers that just have the slice they care
 * about can pass it without pulling in everything.
 */
export function isLowLeverageAtBat(s: {
  gameMode: GameMode;
  run: RunState | null;
  phase: Phase;
  inning: number;
  totalInnings: number;
  half: Half;
  outs: number;
  bases: Bases;
  homeScore: number;
  awayScore: number;
  userTeam: Team;
  pendingChoices: PendingChoice[];
  activeChoiceCardId: string | null;
  tutorialActive: boolean;
}): boolean {
  if (!isInSznCombat(s)) return false;
  // Tutorial owns its own pacing; never auto-advance through it.
  if (s.tutorialActive) return false;
  // Any open or queued player-choice modal is by definition meaningful --
  // auto-resolving past it would steal the player's decision.
  if (s.activeChoiceCardId !== null) return false;
  if (s.pendingChoices.length > 0) return false;

  const userIsAway = s.userTeam === "AWAY";
  const userScore = userIsAway ? s.awayScore : s.homeScore;
  const ghostScore = userIsAway ? s.homeScore : s.awayScore;
  const diff = userScore - ghostScore;
  const absDiff = Math.abs(diff);
  const tied = diff === 0;
  const [on1, on2, on3] = s.bases;
  const risp = on2 || on3;
  const loaded = on1 && on2 && on3;

  // ---- HARD EXCLUSIONS: meaningful spots, always play manually. ----
  // Tied game in the final inning (or extras) -- every at-bat matters.
  if (tied && s.inning >= s.totalInnings) return false;
  // Runner in scoring position from inning 2 onward (would-be tying /
  // go-ahead runner is one swing away).
  if (risp && s.inning >= 2) return false;
  // Bases loaded ever -- the swing is always high-leverage.
  if (loaded) return false;
  // Final inning, one-run game either way (walk-off / tying spot).
  if (s.inning >= s.totalInnings && absDiff <= 1) return false;

  const userSide = getUserSide(s);

  // ---- SOFT INCLUSIONS: clear "blowout" or "garbage time" markers. ----
  // SZN weekend games are 3 innings, so the old "inning >= 2 + 3 run gap"
  // thresholds almost never tripped in practice -- final scores cluster
  // around 4-3 and the toggle felt like dead UI. Loosened across the board
  // to match the shorter format, while keeping the hard exclusions above
  // (tied late / RISP from inning 2 / loaded / 1-run final inning) as the
  // safety net for genuinely meaningful spots.
  // (A) Mid-game gap: 2+ run differential from inning 2 onward. In a
  //     3-inning game a 2-run gap with one full inning left is already
  //     "garbage time" cadence -- the player isn't going to flip it with
  //     one defensive snap.
  if (s.inning >= 2 && absDiff >= 2) return true;
  // (B) User pitching with ANY lead from inning 2+ -- defensive half is
  //     mostly ceremony; the player isn't making the meaningful decisions.
  //     Tied (diff === 0) is excluded so a 0-0 inning 2 defensive half
  //     still plays manually.
  if (userSide === "Pitching" && diff >= 1 && s.inning >= 2) return true;
  // (C) Empty bases, two outs, not tied, inning 2+ -- worst case the
  //     half-inning ends one swing later with no runners affected.
  if (s.outs === 2 && !on1 && !on2 && !on3 && !tied && s.inning >= 2) return true;
  // (D) Final inning, already up by 2+ -- math is mostly settled. (The
  //     `absDiff <= 1` exclusion above guards the 1-run-game walk-off
  //     spot, so leaving D at >= 2 is correct.)
  if (s.inning >= s.totalInnings && diff >= 2) return true;
  // (E) Pitching cleanup with 2 outs, empty bases, and a non-tied
  //     score -- snap the inning shut regardless of how many runs we're
  //     ahead/behind. We're one out from a fresh half either way.
  if (
    userSide === "Pitching" &&
    s.outs === 2 &&
    !on1 && !on2 && !on3 &&
    !tied
  ) return true;

  return false;
}

/**
 * Sibling of `isInSznCombat`: true when the user is in any Front
 * Office day (mon..thu), meaning the encounter grid + persistent
 * footer are the only foreground surfaces. Used by the footer to
 * decide when to surface the FO-only widgets (synergy strip, sell
 * tray) and by the SQUARE handler to enable batter/pitcher toggle on
 * the LEFT deck. Excludes the post-rip / pre-rip transient states and
 * the weekend series (combat owns those).
 */
export function isInSznFrontOffice(s: {
  gameMode: GameMode;
  run: RunState | null;
}): boolean {
  if (s.gameMode !== "szn" || !s.run) return false;
  if (s.run.packRipPending) return false;
  if (s.run.endState !== null) return false;
  return s.run.day !== "series";
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

  // Season State
  seasonWins: number;
  seasonLosses: number;
  teamBudget: number;
  inventory: string[];
  equippedItems: Record<string, string[]>; // cardId -> itemIds

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

  /**
   * Live-measured height (in px) of the always-on `SznFooterDecks` strip.
   * `CardGameOverlay` reads this to lift the user-hand container by
   * exactly the footer's footprint so the score pill / lock-in button
   * never disappear behind the deck. Set to 0 whenever the footer is
   * not mounted (out-of-SZN, etc.).
   */
  sznFooterHeight: number;

  /**
   * SZN-only Quick Resolve flag. When `true`, `CardGameOverlay` auto-runs
   * the lock-in -> reveal -> next-at-bat chain on any at-bat where
   * `isLowLeverageAtBat()` reports the spot as boring (blowout late,
   * empty-bases two-outs, user pitching with a comfortable lead, etc.).
   * The toggle is hand-on-a-dead-man's-switch: the moment leverage spikes
   * (RISP, tied late, an open USE prompt), the auto-chain stops and the
   * player gets the normal Lock In UX. Defaults to `false` so the very
   * first SZN at-bat always requires a manual lock-in.
   */
  quickResolveEnabled: boolean;

  /**
   * One-shot "Resolve Inning" target. When set to the current `inning`,
   * the auto-chain bypasses the {@link isLowLeverageAtBat} gate for the
   * remainder of THIS inning only (both halves) -- effectively a single-
   * inning Quick Resolve burst. Cleared automatically when `inning`
   * advances past the target so a request for inning 2 doesn't leak
   * into inning 3. Defaults to `null`.
   *
   * Pairs with `quickResolveEnabled`: when this is set, the auto-chain
   * fires regardless of leverage; once the inning ticks, the chain
   * reverts to the normal leverage-gated behavior driven by
   * `quickResolveEnabled`.
   */
  resolveInningTarget: number | null;

  /**
   * Unified SZN gamepad focus surface. `'screen'` means the screen-level
   * handlers (FrontOfficeScreen tile grid, EndRunScreen CTAs, etc.) own
   * input; `'footer'` means the persistent `SznFooterDecks` row owns
   * input (D-PAD navigates cards, L1/R1 switch decks, Triangle toggles
   * collapse, etc.).
   *
   * Transition contract — owned by `SznFooterDecks` via its priority-50
   * focus-router handler:
   *   - `DPAD_DOWN` in `'screen'` mode → flip to `'footer'`
   *   - `DPAD_UP`   in `'footer'` mode → flip back to `'screen'`
   * Modals at priority 100+ sit ABOVE the router and consume their own
   * input first, so the focus never transitions while a modal is open.
   *
   * Defaults to `'screen'` (and is reset to `'screen'` on every SZN
   * mode transition) so the very first input the player gives always
   * goes to the visible screen, not the silent footer.
   */
  sznGamepadFocus: 'screen' | 'hand' | 'footer';

  /**
   * Edges of the card the user is currently focused on inside an
   * encounter overlay (Merchant listing, Player Market listing, Event
   * choice). Published by the encounter views every time the focus
   * cursor moves; consumed by `SznFooterDecks.Card` to lift any
   * footer chip whose edge can SZN-snap to either side of the focused
   * encounter card. `null` whenever no encounter view owns the focus
   * (between encounters, or when the cursor sits on a non-card
   * affordance like the "Leave" button).
   */
  encounterFocusEdges: {
    leftEdge: import('./sznEdges').SznEdgeId | null;
    rightEdge: import('./sznEdges').SznEdgeId | null;
  } | null;

  /**
   * In-flight "card flies into the footer" animation payload. When an
   * encounter (merchant, event) commits a new item card to the bag, the
   * caller captures the source tile's bounding rect, looks up the
   * footer abilities-row rect, and publishes both here so a top-level
   * `PurchaseFlightOverlay` can render a portal ghost that tweens from
   * source → target. `null` whenever no flight is animating. The
   * overlay clears this back to `null` when the tween finishes, which
   * is what lets the real footer chip become visually authoritative.
   */
  purchaseFlight: {
    /** Stable id (item instanceId, or a synthetic id) to dedupe re-renders. */
    flightId: string;
    /** Card definition id -- the overlay re-renders the same chip visual. */
    cardId: string;
    /** Source rect (where the user clicked / picked the card). */
    source: { x: number; y: number; width: number; height: number };
    /** Target rect (the footer abilities row). */
    target: { x: number; y: number; width: number; height: number };
  } | null;

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
  /**
   * Whether the SZN-mode MLB team-selection overlay is mounted. Opened
   * when the user clicks the SZN lane on the StartGameScreen; closed
   * implicitly by `startSznRun` (which also closes the start screen).
   */
  showSznTeamSelect: boolean;
  setShowSznTeamSelect: (open: boolean) => void;

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
  equipItem: (itemId: string, targetCardId: string) => void;
  unEquipItem: (itemId: string, sourceCardId: string) => void;
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

  // ----- SZN Mode (run-loop pivot) -----
  /**
   * Active SZN run state, or `null` when not in SZN Mode. Carries the
   * 12-week timeline, roster, item bag, cash, and series controller.
   * Quick Match / Auction Draft lanes are unaffected and leave this null.
   */
  run: RunState | null;
  /**
   * Lane entry: kicks off a fresh SZN run with the user's chosen MLB
   * franchise. Sets `gameMode: "szn"`, initializes `run` to a starter
   * run-state seeded with the team's passive badge, and triggers the
   * pack-rip reveal screen. The user is always parked in the AWAY
   * (batting first) seat for SZN; the franchise choice drives the
   * starter pool, not the seat.
   */
  startSznRun: (mlbTeamId: MlbTeamId) => void;
  /** Pack-rip: reveal the starter 10 and seed Week 1 Mon. */
  openStarterPack: () => void;
  /** Pack-rip: dismiss the reveal screen and route to the Front Office. */
  dismissPackRip: () => void;
  /** Monday: dismiss the scouting report overlay for the current week. */
  acknowledgeWeekScouting: () => void;
  /**
   * Front Office: commit a pick. Bumps `picksUsed`, re-rolls the slate
   * (same slot count as that day's `pickBudget`), and auto-advances the day
   * when the budget is reached. Caller is responsible for closing any open
   * modal first — the offers will replace mid-flight if the modal stays mounted.
   */
  commitEncounter: () => void;
  /**
   * Merchant view: buy a listing (item add OR roster upgrade).
   * Returns `true` when the purchase actually applied so the caller can
   * gate UI state (e.g. "did the user actually spend?" pick-burn flag)
   * on the real outcome instead of a click that may have been a no-op
   * because of cash/state mismatch.
   *
   * Item paths now route through {@link requestAddItem} -- a "buy"
   * that lands at a full bag opens the {@link ItemBagReplacePicker}
   * instead of silently failing, and buying a duplicate of an
   * already-owned card UPGRADES the owned copy's tier (bronze → silver
   * → gold) at the silver/gold tier price rather than no-oping.
   */
  purchaseFromMerchant: (slotIndex: number, listingIndex: number) => boolean;
  /**
   * Reroll the listings on the currently-open merchant offer. Charges
   * {@link rerollCost} from the run cash, rebuilds `offer.listings`
   * via {@link buildMerchantOffer}, and increments the per-visit
   * counter (`offer.rerollsUsed`). No-op when the cap is reached or
   * the user can't afford it. Returns `true` on success so the UI can
   * play a confirm-flash effect on the reroll button.
   */
  rerollMerchant: (slotIndex: number) => boolean;
  /**
   * Bazaar-style central item-grant router. Every path that wants to
   * add an item to the bag (merchant buys, encounter `grantItem`,
   * encounter `addItemRandom`) MUST call this so the "no silent
   * drops" contract holds. Behavior:
   *   - bag already has the card → bumps the owned copy one tier
   *     (bronze → silver → gold). At gold the request is rejected.
   *   - bag has room → lands the item at bronze.
   *   - bag is full → sets `run.pendingItemGrant` and returns `false`;
   *     the `ItemBagReplacePicker` modal mounts above the FO and the
   *     user picks a slot to sell to make room. `refundOnCancel` is
   *     pre-computed from the item's sell value so cancelling refunds
   *     a partial consolation.
   * Returns `true` when the item landed (or upgraded) immediately,
   * `false` when the picker was queued / the request was rejected.
   * The caller is expected to charge any cash up-front; this router
   * never touches `run.cash`.
   */
  requestAddItem: (
    cardId: string,
    source: "merchant" | "event",
  ) => boolean;
  /**
   * Complete a pending item-grant by selling the named bag slot for
   * cash AND landing `run.pendingItemGrant`. Mirrors the swap step in
   * the Bazaar's bag-full picker. Returns `true` on success.
   */
  confirmReplaceAndAdd: (replacedInstanceId: string) => boolean;
  /**
   * Cancel the pending item grant. Refunds `run.pendingItemGrant.refundOnCancel`
   * cash as consolation and clears the pending field so the picker
   * closes. Idempotent.
   */
  cancelPendingItemGrant: () => void;
  /**
   * Sell a bag item back for cash any time (footer sell tray). Returns
   * the cash gained, or 0 when the instance isn't on the bag.
   */
  sellItemForCash: (instanceId: string) => number;
  /**
   * Bump an owned bag item up one tier (bronze → silver → gold). No-op
   * (returns false) if the item is already gold. The caller is
   * expected to charge upgrade cost; this action only does the tier
   * mutation so it can be unit-tested in isolation.
   */
  upgradeOwnedItem: (cardId: string) => boolean;
  /** Event view: pick one of the choice branches. */
  /**
   * Resolve an event choice. `targetPlayerId` is an optional override
   * filled in by the EventEncounterView's picker before dispatch -- it
   * gets stamped onto the chosen `EventEffect.playerId` field for the
   * effects that need a target (mutateRosterEdge, swapPlayerEdges,
   * scoreOverridePlayer, pokerPlayerWager).
   */
  resolveEventChoice: (slotIndex: number, choiceId: string, targetPlayerId?: string) => void;
  /** Front Office: advance to the next day (or the weekend series). */
  advanceDay: () => void;
  /** Weekend: kick off the Bo3 series with a generated ghost. */
  startSeries: () => void;
  /**
   * Weekend: register the just-finished game's outcome and either move
   * to game 2/3 or end the series.
   *
   * Result tri-state:
   *   - `"user"`  — user won this game (counts toward 2-of-3 series win)
   *   - `"ghost"` — ghost won this game
   *   - `"draw"`  — game ended tied (one extra inning, still even).
   *                Series gameIndex advances but neither side gets a
   *                game-win. Series tiebreaker (when reached) uses run
   *                differential summed across played games — handled
   *                separately by the reducer that tracks aggregate runs.
   */
  reportSeriesGameResult: (
    result: "user" | "ghost" | "draw",
    userScore: number,
    ghostScore: number,
  ) => void;
  /** End the run early (Quit / shame leave). */
  endRun: (reason: "champion" | "fired" | "manual") => void;
  /**
   * Acknowledge and dismiss the one-shot SeriesResultScreen snapshot.
   * The SeriesResultScreen calls this on "Continue" so the Monday
   * Front Office (or EndRunScreen for `endState !== null`) takes over.
   * Idempotent; safe to call when `lastSeriesSummary` is already null.
   */
  dismissSeriesSummary: () => void;
  /**
   * Exit the SZN run completely back to the start-screen lane chooser.
   * Clears `run` and `gameMode` so the App-level routing falls back to the
   * legacy non-SZN paths and the StartGameScreen overlay can paint again.
   */
  exitSznToMenu: () => void;
  /**
   * Sell a roster player back for cash (Front Office Sell tray entry point).
   * Returns the cash gained, or 0 if the player can't be sold.
   * Refuses to sell the last batter or last pitcher so the user always
   * has a viable lineup for the upcoming series.
   */
  sellPlayerForCash: (playerId: string) => number;
  /**
   * Front Office: buy a fresh MLB player onto the roster from the player
   * market merchant. The store validates cash, checks for duplicates, and
   * adds the new RosterPlayer at Common rarity (using the player's intrinsic
   * class tag). Returns `true` when the signing actually applied so
   * callers can gate "pick spent" UI state on a real transaction.
   *
   * Bazaar-style "no silent drops" overflow flow: when the roster is
   * already at {@link STARTER_PACK_TOTAL}, the dispatcher still
   * charges the listing price and returns `true`, but the new player
   * is parked on `run.pendingPlayerGrant` instead of the roster. The
   * persistent SZN footer rail flips into "release" mode (left deck
   * paints each chip with a red RELEASE overlay) so the user picks
   * the cut from the same card row they use for the rest of FO --
   * no modal mounts. CROSS / click on a footer chip routes through
   * {@link confirmReleaseAndSignPlayer}; CIRCLE / the banner's cancel
   * link routes through {@link cancelPendingPlayerGrant} for a full
   * price refund.
   */
  buyPlayerFromMarket: (slotIndex: number, listingIndex: number) => boolean;
  /**
   * Complete a pending player-grant by releasing the named roster
   * slot AND landing `run.pendingPlayerGrant` in the freed spot.
   * Mirrors {@link confirmReplaceAndAdd} for the bag-full picker.
   * Returns `true` on success.
   */
  confirmReleaseAndSignPlayer: (releasedPlayerId: string) => boolean;
  /**
   * Cancel the pending player grant. Refunds the full listing price
   * (`run.pendingPlayerGrant.refundOnCancel`) and clears the pending
   * field so the picker closes. Idempotent.
   */
  cancelPendingPlayerGrant: () => void;
  /**
   * SZN Mode combat: deal an item from the run's bag (Dugout) into the
   * user's current hand. The card is APPENDED to the hand so the player
   * can drag it into chain position. No-op if the item is already in the
   * hand or if the user isn't in SZN combat.
   */
  sznDealItem: (instanceId: string) => void;
  /**
   * SZN Mode combat: pull a card out of the user's hand. Player cards
   * (`abilityType === "Player"`) are anchored and cannot be recalled --
   * they're the seat's identity for the at-bat.
   */
  sznRecallItem: (cardId: string) => void;
  /**
   * SZN Mode combat: hot-swap the player currently at the plate (or on
   * the mound, if the user is pitching) for another player on the run
   * roster. The dealt items in the hand are preserved -- only the
   * `player:` anchor card and the upstream `batter` / `pitcher` slot
   * change. Affirmed seams are cleared because the swap mutates the
   * shape sockets on the anchor card.
   *
   * Returns `true` when the swap succeeded, `false` otherwise (invalid
   * phase, target not on roster, wrong role for the user's seat, etc.).
   */
  sznSwapPlayer: (playerId: string) => boolean;
  /**
   * Encounter-driven roster cull. Removes the named player from the
   * run roster without a refund. Legacy entry point retained for
   * direct event-encounter "cut a player" choices; the free-agency
   * overflow flow goes through {@link confirmReleaseAndSignPlayer}
   * instead (which couples the cut to landing the queued sign). No-
   * op if the roster has only one of that role (we never empty a
   * side). Returns true on success.
   */
  releaseRosterPlayer: (playerId: string) => boolean;
  /**
   * Footer "move mode" -- swap two roster players by id so the user
   * can curate the order of their footer rail during Front Office. The
   * swap is gated to FO (`isInSznFrontOffice`) because reshuffling the
   * roster mid-at-bat would race with the suspension / role filters
   * the combat code reads off the same array. No-op if either id is
   * absent. Returns `true` on success so the footer can re-clamp focus
   * around the moved card.
   */
  sznSwapRoster: (idA: string, idB: string) => boolean;
  /**
   * Footer "move mode" -- swap two bag items by instance id. Same FO
   * gating rationale as `sznSwapRoster`. Bag order is purely a UI
   * preference today; the combat path never indexes the bag, so this
   * is a safe rearrangement.
   */
  sznSwapItemBag: (idA: string, idB: string) => boolean;
  /** Reports the rendered footer-deck height up to the store. */
  setSznFooterHeight: (h: number) => void;

  /**
   * Sets which SZN surface owns gamepad input. Almost always called
   * from the `SznFooterDecks` focus router; other callers should
   * generally let the router drive transitions so D-PAD nav stays
   * predictable.
   */
  setSznGamepadFocus: (focus: 'screen' | 'hand' | 'footer') => void;

  /**
   * Publishes (or clears) the edges of the encounter-overlay card the
   * user is currently focused on. Encounter views call this on
   * focus-change with the focused card's edges, and on close / blur
   * with `null` to release the highlight. `SznFooterDecks.Card`
   * subscribes and adds a "compatible" lift visual to any chip whose
   * left/right edge can SZN-snap to either side of the focused card.
   */
  setEncounterFocusEdges: (
    edges: {
      leftEdge: import('./sznEdges').SznEdgeId | null;
      rightEdge: import('./sznEdges').SznEdgeId | null;
    } | null,
  ) => void;

  /**
   * Publishes a new purchase-flight payload. Source/target are DOMRect-
   * shaped tuples captured by the calling encounter view; the overlay
   * reads them to drive its initial / animate motion props.
   */
  startPurchaseFlight: (flight: {
    flightId: string;
    cardId: string;
    source: { x: number; y: number; width: number; height: number };
    target: { x: number; y: number; width: number; height: number };
  }) => void;
  /**
   * Clears the current flight payload -- called from the overlay's
   * `onAnimationComplete`. Always safe to call (no-op if already null).
   */
  endPurchaseFlight: () => void;

  /**
   * Flips the SZN Quick Resolve toggle. Pure preference setter -- the
   * actual auto-advance loop lives in `CardGameOverlay` and reacts to
   * this flag plus `isLowLeverageAtBat()`.
   */
  setQuickResolveEnabled: (enabled: boolean) => void;

  /**
   * Arm the one-shot Resolve-Inning burst. Sets `resolveInningTarget`
   * to the current inning so the auto-chain bypasses the leverage gate
   * for every remaining at-bat in this inning (both halves). Auto-
   * clears when the inning advances. No-op outside SZN combat.
   */
  requestResolveInning: () => void;

  /**
   * Dev-only fast-forward: skip to next Monday and reseed the new
   * week's encounters / ghost / scouting. Used to validate multi-week
   * balance (price curve, encounter-repetition ring, win-streak
   * payout) without manually playing through 12 weekends.
   *
   * Reuses the same week-rollover machinery as the post-series path
   * so the cross-week dedupe ring + buff-timer decrements + weekly
   * cash refill all stay in lock-step with normal play.
   *
   * Accepts an explicit `outcome` so the caller can tag the synthetic
   * series as a win or a loss for streak / win-target testing.
   *
   * No-op when the run is over (`endState !== null`) or no run is
   * active. Surfaced from a dev-only button in `FrontOfficeScreen`;
   * the action itself is gated on `import.meta.env.DEV` from the
   * caller side so production builds can still hold the symbol.
   */
  devFastForwardWeek: (outcome?: "win" | "loss") => void;
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
/**
 * Resolve any `suspend:Batting` / `suspend:Pitching` sentinels in the
 * suspension list into concrete player ids. Sentinels are written by the
 * Clubhouse Prank "Suspend Instigators" branch and the poker-cash wager
 * loss path; they intentionally defer the "who is the top scorer" pick
 * to series-start time so the encounter copy ("top scorer suspended
 * next series") can be evaluated against the live roster.
 *
 * We treat baseValue (rarity-derived) as the proxy for "top scorer"
 * since rarity is the only score input known at suspension time;
 * permanentBoost + scoreOverride are additive and don't change which
 * slot a sentinel resolves to in practice (a Legend always outranks a
 * boosted Common).
 *
 * The resolved list is idempotent — calling on an already-resolved list
 * is a no-op (and returns the same reference so callers can short-
 * circuit a setState).
 */
function resolveSuspensionSentinels(
  current: string[],
  roster: RosterPlayer[],
): string[] {
  if (current.length === 0) return current;
  const hasSentinel = current.some(
    (id) => id === "suspend:Batting" || id === "suspend:Pitching",
  );
  if (!hasSentinel) return current;
  const topByRole = (role: "Batter" | "Pitcher"): string | null => {
    let best: RosterPlayer | null = null;
    let bestVal = -Infinity;
    for (const slot of roster) {
      if (slot.player.role !== role) continue;
      const val =
        RARITY_BASE_VALUE[slot.rarity] +
        (slot.permanentBoost ?? 0) +
        (slot.scoreOverride ?? 0);
      if (val > bestVal) {
        best = slot;
        bestVal = val;
      }
    }
    return best?.player.id ?? null;
  };
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of current) {
    let resolved = id;
    if (id === "suspend:Batting") {
      const top = topByRole("Batter");
      if (top) resolved = top;
      else continue;
    } else if (id === "suspend:Pitching") {
      const top = topByRole("Pitcher");
      if (top) resolved = top;
      else continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    next.push(resolved);
  }
  return next;
}

function rosterPoolsFor(s: {
  draft: DraftState | null;
  userTeam: Team;
  half: Half;
  gameMode: GameMode | null;
  run: RunState | null;
}): {
  battersPool?: MlbPlayer[];
  pitchersPool?: MlbPlayer[];
} {
  // SZN Mode: pools come from the run roster (user) and ghost (opponent).
  // Without this branch the next-at-bat would silently fall through to the
  // global BATTERS / PITCHERS catalog, which would break SZN tier seeding on
  // the player-as-card (`freshAtBat` matches roster ids for `baseValue`).
  if (s.gameMode === "szn" && s.run && s.run.ghost) {
    // Suspended players (Clubhouse Prank "Suspend Instigators", poker
    // wager loss) are filtered from the user's at-bat pool. We never
    // empty a role -- if every entry would be suspended we fall back to
    // the full roster so the at-bat still seats someone.
    const suspended = new Set(s.run.suspendedPlayerIds ?? []);
    const filterSuspended = <T extends { id: string }>(pool: T[]): T[] => {
      if (suspended.size === 0) return pool;
      const next = pool.filter((p) => !suspended.has(p.id));
      return next.length > 0 ? next : pool;
    };
    const userBatters = filterSuspended(
      s.run.roster
        .filter((r) => r.player.role === "Batter")
        .map((r) => asMlbPlayerCompat(r.player)),
    );
    const userPitchers = filterSuspended(
      s.run.roster
        .filter((r) => r.player.role === "Pitcher")
        .map((r) => asMlbPlayerCompat(r.player)),
    );
    const ghostBatters = s.run.ghost.roster
      .filter((r) => r.player.role === "Batter")
      .map((r) => asMlbPlayerCompat(r.player));
    const ghostPitchers = s.run.ghost.roster
      .filter((r) => r.player.role === "Pitcher")
      .map((r) => asMlbPlayerCompat(r.player));
    const battingTeam: Team = s.half === "top" ? "AWAY" : "HOME";
    const userBatting = battingTeam === s.userTeam;
    return {
      battersPool: userBatting ? userBatters : ghostBatters,
      pitchersPool: userBatting ? ghostPitchers : userPitchers,
    };
  }
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
  /**
   * SZN Mode: when set, the BATTER's hand is replaced with these cards
   * instead of being dealt. Used so the user's purchased item bag drives
   * the play instead of a randomly generated hand. Falls back to the
   * normal deal when undefined / empty so non-SZN paths are unaffected.
   */
  userBatterHandOverride?: CardDefinition[];
  /** Same shape, for the pitcher seat. */
  userPitcherHandOverride?: CardDefinition[];
  /**
   * SZN Mode flag: when true, the user's seat starts with ONLY the
   * MlbPlayer-as-card in their hand. Items are added to the hand at
   * runtime via the persistent `SznFooterDecks` drag-to-deal (which
   * calls `sznDealItem` against the user's `itemBag`). Hand cap is 6
   * including the player anchor card.
   */
  sznMode?: boolean;
  /** Which seat is the user occupying for this at-bat. */
  sznUserSide?: "Batting" | "Pitching";
  /**
   * When `sznMode` seeds a player-as-card hand, rarity base value is read from
   * this roster (must be the active user run roster in SZN combat).
   */
  sznUserRoster?: RosterPlayer[];
  /**
   * Ghost-side roster + bag for SZN combat parity. When set the
   * non-user seat also gets seeded with `playerAsCard` + tier base (so
   * the ghost hits / pitches off their own player anchor), then
   * `ghostTriggerItems` auto-deals a subset of bag items on top so the
   * AI fights with the inventory it accumulated this run.
   *
   * Without these, the ghost defaulted to a vanilla `dealHand` — full
   * random hand from the global card pool — and the entire ghost item
   * bag was dead code.
   */
  sznGhostRoster?: RosterPlayer[];
  sznGhostBag?: Item[];
  /** Score state at the start of the at-bat, used to drive ghost item triggers. */
  sznGhostContext?: { inning: number; ghostScore: number; userScore: number };
  /**
   * Flat additive boost to the user's anchor card base value for the
   * upcoming series. Populated by Hold-the-Line encounter; cleared at
   * week rollover. Ghost anchors are NEVER boosted (this is a user-only
   * buff bought from a Front Office encounter).
   */
  sznUserNextGameBoost?: number;
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
  // SZN Mode hand seeding: both the user AND the ghost seat start with
  // their `playerAsCard` anchor at the tier base value from their
  // respective rosters. The user's seat stays at [anchor] — items are
  // added at runtime via the SznFooterDecks deal action. The ghost's
  // seat additionally auto-deals a subset of the ghost item bag via
  // `ghostTriggerItems` so the AI plays with the inventory it built
  // through the run (otherwise the ghost bag is dead code and the
  // ghost fights with a hollow [anchor] hand).
  let sznBatterHand: CardDefinition[] | null = null;
  let sznPitcherHand: CardDefinition[] | null = null;
  if (opts.sznMode) {
    const userIsBatting = opts.sznUserSide === "Batting";

    const seedSeat = (
      player: MlbPlayer,
      roster: RosterPlayer[] | undefined,
      isGhost: boolean,
    ): CardDefinition[] => {
      const slot = roster?.find((r) => r.player.id === player.id);
      // Stack rarity base + roster-locked rookie-veteran boost +
      // encounter-applied permanent score override (Special Dirt,
      // Statcast Optimizer, etc.). All three are additive.
      // The user-only nextGameRosterBoost (Hold-the-Line encounter)
      // layers on top of rarity + permanent boost + score override so
      // every user player swings harder for the duration of the
      // upcoming series. Ghost anchors never receive the boost.
      const nextGameBoost = !isGhost ? (opts.sznUserNextGameBoost ?? 0) : 0;
      const rarityBase = slot
        ? RARITY_BASE_VALUE[slot.rarity] + (slot.permanentBoost ?? 0) + (slot.scoreOverride ?? 0) + nextGameBoost
        : RARITY_BASE_VALUE.common + nextGameBoost;
      // playerAsCard now consumes optional roster overrides so the
      // dealt anchor card carries the live (encounter-mutated) edges
      // and the synthetic team-logo resolves to the player's real
      // franchise logo.
      // -----------------------------------------------------------
      // IMPORTANT: when a roster slot exists, feed `slot.player`
      // (the ORIGINAL SznPlayer) into `playerAsCard`, NOT `player`
      // (which is the `asMlbPlayerCompat`-flattened version from
      // the at-bat pool). `asMlbPlayerCompat` strips the semantic
      // SZN edges and stamps `wildcard` shape sockets on both sides
      // for legacy-engine compatibility -- so if we pass that
      // compat object in, `playerAsCard` takes its non-SZN branch
      // and the at-bat anchor renders with WILDCARD edges instead
      // of the player's actual `leftEdge`/`rightEdge`. That's the
      // exact "batter shows wildcards at bat but real edges in the
      // footer rail" bug the audit flagged. Falling back to the
      // pool player only when no roster slot was found preserves
      // the legacy Quick-Match seed path.
      const sourcePlayer = slot ? slot.player : player;
      const overrides = slot
        ? {
            leftEdgeOverride: slot.leftEdgeOverride,
            rightEdgeOverride: slot.rightEdgeOverride,
          }
        : undefined;
      const anchor: CardDefinition = {
        ...playerAsCard(sourcePlayer, overrides),
        baseValue: rarityBase,
      };
      if (!isGhost) return [anchor];

      // Ghost: layer item-bag draws on top of the anchor.
      const bag = opts.sznGhostBag ?? [];
      const ctx = opts.sznGhostContext;
      const ghostScore = ctx?.ghostScore ?? 0;
      const userScore = ctx?.userScore ?? 0;
      const triggered = ghostTriggerItems({
        inning: ctx?.inning ?? 1,
        trailingBy: Math.max(0, userScore - ghostScore),
        bagCardIds: bag.map((b) => b.cardId),
      });
      const items: CardDefinition[] = [];
      const seen = new Set<string>([anchor.id]);
      for (const cardId of triggered) {
        if (seen.has(cardId)) continue;
        const card = SESSION_CARDS.find((c) => c.id === cardId);
        if (!card) continue;
        seen.add(cardId);
        items.push(card);
        // Match the user seat's 6-card cap (anchor + 5 items).
        if (items.length >= 5) break;
      }
      return [anchor, ...items];
    };

    if (userIsBatting) {
      sznBatterHand = seedSeat(batter, opts.sznUserRoster, false);
      if (opts.sznGhostRoster) {
        sznPitcherHand = seedSeat(pitcher, opts.sznGhostRoster, true);
      }
    } else if (opts.sznUserSide === "Pitching") {
      sznPitcherHand = seedSeat(pitcher, opts.sznUserRoster, false);
      if (opts.sznGhostRoster) {
        sznBatterHand = seedSeat(batter, opts.sznGhostRoster, true);
      }
    }
  }
  // Hand overrides take precedence over SZN seeds (non-SZN-mode lanes
  // still send full bag hands the legacy way).
  const rawBatter =
    opts.userBatterHandOverride && opts.userBatterHandOverride.length > 0
      ? opts.userBatterHandOverride.slice(0, 5)
      : sznBatterHand
        ? sznBatterHand
        : dealHand(batter);
  const rawPitcher =
    opts.userPitcherHandOverride && opts.userPitcherHandOverride.length > 0
      ? opts.userPitcherHandOverride.slice(0, 5)
      : sznPitcherHand
        ? sznPitcherHand
        : dealHand(pitcher);

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

/**
 * Re-derive every "what's in the hand changed" piece of state after a
 * mid-at-bat hand mutation (SZN deal / recall / player swap). Without
 * this pass, choice cards / reveal cards dealt mid-at-bat silently never
 * fire because `pendingChoices` / `pendingReveals` were frozen at deal
 * time (b-65 Guess Pitch, b-12 Switch Hitter, p-56 Pinpoint Control,
 * b-7 / b-121 / p-51 / p-59 reveals).
 *
 * When `newlyDealt` is provided, the new card's HAND_TRANSFORMS (if any)
 * are applied surgically so that p-31 / p-35 / p-42 / b-21 / etc. fire
 * on the existing hand. We deliberately do NOT re-run every transform
 * (which would double-apply non-idempotent effects like b-21 destroy
 * highest general or b-119 -2 to generals).
 *
 * `activeChoiceCardId` is cleared when its target card left the hand
 * (e.g. the user recalled a card that had an open modal).
 */
function reconcileSznHandState(
  s: GameState,
  newlyDealt?: { card: CardDefinition; side: "Batting" | "Pitching" },
): Partial<GameState> {
  let bh = s.batterHand;
  let ph = s.pitcherHand;
  const impacting = new Set(s.pitcherTransformsImpactingBatter);

  if (newlyDealt) {
    const transform = HAND_TRANSFORMS[newlyDealt.card.id];
    if (transform) {
      const patch = transform();
      if (newlyDealt.side === "Batting") {
        if (patch.ownHandPatch) bh = patch.ownHandPatch(bh);
        if (patch.opponentHandPatch) ph = patch.opponentHandPatch(ph);
      } else {
        if (patch.ownHandPatch) ph = patch.ownHandPatch(ph);
        if (patch.opponentHandPatch) {
          const batterIgnores = bh.some((c) => c.id === "b-9");
          if (!batterIgnores) {
            const before = bh;
            bh = patch.opponentHandPatch(bh);
            if (before !== bh) impacting.add(newlyDealt.card.id);
          }
        }
      }
    }
  }

  const pendingChoices = derivePendingChoices(bh, ph);
  const pendingReveals = derivePendingReveals(bh, ph);

  let activeChoiceCardId = s.activeChoiceCardId;
  if (activeChoiceCardId) {
    const inHand =
      bh.some((c) => c.id === activeChoiceCardId) ||
      ph.some((c) => c.id === activeChoiceCardId);
    if (!inHand) activeChoiceCardId = null;
  }

  return {
    batterHand: bh,
    pitcherHand: ph,
    pitcherTransformsImpactingBatter: Array.from(impacting),
    pendingChoices,
    pendingReveals,
    activeChoiceCardId,
  };
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

/**
 * Centralized "wipe everything the next lane shouldn't inherit" reset.
 * Returned as a `Partial<GameState>` so the caller can spread it into a
 * single `set()` alongside any lane-specific seeds. Covers state that
 * historically leaked across SZN -> Quick Match / Draft / menu transitions
 * (e.g. `totalInnings: 3` from a SZN series, the live `sznFooterHeight`
 * snapshot, leftover runners, etc.).
 *
 * Callers that need to keep a specific slice (e.g. preserve `userTeam`
 * across a reset) should spread their override AFTER this object so the
 * "keep" wins.
 */
function resetEphemeralGameplay(): Partial<GameState> {
  return {
    phase: "selecting",
    totalInnings: 9,
    sznFooterHeight: 0,
    // Always start a fresh gameplay session with focus on the screen
    // so the very first DPAD press lands on a visible target (FO grid /
    // EndRun CTA / etc.) and not the silent footer.
    sznGamepadFocus: 'screen',
    // Quick Resolve is intentionally a per-session opt-in -- never
    // carry it across SZN -> Quick Match / Draft / menu transitions
    // so a fresh game always starts with full manual control.
    quickResolveEnabled: false,
    resolveInningTarget: null,
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
    revealScript: [],
    pendingResolvedPhase: null,
    revealUiUserSide: null,
  };
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

  seasonWins: 0,
  seasonLosses: 0,
  teamBudget: 1000,
  inventory: [],
  equippedItems: {},

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
  // Stay hidden until the user explicitly clicks the SZN lane.
  showSznTeamSelect: false,

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

  sznFooterHeight: 0,
  sznGamepadFocus: 'screen',
  encounterFocusEdges: null,
  purchaseFlight: null,
  quickResolveEnabled: false,
  resolveInningTarget: null,

  run: null,

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
      equippedItems: s.equippedItems,
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
      sznRallyFireActive:
        s.gameMode === "szn" &&
        getUserSide(s) === "Batting" &&
        (s.run?.rallyFireWeeksLeft ?? 0) > 0,
      sznSpeedMultiplierBonus: sznSpeedMultiplierForSide(s, "Batting"),
      sznChainLengthForgiveness: sznChainLengthForgivenessForSide(s, "Batting"),
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
      equippedItems: s.equippedItems,
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
      sznRallyFireActive:
        s.gameMode === "szn" &&
        getUserSide(s) === "Pitching" &&
        (s.run?.rallyFireWeeksLeft ?? 0) > 0,
      sznSpeedMultiplierBonus: sznSpeedMultiplierForSide(s, "Pitching"),
      sznChainLengthForgiveness: sznChainLengthForgivenessForSide(s, "Pitching"),
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
    const rawBatterResult = workingBatterHand === s.batterHand
      ? s.scoreBatter()
      : scoreHandFor(s, workingBatterHand, "Batting");
    const pitcherResult = s.scorePitcher();

    // SZN Deception edge: 25% chance per Deception snap on the defender's
    // chain to shatter the opposing chain. We roll once at lock-in so the
    // preview pill doesn't leak the outcome (random per-render rolls would
    // also be unfair). Non-SZN paths return the raw batterResult intact.
    const { batterResult, shattered: deceptionShattered } =
      s.gameMode === "szn"
        ? maybeApplyDeception(s, rawBatterResult, pitcherResult)
        : { batterResult: rawBatterResult, shattered: false };
    void deceptionShattered;

    const m = computeMatchup(s, batterResult, pitcherResult);

    // SZN side effects that mutate the run state (cash queue, Veteran
    // permanent boosts, Movement debuff stacks). No-op outside SZN.
    const sznSide = applySznLockInSideEffects(s, batterResult, pitcherResult);

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
    const nextDebuffs = [
      ...drainedDebuffs,
      ...resolveDelta.pendingDebuffs,
      ...sznSide.extraDebuffs,
    ];

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

    const sznRunPatch =
      sznSide.runPatch && s.run
        ? { run: { ...s.run, ...sznSide.runPatch } }
        : null;

    set({
      ...next,
      ...questPatch,
      ...(sznRunPatch ?? {}),
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
    // SZN Mode: keep the user's hand seeded with just the player card so
    // every at-bat surfaces the new active batter/pitcher and the user
    // re-deals items from the Dugout drawer per at-bat. The ghost seat
    // also gets seeded (playerAsCard + tier + auto-dealt items) so the
    // opponent fights with their run inventory instead of a vanilla hand.
    const sznMode = s.gameMode === "szn" && s.run !== null;
    const userBattingNext = getUserSide(s) === "Batting";
    const sznGhost = sznMode ? s.run!.ghost : null;
    const ghostIsHome = s.userTeam === "AWAY";
    const ghostScore = ghostIsHome ? s.homeScore : s.awayScore;
    const userScore = ghostIsHome ? s.awayScore : s.homeScore;
    const ab = freshAtBat({
      recent: { batters: s.recentBatterIds, pitchers: s.recentPitcherIds },
      battersPool: pools.battersPool,
      pitchersPool: pools.pitchersPool,
      sznMode,
      sznUserSide: sznMode ? (userBattingNext ? "Batting" : "Pitching") : undefined,
      sznUserRoster: sznMode ? s.run!.roster : undefined,
      sznGhostRoster: sznGhost?.roster,
      sznGhostBag: sznGhost?.itemBag,
      sznGhostContext: sznGhost
        ? { inning: s.inning, ghostScore, userScore }
        : undefined,
      sznUserNextGameBoost: sznMode ? s.run!.nextGameRosterBoost ?? 0 : 0,
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
  setShowSznTeamSelect: (open) => set({ showSznTeamSelect: open }),

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
    // inning into a fresh draft. Also wipes SZN-only leakage (totalInnings,
    // sznFooterHeight) so a SZN -> Draft transition starts from baseline.
    set({
      ...resetEphemeralGameplay(),
      phase: "drafting",
      userTeam: team,
      gameMode: "draft",
      draft,
      run: null,
      ...ab,
      atBatId: s.atBatId + 1,
      recentBatterIds: [ab.batter.id],
      recentPitcherIds: [ab.pitcher.id],
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
    // in between). `resetEphemeralGameplay` also wipes SZN-only state
    // (totalInnings: 3, sznFooterHeight) so a SZN-to-QuickMatch jump
    // starts from the baseline 9-inning game.
    const battingTeam: Team = "AWAY"; // half === "top" on a fresh game
    const battingSide = battingTeam === team ? "user" : "ai";
    const fieldingSide = battingSide === "user" ? "ai" : "user";
    const ab = freshAtBat({
      battersPool: draft.roster[battingSide].batters,
      pitchersPool: draft.roster[fieldingSide].pitchers,
    });
    set({
      ...resetEphemeralGameplay(),
      phase: "shop",
      userTeam: team,
      gameMode: "quick-match",
      draft,
      run: null,
      seasonWins: 0,
      seasonLosses: 0,
      teamBudget: 1000,
      inventory: [],
      equippedItems: {},
      ...ab,
      atBatId: s.atBatId + 1,
      recentBatterIds: [ab.batter.id],
      recentPitcherIds: [ab.pitcher.id],
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

  // =========================================================================
  // SZN Mode actions (run-loop pivot).
  // =========================================================================

  startSznRun: (mlbTeamId) => {
    const s = get();
    const ab = freshAtBat();
    const team = MLB_TEAMS[mlbTeamId];
    // Per-run SZN edge remix. Mutates SESSION_CARDS in place so every
    // downstream consumer (merchant rolls, random rewards, hand
    // dealings) picks up the new sznLeftEdge / sznRightEdge for this
    // run. Encounter items (`enc-*`) are skipped inside the
    // randomizer so their curated edges (mega-seam, defense-shield,
    // etc.) stay authoritative. We do this BEFORE openStarterPack
    // rolls Mon..Thu offers so the first encounters render with
    // run-fresh edges instead of leftover (or undefined) ones.
    const runSeed = Math.floor(Math.random() * 0x7fffffff);
    randomizeCardEdges(SESSION_CARDS, runSeed);
    if (typeof console !== "undefined") {
      console.info(`[dugout] szn run edge seed = ${runSeed}`);
    }
    const run: RunState = {
      ...emptyRunState(),
      selectedTeamId: mlbTeamId,
      badges: team ? [team.passiveBadgeId] : [],
    };
    set({
      ...resetEphemeralGameplay(),
      gameMode: "szn",
      // SZN runs always plant the user in the AWAY (batting first) seat;
      // the MLB franchise picked at the start screen drives the player
      // pool, not the away/home seat distinction.
      userTeam: "AWAY",
      run,
      ...ab,
      atBatId: s.atBatId + 1,
      // Quests dormant in SZN Mode for v1.
      activeQuests: [],
      questProgress: {},
      completedQuests: [],
      questCelebrationQueue: [],
      questTick: 0,
      questShakeRequestId: 0,
      ...QUEST_REWARD_INITIAL,
      showStartScreen: false,
      showSznTeamSelect: false,
      tutorialActive: false,
      tutorialStepIndex: 0,
      // Auction draft state irrelevant to SZN.
      draft: null,
    });
    // Skip the 3D pack-rip cinematic and deal the starter roster +
    // Mon..Thu encounters + ghost + Monday scouting RIGHT NOW so the
    // user lands directly in the Front Office where the SZN footer
    // rail shows their 10-player roster (with SZN edge halves) as
    // the "here are your players" moment. `openStarterPack` is
    // idempotent against an already-populated roster but on a fresh
    // run it does all the meaningful work (roster deal, week
    // encounters, ghost snapshot, scouting report).
    get().openStarterPack();
    const seeded = get().run;
    if (seeded) {
      set({ run: { ...seeded, packRipPending: false } });
    }
  },

  openStarterPack: () => {
    const s = get();
    if (!s.run) return;
    // Pull the SZN player pool for the selected team. Each team's pool
    // is up to 20 players; we deal a random 10 with at least 1 pitcher
    // guaranteed so the roster has a starting arm. Fallback to the
    // legacy MlbPlayer pool when running with a team whose SZN pool
    // hasn't been built yet (the picker should prevent this, but the
    // fallback keeps the SZN flow bootable for placeholder teams).
    const pickN = <T,>(pool: T[], n: number): T[] => {
      const out: T[] = [];
      const work = [...pool];
      for (let i = 0; i < n && work.length > 0; i++) {
        const idx = Math.floor(Math.random() * work.length);
        out.push(work.splice(idx, 1)[0]);
      }
      return out;
    };

    const teamId = s.run.selectedTeamId;
    const sznPool = teamId ? SZN_PLAYERS_BY_TEAM[teamId] ?? [] : [];

    let roster: RosterPlayer[] = [];
    if (sznPool.length >= STARTER_PACK_TOTAL) {
      const batters = sznPool.filter((p) => p.role === "Batter");
      const pitchers = sznPool.filter((p) => p.role === "Pitcher");
      const starterBatters = pickN(batters, STARTER_PACK_BATTERS);
      const starterPitchers = pickN(pitchers, STARTER_PACK_PITCHERS);
      // Pitchers first so the footer rail's underlying array order
      // matches the visual default (pitchers anchor the left deck).
      // Footer "move mode" reorders this array directly; the runtime
      // sort that used to flip batters->pitchers has been removed so
      // user-curated order isn't clobbered every render.
      roster = [
        ...starterPitchers.map((p) => ({
          player: p as SznPlayer,
          rarity: "common" as Rarity,
          tag: p.tag,
        })),
        ...starterBatters.map((p) => ({
          player: p as SznPlayer,
          rarity: "common" as Rarity,
          tag: p.tag,
        })),
      ];
    } else {
      // Legacy fallback for un-built placeholder teams.
      const batterPool = [...PLAYERS.filter((p) => p.role === "Batter")];
      const pitcherPool = [...PLAYERS.filter((p) => p.role === "Pitcher")];
      const starterBatters = pickN(batterPool, STARTER_PACK_BATTERS);
      const starterPitchers = pickN(pitcherPool, STARTER_PACK_PITCHERS);
      roster = [
        ...starterPitchers.map((p) => ({ player: p, rarity: "common" as Rarity, tag: p.tag })),
        ...starterBatters.map((p) => ({ player: p, rarity: "common" as Rarity, tag: p.tag })),
      ];
    }
    // Generate Mon..Thu encounters off the new roster. Each day starts
    // with picksUsed=0; the slate auto-refreshes after each pick.
    // Brand-new run -> week 1 pricing (cheap floor so $14 starting cash
    // can actually buy 3 items on day one). Cumulative dedupe set so
    // no encounter id appears more than once across the entire
    // Monday→Thursday slate (per the "no encounter twice in a week"
    // rule); each day's roll filters against everything earlier days
    // already produced.
    const pickBudgets = rollWeekPickBudgets();
    const seenThisWeek = new Set<string>();
    // First week of a fresh run: the cross-week ring is empty by
    // definition, so the dedupe just falls back to the in-week set.
    const recentRing = new Set<string>(s.run.recentEncounterRing ?? []);
    const weekEncounters = FRONT_OFFICE_DAYS.map((day, i) => {
      const offers = rollDailyOffers(
        roster,
        1,
        pickBudgets[i],
        seenThisWeek,
        recentRing,
      );
      for (const o of offers) seenThisWeek.add(encounterOfferId(o));
      return {
        day,
        offers,
        picksUsed: 0,
        pickBudget: pickBudgets[i],
      };
    });
    const nextRecentRing = pushEncounterRing(
      s.run.recentEncounterRing,
      Array.from(seenThisWeek),
    );
    // Seed this week's ghost + Monday scouting report NOW. The ghost
    // still exists for the Friday series; the scouting report is no
    // longer ABOUT the ghost (it's worldbuilding flavor + foreshadow
    // for what shows up in the week's encounters), so we build it
    // from the run state AFTER the week's encounters are stamped on
    // -- that way the ability / player hints can foreshadow the
    // actual upcoming merchant + market listings.
    const interimRun: RunState = {
      ...s.run,
      roster,
      weekEncounters,
      day: "mon",
      seenEncountersThisWeek: Array.from(seenThisWeek),
      recentEncounterRing: nextRecentRing,
    };
    const ghost = buildGhostSnapshot(interimRun);
    const weeklyScout = rollWeeklyScout(interimRun);
    set({
      run: {
        ...s.run,
        roster,
        weekEncounters,
        ghost,
        weeklyScout,
        weekScoutingAcknowledged: false,
        seenEncountersThisWeek: Array.from(seenThisWeek),
        recentEncounterRing: nextRecentRing,
        // packRipPending is flipped to false by the `startSznRun`
        // caller IMMEDIATELY after this action so the Front Office
        // mounts directly without the 3D pack-rip cinematic. The
        // field is retained on the type for backwards-compatibility
        // and so we can resurrect the pack-rip flow later if desired.
        day: "mon",
      },
    });
  },

  dismissPackRip: () => {
    const s = get();
    if (!s.run) return;
    set({ run: { ...s.run, packRipPending: false } });
  },

  acknowledgeWeekScouting: () => {
    const s = get();
    if (!s.run) return;
    set({ run: { ...s.run, weekScoutingAcknowledged: true } });
  },

  /**
   * Commit one of today's encounter slots. Bazaar-style: every pick
   * burns one of the day's `pickBudget` slots (1–3 per day) AND replaces the
   * full slate with a fresh roll at the same slot count. When all picks are
   * spent the day auto-advances. Idempotent if called when no run is
   * active or the day is already in series mode.
   */
  commitEncounter: () => {
    const s = get();
    if (!s.run || s.run.day === "series") return;
    const dayKey = s.run.day as DayOfWeek;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
    if (dayIdx < 0) return;
    const day = s.run.weekEncounters[dayIdx];
    if (!day) return;
    const budget = dayPickBudget(day);
    // Idempotency guard: if the budget is already at the cap, advance
    // without burning another pick. Protects against a fast double-commit
    // (e.g., re-render race) over-spending the day.
    if (day.picksUsed >= budget) {
      get().advanceDay();
      return;
    }
    // Clamp so picksUsed can never exceed the cap, even if a future
    // caller bypasses the early-return above.
    const nextPicksUsed = Math.min(day.picksUsed + 1, budget);
    const weekEncounters = [...s.run.weekEncounters];
    if (nextPicksUsed >= budget) {
      // Day is over -- advance. We don't bother re-rolling first since
      // the FrontOfficeScreen will route off this day anyway.
      weekEncounters[dayIdx] = { ...day, picksUsed: nextPicksUsed };
      set({ run: { ...s.run, weekEncounters } });
      // Re-read state then advance via the same advanceDay action.
      get().advanceDay();
      return;
    }
    // Build the cumulative "no encounter twice in a week" exclude set
    // BEFORE re-rolling: prior week-level history + every offer still
    // sitting in OTHER days' slates + the offers about to be replaced
    // in THIS day's slate. Without this the re-roll could resurface
    // an encounter the user just saw two seconds ago on the same row.
    const excludeIds = new Set<string>(s.run.seenEncountersThisWeek ?? []);
    s.run.weekEncounters.forEach((d, i) => {
      if (i === dayIdx) return;
      for (const o of d.offers) excludeIds.add(encounterOfferId(o));
    });
    for (const o of day.offers) excludeIds.add(encounterOfferId(o));
    // Cross-week ring narrows the candidate pool further (last ~12
    // encounters across any week). Roll callers skip the ring when
    // applying it would drain the tier, so the slate still fills
    // even in late-run states where the ring is saturated.
    const recentRing = new Set<string>(s.run.recentEncounterRing ?? []);
    // Refresh offers — same pick budget / slot count as this calendar day.
    const nextOffers = rollDailyOffers(
      s.run.roster,
      s.run.week,
      budget,
      excludeIds,
      recentRing,
    );
    weekEncounters[dayIdx] = {
      ...day,
      offers: nextOffers,
      picksUsed: nextPicksUsed,
    };
    // Append every freshly-generated id into the week's history so
    // future re-rolls (and other days, if any encounter is still
    // unseen there) can't reintroduce the same encounter again.
    const nextSeen = new Set<string>(excludeIds);
    for (const o of nextOffers) nextSeen.add(encounterOfferId(o));
    // Also accrete the new offers into the cross-week ring so they
    // count against next week's dedupe window.
    const nextRecentRing = pushEncounterRing(
      s.run.recentEncounterRing,
      nextOffers.map((o) => encounterOfferId(o)),
    );
    set({
      run: {
        ...s.run,
        weekEncounters,
        seenEncountersThisWeek: Array.from(nextSeen),
        recentEncounterRing: nextRecentRing,
      },
    });
  },

  purchaseFromMerchant: (slotIndex, listingIndex) => {
    const s = get();
    if (!s.run || s.run.day === "series") return false;
    const dayKey = s.run.day as DayOfWeek;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
    if (dayIdx < 0) return false;
    const day = s.run.weekEncounters[dayIdx];
    const offer = day?.offers[slotIndex];
    if (!offer || offer.kind !== "merchant") return false;
    const listing = offer.listings[listingIndex];
    if (!listing) return false;

    // ----- Intel item: never lands in the bag, no tier routing -----
    // Encounter intel items resolve at purchase time -- they have no
    // playable effect in-hand (sznLeftEdge / sznRightEdge = "blank",
    // baseValue = 0), so dumping them in the bag would just clog a
    // 6-slot inventory. Faded Scouting Report instead peeks one item
    // from the opponent's bag (or names a roster anchor when the bag
    // is empty) and stashes the readout for the SeriesIntro chip.
    if (listing.cardId === "enc-faded-scouting-report") {
      if (s.run.cash < listing.price) return false;
      const ghost = s.run.ghost;
      let intel = "Intel: opponent looks unscoutable.";
      if (ghost) {
        const bagPick = ghost.itemBag.length > 0
          ? ghost.itemBag[Math.floor(Math.random() * ghost.itemBag.length)]
          : null;
        if (bagPick) {
          const card = SESSION_CARDS.find((c) => c.id === bagPick.cardId);
          if (card) intel = `Intel: opponent is likely to deploy ${card.name} next series.`;
        } else {
          const anchor = ghost.roster[Math.floor(Math.random() * ghost.roster.length)];
          if (anchor) intel = `Intel: opponent leans on ${anchor.player.name} (${anchor.rarity.toUpperCase()}).`;
        }
      }
      set({
        run: { ...s.run, cash: s.run.cash - listing.price, mlbScoutingIntel: intel },
      });
      return true;
    }

    // ----- Roster upgrade listing -----
    if (listing.rosterUpgrade) {
      if (s.run.cash < listing.price) return false;
      const idx = indexOfRosterPlayer(s.run.roster, listing.rosterUpgrade.playerId);
      if (idx < 0) return false;
      const target = s.run.roster[idx];
      const expectedDup = target.rarity;
      let nextRoster = s.run.roster;
      if (listing.rosterUpgrade.isReplacement) {
        const upRarity = listing.rosterUpgrade.duplicateRarity;
        if (nextRunRarity(expectedDup) !== upRarity) return false;
        nextRoster = [...nextRoster];
        nextRoster[idx] = { ...target, rarity: upRarity };
      } else {
        if (listing.rosterUpgrade.duplicateRarity !== expectedDup) return false;
        const up = nextRunRarity(expectedDup);
        if (!up) return false;
        nextRoster = [...nextRoster];
        nextRoster[idx] = { ...target, rarity: up };
      }
      set({
        run: {
          ...s.run,
          cash: s.run.cash - listing.price,
          roster: nextRoster,
        },
      });
      return true;
    }

    // ----- Item add (routes through requestAddItem) -----
    // Compute the effective price: if the user already owns the card,
    // the listing is silently re-priced as an upgrade ticket (silver /
    // gold cost ramp from `priceForTier`). Maxed-gold items are
    // rejected upstream by the MerchantView ("MAXED" CTA disabled)
    // but the store also returns false here as a defensive guard.
    const card = SESSION_CARDS.find((c) => c.id === listing.cardId);
    if (!card) return false;
    const owned = s.run.itemBag.find((it) => it.cardId === listing.cardId);
    if (owned) {
      const ownedTier: ItemTier = owned.tier ?? "bronze";
      const target = nextTier(ownedTier);
      if (!target) return false; // gold -> nothing to upgrade
      const upgradePrice = priceForTier(card, s.run.week, target);
      if (s.run.cash < upgradePrice) return false;
      // Charge then upgrade. The router handles the tier mutation.
      set({ run: { ...s.run, cash: s.run.cash - upgradePrice } });
      return get().requestAddItem(listing.cardId, "merchant");
    }
    // Fresh acquire: pay listing price, route through the central
    // router so a full bag opens the replace picker instead of
    // silently failing.
    if (s.run.cash < listing.price) return false;
    set({ run: { ...s.run, cash: s.run.cash - listing.price } });
    return get().requestAddItem(listing.cardId, "merchant");
  },

  rerollMerchant: (slotIndex) => {
    const s = get();
    if (!s.run || s.run.day === "series") return false;
    const dayKey = s.run.day as DayOfWeek;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
    if (dayIdx < 0) return false;
    const day = s.run.weekEncounters[dayIdx];
    if (!day) return false;
    const offer = day.offers[slotIndex];
    if (!offer || offer.kind !== "merchant") return false;
    const used = offer.rerollsUsed ?? 0;
    if (used >= MERCHANT_REROLLS_PER_VISIT) return false;
    const cost = rerollCost(s.run.week);
    if (s.run.cash < cost) return false;
    const fresh = buildMerchantOffer(offer.merchantId, s.run.roster, s.run.week);
    const nextOffer = {
      ...offer,
      listings: fresh.listings,
      rerollsUsed: used + 1,
    };
    const nextOffers = [...day.offers];
    nextOffers[slotIndex] = nextOffer;
    const nextWeekEncounters = [...s.run.weekEncounters];
    nextWeekEncounters[dayIdx] = { ...day, offers: nextOffers };
    set({
      run: {
        ...s.run,
        cash: s.run.cash - cost,
        weekEncounters: nextWeekEncounters,
      },
    });
    return true;
  },

  requestAddItem: (cardId, source) => {
    const s = get();
    if (!s.run) return false;
    const card = SESSION_CARDS.find((c) => c.id === cardId);
    if (!card) return false;
    const bag = s.run.itemBag;

    // ----- Duplicate -> upgrade -----
    const owned = bag.find((it) => it.cardId === cardId);
    if (owned) {
      const ownedTier: ItemTier = owned.tier ?? "bronze";
      const target = nextTier(ownedTier);
      if (!target) return false; // gold-capped: caller should have refunded
      const nextBag = bag.map((it) =>
        it.instanceId === owned.instanceId ? { ...it, tier: target } : it,
      );
      set({ run: { ...s.run, itemBag: nextBag } });
      return true;
    }

    // ----- Bag full -> queue pending grant -----
    if (bag.length >= MAX_BAG_SIZE) {
      const refundOnCancel = Math.max(
        1,
        Math.ceil(sellValueFor(card, s.run.week, "bronze") * 0.5),
      );
      const pending: PendingItemGrant = {
        cardId,
        source,
        refundOnCancel,
        label: card.name,
      };
      set({ run: { ...s.run, pendingItemGrant: pending } });
      return false;
    }

    // ----- Bag has room -> land at bronze + fire onAcquire -----
    const acquirePatch = sznItemAcquirePatch(cardId, "bronze");
    const nextBag: Item[] = [
      ...bag,
      { instanceId: makeRunId("itm"), cardId, tier: "bronze" as ItemTier },
    ];
    set({
      run: {
        ...s.run,
        itemBag: nextBag,
        rallyFireWeeksLeft:
          s.run.rallyFireWeeksLeft + (acquirePatch?.rallyFireWeeksAdd ?? 0),
        defenseShields:
          s.run.defenseShields + (acquirePatch?.defenseShieldAdd ?? 0),
      },
    });
    return true;
  },

  confirmReplaceAndAdd: (replacedInstanceId) => {
    const s = get();
    if (!s.run || !s.run.pendingItemGrant) return false;
    const pending = s.run.pendingItemGrant;
    const slot = s.run.itemBag.find((it) => it.instanceId === replacedInstanceId);
    if (!slot) return false;
    const slotCard = SESSION_CARDS.find((c) => c.id === slot.cardId);
    if (!slotCard) return false;
    const card = SESSION_CARDS.find((c) => c.id === pending.cardId);
    if (!card) return false;
    const refund = sellValueFor(slotCard, s.run.week, slot.tier ?? "bronze");
    const acquirePatch = sznItemAcquirePatch(pending.cardId, "bronze");
    const filteredBag = s.run.itemBag.filter(
      (it) => it.instanceId !== replacedInstanceId,
    );
    const nextBag: Item[] = [
      ...filteredBag,
      {
        instanceId: makeRunId("itm"),
        cardId: pending.cardId,
        tier: "bronze" as ItemTier,
      },
    ];
    set({
      run: {
        ...s.run,
        cash: s.run.cash + refund,
        itemBag: nextBag,
        pendingItemGrant: null,
        rallyFireWeeksLeft:
          s.run.rallyFireWeeksLeft + (acquirePatch?.rallyFireWeeksAdd ?? 0),
        defenseShields:
          s.run.defenseShields + (acquirePatch?.defenseShieldAdd ?? 0),
      },
    });
    return true;
  },

  cancelPendingItemGrant: () => {
    const s = get();
    if (!s.run || !s.run.pendingItemGrant) return;
    const refund = s.run.pendingItemGrant.refundOnCancel;
    set({
      run: {
        ...s.run,
        cash: s.run.cash + refund,
        pendingItemGrant: null,
      },
    });
  },

  sellItemForCash: (instanceId) => {
    const s = get();
    if (!s.run) return 0;
    const slot = s.run.itemBag.find((it) => it.instanceId === instanceId);
    if (!slot) return 0;
    const card = SESSION_CARDS.find((c) => c.id === slot.cardId);
    if (!card) return 0;
    const refund = sellValueFor(card, s.run.week, slot.tier ?? "bronze");
    const nextBag = s.run.itemBag.filter((it) => it.instanceId !== instanceId);
    set({
      run: {
        ...s.run,
        cash: s.run.cash + refund,
        itemBag: nextBag,
      },
    });
    return refund;
  },

  upgradeOwnedItem: (cardId) => {
    const s = get();
    if (!s.run) return false;
    const owned = s.run.itemBag.find((it) => it.cardId === cardId);
    if (!owned) return false;
    const target = nextTier(owned.tier ?? "bronze");
    if (!target) return false;
    const nextBag = s.run.itemBag.map((it) =>
      it.instanceId === owned.instanceId ? { ...it, tier: target } : it,
    );
    set({ run: { ...s.run, itemBag: nextBag } });
    return true;
  },

  resolveEventChoice: (slotIndex, choiceId, targetPlayerId) => {
    const s = get();
    if (!s.run || s.run.day === "series") return;
    const dayKey = s.run.day as DayOfWeek;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
    if (dayIdx < 0) return;
    const day = s.run.weekEncounters[dayIdx];
    const offer = day?.offers[slotIndex];
    if (!offer || offer.kind !== "event") return;
    const choice = offer.choices.find((c) => c.choiceId === choiceId);
    if (!choice) return;

    // Overlay any picker-resolved playerId onto the effect before
    // dispatch. The encounter table ships effects with `playerId: ""`
    // for picker-driven choices; without this step the dispatcher
    // would no-op them.
    let eff: EventEffect = choice.effect;
    if (targetPlayerId && "playerId" in eff) {
      eff = { ...eff, playerId: targetPlayerId } as EventEffect;
    }
    // Local mutable run patch built up across effect branches so a
    // single dispatch only writes once at the end. Karma 2x doubles
    // cash + badge deltas; we apply it inside the cash/queueNextWeekCash
    // branches because per-snap badge triggers fan-out separately in
    // applySznLockInSideEffects.
    const karmaMul = s.run.karmaDoubleTriggers ? 2 : 1;
    let cash = s.run.cash;
    let bag = s.run.itemBag;
    let roster = s.run.roster;
    let badges = s.run.badges;
    let defenseShields = s.run.defenseShields;
    let bangingSchemeWeeksLeft = s.run.bangingSchemeWeeksLeft;
    let karmaDoubleTriggers = s.run.karmaDoubleTriggers;
    let rallyFireWeeksLeft = s.run.rallyFireWeeksLeft;
    let suspendedPlayerIds = s.run.suspendedPlayerIds;
    let nextGameRosterBoost = s.run.nextGameRosterBoost;
    let nextWeekCashBonus = s.run.nextWeekCashBonus;
    let mlbScoutingIntel = s.run.mlbScoutingIntel;
    /**
     * Staging slots for item grants that need to defer to the
     * `requestAddItem` central router AFTER the local dispatcher
     * commits its other deltas. We can't call requestAddItem inline
     * because that action does its own `set()`; running it before the
     * dispatcher's final `set()` would clobber the encounter's
     * cash / roster / etc. writes. Instead we record the intent here
     * and flush after the main `set()` lands.
     */
    let pendingGrantCardId: string | null = null;
    let pendingRandomGrantPool: "any" | "batting" | "pitching" | null = null;

    // Single-player overrides are written in place; we clone the slot
    // before mutating so React identity changes trigger re-renders.
    const mutateRoster = (id: string, patch: Partial<RosterPlayer>) => {
      roster = roster.map((r) => (r.player.id === id ? { ...r, ...patch } : r));
    };

    // Choices marked with `costPreview` charge the user up-front (used
    // by encounter "buy" choices that resolve into non-cash effects
    // like queueDefenseShields / mutateRosterEdge / grantItem). Pure
    // `kind: "cash"` effects already encode their own delta and skip
    // this branch. We silently clamp at 0; the EventEncounterView is
    // responsible for hiding/disabling unaffordable choices.
    if (choice.costPreview && choice.costPreview > 0 && eff.kind !== "cash") {
      cash = Math.max(0, cash - choice.costPreview);
    }

    if (eff.kind === "cash") {
      cash = Math.max(0, cash + eff.delta * karmaMul);
    } else if (eff.kind === "addItemRandom") {
      // Pick a random item, then defer to `requestAddItem` so the
      // standard upgrade-on-duplicate / open-picker-on-full routing
      // applies. We roll up to 8 times to surface a non-owned card
      // for the bronze branch; if every roll lands on an owned card
      // the router will simply upgrade the owned copy (still a "free
      // item" outcome, just expressed through the tier system) --
      // and we deliberately defer to that branch instead of failing.
      //
      // Important: we MUST commit the local cash/bag/etc deltas BEFORE
      // calling requestAddItem because that action does its own set(),
      // and otherwise our pending writes would be clobbered.
      pendingRandomGrantPool = eff.pool;
    } else if (eff.kind === "removeRandomItem") {
      if (bag.length > 0) {
        const idx = Math.floor(Math.random() * bag.length);
        bag = bag.filter((_, i) => i !== idx);
      }
    } else if (eff.kind === "grantItem") {
      // Defer the actual bag mutation to requestAddItem (see comment
      // on `addItemRandom` above for the staging-flush rationale).
      pendingGrantCardId = eff.cardId;
    } else if (eff.kind === "mutateRosterEdge") {
      // Side selector lets a single encounter stamp left, right, or
      // both. `alsoBlank` is a follow-up that blanks the opposite
      // side (Statcast Optimizer: stamp contact on left, blank right).
      const slot = roster.find((r) => r.player.id === eff.playerId);
      if (slot) {
        const patch: Partial<RosterPlayer> = {};
        if (eff.side === "left" || eff.side === "both") {
          patch.leftEdgeOverride = eff.edge;
        }
        if (eff.side === "right" || eff.side === "both") {
          patch.rightEdgeOverride = eff.edge;
        }
        if (eff.alsoBlank === "left") {
          patch.leftEdgeOverride = "blank";
        } else if (eff.alsoBlank === "right") {
          patch.rightEdgeOverride = "blank";
        }
        mutateRoster(eff.playerId, patch);
      }
    } else if (eff.kind === "swapPlayerEdges") {
      const slot = roster.find((r) => r.player.id === eff.playerId);
      if (slot && isSznPlayer(slot.player)) {
        const liveLeft = slot.leftEdgeOverride ?? slot.player.leftEdge;
        const liveRight = slot.rightEdgeOverride ?? slot.player.rightEdge;
        mutateRoster(eff.playerId, {
          leftEdgeOverride: liveRight,
          rightEdgeOverride: liveLeft,
        });
      }
    } else if (eff.kind === "scoreOverridePlayer") {
      const slot = roster.find((r) => r.player.id === eff.playerId);
      if (slot) {
        mutateRoster(eff.playerId, {
          scoreOverride: (slot.scoreOverride ?? 0) + eff.delta,
        });
      }
    } else if (eff.kind === "boostNextGameAll") {
      nextGameRosterBoost += eff.delta;
    } else if (eff.kind === "permanentBoostAll") {
      roster = roster.map((r) => ({
        ...r,
        scoreOverride: (r.scoreOverride ?? 0) + eff.delta,
      }));
    } else if (eff.kind === "addBadge") {
      if (!badges.includes(eff.badgeId)) {
        badges = [...badges, eff.badgeId];
      }
    } else if (eff.kind === "setKarmaDouble") {
      karmaDoubleTriggers = eff.on;
    } else if (eff.kind === "queueDefenseShields") {
      defenseShields += eff.count;
    } else if (eff.kind === "queueBangingScheme") {
      bangingSchemeWeeksLeft += eff.weeks;
    } else if (eff.kind === "queueNextWeekCash") {
      nextWeekCashBonus += eff.delta * karmaMul;
    } else if (eff.kind === "queueRallyFire") {
      rallyFireWeeksLeft += eff.weeks;
    } else if (eff.kind === "randomizeRosterEdges") {
      // Clubhouse Prank "chaos" branch: pick `count` random roster
      // slots and roll each one a fresh wildcard edge on each side.
      // We constrain to known-safe SZN edges (no encounter-specific
      // syntheticas) so the resulting overrides actually snap.
      const safe: import("./sznEdges").SznEdgeId[] = [
        "power", "speed", "contact", "patience",
        "velocity", "movement", "control", "deception",
        "infield", "outfield", "battery",
      ];
      const indices: number[] = [];
      while (indices.length < Math.min(eff.count, roster.length)) {
        const idx = Math.floor(Math.random() * roster.length);
        if (!indices.includes(idx)) indices.push(idx);
      }
      const next = roster.slice();
      for (const idx of indices) {
        const pickEdge = () => safe[Math.floor(Math.random() * safe.length)];
        next[idx] = {
          ...next[idx],
          leftEdgeOverride: pickEdge(),
          rightEdgeOverride: pickEdge(),
        };
      }
      roster = next;
    } else if (eff.kind === "suspendTopScorers") {
      // Marker only: the actual scoring-prediction happens at series
      // intro time; here we just record the intent. We synthesize a
      // sentinel id "suspend:Batting" / "suspend:Pitching" the
      // series-setup code will resolve into a concrete player.
      const sentinels = eff.sides.map((side) => `suspend:${side}`);
      suspendedPlayerIds = [...suspendedPlayerIds, ...sentinels];
    } else if (eff.kind === "pokerCashWager") {
      // Coin flip: 50/50 net payout vs lose-and-exhaust. Pitcher
      // exhaustion is encoded as a suspended id sentinel that the
      // series-setup code resolves into the actual top pitcher.
      const win = Math.random() < 0.5;
      if (win) {
        cash = Math.max(0, cash + eff.winPayout * karmaMul);
      } else {
        cash = Math.max(0, cash - eff.bet);
        suspendedPlayerIds = [...suspendedPlayerIds, "suspend:Pitching"];
      }
    } else if (eff.kind === "pokerPlayerWager") {
      const win = Math.random() < 0.5;
      if (win) {
        mutateRoster(eff.playerId, {
          leftEdgeOverride: "wildcard",
          rightEdgeOverride: "wildcard",
        });
      } else {
        // Loss: blank edges and zero out the score. We don't drop the
        // slot because that would orphan the encounter UI; instead the
        // player becomes a 0-score chain-ender until the run ends.
        mutateRoster(eff.playerId, {
          leftEdgeOverride: "blank",
          rightEdgeOverride: "blank",
          scoreOverride: -1000,
        });
      }
    } else if (eff.kind === "noop") {
      // Intentional no-op; the resultBlurb is the entire effect.
    }

    // Intel writes are routed through here so it's discoverable. Used
    // by Faded Scouting Report (encounter #20) to seed a peek-style
    // pre-series HUD pill; cleared at series end.
    void mlbScoutingIntel;

    set({
      run: {
        ...s.run,
        cash,
        itemBag: bag,
        roster,
        badges,
        defenseShields,
        bangingSchemeWeeksLeft,
        karmaDoubleTriggers,
        rallyFireWeeksLeft,
        suspendedPlayerIds,
        nextGameRosterBoost,
        nextWeekCashBonus,
        mlbScoutingIntel,
      },
    });

    // Flush staged item grants AFTER the main set() so requestAddItem
    // reads the post-dispatcher bag (with any addItemRandom siblings
    // already landed) and so its own set() doesn't clobber the
    // dispatcher's cash / roster / etc. writes above. requestAddItem
    // is responsible for routing duplicate-upgrade vs. fresh-acquire
    // vs. queue-pending-picker, so encounters never silently drop.
    if (pendingRandomGrantPool) {
      // Roll up to 8 candidates; we prefer a non-owned card so the
      // grant feels "new" rather than always upgrading an existing
      // copy. If every roll lands on an owned card the router will
      // upgrade the last candidate's owned copy (still a free win).
      let candidate: string | null = null;
      const liveBag = get().run?.itemBag ?? [];
      for (let attempt = 0; attempt < 8; attempt++) {
        const rolled = rollRandomItemCardId(pendingRandomGrantPool);
        if (!liveBag.some((it) => it.cardId === rolled)) {
          candidate = rolled;
          break;
        }
        if (attempt === 7) candidate = rolled;
      }
      if (candidate) get().requestAddItem(candidate, "event");
    }
    if (pendingGrantCardId) {
      get().requestAddItem(pendingGrantCardId, "event");
    }
    // Note: we do NOT call commitEncounter here -- the EventEncounterView
    // shows the resolution result first and commits via its Continue
    // button. Callers that don't have a result phase (merchant / player
    // market) should call commitEncounter themselves after the user
    // dismisses the view.
  },

  advanceDay: () => {
    const s = get();
    if (!s.run) return;
    if (s.run.day === "series") return;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(s.run.day as DayOfWeek);
    if (dayIdx < 0) return;
    if (dayIdx < FRONT_OFFICE_DAYS.length - 1) {
      const nextDay = FRONT_OFFICE_DAYS[dayIdx + 1];
      // Player-ability day-start triggers (e.g. anything tagged
      // `onDayStart` in `sznPlayerAbilities.ts`). Currently no player
      // declares one, but the entry point is wired so future content
      // (Spencer Jones' "Debut Bomb" alternates etc.) drops in without
      // a code change.
      const dayStart = applyDayStartAbilities(s.run.roster, nextDay);
      set({
        run: {
          ...s.run,
          day: nextDay,
          nextWeekCashBonus: s.run.nextWeekCashBonus + dayStart.nextWeekCashBonus,
        },
      });
      return;
    }
    // Last day -> head into the weekend series. Ghost was seeded Monday
    // morning so the scouting report and the at-bats reference the same
    // opponent snapshot.
    set({
      run: {
        ...s.run,
        day: "series",
        series: {
          gameIndex: 0,
          userGameWins: 0,
          ghostGameWins: 0,
          gameInProgress: false,
        },
        ghost: s.run.ghost ?? buildGhostSnapshot(s.run),
      },
    });
  },

  startSeries: () => {
    const s = get();
    if (!s.run || s.run.day !== "series") return;
    if (!s.run.series || !s.run.ghost) return;
    // Resolve any suspension sentinels (`suspend:Batting` /
    // `suspend:Pitching`) into concrete player ids before the first
    // at-bat is seated. We pick the highest-baseValue player on each
    // role from the user's roster, so the encounter copy ("top scorer
    // suspended") lands. The resolved id replaces the sentinel so the
    // HUD / future filters reference a real player rather than a tag.
    const resolvedSuspended = resolveSuspensionSentinels(
      s.run.suspendedPlayerIds ?? [],
      s.run.roster,
    );
    const persistRun =
      resolvedSuspended === s.run.suspendedPlayerIds
        ? s.run
        : { ...s.run, suspendedPlayerIds: resolvedSuspended };
    // Filter pools through the resolved suspension set (the gameStore
    // setter further down also persists the resolved list back to the
    // run so subsequent at-bats see the same suspensions).
    const suspended = new Set(resolvedSuspended);
    const filterSuspended = <T extends { id: string }>(pool: T[]): T[] => {
      if (suspended.size === 0) return pool;
      const next = pool.filter((p) => !suspended.has(p.id));
      return next.length > 0 ? next : pool;
    };
    const userBatters = filterSuspended(
      s.run.roster.filter((r) => r.player.role === "Batter").map((r) => asMlbPlayerCompat(r.player)),
    );
    const userPitchers = filterSuspended(
      s.run.roster.filter((r) => r.player.role === "Pitcher").map((r) => asMlbPlayerCompat(r.player)),
    );
    const ghostBatters = s.run.ghost.roster.filter((r) => r.player.role === "Batter").map((r) => asMlbPlayerCompat(r.player));
    const ghostPitchers = s.run.ghost.roster.filter((r) => r.player.role === "Pitcher").map((r) => asMlbPlayerCompat(r.player));
    // The user is AWAY by default in SZN mode (bats top of the 1st).
    const battersPool = s.userTeam === "AWAY" ? userBatters : ghostBatters;
    const pitchersPool = s.userTeam === "AWAY" ? ghostPitchers : userPitchers;
    // SZN: the user's seat starts with a hand of [playerCard]; items are
    // dealt at runtime via the persistent SznFooterDecks rail. The
    // opposite seat (ghost) is dealt normally so the AI behaves like
    // any other opponent.
    // `userIsAway` -> the user's team identity is AWAY, which means
    // they bat in the top of the 1st (the first half of every series
    // opener). This is a stable per-run trait, not a per-half flip.
    const userIsAway = s.userTeam === "AWAY";
    const ab = freshAtBat({
      battersPool,
      pitchersPool,
      sznMode: true,
      sznUserSide: userIsAway ? "Batting" : "Pitching",
      sznUserRoster: s.run.roster,
      sznGhostRoster: s.run.ghost.roster,
      sznGhostBag: s.run.ghost.itemBag,
      // Series Game 1 always starts 0-0 in the top of the 1st, so the
      // ghost trigger heuristic sees the standard "no comeback needed"
      // baseline. Mid-series games re-seed via startNextAtBat with the
      // live score.
      sznGhostContext: { inning: 1, ghostScore: 0, userScore: 0 },
      sznUserNextGameBoost: persistRun.nextGameRosterBoost ?? 0,
    });
    set({
      phase: "selecting",
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
      revealScript: [],
      pendingResolvedPhase: null,
      revealUiUserSide: null,
      // SZN series uses 3-inning games.
      totalInnings: 3,
      run: {
        ...persistRun,
        series: { ...persistRun.series!, gameInProgress: true },
        // The "Last series: 2-1" FO chip is scoped to the gap between
        // series. Clearing it on series start keeps the HUD honest --
        // the chip should never co-exist with an in-progress series.
        lastSeriesScoreline: null,
      },
    });
  },

  reportSeriesGameResult: (result, userScore, ghostScore) => {
    const s = get();
    if (!s.run || !s.run.series) return;
    // Safety guard: only the game-over reducer should advance a series.
    // Without this, devtools / future callers could double-advance the
    // series mid-game (e.g. game-2 onClick firing while game-1 is still
    // wrapping up its reveal).
    if (s.phase !== "game-over") return;
    if (!s.run.series.gameInProgress) return;
    const ser = s.run.series;
    const userGameWins = ser.userGameWins + (result === "user" ? 1 : 0);
    const ghostGameWins = ser.ghostGameWins + (result === "ghost" ? 1 : 0);
    const userRunsTotal = (ser.userRunsTotal ?? 0) + Math.max(0, userScore);
    const ghostRunsTotal = (ser.ghostRunsTotal ?? 0) + Math.max(0, ghostScore);
    // The weekend is now a single Game of the Week (not a best-of-3),
    // so any completed game ends the "series" and rolls the week.
    // The legacy "advance to game 2 / game 3" branch was removed —
    // there is no next game inside the same weekend.
    // Series over: decide the winner. Game-wins are the primary axis;
    // when wins are equal (a series like W/D/L for both sides) the
    // tiebreaker is aggregate run differential.
    let userWonSeries: boolean;
    if (userGameWins !== ghostGameWins) {
      userWonSeries = userGameWins > ghostGameWins;
    } else {
      // Tiebreaker: aggregate runs across the series. If runs are also
      // equal, the user takes the series (mirrors the legacy "ties go
      // to the home/user side" convention so the run never gets stuck).
      userWonSeries = userRunsTotal >= ghostRunsTotal;
    }
    const wins = s.run.wins + (userWonSeries ? 1 : 0);
    const losses = s.run.losses + (userWonSeries ? 0 : 1);
    let endState: RunState["endState"] = null;
    if (wins >= RUN_WIN_TARGET) endState = "champion";
    else if (losses >= RUN_LOSS_LIMIT) endState = "fired";

    // ------------------------------------------------------------------
    // Capture the end-of-series snapshot BEFORE we mutate buff timers /
    // cash so the SeriesResultScreen can render "Rally Fire 2w → 1w"
    // without re-deriving from post-rollover state. Shared by both the
    // end-run path and the normal week-rollover path below.
    // ------------------------------------------------------------------
    const cashBefore = s.run.cash;
    const triggerBonus = s.run.nextWeekCashBonus;

    // ------------------------------------------------------------------
    // Streak-aware payout breakdown (replaces the legacy flat
    // WEEKLY_CASH). Fed to the SeriesResultScreen + the rollover cash
    // delta below. We compute the NEW streak first so the streak
    // bonus reflects the win we just had (e.g. second consecutive win
    // pays +$2 streak, third pays +$4, capped at STREAK_BONUS_CAP).
    // ------------------------------------------------------------------
    const oldWinStreak = s.run.seriesWinStreak ?? 0;
    const oldLossStreak = s.run.seriesLossStreak ?? 0;
    const newWinStreak = userWonSeries ? oldWinStreak + 1 : 0;
    const newLossStreak = userWonSeries ? 0 : oldLossStreak + 1;
    const payoutBase = SERIES_BASE_PAYOUT;
    const payoutWinBonus = userWonSeries ? SERIES_WIN_BONUS : 0;
    // +$2 per consecutive win STARTING with the second win. A solo
    // win pays $0 streak; W2 = $2, W3 = $4, ... capped at the cap.
    const payoutStreakBonus =
      userWonSeries && newWinStreak >= 2
        ? Math.min(STREAK_BONUS_CAP, STREAK_BONUS_STEP * (newWinStreak - 1))
        : 0;
    // Comeback bonus: a win that breaks a 2+ loss skid pays a one-time
    // recovery spike so the bounce-back week feels rewarding instead
    // of "back to baseline".
    const payoutComebackBonus =
      userWonSeries && oldLossStreak >= COMEBACK_LOSS_THRESHOLD
        ? COMEBACK_BONUS
        : 0;
    const weeklyRefill =
      payoutBase + payoutWinBonus + payoutStreakBonus + payoutComebackBonus;
    const cashAfterIfRollover = cashBefore + weeklyRefill + triggerBonus;
    const summary: SeriesSummary = {
      userWonSeries,
      userGameWins,
      ghostGameWins,
      userRunsTotal,
      ghostRunsTotal,
      weekJustPlayed: s.run.week,
      newWins: wins,
      newLosses: losses,
      endState,
      cashBefore,
      cashAfter: endState ? cashBefore : cashAfterIfRollover,
      weeklyRefill: endState ? 0 : weeklyRefill,
      payoutBase: endState ? 0 : payoutBase,
      payoutWinBonus: endState ? 0 : payoutWinBonus,
      payoutStreakBonus: endState ? 0 : payoutStreakBonus,
      payoutComebackBonus: endState ? 0 : payoutComebackBonus,
      newWinStreak,
      newLossStreak,
      triggerBonus: endState ? 0 : triggerBonus,
      ghostLabel: s.run.ghost?.label ?? null,
      bangingSchemeBefore: s.run.bangingSchemeWeeksLeft,
      bangingSchemeAfter: endState ? s.run.bangingSchemeWeeksLeft : Math.max(0, s.run.bangingSchemeWeeksLeft - 1),
      rallyFireBefore: s.run.rallyFireWeeksLeft,
      rallyFireAfter: endState ? s.run.rallyFireWeeksLeft : Math.max(0, s.run.rallyFireWeeksLeft - 1),
      nextGameBoostExpired: s.run.nextGameRosterBoost > 0,
      scoutingIntelExpired: s.run.mlbScoutingIntel !== null,
      suspensionsExpired: s.run.suspendedPlayerIds.length,
      karmaActive: s.run.karmaDoubleTriggers,
      defenseShieldsActive: s.run.defenseShields,
    };
    const scoreline: SeriesScoreline = {
      userWon: userWonSeries,
      userGameWins,
      ghostGameWins,
      weekJustPlayed: s.run.week,
    };

    if (endState) {
      set({
        // Phase reset so the SeriesResultScreen and EndRunScreen aren't
        // racing the lingering `game-over` mode (the lock-in overlay
        // would otherwise re-render on top of either screen).
        phase: "selecting",
        // Series day is meaningless post-run; flip back to Monday so
        // any "is it a Front Office day" check renders clean (also
        // matches the rollover path's `day: "mon"`).
        run: {
          ...s.run,
          wins,
          losses,
          endState,
          day: "mon",
          series: null,
          ghost: null,
          weeklyScout: null,
          weekScoutingAcknowledged: false,
          // Streak counters persist into the post-run snapshot so the
          // SeriesResultScreen can still render the closing W/L streak
          // line even though no further series will fire.
          seriesWinStreak: newWinStreak,
          seriesLossStreak: newLossStreak,
          lastSeriesSummary: summary,
          lastSeriesScoreline: scoreline,
        },
      });
      return;
    }
    // Roll over to next week. Encounters generated for that week use
    // the new week's pricing tier so the user feels the curve every
    // Monday morning.
    const nextWeek = Math.min(12, s.run.week + 1);
    const pickBudgets = rollWeekPickBudgets();
    // Fresh dedupe window: every Monday the encounter table reopens in
    // full. Cumulative seenSet across Mon→Thu enforces the
    // "no encounter twice in a week" rule on the initial roll exactly
    // the same way startSznRun + commitEncounter do.
    const nextSeenThisWeek = new Set<string>();
    // Carry the cross-week ring forward (it is NOT cleared at week
    // rollover -- that's the entire point of having it). The new
    // week's rolls filter against the union of this ring and the
    // freshly-empty week-level set.
    const carryRing = new Set<string>(s.run.recentEncounterRing ?? []);
    const nextEncounters = FRONT_OFFICE_DAYS.map((day, i) => {
      const offers = rollDailyOffers(
        s.run!.roster,
        nextWeek,
        pickBudgets[i],
        nextSeenThisWeek,
        carryRing,
      );
      for (const o of offers) nextSeenThisWeek.add(encounterOfferId(o));
      return {
        day,
        offers,
        picksUsed: 0,
        pickBudget: pickBudgets[i],
      };
    });
    // Append the new week's initial slate into the ring so a future
    // re-roll inside this week can already see them as "recent".
    const nextRecentRing = pushEncounterRing(
      s.run.recentEncounterRing,
      Array.from(nextSeenThisWeek),
    );
    const interimForGhost: RunState = {
      ...s.run,
      wins,
      losses,
      week: nextWeek,
      day: "mon",
      series: null,
      weekEncounters: nextEncounters,
      seenEncountersThisWeek: Array.from(nextSeenThisWeek),
      recentEncounterRing: nextRecentRing,
    };
    const nextGhost = buildGhostSnapshot(interimForGhost);
    // Scouting report is rolled from the run snapshot AFTER the new
    // week's encounters are seeded above (see the override on
    // `weekEncounters` in `interimForGhost`) so the ability + player
    // hint generators can foreshadow actual upcoming offers.
    const nextScouting = rollWeeklyScout(interimForGhost);
    // Player-ability week-start triggers fire as the new week opens.
    // DJ LeMahieu's "Le Machine" and Caleb Durbin's "Spring Training"
    // queue +$1 each into next-week cash. Routed straight into
    // `nextWeekCashBonus` so the buff appears in the WEEK-after-next
    // refill banner. Mirrors `advanceDay`'s onDayStart accumulator.
    const weekStart = applyWeekStartAbilities(s.run.roster);
    set({
      // Phase reset matches the end-run branch above -- the lock-in
      // overlay sticks around in `game-over` mode and would otherwise
      // paint over the SeriesResultScreen / Monday FO.
      phase: "selecting",
      run: {
        ...s.run,
        wins,
        losses,
        week: nextWeek,
        day: "mon",
        // Drain queued badge-trigger cash (Bronx Bombers etc.) into the
        // weekly cash refill. Cleared so it can re-accumulate next week.
        cash: cashAfterIfRollover,
        nextWeekCashBonus: weekStart.nextWeekCashBonus,
        weekEncounters: nextEncounters,
        // Reset the cumulative encounter dedupe set the moment the new
        // week's encounters are stamped on -- each week reopens the
        // full encounter table, then `commitEncounter` re-rolls
        // accrete back into this list across Mon→Thu.
        seenEncountersThisWeek: Array.from(nextSeenThisWeek),
        // Cross-week ring persists across the rollover (that's the
        // whole reason it exists).
        recentEncounterRing: nextRecentRing,
        series: null,
        ghost: nextGhost,
        weeklyScout: nextScouting,
        weekScoutingAcknowledged: false,
        // Encounter timers decrement at series rollover. Hold-the-line
        // / Rally Fire / Banging Scheme are all bought to last "the
        // next N games"; the rollover is the natural tick.
        bangingSchemeWeeksLeft: Math.max(0, s.run.bangingSchemeWeeksLeft - 1),
        rallyFireWeeksLeft: Math.max(0, s.run.rallyFireWeeksLeft - 1),
        // One-game flat boost and ad-hoc scouting intel are scoped to
        // the just-finished series; drain both so the next week starts
        // clean.
        nextGameRosterBoost: 0,
        mlbScoutingIntel: null,
        // Suspensions expire after the next series. Sentinel ids
        // ("suspend:Batting" / "suspend:Pitching") never resolved into
        // a real player are cleared too.
        suspendedPlayerIds: [],
        // Streak counters mutate at series-end, before the next
        // weekend's payout reads them.
        seriesWinStreak: newWinStreak,
        seriesLossStreak: newLossStreak,
        lastSeriesSummary: summary,
        lastSeriesScoreline: scoreline,
      },
      // Reset gameplay surface so the empty-field Front Office screen
      // doesn't show stale runners / scores from the just-finished series.
      totalInnings: 9,
      inning: 1,
      half: "top",
      outs: 0,
      isFirstAtBatOfInning: true,
      homeScore: 0,
      awayScore: 0,
      bases: [false, false, false],
      baseRunners: [null, null, null],
      lastOutcome: null,
      runnerMoves: [],
      lastResolveLog: [],
    });
  },

  endRun: (reason) => {
    const s = get();
    if (!s.run) return;
    set({
      run: {
        ...s.run,
        endState: reason === "manual" ? "fired" : reason,
      },
    });
  },

  dismissSeriesSummary: () => {
    const s = get();
    if (!s.run || !s.run.lastSeriesSummary) return;
    set({
      run: { ...s.run, lastSeriesSummary: null },
    });
  },

  exitSznToMenu: () => {
    // Wipe combat surface AND lane identity so the next lane the user
    // picks starts from a clean slate (no leftover SZN totalInnings: 3,
    // no stale footer height, no half-finished at-bat carried into
    // QuickMatch via the StartGameScreen).
    set({
      ...resetEphemeralGameplay(),
      run: null,
      gameMode: null,
      showStartScreen: true,
    });
  },

  sellPlayerForCash: (playerId) => {
    const s = get();
    if (!s.run) return 0;
    const idx = indexOfRosterPlayer(s.run.roster, playerId);
    if (idx < 0) return 0;
    const target = s.run.roster[idx];
    // Don't let the user empty the bench / mound. They need at least 1
    // batter and 1 pitcher to stage a series.
    const role = target.player.role;
    const sameRoleCount = s.run.roster.filter((r) => r.player.role === role).length;
    if (sameRoleCount <= 1) return 0;
    // Sell value scales with rarity (common 3 / allstar 6 / veteran 10 / legend 15).
    const rarityValue: Record<Rarity, number> = { common: 3, allstar: 6, veteran: 10, legend: 15 };
    const refund = rarityValue[target.rarity];
    const roster = s.run.roster.filter((_, i) => i !== idx);
    set({
      run: { ...s.run, roster, cash: s.run.cash + refund },
    });
    return refund;
  },

  sznDealItem: (instanceId) => {
    const s = get();
    // Hand mutations only fire in actual weekend combat (not pack rip /
    // Front Office / series intro). `phase === 'selecting'` alone is too
    // loose because `startSznRun` parks the placeholder at-bat in
    // `selecting` from pack-rip onwards.
    if (!isInSznCombat(s)) return;
    const item = s.run!.itemBag.find((i) => i.instanceId === instanceId);
    if (!item) return;
    const card = SESSION_CARDS.find((c) => c.id === item.cardId);
    if (!card) return;
    const userSide = getUserSide(s);
    const hand = userSide === "Batting" ? s.batterHand : s.pitcherHand;
    // Prevent the same card from being added twice. The chain engine
    // keys cards by id, so duplicates would step on each other's modifiers.
    if (hand.some((c) => c.id === card.id)) return;
    // Hand cap = 6 cards including the player anchor; matches the legacy
    // 5-item cap once you account for the `player:` slot the SZN seat
    // always occupies.
    if (hand.length >= 6) return;
    // Stamp the dealt instanceId onto the card so the bag filter in
    // SznFooterDecks can distinguish duplicate copies (without this, both
    // bag rows hide when one copy is dealt — second copy is unusable).
    // Also stamp the source bag's tier so the scoring engine + per-card
    // SZN item hooks can scale this item's contribution at scoring
    // time (bronze = 1.0x, silver = 1.5x, gold = 2.0x).
    const dealt: CardDefinition = {
      ...card,
      sznInstanceId: instanceId,
      sznItemTier: item.tier ?? "bronze",
    };
    const nextHand = [...hand, dealt];
    const handKey = userSide === "Batting" ? "batterHand" : "pitcherHand";

    // Deal does NOT auto-affirm any seams. The user's intent is the only
    // signal we accept for chain formation — they must drag the dealt
    // card into place (or drag a neighbor onto it) to confirm the
    // connection, exactly like Quick Play's drop-to-snap. The dealt
    // card simply lands at the end of the hand; existing affirmed seams
    // between cards that didn't move are left alone (no fresh adjacency
    // was introduced between two previously-adjacent cards, so the
    // existing seam set is still valid as-is).
    set({ [handKey]: nextHand } as Pick<GameState, "batterHand" | "pitcherHand">);
    // Re-derive choice / reveal / impact state so cards added mid-at-bat
    // actually fire (b-65 guess, b-12, p-56, b-7, b-121, p-51, p-59).
    set(reconcileSznHandState(get(), { card: dealt, side: userSide }));
  },

  sznRecallItem: (cardId) => {
    const s = get();
    if (!isInSznCombat(s)) return;
    // Don't let the user remove their own player card -- that would empty
    // the hand seat and break the at-bat seed.
    if (cardId.startsWith("player:")) return;
    const userSide = getUserSide(s);
    const handKey = userSide === "Batting" ? "batterHand" : "pitcherHand";
    const hand = userSide === "Batting" ? s.batterHand : s.pitcherHand;
    const next = hand.filter((c) => c.id !== cardId);
    if (next.length === hand.length) return;
    // Drop any affirmed seam that referenced the recalled card. Mirrors
    // the affirmDraggedCard convention: a seam survives only if BOTH
    // endpoints are still adjacent AND still mechanically connectable.
    // We deliberately do NOT auto-affirm the newly-adjacent pair that
    // sits where the recalled card used to be — fresh adjacency is a
    // fresh decision the user has to make (drag or re-deal to confirm).
    const nextAffirmed = new Set<string>();
    for (let i = 1; i < next.length; i++) {
      const a = next[i - 1];
      const b = next[i];
      const key = seamKey(a.id, b.id);
      if (s.affirmedSeams.has(key) && canConnectAny(a, b)) {
        nextAffirmed.add(key);
      }
    }
    set({ [handKey]: next } as Pick<GameState, "batterHand" | "pitcherHand">);
    set({ affirmedSeams: nextAffirmed });
    // Recalled cards leave any open modal stranded; reconcile clears it.
    // We don't try to undo the recalled card's hand transforms — undoing
    // arbitrary transforms is intractable, and the player accepted that
    // when they recalled. The dropped derived choices / reveals reflect
    // the current hand.
    set(reconcileSznHandState(get()));
  },

  sznSwapPlayer: (playerId) => {
    const s = get();
    if (!isInSznCombat(s)) return false;
    const userSide = getUserSide(s);
    // Roster lookup: must be on the user's run roster AND match the
    // user's current seat (Batter for Batting, Pitcher for Pitching).
    const slot = s.run!.roster.find((r) => r.player.id === playerId);
    if (!slot) return false;
    const desiredRole = userSide === "Batting" ? "Batter" : "Pitcher";
    if (slot.player.role !== desiredRole) return false;
    // No-op when the user picks the player already at the plate/mound.
    const current = userSide === "Batting" ? s.batter : s.pitcher;
    if (current && current.id === playerId) return false;

    const rarityBase =
      RARITY_BASE_VALUE[slot.rarity] +
      (slot.permanentBoost ?? 0) +
      (slot.scoreOverride ?? 0);
    const anchor = {
      ...playerAsCard(slot.player, {
        leftEdgeOverride: slot.leftEdgeOverride,
        rightEdgeOverride: slot.rightEdgeOverride,
      }),
      baseValue: rarityBase,
    };
    const compatPlayer = asMlbPlayerCompat(slot.player);
    // Player swap does NOT auto-affirm the new anchor's seam to the
    // first item. We only preserve item-to-item seams that survive the
    // swap (the previous anchor was at index 0, so item-item seams
    // were between cards that aren't being touched). The user must drag
    // the new anchor (or the adjacent item) to confirm any anchor->item
    // chain, mirroring Quick Play's drag-only affirmation contract.
    const buildSwappedAffirmed = (
      prevHand: CardDefinition[],
    ): Set<string> => {
      const next = new Set<string>();
      for (let i = 1; i < prevHand.length; i++) {
        const a = prevHand[i - 1];
        const b = prevHand[i];
        if (a.id.startsWith("player:") || b.id.startsWith("player:")) continue;
        const key = seamKey(a.id, b.id);
        if (s.affirmedSeams.has(key) && canConnectAny(a, b)) {
          next.add(key);
        }
      }
      return next;
    };
    if (userSide === "Batting") {
      // Preserve dealt items: keep everything in the hand that isn't the
      // outgoing `player:` anchor card.
      const items = s.batterHand.filter((c) => !c.id.startsWith("player:"));
      const nextHand = [anchor, ...items];
      set({
        batter: compatPlayer,
        batterHand: nextHand,
        affirmedSeams: buildSwappedAffirmed(s.batterHand),
      });
    } else {
      const items = s.pitcherHand.filter((c) => !c.id.startsWith("player:"));
      const nextHand = [anchor, ...items];
      set({
        pitcher: compatPlayer,
        pitcherHand: nextHand,
        affirmedSeams: buildSwappedAffirmed(s.pitcherHand),
      });
    }
    // Swapped-in player cards have no HAND_TRANSFORMS but their presence
    // can re-derive pendingChoices/reveals against the items still in
    // the hand.
    set(reconcileSznHandState(get()));
    return true;
  },

  releaseRosterPlayer: (playerId) => {
    const s = get();
    if (!s.run) return false;
    const idx = indexOfRosterPlayer(s.run.roster, playerId);
    if (idx < 0) return false;
    // Never drop below 1-of-role so the next series can always seed
    // both a batter at the plate and a pitcher on the mound.
    const role = s.run.roster[idx].player.role;
    const sameRoleCount = s.run.roster.filter((r) => r.player.role === role).length;
    if (sameRoleCount <= 1) return false;
    const roster = s.run.roster.filter((_, i) => i !== idx);
    set({ run: { ...s.run, roster } });
    return true;
  },

  sznSwapRoster: (idA, idB) => {
    const s = get();
    if (!s.run) return false;
    // FO gating: the combat code reads role / suspension filters
    // off this same array, so reshuffling mid at-bat would race the
    // pool builder and could re-order an already-dealt anchor card.
    if (!isInSznFrontOffice(s)) return false;
    if (idA === idB) return false;
    const roster = s.run.roster;
    const ia = roster.findIndex((rp) => rp.player.id === idA);
    const ib = roster.findIndex((rp) => rp.player.id === idB);
    if (ia < 0 || ib < 0) return false;
    const next = roster.slice();
    [next[ia], next[ib]] = [next[ib], next[ia]];
    set({ run: { ...s.run, roster: next } });
    return true;
  },

  sznSwapItemBag: (idA, idB) => {
    const s = get();
    if (!s.run) return false;
    if (!isInSznFrontOffice(s)) return false;
    if (idA === idB) return false;
    const bag = s.run.itemBag;
    const ia = bag.findIndex((it) => it.instanceId === idA);
    const ib = bag.findIndex((it) => it.instanceId === idB);
    if (ia < 0 || ib < 0) return false;
    const next = bag.slice();
    [next[ia], next[ib]] = [next[ib], next[ia]];
    set({ run: { ...s.run, itemBag: next } });
    return true;
  },

  setSznFooterHeight: (h) => {
    // Round to the nearest pixel and short-circuit no-op writes so
    // ResizeObserver microbursts don't trigger pointless re-renders on
    // every CardGameOverlay subscriber.
    const next = Math.max(0, Math.round(h));
    if (get().sznFooterHeight === next) return;
    set({ sznFooterHeight: next });
  },

  setSznGamepadFocus: (focus) => {
    // No-op writes are extremely common here (every DPAD_LEFT/RIGHT
    // press calls into the router which then re-applies the same
    // 'footer' value), so guard the set call to avoid waking every
    // subscriber on no-change.
    if (get().sznGamepadFocus === focus) return;
    set({ sznGamepadFocus: focus });
  },

  setEncounterFocusEdges: (edges) => {
    // Guard against churn -- the encounter views drive this from a
    // `useEffect` against a recomputed object on every render, so
    // we compare by shape (both nulls; same {leftEdge, rightEdge}
    // pair) instead of by reference. Without the guard every
    // encounter-view render would wake every footer Card subscriber.
    const prev = get().encounterFocusEdges;
    if (prev == null && edges == null) return;
    if (
      prev != null &&
      edges != null &&
      prev.leftEdge === edges.leftEdge &&
      prev.rightEdge === edges.rightEdge
    ) {
      return;
    }
    set({ encounterFocusEdges: edges });
  },

  startPurchaseFlight: (flight) => {
    set({ purchaseFlight: flight });
  },

  endPurchaseFlight: () => {
    if (get().purchaseFlight == null) return;
    set({ purchaseFlight: null });
  },

  setQuickResolveEnabled: (enabled) => {
    if (get().quickResolveEnabled === enabled) return;
    set({ quickResolveEnabled: enabled });
  },

  requestResolveInning: () => {
    const s = get();
    // Only valid inside an active SZN at-bat; otherwise the inning
    // counter is uninitialized / stale and we'd arm a one-shot for
    // the wrong inning. Silent no-op so the UI can fire-and-forget.
    if (!isInSznCombat(s)) return;
    set({ resolveInningTarget: s.inning });
  },

  devFastForwardWeek: (outcome = "win") => {
    const s = get();
    if (!s.run) return;
    if (s.run.endState !== null) return;
    if (s.run.day === "series") return; // mid-series; bail to keep state honest
    // Bump week and series-result counters. Wins / losses move so a
    // multi-week stress test still graduates the run on schedule.
    const nextWeek = Math.min(12, s.run.week + 1);
    const userWonSeries = outcome === "win";
    const wins = s.run.wins + (userWonSeries ? 1 : 0);
    const losses = s.run.losses + (userWonSeries ? 0 : 1);
    let endState: RunState["endState"] = null;
    if (wins >= RUN_WIN_TARGET) endState = "champion";
    else if (losses >= RUN_LOSS_LIMIT) endState = "fired";
    const oldWinStreak = s.run.seriesWinStreak ?? 0;
    const oldLossStreak = s.run.seriesLossStreak ?? 0;
    const newWinStreak = userWonSeries ? oldWinStreak + 1 : 0;
    const newLossStreak = userWonSeries ? 0 : oldLossStreak + 1;
    // Bare-bones cash refill mirroring the live payout formula -- we
    // care about the magnitude (not the exact breakdown chips) for
    // multi-week balance verification.
    const payoutBase = SERIES_BASE_PAYOUT;
    const payoutWinBonus = userWonSeries ? SERIES_WIN_BONUS : 0;
    const payoutStreakBonus =
      userWonSeries && newWinStreak >= 2
        ? Math.min(STREAK_BONUS_CAP, STREAK_BONUS_STEP * (newWinStreak - 1))
        : 0;
    const payoutComebackBonus =
      userWonSeries && oldLossStreak >= COMEBACK_LOSS_THRESHOLD
        ? COMEBACK_BONUS
        : 0;
    const weeklyRefill =
      payoutBase + payoutWinBonus + payoutStreakBonus + payoutComebackBonus;
    const cashAfter = s.run.cash + weeklyRefill + s.run.nextWeekCashBonus;
    if (endState) {
      // Game over: short-circuit to the same end-state shape that the
      // real series-result branch produces, minus the SeriesSummary
      // payload (skipping the cinematic by design -- this is a dev
      // tool, not a customer-facing rollover).
      set({
        run: {
          ...s.run,
          wins,
          losses,
          endState,
          series: null,
          ghost: null,
          weeklyScout: null,
          weekScoutingAcknowledged: false,
          seriesWinStreak: newWinStreak,
          seriesLossStreak: newLossStreak,
          lastSeriesSummary: null,
          lastSeriesScoreline: null,
        },
      });
      return;
    }
    // Roll fresh week encounters honoring the SAME dedupe ring as the
    // real rollover so balance testing exercises the cross-week
    // recently-seen ring.
    const pickBudgets = rollWeekPickBudgets();
    const nextSeenThisWeek = new Set<string>();
    const carryRing = new Set<string>(s.run.recentEncounterRing ?? []);
    const nextEncounters = FRONT_OFFICE_DAYS.map((day, i) => {
      const offers = rollDailyOffers(
        s.run!.roster,
        nextWeek,
        pickBudgets[i],
        nextSeenThisWeek,
        carryRing,
      );
      for (const o of offers) nextSeenThisWeek.add(encounterOfferId(o));
      return { day, offers, picksUsed: 0, pickBudget: pickBudgets[i] };
    });
    const nextRecentRing = pushEncounterRing(
      s.run.recentEncounterRing,
      Array.from(nextSeenThisWeek),
    );
    const interimForGhost: RunState = {
      ...s.run,
      wins,
      losses,
      week: nextWeek,
      day: "mon",
      series: null,
      weekEncounters: nextEncounters,
      seenEncountersThisWeek: Array.from(nextSeenThisWeek),
      recentEncounterRing: nextRecentRing,
    };
    const nextGhost = buildGhostSnapshot(interimForGhost);
    const nextScouting = rollWeeklyScout(interimForGhost);
    set({
      phase: "selecting",
      run: {
        ...s.run,
        wins,
        losses,
        week: nextWeek,
        day: "mon",
        cash: cashAfter,
        nextWeekCashBonus: 0,
        weekEncounters: nextEncounters,
        seenEncountersThisWeek: Array.from(nextSeenThisWeek),
        recentEncounterRing: nextRecentRing,
        series: null,
        ghost: nextGhost,
        weeklyScout: nextScouting,
        weekScoutingAcknowledged: false,
        bangingSchemeWeeksLeft: Math.max(0, s.run.bangingSchemeWeeksLeft - 1),
        rallyFireWeeksLeft: Math.max(0, s.run.rallyFireWeeksLeft - 1),
        nextGameRosterBoost: 0,
        mlbScoutingIntel: null,
        suspendedPlayerIds: [],
        seriesWinStreak: newWinStreak,
        seriesLossStreak: newLossStreak,
        // Skip the cinematic so the dev cycle is fire-and-forget.
        lastSeriesSummary: null,
        lastSeriesScoreline: null,
      },
    });
  },

  buyPlayerFromMarket: (slotIndex, listingIndex) => {
    const s = get();
    if (!s.run || s.run.day === "series") return false;
    const dayKey = s.run.day as DayOfWeek;
    const dayIdx = FRONT_OFFICE_DAYS.indexOf(dayKey);
    if (dayIdx < 0) return false;
    const day = s.run.weekEncounters[dayIdx];
    const offer = day?.offers[slotIndex];
    if (!offer || offer.kind !== "playerMarket") return false;
    const listing = offer.listings[listingIndex];
    if (!listing) return false;
    if (s.run.cash < listing.price) return false;
    // Refuse duplicate id (the user already owns this player; they should
    // use Scouting Director to upgrade rarities instead).
    if (s.run.roster.some((r) => r.player.id === listing.playerId)) return false;
    // Refuse a second sign while ANOTHER pending grant is still
    // unresolved -- the user has to clear the existing release
    // picker before queueing a new one. Defensive: the modal blocks
    // the encounter view above it, so this should be unreachable in
    // practice, but guards against future surfaces that might call
    // buy without the picker mounted.
    if (s.run.pendingPlayerGrant) return false;
    // SZN players are the primary signing catalog (the market rolls
    // from `ALL_SZN_PLAYERS` -- see `freeAgencyOffer` in items.ts);
    // legacy `MlbPlayer` is the safety fallback for degenerate save
    // states. Either path produces a valid `RosterPlayer` -- the
    // discriminated union lets combat treat both shapes identically
    // via `isSznPlayer` at every snap site.
    const player =
      getSznPlayer(listing.playerId) ??
      PLAYERS.find((p) => p.id === listing.playerId);
    if (!player) return false;

    // ----- Roster full -> queue pending grant -----
    // The user pays the listing price NOW (the sign is committed); the
    // persistent SZN footer rail picks up "release" mode so the user
    // picks the cut from the same card row they use for the rest of
    // FO. Cancelling refunds the price in full so a cold-feet
    // pull-out is cost-neutral.
    if (s.run.roster.length >= STARTER_PACK_TOTAL) {
      const pending: PendingPlayerGrant = {
        playerId: listing.playerId,
        rarity: listing.rarity,
        source: "freeAgency",
        refundOnCancel: listing.price,
        label: player.name,
      };
      set({
        run: {
          ...s.run,
          cash: s.run.cash - listing.price,
          pendingPlayerGrant: pending,
        },
      });
      return true;
    }

    // ----- Roster has room -> land immediately -----
    const newSlot: RosterPlayer = { player, rarity: listing.rarity, tag: player.tag };
    set({
      run: {
        ...s.run,
        cash: s.run.cash - listing.price,
        roster: [...s.run.roster, newSlot],
      },
    });
    return true;
  },

  confirmReleaseAndSignPlayer: (releasedPlayerId) => {
    const s = get();
    if (!s.run || !s.run.pendingPlayerGrant) return false;
    const pending = s.run.pendingPlayerGrant;
    // Resolve the queued player from the same catalog the sign action
    // used -- SZN pool first, legacy MlbPlayer fallback for save-state
    // edge cases.
    const player =
      getSznPlayer(pending.playerId) ??
      PLAYERS.find((p) => p.id === pending.playerId);
    if (!player) return false;
    // Refuse to release a player who isn't actually on the roster
    // (stale modal state / racy double-click). Returns false so the
    // picker stays mounted and the user can try again.
    const releaseIdx = s.run.roster.findIndex(
      (r) => r.player.id === releasedPlayerId,
    );
    if (releaseIdx < 0) return false;
    // Refuse the release if it would empty a role (last batter or
    // last pitcher). The user has to pick a different slot so the
    // upcoming series still has a viable lineup. Mirrors the same
    // safety net `releaseRosterPlayer` enforces for encounter-driven
    // culls.
    const releasing = s.run.roster[releaseIdx];
    const sameRoleCount = s.run.roster.filter(
      (r) => r.player.role === releasing.player.role,
    ).length;
    if (sameRoleCount <= 1 && releasing.player.role !== player.role) {
      // Releasing this slot would leave the role at zero AND the
      // incoming player doesn't replenish that role. Defensive: the
      // picker UI should suppress this slot from the grid, but this
      // gate keeps the store honest if a future caller bypasses the
      // UI filter.
      return false;
    }
    const newSlot: RosterPlayer = {
      player,
      rarity: pending.rarity,
      tag: player.tag,
    };
    const nextRoster = s.run.roster.filter(
      (_, i) => i !== releaseIdx,
    );
    nextRoster.push(newSlot);
    set({
      run: {
        ...s.run,
        roster: nextRoster,
        pendingPlayerGrant: null,
      },
    });
    return true;
  },

  cancelPendingPlayerGrant: () => {
    const s = get();
    if (!s.run || !s.run.pendingPlayerGrant) return;
    const refund = s.run.pendingPlayerGrant.refundOnCancel;
    set({
      run: {
        ...s.run,
        cash: s.run.cash + refund,
        pendingPlayerGrant: null,
      },
    });
  },

  equipItem: (itemId, targetCardId) => {
    set((s) => {
      if (!s.inventory.includes(itemId)) return s;
      const current = s.equippedItems[targetCardId] || [];
      return {
        inventory: s.inventory.filter((id) => id !== itemId),
        equippedItems: {
          ...s.equippedItems,
          [targetCardId]: [...current, itemId],
        },
      };
    });
  },

  unEquipItem: (itemId, sourceCardId) => {
    set((s) => {
      const current = s.equippedItems[sourceCardId] || [];
      if (!current.includes(itemId)) return s;

      const newItems = [...current];
      newItems.splice(newItems.indexOf(itemId), 1);

      return {
        inventory: [...s.inventory, itemId],
        equippedItems: {
          ...s.equippedItems,
          [sourceCardId]: newItems,
        },
      };
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
      equippedItems: s.equippedItems,
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
    // SZN Encounter #7 Rally Fire: scoreGroup auras +10% on neighbors
    // of `team-logo` cards while the run flag is hot. Only fires for
    // the user's own seat -- the ghost doesn't carry SZN encounter
    // state, so flagging it would falsely boost the opponent.
    sznRallyFireActive:
      s.gameMode === "szn" &&
      side === getUserSide(s) &&
      (s.run?.rallyFireWeeksLeft ?? 0) > 0,
    sznSpeedMultiplierBonus: sznSpeedMultiplierForSide(s, side),
    sznChainLengthForgiveness: sznChainLengthForgivenessForSide(s, side),
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
      // One beat per best-chain card, stepping the pill by that card's full
      // locked-in value. Previously we only emitted beats when mod.value !==
      // card.baseValue (self-buffs only). Vanilla cards skipped, so the script
      // summed to less than maxValue, computeBaseline recovered the missing
      // chain sum as "baseline", and the score pill never ticked up through
      // the chain -- especially obvious for SZN ghost bags vs item-light user
      // hands. `baseValue: 0` keeps scoreDelta = mod.value while applyBeatStart
      // still pins the card at `finalValue: mod.value`.
      //
      // `animation` is populated only when the card's locked-in value
      // differs from its base value -- vanilla chain-ticks don't get an
      // attack/buff animation because nothing "happened" beyond the card
      // contributing its baseline to the chain.
      const buffDelta = mod.value - card.baseValue;
      const animation: RevealBeatAnimation | undefined =
        buffDelta !== 0
          ? {
              kind: "buff",
              sourceCardId: card.id,
              sourceSide: side,
              magnitude: buffDelta,
              flavor: "value",
            }
          : undefined;
      beats.push({
        kind: "selfModifier",
        cardId: card.id,
        side,
        baseValue: 0,
        finalValue: mod.value,
        animation,
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
      animation: {
        kind: "attack",
        sourceCardId: t.sourceCardId,
        sourceSide: "Batting",
        targetCardId: t.targetCardId,
        targetSide: "Pitching",
        magnitude: t.delta,
      },
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
        animation: {
          kind: "attack",
          sourceCardId: t.sourceCardId,
          sourceSide: "Pitching",
          targetCardId: t.targetCardId,
          targetSide: "Batting",
          magnitude: t.delta,
        },
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
        animation: {
          kind: "attack",
          sourceCardId: source.id,
          sourceSide: "Batting",
          targetSide: "Pitching",
          magnitude: batterAggregateResidual,
        },
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
          animation: {
            kind: "attack",
            sourceCardId: source.id,
            sourceSide: "Pitching",
            targetSide: "Batting",
            magnitude: pitcherAggregateResidual,
          },
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
        animation: {
          kind: "attack",
          sourceCardId: source.id,
          sourceSide: "Batting",
          targetSide: "Pitching",
          magnitude: combinedResidual,
        },
      });
    }
  }

  // (4) b-65 Guess Pitch +4 if the pitcher actually used the named shape.
  // computeGuessPitchBonus already guarantees b-65 is in the batter hand
  // when this returns non-zero, so attaching its id is safe.
  const guessBonus = computeGuessPitchBonus(s);
  if (guessBonus !== 0) {
    beats.push({
      kind: "guessPitchHit",
      sourceCardId: "b-65",
      delta: guessBonus,
      animation: {
        kind: "buff",
        sourceCardId: "b-65",
        sourceSide: "Batting",
        magnitude: guessBonus,
        flavor: "value",
      },
    });
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
      animation: {
        kind: "flash",
        affectedSide: "Batting",
        magnitude: batterPendingDelta,
        tone: batterPendingDelta < 0 ? "debuff" : "buff",
      },
    });
  }
  const pitcherPendingDelta = sumPendingDebuffs(s.pendingDebuffs, "Pitching");
  if (pitcherPendingDelta !== 0) {
    beats.push({
      kind: "crossDebuff",
      affectedSide: "Pitching",
      delta: pitcherPendingDelta,
      label: "Carryover",
      animation: {
        kind: "flash",
        affectedSide: "Pitching",
        magnitude: pitcherPendingDelta,
        tone: pitcherPendingDelta < 0 ? "debuff" : "buff",
      },
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
      equippedItems: s.equippedItems,
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

/**
 * SZN Mode: team tag-synergy bonuses (adjacent identical tags on the roster,
 * see `synergies.ts`) stacked on the matchup total. Tier base value for the
 * player-at-the-plate lives on the player-as-card `baseValue` (seeded in
 * `freshAtBat`) so chain math, pills, and per-card readouts stay aligned.
 *
 * Reads from whichever roster owns the seat: the user's `run.roster` when
 * the user is in that seat this half, the `run.ghost.roster` when the
 * ghost is. Without the ghost branch, ghost-side roster synergies never
 * applied — the audit flagged that as "asymmetric power level".
 */
function sznSideBonus(s: GameState, side: "Batting" | "Pitching"): number {
  if (s.gameMode !== "szn" || !s.run) return 0;
  const userSide = getUserSide(s);
  const roster =
    userSide === side
      ? s.run.roster
      : s.run.ghost?.roster ?? null;
  if (!roster) return 0;
  return side === "Batting"
    ? teamBatterBonus(roster)
    : teamPitcherBonus(roster);
}

/**
 * SZN passive-badge score bonuses applied per-side off the snap events
 * that happened inside this hand's best chain. Today this is just the
 * Yankees Bronx Bombers +10 per Power snap, but the dispatcher reads
 * every active badge from `run.badges` so future team passives can
 * tagline against any `SznEdgeId` without further wiring.
 *
 * Only the user's own badges fire (the ghost is a procedurally-rolled
 * opponent; not modeled as carrying badges).
 */
function sznBadgeScoreBonus(
  s: GameState,
  side: "Batting" | "Pitching",
  result: ScoringResult,
): number {
  if (s.gameMode !== "szn" || !s.run) return 0;
  const userSide = getUserSide(s);
  // Only the user's badges fire; ghost rolls don't carry passive badges.
  if (userSide !== side) return 0;
  const events = result.sznSnapEvents ?? [];
  if (events.length === 0) return 0;
  // Encounter #10 Karma: doubles every passive-badge score deposit on
  // qualifying snaps. Reads the live run flag so the multiplier reacts
  // immediately the at-bat after Karma is purchased.
  const karmaMul = s.run.karmaDoubleTriggers ? 2 : 1;
  let bonus = 0;
  for (const badgeId of s.run.badges) {
    const def = BADGES[badgeId];
    if (!def || !isSnapTrigger(def.trigger)) continue;
    for (const ev of events) {
      if (ev.wildcard) continue; // wildcard snaps don't count as the named edge
      if (ev.edge !== def.trigger.edge) continue;
      bonus += def.trigger.scoreBonus * karmaMul;
    }
  }
  return bonus;
}

/**
 * Mirror of {@link sznBadgeScoreBonus} for the Hit-Scale axis -- some
 * team-passive badges (e.g. north-of-the-border) trigger off Contact
 * snaps and ladder the Hit Scale instead of the raw matchup score.
 * Only the user's badges fire; the ghost side returns 0.
 */
function sznBadgeHitScaleBonus(
  s: GameState,
  side: "Batting" | "Pitching",
  result: ScoringResult,
): number {
  if (s.gameMode !== "szn" || !s.run) return 0;
  const userSide = getUserSide(s);
  if (userSide !== side) return 0;
  const events = result.sznSnapEvents ?? [];
  if (events.length === 0) return 0;
  const karmaMul = s.run.karmaDoubleTriggers ? 2 : 1;
  let bonus = 0;
  for (const badgeId of s.run.badges) {
    const def = BADGES[badgeId];
    if (!def || !isSnapTrigger(def.trigger)) continue;
    const hsBonus = def.trigger.hitScaleBonus ?? 0;
    if (hsBonus === 0) continue;
    for (const ev of events) {
      if (ev.wildcard) continue;
      if (ev.edge !== def.trigger.edge) continue;
      bonus += hsBonus * karmaMul;
    }
  }
  return bonus;
}

/**
 * Player-ability bundle returned by the side aggregator below. Mirrors
 * the structure {@link computeMatchup} needs to fold into the matchup
 * totals: a flat score bonus, hit-scale bonus, opponent score delta,
 * combined-pitcher delta, and a pitcherWinsTies flag.
 *
 * Only the user's own roster fires; the ghost roster sits idle (same
 * convention as `sznBadgeScoreBonus`).
 */
interface SznPlayerAbilitySideTotals {
  scoreBonus: number;
  hitScaleBonus: number;
  opponentScoreDelta: number;
  pitcherCombinedDelta: number;
  pitcherWinsTies: boolean;
}

const EMPTY_PLAYER_ABILITY_TOTALS: SznPlayerAbilitySideTotals = {
  scoreBonus: 0,
  hitScaleBonus: 0,
  opponentScoreDelta: 0,
  pitcherCombinedDelta: 0,
  pitcherWinsTies: false,
};

/**
 * Resolve the speed multiplier override for one side. Returns the max
 * `speedMultiplier` ability effect declared by the user's at-plate /
 * on-mound player. Falls through to 1.25 (the default) when no roster
 * player on that side has a stronger override. Only the user's side
 * fires; the ghost side returns 1.25.
 */
function sznSpeedMultiplierForSide(
  s: GameState,
  side: "Batting" | "Pitching",
): number {
  const DEFAULT = 1.25;
  if (s.gameMode !== "szn" || !s.run) return DEFAULT;
  const userSide = getUserSide(s);
  if (userSide !== side) return DEFAULT;
  const seatPlayer = side === "Batting" ? s.batter : s.pitcher;
  if (!seatPlayer) return DEFAULT;
  const rp = s.run.roster.find((r) => r.player.id === seatPlayer.id);
  if (!rp || !isSznPlayer(rp.player)) return DEFAULT;
  let best = DEFAULT;
  for (const ab of revealedAbilities(rp.player, rp.rarity)) {
    if (ab.effect.speedMultiplier && ab.effect.speedMultiplier > best) {
      best = ab.effect.speedMultiplier;
    }
  }
  return best;
}

/**
 * Resolve the chain-length forgiveness bonus for one side. Returns the
 * sum of `chainLengthForgiveness` ability effects declared by the user's
 * at-plate / on-mound player's revealed abilities. Drives Aaron Judge's
 * "62" and Max Scherzer's "Future HOF" -- the holder's chain counts as
 * one card longer for `requireChainLength` checks.
 */
function sznChainLengthForgivenessForSide(
  s: GameState,
  side: "Batting" | "Pitching",
): number {
  if (s.gameMode !== "szn" || !s.run) return 0;
  const userSide = getUserSide(s);
  if (userSide !== side) return 0;
  const seatPlayer = side === "Batting" ? s.batter : s.pitcher;
  if (!seatPlayer) return 0;
  const rp = s.run.roster.find((r) => r.player.id === seatPlayer.id);
  if (!rp || !isSznPlayer(rp.player)) return 0;
  let total = 0;
  for (const ab of revealedAbilities(rp.player, rp.rarity)) {
    if (ab.effect.chainLengthForgiveness) total += ab.effect.chainLengthForgiveness;
  }
  return total;
}

/**
 * Aggregate the user-side player-ability bonuses for one side. Walks all
 * three trigger families that contribute to the matchup pill:
 *
 *   - `onSnap` / `onTeammateSnap` -> per snap-event multipliers
 *   - `onLockIn`                  -> one shot per matchup against the at-plate / on-mound player
 *   - `onMatchupReveal`           -> one shot per matchup against the at-plate / on-mound player
 *
 * Returns zero-filled totals for the ghost side, non-SZN games, or empty
 * snap-event sets so the caller can fold the result unconditionally.
 */
function sznPlayerAbilitySideTotals(
  s: GameState,
  side: "Batting" | "Pitching",
  result: ScoringResult,
): SznPlayerAbilitySideTotals {
  if (s.gameMode !== "szn" || !s.run) return EMPTY_PLAYER_ABILITY_TOTALS;
  const userSide = getUserSide(s);
  if (userSide !== side) return EMPTY_PLAYER_ABILITY_TOTALS;
  const roster = s.run.roster;
  const events = result.sznSnapEvents ?? [];
  const snap = applySnapAbilities(roster, side, result.bestGroup, events);
  const lockIn = applyLockInAbilities(roster, side, result.bestGroup);
  const reveal = applyMatchupRevealAbilities(roster, side, result.bestGroup);
  return {
    scoreBonus: snap.scoreBonus + lockIn.scoreBonus + reveal.scoreBonus,
    hitScaleBonus: snap.hitScaleBonus + lockIn.hitScaleBonus + reveal.hitScaleBonus,
    opponentScoreDelta:
      snap.opponentScoreDelta + lockIn.opponentScoreDelta + reveal.opponentScoreDelta,
    pitcherCombinedDelta: snap.pitcherCombinedDelta,
    pitcherWinsTies: lockIn.pitcherWinsTies,
  };
}

/**
 * The Battery bridge bonus: when a Catcher with a Battery right-edge ends
 * the batter chain AND the pitcher's anchor card carries a Battery left-edge,
 * the pitcher side gets a flat +15. Reads the pitcher anchor straight off
 * `s.pitcherHand[0]` (which is always the `player:` adapter) so this works
 * even when the pitcher hand has no items dealt yet.
 */
const BATTERY_BRIDGE_BONUS = 15;
function sznBatteryBridgeBonus(
  s: GameState,
  side: "Batting" | "Pitching",
  batterResult: ScoringResult,
): number {
  if (side !== "Pitching") return 0;
  if (s.gameMode !== "szn") return 0;
  // Last card of the batter's bestGroup must expose a Battery right-edge.
  const last = batterResult.bestGroup[batterResult.bestGroup.length - 1];
  if (!last) return 0;
  if (last.sznRightEdge !== "battery") return 0;
  // Pitcher's anchor must carry a Battery left-edge.
  const anchor = s.pitcherHand[0];
  if (!anchor) return 0;
  if (anchor.sznLeftEdge !== "battery") return 0;
  return BATTERY_BRIDGE_BONUS;
}

/**
 * Movement debuff carryover: -3 per stack on the next batter's effective
 * score, capped at -9 (3 stacks). Stacks are stamped into
 * `s.pendingDebuffs` from `applySznLockInEffects` so the standard
 * `sumPendingDebuffs("Batting")` pipeline picks them up next at-bat;
 * this function only mirrors the cap.
 */
const MOVEMENT_DEBUFF_PER_STACK = -3;
const MOVEMENT_DEBUFF_CAP = MOVEMENT_DEBUFF_PER_STACK * 3;

/** Permanent base-score boost granted when a Rookie snaps a Veteran's left edge. */
const VETERAN_PERMANENT_BOOST = 5;
/** RNG threshold for Deception to shatter the opposing chain. */
const DECEPTION_SHATTER_CHANCE = 0.25;

/**
 * SZN lock-in side effects: walk both sides' snap events and mutate run
 * state accordingly. Returns the run-state patch (caller is responsible
 * for splicing it into `set`) plus any extra pendingDebuffs to enqueue.
 *
 *  - Bronx Bombers (Power snap on batter side) → +$1 queued into
 *    `run.nextWeekCashBonus` per snap (the +10 score is already applied
 *    in `computeMatchup` via `sznBadgeScoreBonus`).
 *  - Veteran specialty edge (rookie→veteran-tag snap) → stamp the
 *    veteran's declared `permanentBoostOnRookie` ability effect onto the
 *    snapping rookie's `RosterPlayer.permanentBoost`. Default falls back
 *    to {@link VETERAN_PERMANENT_BOOST} for legacy / unspecified veterans.
 *    One-time per (rookie, veteran) pair tracked via
 *    `run.veteranBoostedBy`.
 *  - Movement defensive edge (any snap that lands on `movement`) →
 *    queue a -3 stacking debuff on the next opposing batter, capped at
 *    -9 total.
 */
function applySznLockInSideEffects(
  s: GameState,
  batterResult: ScoringResult,
  pitcherResult: ScoringResult,
): { runPatch: Partial<RunState> | null; extraDebuffs: PendingDebuff[] } {
  if (s.gameMode !== "szn" || !s.run) {
    return { runPatch: null, extraDebuffs: [] };
  }
  const userSide = getUserSide(s);
  const userBattersResult = userSide === "Batting" ? batterResult : null;
  const userPitchersResult = userSide === "Pitching" ? pitcherResult : null;

  let nextWeekCashBonus = s.run.nextWeekCashBonus;
  let roster = s.run.roster;
  let veteranBoostedBy = s.run.veteranBoostedBy;
  let defenseShields = s.run.defenseShields;
  let suspendedPlayerIds = s.run.suspendedPlayerIds;
  const extraDebuffs: PendingDebuff[] = [];

  // ---- SZN item lock-in side effects ---------------------------------
  // Walk the user's winning chain for each side and fire any
  // registered `onLockIn` hooks (currently: Sticky Stuff's 15%
  // destroy roll on the snapped batter). The hook returns suspend
  // requests we append to `suspendedPlayerIds` -- the series-setup
  // code resolves the id back into a concrete roster slot when the
  // next series builds its lineup.
  if (userBattersResult?.bestGroup.length) {
    const fired = applySznItemLockInEffects(userBattersResult.bestGroup, {
      side: "Batting",
    });
    for (const eff of fired) {
      if (eff.suspendPlayerId) {
        suspendedPlayerIds = [...suspendedPlayerIds, eff.suspendPlayerId];
      }
      if (eff.defenseShieldAdd) {
        defenseShields += eff.defenseShieldAdd;
      }
    }
  }
  if (userPitchersResult?.bestGroup.length) {
    const fired = applySznItemLockInEffects(userPitchersResult.bestGroup, {
      side: "Pitching",
    });
    for (const eff of fired) {
      if (eff.suspendPlayerId) {
        suspendedPlayerIds = [...suspendedPlayerIds, eff.suspendPlayerId];
      }
      if (eff.defenseShieldAdd) {
        defenseShields += eff.defenseShieldAdd;
      }
    }
  }

  // Encounter #10 Karma: doubles per-snap badge cash deposits AND any
  // direct cash-bonus deltas (handled below in the badge loop). The
  // 2x reads from the live run state because we haven't mutated
  // `karmaDoubleTriggers` in this fn -- the encounter dispatcher owns
  // the toggle.
  const karmaMul = s.run.karmaDoubleTriggers ? 2 : 1;

  // Encounter #9 Defense Shield: decrement one charge when the user
  // is on the batting seat AND the matchup actually consumed one
  // (mirrors `computeMatchup` so the chip pulse is in sync with the
  // score nullification). Shields only consume per-at-bat -- if both
  // halves of the chain produce pitching scores, only one shield
  // burns.
  const userIsBatting = userSide === "Batting";
  if (userIsBatting && defenseShields > 0) {
    defenseShields = Math.max(0, defenseShields - 1);
  }

  // -- Bronx Bombers + future onSznSnap badges (cash queue side effect) --
  // Score bonus already applied in computeMatchup; here we only queue the
  // per-snap cash bonus the badge declares.
  if (userBattersResult) {
    const events = userBattersResult.sznSnapEvents ?? [];
    for (const badgeId of s.run.badges) {
      const def = BADGES[badgeId];
      if (!def || !isSnapTrigger(def.trigger)) continue;
      if (def.trigger.nextWeekCashBonus === 0) continue;
      for (const ev of events) {
        if (ev.wildcard) continue;
        if (ev.edge !== def.trigger.edge) continue;
        nextWeekCashBonus += def.trigger.nextWeekCashBonus * karmaMul;
      }
    }
  }

  // -- Player-ability cash queue side effect (mirror of the badge loop) --
  // Aggregates per-snap nextWeekCashBonus (Volpe's "Captain Volpe")
  // plus onLockIn / onMatchupReveal cash on whichever side fired. Karma
  // doubles every deposit just like the badge path.
  if (userBattersResult) {
    const snap = applySnapAbilities(
      roster,
      "Batting",
      userBattersResult.bestGroup,
      userBattersResult.sznSnapEvents ?? [],
    );
    const lockIn = applyLockInAbilities(roster, "Batting", userBattersResult.bestGroup);
    nextWeekCashBonus +=
      (snap.nextWeekCashBonus + lockIn.nextWeekCashBonus) * karmaMul;
  }
  if (userPitchersResult) {
    const snap = applySnapAbilities(
      roster,
      "Pitching",
      userPitchersResult.bestGroup,
      userPitchersResult.sznSnapEvents ?? [],
    );
    const lockIn = applyLockInAbilities(roster, "Pitching", userPitchersResult.bestGroup);
    nextWeekCashBonus +=
      (snap.nextWeekCashBonus + lockIn.nextWeekCashBonus) * karmaMul;
  }

  // -- Veteran specialty: rookie ↔ veteran-tag permanent boost --
  // The legacy DJ LeMahieu mechanic now reads the veteran's
  // `permanentBoostOnRookie` ability effect (LeMahieu's "Veteran Boost",
  // Springer's "Vet Lift", PHI/TOR rookies' on-snap "+3 score" variants).
  // Handles BOTH chain orientations -- rookie | veteran (left-rookie /
  // right-veteran, e.g. LeMahieu) and veteran | rookie (left-veteran /
  // right-rookie, e.g. Springer). The boost stamps onto the ROOKIE's
  // permanentBoost so it persists across the run. Falls back to
  // `VETERAN_PERMANENT_BOOST` when the veteran's ability doesn't
  // override it -- keeps legacy non-SZN saves valid.
  if (userBattersResult) {
    const events = userBattersResult.sznSnapEvents ?? [];
    const updatedRoster = [...roster];
    let dirty = false;
    let veteranBoostedDirty = false;
    const updatedVeteranBoostedBy = [...veteranBoostedBy];
    for (const ev of events) {
      if (ev.wildcard) continue;
      if (ev.edge !== "rookie" && ev.edge !== "veteran-tag") continue;
      const left = userBattersResult.bestGroup.find((c) => c.id === ev.leftCardId);
      const right = userBattersResult.bestGroup.find((c) => c.id === ev.rightCardId);
      if (!left || !right) continue;
      // Identify which card carries the rookie edge vs the veteran edge.
      // Both orientations qualify -- rookie on the left of the snap with
      // veteran on the right (LeMahieu, Aidan Miller, Wagner) OR veteran
      // on the left with rookie on the right (Springer + a left-rookie
      // rookie like Aidan Miller).
      let rookieCardId: string | null = null;
      let veteranCardId: string | null = null;
      if (left.sznRightEdge === "rookie" && right.sznLeftEdge === "veteran-tag") {
        rookieCardId = left.id;
        veteranCardId = right.id;
      } else if (left.sznRightEdge === "veteran-tag" && right.sznLeftEdge === "rookie") {
        rookieCardId = right.id;
        veteranCardId = left.id;
      }
      if (!rookieCardId || !veteranCardId) continue;
      // Player ids carry the `player:` prefix on the anchor card; bag items
      // never carry SZN edges so this filter is implicitly satisfied.
      const rookiePlayerId = rookieCardId.replace(/^player:/, "");
      const veteranPlayerId = veteranCardId.replace(/^player:/, "");
      const pairKey = `${rookiePlayerId}->${veteranPlayerId}`;
      if (updatedVeteranBoostedBy.includes(pairKey)) continue;
      const rookieIdx = updatedRoster.findIndex((r) => r.player.id === rookiePlayerId);
      if (rookieIdx < 0) continue;
      const vetRosterEntry = updatedRoster.find(
        (r) => r.player.id === veteranPlayerId,
      );
      const vetPlayer = vetRosterEntry?.player;
      let boostAmount = VETERAN_PERMANENT_BOOST;
      if (vetPlayer && isSznPlayer(vetPlayer)) {
        const vetAbilityBoost = vetPlayer.passive.effect.permanentBoostOnRookie;
        if (typeof vetAbilityBoost === "number" && vetAbilityBoost > 0) {
          boostAmount = vetAbilityBoost;
        }
      }
      const rookieTarget = updatedRoster[rookieIdx];
      updatedRoster[rookieIdx] = {
        ...rookieTarget,
        permanentBoost: (rookieTarget.permanentBoost ?? 0) + boostAmount,
      };
      updatedVeteranBoostedBy.push(pairKey);
      dirty = true;
      veteranBoostedDirty = true;
    }
    if (dirty) roster = updatedRoster;
    if (veteranBoostedDirty) veteranBoostedBy = updatedVeteranBoostedBy;
  }

  // -- Movement defensive edge debuff carryover --
  // Counts Movement snaps from EITHER side: the user's pitcher firing
  // them at the ghost batter, or the ghost pitcher firing them at the
  // user's next batter. Stacks cap at 3 (-9 total). We post-clamp by
  // checking how many movement stacks already sit in pendingDebuffs.
  const movementEventsUserSide = userPitchersResult?.sznSnapEvents ?? [];
  const ghostPitcherResult = userSide === "Batting" ? pitcherResult : null;
  const ghostPitcherEvents = ghostPitcherResult?.sznSnapEvents ?? [];
  const collect = (events: typeof movementEventsUserSide, debuffSide: "Batting" | "Pitching") => {
    const newStacks = events.filter((ev) => !ev.wildcard && ev.edge === "movement").length;
    if (newStacks === 0) return;
    // Count existing movement stacks already pending so the cap is enforced.
    const existing = s.pendingDebuffs.filter(
      (d) => d.appliesToSide === debuffSide && d.source === "szn-movement",
    ).length;
    const remainingCapacity = Math.max(0, 3 - existing);
    const toAdd = Math.min(newStacks, remainingCapacity);
    for (let i = 0; i < toAdd; i++) {
      extraDebuffs.push({
        appliesToSide: debuffSide,
        totalValueDelta: MOVEMENT_DEBUFF_PER_STACK,
        remainingAtBats: 2,
        source: "szn-movement",
      });
    }
  };
  // User pitcher's Movement snaps debuff the ghost (Batting) on their
  // next at-bat. Conceptually that's the same `Batting` side carry-over
  // — `pendingDebuffs` is keyed by which side the debuff hurts.
  collect(movementEventsUserSide, "Batting");
  // Ghost pitcher's Movement snaps debuff the user's next batter.
  collect(ghostPitcherEvents, "Batting");

  void MOVEMENT_DEBUFF_CAP; // referenced for clamp docs

  if (
    nextWeekCashBonus === s.run.nextWeekCashBonus &&
    roster === s.run.roster &&
    veteranBoostedBy === s.run.veteranBoostedBy &&
    defenseShields === s.run.defenseShields &&
    suspendedPlayerIds === s.run.suspendedPlayerIds
  ) {
    return { runPatch: null, extraDebuffs };
  }
  return {
    runPatch: {
      nextWeekCashBonus,
      roster,
      veteranBoostedBy,
      defenseShields,
      suspendedPlayerIds,
    },
    extraDebuffs,
  };
}

/**
 * Deception / chain-shatter RNG: walk a pitching ScoringResult's snap
 * events for any `deception` edge AND consult the on-mound pitcher's
 * ability registry (Cortes' "Funky Delivery", Bassitt's "Bassitt Funk",
 * Rodríguez's "Yariel Sweep") for a per-player `chainShatterChance`
 * effect. Rolls ONCE per matchup; the highest declared chance wins so
 * stacked Deception abilities can't compound past 1.0. When no shatter
 * fires, returns the original batterResult unchanged.
 *
 * Falls back to the legacy {@link DECEPTION_SHATTER_CHANCE} (25%) when
 * the pitcher's ability registry doesn't declare a `chainShatterChance`
 * effect -- keeps any non-SZN scoring paths working.
 */
function maybeApplyDeception(
  s: GameState,
  batterResult: ScoringResult,
  pitcherResult: ScoringResult,
): { batterResult: ScoringResult; shattered: boolean } {
  const events = pitcherResult.sznSnapEvents ?? [];
  const hasDeception = events.some(
    (ev) => !ev.wildcard && ev.edge === "deception",
  );
  if (!hasDeception) return { batterResult, shattered: false };
  // Consult the user's pitcher roster (if any) for a per-player shatter
  // chance. The on-mound pitcher's anchor must be in the chain for their
  // ability to fire (matches the `applySnapAbilities` convention).
  let chance = DECEPTION_SHATTER_CHANCE;
  if (s.gameMode === "szn" && s.run) {
    const userSide = getUserSide(s);
    if (userSide === "Pitching") {
      const snap = applySnapAbilities(
        s.run.roster,
        "Pitching",
        pitcherResult.bestGroup,
        events,
      );
      if (snap.chainShatterChance > chance) chance = snap.chainShatterChance;
    }
  }
  if (Math.random() >= chance) {
    return { batterResult, shattered: false };
  }
  // Shatter: collapse bestGroup to just the anchor (first card) and
  // recompute totals. We don't touch `cardModifiers` so the reveal still
  // shows what each card WOULD have contributed — only the matchup math
  // gets the "they swung at deception" haircut.
  const anchor = batterResult.bestGroup[0];
  if (!anchor) return { batterResult, shattered: true };
  const anchorMod = batterResult.cardModifiers[anchor.id];
  const anchorValue = anchorMod?.value ?? anchor.baseValue;
  return {
    batterResult: {
      ...batterResult,
      bestGroup: [anchor],
      maxValue: anchorValue,
      // Wipe targeted opponent debuffs from non-anchor cards — they didn't
      // actually fire because the chain shattered.
      targetedOpponentDebuffs: batterResult.targetedOpponentDebuffs.filter(
        (d) => d.sourceCardId === anchor.id,
      ),
    },
    shattered: true,
  };
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

  // SZN Mode: adjacent roster tag clusters (see `synergies.ts`) stack on the
  // chain total. Rarity base for the player-at-the-plate is already in the
  // chain via the player-as-card's `baseValue` (see `freshAtBat`).
  //
  // Four additional SZN sources stack on top of the tag-synergy bonus:
  //   - sznBadgeScoreBonus: passive badge fires per qualifying snap event
  //     (Bronx Bombers: +10 per Power snap; Liberty Bell: +5 per Power).
  //   - sznBadgeHitScaleBonus: badge Hit Scale folded into the side's hit
  //     scale axis (north-of-the-border: +1 Hit Scale per Contact snap).
  //   - sznBatteryBridgeBonus: +15 to pitcher side when a Catcher with a
  //     Battery right-edge ends the batter chain AND the pitcher anchor
  //     has a Battery left-edge.
  //   - sznPlayerAbilitySideTotals: per-player passive + potential
  //     abilities (Aaron Judge's "All Rise" etc.). Bundles score, hit
  //     scale, opponent score delta, and tie-flip into one totals
  //     struct so the per-side accumulator stays flat.
  // Non-SZN paths leave all bonuses at 0.
  const batterAbilityTotals = sznPlayerAbilitySideTotals(s, "Batting", batterResult);
  const pitcherAbilityTotals = sznPlayerAbilitySideTotals(s, "Pitching", pitcherResult);
  const sznBatterBonus =
    sznSideBonus(s, "Batting") +
    sznBadgeScoreBonus(s, "Batting", batterResult) +
    batterAbilityTotals.scoreBonus +
    pitcherAbilityTotals.opponentScoreDelta;
  const sznPitcherBonus =
    sznSideBonus(s, "Pitching") +
    sznBadgeScoreBonus(s, "Pitching", pitcherResult) +
    sznBatteryBridgeBonus(s, "Pitching", batterResult) +
    pitcherAbilityTotals.scoreBonus +
    pitcherAbilityTotals.pitcherCombinedDelta +
    batterAbilityTotals.opponentScoreDelta;
  const sznBatterHitScale =
    sznBadgeHitScaleBonus(s, "Batting", batterResult) + batterAbilityTotals.hitScaleBonus;
  const sznPitcherHitScale =
    sznBadgeHitScaleBonus(s, "Pitching", pitcherResult) + pitcherAbilityTotals.hitScaleBonus;

  // Encounter #9 Defense Shield: when the user is on the BATTING seat
  // (so the opposing pitcher is the "pitcherTotal" we're computing
  // against), spend one shield charge to zero the opponent's chain
  // contribution. The charge is decremented inside the lock-in side-
  // effect pass; here we only TREAT pitcherTotal as zero for the
  // hit-scale and tie-break math so the preview HUD already shows the
  // user winning with the shield active.
  const userIsBatting = s.gameMode === "szn" && getUserSide(s) === "Batting";
  const shieldsAvailable = (s.run?.defenseShields ?? 0) > 0;
  const consumeShield = userIsBatting && shieldsAvailable;

  const batterTotal =
    batterResult.maxValue +
    effPitcherOpponentMod +
    effBatterDebuffDelta +
    guessPitchBonus +
    sznBatterBonus;
  const pitcherTotal = consumeShield
    ? 0
    : pitcherResult.maxValue +
      batterResult.opponentModifier +
      batterResult.pitcherCombinedDelta +
      pitcherDebuffDelta +
      sznPitcherBonus;

  // Tie-breakers: pitchers (p-48 Lights Out, p-80 Umpire's Call) flip ties
  // to themselves; b-71 Manager's Challenge is the batter mirror and beats
  // any pitcher tie-breaker (the manager always gets the last word). Default
  // is unchanged: ties go to the batter. Player abilities (Cole's "Ace",
  // Wheeler's "Ace 2", Scherzer's "Mad Max") can also flip ties to the
  // pitcher on lock-in.
  const tiePitcher =
    batterResult.pitcherWinsTies ||
    pitcherResult.pitcherWinsTies ||
    pitcherAbilityTotals.pitcherWinsTies;
  const batterChallenges = s.batterHand.some((c) => c.id === "b-71");
  const tieGoesToPitcher = tiePitcher && !batterChallenges;
  const batterWins =
    batterTotal > pitcherTotal || (batterTotal === pitcherTotal && !tieGoesToPitcher);

  const batterHitScaleNet =
    batterResult.hitScaleBonus + sznBatterHitScale - effPitcherHitScaleWall - sznPitcherHitScale;
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
    const mechConnect = canConnectAny(prev, curr);
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
    const mechConnect = canConnectAny(prev, curr);
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
  // SZN games cap extras at exactly one extra inning, then declare a
  // draw if still tied. Without this cap, a 3-inning weekend game can
  // grind into unbounded extras and gum up the run schedule.
  const sznTiedExtrasCap = s.gameMode === "szn" && s.run !== null
    ? totalInnings + 1
    : null;
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
      // SZN caps extras at one inning, declaring a draw if still tied
      // after the extra frame completes (see `applyOutcome` header).
      if (inning > totalInnings && homeScore !== awayScore) {
        phase = "game-over";
      } else if (
        sznTiedExtrasCap !== null &&
        inning > sznTiedExtrasCap &&
        homeScore === awayScore
      ) {
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
