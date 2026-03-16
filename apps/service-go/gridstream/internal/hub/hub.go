package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/events"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

// =============================================================================
// CLIENT
// =============================================================================

// Client represents a connected WebSocket client.
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	logger *slog.Logger

	// Subscriptions — which game IDs this client cares about.
	// Empty means "all games" (scoreboard mode).
	mu              sync.RWMutex
	subscribedGames map[string]bool
}

// NewClient creates a client attached to the hub.
func NewClient(hub *Hub, conn *websocket.Conn, logger *slog.Logger) *Client {
	return &Client{
		hub:             hub,
		conn:            conn,
		send:            make(chan []byte, 256),
		logger:          logger,
		subscribedGames: make(map[string]bool),
	}
}

// Subscribe adds a game to this client's subscription list.
func (c *Client) Subscribe(gameID string) {
	c.mu.Lock()
	c.subscribedGames[gameID] = true
	c.mu.Unlock()
}

// Unsubscribe removes a game from this client's subscription list.
func (c *Client) Unsubscribe(gameID string) {
	c.mu.Lock()
	delete(c.subscribedGames, gameID)
	c.mu.Unlock()
}

// WantsEvent returns true if this client should receive the given event.
func (c *Client) WantsEvent(gameID string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// No subscriptions = broadcast mode (gets everything)
	if len(c.subscribedGames) == 0 {
		return true
	}
	return c.subscribedGames[gameID]
}

// WritePump pumps messages from the send channel to the WebSocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				return
			}
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				c.logger.Debug("write error", "error", err)
				return
			}

		case <-ticker.C:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				return
			}
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ReadPump reads messages from the WebSocket connection.
// Handles subscribe/unsubscribe commands from the client.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(4096)
	if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		return
	}
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				c.logger.Debug("read error", "error", err)
			}
			break
		}
		c.handleMessage(message)
	}
}

// ClientCommand is the shape of commands sent by the frontend.
type ClientCommand struct {
	Action string `json:"action"` // "subscribe", "unsubscribe", "subscribe_all"
	GameID string `json:"gameId,omitempty"`
}

func (c *Client) handleMessage(msg []byte) {
	var cmd ClientCommand
	if err := json.Unmarshal(msg, &cmd); err != nil {
		c.logger.Debug("invalid client command", "error", err)
		return
	}

	switch cmd.Action {
	case "subscribe":
		if cmd.GameID != "" {
			c.Subscribe(cmd.GameID)
			c.logger.Debug("client subscribed", "gameID", cmd.GameID)
		}
	case "unsubscribe":
		if cmd.GameID != "" {
			c.Unsubscribe(cmd.GameID)
			c.logger.Debug("client unsubscribed", "gameID", cmd.GameID)
		}
	case "subscribe_all":
		c.mu.Lock()
		c.subscribedGames = make(map[string]bool) // empty = all
		c.mu.Unlock()
		c.logger.Debug("client subscribed to all games")
	}
}

// =============================================================================
// HUB
// =============================================================================

// Hub maintains connected clients and routes events to them.
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan events.Envelope
	register   chan *Client
	unregister chan *Client
	logger     *slog.Logger
	mu         sync.RWMutex

	// Latest game contexts — sent to newly connecting clients
	contextCache   map[string][]byte // gameID → serialized GameContext envelope
	contextCacheMu sync.RWMutex
}

// NewHub creates a new Hub.
func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients:      make(map[*Client]bool),
		broadcast:    make(chan events.Envelope, 512),
		register:     make(chan *Client),
		unregister:   make(chan *Client),
		logger:       logger,
		contextCache: make(map[string][]byte),
	}
}

// Run starts the hub's event loop.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

			h.logger.Info("client connected", "total", h.ClientCount())

			// Send cached game contexts to the new client
			h.sendCachedContexts(client)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			h.logger.Info("client disconnected", "total", h.ClientCount())

		case envelope := <-h.broadcast:
			// Cache game context events for new connections
			if envelope.Type == events.TypeGameContext || envelope.Type == events.TypeGameStart {
				data, _ := json.Marshal(envelope)
				h.contextCacheMu.Lock()
				h.contextCache[envelope.GameID] = data
				h.contextCacheMu.Unlock()
			}

			data, err := json.Marshal(envelope)
			if err != nil {
				h.logger.Error("failed to marshal envelope", "error", err)
				continue
			}

			h.mu.RLock()
			for client := range h.clients {
				if !client.WantsEvent(envelope.GameID) {
					continue
				}
				select {
				case client.send <- data:
				default:
					// Client buffer full — disconnect
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends an event envelope to all interested clients.
func (h *Hub) Broadcast(e events.Envelope) {
	h.broadcast <- e
}

// Register adds a client to the hub.
func (h *Hub) Register(c *Client) {
	h.register <- c
}

// Unregister removes a client from the hub.
func (h *Hub) Unregister(c *Client) {
	h.unregister <- c
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// sendCachedContexts sends all cached game contexts to a newly connected client.
func (h *Hub) sendCachedContexts(c *Client) {
	h.contextCacheMu.RLock()
	defer h.contextCacheMu.RUnlock()

	for _, data := range h.contextCache {
		select {
		case c.send <- data:
		default:
			// skip if buffer is full
		}
	}
}
