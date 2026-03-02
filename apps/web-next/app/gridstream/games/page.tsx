'use client';

/**
 * Route: /gridstream/games?season=2025&week=22
 *
 * Week-by-week game browser for all NFL seasons (1999–2025).
 * Click a card to open the game view at /gridstream/games/{id}.
 */

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { ApiGameLeader, ApiGameListItem } from '@atlas/sdk/gridstream/api-transforms';
import { gameStatusDisplay, resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';
import { gridstreamColors as C } from '@atlas/sdk/gridstream/theme';
import { StarField } from '@/components/gridstream/StarField';
import { WeekBrowser } from '@/components/gridstream/WeekBrowser';
import { GameCard, type GameCardInjurySummary } from '@/components/gridstream/GameCard';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);

const DEFAULT_SEASON = 2025;
const DEFAULT_WEEK = 22;
const MAX_LEADER_BACKFILL_REQUESTS = 20;
const MAX_INJURY_BACKFILL_REQUESTS = 24;
const REQUIRED_LEADER_CATEGORIES = ['passing', 'rushing', 'receiving'] as const;
const UI_POSTSEASON_WEEK_TO_API_WEEK: Record<number, number> = { 19: 1, 20: 2, 21: 3, 22: 5 };
const API_POSTSEASON_WEEK_TO_UI_WEEK: Record<number, number> = { 1: 19, 2: 20, 3: 21, 5: 22 };

interface ApiStandingRow {
  team?: {
    abbreviation?: string;
  };
  seed?: number | null;
}

interface ApiGameInjuryRow {
  team_abbr?: string | null;
  player_name?: string | null;
  status?: string | null;
  game_day_availability?: string | null;
}

interface ApiGameDetailForInjuries {
  injuries?: ApiGameInjuryRow[];
  home_qb_name?: string | null;
  away_qb_name?: string | null;
}

interface TeamOption {
  abbreviation: string;
  name: string;
  city: string;
  logoUrl: string;
  cardLogoUrl: string;
  conference: string;
  division: string;
  divisionKey: string;
}

function deriveCityFromDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) return trimmed;
  return parts.slice(0, -1).join(' ');
}

const DIVISION_ORDER = ['NFCE', 'NFCW', 'NFCN', 'NFCS', 'AFCE', 'AFCW', 'AFCN', 'AFCS'] as const;

const DIVISION_LABEL: Record<string, string> = {
  NFCE: 'NFC EAST',
  NFCW: 'NFC WEST',
  NFCN: 'NFC NORTH',
  NFCS: 'NFC SOUTH',
  AFCE: 'AFC EAST',
  AFCW: 'AFC WEST',
  AFCN: 'AFC NORTH',
  AFCS: 'AFC SOUTH',
  OTHER: 'OTHER',
};

const DIVISION_BY_TEAM_ABBR: Record<string, string> = {
  ARI: 'NFCW',
  ATL: 'NFCS',
  CAR: 'NFCS',
  CHI: 'NFCN',
  DAL: 'NFCE',
  DET: 'NFCN',
  GB: 'NFCN',
  LAR: 'NFCW',
  MIN: 'NFCN',
  NO: 'NFCS',
  NYG: 'NFCE',
  PHI: 'NFCE',
  SF: 'NFCW',
  SEA: 'NFCW',
  TB: 'NFCS',
  WAS: 'NFCE',
  BUF: 'AFCE',
  MIA: 'AFCE',
  NE: 'AFCE',
  NYJ: 'AFCE',
  BAL: 'AFCN',
  CIN: 'AFCN',
  CLE: 'AFCN',
  PIT: 'AFCN',
  HOU: 'AFCS',
  IND: 'AFCS',
  JAX: 'AFCS',
  TEN: 'AFCS',
  DEN: 'AFCW',
  KC: 'AFCW',
  LV: 'AFCW',
  LAC: 'AFCW',
  WSH: 'NFCE',
  JAC: 'AFCS',
  OAK: 'AFCW',
  SD: 'AFCW',
  STL: 'NFCW',
  LA: 'NFCW',
};

function normalizeConference(raw?: string): 'AFC' | 'NFC' | '' {
  const conf = (raw ?? '').toUpperCase().trim();
  if (!conf) return '';
  if (conf.includes('AFC') || conf.includes('AMERICAN')) return 'AFC';
  if (conf.includes('NFC') || conf.includes('NATIONAL')) return 'NFC';
  return '';
}

function deriveDivisionKey(conference?: string, division?: string, abbreviation?: string): string {
  const conf = normalizeConference(conference);
  const div = (division ?? '').toUpperCase().trim();
  const directionMatch = div.match(/\b(EAST|WEST|NORTH|SOUTH)\b/);
  const confPrefix = conf || (div.startsWith('AFC') ? 'AFC' : div.startsWith('NFC') ? 'NFC' : '');
  const direction = directionMatch?.[1]?.[0] ?? '';
  if (confPrefix && direction) return `${confPrefix}${direction}`;
  if (abbreviation) return DIVISION_BY_TEAM_ABBR[abbreviation.toUpperCase()] ?? 'OTHER';
  return 'OTHER';
}

