package espn

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/config"
	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/events"
)

// gameState tracks the last known state of a game for diffing.
type gameState struct {
	Status    string
	Quarter   int
	Clock     string
	HomeScore int
	AwayScore int
	PlayCount int // total plays seen — used to detect new plays
	DriveID   string
}

// Poller periodically fetches ESPN data and emits events on state changes.
type Poller struct {
	client  *Client
	cfg     *config.Config
	logger  *slog.Logger
	eventCh chan<- events.Envelope

	mu     sync.Mutex
	states map[string]*gameState // gameID → last known state

	// Team ESPN ID → abbreviation mapping (populated from scoreboard)
	teamMap   map[string]string
	teamMapMu sync.RWMutex
}

// NewPoller creates a new ESPN poller that sends events to the given channel.
func NewPoller(client *Client, cfg *config.Config, logger *slog.Logger, eventCh chan<- events.Envelope) *Poller {
	return &Poller{
		client:  client,
		cfg:     cfg,
		logger:  logger,
		eventCh: eventCh,
		states:  make(map[string]*gameState),
		teamMap: make(map[string]string),
	}
}

// Run starts the polling loop. It adapts its interval based on whether
// any games are currently in progress.
func (p *Poller) Run(ctx context.Context) {
	p.logger.Info("ESPN poller starting")

	// Initial fetch
	p.poll(ctx)

	for {
		interval := p.currentInterval()

		select {
		case <-ctx.Done():
			p.logger.Info("ESPN poller stopping")
			return
		case <-time.After(interval):
			p.poll(ctx)
		}
	}
}

// poll does a single scoreboard fetch and diff cycle.
func (p *Poller) poll(ctx context.Context) {
	sb, err := p.client.FetchScoreboard(ctx)
	if err != nil {
		p.logger.Error("scoreboard poll failed", "error", err)
		return
	}

	seasonType := mapSeasonType(sb.Season.Type)
	now := time.Now().UnixMilli()

	for _, ev := range sb.Events {
		gameID := ev.ID

		// Build team map from this event
		if len(ev.Competitions) > 0 {
			for _, c := range ev.Competitions[0].Competitors {
				p.teamMapMu.Lock()
				p.teamMap[c.Team.ID] = c.Team.Abbreviation
				p.teamMapMu.Unlock()
			}
		}

		p.mu.Lock()
		prev, exists := p.states[gameID]
		curr := extractState(ev)

		if !exists {
			// First time seeing this game — send full context
			p.states[gameID] = curr
			p.mu.Unlock()

			gc := EventToGameContext(ev, sb.Season.Year, sb.Week.Number, seasonType)
			envelope := events.MustEnvelope(events.TypeGameContext, gameID, now, gc)
			p.emit(envelope)

			// If game is already in progress, also fetch detailed plays
			if curr.Status == "in_progress" || curr.Status == "halftime" {
				go p.fetchAndEmitPlays(ctx, gameID, now)
			}
			continue
		}

		// Diff against previous state
		changed := false

		// Score change
		if curr.HomeScore != prev.HomeScore || curr.AwayScore != prev.AwayScore {
			changed = true
		}

		// Status change (started, halftime, ended, etc.)
		if curr.Status != prev.Status {
			changed = true

			switch {
			case prev.Status == "scheduled" && curr.Status == "in_progress":
				// Game just started
				gc := EventToGameContext(ev, sb.Season.Year, sb.Week.Number, seasonType)
				p.emit(events.MustEnvelope(events.TypeGameStart, gameID, now, gc))

			case curr.Status == "final" || curr.Status == "final_ot":
				// Game just ended
				gu := EventToGameUpdate(ev)
				p.emit(events.MustEnvelope(events.TypeGameEnd, gameID, now, gu))
			}
		}

		// Quarter/clock change
		if curr.Quarter != prev.Quarter || curr.Clock != prev.Clock {
			changed = true
		}

		if changed {
			gu := EventToGameUpdate(ev)
			p.emit(events.MustEnvelope(events.TypeGameUpdate, gameID, now, gu))

			// Emit stats updates on score changes
			if curr.HomeScore != prev.HomeScore || curr.AwayScore != prev.AwayScore {
				for _, su := range EventToStatsUpdate(ev) {
					p.emit(events.MustEnvelope(events.TypeStatsUpdate, gameID, now, su))
				}
			}
		}

		p.states[gameID] = curr
		p.mu.Unlock()

		// For active games, fetch detailed play-by-play periodically
		if curr.Status == "in_progress" && changed {
			go p.fetchAndEmitPlays(ctx, gameID, now)
		}
	}
}

