from __future__ import annotations

import os
import signal
import threading
from pathlib import Path
from typing import Any

from . import __version__
from .client import load_saved_client
from .control import ControlService
from .control_server import create_server
from .postgres import PostgresStore
from .snapshot import ActivitySnapshotImporter, safe_error
from .sync import SyncService


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _garmin_client(email: str, password: str) -> Any:
    from garminconnect import Garmin

    return Garmin(
        email=email,
        password=password,
        return_on_mfa=True,
    )


def main() -> int:
    database_url = _required_env("HEALTH_HUB_DATABASE_URL")
    control_secret = _required_env("IMPORTER_CONTROL_SECRET")
    address = os.environ.get("IMPORTER_HTTP_ADDR", "127.0.0.1:8081")
    host, separator, raw_port = address.rpartition(":")
    if not separator or not host:
        raise ValueError("IMPORTER_HTTP_ADDR must use host:port")
    port = int(raw_port)
    token_root = Path(
        os.environ.get("GARMIN_TOKEN_ROOT", "/var/lib/health-hub/garmin")
    )
    output_root = Path(
        os.environ.get("GARMIN_OUTPUT_ROOT", "/var/lib/health-hub/activities")
    )
    store = PostgresStore(database_url)

    def run_sync(user_id: str, connection_id: str, run_id: str) -> None:
        try:
            token_dir = token_root / user_id
            client = load_saved_client(token_dir)
            snapshots = ActivitySnapshotImporter(
                client,
                output_root / user_id,
                importer_version=__version__,
            )
            SyncService(client, store, snapshots).sync(
                connection_id=connection_id,
                user_id=user_id,
                run_id=run_id,
            )
        except Exception as exc:
            store.finish_sync_run(
                run_id,
                status="failed",
                discovered_count=0,
                imported_count=0,
                updated_count=0,
                failed_count=1,
                error_summary=safe_error(exc),
            )

    control = ControlService(
        store=store,
        token_root=token_root,
        client_factory=_garmin_client,
        sync_runner=run_sync,
    )
    server = create_server((host, port), control_secret, control)
    stop_event = threading.Event()

    def stop_server(_signum: int, _frame: object) -> None:
        if not stop_event.is_set():
            stop_event.set()
            threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop_server)
    signal.signal(signal.SIGTERM, stop_server)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
