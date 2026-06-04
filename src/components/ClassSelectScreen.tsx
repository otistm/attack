import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BRAWL_CLASS_OPTIONS,
  classOptionFor,
  type BrawlClass,
} from "../lib/elementClassPools";

export interface ClassSelectScreenProps {
  onSelect: (brawlClass: BrawlClass) => void;
}

const CLASS_VFX: Record<
  BrawlClass,
  { colors: string[]; glow: string; rim: string; particle: string }
> = {
  fire: {
    colors: ["#f97316", "#fb923c", "#ef4444", "#fcd34d"],
    glow: "rgba(249,115,22,0.42)",
    rim: "rgba(251,146,60,0.55)",
    particle: "rgba(251,146,60,0.75)",
  },
  freeze: {
    colors: ["#38bdf8", "#7dd3fc", "#e0f2fe", "#bae6fd"],
    glow: "rgba(56,189,248,0.38)",
    rim: "rgba(125,211,252,0.5)",
    particle: "rgba(186,230,253,0.7)",
  },
  poison: {
    colors: ["#a78bfa", "#8b5cf6", "#34d399", "#c4b5fd"],
    glow: "rgba(167,139,250,0.38)",
    rim: "rgba(139,92,246,0.5)",
    particle: "rgba(167,139,250,0.65)",
  },
  volt: {
    colors: ["#fbbf24", "#fde047", "#ffffff", "#f59e0b"],
    glow: "rgba(251,191,36,0.4)",
    rim: "rgba(253,224,71,0.55)",
    particle: "rgba(253,224,71,0.8)",
  },
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface AmbientParticle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
}

function useAmbientParticles(classId: BrawlClass, count: number): AmbientParticle[] {
  return useMemo(() => {
    const rng = mulberry32(classId.charCodeAt(0) * 997 + count);
    return Array.from({ length: count }, (_, id) => ({
      id,
      x: rng() * 100,
      y: rng() * 100,
      size: 2 + rng() * 4,
      delay: rng() * 4,
      duration: 4 + rng() * 5,
      drift: (rng() - 0.5) * 40,
    }));
  }, [classId, count]);
}

function ClassAmbientLayer({ classId }: { classId: BrawlClass }) {
  const vfx = CLASS_VFX[classId];
  const particles = useAmbientParticles(classId, 28);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={classId}
        className="pointer-events-none absolute inset-0 z-[1]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Element tint wash */}
        <motion.div
          className="absolute inset-0 mix-blend-screen"
          animate={{ opacity: [0.35, 0.55, 0.35] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          style={{
            background: `radial-gradient(ellipse 90% 70% at 30% 40%, ${vfx.glow}, transparent 65%)`,
          }}
        />
        <motion.div
          className="absolute inset-0 mix-blend-soft-light"
          animate={{ opacity: [0.2, 0.35, 0.2] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          style={{
            background: `radial-gradient(ellipse 60% 50% at 75% 60%, ${vfx.glow}, transparent 70%)`,
          }}
        />

        {/* Floating motes */}
        {particles.map((p) => (
          <motion.span
            key={p.id}
            className="absolute rounded-full blur-[0.5px]"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              background: vfx.particle,
              boxShadow: `0 0 ${p.size * 3}px ${vfx.particle}`,
            }}
            animate={{
              y: [0, -30 - p.drift, 0],
              x: [0, p.drift * 0.4, 0],
              opacity: [0, 0.85, 0],
              scale: [0.6, 1.2, 0.5],
            }}
            transition={{
              duration: p.duration,
              repeat: Infinity,
              delay: p.delay,
              ease: "easeInOut",
            }}
          />
        ))}

        {/* Light sweep */}
        <motion.div
          className="absolute inset-0 opacity-30 mix-blend-overlay"
          animate={{ x: ["-120%", "220%"] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear", repeatDelay: 3 }}
          style={{
            background: `linear-gradient(105deg, transparent 40%, ${vfx.rim} 50%, transparent 60%)`,
          }}
        />
      </motion.div>
    </AnimatePresence>
  );
}

function FilmGrain() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] opacity-[0.045] mix-blend-overlay"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundSize: "180px 180px",
      }}
    />
  );
}

