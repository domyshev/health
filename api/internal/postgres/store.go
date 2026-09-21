package postgres

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping PostgreSQL: %w", err)
	}
	return &Store{pool: pool}, nil
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) RegisterLoginRequest(ctx context.Context, emailHash []byte, requestIP netip.Addr, now time.Time) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("begin login request transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	emailKey := hex.EncodeToString(emailHash)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 2))", emailKey); err != nil {
		return fmt.Errorf("lock login request email: %w", err)
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 3))", requestIP.String()); err != nil {
		return fmt.Errorf("lock login request IP: %w", err)
	}
	var emailCount, ipCount int
	var latestCreated *time.Time
	if err := tx.QueryRow(ctx,
		"SELECT count(*), max(created_at) FROM auth_login_requests WHERE email_hash = $1 AND created_at >= $2",
		emailHash, now.Add(-time.Hour),
	).Scan(&emailCount, &latestCreated); err != nil {
		return fmt.Errorf("count email login requests: %w", err)
	}
	if err := tx.QueryRow(ctx,
		"SELECT count(*) FROM auth_login_requests WHERE request_ip = $1 AND created_at >= $2",
		requestIP.String(), now.Add(-time.Hour),
	).Scan(&ipCount); err != nil {
		return fmt.Errorf("count IP login requests: %w", err)
	}
	if emailCount >= 5 || ipCount >= 20 || (latestCreated != nil && latestCreated.After(now.Add(-time.Minute))) {
		return auth.ErrRateLimited
	}
	if _, err := tx.Exec(ctx,
		"INSERT INTO auth_login_requests (email_hash, request_ip, created_at) VALUES ($1, $2, $3)",
		emailHash, requestIP.String(), now,
	); err != nil {
		return fmt.Errorf("record login request: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit login request: %w", err)
	}
	return nil
}

func (s *Store) IssueLoginCode(ctx context.Context, issue auth.LoginCodeIssue) (string, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return "", fmt.Errorf("begin login-code transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", issue.Email); err != nil {
		return "", fmt.Errorf("lock login-code email: %w", err)
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", issue.RequestIP.String()); err != nil {
		return "", fmt.Errorf("lock login-code IP: %w", err)
	}

	var emailCount, ipCount int
	var latestCreated *time.Time
	if err := tx.QueryRow(ctx,
		"SELECT count(*) FROM auth_login_codes WHERE email = $1 AND created_at >= $2",
		issue.Email, issue.CreatedAt.Add(-time.Hour),
	).Scan(&emailCount); err != nil {
		return "", fmt.Errorf("count email login codes: %w", err)
	}
	if err := tx.QueryRow(ctx,
		"SELECT count(*) FROM auth_login_codes WHERE request_ip = $1 AND created_at >= $2",
		issue.RequestIP.String(), issue.CreatedAt.Add(-time.Hour),
	).Scan(&ipCount); err != nil {
		return "", fmt.Errorf("count IP login codes: %w", err)
	}
	if err := tx.QueryRow(ctx,
		"SELECT max(created_at) FROM auth_login_codes WHERE email = $1",
		issue.Email,
	).Scan(&latestCreated); err != nil {
		return "", fmt.Errorf("find latest login code: %w", err)
	}
	if emailCount >= 5 || ipCount >= 20 || (latestCreated != nil && latestCreated.After(issue.CreatedAt.Add(-time.Minute))) {
		return "", auth.ErrRateLimited
	}
	if _, err := tx.Exec(ctx,
		"UPDATE auth_login_codes SET invalidated_at = $2 WHERE email = $1 AND consumed_at IS NULL AND invalidated_at IS NULL",
		issue.Email, issue.CreatedAt,
	); err != nil {
		return "", fmt.Errorf("invalidate previous login codes: %w", err)
	}
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO auth_login_codes (email, code_hash, request_ip, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`,
		issue.Email, issue.CodeHash, issue.RequestIP.String(), issue.ExpiresAt, issue.CreatedAt,
	).Scan(&id); err != nil {
		return "", fmt.Errorf("insert login code: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit login code: %w", err)
	}
	return id, nil
}

func (s *Store) InvalidateLoginCode(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx,
		"UPDATE auth_login_codes SET invalidated_at = now() WHERE id = $1 AND consumed_at IS NULL",
		id,
	)
	if err != nil {
		return fmt.Errorf("invalidate login code: %w", err)
	}
	return nil
}

func (s *Store) ConsumeLoginCode(
	ctx context.Context,
	email string,
	candidateHash []byte,
	now time.Time,
	maxAttempts int,
) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin code verification: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id string
	var expectedHash []byte
	var attempts int
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, code_hash, attempts, expires_at
		FROM auth_login_codes
		WHERE email = $1
		  AND consumed_at IS NULL
		  AND invalidated_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE`, email,
	).Scan(&id, &expectedHash, &attempts, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load login code: %w", err)
	}

	if !expiresAt.After(now) || attempts >= maxAttempts {
		_, err = tx.Exec(ctx, "UPDATE auth_login_codes SET invalidated_at = $2 WHERE id = $1", id, now)
		if err != nil {
			return false, fmt.Errorf("invalidate expired login code: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit expired login code: %w", err)
		}
		return false, nil
	}
	if !auth.VerifyCodeDigest(expectedHash, candidateHash) {
		attempts++
		_, err = tx.Exec(ctx, `
			UPDATE auth_login_codes
			SET attempts = $2::integer,
			    invalidated_at = CASE WHEN $2::integer >= $3::integer THEN $4::timestamptz ELSE invalidated_at END
			WHERE id = $1`, id, attempts, maxAttempts, now)
		if err != nil {
			return false, fmt.Errorf("record failed code attempt: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit failed code attempt: %w", err)
		}
		return false, nil
	}
	if _, err := tx.Exec(ctx,
		"UPDATE auth_login_codes SET consumed_at = $2 WHERE id = $1",
		id, now,
	); err != nil {
		return false, fmt.Errorf("consume login code: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit consumed login code: %w", err)
	}
	return true, nil
}

