import { create } from "zustand";
import { CardDefinition } from "./cards";
import { BATTERS, dealHand, MlbPlayer, PITCHERS } from "./players";
import { HitOutcome, resolveHitScale, scoreHand, ScoringContext, ScoringResult } from "./scoring";
import { applyCardEffect, EffectContext } from "./cardEffects";
import { applyHandTransforms } from "./handTransforms";
import { applyDealEffects } from "./dealEffects";
import { applyResolveStep, PendingDebuff, RunnerSlot } from "./resolveStep";
import type { ShapeType } from "../components/cardShapes";

export type Half = "top" | "bottom";
/**
 * `revealing` sits between `selecting` and `between-at-bats`. lockIn computes
 * the final outcome (and applies bases / runs / outs) but parks the phase here
 * so the UI can play through `revealScript` -- per-card self mods, then
 * targeted opponent debuffs, then aggregates / cross-at-bat / guess-pitch
 * beats -- before transitioning to the resolved state. The destination phase
 * (between-at-bats or game-over) is stashed in `pendingResolvedPhase`.
 */
export type Phase = "selecting" | "resolving" | "revealing" | "between-at-bats" | "game-over";

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
  | { kind: "guessPitchHit"; delta: number }
  | {
      kind: "crossDebuff";
      affectedSide: "Batting" | "Pitching";
      delta: number;
      label: string;
    };
export type Bases = [boolean, boolean, boolean]; // [1B, 2B, 3B]

/**
 * Which side of the matchup the human player is sitting in. Today this is
 * always the batter -- the pitcher hand is dealt and resolved by the engine
 * with no AI assistance, so opponent-side prompts (p-56 Pinpoint Control)
 * silently no-op and opponent-side peeks (p-51 Veteran Savvy, p-59 Nasty
 * Slider) are never surfaced to the player. UI components import this to
 * filter `pendingChoices` and `pendingReveals` down to the user's seat,
 * preventing information leaks like the batter seeing what the pitcher
 * "knows" about their hand.
 *
 * Promote to a per-game store field once we add a pitcher-mode toggle or
 * head-to-head play.
 */
export const USER_SIDE: "Batting" | "Pitching" = "Batting";

/**
 * Open question presented to the player after the hand is dealt and before
 * lock-in. The PlayerChoiceModal turns each entry into a panel the player
 * resolves via `resolveChoice`. Unanswered choices simply drop their effect
 * (the engine treats them as "the player declined").
 *
 * - `guessShape`: pick one shape (b-65 Guess Pitch).
 * - `pickShape`: full 3-step picker (target card + side + shape).
 *   `targets` enumerates the eligible card IDs in the prompting player's hand.
 * - `pickGeneral` / `pickConnection`: reserved for later phases.
 */
export interface PendingChoice {
  cardId: string;
  side: "Batting" | "Pitching";
  type: "guessShape" | "pickShape" | "pickGeneral" | "pickConnection";
  options?: string[];
  /** Eligible target card IDs for `pickShape` (modify-shape wizard). */
  targets?: string[];
}

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
  reveal: "opponentHand" | "opponentUncombined" | "opponentLayout";
  source: string;
}

export type { PendingDebuff } from "./resolveStep";

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
   * Per-runner movement list produced by the most recent at-bat. Drives the 3D
   * runner travel animation while the camera is zoomed out. Cleared at the
   * start of the next at-bat (and on reset).
   */
  runnerMoves: RunnerMove[];

  /** Cross-at-bat debuffs queued by resolve-step effects. Drained one at-bat at a time. */
  pendingDebuffs: PendingDebuff[];
  /** Open player-choice prompts for the current at-bat. Defaults applied if unanswered. */
  pendingChoices: PendingChoice[];
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

  // Actions.
  reorderBatterHand: (cards: CardDefinition[]) => void;
  reorderPitcherHand: (cards: CardDefinition[]) => void;
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
  reset: () => void;
  resolveChoice: (cardId: string, value: ResolvedChoice) => void;
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

