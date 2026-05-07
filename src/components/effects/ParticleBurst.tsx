import { useMemo } from "react";
import { motion } from "motion/react";

export type ParticleBurstVariant = "tick" | "complete";

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
}

const VARIANT_CONFIG: Record<
  ParticleBurstVariant,
  { count: number; speed: number; gravity: number; spread: number }
> = {
  tick: { count: 14, speed: 120, gravity: 520, spread: 1.1 },
  complete: { count: 48, speed: 220, gravity: 380, spread: 1.35 },
};

function randomColor(palette: string[]): string {
  return palette[Math.floor(Math.random() * palette.length)]!;
}

export function ParticleBurst({
  variant,
  colors,
  className = "",
}: {
  variant: ParticleBurstVariant;
  colors: string[];
  className?: string;
}) {
  const cfg = VARIANT_CONFIG[variant];
  const particles = useMemo<Particle[]>(() => {
    const out: Particle[] = [];
    for (let i = 0; i < cfg.count; i++) {
      const angle = (Math.PI * 2 * i) / cfg.count + Math.random() * 0.5;
      const mag = cfg.speed * (0.35 + Math.random() * 0.65) * cfg.spread;
      out.push({
        id: i,
        x: 0,
        y: 0,
        vx: Math.cos(angle) * mag,
        vy: Math.sin(angle) * mag - (variant === "complete" ? 40 : 20),
        color: randomColor(colors),
        size: variant === "complete" ? 4 + Math.random() * 5 : 2 + Math.random() * 3,
      });
    }
    return out;
  }, [cfg.count, cfg.speed, cfg.spread, variant, colors.join()]);

  const duration = variant === "complete" ? 1.4 : 0.55;

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-1/2 w-px h-px overflow-visible ${className}`}
      aria-hidden
    >
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full will-change-transform"
          style={{
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            backgroundColor: p.color,
            boxShadow: `0 0 ${p.size}px ${p.color}`,
          }}
          initial={{ opacity: 1, x: 0, y: 0 }}
          animate={{
            opacity: [1, 1, 0],
            x: [0, p.vx * 0.45, p.vx * 0.9],
            y: [0, p.vy * 0.35 + cfg.gravity * 0.08, p.vy * 0.7 + cfg.gravity * 0.22],
          }}
          transition={{
            duration,
            ease: [0.22, 0.61, 0.36, 1],
            times: [0, 0.45, 1],
          }}
        />
      ))}
    </div>
  );
}
