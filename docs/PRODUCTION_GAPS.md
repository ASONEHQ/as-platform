# AS ONE — Production Config Audit (TASK 14.0 §K)

Forensic, read-mostly audit of whether `apps/api` (and its `apps/worker`
sibling) could actually deploy to a real production environment today. This
is not a deployment attempt — it is a code-level review of configuration
validation, network/security posture, and operational readiness, verified
against the actual source at the time of writing (worktree `task/12-2`).

Severity definitions (per TASK 14.0):

- **BLOCKER** — cannot launch.
- **CRITICAL** — can launch only with unacceptable risk.
- **MAJOR** — real issue; launch can proceed with a documented workaround.
- **POST-LAUNCH** — nonessential.

---

## 1. Environment validation

**Reality.** `packages/config/src/index.ts` defines a Zod schema
(`apiSchema`/`sharedSchema`) that every required production variable
(`DATABASE_URL`, `REDIS_URL`, `AUTH_ACCESS_TOKEN_SECRET`,
`AUTH_JWT_AUDIENCE`, `AUTH_JWT_ISSUER`, `API_HOST`, `API_PORT`, `APP_NAME`,
`APP_VERSION`, `LOG_LEVEL`, `NODE_ENV`) must satisfy, with no unsafe
defaults for secrets. `loadApiConfig()` calls `apiSchema.parse(environment)`,
which **throws** on any missing/invalid value — nothing is silently
defaulted into an insecure shape. `apps/api/src/server.ts:10-18` calls
`loadApiConfig()` in a `try/catch`; on failure it writes an error, sets
`process.exitCode = 1`, and returns **without calling `app.listen()`**. The
process therefore cannot boot into a partially-configured state — this is a
fail-loud, fail-early design.

`AUTH_ACCESS_TOKEN_SECRET` previously only had `z.string().min(32)` —
length-only. Nothing rejected an obviously unsafe value that happens to be
32+ characters (e.g. `replace_me_replace_me_replace_me...` or 40 repeated
`a` characters), unlike the explicit "reject weak/placeholder secrets"
pattern `validateBootstrapPassword` already applies to the dev-only
`AS_DEV_BOOTSTRAP_PASSWORD` (`apps/api/src/development/bootstrap-owner.service.ts:240-255`).
That was a real, confirmed gap for the one secret the API actually issues
JWTs and refresh-token HMACs with (`apps/api/src/modules/auth/auth.tokens.ts:25-109`
uses this single secret for both).

**Fixed.** `packages/config/src/index.ts` now adds a `.superRefine` on
`apiSchema` that, **only when `NODE_ENV === 'production'`**, rejects
`AUTH_ACCESS_TOKEN_SECRET` values that are low-entropy (fewer than 4 distinct
characters) or contain a known placeholder token (`changeme`, `replace_me`,
`placeholder`, `example`, `your_secret`, `local_only`, `todo`, etc.). Scoping
to production only means every existing dev/test fixture (e.g.
`test-secret-that-is-at-least-32-characters` in
`packages/config/src/index.test.ts`) is unaffected. Two new tests cover the
rejection and the acceptance of a real high-entropy secret. This closes the
one gap in item 1 that was both genuine and safely fixable without touching
excluded modules.

**Classification: CRITICAL (mitigated by the fix above).** Shipping with a
weak secret does not itself crash the API — an operator can still launch
with a bad value — which is why this is not a hard BLOCKER, but the
consequence (forgeable session tokens / full auth bypass) is unacceptable
risk. The fix removes the specific gap; the general principle "operators
must actually provision a real secrets-manager value" remains an operational
requirement, not a code guarantee that can fully replace human review.

---

## 2. CORS

