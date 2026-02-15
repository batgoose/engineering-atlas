'use client';

import { useState, useEffect } from 'react';
import type { LiveGameState } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { getGridstreamStylesheet } from '@atlas/sdk/gridstream/animations';
import { GRIDSTREAM_FONTS_URL } from '@atlas/sdk/gridstream/theme';
import { ScoreBug } from './ScoreBug';
import { SituationBar } from './SituationBar';
import { DriveTracker } from './DriveTracker';
import { EnvironmentPanel } from './EnvironmentPanel';
import { FieldVisualization } from './FieldVisualization';
import { ScoreboardTable } from './ScoreboardTable';
import { MissionLog } from './MissionLog';
import { FantasyPanel } from './FantasyPanel';
import { WinProbSparkline } from './WinProbSparkline';

type TabKey = 'mission' | 'metrics' | 'personnel' | 'scoring' | 'fantasy';

interface LiveGameViewProps {
  state: LiveGameState;
  // Play navigation
  onReplay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLive: () => void;
  isReplaying: boolean;
}

export function LiveGameView({
  state, onReplay, onPrev, onNext, onFirst, onLive, isReplaying,
}: LiveGameViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('mission');

  // Inject stylesheet and fonts on mount
  useEffect(() => {
    // Fonts
    if (!document.querySelector(`link[href*="Orbitron"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = GRIDSTREAM_FONTS_URL;
      document.head.appendChild(link);
    }

    // Animations + base styles
    const styleId = 'gridstream-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = getGridstreamStylesheet();
      document.head.appendChild(style);
    }
  }, []);

  return (
    <div style={{
      background: C.bg,
      color: C.text,
      minHeight: '100vh',
      fontFamily: F.body,
    }}>
      {/* Top navigation bar */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 40,
        borderBottom: `1px solid ${C.panelBorder}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{
            fontFamily: F.display, fontSize: 14, fontWeight: 800,
            color: C.amber, letterSpacing: '.1em',
          }}>
            GRIDSTREAM
          </span>
          <span style={{ color: C.textDim, fontSize: 12 }}>‹ SCOREBOARD</span>
          <span style={{ color: C.textDim, fontSize: 12 }}>
            WEEK {state.timing.quarter > 0 ? '' : '—'} · {new Date().getFullYear()}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ConnectionDot connected={state.connected} />
          <span style={{
            fontFamily: F.mono, fontSize: 10, color: C.textDim,
            letterSpacing: '.1em',
          }}>
            SESSION {Math.floor(Date.now() / 1000 % 1000)}.{String(Date.now() % 100).padStart(2, '0')}
          </span>
        </div>
      </nav>

      {/* Main content */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px' }}>

        {/* Score bug */}
        <ScoreBug
          away={state.away}
          home={state.home}
          awayScore={state.awayScore}
          homeScore={state.homeScore}
          timing={state.timing}
          possession={state.possession}
          awayWinPct={state.awayWinPct}
          wpTimeline={state.wpTimeline}
          network={state.network}
          spread={state.spread}
        />

        {/* Situation bar */}
        <SituationBar
          situation={state.situation}
          network={state.network}
          spread={state.spread}
          awayAbbr={state.away.abbr}
          homeAbbr={state.home.abbr}
          onReplay={onReplay}
          onPrev={onPrev}
          onNext={onNext}
          onFirst={onFirst}
          onLive={onLive}
          isReplaying={isReplaying}
        />

        {/* Field + sidebars */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '200px 1fr 200px',
          gap: 12, margin: '12px 0',
        }}>
          {/* Left sidebar — drive tracker */}
          <DriveTracker
            drive={state.currentDrive}
            possessionTeam={state.situation.possessionTeam}
          />

          {/* Center — field visualization */}
          <FieldVisualization
            away={state.away}
            home={state.home}
            situation={state.situation}
            lastPlay={state.lastPlay}
            animationKey={state.animationKey}
            weather={state.weather}
            venue={state.venue}
          />

          {/* Right sidebar — environment + win probability */}
          <EnvironmentPanel
            weather={state.weather}
            awayWinPct={state.awayWinPct}
            away={state.away}
            home={state.home}
          />
        </div>

        {/* Scoreboard table */}
        <ScoreboardTable
          away={state.away}
          home={state.home}
          awayScore={state.awayScore}
          homeScore={state.homeScore}
          timing={state.timing}
          possession={state.possession}
        />

        {/* Tabbed lower section */}
        <div style={{ marginTop: 16 }}>
          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 0,
            borderBottom: `1px solid ${C.panelBorder}`,
          }}>
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  fontFamily: F.display, fontSize: 11, fontWeight: 700,
                  letterSpacing: '.12em', padding: '12px 24px',
                  color: activeTab === key ? C.cyan : C.textDim,
                  borderBottom: activeTab === key ? `2px solid ${C.cyan}` : '2px solid transparent',
                  background: 'none', border: 'none', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{
            border: `1px solid ${C.panelBorder}`,
            borderTop: 'none',
            background: C.bgPanel,
          }}>
            {activeTab === 'mission' && (
              <MissionLog plays={state.plays} />
            )}
            {activeTab === 'metrics' && (
              <WinProbSparkline
                timeline={state.wpTimeline}
                timing={state.timing}
                away={state.away}
                home={state.home}
                width={800}
                height={120}
              />
            )}
            {activeTab === 'fantasy' && (
              <div style={{ padding: 16 }}>
                <FantasyPanel
                  away={state.away}
                  home={state.home}
                  fantasyAway={state.fantasyAway}
                  fantasyHome={state.fantasyHome}
                  playerSeasonStats={state.playerSeasonStats}
                />
              </div>
            )}
            {activeTab === 'personnel' && (
              <div style={{ padding: 20, color: C.textDim, fontFamily: F.mono, fontSize: 12 }}>
                Personnel data coming soon — depth charts, snap counts, and formation tendencies.
              </div>
            )}
            {activeTab === 'scoring' && (
              <div style={{ padding: 20, color: C.textDim, fontFamily: F.mono, fontSize: 12 }}>
                Scoring summary coming soon — detailed scoring drive breakdowns.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'mission', label: 'MISSION LOG' },
  { key: 'metrics', label: 'TEAM METRICS' },
  { key: 'personnel', label: 'PERSONNEL' },
  { key: 'scoring', label: 'SCORING' },
  { key: 'fantasy', label: 'FANTASY' },
];

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: connected ? C.green : C.red,
        boxShadow: connected ? `0 0 8px ${C.green}` : `0 0 8px ${C.red}`,
        animation: 'pulse 2s ease-in-out infinite',
      }} />
      <span style={{
        fontFamily: F.display, fontSize: 9, fontWeight: 600,
        letterSpacing: '.15em',
        color: connected ? C.green : C.red,
      }}>
        {connected ? 'FEED' : 'OFFLINE'}
      </span>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: C.green,
        boxShadow: `0 0 8px ${C.green}`,
        animation: 'pulse 2s ease-in-out infinite 0.5s',
      }} />
      <span style={{
        fontFamily: F.display, fontSize: 9, fontWeight: 600,
        letterSpacing: '.15em', color: C.green,
      }}>
        WS
      </span>
    </div>
  );
}
