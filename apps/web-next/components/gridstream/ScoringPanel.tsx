'use client';

/**
 * Scoring tab grouped by quarter.
 *
 * The input list should already be frame-sliced in the route layer, so this
 * panel can stay purely presentational.
 */

import type { HudTeam, ScoringEntry } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

interface ScoringPanelProps {
  scoring: ScoringEntry[];
  away: HudTeam;
  home: HudTeam;
}

export function ScoringPanel({ scoring, away, home }: ScoringPanelProps) {
  // Pre-compute which entries are the first of their quarter so the render
  // stays pure (no mutation inside map()).
  const showQuarterHeader = scoring.map((s, i) => i === 0 || s.q !== scoring[i - 1]!.q);

  return (
    <div style={{ padding: '8px 0' }}>
      {scoring.length === 0 && (
        <div style={{ padding: 20, color: C.textDim, fontFamily: F.mono, fontSize: 12 }}>No scoring plays yet!</div>
      )}
      {scoring.map((s, i) => {
        const showQ = showQuarterHeader[i];
        const isA = s.team === away.abbr;
        return (
          <div key={i}>
            {showQ && <div style={{ padding: '10px 20px 6px', borderBottom: `1px solid rgba(0,229,255,.05)` }}><span className="hud-label">{s.q === 5 ? 'OVERTIME' : `QUARTER ${s.q}`}</span></div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px', borderBottom: `1px solid rgba(0,229,255,.02)` }}>
              <TeamBadge team={isA ? away : home} size={22} hasPossession={false} />
              <span style={{ fontFamily: F.body, fontWeight: 700, fontSize: 12, color: C.textDim, width: 36 }}>{s.team}</span>
              <span style={{ flex: 1, fontSize: 13, color: C.text }}>{s.desc}</span>
              <span style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, color: C.textBright, letterSpacing: '.05em' }}>{s.awayScore}–{s.homeScore}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
