# ADR-0016: Promotions, discounts, and coupons engine

- Status: Accepted
- Date: 2026-09-04
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0001, ADR-0009, ADR-0013, ADR-0015)

## Context

TASK 12.9 builds a production-grade promotions/discounts/coupons engine: automatic promotions (percentage, fixed amount, fixed promotional price, NxM quantity offers), coupons, manual authorized discounts, priority/stacking, and full compatibility with TASK 12.8's returns/refunds engine. Unlike TASK 12.8's `refunds` domain, this one is **not** pre-specified anywhere in this repository's own architecture:

- `docs/CORE_DATA_MODEL.md` §2 ("Excluded") and `docs/API_CONTRACTS.md` §1 ("Excluded") both explicitly name "advanced promotions" as out of scope for the core platform contract.
- No `promotion`/`coupon`/`price_rule`/`bundle`/`campaign` table, permission, error code, or event exists anywhere before this task.

So this task reconciles against what genuinely IS already reserved, rather than a full contract:

- `sales.discount_total`/`sale_items.discount_total` — present since ADR-0009, always `'0.0000'` until this task, and `sales`'s own DB-enforced `sales_arithmetic_ck`: `total = subtotal - discount_total + tax_total` — the authoritative discount/tax ordering this whole engine must produce.
- `branches.timezone`/`companies.timezone` — real, required, already-validated IANA timezone columns (`docs/CORE_DATA_MODEL.md` §3: "business timezone stored separately where required").
- `products.category_id`, `products.product_type` (including the reserved-but-unimplemented `'kit'` value — see D-Combo below).
- ADR-0001's exact `BigInt`-scaled decimal arithmetic and round-half-up convention.
- AS POS V1.html's own real Cupones/Promos/Descuento behavior — read directly, not guessed — informing every default semantic below where the task itself left a design choice open (NxM formula, single-promotion-applies-by-default, coupon-status precedence, manual-discount line/ticket scope).

## Decisions

### D1 — Authoritative pricing engine: one pure function, two callers

`pricing.service.ts`'s `evaluatePricing` is the ONE canonical pricing algorithm. It has no database access of its own — every promotion/coupon/product fact it needs is resolved by its caller first — which is what makes it directly unit-testable (41 tests, `pricing.service.test.ts`) and guarantees "same cart/context ⇒ same result" (Part G). Exactly two callers exist, and neither wraps or duplicates its math:

1. `PromotionsService.quote` — the standalone preview endpoint (`POST /sales/pricing-quotes`), read-only, never creates anything.
2. `SalesService.createSale` — real sale creation, which independently re-resolves every promotion/coupon/manual-discount input and calls the identical function, never trusting whatever a prior quote returned (mirrors ADR-0009's "submitted snapshots are evidence, not authority" for the exact same reason — a quote is display-only evidence).

### D2 — Pricing order: a strict cascade, not AS POS V1's parallel sum

Confirmed by reading `AS POS V1.html` directly: V1 computes its general/manual discount, its promotion discount, and its coupon discount all independently against the *same* gross-ish base, then simply sums the three subtractions at the end (`tot = sub - descG - descPromo - descCupon`). This task deliberately does **not** copy that model — it would let a customer benefit from two percentage discounts each computed against the untouched full price. Instead:

1. catalog unit price × quantity → gross line subtotal
2. the winning automatic promotion(s) reduce each eligible line
3. a valid coupon reduces the cart's remaining (post-promotion) amount, allocated pro-rata across lines
4. an authorized manual discount reduces what's left (pro-rata if ticket-scoped, directly if line-scoped)
5. tax is computed on each line's own POST-DISCOUNT taxable base
6. `total = subtotal − discount_total + tax_total` — exactly `sales_arithmetic_ck`, never independently computed (the sale/line aggregate is always the literal sum of its own lines, so it can never drift from that constraint)

### D3 — Promotion rule model: typed relational primitives, never arbitrary JSON logic

`promotions` (`packages/database/src/schema/promotions.ts`) has one column per rule primitive — `starts_at`/`ends_at`/`days_of_week` (ISO 8601 weekday, 1=Monday…7=Sunday)/`time_from`/`time_to`/`priority`/`stackable`/`benefit_type` + its specific fields/`min_quantity`/`min_subtotal`/`usage_limit_total`/`combinable_with_coupons` — never a JSON blob a caller would have to "evaluate." Branch/product/category scope are real join tables with real FKs (`promotion_branches`/`promotion_products`/`promotion_categories`), mirroring `user_branch_access`'s own established many-to-many pattern rather than a bare `uuid[]` column that could reference a deleted or renamed row.

Schedule/time-window evaluation (`localWeekdayAndTime` in `pricing.service.ts`) uses the SALE'S OWN BRANCH timezone via `Intl.DateTimeFormat`, never server UTC and never a hand-rolled offset table — `branches.timezone` already existed as a real, required, always-populated column, closing what Part F flagged as a possible gap before any code was written.

Customer-identity-dependent conditions AS POS V1 itself has (`edadMinima`/`esVip`/`esMiembro`/`cumpleanosHoy`/`maxUsosPorCliente`) are deliberately **not** implemented — `docs/CORE_DATA_MODEL.md` itself defers customer identity (`sales.customer_id` is intentionally absent until a customer model is approved), so building conditions against an identity that structurally doesn't exist yet would be exactly the "invent an arbitrary restriction" the task warns against.

### D4 — Benefit types: percentage, fixed amount, fixed price, quantity NxM — never floating point

All four types resolve to an equivalent basis-points rate against the line's own gross subtotal, computed with the exact same `BigInt`-scaled `applyBasisPoints`/round-half-up algorithm ADR-0001 already established (copied, not shared, matching every other module's own self-contained arithmetic helpers). A discount can never exceed the line's own gross subtotal (`sale_items_discount_not_exceed_subtotal_ck`, enforced at the database) — the floor-at-zero Part E requires.

