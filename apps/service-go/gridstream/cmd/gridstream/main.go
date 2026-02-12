package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/config"
	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/espn"
	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/events"
	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/hub"
	redispub "github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/redis"
	"github.com/jbooth/engineering-atlas/apps/service-go/gridstream/internal/simulator"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	cfg := config.Load()

	// event bus shared by poller and simulator
	eventCh := make(chan events.Envelope, 1024)

	// websocket hub
	wsHub := hub.NewHub(logger.With("component", "hub"))
	go wsHub.Run()

	// redis bridge
	var redisBridge *redispub.Bridge
	redisOK := false

	bridge, err := redispub.NewBridge(cfg.RedisURL, logger.With("component", "redis"))
	if err != nil {
		logger.Warn("Redis connection failed — running without pub/sub", "error", err)
	} else {
		redisBridge = bridge
		redisOK = true
		defer redisBridge.Close()
	}

	// espn poller
	espnClient := espn.NewClient(cfg, logger.With("component", "espn-client"))
	poller := espn.NewPoller(espnClient, cfg, logger.With("component", "poller"), eventCh)

	// simulation engine
	simEngine := simulator.NewEngine(logger.With("component", "simulator"), eventCh)

	// route events to hub and redis
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case envelope, ok := <-eventCh:
				if !ok {
					return
				}

				// send to websocket clients
				wsHub.Broadcast(envelope)

				// publish to redis when connected
				if redisBridge != nil {
					if err := redisBridge.PublishEvent(ctx, envelope); err != nil {
						logger.Error("Redis publish failed", "error", err)
					}
				}
			}
		}
	}()

	// redis command listener
	if redisBridge != nil {
		cmdCh := redisBridge.SubscribeCommands(ctx)
		go func() {
			for cmd := range cmdCh {
				logger.Info("received command", "command", cmd.Command, "gameID", cmd.GameID)
				switch cmd.Command {
				case "start_sim":
					// TODO: load plays from db via PlaySource
					logger.Info("simulation start requested (not yet wired to DB)",
						"gameID", cmd.GameID, "speed", cmd.Speed)
					if cmd.Speed > 0 {
						simEngine.SetSpeed(cmd.Speed)
					}
				case "stop_sim":
					simEngine.Stop()
				case "set_speed":
					if cmd.Speed > 0 {
						simEngine.SetSpeed(cmd.Speed)
					}
				}
			}
		}()
	}

	// start poller
	go poller.Run(ctx)

	// http routes
	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprintf(w, "⚡ Gridstream Engine: WebSocket Hub Active")
	})

	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(wsHub, logger, w, r)
	})

	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		serveStatus(wsHub, redisOK, simEngine.IsRunning(), w, r)
	})

	// cors middleware for local dev
	handler := corsMiddleware(mux)

	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: handler,
	}

	// graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		logger.Info("shutting down...")
		cancel()
		simEngine.Stop()
		server.Close()
	}()

	// startup log
	logger.Info("Gridstream service online",
		"port", cfg.Port,
		"redis", redisOK,
		"espn_poll_interval", cfg.PollInGame,
	)
	fmt.Printf("⚡ Gridstream Service Online at :%s\n", cfg.Port)

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
}

// corsMiddleware adds cors headers for local dev
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
