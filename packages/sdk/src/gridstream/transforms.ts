/**
 * Gridstream transforms.
 *
 * Pure functions that convert between domain types.
 * No side effects, no DOM, no framework imports.
 * Every function here is independently testable and portable.
 */

import type {
  PlayEvent,
  PlayAnimationData,
  AnimPlayType,
  PassDirection,
  FgResult,
  GameTiming,
  TeamStatLine,
  LeaderSet,
  ScoringEntry,
  FantasyRosterEntry,
  WpTimelinePoint,
  PositionGroup,
} from './types';
import type {
  RunningPlayerTotals,
  RunningPlayerMeta,
  DefenseFantasyTotals,
  ApiScoringPlay,
  ApiTeamGameStats,
  ApiPlayerGameStats,
  ApiGameLeader,
  ApiPlayDetail,
} from './api-transforms';
import {
  PLAY_TYPE_TO_ANIM,
  QUARTER_MINUTES,
  REGULATION_MINUTES,
  OT_GAME_MINUTES,
  POSITION_ORDER,
} from './constants';
import { yardToFieldPct } from './field';
import {
  safeInt,
  safeNumber,
  normalizeAbbr,
  normalizeNameKey,
  abbreviatedNameKey,
  parsePositionGroup,
  inferFallbackPosition,
  totalsFromPlayerRow,
  fantasyPointsByScoringFromTotals,
  fantasyBreakdownFromTotals,
  formatPassingLeaderLineFromTotals,
  formatRushingLeaderLineFromTotals,
  formatReceivingLeaderLineFromTotals,
  playerStatsRowForPlayer,
  compactPlayText,
  normalizeClock,
  FALLBACK_LEADER,
  formatPassingLeaderLine,
  formatRushingLeaderLine,
  formatReceivingLeaderLine,
} from './play-transforms';

// Re-export so existing callers that import from transforms don't break.
export { yardToFieldPct };

// ─── Play Classification ────────────────────────────────────────

/**
 * Map a server PlayEvent into the animation data shape the UI needs.
 *
 * Central translation from "what the API told us happened" to
 * "what the animation system should render." Called by the WebSocket store
 * on every live play event.
 *
 * @param play  - raw PlayEvent from the server Envelope
 * @param awayAbbr - away team abbreviation, used to orient field direction
 * @param homeAbbr - home team abbreviation, needed to assign turnoverBy correctly
 */
export function classifyPlayAnimation(
  play: PlayEvent,
  awayAbbr: string,
  homeAbbr = ''
): PlayAnimationData {
  const rawType = play.playType as keyof typeof PLAY_TYPE_TO_ANIM;
  let type: AnimPlayType = (PLAY_TYPE_TO_ANIM[rawType] as AnimPlayType) ?? 'pass';

  // Override type for turnovers
  if (play.isTurnover) {
    type = 'turnover';
  }

  // Determine direction from pass_location/run_location
  // The server sends these as part of the play description;
  // for live ESPN data we may need to parse from shortDesc.
  let direction: PassDirection = 'middle';
  const desc = play.shortDesc.toLowerCase();
  if (desc.includes('left')) direction = 'left';
  else if (desc.includes('right')) direction = 'right';

  // Calculate from/to positions
  const fromYardline = play.yardLine;
  const fromSide = play.possession;
  const endYL = play.endYardLine ?? play.yardLine;

  // Figure out toSide — if the play crossed midfield.
  // Convention: 0% = away goal line, 100% = home goal line.
  // Away drives in the positive direction; home drives in the negative direction.
  const fromPct = yardToFieldPct(fromYardline, fromSide, awayAbbr);
  const toPct = fromPct + play.yardsGained * (fromSide === awayAbbr ? 1 : -1);
  const toSide =
    toPct > 50
      ? fromSide === awayAbbr
        ? getOpponent(fromSide, awayAbbr, homeAbbr)
        : fromSide
      : fromSide;

  // First down detection
  const isFirstDown = play.endDown === 1 && play.yardsGained >= play.distance;

  // Complete pass detection
  const isComplete = type === 'pass' && play.yardsGained > 0 && !play.isTurnover;

  // FG result parsing
  let fgResult: FgResult | undefined;
  if (type === 'fieldgoal') {
    if (play.isScoringPlay) {
      fgResult = 'made';
    } else {
      const d = play.description.toLowerCase();
      if (d.includes('wide left')) fgResult = 'wide_left';
      else if (d.includes('wide right')) fgResult = 'wide_right';
      else if (d.includes('short')) fgResult = 'short';
      else if (d.includes('block')) fgResult = 'blocked';
      else fgResult = 'wide_right'; // fallback
    }
  }

  return {
    type,
    direction,
    fromYardline,
    fromSide,
    toYardline: endYL,
    toSide,
    yardsGained: play.yardsGained,
    airYards: undefined, // not in live ESPN data, populated from nflverse
    isComplete,
    isFirstDown,
    isTurnover: play.isTurnover,
    turnoverBy: play.isTurnover ? getOpponent(play.possession, awayAbbr, homeAbbr) : undefined,
    receiver: null, // populated separately from stats_update events
    fgResult,
    fgDistance: type === 'fieldgoal' ? play.yardLine + 17 : undefined, // snap + endzone
    description: play.description,
  };
}

