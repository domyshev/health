# Go API and passwordless authentication

The Go service in `api/` exposes the stable `/v1` contract documented in [`openapi.yaml`](openapi.yaml). It owns Health Hub users, passwordless login codes, browser sessions, and authorization. It reads normalized health data from PostgreSQL and never reads Garmin OAuth tokens or raw Garmin payloads.

## Build and test

Go 1.24 or newer is required.

```bash
cd api
go test ./...
go vet ./...
go build ./cmd/server ./cmd/migrate
```

PostgreSQL integration tests run when `HEALTH_HUB_TEST_DATABASE_URL` is set. The database user running those tests must be able to create roles because the role-isolation migration is part of the test.

```bash
export HEALTH_HUB_TEST_DATABASE_URL='postgresql://postgres@localhost/health_hub_test'
cd api
go test ./internal/postgres -v
```

## Migrations

Apply migrations with a database owner or the dedicated migrator login. Migrations are ordered by filename and recorded in `schema_migrations`.

```bash
cd api
HEALTH_HUB_DATABASE_URL='postgresql://health_hub_migrator@localhost/health_hub' \
  go run ./cmd/migrate ../migrations
```

The runtime API login should inherit `health_hub_api`. The importer login should inherit `health_hub_importer`. The API role has no access to `garmin_raw_resources`, `garmin_files`, or token storage.

## Configuration

Required API settings:

- `HEALTH_HUB_DATABASE_URL`: PostgreSQL DSN for the API runtime role.
- `AUTH_SECRET`: at least 32 random bytes, supplied by the deployment secret store.
- `AUTH_ALLOWED_EMAILS`: comma-separated login allowlist.
- `APP_ORIGINS`: comma-separated browser origins. Production requires at least one origin.
- `EMAIL_MODE`: `resend` in production or `log` in explicit development mode.
- `RESEND_API_KEY` and `EMAIL_FROM`: required when `EMAIL_MODE=resend`. The sender address comes from `EMAIL_FROM`; its display name is always `Health`.
- `IMPORTER_BASE_URL` and `IMPORTER_CONTROL_SECRET`: private importer control service settings. They must be configured together, the shared secret must contain at least 32 characters, and both are required in production.

Optional API settings:

- `HTTP_ADDR`, default `:8080`.
- `APP_ENV`, default `development`.
- `COOKIE_SECURE`, default `true`; production refuses `false`.
- `TRUSTED_PROXY_CIDRS`: comma-separated networks whose forwarded client address headers are trusted.

The production cookie is named `__Host-health_hub_session` and is Secure, HttpOnly, SameSite=Lax, scoped to `/`, and has no Domain attribute. State-changing authenticated requests require an allowed `Origin` header.

## Passwordless login

1. `POST /v1/auth/request-code` accepts an email and always returns a neutral accepted response for a syntactically valid request.
2. Allowed users receive a six-digit code through Resend.
3. Only an HMAC-SHA-256 digest of the code is stored. Codes expire after 10 minutes, allow five attempts, and invalidate older codes.
4. Successful verification creates an opaque 32-byte session token. Only its SHA-256 digest is stored.
5. Sessions expire after 30 days. Logout revokes the server-side session and expires the browser cookie.

Request-code limits are five per email per hour, twenty per client IP per hour, and one resend per email per minute. Forwarded IP headers are used only when the immediate peer is in `TRUSTED_PROXY_CIDRS`.

## Garmin control boundary

`health-hub-garmin-control` is a private Python HTTP service. The Go API authenticates to it with `IMPORTER_CONTROL_SECRET`. Do not expose its port to browsers or the public network.

Garmin email, password, and MFA code exist only in request memory during connection. The Python service performs Garmin login and writes OAuth tokens to a user-specific directory with restrictive permissions. MFA challenges are random, short-lived, in-memory, user-bound, and single-use. A restart intentionally destroys pending challenges.

Private importer settings:

- `HEALTH_HUB_DATABASE_URL`: importer database login.
- `IMPORTER_CONTROL_SECRET`: shared secret from the deployment secret store.
- `IMPORTER_HTTP_ADDR`: private bind address, default `127.0.0.1:8081`.
- `GARMIN_TOKEN_ROOT`: token root, default `/var/lib/health-hub/garmin`.
- `GARMIN_OUTPUT_ROOT`: activity package root, default `/var/lib/health-hub/activities`.

Manual sync is reserved in PostgreSQL before background dispatch. A unique partial index prevents parallel running syncs for the same Garmin connection.

## Operations

The API exposes:

- `GET /health/live` for process liveness;
- `GET /health/ready` for PostgreSQL readiness.

The server has explicit header, read, write, idle, and request-body limits. It emits JSON logs without request bodies, login codes, session tokens, Garmin credentials, or medical payloads. An hourly cleanup removes expired codes and expired or old revoked sessions.

Use TLS at the reverse proxy. Preserve the original client address only from configured trusted proxy networks. Do not use wildcard CORS with credentialed requests.
