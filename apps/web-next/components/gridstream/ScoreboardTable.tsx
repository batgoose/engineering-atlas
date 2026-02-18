'use client';

/**
 * Quarter-by-quarter scoreboard grid.
 *
 * Values come from the current replay frame, so this table reflects "state at
 * play N" rather than final totals unless the user is at the end frame.
 */

import type { HudTeam, ScoreByQuarter } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

interface ScoreboardTableProps {
  away: HudTeam;
  home: HudTeam;
  awayScore: ScoreByQuarter;
  homeScore: ScoreByQuarter;
  possession: 'home' | 'away' | null;
}

export function ScoreboardTable({ away, home, awayScore, homeScore, possession }: ScoreboardTableProps) {
  const teams = [
    { team: away, scores: awayScore, isP: possession === 'away', oppScore: homeScore.total },
    { team: home, scores: homeScore, isP: possession === 'home', oppScore: awayScore.total },
  ];
  const qScores = (s: ScoreByQuarter) => [s.q1, s.q2, s.q3, s.q4];

  return (
    <div className="hud-panel" style={{ padding: '10px 20px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px', width: '35%' }}><span className="hud-label">TEAM</span></th>
            {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => <th key={q} style={{ textAlign: 'center', padding: '4px 8px' }}><span className="hud-label">{q}</span></th>)}
            <th style={{ textAlign: 'center', padding: '4px 8px', width: '12%' }}><span className="hud-label">TOTAL</span></th>
          </tr>
        </thead>
        <tbody>
          {teams.map(({ team, scores, isP, oppScore }) => (
            <tr key={team.abbr} style={{ borderTop: `1px solid ${C.panelBorder}`, background: isP ? 'rgba(255,182,18,0.02)' : 'transparent' }}>
              <td style={{ padding: '6px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <TeamBadge team={team} size={24} hasPossession={isP} />
                  <span style={{ fontFamily: F.body, fontWeight: 700, fontSize: 15, color: C.textBright, letterSpacing: '.03em' }}>{team.displayName}</span>
                  {isP && <span style={{ fontFamily: F.display, fontSize: 8, fontWeight: 600, letterSpacing: '.12em', color: C.amber, padding: '1px 6px', border: `1px solid ${C.amberBorder}`, background: 'rgba(255,182,18,.06)' }}>POSS</span>}
                </div>
              </td>
              {qScores(scores).map((s, i) => (
                <td key={i} style={{ textAlign: 'center', padding: '6px 8px', fontFamily: F.display, fontSize: 14, fontWeight: 600, color: C.text }}>
                  {s ?? '\u2014'}
                </td>
              ))}
              <td style={{
                textAlign: 'center', padding: '6px 8px', fontFamily: F.display, fontSize: 20, fontWeight: 800,
                color: scores.total > oppScore ? C.cyan : C.textDim,
                textShadow: scores.total > oppScore ? `0 0 8px ${C.cyanGlow}` : 'none',
              }}>{scores.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
