/**
 * BrawlImpactCanvas — fullscreen react-three-fiber overlay that draws the
 * "card smashes into HP pill" spectacle for Brawl Mode.
 *
 * Design constraints:
 *   - The cards themselves fly via DOM / Framer Motion (handled by
 *     `BrawlAttackReveal`). This canvas is *purely* the VFX layer that
 *     fires on top of the existing UI -- additive particle bursts, a
 *     scaling shockwave ring per impact, ambient sparkle aura around the
 *     two HP pills.
 *   - The Canvas paints into a fixed-position layer above the field but
 *     below the result banner (z handled at the parent mount site).
 *   - Coordinates: an orthographic camera matched to the viewport so
 *     (0,0) is screen center, x grows right, y grows up. The parent
 *     passes impact events in *raw screen-space pixels relative to the
 *     viewport*, and we recenter them inside `worldFromScreen`.
 *   - Pointer events are blocked at the canvas DOM level so the VFX
 *     overlay never steals controller / mouse input from the cards
 *     underneath it.
 *
 * Lifecycle:
 *   - Impacts arrive as objects with `id`, `x`, `y`, `power`, `bornAt`.
 *     We render them as long as `now - bornAt < IMPACT_LIFETIME_MS`.
 *     Parent is expected to garbage-collect stale entries from its own
 *     queue; we render whatever is in the prop array.
 *   - Ambient sparkles + pill auras are perpetual (only rendered while
 *     the canvas itself is mounted, i.e. only during the brawl reveal
 *     phase).
 */

import { useFrame, useThree, Canvas } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BrawlImpact {
  /** Stable id so React can match repeated bursts at the same coordinate. */
  id: string;
  /** Screen-space x in CSS pixels, relative to the canvas DOM rect. */
  x: number;
  /** Screen-space y in CSS pixels, relative to the canvas DOM rect. */
  y: number;
  /** The "damage" delivered. Drives burst intensity (particle count,
   *  shockwave scale, primary color). 1 -> small ping, 10+ -> heavy hit. */
  power: number;
  /** `performance.now()` snapshot when the impact spawned. */
  bornAt: number;
  /**
   * Which side took the hit (defender side). Drives tinting:
   *   - "user": amber/orange (we hit them with our power)
   *   - "opponent": rose/red (they hit us)
   */
  defender: "user" | "opponent";
  /** Optional "grand slam" flag — escalates particle count + ring scale + a
   *  rainbow tint so a 21+ HP swing reads as the apex spectacle. */
  grand?: boolean;
  /** Element that landed — drives burst palette. */
  element?: "fire" | "poison" | "freeze" | "volt" | "shield" | "heal";
}

export interface BrawlAura {
  /** "user" -> hover near the user pill; "opponent" -> hover near the AI pill. */
  side: "user" | "opponent";
  /** Screen-space pixel position of the pill center (top-left origin). */
  x: number;
  y: number;
  /** When the side has been "depleted" (HP hit 0) we dim the aura. */
  defeated?: boolean;
}

