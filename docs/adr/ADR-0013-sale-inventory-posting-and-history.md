# ADR-0013: Sale-to-inventory posting and sales history

- Status: Accepted
- Date: 2026-09-04
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0009, ADR-0011, ADR-0012)

## Context

TASK 12.6 makes a completed Sale a fully operational record: it should durably reduce stock for tracked products, and a cashier/manager should be able to browse, open, and reprint past sales. Reconciliation against the existing architecture (before writing any code) found:

- `SalesRepository.trySettleSale` is the single, already-transactional coordination point where a Sale genuinely, newly becomes `completed` — called from `PaymentService.createCashPayment` and the card-terminal attempt-transition path, always inside the same database transaction as the payment capture itself. No other code path completes a Sale.
- `InventoryPostingService`/`InventoryPostingRepository` already implement the balance-locking, negative-stock-blocking, and canonical-outbox-emitting mechanics for posting a movement — but scoped explicitly to a manual `draft → pending → posted` workflow for `opening_balance`/`adjustment` movements only, not a real-time atomic POS completion.
- `apps/worker` is a real package but an intentionally empty skeleton ("no processing is configured") — there is no functioning outbox consumer anywhere in this codebase today.
- `sale_items` had no variant identity at all (only `product_id`/`product_version`/`sku_snapshot`/`name_snapshot`), while `inventory_movement_lines.product_variant_id` is a required, non-nullable column.
- Every one of the 6 real seeded branches has exactly one active `inventory_locations` row, and it is that branch's own `is_default=true` row (`inventory_locations_company_branch_default_active_uq` enforces at most one).
- `docs/REALTIME_EVENTS.md`'s own "TASK 09.4" section declares `inventory.movement.created`/`inventory.stock.changed` the single canonical fact for *any* posted movement, superseding earlier type-specific event names — not a pattern of one event per movement type.
- `sales.id`/`payments.id` are `crypto.randomUUID()` (v4, random) — not the `createUuidV7()` used elsewhere in this codebase (bootstrap identities, inventory movements) — so, unlike those, a sale id alone carries no time ordering.

## Decisions

### A1 — Posting moment: inside the settlement transaction

Inventory sale-consumption is posted **inside** `trySettleSale`'s own transaction, immediately after (and only when) the Sale is newly transitioned to `completed` this call — not via an outbox-driven async coordinator. The "outbox coordinator" option was rejected because it does not exist as working infrastructure today (`apps/worker` processes nothing); building one would be new infrastructure, not reuse, and out of this task's scope. The existing pattern — `sale.completed`'s own audit+outbox write is already synchronous, in the same transaction — is followed exactly.

