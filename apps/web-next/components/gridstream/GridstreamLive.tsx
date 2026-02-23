'use client';

import { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════
// GRIDSTREAM LIVE — FAITHFUL PORT OF v11 PROTOTYPE
// Single-file component with typed props replacing hardcoded GAME object
// ═══════════════════════════════════════════════════════════════

// ── Color tokens (exact v11 values) ──
const C = {
  cyan: '#00e5ff',
  cyanDim: '#0097a7',
  cyanBorder: 'rgba(0,229,255,0.15)',
  cyanGlow: 'rgba(0,229,255,0.3)',
  bg: '#070b14',
  panel: '#0a1020',
  panelBorder: 'rgba(0,229,255,0.1)',
  text: '#b0c8d8',
  textBright: '#e0f0ff',
  textDim: '#5a7a90',
  textMuted: '#2e4858',
  red: '#ff3b4f',
  amber: '#ffb612',
  amberGlow: 'rgba(255,182,18,0.4)',
  amberBorder: 'rgba(255,182,18,0.25)',
  green: '#00e676',
};

// ── Types ──
interface Team {
  abbr: string;
  name: string;
  location: string;
  full: string;
  color: string;
  colorAlt: string;
  colorBright: string;
  record: string;
  score: number;
  timeouts: number;
  scores: (number | null)[];
  endzoneName: string;
}

interface Play {
  id: number;
  clock: string;
  q: number;
  down: string;
  text: string;
  epa: number;
  type: string;
  team: string | null;
}

interface LastPlay {
  type: string;
  direction: string;
  airYards: number;
  yardsGained: number;
  fromYardline: number;
  fromSide: string;
  toYardline: number;
  toSide: string;
  description: string;
  isComplete: boolean;
  receiver: { name: string; number: number; yards: number; tds: number } | null;
  isFirstDown: boolean;
  turnoverBy?: string;
  fgResult?: string;
  fgDistance?: number;
}

interface CurrentDrive {
  plays: number;
  yards: number;
  time: string;
  startYardline: number;
  startSide: string;
}

interface Weather {
  temp: number;
  condition: string;
  wind: string;
  humidity: number;
}

interface WpPoint {
  wp: number;
  gameMin: number;
}
interface LeaderEntry {
  name: string;
  line: string;
}
interface LeaderSet {
  passing: LeaderEntry;
  rushing: LeaderEntry;
  receiving: LeaderEntry;
}
interface TeamStatLine {
  totalYards: number;
  passingYards: number;
  rushingYards: number;
  firstDowns: number;
  thirdDown: string;
  turnovers: number;
  top: string;
  penalties: string;
  sacks: number;
}
interface ScoringEntry {
  q: number;
  team: string;
  desc: string;
  away: number;
  home: number;
}
interface FantasyPlayer {
  name: string;
  pos: string;
  pts: number;
  breakdown: string;
}
interface SeasonStats {
  gp: number;
  avgPts: number;
  totPts: number;
  line: string;
  last5: number[];
  rank: string;
}

export interface GridstreamGameData {
  id: number;
  status: string;
  quarter: number;
  clock: string;
  home: Team;
  away: Team;
  possession: string; // team abbr
  down: number;
  distance: number;
  yardline: number;
  side: string;
  spread: string;
  total: string;
  broadcast: string;
  venue: string;
  weather: Weather;
  currentDrive: CurrentDrive | null;
  winProb: { away: number; home: number };
  wpTimeline: WpPoint[];
  gameTiming: { quarter: number; clockMin: number; clockSec: number; isOT: boolean };
  lastPlay: LastPlay | null;
  plays: Play[];
  leaders: { away: LeaderSet; home: LeaderSet } | null;
  teamStats: { away: TeamStatLine; home: TeamStatLine } | null;
  scoring: ScoringEntry[];
  fantasy: { away: FantasyPlayer[]; home: FantasyPlayer[] } | null;
  playerSeasonStats: Record<string, SeasonStats>;
}

// ── Helpers ──
const fieldPctToSvgX = (pct: number) => 132 + (pct / 100) * 736;

function yardToFieldPct(yd: number, side: string, awayAbbr: string): number {
  return side === awayAbbr ? yd : 100 - yd;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function GridstreamLive({ game }: { game: GridstreamGameData }) {
  const [activeTab, setActiveTab] = useState('plays');
  const [elapsed, setElapsed] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [showAnim, setShowAnim] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const uptime = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  const replayAnimation = useCallback(() => {
    setShowAnim(false);
    setTimeout(() => {
      setAnimKey((k) => k + 1);
      setShowAnim(true);
    }, 50);
  }, []);

  const possIsAway = game.possession === game.away.abbr;
  const possTeam = possIsAway ? game.away : game.home;
  const ballPct = yardToFieldPct(game.yardline, game.side, game.away.abbr);
  const firstDownPct = Math.min(100, ballPct + game.distance);
  const driveStartPct = game.currentDrive
    ? yardToFieldPct(game.currentDrive.startYardline, game.currentDrive.startSide, game.away.abbr)
    : ballPct;
  const isFinal = game.status === 'post' || game.status === 'final';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.text,
        fontFamily: "'Share Tech Mono', monospace",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;500;600;700;800;900&family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,600&display=swap"
        rel="stylesheet"
      />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes rain{0%{transform:translateY(-10px) translateX(0);opacity:0}10%{opacity:.5}90%{opacity:.5}100%{transform:translateY(260px) translateX(var(--drift, 25px));opacity:0}}
        @keyframes snow{0%{transform:translateY(-10px) translateX(0);opacity:0}10%{opacity:.45}90%{opacity:.45}100%{transform:translateY(260px) translateX(var(--drift, 12px));opacity:0}}
        @keyframes scanPulse{0%{opacity:0;transform:translateY(-100%)}50%{opacity:.03}100%{opacity:0;transform:translateY(200%)}}
        @keyframes cornerFlash{0%,90%,100%{opacity:.5}95%{opacity:1}}
        @keyframes possGlow{0%,100%{opacity:.4}50%{opacity:.7}}
        @keyframes ballTravel{0%{offset-distance:0%}100%{offset-distance:100%}}
        @keyframes trailDraw{0%{stroke-dashoffset:1000}100%{stroke-dashoffset:0}}
        @keyframes trailFade{0%{opacity:.6}60%{opacity:.6}100%{opacity:.1}}
        @keyframes catchFlash{0%{r:4;opacity:1}50%{r:16;opacity:.4}100%{r:20;opacity:0}}
        @keyframes turnoverFlash{0%{opacity:0}20%{opacity:.12}100%{opacity:0}}
        @keyframes firstDownPulse{0%{opacity:.6;stroke-width:3}25%{opacity:1;stroke-width:4}50%{opacity:.6;stroke-width:3}75%{opacity:1;stroke-width:4}100%{opacity:.5;stroke-width:2.5}}
        @keyframes firstDownSweep{0%{stroke-dashoffset:20}100%{stroke-dashoffset:0}}
        @keyframes fgMissVeer{0%{offset-distance:0%}60%{offset-distance:70%}100%{offset-distance:100%}}
        @keyframes sparkDraw{0%{stroke-dashoffset:500}100%{stroke-dashoffset:0}}
        .hud-panel{position:relative;background:${C.panel};border:1px solid ${C.panelBorder};overflow:hidden}
        .hud-panel::before,.hud-panel::after{content:'';position:absolute;width:14px;height:14px;border-color:${C.cyanDim};border-style:solid;z-index:5;animation:cornerFlash 8s ease infinite}
        .hud-panel::before{top:-1px;left:-1px;border-width:2px 0 0 2px}
        .hud-panel::after{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
        .hud-label{font-family:'Orbitron',monospace;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:${C.textDim}}
        .tab-btn{font-family:'Orbitron',monospace;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:10px 20px;background:transparent;border:1px solid transparent;border-bottom:none;color:${C.textDim};cursor:pointer;transition:all .15s;position:relative}
        .tab-btn:hover{color:${C.cyanDim}}
        .tab-btn.active{color:${C.cyan};background:${C.panel};border-color:${C.panelBorder}}
        .tab-btn.active::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:${C.panel}}
        .play-row{display:flex;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(0,229,255,.03);transition:background .1s;animation:slideUp .25s ease both}
        .play-row:hover{background:rgba(0,229,255,.02)}
        .stat-bar{height:5px;background:rgba(0,229,255,.05);border-radius:1px;overflow:hidden;margin-top:5px}
        .scan-sweep{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
        .scan-sweep::after{content:'';position:absolute;left:0;right:0;height:60px;background:linear-gradient(180deg,transparent,rgba(0,229,255,.02),transparent);animation:scanPulse 6s linear infinite}
        .replay-btn{font-family:'Orbitron',monospace;font-size:9px;font-weight:600;letter-spacing:.12em;padding:4px 12px;background:rgba(255,182,18,.06);border:1px solid ${C.amberBorder};color:${C.amber};cursor:pointer;transition:all .15s;text-transform:uppercase}
        .replay-btn:hover{background:rgba(255,182,18,.12);border-color:${C.amber}}
      `}</style>

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
              fontFamily: "'Orbitron'",
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
          <span
            style={{
              fontFamily: "'Orbitron'",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '.12em',
              color: C.textDim,
              cursor: 'pointer',
            }}
          >
            ◂ SCOREBOARD
          </span>
          <span
            style={{
              fontFamily: "'Orbitron'",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '.12em',
              color: C.textDim,
            }}
          >
            WEEK {game.gameTiming.quarter > 0 ? '' : '—'} · {new Date().getFullYear()}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <StatusDot label="FEED" color={C.red} />
          <StatusDot label="WS" color={C.green} />
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
        <div className="hud-panel" style={{ padding: 0 }}>
          <div className="scan-sweep" />

          {/* SCORE BUG */}
          <div
            style={{
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'center',
              padding: '16px 32px 0',
              position: 'relative',
              zIndex: 3,
            }}
          >
            {/* AWAY SIDE */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                justifyContent: 'center',
                padding: '12px 20px',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed'",
                      fontWeight: 700,
                      fontSize: 26,
                      color: C.textBright,
                      letterSpacing: '.04em',
                      lineHeight: 1,
                    }}
                  >
                    {game.away.name.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Share Tech Mono'",
                      fontSize: 12,
                      color: C.textDim,
                      marginTop: 3,
                    }}
                  >
                    {game.away.location} · {game.away.record}
                  </div>
                </div>
                <TeamBadge team={game.away} hasPossession={possIsAway} size={52} />
              </div>
              <div style={{ marginTop: 8, width: '100%', maxWidth: 180, alignSelf: 'flex-end' }}>
                <WinProbSparkline
                  data={game.wpTimeline}
                  isAway={true}
                  color={game.away.colorBright}
                  currentPct={game.winProb.away}
                  gameTiming={game.gameTiming}
                />
              </div>
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
              }}
            >
              <CornerTicks />
              <ScoreDigit value={game.away.score} isWinning={game.away.score > game.home.score} />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '6px 18px',
                  gap: 3,
                  minWidth: 90,
                  borderLeft: `1px solid ${C.panelBorder}`,
                  borderRight: `1px solid ${C.panelBorder}`,
                  background: 'rgba(0,229,255,.02)',
                }}
              >
                <span
                  style={{
                    fontFamily: "'Orbitron'",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '.2em',
                    color: isFinal ? C.textDim : C.red,
                    animation: isFinal ? 'none' : 'pulse 2s ease-in-out infinite',
                  }}
                >
                  {isFinal ? 'FINAL' : game.status === 'halftime' ? 'HALFTIME' : `Q${game.quarter}`}
                </span>
                <span
                  style={{
                    fontFamily: "'Barlow Condensed'",
                    fontSize: 30,
                    fontWeight: 700,
                    color: C.textBright,
                    letterSpacing: '.06em',
                  }}
                >
                  {isFinal ? '' : game.clock}
                </span>
                <div style={{ display: 'flex', gap: 10, marginTop: 1 }}>
                  <TimeoutPips count={game.away.timeouts} />
                  <div style={{ width: 1, height: 5, background: C.panelBorder }} />
                  <TimeoutPips count={game.home.timeouts} />
                </div>
              </div>
              <ScoreDigit value={game.home.score} isWinning={game.home.score > game.away.score} />
            </div>

            {/* HOME SIDE */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'center',
                padding: '12px 20px',
                borderRadius: '0 2px 2px 0',
                position: 'relative',
                background:
                  !possIsAway && game.possession ? 'rgba(255,182,18,0.03)' : 'transparent',
                transition: 'background 0.5s',
              }}
            >
              {!possIsAway && game.possession && (
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <TeamBadge
                  team={game.home}
                  hasPossession={!possIsAway && !!game.possession}
                  size={52}
                />
                <div>
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed'",
                      fontWeight: 700,
                      fontSize: 26,
                      color: C.textBright,
                      letterSpacing: '.04em',
                      lineHeight: 1,
                    }}
                  >
                    {game.home.name.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Share Tech Mono'",
                      fontSize: 12,
                      color: C.textDim,
                      marginTop: 3,
                    }}
                  >
                    {game.home.location} · {game.home.record}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 8, width: '100%', maxWidth: 180 }}>
                <WinProbSparkline
                  data={game.wpTimeline}
                  isAway={false}
                  color={game.home.colorBright}
                  currentPct={game.winProb.home}
                  gameTiming={game.gameTiming}
                />
              </div>
            </div>
          </div>

          {/* SITUATION READOUT */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '8px 0 14px',
              gap: 16,
              position: 'relative',
              zIndex: 3,
            }}
          >
            {isFinal ? (
              <span
                style={{
                  fontFamily: "'Orbitron'",
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
                <span
                  style={{
                    fontFamily: "'Orbitron'",
                    fontSize: 9,
                    fontWeight: 700,
                    color: C.amber,
                    letterSpacing: '.12em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {possIsAway && '◀'} {possTeam.abbr} BALL {!possIsAway && '▶'}
                </span>
                <div style={{ width: 1, height: 14, background: C.panelBorder }} />
                <span
                  style={{
                    fontFamily: "'Orbitron'",
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.amber,
                    letterSpacing: '.1em',
                    padding: '4px 18px',
                    background: 'rgba(255,182,18,.06)',
                    border: `1px solid ${C.amberBorder}`,
                  }}
                >
                  {game.down === 1
                    ? '1ST'
                    : game.down === 2
                      ? '2ND'
                      : game.down === 3
                        ? '3RD'
                        : '4TH'}{' '}
                  & {game.distance}
                </span>
                <span
                  style={{
                    fontFamily: "'Orbitron'",
                    fontSize: 10,
                    color: C.textDim,
                    letterSpacing: '.15em',
                  }}
                >
                  AT
                </span>
                <span
                  style={{
                    fontFamily: "'Orbitron'",
                    fontSize: 14,
                    fontWeight: 700,
                    color: C.textBright,
                    letterSpacing: '.08em',
                  }}
                >
                  {game.side} {game.yardline}
                </span>
                <div style={{ width: 1, height: 14, background: C.panelBorder }} />
                <span style={{ fontSize: 12, color: C.textDim }}>
                  {game.broadcast} · {game.spread}
                </span>
              </>
            )}
            <div style={{ width: 1, height: 14, background: C.panelBorder }} />
            <button className="replay-btn" onClick={replayAnimation}>
              ▶ REPLAY
            </button>
            <div style={{ width: 1, height: 14, background: C.panelBorder }} />
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <button className="replay-btn" title="First play">
                ⏮
              </button>
              <button className="replay-btn" title="Previous play">
                ◀◀
              </button>
              <button className="replay-btn" title="Next play">
                ▶▶
              </button>
              <button className="replay-btn" title="Live / latest">
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  LIVE{' '}
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: C.red,
                      animation: 'pulse 2s ease-in-out infinite',
                    }}
                  />
                </span>
              </button>
            </div>
          </div>

          {/* THE FIELD */}
          <div style={{ position: 'relative', padding: '0 20px 20px', perspective: '800px' }}>
            <WeatherLayer
              condition={game.weather.condition}
              wind={game.weather.wind}
              venue={game.venue}
            />

            {/* Drive tracker overlay */}
            {game.currentDrive && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 28,
                  zIndex: 4,
                  background: 'rgba(7,11,20,.92)',
                  border: `1px solid ${C.panelBorder}`,
                  padding: '8px 14px',
                  minWidth: 180,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className="hud-label" style={{ fontSize: 9 }}>
                    CURRENT DRIVE
                  </span>
                  <TeamBadge team={possTeam} size={16} hasPossession={false} />
                  <span
                    style={{
                      fontFamily: "'Barlow Condensed'",
                      fontWeight: 700,
                      fontSize: 12,
                      color: C.amber,
                    }}
                  >
                    {possTeam.abbr}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 18 }}>
                  <MiniStat label="PLAYS" value={game.currentDrive.plays} />
                  <MiniStat label="YARDS" value={game.currentDrive.yards} />
                  <MiniStat label="TIME" value={game.currentDrive.time} />
                </div>
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
                  FROM {game.currentDrive.startSide} {game.currentDrive.startYardline}
                </div>
              </div>
            )}

            {/* Environment + Win Prob overlays */}
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 28,
                zIndex: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div
                style={{
                  background: 'rgba(7,11,20,.92)',
                  border: `1px solid ${C.panelBorder}`,
                  padding: '8px 14px',
                }}
              >
                <div className="hud-label" style={{ fontSize: 9, marginBottom: 4 }}>
                  ENVIRONMENT
                </div>
                <div
                  style={{
                    fontFamily: "'Orbitron'",
                    fontSize: 16,
                    fontWeight: 700,
                    color: C.textBright,
                  }}
                >
                  {game.weather.temp}°F
                </div>
                <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>
                  {game.weather.condition}
                </div>
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
                  WIND {game.weather.wind}
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(7,11,20,.92)',
                  border: `1px solid ${C.panelBorder}`,
                  padding: '8px 14px',
                  minWidth: 200,
                }}
              >
                <div className="hud-label" style={{ fontSize: 9, marginBottom: 6 }}>
                  WIN PROBABILITY
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span
                    style={{
                      fontFamily: "'Orbitron'",
                      fontSize: 12,
                      fontWeight: 700,
                      color: game.winProb.away > 50 ? C.textBright : C.textDim,
                    }}
                  >
                    {game.away.abbr} {game.winProb.away}%
                  </span>
                  <span
                    style={{
                      fontFamily: "'Orbitron'",
                      fontSize: 12,
                      fontWeight: 700,
                      color: game.winProb.home > 50 ? C.textBright : C.textDim,
                    }}
                  >
                    {game.winProb.home}% {game.home.abbr}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    background: 'rgba(0,229,255,.05)',
                    borderRadius: 1,
                    display: 'flex',
                    overflow: 'hidden',
                    gap: 1,
                  }}
                >
                  <div
                    style={{
                      width: `${game.winProb.away}%`,
                      background: `linear-gradient(90deg, ${game.away.colorBright}80, ${game.away.colorBright}30)`,
                      transition: 'width .5s',
                    }}
                  />
                  <div
                    style={{
                      width: `${game.winProb.home}%`,
                      background: `linear-gradient(90deg, ${game.home.colorBright}30, ${game.home.colorBright}80)`,
                      transition: 'width .5s',
                    }}
                  />
                </div>
              </div>
            </div>

            <div
              style={{
                transform: 'rotateX(32deg)',
                transformOrigin: 'center bottom',
                position: 'relative',
              }}
            >
              <svg viewBox="0 0 1000 420" style={{ width: '100%', display: 'block' }}>
                <defs>
                  <linearGradient id="fGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.cyan} stopOpacity=".07" />
                    <stop offset="50%" stopColor={C.cyan} stopOpacity=".02" />
                    <stop offset="100%" stopColor={C.cyan} stopOpacity=".05" />
                  </linearGradient>
                  <radialGradient id="ballG" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={C.amber} stopOpacity=".6" />
                    <stop offset="60%" stopColor={C.amber} stopOpacity=".1" />
                    <stop offset="100%" stopColor={C.amber} stopOpacity="0" />
                  </radialGradient>
                  <filter id="gf">
                    <feGaussianBlur stdDeviation="2" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <pattern
                    id="ezPatA"
                    patternUnits="userSpaceOnUse"
                    width="12"
                    height="12"
                    patternTransform="rotate(45)"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="12"
                      stroke={game.away.colorAlt}
                      strokeWidth="3"
                      opacity=".12"
                    />
                  </pattern>
                  <pattern
                    id="ezPatH"
                    patternUnits="userSpaceOnUse"
                    width="12"
                    height="12"
                    patternTransform="rotate(-45)"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="12"
                      stroke={game.home.color}
                      strokeWidth="3"
                      opacity=".12"
                    />
                  </pattern>
                </defs>

                <rect
                  x="50"
                  y="30"
                  width="900"
                  height="360"
                  fill="url(#fGrad)"
                  stroke={C.cyanDim}
                  strokeWidth="1.5"
                  opacity=".8"
                  filter="url(#gf)"
                />

                {/* Away endzone */}
                <rect x="50" y="30" width="82" height="360" fill={game.away.color} opacity=".28" />
                <rect x="50" y="30" width="82" height="360" fill="url(#ezPatA)" />
                <rect
                  x="50"
                  y="30"
                  width="82"
                  height="360"
                  stroke={C.cyanDim}
                  strokeWidth=".5"
                  fill="none"
                />
                <text
                  x="91"
                  y="210"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={game.away.colorAlt}
                  opacity=".55"
                  fontSize="36"
                  fontFamily="'Barlow Condensed'"
                  fontWeight="800"
                  letterSpacing="16"
                  transform="rotate(-90 91 210)"
                  style={{ filter: `drop-shadow(0 0 5px ${game.away.color})` }}
                >
                  {game.away.endzoneName}
                </text>

                {/* Home endzone */}
                <rect x="868" y="30" width="82" height="360" fill={game.home.color} opacity=".28" />
                <rect x="868" y="30" width="82" height="360" fill="url(#ezPatH)" />
                <rect
                  x="868"
                  y="30"
                  width="82"
                  height="360"
                  stroke={C.cyanDim}
                  strokeWidth=".5"
                  fill="none"
                />
                <text
                  x="909"
                  y="210"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={game.home.colorAlt}
                  opacity=".55"
                  fontSize="44"
                  fontFamily="'Barlow Condensed'"
                  fontWeight="800"
                  letterSpacing="18"
                  transform="rotate(90 909 210)"
                  style={{ filter: `drop-shadow(0 0 5px ${game.home.color})` }}
                >
                  {game.home.endzoneName}
                </text>

                {/* Goal line glows */}
                <line
                  x1="132"
                  y1="30"
                  x2="132"
                  y2="390"
                  stroke={game.away.colorAlt}
                  strokeWidth="2"
                  opacity=".2"
                  style={{ filter: `drop-shadow(0 0 4px ${game.away.colorAlt}40)` }}
                />
                <line
                  x1="868"
                  y1="30"
                  x2="868"
                  y2="390"
                  stroke={game.home.colorAlt || game.home.color}
                  strokeWidth="2"
                  opacity=".2"
                  style={{ filter: `drop-shadow(0 0 4px ${game.home.color}40)` }}
                />

                {/* Drive progress zone */}
                {game.currentDrive &&
                  (() => {
                    const startX = fieldPctToSvgX(driveStartPct);
                    const endX = fieldPctToSvgX(ballPct);
                    const leftX = Math.min(startX, endX);
                    const width = Math.abs(endX - startX);
                    const isBackwards = possIsAway
                      ? ballPct < driveStartPct
                      : ballPct > driveStartPct;
                    const zoneColor = isBackwards ? C.red : possTeam.colorAlt || possTeam.color;
                    return (
                      <g>
                        <rect
                          x={leftX}
                          y="30"
                          width={width}
                          height="360"
                          fill={zoneColor}
                          opacity={isBackwards ? '.08' : '.06'}
                        />
                        <line
                          x1={startX}
                          y1="30"
                          x2={startX}
                          y2="390"
                          stroke={zoneColor}
                          strokeWidth="1"
                          strokeDasharray="3 6"
                          opacity=".25"
                        />
                        <text
                          x={startX}
                          y="46"
                          textAnchor="middle"
                          fill={zoneColor}
                          fontSize="8"
                          fontFamily="'Orbitron'"
                          fontWeight="600"
                          opacity=".4"
                        >
                          DRIVE
                        </text>
                      </g>
                    );
                  })()}

                {/* Yard lines */}
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => {
                  const x = 132 + (yd / 100) * 736;
                  const dn = yd <= 50 ? yd : 100 - yd;
                  return (
                    <g key={yd}>
                      <line
                        x1={x}
                        y1="30"
                        x2={x}
                        y2="390"
                        stroke={C.cyan}
                        strokeWidth=".6"
                        opacity=".12"
                      />
                      <text
                        x={x}
                        y="24"
                        textAnchor="middle"
                        fill={C.cyanDim}
                        fontSize="11"
                        fontFamily="'Share Tech Mono'"
                        opacity=".5"
                      >
                        {dn}
                      </text>
                      <text
                        x={x}
                        y="406"
                        textAnchor="middle"
                        fill={C.cyanDim}
                        fontSize="11"
                        fontFamily="'Share Tech Mono'"
                        opacity=".5"
                      >
                        {dn}
                      </text>
                    </g>
                  );
                })}
                {[5, 15, 25, 35, 45, 55, 65, 75, 85, 95].map((yd) => (
                  <line
                    key={yd}
                    x1={132 + (yd / 100) * 736}
                    y1="30"
                    x2={132 + (yd / 100) * 736}
                    y2="390"
                    stroke={C.cyan}
                    strokeWidth=".3"
                    opacity=".06"
                  />
                ))}

                {/* Hash marks */}
                {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((yd) => {
                  const x = 132 + (yd / 100) * 736;
                  return (
                    <g key={`h${yd}`}>
                      <line
                        x1={x - 4}
                        y1="155"
                        x2={x + 4}
                        y2="155"
                        stroke={C.cyan}
                        strokeWidth=".5"
                        opacity=".1"
                      />
                      <line
                        x1={x - 4}
                        y1="265"
                        x2={x + 4}
                        y2="265"
                        stroke={C.cyan}
                        strokeWidth=".5"
                        opacity=".1"
                      />
                    </g>
                  );
                })}

                {/* LOS + First down */}
                {!isFinal && game.yardline > 0 && (
                  <>
                    {(() => {
                      const x = fieldPctToSvgX(ballPct);
                      return (
                        <line
                          x1={x}
                          y1="30"
                          x2={x}
                          y2="390"
                          stroke="#3b82f6"
                          strokeWidth="2.5"
                          opacity=".45"
                        />
                      );
                    })()}
                    {(() => {
                      const x = fieldPctToSvgX(firstDownPct);
                      return (
                        <line
                          x1={x}
                          y1="30"
                          x2={x}
                          y2="390"
                          stroke={C.amber}
                          strokeWidth="2"
                          strokeDasharray="8 5"
                          opacity=".45"
                        />
                      );
                    })()}
                  </>
                )}

                {/* Play animation */}
                {showAnim && game.lastPlay && (
                  <PlayAnimation
                    key={animKey}
                    play={game.lastPlay}
                    possIsAway={possIsAway}
                    awayAbbr={game.away.abbr}
                  />
                )}

                {/* Ball marker */}
                {!isFinal &&
                  game.yardline > 0 &&
                  (() => {
                    const bx = fieldPctToSvgX(ballPct),
                      by = 210;
                    return (
                      <g>
                        <circle cx={bx} cy={by} r="28" fill="url(#ballG)" />
                        <circle
                          cx={bx}
                          cy={by}
                          r="12"
                          fill="none"
                          stroke={possTeam.colorAlt || possTeam.color}
                          strokeWidth="1.5"
                          opacity=".3"
                        />
                        <circle cx={bx} cy={by} r="7" fill={C.amber} filter="url(#gf)" opacity=".9">
                          <animate
                            attributeName="r"
                            values="6;8;6"
                            dur="2.5s"
                            repeatCount="indefinite"
                          />
                        </circle>
                        <circle cx={bx} cy={by} r="2.5" fill="#fff" opacity=".8" />
                        <line
                          x1={bx}
                          y1="30"
                          x2={bx}
                          y2="52"
                          stroke={C.amber}
                          strokeWidth="1"
                          opacity=".3"
                          strokeDasharray="2 2"
                        />
                        <rect
                          x={bx - 34}
                          y="32"
                          width="68"
                          height="18"
                          rx="2"
                          fill="rgba(7,11,20,.88)"
                          stroke={C.amberBorder}
                          strokeWidth="1"
                        />
                        <text
                          x={bx}
                          y="44"
                          textAnchor="middle"
                          fill={C.amber}
                          fontSize="9"
                          fontFamily="'Orbitron'"
                          fontWeight="700"
                        >
                          {game.side} {game.yardline}
                        </text>
                      </g>
                    );
                  })()}

                <text x="55" y="416" fill={C.textDim} fontSize="9" fontFamily="'Share Tech Mono'">
                  ◂ {game.away.abbr} END ZONE
                </text>
                <text
                  x="945"
                  y="416"
                  textAnchor="end"
                  fill={C.textDim}
                  fontSize="9"
                  fontFamily="'Share Tech Mono'"
                >
                  {game.home.abbr} END ZONE ▸
                </text>
                <text
                  x="500"
                  y="14"
                  textAnchor="middle"
                  fill={C.textDim}
                  fontSize="9"
                  fontFamily="'Share Tech Mono'"
                  letterSpacing="4"
                  style={{ filter: 'none' }}
                >
                  {game.venue.toUpperCase()}
                </text>
              </svg>
            </div>
          </div>
        </div>

        {/* QUARTER SCORES */}
        <div className="hud-panel" style={{ padding: '10px 20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', width: '35%' }}>
                  <span className="hud-label">TEAM</span>
                </th>
                {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                  <th key={q} style={{ textAlign: 'center', padding: '4px 8px' }}>
                    <span className="hud-label">{q}</span>
                  </th>
                ))}
                <th style={{ textAlign: 'center', padding: '4px 8px', width: '12%' }}>
                  <span className="hud-label">TOTAL</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[game.away, game.home].map((t) => {
                const isP = game.possession === t.abbr;
                const opp = t === game.away ? game.home : game.away;
                return (
                  <tr
                    key={t.abbr}
                    style={{
                      borderTop: `1px solid ${C.panelBorder}`,
                      background: isP ? 'rgba(255,182,18,0.02)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <TeamBadge team={t} size={24} hasPossession={isP} />
                        <span
                          style={{
                            fontFamily: "'Barlow Condensed'",
                            fontWeight: 700,
                            fontSize: 15,
                            color: C.textBright,
                            letterSpacing: '.03em',
                          }}
                        >
                          {t.full}
                        </span>
                        {isP && (
                          <span
                            style={{
                              fontFamily: "'Orbitron'",
                              fontSize: 8,
                              fontWeight: 600,
                              letterSpacing: '.12em',
                              color: C.amber,
                              padding: '1px 6px',
                              border: `1px solid ${C.amberBorder}`,
                              background: 'rgba(255,182,18,.06)',
                            }}
                          >
                            POSS
                          </span>
                        )}
                      </div>
                    </td>
                    {t.scores.map((s, i) => (
                      <td
                        key={i}
                        style={{
                          textAlign: 'center',
                          padding: '6px 8px',
                          fontFamily: "'Orbitron'",
                          fontSize: 14,
                          fontWeight: 600,
                          color: s === null ? C.textMuted : C.text,
                        }}
                      >
                        {s ?? '\u2014'}
                      </td>
                    ))}
                    <td
                      style={{
                        textAlign: 'center',
                        padding: '6px 8px',
                        fontFamily: "'Orbitron'",
                        fontSize: 20,
                        fontWeight: 800,
                        color: t.score > opp.score ? C.cyan : C.textDim,
                        textShadow: t.score > opp.score ? `0 0 8px ${C.cyanGlow}` : 'none',
                      }}
                    >
                      {t.score}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* TABS */}
        <div>
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { key: 'plays', label: 'MISSION LOG' },
              { key: 'stats', label: 'TEAM METRICS' },
              { key: 'leaders', label: 'PERSONNEL' },
              { key: 'scoring', label: 'SCORING' },
              { key: 'fantasy', label: 'FANTASY' },
            ].map((tab) => (
              <button
                key={tab.key}
                className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="hud-panel" style={{ borderTopLeftRadius: 0, minHeight: 320 }}>
            {activeTab === 'plays' && <PlaysPanel plays={game.plays} />}
            {activeTab === 'stats' && game.teamStats && (
              <TeamStatsPanel stats={game.teamStats} away={game.away} home={game.home} />
            )}
            {activeTab === 'leaders' && game.leaders && (
              <LeadersPanel leaders={game.leaders} away={game.away} home={game.home} />
            )}
            {activeTab === 'scoring' && (
              <ScoringPanel scoring={game.scoring} away={game.away} home={game.home} />
            )}
            {activeTab === 'fantasy' && game.fantasy && (
              <FantasyPanel
                fantasy={game.fantasy}
                away={game.away}
                home={game.home}
                playerSeasonStats={game.playerSeasonStats}
              />
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

// ═══════════════════════════════════════════════════════════════
// PLAY ANIMATION (exact v11 port)
// ═══════════════════════════════════════════════════════════════
function PlayAnimation({
  play,
  possIsAway,
  awayAbbr,
}: {
  play: LastPlay;
  possIsAway: boolean;
  awayAbbr: string;
}) {
  const fromPct = yardToFieldPct(play.fromYardline, play.fromSide, awayAbbr);
  const toPct = yardToFieldPct(play.toYardline, play.toSide, awayAbbr);
  const fromX = fieldPctToSvgX(fromPct);
  const toX = fieldPctToSvgX(toPct);
  const centerY = 210;
  const dirOff = play.direction === 'left' ? -50 : play.direction === 'right' ? 50 : 0;
  const toY = centerY + dirOff;

  const FirstDownCelebration = () => {
    if (!play.isFirstDown || !play.isComplete) return null;
    const newFdPct = toPct + (possIsAway ? 10 : -10);
    const fdX = fieldPctToSvgX(Math.max(0, Math.min(100, newFdPct)));
    return (
      <g>
        <line
          x1={fdX}
          y1="30"
          x2={fdX}
          y2="390"
          stroke={C.green}
          strokeWidth="3"
          opacity="0"
          style={{ animation: 'firstDownPulse 1.5s ease 1.3s forwards' }}
        />
        <line
          x1={fdX}
          y1="30"
          x2={fdX}
          y2="390"
          stroke={C.amber}
          strokeWidth="2"
          strokeDasharray="8 4"
          opacity="0"
          style={{
            animation:
              'firstDownSweep 1s linear 1.3s forwards, firstDownPulse 1.5s ease 1.3s forwards',
          }}
        />
        <g opacity="0" style={{ animation: 'slideUp .3s ease 1.5s forwards' }}>
          <rect
            x={fdX - 28}
            y="32"
            width="56"
            height="18"
            rx="2"
            fill="rgba(0,230,118,.12)"
            stroke={C.green}
            strokeWidth="1"
          />
          <text
            x={fdX}
            y="44"
            textAnchor="middle"
            fill={C.green}
            fontSize="8"
            fontFamily="'Orbitron'"
            fontWeight="700"
          >
            1ST DOWN
          </text>
        </g>
      </g>
    );
  };

  if (play.type === 'pass') {
    const arcH = Math.min(120, Math.max(30, (play.airYards || 10) * 3));
    const midX = (fromX + toX) / 2;
    const midY = Math.min(centerY, toY) - arcH;
    const pathD = `M ${fromX},${centerY} Q ${midX},${midY} ${toX},${toY}`;
    const complete = play.isComplete;
    return (
      <g>
        <path
          d={pathD}
          fill="none"
          stroke={complete ? C.amber : C.red}
          strokeWidth="2"
          strokeDasharray="4 6"
          opacity=".5"
          strokeDashoffset="1000"
          style={{ animation: 'trailDraw 1.2s ease-out forwards, trailFade 2.5s ease forwards' }}
        />
        <circle
          r="4"
          fill={complete ? C.amber : C.red}
          style={{
            offsetPath: `path('${pathD}')`,
            animation: 'ballTravel 1.2s ease-out forwards',
            filter: `drop-shadow(0 0 6px ${complete ? C.amberGlow : 'rgba(255,59,79,0.4)'})`,
          }}
        />
        {complete ? (
          <g>
            <circle
              cx={toX}
              cy={toY}
              r="4"
              fill="none"
              stroke={C.green}
              strokeWidth="2"
              opacity="0"
              style={{ animation: 'catchFlash .6s ease-out 1.1s forwards' }}
            />
            <text
              x={toX}
              y={toY - 32}
              textAnchor="middle"
              fill={C.green}
              fontSize="11"
              fontFamily="'Orbitron'"
              fontWeight="700"
              opacity="0"
              style={{ animation: 'slideUp .3s ease 1.3s forwards' }}
            >
              +{play.yardsGained} YDS
            </text>
            {play.receiver && (
              <g opacity="0" style={{ animation: 'slideUp .3s ease 1.5s forwards' }}>
                <rect
                  x={toX - 68}
                  y={toY + 10}
                  width="136"
                  height="36"
                  rx="2"
                  fill="rgba(7,11,20,.93)"
                  stroke={C.panelBorder}
                  strokeWidth="1"
                />
                <text
                  x={toX}
                  y={toY + 26}
                  textAnchor="middle"
                  fill={C.textBright}
                  fontSize="11"
                  fontFamily="'Barlow Condensed'"
                  fontWeight="700"
                >
                  #{play.receiver.number} {play.receiver.name}
                </text>
                <text
                  x={toX}
                  y={toY + 40}
                  textAnchor="middle"
                  fill={C.textDim}
                  fontSize="9"
                  fontFamily="'Share Tech Mono'"
                >
                  {play.receiver.yards} YDS · {play.receiver.tds} TD TODAY
                </text>
              </g>
            )}
          </g>
        ) : (
          <g>
            <g opacity="0" style={{ animation: 'slideUp .3s ease 1.1s forwards' }}>
              <line
                x1={toX - 8}
                y1={toY - 8}
                x2={toX + 8}
                y2={toY + 8}
                stroke={C.red}
                strokeWidth="3"
                strokeLinecap="round"
              />
              <line
                x1={toX + 8}
                y1={toY - 8}
                x2={toX - 8}
                y2={toY + 8}
                stroke={C.red}
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
            <text
              x={toX}
              y={toY - 20}
              textAnchor="middle"
              fill={C.red}
              fontSize="11"
              fontFamily="'Orbitron'"
              fontWeight="700"
              opacity="0"
              style={{ animation: 'slideUp .3s ease 1.3s forwards' }}
            >
              INCOMPLETE
            </text>
          </g>
        )}
        <FirstDownCelebration />
      </g>
    );
  }

  if (play.type === 'rush') {
    const juke = play.direction === 'left' ? -35 : play.direction === 'right' ? 35 : 15;
    const m1X = fromX + (toX - fromX) * 0.3,
      m1Y = centerY + juke;
    const m2X = fromX + (toX - fromX) * 0.65,
      m2Y = centerY + juke * 0.4;
    const pathD = `M ${fromX},${centerY} C ${m1X},${m1Y} ${m2X},${m2Y} ${toX},${toY}`;
    return (
      <g>
        <path
          d={pathD}
          fill="none"
          stroke={C.cyan}
          strokeWidth="2"
          strokeDasharray="3 5"
          opacity=".4"
          strokeDashoffset="800"
          style={{ animation: 'trailDraw 0.8s ease-out forwards, trailFade 2s ease forwards' }}
        />
        <circle
          r="4"
          fill={C.cyan}
          style={{
            offsetPath: `path('${pathD}')`,
            animation: 'ballTravel 0.8s ease-out forwards',
            filter: `drop-shadow(0 0 6px ${C.cyanGlow})`,
          }}
        />
        <text
          x={toX}
          y={toY - 26}
          textAnchor="middle"
          fill={C.cyan}
          fontSize="11"
          fontFamily="'Orbitron'"
          fontWeight="700"
          opacity="0"
          style={{ animation: 'slideUp .3s ease 0.9s forwards' }}
        >
          +{play.yardsGained} YDS
        </text>
        <FirstDownCelebration />
      </g>
    );
  }

  if (play.type === 'turnover') {
    const pathD = `M ${fromX},${centerY} L ${toX},${toY}`;
    return (
      <g>
        <rect
          x="50"
          y="30"
          width="900"
          height="360"
          fill={C.red}
          opacity="0"
          style={{ animation: 'turnoverFlash .8s ease forwards' }}
        />
        <path
          d={pathD}
          fill="none"
          stroke={C.red}
          strokeWidth="2.5"
          strokeDasharray="6 4"
          opacity=".6"
          strokeDashoffset="600"
          style={{ animation: 'trailDraw 0.6s ease-out forwards' }}
        />
        <circle
          cx={toX}
          cy={toY}
          r="8"
          fill={C.red}
          opacity="0"
          style={{ animation: 'slideUp .3s ease 0.6s forwards' }}
        />
        <circle
          cx={toX}
          cy={toY}
          r="5"
          fill="none"
          stroke={C.red}
          strokeWidth="1.5"
          opacity="0"
          style={{ animation: 'catchFlash .6s ease-out 0.7s forwards' }}
        />
        <g opacity="0" style={{ animation: 'slideUp .3s ease 0.7s forwards' }}>
          <text
            x={(fromX + toX) / 2}
            y={Math.min(centerY, toY) - 42}
            textAnchor="middle"
            fill={C.red}
            fontSize="10"
            fontFamily="'Orbitron'"
            fontWeight="700"
            opacity=".7"
          >
            {play.turnoverBy || ''}
          </text>
          <text
            x={(fromX + toX) / 2}
            y={Math.min(centerY, toY) - 28}
            textAnchor="middle"
            fill={C.red}
            fontSize="12"
            fontFamily="'Orbitron'"
            fontWeight="800"
          >
            TURNOVER
          </text>
        </g>
      </g>
    );
  }

  if (play.type === 'kick') {
    const midX = (fromX + toX) / 2;
    const pathD = `M ${fromX},${centerY} Q ${midX},${centerY - 140} ${toX},${toY}`;
    return (
      <g>
        <path
          d={pathD}
          fill="none"
          stroke="#8b9bb4"
          strokeWidth="1.5"
          strokeDasharray="3 5"
          opacity=".3"
          strokeDashoffset="1000"
          style={{ animation: 'trailDraw 1.5s ease-out forwards, trailFade 3s ease forwards' }}
        />
        <circle
          r="3"
          fill="#8b9bb4"
          style={{
            offsetPath: `path('${pathD}')`,
            animation: 'ballTravel 1.5s ease-in-out forwards',
          }}
        />
        {play.yardsGained > 0 && (
          <text
            x={toX}
            y={toY - 20}
            textAnchor="middle"
            fill="#8b9bb4"
            fontSize="10"
            fontFamily="'Orbitron'"
            fontWeight="600"
            opacity="0"
            style={{ animation: 'slideUp .3s ease 1.6s forwards' }}
          >
            {play.yardsGained} YDS
          </text>
        )}
      </g>
    );
  }

  if (play.type === 'fieldgoal') {
    const goalLineX = possIsAway ? 868 : 132;
    const uprightX = possIsAway ? 945 : 55;
    const isMade = play.fgResult === 'made';
    const missDir = play.fgResult;
    const isShort = missDir === 'short';
    const endX = isShort ? goalLineX : uprightX;
    const veerY = missDir === 'wide_left' ? -80 : missDir === 'wide_right' ? 80 : 0;
    const endY = centerY + veerY;
    const ctrlX = (fromX + endX) / 2;
    const pathD = `M ${fromX},${centerY} Q ${ctrlX},${centerY - 160} ${endX},${endY}`;
    const resultColor = isMade ? C.green : C.red;
    const resultText = isMade
      ? 'GOOD'
      : missDir === 'wide_left'
        ? 'WIDE LEFT'
        : missDir === 'wide_right'
          ? 'WIDE RIGHT'
          : isShort
            ? 'NO GOOD · SHORT'
            : missDir === 'blocked'
              ? 'BLOCKED'
              : 'NO GOOD';
    return (
      <g>
        <path
          d={pathD}
          fill="none"
          stroke={resultColor}
          strokeWidth="2"
          strokeDasharray="4 6"
          opacity=".4"
          strokeDashoffset="1000"
          style={{ animation: 'trailDraw 1.8s ease-out forwards, trailFade 3.5s ease forwards' }}
        />
        <circle
          r="4"
          fill={resultColor}
          style={{
            offsetPath: `path('${pathD}')`,
            animation: 'ballTravel 1.8s ease-in-out forwards',
            filter: `drop-shadow(0 0 6px ${resultColor}60)`,
          }}
        />
        <text
          x={endX}
          y={endY - 24}
          textAnchor="middle"
          fill={resultColor}
          fontSize="13"
          fontFamily="'Orbitron'"
          fontWeight="800"
          opacity="0"
          style={{ animation: 'slideUp .3s ease 1.9s forwards' }}
        >
          {resultText}
        </text>
        {isMade && play.fgDistance && (
          <text
            x={endX}
            y={endY - 10}
            textAnchor="middle"
            fill={C.textDim}
            fontSize="9"
            fontFamily="'Orbitron'"
            fontWeight="600"
            opacity="0"
            style={{ animation: 'slideUp .3s ease 2.1s forwards' }}
          >
            {play.fgDistance} YDS
          </text>
        )}
      </g>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// WIN PROBABILITY SPARKLINE (exact v11 port)
// ═══════════════════════════════════════════════════════════════
function WinProbSparkline({
  data,
  isAway,
  color,
  currentPct,
  gameTiming,
}: {
  data: WpPoint[];
  isAway: boolean;
  color: string;
  currentPct: number;
  gameTiming: { quarter: number; clockMin: number; isOT: boolean };
}) {
  const W = 160,
    H = 32,
    pad = 2;
  const usableW = W - pad * 2;
  const totalGameMin = gameTiming.isOT ? 70 : 60;
  const qTicks = gameTiming.isOT ? [15 / 70, 30 / 70, 45 / 70, 60 / 70] : [0.25, 0.5, 0.75];

  const pts = data.map((d) => {
    const wp = typeof d === 'number' ? d : d.wp;
    const gameMin = typeof d === 'number' ? 0 : d.gameMin || 0;
    const val = isAway ? wp : 100 - wp;
    return {
      x: pad + (gameMin / totalGameMin) * usableW,
      y: pad + ((100 - val) / 100) * (H - pad * 2),
    };
  });

  if (pts.length === 0) return null;
  const path = 'M ' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ');
  const lastPt = pts[pts.length - 1]!;
  const area = path + ` L ${lastPt.x.toFixed(1)},${H} L ${pts[0]!.x.toFixed(1)},${H} Z`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, display: 'block' }}>
        <line
          x1={pad}
          y1={H / 2}
          x2={W - pad}
          y2={H / 2}
          stroke={C.cyanDim}
          strokeWidth=".5"
          opacity=".12"
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
        <path d={area} fill={color} opacity=".08" />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          opacity=".7"
          pathLength={500}
          strokeDasharray={500}
          strokeDashoffset={0}
          style={{ animation: 'sparkDraw 1.2s ease-out' }}
        />
        <circle cx={lastPt.x} cy={lastPt.y} r="3" fill={color} opacity=".9">
          <animate attributeName="r" values="2.5;3.5;2.5" dur="3s" repeatCount="indefinite" />
        </circle>
      </svg>
      <span
        style={{
          fontFamily: "'Orbitron'",
          fontSize: 13,
          fontWeight: 800,
          color: currentPct > 50 ? color : C.textDim,
          minWidth: 36,
          textShadow: currentPct > 60 ? `0 0 6px ${color}40` : 'none',
        }}
      >
        {currentPct}%
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ATOMS (exact v11 port)
// ═══════════════════════════════════════════════════════════════
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
          fontFamily: "'Orbitron'",
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

function CornerTicks() {
  return (
    <>
      {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((p) => {
        const s: Record<string, any> = { position: 'absolute', width: 8, height: 8, zIndex: 5 };
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

function TimeoutPips({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: 8,
            height: 4,
            borderRadius: 1,
            background: i <= count ? C.amber : 'rgba(255,255,255,.06)',
            boxShadow: i <= count ? `0 0 4px ${C.amber}50` : 'none',
          }}
        />
      ))}
    </div>
  );
}

function TeamBadge({
  team,
  hasPossession,
  size = 56,
}: {
  team: Team;
  hasPossession: boolean;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${team.color}60, ${team.color}20, transparent)`,
        border: hasPossession ? `2px solid ${C.amber}60` : `1px solid ${team.color}50`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: hasPossession
          ? `0 0 16px ${C.amberGlow}, 0 0 4px ${team.color}40`
          : `0 0 8px ${team.color}20`,
        transition: 'all .5s ease',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "'Barlow Condensed'",
          fontWeight: 700,
          fontSize: size * 0.34,
          color: team.colorAlt || '#fff',
          letterSpacing: '.06em',
          textShadow: `0 0 6px ${team.color}`,
        }}
      >
        {team.abbr}
      </span>
    </div>
  );
}

