'use client';

import type { HudTeam, Situation, PlayAnimationData, WeatherState } from '@atlas/sdk/gridstream/types';
import { yardToFieldPct } from '@atlas/sdk/gridstream/transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import {
  FIELD_WIDTH, FIELD_HEIGHT, FIELD_LEFT, FIELD_RIGHT,
  FIELD_TOP, FIELD_BOTTOM, FIELD_CENTER_Y, FIELD_PERSPECTIVE,
  AWAY_EZ_LEFT, HOME_EZ_RIGHT,
  fieldPctToSvgX, YARD_LINE_POSITIONS,
} from '@atlas/sdk/gridstream/field';
import { WeatherLayer } from './WeatherLayer';
import { PlayAnimation } from './PlayAnimation';

interface FieldVisualizationProps {
  away: HudTeam;
  home: HudTeam;
  situation: Situation;
  lastPlay: PlayAnimationData | null;
  animationKey: number;
  weather: WeatherState;
  venue: string;
}

export function FieldVisualization({
  away, home, situation, lastPlay, animationKey, weather, venue,
}: FieldVisualizationProps) {
  const losX = fieldPctToSvgX(yardToFieldPct(situation.yardLine, situation.side, away.abbr));

  // First down marker
  const firstDownYard = Math.max(0, situation.yardLine - situation.distance);
  const fdX = fieldPctToSvgX(yardToFieldPct(firstDownYard, situation.side, away.abbr));

  return (
    <div style={{
      ...FIELD_PERSPECTIVE,
      borderRadius: 4, overflow: 'hidden',
      border: `1px solid ${C.cyanBorder}`,
    }}>
      <svg viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT + 30}`} style={{ width: '100%', display: 'block' }}>
        <defs>
          <linearGradient id="fGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a2a1a" />
            <stop offset="100%" stopColor="#061810" />
          </linearGradient>
          {/* Glow filter for border only */}
          <filter id="gf" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
          </filter>
        </defs>

        {/* Venue name */}
        <text
          x={500} y={14} textAnchor="middle"
          fill={C.textDim} fontSize={9}
          fontFamily={F.mono} letterSpacing={4}
        >
          {venue.toUpperCase()}
        </text>

        {/* Field background with glow border */}
        <rect
          x={AWAY_EZ_LEFT} y={FIELD_TOP}
          width={HOME_EZ_RIGHT - AWAY_EZ_LEFT} height={FIELD_BOTTOM - FIELD_TOP}
          fill="url(#fGrad)" stroke={C.cyanDim} strokeWidth={1.5} opacity={0.8}
          filter="url(#gf)"
        />
        {/* Sharp field rect on top */}
        <rect
          x={AWAY_EZ_LEFT} y={FIELD_TOP}
          width={HOME_EZ_RIGHT - AWAY_EZ_LEFT} height={FIELD_BOTTOM - FIELD_TOP}
          fill="url(#fGrad)" stroke={C.cyanDim} strokeWidth={1}
        />

        {/* Goal lines */}
        <line x1={FIELD_LEFT} y1={FIELD_TOP} x2={FIELD_LEFT} y2={FIELD_BOTTOM} stroke={C.cyanDim} strokeWidth={2} opacity={0.3} />
        <line x1={FIELD_RIGHT} y1={FIELD_TOP} x2={FIELD_RIGHT} y2={FIELD_BOTTOM} stroke={C.cyanDim} strokeWidth={2} opacity={0.3} />

        {/* Yard lines */}
        {YARD_LINE_POSITIONS.map(({ yard, displayNumber, x }) => (
          <g key={yard}>
            <line x1={x} y1={FIELD_TOP} x2={x} y2={FIELD_BOTTOM} stroke={C.cyanDim} strokeWidth={1} opacity={0.12} />
            <text x={x} y={FIELD_BOTTOM + 18} textAnchor="middle" fill={C.textDim} fontSize={12} fontFamily={F.display} fontWeight={700}>
              {displayNumber}
            </text>
          </g>
        ))}

        {/* Hash marks */}
        {Array.from({ length: 99 }, (_, i) => i + 1).map((yd) => {
          const x = fieldPctToSvgX(yd);
          return (
            <g key={`hash-${yd}`}>
              <line x1={x} y1={140} x2={x} y2={145} stroke={C.cyanDim} strokeWidth={0.5} opacity={0.15} />
              <line x1={x} y1={275} x2={x} y2={280} stroke={C.cyanDim} strokeWidth={0.5} opacity={0.15} />
            </g>
          );
        })}

        {/* Endzone text — away (left) */}
        <text
          x={91} y={FIELD_CENTER_Y} textAnchor="middle" dominantBaseline="central"
          fill={`#${away.altColor}`} opacity={0.55} fontSize={36}
          fontFamily={F.body} fontWeight={800} letterSpacing={14}
          transform={`rotate(-90,91,${FIELD_CENTER_Y})`}
        >
          {away.endzoneName}
        </text>

        {/* Endzone text — home (right) */}
        <text
          x={909} y={FIELD_CENTER_Y} textAnchor="middle" dominantBaseline="central"
          fill={`#${home.altColor}`} opacity={0.55} fontSize={44}
          fontFamily={F.body} fontWeight={800} letterSpacing={14}
          transform={`rotate(90,909,${FIELD_CENTER_Y})`}
        >
          {home.endzoneName}
        </text>

        {/* First down line */}
        {situation.distance > 0 && (
          <line
            x1={fdX} y1={FIELD_TOP} x2={fdX} y2={FIELD_BOTTOM}
            stroke={C.amber} strokeWidth={2} opacity={0.5}
            strokeDasharray="6 4"
          />
        )}

        {/* Line of scrimmage */}
        <line
          x1={losX} y1={FIELD_TOP} x2={losX} y2={FIELD_BOTTOM}
          stroke={C.cyan} strokeWidth={2} opacity={0.4}
        />

        {/* LOS label */}
        <rect x={losX - 30} y={FIELD_TOP - 2} width={60} height={16} rx={2} fill={C.bg} opacity={0.8} />
        <text x={losX} y={FIELD_TOP + 10} textAnchor="middle" fill={C.cyan} fontSize={9} fontFamily={F.display} fontWeight={700}>
          {situation.side} {situation.yardLine}
        </text>

        {/* Drive progress arrow (subtle zone highlight) */}
        {situation.distance > 0 && (
          <rect
            x={Math.min(losX, fdX)}
            y={FIELD_TOP}
            width={Math.abs(fdX - losX)}
            height={FIELD_BOTTOM - FIELD_TOP}
            fill={C.cyan} opacity={0.03}
          />
        )}

        {/* Ball marker */}
        <circle
          cx={losX} cy={FIELD_CENTER_Y} r={4}
          fill={C.amber} opacity={0.8}
          style={{ filter: `drop-shadow(0 0 6px ${C.amberGlow})` }}
        />

        {/* Play animation overlay */}
        {lastPlay && (
          <PlayAnimation
            key={animationKey}
            play={lastPlay}
            awayAbbr={away.abbr}
          />
        )}

        {/* Weather particles */}
        <WeatherLayer weather={weather} />

        {/* Endzone bottom labels */}
        <text x={55} y={FIELD_BOTTOM + 26} fill={C.textDim} fontSize={9} fontFamily={F.mono}>
          ◂ {away.abbr} END ZONE
        </text>
        <text x={945} y={FIELD_BOTTOM + 26} textAnchor="end" fill={C.textDim} fontSize={9} fontFamily={F.mono}>
          {home.abbr} END ZONE ▸
        </text>
      </svg>
    </div>
  );
}
