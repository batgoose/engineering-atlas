/**
 * Play-level transforms for Gridstream.
 *
 * Pure functions for converting raw API play data into animation payloads,
 * mission-log entries, running stat totals, and display geometry.
 * No side effects, no DOM, no framework imports.
 *
 * Dependency graph (no circular imports):
 *   play-transforms → field.ts (yardToFieldPct, fieldPctToSvgX)
 *   play-transforms → api-transforms.ts (API types, RunningPlayerTotals, etc.)
 *   play-transforms → types.ts (PlayAnimationData, MissionLogEntry, PositionGroup)
 *
 * Mermaid: see docs/gridstream-live-runtime.md for the full data-flow diagram.
 */

import { yardToFieldPct } from './field';
import type {
  RunningPlayerTotals,
  RunningPlayerMeta,
  ApiPlayDetail,
  ApiPlayerGameStats,
} from './api-transforms';
import type { PlayAnimationData, MissionLogEntry, PositionGroup } from './types';

// ─── Primitive coercion helpers ──────────────────────────────────────────────

export function safeNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function safeInt(value: number | null | undefined, fallback = 0): number {
  return Math.round(safeNumber(value, fallback));
}

/**
 * Upper-case trim for team abbreviations.
 * Converts null/undefined to empty string so callers never need to guard.
 */
export function normalizeAbbr(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().trim();
}

/**
 * Strip leading '#' from a hex color string.
 * Returns `fallback` if the result is empty.
 */
export function normalizeHex(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '').replace(/^#/, '').trim();
  return cleaned || fallback;
}

const DEFAULT_CLOCK = '15:00';

/**
 * Normalize a game-clock string to M:SS format.
 * Returns `fallback` for missing, malformed, or zero-length values.
 */
export function normalizeClock(clock: string | null | undefined, fallback = DEFAULT_CLOCK): string {
  const value = (clock ?? '').trim();
  if (!value) return fallback;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const minutePart = match[1] ?? '0';
  const secondPart = match[2] ?? '00';
  return `${parseInt(minutePart, 10)}:${secondPart}`;
}

// ─── Team helpers ────────────────────────────────────────────────────────────

/**
 * Return the opposing team abbreviation given one team's abbreviation
 * and the known away + home abbreviations.
 */
export function getOpponent(team: string, awayAbbr: string, homeAbbr: string): string {
  return team === awayAbbr ? homeAbbr : awayAbbr;
}

// ─── Name normalization keys ─────────────────────────────────────────────────
// Used to build lookup maps that survive the many abbreviation styles in
// ESPN play descriptions ("T.Hill", "Tyreek Hill", "Hill").

function suffixToken(token: string): boolean {
  const t = token.toLowerCase().replace(/\./g, '');
  return t === 'jr' || t === 'sr' || t === 'ii' || t === 'iii' || t === 'iv' || t === 'v';
}

/** Full-name key: lowercase, alphanumeric only. */
export function normalizeNameKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Last-name-only key, excluding generational suffixes. */
export function lastNameKey(value: string | null | undefined): string {
  const cleaned = (value ?? '').replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(' ').filter(Boolean);
  const core = tokens.filter((token) => !suffixToken(token));
  if (core.length === 0) return '';
  const last = core[core.length - 1] ?? '';
  return last.replace(/[^A-Za-z]/g, '').toLowerCase();
}

/** Abbreviated-name key ("T.Hill" → "thill", "Tyreek Hill" → "thill"). */
export function abbreviatedNameKey(value: string | null | undefined): string {
  const cleaned = (value ?? '').replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(' ').filter(Boolean);
  const core = tokens.filter((token) => !suffixToken(token));
  if (core.length === 0) return normalizeNameKey(cleaned);
  const first = core[0] ?? '';
  const last = core[core.length - 1] ?? '';
  const firstInitial = first
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 1)
    .toLowerCase();
  const lastName = last.replace(/[^A-Za-z]/g, '').toLowerCase();
  return `${firstInitial}${lastName}`;
}

// ─── Play text utilities ─────────────────────────────────────────────────────

/** Merge short_description and description into a single, clean string. */
export function compactPlayText(play: ApiPlayDetail): string {
  return `${play.short_description ?? ''} ${play.description ?? ''}`.replace(/\s+/g, ' ').trim();
}

/**
 * Trim everything from "PENALTY on" and "TWO-POINT CONVERSION ATTEMPT" onward.
 * Stat credit belongs only to the primary play action.
 */
export function primaryActionText(text: string): string {
  return (
    text
      .split(/PENALTY on/i)[0]
      ?.split(/TWO-POINT CONVERSION ATTEMPT/i)[0]
      ?.trim() ?? text
  );
}

