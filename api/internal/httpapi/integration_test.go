package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
	"github.com/domyshev-labs/health-hub/api/internal/httpapi"
	"github.com/domyshev-labs/health-hub/api/internal/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

type capturedEmail struct {
	email string
	code  string
}

func (c *capturedEmail) SendLoginCode(_ context.Context, email, code string, _ time.Duration) error {
	c.email = email
	c.code = code
	return nil
}

func TestPasswordlessBrowserFlowWithPostgreSQL(t *testing.T) {
	databaseURL := os.Getenv("HEALTH_HUB_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("HEALTH_HUB_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, file, _, _ := runtime.Caller(0)
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "../../../migrations"))
	if err := postgres.ApplyMigrations(ctx, pool, migrations); err != nil {
		t.Fatal(err)
	}
	store := postgres.New(pool)
	email := "browser-" + time.Now().Format("150405.000000000") + "@example.com"
	sender := &capturedEmail{}
	service := auth.NewService(auth.ServiceConfig{
		Repository:      store,
		Sender:          sender,
		Secret:          []byte("01234567890123456789012345678901"),
		AllowedEmails:   map[string]struct{}{email: {}},
		CodeLifetime:    10 * time.Minute,
		SessionLifetime: 30 * 24 * time.Hour,
	})
	handler := httpapi.NewServer(httpapi.ServerConfig{
		Auth:           service,
		Health:         store,
		Readiness:      store,
		CookieName:     "__Host-health_hub_session",
		CookieSecure:   true,
		AllowedOrigins: map[string]struct{}{"https://health.example": {}},
	}).Handler()

	request := httptest.NewRequest(http.MethodPost, "/v1/auth/request-code", strings.NewReader(`{"email":"`+email+`"}`))
	request.Header.Set("Content-Type", "application/json")
	requestResponse := httptest.NewRecorder()
	handler.ServeHTTP(requestResponse, request)
	if requestResponse.Code != http.StatusAccepted || sender.email != email || len(sender.code) != 6 {
		t.Fatalf("request code: status=%d sender=%+v body=%s", requestResponse.Code, sender, requestResponse.Body.String())
	}

	verify := httptest.NewRequest(http.MethodPost, "/v1/auth/verify-code", strings.NewReader(`{"email":"`+email+`","code":"`+sender.code+`"}`))
	verify.Header.Set("Content-Type", "application/json")
	verifyResponse := httptest.NewRecorder()
	handler.ServeHTTP(verifyResponse, verify)
	if verifyResponse.Code != http.StatusOK {
		t.Fatalf("verify code: status=%d body=%s", verifyResponse.Code, verifyResponse.Body.String())
	}
	cookies := verifyResponse.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly {
		t.Fatalf("session cookie: %+v", cookies)
	}
	var user map[string]any
	if err := json.Unmarshal(verifyResponse.Body.Bytes(), &user); err != nil || user["email"] != email {
		t.Fatalf("user response: %s err=%v", verifyResponse.Body.String(), err)
	}

	me := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	me.AddCookie(cookies[0])
	meResponse := httptest.NewRecorder()
	handler.ServeHTTP(meResponse, me)
	if meResponse.Code != http.StatusOK {
		t.Fatalf("me: status=%d body=%s", meResponse.Code, meResponse.Body.String())
	}

	logout := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	logout.Header.Set("Origin", "https://health.example")
	logout.AddCookie(cookies[0])
	logoutResponse := httptest.NewRecorder()
	handler.ServeHTTP(logoutResponse, logout)
	if logoutResponse.Code != http.StatusNoContent {
		t.Fatalf("logout: status=%d body=%s", logoutResponse.Code, logoutResponse.Body.String())
	}

	afterLogout := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	afterLogout.AddCookie(cookies[0])
	afterLogoutResponse := httptest.NewRecorder()
	handler.ServeHTTP(afterLogoutResponse, afterLogout)
	if afterLogoutResponse.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session status=%d", afterLogoutResponse.Code)
	}
}
