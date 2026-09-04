# ADR-0015: Returns / refunds engine

- Status: Accepted
- Date: 2026-09-04
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0001, ADR-0009, ADR-0011, ADR-0013, ADR-0014)

## Context

TASK 12.8 builds the complete post-sale correction lifecycle: full return, partial item/quantity return, refund calculation, refund execution, inventory restoration, cash drawer impact, immutable return/refund records, a return/refund receipt, Sales History visibility, and idempotent retries. Reconciliation against the existing architecture (before writing any code) found the domain almost entirely pre-specified, not invented fresh:

- `docs/CORE_DATA_MODEL.md` §6.6 already gives exact field lists for `refunds`/`refund_items` — including "completed amount cannot exceed refundable balance", "cumulative quantity not above sold less prior refunds", and "completed refund immutable".
- `docs/API_CONTRACTS.md` §5 reserves five refund-specific error codes; §6 reserves five `refund.*` permissions plus `payment.reverse`/`inventory.reverse`; §17 gives exact E081–E087 endpoint contracts; §21.4 gives the exact 6-state/8-transition `refunds` machine, explicitly noting "the approval-separation policy remains configurable/open".
- `apps/api/src/modules/payments/payments.service.ts` already had `reversePayment` (E080) built and unwired, and `MercadoPagoPointProvider.refund()` existed with its own doc comment explicitly deferring the "when to call this" decision to this task.
- `apps/one/lib/features/pos/pos_navigation.dart` already reserves `PosModule.returns` ("Devoluciones", group "Ventas") as the Returns UI's slot, unwired.
- AS POS V1.html has a dedicated "Devoluciones" sidebar page (`data-nav="devoluciones"`) gated by a `pedirPinAdmin` manager-PIN prompt, and posts a `agregarMovCaja("devolucion", ...)` cash-drawer movement — confirmed by reading the file directly, validating the general direction (manager gate → cash-drawer effect) while informing decision D13 below (never reproduce the fake PIN itself).

## Decisions

### D1 — Cancellation vs. return are different facts, never conflated

A pre-existing `POST /sales/{id}/cancellations` endpoint (ADR-0009) marks a Sale `cancelled` — it exists for a sale that never should have completed at all (mis-rung, abandoned). A return/refund is the opposite case: the sale *did* happen, the goods/service *were* legitimately sold, and something afterward requires unwinding some or all of it. This task never routes a refund through the cancellation endpoint, and the cancellation endpoint gained no refund-adjacent behavior. The two remain structurally and semantically separate, matching the task's own explicit "do not use the pre-existing cancellation endpoint to erase a completed Sale" instruction.

### D2 — The original Sale stays immutable; a refund is a new durable fact

`sales`/`sale_items` gain zero new mutable fields from this task, and no code path here ever calls `updateSaleStatus` or otherwise edits a completed Sale's own rows. A return is represented entirely as new `refunds`/`refund_items` rows referencing the original sale — the original commercial fact (what was sold, for how much, when) is permanently preserved exactly as it was. `sales.status` never gains a project-invented 6th value (no `refunded`/`partially_refunded` status) — refund state is *derived* at read time from the immutable `refunds` table (see D12), never stored back onto `sales`.

### D3 — Schema: exactly what §6.6 already reserved, no parallel domain

`refunds`/`refund_items` (`packages/database/src/schema/refunds.ts`) implement §6.6's field lists field-for-field. Two additions beyond the literal list, both needed for correctness and neither inventing a new domain:

