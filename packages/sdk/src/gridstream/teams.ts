/**
 * Gridstream teams domain helpers.
 *
 * Types and fetch functions for the Teams section:
 *   - Teams index (all 32 teams + standings)
 *   - Team detail (profile, season stats, game log, roster, rankings)
 *
 * Framework-agnostic — no React, no Next.js imports.
 */

import { resolveGridstreamApiBase } from './api-transforms';

// =============================================================================
// UTILITY (local copies to avoid cross-module coupling)
// =============================================================================

function normalizeString(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value).trim();
}

function buildQueryString(
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    const normalized =
      typeof value === 'number'
        ? String(value)
        : typeof value === 'boolean'
          ? value
            ? 'true'
            : 'false'
          : normalizeString(value);
    if (!normalized) return;
    searchParams.set(key, normalized);
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

async function fetchTeamsJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeoutMs = 12_000;
  const ctrl = new AbortController();
  const forward = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', forward, { once: true });
  }
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(tid);
    if (signal) signal.removeEventListener('abort', forward);
  }
}

function resolveTeamLogo(
  logos: Array<{ logo_type?: string | null; url?: string | null }> | null | undefined,
  preferScoreboard = false
): string | null {
  if (!logos?.length) return null;
  const byType = new Map<string, string>();
  for (const logo of logos) {
    const key = normalizeString(logo.logo_type).toLowerCase();
    const url = normalizeString(logo.url);
    if (key && url) byType.set(key, url);
  }
  if (preferScoreboard) {
    return (
      byType.get('scoreboard') ??
      byType.get('scoreboard-dark') ??
      byType.get('default') ??
      byType.get('dark') ??
      logos.map((l) => normalizeString(l.url)).find(Boolean) ??
      null
    );
  }
  return (
    byType.get('default') ??
    byType.get('dark') ??
    logos.map((l) => normalizeString(l.url)).find(Boolean) ??
    null
  );
}

// =============================================================================
// API SHAPES (raw response from Django)
// =============================================================================

