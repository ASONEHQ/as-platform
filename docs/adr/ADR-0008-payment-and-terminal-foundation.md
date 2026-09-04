# ADR-0008: Payment and terminal foundation

- Status: Accepted
- Date: 2026-09-03
- Owners: AS ONE Engineering

## Context

TASK 12.4A required a production-safe foundation for AS POS to eventually create a payment, send its amount to a physical card terminal, receive an authoritative approve/decline/cancel/timeout result, and only then consider a sale paid — without yet integrating a real provider or building the `sales` domain itself. `docs/API_CONTRACTS.md` §16 (E073–E080) and §21.3 already designed `payments` as a child of a future `sales` row with an exact five-state machine (`pending → authorized|captured|failed`, `authorized → captured|failed`, `captured → reversed`) and reserved permissions (`payment.read`/`payment.create`/`payment.reverse`), but §24 "Open decisions" item 7 explicitly leaves "electronic payment provider state mapping, authorization/capture policy, and webhook contracts" unresolved — this ADR resolves the parts needed to build the foundation without resolving the parts that require real provider evidence.

## Decision

- **Reuse, don't reinvent, the canonical `payments` states.** The five states above are implemented verbatim as `payments.status`'s CHECK constraint. No project-invented state name is introduced at this level.
- **`payment_attempts` is new** (the contract does not yet define it) — one row per try, carrying the finer-grained terminal-interaction lifecycle a real terminal reports through: `created → awaiting_terminal → processing → approved|declined|cancelled|timed_out|failed`. A retry after a non-approved terminal outcome always creates a new attempt row; the prior attempt's evidence is never mutated. `created` may jump directly to any outcome (a cash attempt has no physical terminal round-trip to report), but a transition can never move backwards, and once an attempt reaches a terminal state it accepts no further transition.
- **An attempt reaching `approved` immediately captures the parent payment** (`pending → captured`). This ADR deliberately does not implement a separate authorize-then-capture consumer flow, since choosing that policy is exactly the still-open decision #7 above — the schema's `authorized` state and `authorized_at` column exist so a future provider that genuinely needs a two-step flow can use them, but nothing in this pass silently commits to that policy.
- **`payment_terminals` extends `devices`, it does not duplicate it.** `devices.device_type` gained a new `'card_terminal'` value (an additive migration); `payment_terminals` is a 1:1 scoped-FK extension carrying only payment-specific attributes (`provider`, `provider_terminal_id`, `capabilities`, a payment-readiness `status`), matching the same "attributes of a concrete X live in X's own table" pattern already used for `product_prices` against `products` (§14.1/§14.2). Device identity, connectivity (`last_seen_at`), and revocation stay exactly where they already lived.
- **`payments.sale_reference` is not a foreign key.** The `sales` domain (E073) does not exist in this schema yet, and building it was explicitly out of scope for this task. The column is an unenforced placeholder reserved for that future FK — payments are still fully tenant/branch-isolated today through their own real `company_id`/`branch_id` scoped columns, which do not depend on a `sales` row existing.
- **Idempotency, audit, and outbox reuse the established pattern exactly** — a tenant-scoped `Idempotency-Key` bound to operation + request hash (ADR-0005), `pg_advisory_xact_lock`-guarded, with the business effect, audit row, idempotency outcome, and outbox event committed in one PostgreSQL transaction. A duplicate provider callback is made safe two ways: the general idempotency mechanism (an exact-duplicate request replays its prior result) and a database-level `unique(company_id, provider_reference)` constraint on `payment_attempts`, so even a callback arriving under a different idempotency key can never be recorded against two different attempts.
- **Outbox events reuse the canonical catalogue** (§11.7): `payment.recorded` on creation, `payment.status_changed` on every attempt transition (including a retry) and on cancellation, `payment.reversed` on reversal. No new event type is introduced.
- **Realtime delivery is honestly incomplete.** REALTIME_EVENTS.md's WebSocket protocol is designed but has no server implementation in this repository yet (confirmed by inspection — no `realtime`/`websocket` module exists). This ADR does not build one. Every state transition still writes a correct, real outbox row a future publisher can deliver unchanged; until that publisher exists, a client must poll `GET /payments/{id}` for status. REALTIME_EVENTS.md §3's own rule — the outbox carries only committed facts, never pending/intent UI state — is exactly why each terminal-interaction step is modeled as its own small committed `payment_attempts` transition rather than an unpersisted push.
- **Money is `numeric(19,4)` / decimal-string, identically to ADR-0001**, reusing `normalizeMoneyAmount`/`normalizeCurrencyCode` from `@asone/database` rather than duplicating them. A payment amount must additionally be strictly positive — a payments-only rule enforced in the service layer (`amount > 0`), not a change to the shared money normalizer, since a genuinely free line item (ADR-0001-legal `0.0000`) is a valid catalog price but never a valid payment.
- **Permissions are reused exactly as already reserved**: `payment.create` for creating a payment, retrying an attempt, transitioning an attempt, and cancelling a still-pending payment (cancellation is the create-side actor's own control, mirroring how the payment state machine has no distinct `cancelled` payment status — a cancelled payment maps to the machine's own `failed`, with an explicit reason code); `payment.read` for reads; `payment.reverse` only for `POST /payments/{id}/reversals`, matching E080 exactly; `device.register`/`device.read` for the terminal registry, since a payment terminal is a device. No new permission code was created.
- **No card PAN, CVV, or raw magnetic-stripe data is stored anywhere in this schema.** `payment_attempts.metadata`/`provider_reference` are the only free-form fields a provider integration could misuse, and are documented as safe-data-only (never a place to put cardholder data) for any future adapter.

