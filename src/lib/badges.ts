/**
 * Passive Badge registry.
 *
 * Badges are persistent passive effects the player accumulates across a SZN
 * run. Every team grants one starting badge; future content (events, story
 * beats, season-long quests) will let the player acquire additional badges
 * mid-run. Badges render as chips in the RunHud beside the week pill.
 *
 * The trigger system is a discriminated union so each new badge declares the
 * gameplay hook it cares about. The scoring + matchup pipeline iterates
 * `run.badges`, branches on `trigger.kind`, and applies effects against the
 * `SnapEvent[]` produced by `scoreGroup` (see `scoring.ts`).
 */

import type { ClassTag } from "./run";
import type { SznEdgeId } from "./sznEdges";

export type BadgeId =
  /** Yankees starting passive (+10 score / +$1 next-week cash per Power snap). */
  | "bronx-bombers"
  /** Phillies starting passive (+5 score / +$1 next-week cash per Power snap). */
  | "liberty-bell"
  /** Blue Jays starting passive (+5 score / +1 Hit Scale per Contact snap). */
  | "north-of-the-border"
  /** Placeholder badge for the 27 stub teams until each team's passive is designed. */
  | "tbd-passive";

/**
 * Trigger definitions. Each badge instance carries a literal effect payload
 * so balancing knobs live on the badge, not in scoring code.
 *
 *  - `onSznSnap`            : fires per qualifying snap event during scoring.
 *  - `onClassTagAdjacency`  : reserved for roster-level synergy badges (NYI).
 *  - `passive`              : flavor-only, no runtime effect (e.g. stub teams).
 */
export type BadgeTrigger =
  | {
      kind: "onSznSnap";
      edge: SznEdgeId;
      /** Added to the snap's side match score per occurrence. */
      scoreBonus: number;
      /** Queued into RunState.nextWeekCashBonus per occurrence. */
      nextWeekCashBonus: number;
      /**
       * Added to the snap's side Hit Scale bonus per occurrence. Optional
       * because the original Bronx Bombers badge only declared score +
       * cash; teams designed around Contact / Patience identity (e.g.
       * north-of-the-border) lean on Hit Scale instead.
       */
      hitScaleBonus?: number;
    }
  | {
      kind: "onClassTagAdjacency";
      tag: ClassTag;
      scoreBonus: number;
    }
  | {
      kind: "passive";
      description: string;
    };

export interface BadgeDefinition {
  id: BadgeId;
  /** Display name (e.g. "The Bronx Bombers"). */
  name: string;
  /** One-line flavor for the tooltip. */
  flavor: string;
  /** Short single emoji or lucide icon name for the chip. */
  icon: string;
  /** Tailwind-friendly hex tint for chip border + glow. */
  tint: string;
  trigger: BadgeTrigger;
}

export const BADGES: Record<BadgeId, BadgeDefinition> = {
  "bronx-bombers": {
    id: "bronx-bombers",
    name: "The Bronx Bombers",
    flavor:
      "Whenever a Power edge successfully snaps, gain +10 Bonus Match Score and receive +$1 Budget for the following week.",
    icon: "💣",
    tint: "#0c1a4a",
    trigger: {
      kind: "onSznSnap",
      edge: "power",
      scoreBonus: 10,
      nextWeekCashBonus: 1,
    },
  },
  "liberty-bell": {
    id: "liberty-bell",
    name: "Liberty Bell",
    flavor:
      "Whenever a Power edge successfully snaps, gain +5 Bonus Match Score and receive +$1 Budget for the following week.",
    icon: "🔔",
    tint: "#e81828",
    trigger: {
      kind: "onSznSnap",
      edge: "power",
      scoreBonus: 5,
      nextWeekCashBonus: 1,
    },
  },
  "north-of-the-border": {
    id: "north-of-the-border",
    name: "North of the Border",
    flavor:
      "Whenever a Contact edge successfully snaps, gain +5 Bonus Match Score and +1 Hit Scale.",
    icon: "🍁",
    tint: "#134a8e",
    trigger: {
      kind: "onSznSnap",
      edge: "contact",
      scoreBonus: 5,
      nextWeekCashBonus: 0,
      hitScaleBonus: 1,
    },
  },
  "tbd-passive": {
    id: "tbd-passive",
    name: "Team Passive",
    flavor: "This team's passive ability is still in design. Coming soon.",
    icon: "❓",
    tint: "#475569",
    trigger: { kind: "passive", description: "Placeholder badge." },
  },
};

/** Convenience: look up a badge definition by id (with safe undefined). */
export function getBadge(id: BadgeId): BadgeDefinition | undefined {
  return BADGES[id];
}

/** Type-narrowing helper so consumers can filter to the snap-trigger branch. */
export function isSnapTrigger(
  trigger: BadgeTrigger,
): trigger is Extract<BadgeTrigger, { kind: "onSznSnap" }> {
  return trigger.kind === "onSznSnap";
}
