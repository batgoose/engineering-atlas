package espn

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/config"
)

// Client handles http calls to espn's unofficial api
type Client struct {
	http          *http.Client
	cfg           *config.Config
	logger        *slog.Logger
	lastRequestAt time.Time
}

// NewClient builds an espn api client
func NewClient(cfg *config.Config, logger *slog.Logger) *Client {
	return &Client{
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
		cfg:    cfg,
		logger: logger,
	}
}

// FetchScoreboard gets the current nfl scoreboard
// optional filters: ?week=1&seasontype=2&dates=20250906
func (c *Client) FetchScoreboard(ctx context.Context) (*ScoreboardResponse, error) {
	url := c.cfg.ESPNScoreboardURL

	body, err := c.doGet(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("scoreboard fetch: %w", err)
	}

	var resp ScoreboardResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("scoreboard decode: %w", err)
	}

	c.logger.Debug("fetched scoreboard",
		"events", len(resp.Events),
		"season", resp.Season.Year,
		"week", resp.Week.Number,
	)

	return &resp, nil
}

// FetchScoreboardForWeek gets a specific week scoreboard
func (c *Client) FetchScoreboardForWeek(ctx context.Context, season, week, seasonType int) (*ScoreboardResponse, error) {
	url := fmt.Sprintf("%s?week=%d&seasontype=%d&year=%d",
		c.cfg.ESPNScoreboardURL, week, seasonType, season)

	body, err := c.doGet(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("scoreboard week fetch: %w", err)
	}

	var resp ScoreboardResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("scoreboard week decode: %w", err)
	}

	return &resp, nil
}

// FetchSummary gets the full game summary
func (c *Client) FetchSummary(ctx context.Context, eventID string) (*SummaryResponse, error) {
	url := fmt.Sprintf(c.cfg.ESPNSummaryURL, eventID)

	body, err := c.doGet(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("summary fetch: %w", err)
	}

	var resp SummaryResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("summary decode: %w", err)
	}

	c.logger.Debug("fetched summary", "eventID", eventID)
	return &resp, nil
}

// doGet runs a get request with context and basic error handling
func (c *Client) doGet(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	// espn expects a browser-like user agent
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Gridstream/1.0)")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	c.lastRequestAt = time.Now()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("ESPN returned %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("body read: %w", err)
	}

	return body, nil
}
