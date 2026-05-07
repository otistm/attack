/**
 * Lightweight Web Audio beeps for quest feedback (no asset files).
 */
export function playSfx(kind: "questTick" | "questComplete" | "legendary"): void {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const peak =
      kind === "legendary" ? 880 : kind === "questComplete" ? 620 : 330;
    osc.frequency.setValueAtTime(peak, ctx.currentTime);
    const vol = kind === "questTick" ? 0.035 : 0.06;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === "questTick" ? 0.09 : 0.14));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + (kind === "questTick" ? 0.11 : 0.16));
    osc.onended = () => void ctx.close();
  } catch {
    /* no audio — ignore */
  }
}