**Reality.** `apps/api/src/plugins/security.ts:39-69` registers
`@fastify/cors` with `credentials: true` and an explicit `origin()` callback
that only allows an origin present in `config.corsAllowedOrigins` — there is
**no `origin: true`/`*` anywhere**. `corsOriginsSchema`
(`packages/config/src/index.ts:7-24`) explicitly rejects `'*'` and any
non-parseable URL (`origins.some((o) => o === '*' || !URL.canParse(o))` →
validation error), and de-duplicates/freezes the resulting list. It has a
**default** of `http://localhost:3000,http://127.0.0.1:3000` when
`CORS_ALLOWED_ORIGINS` is unset — safe-by-default (localhost only, never
wildcard), but an operator who forgets to set it in production ships an API
that rejects every real browser origin (fails closed, not open).
`requireApprovedOrigin` (`apps/api/src/modules/auth/auth.routes.ts:61-69`)
independently re-checks `request.headers.origin` against the same
`config.corsAllowedOrigins` list for the browser-only auth endpoints
(login-as-browser, browser-bootstrap, logout, logout-all, refresh), so CORS
policy and the app's own origin check are sourced from the exact same
validated config value — no drift between the two enforcement points.

**Classification: not a blocker.** Configurable per environment, safe
default, no wildcard path exists in code. Operationally, production
deployment must set `CORS_ALLOWED_ORIGINS` to the real app domains
(documented requirement, no code change needed).

---

## 3. Cookie/session settings

**Reality.** `apps/api/src/modules/auth/auth.routes.ts:20-59`:

- `setRefreshCookie` (where the cookie is actually **set**, not just
  cleared) builds `Secure` conditionally: `config.nodeEnv === 'production' ? '; Secure' : ''`
  — secure only in production, as required (a non-HTTPS local dev origin
  cannot set a `Secure` cookie and still have the browser store it).
- `HttpOnly` and `SameSite=Strict` are **unconditional** in every
  environment.
