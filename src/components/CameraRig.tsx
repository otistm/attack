import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { getUserSide, useGameStore } from '../lib/gameStore';
import {
  posesAlmostEqual,
  selectActivePose,
  useCameraDebugStore,
  type CameraPose,
} from '../lib/cameraDebugStore';

const POSE_DEFAULT: CameraPose = {
  // Dialed in via the in-app camera-debug panel (Shift+C). Sits low and close
  // behind home plate with the target pulled down below the field plane, so
  // the batter at home and the pitcher on the mound stack vertically in the
  // field band between the two card decks at a tight, tilted-back angle.
  zoom: 8.55,
  position: [0.23, 0.5, 32.59],
  target: [0.23, -6.5, 9.59],
};

const POSE_HIT: CameraPose = {
  // Pull back enough to see the full diamond and runner traveling between
  // bases, but not so far that the runner becomes a dot. Target is shifted
  // forward (negative z) so the diamond + base-paths are vertically centered
  // in the viewport rather than tucked under the top header overlay.
  zoom: 7.5,
  position: [0, 80, 95],
  target: [0, 0, -5],
};

/**
 * Pitching-side default. Rotated 180° around the y-axis from POSE_DEFAULT
 * so the user is "behind their pitcher" looking back at the AI batter on
 * home plate. Target y dipped lower than the batting mirror so the camera
 * tilts further down -- exposes the batter+catcher silhouette under the
 * AI's face-down hand UI instead of leaving them tucked up by the strip.
 * Re-tune via the camera-debug panel's Tuning: PITCHING mode.
 */
const POSE_DEFAULT_PITCHING: CameraPose = {
  zoom: 8.55,
  position: [0.23, 0.5, -32.59],
  target: [0.23, -14, -9.59],
};

/** Pitching-side mirror of POSE_HIT. */
const POSE_HIT_PITCHING: CameraPose = {
  zoom: 7.5,
  position: [0, 80, -95],
  target: [0, 0, 5],
};

/** Throttle live-sync writes from useFrame -> store to roughly this cadence. */
const LIVE_SYNC_INTERVAL_MS = 80;

/**
 * Drives the orthographic camera based on game phase.
 *
 * - Default: close in on the diamond for card play.
 * - On a hit (between-at-bats with a non-out outcome): smoothly zoom out and
 *   raise the camera so the user can watch the runner advance the bases.
 * - When the user starts the next at-bat (selecting): swoop back in.
 *
 * Lerps zoom + position + target every frame for a fluid camera feel.
 *
 * Camera-debug overrides (CameraDebugPanel + cameraDebugStore):
 * - When debug is `enabled`, the rig stops driving the camera and lets
 *   OrbitControls own it fully. Slider edits in the panel are detected via
 *   the store's `applyTick` and snap the camera + OrbitControls target to
 *   the new pose without lerp. Each frame, the rig also writes the live
 *   camera pose back into the store (throttled) so OrbitControls drags are
 *   reflected in the panel readouts.
 */
