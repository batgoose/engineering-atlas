'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  GridstreamPlayerGamelogPage,
  GridstreamPlayerRbsdmResponse,
  GridstreamPlayerSplits,
  GridstreamPlayerSplitAggregate,
} from '@atlas/sdk/gridstream';

type PrimaryTab = 'gamelog' | 'splits';
type SplitTab = 'home-away' | 'win-loss' | 'reg-post' | 'surface' | 'division';

const SPLIT_TABS: { id: SplitTab; label: string }[] = [
  { id: 'home-away', label: 'Home / Away' },
  { id: 'win-loss', label: 'Win / Loss' },
  { id: 'reg-post', label: 'Reg / Post' },
  { id: 'surface', label: 'Surface' },
  { id: 'division', label: 'Division' },
];

// Position group detection
type PositionGroup = 'offense' | 'defense' | 'kicker' | 'punter' | 'ol';

const DEFENSE_POSITIONS = new Set([
  'DE',
  'DT',
  'NT',
  'DL',
  'OLB',
  'ILB',
  'MLB',
  'LB',
  'EDGE',
  'CB',
  'S',
  'SS',
  'FS',
  'DB',
  'LDE',
  'RDE',
  'RDT',
  'LDT',
  'SAF',
]);
const OL_POSITIONS = new Set(['C', 'G', 'T', 'OT', 'OG', 'OL', 'LS']);

function positionGroup(pos: string): PositionGroup {
  const p = pos.toUpperCase().trim();
  if (DEFENSE_POSITIONS.has(p)) return 'defense';
  if (OL_POSITIONS.has(p)) return 'ol';
  if (p === 'K') return 'kicker';
  if (p === 'P') return 'punter';
  return 'offense';
}

function buildSelfHref(playerId: string, season: number | null, gamelogPage: number): string {
  const params = new URLSearchParams();
  // null means career (all seasons) — use 'all' sentinel so the page can distinguish
  // "career explicitly chosen" from "no param yet" (which defaults to latest season)
  if (season == null) {
    params.set('season', 'all');
  } else {
    params.set('season', String(season));
  }
  if (gamelogPage > 1) params.set('gamelog_page', String(gamelogPage));
  const query = params.toString();
  return query
    ? `/gridstream/players/${encodeURIComponent(playerId)}?${query}`
    : `/gridstream/players/${encodeURIComponent(playerId)}`;
}

function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value > 0) return `+${value.toFixed(digits)}`;
  return value.toFixed(digits);
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function metricColor(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'rgba(159, 195, 219, 0.88)';
  if (value >= 0) return '#8fff45';
  return '#ff627e';
}

// ─── Offense splits table ───────────────────────────────────────────────────

