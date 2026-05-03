import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore } from '../lib/gameStore';

interface CameraPose {
  zoom: number;
  position: [number, number, number];
  target: [number, number, number];
}

const POSE_DEFAULT: CameraPose = {
  // Tilted-back broadcast view from behind home plate.
  //  - Camera sits BEHIND home (z > home.z = 60.5), at moderate height so the
  //    angle reads as "tilted back away from the player" rather than top-down.
  //  - Target is panned DOWN onto the infield, between mound and home, so the
  //    batter ends up just above the user's hand strip and the pitcher sits
  //    just below the opponent's hand strip — both visible in the field band
  //    between the two card decks.
  zoom: 11,
  position: [0, 30, 100],
  target: [0, 2, 15],
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
 * Drives the orthographic camera based on game phase.
 *
 * - Default: close in on the diamond for card play.
 * - On a hit (between-at-bats with a non-out outcome): smoothly zoom out and
 *   raise the camera so the user can watch the runner advance the bases.
 * - When the user starts the next at-bat (selecting): swoop back in.
 *
 * Lerps zoom + position + target every frame for a fluid camera feel.
 */
export function CameraRig() {
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const targetRef = useRef(new THREE.Vector3(...POSE_DEFAULT.target));
  const phase = useGameStore((s) => s.phase);
  const lastOutcome = useGameStore((s) => s.lastOutcome);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3; update?: () => void; enabled?: boolean } | null;

  const targetPose = useMemo<CameraPose>(() => {
    const isHit = phase === 'between-at-bats' && lastOutcome && lastOutcome !== 'out';
    return isHit ? POSE_HIT : POSE_DEFAULT;
  }, [phase, lastOutcome]);

  // While the camera is auto-flying, disable the user-driven OrbitControls so
  // the two don't fight; re-enable once we're back to the default selecting view.
  useEffect(() => {
    if (!controls) return;
    const isAuto = phase === 'between-at-bats' && lastOutcome && lastOutcome !== 'out';
    controls.enabled = !isAuto;
  }, [controls, phase, lastOutcome]);

  useFrame((_, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;

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
