'use client';

import type { HudTeam, ScoreByQuarter, GameTiming } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface ScoreboardTableProps {
  away: HudTeam;
  home: HudTeam;
  awayScore: ScoreByQuarter;
  homeScore: ScoreByQuarter;
  timing: GameTiming;
  possession: 'home' | 'away' | null;
}

export function ScoreboardTable({
  away, home, awayScore, homeScore, timing, possession,
}: ScoreboardTableProps) {
  const hasOT = timing.isOT || awayScore.ot > 0 || homeScore.ot > 0;

  const columns = ['Q1', 'Q2', 'Q3', 'Q4'];
  if (hasOT) columns.push('OT');

  return (
    <div style={{
      border: `1px solid ${C.panelBorder}`,
      background: C.bgPanel,
    }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `1fr ${columns.map(() => '80px').join(' ')} 100px`,
        padding: '10px 20px',
        borderBottom: `1px solid ${C.panelBorder}`,
      }}>
        <span style={headerCellStyle}>TEAM</span>
        {columns.map((q) => (
          <span key={q} style={{ ...headerCellStyle, textAlign: 'center' }}>{q}</span>
        ))}
        <span style={{ ...headerCellStyle, textAlign: 'right' }}>TOTAL</span>
      </div>

      {/* Away row */}
      <TeamScoreRow
        team={away}
        score={awayScore}
        hasPossession={possession === 'away'}
        hasOT={hasOT}
        isHome={false}
      />

      {/* Home row */}
      <TeamScoreRow
        team={home}
        score={homeScore}
        hasPossession={possession === 'home'}
        hasOT={hasOT}
        isHome={true}
      />
    </div>
  );
}

function TeamScoreRow({ team, score, hasPossession, hasOT, isHome }: {
  team: HudTeam;
  score: ScoreByQuarter;
  hasPossession: boolean;
  hasOT: boolean;
  isHome: boolean;
}) {
  const quarters = [score.q1, score.q2, score.q3, score.q4];
  if (hasOT) quarters.push(score.ot);

  const colTemplate = `1fr ${quarters.map(() => '80px').join(' ')} 100px`;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: colTemplate,
      padding: '10px 20px',
      alignItems: 'center',
      borderBottom: `1px solid ${C.panelBorder}`,
      background: hasPossession ? 'rgba(0,229,255,.02)' : 'transparent',
    }}>
      {/* Team name + logo + possession */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontFamily: F.display, fontSize: 10, fontWeight: 700,
          color: `#${team.color}`, letterSpacing: '.08em',
        }}>
          {team.abbr}
        </span>
        <span style={{
          fontFamily: F.body, fontSize: 15, fontWeight: 700,
          color: C.textBright,
        }}>
          {team.displayName}
        </span>
        {hasPossession && (
          <span style={{
            fontFamily: F.display, fontSize: 8, fontWeight: 700,
            padding: '2px 8px', color: C.green,
            background: 'rgba(0,230,118,.1)',
            letterSpacing: '.15em',
          }}>
            POSS
          </span>
        )}
      </div>

      {/* Quarter scores */}
      {quarters.map((q, i) => (
        <span key={i} style={{
          textAlign: 'center',
          fontFamily: F.display, fontSize: 14, fontWeight: 600,
          color: q > 0 ? C.textBright : C.textDim,
        }}>
          {q > 0 ? q : '—'}
        </span>
      ))}

      {/* Total */}
      <span style={{
        textAlign: 'right',
        fontFamily: F.display, fontSize: 20, fontWeight: 800,
        color: isHome ? C.green : C.textBright,
      }}>
        {score.total}
      </span>
    </div>
  );
}

const headerCellStyle = {
  fontFamily: "'Orbitron', monospace",
  fontSize: 9,
  fontWeight: 600 as const,
  letterSpacing: '.15em',
  color: C.textDim,
  textTransform: 'uppercase' as const,
};
