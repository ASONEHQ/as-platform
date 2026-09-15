# Production Deployment Runbook

TASK 14.1 — the concrete, reproducible procedure a trusted operator follows
to take AS POS from "code in the repo" to "a real store operating on it."
Every command below was actually run, in this exact order, against a fresh
database during this task's own staging rehearsal (a disposable database,
never `asone_local`/`asone_test`) — this is not a speculative plan.

**Re-verified at TASK 15.0 Phase 9** (RC certification) against current
HEAD. The launch topology table immediately below has one correction from
its TASK 14.1 version: MinIO is no longer "DEV-ONLY / not wired" — TASK
14.5A wired it for the optional business-logo branding feature. See
`docs/RC_PRODUCTION_CONFIG.md` section 5 and
`docs/PRODUCTION_ENVIRONMENT.md`'s new MinIO section for the full
evidence; the short version is that it remains fully optional for
launch — the API boots and the entire core POS flow works identically
with or without it.

**Re-verified again at TASK 15.0 Phase 10** (backup/restore certification)
and **Phase 14** (observability certification): a real backup/verify/
restore cycle was proven end-to-end against a real tenant's live data
(see `docs/RC_BACKUP_RESTORE.md` — bit-for-bit exact row counts and
financial/inventory totals after a real restore into a separate
database), and the operator failure-scenario runbook further down this
document (`## Operator Runbook — Observability & Failure Scenarios`) was
added from that pass's own live findings. Also corrected: the migration
count below was stale (said 24; the real, current count at this
checkpoint is **29**, confirmed directly via
`drizzle.__drizzle_migrations`).

## 0. Launch topology (Part A)

The smallest reliable architecture for a September 15 single-store launch:

