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

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import type { LiveGameState, PlayActorInfo, FantasyRosterEntry } from '@atlas/sdk/gridstream/types';
import {
  gridstreamColors as C,
  gridstreamFonts as F,
  GRIDSTREAM_FONTS_URL,
} from '@atlas/sdk/gridstream/theme';
import { resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';

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
import { LeadersPanel } from './LeadersPanel';
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
}: LiveGameViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('plays');
  const [elapsed, setElapsed] = useState(0);
  const [statsPanelActor, setStatsPanelActor] = useState<PlayActorInfo | null>(null);

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
  const playEventLabel: { text: string; color: string; glow: string; delay: number } | null =
    (() => {
      if (state.lastPlay?.isSafety)
        return { text: 'SAFETY', color: C.red, glow: `${C.red}80`, delay: 1.0 };
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

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const uptime = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.text,
        fontFamily: "'Share Tech Mono', monospace",
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span
            style={{
              fontFamily: F.display,
              fontWeight: 800,
              fontSize: 15,
              color: C.cyan,
              letterSpacing: '.14em',
              textShadow: `0 0 10px ${C.cyanGlow}`,
            }}
          >
            GRIDSTREAM
          </span>
          <div style={{ width: 1, height: 20, background: C.panelBorder }} />
          <a
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
          </a>
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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <StatusDot label="FEED" color={feedConnected ? C.green : C.red} />
          <StatusDot label="WS" color={wsConnected ? C.green : C.red} />
          <span style={{ fontSize: 10, color: C.textMuted, letterSpacing: '.08em' }}>
            SESSION {uptime}
          </span>
        </div>
      </div>

      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '16px 24px 60px',
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
          <div style={{ padding: '16px 32px 0', position: 'relative', zIndex: 3 }}>
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
            <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {playEventLabel && (
                <span
                  style={{
                    fontFamily: F.display,
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: '.22em',
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
                <span style={{ width: 1, height: 10, background: C.amberBorder, opacity: 0.6, flexShrink: 0 }} />
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
                    <span style={{ width: 1, height: 10, background: C.amberBorder, opacity: 0.6, flexShrink: 0 }} />
                  </>
                )}
                <span
                  style={{
                    fontFamily: F.display,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '.06em',
                    color: C.textBright,
                  }}
                >
                  {penaltyStrip.type}
                </span>
                {penaltyStrip.yards > 0 && (
                  <>
                    <span style={{ width: 1, height: 10, background: C.amberBorder, opacity: 0.6, flexShrink: 0 }} />
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
                    <span style={{ width: 1, height: 10, background: C.amberBorder, opacity: 0.6, flexShrink: 0 }} />
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
          <div style={{ position: 'relative', padding: '0 8px 6px', marginTop: -60 }}>
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
            {statsPanelActor && (() => {
              const nameKey = statsPanelActor.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              const fantasyEntry =
                [...state.fantasyAway, ...state.fantasyHome].find(
                  (e) => e.name.toLowerCase().replace(/[^a-z0-9]/g, '') === nameKey
                ) ?? null;
              return (
                <PlayerStatsPanel
                  actor={statsPanelActor}
                  onClose={() => setStatsPanelActor(null)}
                  fantasyEntry={fantasyEntry}
                  season={season}
                  week={week}
                />
              );
            })()}
          </div>

          {/* Controls row: Drive (left) | Playback (center) | Environment (right) */}
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
              <EnvironmentPanel weather={state.weather} />
            </div>
          </div>

          {/* Score Table inside viewport */}
          <div style={{ position: 'relative', padding: '0 20px 16px' }}>
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
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
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
          <div className="hud-panel" style={{ borderTopLeftRadius: 0, minHeight: 320 }}>
            {activeTab === 'plays' && <MissionLog plays={state.plays} />}
            {activeTab === 'stats' && state.teamStats && (
              <TeamStatsPanel stats={state.teamStats} away={state.away} home={state.home} />
            )}
            {activeTab === 'stats' && !state.teamStats && (
              <Placeholder text="Team stats not available for this game." />
            )}
            {activeTab === 'leaders' && state.leaders && (
              <LeadersPanel leaders={state.leaders} away={state.away} home={state.home} />
            )}
            {activeTab === 'leaders' && !state.leaders && (
              <Placeholder text="Leader data not available for this game." />
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
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    minWidth: 98,
    height: 34,
    padding: '0 14px',
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
          style={navButtonStyle(shareState === 'copied', currentPlaySequence == null)}
          onClick={() => void onShare()}
          disabled={currentPlaySequence == null}
          title={currentPlaySequence == null ? 'No play to share yet' : 'Copy link to this play'}
        >
          {shareState === 'copied' ? 'Copied' : shareState === 'error' ? 'Copy Failed' : 'Share'}
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

function PlayerStatsPanel({
  actor,
  onClose,
  fantasyEntry,
  season,
  week,
}: {
  actor: PlayActorInfo;
  onClose: () => void;
  fantasyEntry?: FantasyRosterEntry | null;
  season?: number;
  week?: number;
}) {
  const [advanced, setAdvanced] = useState<AdvancedPlayerData>(null);

  useEffect(() => {
    if (!actor.gsisId || !season || !week) return;
    const ctrl = new AbortController();
    fetch(
      `${API_BASE}/players/advanced/?gsis_id=${encodeURIComponent(actor.gsisId)}&season=${season}&week=${week}`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((d) => setAdvanced(d as AdvancedPlayerData))
      .catch(() => {});
    return () => ctrl.abort();
  }, [actor.gsisId, season, week]);

  const initials = actor.name
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  const statLines = (actor.lines ?? []).filter((l) => l.trim().length > 0);
  const hasNgs =
    advanced &&
    (advanced.ngs_passing?.completion_percentage_above_expectation != null ||
      advanced.ngs_passing?.avg_time_to_throw != null ||
      advanced.ngs_rushing?.efficiency != null ||
      advanced.ngs_receiving?.avg_separation != null ||
      advanced.ngs_receiving?.avg_yac_above_expectation != null);

  return (
    <>
      {/* Fixed backdrop — click anywhere outside panel to dismiss */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 900,
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
          zIndex: 901,
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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px 12px' }}>
          {/* Headshot / initials circle */}
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              border: `2px solid ${C.cyan}`,
              boxShadow: `0 0 14px ${C.cyanGlow}, inset 0 0 10px rgba(0,229,255,0.06)`,
              overflow: 'hidden',
              flexShrink: 0,
              background: 'rgba(0,229,255,.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {actor.headshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={actor.headshotUrl}
                alt={actor.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span
                style={{
                  fontFamily: F.display,
                  fontWeight: 700,
                  fontSize: 22,
                  color: C.cyan,
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
                {actor.name}
              </div>
              {fantasyEntry?.position && (
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.1em',
                    color: C.cyan,
                    padding: '2px 8px',
                    border: `1px solid rgba(0,229,255,0.4)`,
                    background: 'rgba(0,229,255,0.1)',
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
                  fontSize: 13,
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
        {statLines.length > 0 && (
          <div style={{ padding: '0 16px 14px' }}>
            <PanelSectionHeader label="GAME STATS" />
            {statLines.map((line, i) => (
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
            ))}
          </div>
        )}

        {/* ── FANTASY ── */}
        {fantasyEntry && (
          <div style={{ padding: '0 16px 14px' }}>
            <PanelSectionHeader label="FANTASY · THIS GAME" />
            <div style={{ display: 'flex', gap: 1 }}>
              {[
                { label: 'PPR', value: fantasyEntry.pointsPpr ?? fantasyEntry.points },
                { label: 'HALF PPR', value: fantasyEntry.pointsHalfPpr },
                { label: 'STANDARD', value: fantasyEntry.pointsStandard },
              ]
                .filter((col) => col.value != null)
                .map((col) => (
                  <div
                    key={col.label}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '8px 4px',
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid rgba(0,229,255,0.1)`,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: F.mono,
                        fontSize: 8,
                        color: C.textDim,
                        letterSpacing: '.12em',
                        marginBottom: 4,
                      }}
                    >
                      {col.label}
                    </span>
                    <span
                      style={{
                        fontFamily: F.display,
                        fontWeight: 800,
                        fontSize: 17,
                        color: C.textBright,
                        letterSpacing: '.04em',
                      }}
                    >
                      {col.value!.toFixed(1)}
                    </span>
                    <span
                      style={{
                        fontFamily: F.mono,
                        fontSize: 7,
                        color: C.textMuted,
                        letterSpacing: '.08em',
                        marginTop: 3,
                      }}
                    >
                      PTS
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
    </>
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
