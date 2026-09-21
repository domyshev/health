from __future__ import annotations

from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

from health_hub_garmin.sync import ImportState, SyncService


class FakeClient:
    def get_activities(self, start: int, limit: int):
        return [
            {
                "activityId": 42,
                "activityName": "Swim",
                "activityType": {"typeKey": "lap_swimming"},
                "startTimeGMT": "2026-09-20 15:00:00",
            }
        ]


class FakeSnapshotImporter:
    def __init__(self, status: str = "complete"):
        self.status = status
        self.calls = []

    def import_activity(self, activity_id: str, *, refresh: bool = False):
        self.calls.append((activity_id, refresh))
        return type(
            "Result",
            (),
            {
                "activity_id": activity_id,
                "directory": Path("/data") / activity_id,
                "status": self.status,
                "manifest": {"status": self.status},
            },
        )()


class FakeStore:
    def __init__(self, state: ImportState):
        self.state = state
        self.events = []

    def sync_lock(self, connection_id: str):
        return nullcontext()

    def start_sync_run(self, connection_id: str) -> str:
        self.events.append(("start", connection_id))
        return "run-1"

    def register_activity(
        self,
        connection_id: str,
        activity_id: str,
        payload_sha256: str,
        source_updated_at,
    ):
        self.events.append(("discover", activity_id))
        return self.state

    def mark_fetching(self, connection_id: str, activity_id: str):
        self.events.append(("fetching", activity_id))

    def persist_snapshot(self, connection_id: str, user_id: str, result):
        self.events.append(("persist", result.activity_id, result.status))

    def mark_import_result(
        self,
        connection_id: str,
        activity_id: str,
        status: str,
        error: str | None = None,
    ):
        self.events.append(("result", activity_id, status, error))

    def finish_sync_run(self, run_id: str, **summary):
        self.events.append(("finish", run_id, summary))


def test_new_activity_is_imported_and_persisted():
    store = FakeStore(
        ImportState(created=True, status="discovered", primary_payload_sha256=None)
    )
    snapshots = FakeSnapshotImporter()
    service = SyncService(
        FakeClient(),
        store,
        snapshots,
        now=lambda: datetime(2026, 9, 21, tzinfo=UTC),
    )

    summary = service.sync(connection_id="connection-1", user_id="user-1", limit=10)

    assert summary.status == "complete"
    assert summary.discovered_count == 1
    assert summary.imported_count == 1
    assert summary.updated_count == 0
    assert summary.failed_count == 0
    assert snapshots.calls == [("42", False)]
    assert ("persist", "42", "complete") in store.events


def test_old_unchanged_complete_activity_is_skipped():
    class OldClient(FakeClient):
        def get_activities(self, start: int, limit: int):
            rows = super().get_activities(start, limit)
            rows[0]["startTimeGMT"] = "2026-08-01 15:00:00"
            return rows

    store = FakeStore(
        ImportState(created=False, status="complete", primary_payload_sha256="MATCH")
    )
    snapshots = FakeSnapshotImporter()
    service = SyncService(
        OldClient(),
        store,
        snapshots,
        now=lambda: datetime(2026, 9, 21, tzinfo=UTC),
        payload_hasher=lambda payload: "MATCH",
    )

    summary = service.sync(connection_id="connection-1", user_id="user-1")

    assert summary.status == "complete"
    assert summary.imported_count == 0
    assert summary.updated_count == 0
    assert snapshots.calls == []


def test_recent_complete_activity_is_refreshed():
    store = FakeStore(
        ImportState(created=False, status="complete", primary_payload_sha256="MATCH")
    )
    snapshots = FakeSnapshotImporter()
    service = SyncService(
        FakeClient(),
        store,
        snapshots,
        now=lambda: datetime(2026, 9, 21, tzinfo=UTC),
        payload_hasher=lambda payload: "MATCH",
    )

    summary = service.sync(
        connection_id="connection-1", user_id="user-1", refresh_days=7
    )

    assert summary.updated_count == 1
    assert snapshots.calls == [("42", True)]


def test_partial_snapshot_makes_sync_partial_without_losing_it():
    store = FakeStore(
        ImportState(created=True, status="discovered", primary_payload_sha256=None)
    )
    snapshots = FakeSnapshotImporter(status="partial")
    service = SyncService(FakeClient(), store, snapshots)

    summary = service.sync(connection_id="connection-1", user_id="user-1")

    assert summary.status == "partial"
    assert summary.failed_count == 1
    assert ("persist", "42", "partial") in store.events
