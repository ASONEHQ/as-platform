# AS ONE Web

Production-oriented Flutter Web foundation for the AS ONE platform. This application is the future authenticated entry point for company and branch operations; it does not contain AS POS or production authentication integration.

## Architecture

- `app/`: bootstrap, root application and guarded URL routing.
- `core/`: validated configuration, typed networking, safe errors, memory-only token storage, telemetry and shell primitives.
- `design_system/`: centralized AS colors, spacing, radii, motion, breakpoints, theme and shared components.
- `features/`: authentication/context foundations and the read-only dashboard shell.

The application intentionally uses Flutter-native `ChangeNotifier` for its small authentication state machine. `go_router` provides guarded, deep-link-ready routing. `http` is wrapped behind an injectable typed client so tests require no live backend. No second state-management or routing framework is used.

## Visual identity

The implementation formalizes the existing premium blue-and-white AS hierarchy: deep-blue navigation, white content surfaces, restrained elevation, rounded geometry and high information clarity. Typography uses Flutter's legally safe system/platform typography; no proprietary font is redistributed.

No approved AS ONE logo file exists in this repository. `AsAppLogo` is an adapter with a text fallback. Replace it only when the official SVG or transparent PNG and usage rules are supplied; do not redraw the mark.

## Commands

From `apps/one`:

```powershell
flutter pub get
flutter analyze
flutter test
flutter build web --release --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://localhost:3000
flutter run -d chrome --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://localhost:3000
```

The current Windows installation is at `C:\src\flutter\bin\flutter.bat` if a shell has not yet inherited the updated `PATH`.

## Environments

Compile-time configuration uses non-secret `--dart-define` values:

| Define | Values / behavior |
| --- | --- |
| `AS_ENV` | `local`, `test`, `staging`, `demo`, `production` |
| `AS_API_BASE_URL` | Absolute API URL; HTTPS is mandatory outside `local` |
| `AS_APP_NAME` | Visible application name; defaults to `AS ONE` |
| `AS_ENABLE_TELEMETRY` | Boolean feature gate; no external provider is installed |

Production domains are never active defaults and secrets must never be supplied through Dart defines.

## Browser security and storage

- Access tokens live in `MemoryTokenVault` only and disappear on reload.
- Browser refresh tokens are never exposed to Dart or persisted; the browser transports the backend's HttpOnly cookie.
- No token is written to local storage, shared preferences, URL state or logs.
- The API client supports bearer access tokens, correlation IDs, CSRF headers, canonical error envelopes and bounded timeouts. It performs no automatic mutation retry.
- Future refresh coordination must serialize 401 recovery and terminate on revocation or reuse.

## Routing and responsive behavior

Routes are reserved for bootstrap, login, company selection, branch selection, dashboard and unavailable/not-found states. Guards react to the authentication state without putting credentials or challenges in URLs.

The shell uses persistent side navigation on desktop, compact navigation on tablet and a drawer with touch-safe controls on mobile. Tests cover 390 px, 820 px and 1440 px viewports.

## Current placeholders

- Text logo adapter pending approved brand asset.
- Login form is intentionally disabled.
- Company and branch selection contain no mock organizations.
- Dashboard cards contain no fake business metrics.
- API status and telemetry providers are not connected.

TASK 10.4 will connect E001/E002/E161-E163, browser cookies and CSRF, session bootstrap, company/branch selection, refresh coordination and logout. Deployment, realtime, POS, Rewards+ and business dashboard data remain outside this application block.