function getOpponent(team: string, awayAbbr: string, homeAbbr: string): string {
  return team === awayAbbr ? homeAbbr : awayAbbr;
}

// ─── Game Progress ──────────────────────────────────────────────

/**
 * Compute how far through the game we are, in minutes.
 *
 * Q1 0:00 remaining = 15 min elapsed
 * Q2 8:30 remaining = 21.5 min elapsed
 * OT 5:00 remaining = 65 min elapsed
 */
export function computeGameProgress(quarter: number, clock: string, isOT: boolean): GameTiming {
  const [minStr, secStr] = clock.split(':');
  const clockMin = parseInt(minStr || '0', 10);
  const clockSec = parseInt(secStr || '0', 10);
  const clockDecimal = clockMin + clockSec / 60;

  // Minutes elapsed in this quarter
  const quarterElapsed = QUARTER_MINUTES - clockDecimal;

  // Total elapsed
  const completedQuarters = Math.max(0, quarter - 1);
  const elapsedMin = completedQuarters * QUARTER_MINUTES + quarterElapsed;

  const totalMin = isOT ? OT_GAME_MINUTES : REGULATION_MINUTES;

  return {
    quarter,
    clock,
    isOT,
    elapsedMin: Math.max(0, Math.min(elapsedMin, totalMin)),
    totalMin,
  };
}

// ─── Wind Parsing ───────────────────────────────────────────────

export interface WindVector {
  speed: number;
  /** Positive = rightward drift (pixels) */
  hDrift: number;
  /** Positive = downward drift (pixels) */
  vDrift: number;
}

/**
 * Parse a wind string like "NW 8 mph" or "12 mph SSE"
 * into a drift vector for weather particle animation.
 */
export function parseWindVector(windStr: string): WindVector {
  if (!windStr) return { speed: 0, hDrift: 0, vDrift: 0 };

  const speedMatch = windStr.match(/(\d+)/);
  const speed = speedMatch ? parseInt(speedMatch[1] ?? '0', 10) : 0;

  const upper = windStr.toUpperCase();
  const hasN = upper.includes('N');
  const hasS = upper.includes('S');
  const hasE = upper.includes('E');
  const hasW = upper.includes('W');

  const hDrift = ((hasE ? 1 : 0) + (hasW ? -1 : 0)) * Math.min(speed * 4, 40);
  const vDrift = ((hasS ? 1 : 0) + (hasN ? -1 : 0)) * Math.min(speed * 2, 15);

  return { speed, hDrift, vDrift };
}

// ─── Win Probability Sparkline ──────────────────────────────────

export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * Convert a WP timeline to SVG coordinates, scaled proportionally to game time.
 *
 * Returns points where x is proportional to gameMin and y is proportional
 * to the team's win probability.
 */
export function computeWpSparklinePoints(
  timeline: WpTimelinePoint[],
  gameTiming: GameTiming,
  isAway: boolean,
  width: number,
  height: number,
  padding = 2
): SparklinePoint[] {
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;

  return timeline.map((pt) => {
    const wp = isAway ? pt.wp : 100 - pt.wp;
    return {
      x: padding + (pt.gameMin / gameTiming.totalMin) * usableW,
      y: padding + ((100 - wp) / 100) * usableH,
    };
  });
}

/**
 * Build an SVG path string from sparkline points.
 */
export function sparklineToPath(points: SparklinePoint[]): string {
  if (points.length === 0) return '';
  return 'M ' + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ');
}

/**
 * Build a closed area path (for the fill under the line).
 */
export function sparklineToArea(points: SparklinePoint[], height: number): string {
  if (points.length === 0) return '';
  const linePath = sparklineToPath(points);
  const last = points[points.length - 1]!;
  const first = points[0]!;
  return `${linePath} L ${last.x.toFixed(1)},${height} L ${first.x.toFixed(1)},${height} Z`;
}

// ─── Fantasy Grouping ───────────────────────────────────────────

/**
 * Group a flat fantasy roster into position sections.
 * Returns entries in canonical position order, skipping empty groups.
 */
