'use client';

/**
 * Top scoreboard HUD (teams, score, clock, possession, timeout pips, win-prob sparkline).
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  HudTeam,
  ScoreByQuarter,
  GameTiming,
  WpTimelinePoint,
} from '@atlas/sdk/gridstream/types';
import {
  computeWpSparklinePoints,
  sparklineToPath,
  sparklineToArea,
  getQuarterTicks,
} from '@atlas/sdk/gridstream/transforms';
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
  awayTimeouts: number;
  homeTimeouts: number;
  isFinal: boolean;
}

export function ScoreBug({
  away,
  home,
  awayScore,
  homeScore,
  timing,
  possession,
  awayWinPct,
  wpTimeline,
  awayTimeouts,
  homeTimeouts,
  isFinal,
}: ScoreBugProps) {
  const possIsAway = possession === 'away';
  const awaySparkColor = getReadableSparkColor(away);
  const homeSparkColor = getReadableSparkColor(home);
  const hasWpSamples = wpTimeline.length > 0;
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // Keep sparkline UI stable if a frame is missing WP samples.
  const sparkTimeline: WpTimelinePoint[] = hasWpSamples
    ? wpTimeline
    : [
        { wp: 50, gameMin: 0 },
        { wp: 50, gameMin: Math.max(1, timing.elapsedMin) },
      ];
  const awayPctDisplay = Math.max(0, Math.min(100, Math.round(awayWinPct)));
  const homePctDisplay = Math.max(0, Math.min(100, Math.round(100 - awayWinPct)));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        position: 'relative',
        zIndex: 3,
        overflow: 'hidden',
      }}
    >
      {/* AWAY SIDE */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: isMobile ? '8px 8px' : '12px 20px',
          borderRadius: '2px 0 0 2px',
          position: 'relative',
          background: possIsAway ? 'rgba(255,182,18,0.03)' : 'transparent',
          transition: 'background 0.5s',
        }}
      >
        {possIsAway && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 8,
              bottom: 8,
              width: 3,
              background: C.amber,
              borderRadius: 2,
              boxShadow: `0 0 8px ${C.amberGlow}`,
              animation: 'possGlow 2s ease-in-out infinite',
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 16, minWidth: 0 }}>
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div
              style={{
                fontFamily: F.body,
                fontWeight: 700,
                fontSize: isMobile ? 14 : 26,
                color: C.textBright,
                letterSpacing: '.04em',
                lineHeight: 1,
                whiteSpace: isMobile ? 'nowrap' : undefined,
                overflow: isMobile ? 'hidden' : undefined,
                textOverflow: isMobile ? 'ellipsis' : undefined,
              }}
            >
              {isMobile ? away.abbr.toUpperCase() : away.name.toUpperCase()}
            </div>
            {!isMobile && (
              <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textDim, marginTop: 3 }}>
                {away.displayName} · {away.record}
              </div>
            )}
          </div>
          <TeamBadge
            team={away}
            hasPossession={possIsAway}
            size={isMobile ? 34 : 52}
            variant="scoreboard-dark"
          />
        </div>
        {!isMobile && (
          <div style={{ marginTop: 8, width: '100%', maxWidth: 180, alignSelf: 'flex-end' }}>
            <MiniSparkline
              timeline={sparkTimeline}
              timing={timing}
              isAway={true}
              color={awaySparkColor}
              currentPct={awayPctDisplay}
            />
          </div>
        )}
      </div>

      {/* CENTER SCORE */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(0,0,0,.5)',
          border: `1px solid ${C.panelBorder}`,
          position: 'relative',
          zIndex: 2,
          flexShrink: 0,
        }}
      >
        <CornerTicks />
        <ScoreDigit
          value={awayScore.total}
          isWinning={awayScore.total > homeScore.total}
          fontSize={isMobile ? 40 : 54}
          width={isMobile ? 56 : 88}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: isMobile ? '4px 8px' : '6px 18px',
            gap: 3,
            minWidth: isMobile ? 60 : 90,
            borderLeft: `1px solid ${C.panelBorder}`,
            borderRight: `1px solid ${C.panelBorder}`,
            background: 'rgba(0,229,255,.02)',
          }}
        >
          <span
            style={{
              fontFamily: F.display,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '.2em',
              color: isFinal ? C.textDim : C.red,
              animation: isFinal ? 'none' : 'pulse 2s ease-in-out infinite',
            }}
          >
            {isFinal ? 'FINAL' : timing.quarter === 0 ? 'PRE' : `Q${timing.quarter}`}
          </span>
          <div
            style={{
              position: 'relative',
              width: isMobile ? 72 : 108,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {!isFinal && possession === 'away' && (
              <span
                style={{
                  position: 'absolute',
                  left: 2,
                  top: 10,
                  fontFamily: F.display,
                  fontSize: 13,
                  fontWeight: 800,
                  color: C.amber,
                  letterSpacing: '.08em',
                }}
              >
                ◀
              </span>
            )}
            <span
              style={{
                fontFamily: F.body,
                fontSize: isMobile ? 22 : 30,
                fontWeight: 700,
                color: C.textBright,
                letterSpacing: '.06em',
                lineHeight: 1,
              }}
            >
              {isFinal ? '' : timing.clock}
            </span>
            {!isFinal && possession === 'home' && (
              <span
                style={{
                  position: 'absolute',
                  right: 2,
                  top: 10,
                  fontFamily: F.display,
                  fontSize: 13,
                  fontWeight: 800,
                  color: C.amber,
                  letterSpacing: '.08em',
                }}
              >
                ▶
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 6 : 10, marginTop: 1 }}>
            <TimeoutPips count={awayTimeouts} size={isMobile ? 5 : 8} height={isMobile ? 3 : 4} />
            <div style={{ width: 1, height: isMobile ? 3 : 5, background: C.panelBorder }} />
            <TimeoutPips count={homeTimeouts} size={isMobile ? 5 : 8} height={isMobile ? 3 : 4} />
          </div>
        </div>
        <ScoreDigit
          value={homeScore.total}
          isWinning={homeScore.total > awayScore.total}
          fontSize={isMobile ? 40 : 54}
          width={isMobile ? 56 : 88}
        />
      </div>

      {/* HOME SIDE */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: isMobile ? '8px 8px' : '12px 20px',
          borderRadius: '0 2px 2px 0',
          position: 'relative',
          background: possession === 'home' ? 'rgba(255,182,18,0.03)' : 'transparent',
          transition: 'background 0.5s',
        }}
      >
        {possession === 'home' && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 8,
              bottom: 8,
              width: 3,
              background: C.amber,
              borderRadius: 2,
              boxShadow: `0 0 8px ${C.amberGlow}`,
              animation: 'possGlow 2s ease-in-out infinite',
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 16, minWidth: 0 }}>
          <TeamBadge
            team={home}
            hasPossession={possession === 'home'}
            size={isMobile ? 34 : 52}
            variant="scoreboard-dark"
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: F.body,
                fontWeight: 700,
                fontSize: isMobile ? 14 : 26,
                color: C.textBright,
                letterSpacing: '.04em',
                lineHeight: 1,
                whiteSpace: isMobile ? 'nowrap' : undefined,
                overflow: isMobile ? 'hidden' : undefined,
                textOverflow: isMobile ? 'ellipsis' : undefined,
              }}
            >
              {isMobile ? home.abbr.toUpperCase() : home.name.toUpperCase()}
            </div>
            {!isMobile && (
              <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textDim, marginTop: 3 }}>
                {home.displayName} · {home.record}
              </div>
            )}
          </div>
        </div>
        {!isMobile && (
          <div style={{ marginTop: 8, width: '100%', maxWidth: 180 }}>
            <MiniSparkline
              timeline={sparkTimeline}
              timing={timing}
              isAway={false}
              color={homeSparkColor}
              currentPct={homePctDisplay}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Atoms — exact v11 ports ──

function TeamBadge({
  team,
  hasPossession,
  size = 56,
  variant = 'abbr',
}: {
  team: HudTeam;
  hasPossession: boolean;
  size?: number;
  variant?: 'abbr' | 'scoreboard-dark';
}) {
  const logoSrc = useMemo(() => {
    if (variant !== 'scoreboard-dark') return '';
    return toScoreboardDarkLogoUrl(team);
  }, [team, variant]);
  const possessionGlowColor = useMemo(() => getReadableTeamGlowColor(team), [team]);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [logoSrc]);

  const showLogo = variant === 'scoreboard-dark' && Boolean(logoSrc) && !logoLoadFailed;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, #${team.color}60, #${team.color}20, transparent)`,
        border: hasPossession ? `2px solid ${possessionGlowColor}cc` : `1px solid #${team.color}50`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: hasPossession
          ? `0 0 18px ${possessionGlowColor}80, 0 0 6px ${possessionGlowColor}66`
          : `0 0 8px #${team.color}20`,
        transition: 'all .5s ease',
        flexShrink: 0,
      }}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt={`${team.displayName} logo`}
          loading="lazy"
          decoding="async"
          onError={() => setLogoLoadFailed(true)}
          style={{
            width: Math.round(size * 1.1),
            height: Math.round(size * 1.1),
            objectFit: 'contain',
            filter: hasPossession ? `drop-shadow(0 0 8px ${possessionGlowColor}b3)` : 'none',
          }}
        />
      ) : (
        <span
          style={{
            fontFamily: F.body,
            fontWeight: 700,
            fontSize: size * 0.34,
            color: `#${team.altColor}` || '#fff',
            letterSpacing: '.06em',
            textShadow: `0 0 6px #${team.color}`,
          }}
        >
          {team.abbr}
        </span>
      )}
    </div>
  );
}