/** Split play text into individual sentences at ". " boundaries. */
export function actionSentences(text: string): string[] {
  return text
    .split(/\.\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Strip leading team abbreviation tags ("KC ") and ESPN prefix parentheses
 * ("(1-10-KC 25)") so name extraction starts on the actual actor.
 */
export function normalizeActionSentence(text: string): string {
  return text
    .replace(/^[A-Z]{2,3}\s+/, '')
    .replace(/^\([^)]*\)\s*/, '')
    .trim();
}

// ─── Down / distance display ─────────────────────────────────────────────────

export function formatDownDistance(down: number, distance: number): string {
  if (down <= 0) return '—';
  const downText = down === 1 ? '1st' : down === 2 ? '2nd' : down === 3 ? '3rd' : '4th';
  return `${downText} & ${Math.max(0, distance)}`;
}

// ─── Play classification ─────────────────────────────────────────────────────

function recoveryTeamFromText(play: ApiPlayDetail): string {
  const text = compactPlayText(play);
  const explicitTeam = normalizeAbbr(play.fumble_recovery_1_team);
  if (explicitTeam) return explicitTeam;
  const describedTeam = text.match(/\brecovered by\s+([A-Z]{2,3})[-\s]/i)?.[1] ?? '';
  return normalizeAbbr(describedTeam);
}

function hasDefensiveFumbleRecovery(play: ApiPlayDetail): boolean {
  const text = compactPlayText(play);
  if (!/\bfumble(?:s|d)?\b/i.test(text) || !/\brecovered by\b/i.test(text)) return false;
  const offense = normalizeAbbr(play.possession_team_abbr);
  const recoveryTeam = recoveryTeamFromText(play);
  if (!recoveryTeam) return false;
  if (!offense) return true;
  return recoveryTeam !== offense;
}

export function hasTurnoverLanguage(play: ApiPlayDetail): boolean {
  if (play.interception || play.fumble_lost) return true;
  const text = compactPlayText(play);
  if (/\bintercept(?:ed|ion)\b/i.test(text)) return true;
  if (hasDefensiveFumbleRecovery(play)) return true;
  return false;
}

export function isTurnoverPlay(play: ApiPlayDetail): boolean {
  return hasTurnoverLanguage(play);
}

export function isSnapPlay(play: ApiPlayDetail): boolean {
  if (!play.play_type) return false;
  if (play.play_type === 'end_of_half' || play.play_type === 'no_play') return false;
  return safeInt(play.down, 0) > 0 && safeInt(play.yard_line, 0) > 0;
}

export function isTimeoutPlay(play: ApiPlayDetail): boolean {
  if (Boolean(play.timeout)) return true;
  const type = (play.play_type ?? '').toLowerCase();
  if (type === 'timeout') return true;
  return /\btimeout\b/i.test(compactPlayText(play));
}

export function parsePositionGroup(position: string | null | undefined): PositionGroup | null {
  const pos = normalizeAbbr(position);
  if (pos === 'QB' || pos === 'WR' || pos === 'RB' || pos === 'TE' || pos === 'K') {
    return pos as PositionGroup;
  }
  if (pos === 'DEF' || pos === 'DST' || pos === 'D/ST') return 'DEF';
  return null;
}

/**
 * Infer a fantasy position from accumulated totals alone, as a fallback when
 * no position metadata is available from the boxscore.
 */
export function inferFallbackPosition(totals: RunningPlayerTotals): PositionGroup | null {
  if (totals.passAtt > 0) return 'QB';
  if (totals.rec > 0) return 'WR';
  if (totals.rushAtt > 0) return 'RB';
  return null;
}

/**
 * Map an ApiPlayDetail to the animation type that the SVG renderer uses.
 * Returns null for administrative plays (timeouts, end-of-half, etc.).
 */
export function resolveAnimType(play: ApiPlayDetail): PlayAnimationData['type'] | null {
  const type = (play.play_type ?? '').toLowerCase();
  const text = compactPlayText(play).toLowerCase();
  if (type === 'end_of_half' || type === 'end_of_game') return null;
  if (text.includes('end of half') || text.includes('end of game')) return null;
  if (text.includes('two-minute warning')) return null;
  if (isTimeoutPlay(play) && !Boolean(play.two_point_attempt)) return null;
  if (isTurnoverPlay(play)) return 'turnover';

  const isFieldGoalLike =
    Boolean(play.extra_point_attempt) ||
    type === 'field_goal' ||
    type === 'extra_point' ||
    (play.field_goal_result ?? '').length > 0;
  if (isFieldGoalLike) return 'fieldgoal';

  const stType = (play.st_play_type ?? '').toLowerCase();
  const isKickLike =
    Boolean(play.kickoff_attempt) ||
    Boolean(play.punt_attempt) ||
    Boolean(play.special_teams_play) ||
    type === 'kickoff' ||
    type === 'punt' ||
    stType.includes('kick') ||
    stType.includes('punt');
  if (isKickLike) return 'kick';

  if (Boolean(play.pass_attempt)) return 'pass';
  if (Boolean(play.rush_attempt)) return 'rush';

  if (Boolean(play.two_point_attempt)) {
    if (type === 'run' || type === 'rush' || type === 'qb_kneel' || type === 'qb_scramble') {
      return 'rush';
    }
    return 'pass';
  }

  if (type === 'pass' || type === 'qb_spike') return 'pass';
  if (type === 'run' || type === 'rush' || type === 'qb_kneel' || type === 'qb_scramble')
    return 'rush';
  if (type === 'no_play' && play.penalty) {
    if (Boolean(play.rush_attempt)) return 'rush';
    return 'pass';
  }

  return null;
}

/**
 * Parse the field-goal result into the canonical union.
 * Checks the explicit `field_goal_result` column first, then falls back to
 * text scanning. Returns `undefined` for non-field-goal plays.
 */
export function resolveFieldGoalResult(play: ApiPlayDetail): PlayAnimationData['fgResult'] {
  if (resolveAnimType(play) !== 'fieldgoal') return undefined;
  const explicit = (play.field_goal_result ?? '').toLowerCase();
  if (explicit === 'made') return 'made';
  if (explicit === 'wide_left') return 'wide_left';
  if (explicit === 'wide_right') return 'wide_right';
  if (explicit === 'short') return 'short';
  if (explicit === 'blocked') return 'blocked';

  const desc = `${play.short_description ?? ''} ${play.description ?? ''}`.toLowerCase();
  if (desc.includes('good')) return 'made';
  if (desc.includes('wide left')) return 'wide_left';
  if (desc.includes('wide right')) return 'wide_right';
  if (desc.includes('short')) return 'short';
  if (desc.includes('blocked')) return 'blocked';
  return undefined;
}

/**
 * Determine pass/run direction from the structured API fields first,
 * then fall back to text scanning.
 */
export function resolveDirectionFromText(source: string): 'left' | 'middle' | 'right' {
  const text = source.toLowerCase();
  const passPhrase = text.match(
    /\b(?:pass(?:es|ed)?|incomplete)(?:\s+\w+){0,3}\s+(left|right|middle)\b/i
  );
  if (passPhrase?.[1]) return passPhrase[1].toLowerCase() as 'left' | 'middle' | 'right';
  if (/\bleft\s+(?:guard|tackle|end)\b/i.test(text)) return 'left';
  if (/\bright\s+(?:guard|tackle|end)\b/i.test(text)) return 'right';
  if (/\bmiddle\b/i.test(text)) return 'middle';
  const leftIdx = text.search(/\bleft\b/i);
  const rightIdx = text.search(/\bright\b/i);
  if (leftIdx >= 0 && rightIdx >= 0) return leftIdx <= rightIdx ? 'left' : 'right';
  if (leftIdx >= 0) return 'left';
  if (rightIdx >= 0) return 'right';
  return 'middle';
}

export function resolveDirection(play: ApiPlayDetail): 'left' | 'middle' | 'right' {
  const text = compactPlayText(play);
  const passLoc = `${play.pass_location ?? ''}`.toLowerCase();
  const runLoc = `${play.run_location ?? ''}`.toLowerCase();
  const type = (play.play_type ?? '').toLowerCase();
  const textDirection = resolveDirectionFromText(text);
  const hasExplicitPassDirection =
    /\b(?:pass(?:es|ed)?|incomplete)(?:\s+\w+){0,6}\s+(left|right|middle)\b/i.test(text) ||
    /\b(?:deep|short)\s+(left|right|middle)\b/i.test(text);

  const fromFieldToken = (value: string): 'left' | 'middle' | 'right' | null => {
    if (/\bleft\b/i.test(value)) return 'left';
    if (/\bright\b/i.test(value)) return 'right';
    if (/\bmiddle\b/i.test(value)) return 'middle';
    return null;
  };

  const passLike = type === 'pass' || /\bpass|incomplete|sacked\b/i.test(text);
  if (passLike) {
    if (hasExplicitPassDirection) return textDirection;
    const fromPassLoc = fromFieldToken(passLoc);
    if (fromPassLoc) return fromPassLoc;
    return textDirection;
  }

  const rushLike =
    type === 'run' ||
    type === 'rush' ||
    type === 'qb_scramble' ||
    /\bscramble|rush|up the|tackle|guard|end\b/i.test(text);
  if (rushLike) {
    const fromRunLoc = fromFieldToken(runLoc);
    if (fromRunLoc) return fromRunLoc;
    return textDirection;
  }

  return textDirection;
}

// ─── Display spot types and helpers ─────────────────────────────────────────

/** A yardline expressed as the side's abbreviated name + yards-from-that-endzone. */
export interface ParsedDisplaySpot {
  side: string;
  yardLine: number;
}

/**
 * Convert a raw (side, yard) pair from play text into a normalized display spot.
 * Returns null if the side can't be matched to either team.
 */
export function parseDisplaySpot(
  sideToken: string | null | undefined,
  yardToken: string | number | null | undefined,
  awayAbbr: string,
  homeAbbr: string
): ParsedDisplaySpot | null {
  const side = normalizeAbbr(sideToken);
  if (side !== awayAbbr && side !== homeAbbr) return null;
  const rawYard =
    typeof yardToken === 'number' ? yardToken : Number.parseInt(`${yardToken ?? ''}`, 10);
  if (!Number.isFinite(rawYard)) return null;
  return {
    side,
    yardLine: Math.max(0, Math.min(50, Math.round(rawYard))),
  };
}

/**
 * Convert a display spot to a 0-100 field percentage.
 * @see yardToFieldPct
 */
export function displaySpotToFieldPct(spot: ParsedDisplaySpot, awayAbbr: string): number {
  return yardToFieldPct(spot.yardLine, spot.side, awayAbbr);
}

/**
 * Convert a 0-100 field percentage back to a display spot.
 * Values ≤50 are on the away side; values >50 are on the home side.
 */
export function fieldPctToDisplaySpot(
  pct: number,
  awayAbbr: string,
  homeAbbr: string
): ParsedDisplaySpot {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (clamped <= 50) return { side: awayAbbr, yardLine: clamped };
  return { side: homeAbbr, yardLine: 100 - clamped };
}

/**
 * Convert a yardline_100 value (yards from opponent's endzone, nflverse convention)
 * plus possessing team into a human-readable display spot ("KC 25", "SF 40", "50").
 *
 * NOTE: Some data sources (e.g. ESPN) may store this as "yards from own endzone"
 * for certain play types (particularly punts/kicks). For kicks, prefer deriving
 * the start position from landing spot + kick distance instead.
 */
export function yardline100ToDisplay(
  yardline100: number | null | undefined,
  possessionTeam: string | null | undefined,
  awayAbbr: string,
  homeAbbr: string
): { side: string; yardLine: number } {
  if (yardline100 == null || !Number.isFinite(yardline100)) {
    return { side: '', yardLine: 0 };
  }
  const y = Math.max(0, Math.min(100, Math.round(yardline100)));
  const poss = normalizeAbbr(possessionTeam) || awayAbbr;
  const opp = getOpponent(poss, awayAbbr, homeAbbr);

  if (y > 50) return { side: poss, yardLine: 100 - y };
  if (y < 50) return { side: opp, yardLine: y };
  return { side: poss, yardLine: 50 };
}

/**
 * Derive the drive-start display spot from a raw drive start_yardline.
 * Handles the edge case where the yardline is already expressed as
 * "yards from own endzone" vs. "yards from midfield."
 */
export function normalizeDriveStart(
  startYardline: number | null | undefined,
  teamAbbr: string,
  awayAbbr: string,
  homeAbbr: string
): { side: string; yardLine: number } {
  const y = safeInt(startYardline, 0);
  if (y > 50) return yardline100ToDisplay(y, teamAbbr, awayAbbr, homeAbbr);
  return {
    side: normalizeAbbr(teamAbbr) || awayAbbr,
    yardLine: Math.max(0, Math.min(50, y)),
  };
}

// ─── Game clock helpers ──────────────────────────────────────────────────────

export function parseClockSeconds(clock: string | null | undefined): number {
  const normalized = normalizeClock(clock, '0:00');
  const [m, s] = normalized.split(':');
  const mins = Number.parseInt(m ?? '0', 10);
  const secs = Number.parseInt(s ?? '0', 10);
  return (Number.isNaN(mins) ? 0 : mins) * 60 + (Number.isNaN(secs) ? 0 : secs);
}

/**
 * Total seconds elapsed in the game at a given quarter + remaining clock.
 * Each regulation quarter is 15 minutes (900 seconds).
 */
export function gameElapsedSeconds(
  quarter: number | null | undefined,
  clock: string | null | undefined
): number {
  const q = Math.max(1, safeInt(quarter, 1));
  const remaining = Math.max(0, Math.min(900, parseClockSeconds(clock)));
  return (q - 1) * 900 + (900 - remaining);
}

export function formatClockFromSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatElapsedSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

/**
 * Format how much time elapsed within a drive up to the given play.
 * Returns an empty string when the drive start play is unknown.
 */
export function driveElapsedAtPlay(
  driveStartPlay: ApiPlayDetail | undefined,
  play: ApiPlayDetail
): string {
  if (!driveStartPlay) return '';
  const start = gameElapsedSeconds(driveStartPlay.quarter, driveStartPlay.clock);
  const now = gameElapsedSeconds(play.quarter, play.clock);
  return formatElapsedSeconds(now - start);
}

// ─── Name extraction from play text ─────────────────────────────────────────

/**
 * Extract the primary ball carrier (passer or rusher) from action text.
 * Expects abbreviated form "T.Hill" or "T.Hill Jr.".
 */
export function extractPrimaryBallCarrier(
  text: string,
  playType: 'pass' | 'rush' | 'turnover' | 'kick' | 'fieldgoal' | '' = ''
): string | null {
  const sentences = actionSentences(text);
  let chosen = normalizeActionSentence(text);

  if (sentences.length > 0) {
    const passPattern = /\b(pass|sacked|scramble|intercepted)\b/i;
    const rushPattern = /\b(up the|left|right|guard|tackle|end|rush|scramble|kneel)\b/i;
    const pattern = playType === 'pass' ? passPattern : playType === 'rush' ? rushPattern : null;
    if (pattern) {
      const sentenceMatch = sentences.find((sentence) => pattern.test(sentence));
      chosen = normalizeActionSentence(sentenceMatch ?? sentences[sentences.length - 1] ?? text);
    } else {
      chosen = normalizeActionSentence(sentences[sentences.length - 1] ?? text);
    }
  }

  if (!chosen) return null;
  const cleaned = chosen.replace(/^[^A-Z]*?(?=[A-Z]\.)/, '');
  const match = cleaned.match(/^([A-Z]\.[A-Za-z][A-Za-z.'-]*(?:\s(?:Jr\.|Sr\.|II|III))?)/);
  return match?.[1] ?? null;
}

/**
 * Extract the receiver name from "pass … to T.Hill" in play text.
 */
export function extractNameAfterTo(text: string): string | null {
  const match = text.match(
    /\bto\s+(?:\d+-)?([A-Z]\.[A-Za-z][A-Za-z.'-]*(?:\s(?:Jr\.|Sr\.|II|III))?)/
  );
  return match?.[1] ?? null;
}

/**
 * Extract the kicker name from a field-goal or extra-point play.
 */
export function extractKickerName(text: string): string | null {
  const sentences = actionSentences(text);
  const kickSentence =
    sentences.find((sentence) => /\b(field goal|extra point)\b/i.test(sentence)) ??
    sentences[0] ??
    text;
  const cleaned = normalizeActionSentence(kickSentence);
  return (
    extractPrimaryBallCarrier(cleaned, 'fieldgoal') ??
    extractPrimaryBallCarrier(text, 'fieldgoal') ??
    null
  );
}

/**
 * Extract the player who made a turnover return from play text.
 */
export function extractTurnoverReturner(text: string): string | null {
  const pick = text.match(
    /intercepted by\s+([A-Z]\.[A-Za-z][A-Za-z.'-]*(?:\s(?:Jr\.|Sr\.|II|III))?)/i
  );
  if (pick?.[1]) return pick[1];
  const recover = text.match(
    /recovered by\s+(?:[A-Z]{2,3}\s+)?([A-Z]\.[A-Za-z][A-Za-z.'-]*(?:\s(?:Jr\.|Sr\.|II|III))?)/i
  );
  return recover?.[1] ?? null;
}

// ─── Parsed play detail types ────────────────────────────────────────────────

export interface ParsedKickDetails {
  start?: ParsedDisplaySpot;
  landing?: ParsedDisplaySpot;
  /** Kick distance in yards parsed from play text (fallback when kick_distance field is null). */
  kickYards?: number;
  returnSpot?: ParsedDisplaySpot;
  returner?: string;
  returnYards?: number;
}

export interface ParsedTurnoverDetails {
  takeawaySpot?: ParsedDisplaySpot;
  returnSpot?: ParsedDisplaySpot;
  returner?: string;
  returnYards?: number;
}

export interface ParsedPenaltyDetails {
  team?: string;
  player?: string;
  kind?: string;
  yards?: number;
  enforcedSpot?: ParsedDisplaySpot;
  isNoPlay: boolean;
}

// ─── Field-goal ─────────────────────────────────────────────────────────────

export function parseFieldGoalDistance(play: ApiPlayDetail, text: string): number | null {
  if (play.kick_distance != null && Number.isFinite(play.kick_distance)) {
    const explicit = safeInt(play.kick_distance, 0);
    return explicit > 0 ? explicit : null;
  }
  const directMatch = text.match(/\b(\d+)\s*(?:-|\s)?yard\b(?:\s+field goal)?/i);
  if (directMatch?.[1]) {
    const parsed = Number.parseInt(directMatch[1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

// ─── Kick parsing ────────────────────────────────────────────────────────────

export function parseKickDetails(
  play: ApiPlayDetail,
  awayAbbr: string,
  homeAbbr: string
): ParsedKickDetails {
  const parsed: ParsedKickDetails = {};

  const possessionTeam = normalizeAbbr(play.possession_team_abbr) || awayAbbr;
  const returnTeam = normalizeAbbr(play.return_team);
  const receivingTeam = returnTeam || getOpponent(possessionTeam, awayAbbr, homeAbbr);
  const rawType = (play.play_type ?? '').toLowerCase();
  const isKickPlay =
    rawType === 'punt' ||
    rawType === 'kickoff' ||
    Boolean(play.punt_attempt) ||
    Boolean(play.kickoff_attempt);

  if (play.yard_line != null && !isKickPlay) {
    parsed.start = yardline100ToDisplay(play.yard_line, possessionTeam, awayAbbr, homeAbbr);
  }

  const kickYardsFromDistance =
    play.kick_distance != null && Number.isFinite(play.kick_distance)
      ? Math.max(0, safeInt(play.kick_distance, 0))
      : 0;
  const kickYardsFallback = Math.max(0, safeInt(play.yards_gained, 0));
  const kickYards = kickYardsFromDistance > 0 ? kickYardsFromDistance : kickYardsFallback;
  if (kickYards > 0) {
    parsed.kickYards = kickYards;
  }

  const returnYards =
    play.return_yards != null && Number.isFinite(play.return_yards)
      ? safeInt(play.return_yards, 0)
      : null;
  if (returnYards != null) parsed.returnYards = returnYards;

  parsed.returner =
    (play.punt_returner_player_name ?? '').trim() ||
    (play.kickoff_returner_player_name ?? '').trim() ||
    undefined;

  const finalSpot =
    play.end_yard_line != null
      ? yardline100ToDisplay(play.end_yard_line, receivingTeam, awayAbbr, homeAbbr)
      : null;
  if (finalSpot) parsed.returnSpot = finalSpot;

  if (play.touchback) {
    parsed.landing = { side: receivingTeam, yardLine: 0 };
  } else if (finalSpot && returnYards != null) {
    const returnDirection = receivingTeam === awayAbbr ? 1 : -1;
    const finalPct = displaySpotToFieldPct(finalSpot, awayAbbr);
    const landingPct = finalPct - returnDirection * returnYards;
    parsed.landing = fieldPctToDisplaySpot(landingPct, awayAbbr, homeAbbr);
  } else if (
    finalSpot &&
    (Boolean(play.punt_fair_catch) ||
      Boolean(play.kickoff_fair_catch) ||
      Boolean(play.out_of_bounds))
  ) {
    parsed.landing = finalSpot;
  }

  if (!parsed.landing && parsed.start && parsed.kickYards != null) {
    const kickDirection = possessionTeam === awayAbbr ? 1 : -1;
    const startPct = displaySpotToFieldPct(parsed.start, awayAbbr);
    parsed.landing = fieldPctToDisplaySpot(
      startPct + kickDirection * parsed.kickYards,
      awayAbbr,
      homeAbbr
    );
  }

  if (!parsed.returnSpot && parsed.landing) {
    parsed.returnSpot = parsed.landing;
  }

  return parsed;
}

// ─── Turnover parsing ────────────────────────────────────────────────────────

export function parseTurnoverDetails(
  play: ApiPlayDetail,
  awayAbbr: string,
  homeAbbr: string,
  returnTeam: string
): ParsedTurnoverDetails {
  const parsed: ParsedTurnoverDetails = {};
  const text = compactPlayText(play);

  const offenseTeam = normalizeAbbr(play.possession_team_abbr) || awayAbbr;
  const recoveryTeam = recoveryTeamFromText(play);
  const returnTeamFromFeed = normalizeAbbr(play.return_team);
  const resolvedReturnTeam =
    recoveryTeam ||
    returnTeamFromFeed ||
    normalizeAbbr(returnTeam) ||
    getOpponent(offenseTeam, awayAbbr, homeAbbr);

  const isDefensiveFumbleRecovery =
    hasDefensiveFumbleRecovery(play) &&
    play.end_yard_line == null &&
    play.return_yards == null &&
    play.fumble_recovery_1_yards == null;

  parsed.returner =
    (play.interception_player_name ?? '').trim() ||
    (play.fumble_recovery_1_player_name ?? '').trim() ||
    undefined;

  if (play.return_yards != null && Number.isFinite(play.return_yards)) {
    parsed.returnYards = safeInt(play.return_yards, 0);
  } else if (
    play.fumble_recovery_1_yards != null &&
    Number.isFinite(play.fumble_recovery_1_yards)
  ) {
    parsed.returnYards = safeInt(play.fumble_recovery_1_yards, 0);
  }

  if (play.end_yard_line != null) {
    parsed.returnSpot = yardline100ToDisplay(
      play.end_yard_line,
      resolvedReturnTeam,
      awayAbbr,
      homeAbbr
    );
  }

  if (parsed.returnSpot && parsed.returnYards != null) {
    const returnDirection = resolvedReturnTeam === awayAbbr ? 1 : -1;
    const returnSpotPct = displaySpotToFieldPct(parsed.returnSpot, awayAbbr);
    parsed.takeawaySpot = fieldPctToDisplaySpot(
      returnSpotPct - returnDirection * parsed.returnYards,
      awayAbbr,
      homeAbbr
    );
  }

  const fumbleSpotMatch = text.match(
    /\bfumbles?(?:\s*\([^)]*\))?\s+at\s+([A-Z]{2,3})\s+(\d{1,2})\b/i
  );
  const recoverySpotMatch = text.match(/\brecovered by\s+.+?\s+at\s+([A-Z]{2,3})\s+(\d{1,2})\b/i);
  const fumbleSpot = parseDisplaySpot(
    fumbleSpotMatch?.[1],
    fumbleSpotMatch?.[2],
    awayAbbr,
    homeAbbr
  );
  const recoverySpot = parseDisplaySpot(
    recoverySpotMatch?.[1],
    recoverySpotMatch?.[2],
    awayAbbr,
    homeAbbr
  );
  if (fumbleSpot && (!parsed.takeawaySpot || isDefensiveFumbleRecovery)) {
    parsed.takeawaySpot = fumbleSpot;
  }
  if (recoverySpot && (!parsed.returnSpot || isDefensiveFumbleRecovery)) {
    parsed.returnSpot = recoverySpot;
  }

  if (!parsed.takeawaySpot && play.yard_line != null) {
    parsed.takeawaySpot = yardline100ToDisplay(play.yard_line, offenseTeam, awayAbbr, homeAbbr);
  }

  if (!parsed.returnSpot && parsed.takeawaySpot) {
    parsed.returnSpot = parsed.takeawaySpot;
  }

  return parsed;
}

// ─── Penalty parsing ─────────────────────────────────────────────────────────

export function parsePenaltyDetails(
  play: ApiPlayDetail,
  awayAbbr: string,
  homeAbbr: string
): ParsedPenaltyDetails | null {
  const hasPenaltySignal =
    Boolean(play.penalty) ||
    Boolean((play.penalty_type ?? '').trim()) ||
    Boolean((play.penalty_team ?? '').trim()) ||
    Boolean((play.penalty_player_name ?? '').trim()) ||
    play.penalty_yards != null;

  if (!hasPenaltySignal) return null;

  const team = normalizeAbbr(play.penalty_team);
  const normalizedTeam = team === awayAbbr || team === homeAbbr ? team : undefined;

  return {
    team: normalizedTeam,
    player: (play.penalty_player_name ?? '').trim() || undefined,
    kind: (play.penalty_type ?? '').trim() || undefined,
    yards: safeInt(play.penalty_yards, 0),
    enforcedSpot: undefined,
    isNoPlay: (play.play_type ?? '').toLowerCase() === 'no_play',
  };
}

// ─── Timeout parsing ─────────────────────────────────────────────────────────

/**
 * Parse timeout ownership + remaining timeout counters from canonical play fields.
 * Returns null for non-timeout plays.
 */
export function parseTimeoutUsage(
  play: ApiPlayDetail,
  awayAbbr: string,
  homeAbbr: string
): {
  team: string;
  ordinal: number | null;
  homeRemaining: number | null;
  awayRemaining: number | null;
} | null {
  const text = compactPlayText(play);
  const hasTimeoutSignal = Boolean(play.timeout) || (play.play_type ?? '').toLowerCase() === 'timeout';
  const hasTimeoutText = /\btimeout\b/i.test(text);
  if (!hasTimeoutSignal && !hasTimeoutText) return null;

  const descTeam =
    text.match(/\btimeout\s*#?\s*\d+\s+by\s+([A-Z]{2,3})\b/i)?.[1] ??
    text.match(/\btimeout\s+by\s+([A-Z]{2,3})\b/i)?.[1] ??
    text.match(/^([A-Z]{2,3})\s+timeout\b/i)?.[1] ??
    '';
  const team = normalizeAbbr(play.timeout_team || descTeam);
  const normalizedTeam = team === awayAbbr || team === homeAbbr ? team : '';
  const homeRemaining =
    play.home_timeouts_remaining != null && Number.isFinite(play.home_timeouts_remaining)
      ? Math.max(0, safeInt(play.home_timeouts_remaining, 0))
      : null;
  const awayRemaining =
    play.away_timeouts_remaining != null && Number.isFinite(play.away_timeouts_remaining)
      ? Math.max(0, safeInt(play.away_timeouts_remaining, 0))
      : null;

  let ordinal =
    Number.parseInt(text.match(/\btimeout\s*#\s*(\d+)\b/i)?.[1] ?? '', 10);
  if (Number.isNaN(ordinal)) ordinal = null;
  if (normalizedTeam === awayAbbr && awayRemaining != null) {
    ordinal = Math.max(0, 3 - awayRemaining);
  } else if (normalizedTeam === homeAbbr && homeRemaining != null) {
    ordinal = Math.max(0, 3 - homeRemaining);
  }

  const inferredAwayRemaining =
    awayRemaining == null && normalizedTeam === awayAbbr && ordinal != null
      ? Math.max(0, 3 - ordinal)
      : null;
  const inferredHomeRemaining =
    homeRemaining == null && normalizedTeam === homeAbbr && ordinal != null
      ? Math.max(0, 3 - ordinal)
      : null;

  return {
    team: normalizedTeam,
    ordinal,
    homeRemaining: homeRemaining ?? inferredHomeRemaining,
    awayRemaining: awayRemaining ?? inferredAwayRemaining,
  };
}

// ─── Action yards ────────────────────────────────────────────────────────────

export function resolveActionYards(
  play: ApiPlayDetail,
  type: PlayAnimationData['type'],
  text: string
): number {
  const actionText = primaryActionText(text);
  if (type === 'kick') {
    const kickDist = actionText.match(/\b(?:punts?|kicks?)\s+(\d+)\s+yards\b/i);
    if (kickDist?.[1]) {
      const yards = Number.parseInt(kickDist[1], 10);
      if (!Number.isNaN(yards)) return yards;
    }
  }
  const byText = actionText.match(/\bfor\s+(-?\d+)\s+yards?\b/i);
  if (byText?.[1]) {
    const yards = Number.parseInt(byText[1], 10);
    if (!Number.isNaN(yards)) return yards;
  }
  if (/incomplete/i.test(actionText)) return 0;
  return safeInt(play.yards_gained, 0);
}

// ─── Post-play position helpers ──────────────────────────────────────────────

/**
 * Determine which team has possession after the play settles.
 * Falls back to the possession field on the next snap play, then
 * infers from the current play type.
 */
export function resolvePossessionAfter(
  play: ApiPlayDetail,
  nextSnapPlay: ApiPlayDetail | undefined,
  awayAbbr: string,
  homeAbbr: string
): string {
  const nextPoss = normalizeAbbr(nextSnapPlay?.possession_team_abbr);
  if (nextPoss) return nextPoss;
  const current = normalizeAbbr(play.possession_team_abbr) || awayAbbr;
  const playType = (play.play_type ?? '').toLowerCase();
  if (
    isTurnoverPlay(play) ||
    playType === 'punt' ||
    playType === 'kickoff' ||
    playType === 'extra_point' ||
    playType === 'field_goal'
  ) {
    return getOpponent(current, awayAbbr, homeAbbr);
  }
  return current;
}

/**
 * Best guess at the yardline where possession changes hands after the play.
 * Prefers next snap's yard_line for kicks where end_yard_line can drift.
 */
export function resolveYardlineAfter(
  play: ApiPlayDetail,
  nextSnapPlay: ApiPlayDetail | undefined
): number {
  const text = compactPlayText(play).toLowerCase();
  if (
    (play.touchdown || play.is_scoring_play || text.includes('touchdown')) &&
    play.end_yard_line != null
  ) {
    return safeInt(play.end_yard_line);
  }
  if (nextSnapPlay?.yard_line != null) return safeInt(nextSnapPlay.yard_line);
  if (play.end_yard_line != null) return safeInt(play.end_yard_line);
  if (play.yard_line != null) {
    const estimate = safeNumber(play.yard_line) - safeNumber(play.yards_gained);
    return Math.max(0, Math.min(100, Math.round(estimate)));
  }
  return 50;
}

// ─── Mission log entry ───────────────────────────────────────────────────────

/**
 * Build the play-by-play log entry for a single play.
 */
export function toMissionLogEntry(play: ApiPlayDetail): MissionLogEntry {
  const turnover = isTurnoverPlay(play);
  const type: MissionLogEntry['type'] = turnover
    ? 'turnover'
    : play.is_scoring_play
      ? 'score'
      : !play.play_type || play.play_type === 'end_of_half' || play.play_type === 'no_play'
        ? 'info'
        : 'play';

  const down =
    play.down_distance_text || formatDownDistance(safeInt(play.down), safeInt(play.distance));
  const text = compactPlayText(play) || fallbackMissionLogText(play);

  return {
    id: `play-${play.id}-${play.sequence}`,
    quarter: safeInt(play.quarter, 0),
    clock: normalizeClock(play.clock, '0:00'),
    down,
    team: normalizeAbbr(play.possession_team_abbr),
    text,
    epa: safeNumber(play.epa),
    type,
  };
}

function fallbackMissionLogText(play: ApiPlayDetail): string {
  if (play.timeout) {
    const timeoutTeam = normalizeAbbr(play.timeout_team);
    return timeoutTeam ? `Timeout ${timeoutTeam}` : 'Timeout';
  }
  const rawType = (play.play_type ?? '').trim();
  if (!rawType) return 'Play';
  const label = rawType.replace(/_/g, ' ');
  const yards = play.yards_gained;
  if (yards == null || !Number.isFinite(yards)) {
    return label.toUpperCase();
  }
  const rounded = Math.round(yards);
  return `${label.toUpperCase()} ${rounded >= 0 ? '+' : ''}${rounded} yds`;
}

// ─── Running totals ──────────────────────────────────────────────────────────

export function emptyRunningTotals(): RunningPlayerTotals {
  return {
    passAtt: 0,
    passComp: 0,
    passYds: 0,
    passTd: 0,
    passInt: 0,
    rushAtt: 0,
    rushYds: 0,
    rushTd: 0,
    rec: 0,
    recYds: 0,
    recTd: 0,
    fgAtt: 0,
    fgMade: 0,
    fgMade0to39: 0,
    fgMade40to49: 0,
    fgMade50to59: 0,
    fgMade60plus: 0,
    fgMissed: 0,
    punts: 0,
    puntYds: 0,
    xpAtt: 0,
    xpMade: 0,
    fumblesLost: 0,
    sacks: 0,
  };
}

/**
 * Apply a stat mutation to the named player's running totals.
 * Creates a new entry if the player hasn't appeared yet.
 * Both the full-name and abbreviated-name keys are updated so lookups
 * from either form always resolve to the same object.
 */
export function updateRunningPlayerTotals(
  playerName: string,
  update: (totals: RunningPlayerTotals) => void,
  totalsByKey: Map<string, RunningPlayerTotals>,
  teamAbbr?: string,
  metaByFullKey?: Map<string, RunningPlayerMeta>,
  position?: PositionGroup
): void {
  const fullKey = normalizeNameKey(playerName);
  const shortKey = abbreviatedNameKey(playerName);
  const current = totalsByKey.get(fullKey) ?? totalsByKey.get(shortKey) ?? emptyRunningTotals();
  update(current);
  if (fullKey) totalsByKey.set(fullKey, current);
  if (shortKey) totalsByKey.set(shortKey, current);
  if (teamAbbr && fullKey && metaByFullKey) {
    const existing = metaByFullKey.get(fullKey);
    if (existing) {
      if (!existing.position && position) existing.position = position;
    } else {
      metaByFullKey.set(fullKey, { name: playerName, teamAbbr, position });
    }
  }
}

export function runningTotalsForPlayer(
  playerName: string,
  totalsByKey: Map<string, RunningPlayerTotals>
): RunningPlayerTotals | null {
  const fullKey = normalizeNameKey(playerName);
  const shortKey = abbreviatedNameKey(playerName);
  return totalsByKey.get(fullKey) ?? totalsByKey.get(shortKey) ?? null;
}

/**
 * Shallow-clone a totals map so each frame gets an independent snapshot.
 */
export function cloneRunningTotalsMap(
  source: Map<string, RunningPlayerTotals>
): Map<string, RunningPlayerTotals> {
  const cloned = new Map<string, RunningPlayerTotals>();
  for (const [key, value] of source.entries()) {
    cloned.set(key, { ...value });
  }
  return cloned;
}

// ─── Player stats lookup ─────────────────────────────────────────────────────

/**
 * Build a multi-key lookup from boxscore player stats so stat rows can be
 * matched against abbreviated names found in play descriptions.
 * Keys: full normalized name, abbreviated name, and "ln:<last>" when unique.
 */
export function buildPlayerGameStatsLookup(
  playerStatsByTeam: Record<string, ApiPlayerGameStats[]> | undefined
): Map<string, ApiPlayerGameStats> {
  const lookup = new Map<string, ApiPlayerGameStats>();
  const byLastName = new Map<string, ApiPlayerGameStats[]>();
  for (const rows of Object.values(playerStatsByTeam ?? {})) {
    for (const row of rows) {
      const full = normalizeNameKey(row.player_name);
      const short = abbreviatedNameKey(row.player_name);
      const last = lastNameKey(row.player_name);
      if (full) lookup.set(full, row);
      if (short) lookup.set(short, row);
      if (last) {
        const existing = byLastName.get(last) ?? [];
        existing.push(row);
        byLastName.set(last, existing);
      }
    }
  }
  for (const [last, rows] of byLastName.entries()) {
    if (rows.length === 1) lookup.set(`ln:${last}`, rows[0]!);
  }
  return lookup;
}

export function playerStatsRowForPlayer(
  playerName: string,
  statsLookup: Map<string, ApiPlayerGameStats>
): ApiPlayerGameStats | null {
  const fullKey = normalizeNameKey(playerName);
  const shortKey = abbreviatedNameKey(playerName);
  const lastKey = lastNameKey(playerName);
  return (
    statsLookup.get(fullKey) ??
    statsLookup.get(shortKey) ??
    (lastKey ? statsLookup.get(`ln:${lastKey}`) : undefined) ??
    null
  );
}

// ─── Stat line formatters ────────────────────────────────────────────────────

export function formatActorStatLines(totals: RunningPlayerTotals): string[] {
  const lines: string[] = [];
  if (totals.rec > 0)
    lines.push(`${totals.rec} ${totals.rec === 1 ? 'Catch' : 'Catches'} - ${totals.recYds} Yards`);
  if (totals.rushAtt > 0)
    lines.push(
      `${totals.rushAtt} ${totals.rushAtt === 1 ? 'Rush' : 'Rushes'} - ${totals.rushYds} Yards`
    );
  if (totals.passAtt > 0)
    lines.push(`${totals.passComp}/${totals.passAtt} Passing - ${totals.passYds} Yards`);
  const extras: string[] = [];
  const totalTds = totals.passTd + totals.rushTd + totals.recTd;
  if (totalTds > 0) extras.push(`${totalTds} ${totalTds === 1 ? 'TD' : 'TDs'}`);
  if (totals.fumblesLost > 0)
    extras.push(`${totals.fumblesLost} ${totals.fumblesLost === 1 ? 'Fumble' : 'Fumbles'}`);
  if (totals.passInt > 0) extras.push(`${totals.passInt} ${totals.passInt === 1 ? 'INT' : 'INTs'}`);
  if (extras.length > 0) lines.push(extras.join(' - '));
  return lines;
}

export function formatActorStatLinesFromRow(row: ApiPlayerGameStats): string[] {
  return formatActorStatLines(totalsFromPlayerRow(row));
}

export function formatKickerStatLines(totals: RunningPlayerTotals): string[] {
  const parts: string[] = [];
  if (totals.punts > 0) {
    if (totals.punts > 1) {
      const avg = totals.puntYds / totals.punts;
      const avgText = Number.isInteger(avg) ? `${avg}` : avg.toFixed(1);
      parts.push(`${totals.punts} Punts - ${avgText} Yards Avg`);
    } else {
      parts.push('1 Punt');
    }
  }
  if (totals.xpAtt > 0) parts.push(`${totals.xpMade}/${totals.xpAtt} XP`);
  if (totals.fgAtt > 0) {
    const fgParts = [`${totals.fgMade}/${totals.fgAtt} FG`];
    if (totals.fgMissed > 0) fgParts.push(`${totals.fgMissed} Miss`);
    parts.push(fgParts.join(' - '));
  }
  return parts.length > 0 ? [parts.join(' - ')] : [];
}

export function formatKickerStatLinesFromRow(row: ApiPlayerGameStats): string[] {
  return formatKickerStatLines(totalsFromPlayerRow(row));
}

export function formatQuarterbackStatLines(totals: RunningPlayerTotals): string[] {
  const lines: string[] = [];
  if (totals.passAtt > 0)
    lines.push(`${totals.passComp}/${totals.passAtt} Passing - ${totals.passYds} Yards`);
  if (totals.rushAtt > 0) lines.push(`${totals.rushAtt} Rush - ${totals.rushYds} Yards`);
  const scoring: string[] = [];
  if (totals.passTd > 0) scoring.push(`${totals.passTd} Pass TD`);
  if (totals.rushTd > 0) scoring.push(`${totals.rushTd} Rush TD`);
  if (scoring.length > 0) lines.push(scoring.join(' - '));
  const misc: string[] = [];
  if (totals.passInt > 0) misc.push(`${totals.passInt} INT`);
  if (totals.fumblesLost > 0) misc.push(`${totals.fumblesLost} FUM`);
  if (totals.sacks > 0) misc.push(`${totals.sacks} Sacks`);
  if (misc.length > 0) lines.push(misc.join(' - '));
  return lines;
}

export function formatQuarterbackStatLinesFromRow(row: ApiPlayerGameStats): string[] {
  return formatQuarterbackStatLines(totalsFromPlayerRow(row));
}

export function formatPassingLeaderLineFromTotals(totals: RunningPlayerTotals): string {
  const parts = [`${totals.passComp}/${totals.passAtt}`, `${totals.passYds} YDS`];
  if (totals.passTd > 0) parts.push(`${totals.passTd} TD`);
  if (totals.passInt > 0) parts.push(`${totals.passInt} INT`);
  return parts.join(' · ');
}

export function formatRushingLeaderLineFromTotals(totals: RunningPlayerTotals): string {
  const parts = [`${totals.rushAtt} CAR`, `${totals.rushYds} YDS`];
  if (totals.rushTd > 0) parts.push(`${totals.rushTd} TD`);
  return parts.join(' · ');
}

export function formatReceivingLeaderLineFromTotals(totals: RunningPlayerTotals): string {
  const parts = [`${totals.rec} REC`, `${totals.recYds} YDS`];
  if (totals.recTd > 0) parts.push(`${totals.recTd} TD`);
  return parts.join(' · ');
}

// ─── Fantasy points ──────────────────────────────────────────────────────────

/**
 * Map a boxscore player row into a RunningPlayerTotals object.
 * Used when a frame falls back to boxscore data instead of play-derived totals.
 */
export function totalsFromPlayerRow(player: ApiPlayerGameStats): RunningPlayerTotals {
  const fgAtt = safeInt(player.fg_attempts);
  const fgMade = safeInt(player.fg_made);
  return {
    passAtt: safeInt(player.pass_attempts),
    passComp: safeInt(player.completions),
    passYds: safeInt(player.passing_yards),
    passTd: safeInt(player.passing_tds),
    passInt: safeInt(player.interceptions_thrown),
    rushAtt: safeInt(player.carries),
    rushYds: safeInt(player.rushing_yards),
    rushTd: safeInt(player.rushing_tds),
    rec: safeInt(player.receptions),
    recYds: safeInt(player.receiving_yards),
    recTd: safeInt(player.receiving_tds),
    fgAtt,
    fgMade,
    fgMade0to39: fgMade, // boxscore rows don't have tier breakdown; assume all ≤39
    fgMade40to49: 0,
    fgMade50to59: 0,
    fgMade60plus: 0,
    fgMissed: Math.max(0, fgAtt - fgMade),
    punts: 0,
    puntYds: 0,
    xpAtt: safeInt(player.pat_attempts),
    xpMade: safeInt(player.pat_made),
    fumblesLost: safeInt(player.rushing_fumbles_lost) + safeInt(player.receiving_fumbles_lost),
    sacks: safeInt(player.sacks_made),
  };
}

export function kickerFantasyPointsFromTotals(totals: RunningPlayerTotals): number {
  const tieredFgPoints =
    totals.fgMade0to39 * 3 +
    totals.fgMade40to49 * 4 +
    totals.fgMade50to59 * 5 +
    totals.fgMade60plus * 6;
  const fgPoints = tieredFgPoints > 0 ? tieredFgPoints : totals.fgMade * 3;
  return fgPoints + totals.xpMade + totals.fgMissed * -1;
}

export function fantasyPointsByScoringFromTotals(totals: RunningPlayerTotals): {
  ppr: number;
  halfPpr: number;
  standard: number;
} {
  const pass = totals.passYds / 25 + totals.passTd * 4 - totals.passInt * 2;
  const rush = totals.rushYds / 10 + totals.rushTd * 6;
  const recBase = totals.recYds / 10 + totals.recTd * 6;
  const kicking = kickerFantasyPointsFromTotals(totals);
  const fumbles = totals.fumblesLost * -2;
  const standard = pass + rush + recBase + kicking + fumbles;
  return {
    ppr: standard + totals.rec,
    halfPpr: standard + totals.rec * 0.5,
    standard,
  };
}

export function fantasyBreakdownFromTotals(totals: RunningPlayerTotals): string {
  const lines: string[] = [];
  if (totals.passAtt > 0) {
    const passParts = [`${totals.passComp}/${totals.passAtt}`, `${totals.passYds} YDS`];
    if (totals.passTd > 0) passParts.push(`${totals.passTd} TD`);
    if (totals.passInt > 0) passParts.push(`${totals.passInt} INT`);
    lines.push(`PASS ${passParts.join(', ')}`);
  }
  if (totals.rushAtt > 0) {
    const rushParts = [`${totals.rushAtt} CAR`, `${totals.rushYds} YDS`];
    if (totals.rushTd > 0) rushParts.push(`${totals.rushTd} TD`);
    lines.push(`RUSH ${rushParts.join(', ')}`);
  }
  if (totals.rec > 0) {
    const recParts = [`${totals.rec} REC`, `${totals.recYds} YDS`];
    if (totals.recTd > 0) recParts.push(`${totals.recTd} TD`);
    lines.push(`REC ${recParts.join(', ')}`);
  }
  if (totals.xpAtt > 0 || totals.fgAtt > 0) {
    const kickParts: string[] = [];
    if (totals.xpAtt > 0) kickParts.push(`XP ${totals.xpMade}/${totals.xpAtt}`);
    if (totals.fgAtt > 0) {
      const fgParts = [`FG ${totals.fgMade}/${totals.fgAtt}`];
      if (totals.fgMissed > 0) fgParts.push(`${totals.fgMissed} MISS`);
      kickParts.push(fgParts.join(', '));
    }
    lines.push(`KICK ${kickParts.join(', ')}`);
  }
  if (totals.fumblesLost > 0) {
    lines.push(`MISC ${totals.fumblesLost} FL`);
  }
  return lines.length > 0 ? lines.join('\n') : 'No stats yet';
}

// ─── updateRunningTotalsFromPlay ─────────────────────────────────────────────

/**
 * Applies one play to running per-player totals (for frame-by-frame replay).
 *
 * Rules:
 * - No passing credit on interception plays
 * - No offensive TD credit on turnover-return scores
 * - Sack is charged to the passer's totals (not a rush attempt)
 * - FG distance tiers are derived from kick_distance when available
 */
export function updateRunningTotalsFromPlay(
  play: ApiPlayDetail,
  totalsByKey: Map<string, RunningPlayerTotals>,
  metaByFullKey: Map<string, RunningPlayerMeta>
): void {
  const type = resolveAnimType(play);
  if (!type) return;

  const text = compactPlayText(play);
  const actionText = primaryActionText(text);
  const rawYards = safeInt(play.yards_gained, 0);
  const offenseTeam = normalizeAbbr(play.possession_team_abbr);
  if (!offenseTeam) return;
  const rawPlayType = (play.play_type ?? '').toLowerCase();
  const isNoPlay = rawPlayType === 'no_play' || /\bno play\b/i.test(text);
  const playTouchdown =
    Boolean(play.touchdown) ||
    ((/\b(?:touchdown|td)\b/i.test(actionText) ||
      (play.is_scoring_play &&
        (rawPlayType === 'pass' || rawPlayType === 'run' || rawPlayType === 'rush'))) &&
      !/\btouchdown\s+nullified\b/i.test(actionText) &&
      !isNoPlay);
  const offensiveTouchdown = playTouchdown && !isTurnoverPlay(play);

  // ── Parse yards from action text, falling back to yards_gained ──
  const parseActionYards = (source: string, mode: 'pass' | 'rush'): number | null => {
    const sentence = actionSentences(source).find((part) => {
      const normalized = normalizeActionSentence(part);
      if (mode === 'pass') return /\b(pass|sacked|scramble|incomplete)\b/i.test(normalized);
      return /\b(up the|left|right|guard|tackle|end|rush|scramble|kneel)\b/i.test(normalized);
    });
    const scoped = normalizeActionSentence(sentence ?? source);
    if (/incomplete/i.test(scoped)) return 0;
    const byText = scoped.match(/\bfor\s+(-?\d+)\s+yards?\b/i);
    if (byText?.[1]) {
      const parsed = Number.parseInt(byText[1], 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  };

  const inferredPassYards = parseActionYards(actionText, 'pass');
  const inferredRushYards = parseActionYards(actionText, 'rush');
  const passYards = rawYards !== 0 ? rawYards : (inferredPassYards ?? rawYards);
  const rushYards = rawYards !== 0 ? rawYards : (inferredRushYards ?? rawYards);
  const passLike =
    type === 'pass' ||
    rawPlayType === 'pass' ||
    Boolean(play.sack) ||
    /\b(pass|intercept)\b/i.test(text);
  const rushLike =
    type === 'rush' ||
    rawPlayType === 'run' ||
    rawPlayType === 'rush' ||
    rawPlayType === 'qb_kneel' ||
    rawPlayType === 'qb_scramble' ||
    /\bscramble\b/i.test(text);

  if (passLike) {
    const passer = play.passer_player_name?.trim() || extractPrimaryBallCarrier(actionText, 'pass');
    if (passer) {
      updateRunningPlayerTotals(
        passer,
        (totals) => {
          const isSack = Boolean(play.sack) || /\bsacked\b/i.test(actionText);
          const isIncomplete = /\bincomplete\b/i.test(actionText);
          if (isSack) totals.sacks += 1;
          if (!isSack) totals.passAtt += 1;
          const isComp =
            !isSack &&
            !isIncomplete &&
            !play.interception &&
            Boolean(play.complete_pass || passYards !== 0 || offensiveTouchdown);
          if (isComp) {
            totals.passComp += 1;
            totals.passYds += passYards;
            if (offensiveTouchdown) totals.passTd += 1;
          }
          if (play.interception) totals.passInt += 1;
          if (play.fumble_lost && (!isComp || isSack)) totals.fumblesLost += 1;
        },
        totalsByKey,
        offenseTeam,
        metaByFullKey,
        'QB'
      );
    }

    const receiver = play.receiver_player_name?.trim() || extractNameAfterTo(actionText);
    if (receiver) {
      const isSack = Boolean(play.sack) || /\bsacked\b/i.test(actionText);
      const isIncomplete = /\bincomplete\b/i.test(actionText);
      const isComp =
        !isSack &&
        !isIncomplete &&
        !play.interception &&
        Boolean(play.complete_pass || passYards !== 0 || offensiveTouchdown);
      if (isComp) {
        updateRunningPlayerTotals(
          receiver,
          (totals) => {
            totals.rec += 1;
            totals.recYds += passYards;
            if (offensiveTouchdown) totals.recTd += 1;
            if (play.fumble_lost) totals.fumblesLost += 1;
          },
          totalsByKey,
          offenseTeam,
          metaByFullKey
        );
      }
    }
  }

  if (rushLike) {
    const rusher = play.rusher_player_name?.trim() || extractPrimaryBallCarrier(actionText, 'rush');
    if (rusher) {
      updateRunningPlayerTotals(
        rusher,
        (totals) => {
          totals.rushAtt += 1;
          totals.rushYds += rushYards;
          if (offensiveTouchdown) totals.rushTd += 1;
          if (play.fumble_lost) totals.fumblesLost += 1;
        },
        totalsByKey,
        offenseTeam,
        metaByFullKey
      );
    }
  }

  const hasExtraPointTry = rawPlayType === 'extra_point' || /\bextra point\b/i.test(text);
  const hasFieldGoalTry = rawPlayType === 'field_goal' || /\bfield goal\b/i.test(text);
  const hasPuntPlay = rawPlayType === 'punt' || /\bpunts?\b/i.test(text);
  if (hasPuntPlay) {
    const kickSentence =
      actionSentences(actionText).find((sentence) => /\bpunts?\b/i.test(sentence)) ?? actionText;
    const punterName = extractPrimaryBallCarrier(kickSentence);
    const puntDistanceMatch = kickSentence.match(/\bpunts?\s+(\d+)\s+yards?\b/i);
    const puntDistance =
      puntDistanceMatch?.[1] != null
        ? Number.parseInt(puntDistanceMatch[1], 10)
        : play.kick_distance != null
          ? safeInt(play.kick_distance, 0)
          : 0;
    if (punterName && Number.isFinite(puntDistance)) {
      updateRunningPlayerTotals(
        punterName,
        (totals) => {
          totals.punts += 1;
          totals.puntYds += Math.max(0, puntDistance);
        },
        totalsByKey,
        offenseTeam,
        metaByFullKey
      );
    }
  }
  if (hasExtraPointTry || hasFieldGoalTry) {
    const kicker = extractKickerName(text);
    if (kicker) {
      const kickResult = resolveFieldGoalResult(play);
      const extraPointMade =
        hasExtraPointTry &&
        /\bextra point\b/i.test(text) &&
        /\b(is good|good)\b/i.test(text) &&
        !/\b(no good|missed|blocked|failed)\b/i.test(text);
      const fieldGoalMade =
        hasFieldGoalTry &&
        (kickResult === 'made' ||
          (/\bfield goal\b/i.test(text) &&
            /\b(is good|good)\b/i.test(text) &&
            !/\b(no good|missed|blocked|failed|wide|short)\b/i.test(text)));
      updateRunningPlayerTotals(
        kicker,
        (totals) => {
          if (hasExtraPointTry) {
            totals.xpAtt += 1;
            if (extraPointMade) totals.xpMade += 1;
          }
          if (hasFieldGoalTry) {
            totals.fgAtt += 1;
            if (fieldGoalMade) {
              totals.fgMade += 1;
              const distance = parseFieldGoalDistance(play, text);
              if (distance != null) {
                if (distance >= 60) totals.fgMade60plus += 1;
                else if (distance >= 50) totals.fgMade50to59 += 1;
                else if (distance >= 40) totals.fgMade40to49 += 1;
                else totals.fgMade0to39 += 1;
              } else {
                totals.fgMade0to39 += 1;
              }
            } else {
              totals.fgMissed += 1;
            }
          }
        },
        totalsByKey,
        offenseTeam,
        metaByFullKey,
        'K'
      );
    }
  }
}

// ─── toPlayAnimation ─────────────────────────────────────────────────────────

function formatYardPlaySummary(yards: number, noun: string): string {
  const abs = Math.abs(yards);
  const prefix = yards < 0 ? '-' : '';
  return `${prefix}${abs} Yard ${noun}`;
}

type ActorInfo = {
  name: string;
  gsisId?: string;
  line?: string;
  summary?: string;
  lines?: string[];
  previousLines?: string[];
  headshotUrl?: string;
};

/**
 * Convert a raw play + context into the full `PlayAnimationData` payload that
 * the SVG field renderer needs. This is the main per-play transformation.
 *
 * @param play               - the play to transform
 * @param nextSnapPlay       - the next snap play (used for post-play position)
 * @param awayAbbr           - away team abbreviation
 * @param homeAbbr           - home team abbreviation
 * @param playerStatsLookup  - boxscore player lookup built by buildPlayerGameStatsLookup
 * @param runningTotalsLookup       - per-player stats as-of this play
 * @param runningTotalsBeforeLookup - per-player stats before this play (for delta display)
 */
export function toPlayAnimation(
  play: ApiPlayDetail,
  nextSnapPlay: ApiPlayDetail | undefined,
  awayAbbr: string,
  homeAbbr: string,
  playerStatsLookup: Map<string, ApiPlayerGameStats>,
  runningTotalsLookup: Map<string, RunningPlayerTotals>,
  runningTotalsBeforeLookup: Map<string, RunningPlayerTotals>,
  headshotsByName?: Map<string, string>
): PlayAnimationData | null {
  const type = resolveAnimType(play);
  if (!type) return null;

  const rawPlayType = (play.play_type ?? '').toLowerCase();
  const text = compactPlayText(play);
  const actionText = primaryActionText(text);
  const inferredTouchdown =
    (/\b(?:touchdown|td)\b/i.test(actionText) ||
      (play.is_scoring_play && (type === 'pass' || type === 'rush' || type === 'turnover'))) &&
    !/\btouchdown\s+nullified\b/i.test(actionText) &&
    !/\bno play\b/i.test(actionText);

  const possBefore = normalizeAbbr(play.possession_team_abbr) || awayAbbr;
  const possAfter = resolvePossessionAfter(play, nextSnapPlay, awayAbbr, homeAbbr);

  let from = yardline100ToDisplay(play.yard_line, possBefore, awayAbbr, homeAbbr);
  let to = yardline100ToDisplay(
    resolveYardlineAfter(play, nextSnapPlay),
    possAfter,
    awayAbbr,
    homeAbbr
  );
  let yards = resolveActionYards(play, type, text);

  let actorName: string | null = null;
  let actorSummary: string | undefined;
  let qbName: string | null = null;
  let qbSummary: string | undefined;
  let kickerActor: ActorInfo | null = null;
  let kickLanding: ParsedDisplaySpot | undefined;
  let turnoverSpot: ParsedDisplaySpot | undefined;
  const penalty = parsePenaltyDetails(play, awayAbbr, homeAbbr);
  let penaltyAdjusted: ParsedDisplaySpot | undefined;
  let postScoreTry: {
    kind: 'two_point' | 'extra_point';
    playType: 'pass' | 'rush' | 'kick';
    direction: 'left' | 'middle' | 'right';
    isGood: boolean;
    from: ParsedDisplaySpot;
    to: ParsedDisplaySpot;
    qbActor: ActorInfo | null;
    actor: ActorInfo | null;
  } | null = null;

  const linesEqual = (left?: string[], right?: string[]): boolean => {
    if (!left && !right) return true;
    if (!left || !right) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  };

  const buildActorInfo = (
    name: string,
    summary?: string,
    forceQuarterback = false,
    forceKicker = false
  ): ActorInfo | null => {
    const statsRow = playerStatsRowForPlayer(name, playerStatsLookup);
    const afterTotals = runningTotalsForPlayer(name, runningTotalsLookup);
    const beforeTotals = runningTotalsForPlayer(name, runningTotalsBeforeLookup);
    const isQuarterback = forceQuarterback || normalizeAbbr(statsRow?.player_position) === 'QB';
    const isKicker =
      forceKicker ||
      normalizeAbbr(statsRow?.player_position) === 'K' ||
      (afterTotals?.fgAtt ?? 0) + (afterTotals?.xpAtt ?? 0) > 0 ||
      (beforeTotals?.fgAtt ?? 0) + (beforeTotals?.xpAtt ?? 0) > 0;

    let afterLines: string[] | undefined;
    let beforeLines: string[] | undefined;

    if (isKicker) {
      afterLines = afterTotals
        ? formatKickerStatLines(afterTotals)
        : statsRow
          ? formatKickerStatLinesFromRow(statsRow)
          : undefined;
      beforeLines = beforeTotals ? formatKickerStatLines(beforeTotals) : undefined;
    } else if (isQuarterback) {
      afterLines = afterTotals
        ? formatQuarterbackStatLines(afterTotals)
        : statsRow
          ? formatQuarterbackStatLinesFromRow(statsRow)
          : undefined;
      beforeLines = beforeTotals ? formatQuarterbackStatLines(beforeTotals) : undefined;
    } else {
      afterLines = afterTotals
        ? formatActorStatLines(afterTotals)
        : statsRow
          ? formatActorStatLinesFromRow(statsRow)
          : undefined;
      beforeLines = beforeTotals ? formatActorStatLines(beforeTotals) : undefined;
    }

    if (afterLines?.length === 0) afterLines = undefined;
    if (beforeLines?.length === 0) beforeLines = undefined;

    return {
      name,
      gsisId: statsRow?.player_gsis_id?.trim() || undefined,
      line: afterLines?.[0],
      summary,
      lines: afterLines,
      previousLines: linesEqual(beforeLines, afterLines) ? undefined : beforeLines,
      headshotUrl:
        statsRow?.player_headshot?.trim() ||
        lookupHeadshotByName(name, headshotsByName) ||
        undefined,
    };
  };

  // ── Recalculate "to" for pass/rush using yards + inferredTouchdown ──
  if (type === 'pass' || type === 'rush') {
    const startSide = from.side || possBefore;
    const fromPct = yardToFieldPct(from.yardLine, startSide, awayAbbr);
    const offenseDir = possBefore === awayAbbr ? 1 : -1;
    const projectedPct = inferredTouchdown
      ? offenseDir === 1
        ? 100
        : 0
      : fromPct + offenseDir * yards;
    to = fieldPctToDisplaySpot(projectedPct, awayAbbr, homeAbbr);
  }

  if (type === 'pass') {
    const passLooksLikeSack = /\bsacked\b/i.test(actionText) || Boolean(play.sack);
    const passLooksIncomplete = /\bincomplete\b/i.test(actionText);
    const passComplete =
      !passLooksLikeSack &&
      !passLooksIncomplete &&
      (Boolean(play.complete_pass) || yards !== 0 || inferredTouchdown);
    const passIsTouchdown = passComplete && (inferredTouchdown || Boolean(play.touchdown));

    qbName = extractPrimaryBallCarrier(actionText, 'pass') ?? null;
    if (qbName) {
      if (passLooksLikeSack) qbSummary = formatYardPlaySummary(yards, 'Sack');
      else if (passComplete)
        qbSummary = formatYardPlaySummary(yards, passIsTouchdown ? 'TD Pass' : 'Pass');
      else qbSummary = 'Incomplete Pass';
    }

    actorName = extractNameAfterTo(actionText) ?? null;
    if (actorName && passComplete && !passLooksLikeSack) {
      actorSummary = formatYardPlaySummary(yards, passIsTouchdown ? 'TD Catch' : 'Catch');
    } else {
      actorName = null;
    }
  }

  if (type === 'rush') {
    actorName = extractPrimaryBallCarrier(actionText, 'rush') ?? null;
    const isKneelDown =
      rawPlayType === 'qb_kneel' || /\bkneels?\b|\bkneel\s+down\b/i.test(actionText);
    if (actorName) actorSummary = isKneelDown ? 'Kneel Down' : formatYardPlaySummary(yards, 'Rush');
  }

  if (type === 'kick') {
    const kick = parseKickDetails(play, awayAbbr, homeAbbr);
    const kickSentence =
      actionSentences(actionText).find((sentence) => /\b(?:kicks?|punts?)\b/i.test(sentence)) ??
      actionText;
    const kickerName = extractPrimaryBallCarrier(kickSentence) ?? null;
    if (kickerName) {
      const kickDistance =
        play.kick_distance != null ? safeInt(play.kick_distance) : (kick.kickYards ?? null);
      const kickSummary =
        /\bpunts?\b/i.test(kickSentence) && kickDistance != null && kickDistance > 0
          ? formatYardPlaySummary(kickDistance, 'Punt')
          : /\bpunts?\b/i.test(kickSentence)
            ? 'Punt'
            : 'Kick';
      kickerActor = buildActorInfo(kickerName, kickSummary, false, true);
    }
    if (kick.start) {
      from = kick.start;
    } else if (rawPlayType === 'kickoff') {
      // For kickoffs in ESPN data, possBefore = the RECEIVING team (not the kicker).
      // The kicker is always on the other team, kicking from their own 35-yard line.
      const kickingTeam = possBefore === awayAbbr ? homeAbbr : awayAbbr;
      from = { side: kickingTeam, yardLine: 35 };
    } else if (kick.landing) {
      // Derive kick start from landing spot + kick distance.
      // This is more reliable than play.yard_line which some data sources
      // (e.g. ESPN) store as "yards from own endzone" rather than the nflverse
      // "yards from opponent's endzone" convention that yardline100ToDisplay expects.
      // Use the explicit kick_distance field if present, otherwise fall back to
      // the yards extracted from the play text (ESPN games omit kick_distance).
      const kickDist =
        play.kick_distance != null ? safeInt(play.kick_distance) : (kick.kickYards ?? null);
      if (kickDist != null && kickDist > 0) {
        const offenseDir = possBefore === awayAbbr ? 1 : -1;
        const landingPct = displaySpotToFieldPct(kick.landing, awayAbbr);
        from = fieldPctToDisplaySpot(landingPct - offenseDir * kickDist, awayAbbr, homeAbbr);
      }
    }
    if (kick.returnSpot) to = kick.returnSpot;
    else if (kick.landing) to = kick.landing;
    if (kick.landing) kickLanding = kick.landing;
    if (kick.returner) {
      actorName = kick.returner;
      let retYards = kick.returnYards;
      if (retYards == null && kick.returnSpot && kick.landing) {
        retYards = Math.abs(
          Math.round(
            displaySpotToFieldPct(kick.returnSpot, awayAbbr) -
              displaySpotToFieldPct(kick.landing, awayAbbr)
          )
        );
      }
      yards = retYards ?? 0;
      actorSummary = formatYardPlaySummary(yards, 'Return');
    } else if (kick.returnSpot && kick.landing) {
      yards = Math.abs(
        Math.round(
          displaySpotToFieldPct(kick.returnSpot, awayAbbr) -
            displaySpotToFieldPct(kick.landing, awayAbbr)
        )
      );
    } else {
      actorName = null;
    }
  }

  if (type === 'fieldgoal') {
    const kicker = extractKickerName(text);
    if (kicker) {
      actorName = kicker;
      const isExtraPoint =
        (play.play_type ?? '').toLowerCase() === 'extra_point' || /\bextra point\b/i.test(text);
      const result = resolveFieldGoalResult(play);
      const isGood = result === 'made';
      if (isExtraPoint) {
        actorSummary = isGood ? 'XP GOOD' : 'XP NO GOOD';
      } else {
        const distance = play.kick_distance != null ? safeInt(play.kick_distance) : null;
        actorSummary =
          distance != null
            ? `${distance} Yard FG ${isGood ? 'GOOD' : 'NO GOOD'}`
            : isGood
              ? 'FG GOOD'
              : 'FG NO GOOD';
      }
    }
  }

  if (type === 'turnover') {
    const returnTeam = getOpponent(possBefore, awayAbbr, homeAbbr);
    const turnover = parseTurnoverDetails(play, awayAbbr, homeAbbr, returnTeam);
    if (turnover.takeawaySpot) turnoverSpot = turnover.takeawaySpot;
    if (turnover.returnSpot) to = turnover.returnSpot;
    else if (turnover.takeawaySpot) to = turnover.takeawaySpot;
    if (turnover.returner) {
      actorName = turnover.returner;
      actorSummary = formatYardPlaySummary(turnover.returnYards ?? yards, 'Return');
    }
    // Keep QB context on passing turnovers for the nearby QB stat popup.
    if (/\bpass|sacked\b/i.test(actionText) || (play.play_type ?? '').toLowerCase() === 'pass') {
      qbName = extractPrimaryBallCarrier(actionText, 'pass') ?? null;
      if (qbName) qbSummary = /intercept/i.test(text) ? 'Interception' : 'Turnover';
    }
  }

  if (penalty && (penalty.yards ?? 0) > 0) {
    const offenseDir = possBefore === awayAbbr ? 1 : -1;
    const isOffensePenalty = penalty.team === possBefore;
    const adjustmentDir = isOffensePenalty ? -offenseDir : offenseDir;
    // Determine the enforcement base spot:
    //   • Explicit "enforced at" spot in the play text → use that.
    //   • No-play penalty (play is nullified, e.g. offensive holding) → enforce
    //     from the line of scrimmage (previous spot). Ball returns to snap spot ± yards.
    //   • Play stands / tack-on (e.g. defensive personal foul after a completed run)
    //     → enforce from the end of the play.
    let basePct: number;
    if (penalty.enforcedSpot) {
      basePct = yardToFieldPct(
        penalty.enforcedSpot.yardLine,
        penalty.enforcedSpot.side ?? possBefore,
        awayAbbr
      );
    } else if (penalty.isNoPlay) {
      const fromSide = from.side || possBefore;
      basePct = yardToFieldPct(from.yardLine, fromSide, awayAbbr);
    } else {
      const endSide = to.side || possAfter;
      basePct = yardToFieldPct(to.yardLine, endSide, awayAbbr);
    }
    penaltyAdjusted = fieldPctToDisplaySpot(
      basePct + adjustmentDir * safeInt(penalty.yards, 0),
      awayAbbr,
      homeAbbr
    );
  }

  // ── Post-score try (2PT / XP) as a second animation phase ──
  const hasTwoPointTry = /two-point conversion attempt/i.test(text);
  const hasExtraPointTry = /extra point/i.test(text);
  if (hasTwoPointTry || hasExtraPointTry) {
    const offenseDir = possBefore === awayAbbr ? 1 : -1;
    const tryKind: 'two_point' | 'extra_point' = hasTwoPointTry ? 'two_point' : 'extra_point';
    const defaultTrySpot = tryKind === 'two_point' ? 2 : 15;
    let tryFrom = fieldPctToDisplaySpot(
      offenseDir === 1 ? 100 - defaultTrySpot : defaultTrySpot,
      awayAbbr,
      homeAbbr
    );
    if (penalty?.enforcedSpot) tryFrom = penalty.enforcedSpot;
    const tryTo = fieldPctToDisplaySpot(offenseDir === 1 ? 100 : 0, awayAbbr, homeAbbr);

    if (tryKind === 'extra_point') {
      const isGood =
        /\bextra point\b/i.test(text) &&
        /\b(is good|good)\b/i.test(text) &&
        !/\b(no good|missed|blocked|failed)\b/i.test(text);
      const kicker = extractKickerName(text);
      postScoreTry = {
        kind: tryKind,
        playType: 'kick',
        direction: 'middle',
        isGood,
        from: tryFrom,
        to: tryTo,
        qbActor: null,
        actor: kicker
          ? buildActorInfo(kicker, isGood ? 'XP GOOD' : 'XP NO GOOD', false, true)
          : null,
      };
    } else {
      let attemptText = (text.split(/two-point conversion attempt\.?/i)[1] ?? '').trim();
      attemptText = attemptText.split(/\*\*|injury update|penalty on/i)[0]?.trim() ?? '';
      const attempt = attemptText || text;

      const isPassTry = /\bpass\b/i.test(attempt);
      const isRushTry = /\b(up the|left|right|rush|scramble)\b/i.test(attempt) && !isPassTry;
      const tryPlayType: 'pass' | 'rush' = isPassTry ? 'pass' : isRushTry ? 'rush' : 'pass';
      const tryDirection = resolveDirectionFromText(attempt);
      const tryIsGood =
        !/(incomplete|attempt fails|fails|failed|no good|intercepted|stopped|short of)/i.test(
          attempt
        );
      const tryQbName =
        extractPrimaryBallCarrier(attempt, tryPlayType === 'pass' ? 'pass' : 'rush') ??
        extractPrimaryBallCarrier(actionText, 'pass') ??
        null;
      const tryActorName =
        tryPlayType === 'pass'
          ? extractNameAfterTo(attempt)
          : extractPrimaryBallCarrier(attempt, 'rush');
      const tryQbSummary =
        tryPlayType === 'pass'
          ? tryIsGood
            ? '2PT Pass'
            : '2PT Attempt'
          : tryIsGood
            ? '2PT Rush'
            : '2PT Attempt';
      const tryActorSummary =
        tryPlayType === 'pass'
          ? tryIsGood
            ? '2PT Catch'
            : 'Targeted'
          : tryIsGood
            ? '2PT Rush'
            : '2PT Rush';

      postScoreTry = {
        kind: tryKind,
        playType: tryPlayType,
        direction: tryDirection,
        isGood: tryIsGood,
        from: tryFrom,
        to: tryTo,
        qbActor: tryQbName ? buildActorInfo(tryQbName, tryQbSummary, true) : null,
        actor: tryActorName ? buildActorInfo(tryActorName, tryActorSummary, false) : null,
      };
    }
  }

  const actorInfo = actorName ? buildActorInfo(actorName, actorSummary, false) : null;
  const qbInfo = qbName ? buildActorInfo(qbName, qbSummary, true) : null;
  const kickerInfo = type === 'kick' ? kickerActor : null;
  const startDown = safeInt(play.down, 0);
  const startDistance = Math.max(0, safeInt(play.distance, 0));
  const isNoPlay = penalty?.isNoPlay || (play.play_type ?? '').toLowerCase() === 'no_play';
  const offenseDir = possBefore === awayAbbr ? 1 : -1;
  const fromPct = yardToFieldPct(from.yardLine, from.side || possBefore, awayAbbr);
  const toPct = yardToFieldPct(to.yardLine, to.side || possAfter, awayAbbr);
  const spotGainYards = Math.max(0, Math.round((toPct - fromPct) * offenseDir));
  const inferredFirstDownByGain =
    (type === 'pass' || type === 'rush') &&
    startDown > 0 &&
    startDistance > 0 &&
    !isNoPlay &&
    !isTurnoverPlay(play) &&
    !inferredTouchdown &&
    Math.max(spotGainYards, yards) >= startDistance;
  const inferredFirstDownByNextSnap =
    (type === 'pass' || type === 'rush') &&
    startDown > 0 &&
    !isNoPlay &&
    !isTurnoverPlay(play) &&
    !inferredTouchdown &&
    normalizeAbbr(nextSnapPlay?.possession_team_abbr) === possBefore &&
    safeInt(nextSnapPlay?.down, 0) === 1;
  const resolvedFirstDown = Boolean(
    play.first_down ||
      play.end_down === 1 ||
      inferredFirstDownByGain ||
      inferredFirstDownByNextSnap
  );

  return {
    type,
    offenseTeam: possBefore,
    startDown: startDown || undefined,
    startDistance,
    direction: resolveDirection(play),
    fromYardline: from.yardLine,
    fromSide: from.side || possBefore,
    toYardline: to.yardLine,
    toSide: to.side || possAfter,
    yardsGained: yards,
    airYards: play.air_yards == null ? undefined : safeNumber(play.air_yards),
    isComplete:
      type !== 'pass'
        ? true
        : !/\bsacked\b/i.test(actionText) &&
          !/\bincomplete\b/i.test(actionText) &&
          (Boolean(play.complete_pass) || yards > 0 || inferredTouchdown),
    isFirstDown: resolvedFirstDown,
    isTurnover: isTurnoverPlay(play),
    turnoverBy: isTurnoverPlay(play) ? getOpponent(possBefore, awayAbbr, homeAbbr) : undefined,
    turnoverSpotYardline: turnoverSpot?.yardLine,
    turnoverSpotSide: turnoverSpot?.side,
    receiver: null,
    actor: actorInfo ? { ...actorInfo } : null,
    qbActor: kickerInfo ? { ...kickerInfo } : qbInfo ? { ...qbInfo } : null,
    kickLandingYardline: kickLanding?.yardLine,
    kickLandingSide: kickLanding?.side,
    fgResult: resolveFieldGoalResult(play),
    fgDistance: play.kick_distance == null ? undefined : safeInt(play.kick_distance),
    isTouchdown: inferredTouchdown || Boolean(play.touchdown),
    isSafety:
      /\bsafety\b/i.test(play.description) &&
      !/(extra point|point after|safety kick)/i.test(play.description),
    penaltyTeam: penalty?.team,
    penaltyType: penalty?.kind,
    penaltyPlayer: penalty?.player,
    penaltyYards: penalty?.yards,
    penaltyEnforcedYardline: penalty?.enforcedSpot?.yardLine,
    penaltyEnforcedSide: penalty?.enforcedSpot?.side,
    penaltyAdjustedYardline: penaltyAdjusted?.yardLine,
    penaltyAdjustedSide: penaltyAdjusted?.side,
    isNoPlay,
    postScoreTryMiss:
      /(two-point conversion attempt|extra point)/i.test(text) &&
      /(attempt fails|is incomplete|fails|no good|missed|blocked)/i.test(text),
    postScoreTryKind: postScoreTry?.kind,
    postScoreTryPlayType: postScoreTry?.playType,
    postScoreTryDirection: postScoreTry?.direction,
    postScoreTryIsGood: postScoreTry?.isGood,
    postScoreTryFromYardline: postScoreTry?.from.yardLine,
    postScoreTryFromSide: postScoreTry?.from.side,
    postScoreTryToYardline: postScoreTry?.to.yardLine,
    postScoreTryToSide: postScoreTry?.to.side,
    postScoreTryActor: postScoreTry?.actor ?? null,
    postScoreTryQbActor: postScoreTry?.qbActor ?? null,
    description: play.description || play.short_description,
  };
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

// ─── Leader display helpers ───────────────────────────────────────────────────

/** Sentinel used when a stat category has no leader yet. */
export const FALLBACK_LEADER = { name: '—', line: '—' } as const;

/**
 * Format a passing stat line from a boxscore player row.
 * Use `formatPassingLeaderLineFromTotals` when you have running totals instead.
 */
export function formatPassingLeaderLine(row: ApiPlayerGameStats): string {
  const comp = safeInt(row.completions);
  const att = safeInt(row.pass_attempts);
  const yds = safeInt(row.passing_yards);
  const td = safeInt(row.passing_tds);
  const ints = safeInt(row.interceptions_thrown);
  const parts = [`${comp}/${att}`, `${yds} YDS`];
  if (td > 0) parts.push(`${td} TD`);
  if (ints > 0) parts.push(`${ints} INT`);
  return parts.join(' · ');
}

/** Format a rushing stat line from a boxscore player row. */
export function formatRushingLeaderLine(row: ApiPlayerGameStats): string {
  const car = safeInt(row.carries);
  const yds = safeInt(row.rushing_yards);
  const td = safeInt(row.rushing_tds);
  const parts = [`${car} CAR`, `${yds} YDS`];
  if (td > 0) parts.push(`${td} TD`);
  return parts.join(' · ');
}

/** Format a receiving stat line from a boxscore player row. */
export function formatReceivingLeaderLine(row: ApiPlayerGameStats): string {
  const rec = safeInt(row.receptions);
  const yds = safeInt(row.receiving_yards);
  const td = safeInt(row.receiving_tds);
  const parts = [`${rec} REC`, `${yds} YDS`];
  if (td > 0) parts.push(`${td} TD`);
  return parts.join(' · ');
}
