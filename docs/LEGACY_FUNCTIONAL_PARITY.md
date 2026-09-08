# Legacy Functional Parity Matrix

**TASK 14.3 (Wave 1) update**: the rows below marked **[WAVE 1 — REBUILT]**
have been genuinely re-implemented on the current platform — real schema,
real server-enforced permissions, real tests (backend: 27 Fiestas + 69+14
held-sales/notes + 9 purchasing integration tests, all passing; a full
40-step end-to-end park simulation proving conflict detection, financial
traceability, restart persistence, and tenant/permission isolation with
zero mocks). Flutter UI for these is tracked separately — see each row's
own note. Nothing else in this matrix changed; every other classification
here still reflects the original TASK 14.2R audit.

Source of truth: `C:\Users\InMagic\Downloads\punto de venta INFLAPARK\AS POS V1.html`
(14,712 lines, single-file HTML+CSS+JS, entirely in Spanish) — the
canonical AS POS V1 product. Inspected in full (every section below was
grep-located then read in line-number context by a dedicated forensic
pass; nothing here is inferred from `docs/ROADMAP.md`/`AGENTS.md` or any
assumption about what a "mature POS" should have). Current-platform
columns are drawn from direct inspection of this repository's real
routes/schema/Flutter screens across this entire task chain (TASK
12–14), cross-checked with targeted greps during this pass.

**Classification key** (as specified):
A—FULLY PORTED · B—PORTED BUT BEHAVIOR DIFFERS · C—PARTIALLY PORTED ·
D—LEGACY UI EXISTS / CURRENT BACKEND MISSING · E—CURRENT BACKEND EXISTS /
UI MISSING · F—LEGACY FEATURE NOT PORTED · G—LEGACY PLACEHOLDER/DEMO ONLY
(no current-platform judgment implied — it wasn't real to begin with) ·
H—SAFELY REPLACED BY A MODERN EQUIVALENT (proof given inline)

Priority: **P0** (must exist by Sept 15) · **P1** (important for selling
to other parks) · **P2** (genuine post-launch). A **G**-classified item
gets no priority — there is nothing real to port. Full detail behind
every row lives in the six forensic sub-agent reports this document
synthesizes; the **Fiestas** module has its own dedicated deep-dive,
[[LEGACY_FIESTAS_RECOVERY]].

---

## 1. Ventas / Checkout / Ticket-Cart

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Cart build, stock check, line totals | REAL | `POST /sales` | ✅ | ✅ | ✅ | **A** | — | — |
| Percentage/fixed discount (line or ticket) | REAL | manual discount + promotions engine | ✅ | ✅ | ✅ | **A** | — | — |
| Cash payment w/ change | REAL | `POST /sales/:id/cash-payments` | ✅ | ✅ | ✅ | **A** | — | — |
| Card/credit account payment | REAL (in-house credit ledger) | Mercado Pago card path (paused) | ✅ | ✅ | ✅ | **B** | No in-house "cuenta a crédito" concept — current uses real payment provider instead | P2 |
| Post-sale animation/sound feedback | REAL | none | ❌ | n/a | ❌ | **F** | Pure UX polish | P2 |
| Suspended sales (hold/recover ticket) | REAL — real push/pop, PIN-gated recovery, F5 hotkey | **[WAVE 1 — REBUILT]** `held_sale_carts` — real server-persisted cart snapshot (never browser-only), suspend/resume/discard, restart-proof (proven live: suspend → real process kill+restart → resume → items intact → checkout → pay) | ✅ | ✅ | 🟡 Flutter in progress | **A** | Flutter UI wiring tracked separately | — |
| Weight-based products (`porPeso`) | REAL — dedicated modal, live kg×price calc | **[WAVE 1 — CORRECTED FINDING]** Already fully supported by the existing `units_of_measure` schema (`dimension='mass'`, e.g. `kg`/`g`, seeded platform-wide since migration 0004) + 6-decimal sale-item quantity — the original TASK 14.2R audit incorrectly marked this **F** because it searched for the legacy's own field name (`porPeso`) rather than the platform's more general, already-built mass-dimension mechanism. Proven live: a 2.350 kg sale computed an exact fixed-point subtotal and decremented inventory by exactly 2.35 | ✅ | ✅ | 🟡 Flutter wiring in progress | **A** (was misclassified F) | Flutter weight-entry modal tracked separately | — |
| Barcode scan (keyboard-wedge Enter-to-add) | REAL — exact barcode match on Enter | **[WAVE 1 — CORRECTED FINDING]** `product_barcodes` table + `GET /products?barcode=` filter already existed in the current platform before this wave — the original audit's grep missed it. Proven live: exact match returns the right product, an unknown barcode returns zero matches (a real, honest failure — never the legacy's own fake random-item behavior) | ✅ | ✅ | 🟡 Flutter wiring in progress | **A** (was misclassified F) | Flutter scan-to-add wiring tracked separately | — |
| Cafetería sub-mode (visual restyle by category flag) | REAL — real DOM/CSS switch driven by `estiloCafe` category flag | none | ❌ | ❌ | ❌ | **F** | Current catalog has categories but no "café-style tile" visual mode | P2 |
| Label printing (barcode/QR) | **G — placeholder**, toast only | none | — | — | — | **G** | n/a | — |

