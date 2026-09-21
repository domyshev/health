package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
	"github.com/domyshev-labs/health-hub/api/internal/health"
	"github.com/domyshev-labs/health-hub/api/internal/importer"
)

type AuthService interface {
	RequestCode(context.Context, string, netip.Addr) error
	VerifyCode(context.Context, string, string, netip.Addr, string) (auth.VerifyResult, error)
	Authenticate(context.Context, string) (auth.User, error)
	Logout(context.Context, string) error
}

type Readiness interface {
	Ping(context.Context) error
}

type ServerConfig struct {
	Auth             AuthService
	Health           health.Repository
	Importer         importer.Client
	Readiness        Readiness
	Logger           *slog.Logger
	CookieName       string
	CookieSecure     bool
	AllowedOrigins   map[string]struct{}
	TrustedProxies   []netip.Prefix
	RequestBodyLimit int64
}

type Server struct {
	auth             AuthService
	health           health.Repository
	importer         importer.Client
	readiness        Readiness
	logger           *slog.Logger
	cookieName       string
	cookieSecure     bool
	allowedOrigins   map[string]struct{}
	trustedProxies   []netip.Prefix
	requestBodyLimit int64
	handler          http.Handler
}

type contextKey string

const (
	userContextKey   contextKey = "user"
	tokenContextKey  contextKey = "session-token"
	requestIDKey     contextKey = "request-id"
	defaultBodyLimit            = int64(1 << 20)
)

func NewServer(cfg ServerConfig) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.RequestBodyLimit <= 0 {
		cfg.RequestBodyLimit = defaultBodyLimit
	}
	server := &Server{
		auth:             cfg.Auth,
		health:           cfg.Health,
		importer:         cfg.Importer,
		readiness:        cfg.Readiness,
		logger:           cfg.Logger,
		cookieName:       cfg.CookieName,
		cookieSecure:     cfg.CookieSecure,
		allowedOrigins:   cfg.AllowedOrigins,
		trustedProxies:   cfg.TrustedProxies,
		requestBodyLimit: cfg.RequestBodyLimit,
	}
	server.handler = server.routes()
	return server
}

func (s *Server) Handler() http.Handler {
	return s.withRequestID(s.withSecurityHeaders(s.withCORS(s.withRecovery(s.handler))))
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", s.handleLive)
	mux.HandleFunc("GET /health/ready", s.handleReady)
	mux.HandleFunc("POST /v1/auth/request-code", s.handleRequestCode)
	mux.HandleFunc("POST /v1/auth/verify-code", s.handleVerifyCode)
	mux.Handle("POST /v1/auth/logout", s.requireAuth(http.HandlerFunc(s.handleLogout)))
	mux.Handle("GET /v1/me", s.requireAuth(http.HandlerFunc(s.handleMe)))
	s.registerHealthRoutes(mux)
	return mux
}

func (s *Server) handleLive(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if s.readiness == nil || s.readiness.Ping(r.Context()) != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "service_unavailable", "The service is not ready")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) handleRequestCode(w http.ResponseWriter, r *http.Request) {
	if s.auth == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "service_unavailable", "Authentication is unavailable")
		return
	}
	var request struct {
		Email string `json:"email"`
	}
	if !s.decodeJSON(w, r, &request) {
		return
	}
	err := s.auth.RequestCode(r.Context(), request.Email, ClientIP(r, s.trustedProxies))
	if errors.Is(err, auth.ErrRateLimited) {
		s.writeError(w, r, http.StatusTooManyRequests, "rate_limited", "Too many requests")
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "service_unavailable", "Login email could not be sent")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) handleVerifyCode(w http.ResponseWriter, r *http.Request) {
	if s.auth == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "service_unavailable", "Authentication is unavailable")
		return
	}
	var request struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !s.decodeJSON(w, r, &request) {
		return
	}
	result, err := s.auth.VerifyCode(
		r.Context(),
		request.Email,
		request.Code,
		ClientIP(r, s.trustedProxies),
		r.UserAgent(),
	)
	if errors.Is(err, auth.ErrInvalidOrExpiredCode) {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_or_expired_code", "The login code is invalid or expired")
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "service_unavailable", "Login could not be completed")
		return
	}
	http.SetCookie(w, s.sessionCookie(result.Token, result.ExpiresAt))
	writeJSON(w, http.StatusOK, meResponse(result.User))
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, meResponse(userFromContext(r.Context())))
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if !s.requireAllowedOrigin(w, r) {
		return
	}
	if err := s.auth.Logout(r.Context(), tokenFromContext(r.Context())); err != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "service_unavailable", "Logout could not be completed")
		return
	}
	http.SetCookie(w, s.expiredSessionCookie())
	w.WriteHeader(http.StatusNoContent)
}

func meResponse(user auth.User) map[string]any {
	return map[string]any{
		"id":          user.ID,
		"email":       user.Email,
		"displayName": user.DisplayName,
		"role":        user.Role,
	}
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.auth == nil {
			s.writeError(w, r, http.StatusUnauthorized, "session_expired", "Authentication is required")
			return
		}
		cookie, err := r.Cookie(s.cookieName)
		if err != nil || cookie.Value == "" {
			s.writeError(w, r, http.StatusUnauthorized, "session_expired", "Authentication is required")
			return
		}
		user, err := s.auth.Authenticate(r.Context(), cookie.Value)
		if err != nil {
			s.writeError(w, r, http.StatusUnauthorized, "session_expired", "Authentication is required")
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		ctx = context.WithValue(ctx, tokenContextKey, cookie.Value)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func userFromContext(ctx context.Context) auth.User {
	user, _ := ctx.Value(userContextKey).(auth.User)
	return user
}

func tokenFromContext(ctx context.Context) string {
	token, _ := ctx.Value(tokenContextKey).(string)
	return token
}

func (s *Server) sessionCookie(token string, expiresAt time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     s.cookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		Secure:   s.cookieSecure,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Server) expiredSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     s.cookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		Secure:   s.cookieSecure,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Server) requireAllowedOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || !OriginAllowed(origin, s.allowedOrigins) {
		s.writeError(w, r, http.StatusForbidden, "invalid_origin", "The request origin is not allowed")
		return false
	}
	return true
}

func (s *Server) decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		s.writeError(w, r, http.StatusUnsupportedMediaType, "invalid_request", "Content-Type must be application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.requestBodyLimit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body must contain one JSON object")
		return false
	}
	return true
}

func (s *Server) writeError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":      code,
			"message":   message,
			"requestId": requestIDFromContext(r.Context()),
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" || len(requestID) > 128 {
			requestID = newRequestID()
		}
		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, requestID)))
	})
}

func requestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey).(string)
	return value
}

func newRequestID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return time.Now().UTC().Format("20060102T150405.000000000")
	}
	return hex.EncodeToString(buffer)
}

func (s *Server) withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !OriginAllowed(origin, s.allowedOrigins) {
				s.writeError(w, r, http.StatusForbidden, "invalid_origin", "The request origin is not allowed")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-Request-ID")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", "request_id", requestIDFromContext(r.Context()))
				s.writeError(w, r, http.StatusInternalServerError, "internal_error", "An internal error occurred")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
