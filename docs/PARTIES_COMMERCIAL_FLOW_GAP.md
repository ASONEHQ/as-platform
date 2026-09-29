# Parties Commercial Flow — Architecture Gap (TASK 17.5)

Audit-only document. Nothing in this file was implemented by TASK 17.5 — every item
below either requires a business-rule decision, a schema change, or both, and per
this task's own migration rule, no migration was created.

## Quotation

### Current state: intentionally ephemeral (not a bug)

There is **no** `quote`/`cotización` table. `POST /api/v1/party-packages/:id/quote`
is documented and implemented as a pure, stateless calculation — "never persists
anything" (`party-packages.routes.ts:365-368,385-394`). The Flutter `_Cotizador`
screen calls it, shows the itemized breakdown, and either discards it or the user
taps "Convertir a reservación," which creates a **new** `party_reservations` row
directly (`pos_shell.dart:28379-28384,30608`) — it never "promotes" a saved quote,
because there is no saved quote to promote.

**This matches the code's own stated design intent** and is classified `G`
(intentionally unavailable as a persisted entity) rather than a gap to close by
default.

### If "save a quotation" becomes a real product requirement — FOLLOW-UP (F)

**Why current model is insufficient:** nothing survives between opening the
Cotizador and confirming a reservation; a salesperson cannot email/print a
quotation, come back the next day, and convert the *same* quote without re-entering
every input.

**Proposed design:**
- New table `party_quotes`: `id`, `company_id`, `branch_id`, `customer_id`
  (nullable FK), `seller_membership_id` (nullable FK, mirrors
  `party_reservations.sellerUserId`'s existing pattern), `package_id`, `event_date`,
  `event_time`, `guest_count`, `line_items` (jsonb — the real itemized breakdown
  the `/quote` endpoint already computes), `subtotal`, `total`, `status`
  (`draft`/`expired`/`converted`), `expires_at` (nullable), `converted_reservation_id`
  (nullable FK, set on conversion), `created_by`, `created_at`.
- **Indexes:** `(company_id, status)`, `(company_id, expires_at)` for an expiry
  sweep.
- **State machine:** `draft → converted` (sets `converted_reservation_id`, becomes
  read-only) or `draft → expired` (time-based or manual).
- **API impact:** `POST /party-quotes` (persist what `/quote` already computes),
  `GET /party-quotes/:id`, `POST /party-quotes/:id/convert` (creates the reservation
  the same way today's flow does, then links back).
- **Business decision needed first:** does a quote expire automatically, and after
  how long? Can a quote be edited after saving, or must a new one be created?

## Quotation print/PDF

**Current state:** no quotation-specific document exists. Waiver/contract HTML
documents for a **confirmed** reservation already exist
(`GET /party-reservations/:id/documents/:type`, `party-reservations.routes.ts:931-942`)
and are opened via the same `openReceiptPrintWindow` browser-print pattern the rest
of the app uses for receipts (`pos_shell.dart:32037-32049`). Classification: **B**
(infrastructure and pattern exist; no analogous "quotation summary" document type).

**If quote persistence (above) ships**, a quotation PDF becomes straightforward
(**D** on top of it): reuse the exact same HTML+print pattern with the real
package/customer/line-item/total data the saved quote already holds, plus real
branding from Configuración (never a hardcoded tenant name). Until quote
persistence exists, printing an *ephemeral* Cotizador session is possible today
(the numbers are real, just not saved) but was not built this pass — flagged as a
smaller, independently-shippable feature if "save" is deferred but "print what's on
screen right now" is wanted sooner.

## Payments — the central finding

**Party payments have no payment-method field at all.** `party_reservation_payments`
(`packages/database/src/schema/parties.ts:679-718`) only has `purpose`
(`deposit`/`balance`/`additional`) and `amountSnapshot` — no `cash`/`card`/`transfer`
column, no check constraint for one. `POST /party-reservations/:id/payments` only
accepts `purpose`, `amount`, `cash_session_id`. The service hardcodes
`movementType: 'cash_in'` on every payment regardless of how the money actually
arrived (`party-reservations.service.ts:1352-1367`).

**This means: today, every party payment is recorded as cash, full stop.** There is
no card option and no transfer option to mis-represent — the Flutter "Registrar
pago" dialog (`_RecordPaymentDialog`, `pos_shell.dart:30894-31052`) is honest about
this: it only ever shows a purpose dropdown + amount field, never a
Tarjeta/Transferencia selector, because the backend has nothing for such a selector
to call.

### Adding card/transfer as a recorded (non-processed) method — FOLLOW-UP (F)

**Why current model is insufficient:** a schema change is required — there is no
column to extend.

**Proposed design:**
- Add `method` to `party_reservation_payments`: `text not null default 'cash'`,
  check constraint `in ('cash', 'card', 'transfer')`.
- Add nullable `reference` (text) for a transfer folio/bank reference.
- **Business decision needed:** how does a non-cash party payment interact with
  cash-session accounting? Today every payment posts a `cash_in` cash movement —
  should a card/transfer payment post *no* cash movement (since no cash physically
  entered the drawer), or a differently-typed movement? This is not a cosmetic
  question — it directly affects whether a cashier's end-of-day cash count still
  reconciles correctly. **Do not add a method selector to the UI before this is
  decided** — it would either silently miscount the drawer or require rebuilding
  the cash-session posting logic at the same time.
- **Real processor integration already exists** for the general Cobrar/sales flow
  (MercadoPago Point — `apps/api/src/modules/payments/register-plugins.ts:91-93,402-434`).
  Wiring party card payments to actually *process* a card (not just record one)
  would mean routing through that same integration — a materially larger
  workstream than adding a `method` column, and should be scoped as its own
  decision: does the business want parties to process cards live, or only ever
  record what a separate terminal/device already charged? **Never invent a new
  processor (Stripe/Clip/Conekta/etc.) — only the existing MercadoPago Point
  integration is real.**

### Payment history list endpoint — FOLLOW-UP (E, no migration)

`PartyReservationsService` already has a working `paymentsForReservation` query
internally (used to compute the balance); there is simply no route exposing the
individual rows (method/amount/date/recorded-by) — only the aggregate
`{ totalPaid, count }`. Adding `GET /party-reservations/:id/payments` is a
straightforward additive route, no schema change.

### Payment reversal/refund — FOLLOW-UP (E leaning F)

No reversal mutation exists for a party payment today; cancelling a reservation
with prior payments deliberately does **not** auto-refund
(`party-reservations.service.ts:793-798,824-826` — "a manager handles any actual
refund" outside this module, confirmed by its own integration test). A same-module
reversal would reuse the existing cash-movement reversal primitives
(`party-sock-deduction.ts:80-82`'s pattern is the closest precedent) but still needs
a business decision on who may reverse a payment and under what conditions before
it's built.

## What is already correct and should not be touched

- **Balance (total/paid/pending):** genuinely server-authoritative
  (`PartyReservationsService.balance()`, `party-reservations.service.ts:1397-1422`);
  Flutter only displays it, never recomputes.
- **Idempotency:** every payment mutation is idempotency-keyed
  (`party-reservations.service.ts:1315-1324`).
- **Audit:** every payment is audit-logged
  (`party_reservation.payment_recorded`, `party-reservations.service.ts:1380-1390`).
- **Customer + seller identity:** both already modeled directly on
  `party_reservations` (`customerId`, `sellerUserId`) — no gap here.
