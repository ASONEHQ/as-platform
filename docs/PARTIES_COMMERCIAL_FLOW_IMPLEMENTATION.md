# Parties (Fiestas) Commercial Flow — Implementation (TASK 17.6)

What the Fiestas commercial flow **is today**: persisted quotations, an explicit
quote → reservation conversion, a printable quotation, and a payment ledger with
methods, history and voids. It supersedes the corresponding findings of
`PARTIES_COMMERCIAL_FLOW_GAP.md` (TASK 17.5). Anything not listed under
*Implemented* is not implemented.

Commits: `7586eb3` (quotations), `bb91113` (payment ledger), `231b1f6` (Flutter),
all local to `release/as-pos-v1`; nothing pushed or deployed.

## 1. What existed before

- The Cotizador computed a price and **discarded it**: nothing was saved, so a
  quote disappeared on reload and could not be printed or reopened.
- A reservation could only be created from scratch; its price was computed from
  the *live* package at creation time.
- Payments were cash-only: every payment hard-coded a `cash_in` movement into an
  open cash session. There was no payment history endpoint, no way to correct a
  mistaken payment (the generic cash reversal would have left the payment active
  while its cash disappeared), and card/transfer could not be represented.
- The client generated a new idempotency key on every call, so a double tap
  could record the same money twice.

## 2. Implemented

### Quotations (`party_quotes`, migration `0051`)

- `POST /api/v1/party-quotes` saves a quote: package, guests, extra half hours,
  optional customer / room / date / time / notes. The **server** prices it and
  freezes (a) the package terms that priced it (`package_snapshot`: name, code,
  version, prices, extras, included guests/consumables, tax code and rate) and
  (b) the amounts (`subtotal`, `discount_total`, `tax_total`, `total`,
  `breakdown`). Customer name/phone are snapshotted too.
- A later package price or name change **never** rewrites a saved quote.
- `PATCH /api/v1/party-quotes/:id` (optimistic `If-Match`) edits a **draft**.
  The quote is re-priced from the current package **only if** package, guests or
  extra time actually change; editing notes / customer / date leaves the frozen
  amounts untouched. Stale edits answer 409 `version_conflict`.
- `POST …/:id/cancel` requires a reason; the quote is kept as `cancelled`.
- `GET /api/v1/party-quotes` (cursor, newest first, filters) and `GET …/:id`.
- `GET …/:id/document` — printable HTML of the **saved** quote (frozen snapshot
  and amounts; business and branch name, folio, status, customer, seller, event
  data, line items, subtotal / discount / tax / total, notes). Every dynamic
  value is escaped. It carries no legal terms and no invented contact data. The
  PDF is the browser's print-to-PDF.
- States: `draft → converted | cancelled`. Only a draft can change.

### Explicit conversion

`POST /api/v1/party-reservations` accepts an optional `quote_id`. In **one
transaction** it locks the quote, requires `draft`, the same branch / package /
children / adults / extra half hours (otherwise `validation_error`), takes the
**frozen** amounts and package name (never the live package), plans the consumables
that were frozen, links the quote (`converted_reservation_id`) and audits
`party_quote.converted`. A partial unique index plus the row lock make a second
conversion impossible even under concurrent requests (`quote_not_editable`,
409). A failed reservation (room conflict, capacity) leaves the quote a draft.
A reservation created without `quote_id` behaves exactly as before.

**A quote is not a reservation**: saving one blocks no room, takes no stock and
records no money.

### Payment ledger (migration `0052`)

- Every payment now has a `method`: `cash`, `card` or `transfer`, an optional
  `reference` (≤ 120) and `notes` (≤ 500).
