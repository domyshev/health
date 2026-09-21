from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import ClassVar

import pytest

from health_hub_garmin.postgres import PostgresStore, SyncAlreadyRunningError
from health_hub_garmin.snapshot import ActivitySnapshotImporter
from health_hub_garmin.sync import SyncService, hash_payload

DATABASE_URL = os.environ.get("HEALTH_HUB_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="HEALTH_HUB_TEST_DATABASE_URL is not set"
)


def test_private_control_connection_and_sync_reservation(tmp_path: Path):
    assert DATABASE_URL is not None
    store = PostgresStore(DATABASE_URL)
    migrations = Path(__file__).resolve().parents[3] / "migrations"
    store.migrate(migrations / "001_garmin_import.sql")
    store.migrate(migrations / "002_go_api_auth.sql")
    user_id = str(uuid.uuid4())
    connection_id = store.ensure_connection(
        user_id,
        str(tmp_path / "tokens"),
        "garmin@example.com",
    )

    run_id = store.reserve_sync_run(user_id, connection_id)

    assert uuid.UUID(run_id)
    assert scalar(
        DATABASE_URL,
        "SELECT garmin_email::text FROM garmin_connections WHERE id = %s",
        (connection_id,),
    ) == "garmin@example.com"
    with pytest.raises(SyncAlreadyRunningError):
        store.reserve_sync_run(user_id, connection_id)
    with pytest.raises(ValueError):
        store.reserve_sync_run(str(uuid.uuid4()), connection_id)


class SwimClient:
    activity: ClassVar[dict] = {
        "activityId": 42,
        "activityName": "Integration Swim",
        "activityType": {"typeKey": "lap_swimming"},
        "startTimeGMT": "2026-09-20 15:00:00",
        "distance": 25.0,
        "duration": 30.0,
    }

    def get_activity(self, activity_id: str):
        return self.activity

    def get_activities(self, start: int, limit: int):
        return [self.activity]

    def get_activity_details(self, activity_id: str):
        return {
            "summaryDTO": {
                "distance": 25.0,
                "duration": 30.0,
                "averageSpeed": 0.833333,
                "poolLength": 25.0,
                "numberOfActiveLengths": 1,
            },
            "metadataDTO": {"lapCount": 1},
        }

    def get_activity_splits(self, activity_id: str):
        return {
            "lapDTOs": [
                {
                    "lengthDTOs": [
                        {
                            "distance": 25.0,
                            "duration": 30.0,
                            "averageSpeed": 0.833333,
                            "swimStroke": "FREESTYLE",
                        }
                    ]
                }
            ]
        }

    def get_activity_typed_splits(self, activity_id: str):
        return {}

    def get_activity_split_summaries(self, activity_id: str):
        return {}

    def get_activity_hr_in_timezones(self, activity_id: str):
        return {}

    def get_activity_weather(self, activity_id: str):
        return {}

    def get_activity_gear(self, activity_id: str):
        return []

    def download_original_activity(self, activity_id: str):
        return b"FITDATA"


def scalar(dsn: str, query: str, parameters=()):
    import psycopg

    with psycopg.connect(dsn) as connection:
        return connection.execute(query, parameters).fetchone()[0]


def test_snapshot_persistence_is_idempotent_and_rebuilds_offline(tmp_path: Path):
    assert DATABASE_URL is not None
    store = PostgresStore(DATABASE_URL)
    migration = (
        Path(__file__).resolve().parents[3] / "migrations" / "001_garmin_import.sql"
    )
    store.migrate(migration)
    user_id = str(uuid.uuid4())
    connection_id = store.ensure_connection(user_id, str(tmp_path / "tokens"))
    client = SwimClient()
    result = ActivitySnapshotImporter(
        client, tmp_path / "activities", importer_version="test"
    ).import_activity("42")

    state = store.register_activity(
        connection_id, "42", hash_payload(client.activity), None
    )
    assert state.created is True
    store.mark_fetching(connection_id, "42")
    store.persist_snapshot(connection_id, user_id, result)
    store.persist_snapshot(connection_id, user_id, result)
    store.mark_import_result(connection_id, "42", "complete")

    assert (
        scalar(
            DATABASE_URL,
            "SELECT count(*) FROM activities WHERE user_id = %s",
            (user_id,),
        )
        == 1
    )
    assert (
        scalar(
            DATABASE_URL,
            "SELECT count(*) FROM garmin_raw_resources WHERE connection_id = %s",
            (connection_id,),
        )
        == 8
    )
    assert (
        scalar(
            DATABASE_URL,
            "SELECT count(*) FROM garmin_files WHERE connection_id = %s",
            (connection_id,),
        )
        == 1
    )
    assert (
        scalar(
            DATABASE_URL,
            "SELECT count(*) FROM swim_lengths AS length JOIN activities AS activity ON activity.id = length.activity_id WHERE activity.user_id = %s",
            (user_id,),
        )
        == 1
    )

    import psycopg

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("DELETE FROM activities WHERE user_id = %s", (user_id,))
    assert store.rebuild_normalized(connection_id, user_id) == 1
    assert (
        scalar(
            DATABASE_URL,
            "SELECT count(*) FROM activities WHERE user_id = %s",
            (user_id,),
        )
        == 1
    )


def test_connection_lock_rejects_parallel_syncs():
    assert DATABASE_URL is not None
    connection_id = str(uuid.uuid4())

    with (
        PostgresStore(DATABASE_URL).sync_lock(connection_id),
        pytest.raises(SyncAlreadyRunningError),
        PostgresStore(DATABASE_URL).sync_lock(connection_id),
    ):
        pass


def test_incremental_sync_is_idempotent_with_postgres(tmp_path: Path):
    assert DATABASE_URL is not None
    store = PostgresStore(DATABASE_URL)
    migration = (
        Path(__file__).resolve().parents[3] / "migrations" / "001_garmin_import.sql"
    )
    store.migrate(migration)
    user_id = str(uuid.uuid4())
    connection_id = store.ensure_connection(user_id, str(tmp_path / "tokens"))
    client = SwimClient()
    snapshots = ActivitySnapshotImporter(
        client, tmp_path / "activities", importer_version="test"
    )
    service = SyncService(
        client,
        store,
        snapshots,
        now=lambda: datetime(2026, 9, 21, tzinfo=UTC),
    )

    first = service.sync(connection_id=connection_id, user_id=user_id)
    second = service.sync(connection_id=connection_id, user_id=user_id)

    assert first.status == "complete"
    assert first.imported_count == 1
    assert second.status == "complete"
    assert second.updated_count == 1
    assert (
        scalar(
            DATABASE_URL,
            "SELECT count(*) FROM activities WHERE user_id = %s",
            (user_id,),
        )
        == 1
    )
    assert (
        scalar(
            DATABASE_URL,
            "SELECT count(*) FROM garmin_sync_runs WHERE connection_id = %s",
            (connection_id,),
        )
        == 2
    )
