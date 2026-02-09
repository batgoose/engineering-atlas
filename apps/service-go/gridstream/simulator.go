package main

import (
	"encoding/json"
	"math/rand"
	"time"
)

type GameEvent struct {
	Event     string `json:"event"`
	Team      string `json:"team"`
	Score     string `json:"score"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

func StartSimulation(hub *Hub) {
	teams := []string{"SF", "KC", "NYG", "PHI", "DAL", "SEA"}

	// Ticker for periodic events
	ticker := time.NewTicker(8 * time.Second)

	for range ticker.C {
		team := teams[rand.Intn(len(teams))]

		event := GameEvent{
			Event:     "TOUCHDOWN",
			Team:      team,
			Score:     "7 - 0",
			Message:   "Touchdown " + team + "!",
			Timestamp: time.Now().Format(time.Kitchen),
		}

		payload, _ := json.Marshal(event)

		hub.broadcast <- payload
	}
}
