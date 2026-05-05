/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Scene } from './components/Scene';
import { UIOverlay } from './components/UIOverlay';
import { CameraDebugPanel } from './components/CameraDebugPanel';
import { DraftScreen } from './components/DraftScreen';
import { useGameStore } from './lib/gameStore';

export default function App() {
  const phase = useGameStore((s) => s.phase);
  return (
    <div className="w-screen h-screen bg-[#0F172A] text-slate-100 flex flex-col relative overflow-hidden font-sans">
      <Scene />
      <UIOverlay />
      {/* Draft overlay sits ABOVE the game UI when phase === 'drafting'. */}
      {phase === 'drafting' && <DraftScreen />}
      {/* Dev-only camera tuning overlay. Tree-shaken in production builds. */}
      {import.meta.env.DEV && <CameraDebugPanel />}
    </div>
  );
}
