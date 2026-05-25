import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BaseTarget } from './BaseTarget';
import { Player } from './Player';
import { BaseSlot, RunnerMove, useGameStore } from '../lib/gameStore';

// Color used for the offensive runners. The defensive players on the field are
// already blue (#1E88E5) and the batter at the plate is red (#E53935), so
// continuing the batter's red on the bases keeps team identity consistent.
const RUNNER_TEAM_COLOR = '#E53935';
const RUNNER_TEAM_DARK = '#B71C1C';

// "Phantom" runners are placed by card effects (currently only b-135 Stolen
// Bag) rather than the natural outcome of the at-bat. They have no specific
// drafted player attached. We tint them gold/amber so a hit + Stolen Bag
// reads as "single + steal" instead of looking like a duplicate-runner glitch
// when two figures appear after a single swing. Picked to stand cleanly
// against the green grass + brown dirt and differ obviously from the red of
// a real baserunner.
const PHANTOM_RUNNER_COLOR = '#FFB300';
const PHANTOM_RUNNER_DARK = '#E65100';

export function Stadium() {
  const bases = useGameStore((s) => s.bases);
  // Per-base runner identities so we can tell a real drafted player on 1B
  // apart from an "anonymous" extra runner spawned by a card effect like
  // b-135 Stolen Bag (where the slot is `null`). The phantom flag on the
  // runner figures is what differentiates a stolen bag from a true hit.
  const baseRunners = useGameStore((s) => s.baseRunners);
  const lastOutcome = useGameStore((s) => s.lastOutcome);
  const phase = useGameStore((s) => s.phase);
  const runnerMoves = useGameStore((s) => s.runnerMoves);
  // SZN Mode: while the player is in the Front Office or pack-rip flow,
  // strip every figure from the diamond so the screen UI floats over a
  // genuinely empty field. Combat (the weekend series) keeps the players.
  const fieldEmpty = useGameStore((s) => {
    if (s.gameMode !== "szn" || !s.run) return false;
    if (s.run.packRipPending) return true;
    if (s.run.day !== "series") return true;
    if (s.run.series && !s.run.series.gameInProgress) return true;
    if (s.run.endState !== null) return true;
    return false;
  });
  const questLegendaryCelebratePulse = useGameStore(
    (s) => s.questLegendaryCelebratePulse,
  );
  const dirtMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#D4A373', roughness: 0.9 }), []);
  const grassMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7CB342', roughness: 0.8 }), []);
  const darkGrassMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#689F38', roughness: 0.8 }), []);
  const chalkMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 1 }), []);
  const wallMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#455A64', roughness: 0.6 }), []);

  // Standard baseball dimensions in feet
  const homeToMound = 60.5;
  const homeToSecond = 127.28; // 90 * sqrt(2)
  const baseSide = 63.64; // 127.28 / 2

  const moundPos = [0, 0.01, 0] as [number, number, number];
  const homePos = [0, 0.01, homeToMound] as [number, number, number];
  const firstPos = [baseSide, 0.01, homeToMound - baseSide] as [number, number, number];
  const secondPos = [0, 0.01, homeToMound - homeToSecond] as [number, number, number];
  const thirdPos = [-baseSide, 0.01, homeToMound - baseSide] as [number, number, number];

  // Checkerboard grass pattern (large field)
  const grassTiles = [];
  const tileSize = 20;
  const gridCount = 24;
  for (let x = -gridCount / 2; x < gridCount / 2; x++) {
    for (let z = -gridCount / 2; z < gridCount / 2; z++) {
      const isDark = (Math.abs(x) + Math.abs(z)) % 2 === 0;
      grassTiles.push(
        <mesh 
          key={`grass-${x}-${z}`} 
          position={[x * tileSize + tileSize / 2, 0, z * tileSize + tileSize / 2]} 
          rotation={[-Math.PI / 2, 0, 0]} 
          receiveShadow
        >
          <planeGeometry args={[tileSize, tileSize]} />
          <meshStandardMaterial color={isDark ? '#689F38' : '#7CB342'} roughness={0.8} />
        </mesh>
      );
    }
  }

  // Foul line length (from home plate down the line)
  const foulLineDistance = 330;
  const foulLineOffset = foulLineDistance / 2;

  return (
    <group>
      {/* Brown/Dirt Base Ground */}
      <group position={[0, -1, 0]}>
        <mesh receiveShadow castShadow>
          <boxGeometry args={[450, 2, 450]} />
          <meshStandardMaterial color="#8D6E63" roughness={1} />
        </mesh>
      </group>

      {/* Grass Ground (Checkerboard) */}
      <group position={[0, 0.01, 0]}>
        {grassTiles}
      </group>

      {/* Main Infield Dirt Circle (95ft radius from mound) */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={dirtMaterial}>
        <circleGeometry args={[95, 64]} />
      </mesh>

      {/* Inner Grass Diamond */}
      <mesh position={[0, 0.03, homeToMound - baseSide]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} receiveShadow material={grassMaterial}>
        <planeGeometry args={[66, 66]} />
      </mesh>

      {/* Dirt Cutouts overlapping the inner grass */}
      <mesh position={[0, 0.04, homeToMound]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={dirtMaterial}>
        <circleGeometry args={[13, 32]} />
      </mesh>
      <mesh position={firstPos} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={dirtMaterial}>
        <circleGeometry args={[13, 32]} />
      </mesh>
      <mesh position={secondPos} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={dirtMaterial}>
        <circleGeometry args={[13, 32]} />
      </mesh>
      <mesh position={thirdPos} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={dirtMaterial}>
        <circleGeometry args={[13, 32]} />
      </mesh>

      {/* Pitcher's Mound Dirt */}
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={dirtMaterial}>
        <circleGeometry args={[9, 32]} />
      </mesh>

      {/* Pitcher's Mound Elevated */}
      <mesh position={[0, 0.25, 0]} receiveShadow castShadow material={dirtMaterial}>
        <cylinderGeometry args={[5, 9, 0.5, 32]} />
      </mesh>
      
      {/* Pitcher's Plate (Rubber) */}
      <mesh position={[0, 0.51, 0]} receiveShadow castShadow material={chalkMaterial}>
        <boxGeometry args={[2, 0.05, 0.5]} />
      </mesh>

      {/* Bases */}
      <BaseTarget position={[homePos[0], 0.05, homePos[2]]} isHome={true} />
      <BaseTarget position={[firstPos[0], 0.05, firstPos[2]]} occupied={bases[0]} />
      <BaseTarget position={[secondPos[0], 0.05, secondPos[2]]} occupied={bases[1]} />
      <BaseTarget position={[thirdPos[0], 0.05, thirdPos[2]]} occupied={bases[2]} />

      {/* Runners.
          - During a hit's between-at-bats phase: render an AnimatedRunner per
            recorded RunnerMove so the user can see them traverse the bases.
          - During revealing / selecting / game-over: static runners on
            whichever bases the store says are occupied (the pre-play
            snapshot during reveal — new occupants apply at completeReveal). */}
      {!fieldEmpty && (() => {
        const showAnimated =
          phase === 'between-at-bats' && lastOutcome && lastOutcome !== 'out' && runnerMoves.length > 0;
        if (showAnimated) {
          return runnerMoves.map((move) => (
            <AnimatedRunner
              key={move.id}
              move={move}
              homeToMound={homeToMound}
              firstPos={firstPos}
              secondPos={secondPos}
              thirdPos={thirdPos}
            />
          ));
        }
        return (
          <>
            {bases[0] && (
              <Runner
                position={[firstPos[0] + 1, 0, firstPos[2] - 1]}
                phantom={baseRunners[0] === null}
              />
            )}
            {bases[1] && (
              <Runner
                position={[secondPos[0] + 1, 0, secondPos[2] + 2]}
                phantom={baseRunners[1] === null}
              />
            )}
            {bases[2] && (
              <Runner
                position={[thirdPos[0] - 1, 0, thirdPos[2] - 1]}
                phantom={baseRunners[2] === null}
              />
            )}
          </>
        );
      })()}
      {/* Hide the result-pulse and any base highlighting in SZN's empty-field
          mode -- nothing should be celebrating an at-bat that's not happening. */}

      {/* Result celebration: pulse arc above the bases when a hit just happened */}
      {phase === 'between-at-bats' && (
        <ResultPulse
          key={`${lastOutcome}-${questLegendaryCelebratePulse}`}
          outcome={lastOutcome}
          position={[0, 8, homeToMound - baseSide]}
          legendaryQuest={questLegendaryCelebratePulse}
        />
      )}

      {/* Foul Lines */}
      {/* Home to Right (First Base line) */}
      <mesh 
        position={[foulLineOffset * 0.7071, 0.05, homeToMound - foulLineOffset * 0.7071]} 
        rotation={[-Math.PI / 2, 0, -Math.PI / 4]} 
        material={chalkMaterial} 
        receiveShadow
      >
        <planeGeometry args={[0.5, foulLineDistance]} />
      </mesh>
      {/* Home to Left (Third Base line) */}
      <mesh 
        position={[-foulLineOffset * 0.7071, 0.05, homeToMound - foulLineOffset * 0.7071]} 
        rotation={[-Math.PI / 2, 0, Math.PI / 4]} 
        material={chalkMaterial} 
        receiveShadow
      >
        <planeGeometry args={[0.5, foulLineDistance]} />
      </mesh>

      {/* Outfield Walls */}
      <mesh position={[-160, 8, -200]} rotation={[0, Math.PI / 6, 0]} castShadow receiveShadow material={wallMaterial}>
         <boxGeometry args={[180, 16, 4]} />
      </mesh>
      <mesh position={[160, 8, -200]} rotation={[0, -Math.PI / 6, 0]} castShadow receiveShadow material={wallMaterial}>
         <boxGeometry args={[180, 16, 4]} />
      </mesh>
      <mesh position={[0, 8, -270]} castShadow receiveShadow material={wallMaterial}>
         <boxGeometry args={[240, 16, 4]} />
      </mesh>

      {/* Facilities */}
      <LightTower position={[-140, 0, -250]} rotation={[0, -Math.PI/6, 0]} />
      <LightTower position={[140, 0, -250]} rotation={[0, Math.PI/6, 0]} />
      <LightTower position={[-200, 0, 50]} rotation={[0, -Math.PI/3, 0]} />
      <LightTower position={[200, 0, 50]} rotation={[0, Math.PI/3, 0]} />

      {/* Stands */}
      <mesh position={[150, 10, 100]} rotation={[0, -Math.PI/4, 0]} castShadow receiveShadow material={wallMaterial}>
         <boxGeometry args={[150, 20, 20]} />
      </mesh>
      <mesh position={[-150, 10, 100]} rotation={[0, Math.PI/4, 0]} castShadow receiveShadow material={wallMaterial}>
         <boxGeometry args={[150, 20, 20]} />
      </mesh>

      {!fieldEmpty && (
        <>
          <Player position={[0, 0.5, 0]} role="Pitcher" color="#1E88E5" />
          <Player position={[0, 0, homeToMound + 4]} role="Catcher" color="#1E88E5" />
          <Player position={[-4, 0, homeToMound - 2]} role="Batter" color="#E53935" />

          {/* Corner infielders are pushed clearly off their bags (~18-20 ft) so a
              new game can never look like it has a runner already standing on
              1B / 3B. Standing right on the bag was causing first-time players to
              report "the game started with a player on third base". */}
          <Player position={[firstPos[0] - 14, 0, firstPos[2] - 14]} role="1B" color="#1E88E5" />
          <Player position={[25, 0, homeToMound - homeToSecond + 15]} role="2B" color="#1E88E5" />
          <Player position={[thirdPos[0] + 14, 0, thirdPos[2] - 14]} role="3B" color="#1E88E5" />
          <Player position={[-25, 0, homeToMound - homeToSecond + 15]} role="SS" color="#1E88E5" />
          <Player position={[-90, 0, homeToMound - 200]} role="LF" color="#1E88E5" />
          <Player position={[0, 0, homeToMound - 250]} role="CF" color="#1E88E5" />
          <Player position={[90, 0, homeToMound - 200]} role="RF" color="#1E88E5" />
        </>
      )}
      
      {/* Trees outside */}
      <Trees />
    </group>
  );
}

function LightTower({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 40, 0]} castShadow>
        <cylinderGeometry args={[2, 4, 80, 8]} />
        <meshStandardMaterial color="#78909C" />
      </mesh>
      <mesh position={[0, 80, 2]} rotation={[0.2, 0, 0]} castShadow>
        <boxGeometry args={[30, 15, 2]} />
        <meshStandardMaterial color="#37474F" />
      </mesh>
      {/* Lights proxy */}
      <mesh position={[0, 80, 3.5]} rotation={[0.2, 0, 0]}>
        <planeGeometry args={[25, 10]} />
        <meshBasicMaterial color="#FFF9C4" />
      </mesh>
    </group>
  );
}

