// @ts-nocheck
'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { CompetencyNode } from '@atlas/types';

const TEMP_OBJ = new THREE.Object3D();
const TEMP_COLOR = new THREE.Color();

type StarPosition = {
  competency: CompetencyNode;
  position: THREE.Vector3;
};

interface InstancedCompetencyStarsProps {
  starPositions: StarPosition[];
  hoveredId: string | null;
  activeCategory: string | null;
  selectedId: string | null;
}

export function InstancedCompetencyStars({
  starPositions,
  hoveredId,
  activeCategory,
  selectedId,
}: InstancedCompetencyStarsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = starPositions.length;

  useFrame(() => {
    if (!meshRef.current) return;

    starPositions.forEach((data, i) => {
      const { competency, position } = data;
      const isHero = hoveredId === competency.id || selectedId === competency.id;
      const isActiveCategory = activeCategory === competency.category.name;

      let scale = isHero ? 0 : isActiveCategory ? 0.15 : 0.1;

      TEMP_OBJ.position.copy(position);

      TEMP_OBJ.position.z = position.z;
      TEMP_OBJ.scale.setScalar(scale);
      TEMP_OBJ.updateMatrix();
      meshRef.current!.setMatrixAt(i, TEMP_OBJ.matrix);

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
      args={[undefined as any, undefined as any, count]}
      frustumCulled={false}
      renderOrder={10}
    >
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial
        transparent
        opacity={1.0}
        depthTest={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}
