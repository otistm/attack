import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BaseTargetProps {
  position: [number, number, number];
  isHome?: boolean;
  occupied?: boolean;
}

export function BaseTarget({ position, isHome = false, occupied = false }: BaseTargetProps) {
  const [hovered, setHovered] = useState(false);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  const rotation: [number, number, number] = isHome
    ? [0, Math.PI / 10, 0]
    : [-Math.PI / 2, 0, Math.PI / 4];

  // Pulsing emissive when occupied so the base reads as "live" without
  // changing the bag color away from white. Tinted to the runner's team color
  // (red) so it visually ties to the runner standing on it.
  useFrame((state) => {
    if (!matRef.current) return;
    if (occupied) {
      const pulse = 0.35 + Math.sin(state.clock.elapsedTime * 4) * 0.2;
      matRef.current.emissiveIntensity = pulse;
    } else {
      matRef.current.emissiveIntensity = 0;
    }
  });

  // Bases stay white in all states; the only feedback for "occupied" is the
  // red emissive pulse. Hover gives a subtle warm tint.
  const baseColor = hovered ? '#FFF7ED' : '#FFFFFF';
  const emissiveColor = occupied ? '#E53935' : '#000000';

  return (
    <mesh
      position={position}
      rotation={rotation}
      receiveShadow
      castShadow
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {isHome ? (
        <cylinderGeometry args={[2.1, 2.1, 0.2, 5]} />
      ) : (
        <boxGeometry args={[3, 3, 0.2]} />
      )}
      <meshStandardMaterial
        ref={matRef}
        color={baseColor}
        emissive={emissiveColor}
        emissiveIntensity={occupied ? 0.5 : 0}
        roughness={0.5}
      />
    </mesh>
  );
}