export function groupFantasyByPosition(
  roster: FantasyRosterEntry[]
): Array<{ position: PositionGroup; label: string; players: FantasyRosterEntry[] }> {
  const grouped = new Map<PositionGroup, FantasyRosterEntry[]>();

  for (const entry of roster) {
    const list = grouped.get(entry.position) ?? [];
    list.push(entry);
    grouped.set(entry.position, list);
  }

  return POSITION_ORDER.filter((pos) => grouped.has(pos)).map((pos) => ({
    position: pos,
    label: pos, // The UI layer maps this to the full label via POSITION_LABELS
    players: grouped.get(pos)!,
  }));
}

// ─── Quarter Tick Positions ─────────────────────────────────────

/**
 * Get the fractional positions of quarter boundaries for sparkline ticks.
 */
export function getQuarterTicks(isOT: boolean): number[] {
  if (isOT) {
    // Each regulation quarter is 15/70 of total, OT fills the rest
    return [15 / 70, 30 / 70, 45 / 70, 60 / 70];
  }
  return [0.25, 0.5, 0.75];
}

// ─── Team Stats ─────────────────────────────────────────────────

/**
 * Map boxscore team stats rows into a typed away/home stat-line pair.
 * Returns null when the data is absent or doesn't include both teams.
 */
export function mapTeamStats(
  teamStats: ApiTeamGameStats[] | undefined,
  awayAbbr: string,
  homeAbbr: string
): { away: TeamStatLine; home: TeamStatLine } | null {
  if (!teamStats || teamStats.length === 0) return null;

  const byTeam = new Map<string, ApiTeamGameStats>();
  for (const row of teamStats) {
    byTeam.set(normalizeAbbr(row.team_abbr), row);
  }

  const awayRow = byTeam.get(awayAbbr);
  const homeRow = byTeam.get(homeAbbr);
  if (!awayRow || !homeRow) return null;

  const toLine = (row: ApiTeamGameStats): TeamStatLine => ({
    totalYards: safeInt(row.total_yards),
    passingYards: safeInt(row.pass_yards),
    rushingYards: safeInt(row.rush_yards),
    firstDowns: safeInt(row.first_downs),
    thirdDown: `${safeInt(row.third_down_conversions)}/${safeInt(row.third_down_attempts)}`,
    turnovers: safeInt(row.turnovers),
    top: row.time_of_possession || '0:00',
    penalties: `${safeInt(row.penalties)}-${safeInt(row.penalty_yards)}`,
    sacks: safeInt(row.sacks_made),
  });

  return { away: toLine(awayRow), home: toLine(homeRow) };
}

// ─── Leaders ────────────────────────────────────────────────────

/**
 * Map ESPN boxscore leader rows into a typed away/home LeaderSet.
 * Returns null when there is no leader data.
 */
export function mapLeaders(
  leaders: ApiGameLeader[] | undefined,
  awayAbbr: string,
  homeAbbr: string,
  headshotsByName?: Map<string, string>
): { away: LeaderSet; home: LeaderSet } | null {
  if (!leaders || leaders.length === 0) return null;

  const makeSet = (): LeaderSet => ({
    passing: { ...FALLBACK_LEADER },
    rushing: { ...FALLBACK_LEADER },
    receiving: { ...FALLBACK_LEADER },
  });

  const mapped: { away: LeaderSet; home: LeaderSet } = {
    away: makeSet(),
    home: makeSet(),
  };

  for (const leader of leaders) {
    const team = normalizeAbbr(leader.team_abbr);
    const side = team === awayAbbr ? 'away' : team === homeAbbr ? 'home' : null;
    const category = leader.category as keyof LeaderSet;
    if (!side || (category !== 'passing' && category !== 'rushing' && category !== 'receiving'))
      continue;
    mapped[side][category] = {
      name: leader.athlete_name || '—',
      headshotUrl:
        leader.athlete_headshot_url?.trim() ||
        lookupHeadshotByName(leader.athlete_name, headshotsByName) ||
        undefined,
      line: leader.display_value || '—',
    };
  }

  return mapped;
}

/**
 * Derive leaders from boxscore player-stat rows (fallback when ESPN leader
 * endpoint is unavailable). Picks the best candidate in each category by score.
 */
