'use client';

import { useEffect, useRef } from 'react';

interface OrbitalLogoProps {
  size?: number;
  className?: string;
}

/**
 * orbital logo with two animated elliptical satellites
 */
export function OrbitalLogo({ size = 42, className = '' }: OrbitalLogoProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const cx = 21;
    const cy = 21;

    const orbits = [
      {
        rx: 18,
        ry: 7.5,
        tiltDeg: -20,
        durationMs: 10000,
        startAngleDeg: 0,
        satId: 'sat1',
        glowId: 'glow1',
      },
      {
        rx: 18,
        ry: 7.5,
        tiltDeg: 55,
        durationMs: 16000,
        startAngleDeg: 140,
        satId: 'sat2',
        glowId: 'glow2',
      },
    ];

    const elements = orbits.map((o) => ({
      ...o,
      tiltRad: (o.tiltDeg * Math.PI) / 180,
      startAngle: (o.startAngleDeg * Math.PI) / 180,
      sat: svg.getElementById(o.satId) as SVGCircleElement | null,
      glow: svg.getElementById(o.glowId) as SVGCircleElement | null,
    }));

    let startTime: number | null = null;

    function animate(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      for (const orbit of elements) {
        const t =
          orbit.startAngle + ((elapsed % orbit.durationMs) / orbit.durationMs) * Math.PI * 2;
        const cosT = Math.cos(t);
        const sinT = Math.sin(t);
        const cosTheta = Math.cos(orbit.tiltRad);
        const sinTheta = Math.sin(orbit.tiltRad);

        const x = cx + orbit.rx * cosT * cosTheta - orbit.ry * sinT * sinTheta;
        const y = cy + orbit.rx * cosT * sinTheta + orbit.ry * sinT * cosTheta;

        if (orbit.sat) {
          orbit.sat.setAttribute('cx', String(x));
          orbit.sat.setAttribute('cy', String(y));
        }
        if (orbit.glow) {
          orbit.glow.setAttribute('cx', String(x));
          orbit.glow.setAttribute('cy', String(y));
        }
      }

      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  return (
    <div className={className} style={{ width: size, height: size, flexShrink: 0 }}>
      <svg
        ref={svgRef}
        viewBox="0 0 42 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        {/* core glow */}
        <circle cx="21" cy="21" r="6.5" fill="rgb(var(--frontend))" opacity="0.15" />

        {/* core */}
        <circle
          cx="21"
          cy="21"
          r="5.5"
          fill="rgb(var(--frontend))"
          className="animate-[corePulse_4s_ease-in-out_infinite]"
        />
        <circle
          cx="21"
          cy="21"
          r="5.5"
          stroke="rgb(var(--frontend-bright))"
          strokeWidth="0.5"
          opacity="0.3"
        />

        {/* orbit ring 1 tilted -20° */}
        <ellipse
          cx="21"
          cy="21"
          rx="18"
          ry="7.5"
          stroke="rgb(var(--frontend))"
          strokeWidth="0.9"
          opacity="0.4"
          transform="rotate(-20 21 21)"
        />

        {/* satellite 1 glow + body */}
        <circle
          id="glow1"
          r="3"
          fill="rgb(var(--frontend-bright))"
          opacity="0.15"
          cx="21"
          cy="21"
        />
        <circle id="sat1" r="2" fill="rgb(var(--frontend-bright))" opacity="0.9" cx="21" cy="21" />

        {/* orbit ring 2 tilted 55° */}
        <ellipse
          cx="21"
          cy="21"
          rx="18"
          ry="7.5"
          stroke="rgb(var(--frontend))"
          strokeWidth="0.6"
          opacity="0.2"
          transform="rotate(55 21 21)"
        />

        {/* satellite 2 glow + body */}
        <circle id="glow2" r="2.5" fill="rgb(var(--frontend))" opacity="0.1" cx="21" cy="21" />
        <circle id="sat2" r="1.5" fill="rgb(var(--frontend))" opacity="0.6" cx="21" cy="21" />
      </svg>
    </div>
  );
}
