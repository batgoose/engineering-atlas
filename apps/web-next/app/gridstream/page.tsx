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
 *   GET /games/{id}/personnel/
 */

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, useCallback, useMemo } from 'react';
import type {
  LiveGameState,
  ScoreByQuarter,
  GameStatus,
  TeamStatLine,
  MissionLogEntry,
} from '@atlas/sdk/gridstream/types';
import { apiGameToContext, resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';
import type {
  RunningPlayerTotals,
  RunningPlayerMeta,
  ApiGameDetailExtended,
  ApiCursorPage,
  ApiPlayDetail,
  ApiDrive,
  ApiBoxscore,
  ApiGamePersonnel,
  ApiPlayerGameStats,
} from '@atlas/sdk/gridstream/api-transforms';
import {
  mapTeamStats,
  mapLeaders,
  mapLeadersFromPlayerStats,
  mapLeadersFromRunningTotals,
  hasLeaderData,
  scoringTimeline,
  scoringUpToState,
  mapFantasy,
  hasFantasyData,
  mapFantasyFromRunningTotals,
  defensePointsAllowedBand,
  defenseFantasyPoints,
  deriveDefenseFantasyTotalsFromPlays,
  computeGameProgress,
  estimateAwayWinPct,
} from '@atlas/sdk/gridstream/transforms';
import {
  safeInt,
  normalizeAbbr,
  normalizeNameKey,
  abbreviatedNameKey,
  normalizeHex,
  normalizeClock,
  buildPlayerGameStatsLookup,
  cloneRunningTotalsMap,
  updateRunningTotalsFromPlay,
  isSnapPlay,
  isTimeoutPlay,
  parseKickDetails,
  parseTimeoutUsage,
  resolvePossessionAfter,
  toMissionLogEntry,
  toPlayAnimation,
  yardline100ToDisplay,
  normalizeDriveStart,
  parseClockSeconds,
  gameElapsedSeconds,
  driveElapsedAtPlay,
  formatDownDistance,
  formatClockFromSeconds,
} from '@atlas/sdk/gridstream/play-transforms';
import { ENDZONE_NAMES } from '@atlas/sdk/gridstream/constants';
import { LiveGameView } from '@/components/gridstream/LiveGameView';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);

interface ReplayTimeline {
  liveState: LiveGameState;
  frames: LiveGameState[];
  playSequences: number[];
}

interface TeamRosterPlayer {
  display_name?: string;
  first_name?: string;
  last_name?: string;
  headshot_url?: string;
}

interface TeamRosterHydrationData {
  headshotsByName: Map<string, string>;
  displayNameByShortKey: Map<string, string>;
}

export interface QuarterJump {
  key: 'q1' | 'q2' | 'q3' | 'q4' | 'ot';
  label: string;
  index: number | null;
}

function normalizePersonnelPct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