interface BrawlImpactCanvasProps {
  impacts: BrawlImpact[];
  auras: BrawlAura[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const IMPACT_LIFETIME_MS = 900;
const SHOCKWAVE_LIFETIME_MS = 700;
const PARTICLE_COUNT_BASE = 36;
const PARTICLE_COUNT_PER_POWER = 8;
const PARTICLE_COUNT_MAX = 160;

const IMPACT_ELEMENT_TONE: Record<
  string,
  { ring: string; spark: string; flash: string }
> = {
  fire: { ring: "#fb923c", spark: "#f97316", flash: "#fff7ed" },
  poison: { ring: "#c084fc", spark: "#a855f7", flash: "#f5f3ff" },
  freeze: { ring: "#38bdf8", spark: "#7dd3fc", flash: "#f0f9ff" },
  volt: { ring: "#fbbf24", spark: "#f59e0b", flash: "#fffbeb" },
};

function impactPalette(impact: BrawlImpact): {
  ring: string;
  spark: string;
  flash: string;
} {
  if (impact.grand) {
    return { ring: "#fffbe6", spark: "#fde68a", flash: "#ffffff" };
  }
  if (impact.element && IMPACT_ELEMENT_TONE[impact.element]) {
    return IMPACT_ELEMENT_TONE[impact.element];
  }
  return impact.defender === "user"
    ? { ring: "#f87171", spark: "#ff5470", flash: "#ffffff" }
    : { ring: "#fbbf24", spark: "#fcd34d", flash: "#ffffff" };
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function BrawlImpactCanvas({ impacts, auras }: BrawlImpactCanvasProps) {
  if (impacts.length === 0 && auras.length === 0) {
    return null;
  }
  // `pointer-events: none` so the VFX overlay never steals a click that
  // belonged to the hand strip / pills underneath it. The canvas just
  // paints transparent pixels on top of the existing DOM. The z value
  // sits above the gameplay overlay (cards / pills, z-40 / z-50) but
  // below the `HitResultBanner` (z-32 in DOM-order but renders later
  // chronologically -- brawl reveal completes before the banner mounts
  // so they never actually compete for stacking).
  return (
    <div className="absolute inset-0 pointer-events-none z-[51] bg-transparent" aria-hidden="true">
      <Canvas
        // Transparent so the field + cards underneath show through.
        gl={{
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
        }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
        orthographic
        camera={{ position: [0, 0, 500], zoom: 1, near: 0.1, far: 2000 }}
        frameloop="always"
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          background: "transparent",
        }}
      >
        <ScreenSpaceCamera />
        {/* Ambient lift so the sparkles / shockwave rings don't read flat. */}
        <ambientLight intensity={0.55} />
        {/* A subtle directional light tilts the highlights on the
            shockwave rings -- not strictly required since most materials
            are basic/additive, but the small specular gives the metallic
            ring a hint of depth. */}
        <directionalLight position={[80, 200, 200]} intensity={0.4} />

        {auras.map((a) => (
          <PillAura key={a.side} aura={a} />
        ))}

        {impacts.map((imp) => (
          <ImpactCluster key={imp.id} impact={imp} />
        ))}
      </Canvas>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Camera helper — rescale ortho frustum to match canvas in pixels.
// ---------------------------------------------------------------------------

/**
 * Keeps the orthographic camera's frustum locked to the canvas's pixel
 * dimensions so anything we render at world-space (x,y) lands on the
 * matching CSS pixel. Re-runs on every resize via the R3F `viewport`
 * subscription.
 */
function ScreenSpaceCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    ortho.zoom = 1;
    ortho.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

/**
 * Convert a DOM-space screen pixel (top-left origin) to the canvas's
 * world-space (center origin, +y up).
 */
function worldFromScreen(
  xPx: number,
  yPx: number,
  width: number,
  height: number,
): [number, number] {
  return [xPx - width / 2, height / 2 - yPx];
}

// ---------------------------------------------------------------------------
// Per-impact cluster: shockwave ring + radial sparks + bright core flash.
// ---------------------------------------------------------------------------

function ImpactCluster({ impact }: { impact: BrawlImpact }) {
  const { size } = useThree();
  const [wx, wy] = worldFromScreen(impact.x, impact.y, size.width, size.height);

  // Particle count scales with impact power -- a single contact card
  // is a small ping, a chained 4-card power bomb is a full eruption.
  const particleCount = Math.min(
    PARTICLE_COUNT_MAX,
    PARTICLE_COUNT_BASE +
      Math.floor(Math.max(0, impact.power) * PARTICLE_COUNT_PER_POWER) +
      (impact.grand ? 60 : 0),
  );

  const palette = impactPalette(impact);

  return (
    <group position={[wx, wy, 0]}>
      <ShockwaveRing impact={impact} palette={palette} />
      <ImpactSparks impact={impact} count={particleCount} palette={palette} />
      <CoreFlash impact={impact} palette={palette} />
      {impact.element && impact.element !== "shield" && impact.element !== "heal" && (
        <Sparkles
          count={12 + Math.floor(impact.power)}
          size={5}
          speed={1.4}
          scale={[90 + impact.power * 4, 90 + impact.power * 4, 30]}
          color={palette.spark}
          opacity={0.9}
          noise={2}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Shockwave ring — expanding torus that fades out fast.
// ---------------------------------------------------------------------------

function ShockwaveRing({
  impact,
  palette,
}: {
  impact: BrawlImpact;
  palette: ReturnType<typeof impactPalette>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  // Inner / outer ring radii (world units == px). A heavy hit punches
  // a bigger ring than a glancing impact.
  const finalRadius = useMemo(
    () => 60 + Math.max(0, impact.power) * 10 + (impact.grand ? 90 : 0),
    [impact.power, impact.grand],
  );

  const color = palette.ring;

  useFrame(() => {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const t = Math.min(1, (now - impact.bornAt) / SHOCKWAVE_LIFETIME_MS);
    if (!meshRef.current || !matRef.current) return;
    // Cubic ease-out so the ring punches outward fast then settles.
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 0.25 + eased * (finalRadius / 100);
    meshRef.current.scale.setScalar(scale);
    matRef.current.opacity = (1 - t) * 0.9;
  });

  // Ring base size = 100 world units; we scale this up to `finalRadius`.
  // Using `ringGeometry` keeps the shape view-aligned regardless of camera
  // tilt (we render the canvas head-on so this is fine).
  return (
    <mesh ref={meshRef} renderOrder={2}>
      <ringGeometry args={[44, 50, 64]} />
      <meshBasicMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Radial spark spray.
// ---------------------------------------------------------------------------

function ImpactSparks({
  impact,
  count,
  palette,
}: {
  impact: BrawlImpact;
  count: number;
  palette: ReturnType<typeof impactPalette>;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);

  // Each spark needs a stable initial velocity + jitter. We pre-bake them
  // into a typed array and tween everything in `useFrame` against the
  // impact's `bornAt` timestamp.
  const { positions, velocities, lifetimes } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Mostly horizontal spray with a slight upward bias (sparks fly out
      // and *up*, like sword sparks in a fighting game). Each particle
      // gets a random magnitude so the front of the burst looks ragged.
      const angle = Math.random() * Math.PI * 2;
      const mag = 80 + Math.random() * 320 + Math.max(0, impact.power) * 18;
      velocities[i * 3 + 0] = Math.cos(angle) * mag;
      velocities[i * 3 + 1] = Math.sin(angle) * mag + 60;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 30;
      lifetimes[i] = 0.45 + Math.random() * 0.55;
      // Start at the impact center; we'll integrate forward in useFrame.
      positions[i * 3 + 0] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
    }
    return { positions, velocities, lifetimes };
  }, [count, impact.power]);

  const color = palette.spark;

  useFrame(() => {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const tGlobal = Math.min(1, (now - impact.bornAt) / IMPACT_LIFETIME_MS);
    if (!pointsRef.current || !matRef.current) return;

    const geom = pointsRef.current.geometry as THREE.BufferGeometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    // Gravity pulls sparks back down so the spray reads as physical
    // rather than perfectly radial.
    const gravity = -1100;
    for (let i = 0; i < count; i++) {
      const life = lifetimes[i];
      const t = Math.min(1, tGlobal / life);
      // x = v*t, y = v*t + 0.5*g*t^2, z = vz*t.
      const tt = t * 0.85; // wall-clock scaling so sparks slow before fade
      arr[i * 3 + 0] = velocities[i * 3 + 0] * tt;
      arr[i * 3 + 1] =
        velocities[i * 3 + 1] * tt + 0.5 * gravity * tt * tt;
      arr[i * 3 + 2] = velocities[i * 3 + 2] * tt;
    }
    posAttr.needsUpdate = true;

    // Opacity fades cubically so the burst flashes bright at peak and
    // melts to nothing in the last frames.
    matRef.current.opacity = Math.max(0, Math.pow(1 - tGlobal, 1.6));
    // Size shrinks across the lifetime so trails read as comet-like.
    matRef.current.size = 9 - tGlobal * 5;
  });

  return (
    <points ref={pointsRef} renderOrder={3} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={9}
        sizeAttenuation
        transparent
        opacity={1}
        depthWrite={false}
        color={color}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ---------------------------------------------------------------------------
// Central bright "flash" disc at the impact center.
// ---------------------------------------------------------------------------

function CoreFlash({
  impact,
  palette,
}: {
  impact: BrawlImpact;
  palette: ReturnType<typeof impactPalette>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    // The flash is the FASTEST element of the cluster -- ~180ms of bright
    // bloom-like white at peak. Anything longer ends up muddying the
    // shockwave ring + spark spray.
    const t = Math.min(1, (now - impact.bornAt) / 180);
    if (!meshRef.current || !matRef.current) return;
    const eased = Math.pow(1 - t, 2);
    const scale = 0.6 + eased * 1.6 + (impact.grand ? 0.8 : 0);
    meshRef.current.scale.setScalar(scale);
    matRef.current.opacity = eased;
  });

  return (
    <mesh ref={meshRef} renderOrder={4}>
      <circleGeometry args={[28, 32]} />
      <meshBasicMaterial
        ref={matRef}
        color={palette.flash}
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Ambient sparkle aura around each HP pill.
// ---------------------------------------------------------------------------

/**
 * Floating glitter near each side's HP pill. Uses Drei's `<Sparkles>`
 * which gives us animated, depth-aware glints "for free". When the side
 * has been defeated (HP=0) we shrink + dim the aura so the surviving
 * pill is the one that draws the eye.
 */
function PillAura({ aura }: { aura: BrawlAura }) {
  const { size } = useThree();
  const [wx, wy] = worldFromScreen(aura.x, aura.y, size.width, size.height);
  const color =
    aura.side === "user"
      ? "#fbbf24" /* amber-400, our pill */
      : "#fda4af" /* rose-300, opponent pill */;
  const scale = aura.defeated ? 0.5 : 1;
  return (
    <group position={[wx, wy, 0]} scale={scale}>
      <Sparkles
        count={aura.defeated ? 6 : 22}
        size={4}
        speed={aura.defeated ? 0.15 : 0.55}
        scale={[180, 90, 30]}
        color={color}
        opacity={aura.defeated ? 0.3 : 0.85}
        noise={1}
      />
    </group>
  );
}
