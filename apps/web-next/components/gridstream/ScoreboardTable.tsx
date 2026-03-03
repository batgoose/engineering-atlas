'use client';

/**
 * Quarter-by-quarter scoreboard grid.
 *
 * Values come from the current replay frame, so this table reflects "state at
 * play N" rather than final totals unless the user is at the end frame.
 */

import { useEffect, useState } from 'react';
import type { HudTeam, ScoreByQuarter } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

interface ScoreboardTableProps {
  away: HudTeam;
  home: HudTeam;
  awayScore: ScoreByQuarter;
  homeScore: ScoreByQuarter;
  possession: 'home' | 'away' | null;
  currentQuarter: number;
  isFinal: boolean;
}

export function ScoreboardTable({
  away,
  home,
  awayScore,
  homeScore,
  possession,
  currentQuarter,
  isFinal,
}: ScoreboardTableProps) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const teams = [
    { team: away, scores: awayScore, isP: possession === 'away', oppScore: homeScore.total },
    { team: home, scores: homeScore, isP: possession === 'home', oppScore: awayScore.total },
  ];
  const qScores = (s: ScoreByQuarter) => [s.q1, s.q2, s.q3, s.q4];

  return (
    <div className="hud-panel" style={{ padding: isMobile ? '6px 8px' : '10px 20px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: isMobile ? '3px 4px' : '4px 8px',
                width: isMobile ? '30%' : '35%',
              }}
            >
              <span className="hud-label">TEAM</span>
            </th>
            {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
              <th
                key={q}
                style={{ textAlign: 'center', padding: isMobile ? '3px 4px' : '4px 8px' }}
              >
                <span className="hud-label">{q}</span>
              </th>
            ))}
            <th
              style={{
                textAlign: 'center',
                padding: isMobile ? '3px 4px' : '4px 8px',
                width: '12%',
              }}
            >
              <span className="hud-label">TOT</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map(({ team, scores, isP, oppScore }) => (
            <tr
              key={team.abbr}
              style={{
                borderTop: `1px solid ${C.panelBorder}`,
                background: isP ? 'rgba(255,182,18,0.02)' : 'transparent',
              }}
            >
              <td style={{ padding: isMobile ? '5px 4px' : '6px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 5 : 10 }}>
                  <TeamBadge
                    team={team}
                    size={isMobile ? 18 : 24}
                    hasPossession={isP}
                    variant="scoreboard-dark"
                  />
                  <span
                    style={{
                      fontFamily: F.body,
                      fontWeight: 700,
                      fontSize: isMobile ? 12 : 15,
                      color: C.textBright,
                      letterSpacing: '.03em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isMobile ? team.abbr.toUpperCase() : team.displayName}
                  </span>
                  {isP && !isMobile && (
                    <span
                      style={{
                        fontFamily: F.display,
                        fontSize: 8,
                        fontWeight: 600,
                        letterSpacing: '.12em',
                        color: C.amber,
                        padding: '1px 6px',
                        border: `1px solid ${C.amberBorder}`,
                        background: 'rgba(255,182,18,.06)',
                      }}
                    >
                      POSS
                    </span>
                  )}
                  {isP && isMobile && (
                    <div
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: C.amber,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </div>
              </td>
              {qScores(scores).map((s, i) => {
                const isFuture = !isFinal && currentQuarter > 0 && i + 1 > currentQuarter;
                return (
                  <td
                    key={i}
                    style={{
                      textAlign: 'center',
                      padding: isMobile ? '5px 4px' : '6px 8px',
                      fontFamily: F.display,
                      fontSize: isMobile ? 12 : 14,
                      fontWeight: 600,
                      color: isFuture ? C.textDim : C.text,
                    }}
                  >
                    {isFuture ? '\u2014' : s}
                  </td>
                );
              })}
              <td
                style={{
                  textAlign: 'center',
                  padding: isMobile ? '5px 4px' : '6px 8px',
                  fontFamily: F.display,
                  fontSize: isMobile ? 16 : 20,
                  fontWeight: 800,
                  color: scores.total > oppScore ? C.cyan : C.textDim,
                  textShadow: scores.total > oppScore ? `0 0 8px ${C.cyanGlow}` : 'none',
                }}
              >
                {scores.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
