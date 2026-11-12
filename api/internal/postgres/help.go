package postgres

import (
	"context"
	"github.com/domyshev-labs/health-hub/api/internal/health"
)

func (s *Store) CreateHelpNote(ctx context.Context, userID, note string) (health.HelpNote, error) {
	var item health.HelpNote
	err := s.pool.QueryRow(ctx, `INSERT INTO help_notes (user_id, note) VALUES ($1, $2) RETURNING id, note, created_at`, userID, note).Scan(&item.ID, &item.Note, &item.CreatedAt)
	item.CreatedAt = item.CreatedAt.UTC()
	return item, err
}

func (s *Store) ListHelpNotes(ctx context.Context, userID string) ([]health.HelpNote, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, note, created_at FROM help_notes WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []health.HelpNote{}
	for rows.Next() {
		var item health.HelpNote
		if err := rows.Scan(&item.ID, &item.Note, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.CreatedAt = item.CreatedAt.UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}
