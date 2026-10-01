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

## Sandbox persistence: PostgreSQL data

The PostgreSQL 17 cluster serving this project lives OUTSIDE the container's
writable layer, at `/workspace/health-hub/.sandbox/postgres` (the `/workspace`
mount survives sandbox container rebuilds; `/etc` and `/var/lib` do NOT).

The `data_directory` setting in `/etc/postgresql/17/main/postgresql.conf` is
lost whenever the sandbox container is rebuilt. Therefore:

**Mandatory after every sandbox rebuild/reset, before starting any Health Hub
service:** run

```
/workspace/health-hub/.sandbox/init-postgres.sh
```

as root. It re-points the cluster at the persistent data directory, starts it,
and verifies the `health_hub` database answers. If `postgresql-17` is missing
from the rebuilt image, install it first (`apt-get install -y postgresql-17`),
then run the script. Never run `pg_dropcluster` or re-run
`pg_createcluster --start` over the persistent path; the existing cluster there
is the source of truth.
