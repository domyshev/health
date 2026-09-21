CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE auth_login_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL,
    code_hash BYTEA NOT NULL,
    request_ip INET NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_login_codes_active_email_idx
    ON auth_login_codes (email, created_at DESC)
    WHERE consumed_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX auth_login_codes_email_rate_idx
    ON auth_login_codes (email, created_at DESC);
CREATE INDEX auth_login_codes_ip_rate_idx
    ON auth_login_codes (request_ip, created_at DESC);
CREATE INDEX auth_login_codes_cleanup_idx
    ON auth_login_codes (expires_at);

CREATE TABLE auth_login_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_hash BYTEA NOT NULL,
    request_ip INET NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_login_requests_email_rate_idx
    ON auth_login_requests (email_hash, created_at DESC);
CREATE INDEX auth_login_requests_ip_rate_idx
    ON auth_login_requests (request_ip, created_at DESC);
CREATE INDEX auth_login_requests_cleanup_idx
    ON auth_login_requests (created_at);

CREATE TABLE auth_sessions (
    token_hash BYTEA PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    user_agent_hash BYTEA,
    created_ip INET
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, created_at DESC);
CREATE INDEX auth_sessions_cleanup_idx ON auth_sessions (expires_at);

CREATE TABLE daily_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source TEXT NOT NULL,
    health_date DATE NOT NULL,
    steps INTEGER,
    calories_kcal DOUBLE PRECISION,
    distance_m DOUBLE PRECISION,
    resting_hr_bpm DOUBLE PRECISION,
    max_hr_bpm DOUBLE PRECISION,
    sleep_seconds INTEGER,
    sleep_score DOUBLE PRECISION,
    body_battery_high INTEGER,
    body_battery_low INTEGER,
    stress_average DOUBLE PRECISION,
    source_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, source, health_date)
);

CREATE INDEX daily_health_user_date_idx ON daily_health (user_id, health_date DESC);

ALTER TABLE garmin_connections ADD COLUMN IF NOT EXISTS garmin_email CITEXT;
ALTER TABLE garmin_connections ADD COLUMN IF NOT EXISTS last_error_code TEXT;

CREATE VIEW api_garmin_connections AS
SELECT
    id,
    user_id,
    status,
    garmin_email,
    last_successful_sync_at,
    last_error_at,
    last_error_code,
    created_at,
    updated_at
FROM garmin_connections;
