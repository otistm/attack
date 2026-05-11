/**
 * SZN Mode tag synergies. When the user's roster carries N copies of a
 * given `ClassTag`, a global team buff applies during combat. The buff is
 * folded into the BATTER side's preview / lock-in score (and symmetrically
 * for the pitcher) so the player feels the lineup-construction reward.
 */

import type { ClassTag, RosterPlayer } from "./run";

export interface SynergyThreshold {
  /** Minimum count of players with this tag on the roster. */
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
 * threshold is the largest one whose `count` is <= the number of carriers
 * on the roster. Below the smallest threshold, the synergy is dormant.
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
  count: number;
}

export function activeSynergies(roster: RosterPlayer[]): ActiveSynergy[] {
  const counts = new Map<ClassTag, number>();
  for (const r of roster) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
  const out: ActiveSynergy[] = [];
  for (const [tag, count] of counts) {
    const tiers = SYNERGY_TIERS[tag];
    if (!tiers) continue;
    let active: SynergyThreshold | null = null;
    for (const t of tiers) {
      if (count >= t.count) active = t;
    }
    if (active) out.push({ tag, threshold: active, count });
  }
  return out;
}

export function teamBatterBonus(roster: RosterPlayer[]): number {
  return activeSynergies(roster).reduce((acc, s) => acc + s.threshold.batterBonus, 0);
}

export function teamPitcherBonus(roster: RosterPlayer[]): number {
  return activeSynergies(roster).reduce((acc, s) => acc + s.threshold.pitcherBonus, 0);
}
