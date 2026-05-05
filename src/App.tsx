/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Scene } from './components/Scene';
import { UIOverlay } from './components/UIOverlay';
import { CameraDebugPanel } from './components/CameraDebugPanel';
import { DraftScreen } from './components/DraftScreen';
import { StartGameScreen } from './components/StartGameScreen';
import { TutorialOverlay } from './components/TutorialOverlay';
import { useGameStore } from './lib/gameStore';

export default function App() {
  const phase = useGameStore((s) => s.phase);
  return (
    <div className="w-screen h-screen bg-[#0F172A] text-slate-100 flex flex-col relative overflow-hidden font-sans">
      {/* The 3D field. Wrapped in a stable anchor so the tutorial overlay
          can spotlight "the field" without trying to query the R3F canvas
          directly. */}
      <div data-tutorial="field" className="absolute inset-0">
        <Scene />
      </div>
      <UIOverlay />
      {/* Draft overlay sits ABOVE the game UI when phase === 'drafting'. */}
      {phase === 'drafting' && <DraftScreen />}
      {/* Pre-game lane chooser (auction vs quick match). Self-gates on
          `showStartScreen`; we additionally suppress it during an in-flight
          draft so the auction overlay never renders behind it. */}
      {phase !== 'drafting' && <StartGameScreen />}
      {/* Learn-to-Play tutorial overlay. Self-gates on `tutorialActive`;
          we suppress it during a draft so it can't paint over the auction. */}
      {phase !== 'drafting' && <TutorialOverlay />}
      {/* Dev-only camera tuning overlay. Tree-shaken in production builds. */}
      {import.meta.env.DEV && <CameraDebugPanel />}
    </div>
  );
}
