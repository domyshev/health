CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE garmin_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reauth_required', 'disabled')),
    token_storage_key TEXT NOT NULL,
    last_successful_sync_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

CREATE TABLE garmin_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES garmin_connections(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
    discovered_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT
);

CREATE INDEX garmin_sync_runs_connection_started_idx
    ON garmin_sync_runs (connection_id, started_at DESC);

CREATE UNIQUE INDEX garmin_sync_runs_one_active_idx
    ON garmin_sync_runs (connection_id)
    WHERE status = 'running';

CREATE TABLE garmin_activity_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES garmin_connections(id) ON DELETE CASCADE,
    activity_external_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('discovered', 'fetching', 'complete', 'partial', 'failed')),
    primary_payload_sha256 TEXT,
    source_updated_at TIMESTAMPTZ,
    first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    UNIQUE (connection_id, activity_external_id)
);

CREATE TABLE garmin_raw_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES garmin_connections(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ,
    payload_json JSONB,
    payload_sha256 TEXT,
    http_status INTEGER,
    fetch_status TEXT NOT NULL CHECK (fetch_status IN ('complete', 'unavailable', 'failed')),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message TEXT,
    UNIQUE (connection_id, resource_type, external_id)
);

CREATE TABLE garmin_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES garmin_connections(id) ON DELETE CASCADE,
    activity_external_id TEXT NOT NULL,
    file_type TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    media_type TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (connection_id, activity_external_id, file_type)
);

CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    activity_type TEXT,
    name TEXT,
    started_at TIMESTAMPTZ,
    timezone TEXT,
    distance_m DOUBLE PRECISION,
    duration_s DOUBLE PRECISION,
    moving_duration_s DOUBLE PRECISION,
    elapsed_duration_s DOUBLE PRECISION,
    calories_kcal DOUBLE PRECISION,
    average_hr_bpm DOUBLE PRECISION,
    max_hr_bpm DOUBLE PRECISION,
    source_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, source, external_id)
);

CREATE INDEX activities_user_started_idx ON activities (user_id, started_at DESC, id DESC);

CREATE TABLE swimming_activities (
    activity_id UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    environment TEXT NOT NULL CHECK (environment IN ('pool', 'open_water')),
    pool_length_m DOUBLE PRECISION,
    active_lengths INTEGER,
    lap_count INTEGER,
    average_pace_per_100m_s DOUBLE PRECISION,
    total_strokes INTEGER,
    average_strokes_per_length DOUBLE PRECISION,
    average_stroke_cadence_per_minute DOUBLE PRECISION,
    average_swolf DOUBLE PRECISION
);

CREATE TABLE swim_lengths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    lap_index INTEGER NOT NULL,
    length_index INTEGER NOT NULL,
    started_at TIMESTAMPTZ,
    distance_m DOUBLE PRECISION,
    duration_s DOUBLE PRECISION,
    average_speed_mps DOUBLE PRECISION,
    pace_per_100m_s DOUBLE PRECISION,
    stroke_type TEXT,
    calories_kcal DOUBLE PRECISION,
    average_hr_bpm DOUBLE PRECISION,
    max_hr_bpm DOUBLE PRECISION,
    stroke_count INTEGER,
    swolf DOUBLE PRECISION,
    is_rest BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (activity_id, lap_index, length_index)
);
