'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildGridstreamPositionFilterBucketsFromFacets,
  GRIDSTREAM_PLAYER_COLUMN_CATEGORIES,
  GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS,
  GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS,
  GRIDSTREAM_PLAYER_TABLE_COLUMNS,
  type GridstreamPlayerBrowseCriterion,
  type GridstreamPlayerDirectoryPage,
  type GridstreamPlayerFilterState,
  type GridstreamPlayerSortKey,
  type GridstreamPlayerSortState,
  type GridstreamPlayerTableColumnKey,
  type GridstreamPlayerTableColumnOption,
  type GridstreamPlayerSummary,
  type GridstreamTeamFilterOption,
  type GridstreamPlayerRouteState,
  cycleGridstreamTeamFilterMode,
  fetchGridstreamPlayerTeamOptions,
  fetchGridstreamPlayersDirectoryPage,
  formatGridstreamDraftLabel,
  formatGridstreamSeasonRange,
  parseGridstreamPlayerRouteState,
  recommendedGridstreamPlayerColumns,
  resolveGridstreamTeamFilterMode,
  resolveGridstreamApiBase,
  sanitizeGridstreamPlayerTableColumns,
  sortGridstreamTeamFilterOptions,
  toggleGridstreamPlayerSort,
  toGridstreamPlayerRouteId,
  toGridstreamPlayerRouteSearchParams,
} from '@atlas/sdk/gridstream';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);
const PAGE_SIZE = 25;
const DEFAULT_ROUTE_STATE: GridstreamPlayerRouteState = {
  filters: {
    search: '',
    team: null,
    teamNot: null,
    position: null,
    draftYear: null,
    season: null,
    statsSeason: null,
    statsWeek: null,
    rosterStatus: null,
    isActive: true,
  },
  page: 1,
  browseBy: 'team',
  sort: null,
  columns: [...GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS],
};
const EMPTY_PLAYERS: GridstreamPlayerSummary[] = [];
const COLUMN_ORDER = GRIDSTREAM_PLAYER_TABLE_COLUMNS.map((column) => column.key);
const TABLE_COLUMN_BY_KEY = new Map(
  GRIDSTREAM_PLAYER_TABLE_COLUMNS.map((column) => [column.key, column] as const)
);

const COLUMN_CHOOSER_LABEL_OVERRIDES: Partial<Record<GridstreamPlayerTableColumnKey, string>> = {
  position: 'Position',
  receptions: 'Receptions',
};

const TEAM_CONFERENCES = ['NFC', 'AFC'] as const;
const TEAM_DIVISIONS_BY_CONFERENCE: Record<(typeof TEAM_CONFERENCES)[number], string[]> = {
  NFC: ['NFC East', 'NFC North', 'NFC South', 'NFC West'],
  AFC: ['AFC East', 'AFC North', 'AFC South', 'AFC West'],
};

const POSITION_MENU_GROUPS: Array<{
  id: 'offense' | 'defense' | 'special';
  label: string;
  options: Array<{ key: string; label: string; subOption?: boolean }>;
}> = [
  {
    id: 'offense',
    label: 'Offense',
    options: [
      { key: 'QB', label: 'Quarterback' },
      { key: 'RB', label: 'Running Back' },
      { key: 'FB', label: 'Fullback' },
      { key: 'WR', label: 'Wide Receiver' },
      { key: 'TE', label: 'Tight End' },
      { key: 'OL', label: 'Offensive Line (All)' },
      { key: 'T', label: 'Tackle', subOption: true },
      { key: 'G', label: 'Guard', subOption: true },
      { key: 'C', label: 'Center', subOption: true },
    ],
  },
  {
    id: 'defense',
    label: 'Defense',
    options: [
      { key: 'DL', label: 'Defensive Line' },
      { key: 'EDGE', label: 'Edge' },
      { key: 'DE', label: 'Defensive End' },
      { key: 'DT', label: 'Defensive Tackle' },
      { key: 'NT', label: 'Nose Tackle' },
      { key: 'LB', label: 'Linebacker' },
      { key: 'OLB', label: 'Outside Linebacker' },
      { key: 'ILB', label: 'Inside Linebacker' },
      { key: 'MLB', label: 'Middle Linebacker' },
      { key: 'CB', label: 'Cornerback' },
      { key: 'S', label: 'Safety' },
      { key: 'FS', label: 'Free Safety' },
      { key: 'SS', label: 'Strong Safety' },
      { key: 'DB', label: 'Defensive Back' },
    ],
  },
  {
    id: 'special',
    label: 'Special Teams',
    options: [
      { key: 'K', label: 'Kicker' },
      { key: 'P', label: 'Punter' },
      { key: 'LS', label: 'Long Snapper' },
    ],
  },
];

type PlayerFilterMenuId =
  | 'scope'
  | 'status'
  | 'position'
  | 'team'
  | 'draftYear'
  | 'season'
  | 'columns';

type FilterKey = keyof GridstreamPlayerFilterState;

const ROSTER_STATUS_MENU_ORDER = [
  'Roster Active',
  'Inactive',
  'Retired',
  'Released',
  'Injured Reserve',
  'Practice Squad',
  'Free Agent',
] as const;

type RosterStatusOption = {
  key: string;
  label: string;
  count: number;
};

const NUMERIC_PLAYER_COLUMNS = new Set<GridstreamPlayerTableColumnKey>([
  'age',
  'draftYear',
  'seasonsCount',
  'gamesPlayed',
  'starts',
  'offSnaps',
  'snapPct',
  'completions',
  'passAttempts',
  'completionPct',
  'passYards',
  'passYdsPerGame',
  'yardsPerAttempt',
  'passTd',
  'interceptions',
  'passerRating',
  'sacksTaken',
  'carries',
  'rushYards',
  'rushYdsPerGame',
  'yardsPerCarry',
  'rushTd',
  'targets',
  'receptions',
  'catchPct',
  'recYards',
  'recYdsPerGame',
  'yardsPerReception',
  'yardsPerTarget',
  'recTd',
  'scrimmageYards',
  'totalTd',
  'tdPerGame',
  'longGain',
  'firstDowns',
  'fumbles',
  'fumblesLost',
  'tackles',
  'sacksMade',
  'defInterceptions',
  'passesDefended',
  'forcedFumbles',
  'fgMade',
  'fgAttempts',
  'punts',
]);

function isNumericPlayerColumn(columnKey: GridstreamPlayerTableColumnKey): boolean {
  return NUMERIC_PLAYER_COLUMNS.has(columnKey);
}

function rosterStatusTone(status: string | null | undefined): 'active' | 'reserve' | 'inactive' {
  const normalized = (status ?? '').toLowerCase();
  if (!normalized) return 'inactive';
  if (normalized.includes('active')) return 'active';
  if (
    normalized.includes('reserve') ||
    normalized.includes('injur') ||
    normalized.includes('question')
  ) {
    return 'reserve';
  }
  if (
    normalized.includes('retire') ||
    normalized.includes('inactive') ||
    normalized.includes('suspend')
  ) {
    return 'inactive';
  }
  return 'inactive';
}

function normalizeRosterStatusToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function splitCommaTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseUpperTokenList(value: string | null | undefined): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const token of splitCommaTokens(value)) {
    const normalized = token.toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push(normalized);
  }
  return tokens;
}

function parseNumericTokenList(value: string | null | undefined): number[] {
  const values: number[] = [];
  const seen = new Set<number>();
  for (const token of splitCommaTokens(value)) {
    const parsed = Number.parseInt(token, 10);
    if (!Number.isFinite(parsed) || seen.has(parsed)) continue;
    seen.add(parsed);
    values.push(parsed);
  }
  return values;
}

function joinUpperTokenList(values: Iterable<string>): string | null {
  const normalized = parseUpperTokenList(Array.from(values).join(','));
  return normalized.length > 0 ? normalized.join(',') : null;
}

function joinNumericTokenList(values: Iterable<number>): string | null {
  const normalized = Array.from(new Set(values))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
  return normalized.length > 0 ? normalized.join(',') : null;
}

