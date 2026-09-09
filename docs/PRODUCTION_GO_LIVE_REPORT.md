# AS POS V1 — Production Go-Live Report

**TASK 16.0.** Starting checkpoint `22326a9` ("feat(release): complete
commercial admin UX"). Target commercial launch: September 15, 2026.

## Starting verification

- HEAD: `22326a9`, working tree clean, branch `task/12-2`.
- 29 migrations confirmed (`packages/database/drizzle/meta/_journal.json`),
  no drift from the certified checkpoint.
- No production secrets committed: `git ls-files` finds no `.env`
  tracked; the tracked `.env.example` and the local, untracked `.env`
  both carry an explicit "fictitious, must never be reused in
  production" header.
- Mercado Pago paused: confirmed unchanged — no credentials configured
  anywhere in this pass, no live call made.
- Backend/Flutter/parity/RC baseline numbers are the already-certified
  TASK 15.1 figures (545 unit / 691 integration / 537 Flutter / 100%
  parity / RED=0, YELLOW=1, GREEN=21) — unchanged, since this task made
  no source changes to application logic (see "What this phase actually
  changed" below).

## The authorization boundary this report operates under

> **TASK 16.1 update**: a real production PostgreSQL target (DigitalOcean
> Managed PostgreSQL, version 17, region NYC3, cluster
> `asone-production-postgres`) has since been provisioned externally —
> see Phase 5's own update note below. This is the one item below no
> longer true in the literal "does not exist" sense; every other item —
> API/Flutter hosting, DNS, TLS, object storage — remains genuinely
> unprovisioned, and no credential for the new Postgres cluster has been
> requested, printed, or persisted in this environment or repository at
> any point.

**No real production hosting, DNS, or cloud credentials exist in this
environment.** Verified directly, not assumed:

- No cloud provider CLI is installed (`aws`, `gcloud`, `az`, `doctl`,
  `flyctl`, `vercel`, `netlify`, `wrangler`, `heroku`, `railway` — all
  absent).
- No SSH keys or configured remote hosts exist (`~/.ssh` does not
  exist).
- No cloud credential directories exist (`~/.aws`, `~/.config/gcloud`,
  `~/.cloudflare` — all absent).
- No relevant environment variables are set (checked for
  AWS/Cloudflare/DigitalOcean/Vercel/Netlify/Heroku/Railway/domain/DNS
  tokens — none found).
- `kubectl` is present (bundled with Docker Desktop) but has no
  configured cluster context.
- The only running infrastructure is three **local, dev-only** Docker
  containers (`asone-local-postgres-1`, `asone-local-redis-1`,
  `asone-local-minio-1`) — not a production target by any definition,
  and not reachable from outside this machine.

Per this task's own explicit instruction — *"Do not guess or invent
hosting provider/server credentials/SSH credentials/Cloudflare
account/DNS provider/managed PostgreSQL credentials/object-storage
credentials/production secrets... STOP at that exact boundary and
report what is needed"* — this report completes every phase that is
genuinely possible without such access (topology finalization, DNS
planning as documentation, infrastructure requirements, secrets
checklist, and real local verification of the production build
artifacts), and explicitly stops, with the exact external requirement
named, at every phase that needs real infrastructure this environment
does not have.

---

## Phase 1 — Production topology (FINALIZED)

Re-verified against the actual code, not assumed — `apps/api/src/plugins/security.ts`
(CORS), `apps/api/src/modules/auth/auth.routes.ts` (cookies, CSRF,
origin re-check), `apps/api/src/bootstrap/create-app.ts` (no TLS
termination in Fastify itself), `apps/one/lib/core/config/app_config.dart`
(Flutter API base URL enforcement), and `docs/DOMAIN_AND_HTTPS_TOPOLOGY.md`
(the existing, already-code-grounded analysis this phase re-confirms
rather than re-derives from scratch).

**Final topology:**

```
                    ┌─────────────────────┐
   Browser  ───────▶│  app.asone.mx        │  Flutter Web (static)
                    │  (Flutter static     │  behind a CDN/static host
                    │   hosting + CDN)     │  + TLS
                    └──────────┬───────────┘
                               │ HTTPS, credentials: 'include'
                               ▼
                    ┌─────────────────────┐
                    │  api.asone.mx        │  Reverse proxy / edge
                    │  (TLS-terminating    │  terminates TLS, forwards
                    │   reverse proxy)     │  plain HTTP internally,
                    └──────────┬───────────┘  sets X-Forwarded-*
                               │ plain HTTP (internal)
                               ▼
                    ┌─────────────────────┐
                    │  Fastify API process  │  node dist/server.js
                    │  (NODE_ENV=production)│  under real process
                    └──────────┬───────────┘  supervision
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
      Managed PostgreSQL   Redis          Object storage (optional)
      (TLS required)   (boot-required,    (MinIO/S3-compatible —
                        not core-flow-     branding logos only)
                        critical)
```

**Confirmed, not assumed**:

- **Separate-origin subdomains, one registrable domain** (`app.asone.mx`
  / `api.asone.mx` under `asone.mx`) is correct for this codebase as it
  exists today — the refresh cookie already uses the `__Host-` prefix
  in production (`auth.routes.ts:47-49`), which is a browser-enforced,
  host-locked contract requiring no `Domain` attribute; the code was
  written for exactly this shape, not a shared-parent-domain cookie.
- **`SameSite=Strict` does not block this topology** — two subdomains of
  the same registrable domain are same-*site* even though they are
  different origins, so the refresh cookie is correctly sent on
  `app.asone.mx → api.asone.mx` requests.
- **CORS is real and already correct**: `@fastify/cors` with
  `credentials: true`, an explicit allowlist (`CORS_ALLOWED_ORIGINS`),
  never `origin: true`/`'*'` — the schema itself rejects a literal `*`.
  `requireApprovedOrigin` independently re-checks the same allowlist on
  every browser-transport auth endpoint.
- **CSRF model is real and already correct**: `SameSite=Strict` (blocks
  cross-site, not cross-origin) plus an HMAC-signed `x-csrf-token`
  header (`verifyCsrf`, timing-safe comparison) on every browser-
  transport state-changing route, re-confirmed in
  `docs/RC_SECURITY_CERTIFICATION.md`'s WEB section.
- **TLS terminates in front of the API, never inside Fastify** —
  `create-app.ts` constructs the Fastify instance with no TLS
  key/cert option at all. Any reverse proxy/load balancer/edge network
  that terminates TLS and forwards plain HTTP with `X-Forwarded-*`
  headers satisfies this contract — NGINX, Traefik, Caddy, or a managed
  cloud load balancer are all equally valid; none is hardcoded.
- **`Secure` cookie flag and `TRUST_PROXY` are independent settings** —
  `Secure` is driven purely by `NODE_ENV === 'production'`, never by
  `TRUST_PROXY` or `request.protocol`. Both must be set correctly in a
  real deployment (`NODE_ENV=production` for the cookie,
  `TRUST_PROXY=true` for accurate rate-limit IP attribution behind a
  real proxy) — forgetting `TRUST_PROXY` degrades rate-limit accuracy
  only, never opens a security hole (confirmed: the unsafe direction
  requires an explicit opt-in).
- **Object storage (MinIO/S3-compatible) is optional for boot** —
  confirmed by direct code inspection and a real live boot this
  session's own earlier certification already proved (`docs/RC_PRODUCTION_CONFIG.md`
  §5); needed only if the business-logo branding feature should be live
  at launch.
- **Cloudflare is one legitimate DNS/edge choice, not a hard
  requirement** — grep-confirmed zero Cloudflare-specific code anywhere
  in `apps/api`/`apps/one` (no Worker, no `wrangler.toml`, no
  Cloudflare-specific header parsing) — any DNS/CDN provider works
  identically from the application's point of view.
- **WebSocket/realtime**: nothing to plan a topology for — confirmed
  zero implementation exists anywhere in the codebase (`docs/REALTIME_EVENTS.md`
  is a contract document only).

**This phase required zero code changes** — the topology above is
achievable entirely through environment configuration on infrastructure
that does not yet exist in this environment.

---

## Phase 2 — Domain / DNS plan (DOCUMENTED, NOT APPLIED)

**No DNS provider/registrar access exists in this environment — these
records are the exact requirement, not yet applied anywhere.**

| Record | Type | Name | Target | Cloudflare proxy | TLS | Purpose |
|---|---|---|---|---|---|---|
| 1 | CNAME or A (per static host) | `app.asone.mx` | *the static-hosting provider's own target — e.g. a CDN/Vercel/Netlify/S3+CloudFront hostname, not yet chosen* | Orange-clouded (proxied) if using Cloudflare, for edge TLS + basic DDoS protection | Managed by the proxy/CDN, or a real cert (Let's Encrypt/ACM) if not proxied | Serves the Flutter Web static bundle |
| 2 | CNAME or A (per API host) | `api.asone.mx` | *the reverse-proxy/load-balancer's own target — e.g. the real server's IP or a load balancer hostname, not yet chosen* | Orange-clouded if using Cloudflare (still requires the origin itself to also present a valid cert for full/strict SSL mode), or grey-clouded (DNS-only) if TLS terminates entirely at the origin | A real certificate at whichever layer terminates TLS (§ Phase 1) | Routes to the Fastify API's reverse proxy |
| 3 (optional) | CNAME | `www.asone.mx` | Redirect target to `app.asone.mx` or the platform's own marketing site | Per provider | Real cert if serving content, or handled by the proxy's own redirect | Only if a bare `www` redirect is wanted; not required for AS POS specifically |