export function CameraRig() {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const targetRef = useRef(new THREE.Vector3(...POSE_DEFAULT.target));
  const phase = useGameStore((s) => s.phase);
  const lastOutcome = useGameStore((s) => s.lastOutcome);
  // Which seat the user is in this half. Drives the default-pose flip:
  // batting -> behind home plate, pitching -> behind the mound. The lerp
  // animates smoothly when the half flip changes the seat.
  const userSide = useGameStore(getUserSide);
  // OrbitControls instance type. We intentionally peek beyond `target/update/
  // enabled` here because the camera-debug mode needs to temporarily relax the
  // orbit/zoom/distance/polar/azimuth limits so they don't fight the sliders.
  type OrbitLike = {
    target?: THREE.Vector3;
    update?: () => void;
    enabled?: boolean;
    minDistance?: number;
    maxDistance?: number;
    minZoom?: number;
    maxZoom?: number;
    minPolarAngle?: number;
    maxPolarAngle?: number;
    minAzimuthAngle?: number;
    maxAzimuthAngle?: number;
  };
  const controls = useThree((state) => state.controls) as OrbitLike | null;

  const debugEnabled = useCameraDebugStore((s) => s.enabled);
  const debugPose = useCameraDebugStore(selectActivePose);
  const debugApplyTick = useCameraDebugStore((s) => s.applyTick);
  const ingestLive = useCameraDebugStore((s) => s.ingestLive);
  const lastAppliedTickRef = useRef(debugApplyTick);
  const lastLiveSyncRef = useRef(0);
  const lastIngestedRef = useRef<CameraPose>(debugPose);
  // Snapshot of the OrbitControls limit fields captured the moment debug
  // mode turns on, so we can faithfully restore Scene.tsx's gameplay limits
  // when debug toggles back off.
  const savedOrbitLimitsRef = useRef<Partial<OrbitLike> | null>(null);

  const targetPose = useMemo<CameraPose>(() => {
    const isHit = phase === 'between-at-bats' && lastOutcome && lastOutcome !== 'out';
    if (userSide === 'Pitching') {
      return isHit ? POSE_HIT_PITCHING : POSE_DEFAULT_PITCHING;
    }
    return isHit ? POSE_HIT : POSE_DEFAULT;
  }, [phase, lastOutcome, userSide]);

  // While the camera is auto-flying, disable the user-driven OrbitControls so
  // the two don't fight; re-enable once we're back to the default selecting
  // view. While camera-debug is on, OrbitControls is always enabled so the
  // user can free-fly to dial in the pose AND we relax its angle/distance
  // limits so the sliders don't get clamped back into the gameplay envelope.
  // (Without this relaxation Scene.tsx's `maxPolarAngle = π/3` re-projects
  // any slider-driven position that would push the polar angle past 60°,
  // which made the Y/Z sliders feel broken — the camera would visibly snap
  // and the live-sync would mirror the clamped values back into the panel.)
  useEffect(() => {
    if (!controls) return;
    if (debugEnabled) {
      controls.enabled = true;
      if (!savedOrbitLimitsRef.current) {
        savedOrbitLimitsRef.current = {
          minDistance: controls.minDistance,
          maxDistance: controls.maxDistance,
          minZoom: controls.minZoom,
          maxZoom: controls.maxZoom,
          minPolarAngle: controls.minPolarAngle,
          maxPolarAngle: controls.maxPolarAngle,
          minAzimuthAngle: controls.minAzimuthAngle,
          maxAzimuthAngle: controls.maxAzimuthAngle,
        };
      }
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
      controls.minZoom = 0;
      controls.maxZoom = Infinity;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      controls.minAzimuthAngle = -Infinity;
      controls.maxAzimuthAngle = Infinity;
      controls.update?.();
      // Mirror the live camera state into the store immediately so the panel
      // shows reality from the moment it opens (rather than the codified
      // DEFAULT_POSE that the camera may not actually be sitting at -- e.g.
      // when the gameplay-mode OrbitControls limits have been clamping the
      // rig's lerp into a different envelope). Without this, an 80ms throttle
      // window can let the user touch a slider against stale store values
      // and the unrelated axes will appear to "jump" on first edit.
      const cam = cameraRef.current;
      if (cam) {
        const pose: CameraPose = {
          zoom: cam.zoom,
          position: [cam.position.x, cam.position.y, cam.position.z],
          target: controls?.target
            ? [controls.target.x, controls.target.y, controls.target.z]
            : [targetRef.current.x, targetRef.current.y, targetRef.current.z],
        };
        lastIngestedRef.current = pose;
        ingestLive(pose);
      }
      return;
    }
    if (savedOrbitLimitsRef.current) {
      const saved = savedOrbitLimitsRef.current;
      Object.assign(controls, saved);
      savedOrbitLimitsRef.current = null;
      // Sync targetRef to whatever OrbitControls is pointing at right now,
      // so the rig's lerp toward POSE_DEFAULT.target starts from the user's
      // dialed-in vantage instead of jumping back through the previously
      // cached target.
      if (controls.target) {
        targetRef.current.copy(controls.target);
      }
      controls.update?.();
    }
    const isAuto = phase === 'between-at-bats' && lastOutcome && lastOutcome !== 'out';
    controls.enabled = !isAuto;
  }, [controls, phase, lastOutcome, debugEnabled]);

  // Snap-apply when the panel writes a new pose (slider drag, numeric input,
  // Reset). We watch `applyTick` rather than diffing the pose itself so a
  // round-trip through ingestLive can't trigger a re-apply loop.
  useEffect(() => {
    if (!debugEnabled) return;
    if (debugApplyTick === lastAppliedTickRef.current) return;
    lastAppliedTickRef.current = debugApplyTick;
    const cam = cameraRef.current;
    if (!cam) return;
    cam.zoom = debugPose.zoom;
    cam.position.set(...debugPose.position);
    cam.updateProjectionMatrix();
    targetRef.current.set(...debugPose.target);
    cam.lookAt(targetRef.current);
    if (controls?.target) {
      controls.target.copy(targetRef.current);
      controls.update?.();
    }
  }, [debugApplyTick, debugEnabled, debugPose, controls]);

  useFrame((_, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;

    if (debugEnabled) {
      // OrbitControls owns the camera in debug mode. Mirror live values back
      // into the store on a throttled cadence so the panel sliders track
      // drag/zoom/pan without us churning Zustand at 120fps.
      const now = performance.now();
      if (now - lastLiveSyncRef.current >= LIVE_SYNC_INTERVAL_MS) {
        lastLiveSyncRef.current = now;
        const live: CameraPose = {
          zoom: cam.zoom,
          position: [cam.position.x, cam.position.y, cam.position.z],
          target: controls?.target
            ? [controls.target.x, controls.target.y, controls.target.z]
            : [targetRef.current.x, targetRef.current.y, targetRef.current.z],
        };
        if (!posesAlmostEqual(live, lastIngestedRef.current)) {
          lastIngestedRef.current = live;
          ingestLive(live);
        }
      }
      return;
    }

    // Frame-rate-independent lerp factor.
    const k = 1 - Math.pow(0.001, delta);

    cam.zoom += (targetPose.zoom - cam.zoom) * k;
    cam.position.x += (targetPose.position[0] - cam.position.x) * k;
    cam.position.y += (targetPose.position[1] - cam.position.y) * k;
    cam.position.z += (targetPose.position[2] - cam.position.z) * k;
    cam.updateProjectionMatrix();

    targetRef.current.x += (targetPose.target[0] - targetRef.current.x) * k;
    targetRef.current.y += (targetPose.target[1] - targetRef.current.y) * k;
    targetRef.current.z += (targetPose.target[2] - targetRef.current.z) * k;
    cam.lookAt(targetRef.current);

    // Keep OrbitControls' target in sync so when it re-enables it doesn't snap.
    if (controls?.target) {
      controls.target.copy(targetRef.current);
      controls.update?.();
    }
  });

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      position={POSE_DEFAULT.position}
      zoom={POSE_DEFAULT.zoom}
      near={-500}
      far={1000}
    />
  );
}