- **Cash** requires an open cash session of the same branch and still posts the
  `cash_in` movement. **Card and transfer post no cash movement and take no
  cash session** (supplying one is a validation error). They are **records of
  money the operator states was received elsewhere**: the system does not
  charge cards and does not verify transfers. The API marks them
  `recorded_only: true` and the UI says so ("Tarjeta registrada: el sistema no
  procesa ni verifica el cobro").
- `cash_movement_id` is now nullable, tied to the method by a CHECK
  (`method = 'cash'` ⇔ movement present).
- `GET …/party-reservations/:id/payments` returns the whole history, oldest
  first, voided payments included and flagged.
- `POST …/payments/:paymentId/void` (reason ≥ 3 chars) **never deletes**: the
  row keeps `voided_at / voided_by / void_reason`. Voiding a **cash** payment
  posts a compensating `cash_out` linked to the original movement through
  `reversal_of_id` (which also prevents a second reversal) into the **open
  session the operator supplies** — the drawer that physically returns the
  money, which may differ from the one that received it. Voiding a card /
  transfer payment moves no cash. A second void answers 409
  `payment_already_voided`; the idempotent replay returns the same result with
  no second reversal.
- The generic `cash_movement.reverse` now **refuses** movements that belong to a
  party payment (`cash_movement_not_reversible`) so a payment can only be
  corrected through its void.
- `GET …/balance` is server-authoritative: `total_paid` (voided excluded),
  `remaining_balance` (never negative), `overpaid_amount`, `payments_count`,
  `voided_payments_count`. `outstanding_balance` keeps its old signed meaning for
  existing clients.
- Idempotency: the Flutter client now creates **one key per submission** (kept
  across a retry of the same request, renewed when the operator changes a field),
  so a double tap or a retry after a timeout replays instead of duplicating.

### Downstream consumers

All four SQL consumers of `party_reservation_payments` were updated:

| Consumer | Rule |
| --- | --- |
| Cash close — deposits / total collected (the drawer) | active **cash** payments only (card/transfer are not in the drawer; voided are gone) |
| Cash close — collected for window-created reservations (accounts-receivable view) | active payments of any method |
| Dashboard — outstanding balances, deposits today | active payments of any method |
| Reports — event revenue | active payments of any method |

## 3. Permissions and scoping

| Action | Permission |
| --- | --- |
| Read quotes / history / balance / print a quote | `party.read` |
| Create, edit, cancel a quote; create the reservation (incl. conversion) | `party.manage` |
| Record a payment | `party.payment.record` |
| **Void** a payment | `party.cancel` (the strongest party authority that already exists; no new permission was invented) |

Scope is enforced on the server (`permittedBranchIds` from the token). A quote,
reservation or payment outside the actor's branches — or in another company —
answers 404. Creating a quote for a branch outside the scope is rejected.

## 4. Tests

- `party-quotes.integration.test.ts` — 16 tests: persistence across a fresh
  repository, snapshot immutability when the package changes, re-pricing rules,
  stale-edit guard, cancel, scope / company isolation, pagination, conversion
  (frozen amounts, duplicate protection, replay, mismatch, failed conversion),
  printable document (snapshot, escaping, audit), and the HTTP layer.
- `party-payments.integration.test.ts` — 18 tests: cash vs card vs transfer,
  validation, double submit, balance (remaining / overpaid), history, voids
  (cash compensation, wrong session, twice, replay, non-cash), generic-reversal
  guard, audit, scope isolation, downstream sums, and the HTTP layer incl.
  permissions.
- The pre-existing parties, cash, dashboard and reports suites keep passing.
- Flutter: 22 new tests in `pos_shell_test.dart` (saved quotes, conversion with
  locked pricing, payment dialog per method, stable idempotency key, history,
  voids, balance, and layout at 1440 / 1365 / 1024 / 390).

## 5. Not implemented / honest limits

- **No card processing and no transfer verification.** If either is ever
  needed it is a separate integration with its own failure states.
- Converting a quote **does not** create a payment or a deposit.
- A direct reservation from the calculator (without saving a quote first) still
  exists and does not create a quote record.
- A quote has no expiry date and no versions beyond its optimistic `version`.
- The quote document has no business address, tax id or legal terms because
  none are stored for it; adding them is a configuration decision.
- Customer selection while quoting reuses the customer picker; a quote cannot be
  created for a customer that does not exist.

## 6. Open business decisions

1. **Quote validity**: expiry date, and whether an expired quote may convert.
2. **Void authority**: `party.cancel` is reused; confirm or define a dedicated
   `party.payment.void` permission (needs role seeding).
3. **Reference required?** Today `reference` is optional for card / transfer;
   decide whether a transfer must carry a folio.
4. **Overpayment**: allowed and flagged (`overpaid_amount`); decide whether to
   block it or require a refund flow.
5. **Refund of a voided cash payment from a closed session**: the compensating
   `cash_out` is posted in the *current* open session by design; confirm the
   accounting treatment.
6. **Cancelled reservations with payments** still only warn ("has prior
   payments"); automatic refunds were deliberately not added.
7. **Cash-session policy**: cash still requires an open session at the same
   branch; decide whether a deposit may be taken when the drawer is closed
   (today: no).
8. **Quote document content**: logo, address, validity text, payment terms.
9. **Direct reservations**: whether every reservation must come from a saved
   quote.
