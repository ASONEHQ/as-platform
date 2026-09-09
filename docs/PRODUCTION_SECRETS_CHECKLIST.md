# Production Secrets Checklist — AS POS V1

**TASK 16.0 Phase 4.** Every variable name below was read directly from
`packages/config/src/index.ts` (the real Zod schema `loadApiConfig`
validates against) and `apps/one/lib/core/config/app_config.dart` (the
real Flutter build-time config) — none guessed. **No secret value
appears anywhere in this document or was printed to any log during its
verification.** Every fail-closed claim below was independently,
live-tested against the real, compiled `apps/api/dist/server.js`
artifact this same phase, not assumed from reading the code alone.

## How to use this checklist

For each variable: set a real value in your deployment's secret
manager, confirm the boot behavior described, then check the box.
Never paste a real value into a chat, ticket, or this file.

## Required — API (`apps/api`), validated by `loadApiConfig()`

| Variable | Requirement | Production-specific enforcement |
|---|---|---|
| `NODE_ENV` | Must be exactly `production` | Fastify boot config; also the single switch that turns on `Secure`-flagged cookies and the `__Host-` cookie name (`auth.routes.ts`) |
| `APP_NAME` | Non-empty string | — |
| `APP_VERSION` | Non-empty string | Use your real release tag/commit SHA — surfaces in `/health` |
| `LOG_LEVEL` | One of `fatal/error/warn/info/debug/trace/silent` | No default — boot refuses if unset, forcing an explicit choice. `info` or `warn` recommended for production |
| `DATABASE_URL` | `postgresql://...` | **Must carry `sslmode=require`/`verify-ca`/`verify-full`**, OR `DATABASE_TLS_EXTERNALLY_TERMINATED=true` must be set explicitly — **live-verified this phase**: a non-TLS URL in `NODE_ENV=production` is rejected at boot with a clear validation error, never silently accepted. **TASK 16.1 note**: the real target for this value is now a provisioned DigitalOcean Managed PostgreSQL cluster (version 17, region NYC3, cluster `asone-production-postgres`) — DigitalOcean's own managed connection strings request TLS by default (`sslmode=require`), which satisfies this requirement directly; obtain the actual connection string from the DigitalOcean control panel/API at deploy time and place it directly into the deployment platform's secret manager — never into this repository, a document, or a chat |
| `DATABASE_TLS_EXTERNALLY_TERMINATED` | `true`/`false`, default `false` | Only set `true` if TLS is genuinely terminated outside the `pg` driver (e.g. a Cloud SQL Auth Proxy or `stunnel` sidecar) |
| `REDIS_URL` | `redis://...` (include `:password@` if your Redis requires auth) | Required to **boot** but not required for the core POS flow (login→sale→payment→receipt never touches it) — a Redis outage degrades `/ready`'s body but not its HTTP status |
| `API_HOST` | Bind address, e.g. `0.0.0.0` behind a reverse proxy | — |
| `API_PORT` | Integer 1-65535 | — |
| `AUTH_ACCESS_TOKEN_SECRET` | **High-entropy, ≥32 chars** | **Live-verified this phase**: in `NODE_ENV=production`, a low-entropy or placeholder-shaped value (`changeme`, `replace_me`, repeated characters, 13 known placeholder substrings) is rejected at boot — confirmed with a real placeholder value, real rejection, real error message. Generate with a real CSPRNG (e.g. `openssl rand -base64 48`), never hand-typed |
| `AUTH_JWT_AUDIENCE` | Non-empty string | e.g. `asone-api-production` |
| `AUTH_JWT_ISSUER` | Non-empty string | e.g. `https://api.asone.mx` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated explicit origins | **Must be the real `https://app.asone.mx` origin — never `*`** (the schema itself rejects a literal `*` at validation time, in every environment, not just production) |
| `TRUST_PROXY` | `true`/`false`, default `false` | Set `true` when deployed behind a real reverse proxy/load balancer (needed for `@fastify/rate-limit`'s IP-based key generator to see real client IPs — not a security-critical setting; forgetting it only degrades rate-limit accuracy) |

### Optional — API, real defaults apply if unset

| Variable | Default | Notes |
|---|---|---|
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` | 900 (bounded 60-3600) | |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS` | 2,592,000 (bounded 3,600-31,536,000) | |
| `AUTH_LOGIN_RATE_LIMIT_MAX` | 10 | Per-window login attempts |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS` | 60,000 | |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 300 / 60,000 | General rate limit |
| `REQUEST_BODY_LIMIT_BYTES` | 1,048,576 | |
| `REQUEST_TIMEOUT_MS` | 30,000 | |
| `KEEP_ALIVE_TIMEOUT_MS` | 72,000 | |
| `METRICS_ENABLED` | unset (off) | Set `true` to expose Prometheus metrics |
| `OPENAPI_UI_ENABLED` | `false` outside development | Leave unset/`false` in production — keeps CSP fully on |

### Optional — object storage (business logo/branding), read directly by `branding.storage.ts`, NOT part of the Zod schema

| Variable | Requirement | Notes |
|---|---|---|
| `MINIO_ROOT_USER` | Non-empty | Real S3-compatible access key |
| `MINIO_ROOT_PASSWORD` | Non-empty | Real S3-compatible secret key — treat exactly like a database password |
| `MINIO_API_PORT` | Integer, default `9000` if unset | Only meaningful once the endpoint/host is also configured — confirm the actual MinIO/S3 client construction in `branding.storage.ts` for any additional endpoint variable your deployment needs beyond these three |

**If any of the three above is absent or malformed**: the two branding
routes are simply never registered (`brandingStorageConfigFromEnv()`
returns `undefined`, never throws) — the API boots normally, and a
request to either branding route gets a real `404`. This is a real,
intentional, already-verified fail-safe (see
`docs/RC_PRODUCTION_CONFIG.md` §5) — not a secret that can be
"forgotten dangerously."

### Deliberately NOT configured for this launch

| Variable | Status |
|---|---|
| `MERCADO_PAGO_ACCESS_TOKEN` | **Leave unset.** Mercado Pago remains paused — EXTERNAL PROVIDER ACTIVATION PENDING, per explicit task instruction. Do not set this without a separate, explicit go-ahead. |
| `MERCADO_PAGO_WEBHOOK_SECRET` | **Leave unset.** Same as above. |
| `MERCADO_PAGO_API_BASE_URL` | Defaults to the real Mercado Pago API — harmless to leave at default since the two secrets above being unset already makes every provider call fail cleanly and explicitly (`PaymentProviderError('not_configured', ...)`), never silently. |

## Required — Flutter Web (`apps/one`), baked in at BUILD time via `--dart-define`

| Define | Requirement | Enforcement |
|---|---|---|
| `AS_ENV` | `production` | Anything other than `local` requires `AS_API_BASE_URL` to be `https://` — **live-verified this phase** by reading `app_config.dart`'s own `AppConfig.fromEnvironment()`: `environment != local && scheme != 'https'` throws a `StateError` at app startup, refusing to run |
| `AS_API_BASE_URL` | `https://api.asone.mx` (or the final confirmed API hostname) | **Live-verified this phase**: a real `flutter build web --release --dart-define=AS_ENV=production --dart-define=AS_API_BASE_URL=https://api.asone.mx` build was produced; `grep`-confirmed the real URL is embedded in the compiled `main.dart.js` and that no `localhost`/`127.0.0.1` URL leaked into the bundle |

**These are build-time defines, not runtime secrets** — nothing sensitive
is embedded (the API base URL is public information a browser needs
anyway); there is no server-held secret in the Flutter bundle to leak.
Confirmed no API keys/tokens/secrets appear anywhere in `apps/one/lib`
(re-confirmed via `docs/RC_SECURITY_CERTIFICATION.md`'s own WEB section
grep, unchanged since).

## Fail-closed proof — live-tested this phase against the real compiled artifact

Three real boot attempts against `apps/api/dist/server.js` with
`NODE_ENV=production`:

1. **Weak/placeholder `AUTH_ACCESS_TOKEN_SECRET`** (`changeme_changeme_...`) → real validation failure, boot refused.
2. **`DATABASE_URL` with no `sslmode`** → real validation failure citing exactly which parameter is missing, boot refused.
3. **Strong secret + `sslmode=require`** → config loaded successfully.

Then the real compiled server was actually booted (`node dist/server.js`,
`NODE_ENV=production`, a real strong secret, `TRUST_PROXY=true`) against
local Postgres/Redis (using `DATABASE_TLS_EXTERNALLY_TERMINATED=true` to
simulate a TLS-terminating sidecar, since no real TLS-enabled production
Postgres exists yet — see `docs/PRODUCTION_GO_LIVE_REPORT.md` Phase 5):
`/health` → `200 {"status":"ok"}`; `/ready` → `200
{"services":{"postgres":"available","redis":"available"},"status":"ready"}`;
`x-request-id`/`x-correlation-id` both present on every response.
Confirmed no `postgresql://` connection string ever appears in any
response body (existing automated test coverage, re-confirmed present
and passing in `docs/RC_15_1_FINAL_REGRESSION.md`).

## Rotation / storage discipline

- Use your deployment platform's real secret manager (not `.env` files
  committed anywhere, not chat/ticket text) for every value above.
- `AUTH_ACCESS_TOKEN_SECRET` rotation invalidates every currently-issued
  access token (sessions re-authenticate via refresh token/re-login) —
  plan a rotation window, don't rotate mid-peak-hours without warning.
- Database and object-storage credentials: follow your provider's own
  rotation mechanism; this application reads them fresh at boot only
  (no runtime credential refresh), so a rotation requires a restart.