export interface ApiTeamLogo {
  logo_type?: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ApiTeamListItem {
  id?: number | null;
  espn_id?: string | null;
  abbreviation?: string | null;
  slug?: string | null;
  location?: string | null;
  name?: string | null;
  display_name?: string | null;
  short_display_name?: string | null;
  color_primary?: string | null;
  color_secondary?: string | null;
  conference?: string | null;
  division?: string | null;
  is_active?: boolean;
  logos?: ApiTeamLogo[] | null;
}

export interface ApiTeamSocialAccount {
  platform?: string | null;
  account_type?: string | null;
  handle?: string | null;
  url?: string | null;
  display_name?: string | null;
  is_verified?: boolean;
}

export interface ApiTeamDetail extends ApiTeamListItem {
  nickname?: string | null;
  social_accounts?: ApiTeamSocialAccount[] | null;
  player_count?: number | null;
}

export interface ApiTeamStanding {
  season?: number | null;
  team?: {
    abbreviation?: string | null;
    display_name?: string | null;
    short_display_name?: string | null;
    color_primary?: string | null;
    color_secondary?: string | null;
    logo_url?: string | null;
  } | null;
  conference?: string | null;
  division?: string | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  pct?: number | null;
  win_pct?: number | null;
  div_rank?: number | null;
  seed?: number | null;
  points_for?: number | null;
  points_against?: number | null;
  point_diff?: number | null;
  sov?: number | null;
  sos?: number | null;
  streak?: string | null;
  last_5?: string | null;
  playoff_clincher?: string | null;
}

export interface ApiTeamReference {
  id?: number | null;
  abbreviation?: string | null;
  display_name?: string | null;
  short_display_name?: string | null;
  color_primary?: string | null;
  color_secondary?: string | null;
  logo_url?: string | null;
}

export interface ApiTeamSeasonStats {
  season?: number | null;
  games?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  pct?: number | null;
  points_for?: number | null;
  points_against?: number | null;
  point_diff?: number | null;
  ppg?: number | null;
  papg?: number | null;
  total_yds_pg?: number | null;
  pass_yds_pg?: number | null;
  rush_yds_pg?: number | null;
  sacks_pg?: number | null;
  turnovers?: number | null;
  turnovers_pg?: number | null;
  takeaways?: number | null;
  takeaways_pg?: number | null;
  third_down_pct?: number | null;
  redzone_pct?: number | null;
  off_epa_pg?: number | null;
  def_epa_pg?: number | null;
  seed?: number | null;
  div_rank?: number | null;
  sos?: number | null;
}

export interface ApiTeamGameLogEntry {
  game_id?: number | string | null;
  week?: number | null;
  season_year?: number | null;
  season_type?: string | null;
  game_date?: string | null;
  is_home?: boolean;
  is_division_game?: boolean | null;
  opponent_abbr?: string | null;
  opponent_display?: string | null;
  opponent_color?: string | null;
  opponent_logo?: string | null;
  game_status?: string | null;
  team_score?: number | null;
  opp_score?: number | null;
  result?: 'W' | 'L' | 'T' | null;
  // Box stats
  total_yards?: number | null;
  pass_yards?: number | null;
  rush_yards?: number | null;
  pass_yards_allowed?: number | null;
  rush_yards_allowed?: number | null;
  sacks_made?: number | null;
  turnovers?: number | null;
  takeaways?: number | null;
  third_down_conv?: number | null;
  third_down_att?: number | null;
  redzone_scores?: number | null;
  redzone_att?: number | null;
  off_epa?: number | null;
  def_epa?: number | null;
  pass_epa?: number | null;
  rush_epa?: number | null;
  time_of_possession?: string | null;
}

export interface ApiTeamRankingEntry {
  label?: string | null;
  value?: number | null;
  league_rank?: number | null;
  league_total?: number | null;
  conf_rank?: number | null;
  conf_total?: number | null;
  conf_name?: string | null;
  div_rank?: number | null;
  div_total?: number | null;
  div_name?: string | null;
  higher_is_better?: boolean;
}

export type ApiTeamRankings = Record<string, ApiTeamRankingEntry>;

export interface ApiTeamDvoaSnapshot {
  season?: number | null;
  season_type?: 'REG' | 'POST' | string | null;
  week?: number | null;
  team?: {
    id?: number | null;
    abbreviation?: string | null;
    display_name?: string | null;
    short_display_name?: string | null;
    color_primary?: string | null;
    color_secondary?: string | null;
    logo_url?: string | null;
  } | null;
  record_snapshot?: string | null;
  total_dvoa?: number | null;
  offense_dvoa?: number | null;
  defense_dvoa?: number | null;
  special_teams_dvoa?: number | null;
  weighted_total_dvoa?: number | null;
  total_dvoa_rank?: number | null;
  offense_dvoa_rank?: number | null;
  defense_dvoa_rank?: number | null;
  special_teams_dvoa_rank?: number | null;
  weighted_total_dvoa_rank?: number | null;
  last_week_rank?: number | null;
  last_week_weighted_rank?: number | null;
  non_adjusted_total_voi?: number | null;
  offense_voa_unadjusted?: number | null;
  defense_voa_unadjusted?: number | null;
  special_teams_voa_unadjusted?: number | null;
  estimated_wins?: number | null;
  past_schedule_dvoa?: number | null;
  future_schedule_dvoa?: number | null;
  variance?: number | null;
  weighted_offense_dvoa?: number | null;
  weighted_defense_dvoa?: number | null;
  weighted_special_teams_dvoa?: number | null;
  metrics_raw?: Record<string, unknown> | null;
  updated_at?: string | null;
}

export interface ApiTeamDvoaListResponse {
  season?: number | null;
  season_type?: 'REG' | 'POST' | string | null;
  count?: number | null;
  results?: ApiTeamDvoaSnapshot[] | null;
}

export interface ApiTeamDvoaDetailResponse {
  team?: ApiTeamDvoaSnapshot['team'] | null;
  latest?: {
    REG?: ApiTeamDvoaSnapshot | null;
    POST?: ApiTeamDvoaSnapshot | null;
  } | null;
  history?: {
    REG?: ApiTeamDvoaSnapshot[] | null;
    POST?: ApiTeamDvoaSnapshot[] | null;
  } | null;
}

export interface ApiTeamRbsdmMetric {
  season?: number | null;
  week?: number | null;
  dataset?: string | null;
  team?: ApiTeamDvoaSnapshot['team'] | null;
  table_context?: string | null;
  metrics?: Record<string, unknown> | null;
  captured_at?: string | null;
  updated_at?: string | null;
}

export interface ApiTeamRbsdmResponse {
  season?: number | null;
  team?: ApiTeamDvoaSnapshot['team'] | null;
  count?: number | null;
  datasets?: Record<string, ApiTeamRbsdmMetric[] | null> | null;
  latest?: Record<string, ApiTeamRbsdmMetric | null> | null;
}

export interface ApiTeamFreeAgentTrackerEntry {
  id?: number | null;
  season?: number | null;
  player_id?: number | null;
  player_gsis_id?: string | null;
  player_name?: string | null;
  ourlads_player_id?: string | null;
  position?: string | null;
  fa_type?: string | null;
  tracker_status?: string | null;
  tracker_status_display?: string | null;
  team_detail?: ApiTeamReference | null;
  signed_with_team_detail?: ApiTeamReference | null;
  contract_detail?: {
    year_signed?: number | null;
    years?: number | null;
    total_value?: number | null;
    apy?: number | null;
    guaranteed?: number | null;
    is_active?: boolean;
    otc_url?: string | null;
  } | null;
  source_url?: string | null;
  updated_at?: string | null;
}

export interface ApiTeamFreeAgentTrackerResponse {
  season?: number | null;
  team?: ApiTeamReference | null;
  count?: number | null;
  results?: ApiTeamFreeAgentTrackerEntry[] | null;
  incoming_count?: number | null;
  incoming_results?: ApiTeamFreeAgentTrackerEntry[] | null;
  cuts_count?: number | null;
  cuts?: Array<{
    id?: number | null;
    player_id?: number | null;
    player_name?: string | null;
    player_position?: string | null;
    transaction_type?: string | null;
    date?: string | null;
    description?: string | null;
    season?: number | null;
    from_team_detail?: ApiTeamReference | null;
    to_team_detail?: ApiTeamReference | null;
  }> | null;
  signed_elsewhere_count?: number | null;
  signed_elsewhere?: Array<{
    id?: number | null;
    player_id?: number | null;
    player_name?: string | null;
    player_position?: string | null;
    transaction_type?: string | null;
    date?: string | null;
    description?: string | null;
    season?: number | null;
    from_team_detail?: ApiTeamReference | null;
    to_team_detail?: ApiTeamReference | null;
  }> | null;
  contract_changes_count?: number | null;
  contract_changes?: Array<{
    id?: number | null;
    player_id?: number | null;
    player_name?: string | null;
    player_position?: string | null;
    team_detail?: ApiTeamReference | null;
    year_signed?: number | null;
    years?: number | null;
    total_value?: number | null;
    apy?: number | null;
    guaranteed?: number | null;
    is_active?: boolean;
    otc_url?: string | null;
  }> | null;
  draft_source_url?: string | null;
  draft_picks?: Array<{
    round?: number | null;
    overall_pick?: number | null;
    current_team_abbr?: string | null;
    original_team_abbr?: string | null;
    compensatory?: boolean;
  }> | null;
  team_needs?: Array<{
    key?: string | null;
    label?: string | null;
    score?: number | null;
    detail?: string | null;
  }> | null;
  draft_targets_source_url?: string | null;
  draft_targets?: Array<{
    player_id?: number | null;
    name?: string | null;
    position?: string | null;
    school?: string | null;
    college_logo_url?: string | null;
    image_url?: string | null;
    range?: string | null;
    team_mock_count?: number | null;
    total_mock_count?: number | null;
    consensus_type?: string | null;
    overall_rank?: number | null;
    true_adp?: number | null;
    need_key?: string | null;
    need_label?: string | null;
    fit_reason?: string | null;
    source_url?: string | null;
    source_label?: string | null;
    class_year?: string | null;
    hometown?: string | null;
    role?: string | null;
    jersey_number?: string | null;
    draft_year?: number | null;
    draft_projection?: string | null;
    buzz_overall_rating?: number | null;
    buzz_overall_rank?: number | null;
    buzz_position_rank?: number | null;
    buzz_position_rank_group?: string | null;
    all_scouts_overall_rank?: number | null;
    all_scouts_position_rank?: number | null;
    height?: string | null;
    weight?: number | null;
    forty_yard?: number | null;
    hand_size?: string | null;
    arm_length?: string | null;
    age?: number | null;
    birth_date?: string | null;
    source_last_updated?: string | null;
    college_games?: number | null;
    college_snaps?: number | null;
    bio?: string | null;
    summary?: string | null;
    strengths?: string[] | null;
    weaknesses?: string[] | null;
    honors?: string[] | null;
    production_stats?: Array<{
      label?: string | null;
      value?: string | null;
      percentile?: number | null;
    }> | null;
    scouting_grades?: Array<{
      label?: string | null;
      value?: string | null;
      percent?: number | null;
    }> | null;
    measurable_percentiles?: Array<{
      label?: string | null;
      value?: string | null;
      percentile?: number | null;
    }> | null;
    recruiting_ratings?: Array<{
      label?: string | null;
      value?: string | null;
    }> | null;
    comparison_players?: Array<{
      name?: string | null;
      school?: string | null;
      similarity?: number | null;
      source_url?: string | null;
    }> | null;
    fit_teams?: Array<{
      team_detail?: ApiTeamReference | null;
      need_key?: string | null;
      need_label?: string | null;
      need_rank?: number | null;
      pick_label?: string | null;
      round?: number | null;
      overall_pick?: number | null;
    }> | null;
  }> | null;
}

// =============================================================================
// DOMAIN TYPES (used by frontend components)
// =============================================================================

export interface GridstreamTeamListItem {
  id: number | null;
  abbreviation: string;
  slug: string;
  location: string;
  name: string;
  displayName: string;
  shortDisplayName: string;
  colorPrimary: string;
  colorSecondary: string;
  conference: string;
  division: string;
  isActive: boolean;
  logoUrl: string | null;
  logoScoreboardUrl: string | null;
}

export interface GridstreamTeamStanding {
  season: number;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  colorPrimary: string;
  colorSecondary: string;
  logoUrl: string | null;
  conference: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  divRank: number | null;
  seed: number | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  pointDiff: number | null;
  sov: number | null;
  sos: number | null;
  streak: string;
  last5: string;
  playoffClincher: string;
}

export interface GridstreamTeamProfile {
  id: number | null;
  abbreviation: string;
  slug: string;
  location: string;
  name: string;
  displayName: string;
  shortDisplayName: string;
  nickname: string;
  colorPrimary: string;
  colorSecondary: string;
  conference: string;
  division: string;
  isActive: boolean;
  playerCount: number | null;
  logoUrl: string | null;
  logoScoreboardUrl: string | null;
  logos: ApiTeamLogo[];
  socialAccounts: ApiTeamSocialAccount[];
}

export interface GridstreamTeamSeasonStats {
  season: number;
  games: number;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  pct: number | null;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  ppg: number;
  papg: number;
  totalYdsPg: number;
  passYdsPg: number;
  rushYdsPg: number;
  sacksPg: number;
  turnovers: number;
  turnoversPg: number;
  takeaways: number;
  takeawaysPg: number;
  thirdDownPct: number;
  redzonePct: number;
  offEpaPg: number | null;
  defEpaPg: number | null;
  seed: number | null;
  divRank: number | null;
  sos: number | null;
}

export interface GridstreamTeamGameLogEntry {
  gameId: string | number;
  week: number;
  seasonYear: number;
  seasonType: string;
  gameDate: string | null;
  isHome: boolean;
  isDivisionGame: boolean;
  opponentAbbr: string;
  opponentDisplay: string;
  opponentColor: string;
  opponentLogo: string | null;
  gameStatus: string;
  teamScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'T' | null;
  totalYards: number;
  passYards: number;
  rushYards: number;
  passYardsAllowed: number | null;
  rushYardsAllowed: number | null;
  sacksMade: number;
  turnovers: number;
  takeaways: number;
  thirdDownConv: number;
  thirdDownAtt: number;
  redzoneScores: number;
  redzoneAtt: number;
  offEpa: number | null;
  defEpa: number | null;
  passEpa: number | null;
  rushEpa: number | null;
  timeOfPossession: string;
}

export interface GridstreamTeamRankEntry {
  label: string;
  value: number | null;
  leagueRank: number | null;
  leagueTotal: number;
  confRank: number | null;
  confTotal: number;
  confName: string;
  divRank: number | null;
  divTotal: number;
  divName: string;
  higherIsBetter: boolean;
}

export type GridstreamTeamRankings = Record<string, GridstreamTeamRankEntry>;

export interface GridstreamTeamDvoaSnapshot {
  season: number;
  seasonType: 'REG' | 'POST';
  week: number;
  teamAbbreviation: string;
  teamDisplayName: string;
  teamShortDisplayName: string;
  teamColorPrimary: string;
  teamColorSecondary: string;
  teamLogoUrl: string | null;
  recordSnapshot: string;
  totalDvoa: number | null;
  offenseDvoa: number | null;
  defenseDvoa: number | null;
  specialTeamsDvoa: number | null;
  weightedTotalDvoa: number | null;
  totalDvoaRank: number | null;
  offenseDvoaRank: number | null;
  defenseDvoaRank: number | null;
  specialTeamsDvoaRank: number | null;
  weightedTotalDvoaRank: number | null;
  lastWeekRank: number | null;
  lastWeekWeightedRank: number | null;
  nonAdjustedTotalVoi: number | null;
  offenseVoaUnadjusted: number | null;
  defenseVoaUnadjusted: number | null;
  specialTeamsVoaUnadjusted: number | null;
  estimatedWins: number | null;
  pastScheduleDvoa: number | null;
  futureScheduleDvoa: number | null;
  variance: number | null;
  weightedOffenseDvoa: number | null;
  weightedDefenseDvoa: number | null;
  weightedSpecialTeamsDvoa: number | null;
  metricsRaw: Record<string, unknown>;
  updatedAt: string | null;
}

export interface GridstreamTeamDvoaListResponse {
  season: number;
  seasonType: 'REG' | 'POST';
  count: number;
  results: GridstreamTeamDvoaSnapshot[];
}

export interface GridstreamTeamDvoaDetailResponse {
  team: {
    abbreviation: string;
    displayName: string;
    shortDisplayName: string;
    colorPrimary: string;
    colorSecondary: string;
    logoUrl: string | null;
  };
  latest: {
    REG: GridstreamTeamDvoaSnapshot | null;
    POST: GridstreamTeamDvoaSnapshot | null;
  };
  history: {
    REG: GridstreamTeamDvoaSnapshot[];
    POST: GridstreamTeamDvoaSnapshot[];
  };
}

export interface GridstreamTeamRbsdmMetric {
  season: number;
  week: number;
  dataset: string;
  teamAbbreviation: string;
  teamDisplayName: string;
  tableContext: string;
  metrics: Record<string, unknown>;
  capturedAt: string | null;
  updatedAt: string | null;
}

export interface GridstreamTeamRbsdmResponse {
  season: number | null;
  team: {
    abbreviation: string;
    displayName: string;
    shortDisplayName: string;
    colorPrimary: string;
    colorSecondary: string;
    logoUrl: string | null;
  } | null;
  count: number;
  datasets: Record<string, GridstreamTeamRbsdmMetric[]>;
  latest: Record<string, GridstreamTeamRbsdmMetric | null>;
}

export interface GridstreamTeamReference {
  id: number | null;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  colorPrimary: string;
  colorSecondary: string;
  logoUrl: string | null;
}

export interface GridstreamTeamFreeAgentTrackerEntry {
  id: number | null;
  season: number | null;
  playerId: number | null;
  playerGsisId: string | null;
  playerName: string;
  ourladsPlayerId: string;
  position: string;
  faType: string;
  trackerStatus: string;
  trackerStatusDisplay: string;
  team: GridstreamTeamReference | null;
  signedWithTeam: GridstreamTeamReference | null;
  contractDetail: {
    yearSigned: number | null;
    years: number | null;
    totalValue: number | null;
    apy: number | null;
    guaranteed: number | null;
    isActive: boolean;
    otcUrl: string | null;
  } | null;
  sourceUrl: string | null;
  updatedAt: string | null;
}

export interface GridstreamTeamFreeAgencyTransaction {
  id: number | null;
  playerId: number | null;
  playerName: string;
  playerPosition: string;
  transactionType: string;
  date: string | null;
  description: string;
  season: number | null;
  fromTeam: GridstreamTeamReference | null;
  toTeam: GridstreamTeamReference | null;
}

export interface GridstreamTeamDraftPick {
  round: number | null;
  overallPick: number | null;
  currentTeamAbbr: string;
  originalTeamAbbr: string;
  compensatory: boolean;
}

export interface GridstreamTeamDraftNeed {
  key: string;
  label: string;
  score: number | null;
  detail: string;
}

export interface GridstreamTeamDraftTarget {
  playerId: number | null;
  name: string;
  position: string;
  school: string;
  collegeLogoUrl: string | null;
  imageUrl: string | null;
  range: string | null;
  teamMockCount: number | null;
  totalMockCount: number | null;
  consensusType: string;
  overallRank: number | null;
  trueAdp: number | null;
  needKey: string;
  needLabel: string;
  fitReason: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  classYear: string | null;
  hometown: string | null;
  role: string | null;
  jerseyNumber: string | null;
  draftYear: number | null;
  draftProjection: string | null;
  buzzOverallRating: number | null;
  buzzOverallRank: number | null;
  buzzPositionRank: number | null;
  buzzPositionRankGroup: string | null;
  allScoutsOverallRank: number | null;
  allScoutsPositionRank: number | null;
  height: string | null;
  weight: number | null;
  fortyYard: number | null;
  handSize: string | null;
  armLength: string | null;
  age: number | null;
  birthDate: string | null;
  sourceLastUpdated: string | null;
  collegeGames: number | null;
  collegeSnaps: number | null;
  bio: string | null;
  summary: string | null;
  strengths: string[];
  weaknesses: string[];
  honors: string[];
  productionStats: Array<{
    label: string;
    value: string | null;
    percentile: number | null;
  }>;
  scoutingGrades: Array<{
    label: string;
    value: string | null;
    percent: number | null;
  }>;
  measurablePercentiles: Array<{
    label: string;
    value: string | null;
    percentile: number | null;
  }>;
  recruitingRatings: Array<{
    label: string;
    value: string | null;
  }>;
  comparisonPlayers: Array<{
    name: string;
    school: string | null;
    similarity: number | null;
    sourceUrl: string | null;
  }>;
  fitTeams: Array<{
    team: GridstreamTeamReference | null;
    needKey: string;
    needLabel: string;
    needRank: number | null;
    pickLabel: string | null;
    round: number | null;
    overallPick: number | null;
  }>;
}

export interface GridstreamTeamContractChange {
  id: number | null;
  playerId: number | null;
  playerName: string;
  playerPosition: string;
  team: GridstreamTeamReference | null;
  yearSigned: number | null;
  years: number | null;
  totalValue: number | null;
  apy: number | null;
  guaranteed: number | null;
  isActive: boolean;
  otcUrl: string | null;
}

export interface GridstreamTeamFreeAgentTrackerResponse {
  season: number | null;
  team: GridstreamTeamReference | null;
  count: number;
  results: GridstreamTeamFreeAgentTrackerEntry[];
  incomingCount: number;
  incomingResults: GridstreamTeamFreeAgentTrackerEntry[];
  cutsCount: number;
  cuts: GridstreamTeamFreeAgencyTransaction[];
  signedElsewhereCount: number;
  signedElsewhere: GridstreamTeamFreeAgencyTransaction[];
  contractChangesCount: number;
  contractChanges: GridstreamTeamContractChange[];
  draftSourceUrl: string | null;
  draftPicks: GridstreamTeamDraftPick[];
  teamNeeds: GridstreamTeamDraftNeed[];
  draftTargetsSourceUrl: string | null;
  draftTargets: GridstreamTeamDraftTarget[];
}

// =============================================================================
// ROSTER TYPES (mapped from existing PlayerListSerializer)
// =============================================================================

export interface GridstreamRosterPlayer {
  id: number | string;
  displayName: string;
  shortName: string;
  firstName: string;
  lastName: string;
  jerseyNumber: string | null;
  position: string;
  positionGroup: string;
  depthChartPosition: string | null;
  depthChartRank: number | null;
  depthChartStatus: string | null;
  age: number | null;
  heightFt: string | null;
  weightLbs: number | null;
  yearsExperience: number | null;
  rosterStatus: string;
  rosterStatusDisplay: string;
  freeAgencyStatus: string | null;
  freeAgencyStatusDisplay: string | null;
  draftYear: number | null;
  draftRound: number | null;
  rookieSeason: number | null;
  headshotUrl: string | null;
}

// =============================================================================
// MAPPERS (API → Domain)
// =============================================================================

export function mapApiTeamListItem(raw: ApiTeamListItem): GridstreamTeamListItem {
  return {
    id: raw.id ?? null,
    abbreviation: normalizeString(raw.abbreviation),
    slug: normalizeString(raw.slug),
    location: normalizeString(raw.location),
    name: normalizeString(raw.name),
    displayName: normalizeString(raw.display_name),
    shortDisplayName: normalizeString(raw.short_display_name),
    colorPrimary: normalizeString(raw.color_primary) || '1a3a5c',
    colorSecondary: normalizeString(raw.color_secondary) || '8b9dc3',
    conference: normalizeString(raw.conference),
    division: normalizeString(raw.division),
    isActive: raw.is_active !== false,
    logoUrl: resolveTeamLogo(raw.logos ?? null, false),
    logoScoreboardUrl: resolveTeamLogo(raw.logos ?? null, true),
  };
}

export function mapApiTeamDetail(raw: ApiTeamDetail): GridstreamTeamProfile {
  return {
    id: raw.id ?? null,
    abbreviation: normalizeString(raw.abbreviation),
    slug: normalizeString(raw.slug),
    location: normalizeString(raw.location),
    name: normalizeString(raw.name),
    displayName: normalizeString(raw.display_name),
    shortDisplayName: normalizeString(raw.short_display_name),
    nickname: normalizeString(raw.nickname),
    colorPrimary: normalizeString(raw.color_primary) || '1a3a5c',
    colorSecondary: normalizeString(raw.color_secondary) || '8b9dc3',
    conference: normalizeString(raw.conference),
    division: normalizeString(raw.division),
    isActive: raw.is_active !== false,
    playerCount: raw.player_count ?? null,
    logoUrl: resolveTeamLogo(raw.logos ?? null, false),
    logoScoreboardUrl: resolveTeamLogo(raw.logos ?? null, true),
    logos: raw.logos ?? [],
    socialAccounts: raw.social_accounts ?? [],
  };
}

export function mapApiTeamStanding(raw: ApiTeamStanding): GridstreamTeamStanding {
  const t = raw.team;
  return {
    season: raw.season ?? 0,
    abbreviation: normalizeString(t?.abbreviation),
    displayName: normalizeString(t?.display_name),
    shortDisplayName: normalizeString(t?.short_display_name),
    colorPrimary: normalizeString(t?.color_primary) || '1a3a5c',
    colorSecondary: normalizeString(t?.color_secondary) || '8b9dc3',
    logoUrl: t?.logo_url ? normalizeString(t.logo_url) : null,
    conference: normalizeString(raw.conference),
    division: normalizeString(raw.division),
    wins: raw.wins ?? 0,
    losses: raw.losses ?? 0,
    ties: raw.ties ?? 0,
    pct: raw.win_pct ?? raw.pct ?? 0,
    divRank: raw.div_rank ?? null,
    seed: raw.seed ?? null,
    pointsFor: raw.points_for ?? null,
    pointsAgainst: raw.points_against ?? null,
    pointDiff: raw.point_diff ?? null,
    sov: raw.sov ?? null,
    sos: raw.sos ?? null,
    streak: normalizeString(raw.streak),
    last5: normalizeString(raw.last_5),
    playoffClincher: normalizeString(raw.playoff_clincher),
  };
}

function mapApiTeamReference(
  raw: ApiTeamReference | null | undefined
): GridstreamTeamReference | null {
  if (!raw) return null;
  return {
    id: raw.id ?? null,
    abbreviation: normalizeString(raw.abbreviation),
    displayName: normalizeString(raw.display_name),
    shortDisplayName: normalizeString(raw.short_display_name),
    colorPrimary: normalizeString(raw.color_primary) || '1a3a5c',
    colorSecondary: normalizeString(raw.color_secondary) || '8b9dc3',
    logoUrl: raw.logo_url ? normalizeString(raw.logo_url) : null,
  };
}

export function mapApiTeamSeasonStats(raw: ApiTeamSeasonStats): GridstreamTeamSeasonStats {
  return {
    season: raw.season ?? 0,
    games: raw.games ?? 0,
    wins: raw.wins ?? null,
    losses: raw.losses ?? null,
    ties: raw.ties ?? null,
    pct: raw.pct ?? null,
    pointsFor: raw.points_for ?? 0,
    pointsAgainst: raw.points_against ?? 0,
    pointDiff: raw.point_diff ?? 0,
    ppg: raw.ppg ?? 0,
    papg: raw.papg ?? 0,
    totalYdsPg: raw.total_yds_pg ?? 0,
    passYdsPg: raw.pass_yds_pg ?? 0,
    rushYdsPg: raw.rush_yds_pg ?? 0,
    sacksPg: raw.sacks_pg ?? 0,
    turnovers: raw.turnovers ?? 0,
    turnoversPg: raw.turnovers_pg ?? 0,
    takeaways: raw.takeaways ?? 0,
    takeawaysPg: raw.takeaways_pg ?? 0,
    thirdDownPct: raw.third_down_pct ?? 0,
    redzonePct: raw.redzone_pct ?? 0,
    offEpaPg: raw.off_epa_pg ?? null,
    defEpaPg: raw.def_epa_pg ?? null,
    seed: raw.seed ?? null,
    divRank: raw.div_rank ?? null,
    sos: raw.sos ?? null,
  };
}

export function mapApiTeamGameLogEntry(raw: ApiTeamGameLogEntry): GridstreamTeamGameLogEntry {
  return {
    gameId: raw.game_id ?? '',
    week: raw.week ?? 0,
    seasonYear: raw.season_year ?? 0,
    seasonType: normalizeString(raw.season_type) || 'REG',
    gameDate: raw.game_date ?? null,
    isHome: raw.is_home !== false,
    isDivisionGame: raw.is_division_game ?? false,
    opponentAbbr: normalizeString(raw.opponent_abbr),
    opponentDisplay: normalizeString(raw.opponent_display),
    opponentColor: normalizeString(raw.opponent_color) || '1a3a5c',
    opponentLogo: raw.opponent_logo ?? null,
    gameStatus: normalizeString(raw.game_status),
    teamScore: raw.team_score ?? 0,
    oppScore: raw.opp_score ?? 0,
    result: raw.result ?? null,
    totalYards: raw.total_yards ?? 0,
    passYards: raw.pass_yards ?? 0,
    rushYards: raw.rush_yards ?? 0,
    passYardsAllowed: raw.pass_yards_allowed ?? null,
    rushYardsAllowed: raw.rush_yards_allowed ?? null,
    sacksMade: raw.sacks_made ?? 0,
    turnovers: raw.turnovers ?? 0,
    takeaways: raw.takeaways ?? 0,
    thirdDownConv: raw.third_down_conv ?? 0,
    thirdDownAtt: raw.third_down_att ?? 0,
    redzoneScores: raw.redzone_scores ?? 0,
    redzoneAtt: raw.redzone_att ?? 0,
    offEpa: raw.off_epa ?? null,
    defEpa: raw.def_epa ?? null,
    passEpa: raw.pass_epa ?? null,
    rushEpa: raw.rush_epa ?? null,
    timeOfPossession: normalizeString(raw.time_of_possession),
  };
}

export function mapApiTeamRankings(raw: ApiTeamRankings): GridstreamTeamRankings {
  const result: GridstreamTeamRankings = {};
  for (const [key, entry] of Object.entries(raw)) {
    result[key] = {
      label: normalizeString(entry?.label),
      value: entry?.value ?? null,
      leagueRank: entry?.league_rank ?? null,
      leagueTotal: entry?.league_total ?? 32,
      confRank: entry?.conf_rank ?? null,
      confTotal: entry?.conf_total ?? 16,
      confName: normalizeString(entry?.conf_name),
      divRank: entry?.div_rank ?? null,
      divTotal: entry?.div_total ?? 4,
      divName: normalizeString(entry?.div_name),
      higherIsBetter: entry?.higher_is_better !== false,
    };
  }
  return result;
}

export function mapApiTeamDvoaSnapshot(raw: ApiTeamDvoaSnapshot): GridstreamTeamDvoaSnapshot {
  const team = raw.team ?? null;
  return {
    season: raw.season ?? 0,
    seasonType: (normalizeString(raw.season_type) as 'REG' | 'POST') || 'REG',
    week: raw.week ?? 0,
    teamAbbreviation: normalizeString(team?.abbreviation),
    teamDisplayName: normalizeString(team?.display_name),
    teamShortDisplayName: normalizeString(team?.short_display_name),
    teamColorPrimary: normalizeString(team?.color_primary) || '1a3a5c',
    teamColorSecondary: normalizeString(team?.color_secondary) || '8b9dc3',
    teamLogoUrl: team?.logo_url ? normalizeString(team.logo_url) : null,
    recordSnapshot: normalizeString(raw.record_snapshot),
    totalDvoa: raw.total_dvoa ?? null,
    offenseDvoa: raw.offense_dvoa ?? null,
    defenseDvoa: raw.defense_dvoa ?? null,
    specialTeamsDvoa: raw.special_teams_dvoa ?? null,
    weightedTotalDvoa: raw.weighted_total_dvoa ?? null,
    totalDvoaRank: raw.total_dvoa_rank ?? null,
    offenseDvoaRank: raw.offense_dvoa_rank ?? null,
    defenseDvoaRank: raw.defense_dvoa_rank ?? null,
    specialTeamsDvoaRank: raw.special_teams_dvoa_rank ?? null,
    weightedTotalDvoaRank: raw.weighted_total_dvoa_rank ?? null,
    lastWeekRank: raw.last_week_rank ?? null,
    lastWeekWeightedRank: raw.last_week_weighted_rank ?? null,
    nonAdjustedTotalVoi: raw.non_adjusted_total_voi ?? null,
    offenseVoaUnadjusted: raw.offense_voa_unadjusted ?? null,
    defenseVoaUnadjusted: raw.defense_voa_unadjusted ?? null,
    specialTeamsVoaUnadjusted: raw.special_teams_voa_unadjusted ?? null,
    estimatedWins: raw.estimated_wins ?? null,
    pastScheduleDvoa: raw.past_schedule_dvoa ?? null,
    futureScheduleDvoa: raw.future_schedule_dvoa ?? null,
    variance: raw.variance ?? null,
    weightedOffenseDvoa: raw.weighted_offense_dvoa ?? null,
    weightedDefenseDvoa: raw.weighted_defense_dvoa ?? null,
    weightedSpecialTeamsDvoa: raw.weighted_special_teams_dvoa ?? null,
    metricsRaw: (raw.metrics_raw as Record<string, unknown> | null) ?? {},
    updatedAt: raw.updated_at ? normalizeString(raw.updated_at) : null,
  };
}

export function mapApiTeamDvoaListResponse(
  raw: ApiTeamDvoaListResponse
): GridstreamTeamDvoaListResponse {
  const rows = Array.isArray(raw.results) ? raw.results : [];
  return {
    season: raw.season ?? 0,
    seasonType: (normalizeString(raw.season_type) as 'REG' | 'POST') || 'REG',
    count: raw.count ?? rows.length,
    results: rows.map(mapApiTeamDvoaSnapshot),
  };
}

export function mapApiTeamDvoaDetailResponse(
  raw: ApiTeamDvoaDetailResponse
): GridstreamTeamDvoaDetailResponse {
  const team = raw.team ?? null;
  const historyReg = Array.isArray(raw.history?.REG) ? raw.history?.REG : [];
  const historyPost = Array.isArray(raw.history?.POST) ? raw.history?.POST : [];
  const latestReg = raw.latest?.REG ? mapApiTeamDvoaSnapshot(raw.latest.REG) : null;
  const latestPost = raw.latest?.POST ? mapApiTeamDvoaSnapshot(raw.latest.POST) : null;
  return {
    team: {
      abbreviation: normalizeString(team?.abbreviation),
      displayName: normalizeString(team?.display_name),
      shortDisplayName: normalizeString(team?.short_display_name),
      colorPrimary: normalizeString(team?.color_primary) || '1a3a5c',
      colorSecondary: normalizeString(team?.color_secondary) || '8b9dc3',
      logoUrl: team?.logo_url ? normalizeString(team.logo_url) : null,
    },
    latest: {
      REG: latestReg,
      POST: latestPost,
    },
    history: {
      REG: historyReg.map(mapApiTeamDvoaSnapshot),
      POST: historyPost.map(mapApiTeamDvoaSnapshot),
    },
  };
}

function mapApiTeamRbsdmMetric(raw: ApiTeamRbsdmMetric): GridstreamTeamRbsdmMetric {
  const team = raw.team ?? null;
  return {
    season: raw.season ?? 0,
    week: raw.week ?? 0,
    dataset: normalizeString(raw.dataset),
    teamAbbreviation: normalizeString(team?.abbreviation),
    teamDisplayName: normalizeString(team?.display_name),
    tableContext: normalizeString(raw.table_context),
    metrics: (raw.metrics as Record<string, unknown> | null) ?? {},
    capturedAt: raw.captured_at ? normalizeString(raw.captured_at) : null,
    updatedAt: raw.updated_at ? normalizeString(raw.updated_at) : null,
  };
}

export function mapApiTeamRbsdmResponse(raw: ApiTeamRbsdmResponse): GridstreamTeamRbsdmResponse {
  const datasets: Record<string, GridstreamTeamRbsdmMetric[]> = {};
  const latest: Record<string, GridstreamTeamRbsdmMetric | null> = {};

  const sourceDatasets = raw.datasets ?? {};
  for (const [dataset, rows] of Object.entries(sourceDatasets)) {
    const mappedRows = (rows ?? []).map(mapApiTeamRbsdmMetric);
    datasets[dataset] = mappedRows;
  }
  const sourceLatest = raw.latest ?? {};
  for (const [dataset, row] of Object.entries(sourceLatest)) {
    latest[dataset] = row ? mapApiTeamRbsdmMetric(row) : null;
  }

  const team = raw.team ?? null;
  return {
    season: raw.season ?? null,
    team: team
      ? {
          abbreviation: normalizeString(team.abbreviation),
          displayName: normalizeString(team.display_name),
          shortDisplayName: normalizeString(team.short_display_name),
          colorPrimary: normalizeString(team.color_primary) || '1a3a5c',
          colorSecondary: normalizeString(team.color_secondary) || '8b9dc3',
          logoUrl: team.logo_url ? normalizeString(team.logo_url) : null,
        }
      : null,
    count: raw.count ?? 0,
    datasets,
    latest,
  };
}

export function mapApiTeamFreeAgentTrackerEntry(
  raw: ApiTeamFreeAgentTrackerEntry
): GridstreamTeamFreeAgentTrackerEntry {
  return {
    id: raw.id ?? null,
    season: raw.season ?? null,
    playerId: raw.player_id ?? null,
    playerGsisId: raw.player_gsis_id ? normalizeString(raw.player_gsis_id) : null,
    playerName: normalizeString(raw.player_name),
    ourladsPlayerId: normalizeString(raw.ourlads_player_id),
    position: normalizeString(raw.position),
    faType: normalizeString(raw.fa_type),
    trackerStatus: normalizeString(raw.tracker_status),
    trackerStatusDisplay: normalizeString(raw.tracker_status_display),
    team: mapApiTeamReference(raw.team_detail),
    signedWithTeam: mapApiTeamReference(raw.signed_with_team_detail),
    contractDetail: raw.contract_detail
      ? {
          yearSigned: raw.contract_detail.year_signed ?? null,
          years: raw.contract_detail.years ?? null,
          totalValue: raw.contract_detail.total_value ?? null,
          apy: raw.contract_detail.apy ?? null,
          guaranteed: raw.contract_detail.guaranteed ?? null,
          isActive: raw.contract_detail.is_active !== false,
          otcUrl: raw.contract_detail.otc_url ? normalizeString(raw.contract_detail.otc_url) : null,
        }
      : null,
    sourceUrl: raw.source_url ? normalizeString(raw.source_url) : null,
    updatedAt: raw.updated_at ? normalizeString(raw.updated_at) : null,
  };
}

function mapApiTeamFreeAgencyTransaction(
  raw: NonNullable<ApiTeamFreeAgentTrackerResponse['cuts']>[number]
): GridstreamTeamFreeAgencyTransaction {
  return {
    id: raw.id ?? null,
    playerId: raw.player_id ?? null,
    playerName: normalizeString(raw.player_name),
    playerPosition: normalizeString(raw.player_position),
    transactionType: normalizeString(raw.transaction_type),
    date: raw.date ? normalizeString(raw.date) : null,
    description: normalizeString(raw.description),
    season: raw.season ?? null,
    fromTeam: mapApiTeamReference(raw.from_team_detail),
    toTeam: mapApiTeamReference(raw.to_team_detail),
  };
}

function mapApiTeamContractChange(
  raw: NonNullable<ApiTeamFreeAgentTrackerResponse['contract_changes']>[number]
): GridstreamTeamContractChange {
  return {
    id: raw.id ?? null,
    playerId: raw.player_id ?? null,
    playerName: normalizeString(raw.player_name),
    playerPosition: normalizeString(raw.player_position),
    team: mapApiTeamReference(raw.team_detail),
    yearSigned: raw.year_signed ?? null,
    years: raw.years ?? null,
    totalValue: raw.total_value ?? null,
    apy: raw.apy ?? null,
    guaranteed: raw.guaranteed ?? null,
    isActive: raw.is_active !== false,
    otcUrl: raw.otc_url ? normalizeString(raw.otc_url) : null,
  };
}

function mapApiTeamDraftPick(
  raw: NonNullable<ApiTeamFreeAgentTrackerResponse['draft_picks']>[number]
): GridstreamTeamDraftPick {
  return {
    round: raw.round ?? null,
    overallPick: raw.overall_pick ?? null,
    currentTeamAbbr: normalizeString(raw.current_team_abbr),
    originalTeamAbbr: normalizeString(raw.original_team_abbr),
    compensatory: raw.compensatory === true,
  };
}

function mapApiTeamDraftNeed(
  raw: NonNullable<ApiTeamFreeAgentTrackerResponse['team_needs']>[number]
): GridstreamTeamDraftNeed {
  return {
    key: normalizeString(raw.key),
    label: normalizeString(raw.label),
    score: raw.score ?? null,
    detail: normalizeString(raw.detail),
  };
}

function mapApiTeamDraftTarget(
  raw: NonNullable<ApiTeamFreeAgentTrackerResponse['draft_targets']>[number]
): GridstreamTeamDraftTarget {
  const productionStats = Array.isArray(raw.production_stats) ? raw.production_stats : [];
  const scoutingGrades = Array.isArray(raw.scouting_grades) ? raw.scouting_grades : [];
  const measurablePercentiles = Array.isArray(raw.measurable_percentiles)
    ? raw.measurable_percentiles
    : [];
  const recruitingRatings = Array.isArray(raw.recruiting_ratings) ? raw.recruiting_ratings : [];
  const comparisonPlayers = Array.isArray(raw.comparison_players) ? raw.comparison_players : [];
  const fitTeams = Array.isArray(raw.fit_teams) ? raw.fit_teams : [];
  return {
    playerId: raw.player_id ?? null,
    name: normalizeString(raw.name),
    position: normalizeString(raw.position),
    school: normalizeString(raw.school),
    collegeLogoUrl: raw.college_logo_url ? normalizeString(raw.college_logo_url) : null,
    imageUrl: raw.image_url ? normalizeString(raw.image_url) : null,
    range: raw.range ? normalizeString(raw.range) : null,
    teamMockCount: raw.team_mock_count ?? null,
    totalMockCount: raw.total_mock_count ?? null,
    consensusType: normalizeString(raw.consensus_type),
    overallRank: raw.overall_rank ?? null,
    trueAdp: raw.true_adp ?? null,
    needKey: normalizeString(raw.need_key),
    needLabel: normalizeString(raw.need_label),
    fitReason: normalizeString(raw.fit_reason),
    sourceUrl: normalizeString(raw.source_url),
    sourceLabel: normalizeString(raw.source_label),
    classYear: normalizeString(raw.class_year),
    hometown: normalizeString(raw.hometown),
    role: normalizeString(raw.role),
    jerseyNumber: normalizeString(raw.jersey_number),
    draftYear: raw.draft_year ?? null,
    draftProjection: normalizeString(raw.draft_projection),
    buzzOverallRating: raw.buzz_overall_rating ?? null,
    buzzOverallRank: raw.buzz_overall_rank ?? null,
    buzzPositionRank: raw.buzz_position_rank ?? null,
    buzzPositionRankGroup: normalizeString(raw.buzz_position_rank_group),
    allScoutsOverallRank: raw.all_scouts_overall_rank ?? null,
    allScoutsPositionRank: raw.all_scouts_position_rank ?? null,
    height: normalizeString(raw.height),
    weight: raw.weight ?? null,
    fortyYard: raw.forty_yard ?? null,
    handSize: normalizeString(raw.hand_size),
    armLength: normalizeString(raw.arm_length),
    age: raw.age ?? null,
    birthDate: normalizeString(raw.birth_date),
    sourceLastUpdated: normalizeString(raw.source_last_updated),
    collegeGames: raw.college_games ?? null,
    collegeSnaps: raw.college_snaps ?? null,
    bio: normalizeString(raw.bio),
    summary: normalizeString(raw.summary),
    strengths: Array.isArray(raw.strengths)
      ? raw.strengths.map(normalizeString).filter(Boolean)
      : [],
    weaknesses: Array.isArray(raw.weaknesses)
      ? raw.weaknesses.map(normalizeString).filter(Boolean)
      : [],
    honors: Array.isArray(raw.honors) ? raw.honors.map(normalizeString).filter(Boolean) : [],
    productionStats: productionStats
      .map((entry) => ({
        label: normalizeString(entry.label),
        value: normalizeString(entry.value),
        percentile: entry.percentile ?? null,
      }))
      .filter((entry) => entry.label),
    scoutingGrades: scoutingGrades
      .map((entry) => ({
        label: normalizeString(entry.label),
        value: normalizeString(entry.value),
        percent: entry.percent ?? null,
      }))
      .filter((entry) => entry.label),
    measurablePercentiles: measurablePercentiles
      .map((entry) => ({
        label: normalizeString(entry.label),
        value: normalizeString(entry.value),
        percentile: entry.percentile ?? null,
      }))
      .filter((entry) => entry.label),
    recruitingRatings: recruitingRatings
      .map((entry) => ({
        label: normalizeString(entry.label),
        value: normalizeString(entry.value),
      }))
      .filter((entry) => entry.label),
    comparisonPlayers: comparisonPlayers
      .map((entry) => ({
        name: normalizeString(entry.name),
        school: normalizeString(entry.school),
        similarity: entry.similarity ?? null,
        sourceUrl: normalizeString(entry.source_url),
      }))
      .filter((entry) => entry.name),
    fitTeams: fitTeams.map((entry) => ({
      team: entry.team_detail ? mapApiTeamReference(entry.team_detail) : null,
      needKey: normalizeString(entry.need_key),
      needLabel: normalizeString(entry.need_label),
      needRank: entry.need_rank ?? null,
      pickLabel: normalizeString(entry.pick_label),
      round: entry.round ?? null,
      overallPick: entry.overall_pick ?? null,
    })),
  };
}

export function mapApiTeamFreeAgentTrackerResponse(
  raw: ApiTeamFreeAgentTrackerResponse
): GridstreamTeamFreeAgentTrackerResponse {
  const rows = Array.isArray(raw.results) ? raw.results : [];
  const incoming = Array.isArray(raw.incoming_results) ? raw.incoming_results : [];
  const cuts = Array.isArray(raw.cuts) ? raw.cuts : [];
  const signedElsewhere = Array.isArray(raw.signed_elsewhere) ? raw.signed_elsewhere : [];
  const contractChanges = Array.isArray(raw.contract_changes) ? raw.contract_changes : [];
  const draftPicks = Array.isArray(raw.draft_picks) ? raw.draft_picks : [];
  const teamNeeds = Array.isArray(raw.team_needs) ? raw.team_needs : [];
  const draftTargets = Array.isArray(raw.draft_targets) ? raw.draft_targets : [];
  return {
    season: raw.season ?? null,
    team: mapApiTeamReference(raw.team),
    count: raw.count ?? rows.length,
    results: rows.map(mapApiTeamFreeAgentTrackerEntry),
    incomingCount: raw.incoming_count ?? incoming.length,
    incomingResults: incoming.map(mapApiTeamFreeAgentTrackerEntry),
    cutsCount: raw.cuts_count ?? cuts.length,
    cuts: cuts.map(mapApiTeamFreeAgencyTransaction),
    signedElsewhereCount: raw.signed_elsewhere_count ?? signedElsewhere.length,
    signedElsewhere: signedElsewhere.map(mapApiTeamFreeAgencyTransaction),
    contractChangesCount: raw.contract_changes_count ?? contractChanges.length,
    contractChanges: contractChanges.map(mapApiTeamContractChange),
    draftSourceUrl: raw.draft_source_url ? normalizeString(raw.draft_source_url) : null,
    draftPicks: draftPicks.map(mapApiTeamDraftPick),
    teamNeeds: teamNeeds.map(mapApiTeamDraftNeed),
    draftTargetsSourceUrl: raw.draft_targets_source_url
      ? normalizeString(raw.draft_targets_source_url)
      : null,
    draftTargets: draftTargets.map(mapApiTeamDraftTarget),
  };
}

// =============================================================================
// FETCH FUNCTIONS
// =============================================================================

export async function fetchGridstreamTeamsList(
  apiBase: string,
  signal?: AbortSignal
): Promise<GridstreamTeamListItem[]> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/`;
  const payload = await fetchTeamsJson<ApiTeamListItem[]>(url, signal);
  return (Array.isArray(payload) ? payload : []).map(mapApiTeamListItem);
}

export async function fetchGridstreamTeamProfile(
  apiBase: string,
  abbreviation: string,
  signal?: AbortSignal
): Promise<GridstreamTeamProfile> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/${encodeURIComponent(abbreviation.toUpperCase())}/`;
  const payload = await fetchTeamsJson<ApiTeamDetail>(url, signal);
  return mapApiTeamDetail(payload);
}