export function mapLeadersFromPlayerStats(
  playerStatsByTeam: Record<string, ApiPlayerGameStats[]> | undefined,
  awayAbbr: string,
  homeAbbr: string,
  headshotsByName?: Map<string, string>
): { away: LeaderSet; home: LeaderSet } | null {
  const normalized = new Map<string, ApiPlayerGameStats[]>();
  for (const [teamAbbr, rows] of Object.entries(playerStatsByTeam ?? {})) {
    normalized.set(normalizeAbbr(teamAbbr), rows ?? []);
  }

  const awayRows = normalized.get(awayAbbr) ?? [];
  const homeRows = normalized.get(homeAbbr) ?? [];
  if (awayRows.length === 0 && homeRows.length === 0) return null;

  const pickBest = (
    rows: ApiPlayerGameStats[],
    isCandidate: (row: ApiPlayerGameStats) => boolean,
    score: (row: ApiPlayerGameStats) => number
  ): ApiPlayerGameStats | null => {
    let best: ApiPlayerGameStats | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      if (!isCandidate(row)) continue;
      const rowScore = score(row);
      if (rowScore > bestScore) {
        best = row;
        bestScore = rowScore;
      }
    }
    return best;
  };

  const toSet = (rows: ApiPlayerGameStats[]): LeaderSet => {
    const passing = pickBest(
      rows,
      (row) =>
        safeInt(row.pass_attempts) > 0 ||
        safeInt(row.passing_yards) !== 0 ||
        safeInt(row.passing_tds) > 0,
      (row) =>
        safeInt(row.passing_yards) * 10000 +
        safeInt(row.passing_tds) * 100 +
        safeInt(row.pass_attempts)
    );
    const rushing = pickBest(
      rows,
      (row) =>
        safeInt(row.carries) > 0 ||
        safeInt(row.rushing_yards) !== 0 ||
        safeInt(row.rushing_tds) > 0,
      (row) =>
        safeInt(row.rushing_yards) * 10000 + safeInt(row.rushing_tds) * 100 + safeInt(row.carries)
    );
    const receiving = pickBest(
      rows,
      (row) =>
        safeInt(row.receptions) > 0 ||
        safeInt(row.receiving_yards) !== 0 ||
        safeInt(row.receiving_tds) > 0,
      (row) =>
        safeInt(row.receiving_yards) * 10000 +
        safeInt(row.receiving_tds) * 100 +
        safeInt(row.receptions)
    );
    return {
      passing: passing
        ? {
            name: passing.player_name || '—',
            headshotUrl:
              passing.player_headshot?.trim() ||
              lookupHeadshotByName(passing.player_name, headshotsByName) ||
              undefined,
            line: formatPassingLeaderLine(passing),
          }
        : { ...FALLBACK_LEADER },
      rushing: rushing
        ? {
            name: rushing.player_name || '—',
            headshotUrl:
              rushing.player_headshot?.trim() ||
              lookupHeadshotByName(rushing.player_name, headshotsByName) ||
              undefined,
            line: formatRushingLeaderLine(rushing),
          }
        : { ...FALLBACK_LEADER },
      receiving: receiving
        ? {
            name: receiving.player_name || '—',
            headshotUrl:
              receiving.player_headshot?.trim() ||
              lookupHeadshotByName(receiving.player_name, headshotsByName) ||
              undefined,
            line: formatReceivingLeaderLine(receiving),
          }
        : { ...FALLBACK_LEADER },
    };
  };

  return { away: toSet(awayRows), home: toSet(homeRows) };
}

/**
 * Derive leaders from play-derived running totals (used during replay timeline
 * where boxscore data is frozen at the game-end snapshot).
 */
export function mapLeadersFromRunningTotals(
  totalsByKey: Map<string, RunningPlayerTotals>,
  metaByFullKey: Map<string, RunningPlayerMeta>,
  awayAbbr: string,
  homeAbbr: string,
  headshotsByName?: Map<string, string>
): { away: LeaderSet; home: LeaderSet } | null {
  const initSet = (): LeaderSet => ({
    passing: { ...FALLBACK_LEADER },
    rushing: { ...FALLBACK_LEADER },
    receiving: { ...FALLBACK_LEADER },
  });
  const out: { away: LeaderSet; home: LeaderSet } = { away: initSet(), home: initSet() };
  let hasData = false;

  const scores = {
    away: {
      passing: Number.NEGATIVE_INFINITY,
      rushing: Number.NEGATIVE_INFINITY,
      receiving: Number.NEGATIVE_INFINITY,
    },
    home: {
      passing: Number.NEGATIVE_INFINITY,
      rushing: Number.NEGATIVE_INFINITY,
      receiving: Number.NEGATIVE_INFINITY,
    },
  };

  for (const [fullKey, meta] of metaByFullKey.entries()) {
    const totals = totalsByKey.get(fullKey);
    if (!totals) continue;
    const side: 'away' | 'home' | null =
      meta.teamAbbr === awayAbbr ? 'away' : meta.teamAbbr === homeAbbr ? 'home' : null;
    if (!side) continue;

    if (totals.passAtt > 0) {
      const score = totals.passYds * 10000 + totals.passTd * 100 + totals.passComp;
      if (score > scores[side].passing) {
        scores[side].passing = score;
        out[side].passing = {
          name: meta.name,
          headshotUrl: lookupHeadshotByName(meta.name, headshotsByName) || undefined,
          line: formatPassingLeaderLineFromTotals(totals),
        };
        hasData = true;
      }
    }
    if (totals.rushAtt > 0) {
      const score = totals.rushYds * 10000 + totals.rushTd * 100 + totals.rushAtt;
      if (score > scores[side].rushing) {
        scores[side].rushing = score;
        out[side].rushing = {
          name: meta.name,
          headshotUrl: lookupHeadshotByName(meta.name, headshotsByName) || undefined,
          line: formatRushingLeaderLineFromTotals(totals),
        };
        hasData = true;
      }
    }
    if (totals.rec > 0) {
      const score = totals.recYds * 10000 + totals.recTd * 100 + totals.rec;
      if (score > scores[side].receiving) {
        scores[side].receiving = score;
        out[side].receiving = {
          name: meta.name,
          headshotUrl: lookupHeadshotByName(meta.name, headshotsByName) || undefined,
          line: formatReceivingLeaderLineFromTotals(totals),
        };
        hasData = true;
      }
    }
  }

  return hasData ? out : null;
}

