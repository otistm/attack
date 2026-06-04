/**
 * R3F element bursts on activating cards during brawl reveal.
 */
import { useFrame, useThree, Canvas } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Element } from "../../lib/brawlElements";

export interface CardElementFx {
  id: string;
  element: Element;
  x: number;
  y: number;
  w: number;
  h: number;
  bornAt: number;
}

const FX_LIFETIME_MS = 1100;

const ELEMENT_PALETTE: Record<
  Exclude<Element, "shield" | "heal">,
  { core: string; glow: string; spark: string }
> = {
  fire: { core: "#fb923c", glow: "#f97316", spark: "#fde047" },
  poison: { core: "#a855f7", glow: "#7c3aed", spark: "#86efac" },
  freeze: { core: "#7dd3fc", glow: "#38bdf8", spark: "#e0f2fe" },
  volt: { core: "#fbbf24", glow: "#f59e0b", spark: "#fef08a" },
};

export function BrawlCardElementFxCanvas({
  bursts,
}: {
  bursts: CardElementFx[];
}) {
  if (bursts.length === 0) return null;
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <Canvas
        gl={{ alpha: true, antialias: true, premultipliedAlpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        orthographic
        camera={{ position: [0, 0, 500], near: 0.1, far: 2000 }}
        frameloop="always"
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          background: "transparent",
        }}
      >
        <ScreenSpaceCamera />
        <ambientLight intensity={0.65} />
        <pointLight position={[0, 80, 120]} intensity={0.9} color="#ffffff" />
        {bursts.map((b) => (
          <CardElementBurst key={b.id} burst={b} />
        ))}
      </Canvas>
    </div>
  );
}

function ScreenSpaceCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    ortho.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function worldFromScreen(
  xPx: number,
  yPx: number,
  width: number,
  height: number,
): [number, number] {
  return [xPx - width / 2, height / 2 - yPx];
}

function CardElementBurst({ burst }: { burst: CardElementFx }) {
  const { size } = useThree();
  const [wx, wy] = worldFromScreen(burst.x, burst.y, size.width, size.height);
  const scale = Math.max(0.85, Math.min(1.35, (burst.w + burst.h) / 160));
  const palette =
    burst.element === "shield" || burst.element === "heal"
      ? ELEMENT_PALETTE.fire
      : ELEMENT_PALETTE[burst.element];

  return (
    <group position={[wx, wy, 0]} scale={scale}>
      <ElementEnvelope burst={burst} palette={palette} />
      {burst.element === "fire" && <FireBurst burst={burst} palette={palette} />}
      {burst.element === "poison" && (
        <PoisonBurst burst={burst} palette={palette} />
      )}
      {burst.element === "freeze" && (
        <FreezeBurst burst={burst} palette={palette} />
      )}
      {burst.element === "volt" && <VoltBurst burst={burst} palette={palette} />}
    </group>
  );
}

