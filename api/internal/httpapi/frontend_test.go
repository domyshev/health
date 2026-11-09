package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFrontendPreservesAPIAndServesDashboardRoutes(t *testing.T) {
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"index.html": "dashboard", "assets/app.js": "script", "deployment.json": `{"commit":"test"}`} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	handler := WithFrontend(directory, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("api"))
	}))
	for _, test := range []struct {
		method, path string
		status       int
		body, cache  string
	}{
		{"GET", "/", 200, "dashboard", "no-store"},
		{"GET", "/activities/43", 200, "dashboard", "no-store"},
		{"GET", "/assets/app.js", 200, "script", "public, max-age=31536000, immutable"},
		{"GET", "/deployment.json", 200, `{"commit":"test"}`, "no-store"},
		{"GET", "/assets/missing.js", 404, "", "no-store"},
		{"GET", "/.env", 404, "", "no-store"},
		{"GET", "/v1/me", 401, "api", ""},
		{"GET", "/v1/unknown", 401, "api", ""},
		{"GET", "/health/ready", 401, "api", ""},
		{"POST", "/activities", 405, "", ""},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.body) || response.Header().Get("Cache-Control") != test.cache {
				t.Fatalf("unexpected response: %d %q cache=%q", response.Code, response.Body.String(), response.Header().Get("Cache-Control"))
			}
		})
	}
}