| Service | Classification | Why |
| --- | --- | --- |
| PostgreSQL | **REQUIRED** | The only datastore the core POS flow (login → sale → payment → receipt) reads or writes. |
| Redis | **REQUIRED to boot, not required for core POS** | `packages/config` requires `REDIS_URL` to parse at startup, but grepping every module under `apps/api/src/modules/{auth,sales,cash,payments,refunds,promotions,loyalty,rewards}` finds zero references — nothing on the login→sale→payment→receipt path touches it (confirmed directly, not assumed; see `docs/PRODUCTION_ENVIRONMENT.md`). `/ready`'s HTTP status now reflects this (Part D, below) — a Redis outage degrades observability/ops tooling, never the register. |
| RabbitMQ | **DEV-ONLY / not wired** | No config key, no client, no reference anywhere in `apps/api`'s real request path. |
| MinIO / S3-compatible object storage | **OPTIONAL — branding logo upload AND product-photo upload** | TASK 14.5A wired `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_API_PORT` (read directly, outside `packages/config`'s schema) for the business-logo upload/delete routes; TASK 16.6 added the product-image upload/delete routes as a second consumer of the exact same variables (TASK 16.6A also added an optional `MINIO_ENDPOINT` for a genuinely remote provider like DigitalOcean Spaces — see `docs/PRODUCTION_OBJECT_STORAGE_SETUP.md`). Verified directly in `apps/api/src/bootstrap/register-plugins.ts`: when these vars are absent, `objectStorageConfigFromEnv()` returns `undefined` (never throws) and BOTH sets of routes are simply never registered (a real 404) — every other route, and the app's own boot, is completely unaffected. Provision it only if the operator wants the logo-upload and/or product-photo features live at launch; skip it otherwise. |
| Mailpit | **DEV-ONLY** | Local SMTP capture for developer convenience; nothing in the API sends real email yet. |
| API (Fastify) | **REQUIRED** | Runs compiled (`node dist/server.js`), never `tsx watch`, in production — see Part J of `docs/DEPLOYMENT_PACKAGING.md`. |
| Flutter Web | **REQUIRED** | The cashier/owner-facing app; a separate, independently-deployed static build — see `docs/DEPLOYMENT_PACKAGING.md`. |
| Cloudflare | **OPTIONAL** | One viable edge/DNS/TLS provider among several — see `docs/DOMAIN_AND_HTTPS_TOPOLOGY.md`; nothing in the code assumes it specifically. |

**Conclusion:** launch needs exactly two running processes (API + a static
file host for the Flutter build) and one required dependency (PostgreSQL).
Redis should be provisioned (the API won't boot without a reachable
`REDIS_URL`) but a real store can keep selling through a Redis outage.

## Pre-deploy

### 1. DNS / HTTPS

Provision the two subdomains from `docs/DOMAIN_AND_HTTPS_TOPOLOGY.md` (e.g.
`app.asone.mx` for Flutter, `api.asone.mx` for the API), each behind a
TLS-terminating reverse proxy/load balancer — Fastify itself never
terminates TLS in production (`TRUST_PROXY` exists precisely because a
proxy sits in front of it). Do not point DNS at anything yet if this is a
rehearsal — this runbook does not require or perform a real DNS change.

### 2. Database

Provision a real PostgreSQL instance reachable from the API host. Per Part
C (`docs/PRODUCTION_GAPS.md` §5, now resolved): the connection string MUST
carry `sslmode=require`, `verify-ca`, or `verify-full` — `DATABASE_URL`
validation fails closed in `NODE_ENV=production` otherwise (see
`docs/PRODUCTION_ENVIRONMENT.md`). If your provider terminates TLS outside
the Postgres wire protocol (a proxy/sidecar), set
`DATABASE_TLS_EXTERNALLY_TERMINATED=true` explicitly instead of omitting
`sslmode`.

### 3. Secrets / env

Fill in every required variable from `docs/PRODUCTION_ENVIRONMENT.md` —
`AUTH_ACCESS_TOKEN_SECRET` (rejected in production if it's short,
low-entropy, or placeholder-shaped — verified by `packages/config`'s own
tests), `DATABASE_URL`, `REDIS_URL`, `CORS_ALLOWED_ORIGINS` (the real
`app.asone.mx`-style origin, never `*`), `AUTH_JWT_ISSUER`/`AUTH_JWT_AUDIENCE`.
No value in this step should ever be committed to git or pasted into a
chat/ticket in plaintext — use whatever secrets manager your host
provides.

**Optional — only if the business-logo branding and/or product-image
features should be live at launch (TASK 16.6A: both now share ONE
provisioning step):** also set `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`,
and either `MINIO_API_PORT` (co-located MinIO) or the newer
`MINIO_ENDPOINT` (a genuinely remote S3-compatible endpoint, e.g.
DigitalOcean Spaces) — pointed at a real, reachable S3-compatible
deployment. These are read directly by `objectStorageConfigFromEnv()`
(`apps/api/src/infrastructure/object-storage.ts`), not through
`packages/config`, and are entirely optional — omitting them does not
affect `DATABASE_URL`/`REDIS_URL`/any other step below, boots the API
normally, and simply leaves the two branding routes AND the two
product-image routes returning 404. See
`docs/PRODUCTION_OBJECT_STORAGE_SETUP.md` for the full, concrete
DigitalOcean-compatible provisioning plan, `docs/PRODUCTION_ENVIRONMENT
.md`'s object-storage section, and `docs/RC_PRODUCTION_CONFIG.md`
section 5 for the original evidence trail.

### 4. Backup

Before touching a database that already holds real data (i.e., every
deploy AFTER the very first one), take a backup:

```
DATABASE_URL=<production URL> node scripts/production/backup-db.mjs --out-dir /secure/backup/path
```

This writes a timestamped `.dump` file AND a `<file>.manifest.json`
sidecar. Verify it immediately, before relying on it:

```
pnpm --filter @asone/api ops backup-verify --manifest /secure/backup/path/<file>.manifest.json
```

See `docs/BACKUP_STRATEGY.md` for retention/offsite/encryption guidance —
this step only produces one correct local file; rotation and off-host copy
are the operator's own responsibility.

**If the business-logo branding feature (step 3) is enabled: this backup
does NOT protect uploaded logos.** Confirmed by direct code inspection
(`docs/RC_BACKUP_RESTORE.md` §5): the database stores only a
`branding.logo_url` *reference*; the actual logo image bytes live in
MinIO object storage. A Postgres-only backup/restore, after a real
disaster, brings back a company record pointing at a logo object that no
longer exists unless MinIO's own data was *separately* backed up (e.g.
`mc mirror` to a secondary bucket, or a volume-level snapshot of the
MinIO data directory) on its own schedule. Do not treat a verified
database backup as covering uploaded logos — it does not.