function pushRecent(list: string[], id: string, limit: number): string[] {
  const next = [id, ...list.filter((x) => x !== id)];
  return next.slice(0, limit);
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
function freshAtBat(recent?: { batters?: string[]; pitchers?: string[] }): FreshAtBat {
  const batter = pickAvoidingRecent(BATTERS, recent?.batters ?? []);
  const pitcher = pickAvoidingRecent(PITCHERS, recent?.pitchers ?? []);
  const rawBatter = dealHand(batter);
  const rawPitcher = dealHand(pitcher);

  // Phase 2 ordering: roster mods (add/remove/swap) run BEFORE shape/value
  // transforms, so b-21 / p-31 / p-47 etc. see the final hand composition.
  const dealResult = applyDealEffects(rawBatter, rawPitcher);
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
  const SHAPE_OPTIONS = ["circle", "diamond", "square", "star"];
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

function derivePendingReveals(
  batterHand: CardDefinition[],
  pitcherHand: CardDefinition[],
): PendingReveal[] {
  const out: PendingReveal[] = [];
  if (batterHand.some((c) => c.id === "b-7")) {
    out.push({ forSide: "Batting", reveal: "opponentUncombined", source: "Soto Shuffle" });
  }
  if (pitcherHand.some((c) => c.id === "p-51")) {
    out.push({ forSide: "Pitching", reveal: "opponentHand", source: "Veteran Savvy" });
  }
  if (pitcherHand.some((c) => c.id === "p-59")) {
    out.push({ forSide: "Pitching", reveal: "opponentLayout", source: "Nasty Slider" });
  }
  return out;
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
  lastBatterCardModifiers: {},
  lastPitcherCardModifiers: {},
  runnerMoves: [],

  pendingDebuffs: [],
  resolvedChoices: {},
  coinFlips: {},
  recentBatterIds: [INITIAL_AT_BAT.batter.id],
  recentPitcherIds: [INITIAL_AT_BAT.pitcher.id],

  revealScript: [],
  pendingResolvedPhase: null,

  reorderBatterHand: (cards) => set({ batterHand: cards }),
  reorderPitcherHand: (cards) => set({ pitcherHand: cards }),

  resolveChoice: (cardId, value) =>
    set((s) => {
      const remainingChoices = s.pendingChoices.filter((c) => c.cardId !== cardId);
      const resolvedChoices = { ...s.resolvedChoices, [cardId]: value };

      // Modify-shape choices (b-12 Switch Hitter, p-56 Pinpoint Control):
      // the modal hands us {targetCardId, side, shape}. The player owns the
      // pick of card AND side; the engine just applies it to the right hand.
      if (value.kind === "modifyShape") {
        const owningHandKey = cardId === "b-12" ? "batterHand" : cardId === "p-56" ? "pitcherHand" : null;
        if (!owningHandKey) {
          return { resolvedChoices, pendingChoices: remainingChoices };
        }
        const hand = s[owningHandKey];
        const idx = hand.findIndex((c) => c.id === value.targetCardId);
        if (idx === -1) {
          // Target not in the prompting player's hand -- ignore silently.
          return { resolvedChoices, pendingChoices: remainingChoices };
        }
        // b-12 only allows the player to retarget their own General cards;
        // refuse a sneaky signature pick that bypasses the modal's filter.
        if (cardId === "b-12" && hand[idx].abilityType !== "General Draw") {
          return { resolvedChoices, pendingChoices: remainingChoices };
        }
        const updated = [...hand];
        updated[idx] =
          value.side === "left"
            ? { ...updated[idx], leftShape: value.shape }
            : { ...updated[idx], rightShape: value.shape };
        return {
          resolvedChoices,
          pendingChoices: remainingChoices,
          [owningHandKey]: updated,
        };
      }

      // b-65 Guess Pitch (kind === "shape"): just record the answer; lockIn
      // applies the bonus during scoring.
      return { resolvedChoices, pendingChoices: remainingChoices };
    }),

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
      opponentHand: s.pitcherHand,
      opponentBaseCard: highestValueCard(s.pitcherHand),
      nullifiedCardIds: nullified,
      coinFlips: s.coinFlips,
      // Phase 6: live game-state triggers for runners / score / half.
      bases: s.bases,
      half: s.half,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
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
      coinFlips: s.coinFlips,
      // Phase 6: live game-state triggers for runners / score / half.
      bases: s.bases,
      half: s.half,
      homeScore: s.homeScore,
      awayScore: s.awayScore,
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
    const m = computeMatchup(s, batterResult, pitcherResult);
    return {
      batterDisplay: m.batterDisplay,
      pitcherDisplay: m.pitcherDisplay,
      batterWinning: m.batterWins,
      batterHitScaleBonus: m.batterHitScaleNet,
    };
  },

  lockIn: () => {
    const sBefore = get();
    if (sBefore.phase !== "selecting") return;

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

    // Hit Scale ladder: only fires when the batter wins. forcedOutcome short-
    // circuits the ladder entirely (b-22 Walk-Off etc.).
    let outcome: HitOutcome;
    if (batterResult.forcedOutcome) {
      outcome = batterResult.forcedOutcome;
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

    set({
      ...next,
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
      lastResultMessage: message,
      phase: "revealing",
      pendingResolvedPhase: next.phase,
      revealScript: script,
      runnerMoves: next.runnerMoves,
      pendingDebuffs: nextDebuffs,
    });
  },

  completeReveal: () => {
    const s = get();
    if (s.phase !== "revealing") return;
    set({
      phase: s.pendingResolvedPhase ?? "between-at-bats",
      pendingResolvedPhase: null,
      revealScript: [],
    });
  },

  startNextAtBat: () => {
    const s = get();
    if (s.phase === "game-over") return;
    const ab = freshAtBat({
      batters: s.recentBatterIds,
      pitchers: s.recentPitcherIds,
    });
    set({
      ...ab,
      atBatId: s.atBatId + 1,
      phase: "selecting",
      lastOutcome: null,
      lastResultMessage: "",
      // Drop the lock-in modifier snapshot so the new at-bat shows live previews.
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      runnerMoves: [],
      // isFirstAtBatOfInning gets set to false after the first at-bat of the half.
      isFirstAtBatOfInning: false,
      resolvedChoices: {},
      coinFlips: {},
      recentBatterIds: pushRecent(s.recentBatterIds, ab.batter.id, RECENT_BATTER_LIMIT),
      recentPitcherIds: pushRecent(s.recentPitcherIds, ab.pitcher.id, RECENT_PITCHER_LIMIT),
      revealScript: [],
      pendingResolvedPhase: null,
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
      lastBatterCardModifiers: {},
      lastPitcherCardModifiers: {},
      runnerMoves: [],
      pendingDebuffs: [],
      resolvedChoices: {},
      coinFlips: {},
      recentBatterIds: [ab.batter.id],
      recentPitcherIds: [ab.pitcher.id],
      revealScript: [],
      pendingResolvedPhase: null,
    });
  },
}));

