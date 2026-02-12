package redispub

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/redis/go-redis/v9"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/events"
)

const (
	// ChannelLiveUpdates is where game events are published
	ChannelLiveUpdates = "gridstream:live_updates"

	// ChannelCommands is where control commands are received
	// Commands: {"command": "start_sim", "gameId": "...", "speed": 5}
	ChannelCommands = "gridstream:commands"
)

// Command is a control message from django or other services
type Command struct {
	Command string  `json:"command"` // start_sim, stop_sim, set_speed, refresh
	GameID  string  `json:"gameId,omitempty"`
	Speed   float64 `json:"speed,omitempty"`
}

// Bridge connects gridstream events to redis pub/sub
type Bridge struct {
	client *redis.Client
	logger *slog.Logger
}

// NewBridge builds a redis bridge from a redis url
func NewBridge(redisURL string, logger *slog.Logger) (*Bridge, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}

	client := redis.NewClient(opts)

	// verify connection
	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, err
	}

	logger.Info("Redis connected", "url", redisURL)

	return &Bridge{
		client: client,
		logger: logger,
	}, nil
}

// PublishEvent publishes an envelope to live_updates
func (b *Bridge) PublishEvent(ctx context.Context, e events.Envelope) error {
	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return b.client.Publish(ctx, ChannelLiveUpdates, data).Err()
}

// SubscribeCommands listens on commands and forwards parsed messages
// blocks until context is cancelled
func (b *Bridge) SubscribeCommands(ctx context.Context) <-chan Command {
	cmdCh := make(chan Command, 32)

	go func() {
		defer close(cmdCh)

		sub := b.client.Subscribe(ctx, ChannelCommands)
		defer sub.Close()

		ch := sub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				var cmd Command
				if err := json.Unmarshal([]byte(msg.Payload), &cmd); err != nil {
					b.logger.Warn("invalid command", "payload", msg.Payload, "error", err)
					continue
				}
				cmdCh <- cmd
			}
		}
	}()

	return cmdCh
}

// SubscribeLiveUpdates listens on live_updates
// useful when this instance is consuming events
func (b *Bridge) SubscribeLiveUpdates(ctx context.Context) <-chan events.Envelope {
	evCh := make(chan events.Envelope, 256)

	go func() {
		defer close(evCh)

		sub := b.client.Subscribe(ctx, ChannelLiveUpdates)
		defer sub.Close()

		ch := sub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				var e events.Envelope
				if err := json.Unmarshal([]byte(msg.Payload), &e); err != nil {
					b.logger.Warn("invalid event", "error", err)
					continue
				}
				evCh <- e
			}
		}
	}()

	return evCh
}

// Close shuts down the redis client
func (b *Bridge) Close() error {
	return b.client.Close()
}
