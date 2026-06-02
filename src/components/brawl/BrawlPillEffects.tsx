import { motion, AnimatePresence } from "motion/react";

/** Flame flicker clipped to the HP fill region. */
export function BrawlPillFireAnimation({ widthPct }: { widthPct: number }) {
  if (widthPct <= 0) return null;
  return (
    <div
      className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none z-[4]"
      style={{ width: `${widthPct}%` }}
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute bottom-0 rounded-full blur-[1px]"
          style={{
            left: `${12 + i * 22}%`,
            width: 10 + (i % 2) * 4,
            height: 14 + (i % 3) * 6,
            background:
              "linear-gradient(to top, rgba(251,146,60,0.95), rgba(234,88,12,0.35), transparent)",
          }}
          animate={{
            y: [0, -10, -4, -14, 0],
            scaleY: [0.85, 1.15, 0.95, 1.2, 0.85],
            opacity: [0.55, 0.95, 0.7, 1, 0.55],
          }}
          transition={{
            duration: 0.55 + i * 0.12,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.08,
          }}
        />
      ))}
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: [0.15, 0.35, 0.15] }}
        transition={{ duration: 0.45, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(251,191,36,0.35), transparent)",
        }}
      />
    </div>
  );
}

/** Poison bubbles / drip clipped to the HP fill region. */
export function BrawlPillPoisonAnimation({ widthPct }: { widthPct: number }) {
  if (widthPct <= 0) return null;
  return (
    <div
      className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none z-[4]"
      style={{ width: `${widthPct}%` }}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border border-purple-300/40"
          style={{
            left: `${8 + i * 18}%`,
            bottom: 4 + (i % 2) * 6,
            width: 6 + (i % 3) * 3,
            height: 6 + (i % 3) * 3,
            background: "rgba(168,85,247,0.45)",
            boxShadow: "0 0 6px rgba(192,132,252,0.55)",
          }}
          animate={{
            y: [0, -12, -6, -16],
            x: [0, i % 2 === 0 ? 3 : -3, 0],
            opacity: [0.35, 0.85, 0.5, 0],
            scale: [0.8, 1.1, 0.95, 0.7],
          }}
          transition={{
            duration: 1.4 + i * 0.15,
            repeat: Infinity,
            ease: "easeOut",
            delay: i * 0.22,
          }}
        />
      ))}
      <motion.div
        className="absolute inset-x-0 bottom-0 h-1/2"
        animate={{ opacity: [0.2, 0.45, 0.2] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background:
            "linear-gradient(to top, rgba(147,51,234,0.5), transparent)",
        }}
      />
    </div>
  );
}

/** One-shot heal burst when HP is restored. */
export function BrawlPillHealAnimation({ pulseId }: { pulseId: number }) {
  if (pulseId <= 0) return null;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pulseId}
        className="absolute inset-0 pointer-events-none z-[5] rounded-full overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        aria-hidden="true"
      >
        <motion.div
          className="absolute inset-0 rounded-full"
          initial={{ scale: 0.4, opacity: 0.85 }}
          animate={{ scale: 1.55, opacity: 0 }}
          transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            background:
              "radial-gradient(circle, rgba(74,222,128,0.55) 0%, rgba(34,197,94,0.25) 45%, transparent 70%)",
          }}
        />
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-300/70"
            initial={{ width: 24, height: 24, opacity: 0.9 }}
            animate={{ width: 120 + i * 30, height: 120 + i * 30, opacity: 0 }}
            transition={{ duration: 0.7 + i * 0.12, ease: "easeOut", delay: i * 0.08 }}
          />
        ))}
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.5, 0] }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          style={{
            background:
              "linear-gradient(180deg, rgba(134,239,172,0.35), transparent 60%)",
          }}
        />
      </motion.div>
    </AnimatePresence>
  );
}

/** Translucent shield ring around the pill while absorb is active. */
export function BrawlPillShieldBorder({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <motion.div
      className="absolute -inset-[3px] rounded-full pointer-events-none z-20"
      initial={false}
      animate={{
        opacity: [0.5, 0.9, 0.5],
        boxShadow: [
          "0 0 0 2px rgba(250,204,21,0.35), 0 0 14px rgba(251,191,36,0.25)",
          "0 0 0 3px rgba(250,204,21,0.55), 0 0 22px rgba(251,191,36,0.45)",
          "0 0 0 2px rgba(250,204,21,0.35), 0 0 14px rgba(251,191,36,0.25)",
        ],
      }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden="true"
    />
  );
}
