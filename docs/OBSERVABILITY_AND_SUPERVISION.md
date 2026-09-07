# AS ONE — Observability and Process Supervision (TASK 14.1 §M+N)

Launch-minimum operator guidance for AS POS: what already exists in code
(this section documents no new behavior), and the simplest credible process
supervision strategy for a single-VM, single-store launch given what this
repository actually contains today. See
[PRODUCTION_GAPS.md §7-8](PRODUCTION_GAPS.md) for the underlying audit and
[MONITORING.md](MONITORING.md)/[OPERATIONAL_RUNBOOKS.md](OPERATIONAL_RUNBOOKS.md)
for the broader (aspirational, platform-scale) monitoring design this
document does not replace — this document is deliberately narrower: what a
single operator checks at 2 a.m. during AS POS's launch window, grounded in
log lines and endpoints that exist right now.

---

## Part 1 — Observability (what already exists)

### 1.1 Structured logging

`packages/logger/src/index.ts` configures Pino with:

- An explicit `redact` list (`sensitivePaths`, lines 3-20) covering
  `authorization`, `cookie`, `password`, `access_token`, `refresh_token`,
  `token`, `secret`, `api_key`, `database_url`, `redis_url`, and header/query
  path variants (`headers.authorization`, `request.headers.cookie`, `query`,
  `request.query`, `req.query`, etc.).
- Custom `req`/`res` serializers (lines 40-50) that emit **only** `method`,
  `path` (query string stripped via `.split('?', 1)[0]`), and `status` — no
  request bodies are ever serialized into logs, redacted or otherwise,
  because nothing hands the raw body to the logger.
- ISO-8601 UTC timestamps (`pino.stdTimeFunctions.isoTime`) and a `base`
  object carrying `service` (`config.appName`).