export async function fetchGridstreamTeamStandings(
  apiBase: string,
  season: number,
  signal?: AbortSignal
): Promise<GridstreamTeamStanding[]> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/standings/${buildQueryString({ season })}`;
  const payload = await fetchTeamsJson<ApiTeamStanding[]>(url, signal);
  return (Array.isArray(payload) ? payload : []).map(mapApiTeamStanding);
}

export async function fetchGridstreamTeamSeasonStats(
  apiBase: string,
  abbreviation: string,
  signal?: AbortSignal
): Promise<GridstreamTeamSeasonStats[]> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/${encodeURIComponent(abbreviation.toUpperCase())}/season-stats/`;
  const payload = await fetchTeamsJson<ApiTeamSeasonStats[]>(url, signal);
  return (Array.isArray(payload) ? payload : []).map(mapApiTeamSeasonStats);
}

export async function fetchGridstreamTeamGameLog(
  apiBase: string,
  abbreviation: string,
  season?: number | null,
  signal?: AbortSignal
): Promise<GridstreamTeamGameLogEntry[]> {
  const base = resolveGridstreamApiBase(apiBase);
  const qs = buildQueryString({ season: season ?? null });
  const url = `${base}/teams/${encodeURIComponent(abbreviation.toUpperCase())}/game-log/${qs}`;
  const payload = await fetchTeamsJson<ApiTeamGameLogEntry[]>(url, signal);
  return (Array.isArray(payload) ? payload : []).map(mapApiTeamGameLogEntry);
}

