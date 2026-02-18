'use client';

/**
 * Ambient weather particle layer rendered over the field.
 *
 * Particle placement intentionally uses randomness for atmosphere; snapshot
 * tests should target higher-level animation structure, not exact particle x/y.
 */

import type { WeatherState } from '@atlas/sdk/gridstream/types';
import { parseWindVector } from '@atlas/sdk/gridstream/transforms';
import { isLikelyIndoor } from '@atlas/sdk/gridstream/constants';

interface WeatherLayerProps {
  weather: WeatherState;
  venue?: string;
}

export function WeatherLayer({ weather, venue }: WeatherLayerProps) {
  const isDomed = weather.isIndoor || isLikelyIndoor(venue ?? '');
  if (isDomed) return null;

  const condition = weather.condition || '';
  const { hDrift } = parseWindVector(weather.wind);
  const isRain = condition.toLowerCase().includes('rain');
  const isSnow = condition.toLowerCase().includes('snow');
  const isCloudy = condition.includes('Cloud');
  const count = isRain ? 60 : isSnow ? 55 : 0;

  if (count === 0 && !isCloudy) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3 }}>
      {/* Cloudy haze overlay */}
      {(isCloudy || isRain) && (
        <div style={{
          position: 'absolute', inset: 0,
          background: isRain
            ? 'linear-gradient(180deg,rgba(30,50,80,.12) 0%,transparent 50%)'
            : 'linear-gradient(180deg,rgba(60,80,110,.06) 0%,transparent 30%)',
        }} />
      )}
      {/* Particles */}
      {Array.from({ length: count }, (_, i) => {
        const left = Math.random() * 110 - 5;
        const delay = Math.random() * 4;
        const dur = isSnow ? 3 + Math.random() * 3 : 0.8 + Math.random() * 1;
        const driftPx = hDrift + (Math.random() - 0.5) * 10;
        const size = isSnow ? 2 + Math.random() * 2.5 : 1.5;
        const height = isSnow ? size : 8 + Math.random() * 4;
        return (
          <div key={i} style={{
            position: 'absolute', left: `${left}%`, top: '-4%',
            width: size, height: height,
            borderRadius: isSnow ? '50%' : '0',
            background: isSnow ? 'rgba(200,220,255,.4)' : 'rgba(100,170,230,.3)',
            animation: `${isSnow ? 'snow' : 'rain'} ${dur}s linear ${delay}s infinite`,
            '--drift': `${driftPx}px`,
          } as React.CSSProperties} />
        );
      })}
    </div>
  );
}
