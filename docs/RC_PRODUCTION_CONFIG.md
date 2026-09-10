# RC Production Configuration — TASK 15.0 Phase 9

Governed by `docs/RC_FREEZE_POLICY.md`. This phase re-verifies TASK 14.1's
production foundation (`docs/PRODUCTION_ENVIRONMENT.md`,
`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`, `docs/GO_LIVE_CHECKLIST.md`)
against current HEAD, whose only material change since TASK 14.1 last
reviewed this area is TASK 14.5A's branding/object-storage dependency
(`apps/api/src/modules/admin/branding/branding.storage.ts` +
`apps/api/src/bootstrap/register-plugins.ts`'s branding-registration
block). Every claim below was verified by reading the actual code at this
commit, not by trusting an existing doc comment — code quotes are exact.

**Verdict: no RED item. No code fix was required or made.** The three
existing docs needed updates (below); nothing under
`packages/config/src/index.ts` or `apps/api/src/bootstrap/**` needed to
change, because the code already does what its own comments claim.

---

## 1. Required environment variables — schema vs. usage vs. `.env.example`

`packages/config/src/index.ts`'s `sharedSchema`/`apiSchema` declare every
variable `apps/api`/`apps/worker` need to boot (`NODE_ENV`, `APP_NAME`,
`APP_VERSION`, `LOG_LEVEL`, `DATABASE_URL`,
`DATABASE_TLS_EXTERNALLY_TERMINATED`, `REDIS_URL`, plus the `apps/api`-only
extension — see `docs/PRODUCTION_ENVIRONMENT.md` for the full per-variable
table, unchanged and still accurate at this commit).

Grepping `process.env` across `apps/api/src`, `apps/worker/src`,
`packages/config/src`:

- `apps/worker/src` and `packages/config/src`: zero direct `process.env`
  reads outside the schema loaders' own `= process.env` defaults.
- `apps/api/src`: every non-test hit is one of: `DATABASE_TEST_URL` (test
  fixtures, intentionally outside the schema), `PROVISION_OWNER_PASSWORD`
  (`provisioning/production-owner.cli.ts` — a one-shot CLI secret, not app
  boot config), `AS_DEV_BOOTSTRAP_PASSWORD` (dev-only CLI), `DATABASE_URL`
  read a second time in `operations/restore-safety.ts` purely to compare
  against a restore target (a safety check, not a config load),
  `OPS_*` variables in `operations/operational-config.ts` (a separate,
  self-validated, all-optional config loader used only by the `ops` CLI,
  never by the API server's own boot path), and — the one real finding —
  **`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_API_PORT`**, read
  directly by `branding.storage.ts`'s `brandingStorageConfigFromEnv()`,
  entirely outside the Zod schema (full detail in section 5).

`.env.example` (repo root): every variable it lists is consumed somewhere
— either by `packages/config`'s schema, by `compose.yaml` (the
`POSTGRES_*`/`REDIS_PASSWORD`/`REDIS_PORT`/`MINIO_CONSOLE_PORT`/
`MAILPIT_*` local-container ports), or by `branding.storage.ts` directly
(`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_API_PORT`). Nothing stale.

**One real doc gap found**: `DATABASE_TLS_EXTERNALLY_TERMINATED` is a real
Zod-schema variable (`packages/config/src/index.ts:43`) but does not
appear anywhere in `.env.example` — an operator copying `.env.example` as
a starting point has no example line for this production TLS escape
hatch. Not a defect (it's optional, defaults to `false`, and local/test
never need it), just a documentation completeness note; `.env.example`
is outside this phase's editable file set, so this is reported here for
the orchestrator rather than fixed directly.

## 2. Production secret rejection — `AUTH_ACCESS_TOKEN_SECRET`

**Gets equivalent real validation to `AS_DEV_BOOTSTRAP_PASSWORD` — it does
not silently accept anything.** Compare the two:

`apps/api/src/development/bootstrap-owner.service.ts`'s
`validateBootstrapPassword` (dev-only): length ≥ 12, requires
lower+upper+digit+symbol, and a placeholder denylist (`password`,
`changeme`, `change_me`, `replace_me`, `example`).

