package health

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("not found")

type ActivityCursor struct {
	StartedAt time.Time
	ID        string
}

type Activity struct {
	ID                      string     `json:"id"`
	Type                    string     `json:"type"`
	SourceType              string     `json:"sourceType,omitempty"`
	Name                    string     `json:"name,omitempty"`
	StartedAt               *time.Time `json:"startedAt,omitempty"`
	Timezone                string     `json:"timezone,omitempty"`
	DistanceM               *float64   `json:"distanceM,omitempty"`
	DurationS               *float64   `json:"durationS,omitempty"`
	MovingDurationS         *float64   `json:"movingDurationS,omitempty"`
	ElapsedDurationS        *float64   `json:"elapsedDurationS,omitempty"`
	CaloriesKcal            *float64   `json:"caloriesKcal,omitempty"`
	AverageHRBPM            *float64   `json:"averageHrBpm,omitempty"`
	MaxHRBPM                *float64   `json:"maxHrBpm,omitempty"`
	SwimEnvironment         string     `json:"swimEnvironment,omitempty"`
	PoolLengthM             *float64   `json:"poolLengthM,omitempty"`
	AveragePacePer100MS     *float64   `json:"averagePacePer100mS,omitempty"`
	ActiveLengths           *int       `json:"activeLengths,omitempty"`
	LapCount                *int       `json:"lapCount,omitempty"`
	TotalStrokes            *int       `json:"totalStrokes,omitempty"`
	AverageStrokesPerLength *float64   `json:"averageStrokesPerLength,omitempty"`
	AverageSwolf            *float64   `json:"averageSwolf,omitempty"`
}

type SwimLength struct {
	ID              string     `json:"id"`
	LapIndex        int        `json:"lapIndex"`
	LengthIndex     int        `json:"lengthIndex"`
	StartedAt       *time.Time `json:"startedAt,omitempty"`
	DistanceM       *float64   `json:"distanceM,omitempty"`
	DurationS       *float64   `json:"durationS,omitempty"`
	AverageSpeedMPS *float64   `json:"averageSpeedMps,omitempty"`
	PacePer100MS    *float64   `json:"pacePer100mS,omitempty"`
	StrokeType      string     `json:"strokeType,omitempty"`
	CaloriesKcal    *float64   `json:"caloriesKcal,omitempty"`
	AverageHRBPM    *float64   `json:"averageHrBpm,omitempty"`
	MaxHRBPM        *float64   `json:"maxHrBpm,omitempty"`
	StrokeCount     *int       `json:"strokeCount,omitempty"`
	Swolf           *float64   `json:"swolf,omitempty"`
	IsRest          bool       `json:"isRest"`
}

type SwimLap struct {
	LapIndex    int      `json:"lapIndex"`
	LengthCount int      `json:"lengthCount"`
	DistanceM   *float64 `json:"distanceM,omitempty"`
	DurationS   *float64 `json:"durationS,omitempty"`
	IsRest      bool     `json:"isRest"`
}

type DailyHealth struct {
	Date            string   `json:"date"`
	Steps           *int     `json:"steps,omitempty"`
	CaloriesKcal    *float64 `json:"caloriesKcal,omitempty"`
	DistanceM       *float64 `json:"distanceM,omitempty"`
	RestingHRBPM    *float64 `json:"restingHrBpm,omitempty"`
	MaxHRBPM        *float64 `json:"maxHrBpm,omitempty"`
	SleepSeconds    *int     `json:"sleepSeconds,omitempty"`
	SleepScore      *float64 `json:"sleepScore,omitempty"`
	BodyBatteryHigh *int     `json:"bodyBatteryHigh,omitempty"`
	BodyBatteryLow  *int     `json:"bodyBatteryLow,omitempty"`
	StressAverage   *float64 `json:"stressAverage,omitempty"`
}

type GarminConnection struct {
	ID                   string     `json:"id"`
	Status               string     `json:"status"`
	GarminEmail          string     `json:"garminEmail,omitempty"`
	LastSuccessfulSyncAt *time.Time `json:"lastSuccessfulSyncAt,omitempty"`
	LastSyncStatus       string     `json:"lastSyncStatus,omitempty"`
	LastErrorCode        string     `json:"lastErrorCode,omitempty"`
	ActiveSyncRunID      string     `json:"activeSyncRunId,omitempty"`
}

type SyncRun struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	StartedAt       time.Time  `json:"startedAt"`
	FinishedAt      *time.Time `json:"finishedAt,omitempty"`
	DiscoveredCount int        `json:"discoveredCount"`
	ImportedCount   int        `json:"importedCount"`
	UpdatedCount    int        `json:"updatedCount"`
	FailedCount     int        `json:"failedCount"`
	ErrorSummary    string     `json:"errorSummary,omitempty"`
}

type Repository interface {
	ListActivities(context.Context, string, string, *ActivityCursor, int) ([]Activity, *ActivityCursor, error)
	GetActivity(context.Context, string, string) (Activity, error)
	ListSwimLengths(context.Context, string, string) ([]SwimLength, error)
	ListSwimLaps(context.Context, string, string) ([]SwimLap, error)
	GetDailyHealth(context.Context, string, time.Time) (DailyHealth, error)
	ListDailyHealth(context.Context, string, time.Time, time.Time) ([]DailyHealth, error)
	GetGarminConnection(context.Context, string) (GarminConnection, error)
	GetSyncRun(context.Context, string, string) (SyncRun, error)
}

type ActivityFieldSetting struct {
	Type   string   `json:"type"`
	View   string   `json:"view"`
	Fields []string `json:"fields"`
}

type ActivityFieldSettingsRepository interface {
	GetActivityFieldSettings(context.Context, string) ([]ActivityFieldSetting, error)
	SaveActivityFieldSetting(context.Context, string, ActivityFieldSetting) error
}