func (s *Store) CreateSession(ctx context.Context, issue auth.SessionIssue) (auth.User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.User{}, fmt.Errorf("begin session transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var user auth.User
	if err := tx.QueryRow(ctx, `
		INSERT INTO users (email, last_login_at)
		VALUES ($1, $2)
		ON CONFLICT (email) DO UPDATE SET last_login_at = EXCLUDED.last_login_at, updated_at = now()
		RETURNING id, email::text, COALESCE(display_name, ''), role, status`,
		issue.Email, issue.CreatedAt,
	).Scan(&user.ID, &user.Email, &user.DisplayName, &user.Role, &user.Status); err != nil {
		return auth.User{}, fmt.Errorf("upsert authenticated user: %w", err)
	}
	if user.Status != "active" {
		return auth.User{}, auth.ErrUnauthenticated
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_sessions (
			token_hash, user_id, expires_at, created_at, last_seen_at, user_agent_hash, created_ip
		) VALUES ($1, $2, $3, $4, $4, $5, $6)`,
		issue.TokenHash, user.ID, issue.ExpiresAt, issue.CreatedAt, issue.UserAgentHash, issue.CreatedIP.String(),
	); err != nil {
		return auth.User{}, fmt.Errorf("insert session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.User{}, fmt.Errorf("commit session: %w", err)
	}
	return user, nil
}

func (s *Store) SessionUser(ctx context.Context, tokenHash []byte, now time.Time) (auth.User, error) {
	var user auth.User
	err := s.pool.QueryRow(ctx, `
		UPDATE auth_sessions AS session
		SET last_seen_at = $2
		FROM users AS account
		WHERE session.token_hash = $1
		  AND session.user_id = account.id
		  AND session.revoked_at IS NULL
		  AND session.expires_at > $2
		  AND account.status = 'active'
		RETURNING account.id, account.email::text, COALESCE(account.display_name, ''), account.role, account.status`,
		tokenHash, now,
	).Scan(&user.ID, &user.Email, &user.DisplayName, &user.Role, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, auth.ErrUnauthenticated
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("load session user: %w", err)
	}
	return user, nil
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx,
		"UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
		tokenHash,
	)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

func (s *Store) CleanupAuth(ctx context.Context, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "DELETE FROM auth_login_codes WHERE expires_at < $1", now.Add(-24*time.Hour)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "DELETE FROM auth_login_requests WHERE created_at < $1", now.Add(-24*time.Hour)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "DELETE FROM auth_sessions WHERE expires_at < $1 OR revoked_at < $2", now, now.Add(-7*24*time.Hour)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
