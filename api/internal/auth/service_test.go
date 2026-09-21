package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"net/netip"
	"testing"
	"time"
)

type fakeRepository struct {
	registered     bool
	issued         *LoginCodeIssue
	invalidatedID  string
	consumeValid   bool
	consumeCalls   int
	createdSession *SessionIssue
	user           User
	sessionUser    User
	revokedHash    []byte
}

func (f *fakeRepository) RegisterLoginRequest(_ context.Context, _ []byte, _ netip.Addr, _ time.Time) error {
	f.registered = true
	return nil
}

func (f *fakeRepository) IssueLoginCode(_ context.Context, issue LoginCodeIssue) (string, error) {
	f.issued = &issue
	return "code-id", nil
}

func (f *fakeRepository) InvalidateLoginCode(_ context.Context, id string) error {
	f.invalidatedID = id
	return nil
}

func (f *fakeRepository) ConsumeLoginCode(_ context.Context, email string, candidateHash []byte, now time.Time, maxAttempts int) (bool, error) {
	f.consumeCalls++
	return f.consumeValid, nil
}

func (f *fakeRepository) CreateSession(_ context.Context, issue SessionIssue) (User, error) {
	f.createdSession = &issue
	return f.user, nil
}

func (f *fakeRepository) SessionUser(_ context.Context, tokenHash []byte, now time.Time) (User, error) {
	return f.sessionUser, nil
}

func (f *fakeRepository) RevokeSession(_ context.Context, tokenHash []byte) error {
	f.revokedHash = tokenHash
	return nil
}

type fakeSender struct {
	email string
	code  string
	err   error
}

func (f *fakeSender) SendLoginCode(_ context.Context, email, code string, _ time.Duration) error {
	f.email, f.code = email, code
	return f.err
}

func newTestService(repo Repository, sender EmailSender) *Service {
	return NewService(ServiceConfig{
		Repository:      repo,
		Sender:          sender,
		Secret:          []byte("01234567890123456789012345678901"),
		AllowedEmails:   map[string]struct{}{"user@example.com": {}},
		CodeLifetime:    10 * time.Minute,
		SessionLifetime: 30 * 24 * time.Hour,
		Random:          rand.Reader,
		Now:             func() time.Time { return time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC) },
	})
}

func TestRequestCodeStoresHashAndSendsPlainCode(t *testing.T) {
	t.Parallel()
	repo := &fakeRepository{}
	sender := &fakeSender{}
	service := newTestService(repo, sender)
	ip := netip.MustParseAddr("203.0.113.10")

	if err := service.RequestCode(context.Background(), " User@Example.com ", ip); err != nil {
		t.Fatalf("RequestCode returned error: %v", err)
	}
	if repo.issued == nil || repo.issued.Email != "user@example.com" || repo.issued.RequestIP != ip {
		t.Fatalf("unexpected issue: %+v", repo.issued)
	}
	if len(repo.issued.CodeHash) != 32 || sender.email != "user@example.com" || len(sender.code) != 6 {
		t.Fatalf("hash or email delivery missing: issue=%+v sender=%+v", repo.issued, sender)
	}
	if string(repo.issued.CodeHash) == sender.code {
		t.Fatal("plaintext code was stored")
	}
}

func TestRequestCodeForEmailOutsideAllowlistIsNeutral(t *testing.T) {
	t.Parallel()
	repo := &fakeRepository{}
	sender := &fakeSender{}
	service := newTestService(repo, sender)

	if err := service.RequestCode(context.Background(), "other@example.com", netip.MustParseAddr("203.0.113.10")); err != nil {
		t.Fatalf("RequestCode returned error: %v", err)
	}
	if !repo.registered || repo.issued != nil || sender.email != "" {
		t.Fatal("outside email was not rate limited neutrally")
	}
}

func TestRequestCodeInvalidatesCodeWhenEmailFails(t *testing.T) {
	t.Parallel()
	repo := &fakeRepository{}
	sender := &fakeSender{err: errors.New("delivery failed")}
	service := newTestService(repo, sender)

	err := service.RequestCode(context.Background(), "user@example.com", netip.MustParseAddr("203.0.113.10"))
	if err == nil || repo.invalidatedID != "code-id" {
		t.Fatalf("code was not invalidated: err=%v id=%q", err, repo.invalidatedID)
	}
}

func TestVerifyCodeCreatesUserSession(t *testing.T) {
	t.Parallel()
	repo := &fakeRepository{consumeValid: true, user: User{ID: "user-id", Email: "user@example.com"}}
	service := newTestService(repo, &fakeSender{})

	result, err := service.VerifyCode(context.Background(), "user@example.com", "123456", netip.MustParseAddr("203.0.113.10"), "browser")
	if err != nil {
		t.Fatalf("VerifyCode returned error: %v", err)
	}
	if result.User.ID != "user-id" || result.Token == "" || repo.createdSession == nil {
		t.Fatalf("session not created: result=%+v issue=%+v", result, repo.createdSession)
	}
	if len(repo.createdSession.TokenHash) != 32 {
		t.Fatal("session hash was not persisted")
	}
}

func TestVerifyCodeUsesStableFailure(t *testing.T) {
	t.Parallel()
	repo := &fakeRepository{consumeValid: false}
	service := newTestService(repo, &fakeSender{})

	_, err := service.VerifyCode(context.Background(), "user@example.com", "123456", netip.MustParseAddr("203.0.113.10"), "browser")
	if !errors.Is(err, ErrInvalidOrExpiredCode) {
		t.Fatalf("unexpected error: %v", err)
	}
}
