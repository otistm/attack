/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Scene } from './components/Scene';
import { UIOverlay } from './components/UIOverlay';

export default function App() {
  return (
    <div className="w-screen h-screen bg-[#0F172A] text-slate-100 flex flex-col relative overflow-hidden font-sans">
      <Scene />
      <UIOverlay />
    </div>
  );
}
