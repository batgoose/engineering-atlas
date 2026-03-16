'use client';

/**
 * Team metrics tab.
 *
 * Each row is cumulative to the selected replay frame, not hardcoded finals.
 * Bar lengths are relative visual guides (using row max + baseline cap).
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
          display: 'grid',
          gridTemplateColumns: '1fr 160px 1fr',
          alignItems: 'center',
          padding: '0 20px 10px',
          borderBottom: `1px solid rgba(0,229,255,.05)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <div
            style={{
              width: 'min(100%, 320px)',
              display: 'flex',
              justifyContent: 'flex-start',
              gap: 10,
            }}
          >
            <TeamBadge team={away} size={22} hasPossession={false} />
            <span className="hud-label" style={{ color: C.text }}>
              {away.abbr}
            </span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10 }}
        >
          <div
            style={{
              width: 'min(100%, 320px)',
              display: 'flex',
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
      </div>
      {rows.map((r, i) => {
        const aN = typeof r.a === 'number' ? r.a : null;
        const hN = typeof r.h === 'number' ? r.h : null;
        const scaleMax =
          aN != null && hN != null ? Math.max(1, r.max ?? 0, aN, hN) : Math.max(1, r.max ?? 0);
        const aPct = aN != null && r.max ? Math.min(100, (aN / scaleMax) * 100) : null;
        const hPct = hN != null && r.max ? Math.min(100, (hN / scaleMax) * 100) : null;
        const aB = aN !== null && hN !== null && aN > hN;
        const hB = hN !== null && aN !== null && hN > aN;
        return (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 160px 1fr',
              alignItems: 'center',
              padding: '10px 20px',
              borderBottom: `1px solid rgba(0,229,255,.02)`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: 'min(100%, 320px)', textAlign: 'right', paddingRight: 12 }}>
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
                {aPct != null && (
                  <div className="stat-bar" title={`Relative scale: 0–${scaleMax}`}>
                    <div
                      style={{
                        height: '100%',
                        width: `${aPct}%`,
                        marginLeft: 'auto',
                        background: aB
                          ? `linear-gradient(270deg,${C.cyan}60,${C.cyan}20)`
                          : 'rgba(255,255,255,.06)',
                        transition: 'width .6s',
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            <div style={{ width: 160, textAlign: 'center' }}>
              <span className="hud-label">{r.label}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ width: 'min(100%, 320px)', textAlign: 'left', paddingLeft: 12 }}>
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
                {hPct != null && (
                  <div className="stat-bar" title={`Relative scale: 0–${scaleMax}`}>
                    <div
                      style={{
                        height: '100%',
                        width: `${hPct}%`,
                        background: hB
                          ? `linear-gradient(90deg,${C.cyan}60,${C.cyan}20)`
                          : 'rgba(255,255,255,.06)',
                        transition: 'width .6s',
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