/**
 * Light bouncing-idle figure planted on a base. Rendered when the play has
 * settled — for the visible run between bases see {@link AnimatedRunner}.
 *
 * `phantom` flips the figure to its gold/amber palette to represent runners
 * spawned by a card effect (b-135 Stolen Bag) rather than a real at-bat.
 * Without this distinction, a hit + Stolen Bag puts two identical red figures
 * on different bases after a single swing and the field reads as glitched.
 */
function Runner({
  position,
  phantom = false,
}: {
  position: [number, number, number];
  phantom?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.y =
      position[1] + Math.abs(Math.sin(state.clock.elapsedTime * 5 + position[0])) * 0.4;
  });
  return (
    <group ref={ref} position={position}>
      <RunnerBody phantom={phantom} />
    </group>
  );
}

/**
 * Shared visual for both static and animated runners.
 *
 * Sized noticeably taller than the fielders so the offensive runner stays
 * legible even when the camera is pulled wide for a hit. The bright red body
 * + emissive ground halo make the figure pop against the green grass and
 * brown dirt at every zoom level.
 */
function RunnerBody({ phantom = false }: { phantom?: boolean }) {
  const bodyColor = phantom ? PHANTOM_RUNNER_COLOR : RUNNER_TEAM_COLOR;
  const helmetColor = phantom ? PHANTOM_RUNNER_DARK : RUNNER_TEAM_DARK;
  return (
    <>
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[1.4, 1.4, 5.0, 10]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={bodyColor}
          emissiveIntensity={0.45}
          roughness={0.55}
        />
      </mesh>
      <mesh position={[0, 5.7, 0]} castShadow>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshStandardMaterial color="#FFCCBC" roughness={0.5} />
      </mesh>
      {/* Helmet on top so the head stands out from a fielder's cap. */}
      <mesh position={[0, 6.2, 0]} castShadow>
        <sphereGeometry args={[1.15, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={helmetColor} roughness={0.4} />
      </mesh>
      {/* Bright halo on the ground, in the team color. Larger and more opaque
          than the original so the runner is unmistakable from a wide camera. */}
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.4, 3.6, 32]} />
        <meshBasicMaterial color={bodyColor} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

interface AnimatedRunnerProps {
  move: RunnerMove;
  homeToMound: number;
  firstPos: [number, number, number];
  secondPos: [number, number, number];
  thirdPos: [number, number, number];
}

/**
 * Runner that travels from `move.from` to `move.to` along the basepath
 * (curving through any intermediate bases instead of cutting across the
 * infield). Once it arrives it parks at the destination, except for 'scored'
 * runners which fade out as they cross home plate so they don't pile up.
 *
 * Duration scales with how many bases are travelled so a homer feels longer
 * than a single, but is clamped so even the longest run finishes well under
 * what a real player would wait for the next at-bat.
 */
function AnimatedRunner({ move, homeToMound, firstPos, secondPos, thirdPos }: AnimatedRunnerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const matRefs = useRef<THREE.Material[]>([]);
  const startTimeRef = useRef<number | null>(null);

  // Phantom runners (currently only b-135 Stolen Bag's "anonymous" extra
  // runner) carry no specific drafted player. Tinted gold/amber so a single
  // + steal animates as two visibly different figures instead of looking
  // like a duplicated runner glitch.
  const phantom = move.player === null && move.kind === 'runner';
  const bodyColor = phantom ? PHANTOM_RUNNER_COLOR : RUNNER_TEAM_COLOR;
  const helmetColor = phantom ? PHANTOM_RUNNER_DARK : RUNNER_TEAM_DARK;

  // Build per-slot world positions. Runners sit slightly off the bag so they
  // don't z-fight with the BaseTarget meshes.
  const slotPositions: Record<BaseSlot, [number, number, number]> = useMemo(
    () => ({
      home: [0, 0, homeToMound],
      first: [firstPos[0] + 1, 0, firstPos[2] - 1],
      second: [secondPos[0] + 1, 0, secondPos[2] + 2],
      third: [thirdPos[0] - 1, 0, thirdPos[2] - 1],
      // Run a bit past home plate toward the catcher so scored runners exit
      // cleanly rather than overlapping the next play's batter at home.
      scored: [3, 0, homeToMound + 8],
      // Pickoff target: shuffle off the field toward the dugout (NOT home)
      // so the 3D scene reads as "runner retired" rather than "runner
      // crossed the plate". Mirror of `scored` on the opposite side.
      out: [-3, 0, homeToMound + 8],
    }),
    [homeToMound, firstPos, secondPos, thirdPos],
  );

  // Build the waypoint list by walking the running circuit from `from` to `to`.
  const waypoints = useMemo(() => buildBasePath(move.from, move.to, slotPositions), [
    move.from,
    move.to,
    slotPositions,
  ]);

  // Duration: ~1.6s per base traveled, capped at ~5.5s for a homer. Slower
  // than wall-clock baserunning but the goal is for the user to actually see
  // the journey rather than have it flash by.
  const segments = Math.max(1, waypoints.length - 1);
  const duration = Math.min(1.6 * segments, 5.5);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;

    if (startTimeRef.current === null) startTimeRef.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const t = Math.min(elapsed / duration, 1);

    const [px, , pz] = positionAlongPath(waypoints, t);
    g.position.x = px;
    g.position.z = pz;

    // Vertical bounce — bigger and faster while running, slower & smaller
    // once parked so the runner clearly "stops" at the destination.
    const running = t < 1;
    const bounceAmp = running ? 0.7 : 0.25;
    const bounceFreq = running ? 9 : 4;
    g.position.y = Math.abs(Math.sin(state.clock.elapsedTime * bounceFreq)) * bounceAmp;

    // Face the direction of travel so the figure leans into the run.
    if (running && waypoints.length > 1) {
      const lookAhead = positionAlongPath(waypoints, Math.min(t + 0.02, 1));
      const dx = lookAhead[0] - px;
      const dz = lookAhead[2] - pz;
      if (dx * dx + dz * dz > 1e-4) {
        g.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Scored runners fade away once they cross home so they don't linger.
    if (move.to === 'scored') {
      const fadeStart = 0.9;
      const fadeT = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
      for (const m of matRefs.current) {
        if ('opacity' in m) {
          m.transparent = true;
          (m as THREE.Material & { opacity: number }).opacity = fadeT;
        }
      }
      g.visible = fadeT > 0.01;
    }
  });

  // Capture material refs so we can fade scored runners.
  const collectMat = (m: THREE.Material | null) => {
    if (m && !matRefs.current.includes(m)) matRefs.current.push(m);
  };

  return (
    <group ref={groupRef} position={slotPositions[move.from]}>
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[1.4, 1.4, 5.0, 10]} />
        <meshStandardMaterial
          ref={(r) => collectMat(r as THREE.Material | null)}
          color={bodyColor}
          emissive={bodyColor}
          emissiveIntensity={0.55}
          roughness={0.55}
        />
      </mesh>
      <mesh position={[0, 5.7, 0]} castShadow>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshStandardMaterial
          ref={(r) => collectMat(r as THREE.Material | null)}
          color="#FFCCBC"
          roughness={0.5}
        />
      </mesh>
      <mesh position={[0, 6.2, 0]} castShadow>
        <sphereGeometry args={[1.15, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={(r) => collectMat(r as THREE.Material | null)}
          color={helmetColor}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.4, 3.6, 32]} />
        <meshBasicMaterial
          ref={(r) => collectMat(r as THREE.Material | null)}
          color={bodyColor}
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

const BASE_ORDER: BaseSlot[] = ['home', 'first', 'second', 'third', 'scored'];

function buildBasePath(
  from: BaseSlot,
  to: BaseSlot,
  positions: Record<BaseSlot, [number, number, number]>,
): [number, number, number][] {
  const fromIdx = BASE_ORDER.indexOf(from);
  const toIdx = BASE_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) {
    return [positions[from], positions[to]];
  }
  const path: [number, number, number][] = [];
  for (let i = fromIdx; i <= toIdx; i++) path.push(positions[BASE_ORDER[i]]);
  return path;
}

function positionAlongPath(
  waypoints: [number, number, number][],
  t: number,
): [number, number, number] {
  if (waypoints.length === 1) return waypoints[0];
  if (t <= 0) return waypoints[0];
  if (t >= 1) return waypoints[waypoints.length - 1];
  const segCount = waypoints.length - 1;
  const segT = t * segCount;
  const segIdx = Math.min(Math.floor(segT), segCount - 1);
  const localT = segT - segIdx;
  const a = waypoints[segIdx];
  const b = waypoints[segIdx + 1];
  return [
    a[0] + (b[0] - a[0]) * localT,
    a[1] + (b[1] - a[1]) * localT,
    a[2] + (b[2] - a[2]) * localT,
  ];
}

function ResultPulse({
  outcome,
  position,
  legendaryQuest = false,
}: {
  outcome: string | null;
  position: [number, number, number];
  legendaryQuest?: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const startRef = useRef<number | null>(null);
  const PULSE_LIFETIME = legendaryQuest ? 3.35 : 1.6;
  const colorMap: Record<string, string> = {
    homerun: '#FFC107',
    triple: '#10B981',
    double: '#0EA5E9',
    single: '#3B82F6',
    out: '#EF4444',
  };
  const color = (outcome && colorMap[outcome]) ?? '#94A3B8';

  useFrame((state) => {
    if (!ref.current || !matRef.current) return;
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const t = (state.clock.elapsedTime - startRef.current) / PULSE_LIFETIME;
    if (t > 1) {
      ref.current.scale.setScalar(0);
      matRef.current.opacity = 0;
      return;
    }
    const scale = legendaryQuest ? 6 + t * 110 : 4 + t * 80;
    ref.current.scale.setScalar(scale);
    matRef.current.opacity = 0.7 * (1 - t);
    if (legendaryQuest) {
      const hue = (state.clock.elapsedTime * 100) % 360;
      matRef.current.color.setHSL(hue / 360, 0.88, 0.52);
    } else {
      matRef.current.color.set(color);
    }
  });

  return (
    <mesh ref={ref} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.4, 0.55, 48]} />
      <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Trees() {
  const treePositions = useMemo(() => {
    const pos = [];
    for (let i = 0; i < 150; i++) {
       const theta = Math.random() * Math.PI * 2;
       const radius = 250 + Math.random() * 80;
       const x = Math.cos(theta) * radius;
       const z = Math.sin(theta) * radius;
       
       if (z < 0 && Math.abs(x) < 220) continue; // Keep outfield clear

       pos.push([x, 0, z]);
    }
    return pos;
  }, []);

  return (
    <group>
      {treePositions.map((p, i) => (
        <group key={i} position={p as any}>
          {/* Trunk */}
          <mesh position={[0, 4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[1.5, 2, 8, 6]} />
            <meshStandardMaterial color="#5D4037" />
          </mesh>
          {/* Leaves */}
          <mesh position={[0, 15, 0]} castShadow receiveShadow>
            <coneGeometry args={[8, 25, 6]} />
            <meshStandardMaterial color="#2E7D32" roughness={0.9} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  )
}
