import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Swords } from 'lucide-react';
import { useGameStore } from '../lib/gameStore';

/** Winner remaining HP → at-bat result (matches `resolveBrawlOutcome`). */
const HIT_LADDER = [
  { hp: '0–5', result: 'Single', tone: 'text-sky-300' },
  { hp: '6–10', result: 'Double', tone: 'text-emerald-300' },
  { hp: '11–15', result: 'Triple', tone: 'text-amber-300' },
  { hp: '16–20', result: 'Home Run', tone: 'text-orange-300' },
  { hp: '21+', result: 'Grand Slam', tone: 'text-rose-300' },
] as const;

/**
 * Pre-field rules primer for Brawl Mode. Shown after the player picks the
 * brawl lane on the start screen and before the stadium + snap timer appear.
 */
export function BrawlRulesScreen() {
  const showBrawlRules = useGameStore((s) => s.showBrawlRules);
  const setShowBrawlRules = useGameStore((s) => s.setShowBrawlRules);
  const setShowStartScreen = useGameStore((s) => s.setShowStartScreen);
  const startBrawl = useGameStore((s) => s.startBrawl);

  const visible = showBrawlRules;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="brawl-rules"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.35, ease: 'easeOut' } }}
          // Slow the exit fade so the rules screen dissolves into the
          // live 3D stadium underneath instead of snapping away. The
          // field is now mounted while these rules are visible (see
          // App.tsx), so the longer crossfade gives the player a clear
          // "we're stepping into the arena" beat.
          exit={{ opacity: 0, transition: { duration: 0.55, ease: 'easeIn' } }}
          // Translucent scrim + backdrop blur instead of the opaque
          // stadium tile so the live R3F field peeks through. The
          // rules content is readable thanks to the dark wash and the
          // panel's own opaque card.
          className="absolute inset-0 z-[35] dugout-font-base text-white overflow-y-auto pointer-events-auto bg-slate-950/65 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Brawl Mode rules"
        >
          <div className="min-h-full flex flex-col items-center justify-center px-4 py-10">
            <div className="w-full max-w-lg flex flex-col gap-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex items-center gap-2 text-violet-300">
                  <Swords className="w-7 h-7" aria-hidden="true" />
                  <span className="text-[11px] font-black uppercase tracking-[0.32em]">
                    Brawl Mode
                  </span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                  How Hits Work
                </h1>
                <p className="text-sm text-slate-300/90 max-w-md leading-relaxed">
                  A <span className="text-white font-semibold">3-inning</span> arena fight.
                  Snap cards before the timer runs out to build your HP shield, then watch
                  your cards attack. Whichever side has HP left wins the brawl — your
                  leftover HP sets the at-bat result.
                </p>
              </div>

              <div className="rounded-2xl border-2 border-violet-400/40 bg-slate-950/75 backdrop-blur-sm shadow-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gradient-to-r from-violet-600/90 to-fuchsia-700/90 border-b border-violet-300/30">
                  <span className="text-[10px] font-black uppercase tracking-[0.28em] text-violet-50">
                    Winner&apos;s Remaining HP → Result
                  </span>
                </div>
                <ul className="divide-y divide-slate-800/80">
                  {HIT_LADDER.map((row) => (
                    <li
                      key={row.hp}
                      className="flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <span className="font-mono text-sm font-bold text-slate-400 tabular-nums">
                        {row.hp} HP
                      </span>
                      <span className={`text-sm font-black uppercase tracking-wider ${row.tone}`}>
                        {row.result}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-center text-xs text-slate-400 leading-relaxed px-2">
                If the pitcher outlasts you, the at-bat is an out. Tie at zero HP goes to the
                batter as a single.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowBrawlRules(false);
                    setShowStartScreen(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border-2 border-slate-600 bg-slate-900/80 text-slate-200 text-sm font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => startBrawl('AWAY')}
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl border-2 border-violet-300/70 bg-gradient-to-r from-violet-600 to-fuchsia-700 text-white text-sm font-black uppercase tracking-[0.2em] shadow-lg shadow-violet-900/40 hover:brightness-110 transition-all"
                >
                  <Swords className="w-4 h-4" aria-hidden="true" />
                  Fight!
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
