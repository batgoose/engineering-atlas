package main

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/hub"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// lock this down for prod origins later
		// allow all in local dev for now
		return true
	},
}

// serveWs handles websocket upgrades
func serveWs(h *hub.Hub, logger *slog.Logger, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("websocket upgrade failed", "error", err)
		return
	}

	client := hub.NewClient(h, conn, logger)
	h.Register(client)

	// optional game subscription from query param
	// example: /ws?gameId=401772988
	if gameID := r.URL.Query().Get("gameId"); gameID != "" {
		client.Subscribe(gameID)
	}

	go client.WritePump()
	go client.ReadPump()
}

// statusResponse is returned by /status
type statusResponse struct {
	Service    string `json:"service"`
	Status     string `json:"status"`
	Clients    int    `json:"clients"`
	RedisOK    bool   `json:"redisConnected"`
	Simulation bool   `json:"simulationActive"`
}

// serveStatus returns health/status json
func serveStatus(h *hub.Hub, redisOK bool, simActive bool, w http.ResponseWriter, r *http.Request) {
	resp := statusResponse{
		Service:    "gridstream",
		Status:     "ok",
		Clients:    h.ClientCount(),
		RedisOK:    redisOK,
		Simulation: simActive,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
