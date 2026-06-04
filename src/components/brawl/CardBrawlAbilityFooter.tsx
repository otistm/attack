import { motion } from "motion/react";
import type { CardDefinition } from "../../lib/cards";
import { cardBrawlFooterClassName } from "../../lib/cardDisplay";
import { activeElementsOnCard } from "../../lib/brawlElements";
import {
  CardElementActivationTags,
  cardBrawlAbilityTagline,
} from "./CardAbilityHeader";

export function CardBrawlAbilityFooter({
  card,
  hand,
  affirmedSeams,
  compact = false,
  onColoredBody = false,
  highlightTone,
  hidden = false,
}: {
  card: CardDefinition;
  hand?: readonly CardDefinition[];
  affirmedSeams?: ReadonlySet<string> | null;
  compact?: boolean;
  onColoredBody?: boolean;
  highlightTone?: "source" | "target" | null;
  hidden?: boolean;
}) {
  if (hidden) return null;

  const tagline = cardBrawlAbilityTagline(card);
  const active = activeElementsOnCard(card.id, hand ?? [], affirmedSeams);
  if (!tagline && !active.length) return null;

  const taglineClass = compact
    ? "text-[7px] leading-[1.1]"
    : "text-[9px] leading-[1.15]";

  return (
    <motion.div
      key={highlightTone === "source" ? `brawl-footer-${highlightTone}` : "brawl-footer-idle"}
      className={`absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-0.5 text-center w-full ${cardBrawlFooterClassName(compact, onColoredBody)}`}
      animate={
        highlightTone === "source"
          ? {
              backgroundColor: [
                "rgba(255,255,255,0.95)",
                "rgba(254,243,199,0.98)",
                "rgba(255,255,255,0.95)",
              ],
              scale: [1, 1.04, 1.02],
              x: [0, -2, 2, -1, 1, 0],
              boxShadow: [
                "0 1px 2px rgba(0,0,0,0.08)",
                "0 0 14px 4px rgba(250,204,21,0.55)",
                "0 1px 2px rgba(0,0,0,0.08)",
              ],
            }
          : { scale: 1, x: 0 }
      }
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <CardElementActivationTags
        cardId={card.id}
        hand={hand}
        affirmedSeams={affirmedSeams}
        compact={compact}
        inFooter
      />
      {tagline ? (
        <motion.span
          className={`${taglineClass} font-bold uppercase tracking-tight text-amber-900 bg-amber-200/95 rounded px-1 py-0.5 max-w-[96%] border border-amber-400/60 shadow-sm line-clamp-2`}
          animate={
            highlightTone === "source"
              ? {
                  backgroundColor: [
                    "rgba(254,243,199,0.95)",
                    "rgba(250,204,21,0.98)",
                    "rgba(254,243,199,0.95)",
                  ],
                  scale: [1, 1.12, 1.04],
                }
              : { scale: 1 }
          }
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {tagline}
        </motion.span>
      ) : null}
    </motion.div>
  );
}
