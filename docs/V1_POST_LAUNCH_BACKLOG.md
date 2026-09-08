# V1 Post-Launch Backlog

Everything explicitly deferred past September 15, with why, and — where
relevant — what its first real step would look like.

## Events / Parties / Scheduling — MOVED: built in TASK 14.3 (Wave 1)

**This entry is superseded.** Originally deferred as its own dedicated
future task (reasoning preserved below for context), Fiestas/party-
reservations was later explicitly brought into Wave 1 scope and is now
backend-complete: real rooms/packages/reservations, database-enforced
room-conflict prevention, a deterministic quote engine, deposit/balance
tracking via the existing real cash-movement system, on-demand contract/
waiver document generation, and real server-enforced permissions —
27/27 integration tests plus a live 20-step end-to-end proof. Flutter UI
is in progress; see [[LEGACY_FUNCTIONAL_PARITY]] for current status and
[[V1_LAUNCH_SCOPE]] for the up-to-date scope statement. Package-to-
specific-room applicability (the legacy's `salonesDisponibles[]`) and
file-upload/e-signature storage for signed waivers remain genuine,
smaller POST-LAUNCH refinements — see [[LEGACY_MISSING_PORTS]].

**Original deferral reasoning (historical context only)**

**Status**: genuinely unbuilt in the *current* repository — no schema
table, API module, route, Flutter screen, or permission code exists
anywhere in this repository's history (verified across `task/12-2`,
`main`, and `task/12-2b`). This is a deliberate, already-documented Phase
4 deferral (`docs/CORE_DATA_MODEL.md`, `docs/VISION.md`,
`docs/ROADMAP.md`), not an oversight discovered here.

**TASK 14.2R update — this was real in the pre-migration product.** A
full forensic inspection of the canonical legacy prototype
(`AS POS V1.html`) confirms "Fiestas" was a substantially-built module
before the rewrite: a calendar with genuine room double-booking
detection, admin-managed rooms (salones) and packages (paquetes) with
rich pricing fields, a live interactive quoting tool, real HTML contract/
waiver generation with print output, and socks/snacks inventory tied to
a real stock ledger. See [[LEGACY_FIESTAS_RECOVERY]] for the complete,
line-cited recovery. Three things the legacy version genuinely never had,
though — a real rebuild should not treat these as "parity to restore,"
they were gaps in the original product too: it was **never persisted**
(pure in-memory, explicitly excluded from the app's one working
`localStorage` key, lost on every page reload), had **no real customer-
record linkage** (free-text name only), and its **own role-permission
flags were decorative** (defined in the UI, never actually enforced in
code). The rebuild below should preserve what was genuinely valuable
(conflict-aware scheduling, rich room/package modeling, contract
generation, live quoting) on top of the current platform's already-
proven, categorically stronger foundations.

Per an explicit decision by the product owner during TASK 14.2, this
becomes its own dedicated, separately-scoped task — not attempted inside
TASK 14.2 alongside business configuration and staging rehearsal. Building
it for real (to the standard of everything else in this codebase) means:
create/edit a party booking, date/time assignment, conflict-aware
scheduling, room/area assignment, customer + seller/employee linkage,
package/pricing, deposit + remaining-balance tracking, payment linkage,
contract generation/storage, waiver/disclaimer linkage, a status lifecycle
(booked → confirmed → completed → cancelled), a calendar UI, permissions,
tenant isolation, and full persistence/restart testing — realistically its
own multi-phase task with its own ADR, comparable in scope to everything
built across TASK 12 through 14 for the POS core.

## Mercado Pago LIVE

Built (TASK 12.4B — provider adapter, order/webhook state mapping,
terminal dispatch) but intentionally paused throughout this entire task
chain. Resuming it is its own explicitly-gated future task.

## Dedicated Reports / analytics dashboard — DONE (TASK 14.4 Wave 2, TASK 14.5 Wave 3)