function mapPersonnelFromApi(
  personnel: ApiGamePersonnel | null,
  awayAbbr: string,
  homeAbbr: string
): LiveGameState['personnel'] {
  if (!personnel) return null;
  const mapPlayer = (player: ApiGamePersonnel['away']['players'][number]) => ({
    playerId: player.player_id ?? undefined,
    playerName: player.player_name,
    displayName: player.display_name ?? undefined,
    headshotUrl: player.headshot_url ?? undefined,
    jerseyNumber: player.jersey_number ?? undefined,
    position: player.position ?? undefined,
    positionGroup: player.position_group ?? undefined,
    rosterStatus: player.roster_status ?? undefined,
    depthChartPosition: player.depth_chart_position ?? undefined,
    depthRank: player.depth_rank,
    offenseSnaps: safeInt(player.offense_snaps, 0),
    defenseSnaps: safeInt(player.defense_snaps, 0),
    specialSnaps: safeInt(player.special_snaps, 0),
    totalSnaps: safeInt(player.total_snaps, 0),
    offenseSnapPct: normalizePersonnelPct(player.offense_snap_pct),
    defenseSnapPct: normalizePersonnelPct(player.defense_snap_pct),
    specialSnapPct: normalizePersonnelPct(player.special_snap_pct),
    totalSnapPct: normalizePersonnelPct(player.total_snap_pct),
  });
  const mapTeam = (
    team: ApiGamePersonnel['away'] | ApiGamePersonnel['home'],
    fallbackAbbr: string
  ) => ({
    teamAbbr: normalizeAbbr(team.team_abbr) || fallbackAbbr,
    totalOffenseSnaps: safeInt(team.total_offense_snaps, 0),
    totalDefenseSnaps: safeInt(team.total_defense_snaps, 0),
    totalSpecialSnaps: safeInt(team.total_special_snaps, 0),
    totalSnaps: safeInt(team.total_snaps, 0),
    players: (team.players ?? []).map(mapPlayer),
  });
  return {
    source: personnel.source ?? 'empty',
    season: personnel.season ?? null,
    week: personnel.week ?? null,
    away: mapTeam(personnel.away, awayAbbr),
    home: mapTeam(personnel.home, homeAbbr),
  };
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

function toPossessionSide(
  team: string | null | undefined,
  awayAbbr: string,
  homeAbbr: string
): 'away' | 'home' | null {
  const abbr = normalizeAbbr(team);
  if (abbr === awayAbbr) return 'away';
  if (abbr === homeAbbr) return 'home';
  return null;
}

function clampWinPct(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWinProbabilityValue(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return clampWinPct(normalized);
}

function normalizeEpaValue(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

interface AwayWinProbSample {
  wp: number;
  wpLow?: number;
  wpHigh?: number;
  source: 'model' | 'fallback';
}

function resolveWpBandHalfWidth(
  modelAwayWp: number,
  vegasAwayWp: number | null,
  quarter: number,
  clock: string
): number {
  const q = Math.max(1, quarter);
  const timing = computeGameProgress(q, normalizeClock(clock, '15:00'), q > 4);
  const gameProgress = Math.max(0, Math.min(1, timing.elapsedMin / Math.max(1, timing.totalMin)));
  const base = 7 - gameProgress * 4.5;
  const disagreement = vegasAwayWp == null ? 0 : Math.abs(modelAwayWp - vegasAwayWp) * 0.35;
  return Math.max(2, Math.min(16, base + disagreement));
}

function resolveAwayWinProbSampleFromPlay(
  play: ApiPlayDetail,
  fallback: number
): AwayWinProbSample {
  const awayWp = normalizeWinProbabilityValue(play.away_wp);
  const vegasHomeWp = normalizeWinProbabilityValue(play.vegas_home_wp);
  const vegasAwayWp =
    vegasHomeWp != null
      ? clampWinPct(100 - vegasHomeWp)
      : normalizeWinProbabilityValue(play.vegas_wp);
  if (awayWp != null) {
    const spread = resolveWpBandHalfWidth(
      awayWp,
      vegasAwayWp,
      safeInt(play.quarter, 1),
      normalizeClock(play.clock, '15:00')
    );
    return {
      wp: awayWp,
      wpLow: clampWinPct(awayWp - spread),
      wpHigh: clampWinPct(awayWp + spread),
      source: 'model',
    };
  }
  const homeWp = normalizeWinProbabilityValue(play.home_wp);
  if (homeWp != null) {
    const convertedAway = clampWinPct(100 - homeWp);
    const spread = resolveWpBandHalfWidth(
      convertedAway,
      vegasAwayWp,
      safeInt(play.quarter, 1),
      normalizeClock(play.clock, '15:00')
    );
    return {
      wp: convertedAway,
      wpLow: clampWinPct(convertedAway - spread),
      wpHigh: clampWinPct(convertedAway + spread),
      source: 'model',
    };
  }
  const quarter = safeInt(play.quarter, 0);
  if (quarter > 0) {
    return {
      wp: estimateAwayWinPct(
        safeInt(play.away_score_after),
        safeInt(play.home_score_after),
        quarter,
        normalizeClock(play.clock, '15:00'),
        false
      ),
      source: 'fallback',
    };
  }
  return { wp: clampWinPct(fallback), source: 'fallback' };
}

function resolveFinalAwayWinPct(awayScore: number, homeScore: number): number {
  if (awayScore > homeScore) return 100;
  if (homeScore > awayScore) return 0;
  return 50;
}

function teamAbbrFromPossessionId(detail: ApiGameDetailExtended): string {
  if (detail.possession_team == null) return '';
  if (detail.possession_team === detail.away_team_detail.id)
    return normalizeAbbr(detail.away_team_detail.abbreviation);
  if (detail.possession_team === detail.home_team_detail.id)
    return normalizeAbbr(detail.home_team_detail.abbreviation);
  return '';
}

function normalizeTimeoutCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(3, Math.round(value)));
}

function titleCaseWords(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function normalizeDriveStartTransition(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return '';
  if (/^following\s+/i.test(cleaned) || /^after\s+/i.test(cleaned)) {
    return titleCaseWords(cleaned);
  }
  if (/turnover on downs/i.test(cleaned)) return 'After Turnover on Downs';
  if (/interception|int\b/i.test(cleaned)) {
    return 'Following INT';
  }
  if (/\bturnover\b/i.test(cleaned)) return 'Following Turnover';
  if (/punt/i.test(cleaned)) return 'After Punt';
  if (/kickoff/i.test(cleaned)) return 'After Kickoff';
  if (/field goal|fg/i.test(cleaned)) return 'After FG';
  if (/fumble/i.test(cleaned)) return 'Following Fumble';
  return `Following ${titleCaseWords(cleaned)}`;
}

function isPassEpaPlay(play: ApiPlayDetail): boolean {
  if (play.pass_attempt) return true;
  const rawType = (play.play_type ?? '').toLowerCase();
  return rawType === 'pass' || Boolean(play.sack);
}

function isRushEpaPlay(play: ApiPlayDetail): boolean {
  if (play.rush_attempt) return true;
  const rawType = (play.play_type ?? '').toLowerCase();
  return rawType === 'run' || rawType === 'qb_kneel' || rawType === 'qb_spike';
}

function resolveDriveStartSpot(
  driveMeta: ApiDrive | undefined,
  driveStartPlay: ApiPlayDetail | undefined,
  fallbackPlay: ApiPlayDetail | undefined,
  driveTeam: string,
  awayAbbr: string,
  homeAbbr: string
): { side: string; yardLine: number } {
  if (driveMeta?.start_yardline != null && Number.isFinite(driveMeta.start_yardline)) {
    return normalizeDriveStart(driveMeta.start_yardline, driveTeam, awayAbbr, homeAbbr);
  }
  if (driveStartPlay) {
    return yardline100ToDisplay(
      driveStartPlay.yard_line,
      driveStartPlay.possession_team_abbr ?? driveTeam,
      awayAbbr,
      homeAbbr
    );
  }
  if (fallbackPlay) {
    return yardline100ToDisplay(
      fallbackPlay.yard_line,
      fallbackPlay.possession_team_abbr ?? driveTeam,
      awayAbbr,
      homeAbbr
    );
  }
  return yardline100ToDisplay(null, driveTeam, awayAbbr, homeAbbr);
}

function mapTeamStatsFromPlays(
  plays: ApiPlayDetail[],
  drives: ApiDrive[],
  awayAbbr: string,
  homeAbbr: string
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
  const key: keyof ScoreByQuarter =
    quarter <= 1 ? 'q1' : quarter === 2 ? 'q2' : quarter === 3 ? 'q3' : quarter === 4 ? 'q4' : 'ot';

  const next = safeInt((score[key] as number) + delta, 0);
  score[key] = Math.max(0, next) as never;
  score.total = Math.max(0, safeInt(score.total + delta, 0));
}

type TimelineScoringMarker = {
  sequence: number;
  quarter: number;
  elapsedSeconds: number;
  awayScore: number;
  homeScore: number;
};

function buildScoringMarkers(detail: ApiGameDetailExtended): TimelineScoringMarker[] {
  const raw = detail.scoring_plays ?? [];
  if (raw.length === 0) return [];
  return raw
    .map((play, index) => {
      const quarter = safeInt(play.quarter, 0);
      const clock = normalizeClock(
        (play as { clock?: string | null }).clock ?? (quarter > 0 ? '0:00' : '15:00'),
        '0:00'
      );
      return {
        sequence: safeInt(play.sequence, index + 1),
        quarter,
        elapsedSeconds: gameElapsedSeconds(quarter, clock),
        awayScore: safeInt(play.away_score_after, 0),
        homeScore: safeInt(play.home_score_after, 0),
      };
    })
    .filter((marker) => marker.quarter > 0)
    .sort((a, b) =>
      a.elapsedSeconds === b.elapsedSeconds
        ? a.sequence - b.sequence
        : a.elapsedSeconds - b.elapsedSeconds
    );
}

function deriveScoringTimelineFromPlays(
  plays: ApiPlayDetail[],
  awayAbbr: string,
  homeAbbr: string
): Array<{
  sequence: number;
  entry: { q: number; team: string; desc: string; awayScore: number; homeScore: number };
}> {
  if (plays.length === 0) return [];
  const derived: Array<{
    sequence: number;
    entry: { q: number; team: string; desc: string; awayScore: number; homeScore: number };
  }> = [];
  let awayRunning = 0;
  let homeRunning = 0;
  for (const play of plays) {
    const awayAfter = Math.max(awayRunning, safeInt(play.away_score_after, awayRunning));
    const homeAfter = Math.max(homeRunning, safeInt(play.home_score_after, homeRunning));
    const awayDelta = awayAfter - awayRunning;
    const homeDelta = homeAfter - homeRunning;
    if (awayDelta > 0 || homeDelta > 0) {
      const inferredTeam =
        awayDelta > homeDelta
          ? awayAbbr
          : homeDelta > awayDelta
            ? homeAbbr
            : normalizeAbbr(play.possession_team_abbr) || '';
      derived.push({
        sequence: safeInt(play.sequence, derived.length + 1),
        entry: {
          q: Math.max(1, safeInt(play.quarter, 1)),
          team: inferredTeam,
          desc: (play.short_description || play.description || `${inferredTeam || 'TEAM'} scores`)
            .replace(/\s+/g, ' ')
            .trim(),
          awayScore: awayAfter,
          homeScore: homeAfter,
        },
      });
    }
    awayRunning = awayAfter;
    homeRunning = homeAfter;
  }
  return derived;
}

function mergeScoringTimelines(
  canonical: Array<{
    sequence: number;
    entry: { q: number; team: string; desc: string; awayScore: number; homeScore: number };
  }>,
  derived: Array<{
    sequence: number;
    entry: { q: number; team: string; desc: string; awayScore: number; homeScore: number };
  }>
): Array<{
  sequence: number;
  entry: { q: number; team: string; desc: string; awayScore: number; homeScore: number };
}> {
  if (canonical.length === 0) return derived;
  if (derived.length === 0) return canonical;
  const seenScoreKey = new Set(
    canonical.map((item) => `${item.entry.awayScore}-${item.entry.homeScore}`)
  );
  const merged = [...canonical];
  for (const item of derived) {
    const scoreKey = `${item.entry.awayScore}-${item.entry.homeScore}`;
    if (seenScoreKey.has(scoreKey)) continue;
    merged.push(item);
    seenScoreKey.add(scoreKey);
  }
  return merged.sort((a, b) => a.sequence - b.sequence);
}

function resolveInitialPlayIndex(
  playParam: string | null,
  playSeqParam: string | null,
  playSequences: number[],
  totalFrames: number
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
  signal: AbortSignal
): Promise<{ detail: ApiGameDetailExtended; resolvedGameId: string }> {
  try {
    const detail = await fetchJson<ApiGameDetailExtended>(
      `${API_BASE}/games/${requestedGameId}/`,
      signal
    );
    return { detail, resolvedGameId: String(detail.id ?? requestedGameId) };
  } catch (error) {
    if (!isHttp404(error)) throw error;
  }

  const lookupFields = ['espn_event_id', 'nflverse_game_id'] as const;
  for (const field of lookupFields) {
    try {
      const encoded = encodeURIComponent(requestedGameId);
      const payload = await fetchJson<
        | ApiCursorPage<ApiGameDetailExtended>
        | { results?: ApiGameDetailExtended[] }
        | ApiGameDetailExtended[]
      >(`${API_BASE}/games/?${field}=${encoded}&page_size=1`, signal);
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
    const pageData: ApiCursorPage<ApiPlayDetail> = await fetchJson<ApiCursorPage<ApiPlayDetail>>(
      nextUrl,
      signal
    );
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

function registerDisplayNameAlias(
  displayNameByShortKey: Map<string, string>,
  rawName: string
): void {
  const name = rawName.trim();
  if (!name) return;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return;
  const shortKey = abbreviatedNameKey(name);
  if (!shortKey) return;
  const existing = displayNameByShortKey.get(shortKey);
  if (!existing || existing.length < name.length) {
    displayNameByShortKey.set(shortKey, name);
  }
}

async function fetchTeamRosterHydrationData(
  detail: ApiGameDetailExtended,
  signal: AbortSignal
): Promise<TeamRosterHydrationData> {
  const teamAbbrs = Array.from(
    new Set([
      normalizeAbbr(detail.away_team_detail?.abbreviation),
      normalizeAbbr(detail.home_team_detail?.abbreviation),
    ])
  ).filter(Boolean);
  const byName = new Map<string, string>();
  const displayNameByShortKey = new Map<string, string>();

  const registerName = (name: string, headshotUrl: string) => {
    const fullKey = normalizeNameKey(name);
    const shortKey = abbreviatedNameKey(name);
    if (fullKey && !byName.has(fullKey)) byName.set(fullKey, headshotUrl);
    if (shortKey && !byName.has(shortKey)) byName.set(shortKey, headshotUrl);
    registerDisplayNameAlias(displayNameByShortKey, name);
  };

  await Promise.all(
    teamAbbrs.map(async (abbr) => {
      const payload = await fetchJson<TeamRosterPlayer[] | { results?: TeamRosterPlayer[] }>(
        `${API_BASE}/teams/${abbr}/roster/`,
        signal
      );
      const roster = toResultsArray(payload);
      for (const player of roster) {
        const headshotUrl = player.headshot_url?.trim();
        if (!headshotUrl) continue;
        const displayName = (player.display_name ?? '').trim();
        const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim();
        if (displayName) registerName(displayName, headshotUrl);
        if (fullName) registerName(fullName, headshotUrl);
      }
    })
  );

  return { headshotsByName: byName, displayNameByShortKey };
}

function applyFantasyHeadshots(
  entries: LiveGameState['fantasyAway'],
  headshotsByName: Map<string, string>
): LiveGameState['fantasyAway'] {
  return entries.map((entry) => {
    if (entry.position === 'DEF' || entry.headshotUrl) return entry;
    const fullKey = normalizeNameKey(entry.name);
    const shortKey = abbreviatedNameKey(entry.name);
    const headshotUrl = headshotsByName.get(fullKey) ?? headshotsByName.get(shortKey);
    if (!headshotUrl) return entry;
    return { ...entry, headshotUrl };
  });
}

function isLikelyAbbreviatedPlayerName(rawName: string): boolean {
  const name = rawName.trim();
  if (!name) return false;
  const firstToken = name.split(/\s+/)[0] ?? '';
  return firstToken.includes('.');
}

function expandPlayerDisplayName(name: string, displayNameByShortKey: Map<string, string>): string {
  if (!isLikelyAbbreviatedPlayerName(name)) return name;
  const shortKey = abbreviatedNameKey(name);
  if (!shortKey) return name;
  return displayNameByShortKey.get(shortKey) ?? name;
}

function applyFantasyDisplayNames(
  entries: LiveGameState['fantasyAway'],
  displayNameByShortKey: Map<string, string>
): LiveGameState['fantasyAway'] {
  return entries.map((entry) => {
    if (entry.position === 'DEF') return entry;
    const expandedName = expandPlayerDisplayName(entry.name, displayNameByShortKey);
    if (expandedName === entry.name) return entry;
    return { ...entry, name: expandedName };
  });
}

function applyPersonnelDisplayNames(
  personnel: LiveGameState['personnel'],
  displayNameByShortKey: Map<string, string>
): LiveGameState['personnel'] {
  if (!personnel) return personnel;
  const mapTeam = (team: NonNullable<LiveGameState['personnel']>['away']) => ({
    ...team,
    players: team.players.map((player) => {
      const baseName = player.displayName ?? player.playerName;
      const expandedName = expandPlayerDisplayName(baseName, displayNameByShortKey);
      if (expandedName === baseName) return player;
      return {
        ...player,
        displayName: expandedName,
        playerName: expandedName,
      };
    }),
  });
  return {
    ...personnel,
    away: mapTeam(personnel.away),
    home: mapTeam(personnel.home),
  };
}

function applyLeaderDisplayNames(
  leaders: LiveGameState['leaders'],
  displayNameByShortKey: Map<string, string>
): LiveGameState['leaders'] {
  if (!leaders) return leaders;
  const mapEntry = (entry: {
    name: string;
    line: string;
    headshotUrl?: string;
    gsisId?: string;
  }) => {
    if (entry.name === '—') return entry;
    const expandedName = expandPlayerDisplayName(entry.name, displayNameByShortKey);
    return expandedName === entry.name ? entry : { ...entry, name: expandedName };
  };
  return {
    away: {
      passing: mapEntry(leaders.away.passing),
      rushing: mapEntry(leaders.away.rushing),
      receiving: mapEntry(leaders.away.receiving),
    },
    home: {
      passing: mapEntry(leaders.home.passing),
      rushing: mapEntry(leaders.home.rushing),
      receiving: mapEntry(leaders.home.receiving),
    },
  };
}

function buildPlayerGsisLookup(
  playerStatsByTeam: Record<string, ApiPlayerGameStats[]> | undefined
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const rows of Object.values(playerStatsByTeam ?? {})) {
    for (const row of rows ?? []) {
      const gsisId = row.player_gsis_id?.trim();
      const playerName = (row.player_name ?? '').trim();
      if (!gsisId || !playerName) continue;
      const fullKey = normalizeNameKey(playerName);
      const shortKey = abbreviatedNameKey(playerName);
      if (fullKey && !lookup.has(fullKey)) lookup.set(fullKey, gsisId);
      if (shortKey && !lookup.has(shortKey)) lookup.set(shortKey, gsisId);
    }
  }
  return lookup;
}

function applyLeaderGsisIds(
  leaders: LiveGameState['leaders'],
  playerGsisByName: Map<string, string>
): LiveGameState['leaders'] {
  if (!leaders || playerGsisByName.size === 0) return leaders;
  const mapEntry = (entry: {
    name: string;
    line: string;
    headshotUrl?: string;
    gsisId?: string;
  }) => {
    if (entry.name === '—' || entry.gsisId) return entry;
    const fullKey = normalizeNameKey(entry.name);
    const shortKey = abbreviatedNameKey(entry.name);
    const gsisId = playerGsisByName.get(fullKey) ?? playerGsisByName.get(shortKey);
    return gsisId ? { ...entry, gsisId } : entry;
  };
  return {
    away: {
      passing: mapEntry(leaders.away.passing),
      rushing: mapEntry(leaders.away.rushing),
      receiving: mapEntry(leaders.away.receiving),
    },
    home: {
      passing: mapEntry(leaders.home.passing),
      rushing: mapEntry(leaders.home.rushing),
      receiving: mapEntry(leaders.home.receiving),
    },
  };
}

function applyPlayActorDisplayNames(
  lastPlay: LiveGameState['lastPlay'],
  displayNameByShortKey: Map<string, string>
): LiveGameState['lastPlay'] {
  if (!lastPlay) return lastPlay;
  const mapActor = (actor: NonNullable<LiveGameState['lastPlay']>['actor']) => {
    if (!actor) return actor;
    const expandedName = expandPlayerDisplayName(actor.name, displayNameByShortKey);
    return expandedName === actor.name ? actor : { ...actor, name: expandedName };
  };
  const receiver = lastPlay.receiver
    ? (() => {
        const expandedName = expandPlayerDisplayName(lastPlay.receiver.name, displayNameByShortKey);
        if (expandedName === lastPlay.receiver.name) return lastPlay.receiver;
        return { ...lastPlay.receiver, name: expandedName };
      })()
    : lastPlay.receiver;
  return {
    ...lastPlay,
    receiver,
    actor: mapActor(lastPlay.actor),
    qbActor: mapActor(lastPlay.qbActor),
    postScoreTryActor: mapActor(lastPlay.postScoreTryActor),
    postScoreTryQbActor: mapActor(lastPlay.postScoreTryQbActor),
  };
}

function hydrateTimelinePlayerDisplayNames(
  timeline: ReplayTimeline,
  displayNameByShortKey: Map<string, string>
): ReplayTimeline {
  if (displayNameByShortKey.size === 0) return timeline;
  const hydrateState = (state: LiveGameState): LiveGameState => ({
    ...state,
    fantasyAway: applyFantasyDisplayNames(state.fantasyAway, displayNameByShortKey),
    fantasyHome: applyFantasyDisplayNames(state.fantasyHome, displayNameByShortKey),
    personnel: applyPersonnelDisplayNames(state.personnel, displayNameByShortKey),
    leaders: applyLeaderDisplayNames(state.leaders, displayNameByShortKey),
    lastPlay: applyPlayActorDisplayNames(state.lastPlay, displayNameByShortKey),
  });
  return {
    ...timeline,
    liveState: hydrateState(timeline.liveState),
    frames: timeline.frames.map((frame) => hydrateState(frame)),
  };
}

function applyPersonnelHeadshots(
  personnel: LiveGameState['personnel'],
  headshotsByName: Map<string, string>
): LiveGameState['personnel'] {
  if (!personnel) return personnel;
  const mapTeam = (team: NonNullable<LiveGameState['personnel']>['away']) => ({
    ...team,
    players: team.players.map((player) => {
      if (player.headshotUrl) return player;
      const baseName = player.displayName ?? player.playerName;
      const fullKey = normalizeNameKey(baseName);
      const shortKey = abbreviatedNameKey(baseName);
      const headshotUrl = headshotsByName.get(fullKey) ?? headshotsByName.get(shortKey);
      if (!headshotUrl) return player;
      return { ...player, headshotUrl };
    }),
  });
  return {
    ...personnel,
    away: mapTeam(personnel.away),
    home: mapTeam(personnel.home),
  };
}

function hydrateTimelineFantasyHeadshots(
  timeline: ReplayTimeline,
  headshotsByName: Map<string, string>
): ReplayTimeline {
  if (headshotsByName.size === 0) return timeline;
  const hydrateState = (state: LiveGameState): LiveGameState => ({
    ...state,
    fantasyAway: applyFantasyHeadshots(state.fantasyAway, headshotsByName),
    fantasyHome: applyFantasyHeadshots(state.fantasyHome, headshotsByName),
    personnel: applyPersonnelHeadshots(state.personnel, headshotsByName),
  });
  return {
    ...timeline,
    liveState: hydrateState(timeline.liveState),
    frames: timeline.frames.map((frame) => hydrateState(frame)),
  };
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
  headshotsByName?: Map<string, string>,
  personnel?: ApiGamePersonnel | null
): ReplayTimeline {
  const ctx = apiGameToContext(detail);

  const awayAbbr = normalizeAbbr(ctx.awayTeam.abbreviation);
  const homeAbbr = normalizeAbbr(ctx.homeTeam.abbreviation);
  const personnelState = mapPersonnelFromApi(personnel ?? null, awayAbbr, homeAbbr);

  const status = normalizeStatus(ctx.status);
  const finalGame = isFinalStatus(status);

  const awayScoreFinal: ScoreByQuarter = ctx.awayScoreByQuarter ?? {
    q1: 0,
    q2: 0,
    q3: 0,
    q4: 0,
    ot: 0,
    total: ctx.awayScore,
  };
  const homeScoreFinal: ScoreByQuarter = ctx.homeScoreByQuarter ?? {
    q1: 0,
    q2: 0,
    q3: 0,
    q4: 0,
    ot: 0,
    total: ctx.homeScore,
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
  const defenseFantasyTotalsFinal = deriveDefenseFantasyTotalsFromPlays(plays, awayAbbr, homeAbbr, {
    away: awayScoreFinal.total,
    home: homeScoreFinal.total,
  });

  const teamStats =
    mapTeamStats(boxscore?.team_stats, awayAbbr, homeAbbr) ??
    mapTeamStatsFromPlays(plays, drives, awayAbbr, homeAbbr);
  const leadersFromDetail = mapLeaders(detail.leaders, awayAbbr, homeAbbr, headshotsByName);
  const leadersFromBoxscore = mapLeaders(boxscore?.leaders, awayAbbr, homeAbbr, headshotsByName);
  const leadersFromPlayers = mapLeadersFromPlayerStats(
    boxscore?.player_stats,
    awayAbbr,
    homeAbbr,
    headshotsByName
  );
  const leadersFromPlays = mapLeadersFromRunningTotals(
    derivedTotalsByKey,
    derivedPlayerMetaByFullKey,
    awayAbbr,
    homeAbbr,
    headshotsByName
  );
  const leaders = hasLeaderData(leadersFromDetail)
    ? leadersFromDetail
    : hasLeaderData(leadersFromBoxscore)
      ? leadersFromBoxscore
      : hasLeaderData(leadersFromPlayers)
        ? leadersFromPlayers
        : hasLeaderData(leadersFromPlays)
          ? leadersFromPlays
          : null;
  const playerGsisByName = buildPlayerGsisLookup(boxscore?.player_stats);
  const leadersWithGsis = applyLeaderGsisIds(leaders, playerGsisByName);
  const scoringCanonical = scoringTimeline(detail.scoring_plays);
  const scoringDerived = deriveScoringTimelineFromPlays(plays, awayAbbr, homeAbbr);
  const scoringBySequence = mergeScoringTimelines(scoringCanonical, scoringDerived);
  const scoring = scoringBySequence.map((item) => item.entry);
  const scoringMarkers = buildScoringMarkers(detail);
  const hasPlayScores = plays.some(
    (play) => safeInt(play.away_score_after, 0) > 0 || safeInt(play.home_score_after, 0) > 0
  );
  const shouldPreferDerivedScores =
    !hasPlayScores &&
    scoringMarkers.length > 0 &&
    (awayScoreFinal.total > 0 || homeScoreFinal.total > 0);
  const fantasyFromBoxscore = mapFantasy(boxscore?.player_stats, awayAbbr, homeAbbr);
  const fantasyFromPlays = mapFantasyFromRunningTotals(
    derivedTotalsByKey,
    derivedPlayerMetaByFullKey,
    awayAbbr,
    homeAbbr,
    playerStatsLookup,
    teamStats,
    { away: awayScoreFinal.total, home: homeScoreFinal.total },
    defenseFantasyTotalsFinal
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
  const baseWpSample: AwayWinProbSample = plays[0]
    ? resolveAwayWinProbSampleFromPlay(plays[0], 50)
    : finalGame
      ? {
          wp: resolveFinalAwayWinPct(awayScoreFinal.total, homeScoreFinal.total),
          source: 'fallback',
        }
      : { wp: 50, source: 'fallback' };
  const baseWp = baseWpSample.wp;

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
    attendance:
      typeof ctx.attendance === 'number' && Number.isFinite(ctx.attendance)
        ? Math.max(0, Math.round(ctx.attendance))
        : null,
    referee: (ctx.referee ?? '').trim(),
    officials: (ctx.officials ?? [])
      .filter((official) => (official.name ?? '').trim().length > 0)
      .sort(
        (left, right) =>
          safeInt(left.sequence, Number.MAX_SAFE_INTEGER) -
          safeInt(right.sequence, Number.MAX_SAFE_INTEGER)
      ),
    network: ctx.network ?? '',
    spread: ctx.spread ?? null,
    wpTimeline: [
      {
        wp: baseWp,
        gameMin: Math.max(0, timing.elapsedMin),
        wpLow: baseWpSample.wpLow,
        wpHigh: baseWpSample.wpHigh,
        source: baseWpSample.source,
      },
    ],
    awayWinPct: baseWp,
    epaTotals: { away: 0, home: 0 },
    epaTimeline: [
      {
        gameMin: 0,
        awayTotal: 0,
        homeTotal: 0,
        awayPass: 0,
        awayRush: 0,
        homePass: 0,
        homeRush: 0,
      },
    ],
    lastPlay: null,
    animationKey: 0,
    plays: [],
    fantasyAway: fantasy.away,
    fantasyHome: fantasy.home,
    playerSeasonStats: {},
    fantasyScoring: 'half_ppr',
    personnel: personnelState,
    homeTimeouts: 3,
    awayTimeouts: 3,
    teamStats,
    leaders: leadersWithGsis,
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
  const wpTimelinePoints: LiveGameState['wpTimeline'] = [
    {
      wp: baseWp,
      gameMin: 0,
      wpLow: baseWpSample.wpLow,
      wpHigh: baseWpSample.wpHigh,
      source: baseWpSample.source,
    },
  ];
  const epaTimelinePoints: NonNullable<LiveGameState['epaTimeline']> = [
    {
      gameMin: 0,
      awayTotal: 0,
      homeTotal: 0,
      awayPass: 0,
      awayRush: 0,
      homePass: 0,
      homeRush: 0,
    },
  ];
  const runningTotalsByKey = new Map<string, RunningPlayerTotals>();
  const playerMetaByFullKey = new Map<string, RunningPlayerMeta>();
  let scoringMarkerIndex = 0;
  let inferredAwayScore = 0;
  let inferredHomeScore = 0;

  const awayScoreRunning: ScoreByQuarter = { q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, total: 0 };
  const homeScoreRunning: ScoreByQuarter = { q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, total: 0 };
  let awayTotal = 0;
  let homeTotal = 0;
  let awayTotalEpa = 0;
  let homeTotalEpa = 0;
  let awayPassEpa = 0;
  let awayRushEpa = 0;
  let homePassEpa = 0;
  let homeRushEpa = 0;
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
    const explicitAwayTimeouts = normalizeTimeoutCount(play.away_timeouts_remaining);
    const explicitHomeTimeouts = normalizeTimeoutCount(play.home_timeouts_remaining);
    if (
      playQuarter >= 3 &&
      lastQuarter < 3 &&
      explicitAwayTimeouts == null &&
      explicitHomeTimeouts == null
    ) {
      awayTimeouts = 3;
      homeTimeouts = 3;
    }
    lastQuarter = Math.max(1, playQuarter);

    if (explicitAwayTimeouts != null) awayTimeouts = explicitAwayTimeouts;
    if (explicitHomeTimeouts != null) homeTimeouts = explicitHomeTimeouts;

    const timeoutUsage = parseTimeoutUsage(play, awayAbbr, homeAbbr);
    if (timeoutUsage) {
      if (timeoutUsage.awayRemaining != null) {
        awayTimeouts = timeoutUsage.awayRemaining;
      } else if (timeoutUsage.team === awayAbbr && explicitAwayTimeouts == null) {
        awayTimeouts = Math.max(0, awayTimeouts - 1);
      }
      if (timeoutUsage.homeRemaining != null) {
        homeTimeouts = timeoutUsage.homeRemaining;
      } else if (timeoutUsage.team === homeAbbr && explicitHomeTimeouts == null) {
        homeTimeouts = Math.max(0, homeTimeouts - 1);
      }
    }

    const playClock = normalizeClock(play.clock, '0:00');
    const elapsedSeconds = gameElapsedSeconds(Math.max(playQuarter, 1), playClock);
    while (
      scoringMarkerIndex < scoringMarkers.length &&
      (scoringMarkers[scoringMarkerIndex]?.elapsedSeconds ?? Number.POSITIVE_INFINITY) <=
        elapsedSeconds
    ) {
      const marker = scoringMarkers[scoringMarkerIndex]!;
      inferredAwayScore = marker.awayScore;
      inferredHomeScore = marker.homeScore;
      scoringMarkerIndex += 1;
    }
    const playAwayAfter = safeInt(play.away_score_after, awayTotal);
    const playHomeAfter = safeInt(play.home_score_after, homeTotal);
    const markerAdvanced = inferredAwayScore !== awayTotal || inferredHomeScore !== homeTotal;
    const shouldUseMarkerScores =
      shouldPreferDerivedScores ||
      (markerAdvanced && playAwayAfter === awayTotal && playHomeAfter === homeTotal);
    let awayAfter = shouldUseMarkerScores ? inferredAwayScore : playAwayAfter;
    let homeAfter = shouldUseMarkerScores ? inferredHomeScore : playHomeAfter;
    awayAfter = Math.max(awayAfter, awayTotal);
    homeAfter = Math.max(homeAfter, homeTotal);
    const playEpa = normalizeEpaValue(play.epa);
    const canonicalAwayTotalEpa = normalizeEpaValue(play.total_away_epa);
    const canonicalHomeTotalEpa = normalizeEpaValue(play.total_home_epa);
    const offenseTeam = normalizeAbbr(play.possession_team_abbr);
    const passEpaPlay = isPassEpaPlay(play);
    const rushEpaPlay = isRushEpaPlay(play);

    if (canonicalAwayTotalEpa != null) {
      awayTotalEpa = canonicalAwayTotalEpa;
    } else if (playEpa != null && offenseTeam === awayAbbr) {
      awayTotalEpa += playEpa;
    }
    if (canonicalHomeTotalEpa != null) {
      homeTotalEpa = canonicalHomeTotalEpa;
    } else if (playEpa != null && offenseTeam === homeAbbr) {
      homeTotalEpa += playEpa;
    }
    if (playEpa != null) {
      if (offenseTeam === awayAbbr) {
        if (passEpaPlay) awayPassEpa += playEpa;
        else if (rushEpaPlay) awayRushEpa += playEpa;
      } else if (offenseTeam === homeAbbr) {
        if (passEpaPlay) homePassEpa += playEpa;
        else if (rushEpaPlay) homeRushEpa += playEpa;
      }
    }

    let awayDelta = awayAfter - awayTotal;
    let homeDelta = homeAfter - homeTotal;

    if (awayDelta !== 0) applyScoreDelta(awayScoreRunning, playQuarter, awayDelta);
    if (homeDelta !== 0) applyScoreDelta(homeScoreRunning, playQuarter, homeDelta);

    awayTotal = awayAfter;
    homeTotal = homeAfter;
    awayScoreRunning.total = awayAfter;
    homeScoreRunning.total = homeAfter;

    const timingNow = computeGameProgress(Math.max(playQuarter, 1), playClock, playQuarter > 4);

    const possessionAfter = resolvePossessionAfter(play, nextSnapPlay, awayAbbr, homeAbbr);
    const possessionAtSnap = normalizeAbbr(play.possession_team_abbr) || possessionAfter;
    const situationSource = timeoutFrame && nextSnapPlay ? nextSnapPlay : play;
    const situationPossession =
      timeoutFrame && nextSnapPlay
        ? normalizeAbbr(nextSnapPlay.possession_team_abbr) || possessionAfter
        : possessionAtSnap;
    const situationSpot = yardline100ToDisplay(
      situationSource.yard_line,
      situationPossession,
      awayAbbr,
      homeAbbr
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
      const driveTeam =
        normalizeAbbr(driveMeta?.team_abbr) || normalizeAbbr(nextSnapPlay.possession_team_abbr);
      const driveStartPlay = driveStartById.get(timeoutDriveId);
      const driveTransition = normalizeDriveStartTransition(driveStartPlay?.drive_start_transition);
      const start = resolveDriveStartSpot(
        driveMeta,
        driveStartPlay,
        nextSnapPlay,
        driveTeam,
        awayAbbr,
        homeAbbr
      );
      currentDrive = {
        plays: previous.plays,
        yards: previous.yards,
        time: '0:00',
        startYardLine: start.yardLine,
        startSide: start.side,
        team: driveTeam,
        startTransition: driveTransition || undefined,
      };
    } else if (timeoutFrame) {
      currentDrive = frames[frames.length - 1]?.currentDrive
        ? { ...frames[frames.length - 1]!.currentDrive! }
        : null;
    }
    if (!timeoutFrame && play.drive_id != null) {
      const previous = driveProgress.get(play.drive_id) ?? { plays: 0, yards: 0 };
      const shouldCountPlay = isSnapPlay(play);
      const driveStartPlay = driveStartById.get(play.drive_id);

      // Cumulative yards: add yards_gained for each counted play so that
      // plays and yards are both post-play values for the same frame.
      const yards = shouldCountPlay
        ? previous.yards + safeInt(play.yards_gained, 0)
        : previous.yards;

      const updated = {
        plays: previous.plays + (shouldCountPlay ? 1 : 0),
        yards,
      };
      driveProgress.set(play.drive_id, updated);

      const driveMeta = drivesById.get(play.drive_id);
      const driveTeam =
        normalizeAbbr(driveMeta?.team_abbr) || normalizeAbbr(play.possession_team_abbr);
      const driveTransition = normalizeDriveStartTransition(driveStartPlay?.drive_start_transition);
      // Use next snap play's clock if it's in the same drive to get post-play
      // elapsed time (consistent with plays/yards also being post-play values).
      const timeRefPlay =
        nextSnapPlay && nextSnapPlay.drive_id === play.drive_id ? nextSnapPlay : play;
      const elapsedDriveTime = driveElapsedAtPlay(driveStartPlay, timeRefPlay);
      const start = resolveDriveStartSpot(
        driveMeta,
        driveStartPlay,
        play,
        driveTeam,
        awayAbbr,
        homeAbbr
      );

      currentDrive = {
        plays: updated.plays,
        yards: updated.yards,
        time: elapsedDriveTime || driveMeta?.time_elapsed || '0:00',
        startYardLine: start.yardLine,
        startSide: start.side,
        team: driveTeam,
        startTransition: driveTransition || undefined,
      };
    }

    const previousPoint = wpTimelinePoints[wpTimelinePoints.length - 1];
    const fallbackWp = previousPoint?.wp ?? baseWp;
    const awayWinProbSample = resolveAwayWinProbSampleFromPlay(
      { ...play, away_score_after: awayAfter, home_score_after: homeAfter, quarter: playQuarter },
      fallbackWp
    );
    const awayWinPct = awayWinProbSample.wp;
    const elapsedMin = Math.max(previousPoint?.gameMin ?? 0, timingNow.elapsedMin);
    if (
      !previousPoint ||
      previousPoint.gameMin !== elapsedMin ||
      previousPoint.wp !== awayWinPct ||
      previousPoint.wpLow !== awayWinProbSample.wpLow ||
      previousPoint.wpHigh !== awayWinProbSample.wpHigh
    ) {
      wpTimelinePoints.push({
        wp: awayWinPct,
        gameMin: elapsedMin,
        wpLow: awayWinProbSample.wpLow,
        wpHigh: awayWinProbSample.wpHigh,
        source: awayWinProbSample.source,
      });
    }
    const previousEpaPoint = epaTimelinePoints[epaTimelinePoints.length - 1];
    if (
      !previousEpaPoint ||
      previousEpaPoint.gameMin !== elapsedMin ||
      previousEpaPoint.awayTotal !== awayTotalEpa ||
      previousEpaPoint.homeTotal !== homeTotalEpa ||
      previousEpaPoint.awayPass !== awayPassEpa ||
      previousEpaPoint.awayRush !== awayRushEpa ||
      previousEpaPoint.homePass !== homePassEpa ||
      previousEpaPoint.homeRush !== homeRushEpa
    ) {
      epaTimelinePoints.push({
        gameMin: elapsedMin,
        awayTotal: awayTotalEpa,
        homeTotal: homeTotalEpa,
        awayPass: awayPassEpa,
        awayRush: awayRushEpa,
        homePass: homePassEpa,
        homeRush: homeRushEpa,
      });
    }

    const frameStatus: GameStatus = play.play_type === 'end_of_half' ? 'halftime' : 'in_progress';
    const frameScoring = scoringUpToState(scoringBySequence, awayAfter, homeAfter);
    const frameTeamStats = mapTeamStatsFromPlays(plays.slice(0, index + 1), [], awayAbbr, homeAbbr);
    const frameLeadersRaw = mapLeadersFromRunningTotals(
      runningTotalsByKey,
      playerMetaByFullKey,
      awayAbbr,
      homeAbbr,
      headshotsByName
    );
    const frameLeaders = applyLeaderGsisIds(frameLeadersRaw, playerGsisByName);
    const frameFantasy = mapFantasyFromRunningTotals(
      runningTotalsByKey,
      playerMetaByFullKey,
      awayAbbr,
      homeAbbr,
      playerStatsLookup,
      frameTeamStats,
      { away: awayAfter, home: homeAfter },
      deriveDefenseFantasyTotalsFromPlays(plays.slice(0, index + 1), awayAbbr, homeAbbr, {
        away: awayAfter,
        home: homeAfter,
      })
    );
    const playAnimation = toPlayAnimation(
      play,
      nextSnapPlay,
      awayAbbr,
      homeAbbr,
      playerStatsLookup,
      runningTotalsByKey,
      runningTotalsBeforeByKey,
      headshotsByName
    );

    if (!timeoutFrame && playAnimation == null && (situation.yardLine <= 0 || !situation.side)) {
      const previousSituation = frames[frames.length - 1]?.situation;
      if (previousSituation && previousSituation.yardLine > 0 && previousSituation.side) {
        situation = { ...previousSituation };
      }
    }

    const framePossession = timeoutFrame
      ? (frames[frames.length - 1]?.possession ??
        toPossessionSide(possessionAfter, awayAbbr, homeAbbr))
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
      epaTotals: {
        away: awayTotalEpa,
        home: homeTotalEpa,
      },
      epaTimeline: epaTimelinePoints.map((point) => ({ ...point })),
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

  const lastFrame =
    [...frames]
      .reverse()
      .find((frame) => frame.situation.yardLine > 0 || frame.lastPlay !== null) ??
    frames[frames.length - 1] ??
    baseState;
  const latestAwayWinPct = wpTimelinePoints[wpTimelinePoints.length - 1]?.wp ?? baseWp;
  const finalAwayWinPct = finalGame
    ? resolveFinalAwayWinPct(awayScoreFinal.total, homeScoreFinal.total)
    : latestAwayWinPct;

  const liveState: LiveGameState = {
    ...lastFrame,
    status,
    awayScore: awayScoreFinal,
    homeScore: homeScoreFinal,
    timing,
    wpTimeline: wpTimelinePoints,
    awayWinPct: finalAwayWinPct,
    epaTimeline: epaTimelinePoints,
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
      liveState.wpTimeline = [
        ...liveState.wpTimeline,
        { wp: finalAwayWinPct, gameMin: finalMinute },
      ];
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
  const playSeqParam =
    searchParams.get('play_seq') ?? searchParams.get('seq') ?? searchParams.get('sequence');

  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [state, setState] = useState<LiveGameState | null>(null);
  const [resolvedDbGameId, setResolvedDbGameId] = useState<string | null>(null);
  const [season, setSeason] = useState<number | undefined>();
  const [week, setWeek] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quarterJumps = useMemo(
    () => (timeline ? buildQuarterJumps(timeline.frames) : buildQuarterJumps([])),
    [timeline]
  );

  useEffect(() => {
    if (!gameId) {
      setTimeline(null);
      setState(null);
      setResolvedDbGameId(null);
      return;
    }
    const requestedGameId: string = gameId;

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setResolvedDbGameId(null);

    async function load() {
      try {
        const { detail, resolvedGameId } = await fetchGameDetailWithFallback(
          requestedGameId,
          controller.signal
        );

        const [plays, drives, boxscore, personnel, rosterHydration] = await Promise.all([
          fetchAllPlays(resolvedGameId, controller.signal).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn('[gridstream] plays hydration failed, continuing with empty plays:', err);
            return [];
          }),
          fetchJson<ApiDrive[]>(
            `${API_BASE}/games/${resolvedGameId}/drives/`,
            controller.signal
          ).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn(
              '[gridstream] drives hydration failed, continuing without drive data:',
              err
            );
            return [];
          }),
          fetchJson<ApiBoxscore>(
            `${API_BASE}/games/${resolvedGameId}/boxscore/`,
            controller.signal
          ).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn(
              '[gridstream] boxscore hydration failed, continuing without boxscore:',
              err
            );
            return null;
          }),
          fetchJson<ApiGamePersonnel>(
            `${API_BASE}/games/${resolvedGameId}/personnel/`,
            controller.signal
          ).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn(
              '[gridstream] personnel hydration failed, continuing without personnel tab data:',
              err
            );
            return null;
          }),
          fetchTeamRosterHydrationData(detail, controller.signal).catch((err) => {
            if (isAbortError(err)) throw err;
            console.warn(
              '[gridstream] roster headshot hydration failed, continuing without fallback headshots:',
              err
            );
            return {
              headshotsByName: new Map<string, string>(),
              displayNameByShortKey: new Map<string, string>(),
            };
          }),
        ]);
        const rosterHeadshots = rosterHydration.headshotsByName;
        const rosterDisplayNameAliases = rosterHydration.displayNameByShortKey;

        // Supplement rosterHeadshots with game-specific data — catches historical
        // players no longer on the current roster (e.g. traded players, free agents).
        const addDisplayAlias = (name: string) => {
          registerDisplayNameAlias(rosterDisplayNameAliases, name);
        };
        const addHeadshot = (name: string, url: string) => {
          const fk = normalizeNameKey(name);
          const sk = abbreviatedNameKey(name);
          if (fk && !rosterHeadshots.has(fk)) rosterHeadshots.set(fk, url);
          if (sk && !rosterHeadshots.has(sk)) rosterHeadshots.set(sk, url);
          addDisplayAlias(name);
        };
        for (const teamPlayers of Object.values(boxscore?.player_stats ?? {})) {
          for (const p of teamPlayers) {
            addDisplayAlias(p.player_name);
            const url = p.player_headshot?.trim();
            if (url) addHeadshot(p.player_name, url);
          }
        }
        for (const leader of detail.leaders ?? []) {
          addDisplayAlias(leader.athlete_name);
          const url = leader.athlete_headshot_url?.trim();
          if (url) addHeadshot(leader.athlete_name, url);
        }

        const builtTimeline = buildTimeline(
          detail,
          plays,
          drives,
          boxscore,
          rosterHeadshots,
          personnel
        );
        const withHeadshots = hydrateTimelineFantasyHeadshots(builtTimeline, rosterHeadshots);
        const withExpandedNames = hydrateTimelinePlayerDisplayNames(
          withHeadshots,
          rosterDisplayNameAliases
        );
        setTimeline(withExpandedNames);
        setResolvedDbGameId(resolvedGameId);
        setSeason(detail.season_id);
        setWeek(detail.week);
      } catch (err) {
        if (isAbortError(err)) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setResolvedDbGameId(null);
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

    const initialIndex = resolveInitialPlayIndex(
      playParam,
      playSeqParam,
      timeline.playSequences,
      timeline.frames.length
    );
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

  const onJumpToPlayIndex = useCallback(
    (index: number) => {
      if (!timeline || timeline.frames.length === 0) return;
      if (index < 0 || index >= timeline.frames.length) return;
      setState(cloneState(timeline.frames[index]!));
    },
    [timeline]
  );

  if (!gameId) return <GamePicker />;

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#070b14',
          color: '#5a7a90',
          fontFamily: "'Orbitron', monospace",
          fontSize: 14,
          letterSpacing: '.15em',
        }}
      >
        LOADING GAME DATA...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          minHeight: '100vh',
          background: '#070b14',
          color: '#ff3b4f',
          fontFamily: "'Orbitron', monospace",
          fontSize: 14,
          letterSpacing: '.1em',
        }}
      >
        <span>ERROR: {error}</span>
        <a href="/gridstream/games" style={{ color: '#5a7a90', fontSize: 12 }}>
          ← BACK TO GAME SELECT
        </a>
      </div>
    );
  }

  if (!state) return null;
  const currentPlaySequence = timeline?.playSequences.length
    ? state.playIndex >= 0
      ? (timeline.playSequences[state.playIndex] ?? null)
      : (timeline.playSequences[timeline.playSequences.length - 1] ?? null)
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
      statsGameId={resolvedDbGameId ?? gameId}
    />
  );
}

