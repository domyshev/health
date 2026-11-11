# Health Hub web client

React 19 personal dashboard for the Health Hub Go API. The application uses only same-origin `/v1` requests and relies on the API's Secure, HttpOnly session cookie. It never stores session tokens, Garmin passwords, MFA codes, challenges, OAuth data, or health API responses in browser storage.

## Development

Prerequisites: Node.js 20.19 or newer and npm.

```bash
cd web
npm ci
npm run generate:api
npm run dev
```

Vite proxies `/v1` and `/health` to `http://127.0.0.1:8080` in development. Run the Go API separately.

## Verification

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

Playwright uses mocked API responses. It does not contact Garmin or Resend. On a new Linux environment, install the browser and system dependencies once:

```bash
npx playwright install --with-deps chromium
```

API types in `src/api/schema.d.ts` are generated from `../docs/openapi.yaml`. Regenerate them whenever the public contract changes.

## Browser storage

`redux-persist` stores only the versioned activity-filter preference under the `persist:health-hub:ui` key. RTK Query cache and all user/API data remain in memory. Logout resets the API cache and the persisted UI preference after the server session is revoked.

## Production deployment

Build reproducibly from `package-lock.json`:

```bash
npm ci
npm run check
```

Serve `web/dist/` from the same HTTPS origin as the Go API. Requests to `/v1` and `/health` must be reverse-proxied to the API. The example `deploy/nginx/health-hub.conf` includes SPA fallback and conservative static-asset caching.

## Theme status

The MUI theme uses centralized **temporary semantic defaults**. No SportApp asset catalog, approved color table, or screenshots were available in the repository or workspace, so these values are not represented as the final SportApp palette. Replace only the tokens in `src/theme.ts` after a source of truth is supplied, then rerun contrast and responsive checks.

## iPhone application

Run `npm run ios:prepare`, `npm run ios:build`, and `npm run ios:run` to prepare,
build, and launch the Capacitor app in a booted iPhone simulator. The API and
Garmin importer remain server-side. See [the iPhone guide](../docs/ios.md) for
configuration, signing, development API usage, and verification limits.