- `refunds.payment_id` — the specific original `payments` row a refund reverses/corrects, resolved and frozen at *completion* time (not creation time, since which payment is even still eligible depends on what's still captured when the cashier actually confirms). A 2-column FK `(company_id, payment_id) → payments(company_id, id)`, matching every other cross-module reference to `payments` in this codebase — `payments` was never given a `(company_id, branch_id, id)` triple unique constraint (unlike `sales`), so a 3-column FK isn't possible.
- `refunds.refund_method` — always derived server-side from the original captured payment (D9), never a client choice.

### D4 — Partial-quantity refunds: the existing `sale_items` snapshot is mathematically sufficient

The task's own instruction ("if current SaleItem snapshots are insufficient for mathematically exact partial returns, STOP and design the smallest schema extension needed") was explicitly checked before coding. `sale_items` already freezes `unit_price`, `tax_snapshot` (`{tax_code, basis_points}`), `quantity`, and the exact line `subtotal`/`tax_total`/`line_total` at sale time (ADR-0012's "never re-resolved from the live catalog" precedent). A partial refund's per-line amounts are computed by re-deriving the *per-unit* subtotal/tax from that frozen snapshot (`lineSubtotal / lineQuantity`, then re-applying `basis_points` to the refunded quantity) — exact `BigInt`-scaled arithmetic throughout (ADR-0001), never `Number()`. No schema extension was needed; `computeLineReversal` in `refunds.service.ts` is the one function that does this derivation, and it is the only place in the codebase that re-splits a frozen line by quantity.

### D5 — Refund values are always backend-authoritative, from the original snapshot

`createRefund` never accepts a client-submitted amount for any line — only `sale_item_id` and `quantity`. Every money figure on the resulting refund is computed by the backend from the *original* `sale_items` snapshot, never from today's product catalog/pricing (the task's own explicit prohibition). `POST /refunds`'s request schema has no `unit_price`/`subtotal`/`total` field at all — `additionalProperties: false` rejects one outright if a client tried, proven with a dedicated HTTP-layer test (`refunds.routes.test.ts`, "never accepts a client-submitted refund total").

### D6 — Durable cumulative-return safety, enforced at the database, not trusted from Flutter

A sale item can never be refunded (cumulatively, across any number of separate refunds) beyond its originally sold quantity. This is enforced at three layers, deepest-first:

1. **Database**: `refund_items_quantity_ck` (`quantity > 0`) plus the application computing "already refunded" from a `select ... for update`-locked read of every prior *completed* refund's items for the same sale items (`RefundsRepository.refundedQuantitiesForSaleItems`), inside the same transaction that inserts the new refund row — so two concurrent refund attempts against the same sale item serialize on the sale's own row lock (D8) rather than racing.
2. **Service**: `RefundsService.createRefund` throws `refund_limit_exceeded` the moment any requested line's quantity would push cumulative-refunded-quantity past sold-quantity, computed with exact `BigInt`-scaled decimal comparison — never `Number()`.
3. **Never Flutter**: the Flutter side never computes "is this refundable" itself; it always calls `GET /sales/{id}/refundable-balance` (E081) first and disables/hides refund controls based on the backend's own answer (see D14).

### D7 — Approval policy: self-approve-or-reject-outright, not an unbuilt separate workflow

§21.4 leaves "the approval-separation policy" explicitly open. Building a full separate-approval workflow (a second actor reviewing a `pending_approval` queue) would mean shipping UI and endpoints (E085) nothing in this task's own scope actually exercises yet. Instead: `POST /refunds` requires the creating actor to hold *both* `refund.create` and `refund.approve`; if so, the refund is created directly in `approved` status (`requested → approved`, "requester may self-approve by policy" — a real, documented transition in §21.4's own diagram, not an invented one). If the actor lacks `refund.approve`, nothing is persisted and the request is rejected outright with `refund_approval_required` — never silently queued into a `pending_approval` state no UI can ever advance out of. `pending_approval` and `rejected` stay structurally valid (the column check constraint accepts them, the state machine still models them) but are unexercised by this pass, mirroring `sales.ts`'s own precedent for `draft`/`rejected`. E085 (a dedicated approval endpoint) was therefore deliberately not built. A successful self-approved creation publishes the already-reserved `refund.approved` outbox event exactly once — `refund.requested` is not additionally published for the same command, since the refund never observably exists in a separate `requested` state for a listener to react to.

### D8 — Concurrency: row-level locking, no triggers, mirroring the sales/cash precedent

