'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const TEMP_OBJ = new THREE.Object3D();
const TEMP_COLOR = new THREE.Color();

export function InstancedCompetencyStars({ 
  starPositions, 
  hoveredId, 
  activeCategory, 
  selectedId 
}: any) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = starPositions.length;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;

    starPositions.forEach((data: any, i: number) => {
      const { competency, position } = data;
      const isHero = hoveredId === competency.id || selectedId === competency.id;
      const isActiveCategory = activeCategory === competency.category.name;

      // 1. SCALE: Small world units, but we'll use overdrive color to keep them visible
      let scale = isHero ? 0 : (isActiveCategory ? 0.15 : 0.1);
      
      TEMP_OBJ.position.copy(position);
      // Neutral Z, we will handle layering via renderOrder instead of physical distance
      TEMP_OBJ.position.z = position.z; 
      TEMP_OBJ.scale.setScalar(scale);
      TEMP_OBJ.updateMatrix();
      meshRef.current!.setMatrixAt(i, TEMP_OBJ.matrix);

      // 2. COLOR: Overdrive colors help dots "survive" the fog at distance
      if (isActiveCategory) {
        TEMP_COLOR.set('#00ffff').multiplyScalar(2.0); 
      } else {
        TEMP_COLOR.set('#446688').multiplyScalar(0.8); 
      }
      meshRef.current!.setColorAt(i, TEMP_COLOR);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[null, null, count]} 
      frustumCulled={false}
      renderOrder={10} // Forces stars to draw AFTER the backdrops
    >
      <sphereGeometry args={[1, 8, 8]} /> 
      <meshBasicMaterial 
        transparent 
        opacity={1.0} 
        depthTest={true}   // Still check depth so they hide behind icons
        depthWrite={false}  // But don't block other stars/backdrops
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}