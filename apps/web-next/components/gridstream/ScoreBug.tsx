'use client';

import type { HudTeam, ScoreByQuarter, GameTiming, WpTimelinePoint } from '@atlas/sdk/gridstream/types';
import { computeWpSparklinePoints, sparklineToPath } from '@atlas/sdk/gridstream/transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface ScoreBugProps {
  away: HudTeam;
  home: HudTeam;
  awayScore: ScoreByQuarter;
  homeScore: ScoreByQuarter;
  timing: GameTiming;
  possession: 'home' | 'away' | null;
  awayWinPct: number;
  wpTimeline: WpTimelinePoint[];
  network: string;
  spread: number | null;
}

export function ScoreBug({
  away, home, awayScore, homeScore, timing,
  possession, awayWinPct, wpTimeline,
}: ScoreBugProps) {
  const awayPts = computeWpSparklinePoints(
    wpTimeline, timing, true, 120, 32,
  );
  const homePts = computeWpSparklinePoints(
    wpTimeline, timing, false, 120, 32,
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 0, padding: '16px 24px',
      background: C.bgPanel, border: `1px solid ${C.panelBorder}`,
    }}>
      {/* Away team */}
      <TeamBlock
        team={away}
        score={awayScore.total}
        winPct={awayWinPct}
        sparkPoints={awayPts}
        hasPossession={possession === 'away'}
        side="away"
      />

      {/* Clock center */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '0 24px', minWidth: 140,
      }}>
        <span style={{
          fontFamily: F.display, fontSize: 10, fontWeight: 600,
          letterSpacing: '.15em', color: C.red,
        }}>
          Q{timing.quarter}
        </span>
        <span style={{
          fontFamily: F.display, fontSize: 28, fontWeight: 800,
          color: C.textBright, letterSpacing: '.05em',
        }}>
          {timing.clock}
        </span>
        <QuarterDots quarter={timing.quarter} isOT={timing.isOT} />
      </div>

      {/* Home team */}
      <TeamBlock
        team={home}
        score={homeScore.total}
        winPct={100 - awayWinPct}
        sparkPoints={homePts}
        hasPossession={possession === 'home'}
        side="home"
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function TeamBlock({ team, score, winPct, sparkPoints, hasPossession, side }: {
  team: HudTeam;
  score: number;
  winPct: number;
  sparkPoints: Array<{ x: number; y: number }>;
  hasPossession: boolean;
  side: 'home' | 'away';
}) {
  const isAway = side === 'away';
  const flexDir = isAway ? 'row' : 'row-reverse';

  return (
    <div style={{
      display: 'flex', flexDirection: flexDir, alignItems: 'center',
      gap: 12, flex: 1, justifyContent: isAway ? 'flex-end' : 'flex-start',
    }}>
      {/* Team info */}
      <div style={{ textAlign: isAway ? 'right' : 'left' }}>
        <div style={{
          fontFamily: F.body, fontSize: 22, fontWeight: 700,
          letterSpacing: '.05em', color: C.textBright, textTransform: 'uppercase',
        }}>
          {team.name}
        </div>
        <div style={{
          fontFamily: F.mono, fontSize: 10, color: C.textDim,
          letterSpacing: '.1em',
        }}>
          {team.displayName} · {team.record}
        </div>
        {/* Mini sparkline */}
        {sparkPoints.length > 1 && (
          <svg width={120} height={32} style={{ display: 'block', marginTop: 4 }}>
            <path
              d={sparklineToPath(sparkPoints)}
              fill="none"
              stroke={`#${team.color}`}
              strokeWidth={1.5}
              opacity={0.6}
            />
          </svg>
        )}
      </div>

      {/* Logo circle */}
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        border: `2px solid ${hasPossession ? C.amber : C.panelBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: C.bg,
        boxShadow: hasPossession ? `0 0 12px ${C.amberGlow}` : 'none',
      }}>
        <span style={{
          fontFamily: F.display, fontSize: 11, fontWeight: 800,
          color: `#${team.color}`, letterSpacing: '.05em',
        }}>
          {team.abbr}
        </span>
      </div>

      {/* Score */}
      <div style={{
        fontFamily: F.display, fontSize: 40, fontWeight: 800,
        color: C.textBright, lineHeight: 1, minWidth: 60,
        textAlign: 'center',
      }}>
        {score}
      </div>

      {/* Win % badge */}
      <div style={{
        fontFamily: F.display, fontSize: 11, fontWeight: 600,
        color: C.textDim, letterSpacing: '.08em',
      }}>
        {Math.round(winPct)}%
      </div>
    </div>
  );
}

function QuarterDots({ quarter, isOT }: { quarter: number; isOT: boolean }) {
  const dots = isOT ? 5 : 4;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      {Array.from({ length: dots }, (_, i) => {
        const isActive = i + 1 === quarter;
        const isPast = i + 1 < quarter;
        return (
          <div
            key={i}
            style={{
              width: isActive ? 14 : 8,
              height: 4,
              borderRadius: 2,
              background: isActive ? C.amber : isPast ? C.cyanDim : C.textMuted,
              transition: 'all 0.3s',
            }}
          />
        );
      })}
    </div>
  );
}
