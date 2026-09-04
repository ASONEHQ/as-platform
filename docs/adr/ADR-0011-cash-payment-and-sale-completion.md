# ADR-0011: Cash payment and sale completion

- Status: Accepted
- Date: 2026-09-03
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0008, ADR-0009, ADR-0010)

## Context

TASK 12.4A.1 gave `sales` a real payment→sale settlement path, and TASK 12.4B.1 wired that path to a real electronic provider (Mercado Pago Point) — but AS POS could still not complete a single real sale end-to-end without a configured, physically present card terminal. Mercado Pago's own physical/test terminal setup is intentionally paused at TASK 12.4B.2. TASK 12.5A closes that gap with a production-safe **cash** checkout path: CAJERO enters what the customer physically handed over, the backend records a real `payments`/`payment_attempts` row and completes the sale through the *exact same* settlement logic a card capture already uses, and the UI shows exact change. CLIENTE remains card-only; cash is never exposed there.

Reconciliation against the already-existing architecture (`docs/API_CONTRACTS.md` §13/§16, `docs/CORE_DATA_MODEL.md` §6.6/§24, ADR-0008/ADR-0009/ADR-0010, `packages/database/src/seeds/technical-permissions.ts`) found that nearly every primitive this task needs already exists:

- ADR-0008's attempt state machine already documents and tests a cash attempt going `created → approved` in one step ("a cash attempt has no physical terminal round-trip to report") — built specifically in anticipation of this task.
- `PaymentService.createPayment`'s existing `(paymentMethod === 'card_terminal') !== (terminalId !== null)` check already forces `terminal_id: null` for cash, and `provider` is only ever set from a locked terminal — so cash already gets `provider: null` with zero new code.
- `dispatchAttemptToProvider` already short-circuits to a no-op for any `paymentMethod !== 'card_terminal'` — Mercado Pago was already structurally unreachable from a cash payment before this task touched anything.
- `SalesRepository.trySettleSale` (ADR-0009) is already the single, idempotent place a sale becomes `completed` — summing every `captured` payment and completing only once the sum covers the total.
- `docs/API_CONTRACTS.md` §13.1 and `docs/CORE_DATA_MODEL.md` §24 item 4/5 both explicitly mark "which operations may occur without an open cash session" as an **unresolved, open decision in the canonical documents themselves** — not an implementation gap this task introduced. No `cash_registers`/`cash_sessions`/`cash_movements` table exists anywhere in the schema; ADR-0009 already left `sales.cash_register_id`/`cash_session_id` nullable and unenforced for the identical reason.
- `packages/database/src/seeds/technical-permissions.ts` already reserves `cash_register.*`/`cash_session.*`/`cash_movement.*` permission codes for that undeveloped till/session domain — a different concern from *recording one sale's payment*, which already has its own permission (`payment.create`).
- The CAJERO ticket UI (`apps/one/lib/features/pos/pos_shell.dart`) already has a V1-faithful, currently-inert `_PosPayGrid`/`_PayOption` Efectivo/Tarjeta/Transfer selector (Efectivo pre-selected) and a currently-read-only `pos-ticket-cash-input` field (`hintText: 'Efectivo recibido (Enter)'`) — exactly the UI this task needs to wire, not redesign.

Given all of that, this task is almost entirely new **orchestration** on top of already-tested primitives, plus one genuinely new server responsibility no existing code path had: computing the authoritative amount still owed on a sale and validating a tendered cash amount against it.

## Decision

### A dedicated cash endpoint, not a new branch of the generic payment endpoint

`POST /api/v1/sales/{sale_id}/cash-payments` is a new, additive route — deliberately not a `payment_method: 'cash'` variant of the existing `POST /api/v1/sales/{sale_id}/payments` (E078) body shape. The generic route's contract requires a caller-supplied `amount` (safe today only because its one real caller — the Mercado Pago dispatch path — always charges the sale's full total on its first and only attempt). The task explicitly forbids trusting any client-supplied amount for cash; the client instead supplies only what was physically tendered (`tendered_amount`), and the server alone computes both the amount actually applied to the sale and the change. Growing the generic route with an optional field that only means something for one `payment_method` would be a worse fit than one small, self-describing resource — while still delegating into the identical `payments`/`payment_attempts` tables and state machine, so this is additive, not a parallel concept.

### One transaction, not two — cash has no external round-trip

