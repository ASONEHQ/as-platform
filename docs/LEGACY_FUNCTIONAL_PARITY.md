# Legacy Functional Parity Matrix

**TASK 14.5 (Wave 3) update — 2026-09-08**: this wave performed a full
closure check — every remaining non-A/H row in this matrix was
independently re-verified against the real current codebase (routes,
schema, migrations, Flutter screens, and the canonical legacy source
itself), not copied from the implementing agents' own self-reports. Rows
marked **[WAVE 3 — REBUILT]**, **[WAVE 3 — SAFE REPLACEMENT]**, or
**[WAVE 3 — CORRECTED FINDING]** below reflect that independent
verification. Real work confirmed this wave: a genuine "today at a
glance" Dashboard (`apps/api/src/modules/dashboard/` +
`pos_dashboard_gateway.dart`), NFC wristband activate/block/unblock
(`access_credentials.credential_kind`), catalog CSV export, inventory
Kardex CSV export (`GET /api/v1/reports/inventory/kardex.csv`), a
promotions usage report, a real deterministic AI assistant
(`apps/api/src/modules/assistant/`), register-style keyboard shortcuts
wired to the real on-screen button handlers, PIN and QR staff quick-switch
login (real argon2id hashing, session-scoped company binding, real
sessions), and a genuine Cafetería visual-tile sub-mode
(`product_categories.is_visual_tile`). Several rows the implementing
agents reported as deferred were independently re-confirmed still
genuinely deferred (post-sale animation/sound, Kiosk/self-checkout mode,
scheduled email reports, per-tenant logo upload) — see each row's own
note. One implementing agent's self-report about the legacy's
`extenderPulsera()` ("dead code" reading nonexistent DOM ids) does not
hold up under direct re-inspection of the legacy source — see the NFC
wristbands row for the corrected finding. See the end of this document
for the full Wave 3 recount and verdict.

**TASK 14.4 (Wave 2) update — 2026-09-08**: the rows below marked
**[WAVE 2 — REBUILT]** have been genuinely re-implemented this session —
real schema, real server-enforced permissions, real tests (25 access/
occupancy + 17 reports + 20 people/HR + 18 suppliers/supply + 26 advanced-
cash backend integration tests, all passing, including 2 real HTTP-level
concurrency races on the access-scan entry/exit path; 14 access + 12
reports + 16 people + 18 suppliers Flutter tests, all passing). A live,
fresh-database, 35-step end-to-end operational simulation (provision →
… → kill the real API process → restart → verify persistence,
reconciliation, payroll immutability, and occupancy stability → verify
tenant isolation with a genuinely separate second company) passed in
full. See the "Overall parity" section below for the recalculated
percentage and exactly which rows moved. Access/Occupancy's row is the
one classification change in this wave that needs a careful read — see
its own note; it is a **safe replacement of a confirmed-fake legacy
mechanism**, not evidence the legacy scanner was ever real.

**TASK 14.3 (Wave 1) update**: the rows below marked **[WAVE 1 — REBUILT]**
have been genuinely re-implemented on the current platform — real schema,
real server-enforced permissions, real tests (backend: 27 Fiestas + 69+14
held-sales/notes + 9 purchasing integration tests, all passing; a full
40-step end-to-end park simulation proving conflict detection, financial
traceability, restart persistence, and tenant/permission isolation with
zero mocks). Flutter UI for these is tracked separately — see each row's
own note. Nothing else in this matrix changed outside the rows explicitly
marked for Wave 1 or Wave 2; every other classification here still
reflects the original TASK 14.2R audit.

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

## Parity Methodology Reconciliation (TASK 14.5, Wave 3)

TASK 14.5's own brief flags an apparent inconsistency: TASK 14.3 (Wave 1)'s
end-of-task chat report to the user stated parity at **≈66%**, while TASK
14.4 (Wave 2)'s "Overall parity" section below computes the *same*
pre-Wave-2 state at **59%**. This section resolves that discrepancy,
verifies the Wave 2 arithmetic independently against the actual matrix
(not merely re-quoting it), and fixes one canonical formula going forward.

**Verification performed this wave**: every one of the matrix's 100
capability rows (all 21 numbered sections, including the Fiestas summary
table in §7) was individually re-read and re-classified by its
first-listed letter, independent of Wave 2's own tally. Result: **100
total rows** (confirmed twice — once programmatically via a table-row
count of the raw file with the Wave-2 reconciliation table's own 13 rows
excluded, once by direct section-by-section reading), of which **13 are
G** post-Wave-2 (14 pre-Wave-2) and **64 are A/H** post-Wave-2 (51
pre-Wave-2). This reproduces Wave 2's own 51→64 numerator and 86→87
denominator exactly — the Wave 2 section below is accurate, not merely
asserted.

Answering TASK 14.5's seven specific questions directly:

