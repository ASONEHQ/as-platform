# ADR-0017: Customers, memberships, and AS Rewards+ foundation

- Status: Accepted
- Date: 2026-09-04
- Owners: AS ONE Engineering
- Supersedes: none (extends ADR-0001, ADR-0006, ADR-0009, ADR-0013, ADR-0015, ADR-0016)

## Context

TASK 13.0 establishes the canonical Customer identity, Membership plan/entitlement, and AS Rewards+ loyalty-ledger foundation. Unlike TASK 12.8's `refunds` domain, and much like TASK 12.9's `promotions`, this is a genuinely new domain — but with even less pre-existing scaffolding:

- `docs/CORE_DATA_MODEL.md` §2 explicitly deferred it: *"Customer identity is also deferred; `sales.customer_id` is intentionally absent until the customer model is approved."* This task IS that approval.
- `docs/API_CONTRACTS.md` §1 and §16.9 (ADR-0016 D3) both name customers/memberships/rewards as excluded, and ADR-0016 D3 explicitly names this exact gap: *"building conditions against an identity that structurally doesn't exist yet would be exactly the 'invent an arbitrary restriction' the task warns against"* — this task is what unblocks that future work, though extending the promotions rule engine with customer-identity conditions is itself explicitly out of scope here (see Deferred).
- No `customer`/`membership`/`loyalty`/`reward` table, permission, route, or event exists anywhere before this task (confirmed by forensic search across the whole repository, and by reading `AS POS V1.html` directly, before writing any code).
- `company_memberships` (`identity.ts`) already means STAFF/tenant membership — reconciling against this meant a deliberate naming choice, not a coincidence (see D1).
- AS POS V1's own `DB.clientes`/`DB.membresias` were read directly: no dedupe on phone/email, every cross-reference by raw name string (not id), a membership catalog with zero actual sale/activation/validation wiring, zero loyalty/rewards/points/stamp code anywhere, and an insecure client-side PIN gate on customer edits/membership creation (documented, never reproduced — see D-PIN below the decisions).

## Decisions

### D1 — Customer vs. User: never the same table, never the same domain

`customers` is a wholly separate table from `users`/`company_memberships`. `users` are staff/operators with authenticated login; `customers` are commercial guests/members with no login in this pass. Naming was chosen deliberately to avoid colliding with the pre-existing `company_memberships` (staff tenant membership): the new catalog/entitlement tables are `membership_plans`/`customer_memberships`, never bare "memberships" — grepping the codebase for "membership" after this task still resolves unambiguously to whichever concept a reader actually means. A future AS Rewards+ authenticated customer experience may reference a `customers.id`, but must never collapse the staff-user domain into it, and is out of scope here.

### D2 — Company-level customer identity, never branch-scoped

`customers` has `company_id` and no `branch_id` at all — mirroring `promotions`/`coupons`'s own company-wide scope (ADR-0016 D3) — matching `docs/CORE_DATA_MODEL.md` §20's own anticipation: *"Rewards and memberships may reference companies, branches, users or future customers..."* A customer's branch-specific history (which branches they've bought from) is derived from `sales.customer_id`/`sales.branch_id` at read time, never a second denormalized record — "no duplicate Sale storage" (Part AA) generalizes here too.

### D3 — Email normalization: trim + lowercase, validated at the database

Mirrors `users.normalized_email`'s own established convention exactly: `normalized_email = lower(btrim(normalized_email))`, enforced by a `CHECK` constraint, computed by the application layer (`phone-normalization.ts`'s `normalizeEmail`) before insert — never derived by the database itself.

### D4 — Phone normalization: E.164 via a real library, never guessed, never hand-rolled

