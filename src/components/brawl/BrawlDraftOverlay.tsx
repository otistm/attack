import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGameStore, BRAWL_DRAFT_TITLES } from "../../lib/gameStore";
import { SESSION_CARDS, type CardDefinition } from "../../lib/cards";
import { CardItem } from "../CardGameOverlay";

/**
 * Inning-start "concessions" draft overlay.
 *
 * Brawl Mode hands the user only 15 general-draw cards to start. At
 * the top of each inning we present three random cards from the rest
 * of the brawl pool and let the user pick one to permanently add to
 * their pool. The screen is intentionally austere -- no body copy
 * beyond "Pick one" -- to match the snap-rip tempo of the rest of
 * the brawl arena: read fast, pick fast, get back to the field.
 *
 * Lifecycle:
 *   1. Renders whenever `brawlDraftChoice` is non-null and game is in brawl.
 *   2. User clicks a card -> local `pickedId` is set.
 *   3. The clicked card animates off-screen (translateY -120vh, slight
 *      rotation, fade out) like it's been tossed toward the dugout.
 *      The other two cards fade + scale down so the picked card is
 *      visually the only thing leaving the field.
 *   4. When the fly-off transition completes, we call
 *      `selectBrawlDraftCard(cardId)`. That action appends the card to
 *      `brawlUserPool`, clears `brawlDraftChoice`, and re-anchors
 *      `brawlSnapStartedAt`. The store mutation unmounts this overlay
 *      via the outer `AnimatePresence` exit transition.
 *
 * The snap timer is suppressed in the parent while a draft is live
 * (see `CardGameOverlay`), so the user has unlimited time to pick.
 *
 * Visually the three pickables render through `CardItem` -- the same
 * component the in-hand strip uses -- so the draft cards match
 * pixel-for-pixel what the user will see in their hand the moment
 * they pick. We wrap each `CardItem` in a `motion.button` so the
 * click target + fly-off animation live OUTSIDE the shared component
 * (CardItem is a static read of card state; the overlay-specific
 * choreography lives here).
 */
