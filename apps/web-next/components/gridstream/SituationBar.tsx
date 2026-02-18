'use client';

/**
 * Situation row below the score bug.
 *
 * Keeps a stable height so timeout states do not shift surrounding controls.
 * `timeoutNotice` is accepted for future variants, but this version always
 * renders down/distance + spot when the game is not final.
 */

import type { Situation } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface SituationBarProps {
  situation: Situation;
  isFinal: boolean;
  timeoutNotice?: string | null;
}

export function SituationBar({
  situation,
  isFinal,
}: SituationBarProps) {
  const downText = situation.down === 1 ? '1ST' : situation.down === 2 ? '2ND' : situation.down === 3 ? '3RD' : '4TH';
  const yardlineText = situation.yardLine > 0 ? `${situation.side} ${situation.yardLine}` : '—';

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 48, padding: '8px 0 14px', gap: 12, position: 'relative', zIndex: 3 }}>
      {isFinal ? (
        <span style={{ fontFamily: F.display, fontSize: 13, fontWeight: 700, color: C.textDim, letterSpacing: '.15em' }}>FINAL</span>
      ) : (<>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span
            style={{
              fontFamily: F.display,
              fontSize: 13,
              fontWeight: 700,
              color: C.amber,
              letterSpacing: '.1em',
              minWidth: 132,
              height: 30,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 18px',
              background: 'rgba(255,182,18,.06)',
              border: `1px solid ${C.amberBorder}`,
            }}
          >
            {situation.down > 0 ? `${downText} & ${situation.distance}` : '\u2014'}
          </span>
          <span style={{ fontFamily: F.display, fontSize: 10, color: C.textDim, letterSpacing: '.15em', width: 18, textAlign: 'center' }}>AT</span>
          <span style={{ fontFamily: F.display, fontSize: 16, fontWeight: 700, color: C.textBright, letterSpacing: '.08em', minWidth: 86, textAlign: 'left' }}>
            {yardlineText}
          </span>
        </div>
      </>)}

    </div>
  );
}