function toScoreboardDarkLogoUrl(team: HudTeam): string {
  const espnLogoKey = team.abbr.toUpperCase() === 'WAS' ? 'wsh' : team.abbr.toLowerCase();
  const fallback = `https://a.espncdn.com/i/teamlogos/nfl/500-dark/scoreboard/${espnLogoKey}.png`;
  const applyAlias = (value: string) =>
    team.abbr.toUpperCase() === 'WAS' ? value.replace(/\/was\.png(?=$|\?)/i, '/wsh.png') : value;
  const source = team.logoUrl?.trim();
  if (!source) return fallback;
  if (source.includes('/500-dark/scoreboard/')) return applyAlias(source);
  if (source.includes('/500/scoreboard/')) {
    return applyAlias(source.replace('/500/scoreboard/', '/500-dark/scoreboard/'));
  }
  if (source.includes('/500-dark/')) {
    return applyAlias(source.replace('/500-dark/', '/500-dark/scoreboard/'));
  }
  if (source.includes('/500/')) {
    return applyAlias(source.replace('/500/', '/500-dark/scoreboard/'));
  }
  return fallback;
}

function ScoreDigit({
  value,
  isWinning,
  fontSize = 54,
  width = 88,
}: {
  value: number;
  isWinning: boolean;
  fontSize?: number;
  width?: number;
}) {
  return (
    <div
      style={{
        fontFamily: F.body,
        fontWeight: 700,
        fontSize,
        color: isWinning ? C.textBright : C.textDim,
        width,
        textAlign: 'center',
        padding: '4px 0',
        letterSpacing: '-.02em',
        lineHeight: 1,
        textShadow: isWinning ? `0 0 14px ${C.cyanGlow}` : 'none',
        flexShrink: 0,
      }}
    >
      {value}
    </div>
  );
}

