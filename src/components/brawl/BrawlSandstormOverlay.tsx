/**
 * Sandstorm edge vignette — no labels; darkens from 5s before ticks until KO.
 */
import { motion } from "motion/react";

export interface BrawlSandstormOverlayProps {
  /** 0–1 edge darkness from sandstormEdgeVignetteIntensity. */
  intensity: number;
}

/** Clear-center radius (% of viewport) shrinks as intensity rises. */
function vignetteInnerStop(intensity: number): number {
  return 82 - intensity * 70;
}

/** Edge opacity ramps with intensity. */
function vignetteEdgeOpacity(intensity: number): number {
  return intensity * 0.92;
}

export function BrawlSandstormOverlay({ intensity }: BrawlSandstormOverlayProps) {
  if (intensity <= 0.001) return null;

  const innerStop = vignetteInnerStop(intensity);
  const edgeOpacity = vignetteEdgeOpacity(intensity);

  const vignette = `radial-gradient(
    ellipse 125% 110% at 50% 50%,
    transparent 0%,
    transparent ${innerStop}%,
    rgba(6, 4, 2, ${edgeOpacity * 0.5}) ${innerStop + 6}%,
    rgba(0, 0, 0, ${edgeOpacity}) 100%
  )`;

  return (
    <div
      className="fixed inset-0 z-[48] pointer-events-none select-none"
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={{ background: vignette }}
      />
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: edgeOpacity }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={{
          background: `
            linear-gradient(to bottom, rgba(0,0,0,${edgeOpacity * 0.9}) 0%, transparent ${10 + intensity * 22}%),
            linear-gradient(to top, rgba(0,0,0,${edgeOpacity * 0.9}) 0%, transparent ${10 + intensity * 22}%),
            linear-gradient(to right, rgba(0,0,0,${edgeOpacity * 0.75}) 0%, transparent ${6 + intensity * 18}%),
            linear-gradient(to left, rgba(0,0,0,${edgeOpacity * 0.75}) 0%, transparent ${6 + intensity * 18}%)
          `,
        }}
      />
    </div>
  );
}
