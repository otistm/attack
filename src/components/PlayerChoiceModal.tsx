import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGameStore, USER_SIDE } from '../lib/gameStore';
import { ALL_CARDS, CardDefinition } from '../lib/cards';
import type { PendingChoice, ResolvedChoice } from '../lib/gameStore';
import { SHAPE_COLORS, SHAPE_DEFAULTS, ShapeType } from './cardShapes';

/**
 * Modal that surfaces pending player-choice questions queued by the engine
 * (b-12 Switch Hitter, b-65 Guess Pitch, p-56 Pinpoint Control). Shows one
 * question at a time -- when the player resolves it, gameStore.resolveChoice
 * mutates state and the next pending choice (if any) takes over.
 *
 * Only choices belonging to the user's seat (`USER_SIDE`) are surfaced.
 * Opponent-side choices (e.g. p-56 Pinpoint Control while the user bats) are
 * suppressed and silently default to "AI declined" -- showing them would let
 * the batter both see and trigger the pitcher's strategic moves.
 *
 * `pickShape` choices that carry a `targets` list render the multi-step
 * wizard: pick which of YOUR cards to modify, pick which side, pick the new
 * shape. `guessShape` (b-65) keeps the original single-row layout.
 */
export function PlayerChoiceModal() {
  const pendingChoices = useGameStore((s) => s.pendingChoices);
  const phase = useGameStore((s) => s.phase);
  const resolveChoice = useGameStore((s) => s.resolveChoice);
  const batterHand = useGameStore((s) => s.batterHand);
  const pitcherHand = useGameStore((s) => s.pitcherHand);

  // Restrict the visible queue to the user's seat. We still call resolveChoice
  // by cardId, so the engine path is unchanged for any opponent-side prompt
  // we might decide to auto-resolve via AI later.
  const userChoice = useMemo(
    () => pendingChoices.find((c) => c.side === USER_SIDE) ?? null,
    [pendingChoices],
  );

  const open = phase === 'selecting' && userChoice !== null;
  const choice = userChoice;

  return (
    <AnimatePresence>
      {open && choice && (
        <ChoicePanel
          key={`${choice.cardId}-${choice.type}`}
          choice={choice}
          batterHand={batterHand}
          pitcherHand={pitcherHand}
          onResolve={(value) => resolveChoice(choice.cardId, value)}
        />
      )}
    </AnimatePresence>
  );
}

interface ChoicePanelProps {
  choice: PendingChoice;
  batterHand: CardDefinition[];
  pitcherHand: CardDefinition[];
  onResolve: (value: ResolvedChoice) => void;
}