function OffenseSplitsTable({
  rows,
}: {
  rows: { label: string; s: GridstreamPlayerSplitAggregate }[];
}) {
  const noData = rows.every((r) => r.s.games === 0);
  const d = (g: number, n: number) => (g ? n : '—');
  const sep = { borderLeft: '1px solid rgba(0,229,255,0.1)' } as const;

  return (
    <div className="gs-players-table-wrap">
      <table className="gs-players-table gs-player-detail-table" style={{ minWidth: 920 }}>
        <thead>
          <tr>
            <th className="gs-players-table-head-cell is-sticky">Split</th>
            <th className="gs-players-table-head-cell is-numeric">G</th>
            <th className="gs-player-detail-group-th is-pass" colSpan={3}>
              Passing
            </th>
            <th className="gs-player-detail-group-th is-rush" colSpan={3}>
              Rushing
            </th>
            <th className="gs-player-detail-group-th is-rec" colSpan={3}>
              Receiving
            </th>
            <th className="gs-players-table-head-cell is-numeric" style={sep}>
              Fum
            </th>
            <th className="gs-players-table-head-cell is-numeric">Lost</th>
            <th className="gs-players-table-head-cell is-numeric">PPR</th>
          </tr>
          <tr>
            <th className="gs-players-table-head-cell is-sticky" />
            <th className="gs-players-table-head-cell is-numeric" />
            <th className="gs-players-table-head-cell is-numeric">Yds</th>
            <th className="gs-players-table-head-cell is-numeric">TD</th>
            <th className="gs-players-table-head-cell is-numeric">1D</th>
            <th className="gs-players-table-head-cell is-numeric">Yds</th>
            <th className="gs-players-table-head-cell is-numeric">TD</th>
            <th className="gs-players-table-head-cell is-numeric">1D</th>
            <th className="gs-players-table-head-cell is-numeric">Yds</th>
            <th className="gs-players-table-head-cell is-numeric">TD</th>
            <th className="gs-players-table-head-cell is-numeric">1D</th>
            <th className="gs-players-table-head-cell is-numeric" style={sep} />
            <th className="gs-players-table-head-cell is-numeric" />
            <th className="gs-players-table-head-cell is-numeric" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, s }) => {
            const g = s.games;
            const avg = (n: number) => (g ? (n / g).toFixed(1) : '—');
            return (
              <Fragment key={label}>
                <tr>
                  <td className="gs-players-table-cell is-sticky">{label}</td>
                  <td className="gs-players-table-cell is-numeric">{g || '—'}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.passYds)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.passTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.passFirstDowns)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.rushYds)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.rushTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.rushFirstDowns)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.recYds)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.recTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.recFirstDowns)}</td>
                  <td className="gs-players-table-cell is-numeric" style={sep}>
                    {d(g, s.fumbles)}
                  </td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.fumblesLost)}</td>
                  <td className="gs-players-table-cell is-numeric">{g ? s.ppr.toFixed(1) : '—'}</td>
                </tr>
                <tr className="gs-player-detail-split-avg-row">
                  <td className="gs-players-table-cell is-sticky">/G</td>
                  <td className="gs-players-table-cell is-numeric" />
                  <td className="gs-players-table-cell is-numeric">{avg(s.passYds)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.passTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.passFirstDowns)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.rushYds)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.rushTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.rushFirstDowns)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.recYds)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.recTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.recFirstDowns)}</td>
                  <td className="gs-players-table-cell is-numeric" style={sep}>
                    {avg(s.fumbles)}
                  </td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.fumblesLost)}</td>
                  <td className="gs-players-table-cell is-numeric">
                    {g ? (s.ppr / g).toFixed(1) : '—'}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {noData && <div className="gs-players-empty">No data for the selected season.</div>}
    </div>
  );
}

// ─── Defense splits table ───────────────────────────────────────────────────

function DefenseSplitsTable({
  rows,
}: {
  rows: { label: string; s: GridstreamPlayerSplitAggregate }[];
}) {
  const noData = rows.every((r) => r.s.games === 0);
  const d = (g: number, n: number) => (g ? n : '—');
  const fmt = (n: number, decimals = 1) => (n ? n.toFixed(decimals) : '—');

  return (
    <div className="gs-players-table-wrap">
      <table className="gs-players-table gs-player-detail-table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th className="gs-players-table-head-cell is-sticky">Split</th>
            <th className="gs-players-table-head-cell is-numeric">G</th>
            <th className="gs-players-table-head-cell is-numeric">Tkl</th>
            <th className="gs-players-table-head-cell is-numeric">Sack</th>
            <th className="gs-players-table-head-cell is-numeric">QB Hit</th>
            <th className="gs-players-table-head-cell is-numeric">PD</th>
            <th className="gs-players-table-head-cell is-numeric">INT</th>
            <th className="gs-players-table-head-cell is-numeric">INT TD</th>
            <th className="gs-players-table-head-cell is-numeric">FF</th>
            <th className="gs-players-table-head-cell is-numeric">Def TD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, s }) => {
            const g = s.games;
            const avg = (n: number, dec = 1) => (g ? (n / g).toFixed(dec) : '—');
            return (
              <Fragment key={label}>
                <tr>
                  <td className="gs-players-table-cell is-sticky">{label}</td>
                  <td className="gs-players-table-cell is-numeric">{g || '—'}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.defTackles)}</td>
                  <td className="gs-players-table-cell is-numeric">{g ? fmt(s.defSacks) : '—'}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.defQbHits)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.defPd)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.defInts)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.defIntTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.forcedFumbles)}</td>
                  <td className="gs-players-table-cell is-numeric">{d(g, s.defTds)}</td>
                </tr>
                <tr className="gs-player-detail-split-avg-row">
                  <td className="gs-players-table-cell is-sticky">/G</td>
                  <td className="gs-players-table-cell is-numeric" />
                  <td className="gs-players-table-cell is-numeric">{avg(s.defTackles)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.defSacks)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.defQbHits)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.defPd)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.defInts)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.defIntTds)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.forcedFumbles)}</td>
                  <td className="gs-players-table-cell is-numeric">{avg(s.defTds)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {noData && <div className="gs-players-empty">No data for the selected season.</div>}
    </div>
  );
}

