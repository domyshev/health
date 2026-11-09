# Repository instructions

## Documentation language

All documentation in this repository must be written exclusively in English.
This is a strict, repository-wide rule.

It applies to, at minimum:

- `README` files;
- Markdown and other documentation files;
- architecture and decision records;
- setup, deployment, and operational instructions;
- API documentation;
- all comments in source code, without exception;
- docstrings and documentation comments;
- `TODO`, `FIXME`, and similar developer notes;
- command help text and examples committed to the repository.

Do not add bilingual documentation or translations in other languages to this
repository. Keep non-English planning notes in the separate private plans
repository, not in this codebase.

All newly written or edited code comments must be in English, even when the
surrounding discussion, task description, or private planning document is in
another language.

## Production deployment

The root Dockerfile packages the dashboard, Go API, and migration executable.
The importer has its own Dockerfile and must remain a separate process with
exclusive access to Garmin tokens and original activity files.

Production runs as an independent Docker Compose stack. Actual host settings,
backup and recovery procedures, secrets, and deployment updater configuration
belong to the separate private infrastructure repository. Do not put them here.

Pushes to `main` trigger `.github/workflows/deploy-web.yml`. A successful build
publishes immutable images; a deployment tag is created only after the production
readiness endpoint confirms the same commit. Preserve those checks.

Before database migrations, stop application writers and take a verified backup.
Rollback requires the matching database snapshot as well as the previous images.
Never expose PostgreSQL or the private Garmin control endpoint publicly.

## Retired sandbox

The former Hermes sandbox installation was retired and archived on 2026-11-09.
Do not restart it or use its database, tokens, environment files, or old deployment
scripts as production defaults. Production started with a fresh PostgreSQL 17
cluster; historical sandbox data is retained privately for recovery only.
