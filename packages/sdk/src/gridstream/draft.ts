/**
 * Gridstream draft big board domain helpers.
 *
 * Covers the multi-source prospect ranking feed:
 *   GET /api/gridstream/draft/big-board/?season=2026
 */

import { resolveGridstreamApiBase } from './api-transforms';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Compact prospect data shape embedded in big board entries and used by
 * the ProspectQuickViewDrawer component.  This is the canonical SDK definition;
 * the component's DraftProspectQuickView type re-exports this.
 */
export type GridstreamDraftProspectData = {
  name: string;
  position?: string | null;
  school?: string | null;
  imageUrl?: string | null;
  collegeLogoUrl?: string | null;
  range?: string | null;
  teamMockCount?: number | null;
  totalMockCount?: number | null;
  consensusType?: string | null;
  overallRank?: number | null;
  trueAdp?: number | null;
  needLabel?: string | null;
  fitReason?: string | null;
  teamAbbr?: string | null;
  draftSeason?: number | null;
  pickLabel?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  classYear?: string | null;
  hometown?: string | null;
  role?: string | null;
  jerseyNumber?: string | null;
  draftProjection?: string | null;
  buzzOverallRating?: number | null;
  buzzOverallRank?: number | null;
  buzzPositionRank?: number | null;
  buzzPositionRankGroup?: string | null;
  allScoutsOverallRank?: number | null;
  allScoutsPositionRank?: number | null;
  height?: string | null;
  weight?: number | null;
  fortyYard?: number | null;
  handSize?: string | null;
  armLength?: string | null;
  age?: number | null;
  birthDate?: string | null;
  sourceLastUpdated?: string | null;
  collegeGames?: number | null;
  collegeSnaps?: number | null;
  bio?: string | null;
  summary?: string | null;
  strengths?: string[] | null;
  weaknesses?: string[] | null;
  honors?: string[] | null;
  productionStats?: Array<{
    label: string;
    value?: string | null;
    percentile?: number | null;
  }> | null;
  scoutingGrades?: Array<{ label: string; value?: string | null; percent?: number | null }> | null;
  measurablePercentiles?: Array<{
    label: string;
    value?: string | null;
    percentile?: number | null;
  }> | null;
  recruitingRatings?: Array<{ label: string; value?: string | null }> | null;
  comparisonPlayers?: Array<{
    name: string;
    school?: string | null;
    similarity?: number | null;
    sourceUrl?: string | null;
  }> | null;
  fitTeams?: Array<{
    team?: {
      abbreviation: string;
      displayName: string;
      shortDisplayName: string;
      colorPrimary: string;
      colorSecondary: string;
      logoUrl: string | null;
    } | null;
    needKey?: string | null;
    needLabel?: string | null;
    needRank?: number | null;
    pickLabel?: string | null;
    round?: number | null;
    overallPick?: number | null;
  }> | null;
};

/** Metadata for one ranking source (scout / outlet). */
export interface GridstreamBigBoardSource {
  /** Internal key, e.g. "nflmockdraftdb_daniel_jeremiah" */
  key: string;
  /** Human-readable label, e.g. "Daniel Jeremiah (NFL.com)" */
  label: string;
  /** Analyst name, e.g. "Daniel Jeremiah" (null for team/site boards) */
  analyst: string | null;
  /** Outlet name, e.g. "NFL.com" */
  outlet: string | null;
  /** Link to the original board */
  url: string | null;
  /** ISO date of the most recent update, e.g. "2026-03-05" */
  updated: string | null;
}

/** One prospect row on the combined big board. */
export interface GridstreamBigBoardEntry {
  /** URL-safe identifier from nflmockdraftdatabase.com, e.g. "fernando-mendoza" */
  nameSlug: string;
  name: string;
  position: string;
  school: string;
  /** Map of source key → rank on that board (null = not ranked by that source) */
  rankings: Record<string, number>;
  /** Average rank across all sources that have ranked this prospect */
  avgRank: number | null;
  /** NFLDraftBuzz overall rank (null if no scouting profile ingested) */
  buzzRank: number | null;
  /** Full scouting profile when available (NFLDraftBuzz data) */
  prospect: GridstreamDraftProspectData | null;
}

