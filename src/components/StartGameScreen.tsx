import { AnimatePresence, motion } from 'motion/react';
import { useGameStore } from '../lib/gameStore';
import { playButtonSelect } from '../lib/gameAudio';
import { useSznGamepad } from '../lib/useSznGamepad';

const START_BG = '/images/start.png';

/**
 * Brawl-only entry screen. Full-bleed start art with a single animated
 * PLAY control that opens the Brawl scoring primer, then the field.
 */
export function StartGameScreen() {
  const showStartScreen = useGameStore((s) => s.showStartScreen);
  const phase = useGameStore((s) => s.phase);
  const setShowStartScreen = useGameStore((s) => s.setShowStartScreen);
  const setShowBrawlRules = useGameStore((s) => s.setShowBrawlRules);

  const visible = showStartScreen && phase !== 'drafting';

  const play = () => {
    playButtonSelect();
    setShowBrawlRules(true);
    setShowStartScreen(false);
  };

  useSznGamepad({
    id: 'start-game-screen',
    priority: 10,
    enabled: visible,
    handler: (btn) => {
      if (btn === 'CROSS') play();
    },
  });

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="start-game-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.45, ease: 'easeOut' } }}
          exit={{ opacity: 0, transition: { duration: 0.3, ease: 'easeIn' } }}
          className="fixed inset-0 z-30 overflow-hidden pointer-events-auto dugout-font-base"
          aria-modal="true"
          role="dialog"
          aria-label="Play Dugout Brawl"
        >
          <img
            src={START_BG}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center"
            draggable={false}
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/25"
            aria-hidden="true"
          />

          <div className="relative z-10 flex h-full w-full flex-col items-center justify-end pb-10 sm:pb-14 px-6">
            <motion.button
              type="button"
              onClick={play}
              initial={{ opacity: 0, y: 16 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
              }}
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              className="group relative"
              aria-label="Play Brawl Mode"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-xl bg-amber-400/30 blur-lg scale-110"
              />
              <span className="dugout-play-btn-shine relative flex min-w-[9.5rem] items-center justify-center rounded-xl border-2 border-amber-200/90 bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700 px-8 py-3 shadow-[0_8px_28px_rgba(0,0,0,0.5)] transition-shadow group-hover:shadow-[0_10px_32px_rgba(251,191,36,0.4)]">
                <span className="relative z-[1] dugout-font-sport text-2xl sm:text-3xl font-black uppercase tracking-[0.22em] text-slate-950">
                  PLAY
                </span>
              </span>
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