function divisionSortIndex(divisionKey: string): number {
  const idx = DIVISION_ORDER.indexOf(divisionKey as (typeof DIVISION_ORDER)[number]);
  return idx === -1 ? DIVISION_ORDER.length : idx;
}

interface TeamLogoAsset {
  logo_type?: string;
  url?: string | null;
}

function resolveTeamLogo(logos?: TeamLogoAsset[]): string {
  if (!logos || logos.length === 0) return '';
  const byType = new Map(logos.map((logo) => [logo.logo_type ?? '', logo.url ?? '']));
  return byType.get('dark') || byType.get('default') || logos.find((logo) => !!logo.url)?.url || '';
}

function resolveTeamCardLogo(logos?: TeamLogoAsset[]): string {
  if (!logos || logos.length === 0) return '';
  const byType = new Map(logos.map((logo) => [logo.logo_type ?? '', logo.url ?? '']));
  return (
    byType.get('dark') ||
    byType.get('scoreboard') ||
    byType.get('scoreboard-dark') ||
    byType.get('default') ||
    logos.find((logo) => !!logo.url)?.url ||
    ''
  );
}

type BoxscorePlayerRow = {
  player_name?: string | null;
  player_position?: string | null;
  completions?: number | null;
  pass_attempts?: number | null;
  passing_yards?: number | null;
  passing_tds?: number | null;
  interceptions_thrown?: number | null;
  carries?: number | null;
  rushing_yards?: number | null;
  rushing_tds?: number | null;
  receptions?: number | null;
  receiving_yards?: number | null;
  receiving_tds?: number | null;
};

type BoxscorePlayersByTeam = Record<string, BoxscorePlayerRow[]>;

function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function pickBestPlayer(
  rows: BoxscorePlayerRow[],
  predicate: (row: BoxscorePlayerRow) => boolean,
  score: (row: BoxscorePlayerRow) => number
): BoxscorePlayerRow | null {
  let best: BoxscorePlayerRow | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!predicate(row)) continue;
    const rowScore = score(row);
    if (rowScore > bestScore) {
      best = row;
      bestScore = rowScore;
    }
  }
  return best;
}

function formatPassingLine(row: BoxscorePlayerRow): string {
  const comp = toInt(row.completions);
  const att = toInt(row.pass_attempts);
  const yds = toInt(row.passing_yards);
  const tds = toInt(row.passing_tds);
  const ints = toInt(row.interceptions_thrown);
  const parts = [`${comp}/${att}`, `${yds} YDS`];
  if (tds > 0) parts.push(`${tds} TD`);
  if (ints > 0) parts.push(`${ints} INT`);
  return parts.join(', ');
}

function formatRushingLine(row: BoxscorePlayerRow): string {
  const carries = toInt(row.carries);
  const yds = toInt(row.rushing_yards);
  const tds = toInt(row.rushing_tds);
  const parts = [`${carries} CAR`, `${yds} YDS`];
  if (tds > 0) parts.push(`${tds} TD`);
  return parts.join(', ');
}

function formatReceivingLine(row: BoxscorePlayerRow): string {
  const catches = toInt(row.receptions);
  const yds = toInt(row.receiving_yards);
  const tds = toInt(row.receiving_tds);
  const parts = [`${catches} REC`, `${yds} YDS`];
  if (tds > 0) parts.push(`${tds} TD`);
  return parts.join(', ');
}

function formatQbRushingLine(row: BoxscorePlayerRow): string {
  const carries = toInt(row.carries);
  const yds = toInt(row.rushing_yards);
  const tds = toInt(row.rushing_tds);
  if (carries === 0 && yds === 0 && tds === 0) return '';
  const parts = [`${carries} CAR`, `${yds} YDS`];
  if (tds > 0) parts.push(`${tds} TD`);
  return parts.join(', ');
}

function normalizePlayerName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function injuryStatusLabel(row: ApiGameInjuryRow): string {
  return (row.game_day_availability || row.status || '').trim();
}

function normalizeNameKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function injuryStatusCode(status: string): string {
  const upper = status.toUpperCase();
  if (upper.includes('OUT')) return 'OUT';
  if (upper.includes('DOUBT')) return 'D';
  if (upper.includes('QUESTION')) return 'Q';
  if (upper.includes('IR')) return 'IR';
  if (upper.includes('SUSP')) return 'SUSP';
  if (upper.includes('PUP')) return 'PUP';
  if (upper.includes('NFI')) return 'NFI';
  if (upper.includes('PROB')) return 'P';
  const compact = upper.replace(/[^A-Z]/g, '');
  return compact.slice(0, 3) || 'INJ';
}

function injurySeverity(status: string): number {
  const upper = status.toUpperCase();
  if (upper.includes('OUT') || upper.includes('IR')) return 5;
  if (upper.includes('DOUBT')) return 4;
  if (upper.includes('QUESTION')) return 3;
  if (upper.includes('PROB')) return 1;
  return 2;
}

function injuryDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Unknown';
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? trimmed;
}

