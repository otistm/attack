import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { getUiUserSide, useGameStore } from '../lib/gameStore';
import { QUEST_REGISTRY } from '../lib/quests';

type CameraPose = {
  zoom: number;
  position: [number, number, number];
  target: [number, number, number];
};

const POSE_DEFAULT: CameraPose = {
  // Low and close behind home plate; target pulled down below the field plane
  // so batter and pitcher read in the band between the two card decks.
  zoom: 8.55,
  position: [0.46, 3.52, 31.67],
  target: [0.46, -3.48, 8.67],
};

const POSE_HIT: CameraPose = {
  // Pull back for base-running; target shifted forward so the diamond centers
  // under the top HUD.
  zoom: 7.5,
  position: [0, 80, 95],
  target: [0, 0, -5],
};

/**
 * Pitching-side default. Rotated 180° around the y-axis from POSE_DEFAULT
 * so the user is behind their pitcher looking back at the AI batter.
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

/** One-shot punch-in while a quest celebration is showing (HUD overlay). */
const POSE_QUEST_PUNCH_BAT: CameraPose = {
  zoom: 9.45,
  position: [0.46, 3.05, 29.1],
  target: [0.46, -3.48, 8.67],
};

const POSE_QUEST_PUNCH_PITCH: CameraPose = {
  zoom: 9.45,
  position: [0.23, 0.35, -29.9],
  target: [0.23, -14, -9.59],
};

function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const u = Math.max(0, Math.min(1, t));
  return {
    zoom: a.zoom + (b.zoom - a.zoom) * u,
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * u,
      a.position[1] + (b.position[1] - a.position[1]) * u,
      a.position[2] + (b.position[2] - a.position[2]) * u,
    ],
    target: [
      a.target[0] + (b.target[0] - a.target[0]) * u,
      a.target[1] + (b.target[1] - a.target[1]) * u,
      a.target[2] + (b.target[2] - a.target[2]) * u,
    ],
  };
}

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
  const userSide = useGameStore(getUiUserSide);
  const questCelebrationHead =
    useGameStore((s) => s.questCelebrationQueue[0] ?? null) ?? null;

  type OrbitLike = {
    target?: THREE.Vector3;
    update?: () => void;
    enabled?: boolean;
  };
  const controls = useThree((state) => state.controls) as OrbitLike | null;

  const lastQuestHeadRef = useRef<string | null>(null);
  const questPunchStartRef = useRef(0);

  const targetPose = useMemo<CameraPose>(() => {
    const isHit = phase === 'between-at-bats' && lastOutcome && lastOutcome !== 'out';
    if (userSide === 'Pitching') {
      return isHit ? POSE_HIT_PITCHING : POSE_DEFAULT_PITCHING;
    }
    return isHit ? POSE_HIT : POSE_DEFAULT;
  }, [phase, lastOutcome, userSide]);

  useEffect(() => {
    if (!controls) return;
    const isAuto = phase === 'between-at-bats' && lastOutcome && lastOutcome !== 'out';
    controls.enabled = !isAuto;
  }, [controls, phase, lastOutcome]);

  useFrame((_, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;

    const k = 1 - Math.pow(0.001, delta);

    let lerpTarget = targetPose;
    if (questCelebrationHead) {
      if (questCelebrationHead !== lastQuestHeadRef.current) {
        lastQuestHeadRef.current = questCelebrationHead;
        questPunchStartRef.current = performance.now();
      }
      const rarity = QUEST_REGISTRY[questCelebrationHead]?.rarity ?? 'common';
      const punchMs =
        rarity === 'legendary' ? 920 : rarity === 'rare' ? 760 : 600;
      const elapsed = performance.now() - questPunchStartRef.current;
      if (elapsed < punchMs) {
        const bell = Math.sin(Math.min(1, elapsed / punchMs) * Math.PI);
        const punchPose =
          userSide === 'Pitching' ? POSE_QUEST_PUNCH_PITCH : POSE_QUEST_PUNCH_BAT;
        lerpTarget = lerpPose(targetPose, punchPose, bell * 0.88);
      }
    } else {
      lastQuestHeadRef.current = null;
    }

    const kPunch = questCelebrationHead ? 1 - Math.pow(0.0002, delta) : k;

    cam.zoom += (lerpTarget.zoom - cam.zoom) * kPunch;
    cam.position.x += (lerpTarget.position[0] - cam.position.x) * kPunch;
    cam.position.y += (lerpTarget.position[1] - cam.position.y) * kPunch;
    cam.position.z += (lerpTarget.position[2] - cam.position.z) * kPunch;
    cam.updateProjectionMatrix();

    targetRef.current.x += (lerpTarget.target[0] - targetRef.current.x) * kPunch;
    targetRef.current.y += (lerpTarget.target[1] - targetRef.current.y) * kPunch;
    targetRef.current.z += (lerpTarget.target[2] - targetRef.current.z) * kPunch;
    cam.lookAt(targetRef.current);

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
