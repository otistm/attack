/**
 * Brawl sudden-death sandstorm — ramps dual-side damage after combat stalls.
 */
import type { ElementCombatState } from "./brawlElements";

/** Countdown before sandstorm ticks begin (ms). */
export const BRAWL_SANDSTORM_WARNING_MS = 60_000;
/** Sandstorm damage interval — one ramp step per second. */
export const BRAWL_SANDSTORM_TICK_MS = 1000;
/** Cap per tick; reaching this ends the match instantly. */
export const BRAWL_SANDSTORM_MAX_TICK_DAMAGE = 600;

/** UI label for the overlay (optional status copy). */
export const BRAWL_SANDSTORM_LABEL = "Sandstorm";

/** Tick index at which the vignette reaches full screen invasion (~30s of storm). */
export const BRAWL_SANDSTORM_VIGNETTE_FULL_TICK = 30;

/** 0–1 vignette strength from sandstorm tick count (subtle early, closes in over time). */
export function sandstormVignetteIntensity(tickIndex: number): number {
  const n = Math.max(0, Math.floor(tickIndex));
  if (n <= 0) return 0;
  const linear = n / BRAWL_SANDSTORM_VIGNETTE_FULL_TICK;
  // Ease-in so early ticks stay subtle, later ticks accelerate inward.
  return Math.min(1, linear * linear * 0.35 + linear * 0.65);
}

/** Tick 1 → 1, tick 2 → 2, tick 3 → 3 … (+1 HP per second). */
export function sandstormTickDamage(tickIndex: number): number {
  const n = Math.max(1, Math.floor(tickIndex));
  return Math.min(n, BRAWL_SANDSTORM_MAX_TICK_DAMAGE);
}

/** Both sides still alive — sandstorm may activate. */
export function shouldActivateSandstorm(state: ElementCombatState): boolean {
  return state.playerHP > 0 && state.cpuHP > 0;
}

/** Progress toward sandstorm (0–1) from combat start elapsed ms. */
export function sandstormProgressFromElapsed(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.min(1, elapsedMs / BRAWL_SANDSTORM_WARNING_MS);
}

/**
 * Apply one sandstorm tick to both sides. Bypasses shield — raw HP loss.
 */
export function applySandstormTick(
  state: ElementCombatState,
  tickIndex: number,
): { next: ElementCombatState; damage: number; instantEnd: boolean } {
  const damage = sandstormTickDamage(tickIndex);
  const instantEnd = damage >= BRAWL_SANDSTORM_MAX_TICK_DAMAGE;
  const next: ElementCombatState = {
    ...state,
    playerHP: Math.max(0, state.playerHP - damage),
    cpuHP: Math.max(0, state.cpuHP - damage),
  };
  return { next, damage, instantEnd };
}
