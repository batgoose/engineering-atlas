'use client';

/**
 * Gridstream page compositor.
 *
 * Responsibilities:
 * - assembles HUD + field + tabs from a fully-derived `LiveGameState`
 * - keeps playback controls stateless (actions passed in from route layer)
 * - preserves a stable layout during replay/timeouts
 *
 * Documentation hooks:
 * - runtime architecture: docs/gridstream-live-runtime.md
 */

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { LiveGameState, PlayActorInfo, FantasyRosterEntry } from '@atlas/sdk/gridstream/types';
import {
  gridstreamColors as C,
  gridstreamFonts as F,
  GRIDSTREAM_FONTS_URL,
} from '@atlas/sdk/gridstream/theme';
import { resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';
import { abbreviatedNameKey, normalizeNameKey } from '@atlas/sdk/gridstream/play-transforms';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);
import { getGridstreamStylesheet } from '@atlas/sdk/gridstream/animations';
import { ScoreBug } from './ScoreBug';
import { SituationBar } from './SituationBar';
import { DriveTracker } from './DriveTracker';
import { EnvironmentPanel } from './EnvironmentPanel';
import { FieldVisualization } from './FieldVisualization';
import { ScoreboardTable } from './ScoreboardTable';
import { MissionLog } from './MissionLog';
import { TeamStatsPanel } from './TeamStatsPanel';
import { EpaFlowChart } from './EpaFlowChart';
import { PersonnelPanel } from './PersonnelPanel';
import { ScoringPanel } from './ScoringPanel';
import { FantasyPanel } from './FantasyPanel';
import { WeatherLayer } from './WeatherLayer';
import { StarField } from './StarField';

type TabKey = 'plays' | 'stats' | 'leaders' | 'scoring' | 'fantasy';
type QuarterJump = { key: 'q1' | 'q2' | 'q3' | 'q4' | 'ot'; label: string; index: number | null };

interface LiveGameViewProps {
  state: LiveGameState;
  onReplay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEnd: () => void;
  onJumpToPlayIndex: (index: number) => void;
  quarterJumps: QuarterJump[];
  isReplaying: boolean;
  wsConnected: boolean;
  feedConnected: boolean;
  season?: number;
  week?: number;
  isGameFinal?: boolean;
  currentPlaySequence?: number | null;
  statsGameId?: string;
}

function parseTimeoutTeam(text: string, awayAbbr: string, homeAbbr: string): string | null {
  const byMatch = text.match(/timeout\s*#\s*\d+\s+by\s+([A-Z]{2,3})/i);
  const prefixMatch = text.match(/^([A-Z]{2,3})\s+timeout/i);
  const byOnlyMatch = text.match(/timeout\s+by\s+([A-Z]{2,3})/i);
  const team = (byMatch?.[1] ?? prefixMatch?.[1] ?? byOnlyMatch?.[1] ?? '').toUpperCase();
  if (team === awayAbbr || team === homeAbbr) return team;
  return null;
}

function buildTimeoutNotice(
  text: string | undefined,
  awayAbbr: string,
  homeAbbr: string
): string | null {
  if (!text) return null;
  const quarterNumberFromText = (() => {
    const numericTrailing = text.match(/\bend\s+quarter\s*([1-4])\b/i)?.[1];
    if (numericTrailing) return Number.parseInt(numericTrailing, 10);
    const ordinalMatch = text.match(/\bend\s+of\s+([1-4])(?:st|nd|rd|th)\s+quarter\b/i)?.[1];
    if (ordinalMatch) return Number.parseInt(ordinalMatch, 10);
    if (/\bend\s+of\s+first\s+quarter\b/i.test(text)) return 1;
    if (/\bend\s+of\s+second\s+quarter\b/i.test(text)) return 2;
    if (/\bend\s+of\s+third\s+quarter\b/i.test(text)) return 3;
    if (/\bend\s+of\s+fourth\s+quarter\b/i.test(text)) return 4;
    return null;
  })();
  if (quarterNumberFromText != null && quarterNumberFromText >= 1 && quarterNumberFromText <= 4) {
    const suffix =
      quarterNumberFromText === 1
        ? 'ST'
        : quarterNumberFromText === 2
          ? 'ND'
          : quarterNumberFromText === 3
            ? 'RD'
            : 'TH';
    return `End of ${quarterNumberFromText}${suffix} Quarter`;
  }
  if (/(?:two|2)\s*-\s*minute\s+warning|(?:two|2)\s+minute\s+warning/i.test(text)) {
    return 'Two-Minute Warning';
  }
  if (!/timeout/i.test(text)) return null;
  if (/official timeout/i.test(text)) return 'Official Timeout';
  const team = parseTimeoutTeam(text, awayAbbr, homeAbbr);
  return team ? `${team} Timeout` : 'Timeout';
}

function parseFieldGoalDistanceFromText(description: string | undefined): number | null {
  if (!description) return null;
  const match = description.match(/\b(\d+)\s*-\s*yard\b|\b(\d+)\s+yard\b/i);
  const yards = Number.parseInt(match?.[1] ?? match?.[2] ?? '', 10);
  return Number.isNaN(yards) ? null : yards;
}

function formatPlaySpot(side: string | undefined, yardline: number | undefined): string | null {
  if (!side || typeof yardline !== 'number' || !Number.isFinite(yardline) || yardline <= 0)
    return null;
  return `${side.toUpperCase()} ${Math.round(yardline)}`;
}

function normalizeTeamHex(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? '').trim().replace(/^#/, '');
  return /^[0-9a-f]{3,8}$/i.test(cleaned) ? `#${cleaned}` : fallback;
}

function normalizePercentLike(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return Math.max(-100, Math.min(100, normalized));
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

function compactNameKey(value: string): string {
  return normalizeNameKey(value);
}

function namesLikelyMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) return false;
  const leftCompact = compactNameKey(left);
  const rightCompact = compactNameKey(right);
  if (leftCompact && leftCompact === rightCompact) return true;
  const leftShort = abbreviatedNameKey(left);
  const rightShort = abbreviatedNameKey(right);
  return Boolean(leftShort && rightShort && leftShort === rightShort);
}