function buildTeamInjurySummary(
  rows: ApiGameInjuryRow[],
  teamAbbr: string,
  qbName: string | null | undefined
): { flags: string[]; count: number } {
  const teamRows = rows
    .filter((row) => (row.team_abbr ?? '').toUpperCase().trim() === teamAbbr)
    .map((row) => ({ row, status: injuryStatusLabel(row) }))
    .filter((entry) => entry.status.length > 0)
    .filter((entry) => !/^(ACTIVE|AVAILABLE|HEALTHY)$/i.test(entry.status));

  if (teamRows.length === 0) return { flags: [], count: 0 };

  const qbKey = normalizeNameKey(qbName);
  const qbMatch = qbKey
    ? teamRows.find((entry) => normalizeNameKey(entry.row.player_name) === qbKey)
    : undefined;

  const flags: string[] = [];
  if (qbMatch) {
    flags.push(`QB ${injuryStatusCode(qbMatch.status)}`);
  }

  const sortedRows = [...teamRows].sort(
    (a, b) => injurySeverity(b.status) - injurySeverity(a.status)
  );
  for (const entry of sortedRows) {
    if (flags.length >= 2) break;
    if (
      qbMatch &&
      normalizeNameKey(entry.row.player_name) === normalizeNameKey(qbMatch.row.player_name)
    ) {
      continue;
    }
    flags.push(`${injuryDisplayName(entry.row.player_name)} ${injuryStatusCode(entry.status)}`);
  }

  return { flags, count: teamRows.length };
}

function buildGameInjurySummary(
  game: ApiGameListItem,
  detail: ApiGameDetailForInjuries
): GameCardInjurySummary | null {
  const rows = Array.isArray(detail.injuries) ? detail.injuries : [];
  if (rows.length === 0) return null;
  const away = buildTeamInjurySummary(
    rows,
    game.away_team_detail.abbreviation,
    detail.away_qb_name ?? game.away_qb_name ?? null
  );
  const home = buildTeamInjurySummary(
    rows,
    game.home_team_detail.abbreviation,
    detail.home_qb_name ?? game.home_qb_name ?? null
  );
  if (away.count === 0 && home.count === 0) return null;
  return {
    awayFlags: away.flags,
    homeFlags: home.flags,
    awayCount: away.count,
    homeCount: home.count,
  };
}

function deriveLeadersFromPlayerStats(
  playersByTeam: BoxscorePlayersByTeam,
  teamAbbrs: string[]
): ApiGameLeader[] {
  const results: ApiGameLeader[] = [];
  for (const teamAbbr of teamAbbrs) {
    const rows = Array.isArray(playersByTeam?.[teamAbbr]) ? playersByTeam[teamAbbr] : [];
    if (rows.length === 0) continue;

    const passing = pickBestPlayer(
      rows,
      (row) =>
        toInt(row.pass_attempts) > 0 ||
        toInt(row.passing_yards) !== 0 ||
        toInt(row.passing_tds) > 0,
      (row) =>
        toInt(row.passing_yards) * 10000 + toInt(row.passing_tds) * 100 + toInt(row.pass_attempts)
    );
    if (passing) {
      const qbRushingLine = formatQbRushingLine(passing);
      results.push({
        team_abbr: teamAbbr,
        category: 'passing',
        athlete_name: passing.player_name || '—',
        display_value: qbRushingLine
          ? `${formatPassingLine(passing)}\n${qbRushingLine}`
          : formatPassingLine(passing),
      });
    }

    const rushing = pickBestPlayer(
      rows,
      (row) =>
        toInt(row.carries) > 0 || toInt(row.rushing_yards) !== 0 || toInt(row.rushing_tds) > 0,
      (row) => toInt(row.rushing_yards) * 10000 + toInt(row.rushing_tds) * 100 + toInt(row.carries)
    );
    if (rushing) {
      results.push({
        team_abbr: teamAbbr,
        category: 'rushing',
        athlete_name: rushing.player_name || '—',
        display_value: formatRushingLine(rushing),
      });
    }

    const receiving = pickBestPlayer(
      rows,
      (row) =>
        toInt(row.receptions) > 0 ||
        toInt(row.receiving_yards) !== 0 ||
        toInt(row.receiving_tds) > 0,
      (row) =>
        toInt(row.receiving_yards) * 10000 + toInt(row.receiving_tds) * 100 + toInt(row.receptions)
    );
    if (receiving) {
      results.push({
        team_abbr: teamAbbr,
        category: 'receiving',
        athlete_name: receiving.player_name || '—',
        display_value: formatReceivingLine(receiving),
      });
    }
  }
  return results;
}

