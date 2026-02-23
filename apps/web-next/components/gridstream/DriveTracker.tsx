'use client';

import type { DriveProgress } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface DriveTrackerProps {
  drive: DriveProgress | null;
  possessionTeam: string;
}

export function DriveTracker({ drive, possessionTeam }: DriveTrackerProps) {
  if (!drive) return null;

  return (
    <div className="hud-panel" style={{ padding: '10px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="hud-label">CURRENT DRIVE</span>
        <span
          style={{
            fontFamily: F.display,
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 8px',
            color: C.amber,
            background: 'rgba(255,182,18,.1)',
            letterSpacing: '.1em',
          }}
        >
          {possessionTeam}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 24,
          fontFamily: F.display,
        }}
      >
        <StatBlock label="PLAYS" value={String(drive.plays)} />
        <StatBlock label="YARDS" value={String(drive.yards)} />
        <StatBlock label="TIME" value={drive.time || '0:00'} />
      </div>

      <div
        style={{
          marginTop: 6,
          fontFamily: F.mono,
          fontSize: 11,
          color: C.textDim,
          letterSpacing: '.06em',
        }}
      >
        STARTED {drive.startSide} {drive.startYardLine}
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: '.2em',
          color: C.textDim,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: C.textBright,
          letterSpacing: '.04em',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}
