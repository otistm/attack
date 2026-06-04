/**
 * Card focus panel — positioned in layout above/below the card (Y), not via fixed portal.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { CardDefinition } from "../../lib/cards";
import { cardDisplayAbilityText, cardFocusCooldownSeconds } from "../../lib/cardFocusCopy";
import { CardElementActivationTags } from "./CardAbilityHeader";
import type { CardCooldownPulse } from "./BrawlAttackReveal";
import { SHAPE_LABEL } from "../cardShapes";
import { shapeToDefaultColor } from "../../lib/cardModel";

const GAP_ABOVE = "mb-4";
const GAP_BELOW = "mt-4";

export interface CardFocusOverlayProps {
  card: CardDefinition;
  visible: boolean;
  /** User hand: layout above card; opponent hand: layout below card. */
  placement?: "above" | "below";
  cooldown?: CardCooldownPulse;
  hand?: readonly CardDefinition[];
  affirmedSeams?: ReadonlySet<string> | null;
  gamepadFocused?: boolean;
}

function useCooldownRemaining(pulse: CardCooldownPulse | undefined) {
  const totalMs = pulse?.durationMs ?? 0;
  const remainingRef = useRef(totalMs);
  const frozenRef = useRef(!!pulse?.frozen);
  const [remainingMs, setRemainingMs] = useState(totalMs);

  useEffect(() => {
    if (!pulse) return;
    remainingRef.current = totalMs;
    setRemainingMs(totalMs);
    frozenRef.current = !!pulse.frozen;
  }, [pulse?.pulseKey, totalMs, pulse]);

  useEffect(() => {
    frozenRef.current = !!pulse?.frozen;
  }, [pulse?.frozen]);

  useEffect(() => {
    if (!pulse) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const paused = frozenRef.current && remainingRef.current > 0;
      if (!paused) {
        const dt = now - last;
        if (dt > 0) {
          remainingRef.current = Math.max(0, remainingRef.current - dt);
          setRemainingMs(remainingRef.current);
        }
      }
      last = now;
      if (remainingRef.current > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pulse?.pulseKey, totalMs, pulse]);

  return pulse ? remainingMs : null;
}

export function CardFocusOverlay({
  card,
  visible,
  placement = "above",
  cooldown,
  hand,
  affirmedSeams,
  gamepadFocused = false,
}: CardFocusOverlayProps) {
  const combatRemainingMs = useCooldownRemaining(visible ? cooldown : undefined);
  const ability = cardDisplayAbilityText(card);
  const cooldownSec = cardFocusCooldownSeconds(
    card.id,
    hand,
    affirmedSeams,
    cooldown != null ? combatRemainingMs : null,
  );

  const leftEl = SHAPE_LABEL[card.leftShape];
  const rightEl = SHAPE_LABEL[card.rightShape];

  const positionClass =
    placement === "above"
      ? `left-1/2 bottom-full -translate-x-1/2 ${GAP_ABOVE}`
      : `left-1/2 top-full -translate-x-1/2 ${GAP_BELOW}`;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={card.id}
          role="dialog"
          aria-label={`${card.name} details`}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className={`pointer-events-none absolute z-[80] w-[min(18rem,calc(100vw-1.5rem))] ${positionClass}`}
        >
          <div
            className={`overflow-hidden rounded-xl border shadow-2xl backdrop-blur-md ${
              gamepadFocused
                ? "border-amber-400/70 bg-gradient-to-b from-slate-900/98 to-slate-950/98 shadow-amber-500/20 ring-1 ring-amber-400/40"
                : "border-slate-500/60 bg-gradient-to-b from-slate-900/95 to-slate-950/98 shadow-black/50"
            }`}
          >
            <div
              className="h-1 w-full"
              style={{
                background: `linear-gradient(90deg, ${shapeToDefaultColor(card.leftShape)}, ${shapeToDefaultColor(card.rightShape)})`,
              }}
            />
            <div className="px-3.5 py-3 space-y-3">
              <header>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">
                  {leftEl} → {rightEl}
                </p>
                <h3 className="mt-1 text-base font-black tracking-tight text-white">
                  {card.name}
                </h3>
                <CardElementActivationTags
                  cardId={card.id}
                  hand={hand}
                  affirmedSeams={affirmedSeams}
                />
              </header>

              {ability ? (
                <section>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200/80">
                    Ability
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-100">
                    {ability}
                  </p>
                </section>
              ) : null}

              <section className="flex items-center justify-between gap-3 rounded-lg bg-black/35 px-2.5 py-2 ring-1 ring-white/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-300/80">
                  Cooldown
                </p>
                <span
                  className={`shrink-0 tabular-nums text-2xl font-black ${
                    cooldown?.frozen && cooldownSec > 0
                      ? "text-cyan-300"
                      : cooldownSec <= 0
                        ? "text-emerald-300"
                        : "text-amber-200"
                  }`}
                >
                  {cooldownSec}
                </span>
              </section>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
