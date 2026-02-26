'use client';

import { useState } from 'react';
import type { EpaTimelinePoint, GameTiming, HudTeam } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface EpaFlowChartProps {
  timeline: EpaTimelinePoint[];
  timing: GameTiming;
  away: HudTeam;
  home: HudTeam;
}

interface TeamSeriesPoint {
  gameMin: number;
  total: number;
  pass: number;
  rush: number;
}

interface QuarterTick {
  value: number;
  label: string;
}

const CHART_W = 420;
const CHART_H = 132;
const PLOT_LEFT = 36;
const PLOT_RIGHT = 10;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 24;

export function EpaFlowChart({ timeline, timing, away, home }: EpaFlowChartProps) {
  if (!timeline || timeline.length < 2) {
    return (
      <div style={{ padding: '12px 20px', borderBottom: `1px solid rgba(0,229,255,.05)` }}>
        <span
          style={{
            fontFamily: F.display,
            fontSize: 9,
            letterSpacing: '.14em',
            color: C.textMuted,
            textTransform: 'uppercase',
          }}
        >
          EPA FLOW unavailable
        </span>
      </div>
    );
  }

  const awaySeries = timeline.map((pt) => ({
    gameMin: pt.gameMin,
    total: pt.awayTotal,
    pass: pt.awayPass,
    rush: pt.awayRush,
  }));
  const homeSeries = timeline.map((pt) => ({
    gameMin: pt.gameMin,
    total: pt.homeTotal,
    pass: pt.homePass,
    rush: pt.homeRush,
  }));

  const awayAxisDomain = computeAxisDomain(awaySeries);
  const homeAxisDomain = computeAxisDomain(homeSeries);
  const xMax = Math.max(
    timing.totalMin,
    timeline[timeline.length - 1]?.gameMin ?? timing.totalMin,
    1
  );

  return (
    <div style={{ borderBottom: `1px solid rgba(0,229,255,.05)` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 20px 6px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontFamily: F.body,
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: '.02em',
            color: C.text,
          }}
        >
          Estimated Points Allowed (EPA) - TOTAL / PASS / RUSH
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '0 20px 12px',
        }}
      >
        <TeamChart
          team={away}
          series={awaySeries}
          domain={awayAxisDomain}
          xMax={xMax}
          hasOt={timing.isOT || xMax > 60}
          accent={C.cyan}
        />
        <TeamChart
          team={home}
          series={homeSeries}
          domain={homeAxisDomain}
          xMax={xMax}
          hasOt={timing.isOT || xMax > 60}
          accent={C.amber}
        />
      </div>
    </div>
  );
}