`RefundsRepository.lockSaleForRefund` takes a `for update` lock on the original sale's row before computing refundable balance or inserting a new refund, and `lockRefund` does the same on the refund's own row before `completeRefund` runs — the same "row-level `FOR UPDATE` locking, never a database trigger" discipline ADR-0009/ADR-0011/ADR-0014 already established. Two concurrent `createRefund` calls against the same sale serialize on the sale's lock; two concurrent `completeRefund` calls against the same refund serialize on the refund's own lock (and the second sees it already `completed` and returns the idempotent replay, D10).

### D9 — Refund method always follows the original payment; no override

A refund's `refund_method` is fixed at creation time to the original sale's captured payment method (`capturedPaymentForSale`) — `cash`, `card_terminal`, `card_manual`, or `other`. There is no request field to choose a different refund method, and no code path allows "sold by card, refunded in cash" or vice versa. This is a deliberate scope decision, not an oversight: mixed-method refunds are a real future feature, but nothing in this task's own QA target or Part list requires it, and building an override surface without a corresponding UI or reconciliation story would be exactly the kind of speculative surface the task explicitly warns against ("implement the smallest coherent surface").

### D10 — `completeRefund`: one atomic effects boundary, idempotent by database constraint

E086 (`POST /refunds/{id}/completion`) is the single point where a refund's real-world effects post: it reverses the original payment (full refund only, D11), posts the cash-drawer movement (cash only, D9), and restores inventory (D6/D12-adjacent) — all inside **one** database transaction, mirroring ADR-0011/ADR-0013/ADR-0014's established "one transaction, N effects" pattern. Idempotent retry is guaranteed at the database level, not merely by the application-level idempotency-key mechanism:

- `cash_movements_refund_reference_uq` — a partial unique index on `(company_id, reference_id) where reference_type='refund'` — blocks a second `cash_refund` movement for the same refund.
- `inventory_movements_refund_reference_uq` — the equivalent partial unique index on `inventory_movements`, added specifically for this task because `inventory_movements_reversal_of_posted_uq` (the existing reversal-uniqueness constraint) only permits *one* reversal per original movement ever, which is unsuitable for a repeatable partial-return model; this task's inventory return instead uses `movement_type='return'` with `reference_type='refund'`/`reference_id`, a fresh partial unique index rather than reusing the reversal shape.
- `refunds_completed_fields_ck` — `completed_at`/`payment_id` are populated atomically together with `status='completed'`, never partially.

A retried completion (same idempotency key) replays the already-`completed` refund's own row — proven with dedicated integration tests asserting exactly one cash movement, one inventory movement, and no double payment reversal survive two calls. A genuinely new completion publishes the already-reserved `refund.completed` outbox event exactly once (idempotent replays do not re-publish).

### D11 — Cash refund: current open session, exact amount, never the original tender

Cash-refund semantics mirror ADR-0014's cash-sale semantics exactly, in reverse:

- The drawer movement amount is always the refund's own computed `total` (re-derived from the frozen sale-item snapshot, D4/D5) — **never** the original sale's tendered amount. The task's own canonical example ($29 sale, full cash refund ⇒ drawer impact exactly `-$29`, never `-$50` tendered) is a dedicated integration test assertion.
- The session credited is always the **current** open session for the branch/register performing the refund today — never the original (possibly long-closed) sale's own session. `refunds.cash_session_id` is populated only at completion time, resolved via the same `resolveOpenCashSession` logic `PaymentService` already uses (explicit `cash_register_id` if supplied; otherwise the branch's single open session; `validation_error` if more than one is open; never silently guessed).
- If no cash session is open when a cash refund is completed, it fails safely with `cash_session_required` (via the payments-module `CashError`, now mapped in `refunds.http-errors.ts`) — no session is ever silently created.
- A completed refund never mutates the *original* sale's own (possibly closed) session — proven with an integration test that closes the original session, opens a new one, completes the refund, and asserts the new session receives the movement while the closed session's own fields are byte-for-byte unchanged.

A latent, pre-existing bug was found and fixed as a direct side effect of building this: `payments.http-errors.ts`'s `mapPaymentError` never handled `CashError` at all, so `cash_session_required` (and every other `CashError` code) thrown from `PaymentService.createCashPayment`'s own `resolveOpenCashSession` call fell through to a generic 500 instead of the correct 409. Fixed by adding a `CashError` branch, reusing the exact `cashErrorStatus` mapping `cash.http-errors.ts` already defines.

