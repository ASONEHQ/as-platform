# V1 Product Inventory

TASK 14.2 — a repository-wide inventory of every operational module actually
found in this codebase, built from direct inspection (routes, schema,
Flutter screens, permissions, tests) rather than assumption. The repository
is the source of truth; nothing here is inferred from what a "mature POS
platform" is generally expected to have.

**TASK 14.2R update**: this inventory has now also been cross-checked
against the canonical pre-migration legacy prototype
(`AS POS V1.html`, forensically inspected in full) — see
[[LEGACY_FUNCTIONAL_PARITY]] for the complete evidence-backed matrix,
[[LEGACY_TO_CURRENT_MAPPING]] for the module-by-module narrative,
[[LEGACY_MISSING_PORTS]] for the P0/P1/P2 action-plan grouping, and
[[LEGACY_FIESTAS_RECOVERY]] for the dedicated Fiestas deep-dive. Rows
below are annotated where that audit changed or reinforced a finding.

**TASK 14.4 (Wave 2) update — 2026-09-08**: five more rows moved from
"missing" to real, tested, and GREEN this wave — People/HR, Suppliers +
Supply, Reports (Sales/Financial/Inventory/Customers/Employees/Parties/
Access), and Access/Occupancy (a documented safe replacement of a
confirmed-fake legacy mechanism, not a port of it — see
[[LEGACY_FUNCTIONAL_PARITY]]'s §13). Migration
`packages/database/drizzle/0025_worried_the_captain.sql` (9 new tables +
2 column additions) applied cleanly to a fresh disposable database and to
`asone_test`.

**TASK 14.5 (Wave 3) update — 2026-09-08**: independently re-verified
against the real codebase — a Dashboard ("today at a glance") screen, NFC
wristband activate/block/unblock, an AI assistant, register-style
keyboard shortcuts, PIN/QR staff quick-switch login, catalog CSV export,
inventory Kardex CSV export, a Flutter product-variants admin screen, and
a promotions usage report are all now real and GREEN. See
[[LEGACY_FUNCTIONAL_PARITY]]'s Wave 3 recount for full row-by-row
evidence. Genuinely still not built, re-confirmed by direct verification:
post-sale animation/sound, Kiosk/self-checkout mode, scheduled email
reports, per-tenant logo upload. The Dashboard deliberately omits the
legacy's real %-vs-yesterday sales trend and active-membership count; the
receipt header/footer admin screen persists real data but is not yet
rendered on a printed receipt.

## Classification key

1. **COMPLETE + LAUNCH READY** — backend, database, Flutter UI,
   permissions, and (where applicable) live end-to-end QA all confirmed
   working together.
2. **IMPLEMENTED BUT NOT CONNECTED** — real code exists on both sides but
   isn't wired together (e.g. an endpoint no screen calls).
3. **PARTIALLY IMPLEMENTED** — a genuine subset works; a genuine subset
   doesn't.
4. **UI EXISTS BUT BACKEND MISSING**
5. **BACKEND EXISTS BUT UI MISSING**
6. **BROKEN / BLOCKER**
7. **PLANNED ONLY / POST-LAUNCH** — no real implementation exists; a
   deliberate, documented deferral (not found and not built here).

## Matrix

| Module | Status | Backend | Database | UI | Permissions | E2E Tested | Launch Status | Remaining Gap |
|---|---|---|---|---|---|---|---|---|
| Auth (login/session/refresh/logout, PIN/QR staff quick-switch) | 1 | ✅ | ✅ | ✅ | ✅ | ✅ (TASK 14.0 live QA) | 🟢 GREEN | none — **TASK 14.5 (Wave 3)** added real PIN and QR "quick-switch" staff login (`AuthService.pinLogin`/`qrLogin`), independently verified: session-gated, company scope taken only from the caller's own session, real argon2id hashing, real session issuance, server-generated random QR secret with a real 90-day TTL |
| Company/Branch administration | 1 | ✅ | ✅ | — (API-driven; no dedicated Flutter screen, used via provisioning) | ✅ | ✅ (staging rehearsals, TASK 14.1) | 🟢 GREEN | none for launch — a dedicated Flutter "company settings" screen is POST-LAUNCH nicety |
| Users / Roles / Permissions admin | 1 | ✅ | ✅ | — (API-driven; provisioned via CLI/API, no dedicated Flutter admin screen) | ✅ (TASK 14.0 fixed the real launch blocker: first-activation password requirement) | ✅ (TASK 14.0 live cashier-onboarding rehearsal) | 🟢 GREEN | a Flutter "manage staff" screen is POST-LAUNCH; the authenticated API path is fully sufficient for launch |
| Cash Register (registers/sessions/movements/close, partial close, categorized withdrawal/expense/external-income) | 1 | ✅ | ✅ | ✅ | ✅ | ✅ (TASK 14.0/14.1 full-day + restart rehearsals; TASK 14.4 Wave 2's own 35-step E2E reconciled to the exact cent identically before and after a real API process kill+restart) | 🟢 GREEN | none — **TASK 14.4 (Wave 2)** extended (never duplicated) the existing cash foundation with a real, persisted, audited partial-close snapshot (`cash_session_partial_closes`, proven to never transition the session's own status) and a real `category` column (withdrawal/expense/external_income/other, direction-constrained by a DB check) |
| Catalog (categories/products/variants/prices) | 1 | ✅ | ✅ | ✅ (admin catalog screens) | ✅ | ✅ | 🟢 GREEN | products default to `draft` on creation — must be explicitly activated (documented gotcha, not a defect) |
| Inventory (locations/balances/movements/drafts/posting/reservations/counts/reconciliation) | 1 | ✅ | ✅ | ✅ (balances/movements visible in POS flows) | ✅ | ✅ | 🟢 GREEN | none for launch — reconciliation/repair tooling is admin/ops-only by design |
| Sales (creation/completion/cancellation/history) | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 GREEN | none |
| Payments — Cash | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 GREEN | none |
| Payments — Card terminal / Mercado Pago | 7 | ✅ (built, TASK 12.4B) | ✅ | ✅ (dispatch UI exists) | ✅ | not exercised (MP LIVE intentionally paused) | 🟡 YELLOW (by explicit instruction) | **not a real gap** — Mercado Pago LIVE is deliberately paused for this launch; cash is the sole payment method at launch by design |
| Receipts (browser print/reprint) | 1 | ✅ | ✅ | ✅ | n/a | ✅ | 🟢 GREEN | logo is a shared app-wide mark, not per-tenant branding (POST-LAUNCH). **TASK 14.5 (Wave 3)** built a real receipt header/footer branding admin screen (`pos_receipt_branding_screen.dart`) that persists real data, and threaded the fields into the receipt template functions — but independently verified NOT wired into any of the 4 real print call sites in `pos_shell.dart` yet, so configured text does not appear on a printed receipt today |
| Refunds (partial/full) | 1 | ✅ | ✅ | ✅ | ✅ (manager-gated by launch policy — see `docs/GO_LIVE_CHECKLIST.md`) | ✅ | 🟢 GREEN | none |
| Promotions / Coupons | 1 | ✅ | ✅ | ✅ (admin form, cashier discount display, CLIENTE coupon-entry dialog confirmed in `pos_shell.dart`) | ✅ | ✅ | 🟢 GREEN | launch with promotions/coupons **empty** unless the business supplies real ones — a business decision, not an implementation gap |
| Customers | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 GREEN | none |
| Memberships (plan → sale → payment → activation → validation → renew/cancel) | 1 | ✅ | ✅ | ✅ (renew/cancel/validate buttons confirmed wired in `pos_shell.dart`) | ✅ | ✅ | 🟢 GREEN | launch-enabled only if the business sells a real membership product — data decision, not a code gap |
| AS Rewards+ loyalty ledger + reward entitlements/redemption + checkout benefit application | 1 | ✅ | ✅ | ✅ | ✅ | ✅ (TASK 13.1/13.2 concurrency-proven, TASK 14.0 live QA) | 🟡 YELLOW (by business decision) | **not an implementation gap** — fully built and proven; launch default is `enabled: false` per this task's own instruction ("do not force launch dependency on Rewards") until the business confirms the 5+1/VIP program for real |
| Events / Parties (Fiestas) / Scheduling | 1 (backend) | ✅ | ✅ | 🟡 Flutter in progress | ✅ (real, server-enforced `party.*` codes) | ✅ (27/27 integration tests + a live 20-step E2E proof) | 🟢 GREEN (backend), 🟡 YELLOW (Flutter UI in progress) | **TASK 14.3 (Wave 1) built this for real** — real `party_rooms`/`party_packages`/`party_reservations` (+snacks/socks/payments/documents), database-enforced room-conflict prevention (GIST exclusion constraint), a deterministic quote engine, deposit/balance tracking reusing the existing real cash-movement system, on-demand contract/waiver HTML generation. Originally deferred as its own future task (`docs/LEGACY_FIESTAS_RECOVERY.md`), later explicitly brought into Wave 1 scope. Remaining gap: Flutter UI (calendar/list/quoter/settings/detail screens) |
| Reports (Sales/Financial/Inventory/Customers/Employees/Parties/Access/Promotions) | 1 | ✅ (`apps/api/src/modules/reports/` — now 8 real server-side-aggregated report areas including a **TASK 14.5 (Wave 3)** Promotions usage report, real date-range+branch scoping, CSV export on Sales/Financial/**Inventory Kardex (Wave 3)**; financial report reconciles bit-for-bit against the real `CashService.summary()` fold logic) | ✅ | ✅ (`pos_reports_screen.dart`, a tabbed per-area screen) | ✅ (`report.read`) | ✅ (17 backend + 12 Flutter tests) | 🟢 GREEN | **TASK 14.4 (Wave 2) built this for real**, extended in **TASK 14.5 (Wave 3)** — the first real metrics UI in the current platform, in addition to (not a replacement for) the still-real Sales History / Cash Session Summary / Refunds list / Inventory Balances screens the launch already relies on. Deliberately does NOT reproduce the legacy's own 2 admitted-fake fields (`prom_estancia`=95, always-0 occupancy). A consolidated "today at a glance" dashboard screen is now real too — see the new Dashboard row below |
| Dashboard ("today at a glance") | 3 (deliberately partial) | ✅ (`apps/api/src/modules/dashboard/` — `DashboardService.summary()`, real today's sales/occupancy/parties/open cash sessions/outstanding party balances/employee attendance, computed via the same real Wave 1/2 services the report endpoints use) | n/a (no new tables — reads existing ones) | ✅ (`pos_dashboard_gateway.dart`, wired to a real `PosModule.dashboard` screen in `pos_shell.dart`) | ✅ | ✅ | 🟢 GREEN (for what it covers) | **TASK 14.5 (Wave 3) built this for real**, replacing the prior context-only placeholder. Deliberately NOT ported: the legacy's real %-vs-yesterday sales trend (`vsAyer`) and active-membership count — both real, working legacy metrics, consciously scoped out this wave; no birthday-alerts metric either (only the raw `birth_date` field exists) |
| AI assistant | 1 | ✅ (`apps/api/src/modules/assistant/` — a real, deterministic keyword/intent matcher over live SQL data, zero LLM/external calls) | n/a | ✅ (`pos_assistant_gateway.dart`/`pos_assistant_screen.dart`) | n/a | ✅ | 🟢 GREEN | **TASK 14.5 (Wave 3) built this for real**, a faithful port of the legacy's own local keyword-matcher approach (not an LLM), matching the legacy's own approach rather than exceeding it — a genuine real-LLM assistant remains a future, non-parity upgrade |
| People / HR (employee roster, shift scheduling, time clock, payroll) | 1 | ✅ (`apps/api/src/modules/people/` — employees/schedules/time-clock/payroll routes+services+repository) | ✅ (`employees`/`employee_schedules`/`time_clock_punches`/`payroll_periods`/`payroll_period_lines`) | ✅ (`pos_people_screen.dart`) | ✅ (`employee.*`/`schedule.*`/`attendance.*`/`payroll.*`) | ✅ (20 backend + 16 Flutter tests) | 🟢 GREEN | **TASK 14.4 (Wave 2) built this for real** — a genuine, new domain (no prior current-platform equivalent existed beyond login `users`). Payroll calculation is a faithful port of the legacy's real `calcularNominaEmpleado()` formula, verified against a hand-computed example; a closed payroll period can never be recalculated |
| Suppliers + Supply (supplier CRUD, Compra Directa linkage) | 1 | ✅ (`apps/api/src/modules/suppliers/`, extends `apps/api/src/modules/purchasing/`) | ✅ (`suppliers`, company-scoped; `direct_purchases.supplier_id`) | ✅ (`pos_suppliers_screen.dart`; supplier picker added to the existing Compra Directa form) | ✅ (`supplier.read`/`supplier.manage`) | ✅ (18 backend + 18 Flutter tests) | 🟢 GREEN | **TASK 14.4 (Wave 2) built this for real.** `direct_purchases.supplier_id` uses a frozen-name-snapshot pattern (a later supplier rename never rewrites past purchase history). The legacy's formal Purchase Order workflow remains correctly, deliberately excluded — re-confirmed this wave that `saveCompra()` discarded entered line items, so there is genuinely nothing real to rebuild toward |
| Access / Occupancy / NFC Wristbands (scan entry/exit validation, aforo, wristband lifecycle) | 1 | ✅ (`apps/api/src/modules/access/` — real server-side scan validation, CAS-guarded concurrency-safe entry/exit, real server-computed occupancy, plus **TASK 14.5 (Wave 3)** `access_credentials.credential_kind` for real wristband activate/block/unblock) | ✅ (`access_credentials`/`access_events`) | ✅ (`pos_access_screen.dart`) | ✅ (`access.scan`/`access.read`/`access.manage`) | ✅ (25 backend tests incl. 2 real concurrency races + 14 Flutter tests) | 🟢 GREEN | **TASK 14.4 (Wave 2) built this as an explicit, documented REPLACEMENT of a confirmed-fake legacy mechanism, not a port.** The legacy's `accScan()` accepted any input and always fabricated a successful random name — that finding is unchanged. This is a genuinely new validator (unknown/void/wrong-branch/already-inside/not-inside/reentry-not-allowed all honestly rejected) with a re-entry policy the legacy never defined. Occupancy is real and, unlike the legacy's one-way-only counter, genuinely bidirectional. NFC wristband "extend" alone stays unbuilt this wave (corrected finding — see [[LEGACY_FUNCTIONAL_PARITY]]'s §13) |
| Multi-branch operations / tenant isolation | 1 | ✅ | ✅ (composite `(company_id, ...)` FKs audited across all 24 migrations, zero violations — TASK 14.0; independently re-proven for People/Suppliers/Reports/Access/Cash in TASK 14.4 Wave 2 via both automated tests and a live E2E second-company isolation check) | ✅ (branch-scoped throughout) | ✅ | ✅ | 🟢 GREEN | none |
| Production deployment / infrastructure (TASK 14.1) | 1 | ✅ | ✅ | n/a | n/a | ✅ (full staging rehearsal, restart, backup/restore) | 🟢 GREEN | real DNS/TLS/hosting provisioning remains an operator/business step, not a code gap |
| Business configuration provisioning (TASK 14.2) | 1 | ✅ | ✅ | n/a (CLI, by design) | ✅ | ✅ | 🟢 GREEN | `provision:business-config` CLI applied the real `inflapark.launch.example.json` template (6 branches/registers, 2 roles, 2 users, 6 categories, 10 products+prices, opening inventory, rewards program) against a disposable DB — dry-run matched the real apply exactly, and a second identical run proved full idempotency (0 created, all "already exists"). A genuine launch-blocker (`createBranch` writing a JSON `null` instead of a SQL NULL for an omitted `address`, failing `branches_address_object_ck`) was found and fixed in `admin.service.ts` with a regression test, not merely worked around |

## Dependency map for a real park to operate on September 15

```
Infrastructure (TASK 14.1, GREEN)
   └── Company + Owner provisioned (provision:production-owner, GREEN)
         └── Business config applied: branch, register, roles, users, catalog, prices, tax, opening inventory
               (TASK 14.2's own new provision:business-config tool)
               └── Cashier can log in
                     └── Register can open
                           └── Catalog is loadable and priced
                                 └── A sale can be created, paid in cash, and completed
                                       └── A receipt can print/reprint
                                       └── A refund can be issued (if policy allows)
                                       └── The register can close and reopen next day
```

Everything below this chain is OPTIONAL, launch-independent, and does not
block the core loop above:
- Rewards/loyalty (business decision — see `docs/V1_LAUNCH_SCOPE.md`)
- Promotions/coupons (business decision — launch empty is a valid state)
- Mercado Pago LIVE (explicitly paused)
- Events/parties (genuinely unbuilt — its own future task)
- The now-8-area Reports screen and the consolidated "today at a glance"
  Dashboard screen (TASK 14.4 Wave 2 / TASK 14.5 Wave 3, real and GREEN —
  existing screens already cover the minimum operational need for launch;
  both are operational conveniences, not a Sept 15 blocker)