### 5. Build artifacts

```
pnpm install --frozen-lockfile
pnpm build            # builds every workspace package, including @asone/api's dist/
cd apps/one && flutter build web --release --dart-define=AS_API_BASE_URL=https://api.asone.mx [--dart-define=AS_ENV=production]
```

See `docs/DEPLOYMENT_PACKAGING.md` for the exact artifact boundaries (the
API's `dist/` + `node_modules`, and Flutter's independent `build/web/`).

## Deploy

### 6. Migrations

Run BEFORE the API accepts traffic — never auto-run at API boot (confirmed:
`apps/api/src/server.ts` never calls into `packages/database`'s migrator).

```
DATABASE_URL=<production URL> pnpm --filter @asone/database db:migrate
```

**Fresh database:** every one of the 29 (currently) migration files
applies in order, tracked in drizzle's own migrations table.

**Existing database:** only migrations not yet recorded apply — safe to
re-run; already-applied migrations are skipped, never re-executed
(`drizzle-orm/node-postgres/migrator`'s own idempotent behavior, confirmed
by reading `packages/database/src/scripts/migrate.ts`).

**Failed migration:** the script throws and exits nonzero — drizzle's
migrator applies each migration file in its own transaction, so a failure
mid-file rolls that one file back; migrations before it remain correctly
recorded as applied. Operator response: **do not proceed to start the
API.** Read the actual error, fix the root cause (a real schema conflict,
a connectivity blip), and re-run the same command — it will correctly
resume from the first unapplied migration. If the failure is not
immediately understood, restore the pre-deploy backup (step 4) into a
verification database first (`scripts/production/verify-restore.mjs`) to
inspect the real prior state before deciding on a fix, per Part S below.

### 7. Technical seed

```
DATABASE_URL=<production URL> pnpm --filter @asone/database db:seed
```

Idempotent (`ON CONFLICT DO NOTHING`) — inserts the approved permission
catalogue (75 codes as of this task; `seedTechnicalPermissions` reports
exactly how many were newly inserted). Safe to re-run on every deploy;
never destroys or alters an existing row. See Part H below for the full
seed classification — this is the ONLY seed command that belongs in a
production deploy.

### 8. First-owner provisioning (fresh tenant only — Part E)

**Skip this step entirely if the company already exists** (a redeploy of
an already-launched store). For a genuinely new tenant:

```
DATABASE_URL=<production URL> \
  node dist/provisioning/production-owner.cli.js \
  --company-legal-name="<Real Legal Name>" \
  --company-slug=<kebab-case-slug> \
  --owner-name="<Real Owner Name>" \
  --owner-email=<real-owner-email> \
  [--branch-name="<First Branch Name>" --branch-code=<CODE>]
```

Run this from an interactive terminal so the owner's password is entered
masked (never echoed, never logged) — the tool prompts for it and a
confirmation. If run non-interactively (e.g. from an automation script),
set `PROVISION_OWNER_PASSWORD` first and **unset it immediately after the
command finishes** — it is real credential material.

The tool shows exactly what it's about to create (including which
database, host redacted of its password) and requires typing `yes` before
writing anything, unless `--yes` is passed. It refuses outright — never
silently upserts — if a company with that slug already exists (see
`production-owner.service.ts`'s own D1 doc comment for why). It requires
the technical seed (step 7) to have already run; it grants the new owner
role every permission currently in the catalogue — a real company's
owner controls everything in their own tenant.

**Verify:** the CLI prints a JSON summary (company id, owner user id,
role id, permission count, branch id if created) — no password anywhere
in it. Confirm you can log in as the owner at `POST /api/v1/auth/login`
before proceeding.

### 9. API start

Never `tsx watch` in production:

```
NODE_ENV=production DATABASE_URL=<...> REDIS_URL=<...> AUTH_ACCESS_TOKEN_SECRET=<...> \
  [... every other required var from docs/PRODUCTION_ENVIRONMENT.md ...] \
  node dist/server.js
```

Under real process supervision (systemd unit / Docker Compose service —
see `docs/OBSERVABILITY_AND_SUPERVISION.md`), not a bare foreground
command.

### 10. Health / ready

```
curl https://api.asone.mx/health   # {"status":"ok",...}
curl https://api.asone.mx/ready    # 200 once Postgres is reachable (Part D — Redis no longer gates this)
```

Do not route real traffic to the API until both return successfully.

### 11. Flutter deploy

Upload `apps/one/build/web/` to your static host, with SPA fallback
routing configured (unknown paths serve `index.html` — see
`docs/DEPLOYMENT_PACKAGING.md`) and cache headers set per that same doc
(never long-cache `index.html` itself).

### 12. Browser smoke test

Open the deployed Flutter URL, confirm the login screen loads and can
reach the API (check the browser network tab for a successful
`/api/v1/auth/login` round trip against the real API origin, not a CORS
failure).

## Business setup (fresh tenant only)

### 13. Branch

If not created at provisioning time (step 8's optional branch flags),
the owner creates it after logging in: `POST /api/v1/companies/{id}/branches`.

### 14. Register

The owner creates the store's first cash register:
`POST /api/v1/cash-registers` (`{branch_id, code, name}`).

### 15. Users / roles

The owner creates real staff accounts (`POST /api/v1/users`), a real
minimal Cashier role scoped to exactly what a cashier needs (`POST
/api/v1/roles` + `PUT /api/v1/roles/{id}/permissions` — see the exact
permission list this task's own rehearsal used, in
`docs/GO_LIVE_CHECKLIST.md`), activates each new account with a real
password (`PATCH /api/v1/users/{id}` — this now REQUIRES a password on
first activation, per TASK 14.0's own fix), and assigns branch access.

### 16. Catalog / prices / inventory

Create real products through the authenticated catalog API
(`POST /api/v1/categories`, `POST /api/v1/products` — remember `status`
defaults to `draft`, set `status: "active"` explicitly or `PATCH` it
afterward — and `POST /api/v1/products/{id}/prices`). **Never** run any
`dev:seed-*` command against a production database — see Part H; they are
hard-gated to loopback/allowlisted-name databases and will refuse anyway,
but the correct mental model is that they should never even be attempted
here.

## Go-live test (every launch, fresh or redeploy)

### 17. Open register

Cashier logs in, opens the register with a real counted opening float.

### 18. Test sale

A real cash sale for a real catalog item, exact tender and one with
change, to prove both paths.

### 19. Receipt

Fetch/print the receipt for that sale; confirm the folio, totals, and (if
applicable) reward/discount lines render correctly and reprint
identically.

### 20. Refund / reprint if appropriate

If your launch policy grants the cashier `refund.*`, perform one small
test refund and confirm the math. Otherwise confirm a refund attempt is
cleanly denied (403), matching your intended policy.

### 21. Close / reopen verification

Close the register (declared amount + optional denomination counts),
confirm the discrepancy computes correctly, then confirm a NEW session can
be opened cleanly afterward — proving the full daily cycle works before
handing the register to a real cashier for a real business day.

## Operator Runbook — Observability & Failure Scenarios

Merged in from TASK 15.0 Phase 14's observability certification pass
(`docs/RC_OBSERVABILITY.md`, which has the full certification detail and
file:line citations behind every procedure below — this section only
carries the operator-facing runbook itself). Every procedure below is
grounded in the actual code/config verified in that pass, re-tested live
against isolated API instances, not generic boilerplate.

### API won't start

1. Check the process's stdout/stderr (journald under systemd:
   `journalctl -u asone-api -n 100`).
2. If the **only** line is the literal string `"API configuration is
   invalid."` (no other detail) — a required environment variable is
   missing or fails Zod validation in `packages/config/src/index.ts`'s
   `apiSchema`, but the specific variable/reason is **not** included in
   this message (a known, documented gap). Remediation: manually diff the
   deployed environment file against every required key in that schema
   (secrets' minimum lengths, `DATABASE_URL`/`REDIS_URL` shape, JWT
   audience/issuer, etc.) — there is currently no faster path than this.
3. If instead you see a **structured `fatal` log line** with message
   `"server startup failed"` and a populated `err` object —
   `loadApiConfig()` succeeded but `app.listen()` itself failed. Read
   `err.code`: `EADDRINUSE` means another process already owns the
   configured port (`lsof -i :<port>` / `netstat`, kill or reconfigure);
   `EACCES` typically means a privileged port (<1024) without the needed
   capability — do not run the API as root to work around this, configure
   a non-privileged port behind a reverse proxy instead.
4. Confirm `pnpm build` actually produced `apps/api/dist/server.js` and
   every workspace dependency's own `dist/` (`@asone/config`,
   `@asone/database`, `@asone/errors`, `@asone/logger`) — building
   `apps/api` in isolation is not sufficient (see
   `docs/DEPLOYMENT_PACKAGING.md` §1.2).

### DB unavailable

1. `curl -s -o /dev/null -w '%{http_code}\n' http://<host>/ready` — `503`
   confirms it from the outside; the body's `services.postgres` field
   confirms it's specifically Postgres, not Redis (`/ready` returns `200`
   for a Redis-only outage).
