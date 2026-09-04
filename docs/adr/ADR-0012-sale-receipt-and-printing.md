# ADR-0012: Sale receipt data and browser print foundation

- Status: Accepted
- Date: 2026-09-03
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0008, ADR-0009, ADR-0011)

## Context

TASK 12.5A completed a real cash sale end-to-end but stopped short of a printable receipt — its cash-payment response embeds only a small, cash-specific sale summary (`saleReceiptHttp` in `payments.routes.ts`) meant for TASK 12.5B to build on, not a general-purpose receipt. TASK 12.5B needs a receipt that (a) is reproducible later purely from persisted backend data — never the in-memory `SaleSession`, which TASK 12.5A already clears on success — and (b) can be printed from Flutter Web without depending on any proprietary printer SDK.

Reconciliation against the existing architecture found:
- `sale_items`' snapshot columns (`name_snapshot`, `sku_snapshot`, `unit_price`, line totals) were already frozen at sale-creation time by TASK 12.4A.1 specifically so a later catalog change never rewrites history — exactly the guarantee a receipt needs, already built.
- `payments.metadata` already carries `tendered_amount`/`change_amount` for a cash payment (TASK 12.5A) — the receipt's cash section needs no new storage.
- `docs/CORE_DATA_MODEL.md`/`companies` and `branches` carry no RFC/tax-id column at all (confirmed by inspection) — there is no canonical fiscal identifier to include, and none is invented here.
- AS POS V1's own `imprimirTicketActual()` (`AS POS V1.html`) is the direct visual/behavioral reference: it opens a **new, blank browser window/tab** containing a self-contained, monospace, dashed-divider ticket document and calls that window's own `print()` — never `window.print()` on the running app itself. This is adopted verbatim as the mechanism (see "Printing" below), not just the visual style.
- No `product_prices`/`products` history table exists, and none is needed — the frozen `sale_items` snapshot already *is* the historical record.

## Decision

### Receipt source of truth — composed, not stored