function ElementEnvelope({
  burst,
  palette,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["fire"];
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const hw = burst.w * 0.52;
  const hh = burst.h * 0.58;

  useFrame(() => {
    const t = Math.min(
      1,
      (performance.now() - burst.bornAt) / FX_LIFETIME_MS,
    );
    if (!meshRef.current || !matRef.current) return;
    const pulse = 1 + Math.sin(t * Math.PI * 4) * 0.08 * (1 - t);
    meshRef.current.scale.set(hw * pulse, hh * pulse, 1);
    matRef.current.opacity = (1 - t) * 0.55;
  });

  return (
    <mesh ref={meshRef} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        color={palette.glow}
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

function FireBurst({
  burst,
  palette,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["fire"];
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const t = Math.min(1, (performance.now() - burst.bornAt) / FX_LIFETIME_MS);
    if (groupRef.current) groupRef.current.position.y = t * 28;
  });

  return (
    <group ref={groupRef}>
      <Sparkles
        count={36}
        size={5}
        speed={1.2}
        scale={[burst.w * 0.9, burst.h * 1.1, 40]}
        color={palette.core}
        opacity={0.95}
        noise={2}
      />
      <FlameParticles burst={burst} palette={palette} count={28} />
    </group>
  );
}

function PoisonBurst({
  burst,
  palette,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["poison"];
}) {
  return (
    <>
      <Sparkles
        count={30}
        size={4}
        speed={0.65}
        scale={[burst.w, burst.h * 1.2, 30]}
        color={palette.spark}
        opacity={0.9}
        noise={1.5}
      />
      <DripParticles burst={burst} palette={palette} count={22} rise={false} />
    </>
  );
}

function FreezeBurst({
  burst,
  palette,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["freeze"];
}) {
  return (
    <>
      <Sparkles
        count={26}
        size={3.5}
        speed={0.4}
        scale={[burst.w * 1.05, burst.h, 25]}
        color={palette.spark}
        opacity={0.85}
        noise={0.8}
      />
      <ShardParticles burst={burst} palette={palette} count={18} />
    </>
  );
}

function VoltBurst({
  burst,
  palette,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["volt"];
}) {
  return (
    <>
      <Sparkles
        count={24}
        size={6}
        speed={2.4}
        scale={[burst.w * 1.1, burst.h * 1.1, 35]}
        color={palette.spark}
        opacity={1}
        noise={3}
      />
      <LightningFork burst={burst} palette={palette} />
      <FlameParticles burst={burst} palette={palette} count={20} />
    </>
  );
}

function FlameParticles({
  burst,
  palette,
  count,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["fire"];
  count: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      velocities[i * 3] = (Math.random() - 0.5) * 40;
      velocities[i * 3 + 1] = 60 + Math.random() * 120;
      velocities[i * 3 + 2] = 0;
    }
    return { positions, velocities };
  }, [count]);

  useFrame(() => {
    const t = Math.min(1, (performance.now() - burst.bornAt) / FX_LIFETIME_MS);
    if (!pointsRef.current || !matRef.current) return;
    const geom = pointsRef.current.geometry as THREE.BufferGeometry;
    const arr = geom.getAttribute("position").array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] = velocities[i * 3] * t;
      arr[i * 3 + 1] = velocities[i * 3 + 1] * t - 80 * t * t;
      arr[i * 3 + 2] = 0;
    }
    geom.getAttribute("position").needsUpdate = true;
    matRef.current.opacity = Math.pow(1 - t, 1.4);
  });

  return (
    <points ref={pointsRef} renderOrder={5} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={7}
        color={palette.core}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function DripParticles({
  burst,
  palette,
  count,
  rise,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["poison"];
  count: number;
  rise: boolean;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const velocities = useMemo(() => {
    const v = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      v[i * 3] = (Math.random() - 0.5) * 50;
      v[i * 3 + 1] = rise ? 40 + Math.random() * 80 : -30 - Math.random() * 90;
      v[i * 3 + 2] = 0;
    }
    return v;
  }, [count, rise]);

  useFrame(() => {
    const t = Math.min(1, (performance.now() - burst.bornAt) / FX_LIFETIME_MS);
    if (!pointsRef.current || !matRef.current) return;
    const arr = (pointsRef.current.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] = velocities[i * 3] * t;
      arr[i * 3 + 1] = velocities[i * 3 + 1] * t;
    }
    pointsRef.current.geometry.getAttribute("position").needsUpdate = true;
    matRef.current.opacity = (1 - t) * 0.9;
  });

  const positions = useMemo(() => new Float32Array(count * 3), [count]);

  return (
    <points ref={pointsRef} renderOrder={5}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={6}
        color={palette.core}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

function ShardParticles({
  burst,
  palette,
  count,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["freeze"];
  count: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        angle: Math.random() * Math.PI * 2,
        dist: 20 + Math.random() * 55,
        spin: (Math.random() - 0.5) * 6,
      })),
    [count],
  );

  useFrame(() => {
    const t = Math.min(1, (performance.now() - burst.bornAt) / FX_LIFETIME_MS);
    if (!meshRef.current) return;
    for (let i = 0; i < count; i++) {
      const s = seeds[i]!;
      const drift = t * 35;
      dummy.position.set(
        Math.cos(s.angle) * (s.dist + drift * 0.3),
        Math.sin(s.angle) * (s.dist * 0.6) + drift * 0.5,
        0,
      );
      dummy.rotation.z = s.spin * t;
      dummy.scale.setScalar(0.35 + (1 - t) * 0.5);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = (1 - t) * 0.85;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} renderOrder={4}>
      <planeGeometry args={[10, 18]} />
      <meshBasicMaterial
        color={palette.spark}
        transparent
        opacity={0.8}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

function LightningFork({
  burst,
  palette,
}: {
  burst: CardElementFx;
  palette: (typeof ELEMENT_PALETTE)["volt"];
}) {
  const lineRef = useRef<THREE.Line>(null);
  const points = useMemo(() => {
    const verts: THREE.Vector3[] = [new THREE.Vector3(0, -burst.h * 0.35, 0)];
    let x = 0;
    let y = -burst.h * 0.35;
    for (let i = 0; i < 6; i++) {
      x += (Math.random() - 0.5) * 28;
      y += burst.h * 0.12 + Math.random() * 18;
      verts.push(new THREE.Vector3(x, y, 0));
    }
    return new THREE.BufferGeometry().setFromPoints(verts);
  }, [burst.h]);

  useFrame(() => {
    const t = Math.min(1, (performance.now() - burst.bornAt) / FX_LIFETIME_MS);
    const mat = lineRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (mat) {
      mat.opacity = t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) * 2.2);
    }
    if (lineRef.current) {
      lineRef.current.visible = Math.floor(t * 24) % 2 === 0 || t < 0.12;
    }
  });

  return (
    <line ref={lineRef} geometry={points} renderOrder={6}>
      <lineBasicMaterial
        color={palette.spark}
        transparent
        opacity={1}
        linewidth={2}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </line>
  );
}
