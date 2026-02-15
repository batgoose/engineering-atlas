/**
 * Gridstream domain types.
 *
 * These mirror the Go `events` package on the server side and define
 * the client-side state shapes consumed by any frontend framework.
 * Keep this file free of rendering concerns — no React, no CSS, no DOM.
 */

// ─── WebSocket Envelope (mirrors Go events.Envelope) ────────────

export type EventType =
  | 'game_context'
  | 'game_update'
  | 'play'
  | 'scoring_play'
  | 'drive_start'
  | 'drive_end'
  | 'stats_update'
  | 'game_start'
  | 'game_end'
  | 'weather'
  | 'error'
  | 'ping';

export interface Envelope<T = unknown> {
  type: EventType;
  gameId: string;
  ts: number;
  payload: T;
}

// ─── Server Event Payloads (mirror Go structs) ──────────────────

export interface TeamInfo {
  abbreviation: string;
  displayName: string;
  espnId: string;
  color: string;
  altColor: string;
  logoUrl: string;
  record?: string;
  coach?: string;
  startingQb?: string;
}

export interface GameContext {
  gameId: string;
  season: number;
  week: number;
  seasonType: 'REG' | 'POST' | 'PRE';
  gameNote: string;
  gameDate: string;
  gameTime?: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;

  venueName: string;
  venueCity: string;
  isIndoor: boolean;
  surface?: string;

  temperature?: number;
  weatherDesc?: string;
  weatherWind?: string;
  conditionId?: number;

  spread?: number;
  total?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;

  network?: string;
  broadcastNames?: string[];

  status: string;
  quarter: number;
  clock: string;
  homeScore: number;
  awayScore: number;
}

export interface GameUpdate {
  status: string;
  quarter: number;
  clock: string;
  homeScore: number;
  awayScore: number;
  possession?: string;
  spread?: number;
  total?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
}

export interface PlayEvent {
  down: number;
  distance: number;
  yardLine: number;
  downDistText: string;
  possession: string;

  playType: string;
  yardsGained: number;
  description: string;
  shortDesc: string;
  isScoringPlay: boolean;
  isTurnover: boolean;

  homeScore: number;
  awayScore: number;

  endDown?: number;
  endDistance?: number;
  endYardLine?: number;

  driveNumber: number;
  drivePlays: number;
  driveYards: number;
  driveTime?: string;
}

export interface ScoringEvent {
  scoreType: 'TD' | 'FG' | 'PAT' | '2PT' | 'SFTY' | 'D-TD';
  description: string;
  team: string;
  quarter: number;
  clock: string;
  homeScore: number;
  awayScore: number;
}

export interface DriveEvent {
  driveNumber: number;
  team: string;
  startQuarter?: number;
  startClock?: string;
  startYardLine?: number;
  result?: string;
  totalYards?: number;
  playCount?: number;
  timeElapsed?: string;
  isScore?: boolean;
}

export interface StatsUpdate {
  team: string;
  leaders: StatLeader[];
}

export interface StatLeader {
  category: 'passing' | 'rushing' | 'receiving';
  playerName: string;
  playerId?: string;
  headshotUrl?: string;
  jersey?: string;
  position?: string;
  displayValue: string;
}

export interface WeatherUpdate {
  temperature: number;
  condition: string;
  conditionId: number;
  wind: string;
  humidity?: number;
}

export interface ErrorEvent {
  code: string;
  message: string;
}

// ─── Client-Side State (what the UI renders from) ───────────────

export type GameStatus =
  | 'scheduled'
  | 'in_progress'
  | 'halftime'
  | 'end_period'
  | 'delayed'
  | 'final'
  | 'final_ot'
  | 'postponed'
  | 'cancelled';

export interface HudTeam {
  abbr: string;
  name: string;
  displayName: string;
  color: string;        // hex without #
  altColor: string;     // hex without #
  logoUrl: string;
  record: string;
  endzoneName: string;  // "COMMANDERS", "EAGLES"
}

