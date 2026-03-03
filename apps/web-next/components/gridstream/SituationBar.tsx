'use client';

/**
 * Situation row below the score bug.
 *
 * Keeps a stable height so timeout states do not shift surrounding controls.
 * `timeoutNotice` is accepted for future variants, but this version always
 * renders down/distance + spot when the game is not final.
 */

import { useEffect, useState } from 'react';
import type { Situation } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface SituationBarProps {
  situation: Situation;
  isFinal: boolean;
  timeoutNotice?: string | null;
  overrideText?: string | null;
}

export function SituationBar({ situation, isFinal, overrideText }: SituationBarProps) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const downText =
    situation.down === 1
      ? '1ST'
      : situation.down === 2
        ? '2ND'
        : situation.down === 3
          ? '3RD'
          : '4TH';
  const yardlineText = situation.yardLine > 0 ? `${situation.side} ${situation.yardLine}` : '—';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 36,
        padding: '4px 0 2px',
        gap: 12,
        position: 'relative',
        zIndex: 3,
      }}
    >
      {isFinal ? (
        <span
          style={{
            fontFamily: F.display,
            fontSize: 13,
            fontWeight: 700,
            color: C.textDim,
            letterSpacing: '.15em',
          }}
        >
          FINAL
        </span>
      ) : (
        <>
          {overrideText ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                maxWidth: '100%',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: isMobile ? 11 : 13,
                  fontWeight: 700,
                  color: C.amber,
                  letterSpacing: '.08em',
                  minWidth: isMobile ? 0 : 220,
                  maxWidth: '100%',
                  height: 30,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: isMobile ? '4px 10px' : '4px 18px',
                  background: 'rgba(255,182,18,.06)',
                  border: `1px solid ${C.amberBorder}`,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: isMobile ? 'nowrap' : undefined,
                }}
              >
                {overrideText}
              </span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: isMobile ? 6 : 12,
              }}
            >
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: isMobile ? 11 : 13,
                  fontWeight: 700,
                  color: C.amber,
                  letterSpacing: '.1em',
                  minWidth: isMobile ? 0 : 132,
                  height: 30,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: isMobile ? '4px 10px' : '4px 18px',
                  background: 'rgba(255,182,18,.06)',
                  border: `1px solid ${C.amberBorder}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {situation.down > 0 ? `${downText} & ${situation.distance}` : '\u2014'}
              </span>
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: 10,
                  color: C.textDim,
                  letterSpacing: '.15em',
                  width: 18,
                  textAlign: 'center',
                }}
              >
                AT
              </span>
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: isMobile ? 13 : 16,
                  fontWeight: 700,
                  color: C.textBright,
                  letterSpacing: '.08em',
                  minWidth: isMobile ? 0 : 86,
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                {yardlineText}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
