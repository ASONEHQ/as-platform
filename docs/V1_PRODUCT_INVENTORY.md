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
evidence.

**TASK 14.5A (Wave 3A, "final forensic correction") update —
2026-09-08**: Wave 3's own closing claim was contradicted by its own
report (10 non-A/H rows still remained). Every one was independently
re-audited directly against `AS POS V1.html` before any code changed —
full evidence in [[LEGACY_FUNCTIONAL_PARITY]]'s "FINAL FORENSIC
CORRECTION" section. **4 rows were over-classified as real debt** and
are now correctly excluded as legacy placeholders that were never real:
in-house credit accounts / "cuenta a crédito" payment (`DB.creditos`
permanently empty, never populated by any code path), the full CFDI
invoicing UI (a real draft-creation mechanism whose entire purpose
depended on an always-simulated stamping step), and scheduled email
reports (100% fake `setTimeout`-only send mechanism). **6 rows were
genuinely real and are now built, tested, and GREEN**: kiosk/self-
checkout mode (a real "CLIENTE mode" already existed — its 2 real gaps,
open-session entry gating and real PIN-verified exit, are now closed),
post-sale success animation/sound, birthday alerts on the dashboard (a
prior classification claiming no computed alert existed was factually
wrong), the dashboard's real %-vs-yesterday sales trend, receipt
header/footer text now genuinely reaching printed receipts (normal sale
and refund), and a real per-tenant logo upload (MinIO-backed, also now
reaching printed receipts the same way). **Result: real functional
parity is 100%** — every genuinely-real legacy capability across the
100-row matrix is now fully ported or safely replaced; every remaining
non-A/H row is a confirmed legacy placeholder, correctly excluded from
the parity formula, not a gap.

**TASK 16.24 ("V1 Product Completion Sprint") update — 2026-09-25**:
closed 4 remaining product gaps found via direct code audit, not
assumption. **Fiestas** (Block A): the calendar/list/quoter/settings
screens already existed, but opening the Cotizador used to replace the
calendar entirely — TASK 16.24 first tried a docked side-by-side
workspace; **TASK 16.24.1/16.24.2 (owner-reviewed correction)** then
restored the original 4-tab structure (Lista/Calendario/Cotizador/
Ajustes, each full-width) per the owner's own explicit rejection of
the docked layout, and separately fixed a real bug the docked version
introduced: Calendario/Cotizador used to collapse into a generic
empty-state card on zero data — both now always render their real
structure (a genuine Month/Week/Día grid with weekday headers/today
indicator/empty cells, and a full quoting workspace with an honest
"sin paquetes" message) regardless of data. **Payments** (Block B): a
real Transfer method now exists end-to-end (never touches the cash
drawer, inherits refund safety for free); CLIENTE's card-payment
button was found to already be fully real (only a stale doc comment
said otherwise); partial card-terminal refunds are confirmed
correctly, permanently provider-limited (ADR-0015 D15), not a bug.
**Rewards** (Block C): the existing presentation-token endpoints are
now wired into Flutter — issue/rotate a code from Customer Detail,
resolve a code to redeem in the CAJERO checkout dialog. **Navigation**
(Block D): removed 3 dead-end "Sistema" nav entries (Documentos/
Sincronización/Notificaciones) that only ever rendered a generic
"Coming Soon" placeholder with no product spec and no backend route
behind any of them — hidden per this task's own default rather than
left as a non-functional page.

