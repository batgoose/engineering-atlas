'use client';

import type { WeatherState, HudTeam } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface EnvironmentPanelProps {
  weather: WeatherState;
  awayWinPct: number;
  away: HudTeam;
  home: HudTeam;
}

export function EnvironmentPanel({ weather, awayWinPct, away, home }: EnvironmentPanelProps) {
  const homeWinPct = 100 - awayWinPct;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Weather */}
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
        {!weather.isIndoor && weather.wind && (
          <div style={{
            fontFamily: F.mono, fontSize: 11, color: C.textDim,
            letterSpacing: '.06em', marginTop: 2,
          }}>
            WIND {weather.wind}
          </div>
        )}
      </div>

      {/* Win Probability */}
      <div className="hud-panel" style={{ padding: '10px 16px' }}>
        <div className="hud-label" style={{ marginBottom: 6 }}>WIN PROBABILITY</div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontFamily: F.display, fontSize: 12, fontWeight: 700,
          letterSpacing: '.06em', marginBottom: 4,
        }}>
          <span style={{ color: `#${away.color}` }}>
            {away.abbr} {Math.round(awayWinPct)}%
          </span>
          <span style={{ color: `#${home.color}` }}>
            {Math.round(homeWinPct)}% {home.abbr}
          </span>
        </div>
        {/* WP bar */}
        <div style={{
          display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden',
        }}>
          <div style={{
            width: `${awayWinPct}%`,
            background: `#${away.color}`,
            transition: 'width 0.5s ease',
          }} />
          <div style={{
            width: `${homeWinPct}%`,
            background: `#${home.color}`,
            opacity: 0.5,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
    </div>
  );
}