function mergeSortedNumericValues(
  current: readonly number[],
  incoming: readonly number[]
): number[] {
  return Array.from(new Set([...current, ...incoming]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
}

function summarizeTokenList(tokens: readonly string[], emptyLabel: string): string {
  if (tokens.length === 0) return emptyLabel;
  if (tokens.length <= 2) return tokens.join(', ');
  return `${tokens.slice(0, 2).join(', ')} +${tokens.length - 2}`;
}

function summarizeNumericFilterLabel(value: string | null | undefined, emptyLabel: string): string {
  const tokens = parseNumericTokenList(value).map(String);
  return summarizeTokenList(tokens, emptyLabel);
}

function summarizeTeamFilterLabel(
  includeValue: string | null | undefined,
  excludeValue: string | null | undefined
): string {
  const include = parseUpperTokenList(includeValue);
  const exclude = parseUpperTokenList(excludeValue);
  if (include.length === 0 && exclude.length === 0) return 'All Teams';
  if (include.length > 0 && exclude.length === 0) {
    return summarizeTokenList(include, 'All Teams');
  }
  if (include.length === 0 && exclude.length > 0) {
    return `Not ${summarizeTokenList(exclude, '')}`;
  }
  return `${summarizeTokenList(include, '')} · Not ${summarizeTokenList(exclude, '')}`;
}

function canonicalRosterStatusLabel(value: string | null | undefined): string {
  const token = normalizeRosterStatusToken(value);
  if (!token) return '';
  if (token === 'active' || token === 'act' || token === 'roster active') return 'Roster Active';
  if (token === 'inactive' || token === 'ina') return 'Inactive';
  if (token === 'retired' || token === 'ret') return 'Retired';
  if (token === 'released' || token === 'cut') return 'Released';
  if (
    token === 'injured reserve' ||
    token === 'reserve/injured' ||
    token === 'ir' ||
    token === 'res'
  ) {
    return 'Injured Reserve';
  }
  if (token === 'practice squad' || token === 'practice' || token === 'pra') {
    return 'Practice Squad';
  }
  if (token === 'free agent' || token === 'fa' || token === 'ufa' || token === 'rfa') {
    return 'Free Agent';
  }
  return (value ?? '').trim();
}

function splitRosterStatusFilterValue(value: string | null | undefined): string[] {
  const normalizedStatuses: string[] = [];
  const seen = new Set<string>();
  for (const token of (value ?? '').split(',')) {
    const canonical = canonicalRosterStatusLabel(token);
    const key = normalizeRosterStatusToken(canonical);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedStatuses.push(canonical);
  }
  return normalizedStatuses;
}

function rosterStatusSummaryLabel(statuses: readonly string[]): string {
  if (statuses.length === 0) return 'All Statuses';
  if (statuses.length <= 3) return statuses.join(' + ');
  return `${statuses.slice(0, 3).join(' + ')} +${statuses.length - 3}`;
}

function scopeSummaryLabel(value: boolean | null | undefined, isRetiredOnly = false): string {
  if (isRetiredOnly) return 'Retired';
  if (value === false) return 'League Inactive';
  if (value === null) return 'All Players';
  return 'League Active';
}

function labelForSort(sort: GridstreamPlayerSortState | null): string {
  if (!sort) return 'Default';
  const column = GRIDSTREAM_PLAYER_TABLE_COLUMNS.find((entry) => entry.sortKey === sort.key);
  const label = column?.label ?? sort.key;
  return `${label} ${sort.direction === 'asc' ? '↑' : '↓'}`;
}

function labelForStatsScope(filters: GridstreamPlayerFilterState): string {
  if (filters.statsSeason == null) return 'Career';
  if (filters.statsWeek == null) return `${filters.statsSeason}`;
  return `${filters.statsSeason} · W${filters.statsWeek}`;
}

function labelForColumnChooser(column: GridstreamPlayerTableColumnOption): string {
  return COLUMN_CHOOSER_LABEL_OVERRIDES[column.key] ?? column.label;
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function divideMetric(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  multiplier = 1
): number | null {
  const num = finiteNumber(numerator);
  const den = finiteNumber(denominator);
  if (num == null || den == null || den <= 0) return null;
  return (num * multiplier) / den;
}

function formatIntegerMetric(value: number | null | undefined): string {
  const normalized = finiteNumber(value);
  if (normalized == null) return '—';
  return Math.round(normalized).toLocaleString('en-US');
}

function formatDecimalMetric(value: number | null | undefined, digits = 1): string {
  const normalized = finiteNumber(value);
  if (normalized == null) return '—';
  return normalized.toFixed(digits);
}

function formatPercentMetric(value: number | null | undefined): string {
  const normalized = finiteNumber(value);
  if (normalized == null) return '—';
  return `${normalized.toFixed(1)}%`;
}

// Returns a heat CSS modifier class based on value thresholds.
// hot/cold are inclusive bounds; pass undefined to skip that tier.
function numHeat(
  value: number | null | undefined,
  hot: number,
  cold?: number
): string {
  if (value == null) return '';
  if (value >= hot) return 'is-hot';
  if (cold != null && value <= cold) return 'is-cold';
  return '';
}

// For stats where high values are bad (interceptions, fumbles lost, etc.).
function numHeatBad(value: number, warn: number): string {
  return value >= warn ? 'is-warn' : '';
}

export default function GridstreamPlayersPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const routeKey = searchParams.toString();
  const routeState = useMemo(
    () => parseGridstreamPlayerRouteState(new URLSearchParams(routeKey)),
    [routeKey]
  );

  const [directory, setDirectory] = useState<GridstreamPlayerDirectoryPage | null>(null);
  const [teamOptions, setTeamOptions] = useState<GridstreamTeamFilterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<PlayerFilterMenuId | null>(null);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [knownDraftYears, setKnownDraftYears] = useState<number[]>([]);
  const [knownSeasons, setKnownSeasons] = useState<number[]>([]);

  // Local search value decoupled from URL so typing is instant (no round-trip lag)
  const [localSearch, setLocalSearch] = useState(routeState.filters.search);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local search when route state changes externally (back/forward navigation)
  useEffect(() => {
    setLocalSearch(routeState.filters.search);
  }, [routeState.filters.search]);

  const updateRouteState = useCallback(
    (patch: {
      filters?: Partial<GridstreamPlayerFilterState>;
      page?: number;
      browseBy?: GridstreamPlayerBrowseCriterion;
      sort?: GridstreamPlayerSortState | null;
      columns?: GridstreamPlayerTableColumnKey[];
      resetPage?: boolean;
    }) => {
      const next: GridstreamPlayerRouteState = {
        filters: {
          ...routeState.filters,
          ...(patch.filters ?? {}),
        },
        page: patch.resetPage ? 1 : (patch.page ?? routeState.page),
        browseBy: patch.browseBy ?? routeState.browseBy,
        sort: patch.sort === undefined ? routeState.sort : patch.sort,
        columns:
          patch.columns == null
            ? routeState.columns
            : sanitizeGridstreamPlayerTableColumns(patch.columns),
      };

      const params = toGridstreamPlayerRouteSearchParams(next);
      const nextQuery = params.toString();
      const currentQuery = routeKey;
      if (nextQuery === currentQuery) return;
      const href = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      router.replace(href, { scroll: false });
    },
    [pathname, routeKey, routeState, router]
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setLoadingError(null);

    fetchGridstreamPlayersDirectoryPage({
      apiBase: API_BASE,
      filters: routeState.filters,
      page: routeState.page,
      pageSize: PAGE_SIZE,
      sort: routeState.sort,
      fallbackToMock: true,
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) return;
        setDirectory(result);
        setLoadingError(result.error ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        setDirectory(null);
        setLoadingError(error instanceof Error ? error.message : 'Failed to load players.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [routeState.filters, routeState.page, routeState.sort]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    fetchGridstreamPlayerTeamOptions(API_BASE, controller.signal)
      .then((teams) => {
        if (!cancelled) setTeamOptions(teams);
      })
      .catch(() => {
        if (!cancelled) setTeamOptions([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-gs-menu-root="true"]')) return;
      setOpenMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenMenu(null);
      setIsFilterSheetOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isFilterSheetOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isFilterSheetOpen]);

  const players = directory?.items ?? EMPTY_PLAYERS;
  const facetBuckets = directory?.facets;
  const positionFilterBuckets = useMemo(
    () => buildGridstreamPositionFilterBucketsFromFacets(facetBuckets?.position),
    [facetBuckets?.position]
  );
  const draftYearFilterBuckets = useMemo(
    () =>
      (facetBuckets?.draftYear ?? []).filter((bucket) =>
        Number.isFinite(Number.parseInt(bucket.key, 10))
      ),
    [facetBuckets?.draftYear]
  );
  const seasonFilterBuckets = useMemo(
    () =>
      (facetBuckets?.season ?? []).filter((bucket) =>
        Number.isFinite(Number.parseInt(bucket.key, 10))
      ),
    [facetBuckets?.season]
  );
  const selectedDraftYears = useMemo(
    () => parseNumericTokenList(routeState.filters.draftYear),
    [routeState.filters.draftYear]
  );
  const selectedDraftYearSet = useMemo(() => new Set(selectedDraftYears), [selectedDraftYears]);
  const selectedSeasons = useMemo(
    () => parseNumericTokenList(routeState.filters.season),
    [routeState.filters.season]
  );
  const selectedSeasonSet = useMemo(() => new Set(selectedSeasons), [selectedSeasons]);
  const draftYearCountsByYear = useMemo(
    () =>
      new Map(
        draftYearFilterBuckets
          .map((bucket) => [Number.parseInt(bucket.key, 10), bucket.count] as const)
          .filter(([year]) => Number.isFinite(year))
      ),
    [draftYearFilterBuckets]
  );
  const seasonCountsByYear = useMemo(
    () =>
      new Map(
        seasonFilterBuckets
          .map((bucket) => [Number.parseInt(bucket.key, 10), bucket.count] as const)
          .filter(([year]) => Number.isFinite(year))
      ),
    [seasonFilterBuckets]
  );

  useEffect(() => {
    const yearsFromFacets = draftYearFilterBuckets
      .map((bucket) => Number.parseInt(bucket.key, 10))
      .filter((year): year is number => Number.isFinite(year));
    setKnownDraftYears((current) => {
      const next = mergeSortedNumericValues(current, [...yearsFromFacets, ...selectedDraftYears]);
      if (
        next.length === current.length &&
        next.every((value, index) => value === current[index])
      ) {
        return current;
      }
      return next;
    });
  }, [draftYearFilterBuckets, selectedDraftYears]);

  useEffect(() => {
    const yearsFromFacets = seasonFilterBuckets
      .map((bucket) => Number.parseInt(bucket.key, 10))
      .filter((year): year is number => Number.isFinite(year));
    setKnownSeasons((current) => {
      const next = mergeSortedNumericValues(current, [...yearsFromFacets, ...selectedSeasons]);
      if (
        next.length === current.length &&
        next.every((value, index) => value === current[index])
      ) {
        return current;
      }
      return next;
    });
  }, [seasonFilterBuckets, selectedSeasons]);

  const draftYearMenuOptions = useMemo(
    () =>
      knownDraftYears.map((year) => ({
        year,
        count: draftYearCountsByYear.get(year) ?? 0,
      })),
    [draftYearCountsByYear, knownDraftYears]
  );
  const seasonMenuOptions = useMemo(
    () =>
      knownSeasons.map((year) => ({
        year,
        count: seasonCountsByYear.get(year) ?? 0,
      })),
    [knownSeasons, seasonCountsByYear]
  );
  const draftYearFilterLabel = useMemo(
    () => summarizeNumericFilterLabel(routeState.filters.draftYear, 'All Years'),
    [routeState.filters.draftYear]
  );
  const seasonFilterLabel = useMemo(
    () => summarizeNumericFilterLabel(routeState.filters.season, 'All Seasons'),
    [routeState.filters.season]
  );
  const selectedRosterStatuses = useMemo(
    () => splitRosterStatusFilterValue(routeState.filters.rosterStatus),
    [routeState.filters.rosterStatus]
  );
  const rosterStatusFilterOptions = useMemo(() => {
    const countsByLabel = new Map<string, number>();
    (facetBuckets?.rosterStatus ?? []).forEach((bucket) => {
      const canonicalLabel = canonicalRosterStatusLabel(bucket.label || bucket.key);
      if (!canonicalLabel) return;
      countsByLabel.set(canonicalLabel, (countsByLabel.get(canonicalLabel) ?? 0) + bucket.count);
    });

    const options: RosterStatusOption[] = [];
    const seen = new Set<string>();
    const pushLabel = (label: string) => {
      const key = normalizeRosterStatusToken(label);
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push({
        key,
        label,
        count: countsByLabel.get(label) ?? 0,
      });
    };

    ROSTER_STATUS_MENU_ORDER.forEach(pushLabel);
    selectedRosterStatuses.forEach(pushLabel);
    (facetBuckets?.rosterStatus ?? []).forEach((bucket) => {
      pushLabel(canonicalRosterStatusLabel(bucket.label || bucket.key));
    });

    return options;
  }, [facetBuckets?.rosterStatus, selectedRosterStatuses]);
  const selectedRosterStatusKeys = useMemo(
    () => new Set(selectedRosterStatuses.map((status) => normalizeRosterStatusToken(status))),
    [selectedRosterStatuses]
  );
  const isRetiredScopePreset = useMemo(
    () =>
      routeState.filters.isActive === null &&
      selectedRosterStatuses.length === 1 &&
      normalizeRosterStatusToken(selectedRosterStatuses[0]) === 'retired',
    [routeState.filters.isActive, selectedRosterStatuses]
  );
  const rosterStatusFilterLabel = useMemo(
    () => rosterStatusSummaryLabel(selectedRosterStatuses),
    [selectedRosterStatuses]
  );
  const scopeFilterLabel = useMemo(
    () => scopeSummaryLabel(routeState.filters.isActive, isRetiredScopePreset),
    [isRetiredScopePreset, routeState.filters.isActive]
  );
  const statsSeasonOptions = useMemo(
    () =>
      (facetBuckets?.season ?? [])
        .map((bucket) => Number.parseInt(bucket.key, 10))
        .filter((season): season is number => Number.isFinite(season))
        .sort((a, b) => b - a),
    [facetBuckets?.season]
  );
  const statsWeekOptions = useMemo(() => Array.from({ length: 22 }, (_, index) => index + 1), []);
  const hasCustomColumns = searchParams.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.columns) != null;
  const customColumns = useMemo(
    () => sanitizeGridstreamPlayerTableColumns(routeState.columns),
    [routeState.columns]
  );
  const autoColumns = useMemo(
    () => recommendedGridstreamPlayerColumns(routeState.filters.position),
    [routeState.filters.position]
  );
  const visibleColumns = hasCustomColumns ? customColumns : autoColumns;
  const visibleColumnOptions = useMemo(
    () =>
      visibleColumns
        .map((columnKey) => TABLE_COLUMN_BY_KEY.get(columnKey))
        .filter((column): column is GridstreamPlayerTableColumnOption => Boolean(column)),
    [visibleColumns]
  );
  const columnCategorySections = useMemo(
    () =>
      GRIDSTREAM_PLAYER_COLUMN_CATEGORIES.map((category) => ({
        ...category,
        options: category.columns
          .map((columnKey) => TABLE_COLUMN_BY_KEY.get(columnKey))
          .filter((column): column is GridstreamPlayerTableColumnOption => Boolean(column)),
      })).filter((category) => category.options.length > 0),
    []
  );

  const effectiveTeamOptions = useMemo(() => {
    const byAbbr = new Map<string, GridstreamTeamFilterOption>();

    teamOptions.forEach((team) => {
      const abbreviation = (team.abbreviation ?? '').toUpperCase();
      if (!abbreviation) return;
      byAbbr.set(abbreviation, {
        ...team,
        abbreviation,
      });
    });

    (facetBuckets?.team ?? []).forEach((bucket) => {
      const abbreviation = (bucket.key ?? '').toUpperCase();
      if (!abbreviation || byAbbr.has(abbreviation)) return;
      byAbbr.set(abbreviation, {
        abbreviation,
        displayName: bucket.label || abbreviation,
        logoUrl: null,
        colorPrimary: null,
        colorSecondary: null,
        conference: null,
        division: null,
      });
    });

    return sortGridstreamTeamFilterOptions(Array.from(byAbbr.values()));
  }, [facetBuckets?.team, teamOptions]);
  const teamCountsByAbbr = useMemo(
    () =>
      new Map(
        (facetBuckets?.team ?? []).map(
          (bucket) => [(bucket.key ?? '').toUpperCase(), bucket.count] as const
        )
      ),
    [facetBuckets?.team]
  );
  const positionCountsByKey = useMemo(
    () =>
      new Map(
        positionFilterBuckets.map((bucket) => [bucket.key.toUpperCase(), bucket.count] as const)
      ),
    [positionFilterBuckets]
  );
  const positionMenuSections = useMemo(
    () =>
      POSITION_MENU_GROUPS.map((group) => ({
        ...group,
        options: group.options.map((option) => ({
          ...option,
          count: positionCountsByKey.get(option.key) ?? 0,
        })),
      })),
    [positionCountsByKey]
  );
  const teamMenuGroups = useMemo(() => {
    const byConference = new Map<string, Map<string, GridstreamTeamFilterOption[]>>();
    let freeAgentTeam: GridstreamTeamFilterOption | null = null;
    const miscTeams: GridstreamTeamFilterOption[] = [];

    for (const team of effectiveTeamOptions) {
      if (team.abbreviation === 'FA') {
        freeAgentTeam = team;
        continue;
      }

      const inferredConference =
        team.conference?.toUpperCase() ??
        (team.division?.toUpperCase().includes('NFC')
          ? 'NFC'
          : team.division?.toUpperCase().includes('AFC')
            ? 'AFC'
            : null);
      const conference = TEAM_CONFERENCES.includes(
        inferredConference as (typeof TEAM_CONFERENCES)[number]
      )
        ? inferredConference
        : null;

      if (!conference) {
        miscTeams.push(team);
        continue;
      }

      const division =
        team.division && team.division.trim().length ? team.division : `${conference} Unassigned`;
      if (!byConference.has(conference)) {
        byConference.set(conference, new Map());
      }
      const conferenceGroups = byConference.get(conference);
      if (!conferenceGroups) continue;
      if (!conferenceGroups.has(division)) {
        conferenceGroups.set(division, []);
      }
      conferenceGroups.get(division)?.push(team);
    }

    const conferences = TEAM_CONFERENCES.map((conference) => {
      const divisionMap = byConference.get(conference) ?? new Map();
      const preferredDivisionOrder = TEAM_DIVISIONS_BY_CONFERENCE[conference];
      const orderedDivisions = Array.from(divisionMap.keys()).sort((a, b) => {
        const aIndex = preferredDivisionOrder.indexOf(a);
        const bIndex = preferredDivisionOrder.indexOf(b);
        if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
        if (aIndex >= 0) return -1;
        if (bIndex >= 0) return 1;
        return a.localeCompare(b);
      });
      return {
        conference,
        divisions: orderedDivisions.map((division) => ({
          division,
          teams: sortGridstreamTeamFilterOptions(divisionMap.get(division) ?? []),
        })),
      };
    }).filter((conference) => conference.divisions.length > 0);

    return {
      conferences,
      freeAgentTeam,
      miscTeams: sortGridstreamTeamFilterOptions(miscTeams),
    };
  }, [effectiveTeamOptions]);

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: FilterKey; label: string; value: string }> = [];
    if (routeState.filters.search)
      chips.push({ key: 'search', label: 'Search', value: routeState.filters.search });
    if (routeState.filters.team) {
      chips.push({
        key: 'team',
        label: 'Team',
        value: summarizeTokenList(parseUpperTokenList(routeState.filters.team), 'All Teams'),
      });
    }
    if (routeState.filters.teamNot) {
      chips.push({
        key: 'teamNot',
        label: 'Exclude Team',
        value: summarizeTokenList(parseUpperTokenList(routeState.filters.teamNot), ''),
      });
    }
    if (routeState.filters.position)
      chips.push({ key: 'position', label: 'Position', value: routeState.filters.position });
    if (routeState.filters.draftYear != null) {
      chips.push({
        key: 'draftYear',
        label: 'Draft Year',
        value: summarizeNumericFilterLabel(routeState.filters.draftYear, 'All Years'),
      });
    }
    if (routeState.filters.season != null) {
      chips.push({
        key: 'season',
        label: 'Season',
        value: summarizeNumericFilterLabel(routeState.filters.season, 'All Seasons'),
      });
    }
    if (routeState.filters.statsSeason != null) {
      chips.push({
        key: 'statsSeason',
        label: 'Stats',
        value:
          routeState.filters.statsWeek == null
            ? `${routeState.filters.statsSeason}`
            : `${routeState.filters.statsSeason} · W${routeState.filters.statsWeek}`,
      });
    }
    if (selectedRosterStatuses.length > 0 && !isRetiredScopePreset) {
      chips.push({
        key: 'rosterStatus',
        label: 'Roster',
        value: rosterStatusSummaryLabel(selectedRosterStatuses),
      });
    }
    if (routeState.filters.isActive === false) {
      chips.push({ key: 'isActive', label: 'Scope', value: 'League Inactive' });
    } else if (isRetiredScopePreset) {
      chips.push({ key: 'isActive', label: 'Scope', value: 'Retired' });
    } else if (routeState.filters.isActive === null) {
      chips.push({ key: 'isActive', label: 'Scope', value: 'All Players' });
    }
    return chips;
  }, [isRetiredScopePreset, routeState.filters, selectedRosterStatuses]);

  const clearFilter = (key: FilterKey) => {
    if (key === 'statsSeason') {
      updateRouteState({
        filters: { statsSeason: null, statsWeek: null },
        resetPage: true,
      });
      return;
    }
    if (key === 'isActive') {
      updateRouteState({
        filters: {
          isActive: true,
          rosterStatus: isRetiredScopePreset ? null : routeState.filters.rosterStatus,
        },
        resetPage: true,
      });
      return;
    }
    const clearValue = key === 'search' ? '' : null;
    updateRouteState({
      filters: { [key]: clearValue } as Partial<GridstreamPlayerFilterState>,
      resetPage: true,
    });
  };

  const clearAll = () => {
    updateRouteState({ ...DEFAULT_ROUTE_STATE });
  };

  const toggleMenu = (menuId: PlayerFilterMenuId) => {
    setOpenMenu((current) => (current === menuId ? null : menuId));
  };

  const activeTeamFilterLabel = useMemo(() => {
    return summarizeTeamFilterLabel(routeState.filters.team, routeState.filters.teamNot);
  }, [routeState.filters.team, routeState.filters.teamNot]);
  const totalPlayers = directory?.count ?? 0;
  const totalPages = directory?.totalPages ?? 1;
  const currentPage = directory?.page ?? routeState.page;

  const applyColumnSelection = (selectedColumns: readonly string[]) => {
    const ordered = COLUMN_ORDER.filter((columnKey) => selectedColumns.includes(columnKey));
    updateRouteState({
      columns: sanitizeGridstreamPlayerTableColumns(ordered),
    });
  };

  const resetColumnsToAuto = () => {
    updateRouteState({
      columns: [...GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS],
    });
  };

  const showAllColumns = () => {
    applyColumnSelection(COLUMN_ORDER);
  };

  const setColumnEnabled = (columnKey: GridstreamPlayerTableColumnKey, enabled: boolean) => {
    if (columnKey === 'player') return;
    const next = new Set(visibleColumns);
    if (enabled) next.add(columnKey);
    else next.delete(columnKey);
    applyColumnSelection(Array.from(next));
  };

  const applyStatsSeason = (value: string) => {
    const nextSeason = value ? Number.parseInt(value, 10) : null;
    if (nextSeason == null || Number.isNaN(nextSeason)) {
      updateRouteState({
        filters: { statsSeason: null, statsWeek: null },
        resetPage: true,
      });
      return;
    }
    updateRouteState({
      filters: {
        statsSeason: nextSeason,
        statsWeek: routeState.filters.statsWeek,
      },
      resetPage: true,
    });
  };

  const applyStatsWeek = (value: string) => {
    const nextWeek = value ? Number.parseInt(value, 10) : null;
    if (nextWeek == null || Number.isNaN(nextWeek)) {
      updateRouteState({
        filters: { statsWeek: null },
        resetPage: true,
      });
      return;
    }
    updateRouteState({
      filters: {
        statsWeek: nextWeek,
      },
      resetPage: true,
    });
  };

  const applySort = (sortKey: GridstreamPlayerSortKey) => {
    updateRouteState({
      sort: toggleGridstreamPlayerSort(routeState.sort, sortKey),
      resetPage: true,
    });
  };

  const applyScopePreset = (scope: 'active' | 'inactive' | 'retired' | 'all') => {
    if (scope === 'active') {
      updateRouteState({
        filters: {
          isActive: true,
          rosterStatus: null,
        },
        resetPage: true,
      });
      return;
    }
    if (scope === 'inactive') {
      updateRouteState({
        filters: {
          isActive: false,
          rosterStatus: null,
        },
        resetPage: true,
      });
      return;
    }
    if (scope === 'retired') {
      updateRouteState({
        filters: {
          isActive: null,
          rosterStatus: 'Retired',
        },
        resetPage: true,
      });
      return;
    }
    updateRouteState({
      filters: {
        isActive: null,
        rosterStatus: null,
      },
      resetPage: true,
    });
  };

  const cycleTeamFilter = (teamAbbreviation: string) => {
    updateRouteState({
      filters: cycleGridstreamTeamFilterMode(routeState.filters, teamAbbreviation),
      resetPage: true,
    });
  };

  const setTeamDivisionFilterMode = (
    teamAbbreviations: readonly string[],
    mode: 'include' | 'exclude' | 'off'
  ) => {
    const includeTeams = new Set(parseUpperTokenList(routeState.filters.team));
    const excludeTeams = new Set(parseUpperTokenList(routeState.filters.teamNot));

    for (const rawTeam of teamAbbreviations) {
      const team = rawTeam.toUpperCase();
      if (!team) continue;
      includeTeams.delete(team);
      excludeTeams.delete(team);
      if (mode === 'include') includeTeams.add(team);
      if (mode === 'exclude') excludeTeams.add(team);
    }

    updateRouteState({
      filters: {
        team: joinUpperTokenList(includeTeams),
        teamNot: joinUpperTokenList(excludeTeams),
      },
      resetPage: true,
    });
  };

  const clearTeamFilters = () => {
    updateRouteState({
      filters: {
        team: null,
        teamNot: null,
      },
      resetPage: true,
    });
  };

  const resolveTeamGroupFilterMode = (teamAbbreviations: readonly string[]) => {
    if (teamAbbreviations.length === 0) return 'off' as const;
    let includeCount = 0;
    let excludeCount = 0;
    for (const teamAbbreviation of teamAbbreviations) {
      const mode = resolveGridstreamTeamFilterMode(routeState.filters, teamAbbreviation);
      if (mode === 'include') includeCount += 1;
      if (mode === 'exclude') excludeCount += 1;
    }
    if (includeCount === teamAbbreviations.length) return 'include' as const;
    if (excludeCount === teamAbbreviations.length) return 'exclude' as const;
    if (includeCount === 0 && excludeCount === 0) return 'off' as const;
    return 'mixed' as const;
  };

  const cycleTeamDivisionFilter = (teamAbbreviations: readonly string[]) => {
    if (teamAbbreviations.length === 0) return;
    const currentMode = resolveTeamGroupFilterMode(teamAbbreviations);
    const nextMode =
      currentMode === 'include' ? 'exclude' : currentMode === 'exclude' ? 'off' : 'include';
    setTeamDivisionFilterMode(teamAbbreviations, nextMode);
  };

  const toggleDraftYearFilter = (draftYear: number) => {
    const next = new Set(selectedDraftYears);
    if (next.has(draftYear)) next.delete(draftYear);
    else next.add(draftYear);
    updateRouteState({
      filters: {
        draftYear: joinNumericTokenList(next),
      },
      resetPage: true,
    });
  };

  const toggleSeasonFilter = (season: number) => {
    const next = new Set(selectedSeasons);
    if (next.has(season)) next.delete(season);
    else next.add(season);
    updateRouteState({
      filters: {
        season: joinNumericTokenList(next),
      },
      resetPage: true,
    });
  };

  const toggleRosterStatusFilter = (statusLabel: string) => {
    const next = new Set(selectedRosterStatusKeys);
    const normalizedKey = normalizeRosterStatusToken(statusLabel);
    if (!normalizedKey) return;
    if (next.has(normalizedKey)) next.delete(normalizedKey);
    else next.add(normalizedKey);

    const orderedStatuses = rosterStatusFilterOptions
      .map((option) => option.label)
      .filter((label) => next.has(normalizeRosterStatusToken(label)));

    updateRouteState({
      filters: {
        rosterStatus: orderedStatuses.length > 0 ? orderedStatuses.join(', ') : null,
      },
      resetPage: true,
    });
  };

  const renderPlayerCell = (
    player: GridstreamPlayerSummary,
    columnKey: GridstreamPlayerTableColumnKey
  ) => {
    if (columnKey === 'player') {
      return (
        <td key={columnKey} className="gs-players-table-cell gs-players-player-cell is-sticky">
          <Link
            href={`/gridstream/players/${encodeURIComponent(toGridstreamPlayerRouteId(player))}`}
            className="gs-players-player-link"
          >
            {player.displayName}
          </Link>
          {player.position && (
            <span className="gs-players-pos-badge">{player.position}</span>
          )}
        </td>
      );
    }

    const gamesPlayed = finiteNumber(player.gamesPlayed) ?? 0;
    const passCompletions = finiteNumber(player.passCompletions) ?? 0;
    const passAttempts = finiteNumber(player.passAttempts) ?? 0;
    const passingYards = finiteNumber(player.passingYards) ?? 0;
    const passingTds = finiteNumber(player.passingTds) ?? 0;
    const interceptionsThrown = finiteNumber(player.interceptionsThrown) ?? 0;
    const rushingYards = finiteNumber(player.rushingYards) ?? 0;
    const rushingTds = finiteNumber(player.rushingTds) ?? 0;
    const carries = finiteNumber(player.carries) ?? 0;
    const receptions = finiteNumber(player.receptions) ?? 0;
    const targets = finiteNumber(player.targets) ?? 0;
    const receivingYards = finiteNumber(player.receivingYards) ?? 0;
    const receivingTds = finiteNumber(player.receivingTds) ?? 0;
    const totalTouchdowns =
      finiteNumber(player.totalTouchdowns) ?? passingTds + rushingTds + receivingTds;
    const scrimmageYards = finiteNumber(player.scrimmageYards) ?? rushingYards + receivingYards;
    // Pre-compute derived rate stats used for heat thresholds below.
    const compPctVal = player.completionPct ?? divideMetric(passCompletions, passAttempts, 100);
    const ypaVal = player.yardsPerAttempt ?? divideMetric(passingYards, passAttempts);
    const ypcarVal = player.yardsPerCarry ?? divideMetric(rushingYards, carries);
    const yprVal = player.yardsPerReception ?? divideMetric(receivingYards, receptions);
    const yptVal = player.yardsPerTarget ?? divideMetric(receivingYards, targets);
    const catchPctVal = player.catchPct ?? divideMetric(receptions, targets, 100);

    // Build column-level heat modifier map. Thresholds are single-season calibrated.
    const heat: Partial<Record<GridstreamPlayerTableColumnKey, string>> = {};
    if (passAttempts >= 50) {
      heat.completionPct = numHeat(compPctVal, 67, 58);
      heat.yardsPerAttempt = numHeat(ypaVal, 8.5, 6.5);
      heat.passTd = numHeat(passingTds, 25);
      heat.interceptions = numHeatBad(interceptionsThrown, 15);
      heat.passerRating = numHeat(finiteNumber(player.passerRating), 100, 75);
      heat.passYards = numHeat(passingYards, 3500);
      heat.passYdsPerGame = numHeat(
        finiteNumber(player.passingYardsPerGame) ?? divideMetric(passingYards, gamesPlayed),
        275
      );
    }
    if (carries >= 50) {
      heat.yardsPerCarry = numHeat(ypcarVal, 5.0, 3.5);
      heat.rushTd = numHeat(rushingTds, 12);
      heat.rushYards = numHeat(rushingYards, 1200);
      heat.rushYdsPerGame = numHeat(
        finiteNumber(player.rushingYardsPerGame) ?? divideMetric(rushingYards, gamesPlayed),
        80
      );
    }
    if (targets >= 20) {
      heat.catchPct = numHeat(catchPctVal, 75, 55);
      heat.recYards = numHeat(receivingYards, 1000);
      heat.recTd = numHeat(receivingTds, 10);
      heat.yardsPerReception = numHeat(yprVal, 14, 8);
      heat.yardsPerTarget = numHeat(yptVal, 10, 5);
      heat.recYdsPerGame = numHeat(
        finiteNumber(player.receivingYardsPerGame) ?? divideMetric(receivingYards, gamesPlayed),
        75
      );
    }
    if (gamesPlayed >= 5) {
      heat.totalTd = numHeat(totalTouchdowns, 20);
      heat.scrimmageYards = numHeat(scrimmageYards, 1500);
      heat.tdPerGame = numHeat(
        finiteNumber(player.touchdownsPerGame) ?? divideMetric(totalTouchdowns, gamesPlayed),
        1.5
      );
      heat.snapPct = numHeat(finiteNumber(player.snapPct), 85, 40);
      heat.sacksMade = numHeat(finiteNumber(player.sacksMade), 10);
      heat.defInterceptions = numHeat(finiteNumber(player.interceptionsCaught), 5);
      const fumblesLostVal = finiteNumber(player.fumblesLost);
      if (fumblesLostVal != null) heat.fumblesLost = numHeatBad(fumblesLostVal, 4);
      const fumblesVal = finiteNumber(player.fumbles);
      if (fumblesVal != null) heat.fumbles = numHeatBad(fumblesVal, 5);
    }

    const heatMod = heat[columnKey];
    const cellClassName = `gs-players-table-cell${isNumericPlayerColumn(columnKey) ? ' is-numeric' : ''}${heatMod ? ' ' + heatMod : ''}`;
    const rosterStatus = player.rosterStatus || '—';

    switch (columnKey) {
      case 'team':
        return (
          <td key={columnKey} className={cellClassName}>
            {player.teamAbbr}
          </td>
        );
      case 'position':
        return (
          <td key={columnKey} className={cellClassName}>
            {player.position}
          </td>
        );
      case 'age':
        return (
          <td key={columnKey} className={cellClassName}>
            {player.age ?? '—'}
          </td>
        );
      case 'status':
        return (
          <td key={columnKey} className={cellClassName}>
            <span className={`gs-players-status-pill is-${rosterStatusTone(player.rosterStatus)}`}>
              {rosterStatus}
            </span>
          </td>
        );
      case 'draft':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatGridstreamDraftLabel(player)}
          </td>
        );
      case 'draftYear':
        return (
          <td key={columnKey} className={cellClassName}>
            {player.draftYear != null ? player.draftYear : 'Undrafted'}
          </td>
        );
      case 'seasons':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatGridstreamSeasonRange(player.seasonsPlayed)}
          </td>
        );
      case 'seasonsCount':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.seasonsCount ?? player.seasonsPlayed.length)}
          </td>
        );
      case 'gamesPlayed':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(gamesPlayed)}
          </td>
        );
      case 'starts':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.gamesStarted)}
          </td>
        );
      case 'offSnaps':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.offensiveSnaps)}
          </td>
        );
      case 'snapPct':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatPercentMetric(player.snapPct)}
          </td>
        );
      case 'completions':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(passCompletions)}
          </td>
        );
      case 'passAttempts':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(passAttempts)}
          </td>
        );
      case 'completionPct':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatPercentMetric(
              player.completionPct ?? divideMetric(passCompletions, passAttempts, 100)
            )}
          </td>
        );
      case 'passYards':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(passingYards)}
          </td>
        );
      case 'passYdsPerGame':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(
              player.passingYardsPerGame ?? divideMetric(passingYards, gamesPlayed)
            )}
          </td>
        );
      case 'yardsPerAttempt':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(
              player.yardsPerAttempt ?? divideMetric(passingYards, passAttempts)
            )}
          </td>
        );
      case 'passTd':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(passingTds)}
          </td>
        );
      case 'interceptions':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(interceptionsThrown)}
          </td>
        );
      case 'passerRating':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(player.passerRating)}
          </td>
        );
      case 'sacksTaken':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.sacksTaken)}
          </td>
        );
      case 'carries':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(carries)}
          </td>
        );
      case 'rushYards':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(rushingYards)}
          </td>
        );
      case 'rushYdsPerGame':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(
              player.rushingYardsPerGame ?? divideMetric(rushingYards, gamesPlayed)
            )}
          </td>
        );
      case 'yardsPerCarry':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(player.yardsPerCarry ?? divideMetric(rushingYards, carries))}
          </td>
        );
      case 'rushTd':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(rushingTds)}
          </td>
        );
      case 'targets':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(targets)}
          </td>
        );
      case 'receptions':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(receptions)}
          </td>
        );
      case 'catchPct':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatPercentMetric(player.catchPct ?? divideMetric(receptions, targets, 100))}
          </td>
        );
      case 'recYards':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(receivingYards)}
          </td>
        );
      case 'recYdsPerGame':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(
              player.receivingYardsPerGame ?? divideMetric(receivingYards, gamesPlayed)
            )}
          </td>
        );
      case 'yardsPerReception':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(
              player.yardsPerReception ?? divideMetric(receivingYards, receptions)
            )}
          </td>
        );
      case 'yardsPerTarget':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(player.yardsPerTarget ?? divideMetric(receivingYards, targets))}
          </td>
        );
      case 'recTd':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(receivingTds)}
          </td>
        );
      case 'scrimmageYards':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(scrimmageYards)}
          </td>
        );
      case 'totalTd':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(totalTouchdowns)}
          </td>
        );
      case 'tdPerGame':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(
              player.touchdownsPerGame ?? divideMetric(totalTouchdowns, gamesPlayed)
            )}
          </td>
        );
      case 'longGain':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.longGain)}
          </td>
        );
      case 'firstDowns':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.firstDowns)}
          </td>
        );
      case 'fumbles':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.fumbles)}
          </td>
        );
      case 'fumblesLost':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.fumblesLost)}
          </td>
        );
      case 'tackles':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.tacklesTotal)}
          </td>
        );
      case 'sacksMade':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatDecimalMetric(player.sacksMade)}
          </td>
        );
      case 'defInterceptions':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.interceptionsCaught)}
          </td>
        );
      case 'passesDefended':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.passesDefended)}
          </td>
        );
      case 'forcedFumbles':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.forcedFumbles)}
          </td>
        );
      case 'fgMade':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.fieldGoalsMade)}
          </td>
        );
      case 'fgAttempts':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.fieldGoalsAttempted)}
          </td>
        );
      case 'punts':
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(player.puntAttempts)}
          </td>
        );
      default:
        return (
          <td key={columnKey} className={cellClassName}>
            {formatIntegerMetric(gamesPlayed)}
          </td>
        );
    }
  };
  const freeAgentTeam = teamMenuGroups.freeAgentTeam;
  const freeAgentTeamFilterMode = freeAgentTeam
    ? resolveGridstreamTeamFilterMode(routeState.filters, freeAgentTeam.abbreviation)
    : 'off';
  const freeAgentTeamFilterClass =
    freeAgentTeamFilterMode === 'include'
      ? 'is-active'
      : freeAgentTeamFilterMode === 'exclude'
        ? 'is-excluded'
        : '';

  return (
    <main className="gs-players-page">
      <div className="gs-players-shell">
        <header className="gs-players-header">
          <div>
            <div className="gs-players-kicker">Gridstream / Players</div>
            <h1 className="gs-players-title">Player Database</h1>
            <p className="gs-players-subtitle">
              API-backed player directory with shareable filter URLs, paging, and drill-down links
              into individual player profiles.
            </p>
          </div>
          <Link href="/gridstream" className="gs-players-link">
            ← Back To Gridstream Hub
          </Link>
        </header>

        {loadingError && (
          <section className="hud-panel gs-players-notice">
            Data source note: {loadingError}.{' '}
            {directory?.source === 'mock' ? 'Showing SDK mock fallback.' : ''}
          </section>
        )}

        <section className="hud-panel gs-players-toolbar">
          <div className="gs-players-search-row">
            <input
              className="gs-players-search"
              type="text"
              value={localSearch}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setLocalSearch(value);
                if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                searchTimerRef.current = setTimeout(() => {
                  updateRouteState({ filters: { search: value }, resetPage: true });
                }, 280);
              }}
              placeholder="Search by name, team, position, college, draft year, or season…"
              aria-label="Search players"
            />
            <button className="gs-players-btn is-subtle" type="button" onClick={clearAll}>
              Clear All
            </button>
            <button
              className={`gs-players-btn is-subtle gs-players-filter-sheet-toggle${activeFilters.length > 0 ? ' is-active' : ''}`}
              type="button"
              onClick={() => setIsFilterSheetOpen(true)}
            >
              Filters ({activeFilters.length})
            </button>
          </div>
          <div className="gs-players-filter-row">
            {activeFilters.length === 0 && (
              <span className="gs-players-chip">No active filters. Showing active players.</span>
            )}
            {activeFilters.map((chip) => (
              <button
                key={`${chip.key}-${chip.value}`}
                type="button"
                className="gs-players-chip is-filter"
                onClick={() => clearFilter(chip.key)}
              >
                {chip.label}: {chip.value} ×
              </button>
            ))}
          </div>
        </section>

        <div className="gs-players-layout">
          <aside
            className={`gs-players-filters ${isFilterSheetOpen ? 'is-sheet-open' : ''}`}
            aria-label="Player directory filters"
          >
            <div className="gs-players-filters-head">
              <div>
                <div className="gs-players-kicker">Filter Console</div>
                <p className="gs-players-browse-panel-note">
                  Scope players by roster status, position, team, draft year, and season.
                </p>
              </div>
              <button
                type="button"
                className="gs-players-btn is-subtle gs-players-filters-close"
                onClick={() => {
                  setOpenMenu(null);
                  setIsFilterSheetOpen(false);
                }}
              >
                Close
              </button>
            </div>
            <section className="hud-panel gs-players-filter-menus">
              <div className="gs-players-menu-grid">
                <div
                  className={`gs-players-dropdown is-compact ${openMenu === 'scope' ? 'is-open' : ''}`}
                  data-gs-menu-root="true"
                >
                  <button
                    type="button"
                    className={`gs-players-btn is-subtle gs-players-menu-trigger ${openMenu === 'scope' ? 'is-open' : ''}`}
                    onClick={() => toggleMenu('scope')}
                    aria-expanded={openMenu === 'scope'}
                  >
                    <span>Player Scope</span>
                    <span className="gs-players-menu-value">{scopeFilterLabel}</span>
                  </button>
                  {openMenu === 'scope' && (
                    <div className="gs-players-filter-popover is-list-menu is-scope-menu">
                      <div className="gs-players-filter-row">
                        <button
                          type="button"
                          className={`gs-players-chip ${
                            routeState.filters.isActive === true ? 'is-active' : ''
                          }`}
                          onClick={() => applyScopePreset('active')}
                        >
                          League Active
                        </button>
                        <button
                          type="button"
                          className={`gs-players-chip ${
                            routeState.filters.isActive === false ? 'is-active' : ''
                          }`}
                          onClick={() => applyScopePreset('inactive')}
                        >
                          League Inactive
                        </button>
                        <button
                          type="button"
                          className={`gs-players-chip ${isRetiredScopePreset ? 'is-active' : ''}`}
                          onClick={() => applyScopePreset('retired')}
                        >
                          Retired
                        </button>
                        <button
                          type="button"
                          className={`gs-players-chip ${
                            routeState.filters.isActive === null && !isRetiredScopePreset
                              ? 'is-active'
                              : ''
                          }`}
                          onClick={() => applyScopePreset('all')}
                        >
                          All Players
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className={`gs-players-dropdown is-medium ${openMenu === 'status' ? 'is-open' : ''}`}
                  data-gs-menu-root="true"
                >
                  <button
                    type="button"
                    className={`gs-players-btn is-subtle gs-players-menu-trigger ${openMenu === 'status' ? 'is-open' : ''}`}
                    onClick={() => toggleMenu('status')}
                    aria-expanded={openMenu === 'status'}
                  >
                    <span>Roster Status</span>
                    <span className="gs-players-menu-value">{rosterStatusFilterLabel}</span>
                  </button>
                  {openMenu === 'status' && (
                    <div className="gs-players-filter-popover is-list-menu is-status-menu">
                      <div className="gs-players-filter-row">
                        {rosterStatusFilterOptions.map((status) => (
                          <button
                            key={status.key}
                            type="button"
                            className={`gs-players-chip ${
                              selectedRosterStatusKeys.has(status.key) ? 'is-active' : ''
                            }`}
                            onClick={() => toggleRosterStatusFilter(status.label)}
                          >
                            <span className="gs-players-status-option-label">{status.label}</span>
                            <span className="gs-players-status-option-count">
                              {status.count.toLocaleString('en-US')}
                            </span>
                          </button>
                        ))}
                        {rosterStatusFilterOptions.length === 0 && (
                          <span className="gs-players-chip">
                            No roster status buckets in this scope.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className={`gs-players-dropdown is-medium ${openMenu === 'position' ? 'is-open' : ''}`}
                  data-gs-menu-root="true"
                >
                  <button
                    type="button"
                    className={`gs-players-btn is-subtle gs-players-menu-trigger ${openMenu === 'position' ? 'is-open' : ''}`}
                    onClick={() => toggleMenu('position')}
                    aria-expanded={openMenu === 'position'}
                  >
                    <span>Position</span>
                    <span className="gs-players-menu-value">
                      {routeState.filters.position ?? 'All Positions'}
                    </span>
                  </button>
                  {openMenu === 'position' && (
                    <div className="gs-players-filter-popover is-position-menu">
                      <div className="gs-players-filter-sections">
                        {positionMenuSections.map((group) => (
                          <section key={group.id} className="gs-players-filter-section">
                            <h3 className="gs-players-filter-title">{group.label}</h3>
                            <div className="gs-players-filter-row">
                              {group.options.map((option) => {
                                const isActive = routeState.filters.position === option.key;
                                const isEnabled = option.count > 0 || isActive;
                                return (
                                  <button
                                    key={`${group.id}-${option.key}`}
                                    type="button"
                                    className={`gs-players-chip ${isActive ? 'is-active' : ''} ${
                                      option.subOption ? 'is-subtle' : ''
                                    }`}
                                    onClick={() =>
                                      updateRouteState({
                                        filters: {
                                          position: isActive ? null : option.key,
                                        },
                                        resetPage: true,
                                      })
                                    }
                                    disabled={!isEnabled}
                                  >
                                    {option.label} ({option.count})
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className={`gs-players-dropdown is-wide ${openMenu === 'team' ? 'is-open' : ''}`}
                  data-gs-menu-root="true"
                >
                  <button
                    type="button"
                    className={`gs-players-btn is-subtle gs-players-menu-trigger ${openMenu === 'team' ? 'is-open' : ''}`}
                    onClick={() => toggleMenu('team')}
                    aria-expanded={openMenu === 'team'}
                  >
                    <span>Team</span>
                    <span className="gs-players-menu-value">{activeTeamFilterLabel}</span>
                  </button>
                  {openMenu === 'team' && (
                    <div className="gs-players-filter-popover is-team-menu">
                      <div className="gs-players-team-menu-head">
                        <p className="gs-players-filter-note">
                          Click team/conference/division badge cycles Include → Exclude → Off.
                          Double-click a conference or division for Exclude.
                        </p>
                        <div className="gs-players-team-menu-actions">
                          {(routeState.filters.team || routeState.filters.teamNot) && (
                            <button
                              type="button"
                              className="gs-players-btn is-subtle"
                              onClick={clearTeamFilters}
                            >
                              Reset Teams
                            </button>
                          )}
                          {freeAgentTeam && (
                            <button
                              key={freeAgentTeam.abbreviation}
                              type="button"
                              className={`gs-players-team-chip is-free-agent ${freeAgentTeamFilterClass}`}
                              onClick={() => cycleTeamFilter(freeAgentTeam.abbreviation)}
                              title={`${freeAgentTeam.displayName} (${freeAgentTeamFilterMode}, ${
                                teamCountsByAbbr.get(freeAgentTeam.abbreviation) ?? 0
                              } players)`}
                              aria-label={`Team filter ${freeAgentTeam.abbreviation}: ${freeAgentTeamFilterMode}`}
                            >
                              <span className="gs-players-team-abbr">
                                {freeAgentTeam.abbreviation}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="gs-players-filter-sections">
                        {teamMenuGroups.conferences.map((conference) => {
                          const conferenceTeamAbbreviations = conference.divisions.flatMap(
                            (division) => division.teams.map((team) => team.abbreviation)
                          );
                          return (
                            <section
                              key={conference.conference}
                              className="gs-players-filter-section"
                            >
                              <h3 className="gs-players-filter-title gs-players-team-conference-title">
                                <button
                                  type="button"
                                  className={`gs-players-division-toggle gs-players-conference-toggle is-${resolveTeamGroupFilterMode(
                                    conferenceTeamAbbreviations
                                  )}`}
                                  onClick={() =>
                                    cycleTeamDivisionFilter(conferenceTeamAbbreviations)
                                  }
                                  onDoubleClick={(event) => {
                                    event.preventDefault();
                                    setTeamDivisionFilterMode(
                                      conferenceTeamAbbreviations,
                                      'exclude'
                                    );
                                  }}
                                  aria-label={`Conference filter ${conference.conference}`}
                                >
                                  {conference.conference}
                                </button>
                              </h3>
                              {conference.divisions.map((division) => (
                                <div key={division.division} className="gs-players-team-division">
                                  <h4 className="gs-players-team-division-title">
                                    <button
                                      type="button"
                                      className={`gs-players-division-toggle is-${resolveTeamGroupFilterMode(
                                        division.teams.map((team) => team.abbreviation)
                                      )}`}
                                      onClick={() =>
                                        cycleTeamDivisionFilter(
                                          division.teams.map((team) => team.abbreviation)
                                        )
                                      }
                                      onDoubleClick={(event) => {
                                        event.preventDefault();
                                        setTeamDivisionFilterMode(
                                          division.teams.map((team) => team.abbreviation),
                                          'exclude'
                                        );
                                      }}
                                      aria-label={`Division filter ${division.division}`}
                                    >
                                      {division.division}
                                    </button>
                                  </h4>
                                  <div className="gs-players-filter-row">
                                    {division.teams.map((team) => {
                                      const teamFilterMode = resolveGridstreamTeamFilterMode(
                                        routeState.filters,
                                        team.abbreviation
                                      );
                                      const teamFilterStateClass =
                                        teamFilterMode === 'include'
                                          ? 'is-active'
                                          : teamFilterMode === 'exclude'
                                            ? 'is-excluded'
                                            : '';
                                      return (
                                        <button
                                          key={team.abbreviation}
                                          type="button"
                                          className={`gs-players-team-chip ${teamFilterStateClass}`}
                                          onClick={() => cycleTeamFilter(team.abbreviation)}
                                          title={`${team.displayName} (${teamFilterMode}, ${
                                            teamCountsByAbbr.get(team.abbreviation) ?? 0
                                          } players)`}
                                          aria-label={`Team filter ${team.abbreviation}: ${teamFilterMode}`}
                                        >
                                          {team.logoUrl ? (
                                            <span
                                              className="gs-players-team-logo"
                                              style={{ backgroundImage: `url("${team.logoUrl}")` }}
                                              aria-hidden="true"
                                            />
                                          ) : (
                                            <span className="gs-players-team-fallback">
                                              {team.abbreviation}
                                            </span>
                                          )}
                                          <span className="gs-players-team-abbr">
                                            {team.abbreviation}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </section>
                          );
                        })}
                        {teamMenuGroups.miscTeams.length > 0 && (
                          <section className="gs-players-filter-section">
                            <h3 className="gs-players-filter-title">Other Teams</h3>
                            <div className="gs-players-filter-row">
                              {teamMenuGroups.miscTeams.map((team) => {
                                const teamFilterMode = resolveGridstreamTeamFilterMode(
                                  routeState.filters,
                                  team.abbreviation
                                );
                                const teamFilterStateClass =
                                  teamFilterMode === 'include'
                                    ? 'is-active'
                                    : teamFilterMode === 'exclude'
                                      ? 'is-excluded'
                                      : '';
                                return (
                                  <button
                                    key={team.abbreviation}
                                    type="button"
                                    className={`gs-players-team-chip ${teamFilterStateClass}`}
                                    onClick={() => cycleTeamFilter(team.abbreviation)}
                                    title={`${team.displayName} (${teamFilterMode}, ${
                                      teamCountsByAbbr.get(team.abbreviation) ?? 0
                                    } players)`}
                                    aria-label={`Team filter ${team.abbreviation}: ${teamFilterMode}`}
                                  >
                                    {team.logoUrl ? (
                                      <span
                                        className="gs-players-team-logo"
                                        style={{ backgroundImage: `url("${team.logoUrl}")` }}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <span className="gs-players-team-fallback">
                                        {team.abbreviation}
                                      </span>
                                    )}
                                    <span className="gs-players-team-abbr">
                                      {team.abbreviation}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className={`gs-players-dropdown is-compact ${openMenu === 'draftYear' ? 'is-open' : ''}`}
                  data-gs-menu-root="true"
                >
                  <button
                    type="button"
                    className={`gs-players-btn is-subtle gs-players-menu-trigger ${openMenu === 'draftYear' ? 'is-open' : ''}`}
                    onClick={() => toggleMenu('draftYear')}
                    aria-expanded={openMenu === 'draftYear'}
                  >
                    <span>Draft Year</span>
                    <span className="gs-players-menu-value">{draftYearFilterLabel}</span>
                  </button>
                  {openMenu === 'draftYear' && (
                    <div className="gs-players-filter-popover is-token-grid-menu">
                      <div className="gs-players-filter-row">
                        {draftYearMenuOptions.map(({ year, count }) => {
                          return (
                            <button
                              key={year}
                              type="button"
                              className={`gs-players-chip ${selectedDraftYearSet.has(year) ? 'is-active' : ''}`}
                              onClick={() => toggleDraftYearFilter(year)}
                            >
                              {year} ({count})
                            </button>
                          );
                        })}
                        {draftYearMenuOptions.length === 0 && (
                          <span className="gs-players-chip">
                            No draft-year buckets in this scope.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className={`gs-players-dropdown is-compact ${openMenu === 'season' ? 'is-open' : ''}`}
                  data-gs-menu-root="true"
                >
                  <button
                    type="button"
                    className={`gs-players-btn is-subtle gs-players-menu-trigger ${openMenu === 'season' ? 'is-open' : ''}`}
                    onClick={() => toggleMenu('season')}
                    aria-expanded={openMenu === 'season'}
                  >
                    <span>Season Played</span>
                    <span className="gs-players-menu-value">{seasonFilterLabel}</span>
                  </button>
                  {openMenu === 'season' && (
                    <div className="gs-players-filter-popover is-token-grid-menu">
                      <div className="gs-players-filter-row">
                        {seasonMenuOptions.map(({ year, count }) => {
                          return (
                            <button
                              key={year}
                              type="button"
                              className={`gs-players-chip ${selectedSeasonSet.has(year) ? 'is-active' : ''}`}
                              onClick={() => toggleSeasonFilter(year)}
                            >
                              {year} ({count})
                            </button>
                          );
                        })}
                        {seasonMenuOptions.length === 0 && (
                          <span className="gs-players-chip">No season buckets in this scope.</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </aside>

          <div className="gs-players-content">
            <section className="hud-panel gs-players-table-panel">
              <div className="gs-players-table-controls">
                <div className="gs-players-table-controls-left">
                  <label className="gs-players-select-group">
                    <span className="gs-players-control-label">Stats Season</span>
                    <select
                      className="gs-players-select"
                      value={routeState.filters.statsSeason ?? ''}
                      onChange={(event) => applyStatsSeason(event.currentTarget.value)}
                    >
                      <option value="">Career</option>
                      {statsSeasonOptions.map((season) => (
                        <option key={season} value={season}>
                          {season}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="gs-players-select-group">
                    <span className="gs-players-control-label">Stats Week</span>
                    <select
                      className="gs-players-select"
                      value={routeState.filters.statsWeek ?? ''}
                      onChange={(event) => applyStatsWeek(event.currentTarget.value)}
                      disabled={routeState.filters.statsSeason == null}
                    >
                      <option value="">All Weeks</option>
                      {statsWeekOptions.map((week) => (
                        <option key={week} value={week}>
                          Week {week}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="gs-players-table-controls-right">
                  <div
                    className="gs-players-columns-menu gs-players-dropdown"
                    data-gs-menu-root="true"
                  >
                    <button
                      type="button"
                      className={`gs-players-btn is-subtle gs-players-menu-trigger ${openMenu === 'columns' ? 'is-open' : ''}`}
                      onClick={() => toggleMenu('columns')}
                      aria-expanded={openMenu === 'columns'}
                    >
                      <span>Columns ({visibleColumns.length})</span>
                    </button>
                    {openMenu === 'columns' && (
                      <div className="gs-players-columns-popover">
                        <div className="gs-players-columns-header">
                          <span className="gs-players-control-label">Show Columns</span>
                          <span className="gs-players-columns-actions">
                            {visibleColumns.length < COLUMN_ORDER.length && (
                              <button
                                type="button"
                                className="gs-players-btn is-subtle"
                                onClick={showAllColumns}
                              >
                                Show All
                              </button>
                            )}
                            {hasCustomColumns && (
                              <button
                                type="button"
                                className="gs-players-btn is-subtle"
                                onClick={resetColumnsToAuto}
                              >
                                Use Auto
                              </button>
                            )}
                          </span>
                        </div>
                        <div className="gs-players-columns-categories">
                          {columnCategorySections.map((category) => (
                            <section key={category.key} className="gs-players-columns-category">
                              <h3 className="gs-players-columns-category-title">
                                {category.label}
                              </h3>
                              <fieldset
                                className="gs-players-columns-list"
                                aria-label={`Selectable player table columns: ${category.label}`}
                              >
                                {category.options.map((column) => (
                                  <label
                                    key={column.key}
                                    className={`gs-players-column-option ${
                                      visibleColumns.includes(column.key) ? 'is-active' : ''
                                    } ${column.key === 'player' ? 'is-locked' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={visibleColumns.includes(column.key)}
                                      onChange={(event) =>
                                        setColumnEnabled(column.key, event.currentTarget.checked)
                                      }
                                      disabled={column.key === 'player'}
                                    />
                                    <span>{labelForColumnChooser(column)}</span>
                                  </label>
                                ))}
                              </fieldset>
                            </section>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className={`gs-players-table-wrap ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
                <table className="gs-players-table">
                  <thead>
                    <tr>
                      {visibleColumnOptions.map((column) => {
                        const isSorted = routeState.sort?.key === column.sortKey;
                        const isNumeric = isNumericPlayerColumn(column.key);
                        const thClassName = `gs-players-table-head-cell ${column.key === 'player' ? 'is-sticky' : ''} ${
                          isNumeric ? 'is-numeric' : ''
                        }`;
                        return (
                          <th key={column.key} className={thClassName}>
                            {column.sortKey ? (
                              <button
                                type="button"
                                className={`gs-players-th-btn ${isSorted ? 'is-active' : ''}`}
                                onClick={() => applySort(column.sortKey as GridstreamPlayerSortKey)}
                              >
                                <span>{column.label}</span>
                                {isSorted && (
                                  <span className="gs-players-th-sort">
                                    {routeState.sort?.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            ) : (
                              <span className="gs-players-th-label">{column.label}</span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((player) => {
                      const playerHref = `/gridstream/players/${encodeURIComponent(toGridstreamPlayerRouteId(player))}`;
                      return (
                        <tr
                          key={player.id}
                          onMouseEnter={() => router.prefetch(playerHref)}
                          onClick={() => router.push(playerHref)}
                        >
                          {visibleColumnOptions.map((column) => renderPlayerCell(player, column.key))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="gs-players-mobile-list">
                  {players.map((player) => {
                    const passingYards = finiteNumber(player.passingYards) ?? 0;
                    const rushingYards = finiteNumber(player.rushingYards) ?? 0;
                    const receivingYards = finiteNumber(player.receivingYards) ?? 0;
                    const combinedYards = passingYards + rushingYards + receivingYards;
                    const totalTouchdowns =
                      finiteNumber(player.totalTouchdowns) ??
                      (finiteNumber(player.passingTds) ?? 0) +
                        (finiteNumber(player.rushingTds) ?? 0) +
                        (finiteNumber(player.receivingTds) ?? 0);
                    return (
                      <article key={player.id} className="hud-panel gs-players-mobile-card">
                        <div className="gs-players-mobile-card-head">
                          <Link
                            href={`/gridstream/players/${encodeURIComponent(toGridstreamPlayerRouteId(player))}`}
                            className="gs-players-player-link"
                          >
                            {player.displayName}
                          </Link>
                          <span
                            className={`gs-players-status-pill is-${rosterStatusTone(player.rosterStatus)}`}
                          >
                            {player.rosterStatus || '—'}
                          </span>
                        </div>
                        <div className="gs-players-mobile-card-meta">
                          <span>{player.teamAbbr}</span>
                          <span>{player.position}</span>
                          <span>{formatGridstreamSeasonRange(player.seasonsPlayed)}</span>
                        </div>
                        <div className="gs-players-mobile-card-stats">
                          <div>
                            <span className="gs-players-mobile-stat-label">Games</span>
                            <strong>{formatIntegerMetric(player.gamesPlayed)}</strong>
                          </div>
                          <div>
                            <span className="gs-players-mobile-stat-label">Yards</span>
                            <strong>{formatIntegerMetric(combinedYards)}</strong>
                          </div>
                          <div>
                            <span className="gs-players-mobile-stat-label">TD</span>
                            <strong>{formatIntegerMetric(totalTouchdowns)}</strong>
                          </div>
                          <div>
                            <span className="gs-players-mobile-stat-label">Draft</span>
                            <strong>{formatGridstreamDraftLabel(player)}</strong>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {!loading && players.length === 0 && (
                  <div className="gs-players-empty">
                    No players match the active filters. Clear one or more filters and try again.
                  </div>
                )}

                {loading && players.length === 0 && (
                  <div className="gs-players-empty">Loading player directory…</div>
                )}
              </div>

              <div className="gs-players-result-bar">
                <span>
                  Showing {players.length} of {totalPlayers} players
                </span>
                <span className="gs-players-result-meta">
                  <span>Sort: {labelForSort(routeState.sort)}</span>
                  <span>Stats: {labelForStatsScope(routeState.filters)}</span>
                  {loading && (
                    <span className="gs-players-loading-pill" role="status" aria-live="polite">
                      Updating...
                    </span>
                  )}
                </span>
              </div>

              <div className="gs-players-pagination">
                <button
                  type="button"
                  className="gs-players-btn is-subtle"
                  onClick={() => updateRouteState({ page: routeState.page - 1 })}
                  disabled={routeState.page <= 1 || loading}
                >
                  Prev
                </button>
                <span className="gs-players-chip">
                  Page {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="gs-players-btn is-subtle"
                  onClick={() => updateRouteState({ page: routeState.page + 1 })}
                  disabled={loading || routeState.page >= totalPages}
                >
                  Next
                </button>
              </div>
            </section>
          </div>
        </div>
        <div
          className={`gs-players-filter-sheet-backdrop ${isFilterSheetOpen ? 'is-open' : ''}`}
          onClick={() => {
            setOpenMenu(null);
            setIsFilterSheetOpen(false);
          }}
          aria-hidden="true"
        />
      </div>
    </main>
  );
}
