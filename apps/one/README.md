# AS ONE Web

Production-oriented Flutter Web entry point for the AS ONE platform. The application integrates the real browser authentication, company and branch context contracts; it does not contain AS POS or business dashboard features.

## Architecture

- `app/`: bootstrap, root application and guarded URL routing.
- `core/`: validated configuration, typed networking, safe errors, memory-only token storage, telemetry and shell primitives.
- `design_system/`: centralized AS colors, spacing, radii, motion, breakpoints, theme and shared components.
- `features/`: authentication/context foundations and the read-only dashboard shell.

The application uses one Flutter-native `ChangeNotifier` authentication controller as the authoritative owner of session state. `go_router` provides guarded, deep-link-ready routing. `http` is wrapped behind an injectable typed client, while Flutter Web uses `BrowserClient.withCredentials=true` so the browser can transport HttpOnly cookies. No second state-management or routing framework is used.

## Visual identity

The implementation formalizes the existing premium blue-and-white AS hierarchy: deep-blue navigation, white content surfaces, restrained elevation, rounded geometry and high information clarity. Typography uses Flutter's legally safe system/platform typography; no proprietary font is redistributed.

No approved AS ONE logo file exists in this repository. `AsAppLogo` is an adapter with a text fallback. Replace it only when the official SVG or transparent PNG and usage rules are supplied; do not redraw the mark.

## Commands

From `apps/one`:

```powershell
flutter pub get
flutter analyze
flutter test
flutter build web --release --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://127.0.0.1:3000
flutter run -d chrome --web-hostname=127.0.0.1 --web-port=8080 --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://127.0.0.1:3000
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
- The production `__Host-asone_refresh` cookie is host-only, `Secure`, `HttpOnly`, `SameSite=Strict` and uses `Path=/`.
- No token is written to local storage, shared preferences, URL state or logs.
- CSRF proofs remain in memory and are sent as `X-CSRF-Token` only where the browser contract requires them.
- The API client supports bearer access tokens, correlation IDs, canonical error envelopes and bounded timeouts. A safe GET may retry once after refresh; mutations never retry automatically.
- Refresh is single-flight. Concurrent callers await the same operation, and expiry, revocation or reuse clears local credentials.

## Real authentication flow

The browser flow uses these backend contracts:

| Contract | Endpoint | Purpose |
| --- | --- | --- |
| E164 | `POST /api/v1/auth/browser-bootstrap` | Recover a short-lived CSRF proof from the HttpOnly refresh cookie without rotating it |
| E002 | `POST /api/v1/auth/refresh` | Rotate the cookie generation and hydrate access/CSRF/session context |
| E001 | `POST /api/v1/auth/login` | Authenticate directly or issue a multi-company challenge |
| E161 | `POST /api/v1/auth/company-selections` | Consume the in-memory login challenge |
| E162 | `POST /api/v1/auth/company-switches` | Replace the authenticated company context |
| E163 | `POST /api/v1/auth/branch-switches` | Replace the branch or authorized corporate context |
| E003 | `POST /api/v1/auth/logout` | Revoke the session and clear the browser cookie |
| E008/E009 | `GET /api/v1/context/companies`, `GET /api/v1/context/branches` | Discover server-authoritative switch targets and explicit branch scope |

After any successful authentication response, the application hydrates safe identity, session, permissions, eligible companies and branches through the approved read contracts. An empty branch list never implies corporate access; `company_wide_access` is authoritative.

The multi-company challenge token exists only in controller memory. Reloading while selection is pending intentionally returns the user to login in V1.

## Authentication state machine

Explicit phases are `bootstrapping`, `unauthenticated`, `authenticating`, `companySelectionRequired`, `selectingCompany`, `branchSelectionRequired`, `selectingBranch`, `authenticated`, `refreshing`, `expired`, `revoked`, `unavailable` and `failure`. Router redirects derive exclusively from this state and prevent protected deep links, missing-challenge selection and redirect loops.

## Routing and responsive behavior

Routes cover bootstrap, login, company selection, branch selection, authenticated dashboard, session-ended and unavailable/not-found states. Guards react to the authentication state without putting credentials or challenges in URLs.

The shell uses persistent side navigation on desktop, compact navigation on tablet and a drawer with touch-safe controls on mobile. Tests cover 390 px, 820 px and 1440 px viewports.

## Local development notes

- Text logo adapter pending approved brand asset.
- Use the same hostname label for Flutter and the local API (`127.0.0.1`) so `SameSite=Strict` behaves consistently. The tracked local example allows exactly `http://127.0.0.1:8080`; staging and production must provide their own explicit origin allowlists.
- Provision the local database-backed owner through `pnpm.cmd --filter @asone/api dev:bootstrap-owner` after setting the ignored `AS_DEV_BOOTSTRAP_PASSWORD`. The local identifier is `ceo@inflapark.local`; no password is stored in this repository.
- No test credentials are stored in the repository. Use ephemeral local fixtures.
- Telemetry is provider-neutral and records only safe event names/classifications; identifiers, names and credentials are excluded.
- The authenticated dashboard remains an honest shell with session, connectivity, context and permission information only.

TASK 10.5 may add the next approved visible product slice. Deployment, realtime, POS, Rewards+, business KPIs and persistence of authentication secrets remain outside this block.
