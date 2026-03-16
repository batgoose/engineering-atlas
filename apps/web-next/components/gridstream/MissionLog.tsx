'use client';

/**
 * Mission log table (play-by-play feed) for the active replay frame.
 *
 * Each entry uses two rows: the first shows Q / time / down / EPA metadata,
 * the second shows the full event description.
 */

import type { MissionLogEntry } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface MissionLogProps {
  plays: MissionLogEntry[];
}

export function MissionLog({ plays }: MissionLogProps) {
  return (
    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 16px',
          borderBottom: `1px solid ${C.panelBorder}`,
          position: 'sticky',
          top: 0,
          background: C.panel,
          zIndex: 1,
        }}
      >
        <span style={{ ...headerStyle, width: 28 }}>Q</span>
        <span style={{ ...headerStyle, width: 50 }}>TIME</span>
        <span style={{ ...headerStyle, flex: 1 }}>DOWN</span>
        <span style={{ ...headerStyle, width: 50, textAlign: 'right' }}>EPA</span>
      </div>

      {/* Play rows (newest first) */}
      {[...plays].reverse().map((p, i) => {
        const attributionTags = (p.attribution ?? '')
          .split(' · ')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
        const textLower = p.text.toLowerCase();
        const eventColor =
          p.type === 'turnover' || textLower.includes('intercept') || textLower.includes('sack')
            ? C.red
            : p.type === 'score' ||
                textLower.includes('field goal') ||
                textLower.includes('touchdown')
              ? C.green
              : textLower.includes('punt')
                ? C.cyan
                : C.text;

        return (
          <div
            key={p.id}
            className="play-row"
            style={{
              animationDelay: `${i * 50}ms`,
              flexDirection: 'column',
              gap: 4,
              padding: '8px 16px',
            }}
          >
            {/* Row 1: metadata */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  width: 28,
                  fontFamily: F.display,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '.08em',
                  color: C.cyanDim,
                  opacity: p.type === 'info' ? 0 : 1,
                  flexShrink: 0,
                }}
              >
                Q{p.quarter}
              </span>
              <span style={{ width: 50, fontSize: 11, color: C.textDim, flexShrink: 0 }}>
                {p.clock}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: C.textDim }}>{p.down}</span>
              <span
                style={{
                  width: 50,
                  textAlign: 'right',
                  fontSize: 11,
                  fontFamily: F.display,
                  fontWeight: 600,
                  color: p.epa > 0.5 ? C.green : p.epa < -0.5 ? C.red : C.textDim,
                  flexShrink: 0,
                }}
              >
                {p.epa > 0 ? '+' : ''}
                {p.epa !== 0 ? p.epa.toFixed(1) : '—'}
              </span>
            </div>

            {/* Row 2: event description */}
            <div style={{ paddingLeft: 36 }}>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: eventColor }}>
                {p.team && (
                  <span
                    style={{
                      fontFamily: F.body,
                      fontWeight: 700,
                      fontSize: 11,
                      letterSpacing: '.06em',
                      color: C.textDim,
                      marginRight: 6,
                    }}
                  >
                    {p.team}
                  </span>
                )}
                {p.text}
              </span>
              {p.attribution && (
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: F.display,
                    fontSize: 9,
                    letterSpacing: '.08em',
                    color: C.textMuted,
                    textTransform: 'uppercase',
                  }}
                >
                  {attributionTags.map((tag, idx) => (
                    <span
                      key={`${p.id}-attr-${idx}`}
                      style={{ color: tag.startsWith('PEN:') ? C.amber : C.textMuted }}
                    >
                      {tag}
                      {idx < attributionTags.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const headerStyle = {
  fontFamily: F.display,
  fontSize: 8,
  fontWeight: 600 as const,
  letterSpacing: '.2em',
  color: C.textDim,
  textTransform: 'uppercase' as const,
};
