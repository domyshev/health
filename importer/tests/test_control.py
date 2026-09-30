from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from health_hub_garmin.control import (
    ChallengeInvalidError,
    ControlService,
    SyncAlreadyRunningError,
)


class FakeOAuthClient:
    def __init__(self, state: object | None = None) -> None:
        self.state = state
        self.password: str | None = "secret"
        self.saved_to: Path | None = None
        self.resume_calls: list[tuple[object, str]] = []

    def login(self):
        return self.state, None

    def resume_login(self, state: object, code: str):
        self.resume_calls.append((state, code))
        return None, None

    def dump(self, path: Path) -> None:
        self.saved_to = path


class FakeStore:
    def __init__(self) -> None:
        self.connections: list[tuple[str, str, str]] = []
        self.sync_error: Exception | None = None
        self.reservations: list[tuple[str, str, str]] = []

    def ensure_connection(self, user_id: str, token_storage_key: str, garmin_email: str) -> str:
        self.connections.append((user_id, token_storage_key, garmin_email))
        return "connection-id"

    def reserve_sync_run(self, user_id: str, connection_id: str, mode: str) -> str:
        self.reservations.append((user_id, connection_id, mode))
        if self.sync_error:
            raise self.sync_error
        return "run-id"


class FakeRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str]] = []

    def __call__(self, user_id: str, connection_id: str, run_id: str, mode: str) -> None:
        self.calls.append((user_id, connection_id, run_id, mode))


def test_connect_persists_tokens_without_retaining_password(tmp_path: Path) -> None:
    client = FakeOAuthClient()
    store = FakeStore()
    service = ControlService(
        store=store,
        token_root=tmp_path,
        client_factory=lambda email, password: client,
        sync_runner=FakeRunner(),
    )

    result = service.connect("user-id", "garmin@example.com", "secret")

    assert result == {"status": "connected", "connectionId": "connection-id"}
    assert client.password is None
    assert client.saved_to == tmp_path / "user-id"
    assert store.connections == [
        ("user-id", str(tmp_path / "user-id"), "garmin@example.com")
    ]


def test_mfa_challenge_is_bound_to_user_and_single_use(tmp_path: Path) -> None:
    state = {"opaque": "state"}
    client = FakeOAuthClient(state)
    store = FakeStore()
    service = ControlService(
        store=store,
        token_root=tmp_path,
        client_factory=lambda email, password: client,
        sync_runner=FakeRunner(),
        now=lambda: datetime(2026, 9, 21, 12, 0, tzinfo=UTC),
        challenge_ttl=timedelta(minutes=5),
    )

    pending = service.connect("owner-id", "garmin@example.com", "secret")
    challenge_id = pending["challengeId"]
    assert pending["status"] == "mfa_required"
    assert client.password is None

    with pytest.raises(ChallengeInvalidError):
        service.verify_mfa("other-id", challenge_id, "123456")

    result = service.verify_mfa("owner-id", challenge_id, "123456")
    assert result["status"] == "connected"
    assert client.resume_calls == [(state, "123456")]

    with pytest.raises(ChallengeInvalidError):
        service.verify_mfa("owner-id", challenge_id, "123456")


def test_expired_mfa_challenge_is_destroyed(tmp_path: Path) -> None:
    current = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    client = FakeOAuthClient({"opaque": "state"})
    service = ControlService(
        store=FakeStore(),
        token_root=tmp_path,
        client_factory=lambda email, password: client,
        sync_runner=FakeRunner(),
        now=lambda: current,
        challenge_ttl=timedelta(minutes=5),
    )
    challenge_id = service.connect("owner-id", "garmin@example.com", "secret")[
        "challengeId"
    ]
    current += timedelta(minutes=6)

    with pytest.raises(ChallengeInvalidError):
        service.verify_mfa("owner-id", challenge_id, "123456")


def test_start_sync_reserves_run_before_dispatch(tmp_path: Path) -> None:
    store = FakeStore()
    runner = FakeRunner()
    service = ControlService(
        store=store,
        token_root=tmp_path,
        client_factory=lambda email, password: FakeOAuthClient(),
        sync_runner=runner,
        dispatch=lambda job: job(),
    )

    result = service.start_sync("user-id", "connection-id")

    assert result == {"syncRunId": "run-id", "status": "running"}
    assert store.reservations == [("user-id", "connection-id", "recent")]
    assert runner.calls == [("user-id", "connection-id", "run-id", "recent")]


def test_start_sync_preserves_duplicate_run_error(tmp_path: Path) -> None:
    store = FakeStore()
    store.sync_error = SyncAlreadyRunningError("already running")
    service = ControlService(
        store=store,
        token_root=tmp_path,
        client_factory=lambda email, password: FakeOAuthClient(),
        sync_runner=FakeRunner(),
    )

    with pytest.raises(SyncAlreadyRunningError):
        service.start_sync("user-id", "connection-id")