No new receipt table. `GET /api/v1/sales/{sale_id}/receipt` composes its response entirely from already-persisted, already-authoritative rows, read fresh on every call:
- `sales` + `sale_items` (via the existing `SalesService.sale`) — sale header/totals and the frozen item snapshot.
- A new, minimal `SalesRepository.receiptOrganization` (one join across `companies`/`branches`/`users`) — company display name, branch name/address, and the cashier's display name (`sales.created_by`).
- `payments` (via the existing `PaymentService.listPayments`, plus `PaymentService.payment` only for a `card_terminal` leg, to read its latest attempt's `provider_reference`) — the payment/cash section.

This mirrors `payments.routes.ts`'s own existing E078 nested-route pattern of composing across `SalesService` and `PaymentService` at the route layer — just in the opposite direction. `SalesService` gained no dependency on `PaymentService`; only `sales.routes.ts` (the route-registration function) now takes a `PaymentService` argument, exactly like `payments.routes.ts` already takes a `SalesService` one.

### No status gate on read

`GET /sales/{id}/receipt` never rejects based on sale status — identical to the existing `GET /sales/{id}`. A `pending_payment` sale's receipt simply has an empty `payments` array; a `cancelled` sale's receipt reflects that status honestly. The endpoint never lies about a sale by refusing to return it; the caller (Flutter) is responsible for only ever presenting the "Venta completada" success screen for a sale it just itself completed. This was a deliberate choice over adding a new blocking error: the data is truthful either way, and REST `GET` semantics in this codebase never gate on business status (see `docs/API_CONTRACTS.md` §16's E074 — "Completed snapshot immutable" describes write-protection, not a read restriction).

### Reprint is just calling the same endpoint again

There is no separate "reprint" mutation. `GET /sales/{id}/receipt` is a plain read with zero side effects — calling it any number of times never creates a payment, mutates the sale, changes inventory, or mints a new sale number. Retrieval is idempotent by construction (no `INSERT`/`UPDATE` anywhere in its query path), proven by an integration test that calls it repeatedly and asserts the sale's version and the sale's payment count never change.

### Folio

`sales.sale_number` (already the sale's own commercial identifier, generated once at creation) is reused verbatim as the receipt's folio — no second, independent folio sequence.

### Receipt vs. CFDI — an explicit non-boundary

This is a **purchase receipt / ticket**, never represented as a Mexican tax invoice (CFDI). No SAT UUID, QR, sello, cadena original, or RFC is generated, stored, or displayed, because none of those exist anywhere in this system — `companies`/`branches` carry no fiscal-identifier column at all (verified by inspection of `packages/database/src/schema/organizations.ts`). The printed receipt's own footer explicitly states "Comprobante de compra — no es un comprobante fiscal (CFDI)" so it is never mistaken for one.

### Cash section — backend values only

The printed/previewed receipt's Efectivo section (`amount`, `tendered_amount`, `change_amount`) is read only from the persisted `payments` row's own `amount` and `metadata.tendered_amount`/`metadata.change_amount` — never recomputed from `SaleSession`, which may already be cleared (TASK 12.5A) and was never authoritative for money in the first place (ADR-0009's "server money authority").

### Card section — future-safe, never fabricated

`receiptPaymentHttp` always includes `provider`, `terminal_id`, and `provider_reference` fields in the response shape, but every one of them is read straight off a real `payments`/`payment_attempts` row — `null` for cash (structurally, since `terminal_id`/`provider` are already `null` for cash per ADR-0009), and populated only if a real `card_terminal` payment with a real captured/approved attempt exists. Since Mercado Pago remains paused (TASK 12.4B.2), no such payment exists anywhere in this system today, so these fields are simply always `null` in practice — never a placeholder standing in for data that doesn't exist. When Mercado Pago setup resumes, this shape already accommodates its safe fields with zero schema or DTO redesign.

### Printing — a new, self-contained document, not `window.print()` on the app

Flutter Web renders through CanvasKit/Skwasm (a single `<canvas>`), so there is no DOM subtree a CSS `@media print` rule could selectively hide — calling `window.print()` on the running app would print the sidebar/navigation/buttons along with everything else, which the task explicitly forbids. The adopted mechanism instead mirrors AS POS V1's own `imprimirTicketActual()` exactly: a pure-Dart function renders the receipt as a **self-contained HTML string** (no Flutter widget tree involved at all), a brand-new blank browser tab/window is opened via `package:web`, that string is written into it, and that window's own `.print()` is called. The sidebar/navigation/buttons are structurally absent from the generated HTML — not hidden by CSS — so nothing Flutter itself renders can ever leak into the printed page, and a popup-blocked failure is reported honestly rather than silently swallowed.

`package:web` (the official `dart:js_interop`-based replacement for the deprecated `dart:html`) is used rather than a proprietary printer SDK, wired through a conditional export (`receipt_print.dart` exporting either `receipt_print_web.dart` or a VM-safe `receipt_print_stub.dart`, selected by `dart.library.js_interop`) so `flutter test` — which runs on the Dart VM, where no browser APIs exist — never fails to compile.

### 80mm target, 58mm-ready

The generated HTML sets `@page { size: <width>mm auto; margin: 3mm }` and a matching content width, driven by a single `paperWidthMm` parameter (default `80`). Monochrome, `Courier New`/monospace typography (matching V1's own ticket font exactly), dashed section dividers, a tabular-numeric right-aligned amount column so totals align, and `word-break`-safe item-name cells so a long name wraps instead of clipping or overflowing the page. 58mm support is therefore a one-line change (passing `paperWidthMm: 58`) whenever it is actually requested — not built now, since only 80mm was asked for.

### Branding

The receipt header reuses the already-bundled `assets/branding/as_logo_mark.png` (via the existing `StartupLogoMark` widget's own asset path) as a temporary presentation fallback — no second copy of the logo is stored, and no filesystem path from a developer machine is embedded anywhere. `companies` has no branding/logo column today, so per-company branding is explicitly deferred: a future task must add a company-level logo/branding configuration (likely alongside the already-existing `admin/settings` module) before receipts can show a real per-tenant brand instead of the shared AS app mark.

### Permissions/isolation

`sale.read` — the identical permission `GET /sales/{id}` already requires, no new permission code. Tenant isolation is enforced the same way `sale()` already enforces it (`company_id` in every query); branch isolation the same way (`branchIds.includes(sale.branchId)`, already inside `SalesService.sale`).

## Alternatives considered

- **A dedicated `receipts` table, generated once at sale completion.** Rejected: a second source of truth for the exact same facts `sales`/`sale_items`/`payments` already hold durably, with no benefit — nothing about a receipt needs to be generated ahead of the request, and composing on read is trivially cheap (a handful of indexed lookups).
- **`window.print()` on the running Flutter app, hiding chrome via widget visibility during a "print mode."** Rejected: CanvasKit/Skwasm renders one canvas — there is no way to guarantee only the intended subtree rasterizes to the printed page, and a moment of hidden-but-still-present navigation is a real risk of leaking UI into a physical printout.
- **A proprietary/native thermal-printer plugin.** Rejected outright by the task; the browser's own print dialog is the explicit, sufficient foundation for this pass.

## Consequences

- Positive: zero new database migrations; the receipt is always exactly as current as the underlying `sales`/`sale_items`/`payments` rows, with no separate write path to keep in sync.
- Positive: printing works identically in every browser that implements `window.open`/`window.print`, with no plugin or native dependency.
- Negative / accepted cost: a popup-blocked browser will fail to open the print window — reported honestly to the cashier (not silently retried or worked around), matching the task's "never silently select or control a printer" instruction.
- Deferred: per-company branding (needs a new `companies` column/settings key), 58mm paper (structurally ready, not requested), and any card/Mercado Pago receipt content beyond the already-safe fields this DTO already reserves.

## Validation

Backend: `sales.integration.test.ts`'s new `describe('receipt', ...)` — a completed cash sale composes into a full receipt; a product rename/price change after the sale never changes the frozen item snapshot; cash tender/change come from the real persisted payment metadata, never recomputed; correct subtotal/tax/total; correct cashier/branch/company via `receiptOrganization`; tenant isolation (a foreign company's lookup finds nothing) and a nonexistent sale (both null/`resource_not_found`); branch isolation; a `pending_payment` and a `cancelled` sale both return honest data, never an error; repeated retrieval is read-only — the sale's version and its payment row count never change across repeated calls. `sales.routes.test.ts` covers the HTTP layer: `sale.read` permission enforcement, and that a `card_terminal` payment's attempt is fetched exactly once per such payment while a `cash` payment never triggers that extra lookup.

Flutter: the completed-sale success screen shows the backend's own folio/total/cambio, opens the print window, "Nueva venta" clears it and returns to an empty ticket, a backend receipt-fetch failure is shown honestly without blocking retry, and CLIENTE's own success behavior is explicitly evaluated (see the final report).

## References

- `docs/API_CONTRACTS.md` §16 (E073–E080, §16.7 for this addition), §6.6/§21.2 (sale/item field lists).
- `docs/CORE_DATA_MODEL.md` (confirms no fiscal-identifier column exists on `companies`).
- ADR-0008 (payment/attempt state machine, the safe provider fields), ADR-0009 (sale foundation, item snapshot columns), ADR-0011 (cash payment metadata this receipt reads).