Every provider-backed payment method in this codebase splits payment creation from attempt approval across two transactions (`createPayment`, then a later `dispatchAttemptToProvider` → `transitionAttempt`) because a real `card_terminal` dispatch makes an outbound HTTP call that must never hold a database connection open. Cash has no such call: the cashier's own physical confirmation of money received *is* the approval event, entirely within this backend's control. `PaymentService.createCashPayment` therefore runs the whole lock-sale → compute-amount-due → validate-tender → insert-payment → insert-attempt → approve → capture → settle-sale sequence inside **one** transaction, holding the sale row's `for update` lock continuously throughout. Splitting it the way the card path is split would only reopen a real race — a second concurrent cash confirmation could read a stale captured-total before the first payment reaches `captured` — for no benefit, since there is no HTTP call here to keep out of the transaction.

### Server-authoritative amount due, tendered cash and change as metadata only

`PaymentRepository.capturedTotalForSale` sums every `status='captured'` payment for the sale (the same `sum(amount) where status='captured'` query `trySettleSale` already runs, duplicated rather than imported — this module already keeps its own small money helpers, per its existing convention). `amountDue = sale.total − capturedTotal`, computed in exact `BigInt`-scaled arithmetic (mirroring `sales.service.ts`'s own independent copy of the same algorithm — ADR-0001's cross-runtime-determinism convention, deliberately not shared as a cross-module dependency for two functions). A cash payment must tender **at least** the full amount due — there is no partial/split-cash concept in this task; a tender for less than the full remaining balance is rejected with `insufficient_tendered`, never silently accepted as a partial contribution. The payment amount actually applied to the sale is always `amountDue`, never the tendered figure. `tenderedAmount` and the derived `changeAmount` are written into the payment's existing `metadata` jsonb column (`tendered_amount`, `change_amount`) — receipt/audit data, never revenue: a 250.00 sale paid with a 500.00 note records a 250.00 payment and 250.00 change, exactly per the task's own worked example.

### Cash approval is not a fake approval

`created → approved` for a cash attempt is the same jump ADR-0008 already documents and tests — this task does not invent it. It is not a fake or auto-approval: by the time this endpoint is called, the cashier has already physically confirmed cash receipt in the Flutter UI (the explicit "Confirmar pago en efectivo" action — see below); this transition is the backend's durable record of that real-world event, the same way a `card_terminal` attempt's `approved` state records Mercado Pago's own report of an event *it* observed. Neither path lets the server invent an approval nobody attested to; the difference is only *who* observed the event (the cashier, versus a provider webhook/poll).

### Cash-register/cash-session domain remains deferred

No `cash_registers`/`cash_sessions`/`cash_movements` table or service is introduced. `sales.cash_register_id`/`cash_session_id` and `payments.cash_session_id` remain the same nullable, unenforced columns ADR-0009 already left in place. This is not a gap this task is choosing to ignore — `docs/CORE_DATA_MODEL.md` §24 and `docs/API_CONTRACTS.md` §13.1 both mark "which operations may occur without an open cash session" **Open** in the canonical documents themselves. Building that domain now would be inventing policy the specification has not yet settled, which the task explicitly forbids ("do NOT invent an entire cash-management module inside this task"). Cash reconciliation and cash-cut integration against a future till/session domain remain deferred to a later task; enough payment metadata (`tendered_amount`, `change_amount`, exact captured amount, timestamps) is already persisted to support that reconciliation later without a schema change.

### Permission reuse, not a new permission

