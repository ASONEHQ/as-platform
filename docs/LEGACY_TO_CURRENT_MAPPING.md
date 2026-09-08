# Legacy → Current Mapping

A narrative companion to [[LEGACY_FUNCTIONAL_PARITY]] — for each legacy
module, what it maps to today, and the shape of the gap where one
exists. Source: `AS POS V1.html` (14,712 lines), forensically inspected
in full. Read the matrix for the row-by-row detail and line citations;
this document is the "so what" for each module.

## Ventas / Checkout

**Maps to**: `sales.routes.ts` + `payments.routes.ts` + the Flutter POS
ticket screen. The core transaction loop (cart → discount → pay →
receipt) is fully ported and, in several respects, stronger than its
ancestor — server-authoritative pricing/tax/discount recomputation
(never trusts a client total), real idempotency-key protection against
double-submits (proven live in this task's own rehearsal), and a real
payment-provider integration path (Mercado Pago, currently paused)
instead of the legacy's in-house "credit account" fiction.

**TASK 14.3 (Wave 1) update**: three of the four cashier-workflow gaps
noted below are now closed. **Suspended/held sales** is genuinely new
work, built as `held_sale_carts` (real server-persisted cart snapshots,
suspend/resume/discard, proven restart-safe live). **Barcode-scan
add-to-cart** and **weight-based product pricing** turned out to already
have real backend support before this wave (a `product_barcodes` table
+ working lookup; `units_of_measure` with `dimension='mass'`) — the
original audit's grep simply missed them, so only the Flutter wiring was
new. The café visual sub-mode remains a real, lower-priority gap (pure
UX polish, no functional loss). Flutter UI for the three closed items is
in progress; see [[LEGACY_FUNCTIONAL_PARITY]] for current status.

**Original gap description (for the one item still open)**: the café
visual sub-mode has no current equivalent — pure UX polish (a themed
tile layout for a flagged product category); no functional gap, since
categories/products already work correctly without it. See
[[LEGACY_MISSING_PORTS]] for priority calls.

## Modo Cliente / Cajero

**Maps to**: nothing today. The current Flutter app has no
customer-facing self-checkout mode. This is a real, if lower-priority,
gap — a self-serve kiosk isn't part of the currently-proven V1 workflow.

## Catálogo / Productos

**Maps to**: `product-catalog.routes.ts`, real and thoroughly tested.
Core CRUD, categories, tax codes, and per-line manual price overrides
are fully ported. **Important finding**: the legacy's "special pricing"
tiers (wholesale/VIP/employee) and its "variants"/"related products"
tabs LOOKED complete in the UI but were never functionally real even in
the original product — they're not lost capability, they're decoy UI
that never worked. The current platform's real `product_variants` table
is actually a *stronger* foundation than the legacy ever had for
variants; what's missing is a Flutter admin screen to manage them, not
backend capability.

## Inventario

**Maps to**: `inventory.routes.ts` + the drafts/posting/counts/
reconciliation/repair/transfers module family — this is one of the
most thoroughly built domains in the current platform, arguably
stronger than the legacy's single-global-stock-number model (current
supports real per-branch/per-location balances; legacy's "transfer"
feature could only ever decrement, never credit a second location,
because no second stock pool existed in its data model). Kardex-style
movement history is fully replaced by the real `inventory_movements`
ledger, audit-backed rather than capped at an in-memory 1000 entries.

## Compras / Proveedores (Purchasing)

**Maps to**: `purchasing.routes.ts` for the one genuinely complete
legacy feature — **[TASK 14.3 Wave 1 — DONE]** "Compra Directa" (direct
purchase → immediate real stock increment) is now built: a real, atomic,
idempotent commercial record alongside a real `receipt`-type inventory
movement, proven live to correctly increase real, immediately-sellable
stock. **[TASK 14.4 Wave 2 — DONE]** A real supplier CRUD now exists too:
`suppliers` table (company-scoped) + `apps/api/src/modules/suppliers/` +
a Flutter admin screen, and `direct_purchases` gained an optional real
`supplier_id` link (a frozen-name-snapshot pattern — a later supplier
rename never rewrites past purchase history). Still nothing for the
*formal* PO workflow — re-confirmed by forensic re-check this wave as a
deliberate, unchanged scope decision, since the legacy's own formal PO
workflow never actually worked (its save function discarded the entered
line items), so rebuilding it would owe nothing to its own
implementation.

## Clientes

**Maps to**: `customers.routes.ts`, fully ported and stronger (server-
authoritative, tenant-isolated, linked into sales/rewards/refunds). The
legacy's in-house credit-account ledger has no direct equivalent, but a
real payment-provider path is the correct modern replacement, not a
bespoke credit system.