/** Full response from GET /draft/big-board/ */
export interface GridstreamBigBoardResponse {
  season: number;
  sources: GridstreamBigBoardSource[];
  entries: GridstreamBigBoardEntry[];
}

// ---------------------------------------------------------------------------
// API mappers
// ---------------------------------------------------------------------------

function mapApiSource(raw: Record<string, unknown>): GridstreamBigBoardSource {
  return {
    key: String(raw.key ?? ''),
    label: String(raw.label ?? ''),
    analyst: raw.analyst != null ? String(raw.analyst) : null,
    outlet: raw.outlet != null ? String(raw.outlet) : null,
    url: raw.url != null ? String(raw.url) : null,
    updated: raw.updated != null ? String(raw.updated) : null,
  };
}

function mapApiEntry(raw: Record<string, unknown>): GridstreamBigBoardEntry {
  const rawRankings = raw.rankings as Record<string, number> | null;
  return {
    nameSlug: String(raw.nameSlug ?? ''),
    name: String(raw.name ?? ''),
    position: String(raw.position ?? ''),
    school: String(raw.school ?? ''),
    rankings: rawRankings ?? {},
    avgRank: raw.avgRank != null ? Number(raw.avgRank) : null,
    buzzRank: raw.buzzRank != null ? Number(raw.buzzRank) : null,
    prospect: (raw.prospect as GridstreamDraftProspectData | null) ?? null,
  };
}

function mapApiBigBoardResponse(raw: Record<string, unknown>): GridstreamBigBoardResponse {
  const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
  return {
    season: Number(raw.season ?? 0),
    sources: rawSources.map((s) => mapApiSource(s as Record<string, unknown>)),
    entries: rawEntries.map((e) => mapApiEntry(e as Record<string, unknown>)),
  };
}

// ---------------------------------------------------------------------------
// Fetch function
// ---------------------------------------------------------------------------

