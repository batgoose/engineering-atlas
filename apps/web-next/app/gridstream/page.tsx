'use client';

/**
 * Route: /gridstream?game={id}[&play={index|start|live|end}][&play_seq={sequence}]
 *
 * Hydrates the live view from multiple REST endpoints so postgame games
 * still render full tabs (plays, team metrics, leaders, scoring, fantasy),
 * and builds per-play snapshots for timeline navigation.
 *
 * Documentation hooks:
 * - Mermaid/Structurizr: docs/gridstream-live-runtime.md
 * - OpenAPI endpoint inventory for this page:
 *   GET /games/{id}
 *   GET /games/{id}/plays/
 *   GET /games/{id}/drives/
 *   GET /games/{id}/boxscore/
 */

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo } from 'react';
import type {
  LiveGameState,
  ScoreByQuarter,
  GameStatus,
  TeamStatLine,
  LeaderSet,
  ScoringEntry,
  FantasyRosterEntry,
  PositionGroup,
  MissionLogEntry,
  PlayAnimationData,
} from '@atlas/sdk/gridstream/types';
import { apiGameToContext, type ApiGameDetail } from '@atlas/sdk/gridstream/api-transforms';
import type {
  RunningPlayerTotals,
  RunningPlayerMeta,
  DefenseFantasyTotals,
  ApiGameLeader,
  ApiScoringPlay,
  ApiGameDetailExtended,
  ApiCursorPage,
  ApiPlayDetail,
  ApiDrive,
  ApiTeamGameStats,
  ApiPlayerGameStats,
  ApiBoxscore,
} from '@atlas/sdk/gridstream/api-transforms';
import {
  mapTeamStats, mapLeaders, mapLeadersFromPlayerStats, mapLeadersFromRunningTotals,
  hasLeaderData, scoringTimeline, scoringUpToState, mapFantasy, hasFantasyData,
  mapFantasyFromRunningTotals, createDefenseFantasyTotals, ensureDefenseFantasyEntry,
  defensePointsAllowedBand, defenseFantasyPoints, deriveDefenseFantasyTotalsFromPlays,
  estimateAwayWinPct,
  computeGameProgress, yardToFieldPct,
} from '@atlas/sdk/gridstream/transforms';
import {
  safeNumber, safeInt, normalizeAbbr, normalizeHex, normalizeClock,
  getOpponent, parsePositionGroup, inferFallbackPosition,
  totalsFromPlayerRow, kickerFantasyPointsFromTotals, fantasyPointsByScoringFromTotals,
  fantasyBreakdownFromTotals, normalizeNameKey, lastNameKey, abbreviatedNameKey,
  emptyRunningTotals, buildPlayerGameStatsLookup, formatActorStatLines, formatActorStatLinesFromRow,
  formatKickerStatLines, formatKickerStatLinesFromRow, formatQuarterbackStatLines,
  formatQuarterbackStatLinesFromRow, formatPassingLeaderLineFromTotals,
  formatRushingLeaderLineFromTotals, formatReceivingLeaderLineFromTotals,
  formatPassingLeaderLine, formatRushingLeaderLine, formatReceivingLeaderLine,
  runningTotalsForPlayer, cloneRunningTotalsMap, playerStatsRowForPlayer,
  updateRunningPlayerTotals, updateRunningTotalsFromPlay, isTurnoverPlay, isSnapPlay,
  isTimeoutPlay, resolveDirection, compactPlayText, primaryActionText, parseDisplaySpot,
  displaySpotToFieldPct, fieldPctToDisplaySpot, extractNameAfterTo, actionSentences,
  normalizeActionSentence, extractPrimaryBallCarrier, extractKickerName, extractTurnoverReturner,
  parseKickDetails, parseTurnoverDetails, parsePenaltyDetails, parseTimeoutUsage,
  resolveAnimType, resolveFieldGoalResult, resolvePossessionAfter, toMissionLogEntry, toPlayAnimation,
  yardline100ToDisplay, normalizeDriveStart, parseClockSeconds, gameElapsedSeconds,
  driveElapsedAtPlay, FALLBACK_LEADER, formatDownDistance, formatClockFromSeconds,
} from '@atlas/sdk/gridstream/play-transforms';
import { ENDZONE_NAMES } from '@atlas/sdk/gridstream/constants';
import { LiveGameView } from '@/components/gridstream/LiveGameView';

function resolveGridstreamApiBase(base: string): string {
  const normalized = base.replace(/\/$/, '');
  if (normalized.endsWith('/api/gridstream')) return normalized;
  if (normalized.endsWith('/api/redzone')) return normalized.replace(/\/api\/redzone$/, '/api/gridstream');
  if (normalized.endsWith('/api')) return `${normalized}/gridstream`;
  if (normalized.endsWith('/gridstream')) return normalized;
  return `${normalized}/api/gridstream`;
}

const API_BASE = resolveGridstreamApiBase(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream');

interface ReplayTimeline {
  liveState: LiveGameState;
  frames: LiveGameState[];
  playSequences: number[];
}

export interface QuarterJump {
  key: 'q1' | 'q2' | 'q3' | 'q4' | 'ot';
  label: string;
  index: number | null;
}

function cloneState(state: LiveGameState): LiveGameState {
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state)) as LiveGameState;
}