2. Check the `asone_readiness_dependency{service="postgres"}` Prometheus
   gauge if `METRICS_ENABLED=true` — it mirrors the same signal
   continuously, without polling `/ready`.
3. **A single idle-connection drop mid-session** (as opposed to Postgres
   being down at boot/probe time) is absorbed by `pg.Pool`'s own internal
   recovery (the broken client is evicted, a fresh one opened on the next
   query, per a real fix made during Phase 14 — a bare `pool.on('error',
   ...)` listener, `apps/api/src/infrastructure/dependencies.ts`) — look
   for no crash at all, just possibly one request that failed while the
   pool was recovering.
4. Confirm Postgres is actually reachable from the API host on the
   configured port/host (`psql "$DATABASE_URL" -c 'select 1'` from the
   same host the API runs on).
5. Once Postgres is restored, no manual API restart should be required —
   `checkReadiness()` re-checks on every `/ready` call and the connection
   pool reconnects on its own; confirm with another `/ready` poll.

### Migrations fail

1. Migrations are **never** run automatically at API boot — they are a
   standalone, explicit step: `pnpm db:migrate`.
2. That script has **no top-level try/catch** — on failure it lets the
   exception propagate, printing a full stack trace to stderr with a
   non-zero exit code (loud by omission; not a structured/pino log line —
   read the raw stderr directly).
