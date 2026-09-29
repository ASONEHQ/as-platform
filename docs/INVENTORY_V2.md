# Inventory V2 — ACCESS GO

TASK 17.2. A business-critical pass over the whole inventory domain: real stock, movements, recipe traceability, and a landing-page-style overview an operator can actually read. The task's own explicit instruction was **audit first, reuse the existing architecture wherever possible, and never build a second/competing source of truth for stock**. This document records that audit, exactly what was built on top of it, the worked numeric examples that prove it, and — just as importantly — what was deliberately left alone or explicitly deferred, and why.

## 1. Audit — what already existed before this task touched anything

The inventory ledger (`inventory_balances` / `inventory_movements` / `inventory_movement_lines`), and every mutation path into it, already existed and was already real:

| Capability | State found | Evidence |
|---|---|---|
| Stock read (balances, movements, locations) | **REAL** | `inventory.repository.ts` — real paginated queries, real `STOCK_STATUS_EXPR` derived from each row's own `min_stock`, never a hardcoded threshold. |
| Direct-stock consumption (e.g. Agua) | **REAL** | `sale-consumption.ts` — one atomic settlement transaction, idempotent via `inventory_movements_sale_reference_uq`. |
| Recipe (BOM) consumption | **REAL** | `sale-consumption.ts`'s recipe expansion (TASK 16.32) — multiplies by quantity sold, unit-converts safely, fully atomic (all-or-nothing per sale). |
| Manual adjustments | **REAL** | Draft → submit → post lifecycle (`inventory-drafts.*`, `inventory-posting.*`), reason required. |
| Branch-to-branch transfers | **REAL** | Requested → approved → shipped → received, with a real transit location (`inventory-transfers.*`). |
| Physical counts | **REAL** | `inventory-counts.*` — count → apply, reconciled against the ledger. |
| Reservations | **REAL** | `reservation.*` — used by party bookings to soft-hold stock. |
| Reconciliation / repair | **REAL** | `inventory-reconciliation.*`, `inventory-repair.*` — findings + guided repair, not a silent overwrite. |
| Locations | **REAL** | One-active-default-per-branch enforced at the DB level (`inventory_locations_company_branch_default_active_uq`). |
| RBAC | **REAL** | `inventory.read`, `inventory.adjust`, `inventory.approve`, `inventory.count`, `inventory.reverse`, `inventory.reservation.manage`, `inventory.reconcile`, `inventory.transfer`, `inventory.receive`, `inventory_location.manage`, `inventory.cost.read` — all pre-existing, seeded permissions. No new permission names were invented. |
| Flutter admin UI | **REAL** | `PosInventoryAdminScreen` — a 7-tab (now 8-tab) screen already covering Existencias, Movimientos, Traspasos, Conteos, Reservas, Ajustes/Reconciliación, Ubicaciones, wired into `PosShell` navigation under both "Inventario" and "Admin. Inventario". |

**Conclusion of the audit: no ledger replacement, no second source of truth, and no rebuild of transfers/counts/receiving/reservations was needed or done.** Every one of those was already correct. This task's work is additive: a shared identity-resolution helper, three genuinely new read surfaces (Inventory Overview, "Usado en", enriched Existencias), and honest documentation of the gaps the audit found but which are explicitly out of this task's scope to fix.

### 1.1 Real gaps found (documented, not silently fixed here)

These are real, confirmed gaps. Fixing them was **not** requested by this task and would touch sale/refund/party logic this task was explicitly told not to break — they are recorded here so they are not lost:

- **Refunds do not restock recipe-consumed ingredients.** `SalesRepository`'s refund path restocks a direct-stock sale line (because its own `tracks_inventory` is `true`), but a recipe-driven line's *sold* variant always has `tracks_inventory=false` by the TASK 16.32.3 invariant, so it is always excluded from restock. Refunding a returned Pizza Pepperoni today does not put the dough/cheese/pepperoni/sauce back on the shelf. A future task should decide the correct policy (restock the recipe components? require a manual adjustment? something else) before changing this.
- **Party reservation cancellation never reverses already-issued consumables** (socks/snacks). Confirmed unchanged from the TASK 17.0 audit.
- **No authoritative inventory valuation** (detailed in §7 below) — `average_unit_cost` is hardcoded to `0` on every write path in the codebase, and `standard_cost` is a disconnected manual catalog field. This task does not invent one; see §7.

