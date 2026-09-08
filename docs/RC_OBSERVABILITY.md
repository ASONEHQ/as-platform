# RC Observability / Operations Certification (TASK 15.0, Phase 14)

Governed by [RC_FREEZE_POLICY.md](RC_FREEZE_POLICY.md). This is a
**certification** pass, not a redesign: it re-verifies, against the actual
code at the RC freeze checkpoint, everything
[OBSERVABILITY_AND_SUPERVISION.md](OBSERVABILITY_AND_SUPERVISION.md) (TASK
14.1 §M+N) already documented, extends it with two things that document did
not cover (a certification-style verdict on each of the ten certification
questions below, and step-by-step operator procedures for nine concrete
failure scenarios), and records the two narrowly-scoped code fixes made
during this pass. It does not replace or restate that document's own detail
— read it first for the full mechanism-level walkthrough; this document
cites it rather than duplicating it.

**Verification method**: source reading of every file cited below, plus live
verification against an isolated instance of the API — never the shared dev
server on `:3000` — started per this task's own instructions on `:3400`
(and, for the DB-unreachable scenario, `:3401`) against the real
`asone_test` Postgres/Redis/MinIO containers already running locally. Both
isolated instances were stopped (`taskkill /F`) before this pass finished;
the shared `:3000` dev server was confirmed unaffected throughout and after.

---

## Part 1 — The ten certification questions

### 1. Health endpoint — real dependency check or static "ok"?

**Static "ok" — by design, and correctly so.** `GET /health`
(`apps/api/src/routes/health/index.ts:15-36`) returns a fixed
`{name, status: 'ok', version}` with no dependency check at all — confirmed
by reading the handler (a bare arrow function, no `await`, no infrastructure
reference) and by live test: pointing an isolated instance's `DATABASE_URL`
at an unreachable host (`127.0.0.1:59999`, nothing listening), `/health`
still returned `200 {"status":"ok",...}` in ~12ms. This is a pure **liveness**
signal ("the process is up and the event loop is responding"), not a
readiness signal — that distinction is intentional and is exactly what
`/live` and `/ready` (below) split apart. Do not mistake `/health`'s `200`
for "the API can actually serve a request."

### 2. Readiness endpoint — separate from liveness, checks real dependencies?

**Yes — a genuine gap here is already closed, not open.** `GET /ready`
(`health/index.ts:57-95`) calls
`infrastructure.checkReadiness()`(`apps/api/src/infrastructure/
dependencies.ts:43-56`), which runs `database.check()` (`SELECT 1`) and a
Redis `PING` in parallel via `Promise.allSettled` and reports both
independently. Live-verified on the DB-unreachable isolated instance:

```
$ curl -s http://127.0.0.1:3401/ready
{"services":{"postgres":"unavailable","redis":"unavailable"},"status":"not_ready"}   → HTTP 503
```

against a normally-configured instance:

```
$ curl -s http://127.0.0.1:3400/ready
{"services":{"postgres":"available","redis":"available"},"status":"ready"}           → HTTP 200
```

