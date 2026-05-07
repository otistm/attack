import type { HitOutcome } from "./scoring";
import type { QuestReward } from "./questRewards";

export type QuestTeam = "HOME" | "AWAY";
export type QuestHalf = "top" | "bottom";
export type QuestPhaseAfter =
  | "drafting"
  | "selecting"
  | "resolving"
  | "revealing"
  | "between-at-bats"
  | "game-over";

export type QuestRarity = "common" | "rare" | "legendary";

export type QuestPhase =
  | "atBatStart"
  | "scoreTime"
  | "resolve"
  | "inningEnd"
  | "gameEnd"
  | "afterLockIn";

export interface QuestProgressState {
  completed: boolean;
  /** Hot Streak: consecutive matchup wins for the human */
  streak: number;
  /** The Cycle: bitmask 1=single 2=double 4=triple 8=homerun */
  cycleBits: number;
  /** Power Surge: homers while user's team batting */
  homerCount: number;
  /** Chain Lightning */
  chainDone: boolean;
  /** Comeback King */
  comebackDone: boolean;
}

export function initialQuestProgress(): QuestProgressState {
  return {
    completed: false,
    streak: 0,
    cycleBits: 0,
    homerCount: 0,
    chainDone: false,
    comebackDone: false,
  };
}

export interface QuestTickContext {
  phase: QuestPhase;
  userTeam: QuestTeam;
  /** Inning at the start of the at-bat (before applyOutcome). */
  inningAtAbStart: number;
  /** Half at the start of the at-bat. */
  halfAtAbStart: QuestHalf;
  isUserTeamBatting: boolean;
  humanWonMatchup: boolean;
  lastOutcome: HitOutcome;
  prePlayHomeScore: number;
  prePlayAwayScore: number;
  postPlayHomeScore: number;
  postPlayAwayScore: number;
  /** Phase after applyOutcome / lockIn resolution. */
  phaseAfter: QuestPhaseAfter;
  /** Length of batter's best chain this lock-in. */
  batterBestChainLength: number;
  /** True when the half-inning or inning index changed vs start of AB. */
  inningTransitioned: boolean;
}

export interface QuestDefinition {
  id: string;
  title: string;
  flavor: string;
  rarity: QuestRarity;
  hint: string;
  phases: QuestPhase[];
  reward: QuestReward;
  tick: (ctx: QuestTickContext, p: QuestProgressState) => QuestProgressState;
}

const OUTCOME_BIT: Record<Exclude<HitOutcome, "out">, number> = {
  single: 1,
  double: 2,
  triple: 4,
  homerun: 8,
};

const CYCLE_COMPLETE_MASK = 0xf;

function userRuns(scoreHome: number, scoreAway: number, team: QuestTeam): number {
  return team === "HOME" ? scoreHome : scoreAway;
}

function oppRuns(scoreHome: number, scoreAway: number, team: QuestTeam): number {
  return team === "HOME" ? scoreAway : scoreHome;
}

export const QUEST_HOT_STREAK = "quest-hot-streak";
export const QUEST_CHAIN_LIGHTNING = "quest-chain-lightning";
export const QUEST_THE_CYCLE = "quest-the-cycle";
export const QUEST_POWER_SURGE = "quest-power-surge";
export const QUEST_COMEBACK_KING = "quest-comeback-king";
export const QUEST_WALK_OFF = "quest-walk-off-hero";

const DEF_HOT_STREAK: QuestDefinition = {
  id: QUEST_HOT_STREAK,
  title: "Hot Streak",
  flavor: "Ride the wave — three straight wins!",
  rarity: "common",
  hint: "Win 3 at-bats in a row (batting or pitching).",
  phases: ["afterLockIn"],
  reward: { kind: "battingHitScale", amount: 2 },
  tick: (ctx, p) => {
    if (p.completed || ctx.phase !== "afterLockIn") return p;
    const won = ctx.humanWonMatchup;
    const nextStreak = won ? p.streak + 1 : 0;
    const done = nextStreak >= 3;
    return {
      ...p,
      streak: nextStreak,
      completed: done,
    };
  },
};

const DEF_CHAIN: QuestDefinition = {
  id: QUEST_CHAIN_LIGHTNING,
  title: "Chain Lightning",
  flavor: "Link four into the storm!",
  rarity: "common",
  hint: "Batting: build a best chain of 4+ cards in one lock-in.",
  phases: ["afterLockIn"],
  reward: { kind: "battingHitScale", amount: 1 },
  tick: (ctx, p) => {
    if (p.completed || ctx.phase !== "afterLockIn") return p;
    if (!ctx.isUserTeamBatting) return p;
    if (ctx.batterBestChainLength >= 4) {
      return { ...p, chainDone: true, completed: true };
    }
    return p;
  },
};

