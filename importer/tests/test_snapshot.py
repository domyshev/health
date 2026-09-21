from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from health_hub_garmin.snapshot import ActivitySnapshotImporter, safe_error


class FakeClient:
    def __init__(
        self, *, failures: set[str] | None = None, original: bytes = b"FITDATA"
    ):
        self.failures = failures or set()
        self.original = original
        self.calls: list[str] = []

    def _value(self, name: str):
        self.calls.append(name)
        if name in self.failures:
            raise RuntimeError(f"{name} unavailable")
        return {"resource": name, "activityId": 42}

    def get_activity(self, activity_id: str):
        return self._value("activity")

    def get_activity_details(self, activity_id: str):
        return self._value("details")

    def get_activity_splits(self, activity_id: str):
        return self._value("splits")

    def get_activity_typed_splits(self, activity_id: str):
        return self._value("typed-splits")

    def get_activity_split_summaries(self, activity_id: str):
        return self._value("split-summaries")

    def get_activity_hr_in_timezones(self, activity_id: str):
        return self._value("heart-rate-zones")

    def get_activity_weather(self, activity_id: str):
        return self._value("weather")

    def get_activity_gear(self, activity_id: str):
        return self._value("gear")

    def download_original_activity(self, activity_id: str) -> bytes:
        self.calls.append("original")
        if "original" in self.failures:
            raise RuntimeError("original unavailable")
        return self.original


def load_manifest(root: Path) -> dict:
    return json.loads((root / "42" / "manifest.json").read_text())


def test_safe_error_never_serializes_exception_details():
    error = RuntimeError("token=super-secret-value email=private@example.com")

    assert safe_error(error) == "RuntimeError"


def test_import_writes_json_original_and_manifest(tmp_path: Path):
    client = FakeClient()

    result = ActivitySnapshotImporter(
        client, tmp_path, importer_version="test"
    ).import_activity("42")

    activity_dir = tmp_path / "42"
    assert result.status == "complete"
    assert sorted(path.name for path in activity_dir.iterdir()) == [
        "activity.json",
        "details.json",
        "gear.json",
        "heart-rate-zones.json",
        "manifest.json",
        "original.fit",
        "split-summaries.json",
        "splits.json",
        "typed-splits.json",
        "weather.json",
    ]
    manifest = load_manifest(tmp_path)
    assert manifest["activityId"] == "42"
    assert manifest["status"] == "complete"
    assert manifest["importerVersion"] == "test"
    assert manifest["resources"]["activity"]["status"] == "complete"
    assert (
        manifest["resources"]["original"]["sha256"]
        == hashlib.sha256(b"FITDATA").hexdigest()
    )
    assert manifest["resources"]["original"]["sizeBytes"] == 7
    assert "startedAt" in manifest and "finishedAt" in manifest


def test_original_zip_is_preserved_without_extraction(tmp_path: Path):
    client = FakeClient(original=b"PK\x03\x04archive")

    ActivitySnapshotImporter(client, tmp_path, importer_version="test").import_activity(
        "42"
    )

    assert (tmp_path / "42" / "original.zip").read_bytes() == b"PK\x03\x04archive"
    manifest = load_manifest(tmp_path)
    assert manifest["resources"]["original"]["path"] == "original.zip"
    assert manifest["resources"]["original"]["mediaType"] == "application/zip"


def test_complete_valid_snapshot_is_reused_without_network(tmp_path: Path):
    first = FakeClient()
    importer = ActivitySnapshotImporter(first, tmp_path, importer_version="test")
    initial = importer.import_activity("42")
    manifest_bytes = (tmp_path / "42" / "manifest.json").read_bytes()

    second = FakeClient(
        failures={
            "activity",
            "details",
            "splits",
            "typed-splits",
            "split-summaries",
            "heart-rate-zones",
            "weather",
            "gear",
            "original",
        }
    )
    repeated = ActivitySnapshotImporter(
        second, tmp_path, importer_version="test"
    ).import_activity("42")

    assert repeated.status == initial.status == "complete"
    assert second.calls == []
    assert (tmp_path / "42" / "manifest.json").read_bytes() == manifest_bytes


def test_partial_import_preserves_successes_and_retries_only_failures(tmp_path: Path):
    first = FakeClient(failures={"typed-splits"})
    result = ActivitySnapshotImporter(
        first, tmp_path, importer_version="test"
    ).import_activity("42")
    activity_bytes = (tmp_path / "42" / "activity.json").read_bytes()

    assert result.status == "partial"
    assert load_manifest(tmp_path)["resources"]["typed-splits"]["status"] == "failed"

    second = FakeClient()
    retried = ActivitySnapshotImporter(
        second, tmp_path, importer_version="test"
    ).import_activity("42")

    assert retried.status == "complete"
    assert second.calls == ["typed-splits"]
    assert (tmp_path / "42" / "activity.json").read_bytes() == activity_bytes


def test_missing_optional_endpoint_does_not_make_import_partial(tmp_path: Path):
    class GarminConnectNotFoundError(RuntimeError):
        pass

    class MissingWeatherClient(FakeClient):
        def get_activity_weather(self, activity_id: str):
            self.calls.append("weather")
            raise GarminConnectNotFoundError("not found")

    result = ActivitySnapshotImporter(
        MissingWeatherClient(),
        tmp_path,
        importer_version="test",
    ).import_activity("42")

    assert result.status == "complete"
    assert result.manifest["resources"]["weather"]["status"] == "unavailable"


def test_transient_resource_failure_is_retried(tmp_path: Path):
    class FlakyClient(FakeClient):
        def __init__(self):
            super().__init__()
            self.detail_attempts = 0

        def get_activity_details(self, activity_id: str):
            self.calls.append("details")
            self.detail_attempts += 1
            if self.detail_attempts == 1:
                raise RuntimeError("temporary failure")
            return {"resource": "details", "activityId": 42}

    client = FlakyClient()
    delays = []

    result = ActivitySnapshotImporter(
        client,
        tmp_path,
        importer_version="test",
        retry_attempts=2,
        sleep=delays.append,
    ).import_activity("42")

    assert result.status == "complete"
    assert client.detail_attempts == 2
    assert delays == [1.0]


def test_invalid_activity_id_is_rejected_before_client_call(tmp_path: Path):
    client = FakeClient()

    with pytest.raises(ValueError, match="positive integer"):
        ActivitySnapshotImporter(
            client, tmp_path, importer_version="test"
        ).import_activity("../secret")

    assert client.calls == []