function isDarkColorHex(hex: string): boolean {
  const cleaned = hex.replace(/^#/, '');
  const normalized =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((ch) => `${ch}${ch}`)
          .join('')
      : cleaned.slice(0, 6);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return false;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 132;
}

function chooseBadgeAccentColor(primary: string, secondary: string): string {
  if (!isDarkColorHex(primary)) return primary;
  return secondary || primary;
}

function buildSituationOverrideText(state: LiveGameState): string | null {
  const play = state.lastPlay;
  if (!play) return null;

  if (play.type === 'kick') {
    const isPunt = /\bpunts?\b/i.test(play.description);
    const spot = formatPlaySpot(play.fromSide, play.fromYardline);
    if (!spot) return null;
    return `${isPunt ? 'PUNT' : 'KICKOFF'} AT ${spot}`;
  }

  if (play.postScoreTryKind === 'extra_point' && play.postScoreTryPlayType === 'kick') {
    const spot = formatPlaySpot(
      play.postScoreTryFromSide ?? play.fromSide,
      play.postScoreTryFromYardline ?? play.fromYardline
    );
    return spot ? `XP ATTEMPT AT ${spot}` : 'XP ATTEMPT';
  }

  if (play.type === 'fieldgoal') {
    const distance =
      typeof play.fgDistance === 'number' && Number.isFinite(play.fgDistance) && play.fgDistance > 0
        ? Math.round(play.fgDistance)
        : parseFieldGoalDistanceFromText(play.description);
    return distance != null ? `FIELD GOAL ATTEMPT FROM ${distance} YARDS` : 'FIELD GOAL ATTEMPT';
  }

  return null;
}

function isTurnoverOnDownsPlay(play: LiveGameState['lastPlay']): boolean {
  if (!play) return false;
  if (play.type !== 'pass' && play.type !== 'rush') return false;
  if ((play.startDown ?? 0) !== 4) return false;
  if (play.isFirstDown || play.isTurnover || play.isTouchdown || play.isNoPlay) return false;
  if (/\b(two-point conversion|extra point)\b/i.test(play.description)) return false;
  return true;
}

function resolveTouchdownTeamAbbr(
  play: LiveGameState['lastPlay'],
  awayAbbr: string,
  homeAbbr: string
): string | null {
  if (!play?.isTouchdown || play.isNoPlay) return null;
  const away = awayAbbr.toUpperCase();
  const home = homeAbbr.toUpperCase();

  const offense = (play.offenseTeam ?? '').toUpperCase();
  const defense = offense === away ? home : offense === home ? away : '';

  if (play.isTurnover && play.turnoverBy) {
    const turnoverBy = play.turnoverBy.toUpperCase();
    if (turnoverBy === away || turnoverBy === home) return turnoverBy;
  }

  const prefixTeam = play.description
    .trim()
    .match(/^\(?([A-Z]{2,3})\)?(?:\s|\()/)?.[1]
    ?.toUpperCase();
  if (prefixTeam === away || prefixTeam === home) {
    if (play.isTurnover && defense) return defense;
    return prefixTeam;
  }

  if (play.isTurnover && defense) return defense;
  if (offense === away || offense === home) return offense;
  return null;
}

function buildTouchdownEventLabel(
  play: LiveGameState['lastPlay'],
  away: LiveGameState['away'],
  home: LiveGameState['home']
): {
  text: string;
  color: string;
  glow: string;
  delay: number;
} | null {
  if (!play?.isTouchdown || play.isNoPlay) return null;
  const teamAbbr = resolveTouchdownTeamAbbr(play, away.abbr, home.abbr);
  if (!teamAbbr) return { text: 'TOUCHDOWN', color: C.green, glow: `${C.green}80`, delay: 1.0 };

  const cityLabelFor = (team: LiveGameState['away'] | LiveGameState['home']): string => {
    const display = team.displayName?.trim() ?? '';
    const nickname = team.name?.trim() ?? '';
    if (!display) return team.abbr;
    if (
      nickname &&
      display.length > nickname.length &&
      display.toLowerCase().endsWith(nickname.toLowerCase())
    ) {
      const city = display.slice(0, display.length - nickname.length).trim();
      if (city) return city;
    }
    const parts = display.split(/\s+/).filter(Boolean);
    if (parts.length > 1) return parts.slice(0, -1).join(' ');
    return display;
  };

  const teamLabel =
    teamAbbr === away.abbr.toUpperCase()
      ? cityLabelFor(away)
      : teamAbbr === home.abbr.toUpperCase()
        ? cityLabelFor(home)
        : teamAbbr;
  return {
    text: `TOUCHDOWN ${teamLabel.toUpperCase()}`,
    color: C.green,
    glow: `${C.green}80`,
    delay: 1.0,
  };
}

function buildFumbleEventLabel(play: LiveGameState['lastPlay']): {
  text: string;
  color: string;
  glow: string;
  delay: number;
  tight?: boolean;
} | null {
  if (!play) return null;
  if (!/\bfumble(?:s|d)?\b/i.test(play.description)) return null;
  const recoveryTeam =
    play.description.match(/\brecovered by\s+([A-Z]{2,3})[-\s]/i)?.[1]?.toUpperCase() ??
    play.description
      .match(/\band recovers?\s+at\s+([A-Z]{2,3})\s+\d{1,2}\b/i)?.[1]
      ?.toUpperCase() ??
    '';
  const offenseTeam =
    (play.offenseTeam ?? '').toUpperCase() ||
    play.description
      .match(/^\(?\d*:?[\d.]*\)?\s*\(?shotgun\)?\s*(?:\d+-)?([A-Z]{2,3})\b/i)?.[1]
      ?.toUpperCase() ||
    '';
  const recoverySpotMatch = play.description.match(
    /\brecovered by\s+.+?\s+at\s+([A-Z]{2,3})\s+(\d{1,2})\b/i
  );
  const fallbackSpot =
    play.toSide && typeof play.toYardline === 'number' && Number.isFinite(play.toYardline)
      ? `${play.toSide.toUpperCase()} ${Math.round(play.toYardline)}`
      : '';
  const recoverySpot =
    recoverySpotMatch?.[1] && recoverySpotMatch[2]
      ? `${recoverySpotMatch[1].toUpperCase()} ${recoverySpotMatch[2]}`
      : fallbackSpot;
  const recoveredByOffense =
    /\band recovers?\s+at\b/i.test(play.description) ||
    Boolean(recoveryTeam && offenseTeam && recoveryTeam === offenseTeam);
  const lost =
    play.isTurnover || Boolean(recoveryTeam && offenseTeam && recoveryTeam !== offenseTeam);
  const recovered = !lost && (recoveredByOffense || /\brecovered by\b/i.test(play.description));
  if (!lost && !recovered) return null;

  const possLabel = offenseTeam || 'OFF';
  const recoverLabel = lost ? recoveryTeam || 'DEF' : offenseTeam || recoveryTeam || 'OFF';
  const spotLabel = recoverySpot ? ` AT ${recoverySpot}` : '';
  const text = `${possLabel} FUMBLE. ${recoverLabel} RECOVERS${spotLabel}.`;
  return {
    text,
    color: lost ? C.red : C.amber,
    glow: lost ? `${C.red}80` : `${C.amber}80`,
    delay: 1.0,
    tight: true,
  };
}

export function LiveGameView({
  state,
  onReplay,
  onPrev,
  onNext,
  onEnd,
  onJumpToPlayIndex,
  quarterJumps,
  isReplaying,
  wsConnected,
  feedConnected,
  season,
  week,
  isGameFinal = false,
  currentPlaySequence = null,
  statsGameId,
}: LiveGameViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('plays');
  const [elapsed, setElapsed] = useState(0);
  const [statsPanelActor, setStatsPanelActor] = useState<PlayActorInfo | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  // Pause all CSS animations when the page/tab is not visible (reduces GPU load).
  useEffect(() => {
    const toggle = () => rootRef.current?.classList.toggle('gs-animations-paused', document.hidden);
    toggle();
    document.addEventListener('visibilitychange', toggle);
    return () => document.removeEventListener('visibilitychange', toggle);
  }, []);

  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const [tabHasMore, setTabHasMore] = useState(false);
  const checkTabOverflow = useCallback(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    setTabHasMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);
  useEffect(() => {
    checkTabOverflow();
    window.addEventListener('resize', checkTabOverflow);
    return () => window.removeEventListener('resize', checkTabOverflow);
  }, [checkTabOverflow]);

  // Dismiss stats panel when the play changes.
  useEffect(() => {
    setStatsPanelActor(null);
  }, [state.animationKey]);
  const isFinal = state.status === 'final' || state.status === 'final_ot';
  const currentMissionEntry = state.plays[state.plays.length - 1];
  const timeoutNotice = buildTimeoutNotice(
    currentMissionEntry?.text,
    state.away.abbr,
    state.home.abbr
  );
  const situationOverrideText = buildSituationOverrideText(state);

  // General-purpose play event label strip shown below the SituationBar.
  // Add new event types here as the feature grows (touchdowns, turnovers, etc.).
  const playEventLabel: {
    text: string;
    color: string;
    glow: string;
    delay: number;
    tight?: boolean;
  } | null = (() => {
    if (state.lastPlay?.isSafety)
      return { text: 'SAFETY', color: C.red, glow: `${C.red}80`, delay: 1.0 };
    const touchdownEvent = buildTouchdownEventLabel(state.lastPlay, state.away, state.home);
    if (touchdownEvent) return touchdownEvent;
    const fumbleEvent = buildFumbleEventLabel(state.lastPlay);
    if (fumbleEvent) return fumbleEvent;
    if (isTurnoverOnDownsPlay(state.lastPlay))
      return { text: 'TURNOVER ON DOWNS', color: C.red, glow: `${C.red}80`, delay: 1.0 };
    return null;
  })();

  // Penalty strip — shown below the play event label, overlaps the top of the field.
  const penaltyStrip: {
    team: string;
    type: string;
    yards: number;
    player?: string;
  } | null = (() => {
    const play = state.lastPlay;
    if (!play) return null;
    const hasPenalty = Boolean((play.penaltyYards ?? 0) > 0 || play.penaltyType);
    if (!hasPenalty) return null;
    return {
      team: play.penaltyTeam ?? '',
      type: play.penaltyType ?? 'Penalty',
      yards: Math.max(0, play.penaltyYards ?? 0),
      player: play.penaltyPlayer?.trim() || undefined,
    };
  })();

  useEffect(() => {
    if (!document.querySelector('link[href*="Orbitron"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = GRIDSTREAM_FONTS_URL;
      document.head.appendChild(link);
    }
    const styleId = 'gridstream-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = getGridstreamStylesheet();
      document.head.appendChild(style);
    }
  }, []);

  // Pause the uptime ticker when the page is hidden to avoid waking the GPU/CPU.
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      t = setInterval(() => setElapsed((e) => e + 1), 1000);
    };
    const stop = () => {
      clearInterval(t);
      t = undefined;
    };
    const onVis = () => {
      document.hidden ? stop() : start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  const uptime = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div
      ref={rootRef}
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.text,
        fontFamily: "'Share Tech Mono', monospace",
        overflowX: 'hidden',
      }}
    >
      {/* TOP NAV */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          height: 44,
          background: '#060a12',
          borderBottom: `1px solid ${C.panelBorder}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20 }}>
          <span
            style={{
              fontFamily: F.display,
              fontWeight: 800,
              fontSize: isMobile ? 13 : 15,
              color: C.cyan,
              letterSpacing: '.14em',
              textShadow: `0 0 10px ${C.cyanGlow}`,
            }}
          >
            GRIDSTREAM
          </span>
          {!isMobile && <div style={{ width: 1, height: 20, background: C.panelBorder }} />}
          <Link
            href="/gridstream/games"
            style={{
              fontFamily: F.display,
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '.12em',
              color: C.textDim,
              cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            ◂ GAMES
          </Link>
          {!isMobile && (
            <span
              style={{
                fontFamily: F.display,
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '.12em',
                color: C.textDim,
              }}
            >
              {week ? `WEEK ${week}` : ''} · {season || new Date().getFullYear()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20 }}>
          <StatusDot label="FEED" color={feedConnected ? C.green : C.red} />
          <StatusDot label="WS" color={wsConnected ? C.green : C.red} />
          {!isMobile && (
            <span style={{ fontSize: 10, color: C.textMuted, letterSpacing: '.08em' }}>
              SESSION {uptime}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: isMobile ? '10px 10px 60px' : '16px 24px 60px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* VIEWPORT */}
        <div
          className="hud-panel"
          style={{ padding: 0, background: 'transparent', isolation: 'isolate' }}
        >
          <StarField />
          <div className="scan-sweep" />

          {/* Score Bug */}
          <div
            style={{
              padding: isMobile ? '10px 10px 0' : '16px 32px 0',
              position: 'relative',
              zIndex: 3,
            }}
          >
            <ScoreBug
              away={state.away}
              home={state.home}
              awayScore={state.awayScore}
              homeScore={state.homeScore}
              timing={state.timing}
              possession={state.possession}
              awayWinPct={state.awayWinPct}
              wpTimeline={state.wpTimeline}
              awayTimeouts={state.awayTimeouts ?? 3}
              homeTimeouts={state.homeTimeouts ?? 3}
              isFinal={isFinal}
            />
          </div>

          {/* Situation Bar */}
          <SituationBar
            situation={state.situation}
            isFinal={isFinal}
            timeoutNotice={timeoutNotice}
            overrideText={situationOverrideText}
          />

          {/* Play Event Strip + Penalty Strip — stacked rows below the SituationBar.
              Rows overlap the top of the field when present. */}
          <div
            key={`${state.animationKey}-evt`}
            style={{
              position: 'relative',
              zIndex: 4,
              minHeight: 28,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0,
            }}
          >
            {/* Play event label (SAFETY, etc.) */}
            <div
              style={{
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {playEventLabel && (
                <span
                  style={{
                    fontFamily: F.display,
                    fontSize: playEventLabel.tight ? 11 : 13,
                    fontWeight: 800,
                    letterSpacing: playEventLabel.tight ? '.08em' : '.22em',
                    color: playEventLabel.color,
                    textShadow: `0 0 16px ${playEventLabel.glow}`,
                    opacity: 0,
                    animation: `fadeIn 0.22s ease ${playEventLabel.delay}s forwards`,
                  }}
                >
                  {playEventLabel.text}
                </span>
              )}
            </div>

            {/* Penalty strip — fades in after brief delay, overlaps field top */}
            {penaltyStrip && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '4px 14px',
                  background: 'rgba(14, 10, 2, 0.82)',
                  border: `1px solid ${C.amberBorder}`,
                  opacity: 0,
                  animation: 'fadeIn 0.2s ease 0.15s forwards',
                  maxWidth: '100%',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    fontFamily: F.display,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: '.18em',
                    color: C.amber,
                  }}
                >
                  FLAG
                </span>
                <span
                  style={{
                    width: 1,
                    height: 10,
                    background: C.amberBorder,
                    opacity: 0.6,
                    flexShrink: 0,
                  }}
                />
                {penaltyStrip.team && (
                  <>
                    <span
                      style={{
                        fontFamily: F.display,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '.1em',
                        color: C.amber,
                      }}
                    >
                      {penaltyStrip.team}
                    </span>
                    <span
                      style={{
                        width: 1,
                        height: 10,
                        background: C.amberBorder,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                    />
                  </>
                )}
                <span
                  style={{
                    fontFamily: F.display,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '.06em',
                    color: C.textBright,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {penaltyStrip.type}
                </span>
                {penaltyStrip.yards > 0 && (
                  <>
                    <span
                      style={{
                        width: 1,
                        height: 10,
                        background: C.amberBorder,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: F.display,
                        fontSize: 11,
                        letterSpacing: '.08em',
                        color: C.textDim,
                      }}
                    >
                      {penaltyStrip.yards} YDS
                    </span>
                  </>
                )}
                {penaltyStrip.player && (
                  <>
                    <span
                      style={{
                        width: 1,
                        height: 10,
                        background: C.amberBorder,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: F.mono,
                        fontSize: 10,
                        color: C.textDim,
                        letterSpacing: '.04em',
                      }}
                    >
                      {penaltyStrip.player}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* THE FIELD — marginTop extended by 28px (event strip height) to keep field position stable */}
          <div
            style={{ position: 'relative', padding: '0 8px 6px', marginTop: isMobile ? -20 : -60 }}
          >
            {/* Weather on field wrapper so it clips */}
            <WeatherOverlay weather={state.weather} venue={state.venue} />

            <FieldVisualization
              away={state.away}
              home={state.home}
              situation={state.situation}
              lastPlay={state.lastPlay}
              animationKey={state.animationKey}
              weather={state.weather}
              venue={state.venue}
              currentDrive={state.currentDrive}
              isFinal={isFinal}
              fieldNotice={timeoutNotice}
              showPlayStartSpot={isReplaying}
              onHeadshotClick={setStatsPanelActor}
            />

            {/* Player stats panel — appears when a headshot is clicked */}
            {statsPanelActor &&
              (() => {
                const fantasyAwayEntry =
                  state.fantasyAway.find((e) => namesLikelyMatch(e.name, statsPanelActor.name)) ??
                  null;
                const fantasyHomeEntry =
                  state.fantasyHome.find((e) => namesLikelyMatch(e.name, statsPanelActor.name)) ??
                  null;
                const fantasyEntry = fantasyAwayEntry ?? fantasyHomeEntry;
                const offenseAbbr = (state.lastPlay?.offenseTeam ?? '').toUpperCase();
                const inferredSide =
                  fantasyAwayEntry != null
                    ? 'away'
                    : fantasyHomeEntry != null
                      ? 'home'
                      : offenseAbbr === state.away.abbr.toUpperCase()
                        ? 'away'
                        : offenseAbbr === state.home.abbr.toUpperCase()
                          ? 'home'
                          : null;
                const accentColor =
                  inferredSide === 'away'
                    ? normalizeTeamHex(state.away.color, C.cyan)
                    : inferredSide === 'home'
                      ? normalizeTeamHex(state.home.color, C.cyan)
                      : C.cyan;
                const accentAltColor =
                  inferredSide === 'away'
                    ? normalizeTeamHex(state.away.altColor, accentColor)
                    : inferredSide === 'home'
                      ? normalizeTeamHex(state.home.altColor, accentColor)
                      : accentColor;
                return (
                  <PlayerStatsPanel
                    actor={statsPanelActor}
                    onClose={() => setStatsPanelActor(null)}
                    fantasyEntry={fantasyEntry}
                    accentColor={accentColor}
                    accentAltColor={accentAltColor}
                    gameId={statsGameId ?? state.gameId}
                    season={season}
                    week={week}
                  />
                );
              })()}
          </div>

          {/* Controls row: Drive (left) | Playback (center) | Environment (right) */}
          {isMobile ? (
            <PlaybackControls
              gameId={state.gameId}
              currentPlayIndex={state.playIndex}
              totalPlays={state.playHistoryLength}
              quarterJumps={quarterJumps}
              onPrev={onPrev}
              onReplay={onReplay}
              onNext={onNext}
              onEnd={onEnd}
              onJumpToPlayIndex={onJumpToPlayIndex}
              isFinalGame={isGameFinal}
              currentPlaySequence={currentPlaySequence}
            />
          ) : (
            <div
              style={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'start',
                padding: '0 20px',
              }}
            >
              <div style={{ paddingTop: 4, paddingLeft: 4 }}>
                {state.currentDrive && (
                  <div style={{ display: 'inline-block' }}>
                    <DriveTracker
                      drive={state.currentDrive}
                      possessionTeam={state.situation.possessionTeam}
                    />
                  </div>
                )}
              </div>
              <PlaybackControls
                gameId={state.gameId}
                currentPlayIndex={state.playIndex}
                totalPlays={state.playHistoryLength}
                quarterJumps={quarterJumps}
                onPrev={onPrev}
                onReplay={onReplay}
                onNext={onNext}
                onEnd={onEnd}
                onJumpToPlayIndex={onJumpToPlayIndex}
                isFinalGame={isGameFinal}
                currentPlaySequence={currentPlaySequence}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <EnvironmentPanel
                  weather={state.weather}
                  attendance={state.attendance}
                  referee={state.referee}
                  officials={state.officials}
                />
              </div>
            </div>
          )}

          {/* Score Table inside viewport */}
          <div
            style={{ position: 'relative', padding: isMobile ? '8px 8px 12px' : '10px 20px 16px' }}
          >
            <ScoreboardTable
              away={state.away}
              home={state.home}
              awayScore={state.awayScore}
              homeScore={state.homeScore}
              possession={state.possession}
              currentQuarter={state.timing.quarter}
              isFinal={isFinal}
            />
          </div>
        </div>

        {/* TABS */}
        <div>
          <div style={{ position: 'relative' }}>
            <div ref={tabScrollRef} onScroll={checkTabOverflow} style={{ overflowX: 'auto' }}>
              <div
                style={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: 'max-content' }}
              >
                <div
                  style={{
                    fontFamily: 'var(--gs-font-mono)',
                    fontSize: 8,
                    color: 'var(--gs-text-muted)',
                    letterSpacing: '0.12em',
                    padding: '0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    borderBottom: '1px solid var(--gs-panel-border)',
                    opacity: 0.6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  SYS /
                </div>
                {TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    className={`tab-btn ${activeTab === key ? 'active' : ''}`}
                    onClick={() => setActiveTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {tabHasMore && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 48,
                  background: 'linear-gradient(to right, transparent, rgba(4,16,29,0.95))',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
            )}
          </div>
          <div className="hud-panel" style={{ borderTopLeftRadius: 0, minHeight: 320 }}>
            {activeTab === 'plays' && <MissionLog plays={state.plays} />}
            {activeTab === 'stats' && state.teamStats && (
              <>
                {state.epaTimeline && state.epaTimeline.length > 0 && (
                  <EpaFlowChart
                    timeline={state.epaTimeline}
                    timing={state.timing}
                    away={state.away}
                    home={state.home}
                  />
                )}
                <TeamStatsPanel stats={state.teamStats} away={state.away} home={state.home} />
              </>
            )}
            {activeTab === 'stats' && !state.teamStats && (
              <Placeholder text="Team stats not available for this game." />
            )}
            {activeTab === 'leaders' && state.personnel && (
              <PersonnelPanel away={state.away} home={state.home} personnel={state.personnel} />
            )}
            {activeTab === 'leaders' && !state.personnel && (
              <Placeholder text="Personnel snap data is not available for this game yet." />
            )}
            {activeTab === 'scoring' && (
              <ScoringPanel scoring={state.scoring ?? []} away={state.away} home={state.home} />
            )}
            {activeTab === 'fantasy' &&
              (state.fantasyAway.length > 0 || state.fantasyHome.length > 0) && (
                <FantasyPanel
                  away={state.away}
                  home={state.home}
                  fantasyAway={state.fantasyAway}
                  fantasyHome={state.fantasyHome}
                  playerSeasonStats={state.playerSeasonStats}
                />
              )}
            {activeTab === 'fantasy' &&
              state.fantasyAway.length === 0 &&
              state.fantasyHome.length === 0 && (
                <Placeholder text="Fantasy boxscore data is not available for this game yet." />
              )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '16px 0',
            borderTop: `1px solid ${C.panelBorder}`,
          }}
        >
          <span className="hud-label" style={{ fontSize: 9 }}>
            GRIDSTREAM · ENGINEERING ATLAS
          </span>
          <span className="hud-label" style={{ fontSize: 9 }}>
            DATA: NFLVERSE + ESPN · WS: GRIDSTREAM HUB
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 8px ${color}80`,
          animation: 'pulse 2s ease-in-out infinite',
        }}
      />
      <span
        style={{
          fontFamily: F.display,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '.15em',
          color,
        }}
      >
        {label}
      </span>
    </span>
  );
}

