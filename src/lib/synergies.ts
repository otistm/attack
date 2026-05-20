/**
 * SZN Mode tag synergies. A tag threshold only counts players who are
 * **adjacent in roster order** — the active streak is the longest contiguous
 * block sharing that tag. Non-adjacent duplicates do not stack toward the
 * same synergy tier.
 *
 * Bonuses fold into the batter preview / lock-in score (and symmetrically
 * for the pitcher) via {@link teamBatterBonus} / {@link teamPitcherBonus}.
 */

import type { ClassTag, RosterPlayer } from "./run";

export interface SynergyThreshold {
  /** Minimum length of a contiguous same-tag block in roster order. */
  count: number;
  /** Flat bonus added to the batter's Final Score when active. */
  batterBonus: number;
  /** Flat bonus added to the pitcher's Final Score when active. */
  pitcherBonus: number;
  /** Player-facing label for the HUD chip. */
  label: string;
}

/**
 * Each tag declares a series of thresholds (smallest first). The active
 * threshold is the largest one whose `count` is <= the longest **adjacent**
 * run of that tag in roster order. Below the smallest threshold, dormant.
 */
export const SYNERGY_TIERS: Record<ClassTag, SynergyThreshold[]> = {
  Slugger: [
    { count: 2, batterBonus: 6, pitcherBonus: 0, label: "Sluggers x2 (+6 bat)" },
    { count: 3, batterBonus: 15, pitcherBonus: 0, label: "Sluggers x3 (+15 bat)" },
  ],
  Speedster: [
    { count: 2, batterBonus: 4, pitcherBonus: 0, label: "Speedsters x2 (+4 bat)" },
    { count: 3, batterBonus: 9, pitcherBonus: 0, label: "Speedsters x3 (+9 bat)" },
  ],
  Contact: [
    { count: 2, batterBonus: 4, pitcherBonus: 0, label: "Contact x2 (+4 bat)" },
    { count: 3, batterBonus: 10, pitcherBonus: 0, label: "Contact x3 (+10 bat)" },
  ],
  Veteran: [
    { count: 2, batterBonus: 3, pitcherBonus: 3, label: "Vets x2 (+3 both)" },
    { count: 3, batterBonus: 8, pitcherBonus: 8, label: "Vets x3 (+8 both)" },
  ],
  Rookie: [
    { count: 2, batterBonus: 5, pitcherBonus: 0, label: "Rookies x2 (+5 bat)" },
  ],
  Closer: [
    { count: 1, batterBonus: 0, pitcherBonus: 5, label: "Closer (+5 pit late)" },
  ],
  Starter: [
    { count: 1, batterBonus: 0, pitcherBonus: 4, label: "Starter (+4 pit)" },
  ],
  Control: [
    { count: 1, batterBonus: 0, pitcherBonus: 6, label: "Control (+6 pit)" },
  ],
  Strikeout: [
    { count: 1, batterBonus: 0, pitcherBonus: 7, label: "Strikeout (+7 pit)" },
  ],
  Groundball: [
    { count: 1, batterBonus: 0, pitcherBonus: 4, label: "Groundball (+4 pit)" },
  ],
};

export interface ActiveSynergy {
  tag: ClassTag;
  threshold: SynergyThreshold;
  /** Longest contiguous roster block with this tag that satisfies `threshold`. */
  count: number;
}

/**
 * For each class tag, the length of the longest consecutive run of that tag
 * in `roster` array order (bench order). Tags that never appear are omitted.
 */
export function longestAdjacentBlocksByTag(roster: RosterPlayer[]): Map<ClassTag, number> {
  const best = new Map<ClassTag, number>();
  const n = roster.length;
  if (n === 0) return best;
  let i = 0;
  while (i < n) {
    const tag = roster[i].tag;
    let j = i + 1;
    while (j < n && roster[j].tag === tag) j++;
    const run = j - i;
    best.set(tag, Math.max(best.get(tag) ?? 0, run));
    i = j;
  }
  return best;
}

export function activeSynergies(roster: RosterPlayer[]): ActiveSynergy[] {
  const longestRun = longestAdjacentBlocksByTag(roster);
  const out: ActiveSynergy[] = [];
  for (const [tag, adjCount] of longestRun) {
    const tiers = SYNERGY_TIERS[tag];
    if (!tiers) continue;
    let active: SynergyThreshold | null = null;
    for (const t of tiers) {
      if (adjCount >= t.count) active = t;
    }
    if (active) out.push({ tag, threshold: active, count: adjCount });
  }
  return out;
}

export function teamBatterBonus(roster: RosterPlayer[]): number {
  return activeSynergies(roster).reduce((acc, s) => acc + s.threshold.batterBonus, 0);
}

export function teamPitcherBonus(roster: RosterPlayer[]): number {
  return activeSynergies(roster).reduce((acc, s) => acc + s.threshold.pitcherBonus, 0);
}
