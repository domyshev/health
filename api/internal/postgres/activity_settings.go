package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/domyshev-labs/health-hub/api/internal/health"
)

func (s *Store) GetActivityFieldSettings(ctx context.Context, userID string) ([]health.ActivityFieldSetting, error) {
	rows, err := s.pool.Query(ctx, `SELECT activity_type, view_name, fields FROM activity_field_settings WHERE user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("get activity field settings: %w", err)
	}
	defer rows.Close()
	settings := []health.ActivityFieldSetting{}
	for rows.Next() {
		var item health.ActivityFieldSetting
		var raw []byte
		if err := rows.Scan(&item.Type, &item.View, &raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item.Fields); err != nil {
			return nil, err
		}
		settings = append(settings, item)
	}
	return settings, rows.Err()
}

func (s *Store) SaveActivityFieldSetting(ctx context.Context, userID string, setting health.ActivityFieldSetting) error {
	fields, err := json.Marshal(setting.Fields)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO activity_field_settings (user_id, activity_type, view_name, fields)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (user_id, activity_type, view_name) DO UPDATE SET fields = EXCLUDED.fields`, userID, setting.Type, setting.View, string(fields))
	return err
}
