from __future__ import annotations

import hmac
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Protocol

from .control import ChallengeInvalidError, SyncAlreadyRunningError


class ControlAPI(Protocol):
    def connect(self, user_id: str, email: str, password: str) -> dict[str, Any]: ...

    def verify_mfa(
        self, user_id: str, challenge_id: str, code: str
    ) -> dict[str, Any]: ...

    def start_sync(self, user_id: str, connection_id: str) -> dict[str, Any]: ...


def create_server(
    address: tuple[str, int], secret: str, control: ControlAPI
) -> ThreadingHTTPServer:
    if len(secret) < 32:
        raise ValueError("control secret must contain at least 32 characters")

    class Handler(BaseHTTPRequestHandler):
        server_version = "HealthHubImporter/1"
        sys_version = ""

        def do_POST(self) -> None:
            if not self._authenticated():
                self._write_error(HTTPStatus.UNAUTHORIZED, "unauthorized")
                return
            try:
                payload = self._read_json()
                if self.path == "/private/v1/garmin/connect":
                    self._require_fields(payload, "userId", "email", "password")
                    result = control.connect(
                        payload["userId"], payload["email"], payload["password"]
                    )
                    status = (
                        HTTPStatus.ACCEPTED
                        if result.get("status") == "mfa_required"
                        else HTTPStatus.OK
                    )
                    self._write_json(status, result)
                    return
                prefix = "/private/v1/garmin/challenges/"
                suffix = "/verify"
                if self.path.startswith(prefix) and self.path.endswith(suffix):
                    challenge_id = self.path[len(prefix) : -len(suffix)]
                    self._require_fields(payload, "userId", "code")
                    result = control.verify_mfa(
                        payload["userId"], challenge_id, payload["code"]
                    )
                    self._write_json(HTTPStatus.OK, result)
                    return
                if self.path == "/private/v1/sync-runs":
                    self._require_fields(payload, "userId", "connectionId")
                    result = control.start_sync(
                        payload["userId"], payload["connectionId"]
                    )
                    self._write_json(HTTPStatus.ACCEPTED, result)
                    return
                self._write_error(HTTPStatus.NOT_FOUND, "not_found")
            except ChallengeInvalidError:
                self._write_error(
                    HTTPStatus.UNAUTHORIZED, "invalid_or_expired_challenge"
                )
            except SyncAlreadyRunningError:
                self._write_error(HTTPStatus.CONFLICT, "sync_already_running")
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                self._write_error(HTTPStatus.BAD_REQUEST, "invalid_request")
            except Exception as exc:
                if exc.__class__.__name__ in {
                    "GarminConnectAuthenticationError",
                    "GarminConnectInvalidCredentialsError",
                }:
                    self._write_error(
                        HTTPStatus.UNAUTHORIZED, "garmin_auth_failed"
                    )
                    return
                self._write_error(
                    HTTPStatus.SERVICE_UNAVAILABLE, "service_unavailable"
                )

        def _authenticated(self) -> bool:
            expected = "Bearer " + secret
            provided = self.headers.get("Authorization", "")
            return hmac.compare_digest(provided.encode(), expected.encode())

        def _read_json(self) -> dict[str, str]:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("application/json is required")
            raw_length = self.headers.get("Content-Length", "")
            length = int(raw_length)
            if length < 2 or length > 65536:
                raise ValueError("invalid body length")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise TypeError("JSON object required")
            if not all(isinstance(key, str) and isinstance(value, str) for key, value in payload.items()):
                raise TypeError("string fields required")
            return payload

        @staticmethod
        def _require_fields(payload: dict[str, str], *fields: str) -> None:
            if set(payload) != set(fields) or any(not payload[field] for field in fields):
                raise ValueError("invalid fields")

        def _write_error(self, status: HTTPStatus, code: str) -> None:
            self._write_json(status, {"error": {"code": code}})

        def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    return ThreadingHTTPServer(address, Handler)
