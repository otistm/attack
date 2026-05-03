import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Sky } from '@react-three/drei';
import { Suspense } from 'react';
import { Stadium } from './Stadium';
import { CameraRig } from './CameraRig';

export function Scene() {
  return (
    <div className="w-full h-full absolute inset-0 bg-sky-200">
      <Canvas shadows dpr={[1, 2]}>
        <Suspense fallback={null}>
          <CameraRig />

          <OrbitControls
            makeDefault
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minPolarAngle={0.4}
            maxPolarAngle={Math.PI / 3}
            target={[0, 0, 0]}
          />
          
          <ambientLight intensity={0.5} />
          <directionalLight 
            position={[50, 100, 20]} 
            intensity={1.5} 
            castShadow 
            shadow-mapSize={[2048, 2048]} 
          >
            <orthographicCamera attach="shadow-camera" args={[-100, 100, 100, -100, 0.1, 500]} />
          </directionalLight>

          <Stadium />

          <ContactShadows resolution={1024} scale={150} blur={2} opacity={0.4} far={20} />
          <Sky sunPosition={[50, 100, 20]} inclination={0.2} azimuth={0.25} />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}