## 2. Modo Cliente vs. Modo Cajero

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Kiosk/self-service mode, requires open register to enter, employee PIN to exit | REAL — ~20 CSS rules hide cashier-only controls | none | ❌ | ❌ | ❌ | **F** | No customer-facing self-checkout mode in Flutter at all | P2 |
| On-screen numeric keypad for customer-typed coupon codes | REAL | none | ❌ | ❌ | ❌ | **F** | — | P2 |

## 3. Catálogo / Categorías / Productos / Variantes / Precios

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Product CRUD, inline edit, filters, KPIs | REAL | `product-catalog.routes.ts` | ✅ | ✅ | ✅ | **A** | — | — |
| POS category tiles (dedicated `categoriaPOS`, reorder, icon/color picker) | REAL — separate from generic product category | Categories exist and drive Flutter POS grid | ✅ | ✅ | ✅ | **A** | Icon/color theming per tile not confirmed present | P2 |
| Product tax rate (per SKU) | REAL (`mp-iva` select 0/8/16%) | `tax_code` (`IVA_GENERAL`/`IVA_EXEMPT`, correctly platform-level not tenant-specific) | ✅ | ✅ | ✅ | **A** | — | — |
| Wholesale/VIP/employee/customer-type pricing | **G — placeholder.** Six price-tier fields editable in an admin table but never read at checkout (`agregarProducto()` always uses `p.precio`) | none | ❌ | ❌ | ❌ | **G** | Nothing to port — it never worked in the legacy product either | P2 if the business actually wants tiered pricing |
| Manual per-line price override (supervisor-authorized) | REAL, PIN-gated | `discount.apply`-gated manual discount | ✅ | ✅ | ✅ | **A** (different mechanism, same real capability) | — | — |
| Product variants (size/color) | **G — placeholder.** Static hardcoded example, no data field exists, buttons only toast | Real `product_variants` table already exists (`default_variant` on every product) | ✅ | ✅ | 🟡 | **E** — current backend is *more* capable than the legacy UI ever was | Flutter admin screen to manage multiple variants per product not confirmed | P1 |
| Related/suggested products (upsell) | **G — placeholder.** Static example, no real data model, no checkout trigger | none | ❌ | ❌ | ❌ | **G** | Never real in the legacy product | P2 |
| Import catalog from Excel | **G — placeholder.** `simularImport()` injects a canned fake success message, no real file parsing | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |
| Export catalog (CSV/PDF) | REAL — genuine CSV Blob download of live data | none confirmed | ❌ | n/a | ❌ | **F** | A real, working legacy feature with no current equivalent | P1 |

