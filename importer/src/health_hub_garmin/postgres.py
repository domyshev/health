from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .normalization import normalize_activity, normalize_swimming
from .sync import ImportState


class SyncAlreadyRunningError(RuntimeError):
    pass


class PostgresStore:
    def __init__(
        self, dsn: str, *, connect_factory: Callable[..., Any] | None = None
    ) -> None:
        self.dsn = dsn
        self._connect_factory = connect_factory

    def _connect(self, *, autocommit: bool = False):
        if self._connect_factory is not None:
            return self._connect_factory(self.dsn, autocommit=autocommit)
        import psycopg
        from psycopg.rows import dict_row

        return psycopg.connect(self.dsn, autocommit=autocommit, row_factory=dict_row)

    def migrate(self, migration_path: Path) -> None:
        migration_path = Path(migration_path)
        sql = migration_path.read_text(encoding="utf-8")
        migration_name = migration_path.name
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            applied = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE name = %s",
                (migration_name,),
            ).fetchone()
            if applied is not None:
                return
            connection.execute(sql)
            connection.execute(
                "INSERT INTO schema_migrations (name) VALUES (%s)",
                (migration_name,),
            )

    def ensure_connection(
        self,
        user_id: str,
        token_storage_key: str,
        garmin_email: str | None = None,
    ) -> str:
        with self._connect() as connection:
            if garmin_email is None:
                row = connection.execute(
                    """
                    INSERT INTO garmin_connections (user_id, token_storage_key)
                    VALUES (%s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        token_storage_key = EXCLUDED.token_storage_key,
                        status = 'active',
                        updated_at = now()
                    RETURNING id
                    """,
                    (user_id, token_storage_key),
                ).fetchone()
            else:
                row = connection.execute(
                    """
                    INSERT INTO garmin_connections (user_id, token_storage_key, garmin_email)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        token_storage_key = EXCLUDED.token_storage_key,
                        garmin_email = EXCLUDED.garmin_email,
                        status = 'active',
                        last_error_code = NULL,
                        updated_at = now()
                    RETURNING id
                    """,
                    (user_id, token_storage_key, garmin_email),
                ).fetchone()
        return str(row["id"] if isinstance(row, dict) else row[0])

    def reserve_sync_run(self, user_id: str, connection_id: str) -> str:
        with self._connect() as connection:
            try:
                row = connection.execute(
                    """
                    INSERT INTO garmin_sync_runs (connection_id, status)
                    SELECT id, 'running'
                    FROM garmin_connections
                    WHERE id = %s AND user_id = %s
                    RETURNING id
                    """,
                    (connection_id, user_id),
                ).fetchone()
            except Exception as exc:
                if getattr(exc, "sqlstate", None) == "23505":
                    raise SyncAlreadyRunningError(
                        f"sync already running for connection {connection_id}"
                    ) from exc
                raise
        if row is None:
            raise ValueError("Garmin connection not found")
        return str(row["id"] if isinstance(row, dict) else row[0])

    @contextmanager
    def sync_lock(self, connection_id: str) -> Iterator[None]:
        connection = self._connect(autocommit=True)
        try:
            row = connection.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS acquired",
                (connection_id,),
            ).fetchone()
            acquired = row["acquired"] if isinstance(row, dict) else row[0]
            if not acquired:
                raise SyncAlreadyRunningError(
                    f"sync already running for connection {connection_id}"
                )
            yield
        finally:
            try:
                connection.execute(
                    "SELECT pg_advisory_unlock(hashtextextended(%s, 0))",
                    (connection_id,),
                )
            finally:
                connection.close()

    def start_sync_run(self, connection_id: str) -> str:
        with self._connect() as connection:
            row = connection.execute(
                """
                INSERT INTO garmin_sync_runs (connection_id, status)
                VALUES (%s, 'running')
                RETURNING id
                """,
                (connection_id,),
            ).fetchone()
        return str(row["id"] if isinstance(row, dict) else row[0])

    def register_activity(
        self,
        connection_id: str,
        activity_id: str,
        payload_sha256: str,
        source_updated_at: Any,
    ) -> ImportState:
        with self._connect() as connection:
            existing = connection.execute(
                """
                SELECT status, primary_payload_sha256
                FROM garmin_activity_imports
                WHERE connection_id = %s AND activity_external_id = %s
                FOR UPDATE
                """,
                (connection_id, activity_id),
            ).fetchone()
            if existing is None:
                connection.execute(
                    """
                    INSERT INTO garmin_activity_imports (
                        connection_id, activity_external_id, status,
                        primary_payload_sha256, source_updated_at
                    ) VALUES (%s, %s, 'discovered', %s, %s)
                    """,
                    (connection_id, activity_id, payload_sha256, source_updated_at),
                )
                return ImportState(True, "discovered", None)
            status = existing["status"] if isinstance(existing, dict) else existing[0]
            previous_sha = (
                existing["primary_payload_sha256"]
                if isinstance(existing, dict)
                else existing[1]
            )
            connection.execute(
                """
                UPDATE garmin_activity_imports
                SET primary_payload_sha256 = %s,
                    source_updated_at = COALESCE(%s, source_updated_at)
                WHERE connection_id = %s AND activity_external_id = %s
                """,
                (payload_sha256, source_updated_at, connection_id, activity_id),
            )
            return ImportState(False, str(status), previous_sha)

    def mark_fetching(self, connection_id: str, activity_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE garmin_activity_imports
                SET status = 'fetching', last_attempt_at = now(),
                    attempt_count = attempt_count + 1, last_error = NULL
                WHERE connection_id = %s AND activity_external_id = %s
                """,
                (connection_id, activity_id),
            )

    def persist_snapshot(self, connection_id: str, user_id: str, result: Any) -> None:
        resources = result.manifest.get("resources") or {}
        payloads: dict[str, dict[str, Any]] = {}
        with self._connect() as connection:
            for resource_type in (
                "activity",
                "details",
                "splits",
                "typed-splits",
                "split-summaries",
                "heart-rate-zones",
                "weather",
                "gear",
            ):
                metadata = resources.get(resource_type) or {}
                resource_status = metadata.get("status")
                payload = None
                payload_sha256 = None
                if resource_status == "complete":
                    path = result.directory / metadata["path"]
                    payload = json.loads(path.read_text(encoding="utf-8"))
                    payloads[resource_type] = payload
                    payload_sha256 = metadata["sha256"]
                elif resource_status not in {"failed", "unavailable"}:
                    continue
                connection.execute(
                    """
                    INSERT INTO garmin_raw_resources (
                        connection_id, resource_type, external_id, payload_json,
                        payload_sha256, fetch_status, fetched_at, error_message
                    ) VALUES (%s, %s, %s, %s, %s, %s, now(), %s)
                    ON CONFLICT (connection_id, resource_type, external_id) DO UPDATE SET
                        payload_json = COALESCE(EXCLUDED.payload_json, garmin_raw_resources.payload_json),
                        payload_sha256 = COALESCE(EXCLUDED.payload_sha256, garmin_raw_resources.payload_sha256),
                        fetch_status = EXCLUDED.fetch_status,
                        fetched_at = EXCLUDED.fetched_at,
                        error_message = EXCLUDED.error_message
                    """,
                    (
                        connection_id,
                        resource_type,
                        result.activity_id,
                        json.dumps(payload, ensure_ascii=False)
                        if payload is not None
                        else None,
                        payload_sha256,
                        resource_status,
                        metadata.get("error"),
                    ),
                )

            original = resources.get("original") or {}
            if original.get("status") == "complete":
                connection.execute(
                    """
                    INSERT INTO garmin_files (
                        connection_id, activity_external_id, file_type, storage_key,
                        sha256, size_bytes, media_type, fetched_at
                    ) VALUES (%s, %s, 'original', %s, %s, %s, %s, now())
                    ON CONFLICT (connection_id, activity_external_id, file_type) DO UPDATE SET
                        storage_key = EXCLUDED.storage_key,
                        sha256 = EXCLUDED.sha256,
                        size_bytes = EXCLUDED.size_bytes,
                        media_type = EXCLUDED.media_type,
                        fetched_at = EXCLUDED.fetched_at
                    """,
                    (
                        connection_id,
                        result.activity_id,
                        str((result.directory / original["path"]).resolve()),
                        original["sha256"],
                        original["sizeBytes"],
                        original["mediaType"],
                    ),
                )

            if all(name in payloads for name in ("activity", "details", "splits")):
                self._upsert_normalized(
                    connection,
                    user_id,
                    payloads["activity"],
                    payloads["details"],
                    payloads["splits"],
                )

    def _upsert_normalized(
        self,
        connection: Any,
        user_id: str,
        activity_payload: dict[str, Any],
        details_payload: dict[str, Any],
        splits_payload: dict[str, Any],
    ) -> None:
        activity = normalize_activity(activity_payload, details_payload)
        row = connection.execute(
            """
            INSERT INTO activities (
                user_id, source, external_id, activity_type, name, started_at,
                timezone, distance_m, duration_s, moving_duration_s,
                elapsed_duration_s, calories_kcal, average_hr_bpm, max_hr_bpm,
                source_updated_at
            ) VALUES (
                %(user_id)s, 'garmin', %(external_id)s, %(activity_type)s, %(name)s,
                %(started_at)s, %(timezone)s, %(distance_m)s, %(duration_s)s,
                %(moving_duration_s)s, %(elapsed_duration_s)s, %(calories_kcal)s,
                %(average_hr_bpm)s, %(max_hr_bpm)s, %(source_updated_at)s
            )
            ON CONFLICT (user_id, source, external_id) DO UPDATE SET
                activity_type = EXCLUDED.activity_type,
                name = EXCLUDED.name,
                started_at = EXCLUDED.started_at,
                timezone = EXCLUDED.timezone,
                distance_m = EXCLUDED.distance_m,
                duration_s = EXCLUDED.duration_s,
                moving_duration_s = EXCLUDED.moving_duration_s,
                elapsed_duration_s = EXCLUDED.elapsed_duration_s,
                calories_kcal = EXCLUDED.calories_kcal,
                average_hr_bpm = EXCLUDED.average_hr_bpm,
                max_hr_bpm = EXCLUDED.max_hr_bpm,
                source_updated_at = EXCLUDED.source_updated_at,
                updated_at = now()
            RETURNING id
            """,
            {"user_id": user_id, **activity},
        ).fetchone()
        normalized_id = str(row["id"] if isinstance(row, dict) else row[0])
        if activity["activity_type"] not in {"lap_swimming", "open_water_swimming"}:
            connection.execute(
                "DELETE FROM swimming_activities WHERE activity_id = %s",
                (normalized_id,),
            )
            return

        swim, lengths = normalize_swimming(
            activity_payload, details_payload, splits_payload
        )
        connection.execute(
            """
            INSERT INTO swimming_activities (
                activity_id, environment, pool_length_m, active_lengths, lap_count,
                average_pace_per_100m_s, total_strokes, average_strokes_per_length,
                average_stroke_cadence_per_minute, average_swolf
            ) VALUES (
                %(activity_id)s, %(environment)s, %(pool_length_m)s, %(active_lengths)s,
                %(lap_count)s, %(average_pace_per_100m_s)s, %(total_strokes)s,
                %(average_strokes_per_length)s, %(average_stroke_cadence_per_minute)s,
                %(average_swolf)s
            )
            ON CONFLICT (activity_id) DO UPDATE SET
                environment = EXCLUDED.environment,
                pool_length_m = EXCLUDED.pool_length_m,
                active_lengths = EXCLUDED.active_lengths,
                lap_count = EXCLUDED.lap_count,
                average_pace_per_100m_s = EXCLUDED.average_pace_per_100m_s,
                total_strokes = EXCLUDED.total_strokes,
                average_strokes_per_length = EXCLUDED.average_strokes_per_length,
                average_stroke_cadence_per_minute = EXCLUDED.average_stroke_cadence_per_minute,
                average_swolf = EXCLUDED.average_swolf
            """,
            {"activity_id": normalized_id, **swim},
        )
        connection.execute(
            "DELETE FROM swim_lengths WHERE activity_id = %s", (normalized_id,)
        )
        for length in lengths:
            connection.execute(
                """
                INSERT INTO swim_lengths (
                    activity_id, lap_index, length_index, started_at, distance_m,
                    duration_s, average_speed_mps, pace_per_100m_s, stroke_type,
                    calories_kcal, average_hr_bpm, max_hr_bpm, stroke_count, swolf, is_rest
                ) VALUES (
                    %(activity_id)s, %(lap_index)s, %(length_index)s, %(started_at)s,
                    %(distance_m)s, %(duration_s)s, %(average_speed_mps)s,
                    %(pace_per_100m_s)s, %(stroke_type)s, %(calories_kcal)s,
                    %(average_hr_bpm)s, %(max_hr_bpm)s, %(stroke_count)s, %(swolf)s,
                    %(is_rest)s
                )
                """,
                {"activity_id": normalized_id, **length},
            )

    def mark_import_result(
        self,
        connection_id: str,
        activity_id: str,
        status: str,
        error: str | None = None,
    ) -> None:
        completed = status == "complete"
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE garmin_activity_imports
                SET status = %s,
                    completed_at = CASE WHEN %s THEN now() ELSE completed_at END,
                    last_error = %s
                WHERE connection_id = %s AND activity_external_id = %s
                """,
                (status, completed, error, connection_id, activity_id),
            )

    def finish_sync_run(self, run_id: str, **summary: Any) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE garmin_sync_runs
                SET finished_at = now(), status = %(status)s,
                    discovered_count = %(discovered_count)s,
                    imported_count = %(imported_count)s,
                    updated_count = %(updated_count)s,
                    failed_count = %(failed_count)s,
                    error_summary = %(error_summary)s
                WHERE id = %(run_id)s
                """,
                {"run_id": run_id, **summary},
            )
            connection.execute(
                """
                UPDATE garmin_connections AS connection
                SET last_successful_sync_at = CASE
                        WHEN %(status)s IN ('complete', 'partial') THEN now()
                        ELSE last_successful_sync_at
                    END,
                    last_error_at = CASE WHEN %(status)s = 'failed' THEN now() ELSE last_error_at END,
                    updated_at = now()
                FROM garmin_sync_runs AS run
                WHERE run.id = %(run_id)s AND connection.id = run.connection_id
                """,
                {"run_id": run_id, **summary},
            )

    def rebuild_normalized(self, connection_id: str, user_id: str) -> int:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT external_id, resource_type, payload_json
                FROM garmin_raw_resources
                WHERE connection_id = %s
                  AND resource_type IN ('activity', 'details', 'splits')
                  AND fetch_status = 'complete'
                ORDER BY external_id
                """,
                (connection_id,),
            ).fetchall()
            grouped: dict[str, dict[str, Any]] = {}
            for row in rows:
                external_id = str(
                    row["external_id"] if isinstance(row, dict) else row[0]
                )
                resource_type = (
                    row["resource_type"] if isinstance(row, dict) else row[1]
                )
                payload = row["payload_json"] if isinstance(row, dict) else row[2]
                grouped.setdefault(external_id, {})[str(resource_type)] = payload
            rebuilt = 0
            for payloads in grouped.values():
                if all(name in payloads for name in ("activity", "details", "splits")):
                    self._upsert_normalized(
                        connection,
                        user_id,
                        payloads["activity"],
                        payloads["details"],
                        payloads["splits"],
                    )
                    rebuilt += 1
            return rebuilt