Fastify's own automatic request logging is disabled
(`apps/api/src/bootstrap/create-app.ts:21`: `new LogController({
disableRequestLogging: true })`) in favor of one custom completion log per
request. Per [PRODUCTION_GAPS.md §8](PRODUCTION_GAPS.md#8-logging), no
sensitive-data logging path exists in this codebase.

### 1.2 Request-ID / correlation-ID propagation

`apps/api/src/plugins/request-context.ts`:

- `onRequest` (lines 39-44) builds a `RequestContext` — `requestId` (from a
  validated `x-request-id` header or a fresh `randomUUID()`),
  `correlationId` (same pattern from `x-correlation-id`), plus
  `companyId`/`branchId`/`userId`/`sessionId`/`deviceId` slots populated
  later by auth — and echoes `x-request-id` back on the response
  (`reply.header('x-request-id', ...)`).
- `onResponse` (lines 46-60) logs **exactly one line per request**, message
  `'request completed'`, with fields `correlation_id`, `duration_ms`
  (`reply.elapsedTime`), `method`, `request_id`, `route` (the matched route
  template, or `'unmatched'`), and `status`.

This is the single most useful log line for "is the API healthy right now" —
filter it by `route` and `status` to see per-endpoint volume and failure
rate without touching any request/response body.

### 1.3 Error-path logging

`apps/api/src/plugins/error-handler.ts`:

- Any `AppError` (a deliberate, coded application error — validation
  failures, auth failures, business-rule rejections) is converted to its
  JSON envelope and returned; **it is not separately logged** beyond the
  standard `'request completed'` line from §1.2 (its `status` field will
  show the error's HTTP status code). This matters for §1.6 below.
- Any genuinely unexpected error (not an `AppError`, not a known validation/
  transport error) hits the fallback branch (lines 111-119): it increments
  `observability.errors` with `code: 'internal_error'`, logs one line at
  `error` level with message `'request failed'` and fields `correlation_id`,
  `err` (full error via Pino's `err` serializer), `request_id`, then returns
  a generic `500` envelope to the client. **`'request failed'` in the logs
  always means an unhandled/unexpected server error**, not a normal
  validation/auth rejection.

### 1.4 Metrics

`apps/api/src/plugins/observability.ts` registers a `prom-client` `Registry`
with:

- `asone_http_requests_total{method,route,status}` and
  `asone_http_request_duration_seconds{method,route,status}` — recorded on
  every response via an `onResponse` hook (lines 55-64).
- `asone_http_errors_total{code}` — incremented from `error-handler.ts` for
  every error class (`validation_error`, `rate_limit_exceeded`,
  `payload_too_large`, `method_not_allowed`, `not_found`, `internal_error`,
  or any `AppError`'s own `code`).
- `asone_readiness_dependency{service="postgres"|"redis"}` — a gauge set on
  every `/ready` call (§1.5).
- Operational metrics from `apps/api/src/operations/operational-metrics.ts`
  (outbox/backup/restore-related; not detailed here).

**`/metrics` is not exposed unconditionally.** `config.metricsEnabled`
(`packages/config/src/index.ts:187-188`) defaults to `true` only when
`NODE_ENV === 'development'`; in every other environment, including
production, it is `false` unless `METRICS_ENABLED=true` is explicitly set.
**Operational requirement**: a production deploy that wants Prometheus
scraping must set `METRICS_ENABLED=true` — otherwise `/metrics`
(`observability.ts:66-81`) is simply never registered, and Prometheus gets a
404, not an error.

### 1.5 Health and readiness

`apps/api/src/routes/health/index.ts` defines three endpoints (all
`rateLimit: false`):

- `GET /health` — static `{name, status: 'ok', version}`, no dependency
  check.
- `GET /live` — `{status: 'alive'}`, pure liveness, no dependency check.
- `GET /ready` — calls `infrastructure.checkReadiness()`
  (`apps/api/src/infrastructure/dependencies.ts:43-56`), which runs
  `database.check()` (`SELECT 1`) and a Redis `PING` in parallel via
  `Promise.allSettled`, and reports **both** independently in the response
  body's `services` object and as separate `asone_readiness_dependency`
  gauge values. The HTTP status code, however, gates on **Postgres only**
  (`health/index.ts:81`: `const ready = services.postgres === 'available'`)
  — a Redis-only outage reports `services.redis: 'unavailable'` in the body
  but still returns `200`, per the fix already landed and explained in the
  route's own comment (lines 71-80), which cites
  [PRODUCTION_GAPS.md §7](PRODUCTION_GAPS.md#7-healthreadiness): the core POS
  flow (login → sale → payment → receipt) never touches Redis.

### 1.6 Audit trail (business/security evidence, separate from logs)

Two modules write to the `audit_log` Postgres table directly (not to Pino) —
this is the durable, queryable record for "who did what," distinct from the
per-request log line in §1.2:

- **Auth** — `AuthRepository.audit()` (`apps/api/src/modules/auth/
  auth.repository.ts:316-342`) inserts one row per call with
  `actor_type='user'`, `action`, `entity_type='session'`, `entity_id`,
  `request_id`, `correlation_id`. `apps/api/src/modules/auth/auth.service.ts`
  calls it for: `auth.login_succeeded` (line 139),
  `auth.company_selection_required` (line 183), `auth.company_selected`
  (line 309), `auth.refresh_reuse_detected` (lines 361, 398 — a genuine
  security signal, written whenever a stale/already-rotated refresh token is
  presented), `auth.token_refreshed` (line 421), `auth.company_switched`
  (line 539), `auth.branch_switched` (line 592), `auth.logout` (line 620),
  `auth.logout_all` (line 641).
  **Failed login attempts are not audited.** `beginLogin`
  (`auth.service.ts:147-155`) throws `authError('invalid_credentials')`
  before any `audit()` call when the password check fails — by design, to
  avoid distinguishing "wrong password" from "unknown user" in any durable
  record (the same dummy-hash-verify pattern that prevents user enumeration
  via timing). A failed login is therefore visible only as a
  `'request completed'` log line (§1.2) with `route:
  '/api/v1/auth/login'` and `status: 401`, never as an `audit_log` row.
- **Sales** — `apps/api/src/modules/sales/sales.service.ts` calls
  `repository.auditAndPublish()` for `sale.created` (line 449) and
  `sale.cancelled` (line 599) — this writes both an `audit_log` row and a
  transactional-outbox row (`event_type: 'sale.created'`/`'sale.cancelled'`)
  in the same database transaction as the sale itself, matching the outbox
  contract in [REALTIME_EVENTS.md §3](REALTIME_EVENTS.md#3-architecture-and-publication).

### 1.7 Startup logging — a documented current gap, not a fix

`apps/api/src/server.ts:10-18`:

```ts
try {
  config = loadApiConfig();
} catch {
  process.stderr.write('API configuration is invalid.\n');
  process.exitCode = 1;
  return;
}
```

**The caught error's own message/detail is discarded.** An operator sees
only the literal string `"API configuration is invalid."` on stderr — never
which environment variable was missing or failed Zod validation (e.g. a
placeholder `AUTH_ACCESS_TOKEN_SECRET`, a malformed `DATABASE_URL`, a
missing `AUTH_JWT_AUDIENCE`). This document does not fix it (out of scope for
a docs-only pass, and the fix belongs with the code review that owns
`server.ts`) — it is recorded here because it directly affects the "API
won't start" runbook in §2.1 below: today, the honest operator answer to
"why won't it start" is *"check every required variable by hand against
`packages/config/src/index.ts`'s `apiSchema`"*, not *"read the error."*

If `loadApiConfig()` succeeds but `app.listen()` itself fails (port already
bound, insufficient permission on a privileged port, etc.),
`server.ts:44-51` logs a **full, structured** fatal line: `logger.fatal({err:
error}, 'server startup failed')`, then attempts graceful shutdown. That
path does not lose the error detail — only the config-validation path does.

---

## Part 2 — Operator guidance (grounded in the above, nothing invented)

| Symptom | What to check | Where it comes from |
| --- | --- | --- |
| API won't start | stderr/journal for `"API configuration is invalid."` (config problem — no detail given, see §1.7) vs. a structured `fatal` log with message `"server startup failed"` and a full `err` object (listen-time problem, e.g. port conflict) | `apps/api/src/server.ts:10-18`, `:44-51` |
| DB is unavailable | `GET /ready` → `503`, body `services.postgres: "unavailable"`; Prometheus `asone_readiness_dependency{service="postgres"} == 0` | `apps/api/src/routes/health/index.ts:69-95` |
| Redis is unavailable | `GET /ready` still returns `200` (Postgres-gated only), but body shows `services.redis: "unavailable"` and the gauge for `service="redis"` drops to `0` — core POS flow (login/sale/payment/receipt) is unaffected per §1.5 | same file, lines 81-89; [PRODUCTION_GAPS.md §6-7](PRODUCTION_GAPS.md) |
| Login is failing | Filter `'request completed'` logs to `route: '/api/v1/auth/login'`, `status != 200` for volume/timing (no credential detail by design). For *successful* auth-flow anomalies (token reuse, company/branch switches), query `audit_log` for `action LIKE 'auth.%'`, especially `auth.refresh_reuse_detected` — a real reuse-detection security signal | `apps/api/src/plugins/request-context.ts:46-60`; `apps/api/src/modules/auth/auth.repository.ts:316-342`; `auth.service.ts` call sites listed in §1.6 |
| Sales are failing | (a) Confirm `/ready`'s `services.postgres` first — sales are Postgres-only (§1.5). (b) Filter `'request completed'`/`'request failed'` logs to sale routes and `asone_http_errors_total{code}` for the specific error code being returned. (c) Query `audit_log` for `action IN ('sale.created','sale.cancelled')` to confirm whether commits are actually landing | `apps/api/src/modules/sales/sales.service.ts:449,599`; `apps/api/src/plugins/error-handler.ts:111-119` |
| Need to confirm secrets/PII aren't leaking into logs | Already verified, not something to re-check per incident — see §1.1 and [PRODUCTION_GAPS.md §8](PRODUCTION_GAPS.md#8-logging) | `packages/logger/src/index.ts` |

---

## Part 3 — Process supervision

### 3.1 What actually exists to build on

- **No `Dockerfile` exists anywhere in the repository** (confirmed by a
  repo-wide search). `compose.yaml` exists but defines **only local
  development dependency containers** — `postgres`, `redis`, `minio`,
  `mailpit` — with no `api` or `worker` service block, and its network/volume
  names (`asone-local-internal`, `asone-local-postgres-data`, etc.) plus its
  own header comment ("local-development-only") make clear it is not
  production-adaptable as written. There is no CI workflow directory
  (`.github/` does not exist in this worktree) that might otherwise reveal an
  intended container build step.
- The actual production entry point is already a plain, already-working Node
  process: `node apps/api/dist/server.js` (confirmed to exist and run per
  [DEPLOYMENT_PACKAGING.md §1.1](DEPLOYMENT_PACKAGING.md)), which already
  handles `SIGINT`/`SIGTERM` gracefully
  (`apps/api/src/bootstrap/shutdown.ts:43-48,58-59`: both signals call the
  same `shutdown()` routine that closes the Fastify app, closes DB/Redis
  connections, and flushes the logger, bounded by `config.requestTimeoutMs +
  5_000` ms — `server.ts:41`) and exits with code `1` on an uncaught
  exception or unhandled rejection (`shutdown.ts:49-56`).

### 3.2 Recommendation: systemd, not Docker Compose

For a single-VM, single-store AS POS launch, **a systemd unit is the simplest
approach that matches what this repository actually contains** — not Docker
Compose, and not Kubernetes (explicitly out of scope per the task). The
justification is evidence-based, not a default preference:

- Building a Compose-based production deployment would require *inventing*
  new `Dockerfile`s for `apps/api` and `apps/worker` that do not exist today
  — a real code/infrastructure addition, which this documentation-only task
  is not positioned to create or silently assume.
- [DEPLOYMENT.md §Initial topology](DEPLOYMENT.md#initial-topology) itself
  only commits to "Docker Compose supports local development and the initial
  non-complex deployment stage" — it does not claim compose already covers
  the API/worker processes, and it doesn't; today it covers infrastructure
  dependencies only.
- systemd needs nothing this repo doesn't already produce: `pnpm build` (see
  [DEPLOYMENT_PACKAGING.md §1](DEPLOYMENT_PACKAGING.md)) already yields a
  directly-runnable `node dist/server.js` process that already speaks the
  standard POSIX signal contract systemd expects.

### 3.3 Sketch of the unit files

```ini
# /etc/systemd/system/asone-api.service
[Unit]
Description=AS ONE API
After=network-online.target postgresql.service redis.service
Wants=network-online.target

[Service]
Type=simple
User=asone
Group=asone
WorkingDirectory=/opt/asone-platform
EnvironmentFile=/etc/asone/api.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=on-failure
RestartSec=5
# Must exceed config.requestTimeoutMs (default 30_000ms) + the 5_000ms
# grace period server.ts already adds (server.ts:41), so systemd never
# SIGKILLs a shutdown the app itself is still completing gracefully.
TimeoutStopSec=40
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/asone-worker.service
[Unit]
Description=AS ONE Worker (outbox drain loop)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=asone
Group=asone
WorkingDirectory=/opt/asone-platform
EnvironmentFile=/etc/asone/worker.env
ExecStart=/usr/bin/node apps/worker/dist/main.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Two separate units, not one, so an API crash/restart never bounces the
worker's outbox drain loop and vice versa.

### 3.4 How each requirement is met

- **Restart-on-crash** — `Restart=on-failure` pairs directly with
  `shutdown.ts:49-56`: an uncaught exception or unhandled rejection already
  calls `shutdown('...', 1)`, which sets `process.exitCode = 1` — exactly the
  non-zero exit systemd's `on-failure` policy restarts on. `RestartSec=5`
  avoids a hot-crash-loop hammering Postgres/Redis reconnects.
- **Log accessibility** — `StandardOutput=journal`/`StandardError=journal`
  capture stdout/stderr into journald; Pino writes structured JSON to
  `process.stdout` by default (`createLogger()` in `server.ts:19-23` passes
  no `destination` override), so `journalctl -u asone-api -f` tails
  structured JSON live, and `journalctl -u asone-api -o cat | jq` parses it
  for offline analysis.
- **Controlled/graceful restart** — `systemctl restart asone-api` sends
  `SIGTERM` by default, which `installShutdownHandlers` already listens for
  (`shutdown.ts:46-48,58`) and turns into an orderly `app.close()` →
  `infrastructure.close()` → logger flush sequence, bounded by
  `TimeoutStopSec` above; systemd only escalates to `SIGKILL` if that budget
  is exceeded.
- **Environment injection** — `EnvironmentFile=/etc/asone/api.env`, a file
  outside the unit definition itself, readable only by the `asone` service
  user (`chmod 600`, owned by `asone`). Secrets (`DATABASE_URL`,
  `REDIS_URL`, `AUTH_ACCESS_TOKEN_SECRET`, `MERCADO_PAGO_ACCESS_TOKEN`, etc.)
  live there or in an actual secrets manager that populates it at deploy
  time — never inline in the `.service` file, which is often world-readable
  and typically checked into configuration-management repositories.
- **Post-restart health check** — not a systemd primitive by itself; the
  deploy script that calls `systemctl restart asone-api` should poll `GET
  /ready` (§1.5) with backoff immediately after, and only declare the deploy
  successful once it observes `200`. This is the same "smoke/readiness
  checks" step [DEPLOYMENT.md §Delivery pipeline](DEPLOYMENT.md#delivery-pipeline)
  already calls for — this document just grounds it in the concrete endpoint
  that satisfies it.
