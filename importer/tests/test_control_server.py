from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager
from typing import Any

import pytest

from health_hub_garmin.control_server import create_server

CONTROL_SECRET = "01234567890123456789012345678901"


class FakeControl:
    def __init__(self) -> None:
        self.connect_payload: tuple[str, str, str] | None = None

    def connect(self, user_id: str, email: str, password: str) -> dict[str, Any]:
        self.connect_payload = (user_id, email, password)
        return {"status": "connected", "connectionId": "connection-id"}

    def verify_mfa(self, user_id: str, challenge_id: str, code: str):
        return {"status": "connected", "connectionId": "connection-id"}

    def start_sync(self, user_id: str, connection_id: str):
        return {"syncRunId": "run-id", "status": "running"}


@contextmanager
def running_server(control: FakeControl):
    server = create_server(("127.0.0.1", 0), CONTROL_SECRET, control)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def post(url: str, payload: dict[str, str], secret: str = CONTROL_SECRET):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    return urllib.request.urlopen(request, timeout=2)


def test_private_connect_requires_control_secret_and_forwards_credentials() -> None:
    control = FakeControl()
    with running_server(control) as base_url:
        with pytest.raises(urllib.error.HTTPError) as failure:
            post(
                base_url + "/private/v1/garmin/connect",
                {"userId": "user-id", "email": "g@example.com", "password": "pw"},
                secret="wrong",
            )
        assert failure.value.code == 401

        response = post(
            base_url + "/private/v1/garmin/connect",
            {"userId": "user-id", "email": "g@example.com", "password": "pw"},
        )
        assert response.status == 200
        assert json.load(response)["status"] == "connected"
        assert control.connect_payload == ("user-id", "g@example.com", "pw")


def test_private_server_rejects_short_control_secret() -> None:
    with pytest.raises(ValueError):
        create_server(("127.0.0.1", 0), "short", FakeControl())


def test_private_sync_returns_accepted_run() -> None:
    with running_server(FakeControl()) as base_url:
        response = post(
            base_url + "/private/v1/sync-runs",
            {"userId": "user-id", "connectionId": "connection-id"},
        )
        assert response.status == 202
        assert json.load(response) == {"syncRunId": "run-id", "status": "running"}