`packages/config/src/index.ts`'s production check on
`AUTH_ACCESS_TOKEN_SECRET` (the real production auth/session secret):
`.min(32)` PLUS a `.superRefine` (`isWeakProductionSecret`) that rejects
low-entropy values (fewer than 4 distinct characters — catches `"aaa...a"`
×32) and a placeholder denylist (`changeme`, `change_me`, `change-me`,
`replace_me`, `replace-me`, `placeholder`, `example`, `secret_here`,
`your_secret`, `insert_secret`, `local_only`, `localhost`, `todo`),
scoped to `NODE_ENV === 'production'` only. The code's own comment states
this was written specifically to mirror `validateBootstrapPassword`
because `.min(32)` alone would accept an obviously unsafe value — and
confirms it now does not. A production boot with
`AUTH_ACCESS_TOKEN_SECRET=replace_me_replace_me_replace_me_x` (32
repeated-pattern characters, technically ≥32 long) is refused.

## 3. `DATABASE_URL` TLS rules

**An insecure connection string is rejected in production, not allowed.**
`validateProductionDatabaseTls` (`packages/config/src/index.ts`), applied
via `.superRefine` to both `apiSchema` (API) and the shared schema
(worker, so the worker's own Postgres pool is held to the identical
policy): when `NODE_ENV === 'production'`, `DATABASE_URL` must carry
`sslmode=require|verify-ca|verify-full`, OR the operator must explicitly
set `DATABASE_TLS_EXTERNALLY_TERMINATED=true` (documented escape hatch for
TLS terminated outside the `pg` driver, e.g. a Cloud SQL Auth Proxy or
`stunnel` sidecar). Anything else — no `sslmode`, or `sslmode=disable` —
fails `.parse()`, which `apps/api/src/server.ts`'s `startServer()` catches
and refuses to boot (`process.exitCode = 1`, `app.listen()` never called).
The resolved mode is also threaded into the real `pg.Pool`'s `ssl` option
via `sslOptionForMode()` in `packages/database/src/client.ts` — not just
validated as a string. Loopback dev/test targets are unaffected (the rule
is `NODE_ENV`-scoped).

## 4. Redis

`REDIS_URL` is **required to boot** (`z.url().startsWith('redis://')`, no
`.optional()`) but **not required for the core POS flow** — grepping every
module under `apps/api/src/modules/{auth,sales,cash,payments,refunds,
promotions,loyalty,rewards}` for a Redis reference returns zero matches;
`GET /ready`'s HTTP status gates on Postgres alone, Redis's own state is
still reported in the body and the `asone_readiness_dependency` gauge. No
TLS enforcement exists in code today; a small, worth-noting technical
detail found this phase: the schema's `.startsWith('redis://')` check is
an exact 8-character prefix match, so a TLS `rediss://` URL would actually
be **rejected** at config-validation time (`"rediss://x".startsWith(
"redis://")` is `false`), not merely "unenforced" — a real gap if a future
deployment wants `rediss://`, but out of this task's scope to change
(matches `docs/PRODUCTION_ENVIRONMENT.md`'s existing note that Redis
TLS enforcement is out of scope for this task). No separate auth
requirement is validated; a password is only as present as the operator
embeds it in the URL (`redis://:password@host:port`).

> **TASK 16.2D update:** the gap flagged above was not hypothetical — it is
> exactly what caused a real DigitalOcean production boot to fail (DO's
> Managed Valkey/Redis connection string is `rediss://...`, TLS-mandatory).
> `packages/config/src/index.ts`'s `REDIS_URL` check was widened to a
> `.refine()` accepting both `redis://` and `rediss://`; see
> `docs/PRODUCTION_ENVIRONMENT.md`'s `REDIS_URL` section for the current
> rule. The finding above is left as originally written for the historical
> record of what this phase's audit found.

## 5. MinIO / object storage — required-for-boot vs. optional (the key finding)

**Definitively (B): optional. The app boots completely fine with zero
MinIO env vars set; only the two branding routes are absent (a real
404).** Independently verified by reading the actual code path, not the
comment alone:

