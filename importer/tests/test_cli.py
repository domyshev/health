from health_hub_garmin.cli import build_parser


def test_import_activity_cli_requires_id_and_accepts_refresh():
    args = build_parser().parse_args(
        [
            "import-activity",
            "42",
            "--output",
            "/data",
            "--token-dir",
            "/tokens",
            "--refresh",
        ]
    )

    assert args.command == "import-activity"
    assert args.activity_id == "42"
    assert args.output == "/data"
    assert args.token_dir == "/tokens"
    assert args.refresh is True


def test_sync_cli_exposes_incremental_settings():
    args = build_parser().parse_args(
        [
            "sync",
            "--database-url",
            "postgresql://db/health",
            "--connection-id",
            "connection",
            "--user-id",
            "user",
            "--output",
            "/data",
            "--token-dir",
            "/tokens",
            "--limit",
            "50",
            "--refresh-days",
            "3",
        ]
    )

    assert args.limit == 50
    assert args.refresh_days == 3
