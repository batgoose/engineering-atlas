'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { weekLabel, isPostseasonWeek } from '@atlas/sdk/gridstream/api-transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

const FIRST_SEASON = 1999;
const LAST_SEASON = 2025;

const POSTSEASON_WEEKS = [
  { week: 19, label: 'Wild Card', shortLabel: 'WC' },
  { week: 20, label: 'Divisional', shortLabel: 'DIV' },
  { week: 21, label: 'Conf Champs', shortLabel: 'CONF' },
  { week: 22, label: 'Super Bowl', shortLabel: 'SB' },
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
  const maxRegWeek = season >= 2021 ? 18 : 17;
  const currentRegWeek = isPost ? maxRegWeek : week;

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function prevWeek() {
    if (week > 1) {
      const prev = week - 1;
      // Skip week 18 for pre-2021 seasons (only 17-game regular seasons)
      onChange(season, prev === 18 && season < 2021 ? 17 : prev);
    } else if (season > FIRST_SEASON) {
      onChange(season - 1, 22);
    }
  }

  function nextWeek() {
    if (week < 22) {
      const next = week + 1;
      // Skip week 18 for pre-2021 seasons
      onChange(season, next === 18 && season < 2021 ? 19 : next);
    } else if (season < LAST_SEASON) {
      onChange(season + 1, 1);
    }
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

        {/* Controls */}
        {isMobile ? (
          /* ── Mobile: single scrollable row with reg + postseason ── */
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
            <button onClick={prevWeek} style={navBtnStyle} aria-label="Previous week">
              ◀
            </button>
            <div
              style={{
                display: 'flex',
                gap: 6,
                overflowX: 'auto',
                flex: '1 1 0',
                minWidth: 0,
                border: `1px solid rgba(0,229,255,0.18)`,
                background: 'rgba(0,229,255,0.03)',
                padding: '4px 6px',
                borderRadius: 4,
              }}
            >
              {weekWindow(currentRegWeek, maxRegWeek).map((w) => {
                const active = !neutralSelection && !isPost && week === w;
                return (
                  <button
                    key={w}
                    onClick={() => onChange(season, w)}
                    style={{
                      fontFamily: F.mono,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '7px 10px',
                      background: active ? 'rgba(0,229,255,0.16)' : 'rgba(0,229,255,0.03)',
                      border: `1px solid ${active ? C.cyan : C.panelBorder}`,
                      color: active ? C.cyan : C.textDim,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                      minWidth: 36,
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
              {/* Separator */}
              <div
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  background: 'rgba(0,229,255,0.15)',
                  flexShrink: 0,
                  margin: '2px 2px',
                }}
              />
              {POSTSEASON_WEEKS.map(({ week: w, shortLabel }) => {
                const active = !neutralSelection && week === w;
                return (
                  <button
                    key={w}
                    onClick={() => onChange(season, w)}
                    style={{
                      fontFamily: F.display,
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      padding: '7px 8px',
                      background: active ? 'rgba(0,229,255,0.14)' : 'rgba(0,229,255,0.03)',
                      border: `1px solid ${active ? C.cyan : C.panelBorder}`,
                      color: active ? C.cyan : C.textDim,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      ...(active && { textShadow: `0 0 8px ${C.cyan}66` }),
                    }}
                  >
                    {shortLabel}
                  </button>
                );
              })}
            </div>
            <button onClick={nextWeek} style={navBtnStyle} aria-label="Next week">
              ▶
            </button>
            <select
              value={season}
              onChange={(e) => {
                const newSeason = Number(e.target.value);
                const clipped = Math.min(Math.max(week, 1), 22);
                const adjusted = clipped === 18 && newSeason < 2021 ? 17 : clipped;
                onChange(newSeason, adjusted);
              }}
              style={{
                fontFamily: F.display,
                fontSize: 10,
                fontWeight: 700,
                color: C.textBright,
                background: 'rgba(0,229,255,0.08)',
                border: `1px solid ${C.panelBorder}`,
                borderRadius: 5,
                minHeight: 34,
                padding: '7px 8px',
                outline: 'none',
                cursor: 'pointer',
                letterSpacing: '0.06em',
                flexShrink: 0,
              }}
            >
              {seasons.map((y) => (
                <option key={y} value={y} style={{ background: C.panel }}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        ) : (
          /* ── Desktop: two rows ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Row 1: regular-season navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
              <button onClick={prevWeek} style={navBtnStyle} aria-label="Previous week">
                ◀
              </button>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  overflowX: 'auto',
                  flex: '0 1 auto',
                  border: `1px solid rgba(0,229,255,0.18)`,
                  background: 'rgba(0,229,255,0.03)',
                  padding: '4px 6px',
                  borderRadius: 4,
                }}
              >
                {weekWindow(currentRegWeek, maxRegWeek).map((w) => {
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
              <button onClick={nextWeek} style={navBtnStyle} aria-label="Next week">
                ▶
              </button>
              <select
                value={season}
                onChange={(e) => {
                  const newSeason = Number(e.target.value);
                  const clipped = Math.min(Math.max(week, 1), 22);
                  const adjusted = clipped === 18 && newSeason < 2021 ? 17 : clipped;
                  onChange(newSeason, adjusted);
                }}
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
                  flexShrink: 0,
                }}
              >
                {seasons.map((y) => (
                  <option key={y} value={y} style={{ background: C.panel }}>
                    {y} SEASON
                  </option>
                ))}
              </select>
            </div>
            {/* Row 2: postseason buttons */}
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
                alignSelf: 'flex-start',
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
          </div>
        )}
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
