# Legacy Missing Ports — Action Plan

Every capability from [[LEGACY_FUNCTIONAL_PARITY]] classified **F** (not
ported) or **G** (placeholder/demo-only, i.e. never real to begin with),
grouped by whether a real park would need it to operate the V1 workflow
on September 15 (**P0**), whether it matters for selling AS Platform to
the *next* park (**P1**), or whether it's a genuine post-launch
enhancement (**P2**). This document does NOT authorize building any of
it — see [[V1_LAUNCH_SCOPE]] for what's actually in scope for TASK 14.2,
and [[V1_POST_LAUNCH_BACKLOG]] for where each item now lives.

**Important framing**: this list is much longer than the TASK 14.0/14.2
"zero RED" launch-readiness matrices, because those audits worked from
the current platform's own designed scope — they had no way to know
about capabilities that existed only in the pre-migration legacy
prototype until this forensic pass. Nothing on this list changes the
already-proven status of the core transaction/cash/refund/reward
workflow (all independently verified live, multiple times, across TASK
14.0–14.2). What it does is surface *additional* candidate capabilities
worth a real go/no-go decision for Sept 15 — two of them (marked P0
below) are flagged as genuinely worth reconsidering.

---

## TASK 14.3 (Wave 1) — completed

Both P0 candidates below, plus barcode scanning, weight-based products,
sale notes, and Fiestas itself (originally deferred, later brought into
Wave 1 by explicit instruction) are now **backend-complete and proven**
— real schema, real permissions, 100+ new integration tests passing, a
live 40-step end-to-end simulation with zero mocks. Flutter UI for each
is tracked separately (see [[LEGACY_FUNCTIONAL_PARITY]] for per-row
status). This section is kept for its original historical reasoning;
none of it should be read as still-open.

## TASK 14.5 (Wave 3) — completed

Independently re-verified against the real codebase (routes, schema,
migrations, Flutter screens) — see [[LEGACY_FUNCTIONAL_PARITY]]'s Wave 3
recount for the full row-by-row evidence. Now real and done: Cafetería
visual sub-mode, catalog CSV export, inventory Kardex CSV export, a
promotions usage report, a Flutter product-variants admin screen, NFC
wristband activate/block/unblock, PIN and QR staff quick-switch login, a
consolidated Dashboard screen, register-style keyboard shortcuts, an
on-screen PIN keypad wired to real PIN verification, and a real
deterministic AI assistant. One pre-existing (pre-Wave-3) labeling
artifact was also found and fixed this wave: the Memberships row's own
`B/A` compound classification was silently reading as B under this
document's first-listed-letter rule despite describing a strictly
superior real capability — corrected to A. Genuinely still NOT built,
re-confirmed by direct verification rather than taken on faith: post-sale
animation/sound, Kiosk/self-checkout mode, scheduled email reports,
per-tenant logo upload, and NFC wristband "extend" (a corrected finding —
see below). The Dashboard deliberately omits the legacy's real
%-vs-yesterday sales trend and active-membership count; the receipt
header/footer admin screen persists real data but is not yet threaded
into any of the 4 real print call sites. Formal Purchase Orders and CFDI
fiscal stamping were explicitly re-confirmed untouched this wave too.

## TASK 14.4 (Wave 2) — completed

Five more items from the P1/P2 lists below are now **backend-and-UI
complete and proven**: Suppliers CRUD, Employee roster/shift scheduling/
time clock/payroll, Dashboard/per-area report screens, Occupancy (aforo)
tracking, and Partial cash close + categorized cash movements. Access/
Occupancy additionally REPLACES (not ports) the legacy's confirmed-fake
ticket-scan validation with a real, honest validator — see
[[LEGACY_FUNCTIONAL_PARITY]]'s §13 for why that is classified **H**, not
**A**, and why it must never be read as evidence the legacy scanner was
real. All five are struck through below and moved into their own
"DONE" notes; formal Purchase Orders and CFDI fiscal stamping were
explicitly re-confirmed out of scope this wave — neither was touched.

## P0 — worth reconsidering for September 15 *(status: backend done, Wave 1)*