**This entry is superseded — nothing here remains a backlog item beyond
two named, deliberately-scoped metrics.** The underlying data (sales,
cash sessions, refunds, inventory balances) was already fully queryable
via real, tested, paginated endpoints. **TASK 14.4 (Wave 2) update**: the
per-area report screens themselves became real and built —
`apps/api/src/modules/reports/` (7 report areas: Sales/Financial/
Inventory/Customers/Employees/Parties/Access, all real server-side SQL
aggregation, real date-range+branch scoping, CSV export on Sales/
Financial, the financial report reconciling bit-for-bit against the real
`CashService.summary()` fold logic) + `pos_reports_gateway.dart`/
`pos_reports_screen.dart`. **TASK 14.5 (Wave 3) update — independently
verified real, not taken on faith**: an 8th report area (Promotions usage,
`GET /api/v1/reports/promotions`) and a real inventory Kardex CSV export
(`GET /api/v1/reports/inventory/kardex.csv`, a deliberate CSV-not-PDF
format change from the legacy's own real `exportarKardexPDF()`) were
added. And the single consolidated "today at a glance" dashboard screen
that this entry used to flag as the one remaining piece is now real too:
`apps/api/src/modules/dashboard/` + `pos_dashboard_gateway.dart`, wired
into `pos_shell.dart`'s `PosModule.dashboard` — real today's sales, live
occupancy, today's parties + rooms, open register/session status,
outstanding party balances (company-wide), and today's clocked-in
employee count, every figure computed via the same real Wave 1/2 services
the report endpoints themselves use. Deliberately does NOT reproduce the
legacy's own two admitted-fake fields (`prom_estancia`=95, always-0
water-park occupancy) — those are simply absent, not replaced with a new
placeholder. **TASK 14.5A (Wave 3A) update — 2026-09-08**: this entry's
"what remains" is now split and mostly closed, not merely re-confirmed —
see [[LEGACY_FUNCTIONAL_PARITY]]'s "FINAL FORENSIC CORRECTION" for full
evidence. The **%-vs-yesterday sales trend (`vsAyer`)** was confirmed
genuinely real legacy math (not fake/random) and is now **DONE** —
`dashboard.service.ts` reuses the exact same real sales-aggregation call
the "today's sales" figure already makes, for yesterday's date, and
returns `null` (never a fabricated percentage) when yesterday had zero
sales. **Birthday alerts** were also confirmed genuinely real (a prior
finding claiming "no computed alert exists" was factually wrong — the
legacy's own `generarAlertas()` genuinely computed and displayed this)
and are now **DONE** — a real server-side SQL date-match query,
company/branch-scoped. **Active-membership count** was re-investigated
and found to be the opposite case: the underlying `.activas` field is
initialized to 0 and never incremented anywhere in the entire
14,712-line legacy file — a `reduce()` over permanently-inert data is
not a genuine metric, so this one correctly stays unbuilt, not as a
post-launch item but because it was never real. **TASK 14.2R update
(historical)**: the
legacy prototype's dashboard and per-area reports (Ventas/Financiero/
Inventario/Clientes/Empleados/Accesos) were genuinely computed from live
data, not static mockups — the finding that correctly predicted this was
the highest-leverage rebuild in the whole legacy audit. See
[[LEGACY_MISSING_PORTS]].

## Purchasing / suppliers — supplier CRUD DONE (TASK 14.4 Wave 2)

**Direct purchase / quick restock is DONE (TASK 14.3 Wave 1)** — a real,
atomic, idempotent commercial record alongside a real `receipt`-type
inventory movement, proven live to correctly increase real, immediately-
sellable stock. **Supplier CRUD is now also DONE (TASK 14.4 Wave 2)** —
a real, company-scoped `suppliers` table + `apps/api/src/modules/
suppliers/` + a Flutter admin screen, linked into Compra Directa via an
optional real `supplier_id` on `direct_purchases` (a frozen-name-snapshot
pattern — a later supplier rename never rewrites past purchase history).
Still out of scope, re-confirmed this wave: a genuine PO-with-receiving
workflow — the legacy's own formal purchase-order workflow never
actually worked (its save function discarded the entered line items), so
rebuilding it owes nothing to its own implementation. **Re-confirmed
untouched again in TASK 14.5 (Wave 3)** — no purchase-order module exists
anywhere in the repository, and none appears in this wave's own diff. See
[[LEGACY_MISSING_PORTS]] for full detail.

## Employee HR: payroll, time clock, shift scheduling — MOVED: built in TASK 14.4 (Wave 2)

**This entry is superseded.** TASK 14.2R's legacy audit found the
pre-migration prototype had a genuinely real, substantively-built payroll
engine (`calcularNominaEmpleado`) computing scheduled-vs-worked hours,
late-minute deductions, and overtime bonus from real time-clock punches —
the single most functionally complete HR feature found anywhere in that
codebase. **TASK 14.4 (Wave 2)** built the entire domain for real: real
`employees` (distinct from login `users`)/`employee_schedules`/
`time_clock_punches`/`payroll_periods`/`payroll_period_lines`, real
server-enforced `employee.*`/`schedule.*`/`attendance.*`/`payroll.*`
permissions, and a payroll calculation that is a **faithful port** of the
legacy's own formula, verified in tests against a hand-computed example —
a closed payroll period can never be recalculated. 20 new backend + 16
new Flutter tests. Was compliance-adjacent and a real future scope, not a
Sept 15 POS-operation blocker — it is now done ahead of that bar being
required. See [[LEGACY_MISSING_PORTS]] and [[LEGACY_FUNCTIONAL_PARITY]].

## POS workflow conveniences from the legacy product

