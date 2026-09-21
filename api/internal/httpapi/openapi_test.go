package httpapi

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestOpenAPIIncludesEveryPublicRouteAndCookieSecurity(t *testing.T) {
	t.Parallel()
	_, file, _, _ := runtime.Caller(0)
	path := filepath.Clean(filepath.Join(filepath.Dir(file), "../../../docs/openapi.yaml"))
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read OpenAPI document: %v", err)
	}
	document := string(content)
	for _, route := range []string{
		"/health/live:",
		"/health/ready:",
		"/v1/auth/request-code:",
		"/v1/auth/verify-code:",
		"/v1/auth/logout:",
		"/v1/me:",
		"/v1/activities:",
		"/v1/activities/{activityId}:",
		"/v1/activities/{activityId}/laps:",
		"/v1/activities/{activityId}/swim-lengths:",
		"/v1/daily-health:",
		"/v1/daily-health/{date}:",
		"/v1/sync-runs:",
		"/v1/sync-runs/{syncRunId}:",
		"/v1/integrations/garmin:",
		"/v1/integrations/garmin/connect:",
		"/v1/integrations/garmin/challenges/{challengeId}/verify:",
	} {
		if !strings.Contains(document, route) {
			t.Errorf("OpenAPI document is missing %s", route)
		}
	}
	for _, marker := range []string{
		"type: apiKey",
		"in: cookie",
		"name: __Host-health_hub_session",
		"additionalProperties: false",
	} {
		if !strings.Contains(document, marker) {
			t.Errorf("OpenAPI document is missing %q", marker)
		}
	}
}