/** True if any slot in the leader set has a real value (not the fallback sentinel). */
export function hasLeaderData(leaders: { away: LeaderSet; home: LeaderSet } | null): boolean {
  if (!leaders) return false;
  const entries = [
    leaders.away.passing,
    leaders.away.rushing,
    leaders.away.receiving,
    leaders.home.passing,
    leaders.home.rushing,
    leaders.home.receiving,
  ];
  return entries.some((e) => e.name !== '—' || e.line !== '—');
}

function lookupHeadshotByName(
  playerName: string | null | undefined,
  headshotsByName?: Map<string, string>
): string | null {
  if (!playerName || !headshotsByName || headshotsByName.size === 0) return null;
  const fullKey = normalizeNameKey(playerName);
  const shortKey = abbreviatedNameKey(playerName);
  return headshotsByName.get(fullKey) ?? headshotsByName.get(shortKey) ?? null;
}

// ─── Scoring Timeline ────────────────────────────────────────────

/**
 * Convert raw scoring play rows into a sorted timeline of ScoringEntry items.
 * Each entry is paired with its sequence number for replay-time filtering.
 */
export function scoringTimeline(
  scoringPlays: ApiScoringPlay[] | undefined
): Array<{ sequence: number; entry: ScoringEntry }> {
  if (!scoringPlays || scoringPlays.length === 0) return [];
  return [...scoringPlays]
    .sort((a, b) => a.sequence - b.sequence)
    .map((play) => ({
      sequence: play.sequence,
      entry: {
        q: safeInt(play.quarter, 0),
        team: normalizeAbbr(play.team_abbr),
        desc: play.description,
        awayScore: safeInt(play.away_score_after),
        homeScore: safeInt(play.home_score_after),
      },
    }));
}

/**
 * Filter a scoring timeline to only entries whose cumulative score matches
 * the current score totals (used to show the correct scoring log at each frame).
 */
export function scoringUpToState(
  timeline: Array<{ sequence: number; entry: ScoringEntry }>,
  awayScore: number,
  homeScore: number
): ScoringEntry[] {
  return timeline
    .filter(
      (item) =>
        item.entry.awayScore <= awayScore &&
        item.entry.homeScore <= homeScore &&
        item.entry.awayScore + item.entry.homeScore <= awayScore + homeScore
    )
    .map((item) => item.entry);
}

// ─── Fantasy ─────────────────────────────────────────────────────

/**
 * Map boxscore player-stat rows to fantasy roster entries, grouped by team.
 * Points are derived from the player's stat totals; pre-computed ESPN fantasy
 * points are used as the PPR value when available.
 */