const DEF_CYCLE: QuestDefinition = {
  id: QUEST_THE_CYCLE,
  title: "The Cycle",
  flavor: "Touch 'em all — single through homer!",
  rarity: "rare",
  hint: "While batting, collect a single, double, triple, and HR in one game.",
  phases: ["afterLockIn"],
  reward: { kind: "forceHomerunOnce" },
  tick: (ctx, p) => {
    if (p.completed || ctx.phase !== "afterLockIn") return p;
    if (!ctx.isUserTeamBatting) return p;
    let bits = p.cycleBits;
    if (
      ctx.lastOutcome !== "out" &&
      ctx.lastOutcome in OUTCOME_BIT
    ) {
      bits |= OUTCOME_BIT[ctx.lastOutcome as Exclude<HitOutcome, "out">];
    }
    const done = (bits & CYCLE_COMPLETE_MASK) === CYCLE_COMPLETE_MASK;
    return { ...p, cycleBits: bits, completed: done };
  },
};

const DEF_POWER: QuestDefinition = {
  id: QUEST_POWER_SURGE,
  title: "Power Surge",
  flavor: "Three moonshots — leave the yard!",
  rarity: "rare",
  hint: "Hit 3 home runs while your team is batting.",
  phases: ["afterLockIn"],
  reward: { kind: "wildcardNextBatterHand" },
  tick: (ctx, p) => {
    if (p.completed || ctx.phase !== "afterLockIn") return p;
    if (!ctx.isUserTeamBatting) return p;
    const homers =
      ctx.lastOutcome === "homerun" ? p.homerCount + 1 : p.homerCount;
    return { ...p, homerCount: homers, completed: homers >= 3 };
  },
};

const DEF_COMEBACK: QuestDefinition = {
  id: QUEST_COMEBACK_KING,
  title: "Comeback King",
  flavor: "Down big? Steal the moment!",
  rarity: "rare",
  hint: "Win a plate appearance while batting and down by 5+ runs.",
  phases: ["afterLockIn"],
  reward: { kind: "battingHitScale", amount: 5 },
  tick: (ctx, p) => {
    if (p.completed || ctx.phase !== "afterLockIn") return p;
    if (!ctx.isUserTeamBatting || !ctx.humanWonMatchup) return p;
    const usr = userRuns(
      ctx.prePlayHomeScore,
      ctx.prePlayAwayScore,
      ctx.userTeam,
    );
    const opp = oppRuns(
      ctx.prePlayHomeScore,
      ctx.prePlayAwayScore,
      ctx.userTeam,
    );
    if (usr + 5 <= opp) {
      return { ...p, comebackDone: true, completed: true };
    }
    return p;
  },
};

const DEF_WALKOFF: QuestDefinition = {
  id: QUEST_WALK_OFF,
  title: "Walk-Off Hero",
  flavor: "Hollywood ending — game over!",
  rarity: "legendary",
  hint: "In the 9th or later, batting trailing/tied, take the lead and end the game.",
  phases: ["afterLockIn"],
  reward: { kind: "cosmeticLegendary" },
  tick: (ctx, p) => {
    if (p.completed || ctx.phase !== "afterLockIn") return p;
    if (ctx.phaseAfter !== "game-over") return p;
    if (ctx.inningAtAbStart < 9) return p;
    if (!ctx.isUserTeamBatting) return p;
    const preUser = userRuns(
      ctx.prePlayHomeScore,
      ctx.prePlayAwayScore,
      ctx.userTeam,
    );
    const preOpp = oppRuns(
      ctx.prePlayHomeScore,
      ctx.prePlayAwayScore,
      ctx.userTeam,
    );
    const postUser = userRuns(
      ctx.postPlayHomeScore,
      ctx.postPlayAwayScore,
      ctx.userTeam,
    );
    const postOpp = oppRuns(
      ctx.postPlayHomeScore,
      ctx.postPlayAwayScore,
      ctx.userTeam,
    );
    if (preUser > preOpp) return p; // already leading — not a walk-off narrative
    if (postUser <= postOpp) return p;
    return { ...p, completed: true };
  },
};

export const QUEST_DEFINITIONS: QuestDefinition[] = [
  DEF_HOT_STREAK,
  DEF_CHAIN,
  DEF_CYCLE,
  DEF_POWER,
  DEF_COMEBACK,
  DEF_WALKOFF,
];

export const QUEST_REGISTRY: Record<string, QuestDefinition> = Object.fromEntries(
  QUEST_DEFINITIONS.map((d) => [d.id, d]),
);

