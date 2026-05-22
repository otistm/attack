/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Scene } from './components/Scene';
import { UIOverlay } from './components/UIOverlay';
import { DraftScreen } from './components/DraftScreen';
import { ShopScreen } from './components/ShopScreen';
import { StartGameScreen } from './components/StartGameScreen';
import { SznTeamSelect } from './components/SznTeamSelect';
import { TutorialOverlay } from './components/TutorialOverlay';
import { PackRipScreen } from './components/PackRipScreen';
import { FrontOfficeScreen } from './components/FrontOfficeScreen';
import { SeriesIntroScreen } from './components/SeriesIntroScreen';
import { SeriesResultScreen } from './components/SeriesResultScreen';
import { EndRunScreen } from './components/EndRunScreen';
import { BrawlRulesScreen } from './components/BrawlRulesScreen';
import { RunHud } from './components/RunHud';
import { SznFooterDecks } from './components/SznFooterDecks';
import { PurchaseFlightOverlay } from './components/PurchaseFlightOverlay';
import { useGameStore } from './lib/gameStore';

export default function App() {
  const phase = useGameStore((s) => s.phase);
  const gameMode = useGameStore((s) => s.gameMode);
  const run = useGameStore((s) => s.run);

  // Brawl Mode strips every pre-game / between-day interstitial -- no
  // Shop, no Front Office, no pack rip. The lane drops straight into
  // a 5-second-timer at-bat and stays there. We hoist the flag here
  // so the screen gates below stay explicit at the App level instead
  // of relying on each child to self-suppress.
  const inBrawl = gameMode === 'brawl';
  const showBrawlRules = useGameStore((s) => s.showBrawlRules);

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
      {!sznShowPack && !showBrawlRules && (
        <div data-tutorial="field" className="absolute inset-0">
          <Scene />
        </div>
      )}
      <UIOverlay />
      {/* SZN Mode HUD strip. Self-gates on gameMode === "szn". */}
      <RunHud />
      {/* Draft overlay sits ABOVE the game UI when phase === 'drafting'. */}
      {phase === 'drafting' && <DraftScreen />}
      {/* Pre-game item shop. Brawl Mode skips this entirely (no
          Manager's Hand to spend on) so even if some upstream flow
          accidentally parked brawl in `phase === 'shop'`, the screen
          stays unmounted. Belt-and-suspenders with `startBrawl` which
          already lands the phase in `selecting`. */}
      {phase === 'shop' && !inBrawl && <ShopScreen />}
      {/* SZN Mode screens — only one mounts at a time based on run state.
          All three guard on `sznRun !== null` upstream, which already
          excludes brawl, but the explicit `!inBrawl` on the FO mount
          documents the intent for the next reader. */}
      {sznShowPack && <PackRipScreen />}
      {sznShowFrontOffice && !inBrawl && <FrontOfficeScreen />}
      {sznShowSeriesIntro && <SeriesIntroScreen />}
      {sznEndState && <EndRunScreen />}
      {/* SeriesResultScreen self-gates on `run.lastSeriesSummary`. It
          paints OVER both the FrontOfficeScreen (continuing run) and
          the EndRunScreen (10W / 3L terminal) so the user always sees
          the weekend recap before the next surface takes over. */}
      {inSzn && <SeriesResultScreen />}
      {/* Pre-game lane chooser (auction vs quick match vs SZN). Self-gates on
          `showStartScreen`; we additionally suppress it during an in-flight
          draft, the SZN run-screens, or any SZN end-state so they don't
          stack on top of each other. */}
      {phase !== 'drafting' && !inSzn && !showBrawlRules && <StartGameScreen />}
      {/* Brawl rules primer — after lane pick, before the field. */}
      <BrawlRulesScreen />
      {/* SZN team-selection overlay. Self-gates on `showSznTeamSelect`;
          mounted above the start screen so picking SZN doesn't require
          re-rendering the lane chooser between clicks. */}
      {!inSzn && <SznTeamSelect />}
      {/* Learn-to-Play tutorial overlay. Self-gates on `tutorialActive`;
          we suppress it during a draft / SZN run so it can't paint over them. */}
      {phase !== 'drafting' && !inSzn && <TutorialOverlay />}
      {/* SZN footer decks — always-visible roster bench (left) + bag
          items (right). Self-gates on `gameMode === 'szn' && run`, and
          phase-gates its own interactivity so the deck is informational
          on non-combat screens and actionable during card selection.
          Mounted last so it sits above the field but below any modal
          / start-screen / tutorial chrome via its internal z-40. */}
      <SznFooterDecks />
      {/* Top-most layer: encounter-purchase flight ghost. Portals
          itself to document.body so it can fly past every modal
          clipping ancestor unobstructed. Self-gates on
          `purchaseFlight` so it costs nothing when no flight is
          active. */}
      <PurchaseFlightOverlay />
    </div>
  );
}
