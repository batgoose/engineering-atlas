package events

import (
	"encoding/json"
	"testing"
)

func TestNewEnvelope(t *testing.T) {
	payload := GameUpdate{
		Status:    "in_progress",
		Quarter:   2,
		Clock:     "7:32",
		HomeScore: 14,
		AwayScore: 10,
	}

	env, err := NewEnvelope(TypeGameUpdate, "401772988", 1707500000000, payload)
	if err != nil {
		t.Fatalf("NewEnvelope() error = %v", err)
	}

	if env.Type != TypeGameUpdate {
		t.Errorf("Type = %q, want %q", env.Type, TypeGameUpdate)
	}
	if env.GameID != "401772988" {
		t.Errorf("GameID = %q, want 401772988", env.GameID)
	}
	if env.Timestamp != 1707500000000 {
		t.Errorf("Timestamp = %d, want 1707500000000", env.Timestamp)
	}

	// verify payload deserializes correctly
	var decoded GameUpdate
	if err := json.Unmarshal(env.Payload, &decoded); err != nil {
		t.Fatalf("Payload unmarshal error = %v", err)
	}
	if decoded.HomeScore != 14 {
		t.Errorf("decoded.HomeScore = %d, want 14", decoded.HomeScore)
	}
	if decoded.Clock != "7:32" {
		t.Errorf("decoded.Clock = %q, want 7:32", decoded.Clock)
	}
}

func TestMustEnvelope(t *testing.T) {
	// should not panic with a valid payload
	env := MustEnvelope(TypePlay, "401772988", 1707500000000, PlayEvent{
		PlayType:    "run",
		YardsGained: 15,
		Possession:  "SEA",
	})

	if env.Type != TypePlay {
		t.Errorf("Type = %q, want %q", env.Type, TypePlay)
	}
}

func TestEnvelopeJSONRoundTrip(t *testing.T) {
	original := MustEnvelope(TypeScoringPlay, "401772988", 1707500000000, ScoringEvent{
		ScoreType:   "TD",
		Team:        "SEA",
		Quarter:     4,
		Clock:       "13:24",
		HomeScore:   0,
		AwayScore:   19,
		Description: "K.Walker 1 yard rush (J.Myers kick is good)",
	})

	// marshal to json
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal error = %v", err)
	}

	// unmarshal back
	var decoded Envelope
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error = %v", err)
	}

	if decoded.Type != TypeScoringPlay {
		t.Errorf("Type = %q, want %q", decoded.Type, TypeScoringPlay)
	}
	if decoded.GameID != "401772988" {
		t.Errorf("GameID = %q, want 401772988", decoded.GameID)
	}

	// decode the payload
	var se ScoringEvent
	if err := json.Unmarshal(decoded.Payload, &se); err != nil {
		t.Fatalf("Payload unmarshal error = %v", err)
	}
	if se.ScoreType != "TD" {
		t.Errorf("ScoreType = %q, want TD", se.ScoreType)
	}
	if se.Team != "SEA" {
		t.Errorf("Team = %q, want SEA", se.Team)
	}
	if se.AwayScore != 19 {
		t.Errorf("AwayScore = %d, want 19", se.AwayScore)
	}
}

func TestTypeConstants(t *testing.T) {
	// verify type constants are distinct
	types := []string{
		TypeGameContext, TypeGameUpdate, TypePlay, TypeScoringPlay,
		TypeDriveStart, TypeDriveEnd, TypeStatsUpdate, TypeGameStart,
		TypeGameEnd, TypeWeather, TypeError, TypePing,
	}

	seen := make(map[string]bool)
	for _, typ := range types {
		if typ == "" {
			t.Error("found empty type constant")
		}
		if seen[typ] {
			t.Errorf("duplicate type constant: %q", typ)
		}
		seen[typ] = true
	}
}