## 4. Inventario / Kardex / Ajustes / Traspasos

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Stock balances, low-stock/out-of-stock KPIs | REAL | `inventory.routes.ts` balances | ✅ | ✅ | ✅ | **A** | — | — |
| Stock decrement on sale / restore on refund | REAL | Real, proven in this task's own staging rehearsal (TDA-AGUA decremented exactly, restocked exactly on refund) | ✅ | ✅ | ✅ | **A** | — | — |
| Kardex (per-product movement ledger) | REAL — every stock-affecting action logged | `inventory_movements` + real audit trail | ✅ | ✅ | ✅ | **A / H** — current platform's is server-authoritative and audit-backed vs. the legacy's capped 1000-entry in-memory array | — | — |
| Stock adjustments (Entrada/Salida/Corrección) | REAL — 3-mode workflow, PIN-gated | `inventory-counts`/`inventory-repair` modules exist | ✅ | ✅ | 🟡 | **A/B** | Flutter UI parity not fully confirmed | P1 |
| Stock transfers between branches | REAL, **with a caveat**: legacy only models one global stock number, so a "transfer" only ever decrements — it never credits a second location (no real multi-location stock pool existed in the legacy data model at all) | `inventory-transfers.routes.ts` — a genuine two-location ledger | ✅ | ✅ | 🟡 | **H** — current platform's real per-branch stock model is a strictly correct replacement for something the legacy product never actually modeled correctly | Flutter UI parity not fully confirmed | P1 |
| Inventory Kardex PDF export | REAL | none confirmed | ❌ | n/a | ❌ | **F** | — | P2 |

## 5. Compras / Proveedores (Purchasing & Suppliers)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Suppliers (proveedores) CRUD | REAL but shallow — no FK to products, `adeudo` never auto-updated | none | ❌ | ❌ | ❌ | **F** | No supplier module anywhere in current platform | P1 |
| Purchase orders (formal PO workflow) | **G — placeholder at the critical step.** Item-builder UI is real/interactive, but `saveCompra()` discards it entirely and stores literal `productos:"Varios", total:"Por confirmar"` regardless of input | none | ❌ | ❌ | ❌ | **G/F mixed** | The legacy PO feature never actually worked end-to-end; a real rebuild owes nothing to its specific (broken) implementation | P1 |
| Direct purchases (Compra Directa) | REAL — the one genuinely complete purchasing path: form → real stock increment → Kardex → history → audit log | **[WAVE 1 — REBUILT]** `direct_purchases` + a real `receipt`-type inventory movement, atomic (one transaction, no orphaned rows on failure), idempotent. Proven live: a 25-unit restock correctly increased real inventory, immediately consumable by a subsequent sale | ✅ | ✅ | 🟡 Flutter in progress | **A** | Flutter restock screen tracked separately | — |
| Purchase history | **G — placeholder.** Static hardcoded example rows, ignores real `DB.compras`, "Filtrar" is a toast stub | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |
| Supplier price comparison | **G — placeholder.** Static hardcoded example table | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |

## 6. Clientes

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Customer CRUD (nombre/tel/correo/RFC/notas) | REAL | `customers.routes.ts` | ✅ | ✅ | ✅ | **A** | RFC field not confirmed present (only relevant if CFDI is ever built) | P2 |
| In-house credit accounts | REAL | none | ❌ | ❌ | ❌ | **F** | Real payment provider is the correct modern replacement path, not a bespoke credit ledger | P2 |
| Birthday alerts on dashboard | REAL | `birth_date` field exists on customers; no dashboard exists at all (by design — see [[V1_POST_LAUNCH_BACKLOG]]) | 🟡 | ✅ | ❌ | **E** | No dashboard/BI screen exists in current platform at all | P2 |

## 7. Fiestas / Reservaciones — see [[LEGACY_FIESTAS_RECOVERY]] for full detail