function GamePicker() {
  const navCards = [
    {
      title: 'Games Database',
      href: '/gridstream/games',
      description: 'Browse full schedules by season and week, then jump straight into replay view.',
      status: 'Live',
    },
    {
      title: 'Players Database',
      href: '/gridstream/players',
      description: 'Track players across seasons with weekly and season-level stat splits.',
      status: 'Scaffolded',
    },
    {
      title: 'Teams',
      href: '/gridstream/teams',
      description: 'Check franchise trends, team metrics, and year-over-year snapshots.',
      status: 'Scaffolded',
    },
    {
      title: 'Fantasy',
      href: '/gridstream/fantasy',
      description: 'Follow fantasy scoring views and prep for future Yahoo/league integrations.',
      status: 'Scaffolded',
    },
  ];

  const quickStats = [
    { label: 'Season Range', value: '1999–2025' },
    { label: 'Game Browser', value: 'Regular + Postseason' },
    { label: 'Replay Mode', value: 'Play-by-play timeline' },
    { label: 'Live View', value: 'Game context + tabs' },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gap: 22,
        minHeight: '100vh',
        background: '#070b14',
        color: '#c7d8e6',
        fontFamily: "'Orbitron', monospace",
        padding: '40px 20px 52px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}>
        <div
          style={{
            fontSize: 13,
            letterSpacing: '.14em',
            color: '#00e5ff',
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          GRIDSTREAM / COMMAND
        </div>
        <div
          style={{
            fontSize: 'clamp(28px, 4.2vw, 52px)',
            fontWeight: 800,
            letterSpacing: '.05em',
            color: '#f3fbff',
            lineHeight: 1.04,
            textTransform: 'uppercase',
          }}
        >
          NFL Data Hub + Replay Engine
        </div>
        <p
          style={{
            marginTop: 12,
            marginBottom: 0,
            maxWidth: 760,
            color: '#88a8c1',
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: 'clamp(16px, 2vw, 20px)',
            lineHeight: 1.35,
          }}
        >
          Use Gridstream as the front door for game replay, player and team research, and fantasy
          workflows. Start with a module below or jump directly into a game ID.
        </p>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        {quickStats.map((stat) => (
          <div
            key={stat.label}
            style={{
              border: '1px solid rgba(0,229,255,.2)',
              background: 'rgba(0,25,45,.55)',
              padding: '12px 14px',
            }}
          >
            <div style={{ color: '#5f84a0', fontSize: 10, letterSpacing: '.1em' }}>
              {stat.label}
            </div>
            <div style={{ marginTop: 6, color: '#d9f3ff', fontSize: 13, fontWeight: 700 }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        }}
      >
        {navCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            style={{
              border: '1px solid rgba(0,229,255,.2)',
              background: 'linear-gradient(180deg, rgba(0,30,55,.62), rgba(0,14,30,.78))',
              padding: '14px 16px',
              textDecoration: 'none',
              color: 'inherit',
              minHeight: 140,
              display: 'grid',
              gap: 10,
              transition: 'border-color 120ms ease, background 120ms ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div
                style={{ color: '#eff8ff', fontSize: 15, fontWeight: 700, letterSpacing: '.05em' }}
              >
                {card.title}
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: card.status === 'Live' ? '#00e5ff' : '#ffb612',
                  border: `1px solid ${card.status === 'Live' ? 'rgba(0,229,255,.35)' : 'rgba(255,182,18,.35)'}`,
                  padding: '3px 6px',
                  letterSpacing: '.08em',
                }}
              >
                {card.status}
              </span>
            </div>
            <div
              style={{
                color: '#7ea3bc',
                fontFamily: "'Rajdhani', sans-serif",
                fontSize: 16,
                lineHeight: 1.3,
              }}
            >
              {card.description}
            </div>
            <div style={{ fontSize: 11, color: '#63dfff', letterSpacing: '.08em' }}>
              OPEN MODULE →
            </div>
          </Link>
        ))}
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          border: '1px solid rgba(0,229,255,.16)',
          background: 'rgba(0,16,34,.6)',
          padding: '14px 16px',
          color: '#7ea3bc',
          fontSize: 13,
        }}
      >
        <div style={{ color: '#d7eaf8', fontSize: 12, letterSpacing: '.1em', marginBottom: 8 }}>
          DIRECT GAME LINK
        </div>
        <div style={{ marginBottom: 8 }}>
          If you already have a game ID, jump straight into replay:
        </div>
        <code
          style={{
            background: 'rgba(0,229,255,.05)',
            padding: '8px 16px',
            border: '1px solid rgba(0,229,255,.12)',
            color: '#00e5ff',
            fontSize: 12,
            display: 'inline-block',
          }}
        >
          /gridstream?game=123
        </code>
        <div style={{ fontSize: 11, marginTop: 10 }}>
          Optional replay index: <code style={{ color: '#00e5ff' }}>&amp;play=0</code> (start),{' '}
          <code style={{ color: '#00e5ff' }}>&amp;play=live</code> (latest)
          <br />
          Direct play sequence: <code style={{ color: '#00e5ff' }}>&amp;play_seq=123</code>
        </div>
        <div style={{ fontSize: 11, marginTop: 8 }}>
          Find game IDs at{' '}
          <a href={`${API_BASE}/games/?season=2024&week=1`} style={{ color: '#00e5ff' }}>
            /api/gridstream/games/
          </a>
        </div>
      </div>
    </div>
  );
}