The new route requires `payment.create` — the identical permission the existing card/generic payment routes already require, not one of the reserved `cash_register.*`/`cash_session.*`/`cash_movement.*` codes. Those reserved codes govern a different concern (managing a physical till's open/close lifecycle); recording one sale's payment, regardless of method, is already `payment.create`'s job.

### Flutter: wiring existing UI, not designing new UI

`_PosPayGrid`/`_PayOption` becomes a real Efectivo/Tarjeta/Mercado Pago chooser (Efectivo still the default-active option, matching V1). Choosing Efectivo opens a cash panel that reuses the ticket's existing `pos-ticket-cash-input` field (no longer read-only) for tendered-amount entry, shows the authoritative sale total and computed change live, and requires an explicit "Confirmar pago en efectivo" action before any network call — opening the panel alone never touches the backend. A failed backend call leaves the ticket/`SaleSession` completely untouched (no optimistic clearing); only a confirmed successful completion shows the success state and unlocks "Nueva venta," which is the sole trigger that resets `SaleSession`. CLIENTE's payment surface is untouched by this task — no cash affordance, no cash gateway call, is reachable from that mode.

### Idempotency

`POST /sales/{sale_id}/cash-payments` requires the same mandatory `Idempotency-Key` header every other mutation route in this backend already requires, reusing the identical `pg_advisory_xact_lock`-guarded, tenant-and-operation-scoped key/request-hash replay mechanism (ADR-0005) — no new idempotency mechanism was built. A double click or network retry that resubmits the *same* client-held key safely replays the original response. A genuinely distinct second confirmation (a different key) reaching an already-`completed` sale is rejected outright by the existing "sale must still be `pending_payment`" guard inside the same transaction — there is nothing left to attach a second payment to once the sale settles, exactly mirroring the existing card-payment duplicate-finalization guard from ADR-0009.

## Alternatives considered

- **Extend the generic `/payments` body with an optional `tendered_amount` field.** Rejected: it would make `amount` mean two different things depending on `payment_method` (authoritative for cash, a caller-trusted figure for everything else), and would still require the same new amount-due computation — with none of the self-documenting clarity of a dedicated resource.
- **Split cash into a create step and a separate approve step (mirroring the Mercado Pago dispatch pattern).** Rejected: cash has no external call to keep out of a transaction, so splitting it would only reopen a real TOCTOU race on the server-computed amount due, for no benefit.
- **Build a minimal cash-register/session domain now, since the permission codes are already reserved.** Rejected: the canonical documents themselves mark the underlying policy question open; inventing it here would be guessing at a decision this task was explicitly told not to make.
- **Allow a cash tender less than the full amount due, treating it as a partial payment (mirroring the unconstrained `amount` field on the generic route).** Rejected: the task's scope is a single, complete cash checkout; split/mixed tender is not requested, and silently accepting a short cash tender as "partial" would contradict the explicit "insufficient cash rejected" requirement.

## Consequences

- Positive: zero new database migrations — the entire feature reuses existing `payments`/`payment_attempts` columns (`metadata` jsonb) and the existing state machine; zero new permission codes; zero changes to the Mercado Pago adapter.
- Positive: the amount-due computation is now a real, tested server capability that a future split/mixed-tender feature (if ever approved) can build on directly.
- Negative / accepted cost: cash and card payments now have two different creation entry points (`createPayment` vs. `createCashPayment`) with some structural duplication (sale-locking, payment/attempt insertion) rather than one fully unified code path — accepted because their input contracts and transaction-splitting needs are genuinely different, and unifying them would have meant compromising one of the two.
- Deferred: cash-register/session association, cash-cut/reconciliation, and split/mixed tender all remain explicitly out of scope, tracked via this ADR and the open items already present in `docs/CORE_DATA_MODEL.md` §24 and `docs/API_CONTRACTS.md` §13.1.

## Validation

Integration-tested against real PostgreSQL (`payments.integration.test.ts`, `describe('cash payments (TASK 12.5A)')`): exact cash payment with zero change and sale completion; overpayment with exact change (payment amount is the amount due, never the tendered figure); insufficient tender rejected with no payment row created; zero/negative tender rejected; a short tender against a real, larger sale total rejected (proving there is no client-supplied total to tamper with in the first place); no provider invoked and no terminal/`provider_reference` required; tenant isolation; branch isolation; idempotent replay under the same key creates exactly one payment; a distinct second confirmation against an already-completed sale is rejected; cancelled-sale protection; amount due correctly recomputed from a prior captured (e.g. card) payment on the same sale, rather than the original total; a would-be partial cash tender rejected outright; atomic audit/outbox emission for both the creation and approval steps; exact decimal string round-tripping (no JS float) including a fractional-cent tender/change pair. Route-level tests (`payments.routes.test.ts`, `describe('cash payment HTTP route (TASK 12.5A)')`) cover permission enforcement (`payment.create`, denied without it), the mandatory `Idempotency-Key` header, schema-boundary rejection of a missing `tendered_amount` or of any extra client-supplied amount/total field, the `idempotency-replayed` header on a reported replay, and the receipt-ready response shape (sale summary with line items, `tendered_amount`, `change_amount`).

## References

- `docs/API_CONTRACTS.md` §13 (E034–E048, cash session/register design — reserved, not implemented), §16 (E073–E080, sales/payments), §21.3 (payment state machine).
- `docs/CORE_DATA_MODEL.md` §6.6 (payments), §24 item 4/5 (open decision: operations without an open cash session).
- ADR-0008 (payment/attempt state machine, the `created → approved` cash jump), ADR-0009 (sale foundation, `trySettleSale`), ADR-0010 (Mercado Pago adapter, left untouched by this task).
