package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	databaseURL := os.Getenv("HEALTH_HUB_DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("HEALTH_HUB_DATABASE_URL is required")
	}
	directory := os.Getenv("MIGRATIONS_DIR")
	if directory == "" {
		directory = "../migrations"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer pool.Close()
	if err := postgres.ApplyMigrations(ctx, pool, directory); err != nil {
		log.Fatalf("apply migrations: %v", err)
	}
	log.Printf("migrations applied from %s", directory)
}
