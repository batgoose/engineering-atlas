package simulator

import (
	"context"
	"log/slog"
	"time"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/events"
)

// PlaySource provides plays for simulation/replay
// implementations can read from nfl_data, espn, or a playbook
type PlaySource interface {
	// LoadGame returns plays in sequence order
	LoadGame(ctx context.Context, gameID string) ([]SimPlay, error)
}

// SimPlay is a simplified play record used by simulation
type SimPlay struct {
	Sequence    int
	Quarter     int
	Clock       string
	Down        int
	Distance    int
	YardLine    int
	Possession  string
	PlayType    string
	YardsGained int
	Description string
	ShortDesc   string
	IsScoring   bool
	IsTurnover  bool
	HomeScore   int
	AwayScore   int
	EndDown     int
	EndDistance int
	EndYardLine int
	DriveNumber int
	DrivePlays  int
	DriveYards  int
	DriveTime   string
}

// Engine manages game simulations/replays
type Engine struct {
	logger  *slog.Logger
	eventCh chan<- events.Envelope
	speed   float64 // playback multiplier (1x, 2x, 5x, 10x)
	cancel  context.CancelFunc
}

// NewEngine builds a simulation engine that emits events to a channel
func NewEngine(logger *slog.Logger, eventCh chan<- events.Envelope) *Engine {
	return &Engine{
		logger:  logger,
		eventCh: eventCh,
		speed:   5.0,
	}
}

// SetSpeed updates playback speed
func (e *Engine) SetSpeed(speed float64) {
	if speed < 0.5 {
		speed = 0.5
	}
	if speed > 100 {
		speed = 100
	}
	e.speed = speed
	e.logger.Info("simulation speed changed", "speed", speed)
}

// Stop halts the current simulation
func (e *Engine) Stop() {
	if e.cancel != nil {
		e.cancel()
		e.cancel = nil
		e.logger.Info("simulation stopped")
	}
}

// ReplayGame replays a sequence of plays as if they are live
// runs in a goroutine; call Stop() to cancel
func (e *Engine) ReplayGame(gameID string, plays []SimPlay) {
	e.Stop() // cancel any existing replay

	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel

	go func() {
		e.logger.Info("simulation starting",
			"gameID", gameID,
			"plays", len(plays),
			"speed", e.speed,
		)

		for i, play := range plays {
			select {
			case <-ctx.Done():
				e.logger.Info("simulation cancelled", "gameID", gameID, "at_play", i)
				return
			default:
			}

			pe := events.PlayEvent{
				Down:          play.Down,
				Distance:      play.Distance,
				YardLine:      play.YardLine,
				DownDistText:  formatDownDist(play.Down, play.Distance),
				Possession:    play.Possession,
				PlayType:      play.PlayType,
				YardsGained:   play.YardsGained,
				Description:   play.Description,
				ShortDesc:     play.ShortDesc,
				IsScoringPlay: play.IsScoring,
				IsTurnover:    play.IsTurnover,
				HomeScore:     play.HomeScore,
				AwayScore:     play.AwayScore,
				EndDown:       play.EndDown,
				EndDistance:   play.EndDistance,
				EndYardLine:   play.EndYardLine,
				DriveNumber:   play.DriveNumber,
				DrivePlays:    play.DrivePlays,
				DriveYards:    play.DriveYards,
				DriveTime:     play.DriveTime,
			}

			now := time.Now().UnixMilli()
			envelope := events.MustEnvelope(events.TypePlay, gameID, now, pe)

			select {
			case e.eventCh <- envelope:
			default:
				e.logger.Warn("event channel full during simulation")
			}

			// also emit scoring event on score changes
			if play.IsScoring && i > 0 {
				se := events.ScoringEvent{
					ScoreType:   "TD", // simplified; real impl should detect actual score type
					Description: play.Description,
					Team:        play.Possession,
					Quarter:     play.Quarter,
					Clock:       play.Clock,
					HomeScore:   play.HomeScore,
					AwayScore:   play.AwayScore,
				}
				e.eventCh <- events.MustEnvelope(events.TypeScoringPlay, gameID, now, se)
			}

			// delay between plays based on speed
			// real games average around 30s between plays
			delay := time.Duration(float64(5*time.Second) / e.speed)
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
		}

		e.logger.Info("simulation complete", "gameID", gameID)

		// send game_end
		now := time.Now().UnixMilli()
		if len(plays) > 0 {
			last := plays[len(plays)-1]
			gu := events.GameUpdate{
				Status:    "final",
				HomeScore: last.HomeScore,
				AwayScore: last.AwayScore,
			}
			e.eventCh <- events.MustEnvelope(events.TypeGameEnd, gameID, now, gu)
		}
	}()
}

// IsRunning returns true if a simulation is active
func (e *Engine) IsRunning() bool {
	return e.cancel != nil
}

func formatDownDist(down, distance int) string {
	if down == 0 {
		return ""
	}
	ordinal := map[int]string{1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}
	d := ordinal[down]
	if d == "" {
		d = "?"
	}
	if distance >= 10 && down == 1 {
		return d + " & 10"
	}
	return d + " & " + itoa(distance)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	// small int to string helper
	s := ""
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	if neg {
		s = "-" + s
	}
	return s
}