function mergeLeaders(
  existing: ApiGameLeader[],
  fallbackLeaders: ApiGameLeader[],
  awayTeamAbbr: string,
  homeTeamAbbr: string
): ApiGameLeader[] {
  const merged = [...existing];
  for (const teamAbbr of [awayTeamAbbr, homeTeamAbbr]) {
    for (const category of REQUIRED_LEADER_CATEGORIES) {
      const current = merged.find(
        (leader) => leader.team_abbr === teamAbbr && leader.category === category
      );
      const hasCurrentData = !!(
        current &&
        current.athlete_name &&
        current.display_value &&
        current.athlete_name !== '—' &&
        current.display_value !== '—'
      );
      if (hasCurrentData) continue;
      const fallback = fallbackLeaders.find(
        (leader) => leader.team_abbr === teamAbbr && leader.category === category
      );
      if (!fallback) continue;
      if (current) {
        current.athlete_name = fallback.athlete_name;
        current.display_value = fallback.display_value;
      } else {
        merged.push(fallback);
      }
    }
  }
  return merged;
}

function enrichPassingLeadersWithQbRushing(
  leaders: ApiGameLeader[],
  playersByTeam: BoxscorePlayersByTeam,
  teamAbbrs: string[]
): ApiGameLeader[] {
  const enriched = leaders.map((leader) => ({ ...leader }));

  for (const teamAbbr of teamAbbrs) {
    const passingLeader = enriched.find(
      (leader) => leader.team_abbr === teamAbbr && leader.category === 'passing'
    );
    if (!passingLeader) continue;

    const rows = Array.isArray(playersByTeam?.[teamAbbr]) ? playersByTeam[teamAbbr] : [];
    if (rows.length === 0) continue;

    const leaderName = normalizePlayerName(passingLeader.athlete_name);
    const passingRow =
      rows.find((row) => normalizePlayerName(row.player_name) === leaderName) ??
      pickBestPlayer(
        rows,
        (row) =>
          toInt(row.pass_attempts) > 0 ||
          toInt(row.passing_yards) !== 0 ||
          toInt(row.passing_tds) > 0,
        (row) =>
          toInt(row.passing_yards) * 10000 + toInt(row.passing_tds) * 100 + toInt(row.pass_attempts)
      );

    if (!passingRow) continue;

    const qbRushingLine = formatQbRushingLine(passingRow);
    if (!qbRushingLine) continue;
    if (passingLeader.display_value.includes(qbRushingLine)) continue;

    const primaryLine =
      passingLeader.display_value.split(/\n+/)[0]?.trim() || formatPassingLine(passingRow);
    passingLeader.display_value = `${primaryLine}\n${qbRushingLine}`;
  }

  return enriched;
}

function leadersSignature(leaders: ApiGameLeader[]): string {
  return [...leaders]
    .map(
      (leader) =>
        `${leader.team_abbr}|${leader.category}|${leader.athlete_name}|${leader.display_value}`
    )
    .sort()
    .join('||');
}