**NxM (2x1/3x2) semantics** — confirmed exactly against AS POS V1's own `evaluarPromocionesCarrito` (`Math.floor(item.qty/2)*item.precio` for 2x1, `Math.floor(item.qty/3)*item.precio` for 3x2), generalized to any `(buy, pay)` pair: every complete group of `buy` units grants `buy − pay` free units, computed as `floor(wholeUnits / buy) × (buy − pay)` free units × unit price. 3 units at $100 with 2x1 (buy=2, pay=1) discounts exactly $100 (one free unit, floor(3/2)=1 group) — never 50% off every unit ($150). Scoped to ONE line (identical product/variant) at a time, matching V1's own per-line evaluation exactly — mixed-product NxM (e.g. "cheapest of these 3 different products free") is out of scope for this pass; the exact tie-breaking rule such a feature would need is a real open design question this task does not attempt to guess at.

### D5 — Priority / stacking / exclusivity: deterministic, conservative by default

Every eligible automatic promotion is scored (its own discount amount against the cart's current gross state), then sorted by `priority` descending, ties broken by larger discount amount, final ties broken by ascending promotion id (a stable, reproducible tie-breaker — never insertion/query order). The winner always applies. A **non-stackable** winner (`stackable = false`, the default — matching AS POS V1's own real behavior of applying at most one promotion at a time) blocks every other automatic promotion outright. A **stackable** winner (`stackable = true`) additionally combines with every other eligible `stackable = true` candidate — both sides must opt in, mirroring the schema's own single `stackable` boolean rather than a separate `exclusive`/`stackable` pair that could disagree with each other (an earlier draft of this schema had both; removed before the first commit once the redundancy was noticed).

A real bug was caught by this design's own unit test suite: two stackable promotions computed independently against a line's ORIGINAL gross amount can nominally sum past 100% (60% + 70% = 130%). Fixed by capping each additional stacked contribution at what remains of the line's own subtotal after prior contributions — the combined discount can never exceed, and never goes negative.

Coupon/promotion combinability is a single flag on the promotion side only (`combinable_with_coupons`, default `true`) — mirrors AS POS V1's own `promo.compatibilidad.combinableConCupones` exactly; no mirrored flag exists on `coupons` (V1's own coupon editor never exposes one either).

### D6 — Coupon lifecycle: standalone entity, redeemed at sale creation, released on cancellation