**TASK 14.3 (Wave 1) update**: Fiestas moved from "deferred, own future task"
to **rebuilt in Wave 1**, per an explicit later instruction expanding scope
beyond the original deferral decision. The backend is complete and proven:
`party_rooms`/`party_packages`/`party_reservations` (+ snacks/socks/
payments/documents sub-resources), real database-enforced room-conflict
prevention (a GIST exclusion constraint, not just application logic),
a deterministic Cotizador quote engine, deposit/balance tracking that
reuses the existing real cash-movement system (no parallel financial
ledger), on-demand contract/waiver HTML generation, and real server-
enforced `party.read`/`party.manage`/`party.cancel`/`party.payment.record`
permissions — 27/27 integration tests passing, plus a live 20-step
end-to-end proof (quote math exact, deposit genuinely moves the cash
drawer, overlapping booking rejected/adjacent accepted/different-room
accepted, edit, real contract+waiver documents generated with real data).

| Legacy capability (summary) | Parity | Priority |
|---|---|---|
| Reservation CRUD, room/package admin | **[WAVE 1 — REBUILT] A** | Backend complete; Flutter UI in progress |
| Room double-booking conflict detection | **[WAVE 1 — REBUILT] A**, and stronger than the legacy — database-enforced (GIST exclusion constraint), not just application-checked | Backend complete |
| Cotizador (quoting tool) | **[WAVE 1 — REBUILT] A** — deterministic, server-computed, unit-tested | Backend complete |
| Deposit/balance tracking | **[WAVE 1 — REBUILT] A**, and safer than a from-scratch design — reuses the real, existing cash-movement ledger rather than inventing a parallel one | Backend complete |
| Contract/waiver document generation | **[WAVE 1 — REBUILT] A** — real HTML generated from real reservation data, on demand (never stored, mirroring the receipt pattern) | Backend complete |
| Snacks/socks tracking + real inventory deduction | **[WAVE 1 — REBUILT] A** | Backend complete |
| Calendar | **[WAVE 1 — REBUILT, backend] A** — a real date-range query endpoint exists; Flutter month/week/day/list views in progress | Backend complete |
| Cancellation with prior payments | **[WAVE 1 — REBUILT] A** — surfaces `hasPriorPayments`/`totalPaid` honestly, never auto-fabricates a refund (explicitly not reproducing the legacy's own gap here) | Backend complete |
| Role-permission gating (was decorative/unenforced in legacy) | **H → [WAVE 1] now real and enforced**, not just a safer pattern in the abstract — `party.read`/`party.manage`/`party.cancel`/`party.payment.record` are actually checked server-side on every route | Done |
| PIN-gated admin actions (plaintext, backdoor-bypassable in legacy) | **H** — current JWT auth is categorically safer | n/a |
| In-memory-only persistence (explicit in legacy code) | **H → [WAVE 1] now proven** — a real restart during the live E2E simulation confirmed reservations, deposits, and balances all survived exactly | Done |
| Customer linkage (legacy: free-text only) | **[WAVE 1 — REBUILT] A**, and a genuine improvement — real FK to `customers`, with a frozen display-name/phone snapshot so a later customer edit never rewrites reservation history | Backend complete |

## 8. Membresías

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Plan-level CRUD (name/price/desc, active-count) | REAL but shallow — plan-level only, no individual member records, no renewal/expiry dates | `memberships.routes.ts` — a real subscription-level model | ✅ | ✅ | ✅ | **B/A** | Current platform's is more complete than the legacy's (per-member issue/renew/cancel exists per TASK 13.0) | — |

## 9. Cupones / Promociones

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Coupon validation/redemption, usage limits, min-amount | REAL | `promotions.routes.ts` | ✅ | ✅ | ✅ | **A** | — | — |
| Automatic "buy X get free item" promos | REAL | Real promotions engine (proven in TASK 13.2/14.2 rehearsal) | ✅ | ✅ | ✅ | **A** | — | — |
| Promotion usage history / report screen | **G — placeholder/absent.** Only a raw `usageLog` field exists, no dedicated screen | none confirmed | ❌ | 🟡 | ❌ | **F** | No dedicated promotions report | P2 |

## 10. Caja / Finanzas (Cash Register)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Open/close with denomination counting | REAL | `cash.routes.ts` — real, proven end-to-end this task (denomination_counts, exact expected-vs-actual match) | ✅ | ✅ | ✅ | **A** | — | — |
| Partial cash close (corte parcial, mid-shift snapshot) | REAL — real running-total snapshot, doesn't close the shift | none | ❌ | ❌ | ❌ | **F** | Only full open/close exists, no mid-shift snapshot | P1 |
| Withdrawals (retiro) — distinct category, blocks over-withdrawal | REAL | Generic `cash_out` movement (reason_code free text) | ✅ | ✅ | 🟡 | **B** | Current mechanism is generic, not a distinct "retiro" flow with its own over-withdrawal guard/authorizer field | P2 |
| Expenses (gasto) — distinct category with evidence photo | REAL (photo evidence itself is superficial — only a flag, not the real file, even in the legacy) | Generic `cash_out` movement | ✅ | ✅ | 🟡 | **B** | No distinct expense category/photo evidence | P2 |
| External income (ingreso extra) | REAL, correctly added to expected-cash math | Generic `cash_in` movement | ✅ | ✅ | 🟡 | **B** | No distinct external-income category | P2 |
| Cash session history | REAL (`historialCortes`) | `GET /cash-sessions` | ✅ | ✅ | ✅ | **A** | — | — |
| Bitácora (structured audit log: IP/station/before-after per action) | REAL, though IP/station were themselves randomly faked in the legacy | Real `audit_log` table, populated on every mutation | ✅ | ✅ | 🟡 | **H** — current is server-authoritative and genuinely real, replacing a legacy mechanism that faked its own IP/station fields | Dedicated searchable/filterable audit-log screen in Flutter not confirmed | P2 |

## 11. Facturación CFDI (Fiscal Invoicing)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Full invoicing UI (folio, RFC, Uso CFDI, IVA calc, state machine) | REAL UI | none | ❌ | ❌ | ❌ | **F** | No CFDI module anywhere in current platform (explicitly out of scope per ADR-0012, per [[V1_POST_LAUNCH_BACKLOG]]) | P2 (compliance-driven, separate project) |
| Fiscal stamping (`timbrado`) | **SIMULATED/FAKE even in the legacy** — UUID literally suffixed `-SIMULADO`, toast self-admits "simulación — conecta un PAC para producción", zero real SAT/PAC network call anywhere | none | ❌ | ❌ | ❌ | **G** | Nothing real to port — the legacy version never actually worked | P2 |

## 12. Reportes / BI / Dashboard

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Dashboard (sales trend, today's parties, memberships, alerts) | REAL, computed from live in-memory arrays | None (by design — see [[V1_POST_LAUNCH_BACKLOG]]) | 🟡 (data exists via real paginated endpoints) | ✅ | ❌ | **E** | No dashboard screen exists; the underlying data is real and queryable today | P1 |
| Per-area reports (Ventas/Financiero/Inventario/Clientes/Empleados/Accesos) | REAL, genuinely computed via array reduces | Underlying data fully queryable via real endpoints | 🟡 | ✅ | ❌ | **E** | No dedicated report screens | P1 |
| Business Intelligence tab | REAL, mostly computed, **2 fields hardcoded even in the legacy** (`prom_estancia`=95, water-park occupancy=0 — the legacy code itself admits these aren't measurable) | none | ❌ | ❌ | ❌ | **F** (partially **G** for the 2 fake fields) | — | P2 |

## 13. Control de Acceso / Aforo / NFC Pulseras

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Ticket-scan entry validation | **G — placeholder even in the legacy.** `accScan()` ignores the typed folio and always "succeeds" with a random name from a hardcoded 5-name list — it never validates anything real | none | ❌ | ❌ | ❌ | **G** | Nothing real to port | P2 (would need to be built for real, not recovered) |
| Occupancy/headcount (aforo), auto-incremented from real ticket sales | REAL — genuinely reflects real sales data, but one-way only (no exit/decrement) | none | ❌ | ❌ | ❌ | **F** | A real, valuable legacy feature with no current equivalent | P1 |
| NFC wristbands (activate/block/unblock/extend CRUD) | REAL standalone lifecycle, **not integrated** with the (fake) access scan | none | ❌ | ❌ | ❌ | **F** | — | P2 |

## 14. Administración (Usuarios / Roles / Permisos / Sesión)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| User CRUD | REAL, client-side only | `AdministrationService` — real, server-authoritative | ✅ | ✅ | ✅ | **H** | — | — |
| Roles | REAL (fixed 7-role catalog, not user-creatable) | Real, admin-definable roles ([role.permission.manage](docs/V1_PRODUCT_INVENTORY.md)) | ✅ | ✅ | ✅ | **A/H** — current is more flexible (creatable) and server-enforced | — | — |
| Granular permissions (28 flags/role + per-user override) | REAL model, but **enforced only client-side** (any gate bypassable via devtools) — and several destructive actions bypass even that, gating on raw `rol==='admin'` string checks instead | Real, server-enforced `requirePermission()` on every route | ✅ | ✅ | ✅ | **H** — categorically safer; proof: current permission checks happen server-side in Fastify guards before any mutation runs, confirmed via this task's own live HTTP QA (cashier correctly denied refund/promotion creation with a real 403, not a client-hidden button) | — | — |
| Session management | PARTIAL even in legacy — no timeout/inactivity logout, fake IP/equipment display | Real JWT access+refresh tokens with real TTLs | ✅ | ✅ | ✅ | **H** | — | — |

## 15. Empleados (HR / Payroll)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Employee roster (distinct from login users) | REAL | none | ❌ | ❌ | ❌ | **F** | No employee-roster concept beyond login `users` | P1 |
| Weekly shift scheduling | REAL — a genuine non-Fiestas calendar feature | none | ❌ | ❌ | ❌ | **F** | — | P1 |
| Time clock / checador (manual clock-in/out) | REAL | none | ❌ | ❌ | ❌ | **F** | — | P1 |
| Payroll (nómina) — hours worked vs. scheduled, late-minute deduction, overtime bonus | **REAL — a genuinely worked calculation engine**, the single most substantive HR feature found | none | ❌ | ❌ | ❌ | **F** | Full domain gap — no payroll concept anywhere in current platform | P2 (real payroll is a substantial, compliance-adjacent feature; not a Sept 15 blocker for POS operation itself) |

## 16. Documentos (Document Hub)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| General "Documentos" hub page | **G — pure façade.** Every one of its 6 cards is `onclick="toast(...)"` only — including duplicate labels for features that ARE real elsewhere (cash-close receipt, party contract) | none | — | — | — | **G** | The hub itself never worked; the *real* underlying features (cash-close print, receipt print) already have current-platform equivalents — see rows above | — |
| Entry waiver (responsiva), general (non-party) | **G — placeholder only**, single toast, no template/logic | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |
| Satisfaction survey | **G — placeholder only** | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |
| Cash-close printable document | REAL (elsewhere, not via the hub) | Receipt printing infrastructure exists and is proven ([receipt_html.dart](apps/one/lib/features/pos/receipt_html.dart)) | ✅ | ✅ | ✅ | **A/H** | A dedicated cash-close print format not confirmed but the printing mechanism itself is real and proven | P2 |

## 17. Sincronización / Offline / Backup / Email / Notificaciones

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Multi-branch/register sync monitor, offline mode, conflict queue | **SIMULATED/FAKE.** Zero `fetch`/XHR/WebSocket in the entire 14,712-line file — every "sync" is a `setTimeout` + local mutation; opening a second browser tab would have no idea the first exists | Real server-authoritative multi-tenant architecture — every register/branch reads/writes the same real PostgreSQL database live, no "sync" step needed at all | ✅ | ✅ | ✅ | **H — categorically and provably superior.** Proof: this task's own rehearsal ran a real process kill+restart and confirmed full data consistency (28 sales, register state, inventory, refunds) with zero "sync" step required — the current architecture doesn't need to fake synchronization because there is only ever one real source of truth | — |
| Backups | **SIMULATED/FAKE, self-admitted** — restore toast literally says "Restauración simulada en modo demo," fake cloud-provider badges/latency/storage numbers | Real `pg_dump`-based backup/restore tooling with a real manifest+checksum, built and proven in TASK 14.1 | ✅ | ✅ | n/a (CLI) | **H — proven, not simulated.** Proof: `ops backup-verify --manifest <path>` is a real, pre-existing operational command this task discovered and confirmed works | — |
| Scheduled email reports | REAL scheduling CRUD, **FAKE send** (no mail API, `setTimeout` + toast) | none | ❌ | ❌ | ❌ | **F** | No email-report scheduling exists at all today | P2 |
| Notifications center | **G — placeholder.** Bell icon + badge + an always-empty page; nothing ever populates it | none confirmed | ❌ | ❌ | ❌ | **G** | Never real | P2 |

## 18. Configuración (Settings)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Business/park config (name, address, logo, capacity) | REAL, persisted (to the legacy's one working `localStorage` key) | Real company/branch admin (`AdministrationService`), server-persisted | ✅ | ✅ | 🟡 | **H** | Flutter admin screen for this not confirmed (per [[V1_POST_LAUNCH_BACKLOG]], CLI-reachable today) | P1 |
| Ticket/receipt template config (header/footer text) | REAL | Receipt template exists but per-tenant branding is a known, documented gap (one shared app-bundled logo, not per-tenant — see [[V1_POST_LAUNCH_BACKLOG]]) | 🟡 | ❌ | 🟡 | **C** | Per-tenant configurable header/footer text | P1 |
| Hardware config (printer/scale/scanner) | **G — placeholder.** Hardcoded fake device list, "Verificar" just toasts | none | — | — | — | **G** | Never real | — |
| Global tax-rate config screen | **G — placeholder** (inputs have no `id`, "Guardar" only toasts) — the *real* tax mechanism is per-product, not this screen | Per-product `tax_code`, real | ✅ | ✅ | ✅ | **H** for the real mechanism (current per-product tax is correctly designed and nationally-uniform per ADR, not a per-tenant setting needing a screen); **G** for the specific decoy screen — nothing to port | — |

## 19. Onboarding / Wizard / Branding

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| First-run setup wizard (single screen: activation key, business name, admin user+PIN) | REAL, but a single screen, not a guided multi-step flow — and its activation-key check is bypassable by the hardcoded master password (see Auth section) | Real `provision:production-owner` + `provision:business-config` CLIs, built in TASK 14.1/14.2 | ✅ | ✅ | n/a (CLI, by design — see [[V1_LAUNCH_SCOPE]]) | **H** — current CLI-based provisioning is deliberately NOT a public HTTP endpoint, refuses on conflict, uses masked password entry; categorically safer than a client-side wizard with a reversible license-key backdoor | No Flutter in-app onboarding wizard exists (intentional per [[V1_POST_LAUNCH_BACKLOG]]) | P2 |
| Branding (logo upload) | REAL but narrow (2 upload points) | One shared app-bundled logo, not per-tenant (documented gap) | 🟡 | ❌ | 🟡 | **C** | Per-tenant logo upload | P1 |

## 20. Autenticación

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Password login | REAL, **plaintext comparison**, no hashing, no backend | Real JWT-based login, hashed credentials, server-authoritative | ✅ | ✅ | ✅ | **H — proven safer.** Proof: this task's own live QA confirmed a wrong password returns a real 401 from a real server-side check, and password-activation was itself a launch-blocker independently found and fixed in TASK 14.0 | — | — |
| PIN login | REAL, plaintext, own hardcoded-master bypass | none (no PIN-based staff login exists in current platform) | ❌ | ❌ | ❌ | **F** — genuinely absent, but the legacy mechanism must NOT be recreated as-is | If a fast PIN-based cashier switch is wanted, it should be a real, server-validated, hashed-PIN mechanism — not a client-side string comparison | P1 |
| QR login | REAL (string equality only, no scanner integration) | Real customer-facing QR *identity* tokens exist ([qrTokenHttp](apps/api/src/modules/customers/customers.routes.ts)) — a different concept (customer presentation token, not staff login) | ✅ (customer-side only) | ✅ | ✅ | **F** for staff QR login specifically | No staff-login-by-QR path exists | P2 |
| **Hardcoded master/distributor backdoor** (`user:"asmaster", pass:"asmaster2604", pin:"2604"`, visible in page source, bypasses license-key validation, unlocks a hidden key-generator panel) | **CONFIRMED REAL AND DANGEROUS in the legacy product** | **Confirmed absent in current platform** — no hardcoded credential of any kind exists in `apps/api/src` outside the explicitly dev-gated `development/` directory (independently re-verified this task) | n/a | n/a | n/a | **H — must never be replicated, and has not been.** This is the single most important legacy finding for platform security posture | — | — |
| Admin/employee PIN re-auth for sensitive actions | REAL, plaintext, master-bypassable | Real permission-gated routes (`requirePermission`), no PIN-re-auth concept, no bypass | ✅ | ✅ | ✅ | **H** | — | — |

## 21. UI / Interaction Flows

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Reprint of a **just-completed** sale receipt | REAL, real branded print window | Real, proven (`receipt_html.dart`) | ✅ | ✅ | ✅ | **A** | — | — |
| Reprint of an **arbitrary historical** sale | **G — placeholder** (`reimprimirTicketById` only toasts, no real print call, despite real print infrastructure existing one function away) | Receipt is real for any sale via `GET /sales/:id/receipt` (proven byte-identical reprint in this task's own rehearsal) | ✅ | ✅ | 🟡 | **A/H** — current platform's is real for ANY sale, strictly better than the legacy's (which only worked for the just-completed one) | — | — |
| Sale-level "notas" field | **G — placeholder even in the legacy.** The notes modal never actually writes into the field that gets saved — every completed sale's `nota` is permanently empty, a real bug in the original product | **[WAVE 1 — REBUILT]** A real, working `sales.note` column — fixed for real this time, unlike its legacy ancestor. Proven live: a sale created with a note round-trips it exactly on a fresh detail read after payment; a sale created without one is honestly `null`, never a silently-dropped empty string | ✅ | ✅ | 🟡 Flutter in progress | **A** (a genuine improvement over the legacy, which never actually worked) | Flutter note-entry UI tracked separately | — |
| Keyboard shortcuts (F2/F3/F4/F5/F6/F8/Escape) | REAL, register-style muscle-memory shortcuts | Not confirmed present in Flutter | ❌ | n/a | ❌ | **F** | A real, valuable cashier-efficiency feature | P1 |
| Global numeric/PIN keypad auto-appearing on password-field focus | REAL | Not applicable in the same form (no PIN concept) | n/a | n/a | n/a | **F** | — | P2 |
| AI assistant | REAL, but a **local keyword/regex FAQ bot over live data — not an LLM, zero external API calls** anywhere in the file | AS ONE has no AI-assistant feature confirmed in current Flutter app | ❌ | n/a | ❌ | **F** | If rebuilt, this is a genuine opportunity to use a REAL LLM (the legacy version explicitly wasn't one) | P2 |
| Hidden distributor-only panel (license-key generator, gated by the master backdoor account) | **CONFIRMED REAL, security-relevant** | Confirmed absent — no equivalent hidden panel exists in current platform | n/a | n/a | n/a | **H — correctly not replicated** | — | — |

---

## How to read the priority calls in this document

A priority here means "this specific legacy capability, if it is judged
launch-critical, is the *type* of gap that would need addressing" — it is
NOT an authorization to start building any of it under TASK 14.2. See
[[LEGACY_MISSING_PORTS]] for the actual P0/P1/P2 action-plan grouping and
[[V1_LAUNCH_SCOPE]]/[[V1_POST_LAUNCH_BACKLOG]] for where each item now
lives in the roadmap.
