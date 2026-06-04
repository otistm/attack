import type { CardDefinition } from "../../lib/cards";
import {
  activeElementsOnCard,
  BRAWL_ELEMENT_BORDER,
  ELEMENT_LABEL,
  type Element,
} from "../../lib/brawlElements";
import { cardDisplayAbilityText } from "../../lib/cardFocusCopy";

const ACTIVATION_TAG_CLASS: Record<Element, string> = {
  fire: "text-red-900 bg-red-100/95 border-red-400/55",
  freeze: "text-sky-900 bg-sky-100/95 border-sky-400/55",
  volt: "text-amber-900 bg-amber-100/95 border-amber-400/55",
  poison: "text-violet-900 bg-violet-100/95 border-violet-400/55",
  shield: "text-yellow-900 bg-yellow-100/95 border-yellow-500/55",
  heal: "text-emerald-900 bg-emerald-100/95 border-emerald-400/55",
};

export function CardElementActivationTags({
  cardId,
  hand,
  affirmedSeams,
  compact = false,
}: {
  cardId: string;
  hand?: readonly CardDefinition[];
  affirmedSeams?: ReadonlySet<string> | null;
  compact?: boolean;
}) {
  const active = activeElementsOnCard(cardId, hand ?? [], affirmedSeams);
  if (!active.length) return null;

  const textClass = compact
    ? "text-[7px] leading-[1.1]"
    : "text-[8px] leading-[1.15]";

  return (
    <div className="mt-0.5 flex flex-wrap items-center justify-center gap-0.5 max-w-[92%]">
      {active.map((el) => (
        <span
          key={el}
          className={`${textClass} font-bold uppercase tracking-tight rounded px-1 py-0.5 text-center border shadow-sm ${ACTIVATION_TAG_CLASS[el]}`}
          style={{
            boxShadow: `0 0 6px ${BRAWL_ELEMENT_BORDER[el].shadowLow}`,
          }}
        >
          {ELEMENT_LABEL[el]} activated
        </span>
      ))}
    </div>
  );
}

export function cardBrawlAbilityTagline(card: CardDefinition): string | null {
  const raw = card.brawlTagline?.trim();
  if (!raw) return null;
  return cardDisplayAbilityText(card);
}
