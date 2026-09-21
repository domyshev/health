package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/domyshev-labs/health-hub/api/internal/health"
	"github.com/jackc/pgx/v5"
)

const activityColumns = `
	id,
	normalized_type,
	COALESCE(activity_type, ''),
	COALESCE(name, ''),
	started_at,
	COALESCE(timezone, ''),
	distance_m,
	duration_s,
	moving_duration_s,
	elapsed_duration_s,
	calories_kcal,
	average_hr_bpm,
	max_hr_bpm,
	COALESCE(environment, ''),
	pool_length_m,
	average_pace_per_100m_s,
	active_lengths,
	lap_count,
	total_strokes,
	average_strokes_per_length,
	average_swolf`

const activityCTE = `
	WITH normalized AS (
		SELECT
			a.id,
			a.user_id,
			a.activity_type,
			a.name,
			a.started_at,
			a.timezone,
			a.distance_m,
			a.duration_s,
			a.moving_duration_s,
			a.elapsed_duration_s,
			a.calories_kcal,
			a.average_hr_bpm,
			a.max_hr_bpm,
			COALESCE(a.started_at, 'epoch'::timestamptz) AS sort_started_at,
			CASE
				WHEN a.activity_type IN ('lap_swimming', 'open_water_swimming') THEN 'swimming'
				WHEN lower(COALESCE(a.activity_type, '')) LIKE '%run%' THEN 'running'
				WHEN lower(COALESCE(a.activity_type, '')) LIKE '%cycl%' OR lower(COALESCE(a.activity_type, '')) LIKE '%bike%' THEN 'cycling'
				WHEN lower(COALESCE(a.activity_type, '')) LIKE '%walk%' OR lower(COALESCE(a.activity_type, '')) LIKE '%hik%' THEN 'walking'
				WHEN lower(COALESCE(a.activity_type, '')) LIKE '%strength%' THEN 'strength'
				ELSE 'other'
			END AS normalized_type,
			s.environment,
			s.pool_length_m,
			s.average_pace_per_100m_s,
			s.active_lengths,
			s.lap_count,
			s.total_strokes,
			s.average_strokes_per_length,
			s.average_swolf
		FROM activities AS a
		LEFT JOIN swimming_activities AS s ON s.activity_id = a.id
	)`

func (s *Store) ListActivities(
	ctx context.Context,
	userID string,
	typeFilter string,
	cursor *health.ActivityCursor,
	limit int,
) ([]health.Activity, *health.ActivityCursor, error) {
	cursorTime := time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
	cursorID := "ffffffff-ffff-ffff-ffff-ffffffffffff"
	if cursor != nil {
		cursorTime = cursor.StartedAt
		cursorID = cursor.ID
	}
	rows, err := s.pool.Query(ctx, activityCTE+`
		SELECT `+activityColumns+`
		FROM normalized
		WHERE user_id = $1
		  AND ($2 = '' OR normalized_type = $2)
		  AND (sort_started_at, id) < ($3, $4::uuid)
		ORDER BY sort_started_at DESC, id DESC
		LIMIT $5`, userID, typeFilter, cursorTime, cursorID, limit+1)
	if err != nil {
		return nil, nil, fmt.Errorf("list activities: %w", err)
	}
	defer rows.Close()

	activities := make([]health.Activity, 0, limit+1)
	for rows.Next() {
		activity, err := scanActivity(rows)
		if err != nil {
			return nil, nil, err
		}
		activities = append(activities, activity)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("read activities: %w", err)
	}
	var next *health.ActivityCursor
	if len(activities) > limit {
		last := activities[limit-1]
		startedAt := time.Unix(0, 0).UTC()
		if last.StartedAt != nil {
			startedAt = *last.StartedAt
		}
		next = &health.ActivityCursor{StartedAt: startedAt, ID: last.ID}
		activities = activities[:limit]
	}
	return activities, next, nil
}

