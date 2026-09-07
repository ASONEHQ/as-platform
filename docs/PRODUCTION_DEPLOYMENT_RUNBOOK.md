# Production Deployment Runbook

TASK 14.1 — the concrete, reproducible procedure a trusted operator follows
to take AS POS from "code in the repo" to "a real store operating on it."
Every command below was actually run, in this exact order, against a fresh
database during this task's own staging rehearsal (a disposable database,
never `asone_local`/`asone_test`) — this is not a speculative plan.

## 0. Launch topology (Part A)

The smallest reliable architecture for a September 15 single-store launch:

| Service | Classification | Why |
| --- | --- | --- |
| PostgreSQL | **REQUIRED** | The only datastore the core POS flow (login → sale → payment → receipt) reads or writes. |
| Redis | **REQUIRED to boot, not required for core POS** | `packages/config` requires `REDIS_URL` to parse at startup, but grepping every module under `apps/api/src/modules/{auth,sales,cash,payments,refunds,promotions,loyalty,rewards}` finds zero references — nothing on the login→sale→payment→receipt path touches it (confirmed directly, not assumed; see `docs/PRODUCTION_ENVIRONMENT.md`). `/ready`'s HTTP status now reflects this (Part D, below) — a Redis outage degrades observability/ops tooling, never the register. |
| RabbitMQ | **DEV-ONLY / not wired** | No config key, no client, no reference anywhere in `apps/api`'s real request path. |
| MinIO | **DEV-ONLY / not wired** | Same — confirmed absent from `packages/config`'s schema entirely. |
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

**Fresh database:** every one of the 24 (currently) migration files
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

## Rollback (Part S)

**Code rollback** — API: redeploy the previous known-good `dist/` +
`node_modules` artifact and restart the process; this is independent of
the database (no migration is reverted). Flutter: redeploy the previous
`build/web/` artifact to the static host — entirely independent of the
API's own rollback, since they are separate artifacts (Part J).

**Database — never blindly downgrade migrations.** This codebase has no
"down" migrations by design (matching its own additive-migration
discipline, verified across all 24 files in TASK 14.0's own audit). If a
deploy's migration is genuinely wrong:

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
