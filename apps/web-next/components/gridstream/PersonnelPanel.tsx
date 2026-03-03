'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { HudTeam, PersonnelPlayerEntry, PersonnelState } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

interface PersonnelPanelProps {
  away: HudTeam;
  home: HudTeam;
  personnel: PersonnelState;
}

const POSITION_GROUP_ORDER = [
  'QB',
  'RB',
  'WR',
  'TE',
  'OL',
  'DL',
  'LB',
  'CB',
  'S',
  'SPECIAL_TEAMS',
] as const;
const POSITION_GROUP_LABEL: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  OL: 'OL',
  DL: 'DL',
  LB: 'LB',
  CB: 'CB',
  S: 'S',
  SPECIAL_TEAMS: 'SPECIAL TEAMS',
  OTHER: 'OTHER',
};
const POSITION_TO_GROUP: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  OL: 'OL',
  C: 'OL',
  G: 'OL',
  T: 'OL',
  OT: 'OL',
  OG: 'OL',
  OC: 'OL',
  DL: 'DL',
  DE: 'DL',
  DT: 'DL',
  NT: 'DL',
  EDGE: 'DL',
  LB: 'LB',
  OLB: 'LB',
  ILB: 'LB',
  MLB: 'LB',
  CB: 'CB',
  S: 'S',
  FS: 'S',
  SS: 'S',
  SAF: 'S',
  DB: 'S',
  K: 'SPECIAL_TEAMS',
  P: 'SPECIAL_TEAMS',
  PK: 'SPECIAL_TEAMS',
  LS: 'SPECIAL_TEAMS',
  SPEC: 'SPECIAL_TEAMS',
  ST: 'SPECIAL_TEAMS',
};
const OFFENSE_GROUPS = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
const DEFENSE_GROUPS = new Set(['DL', 'LB', 'CB', 'S']);

type SnapColumn = 'OFF' | 'DEF' | 'ST';
type GroupKind = 'offense' | 'defense' | 'special' | 'other';

function formatSnapCell(snaps: number, pct: number | null | undefined): string {
  if (snaps <= 0) return '0';
  const pctText = pct == null || !Number.isFinite(pct) ? '' : ` · ${pct.toFixed(0)}%`;
  return `${snaps}${pctText}`;
}

function formatTeamSource(source: PersonnelState['source']): string {
  if (source === 'snap_counts') return 'SNAP COUNTS';
  if (source === 'player_stats_fallback') return 'PLAYER STATS FALLBACK';
  return 'NO PERSONNEL DATA';
}

function canonicalGroup(player: PersonnelPlayerEntry): string {
  const normalize = (value: string | undefined) =>
    (value ?? '')
      .toUpperCase()
      .trim()
      .replace(/[^A-Z]/g, '');
  const rawPosition = normalize(player.position);
  const rawGroup = normalize(player.positionGroup);
  if (rawGroup && POSITION_TO_GROUP[rawGroup]) return POSITION_TO_GROUP[rawGroup];
  if (rawPosition && POSITION_TO_GROUP[rawPosition]) return POSITION_TO_GROUP[rawPosition];
  return rawGroup || rawPosition || 'OTHER';
}

function groupKind(group: string): GroupKind {
  if (OFFENSE_GROUPS.has(group)) return 'offense';
  if (DEFENSE_GROUPS.has(group)) return 'defense';
  if (group === 'SPECIAL_TEAMS') return 'special';
  return 'other';
}

function pctMetric(pct: number | null | undefined, snaps: number): number {
  if (pct != null && Number.isFinite(pct)) return pct;
  return snaps;
}

function sortPlayersForGroup(
  group: string,
  players: PersonnelPlayerEntry[]
): PersonnelPlayerEntry[] {
  const kind = groupKind(group);
  return [...players].sort((left, right) => {
    if (kind === 'offense') {
      const rightOff = pctMetric(right.offenseSnapPct, right.offenseSnaps);
      const leftOff = pctMetric(left.offenseSnapPct, left.offenseSnaps);
      if (rightOff !== leftOff) return rightOff - leftOff;
      const rightSt = pctMetric(right.specialSnapPct, right.specialSnaps);
      const leftSt = pctMetric(left.specialSnapPct, left.specialSnaps);
      if (rightSt !== leftSt) return rightSt - leftSt;
    } else if (kind === 'defense') {
      const rightDef = pctMetric(right.defenseSnapPct, right.defenseSnaps);
      const leftDef = pctMetric(left.defenseSnapPct, left.defenseSnaps);
      if (rightDef !== leftDef) return rightDef - leftDef;
      const rightSt = pctMetric(right.specialSnapPct, right.specialSnaps);
      const leftSt = pctMetric(left.specialSnapPct, left.specialSnaps);
      if (rightSt !== leftSt) return rightSt - leftSt;
    } else if (kind === 'special') {
      const rightSt = pctMetric(right.specialSnapPct, right.specialSnaps);
      const leftSt = pctMetric(left.specialSnapPct, left.specialSnaps);
      if (rightSt !== leftSt) return rightSt - leftSt;
      const rightOff = pctMetric(right.offenseSnapPct, right.offenseSnaps);
      const leftOff = pctMetric(left.offenseSnapPct, left.offenseSnaps);
      if (rightOff !== leftOff) return rightOff - leftOff;
      const rightDef = pctMetric(right.defenseSnapPct, right.defenseSnaps);
      const leftDef = pctMetric(left.defenseSnapPct, left.defenseSnaps);
      if (rightDef !== leftDef) return rightDef - leftDef;
    }
    if (right.totalSnaps !== left.totalSnaps) return right.totalSnaps - left.totalSnaps;
    return (left.displayName ?? left.playerName).localeCompare(
      right.displayName ?? right.playerName
    );
  });
}

