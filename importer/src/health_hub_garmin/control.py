from __future__ import annotations

import re
import secrets
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from .client import secure_token_directory
from .postgres import SyncAlreadyRunningError


class ChallengeInvalidError(RuntimeError):
    pass


class ControlStore(Protocol):
    def ensure_connection(
        self, user_id: str, token_storage_key: str, garmin_email: str
    ) -> str: ...

    def reserve_sync_run(self, user_id: str, connection_id: str, mode: str) -> str: ...


class OAuthClient(Protocol):
    password: str | None

    def login(self) -> tuple[Any, Any]: ...

    def resume_login(self, state: Any, code: str) -> tuple[Any, Any]: ...


@dataclass
class _Challenge:
    user_id: str
    email: str
    client: OAuthClient
    state: Any
    expires_at: datetime


class ControlService:
    def __init__(
        self,
        *,
        store: ControlStore,
        token_root: Path,
        client_factory: Callable[[str, str], OAuthClient],
        sync_runner: Callable[[str, str, str, str], None],
        challenge_ttl: timedelta = timedelta(minutes=5),
        now: Callable[[], datetime] | None = None,
        dispatch: Callable[[Callable[[], None]], None] | None = None,
    ) -> None:
        self.store = store
        self.token_root = Path(token_root)
        self.client_factory = client_factory
        self.sync_runner = sync_runner
        self.challenge_ttl = challenge_ttl
        self.now = now or (lambda: datetime.now(UTC))
        self.dispatch = dispatch or self._dispatch_thread
        self._challenges: dict[str, _Challenge] = {}
        self._lock = threading.Lock()

    def connect(self, user_id: str, email: str, password: str) -> dict[str, Any]:
        token_dir = self._token_directory(user_id)
        client = self.client_factory(email, password)
        try:
            state, _ = client.login()
        finally:
            client.password = None
            password = ""
        if state is not None:
            challenge_id = secrets.token_urlsafe(32)
            expires_at = self.now().astimezone(UTC) + self.challenge_ttl
            with self._lock:
                self._purge_expired_locked()
                self._challenges[challenge_id] = _Challenge(
                    user_id=user_id,
                    email=email,
                    client=client,
                    state=state,
                    expires_at=expires_at,
                )
            return {
                "status": "mfa_required",
                "challengeId": challenge_id,
                "expiresAt": expires_at.isoformat().replace("+00:00", "Z"),
            }
        return self._persist_connection(user_id, email, token_dir, client)

    def verify_mfa(
        self, user_id: str, challenge_id: str, code: str
    ) -> dict[str, Any]:
        now = self.now().astimezone(UTC)
        with self._lock:
            challenge = self._challenges.get(challenge_id)
            if (
                challenge is None
                or challenge.user_id != user_id
                or challenge.expires_at <= now
            ):
                if challenge is not None and challenge.expires_at <= now:
                    self._challenges.pop(challenge_id, None)
                raise ChallengeInvalidError("challenge is invalid or expired")
            self._challenges.pop(challenge_id, None)
        try:
            challenge.client.resume_login(challenge.state, code)
        finally:
            challenge.client.password = None
            code = ""
        token_dir = self._token_directory(user_id)
        return self._persist_connection(
            user_id, challenge.email, token_dir, challenge.client
        )

    def start_sync(self, user_id: str, connection_id: str, mode: str = "recent") -> dict[str, str]:
        if mode not in {"recent", "full_history"}:
            raise ValueError("invalid sync mode")
        run_id = self.store.reserve_sync_run(user_id, connection_id, mode)
        self.dispatch(lambda: self.sync_runner(user_id, connection_id, run_id, mode))
        return {"syncRunId": run_id, "status": "running"}

    def _persist_connection(
        self, user_id: str, email: str, token_dir: Path, client: OAuthClient
    ) -> dict[str, str]:
        secure_token_directory(token_dir)
        if hasattr(client, "dump"):
            client.dump(token_dir)  # type: ignore[attr-defined]
        else:
            client.client.dump(str(token_dir))  # type: ignore[attr-defined]
        secure_token_directory(token_dir)
        connection_id = self.store.ensure_connection(user_id, str(token_dir), email)
        return {"status": "connected", "connectionId": connection_id}

    def _token_directory(self, user_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9-]{1,128}", user_id):
            raise ValueError("invalid user ID")
        return self.token_root / user_id

    def _purge_expired_locked(self) -> None:
        now = self.now().astimezone(UTC)
        expired = [
            challenge_id
            for challenge_id, challenge in self._challenges.items()
            if challenge.expires_at <= now
        ]
        for challenge_id in expired:
            self._challenges.pop(challenge_id, None)

    @staticmethod
    def _dispatch_thread(job: Callable[[], None]) -> None:
        threading.Thread(target=job, daemon=True, name="health-hub-sync").start()


__all__ = [
    "ChallengeInvalidError",
    "ControlService",
    "SyncAlreadyRunningError",
]
