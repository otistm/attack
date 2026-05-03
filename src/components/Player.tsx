import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function Player({ position, role, color }: { position: [number, number, number], role: string, color: string }) {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Simple idle animation
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2 + position[0]) * 0.2;
    }
  });

  return (
    <group 
      position={position} 
      ref={meshRef}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Body: cylinder height 4.5 ft */}
      <mesh position={[0, 2.25, 0]} castShadow>
        <cylinderGeometry args={[1.2, 1.2, 4.5, 8]} />
        <meshStandardMaterial color={hovered ? '#FFF' : color} roughness={0.6} />
      </mesh>
      {/* Head: diameter 2 ft */}
      <mesh position={[0, 5.5, 0]} castShadow>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial color="#FFCCBC" roughness={0.5} />
      </mesh>
      {/* Selection indicator */}
      {hovered && (
        <mesh position={[0, 8.5, 0]}>
          <coneGeometry args={[0.8, 1.5, 4]} />
          <meshStandardMaterial color="#FFEB3B" />
        </mesh>
      )}
    </group>
  );
}
