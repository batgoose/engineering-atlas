// @ts-nocheck
'use client';

import { useRef, useState, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { UnrealBloomPass } from 'three-stdlib';
import * as THREE from 'three';
import { getIconDataUrl } from '@atlas/ui/atlas';
import type { CompetencyNode } from '@atlas/types';
import { PROCESSED_CONSTELLATIONS, type ProcessedConstellationDefinition } from '@atlas/sdk/atlas';

const TEXTURE_CACHE: Record<string, THREE.Texture> = {};
const loader = new THREE.TextureLoader();

extend({ UnrealBloomPass });
declare module '@react-three/fiber' {
  interface ThreeElements {
    unrealBloomPass: unknown;
  }
}

interface StarMapProps {
  competencies: CompetencyNode[];
  activeCategory: string | null;
  selectedId: string | null;
  hoveredId: string | null;
  onStarClick: (competency: CompetencyNode) => void;
  onStarHover: (competency: CompetencyNode | null) => void;
}

const STAR_BASE_SIZE = 0.15;
const STAR_HOVER_SIZE = 0.28;
const STAR_ACTIVE_SIZE = 0.2;

function useGlowTexture() {
  return useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

export function StarMap({
  competencies,
  activeCategory,
  selectedId,
  hoveredId,
  onStarClick,
  onStarHover,
}: StarMapProps) {
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const bloomIntensity = isInteracting ? 0.1 : 0.6;
  const bloomRadius = isInteracting ? 0.0 : 0.3;

  return (
    <div className="w-full h-full bg-slate-950">
      <Canvas
        camera={{ position: [0, 0, 18], fov: 60 }}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          precision: 'lowp',
        }}
        dpr={1}
      >
        <color attach="background" args={['#0a0a12']} />
        <fog attach="fog" args={['#0a0a12', 40, 90] as [string, number, number]} />

        <Suspense fallback={null}>
          <ambientLight intensity={0.25} />
          <pointLight position={[0, 0, 15]} intensity={0.3} color="#4488ff" />

          <ConstellationField
            competencies={competencies}
            activeCategory={activeCategory}
            hoveredCategory={hoveredCategory}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onStarClick={onStarClick}
            onStarHover={onStarHover}
            onCategoryHover={setHoveredCategory}
          />

          <BackgroundStars count={800} size={0.04} opacity={0.25} radius={120} />
          <BackgroundStars count={400} size={0.08} opacity={0.45} radius={80} />

          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            onStart={() => setIsInteracting(true)}
            onEnd={() => setIsInteracting(false)}
          />

          <EffectComposer>
            <Bloom
              luminanceThreshold={0.0}
              intensity={bloomIntensity}
              radius={bloomRadius}
              mipmapBlur
            />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}

function ConstellationField({
  competencies,
  activeCategory,
  hoveredCategory,
  selectedId,
  hoveredId,
  onStarClick,
  onStarHover,
  onCategoryHover,
}: StarMapProps & {
  hoveredCategory: string | null;
  onCategoryHover: (cat: string | null) => void;
}) {
  const competenciesByCategory = useMemo(() => {
    const grouped: Record<string, CompetencyNode[]> = {};
    competencies.forEach((comp) => {
      const cat = comp.category.name;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(comp);
    });
    return grouped;
  }, [competencies]);

  return (
    <group>
      {PROCESSED_CONSTELLATIONS.map((constellation) => {
        const categoryName = constellation.name;
        const categoryCompetencies = competenciesByCategory[categoryName] || [];

        const isActive = activeCategory === categoryName || hoveredCategory === categoryName;
        const isHovered = competencies.some(
          (c) => c.id === hoveredId && c.category.name === categoryName
        );
        const isDimmed =
          (activeCategory !== null && !isActive) || (hoveredCategory !== null && !isActive);

        return (
          <Constellation
            key={categoryName}
            name={categoryName}
            definition={constellation}
            competencies={categoryCompetencies}
            isActive={isActive}
            isHovered={isHovered}
            isDimmed={isDimmed}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onStarClick={onStarClick}
            onStarHover={onStarHover}
            onCategoryHover={onCategoryHover}
          />
        );
      })}
    </group>
  );
}

interface ConstellationProps {
  name: string;
  definition: ProcessedConstellationDefinition;
  competencies: CompetencyNode[];
  isActive: boolean;
  isHovered: boolean;
  isDimmed: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  onStarClick: (c: CompetencyNode) => void;
  onStarHover: (c: CompetencyNode | null) => void;
  onCategoryHover: (cat: string | null) => void;
}

function Constellation({
  name,
  definition,
  competencies,
  isActive,
  isHovered,
  isDimmed,
  selectedId,
  hoveredId,
  onStarClick,
  onStarHover,
  onCategoryHover,
}: ConstellationProps) {
  const { center, scale, starPoints, color, geometries } = definition;

  const starPositions = useMemo(() => {
    if (!starPoints.length || !competencies.length) return [];

    const baseRadius = scale * 0.85;
    const minSeparation = 0.35;

    return competencies.map((comp, i) => {
      const basePoint = starPoints[i % starPoints.length]!;
      const ring = Math.floor(i / starPoints.length);
      const angle = (i * 2.399963229728653) % (Math.PI * 2);
      const radialOffset = ring * minSeparation + ((i * 0.17) % 1) * 0.2;

      const jitterX = Math.cos(angle) * radialOffset;
      const jitterY = Math.sin(angle) * radialOffset;

      return {
        competency: comp,
        position: new THREE.Vector3(
          center.x + basePoint.x * baseRadius + jitterX,
          center.y + basePoint.y * baseRadius + jitterY,
          center.z + (((i * 0.31) % 1) - 0.5) * 0.25
        ),
      };
    });
  }, [competencies, center, starPoints, scale]);

  const lineGeometry = useMemo(() => {
    if (starPositions.length < 2) return null;

    const centerVec = new THREE.Vector3(center.x, center.y, center.z);

    const ordered = [...starPositions]
      .map((s) => {
        const dx = s.position.x - centerVec.x;
        const dy = s.position.y - centerVec.y;
        return {
          ...s,
          angle: Math.atan2(dy, dx),
        };
      })
      .sort((a, b) => a.angle - b.angle);

    const points: number[] = [];

    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i]!.position;
      const b = ordered[i + 1]!.position;
      points.push(a.x, a.y, a.z);
      points.push(b.x, b.y, b.z);
    }

    if (ordered.length > 2) {
      const first = ordered[0]!.position;
      const last = ordered[ordered.length - 1]!.position;
      points.push(last.x, last.y, last.z);
      points.push(first.x, first.y, first.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }, [starPositions, center]);

  const showLines = isActive || isHovered;

  return (
    <group>
      <ConstellationBackdrop
        geometries={geometries}
        center={center}
        scale={scale}
        color={color}
        isActive={isActive}
        isHovered={isHovered}
        onHover={(hovering) => onCategoryHover(hovering ? name : null)}
      />

      {showLines && lineGeometry && (
        <lineSegments geometry={lineGeometry} renderOrder={1}>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={isDimmed ? 0.05 : 0.35}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      )}

      {(isActive || isHovered) && (
        <Html
          position={[center.x, center.y + 3.0, center.z]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={`
              text-xs font-medium uppercase tracking-widest whitespace-nowrap
              transition-all duration-500
              ${isActive ? 'text-cyan-400 scale-110' : 'text-slate-500'}
            `}
            style={{ textShadow: isActive ? `0 0 10px ${color}` : 'none' }}
          >
            {name}
          </div>
        </Html>
      )}

      {starPositions.map(({ competency, position }) => (
        <Star
          key={competency.id}
          competency={competency}
          position={position}
          isActive={isActive}
          isSelected={selectedId === competency.id}
          isHovered={hoveredId === competency.id}
          isDimmed={isDimmed}
          onHover={onStarHover}
          onClick={onStarClick}
        />
      ))}
    </group>
  );
}

function ConstellationBackdrop({
  geometries = [],
  center,
  scale,
  color,
  isActive,
  isHovered,
  onHover,
}: {
  geometries?: THREE.BufferGeometry[];
  center: THREE.Vector3;
  scale: number;
  color: string;
  isActive: boolean;
  isHovered: boolean;
  onHover: (v: boolean) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.z = Math.sin(Date.now() * 0.0005) * 0.05;
    }
  });

  if (!geometries || geometries.length === 0) {
    return null;
  }

  return (
    <group
      ref={groupRef}
      position={[center.x, center.y, center.z - 1]}
      scale={[scale, -scale, scale]}
    >
      <mesh
        visible={false}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(false);
          document.body.style.cursor = 'default';
        }}
      >
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {geometries.map((geo, i) => (
        <group key={i}>
          <lineSegments geometry={geo}>
            <lineBasicMaterial
              color={color}
              transparent
              opacity={isActive || isHovered ? 0.4 : 0.05}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </lineSegments>

          {(isActive || isHovered) && (
            <points geometry={geo}>
              <pointsMaterial
                color={color}
                size={1.5}
                sizeAttenuation={false}
                transparent
                opacity={0.6}
                blending={THREE.AdditiveBlending}
              />
            </points>
          )}
        </group>
      ))}
    </group>
  );
}

