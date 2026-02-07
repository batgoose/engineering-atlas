'use client';

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const TEMP_OBJ = new THREE.Object3D();

export function BackgroundStars({ count = 400 }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const starData = useMemo(() => {
    return Array.from({ length: count }, () => ({
      pos: new THREE.Vector3(
        (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 80
      ),
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random()
    }));
  }, [count]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    
    starData.forEach((star, i) => {
      
      const twinkle = 0.8 + Math.sin(clock.elapsedTime * star.speed + star.phase) * 0.2;
      TEMP_OBJ.position.copy(star.pos);
      TEMP_OBJ.scale.setScalar(twinkle);
      TEMP_OBJ.updateMatrix();
      meshRef.current!.setMatrixAt(i, TEMP_OBJ.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <sphereGeometry args={[0.06, 4, 4]} />
      <meshBasicMaterial color="#334466" transparent opacity={0.6} />
    </instancedMesh>
  );
}