### D12 — Inventory restoration: append-only, disposition-derived, partial-safe

A completed refund posts an inventory `return` movement (D10's fresh reference-uniqueness constraint) for exactly the returned quantity, and only for a stock-tracked product variant — a non-stock (service) line posts no inventory movement at all, proven directly. `restock_disposition` is server-derived (`restock` for a tracked variant, `no_restock` for anything else) — no disposition-selection UI exists in this pass, so `damage`/`quarantine` stay structurally valid but unused (CORE_DATA_MODEL §12's full 4-value set). A partial return restores only the actually-returned quantity, never the line's full original quantity, and a retried completion restores it exactly once (D10). The original `sale_consumption` movement from the sale itself is never edited, deleted, or reversed-in-place — it remains posted exactly as it was; the return is a wholly separate, additional movement, matching D2's "new fact, not an edit" principle.

### D13 — Permissions: reuse the five reserved codes; V1's PIN gate maps to real permission checks

`refund.read`, `refund.create`, `refund.approve`, `refund.complete`, `refund.cancel` were already present in `packages/database/src/seeds/technical-permissions.ts` before this task began (matching API_CONTRACTS §6 exactly) — none invented, no wildcard, no manual `role_permissions` SQL patch. `refund.cancel` is seeded but unused by this pass (no cancellation endpoint, D7-adjacent — E087 deliberately not built for the same "smallest coherent surface" reasoning as E085). The local development Owner role (`bootstrap-owner.service.ts`) was extended to grant exactly `refund.read`/`refund.create`/`refund.approve`/`refund.complete` — the four the QA flow actually exercises, mirroring ADR-0014's own "grant only what the flow needs" discipline; verified directly against the real local database (`role_permissions` now carries all four for the Owner-equivalent role, and none for `refund.cancel`).

AS POS V1's `pedirPinAdmin` manager-PIN gate on its Devoluciones page is **not** reproduced as a fake/master credential anywhere in this implementation. Its intent — "returns need elevated authorization" — is honored entirely through real, already-authenticated permission checks (`refund.create`/`refund.approve`/`refund.complete`, enforced server-side via the existing `requirePermission` guard): whoever is signed in either has the real permission or does not, with no separate PIN prompt, no hardcoded bypass code, and no client-side-only gate that a permission-less actor could work around.

### D14 — Sales History / Sale Detail visibility: derived state, never a stored status, never hidden originals