export function mapFantasy(
  playerStatsByTeam: Record<string, ApiPlayerGameStats[]> | undefined,
  awayAbbr: string,
  homeAbbr: string
): { away: FantasyRosterEntry[]; home: FantasyRosterEntry[] } {
  const normalized = new Map<string, ApiPlayerGameStats[]>();
  for (const [teamAbbr, players] of Object.entries(playerStatsByTeam ?? {})) {
    normalized.set(normalizeAbbr(teamAbbr), players);
  }

  const toRoster = (rows: ApiPlayerGameStats[]): FantasyRosterEntry[] => {
    const roster: FantasyRosterEntry[] = [];
    for (const row of rows) {
      const position = parsePositionGroup(row.player_position);
      if (!position) continue;
      const totals = totalsFromPlayerRow(row);
      const derivedPoints = fantasyPointsByScoringFromTotals(totals);
      const pointsPpr = safeNumber(row.fantasy_points_ppr, derivedPoints.ppr);
      const pointsHalfPpr = safeNumber(row.fantasy_points_half_ppr, derivedPoints.halfPpr);
      const pointsStandard = safeNumber(row.fantasy_points_standard, derivedPoints.standard);
      const headshotUrl = row.player_headshot?.trim() || undefined;
      roster.push({
        name: row.player_name,
        gsisId: row.player_gsis_id ?? undefined,
        position,
        headshotUrl,
        points: pointsPpr,
        pointsPpr,
        pointsHalfPpr,
        pointsStandard,
        breakdown: fantasyBreakdownFromTotals(totals),
      });
    }
    roster.sort((a, b) => b.points - a.points);
    return roster;
  };

  return {
    away: toRoster(normalized.get(awayAbbr) ?? []),
    home: toRoster(normalized.get(homeAbbr) ?? []),
  };
}

/** True if either team has at least one fantasy roster entry. */
export function hasFantasyData(
  fantasy: { away: FantasyRosterEntry[]; home: FantasyRosterEntry[] } | null | undefined
): boolean {
  return Boolean(fantasy && (fantasy.away.length > 0 || fantasy.home.length > 0));
}

// ─── Defense Fantasy ─────────────────────────────────────────────

/** Return a zeroed-out DefenseFantasyTotals accumulator. */
export function createDefenseFantasyTotals(): DefenseFantasyTotals {
  return {
    pointsAllowed: 0,
    sacks: 0,
    takeaways: 0,
    interceptions: 0,
    fumbleRecoveries: 0,
    blockedKicks: 0,
    safeties: 0,
    defensiveTds: 0,
  };
}

/**
 * Map points-allowed into the ESPN D/ST fantasy scoring band.
 *
 * Band  pts | PA allowed
 * -----+----+-----------
 *   +5 |  0 | shutout
 *   +4 | ≤6 |
 *   +3 | ≤13|
 *   +1 | ≤17|
 *    0 | ≤27|
 *   -1 | ≤34|
 *   -3 | ≤45|
 *   -5 | 46+|
 */
export function defensePointsAllowedBand(pointsAllowed: number): number {
  if (pointsAllowed <= 0) return 5;
  if (pointsAllowed <= 6) return 4;
  if (pointsAllowed <= 13) return 3;
  if (pointsAllowed <= 17) return 1;
  if (pointsAllowed <= 27) return 0;
  if (pointsAllowed <= 34) return -1;
  if (pointsAllowed <= 45) return -3;
  return -5;
}

/** Compute total D/ST fantasy points from accumulated defense totals. */
export function defenseFantasyPoints(totals: DefenseFantasyTotals): number {
  return (
    defensePointsAllowedBand(totals.pointsAllowed) +
    totals.sacks +
    totals.takeaways * 2 +
    totals.blockedKicks * 2 +
    totals.safeties * 2 +
    totals.defensiveTds * 6
  );
}

/**
 * Append a D/ST fantasy entry to a roster if none exists.
 * Mutates `roster` in-place (call only during roster construction, not in render).
 */
export function ensureDefenseFantasyEntry(
  roster: FantasyRosterEntry[],
  teamAbbr: string,
  totals: DefenseFantasyTotals
): void {
  if (roster.some((e) => e.position === 'DEF')) return;
  const points = defenseFantasyPoints(totals);
  const parts: string[] = [];
  if (totals.interceptions > 0) parts.push(`${totals.interceptions} INT`);
  if (totals.fumbleRecoveries > 0) parts.push(`${totals.fumbleRecoveries} FR`);
  if (totals.sacks > 0) parts.push(`${totals.sacks} sacks`);
  if (totals.defensiveTds > 0) parts.push(`${totals.defensiveTds} TD`);
  if (totals.blockedKicks > 0) parts.push(`${totals.blockedKicks} BLK`);
  if (totals.safeties > 0) parts.push(`${totals.safeties} SFTY`);
  if (parts.length === 0) parts.push(`${totals.pointsAllowed} PA`);
  roster.push({
    name: `${teamAbbr} Defense`,
    position: 'DEF',
    points,
    pointsPpr: points,
    pointsHalfPpr: points,
    pointsStandard: points,
    breakdown: parts.join(' · '),
  });
}

/**
 * Map running totals + player metadata into fantasy roster entries.
 *
 * Preferred over `mapFantasy` during replay playback because running totals
 * reflect exactly how many stats each player had at the replayed play.
 * Optionally appends a D/ST entry when defense totals are provided or can be
 * estimated from team stats + score.
 */