The HTTP status gates on **Postgres only** — a Redis-only outage reports
`services.redis: "unavailable"` in the body and sets the
`asone_readiness_dependency{service="redis"}` gauge to `0`, but still returns
`200`. This is a deliberate, documented decision (route's own comment,
`health/index.ts:71-80`, and
[OBSERVABILITY_AND_SUPERVISION.md §1.5](OBSERVABILITY_AND_SUPERVISION.md#15-health-and-readiness)):
grepping every module under `apps/api/src/modules` confirms the core POS flow
(login → sale → payment → receipt) never touches Redis. A container
platform's own readiness probe pointed at `/ready` would therefore correctly
pull an instance with a dead Postgres connection out of rotation, and
correctly leave one in rotation through a Redis-only outage — not a blocker
either way. `app.test.ts:554-609` has three tests locking this exact
contract in (including asserting the `/ready` error body never contains the
literal string `postgresql://`, i.e. no connection-string leak).

### 3. Structured logs — real pino JSON, no sensitive data?

**Confirmed on both counts.** `packages/logger/src/index.ts` configures pino
with an explicit `redact.paths` list (`authorization`, `cookie`, `password`,
`access_token`, `refresh_token`, `token`, `secret`, `api_key`,
`database_url`, `redis_url`, plus header/query path variants) and custom
`req`/`res` serializers that emit **only** `method`, `path` (query string
stripped), and `status` — no request body ever reaches the logger at all
(nothing hands it one), so there is nothing for redaction to miss on that
axis. Fastify's own automatic request logging is disabled
(`create-app.ts`: `disableRequestLogging: true`) in favor of the one custom
completion line in `request-context.ts`. Grepping every non-test `.log.*(`/
`.logger.*(` call site in `apps/api/src` (request-context.ts,
error-handler.ts, the Mercado Pago client/webhook routes,
operational-checks.service.ts) turned up no call that logs a password,
token, secret, or card field — the Mercado Pago client's own header
construction even carries an inline comment confirming the bearer token is
"never logged, never included in any thrown error's message/details"
(`mercado-pago.client.ts:74-76`). Live-verified: the structured log lines
captured from both isolated instances during this pass are genuine one-line
JSON (`{"level":30,"time":"...","service":"asone-api","reqId":"req-1",
"correlation_id":"...","duration_ms":12.41,"method":"GET",
"request_id":"...","route":"/health","status":200,"msg":"request
completed"}`), never string-concatenated text.

### 4. Request IDs / correlation IDs — real, propagated, client-header honored?

**Confirmed, and one real gap found and fixed (see Part 3, fix 1).**
`apps/api/src/plugins/request-context.ts` builds a `RequestContext` per
request: `requestId`/`correlationId` from a validated `x-request-id`/
`x-correlation-id` header (format-checked against
`/^[A-Za-z0-9._-]{1,128}$/u`) or a fresh `randomUUID()` if absent or invalid.
Live-verified all three cases against an isolated instance:

- Valid client-supplied `X-Correlation-ID: my-custom-corr-id-123` →
  echoed back verbatim in the error envelope's `meta.correlation_id`.
- Invalid header (`X-Correlation-ID: bad id with spaces!!`) → silently
  replaced with a fresh UUID (never rejected the request, never let an
  unsafe value flow into a header/log field).
- Every `'request completed'` log line (`request-context.ts:46-60`) and
  every error envelope (`error-handler.ts:21-34`) already carried both IDs
  under `correlation_id`/`request_id` — confirmed live in both the JSON logs
  and the HTTP response bodies captured during this pass.
- The exact same `request_id`/`correlation_id` also land in real
  `audit_log` rows for a mutation — see item 5.

**The gap**: only `x-request-id` was ever set as a *response header*
(`request-context.ts:42`, pre-fix) — `x-correlation-id` was never echoed
back as a header, even though `security.ts`'s CORS config already lists
`X-Correlation-ID` in `exposedHeaders` (a client-facing promise that the
header is readable). A client debugging a **successful** request had no way
to read the correlation ID the server used at all (the ID only ever
appeared in `meta.correlation_id` on **error** envelopes) — full traceability required
provoking an error first. Fixed; see Part 3.

### 5. Audit logging — real `audit_log` rows for real mutations?

**Confirmed with both a live database query and direct code tracing across
five modules.** Querying the real `asone_test` database directly
(`docker exec asone-local-postgres-1 psql -U asone_test -d asone_test`)
during this pass returned genuine rows with **populated, non-null**
`request_id`/`correlation_id` columns for real HTTP-originated mutations,
e.g.:

```
action                | entity_type | request_id                           | correlation_id
auth.login_succeeded   | session     | 6abf0ea1-66e6-4584-b730-704fa06bd1b9 | 83a35fc6-239d-460d-bb61-59c9bb7e3433
```

(alongside pre-existing system-originated rows —
`development.owner_bootstrapped`, `production.owner_provisioned` — which
correctly carry **empty** `request_id`/`correlation_id`, since they have no
HTTP request context to draw from; that asymmetry is expected, not a bug.)

Five modules were traced to confirm this isn't one lucky code path but a
consistent, repository-level pattern — every one issues the identical
`insert into audit_log (id, company_id, actor_type, actor_id, action,
entity_type, entity_id, request_id, correlation_id, metadata, occurred_at)`
shape:

- `apps/api/src/modules/auth/auth.repository.ts:329` (`AuthRepository.audit()`)
- `apps/api/src/modules/cash/cash.repository.ts:307` (`auditAndPublish()`,
  same call also writes a same-transaction `outbox_events` row)
- `apps/api/src/modules/payments/payments.repository.ts:244`
- `apps/api/src/modules/sales/sales.repository.ts:308`
- `apps/api/src/modules/catalog/catalog.repository.ts:518`

[OBSERVABILITY_AND_SUPERVISION.md §1.6](OBSERVABILITY_AND_SUPERVISION.md#16-audit-trail-businesssecurity-evidence-separate-from-logs)
already documents the full auth (`auth.login_succeeded`,
`auth.company_selection_required`, `auth.company_selected`,
`auth.refresh_reuse_detected`, `auth.token_refreshed`,
`auth.company_switched`, `auth.branch_switched`, `auth.logout`,
`auth.logout_all`) and sales (`sale.created`, `sale.cancelled`) action lists
and the one deliberate exception (failed logins are never audited, by
design, to avoid a durable "wrong password vs. unknown user" signal) — this
pass re-confirms that documentation is still accurate at the freeze
checkpoint and extends the module sample from two to five.

### 6. Error logging — logged server-side with context, never leaked to the client?

**Confirmed on both halves.** `apps/api/src/plugins/error-handler.ts`'s
fallback branch (lines 111-119, hit by any error that is not an `AppError`
and not a recognized validation/transport/rate-limit error) logs one
`error`-level line with `correlation_id`, `request_id`, and the **full**
error object via pino's `err` serializer (stack trace, name, message — real
debugging context) — then returns a generic envelope
(`{error:{code:'internal_error', message:'An unexpected error occurred.',
details:[]}, meta:{...}}`) with no stack trace, no SQL, no file path, no
internal error message. `AppError`s (deliberate, coded application errors —
validation failures, business-rule rejections) are **not** separately
logged beyond the standard completion line — intentional, since they aren't
unexpected failures; `'request failed'` in the logs is reserved exclusively
for the genuinely-unexpected case. `app.test.ts:567`
(`expect(ready.body).not.toContain('postgresql://')`) is direct automated
coverage that a connection string never leaks through the readiness path
specifically. No route handler was found (grep across `apps/api/src/modules`
and `plugins`) constructing an error response manually outside this central
handler/`AppError` pattern.

### 7. Graceful shutdown — SIGTERM/SIGINT drains and closes cleanly, or hard-exits?

**Confirmed by code (re-verifying an already-correct, already-documented
mechanism); live signal delivery could not be meaningfully exercised in this
sandboxed Windows dev environment — see caveat below.**
`apps/api/src/bootstrap/shutdown.ts` registers `process.once('SIGINT', ...)`
and `process.once('SIGTERM', ...)`, both routed through the same `shutdown()`
routine: log `'server shutdown started'` → `Promise.race` between
`options.close()` (which `server.ts:29-38` wires to `app.close()` →
`infrastructure.close()` → `logger.flush()`, in that order) and a timeout
(`config.requestTimeoutMs + 5_000` ms, `server.ts:41`) → log
`'server shutdown complete'` or, on timeout, `logger.fatal(...)` +
`process.exitCode = 1`. `uncaughtException`/`unhandledRejection` are also
caught and routed through the identical `shutdown(..., 1)` path — never a
bare `process.exit()`, never a silent hang.

**Live evidence obtained during this pass** (not a signal test, but a real
exercise of the exact same code path): a second isolated-server start
attempt on an already-occupied port produced a genuine `app.listen()`
failure, and the captured log shows the full real sequence firing correctly,
unprompted:

```
{"level":60,...,"err":{"type":"Error","message":"listen EADDRINUSE: address already in use 127.0.0.1:3400",...},"msg":"server startup failed"}
{"level":30,...,"reason":"startup failure","msg":"server shutdown started"}
{"level":30,...,"msg":"server shutdown complete"}
```

— exactly the `server.ts:44-51` → `shutdown.ts` path, end to end, with real
timestamps and a real structured `err` object.

**Caveat on live signal testing**: this worktree runs on Windows, and the
background node processes this task started have no attached console, so
Windows can only force-terminate them (`taskkill` without `/F` was tried
first and refused: *"This process can be terminated only forcefully"*) —
there is no way to deliver a catchable close signal to a console-less
background process on this platform, so `SIGINT`/`SIGTERM` handling could
not be exercised live end-to-end in this sandbox. This is a **sandbox
limitation, not a code gap**: [DEPLOYMENT_PACKAGING.md §1.3](DEPLOYMENT_PACKAGING.md#13-what-the-artifact-actually-is-today--a-genuine-gap)
and
[OBSERVABILITY_AND_SUPERVISION.md §3](OBSERVABILITY_AND_SUPERVISION.md#part-3--process-supervision)
already establish the real production target is a plain `node
apps/api/dist/server.js` process under systemd on Linux, where `SIGTERM`
(sent by `systemctl restart`/`stop`) is a fully standard, fully Node-supported
POSIX signal — the code path this pass re-confirmed by reading is exactly
the one that fires there. **A genuine, separate gap**: no dedicated
`shutdown.test.ts` (or equivalent unit test invoking `installShutdownHandlers`
directly) exists — grepped `apps/api/src` for `installShutdownHandlers`/
`SIGTERM`/`SIGINT` in `*.test.ts` and found no match. This is a real, narrow,
"missing tests for launch-critical behavior" item under the freeze policy;
not fixed in this pass (adding tests is outside this pass's narrow file
scope — see Part 3).

### 8. DB failure visibility — loud and clear, or silent/hanging?

**Loud and clear at the HTTP layer; one real silent-crash risk found in the
connection-pool layer and fixed (see Part 3, fix 2).**

At the HTTP layer: pointing an isolated instance's `DATABASE_URL` at
`127.0.0.1:59999` (nothing listening) and hitting `/ready` live returned
`503 {"services":{"postgres":"unavailable",...},"status":"not_ready"}`
immediately (bounded by `connectionTimeoutMs`, default `2_000`ms) — never a
hang, never a `200`. `/health` correctly stayed `200` throughout (it is a
pure liveness check — see item 1) — an operator must check `/ready`, not
`/health`, to see a DB outage.

**The gap**: `packages/database/src/client.ts:106` constructs a `pg.Pool`
with **no `'error'` listener**. node-postgres's own documented contract is
that an *idle* pooled client erroring (a dropped connection, the DB process
restarting under an already-connected pool) emits `'error'` on the `Pool`
itself; with zero listeners, Node treats that as an unhandled `EventEmitter`
error and throws — confirmed by grepping `apps/api/src` and
`packages/database/src` for `pool.on(` / `.on('error'` and finding **only**
the pre-existing `redis.on('error', () => undefined)` in
`dependencies.ts:39`, nothing analogous for Postgres. That uncaught throw
**is** ultimately caught — by `shutdown.ts`'s global `uncaughtException`
handler (item 7), which logs it at `fatal` with full detail and drives a
full graceful shutdown + `exit(1)` — so this was never a truly *silent*
failure, but it is a disproportionate one: a single idle connection erroring
during a quiet moment (a DB failover, a brief network blip) would restart
the **entire API process** rather than letting `pg.Pool`'s own built-in
recovery (evict the broken client, open a fresh one on the next query)
handle it invisibly, the way it's designed to. Fixed; see Part 3.

### 9. Object-storage (MinIO) failure visibility

**Confirmed safe (no leaked detail, no boot failure) but not maximally
clear; not a launch blocker.**
`apps/api/src/modules/admin/branding/branding.storage.ts` and its
registration gate in `apps/api/src/bootstrap/register-plugins.ts:202-212`
were re-derived independently from code (no `docs/RC_PRODUCTION_CONFIG.md`
existed yet at the time this section was written — confirmed absent in this
worktree):

- **MinIO env vars absent** (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/
  `MINIO_API_PORT` — `brandingStorageConfigFromEnv()`,
  `branding.storage.ts:64-74`) → the two branding routes are simply never
  registered; the app boots fine and a client hitting either route gets a
  real `404`, not a 500 or a hang. This mirrors the exact same established
  pattern `MERCADO_PAGO_ACCESS_TOKEN` already uses elsewhere in this
  codebase (register-plugins.ts's own comment at lines 194-201 cites it
  directly).
- **MinIO env vars present but MinIO itself unreachable at runtime**
  (network down, container stopped) → `BrandingObjectStorage.ensureBucket()`/
  `.uploadLogo()` (`branding.storage.ts:108-159`) throw a raw AWS-SDK
  connection error. `branding.routes.ts` only catches and remaps two
  specific, expected failure shapes (`isFileTooLargeError`, a bad content
  type); an S3 connection error is neither, so it falls through to the
  generic `error-handler.ts` path from item 6 — logged server-side with full
  detail, returned to the client as a generic `500 internal_error` with no
  leaked host/port/credential detail. **Not a blocker**: safe (no leak,
  boots fine, other routes unaffected — this endpoint's own multipart
  registration is global per `register-plugins.ts:154-159` but its body-size
  override is route-scoped, so a MinIO outage can't affect any other route's
  behavior), just not maximally operator-friendly (a generic `500` rather
  than a distinguishable `storage_unavailable`/`503`). Left as a documented
  gap rather than fixed — mapping S3-specific errors to a new error code is
  a small scope expansion (a new public error code/contract), not the
  narrowly-scoped fix this pass's file-scope permits.
- **Separate, smaller gap**: the deep `ops check`/`ops readiness` CLI
  (`apps/api/src/operations/operational-checks.service.ts:208-225`)
  hardcodes `object_storage.connectivity` as permanently `status: 'unknown'`,
  `message: 'Object storage client is not configured.'` — it never actually
  probes MinIO even when the branding storage env vars **are** set and
  configured. An operator running `ops check` gets no MinIO signal at all,
  configured or not. Documented, not fixed (`apps/api/src/operations/**` is
  outside this pass's file scope).

### 10. Backup failure visibility — clear/actionable, or silent?

**Clear and specific at the library level; the CLI wrapper around it swallows
the message text (though not the failure itself).**
`apps/api/src/operations/backup-verification.service.ts`'s `verify()` throws
one of three precise, human-readable `Error`s: `"Backup manifest is
invalid."`, `"Backup file is empty or unavailable."`, or `"Backup checksum
mismatch."` — never a generic/opaque failure. `apps/api/src/operations/
cli.ts` (`runOperationalCommand`) has a well-designed exit-code taxonomy
(`success=0`, `degraded=1`, `invalid=2`, `unavailable=3`, `rejected=4`,
`internal=5`, `OPERATIONAL_EXIT`, lines 11-18) and correctly maps a thrown
`backup-verify` error to `unavailable` (3) via its top-level `catch`
(lines 192-196) — so the failure is never silent in the sense of "looks like
success" (a non-zero exit is unambiguous, and CI/cron wrapping this command
will correctly flag it). **The gap**: that top-level `catch` block never
prints the caught error's own message — only `output(...)` (called on the
success path) ever writes to stdout, so an operator running `asone ops
backup-verify --manifest ...` by hand sees exit code `3` and **nothing else
on stdout or stderr** to distinguish "the manifest JSON was malformed" from
"the checksum didn't match" from "the backup file is missing" — they would
need to re-run the underlying `BackupVerificationService.verify()` call
themselves (or read this document) to get the actual reason. Documented, not
fixed (`apps/api/src/operations/cli.ts` is outside this pass's file scope).
A sibling backup/restore-rehearsal workstream owns live backup verification
exercises; this pass only re-read the source.

---

## Part 2 — Summary verdict

| # | Question | Verdict |
| - | -------- | ------- |
| 1 | `/health` real dependency check? | No — intentional pure liveness check; not a gap |
| 2 | Separate readiness endpoint? | Yes — `/ready`, Postgres/Redis, correctly gated on Postgres only |
| 3 | Real structured pino JSON, no sensitive data? | Yes, confirmed on both counts |
| 4 | Request/correlation IDs real, propagated, client header honored? | Yes; one gap found and **fixed** (correlation ID missing from response headers) |
| 5 | `audit_log` genuinely populated? | Yes — live DB query + 5-module code trace |
| 6 | Errors logged server-side, never leaked to client? | Yes, confirmed on both halves |
| 7 | Graceful shutdown on SIGTERM/SIGINT? | Yes by code (re-confirmed); live signal test blocked by Windows sandbox, not a code gap; missing dedicated shutdown test is a real but separate gap |
| 8 | DB failure visible, not silent/hanging? | Yes at HTTP layer; one silent-crash risk in the pool layer found and **fixed** |
| 9 | MinIO failure visible? | Safe, not maximally clear; two documented (not fixed) gaps, neither a blocker |
| 10 | Backup failure visibility? | Failure itself is loud (correct non-zero exit); the *reason* is swallowed by the CLI wrapper — documented, not fixed |

**No RED / launch-blocking item.** Two real, narrowly-scoped gaps were fixed
directly (Part 3). The remaining documented gaps (§9's two items, §10, §7's
missing shutdown test) are genuine but none of them causes a real
deployment orchestrator to misroute traffic, silently lose data, or leak
internal detail to a client — each is recorded here, with an exact file
citation, for a future pass to pick up.

---

## Part 3 — Code fixes made during this pass

Both fixes are traceable to a specific certification finding above, both
were re-verified by rerunning the affected tests (not merely asserted
fixed), and both stayed inside this pass's permitted file scope
(`apps/api/src/plugins/**`, `apps/api/src/app.ts`,
`apps/api/src/infrastructure/**`).

### Fix 1 — correlation ID missing from response headers

**File**: `apps/api/src/plugins/request-context.ts`
**Blocker**: Part 1, item 4.
**Change**: added `reply.header('x-correlation-id', context.correlationId);`
in the `onRequest` hook, immediately alongside the pre-existing
`reply.header('x-request-id', ...)` line. `x-correlation-id` is now echoed
on **every** response (success or error), matching what `security.ts`'s CORS
`exposedHeaders` config already promised a client could read.
**Test result**: `npx vitest run src/app.test.ts` → **17/17 passed** (no
existing assertion pinned the absence of this header; nothing broke).
`npx vitest run src/plugins` → **5/5 passed**. Live-verified against an
isolated `:3400` instance post-fix:
```
$ curl -sD - http://127.0.0.1:3400/health -o /dev/null
x-request-id: ea1e49ab-e3aa-4791-a9e1-6bed2a5aa65c
x-correlation-id: 6627c5ea-ebf4-4528-8bd6-28491ef87f5e
```

### Fix 2 — unhandled `pg.Pool` `'error'` event risks a full-process crash on an idle-connection failure

**File**: `apps/api/src/infrastructure/dependencies.ts`
**Blocker**: Part 1, item 8.
**Change**: added `database.pool.on('error', () => undefined);` immediately
after the pre-existing `redis.on('error', () => undefined);` line, inside
`createInfrastructure()`. This exactly mirrors the Redis line right above it
in the same function — a bare no-op listener is sufficient to stop Node from
treating a pool-level `'error'` event as an unhandled/uncaught exception;
`pg.Pool` already evicts the broken idle client and opens a replacement on
the next query without any further application-level handling required.
This is a deliberately minimal, symmetric fix — it does **not** add logging
of the swallowed error (no `Logger` is threaded into
`createInfrastructure()` today, and wiring one through would require editing
`server.ts`, which is outside this pass's file scope); a future pass could
thread a logger through and log at `warn` instead of silently swallowing,
the same way `redis`'s handler could.
**Test result**: `npx vitest run src/operations` → **21/21 passed** (this
suite is the one that actually exercises `createInfrastructure` indirectly,
via `cli.ts`'s `check`/`readiness` commands). Live-verified: a fresh
isolated `:3400` instance booted and served `/health` (`200`) and `/ready`
(`200`, both dependencies `available`) correctly post-fix.
**Caveat**: `createInfrastructure`'s `options.database` override parameter
(used only for test injection, and not exercised by any test in this
codebase today per a repo-wide grep for `createInfrastructure` call sites)
assumes whatever `DatabaseClient` it's given exposes a real `pool` with an
`.on()` method — true for every real caller (`server.ts`, `cli.ts`), but
worth knowing if a future test ever injects a hand-rolled fake.

---

## Part 4 — Operator Runbook (for merging into DEPLOYMENT_RUNBOOK.md)

**Orchestrator note**: per this task's own instructions, `docs/
DEPLOYMENT_RUNBOOK.md` was treated as owned and actively edited by a sibling
production-configuration agent, and was deliberately never touched by this
pass — the content below was written here instead, specifically to avoid a
conflicting edit. **Naming discrepancy observed mid-pass**: a file literally
named `docs/DEPLOYMENT_RUNBOOK.md` does not exist anywhere in this worktree
(confirmed at the end of this pass); the file that *was* actively being
modified concurrently (`git status` showed it as `M` throughout this pass)
is `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`. The orchestrator should merge
the section below into whichever of those two file names is the real,
intended runbook target — most likely `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`,
since that is the one that actually exists and was actively changing.
Suggested heading: "## Operator Runbook — Observability & Failure
Scenarios". Every procedure below is grounded in the code/config verified in
Part 1 — nothing here is generic boilerplate.

### API won't start

1. Check the process's stdout/stderr (journald under systemd:
   `journalctl -u asone-api -n 100`).
2. If the **only** line is the literal string `"API configuration is
   invalid."` (no other detail) — this is `server.ts:10-18`: a required
   environment variable is missing or fails Zod validation in
   `packages/config/src/index.ts`'s `apiSchema`, but the specific
   variable/reason is **not** included in this message (a known, documented
   gap — [OBSERVABILITY_AND_SUPERVISION.md §1.7](OBSERVABILITY_AND_SUPERVISION.md#17-startup-logging--a-documented-current-gap-not-a-fix)).
   Remediation: manually diff the deployed environment file against every
   required key in `packages/config/src/index.ts`'s schema (secrets'
   minimum lengths, `DATABASE_URL`/`REDIS_URL` shape, JWT
   audience/issuer, etc.) — there is currently no faster path than this.
3. If instead you see a **structured `fatal` log line** with message
   `"server startup failed"` and a populated `err` object — this is
   `server.ts:44-51`: `loadApiConfig()` succeeded but `app.listen()` itself
   failed. Read `err.code`: `EADDRINUSE` means another process already owns
   the configured port (`lsof -i :<port>` / `netstat`, kill or reconfigure);
   `EACCES` typically means a privileged port (<1024) without the needed
   capability — do not run the API as root to work around this, configure a
   non-privileged port behind a reverse proxy instead.
4. Confirm `pnpm build` actually produced `apps/api/dist/server.js` and
   every workspace dependency's own `dist/` (`@asone/config`,
   `@asone/database`, `@asone/errors`, `@asone/logger`) — per
   [DEPLOYMENT_PACKAGING.md §1.2](DEPLOYMENT_PACKAGING.md#12-the-build-must-run-the-whole-workspace-graph-not-appsapi-alone),
   building `apps/api` in isolation is not sufficient.

### DB unavailable

1. `curl -s -o /dev/null -w '%{http_code}\n' http://<host>/ready` — `503`
   confirms it from the outside; the body's `services.postgres` field
   confirms it's specifically Postgres, not Redis (`/ready` returns `200`
   for a Redis-only outage — see Part 1 item 2).
2. Check the `asone_readiness_dependency{service="postgres"}` Prometheus
   gauge if `METRICS_ENABLED=true` — it mirrors the same signal continuously,
   without polling `/ready`.
3. **A single idle-connection drop mid-session** (as opposed to Postgres
   being down at boot/probe time) surfaces differently as of this pass's
   fix 2 (Part 3): it is now absorbed by `pg.Pool`'s own internal recovery
   (the broken client is evicted, a fresh one opened on the next query) —
   look for no crash at all, just possibly one request that failed while the
   pool was recovering. If Postgres is down for longer than that, `/ready`
   will show it on the very next probe.
4. Confirm Postgres is actually reachable from the API host on the
   configured port/host (`psql "$DATABASE_URL" -c 'select 1'` from the same
   host the API runs on — network path, firewall, and credentials can all
   independently break this even when the DB service itself is healthy).
5. Once Postgres is restored, no manual API restart should be required —
   `checkReadiness()` (`dependencies.ts:43-56`) re-checks on every `/ready`
   call and the connection pool reconnects on its own; confirm with another
   `/ready` poll.

### Migrations fail

1. Migrations are **never** run automatically at API boot
   ([DEPLOYMENT_PACKAGING.md §1.5](DEPLOYMENT_PACKAGING.md#15-migrations-run-separately--confirmed-not-auto-run-at-boot))
   — they are a standalone, explicit step: `pnpm db:migrate`
   (`packages/database/src/scripts/migrate.ts`).
2. That script has **no top-level try/catch** — on failure (a bad SQL
   statement, a checksum mismatch on an already-applied migration file,
   etc.) it lets the exception propagate, which crashes the script with
   Node's own default uncaught-exception behavior: a full stack trace
   printed to stderr and a non-zero exit code. This is loud by omission —
   there is no ambiguity about whether it succeeded, but read the raw
   Drizzle error message/stack directly from the script's own stderr rather
   than expecting a structured/pino log line (this script does not use the
   logger).
3. **Never run this from a concurrently-booting API replica** — it must run
   once, from a single controlled job, before the API process(es) start or
   restart, exactly per [DEPLOYMENT_PACKAGING.md §1.5](DEPLOYMENT_PACKAGING.md#15-migrations-run-separately--confirmed-not-auto-run-at-boot)'s
   documented ordering.
4. To check current migration state without attempting to apply anything,
   use the read-only `ops check` command (`apps/api/src/operations/cli.ts`)
   — its `postgres.migrations` check
   (`operational-checks.service.ts:130-137`) reports `applied`
   count and whether the latest migration file is present, and is marked
   `unhealthy` if fewer than 9 migrations have applied.
5. If a migration partially applied before failing, do not attempt to
   re-run `pnpm db:migrate` blindly — inspect the actual DB state
   (`drizzle`'s own migrations-journal table) before deciding whether a
   manual rollback or a forward-fix migration is the safe path; this is a
   DBA-judgment step this document does not automate away.

### Logo storage (MinIO) unavailable

1. First determine which of the two MinIO failure modes you're in (Part 1
   item 9): **not configured** (env vars absent — branding routes are
   simply a real `404`, this is expected/normal for a deployment that
   hasn't set up object storage yet) vs. **configured but unreachable**
   (env vars present, MinIO itself down/unreachable — branding upload/
   delete return a generic `500 internal_error`).
2. To tell them apart: `curl -s -o /dev/null -w '%{http_code}\n'
   http://<host>/api/v1/admin/branding/logo` (or whatever the exact route
   path is) with a valid auth token — `404` means not configured (expected,
   not an incident); `500` with the request logged server-side as
   `'request failed'` means configured-but-down (a real incident).
3. `ops check`'s `object_storage.connectivity` row will **not** help here —
   it is hardcoded to always report `unknown`/`not configured` regardless of
   actual MinIO state (a documented gap, Part 1 item 9) — do not rely on it.
4. Confirm MinIO's own health directly:
   `curl -s http://<minio-host>:<MINIO_API_PORT>/minio/health/live`, and
   confirm the container/service is actually running
   (`docker ps` / your process supervisor for the MinIO service).
5. **Every other route is unaffected** — a MinIO outage never blocks app
   boot (routes are registered eagerly at startup based on env-var
   *presence*, not a live connectivity probe) and never blocks any
   non-branding route at request time. This is not a launch blocker on its
   own; treat it as a scoped incident against the branding/logo feature
   only.
6. Once MinIO is restored, no API restart is needed — `BrandingObjectStorage`
   is a plain, stateless S3 client; the very next upload/delete call will
   succeed.

### Cashier cannot login

1. Filter the `'request completed'` log line
   (`request-context.ts:46-60`) to `route: '/api/v1/auth/login'`,
   `status != 200` — this shows volume/timing of failed attempts without any
   credential detail (by design; see below).
2. **Failed login attempts are never written to `audit_log`** — this is
   deliberate (`auth.service.ts`'s `beginLogin` throws
   `invalid_credentials` before any audit call, using the same
   dummy-hash-verify pattern that also prevents user-enumeration via timing)
   — do not expect a durable record of *which* password attempt failed; the
   log-line filter above is the only signal for that.
3. For **successful**-but-anomalous auth activity (token reuse, unexpected
   company/branch switches), query `audit_log` directly:
   `select * from audit_log where action like 'auth.%' order by occurred_at
   desc` — pay particular attention to `auth.refresh_reuse_detected`, a
   genuine security signal (a stale/already-rotated refresh token was
   presented).
4. Confirm `/ready`'s `services.postgres` is `available` first — auth is
   Postgres-only, so a DB outage presents identically to "cashier cannot
   login" from the cashier's point of view.
5. If a specific cashier is locked out but the API itself is healthy, check
   `company_membership`/session state for that actor directly in Postgres
   rather than assuming an API-level incident.

### Register cannot open

1. `apps/api/src/modules/cash/cash.service.ts` throws one of a small,
   specific set of `CashError` codes for this exact operation — the client
   response's `error.code` field tells you precisely which:
   - `cash_session_already_open` (line 299) — the register already has an
     open session; this is the single most common cause and is **not** an
     incident — either resume the existing session or have the previous
     shift close it out first. Query:
     `select * from cash_sessions where cash_register_id = '<id>' and
     status = 'open'`.
   - `resource_not_found` (line 216/238) — the register ID doesn't exist or
     isn't visible to this actor's company/branch scope.
   - `validation_error` — either "The register is not active" (line 296,
     the register itself is disabled) or "The device does not belong to
     this branch" (line 246, a device/branch mismatch) — check the
     register's `is_active` flag and the requesting device's registered
     branch.
2. All three are safe, deterministic rejections backed by a real unique
   constraint (`cash_sessions_register_active_uq`, per the code's own
   comment at line 269-272) — there is no race condition where two opens
   both silently succeed.
3. If none of the above codes come back and the request instead times out
   or 500s, treat it as a DB-availability incident (see "DB unavailable"
   above), not a cash-module-specific one.

### Payment appears duplicated

1. Every payment-mutating route requires an `Idempotency-Key` header
   (`payments.routes.ts`'s `idempotencyHeaders` schema, required on all four
   payment-confirmation routes) — a retried request with the **same** key
   returns the **original** result with an `idempotency-replayed: true`
   response header, never a second charge/record.
2. First check for that header on the client's retried response — if
   present, this is not a duplicate; it's the idempotency layer correctly
   returning the cached original result. Confirm by querying the
   `idempotency_keys` table directly for that key
   (`select * from idempotency_keys where id = '<key>'`) — one row,
   `response_status=201`, one `resource_id`.
3. If the client retried **without** reusing the same idempotency key (a
   client-side bug — generating a fresh key per retry defeats the whole
   mechanism), you will see two distinct real payment rows for what the
   operator perceives as "one" transaction. Confirm by querying `audit_log`
   for `action` values under the payments module for the sale in question,
   cross-referenced by `entity_id` — two different `id`s with two different
   `request_id`s but the same `sale_id` in their `metadata` is the
   signature of this specific client bug, distinct from a real duplicate
   charge.
4. For an actual Mercado Pago-side double-charge concern specifically: out
   of scope for this certification pass — Mercado Pago remains paused for
   the entire RC freeze per
   [RC_FREEZE_POLICY.md](RC_FREEZE_POLICY.md#mercado-pago); no live provider
   calls occur, so this scenario can only currently arise for cash/other
   locally-settled payment methods, which the idempotency-key mechanism
   above fully covers.

### Inventory discrepancy

1. Run the read-only `ops inventory` CLI command
   (`apps/api/src/operations/cli.ts`, backed by
   `OperationalChecksRepository.inventory()`) — it reports
   `openCriticalFindings`, `expiredCountLocks`, and
   `expiredActiveReservations` without mutating anything. A non-zero
   `openCriticalFindings` is the strongest signal something is already
   wrong; `ops check`'s own `inventory.operations` row
   (`operational-checks.service.ts:194-207`) surfaces the same numbers
   continuously as part of the general health sweep.
2. For a suspected balance-vs-ledger mismatch specifically, run
   `ops shadow-rebuild --company-id <id>` (optionally scoped further by
   `--branch-id`/`--location-id`/`--product-variant-id`) — this is a
   read-only comparison
   (`apps/api/src/operations/shadow-rebuild.service.ts`) that walks real
   movement history and reports `mismatches`/`missing_balances` counts
   without writing anything. A non-zero count here is the concrete,
   actionable signal — cite the specific location/variant IDs it returns
   rather than escalating on "inventory feels wrong" alone.
3. Both commands are chunked/paginated (`--cursor`, `OPS_SHADOW_REBUILD_
   CHUNK_SIZE`, default 250) for a large catalog — run them to completion
   before concluding "no discrepancy," not just the first page.
4. Neither command repairs anything — they are diagnostic only, by design
   (the CLI's own `help` output states "read-only; restore validation is
   dry-run only"). Any actual correction is a separate, explicit, audited
   mutation through the normal inventory-adjustment routes, never a side
   effect of running a check.

### Stuck held sale

1. Held-sale carts move through a small, explicit state machine
   (`apps/api/src/modules/held-sales/held-sales.service.ts`): `held` →
   `resuming` → (`claimed`/linked to a real sale, or rolled back to `held`
   again). Query the cart directly:
   `select id, status, updated_at from held_sale_carts where id = '<id>'`.
2. If `status = 'resuming'` and `updated_at` is old (minutes, not seconds)
   — this is the stuck case. The transition into `resuming` uses a
   compare-and-swap `WHERE status = 'held'` (line 221-222,
   `HeldSaleCartError('resource_not_found', ...)` if the row wasn't found in
   that exact state), and the transition **out** of `resuming` similarly
   requires `WHERE status = 'resuming'` — so a genuinely stuck cart means
   the client that claimed it crashed or lost connectivity between the two
   steps, never a server-side race (two concurrent resume attempts against
   the same cart are already deterministically resolved: "the second caller
   simply finds no row" per the code's own comment at line 256-258).
3. Every state transition is independently audited
   (`held_sale_cart.create`/`held`/`resume`/`claimed`/`link_sale` actions in
   `audit_log`) — query
   `select * from audit_log where entity_type = 'held_sale_cart' and
   entity_id = '<id>' order by occurred_at` to reconstruct exactly which
   step the stuck cart last completed, and on which device/actor/request_id,
   before deciding on a manual remediation.
4. There is currently no automatic timeout that reclaims a cart stuck in
   `resuming` back to `held` — remediation today is a manual, explicit
   update once the audit trail confirms the client genuinely abandoned the
   resume (not a launch blocker for a single-store deployment with a small
   cashier count, but worth flagging to product/ops as a candidate for a
   future automatic reclaim-after-timeout job).

---

## Part 5 — Files touched by this pass

- **New**: `docs/RC_OBSERVABILITY.md` (this file).
- **Modified** (both narrowly-scoped fixes, Part 3): `apps/api/src/plugins/
  request-context.ts`, `apps/api/src/infrastructure/dependencies.ts`.
- **Not modified**: `docs/DEPLOYMENT_RUNBOOK.md` — deliberately left
  untouched per this task's own instructions (owned by a concurrently-active
  sibling agent); its intended addition lives in Part 4 above, ready to be
  merged in by the orchestrator.
