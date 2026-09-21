package httpapi

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/health"
	"github.com/domyshev-labs/health-hub/api/internal/importer"
)

func (s *Server) registerHealthRoutes(mux *http.ServeMux) {
	mux.Handle("GET /v1/activities", s.requireAuth(http.HandlerFunc(s.handleListActivities)))
	mux.Handle("GET /v1/activities/{activityId}", s.requireAuth(http.HandlerFunc(s.handleGetActivity)))
	mux.Handle("GET /v1/activities/{activityId}/laps", s.requireAuth(http.HandlerFunc(s.handleListSwimLaps)))
	mux.Handle("GET /v1/activities/{activityId}/swim-lengths", s.requireAuth(http.HandlerFunc(s.handleListSwimLengths)))
	mux.Handle("GET /v1/daily-health/{date}", s.requireAuth(http.HandlerFunc(s.handleGetDailyHealth)))
	mux.Handle("GET /v1/daily-health", s.requireAuth(http.HandlerFunc(s.handleListDailyHealth)))
	mux.Handle("GET /v1/integrations/garmin", s.requireAuth(http.HandlerFunc(s.handleGetGarminConnection)))
	mux.Handle("POST /v1/integrations/garmin/connect", s.requireAuth(http.HandlerFunc(s.handleConnectGarmin)))
	mux.Handle("POST /v1/integrations/garmin/challenges/{challengeId}/verify", s.requireAuth(http.HandlerFunc(s.handleVerifyGarminMFA)))
	mux.Handle("POST /v1/sync-runs", s.requireAuth(http.HandlerFunc(s.handleStartSync)))
	mux.Handle("GET /v1/sync-runs/{syncRunId}", s.requireAuth(http.HandlerFunc(s.handleGetSyncRun)))
}

func (s *Server) handleListActivities(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			s.writeError(w, r, http.StatusBadRequest, "invalid_request", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	typeFilter := r.URL.Query().Get("type")
	if !validActivityTypeFilter(typeFilter) {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "activity type filter is invalid")
		return
	}
	cursor, err := decodeActivityCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid_cursor", "The pagination cursor is invalid")
		return
	}
	user := userFromContext(r.Context())
	activities, next, err := s.health.ListActivities(r.Context(), user.ID, typeFilter, cursor, limit)
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	nextCursor := ""
	if next != nil {
		nextCursor = encodeActivityCursor(*next)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": activities, "nextCursor": nextCursor})
}

func (s *Server) handleGetActivity(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	activityID := r.PathValue("activityId")
	if !validUUID(activityID) {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "activityId must be a UUID")
		return
	}
	activity, err := s.health.GetActivity(r.Context(), userFromContext(r.Context()).ID, activityID)
	if errors.Is(err, health.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "not_found", "Activity not found")
		return
	}
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, activity)
}

func (s *Server) handleListSwimLengths(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	activityID := r.PathValue("activityId")
	if !validUUID(activityID) {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "activityId must be a UUID")
		return
	}
	items, err := s.health.ListSwimLengths(r.Context(), userFromContext(r.Context()).ID, activityID)
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleListSwimLaps(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	activityID := r.PathValue("activityId")
	if !validUUID(activityID) {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "activityId must be a UUID")
		return
	}
	items, err := s.health.ListSwimLaps(r.Context(), userFromContext(r.Context()).ID, activityID)
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGetDailyHealth(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	date, err := time.Parse(time.DateOnly, r.PathValue("date"))
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "date must use YYYY-MM-DD")
		return
	}
	item, err := s.health.GetDailyHealth(r.Context(), userFromContext(r.Context()).ID, date)
	if errors.Is(err, health.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "not_found", "Daily health data not found")
		return
	}
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleListDailyHealth(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	from, fromErr := time.Parse(time.DateOnly, r.URL.Query().Get("from"))
	to, toErr := time.Parse(time.DateOnly, r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil || to.Before(from) || to.Sub(from) > 366*24*time.Hour {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "from and to must define a range of at most 366 days")
		return
	}
	items, err := s.health.ListDailyHealth(r.Context(), userFromContext(r.Context()).ID, from, to)
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGetGarminConnection(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	connection, err := s.health.GetGarminConnection(r.Context(), userFromContext(r.Context()).ID)
	if errors.Is(err, health.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not_connected"})
		return
	}
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, connection)
}

