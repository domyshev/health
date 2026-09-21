from pathlib import Path


def test_initial_migration_contains_plan_001_tables():
    migration = (
        Path(__file__).resolve().parents[2] / "migrations" / "001_garmin_import.sql"
    ).read_text()

    for table in (
        "garmin_connections",
        "garmin_sync_runs",
        "garmin_activity_imports",
        "garmin_raw_resources",
        "garmin_files",
        "activities",
        "swimming_activities",
        "swim_lengths",
    ):
        assert f"CREATE TABLE {table}" in migration

    assert "UNIQUE (connection_id, activity_external_id)" in migration
    assert "UNIQUE (connection_id, resource_type, external_id)" in migration
    assert "UNIQUE (user_id, source, external_id)" in migration
    assert "payload_json JSONB" in migration
    assert (
        "CHECK (status IN ('discovered', 'fetching', 'complete', 'partial', 'failed'))"
        in migration
    )