AS POS V1 itself never validated or normalized phone numbers at all (confirmed by reading `AS POS V1.html` — a free-text field, substring search only) — nothing to reconcile against; this is genuinely new. `libphonenumber-js` (the industry-standard, actively maintained port of Google's `libphonenumber`) was added as a real dependency rather than a hand-rolled regex — Mexican mobile/landline number shapes have real ambiguities a naive regex cannot correctly resolve, and the task's own "production-safe canonical representation" instruction rules out guessing.

Country context is never hardcoded (no literal `'MX'` anywhere in source). It is read from a new, explicit, typed company setting — `customers.default_country_code` — added to the EXISTING `company_settings` typed-registry mechanism (`settings.catalog.ts`), not a new column on the foundational `companies` table: reusing that pre-existing "typed config value scoped to a company" mechanism is both less invasive and more idiomatic than a schema migration on a core ledger table for what is, functionally, business configuration. An empty value (the default) means "not configured" — phone normalization then intentionally fails closed: `normalized_phone` stays `null` rather than guessing, and the raw `phone` string is preserved untouched for display/manual lookup. A phone number that already carries an explicit `+` country-code prefix normalizes correctly regardless of whether this setting is configured at all.

### D5 — Duplicate/conflict policy: no automatic merge, ever

Deterministic, database-enforced, and consistent regardless of which layer happens to catch it:

- A plain `UNIQUE(company_id, normalized_email)` / `UNIQUE(company_id, normalized_phone)` constraint is the durable backstop — Postgres treats every `NULL` as distinct, so customers with no email/phone on file never spuriously collide with each other.
- `CustomersService.createCustomer`/`updateCustomer` run a pre-insert conflict check first (`assertNoConflict`), returning a rich, actionable `resource_conflict` (carrying the existing customer's id in `details`, so a caller — notably the POS quick-registration flow, Part I — can OFFER the existing customer instead of failing blindly) or the more specific `customer_identity_conflict` when email matches one existing customer AND phone matches a DIFFERENT one.
- A genuine race that slips past the pre-check is caught by the SAME unique-constraint violation, mapped to the identical `resource_conflict` code — proven by a dedicated concurrent-creation integration test asserting exactly one of two simultaneous same-email requests succeeds, and that the loser's error code is identical regardless of which layer happened to catch it first (a real inconsistency was found and fixed here during testing: the constraint-violation mapping originally produced `customer_identity_conflict` for a plain single-field collision, a different code than the pre-check's own `resource_conflict` for the identical fact — now unified).
- No automatic merge exists anywhere in this pass — matching a canonical merge model does not yet exist (see D-merge below).

### D6 — Sale customer relationship: additive, optional, never retroactive

`sales.customer_id` (nullable) and `sales.customer_display_name` (nullable) are additive columns on the existing `sales` table — the exact deviation `docs/CORE_DATA_MODEL.md` §31/§941 requires an ADR for, and this is that ADR. A walk-in sale continues to work completely unchanged (`customer_id` stays `null`); no historical sale is ever backfilled (D-legacy below). A supplied `customer_id` is resolved and validated INSIDE the sale-creation transaction, exactly like every product line already is — a customer id belonging to a different company resolves to `resource_not_found`, never silently attached (proven by a dedicated integration test). `customer_display_name` is a frozen commercial snapshot taken at THAT moment — mirroring `sale_items.name_snapshot`'s own "never re-read a mutable record later" convention exactly — so a later customer name edit can never silently rewrite a historical receipt (Part AB), proven by a dedicated integration test that renames a customer after their sale and asserts the sale's own snapshot is untouched.

### D7 — Customer PII handling: never in logs, QR, or outbox payloads

Confirmed before writing any code: Fastify's own request/response auto-logging is already disabled (`disableRequestLogging: true`, `create-app.ts`), and the one per-request log line (`request-context.ts`) logs only method/route/status/timing — no request body is logged anywhere in this codebase today, so introducing PII-bearing fields (name/email/phone/birth date) in request bodies creates no new logging exposure, provided no new logging call is added (none was). Every `customer.*`/`membership.*`/`loyalty.*` audit/outbox payload carries only ids and non-sensitive status fields (`customer_id`, `status`, `active`, etc.) — mirroring `sale.created`'s own established minimal-reference shape (ADR-0009) — never a name, email, phone, or birth date. `sales.service.ts`'s own `salePayload()` gained a `customer_id` field for the identical reason.

### D8 — Membership plan vs. entitlement: never one table

`membership_plans` is the PRODUCT/RULE definition (name, active, optional `product_id` linkage into the real sellable catalog, `duration_days`, branch eligibility). `customer_memberships` is the ISSUED entitlement (one row per period a specific customer actually holds). Never blurred into one table — mirrors `promotions` (the rule) vs. `sale_discounts` (the applied fact) from ADR-0016 D3/D9 exactly. A sellable product backs at most one plan (`membership_plans_company_product_uq`) — never ambiguous which plan a sold line item should activate.

### D9 — Activation boundary: structural, not a runtime check

A POS-purchased membership is inserted DIRECTLY as `'active'` at the exact instant `SalesRepository.trySettleSale` newly transitions the originating Sale to `completed` — the identical transactional hook point TASK 12.6's inventory-consumption posting already uses, and for the identical reason: `settled` is only ever `true` the first time a sale genuinely completes, never on a replay. No `CustomerMembership` row is ever created at sale-CREATION time at all for the POS-purchase path — so "no activation before payment" (Part K) is structural (the row simply does not exist yet), not something a runtime check has to remember to enforce. Proven directly: a dedicated integration test asserts zero `customer_memberships` rows exist while a sale sits in `pending_payment`.

Idempotent by construction: `customer_memberships_company_sale_plan_uq` (a real unique constraint on `(company_id, source_sale_id, membership_plan_id)`) means a retried/replayed settlement of the same sale can never issue a second membership — `MembershipsRepository.insertMembership` uses `on conflict ... do nothing`, and the caller (`PaymentService.applyPostSettlementHooks`) treats a `null` result as "already issued, nothing new to do." Proven directly by a dedicated retry/idempotency-key-replay integration test.

Branch eligibility (an empty `membership_plan_branches` join means "all branches", mirroring `promotion_branches` exactly) and plan-active state are both re-checked at this exact activation moment, never cached from sale-creation time — a plan deactivated or branch-restricted between sale creation and payment settlement is honored correctly, proven directly.

An admin-issued membership (not sold through a Sale — e.g. a complimentary grant) is the only path that can ever create a row as `'pending'` (when its `starts_at` is in the future) — the only OTHER state a fresh issuance can ever begin in.

### D10 — Renewal: a NEW row, never mutated `expires_at`

Renewal creates a NEW `customer_memberships` row, chained via `renewed_from_membership_id`, rather than mutating the original row's `expires_at` in place — consistent with this codebase's own established "a settled commercial fact is never rewritten" convention (a refund is a new fact against an immutable Sale, TASK 12.8; a renewal is a new fact against an immutable prior membership period, here). The new period's `starts_at` is the OLD membership's `expires_at` if it has not yet lapsed (never a gap, never silently granting free extra days by starting from "now" while time remains), or `now` if it already has (never a negative-length period either way) — proven directly by a dedicated integration test. Renewal is itself idempotency-key-gated exactly like every other mutation in this codebase, proven by a dedicated retry test asserting exactly one new period is ever created.

### D11 — Membership validation: server-authoritative, one endpoint

`POST /api/v1/memberships/validate` (`membership.read`) is the ONE place membership validity is decided — given `customer_id`, `branch_id`, and the server's own current time, it independently re-checks status/window/branch-eligibility every time; Flutter never computes this itself (Part N). Proven directly by dedicated tests: valid for an active non-expired membership at an eligible branch, invalid for a customer with none, and invalid once a membership has genuinely expired.

### D12 — Loyalty account: 1:1 with a customer, lazily created, never everyone automatically

A customer MAY have a `loyalty_accounts` row within their company (`UNIQUE(company_id, customer_id)`) — never every customer automatically. The account is created lazily, on first genuine touch (an automatic earn or a manual adjustment), never at customer-creation time — proven directly by a test asserting a customer who never triggers an earn/adjustment has no account at all (`summary().account === null`).

### D13 — Append-only ledger, balance always derived, never a cached counter

`loyalty_ledger` is append-only in this codebase's own usage — never `UPDATE`d or `DELETE`d; a correction is always a new, signed `'adjustment'` row, never an edit to a prior one. The balance (Part Q) is ALWAYS a `SUM(quantity)` read at query time, grouped per program — never a cached mutable counter this task would have to keep transactionally consistent by hand. Proven directly by a test that performs three separate qualifying sales and asserts the derived balance accumulates correctly to 3, matching the ledger's own row count exactly.

### D14 — Earning/redemption idempotency: DB-enforced, never counted on request timing alone

Automatic 'earn' entries carry a real unique constraint, `loyalty_ledger_company_program_sale_uq` on `(company_id, loyalty_program_id, source_type, source_id)` — a retried/replayed sale settlement can never double-earn for the same (program, sale) pair; `LoyaltyRepository.insertLedgerEntry` uses `on conflict ... do nothing`, mirroring `MembershipsRepository.insertMembership`'s identical pattern (D9) exactly. Manual adjustments are separately gated by the standard idempotency-key mechanism this codebase already uses everywhere (`idempotency_keys`), proven by a dedicated retry test. No redemption route exists yet in this pass (see Deferred) — the ledger's `entry_type` enum reserves `'redeem'`/`'expiration'` as valid-but-currently-unexercised values, the same "reserved-but-unexploded" precedent `products.product_type = 'kit'` already established (ADR-0016 D12).

A genuine, systemic bug was found and fixed while writing this task's own idempotency-replay tests: several `idempotent()` call sites (across `customers`/`memberships`/`loyalty` services) originally hashed the freshly-server-generated row id into the request-hash — since that id is a new random UUID every call, a genuine retry with the SAME idempotency key and SAME logical request always produced a DIFFERENT hash and was rejected as a key conflict rather than replayed, defeating the whole mechanism for exactly the callers who omit an optional client-supplied id. Fixed by hashing only the caller-supplied `input` (never a server-resolved id), matching `SalesService.createSale`'s own already-correct convention (`hash({ ..., id: input.id ?? null })`) — the bug would otherwise have silently broken idempotent retries for coupon-shaped creation flows too if reproduced there; it was caught here specifically because this task, unlike the ones before it, wrote a dedicated same-key-replay test for every new idempotent mutation.

### D15 — Program configuration: typed, never active by default

`loyalty_programs` is a minimal, TYPED configuration (`unit_type: 'stamp'|'point'`, `earning_rule_type: 'per_completed_sale'` — reserved-but-single-valued today, the same `'kit'`-style precedent — `earn_quantity_per_sale`, optional `minimum_sale_total`, optional `reward_threshold`/`reward_description` for progress DISPLAY only) — never arbitrary executable JSON (Part S is explicit about this). A brand-new program defaults to `active = false` EVEN WHEN THE CALLER OMITS THE FIELD ENTIRELY — proven directly by a dedicated test — so "no invisible business rule" (Part R) holds structurally: a company with zero programs, or only inactive ones, earns nothing on any sale, proven directly by a walk-in-sale test and a no-program-at-all test.

### D16 — QR identity: opaque, non-sensitive, revocable, never authentication

`customer_qr_tokens.token` is a cryptographically random 24-byte value (`randomBytes(24).toString('base64url')`) — never derived from or containing the customer's name/email/phone (proven directly by a test asserting the issued token string never matches any of those substrings). At most one `active` token per customer at a time (`customer_qr_tokens_company_customer_active_uq`, a real partial unique index) — rotation is revoke-then-issue in the same transaction, never mutate-in-place, so a leaked/revoked token can never be silently reactivated and history is preserved. Resolution (`resolveQrToken`) explicitly rejects a token belonging to a DIFFERENT company than the caller's own authenticated context — a QR token is never trusted to imply tenant scope by itself — proven directly. This is identification/presentation only, never authentication for a sensitive account action (Part U) — every route that accepts a resolved customer id still separately authorizes whatever it does next through the normal permission system.

AS POS V1's own two unrelated QR concepts (a staff-login token, `IPX-${Date.now()...}`; a wristband/pulsera code, `Math.random()`-derived) were read directly and confirm the "opaque-token-as-lookup-key" idea is worth keeping conceptually — but their actual generation (predictable, client-side `Math.random()`/timestamp) and validation (unsigned, no expiry enforcement, a linear plaintext array scan) are explicitly NOT reproduced; this task's tokens are server-generated with a real CSPRNG and validated server-side against a real, revocable, uniquely-indexed row.

### D17 — Wallet: foundation only, no fake provider integration

No Apple/Google Wallet integration exists in this pass — none was required to, and none is faked. The same `customer_qr_tokens.token` this task already builds (D16) is the stable, revocable public identifier such a future pass could use as a Wallet pass's serial number; nothing further is built or stubbed toward it.

### D18 — Customer archival: `status`, never a destructive delete

`customers.status` is `active | inactive | archived` — no delete endpoint exists anywhere in this module, and none is planned; a customer with any commercial history (a Sale, a membership, a loyalty ledger entry) must never have that history orphaned. Proven directly by a test that archives a customer and confirms the row remains fully readable. No GDPR-style erasure workflow was invented — that remains separate future work if a canonical requirement for it is ever approved.

### D19 — Legacy sales: untouched, no synthetic backfill

Every sale created before this deployment has `customer_id = null`/`customer_display_name = null` (the columns' own defaults) — its receipt, history entry, and refund behavior are completely unaffected. No backfill script, no migration that retroactively attaches a customer to a historical sale — mirroring ADR-0013/ADR-0015/ADR-0016 D14's identical "no retroactive backfill" precedent for the fourth time running in this codebase.

### D20 — Refund/membership interaction: no automatic revocation, a manual remedy exists

If a Sale that activated a paid membership is later refunded, that membership is NEVER automatically revoked in this pass — Part AC explicitly forbids inventing that commercial rule without a canonical definition, and none exists. `Refund` stays linked purely through the original (immutable) Sale, exactly as TASK 12.8 already established; refunding never creates, deletes, or touches a `customer_membership` row. If a paid membership refund/revocation is commercially appropriate, an administrator can separately cancel it via the existing `POST /api/v1/customer-memberships/{id}/cancel` route (`membership.manage`) — a manual remedy exists, but nothing automatic. This is a deliberate, documented limitation, not an oversight.

### D21 — Permissions: nine new codes, matching the established three-tier shape

`customer.read`/`customer.create`/`customer.update` — a cashier's day-to-day lookup/registration surface (Part Y explicitly calls for the minimum set here; notably no `customer.delete` exists, matching D18).

`membership.read`/`membership.manage`/`membership.issue` — mirrors `promotion.read`/`promotion.manage` + `discount.apply`'s own established shape (ADR-0016 D11) exactly: `.read` for the admin/lookup surface, `.manage` for plan CRUD, `.issue` kept SEPARATE for the checkout/renewal-time action (a cashier authorized to sell a membership through checkout is not automatically someone who should be editing the plan catalog) — though note the POS-PURCHASE activation path (D9) requires no permission of its own at all, since it is driven entirely by the payment-settlement transaction, never a direct API call a permission could gate.

`loyalty.read`/`loyalty.manage`/`loyalty.adjust` — the identical three-tier shape again, with `loyalty.adjust` kept SEPARATELY permissioned as the highest-risk manual ledger correction, exactly as Part Y explicitly requires ("High-risk manual loyalty adjustment should remain separately permissioned") — proven directly by a dedicated test asserting `loyalty.manage` alone is insufficient to call the adjustment endpoint.

Every one of the nine codes was added only after confirming none was already reserved (forensic search before writing any seed changes) — no duplicate synonyms. The local dev owner seed (`bootstrap-owner.service.ts`) was extended to grant all nine, mirroring the identical pattern ADR-0016 D11 already established.

Every route handler checks the SAME permission BOTH at the HTTP layer (`requirePermission(authentication, auth, ...)`, matching `promotions.routes.ts`'s own established defense-in-depth convention) AND again inside the service layer using the actor's own already-known permissions (`context.actorPermissions.includes(...)`) — a real inconsistency was found and fixed while writing this task's own HTTP-level route tests: several endpoints (membership issuance/renewal/cancellation, loyalty program update, loyalty manual adjustment, and every customer/membership/loyalty read route) originally checked ONLY at the service layer, meaning a route-level test mocking the service could not observe the enforcement even though it was genuinely present and correct at runtime — every route now checks at both layers, matching the codebase's own established convention consistently rather than per-endpoint happenstance.

### D22 — Audit/outbox: minimal, honest, only for facts actually implemented

`customer.created`/`customer.updated`, `customer.qr_token.issued`, `membership_plan.created`/`updated`, `customer_membership.issued`/`activated`/`renewed`/`cancelled`, `loyalty_program.created`/`updated`, `loyalty_ledger.earned`/`adjusted` — every event published corresponds to a fact this task actually implements; no speculative event exists for a redemption route, a reward-entitlement issuance, or a Wallet pass — all deliberately deferred (see below), so no event for them exists either, matching Part Z's own "only implement events for facts actually implemented." Every payload follows D7's minimal-reference-only shape.

## Deferred (explicitly out of scope for this task)

- **Reward entitlement issuance** (Part T) — a durable "VIP Pass" or similar record issued once a `reward_threshold` is reached. The ledger/account/program CONFIGURATION foundation (D12–D15) is built; actual threshold-crossing issuance is deliberately deferred rather than built as an unsafe shortcut, matching Part T's own explicit permission to do so. Flutter must show ONLY backend-confirmed entitlements — never a fabricated "reward available" badge (Part AG) — and since none can exist yet, none is shown.
- **Loyalty redemption** — no redemption route exists; `'redeem'` stays a reserved-but-unexercised `loyalty_ledger.entry_type` value, the same `'kit'`-style precedent (D14).
- **Automatic loyalty-earn reversal on refund** — a refund against a sale that earned a stamp/point does not automatically reverse that ledger entry in this pass; this is a known, documented limitation (distinct from D20's membership-specific decision), deferred pending a canonical commercial rule for it.
- **Apple/Google Wallet integration** — foundation only (D17); no provider credentials, no fake pass generation.
- **Customer-identity-dependent promotion conditions** (age, membership tier, birthday, per-customer usage limit) — ADR-0016 D3 explicitly named this as the gap this task would eventually unblock; actually wiring `promotions`' rule engine to reference `customers`/`customer_memberships` is real, separate future work, not silently bundled into this task.
- **Customer merge** — no destructive merge exists; IDs/FKs are structured so a future merge remains possible (D5's conflict responses are the explicit signal a merge would resolve), but none is built here.
- **GDPR-style erasure/anonymization workflow** — `status = 'archived'` (D18) is the retention mechanism this task builds; a real erasure workflow remains separate future work if a canonical requirement is ever approved.
- **Mercado Pago** — untouched and still paused; nothing in this task's scope touches payment provider configuration.
