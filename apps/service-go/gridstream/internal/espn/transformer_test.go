package espn

import (
	"testing"
)

func TestMapGameState(t *testing.T) {
	tests := []struct {
		name     string
		status   Status
		expected string
	}{
		{
			name: "pre-game",
			status: Status{
				Type: struct {
					ID        string `json:"id"`
					Name      string `json:"name"`
					State     string `json:"state"`
					Completed bool   `json:"completed"`
					Detail    string `json:"detail"`
				}{State: "pre", Name: "STATUS_SCHEDULED"},
			},
			expected: "scheduled",
		},
		{
			name: "in progress",
			status: Status{
				Type: struct {
					ID        string `json:"id"`
					Name      string `json:"name"`
					State     string `json:"state"`
					Completed bool   `json:"completed"`
					Detail    string `json:"detail"`
				}{State: "in", Name: "STATUS_IN_PROGRESS"},
			},
			expected: "in_progress",
		},
		{
			name: "halftime",
			status: Status{
				Type: struct {
					ID        string `json:"id"`
					Name      string `json:"name"`
					State     string `json:"state"`
					Completed bool   `json:"completed"`
					Detail    string `json:"detail"`
				}{State: "in", Name: "STATUS_HALFTIME"},
			},
			expected: "halftime",
		},
		{
			name: "final regulation",
			status: Status{
				Period: 4,
				Type: struct {
					ID        string `json:"id"`
					Name      string `json:"name"`
					State     string `json:"state"`
					Completed bool   `json:"completed"`
					Detail    string `json:"detail"`
				}{State: "post", Name: "STATUS_FINAL", Completed: true},
			},
			expected: "final",
		},
		{
			name: "final overtime",
			status: Status{
				Period: 5,
				Type: struct {
					ID        string `json:"id"`
					Name      string `json:"name"`
					State     string `json:"state"`
					Completed bool   `json:"completed"`
					Detail    string `json:"detail"`
				}{State: "post", Name: "STATUS_FINAL", Completed: true},
			},
			expected: "final_ot",
		},
		{
			name: "end of period",
			status: Status{
				Type: struct {
					ID        string `json:"id"`
					Name      string `json:"name"`
					State     string `json:"state"`
					Completed bool   `json:"completed"`
					Detail    string `json:"detail"`
				}{State: "in", Name: "STATUS_END_PERIOD"},
			},
			expected: "end_period",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mapGameState(tt.status)
			if got != tt.expected {
				t.Errorf("mapGameState() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestNormalizePlayType(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Rush", "run"},
		{"Pass Reception", "pass"},
		{"Pass Incompletion", "pass"},
		{"Sack", "pass"},
		{"Punt", "punt"},
		{"Kickoff", "kickoff"},
		{"Field Goal Good", "field_goal"},
		{"Extra Point Good", "extra_point"},
		{"Two-Point Conversion", "two_point_attempt"},
		{"QB Kneel", "qb_kneel"},
		{"Penalty", "no_play"},
		{"Rushing Touchdown", "run"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizePlayType(tt.input)
			if got != tt.expected {
				t.Errorf("normalizePlayType(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestMapScoreType(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"TD", "TD"},
		{"FG", "FG"},
		{"PAT", "PAT"},
		{"XP", "PAT"},
		{"2PT", "2PT"},
		{"SF", "SFTY"},
		{"SAF", "SFTY"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := mapScoreType(tt.input)
			if got != tt.expected {
				t.Errorf("mapScoreType(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestMapLeaderCategory(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"passingLeader", "passing"},
		{"rushingLeader", "rushing"},
		{"receivingLeader", "receiving"},
		{"unknownLeader", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := mapLeaderCategory(tt.input)
			if got != tt.expected {
				t.Errorf("mapLeaderCategory(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestIsTurnover(t *testing.T) {
	tests := []struct {
		name     string
		play     Play
		expected bool
	}{
		{
			name: "interception",
			play: Play{
				Type: struct {
					ID           string `json:"id"`
					Text         string `json:"text"`
					Abbreviation string `json:"abbreviation"`
				}{Text: "Interception Return"},
				Text: "G.Smith pass deep left intercepted by J.Jones at NE 20",
			},
			expected: true,
		},
		{
			name: "fumble recovery",
			play: Play{
				Type: struct {
					ID           string `json:"id"`
					Text         string `json:"text"`
					Abbreviation string `json:"abbreviation"`
				}{Text: "Rush"},
				Text: "K.Walker left end for 5 yards. FUMBLES, recovered by NE-C.Barmore at SEA 40",
			},
			expected: true,
		},
		{
			name: "normal rush",
			play: Play{
				Type: struct {
					ID           string `json:"id"`
					Text         string `json:"text"`
					Abbreviation string `json:"abbreviation"`
				}{Text: "Rush"},
				Text: "K.Walker left end for 5 yards (C.Davis)",
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isTurnover(tt.play)
			if got != tt.expected {
				t.Errorf("isTurnover() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestSplitCompetitors(t *testing.T) {
	competitors := []Competitor{
		{HomeAway: "away", Team: Team{Abbreviation: "SEA"}},
		{HomeAway: "home", Team: Team{Abbreviation: "NE"}},
	}

	home, away := splitCompetitors(competitors)

	if home.Team.Abbreviation != "NE" {
		t.Errorf("home team = %q, want NE", home.Team.Abbreviation)
	}
	if away.Team.Abbreviation != "SEA" {
		t.Errorf("away team = %q, want SEA", away.Team.Abbreviation)
	}
}

func TestMapSeasonType(t *testing.T) {
	tests := []struct {
		input    int
		expected string
	}{
		{1, "PRE"},
		{2, "REG"},
		{3, "POST"},
		{0, "REG"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			got := mapSeasonType(tt.input)
			if got != tt.expected {
				t.Errorf("mapSeasonType(%d) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestEventToGameUpdate(t *testing.T) {
	ev := Event{
		ID: "401772988",
		Competitions: []Competition{{
			Competitors: []Competitor{
				{
					HomeAway: "home",
					Score:    "13",
					Team:     Team{ID: "17", Abbreviation: "NE"},
				},
				{
					HomeAway: "away",
					Score:    "29",
					Team:     Team{ID: "26", Abbreviation: "SEA"},
				},
			},
		}},
		Status: Status{
			Period:       4,
			DisplayClock: "0:00",
			Type: struct {
				ID        string `json:"id"`
				Name      string `json:"name"`
				State     string `json:"state"`
				Completed bool   `json:"completed"`
				Detail    string `json:"detail"`
			}{State: "post", Name: "STATUS_FINAL", Completed: true},
		},
	}

	gu := EventToGameUpdate(ev)

	if gu.Status != "final" {
		t.Errorf("Status = %q, want final", gu.Status)
	}
	if gu.HomeScore != 13 {
		t.Errorf("HomeScore = %d, want 13", gu.HomeScore)
	}
	if gu.AwayScore != 29 {
		t.Errorf("AwayScore = %d, want 29", gu.AwayScore)
	}
	if gu.Quarter != 4 {
		t.Errorf("Quarter = %d, want 4", gu.Quarter)
	}
	if gu.Clock != "0:00" {
		t.Errorf("Clock = %q, want 0:00", gu.Clock)
	}
}

func TestEventToGameContext(t *testing.T) {
	spread := 5.5
	total := 42.5

	ev := Event{
		ID:   "401772988",
		Date: "2026-02-08T23:30Z",
		Competitions: []Competition{{
			Competitors: []Competitor{
				{
					HomeAway: "home",
					Score:    "13",
					Team: Team{
						ID:           "17",
						Abbreviation: "NE",
						DisplayName:  "New England Patriots",
						Color:        "002a5c",
						Logo:         "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ne.png",
					},
					Records: []struct {
						Type    string `json:"type"`
						Summary string `json:"summary"`
					}{{Type: "total", Summary: "14-3"}},
				},
				{
					HomeAway: "away",
					Score:    "29",
					Team: Team{
						ID:           "26",
						Abbreviation: "SEA",
						DisplayName:  "Seattle Seahawks",
						Color:        "002a5c",
						Logo:         "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/sea.png",
					},
					Records: []struct {
						Type    string `json:"type"`
						Summary string `json:"summary"`
					}{{Type: "total", Summary: "14-3"}},
				},
			},
			Odds: []Odds{{
				Spread:    spread,
				OverUnder: total,
				Provider: struct {
					Name string `json:"name"`
				}{Name: "DraftKings"},
			}},
			Broadcasts: []Broadcast{{
				Names: []string{"NBC", "Peacock"},
			}},
			Venue: Venue{
				FullName: "Levi's Stadium",
				Address: struct {
					City    string `json:"city"`
					State   string `json:"state"`
					Country string `json:"country"`
				}{City: "Santa Clara", State: "CA"},
			},
			Notes: []Note{{Headline: "Super Bowl LX"}},
		}},
		Status: Status{
			Period:       4,
			DisplayClock: "0:00",
			Type: struct {
				ID        string `json:"id"`
				Name      string `json:"name"`
				State     string `json:"state"`
				Completed bool   `json:"completed"`
				Detail    string `json:"detail"`
			}{State: "post", Name: "STATUS_FINAL", Completed: true},
		},
	}

	gc := EventToGameContext(ev, 2025, 5, "POST")

	if gc.GameID != "401772988" {
		t.Errorf("GameID = %q, want 401772988", gc.GameID)
	}
	if gc.Season != 2025 {
		t.Errorf("Season = %d, want 2025", gc.Season)
	}
	if gc.GameNote != "Super Bowl LX" {
		t.Errorf("GameNote = %q, want Super Bowl LX", gc.GameNote)
	}
	if gc.HomeTeam.Abbreviation != "NE" {
		t.Errorf("HomeTeam = %q, want NE", gc.HomeTeam.Abbreviation)
	}
	if gc.AwayTeam.Abbreviation != "SEA" {
		t.Errorf("AwayTeam = %q, want SEA", gc.AwayTeam.Abbreviation)
	}
	if gc.HomeTeam.Record != "14-3" {
		t.Errorf("HomeTeam.Record = %q, want 14-3", gc.HomeTeam.Record)
	}
	if gc.VenueName != "Levi's Stadium" {
		t.Errorf("VenueName = %q, want Levi's Stadium", gc.VenueName)
	}
	if gc.Network != "NBC" {
		t.Errorf("Network = %q, want NBC", gc.Network)
	}
	if gc.Spread == nil || *gc.Spread != 5.5 {
		t.Errorf("Spread = %v, want 5.5", gc.Spread)
	}
	if gc.HomeScore != 13 {
		t.Errorf("HomeScore = %d, want 13", gc.HomeScore)
	}
	if gc.AwayScore != 29 {
		t.Errorf("AwayScore = %d, want 29", gc.AwayScore)
	}
}

func TestPlayToEvent(t *testing.T) {
	teamMap := map[string]string{"26": "SEA", "17": "NE"}

	play := Play{
		Type: struct {
			ID           string `json:"id"`
			Text         string `json:"text"`
			Abbreviation string `json:"abbreviation"`
		}{Text: "Rush"},
		Text:      "K.Walker left end pushed ob at SEA 45 for 10 yards (C.Davis).",
		ShortText: "K.Walker rush for 10 yds",
		HomeScore: 0,
		AwayScore: 0,
		Start: struct {
			Down             int    `json:"down"`
			Distance         int    `json:"distance"`
			YardLine         int    `json:"yardLine"`
			YardsToEndzone   int    `json:"yardsToEndzone"`
			DownDistanceText string `json:"downDistanceText"`
			Team             struct {
				ID string `json:"id"`
			} `json:"team"`
		}{
			Down: 1, Distance: 10, YardLine: 35, YardsToEndzone: 65,
			DownDistanceText: "1st & 10 at SEA 35",
			Team: struct {
				ID string `json:"id"`
			}{ID: "26"},
		},
		End: struct {
			Down           int `json:"down"`
			Distance       int `json:"distance"`
			YardLine       int `json:"yardLine"`
			YardsToEndzone int `json:"yardsToEndzone"`
			Team           struct {
				ID string `json:"id"`
			} `json:"team"`
		}{
			Down: 1, Distance: 10, YardLine: 45, YardsToEndzone: 55,
		},
		StatYardage: 10,
		ScoringPlay: false,
	}

	pe := PlayToEvent(play, teamMap, 1, 8, 75, "3:42")

	if pe.Possession != "SEA" {
		t.Errorf("Possession = %q, want SEA", pe.Possession)
	}
	if pe.PlayType != "run" {
		t.Errorf("PlayType = %q, want run", pe.PlayType)
	}
	if pe.YardsGained != 10 {
		t.Errorf("YardsGained = %d, want 10", pe.YardsGained)
	}
	if pe.Down != 1 {
		t.Errorf("Down = %d, want 1", pe.Down)
	}
	if pe.DriveNumber != 1 {
		t.Errorf("DriveNumber = %d, want 1", pe.DriveNumber)
	}
	if pe.DriveYards != 75 {
		t.Errorf("DriveYards = %d, want 75", pe.DriveYards)
	}
	if pe.IsScoringPlay {
		t.Error("IsScoringPlay should be false")
	}
}
