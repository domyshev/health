package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
	"github.com/domyshev-labs/health-hub/api/internal/config"
	emailadapter "github.com/domyshev-labs/health-hub/api/internal/email"
	"github.com/domyshev-labs/health-hub/api/internal/httpapi"
	"github.com/domyshev-labs/health-hub/api/internal/importer"
	"github.com/domyshev-labs/health-hub/api/internal/postgres"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database unavailable", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	var sender auth.EmailSender
	if cfg.EmailMode == "resend" {
		sender = emailadapter.NewResendSender(cfg.ResendAPIKey, cfg.EmailFrom)
	} else {
		sender = emailadapter.NewDevelopmentSender(logger)
	}
	authService := auth.NewService(auth.ServiceConfig{
		Repository:           store,
		Sender:               sender,
		Secret:               cfg.AuthSecret,
		AllowedEmails:        cfg.AllowedEmails,
		CodeLifetime:         cfg.CodeLifetime,
		SessionLifetime:      cfg.SessionLifetime,
		DevelopmentLoginCode: cfg.DevelopmentLoginCode,
	})

	var importerClient importer.Client
	if cfg.ImporterBaseURL != "" && cfg.ImporterControlSecret != "" {
		client, err := importer.NewHTTPClient(cfg.ImporterBaseURL, cfg.ImporterControlSecret, 30*time.Second)
		if err != nil {
			logger.Error("invalid importer configuration", "error", err)
			os.Exit(1)
		}
		importerClient = client
	}

	handler := httpapi.NewServer(httpapi.ServerConfig{
		Auth:             authService,
		Health:           store,
		Importer:         importerClient,
		Readiness:        store,
		Logger:           logger,
		CookieName:       cfg.CookieName,
		CookieSecure:     cfg.CookieSecure,
		AllowedOrigins:   cfg.AllowedOrigins,
		TrustedProxies:   cfg.TrustedProxies,
		RequestBodyLimit: 1 << 20,
	}).Handler()
	if directory := os.Getenv("STATIC_DIR"); directory != "" {
		handler = httpapi.WithFrontend(directory, handler)
	}
	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go cleanupLoop(ctx, logger, store)
	go func() {
		logger.Info("Health Hub API listening", "address", cfg.Address)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("HTTP shutdown failed", "error", err)
	}
}

func cleanupLoop(ctx context.Context, logger *slog.Logger, store *postgres.Store) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			cleanupCtx, cancel := context.WithTimeout(ctx, time.Minute)
			err := store.CleanupAuth(cleanupCtx, now.UTC())
			cancel()
			if err != nil {
				logger.Error("auth cleanup failed", "error", err)
			}
		}
	}
}
