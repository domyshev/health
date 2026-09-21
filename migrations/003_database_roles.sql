DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_hub_importer') THEN
        CREATE ROLE health_hub_importer NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_hub_api') THEN
        CREATE ROLE health_hub_api NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_hub_migrator') THEN
        CREATE ROLE health_hub_migrator NOLOGIN;
    END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM health_hub_api;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM health_hub_api;
REVOKE ALL ON garmin_raw_resources, garmin_files FROM health_hub_api;

GRANT USAGE ON SCHEMA public TO health_hub_api, health_hub_importer;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, auth_login_codes, auth_login_requests, auth_sessions TO health_hub_api;
GRANT SELECT ON activities, swimming_activities, swim_lengths, daily_health TO health_hub_api;
GRANT SELECT ON api_garmin_connections, garmin_sync_runs TO health_hub_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO health_hub_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    garmin_connections,
    garmin_sync_runs,
    garmin_activity_imports,
    garmin_raw_resources,
    garmin_files,
    activities,
    swimming_activities,
    swim_lengths,
    daily_health
TO health_hub_importer;
GRANT SELECT ON users TO health_hub_importer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO health_hub_importer;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO health_hub_migrator;
