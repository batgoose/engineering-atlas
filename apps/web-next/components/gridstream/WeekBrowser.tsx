'use client';

import type { CSSProperties } from 'react';
import { weekLabel, isPostseasonWeek } from '@atlas/sdk/gridstream/api-transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

const FIRST_SEASON = 1999;
const LAST_SEASON = 2025;
const REG_WEEKS = 18;

const POSTSEASON_WEEKS = [
  { week: 19, label: 'Wild Card' },
  { week: 20, label: 'Divisional' },
  { week: 21, label: 'Conf Champs' },
  { week: 22, label: 'Super Bowl' },
];

interface WeekBrowserProps {
  season: number;
  week: number;
  onChange: (season: number, week: number) => void;
  neutralSelection?: boolean;
}

export function WeekBrowser({
  season,
  week,
  onChange,
  neutralSelection = false,
}: WeekBrowserProps) {
  const isPost = isPostseasonWeek(week);
  const currentRegWeek = isPost ? REG_WEEKS : week;

  function prevWeek() {
    if (week > 1) onChange(season, week - 1);
    else if (season > FIRST_SEASON) onChange(season - 1, 22);
  }

  function nextWeek() {
    if (week < 22) onChange(season, week + 1);
    else if (season < LAST_SEASON) onChange(season + 1, 1);
  }

  const seasons = [];
  for (let y = LAST_SEASON; y >= FIRST_SEASON; y--) seasons.push(y);

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 30,
        background: 'rgba(2, 12, 30, 0.92)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${C.panelBorder}`,
        padding: '8px 20px 10px',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* Title row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            marginBottom: 6,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: F.display,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: C.cyan,
              }}
            >
              GRIDSTREAM
            </span>
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: C.textMuted,
                letterSpacing: '0.1em',
              }}
            >
              / GAMES /
            </span>
            <span
              style={{
                fontFamily: F.display,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.12em',
                color: C.textDim,
              }}
            >
              {weekLabel(week).toUpperCase()}
            </span>
          </div>
        </div>

        {/* Unified controls row: regular + postseason */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <button onClick={prevWeek} style={navBtnStyle} aria-label="Previous week">
            ◀
          </button>
          <div
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              maxWidth: 'clamp(220px, 40vw, 460px)',
              border: `1px solid rgba(0,229,255,0.18)`,
              background: 'rgba(0,229,255,0.03)',
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            {weekWindow(currentRegWeek, REG_WEEKS).map((w) => {
              const active = !neutralSelection && !isPost && week === w;
              return (
                <button
                  key={w}
                  onClick={() => onChange(season, w)}
                  style={{
                    fontFamily: F.mono,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '7px 12px',
                    background: active ? 'rgba(0,229,255,0.16)' : 'rgba(0,229,255,0.03)',
                    border: `1px solid ${active ? C.cyan : C.panelBorder}`,
                    color: active ? C.cyan : C.textDim,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                    minWidth: 40,
                    textAlign: 'center',
                    letterSpacing: '0.06em',
                    borderRadius: 4,
                    ...(active && { textShadow: `0 0 8px ${C.cyan}66` }),
                  }}
                >
                  {w}
                </button>
              );
            })}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              border: `1px solid rgba(0,229,255,0.18)`,
              background: 'rgba(0,229,255,0.03)',
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            {POSTSEASON_WEEKS.map(({ week: w, label }) => {
              const active = !neutralSelection && week === w;
              return (
                <button
                  key={w}
                  onClick={() => onChange(season, w)}
                  style={{
                    fontFamily: F.display,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    padding: '8px 12px',
                    background: active ? 'rgba(0,229,255,0.14)' : 'rgba(0,229,255,0.03)',
                    border: `1px solid ${active ? C.cyan : C.panelBorder}`,
                    color: active ? C.cyan : C.textDim,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    borderRadius: 4,
                    ...(active && { textShadow: `0 0 8px ${C.cyan}66` }),
                  }}
                >
                  {label.toUpperCase()}
                </button>
              );
            })}
          </div>
          <button onClick={nextWeek} style={navBtnStyle} aria-label="Next week">
            ▶
          </button>

          <select
            value={season}
            onChange={(e) => onChange(Number(e.target.value), Math.min(Math.max(week, 1), 22))}
            style={{
              fontFamily: F.display,
              fontSize: 11,
              fontWeight: 700,
              color: C.textBright,
              background: 'rgba(0,229,255,0.08)',
              border: `1px solid ${C.panelBorder}`,
              borderRadius: 5,
              minHeight: 34,
              padding: '7px 12px',
              outline: 'none',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              marginLeft: 'auto',
            }}
          >
            {seasons.map((y) => (
              <option key={y} value={y} style={{ background: C.panel }}>
                {y} SEASON
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// Render up to 5 week buttons centered on `center`, clamped to [1, max].
function weekWindow(center: number, max: number): number[] {
  const half = 2;
  let lo = Math.max(1, center - half);
  let hi = Math.min(max, lo + 4);
  lo = Math.max(1, hi - 4);
  const weeks = [];
  for (let w = lo; w <= hi; w++) weeks.push(w);
  return weeks;
}

const navBtnStyle: CSSProperties = {
  fontFamily: "'Orbitron', monospace",
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: 0,
  color: C.cyan,
  background: 'rgba(0,229,255,0.08)',
  border: `1px solid ${C.panelBorder}`,
  cursor: 'pointer',
  width: 36,
  height: 36,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
  flexShrink: 0,
  borderRadius: 4,
  textShadow: `0 0 8px ${C.cyan}66`,
};