function FrameCorners({ rimColor }: { rimColor: string }) {
  const corner =
    "absolute w-5 h-5 sm:w-7 sm:h-7 border-white/30 transition-colors duration-500";
  return (
    <>
      <motion.span
        className={`${corner} top-3 left-3 sm:top-5 sm:left-5 border-t-2 border-l-2`}
        style={{ borderColor: rimColor }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity }}
      />
      <motion.span
        className={`${corner} top-3 right-3 sm:top-5 sm:right-5 border-t-2 border-r-2`}
        style={{ borderColor: rimColor }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, delay: 0.6 }}
      />
      <motion.span
        className={`${corner} bottom-3 left-3 sm:bottom-5 sm:left-5 border-b-2 border-l-2`}
        style={{ borderColor: rimColor }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, delay: 1.2 }}
      />
      <motion.span
        className={`${corner} bottom-3 right-3 sm:bottom-5 sm:right-5 border-b-2 border-r-2`}
        style={{ borderColor: rimColor }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, delay: 1.8 }}
      />
    </>
  );
}

export function ClassSelectScreen({ onSelect }: ClassSelectScreenProps) {
  const [focusedId, setFocusedId] = useState<BrawlClass>(
    BRAWL_CLASS_OPTIONS[0].id,
  );
  const focused = classOptionFor(focusedId);
  const vfx = CLASS_VFX[focusedId];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black pointer-events-auto select-none">
      {/* Hero — full-bleed background (crossfade stack; avoids AnimatePresence enter bugs) */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {BRAWL_CLASS_OPTIONS.map((option) => {
          const isActive = option.id === focusedId;
          return (
            <motion.div
              key={option.id}
              className="absolute inset-0"
              initial={false}
              animate={{ opacity: isActive ? 1 : 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              style={{ zIndex: isActive ? 1 : 0 }}
              aria-hidden={!isActive}
            >
              <motion.img
                src={option.imageSrc}
                alt={option.mageName}
                loading="eager"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover object-[center_15%] sm:object-[center_20%]"
                animate={
                  isActive
                    ? { scale: [1, 1.05, 1], x: ["0%", "-1.5%", "0%"] }
                    : { scale: 1, x: "0%" }
                }
                transition={{
                  scale: { duration: 14, repeat: Infinity, ease: "easeInOut" },
                  x: { duration: 18, repeat: Infinity, ease: "easeInOut" },
                }}
              />
            </motion.div>
          );
        })}
      </div>

      <ClassAmbientLayer classId={focusedId} />

      {/* Readability overlays */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-r from-black/20 via-transparent to-black/75" />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/85 via-black/15 to-black/25" />

      <FilmGrain />

      {/* UI frame */}
      <div className="pointer-events-none absolute inset-3 sm:inset-5 z-[2] border border-white/10" />
      <motion.div
        className="pointer-events-none absolute inset-3 sm:inset-5 z-[2] border mix-blend-screen"
        animate={{ borderColor: [vfx.rim, "rgba(255,255,255,0.15)", vfx.rim] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="pointer-events-none absolute inset-3 sm:inset-5 z-[2]">
        <FrameCorners rimColor={vfx.rim} />
      </div>

      {/* Vignette pulse */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-[2]"
        animate={{ opacity: [0.6, 0.85, 0.6] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background:
            "radial-gradient(ellipse 80% 75% at 50% 45%, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Detail panel — right */}
      <aside className="absolute right-0 top-0 bottom-52 sm:bottom-56 z-[3] flex w-full max-w-md flex-col justify-center px-8 sm:px-12 pointer-events-none">
        <AnimatePresence mode="wait">
          <motion.div
            key={focused.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.3 }}
            className="text-right"
          >
            <motion.p
              className={`text-[11px] font-bold uppercase tracking-[0.35em] ${focused.accent}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              {focused.title}
            </motion.p>
            <motion.div
              className="mt-2 h-px ml-auto max-w-[12rem]"
              style={{ background: `linear-gradient(90deg, transparent, ${vfx.rim}, transparent)` }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: 0.12, duration: 0.4 }}
            />
            <motion.h2
              className="mt-2 text-5xl sm:text-6xl font-black uppercase tracking-tight text-white leading-[0.95]"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.35 }}
              style={{
                textShadow: `0 2px 24px rgba(0,0,0,0.9), 0 0 40px ${vfx.glow}`,
              }}
            >
              {focused.mageName}
            </motion.h2>
            <motion.p
              className="mt-5 text-sm sm:text-base leading-relaxed text-slate-200 max-w-sm ml-auto drop-shadow-[0_1px_12px_rgba(0,0,0,0.85)]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
            >
              {focused.bio}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </aside>

      {/* Agent strip — bottom */}
      <div className="absolute inset-x-0 bottom-0 z-[3] border-t border-white/10 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-4 sm:px-8 pb-10 sm:pb-12 pt-8">
        <div className="mx-auto flex max-w-6xl items-end justify-center gap-3 sm:gap-4">
          {BRAWL_CLASS_OPTIONS.map((option) => {
            const isFocused = option.id === focusedId;
            const optionVfx = CLASS_VFX[option.id];
            return (
              <div
                key={option.id}
                className="flex flex-col items-center gap-2"
              >
                {isFocused && (
                  <motion.button
                    type="button"
                    onClick={() => onSelect(option.id)}
                    className={`relative overflow-hidden px-6 py-2.5 text-xs font-black uppercase tracking-[0.25em] text-white border-2 bg-black/60 backdrop-blur-sm transition-colors hover:brightness-110 ${option.accentBorder}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ boxShadow: `0 0 24px ${optionVfx.glow}` }}
                  >
                    <motion.span
                      className="absolute inset-0 opacity-40"
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.5 }}
                      style={{
                        background:
                          "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                      }}
                    />
                    <span className="relative">Lock In</span>
                  </motion.button>
                )}

                <button
                  type="button"
                  onClick={() => setFocusedId(option.id)}
                  className={`group relative flex w-[8.5rem] sm:w-[10.5rem] flex-col overflow-hidden border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                    isFocused
                      ? `${option.accentBorder} brightness-110 scale-105`
                      : "border-white/15 opacity-70 hover:opacity-100 hover:border-white/35"
                  }`}
                  style={
                    isFocused
                      ? { boxShadow: `0 0 32px ${optionVfx.glow}, 0 0 8px ${optionVfx.rim}` }
                      : undefined
                  }
                >
                  {isFocused && (
                    <motion.div
                      className="absolute inset-0 z-10 pointer-events-none"
                      animate={{ opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      style={{
                        background: `linear-gradient(180deg, ${optionVfx.glow} 0%, transparent 45%)`,
                      }}
                    />
                  )}
                  <div className="aspect-[16/10] w-full overflow-hidden bg-slate-950 relative">
                    <img
                      src={option.imageSrc}
                      alt={option.mageName}
                      className={`h-full w-full object-cover object-[center_20%] transition-transform duration-300 ${
                        isFocused ? "scale-105" : "group-hover:scale-105"
                      }`}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    {/* Shimmer on hover / focus */}
                    <motion.div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{
                        background: `linear-gradient(115deg, transparent 35%, ${optionVfx.rim} 50%, transparent 65%)`,
                        backgroundSize: "200% 100%",
                      }}
                      animate={
                        isFocused
                          ? { backgroundPosition: ["200% 0", "-200% 0"] }
                          : undefined
                      }
                      transition={
                        isFocused
                          ? { duration: 2.5, repeat: Infinity, ease: "linear" }
                          : undefined
                      }
                    />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 px-1 py-2 text-center z-20">
                    <span className="block text-[10px] sm:text-xs font-black uppercase tracking-wider text-white drop-shadow-md">
                      {option.mageName}
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
