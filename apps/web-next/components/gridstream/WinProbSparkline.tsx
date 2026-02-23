'use client';

import type { WpTimelinePoint, GameTiming, HudTeam } from '@atlas/sdk/gridstream/types';
import {
  computeWpSparklinePoints,
  sparklineToPath,
  sparklineToArea,
  getQuarterTicks,
} from '@atlas/sdk/gridstream/transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface WinProbSparklineProps {
  timeline: WpTimelinePoint[];
  timing: GameTiming;
  away: HudTeam;
  home: HudTeam;
  width?: number;
  height?: number;
}

export function WinProbSparkline({
  timeline,
  timing,
  away,
  home,
  width = 400,
  height = 80,
}: WinProbSparklineProps) {
  if (timeline.length < 2) return null;

  const points = computeWpSparklinePoints(timeline, timing, true, width, height, 4);
  const pathD = sparklineToPath(points);
  const areaD = sparklineToArea(points, height);
  const ticks = getQuarterTicks(timing.isOT);
  const last = points[points.length - 1];

  // Current game progress as fraction
  const progressPct = timing.elapsedMin / timing.totalMin;

  return (
    <div className="hud-panel" style={{ padding: '10px 16px' }}>
      <div className="hud-label" style={{ marginBottom: 8 }}>
        WIN PROBABILITY
      </div>

      <svg width={width} height={height} style={{ display: 'block' }}>
        {/* 50% baseline */}
        <line
          x1={4}
          y1={height / 2}
          x2={width - 4}
          y2={height / 2}
          stroke={C.panelBorder}
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Quarter tick marks */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={4 + t * (width - 8)}
            y1={0}
            x2={4 + t * (width - 8)}
            y2={height}
            stroke={C.panelBorder}
            strokeWidth={1}
          />
        ))}

        {/* Remaining game zone */}
        <rect
          x={4 + progressPct * (width - 8)}
          y={0}
          width={(1 - progressPct) * (width - 8)}
          height={height}
          fill={C.textMuted}
          opacity={0.15}
        />

        {/* Area fill */}
        <path d={areaD} fill={`#${away.color}`} opacity={0.06} />

        {/* Main line */}
        <path
          d={pathD}
          fill="none"
          stroke={`#${away.color}`}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={500}
          strokeDasharray={500}
          strokeDashoffset={0}
          style={{ animation: 'sparkDraw 1.2s ease forwards' }}
        />

        {/* Current position dot */}
        {last && (
          <circle
            cx={last.x}
            cy={last.y}
            r={3.5}
            fill={`#${away.color}`}
            stroke={C.bg}
            strokeWidth={1.5}
            style={{ animation: 'pulse 2s ease-in-out infinite' }}
          />
        )}

        {/* Team labels */}
        <text x={6} y={12} fill={C.textDim} fontSize={8} fontFamily={F.display}>
          {away.abbr}
        </text>
        <text x={6} y={height - 4} fill={C.textDim} fontSize={8} fontFamily={F.display}>
          {home.abbr}
        </text>
      </svg>
    </div>
  );
}
