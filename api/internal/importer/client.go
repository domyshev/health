package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrAuthenticationFailed = errors.New("Garmin authentication failed")
	ErrMFARequired          = errors.New("Garmin MFA required")
	ErrChallengeInvalid     = errors.New("Garmin challenge invalid")
	ErrReconnectRequired    = errors.New("Garmin reconnect required")
	ErrSyncAlreadyRunning   = errors.New("sync already running")
	ErrUnavailable          = errors.New("importer unavailable")
)

type ConnectResult struct {
	Status       string    `json:"status"`
	ConnectionID string    `json:"connectionId,omitempty"`
	ChallengeID  string    `json:"challengeId,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt,omitempty"`
}

type SyncResult struct {
	RunID  string `json:"syncRunId"`
	Status string `json:"status"`
}

type Client interface {
	Connect(context.Context, string, string, string) (ConnectResult, error)
	VerifyMFA(context.Context, string, string, string) (ConnectResult, error)
	StartSync(context.Context, string, string, string) (SyncResult, error)
}

type HTTPClient struct {
	baseURL *url.URL
	secret  string
	client  *http.Client
}

func NewHTTPClient(baseURL, secret string, timeout time.Duration) (*HTTPClient, error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("invalid importer base URL")
	}
	return &HTTPClient{
		baseURL: parsed,
		secret:  secret,
		client:  &http.Client{Timeout: timeout},
	}, nil
}

func (c *HTTPClient) Connect(ctx context.Context, userID, email, password string) (ConnectResult, error) {
	var result ConnectResult
	err := c.post(ctx, "/private/v1/garmin/connect", map[string]string{
		"userId":   userID,
		"email":    email,
		"password": password,
	}, &result)
	return result, err
}

func (c *HTTPClient) VerifyMFA(ctx context.Context, userID, challengeID, code string) (ConnectResult, error) {
	var result ConnectResult
	path := "/private/v1/garmin/challenges/" + url.PathEscape(challengeID) + "/verify"
	err := c.post(ctx, path, map[string]string{
		"userId": userID,
		"code":   code,
	}, &result)
	return result, err
}

func (c *HTTPClient) StartSync(ctx context.Context, userID, connectionID, mode string) (SyncResult, error) {
	var result SyncResult
	err := c.post(ctx, "/private/v1/sync-runs", map[string]string{
		"userId":       userID,
		"connectionId": connectionID,
		"mode":         mode,
	}, &result)
	return result, err
}

func (c *HTTPClient) post(ctx context.Context, path string, payload any, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode importer request: %w", err)
	}
	endpoint := c.baseURL.ResolveReference(&url.URL{Path: path})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create importer request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.secret)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(request)
	if err != nil {
		return ErrUnavailable
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, 1<<20)
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		if err := json.NewDecoder(limited).Decode(target); err != nil {
			return fmt.Errorf("decode importer response: %w", err)
		}
		return nil
	}
	var failure struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(limited).Decode(&failure)
	switch failure.Error.Code {
	case "garmin_auth_failed":
		return ErrAuthenticationFailed
	case "mfa_required":
		return ErrMFARequired
	case "invalid_or_expired_challenge":
		return ErrChallengeInvalid
	case "garmin_reconnect_required":
		return ErrReconnectRequired
	case "sync_already_running":
		return ErrSyncAlreadyRunning
	default:
		return ErrUnavailable
	}
}