export interface WeatherState {
  temperature: number;
  condition: string;
  wind: string;
  humidity?: number;
  isIndoor: boolean;
}

export interface GameTiming {
  quarter: number;
  clock: string;
  isOT: boolean;
  /** Minutes elapsed from game start (0-60 reg, 0-70 OT) */
  elapsedMin: number;
  /** Total game length in minutes */
  totalMin: number;
}

export interface Situation {
  down: number;
  distance: number;
  yardLine: number;       // yards from own endzone (yardline_100)
  side: string;           // team abbreviation whose side of field
  downDistText: string;
  possessionTeam: string; // team abbreviation
}

export interface DriveProgress {
  plays: number;
  yards: number;
  time: string;
  startYardLine: number;
  startSide: string;
  team: string;
}

export interface WpTimelinePoint {
  /** Away team's win probability (0-100) */
  wp: number;
  /** Minutes elapsed in the game */
  gameMin: number;
}

export interface ScoreByQuarter {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  ot: number;
  total: number;
}

// ─── Play Animation Types ───────────────────────────────────────

export type AnimPlayType =
  | 'pass'
  | 'rush'
  | 'turnover'
  | 'kick'
  | 'fieldgoal';

export type PassDirection = 'left' | 'middle' | 'right';

export type FgResult =
  | 'made'
  | 'wide_left'
  | 'wide_right'
  | 'short'
  | 'blocked';

export interface ReceiverInfo {
  name: string;
  number: number;
  yards: number;
  tds: number;
}

export interface PlayAnimationData {
  type: AnimPlayType;
  direction: PassDirection;
  fromYardline: number;
  fromSide: string;
  toYardline: number;
  toSide: string;
  yardsGained: number;
  airYards?: number;
  isComplete: boolean;
  isFirstDown: boolean;
  isTurnover: boolean;
  turnoverBy?: string;
  receiver?: ReceiverInfo | null;
  fgResult?: FgResult;
  fgDistance?: number;
  description: string;
}

// ─── Fantasy Types ──────────────────────────────────────────────

export type FantasyScoring = 'ppr' | 'half_ppr' | 'standard';

export type PositionGroup = 'QB' | 'WR' | 'RB' | 'TE' | 'K' | 'DEF';

export interface FantasyRosterEntry {
  name: string;
  position: PositionGroup;
  points: number;
  breakdown: string;
}

export interface PlayerSeasonLine {
  gamesPlayed: number;
  avgPoints: number;
  totalPoints: number;
  statLine: string;
  last5: number[];
  positionRank: string;
}

// ─── Mission Log Entry ──────────────────────────────────────────

export interface MissionLogEntry {
  id: string;
  quarter: number;
  clock: string;
  down: string;
  team: string;
  text: string;
  epa: number;
  type: 'play' | 'score' | 'turnover' | 'info';
}

// ─── Aggregate Live Game State ──────────────────────────────────

export interface LiveGameState {
  // Connection
  connected: boolean;
  gameId: string;

  // Teams
  away: HudTeam;
  home: HudTeam;

  // Scores
  status: GameStatus;
  awayScore: ScoreByQuarter;
  homeScore: ScoreByQuarter;
  timing: GameTiming;

  // Situation
  situation: Situation;
  possession: 'home' | 'away' | null;
  currentDrive: DriveProgress | null;

  // Venue & Weather
  venue: string;
  weather: WeatherState;

  // Broadcast
  network: string;
  spread: number | null;

  // Win Probability
  wpTimeline: WpTimelinePoint[];
  awayWinPct: number;

  // Last Play (for animation)
  lastPlay: PlayAnimationData | null;
  animationKey: number;

  // Mission Log
  plays: MissionLogEntry[];

  // Fantasy
  fantasyAway: FantasyRosterEntry[];
  fantasyHome: FantasyRosterEntry[];
  playerSeasonStats: Record<string, PlayerSeasonLine>;
  fantasyScoring: FantasyScoring;

  // Play navigation
  playIndex: number;        // -1 = live (latest)
  playHistoryLength: number;
}
