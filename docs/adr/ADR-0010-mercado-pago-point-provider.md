# ADR-0010: Mercado Pago Point provider adapter

- Status: Accepted
- Date: 2026-09-05
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0008, ADR-0009)

## Context

Mercado Pago has been explicitly selected as AS POS's payment provider for Mexico — the first provider selection in this task arc; ADR-0008 deliberately left this open ("Provider Integration Readiness," item 7 of §24). TASK 12.4B.1 builds the concrete `MercadoPagoPointProvider` adapter on top of the already-approved `Sale → Payment → PaymentAttempt → PaymentTerminal` architecture, using Mercado Pago's **current** Point + Orders API integration (Mercado Pago migrated Point onto the Orders API in July 2025; this is not the deprecated Point Payment Intents API).

## Decision

### Official contracts reconciled (not invented)

Researched directly against current official Mercado Pago developer documentation (mercadopago.com.mx/developers) before writing any code:

- **Create order**: `POST https://api.mercadopago.com/v1/orders`, `type: "point"`, `external_reference` (≤64 chars), `transactions.payments[].amount`, `config.point.terminal_id`, optional `expiration_time` (default 15 min) and `description`. Requires `Authorization: Bearer <token>` and `X-Idempotency-Key` (UUID v4). Mercado Pago pushes the order to the terminal automatically on success (still `status: "created"` in the response — never approved by creation alone).
- **Get order**: `GET /v1/orders/{id}` — full order + `transactions.payments[]`/`transactions.refunds[]`. "This request will only allow you to query orders created less than 3 months ago."
- **Cancel order**: `POST /v1/orders/{id}/cancel` — only legal while `status: "created"`; once `at_terminal`, cancellation must happen on the device itself.
- **Refund order**: `POST /v1/orders/{id}/refund` with `X-Idempotency-Key` — empty body for a full refund, `{"transactions":[{"id","amount"}]}` for partial. Refunds permitted up to 90 days after payment.
- **List terminals**: `GET /terminals/v1/list?store_id=&pos_id=` → `{data:{terminals:[{id,pos_id,store_id,external_pos_id,operating_mode}]}}`. `operating_mode` is `PDV | STANDALONE | UNDEFINED`; only `PDV` terminals accept API-driven orders, and each point-of-sale allows exactly one PDV-mode terminal. Only NEWLAND_N950 and PAX_A910 terminals are supported.
- **Order/transaction status** (`docs/mp-point/resources/status-order-transaction`): the exact table this ADR's status mapping implements — see below.
- **Webhooks**: subscribe to the `Order (Mercado Pago)` topic. Notification envelope: `{action: "order.action_required", type: "order", data: {id: "<order_id>"}, ...}` — `action` strings beyond `order.action_required` were not exhaustively documented anywhere reconciled for this task, which is exactly why this integration never branches on `action` at all (see "Webhook endpoint" below). Must respond HTTP 200/201 within 22 seconds.
- **Signature verification**: `x-signature` header is `ts=<ms-timestamp>,v1=<hex-hmac>`; the signed template is `id:<data.id lowercased>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256 keyed by the webhook secret from *Your integrations → [app] → Webhooks → Configure notifications*.
- **Test mode**: test Access Tokens from *Your integrations → Application details → Tests → Test credentials*. A December 2025 **Simulate order status** endpoint (`POST /v1/orders/{id}/events`, body `{status, payment_method_type?, payment_method_id?, installments?, status_detail?}`, `204` on success) lets the entire create-order → webhook → settle flow be exercised end-to-end **without a physical terminal**.
- **Idempotency**: `X-Idempotency-Key` required on POST; a reused key with a *different* body is rejected — send a new key. Same key + same body replays safely.

### Provider adapter architecture

`PaymentProvider` (`providers/payment-provider.ts`) is the concrete provider-neutral interface ADR-0008 only described conceptually — `createOrder`/`getOrder`/`cancelOrder`/`refund`/`listTerminals`, using Mercado Pago's own Orders-API vocabulary rather than the task's more generic suggested names, since that vocabulary is what any second provider would also need to speak in some form. `MercadoPagoPointProvider` implements it, backed by `MercadoPagoClient` (`mercado-pago.client.ts`) — the *only* place the Access Token is read or attached (Node's global `fetch` + `AbortController`, no new HTTP dependency; timeouts, sanitized errors, `X-Idempotency-Key` per mutating call, never logs the token or a response body field that could carry cardholder data). A separate, non-production `MercadoPagoPointTestHelper` wraps the Simulate-order-status endpoint; it refuses to construct or run when `nodeEnv === 'production'`, and — decisively — is never referenced anywhere in `register-plugins.ts`'s production wiring at all.

### Terminal mapping — reused, not extended

ADR-0008 already gave `payment_terminals` a `provider`/`provider_terminal_id` pair scoped to `(company_id, branch_id)` via the existing `devices` table. This task activates that design rather than changing it: a terminal becomes a real Mercado Pago terminal purely by being registered with `provider: 'mercado_pago'` and a real `provider_terminal_id` (the Point terminal id from `GET /terminals/v1/list`) — no schema change, no new table.

### Create-order flow — dispatch outside the transaction

`PaymentService.createPayment`/`retryAttempt` insert the payment/attempt exactly as ADR-0008 already did (transaction commits, attempt `created`). A new `dispatchAttemptToProvider` step runs **after** that transaction commits — an outbound HTTP call must never hold a database connection/lock open — and only when `payment.paymentMethod === 'card_terminal'` and the resolved terminal's `provider === 'mercado_pago'`:

1. Re-fetches the attempt; a no-op unless it is still `created` (this alone makes dispatch safe to call on an idempotent-replay of `createPayment`, with no special-casing needed).
2. Calls `MercadoPagoPointProvider.createOrder` with the backend-authoritative `payment.amount`/`currencyCode` (never a client-supplied value) and the terminal's `provider_terminal_id`.
3. Folds the result back through the **existing, already-tested** `transitionAttempt` state machine — `created → awaiting_terminal` with `providerReference` set to the Mercado Pago order id, never `approved`. A provider error (network/4xx/5xx/timeout/rate-limit) instead transitions the attempt straight to `failed` with a classified, non-leaking decline reason (`provider_error:<code>`), leaving `retryAttempt` free to create a fresh attempt.

No new state-mutation logic was written — `dispatchAttemptToProvider` is pure orchestration over methods ADR-0008 already built and tested.

### Mercado Pago → AS state mapping (`mercado-pago.status-mapping.ts`)

| Mercado Pago order/transaction | AS `PaymentAttemptStatus` | Notes |
| --- | --- | --- |
| `created` | `created` | No AS transition needed — the attempt was already `created` before dispatch. |
| `at_terminal` | `processing` | Captured by the terminal, interaction underway. |
| `action_required` (`waiting_payment` / `check_on_terminal`) | `processing` | No new AS state invented — the raw detail is preserved in the attempt's own `metadata`, not promoted to a new canonical name. |
| `processed` + transaction `processed`/`accredited` **and** `paid_amount` exactly equals the expected amount | `approved` | **The only path to `approved`.** |
| `processed` with any other `status_detail` (e.g. `partially_refunded`) | *(falls through, never `approved`)* | The task explicitly forbids treating every `processed` order as approved — order-level `processed` alone is insufficient. |
| `failed` | `declined` | The provider's own `status_detail` (one of 11+ documented subtypes) is passed through verbatim as the decline reason — never reworded. |
| `canceled` | `cancelled` | |
| `expired` | `timed_out` | |
| unrecognized status | `declined` | Never a silent approval; the raw value is preserved in the decline reason for investigation. |

Approval requires **all three** of transaction `status: 'processed'`, `status_detail: 'accredited'`, and an exact `paid_amount` match against `payments.amount` — inspecting `status`, `status_detail`, and `paid_amount` exactly as instructed, never trusting order-level status alone.

### Webhook endpoint

`POST /api/v1/webhooks/mercado-pago`, registered in its own encapsulated Fastify context so its raw-string content-type parser (needed to hash the *exact* bytes Mercado Pago sent) never touches any other route's normal JSON parsing.

1. Verifies `x-signature`/`x-request-id` against the configured webhook secret (HMAC-SHA256, `timingSafeEqual`) — rejects with 401 on any failure, including "not configured."
2. Extracts `data.id` (the order id) only — **never branches on `action`**, since the full enumeration of `order.*` action strings was not confirmed anywhere in current official documentation; this is also exactly what the docs themselves recommend regardless (see below).
3. Resolves which AS company/branch/attempt this order belongs to via `PaymentRepository.findAttemptCompanyByProviderReference` — the one deliberately unscoped lookup in this codebase, safe because `provider_reference` is Mercado Pago's own unguessable, globally-unique order id, never exposed to Flutter, and every subsequent operation uses *that row's own* real `company_id`/`branch_id`, never anything the webhook body itself supplied.
4. Re-fetches the order via `GET /v1/orders/{id}` — official guidance explicitly says to do this rather than trust notification fields ("send a GET to /v1/orders/{id} to get all information about the notified resource").
5. Maps the authoritative order through the table above and applies it via the **same** `transitionAttempt` the API routes use — inheriting version-locking, terminal-state protection, and idempotency for free. `actorType: 'system'` records that no human performed this transition (`audit_log.actor_type` — already had a `'system'` value; only `payments.repository.ts`'s `auditAndPublish` needed a small extension to stop hardcoding `'user'`).
6. Always responds within the 22-second budget; a duplicate/late webhook for an already-terminal attempt, or a race where `transitionAttempt` reports `invalid_attempt_state`, is treated as a benign no-op (200) — never an error, never a duplicate capture. Any other failure propagates as a 5xx so Mercado Pago retries.

### Duplicate webhooks — proven, not assumed

Three independent layers make a repeated notification safe: (a) `transitionAttempt`'s own idempotency key (`mp-webhook:<order_id>:<mapped_status>`), (b) its terminal-state guard (an attempt that already reached `approved`/`declined`/... accepts no further transition), (c) the webhook route's own current-status check before ever calling `transitionAttempt`. Integration-tested directly (§ Tests below).

### Cancel/fail/expire

Mapped to AS's existing terminal states (`cancelled`/`declined`/`timed_out`) exactly as ADR-0008 already made irreversible — once an attempt reaches a terminal state, nothing in this task (or ADR-0008) ever transitions it again; a retry always creates a new attempt row.

### Refund readiness

`MercadoPagoPointProvider.refund()` is implemented and tested at the adapter/contract level (full and partial request shapes, response decoding) but **deliberately not wired into `PaymentService.reversePayment`** in this pass — reversal today remains local-only, unchanged from ADR-0008. Wiring the adapter into the live reversal path needs its own decision about partial-refund semantics against a Sale/its line items, which is out of this task's scope ("do NOT build a fake refund UI yet").

### Security / PCI boundary

- Access Token and webhook secret: read only inside `MercadoPagoClient`/the webhook route, from `ApiConfig` (env-var-sourced, optional — see Configuration), never returned in any API response, never sent to Flutter.
- No PAN, CVV, or track data anywhere: Mercado Pago's own Orders API response never includes them (`card.first_digits`/`card.last_digits` only), and no field in this integration's own types could carry one.
- Signature verified with `timingSafeEqual`; replay is bounded by the same idempotency/terminal-state protections as duplicate webhooks.
- Server-authoritative amount: `createOrder`'s `amount` is always `payments.amount`, itself already validated at payment-creation time (ADR-0008) — Flutter never supplies (and the backend never accepts from Flutter) the amount sent to Mercado Pago.
- Terminal ownership: `dispatchAttemptToProvider` only ever uses the `terminal_id` already resolved and branch-checked by `createPayment`'s own existing validation (ADR-0008) — no new trust boundary introduced.

### Configuration

`MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` (both optional — `z.string().min(1).optional()`), `MERCADO_PAGO_API_BASE_URL` (defaults to `https://api.mercadopago.com`) added to `@asone/config`'s `apiSchema`. The app boots with none of them set; only an actual `card_terminal` dispatch against a `mercado_pago` terminal fails, cleanly, with `PaymentProviderError('not_configured', ...)`. No secret has a committed value — `.env.example` documents the variable names with blank/default-only values.