3. **Never run this from a concurrently-booting API replica** — it must
   run once, from a single controlled job, before the API process(es)
   start or restart.
4. To check current migration state without attempting to apply anything,
   use the read-only `ops check` command — its `postgres.migrations` check
   reports `applied` count and whether the latest migration file is
   present.
5. If a migration partially applied before failing, do not re-run
   blindly — inspect the actual DB state (drizzle's own migrations-journal
   table) before deciding whether a manual rollback or a forward-fix
   migration is the safe path.

### Object storage (MinIO/S3-compatible — logo AND product-photo) unavailable

TASK 16.6A note: branding logo and product-photo storage now share ONE
implementation and ONE set of env vars (see
`docs/PRODUCTION_OBJECT_STORAGE_SETUP.md`) — an outage or misconfiguration
affects both features identically; there is no longer a scenario where
only one of the two is degraded while the other works.

1. First determine which of the two failure modes you're in: **not
   configured** (env vars absent — both the branding routes and the
   product-image routes are simply a real `404`, expected/normal) vs.
   **configured but unreachable** (env vars present, the S3-compatible
   endpoint itself down or credentials wrong — upload/delete on either
   feature return a generic `500 internal_error`, or a `415`/`413` for a
   genuinely bad file, which is not an incident).
2. To tell them apart: hit either the branding logo route or a product's
   image route with a valid auth token — `404` means not configured (not
   an incident); `500` logged server-side as `'request failed'` means
   configured-but-down (a real incident). The Flutter app itself now
   shows an honest, specific message for the `404` case ("El
   almacenamiento de imágenes no está disponible en este servidor.
   Contacta a soporte.") rather than a generic error — if a user reports
   that exact message, it is confirmation, not a new symptom to chase.
3. `ops check`'s `object_storage.connectivity` row will **not** help
   here — it is hardcoded to always report `unknown` regardless of actual
   object-storage state (a documented gap) — do not rely on it.
4. Confirm the endpoint's own health directly. Self-hosted MinIO (Option
   B in `docs/PRODUCTION_OBJECT_STORAGE_SETUP.md`):
   `curl -s http://<minio-host>:<MINIO_API_PORT>/minio/health/live`, and
   confirm the container/service is actually running. DigitalOcean
   Spaces (Option A): check DigitalOcean's own status page and confirm
   the configured `MINIO_ENDPOINT`/access key are still correct — a
   rotated or revoked Spaces key looks identical to "MinIO is down" from
   the API's perspective (a real `500`, not a `404`).
