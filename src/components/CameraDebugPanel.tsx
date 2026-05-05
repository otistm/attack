import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraPose,
  DEFAULT_POSE_BATTING,
  DEFAULT_POSE_PITCHING,
  PoseField,
  selectActivePose,
  TuningPose,
  useCameraDebugStore,
} from '../lib/cameraDebugStore';

/**
 * Dev-time camera tuning overlay.
 *
 * Mounted from <App> behind `import.meta.env.DEV` so it's tree-shaken in
 * production builds. While the panel is `enabled`:
 *   - OrbitControls is fully unlocked (drag = orbit, scroll = ortho zoom,
 *     right-drag = pan) and the rig stops auto-flying.
 *   - Sliders + numeric inputs write straight to the camera through the
 *     cameraDebugStore (the rig's `applyTick` watcher snaps the camera).
 *   - Drags in the scene mirror back into the readouts every ~80ms so the
 *     panel always shows the live pose.
 *   - The Tuning segmented control swaps between BATTING and PITCHING
 *     poses; switching snaps the rig to the other pose so what's on
 *     screen always matches what the sliders edit.
 *
 * Workflow: open panel (Shift+C), pick which side to tune, drag the
 * scene + tweak sliders until it looks right, hit "Copy as code", paste
 * the BOTH-poses block over the `POSE_DEFAULT*` definitions in
 * src/components/CameraRig.tsx (and the matching mirrors in
 * src/lib/cameraDebugStore.ts).
 */
