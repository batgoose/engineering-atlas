/**
 * Gridstream WebSocket store.
 *
 * Singleton that manages the WebSocket connection, parses typed
 * Envelope messages, and maintains a LiveGameState that any
 * framework can subscribe to.
 *
 * This replaces the basic GameEvent store with full event dispatch.
 */

import type {
  Envelope,
  EventType,
  GameContext,
  GameUpdate,
  PlayEvent,
  ScoringEvent,
  DriveEvent,
  StatsUpdate,
  WeatherUpdate,
  ErrorEvent,
  LiveGameState,
  PlayAnimationData,
  MissionLogEntry,
  HudTeam,
  ScoreByQuarter,
  GameStatus,
} from './types';
import { ENDZONE_NAMES } from './constants';
import { classifyPlayAnimation, computeGameProgress } from './transforms';

// ─── Connection Types ───────────────────────────────────────────

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

type StateListener = (state: LiveGameState) => void;
type StatusListener = (status: ConnectionStatus) => void;
type EventListener<T = unknown> = (type: EventType, payload: T) => void;

// ─── Default State ──────────────────────────────────────────────

function createDefaultTeam(): HudTeam {
  return {
    abbr: '',
    name: '',
    displayName: '',
    color: '333333',
    altColor: '666666',
    logoUrl: '',
    record: '',
    endzoneName: '',
  };
}

function createDefaultScore(): ScoreByQuarter {
  return { q1: 0, q2: 0, q3: 0, q4: 0, ot: 0, total: 0 };
}

function createDefaultState(): LiveGameState {
  return {
    connected: false,
    gameId: '',
    away: createDefaultTeam(),
    home: createDefaultTeam(),
    status: 'scheduled',
    awayScore: createDefaultScore(),
    homeScore: createDefaultScore(),
    timing: { quarter: 1, clock: '15:00', isOT: false, elapsedMin: 0, totalMin: 60 },
    situation: {
      down: 0,
      distance: 0,
      yardLine: 0,
      side: '',
      downDistText: '',
      possessionTeam: '',
    },
    possession: null,
    currentDrive: null,
    venue: '',
    weather: {
      temperature: 72,
      condition: 'Clear',
      wind: '',
      humidity: undefined,
      isIndoor: false,
    },
    network: '',
    spread: null,
    wpTimeline: [],
    awayWinPct: 50,
    lastPlay: null,
    animationKey: 0,
    plays: [],
    fantasyAway: [],
    fantasyHome: [],
    playerSeasonStats: {},
    fantasyScoring: 'half_ppr',
    playIndex: -1,
    playHistoryLength: 0,
    homeTimeouts: 3,
    awayTimeouts: 3,
    teamStats: null,
    leaders: null,
    scoring: [],
  };
}

// ─── Store Class ────────────────────────────────────────────────

class GridStreamStore {
  private socket: WebSocket | null = null;
  private stateListeners: Set<StateListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private eventListeners: Set<EventListener> = new Set();
  private connectionStatus: ConnectionStatus = 'closed';
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private state: LiveGameState = createDefaultState();

  // Play history for back/forward navigation
  private playHistory: PlayAnimationData[] = [];

  // ── Connection ──────────────────────────────────────────────

  public connect(url: string) {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (typeof globalThis.WebSocket === 'undefined') return;

    this.setConnectionStatus('connecting');
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.setConnectionStatus('open');
      this.reconnectAttempts = 0;
      this.updateState({ connected: true });
    };

    this.socket.onmessage = (msg) => {
      try {
        const envelope: Envelope = JSON.parse(msg.data);
        this.dispatch(envelope);
      } catch (err) {
        console.error('[GridStream] Failed to parse message', err);
      }
    };

    this.socket.onclose = () => {
      this.socket = null;
      this.setConnectionStatus('closed');
      this.updateState({ connected: false });
      this.scheduleReconnect(url);
    };

