/**
 * Lightweight Web Audio beeps for quest + brawl feedback (no asset files).
 *
 * Brawl additions: `snapTick` punctuates the final 5 seconds of the snap
 * timer so the player feels the squeeze; `snapLock` is the chime when
 * lockIn fires (auto or otherwise); `impactThud` is a short low-frequency
 * thump used by each attack beat during the reveal cascade.
 */
export type SfxKind =
  | "questTick"
  | "questComplete"
  | "legendary"
  | "snapTick"
  | "snapLock"
  | "impactThud";

interface SfxProfile {
  type: OscillatorType;
  /** Peak frequency in Hz. */
  freq: number;
  /** Optional pitch glide target. Linear sweep over `duration`. */
  freqEnd?: number;
  /** Peak gain. Keep below 0.1 so the beeps don't overpower voice. */
  vol: number;
  /** Total envelope length in seconds. */
  duration: number;
  /** Attack length (linear ramp up to vol). */
  attack: number;
}

const PROFILES: Record<SfxKind, SfxProfile> = {
  questTick: { type: "sine", freq: 330, vol: 0.035, duration: 0.11, attack: 0.02 },
  questComplete: { type: "sine", freq: 620, vol: 0.06, duration: 0.16, attack: 0.02 },
  legendary: { type: "sine", freq: 880, vol: 0.06, duration: 0.16, attack: 0.02 },
  // Snap timer ticks: short, dry, low gain so a rapid pulse never grates.
  snapTick: { type: "square", freq: 540, vol: 0.025, duration: 0.06, attack: 0.005 },
  // Lock chime: square -> sine glide so the resolution reads as commit.
  snapLock: { type: "triangle", freq: 720, freqEnd: 360, vol: 0.07, duration: 0.22, attack: 0.01 },
  // Impact thud: very low square downslope. Punchy but quick (~80ms).
  impactThud: { type: "sawtooth", freq: 180, freqEnd: 70, vol: 0.06, duration: 0.12, attack: 0.005 },
};

export function playSfx(kind: SfxKind): void {
  if (typeof window === "undefined") return;
  try {
    const profile = PROFILES[kind];
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = profile.type;
    osc.frequency.setValueAtTime(profile.freq, ctx.currentTime);
    if (profile.freqEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(
        profile.freqEnd,
        ctx.currentTime + profile.duration,
      );
    }
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      profile.vol,
      ctx.currentTime + profile.attack,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + profile.duration,
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + profile.duration + 0.02);
    osc.onended = () => void ctx.close();
  } catch {
    /* no audio — ignore */
  }
}