### Realtime / polling decision

No WebSocket publisher exists (TASK 12.4A's own finding, unchanged). Flutter polls `GET /api/v1/payments/{id}` — never Mercado Pago directly — every 2 seconds for up to 90 seconds after creating a `card_terminal` payment, stopping on any terminal attempt status or the timeout (an honest "tiempo agotado" message, never a fabricated decline). This is the explicit interim mechanism the task asked for; no new realtime platform was built.

## Alternatives considered

- **Branching webhook logic on the notification's `action` field.** Rejected: the full enumeration of `order.*` action strings is not confirmed in current official documentation, and Mercado Pago's own guidance is to re-fetch the order regardless — branching on an incompletely-documented field would be exactly the kind of unreconciled invention this task forbids.
- **Approving on order-level `status: 'processed'` alone.** Rejected explicitly by the task; `partially_refunded` and other non-`accredited` details share the same order-level `processed` status.
- **A new `payment_terminals`-adjacent table for Mercado Pago-specific fields.** Rejected: ADR-0008's `provider`/`provider_terminal_id` columns are already sufficient; no official Mercado Pago data needs a dedicated table.
- **Calling Mercado Pago from inside the same DB transaction as payment creation.** Rejected: an external HTTP call must never hold a transaction/connection open; dispatch runs after commit and re-uses the existing, already-transactional `transitionAttempt` for its own state change.
- **Wiring `refund()` into `reversePayment` now.** Rejected — deferred; see "Refund readiness."

## Consequences

AS POS can now create a real Mercado Pago Point order, receive its authoritative result via webhook (with GET-based re-verification), and settle the owning Sale through the already-approved TASK 12.4A.1 coordination — all without a chosen provider having existed before this task. The full flow (including settlement) is provably exercisable in this repository with zero physical hardware, via the Simulate-order-status test helper and this task's own integration tests. Physical-terminal end-to-end testing still requires the manual Mercado Pago account/terminal setup listed in the final report's "Physical-terminal readiness" section, and explicit approval before it begins.

## Validation

Unit-tested: the status-mapping table (every row above, plus amount-mismatch and unrecognized-status cases), webhook signature verification (valid/invalid/malformed/unconfigured), the HTTP client (timeout/network/malformed-body/429/4xx/5xx, token never logged or leaked into a thrown error), and the provider adapter's exact request shapes (create/get/cancel/refund/list, fresh idempotency key per order, non-MXN rejected pre-request). Integration-tested against real PostgreSQL with an injected fake Mercado Pago HTTP layer: dispatch → `awaiting_terminal` with the provider order id persisted (never approved by creation alone), terminal branch-ownership enforcement, dispatch failure → clean `failed` attempt → successful retry, rate-limit handling, no duplicate provider order on an idempotent AS-side replay, and the full dispatch → authoritative-accredited-mapping → `approved` → Sale-settled path, plus the amount-mismatch-blocks-approval case. Route-level webhook tests (mocked service/provider) cover valid/invalid signatures, never-approve-on-order-processed-alone, duplicate/already-terminal handling, a concurrent-race `invalid_attempt_state` treated as benign, a genuine failure propagating as 5xx, and a malformed body. Flutter widget tests prove the full CAJERO/CLIENTE dispatch-and-poll UI: honest intermediate labels, "Pago aprobado" only after the backend's own `approved`, and a declined outcome reported honestly.

## References

- [Mercado Pago Point payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing)
- [Mercado Pago Orders API — Get order](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/get-order/get)
- [Mercado Pago Orders API — Refund order](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/refund-order/post)
- [Mercado Pago Point terminals — Get terminals](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/terminals/get-terminals/get)
- [Order and transaction status reference](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction)
- [Checkout API Orders — Notifications](https://www.mercadopago.com.mx/developers/en/docs/checkout-api-orders/notifications)
- [Webhook signature validation](https://www.mercadopago.com.br/developers/en/docs/mp-point-legacy/additional-content/your-integrations/notifications/webhooks.md)
- [Simulate order status (Point)](https://www.mercadopago.com.br/developers/en/news/2025/12/12/New-endpoint-to-simulate-order-statuses-in-Mercado-Pago-Point)
- [Transform your point of sale with the new integration between Point and the Orders API](https://www.mercadopago.com.ar/developers/en/news/2025/07/16/Transform-your-point-of-sale-with-the-new-integration-between-Point-and-the-Orders-API)
- [ADR-0001](ADR-0001-money-and-rounding.md)
- [ADR-0005](ADR-0005-idempotency-and-outbox.md)
- [ADR-0006](ADR-0006-tenant-isolation.md)
- [ADR-0008](ADR-0008-payment-and-terminal-foundation.md)
- [ADR-0009](ADR-0009-sale-foundation.md)