## 2. What this task added

### 2.1 Shared product-identity resolution (`apps/api/src/modules/inventory/product-identities.ts`)

A batched, never-persisted join (`coalesce(nullif(btrim(v.name), ''), p.name)`) resolving a variant/product's *current* display name, SKU, unit code, and sellability on every read — the exact pattern already proven in TASK 16.32.9's `ProductRecipeRepository.ingredientIdentities`, now generalized into one shared helper instead of four divergent copies. Wired into:

- `inventory-drafts.service.ts` (`listLines`) — draft/movement lines carry `product_name`/`product_sku`/`is_sellable`, not a raw UUID. This is the exact endpoint (`GET /api/v1/inventory/movements/:movement_id/lines`) the Flutter Movimientos tab calls.
- `inventory-transfers.service.ts` (`transferJson`/`lineJson`, plus an `identitiesFor` passthrough used by the GET-detail route — the same route the Flutter Traspasos tab calls).
- `inventory-counts.service.ts` (same pattern; same route the Conteos tab calls).
- `reservation.service.ts` (same pattern; same route the Reservas tab calls).

**API and Flutter status (TASK 17.2.2):** the API returns this identity on all four routes above, and — as of TASK 17.2.2 — the Flutter Movimientos, Traspasos, Conteos, and Reservas line rows all consume it: each line's primary label is the real product/ingredient name (with SKU as a secondary line), via one shared, network-free presentation widget (`_InventoryProductIdentity` in `pos_inventory_admin_screen.dart`). The raw `product_variant_id` stays on the model for internal use (e.g. keys, API calls) but is never the user-facing label. A line whose identity genuinely can't resolve (e.g. a hard-deleted variant referenced only by old history) shows the honest fallback "Producto no disponible" — never a raw or truncated UUID. `_shortId()` remains in use elsewhere in this screen, but only for movement/transfer/branch *reference* ids, never for a product/ingredient identity. (An earlier gate for this task, before TASK 17.2.2, found the API payload carried this data while the Flutter tabs still rendered `_shortId(productVariantId)` for these same lines — that gap is what TASK 17.2.2 closed. The Ajustes/Reconciliación tab's finding detail is the one surface still showing a short variant id: `inventory-reconciliation.service.ts`/`inventory-repair.service.ts` were not touched by TASK 17.2 or 17.2.2 and carry no identity field to consume.)

**This is deliberately NOT a frozen historical snapshot.** None of the four routes above persist the resolved name anywhere — every read re-resolves it fresh from the *current* `products`/`product_variants` rows. Renaming a product today changes what a movement/transfer/count/reservation from last month displays the next time anyone opens it — this is the exact same trade-off TASK 16.32.9 already accepted for recipe ingredients (see `docs/PRODUCT_RECIPES.md`), applied consistently here rather than introduced as something new.

### 2.2 Existencias enrichment (`inventory.repository.ts` / `InventoryBalanceReadRepository.list`)

The balances list query now also selects `v.is_sellable` and, via a `left join` on `b.last_movement_id`, `last_movement_at`/`last_movement_type`. Both pass straight through the existing JSON response (the service only strips `average_unit_cost`/`currency_code` when the caller lacks `inventory.cost.read` — everything else was already unfiltered).

### 2.3 "Usado en" — reverse recipe lookup (`GET /api/v1/product-variants/:variant_id/used-in`)

Given an ingredient variant, which sold products' recipes consume it, and how much per unit sold. One indexed query (`product_recipe_components_variant_idx`) — no N+1, no new subsystem. Returns `[]` for an ingredient nothing references, never an error. `ProductRecipeService.usedIn` 404s only when the variant itself doesn't exist.

### 2.4 Inventory Overview (`GET /api/v1/inventory/overview?branch_id=<uuid>`)

`apps/api/src/modules/inventory/inventory-overview.ts`. The one genuinely new read surface — an operator-facing landing page for inventory. Requires an explicit `branch_id` (400 `validation_error` if omitted): every other branch-scoped screen in this app (cash session, readiness) already requires the caller to pick one branch first, and a single "today" calendar boundary cannot be computed correctly across branches that may sit in different timezones without either picking one arbitrarily or running N separate windows. This endpoint picks neither shortcut — it requires the caller to already know which branch it's asking about.

Response shape:

```json
{
  "item_count": 5,
  "low_stock_count": 1,
  "out_of_stock_count": 1,
  "movements_today_count": 3,
  "business_date": "2026-09-28",
  "valuation": { "available": false, "reason": "..." },
  "alerts": [
    { "product_variant_id": "...", "product_name": "...", "sku": "...", "location_name": "...",
      "quantity_on_hand": "0.000000", "min_stock": "5.000000", "stock_status": "out_of_stock" }
  ],
  "recent_activity": [
    { "movement_id": "...", "movement_number": "IMV-...", "movement_type": "sale_consumption",
      "status": "posted", "occurred_at": "2026-09-28T12:00:00.000Z",
      "reference_type": "sale", "source_document_number": "SALE-1" }
  ],
  "by_location": [
    { "location_id": "...", "location_name": "Principal", "item_count": 5, "low_stock_count": 1, "out_of_stock_count": 1 }
  ]
}
```

- **KPIs** (`item_count`/`low_stock_count`/`out_of_stock_count`) reuse `inventory.repository.ts`'s own `STOCK_STATUS_EXPR` verbatim (`(quantity_on_hand - quantity_reserved) <= 0` → out of stock; `<= min_stock` when a minimum is configured → low stock) — never a second, divergent threshold definition. A prior implementation attempt used raw `quantity_on_hand` instead of the reserved-aware figure and was caught by this task's own integration test before being fixed; see §8.
- **`movements_today_count`** uses the branch's own `timezone` (`branches.timezone`) and the same `isValidIanaTimezone`/`localDateString`/`zonedDayBounds` primitives already proven in `pricing.service.ts`, never a naive UTC "today" comparison. A branch with a missing/corrupted timezone value fails with the same honest, pre-existing `branch_timezone_invalid` (500) error `SalesService.createSale` already uses for the identical failure mode — never a silent UTC fallback.
- **`valuation.available` is always `false` today** — see §7.
- **`alerts`** lists the (up to 10) most urgent low-stock/out-of-stock rows for the branch. **`recent_activity`** lists the 10 most recent movements (header-only, matching the existing movement-list endpoint's own header-only shape — full line-item traceability is the movement-detail view, a separate, already-existing screen). **`by_location`** summarizes the same KPIs per active location.

## 3. "Tipo" classification — the only two real categories

`is_sellable` (TASK 17.1.3) is the only field the backend actually has to classify a stock-tracked item. The Existencias table and the Flutter UI use exactly two labels, never a fabricated third:

| `is_sellable` | Tipo shown | Meaning |
|---|---|---|
| `true` (or absent, pre-17.1.3 default) | **Producto directo** | Sold directly on a sales surface. |
| `false` | **Insumo** | Never sold directly — tracked purely for recipe/inventory purposes. |

No "Consumible"/"Otro" category exists anywhere in this codebase's data model — inventing one would be exactly the anti-pattern TASK 17.1.3 already rejected (see `docs/SELLABILITY.md` §2).

## 4. Worked examples

### 4.1 Direct-stock — "Agua" case

Starting balance 10, sell 2:

| Step | Balance | Movement |
|---|---|---|
| Opening | 10 | `opening_balance` |
| Sell 2 | **8** | one `sale_consumption`, `reference_type='sale'`, `reference_id=<sale id>`, `source_document_number=<sale number>` |
| Retry the same sale | 8 (unchanged) | rejected outright by `inventory_movements_sale_reference_uq` — no duplicate movement, no double-decrement |

No recipe movement is ever produced (Agua has no recipe). Proven end-to-end against real Postgres in `inventory-overview.integration.test.ts`'s "AGUA case" test, and (a richer chained scenario — sale, return, adjustment, transfer) in the pre-existing `inventory-e2e.integration.test.ts`.

### 4.2 Recipe (BOM) — "Pizza Pepperoni" case

Recipe: 1 Masa (unit), 180 g Mozzarella, 80 g Pepperoni, 120 g Salsa. Selling **2** pizzas from openings of Masa=50, Mozzarella=10 kg, Pepperoni=5 kg, Salsa=8 kg:

| Ingredient | Opening | Consumed (×2) | Closing |
|---|---|---|---|
| Masa (dough) | 50 unit | 2 unit | **48.000000** |
| Mozzarella (cheese) | 10.000000 kg | 360 g → 0.360000 kg | **9.640000** |
| Pepperoni | 5.000000 kg | 160 g → 0.160000 kg | **4.840000** |
| Salsa (sauce) | 8.000000 kg | 240 g → 0.240000 kg | **7.760000** |

Grams are unit-converted into each ingredient's own kilogram stock — never a bare arithmetic subtraction across mismatched units, and never a cross-dimension conversion (mass never becomes volume, `unit` never becomes `kg`). Proven, pre-existing, and still passing: `recipe-consumption.integration.test.ts`'s "consumes recipe ingredients multiplied by quantity sold" test carries these exact numbers.

### 4.3 "Usado en" — Mozzarella

`GET /api/v1/product-variants/<mozzarella-id>/used-in` returns one entry: the Pizza Pepperoni recipe, `quantity: "180.000000"`, `unit_of_measure_code: "g"`. Proven in `inventory-overview.integration.test.ts`.

## 5. Unit safety

Unchanged from the pre-existing model — this task added no new unit logic, only reused it. Only 5 units of measure exist (`unit`, `kg`, `g`, `l`, `ml`; no `mg`). `convertUnits()` refuses to cross dimensions (mass ↔ volume, or either ↔ count) before ever attempting a conversion — there is no density inference anywhere in this codebase, and this task did not add any.

## 6. Stock minimum + alerts

`product_variants.min_stock` (nullable) already existed and already drove `STOCK_STATUS_EXPR`'s `low_stock` branch. This task's only addition is surfacing it as a real, honest alert list on the new Overview endpoint (§2.4) — no new threshold model, no fabricated alert when no minimum is configured (a variant with `min_stock=null` is either `available` or `out_of_stock`, never `low_stock`).

## 7. Inventory valuation — deliberately not implemented

**Definitive audit finding: no authoritative unit cost exists anywhere in this system today.**

- `inventory_balances.average_unit_cost` is hardcoded to `0` on every one of its 8 production write paths (opening balance, receipt, adjustment, transfer receipt, sale consumption, etc.) — it is never actually computed anywhere.
- `product_variants.standard_cost` is a disconnected, manually-entered catalog field. No inventory code reads it.
- The pre-existing `reportsRepository.inventoryValueByCurrency` query is structurally guaranteed to return zero rows: its `currency_code is not null` filter can never match, because the table's own CHECK constraint forces `currency_code` to `null` whenever `average_unit_cost=0` — which, per the point above, is always.

Given this, the only honest choice was the one the task spec itself demanded: **do not implement fake valuation.** `GET /api/v1/inventory/overview` always returns `valuation: { available: false, reason: "..." }`, and the Flutter Overview screen shows the literal text "Valor no disponible" with that reason — never a `$0.00`, never a number computed from a cost basis this task's own audit proved does not exist. Recipe costing is deferred for the identical reason (TASK 17.2's own instruction: only implement it if authoritative; it is not).

**What a future task would need to make valuation real:** a genuine costing model — most plausibly a moving-average or FIFO cost recorded at each real receipt/purchase event, threaded through every one of those 8 write paths (currently all writing `0`), before `average_unit_cost` (or a new field) could be trusted for a `SUM(quantity_on_hand * unit_cost)` valuation. That is a substantial, separate piece of work and out of this task's scope.

## 8. Testing

- `apps/api/src/modules/inventory/inventory-overview.integration.test.ts` (new) — the AGUA case (§4.1), the "usado en" reverse lookup (§4.3), and the Overview endpoint's real KPI/alert/by-location/valuation/branch-timezone behavior, all against real Postgres. Caught and fixed two real bugs during development: two of the four overview queries (`counts`, `byLocation`) referenced `product_variants.min_stock` via the shared `STOCK_STATUS_EXPR` without actually joining `product_variants` — a query-planner error, not a silent wrong answer, but a real defect this test suite exists to catch.
- `recipe-consumption.integration.test.ts` (pre-existing, unmodified) — the Pizza Pepperoni case (§4.2) and the broader recipe-consumption test matrix (aggregation across multiple recipe-bearing products in one sale, idempotency-on-retry, atomic rollback on a mid-recipe shortfall, backward compatibility for a product with no recipe, and the TASK 16.32.3 direct-stock/recipe-conflict guard).
- `inventory-e2e.integration.test.ts` (pre-existing, unmodified) — the richer direct-stock chain (sale → return → adjustment → transfer) with real Kardex trail assertions and a "fresh process reload" proof that this backend has no client-/session-scoped balance cache anywhere.
- `inventory-transfers.integration.test.ts`, `inventory-counts.integration.test.ts`, `reservation.integration.test.ts`, `inventory.integration.test.ts`, `product-recipes.integration.test.ts` (all pre-existing) — re-run as regression after the identity-enrichment changes in §2.1; all still pass.

## 9. What deliberately did not change

- The inventory ledger itself, and every one of transfers/counts/receiving/reservations/adjustments/reconciliation — already real, not rebuilt, not duplicated.
- Sales, refunds, and payments — untouched (the refund/recipe-restock gap in §1.1 is documented, not silently patched here).
- Party consumables — untouched (the reservation-cancellation gap in §1.1 is documented, not silently patched here).
- RBAC — no new permission name was created; every guard on the new endpoints reuses an existing, already-seeded permission (`inventory.read`, `catalog.read`).
- Negative-stock policy — unchanged (`next < 0n || next < reserved` throws `insufficient_inventory`, the same formula everywhere it already existed).
- Unit-of-measure model — unchanged; no `mg`, no density inference, no cross-dimension conversion.

## 10. Human-readable movement presentation (TASK 17.2.4)

Production showed raw ledger internals directly to operators — `sale_consumption · IMV-7ffb6d…`, `Ref: sale · SALE-…` — useful for auditing, wrong as the primary business-facing view. This task closed that gap as a **read-model + presentation change only**: the raw ledger stays exactly as authoritative as it always was; nothing here changes what a movement means or how it's computed.

### 10.1 What's real vs. what had to stay honest

Before writing any UI, this task audited the actual movement schema and every real write path (`sale-consumption.ts`, `purchase-order-receipt.ts`, `purchase-receipt.ts`, `sale-return.ts`, `inventory-transfers.service.ts`, `inventory-counts.service.ts`, `reservation.service.ts`, `inventory-reversal.repository.ts`). Two findings shaped the whole design:

- **Quantity is always stored positive** (`inventory_movement_lines_quantity_ck: quantity > 0`). Direction (`entrada`/`salida`) is derived structurally from which of `source_location_id`/`destination_location_id` is set — never from the movement type's name, never from a signed quantity (there isn't one).
- **Every `*_number` field in this system is a disguised UUID**, not a real sequential folio: `sale_number = 'SALE-' + uuid`, and identically for `refund_number`, `transfer_number`, `count_number`, `reservation_number`, `movement_number` (confirmed by reading each generator directly). Showing one as "Venta #1234" would itself be a fabricated business folio — exactly the anti-pattern this task forbids. Every reference display below is therefore a plain word ("Venta", "Compra", "Traspaso"…), never a number; the real identifiers still exist, just moved to an explicit audit section.