5. **Every other route is unaffected** — an object-storage outage never
   blocks app boot or any unrelated route. Treat it as a scoped incident
   against the branding/logo and product-photo features only; the rest
   of Productos/Catálogo (create, edit, duplicate, categoría/marca/
   proveedor/IVA/favorito/ícono/card-color) is completely unaffected.
6. Once the endpoint is restored, no API restart is needed — the very
   next upload/delete call will succeed.

### Cashier cannot login

1. Filter the `'request completed'` log line to `route:
   '/api/v1/auth/login'`, `status != 200` — shows volume/timing of failed
   attempts without any credential detail (by design).
2. **Failed login attempts are never written to `audit_log`** — deliberate
   (the same dummy-hash-verify pattern that also prevents
   user-enumeration via timing) — the log-line filter above is the only
   signal for that.
3. For **successful**-but-anomalous auth activity (token reuse, unexpected
   company/branch switches), query `audit_log` directly: `select * from
   audit_log where action like 'auth.%' order by occurred_at desc` — pay
   particular attention to `auth.refresh_reuse_detected`, a genuine
   security signal.
4. Confirm `/ready`'s `services.postgres` is `available` first — auth is
   Postgres-only.
5. If a specific cashier is locked out but the API itself is healthy,
   check `company_membership`/session state for that actor directly in
   Postgres.

### Register cannot open

1. The client response's `error.code` field tells you precisely why:
   - `cash_session_already_open` — the register already has an open
     session; the single most common cause and **not** an incident —
     resume the existing session or have the previous shift close it out
     first. Query: `select * from cash_sessions where cash_register_id =
     '<id>' and status = 'open'`.
   - `resource_not_found` — the register ID doesn't exist or isn't
     visible to this actor's company/branch scope.
   - `validation_error` — either the register is inactive or the device
     doesn't belong to this branch.
2. All three are safe, deterministic rejections backed by a real unique
   constraint (`cash_sessions_register_active_uq`) — there is no race
   condition where two opens both silently succeed.
3. If none of the above codes come back and the request instead times out
   or 500s, treat it as a DB-availability incident (see "DB unavailable"
   above).

### Payment appears duplicated