`brandingStorageConfigFromEnv()`
(`apps/api/src/modules/admin/branding/branding.storage.ts`) reads
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_API_PORT` directly via
`process.env` (default parameter `env: NodeJS.ProcessEnv = process.env`),
**entirely outside the Zod-validated `packages/config` schema** — these
three variables appear nowhere in `packages/config/src/index.ts`. When any
required piece is absent/malformed it **returns `undefined`** — a normal
return value, never a thrown error:

```ts
export function brandingStorageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BrandingStorageConfig | undefined {
  const rootUser = env.MINIO_ROOT_USER;
  const rootPassword = env.MINIO_ROOT_PASSWORD;
  const apiPort = Number(env.MINIO_API_PORT ?? '9000');
  if (rootUser === undefined || rootUser.length === 0) return undefined;
  if (rootPassword === undefined || rootPassword.length === 0) return undefined;
  if (!Number.isInteger(apiPort) || apiPort <= 0) return undefined;
  return { rootUser, rootPassword, apiPort };
}
```

`apps/api/src/bootstrap/register-plugins.ts`'s branding block is a plain
`if`, no `try/catch` (none needed — nothing above ever throws):

```ts
const brandingStorageConfig = brandingStorageConfigFromEnv();
if (brandingStorageConfig !== undefined) {
  registerBrandingRoutes(app, authentication, new BrandingService(
    new SettingsService(new SettingsRepository(options.infrastructure.database)),
    new BrandingObjectStorage(brandingStorageConfig),
  ));
}
registerCatalogRoutes(/* ... */);            // executes unconditionally, next line
// ... inventory, sales, cash, payments, refunds, customers, loyalty,
// rewards, purchasing, suppliers, access, reports, dashboard, assistant,
// people, parties, promotions — every one of these registers
// unconditionally, regardless of the branding gate above.
```

When the `if` is false, execution simply falls through to
`registerCatalogRoutes(...)` and every subsequent registration call in the
function, all the way to the end. Nothing upstream
(`bootstrap/create-app.ts`'s `createApp()`, `server.ts`'s `startServer()`)
observes any error from this path either — `createApp` just does
`await registerPlugins(app, options); await app.ready();`. A request to
either branding route (`POST`/`DELETE
/api/v1/companies/{id}/branding/logo`) when unconfigured gets Fastify's
normal "no route matched" 404, not a 503 or a boot crash. Every other POS
capability — login, sale, payment, receipt, inventory, cash, refunds,
customers, loyalty, rewards, reports, dashboard — is completely
unaffected.

**Conclusion for RC certification**: MinIO/object-storage being
unconfigured must NOT be treated as a launch blocker for the POS as a
whole. It is only relevant to whether the operator wants the optional
business-logo branding feature (topbar/receipt/café watermark logo
upload) available at launch — cash sale → payment → receipt works
identically with or without it.

## 6. CORS allowed origins

`@fastify/cors`'s `origin()` callback (`apps/api/src/plugins/security.ts`)
only ever calls back `true` when `config.corsAllowedOrigins.includes(
origin)` (or `origin === undefined`, e.g. a same-origin/non-browser
request) — there is no `origin: true`/`*` path anywhere in code.
`CORS_ALLOWED_ORIGINS`'s own schema (`corsOriginsSchema`) explicitly
rejects a literal `*` and any unparseable entry at config-validation time.
Default when unset (same in every `NODE_ENV`, including production):
`http://localhost:3000,http://127.0.0.1:3000` — restrictive, not a
wildcard; an operator who forgets to set it in production fails closed
toward rejecting every real browser origin, never toward allowing
everything.

## 7. Cookie / domain configuration

The refresh-token cookie (`apps/api/src/modules/auth/auth.routes.ts`) is
**not** hardcoded to `localhost` — it has **no `Domain` attribute at
all**, by design: in production the cookie name uses the `__Host-` prefix
(`__Host-asone_refresh`), which per the Cookie spec is only valid without
a `Domain` attribute, and requires exactly the `Secure`+`Path=/` pair this
code also sets. This is the strictest, most production-correct pattern
(browser-enforced host-only cookie) — there is nothing to configure
per-deployment here, and nothing that would break moving from staging to
production. `Secure` is conditionally appended only when
`config.nodeEnv === 'production'`; `SameSite=Strict` and `HttpOnly` are
always present.

## 8. Flutter `AS_API_BASE_URL` (apps/one)

