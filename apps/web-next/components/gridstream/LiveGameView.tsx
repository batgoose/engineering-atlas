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
import type { LiveGameState } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F, GRIDSTREAM_FONTS_URL } from '@atlas/sdk/gridstream/theme';
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

function buildTimeoutNotice(text: string | undefined, awayAbbr: string, homeAbbr: string): string | null {
  if (!text || !/timeout/i.test(text)) return null;
  if (/official timeout/i.test(text)) return 'Official Timeout';
  const team = parseTimeoutTeam(text, awayAbbr, homeAbbr);
  return team ? `${team} Timeout` : 'Timeout';
}

export function LiveGameView({
  state, onReplay, onPrev, onNext, onEnd, onJumpToPlayIndex, quarterJumps, isReplaying,
  wsConnected, feedConnected, season, week, isGameFinal = false, currentPlaySequence = null,
}: LiveGameViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('plays');
  const [elapsed, setElapsed] = useState(0);
  const isFinal = state.status === 'final' || state.status === 'final_ot';
  const currentMissionEntry = state.plays[state.plays.length - 1];
  const timeoutNotice = buildTimeoutNotice(currentMissionEntry?.text, state.away.abbr, state.home.abbr);

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
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Share Tech Mono', monospace" }}>

      {/* TOP NAV */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 44, background: '#060a12', borderBottom: `1px solid ${C.panelBorder}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 15, color: C.cyan, letterSpacing: '.14em', textShadow: `0 0 10px ${C.cyanGlow}` }}>GRIDSTREAM</span>
          <div style={{ width: 1, height: 20, background: C.panelBorder }} />
          <span style={{ fontFamily: F.display, fontSize: 10, fontWeight: 500, letterSpacing: '.12em', color: C.textDim, cursor: 'pointer' }}>◂ SCOREBOARD</span>
          <span style={{ fontFamily: F.display, fontSize: 10, fontWeight: 500, letterSpacing: '.12em', color: C.textDim }}>
            {week ? `WEEK ${week}` : ''} · {season || new Date().getFullYear()}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <StatusDot label="FEED" color={feedConnected ? C.green : C.red} />
          <StatusDot label="WS" color={wsConnected ? C.green : C.red} />
          <span style={{ fontSize: 10, color: C.textMuted, letterSpacing: '.08em' }}>SESSION {uptime}</span>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '16px 24px 60px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* VIEWPORT */}
        <div className="hud-panel" style={{ padding: 0 }}>
          <div className="scan-sweep" />

          {/* Score Bug */}
          <div style={{ padding: '16px 32px 0', position: 'relative', zIndex: 3 }}>
            <ScoreBug
              away={state.away} home={state.home}
              awayScore={state.awayScore} homeScore={state.homeScore}
              timing={state.timing} possession={state.possession}
              awayWinPct={state.awayWinPct} wpTimeline={state.wpTimeline}
              awayTimeouts={state.awayTimeouts ?? 3} homeTimeouts={state.homeTimeouts ?? 3}
              isFinal={isFinal}
            />
          </div>

          {/* Situation Bar */}
          <SituationBar
            situation={state.situation}
            isFinal={isFinal}
            timeoutNotice={timeoutNotice}
          />

          {/* THE FIELD with overlaid panels */}
          <div style={{ position: 'relative', padding: '0 20px 20px' }}>
            {/* Weather on field wrapper so it clips */}
            <WeatherOverlay weather={state.weather} venue={state.venue} />

            {/* Drive tracker overlay — only when active drive */}
            {state.currentDrive && (
              <div style={{ position: 'absolute', top: 8, left: 28, zIndex: 4 }}>
                <DriveTracker drive={state.currentDrive} possessionTeam={state.situation.possessionTeam} />
              </div>
            )}

            {/* Environment + Win Prob overlays */}
            <div style={{ position: 'absolute', top: 8, right: 28, zIndex: 4 }}>
              <EnvironmentPanel weather={state.weather} />
            </div>

            <FieldVisualization
              away={state.away} home={state.home} situation={state.situation}
              lastPlay={state.lastPlay} animationKey={state.animationKey}
              weather={state.weather} venue={state.venue}
              currentDrive={state.currentDrive}
              isFinal={isFinal}
              fieldNotice={timeoutNotice}
              showPlayStartSpot={isReplaying}
            />
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

          {/* Score Table inside viewport */}
          <div style={{ padding: '0 20px 16px' }}>
            <ScoreboardTable
              away={state.away} home={state.home}
              awayScore={state.awayScore} homeScore={state.homeScore}
              possession={state.possession}
            />
          </div>
        </div>

        {/* TABS */}
        <div>
          <div style={{ display: 'flex', gap: 0 }}>
            {TABS.map(({ key, label }) => (
              <button key={key} className={`tab-btn ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>{label}</button>
            ))}
          </div>
          <div className="hud-panel" style={{ borderTopLeftRadius: 0, minHeight: 320 }}>
            {activeTab === 'plays' && <MissionLog plays={state.plays} />}
            {activeTab === 'stats' && state.teamStats && <TeamStatsPanel stats={state.teamStats} away={state.away} home={state.home} />}
            {activeTab === 'stats' && !state.teamStats && <Placeholder text="Team stats not available for this game." />}
            {activeTab === 'leaders' && state.leaders && <LeadersPanel leaders={state.leaders} away={state.away} home={state.home} />}
            {activeTab === 'leaders' && !state.leaders && <Placeholder text="Leader data not available for this game." />}
            {activeTab === 'scoring' && <ScoringPanel scoring={state.scoring ?? []} away={state.away} home={state.home} />}
            {activeTab === 'fantasy' && (state.fantasyAway.length > 0 || state.fantasyHome.length > 0) && (
              <FantasyPanel away={state.away} home={state.home} fantasyAway={state.fantasyAway} fantasyHome={state.fantasyHome} playerSeasonStats={state.playerSeasonStats} />
            )}
            {activeTab === 'fantasy' && state.fantasyAway.length === 0 && state.fantasyHome.length === 0 && (
              <Placeholder text="Fantasy boxscore data is not available for this game yet." />
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0', borderTop: `1px solid ${C.panelBorder}` }}>
          <span className="hud-label" style={{ fontSize: 9 }}>GRIDSTREAM · ENGINEERING ATLAS</span>
          <span className="hud-label" style={{ fontSize: 9 }}>DATA: NFLVERSE + ESPN · WS: GRIDSTREAM HUB</span>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}80`, animation: 'pulse 2s ease-in-out infinite' }} />
      <span style={{ fontFamily: F.display, fontSize: 9, fontWeight: 600, letterSpacing: '.15em', color }}>{label}</span>
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
    <div style={{ padding: '2px 20px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        <button type="button" style={navButtonStyle(false, atStart)} onClick={onPrev} disabled={atStart} title="Previous play">◀ PREV</button>
        <button type="button" style={navButtonStyle()} onClick={onReplay} title="Replay current play">Replay</button>
        <button type="button" style={navButtonStyle(false, atEnd)} onClick={onNext} disabled={atEnd} title="Next play">NEXT ▶</button>
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
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.red, boxShadow: `0 0 6px ${C.red}90`, animation: 'pulse 2s ease-in-out infinite' }} />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div style={{ padding: 20, color: C.textDim, fontFamily: F.mono, fontSize: 12 }}>{text}</div>;
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