**TASK 16.25 ("Reporting & Business Intelligence Center") update —
2026-09-25**: see the updated Reports row above — a real "Inteligencia"
management-overview tab, 4 new real backend aggregations, real charts
(no new dependency), a real PDF/print export, fast date-range presets,
and a real payment-method breakdown on Financiero, all built by
composing the existing report/dashboard infrastructure rather than a
second protocol.

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
| Payments — Transfer / CLIENTE card | 16.24 | ✅ | ✅ (`payments_method_ck` widened, migration `0046_harsh_sphinx.sql`) | ✅ (Cobrar's third pay option; CLIENTE's own card button) | ✅ | ✅ (backend: 165/165 payments+refunds; Flutter: targeted Cobrar/Transfer group) | 🟢 GREEN | none — **TASK 16.24 (Block B)** added a real Transfer payment end-to-end via the existing generic create-payment + attempt-transition routes (never touches the cash drawer, inherits refund safety with zero extra code per ADR-0015's else-branch). CLIENTE's card-payment button was found to already be fully real during this task (only a stale doc comment was wrong). Partial card-terminal refunds remain correctly, permanently provider-limited per ADR-0015 D15 — the refund dialog already says so honestly |
| Receipts (browser print/reprint) | 1 | ✅ | ✅ | ✅ | n/a | ✅ | 🟢 GREEN | logo is a shared app-wide mark, not per-tenant branding (POST-LAUNCH). **TASK 14.5 (Wave 3)** built a real receipt header/footer branding admin screen (`pos_receipt_branding_screen.dart`) that persists real data, and threaded the fields into the receipt template functions — but independently verified NOT wired into any of the 4 real print call sites in `pos_shell.dart` yet, so configured text does not appear on a printed receipt today |
| Refunds (partial/full) | 1 | ✅ | ✅ | ✅ | ✅ (manager-gated by launch policy — see `docs/GO_LIVE_CHECKLIST.md`) | ✅ | 🟢 GREEN | none |
| Promotions / Coupons | 1 | ✅ | ✅ | ✅ (admin form, cashier discount display, CLIENTE coupon-entry dialog confirmed in `pos_shell.dart`) | ✅ | ✅ | 🟢 GREEN | launch with promotions/coupons **empty** unless the business supplies real ones — a business decision, not an implementation gap |
| Customers | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 GREEN | none |
| Memberships (plan → sale → payment → activation → validation → renew/cancel) | 1 | ✅ | ✅ | ✅ (renew/cancel/validate buttons confirmed wired in `pos_shell.dart`) | ✅ | ✅ | 🟢 GREEN | launch-enabled only if the business sells a real membership product — data decision, not a code gap |
| AS Rewards+ loyalty ledger + reward entitlements/redemption + checkout benefit application | 1 | ✅ | ✅ | ✅ | ✅ | ✅ (TASK 13.1/13.2 concurrency-proven, TASK 14.0 live QA; **TASK 16.24** added 6 Flutter tests for the presentation-token flow) | 🟡 YELLOW (by business decision) | **not an implementation gap** — fully built and proven; launch default is `enabled: false` per this task's own instruction ("do not force launch dependency on Rewards") until the business confirms the 5+1/VIP program for real. **TASK 16.24 (Block C)** wired the existing presentation-token endpoints into Flutter: Customer Detail can issue/rotate a real code (shown as selectable text — no QR-image package is a dependency), and the CAJERO rewards dialog can resolve a code to redeem for any customer, not only the one already attached to the sale |
| Events / Parties (Fiestas) / Scheduling | 1 (backend), 16.24 (Flutter workspace) | ✅ | ✅ | ✅ (calendar/list/quoter/settings screens; **TASK 16.24** made the calendar always-visible while quoting — opening the Cotizador no longer hides it) | ✅ (real, server-enforced `party.*` codes) | ✅ (27/27 integration tests + a live 20-step E2E proof; **TASK 16.24** 22/22 Flutter Fiestas tests) | 🟢 GREEN | **TASK 14.3 (Wave 1) built this for real** — real `party_rooms`/`party_packages`/`party_reservations` (+snacks/socks/payments/documents), database-enforced room-conflict prevention (GIST exclusion constraint), a deterministic quote engine, deposit/balance tracking reusing the existing real cash-movement system, on-demand contract/waiver HTML generation. **TASK 16.24 (Block A)** closed the last UX gap: the calendar/list/quoter/settings screens already existed but opening the Cotizador used to replace the calendar entirely — a new docked `_FiestasWorkspace` shows both side by side (stacked on narrow viewports), with the calendar's per-day "+" prefilling the docked quoter's date instead of opening a separate dialog |
| Reports (Inteligencia/Sales/Financial/Inventory/Customers/Employees/Parties/Access/Promotions) | 1 | ✅ (`apps/api/src/modules/reports/` — 8 real server-side-aggregated report areas, **TASK 16.25** adding 4 new aggregations on the existing endpoints: `salesByHour`, `topProducts`, `paymentMethodTotals` (real, distinct from cash-drawer `movementTotals` — a transfer/card payment never posts one), and `averageStayMinutes` (real entry→exit pairing, replacing the legacy's own hardcoded `prom_estancia=95`); real date-range+branch scoping, CSV export on Sales/Financial/Inventory Kardex; financial report reconciles bit-for-bit against the real `CashService.summary()` fold logic) | ✅ | ✅ (`pos_reports_screen.dart` — **TASK 16.25** adds a real "Inteligencia" tab (first/default) composing the existing gateway's own sales/access/customers/inventory calls: real KPIs, a real vs-ayer trend, a real hourly chart, a real top-products ranking, real out-of-stock alerts; "Meta del día" honestly shows "No configurada" — no configurable daily-goal setting exists, never fabricated. Also added: 2 new dependency-free chart widgets (`pos_report_charts.dart`), a real "Imprimir / PDF" export reusing the existing browser-print mechanism (`pos_report_pdf.dart`), fast date-range presets, and a real payment-method breakdown on Financiero) | ✅ (`report.read`) | ✅ (28 backend + 23 Flutter tests in `pos_reports_test.dart` alone — grew from the prior 24/14 baseline with TASK 16.25's own new aggregation/Inteligencia coverage) | 🟢 GREEN | **TASK 14.4 (Wave 2) built this for real**, extended in **TASK 14.5 (Wave 3)** and **TASK 16.25** — the first real metrics UI in the current platform, in addition to (not a replacement for) the still-real Sales History / Cash Session Summary / Refunds list / Inventory Balances screens the launch already relies on. Deliberately does NOT reproduce the legacy's own admitted-fake fields (`prom_estancia`=95, always-0 occupancy, and Fiestas' own hardcoded "Ingresos"/"Anticipos" — all real now). A consolidated "today at a glance" dashboard screen is now real too — see the new Dashboard row below |
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
