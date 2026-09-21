package postgres_test

import (
	"context"
	"crypto/rand"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
	"github.com/domyshev-labs/health-hub/api/internal/health"
	"github.com/domyshev-labs/health-hub/api/internal/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testStore(t *testing.T) (*postgres.Store, *pgxpool.Pool) {
	t.Helper()
	databaseURL := os.Getenv("HEALTH_HUB_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("HEALTH_HUB_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	_, file, _, _ := runtime.Caller(0)
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "../../../migrations"))
	if err := postgres.ApplyMigrations(ctx, pool, migrations); err != nil {
		pool.Close()
		t.Fatalf("apply migrations: %v", err)
	}
	return postgres.New(pool), pool
}

func TestLoginCodesSessionsAndAttemptLimit(t *testing.T) {
	store, pool := testStore(t)
	defer pool.Close()
	ctx := context.Background()
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	secret := []byte("01234567890123456789012345678901")
	email := "integration-" + now.Format("150405.000000000") + "@example.com"
	codeHash := auth.CodeDigest(secret, email, "123456")
	id, err := store.IssueLoginCode(ctx, auth.LoginCodeIssue{
		Email: email, CodeHash: codeHash, RequestIP: netip.MustParseAddr("203.0.113.10"),
		CreatedAt: now, ExpiresAt: now.Add(10 * time.Minute),
	})
	if err != nil || id == "" {
		t.Fatalf("IssueLoginCode: id=%q err=%v", id, err)
	}
	for range 4 {
		valid, err := store.ConsumeLoginCode(ctx, email, auth.CodeDigest(secret, email, "000000"), now, 5)
		if err != nil || valid {
			t.Fatalf("invalid attempt: valid=%v err=%v", valid, err)
		}
	}
	valid, err := store.ConsumeLoginCode(ctx, email, codeHash, now, 5)
	if err != nil || !valid {
		t.Fatalf("valid code rejected: valid=%v err=%v", valid, err)
	}

	token, tokenHash, err := auth.GenerateSessionToken(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateSession(ctx, auth.SessionIssue{
		Email: email, TokenHash: tokenHash, CreatedIP: netip.MustParseAddr("203.0.113.10"),
		UserAgentHash: []byte("browser-hash"), CreatedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour),
	})
	if err != nil || user.ID == "" {
		t.Fatalf("CreateSession: user=%+v err=%v", user, err)
	}
	loaded, err := store.SessionUser(ctx, auth.HashSessionToken(token), now.Add(time.Minute))
	if err != nil || loaded.ID != user.ID {
		t.Fatalf("SessionUser: user=%+v err=%v", loaded, err)
	}
	if err := store.RevokeSession(ctx, tokenHash); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SessionUser(ctx, tokenHash, now.Add(time.Minute)); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("revoked session error = %v", err)
	}
}