Real, documented, enforced build-time mechanism —
`apps/one/lib/core/config/app_config.dart`'s `AppConfig.fromEnvironment()`
reads `AS_API_BASE_URL` via `String.fromEnvironment` (a Flutter
`--dart-define`, baked in at build time, default `http://localhost:3000`
only when `AS_ENV` is `local` or unset), and **throws a `StateError` at
app startup** if the resolved `AS_ENV` is anything other than `local` and
the URL's scheme isn't `https`. `apps/one/README.md` documents the exact
`flutter build web --release --dart-define=AS_ENV=... --dart-define=
AS_API_BASE_URL=...` invocation. `ApiClient` takes `baseUrl` as a required
constructor parameter sourced from this `AppConfig` — never a hardcoded
literal inside the client itself. A production build cannot silently ship
pointed at `localhost`; it must both set `AS_API_BASE_URL` explicitly and
use `https://`, or the app refuses to start. Unchanged since TASK 14.1;
`apps/one` remains outside this phase's editable scope.

## 9. Log level

`LOG_LEVEL` is **required** (no schema default) — boot is refused if
unset or an unrecognized level is given, forcing every deployment
(including production) to make an explicit choice rather than silently
inheriting a noisy or hidden default. `.env.example`'s `LOG_LEVEL=debug`
is a local-dev-only fixture value, clearly marked as such at the top of
that file ("Local development only... must never be reused in
production"). `docs/PRODUCTION_ENVIRONMENT.md` already documents `info`/
`warn` as the sane production choice; `packages/logger` redacts
authorization/cookie/password/token/secret fields and `database_url`/
`redis_url` regardless of the configured level, so `LOG_LEVEL` only
controls verbosity, never what gets redacted.

## 10. Proxy trust (`TRUST_PROXY`)

`TRUST_PROXY` (optional boolean, default `false`) is passed straight into
Fastify's own `trustProxy` option at app construction
(`apps/api/src/bootstrap/create-app.ts`), which governs whether
`X-Forwarded-For` is trusted (used by `@fastify/rate-limit`'s IP-based key
generator — no application code reads `request.ip`/`request.protocol`
directly). Correct handling for a real deployment behind a load
balancer/reverse proxy exists and is documented
(`docs/GO_LIVE_CHECKLIST.md` already has a checklist line for it) — it
requires an explicit operator opt-in (`TRUST_PROXY=true`) rather than
defaulting to trusting forwarded headers, which is the safe direction
(the failure mode of forgetting it is degraded rate-limit accuracy, not a
spoofing hole).

## 11. Production owner / business-config provisioning

Both real production CLIs were read in full and confirmed genuinely safe:

- **`provision:production-owner`**
  (`apps/api/src/provisioning/production-owner.cli.ts` +
  `production-owner.service.ts`): masked interactive password entry
  (`password-prompt.ts`'s raw-mode-stdin `promptPasswordMasked`, `*`
  echo, terminal mode always restored) when a real TTY, else requires
  `PROVISION_OWNER_PASSWORD` explicitly; **refuses outright** — never
  upserts — if a company with the given slug already exists; requires
  typing `yes` (or `--yes`) before writing anything, and refuses to run
  non-interactively at all without `--yes`; password validated with the
  same `validatePasswordStrength` policy used for real staff onboarding
  elsewhere; the whole company+owner+role+permissions+branch graph is
  written in one transaction; the plaintext password is never logged,
  audited, or returned. It is **deliberately not loopback-gated** — its
  own doc comment (`production-owner.types.ts`) explains this is a
  different kind of safety boundary than the dev bootstrap's: this tool
  is meant to run against a real (staging/production) target, so its
  safety comes from explicit confirmation + refuse-on-conflict, not from
  restricting the target host.
- **`provision:business-config`**
  (`apps/api/src/business-config/business-config.cli.ts` +
  `business-config.service.ts`): the same masked/env-var password pattern
  (reusing `password-prompt.ts`, never a second copy), the same
  confirm-or-`--yes` gate, and its own distinct safety property — it is
  strictly additive/idempotent: every entity is looked up by natural key
  first and, if found, is **skipped entirely, never updated** (not price,
  not permissions, not role/branch assignment); it refuses outright if the
  target company doesn't already exist (must run
  `provision:production-owner` first) and never creates/touches the
  `owner` role.