function TimeoutPips({
  count,
  size = 8,
  height = 4,
}: {
  count: number;
  size?: number;
  height?: number;
}) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.min(3, Math.round(count))) : 3;
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: size,
            height,
            borderRadius: 1,
            background: i <= safeCount ? C.amber : 'rgba(255,255,255,.06)',
            boxShadow: i <= safeCount ? `0 0 4px ${C.amber}50` : 'none',
          }}
        />
      ))}
    </div>
  );
}

function CornerTicks() {
  return (
    <>
      {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((p) => {
        const s: CSSProperties = { position: 'absolute', width: 8, height: 8, zIndex: 5 };
        if (p === 'top-left')
          Object.assign(s, {
            top: 3,
            left: 3,
            borderTop: `1px solid ${C.cyanDim}`,
            borderLeft: `1px solid ${C.cyanDim}`,
          });
        if (p === 'top-right')
          Object.assign(s, {
            top: 3,
            right: 3,
            borderTop: `1px solid ${C.cyanDim}`,
            borderRight: `1px solid ${C.cyanDim}`,
          });
        if (p === 'bottom-left')
          Object.assign(s, {
            bottom: 3,
            left: 3,
            borderBottom: `1px solid ${C.cyanDim}`,
            borderLeft: `1px solid ${C.cyanDim}`,
          });
        if (p === 'bottom-right')
          Object.assign(s, {
            bottom: 3,
            right: 3,
            borderBottom: `1px solid ${C.cyanDim}`,
            borderRight: `1px solid ${C.cyanDim}`,
          });
        return <div key={p} style={s} />;
      })}
    </>
  );
}

// ── Mini sparkline (in score bug) — exact v11 WinProbSparkline ──