function buildQuarterJumps(frames: LiveGameState[]): QuarterJump[] {
  const firstIndexByQuarter = new Map<number, number>();
  for (let i = 0; i < frames.length; i += 1) {
    const quarter = Math.max(1, safeInt(frames[i]?.timing.quarter, 1));
    if (!firstIndexByQuarter.has(quarter)) {
      firstIndexByQuarter.set(quarter, i);
    }
  }

  const jumps: QuarterJump[] = [
    { key: 'q1', label: 'Q1', index: firstIndexByQuarter.get(1) ?? null },
    { key: 'q2', label: 'Q2', index: firstIndexByQuarter.get(2) ?? null },
    { key: 'q3', label: 'Q3', index: firstIndexByQuarter.get(3) ?? null },
    { key: 'q4', label: 'Q4', index: firstIndexByQuarter.get(4) ?? null },
  ];

  const otQuarter = [...firstIndexByQuarter.keys()].filter((q) => q > 4).sort((a, b) => a - b)[0];
  if (otQuarter != null) {
    jumps.push({ key: 'ot', label: 'OT', index: firstIndexByQuarter.get(otQuarter) ?? null });
  }

  return jumps;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function normalizeStatus(raw: string | null | undefined): GameStatus {
  const status = (raw ?? '').toLowerCase();
  if (status === 'post' || status === 'status_final') return 'final';
  if (status === 'status_final_ot' || status === 'post_ot') return 'final_ot';
  if (
    status === 'scheduled' ||
    status === 'in_progress' ||
    status === 'halftime' ||
    status === 'end_period' ||
    status === 'delayed' ||
    status === 'final' ||
    status === 'final_ot' ||
    status === 'postponed' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'scheduled';
}

function isFinalStatus(status: GameStatus): boolean {
  return status === 'final' || status === 'final_ot';
}

function toPossessionSide(team: string | null | undefined, awayAbbr: string, homeAbbr: string): 'away' | 'home' | null {
  const abbr = normalizeAbbr(team);
  if (abbr === awayAbbr) return 'away';
  if (abbr === homeAbbr) return 'home';
  return null;
}

function teamAbbrFromPossessionId(detail: ApiGameDetailExtended): string {
  if (detail.possession_team == null) return '';
  if (detail.possession_team === detail.away_team_detail.id) return normalizeAbbr(detail.away_team_detail.abbreviation);
  if (detail.possession_team === detail.home_team_detail.id) return normalizeAbbr(detail.home_team_detail.abbreviation);
  return '';
}

function mapTeamStatsFromPlays(
  plays: ApiPlayDetail[],
  drives: ApiDrive[],
  awayAbbr: string,
  homeAbbr: string,
): { away: TeamStatLine; home: TeamStatLine } | null {
  if (plays.length === 0) return null;

  interface MutableTeamLine {
    passYards: number;
    rushYards: number;
    firstDowns: number;
    thirdAtt: number;
    thirdConv: number;
    turnovers: number;
    sacks: number;
    penalties: number;
    penaltyYards: number;
    topSeconds: number;
    snapCount: number;
  }

  const createLine = (): MutableTeamLine => ({
    passYards: 0,
    rushYards: 0,
    firstDowns: 0,
    thirdAtt: 0,
    thirdConv: 0,
    turnovers: 0,
    sacks: 0,
    penalties: 0,
    penaltyYards: 0,
    topSeconds: 0,
    snapCount: 0,
  });

  const byTeam = new Map<string, MutableTeamLine>([
    [awayAbbr, createLine()],
    [homeAbbr, createLine()],
  ]);

  if (drives.length > 0) {
    for (const drive of drives) {
      const team = normalizeAbbr(drive.team_abbr);
      const line = byTeam.get(team);
      if (!line) continue;
      line.topSeconds += parseClockSeconds(drive.time_elapsed);
    }
  } else {
    // Frame-level fallback: estimate possession time from elapsed game clock within each drive.
    const driveElapsedById = new Map<number, { team: string; start: number; end: number }>();
    for (const play of plays) {
      if (play.drive_id == null) continue;
      const team = normalizeAbbr(play.possession_team_abbr);
      if (!team) continue;
      const elapsed = gameElapsedSeconds(play.quarter, play.clock);
      const existing = driveElapsedById.get(play.drive_id);
      if (!existing) {
        driveElapsedById.set(play.drive_id, { team, start: elapsed, end: elapsed });
        continue;
      }
      existing.start = Math.min(existing.start, elapsed);
      existing.end = Math.max(existing.end, elapsed);
    }
    for (const drive of driveElapsedById.values()) {
      const line = byTeam.get(drive.team);
      if (!line) continue;
      line.topSeconds += Math.max(0, drive.end - drive.start);
    }
  }

  for (const play of plays) {
    const offense = normalizeAbbr(play.possession_team_abbr);
    const offenseLine = byTeam.get(offense);
    if (!offenseLine) continue;
    const defense = offense === awayAbbr ? homeAbbr : awayAbbr;
    const defenseLine = byTeam.get(defense);
    if (!defenseLine) continue;

    const type = (play.play_type ?? '').toLowerCase();
    const yards = safeInt(play.yards_gained, 0);
    const snap = isSnapPlay(play);
    if (snap) offenseLine.snapCount += 1;

    if (snap && safeInt(play.down, 0) === 3) {
      offenseLine.thirdAtt += 1;
      if (play.first_down || play.touchdown) {
        offenseLine.thirdConv += 1;
      }
    }

    if (play.first_down) offenseLine.firstDowns += 1;
    if (play.interception || play.fumble_lost) offenseLine.turnovers += 1;

    if (play.penalty) {
      offenseLine.penalties += 1;
      offenseLine.penaltyYards += Math.max(0, safeInt(play.penalty_yards, 0));
    }

    if (play.sack) {
      defenseLine.sacks += 1;
      offenseLine.passYards += yards;
      continue;
    }

    if (type === 'pass' || type === 'two_point_attempt') {
      if (play.complete_pass || yards !== 0) {
        offenseLine.passYards += yards;
      }
      continue;
    }

    if (type === 'run' || type === 'rush' || type === 'qb_kneel' || type === 'qb_scramble') {
      offenseLine.rushYards += yards;
    }
  }

  const away = byTeam.get(awayAbbr)!;
  const home = byTeam.get(homeAbbr)!;
  if (away.snapCount === 0 && home.snapCount === 0) return null;

  const toLine = (line: MutableTeamLine): TeamStatLine => ({
    totalYards: line.passYards + line.rushYards,
    passingYards: line.passYards,
    rushingYards: line.rushYards,
    firstDowns: line.firstDowns,
    thirdDown: `${line.thirdConv}/${line.thirdAtt}`,
    turnovers: line.turnovers,
    top: formatClockFromSeconds(line.topSeconds),
    penalties: `${line.penalties}-${line.penaltyYards}`,
    sacks: line.sacks,
  });

  return {
    away: toLine(away),
    home: toLine(home),
  };
}
function applyScoreDelta(score: ScoreByQuarter, quarter: number, delta: number) {
  const key: keyof ScoreByQuarter = quarter <= 1
    ? 'q1'
    : quarter === 2
      ? 'q2'
      : quarter === 3
        ? 'q3'
        : quarter === 4
          ? 'q4'
          : 'ot';

  const next = safeInt((score[key] as number) + delta, 0);
  score[key] = Math.max(0, next) as never;
  score.total = Math.max(0, safeInt(score.total + delta, 0));
}

function resolveInitialPlayIndex(
  playParam: string | null,
  playSeqParam: string | null,
  playSequences: number[],
  totalFrames: number,
): number {
  if (totalFrames <= 0) return -1;

  if (playSeqParam) {
    const parsedSeq = Number.parseInt(playSeqParam.trim(), 10);
    if (!Number.isNaN(parsedSeq)) {
      const seqIndex = playSequences.findIndex((seq) => seq === parsedSeq);
      if (seqIndex >= 0) return seqIndex;
    }
  }

  if (!playParam) return -1;

  const normalized = playParam.trim().toLowerCase();
  if (normalized === 'live' || normalized === 'end') return -1;
  if (normalized === 'start') return 0;

  const parsed = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed >= totalFrames) return -1;
  return parsed;
}

function toAbsoluteApiUrl(nextUrl: string): string {
  if (nextUrl.startsWith('http://') || nextUrl.startsWith('https://')) {
    return nextUrl;
  }
  if (nextUrl.startsWith('/')) {
    const origin = new URL(API_BASE).origin;
    return `${origin}${nextUrl}`;
  }
  return new URL(nextUrl, `${API_BASE}/`).toString();
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function isHttp404(error: unknown): boolean {
  return error instanceof Error && /\(404\)/.test(error.message);
}

function toResultsArray<T>(payload: ApiCursorPage<T> | { results?: T[] } | T[]): T[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

async function fetchGameDetailWithFallback(
  requestedGameId: string,
  signal: AbortSignal,
): Promise<{ detail: ApiGameDetailExtended; resolvedGameId: string }> {
  try {
    const detail = await fetchJson<ApiGameDetailExtended>(`${API_BASE}/games/${requestedGameId}/`, signal);
    return { detail, resolvedGameId: String(detail.id ?? requestedGameId) };
  } catch (error) {
    if (!isHttp404(error)) throw error;
  }

  const lookupFields = ['espn_event_id', 'nflverse_game_id'] as const;
  for (const field of lookupFields) {
    try {
      const encoded = encodeURIComponent(requestedGameId);
      const payload = await fetchJson<ApiCursorPage<ApiGameDetailExtended> | { results?: ApiGameDetailExtended[] } | ApiGameDetailExtended[]>(
        `${API_BASE}/games/?${field}=${encoded}&page_size=1`,
        signal,
      );
      const match = toResultsArray(payload)[0];
      if (match) {
        return { detail: match, resolvedGameId: String(match.id) };
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
  }

  throw new Error('Request failed (404)');
}

async function fetchAllPlays(gameId: string, signal: AbortSignal): Promise<ApiPlayDetail[]> {
  const pages: ApiPlayDetail[] = [];
  let nextUrl: string | null = `${API_BASE}/games/${gameId}/plays/?detail=true&page_size=200`;

  for (let pageCount = 0; nextUrl && pageCount < 50; pageCount += 1) {
    const pageData: ApiCursorPage<ApiPlayDetail> = await fetchJson<ApiCursorPage<ApiPlayDetail>>(nextUrl, signal);
    for (const play of pageData.results) {
      pages.push(play);
    }
    nextUrl = pageData.next ? toAbsoluteApiUrl(pageData.next) : null;
  }

  const bySequence = new Map<number, ApiPlayDetail>();
  for (const play of pages) {
    bySequence.set(play.sequence, play);
  }

  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Converts raw game feeds into replay-ready frame snapshots.
 *
 * Frame contract:
 * - one frame per play sequence
 * - each frame is self-sufficient (HUD + tabs + animation payload)
 * - "live" is computed as the latest meaningful frame + game-level status
 */
function buildTimeline(
  detail: ApiGameDetailExtended,
  plays: ApiPlayDetail[],
  drives: ApiDrive[],
  boxscore: ApiBoxscore | null,
): ReplayTimeline {
  const ctx = apiGameToContext(detail);

  const awayAbbr = normalizeAbbr(ctx.awayTeam.abbreviation);
  const homeAbbr = normalizeAbbr(ctx.homeTeam.abbreviation);

  const status = normalizeStatus(ctx.status);
  const finalGame = isFinalStatus(status);

  const awayScoreFinal: ScoreByQuarter = ctx.awayScoreByQuarter ?? {
    q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, total: ctx.awayScore,
  };
  const homeScoreFinal: ScoreByQuarter = ctx.homeScoreByQuarter ?? {
    q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, total: ctx.homeScore,
  };

  const quarter = ctx.quarter || (finalGame ? 4 : 0);
  const clock = finalGame ? '0:00' : normalizeClock(ctx.clock, '15:00');
  const timing = computeGameProgress(quarter, clock, quarter > 4);

  const derivedTotalsByKey = new Map<string, RunningPlayerTotals>();
  const derivedPlayerMetaByFullKey = new Map<string, RunningPlayerMeta>();
  for (const play of plays) {
    updateRunningTotalsFromPlay(play, derivedTotalsByKey, derivedPlayerMetaByFullKey);
  }
  const playerStatsLookup = buildPlayerGameStatsLookup(boxscore?.player_stats);
  const defenseFantasyTotalsFinal = deriveDefenseFantasyTotalsFromPlays(
    plays,
    awayAbbr,
    homeAbbr,
    { away: awayScoreFinal.total, home: homeScoreFinal.total },
  );

  const teamStats = mapTeamStats(boxscore?.team_stats, awayAbbr, homeAbbr)
    ?? mapTeamStatsFromPlays(plays, drives, awayAbbr, homeAbbr);
  const leadersFromDetail = mapLeaders(detail.leaders, awayAbbr, homeAbbr);
  const leadersFromBoxscore = mapLeaders(boxscore?.leaders, awayAbbr, homeAbbr);
  const leadersFromPlayers = mapLeadersFromPlayerStats(boxscore?.player_stats, awayAbbr, homeAbbr);
  const leadersFromPlays = mapLeadersFromRunningTotals(derivedTotalsByKey, derivedPlayerMetaByFullKey, awayAbbr, homeAbbr);
  const leaders = hasLeaderData(leadersFromDetail)
    ? leadersFromDetail
    : hasLeaderData(leadersFromBoxscore)
      ? leadersFromBoxscore
      : hasLeaderData(leadersFromPlayers)
        ? leadersFromPlayers
        : hasLeaderData(leadersFromPlays)
          ? leadersFromPlays
          : null;
  const scoringBySequence = scoringTimeline(detail.scoring_plays);
  const scoring = scoringBySequence.map((item) => item.entry);
  const fantasyFromBoxscore = mapFantasy(boxscore?.player_stats, awayAbbr, homeAbbr);
  const fantasyFromPlays = mapFantasyFromRunningTotals(
    derivedTotalsByKey,
    derivedPlayerMetaByFullKey,
    awayAbbr,
    homeAbbr,
    playerStatsLookup,
    teamStats,
    { away: awayScoreFinal.total, home: homeScoreFinal.total },
    defenseFantasyTotalsFinal,
  );
  const fantasy = hasFantasyData(fantasyFromBoxscore) ? fantasyFromBoxscore : fantasyFromPlays;

  const toHudTeam = (info: typeof ctx.homeTeam, abbr: string) => ({
    abbr,
    name: info.displayName.split(' ').pop() ?? info.displayName,
    displayName: info.displayName,
    color: normalizeHex(info.color, '333333'),
    altColor: normalizeHex(info.altColor, '666666'),
    logoUrl: info.logoUrl,
    record: info.record ?? '',
    endzoneName: ENDZONE_NAMES[abbr] ?? abbr,
  });

  const detailPossession = teamAbbrFromPossessionId(detail);
  const baseWp = estimateAwayWinPct(awayScoreFinal.total, homeScoreFinal.total, quarter, clock, finalGame);

  const baseState: LiveGameState = {
    connected: false,
    gameId: ctx.gameId,
    away: toHudTeam(ctx.awayTeam, awayAbbr),
    home: toHudTeam(ctx.homeTeam, homeAbbr),
    status,
    awayScore: awayScoreFinal,
    homeScore: homeScoreFinal,
    timing,
    situation: {
      down: 0,
      distance: 0,
      yardLine: 0,
      side: '',
      downDistText: '',
      possessionTeam: detailPossession,
    },
    possession: toPossessionSide(detailPossession, awayAbbr, homeAbbr),
    currentDrive: null,
    venue: ctx.venueName,
    weather: {
      temperature: ctx.temperature ?? 72,
      condition: ctx.weatherDesc ?? 'Clear',
      wind: ctx.weatherWind ?? '',
      humidity: detail.weather_humidity ?? undefined,
      isIndoor: ctx.isIndoor,
    },
    network: ctx.network ?? '',
    spread: ctx.spread ?? null,
    wpTimeline: [{ wp: baseWp, gameMin: Math.max(0, timing.elapsedMin) }],
    awayWinPct: baseWp,
    lastPlay: null,
    animationKey: 0,
    plays: [],
    fantasyAway: fantasy.away,
    fantasyHome: fantasy.home,
    playerSeasonStats: {},
    fantasyScoring: 'half_ppr',
    homeTimeouts: 3,
    awayTimeouts: 3,
    teamStats,
    leaders,
    scoring,
    playIndex: -1,
    playHistoryLength: plays.length,
  };

  if (plays.length === 0) {
    return {
      liveState: baseState,
      frames: [],
      playSequences: [],
    };
  }

  const drivesById = new Map<number, ApiDrive>();
  for (const drive of drives) {
    drivesById.set(drive.id, drive);
  }

  const driveStartById = new Map<number, ApiPlayDetail>();
  for (const play of plays) {
    if (play.drive_id == null || driveStartById.has(play.drive_id)) continue;
    if (!isSnapPlay(play)) continue;
    driveStartById.set(play.drive_id, play);
  }

  const nextSnapIndexByPlayIndex = new Array<number>(plays.length).fill(-1);
  let nextSnapIndex = -1;
  for (let idx = plays.length - 1; idx >= 0; idx -= 1) {
    nextSnapIndexByPlayIndex[idx] = nextSnapIndex;
    if (isSnapPlay(plays[idx]!)) {
      nextSnapIndex = idx;
    }
  }

  const driveProgress = new Map<number, { plays: number; yards: number }>();
  const frames: LiveGameState[] = [];
  const playSequences: number[] = [];
  const missionLog: MissionLogEntry[] = [];
  const wpTimelinePoints: LiveGameState['wpTimeline'] = [{ wp: 50, gameMin: 0 }];
  const runningTotalsByKey = new Map<string, RunningPlayerTotals>();
  const playerMetaByFullKey = new Map<string, RunningPlayerMeta>();

  const awayScoreRunning: ScoreByQuarter = { q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, total: 0 };
  const homeScoreRunning: ScoreByQuarter = { q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, total: 0 };
  let awayTotal = 0;
  let homeTotal = 0;
  let lastQuarter = 1;
  let awayTimeouts = 3;
  let homeTimeouts = 3;

  for (let index = 0; index < plays.length; index += 1) {
    const play = plays[index]!;
    const nextSnapPlayIndex = nextSnapIndexByPlayIndex[index] ?? -1;
    const nextSnapPlay = nextSnapPlayIndex >= 0 ? plays[nextSnapPlayIndex] : undefined;
    const timeoutFrame = isTimeoutPlay(play);
    const runningTotalsBeforeByKey = cloneRunningTotalsMap(runningTotalsByKey);

    missionLog.push(toMissionLogEntry(play));
    updateRunningTotalsFromPlay(play, runningTotalsByKey, playerMetaByFullKey);

    const playQuarter = safeInt(play.quarter, lastQuarter);
    if (playQuarter >= 3 && lastQuarter < 3) {
      awayTimeouts = 3;
      homeTimeouts = 3;
    }
    lastQuarter = Math.max(1, playQuarter);

    const timeoutUsage = parseTimeoutUsage(play, awayAbbr, homeAbbr);
    if (timeoutUsage) {
      if (timeoutUsage.team === awayAbbr) {
        if (timeoutUsage.ordinal != null) awayTimeouts = Math.max(0, 3 - timeoutUsage.ordinal);
        else awayTimeouts = Math.max(0, awayTimeouts - 1);
      }
      if (timeoutUsage.team === homeAbbr) {
        if (timeoutUsage.ordinal != null) homeTimeouts = Math.max(0, 3 - timeoutUsage.ordinal);
        else homeTimeouts = Math.max(0, homeTimeouts - 1);
      }
    }

    const awayAfter = safeInt(play.away_score_after, awayTotal);
    const homeAfter = safeInt(play.home_score_after, homeTotal);

    const awayDelta = awayAfter - awayTotal;
    const homeDelta = homeAfter - homeTotal;

    if (awayDelta !== 0) applyScoreDelta(awayScoreRunning, playQuarter, awayDelta);
    if (homeDelta !== 0) applyScoreDelta(homeScoreRunning, playQuarter, homeDelta);

    awayTotal = awayAfter;
    homeTotal = homeAfter;
    awayScoreRunning.total = awayAfter;
    homeScoreRunning.total = homeAfter;

    const timingNow = computeGameProgress(
      Math.max(playQuarter, 1),
      normalizeClock(play.clock, '0:00'),
      playQuarter > 4,
    );

    const possessionAfter = resolvePossessionAfter(play, nextSnapPlay, awayAbbr, homeAbbr);
    const possessionAtSnap = normalizeAbbr(play.possession_team_abbr) || possessionAfter;
    const situationSource = timeoutFrame && nextSnapPlay ? nextSnapPlay : play;
    const situationPossession = timeoutFrame && nextSnapPlay
      ? (normalizeAbbr(nextSnapPlay.possession_team_abbr) || possessionAfter)
      : possessionAtSnap;
    const situationSpot = yardline100ToDisplay(
      situationSource.yard_line,
      situationPossession,
      awayAbbr,
      homeAbbr,
    );
    const situationDown = safeInt(situationSource.down, 0);
    const situationDistance = safeInt(situationSource.distance, 0);

    let situation = {
      down: situationDown,
      distance: situationDistance,
      yardLine: situationSpot.yardLine,
      side: situationSpot.side,
      downDistText:
        situationSource.down_distance_text || formatDownDistance(situationDown, situationDistance),
      possessionTeam: situationPossession,
    };
    if (timeoutFrame && (situation.yardLine <= 0 || !situation.side)) {
      const previousSituation = frames[frames.length - 1]?.situation;
      if (previousSituation && previousSituation.yardLine > 0 && previousSituation.side) {
        situation = { ...previousSituation };
      }
    }

    let currentDrive: LiveGameState['currentDrive'] = null;
    if (timeoutFrame && nextSnapPlay?.drive_id != null) {
      const timeoutDriveId = nextSnapPlay.drive_id;
      const previous = driveProgress.get(timeoutDriveId) ?? { plays: 0, yards: 0 };
      const driveMeta = drivesById.get(timeoutDriveId);
      const driveTeam = normalizeAbbr(driveMeta?.team_abbr) || normalizeAbbr(nextSnapPlay.possession_team_abbr);
      const driveStartPlay = driveStartById.get(timeoutDriveId);
      const start = driveStartPlay
        ? yardline100ToDisplay(
            driveStartPlay.yard_line,
            driveStartPlay.possession_team_abbr ?? driveTeam,
            awayAbbr,
            homeAbbr,
          )
        : driveMeta
          ? normalizeDriveStart(driveMeta.start_yardline, driveTeam, awayAbbr, homeAbbr)
          : yardline100ToDisplay(nextSnapPlay.yard_line, driveTeam, awayAbbr, homeAbbr);
      currentDrive = {
        plays: previous.plays,
        yards: previous.yards,
        time: '0:00',
        startYardLine: start.yardLine,
        startSide: start.side,
        team: driveTeam,
      };
    } else if (timeoutFrame) {
      currentDrive = frames[frames.length - 1]?.currentDrive
        ? { ...frames[frames.length - 1]!.currentDrive! }
        : null;
    }
    if (!timeoutFrame && play.drive_id != null) {
      const previous = driveProgress.get(play.drive_id) ?? { plays: 0, yards: 0 };
      const shouldCountPlay = isSnapPlay(play);
      const updated = {
        plays: previous.plays + (shouldCountPlay ? 1 : 0),
        yards: previous.yards + (shouldCountPlay ? safeInt(play.yards_gained, 0) : 0),
      };
      driveProgress.set(play.drive_id, updated);

      const driveMeta = drivesById.get(play.drive_id);
      const driveTeam = normalizeAbbr(driveMeta?.team_abbr) || normalizeAbbr(play.possession_team_abbr);
      const driveStartPlay = driveStartById.get(play.drive_id);
      const elapsedDriveTime = driveElapsedAtPlay(driveStartPlay, play);
      const start = driveStartPlay
        ? yardline100ToDisplay(driveStartPlay.yard_line, driveStartPlay.possession_team_abbr ?? driveTeam, awayAbbr, homeAbbr)
        : driveMeta
          ? normalizeDriveStart(driveMeta.start_yardline, driveTeam, awayAbbr, homeAbbr)
          : yardline100ToDisplay(play.yard_line, driveTeam, awayAbbr, homeAbbr);

      currentDrive = {
        plays: updated.plays,
        yards: updated.yards,
        time: elapsedDriveTime || driveMeta?.time_elapsed || '0:00',
        startYardLine: start.yardLine,
        startSide: start.side,
        team: driveTeam,
      };
    }

    const awayWinPct = estimateAwayWinPct(awayAfter, homeAfter, playQuarter, normalizeClock(play.clock, '0:00'), false);
    const previousPoint = wpTimelinePoints[wpTimelinePoints.length - 1];
    const elapsedMin = Math.max(previousPoint?.gameMin ?? 0, timingNow.elapsedMin);
    if (!previousPoint || previousPoint.gameMin !== elapsedMin || previousPoint.wp !== awayWinPct) {
      wpTimelinePoints.push({ wp: awayWinPct, gameMin: elapsedMin });
    }

    const frameStatus: GameStatus = play.play_type === 'end_of_half' ? 'halftime' : 'in_progress';
    const frameScoring = scoringUpToState(scoringBySequence, awayAfter, homeAfter);
    const frameTeamStats = mapTeamStatsFromPlays(
      plays.slice(0, index + 1),
      [],
      awayAbbr,
      homeAbbr,
    );
    const frameLeaders = mapLeadersFromRunningTotals(
      runningTotalsByKey,
      playerMetaByFullKey,
      awayAbbr,
      homeAbbr,
    );
    const frameFantasy = mapFantasyFromRunningTotals(
      runningTotalsByKey,
      playerMetaByFullKey,
      awayAbbr,
      homeAbbr,
      playerStatsLookup,
      frameTeamStats,
      { away: awayAfter, home: homeAfter },
      deriveDefenseFantasyTotalsFromPlays(
        plays.slice(0, index + 1),
        awayAbbr,
        homeAbbr,
        { away: awayAfter, home: homeAfter },
      ),
    );
    const playAnimation = toPlayAnimation(
      play,
      nextSnapPlay,
      awayAbbr,
      homeAbbr,
      playerStatsLookup,
      runningTotalsByKey,
      runningTotalsBeforeByKey,
    );

    if (!timeoutFrame && playAnimation == null && (situation.yardLine <= 0 || !situation.side)) {
      const previousSituation = frames[frames.length - 1]?.situation;
      if (previousSituation && previousSituation.yardLine > 0 && previousSituation.side) {
        situation = { ...previousSituation };
      }
    }

    const framePossession = timeoutFrame
      ? (frames[frames.length - 1]?.possession ?? toPossessionSide(possessionAfter, awayAbbr, homeAbbr))
      : toPossessionSide(situation.possessionTeam, awayAbbr, homeAbbr);

    const frame: LiveGameState = {
      ...baseState,
      status: frameStatus,
      awayScore: { ...awayScoreRunning },
      homeScore: { ...homeScoreRunning },
      timing: timingNow,
      situation,
      possession: framePossession,
      currentDrive,
      wpTimeline: wpTimelinePoints.map((point) => ({ ...point })),
      awayWinPct,
      lastPlay: playAnimation,
      animationKey: index + 1,
      plays: [...missionLog],
      scoring: frameScoring,
      teamStats: frameTeamStats,
      leaders: hasLeaderData(frameLeaders) ? frameLeaders : null,
      fantasyAway: frameFantasy.away,
      fantasyHome: frameFantasy.home,
      awayTimeouts,
      homeTimeouts,
      playIndex: index,
      playHistoryLength: plays.length,
    };

    frames.push(frame);
    playSequences.push(play.sequence);
  }

  const lastFrame = [...frames].reverse().find((frame) =>
    frame.situation.yardLine > 0 || frame.lastPlay !== null
  ) ?? frames[frames.length - 1] ?? baseState;
  const finalAwayWinPct = estimateAwayWinPct(awayScoreFinal.total, homeScoreFinal.total, quarter, clock, finalGame);

  const liveState: LiveGameState = {
    ...lastFrame,
    status,
    awayScore: awayScoreFinal,
    homeScore: homeScoreFinal,
    timing,
    wpTimeline: wpTimelinePoints,
    awayWinPct: finalAwayWinPct,
    scoring,
    playIndex: -1,
    playHistoryLength: frames.length,
  };

  if (finalGame) {
    liveState.possession = null;
    liveState.currentDrive = null;
    liveState.situation = {
      ...liveState.situation,
      down: 0,
      distance: 0,
      downDistText: '',
      possessionTeam: '',
    };
    if (liveState.wpTimeline.length > 0) {
      const finalMinute = liveState.timing.totalMin;
      liveState.wpTimeline = [...liveState.wpTimeline, { wp: finalAwayWinPct, gameMin: finalMinute }];
    }
  }

  return { liveState, frames, playSequences };
}

export const __gridstreamTestUtils = {
  parseKickDetails,
  toPlayAnimation,
  updateRunningTotalsFromPlay,
  mapTeamStatsFromPlays,
  mapLeadersFromRunningTotals,
  mapFantasyFromRunningTotals,
  deriveDefenseFantasyTotalsFromPlays,
  defenseFantasyPoints,
  defensePointsAllowedBand,
  buildTimeline,
};

export default function GridstreamPage() {
  const searchParams = useSearchParams();
  const gameId = searchParams.get('game');
  const playParam = searchParams.get('play');
  const playSeqParam = searchParams.get('play_seq') ?? searchParams.get('seq') ?? searchParams.get('sequence');

  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [state, setState] = useState<LiveGameState | null>(null);
  const [season, setSeason] = useState<number | undefined>();
  const [week, setWeek] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quarterJumps = useMemo(
    () => (timeline ? buildQuarterJumps(timeline.frames) : buildQuarterJumps([])),
    [timeline],
  );

  useEffect(() => {
    if (!gameId) {
      setTimeline(null);
      setState(null);
      return;
    }
    const requestedGameId: string = gameId;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const { detail, resolvedGameId } = await fetchGameDetailWithFallback(requestedGameId, controller.signal);

        const [plays, drives, boxscore] = await Promise.all([
          fetchAllPlays(resolvedGameId, controller.signal).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn('[gridstream] plays hydration failed, continuing with empty plays:', err);
            return [];
          }),
          fetchJson<ApiDrive[]>(`${API_BASE}/games/${resolvedGameId}/drives/`, controller.signal).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn('[gridstream] drives hydration failed, continuing without drive data:', err);
            return [];
          }),
          fetchJson<ApiBoxscore>(`${API_BASE}/games/${resolvedGameId}/boxscore/`, controller.signal).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn('[gridstream] boxscore hydration failed, continuing without boxscore:', err);
            return null;
          }),
        ]);

        const builtTimeline = buildTimeline(detail, plays, drives, boxscore);
        setTimeline(builtTimeline);
        setSeason(detail.season_id);
        setWeek(detail.week);
      } catch (err) {
        if (isAbortError(err)) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [gameId]);

  useEffect(() => {
    if (!timeline) {
      setState(null);
      return;
    }

    const initialIndex = resolveInitialPlayIndex(playParam, playSeqParam, timeline.playSequences, timeline.frames.length);
    if (initialIndex === -1) {
      setState(cloneState(timeline.liveState));
      return;
    }
    setState(cloneState(timeline.frames[initialIndex]!));
  }, [timeline, playParam, playSeqParam]);

  const onReplay = useCallback(() => {
    setState((prev) => (prev ? { ...prev, animationKey: prev.animationKey + 1 } : prev));
  }, []);

  const onPrev = useCallback(() => {
    if (!timeline || timeline.frames.length === 0) return;
    setState((prev) => {
      if (!prev) return prev;
      const current = prev.playIndex === -1 ? timeline.frames.length : prev.playIndex;
      const target = Math.max(0, current - 1);
      return cloneState(timeline.frames[target]!);
    });
  }, [timeline]);

  const onNext = useCallback(() => {
    if (!timeline || timeline.frames.length === 0) return;
    setState((prev) => {
      if (!prev) return prev;
      if (prev.playIndex === -1) return prev;
      const next = prev.playIndex + 1;
      if (next >= timeline.frames.length) return prev;
      return cloneState(timeline.frames[next]!);
    });
  }, [timeline]);

  const onLive = useCallback(() => {
    if (!timeline) return;
    setState(cloneState(timeline.liveState));
  }, [timeline]);

  const onJumpToPlayIndex = useCallback((index: number) => {
    if (!timeline || timeline.frames.length === 0) return;
    if (index < 0 || index >= timeline.frames.length) return;
    setState(cloneState(timeline.frames[index]!));
  }, [timeline]);

  if (!gameId) return <GamePicker />;

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#070b14', color: '#5a7a90',
        fontFamily: "'Orbitron', monospace", fontSize: 14, letterSpacing: '.15em',
      }}>
        LOADING GAME DATA...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, minHeight: '100vh', background: '#070b14', color: '#ff3b4f',
        fontFamily: "'Orbitron', monospace", fontSize: 14, letterSpacing: '.1em',
      }}>
        <span>ERROR: {error}</span>
        <a href="/gridstream" style={{ color: '#5a7a90', fontSize: 12 }}>← BACK TO GAME SELECT</a>
      </div>
    );
  }

  if (!state) return null;
  const currentPlaySequence = timeline?.playSequences.length
    ? (
      state.playIndex >= 0
        ? (timeline.playSequences[state.playIndex] ?? null)
        : (timeline.playSequences[timeline.playSequences.length - 1] ?? null)
    )
    : null;

  return (
    <LiveGameView
      state={state}
      onReplay={onReplay}
      onPrev={onPrev}
      onNext={onNext}
      onEnd={onLive}
      onJumpToPlayIndex={onJumpToPlayIndex}
      quarterJumps={quarterJumps}
      isReplaying={state.playIndex !== -1}
      wsConnected={false}
      feedConnected={Boolean(timeline)}
      season={season}
      week={week}
      isGameFinal={Boolean(timeline && isFinalStatus(timeline.liveState.status))}
      currentPlaySequence={currentPlaySequence}
    />
  );
}

