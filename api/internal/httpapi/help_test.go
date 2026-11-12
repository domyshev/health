package httpapi

import (
	"context"
	"github.com/domyshev-labs/health-hub/api/internal/health"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeHelpRepository struct {
	*fakeHealthRepository
	notes []health.HelpNote
}

func (f *fakeHelpRepository) CreateHelpNote(_ context.Context, userID, note string) (health.HelpNote, error) {
	f.requestedUserID = userID
	item := health.HelpNote{ID: "note-id", Note: note, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	f.notes = append(f.notes, item)
	return item, nil
}
func (f *fakeHelpRepository) ListHelpNotes(_ context.Context, userID string) ([]health.HelpNote, error) {
	f.requestedUserID = userID
	return f.notes, nil
}
func TestHelpNotes(t *testing.T) {
	repo := &fakeHelpRepository{fakeHealthRepository: &fakeHealthRepository{}}
	handler := authenticatedServer(repo, &fakeImporterClient{})
	for _, tc := range []struct {
		body, origin string
		status       int
	}{
		{`{"note":"hello"}`, "", http.StatusForbidden},
		{`{"note":"  "}`, "https://health.example", http.StatusBadRequest},
		{`{"note":"  I need a pause  "}`, "https://health.example", http.StatusCreated},
	} {
		req := authenticatedRequest(http.MethodPost, "/v1/help-notes", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", tc.origin)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("got %d, want %d: %s", res.Code, tc.status, res.Body.String())
		}
	}
	if repo.requestedUserID != "owner-id" || len(repo.notes) != 1 || repo.notes[0].Note != "I need a pause" {
		t.Fatalf("unexpected notes: %+v", repo)
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, authenticatedRequest(http.MethodGet, "/v1/help-notes", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"createdAt":"2026-01-01T00:00:00Z"`) {
		t.Fatalf("unexpected response: %s", res.Body.String())
	}
	unauth := httptest.NewRecorder()
	handler.ServeHTTP(unauth, httptest.NewRequest(http.MethodGet, "/v1/help-notes", nil))
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status: %d", unauth.Code)
	}
}
