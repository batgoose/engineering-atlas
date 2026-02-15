'use client';

import { useMemo } from 'react';
import type { WeatherState } from '@atlas/sdk/gridstream/types';
import { parseWindVector } from '@atlas/sdk/gridstream/transforms';

interface WeatherLayerProps {
  weather: WeatherState;
}

/**
 * Renders weather particles over the field SVG.
 * Uses CSS animations with custom --drift properties for wind effects.
 * Returns null for clear/cloudy/indoor conditions.
 */
export function WeatherLayer({ weather }: WeatherLayerProps) {
  const condition = weather.condition.toLowerCase();
  const isRain = condition.includes('rain') || condition.includes('shower') || condition.includes('storm');
  const isSnow = condition.includes('snow') || condition.includes('sleet') || condition.includes('flurr');

  if (weather.isIndoor || (!isRain && !isSnow)) return null;

  const wind = parseWindVector(weather.wind);

  return isRain
    ? <RainParticles drift={wind.hDrift} />
    : <SnowParticles drift={wind.hDrift} />;
}

function RainParticles({ drift }: { drift: number }) {
  const drops = useMemo(() =>
    Array.from({ length: 40 }, (_, i) => ({
      key: i,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 0.6 + Math.random() * 0.4,
      height: 8 + Math.random() * 6,
    })),
  []);

  return (
    <g>
      {drops.map((d) => (
        <line
          key={d.key}
          x1={d.left * 10}
          y1={0}
          x2={d.left * 10 + drift * 0.3}
          y2={d.height}
          stroke="rgba(160,200,255,0.3)"
          strokeWidth={1}
          style={{
            ['--drift' as string]: `${drift}px`,
            animation: `rain ${d.duration}s linear ${d.delay}s infinite`,
          } as React.CSSProperties}
        />
      ))}
    </g>
  );
}

function SnowParticles({ drift }: { drift: number }) {
  const flakes = useMemo(() =>
    Array.from({ length: 55 }, (_, i) => ({
      key: i,
      cx: Math.random() * 1000,
      delay: Math.random() * 4,
      duration: 3 + Math.random() * 3,
      r: 2 + Math.random() * 2.5,
    })),
  []);

  return (
    <g>
      {flakes.map((f) => (
        <circle
          key={f.key}
          cx={f.cx}
          cy={0}
          r={f.r}
          fill="rgba(220,230,255,0.35)"
          style={{
            ['--drift' as string]: `${drift}px`,
            animation: `snow ${f.duration}s linear ${f.delay}s infinite`,
          } as React.CSSProperties}
        />
      ))}
    </g>
  );
}