function ChoicePanel({ choice, batterHand, pitcherHand, onResolve }: ChoicePanelProps) {
  const card = ALL_CARDS.find((c) => c.id === choice.cardId);
  const promptCopy = PROMPTS[choice.type] ?? 'Make a choice';

  // Source the eligible target cards from the live hand the prompting card
  // belongs to -- a fresh lookup so we always reflect any pre-modal mutations
  // (e.g. a future card that resizes the hand mid-at-bat).
  const sourceHand = choice.side === 'Batting' ? batterHand : pitcherHand;
  const targetCards: CardDefinition[] = useMemo(() => {
    if (!choice.targets) return [];
    const lookup = new Map(sourceHand.map((c) => [c.id, c]));
    return choice.targets
      .map((id) => lookup.get(id))
      .filter((c): c is CardDefinition => Boolean(c));
  }, [choice.targets, sourceHand]);

  const isModifyShape = choice.type === 'pickShape' && targetCards.length > 0;

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2 } }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
    >
      <motion.div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl p-6"
        initial={{ scale: 0.85, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1, transition: { type: 'spring', stiffness: 240, damping: 22 } }}
        exit={{ scale: 0.85, y: 20, opacity: 0, transition: { duration: 0.16 } }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className={`text-[10px] uppercase font-black tracking-widest text-white px-2 py-1 rounded ${card?.color ?? 'bg-slate-700'}`}>
            {choice.side}
          </div>
          <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
            {card?.abilityType === 'General Draw' ? 'General' : 'Signature'}
          </div>
        </div>
        <h2 className="text-xl font-black text-white leading-tight mb-1">{card?.name}</h2>
        <p className="text-xs text-slate-400 leading-relaxed mb-4">{card?.description}</p>

        {isModifyShape ? (
          <ModifyShapePanel
            promptCopy={promptCopy}
            targetCards={targetCards}
            onCommit={(payload) => onResolve(payload)}
          />
        ) : (
          <>
            <div className="text-[11px] uppercase font-bold tracking-widest text-amber-400 mb-2">
              {promptCopy}
            </div>
            {choice.type === 'guessShape' || choice.type === 'pickShape' ? (
              <ShapeOptionRow
                options={(choice.options ?? []) as ShapeType[]}
                onPick={(shape) => onResolve({ kind: 'shape', shape })}
              />
            ) : (
              <GenericOptionRow
                options={choice.options ?? []}
                onPick={(value) => onResolve({ kind: 'shape', shape: value as ShapeType })}
              />
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

const PROMPTS: Record<PendingChoice['type'], string> = {
  guessShape: 'Name a shape — if the pitcher uses it, +4 Value',
  pickShape: 'Pick a card to modify',
  pickGeneral: 'Pick a general card',
  pickConnection: 'Pick a connection to break',
};

// ---------------------------------------------------------------------------
// 3-step wizard: card -> side -> shape.
// ---------------------------------------------------------------------------

const SHAPE_PICK_OPTIONS: ShapeType[] = ['circle', 'diamond', 'square', 'star'];

type WizardStep = 'card' | 'side' | 'shape';

interface ModifyShapePanelProps {
  promptCopy: string;
  targetCards: CardDefinition[];
  onCommit: (payload: ResolvedChoice) => void;
}

function ModifyShapePanel({ promptCopy, targetCards, onCommit }: ModifyShapePanelProps) {
  const [step, setStep] = useState<WizardStep>('card');
  const [pickedCardId, setPickedCardId] = useState<string | null>(null);
  const [pickedSide, setPickedSide] = useState<'left' | 'right' | null>(null);

  const pickedCard = pickedCardId ? targetCards.find((c) => c.id === pickedCardId) : null;

  const stepLabel =
    step === 'card'
      ? promptCopy
      : step === 'side'
        ? 'Pick which side to change'
        : 'Pick the new shape';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase font-bold tracking-widest text-amber-400">
          {stepLabel}
        </div>
        <StepDots step={step} />
      </div>

      <AnimatePresence mode="wait">
        {step === 'card' && (
          <motion.div
            key="card"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15 }}
            className="grid grid-cols-3 gap-2"
          >
            {targetCards.map((c) => (
              <CardThumb
                key={c.id}
                card={c}
                onClick={() => {
                  setPickedCardId(c.id);
                  setStep('side');
                }}
              />
            ))}
          </motion.div>
        )}

        {step === 'side' && pickedCard && (
          <motion.div
            key="side"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            <SelectedCardBanner card={pickedCard} highlight={null} />
            <div className="grid grid-cols-2 gap-2">
              <SideButton
                label="Left"
                shape={pickedCard.leftShape}
                onClick={() => {
                  setPickedSide('left');
                  setStep('shape');
                }}
              />
              <SideButton
                label="Right"
                shape={pickedCard.rightShape}
                onClick={() => {
                  setPickedSide('right');
                  setStep('shape');
                }}
              />
            </div>
            <BackButton onClick={() => setStep('card')} label="Back to cards" />
          </motion.div>
        )}

        {step === 'shape' && pickedCard && pickedSide && (
          <motion.div
            key="shape"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            <SelectedCardBanner card={pickedCard} highlight={pickedSide} />
            <div className="grid grid-cols-4 gap-2">
              {SHAPE_PICK_OPTIONS.map((shape) => (
                <ShapeButton
                  key={shape}
                  shape={shape}
                  onClick={() =>
                    onCommit({
                      kind: 'modifyShape',
                      targetCardId: pickedCard.id,
                      side: pickedSide,
                      shape,
                    })
                  }
                />
              ))}
            </div>
            <BackButton onClick={() => setStep('side')} label="Back to side" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepDots({ step }: { step: WizardStep }) {
  const order: WizardStep[] = ['card', 'side', 'shape'];
  return (
    <div className="flex items-center gap-1">
      {order.map((s, i) => {
        const reached = order.indexOf(step) >= i;
        return (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all ${reached ? 'bg-amber-400 w-5' : 'bg-slate-700 w-2'}`}
          />
        );
      })}
    </div>
  );
}

function CardThumb({ card, onClick }: { card: CardDefinition; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-slate-800 hover:bg-slate-700 active:scale-95 rounded-lg border border-slate-700 hover:border-amber-400 p-2 flex flex-col gap-1.5 text-left transition-all"
    >
      <div className="flex items-center justify-between">
        <span className={`text-[8px] uppercase font-black tracking-widest text-white px-1 py-0.5 rounded ${card.color}`}>
          {card.abilityType === 'General Draw' ? 'General' : 'Sig'}
        </span>
        <span className="text-sm font-black text-white tabular-nums">{card.baseValue}</span>
      </div>
      <span className="text-[10px] font-bold text-slate-200 leading-tight line-clamp-2 min-h-[24px]">
        {card.name}
      </span>
      <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-700">
        <ShapeMini shape={card.leftShape} />
        <span className="text-[8px] text-slate-500 font-bold">L · R</span>
        <ShapeMini shape={card.rightShape} />
      </div>
    </button>
  );
}

function SelectedCardBanner({ card, highlight }: { card: CardDefinition; highlight: 'left' | 'right' | null }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/60 border border-slate-700 rounded-lg p-2.5">
      <span className={`text-[9px] uppercase font-black tracking-widest text-white px-1.5 py-0.5 rounded ${card.color}`}>
        {card.abilityType === 'General Draw' ? 'General' : 'Sig'}
      </span>
      <span className="text-sm font-bold text-white flex-1 truncate">{card.name}</span>
      <div className="flex items-center gap-1">
        <ShapeMini shape={card.leftShape} highlighted={highlight === 'left'} />
        <span className="text-[8px] text-slate-500 font-bold">/</span>
        <ShapeMini shape={card.rightShape} highlighted={highlight === 'right'} />
      </div>
    </div>
  );
}

function SideButton({ label, shape, onClick }: { label: string; shape: ShapeType; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-slate-800 hover:bg-slate-700 active:scale-95 rounded-lg border border-slate-700 hover:border-amber-400 px-4 py-3 flex items-center justify-between transition-all"
    >
      <div className="flex flex-col items-start">
        <span className="text-[10px] uppercase font-black text-amber-400 tracking-widest">{label}</span>
        <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wide mt-0.5">
          currently {shape}
        </span>
      </div>
      <ShapeMini shape={shape} large />
    </button>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] uppercase font-bold tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
    >
      ← {label}
    </button>
  );
}

function ShapeMini({ shape, highlighted = false, large = false }: { shape: ShapeType; highlighted?: boolean; large?: boolean }) {
  const size = large ? 'w-8 h-8' : 'w-4 h-4';
  if (shape === 'none') {
    return (
      <div
        className={`${size} rounded border border-dashed border-slate-600 ${highlighted ? 'ring-2 ring-amber-400' : ''}`}
      />
    );
  }
  const color = SHAPE_COLORS[shape];
  const { rotate, baseScale, borderRadius, clipPath } = SHAPE_DEFAULTS[shape];
  return (
    <div className={`${size} flex items-center justify-center ${highlighted ? 'ring-2 ring-amber-400 rounded' : ''}`}>
      <div
        className="w-full h-full"
        style={{
          backgroundColor: color,
          borderRadius,
          clipPath,
          transform: `rotate(${rotate}deg) scale(${baseScale})`,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-row pickers (b-65 guess + future generic options).
// ---------------------------------------------------------------------------

function ShapeOptionRow({ options, onPick }: { options: ShapeType[]; onPick: (value: ShapeType) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map((shape) => (
        <ShapeButton key={shape} shape={shape} onClick={() => onPick(shape)} />
      ))}
    </div>
  );
}

function ShapeButton({ shape, onClick }: { shape: ShapeType; onClick: () => void }) {
  if (shape === 'none' || shape === 'wildcard') {
    return (
      <button
        onClick={onClick}
        className="aspect-square bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 hover:border-slate-500 flex flex-col items-center justify-center gap-1 transition-colors"
      >
        <span className="text-[10px] uppercase font-black text-slate-300 tracking-wider">{shape}</span>
      </button>
    );
  }
  const color = SHAPE_COLORS[shape];
  const { rotate, baseScale, borderRadius, clipPath } = SHAPE_DEFAULTS[shape];
  return (
    <button
      onClick={onClick}
      className="aspect-square bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 hover:border-amber-400 flex flex-col items-center justify-center gap-1 transition-colors group"
    >
      <div
        className="w-9 h-9 transition-transform group-hover:scale-110"
        style={{
          backgroundColor: color,
          borderRadius,
          clipPath,
          transform: `rotate(${rotate}deg) scale(${baseScale})`,
        }}
      />
      <span className="text-[9px] uppercase font-black text-slate-400 tracking-widest">{shape}</span>
    </button>
  );
}

function GenericOptionRow({ options, onPick }: { options: string[]; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onPick(opt)}
          className="px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 hover:border-slate-500 text-sm font-bold text-slate-200 hover:text-white transition-colors text-left"
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