function ScoreDigit({ value, isWinning }: { value: number; isWinning: boolean }) {
  return (
    <div
      style={{
        fontFamily: "'Barlow Condensed'",
        fontWeight: 700,
        fontSize: 54,
        color: isWinning ? C.textBright : C.textDim,
        width: 88,
        textAlign: 'center',
        padding: '4px 0',
        letterSpacing: '-.02em',
        lineHeight: 1,
        textShadow: isWinning ? `0 0 14px ${C.cyanGlow}` : 'none',
      }}
    >
      {value}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.textDim, letterSpacing: '.1em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Orbitron'", fontSize: 14, fontWeight: 700, color: C.textBright }}>
        {value}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WEATHER LAYER (exact v11 port)
// ═══════════════════════════════════════════════════════════════
function WeatherLayer({
  condition,
  wind,
  venue,
}: {
  condition: string;
  wind: string;
  venue: string;
}) {
  const windStr = wind || '';
  const speedMatch = windStr.match(/(\d+)/);
  const windSpeed = speedMatch ? parseInt(speedMatch[1]!) : 0;
  const isEast = windStr.includes('E');
  const isWest = windStr.includes('W');
  const hDrift = ((isEast ? 1 : 0) + (isWest ? -1 : 0)) * Math.min(windSpeed * 4, 40);

  const venueLower = (venue || '').toLowerCase();
  const isDomed =
    venueLower.includes('dome') ||
    venueLower.includes('sofi') ||
    venueLower.includes('allegiant') ||
    venueLower.includes('at&t') ||
    venueLower.includes('mercedes');
  if (isDomed) return null;

  const isRain = condition.toLowerCase().includes('rain');
  const isSnow = condition.toLowerCase().includes('snow');
  const count = isRain ? 60 : isSnow ? 55 : 0;
  if (count === 0 && !condition.includes('Cloud')) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 3,
      }}
    >
      {(condition.includes('Cloud') || isRain) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: isRain
              ? 'linear-gradient(180deg,rgba(30,50,80,.12) 0%,transparent 50%)'
              : 'linear-gradient(180deg,rgba(60,80,110,.06) 0%,transparent 30%)',
          }}
        />
      )}
      {Array.from({ length: count }, (_, i) => {
        const left = Math.random() * 110 - 5;
        const delay = Math.random() * 4;
        const dur = isSnow ? 3 + Math.random() * 3 : 0.8 + Math.random() * 1;
        const driftPx = hDrift + (Math.random() - 0.5) * 10;
        const size = isSnow ? 2 + Math.random() * 2.5 : 1.5;
        const height = isSnow ? size : 8 + Math.random() * 4;
        return (
          <div
            key={i}
            style={
              {
                position: 'absolute',
                left: `${left}%`,
                top: '-4%',
                width: size,
                height: height,
                borderRadius: isSnow ? '50%' : '0',
                background: isSnow ? 'rgba(200,220,255,.4)' : 'rgba(100,170,230,.3)',
                animation: `${isSnow ? 'snow' : 'rain'} ${dur}s linear ${delay}s infinite`,
                '--drift': `${driftPx}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB PANELS (exact v11 port)
// ═══════════════════════════════════════════════════════════════
function PlaysPanel({ plays }: { plays: Play[] }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          padding: '10px 20px',
          borderBottom: `1px solid rgba(0,229,255,.05)`,
        }}
      >
        <span className="hud-label" style={{ width: 32 }}>
          Q
        </span>
        <span className="hud-label" style={{ width: 55 }}>
          TIME
        </span>
        <span className="hud-label" style={{ width: 80 }}>
          DOWN
        </span>
        <span className="hud-label" style={{ flex: 1 }}>
          EVENT
        </span>
        <span className="hud-label" style={{ width: 55, textAlign: 'right' }}>
          EPA
        </span>
      </div>
      {[...plays].reverse().map((p, i) => (
        <div key={p.id} className="play-row" style={{ animationDelay: `${i * 50}ms` }}>
          <span
            style={{
              width: 32,
              fontFamily: "'Orbitron'",
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '.08em',
              color: C.cyanDim,
              opacity: p.type === 'info' ? 0 : 1,
            }}
          >
            Q{p.q}
          </span>
          <span style={{ width: 55, fontSize: 12, color: C.textDim }}>{p.clock}</span>
          <span style={{ width: 80, fontSize: 12, color: C.textDim }}>{p.down}</span>
          <span
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: 1.5,
              color: p.type === 'turnover' ? C.red : p.type === 'score' ? C.green : C.text,
            }}
          >
            {p.team && (
              <span
                style={{
                  fontFamily: "'Barlow Condensed'",
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '.06em',
                  color: C.textDim,
                  marginRight: 8,
                }}
              >
                {p.team}
              </span>
            )}
            {p.text}
          </span>
          <span
            style={{
              width: 55,
              textAlign: 'right',
              fontSize: 12,
              fontFamily: "'Orbitron'",
              fontWeight: 600,
              color: p.epa > 0.5 ? C.green : p.epa < -0.5 ? C.red : C.textDim,
            }}
          >
            {p.epa > 0 ? '+' : ''}
            {p.epa !== 0 ? p.epa.toFixed(1) : '\u2014'}
          </span>
        </div>
      ))}
    </div>
  );
}

function TeamStatsPanel({
  stats,
  away,
  home,
}: {
  stats: { away: TeamStatLine; home: TeamStatLine };
  away: Team;
  home: Team;
}) {
  const rows = [
    { label: 'TOTAL YARDS', a: stats.away.totalYards, h: stats.home.totalYards, max: 500 },
    { label: 'PASSING', a: stats.away.passingYards, h: stats.home.passingYards, max: 400 },
    { label: 'RUSHING', a: stats.away.rushingYards, h: stats.home.rushingYards, max: 250 },
    { label: '1ST DOWNS', a: stats.away.firstDowns, h: stats.home.firstDowns, max: 30 },
    { label: '3RD DOWN', a: stats.away.thirdDown as any, h: stats.home.thirdDown as any },
    { label: 'SACKS', a: stats.away.sacks, h: stats.home.sacks },
    { label: 'TURNOVERS', a: stats.away.turnovers, h: stats.home.turnovers },
    { label: 'POSSESSION', a: stats.away.top, h: stats.home.top },
    { label: 'PENALTIES', a: stats.away.penalties, h: stats.home.penalties },
  ];
  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          display: 'flex',
          padding: '0 20px 10px',
          borderBottom: `1px solid rgba(0,229,255,.05)`,
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <TeamBadge team={away} size={22} hasPossession={false} />
          <span className="hud-label" style={{ color: C.text }}>
            {away.abbr}
          </span>
        </div>
        <div style={{ width: 140 }} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <span className="hud-label" style={{ color: C.text }}>
            {home.abbr}
          </span>
          <TeamBadge team={home} size={22} hasPossession={false} />
        </div>
      </div>
      {rows.map((r, i) => {
        const aN = typeof r.a === 'number' ? r.a : null;
        const hN = typeof r.h === 'number' ? r.h : null;
        const aB = aN !== null && hN !== null && aN > hN;
        const hB = hN !== null && aN !== null && hN > aN;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 20px',
              borderBottom: `1px solid rgba(0,229,255,.02)`,
            }}
          >
            <div style={{ flex: 1 }}>
              <span
                style={{
                  fontFamily: "'Orbitron'",
                  fontSize: 14,
                  fontWeight: 700,
                  color: aB ? C.cyan : C.textDim,
                  textShadow: aB ? `0 0 6px ${C.cyanGlow}` : 'none',
                }}
              >
                {r.a}
              </span>
              {r.max && aN != null && (
                <div className="stat-bar">
                  <div
                    style={{
                      height: '100%',
                      width: `${(aN / r.max) * 100}%`,
                      background: aB
                        ? `linear-gradient(90deg,${C.cyan}60,${C.cyan}20)`
                        : 'rgba(255,255,255,.06)',
                      transition: 'width .6s',
                    }}
                  />
                </div>
              )}
            </div>
            <div style={{ width: 140, textAlign: 'center' }}>
              <span className="hud-label">{r.label}</span>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <span
                style={{
                  fontFamily: "'Orbitron'",
                  fontSize: 14,
                  fontWeight: 700,
                  color: hB ? C.cyan : C.textDim,
                  textShadow: hB ? `0 0 6px ${C.cyanGlow}` : 'none',
                }}
              >
                {r.h}
              </span>
              {r.max && hN != null && (
                <div className="stat-bar">
                  <div
                    style={{
                      height: '100%',
                      width: `${(hN / r.max) * 100}%`,
                      marginLeft: 'auto',
                      background: hB
                        ? `linear-gradient(270deg,${C.cyan}60,${C.cyan}20)`
                        : 'rgba(255,255,255,.06)',
                      transition: 'width .6s',
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadersPanel({
  leaders,
  away,
  home,
}: {
  leaders: { away: LeaderSet; home: LeaderSet };
  away: Team;
  home: Team;
}) {
  const cats: (keyof LeaderSet)[] = ['passing', 'rushing', 'receiving'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {[
        { team: away, data: leaders.away },
        { team: home, data: leaders.home },
      ].map(({ team, data }, idx) => (
        <div
          key={team.abbr}
          style={{ padding: 20, borderRight: idx === 0 ? `1px solid rgba(0,229,255,.05)` : 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <TeamBadge team={team} size={26} hasPossession={false} />
            <span
              style={{
                fontFamily: "'Barlow Condensed'",
                fontWeight: 700,
                fontSize: 16,
                color: C.textBright,
                letterSpacing: '.04em',
              }}
            >
              {team.full}
            </span>
          </div>
          {cats.map((cat) => (
            <div
              key={cat}
              style={{ padding: '10px 0', borderBottom: `1px solid rgba(0,229,255,.04)` }}
            >
              <span className="hud-label" style={{ display: 'block', marginBottom: 6 }}>
                {cat.toUpperCase()}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: `linear-gradient(135deg, ${team.color}40, ${team.color}15)`,
                    border: `1px solid ${C.panelBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={C.textDim}
                    strokeWidth="1.5"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21v-1a6 6 0 0 1 12 0v1" />
                  </svg>
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed'",
                      fontWeight: 600,
                      fontSize: 15,
                      color: C.textBright,
                    }}
                  >
                    {data[cat].name}
                  </div>
                  <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>{data[cat].line}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ScoringPanel({
  scoring,
  away,
  home,
}: {
  scoring: ScoringEntry[];
  away: Team;
  home: Team;
}) {
  let cq = 0;
  return (
    <div style={{ padding: '8px 0' }}>
      {scoring.map((s, i) => {
        const showQ = s.q !== cq;
        cq = s.q;
        const isA = s.team === away.abbr;
        return (
          <div key={i}>
            {showQ && (
              <div
                style={{ padding: '10px 20px 6px', borderBottom: `1px solid rgba(0,229,255,.05)` }}
              >
                <span className="hud-label">{s.q === 5 ? 'OVERTIME' : `QUARTER ${s.q}`}</span>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '10px 20px',
                borderBottom: `1px solid rgba(0,229,255,.02)`,
              }}
            >
              <TeamBadge team={isA ? away : home} size={22} hasPossession={false} />
              <span
                style={{
                  fontFamily: "'Barlow Condensed'",
                  fontWeight: 700,
                  fontSize: 12,
                  color: C.textDim,
                  width: 36,
                }}
              >
                {s.team}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: C.text }}>{s.desc}</span>
              <span
                style={{
                  fontFamily: "'Orbitron'",
                  fontSize: 14,
                  fontWeight: 700,
                  color: C.textBright,
                  letterSpacing: '.05em',
                }}
              >
                {s.away}–{s.home}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FantasyPanel({
  fantasy,
  away,
  home,
  playerSeasonStats,
}: {
  fantasy: { away: FantasyPlayer[]; home: FantasyPlayer[] };
  away: Team;
  home: Team;
  playerSeasonStats: Record<string, SeasonStats>;
}) {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const posOrder = ['QB', 'WR', 'RB', 'TE', 'K', 'DEF'];
  const posLabels: Record<string, string> = {
    QB: 'QUARTERBACK',
    WR: 'WIDE RECEIVER',
    RB: 'RUNNING BACK',
    TE: 'TIGHT END',
    K: 'KICKER',
    DEF: 'DEF / ST',
  };
  const stats = playerSeasonStats || {};

  const PlayerDrillDown = ({ name, todayPts }: { name: string; todayPts: number }) => {
    const s = stats[name];
    if (!s) return null;
    const maxPt = Math.max(...s.last5, todayPts);
    const sparkW = 120,
      sparkH = 28,
      pad = 2;
    const allPts = [...s.last5, todayPts];
    const sparkPts = allPts.map((v, i) => ({
      x: pad + (i / (allPts.length - 1)) * (sparkW - pad * 2),
      y: pad + ((maxPt - v) / (maxPt || 1)) * (sparkH - pad * 2),
    }));
    const sparkPath = 'M ' + sparkPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ');

    return (
      <div
        style={{
          padding: '10px 12px',
          margin: '4px 0 8px',
          background: 'rgba(0,229,255,.02)',
          border: `1px solid ${C.panelBorder}`,
          animation: 'slideUp .2s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: "'Orbitron'",
                fontSize: 10,
                fontWeight: 700,
                color: C.cyan,
                letterSpacing: '.08em',
              }}
            >
              {s.rank}
            </span>
            <span style={{ fontSize: 10, color: C.textDim, marginLeft: 8 }}>{s.gp} GP</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontFamily: "'Orbitron'", fontSize: 10, color: C.textDim }}>AVG </span>
            <span
              style={{
                fontFamily: "'Orbitron'",
                fontSize: 13,
                fontWeight: 700,
                color: C.textBright,
              }}
            >
              {s.avgPts}
            </span>
            <span
              style={{ fontFamily: "'Orbitron'", fontSize: 10, color: C.textDim, marginLeft: 12 }}
            >
              TOT{' '}
            </span>
            <span
              style={{
                fontFamily: "'Orbitron'",
                fontSize: 13,
                fontWeight: 700,
                color: C.textBright,
              }}
            >
              {s.totPts}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.text, marginBottom: 8, opacity: 0.8 }}>{s.line}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 9,
                color: C.textDim,
                letterSpacing: '.1em',
                marginBottom: 3,
                fontFamily: "'Orbitron'",
              }}
            >
              LAST 5 + TODAY
            </div>
            <svg
              viewBox={`0 0 ${sparkW} ${sparkH}`}
              style={{ width: sparkW, height: sparkH, display: 'block' }}
            >
              <line
                x1={pad}
                y1={sparkH / 2}
                x2={sparkW - pad}
                y2={sparkH / 2}
                stroke={C.cyanDim}
                strokeWidth=".3"
                opacity=".2"
                strokeDasharray="2 2"
              />
              <path
                d={sparkPath}
                fill="none"
                stroke={C.cyan}
                strokeWidth="1.5"
                opacity=".7"
                pathLength={500}
                strokeDasharray={500}
                strokeDashoffset={0}
                style={{ animation: 'sparkDraw 0.8s ease-out' }}
              />
              {sparkPts.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={i === sparkPts.length - 1 ? 3 : 2}
                  fill={i === sparkPts.length - 1 ? C.amber : C.cyan}
                  opacity={i === sparkPts.length - 1 ? 1 : 0.5}
                />
              ))}
            </svg>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
            {allPts.map((v, i) => (
              <div key={i} style={{ textAlign: 'center', minWidth: 28 }}>
                <div
                  style={{
                    fontFamily: "'Orbitron'",
                    fontSize: 10,
                    fontWeight: 700,
                    color: i === allPts.length - 1 ? C.amber : C.text,
                  }}
                >
                  {v}
                </div>
                <div style={{ fontSize: 7, color: C.textMuted, marginTop: 1 }}>
                  {i === allPts.length - 1 ? 'NOW' : `Wk${i + 1}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const TeamFantasy = ({ team, players }: { team: Team; players: FantasyPlayer[] }) => {
    const grouped: Record<string, FantasyPlayer[]> = {};
    posOrder.forEach((pos) => {
      const inPos = players.filter((p) => p.pos === pos);
      if (inPos.length > 0) grouped[pos] = inPos;
    });
    return (
      <div style={{ flex: 1, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <TeamBadge team={team} size={26} hasPossession={false} />
          <span
            style={{
              fontFamily: "'Barlow Condensed'",
              fontWeight: 700,
              fontSize: 16,
              color: C.textBright,
            }}
          >
            {team.name}
          </span>
        </div>
        {Object.entries(grouped).map(([pos, posPlayers]) => (
          <div key={pos} style={{ marginBottom: 8 }}>
            <div style={{ padding: '4px 0', borderBottom: `1px solid rgba(0,229,255,.08)` }}>
              <span
                style={{
                  fontFamily: "'Orbitron'",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '.15em',
                  color: C.cyanDim,
                }}
              >
                {posLabels[pos] || pos}
              </span>
            </div>
            {posPlayers.map((p, i) => {
              const isTop = p.pts >= 20;
              const isSelected = selectedPlayer === p.name;
              const hasSeason = !!stats[p.name];
              return (
                <div key={i}>
                  <div
                    onClick={() => hasSeason && setSelectedPlayer(isSelected ? null : p.name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 0 6px 8px',
                      borderBottom: `1px solid rgba(0,229,255,.02)`,
                      cursor: hasSeason ? 'pointer' : 'default',
                      background: isSelected ? 'rgba(0,229,255,.03)' : 'transparent',
                      transition: 'background .15s',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            fontFamily: "'Barlow Condensed'",
                            fontWeight: 600,
                            fontSize: 14,
                            color: isTop ? C.textBright : C.text,
                          }}
                        >
                          {p.name}
                        </span>
                        {hasSeason && (
                          <span
                            style={{
                              fontSize: 8,
                              color: isSelected ? C.cyan : C.textMuted,
                              transition: 'color .15s',
                            }}
                          >
                            {isSelected ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: C.text, marginTop: 1, opacity: 0.7 }}>
                        {p.breakdown}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: "'Orbitron'",
                        fontSize: 14,
                        fontWeight: 800,
                        minWidth: 48,
                        textAlign: 'right',
                        color: isTop ? C.amber : p.pts >= 10 ? C.textBright : C.text,
                        textShadow: isTop ? `0 0 6px ${C.amberGlow}` : 'none',
                      }}
                    >
                      {p.pts}
                    </span>
                  </div>
                  {isSelected && <PlayerDrillDown name={p.name} todayPts={p.pts} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          padding: '10px 20px',
          borderBottom: `1px solid rgba(0,229,255,.05)`,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span className="hud-label">FANTASY SCORING</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['PPR', 'HALF', 'STD'].map((f, i) => (
            <button
              key={f}
              style={{
                fontFamily: "'Orbitron'",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '.1em',
                padding: '3px 10px',
                cursor: 'pointer',
                background: i === 0 ? 'rgba(0,229,255,.08)' : 'transparent',
                border: `1px solid ${i === 0 ? C.cyanBorder : 'rgba(255,255,255,.04)'}`,
                color: i === 0 ? C.cyan : C.textDim,
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex' }}>
        <TeamFantasy team={away} players={fantasy.away} />
        <div style={{ width: 1, background: C.panelBorder }} />
        <TeamFantasy team={home} players={fantasy.home} />
      </div>
    </div>
  );
}
