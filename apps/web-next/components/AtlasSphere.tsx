'use client';

import { useRef, useState, useEffect, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { 
  fibonacciSphere, 
  getIconDataUrl,
  getFilteredSphereScale,
} from '@atlas/ui/atlas';
import type { CompetencyNode } from '@atlas/types';

// ============================================================
// Types
// ============================================================

interface AtlasSphereProps {
  competencies: CompetencyNode[];
  selectedIds: Set<string>;
  onCompetencyClick?: (competency: CompetencyNode) => void;
  onCompetencyHover?: (competency: CompetencyNode | null) => void;
  autoRotate?: boolean;
}

// ============================================================
// Constants
// ============================================================

const SPHERE_RADIUS = 4;
const SPHERE_CENTER = new THREE.Vector3(0, 0, 0);
const ICON_SIZE = 0.65;

// ============================================================
// Main Component (just the sphere - grid is handled by parent)
// ============================================================

export function AtlasSphere({
  competencies,
  selectedIds,
  onCompetencyClick,
  onCompetencyHover,
  autoRotate = true,
}: AtlasSphereProps) {
  // Filter to only unselected competencies for the sphere
  const sphereCompetencies = useMemo(() => {
    return competencies.filter((c) => !selectedIds.has(c.id));
  }, [competencies, selectedIds]);

  // Calculate sphere scale based on how many remain
  const sphereScale = useMemo(() => {
    if (selectedIds.size === 0) return 1;
    return Math.max(0.7, getFilteredSphereScale(competencies.length, sphereCompetencies.length));
  }, [competencies.length, sphereCompetencies.length, selectedIds.size]);

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 12], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} />
          <pointLight position={[10, 10, 10]} intensity={0.6} />
          <pointLight position={[-10, -10, -10]} intensity={0.3} />
          <SphereContent
            competencies={sphereCompetencies}
            sphereScale={sphereScale}
            onCompetencyClick={onCompetencyClick}
            onCompetencyHover={onCompetencyHover}
            autoRotate={autoRotate}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

// ============================================================
// Sphere Content (only the rotating sphere with unselected icons)
// ============================================================

function SphereContent({
  competencies,
  sphereScale,
  onCompetencyClick,
  onCompetencyHover,
  autoRotate,
}: {
  competencies: CompetencyNode[];
  sphereScale: number;
  onCompetencyClick?: (c: CompetencyNode) => void;
  onCompetencyHover?: (c: CompetencyNode | null) => void;
  autoRotate: boolean;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Calculate positions on sphere
  const positions = useMemo(() => {
    const points = fibonacciSphere(competencies.length, SPHERE_RADIUS * sphereScale);
    return competencies.map((comp, i) => ({
      competency: comp,
      position: new THREE.Vector3(points[i].x, points[i].y, points[i].z),
    }));
  }, [competencies, sphereScale]);

  const handleHover = (competency: CompetencyNode | null) => {
    setHoveredId(competency?.id ?? null);
    onCompetencyHover?.(competency);
  };

  const shouldAutoRotate = autoRotate && !hoveredId;

  return (
    <>
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={7}
        maxDistance={20}
        autoRotate={shouldAutoRotate}
        autoRotateSpeed={0.5}
        target={SPHERE_CENTER}
      />

      <group position={SPHERE_CENTER}>
        {/* Wireframe sphere */}
        <mesh scale={sphereScale}>
          <sphereGeometry args={[SPHERE_RADIUS * 0.98, 32, 32]} />
          <meshBasicMaterial
            color="#1e3a5f"
            wireframe
            transparent
            opacity={0.15}
          />
        </mesh>

        {/* Icons on sphere */}
        {positions.map(({ competency, position }) => (
          <SphereIcon
            key={competency.id}
            competency={competency}
            position={position}
            isHovered={hoveredId === competency.id}
            onHover={handleHover}
            onClick={onCompetencyClick}
          />
        ))}
      </group>
    </>
  );
}

// ============================================================
// Sphere Icon
// ============================================================

function SphereIcon({
  competency,
  position,
  isHovered,
  onHover,
  onClick,
}: {
  competency: CompetencyNode;
  position: THREE.Vector3;
  isHovered: boolean;
  onHover: (c: CompetencyNode | null) => void;
  onClick?: (c: CompetencyNode) => void;
}) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const scaleRef = useRef(ICON_SIZE);

  useEffect(() => {
    const dataUrl = getIconDataUrl(competency.id);
    const loader = new THREE.TextureLoader();
    loader.load(dataUrl, (tex) => {
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      setTexture(tex);
    });
  }, [competency.id]);

  useFrame(() => {
    if (!spriteRef.current) return;
    const targetScale = isHovered ? ICON_SIZE * 1.4 : ICON_SIZE;
    scaleRef.current += (targetScale - scaleRef.current) * 0.15;
    spriteRef.current.scale.setScalar(scaleRef.current);
  });

  if (!texture) return null;

  return (
    <group position={position}>
      <sprite
        ref={spriteRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(competency);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = 'default';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(competency);
        }}
      >
        <spriteMaterial map={texture} transparent opacity={isHovered ? 1 : 0.9} />
      </sprite>

      {isHovered && (
        <Html position={[0, 0.6, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="bg-slate-900/95 text-white px-3 py-2 rounded-lg shadow-xl whitespace-nowrap text-sm border border-slate-700">
            <div className="font-medium">{competency.name}</div>
            <div className="text-slate-400 text-xs">{competency.category.name}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ============================================================
// Loading
// ============================================================

export function AtlasSphereLoading() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400">Loading 3D visualization...</p>
      </div>
    </div>
  );
}
