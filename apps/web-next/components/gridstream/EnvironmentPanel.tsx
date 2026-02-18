'use client';

/**
 * Right-side weather/environment HUD card.
 *
 * Wind is suppressed when unavailable to avoid placeholder noise in replay.
 */

import type { WeatherState } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface EnvironmentPanelProps {
  weather: WeatherState;
}

export function EnvironmentPanel({ weather }: EnvironmentPanelProps) {
  const windText = (weather.wind ?? '').trim();

  return (
    <div className="hud-panel" style={{ padding: '10px 16px' }}>
      <div className="hud-label" style={{ marginBottom: 6 }}>ENVIRONMENT</div>
      <div style={{
        fontFamily: F.display, fontSize: 24, fontWeight: 800,
        color: C.textBright, lineHeight: 1,
      }}>
        {weather.isIndoor ? '—' : `${weather.temperature}°F`}
      </div>
      <div style={{
        fontFamily: F.body, fontSize: 14, fontWeight: 600,
        color: C.text, marginTop: 4,
      }}>
        {weather.isIndoor ? 'Indoor / Climate Controlled' : weather.condition}
      </div>
      {!weather.isIndoor && windText.length > 0 && (
        <div style={{
          fontFamily: F.mono, fontSize: 11, color: C.textDim,
          letterSpacing: '.06em', marginTop: 2,
        }}>
          WIND {windText}
        </div>
      )}
    </div>
  );
}