`coupons` is a standalone entity with its own benefit fields (`percentage` | `fixed_amount`, matching AS POS V1's own coupon model exactly — V1 never links a coupon to a promotion). An optional `promotion_id` FK exists for a possible future linkage but is structurally unexercised in this pass (no evidence V1 itself ever uses one).

Redemption happens at **sale creation** — the same, already-existing atomicity boundary a sale's own transaction provides, never a bespoke new reservation window. If that sale is later **cancelled** (only legal from `pending_payment`, exactly TASK 12.8's own established Sale lifecycle), `SalesService.cancelSale` releases the coupon redemption (`deleteCouponRedemptionsForSale`) in the same transaction — a failed/abandoned payment therefore never permanently consumes a coupon (Part J), using only the two pre-existing lifecycle boundaries (creation, cancellation) this codebase already has, never a bespoke "reserve then confirm" state machine invented for this task alone.

### D7 — Coupon concurrency: database-backed, row-locked

A coupon with one remaining redemption cannot be consumed twice by concurrent checkouts: `SalesService.createSale` calls `PromotionsRepository.lockCouponByNormalizedCode` (`select ... for update`) inside the SAME transaction that will insert the sale, then counts existing `coupon_redemptions` rows under that lock before `evaluatePricing` ever decides the coupon is eligible — mirroring `RefundsRepository`'s identical locked-parent-then-count pattern from TASK 12.8. `coupon_redemptions_company_coupon_sale_uq` (a real unique constraint) is the durable, database-level backstop even if the application-level lock were ever bypassed. The standalone quote/preview path uses the SAME lookup unlocked (`couponByNormalizedCode`) — explicitly allowed to be stale, since Part B itself says a quote must never be trusted blindly regardless.

A **promotion's** own `usage_limit_total` (a materially lower-stakes, broader marketing rule than a specific coupon code) is enforced with a single non-locked query (`activePromotions`'s own `left join lateral` counting `sale_discounts` rows) rather than a per-promotion row lock — a deliberate, honest scope decision: Part J's explicit strict concurrency requirement names coupons specifically, and a promotion usage limit being off by one under a genuine race is a materially smaller risk than a specific numbered coupon code being double-redeemed. If stricter promotion-usage concurrency is ever required, it can reuse the identical lock-then-count pattern coupons already use.

### D8 — Manual discounts: authorized, ephemeral, not a managed catalog entity