export function BrawlDraftOverlay() {
  const gameMode = useGameStore((s) => s.gameMode);
  const phase = useGameStore((s) => s.phase);
  const draft = useGameStore((s) => s.brawlDraftChoice);
  const selectBrawlDraftCard = useGameStore((s) => s.selectBrawlDraftCard);
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Resolve the three card IDs to live CardDefinitions every render.
  // SESSION_CARDS is small (a few hundred entries) so the lookup is
  // cheap and the indirection means we always pick up the
  // run-randomized shapes / brawl tagline stamped at module load.
  const cards = useMemo<CardDefinition[]>(() => {
    if (!draft) return [];
    return draft.cardIds
      .map((id) => SESSION_CARDS.find((c) => c.id === id))
      .filter((c): c is CardDefinition => !!c);
  }, [draft]);

  // Title per inning. Falls back to "Card Draft" for an out-of-range
  // inning value -- only fires in dev / when the brawl loop is
  // tweaked, never in a real 3-inning brawl run.
  const title = draft ? BRAWL_DRAFT_TITLES[draft.inning] ?? "Card Draft" : "";

  // The overlay's mount-unmount is driven by `draft != null`, so the
  // local `pickedId` is naturally reset whenever a new draft begins
  // (the previous draft cleared `pickedId === <id>` on its way out,
  // then the next draft mounts a fresh instance via AnimatePresence).
  // No extra reset hook needed.
  return (
    <AnimatePresence>
      {gameMode === "brawl" && phase === "selecting" && draft ? (
        <motion.div
          key={`brawl-draft-${draft.inning}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
          // CardGameOverlay nests several `pointer-events: none`
          // overlays above the gameplay surface; without an explicit
          // `pointer-events-auto` here we'd inherit `none` from the
          // ancestors and the three cards would render but be
          // unclickable.
          // Above HitResultBanner hit-video (`z-[200]`) so inning-start
          // drafts stay interactive after a side switch.
          className="fixed inset-0 z-[220] bg-slate-950/97 backdrop-blur-sm flex flex-col items-center justify-center px-6 pointer-events-auto"
        >
          {/* Title + "Pick one" subtitle. Both fade with the picked card. */}
          <motion.div
            className="text-center mb-10"
            animate={{ opacity: pickedId ? 0 : 1, y: pickedId ? -8 : 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-[0.18em] text-amber-300 drop-shadow-[0_2px_12px_rgba(245,158,11,0.45)]">
              {title}
            </h1>
            <p className="mt-3 text-xs md:text-sm font-black uppercase tracking-[0.32em] text-slate-300/80">
              Pick One To Add To Your Equipment Bag
            </p>
          </motion.div>

          {/* The three cards. */}
          {cards.length === 0 ? (
            <p className="text-center text-sm font-bold uppercase tracking-wider text-rose-300">
              Draft cards failed to load — refresh and try again.
            </p>
          ) : (
          <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
            {cards.map((card, idx) => (
              <DraftCard
                key={card.id}
                card={card}
                pickedSelf={pickedId === card.id}
                otherPicked={pickedId !== null && pickedId !== card.id}
                disabled={pickedId !== null}
                index={idx}
                onPick={() => {
                  if (pickedId) return;
                  setPickedId(card.id);
                }}
                onFlyOffComplete={() => {
                  selectBrawlDraftCard(card.id);
                }}
              />
            ))}
          </div>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * One of the three pickable cards. The card body is the shared
 * `CardItem` so the visual matches the in-hand strip exactly; we
 * just wrap it in a click+animation harness.
 *
 * Picked-state animation: scale up briefly, then fly off the screen
 * upward + slightly right with a rotation, fading out. The fly-off
 * timer fires `onFlyOffComplete` after 700ms, which dispatches the
 * store mutation -- that unmounts the overlay via the outer
 * `AnimatePresence` exit transition. The non-picked cards fade +
 * shrink quietly so the picked one is the focal point.
 */
const FLY_OFF_DURATION_MS = 700;

function DraftCard({
  card,
  pickedSelf,
  otherPicked,
  disabled,
  index,
  onPick,
  onFlyOffComplete,
}: {
  card: CardDefinition;
  pickedSelf: boolean;
  otherPicked: boolean;
  disabled: boolean;
  index: number;
  onPick: () => void;
  onFlyOffComplete: () => void;
}) {
  // Once the user picks this card, schedule the store mutation for
  // FLY_OFF_DURATION_MS so the animation visibly completes before
  // the overlay unmounts. We use a timer instead of motion's
  // `onAnimationComplete` because the latter fires for ANY animation
  // (including the initial fade-in / `whileHover`) and its argument
  // shape changes across motion versions -- a plain setTimeout is
  // bulletproof.
  useEffect(() => {
    if (!pickedSelf) return;
    const t = window.setTimeout(onFlyOffComplete, FLY_OFF_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [pickedSelf, onFlyOffComplete]);

  // Cycle the fly-off direction per card index so the three cards
  // don't all leave on the same trajectory. Slot 0 flies up-left,
  // slot 1 flies straight up, slot 2 flies up-right.
  const flyOffX = pickedSelf ? (index === 0 ? -180 : index === 2 ? 180 : 0) : 0;
  const flyOffRotate = pickedSelf ? (index === 0 ? -22 : index === 2 ? 22 : 4) : 0;

  // Animation target when the user picks this card vs another card vs
  // nothing yet.
  const target = pickedSelf
    ? {
        opacity: 0,
        y: -1400,
        x: flyOffX,
        scale: 1.25,
        rotate: flyOffRotate,
      }
    : otherPicked
      ? { opacity: 0, y: 12, scale: 0.92, rotate: 0, x: 0 }
      : { opacity: 1, y: 0, scale: 1, rotate: 0, x: 0 };

  const anyPicked = pickedSelf || otherPicked;

  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onPick}
      initial={{ opacity: 0, y: 28, scale: 0.94 }}
      animate={target}
      transition={
        pickedSelf
          ? { duration: FLY_OFF_DURATION_MS / 1000, ease: [0.55, 0, 0.85, 0.4] }
          : otherPicked
            ? { duration: 0.34, ease: "easeOut" }
            : { duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: 0.08 * index }
      }
      whileHover={anyPicked ? undefined : { y: -8, scale: 1.04 }}
      whileTap={anyPicked ? undefined : { scale: 0.98 }}
      // Inline-block button that wraps `CardItem` without overriding
      // its width / margins. The drop-shadow gives the picker a
      // little theatrical lift compared to the in-hand strip.
      className="bg-transparent border-0 p-0 cursor-pointer disabled:cursor-default focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 rounded-2xl drop-shadow-[0_18px_36px_rgba(0,0,0,0.55)]"
    >
      <CardItem
        card={card}
        isConnectedLeft={false}
        isConnectedRight={false}
        readOnly
      />
    </motion.button>
  );
}