export default function GamesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const teamMenuRef = useRef<HTMLDivElement | null>(null);

  const season = Number(searchParams.get('season') ?? DEFAULT_SEASON);
  const week = Number(searchParams.get('week') ?? DEFAULT_WEEK);

  const [games, setGames] = useState<ApiGameListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamSeedsByAbbr, setTeamSeedsByAbbr] = useState<Record<string, number | null>>({});
  const [injurySummaryByGameId, setInjurySummaryByGameId] = useState<
    Record<number, GameCardInjurySummary>
  >({});
  const [teamCatalog, setTeamCatalog] = useState<TeamOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'final' | 'scheduled'>('all');
  const [teamFilter, setTeamFilter] = useState<'all' | string>('all');
  const [density, setDensity] = useState<'compact' | 'expanded'>('expanded');
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [teamMenuHoverKey, setTeamMenuHoverKey] = useState<string | null>(null);

  const navigate = useCallback(
    (s: number, w: number) => {
      router.push(`/gridstream/games?season=${s}&week=${w}`);
    },
    [router]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/teams/`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const rows = Array.isArray(data) ? data : (data.results ?? []);
        const options: TeamOption[] = rows
          .filter((team: { is_active?: boolean }) => team.is_active !== false)
          .map(
            (team: {
              abbreviation: string;
              location?: string;
              display_name?: string;
              short_display_name?: string;
              name?: string;
              conference?: string;
              division?: string;
              logos?: TeamLogoAsset[];
            }) => ({
              abbreviation: team.abbreviation,
              name: team.display_name || team.short_display_name || team.name || team.abbreviation,
              city:
                team.location ||
                deriveCityFromDisplayName(
                  team.display_name || team.short_display_name || team.name || team.abbreviation
                ),
              logoUrl: resolveTeamLogo(team.logos),
              cardLogoUrl: resolveTeamCardLogo(team.logos),
              conference: (team.conference ?? '').toUpperCase(),
              division: team.division ?? '',
              divisionKey: deriveDivisionKey(team.conference, team.division, team.abbreviation),
            })
          )
          .sort((a: TeamOption, b: TeamOption) => {
            const divisionCmp = divisionSortIndex(a.divisionKey) - divisionSortIndex(b.divisionKey);
            if (divisionCmp !== 0) return divisionCmp;
            const cityCmp = a.city.localeCompare(b.city);
            if (cityCmp !== 0) return cityCmp;
            return a.name.localeCompare(b.name);
          });
        setTeamCatalog(options);
      })
      .catch(() => {
        // Non-blocking: we can still fall back to week-derived teams.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/standings/?season=${season}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const rows: ApiStandingRow[] = Array.isArray(data) ? data : [];
        const map: Record<string, number | null> = {};
        for (const row of rows) {
          const abbr = row.team?.abbreviation?.toUpperCase().trim();
          if (!abbr) continue;
          map[abbr] = row.seed == null ? null : row.seed;
        }
        setTeamSeedsByAbbr(map);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setTeamSeedsByAbbr({});
      });
    return () => controller.abort();
  }, [season]);

  useEffect(() => {
    setGames(null);
    setError(null);

    const controller = new AbortController();
    const params = new URLSearchParams({
      season: String(season),
      page_size: '200',
    });
    if (teamFilter === 'all') {
      if (week >= 19) {
        params.set('season_type', 'POST');
        params.set('week', String(UI_POSTSEASON_WEEK_TO_API_WEEK[week] ?? week));
      } else {
        params.set('season_type', 'REG');
        params.set('week', String(week));
      }
    } else {
      params.set('team', teamFilter);
    }
    const url = `${API_BASE}/games/?${params.toString()}`;

    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // DRF pagination wrapper or bare array
        const results: ApiGameListItem[] = Array.isArray(data) ? data : (data.results ?? []);
        const normalized = results.map((game) =>
          game.season_type === 'POST'
            ? { ...game, week: API_POSTSEASON_WEEK_TO_UI_WEEK[game.week] ?? game.week }
            : game
        );
        setGames(normalized);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(String(err.message));
      });

    return () => controller.abort();
  }, [season, week, teamFilter]);

  useEffect(() => {
    if (!games || games.length === 0) {
      setInjurySummaryByGameId({});
      return undefined;
    }

    const controller = new AbortController();
    const candidates = games.slice(0, MAX_INJURY_BACKFILL_REQUESTS);
    if (candidates.length === 0) {
      setInjurySummaryByGameId({});
      return () => controller.abort();
    }

    let cancelled = false;

    (async () => {
      const summaries = await Promise.all(
        candidates.map(async (game) => {
          try {
            const response = await fetch(`${API_BASE}/games/${game.id}/`, {
              signal: controller.signal,
            });
            if (!response.ok) return null;
            const detail = (await response.json()) as ApiGameDetailForInjuries;
            const summary = buildGameInjurySummary(game, detail);
            if (!summary) return null;
            return { gameId: game.id, summary };
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;

      const next: Record<number, GameCardInjurySummary> = {};
      for (const row of summaries) {
        if (!row) continue;
        next[row.gameId] = row.summary;
      }
      setInjurySummaryByGameId(next);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [games]);

  const openGame = useCallback((id: number) => router.push(`/gridstream/games/${id}`), [router]);

  const fallbackTeamOptions = useMemo(() => {
    if (!games) return [];
    const map = new Map<string, TeamOption>();
    for (const game of games) {
      const awayName =
        game.away_team_detail.display_name ||
        game.away_team_detail.short_display_name ||
        game.away_team_detail.abbreviation;
      const homeName =
        game.home_team_detail.display_name ||
        game.home_team_detail.short_display_name ||
        game.home_team_detail.abbreviation;
      map.set(game.away_team_detail.abbreviation, {
        abbreviation: game.away_team_detail.abbreviation,
        name: awayName,
        city: deriveCityFromDisplayName(awayName),
        logoUrl: game.away_team_detail.logo_url ?? '',
        cardLogoUrl: game.away_team_detail.logo_url ?? '',
        conference: '',
        division: '',
        divisionKey: deriveDivisionKey('', '', game.away_team_detail.abbreviation),
      });
      map.set(game.home_team_detail.abbreviation, {
        abbreviation: game.home_team_detail.abbreviation,
        name: homeName,
        city: deriveCityFromDisplayName(homeName),
        logoUrl: game.home_team_detail.logo_url ?? '',
        cardLogoUrl: game.home_team_detail.logo_url ?? '',
        conference: '',
        division: '',
        divisionKey: deriveDivisionKey('', '', game.home_team_detail.abbreviation),
      });
    }
    return Array.from(map.values()).sort((a, b) => {
      const divisionCmp = divisionSortIndex(a.divisionKey) - divisionSortIndex(b.divisionKey);
      if (divisionCmp !== 0) return divisionCmp;
      const cityCmp = a.city.localeCompare(b.city);
      if (cityCmp !== 0) return cityCmp;
      return a.name.localeCompare(b.name);
    });
  }, [games]);

  const teamOptions = teamCatalog.length > 0 ? teamCatalog : fallbackTeamOptions;
  const teamScopeActive = teamFilter !== 'all';
  const selectedTeam = teamScopeActive
    ? teamOptions.find((team) => team.abbreviation === teamFilter)
    : undefined;
  const selectedTeamLabel =
    selectedTeam?.name ?? (teamScopeActive ? teamFilter : 'ALL TEAMS (WEEK)');
  const groupedTeamOptions = useMemo(() => {
    const groups: Record<string, TeamOption[]> = {};
    for (const team of teamOptions) {
      const key = team.divisionKey || 'OTHER';
      if (!groups[key]) groups[key] = [];
      groups[key].push(team);
    }
    Object.values(groups).forEach((teams) => {
      teams.sort((a, b) => {
        const cityCmp = a.city.localeCompare(b.city);
        if (cityCmp !== 0) return cityCmp;
        return a.name.localeCompare(b.name);
      });
    });
    const orderedKeys = [
      ...DIVISION_ORDER.filter((key) => (groups[key]?.length ?? 0) > 0),
      ...Object.keys(groups)
        .filter((key) => !DIVISION_ORDER.includes(key as (typeof DIVISION_ORDER)[number]))
        .sort(),
    ];
    return orderedKeys.map((key) => ({
      key,
      label: DIVISION_LABEL[key] ?? key,
      teams: groups[key] ?? [],
    }));
  }, [teamOptions]);
  const gameCardLogoOverrides = useMemo(() => {
    const overrides: Record<string, string> = {};
    for (const team of teamOptions) {
      const logo = team.cardLogoUrl || team.logoUrl;
      if (logo) overrides[team.abbreviation] = logo;
    }
    return overrides;
  }, [teamOptions]);

  useEffect(() => {
    if (!teamMenuOpen) return undefined;
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (teamMenuRef.current && target && !teamMenuRef.current.contains(target)) {
        setTeamMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [teamMenuOpen]);

  useEffect(() => {
    setTeamMenuOpen(false);
    setTeamMenuHoverKey(null);
  }, [teamFilter]);

  useEffect(() => {
    if (!games || games.length === 0) return undefined;

    const candidates = games.slice(0, MAX_LEADER_BACKFILL_REQUESTS);
    if (candidates.length === 0) return undefined;

    let cancelled = false;

    (async () => {
      const results = await Promise.all(
        candidates.map(async (game) => {
          try {
            const response = await fetch(`${API_BASE}/games/${game.id}/boxscore/`);
            if (!response.ok) return null;
            const payload = await response.json();
            const leaders = Array.isArray(payload?.leaders)
              ? (payload.leaders as ApiGameLeader[])
              : [];
            const playersByTeam =
              payload?.player_stats &&
              typeof payload.player_stats === 'object' &&
              !Array.isArray(payload.player_stats)
                ? (payload.player_stats as BoxscorePlayersByTeam)
                : {};
            const derivedLeaders = deriveLeadersFromPlayerStats(playersByTeam, [
              game.away_team_detail.abbreviation,
              game.home_team_detail.abbreviation,
            ]);
            const mergedLeaders = mergeLeaders(
              game.leaders ?? [],
              [...leaders, ...derivedLeaders],
              game.away_team_detail.abbreviation,
              game.home_team_detail.abbreviation
            );
            const enrichedLeaders = enrichPassingLeadersWithQbRushing(
              mergedLeaders,
              playersByTeam,
              [game.away_team_detail.abbreviation, game.home_team_detail.abbreviation]
            );
            if (enrichedLeaders.length === 0) return null;
            return { id: game.id, leaders: enrichedLeaders };
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;

      const leadersByGame = new Map<number, ApiGameLeader[]>();
      for (const row of results) {
        if (!row) continue;
        leadersByGame.set(row.id, row.leaders);
      }
      if (leadersByGame.size === 0) return;

      setGames((prev) => {
        if (!prev) return prev;

        let changed = false;
        const next = prev.map((game) => {
          const backfilled = leadersByGame.get(game.id);
          if (!backfilled) return game;

          const currentSignature = leadersSignature(game.leaders ?? []);
          const backfilledSignature = leadersSignature(backfilled);
          if (currentSignature === backfilledSignature) return game;
          changed = true;
          return { ...game, leaders: backfilled };
        });

        return changed ? next : prev;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [games]);

  const filteredGames = useMemo(() => {
    if (!games) return null;
    let next = games;
    if (teamScopeActive) {
      next = [...games].sort((a, b) => {
        const dateA = `${a.game_date}T${a.game_time ?? '00:00:00'}`;
        const dateB = `${b.game_date}T${b.game_time ?? '00:00:00'}`;
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return b.week - a.week;
      });
    }
    next = next.filter((game) => {
      if (teamScopeActive && game.season_type === 'PRE') return false;
      if (statusFilter !== 'all') {
        const statusVariant = gameStatusDisplay(game.status, game.quarter, game.clock).variant;
        if (statusVariant !== statusFilter) return false;
      }
      return true;
    });
    return next;
  }, [games, statusFilter, teamScopeActive]);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        background: '#050c18',
        overflow: 'hidden',
      }}
    >
      {/* Background star field */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <StarField />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <WeekBrowser
          season={season}
          week={week}
          onChange={navigate}
          neutralSelection={teamScopeActive}
        />

        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '22px 20px 34px' }}>
          {games && (
            <div
              className="hud-panel"
              style={{
                position: 'relative',
                zIndex: 20,
                overflow: 'visible',
                padding: '12px 14px',
                marginBottom: 18,
                display: 'grid',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as 'all' | 'live' | 'final' | 'scheduled')
                    }
                    style={filterSelectStyle}
                  >
                    <option value="all">ALL STATUS</option>
                    <option value="live">LIVE</option>
                    <option value="final">FINAL</option>
                    <option value="scheduled">SCHEDULED</option>
                  </select>

                  <div ref={teamMenuRef} style={teamMenuWrapStyle}>
                    <button
                      type="button"
                      onClick={() => setTeamMenuOpen((open) => !open)}
                      style={teamMenuToggleStyle}
                      aria-haspopup="listbox"
                      aria-expanded={teamMenuOpen}
                    >
                      {selectedTeam?.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedTeam.logoUrl}
                          alt={`${selectedTeam.name} logo`}
                          width={18}
                          height={18}
                          style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }}
                        />
                      ) : (
                        <span style={teamDotStyle} />
                      )}
                      <span style={teamMenuLabelStyle}>
                        {teamScopeActive ? selectedTeamLabel : 'ALL TEAMS (WEEK)'}
                      </span>
                      <span style={teamMenuCaretStyle}>{teamMenuOpen ? '▴' : '▾'}</span>
                    </button>

                    {teamMenuOpen && (
                      <div
                        style={teamMenuListStyle}
                        role="listbox"
                        aria-label="Team filter options"
                      >
                        <button
                          type="button"
                          onClick={() => setTeamFilter('all')}
                          style={{
                            ...teamMenuItemStyle,
                            ...(teamMenuHoverKey === 'all' && teamMenuItemHoverStyle),
                            ...(teamFilter === 'all' && teamMenuItemActiveStyle),
                          }}
                          role="option"
                          aria-selected={teamFilter === 'all'}
                          onMouseEnter={() => setTeamMenuHoverKey('all')}
                          onMouseLeave={() => setTeamMenuHoverKey(null)}
                        >
                          <span style={teamDotStyle} />
                          <span style={teamMenuItemLabelStyle}>ALL TEAMS (WEEK)</span>
                        </button>
                        {groupedTeamOptions.map((group) => (
                          <div key={group.key} style={teamMenuGroupStyle}>
                            <div style={teamMenuGroupLabelStyle}>{group.label}</div>
                            {group.teams.map((team) => (
                              <button
                                key={team.abbreviation}
                                type="button"
                                onClick={() => setTeamFilter(team.abbreviation)}
                                style={{
                                  ...teamMenuItemStyle,
                                  ...(teamMenuHoverKey === team.abbreviation &&
                                    teamMenuItemHoverStyle),
                                  ...(teamFilter === team.abbreviation && teamMenuItemActiveStyle),
                                }}
                                role="option"
                                aria-selected={teamFilter === team.abbreviation}
                                onMouseEnter={() => setTeamMenuHoverKey(team.abbreviation)}
                                onMouseLeave={() => setTeamMenuHoverKey(null)}
                              >
                                {team.logoUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={team.logoUrl}
                                    alt={`${team.name} logo`}
                                    width={18}
                                    height={18}
                                    style={{
                                      width: 18,
                                      height: 18,
                                      objectFit: 'contain',
                                      flexShrink: 0,
                                    }}
                                  />
                                ) : (
                                  <span style={teamDotStyle} />
                                )}
                                <span style={teamMenuItemLabelStyle}>{team.name}</span>
                                <span style={teamMenuItemAbbrStyle}>{team.abbreviation}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {teamScopeActive && (
                    <button
                      type="button"
                      onClick={() => setTeamFilter('all')}
                      style={resetTeamBtnStyle}
                    >
                      RESET TEAM MODE
                    </button>
                  )}
                </div>

                <div
                  style={{
                    display: 'inline-flex',
                    border: `1px solid ${C.panelBorder}`,
                    background: 'rgba(0,229,255,0.04)',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setDensity('compact')}
                    style={density === 'compact' ? densityBtnActive : densityBtn}
                  >
                    COMPACT
                  </button>
                  <button
                    type="button"
                    onClick={() => setDensity('expanded')}
                    style={density === 'expanded' ? densityBtnActive : densityBtn}
                  >
                    EXPANDED
                  </button>
                </div>
              </div>

              {teamScopeActive && (
                <div
                  style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: 11,
                    color: C.textMuted,
                    letterSpacing: '0.04em',
                  }}
                >
                  Team mode active: showing all {season} regular/postseason games for{' '}
                  {selectedTeamLabel}.
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              style={{
                color: '#ff3b4f',
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 14,
                padding: '16px 0',
              }}
            >
              Failed to load games: {error}
            </div>
          )}

          {/* Loading skeletons */}
          {!games && !error && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 520px))',
                justifyContent: 'center',
                gap: 20,
              }}
            >
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="hud-panel"
                  style={{
                    height: 240,
                    animation: 'pulse 2s ease-in-out infinite',
                    animationDelay: `${i * 0.15}s`,
                    opacity: 0.25,
                  }}
                />
              ))}
            </div>
          )}

          {/* Game grid */}
          {games && filteredGames && filteredGames.length === 0 && (
            <div
              style={{
                color: C.textDim,
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 13,
                padding: '32px 0',
                textAlign: 'center',
                letterSpacing: '0.1em',
              }}
            >
              NO GAMES MATCH THIS VIEW
            </div>
          )}

          {filteredGames && filteredGames.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 520px))',
                justifyContent: 'center',
                gap: 20,
              }}
            >
              {filteredGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  logoOverrides={gameCardLogoOverrides}
                  showWeekTag={teamScopeActive}
                  density={density}
                  awaySeed={teamSeedsByAbbr[game.away_team_detail.abbreviation] ?? null}
                  homeSeed={teamSeedsByAbbr[game.home_team_detail.abbreviation] ?? null}
                  injurySummary={injurySummaryByGameId[game.id]}
                  onClick={() => openGame(game.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const filterSelectStyle: CSSProperties = {
  fontFamily: "'Orbitron', monospace",
  fontSize: 11,
  fontWeight: 600,
  color: C.textBright,
  background: 'rgba(0,229,255,0.07)',
  border: `1px solid ${C.panelBorder}`,
  borderRadius: 5,
  minHeight: 34,
  padding: '7px 12px',
  outline: 'none',
  cursor: 'pointer',
  letterSpacing: '0.08em',
};

const teamMenuWrapStyle: CSSProperties = {
  position: 'relative',
  minWidth: 250,
};

const teamMenuToggleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  fontFamily: "'Orbitron', monospace",
  fontSize: 11,
  fontWeight: 600,
  color: C.textBright,
  background: 'rgba(0,229,255,0.07)',
  border: `1px solid ${C.panelBorder}`,
  borderRadius: 5,
  minHeight: 34,
  padding: '7px 10px',
  cursor: 'pointer',
  letterSpacing: '0.04em',
  textAlign: 'left',
  outline: 'none',
};

const teamMenuLabelStyle: CSSProperties = {
  minWidth: 0,
  flex: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const teamMenuCaretStyle: CSSProperties = {
  color: C.textDim,
  flexShrink: 0,
  fontSize: 10,
};

const teamMenuListStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 'calc(100% + 6px)',
  zIndex: 50,
  background: 'rgba(8, 18, 40, 0.96)',
  border: `1px solid ${C.panelBorder}`,
  borderRadius: 6,
  boxShadow: '0 14px 26px rgba(0, 0, 0, 0.45)',
  maxHeight: 320,
  overflowY: 'auto',
  padding: 4,
};

const teamMenuGroupStyle: CSSProperties = {
  marginTop: 4,
};

const teamMenuGroupLabelStyle: CSSProperties = {
  fontFamily: "'Share Tech Mono', monospace",
  fontSize: 10,
  color: C.textMuted,
  letterSpacing: '0.12em',
  padding: '6px 8px 4px',
  textTransform: 'uppercase',
};

const teamMenuItemStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'transparent',
  border: 'none',
  borderLeft: '2px solid transparent',
  borderRadius: 4,
  padding: '7px 8px 7px 10px',
  color: C.text,
  cursor: 'pointer',
  textAlign: 'left',
  outline: 'none',
};

const teamMenuItemHoverStyle: CSSProperties = {
  borderLeftColor: 'rgba(0,229,255,0.45)',
  background: 'rgba(0,229,255,0.08)',
};

const teamMenuItemActiveStyle: CSSProperties = {
  borderLeftColor: C.cyan,
  background: 'rgba(0,229,255,0.12)',
};

const teamMenuItemLabelStyle: CSSProperties = {
  minWidth: 0,
  flex: 1,
  fontFamily: "'Orbitron', monospace",
  fontSize: 11,
  fontWeight: 600,
  color: C.textBright,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  letterSpacing: '0.03em',
};

const teamMenuItemAbbrStyle: CSSProperties = {
  fontFamily: "'Share Tech Mono', monospace",
  fontSize: 10,
  color: C.textMuted,
  letterSpacing: '0.06em',
  flexShrink: 0,
};

const teamDotStyle: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  flexShrink: 0,
  background: 'rgba(0,229,255,0.16)',
  border: `1px solid ${C.panelBorder}`,
};

const densityBtn: CSSProperties = {
  fontFamily: "'Orbitron', monospace",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: C.textDim,
  background: 'rgba(0,229,255,0.03)',
  border: 'none',
  minWidth: 92,
  minHeight: 34,
  padding: '8px 14px',
  cursor: 'pointer',
};

const densityBtnActive: CSSProperties = {
  ...densityBtn,
  color: C.cyan,
  background: 'rgba(0,229,255,0.1)',
  textShadow: `0 0 8px ${C.cyan}66`,
};

const resetTeamBtnStyle: CSSProperties = {
  fontFamily: "'Orbitron', monospace",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: C.amber,
  background: 'rgba(255,177,0,0.06)',
  border: '1px solid rgba(255,177,0,0.28)',
  borderRadius: 5,
  minHeight: 34,
  padding: '7px 10px',
  cursor: 'pointer',
};
