package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds gridstream config
type Config struct {
	Port     string
	RedisURL string

	// espn polling intervals
	PollPreGame  time.Duration // how often to check for game starts
	PollInGame   time.Duration // how often to poll active games
	PollPostGame time.Duration // grace period after final

	// espn endpoints
	ESPNScoreboardURL string
	ESPNSummaryURL    string // template with %s for event ID
	ESPNPlayByPlayURL string // template with %s for event ID

	// simulation
	SimDefaultSpeed float64 // playback speed multiplier
}

// Load reads config from env with defaults
func Load() *Config {
	return &Config{
		Port:     getEnv("PORT", "8002"),
		RedisURL: getEnv("REDIS_URL", "redis://localhost:6379/0"),

		PollPreGame:  getDuration("POLL_PRE_GAME_SECONDS", 60),
		PollInGame:   getDuration("POLL_IN_GAME_SECONDS", 8),
		PollPostGame: getDuration("POLL_POST_GAME_SECONDS", 300),

		ESPNScoreboardURL: getEnv(
			"ESPN_SCOREBOARD_URL",
			"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
		),
		ESPNSummaryURL: getEnv(
			"ESPN_SUMMARY_URL",
			"https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=%s",
		),
		ESPNPlayByPlayURL: getEnv(
			"ESPN_PBP_URL",
			"https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/%s/competitions/%s/plays?limit=400",
		),

		SimDefaultSpeed: getFloat("SIM_DEFAULT_SPEED", 5.0),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getDuration(key string, defaultSeconds int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Second
		}
	}
	return time.Duration(defaultSeconds) * time.Second
}

func getFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}
