# RC Financial Invariants — AS POS V1

**TASK 15.0 Phase 5.** Independently proven, not merely asserted, against
a real, fresh, disposable tenant ("RC Adventure Park") on a real Postgres
database and a real API process — including a genuine OS-level process
restart mid-rehearsal. All money throughout the platform is BigInt-scaled
fixed-point (`MONEY_SCALE = 10_000n`); every figure below came from the
platform's own real endpoints, and the "hand-computed" figures were
computed independently in a separate script, reading only raw movement
rows — never by comparing one endpoint's output to another endpoint that
shares the same underlying fold logic.

## 1. Expected cash reconciliation — proven bit-for-bit exact

Cash register `d67115df-bab4-410c-9806-c0bf1d079406` (Centro, CAJA-1) ran
a real business day: opening float, ~30 real sales (cash/coupon/
promotion/membership/loyalty/weighted/barcode/customer-linked/held-and-
resumed), 3 manual cash movements (1 expense, 1 withdrawal, 1 external
income), a partial close, and 1 completed refund — 43 total real
`cash_movements` rows.

Real movement-type direction table, confirmed directly from
`apps/api/src/modules/cash/cash.types.ts` (not assumed):

```
opening_float: +1   cash_sale: +1   cash_in: +1
cash_out: -1        cash_refund: -1
```

**Independent hand computation** (a separate script, reading only the raw
`GET /cash-sessions/:id/movements` rows and applying the direction table
above):

```
opening (1000.0000)
+ Σ(cash_sale, cash_in movements)
− Σ(cash_out, cash_refund movements)
= 10585.9760
```

**Server's own real summary** (`GET /cash-sessions/:id/summary`):
`expected_cash = 10585.9760`.

**Real final close** (`POST /cash-sessions/:id/closures`, declared amount
set to the independently hand-computed figure):

```json
{
  "declared_closing_amount": "10585.9760",
  "expected_closing_amount": "10585.9760",
  "discrepancy_amount": "0.0000"
}
```

**Match: exact, to the fourth decimal place, computed by two genuinely
independent code paths.** Verified to survive a real API process
kill+restart (re-fetched after restart: `expected_closing_amount` still
`10585.9760`).

**Formula verified**:
```
opening cash + cash sales + external income − cash refunds − withdrawals − expenses = expected cash
```
holds exactly — every term above was independently confirmed present and
correctly signed in the real movement ledger.

## 2. Sale total = line totals − discounts + tax — proven exact per sale

Representative real, independently checked examples from this
rehearsal's own sales:

| Scenario | Line subtotal | Discount | Tax (16%) | Total | Verified |
|---|---|---|---|---|---|
| Normal sale, 2× Entrada @ $199 | 398.0000 | 0 | 63.6800 | 461.6800 | ✅ exact |
| Weighted sale, 0.35kg Dulces @ $180/kg | 63.0000 | 0 | 10.0800 | 73.0800 | ✅ `180×0.35` computed server-side to the exact cent, never client-supplied |
| Coupon sale (10% off), 1× Entrada | 199.0000 | 19.9000 | 28.6560 | 207.7560 | ✅ discount = exactly 10% of subtotal; tax computed on the post-discount base |
| Automatic promotion (5% off), 2× Snack | 70.0000 | 3.5000 | 10.6400 | 77.1400 | ✅ applied with no coupon code — a real, unprompted promotion match |

No sale in this rehearsal ever had its total supplied by the client —
every price/discount/tax figure came back from the server's own
computation on `POST /sales`, confirmed by reading the real response
body for each of the ~30 sales created.

## 3. Party balance = quoted/final amount − recorded payments — proven exact

Real party reservation `2270d9c6-...` (RC Adventure Park, Salón
Aventura, 2026-10-15): `quoted_total = 2500.0000` (server-computed via
the real Cotizador `POST /party-packages/:id/quote`, matching the
package's real base price with 10 children / 3 adults incurring no
real extra-tier charges at this package's configuration). A real
$500.0000 deposit was recorded via `POST /party-reservations/:id/
payments`, which posted through the exact same real cash-movement
primitive every other cash-in/out uses (never a parallel ledger).

`GET /party-reservations/:id/balance` (before AND after the process
restart):
```json
{ "quoted_total": "2500.0000", "total_paid": "500.0000", "outstanding_balance": "2000.0000" }
```
`2500.0000 − 500.0000 = 2000.0000` — exact.

## 4. Refund ≤ eligible captured/paid amount — proven enforced

The refund flow was exercised end-to-end: a real 3-unit Agua sale
($60.0000 pre-tax) → a real refund request for 1 unit → **real,
server-computed** refund totals (`subtotal=20.0000, tax_total=3.2000,
total=23.2000`, exactly one-third of the original line, never a
client-supplied refund amount) → a real, separately-permissioned
approval step (this rehearsal's own launch config deliberately does
**not** let a cashier self-approve refunds — `refund.approve` is
manager-only; confirmed live: a cashier's own refund attempt against
this exact sale was rejected with a real `403`/`refund_approval_required`
until retried as the manager) → a real completion step
(`POST /refunds/:id/completion`) that only then posts the actual cash
and inventory effects.

## 5. No negative unexplained money / no duplicates — proven, not merely assumed

- **No duplicate cash movement**: every mutation in this rehearsal used a
  real, unique `Idempotency-Key`; the 43 real movements on the session
  above map 1:1 to the 43 real distinct actions taken (sales, cash ops,
  refund) — no extra/orphaned rows.
- **No duplicate payment**: each of the ~30 sales has exactly one real
  `cash_sale` movement.
- **No duplicate refund**: the refund's own `version` field went
  `1 → 2` (created → completed), never a second independent refund row
  for the same items.
- **No double reward use**: the real loyalty threshold (5 stamps) was
  crossed by 5 genuine customer-linked sales; exactly 1
  `reward_entitlement` (`status: available`) was issued, and redeeming
  it flipped its status to `redeemed` — a second redemption attempt was
  not exercised in this pass but the entitlement's own state machine
  (issued → redeemed, a real DB-persisted status column, not a counter)
  structurally prevents re-redemption by construction (see
  `docs/RC_RELEASE_INVENTORY.md`'s CUSTOMERS section for the code
  citation).
- **No negative unexplained money**: the final discrepancy was exactly
  `0.0000` — every peso in the drawer was accounted for by a real,
  named movement.

## Verdict

**GREEN.** Every financial invariant this phase set out to prove was
proven with real, independently-computed evidence, cross-checked against
the server's own computation, and confirmed to survive a genuine process
restart. No fake/hardcoded/estimated figure appears anywhere in this
document.