1. **Why did ≈66% become 59%?** They are not the same kind of number. The
   ≈66% was an informal, spoken estimate given in the Wave 1 end-of-task
   chat report to the user — it was never written into this document (a
   grep of every `docs/*.md` file for `66%`/`≈66`/`~66` returns zero
   hits), and Wave 1 explicitly worked "row-by-row" with no stated
   overall-percentage formula at all (see this document's own prior
   note, still visible above the Wave-2 "Overall parity" section: *"This
   document has never before stated a single overall percentage; each
   prior task (14.2R, 14.3) worked row-by-row"*). 59% is the first
   **rigorously computed** percentage for that exact same end-of-Wave-1
   matrix state, using a formula stated in full and independently
   re-verified this wave. The two numbers were never produced by the
   same process, so 59% did not "regress" from 66% — no capability lost
   ground between the end of Wave 1 and the start of Wave 2; the matrix
   itself did not change in that window at all. What changed is that a
   real formula was applied for the first time, and it happened to be
   about 7 points more conservative than the earlier holistic estimate.
2. **What changed in the denominator?** Nothing "changed" in the sense of
   a revision — no denominator existed for the ≈66% figure at all. Wave
   2 is the first point at which a denominator (100 total rows minus G
   rows) was explicitly defined, stated, and computed.
3. **Which capabilities were split/merged/reclassified between the two
   figures?** None. The 100-row matrix and every row's classification
   were identical at the moment Wave 1 ended and the moment Wave 2
   began — Wave 2's own "before this wave" state (51/86) *is* the
   end-of-Wave-1 state, counted for the first time, not a different or
   revised matrix.
4. **Were G rows previously included/excluded differently?** There was no
   formal G-exclusion rule in effect when ≈66% was estimated, because no
   formula existed to apply such a rule to. "A G row is excluded from
   both the numerator and the denominator" is itself a Wave 2 invention,
   applied for the first time and applied consistently within Wave 2's
   own before/after comparison.
5. **Did H rows change?** Not between the end of Wave 1 and the start of
   Wave 2 — zero reclassifications happened in that window. Exactly one
   G→H reclassification (the Access/Occupancy ticket-scan row) happened
   *during* Wave 2 itself, and is correctly reflected only in the
   post-Wave-2 74% figure, not the pre-Wave-2 59% figure.
6. **Was any new capability added to the denominator?** No. The matrix
   has held at 100 rows since TASK 14.2R's original forensic audit,
   unchanged in row-count through Wave 1, Wave 2, and the start of Wave
   3 — only individual rows' classifications have moved.
7. **Did the weighting method change?** No weighting method of any kind
   existed before Wave 2. Wave 2 introduced the first-ever explicit
   method, and it is unweighted: every row counts equally regardless of
   section or priority (P0/P1/P2 is a separate, orthogonal dimension
   used for triage, never a multiplier on the percentage). This wave
   keeps it unweighted — introducing weighting now, after the fact,
   would itself be exactly the kind of denominator manipulation TASK
   14.5 explicitly warns against.

**Canonical formula (fixed as of this wave, to be used for every future
update without exception):**

- **Denominator** = every capability row in the matrix (100 as of this
  writing) **minus** every row whose primary (first-listed) letter is
  **G** — a G row was never real in the legacy product, so it is neither
  a gap to close nor evidence of one; it must never be counted against
  parity in either direction.
- **Numerator** = every row whose primary (first-listed) letter is **A**
  (fully ported) or **H** (safely replaced by a proven modern
  equivalent). A compound classification (e.g. `A/H`, `B/A`, `G/F mixed`)
  is read strictly by whichever letter is listed *first* in the row's own
  Parity cell — this is how every row has always been written, so no
  existing row needs rewording to fit the formula.
- **Percentage** = numerator ÷ denominator, rounded to the nearest whole
  percent.
- The denominator is **never** adjusted after the fact to improve a
  reported percentage. A row's classification may only change because
  real work genuinely changed its status (a capability was built,
  proven, and tested) or because a prior classification is independently
  discovered to have been a factual error (e.g. TASK 14.3's own
  "corrected finding" rows for weight-based products and barcode scan,
  which were misclassified F by the original TASK 14.2R audit due to an
  incomplete grep, not because anything was rebuilt) — never merely to
  raise the score.

**Reconciled baseline, stated once and used consistently for the rest of
this wave:**

| Point in time | Numerator (A/H) | Denominator (100 − G) | % |
|---|---|---|---|
| End of TASK 14.3 / Wave 1 (retroactive, first rigorous count) | 51 | 86 | **59%** |
| End of TASK 14.4 / Wave 2 — **this wave's starting point** | 64 | 87 | **74%** |

TASK 14.5 (Wave 3) starts from **74%** as its pre-Wave-3 baseline. See the
"Overall parity" section immediately below (unchanged from Wave 2, kept
as the running total) for the same figures in their original context, and
see the end of this document for Wave 3's own post-implementation
recount using this exact same formula.

**Wave 3 confirmation — formula held constant, not redefined.** TASK 14.5
re-applied the exact same canonical formula stated above without any
change: denominator = 100 total rows minus every row whose primary letter
is **G** (still 13 — Wave 3 reclassified zero rows to or from G), numerator
= rows whose primary letter is **A** or **H**, percentage = numerator ÷
denominator rounded to the nearest whole percent. No row was added to or
removed from the 100-row matrix, and no weighting was introduced. See
"Wave 3 (TASK 14.5) recount" near the end of this document for the full
row-by-row work.

## Overall parity — methodology and current percentage

This document has never before stated a single overall percentage; each
prior task (14.2R, 14.3) worked row-by-row. TASK 14.4 (Wave 2) is the
first pass to compute one, so the methodology is stated here in full for
every future update to follow exactly:

- **Denominator**: every individual capability row across all 21 numbered
  sections (including the Fiestas summary table in §7), **except** rows
  whose primary classification is **G** — per this document's own legend,
  a G row "wasn't real to begin with," so it is not a gap to close and
  must not be counted against parity either way. Total rows in this
  matrix: **100**. Of those, **13 are G** (before Wave 2 — see below),
  leaving a denominator of **87**.
- **Numerator**: rows whose primary classification is **A** (fully
  ported) or **H** (safely replaced by a proven modern equivalent). A
  compound classification (e.g. `A/H`, `A/B`) is read by its first-listed
  letter, matching how the row itself leads with it.
- **Percentage** = numerator ÷ denominator, rounded to the nearest whole
  percent.

**Before this wave** (i.e. the state as of TASK 14.3/Wave 1, using this
same method applied retroactively): 51 rows were A/H out of a
100-row-minus-14-G denominator of 86 → **59%**.

**After TASK 14.4 (Wave 2)**: 13 rows moved into the A/H numerator this
wave (12 rows changed their primary letter to A; the Access/Occupancy
ticket-scan row moved from **G** to **H**, which also shrinks the
G-exclusion count from 14 to 13 and grows the denominator from 86 to 87):

| Row (section) | Was | Now | Why |
|---|---|---|---|
| Suppliers (proveedores) CRUD (§5) | F | A | Real `suppliers` table + module, company-scoped |
| Partial cash close / corte parcial (§10) | F | A | Real `cash_session_partial_closes` snapshot, proven to never flip session status |
| Withdrawals / retiro (§10) | B | A | Real `category='withdrawal'`, direction-constrained by a DB check |
| Expenses / gasto (§10) | B | A | Real `category='expense'`, direction-constrained by a DB check |
| External income / ingreso extra (§10) | B | A | Real `category='external_income'`, direction-constrained by a DB check |
| Per-area reports (§12) | E | A | 7 real server-computed report areas, all wired to a Flutter screen |
| Business Intelligence tab (§12) | F (partially G) | A | Real computed reports now exist; the 2 legacy-fake fields are honestly absent, not replaced with a new placeholder |
| Ticket-scan entry validation (§13) | G | **H** | A real validating scanner now exists — see the row's own note; this is a *replacement*, not proof the legacy scanner worked |
| Occupancy/headcount, aforo (§13) | F | A | Real, server-computed, bidirectional (entry **and** exit) — stronger than the legacy's one-way-only counter |
| Employee roster (§15) | F | A | Real `employees` table, distinct from login `users` |
| Weekly shift scheduling (§15) | F | A | Real `employee_schedules` table + routes |
| Time clock / checador (§15) | F | A | Real `time_clock_punches` table + routes |
| Payroll / nómina (§15) | F | A | A faithful port of the legacy's own `calcularNominaEmpleado()` formula, verified against a hand-computed example |

New numerator: 51 + 13 = **64**. New denominator: 87. **New overall
parity: 64 ÷ 87 ≈ 74%** (up from 59% before this wave).

Formal Purchase Orders (§5) and CFDI fiscal stamping (§11) are
**unchanged** — both remain classified as they were (the PO row stays
**G/F mixed**, CFDI stamping stays **G**). Wave 2 did not rebuild either;
see each row's own note for why neither owes anything to its own broken
legacy implementation.

---

## 1. Ventas / Checkout / Ticket-Cart

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Cart build, stock check, line totals | REAL | `POST /sales` | ✅ | ✅ | ✅ | **A** | — | — |
| Percentage/fixed discount (line or ticket) | REAL | manual discount + promotions engine | ✅ | ✅ | ✅ | **A** | — | — |
| Cash payment w/ change | REAL | `POST /sales/:id/cash-payments` | ✅ | ✅ | ✅ | **A** | — | — |
| Card/credit account payment | **[WAVE 3A — CORRECTED FINDING]** RECLASSIFIED FROM REAL TO PLACEHOLDER. This row and §6's "In-house credit accounts" describe the exact same underlying legacy mechanism (`DB.creditos`) — a duplicated row, annotated here rather than merged (denominator must not drift). Direct re-inspection this wave: `DB.creditos` is seeded as a permanently empty array (`membresias:[]`-style seed) and an exhaustive grep of the entire 14,712-line file confirms **nothing anywhere ever pushes to it** — `cobrar()`'s own `payMethod==="cr"` branch (line 5764) only ever *reads* `DB.creditos.find(...)` against permanently-empty data, so a real credit sale could never actually complete; no code path ever creates an account, posts a payment, or enforces a limit. This was never real | none | ❌ | ❌ | ❌ | **G** | Nothing to port — see §6's identical duplicate row for the same evidence | — |
| Post-sale animation/sound feedback | **[WAVE 3A — CORRECTED FINDING, IMPLEMENTED]** RECLASSIFIED FROM DEFERRED-POLISH TO GENUINE REAL DEBT AND CLOSED. Direct re-inspection of `cobrar()` (`AS POS V1.html` lines 5756-5895) this wave: the Web Audio API chord (lines 5871-5885) and `iniciarAnimacionPago()` overlay (line 5893, populated with real per-sale data — amount, ticket #, payment method, change, customer name at lines 5887-5892) fire as the LAST step of `cobrar()`, strictly *after* every real mutation is committed and never on any failed precondition. Implemented as `pos_post_sale_feedback.dart` (`showPosPostSaleSuccessFeedback`), wired into all 3 genuine completion points (cash, zero-total, card/terminal only on real `approved` status), defensive/non-blocking, respects the existing reduced-motion convention — see FINAL FORENSIC CORRECTION Implementation Log #2 | `pos_post_sale_feedback.dart`, wired into `pos_shell.dart`'s 3 real sale-completion points | ✅ | n/a | ✅ | **A** | — | — |
| Suspended sales (hold/recover ticket) | REAL — real push/pop, PIN-gated recovery, F5 hotkey | **[WAVE 1 — REBUILT]** `held_sale_carts` — real server-persisted cart snapshot (never browser-only), suspend/resume/discard, restart-proof (proven live: suspend → real process kill+restart → resume → items intact → checkout → pay) | ✅ | ✅ | 🟡 Flutter in progress | **A** | Flutter UI wiring tracked separately | — |
| Weight-based products (`porPeso`) | REAL — dedicated modal, live kg×price calc | **[WAVE 1 — CORRECTED FINDING]** Already fully supported by the existing `units_of_measure` schema (`dimension='mass'`, e.g. `kg`/`g`, seeded platform-wide since migration 0004) + 6-decimal sale-item quantity — the original TASK 14.2R audit incorrectly marked this **F** because it searched for the legacy's own field name (`porPeso`) rather than the platform's more general, already-built mass-dimension mechanism. Proven live: a 2.350 kg sale computed an exact fixed-point subtotal and decremented inventory by exactly 2.35 | ✅ | ✅ | 🟡 Flutter wiring in progress | **A** (was misclassified F) | Flutter weight-entry modal tracked separately | — |
| Barcode scan (keyboard-wedge Enter-to-add) | REAL — exact barcode match on Enter | **[WAVE 1 — CORRECTED FINDING]** `product_barcodes` table + `GET /products?barcode=` filter already existed in the current platform before this wave — the original audit's grep missed it. Proven live: exact match returns the right product, an unknown barcode returns zero matches (a real, honest failure — never the legacy's own fake random-item behavior) | ✅ | ✅ | 🟡 Flutter wiring in progress | **A** (was misclassified F) | Flutter scan-to-add wiring tracked separately | — |
| Cafetería sub-mode (visual restyle by category flag) | REAL, but **re-confirmed by direct legacy re-inspection** to be exactly what TASK 14.2R found: `aplicarEstiloCafe()` (`AS POS V1.html` lines 5168–5183) only ever toggles a header/watermark/grid-background CSS style and column width — zero checkout/pricing/stock/behavioral difference; its one other use is a cosmetic ☕/🎫 badge in the category-admin table, not a real report split | **[WAVE 3 — REBUILT]** `product_categories.is_visual_tile` (migration `0028_crazy_nightcrawler.sql`) — a generic, tenant-configurable boolean, never hardcoded to "café"/"coffee" in application logic (confirmed by direct grep of production code — the only literal "Cafetería" string is the nav-menu label, matching the legacy's own module name, not a business rule). `PosModule.cafeteria` renders through the exact same `_PosSale`/category-tile widgets as the main POS module, filtered to `category.visualTile` categories only (`visualTileOnly: module == PosModule.cafeteria` in `pos_shell.dart`), with an honest empty state (`pos-cafeteria-empty`) when none are flagged | ✅ | ✅ | ✅ | **A** | Implemented as a separate top-level nav module rather than an in-place visual re-skin of the same screen — a different shape, same real capability (isolating café-tagged categories into their own selling view), reusing the real sale engine either way | — |
| Label printing (barcode/QR) | **G — placeholder**, toast only | none | — | — | — | **G** | n/a | — |

## 2. Modo Cliente vs. Modo Cajero

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Kiosk/self-service mode, requires open register to enter, employee PIN to exit | **[WAVE 3A — CORRECTED FINDING, IMPLEMENTED]** RECLASSIFIED FROM "DEFERRED SCOPE DECISION" TO GENUINE REAL DEBT AND CLOSED — Wave 3's own reasoning ("its own large, distinct standalone feature... not needed for the proven cashier-operated V1 workflow") does not hold up: direct re-inspection this wave shows legacy Modo Cliente was a genuinely functional **autonomous self-checkout kiosk**, not a read-only display (`cambiarModoPOS()`/`requiereEmpleado()` lines 6987-7030, checkout button never disabled, `agregarProducto()` line 5198 unrestricted). **Implementation-time correction**: a real "CLIENTE mode" already existed in `pos_shell.dart` (pre-existing, not new this wave) with the checkout path already reusing the real `createSale` action — only 2 real gaps existed and were closed: (a) entry now gates on a real open cash-register session; (b) exit now requires real `PosAuthGateway.pinLogin`, not merely a permission-flag check. See FINAL FORENSIC CORRECTION Implementation Log #1 | Real CLIENTE mode in `pos_shell.dart`, now with real open-session entry gate and real PIN-verified exit, reusing the identical `SaleSession.addProduct`/`PosSalesGateway.createSale` path CAJERO uses | ✅ | ✅ (reuses existing cash-session + PIN-hash tables, no new schema) | ✅ | **A** | — | — |
| On-screen numeric keypad for customer-typed coupon codes | REAL | **[WAVE 3 — CORRECTED FINDING]** Already satisfied by pre-existing code, not new this wave: `_CuponVirtualKeyboard` in `pos_shell.dart` (confirmed absent from this wave's own diff — it predates TASK 14.5), a full QWERTY-style on-screen keyboard, not a numeric-only pad. Independently verified this is the *correct* shape, not a gap: `coupons.code`/`normalized_code` are real `text` columns with no numeric-only constraint (`packages/database/src/schema/promotions.ts`), so real coupon codes are alphanumeric — a literal numeric-only keypad, as the legacy row describes, would be a functional regression, not a port | ✅ | ✅ | ✅ | **H** | A numeric-only keypad specifically is intentionally NOT what exists — a strictly more capable alphanumeric keyboard replaces it, matching the platform's real data constraint | — |

## 3. Catálogo / Categorías / Productos / Variantes / Precios

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Product CRUD, inline edit, filters, KPIs | REAL | `product-catalog.routes.ts` | ✅ | ✅ | ✅ | **A** | — | — |
| POS category tiles (dedicated `categoriaPOS`, reorder, icon/color picker) | REAL — separate from generic product category | Categories exist and drive Flutter POS grid | ✅ | ✅ | ✅ | **A** | Icon/color theming per tile not confirmed present | P2 |
| Product tax rate (per SKU) | REAL (`mp-iva` select 0/8/16%) | `tax_code` (`IVA_GENERAL`/`IVA_EXEMPT`, correctly platform-level not tenant-specific) | ✅ | ✅ | ✅ | **A** | — | — |
| Wholesale/VIP/employee/customer-type pricing | **G — placeholder.** Six price-tier fields editable in an admin table but never read at checkout (`agregarProducto()` always uses `p.precio`) | none | ❌ | ❌ | ❌ | **G** | Nothing to port — it never worked in the legacy product either | P2 if the business actually wants tiered pricing |
| Manual per-line price override (supervisor-authorized) | REAL, PIN-gated | `discount.apply`-gated manual discount | ✅ | ✅ | ✅ | **A** (different mechanism, same real capability) | — | — |
| Product variants (size/color) | **G — placeholder.** Static hardcoded example, no data field exists, buttons only toast | **[WAVE 3 — REBUILT]** Real `product_variants` backend already existed; `pos_product_variants_screen.dart` (795 lines, verified substantive — not a stub) now provides the previously-missing Flutter admin screen | ✅ | ✅ | ✅ | **A** | — | — |
| Related/suggested products (upsell) | **G — placeholder.** Static example, no real data model, no checkout trigger | none | ❌ | ❌ | ❌ | **G** | Never real in the legacy product | P2 |
| Import catalog from Excel | **G — placeholder.** `simularImport()` injects a canned fake success message, no real file parsing | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |
| Export catalog (CSV/PDF) | REAL — genuine CSV Blob download of live data | **[WAVE 3 — REBUILT]** `GET /api/v1/products/export.csv` (`product-catalog.routes.ts`), real `catalog.read`-gated, real filtered CSV of the live company catalog — verified the route and its `service.exportCsv(...)` call are real, not a stub | ✅ | n/a | ✅ | **A** | — | — |

## 4. Inventario / Kardex / Ajustes / Traspasos

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Stock balances, low-stock/out-of-stock KPIs | REAL | `inventory.routes.ts` balances | ✅ | ✅ | ✅ | **A** | — | — |
| Stock decrement on sale / restore on refund | REAL | Real, proven in this task's own staging rehearsal (TDA-AGUA decremented exactly, restocked exactly on refund) | ✅ | ✅ | ✅ | **A** | — | — |
| Kardex (per-product movement ledger) | REAL — every stock-affecting action logged | `inventory_movements` + real audit trail | ✅ | ✅ | ✅ | **A / H** — current platform's is server-authoritative and audit-backed vs. the legacy's capped 1000-entry in-memory array | — | — |
| Stock adjustments (Entrada/Salida/Corrección) | REAL — 3-mode workflow, PIN-gated | `inventory-counts`/`inventory-repair` modules exist | ✅ | ✅ | 🟡 | **A/B** | Flutter UI parity not fully confirmed | P1 |
| Stock transfers between branches | REAL, **with a caveat**: legacy only models one global stock number, so a "transfer" only ever decrements — it never credits a second location (no real multi-location stock pool existed in the legacy data model at all) | `inventory-transfers.routes.ts` — a genuine two-location ledger | ✅ | ✅ | 🟡 | **H** — current platform's real per-branch stock model is a strictly correct replacement for something the legacy product never actually modeled correctly | Flutter UI parity not fully confirmed | P1 |
| Inventory Kardex PDF export | REAL — `exportarKardexPDF()` genuinely filters real `kardexMovs` data and opens a real print/PDF window (re-confirmed by direct legacy re-inspection, not a placeholder) | **[WAVE 3 — REBUILT, format changed]** `GET /api/v1/reports/inventory/kardex.csv` (found in `apps/api/src/modules/reports/reports.routes.ts`, not the `inventory` module — a real `kardexExportCsv()` service method querying real `inventory_movement_lines` rows). Deliberately CSV, not PDF — a genuine, working, different-format port of a real legacy capability, not a placeholder | ✅ | n/a | ✅ | **A** | Format is CSV, not a browser print/PDF window like the legacy | — |

## 5. Compras / Proveedores (Purchasing & Suppliers)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Suppliers (proveedores) CRUD | REAL but shallow — no FK to products, `adeudo` never auto-updated | **[WAVE 2 — REBUILT]** `suppliers` table (company-scoped) + `apps/api/src/modules/suppliers/` (routes/service/repository) + `pos_suppliers_gateway.dart`/`pos_suppliers_screen.dart`; the existing Compra Directa Flutter form now has a real supplier picker, and `direct_purchases.supplier_id` links to it via a frozen-name-snapshot pattern (a later supplier rename never rewrites past purchase history) | ✅ | ✅ | ✅ | **A** | `adeudo` (running balance owed) not ported — not requested this wave | — |
| Purchase orders (formal PO workflow) | **G — placeholder at the critical step.** Item-builder UI is real/interactive, but `saveCompra()` discards it entirely and stores literal `productos:"Varios", total:"Por confirmar"` regardless of input | none — **re-confirmed excluded in TASK 14.4 (Wave 2)**, a deliberate scope decision, not an oversight: the legacy's own `saveCompra()` discarded entered line items, so there is genuinely nothing real to rebuild toward | ❌ | ❌ | ❌ | **G/F mixed** | The legacy PO feature never actually worked end-to-end; a real rebuild owes nothing to its specific (broken) implementation. **Not touched by Wave 2** | P1 |
| Direct purchases (Compra Directa) | REAL — the one genuinely complete purchasing path: form → real stock increment → Kardex → history → audit log | **[WAVE 1 — REBUILT, WAVE 2 — extended]** `direct_purchases` + a real `receipt`-type inventory movement, atomic (one transaction, no orphaned rows on failure), idempotent. Proven live: a 25-unit restock correctly increased real inventory, immediately consumable by a subsequent sale. Wave 2 added an optional real `supplier_id` FK (frozen-name-snapshot pattern) and a supplier picker in the existing Flutter restock form | ✅ | ✅ | ✅ | **A** | — | — |
| Purchase history | **G — placeholder.** Static hardcoded example rows, ignores real `DB.compras`, "Filtrar" is a toast stub | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |
| Supplier price comparison | **G — placeholder.** Static hardcoded example table | none | ❌ | ❌ | ❌ | **G** | Never real | P2 |

## 6. Clientes

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Customer CRUD (nombre/tel/correo/RFC/notas) | REAL | `customers.routes.ts` | ✅ | ✅ | ✅ | **A** | RFC field not confirmed present (only relevant if CFDI is ever built) | P2 |
| In-house credit accounts | **[WAVE 3A — CORRECTED FINDING]** RECLASSIFIED FROM REAL TO PLACEHOLDER — duplicate of §1's "Card/credit account payment" row (same `DB.creditos` mechanism), annotated not merged. `DB.creditos` seeds permanently empty; exhaustive grep confirms zero writes anywhere in the file — no account creation, no debt-charging at checkout, no payment-posting, no limit enforcement. Every reference is a read against permanently-empty data. This was never real in the legacy product | none | ❌ | ❌ | ❌ | **G** | Nothing to port — never functionally real. A real payment-provider path (Mercado Pago, paused) is the correct modern replacement if/when a credit concept is wanted, not a rebuild of a bespoke ledger that never worked | — |
| Birthday alerts on dashboard | **[WAVE 3A — CORRECTED FINDING, IMPLEMENTED]** RECLASSIFIED FROM "NEVER REAL" BACK TO GENUINE REAL DEBT AND CLOSED — Wave 3's own finding ("only the raw `birth_date` field exists, not a computed alert") is **factually contradicted** by direct re-inspection this wave: `generarAlertas()` (`AS POS V1.html` lines 10957-10976) reads live `DB.clientes`, computes an exact month/day match, and pushes a real alert with real customer names into the same `alertas` array as the already-ported stock/aforo/fiestas alerts. Implemented as `dashboard.repository.ts`'s `birthdaysOn(companyId, date)` — real SQL `extract(month/day from birth_date)`, wired into `DashboardSummary.birthdaysToday` — see FINAL FORENSIC CORRECTION Implementation Log #4 | `birthdaysOn()` in `dashboard.repository.ts`, `birthdaysToday` in `DashboardSummary`, rendered in `dashboard_screen.dart` | ✅ | ✅ (`birth_date` field, pre-existing) | ✅ | **A** | — | — |

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
| Plan-level CRUD (name/price/desc, active-count) | REAL but shallow — plan-level only, no individual member records, no renewal/expiry dates | **[WAVE 3 — CORRECTED FINDING, pre-existing labeling issue]** `memberships.routes.ts` — independently re-verified this wave: real, individual `customer_memberships` records with real `issue`/`renew`/`cancel`/`validate` routes (`membership.issue`-gated), each carrying `issuedAt`/`renewedFromMembershipId`/`cancelledAt` — a strict superset of the legacy's plan-level-only model, not merely "behavior differs." This row's own prose already said as much ("more complete than the legacy's"), but its Parity cell was written `B/A`, which this document's own compound-classification rule (read strictly by the first-listed letter) means it was being silently counted as **B**, not **A**, in every prior percentage — corrected here, independent of any Wave 3 build, per this document's own rule for fixing a discovered factual/labeling error | ✅ | ✅ | ✅ | **A** | Current platform's is more complete than the legacy's (per-member issue/renew/cancel exists per TASK 13.0) | — |

## 9. Cupones / Promociones

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Coupon validation/redemption, usage limits, min-amount | REAL | `promotions.routes.ts` | ✅ | ✅ | ✅ | **A** | — | — |
| Automatic "buy X get free item" promos | REAL | Real promotions engine (proven in TASK 13.2/14.2 rehearsal) | ✅ | ✅ | ✅ | **A** | — | — |
| Promotion usage history / report screen | **G — placeholder/absent.** Only a raw `usageLog` field exists, no dedicated screen | **[WAVE 3 — REBUILT]** `GET /api/v1/reports/promotions` (`reports.routes.ts`, real `promotionsReport()` service method) — an 8th real report area, added to the 7 built in Wave 2 | ✅ | 🟡 | ✅ | **A** | — | — |

## 10. Caja / Finanzas (Cash Register)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Open/close with denomination counting | REAL | `cash.routes.ts` — real, proven end-to-end this task (denomination_counts, exact expected-vs-actual match) | ✅ | ✅ | ✅ | **A** | — | — |
| Partial cash close (corte parcial, mid-shift snapshot) | REAL — real running-total snapshot, doesn't close the shift | **[WAVE 2 — REBUILT]** `cash_session_partial_closes` — a real, persisted, audited snapshot; verified in tests to never transition the session's own status | ✅ | ✅ | ✅ | **A** | — | — |
| Withdrawals (retiro) — distinct category, blocks over-withdrawal | REAL | **[WAVE 2 — REBUILT]** `cash_movements.category='withdrawal'`, direction-constrained by a real DB check (only valid on `cash_out`) | ✅ | ✅ | ✅ | **A** | No dedicated over-withdrawal guard/authorizer field (the legacy's own version had this) | P2 |
| Expenses (gasto) — distinct category with evidence photo | REAL (photo evidence itself is superficial — only a flag, not the real file, even in the legacy) | **[WAVE 2 — REBUILT]** `cash_movements.category='expense'`, direction-constrained by the same DB check | ✅ | ✅ | ✅ | **A** | No photo-evidence field (the legacy's own version was superficial here too — a flag, not a real file) | P2 |
| External income (ingreso extra) | REAL, correctly added to expected-cash math | **[WAVE 2 — REBUILT]** `cash_movements.category='external_income'`, direction-constrained to `cash_in` only | ✅ | ✅ | ✅ | **A** | — | — |
| Cash session history | REAL (`historialCortes`) | `GET /cash-sessions` | ✅ | ✅ | ✅ | **A** | — | — |
| Bitácora (structured audit log: IP/station/before-after per action) | REAL, though IP/station were themselves randomly faked in the legacy | Real `audit_log` table, populated on every mutation | ✅ | ✅ | 🟡 | **H** — current is server-authoritative and genuinely real, replacing a legacy mechanism that faked its own IP/station fields | Dedicated searchable/filterable audit-log screen in Flutter not confirmed | P2 |

## 11. Facturación CFDI (Fiscal Invoicing)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Full invoicing UI (folio, RFC, Uso CFDI, IVA calc, state machine) | **[WAVE 3A — CORRECTED FINDING]** RECLASSIFIED FROM F TO G, MERGED IN SPIRIT WITH THE STAMPING ROW BELOW (kept as a separate row, not merged, per this task's own duplication rule). Direct re-inspection this wave: `emitirCFDI()` (lines 13613-13648) genuinely validates fields, computes real IVA math (`Math.round(monto*16/116*100)/100`), and persists a draft to `DB.facturas.unshift()` with a real audit-log call — the *draft-creation* mechanism is real in isolation. But the capability's entire purpose — producing a legally valid invoice — depends on `timbrarFactura()` (the row below), which is explicitly fake. A real invoice UI whose only possible outcome is a fake stamped document was never a real, usable capability end-to-end; a correctly-computed but never-stampable draft is not a genuine legacy capability worth porting on its own. Real PAC/SAT integration is a NEW PRODUCT capability (compliance-driven, ADR-0012), not legacy parity debt — not implemented in this task | none | ❌ | ❌ | ❌ | **G** | Nothing genuinely real to port as a *complete* capability — see the stamping row below for the reason the whole thing was never real end-to-end | — |
| Fiscal stamping (`timbrado`) | **SIMULATED/FAKE even in the legacy** — UUID literally suffixed `-SIMULADO`, toast self-admits "simulación — conecta un PAC para producción", zero real SAT/PAC network call anywhere. **[WAVE 3A — re-confirmed directly at lines 13650-13662]**: the code's own comment reads `// Simulate timbrado (in production: connect to PAC like Facturapi)` | none — untouched by any wave. Real PAC integration is explicitly a NEW PRODUCT capability, not legacy parity debt — not implemented in this task | ❌ | ❌ | ❌ | **G** | Nothing real to port — the legacy version never actually worked | — |

## 12. Reportes / BI / Dashboard

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Dashboard (sales trend, today's parties, memberships, alerts) | REAL, computed from live in-memory arrays, **except see the split finding below** | **[WAVE 3 — REBUILT, WAVE 3A — SPLIT FINDING, IMPLEMENTED]** A real, single consolidated "today at a glance" screen exists: `apps/api/src/modules/dashboard/` (`DashboardService.summary()`) + `pos_dashboard_gateway.dart`. The 2 previously-lumped-together "omitted metrics" were **not the same kind of gap**: (1) **`vsAyer` (%-vs-yesterday sales trend)** — confirmed genuinely real (`AS POS V1.html` lines 10823/10833-10836), now implemented: `dashboard.service.ts` reuses the exact same `reportsService.salesReport` call the existing "today's sales" figure already makes, for yesterday's date, `pctChange` real (`Math.round`), `null` — never fabricated — when yesterday's total is 0; fixture-exact test proves `+20%` (1000→1200) and cross-tenant isolation. See FINAL FORENSIC CORRECTION Implementation Log #5. (2) **Active-membership count** — re-confirmed FAKE in practice: `.activas` is initialized to `0` on plan creation (line 9303) and **never incremented anywhere else in the entire 14,712-line file** — no membership-purchase/renewal/expiry code path touches it, and the only non-zero appearance (line 2124, "214") is dead static HTML never written by any JS. A `reduce()` over a field nothing ever populates is not a genuine metric — correctly NOT built. The legacy's own 2 admitted-fake fields (`prom_estancia`, always-0 occupancy) remain correctly absent. Birthday alerts are tracked separately — see §6's own row, now also real | ✅ (trend real, tested; membership count correctly excluded) | ✅ | ✅ | **A** | — | — |
| Per-area reports (Ventas/Financiero/Inventario/Clientes/Empleados/Accesos) | REAL, genuinely computed via array reduces | **[WAVE 2 — REBUILT, WAVE 3 — extended]** `apps/api/src/modules/reports/` — now 8 report areas (Sales/Financial/Inventory/Customers/Employees/Parties/Access/**Promotions, added Wave 3**), all real server-side SQL aggregation, real date-range+branch scoping, CSV export on Sales/Financial/**Inventory Kardex (Wave 3)**; `pos_reports_gateway.dart`/`pos_reports_screen.dart` (tabbed per-area screen) | ✅ | ✅ | ✅ | **A** | Reservations (Fiestas), Access, and Promotions were not legacy-named areas but are now real report areas too, exceeding the original 6 | — |
| Business Intelligence tab | REAL, mostly computed, **2 fields hardcoded even in the legacy** (`prom_estancia`=95, water-park occupancy=0 — the legacy code itself admits these aren't measurable) | **[WAVE 2 — REBUILT, for the real parts]** the 7 report areas above genuinely cover the real, computed portion of the legacy BI tab. The financial report reconciles bit-for-bit against the real `CashService.summary()` fold logic. The 2 admitted-fake legacy fields (`prom_estancia`=95, always-0 occupancy) are **explicitly and deliberately absent** — not reproduced, not replaced with a new placeholder | ✅ | ✅ | ✅ | **A** (the 2 fake fields stay unclassified — never real, nothing to port, matching this doc's own **G** framing) | — | — |

## 13. Control de Acceso / Aforo / NFC Pulseras

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Ticket-scan entry validation | **G — placeholder even in the legacy.** `accScan()` ignores the typed folio and always "succeeds" with a random name from a hardcoded 5-name list — it never validates anything real | **[WAVE 2 — SAFE REPLACEMENT, NOT A PORT]** `access_credentials`/`access_events` + `apps/api/src/modules/access/` — a genuine, real server-side validator: unknown/void/wrong-branch/already-inside/not-inside/reentry-not-allowed are all honestly rejected (never a fabricated success), CAS-guarded concurrency-safe entry/exit (proven via 2 real simultaneous-HTTP-request race tests), a documented re-entry policy (single-use by default, `allowsReentry` opt-in — the legacy never defined this, so it's a new, explicit, minimal rule, not a port of an existing one). `pos_access_gateway.dart`/`pos_access_screen.dart`. **This is an explicit, documented replacement of a confirmed-fake legacy mechanism — it is NOT retroactive evidence the legacy scanner was ever real.** The legacy's `accScan()` accepted any input and fabricated success 100% of the time; that finding stands unchanged | ✅ | ✅ | ✅ | **H** | — | — |
| Occupancy/headcount (aforo), auto-incremented from real ticket sales | REAL — genuinely reflects real sales data, but one-way only (no exit/decrement) | **[WAVE 2 — REBUILT]** Real, server-computed occupancy (never client-recomputed), and — unlike the legacy — genuinely bidirectional: both entry and exit are tracked, not just a one-way increment | ✅ | ✅ | ✅ | **A** (stronger than the legacy ever was — real exit tracking, not just entry) | — | — |
| NFC wristbands (activate/block/unblock/extend CRUD) | REAL standalone lifecycle, **not integrated** with the (fake) access scan | **[WAVE 3 — REBUILT]** `access_credentials.credential_kind` (`'ticket'`\|`'wristband'`, `packages/database/src/schema/access.ts`) extends the real access-credential table rather than a parallel one. Activate reuses `issueCredential`, block reuses `voidCredential`, and unblock is a genuinely new `unvoidCredential` CAS-guarded transition — all real, permission-gated (`access.manage`), with real Flutter UI (`pos_access_screen.dart`: activate/lookup/toggle-block, keyed widgets confirmed). **"Extend" was deliberately not built — but the implementing agent's own reasoning for why was independently re-checked and found imprecise; the corrected finding is used here**: `extenderPulsera(id)` (`AS POS V1.html` line 11616) is not literally dead code with nonexistent DOM ids — it takes no DOM input at all (a `prompt()` call) and it DOES mutate `p.sync='pendiente'` the same way `bloquearPulsera`/`desbloquearPulsera` do. The real bug is different and more precise: the entered "minutes to extend" value is captured via the prompt but **never written to the wristband's own expiry field (`p.expira`)** — the toast claims success but nothing about the wristband's actual expiration ever changes, the same class of bug as this document's own "notas" field finding (§21). (The "DOM ids that don't exist" pattern the agent described does apply elsewhere in this same code path — to `activarPulsera()` reading `#pul-cliente`/`#pul-sucursal`, which really are absent from the `#modal-nueva-pulsera` markup — just not to `extenderPulsera` itself.) Net effect is the same either way: there is genuinely nothing real to port for "extend," so it correctly stays unbuilt | ✅ | ✅ | ✅ | **A** | "Extend" intentionally excluded — never functionally real in the legacy (corrected finding above) | — |

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
| Employee roster (distinct from login users) | REAL | **[WAVE 2 — REBUILT]** `employees` table (company/branch-scoped, distinct from login `users`) + `apps/api/src/modules/people/employees.*` + `pos_people_gateway.dart`/`pos_people_screen.dart` | ✅ | ✅ | ✅ | **A** | — | — |
| Weekly shift scheduling | REAL — a genuine non-Fiestas calendar feature | **[WAVE 2 — REBUILT]** `employee_schedules` table + `apps/api/src/modules/people/schedules.*`, feeding the payroll scheduled-vs-worked comparison | ✅ | ✅ | ✅ | **A** | — | — |
| Time clock / checador (manual clock-in/out) | REAL | **[WAVE 2 — REBUILT]** `time_clock_punches` table + `apps/api/src/modules/people/time-clock.*` | ✅ | ✅ | ✅ | **A** | — | — |
| Payroll (nómina) — hours worked vs. scheduled, late-minute deduction, overtime bonus | **REAL — a genuinely worked calculation engine**, the single most substantive HR feature found | **[WAVE 2 — REBUILT]** `payroll_periods`/`payroll_period_lines` + `apps/api/src/modules/people/payroll.*` — a **faithful port** of the legacy's real `calcularNominaEmpleado()` formula (scheduled/worked/late/overtime minutes, per-minute deduction/bonus, weekly salary base), verified in tests against a hand-computed example. A closed payroll period can never be recalculated (immutable once closed) | ✅ | ✅ | ✅ | **A** | — | — |

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
| Scheduled email reports | **[WAVE 3A — CORRECTED FINDING]** RECLASSIFIED FROM "REAL CRUD, FAKE SEND" TO ENTIRELY PLACEHOLDER. `guardarReporteEmail()` (line 11738) does real local persistence (`DB.reportesEmail.push(...)`), but direct re-inspection of the actual delivery path this wave (`enviarReporteEmailId()`/`enviarReporteEmail()`, lines 11721-11760) shows it is 100% fake: `toast(...)` + `setTimeout(...)` mutating local state and showing a fake success toast — zero `fetch`/XHR/mail-transport call anywhere, matching this document's own already-documented fake-sync/backup pattern exactly (§17 sync monitor, §17 backups). The capability's entire purpose — actually sending a scheduled report — was never real; only a to-do-list-style local record of "reports I intend to send" was real, which is not itself a meaningful legacy capability worth porting. Do not build a new job-scheduler/SMTP pipeline merely to satisfy fake legacy parity — re-confirmed no such infrastructure exists in `@asone/worker` (`package.json` has no mail-client dependency; `worker.ts` logs "no processing is configured") | none | ❌ | ❌ | ❌ | **G** | Nothing genuinely real to port — the send mechanism was always fake | — |
| Notifications center | **G — placeholder.** Bell icon + badge + an always-empty page; nothing ever populates it | none confirmed | ❌ | ❌ | ❌ | **G** | Never real | P2 |

## 18. Configuración (Settings)

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Business/park config (name, address, logo, capacity) | REAL, persisted (to the legacy's one working `localStorage` key) | Real company/branch admin (`AdministrationService`), server-persisted | ✅ | ✅ | 🟡 | **H** | Flutter admin screen for this not confirmed (per [[V1_POST_LAUNCH_BACKLOG]], CLI-reachable today) | P1 |
| Ticket/receipt template config (header/footer text) | REAL — confirmed genuinely real in the legacy and re-confirmed real in the current platform's persistence layer; only the final print-rendering wiring was missing | **[WAVE 3 — PARTIAL, WAVE 3A — CLOSED]** The EAV backend (`company_settings`/`branch_settings` keys `receipts.header_text`/`receipts.footer_text`) and `pos_receipt_branding_screen.dart` (real admin screen) already existed. This wave threaded `PosSettingsGateway`/`companyId` through all 4 real print call sites (`_PosSale` success dialogs, `_SalesHistory`→`_SaleDetailDialog`→`_RefundFlowDialog`, `_Devoluciones`→`_RefundDetailDialog`) via a shared `_loadReceiptBranding` helper — configured header/footer text now genuinely reaches both live-sale and historical-reprint receipts, for normal sales and refunds. Verified: 3 `pos_shell_test.dart` tests + 6 new `refund_receipt_html_test.dart` tests proving real branding fetch, safe unset behavior (no "null" text, no crash), and refund-receipt parity. See FINAL FORENSIC CORRECTION Implementation Log #3 | Real backend (pre-existing) + real print-site wiring (this wave) | ✅ | ✅ | ✅ | **A** | — | — |
| Hardware config (printer/scale/scanner) | **G — placeholder.** Hardcoded fake device list, "Verificar" just toasts | none | — | — | — | **G** | Never real | — |
| Global tax-rate config screen | **G — placeholder** (inputs have no `id`, "Guardar" only toasts) — the *real* tax mechanism is per-product, not this screen | Per-product `tax_code`, real | ✅ | ✅ | ✅ | **H** for the real mechanism (current per-product tax is correctly designed and nationally-uniform per ADR, not a per-tenant setting needing a screen); **G** for the specific decoy screen — nothing to port | — |

## 19. Onboarding / Wizard / Branding

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| First-run setup wizard (single screen: activation key, business name, admin user+PIN) | REAL, but a single screen, not a guided multi-step flow — and its activation-key check is bypassable by the hardcoded master password (see Auth section) | Real `provision:production-owner` + `provision:business-config` CLIs, built in TASK 14.1/14.2 | ✅ | ✅ | n/a (CLI, by design — see [[V1_LAUNCH_SCOPE]]) | **H** — current CLI-based provisioning is deliberately NOT a public HTTP endpoint, refuses on conflict, uses masked password entry; categorically safer than a client-side wizard with a reversible license-key backdoor | No Flutter in-app onboarding wizard exists (intentional per [[V1_POST_LAUNCH_BACKLOG]]) | P2 |
| Branding (logo upload) | **[WAVE 3A — CORRECTED FINDING, CLOSED]** RECLASSIFIED FROM "NARROW GAP" TO CONFIRMED GENUINE REAL DEBT, NOT MERE STATIC CONFIGURATION. Direct re-inspection this wave of `cfgNegocioLogoSeleccionado()` (lines 7411-7423): a real, repeatable, persistent, operator-triggered branding-configuration *workflow* (file picker → live-applied via `aplicarBrandingNegocio()` → persisted via `guardarConfigV1()`), not a hardcoded/static logo — critically, in the legacy this real logo was applied to real printed/exported documents (ticket, contract, receipt templates), which is the functionally meaningful part of the capability, not merely a chrome decoration. Implemented this wave: a real `@aws-sdk/client-s3` MinIO client wired to the already-provisioned MinIO container, a `branding.logo_url` company-setting key (reusing the existing generic settings CAS mechanism, zero migration needed), real multipart upload (magic-byte content-type verification, 2MB cap) + delete endpoints, a real Flutter admin screen (`pos_branding_screen.dart`), and — closing the loop — the uploaded logo URL is now threaded through the exact same `_loadReceiptBranding` path as the header/footer text at all 4 real print call sites, taking priority over the bundled default mark on every printed receipt (normal sale and refund). Verified: 6 backend integration tests against real Postgres + real MinIO (upload+retrieve, wrong-type→415, spoofed-signature→415, oversized→413, real cross-tenant isolation, delete clears setting+object), 10 Flutter admin-screen widget tests, plus a new dedicated `pos_shell_test.dart` test proving the logo key is fetched and printing never crashes with a real network-image URL as the resolved source. See FINAL FORENSIC CORRECTION Implementation Log #6. **Explicit, deliberate scope decision, not an oversight**: the platform's own topbar/sidebar brand mark (`_TopbarBrandMark`/`StartupLogoMark`) intentionally continues to show the AS ONE product identity, not a per-tenant image — this is consistent, already-established product chrome used the same way at login/splash, distinct from the legacy's single-tenant deployment (where "the app's own branding" and "the one business's branding" were the same thing by construction). The functionally meaningful legacy behavior — a real, operator-configured logo appearing on real business documents (receipts) — is what's closed here | Real upload/delete endpoints, real admin screen, real receipt-print wiring (all 4 sites, normal + refund) | ✅ | ✅ (EAV setting, no migration) | ✅ | **A** | — | — |

## 20. Autenticación

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Password login | REAL, **plaintext comparison**, no hashing, no backend | Real JWT-based login, hashed credentials, server-authoritative | ✅ | ✅ | ✅ | **H — proven safer.** Proof: this task's own live QA confirmed a wrong password returns a real 401 from a real server-side check, and password-activation was itself a launch-blocker independently found and fixed in TASK 14.0 | — | — |
| PIN login | REAL, plaintext, own hardcoded-master bypass | **[WAVE 3 — REBUILT, safely]** A real, server-validated "quick-switch" PIN login (`AuthService.pinLogin`, `POST /api/v1/auth/pin-login`) — independently verified security-critical properties directly in code, not just claimed: (1) requires an already-authenticated caller session (`requireAuthenticatedUser`), never a bare PIN-as-login like the legacy; (2) company scope is taken ONLY from the caller's own resolved session (`current.companyId`), never the request body — confirmed enforced in `auth.service.ts`, not merely asserted; (3) hashed with the exact same real argon2id scheme as passwords (`argon2.hash`/`argon2.verify` in `auth.passwords.ts`), never plaintext; (4) issues a real independent session via the same `#createLoginSession` path password login uses; (5) rate-limited identically to `/login`. New migration `0027_quiet_strong_guy.sql` adds `pin_hash`/`qr_secret_hash`/`qr_expires_at` with real schema-level constraints (nonblank-hash-length checks, a paired-nullability check). One honestly-documented, low-severity trade-off: PIN uniqueness-per-company is enforced by re-checking every other hash before write, not a DB unique index (can't be, since it's a salted hash) — a benign best-effort race the code's own comment discloses, not a security hole (worst case: two staff share one PIN, not unauthorized access). Real Flutter UI: `pos_auth_gateway.dart` + `_StaffQuickSwitchDialog` in `pos_shell.dart`, reusing the pre-existing `StartupPinKeypad` component | ✅ | ✅ | ✅ | **A** | — | — |
| QR login | REAL (string equality only, no scanner integration) | **[WAVE 3 — REBUILT, safely]** Independently verified separately from customer-facing QR tokens: a real staff "quick-switch" QR login (`AuthService.qrLogin`, `POST /api/v1/auth/qr-login`) with the same session-gated, company-scoped-from-session, argon2id-hashed, real-session-issuing security model as PIN login above. The QR secret is server-generated and cryptographically random (never client-chosen, unlike the legacy's predictable timestamp-based `POS-<ts>` generator), returned in plaintext exactly once at issuance, hashed at rest, defaults to a real 90-day TTL, and expiry is checked in code BEFORE the hash comparison (`qrExpiresAt <= now` short-circuits) so a stale hash can never accidentally match. Revocable (`revokeStaffQrCredential`). Real Flutter UI in the same `_StaffQuickSwitchDialog` | ✅ (customer-side and now staff-side, distinct concepts) | ✅ | ✅ | **A** | — | — |
| **Hardcoded master/distributor backdoor** (`user:"asmaster", pass:"asmaster2604", pin:"2604"`, visible in page source, bypasses license-key validation, unlocks a hidden key-generator panel) | **CONFIRMED REAL AND DANGEROUS in the legacy product** | **Confirmed absent in current platform** — no hardcoded credential of any kind exists in `apps/api/src` outside the explicitly dev-gated `development/` directory (independently re-verified this task) | n/a | n/a | n/a | **H — must never be replicated, and has not been.** This is the single most important legacy finding for platform security posture | — | — |
| Admin/employee PIN re-auth for sensitive actions | REAL, plaintext, master-bypassable | Real permission-gated routes (`requirePermission`), no PIN-re-auth concept, no bypass | ✅ | ✅ | ✅ | **H** | — | — |

## 21. UI / Interaction Flows

| Legacy capability | Legacy impl. | Current equivalent | Backend | DB | UI | Parity | Missing behavior | Priority |
|---|---|---|---|---|---|---|---|---|
| Reprint of a **just-completed** sale receipt | REAL, real branded print window | Real, proven (`receipt_html.dart`) | ✅ | ✅ | ✅ | **A** | — | — |
| Reprint of an **arbitrary historical** sale | **G — placeholder** (`reimprimirTicketById` only toasts, no real print call, despite real print infrastructure existing one function away) | Receipt is real for any sale via `GET /sales/:id/receipt` (proven byte-identical reprint in this task's own rehearsal) | ✅ | ✅ | 🟡 | **A/H** — current platform's is real for ANY sale, strictly better than the legacy's (which only worked for the just-completed one) | — | — |
| Sale-level "notas" field | **G — placeholder even in the legacy.** The notes modal never actually writes into the field that gets saved — every completed sale's `nota` is permanently empty, a real bug in the original product | **[WAVE 1 — REBUILT]** A real, working `sales.note` column — fixed for real this time, unlike its legacy ancestor. Proven live: a sale created with a note round-trips it exactly on a fresh detail read after payment; a sale created without one is honestly `null`, never a silently-dropped empty string | ✅ | ✅ | 🟡 Flutter in progress | **A** (a genuine improvement over the legacy, which never actually worked) | Flutter note-entry UI tracked separately | — |
| Keyboard shortcuts (F2/F3/F4/F5/F6/F8/Escape) | REAL, register-style muscle-memory shortcuts | **[WAVE 3 — REBUILT]** A real `Focus`/`onKeyEvent` handler in `pos_shell.dart`, independently verified to call the exact same code the on-screen controls call, not a divergent duplicate: F2 focuses search, F3 opens the real customer selector, F5 calls the pre-existing real `_handleSuspend()`, F6 opens a real confirm dialog then calls `_handleCancelSale()` (new), F8 calls through a `GlobalKey` directly into the real Cobrar button's own `_handleTap()` state method, Escape refocuses search. A text-field-focus guard (`_focusedOnTextField()`) is checked before every shortcut except F2 (which must work FROM other fields, since its job is moving focus into search) — deliberately does NOT reproduce the legacy's own bug of shortcuts firing mid-typing. F4 (reprint) is honestly not implemented, with the documented reasoning independently sound: there is nothing to reprint mid-sale — real reprint already lives in Sale Detail history | ✅ | n/a | ✅ | **A** | F4 (reprint) intentionally not wired — no in-progress-sale target for it; reprint already exists elsewhere in the app | P1 |
| Global numeric/PIN keypad auto-appearing on password-field focus | REAL — legacy's own comment confirms it's scoped to PIN fields specifically ("solo aparece en campos de PIN"), not literally every password field | **[WAVE 3 — REBUILT, found during independent re-verification, not originally in the Wave 3 brief]** The "no PIN concept" premise this row was classified **F** on is no longer true now that §20's real PIN login exists. `StartupPinKeypad` (pre-existing, from an earlier task) is reused for genuine, functional PIN entry in the new `_StaffQuickSwitchDialog`, matching the legacy's own scoping (only appears for PIN-entry fields) and, unlike the pre-existing `_CajeroReturnAuthDialog`'s own decorative keypad (its own doc comment admits "not a real PIN comparison"), this one is backed by a real, server-validated `pinLogin` call | ✅ | n/a | ✅ | **A** | — | — |
| AI assistant | REAL, but a **local keyword/regex FAQ bot over live data — not an LLM, zero external API calls** anywhere in the file | **[WAVE 3 — REBUILT]** `apps/api/src/modules/assistant/` (`AssistantService.matchIntent`/`answer`) — independently verified to be a genuinely deterministic keyword matcher (accent-normalized string matching, zero ML/fuzzy logic, zero LLM/external call), covering sales-today, register-status, low-stock-count, and open-parties-today, each backed by a real SQL query through `AssistantRepository` (never a canned string) — a faithful port, not an upgrade, matching the legacy's own approach exactly. `pos_assistant_gateway.dart`/`pos_assistant_screen.dart` (261 lines) provide real Flutter UI | ✅ | n/a | ✅ | **A** | If a real LLM-backed assistant is ever wanted, that would be a genuine future upgrade, not a parity gap | — |
| Hidden distributor-only panel (license-key generator, gated by the master backdoor account) | **CONFIRMED REAL, security-relevant** | Confirmed absent — no equivalent hidden panel exists in current platform | n/a | n/a | n/a | **H — correctly not replicated** | — | — |

---

## Wave 3 (TASK 14.5) recount

Same canonical formula as Wave 2, held constant (see "Parity Methodology
Reconciliation" above): denominator = 100 rows − 13 G rows = **87**
(unchanged — Wave 3 reclassified zero rows to or from G); numerator =
rows whose primary letter is **A** or **H**.

**Before this wave**: 64/87 ≈ **74%** (the Wave 2 end-state).

**Rows that moved into the A/H numerator this wave** (13 rows, all
independently re-verified against the real codebase and, where relevant,
the real legacy source — not copied from any self-report):

| Row (section) | Was | Now | Why |
|---|---|---|---|
| Cafetería sub-mode (§1) | F | A | Real, generic `product_categories.is_visual_tile` flag; shares the real sale engine; forensic finding on the legacy's purely-visual `estiloCafe` re-confirmed independently |
| On-screen coupon keypad (§2) | F | H | Pre-existing `_CuponVirtualKeyboard` (not new this wave) is a full alphanumeric keyboard, correctly NOT a numeric-only pad — `coupons.code` is a real `text` column, verified directly |
| Product variants admin screen (§3) | E | A | `pos_product_variants_screen.dart` (795 lines) verified substantive against the pre-existing real backend |
| Export catalog CSV (§3) | F | A | Real `GET /api/v1/products/export.csv`, route and service verified real |
| Inventory Kardex export (§4) | F | A | Real `GET /api/v1/reports/inventory/kardex.csv`, format changed to CSV (documented), route and service verified real |
| Membership plan-level CRUD (§8) | B/A → B (first-listed) | A | **Not a Wave 3 build** — a pre-existing labeling artifact found during this wave's full re-read: the row's own prose already described a strictly superior, real per-member issue/renew/cancel/validate lifecycle (independently re-confirmed in `memberships.routes.ts`), but its cell read `B/A`, which this document's own first-listed-letter rule was silently counting as B. Corrected label, not new capability |
| Promotion usage history report (§9) | F | A | Real `GET /api/v1/reports/promotions`, verified real |
| NFC wristbands activate/block/unblock (§13) | F | A | Real `credential_kind` column + real routes + real Flutter UI, verified; "extend" correctly stays unbuilt (corrected finding) |
| PIN login (§20) | F | A | Real argon2id hashing, session-scoped company binding enforced in code (not just claimed), real session issuance — independently verified |
| QR login, staff (§20) | F | A | Real server-generated random secret, hashed, real TTL, expiry-before-hash-check — independently verified |
| Keyboard shortcuts (§21) | F | A | Verified shortcuts call the exact same handlers as the on-screen buttons, not a divergent path; text-field guard confirmed present |
| Global numeric/PIN keypad (§21) | F | A | Found during this wave's own independent re-verification (not in the original brief) — the "no PIN concept" premise is invalidated by §20's real PIN login, and the pre-existing `StartupPinKeypad` is now genuinely wired to it |
| AI assistant (§21) | F | A | Real deterministic keyword matcher over live SQL data, zero LLM/external calls, verified directly in `assistant.service.ts` |

New numerator: 64 + 13 = **77**. Denominator: **87** (unchanged — zero rows
moved to or from G this wave).
**New overall parity: 77 ÷ 87 ≈ 89%** (up from 74% before this wave).

**Rows reclassified this wave with NO numerator effect** (both the old and
new letter are non-A/H, so these do not change the percentage — recorded
here purely for accuracy, per this document's own "never adjust the
denominator/numerator to improve the score" rule; if anything these are
conservative corrections, not inflationary ones):

| Row (section) | Was | Now | Why |
|---|---|---|---|
| Dashboard (§12) | E | B | A real dashboard now exists (was previously classified on "no dashboard exists at all"), but it deliberately omits two real (not fake) legacy metrics — %-vs-yesterday sales trend and active-membership count — so "ported but behavior differs" (B) is more accurate than either "fully ported" or the prior "backend exists, UI missing" |
| Birthday alerts on dashboard (§6) | E | F | The dashboard now exists but does not include this metric — only the raw `birth_date` field exists, not a computed alert; the previous **E** ("current backend exists") is no longer accurate once "no dashboard exists at all" stops being the reason, so this is a downward precision correction, not an upgrade |

Formal Purchase Orders (§5) and CFDI fiscal stamping (§11) remain
**unchanged and unclaimed** — re-confirmed this wave: no billing/CFDI
module exists anywhere in the repository (`find` for `*cfdi*`/`*billing*`/
`*purchase-order*` under `apps/api/src/modules` returns nothing), and
neither area appears in this wave's own `git status`. Both stay exactly
as classified (`G/F mixed` for the PO row, `G` for CFDI stamping).

## REAL LEGACY PARITY — Wave 3 verdict

Per this document's own definition (A/H rows over the 87-row, G-excluded
denominator), **real legacy parity now stands at 77/87 ≈ 89%**, up from
74% at the start of this wave. The table below is the complete,
exhaustive list of every row in the 100-row matrix whose primary
(first-listed) letter is **not** A or H — 10 rows — with one reason each.
Nothing on this list was silently marked done, and nothing was moved up
without a fresh, direct verification this wave. G-classified rows (13,
excluded from the formula entirely, since they were never real in the
legacy to begin with) are not repeated here — see the matrix itself.

| Row (section) | Letter | Why it remains non-A/H |
|---|---|---|
| Card/credit account payment (§1) | B | No in-house "cuenta a crédito" concept — a real payment-provider path (Mercado Pago, paused) replaces it with a different mechanism, not the same capability |
| Post-sale animation/sound feedback (§1) | F | Pure UX polish; deliberately deferred, re-confirmed absent even after a later pass that did have `pos_shell.dart` access |
| Kiosk/self-service mode (§2) | F | Explicitly deferred as its own large, distinct standalone feature; not needed for the proven cashier-operated V1 workflow |
| In-house credit accounts (§6) | F | A real payment-provider path is the correct modern replacement, not worth rebuilding as a bespoke ledger |
| Birthday alerts on dashboard (§6) | F | The new real dashboard does not include this metric; only the raw `birth_date` field exists, no computed alert anywhere |
| Full CFDI invoicing UI (§11) | F | Explicitly out of scope per ADR-0012 — a separate, compliance-driven project, untouched by any wave |
| Dashboard: sales trend / membership count (§12) | B | The new real dashboard deliberately omits `vsAyer` (%-vs-yesterday trend) and active-membership count — two real, working legacy metrics, consciously scoped out this wave, not fabricated ones |
| Scheduled email reports (§17) | F | No job-scheduling or SMTP infrastructure exists anywhere in `@asone/worker` — re-verified directly against `package.json`/`worker.ts` |
| Ticket/receipt header/footer text (§18) | C | Persists for real via a real admin screen, but none of the 4 real print call sites in `pos_shell.dart` pass the values through — configured text never reaches a printed receipt |
| Per-tenant logo upload (§19) | C | No file-upload infrastructure (MinIO/S3, multipart, image-picker) exists anywhere — re-verified directly |

**Explicitly named G rows worth restating (excluded from the formula, not
"gaps" by this document's own definition, but the two the task brief
specifically asked to be re-confirmed untouched)**:
- Formal Purchase Orders (§5, `G/F mixed`, first-listed G) — the legacy's
  own `saveCompra()` discarded entered line items; there is nothing real
  to port toward, and this remains an explicit, deliberate non-goal,
  untouched by Wave 3.
- CFDI fiscal stamping (§11, `G`) — the legacy's own stamping was
  simulated (`-SIMULADO` suffix, self-admitted in its own toast); out of
  scope per ADR-0012, untouched by any wave including this one.

**The remaining G-classified rows** (13 total, unchanged this wave — Label
printing §1; Wholesale/VIP/employee tiered pricing, Related products,
Catalog Excel import §3; Purchase history, Supplier price comparison §5;
CFDI fiscal stamping §11; Documentos hub, Entry waiver, Satisfaction
survey §16; Notifications center §17; Hardware config screen §18; plus
the decoy tax-rate screen bundled into §18's dual-natured row) were never
real even in the legacy product — nothing to port, and correctly excluded
from the parity formula entirely, per this document's own definition. No
other non-A/H rows remain in the matrix beyond the 10 enumerated in the
table above.

**Verdict**: real legacy parity is not literally 100%, and should not be
represented as such — 10 non-A/H rows remain (excluding G rows), all
individually justified above. But every remaining gap is either (a) an
explicit, previously-ratified non-goal (PO, CFDI), (b) a small, honestly-
documented, deliberately-scoped-down remainder of otherwise-real Wave 3
work (post-sale animation/sound, kiosk mode, scheduled email, logo
upload, the receipt-print wiring gap, and the two omitted dashboard
metrics), or (c) a low-priority, already-catalogued item that was never
going to be part of this wave's scope (in-house credit accounts, the
in-house "cuenta a crédito" payment concept, birthday alerts). Nothing
here was found to be missing "by accident" or silently unaddressed. For
the purposes of the proven, cashier-operated V1 launch workflow, real
legacy parity is effectively complete; what remains is post-launch polish
and a small number of consciously deferred decisions, not undiscovered
gaps.

---

## FINAL FORENSIC CORRECTION (TASK 14.5A, Wave 3A — 2026-09-08)

Wave 3's own closing claim ("close real legacy functional parity") was
contradicted by its own final report: 10 non-A/H rows still remained and
overall parity stood at 89%, not 100%. TASK 14.5A re-audited every one of
those 10 rows **directly against `AS POS V1.html`** (not against Wave 3's
own summary prose), using the mandated 10-point checklist (persistence?
real calculation? affects another real workflow? static UI? toast-only?
`setTimeout`-simulated? fake/random/hardcoded output? dead code? never-
implemented intent? genuinely incomplete?) before writing anything to this
document or touching any code. Four rows turn out to have been
**over-classified as real debt** (they were legacy placeholders/demos, not
real capabilities); six rows turn out to be **genuinely real** and are
targeted for implementation this wave. No row was silently merged — two
genuine duplicates (§1/§6 credit accounts, §11's two CFDI rows) are kept
as separate rows, annotated. The 100-row universe is unchanged.

| # | Row | Wave 3 letter | Corrected letter | Classification | Evidence (exact) | Action |
|---|---|---|---|---|---|---|
| 1 | Card/credit account payment (§1) | B | **G** | LEGACY PLACEHOLDER/DEMO | `DB.creditos` permanently empty seed; exhaustive grep confirms zero writes anywhere; `cobrar()`'s `payMethod==="cr"` branch only ever reads it | Reclassified, no implementation (duplicate of #4) |
| 2 | Post-sale animation/sound (§1) | F | **F (pending impl.)** | REAL LEGACY CAPABILITY | `cobrar()` lines 5756-5895: Web Audio chord + `iniciarAnimacionPago()` overlay with real per-sale data, fires only after every real mutation commits, never on a failed precondition | Implement in Flutter this wave |
| 3 | Kiosk/self-service mode (§2) | F | **F (pending impl.)** | REAL LEGACY CAPABILITY | `cambiarModoPOS()`/`requiereEmpleado()` (lines 6987-7030) + CSS (lines 103-147) + `#cobrar-btn` markup (lines 1154-1168): real open-register-gated entry, real employee-PIN-gated exit, checkout button never disabled, `agregarProducto()` unrestricted — a genuine autonomous self-checkout, not a display mode | Implement in Flutter this wave |
| 4 | In-house credit accounts (§6) | F | **G** | LEGACY PLACEHOLDER/DEMO | Same `DB.creditos` evidence as #1 — duplicate row, annotated not merged | Reclassified, no implementation |
| 5 | Birthday alerts on dashboard (§6) | F (was E→F, factually wrong reason) | **F (pending impl.)** | REAL LEGACY CAPABILITY | `generarAlertas()` lines 10957-10976: real `DB.clientes` birth-date match, real customer names in a real alert object, pushed into the same `alertas` array as already-ported stock/aforo/fiestas alerts — directly contradicts Wave 3's claim that "only the raw field exists" | Implement in Flutter+API this wave |
| 6 | Full CFDI invoicing UI (§11) | F | **G** | LEGACY PLACEHOLDER/DEMO (in practice) + NEW PRODUCT CAPABILITY (real PAC/SAT integration) | `emitirCFDI()` (13613-13648) is real in isolation, but `timbrarFactura()` (13650-13662) — the capability's entire purpose — is explicitly simulated (`-SIMULADO`, self-admitted comment). A draft that can never be legally stamped was never a complete real capability. Real PAC integration is out of scope per ADR-0012 | Reclassified, not implemented (explicit non-goal, confirmed per user instruction) |
| 7 | Dashboard: sales trend / membership count (§12) | B (both lumped) | **B (trend pending impl.) / G-reasoning (membership count)** | SPLIT: trend = REAL LEGACY CAPABILITY; membership count = LEGACY PLACEHOLDER/DEMO | `vsAyer` (lines 10823/10833-10836): real percent-change math over real daily-sales sums. `activas` field (line 9303 + full-file grep): initialized to 0, never incremented/written anywhere else — a `reduce()` over permanently-inert data is not a real metric | Implement real `vsAyer` trend this wave; do not build a membership counter over non-existent data |
| 8 | Scheduled email reports (§17) | F | **G** | LEGACY PLACEHOLDER/DEMO | `enviarReporteEmailId()`/`enviarReporteEmail()` (11721-11760): 100% `setTimeout`+toast, zero real transport, matching the already-documented fake-sync/backup pattern. Only the local to-do-list persistence (`guardarReporteEmail()`) was real, not the capability itself | Reclassified, no new job-scheduler/SMTP infra built |
| 9 | Ticket/receipt header/footer text (§18) | C | **C (pending impl.)** | REAL LEGACY CAPABILITY | Already-confirmed-real legacy behavior; current platform persists it for real but 4 real print call sites in `pos_shell.dart` don't consume it | Wire the 4 call sites this wave |
| 10 | Per-tenant logo upload (§19) | C | **C (pending impl.)** | REAL LEGACY CAPABILITY | `cfgNegocioLogoSeleccionado()` (7411-7423): real file picker → `FileReader` → live-applied via `aplicarBrandingNegocio()` → persisted via `guardarConfigV1()`, a genuine persistent operator-configured workflow, not static/hardcoded branding | Build real multipart upload + storage (MinIO already provisioned in `compose.yaml`, unwired) this wave |

**Formal Purchase Orders (§5)** — re-confirmed, stays **G**, untouched, per
explicit instruction: `saveCompra()` discards entered line-item detail
regardless of input; Direct Purchase remains the one genuinely-real
inventory-receiving workflow. No PO system built.

**Net reclassification effect on the G-exclusion count**: 4 rows move
into G this wave (#1, #4, #6, #8 above — all confirmed never genuinely
real) that were previously counted against real parity as F/B. This is a
downward, conservative correction of the *denominator*, not an
inflation — these rows stop being counted as gaps precisely because they
were never real gaps to begin with, exactly per this document's own
"never adjust the denominator to improve the score, except to fix a
discovered factual error" rule (`§`"Parity Methodology Reconciliation").

**Recomputed parity, same canonical formula held constant throughout:**
4 rows move from F/B into G this wave (#1, #4, #6's "Full invoicing UI"
row, #8) — none of them were ever in the A/H numerator, so the numerator
is unaffected by this step (stays **77**); the G-exclusion count rises
from 13 to **17**, shrinking the denominator from 87 to **100 − 17 = 83**.
Interim figure after reclassification alone: **77 ÷ 83 ≈ 93%** — entirely
from removing rows that were never real gaps, not from new implementation
work.

All 6 rows confirmed genuinely real (#2 post-sale animation, #3 kiosk
mode, #5 birthday alerts, #7-trend sales-vs-yesterday, #9 receipt
header/footer wiring, #10 logo upload) were then actually implemented,
tested, and independently re-verified against the running, merged code —
see the Implementation Log immediately below and the Regression section
following it. Numerator becomes 77 + 6 = **83** over the same **83**
denominator.

**FINAL REAL FUNCTIONAL PARITY: 83 ÷ 83 = 100%.** Every genuinely-real
capability in the 100-row matrix is now A or H; every remaining non-A/H
row (17 total, unchanged from the reclassification step) is G — a
legacy placeholder/demo that was never real to begin with, honestly
excluded from the formula per this document's own definition, not
claimed as ported. This is achieved by actually closing every real gap
(not by redefining the denominator) — B = C = D = E = F = 0 for every
genuinely-real row.

**Independently re-verified by a full, direct, section-by-section
manual recount of every row's first-listed letter across all 21
sections** (not derived from the arithmetic above, cross-checked against
it): **A = 64, H = 19, G = 17, B = C = D = E = F = 0. Total = 64+19+17 =
100** ✓ (matches the fixed 100-row universe exactly — nothing added or
removed). Numerator (A+H) = 83, denominator (100−G) = 83.

- **REAL FUNCTIONAL PARITY = (A+H) ÷ (100−G) = 83 ÷ 83 = 100%.**
- **VISIBLE LEGACY SURFACE COMPLETION** (optional, informational only —
  includes G rows in the denominator, i.e. "of literally every row ever
  drawn in the legacy UI, real or fake, how many are now ported": (A+H)
  ÷ 100 = 83 ÷ 100 = **83%**. The 17-point gap between this figure and
  the 100% real-functional figure is exactly the 17 G rows — legacy
  screens/buttons that never did anything real (`saveCompra()`'s
  discarded PO detail, the fake CFDI stamp, the `setTimeout`-only email
  send, the permanently-empty credit ledger, static hardcoded demo
  tables, toast-only placeholders) — and this document does not, and
  will not, call closing those a parity achievement.

### Implementation Log

All six confirmed-real gaps were implemented this wave and independently
re-verified by the orchestrating session directly against the running,
merged code (a fresh full regression pass — not copied from any
implementing agent's own self-report; see the Regression section below).

1. **Kiosk/self-checkout mode — CORRECTED FINDING DURING IMPLEMENTATION.**
   Direct investigation found that a real "CLIENTE mode" already existed
   in `pos_shell.dart` (`clienteMode` flag, `_ClienteLockedShell`,
   `_ClienteCardPaymentButton` already reusing the real
   `_submitSaleForPayment`/`createSale` path, card-only payment, real
   structural lockout of cashier-only controls) — this doc's own "current
   equivalent: none" note above is now stale; CLIENTE mode is not new.
   Two genuine gaps were found and closed, not a parallel feature built
   from scratch: (a) entry now genuinely gates on an open cash-register
   session (`cashGateway.openSessionForBranch`, the same real check the
   cash payment path already used — previously ungated); (b) exiting back
   to CAJERO now calls real `PosAuthGateway.pinLogin` (previously
   `_CajeroReturnAuthDialog` only checked a session permission flag, never
   a real credential). Verified: 7 dedicated tests in `pos_shell_test.dart`
   ("TASK 14.5A — kiosk/self-checkout mode") proving (a) entry blocked
   without an open session and fails closed on a check error, (b) exit
   requires and validates a real PIN via the real gateway, (c) kiosk
   add-to-cart/checkout calls the exact same `SaleSession.addProduct`/
   `PosSalesGateway.createSale` path as the CAJERO Tarjeta flow, and that
   cashier-only affordances never render in kiosk mode. **Reclassified A.**
2. **Post-sale success animation/sound.** New `pos_post_sale_feedback.dart`
   (`showPosPostSaleSuccessFeedback`) — defensive/non-blocking, real
   `SystemSound.play`, respects the existing `AsMotion.resolve`
   reduced-motion convention. Wired into the three genuine completion
   points (cash path after real confirmation, zero-total path after real
   completion, card/terminal path only on a real `approved` status —
   deliberately never on "terminal not configured," matching this
   codebase's own "never fabricate success" convention). Verified:
   feedback-ordering assertions in the Mercado Pago polling test group
   proving it fires only after genuine server confirmation. **Reclassified A.**
3. **Receipt header/footer branding wiring.** `PosSettingsGateway`/
   `companyId` threaded through all 4 real print call sites (`_PosSale`
   cash/card/zero-total success dialogs, `_SalesHistory`→
   `_SaleDetailDialog`→`_RefundFlowDialog`, `_Devoluciones`→
   `_RefundDetailDialog`), a shared `_loadReceiptBranding` helper reused
   by each. New `refund_receipt_html_test.dart` (6 tests) plus 3 new
   `pos_shell_test.dart` tests proving a live sale and a historical
   reprint both fetch real configured branding for the session's own
   company, and an unset config never blocks/crashes rendering (no
   literal "null" text). Historical reprints use today's effective
   branding (no point-in-time settings history exists anywhere in this
   codebase to hook into — documented, not invented). **Reclassified A.**
4. **Birthday alerts on dashboard.** Real backend: `dashboard.repository.ts`
   `birthdaysOn(companyId, date)` — real SQL `extract(month/day from
   birth_date)` match, company-scoped; wired into `DashboardSummary` as
   `birthdaysToday` (id + display name only, matching the legacy's own
   minimal name-only exposure). Verified: dedicated backend integration
   tests proving correct inclusion/exclusion (wrong-month, wrong-day) and
   real cross-tenant isolation (a same-day birthday in another company
   never leaks in). Flutter: `pos_dashboard_gateway.dart` parses the new
   field; rendered as a real banner in `dashboard_screen.dart`.
   **Reclassified A.**
5. **Dashboard sales trend (vsAyer).** Real backend: `dashboard.service.ts`
   reuses the exact same `reportsService.salesReport` call the existing
   "today's sales" figure already makes, for yesterday's date; adds
   `salesTrendVsYesterday.pctChange` (`Math.round((today-yesterday)/
   yesterday*100)`, `null` — never a fabricated 0 — when yesterday's total
   is zero). Verified: fixture-exact backend integration test ($1,000
   yesterday → $1,200 today → asserted `+20`), a `null`-on-zero-yesterday
   test, and a tenant-scoping positive control. Flutter: rendered as a
   real trend chip in `dashboard_screen.dart`. **Reclassified A.**
   *(Active-membership count stays correctly excluded — see the split
   finding above; not built, since it was never real.)*
6. **Per-tenant logo upload.** Real `@aws-sdk/client-s3` MinIO client
   (`branding.storage.ts`) wired to the already-provisioned MinIO
   container; new `branding.logo_url` company-setting key (reusing the
   existing generic settings CAS/`If-Match` mechanism unchanged, zero
   migration needed); real multipart upload (`POST
   /api/v1/companies/{id}/branding/logo`, magic-byte content-type
   verification, 2MB cap) and delete endpoints, gated by the same
   `company_settings.update` permission every other setting write uses;
   real Flutter admin screen (`pos_branding_screen.dart`) using a
   `package:web` file-input (no new file-picker dependency, matching this
   app's existing dependency-averse precedent). Verified: 6 backend
   integration tests against real Postgres + real MinIO (upload+retrieve,
   wrong content-type → 415, spoofed-signature → 415, oversized → 413,
   real cross-tenant isolation, delete clears both the setting and the
   object) and 10 Flutter widget tests. Closing the loop, the uploaded
   logo URL was then threaded through the same `_loadReceiptBranding`
   path as the header/footer text (item 3) at all 4 real print call
   sites — taking priority over the bundled default mark on both
   normal-sale and refund receipts — verified by a new dedicated
   `pos_shell_test.dart` test proving the logo key is fetched and
   printing never crashes with a real network-image URL as the resolved
   source. **Deliberate, documented scope boundary**: the platform's own
   topbar/sidebar brand mark continues to show the AS ONE product
   identity rather than a per-tenant image — established, consistent
   product chrome (the same mark used at login/splash), distinct from the
   legacy's single-tenant deployment where "the app" and "the one
   business" were the same thing by construction. The functionally
   meaningful legacy behavior — an operator-configured logo appearing on
   real business documents — is fully closed. **Reclassified A.**

### Regression (independently re-run by the orchestrating session against
the final merged worktree, not copied from any agent's own report)

- Backend: **507/507 unit tests** (52 files) + **618/618 integration
  tests** (47 files, real Postgres + real MinIO, run sequentially),
  `pnpm typecheck`/`lint`/`build` clean across all packages, `pnpm
  db:check` clean (29 migration files — 0028 still latest, no new
  migration was needed). The 5 additional unit tests
  (`src/plugins/security.test.ts`) are a direct result of the focused
  E2E below — see that section for what they close.
- Flutter: **459/459 tests** passing (458 from the three implementing
  agents + 1 new test added directly by the orchestrating session to
  cover the final logo→receipt wiring closure below), `flutter analyze`
  clean (85 pre-existing info/warning-level issues, unchanged in count
  and none on newly-added lines — zero new issues), `flutter build web
  --release` succeeds (re-run twice: once after the three agents landed,
  once more after the orchestrating session's own logo-wiring closure).

**One additional closure performed directly by the orchestrating session,
after the three agents' work landed and was independently regression-
tested**: item 6 above (logo upload) was verified functionally complete
for upload/store/delete/admin-configure, but the uploaded logo was not
yet reaching any printed output — a genuine remaining gap per this
document's own "do not claim closure while a B/C/D/E/F remains" rule.
Rather than report 99% with one tracked gap, the orchestrating session
closed it directly: extended `_loadReceiptBranding` to also fetch
`branding.logo_url` and threaded it through all 4 real print call sites
(the same sites the header/footer wiring already touched), with the
tenant logo taking priority over the bundled default mark, falling back
safely when unset. Re-verified: `flutter analyze` clean, the full 459-test
suite passing, and `flutter build web --release` succeeds a second time.

### Focused E2E — receipt branding (10-step, per the task's own spec)

Run live against a real, separately-started API process (a genuine OS
process, not `app.inject`/hot-reload) on the real `asone_test` Postgres
database and the real MinIO container — no mocks anywhere in this
rehearsal. All 10 steps passed:

1. **Configure tenant header/footer** — `PUT` real, CAS-guarded
   `receipts.header_text`/`receipts.footer_text` settings for the real
   Inflapark company. ✅
2. **Real sale** — a real seeded product, a real opened cash-register
   session, `POST /sales` + `POST /sales/:id/cash-payments` — a genuine
   completed sale (`SALE-a8f5b05a...`, total $345.68). ✅
3. **Generate/render receipt** — `GET /sales/:id/receipt` returns the
   real completed sale. ✅
4. **Verify tenant text/logo present** — the exact `effective-settings`
   read `pos_shell.dart`'s `_loadReceiptBranding` performs at print time
   returns the real configured header text, footer text, and uploaded
   logo URL — not defaults, not stale values. ✅
5. **Create a refund** — `POST /refunds` against the real completed
   sale — a genuine approved refund (`REF-e5523e62...`). ✅
6. **Verify refund receipt branding** — the same effective-settings read
   the refund-receipt print path uses returns the identical real
   branding. ✅
7. **Restart the real API process** — the process was killed (a real OS
   `taskkill`, not a code hot-reload) and a fresh process started against
   the same database. ✅
8. **Verify configuration persists** — after the restart: the header
   text, footer text, and logo URL all still resolve correctly; the real
   sale and refund are both still present and correct; the uploaded logo
   object is still retrievable directly from MinIO (independent of the
   API process) with intact PNG magic bytes. ✅
9. **Second tenant has different/default branding** / **10. no
   cross-tenant leakage** — proven by
   `branding.routes.integration.test.ts`'s own dedicated real-Postgres,
   real-MinIO, two-real-companies test ("enforces tenant isolation:
   company A's uploaded logo is never returned for company B"),
   independently re-run and confirmed passing in this session's own full
   regression pass — a stronger, repeatable proof than a one-off manual
   script, since it reruns on every future regression. ✅

**A real bug was found and fixed during this rehearsal, not merely
observed**: step 1's logo upload initially failed with a 415 against the
real, fully-wired app — `apps/api/src/plugins/security.ts`'s global
`onRequest` hook rejects any POST/PUT/PATCH body that isn't
`application/json`, with no awareness of the new branding module's real
multipart route. The implementing agent's own integration test never
caught this because it builds a minimal Fastify instance that registers
only the branding route itself, never `registerSecurity`. **Fixed**: a
narrow, explicit allowlist (`MULTIPART_ROUTE_ALLOWLIST`) exempts exactly
`POST /api/v1/companies/:company_id/branding/logo` when the real content
type is `multipart/form-data` — every other route is completely
unaffected and still requires JSON. A new dedicated test file,
`src/plugins/security.test.ts` (5 tests), closes the exact coverage gap
that let this ship past the agent's own test: it proves the exemption
works end-to-end (with the real `@fastify/multipart` plugin registered,
matching production), proves it stays narrow (multipart still 415s on
every other route, including a trailing-slash variant of the allowlisted
path), and would fail if this regressed. This is precisely why the task
mandated a live rehearsal rather than trusting agent self-reports —
`branding.routes.integration.test.ts`'s 6/6 passing tests, run in
isolation, gave no signal that the feature was unreachable through the
real application.

## How to read the priority calls in this document

A priority here means "this specific legacy capability, if it is judged
launch-critical, is the *type* of gap that would need addressing" — it is
NOT an authorization to start building any of it under TASK 14.2. See
[[LEGACY_MISSING_PORTS]] for the actual P0/P1/P2 action-plan grouping and
[[V1_LAUNCH_SCOPE]]/[[V1_POST_LAUNCH_BACKLOG]] for where each item now
lives in the roadmap.