export async function fetchGridstreamDraftBigBoard(
  apiBase: string,
  season: number,
  signal?: AbortSignal
): Promise<GridstreamBigBoardResponse> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/draft/big-board/?season=${season}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`fetchGridstreamDraftBigBoard: ${res.status} ${res.statusText} (${url})`);
  }
  const data = await res.json();
  return mapApiBigBoardResponse(data as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Mock draft types
// ---------------------------------------------------------------------------

/** One pick in an analyst's mock draft. */
export interface GridstreamMockDraftPick {
  pick: number;
  round: number;
  playerName: string;
  playerSlug: string;
  playerPosition: string;
  playerCollege: string;
  playerCollegeLogo: string | null;
  /** Last path segment of the team URL, e.g. "las-vegas-raiders" */
  teamSlug: string;
  teamColor: string | null;
  teamLogo: string | null;
  traded: string | null;
  blurb: string | null;
  prospect: GridstreamDraftProspectData | null;
}

/** One analyst's complete mock draft. */
export interface GridstreamMockDraft {
  key: string;
  label: string;
  analyst: string | null;
  outlet: string | null;
  updated: string | null;
  picks: GridstreamMockDraftPick[];
}

/** Source summary for the mock drafts listing sidebar. */
export interface GridstreamMockDraftSource {
  key: string;
  label: string;
  analyst: string | null;
  outlet: string | null;
  url: string | null;
  updated: string | null;
  pickCount: number;
}

/** Full response from GET /draft/mock-drafts/ */
export interface GridstreamMockDraftsResponse {
  season: number;
  sources: GridstreamMockDraftSource[];
  mocks: GridstreamMockDraft[];
}

function mapMockDraftPick(raw: Record<string, unknown>): GridstreamMockDraftPick {
  return {
    pick: Number(raw.pick ?? 0),
    round: Number(raw.round ?? 1),
    playerName: String(raw.playerName ?? ''),
    playerSlug: String(raw.playerSlug ?? ''),
    playerPosition: String(raw.playerPosition ?? ''),
    playerCollege: String(raw.playerCollege ?? ''),
    playerCollegeLogo: raw.playerCollegeLogo != null ? String(raw.playerCollegeLogo) : null,
    teamSlug: String(raw.teamSlug ?? ''),
    teamColor: raw.teamColor != null ? String(raw.teamColor) : null,
    teamLogo: raw.teamLogo != null ? String(raw.teamLogo) : null,
    traded: raw.traded != null ? String(raw.traded) : null,
    blurb: raw.blurb != null ? String(raw.blurb) : null,
    prospect: (raw.prospect as GridstreamDraftProspectData | null) ?? null,
  };
}

function mapMockDraft(raw: Record<string, unknown>): GridstreamMockDraft {
  const rawPicks = Array.isArray(raw.picks) ? raw.picks : [];
  return {
    key: String(raw.key ?? ''),
    label: String(raw.label ?? ''),
    analyst: raw.analyst != null ? String(raw.analyst) : null,
    outlet: raw.outlet != null ? String(raw.outlet) : null,
    updated: raw.updated != null ? String(raw.updated) : null,
    picks: rawPicks.map((p) => mapMockDraftPick(p as Record<string, unknown>)),
  };
}

function mapMockDraftSource(raw: Record<string, unknown>): GridstreamMockDraftSource {
  return {
    key: String(raw.key ?? ''),
    label: String(raw.label ?? ''),
    analyst: raw.analyst != null ? String(raw.analyst) : null,
    outlet: raw.outlet != null ? String(raw.outlet) : null,
    url: raw.url != null ? String(raw.url) : null,
    updated: raw.updated != null ? String(raw.updated) : null,
    pickCount: Number(raw.pickCount ?? 0),
  };
}

export async function fetchGridstreamMockDrafts(
  apiBase: string,
  season: number,
  signal?: AbortSignal
): Promise<GridstreamMockDraftsResponse> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/draft/mock-drafts/?season=${season}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`fetchGridstreamMockDrafts: ${res.status} ${res.statusText} (${url})`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    season: Number(data.season ?? 0),
    sources: (Array.isArray(data.sources) ? data.sources : []).map((s) =>
      mapMockDraftSource(s as Record<string, unknown>)
    ),
    mocks: (Array.isArray(data.mocks) ? data.mocks : []).map((m) =>
      mapMockDraft(m as Record<string, unknown>)
    ),
  };
}

// ---------------------------------------------------------------------------
// Position group helpers
// ---------------------------------------------------------------------------

/** Canonical position groups for filter UI, ordered for display. */
export const DRAFT_POSITION_GROUPS: Array<{ key: string; label: string; positions: string[] }> = [
  { key: 'QB', label: 'QB', positions: ['QB'] },
  { key: 'RB', label: 'RB', positions: ['RB', 'FB'] },
  { key: 'WR', label: 'WR', positions: ['WR'] },
  { key: 'TE', label: 'TE', positions: ['TE'] },
  { key: 'OL', label: 'OL', positions: ['OT', 'OG', 'C', 'G', 'OL'] },
  { key: 'EDGE', label: 'EDGE', positions: ['EDGE', 'OLB', 'DE'] },
  { key: 'DL', label: 'DL', positions: ['DL', 'DT', 'NT', 'IDL'] },
  { key: 'LB', label: 'LB', positions: ['LB', 'ILB', 'MLB'] },
  { key: 'CB', label: 'CB', positions: ['CB'] },
  { key: 'S', label: 'S', positions: ['S', 'SS', 'FS', 'SAF'] },
  { key: 'K/P', label: 'K/P', positions: ['K', 'P', 'LS'] },
];

export function getDraftPositionGroupKey(position: string): string {
  const pos = position.toUpperCase().trim();
  for (const group of DRAFT_POSITION_GROUPS) {
    if (group.positions.includes(pos)) return group.key;
  }
  return pos;
}
