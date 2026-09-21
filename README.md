# health-hub

A self-hosted personal health, fitness, and nutrition data platform. The current implementation provides a read-only Garmin Connect importer with local raw-file packages, PostgreSQL persistence, incremental synchronization, and swimming normalization.

## Components

- `importer/` — Python 3.12 Garmin importer. This is the only component that communicates with Garmin Connect or reads Garmin OAuth tokens.
- `migrations/` — PostgreSQL schema for Garmin integration state, raw resources, original files, normalized activities, and swimming lengths.
- `garmin_probe.py` — the original read-only access probe, retained as a manual smoke test.
- `work/inspect_swim.py` — a diagnostic script for inspecting swimming response fields without dumping tokens.
- `api/` — reserved for the Go API defined by the next implementation plan.

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

## Quick test

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e 'importer[test]'
.venv/bin/python -m pytest importer/tests
```

All automated tests are offline and use synthetic payloads.

## Legacy probe

The original probe remains available until an authenticated manual smoke test confirms equivalent behavior in the packaged importer:

```bash
.venv/bin/python garmin_probe.py
```

It reuses tokens under `.secrets/garmin/` and never modifies the Garmin account.

## Security

- Never commit or publish `.secrets`, Garmin tokens, raw health payloads, FIT files, database dumps, or precise location data.
- Garmin passwords and MFA codes are accepted only through interactive prompts and are not stored.
- The future Go API must not access Garmin tokens or call Garmin Connect.
- Raw Garmin responses are internal audit and reprocessing data, not a public API contract.