func (s *Store) GetActivity(ctx context.Context, userID, activityID string) (health.Activity, error) {
	row := s.pool.QueryRow(ctx, activityCTE+`
		SELECT `+activityColumns+`
		FROM normalized
		WHERE user_id = $1 AND id = $2`, userID, activityID)
	activity, err := scanActivity(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return health.Activity{}, health.ErrNotFound
	}
	return activity, err
}

type rowScanner interface {
	Scan(...any) error
}

func scanActivity(row rowScanner) (health.Activity, error) {
	var activity health.Activity
	if err := row.Scan(
		&activity.ID,
		&activity.Type,
		&activity.SourceType,
		&activity.Name,
		&activity.StartedAt,
		&activity.Timezone,
		&activity.DistanceM,
		&activity.DurationS,
		&activity.MovingDurationS,
		&activity.ElapsedDurationS,
		&activity.CaloriesKcal,
		&activity.AverageHRBPM,
		&activity.MaxHRBPM,
		&activity.SwimEnvironment,
		&activity.PoolLengthM,
		&activity.AveragePacePer100MS,
		&activity.ActiveLengths,
		&activity.LapCount,
		&activity.TotalStrokes,
		&activity.AverageStrokesPerLength,
		&activity.AverageSwolf,
	); err != nil {
		return health.Activity{}, fmt.Errorf("scan activity: %w", err)
	}
	return activity, nil
}