export async function fetchGridstreamTeamRoster(
  apiBase: string,
  abbreviation: string,
  opts?: { position?: string; rosterStatus?: string },
  signal?: AbortSignal
): Promise<GridstreamRosterPlayer[]> {
  const base = resolveGridstreamApiBase(apiBase);
  const qs = buildQueryString({
    position: opts?.position ?? null,
    roster_status: opts?.rosterStatus ?? null,
  });
  const url = `${base}/teams/${encodeURIComponent(abbreviation.toUpperCase())}/roster/${qs}`;
  // Roster uses PlayerListSerializer shape — map the key fields we need
  const payload = await fetchTeamsJson<Array<Record<string, unknown>>>(url, signal);
  return (Array.isArray(payload) ? payload : []).map(mapApiRosterPlayer);
}

function mapApiRosterPlayer(raw: Record<string, unknown>): GridstreamRosterPlayer {
  return {
    id: (raw.id as number | string) ?? '',
    displayName: normalizeString(raw.display_name as string),
    shortName: normalizeString(raw.short_name as string),
    firstName: normalizeString(raw.first_name as string),
    lastName: normalizeString(raw.last_name as string),
    jerseyNumber: raw.jersey_number != null ? normalizeString(raw.jersey_number as string) : null,
    position: normalizeString(raw.position as string),
    positionGroup: normalizeString(raw.position_group as string),
    depthChartPosition:
      raw.depth_chart_position != null ? normalizeString(raw.depth_chart_position as string) : null,
    depthChartRank: raw.depth_chart_rank != null ? Number(raw.depth_chart_rank) : null,
    depthChartStatus:
      raw.depth_chart_status != null ? normalizeString(raw.depth_chart_status as string) : null,
    age: raw.age != null ? Number(raw.age) : null,
    heightFt: raw.height != null ? normalizeString(raw.height as string) : null,
    weightLbs: raw.weight != null ? Number(raw.weight) : null,
    yearsExperience: raw.years_experience != null ? Number(raw.years_experience) : null,
    rosterStatus: normalizeString(raw.roster_status as string),
    rosterStatusDisplay: normalizeString(
      (raw.roster_status_display as string) ?? (raw.roster_status as string)
    ),
    freeAgencyStatus:
      raw.free_agency_status != null ? normalizeString(raw.free_agency_status as string) : null,
    freeAgencyStatusDisplay:
      raw.free_agency_status_display != null
        ? normalizeString(raw.free_agency_status_display as string)
        : null,
    draftYear: raw.draft_year != null ? Number(raw.draft_year) : null,
    draftRound: raw.draft_round != null ? Number(raw.draft_round) : null,
    rookieSeason: raw.rookie_season != null ? Number(raw.rookie_season) : null,
    headshotUrl: raw.headshot_url != null ? normalizeString(raw.headshot_url as string) : null,
  };
}