/**
 * Score a hand using the same context the store would build, but with an
 * arbitrary card list substituted in. Used by lockIn when p-41 Sweeping
 * Slider mutates the batter hand mid-resolution.
 */
function scoreHandFor(
  s: GameState,
  hand: CardDefinition[],
  side: "Batting" | "Pitching",
): ScoringResult {
  const isBatting = side === "Batting";
  const opponent = isBatting ? s.pitcherHand : s.batterHand;
  const aceCommand = isBatting && s.pitcherHand.some((c) => c.id === "p-36");
  const nullified = new Set<string>();
  if (aceCommand) {
    const top = highestValueCard(hand);
    if (top) nullified.add(top.id);
  }
  const ctx: ScoringContext = {
    side,
    inning: s.inning,
    isFirstAtBatOfInning: s.isFirstAtBatOfInning,
    outs: s.outs,
    isFinalInning: s.inning === s.totalInnings,
    batterHandedness: s.batter.handedness,
    opponentHand: opponent,
    opponentBaseCard: highestValueCard(opponent),
    nullifiedCardIds: nullified,
    coinFlips: s.coinFlips,
    // Phase 6: keep state-trigger context aligned with the live store
    // values so probe scores (p-41 Sweeping Slider) see the same world.
    bases: s.bases,
    half: s.half,
    homeScore: s.homeScore,
    awayScore: s.awayScore,
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
  const guessBonus = computeGuessPitchBonus(s);
  if (guessBonus !== 0) {
    beats.push({ kind: "guessPitchHit", delta: guessBonus });
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
      opponentBaseCard: highestValueCard(opponent) ?? undefined,
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
  const target = probe.bestGroup.length > 1 ? probe.bestGroup[0] : null;
  if (!target) return s.batterHand;
  return s.batterHand.map((c) =>
    c.id === target.id
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
): ComputedMatchup {
  const batterDebuffDelta = sumPendingDebuffs(s.pendingDebuffs, "Batting");
  const pitcherDebuffDelta = sumPendingDebuffs(s.pendingDebuffs, "Pitching");

  const batterIgnoresDebuffs = s.batterHand.some((c) => c.id === "b-9");
  const effPitcherOpponentMod = batterIgnoresDebuffs ? 0 : pitcherResult.opponentModifier;
  const effPitcherHitScaleWall = batterIgnoresDebuffs ? 0 : pitcherResult.hitScaleBonus;
  const effBatterDebuffDelta = batterIgnoresDebuffs ? 0 : batterDebuffDelta;

  const guessPitchBonus = computeGuessPitchBonus(s);

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

  return {
    batterTotal,
    pitcherTotal,
    batterWins,
    hitScaleValue,
    batterDisplay,
    pitcherDisplay: pitcherTotal,
    batterHitScaleNet,
  };
}

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

function applyOutcome(
  s: GameState,
  outcome: HitOutcome,
  resolveDelta: { outsAdjustment: number; removeRunnerHint: RunnerSlot | null; forceRunFromThird: boolean },
): OutcomeApplyResult {
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
      outs += 1 + Math.max(0, resolveDelta.outsAdjustment);
      // b-69 Sacrifice Fly: even though the batter is out, the runner from
      // 3rd scores. Other runners hold.
      if (resolveDelta.forceRunFromThird && bases[2]) {
        runnerMoves.push({ id: nextMoveId(), from: "third", to: "scored", kind: "runner" });
        bases = [bases[0], bases[1], false] as Bases;
        runs += 1;
      }
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

  // p-75 Pickoff Move: if the resolve step asked us to erase a runner, do it
  // here so the change persists into the next at-bat.
  if (resolveDelta.removeRunnerHint) {
    const idx =
      resolveDelta.removeRunnerHint === "first"
        ? 0
        : resolveDelta.removeRunnerHint === "second"
          ? 1
          : 2;
    if (bases[idx]) {
      const slot = BASE_INDEX_TO_SLOT[idx];
      runnerMoves.push({ id: nextMoveId(), from: slot, to: "scored", kind: "runner" });
      bases = [
        idx === 0 ? false : bases[0],
        idx === 1 ? false : bases[1],
        idx === 2 ? false : bases[2],
      ] as Bases;
    }
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
