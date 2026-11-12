package health

import (
	"context"
	"time"
)

type HelpNote struct {
	ID        string    `json:"id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"createdAt"`
}

type HelpNotesRepository interface {
	CreateHelpNote(context.Context, string, string) (HelpNote, error)
	ListHelpNotes(context.Context, string) ([]HelpNote, error)
}
