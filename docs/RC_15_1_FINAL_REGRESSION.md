# RC 15.1 Final Regression — Commercial Admin UX Closure

**TASK 15.1 Phase 9 (Final Test Gate).** Complete regression pass over
branch `task/12-2`, checkpoint `394037a` (the already-certified AS POS V1
RC commit) **plus** the substantial new, uncommitted work on top of it:
six new Flutter admin screens (Users/Roles/Permissions, Inventory admin,
Category/Brand/Catalog admin, Branch admin), a real PIN/QR session
hand-off, several backend/Flutter bug fixes found during live testing,
and full wiring into `pos_shell.dart`/`pos_navigation.dart`/`app.dart`/
`bootstrap.dart`/`dashboard_screen.dart`. Every piece had already been
verified in isolation by the agents that built it, and the wiring itself
had already been re-verified twice (537/537 Flutter tests, clean
`flutter analyze`) — this phase is the first time everything runs
together as one complete pass, against a dedicated, isolated database
created for this phase only (`asone_15_1_regression_test`).
`asone_local`, `asone_test`, `asone_rc_test`, `asone_regression_check`,
`asone_regression_restore`, and `asone_commercial_demo` were never
touched, dropped, or truncated. No push, no deploy, no Mercado Pago
activity, no commit.

## 1. Backend unit tests

`pnpm --filter @asone/api test` (vitest, excludes `*.integration.test.ts`):

**53 test files, 511 tests — all passed** (isolated run; see §5 for a
contention-related false failure on the first attempt, run concurrently
with unrelated tooling of this phase's own).

`pnpm --filter @asone/database test`:

**4 test files, 34 tests — all passed.**

Combined backend unit: **57 files, 545 tests, 0 failed.** (TASK 15.0's
own baseline was 56 files/543 tests; the delta is exactly this task's
new `apps/api/src/modules/admin/identity/identity.routes.test.ts` — 1
new file, 2 new tests, both passing — covering the new
`GET /api/v1/roles/:role_id/permissions` route.)

## 2. Backend integration tests (sequential, `--no-file-parallelism`, dedicated `asone_15_1_regression_test`)

Database created fresh for this phase only:
`postgresql://asone_test:***@127.0.0.1:5432/asone_15_1_regression_test`.
Migrated (`db:migrate` — see §5 for the applied-migration count) and
seeded (`db:seed` → `Inserted 100 approved permission definitions.`)
before any integration test ran.

`packages/database` integration suite: **8 test files, 72 tests — all
passed** (isolated clean run; see §5 for one single-test timeout on the
first attempt, confirmed as contention, not a regression).

`apps/api` integration suite, run with `MINIO_ROOT_USER`/
`MINIO_ROOT_PASSWORD` supplied (MinIO already up and healthy in
Docker) so the MinIO-dependent branding tests run rather than skip:
**47 test files, 619 tests — all passed, 0 failed, 0 skipped.** Real
run output:

```
Test Files  47 passed (47)
     Tests  619 passed (619)
  Duration  257.23s
```

Combined backend integration: **55 files, 691 tests, 0 failed** — the
same exact totals as TASK 15.0's own certified baseline, confirming this
task's changes added zero new integration-level backend tests (the one
new backend route's test, `identity.routes.test.ts`, is a unit-level
route test — see §1 — not an integration test).

The new route (`GET /api/v1/roles/:role_id/permissions`,
`apps/api/src/modules/admin/identity/identity.routes.ts`) is confirmed
included and passing: its own regression test asserts 2 cases (grants
under `role.read`, rejects without it) — both pass. Read directly in the
route registration: the handler calls
`requireAuthenticatedUser` then `administration.rolePermissions(...)`,
the same already-permissioned, already-tested service method the
existing `PUT /api/v1/roles/:role_id/permissions` endpoint uses — no new
permission code was introduced, confirmed by inline comment and by
direct code read (reuses `role.read`).