## Alternatives considered

- **A parallel `payment_intents` table disconnected from the canonical `payments`.** Rejected: the contract already designed `payments` for this exact purpose; a second table would fork the future `sales` integration into two incompatible models.
- **Mutating one `payments` row's provider fields on every retry.** Rejected: loses the evidence of what was actually attempted and reported back, which the task explicitly asked to preserve via a child attempt entity.
- **A full temporal authorize/capture split as the only supported path.** Rejected: the contract explicitly leaves this as an open decision; committing to a two-step flow now, with no real provider evidence, would be exactly the "implementers must not choose silently" the contract itself warns against (§24).
- **A brand-new device-identity table for terminals.** Rejected: `devices` already models identity, branch scope, status, and connectivity generically; duplicating it would diverge from the existing device-registration/revocation flow (E034–E037) for no benefit.

## Consequences

Provider adapters (a future `createIntent`/`sendToTerminal`/`getStatus`/`cancel`/`refund`-shaped interface) can be built against `payment_attempts` transitions without any schema change. Building the real `sales` domain later will need one additive migration to turn `payments.sale_reference` into a real scoped foreign key plus backfill. Until a WebSocket publisher exists, POS clients must poll for payment status; this ADR does not implement that publisher. Authorize-then-capture support exists structurally but is unexercised until a real provider requires it and a follow-up ADR resolves open decision #7 for that provider.

## Validation

Integration-tested against real PostgreSQL: tenant isolation, branch isolation, amount/currency validation, idempotent payment and terminal creation, duplicate provider-reference protection, idempotent duplicate-callback replay, every legal and forbidden attempt transition (including the cash direct-to-approved path and the backwards-transition prohibition), approval/decline/cancellation/timeout, retry-attempt behavior (including replay), terminal branch/type ownership, reversal (including double-reversal and too-early-reversal rejection), malformed provider data, and atomic audit/outbox emission. Route-level tests cover permission wiring (`device.register`/`device.read`/`payment.create`/`payment.read`/`payment.reverse`), the mandatory `Idempotency-Key` header, and idempotent-replay header propagation.

## References

- [API contracts §16, §17, §21.3, §24](../API_CONTRACTS.md)
- [Realtime events §3, §11.7](../REALTIME_EVENTS.md)
- [ADR-0001](ADR-0001-money-and-rounding.md)
- [ADR-0002](ADR-0002-uuid-strategy.md)
- [ADR-0005](ADR-0005-idempotency-and-outbox.md)
- [ADR-0006](ADR-0006-tenant-isolation.md)
