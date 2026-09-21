# Garmin importer

The importer is the only Health Hub component allowed to communicate with Garmin Connect. It uses read-only client methods, stores raw source responses, preserves the original activity download, and builds normalized PostgreSQL rows.

## Requirements

- Python 3.12
- PostgreSQL 16 or newer
- A private directory for Garmin OAuth tokens
- A private directory for raw JSON and original activity files

## Install

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e 'importer[test]'
```

## Start PostgreSQL

Set a local password without committing it:

```bash
read -rsp 'PostgreSQL password: ' POSTGRES_PASSWORD; echo
export POSTGRES_PASSWORD
docker compose up -d postgres
export HEALTH_HUB_DATABASE_URL="postgresql://health_hub:${POSTGRES_PASSWORD}@localhost:5432/health_hub"
```

Apply the migration:

```bash
.venv/bin/health-hub-garmin migrate
```

## Connect Garmin

Credentials are requested interactively. The password and MFA code are never accepted as command-line arguments or environment variables. Only OAuth tokens are written to the token directory.

```bash
sudo install -d -m 0700 /var/lib/health-hub/garmin/default
.venv/bin/health-hub-garmin connect \
  --token-dir /var/lib/health-hub/garmin/default
```

The importer enforces mode `0700` on the token directory and `0600` on token files after login.

## Import one activity

```bash
.venv/bin/health-hub-garmin import-activity 123456789 \
  --token-dir /var/lib/health-hub/garmin/default \
  --output /var/lib/health-hub/activities
```

A package contains `manifest.json`, raw JSON from each supported endpoint, and the unmodified original FIT or archive returned by Garmin. A complete package is verified by size and SHA-256 and reused without network access. A partial package retries only missing or failed resources unless `--refresh` is specified.

## Register a local connection

Plan 001 intentionally stores `user_id` as an external UUID. The user table and public authentication flow belong to Plan 002.

```bash
.venv/bin/health-hub-garmin ensure-connection \
  --user-id 00000000-0000-0000-0000-000000000001 \
  --token-dir /var/lib/health-hub/garmin/default
```

Save the returned connection ID.

## Incremental synchronization

```bash
.venv/bin/health-hub-garmin sync \
  --connection-id CONNECTION_UUID \
  --user-id 00000000-0000-0000-0000-000000000001 \
  --token-dir /var/lib/health-hub/garmin/default \
  --output /var/lib/health-hub/activities \
  --limit 100 \
  --refresh-days 7
```

The synchronization process:

1. acquires a PostgreSQL advisory lock for the connection;
2. records a sync run;
3. discovers recent activities;
4. imports new, changed, partial, failed, and recently completed activities;
5. upserts raw resources and original-file metadata;
6. rebuilds normalized activity and swimming rows;
7. records complete, partial, or failed status and counts.

The command is suitable for cron or a systemd timer. Do not run it in parallel for the same connection; the database lock rejects overlapping runs.

Example systemd units are provided under `deploy/systemd/`. Install them only after creating the dedicated system user and writable data directories:

```bash
sudo install -d -o health-hub-importer -g health-hub-importer -m 0700 \
  /var/lib/health-hub/garmin/default \
  /var/lib/health-hub/activities
sudo install -d -m 0755 /etc/health-hub
sudo install -m 0600 deploy/systemd/importer.env.example /etc/health-hub/importer.env
sudo install -m 0644 deploy/systemd/health-hub-garmin-sync.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/health-hub-garmin-sync.timer /etc/systemd/system/
```

Edit `/etc/health-hub/importer.env`, then enable the timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now health-hub-garmin-sync.timer
```

The timer runs every 15 minutes with a randomized delay. The database advisory lock and active-run unique index prevent overlapping synchronization for the same connection.

## Rebuild normalized data offline

This command reads only `garmin_raw_resources` and does not contact Garmin:

```bash
.venv/bin/health-hub-garmin rebuild \
  --connection-id CONNECTION_UUID \
  --user-id 00000000-0000-0000-0000-000000000001
```

## Tests

Tests use synthetic payloads and do not require a Garmin account or network access:

```bash
.venv/bin/python -m pytest importer/tests
```

PostgreSQL integration tests are enabled only when a disposable test database is explicitly provided:

```bash
HEALTH_HUB_TEST_DATABASE_URL='postgresql://...' \
  .venv/bin/python -m pytest importer/tests/integration
```

## Data handling

- Never commit token directories, raw payloads, FIT files, database dumps, or exact GPS data.
- Mount token storage only into the importer process.
- Back up PostgreSQL, raw activity packages, and OAuth tokens separately.
- A suspected token leak requires revoking Garmin sessions, deleting the local token, and reconnecting interactively.