export async function fetchGridstreamTeamFreeAgentTracker(
  apiBase: string,
  abbreviation: string,
  opts?: { season?: number | null },
  signal?: AbortSignal
): Promise<GridstreamTeamFreeAgentTrackerResponse> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/${encodeURIComponent(abbreviation.toUpperCase())}/free-agent-tracker/${buildQueryString(
    { season: opts?.season ?? null }
  )}`;
  const payload = await fetchTeamsJson<ApiTeamFreeAgentTrackerResponse>(url, signal);
  return mapApiTeamFreeAgentTrackerResponse(payload);
}

export async function fetchGridstreamTeamRankings(
  apiBase: string,
  abbreviation: string,
  season: number,
  signal?: AbortSignal
): Promise<GridstreamTeamRankings> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/rankings/${buildQueryString({ season, abbr: abbreviation.toUpperCase() })}`;
  const payload = await fetchTeamsJson<ApiTeamRankings>(url, signal);
  return mapApiTeamRankings(payload);
}

export async function fetchGridstreamTeamsDvoa(
  apiBase: string,
  opts?: { season?: number; seasonType?: 'REG' | 'POST' },
  signal?: AbortSignal
): Promise<GridstreamTeamDvoaListResponse> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/dvoa/${buildQueryString({
    season: opts?.season ?? null,
    season_type: opts?.seasonType ?? 'REG',
  })}`;
  const payload = await fetchTeamsJson<ApiTeamDvoaListResponse>(url, signal);
  return mapApiTeamDvoaListResponse(payload);
}

export async function fetchGridstreamTeamDvoa(
  apiBase: string,
  abbreviation: string,
  opts?: { seasonType?: 'REG' | 'POST' },
  signal?: AbortSignal
): Promise<GridstreamTeamDvoaDetailResponse> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/${encodeURIComponent(abbreviation.toUpperCase())}/dvoa/${buildQueryString(
    { season_type: opts?.seasonType ?? null }
  )}`;
  const payload = await fetchTeamsJson<ApiTeamDvoaDetailResponse>(url, signal);
  return mapApiTeamDvoaDetailResponse(payload);
}

