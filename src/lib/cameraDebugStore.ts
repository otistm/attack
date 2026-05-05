import { create } from "zustand";

/**
 * Camera debug store
 *
 * A small dev-time slice that lets a DOM overlay (CameraDebugPanel) and the
 * R3F CameraRig collaborate on tuning the orthographic camera. Workflow:
 *
 *   1. Open the panel (Shift+C, or the floating "Cam" button).
 *   2. Pick which pose to tune in the segmented control:
 *      - BATTING: the user is at the plate (camera behind home plate-ish).
 *      - PITCHING: the user is on the mound (camera behind the mound).
 *      Switching the tuning slot snaps the rig to that pose so what you
 *      see on screen matches what the sliders are editing.
 *   3. Drag the scene (OrbitControls owns the camera) -- the rig taps the
 *      live values back into the active pose every frame so the sliders
 *      track what you do.
 *   4. Or nudge the sliders directly -- bumping `applyTick` is the rig's
 *      cue to snap the camera + OrbitControls target to the new pose.
 *   5. Hit "Copy as code" to grab a paste-ready POSE_DEFAULT* block for
 *      CameraRig.tsx. The block emits BOTH the batting and pitching
 *      defaults so a single paste covers the full pair.
 *
 * The whole thing is gated behind `import.meta.env.DEV` at mount time so it
 * never ships in a production build.
 */

export interface CameraPose {
  zoom: number;
  position: [number, number, number];
  target: [number, number, number];
}

export type TuningPose = "batting" | "pitching";

/**
 * Mirror of POSE_DEFAULT in CameraRig.tsx -- the batting (default-side)
 * vantage. Kept here so the panel can `Reset` back to the codebase
 * default without re-importing from the rig (which would risk a cycle
 * once the rig consumes this store). Whenever you tune a new default
 * through the panel and paste it into CameraRig.tsx, paste it here too
 * so Reset goes to the same place.
 */
export const DEFAULT_POSE_BATTING: CameraPose = {
  zoom: 8.55,
  position: [0.23, 0.5, 32.59],
  target: [0.23, -6.5, 9.59],
};

/**
 * Mirror of POSE_DEFAULT_PITCHING in CameraRig.tsx -- the pitching-side
 * vantage. Camera sits behind the mound looking back through it at the
 * AI batter; target y dipped low so the gaze tilts further down and the
 * batter+catcher stay visible under the AI's face-down hand strip.
 * Re-tune via the panel's `Tuning: PITCHING` mode.
 */
export const DEFAULT_POSE_PITCHING: CameraPose = {
  zoom: 8.55,
  position: [0.23, 0.5, -32.59],
  target: [0.23, -14, -9.59],
};

/**
 * Back-compat alias for any older import that didn't know about the
 * batting/pitching pair. Always points at the batting pose.
 */
export const DEFAULT_POSE = DEFAULT_POSE_BATTING;

export type PoseField = "zoom" | "px" | "py" | "pz" | "tx" | "ty" | "tz";

interface CameraDebugState {
  /** Whether the panel + rig overrides are active. */
  enabled: boolean;
  /**
   * Which of the two poses the panel is currently editing. The rig snaps
   * to the active pose whenever this flips so the sliders always reflect
   * what's on screen.
   */
  tuning: TuningPose;
  /** Live batting pose (the user's batting-side camera). */
  poseBatting: CameraPose;
  /** Live pitching pose (the user's pitching-side camera). */
  posePitching: CameraPose;
  /**
   * Monotonic counter bumped whenever the panel writes to either pose
   * directly (slider / numeric input / Reset / tuning flip). The rig
   * watches this in a useEffect to know "the user just edited the pose
   * -- snap the camera to it now" without having to diff floats.
   */
  applyTick: number;

  toggle: () => void;
  setEnabled: (v: boolean) => void;
  setTuning: (t: TuningPose) => void;
  setPose: (pose: CameraPose) => void;
  setField: (field: PoseField, value: number) => void;
  /** Called from the rig's useFrame to mirror OrbitControls drags into the panel. */
  ingestLive: (pose: CameraPose) => void;
  reset: () => void;
}

/**
 * Selector helper: returns whichever pose is currently being tuned.
 * Components and the rig should subscribe through this so the active
 * pose follows the segmented control without an extra effect.
 */
export const selectActivePose = (s: CameraDebugState): CameraPose =>
  s.tuning === "batting" ? s.poseBatting : s.posePitching;

export const useCameraDebugStore = create<CameraDebugState>((set) => ({
  enabled: false,
  tuning: "batting",
  poseBatting: DEFAULT_POSE_BATTING,
  posePitching: DEFAULT_POSE_PITCHING,
  applyTick: 0,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  setEnabled: (v) => set({ enabled: v }),
  setTuning: (t) =>
    set((s) =>
      s.tuning === t ? {} : { tuning: t, applyTick: s.applyTick + 1 },
    ),
  setPose: (pose) =>
    set((s) =>
      s.tuning === "batting"
        ? { poseBatting: pose, applyTick: s.applyTick + 1 }
        : { posePitching: pose, applyTick: s.applyTick + 1 },
    ),
  setField: (field, value) =>
    set((s) => {
      const current = selectActivePose(s);
      const pose: CameraPose = {
        zoom: current.zoom,
        position: [current.position[0], current.position[1], current.position[2]],
        target: [current.target[0], current.target[1], current.target[2]],
      };
      switch (field) {
        case "zoom":
          pose.zoom = value;
          break;
        case "px":
          pose.position[0] = value;
          break;
        case "py":
          pose.position[1] = value;
          break;
        case "pz":
          pose.position[2] = value;
          break;
        case "tx":
          pose.target[0] = value;
          break;
        case "ty":
          pose.target[1] = value;
          break;
        case "tz":
          pose.target[2] = value;
          break;
      }
      return s.tuning === "batting"
        ? { poseBatting: pose, applyTick: s.applyTick + 1 }
        : { posePitching: pose, applyTick: s.applyTick + 1 };
    }),
  ingestLive: (pose) =>
    set((s) =>
      s.tuning === "batting" ? { poseBatting: pose } : { posePitching: pose },
    ),
  reset: () =>
    set((s) => ({
      poseBatting: DEFAULT_POSE_BATTING,
      posePitching: DEFAULT_POSE_PITCHING,
      applyTick: s.applyTick + 1,
    })),
}));

/**
 * Tiny helper: shallow-compare two poses to within a small epsilon so the
 * rig's live-sync doesn't trigger a Zustand notification on every frame
 * when the camera is sitting still.
 */
export function posesAlmostEqual(
  a: CameraPose,
  b: CameraPose,
  eps = 1e-3,
): boolean {
  if (Math.abs(a.zoom - b.zoom) > eps) return false;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.position[i] - b.position[i]) > eps) return false;
    if (Math.abs(a.target[i] - b.target[i]) > eps) return false;
  }
  return true;
}