**Trade-off, stated explicitly:** because posting is synchronous with settlement, a stock conflict (see A5) or a missing branch location (A3) now rolls back the *entire* settlement, including the payment capture the caller is still inside of. This is deliberate — the alternative (letting inventory posting fail silently, or in a way that doesn't block settlement) would mean a completed, paid Sale with silently-wrong inventory, which is worse. It is not this task's place to invent a policy for "sell below zero, then post negative" or "reserve stock at cart time" — see "Deferred" below.

### A2 — Movement type: new `sale_consumption`

No sale-specific movement type existed. `issue` is too generic to let a manager later distinguish "sold" from "manually issued/written off" by type alone (a query could still use `reference_type='sale'`, but a dedicated type is clearer and matches what the task itself suggested). `sale_consumption` was added to `inventoryMovementTypes` and the `inventory_movements_type_ck` check constraint (migration `0015`, additive-only — `ALTER TABLE ... DROP/ADD CONSTRAINT`, `ADD COLUMN`, `CREATE UNIQUE INDEX`; no `DROP TABLE`/`DROP COLUMN` anywhere, matching this repository's migration policy). A `sale_consumption` movement is created and posted in one step, directly in the `posted` status with `posted_at`/`posted_by` set — never routed through the manual `draft → pending → posted` workflow, because a Sale's own payment settlement is already the authoritative committed fact, not a proposal awaiting approval.

### A3 — Location mapping: the branch's own single default location

A Sale's branch resolves to `inventory_locations` where `branch_id = sale.branch_id and is_default = true and status = 'active'`. Proven, not assumed: queried the real local database directly and confirmed all 6 seeded branches have exactly this one row. If a branch genuinely has none, posting throws `inventory_location_not_found` (500) rather than guessing a location or silently skipping — this is intentionally the same "block the whole settlement" trade-off as A5, and a production deployment must guarantee every operational branch has an active default location before enabling sales.

### A4 — Variant identity: a new `sale_items.product_variant_id` column

`resolveProductLines` now also returns the default variant id resolved *at sale-creation time*, persisted on `sale_items.product_variant_id` (nullable, mirroring `product_id`'s own nullability; scoped FK to `product_variants(company_id, id)`; migration `0015`). This was judged a real requirement, not convenience: `product_id` alone is not safe to re-derive a variant from at a later posting moment, because — although every product in this domain happens to have exactly one variant today — the schema itself allows a product to carry several (`ProductCatalogService.createVariant`) with the "default" reassignable over time (the partial unique index only enforces one active default *at a time*, not that it never changes). Storing the resolved variant id at the same moment it was actually priced closes that gap. The column is never used to re-derive `sku_snapshot`/`name_snapshot`/`unit_price` — those remain the sale's own frozen commercial snapshot, so this addition has zero effect on historical receipt rendering (ADR-0012 is unchanged).

The tracked/not-tracked decision itself uses the *variant's* own `tracks_inventory` (read live at posting time via the stored `product_variant_id`), not the product-level flag — because inventory movements are variant-scoped (`inventory_movement_lines.product_variant_id`, `inventory_balances.product_variant_id`), so the variant's own flag is the one that actually governs what gets posted.

### A5 — Negative-stock policy: preserved exactly, extended uniformly

The existing, only policy in this codebase (`InventoryPostingService.post()`): on-hand may never go below zero or below the reserved quantity. Extended verbatim to `sale_consumption` rather than inventing a POS-specific exception. See A1's trade-off note for the consequence (a stock conflict rolls back the whole settlement). Whether POS should instead reserve stock at cart time or allow controlled overselling is an explicit, real product decision this task does not make — flagged as future work, not silently resolved either way.

### A6 — Idempotency: two independent guarantees

Application-level: `trySettleSale` posts inventory only in the branch where `settled` first becomes `true`; a sale already outside `pending_payment` (a replayed payment confirmation, a duplicate settlement attempt) returns `settled: false` and never reaches posting at all — already idempotent by the method's own pre-existing design. Database-level, added as defense in depth: `inventory_movements_sale_reference_uq`, a partial unique index on `(company_id, reference_id) where reference_type='sale'` — a second `sale_consumption` movement for the same sale is a constraint violation even if the application guard were somehow bypassed. Proven directly: an integration test attempts exactly that raw duplicate insert and asserts the constraint rejects it.

### A7 — Audit/outbox: reuse the canonical events, no new event type

`inventory.movement.created` (one per posted movement) and `inventory.stock.changed` (one per affected balance) — the exact events `InventoryPostingRepository.outbox()` already emits for every other movement type, per `REALTIME_EVENTS.md`'s own "single canonical stock-change fact" rule. `movement_type: 'sale_consumption'` in the payload is what distinguishes this from any other posted movement; no `inventory.sale_consumed` (or similar) event was added, since one would duplicate an existing canonical fact rather than add a genuinely new one. An `audit_log` row (`inventory_movement.posted`) is written in the same transaction, mirroring the shape `InventoryPostingService.post()`'s own audit write uses.

### Part F — No retroactive backfill

Only a new Sale settlement (via `trySettleSale`, as of this deployment) ever creates a `sale_consumption` movement. There is no startup backfill, no migration that back-posts historical completed Sales, and no worker process that would do so implicitly. Verified directly against the real local database: the real pre-existing completed Sale from TASK 12.5B's own QA (`SALE-7f4fd344b96a405eba0d4658770743a4`, completed before this feature was deployed) has zero `inventory_movements` rows referencing it, and this was not changed by deploying this task's code — restarting the API process does not retroactively post anything, because nothing scans for un-posted historical sales at all. If a backfill is ever wanted, it must be a separate, explicit, controlled process — not built here.

### Part B — Sales history list (E075)

`GET /api/v1/sales` implements E075's filter set (branch, status, date range, folio search, payment method, cursor pagination) minus `register`/`session`/`device` (no such domain exists yet; deliberately out of scope, matching this task's own "do not build cash-register/cash-cut sessions yet"). Ordering is newest-first via `(occurred_at, id)` — not the simpler single-`id` cursor `GET /payments` already uses, precisely because `sales.id` (a plain `crypto.randomUUID()`) carries no time ordering the way a `createUuidV7()`-generated id would. The cursor is one opaque, base64url-encoded string holding both fields — never a bare, client-parseable timestamp/id pair. List rows are summaries (`SalesRepository.listSummaries`, three batched queries — branch/cashier names, item counts, distinct captured payment methods — never one query per row); a manager opens one sale via the already-existing `GET /sales/{id}` + `GET /sales/{id}/receipt`, unchanged.

### Part C — Flutter sales history

"Historial de ventas" was already reserved as `PosModule.history` under the "Administración" sidebar group in `pos_navigation.dart`, matching the canonical `AS POS V1.html` sidebar structure exactly (that file's own header comment establishes group membership must match V1, "not an app-specific reinterpretation") — implemented in that existing slot rather than inventing a new "Ventas" group entry, even though the task's own prose loosely suggested "under Ventas." A self-contained `StatefulWidget` (`_SalesHistory`) does its own gateway calls/pagination — closer to `_ReceiptSuccessDialogState`'s own pattern than to `_Products`/`_Inventory`'s simpler read-once `PosReadController` state machine, because filters/pagination/detail here are genuinely interactive. Detail and reprint reuse TASK 12.5B/12.5B.1's receipt infrastructure verbatim (`PosSalesGateway.receipt`, `buildReceiptHtml`, `openReceiptPrintWindow`, `displaySaleFolio`) — no parallel receipt-rendering path was built. No Refund/Cancel/Void control exists anywhere in the detail dialog, per the task's own explicit instruction.

## Deferred (explicitly out of scope for this task)

- Refunds (any UI or backend endpoint).
- Cash-register / cash-cut sessions (`cash_register_id`/`cash_session_id` remain the same reserved, unpopulated columns ADR-0009 already described).
- Whether POS should reserve stock at cart time or permit controlled overselling — a real product decision, not resolved here (see A5).
- Resuming Mercado Pago (TASK 12.4B.2) — unrelated and untouched.
- A real outbox consumer/dispatcher (`apps/worker` remains a skeleton) — inventory posting works today entirely inside the settlement transaction, per A1, without needing one.