A manual discount is NOT a durable, independently-manageable entity like a Promotion or Coupon — it is a one-shot request (`{scope: 'line'|'ticket', type, value, reason_code}`) submitted alongside `POST /sales`, requiring `discount.apply` (checked both at the HTTP route layer and again inside `evaluatePricing` itself — belt and suspenders, since the pure function is also called from the quote endpoint's own route which performs the identical check). An unauthorized request throws `discount_not_authorized` outright — never silently dropped, never silently applied. Its result is persisted purely as a `sale_discounts` row (`source_type = 'manual'`, `reason_code` populated, `source_id` null) — no separate "ManualDiscount" table exists, matching Part K/T's own framing of this as a checkout-time action, not a catalog to manage.

AS POS V1's `modal-descuento`'s own "Autoriza: [fake name]" line (driven by its insecure PIN flow) is never reproduced — authorization is entirely the real `discount.apply` permission check; the `sale_discounts.created_by` column always records the real authenticated actor, never a fabricated name.

### D9 — Refund compatibility: `discount_basis_points`, never a re-evaluation

TASK 12.8's `refunds.service.ts` computed a line's reversal purely from `unit_price` × `basis_points` — with `sale_items.discount_total` always `'0.0000'` until this task, that was correct by construction. Introducing real discounts without touching that code would have refunded the full GROSS catalog amount for any returned quantity of a discounted item — a real regression this task's own Part P anticipates and forbids.

Fix: `sale_items` gained an additive `discount_basis_points` column (integer, `0`–`10000`, default `0`) — the exact rate a line's combined discount (promotion + coupon + manual, whichever applied) was computed at, expressed against that line's own gross subtotal. `computeLineReversal` now reapplies this rate to the REQUESTED refund quantity's own gross subtotal before tax, exactly mirroring how `tax_snapshot.basis_points` already lets tax be recomputed for any partial quantity. This is a mathematical no-op for every historical (undiscounted) sale — `discount_basis_points = 0` reproduces the exact pre-TASK-12.9 refund amount.

Never re-reads `sale_discounts`, never re-evaluates whether the originating promotion/coupon still exists, is active, or has changed price since — proven directly: a promotion deactivated after the sale, a coupon disabled after the sale, and a catalog price changed after the sale all leave an already-completed refund's amount untouched (three dedicated integration tests). Reapplying a rate to a smaller partial quantity always rounds the discount portion UP (round-half-up), which can only ever shrink — never inflate — the resulting refund; cumulative partial refunds can therefore never exceed the amount actually paid, proven directly by summing three sequential one-unit refunds against a three-unit discounted line and asserting the total never exceeds what was paid, plus asserting a fourth (never-sold) unit is rejected outright with `refund_limit_exceeded`.

### D10 — Sale creation: coupon lock, promotion selection, then the exact same atomic write TASK 12.6–12.8 already established

`SalesService.createSale`'s existing transaction (product/price resolution → sale insert → per-line item insert → audit/outbox) now also: resolves the branch's own timezone, fetches active (and not-yet-usage-exhausted) promotions, locks any requested coupon codes, calls `evaluatePricing`, and — if any requested coupon ends up rejected — fails the WHOLE sale creation outright (`validation_error`) rather than silently completing without it; a quote should have already been checked moments before, so reaching creation with an invalid code represents a stale client state, and silently completing for a different amount than the cashier believed would be the worse failure mode. `sale_discounts` rows and `coupon_redemptions` rows are written inside the SAME transaction as the sale itself — an idempotent retry (the existing `idempotency_keys` mechanism, unchanged) replays the whole cached result, never double-inserting either.

A real, pre-existing latent bug in this exact code path was found and fixed as a side effect of this work: the original per-line `sale_items` insertion used `Promise.all` over multiple `insertSaleItem` calls sharing one transaction client — the same unsafe-concurrent-query-on-one-connection pattern TASK 12.8 had already found and fixed once in `refunds.service.ts`; fixed here to a sequential loop.

Two further bugs were found and fixed while writing this task's own integration tests (not present in the design, but real defects in the first implementation pass): `PromotionsRepository.insertPromotion`/`updatePromotion` read back the just-written row via the plain connection pool rather than the same transaction client, so they could never see their own uncommitted write inside a real transaction (silently worked in isolated unit tests, failed immediately under real transactional use); and `lockPromotion` combined `for update` with the scope-aggregating `group by` in one statement, which PostgreSQL rejects outright — fixed by locking the bare row first, then reading the full scoped shape as a separate statement on the same already-locked client.

### D11 — Permissions: five new codes, none invented redundantly

`promotion.read`, `promotion.manage`, `coupon.read`, `coupon.manage`, `discount.apply` — added to `packages/database/src/seeds/technical-permissions.ts` (none existed before this task; confirmed by search before writing any code). `discount.apply` is deliberately separate from `promotion.manage`/`coupon.manage` — a cashier authorized to apply a discount at the register is not automatically someone who should be editing the promotions/coupons catalog, mirroring `cash_movement.create` vs. `cash_register.manage`'s own separation (TASK 12.7). The local dev owner (`bootstrap-owner.service.ts`) was extended to grant all five — verified directly against both the local dev and test databases.

AS POS V1's `pedirPinAdmin`/`requiereMasterOAdmin` gate on its own promotions/coupons admin screens is never reproduced as a fake/master credential — `promotion.manage`/`coupon.manage` are real, already-authenticated permission checks.

### D12 — Combo/bundle: deliberately deferred, `kit` stays reserved-but-unexploded

`products.product_type` already includes `'kit'` as a valid enum value, but `docs/CORE_DATA_MODEL.md` itself documents `product_components` (the table that would let a kit "atomically explode" into its components) as "Proposed V1, implemented after base ledger" — i.e. a real, acknowledged future table that does not exist yet. Building a full bundle/combo domain for this task would mean inventing that foundation from scratch, well beyond "the smallest coherent foundation" the task allows. AS POS V1's own "Paquete de Fiesta" bundles are themselves part of the `Fiestas` (parties) domain, which `docs/CORE_DATA_MODEL.md` explicitly excludes entirely.

Decision: no combo/bundle promotion benefit type exists in this pass. `quantity_nxm` already covers the most common same-product multi-buy case ("2x1"); a genuine multi-different-product bundle (Family Pack, etc.) remains representable only as data in a FUTURE task, once `product_components` (or an equivalent) actually exists — this task does not fabricate a promotion-shaped workaround for it. `kit` itself is untouched, exactly as reserved-but-unbuilt as it was before this task, the same way `cash_register_id` stayed reserved-but-unpopulated on `sales` before TASK 12.7 gave it real meaning.

### D13 — Sales History / Sale Detail: additive fields only, never a duplicated pricing display

`GET /sales`/`GET /sales/{id}` now surface each sale item's `discount_total` (already existed as a field, previously always `'0.0000'`) with real values. A new read-only endpoint, `GET /sales/{id}/discounts` (`sale.read`, the same permission every other sale-detail read already requires), exposes `sale_discounts` (queryable per-sale) — the itemized breakdown for a Sale Detail's "exactly which commercial adjustments were applied" (Part V): labels, reason codes, and amounts frozen at application time, never re-derived from a promotion/coupon that might since have changed or been deleted. Authorization is enforced by the same `sale()` branch check every other sale-detail read already performs — this is not a second authorization boundary.

### D14 — Legacy sales: untouched, no synthetic backfill

A sale created before this deployment has `discount_total = '0.0000'`/`discount_basis_points = 0` (the columns' own defaults) and no `sale_discounts` rows — its receipt, history entry, and refund behavior are completely unaffected, proven directly by the pre-existing full refunds/sales/cash test suites (600+ tests) continuing to pass unmodified against the new schema. No backfill script, no migration that back-populates historical sales with synthetic discount facts — mirroring ADR-0013/ADR-0015's identical "no retroactive backfill" precedent.

### D15 — API surface: the smallest coherent set

- `POST /api/v1/promotions`, `GET /api/v1/promotions`, `GET /api/v1/promotions/{id}`, `PUT /api/v1/promotions/{id}` — admin management (Part U's own "minimum operational management," not a marketing dashboard: list/create/edit/activate, no analytics/reporting screens, no usage-ranking views, even though AS POS V1 itself has some — deliberately not ported).
- `POST /api/v1/coupons`, `GET /api/v1/coupons`, `GET /api/v1/coupons/{id}`, `PUT /api/v1/coupons/{id}` — same shape.
- `POST /api/v1/sales/pricing-quotes` — the standalone quote/preview, gated by `sale.create` (this IS the pricing step of building a sale, not a separate admin capability).
- `POST /api/v1/sales`'s existing body gained two purely optional fields (`coupon_codes`, `manual_discount`) — omitting both reproduces the exact pre-TASK-12.9 request/response shape and behavior.

No dedicated "redeem a coupon" endpoint, no separate "apply promotion" endpoint, no promotion/coupon deletion route (deactivation via `PUT` covers the operational need) — every one of these would have been exactly the "blindly introduce more endpoints than the smallest coherent surface needs" the task warns against.

## Deferred (explicitly out of scope for this task)

- **Combo/bundle domain** (`product_components`) — see D12. `quantity_nxm` covers same-product multi-buy; a genuine multi-product bundle needs a real future foundation.
- **Customer-identity-dependent conditions** (age, membership tier, birthday, per-customer usage limit, new/frequent/VIP customer) — `docs/CORE_DATA_MODEL.md` itself defers customer identity; building conditions against it now would be guessing at a domain this repository hasn't approved yet.
- **Mixed-product NxM** ("cheapest of these N different products is free") — scoped to identical product/variant per line in this pass; the tie-breaking semantics a mixed-product variant would need remain a real open design question.
- **A separate promotion-usage row lock** — usage-limit enforcement for promotions is a single unlocked count query (D7); only coupon redemption gets the strict locked treatment Part J explicitly requires.
- **Promotion/coupon analytics or usage-ranking screens** — AS POS V1 has some (`renderReportesPromos`); Part U's own "not a giant marketing SaaS dashboard" instruction is followed literally here.
- **Mercado Pago** — untouched and still paused; nothing in this task's scope touches payment provider configuration.
