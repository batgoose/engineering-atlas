'use client';

/**
 * Lightweight CSS/SVG star field for the Gridstream viewport panel.
 * No Three.js — just SVG circles and radial-gradient nebula blobs.
 * Stars are deterministic (same seed = same layout every render).
 */

// Simple LCG pseudo-random number generator
function makeLcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

interface StarDot {
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  warm: boolean; // slight color variation
}

// Generated once at module load — stable across re-renders
const STARS: StarDot[] = (() => {
  const rng = makeLcg(7331);
  return Array.from({ length: 200 }, () => {
    const rand = rng();
    return {
      cx: rng() * 100,
      cy: rng() * 100,
      r: rand > 0.92 ? 1.5 : rand > 0.72 ? 1.0 : 0.65,
      opacity: 0.05 + rng() * 0.28,
      warm: rng() > 0.8, // ~20% slightly warm-tinted
    };
  });
})();

export function StarField() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      <svg
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block' }}
        preserveAspectRatio="none"
      >
        <defs>
          {/* Nebula blobs — subtle colour washes */}
          <radialGradient id="sf-neb-a" cx="26%" cy="36%" r="38%" gradientUnits="objectBoundingBox">
            <stop offset="0%" stopColor="#0078c8" stopOpacity="0.13" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sf-neb-b" cx="74%" cy="64%" r="30%" gradientUnits="objectBoundingBox">
            <stop offset="0%" stopColor="#501496" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sf-neb-c" cx="54%" cy="18%" r="24%" gradientUnits="objectBoundingBox">
            <stop offset="0%" stopColor="#005064" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Dark void background — StarField owns the panel bg at z-index -1 */}
        <rect width="100%" height="100%" fill="#050c18" />

        {/* Nebula washes */}
        <rect width="100%" height="100%" fill="url(#sf-neb-a)" />
        <rect width="100%" height="100%" fill="url(#sf-neb-b)" />
        <rect width="100%" height="100%" fill="url(#sf-neb-c)" />

        {/* Stars */}
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={`${s.cx.toFixed(2)}%`}
            cy={`${s.cy.toFixed(2)}%`}
            r={s.r}
            fill={
              s.warm
                ? `rgba(255,230,200,${s.opacity.toFixed(3)})`
                : `rgba(180,215,255,${s.opacity.toFixed(3)})`
            }
          />
        ))}
      </svg>
    </div>
  );
}