function groupColumns(group: string, players: PersonnelPlayerEntry[]): SnapColumn[] {
  const hasOffense = players.some((p) => p.offenseSnaps > 0);
  const hasDefense = players.some((p) => p.defenseSnaps > 0);
  const kind = groupKind(group);

  if (kind === 'offense') {
    const cols: SnapColumn[] = ['OFF'];
    if (hasDefense) cols.push('DEF');
    cols.push('ST');
    return cols;
  }

  if (kind === 'defense') {
    const cols: SnapColumn[] = ['DEF'];
    if (hasOffense) cols.push('OFF');
    cols.push('ST');
    return cols;
  }

  if (kind === 'special') {
    const cols: SnapColumn[] = ['ST'];
    if (hasOffense) cols.push('OFF');
    if (hasDefense) cols.push('DEF');
    return cols;
  }

  const cols: SnapColumn[] = [];
  if (hasOffense) cols.push('OFF');
  if (hasDefense) cols.push('DEF');
  cols.push('ST');
  return cols;
}

function columnLabel(column: SnapColumn): string {
  if (column === 'OFF') return 'OFF';
  if (column === 'DEF') return 'DEF';
  return 'ST';
}

function snapCellByColumn(player: PersonnelPlayerEntry, column: SnapColumn): string {
  if (column === 'OFF') return formatSnapCell(player.offenseSnaps, player.offenseSnapPct);
  if (column === 'DEF') return formatSnapCell(player.defenseSnaps, player.defenseSnapPct);
  return formatSnapCell(player.specialSnaps, player.specialSnapPct);
}

function positionDisplay(player: PersonnelPlayerEntry): string {
  const value = player.depthChartPosition || player.position || player.positionGroup;
  const normalized = (value ?? '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, '');
  return normalized || '—';
}

function groupPlayers(players: PersonnelPlayerEntry[]) {
  const buckets = new Map<string, { players: PersonnelPlayerEntry[]; totalSnaps: number }>();
  for (const player of players) {
    const group = canonicalGroup(player);
    const bucket = buckets.get(group) ?? { players: [], totalSnaps: 0 };
    bucket.players.push(player);
    bucket.totalSnaps += Math.max(0, player.totalSnaps ?? 0);
    buckets.set(group, bucket);
  }
  const order = new Map(POSITION_GROUP_ORDER.map((group, index) => [group, index]));
  return [...buckets.entries()]
    .map(([group, value]) => ({
      group,
      players: sortPlayersForGroup(group, value.players),
      totalSnaps: value.totalSnaps,
    }))
    .sort((left, right) => {
      const leftOrder = order.get(left.group) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.group) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (right.totalSnaps !== left.totalSnaps) return right.totalSnaps - left.totalSnaps;
      return left.group.localeCompare(right.group);
    });
}

export function PersonnelPanel({ away, home, personnel }: PersonnelPanelProps) {
  const [selectedTeam, setSelectedTeam] = useState<'away' | 'home'>('away');
  return (
    <div>
      {/* Header: source label + week */}
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
          ROSTERS - {formatTeamSource(personnel.source)}
        </span>
        <span className="hud-label" style={{ fontSize: 10 }}>
          {personnel.season ?? '—'} · WK {personnel.week ?? '—'}
        </span>
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
              onClick={() => setSelectedTeam(side)}
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
        side="left"
        team={selectedTeam === 'away' ? away : home}
        data={selectedTeam === 'away' ? personnel.away : personnel.home}
      />
    </div>
  );
}