export function mapFantasyFromRunningTotals(
  totalsByKey: Map<string, RunningPlayerTotals>,
  metaByFullKey: Map<string, RunningPlayerMeta>,
  awayAbbr: string,
  homeAbbr: string,
  playerStatsLookup?: Map<string, ApiPlayerGameStats>,
  teamStats?: { away: TeamStatLine; home: TeamStatLine } | null,
  scoreTotals?: { away: number; home: number },
  defenseTotalsByTeam?: Record<string, DefenseFantasyTotals>
): { away: FantasyRosterEntry[]; home: FantasyRosterEntry[] } {
  const away: FantasyRosterEntry[] = [];
  const home: FantasyRosterEntry[] = [];

  for (const [fullKey, meta] of metaByFullKey.entries()) {
    const totals = totalsByKey.get(fullKey);
    if (!totals) continue;
    const isPunterOnly = totals.punts > 0 && totals.fgAtt === 0 && totals.xpAtt === 0;
    if (isPunterOnly) continue;
    const statsRow = playerStatsLookup
      ? playerStatsRowForPlayer(meta.name, playerStatsLookup)
      : null;
    const position =
      meta.position ??
      parsePositionGroup(statsRow?.player_position) ??
      inferFallbackPosition(totals);
    if (!position) continue;
    const pointsByScoring = fantasyPointsByScoringFromTotals(totals);
    const entry: FantasyRosterEntry = {
      name: meta.name,
      position,
      headshotUrl: statsRow?.player_headshot?.trim() || undefined,
      points: Number.parseFloat(pointsByScoring.ppr.toFixed(1)),
      pointsPpr: Number.parseFloat(pointsByScoring.ppr.toFixed(1)),
      pointsHalfPpr: Number.parseFloat(pointsByScoring.halfPpr.toFixed(1)),
      pointsStandard: Number.parseFloat(pointsByScoring.standard.toFixed(1)),
      breakdown: fantasyBreakdownFromTotals(totals),
    };
    if (meta.teamAbbr === awayAbbr) away.push(entry);
    else if (meta.teamAbbr === homeAbbr) home.push(entry);
  }

  away.sort((a, b) => b.points - a.points);
  home.sort((a, b) => b.points - a.points);

  const awayDef = defenseTotalsByTeam?.[awayAbbr];
  const homeDef = defenseTotalsByTeam?.[homeAbbr];

  if (awayDef && homeDef) {
    ensureDefenseFantasyEntry(away, awayAbbr, awayDef);
    ensureDefenseFantasyEntry(home, homeAbbr, homeDef);
    away.sort((a, b) => b.points - a.points);
    home.sort((a, b) => b.points - a.points);
  } else if (teamStats && scoreTotals) {
    ensureDefenseFantasyEntry(away, awayAbbr, {
      pointsAllowed: Math.max(0, safeInt(scoreTotals.home)),
      sacks: Math.max(0, safeInt(teamStats.away.sacks)),
      takeaways: Math.max(0, safeInt(teamStats.home.turnovers)),
      interceptions: 0,
      fumbleRecoveries: 0,
      blockedKicks: 0,
      safeties: 0,
      defensiveTds: 0,
    });
    ensureDefenseFantasyEntry(home, homeAbbr, {
      pointsAllowed: Math.max(0, safeInt(scoreTotals.away)),
      sacks: Math.max(0, safeInt(teamStats.home.sacks)),
      takeaways: Math.max(0, safeInt(teamStats.away.turnovers)),
      interceptions: 0,
      fumbleRecoveries: 0,
      blockedKicks: 0,
      safeties: 0,
      defensiveTds: 0,
    });
    away.sort((a, b) => b.points - a.points);
    home.sort((a, b) => b.points - a.points);
  }

  return { away, home };
}

/**
 * Accumulate D/ST totals from a play-by-play log.
 *
 * Counts sacks, interceptions, fumble recoveries, blocked kicks, safeties,
 * and non-offensive TDs. Points-allowed tracks the opponent's score, minus any
 * turnover-return TDs (which ESPN excludes from the PA bucket).
 */
