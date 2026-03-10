'use client';

/**
 * Fantasy tab renderer.
 *
 * Notes:
 * - Uses per-player `pointsPpr|pointsHalfPpr|pointsStandard` from timeline frames.
 * - Position grouping follows SDK transform ordering (QB/WR/RB/TE/K/DEF).
 * - `breakdown` text is precomputed in the route layer to keep this component presentational.
 */

import { useMemo, useState } from 'react';
import type { FantasyRosterEntry, PlayerSeasonLine, HudTeam } from '@atlas/sdk/gridstream/types';
import { groupFantasyByPosition } from '@atlas/sdk/gridstream/transforms';
import { POSITION_LABELS } from '@atlas/sdk/gridstream/constants';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

type FantasyScoringView = 'PPR' | 'HALF' | 'STD';

interface FantasyPanelProps {
  away: HudTeam;
  home: HudTeam;
  fantasyAway: FantasyRosterEntry[];
  fantasyHome: FantasyRosterEntry[];
  playerSeasonStats: Record<string, PlayerSeasonLine>;
}

export function FantasyPanel({
  away,
  home,
  fantasyAway,
  fantasyHome,
  playerSeasonStats,
}: FantasyPanelProps) {
  const [selectedTeam, setSelectedTeam] = useState<'away' | 'home'>('away');
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [scoringView, setScoringView] = useState<FantasyScoringView>('PPR');

  const togglePlayer = (name: string) => {
    setSelectedPlayer((prev) => (prev === name ? null : name));
  };

  const activeTeam = selectedTeam === 'away' ? away : home;
  const activeRoster = selectedTeam === 'away' ? fantasyAway : fantasyHome;

  return (
    <div>
      {/* Header: label + scoring format toggles */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px 10px',
          borderBottom: `1px solid ${C.panelBorder}`,
          background: 'rgba(0,229,255,.02)',
        }}
      >
        <span className="hud-label" style={{ color: C.text, fontSize: 11 }}>
          FANTASY SCORING
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['PPR', 'HALF', 'STD'] as const).map((label) => {
            const active = scoringView === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setScoringView(label)}
                style={{
                  fontFamily: F.display,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '.1em',
                  minWidth: 52,
                  height: 26,
                  padding: '0 12px',
                  cursor: 'pointer',
                  background: active ? 'rgba(0,229,255,.14)' : 'rgba(0,229,255,.03)',
                  border: `1px solid ${active ? C.cyan : C.panelBorder}`,
                  color: active ? C.cyan : C.textDim,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Team selector tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${C.panelBorder}`,
        }}
      >
        {(['away', 'home'] as const).map((side) => {
          const team = side === 'away' ? away : home;
          const isActive = selectedTeam === side;
          return (
            <button
              key={side}
              onClick={() => {
                setSelectedTeam(side);
                setSelectedPlayer(null);
              }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 16px',
                background: isActive ? 'rgba(0,229,255,.04)' : 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${C.cyan}` : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <TeamBadge team={team} size={22} hasPossession={false} />
              <span
                style={{
                  fontFamily: F.body,
                  fontWeight: 700,
                  fontSize: 14,
                  color: isActive ? C.textBright : C.textDim,
                  transition: 'color 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {team.displayName}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected team roster */}
      <TeamColumn
        team={activeTeam}
        roster={activeRoster}
        seasonStats={playerSeasonStats}
        scoringView={scoringView}
        selectedPlayer={selectedPlayer}
        onToggle={togglePlayer}
      />
    </div>
  );
}

function TeamColumn({
  team,
  roster,
  seasonStats,
  scoringView,
  selectedPlayer,
  onToggle,
}: {
  team: HudTeam;
  roster: FantasyRosterEntry[];
  seasonStats: Record<string, PlayerSeasonLine>;
  scoringView: FantasyScoringView;
  selectedPlayer: string | null;
  onToggle: (name: string) => void;
}) {
  const pointsFor = useMemo(
    () => (player: FantasyRosterEntry) => getFantasyPointsForScoring(player, scoringView),
    [scoringView]
  );
  const groups = useMemo(
    () =>
      groupFantasyByPosition(roster).map((group) => ({
        ...group,
        players: [...group.players].sort((a, b) => pointsFor(b) - pointsFor(a)),
      })),
    [roster, pointsFor]
  );
  const topPoints = useMemo(
    () =>
      roster.reduce((max, player) => Math.max(max, pointsFor(player)), Number.NEGATIVE_INFINITY),
    [roster, pointsFor]
  );

  return (
    <div
      style={{
        padding: '14px 18px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <TeamBadge team={team} size={30} hasPossession={false} />
        <span
          style={{
            fontFamily: F.body,
            fontWeight: 700,
            fontSize: 20,
            color: C.textBright,
            lineHeight: 1,
          }}
        >
          {team.name}
        </span>
      </div>

      {groups.length === 0 && (
        <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textDim, padding: '10px 0' }}>
          No fantasy production yet.
        </div>
      )}

      {groups.map(({ position, players }) => (
        <div key={position} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontFamily: F.display,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.14em',
              color: C.cyan,
              padding: '10px 0 8px',
              borderBottom: `1px solid rgba(0,229,255,.08)`,
            }}
          >
            {POSITION_LABELS[position]}
          </div>

          {players.map((player) => {
            const season = seasonStats[player.name];
            const isExpanded = selectedPlayer === player.name;
            const playerPoints = pointsFor(player);
            const isTop = playerPoints === topPoints && Number.isFinite(topPoints);

            return (
              <div key={player.name}>
                <div
                  onClick={() => season && onToggle(player.name)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '10px 0 8px',
                    cursor: season ? 'pointer' : 'default',
                    background: isExpanded ? 'rgba(0,229,255,.03)' : 'transparent',
                    borderBottom: `1px solid rgba(0,229,255,.03)`,
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <PlayerHeadshot name={player.name} headshotUrl={player.headshotUrl} size={44} />
                    <div
                      style={{
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            fontFamily: F.body,
                            fontSize: 18,
                            fontWeight: 600,
                            color: C.textBright,
                            lineHeight: 1.1,
                          }}
                        >
                          {player.name}
                        </span>
                        {season && (
                          <span
                            style={{
                              fontFamily: F.display,
                              fontSize: 10,
                              color: isExpanded ? C.cyan : C.textMuted,
                              letterSpacing: '.06em',
                            }}
                          >
                            {isExpanded ? '▾' : '▸'}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontFamily: F.mono,
                          fontSize: 14,
                          color: C.textDim,
                          letterSpacing: '.04em',
                          lineHeight: 1.35,
                          whiteSpace: 'pre-line',
                        }}
                      >
                        {player.breakdown}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: F.body,
                      fontSize: 28,
                      fontWeight: 700,
                      minWidth: 56,
                      textAlign: 'right',
                      lineHeight: 1,
                      color: isTop ? C.amber : C.textBright,
                      textShadow: isTop ? `0 0 8px ${C.amberGlow}` : 'none',
                    }}
                  >
                    {formatPoints(playerPoints)}
                  </span>
                </div>

                {isExpanded && season && (
                  <PlayerDrillDown season={season} todayPts={playerPoints} teamColor={team.color} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function PlayerDrillDown({
  season,
  todayPts,
  teamColor,
}: {
  season: PlayerSeasonLine;
  todayPts: number;
  teamColor: string;
}) {
  const allPts = [...season.last5, todayPts];
  const maxPt = Math.max(...allPts, 1);

  // Mini sparkline
  const sparkW = 120;
  const sparkH = 28;
  const step = sparkW / (allPts.length - 1 || 1);

  const pathPoints = allPts.map((pt, i) => ({
    x: i * step,
    y: sparkH - (pt / maxPt) * (sparkH - 4),
  }));

  const pathD = pathPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const todayDot = pathPoints[pathPoints.length - 1];

  return (
    <div
      style={{
        padding: '10px 8px 12px 12px',
        marginBottom: 8,
        border: `1px solid ${C.panelBorder}`,
        background: 'rgba(0,229,255,.02)',
        animation: 'slideUp 0.25s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 14,
          marginBottom: 6,
          fontFamily: F.mono,
          fontSize: 11,
        }}
      >
        <span style={{ color: C.cyan, fontWeight: 700 }}>{season.positionRank}</span>
        <span style={{ color: C.textDim }}>{season.gamesPlayed} GP</span>
        <span style={{ color: C.textDim }}>{season.avgPoints.toFixed(1)} PPG</span>
        <span style={{ color: C.textDim }}>{season.totalPoints.toFixed(0)} TOT</span>
      </div>

      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          color: C.textDim,
          marginBottom: 8,
          letterSpacing: '.04em',
        }}
      >
        {season.statLine}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width={sparkW} height={sparkH}>
          <path
            d={pathD}
            fill="none"
            stroke={`#${teamColor}`}
            strokeWidth={1.5}
            opacity={0.7}
            pathLength={500}
            strokeDasharray={500}
            strokeDashoffset={0}
            style={{ animation: 'sparkDraw 0.8s ease forwards' }}
          />
          {/* Today dot */}
          {todayDot && (
            <circle
              cx={todayDot.x}
              cy={todayDot.y}
              r={3}
              fill={C.amber}
              stroke={C.bg}
              strokeWidth={1}
            />
          )}
        </svg>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            fontFamily: F.mono,
            fontSize: 9,
            color: C.textDim,
          }}
        >
          {allPts.map((pt, i) => (
            <span
              key={i}
              style={{
                color: i === allPts.length - 1 ? C.amber : C.textDim,
              }}
            >
              {pt.toFixed(1)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return `${Math.round(rounded)}`;
  return rounded.toFixed(1);
}

function getFantasyPointsForScoring(
  player: FantasyRosterEntry,
  scoringView: FantasyScoringView
): number {
  if (scoringView === 'PPR') {
    return player.pointsPpr ?? player.pointsHalfPpr ?? player.pointsStandard ?? player.points;
  }
  if (scoringView === 'HALF') {
    return player.pointsHalfPpr ?? player.pointsPpr ?? player.pointsStandard ?? player.points;
  }
  return player.pointsStandard ?? player.pointsHalfPpr ?? player.pointsPpr ?? player.points;
}

function PlayerHeadshot({
  name,
  headshotUrl,
  size = 22,
}: {
  name: string;
  headshotUrl?: string;
  size?: number;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `1px solid ${C.panelBorder}`,
        background: 'rgba(0,229,255,.05)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: '0 0 10px rgba(0,229,255,.22)',
      }}
      aria-hidden="true"
    >
      {headshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={headshotUrl}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <span
          style={{
            fontFamily: F.display,
            fontSize: Math.max(10, Math.floor(size * 0.42)),
            fontWeight: 700,
            color: C.textMuted,
            lineHeight: 1,
          }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}