function TeamColumn({
  side,
  team,
  data,
}: {
  side: 'left' | 'right';
  team: HudTeam;
  data: PersonnelState['away'];
}) {
  const grouped = useMemo(() => groupPlayers(data.players), [data.players]);
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
          {team.displayName}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <SummaryTile label="OFF" value={data.totalOffenseSnaps} />
        <SummaryTile label="DEF" value={data.totalDefenseSnaps} />
        <SummaryTile label="ST" value={data.totalSpecialSnaps} />
        <SummaryTile label="TOTAL" value={data.totalSnaps} />
      </div>

      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: '.08em',
          color: C.textMuted,
          marginBottom: 8,
        }}
      >
        {grouped.length} GROUPS · {data.players.length} PLAYERS
      </div>

      {grouped.length === 0 && (
        <div style={{ fontFamily: F.mono, fontSize: 12, color: C.textDim, padding: '10px 0' }}>
          No personnel entries available for this game.
        </div>
      )}

      {grouped.length > 0 && (
        <div>
          {grouped.map(({ group, players }) => {
            const columns = groupColumns(group, players);
            const snapColumnWidth = `${(46 / Math.max(1, columns.length)).toFixed(2)}%`;
            return (
              <div key={group} style={{ marginBottom: 10 }}>
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
                  {(POSITION_GROUP_LABEL[group] ?? group) + ` · ${players.length}`}
                </div>

                <table style={groupTableStyle}>
                  <colgroup>
                    <col style={{ width: '44%' }} />
                    <col style={{ width: '10%' }} />
                    {columns.map((column) => (
                      <col key={`${group}-col-${column}`} style={{ width: snapColumnWidth }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={headerCellLeftStyle}>PLAYER</th>
                      <th style={headerCellStyle}>POS</th>
                      {columns.map((column) => (
                        <th key={`${group}-head-${column}`} style={headerCellRightStyle}>
                          {columnLabel(column)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((player) => {
                      const status = (player.rosterStatus ?? '').toUpperCase().trim();
                      const isInactive = Boolean(status && status !== 'ACT');
                      return (
                        <tr key={`${group}-${player.playerId ?? player.playerName}`}>
                          <td style={playerCellStyle}>
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
                            >
                              <span
                                style={{
                                  fontFamily: F.body,
                                  fontSize: 15,
                                  fontWeight: 600,
                                  color: C.textBright,
                                  lineHeight: 1.15,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {player.displayName ?? player.playerName}
                              </span>
                              {isInactive && <span style={statusBadgeStyle}>{status}</span>}
                            </div>
                          </td>
                          <td style={positionCellStyle}>{positionDisplay(player)}</td>
                          {columns.map((column) => (
                            <td
                              key={`${group}-${player.playerId ?? player.playerName}-${column}`}
                              style={cellStyle}
                            >
                              {snapCellByColumn(player, column)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: `1px solid rgba(0,229,255,0.12)`,
        background: 'rgba(0,229,255,0.04)',
        padding: '7px 8px',
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 8,
          letterSpacing: '.12em',
          color: C.textMuted,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: F.display,
          fontSize: 18,
          fontWeight: 800,
          color: C.textBright,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const groupTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
};

const headerCellBaseStyle: CSSProperties = {
  padding: '6px 0',
  borderBottom: `1px solid rgba(0,229,255,.06)`,
  fontFamily: F.mono,
  fontSize: 9,
  letterSpacing: '.08em',
  color: C.textMuted,
  fontWeight: 500,
};

const headerCellLeftStyle: CSSProperties = {
  ...headerCellBaseStyle,
  textAlign: 'left',
};

const headerCellStyle: CSSProperties = {
  ...headerCellBaseStyle,
  textAlign: 'center',
};

const headerCellRightStyle: CSSProperties = {
  ...headerCellBaseStyle,
  textAlign: 'right',
};

const playerCellStyle: CSSProperties = {
  padding: '8px 0',
  borderBottom: `1px solid rgba(0,229,255,.04)`,
  minWidth: 0,
};

const positionCellStyle: CSSProperties = {
  padding: '8px 0',
  borderBottom: `1px solid rgba(0,229,255,.04)`,
  fontFamily: F.display,
  fontSize: 12,
  color: C.textDim,
  letterSpacing: '.08em',
  textAlign: 'center',
};

const cellStyle: CSSProperties = {
  padding: '8px 0',
  borderBottom: `1px solid rgba(0,229,255,.04)`,
  textAlign: 'right',
  fontFamily: F.mono,
  fontSize: 11,
  color: C.textDim,
  letterSpacing: '.05em',
};

const statusBadgeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '2px 6px',
  border: `1px solid rgba(255,195,0,.55)`,
  borderRadius: 2,
  fontFamily: F.mono,
  fontSize: 9,
  letterSpacing: '.08em',
  color: '#ffc300',
  lineHeight: 1.2,
};
