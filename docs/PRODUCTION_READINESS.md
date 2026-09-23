# Production Readiness — TASK 16.23 / 16.23A

**Date:** 2026-09-22/23. **Branch:** `release/as-pos-v1`. **Initial SHA (TASK 16.23 start):** `c454443`. **Final SHA:** recorded in the Final Report delivered with this document.

**Production URLs:**
- Frontend: `https://app.asone.mx`
- Backend: `https://api.asone.mx`

This document distinguishes **VERIFIED** (proven by an automated test or a live check actually performed), **INSPECTED** (proven by reading real source), **NOT TESTED**, and **BLOCKED** (needs credentials/access this session did not have). Nothing below is marked VERIFIED on the strength of "the code looks right" alone.

## 1. Unauthenticated production audit (TASK 16.23, Phases 0–1, 3, 10–11) — VERIFIED

Performed live, from a real browser, against the real public URLs — no credentials involved:

| Check | Result | Status |
|---|---|---|
| `https://api.asone.mx/health` | `200 {"name":"AS ONE API","status":"ok","version":"1.0.0"}` | VERIFIED |
| `https://api.asone.mx/live` | `200 {"status":"alive"}` | VERIFIED |
| `https://api.asone.mx/ready` | `200 {"services":{"postgres":"available","redis":"available"},"status":"ready"}` | VERIFIED |
| HTTP→HTTPS redirect | `http://api.asone.mx/health` transparently lands on `https://` | VERIFIED |
| TLS/HSTS | Valid cert (no browser warning), `strict-transport-security: max-age=31536000; includeSubDomains` present on every response | VERIFIED |
| Edge/infra | Cloudflare in front of DigitalOcean App Platform (`server: cloudflare`, `x-do-app-origin` header present) | VERIFIED |
| `https://app.asone.mx` | Real ACCESS GO login screen renders over HTTPS | VERIFIED |
| Frontend→backend wiring | Compiled `main.dart.js` bundle contains `"https://api.asone.mx"` as its baked-in `AS_API_BASE_URL`; **zero** occurrences of `localhost`/`127.0.0.1` in the ~4.7MB bundle | VERIFIED |
| Build freshness | Bundle contains TASK 16.22-specific strings (`party-reservations/availability`, `Ver disponibilidad`, `Disponibilidad de salones`) and `GET /api/v1/party-reservations/availability` returns `400 validation_error` (not `404`) on the live API — both prove the deployed build is current, from commit `c454443`, not stale. Confirmed to have happened via DigitalOcean's own autodeploy after the TASK 16.22 push — no manual deploy action was taken. | VERIFIED |
| Real cross-origin CORS from `app.asone.mx` | A `fetch('https://api.asone.mx/health', {credentials:'include'})` issued from a page actually loaded at `https://app.asone.mx` returned `200` — if CORS were misconfigured for this origin the browser would have thrown a network error before any response was readable, so success here is definitive, not inferred from a header. | VERIFIED |
| Error-response hygiene | A malformed-JSON POST and an intentionally-malformed login body both returned clean generic `validation_error`/`400` envelopes — no stack trace, no internal detail | VERIFIED |
| Secrets in repo | No real secret values found committed anywhere; `.env` (untracked, gitignored) confirmed not committed | VERIFIED |

## 2. Deployment mechanism (TASK 16.23, audit finding)

**No CI/CD, no Infrastructure-as-Code exists in this repository** — no `.github/workflows/`, no `.do/app.yaml`, no Dockerfiles anywhere. Deployment is DigitalOcean App Platform's own autodeploy against this repo's `release/as-pos-v1` branch:
- **Backend** — an App Platform Service component (env vars configured only in the DO control panel, not in-repo).
- **Frontend** — an App Platform Static Site component, Source Directory `apps/one`, Build Command `bash scripts/build_web.sh`, Output Directory `build/web` (per `docs/DEPLOYMENT_PACKAGING.md` §2.1bis).

This session had **no `doctl` CLI and no DigitalOcean control-panel access** — every deploy observed in this session happened automatically via DO's own autodeploy reacting to a `git push origin release/as-pos-v1`, not any action taken directly against DigitalOcean.

## 3. Database — INSPECTED / partially VERIFIED