- The cookie name itself is environment-aware: `__Host-asone_refresh` in
  production (the `__Host-` prefix independently forces `Secure`, no
  `Domain` attribute, and `Path=/` at the browser level — matching
  `docs/SECURITY.md`'s documented cookie policy) vs. `asone_refresh_local`
  outside production, so a production-shaped cookie can never accidentally
  be issued/accepted in a non-production environment or vice versa.
- `clearRefreshCookie` mirrors the exact same flags, so clearing can never
  silently diverge from setting.

**Classification: not a blocker.** Environment-aware and correct in both
directions; no insecure-by-default path found.

---

## 4. Trusted proxy / HTTPS assumptions

**Reality.** `apps/api/src/bootstrap/create-app.ts:27` passes
`trustProxy: options.config.trustProxy` straight into the Fastify
constructor. `TRUST_PROXY` (`packages/config/src/index.ts:63`) is an
explicit `booleanSchema` (`'true'`/`'false'` only, coerced) defaulting to
`false`. No application code reads `request.ip` or `request.protocol`
directly (`grep` across `apps/api/src` outside tests: zero matches); the
only implicit consumer is `@fastify/rate-limit`'s default IP-based key
generator, which itself only trusts `X-Forwarded-For` when Fastify's own
`trustProxy` is enabled. Because `trustProxy` defaults to `false`, an
operator who deploys behind a real reverse proxy/load balancer must
explicitly set `TRUST_PROXY=true`; failing to do so degrades rate-limiting
accuracy (all requests behind the proxy look like they come from the proxy's
IP) rather than creating a spoofing hole — the unsafe direction (trusting
forwarded headers with no real proxy in front) requires an explicit opt-in,
never happens by default.

**Classification: not a blocker.** Configurable, safe default direction
(unsafe behavior requires explicit opt-in, not opt-out).

---

## 5. Database URL / connection pool

**Reality.** `DATABASE_URL` must be `z.url().startsWith('postgresql://')`
(`packages/config/src/index.ts:31`) — validated at boot, no default.
`createDatabaseClient` (`packages/database/src/client.ts:27-54`) throws if
neither a connection string nor an injected pool is supplied, and builds a
`pg.Pool` with `connectionTimeoutMillis` (default 2000ms),
`idleTimeoutMillis` (default 10000ms), and `max` (default 5) —
all overridable via `DatabaseClientOptions`, but **not exposed through any
environment variable**: `apps/api/src/infrastructure/dependencies.ts:29-34`
hardcodes `maxConnections: 5` for the API process, and
`apps/worker/src/infrastructure.ts:19-24` hardcodes `maxConnections: 2` for
the worker. There is no `sslmode`/`ssl` handling anywhere in
`packages/database/src` — TLS to Postgres depends entirely on the operator
including `?sslmode=require` (or equivalent) in the `DATABASE_URL` string
itself; `pg`'s connection-string parser does honor `sslmode`, so this works
correctly today, but nothing in code *requires* it — a production
`DATABASE_URL` missing `sslmode=require` would connect over plaintext
without any validation error.

**Classification: MAJOR (documented, not fixed).** Neither the fixed pool
size (5 per instance) nor the lack of an explicit SSL-mode requirement will
misbehave or crash — 5 connections is a reasonable conservative default for
horizontally-scaled stateless containers, and `sslmode=require` in the URL
does work. But there is no code-level guard against a production deploy
that forgets TLS, and no way to tune pool size without a code change. A
human should decide before real launch: (a) confirm the production
`DATABASE_URL` includes `sslmode=require` (or the managed provider's
equivalent) as an operational checklist item, and (b) whether 5
connections/instance × expected instance count stays under the managed
Postgres's `max_connections`. Not fixed here because it would require either
inventing a new env var (`DB_POOL_MAX`) — a feature addition beyond a
"blocker fix" — or hardcoding an assumption about the target Postgres
provider, which this audit was told not to invent.

---

## 6. Redis/RabbitMQ/MinIO and other external dependencies

**Reality, read from the actual bootstrap wiring, not assumed:**

- **Postgres** is the only dependency the core POS flow (login → sale →
  payment → receipt) touches. Every module registered in
  `apps/api/src/bootstrap/register-plugins.ts:114-310` (`AuthRepository`,
  `SalesRepository`, `PaymentRepository`, `CashRepository`, etc.) is
  constructed directly from `options.infrastructure.database`. None of them
  import or receive a Redis client.
- **Redis** (`REDIS_URL`, required with no default in
  `packages/config/src/index.ts:32`) is created in
  `apps/api/src/infrastructure/dependencies.ts:35-39` and
  `apps/worker/src/infrastructure.ts:25-29`, but a `redis` v4 client does
  not connect at construction time — `createClient()` only opens a socket
  when `.connect()` is called. The **only** call sites that ever call
  `.connect()`/`.ping()` are the readiness checks
  (`checkReadiness()`/`check()`) and `apps/api/src/operations/*`
  (ops CLI tooling, metrics). `grep -rl "redis" apps/api/src` (excluding
  tests) returns exactly: `infrastructure/dependencies.ts`,
  `operations/cli.ts`, `operations/operational-checks.service.ts`,
  `routes/health/index.ts`, `server.ts` — no auth, sales, cash, payments,
  refunds, promotions, loyalty, or rewards module references Redis for
  sessions, caching, or rate-limiting (`@fastify/rate-limit` in
  `apps/api/src/plugins/security.ts:70-74` uses its in-memory store; no
  Redis store is configured). `apps/worker/src/worker.ts` (the outbox drain
  loop) also never references Redis — it is pure Postgres.
- **MinIO / Mailpit**: present in `compose.yaml` for local dev convenience
  only. `grep -rl "minio\|mailpit"` across `apps/api/src` (excluding tests)
  returns zero application-code matches — these are aspirational
  local-dev-parity services, not wired into any request path.
- **RabbitMQ**: not present in `compose.yaml`, not referenced anywhere in
  `apps/api/src` or `apps/worker/src`. Not a real dependency today despite
  appearing in architecture-stage documentation as a future option.

**Conclusion.** REQUIRED: Postgres only, for the core POS flow. Redis is
required to **boot** (its URL must parse, per the shared config schema) but
not required to **serve** the core POS flow — the app never touches it
outside health/ops endpoints. MinIO, Mailpit, RabbitMQ: OPTIONAL/aspirational,
not wired in at all today.

**Classification: not a blocker for the core flow itself.** See §7 for the
consequence of this on the `/ready` gate, which is the part that actually
matters operationally.

---

## 7. Health/readiness

**Reality.** `apps/api/src/routes/health/index.ts` defines three distinct
endpoints:

- `GET /health` — static liveness-ish payload (`name`/`status`/`version`),
  no dependency check.
- `GET /live` — pure liveness (`{status: 'alive'}`), no dependency check.
- `GET /ready` — calls `infrastructure.checkReadiness()`
  (`apps/api/src/infrastructure/dependencies.ts:43-56`), which runs
  `database.check()` (`SELECT 1`, `packages/database/src/client.ts:47-49`)
  and a Redis `PING` **in parallel via `Promise.allSettled`**, and reports
  **both** as separate fields in the JSON body (`services.postgres`,
  `services.redis`) and as separate Prometheus gauge values
  (`asone_readiness_dependency{service="postgres"|"redis"}`). So a real
  load balancer or on-call engineer inspecting the body *can* distinguish
  "DB down" from "Redis down" — the task's concern that this distinction
  might not exist is **not accurate**: it does, at the data level.

However, the **HTTP status code** collapses that distinction: `ready =
postgres === 'available' && redis === 'available'`
(`apps/api/src/routes/health/index.ts:71`) — the endpoint returns `503` if
*either* dependency is down, even though §6 established that Redis is not
required for the core POS flow to actually work. A load balancer that only
looks at the status code (the common case) would pull an instance out of
rotation for a Redis outage even though logins, sales, payments, and
receipts would all still function against Postgres alone. This matches
`docs/DEPLOYMENT.md`'s stated design ("readiness checks required
dependencies") — the code is internally consistent with the docs — but that
documented design conflicts with TASK 14.0's own expectation that the core
POS flow shouldn't be gated on more than Postgres.

**Classification: MAJOR, not a BLOCKER.** `/ready` exists, works, and
correctly detects both dependencies (the literal ask in item 7 — "is there a
separate readiness check that verifies DB connectivity specifically" — is
answered **yes**, `services.postgres` is independently reported). The gap is
a product/ops decision, not missing code: should `/ready` return `200` when
only Postgres is up (treating Redis as best-effort), or should Redis
availability keep gating rollout? Not fixed here — flipping that boolean
changes externally-observed load-balancer behavior and is a deliberate
product decision, not a "config value silently defaulting to something
unsafe." Recommendation for the human decision: either (a) split into
`/ready` (Postgres-gated, drives traffic admission) and a separate
`/ready/full` or metrics-only signal for Redis, or (b) keep as-is and ensure
Redis is deployed with the same availability target as Postgres before
launch. Either is a legitimate choice; this document flags it rather than
picking for the team.

---

## 8. Logging

**Reality.** `packages/logger/src/index.ts:3-22` configures Pino with an
explicit `redact` list covering `authorization`, `cookie`, `password`,
`access_token`, `refresh_token`, `token`, `secret`, `api_key`,
`database_url`, `redis_url`, and both `query`/`request.query`/`req.query` —
plus header-path variants (`headers.authorization`,
`request.headers.cookie`, etc.). Custom `req`/`res` serializers
(`packages/logger/src/index.ts:40-50`) **only** emit `method`, `path` (with
the query string stripped via `.split('?', 1)[0]`), and `status` — request
bodies are never serialized into logs at all, redacted or otherwise, because
nothing passes the raw body to the logger. `apps/api/src/bootstrap/create-app.ts:21`
disables Fastify's own automatic request/response logging
(`new LogController({ disableRequestLogging: true })`), and the only custom
request-completion log
(`apps/api/src/plugins/request-context.ts:46-60`) logs
`correlation_id`/`duration_ms`/`method`/`request_id`/`route`/`status` —
again, no bodies, no headers, no query strings.

**Classification: not a blocker.** No sensitive-data logging path found.

---

## 9. Migration strategy at startup

**Reality.** `apps/api/src/server.ts` (the actual process entry point,
`startServer()`) never imports or calls anything from
`packages/database`'s migration machinery. `packages/database/src/scripts/migrate.ts`
is a **standalone script** (`db:migrate` in `packages/database/package.json:24`)
that opens its own dedicated `DatabaseClient`, runs Drizzle's `migrate()`
against `../../drizzle` (the migrations folder), and closes the connection —
it is never imported by `apps/api` or `apps/worker`. `docs/DEPLOYMENT.md:46-48`
documents the intended ordering explicitly: "Use expand/migrate/contract
changes for zero-downtime evolution. A single controlled job runs
migrations. Application releases remain compatible with both sides of a
rolling deployment" — and the delivery pipeline
(`docs/DEPLOYMENT.md:28-36`) places "Run controlled backward-compatible
migrations" as its own numbered step, separate from "Deploy progressively."

**Classification: not a blocker.** This is the safe, standard pattern (no
auto-migration race between concurrently-booting API replicas), and it is
documented, not just implicit in the code.

---

## 10. Bootstrap strategy

**Reality.** `validateBootstrapEnvironment`
(`apps/api/src/development/bootstrap-owner.service.ts:203-238`) — read in
full — requires **all** of: `NODE_ENV` to be exactly `'development'` or
`'test'`; `DATABASE_URL` to parse as a URL with protocol
`postgres:`/`postgresql:` **and** hostname `127.0.0.1` or `localhost`
(rejects any non-loopback host outright, so a real managed Postgres
endpoint can never satisfy this check); the decoded database name to equal
`asone_local` (development) or match `/^asone_[a-z0-9_]*test[a-z0-9_]*$/u`
(test); and `AS_DEV_BOOTSTRAP_PASSWORD` to pass `validateBootstrapPassword`
(length ≥ 12, upper+lower+digit+symbol, and rejects a placeholder-word
list). The same three-part gate (env allowlist, loopback-only hostname,
database-name allowlist) is duplicated identically across
`seed-cash-registers.service.ts`, `seed-loyalty-rewards.service.ts`, and
`seed-pos-catalog.service.ts` (`validateSeedEnvironment`, confirmed by
reading `seed-pos-catalog.service.ts:216-243`). This gating is real,
consistent, and cannot accidentally target a real production database: a
production `DATABASE_URL` (non-loopback host, real DB name) fails the check
before any query runs, and `NODE_ENV=production` fails it even earlier.

**Is there an equivalent, safe "create the first real company + owner"
story for production?** No — confirmed genuine gap.
`apps/api/src/modules/admin/companies/companies.routes.ts` exposes only
`GET /api/v1/companies/:company_id` — **no `POST` to create a company
exists anywhere in the API.** `apps/api/src/modules/admin/identity/identity.routes.ts`
exposes `POST /api/v1/users`, but every route in that file is registered
behind `registerAdministrationRoutes` inside the authenticated
administration surface (`apps/api/src/bootstrap/register-plugins.ts:134-143`)
— it adds a user *to an already-existing, already-authenticated company*,
it cannot create the first tenant from nothing. Combined with the dev/test
bootstrap script being deliberately and permanently unable to target a real
production database, there is currently **no mechanism at all** to create
the first company and owner account against a real production database.

**Classification: BLOCKER for an actual production launch, but explicitly
NOT fixed here per the task's own instruction** ("Is there any equivalent,
safe... story for an actual production launch, or is that a genuine gap
that needs to be flagged (not necessarily built — just flagged if it's a
real gap)?"). Building a production-safe tenant-provisioning flow would mean
adding new authenticated admin endpoints and/or a one-time-use provisioning
CLI with its own credential and audit story — nontrivial new functionality,
not a "fix the blocker" change, and squarely a job for a human product/
security decision (who is allowed to provision the first tenant, how is
that action authenticated and audited, is it a CLI run by a trusted deploy
operator against a controlled network path, etc.). Flagged, not built.

---

## 11. Backup expectations

**Reality.** `docs/BACKUP_STRATEGY.md` and `docs/DISASTER_RECOVERY.md` both
exist and are detailed, internally consistent, and — where they reference
actual tooling — accurate against the current codebase:

- `docs/BACKUP_STRATEGY.md`'s "Safe metadata verification" section
  describes a `backup-verify --manifest <path>` command that "never
  creates, uploads, restores or deletes backups." Confirmed:
  `apps/api/src/operations/cli.ts` implements exactly a `backup-verify`
  subcommand (line 110) alongside a `restore-validate` subcommand (line
  117), matching `docs/DISASTER_RECOVERY.md`'s closing section ("The
  internal harness validates preconditions only... It performs no restore
  or deletion").
- `docs/DISASTER_RECOVERY.md`'s tier table explicitly classifies Redis as
  T3 — "disposable/reconstructible; never business authority" — which
  matches the §6/§7 findings above (Redis genuinely isn't authoritative
  data and genuinely isn't required for the core POS flow); the docs and
  the code agree here, they are not stale relative to each other.
- Both documents are explicit that they describe **target policy and
  runbooks**, not currently-automated infrastructure:
  `docs/DISASTER_RECOVERY.md`'s own "Purpose" section states "Targets are
  service objectives, not claims of current provider capability; staging
  exercises must prove them before production launch." There is no
  automation in this repository for the actual backup jobs, WAL/PITR
  configuration, or cross-region replication described in the tables —
  only the local validation harness (`backup-verify`/`restore-validate`)
  that checks preconditions on data an operator already produced through
  external, unbuilt infrastructure.

**Classification: MAJOR (documented gap, correctly labeled as aspirational
by the docs themselves — not stale, not misleading).** The runbooks are
ready to execute once the underlying managed-Postgres backup/PITR service is
actually provisioned; that provisioning is infrastructure work outside this
repository's code and outside this audit's remit (no fake infrastructure
was invented here). A human must confirm, before real launch, that the
target Postgres provider's backup/PITR capability has actually been
configured and exercised at least once per `docs/DISASTER_RECOVERY.md`'s
"Exercises and evidence" table — the document's own language already says
this ("staging exercises must prove them before production launch").

---

## 12. Other findings noted in passing

- **CSP is disabled by default in production.**
  `apps/api/src/plugins/security.ts:35-38` registers `@fastify/helmet` with
  `contentSecurityPolicy: false` whenever `config.openapiUiEnabled` is
  `false` — which is the default in every environment except development
  (`packages/config/src/index.ts:143`). All of Helmet's *other* default
  headers (X-Frame-Options, Referrer-Policy, etc.) remain active regardless;
  only the CSP header is toggled off. Since `apps/api` serves JSON, not
  HTML, CSP's practical value here is limited, but it is a real deviation
  from `docs/SECURITY.md`'s "Configure restrictive CORS, security headers,
  and content policies" principle, and it was not obviously intentional
  (no comment explains the inversion, no test covers it either way).
  **Classification: POST-LAUNCH.** Not fixed — flipping a security-header
  default with zero existing test coverage, on a module this audit was
  asked to review rather than redesign, risks an unreviewed behavior change
  for a header with low practical impact on a JSON-only API. Flagged for a
  human to confirm intent.

---

## Summary table

| # | Area | Classification | Fixed here? |
| - | ---- | -------------- | ----------- |
| 1 | Env validation / secret strength | CRITICAL → mitigated | **Yes** — `packages/config/src/index.ts` + test |
| 2 | CORS | Not a blocker | No change needed |
| 3 | Cookie/session flags | Not a blocker | No change needed |
| 4 | Trusted proxy / HTTPS assumptions | Not a blocker | No change needed |
| 5 | DB URL / pool / SSL | MAJOR | No — documented gap (needs new env var or provider-specific assumption) |
| 6 | External dependency wiring (Redis/MinIO/RabbitMQ) | Informational | No — confirmed Postgres-only core flow |
| 7 | Readiness (`/ready` gates on Redis) | MAJOR | No — product decision, not a code defect |
| 8 | Logging | Not a blocker | No change needed |
| 9 | Migration strategy at startup | Not a blocker | No change needed |
| 10 | Production tenant bootstrap | BLOCKER (for real launch) | No — explicitly out of scope to build, flagged only |
| 11 | Backup/DR documentation | MAJOR (aspirational, honestly labeled) | No — infrastructure provisioning, not code |
| 12 | CSP disabled by default | POST-LAUNCH | No — low impact, no test coverage to safely change |

## Files changed by this audit

- `packages/config/src/index.ts` — added `isWeakProductionSecret()` and a
  `.superRefine` on `apiSchema` rejecting placeholder/low-entropy
  `AUTH_ACCESS_TOKEN_SECRET` values, scoped to `NODE_ENV === 'production'`
  only.
- `packages/config/src/index.test.ts` — two new tests covering the
  rejection and the acceptance path.
- `docs/PRODUCTION_GAPS.md` — this document (new file).

No file under `apps/one`, no file under
`apps/api/src/modules/{payments,sales,cash,refunds,rewards,promotions,loyalty}`,
and no migration file under `packages/database/drizzle` was read for the
purpose of modification, nor changed.
