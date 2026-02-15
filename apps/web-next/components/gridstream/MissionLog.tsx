'use client';

import type { MissionLogEntry } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface MissionLogProps {
  plays: MissionLogEntry[];
}

export function MissionLog({ plays }: MissionLogProps) {
  return (
    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
      {/* Header row */}
      <div style={{
        display: 'flex', gap: 8, padding: '8px 20px',
        borderBottom: `1px solid ${C.panelBorder}`,
        position: 'sticky', top: 0, background: C.bgPanel, zIndex: 1,
      }}>
        <span style={{ ...headerStyle, width: 32 }}>Q</span>
        <span style={{ ...headerStyle, width: 55 }}>TIME</span>
        <span style={{ ...headerStyle, width: 80 }}>DOWN</span>
        <span style={{ ...headerStyle, flex: 1 }}>EVENT</span>
        <span style={{ ...headerStyle, width: 55, textAlign: 'right' }}>EPA</span>
      </div>

      {/* Play rows (newest first) */}
      {[...plays].reverse().map((p, i) => (
        <div
          key={p.id}
          className="play-row"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          {/* Quarter badge */}
          <span style={{
            width: 32, fontFamily: F.display, fontSize: 9, fontWeight: 600,
            letterSpacing: '.08em', color: C.cyanDim,
            opacity: p.type === 'info' ? 0 : 1,
          }}>
            Q{p.quarter}
          </span>

          {/* Clock */}
          <span style={{ width: 55, fontSize: 12, color: C.textDim }}>
            {p.clock}
          </span>

          {/* Down */}
          <span style={{ width: 80, fontSize: 12, color: C.textDim }}>
            {p.down}
          </span>

          {/* Event description */}
          <span style={{
            flex: 1, fontSize: 13, lineHeight: 1.5,
            color: p.type === 'turnover' ? C.red
              : p.type === 'score' ? C.green
              : C.text,
          }}>
            {p.team && (
              <span style={{
                fontFamily: F.body, fontWeight: 700, fontSize: 11,
                letterSpacing: '.06em', color: C.textDim, marginRight: 8,
              }}>
                {p.team}
              </span>
            )}
            {p.text}
          </span>

          {/* EPA */}
          <span style={{
            width: 55, textAlign: 'right', fontSize: 12,
            fontFamily: F.display, fontWeight: 600,
            color: p.epa > 0.5 ? C.green : p.epa < -0.5 ? C.red : C.textDim,
          }}>
            {p.epa > 0 ? '+' : ''}
            {p.epa !== 0 ? p.epa.toFixed(1) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

const headerStyle = {
  fontFamily: "'Orbitron', monospace",
  fontSize: 8,
  fontWeight: 600 as const,
  letterSpacing: '.2em',
  color: C.textDim,
  textTransform: 'uppercase' as const,
};