`SalesRepository.refundStatesForSales` derives `not_refunded` / `partially_refunded` / `fully_refunded` per sale, purely from `refunds`/`refund_items` where `refunds.status = 'completed'` — a `requested`/`approved`-but-not-yet-completed refund never flips a sale's displayed state, since its effects haven't actually posted yet (D10). The per-line "every sold unit refunded" comparison is done as an exact `numeric` comparison inside the SQL query itself (`bool_and(refunded_quantity >= sold_quantity)`), never as a floating-point comparison in application code. This is exposed on both `GET /sales` (list — `saleSummaryHttp`'s `refund_state` field, batched alongside the existing `listSummaries` lookup in one extra query, never N+1) and `GET /sales/{id}` (detail). `sales.status` itself is never overwritten or hidden — a fully-refunded sale still reports `status: "completed"` alongside `refund_state: "fully_refunded"`; Flutter composes the two into a display label (e.g. "Completada · reembolsada") rather than the backend fabricating a combined string, keeping the original commercial fact visible exactly as D2 requires. `GET /refunds?sale_id={id}` (E084, already built for the dedicated Devoluciones history list) is the same endpoint a Sale Detail's "returns for this sale" section calls — no duplicate navigation or duplicate list endpoint was built to satisfy this.

### D15 — Card/provider refunds: honest failure, never a simulated success

`completeRefund` never requires live Mercado Pago credentials to exist, and never fabricates a successful external card refund. For a `card_terminal` refund it looks up the original captured payment's approved attempt and its `provider_reference`; if Mercado Pago is unconfigured (the expected state throughout this task — TASK 12.4B.2 remains paused), `MercadoPagoPointProvider.refund()` throws `PaymentProviderError` with a `not_configured` code, which `completeRefund` maps to `RefundError('payment_not_reversible', ...)` carrying the Spanish message the task itself suggested ("El reembolso con tarjeta requiere la configuración del proveedor de pago"). Nothing is partially committed on this path — the refund stays `approved`, never a fabricated `completed`, proven directly with an integration test. A **partial** refund of a card payment is explicitly not supported in this pass (`payment_not_reversible` is thrown outright, full stop) — card partial-refund correctness (which portion of a single captured authorization to reverse) is a real unresolved design question the task's own scope does not require answering today; only a full-amount card refund is even attempted.

### D16 — Legacy pre-12.8 sales: refundable if their own data is sufficient, no synthetic backfill

A Sale completed before this deployment (no `cash_register_id`/`cash_session_id`, exactly the shape a pre-12.7 completion produced) can still be refunded through this exact same code path — proven directly against a real historical completed Sale inserted with that exact shape. Nothing about `createRefund`/`completeRefund` assumes a sale has 12.7-era cash-session linkage; it only reads `sale_items`' own frozen snapshot (always present since ADR-0009) and whatever `payments` row exists for the sale. There is no startup backfill, no migration that back-populates historical sales with synthetic refund-readiness fields, and no hidden default that invents a return where none was recorded — mirroring ADR-0013's "no retroactive backfill" precedent exactly. If a genuinely too-old or malformed historical sale lacks what's needed to compute an exact refund (e.g. no captured payment row at all), the correct behavior is an explicit rejection, not a guess — no such case was found in practice, so no additional guard beyond the existing "no captured payment found" checks was needed.

### D17 — Return/refund receipt: composed client-side from already-exposed data, no new endpoint

No dedicated `GET /refunds/{id}/receipt` endpoint was built. `GET /refunds/{id}` (E083) already returns the refund's full item list plus every value needed (subtotal/tax/total per line and in aggregate, `refund_number`, `occurred_at`, `reason_code`); the existing sale/organization/branch data (already fetched by Flutter for the original sale's own receipt, ADR-0012) supplies the business/branch header. The Flutter return receipt composes these two already-authoritative reads the same way the sale receipt composes `sale`+`organization`+`payments` — no fabricated fiscal fields, and printing/reprinting never mutates any state (identical to the sale receipt's own read-only guarantee). Building a separate backend endpoint for a document fully derivable from data the client already has would have been exactly the "blindly introduce endpoints beyond the smallest coherent surface" the task explicitly warns against.

## Deferred (explicitly out of scope for this task)

- **E085** (`POST /refunds/{id}/approval`) — a dedicated separate-approval workflow endpoint. Not built; see D7. `pending_approval`/`rejected` stay structurally valid, unexercised.
- **E087** (`POST /refunds/{id}/cancellations`) — cancelling an in-flight refund request. Not built; `refund.cancel` stays seeded, unused.
- **Card refund method override / mixed-method refunds** ("sold by card, refunded in cash") — see D9. No request field exists for this.
- **Partial card-terminal refunds** — see D15. Only a full-amount card refund is ever attempted; a partial one is rejected outright with `payment_not_reversible`.
- **Manual disposition selection** (`damage`/`quarantine`) for a returned line — see D12. Always server-derived as `restock`/`no_restock` today; the other two dispositions stay schema-valid for a future feature.
- **Mercado Pago** (TASK 12.4B.2) — untouched and still paused. `MercadoPagoPointProvider.refund()` is now actually *called* by `completeRefund` (previously unwired), but with no live credentials configured in any environment this task touches, so it structurally cannot succeed yet — see D15.
- **Offline/queued refund requests** — CORE_DATA_MODEL §6.6 itself flags this as "future offline policy must cap risk and remain idempotent"; this task's refund creation is online-only, matching every other mutation this deployment currently requires network connectivity for.