export const QUEST_POOL_BY_RARITY: Record<QuestRarity, string[]> = {
  common: [QUEST_HOT_STREAK, QUEST_CHAIN_LIGHTNING],
  rare: [QUEST_THE_CYCLE, QUEST_POWER_SURGE, QUEST_COMEBACK_KING],
  legendary: [QUEST_WALK_OFF],
};

/**
 * Picks one quest id per rarity (Phase 1 auto-roll). Phase 3 can replace with UI.
 * Avoids duplicate ids when the same card appears in multiple pools (defensive).
 */
export function rollQuestSlate(): string[] {
  const taken = new Set<string>();
  const pick = (pool: string[]) => {
    const avail = pool.filter((id) => !taken.has(id));
    const use = avail.length > 0 ? avail : pool;
    const id = use[Math.floor(Math.random() * use.length)]!;
    taken.add(id);
    return id;
  };
  return [
    pick(QUEST_POOL_BY_RARITY.common),
    pick(QUEST_POOL_BY_RARITY.rare),
    pick(QUEST_POOL_BY_RARITY.legendary),
  ];
}

/** Re-roll one slot (0=common,1=rare,2=legendary pool) avoiding duplicate ids in other slots when possible. */
export function rerollQuestSlotAt(
  slate: readonly [string, string, string],
  index: 0 | 1 | 2,
): [string, string, string] {
  const rarities: QuestRarity[] = ["common", "rare", "legendary"];
  const pool = QUEST_POOL_BY_RARITY[rarities[index]];
  const others = new Set(slate.filter((_, i) => i !== index));
  const avail = pool.filter((id) => !others.has(id));
  const choices = avail.length > 0 ? avail : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)]!;
  const next: [string, string, string] = [...slate];
  next[index] = pick;
  return next;
}

export function applyQuestTickToAll(
  activeQuestIds: string[],
  progress: Record<string, QuestProgressState>,
  ctx: QuestTickContext,
): { nextProgress: Record<string, QuestProgressState>; newlyCompleted: string[] } {
  const nextProgress = { ...progress };
  const newlyCompleted: string[] = [];

  for (const id of activeQuestIds) {
    const def = QUEST_REGISTRY[id];
    if (!def || !def.phases.includes(ctx.phase)) continue;
    const prev = nextProgress[id] ?? initialQuestProgress();
    if (prev.completed) continue;
    const updated = def.tick(ctx, prev);
    nextProgress[id] = updated;
    if (updated.completed && !prev.completed) {
      newlyCompleted.push(id);
    }
  }

  return { nextProgress, newlyCompleted };
}

/**
 * Player-facing one-liner describing the current progress for the focus
 * overlay. Returns short strings like "2 / 3 wins" or "Single, Double".
 */
export function questProgressLabel(id: string, p: QuestProgressState): string {
  if (p.completed) return "Complete";
  switch (id) {
    case QUEST_HOT_STREAK:
      return `${p.streak} / 3 in a row`;
    case QUEST_CHAIN_LIGHTNING:
      return "Need a 4+ chain in one batting hand";
    case QUEST_THE_CYCLE: {
      const labels: string[] = [];
      if (p.cycleBits & 1) labels.push("1B");
      if (p.cycleBits & 2) labels.push("2B");
      if (p.cycleBits & 4) labels.push("3B");
      if (p.cycleBits & 8) labels.push("HR");
      const remaining = 4 - labels.length;
      if (labels.length === 0) return "Need: 1B, 2B, 3B, HR";
      return `${labels.join(" • ")}  (${remaining} left)`;
    }
    case QUEST_POWER_SURGE:
      return `${p.homerCount} / 3 home runs`;
    case QUEST_COMEBACK_KING:
      return "Win a plate appearance while down 5+";
    case QUEST_WALK_OFF:
      return "Walk it off in the 9th or later";
    default:
      return "";
  }
}

/** Progress display 0..1 for strip UI */
export function questProgressRatio(id: string, p: QuestProgressState): number {
  if (p.completed) return 1;
  switch (id) {
    case QUEST_HOT_STREAK:
      return Math.min(1, p.streak / 3);
    case QUEST_CHAIN_LIGHTNING:
      return 0;
    case QUEST_THE_CYCLE: {
      const n = [1, 2, 4, 8].filter((b) => (p.cycleBits & b) !== 0).length;
      return n / 4;
    }
    case QUEST_POWER_SURGE:
      return Math.min(1, p.homerCount / 3);
    case QUEST_COMEBACK_KING:
      return 0;
    case QUEST_WALK_OFF:
      return 0;
    default:
      return 0;
  }
}
