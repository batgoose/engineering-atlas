/**
 * Django REST API contracts and game-context transformer for Gridstream.
 *
 * @section API types
 * The interfaces below mirror Django serializer output exactly (snake_case).
 * Only fields actually consumed by the client are typed; extras are ignored.
 *
 * @section Transforms
 * `apiGameToContext` maps a game-detail response into the `GameContext` shape
 * expected by `gridStream.hydrate()`.
 *
 * OpenAPI endpoint inventory for these types:
 *   GET /api/gridstream/games/{id}/            → ApiGameDetailExtended
 *   GET /api/gridstream/games/{id}/plays/       → ApiCursorPage<ApiPlayDetail>
 *   GET /api/gridstream/games/{id}/drives/      → ApiDrive[]
 *   GET /api/gridstream/games/{id}/boxscore/    → ApiBoxscore
 */

import type { GameContext, PositionGroup } from './types';

// ─── Per-play accumulator types ─────────────────────────────────────────────
// These live here (not in types.ts) because they're tightly coupled to the
// API shape and are only used by play-transforms and transforms.

/**
 * Cumulative skill-position stats tracked per player during timeline builds.
 * FG distance tiers mirror ESPN standard fantasy scoring buckets.
 */
export interface RunningPlayerTotals {
  passAtt: number;
  passComp: number;
  passYds: number;
  passTd: number;
  passInt: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  rec: number;
  recYds: number;
  recTd: number;
  fgAtt: number;
  fgMade: number;
  fgMade0to39: number;
  fgMade40to49: number;
  fgMade50to59: number;
  fgMade60plus: number;
  fgMissed: number;
  punts: number;
  puntYds: number;
  xpAtt: number;
  xpMade: number;
  fumblesLost: number;
  sacks: number;
}

/** Identity metadata for a player seen during play-by-play processing. */
export interface RunningPlayerMeta {
  name: string;
  teamAbbr: string;
  position?: PositionGroup;
}

/**
 * D/ST fantasy counters derived from play text.
 * `takeaways` is always the sum of `interceptions + fumbleRecoveries`.
 */
export interface DefenseFantasyTotals {
  pointsAllowed: number;
  sacks: number;
  takeaways: number;
  interceptions: number;
  fumbleRecoveries: number;
  blockedKicks: number;
  safeties: number;
  defensiveTds: number;
}

// ─── REST API response shapes ────────────────────────────────────────────────

/**
 * The shape returned by GET /api/gridstream/games/{id}/
 * (GameDetailSerializer). Only the fields we actually use are typed here.
 */
export interface ApiGameDetail {
  id: number;
  espn_event_id: string;
  nflverse_game_id: string;
  season_id: number;
  week: number;
  game_date: string;
  game_time: string | null;
  season_type: string;
  game_note: string;

  home_team_detail: ApiTeamMinimal;
  away_team_detail: ApiTeamMinimal;

  status: string;
  quarter: number | null;
  clock: string;
  home_score: number;
  away_score: number;
  home_score_q1: number;
  home_score_q2: number;
  home_score_q3: number;
  home_score_q4: number;
  home_score_ot: number;
  away_score_q1: number;
  away_score_q2: number;
  away_score_q3: number;
  away_score_q4: number;
  away_score_ot: number;
  possession_team: number | null;

  spread: number | null;
  total: number | null;
  home_moneyline: number | null;
  away_moneyline: number | null;

  broadcast_network: string;
  broadcast_names: string[];

  home_record: string;
  away_record: string;
  home_coach: string;
  away_coach: string;
  home_qb_name: string;
  away_qb_name: string;

  weather_temp: number | null;
  weather_condition: string;
  weather_condition_id: number | null;
  weather_wind: string;
  weather_humidity: number | null;
  weather_detail: string;

  venue_name: string | null;
  venue_detail?: {
    id: number;
    name: string;
    city: string;
    state: string;
    is_indoor: boolean;
    surface: string;
  } | null;
}