## Fiestas / Reservaciones

**Maps to**: `apps/api/src/modules/parties/` — **[TASK 14.3 Wave 1 —
DONE, backend]**. Originally scoped as its own dedicated future task per
explicit user decision during TASK 14.2, then explicitly brought into
Wave 1 scope by a later instruction. Real `party_rooms`/`party_packages`/
`party_reservations` (+ snacks/socks/payments/documents sub-resources),
a database-enforced GIST exclusion constraint preventing overlapping
room bookings (stronger than the legacy's application-only check), a
deterministic Cotizador quote engine, deposit/balance tracking that
reuses the existing real cash-movement system rather than inventing a
parallel ledger, on-demand contract/waiver HTML generation (mirroring
the platform's own receipt-generation pattern — never stored, always
regenerated from live data), and real server-enforced `party.read`/
`party.manage`/`party.cancel`/`party.payment.record` permissions
(closing the legacy's own decorative-only permission gap). 27/27
integration tests plus a live 20-step end-to-end proof (quote math
exact, deposit genuinely moves the cash drawer, conflict/adjacent/
different-room scheduling all correct, real documents generated). See
[[LEGACY_FIESTAS_RECOVERY]] for the full, dedicated recovery detail this
was built from. Flutter UI is in progress — the domain is not yet
reachable from the running app.

## Membresías

**Maps to**: `memberships.routes.ts` — genuinely more complete than the
legacy (which was plan-level only, no individual member lifecycle); the
current platform supports real per-member issue/renew/cancel per TASK
13.0.

## Cupones / Promociones

**Maps to**: `promotions.routes.ts`, fully ported, proven end-to-end
(including automatic "buy X get free item" logic) in this task's own
staging rehearsal. Only the legacy's promotion-usage *report screen*
(itself thin, backed by a bare `usageLog` array) has no current
equivalent — a minor gap.

## Caja / Finanzas

**Maps to**: `cash.routes.ts`, real and proven (denomination counting,
expected-vs-actual reconciliation, zero-discrepancy close proven live
this task). **[TASK 14.4 Wave 2 — DONE]** The legacy's richer
cash-movement taxonomy is now real, extending (never duplicating) the
existing cash foundation: `cash_movements.category` (`withdrawal`/
`expense`/`external_income`/`other`), direction-constrained by a real DB
check so an expense can never be miscategorized onto a cash-in row, and
"Corte parcial" is now a real, persisted, audited mid-shift snapshot
(`cash_session_partial_closes`) proven in tests to never transition the
session's own status. Expected-cash math was verified end-to-end this
session in a real 35-step E2E simulation with a genuine API process
kill+restart: reconciled to the exact cent identically before and after
restart. Not yet ported: the legacy's own dedicated over-withdrawal
guard/authorizer field and photo-evidence flag on expenses (the latter
was itself only a superficial flag in the legacy, never a real file).

## Facturación CFDI

**Maps to**: nothing, and per ADR-0012 this is explicitly out of scope
(the printed receipt is a purchase ticket, never a Mexican tax invoice).
Worth stating plainly: the legacy's CFDI feature was **never real** —
its own code literally suffixes the fiscal UUID with `-SIMULADO` and its
own toast says "conecta un PAC para producción." There is no working
fiscal-invoicing capability being lost here; a real CFDI integration
would be new work, not a recovery.

## Reportes / BI / Dashboard

**Maps to**: `apps/api/src/modules/reports/` — **[TASK 14.4 Wave 2 —
DONE]** the first real metrics UI in the current platform. 7 report
areas (Sales/Financial/Inventory/Customers/Employees/Parties/Access), all
genuine server-side SQL aggregation with real date-range and branch
scoping, CSV export on Sales and Financial, and the financial report
reconciles bit-for-bit against the real `CashService.summary()` fold
logic — plus `pos_reports_gateway.dart`/`pos_reports_screen.dart` (a
tabbed per-area screen). This deliberately does **not** reproduce the
legacy's own two admitted-fake fields (`prom_estancia`=95, an
always-0 water-park-occupancy metric) — those are simply absent, not
replaced with a new placeholder. Still missing: a single consolidated
"today at a glance" dashboard screen (sales trend + parties + alerts on
one view) — the per-area report screens now cover almost all of the
same underlying signal, just not on one combined screen.

## Control de Acceso / Aforo

**Maps to**: `apps/api/src/modules/access/` — **[TASK 14.4 Wave 2 —
DONE]**. Two very different legacy findings bundled under one nav item,
now both addressed, but in different ways that must not be conflated:
the ticket-*scan validation* was fake even in the legacy (`accScan()`
accepted anything and always "succeeded" with a random fabricated name)
— that finding is unchanged and still stands. What Wave 2 built is an
explicit, **new, safe replacement** for that confirmed-fake mechanism,
not a recovery of it: real server-side scan validation that honestly
rejects unknown/void/wrong-branch/already-inside/not-inside/
reentry-not-allowed cases, CAS-guarded concurrency-safe entry/exit
(proven via 2 real simultaneous-HTTP-request race tests), and a
documented re-entry policy the legacy never defined (single-use by
default, opt-in multi-use). *Occupancy tracking* — real even in the
legacy, but one-way only — is now genuinely rebuilt and improved: real,
server-computed, and bidirectional (entry **and** exit), never
client-recomputed.

## Administración (Users/Roles/Permissions)

**Maps to**: `AdministrationService` + `auth.guards.ts` — categorically
and provably superior to its legacy ancestor. The legacy's permission
matrix was real-looking but *unenforced beyond the client*, with several
destructive actions bypassing it entirely via raw `rol==='admin'` string
checks, and a hardcoded master-backdoor account (`asmaster`/
`asmaster2604`/PIN `2604`) visible in page source that bypassed
everything, including its own license-activation check. The current
platform's server-enforced permissions have no such backdoor — confirmed
absent by direct search of `apps/api/src` outside the explicitly dev-
gated `development/` directory.

## Empleados (HR / Payroll)

**Maps to**: `apps/api/src/modules/people/` — **[TASK 14.4 Wave 2 —
DONE]**. `employees`/`employee_schedules`/`time_clock_punches`/
`payroll_periods`/`payroll_period_lines` (all company/branch-scoped,
`employees` distinct from login `users`, matching the legacy's own
distinction). Payroll calculation is a **faithful port** of the legacy's
real `calcularNominaEmpleado()` formula — scheduled/worked/late/overtime
minutes, per-minute deduction/bonus, weekly salary base — verified in
tests against a hand-computed example; a closed payroll period can never
be recalculated. `pos_people_gateway.dart`/`pos_people_screen.dart`
covers roster/schedule/time-clock/payroll from the Flutter app. This was
the single most substantively real HR feature found anywhere in the
legacy file, and it is now genuinely, not just partially, ported.

## Documentos (Document Hub)

**Maps to**: nothing as a hub concept — and it shouldn't, since the
legacy hub itself was a pure façade (every card just showed a toast,
including duplicate labels for things that WERE real elsewhere in the
same app, like the cash-close receipt). The real underlying documents
(receipt, cash-close report) already have current-platform equivalents;
what's missing is not a "documents hub" but specific real documents
(e.g. a formatted cash-close print) not yet built.

## Sincronización / Offline / Backup

**Maps to**: the current platform's real server-authoritative
architecture, and TASK 14.1's real `pg_dump`-based backup/restore
tooling — both categorically, provably superior to a legacy subsystem
that was entirely simulated (zero `fetch`/XHR/WebSocket calls anywhere
in 14,712 lines; its own restore flow's toast literally says
"Restauración simulada en modo demo"). There is nothing to port here —
the current platform doesn't need to fake synchronization because there
is only ever one real database. Scheduled email reports (real UI, fake
send in the legacy) are a genuine, if minor, standalone gap.

## Configuración / Onboarding / Auth

**Maps to**: real CLI-based provisioning (TASK 14.1/14.2), real JWT
auth, real server-enforced permissions — each a safe, proven replacement
for a legacy mechanism that was plaintext, client-side-only, and in the
password/PIN/license-key case, actively backdoored. The one real,
non-security gap: per-tenant branding (logo, receipt header/footer) is
one shared app-bundled asset today, not per-company — already a
documented item in [[V1_POST_LAUNCH_BACKLOG]].

## UI / Interaction Flows

**Maps to**: real receipt printing for the just-completed sale (and,
better than the legacy, real byte-identical reprint for ANY historical
sale via `GET /sales/:id/receipt` — the legacy's own "reprint a past
ticket" button was itself a placeholder toast). **[TASK 14.3 Wave 1 —
DONE]** Sale-level notes: fixed for real this time — a working
`sales.note` column, round-trips exactly through creation and every
subsequent read, honestly `null` when omitted (the legacy's own note
field never actually persisted anything, a real bug in the original
product). Still missing: register-style keyboard shortcuts (F2/F3/F4/
F5/F6/F8) — a real cashier-efficiency feature with no current
equivalent. The legacy's "AI assistant" was a local keyword-matching FAQ
bot, not a real LLM — if a real assistant is ever built for AS Platform,
it should use a genuine LLM, which is a strict improvement over what
existed, not a parity target.
