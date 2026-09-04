# Local owner bootstrap

This development-only command provisions the first database-backed AS ONE owner identity. It is guarded to `development` or `test`, loopback PostgreSQL, and an allowlisted database name. It refuses staging, demo, production, ambiguous environments, weak passwords, and protected database targets.

The bootstrap creates or safely reconciles `Inflapark Group`, six active development branches, `ceo@inflapark.local`, one active membership, the company-wide `owner` role, existing approved administrative permissions, explicit access to all six branches, and one sanitized audit record. It creates no business or financial data.

## Local sequence

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
# Edit .env locally and set AS_DEV_BOOTSTRAP_PASSWORD to a unique strong temporary value.
docker compose up -d --force-recreate postgres redis
docker compose ps
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd --filter @asone/api dev:bootstrap-owner
pnpm.cmd --filter @asone/api dev
```

In a second terminal:

```powershell
cd apps/one
C:\src\flutter\bin\flutter.bat run -d chrome --web-hostname=127.0.0.1 --web-port=8080 --dart-define=AS_ENV=local --dart-define=AS_API_BASE_URL=http://127.0.0.1:3000
```

Open `http://127.0.0.1:8080` and sign in as `ceo@inflapark.local` using the value supplied through `AS_DEV_BOOTSTRAP_PASSWORD`.

The `.env` file is ignored by Git. Never reuse the local password, database password, Redis password, or JWT secret in staging or production. The bootstrap output contains status and counts only; it never returns password material, hashes, tokens, or connection strings.

## POS catalog dev seed (TASK 12.3C)

`dev:seed-pos-catalog` populates a real, priced, tax-classified test catalog — six categories, ten products with real SKUs, company-wide prices, and opening-balance inventory for the three stock-tracked retail items — so the Flutter POS/CLIENTE flow can be exercised against real backend data instead of Flutter-side fixtures. It targets only the `inflapark-group` company and its branches created by `dev:bootstrap-owner`, resolved by slug; it never creates that company itself and refuses to run if it isn't found yet. Like the owner bootstrap, it is guarded to `development` or `test`, a loopback PostgreSQL target, and an allowlisted database name — it refuses production, staging, demo, or any other target. It creates no discounts, promotions, coupons, or dynamic pricing, and it performs no checkout, payment, or stock-decrementing sale.

This seed is exclusively for local/CI development. It is completely isolated from production, is never invoked automatically, and never touches any company other than the fixed development fixture it resolves by slug. Real companies create and manage their own products, categories, prices, and inventory from the administration module.

Every entity is created through the real catalog and inventory services — `CatalogService`, `ProductCatalogService`, `InventoryLocationService`, `InventoryDraftService`, `InventoryPostingService` — each call keyed by a deterministic idempotency key derived from the entity's natural identifier (never a raw insert), so the command is safe to re-run: it always replays its prior result instead of duplicating or erroring, and prints a JSON summary of what was created versus what already existed.

```powershell
pnpm.cmd --filter @asone/api dev:bootstrap-owner
pnpm.cmd --filter @asone/api dev:seed-pos-catalog
```

Example first-run output:

```json
{"company":"inflapark-group","branches":6,"categories":{"created":6,"existing":0},"products":{"created":10,"existing":0},"variants":{"created":10,"existing":0},"prices":{"created":10,"existing":0},"inventoryLocations":{"created":6,"existing":0},"inventoryBalances":{"created":18,"existing":0},"success":true}
```

Re-running it prints the same shape with everything reported `existing` and nothing duplicated.

## Cash register dev seed (TASK 12.7 Part U)

`dev:seed-cash-registers` creates exactly one active `cash_registers` row (`CAJA-1`) per existing branch of the `inflapark-group` development company — the minimum every branch needs before a human can open a cash session at all. It targets the same fixed company/branches `dev:bootstrap-owner` created, resolved by slug, and refuses to run if that company doesn't exist yet. Guarded identically to `dev:seed-pos-catalog`: `development`/`test` only, loopback PostgreSQL, allowlisted database name.

It deliberately does **not** open a cash session or seed an opening float — "the human must open the drawer manually in QA" (TASK 12.7 Part U). Every register is created through the real `CashService.createRegister`, keyed by a deterministic per-branch idempotency key, so re-running the command is a safe no-op.

```powershell
pnpm.cmd --filter @asone/api dev:bootstrap-owner
pnpm.cmd --filter @asone/api dev:seed-cash-registers
```

Example first-run output:

```json
{"company":"inflapark-group","registers":{"created":6,"existing":0},"success":true}
```

Re-running it prints the same shape with `registers` reported `existing` and nothing duplicated.
