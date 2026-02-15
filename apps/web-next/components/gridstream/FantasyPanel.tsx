'use client';

import { useState } from 'react';
import type {
  FantasyRosterEntry,
  PlayerSeasonLine,
  HudTeam,
  PositionGroup,
} from '@atlas/sdk/gridstream/types';
import { groupFantasyByPosition } from '@atlas/sdk/gridstream/transforms';
import { POSITION_LABELS } from '@atlas/sdk/gridstream/constants';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

interface FantasyPanelProps {
  away: HudTeam;
  home: HudTeam;
  fantasyAway: FantasyRosterEntry[];
  fantasyHome: FantasyRosterEntry[];
  playerSeasonStats: Record<string, PlayerSeasonLine>;
}

export function FantasyPanel({
  away, home, fantasyAway, fantasyHome, playerSeasonStats,
}: FantasyPanelProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  const togglePlayer = (name: string) => {
    setSelectedPlayer((prev) => prev === name ? null : name);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <TeamColumn
        team={away}
        roster={fantasyAway}
        seasonStats={playerSeasonStats}
        selectedPlayer={selectedPlayer}
        onToggle={togglePlayer}
      />
      <TeamColumn
        team={home}
        roster={fantasyHome}
        seasonStats={playerSeasonStats}
        selectedPlayer={selectedPlayer}
        onToggle={togglePlayer}
      />
    </div>
  );
}

function TeamColumn({ team, roster, seasonStats, selectedPlayer, onToggle }: {
  team: HudTeam;
  roster: FantasyRosterEntry[];
  seasonStats: Record<string, PlayerSeasonLine>;
  selectedPlayer: string | null;
  onToggle: (name: string) => void;
}) {
  const groups = groupFantasyByPosition(roster);

  return (
    <div>
      <div style={{
        fontFamily: F.display, fontSize: 10, fontWeight: 700,
        letterSpacing: '.15em', color: `#${team.color}`,
        padding: '4px 0 8px', borderBottom: `1px solid ${C.panelBorder}`,
      }}>
        {team.displayName}
      </div>

      {groups.map(({ position, players }) => (
        <div key={position}>
          {/* Position header */}
          <div style={{
            fontFamily: F.display, fontSize: 8, fontWeight: 600,
            letterSpacing: '.2em', color: C.cyan,
            padding: '10px 0 4px', opacity: 0.8,
          }}>
            {POSITION_LABELS[position]}
          </div>

          {players.map((player) => {
            const season = seasonStats[player.name];
            const isExpanded = selectedPlayer === player.name;

            return (
              <div key={player.name}>
                {/* Player row */}
                <div
                  onClick={() => season && onToggle(player.name)}
                  style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', padding: '4px 0',
                    cursor: season ? 'pointer' : 'default',
                  }}
                >
                  <span style={{
                    fontFamily: F.body, fontSize: 14, fontWeight: 600,
                    color: C.textBright,
                  }}>
                    {player.name}
                  </span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontFamily: F.display, fontSize: 14, fontWeight: 700,
                      color: C.amber,
                    }}>
                      {player.points.toFixed(1)}
                    </div>
                    <div style={{
                      fontFamily: F.mono, fontSize: 10, color: C.text,
                      opacity: 0.7,
                    }}>
                      {player.breakdown}
                    </div>
                  </div>
                </div>

                {/* Season drill-down */}
                {isExpanded && season && (
                  <PlayerDrillDown
                    season={season}
                    todayPts={player.points}
                    teamColor={team.color}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function PlayerDrillDown({ season, todayPts, teamColor }: {
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

  const pathD = pathPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`
  ).join(' ');

  const todayDot = pathPoints[pathPoints.length - 1];

  return (
    <div style={{
      padding: '8px 0 12px 8px',
      animation: 'slideUp 0.25s ease',
    }}>
      {/* Rank + averages */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 6,
        fontFamily: F.mono, fontSize: 11,
      }}>
        <span style={{ color: C.cyan, fontWeight: 700 }}>{season.positionRank}</span>
        <span style={{ color: C.textDim }}>{season.gamesPlayed} GP</span>
        <span style={{ color: C.textDim }}>{season.avgPoints.toFixed(1)} PPG</span>
        <span style={{ color: C.textDim }}>{season.totalPoints.toFixed(0)} TOT</span>
      </div>

      {/* Stat line */}
      <div style={{
        fontFamily: F.mono, fontSize: 10, color: C.textDim,
        marginBottom: 8, letterSpacing: '.04em',
      }}>
        {season.statLine}
      </div>

      {/* Mini sparkline */}
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
              cx={todayDot.x} cy={todayDot.y} r={3}
              fill={C.amber} stroke={C.bg} strokeWidth={1}
            />
          )}
        </svg>
        {/* Week labels */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 1,
          fontFamily: F.mono, fontSize: 9, color: C.textDim,
        }}>
          {allPts.map((pt, i) => (
            <span key={i} style={{
              color: i === allPts.length - 1 ? C.amber : C.textDim,
            }}>
              {pt.toFixed(1)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