interface StarProps {
  competency: CompetencyNode;
  position: THREE.Vector3;
  isActive: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isDimmed: boolean;
  onClick: (c: CompetencyNode) => void;
  onHover: (c: CompetencyNode | null) => void;
}

function Star({
  competency,
  position,
  isActive,
  isSelected,
  isHovered,
  isDimmed,
  onClick,
  onHover,
}: StarProps) {
  const meshRef = useRef<THREE.Sprite>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const iconRef = useRef<THREE.Sprite>(null);

  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const glowMap = useGlowTexture();

  useEffect(() => {
    const id = competency.id;

    if (TEXTURE_CACHE[id]) {
      setTexture(TEXTURE_CACHE[id]);
      return;
    }

    const dataUrl = getIconDataUrl(id);
    loader.load(dataUrl, (tex) => {
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      TEXTURE_CACHE[id] = tex;
      setTexture(tex);
    });
  }, [competency.id]);

  const targetSize = isHovered
    ? STAR_HOVER_SIZE
    : isSelected
      ? STAR_ACTIVE_SIZE
      : isActive
        ? STAR_ACTIVE_SIZE
        : STAR_BASE_SIZE;
  const currentSize = useRef(STAR_BASE_SIZE);
  const twinkleOffset = useRef(Math.random() * Math.PI * 2);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      currentSize.current += (targetSize - currentSize.current) * 0.1;
      const twinkle = isDimmed
        ? 0
        : Math.sin(clock.elapsedTime * 3.5 + twinkleOffset.current) * 0.015;
      meshRef.current.scale.setScalar(currentSize.current + twinkle);
      meshRef.current.rotation.z = Math.sin(clock.elapsedTime + twinkleOffset.current) * 0.1;
    }
    if (glowRef.current) {
      const glowSize = currentSize.current * (isHovered ? 4 : isActive ? 3 : 2);
      glowRef.current.scale.set(glowSize, glowSize, 1);
    }
    if (iconRef.current && (isHovered || isSelected)) {
      const targetIconScale = isHovered ? 1.6 : 1.2;
      iconRef.current.scale.lerp(new THREE.Vector3(targetIconScale, targetIconScale, 1), 0.2);
    }
  });

  const color = useMemo(() => {
    if (isDimmed) return '#223344';
    if (isHovered) return '#ffffff';
    if (isSelected) return '#00ffff';
    if (isActive) return '#88ddff';
    return '#cce6ff';
  }, [isDimmed, isHovered, isSelected, isActive]);

  return (
    <group position={position}>
      <sprite
        ref={meshRef}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(competency);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = 'default';
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onClick(competency);
        }}
      >
        <spriteMaterial
          map={glowMap || undefined}
          color={color}
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      <sprite ref={glowRef}>
        <spriteMaterial
          map={glowMap || undefined}
          color={color}
          transparent
          opacity={isDimmed ? 0.02 : isHovered ? 0.3 : 0.15}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {(isHovered || isSelected) && texture && (
        <sprite ref={iconRef} position={[0, 0, 0.5]} scale={[0, 0, 1]}>
          <spriteMaterial map={texture} transparent opacity={isDimmed ? 0.5 : 1} />
        </sprite>
      )}

      {isHovered && (
        <Html position={[0, 1.5, 0]} center style={{ pointerEvents: 'none', zIndex: 100 }}>
          <div className="bg-slate-900/95 text-white px-3 py-2 rounded-lg shadow-xl whitespace-nowrap text-sm border border-cyan-500/30 backdrop-blur-sm transform -translate-y-full mb-1">
            <div className="font-medium text-cyan-300">{competency.name}</div>
            <div className="text-slate-400 text-xs">{competency.category.name}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function BackgroundStars({
  count,
  size = 0.08,
  opacity = 0.5,
  radius = 80,
}: {
  count: number;
  size?: number;
  opacity?: number;
  radius?: number;
}) {
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.random() * radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    return pos;
  }, [count, radius]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color="#cce6ff"
        transparent
        opacity={opacity}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

export function StarMapLoading() {
  return (
    <div className="w-full h-full bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400">Mapping the stars...</p>
      </div>
    </div>
  );
}
