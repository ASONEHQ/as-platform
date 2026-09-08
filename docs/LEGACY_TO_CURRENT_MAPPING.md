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

**TASK 14.5 (Wave 3) update**: the café visual sub-mode is now built too —
`product_categories.is_visual_tile`, a generic, tenant-configurable
boolean never hardcoded to "café"/"coffee" in application logic, wired to
a dedicated `PosModule.cafeteria` that shares the exact same real sale
engine as the main POS module, filtered to flagged categories, with an
honest empty state. Independently re-confirmed against the legacy source
that `aplicarEstiloCafe()` really was, and remains, purely a CSS toggle
(header/watermark/grid styling) with zero checkout/pricing/behavioral
difference — the current build reuses the real transaction engine either
way, so this is a real port of the visual capability, not merely a
recreation of the legacy's own cosmetic mechanism. Post-sale
animation/sound feedback remains the one open item in this section — pure
UX polish, re-confirmed still absent this wave (including after a later
pass that did have `pos_shell.dart` access). See [[LEGACY_MISSING_PORTS]]
for priority calls.

## Modo Cliente / Cajero

**Maps to**: nothing today for the kiosk/self-checkout mode itself — this
remains a real, if lower-priority, gap (re-confirmed still deferred in
TASK 14.5 Wave 3, its own large, distinct standalone feature); a
self-serve kiosk isn't part of the currently-proven V1 workflow. The
on-screen coupon-code keypad, however, is a **[TASK 14.5 Wave 3 —
corrected finding]**: `_CuponVirtualKeyboard` already existed in
`pos_shell.dart` before this wave (not new work), and — independently
verified against `coupons.code`'s real `text`-column schema — it is
correctly a full alphanumeric keyboard, not a numeric-only pad; a literal
numeric keypad, as the legacy's own row describes, would in fact be a
regression against real coupon codes.

## Catálogo / Productos

**Maps to**: `product-catalog.routes.ts`, real and thoroughly tested.
Core CRUD, categories, tax codes, and per-line manual price overrides
are fully ported. **Important finding**: the legacy's "special pricing"
tiers (wholesale/VIP/employee) and its "variants"/"related products"
tabs LOOKED complete in the UI but were never functionally real even in
the original product — they're not lost capability, they're decoy UI
that never worked. The current platform's real `product_variants` table
is actually a *stronger* foundation than the legacy ever had for
variants. **[TASK 14.5 Wave 3 — DONE]** The previously-missing Flutter
admin screen now exists (`pos_product_variants_screen.dart`, verified
substantive — 795 lines, not a stub). **[TASK 14.5 Wave 3 — DONE]**
Catalog CSV export is also now real (`GET /api/v1/products/export.csv`,
route and service verified real, not a stub) — the legacy's own working
CSV export now has a genuine current-platform equivalent.

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
**[TASK 14.5 Wave 3 — DONE, format changed]** The legacy's own working
Kardex PDF export (`exportarKardexPDF()`, independently re-confirmed to
be real — it genuinely filters real movement data into a browser
print/PDF window, not a placeholder) now has a real current-platform
equivalent: `GET /api/v1/reports/inventory/kardex.csv` (found under the
`reports` module, not `inventory`), a deliberately CSV — not PDF —
different-format port.

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
13.0. **[TASK 14.5 Wave 3 — labeling correction, not a new build]**
Independently re-verified this wave (real `customer_memberships` records
with real `issue`/`renew`/`cancel`/`validate` routes) — this was already
a strictly superior port before Wave 3, but [[LEGACY_FUNCTIONAL_PARITY]]'s
own row was written as a compound `B/A` classification, which its own
first-listed-letter rule was silently reading as **B**, not **A**, in
every prior parity percentage. Corrected to **A**; not a Wave 3 build.

## Cupones / Promociones

**Maps to**: `promotions.routes.ts`, fully ported, proven end-to-end
(including automatic "buy X get free item" logic) in this task's own
staging rehearsal. **[TASK 14.5 Wave 3 — DONE]** The legacy's
promotion-usage *report screen* (itself thin, backed by a bare `usageLog`
array) now has a real current-platform equivalent:
`GET /api/v1/reports/promotions`, an 8th real report area added to the 7
built in Wave 2.

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
replaced with a new placeholder. **[TASK 14.5 Wave 3 — DONE, partially]**
A single consolidated "today at a glance" Dashboard screen now exists —
`apps/api/src/modules/dashboard/` + `pos_dashboard_gateway.dart`, wired
into `pos_shell.dart`'s `PosModule.dashboard` (replacing the prior
context-only placeholder). Independently verified real: today's sales,
live occupancy, today's parties + rooms, open register/session status,
outstanding party balances (company-wide), and today's clocked-in
employee count — every figure computed via the same real services the
report endpoints themselves use, never a second divergent computation.
Deliberately NOT ported: the %-vs-yesterday sales trend (`vsAyer`) and
active-membership count — both real, working legacy metrics, consciously
scoped out this wave, not fabricated ones (unlike `prom_estancia` and the
always-0 occupancy figure, which were never real to begin with). Also
absent: birthday alerts. An 8th report area (Promotions usage) and a
Kardex CSV export were added to the per-area reports this wave too.

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