Only two items earned a P0 flag in the matrix — both are real,
self-contained cashier-workflow features from the legacy product that a
trampoline-park cashier would plausibly need on day one, and neither
touches Fiestas or any other explicitly-deferred domain:

1. **Suspended/held sales** (suspend the current ticket, ring up another
   customer, recover it later). Real risk if missing: a walk-up customer
   forces a cashier to either lose an in-progress multi-item ticket or
   make the next customer wait. Self-contained: a new sale status/table
   plus two Flutter actions (Suspend / Recuperar), reusing the existing
   `sales` domain — does not require touching cash, inventory, or
   permissions in any new way.
2. **Direct purchase / quick restock** (a manager adds newly-arrived
   stock immediately, without a formal purchase order). Real risk if
   missing: no in-app way to correct a stock count when new inventory
   physically arrives mid-day — the current platform's stock-adjustment
   tooling (`inventory-drafts`/`inventory-posting`) can technically do
   this today via the CLI/API, but there's no quick, cashier/manager-
   facing UI path for the common "stock just arrived" case.

**Status: both now backend-complete (TASK 14.3 Wave 1)** — proven live
(suspend → real restart → restore → checkout → pay; a real direct
purchase increasing real inventory, immediately sellable). Flutter UI
tracked separately.

## P1 — important for selling AS Platform to other parks

Real, working legacy features with no current equivalent, valuable
beyond Inflapark specifically:

- ~~**Barcode-scan add-to-cart**~~ — **DONE (TASK 14.3 Wave 1).**
  Corrected finding: the current platform already had a real
  `product_barcodes` table and a working `GET /products?barcode=`
  lookup before this wave — the original audit's grep simply missed it.
  Only the Flutter scan-to-add wiring was new work.
- ~~**Weight-based product pricing**~~ — **DONE (TASK 14.3 Wave 1).**
  Corrected finding: already fully supported via the existing
  `units_of_measure` schema (`dimension='mass'`, e.g. `kg`) — a more
  general, better-designed mechanism than the legacy's own bespoke
  `porPeso` boolean. Proven live with an exact fixed-point 2.35 kg sale.
- ~~**Suppliers (proveedores) CRUD**~~ — **DONE (TASK 14.4 Wave 2).** A
  real, company-scoped `suppliers` table + module + Flutter admin
  screen, plus a real `supplier_id` link on `direct_purchases`
  (frozen-name-snapshot pattern).
- ~~**Employee roster, shift scheduling, time clock**~~ — **DONE (TASK
  14.4 Wave 2).** `employees`/`employee_schedules`/`time_clock_punches`,
  all real, company/branch-scoped, distinct from login `users`, feeding
  a real payroll calculation (see P2, also now DONE).
- ~~**Register-style keyboard shortcuts** (F2/F3/F5/F6/F8/Escape)~~ —
  **DONE (TASK 14.5 Wave 3).** A real `Focus`/`onKeyEvent` handler in
  `pos_shell.dart`, verified to call the exact same code the on-screen
  controls call (including a real `GlobalKey` into the Cobrar button's
  own handler for F8), with a text-field-focus guard so shortcuts don't
  fire while typing. F4 (reprint) intentionally not wired — nothing to
  reprint mid-sale, real reprint already lives in Sale Detail history.