1. Every payment-mutating route requires an `Idempotency-Key` header — a
   retried request with the **same** key returns the **original** result
   with an `idempotency-replayed: true` response header, never a second
   charge/record.
2. First check for that header on the client's retried response — if
   present, this is not a duplicate. Confirm by querying the
   `idempotency_keys` table directly for that key.
3. If the client retried **without** reusing the same idempotency key (a
   client-side bug), you will see two distinct real payment rows for what
   the operator perceives as "one" transaction. Confirm via `audit_log`
   cross-referenced by `entity_id`.
4. For an actual Mercado Pago-side double-charge concern: out of scope —
   Mercado Pago remains paused for the entire RC freeze (see
   `docs/RC_FREEZE_POLICY.md`); no live provider calls occur.

### Inventory discrepancy

1. Run the read-only `ops inventory` CLI command — reports
   `openCriticalFindings`, `expiredCountLocks`, and
   `expiredActiveReservations` without mutating anything.
2. For a suspected balance-vs-ledger mismatch specifically, run `ops
   shadow-rebuild --company-id <id>` — a read-only comparison that walks
   real movement history and reports `mismatches`/`missing_balances`
   counts without writing anything.
3. Both commands are chunked/paginated for a large catalog — run them to
   completion before concluding "no discrepancy."
4. Neither command repairs anything — diagnostic only, by design. Any
   actual correction is a separate, explicit, audited mutation through the
   normal inventory-adjustment routes.

### Stuck held sale

1. Held-sale carts move through a small, explicit state machine: `held` →
   `resuming` → (`claimed`, or rolled back to `held`). Query the cart
   directly: `select id, status, updated_at from held_sale_carts where id
   = '<id>'`.
2. If `status = 'resuming'` and `updated_at` is old (minutes, not
   seconds) — this is the stuck case; means the client that claimed it
   crashed or lost connectivity mid-transition, never a server-side race
   (a CAS guard means a second concurrent resume attempt simply finds no
   row).
3. Every state transition is independently audited — query `select * from
   audit_log where entity_type = 'held_sale_cart' and entity_id = '<id>'
   order by occurred_at` to reconstruct exactly which step the stuck cart
   last completed before deciding on a manual remediation.
4. There is currently no automatic timeout that reclaims a cart stuck in
   `resuming` back to `held` — remediation today is a manual, explicit
   update once the audit trail confirms genuine client abandonment (not a
   launch blocker for a single-store deployment with a small cashier
   count; a candidate for a future automatic reclaim-after-timeout job).

## Rollback (Part S)

**Code rollback** — API: redeploy the previous known-good `dist/` +
`node_modules` artifact and restart the process; this is independent of
the database (no migration is reverted). Flutter: redeploy the previous
`build/web/` artifact to the static host — entirely independent of the
API's own rollback, since they are separate artifacts (Part J).

**Database — never blindly downgrade migrations.** This codebase has no
"down" migrations by design (matching its own additive-migration
discipline, verified across all 29 files at the current TASK 15.0
checkpoint — 24 at TASK 14.0's own original audit, since grown
additively). If a deploy's migration is genuinely wrong:

1. **Prefer a forward fix** — write and apply a new, additive migration
   that corrects the problem, exactly like every other schema change in
   this codebase's history. This is almost always safer than any
   downgrade, because a real store may have already written new rows
   against the new schema.
2. **Restore from backup only as a last resort**, and only if real data
   corruption occurred (not merely "the deploy looked wrong") — restore
   into a fresh verification database first
   (`scripts/production/verify-restore.mjs`) to confirm exactly what state
   you'd be reverting to before ever touching the primary database.

**Migration succeeded, but the deploy fails before traffic is routed**
(step 9/10 fails): the database is in a valid, migrated state — safe to
leave as-is. Fix the API process/config issue and retry step 9; do not
re-run migrations (they're already applied and will no-op harmlessly, but
there's no need to).

**Frontend deployment fails**: roll back independently per the Code
rollback paragraph above — the API and database are untouched by a
Flutter-only deploy, so there is nothing else to recover.