### 10.2 Direct sale vs. recipe consumption — the real, authoritative signal

`inventory_movement_lines.metadata` (an existing, previously-unused jsonb column) already carries the one fact needed: for a recipe-driven line, `sale-consumption.ts` writes `{source: 'recipe', recipe_id, sold_product_variant_id, sold_product_name_snapshot, recipe_component_quantity, ...}`; for a direct line, `metadata` is `null`. This is the *only* authoritative distinction this ledger has — never inferred from `is_sellable`, a product name, or an SKU convention. `sold_product_name_snapshot` is a real, frozen value captured at the moment of sale (mirroring the same snapshot pattern `sales.customer_display_name`/`direct_purchases.supplier_name` already use elsewhere) — a later rename of the sold product does not change what a past movement shows.

### 10.3 Backend: `movement-line-summaries.ts`

A new shared helper (`apps/api/src/modules/inventory/movement-line-summaries.ts`), reused by both `InventoryMovementReadService.list()` (the Movimientos list) and `InventoryOverviewService.get()`'s `recentActivity`. A movement can have any number of lines (a multi-ingredient recipe sale posts one movement with one line per ingredient); this task never invents a single "the" product for a movement that had several:

- **`GET /api/v1/inventory/movements`** stays movement-granular (one row per movement — it owns real per-movement actions: submit/post/add-line/delete-line/cancel/reverse, which this task did not touch). Each row gets an honest `line_count`, and — only when that count is exactly 1 — the real `product_variant_id`/`product_name`/`product_sku`/`is_sellable`/`quantity`/`unit_of_measure_code`/`direction`/`metadata` for that single line. A multi-line movement's card shows its real line count instead of a guessed product.
- **`GET /api/v1/inventory/overview`'s `recentActivity`** is genuinely **line-granular** (one row per movement *line*, not per movement) — a deliberate, safe choice specific to this read-only section, which has no movement-level actions to conflict with. A 4-ingredient recipe sale correctly produces 4 real activity rows, never one row with a fabricated single ingredient.

