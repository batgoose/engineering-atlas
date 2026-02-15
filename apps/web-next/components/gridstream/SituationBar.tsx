'use client';

import type { Situation } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface SituationBarProps {
  situation: Situation;
  network: string;
  spread: number | null;
  awayAbbr: string;
  homeAbbr: string;
  // Play navigation
  onReplay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLive: () => void;
  isReplaying: boolean;
}

export function SituationBar({
  situation, network, spread, awayAbbr, homeAbbr,
  onReplay, onPrev, onNext, onFirst, onLive, isReplaying,
}: SituationBarProps) {
  const spreadStr = spread != null
    ? `${homeAbbr} ${spread > 0 ? '+' : ''}${spread}`
    : '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: '8px 0', fontFamily: F.mono,
    }}>
      {/* Possession indicator */}
      <span style={{
        fontSize: 12, fontWeight: 700, color: C.amber,
        letterSpacing: '.08em',
      }}>
        ◀ {situation.possessionTeam} BALL
      </span>

      {/* Down & Distance pill */}
      <div style={{
        fontFamily: F.display, fontSize: 13, fontWeight: 700,
        padding: '5px 18px',
        background: `linear-gradient(135deg, ${C.amber}, #e09800)`,
        color: C.bg, letterSpacing: '.08em',
        textTransform: 'uppercase',
      }}>
        {situation.downDistText || '—'}
      </div>

      {/* Yard line */}
      <span style={{ fontSize: 12, color: C.textDim }}>
        AT&nbsp;
        <span style={{ color: C.text, fontWeight: 600 }}>
          {situation.side} {situation.yardLine}
        </span>
      </span>

      {/* Network + spread */}
      {network && (
        <span style={{ fontSize: 11, color: C.textDim }}>
          {network}
          {spreadStr && (
            <> · <span style={{ color: C.textDim }}>{spreadStr}</span></>
          )}
        </span>
      )}

      <Divider />

      {/* Replay button */}
      <button className="replay-btn" onClick={onReplay}>
        ▶ REPLAY
      </button>

      <Divider />

      {/* Play navigation */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <NavButton onClick={onFirst} title="First play" disabled={!isReplaying && false}>
          ⏮
        </NavButton>
        <NavButton onClick={onPrev} title="Previous play">
          ◀◀
        </NavButton>
        <NavButton onClick={onNext} title="Next play" disabled={!isReplaying}>
          ▶▶
        </NavButton>
        <button
          className="replay-btn"
          onClick={onLive}
          title="Jump to live"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            opacity: isReplaying ? 1 : 0.4,
          }}
        >
          LIVE
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: isReplaying ? C.amber : C.red,
            animation: isReplaying ? 'none' : 'pulse 2s ease-in-out infinite',
          }} />
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 14, background: C.panelBorder }} />;
}

function NavButton({ onClick, title, disabled, children }: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className="replay-btn"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{ opacity: disabled ? 0.3 : 1 }}
    >
      {children}
    </button>
  );
}