export interface ApiTeamMinimal {
  id: number;
  abbreviation: string;
  display_name: string;
  short_display_name: string;
  color_primary: string;
  color_secondary: string;
  logo_url: string | null;
}

/**
 * ApiGameDetail extended with optional fields from the game-detail endpoint
 * when leaders and scoring plays are embedded (ESPN data path).
 */
export interface ApiGameDetailExtended extends ApiGameDetail {
  leaders?: ApiGameLeader[];
  scoring_plays?: ApiScoringPlay[];
}

/** Cursor-paginated list response used for plays and drives endpoints. */
export interface ApiCursorPage<T> {
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * One play from GET /api/gridstream/games/{id}/plays/?detail=true
 * (PlayDetailSerializer). `yard_line` is intended to be yardline_100
 * (yards from opponent's endzone, nflverse convention), but ESPN-sourced games
 * may store it as "yards from own endzone" for some play types (e.g. punts).
 * Do not rely on yard_line alone for kick animations — use landing + kick_distance.
 */
export interface ApiPlayDetail {
  id: number;
  drive_id: number | null;
  sequence: number;
  quarter: number | null;
  clock: string;
  down: number | null;
  distance: number | null;
  /** yards from opponent's endzone (nflverse convention), 0-100. ESPN data may differ for kicks. */
  yard_line: number | null;
  side_of_field: string;
  down_distance_text: string;
  possession_team_abbr: string | null;
  play_type: string;
  description: string;
  short_description: string;
  yards_gained: number | null;
  is_scoring_play: boolean;
  home_score_after: number;
  away_score_after: number;
  touchdown: boolean;
  interception: boolean;
  sack: boolean;
  penalty: boolean;
  penalty_yards: number | null;
  penalty_player_name?: string;
  penalty_player_id?: string;
  penalty_team?: string;
  fumble_lost: boolean;
  complete_pass: boolean;
  first_down: boolean;
  timeout?: boolean;
  timeout_team?: string;
  home_timeouts_remaining?: number | null;
  away_timeouts_remaining?: number | null;
  pass_attempt?: boolean;
  rush_attempt?: boolean;
  kickoff_attempt?: boolean;
  punt_attempt?: boolean;
  extra_point_attempt?: boolean;
  two_point_attempt?: boolean;
  special_teams_play?: boolean;
  st_play_type?: string;
  touchback?: boolean;
  out_of_bounds?: boolean;
  punt_inside_twenty?: boolean;
  punt_fair_catch?: boolean;
  kickoff_fair_catch?: boolean;
  kickoff_in_endzone?: boolean;
  return_yards?: number | null;
  return_team?: string;
  end_down: number | null;
  end_distance: number | null;
  end_yard_line: number | null;
  epa: number | null;
  total_home_epa?: number | null;
  total_away_epa?: number | null;
  home_wp?: number | null;
  away_wp?: number | null;
  air_yards: number | null;
  pass_location: string;
  run_location: string;
  passer_player_name: string;
  rusher_player_name: string;
  receiver_player_name: string;
  punt_returner_player_name?: string;
  kickoff_returner_player_name?: string;
  interception_player_name?: string;
  interception_player_id?: string;
  fumble_recovery_1_player_name?: string;
  fumble_recovery_1_team?: string;
  fumble_recovery_1_yards?: number | null;
  field_goal_result: string;
  kick_distance: number | null;
}

/** One drive from GET /api/gridstream/games/{id}/drives/ */
export interface ApiDrive {
  id: number;
  team_abbr: string;
  start_yardline: number | null;
  total_yards: number;
  time_elapsed: string;
}

/** Team-level aggregates from GET /api/gridstream/games/{id}/boxscore/ */
export interface ApiTeamGameStats {
  team_abbr: string;
  total_yards: number;
  pass_yards: number;
  rush_yards: number;
  first_downs: number;
  third_down_attempts: number;
  third_down_conversions: number;
  turnovers: number;
  penalties: number;
  penalty_yards: number;
  sacks_made: number;
  time_of_possession: string;
}

/** Player-level aggregates from GET /api/gridstream/games/{id}/boxscore/ */
export interface ApiPlayerGameStats {
  player_name: string;
  player_headshot: string | null;
  player_position: string;
  player_gsis_id: string | null;
  team_abbr: string;
  completions: number | null;
  pass_attempts: number | null;
  passing_yards: number | null;
  passing_tds: number | null;
  interceptions_thrown: number | null;
  carries: number | null;
  rushing_yards: number | null;
  rushing_tds: number | null;
  rushing_fumbles_lost: number | null;
  receptions: number | null;
  receiving_yards: number | null;
  receiving_tds: number | null;
  receiving_fumbles_lost: number | null;
  fg_attempts: number | null;
  fg_made: number | null;
  pat_attempts: number | null;
  pat_made: number | null;
  sacks_made: number | null;
  interceptions_caught: number | null;
  fumble_recoveries: number | null;
  fantasy_points_standard: number | null;
  fantasy_points_ppr: number | null;
  fantasy_points_half_ppr: number | null;
}

/** Embedded leader line from game detail or boxscore. */
export interface ApiGameLeader {
  team_abbr: string;
  /** 'passing' | 'rushing' | 'receiving' */
  category: string;
  athlete_name: string;
  athlete_headshot_url?: string | null;
  display_value: string;
}

/** Embedded scoring play from game detail. */
export interface ApiScoringPlay {
  team_abbr: string;
  quarter: number;
  description: string;
  home_score_after: number;
  away_score_after: number;
  sequence: number;
}

/** Full boxscore response from GET /api/gridstream/games/{id}/boxscore/ */
export interface ApiBoxscore {
  team_stats: ApiTeamGameStats[];
  /** Keyed by team abbreviation (uppercase). */
  player_stats: Record<string, ApiPlayerGameStats[]>;
  leaders?: ApiGameLeader[];
  completeness?: {
    team_stats_complete?: boolean;
    player_stats_complete?: boolean;
    leaders_complete?: boolean;
    team_stats_source?: 'db' | 'derived' | 'derived_resilience';
    leaders_source?: 'db' | 'derived' | 'derived_resilience';
  };
}

/**
 * Scoreboard-list item — returned by GET /api/gridstream/games/?season=&week=
 * (GameListSerializer). A subset of the full game detail shape.
 */
export interface ApiGameListItem {
  id: number;
  espn_event_id: string;
  season_id: number;
  week: number;
  game_date: string;
  game_time: string | null;
  season_type: 'REG' | 'POST' | 'PRE';
  home_team: number;
  away_team: number;
  home_team_detail: ApiTeamMinimal;
  away_team_detail: ApiTeamMinimal;
  venue_name: string | null;
  is_division_game: boolean;
  game_note: string | null;
  status: string;
  quarter: number | null;
  clock: string | null;
  home_score: number;
  away_score: number;
  home_score_q1: number;
  home_score_q2: number;
  home_score_q3: number;
  home_score_q4: number;
  home_score_ot: number | null;
  away_score_q1: number;
  away_score_q2: number;
  away_score_q3: number;
  away_score_q4: number;
  away_score_ot: number | null;
  possession_team: number | null;
  spread: number | null;
  total: number | null;
  home_moneyline: number | null;
  away_moneyline: number | null;
  broadcast_network: string | null;
  broadcast_names: string | null;
  home_record: string;
  away_record: string;
  home_qb_name: string | null;
  away_qb_name: string | null;
  weather_temp: number | null;
  weather_condition: string | null;
  weather_wind: string | null;
  leaders: ApiGameLeader[];
}

// ─── Games-list display helpers ──────────────────────────────────────────────

/** Human-readable week label. Weeks 19–22 are postseason rounds. */
export function weekLabel(week: number): string {
  if (week <= 18) return `Week ${week}`;
  const postNames: Record<number, string> = {
    19: 'Wild Card',
    20: 'Divisional',
    21: 'Conf Championships',
    22: 'Super Bowl',
  };
  return postNames[week] ?? `Playoff Wk ${week}`;
}

/** Returns true for weeks that belong to the postseason (weeks ≥ 19). */
export function isPostseasonWeek(week: number): boolean {
  return week >= 19;
}

export interface GameStatusDisplay {
  text: string;
  variant: 'final' | 'live' | 'scheduled';
}

/**
 * Returns a display label and variant for a game's current status.
 * Covers live, final, and scheduled states.
 */
export function gameStatusDisplay(
  status: string,
  quarter: number | null,
  clock: string | null
): GameStatusDisplay {
  if (status === 'final') return { text: 'FINAL', variant: 'final' };
  if (status === 'final_ot') return { text: 'FINAL/OT', variant: 'final' };
  if (status === 'halftime') return { text: 'HALFTIME', variant: 'live' };
  if ((status === 'in_progress' || status === 'end_period') && quarter && clock)
    return { text: `Q${quarter} ${clock}`, variant: 'live' };
  if (status === 'in_progress' || status === 'end_period') return { text: 'LIVE', variant: 'live' };
  if (status === 'postponed') return { text: 'POSTPONED', variant: 'final' };
  if (status === 'cancelled') return { text: 'CANCELLED', variant: 'final' };
  return { text: 'SCHEDULED', variant: 'scheduled' };
}

/**
 * Format a scheduled game's date/time into a readable label.
 * Times are stored in ET; `gameTime` is "HH:MM:SS" or null.
 * Uses UTC date construction for day-of-week to avoid local-timezone drift.
 */
export function formatScheduledTime(gameDate: string, gameTime: string | null): string {
  const parts = gameDate.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dayName = dayNames[d.getUTCDay()] ?? '';
  if (!gameTime) {
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${dayName}, ${monthNames[month - 1] ?? ''} ${day}`;
  }
  const timeParts = gameTime.split(':');
  const hour = parseInt(timeParts[0] ?? '0', 10);
  const minute = parseInt(timeParts[1] ?? '0', 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${dayName} ${h12}:${minute.toString().padStart(2, '0')} ${ampm} ET`;
}

/**
 * Returns which side won a final game, or null if the game isn't final.
 * Returns 'tie' only if scores are exactly equal at final (rare in NFL).
 */
export function gameWinner(
  homeScore: number,
  awayScore: number,
  status: string
): 'home' | 'away' | 'tie' | null {
  if (status !== 'final' && status !== 'final_ot') return null;
  if (homeScore > awayScore) return 'home';
  if (awayScore > homeScore) return 'away';
  return 'tie';
}

/**
 * Return the top leader for each requested category (first occurrence wins).
 * Leaders from both teams are considered together; the API returns them in
 * order of stat value within each category.
 */
export function topLeadersForDisplay(
  leaders: ApiGameLeader[],
  categories: string[] = ['passing', 'rushing']
): ApiGameLeader[] {
  const seen = new Set<string>();
  const result: ApiGameLeader[] = [];
  for (const cat of categories) {
    const leader = leaders.find((l) => l.category === cat && !seen.has(cat));
    if (leader) {
      seen.add(cat);
      result.push(leader);
    }
  }
  return result;
}

/**
 * Resolve whatever API URL the environment gives us into a clean
 * /api/gridstream base. Shared between all Gridstream pages so they
 * all derive from the same env var regardless of how it's configured.
 */
export function resolveGridstreamApiBase(base: string): string {
  const normalized = base.replace(/\/$/, '');
  if (normalized.endsWith('/api/gridstream')) return normalized;
  if (normalized.endsWith('/api/redzone'))
    return normalized.replace(/\/api\/redzone$/, '/api/gridstream');
  if (normalized.endsWith('/api')) return `${normalized}/gridstream`;
  if (normalized.endsWith('/gridstream')) return normalized;
  return `${normalized}/api/gridstream`;
}

// ─── Transforms ─────────────────────────────────────────────────────────────

/**
 * Normalize whatever season_type string the Django API returns into the
 * canonical union. The serializer should already emit uppercase values, but
 * we defend against lowercase and unknown values so callers never have to
 * guard against a bad cast downstream.
 */
function normalizeSeasonType(raw: string | null | undefined): 'REG' | 'POST' | 'PRE' {
  const upper = (raw ?? '').toUpperCase().trim();
  if (upper === 'POST') return 'POST';
  if (upper === 'PRE') return 'PRE';
  return 'REG'; // default: covers 'reg', 'regular', '', and unknown values
}

/**
 * Extract a brief condition label from a nflverse-style weather_detail string.
 *
 * weather_detail format: "Light Snow Temp: 31° F, Humidity: 100%, Wind: 5 mph"
 * Returns everything before "Temp:" as the condition, trimmed of trailing punctuation.
 * Returns undefined if nothing useful is found.
 */
function extractWeatherCondition(detail: string | null | undefined): string | undefined {
  if (!detail) return undefined;
  const tempIdx = detail.search(/\btemp:/i);
  const raw = tempIdx > 0 ? detail.slice(0, tempIdx) : detail;
  const condition = raw.replace(/[,.\s]+$/, '').trim();
  return condition || undefined;
}

/**
 * Transform a Django game detail response into a GameContext
 * suitable for gridStream.hydrate().
 */
export function apiGameToContext(game: ApiGameDetail): GameContext {
  return {
    gameId: game.espn_event_id || String(game.id),
    season: game.season_id,
    week: game.week,
    seasonType: normalizeSeasonType(game.season_type),
    gameNote: game.game_note || '',
    gameDate: game.game_date,
    gameTime: game.game_time ?? undefined,

    homeTeam: {
      abbreviation: game.home_team_detail.abbreviation,
      displayName: game.home_team_detail.display_name,
      espnId: String(game.home_team_detail.id),
      color: game.home_team_detail.color_primary,
      altColor: game.home_team_detail.color_secondary,
      logoUrl: game.home_team_detail.logo_url ?? '',
      record: game.home_record,
      coach: game.home_coach,
      startingQb: game.home_qb_name,
    },
    awayTeam: {
      abbreviation: game.away_team_detail.abbreviation,
      displayName: game.away_team_detail.display_name,
      espnId: String(game.away_team_detail.id),
      color: game.away_team_detail.color_primary,
      altColor: game.away_team_detail.color_secondary,
      logoUrl: game.away_team_detail.logo_url ?? '',
      record: game.away_record,
      coach: game.away_coach,
      startingQb: game.away_qb_name,
    },

    homeScoreByQuarter: {
      q1: game.home_score_q1,
      q2: game.home_score_q2,
      q3: game.home_score_q3,
      q4: game.home_score_q4,
      ot: game.home_score_ot,
      total: game.home_score,
    },
    awayScoreByQuarter: {
      q1: game.away_score_q1,
      q2: game.away_score_q2,
      q3: game.away_score_q3,
      q4: game.away_score_q4,
      ot: game.away_score_ot,
      total: game.away_score,
    },

    venueName: game.venue_detail?.name ?? game.venue_name ?? 'TBD',
    venueCity: game.venue_detail?.city ?? '',
    isIndoor: game.venue_detail?.is_indoor ?? false,
    surface: game.venue_detail?.surface,

    temperature: game.weather_temp ?? undefined,
    weatherDesc:
      game.weather_condition || extractWeatherCondition(game.weather_detail) || undefined,
    weatherWind: game.weather_wind || undefined,
    conditionId: game.weather_condition_id ?? undefined,

    spread: game.spread ?? undefined,
    total: game.total ?? undefined,
    homeMoneyline: game.home_moneyline ?? undefined,
    awayMoneyline: game.away_moneyline ?? undefined,

    network: game.broadcast_network || undefined,
    broadcastNames: game.broadcast_names?.length ? game.broadcast_names : undefined,

    status: game.status,
    quarter: game.quarter ?? 0,
    clock: game.clock || '15:00',
    homeScore: game.home_score,
    awayScore: game.away_score,
  };
}