- **Confirmed live** via `/ready`: production Postgres and Redis both report `available`. — VERIFIED
- **Target infra** (per `docs/PRODUCTION_SECRETS_CHECKLIST.md`, not independently re-confirmed this session): DigitalOcean Managed PostgreSQL 17, region NYC3, cluster `asone-production-postgres`; Redis via DigitalOcean Managed Valkey (`rediss://`, TLS-mandatory — a real prior incident, already fixed in `packages/config`, see `docs/RC_PRODUCTION_CONFIG.md`). — INSPECTED (docs), NOT independently re-verified this session.
- **Migrations applied to production**: NOT independently verified this session (no production `DATABASE_URL` access). The `/ready` success and the live `GET /party-reservations/availability` returning a real `400 validation_error` (not a 500 from a missing table/column) are indirect evidence the schema is current through at least TASK 16.22's migrations, but this is inference, not a direct migration-status check. — NOT TESTED (direct), weak indirect evidence only.
- **Schema/seed compatibility with `c454443`**: NOT TESTED directly against production; local `asone_test` database (used for this session's own test runs) is migrated to the same commit and all integration tests pass against it. — NOT TESTED (production), VERIFIED (local test DB).

## 4. Authenticated production E2E — BLOCKED

Explicitly paused by the user pending manual provisioning of a dedicated **"AS ONE Production QA"** tenant. This session did **not** create a tenant, user, or any production data, per explicit instruction. See `docs/PRE_LAUNCH_AUDIT.md`'s Provisioner Findings section for the exact command to run and what to expect.

Blocked items (none attempted, none faked):
- Login / branch selection / session persistence against production
- Dashboard, Clientes, Productos, POS sale (QA)
- Fiestas: Cotizador, disponibilidad, reservación, conflicto, calendario, pago QA
- Logout / re-login
- Refresh-survives-session check

## 5. Deep code audit (TASK 16.23A) — see `docs/PRE_LAUNCH_AUDIT.md`

Full findings table, severities, fixes, and test evidence live in that document. Headline results:
- **Zero confirmed cross-tenant/cross-branch data leaks** across the entire backend (5 independent sub-audits, ~200+ repository methods reviewed).
- **RBAC enforcement itself confirmed correct** by direct reading across all 31 route files (~150 registrations); the real gap found was **test coverage** (many modules have no HTTP-level 403 integration test), not the enforcement code.
- **4 real, fixed bugs**: a 400-vs-403 status-code contract bug in 4 modules (customers/memberships/loyalty/rewards), a float-money parsing violation in party snack pricing, and two print-only float-money display bugs in the cash-cut ticket. All four fixed with regression tests, all passing.
- **2 documented, deferred findings** needing a dedicated follow-up task, not an overnight patch: the device-local "today" timezone issue (spread beyond the Fiestas Calendar into Dashboard and Reports) and report date-range filtering not being branch-timezone-aware.
- **2 items needing a human product decision**, not a code fix: a non-functional QR-login tab visible to staff, and a register-access-revocation endpoint that doesn't cross-check its URL's `user_id` segment.

## 6. Security review — VERIFIED (read-only)

No real secrets committed. Structured logging redacts passwords/tokens/cookies/connection strings; automatic raw request logging is disabled. Access tokens are memory-only on the Flutter client; refresh credentials use an `HttpOnly`/`SameSite=Strict` cookie. No token ever appears in a URL on either side. Global error handler never leaks a stack trace to a client. Full detail in `docs/PRE_LAUNCH_AUDIT.md`.

## 7. Quality gates (this session)

| Gate | Result |
|---|---|
| Backend `tsc --noEmit` | Clean |
| Backend unit tests | 629/629 |
| Backend full suite (unit+integration, real `asone_test` Postgres, freshly migrated) | **1486/1486** passed, 0 failed (15 skipped, environment-gated) |
| Flutter `flutter analyze` | Clean (172 pre-existing info/warning lints, zero new) |
| Flutter full test suite | **1117/1117** passed, zero regressions |
| `flutter build web --release` | Clean, confirmed already live-deployed and verified against the real production API |

## 8. Known limitations going into go-live

- Device-local "today" (F-05 in `docs/PRE_LAUNCH_AUDIT.md`) affects the Fiestas Calendar, the Dashboard "today" summary, and the Sales Reports default date range whenever the device clock/timezone doesn't match the branch's configured one.
- Report date-range filtering (F-06) uses the database session's timezone, not the branch's, for `::date` comparisons — can shift which calendar day a late-evening sale is attributed to in a report.
- No CI/CD or IaC exists — every deploy is DigitalOcean's own autodeploy reacting to a push to `release/as-pos-v1`; there is no automated smoke test gating a bad deploy from going live.
- Integration-test coverage for permission-denial (403) paths is thin across most modules (enforcement itself is correct; the automated proof of it is not there yet for most modules).

## 9. Rollback notes

No rollback was performed or needed this session — every code change was additive/corrective and passed its full test suite before being committed. Per `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`, this codebase has **no down-migrations** — rollback is forward-fix only. If a bad autodeploy ever needs reverting: revert the offending commit(s) on `release/as-pos-v1` and push — DigitalOcean's autodeploy will rebuild from the reverted state. No manual DO console action is known to be required for a code-only rollback (env-var/infra changes made directly in the DO control panel would need to be reverted there separately, out of this repo's control).

## Final status

**AS POS V1 is NOT YET certified for public use.** Unauthenticated production readiness (connectivity, deployment freshness, HTTPS, CORS, error hygiene) is fully verified. The deep code-hardening pass (TASK 16.23A) found and fixed real bugs and confirmed the platform's core security property (tenant isolation) holds, with no critical findings outstanding. What remains before certification is entirely the **authenticated E2E walkthrough against a real "AS ONE Production QA" tenant** — blocked on manual provisioning, not on any known defect.