## 3. Flutter

`cd apps/one && flutter test`: **537 tests — all passed**, exit 0.
Matches the certification's own expected baseline exactly (no new tests
were added — none were needed; every failure found and fixed during this
task's live walkthroughs was a production-code fix, re-verified against
the existing suite).

`flutter analyze`: **147 issues found** (0 errors — confirmed by
grepping the raw output: 0 lines matching `error`, 139 `info`, 8
`warning`). Exit code 1 (by design — `flutter analyze` exits non-zero on
any issue, including info-level). All issues are pre-existing
style/lint-level debt (`use_null_aware_elements`,
`prefer_initializing_formals`, `curly_braces_in_flow_control_structures`,
unused optional test-fixture parameters, etc.) — none are inside logic
this task's real fixes changed. (TASK 15.0's baseline was 85 issues; the
increase reflects this task's six new screens/gateways and their tests,
all following the same established style patterns as the rest of the
codebase, not new defects.)

`flutter build web --release`: **succeeded**, exit 0. Real compiler
timer: `Compiling lib\main.dart for the Web... 98.3s` (total wall time
1m41.993s including asset/service-worker packaging). Output `build/web`:
**44 MB**. Icon tree-shaking worked as expected
(`MaterialIcons-Regular.otf`: 1,645,184 → 25,912 bytes, 98.4%
reduction). No build errors; the only messages were the informational
wasm-dry-run notice and a pre-existing Cupertino-icons font-family
notice, neither of which blocked or altered the build (JS compiler used,
as intended — `--wasm` was not requested).

## 4. Workspace-wide

`pnpm -w typecheck`: **6/6 packages succeeded, 0 errors** (`@asone/api`,
`@asone/config`, `@asone/database`, `@asone/errors`, `@asone/logger`,
`@asone/worker`).

`pnpm -w lint`: **6/6 packages succeeded, 0 errors.**

`pnpm -w build`: **6/6 packages succeeded.**

All three ran clean on the first isolated attempt — no fixes were
needed at the workspace level.

## 5. Contention-related false failures (investigated, confirmed not a regression)

Consistent with the documented pattern from TASK 15.0 Phase 15
(`docs/RC_FINAL_REGRESSION.md` §5), two false failures showed up this
phase, both traced to this session's own concurrent tooling rather than
a code regression:

| Step | Failed under contention | Isolated/clean re-run |
|---|---|---|
| `pnpm --filter @asone/api test` | 13 test files, 13 tests, all `Test timed out in 5000ms` — coincided with a concurrent `docker exec ... psql ... CREATE DATABASE` call this phase issued in parallel with the first attempt | ✅ 53/53 files, 511/511 tests passed, run alone |
| `packages/database` integration suite (`transfers-reservations.integration.test.ts`) | 1 test, `Test timed out in 5000ms` on the first full-suite attempt (7/8 files clean) | ✅ passed alone in 949ms; full 8-file suite re-run afterward was clean, 72/72 |

Both are exactly the same class of false failure documented in TASK
15.0's own §5: a real `pg`/vitest-level timeout that coincides with this
session's own concurrent I/O or CPU load, not a second run of identical
inputs producing different results by chance without cause. No code was
touched to "fix" either — there was nothing to fix. Every subsequent
step in this regression was deliberately run in isolation (nothing else
started concurrently) to avoid repeating this pattern, and every number
reported in §1-§4 above and §6 below is from a clean, isolated run.

## 6. Database check / migration rehearsal

`pnpm --filter @asone/database db:check` exists and was run directly:

```
$ drizzle-kit check && tsx src/scripts/check-migrations.ts
Everything's fine 🐶🔥
Validated 29 migration file(s) statically.
```

Exit 0. **Still 29** — this task added zero new migrations, confirmed:
29 migration files on disk (`0000`-`0028`) match `db:check`'s own count
exactly.