function PlaybackControls({
  gameId,
  currentPlayIndex,
  totalPlays,
  quarterJumps,
  onPrev,
  onReplay,
  onNext,
  onEnd,
  onJumpToPlayIndex,
  isFinalGame,
  currentPlaySequence,
}: {
  gameId: string;
  currentPlayIndex: number;
  totalPlays: number;
  quarterJumps: QuarterJump[];
  onPrev: () => void;
  onReplay: () => void;
  onNext: () => void;
  onEnd: () => void;
  onJumpToPlayIndex: (index: number) => void;
  isFinalGame: boolean;
  currentPlaySequence: number | null;
}) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle');
  const atStart = totalPlays === 0 || currentPlayIndex === 0;
  const atEnd = totalPlays === 0 || currentPlayIndex === -1 || currentPlayIndex >= totalPlays - 1;
  let activeQuarterKey: QuarterJump['key'] | null = null;
  if (currentPlayIndex >= 0) {
    for (const jump of quarterJumps) {
      if (jump.index != null && currentPlayIndex >= jump.index) {
        activeQuarterKey = jump.key;
      }
    }
  }

  const navButtonStyle = (active = false, disabled = false): CSSProperties => ({
    fontFamily: F.display,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    minWidth: 74,
    height: 34,
    padding: '0 10px',
    background: active ? 'rgba(255,182,18,.16)' : 'rgba(255,182,18,.06)',
    border: `1px solid ${active ? C.amber : C.amberBorder}`,
    color: active ? C.amber : C.textBright,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  });

  const jumpButtonStyle = (active = false, disabled = false): CSSProperties => ({
    fontFamily: F.display,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    minWidth: 56,
    height: 24,
    padding: '0 10px',
    background: active ? 'rgba(0,229,255,.12)' : 'rgba(0,229,255,.04)',
    border: `1px solid ${active ? C.cyan : C.panelBorder}`,
    color: active ? C.cyan : C.textDim,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  });

  const shareButtonStyle = (active = false, disabled = false): CSSProperties => ({
    ...navButtonStyle(active, disabled),
    minWidth: 40,
    width: 40,
    padding: 0,
    fontSize: 18,
    letterSpacing: 0,
    textTransform: 'none',
    fontFamily: 'system-ui, sans-serif',
  });

  const shareButtonGlyph =
    shareState === 'copied' ? (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 13.5 9.2 17.5 19 7.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : shareState === 'error' ? (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2.2" />
        <path
          d="M12 8v5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="16.8" r="1.2" fill="currentColor" />
      </svg>
    ) : (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 16V4"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m7 9 5-5 5 5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );

  // Copies a permalink to the currently selected play sequence.
  const onShare = useCallback(async () => {
    if (currentPlaySequence == null || typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      // Preserve whatever game identifier the user is currently using in the URL
      // (internal id vs espn id), so shared links stay resolvable by this route.
      if (!url.searchParams.get('game')) {
        url.searchParams.set('game', gameId);
      }
      url.searchParams.set('play_seq', String(currentPlaySequence));
      url.searchParams.delete('play');
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
      } else {
        throw new Error('clipboard not available');
      }
      setShareState('copied');
    } catch {
      setShareState('error');
    }
  }, [currentPlaySequence, gameId]);

  useEffect(() => {
    if (shareState === 'idle') return;
    const timer = window.setTimeout(() => setShareState('idle'), 1500);
    return () => window.clearTimeout(timer);
  }, [shareState]);

  return (
    <div style={{ padding: '4px 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          style={navButtonStyle(false, atStart)}
          onClick={onPrev}
          disabled={atStart}
          title="Previous play"
        >
          ◀ PREV
        </button>
        <button
          type="button"
          style={navButtonStyle()}
          onClick={onReplay}
          title="Replay current play"
        >
          Replay
        </button>
        <button
          type="button"
          style={navButtonStyle(false, atEnd)}
          onClick={onNext}
          disabled={atEnd}
          title="Next play"
        >
          NEXT ▶
        </button>
        <button
          type="button"
          style={shareButtonStyle(shareState === 'copied', currentPlaySequence == null)}
          onClick={() => void onShare()}
          disabled={currentPlaySequence == null}
          title={currentPlaySequence == null ? 'No play to share yet' : 'Copy link to this play'}
          aria-label="Share play link"
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {shareButtonGlyph}
          </span>
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6 }}>
        {quarterJumps.map((jump) => (
          <button
            key={jump.key}
            type="button"
            style={jumpButtonStyle(activeQuarterKey === jump.key, jump.index == null)}
            disabled={jump.index == null}
            onClick={() => jump.index != null && onJumpToPlayIndex(jump.index)}
            title={jump.index == null ? `${jump.label} unavailable` : `Jump to ${jump.label}`}
          >
            {jump.label}
          </button>
        ))}
        <button
          type="button"
          style={jumpButtonStyle(currentPlayIndex === -1)}
          onClick={onEnd}
          title={isFinalGame ? 'Jump to end state' : 'Jump to live state'}
        >
          {isFinalGame ? (
            'End'
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              Live
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: C.red,
                  boxShadow: `0 0 6px ${C.red}90`,
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div style={{ padding: 20, color: C.textDim, fontFamily: F.mono, fontSize: 12 }}>{text}</div>
  );
}

type AdvancedPlayerData = {
  ecr: {
    position: string;
    rank: number;
    rank_sd: number | null;
    rank_best: number | null;
    rank_worst: number | null;
    position_rank: number | null;
  } | null;
  ngs_passing: Record<string, number> | null;
  ngs_rushing: Record<string, number> | null;
  ngs_receiving: Record<string, number> | null;
  game_stats?: {
    current: Record<string, number | null> | null;
    season_average: Record<string, number | null> | null;
    average_label: string | null;
    average_games: number;
  } | null;
} | null;

function PanelSectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        borderTop: `1px solid rgba(0,229,255,0.12)`,
        paddingTop: 10,
        marginBottom: 10,
      }}
    >
      <div style={{ width: 2, height: 10, background: C.cyan, opacity: 0.45, flexShrink: 0 }} />
      <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: '.16em', color: C.textDim }}>
        {label}
      </span>
    </div>
  );
}