Both reuse the exact identity-resolution pattern already established in TASK 17.2 (`product-identities.ts`) — never a second resolver, never a per-row query (2 bounded queries added per page/request, both backed by the pre-existing `inventory_movement_lines_movement_idx`).

### 10.4 Frontend: one centralized mapping, reused everywhere

`pos_inventory_admin_screen.dart` gains `_activityTitle()` (movement type + reference type + line metadata → the real business-event title: "Salida por venta", "Consumo por receta", "Entrada por compra", "Ajuste por conteo", "Salida por reserva", "Salida/Entrada por traspaso", falling back to the pre-existing generic `_movementTypeLabel()` for every other case — never a duplicated switch statement), `_referenceWord()` (reference type → a plain human word, never a fabricated folio), `_unitLabel()`/`_signedQuantityLabel()` (real localized units — `unidad`/`unidades`/`kg`/`g`/`ml`/`L` — and a compact, correctly-signed quantity, e.g. `−180 g`, never `180.000000 g`), and one shared `_ActivityItem` widget rendering all of the above plus product identity (reusing TASK 17.2.2's own `_InventoryProductIdentity`, "Producto no disponible" fallback included) and the sold-product snapshot when recipe-driven. Resumen's "Actividad reciente" and the Movimientos list card both render through this exact same widget — never two divergent layouts.

### 10.5 Movement detail — the audit drawer

The movement detail dialog's RESUMEN section now leads with the same human title/product/quantity/reference (matching the list card), and gains a collapsed-by-default "Auditoría" section (`_MovementAuditSection`) holding exactly what moved off the primary view: the internal folio (`movement_number`), the raw reference type, the reference/source-document id, and the created/posted/cancelled/reversed timestamps. Nothing is deleted — every technical identifier the file already exposed is still one tap away.

### 10.6 Search

`Buscar por folio, motivo o notas` → `Buscar por producto, SKU, folio, motivo o notas`. Still the exact same client-side filter over the already-loaded page it always was (the list endpoint has no server-side text search) — extended for free once `product_name`/`product_sku` were already in the payload for the card redesign. No new backend capability is claimed.

### 10.7 Known, deliberate limitations

- **Filters**: only status filtering exists (unchanged from before this task). A movement-type/reference-type category filter (Entradas/Salidas/Ventas/Compras/Ajustes/Traspasos/Conteos) is possible — the backend already supports both `movement_type` and `reference_type` query params — but was not built in this pass, to keep this task's scope to the presentation layer it set out to fix.
- **Reference display for `purchase_order`**: `purchase_orders.order_number` is a real (non-UUID) folio, unlike every other `*_number` field — but joining it into the activity/movement read model was judged out of scope for this pass; `purchase_order`/`direct_purchase` references both show the plain word "Compra" today, with the raw `reference_id` still in the audit drawer.
- **Location name** on an activity/movement card was not added (would require an additional per-line location join); only the reconciliation/Ajustes tab's finding detail still shows a short id for its product, since that module has no identity field to consume at all (untouched by TASK 17.2 or 17.2.4) — a real, pre-existing gap, not silently faked here.
- **Narrow (390px) width**: the Resumen tab's pre-existing KPI-card row already overflows by a fixed 5.3px at 390px width, independent of this task's own changes (confirmed by testing with an empty activity feed) — a pre-existing layout limitation this presentation-only task's own scope explicitly excludes fixing ("do not unnecessarily redesign the KPI/alerts sections"). The Movimientos tab has a similar pre-existing narrow-width overflow in its own "Agregar línea" header row (found during TASK 17.2.1's own gate). Both tabs' new activity cards were verified overflow-free at the two required desktop breakpoints (1440×900, 1365×768).
