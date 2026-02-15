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
  WpTimelinePoint,
  FantasyRosterEntry,
  PositionGroup,
} from './types';
import {
  PLAY_TYPE_TO_ANIM,
  QUARTER_MINUTES,
  REGULATION_MINUTES,
  OT_GAME_MINUTES,
  POSITION_ORDER,
} from './constants';

// ─── Field Coordinate Math ──────────────────────────────────────

/**
 * Convert a yard line + side to a 0-100 field percentage.
 *
 * Convention: 0% = away team's goal line, 100% = home team's goal line.
 * The `yardLine` is "yards from own endzone" (yardline_100 in nflverse).
 *
 * When side is the away team, the yardline maps directly (e.g. away 20 = 20%).
 * When side is the home team, we flip: home 34 = 100 - 34 = 66%.
 */
export function yardToFieldPct(
  yardLine: number,
  side: string,
  awayAbbr: string,
): number {
  return side === awayAbbr ? yardLine : 100 - yardLine;
}

// ─── Play Classification ────────────────────────────────────────

/**
 * Map a server PlayEvent into the animation data shape the UI needs.
 *
 * This is the central translation from "what the API told us happened"
 * to "what the animation system should render."
 */
export function classifyPlayAnimation(
  play: PlayEvent,
  awayAbbr: string,
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

  // Figure out toSide — if the play crossed midfield
  const fromPct = yardToFieldPct(fromYardline, fromSide, awayAbbr);
  const toPct = fromPct + play.yardsGained * (fromSide === awayAbbr ? 1 : -1);
  const toSide = toPct > 50
    ? (awayAbbr === fromSide ? getOpponent(fromSide, awayAbbr) : fromSide)
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
    turnoverBy: play.isTurnover ? getOpponent(play.possession, awayAbbr) : undefined,
    receiver: null, // populated separately from stats_update events
    fgResult,
    fgDistance: type === 'fieldgoal' ? play.yardLine + 17 : undefined, // snap + endzone
    description: play.description,
  };
}

function getOpponent(team: string, awayAbbr: string): string {
  // Placeholder — in production the store knows both abbreviations
  return team === awayAbbr ? 'HOME' : awayAbbr;
}

// ─── Game Progress ──────────────────────────────────────────────

/**
 * Compute how far through the game we are, in minutes.
 *
 * Q1 0:00 remaining = 15 min elapsed
 * Q2 8:30 remaining = 21.5 min elapsed
 * OT 5:00 remaining = 65 min elapsed
 */
export function computeGameProgress(
  quarter: number,
  clock: string,
  isOT: boolean,
): GameTiming {
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
  padding = 2,
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
export function sparklineToArea(
  points: SparklinePoint[],
  height: number,
): string {
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
  roster: FantasyRosterEntry[],
): Array<{ position: PositionGroup; label: string; players: FantasyRosterEntry[] }> {
  const grouped = new Map<PositionGroup, FantasyRosterEntry[]>();

  for (const entry of roster) {
    const list = grouped.get(entry.position) ?? [];
    list.push(entry);
    grouped.set(entry.position, list);
  }

  return POSITION_ORDER
    .filter((pos) => grouped.has(pos))
    .map((pos) => ({
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