Several real, working legacy cashier-workflow features had no current
equivalent when TASK 14.2R's forensic audit surfaced them (not
previously known to the platform's own launch-readiness audits, TASK
14.0/14.2, because those worked from the current platform's designed
scope, not from legacy evidence):

- ~~**Suspended/held sales**~~ and ~~**direct purchase/quick restock**~~
  — **DONE (TASK 14.3 Wave 1)**, backend-complete and proven live
  end-to-end (suspend → real restart → restore → pay; a real restock
  correctly increasing real, sellable inventory). Flutter UI in
  progress.
- ~~**Barcode-scan add-to-cart**~~ and ~~**weight-based product
  pricing**~~ — **DONE (TASK 14.3 Wave 1)**. Corrected finding for both:
  the current platform already had the real backend mechanism
  (`product_barcodes` + a working lookup; `units_of_measure` with
  `dimension='mass'`) before this wave — the original audit's grep
  simply missed them. Only the Flutter wiring was new work, now in
  progress.
- ~~**Register-style keyboard shortcuts** (F2/F3/F5/F6/F8/Escape)~~ —
  **DONE (TASK 14.5 Wave 3)**, independently verified to call the exact
  same handlers the on-screen controls call (including a real `GlobalKey`
  into the Cobrar button's own handler for F8), with a text-field-focus
  guard so shortcuts never fire mid-typing. F4 (reprint) intentionally
  not wired — nothing to reprint mid-sale, real reprint already lives in
  Sale Detail history.
- ~~**Occupancy/headcount (aforo) tracking**~~ — **DONE (TASK 14.4 Wave
  2).** Real, server-computed, and genuinely bidirectional (entry **and**
  exit — stronger than the legacy's one-way-only counter). Built
  alongside a real, honest replacement for the legacy's ticket-scan
  *validation* (`accScan()`), which was confirmed fake — accepted any
  input and always fabricated success. That replacement is an explicit,
  documented safe-replacement of a confirmed-fake mechanism, not
  retroactive evidence the legacy scanner ever worked — see
  [[LEGACY_FUNCTIONAL_PARITY]]'s §13.
- ~~**Partial cash close ("corte parcial")** and **categorized cash
  movements**~~ — **DONE (TASK 14.4 Wave 2).** A real, persisted, audited
  mid-shift snapshot (`cash_session_partial_closes`, proven in tests to
  never transition the session's own status) and a real `category`
  column (withdrawal/expense/external_income/other, direction-constrained
  by a DB check) on `cash_movements` — extending, never duplicating, the
  existing TASK 12.7 cash foundation. Not ported: the legacy's own
  dedicated over-withdrawal guard/authorizer field and its (superficial
  even in the legacy) expense photo-evidence flag.
- ~~**Modo Cliente** (self-checkout kiosk mode)~~ — **DONE (TASK 14.5A,
  Wave 3A).** Wave 3's own reasoning ("not needed for the proven
  cashier-operated V1 workflow") did not survive re-inspection: the
  legacy's checkout button was never actually disabled in Modo Cliente,
  making it a genuinely functional autonomous self-checkout kiosk, not
  a read-only display. A real "CLIENTE mode" already existed in the
  current platform; its 2 real gaps are now closed — entry gates on a
  real open cash-register session, and exit requires real employee PIN
  re-authentication (`PosAuthGateway.pinLogin`) rather than a bare
  permission check. Add-to-cart and checkout reuse the exact same real
  `SaleSession.addProduct`/`PosSalesGateway.createSale` path CAJERO uses.
- ~~**Post-sale success animation/sound**~~ — **DONE (TASK 14.5A, Wave
  3A).** Confirmed genuinely real in the legacy (fires only after every
  real sale mutation commits, never on a failed precondition).
  Implemented as `pos_post_sale_feedback.dart`, fires only after genuine
  server-confirmed sale completion, defensive/non-blocking.
- ~~**Café visual sub-mode**~~ — **DONE (TASK 14.5 Wave 3).** A real,
  generic `product_categories.is_visual_tile` flag (never hardcoded to
  "café"/"coffee"), a dedicated `PosModule.cafeteria` sharing the exact
  same real sale engine as the main POS module, and an honest empty
  state. Independently re-confirmed against the legacy source that
  `aplicarEstiloCafe()` really was, and remains, purely a CSS toggle with
  zero checkout/behavioral difference — the current build ports the real
  visual capability, not the legacy's own cosmetic mechanism as-is.
- ~~**NFC wristbands**~~ (activate/block/unblock) — **DONE (TASK 14.5
  Wave 3).** A real `access_credentials.credential_kind` extension, real
  permission-gated routes, and real Flutter UI. "Extend" stays unbuilt —
  a corrected finding, not an oversight: the legacy's `extenderPulsera()`
  captures a "minutes to extend" value but never writes it to the
  wristband's own expiry field, so nothing about the actual expiration
  ever changes even though it runs and shows a success toast.
- ~~**PIN and QR staff quick-switch login**~~ — **DONE (TASK 14.5 Wave
  3), safely.** Independently security-verified: session-gated, company
  scope taken only from the caller's own session, real argon2id hashing,
  real session issuance, a server-generated random QR secret with a real
  90-day TTL. Never a bare-PIN-as-login or client-chosen QR value like
  the legacy.
- ~~**A real (deterministic, faithful-port) AI assistant**~~ — **DONE
  (TASK 14.5 Wave 3).** `apps/api/src/modules/assistant/` — a genuinely
  deterministic keyword/intent matcher over live SQL data, zero LLM/
  external calls, matching the legacy's own approach rather than
  exceeding it. A real LLM-backed assistant remains a distinct, future,
  non-parity upgrade.
- ~~**Catalog export (CSV)**~~ and ~~**Product variant management UI**~~
  and ~~**Inventory Kardex export**~~ and ~~**Promotion usage history
  report**~~ — all **DONE (TASK 14.5 Wave 3)**; see
  [[LEGACY_MISSING_PORTS]] for each item's own detail.

See [[LEGACY_MISSING_PORTS]] for the complete list and reasoning, and
[[LEGACY_FUNCTIONAL_PARITY]] for the full evidence-backed matrix this is
drawn from.

## Per-tenant receipt branding — DONE (TASK 14.5A, Wave 3A)

**This entry is superseded — both halves are now closed.** TASK 14.5A
confirmed the legacy's operator-configured logo upload
(`cfgNegocioLogoSeleccionado()`) was genuine, repeatable, persistent
debt — not a hardcoded/static logo — and, critically, that in the
legacy this real logo was applied to real printed/exported documents
(ticket, contract, receipt templates), not just chrome decoration. Built
this wave: a real `@aws-sdk/client-s3` MinIO client wired to the
already-provisioned MinIO container (`compose.yaml`), a `branding.
logo_url` company-setting key (reusing the existing generic settings
CAS mechanism, zero migration needed), real multipart upload (magic-byte
content-type verification, 2MB cap) + delete endpoints, and a real
Flutter admin screen (`pos_branding_screen.dart`). Tested against real
Postgres + real MinIO: upload+retrieve, wrong-type→415, spoofed-
signature→415, oversized→413, real cross-tenant isolation, delete clears
setting+object.

Receipt *header/footer text* is also now fully closed: the EAV backend
and admin screen (`pos_receipt_branding_screen.dart`) pre-existed Wave
3; this wave threaded both the header/footer text AND the newly-real
logo URL through all 4 real print call sites in `pos_shell.dart` — a
configured header/footer and an uploaded logo now genuinely reach
printed receipts, both normal-sale and refund. Deliberate, documented
scope boundary: the platform's own topbar/sidebar brand mark continues
to show the AS ONE product identity rather than a per-tenant image —
consistent, already-established product chrome (the same mark used at
login/splash), distinct from the legacy's single-tenant deployment where
"the app" and "the one business" were the same thing by construction.

## Forced password-change-on-first-login

No mechanism exists to require a new user change their initial password on
first login. Mitigated procedurally for launch (in-person handoff); a real
technical fix would add a `must_change_password` flag checked at login.

## CFDI / fiscal tax invoicing

Explicitly out of scope per ADR-0012 — the printed receipt is a purchase
ticket, never represented as a Mexican CFDI tax invoice. A real CFDI
integration is a substantial, separate compliance-driven project.
**Re-confirmed untouched by TASK 14.5 (Wave 3)** — no billing/CFDI module
exists anywhere in the repository, and none appears in this wave's own
diff. **TASK 14.5A finding**: the legacy's own invoicing UI is not
"real work minus the compliance step" — its `emitirCFDI()` draft-creation
half was genuinely real in isolation, but the capability's entire
purpose (a legally valid invoice) depended on `timbrarFactura()`, which
was always simulated (self-admitted `-SIMULADO` suffix and toast). A
correctly-computed but never-stampable draft was never a complete real
capability, so nothing here is legacy parity debt — a real CFDI/PAC
integration, if ever built, is a new-product capability, not a port.

## Flutter admin screens for company/branch/user/role management

Fully supported via the authenticated API and the CLI tooling built in
TASK 14.1/14.2; no dedicated Flutter UI exists for an owner to manage this
without going through the API directly (or asking an operator to run the
CLI). A real convenience improvement, not a launch blocker — the same
functionality is fully reachable today.

## Thermal/direct printer integration

The browser-print path (a native browser print dialog against an
80mm-formatted HTML receipt) is the accepted, proven launch mechanism.
Direct thermal-printer driver integration was explicitly out of scope per
TASK 14.0's own instruction and remains so.