func (s *Store) ListSwimLengths(ctx context.Context, userID, activityID string) ([]health.SwimLength, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.lap_index, l.length_index, l.started_at, l.distance_m,
		       l.duration_s, l.average_speed_mps, l.pace_per_100m_s,
		       COALESCE(l.stroke_type, ''), l.calories_kcal, l.average_hr_bpm,
		       l.max_hr_bpm, l.stroke_count, l.swolf, l.is_rest
		FROM swim_lengths AS l
		JOIN activities AS a ON a.id = l.activity_id
		WHERE a.user_id = $1 AND a.id = $2
		ORDER BY l.lap_index, l.length_index`, userID, activityID)
	if err != nil {
		return nil, fmt.Errorf("list swim lengths: %w", err)
	}
	defer rows.Close()
	var result []health.SwimLength
	for rows.Next() {
		var item health.SwimLength
		if err := rows.Scan(
			&item.ID, &item.LapIndex, &item.LengthIndex, &item.StartedAt,
			&item.DistanceM, &item.DurationS, &item.AverageSpeedMPS, &item.PacePer100MS,
			&item.StrokeType, &item.CaloriesKcal, &item.AverageHRBPM, &item.MaxHRBPM,
			&item.StrokeCount, &item.Swolf, &item.IsRest,
		); err != nil {
			return nil, fmt.Errorf("scan swim length: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) ListSwimLaps(ctx context.Context, userID, activityID string) ([]health.SwimLap, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.lap_index, count(*)::int, sum(l.distance_m), sum(l.duration_s), bool_and(l.is_rest)
		FROM swim_lengths AS l
		JOIN activities AS a ON a.id = l.activity_id
		WHERE a.user_id = $1 AND a.id = $2
		GROUP BY l.lap_index
		ORDER BY l.lap_index`, userID, activityID)
	if err != nil {
		return nil, fmt.Errorf("list swim laps: %w", err)
	}
	defer rows.Close()
	var result []health.SwimLap
	for rows.Next() {
		var item health.SwimLap
		if err := rows.Scan(&item.LapIndex, &item.LengthCount, &item.DistanceM, &item.DurationS, &item.IsRest); err != nil {
			return nil, fmt.Errorf("scan swim lap: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) GetDailyHealth(ctx context.Context, userID string, date time.Time) (health.DailyHealth, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT health_date, steps, calories_kcal, distance_m, resting_hr_bpm,
		       max_hr_bpm, sleep_seconds, sleep_score, body_battery_high,
		       body_battery_low, stress_average
		FROM daily_health
		WHERE user_id = $1 AND health_date = $2
		ORDER BY source = 'garmin' DESC
		LIMIT 1`, userID, date)
	result, err := scanDailyHealth(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return health.DailyHealth{}, health.ErrNotFound
	}
	return result, err
}

func (s *Store) ListDailyHealth(ctx context.Context, userID string, from, to time.Time) ([]health.DailyHealth, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT health_date, steps, calories_kcal, distance_m, resting_hr_bpm,
		       max_hr_bpm, sleep_seconds, sleep_score, body_battery_high,
		       body_battery_low, stress_average
		FROM (
			SELECT DISTINCT ON (health_date)
			       health_date, steps, calories_kcal, distance_m, resting_hr_bpm,
			       max_hr_bpm, sleep_seconds, sleep_score, body_battery_high,
			       body_battery_low, stress_average
			FROM daily_health
			WHERE user_id = $1 AND health_date BETWEEN $2 AND $3
			ORDER BY health_date DESC, (source = 'garmin') DESC, updated_at DESC
		) AS preferred
		ORDER BY health_date DESC`, userID, from, to)
	if err != nil {
		return nil, fmt.Errorf("list daily health: %w", err)
	}
	defer rows.Close()
	var result []health.DailyHealth
	for rows.Next() {
		item, err := scanDailyHealth(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanDailyHealth(row rowScanner) (health.DailyHealth, error) {
	var result health.DailyHealth
	var date time.Time
	if err := row.Scan(
		&date, &result.Steps, &result.CaloriesKcal, &result.DistanceM,
		&result.RestingHRBPM, &result.MaxHRBPM, &result.SleepSeconds,
		&result.SleepScore, &result.BodyBatteryHigh, &result.BodyBatteryLow,
		&result.StressAverage,
	); err != nil {
		return health.DailyHealth{}, fmt.Errorf("scan daily health: %w", err)
	}
	result.Date = date.Format(time.DateOnly)
	return result, nil
}

func (s *Store) GetGarminConnection(ctx context.Context, userID string) (health.GarminConnection, error) {
	var result health.GarminConnection
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.status, COALESCE(c.garmin_email::text, ''),
		       c.last_successful_sync_at, COALESCE(latest.status, ''),
		       COALESCE(c.last_error_code, ''), COALESCE(active.id::text, '')
		FROM api_garmin_connections AS c
		LEFT JOIN LATERAL (
			SELECT status FROM garmin_sync_runs
			WHERE connection_id = c.id ORDER BY started_at DESC LIMIT 1
		) AS latest ON true
		LEFT JOIN LATERAL (
			SELECT id FROM garmin_sync_runs
			WHERE connection_id = c.id AND status = 'running'
			ORDER BY started_at DESC LIMIT 1
		) AS active ON true
		WHERE c.user_id = $1`, userID).Scan(
		&result.ID, &result.Status, &result.GarminEmail,
		&result.LastSuccessfulSyncAt, &result.LastSyncStatus,
		&result.LastErrorCode, &result.ActiveSyncRunID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return health.GarminConnection{}, health.ErrNotFound
	}
	if err != nil {
		return health.GarminConnection{}, fmt.Errorf("load Garmin connection: %w", err)
	}
	return result, nil
}

func (s *Store) GetSyncRun(ctx context.Context, userID, runID string) (health.SyncRun, error) {
	var result health.SyncRun
	err := s.pool.QueryRow(ctx, `
		SELECT run.id, run.status, run.started_at, run.finished_at,
		       run.discovered_count, run.imported_count, run.updated_count,
		       run.failed_count, COALESCE(run.error_summary, '')
		FROM garmin_sync_runs AS run
		JOIN api_garmin_connections AS connection ON connection.id = run.connection_id
		WHERE connection.user_id = $1 AND run.id = $2`, userID, runID).Scan(
		&result.ID, &result.Status, &result.StartedAt, &result.FinishedAt,
		&result.DiscoveredCount, &result.ImportedCount, &result.UpdatedCount,
		&result.FailedCount, &result.ErrorSummary,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return health.SyncRun{}, health.ErrNotFound
	}
	if err != nil {
		return health.SyncRun{}, fmt.Errorf("load sync run: %w", err)
	}
	return result, nil
}