function GamePicker() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 24, minHeight: '100vh', background: '#070b14', color: '#b0c8d8',
      fontFamily: "'Orbitron', monospace",
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#ffb612', letterSpacing: '.1em' }}>GRIDSTREAM</div>
      <div style={{ fontSize: 12, color: '#5a7a90', letterSpacing: '.15em' }}>SELECT A GAME TO VIEW</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: '#5a7a90', textAlign: 'center' }}>
        <span>Append a game ID to the URL:</span>
        <code style={{ background: 'rgba(0,229,255,.05)', padding: '8px 16px', border: '1px solid rgba(0,229,255,.12)', color: '#00e5ff', fontSize: 12 }}>
          /gridstream?game=123
        </code>
        <span style={{ fontSize: 11, marginTop: 8 }}>
          Optional replay index: <code style={{ color: '#00e5ff' }}>&amp;play=0</code> (start), <code style={{ color: '#00e5ff' }}>&amp;play=live</code> (latest)
          <br />
          Direct play sequence: <code style={{ color: '#00e5ff' }}>&amp;play_seq=123</code>
        </span>
        <span style={{ fontSize: 11 }}>
          Find game IDs at{' '}
          <a href={`${API_BASE}/games/?season=2024&week=1`} style={{ color: '#00e5ff' }}>/api/gridstream/games/</a>
        </span>
      </div>
    </div>
  );
}
