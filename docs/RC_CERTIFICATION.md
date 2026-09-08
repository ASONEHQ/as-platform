# AS POS V1 — Release Candidate Certification Verdict

**TASK 15.0, Phase 16.** Starting checkpoint `1035a58` ("fix(parity):
complete forensic legacy closure"), branch `task/12-2`. Target go-live:
September 15, 2026. Mercado Pago intentionally paused throughout. No
push, no deploy, no live provider calls anywhere in this certification.

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
| 1 | Functional completeness | **YELLOW** | `docs/RC_RELEASE_INVENTORY.md` — every domain that runs a park's actual business day (sell/cash/restock/party/people/access) is GREEN and fully wired end-to-end. Real, non-blocking gaps: role/user/permission administration, 6 inventory sub-domains (adjustments/reservations/counts/reconciliation/reversal/transfers), catalog admin depth (brand CRUD/CSV export/branch price overrides), and PIN/QR fast-switch login all have real, tested, permission-gated backends with **no Flutter UI**. Workaround exists for all (direct API / CLI) and is documented in `docs/NEW_TENANT_ONBOARDING.md`/`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`. Accept this limitation, or build the missing screens post-launch. |
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
| 18 | New-tenant sellability | **GREEN** | `docs/NEW_TENANT_ONBOARDING.md`: a real, fresh "RC Adventure Park" tenant (2 branches, no INFLAPARK seed data) was provisioned using only production-safe tooling (`provision:production-owner` + `provision:business-config` + the authenticated API) — zero code, SQL, or dev-seed. Independently re-proven end-to-end a second time in `docs/RC_FINAL_REGRESSION.md` §6 (migrate-from-zero → seed → provision → login, bit-for-bit backup/restore fidelity). `docs/RC_TENANT_HARDCODING_SCAN.md`: D=0. |
| 19 | Observability | **GREEN** | `docs/RC_OBSERVABILITY.md`: all 10 certification questions answered, 2 real gaps found and fixed (missing `x-correlation-id` response header; unhandled `pg.Pool` error risking a full-process crash — the same pool this certification's Phase 11 fix later re-tuned for concurrency). Zero RED. A 9-scenario operator runbook was written and merged into `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`. Remaining documented (non-blocking) gaps: no dedicated shutdown-signal test, MinIO/backup-CLI error messages could be more specific. |
| 20 | Backup / restore | **GREEN** | `docs/RC_BACKUP_RESTORE.md`: a real `pg_dump`, a real checksummed manifest, the platform's own `ops backup-verify` tool (`valid: true`), and a real `pg_restore` into a fully separate database — bit-for-bit exact row counts and financial/inventory totals. Independently re-proven a second time in `docs/RC_FINAL_REGRESSION.md` §6. The one real finding — MinIO/object-storage (uploaded logos) needs its own, separate backup policy, since the database only stores a reference — is documented, not a defect, and has been folded into `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`'s backup section. |
| 21 | Performance | **GREEN** | `docs/RC_PERFORMANCE_SMOKE.md`: one genuine, reproducible launch blocker was found by live measurement — a hard-coded 5-connection database pool caused real `500` failures for as few as 6 simultaneous cashiers — and was fixed (`maxConnections: 5 → 20`) and re-verified live at 6 and 10 concurrent cashiers with zero pool-related failures. Every other endpoint measured performed at tens-of-ms; no N+1 query, unbounded list, or missing index was found anywhere in the code paths reviewed. |
| 22 | Deployment readiness | **GREEN** | `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`, `docs/GO_LIVE_CHECKLIST.md`, `docs/PRODUCTION_ENVIRONMENT.md` are current, cross-checked against actual code this certification, and now include the merged observability operator runbook and the MinIO backup-policy note. Every individual deploy step (migrate, seed, provision-owner, boot, health/ready, backup, restore) has been proven working in isolation and in the full lifecycle rehearsal (`docs/RC_FINAL_REGRESSION.md` §6). An actual production deployment was deliberately **not** performed in this certification, per this task's own hard constraint — that is a pending business decision, not a readiness gap. |

## Tally

- **RED: 0**
- **YELLOW: 2** (Functional completeness — real UI-coverage gaps, all with a documented workaround; Security — a thorough internal review, correctly not represented as an external pentest/compliance certification)
- **GREEN: 20**

## Full regression gate

`docs/RC_FINAL_REGRESSION.md`: backend unit **543/543**, backend
integration **691/691**, Flutter **460/460**, `flutter analyze` 85
issues/**0 errors**, `flutter build web --release` succeeded,
`pnpm -w typecheck`/`lint`/`build` **6/6 packages** each clean, full
database lifecycle rehearsal (migrate-from-zero → seed → provision →
login → backup → restore) bit-for-bit exact, legacy parity unchanged at
**100% (83/83)**. **Gate: PASS.**

## Real fixes made across this entire certification (9 total)

1. `packages/database/src/seeds/technical-permissions.ts` — 2 missing permission codes (`inventory.transfer`, `inventory.receive`) that no role could ever have been granted.
2. `apps/api/src/plugins/error-handler.ts` — malformed UUID path param: `500` → clean `400`.
3. `apps/api/src/modules/sales/sales.routes.ts` — non-numeric/negative `manual_discount.value`: `500` → clean `400`.
4. `apps/one/lib/features/pos/pos_cash_gateway.dart` — Corte de Caja null-safety crash on a summary response missing three optional fields.
5. `apps/api/src/plugins/request-context.ts` — `x-correlation-id` now echoed as a response header on every request.
6. `apps/api/src/infrastructure/dependencies.ts` — (a) a no-op `pool.on('error', ...)` listener closing a full-process-crash risk on an idle-connection failure; (b) `maxConnections: 5 → 20`, closing a real, measured concurrent-cashier failure at 6+ simultaneous sale creations.
7. `apps/api/src/modules/people/people.repository.ts` — duplicate payroll period (same branch/date-range): `500` → clean `409 resource_conflict`.
8. `apps/one/lib/features/pos/pos_receipt_branding_screen.dart` — wired a real navigation entry point to the previously-unreachable business-logo upload screen.
9. Nine test-only fixes in Phase 15 (stale hardcoded migration/permission-count assertions across 7 files, one test-timeout budget) — no production code, closing the gap between the test suite's own snapshot assertions and this certification's real, verified schema/permission growth.

Every one of these was independently re-verified with a passing test
(or a live HTTP re-check) after the fix, never merely asserted fixed.

## RC verdict

**AS POS V1 is certified as a release candidate.** Zero RED findings.
Two YELLOW findings, both narrow, both documented above with an
explicit accept-or-defer decision for the business to make before
go-live — neither is a data-integrity, security, or tenant-isolation
defect, and neither blocks a September 15, 2026 launch for a park whose
day-one operation is sell / cash / restock / party / people / access
(all fully proven GREEN).

Mercado Pago remains, as required throughout, **EXTERNAL PROVIDER
ACTIVATION PENDING** — its code was read and is real, but no
credentials are configured and no live call was made, by design, for
the entire certification.
