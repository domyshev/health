package importer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHTTPClientAuthenticatesAndDoesNotChangeCredentialPayload(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer control-secret" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["userId"] != "user-id" || payload["email"] != "garmin@example.com" || payload["password"] != "one-time-password" {
			t.Fatalf("payload = %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"connected","connectionId":"connection-id"}`))
	}))
	defer server.Close()

	client, err := NewHTTPClient(server.URL, "control-secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Connect(context.Background(), "user-id", "garmin@example.com", "one-time-password")
	if err != nil || result.ConnectionID != "connection-id" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestHTTPClientMapsStablePrivateErrorCodes(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":{"code":"sync_already_running"}}`))
	}))
	defer server.Close()
	client, err := NewHTTPClient(server.URL, "control-secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.StartSync(context.Background(), "user-id", "connection-id")
	if err != ErrSyncAlreadyRunning {
		t.Fatalf("error = %v", err)
	}
}
