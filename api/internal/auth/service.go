package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"strings"
	"time"
)

var (
	ErrInvalidOrExpiredCode = errors.New("invalid or expired code")
	ErrRateLimited          = errors.New("rate limited")
	ErrUnauthenticated      = errors.New("unauthenticated")
	ErrEmailDelivery        = errors.New("email delivery failed")
)

type User struct {
	ID          string
	Email       string
	DisplayName string
	Role        string
	Status      string
}

type LoginCodeIssue struct {
	Email     string
	CodeHash  []byte
	RequestIP netip.Addr
	CreatedAt time.Time
	ExpiresAt time.Time
}

type SessionIssue struct {
	Email         string
	TokenHash     []byte
	CreatedIP     netip.Addr
	UserAgentHash []byte
	CreatedAt     time.Time
	ExpiresAt     time.Time
}

type VerifyResult struct {
	User      User
	Token     string
	ExpiresAt time.Time
}

type Repository interface {
	RegisterLoginRequest(context.Context, []byte, netip.Addr, time.Time) error
	IssueLoginCode(context.Context, LoginCodeIssue) (string, error)
	InvalidateLoginCode(context.Context, string) error
	ConsumeLoginCode(context.Context, string, []byte, time.Time, int) (bool, error)
	CreateSession(context.Context, SessionIssue) (User, error)
	SessionUser(context.Context, []byte, time.Time) (User, error)
	RevokeSession(context.Context, []byte) error
}

type EmailSender interface {
	SendLoginCode(context.Context, string, string, time.Duration) error
}

type ServiceConfig struct {
	Repository           Repository
	Sender               EmailSender
	Secret               []byte
	AllowedEmails        map[string]struct{}
	CodeLifetime         time.Duration
	SessionLifetime      time.Duration
	Random               io.Reader
	Now                  func() time.Time
	DevelopmentLoginCode string
}

type Service struct {
	repository           Repository
	sender               EmailSender
	secret               []byte
	allowedEmails        map[string]struct{}
	codeLifetime         time.Duration
	sessionLifetime      time.Duration
	random               io.Reader
	now                  func() time.Time
	developmentLoginCode string
}

func NewService(cfg ServiceConfig) *Service {
	if cfg.Random == nil {
		cfg.Random = rand.Reader
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Service{
		repository:           cfg.Repository,
		sender:               cfg.Sender,
		secret:               append([]byte(nil), cfg.Secret...),
		allowedEmails:        cfg.AllowedEmails,
		codeLifetime:         cfg.CodeLifetime,
		sessionLifetime:      cfg.SessionLifetime,
		random:               cfg.Random,
		now:                  cfg.Now,
		developmentLoginCode: cfg.DevelopmentLoginCode,
	}
}

func (s *Service) RequestCode(ctx context.Context, rawEmail string, requestIP netip.Addr) error {
	email, err := NormalizeEmail(rawEmail)
	if err != nil {
		return nil
	}
	now := s.now().UTC()
	if err := s.repository.RegisterLoginRequest(
		ctx,
		CodeDigest(s.secret, email, "request"),
		requestIP,
		now,
	); err != nil {
		return err
	}
	code, err := GenerateCode(s.random)
	if err != nil {
		return err
	}
	candidate := CodeDigest(s.secret, email, code)
	if _, allowed := s.allowedEmails[email]; !allowed {
		_ = VerifyCodeDigest(candidate, CodeDigest(s.secret, email, "000000"))
		return nil
	}
	id, err := s.repository.IssueLoginCode(ctx, LoginCodeIssue{
		Email:     email,
		CodeHash:  candidate,
		RequestIP: requestIP,
		CreatedAt: now,
		ExpiresAt: now.Add(s.codeLifetime),
	})
	if err != nil {
		return err
	}
	if err := s.sender.SendLoginCode(ctx, email, code, s.codeLifetime); err != nil {
		_ = s.repository.InvalidateLoginCode(ctx, id)
		return ErrEmailDelivery
	}
	return nil
}

func (s *Service) VerifyCode(
	ctx context.Context,
	rawEmail string,
	code string,
	requestIP netip.Addr,
	userAgent string,
) (VerifyResult, error) {
	email, err := NormalizeEmail(rawEmail)
	if err != nil {
		return VerifyResult{}, ErrInvalidOrExpiredCode
	}
	if s.developmentLoginCode != "" && code == s.developmentLoginCode {
		if _, allowed := s.allowedEmails[email]; !allowed {
			return VerifyResult{}, ErrInvalidOrExpiredCode
		}
		return s.createSession(ctx, email, requestIP, userAgent)
	}
	if !validCode(code) {
		return VerifyResult{}, ErrInvalidOrExpiredCode
	}
	if _, allowed := s.allowedEmails[email]; !allowed {
		return VerifyResult{}, ErrInvalidOrExpiredCode
	}
	now := s.now().UTC()
	valid, err := s.repository.ConsumeLoginCode(
		ctx,
		email,
		CodeDigest(s.secret, email, code),
		now,
		5,
	)
	if err != nil {
		return VerifyResult{}, err
	}
	if !valid {
		return VerifyResult{}, ErrInvalidOrExpiredCode
	}
	user, err := s.createSession(ctx, email, requestIP, userAgent)
	if err != nil {
		return VerifyResult{}, err
	}
	return user, nil
}

func (s *Service) createSession(ctx context.Context, email string, requestIP netip.Addr, userAgent string) (VerifyResult, error) {
	now := s.now().UTC()
	token, tokenHash, err := GenerateSessionToken(s.random)
	if err != nil {
		return VerifyResult{}, err
	}
	expiresAt := now.Add(s.sessionLifetime)
	userAgentHash := sha256.Sum256([]byte(userAgent))
	user, err := s.repository.CreateSession(ctx, SessionIssue{
		Email:         email,
		TokenHash:     tokenHash,
		CreatedIP:     requestIP,
		UserAgentHash: userAgentHash[:],
		CreatedAt:     now,
		ExpiresAt:     expiresAt,
	})
	if err != nil {
		return VerifyResult{}, err
	}
	return VerifyResult{User: user, Token: token, ExpiresAt: expiresAt}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if strings.TrimSpace(token) == "" {
		return User{}, ErrUnauthenticated
	}
	user, err := s.repository.SessionUser(ctx, HashSessionToken(token), s.now().UTC())
	if err != nil {
		return User{}, fmt.Errorf("authenticate session: %w", err)
	}
	if user.ID == "" || user.Status != "active" {
		return User{}, ErrUnauthenticated
	}
	return user, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.repository.RevokeSession(ctx, HashSessionToken(token))
}

func validCode(code string) bool {
	if len(code) != codeDigits {
		return false
	}
	for _, char := range code {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
