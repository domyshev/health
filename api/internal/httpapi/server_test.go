package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
)

type fakeAuthService struct {
	requestedEmail string
	verifyResult   auth.VerifyResult
	authenticated  auth.User
	logoutToken    string
}

func (f *fakeAuthService) RequestCode(_ context.Context, email string, _ netip.Addr) error {
	f.requestedEmail = email
	return nil
}

func (f *fakeAuthService) VerifyCode(_ context.Context, email, code string, _ netip.Addr, _ string) (auth.VerifyResult, error) {
	return f.verifyResult, nil
}

func (f *fakeAuthService) Authenticate(_ context.Context, token string) (auth.User, error) {
	if token == "valid-session" {
		return f.authenticated, nil
	}
	return auth.User{}, auth.ErrUnauthenticated
}

func (f *fakeAuthService) Logout(_ context.Context, token string) error {
	f.logoutToken = token
	return nil
}

func testServer(authService AuthService) http.Handler {
	return NewServer(ServerConfig{
		Auth:             authService,
		CookieName:       "__Host-health_hub_session",
		CookieSecure:     true,
		AllowedOrigins:   map[string]struct{}{"https://health.example": {}},
		TrustedProxies:   []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
		RequestBodyLimit: 1 << 20,
	}).Handler()
}

func TestRequestCodeReturnsNeutralAcceptedResponse(t *testing.T) {
	t.Parallel()
	service := &fakeAuthService{}
	handler := testServer(service)
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/request-code", strings.NewReader(`{"email":"user@example.com"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	if service.requestedEmail != "user@example.com" {
		t.Fatalf("email = %q", service.requestedEmail)
	}
	var payload map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload["status"] != "accepted" {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}

func TestVerifyCodeSetsHostCookie(t *testing.T) {
	t.Parallel()
	service := &fakeAuthService{verifyResult: auth.VerifyResult{
		User:      auth.User{ID: "user-id", Email: "user@example.com", Status: "active"},
		Token:     "session-token",
		ExpiresAt: time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC),
	}}
	handler := testServer(service)
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/verify-code", strings.NewReader(`{"email":"user@example.com","code":"123456"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %v", cookies)
	}
	cookie := cookies[0]
	if cookie.Name != "__Host-health_hub_session" || cookie.Value != "session-token" || !cookie.Secure || !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode || cookie.Domain != "" {
		t.Fatalf("unsafe cookie: %+v", cookie)
	}
}

func TestMeRequiresValidSessionAndReturnsSafeUser(t *testing.T) {
	t.Parallel()
	service := &fakeAuthService{authenticated: auth.User{
		ID: "user-id", Email: "user@example.com", DisplayName: "User", Role: "user", Status: "active",
	}}
	handler := testServer(service)
	request := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: "__Host-health_hub_session", Value: "valid-session"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "Status") || !strings.Contains(response.Body.String(), "user@example.com") {
		t.Fatalf("unexpected response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLogoutRequiresAllowedOriginAndExpiresSession(t *testing.T) {
	t.Parallel()
	service := &fakeAuthService{authenticated: auth.User{ID: "user-id", Status: "active"}}
	handler := testServer(service)

	forbidden := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	forbidden.AddCookie(&http.Cookie{Name: "__Host-health_hub_session", Value: "valid-session"})
	forbiddenResponse := httptest.NewRecorder()
	handler.ServeHTTP(forbiddenResponse, forbidden)
	if forbiddenResponse.Code != http.StatusForbidden {
		t.Fatalf("missing origin status = %d", forbiddenResponse.Code)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	request.Header.Set("Origin", "https://health.example")
	request.AddCookie(&http.Cookie{Name: "__Host-health_hub_session", Value: "valid-session"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent || service.logoutToken != "valid-session" {
		t.Fatalf("logout failed: status=%d token=%q", response.Code, service.logoutToken)
	}
	cookie := response.Result().Cookies()[0]
	if cookie.MaxAge >= 0 {
		t.Fatalf("cookie was not expired: %+v", cookie)
	}
}

func TestRecoveredPanicKeepsRequestIDInErrorContract(t *testing.T) {
	t.Parallel()
	server := NewServer(ServerConfig{AllowedOrigins: map[string]struct{}{}})
	server.handler = http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("test panic")
	})
	request := httptest.NewRequest(http.MethodGet, "/panic", nil)
	request.Header.Set("X-Request-ID", "panic-request-id")
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"requestId":"panic-request-id"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