export function CameraDebugPanel() {
  const enabled = useCameraDebugStore((s) => s.enabled);
  const tuning = useCameraDebugStore((s) => s.tuning);
  const setTuning = useCameraDebugStore((s) => s.setTuning);
  const activePose = useCameraDebugStore(selectActivePose);
  const poseBatting = useCameraDebugStore((s) => s.poseBatting);
  const posePitching = useCameraDebugStore((s) => s.posePitching);
  const setEnabled = useCameraDebugStore((s) => s.setEnabled);
  const setField = useCameraDebugStore((s) => s.setField);
  const toggle = useCameraDebugStore((s) => s.toggle);
  const reset = useCameraDebugStore((s) => s.reset);

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const codeBlock = useMemo(
    () => formatPosesAsCode(poseBatting, posePitching),
    [poseBatting, posePitching],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeBlock);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 1500);
  }, [codeBlock]);

  return (
    <>
      {/* Floating toggle. Always rendered (even when panel is closed) so the
          user has a discoverable affordance; the keybind is the power-user
          shortcut. Anchored to the bottom-left corner so it doesn't collide
          with the gameplay HUD's "Collection" / "New Game" / score-pill row
          along the top. */}
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        title="Toggle camera debug (Shift+C)"
        className={`fixed bottom-4 left-4 z-50 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest border shadow-lg backdrop-blur transition-colors ${
          enabled
            ? 'bg-amber-400/95 text-slate-900 border-amber-200/80 hover:bg-amber-300'
            : 'bg-slate-900/80 text-amber-300 border-amber-400/40 hover:bg-slate-800'
        }`}
      >
        Cam {enabled ? 'ON' : 'OFF'}
      </button>

      {enabled && (
        <div
          className="fixed bottom-16 left-4 z-50 w-[320px] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border border-amber-400/30 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur-sm"
        >
          <header className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-slate-900/60">
            <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-amber-300">
              Camera Debug
            </h3>
            <kbd className="text-[9px] font-mono uppercase tracking-widest text-slate-500">
              Shift + C
            </kbd>
          </header>

          <div className="p-3 space-y-3">
            <TuningSegment value={tuning} onChange={setTuning} />

            <PoseRow
              label="Zoom"
              value={activePose.zoom}
              min={1}
              max={50}
              step={0.1}
              onChange={(v) => setField('zoom', v)}
            />

            <Group title="Position">
              <PoseRow
                label="X"
                value={activePose.position[0]}
                min={-200}
                max={200}
                step={1}
                onChange={(v) => setField('px', v)}
              />
              <PoseRow
                label="Y"
                value={activePose.position[1]}
                min={-50}
                max={200}
                step={1}
                onChange={(v) => setField('py', v)}
              />
              <PoseRow
                label="Z"
                value={activePose.position[2]}
                min={-200}
                max={200}
                step={1}
                onChange={(v) => setField('pz', v)}
              />
            </Group>

            <Group title="Target (LookAt)">
              <PoseRow
                label="X"
                value={activePose.target[0]}
                min={-100}
                max={100}
                step={0.5}
                onChange={(v) => setField('tx', v)}
              />
              <PoseRow
                label="Y"
                value={activePose.target[1]}
                min={-50}
                max={50}
                step={0.5}
                onChange={(v) => setField('ty', v)}
              />
              <PoseRow
                label="Z"
                value={activePose.target[2]}
                min={-100}
                max={100}
                step={0.5}
                onChange={(v) => setField('tz', v)}
              />
            </Group>

            <div className="border-t border-white/10 pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 rounded-md bg-amber-400 hover:bg-amber-300 text-slate-900 text-[11px] font-bold uppercase tracking-widest py-1.5 shadow"
                >
                  {copyState === 'copied'
                    ? 'Copied!'
                    : copyState === 'failed'
                      ? 'Copy failed'
                      : 'Copy as code'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 border border-white/10"
                  title="Reset both poses to their codified defaults"
                >
                  Reset
                </button>
              </div>
              <pre className="text-[10px] leading-snug font-mono text-slate-300 bg-slate-950/70 border border-white/5 rounded p-2 whitespace-pre-wrap break-all">
                {codeBlock}
              </pre>
              <p className="text-[10px] text-slate-400 leading-snug">
                Drag the scene to orbit, scroll to zoom, right-drag to pan.
                Sliders snap immediately. The Tuning toggle swaps which
                pose the sliders edit and snaps the camera to match.
                Paste the code block over{' '}
                <code className="text-amber-300 font-mono">
                  POSE_DEFAULT
                </code>{' '}
                /{' '}
                <code className="text-amber-300 font-mono">
                  POSE_DEFAULT_PITCHING
                </code>{' '}
                in{' '}
                <code className="text-amber-300 font-mono">
                  CameraRig.tsx
                </code>
                .
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface PoseRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

const PoseRow = ({ label, value, min, max, step, onChange }: PoseRowProps) => {
  // Local string mirror so the user can type "-3" or "12." without losing
  // focus / committing partial floats every keystroke. We use a ref to track
  // whether the input is currently focused (not React state) so the sync
  // useEffect can read the LIVE focus state on each value change rather than
  // a possibly-stale captured value -- the previous useState-based approach
  // could leave `draft` desynced from `value` on rapid prop updates (e.g.
  // Reset, or the rig's live-sync writing the OrbitControls-clamped pose
  // back into the store).
  const [draft, setDraft] = useState(() => formatNumber(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatNumber(value));
  }, [value]);

  return (
    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-400">
      <span className="w-10 font-bold">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-amber-400 h-1.5"
      />
      <input
        type="number"
        value={draft}
        step={step}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          const parsed = parseFloat(draft);
          if (!Number.isNaN(parsed)) onChange(parsed);
          // Always re-snap draft to the formatted store value on blur so
          // partials like "12." get cleaned up.
          setDraft(formatNumber(Number.isNaN(parsed) ? value : parsed));
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseFloat(e.target.value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
        className="w-14 rounded bg-slate-950/80 border border-white/10 px-1.5 py-0.5 text-[11px] font-mono text-slate-100 text-right focus:outline-none focus:border-amber-400/60"
      />
    </label>
  );
};

const Group = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <div className="text-[9px] font-extrabold uppercase tracking-widest text-amber-300/80">
      {title}
    </div>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const TuningSegment = ({
  value,
  onChange,
}: {
  value: TuningPose;
  onChange: (v: TuningPose) => void;
}) => (
  <div className="space-y-1.5">
    <div className="text-[9px] font-extrabold uppercase tracking-widest text-amber-300/80">
      Tuning
    </div>
    <div className="grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-slate-950/60 p-0.5">
      <SegmentButton active={value === 'batting'} onClick={() => onChange('batting')}>
        Batting
      </SegmentButton>
      <SegmentButton active={value === 'pitching'} onClick={() => onChange('pitching')}>
        Pitching
      </SegmentButton>
    </div>
  </div>
);

const SegmentButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`text-[10px] font-extrabold uppercase tracking-widest py-1 rounded transition-colors ${
      active
        ? 'bg-amber-400 text-slate-900 shadow'
        : 'text-slate-400 hover:text-amber-300'
    }`}
  >
    {children}
  </button>
);

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '0';
  // Two-decimal display; trim trailing zeros so "30.00" reads as "30".
  const fixed = v.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}

function formatPoseAsCode(name: string, pose: CameraPose): string {
  const fmt = (n: number) => formatNumber(n);
  return `const ${name}: CameraPose = {
  zoom: ${fmt(pose.zoom)},
  position: [${pose.position.map(fmt).join(', ')}],
  target: [${pose.target.map(fmt).join(', ')}],
};`;
}

function formatPosesAsCode(batting: CameraPose, pitching: CameraPose): string {
  return `${formatPoseAsCode('POSE_DEFAULT', batting)}\n\n${formatPoseAsCode(
    'POSE_DEFAULT_PITCHING',
    pitching,
  )}`;
}

// Re-exported as a doc-discovery aid for code search; not used here.
void DEFAULT_POSE_BATTING;
void DEFAULT_POSE_PITCHING;
