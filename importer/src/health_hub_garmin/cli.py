from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .client import connect_interactively, load_saved_client
from .postgres import PostgresStore
from .snapshot import ActivitySnapshotImporter, safe_error
from .sync import SyncService

DEFAULT_TOKEN_DIR = "/var/lib/health-hub/garmin/default"
DEFAULT_OUTPUT_DIR = "/var/lib/health-hub/activities"
DEFAULT_MIGRATION = str(
    Path(__file__).resolve().parents[3] / "migrations" / "001_garmin_import.sql"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only Garmin importer for Health Hub"
    )
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    connect = subparsers.add_parser(
        "connect", help="Create or replace saved Garmin OAuth tokens"
    )
    connect.add_argument("--token-dir", default=DEFAULT_TOKEN_DIR)

    single = subparsers.add_parser(
        "import-activity", help="Download one activity into a local package"
    )
    single.add_argument("activity_id")
    single.add_argument("--output", default=DEFAULT_OUTPUT_DIR)
    single.add_argument("--token-dir", default=DEFAULT_TOKEN_DIR)
    single.add_argument("--refresh", action="store_true")

    migrate = subparsers.add_parser(
        "migrate", help="Apply the Plan 001 PostgreSQL migration"
    )
    migrate.add_argument(
        "--database-url", default=os.environ.get("HEALTH_HUB_DATABASE_URL")
    )
    migrate.add_argument("--migration", default=DEFAULT_MIGRATION)

    connection = subparsers.add_parser(
        "ensure-connection", help="Create or update a Garmin connection row"
    )
    connection.add_argument(
        "--database-url", default=os.environ.get("HEALTH_HUB_DATABASE_URL")
    )
    connection.add_argument("--user-id", required=True)
    connection.add_argument("--token-dir", default=DEFAULT_TOKEN_DIR)

    sync = subparsers.add_parser("sync", help="Discover and import recent activities")
    sync.add_argument(
        "--database-url", default=os.environ.get("HEALTH_HUB_DATABASE_URL")
    )
    sync.add_argument("--connection-id", required=True)
    sync.add_argument("--user-id", required=True)
    sync.add_argument("--output", default=DEFAULT_OUTPUT_DIR)
    sync.add_argument("--token-dir", default=DEFAULT_TOKEN_DIR)
    sync.add_argument("--limit", type=int, default=100)
    sync.add_argument("--refresh-days", type=int, default=7)

    rebuild = subparsers.add_parser(
        "rebuild", help="Rebuild normalized rows from stored raw JSON"
    )
    rebuild.add_argument(
        "--database-url", default=os.environ.get("HEALTH_HUB_DATABASE_URL")
    )
    rebuild.add_argument("--connection-id", required=True)
    rebuild.add_argument("--user-id", required=True)
    return parser


def _database_url(args: argparse.Namespace) -> str:
    value = getattr(args, "database_url", None)
    if not value:
        raise ValueError("--database-url or HEALTH_HUB_DATABASE_URL is required")
    return str(value)


def _print_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def run(args: argparse.Namespace) -> int:
    if args.command == "connect":
        client = connect_interactively(Path(args.token_dir))
        client.get_activities(0, 1)
        _print_json(
            {"status": "connected", "tokenDirectory": str(Path(args.token_dir))}
        )
        return 0

    if args.command == "import-activity":
        client = load_saved_client(Path(args.token_dir))
        importer = ActivitySnapshotImporter(
            client, Path(args.output), importer_version=__version__
        )
        result = importer.import_activity(args.activity_id, refresh=args.refresh)
        _print_json(
            {
                "activityId": result.activity_id,
                "directory": str(result.directory),
                "status": result.status,
                "reused": result.reused,
            }
        )
        return 0 if result.status == "complete" else 2

    if args.command == "migrate":
        PostgresStore(_database_url(args)).migrate(Path(args.migration))
        _print_json({"status": "migrated", "migration": str(Path(args.migration))})
        return 0

    if args.command == "ensure-connection":
        connection_id = PostgresStore(_database_url(args)).ensure_connection(
            args.user_id, args.token_dir
        )
        _print_json({"connectionId": connection_id, "status": "active"})
        return 0

    if args.command == "sync":
        client = load_saved_client(Path(args.token_dir))
        store = PostgresStore(_database_url(args))
        snapshots = ActivitySnapshotImporter(
            client, Path(args.output), importer_version=__version__
        )
        summary = SyncService(client, store, snapshots).sync(
            connection_id=args.connection_id,
            user_id=args.user_id,
            limit=args.limit,
            refresh_days=args.refresh_days,
        )
        _print_json(
            {
                "runId": summary.run_id,
                "status": summary.status,
                "discoveredCount": summary.discovered_count,
                "importedCount": summary.imported_count,
                "updatedCount": summary.updated_count,
                "failedCount": summary.failed_count,
                "errorSummary": summary.error_summary,
            }
        )
        return 0 if summary.status == "complete" else 2

    if args.command == "rebuild":
        count = PostgresStore(_database_url(args)).rebuild_normalized(
            args.connection_id, args.user_id
        )
        _print_json({"status": "complete", "rebuiltCount": count})
        return 0

    raise ValueError(f"unsupported command: {args.command}")


def main() -> int:
    args = build_parser().parse_args()
    try:
        return run(args)
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Operation failed: {safe_error(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
