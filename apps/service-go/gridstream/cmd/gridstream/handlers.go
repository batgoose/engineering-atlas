package main

import (
	"encoding/json"
	"log"
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/hub"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Accept connections from known origins in production;
		// allow all in development.
		return true
	},
}

// serveWs handles WebSocket upgrade requests.
func serveWs(h *hub.Hub, logger *slog.Logger, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("websocket upgrade failed", "error", err)
		return
	}

	client := hub.NewClient(h, conn, logger)
	h.Register(client)

	// Check for game subscription in query params
	// e.g., /ws?gameId=401772988
	if gameID := r.URL.Query().Get("gameId"); gameID != "" {
		client.Subscribe(gameID)
	}

	go client.WritePump()
	go client.ReadPump()
}

// statusResponse is returned by the /status endpoint.
type statusResponse struct {
	Service    string `json:"service"`
	Status     string `json:"status"`
	Clients    int    `json:"clients"`
	RedisOK    bool   `json:"redisConnected"`
	Simulation bool   `json:"simulationActive"`
}

// serveStatus returns the service health/status as JSON.
func serveStatus(h *hub.Hub, redisOK bool, simActive bool, w http.ResponseWriter, r *http.Request) {
	resp := statusResponse{
		Service:    "gridstream",
		Status:     "ok",
		Clients:    h.ClientCount(),
		RedisOK:    redisOK,
		Simulation: simActive,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("Failed to encode status response: %v", err)
	}
}
