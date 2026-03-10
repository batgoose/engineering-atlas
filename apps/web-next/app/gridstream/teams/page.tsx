'use client';

/**
 * Route: /gridstream/teams?season=2024
 *
 * Teams directory — Division-grouped table (default) with sortable full table mode.
 * Leaderboard strip shows standings-derived stat leaders for the selected season.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  fetchGridstreamTeamsList,
  fetchGridstreamTeamStandings,
  fetchGridstreamTeamsDvoa,
  mergeTeamsWithStandings,
  formatTeamRecord,
  type GridstreamTeamListItem,
  type GridstreamTeamStanding,
  type GridstreamTeamDvoaSnapshot,
} from '@atlas/sdk/gridstream';
import { resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';

// Gridstream palette
const C = {
  bgDeep: '#050c18',
  textPrimary: '#d9ecf9',
  textSecondary: '#b2d0e6',
  textMuted: '#88abc5',
  accentCyan: '#00e5ff',
  linkCyan: '#63dfff',
  border: 'rgba(0,229,255,.15)',
} as const;

const remoteImageLoader = ({ src }: { src: string }) => src;

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);

const CURRENT_SEASON = 2025;
const SEASONS = Array.from({ length: CURRENT_SEASON - 2009 + 1 }, (_, i) => CURRENT_SEASON - i);

const CONFERENCE_ORDER = ['AFC', 'NFC'] as const;
const DIVISION_ORDER = ['East', 'North', 'South', 'West'] as const;

// ---------------------------------------------------------------------------
// Leaderboard strip data derived from standings
// ---------------------------------------------------------------------------

interface LeaderCard {
  label: string;
  value: string;
  subtitle: string;
  teamHrefAbbr?: string | null;
  color: string;
}

function buildLeaderCards(
  standings: GridstreamTeamStanding[],
  dvoaByTeam: Map<string, GridstreamTeamDvoaSnapshot>
): LeaderCard[] {
  if (!standings.length) return [];

  const byPpg = [...standings].sort((a, b) => (b.pointsFor ?? 0) - (a.pointsFor ?? 0));
  const byDppg = [...standings].sort((a, b) => (a.pointsAgainst ?? 999) - (b.pointsAgainst ?? 999));
  const byDiff = [...standings].sort((a, b) => (b.pointDiff ?? -999) - (a.pointDiff ?? -999));
  const byPct = [...standings].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const bySov = standings.filter((s) => s.sov != null).sort((a, b) => (b.sov ?? 0) - (a.sov ?? 0));
  const bySos = standings.filter((s) => s.sos != null).sort((a, b) => (b.sos ?? 0) - (a.sos ?? 0));

  const cards: LeaderCard[] = [];

  if (byPpg[0]) {
    const s = byPpg[0];
    const games = 17;
    cards.push({
      label: 'Top Offense',
      value: s.pointsFor != null ? `${(s.pointsFor / games).toFixed(1)} PPG` : '—',
      subtitle: `${s.shortDisplayName} · ${s.abbreviation}`,
      teamHrefAbbr: s.abbreviation,
      color: '#00e5ff',
    });
  }

  if (byDppg[0]) {
    const s = byDppg[0];
    const games = 17;
    cards.push({
      label: 'Top Defense',
      value: s.pointsAgainst != null ? `${(s.pointsAgainst / games).toFixed(1)} DPPG` : '—',
      subtitle: `${s.shortDisplayName} · ${s.abbreviation}`,
      teamHrefAbbr: s.abbreviation,
      color: '#8fff45',
    });
  }

  if (byDiff[0]) {
    const s = byDiff[0];
    const diff = s.pointDiff ?? 0;
    cards.push({
      label: 'Best Point Diff',
      value: `${diff > 0 ? '+' : ''}${diff}`,
      subtitle: `${s.shortDisplayName} · ${s.abbreviation}`,
      teamHrefAbbr: s.abbreviation,
      color: '#ffb612',
    });
  }

  if (byPct[0]) {
    const s = byPct[0];
    const topRecord = formatTeamRecord(s.wins, s.losses, s.ties);
    const ties = byPct.filter((x) => formatTeamRecord(x.wins, x.losses, x.ties) === topRecord);
    const tieAbbrs = ties.map((x) => x.abbreviation).sort();
    cards.push({
      label: ties.length > 1 ? `Best Record (T-${ties.length})` : 'Best Record',
      value: topRecord,
      subtitle:
        ties.length > 1 ? tieAbbrs.join(' · ') : `${s.shortDisplayName} · ${s.abbreviation}`,
      teamHrefAbbr: ties.length > 1 ? null : s.abbreviation,
      color: '#c084fc',
    });
  }

  if (bySov[0]) {
    const s = bySov[0];
    cards.push({
      label: 'Strength of Victory',
      value: (s.sov! * 100).toFixed(1) + '%',
      subtitle: `${s.shortDisplayName} · ${s.abbreviation}`,
      teamHrefAbbr: s.abbreviation,
      color: '#ff627e',
    });
  }

  if (bySos[0]) {
    const s = bySos[0];
    cards.push({
      label: 'Hardest Schedule',
      value: (s.sos! * 100).toFixed(1) + '% SOS',
      subtitle: `${s.shortDisplayName} · ${s.abbreviation}`,
      teamHrefAbbr: s.abbreviation,
      color: '#63dfff',
    });
  }

  const byDvoa = [...dvoaByTeam.values()]
    .filter((d) => d.totalDvoa != null)
    .sort((a, b) => (b.totalDvoa ?? -999) - (a.totalDvoa ?? -999));
  if (byDvoa[0]) {
    const d = byDvoa[0];
    const val = d.totalDvoa ?? 0;
    cards.push({
      label: 'Best DVOA',
      value: `${val > 0 ? '+' : ''}${val.toFixed(1)}%`,
      subtitle: `${d.teamShortDisplayName || d.teamAbbreviation} · ${d.teamAbbreviation}`,
      teamHrefAbbr: d.teamAbbreviation,
      color: '#8fff45',
    });
  }

  const bySpecialTeamsDvoa = [...dvoaByTeam.values()]
    .filter((d) => d.specialTeamsDvoa != null)
    .sort((a, b) => (b.specialTeamsDvoa ?? -999) - (a.specialTeamsDvoa ?? -999));
  if (bySpecialTeamsDvoa[0]) {
    const d = bySpecialTeamsDvoa[0];
    const val = d.specialTeamsDvoa ?? 0;
    cards.push({
      label: 'Best Special Teams DVOA',
      value: `${val > 0 ? '+' : ''}${val.toFixed(1)}%`,
      subtitle: `${d.teamShortDisplayName || d.teamAbbreviation} · ${d.teamAbbreviation}`,
      teamHrefAbbr: d.teamAbbreviation,
      color: '#ff9f43',
    });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// Sortable table column config
// ---------------------------------------------------------------------------

type SortKey =
  | 'displayName'
  | 'division'
  | 'wins'
  | 'losses'
  | 'ties'
  | 'pct'
  | 'pointsFor'
  | 'pointsAgainst'
  | 'pointDiff'
  | 'ppg'
  | 'papg'
  | 'dvoa'
  | 'seed'
  | 'divRank';

interface TableCol {
  key: SortKey;
  label: string;
  title?: string;
  numeric: boolean;
  defaultDir: 'asc' | 'desc';
}

const TABLE_COLS: TableCol[] = [
  { key: 'displayName', label: 'TEAM', numeric: false, defaultDir: 'asc' },
  { key: 'division', label: 'DIVISION', numeric: false, defaultDir: 'asc' },
  { key: 'wins', label: 'W', numeric: true, defaultDir: 'desc' },
  { key: 'losses', label: 'L', numeric: true, defaultDir: 'asc' },
  { key: 'ties', label: 'T', numeric: true, defaultDir: 'asc' },
  { key: 'pct', label: 'PCT', numeric: true, defaultDir: 'desc' },
  { key: 'seed', label: 'SEED', numeric: true, defaultDir: 'asc' },
  { key: 'pointsFor', label: 'PF', numeric: true, defaultDir: 'desc' },
  { key: 'pointsAgainst', label: 'PA', numeric: true, defaultDir: 'asc' },
  { key: 'pointDiff', label: 'DIFF', numeric: true, defaultDir: 'desc' },
  { key: 'ppg', label: 'PPG', title: 'Points Per Game', numeric: true, defaultDir: 'desc' },
  {
    key: 'papg',
    label: 'DPPG',
    title: 'Defense Points Per Game (lower is better)',
    numeric: true,
    defaultDir: 'asc',
  },
  { key: 'dvoa', label: 'DVOA', title: 'Total DVOA %', numeric: true, defaultDir: 'desc' },
];

const MOBILE_TABLE_COLS: TableCol[] = [
  { key: 'displayName', label: 'TEAM', numeric: false, defaultDir: 'asc' },
  { key: 'division', label: 'DIVISION', numeric: false, defaultDir: 'asc' },
  { key: 'wins', label: 'W-L-T', title: 'Record', numeric: false, defaultDir: 'desc' },
  { key: 'dvoa', label: 'DVOA', title: 'Total DVOA %', numeric: true, defaultDir: 'desc' },
];

function getSortValue(
  s: GridstreamTeamStanding,
  key: SortKey,
  dvoaByTeam: Map<string, GridstreamTeamDvoaSnapshot>
): number | string {
  const dvoa = dvoaByTeam.get(s.abbreviation) ?? null;
  if (key === 'displayName') return s.displayName;
  if (key === 'division') return s.division || '';
  if (key === 'wins') return s.wins ?? -1;
  if (key === 'losses') return s.losses ?? 99;
  if (key === 'ties') return s.ties ?? 99;
  if (key === 'pct') return s.pct ?? -1;
  if (key === 'seed') return s.seed ?? 99;
  if (key === 'pointsFor') return s.pointsFor ?? -1;
  if (key === 'pointsAgainst') return s.pointsAgainst ?? 9999;
  if (key === 'pointDiff') return s.pointDiff ?? -9999;
  if (key === 'ppg') return s.pointsFor != null ? s.pointsFor / 17 : -1;
  if (key === 'papg') return s.pointsAgainst != null ? s.pointsAgainst / 17 : 9999;
  if (key === 'dvoa') return dvoa?.totalDvoa ?? -999;
  if (key === 'divRank') return s.divRank ?? 99;
  return '';
}

type StatColorKey =
  | 'wins'
  | 'losses'
  | 'ties'
  | 'pct'
  | 'seed'
  | 'pointsFor'
  | 'pointsAgainst'
  | 'pointDiff'
  | 'ppg'
  | 'papg'
  | 'dvoa';

const STAT_COLOR_CONFIG: Record<StatColorKey, { higherIsBetter: boolean }> = {
  wins: { higherIsBetter: true },
  losses: { higherIsBetter: false },
  ties: { higherIsBetter: false },
  pct: { higherIsBetter: true },
  seed: { higherIsBetter: false },
  pointsFor: { higherIsBetter: true },
  pointsAgainst: { higherIsBetter: false },
  pointDiff: { higherIsBetter: true },
  ppg: { higherIsBetter: true },
  papg: { higherIsBetter: false },
  dvoa: { higherIsBetter: true },
};

function getStatValue(
  s: GridstreamTeamStanding,
  key: StatColorKey,
  dvoaByTeam: Map<string, GridstreamTeamDvoaSnapshot>
): number | null {
  if (key === 'wins') return s.wins ?? null;
  if (key === 'losses') return s.losses ?? null;
  if (key === 'ties') return s.ties ?? null;
  if (key === 'pct') return s.pct ?? null;
  if (key === 'seed') return s.seed ?? null;
  if (key === 'pointsFor') return s.pointsFor ?? null;
  if (key === 'pointsAgainst') return s.pointsAgainst ?? null;
  if (key === 'pointDiff') return s.pointDiff ?? null;
  if (key === 'ppg') return s.pointsFor != null ? s.pointsFor / 17 : null;
  if (key === 'papg') return s.pointsAgainst != null ? s.pointsAgainst / 17 : null;
  if (key === 'dvoa') return dvoaByTeam.get(s.abbreviation)?.totalDvoa ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GridstreamTeamsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const seasonParam = searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : CURRENT_SEASON;

  const [teams, setTeams] = useState<GridstreamTeamListItem[]>([]);
  const [standings, setStandings] = useState<GridstreamTeamStanding[]>([]);
  const [dvoaByTeam, setDvoaByTeam] = useState<Map<string, GridstreamTeamDvoaSnapshot>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableMode, setTableMode] = useState<'grouped' | 'sorted'>('grouped');
  const [sortKey, setSortKey] = useState<SortKey>('pct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpandedRows(new Set());
    Promise.all([
      fetchGridstreamTeamsList(API_BASE),
      fetchGridstreamTeamStandings(API_BASE, season),
      fetchGridstreamTeamsDvoa(API_BASE, { season, seasonType: 'REG' }).catch(() => ({
        season,
        seasonType: 'REG' as const,
        count: 0,
        results: [],
      })),
    ])
      .then(([t, s, d]) => {
        if (cancelled) return;
        setTeams(t.filter((team) => team.isActive));
        setStandings(s);
        const dvoaMap = new Map<string, GridstreamTeamDvoaSnapshot>();
        for (const row of d.results) {
          if (row.teamAbbreviation) dvoaMap.set(row.teamAbbreviation, row);
        }
        setDvoaByTeam(dvoaMap);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message ?? err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const merged = useMemo(() => mergeTeamsWithStandings(teams, standings), [teams, standings]);

  const groupedSections = useMemo(() => {
    const byDivision = new Map<string, GridstreamTeamStanding[]>();
    for (const s of standings) {
      const division = s.division || 'Other';
      const existing = byDivision.get(division);
      if (existing) existing.push(s);
      else byDivision.set(division, [s]);
    }

    const orderedDivisions = CONFERENCE_ORDER.flatMap((conf) =>
      DIVISION_ORDER.map((div) => `${conf} ${div}`)
    );

    const sortedDivisionKeys = [...byDivision.keys()].sort((a, b) => {
      const ia = orderedDivisions.indexOf(a);
      const ib = orderedDivisions.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    return sortedDivisionKeys.map((division) => ({
      division,
      teams: [...(byDivision.get(division) ?? [])].sort((a, b) => {
        const ra = a.divRank ?? 99;
        const rb = b.divRank ?? 99;
        if (ra !== rb) return ra - rb;
        return (b.pct ?? 0) - (a.pct ?? 0);
      }),
    }));
  }, [standings]);

  const isMobile = viewportWidth != null && viewportWidth <= 900;
  const isVeryNarrowMobile = viewportWidth != null && viewportWidth <= 380;
  const activeTableCols = isMobile ? MOBILE_TABLE_COLS : TABLE_COLS;
  const tableColumnCount = activeTableCols.length + (isMobile ? 1 : 0);

  const leaderCards = useMemo(
    () => buildLeaderCards(standings, dvoaByTeam),
    [standings, dvoaByTeam]
  );

  const sortedStandings = useMemo(() => {
    const arr = [...standings];
    arr.sort((a, b) => {
      if (sortKey === 'division') {
        const da = a.division || '';
        const db = b.division || '';
        const divCmp = sortDir === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
        if (divCmp !== 0) return divCmp;
        const ra = a.divRank ?? 99;
        const rb = b.divRank ?? 99;
        if (ra !== rb) return ra - rb;
        return (b.pct ?? 0) - (a.pct ?? 0);
      }

      const va = getSortValue(a, sortKey, dvoaByTeam);
      const vb = getSortValue(b, sortKey, dvoaByTeam);
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = va as number;
      const nb = vb as number;
      return sortDir === 'asc' ? na - nb : nb - na;
    });
    return arr;
  }, [standings, sortKey, sortDir, dvoaByTeam]);

  const statRanges = useMemo(() => {
    const keys = Object.keys(STAT_COLOR_CONFIG) as StatColorKey[];
    const ranges = {} as Record<StatColorKey, { min: number; max: number }>;

    for (const key of keys) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const s of standings) {
        const value = getStatValue(s, key, dvoaByTeam);
        if (value == null || Number.isNaN(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      ranges[key] =
        min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY
          ? { min: 0, max: 0 }
          : { min, max };
    }

    return ranges;
  }, [standings, dvoaByTeam]);

  const getStatCellColor = useCallback(
    (key: StatColorKey, value: number | null | undefined): string => {
      if (value == null || Number.isNaN(value)) return C.textMuted;
      const { min, max } = statRanges[key];
      let normalized = 0.5;
      if (max > min) normalized = (value - min) / (max - min);
      const score = STAT_COLOR_CONFIG[key].higherIsBetter ? normalized : 1 - normalized;
      const hue = Math.round(Math.max(0, Math.min(1, score)) * 120);
      return `hsl(${hue} 80% 62%)`;
    },
    [statRanges]
  );

  const handleSort = useCallback(
    (key: SortKey, defaultDir: 'asc' | 'desc') => {
      if (key === 'division') {
        setTableMode('grouped');
        setSortKey('division');
        setSortDir('asc');
        return;
      }

      setTableMode('sorted');
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(defaultDir);
      }
    },
    [sortKey]
  );

  const handleReturnToGroupedTable = useCallback(() => {
    setTableMode('grouped');
  }, []);

  const toggleRowExpanded = useCallback((abbr: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(abbr)) next.delete(abbr);
      else next.add(abbr);
      return next;
    });
  }, []);

  const handleSeasonChange = useCallback(
    (newSeason: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('season', String(newSeason));
      router.push(`/gridstream/teams?${params.toString()}`);
    },
    [router, searchParams]
  );

  const renderTableRow = (s: GridstreamTeamStanding) => {
    const teamData = merged.get(s.abbreviation);
    const dvoa = dvoaByTeam.get(s.abbreviation) ?? null;
    const team = teamData?.team ?? null;
    const logoUrl = team?.logoScoreboardUrl ?? team?.logoUrl ?? s.logoUrl ?? null;
    const games = 17;
    const ppg = s.pointsFor != null ? s.pointsFor / games : null;
    const papg = s.pointsAgainst != null ? s.pointsAgainst / games : null;
    const dvoaTotal = dvoa?.totalDvoa ?? null;
    const divisionLabel = `${s.division}${s.divRank != null ? ` (${s.divRank})` : ''}`;
    const divisionParts = (s.division || '').trim().split(/\s+/).filter(Boolean);
    const divisionCompactLabel = `${divisionParts[0]?.toUpperCase() ?? ''}${
      divisionParts.length > 1
        ? (divisionParts[divisionParts.length - 1][0] ?? '').toUpperCase()
        : ''
    }${s.divRank ?? ''}`;
    const compactRecord = `${s.wins ?? '—'}-${s.losses ?? '—'}-${s.ties ?? 0}`;

    if (isMobile) {
      const expanded = expandedRows.has(s.abbreviation);
      return (
        <Fragment key={s.abbreviation}>
          <tr
            style={{ transition: 'background .15s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,229,255,.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <td style={{ ...tdBase, padding: '8px 10px', width: '100%' }}>
              <Link
                href={`/gridstream/teams/${s.abbreviation}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textDecoration: 'none',
                  minWidth: 0,
                }}
              >
                {logoUrl && (
                  <Image
                    src={logoUrl}
                    alt=""
                    width={22}
                    height={22}
                    unoptimized
                    loader={remoteImageLoader}
                    style={{ objectFit: 'contain' }}
                  />
                )}
                <span
                  style={{
                    color: C.textPrimary,
                    fontWeight: 500,
                    fontSize: 13,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.shortDisplayName}
                </span>
              </Link>
            </td>
            <td style={{ ...tdMono, padding: '8px 6px' }}>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleReturnToGroupedTable();
                }}
                title="Return to division-grouped table"
                style={divisionChipButtonStyle}
              >
                {divisionCompactLabel || divisionLabel}
              </button>
            </td>
            <td style={{ ...tdMono, padding: '8px 6px', color: getStatCellColor('wins', s.wins) }}>
              {compactRecord}
            </td>
            <td
              style={{ ...tdMono, padding: '8px 6px', color: getStatCellColor('dvoa', dvoaTotal) }}
            >
              {dvoaTotal != null
                ? dvoaTotal > 0
                  ? `+${dvoaTotal.toFixed(1)}%`
                  : `${dvoaTotal.toFixed(1)}%`
                : '—'}
            </td>
            <td style={{ ...tdMono, padding: '8px 6px', textAlign: 'right' }}>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleRowExpanded(s.abbreviation);
                }}
                style={mobileMoreButtonStyle}
              >
                {expanded ? 'Less' : 'More'}
              </button>
            </td>
          </tr>
          {expanded && (
            <tr style={{ background: 'rgba(0,16,32,.7)' }}>
              <td colSpan={tableColumnCount} style={mobileDetailCellStyle}>
                <div style={mobileDetailGridStyle}>
                  <div style={mobileDetailItemStyle}>
                    <span style={mobileDetailLabelStyle}>SEED</span>
                    <span
                      style={{ ...mobileDetailValueStyle, color: getStatCellColor('seed', s.seed) }}
                    >
                      {s.seed != null ? `#${s.seed}` : '—'}
                    </span>
                  </div>
                  <div style={mobileDetailItemStyle}>
                    <span style={mobileDetailLabelStyle}>PF</span>
                    <span
                      style={{
                        ...mobileDetailValueStyle,
                        color: getStatCellColor('pointsFor', s.pointsFor),
                      }}
                    >
                      {s.pointsFor ?? '—'}
                    </span>
                  </div>
                  <div style={mobileDetailItemStyle}>
                    <span style={mobileDetailLabelStyle}>PA</span>
                    <span
                      style={{
                        ...mobileDetailValueStyle,
                        color: getStatCellColor('pointsAgainst', s.pointsAgainst),
                      }}
                    >
                      {s.pointsAgainst ?? '—'}
                    </span>
                  </div>
                  <div style={mobileDetailItemStyle}>
                    <span style={mobileDetailLabelStyle}>DIFF</span>
                    <span
                      style={{
                        ...mobileDetailValueStyle,
                        color: getStatCellColor('pointDiff', s.pointDiff),
                      }}
                    >
                      {s.pointDiff != null
                        ? s.pointDiff > 0
                          ? `+${s.pointDiff}`
                          : String(s.pointDiff)
                        : '—'}
                    </span>
                  </div>
                  <div style={mobileDetailItemStyle}>
                    <span style={mobileDetailLabelStyle}>PPG</span>
                    <span
                      style={{ ...mobileDetailValueStyle, color: getStatCellColor('ppg', ppg) }}
                    >
                      {ppg != null ? ppg.toFixed(1) : '—'}
                    </span>
                  </div>
                  <div style={mobileDetailItemStyle}>
                    <span style={mobileDetailLabelStyle}>DPPG</span>
                    <span
                      style={{ ...mobileDetailValueStyle, color: getStatCellColor('papg', papg) }}
                    >
                      {papg != null ? papg.toFixed(1) : '—'}
                    </span>
                  </div>
                </div>
              </td>
            </tr>
          )}
        </Fragment>
      );
    }

    return (
      <tr
        key={s.abbreviation}
        style={{ transition: 'background .15s' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,229,255,.04)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <td style={tdBase}>
          <Link
            href={`/gridstream/teams/${s.abbreviation}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textDecoration: 'none',
              minWidth: 0,
            }}
          >
            {logoUrl && (
              <Image
                src={logoUrl}
                alt=""
                width={24}
                height={24}
                unoptimized
                loader={remoteImageLoader}
                style={{ objectFit: 'contain' }}
              />
            )}
            <span
              style={{
                color: C.textPrimary,
                fontWeight: 500,
                fontSize: 14,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.shortDisplayName}
            </span>
          </Link>
        </td>
        <td style={tdMono}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleReturnToGroupedTable();
            }}
            title="Return to division-grouped table"
            style={divisionChipButtonStyle}
          >
            {divisionLabel}
          </button>
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('wins', s.wins) }}>{s.wins ?? '—'}</td>
        <td style={{ ...tdMono, color: getStatCellColor('losses', s.losses) }}>
          {s.losses ?? '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('ties', s.ties) }}>{s.ties ?? '—'}</td>
        <td style={{ ...tdMono, color: getStatCellColor('pct', s.pct) }}>
          {s.pct != null ? s.pct.toFixed(3) : '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('seed', s.seed) }}>
          {s.seed != null ? `#${s.seed}` : '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('pointsFor', s.pointsFor) }}>
          {s.pointsFor ?? '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('pointsAgainst', s.pointsAgainst) }}>
          {s.pointsAgainst ?? '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('pointDiff', s.pointDiff) }}>
          {s.pointDiff != null ? (s.pointDiff > 0 ? `+${s.pointDiff}` : String(s.pointDiff)) : '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('ppg', ppg) }}>
          {ppg != null ? ppg.toFixed(1) : '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('papg', papg) }}>
          {papg != null ? papg.toFixed(1) : '—'}
        </td>
        <td style={{ ...tdMono, color: getStatCellColor('dvoa', dvoaTotal) }}>
          {dvoaTotal != null
            ? dvoaTotal > 0
              ? `+${dvoaTotal.toFixed(1)}%`
              : `${dvoaTotal.toFixed(1)}%`
            : '—'}
        </td>
      </tr>
    );
  };

  return (
    <main
      className="gs-players-page"
      style={{
        color: C.textPrimary,
        background:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 6px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 6px), radial-gradient(1200px 520px at 50% -180px, rgba(0,229,255,0.09), transparent 65%), linear-gradient(180deg, #0b1625 0%, #081323 36%, #07111f 100%)',
      }}
    >
      <div style={{ padding: '34px 20px 60px' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', display: 'grid', gap: 18 }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <div
                style={{
                  color: C.accentCyan,
                  fontSize: 12,
                  letterSpacing: '.14em',
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: 700,
                }}
              >
                GRIDSTREAM / TEAMS
              </div>
              <h1
                style={{
                  margin: '8px 0 0',
                  fontSize: 'clamp(22px, 3vw, 38px)',
                  letterSpacing: '.03em',
                }}
              >
                Team Database
              </h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              {/* Season picker */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    color: C.textMuted,
                    fontSize: 12,
                    letterSpacing: '.06em',
                    fontFamily: "'Orbitron', monospace",
                  }}
                >
                  SEASON
                </span>
                <select
                  value={season}
                  onChange={(e) => handleSeasonChange(Number(e.target.value))}
                  style={seasonSelectStyle}
                >
                  {SEASONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <Link
                href="/gridstream"
                style={{
                  color: C.linkCyan,
                  textDecoration: 'none',
                  fontSize: 12,
                  letterSpacing: '.08em',
                }}
              >
                ← BACK TO HUB
              </Link>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                background: 'rgba(255,98,126,.15)',
                border: '1px solid rgba(255,98,126,.4)',
                padding: '10px 14px',
                fontSize: 13,
                color: '#ff8fa0',
              }}
            >
              {error}
            </div>
          )}

          {/* Leaderboard strip */}
          {!loading && leaderCards.length > 0 && (
            <section
              style={{
                display: 'grid',
                gap: isMobile ? 8 : 10,
                gridTemplateColumns: isMobile
                  ? isVeryNarrowMobile
                    ? '1fr'
                    : 'repeat(2, minmax(0, 1fr))'
                  : 'repeat(auto-fit, minmax(200px, 1fr))',
              }}
            >
              {leaderCards.map((card) => (
                <LeaderCard key={card.label} card={card} color={card.color} />
              ))}
            </section>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div
              style={{
                color: C.textMuted,
                fontSize: 13,
                padding: '24px 0',
                textAlign: 'center',
                letterSpacing: '.06em',
              }}
            >
              LOADING…
            </div>
          )}

          {!loading && (
            <section
              style={{
                border: `1px solid ${C.border}`,
                background: 'rgba(0,18,38,.82)',
                overflowX: 'auto',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: isMobile ? 0 : 860,
                }}
              >
                <thead>
                  <tr>
                    {activeTableCols.map((col) => (
                      <th
                        key={col.key}
                        title={col.title}
                        onClick={() => handleSort(col.key, col.defaultDir)}
                        style={{
                          ...thBase,
                          cursor: 'pointer',
                          color:
                            tableMode === 'sorted' && sortKey === col.key
                              ? C.accentCyan
                              : C.textMuted,
                          userSelect: 'none',
                          padding: isMobile ? '9px 6px' : thBase.padding,
                          fontSize: isMobile ? 10 : thBase.fontSize,
                        }}
                      >
                        {col.label}
                        {tableMode === 'sorted' && sortKey === col.key && (
                          <span style={{ marginLeft: 4, fontSize: 9 }}>
                            {sortDir === 'desc' ? '▼' : '▲'}
                          </span>
                        )}
                      </th>
                    ))}
                    {isMobile && <th style={{ ...thBase, padding: '9px 6px', width: 50 }} />}
                  </tr>
                </thead>
                <tbody>
                  {tableMode === 'grouped' ? (
                    groupedSections.map((section) => (
                      <Fragment key={section.division}>
                        <tr>
                          <td colSpan={tableColumnCount} style={divisionSectionCellStyle}>
                            <button
                              type="button"
                              style={divisionSectionButtonStyle}
                              onClick={handleReturnToGroupedTable}
                              title="Return to division-grouped table"
                            >
                              {section.division}
                            </button>
                          </td>
                        </tr>
                        {section.teams.map((s) => renderTableRow(s))}
                      </Fragment>
                    ))
                  ) : (
                    <>{sortedStandings.map((s) => renderTableRow(s))}</>
                  )}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LeaderCard({ card, color }: { card: LeaderCard; color: string }) {
  const body = (
    <>
      <div style={{ color, fontWeight: 700, fontSize: 16, lineHeight: 1.2, marginBottom: 2 }}>
        {card.value}
      </div>
      <div style={{ color: C.textSecondary, fontSize: 12 }}>{card.subtitle}</div>
    </>
  );

  return (
    <article
      style={{
        border: `1px solid rgba(0,229,255,.18)`,
        background: 'rgba(0,18,38,.78)',
        padding: '12px 14px',
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div
        style={{
          color: C.textMuted,
          fontSize: 10,
          letterSpacing: '.09em',
          fontFamily: "'Orbitron', monospace",
          marginBottom: 6,
        }}
      >
        {card.label}
      </div>
      {card.teamHrefAbbr ? (
        <Link href={`/gridstream/teams/${card.teamHrefAbbr}`} style={{ textDecoration: 'none' }}>
          {body}
        </Link>
      ) : (
        <div>{body}</div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const seasonSelectStyle: CSSProperties = {
  background: 'rgba(0,18,38,.8)',
  border: '1px solid rgba(0,229,255,.25)',
  color: '#d9ecf9',
  padding: '4px 10px',
  fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
  outline: 'none',
};

const thBase: CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  borderBottom: '1px solid rgba(0,229,255,.15)',
  fontSize: 11,
  letterSpacing: '.08em',
  fontFamily: "'Orbitron', monospace",
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const tdBase: CSSProperties = {
  padding: '9px 12px',
  borderBottom: '1px solid rgba(0,229,255,.06)',
  fontSize: 14,
};

const tdMono: CSSProperties = {
  padding: '9px 12px',
  borderBottom: '1px solid rgba(0,229,255,.06)',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  color: '#9fc3db',
  whiteSpace: 'nowrap',
};

const divisionSectionCellStyle: CSSProperties = {
  padding: '8px 12px',
  borderTop: '1px solid rgba(0,229,255,.16)',
  borderBottom: '1px solid rgba(0,229,255,.1)',
  background: 'rgba(0,10,22,.66)',
};

const divisionSectionButtonStyle: CSSProperties = {
  appearance: 'none',
  border: 'none',
  background: 'transparent',
  color: C.accentCyan,
  fontFamily: "'Orbitron', monospace",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.08em',
  cursor: 'pointer',
  padding: 0,
};

const divisionChipButtonStyle: CSSProperties = {
  appearance: 'none',
  border: '1px solid rgba(0,229,255,.15)',
  background: 'rgba(0,10,22,.55)',
  color: C.textMuted,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  letterSpacing: '.04em',
  borderRadius: 3,
  padding: '1px 6px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const mobileMoreButtonStyle: CSSProperties = {
  appearance: 'none',
  border: '1px solid rgba(0,229,255,.2)',
  background: 'rgba(0,10,22,.55)',
  color: '#9fc3db',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  borderRadius: 3,
  padding: '1px 6px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const mobileDetailCellStyle: CSSProperties = {
  padding: '10px 8px',
  borderBottom: '1px solid rgba(0,229,255,.06)',
};

const mobileDetailGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
};

const mobileDetailItemStyle: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '6px 8px',
  border: '1px solid rgba(0,229,255,.12)',
  background: 'rgba(0,10,20,.5)',
};

const mobileDetailLabelStyle: CSSProperties = {
  fontSize: 9,
  color: '#6f9ab8',
  letterSpacing: '.06em',
  fontFamily: "'Orbitron', monospace",
};

const mobileDetailValueStyle: CSSProperties = {
  fontSize: 12,
  fontFamily: "'JetBrains Mono', monospace",
  whiteSpace: 'nowrap',
};
