# AS POS V1 — Release Candidate Certification Verdict

**TASK 15.0, Phase 16 — updated by TASK 15.1 (Commercial Admin UX
Closure).** Starting checkpoint `1035a58` ("fix(parity): complete
forensic legacy closure"); TASK 15.1 started from `394037a` ("chore
(release): certify AS POS V1 release candidate"), the TASK 15.0
checkpoint commit. Branch `task/12-2`. Target go-live: September 15,
2026. Mercado Pago intentionally paused throughout. No push, no deploy,
no live provider calls anywhere in either certification pass.

This is not another feature wave. Its only question: **can AS Platform
run a real park, safely, for a complete business day, survive realistic
failures, support multiple employees, stay financially/inventory
consistent, be provisioned for a new customer without code changes, and
be demonstrated and sold commercially?**

Every verdict below cites the specific `docs/RC_*.md` document that
proved it — nothing here is asserted without that underlying evidence
already existing on disk, re-read before this document was written.

## Rubric

- **GREEN** — proven ready. No accepted limitation stands between this
  category and launch.
- **YELLOW** — launch is possible, but only with the specific limitation
  below explicitly documented and accepted by the business before
  go-live. Not a defect; a scope boundary.
- **RED** — cannot launch. None found.

## Verdict table (22 categories)

| # | Category | Verdict | Evidence |
|---|---|---|---|
| 1 | Functional completeness | **GREEN** (was YELLOW under TASK 15.0) | `docs/RC_RELEASE_INVENTORY.md` — every domain that runs a park's actual business day (sell/cash/restock/party/people/access) is GREEN and fully wired end-to-end. **TASK 15.1 closed every one of the four UI-coverage gaps this category was YELLOW for**: role/user/permission administration (`PosUserAdministrationScreen`), 6 inventory sub-domains (`PosInventoryAdminScreen`), catalog admin depth (`PosCategoryAdminScreen`/`PosBrandAdminScreen`/`PosCatalogAdminScreen`), and PIN/QR fast-switch (real session hand-off, `AuthController.quickSwitchByPin`/`quickSwitchByQr`) — all six screens built, wired, live-walked-through end to end as a real park owner would use them (`docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`, a real 24-step onboarding of a fresh "AS Commercial Demo Park" tenant, zero SQL/Postman/curl/source-edits beyond the one allowed owner-bootstrap CLI step), and live security-probed (`docs/RC_ADMIN_UX_SECURITY.md`, zero gaps). This pass additionally found and fixed the single most severe functional gap in either certification: **base-product creation itself had zero Flutter caller at all** — a real commercial launch blocker, closed along with three cascading bugs its own fix surfaced, proven end-to-end with a real completed sale. Remaining, genuinely non-blocking: a generic settings editor, staff PIN/QR issuance, and device management all remain screen-less (none were in TASK 15.1's own explicit scope). |
| 2 | Authentication | **GREEN** | `docs/RC_SECURITY_CERTIFICATION.md` AUTH section: PASS, no gap. argon2id everywhere, secure `__Host-` cookies, bounded TTLs, real server-side logout/revocation, production-secret entropy rejection, no backdoor. |
| 3 | Authorization | **GREEN** | `docs/RC_SECURITY_CERTIFICATION.md` AUTHORIZATION section: PASS. Server-side `requirePermission` on every route sampled, live privilege-escalation probe with a real minimally-permissioned user (two real 403s), 11/11 automated cross-tenant/IDOR tests executed live. |
| 4 | Tenant isolation | **GREEN** | `docs/RC_TENANT_HARDCODING_SCAN.md`: 120 pilot-tenant occurrences found, classified, **D (live production hardcoding) = 0**. `docs/RC_SECURITY_CERTIFICATION.md`: no route/repository sampled trusts a client-supplied `company_id`. A real second tenant ("RC Adventure Park") was provisioned and run through a full business day, multi-cashier concurrency, refunds, parties, and payroll with zero code changes — see `docs/RC_FINANCIAL_INVARIANTS.md`, `docs/RC_INVENTORY_INVARIANTS.md`. |
| 5 | Branch isolation | **GREEN** | `docs/RC_SECURITY_CERTIFICATION.md`: `AuthService.requireBranchAccess` centrally enforced, sampled across sales/settings/access routes. Two real branches (Centro/Norte) ran independent registers, staff, and inventory simultaneously throughout Phase 4 and Phase 11 with no cross-branch leakage observed. |
| 6 | Sales integrity | **GREEN** | `docs/RC_FINANCIAL_INVARIANTS.md` §2: every sale's total = line totals − discounts + tax, server-computed and independently verified exact for 4 representative real scenarios (normal, weighted, coupon, automatic promotion). `docs/RC_FAILURE_RECOVERY_MATRIX.md` scenarios E/F: duplicate submit / repeated idempotency key both return the exact same sale id, never a duplicate. |
| 7 | Cash integrity | **GREEN** | `docs/RC_FINANCIAL_INVARIANTS.md` §1: a full real business day's cash reconciliation proven bit-for-bit exact (`$10,585.9760` hand-computed = server-computed = final close, `$0.0000` discrepancy) via two independently-coded computations, confirmed to survive a genuine process restart. |
| 8 | Refund integrity | **GREEN** | `docs/RC_FINANCIAL_INVARIANTS.md` §4 (server-computed partial-refund math, real manager-only approval enforcement via `refund.approve`, live-confirmed and integration-tested — see the correction in `docs/RC_RELEASE_INVENTORY.md` §"PAYMENTS & REFUNDS"), `docs/RC_INVENTORY_INVARIANTS.md` §4 (exact-quantity restock scoping), `docs/RC_FAILURE_RECOVERY_MATRIX.md` scenario S (a second completion of an already-completed refund is rejected `409`, never a double reversal). |
| 9 | Inventory integrity | **GREEN** | `docs/RC_INVENTORY_INVARIANTS.md`: unit-product and weighted-product lifecycles proven exact (opening→restock→sale→refund, real ledger movement rows for every mutation, never a naked balance UPDATE), atomic direct-purchase, restart-survives exactly. One separately-tracked, already-fixed gap: `inventory.transfer`/`inventory.receive` permission codes were missing from the seed catalog (found and fixed this certification, `packages/database/src/seeds/technical-permissions.ts`) — the transfer feature itself has no Flutter UI (tracked under Functional completeness, category 1, not scored twice here). |
| 10 | Rewards integrity | **GREEN** | `docs/RC_FINANCIAL_INVARIANTS.md` §5: real loyalty threshold crossed by 5 genuine customer-linked sales issues exactly 1 entitlement; `docs/RC_FAILURE_RECOVERY_MATRIX.md` scenario R: a second redemption of an already-redeemed entitlement is rejected `409`, backed by a real CAS-updated status column, not a counter a race could double-decrement. |
| 11 | Party integrity | **GREEN** | `docs/RC_FINANCIAL_INVARIANTS.md` §3: `quoted_total − total_paid = outstanding_balance` exact, before and after a process restart. `docs/RC_FAILURE_RECOVERY_MATRIX.md` scenario Q: room double-booking is rejected by a genuine Postgres `GIST EXCLUDE` constraint, not merely an application-level, race-prone check. |
| 12 | Payroll integrity | **GREEN** | A real bug — a duplicate payroll period for the same branch/date-range leaked a raw Postgres `23505` as an unhandled 500 — was found live during Phase 4's business-day rehearsal and fixed (`apps/api/src/modules/people/people.repository.ts`, now a clean `409 resource_conflict`), with a new regression test (`payroll.integration.test.ts`). `docs/RC_RELEASE_INVENTORY.md` PEOPLE section: full parity otherwise. |
| 13 | Access / occupancy integrity | **GREEN** | `docs/RC_RELEASE_INVENTORY.md` ACCESS verdict: GREEN, full parity, deliberately replacing the legacy's own fake scanner with a real, fail-closed, server-computed occupancy count. `docs/RC_FAILURE_RECOVERY_MATRIX.md` scenarios N/O/P: unknown barcode, invalid credential, and voided credential are all honestly rejected, never a fabricated success. |
| 14 | Restart / recovery | **GREEN** | `docs/RC_FAILURE_RECOVERY_MATRIX.md`: 19 scenarios (A-S), 13 live-tested and PASS, 6 reasoned from direct code citation or already-proven evidence, **zero launch blockers**. The full 88-step business-day simulation included a genuine OS-level process kill+restart with exact persistence verification across register/sales/inventory/party/payroll/occupancy/audit/reports state. |
| 15 | Security | **YELLOW** | `docs/RC_SECURITY_CERTIFICATION.md`: AUTH/AUTHORIZATION/WEB/FILES all PASS; 2 real input-validation bugs found and fixed (malformed UUID → 500, non-numeric discount value → 500). The document is explicit and correct that it is **"an internal launch security review... not a claim of formal penetration-test certification"** — it does not substitute for an independent third-party pentest or a compliance audit (PCI-DSS, SOC 2). Accept this scope explicitly before a real commercial launch handling real payment card data (once Mercado Pago is activated), or commission an external review first. |
| 16 | Flutter release UX | **GREEN** | `docs/RC_FLUTTER_UX_CERTIFICATION.md`: a real Release build tested at 1366×768 and 1920×1080. One crash found and fixed (Corte de Caja null-safety, `pos_cash_gateway.dart`). One genuinely inaccessible built screen (business-logo upload, finding F2) found and **fixed this session** — a real navigation entry point wired in with a passing regression test. Remaining notes (a specific test fixture's incomplete permission grant; raw UUIDs shown in one admin table) are non-blocking and cosmetic, not functional or safety defects. |
| 17 | Production configuration | **GREEN** | `docs/RC_PRODUCTION_CONFIG.md`: no RED item, no code fix required. TLS-required `DATABASE_URL` in production, production-secret entropy rejection, MinIO confirmed optional for boot, CORS/cookie/proxy-trust configuration all correct. |
| 18 | New-tenant sellability | **GREEN** (strengthened under TASK 15.1) | TASK 15.0: `docs/NEW_TENANT_ONBOARDING.md` — a real, fresh "RC Adventure Park" tenant provisioned using `provision:production-owner` + `provision:business-config` + the authenticated API, zero code/SQL/dev-seed; independently re-proven in `docs/RC_FINAL_REGRESSION.md` §6. TASK 15.1 raised the bar from "reachable via API" to "reachable by a non-technical owner through the product UI": a second fresh tenant ("AS Commercial Demo Park") was onboarded through **only** the CLI owner-bootstrap step plus the real Flutter app for all 24 routine setup items — `docs/RC_COMMERCIAL_ONBOARDING_WALKTHROUGH.md`. `docs/RC_TENANT_HARDCODING_SCAN.md`: D=0. |
| 19 | Observability | **GREEN** | `docs/RC_OBSERVABILITY.md`: all 10 certification questions answered, 2 real gaps found and fixed (missing `x-correlation-id` response header; unhandled `pg.Pool` error risking a full-process crash — the same pool this certification's Phase 11 fix later re-tuned for concurrency). Zero RED. A 9-scenario operator runbook was written and merged into `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`. Remaining documented (non-blocking) gaps: no dedicated shutdown-signal test, MinIO/backup-CLI error messages could be more specific. |
| 20 | Backup / restore | **GREEN** | `docs/RC_BACKUP_RESTORE.md`: a real `pg_dump`, a real checksummed manifest, the platform's own `ops backup-verify` tool (`valid: true`), and a real `pg_restore` into a fully separate database — bit-for-bit exact row counts and financial/inventory totals. Independently re-proven a second time in `docs/RC_FINAL_REGRESSION.md` §6. The one real finding — MinIO/object-storage (uploaded logos) needs its own, separate backup policy, since the database only stores a reference — is documented, not a defect, and has been folded into `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`'s backup section. |
| 21 | Performance | **GREEN** | `docs/RC_PERFORMANCE_SMOKE.md`: one genuine, reproducible launch blocker was found by live measurement — a hard-coded 5-connection database pool caused real `500` failures for as few as 6 simultaneous cashiers — and was fixed (`maxConnections: 5 → 20`) and re-verified live at 6 and 10 concurrent cashiers with zero pool-related failures. Every other endpoint measured performed at tens-of-ms; no N+1 query, unbounded list, or missing index was found anywhere in the code paths reviewed. |
| 22 | Deployment readiness | **GREEN** | `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`, `docs/GO_LIVE_CHECKLIST.md`, `docs/PRODUCTION_ENVIRONMENT.md` are current, cross-checked against actual code this certification, and now include the merged observability operator runbook and the MinIO backup-policy note. Every individual deploy step (migrate, seed, provision-owner, boot, health/ready, backup, restore) has been proven working in isolation and in the full lifecycle rehearsal (`docs/RC_FINAL_REGRESSION.md` §6). An actual production deployment was deliberately **not** performed in this certification, per this task's own hard constraint — that is a pending business decision, not a readiness gap. |

## Tally

- **RED: 0**
- **YELLOW: 1** (Security — a thorough internal review, correctly not represented as an external pentest/compliance certification)
- **GREEN: 21**

Functional completeness (category 1) moved from YELLOW to GREEN under
TASK 15.1 — see that row's own evidence above. Security (category 15)
is intentionally, per this task's own explicit instruction, left YELLOW:
"Do NOT attempt to fake or replace an external pentest."

## Full regression gate

**TASK 15.0** (`docs/RC_FINAL_REGRESSION.md`): backend unit **543/543**,
backend integration **691/691**, Flutter **460/460**, `flutter analyze`
85 issues/**0 errors**, `flutter build web --release` succeeded,
`pnpm -w typecheck`/`lint`/`build` **6/6 packages** each clean, full
database lifecycle rehearsal (migrate-from-zero → seed → provision →
login → backup → restore) bit-for-bit exact, legacy parity unchanged at
**100% (83/83)**. Gate: PASS.

**TASK 15.1** (`docs/RC_15_1_FINAL_REGRESSION.md`, re-run after all six
new admin screens landed): backend unit **545/545**, backend integration
**691/691** (identical totals to the TASK 15.0 baseline, plus the one
new `GET /roles/:role_id/permissions` route's own 2 tests), Flutter
**537/537** (grown from 460 to reflect the new screens' own real test
coverage — 460 baseline + new screens' tests + regression tests added
while fixing live-found bugs), `flutter analyze` 147 issues/**0 errors**,
`flutter build web --release` succeeded (98.3s, 44 MB), `pnpm -w
typecheck`/`lint`/`build` **6/6 packages** each clean, migrations
confirmed still **29** (zero new ones added by this task), legacy parity
unchanged at **100% (83/83)**. **Gate: PASS.**

## Real fixes made across TASK 15.0 (9 total)

1. `packages/database/src/seeds/technical-permissions.ts` — 2 missing permission codes (`inventory.transfer`, `inventory.receive`) that no role could ever have been granted.
2. `apps/api/src/plugins/error-handler.ts` — malformed UUID path param: `500` → clean `400`.
3. `apps/api/src/modules/sales/sales.routes.ts` — non-numeric/negative `manual_discount.value`: `500` → clean `400`.
4. `apps/one/lib/features/pos/pos_cash_gateway.dart` — Corte de Caja null-safety crash on a summary response missing three optional fields.
5. `apps/api/src/plugins/request-context.ts` — `x-correlation-id` now echoed as a response header on every request.
6. `apps/api/src/infrastructure/dependencies.ts` — (a) a no-op `pool.on('error', ...)` listener closing a full-process-crash risk on an idle-connection failure; (b) `maxConnections: 5 → 20`, closing a real, measured concurrent-cashier failure at 6+ simultaneous sale creations.
7. `apps/api/src/modules/people/people.repository.ts` — duplicate payroll period (same branch/date-range): `500` → clean `409 resource_conflict`.
8. `apps/one/lib/features/pos/pos_receipt_branding_screen.dart` — wired a real navigation entry point to the previously-unreachable business-logo upload screen.
9. Nine test-only fixes in Phase 15 (stale hardcoded migration/permission-count assertions across 7 files, one test-timeout budget) — no production code, closing the gap between the test suite's own snapshot assertions and this certification's real, verified schema/permission growth.

## Real fixes made across TASK 15.1 (10 total, on top of the above)

1. `apps/api/src/modules/admin/identity/identity.routes.ts` — added the missing `GET /api/v1/roles/:role_id/permissions` (real replace-semantics `PUT` existed with no way to safely read the current set first — a real data-loss-on-save risk for any client, including the new Roles tab).
2. `apps/one/lib/features/pos/pos_cash_gateway.dart` — added `createRegister`; the backend route existed with zero Flutter caller, a genuine onboarding dead end ("contact an administrator" with no in-app path for that administrator to act).
3. `apps/one/lib/features/pos/pos_models.dart` — `PosUser.fromJson` required a field the real user-creation response never returns, surfacing every successful creation as a false failure.
4. `apps/one/lib/features/pos/pos_catalog_admin_gateway.dart` + `pos_shell.dart` — added `createProduct`; **base-product creation had zero Flutter caller at all**, the most severe gap found in either certification pass.
5. Same dialog — wrong default unit-of-measure code (a label guess, not the real seeded catalog value).
6. `PosNewProductInput` — `tracks_inventory` never sent, silently leaving every new product untracked.
7. `PosNewProductInput` — `status` never sent, leaving every new product permanently `draft`/unsellable with no other screen anywhere in the app able to activate one.
8. `apps/one/lib/core/networking/api_client.dart` — added an opt-in `omitBody` parameter; two real, already-shipped inventory-posting endpoints reject any defined request body, which `postJson`'s own `{}` default always sent, making them uncallable.
9. `apps/one/lib/features/pos/pos_shell.dart` (`_StaffQuickSwitchDialogState`) — the QR quick-switch tab had no visible confirm button and an unreliable Enter handler — a genuine keyboard/UX dead end for a cashier typing rather than scanning a code.
10. `apps/one/lib/features/authentication/auth_state.dart` — `_handleFailure`'s unconditional redirect-to-login on any failure would have logged the operator out of the whole app on a simple PIN typo during quick-switch; added an opt-in `preserveCurrentPhaseOnGenericFailure` parameter (zero behavior change for every pre-existing caller).

Every fix in both lists was independently re-verified with a passing
test (or a live HTTP/UI re-check) after the fix, never merely asserted
fixed.

## RC verdict

**AS POS V1 is certified as a release candidate.** Zero RED findings.
One YELLOW finding (Security — an internal review, not a substitute for
an independent external pentest, by explicit instruction), documented
above with the accept-or-defer decision left to the business — not a
data-integrity or tenant-isolation defect, and not a blocker for a
September 15, 2026 launch. Every product/commercial-UX YELLOW this
platform had is now closed: a real park owner can complete all routine
launch-critical configuration — including the single most severe gap
found across both certification passes, base-product creation — through
the product UI alone, with zero SQL, Postman, curl, undocumented
endpoints, or developer CLI beyond the one architecturally-intended
owner-bootstrap step.

Mercado Pago remains, as required throughout, **EXTERNAL PROVIDER
ACTIVATION PENDING** — its code was read and is real, but no
credentials are configured and no live call was made, by design, for
either certification pass.
