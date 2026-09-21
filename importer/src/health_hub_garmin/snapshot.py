from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any, Protocol


class GarminReadClient(Protocol):
    def get_activity(self, activity_id: str) -> dict[str, Any]: ...

    def get_activity_details(self, activity_id: str) -> dict[str, Any]: ...

    def get_activity_splits(self, activity_id: str) -> dict[str, Any]: ...

    def get_activity_typed_splits(self, activity_id: str) -> dict[str, Any]: ...

    def get_activity_split_summaries(self, activity_id: str) -> dict[str, Any]: ...

    def get_activity_hr_in_timezones(self, activity_id: str) -> dict[str, Any]: ...

    def get_activity_weather(self, activity_id: str) -> dict[str, Any]: ...

    def get_activity_gear(self, activity_id: str) -> dict[str, Any]: ...

    def download_original_activity(self, activity_id: str) -> bytes: ...


@dataclass(frozen=True)
class SnapshotResult:
    activity_id: str
    directory: Path
    status: str
    manifest: dict[str, Any]
    reused: bool = False


@dataclass(frozen=True)
class ResourceSpec:
    name: str
    json_filename: str | None
    fetch: Callable[[GarminReadClient, str], Any]
    required: bool = False


RESOURCE_SPECS = (
    ResourceSpec(
        "activity",
        "activity.json",
        lambda client, activity_id: client.get_activity(activity_id),
        required=True,
    ),
    ResourceSpec(
        "details",
        "details.json",
        lambda client, activity_id: client.get_activity_details(activity_id),
        required=True,
    ),
    ResourceSpec(
        "splits",
        "splits.json",
        lambda client, activity_id: client.get_activity_splits(activity_id),
        required=True,
    ),
    ResourceSpec(
        "typed-splits",
        "typed-splits.json",
        lambda client, activity_id: client.get_activity_typed_splits(activity_id),
    ),
    ResourceSpec(
        "split-summaries",
        "split-summaries.json",
        lambda client, activity_id: client.get_activity_split_summaries(activity_id),
    ),
    ResourceSpec(
        "heart-rate-zones",
        "heart-rate-zones.json",
        lambda client, activity_id: client.get_activity_hr_in_timezones(activity_id),
    ),
    ResourceSpec(
        "weather",
        "weather.json",
        lambda client, activity_id: client.get_activity_weather(activity_id),
    ),
    ResourceSpec(
        "gear",
        "gear.json",
        lambda client, activity_id: client.get_activity_gear(activity_id),
    ),
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def json_bytes(payload: Any) -> bytes:
    return (
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def safe_error(exc: Exception) -> str:
    return type(exc).__name__


def validate_activity_id(value: str | int) -> str:
    text = str(value)
    if not text.isascii() or not text.isdigit() or int(text) <= 0:
        raise ValueError("activity_id must be a positive integer")
    return str(int(text))


class ActivitySnapshotImporter:
    def __init__(
        self,
        client: GarminReadClient,
        output_root: Path,
        *,
        importer_version: str,
        retry_attempts: int = 3,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if retry_attempts <= 0:
            raise ValueError("retry_attempts must be positive")
        self.client = client
        self.output_root = Path(output_root)
        self.importer_version = importer_version
        self.retry_attempts = retry_attempts
        self.sleep = sleep

    def import_activity(
        self, activity_id: str | int, *, refresh: bool = False
    ) -> SnapshotResult:
        canonical_id = validate_activity_id(activity_id)
        activity_dir = self.output_root / canonical_id
        activity_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = activity_dir / "manifest.json"
        previous = self._load_manifest(manifest_path, canonical_id)

        if (
            not refresh
            and previous
            and previous.get("status") == "complete"
            and self._manifest_files_valid(activity_dir, previous)
        ):
            return SnapshotResult(
                canonical_id, activity_dir, "complete", previous, reused=True
            )

        started_at = utc_now()
        resources: dict[str, dict[str, Any]] = {}
        raw_previous_resources = (previous or {}).get("resources")
        previous_resources = (
            raw_previous_resources if isinstance(raw_previous_resources, dict) else {}
        )

        for spec in RESOURCE_SPECS:
            old = previous_resources.get(spec.name)
            if not refresh and self._resource_file_valid(activity_dir, old):
                assert isinstance(old, dict)
                resources[spec.name] = old
                continue
            try:
                payload = self._fetch_with_retry(
                    partial(spec.fetch, self.client, canonical_id)
                )
                content = json_bytes(payload)
                path = activity_dir / str(spec.json_filename)
                atomic_write(path, content)
                resources[spec.name] = self._complete_resource(
                    path.name, content, "application/json"
                )
            except Exception as exc:
                if not spec.required and self._is_unavailable(exc):
                    resources[spec.name] = self._unavailable_resource(exc)
                else:
                    resources[spec.name] = self._failed_resource(exc)

        old_original = previous_resources.get("original")
        if not refresh and self._resource_file_valid(activity_dir, old_original):
            assert isinstance(old_original, dict)
            resources["original"] = old_original
        else:
            try:
                content = self._fetch_with_retry(
                    lambda: self.client.download_original_activity(canonical_id)
                )
                if not isinstance(content, bytes) or not content:
                    raise ValueError("Garmin returned an empty original activity file")
                filename, media_type = self._original_format(content)
                self._remove_stale_original(activity_dir, filename)
                path = activity_dir / filename
                atomic_write(path, content)
                resources["original"] = self._complete_resource(
                    filename, content, media_type
                )
            except Exception as exc:
                resources["original"] = self._failed_resource(exc)

        completed = sum(item["status"] == "complete" for item in resources.values())
        failed = sum(item["status"] == "failed" for item in resources.values())
        status = "complete" if failed == 0 else ("partial" if completed else "failed")
        manifest = {
            "schemaVersion": 1,
            "activityId": canonical_id,
            "startedAt": started_at,
            "finishedAt": utc_now(),
            "status": status,
            "importerVersion": self.importer_version,
            "resources": resources,
        }
        atomic_write(manifest_path, json_bytes(manifest))
        return SnapshotResult(canonical_id, activity_dir, status, manifest)

    def _fetch_with_retry(self, operation: Callable[[], Any]) -> Any:
        for attempt in range(1, self.retry_attempts + 1):
            try:
                return operation()
            except Exception as exc:
                if self._is_unavailable(exc) or attempt >= self.retry_attempts:
                    raise
                self.sleep(float(2 ** (attempt - 1)))
        raise AssertionError("unreachable")

    @staticmethod
    def _complete_resource(
        filename: str, content: bytes, media_type: str
    ) -> dict[str, Any]:
        return {
            "status": "complete",
            "path": filename,
            "mediaType": media_type,
            "sha256": sha256_bytes(content),
            "sizeBytes": len(content),
        }

    @staticmethod
    def _failed_resource(exc: Exception) -> dict[str, Any]:
        return {"status": "failed", "error": safe_error(exc)}

    @staticmethod
    def _unavailable_resource(exc: Exception) -> dict[str, Any]:
        return {"status": "unavailable", "error": safe_error(exc)}

    @staticmethod
    def _is_unavailable(exc: Exception) -> bool:
        return type(exc).__name__ == "GarminConnectNotFoundError"

    @staticmethod
    def _original_format(content: bytes) -> tuple[str, str]:
        if content.startswith(b"PK\x03\x04"):
            return "original.zip", "application/zip"
        if content.startswith(b"\x1f\x8b"):
            return "original.fit.gz", "application/gzip"
        return "original.fit", "application/vnd.ant.fit"

    @staticmethod
    def _remove_stale_original(activity_dir: Path, keep: str) -> None:
        for filename in ("original.fit", "original.zip", "original.fit.gz"):
            if filename != keep:
                (activity_dir / filename).unlink(missing_ok=True)

    def _load_manifest(self, path: Path, activity_id: str) -> dict[str, Any] | None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None
        if payload.get("activityId") != activity_id or not isinstance(
            payload.get("resources"), dict
        ):
            return None
        return payload

    def _manifest_files_valid(
        self, activity_dir: Path, manifest: dict[str, Any]
    ) -> bool:
        resources = manifest.get("resources") or {}
        return bool(resources) and all(
            item.get("status") != "complete"
            or self._resource_file_valid(activity_dir, item)
            for item in resources.values()
        )

    @staticmethod
    def _resource_file_valid(activity_dir: Path, resource: Any) -> bool:
        if not isinstance(resource, dict) or resource.get("status") != "complete":
            return False
        filename = resource.get("path")
        if not isinstance(filename, str) or Path(filename).name != filename:
            return False
        path = activity_dir / filename
        try:
            content = path.read_bytes()
        except OSError:
            return False
        return len(content) == resource.get("sizeBytes") and sha256_bytes(
            content
        ) == resource.get("sha256")