function TeamChart({
  team,
  series,
  domain,
  xMax,
  hasOt,
  accent,
}: {
  team: HudTeam;
  series: TeamSeriesPoint[];
  domain: number;
  xMax: number;
  hasOt: boolean;
  accent: string;
}) {
  const [hoveredLine, setHoveredLine] = useState<'total' | 'pass' | 'rush' | null>(null);
  const baselineY = valueToY(0, domain);
  const totalPath = seriesPath(series, 'total', domain, xMax);
  const passPath = seriesPath(series, 'pass', domain, xMax);
  const rushPath = seriesPath(series, 'rush', domain, xMax);
  const latest = series[series.length - 1];
  const yTicks = buildYTicks(domain);
  const xTicks = buildQuarterTicks(xMax, hasOt);

  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${C.panelBorder}`,
        background: 'rgba(3, 9, 20, 0.65)',
        padding: '8px 10px 6px',
      }}
    >
      {hoveredLine && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            background: 'rgba(4,10,20,0.94)',
            border: `1px solid ${C.panelBorder}`,
            borderRadius: 2,
            padding: '2px 6px',
            fontFamily: F.mono,
            fontSize: 9,
            color: hoveredLine === 'total' ? accent : hoveredLine === 'pass' ? C.green : C.cyan,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          {hoveredLine === 'total'
            ? 'Total EPA Line'
            : hoveredLine === 'pass'
              ? 'Pass EPA Line'
              : 'Rush EPA Line'}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily: F.display,
            fontSize: 11,
            letterSpacing: '.1em',
            color: C.text,
            textTransform: 'uppercase',
          }}
        >
          {team.abbr} EPA
        </span>
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            color: accent,
            letterSpacing: '.06em',
          }}
        >
          TOTAL {formatEpa(latest?.total ?? 0)}
        </span>
      </div>
      <Legend teamAbbr={team.abbr} totalColor={accent} />
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        style={{ width: '100%', height: 108, display: 'block', marginTop: 4 }}
      >
        <rect
          x={PLOT_LEFT}
          y={PLOT_TOP}
          width={CHART_W - PLOT_LEFT - PLOT_RIGHT}
          height={CHART_H - PLOT_TOP - PLOT_BOTTOM}
          fill="rgba(0,229,255,.02)"
        />
        {yTicks.map((tick) => {
          const y = valueToY(tick, domain);
          const isZero = tick === 0;
          return (
            <g key={`y-${tick}`}>
              <line
                x1={PLOT_LEFT}
                y1={y}
                x2={CHART_W - PLOT_RIGHT}
                y2={y}
                stroke={isZero ? C.textMuted : C.panelBorder}
                strokeWidth={isZero ? 0.9 : 0.7}
                opacity={isZero ? 0.42 : 0.22}
              />
              <text
                x={PLOT_LEFT - 4}
                y={y + 3.5}
                textAnchor="end"
                style={{
                  fontFamily: F.body,
                  fontSize: 9,
                  fontWeight: 600,
                  fill: C.textMuted,
                  letterSpacing: '.01em',
                  opacity: 0.94,
                }}
              >
                {formatAxisTick(tick)}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const x = valueToX(tick.value, xMax);
          return (
            <g key={`x-${tick.label}-${tick.value}`}>
              <line
                x1={x}
                y1={PLOT_TOP}
                x2={x}
                y2={CHART_H - PLOT_BOTTOM}
                stroke={C.panelBorder}
                strokeWidth={0.7}
                opacity={0.16}
              />
              <text
                x={x}
                y={CHART_H - 11}
                textAnchor="middle"
                style={{
                  fontFamily: F.body,
                  fontSize: 10,
                  fontWeight: 600,
                  fill: C.textMuted,
                  letterSpacing: '.01em',
                  opacity: 0.94,
                }}
              >
                {tick.label}
              </text>
            </g>
          );
        })}
        <line
          x1={PLOT_LEFT}
          y1={baselineY}
          x2={CHART_W - PLOT_RIGHT}
          y2={baselineY}
          stroke={C.textMuted}
          strokeWidth="0.8"
          opacity="0.35"
        />
        <path d={totalPath} fill="none" stroke={accent} strokeWidth="2.2" opacity="0.92" />
        <path
          d={totalPath}
          fill="none"
          stroke={accent}
          strokeWidth="10"
          opacity="0"
          style={{ cursor: 'help' }}
          onMouseEnter={() => setHoveredLine('total')}
          onMouseLeave={() => setHoveredLine(null)}
        >
          <title>
            Total EPA: cumulative expected points added. Positive means more scoring value created.
          </title>
        </path>
        <path
          d={passPath}
          fill="none"
          stroke={C.green}
          strokeWidth="1.7"
          opacity="0.86"
          strokeDasharray="6 3"
          style={{ cursor: 'help' }}
          onMouseEnter={() => setHoveredLine('pass')}
          onMouseLeave={() => setHoveredLine(null)}
        >
          <title>Pass EPA: value added from dropbacks (passes and sacks).</title>
        </path>
        <path
          d={rushPath}
          fill="none"
          stroke={C.cyan}
          strokeWidth="1.7"
          opacity="0.75"
          strokeDasharray="2 3"
          style={{ cursor: 'help' }}
          onMouseEnter={() => setHoveredLine('rush')}
          onMouseLeave={() => setHoveredLine(null)}
        >
          <title>Rush EPA: value added from designed rushes and QB runs.</title>
        </path>
        <text
          x={4}
          y={PLOT_TOP + 9}
          style={{
            fontFamily: F.body,
            fontSize: 10,
            fontWeight: 700,
            fill: C.textMuted,
            letterSpacing: '.04em',
            opacity: 0.96,
          }}
        >
          EPA
        </text>
        <text
          x={(PLOT_LEFT + (CHART_W - PLOT_RIGHT)) / 2}
          y={CHART_H - 0.25}
          textAnchor="middle"
          style={{
            fontFamily: F.body,
            fontSize: 11,
            fontWeight: 700,
            fill: C.textMuted,
            letterSpacing: '.04em',
            opacity: 0.96,
          }}
        >
          QUARTER
        </text>
      </svg>
      <div
        style={{
          marginTop: 2,
          display: 'flex',
          gap: 10,
          fontFamily: F.mono,
          fontSize: 10,
          color: C.textDim,
          letterSpacing: '.05em',
          flexWrap: 'wrap',
        }}
      >
        <span>PASS {formatEpa(latest?.pass ?? 0)}</span>
        <span>RUSH {formatEpa(latest?.rush ?? 0)}</span>
      </div>
    </div>
  );
}

function Legend({ teamAbbr, totalColor }: { teamAbbr: string; totalColor: string }) {
  return (
    <div
      aria-label={`${teamAbbr} EPA legend`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: F.mono,
        fontSize: 10,
        color: C.textDim,
        letterSpacing: '.06em',
      }}
    >
      <LegendSwatch color={totalColor} label="TOTAL" />
      <LegendSwatch color={C.green} label="PASS" />
      <LegendSwatch color={C.cyan} label="RUSH" />
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: 10,
          height: 2,
          background: color,
          boxShadow: `0 0 6px ${color}80`,
        }}
      />
      <span>{label}</span>
    </span>
  );
}

function maxAbsEpa(series: TeamSeriesPoint[]): number {
  let maxAbs = 0;
  for (const pt of series) {
    maxAbs = Math.max(maxAbs, Math.abs(pt.total), Math.abs(pt.pass), Math.abs(pt.rush));
  }
  return maxAbs;
}

function formatEpa(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

function seriesPath(
  series: TeamSeriesPoint[],
  key: 'total' | 'pass' | 'rush',
  domain: number,
  xMax: number
): string {
  if (series.length === 0) return '';
  return `M ${series
    .map((pt) => `${valueToX(pt.gameMin, xMax).toFixed(1)},${valueToY(pt[key], domain).toFixed(1)}`)
    .join(' L ')}`;
}

function valueToX(gameMin: number, xMax: number): number {
  const usableW = CHART_W - PLOT_LEFT - PLOT_RIGHT;
  return PLOT_LEFT + (Math.max(0, gameMin) / Math.max(1, xMax)) * usableW;
}

function valueToY(epa: number, domain: number): number {
  const usableH = CHART_H - PLOT_TOP - PLOT_BOTTOM;
  const center = PLOT_TOP + usableH / 2;
  const normalized = epa / Math.max(1e-6, domain);
  return center - normalized * (usableH / 2);
}

function formatAxisTick(value: number): string {
  if (Math.abs(value) < 1e-6) return '0';
  if (Math.abs(value) >= 10) return `${Math.round(value)}`;
  return `${Math.round(value * 10) / 10}`;
}

function niceAxisAbs(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const factor = 10 ** exponent;
  const normalized = raw / factor;
  if (normalized <= 1) return 1 * factor;
  if (normalized <= 1.25) return 1.25 * factor;
  if (normalized <= 1.5) return 1.5 * factor;
  if (normalized <= 2) return 2 * factor;
  if (normalized <= 2.5) return 2.5 * factor;
  if (normalized <= 3) return 3 * factor;
  if (normalized <= 4) return 4 * factor;
  if (normalized <= 5) return 5 * factor;
  return 10 * factor;
}

function computeAxisDomain(series: TeamSeriesPoint[]): number {
  const maxAbs = Math.max(0.5, maxAbsEpa(series));
  const padded = maxAbs * 1.08;
  return Math.max(0.5, niceAxisAbs(padded));
}

function buildYTicks(domain: number): number[] {
  return [-domain, -domain / 2, 0, domain / 2, domain];
}

function buildQuarterTicks(xMax: number, hasOt: boolean): QuarterTick[] {
  const clampedMax = Math.max(0, xMax);
  const ticks: QuarterTick[] = [
    { value: 0, label: 'START' },
    { value: 15, label: 'Q1' },
    { value: 30, label: 'Q2' },
    { value: 45, label: 'Q3' },
    { value: 60, label: 'Q4' },
  ].filter((tick) => tick.value <= clampedMax + 1e-6);

  if (hasOt && clampedMax > 60 + 1e-6) {
    ticks.push({ value: clampedMax, label: 'OT' });
  }

  return ticks;
}