**[TASK 14.5 Wave 3 — DONE, NFC wristband lifecycle]** The legacy's
standalone NFC wristband CRUD (activate/block/unblock/extend), previously
never integrated with entry validation even in its own product, now maps
to `access_credentials.credential_kind` (`'ticket'`\|`'wristband'`) — a
real extension of the same real access-credential table, not a parallel
one. Activate reuses `issueCredential`, block reuses `voidCredential`,
unblock is a genuinely new CAS-guarded `unvoidCredential` transition, and
real Flutter UI exists in `pos_access_screen.dart`. "Extend" alone stays
unbuilt, with a **corrected finding**: the legacy's `extenderPulsera()` is
not dead code reading nonexistent DOM ids (independently re-checked
against the legacy source — that specific pattern belongs to a different
function, `activarPulsera()`, which really does read two DOM ids absent
from its own modal markup). `extenderPulsera()` itself takes no DOM input
at all — it uses a `prompt()` — and it does mutate a `sync` flag the same
way its sibling block/unblock functions do. The real, more precise bug:
the entered "minutes to extend" is captured but never written to the
wristband's own expiry field, so the toast claims success while nothing
about the actual expiration ever changes — the same class of bug as this
document's own "notas" field finding. Either way, there is genuinely
nothing real to port for "extend."

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
password/PIN/license-key case, actively backdoored. **[TASK 14.5 Wave 3
— DONE, safely]** The legacy's own PIN and QR "quick-switch" staff login
(plaintext PIN comparison, its own hardcoded-master bypass; QR as bare
string equality) now map to real, independently security-verified
mechanisms: `AuthService.pinLogin`/`qrLogin`, both requiring an
already-authenticated caller session, scoping company ONLY from that
session (never the request body — confirmed enforced in code), hashed
with the same real argon2id scheme as passwords, and issuing a real
session through the exact same path password login uses. The QR secret is
server-generated and cryptographically random (never client-chosen, unlike
the legacy's predictable timestamp-based generator), with a real 90-day
TTL checked before the hash comparison. Real Flutter UI
(`pos_auth_gateway.dart` + `_StaffQuickSwitchDialog`) reuses the
pre-existing `StartupPinKeypad` component — which, now that a real PIN
concept exists, also closes the legacy's separate "global numeric/PIN
keypad auto-appearing on PIN-field focus" gap (found during this wave's
own full re-verification, not in the original brief).

Per-tenant branding (logo, receipt header/footer) remains a **partial**
gap. **[TASK 14.5 Wave 3 — DONE, partially]** The receipt header/footer
EAV backend (`company_settings`/`branch_settings` keys) already existed
before this wave — a stale prior classification, corrected here. What
Wave 3 built for real: an admin screen (`pos_receipt_branding_screen.dart`)
that genuinely persists header/footer text, and the corresponding
parameters threaded into `receipt_html.dart`/`refund_receipt_html.dart`'s
own template functions. **Independently verified gap**: none of the 4
real print call sites in `pos_shell.dart` pass those parameters through —
a deliberate scope cut, not an oversight, but the practical effect is that
configured text is not yet rendered on any printed receipt. Per-tenant
logo upload remains fully undone — re-confirmed this wave that no
file-upload infrastructure (MinIO/S3, multipart, image-picker) exists
anywhere in the repository. See [[V1_POST_LAUNCH_BACKLOG]].

## UI / Interaction Flows

**Maps to**: real receipt printing for the just-completed sale (and,
better than the legacy, real byte-identical reprint for ANY historical
sale via `GET /sales/:id/receipt` — the legacy's own "reprint a past
ticket" button was itself a placeholder toast). **[TASK 14.3 Wave 1 —
DONE]** Sale-level notes: fixed for real this time — a working
`sales.note` column, round-trips exactly through creation and every
subsequent read, honestly `null` when omitted (the legacy's own note
field never actually persisted anything, a real bug in the original
product). **[TASK 14.5 Wave 3 — DONE]** Register-style keyboard shortcuts
(F2/F3/F5/F6/F8/Escape) are now real, independently verified to call the
exact same handlers the on-screen controls call (including a `GlobalKey`
into the real Cobrar button's own handler for F8), with a text-field
focus guard so they never fire mid-typing — the one legacy shortcut NOT
ported, F4 (reprint), has a documented, sound reason: there is nothing to
reprint mid-sale, and real reprint already exists in Sale Detail history.
**[TASK 14.5 Wave 3 — DONE, faithful port]** The legacy's "AI assistant"
was a local keyword-matching FAQ bot, not a real LLM — the current
platform's version (`apps/api/src/modules/assistant/`) is a faithful
port of that same approach: independently verified to be a genuinely
deterministic keyword/intent matcher over real, live SQL data (sales
today, register status, low stock, open parties today), zero LLM, zero
external calls. If a real LLM-backed assistant is ever built for AS
Platform, that remains a strict improvement over what existed, not a
parity target this wave attempted.
