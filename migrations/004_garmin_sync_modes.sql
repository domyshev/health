ALTER TABLE garmin_sync_runs
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'recent'
    CHECK (mode IN ('recent', 'full_history'));
