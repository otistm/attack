/**
 * Sandstorm active-state visuals — dark edge vignette that closes in as ticks ramp.
 */
import { motion } from "motion/react";
import { sandstormVignetteIntensity } from "../../lib/brawlSandstorm";

export interface BrawlSandstormOverlayProps {
  /** True once dual-side damage ticks are running (after 60s combat). */
  active: boolean;
  /** Current tick index — drives how far the vignette invades. */
  tickIndex: number;
}

/** Clear-center radius (% of viewport) shrinks as intensity rises. */
function vignetteInnerStop(intensity: number): number {
  return 78 - intensity * 62;
}

/** Edge opacity ramps with intensity. */
function vignetteEdgeOpacity(intensity: number): number {
  return 0.22 + intensity * 0.68;
}

export function BrawlSandstormOverlay({
  active,
  tickIndex,
}: BrawlSandstormOverlayProps) {
  if (!active || tickIndex <= 0) return null;

  const intensity = sandstormVignetteIntensity(tickIndex);
  const innerStop = vignetteInnerStop(intensity);
  const edgeOpacity = vignetteEdgeOpacity(intensity);

  const vignette = `radial-gradient(
    ellipse 120% 100% at 50% 50%,
    transparent 0%,
    transparent ${innerStop}%,
    rgba(8, 6, 4, ${edgeOpacity * 0.55}) ${innerStop + 8}%,
    rgba(0, 0, 0, ${edgeOpacity}) 100%
  )`;

  return (
    <div
      className="fixed inset-0 z-[48] pointer-events-none select-none"
      aria-live="polite"
      aria-label="Sandstorm"
    >
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        style={{ background: vignette }}
      />
      {/* Extra edge weight on all four sides — reads as invasion, not just oval fade */}
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: edgeOpacity }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{
          background: `
            linear-gradient(to bottom, rgba(0,0,0,${edgeOpacity * 0.85}) 0%, transparent ${12 + intensity * 18}%),
            linear-gradient(to top, rgba(0,0,0,${edgeOpacity * 0.85}) 0%, transparent ${12 + intensity * 18}%),
            linear-gradient(to right, rgba(0,0,0,${edgeOpacity * 0.7}) 0%, transparent ${8 + intensity * 14}%),
            linear-gradient(to left, rgba(0,0,0,${edgeOpacity * 0.7}) 0%, transparent ${8 + intensity * 14}%)
          `,
        }}
      />
    </div>
  );
}