export function deriveDefenseFantasyTotalsFromPlays(
  plays: ApiPlayDetail[],
  awayAbbr: string,
  homeAbbr: string,
  scoreTotals?: { away: number; home: number }
): Record<string, DefenseFantasyTotals> {
  const byTeam: Record<string, DefenseFantasyTotals> = {
    [awayAbbr]: createDefenseFantasyTotals(),
    [homeAbbr]: createDefenseFantasyTotals(),
  };

  let prevAwayScore = 0;
  let prevHomeScore = 0;
  let excludedVsAway = 0;
  let excludedVsHome = 0;

  for (const play of plays) {
    const awayAfter = safeInt(play.away_score_after, prevAwayScore);
    const homeAfter = safeInt(play.home_score_after, prevHomeScore);
    const awayDelta = Math.max(0, awayAfter - prevAwayScore);
    const homeDelta = Math.max(0, homeAfter - prevHomeScore);
    const scoreDelta = awayDelta > 0 ? awayDelta : homeDelta;
    const scoringTeam = awayDelta > 0 ? awayAbbr : homeDelta > 0 ? homeAbbr : '';

    const text = compactPlayText(play).toLowerCase();
    const rawType = (play.play_type ?? '').toLowerCase();
    const isNoPlay = rawType === 'no_play' || /\bno play\b/i.test(text);
    const offense = normalizeAbbr(play.possession_team_abbr);
    const defense = offense === awayAbbr ? homeAbbr : offense === homeAbbr ? awayAbbr : '';

    if (!isNoPlay && defense) {
      const def = byTeam[defense]!;
      if (play.sack || /\bsacked\b/i.test(text)) def.sacks += 1;
      if (play.interception || /\bintercepted\b/i.test(text)) def.interceptions += 1;
      if (play.fumble_lost || (/\bfumble(?:d)?\b/i.test(text) && /\brecovered by\b/i.test(text)))
        def.fumbleRecoveries += 1;
      if (/\bblocked\b/i.test(text) && /\b(field goal|extra point|punt|kick)\b/i.test(text))
        def.blockedKicks += 1;
    }

    const isTdPlay = Boolean(play.touchdown) || /\btouchdown\b/i.test(text);
    if (!isNoPlay && isTdPlay && scoreDelta > 0 && scoringTeam) {
      const nonOffensiveTd = offense && scoringTeam !== offense;
      if (nonOffensiveTd) {
        byTeam[scoringTeam]!.defensiveTds += 1;
        const isTurnoverReturnTd =
          Boolean(play.interception || play.fumble_lost) ||
          /\bintercepted\b/i.test(text) ||
          /\bfumble(?:d)?\b/i.test(text);
        const isSTReturnTd =
          /\b(kickoff|punt)\b/i.test(rawType) || /\b(kickoff|punt)\s+return\b/i.test(text);
        if (isTurnoverReturnTd && !isSTReturnTd) {
          if (offense === awayAbbr) excludedVsAway += scoreDelta;
          if (offense === homeAbbr) excludedVsHome += scoreDelta;
        }
      }
    }

    if (!isNoPlay && scoreDelta === 2 && scoringTeam && /\bsafety\b/i.test(text)) {
      byTeam[scoringTeam]!.safeties += 1;
    }

    prevAwayScore = awayAfter;
    prevHomeScore = homeAfter;
  }

  const finalAway = scoreTotals?.away ?? prevAwayScore;
  const finalHome = scoreTotals?.home ?? prevHomeScore;
  byTeam[awayAbbr]!.pointsAllowed = Math.max(0, finalHome - excludedVsAway);
  byTeam[homeAbbr]!.pointsAllowed = Math.max(0, finalAway - excludedVsHome);
  byTeam[awayAbbr]!.takeaways =
    byTeam[awayAbbr]!.interceptions + byTeam[awayAbbr]!.fumbleRecoveries;
  byTeam[homeAbbr]!.takeaways =
    byTeam[homeAbbr]!.interceptions + byTeam[homeAbbr]!.fumbleRecoveries;

  return byTeam;
}

// ─── Win Probability Estimate ────────────────────────────────────

/**
 * Estimate the away team's win probability from score + game state.
 *
 * Used as a fallback when the API hasn't returned a WP value yet.
 * Score differential is weighted by how little time remains, so a lead
 * in Q4 matters more than the same lead in Q1.
 *
 * Clamped to [1, 99] — we never express 0% or 100% certainty before the
 * final whistle to avoid jarring sparkline behavior.
 */
export function estimateAwayWinPct(
  awayScore: number,
  homeScore: number,
  quarter: number,
  clock: string,
  isFinal: boolean
): number {
  if (isFinal) {
    if (awayScore > homeScore) return 100;
    if (homeScore > awayScore) return 0;
    return 50;
  }

  const q = Math.max(1, quarter);
  const timing = computeGameProgress(q, normalizeClock(clock, '15:00'), q > 4);
  const remaining = Math.max(timing.totalMin - timing.elapsedMin, 0);
  const remainingFactor = 1 - remaining / timing.totalMin;
  const scoreDiff = awayScore - homeScore;
  const raw = 50 + scoreDiff * (3 + remainingFactor * 2.5);
  return Math.max(1, Math.min(99, Math.round(raw)));
}
