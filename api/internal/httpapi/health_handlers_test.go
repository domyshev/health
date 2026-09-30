package httpapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/auth"
	"github.com/domyshev-labs/health-hub/api/internal/health"
	"github.com/domyshev-labs/health-hub/api/internal/importer"
)

type fakeHealthRepository struct {
	requestedUserID string
	activities      []health.Activity
	connection      health.GarminConnection
	run             health.SyncRun
}

func (f *fakeHealthRepository) ListActivities(_ context.Context, userID, _ string, _ *health.ActivityCursor, _ int) ([]health.Activity, *health.ActivityCursor, error) {
	f.requestedUserID = userID
	return f.activities, nil, nil
}

func (f *fakeHealthRepository) GetActivity(_ context.Context, userID, activityID string) (health.Activity, error) {
	f.requestedUserID = userID
	if activityID != "activity-id" {
		return health.Activity{}, health.ErrNotFound
	}
	return f.activities[0], nil
}

func (f *fakeHealthRepository) ListSwimLengths(context.Context, string, string) ([]health.SwimLength, error) {
	return nil, nil
}

func (f *fakeHealthRepository) ListSwimLaps(context.Context, string, string) ([]health.SwimLap, error) {
	return nil, nil
}

func (f *fakeHealthRepository) GetDailyHealth(context.Context, string, time.Time) (health.DailyHealth, error) {
	return health.DailyHealth{}, health.ErrNotFound
}

func (f *fakeHealthRepository) ListDailyHealth(context.Context, string, time.Time, time.Time) ([]health.DailyHealth, error) {
	return nil, nil
}

func (f *fakeHealthRepository) GetGarminConnection(_ context.Context, userID string) (health.GarminConnection, error) {
	f.requestedUserID = userID
	return f.connection, nil
}

func (f *fakeHealthRepository) GetSyncRun(_ context.Context, userID, _ string) (health.SyncRun, error) {
	f.requestedUserID = userID
	return f.run, nil
}

type fakeImporterClient struct {
	connectEmail    string
	connectPassword string
	syncUserID      string
	syncConnection  string
}

func (f *fakeImporterClient) Connect(_ context.Context, _ string, email, password string) (importer.ConnectResult, error) {
	f.connectEmail, f.connectPassword = email, password
	return importer.ConnectResult{Status: "connected", ConnectionID: "connection-id"}, nil
}

func (f *fakeImporterClient) VerifyMFA(context.Context, string, string, string) (importer.ConnectResult, error) {
	return importer.ConnectResult{Status: "connected"}, nil
}

func (f *fakeImporterClient) StartSync(_ context.Context, userID, connectionID, mode string) (importer.SyncResult, error) {
	f.syncUserID, f.syncConnection = userID, connectionID
	return importer.SyncResult{RunID: "run-id", Status: "running"}, nil
}

func authenticatedServer(repository health.Repository, importerClient importer.Client) http.Handler {
	service := &fakeAuthService{authenticated: auth.User{
		ID: "owner-id", Email: "owner@example.com", Status: "active",
	}}
	return NewServer(ServerConfig{
		Auth: service, Health: repository, Importer: importerClient,
		CookieName: "session", AllowedOrigins: map[string]struct{}{"https://health.example": {}},
	}).Handler()
}

func authenticatedRequest(method, target string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, target, body)
	request.AddCookie(&http.Cookie{Name: "session", Value: "valid-session"})
	return request
}

func TestActivitiesUseAuthenticatedUserAndNormalizedDTO(t *testing.T) {
	t.Parallel()
	repository := &fakeHealthRepository{activities: []health.Activity{{
		ID: "activity-id", Type: "swimming", Name: "Pool Swim",
	}}}
	handler := authenticatedServer(repository, &fakeImporterClient{})
	request := authenticatedRequest(http.MethodGet, "/v1/activities?type=swimming&limit=20", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || repository.requestedUserID != "owner-id" {
		t.Fatalf("status=%d user=%q body=%s", response.Code, repository.requestedUserID, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"type":"swimming"`) {
		t.Fatalf("normalized activity missing: %s", response.Body.String())
	}
}

func TestGarminStatusNormalizesStoredActiveState(t *testing.T) {
	t.Parallel()
	repository := &fakeHealthRepository{connection: health.GarminConnection{
		ID: "connection-id", Status: "active", GarminEmail: "garmin@example.com",
	}}
	handler := authenticatedServer(repository, &fakeImporterClient{})
	request := authenticatedRequest(http.MethodGet, "/v1/integrations/garmin", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"status":"connected"`) || strings.Contains(response.Body.String(), `"status":"active"`) {
		t.Fatalf("unexpected public status: %s", response.Body.String())
	}
}

func TestGarminConnectRequiresOriginAndForwardsCredentialsOnce(t *testing.T) {
	t.Parallel()
	client := &fakeImporterClient{}
	handler := authenticatedServer(&fakeHealthRepository{}, client)
	request := authenticatedRequest(http.MethodPost, "/v1/integrations/garmin/connect", strings.NewReader(`{"email":"garmin@example.com","password":"one-time-password"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://health.example")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || client.connectEmail != "garmin@example.com" || client.connectPassword != "one-time-password" {
		t.Fatalf("connect failed: status=%d email=%q body=%s", response.Code, client.connectEmail, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "one-time-password") {
		t.Fatal("password was returned in the response")
	}
}

func TestManualSyncUsesOwnedConnection(t *testing.T) {
	t.Parallel()
	repository := &fakeHealthRepository{connection: health.GarminConnection{ID: "connection-id", Status: "active"}}
	client := &fakeImporterClient{}
	handler := authenticatedServer(repository, client)
	request := authenticatedRequest(http.MethodPost, "/v1/sync-runs", strings.NewReader(`{"mode":"recent"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://health.example")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted || client.syncUserID != "owner-id" || client.syncConnection != "connection-id" {
		t.Fatalf("sync failed: status=%d user=%q connection=%q body=%s", response.Code, client.syncUserID, client.syncConnection, response.Body.String())
	}
}

func TestActivityRoutesRejectMalformedUUIDsBeforeRepositoryAccess(t *testing.T) {
	t.Parallel()
	repository := &fakeHealthRepository{}
	handler := authenticatedServer(repository, &fakeImporterClient{})
	request := authenticatedRequest(http.MethodGet, "/v1/activities/not-a-uuid", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || repository.requestedUserID != "" {
		t.Fatalf("status=%d user=%q body=%s", response.Code, repository.requestedUserID, response.Body.String())
	}
}

func TestActivityCursorRejectsMalformedUUID(t *testing.T) {
	t.Parallel()
	encoded := encodeActivityCursor(health.ActivityCursor{
		StartedAt: time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC),
		ID:        "not-a-uuid",
	})
	if _, err := decodeActivityCursor(encoded); err == nil {
		t.Fatal("cursor accepted a malformed activity ID")
	}
}