func (s *Server) handleConnectGarmin(w http.ResponseWriter, r *http.Request) {
	if !s.requireAllowedOrigin(w, r) {
		return
	}
	if s.importer == nil {
		s.serviceUnavailable(w, r)
		return
	}
	var request struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !s.decodeJSON(w, r, &request) {
		return
	}
	if strings.TrimSpace(request.Email) == "" || request.Password == "" {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "Garmin email and password are required")
		return
	}
	result, err := s.importer.Connect(r.Context(), userFromContext(r.Context()).ID, request.Email, request.Password)
	request.Password = ""
	if err != nil {
		s.writeImporterError(w, r, err)
		return
	}
	status := http.StatusOK
	if result.Status == "mfa_required" {
		status = http.StatusAccepted
	}
	writeJSON(w, status, result)
}

func (s *Server) handleVerifyGarminMFA(w http.ResponseWriter, r *http.Request) {
	if !s.requireAllowedOrigin(w, r) {
		return
	}
	if s.importer == nil {
		s.serviceUnavailable(w, r)
		return
	}
	var request struct {
		Code string `json:"code"`
	}
	if !s.decodeJSON(w, r, &request) {
		return
	}
	result, err := s.importer.VerifyMFA(
		r.Context(),
		userFromContext(r.Context()).ID,
		r.PathValue("challengeId"),
		request.Code,
	)
	request.Code = ""
	if err != nil {
		s.writeImporterError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleStartSync(w http.ResponseWriter, r *http.Request) {
	if !s.requireAllowedOrigin(w, r) {
		return
	}
	if s.health == nil || s.importer == nil {
		s.serviceUnavailable(w, r)
		return
	}
	user := userFromContext(r.Context())
	connection, err := s.health.GetGarminConnection(r.Context(), user.ID)
	if errors.Is(err, health.ErrNotFound) {
		s.writeError(w, r, http.StatusConflict, "garmin_reconnect_required", "Garmin is not connected")
		return
	}
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	if connection.ActiveSyncRunID != "" {
		s.writeError(w, r, http.StatusConflict, "sync_already_running", "A synchronization is already running")
		return
	}
	result, err := s.importer.StartSync(r.Context(), user.ID, connection.ID)
	if err != nil {
		s.writeImporterError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleGetSyncRun(w http.ResponseWriter, r *http.Request) {
	if s.health == nil {
		s.serviceUnavailable(w, r)
		return
	}
	runID := r.PathValue("syncRunId")
	if !validUUID(runID) {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "syncRunId must be a UUID")
		return
	}
	run, err := s.health.GetSyncRun(r.Context(), userFromContext(r.Context()).ID, runID)
	if errors.Is(err, health.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "not_found", "Sync run not found")
		return
	}
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) writeImporterError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, importer.ErrAuthenticationFailed):
		s.writeError(w, r, http.StatusUnauthorized, "garmin_auth_failed", "Garmin authentication failed")
	case errors.Is(err, importer.ErrChallengeInvalid):
		s.writeError(w, r, http.StatusUnauthorized, "invalid_or_expired_challenge", "The Garmin challenge is invalid or expired")
	case errors.Is(err, importer.ErrReconnectRequired):
		s.writeError(w, r, http.StatusConflict, "garmin_reconnect_required", "Garmin access must be refreshed")
	case errors.Is(err, importer.ErrSyncAlreadyRunning):
		s.writeError(w, r, http.StatusConflict, "sync_already_running", "A synchronization is already running")
	default:
		s.serviceUnavailable(w, r)
	}
}

func (s *Server) serviceUnavailable(w http.ResponseWriter, r *http.Request) {
	s.writeError(w, r, http.StatusServiceUnavailable, "service_unavailable", "The service is temporarily unavailable")
}

func validActivityTypeFilter(value string) bool {
	switch value {
	case "", "running", "cycling", "walking", "swimming", "strength", "other":
		return true
	default:
		return false
	}
}

func encodeActivityCursor(cursor health.ActivityCursor) string {
	payload, _ := json.Marshal(struct {
		StartedAt time.Time `json:"startedAt"`
		ID        string    `json:"id"`
	}{cursor.StartedAt, cursor.ID})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeActivityCursor(value string) (*health.ActivityCursor, error) {
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(payload) > 1024 {
		return nil, errors.New("invalid cursor")
	}
	var decoded struct {
		StartedAt time.Time `json:"startedAt"`
		ID        string    `json:"id"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil || decoded.StartedAt.IsZero() || !validUUID(decoded.ID) {
		return nil, errors.New("invalid cursor")
	}
	return &health.ActivityCursor{StartedAt: decoded.StartedAt, ID: decoded.ID}, nil
}

func validUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	compact := strings.ReplaceAll(value, "-", "")
	if len(compact) != 32 {
		return false
	}
	_, err := hex.DecodeString(compact)
	return err == nil
}