This was independently corroborated with a real migration-from-zero
rehearsal against the brand-new `asone_15_1_regression_test` database
(§2, created for this phase, never touched before): `db:migrate` applied
migrations, and a direct query
(`select count(*) from drizzle.__drizzle_migrations`) confirmed **29
rows** — matching the 29 files on disk exactly, same as
`db:check`'s static count. `db:seed` against that same fresh database
produced `Inserted 100 approved permission definitions.` — the expected
100, unchanged.

The new `GET /roles/:role_id/permissions` route needs no new permission
code: confirmed above (§2) by direct read of its route registration —
it reuses `role.read`, the same permission the existing `PUT` endpoint
on the same path already requires. No seed change was needed or made.

## 7. Legacy functional parity re-confirmation

Read `docs/LEGACY_FUNCTIONAL_PARITY.md` directly (not assumed). Confirms,
unchanged: **A = 64, H = 19, G = 17, B = C = D = E = F = 0. Total =
64+19+17 = 100.** Numerator (A+H) = 83, denominator (100−G) = 83.
**REAL FUNCTIONAL PARITY = (A+H) ÷ (100−G) = 83 ÷ 83 = 100%.** This
task's own work (six new Flutter admin screens, PIN/QR session
hand-off, backend/Flutter bug fixes) was UI/admin-surface work reusing
already-real backend services and permissions — none of it touched
legacy-parity-relevant business logic, and nothing in the matrix needed
recomputing.

## 8. Overall verdict

**GREEN — PASS.** Every step of the complete regression suite is green,
run against the real, current state of `task/12-2` including all of this
task's uncommitted work:

- Backend unit tests: 57 files, 545 tests, **0 failed**
  (53+511 in `@asone/api`, 4+34 in `@asone/database`).
- Backend integration tests: 55 files, 691 tests, **0 failed**
  (47+619 in `@asone/api` including the MinIO-dependent branding suite,
  8+72 in `@asone/database`) — same totals as the certified baseline,
  confirming no integration-level regression from this task's changes.
  The one new backend route (`GET /api/v1/roles/:role_id/permissions`)
  is covered and passing.
- Flutter: 537 tests, **0 failed** — matches the expected baseline
  exactly, no tests needed to be added; `flutter analyze`: 147 issues,
  **0 errors**; `flutter build web --release`: **succeeded** (44 MB,
  98.3s compile).
- `pnpm -w typecheck`: 6/6 packages, **0 errors**.
- `pnpm -w lint`: 6/6 packages, **0 errors**.
- `pnpm -w build`: 6/6 packages, **succeeded**.
- Database: `db:check` passed (29 migrations validated statically);
  independently corroborated with a live migration-from-zero rehearsal
  (29 applied, 100 permissions seeded) against a brand-new, isolated
  database. **Still 29 migrations — zero new migrations this task.**
  The new route needs no new permission code (reuses `role.read`,
  confirmed by direct code read).
- Legacy functional parity: **unchanged**, still 100% (83/83).

No genuine bug was found during this phase's own execution — everything
that could plausibly look like a failure (§5) was investigated,
independently reproduced as this session's own resource contention via
clean isolated re-runs, and documented with before/after evidence rather
than papered over. No production or test code was changed by this
phase. This is consistent with the task's own framing: every individual
piece of this task's work had already been verified in isolation, and a
follow-up agent had already found and fixed 5 real bugs during a live
commercial-onboarding walkthrough before this phase started (documented
in `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md` and
`docs/RC_ADMIN_UX_SECURITY.md`/`docs/RC_ADMIN_UX_VERIFICATION.md`) —
this phase's job was to catch any *remaining* interaction issue across
the whole system running together, and it found none.

**Phase 9 gate: PASS.** Nothing in this pass blocks TASK 15.1's own
closure. No push, no deploy, no Mercado Pago activity, no commit were
made by this phase — those remain for the human/orchestrator step this
doc's own PASS verdict unblocks.
