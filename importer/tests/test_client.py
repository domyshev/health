from pathlib import Path

from health_hub_garmin.client import GarminClientAdapter, secure_token_directory


class RawClient:
    class ActivityDownloadFormat:
        ORIGINAL = object()

    def __init__(self):
        self.download_args = None

    def download_activity(self, activity_id, dl_fmt):
        self.download_args = (activity_id, dl_fmt)
        return b"original"


def test_adapter_requests_unmodified_original_download():
    raw = RawClient()

    result = GarminClientAdapter(raw).download_original_activity("42")

    assert result == b"original"
    assert raw.download_args == ("42", RawClient.ActivityDownloadFormat.ORIGINAL)


def test_secure_token_directory_enforces_private_permissions(tmp_path: Path):
    token_dir = tmp_path / "tokens"
    token_dir.mkdir()
    token_file = token_dir / "garmin_tokens.json"
    token_file.write_text("{}")

    secure_token_directory(token_dir)

    assert token_dir.stat().st_mode & 0o777 == 0o700
    assert token_file.stat().st_mode & 0o777 == 0o600
