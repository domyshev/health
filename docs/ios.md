# iPhone application

Health Hub bundles its existing React dashboard inside Capacitor's WKWebView.
The Go API, PostgreSQL database, and Garmin importer remain on the server. The
app requires a network connection; offline sync, HealthKit, background sync,
notifications, and App Store distribution are outside this implementation.

The Xcode project is `web/ios/App/App.xcodeproj`. The bundle identifier is
`com.domyshev.health`, the display name is **Health Hub**, and the deployment
target is iOS 15 or later, iPhone only.

## Prepare and run

Use macOS, Xcode with an installed iOS simulator runtime, and Node 22 or later.
From `web/`:

```sh
npm ci
npm run ios:prepare
npm run ios:build
# Boot an iPhone using Xcode's Simulator before running this command.
npm run ios:run
```

The default API is `https://health.domyshev.com`. To use another deployed API:

```sh
VITE_NATIVE_API_URL=https://your-api.example npm run ios:prepare
```

If the API and website use different hosts, set `VITE_NATIVE_REQUEST_ORIGIN` to
an origin already allowed by the API's `APP_ORIGINS`. It defaults to the API
origin. Both values are public build configuration, never credentials. They must
be HTTPS origins without paths, credentials, query parameters, or fragments.

The scripts use `/Applications/Xcode.app/Contents/Developer` by default; override
`DEVELOPER_DIR` for another Xcode installation. Set `IOS_SIMULATOR_UDID` when
multiple simulators are booted. The CLI build resolves public packages without
Keychain access or Git credential helpers and refuses to run if a `.netrc` or
`_netrc` credential file exists. In that case, build in Xcode using your own
package authentication configuration.

For a physical iPhone, run `npm run ios:open`, select your Apple signing team in
Signing & Capabilities, choose the connected phone, and run from Xcode. No signing
team or provisioning profile is committed. App Store/TestFlight distribution
still requires Apple signing, App Store Connect setup, privacy disclosures, and
physical-device verification.

## Local API development

Start a separate local Go API using the documented development configuration and
an isolated development database. Never reuse retired sandbox credentials or data.
Then prepare a simulator build:

```sh
VITE_NATIVE_API_URL=http://127.0.0.1:8080 \
VITE_NATIVE_REQUEST_ORIGIN=http://127.0.0.1:5173 \
npm run ios:prepare -- --development
npm run ios:build
npm run ios:run
```

Only loopback HTTP is accepted in development. Loopback reaches the Mac from the
simulator, but refers to the phone itself on a physical device; use the deployed
HTTPS API on a real phone. Local cookie security and allowed origins must match
the development API configuration. This mode does not enable mock authentication.
Release builds reject development bundles or missing native build metadata.
Run `npm run ios:prepare` again before archiving a production version.

## Runtime behavior and security

- API calls use CapacitorHttp and native URLSession, including the existing Origin
  validation and server-managed session cookies. Browser requests remain same-origin.
- Cookies stay in native cookie storage. No session token, Garmin password, MFA
  code, or health response is persisted in browser storage. The existing activity
  filter preference remains the only persisted UI state.
- API requests are restricted to the configured host and `/v1/` paths. Redirects
  are disabled. Native HTTP cannot be canceled after dispatch; canceled responses
  are discarded. The native library uses its connection timeout for URLSession.
- External HTTP links open in Safari View Controller. Internal routes remain in
  the app. Safe-area padding protects the status bar, home indicator, drawers,
  and dialogs; the keyboard resizes the web content.
- The native icon and launch artwork reuse the dashboard's green monitor/pulse
  visual. The status bar matches the current dark theme.
- The privacy manifest declares no tracking and no directly accessed required
  reason APIs. Revisit it when adding native storage, device APIs, or plugins.
  Store privacy disclosures must separately describe the server's actual data use.

Generated bundles, native configuration, simulator builds, and personal Xcode
state are ignored. Run `ios:prepare` after changing the frontend or native plugins.
A normal `npm run build` produces the website; it does not update the iOS bundle.
Keep `MARKETING_VERSION` in the Xcode project aligned with `web/package.json`, and
increment `CURRENT_PROJECT_VERSION` for each distributed iOS build.

## Verification

The implementation was checked with frontend type checking, lint, API schema
consistency, six browser end-to-end checks (two platform-specific cases skipped),
and unit tests covering native API origin validation, JSON requests,
API errors, logout responses, and canceled requests. The unsigned Debug app built
with Xcode 27.1 and launched on an iPhone 18 Pro Max simulator running iOS 27.
The bundled WebView loaded the login page and native HTTP reached the production
`/v1/me` endpoint, receiving the expected unauthenticated 401 response. One simulator
launch stalled in WebView loading; reinstall/relaunch restored normal startup.
A signed Debug build was also successfully built, installed, and launched on a
physical iPhone 15 Pro Max using the existing Apple development team.
Authenticated production login, native cookie persistence across relaunch, Garmin
MFA on iOS, physical-device keyboard behavior, and distribution require further
verification with the intended account and device.

On Node 26, jsdom 27 needs the Node web-storage feature disabled for unit tests:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm run check
```

CI uses Node 24 and can continue using `npm run check` directly.