// fetchAndEmitPlays fetches the game summary and emits new plays/drives.
func (p *Poller) fetchAndEmitPlays(ctx context.Context, gameID string, ts int64) {
	summary, err := p.client.FetchSummary(ctx, gameID)
	if err != nil {
		p.logger.Error("summary fetch failed", "gameID", gameID, "error", err)
		return
	}

	if summary.Drives == nil {
		return
	}

	p.teamMapMu.RLock()
	tm := make(map[string]string, len(p.teamMap))
	for k, v := range p.teamMap {
		tm[k] = v
	}
	p.teamMapMu.RUnlock()

	// Process completed drives
	for i, drive := range summary.Drives.Previous {
		driveNum := i + 1
		for _, play := range drive.Plays {
			pe := PlayToEvent(play, tm, driveNum, drive.OffensivePlays, drive.Yards, drive.TimeElapsed.DisplayValue)
			p.emit(events.MustEnvelope(events.TypePlay, gameID, ts, pe))
		}
	}

	// Process current drive
	if summary.Drives.Current != nil {
		driveNum := len(summary.Drives.Previous) + 1
		cd := summary.Drives.Current
		for _, play := range cd.Plays {
			pe := PlayToEvent(play, tm, driveNum, cd.OffensivePlays, cd.Yards, cd.TimeElapsed.DisplayValue)
			p.emit(events.MustEnvelope(events.TypePlay, gameID, ts, pe))
		}
	}

	// Scoring plays
	for _, sp := range summary.ScoringPlays {
		se := ScoringPlayToEvent(sp)
		p.emit(events.MustEnvelope(events.TypeScoringPlay, gameID, ts, se))
	}
}

// emit sends an event to the event channel (non-blocking, drops if full).
func (p *Poller) emit(e events.Envelope) {
	select {
	case p.eventCh <- e:
	default:
		p.logger.Warn("event channel full, dropping event",
			"type", e.Type, "gameID", e.GameID)
	}
}

// currentInterval returns the poll interval based on active game states.
func (p *Poller) currentInterval() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, s := range p.states {
		if s.Status == "in_progress" || s.Status == "halftime" || s.Status == "end_period" {
			return p.cfg.PollInGame
		}
	}

	// Check if any games are scheduled (not yet started)
	hasScheduled := false
	for _, s := range p.states {
		if s.Status == "scheduled" {
			hasScheduled = true
		}
	}

	if hasScheduled {
		return p.cfg.PollPreGame
	}

	return p.cfg.PollPostGame
}

// HasActiveGames returns true if any tracked games are in progress.
func (p *Poller) HasActiveGames() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, s := range p.states {
		if s.Status == "in_progress" || s.Status == "halftime" {
			return true
		}
	}
	return false
}

// TrackedGames returns the count of tracked games.
func (p *Poller) TrackedGames() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.states)
}

// extractState pulls the diffable state from an ESPN event.
func extractState(ev Event) *gameState {
	comp := ev.Competitions[0]
	home, away := splitCompetitors(comp.Competitors)

	playCount := 0 // scoreboard doesn't include play count directly

	return &gameState{
		Status:    mapGameState(ev.Status),
		Quarter:   ev.Status.Period,
		Clock:     ev.Status.DisplayClock,
		HomeScore: mustInt(home.Score),
		AwayScore: mustInt(away.Score),
		PlayCount: playCount,
	}
}

func mapSeasonType(t int) string {
	switch t {
	case 1:
		return "PRE"
	case 2:
		return "REG"
	case 3:
		return "POST"
	default:
		return "REG"
	}
}
