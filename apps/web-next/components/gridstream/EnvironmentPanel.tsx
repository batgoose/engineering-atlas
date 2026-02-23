'use client';

/**
 * Right-side weather/environment HUD card.
 *
 * Wind is suppressed when unavailable to avoid placeholder noise in replay.
 * Rain and snow conditions get elevated styling: a coloured border, a badge,
 * and muted-blue temperature colour so players know the conditions at a glance.
 */

import type { WeatherState } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface EnvironmentPanelProps {
  weather: WeatherState;
}

export function EnvironmentPanel({ weather }: EnvironmentPanelProps) {
  const windText = (weather.wind ?? '').trim();
  const cond = weather.condition.toLowerCase();
  const isSnow = cond.includes('snow');
  const isRain = cond.includes('rain');
  const isAdverse = isSnow || isRain;

  const adverseAccent = isSnow ? '#b8d4f8' : '#7eb8f0';
  const adverseBorder = isSnow ? 'rgba(184,212,248,.22)' : 'rgba(126,184,240,.22)';
  const adverseBg = isSnow ? 'rgba(184,212,248,.04)' : 'rgba(126,184,240,.04)';

  return (
    <div
      className="hud-panel"
      style={{
        padding: '10px 16px',
        ...(isAdverse ? { background: adverseBg, borderColor: adverseBorder } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="hud-label">ENVIRONMENT</span>
        {isAdverse && (
          <span
            style={{
              fontFamily: F.display,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '.14em',
              color: adverseAccent,
              padding: '1px 5px',
              border: `1px solid ${adverseBorder}`,
              background: adverseBg,
            }}
          >
            {isSnow ? 'SNOW' : 'RAIN'}
          </span>
        )}
      </div>
      {weather.isIndoor ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <svg width="28" height="20" viewBox="0 0 28 20" fill="none" aria-hidden="true">
            {/* dome arch */}
            <path
              d="M2 19 Q2 2 14 2 Q26 2 26 19"
              stroke="#00e5ff"
              strokeWidth="1.4"
              strokeOpacity="0.5"
              fill="none"
            />
            {/* floor */}
            <line
              x1="2"
              y1="19"
              x2="26"
              y2="19"
              stroke="#00e5ff"
              strokeWidth="1"
              strokeOpacity="0.3"
            />
            {/* inner glow lines */}
            <path
              d="M6 19 Q6 7 14 7 Q22 7 22 19"
              stroke="#00e5ff"
              strokeWidth="0.8"
              strokeOpacity="0.2"
              fill="none"
            />
          </svg>
          <div>
            <div
              style={{
                fontFamily: F.display,
                fontSize: 18,
                fontWeight: 800,
                color: C.textBright,
                lineHeight: 1,
              }}
            >
              DOME
            </div>
            <div
              style={{
                fontFamily: F.body,
                fontSize: 11,
                color: C.textDim,
                marginTop: 2,
                letterSpacing: '.04em',
              }}
            >
              Climate Controlled
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              fontFamily: F.display,
              fontSize: 24,
              fontWeight: 800,
              color: isAdverse ? adverseAccent : C.textBright,
              lineHeight: 1,
            }}
          >
            {`${weather.temperature}\u00b0F`}
          </div>
          <div
            style={{
              fontFamily: F.body,
              fontSize: 14,
              fontWeight: 600,
              color: isAdverse ? adverseAccent : C.text,
              marginTop: 4,
            }}
          >
            {weather.condition}
          </div>
        </>
      )}
      {!weather.isIndoor && windText.length > 0 && (
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            color: isAdverse ? adverseAccent : C.textDim,
            letterSpacing: '.06em',
            marginTop: 2,
            opacity: 0.8,
          }}
        >
          WIND {windText}
        </div>
      )}
    </div>
  );
}
