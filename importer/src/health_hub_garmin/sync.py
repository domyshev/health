from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from .snapshot import safe_error


@dataclass(frozen=True)
class ImportState:
    created: bool
    status: str
    primary_payload_sha256: str | None


@dataclass(frozen=True)
class SyncSummary:
    run_id: str
    status: str
    discovered_count: int
    imported_count: int
    updated_count: int
    failed_count: int
    error_summary: str | None = None


class SyncStore(Protocol):
    def sync_lock(self, connection_id: str): ...

    def start_sync_run(self, connection_id: str) -> str: ...

    def register_activity(
        self,
        connection_id: str,
        activity_id: str,
        payload_sha256: str,
        source_updated_at: Any,
    ) -> ImportState: ...

    def mark_fetching(self, connection_id: str, activity_id: str) -> None: ...

    def persist_snapshot(
        self, connection_id: str, user_id: str, result: Any
    ) -> None: ...

    def mark_import_result(
        self,
        connection_id: str,
        activity_id: str,
        status: str,
        error: str | None = None,
    ) -> None: ...

    def finish_sync_run(self, run_id: str, **summary: Any) -> None: ...


def hash_payload(payload: Any) -> str:
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    candidate = value.replace(" ", "T").replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class SyncService:
    def __init__(
        self,
        client: Any,
        store: SyncStore,
        snapshot_importer: Any,
        *,
        now: Callable[[], datetime] | None = None,
        payload_hasher: Callable[[Any], str] = hash_payload,
    ) -> None:
        self.client = client
        self.store = store
        self.snapshot_importer = snapshot_importer
        self.now = now or (lambda: datetime.now(UTC))
        self.payload_hasher = payload_hasher

    def sync(
        self,
        *,
        connection_id: str,
        user_id: str,
        limit: int = 100,
        refresh_days: int = 7,
    ) -> SyncSummary:
        if limit <= 0:
            raise ValueError("limit must be positive")
        if refresh_days < 0:
            raise ValueError("refresh_days must not be negative")

        with self.store.sync_lock(connection_id):
            run_id = self.store.start_sync_run(connection_id)
            discovered = imported = updated = failed = 0
            errors: list[str] = []
            try:
                activities = self.client.get_activities(0, limit)
                for activity in activities:
                    discovered += 1
                    raw_id = (
                        activity.get("activityId")
                        if isinstance(activity, dict)
                        else None
                    )
                    if raw_id is None:
                        failed += 1
                        errors.append("activity list item has no activityId")
                        continue
                    activity_id = str(raw_id)
                    payload_sha = self.payload_hasher(activity)
                    source_updated_at = activity.get(
                        "activityUpdateTimestamp"
                    ) or activity.get("lastUpdated")
                    state = self.store.register_activity(
                        connection_id,
                        activity_id,
                        payload_sha,
                        source_updated_at,
                    )
                    if not self._should_import(
                        activity, state, payload_sha, refresh_days
                    ):
                        continue
                    refresh = not state.created and state.status == "complete"
                    try:
                        self.store.mark_fetching(connection_id, activity_id)
                        result = self.snapshot_importer.import_activity(
                            activity_id, refresh=refresh
                        )
                        self.store.persist_snapshot(connection_id, user_id, result)
                        self.store.mark_import_result(
                            connection_id, activity_id, result.status
                        )
                        if state.created:
                            imported += 1
                        else:
                            updated += 1
                        if result.status != "complete":
                            failed += 1
                            errors.append(f"activity {activity_id}: {result.status}")
                    except Exception as exc:
                        failed += 1
                        message = safe_error(exc)
                        errors.append(f"activity {activity_id}: {message}")
                        self.store.mark_import_result(
                            connection_id, activity_id, "failed", message
                        )
            except Exception as exc:
                failed += 1
                errors.append(safe_error(exc))

            attempted = imported + updated
            if failed == 0:
                status = "complete"
            elif attempted == 0 or failed >= max(attempted, 1):
                status = "failed"
            else:
                status = "partial"
            if attempted > 0 and failed > 0 and (imported + updated) >= failed:
                status = "partial"
            error_summary = "; ".join(errors)[:2000] or None
            summary = SyncSummary(
                run_id=run_id,
                status=status,
                discovered_count=discovered,
                imported_count=imported,
                updated_count=updated,
                failed_count=failed,
                error_summary=error_summary,
            )
            self.store.finish_sync_run(
                run_id,
                status=status,
                discovered_count=discovered,
                imported_count=imported,
                updated_count=updated,
                failed_count=failed,
                error_summary=error_summary,
            )
            return summary

    def _should_import(
        self,
        activity: dict[str, Any],
        state: ImportState,
        payload_sha: str,
        refresh_days: int,
    ) -> bool:
        if state.created or state.status in {
            "discovered",
            "fetching",
            "partial",
            "failed",
        }:
            return True
        if state.primary_payload_sha256 != payload_sha:
            return True
        started = _parse_datetime(
            activity.get("startTimeGMT") or activity.get("startTimeLocal")
        )
        if started is None:
            return False
        return started >= self.now().astimezone(UTC) - timedelta(days=refresh_days)