**Not invented**: no IP address, CNAME target, or load-balancer hostname
is stated above because none exists yet — every "target" cell names
exactly what real infrastructure decision must be made first (Phase 3)
before a DNS record can be written with a real value. `docs/DEPLOYMENT.md`'s
own broader ten-subdomain plan for the whole AS ONE product line
(`www`/`app`/`api`/`pos`/`ceo`/`rewards`/`events`/`admin`/`docs`/`status`)
is noted as context but out of scope here — this report only plans the
two hostnames AS POS V1 itself needs.

**STOP boundary**: applying these records requires real access to
whichever DNS provider owns `asone.mx` (Cloudflare or otherwise). That
access does not exist in this environment. No DNS change has been made.

---

## Phase 3 — Production infrastructure (CLASSIFIED)

| # | Component | Status | Exact requirement |
|---|---|---|---|
| 1 | Flutter static hosting | **BLOCKED ON EXTERNAL ACCESS** | Any static host/CDN capable of serving `apps/one/build/web/` with SPA fallback routing (unknown paths → `index.html`) and correct cache headers (never long-cache `index.html` itself) — Cloudflare Pages, Netlify, Vercel, S3+CloudFront, or a plain nginx static-file server are all equally valid; none is chosen or provisioned yet |
| 2 | Fastify Node runtime | **BLOCKED ON EXTERNAL ACCESS** | A Node.js 20+ runtime able to run `node dist/server.js` under real process supervision (systemd unit or Docker Compose service — `docs/OBSERVABILITY_AND_SUPERVISION.md`'s own documented target); a VM, a container platform, or a managed Node host all satisfy this — none provisioned yet |
| 3 | PostgreSQL | **PROVISIONED (TASK 16.1) — connection deliberately not yet authorized** | DigitalOcean Managed PostgreSQL, version 17, region NYC3, cluster `asone-production-postgres` — provisioned externally. No credential/connection string has been requested, printed, or persisted anywhere in this repository; connecting to it remains explicitly deferred per this task's own instruction. Once authorized: confirm the connection string requests TLS (`sslmode=require`/`verify-ca`/`verify-full`) before use as `DATABASE_URL` |
| 4 | Persistent object storage | **BLOCKED ON EXTERNAL ACCESS** (optional feature) | An S3-compatible bucket (MinIO self-hosted, AWS S3, or equivalent) for business-logo branding uploads — confirmed optional for boot (Phase 1), needed only if that feature should be live at launch; none provisioned |
| 5 | TLS | **BLOCKED ON EXTERNAL ACCESS** | A certificate authority/ACME setup (Let's Encrypt via the reverse proxy, a CDN's managed TLS, or a purchased cert) at whichever layer terminates TLS in front of the API and in front of the static host — none provisioned |
| 6 | API supervision/restart | **BLOCKED ON EXTERNAL ACCESS** | A real supervisor (systemd `Restart=on-failure`, or a container platform's own restart policy) on the real host that will run the API process — none provisioned; the application's own graceful-shutdown behavior (SIGTERM/SIGINT → drain → exit) is already real and code-verified (`docs/OBSERVABILITY_AND_SUPERVISION.md` §3), it just has nothing to run on yet |
| 7 | Backups | **BLOCKED ON EXTERNAL ACCESS** | A real destination OTHER than the API host itself for `pg_dump` output (per `docs/BACKUP_STRATEGY.md`) plus a separate backup policy for object storage (Phase 12 below) — the backup TOOLING itself is already real, tested, and proven (`docs/RC_BACKUP_RESTORE.md`, `docs/RC_15_1_FINAL_REGRESSION.md` §6, both this session's own certifications), it has no real production database to back up yet |
| 8 | Logs | **READY at the application layer; BLOCKED on a real aggregation destination** | The application already emits real structured pino JSON to stdout with request/correlation IDs on every line (verified live this phase against the compiled artifact) — any log aggregator that can tail a process's stdout (journald, Docker's own log driver, a real log-shipping agent) will work without any application change; none is chosen/provisioned yet |

**Summary**: every infrastructure component is application-ready (the
code makes no unverified assumption about any of them) but zero of them
are actually provisioned in a reachable, real production environment.
This is the exact boundary Phases 5, 6, 9-15 below stop at.

---

## Phase 4 — Production secrets (DOCUMENTED)

See `docs/PRODUCTION_SECRETS_CHECKLIST.md` (new this phase) for the
complete inventory — every variable name verified directly against
`packages/config/src/index.ts` and `app_config.dart`, with three real,
live fail-closed proofs against the compiled production artifact
(weak-secret rejection, non-TLS-DATABASE_URL rejection, and a full
successful boot with strong values) plus a real Flutter production
build proving the HTTPS-outside-`AS_ENV=local` enforcement. No secret
value is printed anywhere in that document or was printed to any log
during its verification.

---

## Phase 5 — Production database: STOP boundary

> **TASK 16.1 update**: the production PostgreSQL target has since been
> **provisioned externally** — a DigitalOcean Managed PostgreSQL
> cluster, **PostgreSQL 17**, region **NYC3**, cluster name
> **`asone-production-postgres`**. This report deliberately records only
> those non-sensitive facts (provider, version, region, cluster name) —
> **no host, port, username, password, connection string, or
> certificate content is recorded here or anywhere in this repository**,
> per this and the prior task's own explicit instruction. **Connecting
> to it remains explicitly deferred** — TASK 16.1 was explicitly
> instructed "Do not connect to production PostgreSQL yet," so this
> phase's own STOP boundary stands unchanged below; only the reason
> narrows from "no target exists" to "a target exists but connecting to
> it has not yet been authorized in this pass."

**No connection to the real production PostgreSQL target has been made
in any task through this point.** Per explicit instruction, this phase
does not proceed past provisioning, and no credential value has been
fabricated, requested, printed, or persisted anywhere.

**Exact remaining requirement before migration can run**: the real
connection string (host/port/username/password/database name, with
`sslmode=require`/`verify-ca`/`verify-full`) for the now-provisioned
`asone-production-postgres` cluster, supplied directly into a real
deployment's secret manager as `DATABASE_URL` at the moment migration is
actually authorized to run — never pasted into a document, ticket, or
chat. Network reachability from wherever the API process will run, and
confirmation the target database is empty/new as expected (this task's
own instruction), both remain to be verified once connection is
authorized.

**Once that target is provided**, the exact, already-proven procedure
to run against it (identical to what this session's own TASK 15.0/15.1
certifications already executed successfully against disposable
databases, most recently in `docs/RC_15_1_FINAL_REGRESSION.md` §
database-check) is:

```bash
DATABASE_URL='<real production URL, TLS-required>' \
  pnpm --filter @asone/database db:migrate   # applies all 29 migrations
DATABASE_URL='<real production URL>' \
  pnpm --filter @asone/database db:seed      # technical permissions ONLY — idempotent, ON CONFLICT DO NOTHING
```

**Do NOT run** any `dev:seed-*`/`dev:bootstrap-owner` command against a
real production database — confirmed still hard-gated (loopback host +
allowlisted database name + `NODE_ENV=development|test`), and not a
viable path regardless. **Do NOT run** `provision:business-config` with
demo/business data at this stage — that is Phase 6/14's job, using only
confirmed real INFLAPARK values.

No migration was run this phase. No production database exists to run
one against.

---

## Phase 6 — Production owner / first tenant (INFLAPARK): STOP boundary

Blocked by Phase 5 — provisioning the first real owner requires the
real production database from Phase 5 to already be migrated and
seeded. The tooling itself (`provision:production-owner`) is real,
already proven this session's own earlier certifications
(`docs/NEW_TENANT_ONBOARDING.md`, `docs/RC_15_1_FINAL_REGRESSION.md` §6),
and requires no code change to use against a real target once one
exists.

**Exact external requirement**: (1) the Phase 5 database, migrated and
seeded; (2) confirmed real INFLAPARK values — legal company name,
slug, owner name, owner email, at least the first branch name/code —
none of which are available to fabricate in this pass (per this task's
own explicit "No hardcoding... Do not populate guessed business
values... Only use confirmed INFLAPARK configuration" instruction).

No production owner was provisioned this phase.

---

## Phase 7 — Production API build (COMPLETE — real, local verification)

This phase does **not** require external infrastructure — building and
locally boot-testing the compiled artifact is possible entirely with
what already exists in this environment, and was done for real:

1. **`pnpm build`** — real workspace build via Turborepo: 6/6 packages
   succeeded (`@asone/api`, `@asone/config`, `@asone/database`,
   `@asone/errors`, `@asone/logger`, `@asone/worker`), confirmed
   `apps/api/dist/server.js` and every workspace dependency's own
   `dist/` exist. `package.json`'s own `start` script confirmed to be
   `node dist/server.js` — the compiled artifact, never `tsx watch`.
2. **Weak-secret rejection** — live-tested: a real placeholder
   `AUTH_ACCESS_TOKEN_SECRET` in `NODE_ENV=production` was rejected at
   config-load time with a real, specific validation error.
3. **Non-TLS `DATABASE_URL` rejection** — live-tested: a real
   `DATABASE_URL` with no `sslmode` in `NODE_ENV=production` was
   rejected at config-load time, citing exactly what's missing.
4. **Real successful boot** — the actual compiled `dist/server.js`
   process was started with `NODE_ENV=production`, a real strong
   secret, `TRUST_PROXY=true`, and `DATABASE_TLS_EXTERNALLY_TERMINATED=true`
   (simulating a TLS-terminating sidecar, since no real TLS-enabled
   production Postgres exists yet — connected to the local dev Postgres/
   Redis containers only as a stand-in for a real target):
   - `GET /health` → `200 {"name":"asone-api","status":"ok","version":"1.0.0-rc"}`
   - `GET /ready` → `200 {"services":{"postgres":"available","redis":"available"},"status":"ready"}`
   - `x-request-id`/`x-correlation-id` present on every response
   - Structured JSON logs confirmed on stdout throughout
   - Process cleanly stopped afterward
5. **Confirmed by source, not re-asserted**: migrations are never
   auto-run at boot (`server.ts`/`app.ts`/`bootstrap/*.ts` grepped for
   `migrat`, zero matches); no dev-bootstrap/seed code is reachable from
   the boot path (zero real imports from `apps/api/src/development/**`
   anywhere in `bootstrap/**`/`server.ts`); nothing in the production
   boot path references Mailpit or RabbitMQ (grep-confirmed no config
   key, no client, no reference anywhere in the real request path,
   already established in `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`'s own
   launch topology table).

**Result: GREEN.** The production API artifact is real, builds cleanly,
boots correctly under production configuration, enforces every
documented fail-closed rule, and is ready to run on real infrastructure
the moment it exists.

---

## Phase 8 — Flutter production build (COMPLETE — real, local verification)

Also does not require external infrastructure to verify the build
process itself:

```bash
flutter build web --release \
  --dart-define=AS_ENV=production \
  --dart-define=AS_API_BASE_URL=https://api.asone.mx
```

Real result: build succeeded (113.9s compile), output `build/web/`
44 MB. Confirmed by direct inspection of the compiled `main.dart.js`:
the real string `api.asone.mx` is embedded; **zero** occurrences of
`localhost:3000`/`127.0.0.1:3000` anywhere in the bundle. Confirmed via
direct source read of `app_config.dart`'s own `AppConfig.fromEnvironment()`:
`AS_ENV != local` with a non-`https` `AS_API_BASE_URL` throws a real
`StateError` at app startup, refusing to run — the exact fail-closed
behavior this build's own successful, https-scheme completion
demonstrates was satisfied, not bypassed. No secret/API key of any kind
is embedded in the Flutter bundle (build-time defines are public
information a browser needs regardless; re-confirmed via
`docs/RC_SECURITY_CERTIFICATION.md`'s own WEB-section grep, unchanged).

**Not yet verifiable without a real API to talk to**: login,
routing/deep-link behavior against a live backend, and end-to-end
network behavior — these require Phase 9's real deployment target to
exist. The build artifact itself is proven correct and ready.

**Result: GREEN** for the build process; end-to-end runtime behavior
deferred to Phase 11 once real infrastructure exists.

---

## Phase 9 — Deploy: STOP boundary

**No real infrastructure access exists to deploy to.** Per this task's
own explicit instruction ("Do not deploy to an arbitrary provider just
to complete the task" / "ONLY if actual infrastructure access is
available"), nothing was deployed.

**Exact external requirement**: a real target for both the API (Phase
3, item 2) and the Flutter static bundle (Phase 3, item 1) — a server/
container platform/PaaS account with actual provisioning access. Once
named, the deploy procedure itself is already fully documented and
tested in `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` (re-verified current
against this exact codebase during TASK 15.0 Phase 9) and requires no
new source code.

---

## Phase 10 — DNS + TLS cutover: STOP boundary

Blocked by Phase 9 (nothing is deployed to point DNS at yet) and Phase 2
(no DNS provider access). Per this task's own explicit instruction ("Do
not touch DNS until both services can be independently tested at their
infrastructure targets" / "ONLY after deployment targets are proven
healthy"), no DNS or TLS configuration was touched.

---

## Phase 11 — Production smoke test: STOP boundary

Blocked by Phases 5, 9, 10 — there is no live production instance to
smoke-test. The 30-item smoke checklist this task specifies is
**identical in substance** to what this session's own TASK 15.0 Phase 4
(88-step business-day simulation) and TASK 15.1 Phase 6 (24-step
commercial onboarding walkthrough) already proved works, end to end,
against real (non-production) instances of this exact codebase — see
`docs/RC_CERTIFICATION.md` and `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`.
Re-running it against a genuine production instance, once one exists,
is expected to be confirmatory, not exploratory — but it was not run
this phase, honestly, because no production instance exists.

---

## Phase 12 — Production backup: STOP boundary

Blocked by Phase 5 — there is no real production database to back up.
The backup **tooling** is already real, tested, and proven this
session's own earlier certification work
(`docs/RC_BACKUP_RESTORE.md`: real `pg_dump`, real checksummed
manifest, real `ops backup-verify`, real `pg_restore` into a separate
database, bit-for-bit exact fidelity — independently re-proven a second
time in `docs/RC_15_1_FINAL_REGRESSION.md`). The one real, standing
requirement already documented and folded into
`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`'s backup section: **a database
backup alone does not protect uploaded tenant logo binaries** — MinIO/
object storage (Phase 3, item 4) needs its own, separate backup policy
(e.g. `mc mirror` to a secondary bucket, or a volume-level snapshot) if
the business-logo feature is enabled at launch. This requirement is
documented, not yet exercised against a real object-storage target,
because none exists.

---

## Phase 13 — Production observability: STOP boundary (tooling itself already proven)

Blocked from a "real production instance" perspective by Phase 9, but
every mechanism this phase asks about is already real, code-verified,
and live-re-tested against the compiled artifact this same session
(Phase 7 above): `/health` (liveness), `/ready` (Postgres/Redis
dependency check, HTTP status gates on Postgres only), structured pino
JSON logs, `x-request-id`/`x-correlation-id` on every response, a real
graceful-shutdown sequence on SIGTERM/SIGINT (code-verified,
`docs/RC_OBSERVABILITY.md`), a real `pool.on('error', ...)` listener
closing a full-process-crash risk (this session's own earlier fix), and
a 9-scenario operator runbook already merged into
`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`'s own "Operator Runbook —
Observability & Failure Scenarios" section. Nothing development-only
appears in that runbook. What remains genuinely blocked is only
pointing a real log/metrics aggregator at a real running process — see
Phase 3, item 8.

---

## Phase 14 — INFLAPARK tenant configuration: STOP boundary

Blocked by Phases 5, 6, 9 — configuring the real tenant requires a real,
deployed, production instance with a provisioned first owner already
logged in. Per this task's own explicit instruction ("If production
business data is not yet ready: do not invent it... Create an exact
remaining configuration checklist"):

**Remaining configuration checklist** (every item below is reachable
through the real Flutter product UI once Phases 5/6/9 are complete —
proven for a different tenant in `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`,
none of it requires any further code change):

- [ ] Company branding + logo (needs a real INFLAPARK logo file and
      object storage provisioned — Phase 3 item 4)
- [ ] Branches (needs confirmed real INFLAPARK branch names/codes)
- [ ] Cash registers per branch
- [ ] Owner/admin account confirmation (from Phase 6)
- [ ] Manager accounts + roles
- [ ] Cashier accounts + roles
- [ ] Employee records
- [ ] Custom roles/permission grants matching INFLAPARK's real staffing
      policy
- [ ] Product categories
- [ ] Products (needs INFLAPARK's real current catalog — not the
      legacy demo data, not invented)
- [ ] Pricing (company-wide and any real branch overrides)
- [ ] Inventory locations
- [ ] Suppliers
- [ ] Promotions/coupons, if INFLAPARK has real ones to configure at
      launch
- [ ] Customers/memberships/rewards program, if applicable at launch
- [ ] Party rooms + packages, if applicable at launch
- [ ] Receipt header/footer branding text
- [ ] Access-credential configuration (no separate settings screen
      needed — confirmed in `docs/NEW_TENANT_ONBOARDING.md`)

None of these were configured this phase — no real INFLAPARK business
data was available to this pass, and none was invented.

---

## Phase 15 — Production QA: STOP boundary

Blocked by Phase 14 — there is no configured production tenant to QA
against yet. The exact QA surface this task specifies (AUTH/POS/CASH/
INVENTORY/CUSTOMERS/FIESTAS/PEOPLE/ACCESS/DASHBOARD/REPORTS/
ADMINISTRATION, at both 1366×768 and 1920×1080, reload/logout/login/API-
restart behavior, tenant-hardcoding-free) is the exact surface this
session's own TASK 15.0 and TASK 15.1 certifications already covered
exhaustively against non-production instances — see
`docs/RC_CERTIFICATION.md`, `docs/RC_ADMIN_UX_VERIFICATION.md`,
`docs/RC_TENANT_HARDCODING_SCAN.md` (D=0, zero live tenant hardcoding
found anywhere in the codebase). Re-running it against production is
expected to be confirmatory once Phase 14 is complete.

---

## Phase 16 — Go-live verdict

| Category | Verdict | Basis |
|---|---|---|
| Infrastructure | **RED** | Zero infrastructure provisioned or accessible — see Phase 3 |
| DNS | **RED** | No provider/registrar access — see Phase 2 |
| TLS | **RED** | No termination layer exists yet (depends on Infrastructure) |
| API (artifact readiness) | **GREEN** | Real compiled artifact built, boots correctly, enforces every documented production safeguard — live-verified this phase (Phase 7) |
| Flutter (artifact readiness) | **GREEN** | Real production release build succeeds, correctly embeds the intended API URL, enforces HTTPS-outside-local — live-verified this phase (Phase 8) |
| Database | **RED → YELLOW (TASK 16.1)** | A real target now exists (DigitalOcean Managed PostgreSQL 17, NYC3, `asone-production-postgres`) — provisioned but not yet connected to, migrated, or seeded; connecting remains explicitly deferred, not blocked on missing infrastructure — see Phase 5 |
| Migrations | **YELLOW** | The migration procedure itself is proven correct and safe (29/29 apply cleanly, idempotent re-run, no drift) against every disposable database this and prior certifications have used — but has never been run against the real production target, because none exists |
| Auth | **GREEN** | Already RC-certified (`docs/RC_SECURITY_CERTIFICATION.md`); production-specific enforcement (secret entropy, cookie flags, TLS-required DB) live-re-verified this phase against the compiled artifact |
| Tenant (provisioning) | **YELLOW** | Tooling proven safe and correct; the real INFLAPARK company has not yet been provisioned — blocked on Phase 5/6 |
| POS / Cash / Inventory / Customers / Fiestas / People / Access / Reports | **GREEN** (already RC-certified) for the application itself; **YELLOW** for "proven against a real production instance" specifically, since none exists yet to test against |
| Backup | **YELLOW** | Tooling proven real and correct twice this session against disposable databases; never yet run against a real production database, because none exists |
| Object storage | **YELLOW** | Confirmed optional for boot; a real backup-policy requirement is documented but not yet exercised against a real bucket |
| Observability | **GREEN** | Every mechanism live-re-verified against the compiled production artifact this phase; only the "point a real aggregator at it" step remains, which is an operational choice, not a code gap |
| Production QA | **RED** (not yet performable) | No production instance exists to QA — see Phase 15 |
| Security (external pentest) | **YELLOW** (unchanged from TASK 15.0/15.1) | Internal review only; an independent external review was not performed this phase either, per this task's own explicit instruction not to fake or replace one |
| Mercado Pago | **Separately tracked, not RED** | EXTERNAL PROVIDER ACTIVATION PENDING — remains paused throughout, no credentials, no live call, unchanged |

**RED = 4** (Infrastructure, DNS, TLS, Production QA — updated from 5
under TASK 16.1, since Database moved to YELLOW) — **all four share the
exact same root cause: no real hosting/DNS access, or a not-yet-
deployed instance to QA, exists in this environment.** None is a defect
in the application; every one is an external-access boundary this task
explicitly instructed this pass to stop at rather than fabricate past.

**YELLOW = 7** (Database — provisioned, connection deliberately
deferred; Migrations, Tenant provisioning, three application domains'
"proven against real prod" status, Backup, Object storage, Security/
external-pentest) — every one names an exact, narrow, already-proven-
safe procedure that simply has not yet been run against real
infrastructure (or, for Database specifically, has not yet been
authorized to connect), plus the pre-existing, unchanged external-
pentest item.

**GREEN = 4** (API artifact readiness, Flutter artifact readiness, Auth,
Observability) — the parts of "go live" that are genuinely about the
application's own code and configuration, not about external
infrastructure, are fully proven ready.

## Go-live verdict: **CANNOT GO LIVE YET — not a code defect, an infrastructure-access boundary.**

AS POS V1's own code, build artifacts, and configuration are proven
production-ready by this phase's own real, live verification. What
blocks an actual go-live is entirely external: no production hosting,
no database, no DNS/TLS, no deployed instance exist for this pass to
act on, and per this task's own explicit authorization boundary, none
were fabricated to force a GREEN. The exact next operator action is
named in the final report below.
