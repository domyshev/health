from __future__ import annotations

from collections.abc import Callable
from getpass import getpass
from pathlib import Path
from typing import Any


class GarminClientAdapter:
    """Expose only the read operations used by the importer."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def get_activities(self, start: int, limit: int):
        return self._client.get_activities(start, limit)

    def get_activity(self, activity_id: str):
        return self._client.get_activity(activity_id)

    def get_activity_details(self, activity_id: str):
        return self._client.get_activity_details(activity_id)

    def get_activity_splits(self, activity_id: str):
        return self._client.get_activity_splits(activity_id)

    def get_activity_typed_splits(self, activity_id: str):
        return self._client.get_activity_typed_splits(activity_id)

    def get_activity_split_summaries(self, activity_id: str):
        return self._client.get_activity_split_summaries(activity_id)

    def get_activity_hr_in_timezones(self, activity_id: str):
        return self._client.get_activity_hr_in_timezones(activity_id)

    def get_activity_weather(self, activity_id: str):
        return self._client.get_activity_weather(activity_id)

    def get_activity_gear(self, activity_id: str):
        return self._client.get_activity_gear(activity_id)

    def download_original_activity(self, activity_id: str) -> bytes:
        return self._client.download_activity(
            activity_id,
            dl_fmt=self._client.ActivityDownloadFormat.ORIGINAL,
        )


def secure_token_directory(token_dir: Path) -> None:
    token_dir = Path(token_dir)
    token_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    token_dir.chmod(0o700)
    for path in token_dir.iterdir():
        if path.is_file():
            path.chmod(0o600)


def load_saved_client(token_dir: Path) -> GarminClientAdapter:
    from garminconnect import Garmin

    secure_token_directory(token_dir)
    client = Garmin()
    client.login(str(token_dir))
    secure_token_directory(token_dir)
    return GarminClientAdapter(client)


def connect_interactively(
    token_dir: Path,
    *,
    input_fn: Callable[[str], str] = input,
    getpass_fn: Callable[[str], str] = getpass,
) -> GarminClientAdapter:
    from garminconnect import Garmin

    secure_token_directory(token_dir)
    email = input_fn("Garmin email: ").strip()
    password = getpass_fn("Garmin password: ")
    client = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input_fn("Garmin MFA code: ").strip(),
    )
    try:
        client.login(str(token_dir))
    finally:
        password = ""
        if hasattr(client, "password"):
            client.password = None
    secure_token_directory(token_dir)
    return GarminClientAdapter(client)