function MiniSparkline({
  timeline,
  timing,
  isAway,
  color,
  currentPct,
}: {
  timeline: WpTimelinePoint[];
  timing: GameTiming;
  isAway: boolean;
  color: string;
  currentPct: number;
}) {
  const W = 160,
    H = 46,
    pad = 2;
  const usableW = W - pad * 2;
  const qTicks = getQuarterTicks(timing.isOT);
  const pts = computeWpSparklinePoints(timeline, timing, isAway, W, H, pad);
  if (pts.length === 0) return null;
  const bandLowTimeline = timeline.map((point) => ({
    wp: typeof point.wpLow === 'number' ? point.wpLow : point.wp,
    gameMin: point.gameMin,
  }));
  const bandHighTimeline = timeline.map((point) => ({
    wp: typeof point.wpHigh === 'number' ? point.wpHigh : point.wp,
    gameMin: point.gameMin,
  }));
  const lowPts = computeWpSparklinePoints(bandLowTimeline, timing, isAway, W, H, pad);
  const highPts = computeWpSparklinePoints(bandHighTimeline, timing, isAway, W, H, pad);
  const hasBand = timeline.some(
    (point) =>
      typeof point.wpLow === 'number' &&
      typeof point.wpHigh === 'number' &&
      point.wpHigh > point.wpLow
  );
  const bandAreaD = hasBand ? sparklineConfidenceArea(lowPts, highPts) : '';
  const pathD = sparklineToPath(pts);
  const areaD = sparklineToArea(pts, H);
  const lastPt = pts[pts.length - 1]!;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexDirection: isAway ? 'row' : 'row-reverse',
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, display: 'block' }}>
        <rect x={pad} y={pad} width={usableW} height={H - pad * 2} fill="rgba(0,229,255,.03)" />
        <line
          x1={pad}
          y1={H / 2}
          x2={W - pad}
          y2={H / 2}
          stroke={C.cyanDim}
          strokeWidth=".6"
          opacity=".22"
          strokeDasharray="2 2"
        />
        {qTicks.map((pct, i) => (
          <line
            key={i}
            x1={pad + pct * usableW}
            y1={H - 1}
            x2={pad + pct * usableW}
            y2={H - 4}
            stroke={C.textMuted}
            strokeWidth=".5"
          />
        ))}
        <rect x={lastPt.x} y={0} width={W - lastPt.x} height={H} fill="rgba(255,255,255,.015)" />
        {hasBand && bandAreaD && <path d={bandAreaD} fill={color} opacity=".11" />}
        <path d={areaD} fill={color} opacity=".14" />
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          opacity=".92"
          pathLength={500}
          strokeDasharray={500}
          strokeDashoffset={0}
          style={{ animation: 'sparkDraw 1.2s ease-out' }}
        />
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="3.2"
          fill={color}
          stroke={C.textBright}
          strokeWidth="0.7"
          opacity=".98"
        >
          <animate attributeName="r" values="2.8;3.8;2.8" dur="3s" repeatCount="indefinite" />
        </circle>
      </svg>
      <span
        style={{
          fontFamily: F.display,
          fontSize: 13,
          fontWeight: 800,
          color: currentPct >= 50 ? color : C.text,
          minWidth: 36,
          textShadow: currentPct > 60 ? `0 0 6px ${color}40` : 'none',
        }}
      >
        {currentPct}%
      </span>
    </div>
  );
}

function sparklineConfidenceArea(
  lowPts: Array<{ x: number; y: number }>,
  highPts: Array<{ x: number; y: number }>
): string {
  if (lowPts.length === 0 || highPts.length === 0 || lowPts.length !== highPts.length) return '';
  const upper = lowPts.map((low, index) => {
    const high = highPts[index] ?? low;
    return low.y <= high.y ? low : high;
  });
  const lower = lowPts.map((low, index) => {
    const high = highPts[index] ?? low;
    return low.y > high.y ? low : high;
  });
  if (upper.length === 0) return '';
  const top = upper.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L ');
  const bottom = [...lower]
    .reverse()
    .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(' L ');
  return `M ${top} L ${bottom} Z`;
}

function getReadableSparkColor(team: HudTeam): string {
  const candidates = [`#${team.color}`, `#${team.altColor}`, C.cyan, C.amber];
  for (const color of candidates) {
    if (relativeLuminance(color) >= 0.16) return color;
  }
  return C.cyan;
}

function getReadableTeamGlowColor(team: HudTeam): string {
  const teamColors = [`#${team.color}`, `#${team.altColor}`].filter((color) => color.length === 7);
  if (teamColors.length === 0) return C.cyan;
  const sorted = [...teamColors].sort((a, b) => relativeLuminance(b) - relativeLuminance(a));
  for (const color of sorted) {
    if (relativeLuminance(color) >= 0.16) return color;
  }
  return sorted[0]!;
}

function relativeLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '').trim();
  if (hex.length !== 6) return 0;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// Re-export TeamBadge for use in other components (ScoreboardTable, LeadersPanel, etc.)
export { TeamBadge };