    this.socket.onerror = () => {
      this.setConnectionStatus('error');
    };
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setConnectionStatus('closed');
    this.updateState({ connected: false });
  }

  private scheduleReconnect(url: string) {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(url), delay);
  }

  // ── Event Dispatch ──────────────────────────────────────────

  private dispatch(envelope: Envelope) {
    const { type, payload } = envelope;

    switch (type) {
      case 'game_context':
        this.handleGameContext(payload as GameContext);
        break;
      case 'game_update':
        this.handleGameUpdate(payload as GameUpdate);
        break;
      case 'play':
        this.handlePlay(payload as PlayEvent);
        break;
      case 'scoring_play':
        this.handleScoringPlay(payload as ScoringEvent);
        break;
      case 'drive_start':
        this.handleDriveStart(payload as DriveEvent);
        break;
      case 'drive_end':
        this.handleDriveEnd(payload as DriveEvent);
        break;
      case 'stats_update':
        this.handleStatsUpdate(payload as StatsUpdate);
        break;
      case 'weather':
        this.handleWeather(payload as WeatherUpdate);
        break;
      case 'error':
        console.error('[GridStream] Server error:', (payload as ErrorEvent).message);
        break;
      case 'ping':
        break;
      default:
        break;
    }

    // Notify raw event listeners
    this.eventListeners.forEach((fn) => fn(type as EventType, payload));
  }

  // ── Event Handlers ──────────────────────────────────────────

  private handleGameContext(ctx: GameContext) {
    const away = this.teamInfoToHud(ctx.awayTeam);
    const home = this.teamInfoToHud(ctx.homeTeam);
    const timing = computeGameProgress(ctx.quarter, ctx.clock, false);

    this.state = {
      ...this.state,
      gameId: ctx.gameId,
      away,
      home,
      status: ctx.status as GameStatus,
      awayScore: ctx.awayScoreByQuarter ?? {
        q1: 0,
        q2: 0,
        q3: 0,
        q4: 0,
        ot: 0,
        total: ctx.awayScore,
      },
      homeScore: ctx.homeScoreByQuarter ?? {
        q1: 0,
        q2: 0,
        q3: 0,
        q4: 0,
        ot: 0,
        total: ctx.homeScore,
      },
      timing,
      venue: ctx.venueName,
      weather: {
        temperature: ctx.temperature ?? 72,
        condition: ctx.weatherDesc ?? 'Clear',
        wind: ctx.weatherWind ?? '',
        isIndoor: ctx.isIndoor,
      },
      network: ctx.network ?? '',
      spread: ctx.spread ?? null,
      awayWinPct: 50,
    };

    this.notifyState();
  }

  private handleGameUpdate(update: GameUpdate) {
    const timing = computeGameProgress(update.quarter, update.clock, update.quarter > 4);

    const patch: Partial<LiveGameState> = {
      status: update.status as GameStatus,
      timing,
    };

    // Update scores
    patch.awayScore = { ...this.state.awayScore, total: update.awayScore };
    patch.homeScore = { ...this.state.homeScore, total: update.homeScore };

    // Update possession
    if (update.possession) {
      patch.possession = update.possession === this.state.away.abbr ? 'away' : 'home';
      patch.situation = {
        ...this.state.situation,
        possessionTeam: update.possession,
      };
    }

    if (update.spread != null) patch.spread = update.spread;

    this.updateState(patch);
  }

  private handlePlay(play: PlayEvent) {
    const animData = classifyPlayAnimation(play, this.state.away.abbr, this.state.home.abbr);

    // Add to history
    this.playHistory.push(animData);

    // Build mission log entry
    const logEntry: MissionLogEntry = {
      id: `play-${Date.now()}-${this.state.plays.length}`,
      quarter: this.state.timing.quarter,
      clock: this.state.timing.clock,
      down: play.downDistText,
      team: play.possession,
      text: play.shortDesc || play.description,
      epa: 0, // EPA not available from live ESPN feed
      type: play.isTurnover ? 'turnover' : play.isScoringPlay ? 'score' : 'play',
    };

    // Update situation
    const situation = {
      down: play.endDown ?? 0,
      distance: play.endDistance ?? 0,
      yardLine: play.endYardLine ?? play.yardLine,
      side: play.possession,
      downDistText: play.downDistText,
      possessionTeam: play.possession,
    };

    // Update drive progress
    const currentDrive = {
      plays: play.drivePlays,
      yards: play.driveYards,
      time: play.driveTime ?? '',
      startYardLine: this.state.currentDrive?.startYardLine ?? play.yardLine,
      startSide: this.state.currentDrive?.startSide ?? play.possession,
      team: play.possession,
    };

    this.updateState({
      lastPlay: animData,
      animationKey: this.state.animationKey + 1,
      plays: [...this.state.plays, logEntry],
      situation,
      currentDrive,
      playHistoryLength: this.playHistory.length,
      playIndex: -1, // back to live
    });
  }

  private handleScoringPlay(scoring: ScoringEvent) {
    const logEntry: MissionLogEntry = {
      id: `score-${Date.now()}`,
      quarter: scoring.quarter,
      clock: scoring.clock,
      down: '',
      team: scoring.team,
      text: scoring.description,
      epa: 0,
      type: 'score',
    };

    this.updateState({
      plays: [...this.state.plays, logEntry],
      awayScore: { ...this.state.awayScore, total: scoring.awayScore },
      homeScore: { ...this.state.homeScore, total: scoring.homeScore },
    });
  }

  private handleDriveStart(drive: DriveEvent) {
    this.updateState({
      currentDrive: {
        plays: 0,
        yards: 0,
        time: '',
        startYardLine: drive.startYardLine ?? 0,
        startSide: drive.team,
        team: drive.team,
      },
    });
  }

  private handleDriveEnd(_drive: DriveEvent) {
    this.updateState({ currentDrive: null });
  }

  private handleStatsUpdate(_stats: StatsUpdate) {
    // TODO: Update fantasy panel data from stats leaders
    // This will integrate with the fantasy roster once we wire up
    // the PlayerGameStats API response
  }

  private handleWeather(weather: WeatherUpdate) {
    this.updateState({
      weather: {
        ...this.state.weather,
        temperature: weather.temperature,
        condition: weather.condition,
        wind: weather.wind,
        humidity: weather.humidity,
      },
    });
  }

  // ── Play Navigation ─────────────────────────────────────────

  /** Navigate to a specific play index, or -1 for live */
  public navigateToPlay(index: number) {
    if (index < -1 || index >= this.playHistory.length) return;

    if (index === -1) {
      // Jump to live
      const latest = this.playHistory[this.playHistory.length - 1] ?? null;
      this.updateState({
        playIndex: -1,
        lastPlay: latest,
        animationKey: this.state.animationKey + 1,
      });
    } else {
      this.updateState({
        playIndex: index,
        lastPlay: this.playHistory[index],
        animationKey: this.state.animationKey + 1,
      });
    }
  }

  /** Step back one play */
  public prevPlay() {
    const current =
      this.state.playIndex === -1 ? this.playHistory.length - 1 : this.state.playIndex;
    this.navigateToPlay(Math.max(0, current - 1));
  }

  /** Step forward one play */
  public nextPlay() {
    if (this.state.playIndex === -1) return; // already live
    const next = this.state.playIndex + 1;
    if (next >= this.playHistory.length) {
      this.navigateToPlay(-1); // go live
    } else {
      this.navigateToPlay(next);
    }
  }

  /** Jump to first play */
  public firstPlay() {
    if (this.playHistory.length > 0) this.navigateToPlay(0);
  }

  /** Jump to live */
  public goLive() {
    this.navigateToPlay(-1);
  }

  /** Replay the current animation */
  public replay() {
    this.updateState({ animationKey: this.state.animationKey + 1 });
  }

  // ── Hydrate from REST API ───────────────────────────────────

  /**
   * Initialize state from a REST API response (for SSR or initial load).
   * Call this before connect() to populate the UI immediately.
   */
  public hydrate(ctx: GameContext) {
    this.handleGameContext(ctx);
  }

  // ── Subscriptions ───────────────────────────────────────────

  public subscribe(fn: StateListener) {
    this.stateListeners.add(fn);
    fn(this.state); // emit current state immediately
    return () => this.stateListeners.delete(fn);
  }

  public onStatusChange(fn: StatusListener) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  public onEvent(fn: EventListener) {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  public getState(): LiveGameState {
    return this.state;
  }

  public getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  // ── Internals ───────────────────────────────────────────────

  private teamInfoToHud(info: {
    abbreviation: string;
    displayName: string;
    color: string;
    altColor: string;
    logoUrl: string;
    record?: string;
  }): HudTeam {
    const abbr = info.abbreviation;
    return {
      abbr,
      name: info.displayName.split(' ').pop() ?? info.displayName,
      displayName: info.displayName,
      color: info.color,
      altColor: info.altColor,
      logoUrl: info.logoUrl,
      record: info.record ?? '',
      endzoneName: ENDZONE_NAMES[abbr] ?? abbr,
    };
  }

  private updateState(patch: Partial<LiveGameState>) {
    this.state = { ...this.state, ...patch };
    this.notifyState();
  }

  private notifyState() {
    this.stateListeners.forEach((fn) => fn(this.state));
  }

  private setConnectionStatus(status: ConnectionStatus) {
    this.connectionStatus = status;
    this.statusListeners.forEach((fn) => fn(status));
  }
}

// Singleton
export const gridStream = new GridStreamStore();