function StatTile({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid rgba(0,229,255,0.1)`,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <span style={{ fontFamily: F.mono, fontSize: 8, color: C.textDim, letterSpacing: '.12em' }}>
          {label}
        </span>
        {tooltip && (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                border: `1px solid rgba(0,229,255,0.3)`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: F.mono,
                fontSize: 7,
                color: C.textDim,
                cursor: 'help',
                lineHeight: 1,
                userSelect: 'none',
              }}
            >
              ?
            </span>
            {showTip && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: 0,
                  width: 170,
                  padding: '7px 9px',
                  background: 'rgba(3,8,20,0.99)',
                  border: `1px solid rgba(0,229,255,0.25)`,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.8)',
                  zIndex: 999,
                  pointerEvents: 'none',
                  fontFamily: F.mono,
                  fontSize: 10,
                  color: C.text,
                  lineHeight: 1.5,
                  letterSpacing: '.03em',
                }}
              >
                {tooltip}
              </div>
            )}
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: F.display,
          fontWeight: 800,
          fontSize: 16,
          color: C.textBright,
          letterSpacing: '.04em',
        }}
      >
        {value}
      </span>
    </div>
  );
}

type PopupGameStatRow = {
  key: string;
  label: string;
  game: string;
  average: string;
};

function toFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatGameStatValue(value: number | null, decimals = 0): string {
  if (value == null) return '\u2014';
  if (decimals > 0) return value.toFixed(decimals);
  return `${Math.round(value)}`;
}

function formatAverageStatValue(value: number | null, decimals = 1): string {
  return value == null ? '\u2014' : value.toFixed(decimals);
}

function buildPopupGameStatRows(
  current: Record<string, number | null> | null | undefined,
  seasonAverage: Record<string, number | null> | null | undefined,
  position: FantasyRosterEntry['position'] | undefined,
  currentPprOverride: number | null
): PopupGameStatRow[] {
  const game = current ?? {};
  const avg = seasonAverage ?? {};
  const rows: PopupGameStatRow[] = [];

  const addNumber = (
    label: string,
    key: string,
    options?: { gameDecimals?: number; avgDecimals?: number; gameOverride?: number | null }
  ) => {
    const gameValue = toFiniteNumber(
      options?.gameOverride ?? (game as Record<string, number | null>)[key]
    );
    const avgValue = toFiniteNumber((avg as Record<string, number | null>)[key]);
    if (gameValue == null && avgValue == null) return;
    rows.push({
      key,
      label,
      game: formatGameStatValue(gameValue, options?.gameDecimals ?? 0),
      average: formatAverageStatValue(avgValue, options?.avgDecimals ?? 1),
    });
  };

  const addPair = (label: string, madeKey: string, attKey: string) => {
    const gameMade = toFiniteNumber((game as Record<string, number | null>)[madeKey]);
    const gameAtt = toFiniteNumber((game as Record<string, number | null>)[attKey]);
    const avgMade = toFiniteNumber((avg as Record<string, number | null>)[madeKey]);
    const avgAtt = toFiniteNumber((avg as Record<string, number | null>)[attKey]);
    if (gameMade == null && gameAtt == null && avgMade == null && avgAtt == null) return;
    rows.push({
      key: `${madeKey}-${attKey}`,
      label,
      game: `${formatGameStatValue(gameMade)}/${formatGameStatValue(gameAtt)}`,
      average: `${formatAverageStatValue(avgMade)}/${formatAverageStatValue(avgAtt)}`,
    });
  };

  if (position === 'QB') {
    addPair('COMP/ATT', 'completions', 'pass_attempts');
    addNumber('PASS YDS', 'passing_yards');
    addNumber('PASS TD', 'passing_tds');
    addNumber('INT', 'interceptions_thrown');
    addNumber('SACKS TAKEN', 'sacks_taken');
    addNumber('RUSH ATT', 'carries');
    addNumber('RUSH YDS', 'rushing_yards');
    addNumber('RUSH TD', 'rushing_tds');
    addNumber('PPR PTS', 'fantasy_points_ppr', {
      gameDecimals: 1,
      avgDecimals: 1,
      gameOverride: currentPprOverride,
    });
    return rows;
  }

  if (position === 'RB') {
    addNumber('RUSH ATT', 'carries');
    addNumber('RUSH YDS', 'rushing_yards');
    addNumber('RUSH TD', 'rushing_tds');
    addNumber('TARGETS', 'targets');
    addNumber('REC', 'receptions');
    addNumber('REC YDS', 'receiving_yards');
    addNumber('REC TD', 'receiving_tds');
    addNumber('PPR PTS', 'fantasy_points_ppr', {
      gameDecimals: 1,
      avgDecimals: 1,
      gameOverride: currentPprOverride,
    });
    return rows;
  }

  if (position === 'WR' || position === 'TE') {
    addNumber('TARGETS', 'targets');
    addNumber('REC', 'receptions');
    addNumber('REC YDS', 'receiving_yards');
    addNumber('REC TD', 'receiving_tds');
    addNumber('RUSH ATT', 'carries');
    addNumber('RUSH YDS', 'rushing_yards');
    addNumber('RUSH TD', 'rushing_tds');
    addNumber('PPR PTS', 'fantasy_points_ppr', {
      gameDecimals: 1,
      avgDecimals: 1,
      gameOverride: currentPprOverride,
    });
    return rows;
  }

  if (position === 'K') {
    addPair('FG MADE/ATT', 'fg_made', 'fg_attempts');
    addPair('XP MADE/ATT', 'pat_made', 'pat_attempts');
    addNumber('PPR PTS', 'fantasy_points_ppr', {
      gameDecimals: 1,
      avgDecimals: 1,
      gameOverride: currentPprOverride,
    });
    return rows;
  }

  addPair('COMP/ATT', 'completions', 'pass_attempts');
  addNumber('PASS YDS', 'passing_yards');
  addNumber('RUSH YDS', 'rushing_yards');
  addNumber('REC YDS', 'receiving_yards');
  addNumber('PPR PTS', 'fantasy_points_ppr', {
    gameDecimals: 1,
    avgDecimals: 1,
    gameOverride: currentPprOverride,
  });
  return rows;
}

function PlayerStatsPanel({
  actor,
  onClose,
  fantasyEntry,
  accentColor,
  accentAltColor,
  gameId,
  season,
  week,
}: {
  actor: PlayActorInfo;
  onClose: () => void;
  fantasyEntry?: FantasyRosterEntry | null;
  accentColor: string;
  accentAltColor: string;
  gameId: string;
  season?: number;
  week?: number;
}) {
  const [advanced, setAdvanced] = useState<AdvancedPlayerData>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!actor.gsisId || !season || !week) return;
    const ctrl = new AbortController();
    const params = new URLSearchParams({
      gsis_id: actor.gsisId,
      season: String(season),
      week: String(week),
      game_id: String(gameId),
    });
    fetch(`${API_BASE}/players/advanced/?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setAdvanced(d as AdvancedPlayerData))
      .catch(() => {});
    return () => ctrl.abort();
  }, [actor.gsisId, gameId, season, week]);

  const initials = actor.name
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  const statLines = (actor.lines ?? []).filter((l) => l.trim().length > 0);
  const displayActorName =
    fantasyEntry?.name && namesLikelyMatch(fantasyEntry.name, actor.name)
      ? fantasyEntry.name
      : actor.name;
  const fantasyScoringCols = fantasyEntry
    ? [
        { label: 'PPR', value: fantasyEntry.pointsPpr ?? fantasyEntry.points },
        { label: 'HALF PPR', value: fantasyEntry.pointsHalfPpr },
        { label: 'STANDARD', value: fantasyEntry.pointsStandard },
      ].filter((col) => col.value != null)
    : [];
  const pprValue = fantasyScoringCols.find((col) => col.label === 'PPR')?.value ?? null;
  const advancedGameStats = advanced?.game_stats ?? null;
  const gameStatRows = buildPopupGameStatRows(
    advancedGameStats?.current,
    advancedGameStats?.season_average,
    fantasyEntry?.position,
    pprValue
  );
  const seasonAverageHeader = advancedGameStats?.average_label?.trim() || 'SEASON AVG';
  const badgeAccentColor = chooseBadgeAccentColor(accentColor, accentAltColor);
  const hasNgs =
    advanced &&
    (advanced.ngs_passing?.completion_percentage_above_expectation != null ||
      advanced.ngs_passing?.avg_time_to_throw != null ||
      advanced.ngs_rushing?.efficiency != null ||
      advanced.ngs_receiving?.avg_separation != null ||
      advanced.ngs_receiving?.avg_yac_above_expectation != null);

  if (!portalTarget) return null;

  return createPortal(
    <>
      {/* Fixed backdrop — click anywhere outside panel to dismiss */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 7000,
          background: 'rgba(0,0,0,0.55)',
          animation: 'fadeIn 0.14s ease forwards',
          opacity: 0,
        }}
      />

      {/* Panel — overflow visible so stat tooltips can escape the border */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 7001,
          width: 380,
          background: 'rgba(3,8,20,.98)',
          border: `1.5px solid ${C.cyan}`,
          boxShadow: `0 0 48px ${C.cyanGlow}, 0 0 96px rgba(0,229,255,0.08), 0 16px 56px rgba(0,0,0,0.85)`,
          animation: 'fadeIn 0.16s ease forwards',
          opacity: 0,
        }}
      >
        {/* Top scan-line */}
        <div
          style={{
            height: 2,
            background: `linear-gradient(90deg, transparent, ${C.cyan}, transparent)`,
            opacity: 0.7,
          }}
        />

        {/* ── HEADER ── */}
        <div
          style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px 12px' }}
        >
          {/* Headshot / initials circle */}
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              border: `2px solid ${accentColor}`,
              boxShadow: `0 0 16px ${accentColor}99, inset 0 0 10px ${accentColor}33`,
              overflow: 'hidden',
              flexShrink: 0,
              background: `${accentColor}22`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {actor.headshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={actor.headshotUrl}
                alt={displayActorName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span
                style={{
                  fontFamily: F.display,
                  fontWeight: 700,
                  fontSize: 22,
                  color: accentColor,
                  letterSpacing: '.05em',
                }}
              >
                {initials}
              </span>
            )}
          </div>

          {/* Name + position badge + action */}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            {/* Name row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div
                style={{
                  fontFamily: F.display,
                  fontWeight: 800,
                  fontSize: 18,
                  letterSpacing: '.06em',
                  color: C.textBright,
                  lineHeight: 1.2,
                }}
              >
                {displayActorName}
              </div>
              {fantasyEntry?.position && (
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.1em',
                    color: badgeAccentColor,
                    padding: '2px 8px',
                    border: `1px solid ${badgeAccentColor}99`,
                    background: `${badgeAccentColor}22`,
                  }}
                >
                  {fantasyEntry.position}
                </span>
              )}
            </div>
            {/* Action summary */}
            {actor.summary && (
              <div
                style={{
                  marginTop: 7,
                  fontFamily: F.display,
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: '.1em',
                  color: C.textBright,
                  opacity: 0.9,
                }}
              >
                {actor.summary.toUpperCase()}
              </div>
            )}
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 24,
              height: 24,
              background: 'none',
              border: `1px solid ${C.panelBorder}`,
              color: C.textDim,
              cursor: 'pointer',
              fontFamily: F.mono,
              fontSize: 16,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* ── GAME STATS ── */}
        {(gameStatRows.length > 0 || statLines.length > 0) && (
          <div style={{ padding: '0 16px 14px' }}>
            <PanelSectionHeader label="GAME STATS" />
            {gameStatRows.length > 0 ? (
              <div
                style={{
                  border: `1px solid rgba(0,229,255,0.14)`,
                  background: 'rgba(255,255,255,0.02)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 0.6fr 0.8fr',
                    gap: 0,
                    borderBottom: `1px solid rgba(0,229,255,0.12)`,
                    background: 'rgba(0,229,255,0.04)',
                  }}
                >
                  <div
                    style={{
                      padding: '6px 8px',
                      fontFamily: F.mono,
                      fontSize: 8,
                      letterSpacing: '.12em',
                      color: C.textMuted,
                    }}
                  >
                    STAT
                  </div>
                  <div
                    style={{
                      padding: '6px 8px',
                      fontFamily: F.mono,
                      fontSize: 8,
                      letterSpacing: '.12em',
                      color: C.textMuted,
                      textAlign: 'right',
                    }}
                  >
                    THIS GAME
                  </div>
                  <div
                    style={{
                      padding: '6px 8px',
                      fontFamily: F.mono,
                      fontSize: 8,
                      letterSpacing: '.12em',
                      color: C.textMuted,
                      textAlign: 'right',
                    }}
                  >
                    {seasonAverageHeader}
                  </div>
                </div>
                {gameStatRows.map((row, idx) => (
                  <div
                    key={row.key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.2fr 0.6fr 0.8fr',
                      gap: 0,
                      borderTop: idx === 0 ? 'none' : `1px solid rgba(255,255,255,0.05)`,
                    }}
                  >
                    <div
                      style={{
                        padding: '6px 8px',
                        fontFamily: F.mono,
                        fontSize: 10,
                        letterSpacing: '.08em',
                        color: C.textDim,
                      }}
                    >
                      {row.label}
                    </div>
                    <div
                      style={{
                        padding: '6px 8px',
                        fontFamily: F.display,
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: '.05em',
                        color: C.textBright,
                        textAlign: 'right',
                      }}
                    >
                      {row.game}
                    </div>
                    <div
                      style={{
                        padding: '6px 8px',
                        fontFamily: F.display,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '.04em',
                        color: C.textDim,
                        textAlign: 'right',
                      }}
                    >
                      {row.average}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              statLines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: F.mono,
                    fontSize: 12,
                    letterSpacing: '.04em',
                    color: C.textBright,
                    lineHeight: 1.7,
                  }}
                >
                  {line}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── FANTASY ── */}
        {fantasyEntry && (
          <div style={{ padding: '0 16px 14px' }}>
            <PanelSectionHeader label="FANTASY · THIS GAME" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(1, fantasyScoringCols.length)}, minmax(0,1fr))`,
                gap: 6,
              }}
            >
              {fantasyScoringCols.map((col) => (
                <div
                  key={col.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '9px 10px',
                    background: `linear-gradient(180deg, rgba(0,229,255,0.08), rgba(255,255,255,0.02))`,
                    border: `1px solid rgba(0,229,255,0.18)`,
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                  }}
                >
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 8.5,
                      color: C.textDim,
                      letterSpacing: '.14em',
                      marginBottom: 6,
                    }}
                  >
                    {col.label}
                  </span>
                  <span
                    style={{
                      fontFamily: F.display,
                      fontWeight: 800,
                      fontSize: 20,
                      color: C.textBright,
                      letterSpacing: '.05em',
                      lineHeight: 1,
                    }}
                  >
                    {col.value!.toFixed(1)}
                  </span>
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 7.5,
                      color: C.textMuted,
                      letterSpacing: '.1em',
                      marginTop: 6,
                    }}
                  >
                    POINTS
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ADVANCED ── */}
        {advanced && (advanced.ecr || hasNgs) && (
          <div style={{ padding: '0 16px 14px' }}>
            <PanelSectionHeader label="ADVANCED" />

            {/* Expert consensus rank — prominent block */}
            {advanced.ecr != null && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '10px 12px',
                  marginBottom: hasNgs ? 10 : 0,
                  background: 'rgba(0,229,255,0.05)',
                  border: `1px solid rgba(0,229,255,0.15)`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: F.mono,
                      fontSize: 8,
                      color: C.textDim,
                      letterSpacing: '.14em',
                      marginBottom: 4,
                    }}
                  >
                    EXPERT CONSENSUS RANK
                  </div>
                  <div
                    style={{
                      fontFamily: F.display,
                      fontWeight: 800,
                      fontSize: 22,
                      color: C.cyan,
                      letterSpacing: '.04em',
                    }}
                  >
                    {advanced.ecr.position_rank != null
                      ? `${advanced.ecr.position} #${advanced.ecr.position_rank}`
                      : `#${Math.round(advanced.ecr.rank)} overall`}
                  </div>
                  {advanced.ecr.rank_sd != null && (
                    <div
                      style={{
                        fontFamily: F.mono,
                        fontSize: 9,
                        color: C.textDim,
                        letterSpacing: '.06em',
                        marginTop: 3,
                      }}
                    >
                      ±{advanced.ecr.rank_sd.toFixed(1)} consensus deviation
                    </div>
                  )}
                </div>
                {(advanced.ecr.rank_best != null || advanced.ecr.rank_worst != null) && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {advanced.ecr.rank_best != null && (
                      <div
                        style={{
                          fontFamily: F.mono,
                          fontSize: 9,
                          color: C.textDim,
                          marginBottom: 3,
                        }}
                      >
                        Best #{advanced.ecr.rank_best}
                      </div>
                    )}
                    {advanced.ecr.rank_worst != null && (
                      <div style={{ fontFamily: F.mono, fontSize: 9, color: C.textDim }}>
                        Worst #{advanced.ecr.rank_worst}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* NGS stats — 2-column grid with tooltips */}
            {hasNgs && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {advanced.ngs_passing?.completion_percentage_above_expectation != null && (
                  <StatTile
                    label="CPOE"
                    value={`${advanced.ngs_passing.completion_percentage_above_expectation > 0 ? '+' : ''}${advanced.ngs_passing.completion_percentage_above_expectation.toFixed(1)}%`}
                    tooltip="Completion % Over Expectation: how much better/worse a QB completes passes relative to the difficulty of each attempt."
                  />
                )}
                {advanced.ngs_passing?.avg_time_to_throw != null && (
                  <StatTile
                    label="TIME TO THROW"
                    value={`${advanced.ngs_passing.avg_time_to_throw.toFixed(2)}s`}
                    tooltip="Average time from snap to pass release. League avg ≈ 2.5s. Lower = quicker decisions; higher = more time holding in the pocket."
                  />
                )}
                {advanced.ngs_rushing?.efficiency != null && (
                  <StatTile
                    label="NGS EFFICIENCY"
                    value={`${advanced.ngs_rushing.efficiency > 0 ? '+' : ''}${advanced.ngs_rushing.efficiency.toFixed(2)}`}
                    tooltip="NextGen rush efficiency: yards gained above expectation per carry, based on blocking scheme and defensive positioning."
                  />
                )}
                {advanced.ngs_receiving?.avg_separation != null && (
                  <StatTile
                    label="SEPARATION"
                    value={`${advanced.ngs_receiving.avg_separation.toFixed(1)} yds`}
                    tooltip="Average yards of separation from the nearest defender at time of target. Higher = more open at the catch point."
                  />
                )}
                {advanced.ngs_receiving?.avg_yac_above_expectation != null && (
                  <StatTile
                    label="YAC+"
                    value={`${advanced.ngs_receiving.avg_yac_above_expectation > 0 ? '+' : ''}${advanced.ngs_receiving.avg_yac_above_expectation.toFixed(1)}`}
                    tooltip="Yards After Catch above expectation per reception — how much extra YAC a receiver creates vs. a typical player in the same situation."
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom scan-line */}
        <div
          style={{
            height: 1,
            background: `linear-gradient(90deg, transparent, ${C.cyan}44, transparent)`,
          }}
        />
      </div>
    </>,
    portalTarget
  );
}

function WeatherOverlay({ weather, venue }: { weather: LiveGameState['weather']; venue: string }) {
  return <WeatherLayer weather={weather} venue={venue} />;
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'plays', label: 'MISSION LOG' },
  { key: 'stats', label: 'TEAM METRICS' },
  { key: 'leaders', label: 'PERSONNEL' },
  { key: 'scoring', label: 'SCORING' },
  { key: 'fantasy', label: 'FANTASY' },
];
