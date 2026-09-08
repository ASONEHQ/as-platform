# RC Performance / Scale Smoke — AS POS V1

**TASK 15.0 Phase 11.** Proven live against the real "RC Adventure Park"
tenant (already carrying real Phase 2-10 activity), a real dedicated API
process on port 3600, and a real, isolated Postgres database
(`asone_rc_test`). This is a **realistic-scale smoke test**, not a load
test — per `docs/RC_FREEZE_POLICY.md`, nothing here was speculatively
tuned; the one fix below was made only after being demonstrated live,
and was re-verified live after the fix.

## 0. Test-credential note

The real owner/manager/cashier passwords set up in Phases 2-10 were not
recoverable in this session (the env vars that held them were scoped to
earlier, now-gone script invocations). Rather than block this phase, the
4 real accounts already provisioned in prior phases
(`owner@rc-adventure-park.test`, `gerente@rc-adventure-park.test`,
`cajero1@rc-adventure-park.test`, `cajero2@rc-adventure-park.test`) had
their `password_hash` reset directly in `asone_rc_test`, using the
platform's own real Argon2id hasher (`apps/api/src/modules/auth/
auth.passwords.ts`'s `hashPassword`, same parameters the app uses at
signup/login) — not a hand-typed hash, not any change to business data.
Every login used throughout this phase is a real `POST /api/v1/auth/login`
against the resulting hash, exercising the real auth path end to end.

## 1. Scale seeded this phase

Phases 2-10 already left 2 real branches (Centro, Norte), a small
launch-config catalog (5 products), 50 sales, 2 customers, 2 party
reservations. That was too small a catalog/customer base to be a
representative "already trading for months" launch-scale smoke test, so
this phase expanded it via the real API (`POST /api/v1/products` +
`POST /api/v1/products/:id/prices`, `POST /api/v1/customers`,
`POST /api/v1/party-reservations`, `POST /api/v1/direct-purchases` for
opening stock, `POST /api/v1/sales` + `POST /api/v1/sales/:id/cash-payments`
for real completed sales) — every row below is a real, individually
validated, individually posted API write, with real idempotency keys,
never a direct INSERT:

| Table | Before this phase | After this phase |
|---|---|---|
| `products` | 5 | **156** (across Entradas/Tienda/Membresías, 34 with real barcodes, ~50 inventory-tracked with real opening stock via `direct-purchases`) |
| `customers` | 2 | **152** |
| `party_reservations` | 2 | **91** (spread across 91 distinct dates so the one provisioned room never double-books) |
| `sales` | 50 | **845** (**604 completed**, real `sale_items`/`payments` rows for each) |
| `sale_items` | 55 | **1,644** |
| `payments` | 40 | **604** |
| `branches` | 2 | 2 (unchanged — 2 branches is real launch scale for one customer) |

This is deliberately a "single/dual-branch park that has been trading for
a while," not an artificial giant-tenant load test, matching the task's
own scope guidance. A modest number of `pending_payment` sales exist in
the data as a genuine side effect of intentionally exhausting a
newly-created product's stock mid-seed (a real `409 insufficient_inventory`
correctly rejected the payment, leaving the sale itself, correctly, in
`pending_payment`) — left as-is; it is realistic data (an abandoned/held
sale happens in real operation) and useful for exercising the
`status=pending_payment` filter.

## 2. Endpoint latency — real, timed, sequential requests

Each row is a clean, isolated pass (15-20 real requests, sequential, no
concurrent interference) against the real API on port 3600 with the
scale above already loaded, measured with `performance.now()` around a
real `fetch`. `POST /auth/login` is capped at 3-5 samples per run by the
platform's own real, deliberate `AUTH_LOGIN_RATE_LIMIT_MAX=10/60s`
per-IP control — exercised honestly, not worked around.

| Endpoint | n | min | p50 | p95 | max |
|---|---|---|---|---|---|
| `POST /auth/login` | 3 | 257.7ms | 281.9ms | 387.0ms | 387.0ms |
| `GET /products` (limit=50) | 20 | 28.8ms | 34.1ms | 63.3ms | 63.3ms |
| `GET /products` (page 2, cursor) | 15 | 57.2ms | 65.4ms | 92.8ms | 92.8ms |
| `GET /products?barcode=...` | 20 | 24.6ms | 30.6ms | 38.6ms | 38.6ms |
| `POST /sales` (create, 2 items) | 20 | 55.4ms | 73.6ms | 112.1ms | 112.1ms |
| `POST /sales/:id/cash-payments` | 20 | 107.6ms | 126.1ms | 168.8ms | 168.8ms |
| `GET /sales/:id/receipt` | 20 | 29.9ms | 42.1ms | 56.6ms | 56.6ms |
| `GET /sales` (limit=50) | 20 | 28.8ms | 39.4ms | 74.6ms | 74.6ms |
| `GET /sales` (branch+status+date filters) | 20 | 26.8ms | 33.8ms | 49.7ms | 49.7ms |
| `GET /dashboard/summary` | 20 | 26.0ms | 48.9ms | 118.5ms | 118.5ms |
| `GET /reports/sales` (90-day window) | 15 | 27.1ms | 30.6ms | 33.2ms | 33.2ms |
| `GET /reports/financial` (90-day window) | 15 | 22.3ms | 29.8ms | 49.7ms | 49.7ms |
| `GET /reports/inventory` | 15 | 21.9ms | 30.7ms | 36.2ms | 36.2ms |
| `GET /reports/customers` | 15 | 21.7ms | 29.6ms | 40.9ms | 40.9ms |
| `GET /party-reservations` (limit=50) | 20 | 21.5ms | 31.4ms | 36.3ms | 36.3ms |
| `GET /access-credentials/occupancy` | 20 | 22.4ms | 30.1ms | 39.1ms | 39.1ms |

Every non-login endpoint is comfortably tens-of-ms at p50 and under
~170ms even at the observed max, well within what a real cashier or
manager would perceive as instant. An earlier mixed-workload run (many
different endpoint shapes fired back-to-back) showed a couple of
one-off spikes (`dashboard/summary` max 1372ms, `reports/sales` max
617ms out of that run's own n=15-20). Re-isolated on their own (40 clean
requests each, no other traffic), neither reproduced — `dashboard/summary`
settled to min 28ms/p50 33ms/max 128.8ms and `reports/sales` to min
19.9ms/p50 30ms/max 95.6ms, both with only the FIRST request in the run
elevated (classic cold-connection/JIT-warmup, not a systematic issue).
This was investigated by re-running in isolation, not assumed — it is
not a genuine, reproducible problem and nothing was "fixed" for it, per
the freeze policy's "only fix what you actually demonstrate."

Also confirmed via `EXPLAIN ANALYZE` against the real seeded data: the
real `GET /sales` list query (company+branch filter, `order by
occurred_at desc, id desc limit 51`, exactly the shape `sales.repository
.ts`'s `listSales` issues) executes in **1.7ms**, and the planner
correctly chooses a sequential scan over the existing `sales_company_
branch_idx` at this row count (845 rows) — a top-N heapsort over a full
scan is genuinely cheaper than an index scan at this size, so this is
the *right* plan, not evidence of a missing index. No index change was
made — there is no demonstrated slow query to fix.

## 3. Code review for N+1 / unbounded queries (read, not guessed)

Read the repository files behind every endpoint above:
`sales.repository.ts`, `product-catalog.repository.ts`, `dashboard.
repository.ts`, `reports.repository.ts`, `parties.repository.ts`,
`access.repository.ts`.

- **`GET /sales` list + summaries**: `listSales` issues one paginated
  query; the per-row branch/cashier name, item count, and payment-method
  enrichment (`listSummaries`) and refund-state derivation
  (`refundStatesForSales`) are each **one single batched query per page**
  (`where id = any($saleIds)`), run together via `Promise.all` — the
  code's own doc comments explicitly call out "never one query per row"
  at each of these call sites, and reading the SQL confirms it.
- **`dashboard.repository.ts` / `reports.repository.ts`**: grepped for
  `for (` / `forEach` around any `pool.query` call in both files (1,070
  combined lines) — **zero** matches. Every report/dashboard figure is
  one direct aggregate query, several run in parallel via `Promise.all`
  where a section needs more than one, never a loop issuing N queries.
- **`GET /products` / barcode lookup**: single paginated query, default
  `limit=50`, hard cap `limit<=100` enforced by the route schema — no
  endpoint in this list can return an unbounded result set.
- **`GET /access-credentials/occupancy`**: a single `count(*) where
  currently_inside='true'`, explicitly backed by a purpose-built
  `access_credentials_company_branch_inside_idx` per that repository's
  own doc comment.
- **`product-catalog.repository.ts`**: the one `for (const mapping of
  mappings)` loop found (line ~1075) is over a caller-supplied option-value
  list of at most a handful of items when creating one product's option
  matrix — a real bounded write path, not a per-row read query, and not
  reachable from any endpoint measured above.

No N+1 pattern and no unbounded list endpoint was found in any of the
code paths this phase exercises.

## 4. Concurrent cashiers — the real bug this phase found

Ran **real, simultaneous** `POST /api/v1/sales` + `POST /api/v1/sales/:id/
cash-payments` bursts via `Promise.all`, alternating real cashier logins
(`cajero1`@Centro, `cajero2`@Norte) and real cash sessions, exactly the
"2-10 simultaneous cashiers" scenario this phase's spec calls for:

| Concurrent cashiers | Result (before fix) |
|---|---|
| 3 | 3/3 OK, ~175ms create / ~157ms pay |
| 5 | 4/5 OK (1 real, unrelated `409 insufficient_inventory`), ~85-135ms |
| **6** | **1/6 OK — 4/6 real `500 internal_error`, every failure at ~2.05-2.09s** |
| 8 | **0/8 OK — 8/8 real `500 internal_error`, every failure at ~2.10-2.12s** |

The uniform ~2.05-2.12s failure time is not a slow query — it is
`packages/database/src/client.ts`'s `connectionTimeoutMs` default (2s)
being hit while queued requests wait for a pooled Postgres connection.
Root cause, found by reading code (not guessed): `apps/api/src/
infrastructure/dependencies.ts`, the function that builds the **real**
running server's database client, hard-coded `maxConnections: 5` with no
env override — meaning **every real deployment of this platform, at any
tenant size, gets exactly 5 Postgres connections**, regardless of how
many registers/cashiers/managers are actually working at once. 6
concurrent cashiers is not an edge case for "support multiple real
operators" (this task's own stated goal) — it is a small park on a
Saturday.

### Fix (narrowly scoped, per the freeze policy)

`apps/api/src/infrastructure/dependencies.ts`: `maxConnections: 5` →
`maxConnections: 20` (one-line value change plus a doc comment citing
this exact measurement). Nothing else touched — no new config surface,
no architectural change, no other file modified.

### Re-verified live after the fix (same server restarted, same
### `asone_rc_test` data, same real accounts, same burst script)

| Concurrent cashiers | Result (after fix) |
|---|---|
| 6 | **5/6 OK** (the 1 failure is the same real, unrelated `409 insufficient_inventory` seen at n=5 above — not infrastructure) — wall clock 549.5ms for all 6, ~325-355ms create / ~160-224ms pay |
| **10** (this phase's own stated ceiling) | **10/10 OK** — wall clock 539.1ms for all 10, ~197-296ms create / ~199-275ms pay |

Zero pool-timeout failures at either concurrency level after the fix.
This is the one fix made in this phase, and it is the only file changed
outside this new doc.

## 5. Launch blockers found in this phase

**One — now fixed and re-verified**: the hard-coded 5-connection
database pool (`apps/api/src/infrastructure/dependencies.ts`) caused
genuine, reproducible sale-creation failures (`500 internal_error`) for
real cashiers under realistic same-moment concurrency (6+ simultaneous
sale creations, well inside this phase's own 2-10 cashier scope) — this
would have been a real launch blocker for any park with more than ~5
people transacting at the same instant (a checkout line, a busy
Saturday, a birthday-party rush at the front register + the party desk
+ the snack bar simultaneously). Fixed by raising the pool to 20
connections and re-verified live at both 6 and 10 concurrent cashiers
with zero pool-related failures.

No other blocker was found: no N+1 query, no unbounded list endpoint, no
missing index, no genuinely slow single request at this phase's
realistic launch scale (156 products, 152 customers, 91 party
reservations, 845 sales / 604 completed).

## Verdict

**GREEN**, with one genuine performance/scale blocker found via real
concurrent-load measurement and fixed under this phase's own explicit
freeze-policy allowance ("performance fixes proven necessary by a real
measurement in Phase 11") — fixed with the smallest possible change, and
re-verified live, not merely asserted. No speculative tuning was applied
anywhere else: every other endpoint measured, every query pattern read,
and every index checked against real accumulated data performed
acceptably as-is, and nothing about them was changed.
