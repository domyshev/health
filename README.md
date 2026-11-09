# health-hub

A self-hosted personal health, fitness, and nutrition data platform. The current implementation provides a responsive React dashboard, a Go JSON API with passwordless email authentication, and a read-only Garmin Connect importer with local raw-file packages, PostgreSQL persistence, incremental synchronization, and swimming normalization.

## Components

- `importer/` — Python 3.12 Garmin importer. This is the only component that communicates with Garmin Connect or reads Garmin OAuth tokens.
- `api/` — Go API for passwordless authentication, secure browser sessions, normalized health reads, Garmin connection state, and manual synchronization.
- `web/` — React 19, Material UI, Redux Toolkit, and RTK Query dashboard for login, activities, Garmin connection, and manual sync.
- `migrations/` — PostgreSQL schema and least-privilege roles for authentication, Garmin integration state, raw resources, original files, and normalized health data.
- `garmin_probe.py` — the original read-only access probe, retained as a manual smoke test.
- `work/inspect_swim.py` — a diagnostic script for inspecting swimming response fields without dumping tokens.


## Garmin importer

The importer uses `garminconnect==0.3.16` and only calls read operations. It can:

- create OAuth tokens through an interactive login without storing the password;
- download a complete local package for one activity;
- preserve each raw JSON response and the original FIT or archive;
- verify files with SHA-256 and resume partial imports;
- synchronize new, changed, failed, partial, and recently completed activities;
- write raw and normalized data to PostgreSQL without duplicates;
- rebuild normalized rows entirely from stored raw JSON;
- normalize pool and open-water swimming summaries and individual lengths.

See [`docs/garmin-importer.md`](docs/garmin-importer.md) for installation and operation.

## Go API

The Go service provides:

- six-digit passwordless login codes delivered through Resend;
- hashed login codes and opaque 30-day sessions;
- Secure, HttpOnly, SameSite browser cookies and Origin-based CSRF protection;
- trusted-proxy-aware IP rate limiting;
- owner-scoped activity, swimming, and daily-health endpoints;
- a safe Garmin connection and MFA facade over the private Python control service;
- idempotent manual sync dispatch and sync status;
- OpenAPI documentation and liveness/readiness endpoints.

See [`docs/go-api.md`](docs/go-api.md) for configuration and deployment and [`docs/openapi.yaml`](docs/openapi.yaml) for the public contract.

## Web dashboard

The browser client uses only same-origin `/v1` requests with the API-managed HttpOnly session cookie. It includes passwordless login, a responsive activity list with persisted UI filtering and cursor pagination, Garmin connect/reconnect with in-memory MFA state, manual sync polling, and server-side logout.

See [`web/README.md`](web/README.md) for development, tests, browser-storage boundaries, production builds, and the current theme-source limitation.

## Quick test

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e 'importer[test]'
.venv/bin/python -m pytest importer/tests
cd api
go test ./...
cd ../web
npm ci
npm run check
npm run test:e2e
```

Unit tests are offline and use synthetic payloads. PostgreSQL integration suites run when their documented test database environment variables are set.

## Legacy probe

The original probe remains available until an authenticated manual smoke test confirms equivalent behavior in the packaged importer:

```bash
.venv/bin/python garmin_probe.py
```

It reuses tokens under `.secrets/garmin/` and never modifies the Garmin account.

## Security

- Never commit or publish `.secrets`, Garmin tokens, raw health payloads, FIT files, database dumps, or precise location data.
- Garmin passwords and MFA codes are accepted only by the private importer control process and are not stored.
- The Go API cannot access Garmin tokens or call Garmin Connect.
- Raw Garmin responses are internal audit and reprocessing data, not a public API contract.

## Production containers and automatic releases

The root Dockerfile builds the dashboard, API, and migration executable into an
unprivileged image. `importer/Dockerfile` builds a separate Garmin control image.
Set `STATIC_DIR` to serve the dashboard from the Go API; API and health routes
retain their existing authentication and readiness behavior.

Pushes to `main` run frontend checks, Go race tests and PostgreSQL integration
tests, and importer tests on GitHub-hosted runners. Successful builds publish
`web-<commit>` releases containing only application images and a checksum manifest.
A deployment tag is created only after the production readiness endpoint and
`deployment.json` confirm that exact commit. Infrastructure configuration,
credentials, databases, and Garmin tokens remain outside this public repository.

Run production migrations with `health-hub-migrate` before starting the new API
and importer. Back up PostgreSQL and stop writers before applying migrations.
A failed deployment must restore a matching database snapshot before reverting
the images; an older executable alone cannot undo a schema migration.
