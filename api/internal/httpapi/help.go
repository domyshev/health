package httpapi

import (
	"github.com/domyshev-labs/health-hub/api/internal/health"
	"net/http"
	"strings"
	"unicode/utf8"
)

func (s *Server) handleHelpNotes(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.health.(health.HelpNotesRepository)
	if !ok {
		s.serviceUnavailable(w, r)
		return
	}
	userID := userFromContext(r.Context()).ID
	if r.Method == http.MethodGet {
		items, err := repo.ListHelpNotes(r.Context(), userID)
		if err != nil {
			s.serviceUnavailable(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	if !s.requireAllowedOrigin(w, r) {
		return
	}
	var request struct {
		Note string `json:"note"`
	}
	if !s.decodeJSON(w, r, &request) {
		return
	}
	request.Note = strings.TrimSpace(request.Note)
	if request.Note == "" || utf8.RuneCountInString(request.Note) > 5000 {
		s.writeError(w, r, http.StatusBadRequest, "invalid_request", "Note must contain 1 to 5000 characters")
		return
	}
	item, err := repo.CreateHelpNote(r.Context(), userID, request.Note)
	if err != nil {
		s.serviceUnavailable(w, r)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}
