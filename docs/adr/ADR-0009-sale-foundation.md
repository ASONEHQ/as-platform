# ADR-0009: Sale foundation and payment ownership

- Status: Accepted
- Date: 2026-09-03
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0008)

## Context

TASK 12.4A built a production-safe `payments`/`payment_attempts`/`payment_terminals` foundation, but deliberately left `payments.sale_reference` an unenforced placeholder because no `sales` domain existed yet (see ADR-0008). That left every payment permanently detached from a real commercial transaction — there was nothing a physical terminal's approval could ever finalize. `docs/API_CONTRACTS.md` §16 (E073–E080) and §21.2 already design `sales`/`sale_items` and their state machine; `docs/CORE_DATA_MODEL.md` §6.6 already specifies their exact field-level shape. TASK 12.4A.1 builds the minimum production-safe `sales` aggregate this contract already reserved, makes `payments.sale_id` a real, required, scoped foreign key, and defines the payment→sale coordination rule — without starting provider-specific terminal integration (still explicitly out of scope) and without inventing sales behavior the existing contracts do not require.

## Decision

### Schema — reconciled against §6.6, three documented deviations

`sales` and `sale_items` are implemented against `docs/CORE_DATA_MODEL.md` §6.6's exact field lists, not invented fresh. Three columns deliberately deviate from §6.6, each because the domain it depends on does not exist in this schema yet — the same "dependency domain doesn't exist yet" justification TASK 12.4A already used for `payments.sale_reference`:

- `sales.cash_register_id` and `sales.device_id` are nullable (§6.6 marks both required, `*`) — no `cash_registers` table exists, and the current CAJERO session is an unbound browser session (`REALTIME_EVENTS.md` §4.1: a `device_id` binds "only when their authenticated session policy requires it"). Requiring either would make sale creation impossible from the actual current session shape.
- `sales.cash_session_id` is nullable — this one is *not* a deviation; §6.6 already marks it optional.
- `sales.sync_operation_id` is a plain, unenforced nullable column (§6.6 also marks it optional) — no `sync_operations` table exists (ADR-0003's offline command sync is designed, not implemented), so it is reserved rather than a fabricated FK.

`sale_items` intentionally has **no** `product_variant_id` column: §6.6's own field list for this table has none — only `product_id` plus the commercial snapshot fields (`product_version`, `sku_snapshot`, `name_snapshot`). This also matches reality: Flutter's `SaleLine` (`apps/one/lib/features/pos/sale_session.dart`) only ever carries a `productId`, never a variant id, so the API never has one to accept.

### The triple-scoped foreign key — tenant/branch consistency at the database level

`sales` gains `unique(company_id, branch_id, id)` alongside its existing `unique(company_id, id)`. `payments.sale_id`'s foreign key is declared as `FOREIGN KEY (company_id, branch_id, sale_id) REFERENCES sales(company_id, branch_id, id)`. This is the strongest available guarantee: a payment's `branch_id` must equal its sale's *real* branch, or the insert has no row to reference and fails at the database level — not just an application-level check. `PaymentService.createPayment` still performs the equivalent check explicitly before the insert (defense in depth, and to surface a clean `sale_branch_mismatch` error instead of an opaque constraint violation).

### Money authority — never trust a client-submitted total

`CreateSaleInput` has no `subtotal`/`tax_total`/`total` field at all — there is nothing for a tampered client to submit. `SalesService.createSale` resolves every line from `{product_id, quantity}` alone: `SalesRepository.resolveProductLines` re-reads `products`/`product_variants`/`product_prices` (mirroring `ProductCatalogRepository.effectivePrices`'s exact "branch override, else company default, currently active" query, executed on the *same transaction connection* the sale is inserted on, not a pre-transaction read that could race a concurrent price change) and the server computes `subtotal`/`tax_total`/`total` itself, in exact `BigInt`-scaled arithmetic — never a JS `number` (ADR-0001).

Tax computation closes a real, previously-undocumented gap: `products.tax_code` (TASK 12.3C) is already a backend-authoritative *classification*, but no rate table existed anywhere in the backend — Mexico's 16%/0% IVA rates were only ever known to Flutter (`posIvaBasisPointsFor` in `pos_models.dart`). `ivaBasisPointsForTaxCode` (`packages/database/src/catalog/pricing.ts`) is the server-side twin of that exact same federal-law constant, not a new tax engine. Money/quantity arithmetic (`sales.service.ts`) deliberately mirrors Flutter's own `Money.multiplyByRateBasisPoints` algorithm bit-for-bit (round-half-up, `BigInt`-scaled) so both runtimes compute identically, honoring ADR-0001's cross-runtime determinism goal — no shared money-arithmetic helper existed anywhere in the backend before this task (every prior module only ever stored/compared pre-computed decimal strings), so this is new, not reused.

### Sale state machine — §21.2 verbatim, one deliberate simplification

The five canonical statuses (`draft`, `pending_payment`, `completed`, `cancelled`, `rejected`) are implemented as-is. This pass collapses `draft → pending_payment` into one atomic creation step — a sale is born directly in `pending_payment` — rather than exposing `draft` as a separately observable API state; `draft` and `rejected` remain structurally valid (the CHECK constraint accepts them) but unexercised: a validation failure throws cleanly with no row ever created, matching the existing `payment_attempts` precedent of "no partial evidence for a rejected attempt." Cancellation is only legal from `pending_payment` — this guarantees no payment has ever captured against the sale, since a captured payment already drives completion (see below), and §21.2 has no `completed → cancelled` edge. Partial-payment *behavior* (e.g., a policy for what "partially paid" means) is not implemented — the contract does not require it, and the task explicitly forbade inventing one; a sale simply stays `pending_payment` until captured payments cover its total.

### Payment → sale coordination — the duplicate-finalization guard

`SalesRepository.trySettleSale(client, context, saleId)` is the single place a sale ever becomes `completed` in this pass. It locks the sale row, sums every `captured` payment already recorded against it (itself just committed on the same connection), and — only while the sale is still `pending_payment` and the sum covers `total` — transitions it, auditing/publishing `sale.completed` in the same transaction. `PaymentService.transitionAttempt` calls it immediately after an attempt reaches `approved` (which already captures the payment per ADR-0008). This is idempotent by construction: calling it again against an already-completed sale is a documented no-op (`settled: false`, no version bump) — a replayed provider callback, a client retry, or two workers racing this same transition can never finalize a sale twice. A second, structural guard exists independently: `createPayment` refuses to attach a new payment to a sale that has left `pending_payment` at all, so once a sale completes there is nothing further to even attempt capturing against it.

`SalesRepository`'s transaction client (`SaleTransaction`) is structurally identical to `PaymentRepository`'s own (`PaymentTransaction`) — both are a bare `{query(sql, values?): Promise<unknown>}` — so `PaymentService` can hand its open transaction's client straight into `SalesRepository.trySettleSale`/`lockSaleById` with no adapter, and the settlement happens in the *same* database transaction as the payment capture it responds to, never a second one.

### Payments module changes

`payments.sale_reference` (TASK 12.4A's provisional, unenforced placeholder) is **deprecated but not dropped**. This project's own migration tooling (`packages/database/src/scripts/check-migrations.ts`) categorically forbids a `DROP COLUMN` statement anywhere in migration history, with no override — so the correct, safe way to retire an unused column here is to leave it declared (nullable, dead, documented) rather than attempt a drop the tooling would reject outright. `payments.sale_id` is the real, required, scoped replacement.

`createPayment` now requires `sale_id` and, before inserting, locks the referenced sale and verifies: it exists for this company; its branch matches the payment's own `branch_id`; it is `pending_payment`; its currency matches the payment's currency. Any failure maps to a specific, clean error (`resource_not_found`, `sale_branch_mismatch`, `invalid_sale_state`, `currency_mismatch`) rather than a raw constraint violation.

### API endpoints

`POST /api/v1/sales`, `GET /api/v1/sales/{id}`, `POST /api/v1/sales/{id}/cancellations` — the minimum needed to create a sale from a POS ticket, retrieve it, and cancel it, reconciled against §16/§21.2. `POST /api/v1/sales/{sale_id}/payments` implements E078 exactly (the canonical nested shape) — it resolves `branch_id` from the sale itself (via `SalesService.sale`, which already enforces branch access, so a 404 here means "not found or not yours," never a silent cross-branch leak) rather than asking the caller to separately supply a value the database's own triple FK would require anyway. The provisional flat `POST /api/v1/payments` from TASK 12.4A is kept, `sale_id` now required in its body: both routes are thin wrappers over the identical `PaymentService.createPayment`, so no migration path is needed between them — a caller of either produces the exact same payment record.

### Permissions, tenant isolation, audit/outbox

`sale.create`, `sale.read`, `sale.cancel` — already-seeded permission codes (`packages/database/src/seeds/technical-permissions.ts`), reused verbatim, no new permission introduced. Every sale/sale-item row carries real `company_id`/`branch_id` scoped columns and FKs (ADR-0006); every read path is branch-filtered through the caller's `permittedBranchIds`. Outbox events reuse the canonical catalogue (`REALTIME_EVENTS.md` §11.7) exactly: `sale.created`, `sale.completed`, `sale.cancelled` — no new event type.

### Inventory — explicitly deferred, not silently skipped

Neither availability validation nor inventory posting is implemented in this pass. There is no unambiguous single `inventory_location` to check or post against yet given a sale→location mapping does not exist, and this task's primary ask was money-authority correctness, not inventory integration. `SalesService.createSale` does not touch `inventory_balances`/`inventory_movements` at all. This mirrors TASK 12.3's own precedent of an honest, documented deferral rather than a fabricated posting rule.

### Migration strategy

Migration 0012 (TASK 12.4A) is untouched. Two new, purely additive migrations were generated instead of hand-editing history:

- `0013_sale_foundation.sql` — creates `sales`/`sale_items`, adds `payments.sale_id` as a nullable column with no FK yet. Adding a `NOT NULL` column with no `DEFAULT` is only safe on an empty table; adding it nullable first is the textbook-safe, portable pattern that is correct whether or not the table already has rows.
- `0014_sale_id_required.sql` — `ALTER COLUMN sale_id SET NOT NULL` and adds `payments_sale_scope_fk`.

This two-step split also happened to route around a real tooling limitation: `drizzle-kit generate` needs an interactive TTY prompt to resolve a same-pass "did a column get renamed or dropped-and-added" ambiguity, which this non-interactive environment cannot satisfy. Keeping `sale_reference` present throughout meant no column ever disappeared in the same pass one appeared, so neither migration ever triggered that prompt — a side benefit of the same additive discipline, not the reason for it.

## Alternatives considered

- **Add `product_variant_id` to `sale_items` anyway**, matching every other domain's variant-keyed convention. Rejected: §6.6's own canonical field list has no such column, and Flutter's `SaleLine` cannot supply one — adding it would be exactly the un-reconciled invention this task's own instructions forbid.
- **Drop `sale_reference` via a migration.** Rejected outright by `check-migrations.ts`'s hard, unconditional `DROP COLUMN` prohibition — not a judgment call.
- **A single migration that both adds `sale_id` and finalizes it `NOT NULL`.** Rejected: unsafe on a populated table with no backfill step, independent of the TTY-prompt issue.
- **Implement authorize-then-capture-driven partial payments / a "partially_paid" sale status.** Rejected: §21.2 has no such status, and the task explicitly said not to invent partial-payment behavior unless existing contracts require it. A sale simply accumulates captured payments until they cover its total.
- **Have `PaymentService` depend on a full `SalesService`.** Rejected: `SalesService.createSale`/`cancelSale` open their own transactions, which would force a second, uncoordinated transaction inside `createPayment`/`transitionAttempt`. Depending on the lower-level `SalesRepository` (transaction-client-compatible) keeps sale validation and settlement inside the *same* transaction as the payment write that triggers them.

## Consequences

A POS ticket can now become a real, authoritative, priced `sales` row before any payment is attempted, and a captured payment can genuinely finalize it. `payments.sale_reference` remains a permanent, harmless, dead column — a small, honest cost of this repository's additive-only migration policy. Inventory posting, availability validation, and offline sync (`sync_operation_id`, `cash_register_id`/`cash_session_id`) remain explicitly deferred to future tasks with their own domains. Provider-specific terminal integration remains untouched and unstarted.

## Validation

Integration-tested against real PostgreSQL: authoritative server-side price/tax computation (including multi-line sums and an `IVA_EXEMPT` zero-tax line), a tampered client-submitted total being silently ignored (there is no field to tamper), quantity validation (zero, malformed), missing/invalid/inactive/priceless product rejection, company- and branch-level isolation on both creation and read, idempotent sale creation and cancellation (including an idempotency-key conflict on a changed request body), cancellation rules (only from `pending_payment`, not twice), exact-decimal money round-tripping, atomic audit/outbox emission, sale/payment ownership (missing sale, cross-company sale, branch mismatch, currency mismatch, non-pending sale), and the settlement coordination itself (a single payment covering the full total completes the sale; two partial payments only complete it once their sum covers it; settling an already-completed sale a second time is a proven no-op). Route-level tests cover permission wiring (`sale.create`/`sale.read`/`sale.cancel`/`payment.create`), the mandatory `Idempotency-Key` header, idempotent-replay header propagation, and the nested `POST /sales/{id}/payments` route resolving `branch_id` from the sale.

## References

- [API contracts §16, §21.2, §24](../API_CONTRACTS.md)
- [Core data model §6.6](../CORE_DATA_MODEL.md)
- [Realtime events §11.7](../REALTIME_EVENTS.md)
- [AS POS sale engine](../AS_POS_SALE_ENGINE.md)
- [ADR-0001](ADR-0001-money-and-rounding.md)
- [ADR-0002](ADR-0002-uuid-strategy.md)
- [ADR-0003](ADR-0003-offline-command-sync.md)
- [ADR-0005](ADR-0005-idempotency-and-outbox.md)
- [ADR-0006](ADR-0006-tenant-isolation.md)
- [ADR-0008](ADR-0008-payment-and-terminal-foundation.md)
