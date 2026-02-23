'use client';

/**
 * Team metrics tab.
 *
 * Each row is cumulative to the selected replay frame, not hardcoded finals.
 * `max` values are visual scaling guides for bar lengths only.
 */

import type { HudTeam, TeamStatLine } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

interface TeamStatsPanelProps {
  stats: { away: TeamStatLine; home: TeamStatLine };
  away: HudTeam;
  home: HudTeam;
}

export function TeamStatsPanel({ stats, away, home }: TeamStatsPanelProps) {
  const rows: Array<{ label: string; a: string | number; h: string | number; max?: number }> = [
    { label: 'TOTAL YARDS', a: stats.away.totalYards, h: stats.home.totalYards, max: 500 },
    { label: 'PASSING', a: stats.away.passingYards, h: stats.home.passingYards, max: 400 },
    { label: 'RUSHING', a: stats.away.rushingYards, h: stats.home.rushingYards, max: 250 },
    { label: '1ST DOWNS', a: stats.away.firstDowns, h: stats.home.firstDowns, max: 30 },
    { label: '3RD DOWN', a: stats.away.thirdDown, h: stats.home.thirdDown },
    { label: 'SACKS', a: stats.away.sacks, h: stats.home.sacks },
    { label: 'TURNOVERS', a: stats.away.turnovers, h: stats.home.turnovers },
    { label: 'POSSESSION', a: stats.away.top, h: stats.home.top },
    { label: 'PENALTIES', a: stats.away.penalties, h: stats.home.penalties },
  ];

  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          display: 'flex',
          padding: '0 20px 10px',
          borderBottom: `1px solid rgba(0,229,255,.05)`,
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <TeamBadge team={away} size={22} hasPossession={false} />
          <span className="hud-label" style={{ color: C.text }}>
            {away.abbr}
          </span>
        </div>
        <div style={{ width: 140 }} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <span className="hud-label" style={{ color: C.text }}>
            {home.abbr}
          </span>
          <TeamBadge team={home} size={22} hasPossession={false} />
        </div>
      </div>
      {rows.map((r, i) => {
        const aN = typeof r.a === 'number' ? r.a : null;
        const hN = typeof r.h === 'number' ? r.h : null;
        const aB = aN !== null && hN !== null && aN > hN;
        const hB = hN !== null && aN !== null && hN > aN;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 20px',
              borderBottom: `1px solid rgba(0,229,255,.02)`,
            }}
          >
            <div style={{ flex: 1 }}>
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: 14,
                  fontWeight: 700,
                  color: aB ? C.cyan : C.textDim,
                  textShadow: aB ? `0 0 6px ${C.cyanGlow}` : 'none',
                }}
              >
                {r.a}
              </span>
              {r.max && aN != null && (
                <div className="stat-bar">
                  <div
                    style={{
                      height: '100%',
                      width: `${(aN / r.max) * 100}%`,
                      background: aB
                        ? `linear-gradient(90deg,${C.cyan}60,${C.cyan}20)`
                        : 'rgba(255,255,255,.06)',
                      transition: 'width .6s',
                    }}
                  />
                </div>
              )}
            </div>
            <div style={{ width: 140, textAlign: 'center' }}>
              <span className="hud-label">{r.label}</span>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: 14,
                  fontWeight: 700,
                  color: hB ? C.cyan : C.textDim,
                  textShadow: hB ? `0 0 6px ${C.cyanGlow}` : 'none',
                }}
              >
                {r.h}
              </span>
              {r.max && hN != null && (
                <div className="stat-bar">
                  <div
                    style={{
                      height: '100%',
                      width: `${(hN / r.max) * 100}%`,
                      marginLeft: 'auto',
                      background: hB
                        ? `linear-gradient(270deg,${C.cyan}60,${C.cyan}20)`
                        : 'rgba(255,255,255,.06)',
                      transition: 'width .6s',
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