## 12. Migrations

Confirmed no auto-migrate-on-boot footgun: grepping `apps/api/src/
server.ts`, `apps/api/src/app.ts` (a 5-line re-export of `bootstrap/
create-app.ts`'s `createApp`), and `apps/api/src/bootstrap/*.ts` for
`migrat` (case-insensitive) returns zero matches. `startServer()`'s only
steps are load config → create logger → build infrastructure → build app
→ install shutdown handlers → `app.listen(...)`. `pnpm db:migrate` (root
`package.json`, resolving to `packages/database`'s
`tsx src/scripts/migrate.ts`) remains the only sanctioned migration path.

## 13. Seed behavior

All four `apps/api/src/development/*.cli.ts` seed CLIs still call the
shared `validateSeedEnvironment` guard (canonically defined once in
`seed-pos-catalog.service.ts`, re-exported by the other two seed
services) — or `bootstrap-owner.service.ts`'s equivalent
`validateBootstrapEnvironment` — before doing anything: `NODE_ENV` must be
exactly `development` or `test`, `DATABASE_URL`'s hostname must be
`127.0.0.1`/`localhost`, and the database name must be allowlisted
(`asone_local` in dev, `/^asone_[a-z0-9_]*test[a-z0-9_]*$/u` in test).
`bootstrap-owner.service.ts` additionally re-validates
`AS_DEV_BOOTSTRAP_PASSWORD` strength (section 2). Grepping
`apps/api/src/bootstrap/**` and `apps/api/src/server.ts`/`app.ts` for any
reference into `apps/api/src/development/**` finds zero real `import`
statements (only unrelated doc-comment prose in
`business-config.service.ts` mentioning those files by name) — nothing in
the boot path ever calls into a dev/seed CLI unconditionally; they only
run as manually-invoked `pnpm --filter @asone/api dev:*` scripts.

## 14. Backup tooling

Confirmed still present and consistent with its own documentation —
`scripts/production/backup-db.mjs` (real `pg_dump --format=custom` +
`<file>.manifest.json` sidecar), `scripts/production/verify-restore.mjs`
(restores into a safety-gated `VERIFY_DATABASE_URL`, rejects
production-shaped/protected database names, verifies migration-table row
count and core tables), `apps/api/src/operations/backup-verification.
service.ts` (the `ops backup-verify --manifest <path>` checksum verifier),
and `apps/api/src/operations/restore-safety.ts`'s `validateRestoreTarget`
(a separate dry-run-only gate that explicitly disables itself outright in
`NODE_ENV === 'production'`). `docs/BACKUP_STRATEGY.md` and
`docs/DISASTER_RECOVERY.md` document exact invocations that match the
real CLI flag sets in `backup-db.mjs`/`verify-restore.mjs`/`operations/
cli.ts`. TASK 15.0 Phase 10 (orchestrator-owned) will do the live
rehearsal; this phase only confirms the tooling and docs are consistent
at current HEAD, which they are.

---

## Code fix made this phase

**None.** Every item above was a re-verification, not a defect — the
codebase's own claims (including `register-plugins.ts`'s branding doc
comment) checked out against the actual code paths. No change was made
to `packages/config/src/index.ts` or `apps/api/src/bootstrap/**`.

## Doc updates made this phase

- `docs/PRODUCTION_ENVIRONMENT.md` — added a new "Business logo /
  object-storage (MinIO) — TASK 14.5A" section documenting
  `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_API_PORT` as real,
  consumed, but deliberately non-`packages/config` variables, superseding
  that document's previous TASK 14.1-era statement that no MinIO variable
  is wired into any request path; corrected the RabbitMQ/Mailpit section
  to no longer imply MinIO belongs in the same "not wired" bucket.
- `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` — updated the Part A launch
  topology table's MinIO row from "DEV-ONLY / not wired" to "OPTIONAL —
  branding logo upload only", with the same required-vs-optional evidence
  as section 5 above.
- `docs/GO_LIVE_CHECKLIST.md` — added an explicit optional "Branding /
  logo (MinIO)" checklist line so an operator who wants the feature at
  launch knows to set the three `MINIO_*` variables, and one who doesn't
  knows its absence is not a blocker.