export async function fetchGridstreamTeamRbsdm(
  apiBase: string,
  abbreviation: string,
  opts?: { season?: number | null },
  signal?: AbortSignal
): Promise<GridstreamTeamRbsdmResponse> {
  const base = resolveGridstreamApiBase(apiBase);
  const url = `${base}/teams/${encodeURIComponent(abbreviation.toUpperCase())}/rbsdm/${buildQueryString(
    { season: opts?.season ?? null }
  )}`;
  const payload = await fetchTeamsJson<ApiTeamRbsdmResponse>(url, signal);
  return mapApiTeamRbsdmResponse(payload);
}

// =============================================================================
// DIVISION / CONFERENCE STRUCTURE
// =============================================================================

export const NFL_CONFERENCES = ['AFC', 'NFC'] as const;
export const NFL_DIVISIONS = ['East', 'North', 'South', 'West'] as const;

export type NflConference = (typeof NFL_CONFERENCES)[number];
export type NflDivision = (typeof NFL_DIVISIONS)[number];

/** Groups a flat team list into { AFC: { East: [...], North: [...], ... }, NFC: { ... } } */
export function groupTeamsByDivision(
  teams: GridstreamTeamListItem[]
): Record<string, Record<string, GridstreamTeamListItem[]>> {
  const result: Record<string, Record<string, GridstreamTeamListItem[]>> = {};
  for (const team of teams) {
    const conf = team.conference || 'Other';
    const divParts = team.division.split(' ');
    const div = divParts[divParts.length - 1] || 'Other';
    if (!result[conf]) result[conf] = {};
    if (!result[conf][div]) result[conf][div] = [];
    result[conf][div].push(team);
  }
  // Sort teams within each division by name
  for (const conf of Object.values(result)) {
    for (const div of Object.values(conf)) {
      div.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
  }
  return result;
}

/**
 * Merges teams list with standings data, keyed by team abbreviation.
 * Returns a map of abbreviation → { team, standing | null }.
 */
export function mergeTeamsWithStandings(
  teams: GridstreamTeamListItem[],
  standings: GridstreamTeamStanding[]
): Map<string, { team: GridstreamTeamListItem; standing: GridstreamTeamStanding | null }> {
  const standingMap = new Map(standings.map((s) => [s.abbreviation, s]));
  const result = new Map<
    string,
    { team: GridstreamTeamListItem; standing: GridstreamTeamStanding | null }
  >();
  for (const team of teams) {
    result.set(team.abbreviation, {
      team,
      standing: standingMap.get(team.abbreviation) ?? null,
    });
  }
  return result;
}

/** Format a W-L-T record string. Omits ties if 0. */
export function formatTeamRecord(
  wins: number | null,
  losses: number | null,
  ties: number | null
): string {
  if (wins == null || losses == null) return '—';
  const t = ties ?? 0;
  return t > 0 ? `${wins}-${losses}-${t}` : `${wins}-${losses}`;
}

/**
 * Group roster players by position group for display.
 * Returns groups in display order: QB, RB, WR, TE, OL, DL, LB, DB, ST.
 */
const POSITION_GROUP_ORDER: Record<string, number> = {
  QB: 0,
  RB: 1,
  WR: 2,
  TE: 3,
  OL: 4,
  DL: 5,
  LB: 6,
  DB: 7,
  ST: 8,
  K: 8,
  P: 8,
  LS: 8,
};

export function groupRosterByPositionGroup(
  players: GridstreamRosterPlayer[]
): { group: string; players: GridstreamRosterPlayer[] }[] {
  const groups = new Map<string, GridstreamRosterPlayer[]>();
  for (const player of players) {
    const pg = player.positionGroup || player.position || 'Other';
    if (!groups.has(pg)) groups.set(pg, []);
    groups.get(pg)!.push(player);
  }
  const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
    const oa = POSITION_GROUP_ORDER[a] ?? 99;
    const ob = POSITION_GROUP_ORDER[b] ?? 99;
    return oa !== ob ? oa - ob : a.localeCompare(b);
  });
  return sorted.map(([group, groupPlayers]) => ({
    group,
    players: groupPlayers.sort((a, b) => {
      // Sort by depth rank if available, then jersey number
      if (a.depthChartPosition && b.depthChartPosition) {
        return a.depthChartPosition.localeCompare(b.depthChartPosition);
      }
      const ja = parseInt(a.jerseyNumber ?? '99', 10);
      const jb = parseInt(b.jerseyNumber ?? '99', 10);
      return ja - jb;
    }),
  }));
}

/** Determine the rank tier color for a league rank (of 32). */
export function teamRankTierColor(leagueRank: number | null, leagueTotal: number): string {
  if (leagueRank == null) return '#6f9ab8';
  const topThird = Math.ceil(leagueTotal / 3);
  const bottomThird = leagueTotal - Math.floor(leagueTotal / 3);
  if (leagueRank <= topThird) return '#8fff45'; // top tier — green
  if (leagueRank >= bottomThird) return '#ff627e'; // bottom tier — red
  return '#ffb612'; // mid tier — amber
}