function SplitsTable({
  rows,
  group,
}: {
  rows: { label: string; s: GridstreamPlayerSplitAggregate }[];
  group: PositionGroup;
}) {
  if (group === 'defense') return <DefenseSplitsTable rows={rows} />;
  return <OffenseSplitsTable rows={rows} />;
}

export interface PlayerStatsTabsProps {
  gamelog: GridstreamPlayerGamelogPage;
  rbsdm: GridstreamPlayerRbsdmResponse;
  splits: GridstreamPlayerSplits;
  selectedSeason: number | null;
  seasonOptions: number[];
  routeId: string;
  position: string;
}

export default function PlayerStatsTabs({
  gamelog,
  rbsdm,
  splits,
  selectedSeason,
  seasonOptions,
  routeId,
  position,
}: PlayerStatsTabsProps) {
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('gamelog');
  const [splitTab, setSplitTab] = useState<SplitTab>('home-away');

  const group = positionGroup(position);
  const isDefense = group === 'defense';
  const isQb = position.toUpperCase() === 'QB';
  const latestQbRbsdm = isQb ? rbsdm.latest : null;
  const qbRbsdmByWeek = useMemo(() => {
    const byWeek = new Map<number, GridstreamPlayerRbsdmResponse['rows'][number]>();
    if (!isQb) return byWeek;
    for (const row of rbsdm.rows) {
      byWeek.set(row.week, row);
    }
    return byWeek;
  }, [isQb, rbsdm.rows]);

  return (
    <section className="hud-panel gs-player-detail-stats-section">
      <div className="gs-player-detail-stats-header">
        {/* Primary tab bar */}
        <div className="gs-player-detail-stats-tabs">
          <button
            type="button"
            onClick={() => setPrimaryTab('gamelog')}
            className={`gs-player-detail-stats-tab${primaryTab === 'gamelog' ? ' is-active' : ''}`}
          >
            Game Log
          </button>
          <div className="gs-player-detail-stats-tab-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setPrimaryTab('splits')}
            className={`gs-player-detail-stats-tab is-splits-group${primaryTab === 'splits' ? ' is-active' : ''}`}
          >
            Splits
          </button>
          {primaryTab === 'splits' &&
            SPLIT_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSplitTab(id)}
                className={`gs-player-detail-stats-tab is-split-sub${splitTab === id ? ' is-active' : ''}`}
              >
                {label}
              </button>
            ))}
        </div>
        <div className="gs-player-detail-season-selector">
          <span className="gs-players-kicker">Season</span>
          <div className="gs-players-filter-row">
            <Link
              href={buildSelfHref(routeId, null, 1)}
              className={`gs-players-chip${selectedSeason === null ? ' is-active' : ''}`}
            >
              Career
            </Link>
            {seasonOptions.map((season) => (
              <Link
                key={season}
                href={buildSelfHref(routeId, season, 1)}
                className={`gs-players-chip${selectedSeason === season ? ' is-active' : ''}`}
              >
                {season}
              </Link>
            ))}
            {seasonOptions.length === 0 && <span className="gs-players-chip">No season data.</span>}
          </div>
        </div>
      </div>

      <div className="gs-player-detail-stats-content">
        {latestQbRbsdm && (
          <div style={{ padding: '14px 16px 6px' }}>
            <div className="gs-players-kicker">
              RBSDM QB Snapshot{selectedSeason != null ? ` · ${selectedSeason}` : ''}
            </div>
            <div
              style={{
                marginTop: 8,
                display: 'grid',
                gap: 8,
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              }}
            >
              {[
                {
                  label: 'Adj EPA/Play',
                  value: formatSigned(latestQbRbsdm.adjEpaPlay, 3),
                  color: metricColor(latestQbRbsdm.adjEpaPlay),
                },
                {
                  label: 'EPA/Play',
                  value: formatSigned(latestQbRbsdm.epaPlay, 3),
                  color: metricColor(latestQbRbsdm.epaPlay),
                },
                {
                  label: 'EPA+CPOE',
                  value: formatSigned(latestQbRbsdm.epaCpoeComposite, 3),
                  color: metricColor(latestQbRbsdm.epaCpoeComposite),
                },
                {
                  label: 'CPOE',
                  value: formatSigned(latestQbRbsdm.cpoe, 2),
                  color: metricColor(latestQbRbsdm.cpoe),
                },
                {
                  label: 'Success Rate',
                  value: formatPct(latestQbRbsdm.successRate, 1),
                  color: metricColor(
                    latestQbRbsdm.successRate == null ? null : latestQbRbsdm.successRate - 0.5
                  ),
                },
                {
                  label: 'Cmp% vs Exp',
                  value:
                    latestQbRbsdm.cmpPct != null && latestQbRbsdm.expectedCmpPct != null
                      ? `${latestQbRbsdm.cmpPct.toFixed(1)}% / ${latestQbRbsdm.expectedCmpPct.toFixed(1)}%`
                      : '—',
                  color:
                    latestQbRbsdm.cmpPct != null && latestQbRbsdm.expectedCmpPct != null
                      ? metricColor(latestQbRbsdm.cmpPct - latestQbRbsdm.expectedCmpPct)
                      : 'rgba(159, 195, 219, 0.88)',
                },
                {
                  label: 'Air Yards',
                  value: latestQbRbsdm.airYards != null ? latestQbRbsdm.airYards.toFixed(1) : '—',
                  color: 'rgba(99, 223, 255, 0.9)',
                },
                {
                  label: 'Plays',
                  value: latestQbRbsdm.plays != null ? String(latestQbRbsdm.plays) : '—',
                  color: 'rgba(159, 195, 219, 0.92)',
                },
              ].map((metric) => (
                <article
                  key={metric.label}
                  style={{
                    border: '1px solid rgba(0, 229, 255, 0.16)',
                    background: 'rgba(0, 18, 38, 0.45)',
                    padding: '10px 11px',
                    minHeight: 68,
                  }}
                >
                  <div className="gs-players-kicker" style={{ marginBottom: 6, fontSize: 9 }}>
                    {metric.label}
                  </div>
                  <div
                    style={{
                      color: metric.color,
                      fontFamily: 'var(--gs-font-mono)',
                      fontSize: 18,
                      fontWeight: 700,
                    }}
                  >
                    {metric.value}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {primaryTab === 'gamelog' && (
          <>
            <div className="gs-players-table-wrap">
              {isDefense ? (
                <table
                  className="gs-players-table gs-player-detail-table"
                  style={{ minWidth: 720 }}
                >
                  <thead>
                    <tr>
                      <th className="gs-players-table-head-cell is-sticky" rowSpan={2}>
                        Wk
                      </th>
                      <th className="gs-players-table-head-cell" rowSpan={2}>
                        Team
                      </th>
                      <th className="gs-players-table-head-cell" rowSpan={2}>
                        Opp
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        Tkl
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        Sack
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        QB Hit
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        PD
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        INT
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        INT TD
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        FF
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        Def TD
                      </th>
                    </tr>
                    <tr />
                  </thead>
                  <tbody>
                    {gamelog.items.map((entry) => (
                      <tr key={entry.id}>
                        <td className="gs-players-table-cell is-sticky">
                          W{entry.week} · {entry.seasonType}
                        </td>
                        <td className="gs-players-table-cell">{entry.teamAbbr}</td>
                        <td className="gs-players-table-cell">{entry.opponentAbbr}</td>
                        <td className="gs-players-table-cell is-numeric">
                          {entry.tacklesTotal || '—'}
                        </td>
                        <td className="gs-players-table-cell is-numeric">
                          {entry.sacksMade ? entry.sacksMade.toFixed(1) : '—'}
                        </td>
                        <td className="gs-players-table-cell is-numeric">{entry.qbHits || '—'}</td>
                        <td className="gs-players-table-cell is-numeric">
                          {entry.passesDefended || '—'}
                        </td>
                        <td className="gs-players-table-cell is-numeric">
                          {entry.interceptionsCaught || '—'}
                        </td>
                        <td className="gs-players-table-cell is-numeric">
                          {entry.interceptionTds || '—'}
                        </td>
                        <td className="gs-players-table-cell is-numeric">
                          {entry.forcedFumbles || '—'}
                        </td>
                        <td className="gs-players-table-cell is-numeric">
                          {entry.defensiveTds || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {gamelog.items.length > 1 &&
                    (() => {
                      const tot = gamelog.items.reduce(
                        (acc, e) => ({
                          tackles: acc.tackles + (e.tacklesTotal ?? 0),
                          sacks: acc.sacks + (e.sacksMade ?? 0),
                          qbHits: acc.qbHits + (e.qbHits ?? 0),
                          pd: acc.pd + (e.passesDefended ?? 0),
                          ints: acc.ints + (e.interceptionsCaught ?? 0),
                          intTds: acc.intTds + (e.interceptionTds ?? 0),
                          ff: acc.ff + (e.forcedFumbles ?? 0),
                          defTds: acc.defTds + (e.defensiveTds ?? 0),
                        }),
                        {
                          tackles: 0,
                          sacks: 0,
                          qbHits: 0,
                          pd: 0,
                          ints: 0,
                          intTds: 0,
                          ff: 0,
                          defTds: 0,
                        }
                      );
                      const dv = (n: number) => n || '—';
                      return (
                        <tfoot>
                          <tr className="gs-player-detail-totals-row">
                            <td className="gs-players-table-cell is-sticky">TOT</td>
                            <td className="gs-players-table-cell" />
                            <td className="gs-players-table-cell" />
                            <td className="gs-players-table-cell is-numeric">{dv(tot.tackles)}</td>
                            <td className="gs-players-table-cell is-numeric">
                              {tot.sacks ? tot.sacks.toFixed(1) : '—'}
                            </td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.qbHits)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.pd)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.ints)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.intTds)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.ff)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.defTds)}</td>
                          </tr>
                        </tfoot>
                      );
                    })()}
                </table>
              ) : (
                <table
                  className="gs-players-table gs-player-detail-table"
                  style={{ minWidth: 1220 }}
                >
                  <thead>
                    <tr>
                      <th className="gs-players-table-head-cell is-sticky" rowSpan={2}>
                        Wk
                      </th>
                      <th className="gs-players-table-head-cell" rowSpan={2}>
                        Team
                      </th>
                      <th className="gs-players-table-head-cell" rowSpan={2}>
                        Opp
                      </th>
                      <th className="gs-player-detail-group-th is-pass" colSpan={6}>
                        Passing
                      </th>
                      <th className="gs-player-detail-group-th is-rush" colSpan={4}>
                        Rushing
                      </th>
                      <th className="gs-player-detail-group-th is-rec" colSpan={4}>
                        Receiving
                      </th>
                      <th className="gs-players-table-head-cell" colSpan={3}>
                        {isQb ? 'QB Advanced' : 'Advanced'}
                      </th>
                      <th className="gs-players-table-head-cell is-numeric" rowSpan={2}>
                        PPR
                      </th>
                    </tr>
                    <tr>
                      <th className="gs-players-table-head-cell is-numeric">Cmp</th>
                      <th className="gs-players-table-head-cell is-numeric">Att</th>
                      <th className="gs-players-table-head-cell is-numeric">Yds</th>
                      <th className="gs-players-table-head-cell is-numeric">TD</th>
                      <th className="gs-players-table-head-cell is-numeric">INT</th>
                      <th className="gs-players-table-head-cell is-numeric">EPA</th>
                      <th className="gs-players-table-head-cell is-numeric">Car</th>
                      <th className="gs-players-table-head-cell is-numeric">Yds</th>
                      <th className="gs-players-table-head-cell is-numeric">TD</th>
                      <th className="gs-players-table-head-cell is-numeric">EPA</th>
                      <th className="gs-players-table-head-cell is-numeric">Rec</th>
                      <th className="gs-players-table-head-cell is-numeric">Yds</th>
                      <th className="gs-players-table-head-cell is-numeric">TD</th>
                      <th className="gs-players-table-head-cell is-numeric">EPA</th>
                      {isQb ? (
                        <>
                          <th className="gs-players-table-head-cell is-numeric">EPA+CPOE</th>
                          <th className="gs-players-table-head-cell is-numeric">CPOE</th>
                          <th className="gs-players-table-head-cell is-numeric">SR%</th>
                        </>
                      ) : (
                        <>
                          <th className="gs-players-table-head-cell is-numeric">Tgt%</th>
                          <th className="gs-players-table-head-cell is-numeric">Air%</th>
                          <th className="gs-players-table-head-cell is-numeric">WOPR</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {gamelog.items.map((entry) => {
                      const qbWeek = isQb ? (qbRbsdmByWeek.get(entry.week) ?? null) : null;
                      return (
                        <tr key={entry.id}>
                          <td className="gs-players-table-cell is-sticky">
                            W{entry.week} · {entry.seasonType}
                          </td>
                          <td className="gs-players-table-cell">{entry.teamAbbr}</td>
                          <td className="gs-players-table-cell">{entry.opponentAbbr}</td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.passComp || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.passAtt || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.passYards || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.passTd || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.interceptionsThrown || '—'}
                          </td>
                          <td
                            className="gs-players-table-cell is-numeric"
                            style={{ color: metricColor(entry.passingEpa) }}
                          >
                            {formatSigned(entry.passingEpa, 2)}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.carries || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.rushYards || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.rushTd || '—'}
                          </td>
                          <td
                            className="gs-players-table-cell is-numeric"
                            style={{ color: metricColor(entry.rushingEpa) }}
                          >
                            {formatSigned(entry.rushingEpa, 2)}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.receptions || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.receivingYards || '—'}
                          </td>
                          <td className="gs-players-table-cell is-numeric">
                            {entry.receivingTd || '—'}
                          </td>
                          <td
                            className="gs-players-table-cell is-numeric"
                            style={{ color: metricColor(entry.receivingEpa) }}
                          >
                            {formatSigned(entry.receivingEpa, 2)}
                          </td>
                          {isQb ? (
                            <>
                              <td
                                className="gs-players-table-cell is-numeric"
                                style={{ color: metricColor(qbWeek?.epaCpoeComposite) }}
                              >
                                {formatSigned(qbWeek?.epaCpoeComposite, 3)}
                              </td>
                              <td
                                className="gs-players-table-cell is-numeric"
                                style={{ color: metricColor(qbWeek?.cpoe) }}
                              >
                                {formatSigned(qbWeek?.cpoe, 2)}
                              </td>
                              <td
                                className="gs-players-table-cell is-numeric"
                                style={{
                                  color: metricColor(
                                    qbWeek?.successRate == null ? null : qbWeek.successRate - 0.5
                                  ),
                                }}
                              >
                                {formatPct(qbWeek?.successRate, 1)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="gs-players-table-cell is-numeric">
                                {formatPct(entry.targetShare, 1)}
                              </td>
                              <td className="gs-players-table-cell is-numeric">
                                {formatPct(entry.airYardsShare, 1)}
                              </td>
                              <td className="gs-players-table-cell is-numeric">
                                {entry.wopr != null ? entry.wopr.toFixed(2) : '—'}
                              </td>
                            </>
                          )}
                          <td className="gs-players-table-cell is-numeric">
                            {entry.fantasyPointsPpr.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {gamelog.items.length > 1 &&
                    (() => {
                      const tot = gamelog.items.reduce(
                        (acc, e) => {
                          const qbWeek = isQb ? (qbRbsdmByWeek.get(e.week) ?? null) : null;
                          return {
                            passComp: acc.passComp + (e.passComp ?? 0),
                            passAtt: acc.passAtt + (e.passAtt ?? 0),
                            passYards: acc.passYards + (e.passYards ?? 0),
                            passTd: acc.passTd + (e.passTd ?? 0),
                            int: acc.int + (e.interceptionsThrown ?? 0),
                            passEpa: acc.passEpa + (e.passingEpa ?? 0),
                            passEpaCount: acc.passEpaCount + (e.passingEpa != null ? 1 : 0),
                            carries: acc.carries + (e.carries ?? 0),
                            rushYards: acc.rushYards + (e.rushYards ?? 0),
                            rushTd: acc.rushTd + (e.rushTd ?? 0),
                            rushEpa: acc.rushEpa + (e.rushingEpa ?? 0),
                            rushEpaCount: acc.rushEpaCount + (e.rushingEpa != null ? 1 : 0),
                            receptions: acc.receptions + (e.receptions ?? 0),
                            recYards: acc.recYards + (e.receivingYards ?? 0),
                            recTd: acc.recTd + (e.receivingTd ?? 0),
                            recEpa: acc.recEpa + (e.receivingEpa ?? 0),
                            recEpaCount: acc.recEpaCount + (e.receivingEpa != null ? 1 : 0),
                            targetShareSum: acc.targetShareSum + (e.targetShare ?? 0),
                            targetShareCount:
                              acc.targetShareCount + (e.targetShare != null ? 1 : 0),
                            airYardsShareSum: acc.airYardsShareSum + (e.airYardsShare ?? 0),
                            airYardsShareCount:
                              acc.airYardsShareCount + (e.airYardsShare != null ? 1 : 0),
                            woprSum: acc.woprSum + (e.wopr ?? 0),
                            woprCount: acc.woprCount + (e.wopr != null ? 1 : 0),
                            qbEpaCpoeSum: acc.qbEpaCpoeSum + (qbWeek?.epaCpoeComposite ?? 0),
                            qbEpaCpoeCount:
                              acc.qbEpaCpoeCount + (qbWeek?.epaCpoeComposite != null ? 1 : 0),
                            qbCpoeSum: acc.qbCpoeSum + (qbWeek?.cpoe ?? 0),
                            qbCpoeCount: acc.qbCpoeCount + (qbWeek?.cpoe != null ? 1 : 0),
                            qbSuccessRateSum: acc.qbSuccessRateSum + (qbWeek?.successRate ?? 0),
                            qbSuccessRateCount:
                              acc.qbSuccessRateCount + (qbWeek?.successRate != null ? 1 : 0),
                            ppr: acc.ppr + e.fantasyPointsPpr,
                          };
                        },
                        {
                          passComp: 0,
                          passAtt: 0,
                          passYards: 0,
                          passTd: 0,
                          int: 0,
                          passEpa: 0,
                          passEpaCount: 0,
                          carries: 0,
                          rushYards: 0,
                          rushTd: 0,
                          rushEpa: 0,
                          rushEpaCount: 0,
                          receptions: 0,
                          recYards: 0,
                          recTd: 0,
                          recEpa: 0,
                          recEpaCount: 0,
                          targetShareSum: 0,
                          targetShareCount: 0,
                          airYardsShareSum: 0,
                          airYardsShareCount: 0,
                          woprSum: 0,
                          woprCount: 0,
                          qbEpaCpoeSum: 0,
                          qbEpaCpoeCount: 0,
                          qbCpoeSum: 0,
                          qbCpoeCount: 0,
                          qbSuccessRateSum: 0,
                          qbSuccessRateCount: 0,
                          ppr: 0,
                        }
                      );
                      const dv = (n: number) => n || '—';
                      const avgNullable = (sum: number, count: number): number | null =>
                        count > 0 ? sum / count : null;
                      const fmtTotal = (sum: number, count: number) =>
                        count > 0 ? formatSigned(sum, 2) : '—';
                      return (
                        <tfoot>
                          <tr className="gs-player-detail-totals-row">
                            <td className="gs-players-table-cell is-sticky">TOT</td>
                            <td className="gs-players-table-cell" />
                            <td className="gs-players-table-cell" />
                            <td className="gs-players-table-cell is-numeric">{dv(tot.passComp)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.passAtt)}</td>
                            <td className="gs-players-table-cell is-numeric">
                              {dv(tot.passYards)}
                            </td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.passTd)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.int)}</td>
                            <td
                              className="gs-players-table-cell is-numeric"
                              style={{
                                color: metricColor(tot.passEpaCount > 0 ? tot.passEpa : null),
                              }}
                            >
                              {fmtTotal(tot.passEpa, tot.passEpaCount)}
                            </td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.carries)}</td>
                            <td className="gs-players-table-cell is-numeric">
                              {dv(tot.rushYards)}
                            </td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.rushTd)}</td>
                            <td
                              className="gs-players-table-cell is-numeric"
                              style={{
                                color: metricColor(tot.rushEpaCount > 0 ? tot.rushEpa : null),
                              }}
                            >
                              {fmtTotal(tot.rushEpa, tot.rushEpaCount)}
                            </td>
                            <td className="gs-players-table-cell is-numeric">
                              {dv(tot.receptions)}
                            </td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.recYards)}</td>
                            <td className="gs-players-table-cell is-numeric">{dv(tot.recTd)}</td>
                            <td
                              className="gs-players-table-cell is-numeric"
                              style={{
                                color: metricColor(tot.recEpaCount > 0 ? tot.recEpa : null),
                              }}
                            >
                              {fmtTotal(tot.recEpa, tot.recEpaCount)}
                            </td>
                            {isQb ? (
                              <>
                                <td
                                  className="gs-players-table-cell is-numeric"
                                  style={{
                                    color: metricColor(
                                      avgNullable(tot.qbEpaCpoeSum, tot.qbEpaCpoeCount)
                                    ),
                                  }}
                                >
                                  {formatSigned(
                                    avgNullable(tot.qbEpaCpoeSum, tot.qbEpaCpoeCount),
                                    3
                                  )}
                                </td>
                                <td
                                  className="gs-players-table-cell is-numeric"
                                  style={{
                                    color: metricColor(avgNullable(tot.qbCpoeSum, tot.qbCpoeCount)),
                                  }}
                                >
                                  {formatSigned(avgNullable(tot.qbCpoeSum, tot.qbCpoeCount), 2)}
                                </td>
                                <td
                                  className="gs-players-table-cell is-numeric"
                                  style={{
                                    color: metricColor(
                                      (() => {
                                        const v = avgNullable(
                                          tot.qbSuccessRateSum,
                                          tot.qbSuccessRateCount
                                        );
                                        return v == null ? null : v - 0.5;
                                      })()
                                    ),
                                  }}
                                >
                                  {formatPct(
                                    avgNullable(tot.qbSuccessRateSum, tot.qbSuccessRateCount),
                                    1
                                  )}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="gs-players-table-cell is-numeric">
                                  {formatPct(
                                    avgNullable(tot.targetShareSum, tot.targetShareCount),
                                    1
                                  )}
                                </td>
                                <td className="gs-players-table-cell is-numeric">
                                  {formatPct(
                                    avgNullable(tot.airYardsShareSum, tot.airYardsShareCount),
                                    1
                                  )}
                                </td>
                                <td className="gs-players-table-cell is-numeric">
                                  {(() => {
                                    const avgWopr = avgNullable(tot.woprSum, tot.woprCount);
                                    return avgWopr != null ? avgWopr.toFixed(2) : '—';
                                  })()}
                                </td>
                              </>
                            )}
                            <td className="gs-players-table-cell is-numeric">
                              {tot.ppr.toFixed(1)}
                            </td>
                          </tr>
                        </tfoot>
                      );
                    })()}
                </table>
              )}
              {gamelog.items.length === 0 && (
                <div className="gs-players-empty">
                  No gamelog rows found for the selected season.
                </div>
              )}
            </div>
            {gamelog.totalPages > 1 && (
              <div className="gs-players-pagination">
                {gamelog.page <= 1 ? (
                  <span className="gs-players-chip">Prev</span>
                ) : (
                  <Link
                    href={buildSelfHref(routeId, selectedSeason, Math.max(1, gamelog.page - 1))}
                    className="gs-players-btn is-subtle"
                  >
                    Prev
                  </Link>
                )}
                <span className="gs-players-chip">
                  Page {gamelog.page} / {gamelog.totalPages}
                </span>
                {gamelog.page >= gamelog.totalPages ? (
                  <span className="gs-players-chip">Next</span>
                ) : (
                  <Link
                    href={buildSelfHref(routeId, selectedSeason, gamelog.page + 1)}
                    className="gs-players-btn is-subtle"
                  >
                    Next
                  </Link>
                )}
              </div>
            )}
          </>
        )}

        {primaryTab === 'splits' && splitTab === 'home-away' && (
          <SplitsTable
            group={group}
            rows={[
              { label: 'Home', s: splits.home },
              { label: 'Away', s: splits.away },
            ]}
          />
        )}

        {primaryTab === 'splits' && splitTab === 'win-loss' && (
          <SplitsTable
            group={group}
            rows={[
              { label: 'Wins', s: splits.wins },
              { label: 'Losses', s: splits.losses },
            ]}
          />
        )}

        {primaryTab === 'splits' && splitTab === 'reg-post' && (
          <SplitsTable
            group={group}
            rows={[
              { label: 'Regular Season', s: splits.regular },
              { label: 'Postseason', s: splits.postseason },
            ]}
          />
        )}

        {primaryTab === 'splits' && splitTab === 'surface' && (
          <SplitsTable
            group={group}
            rows={[
              { label: 'Grass', s: splits.grass },
              { label: 'Turf', s: splits.turf },
            ]}
          />
        )}

        {primaryTab === 'splits' && splitTab === 'division' && (
          <SplitsTable
            group={group}
            rows={[
              { label: 'Division', s: splits.division },
              { label: 'Non-Division', s: splits.nondivision },
            ]}
          />
        )}
      </div>
    </section>
  );
}
