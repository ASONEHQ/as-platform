# Sellability vs. Inventory Ingredients — ACCESS GO

TASK 17.1.3. Fixes a real production defect: recipe ingredients (e.g. "Masa Pizza PRUEBA", "Mozzarella PRUEBA", "SALSA", "ING-PEPPERONI-TEST") were appearing as ordinary sellable cards in **Ventas → Punto de Venta**. They are real, correctly inventory-tracked `product_variants` rows and must remain fully usable for inventory and recipe authoring — they must simply never be directly sellable through a sales surface unless explicitly configured to be. This document records the audit this task started from, the domain model it landed on, and exactly which surfaces changed.

## 1. Audit (what already existed, before any code changed)

- **No existing sellability concept.** Exhaustive grep across the backend, the database schema, and the Flutter app for `sellable`, `saleable`, `available_for_sale`, `pos_enabled`, `channel visibility`, etc. found no equivalent field. The only near-miss, `PosPricing.isSellable` (`apps/one/lib/features/pos/pos_models.dart`), is an unrelated, purely client-side computed getter about whether a *price* resolved (valid or free vs. missing/malformed) — never persisted, never about direct-sale eligibility. It is a coincidental name collision, not a concept to reuse; this task's new field is deliberately never called `isSellable` in that same file's vocabulary to avoid confusion, though the backend field and the admin-form field are both named `isSellable`/`is_sellable` since they live in a different, unambiguous context (`PosProductVariant`, not `PosPricing`).
- **Current POS visibility rule, before this task:** the Flutter POS grid (`_filter` in `apps/one/lib/features/pos/pos_shell.dart`) keeps only items where `item.status == 'active'` (a **product**-level field) — legacy parity for `AS POS V1.html`'s "Aparece en el Punto de Venta". `tracksInventory` and category were never involved in this decision at all — category only narrows *which already-visible* items show in a given tab.
- **Category is unrelated and was never touched.** Category membership answers "which tab does this appear under," not "can this be sold at all" — the task's own instruction not to conflate the two was already the existing architecture's own separation of concerns.
- **`tracksInventory` exists at both the `products` and `product_variants` level** (a pre-existing, pre-TASK-17.1.3 duplication — the product-level column is a broader default/legacy-parity field; the variant-level one is what `TASK 16.32`'s recipe invariant already keys off). This task never touches either meaning — sellability is a genuinely new, third, orthogonal concept.
- **Sale creation resolves only a product's own DEFAULT variant.** `SalesRepository.resolveProductLines` (`apps/api/src/modules/sales/sales.repository.ts`) joins `product_variants` on `is_default=true and status<>'retired'` — a client can never address a non-default variant directly through `POST /api/v1/sales`. This is what makes a variant-level sellability flag both correct today and safe for the documented future case (a product with a sellable default variant and a non-sellable secondary one).
- **The POS product list/search/barcode-lookup are all the same backend endpoint.** `PosReadGateway.products()` and `.productByBarcode()` (`apps/one/lib/features/pos/pos_read_gateway.dart`) both call `GET /api/v1/products`; POS text search is a client-side filter over whatever that same call already returned. Filtering that one query is therefore sufficient to fix the list, the search, and the barcode scan simultaneously.
- **The recipe-ingredient picker and the admin Productos screen use a *different* gateway** (`PosProductVariantsGateway.listProducts`/`.listVariants`, `apps/one/lib/features/pos/pos_product_variants_gateway.dart`) that never filters by status or sellability at all — confirmed unaffected by construction, not merely by convention.
- **Party consumables (socks/snacks) resolve `product_variants` directly by id**, never through the POS catalog query — confirmed unaffected.
- **Cafetería is the same direct-sale surface as Punto de Venta** — same `PosReadGateway`, same `_filter` function, gated only by `cafeteriaOnly` narrowing which categories show, not a separate product query. It inherits this fix automatically.

## 2. Domain model — four independent concepts

| Concept | Column | Meaning |
|---|---|---|
| **Active** | `products.status` / `product_variants.status` | Is this catalog entity operationally in use at all? |
| **Sellable** | `product_variants.is_sellable` (new) | Can a cashier sell this variant directly, on a sales surface? |
| **Tracks inventory directly** | `product_variants.tracks_inventory` | Does selling this variant decrement its own stock balance? |
| **Recipe** | `product_recipes` (TASK 16.32) | Does selling this variant consume ingredient variants instead? |

The canonical matrix from this task's own real production scenario:

| Product | Sellable | Direct stock | Recipe |
|---|---|---|---|
| Agua (bottled water) | YES | YES | NO |
| Pizza Pepperoni | YES | NO | YES |
| Masa (dough) | NO | YES | NO |
| Mozzarella | NO | YES | NO |
| Salsa | NO | YES | NO |
| Pepperoni (ingredient) | NO | YES | NO |

**`sellable=false` does NOT mean inactive.** It means "cannot be sold directly through a sales surface" — the variant remains fully active, fully visible in the admin Productos screen, fully manageable, fully pickable as a recipe ingredient, and fully tracked in inventory (balances, movements, adjustments, transfers, counts). Only direct, cashier-initiated sale of that exact line item is blocked.

**Level:** sellability lives on `product_variants`, not `products` — the same level as `tracksInventory` and the recipe's own `product_variant_id`, and the only level compatible with a future product whose *default* variant is sellable while a *secondary* variant is not (e.g. a bottled-drink product where a bulk/syrup variant should never be rung up directly).

**Preserved, never weakened:** the TASK 16.32.3 invariant (a variant may not simultaneously `tracks_inventory=true` and have an active recipe — enforced by `variant_direct_stock_conflict`/`variant_active_recipe_conflict`/`conflicting_recipe_configuration`) is completely orthogonal to sellability and was not touched.

## 3. Schema

Additive only — one new column, no destructive change:

```sql
ALTER TABLE "product_variants" ADD COLUMN "is_sellable" boolean DEFAULT true NOT NULL;
```

`packages/database/drizzle/0049_add_product_variant_is_sellable.sql`. Every existing row becomes `is_sellable=true` on migration — the entire pre-existing catalog keeps selling exactly as it did before; nothing is silently hidden. New variants default to `true` unless the create request explicitly opts out (e.g. authoring an ingredient directly as non-sellable).

## 4. Backend enforcement — three independent layers

1. **Read-side filter (`GET /api/v1/products?sellable_only=true`)** — `ProductCatalogRepository.listProducts`, an `exists(...)` subquery requiring the product's own default variant to have `is_sellable=true`. Strictly opt-in: only `PosReadGateway.products()`/`.productByBarcode()` (the POS register, Cafetería, and barcode scan) ever send it. The admin Productos screen and the recipe-ingredient picker never send it, so a hidden ingredient stays fully visible and manageable there.
2. **Write-side authoring** — `product_variants.is_sellable` is a normal, independently-settable field on create (`POST /products/{id}/variants`, and the inline `default_variant` on `POST /products`) and patch (`PATCH /product-variants/{id}`), exactly like `tracksInventory` — never auto-toggled by any other field, never auto-mutates a recipe or inventory balance.
3. **Sale-creation guard (authoritative, `SalesService.createSale`)** — independent of the read-side filter, so a stale client cache or a direct API call can never bypass it. `SalesRepository.resolveProductLines` now also selects the resolved default variant's `is_sellable`; `createSale` rejects with a new `variant_not_sellable` error (400) immediately after the existing `product_not_active` check and before any pricing/currency/inventory work — no sale line, payment, or inventory mutation is ever caused by a rejected item. When no default variant resolves at all (a pre-existing, unrelated edge case some legacy/test fixtures exercise), the check defaults to sellable — it only ever rejects a variant *explicitly* marked non-sellable, never silently rejects a case that was already tolerated before this task.

Recipe consumption itself (`postSaleConsumption` / `sale-consumption.ts`) never inspects `is_sellable` — ingredients are consumed purely by the recipe's own component list, completely indifferent to whether those ingredient variants are sellable.

## 5. Frontend

- `PosProductVariantsScreen`'s variant form gains a **"Disponible para venta"** checkbox (key `pos-product-variants-form-sellable`), next to the existing "Controlar inventario directamente" one, with the exact helper text this task specified. Create defaults ON; edit always reflects the real backend value; the two checkboxes never react to each other, and neither ever mutates a recipe.
- `PosReadGateway.products()`/`.productByBarcode()` send `sellable_only=true` — the sole Dart-side change needed for the POS grid, search, and barcode scan, since all three already funnel through this one gateway/endpoint.
- No change to `pos_shell.dart`'s existing `status=='active'` client-side filter — it keeps working unchanged, now simply operating over an already-narrower, backend-filtered list.
- `AppFailure.fromCode` gains a Spanish message for `variant_not_sellable`, matching the existing pattern for the TASK 16.32.3 recipe-invariant codes.

## 6. What deliberately did not change

- Inventory balances/movements/adjustments/transfers/counts — none of these queries filter on `is_sellable`, by design.
- The recipe authoring service (`product-recipes.service.ts`) and repository — zero references to `is_sellable`; a non-sellable ingredient is exactly as pickable as any other variant.
- Party consumables (socks/snacks) — resolve variants directly by id, unaffected.
- `readiness.repository.ts`'s own, unrelated "sellable_count" concept (a readiness-checklist metric about "has a price and enough stock to fulfill," not about direct-sale eligibility) — out of scope for this task, not touched.
- RBAC — sellability is mutated under the existing `product.manage` permission; selling still uses the existing POS permissions. No new permission was created.
- Audit/outbox — a sellability change flows through the exact same variant-mutation path (`patchVariant`/`createVariant`) that already emits `audit_log`/`outbox_events` rows; no parallel audit mechanism was added.