- ~~**Occupancy/headcount (aforo) tracking**~~ — **DONE (TASK 14.4 Wave
  2).** Real, server-computed, and genuinely bidirectional (entry **and**
  exit — stronger than the legacy's one-way-only counter). Built
  alongside a real replacement for the (fake, in the legacy too)
  ticket-scan validation — see [[LEGACY_FUNCTIONAL_PARITY]]'s §13 for why
  that specific mechanism is classified **H** (safe replacement), never
  to be read as evidence the legacy scanner ever validated anything real.
- ~~**Dashboard / per-area report screens**~~ — **DONE (TASK 14.4 Wave
  2), per-area.** 7 real report areas (Sales/Financial/Inventory/
  Customers/Employees/Parties/Access), all server-side SQL aggregation,
  CSV export on Sales/Financial, wired to a real Flutter screen. Still
  missing: a single consolidated "today at a glance" landing screen
  (sales trend + parties + alerts on one view) — see
  [[V1_POST_LAUNCH_BACKLOG]].
- **Per-tenant branding** (logo, receipt header/footer) — **PARTIALLY
  DONE (TASK 14.5 Wave 3).** Receipt header/footer text now has a real
  admin screen (`pos_receipt_branding_screen.dart`) that persists real
  data (the EAV backend already existed before this wave), but the value
  is not yet threaded into any of the 4 real print call sites — configured
  text never appears on an actual printed receipt yet. Per-tenant logo
  upload remains fully undone — no file-upload infrastructure
  (MinIO/S3/multipart/image-picker) exists anywhere, re-confirmed this
  wave. See [[V1_POST_LAUNCH_BACKLOG]].
- ~~**Product variant management UI**~~ — **DONE (TASK 14.5 Wave 3).**
  `pos_product_variants_screen.dart` (795 lines) now manages the
  pre-existing, already-more-capable `product_variants` backend.
- ~~**Catalog export (CSV)**~~ — **DONE (TASK 14.5 Wave 3).** Real
  `GET /api/v1/products/export.csv`.
- ~~**Partial cash close ("corte parcial")** and **categorized cash
  movements**~~ — **DONE (TASK 14.4 Wave 2).** A real, persisted, audited
  mid-shift snapshot (`cash_session_partial_closes`, proven to never
  transition the session's own status) and a real `category` column
  (withdrawal/expense/external_income/other, direction-constrained by a
  DB check) on `cash_movements`, extending — never duplicating — the
  existing cash foundation. Not ported: the legacy's own dedicated
  over-withdrawal guard/authorizer field and its (superficial even in
  the legacy) expense photo-evidence flag.

## P2 — genuine post-launch enhancements

- ~~**Payroll (nómina) calculation**~~ — **DONE (TASK 14.4 Wave 2).** The
  single most substantively real HR feature found in the legacy product
  (real scheduled-vs-worked hours, late-minute deductions, overtime
  bonus) is now a **faithful port** of the legacy's own
  `calcularNominaEmpleado()` formula, verified in tests against a
  hand-computed example.
- **CFDI / fiscal invoicing** — already out of scope per ADR-0012; this
  audit additionally confirms the legacy's own version never actually
  worked (simulated stamping, self-admitted in its own code/toasts), so
  there is no working capability being "lost." **Unchanged and untouched
  by TASK 14.4 (Wave 2) or TASK 14.5 (Wave 3)** — re-confirmed this wave
  by direct search: no billing/CFDI module exists anywhere in the
  repository, and no billing/CFDI file appears in this wave's own diff.
- ~~**NFC wristbands**~~ (activate/block/unblock) — **DONE (TASK 14.5
  Wave 3).** `access_credentials.credential_kind` extends the real
  access-credential table; real, permission-gated routes and Flutter UI.
  "Extend" alone stays unbuilt — **corrected finding**: the legacy's
  `extenderPulsera()` is not dead code with nonexistent DOM ids (that
  pattern applies to a different function, `activarPulsera()`); it
  genuinely runs and mutates a sync flag, but the entered "minutes to
  extend" is captured via a prompt and never written to the wristband's
  own expiry field, so nothing about the expiration ever actually
  changes — the same class of bug as the legacy's own "notas" field. See
  [[LEGACY_FUNCTIONAL_PARITY]]'s §13 for the full, corrected finding.
- **In-house customer credit accounts** — a real payment-provider path is
  the correct modern replacement, not worth reproducing as a bespoke
  ledger.
- **Scheduled email reports** — real scheduling UI existed, but the send
  itself was fake even in the legacy; low priority, low effort if ever
  wanted. **Re-confirmed still deferred in TASK 14.5 (Wave 3)** by direct
  inspection of `apps/worker` — no SMTP client dependency and no
  job-scheduling infrastructure of any kind exist.
- **Modo Cliente (self-checkout kiosk mode)** — real in the legacy, no
  current equivalent; a genuine feature, not currently needed for the
  proven V1 cashier-operated workflow. **Re-confirmed still deferred in
  TASK 14.5 (Wave 3)** — no kiosk/self-checkout code was added anywhere.
- ~~**Café visual sub-mode**~~ — **DONE (TASK 14.5 Wave 3).** A real,
  generic `product_categories.is_visual_tile` flag (never hardcoded to
  "café"), a dedicated `PosModule.cafeteria` sharing the real sale
  engine, and an honest empty state. The legacy's own `estiloCafe` was
  independently re-confirmed to be exactly what TASK 14.2R found: a
  purely visual CSS toggle, zero checkout/behavioral difference.
- ~~**A real AI assistant**~~ — **DONE (TASK 14.5 Wave 3), as a faithful
  port, not an upgrade.** `apps/api/src/modules/assistant/` is a genuinely
  deterministic keyword/intent matcher over real, live SQL data (sales
  today, register status, low stock, open parties today) — zero LLM,
  zero external calls, matching the legacy's own approach exactly, not
  exceeding it. A real LLM-backed assistant remains a genuine future
  upgrade, not a parity target.
- **Multi-step onboarding wizard** — the current CLI-based provisioning
  (TASK 14.1/14.2) is deliberately more secure than the legacy's
  single-screen wizard (which had a hardcoded-password bypass on its own
  license check); a friendlier in-app flow is a real but non-blocking
  future improvement.

## Not real — explicitly nothing to port

These were placeholder/demo-only even in the legacy product itself.
Listed here only so nobody re-discovers them later and mistakes them for
lost functionality:

- Wholesale/VIP/employee tiered pricing (editable fields, never read at
  checkout)
- Product "Variantes" and "Relacionados" (suggested products) tabs
  (static hardcoded examples)
- Catalog Excel import (fabricated success message, no real parsing)
- Formal purchase-order workflow (its own save function discarded the
  entered data) — **re-confirmed still out of scope in TASK 14.4 (Wave
  2)**; Wave 2 built a real supplier CRUD and linked it to Compra
  Directa, but deliberately did NOT rebuild the formal PO workflow
- Purchase history and supplier price-comparison screens (static
  hardcoded example rows)
- CFDI fiscal stamping (self-admitted simulation) — **untouched by TASK
  14.4 (Wave 2)**; no billing/CFDI work was done this wave
- Ticket-scan access-control validation (accepts anything, always
  "succeeds") — **TASK 14.4 (Wave 2) built a real replacement** (see
  [[LEGACY_FUNCTIONAL_PARITY]]'s §13, classified **H**), but this does
  NOT retroactively make the legacy mechanism itself real; the finding
  above (it accepted anything and always fabricated success) stands
  exactly as originally documented
- The general "Documentos" hub page (every card just shows a toast)
- General (non-party) entry waiver and satisfaction survey (single
  toast each, no real content)
- The entire sync/multi-register/backup/offline subsystem's *mechanism*
  (zero real network calls anywhere; the current platform's real
  server-authoritative architecture and TASK 14.1's real backup tooling
  already provide an equivalent that actually works)
- Notifications center (always-empty page, nothing ever populates it)
- Global tax-rate settings screen (inputs have no `id`; "Guardar" is a
  no-op — the real per-product tax mechanism lives elsewhere and does
  work)
- Sale-level "notas" field (the save button never wrote to the field
  that gets persisted — every legacy sale's note was permanently empty)
- Hardware configuration screen (hardcoded fake device list)

## Security finding — must never be replicated (already confirmed absent)

The legacy product contained a hardcoded factory/distributor master
account (`user: "asmaster", pass: "asmaster2604", pin: "2604"`) visible
in plaintext in page source, reachable from every login path, bypassing
every permission check and its own license-activation validation, and
unlocking a hidden key-generator panel. **Independently re-confirmed
absent from the current platform** — no hardcoded credential exists
anywhere in `apps/api/src` outside the explicitly dev-gated
`development/` directory. No action needed; recorded here as the
single most safety-relevant finding of this entire audit.