func TestRateLimitsAndDatabaseRoleIsolation(t *testing.T) {
	store, pool := testStore(t)
	defer pool.Close()
	ctx := context.Background()
	now := time.Date(2026, 9, 21, 13, 0, 0, 0, time.UTC)
	requestHash := auth.CodeDigest([]byte("01234567890123456789012345678901"), "unknown@example.com", "request")
	for index := range 5 {
		err := store.RegisterLoginRequest(
			ctx,
			requestHash,
			netip.MustParseAddr("203.0.113.19"),
			now.Add(time.Duration(index)*61*time.Second),
		)
		if err != nil {
			t.Fatalf("register login request %d: %v", index, err)
		}
	}
	if err := store.RegisterLoginRequest(ctx, requestHash, netip.MustParseAddr("203.0.113.19"), now.Add(6*time.Minute)); !errors.Is(err, auth.ErrRateLimited) {
		t.Fatalf("sixth neutral request error = %v", err)
	}
	email := "rate-limit@example.com"
	for index := range 5 {
		_, err := store.IssueLoginCode(ctx, auth.LoginCodeIssue{
			Email: email, CodeHash: []byte{byte(index)}, RequestIP: netip.MustParseAddr("203.0.113.20"),
			CreatedAt: now.Add(time.Duration(index) * 61 * time.Second), ExpiresAt: now.Add(time.Hour),
		})
		if err != nil {
			t.Fatalf("request %d failed: %v", index, err)
		}
	}
	_, err := store.IssueLoginCode(ctx, auth.LoginCodeIssue{
		Email: email, CodeHash: []byte("sixth"), RequestIP: netip.MustParseAddr("203.0.113.20"),
		CreatedAt: now.Add(6 * time.Minute), ExpiresAt: now.Add(time.Hour),
	})
	if !errors.Is(err, auth.ErrRateLimited) {
		t.Fatalf("sixth request error = %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE health_hub_api"); err != nil {
		t.Fatalf("set API role: %v", err)
	}
	if _, err := tx.Exec(ctx, "SELECT 1 FROM activities LIMIT 1"); err != nil {
		t.Fatalf("API role cannot read normalized activities: %v", err)
	}
	if _, err := tx.Exec(ctx, "SELECT 1 FROM garmin_raw_resources LIMIT 1"); err == nil {
		t.Fatal("API role can read Garmin raw resources")
	}
}

func TestConcurrentCodeConsumptionCreatesOnlyOneWinner(t *testing.T) {
	store, pool := testStore(t)
	defer pool.Close()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	email := "concurrent-" + now.Format("150405.000000000") + "@example.com"
	hash := auth.CodeDigest([]byte("01234567890123456789012345678901"), email, "123456")
	if _, err := store.IssueLoginCode(ctx, auth.LoginCodeIssue{
		Email: email, CodeHash: hash, RequestIP: netip.MustParseAddr("203.0.113.31"),
		CreatedAt: now, ExpiresAt: now.Add(10 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}

	var winners atomic.Int32
	var wait sync.WaitGroup
	errorsChannel := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			valid, err := store.ConsumeLoginCode(ctx, email, hash, now, 5)
			if err != nil {
				errorsChannel <- err
				return
			}
			if valid {
				winners.Add(1)
			}
		}()
	}
	wait.Wait()
	close(errorsChannel)
	for err := range errorsChannel {
		t.Fatal(err)
	}
	if winners.Load() != 1 {
		t.Fatalf("successful consumptions = %d, want 1", winners.Load())
	}
}

func TestActivityOwnershipAndOfflineRead(t *testing.T) {
	store, pool := testStore(t)
	defer pool.Close()
	ctx := context.Background()
	unique := time.Now().Format("150405.000000000")
	var ownerID, otherID, activityID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email) VALUES ($1) RETURNING id`,
		"owner-"+unique+"@example.com",
	).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email) VALUES ($1) RETURNING id`,
		"other-"+unique+"@example.com",
	).Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO activities (user_id, source, external_id, activity_type, name, started_at)
		VALUES ($1, 'garmin', $2, 'lap_swimming', 'Offline Pool Swim', now())
		RETURNING id`, ownerID, "offline-"+unique,
	).Scan(&activityID); err != nil {
		t.Fatal(err)
	}

	activity, err := store.GetActivity(ctx, ownerID, activityID)
	if err != nil || activity.Name != "Offline Pool Swim" || activity.Type != "swimming" {
		t.Fatalf("owner read: activity=%+v err=%v", activity, err)
	}
	if _, err := store.GetActivity(ctx, otherID, activityID); !errors.Is(err, health.ErrNotFound) {
		t.Fatalf("foreign activity read error = %v", err)
	}
	date := time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC)
	if _, err := pool.Exec(ctx, `
		INSERT INTO daily_health (user_id, source, health_date, steps)
		VALUES ($1, 'other', $2, 100), ($1, 'garmin', $2, 200)`, ownerID, date); err != nil {
		t.Fatal(err)
	}
	days, err := store.ListDailyHealth(ctx, ownerID, date, date)
	if err != nil || len(days) != 1 || days[0].Steps == nil || *days[0].Steps != 200 {
		t.Fatalf("daily health precedence: items=%+v err=%v", days, err)
	}
}
