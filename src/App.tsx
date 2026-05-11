/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Scene } from './components/Scene';
import { UIOverlay } from './components/UIOverlay';
import { DraftScreen } from './components/DraftScreen';
import { StartGameScreen } from './components/StartGameScreen';
import { TutorialOverlay } from './components/TutorialOverlay';
import { PackRipScreen } from './components/PackRipScreen';
import { FrontOfficeScreen } from './components/FrontOfficeScreen';
import { SeriesIntroScreen } from './components/SeriesIntroScreen';
import { EndRunScreen } from './components/EndRunScreen';
import { RunHud } from './components/RunHud';
import { useGameStore } from './lib/gameStore';

export default function App() {
  const phase = useGameStore((s) => s.phase);
  const gameMode = useGameStore((s) => s.gameMode);
  const run = useGameStore((s) => s.run);

  // SZN Mode routing. Narrow `run` to a single non-null local up top so
  // every downstream branch reads against `sznRun` instead of sprinkling
  // `run!` non-null assertions through the JSX.
  const sznRun = gameMode === 'szn' ? run : null;
  const inSzn = sznRun !== null;
  const sznEndState = sznRun?.endState ?? null;
  const sznShowPack = inSzn && !sznEndState && sznRun.packRipPending;
  const sznShowFrontOffice =
    inSzn && !sznEndState && !sznRun.packRipPending && sznRun.day !== 'series';
  // Series intro is shown between games (gameInProgress === false). Once
  // `startSeries` flips that flag, the live overlay takes over and the
  // intro stays out of the way until the next game queues up.
  const sznShowSeriesIntro =
    inSzn &&
    !sznEndState &&
    sznRun.day === 'series' &&
    sznRun.series?.gameInProgress === false;

  return (
    <div className="w-screen h-screen bg-[#0F172A] text-slate-100 flex flex-col relative overflow-hidden font-sans">
      {/* The 3D field. Wrapped in a stable anchor so the tutorial overlay
          can spotlight "the field" without trying to query the R3F canvas
          directly.
          We unmount it during the SZN pack-rip moment so the GPU only has
          to drive ONE WebGL context (Pack3D) instead of two. Browsers cap
          live contexts (~8-16 depending on driver) and the playtest hit a
          THREE.WebGLRenderer "Context Lost" when both ran together. */}
      {!sznShowPack && (
        <div data-tutorial="field" className="absolute inset-0">
          <Scene />
        </div>
      )}
      <UIOverlay />
      {/* SZN Mode HUD strip. Self-gates on gameMode === "szn". */}
      <RunHud />
      {/* Draft overlay sits ABOVE the game UI when phase === 'drafting'. */}
      {phase === 'drafting' && <DraftScreen />}
      {/* SZN Mode screens — only one mounts at a time based on run state. */}
      {sznShowPack && <PackRipScreen />}
      {sznShowFrontOffice && <FrontOfficeScreen />}
      {sznShowSeriesIntro && <SeriesIntroScreen />}
      {sznEndState && <EndRunScreen />}
      {/* Pre-game lane chooser (auction vs quick match vs SZN). Self-gates on
          `showStartScreen`; we additionally suppress it during an in-flight
          draft, the SZN run-screens, or any SZN end-state so they don't
          stack on top of each other. */}
      {phase !== 'drafting' && !inSzn && <StartGameScreen />}
      {/* Learn-to-Play tutorial overlay. Self-gates on `tutorialActive`;
          we suppress it during a draft / SZN run so it can't paint over them. */}
      {phase !== 'drafting' && !inSzn && <TutorialOverlay />}
    </div>
  );
}
