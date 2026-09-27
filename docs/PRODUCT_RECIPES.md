# Product Recipes & Inventory Consumption — AS ONE

TASK 16.32. Adds recipes (bill-of-materials) to the catalog: a sellable `product_variants` row (e.g. "Pizza Pepperoni") can declare a list of inventory-tracked ingredient variants + quantities + units, consumed automatically — via real, traceable `inventory_movements` — whenever that variant is actually sold. This document records the architecture audit this task started from, the design it landed on, and what was deliberately deferred.

## 1. Architecture audit (what already existed)

Before writing any schema, the existing catalog/sales/inventory/consumables architecture was audited in full. The findings that shaped every decision below:

- **There is no separate "inventory item" concept.** `product_variants` (`packages/database/src/schema/catalog.ts`) is simultaneously the sellable SKU and the inventory-tracked unit — `tracksInventory` is just a boolean on the same row. A recipe *ingredient* is therefore an ordinary `product_variants` row that is simply never rung up at the register, not a new kind of record.
- **Units of measure already exist and are already decimal-safe.** `units_of_measure` (`code`, `dimension` ∈ `{count, mass, volume}`, `conversion_factor_to_base`) is already wired to every variant (`product_variants.unit_of_measure_code`) and every movement line (`inventory_movement_lines.unit_of_measure_code` + `base_quantity`). Quantities are `numeric(19,6)`, costs `numeric(19,4)`, and all posting code already does bigint fixed-point arithmetic (`sale-consumption.ts`'s `decimalUnits`/`formatDecimal`), never floating point. Nothing new was needed here — a recipe's own quantity/unit columns reuse this system directly.
- **The one authoritative "a sale became real" moment is `SalesRepository.trySettleSale`** (`apps/api/src/modules/sales/sales.repository.ts`), which flips `sales.status` to `completed` inside a single DB transaction and, in that same transaction, calls `postSaleConsumption` (`apps/api/src/modules/inventory/sale-consumption.ts`) — today a strict 1:1 "the sold variant's own stock goes down by the quantity sold" operation, posting one `sale_consumption` movement per sale (one header, one line per distinct tracked variant), guarded by a partial unique index (`inventory_movements_sale_reference_uq` on `(company_id, reference_id) where reference_type='sale'`) so a retried settlement can never double-post.
- **Party-package consumables (socks/snacks — "Fiestas") are NOT a reusable generic engine.** They are two hardcoded, type-specific tables (`party_reservation_socks`/`party_reservation_snacks`), with flat, admin-entered quantities (no per-unit-sold multiplication anywhere) and a manual, operator-triggered deduction button (`deductSock`/`deductSnack`) — never tied to a POS sale-completion event. Good prior art for the *ledger* conventions (movement/audit/outbox shape, negative-stock guard), but not a bill-of-materials engine and not extended by this task.
- **No recipe/BOM/combo/modifier concept existed anywhere.** `products.product_type = 'kit'` is a reserved-but-unexploded placeholder (no combo table, no child-product resolution). There is no order-time modifier/extras concept. Confirmed by exhaustive grep across `packages/database/src/schema` and `apps/api/src/modules`.
- **Cost is available but not location-scoped in the admin UI's context.** `product_variants.standardCost` is a manually curated, always-present, currency-tagged field; `inventory_balances.averageUnitCost` is the more accurate moving-average cost but is scoped per `(location, variant)`, and the recipe admin screen has no branch/location context. See §11.

**Conclusion**: recipes are a genuinely new, small, additive schema domain — but the *consumption* mechanism should extend the existing `sale-consumption.ts`/`trySettleSale` hook rather than invent a second one, so every existing guarantee (atomicity, idempotency, negative-stock policy, audit/outbox shape) is inherited for free instead of re-implemented.

## 2. Domain model

```
product_recipes                       product_recipe_components
  id                                    id
  company_id                            company_id
  product_variant_id  ← the SOLD variant  recipe_id           → product_recipes.id
  is_active                              component_variant_id → product_variants.id (the ingredient)
  version                                quantity   numeric(19,6)
  created_at / updated_at                unit_of_measure_code → units_of_measure.code
  created_by / updated_by                created_at / updated_at / created_by / updated_by
```

- **Keyed by `product_variant_id`, never `product_id`.** `sale_items.product_variant_id` is already the frozen identity `sale-consumption.ts` posts against, and a variable product's different variants (Pizza Chica/Mediana/Grande) may legitimately need different recipes — keying at the variant level gets this for free with no extra join at consumption time and no special-casing (Phase 22).
- **Exactly one recipe per variant** (`unique(company_id, product_variant_id)`), replaced in place via `PUT`, never versioned as multiple historical rows. Editing a recipe changes what a *future* sale consumes; a *past* sale's actual consumption is already an immutable fact — see §8.
- **No duplicate ingredient per recipe** (`unique(company_id, recipe_id, component_variant_id)`, enforced at both the service-validation layer and as a DB backstop) — Phase 8's "prevent" choice over "merge," since silently merging two rows a user explicitly entered separately would hide a data-entry mistake rather than surface it.
- **A component's `quantity`/`unit_of_measure_code` is the amount as authored** (e.g. "180", "g"), which may differ from the ingredient variant's own storage unit (e.g. stocked in "kg"). Consumption-time code converts between the two — see §5.
- Migration: `packages/database/drizzle/0048_add_product_recipes.sql` — two new tables, fully additive (`CREATE TABLE` + indexes + FKs only), no existing table altered.

## 3. The V1 invariant: direct stock OR recipe, never both

**TASK 16.32.3.** A live gap was found before this feature was pushed: nothing stopped a variant from simultaneously having `tracks_inventory=true` *and* an active recipe, which made settlement (§6) consume both the sold variant's own stock and every recipe ingredient for the same sale — an admin could produce this by accident, with no warning.

**The V1 rule, stated once:** a sellable `product_variants` row may use direct inventory tracking *or* an active recipe — never both, never neither-is-ambiguous. There is no third state.

| Product | `tracks_inventory` | Recipe |
|---|---|---|
| Bottled Coca-Cola | `true` | none |
| Pizza Pepperoni | `false` | mozzarella + sauce + pepperoni + dough |
| Merchandise (t-shirt) | `true` | none |
| Park ticket | `false` | none |

This is enforced three times, at three different points, deliberately layered rather than trusted to just one:

1. **Recipe creation/replace** (`product-recipes.service.ts`'s `replaceRecipe`) — rejects with `variant_direct_stock_conflict` (409) if the target variant's own `tracks_inventory` is already `true`. Checked unconditionally, even for an empty `components: []` save or an `is_active: false` one — this variant must never acquire a `product_recipes` row at all while it tracks its own inventory.
2. **The reverse direction** (`product-catalog.service.ts`'s `patchVariant`, the one authoritative variant-mutation path) — rejects with `variant_active_recipe_conflict` (409) if a patch would set `tracksInventory: true` on a variant that still has an active recipe (`ProductCatalogRepository.hasActiveRecipe`, a small, single-purpose cross-table read — `product_recipes` is a sibling module's table, not duplicated business logic). This closes the gap the forward guard alone would leave: without it, an admin could create a recipe first, then flip `tracksInventory` on afterward, silently recreating the exact same ambiguity. (As of this task, this app's own Flutter UI has no `tracksInventory` toggle anywhere, so this path is unreachable from the current UI — it exists for API-level integrity regardless, and to be already correct the day a future screen exposes that toggle.)
3. **Settlement-time defense in depth** (`sale-consumption.ts`, inside `postSaleConsumption`) — for legacy data, manual SQL, import bugs, or any future regression that lets both states coexist despite (1) and (2): every sold variant in the sale is checked, *before any balance is read for mutation*, for `tracks_inventory=true` AND an active recipe at the same time. If found, the whole function throws `conflicting_recipe_configuration` (409) before the movement header is even inserted — which, inside the same settlement transaction as always, rolls back the entire sale, not just the offending line. A multi-line sale (e.g. one ordinary bottled drink + one misconfigured pizza) leaves the drink's own balance completely untouched too — proven by a real test wrapping the call in its own `BEGIN`/`ROLLBACK` and asserting every ingredient balance in the sale, not just the conflicting one, is unchanged afterward.

**Why not a database CHECK constraint or trigger.** `tracks_inventory` lives on `product_variants`; recipe existence lives in a separate table (`product_recipes`). A plain column-level `CHECK` cannot see across tables, so enforcing this at the schema level would require a trigger — a pattern this codebase does not otherwise use for cross-table business invariants (every other invariant here is enforced in the service layer, with the DB used only for single-table constraints and FKs). Introducing the first trigger in this codebase for one feature's guard would be a bigger, riskier architectural change than the invariant itself warrants. The three-layer application/service enforcement above (two authoring-time rejections plus a settlement-time backstop that fails the whole transaction closed) was judged sufficient without it.

**Frontend UX**: the Receta section (`_EditProductDialog` in `pos_shell.dart`) shows a plain informational message — "Este producto controla su propio inventario. Para utilizar ingredientes y consumo por receta, desactiva primero 'Controlar inventario' en la configuración del producto." — instead of the recipe editor whenever the loaded variant tracks inventory directly, and never automatically changes `tracksInventory` itself; that stays an explicit decision the admin makes elsewhere. This is a helpful hint only — the backend guards above are what actually enforce the invariant, and a stale-UI save attempt that somehow reaches the backend anyway surfaces that real, specific rejection message (never the generic "someone else changed this" stale-version copy a same-shaped 409 might otherwise be mistaken for).

## 4. Recipe admin API

Three endpoints, following this codebase's existing conventions exactly (idempotency-key on writes, if-match/etag for optimistic concurrency, the same error-envelope/`AppError` shape):

- `GET /api/v1/product-variants/:variant_id/recipe` — permission `catalog.read` (reused, not invented). `data: null` means "no recipe" — the normal case for most products.
- `PUT /api/v1/product-variants/:variant_id/recipe` — permission `product.manage` (reused). Full-replace semantics: the whole `components` array is sent every time and replaces whatever existed, mirroring this codebase's own established "one PUT replaces the whole child collection" precedent (`role.permission.manage` → `PUT /roles/:id/permissions`).
- `DELETE /api/v1/product-variants/:variant_id/recipe` — permission `product.manage`.

No new permission was created. `catalog.read`/`product.manage` already gate every other product/variant read and write in this codebase; a recipe is conceptually part of a product's own configuration, not a separate authorization domain.

Validation enforced server-side (Phase 34): quantity > 0 with ≤6 decimals; ingredient must be a real, same-company, stock-tracked (`tracks_inventory=true`) variant; ingredient ≠ the recipe's own variant (no self-consumption); no duplicate ingredient in one request; the entered `unit_of_measure_code`'s `dimension` must match the ingredient's own native unit's `dimension` (Phase 5 — grams can be entered for a kilogram-stocked ingredient because both are `mass`; grams can never be entered against a `volume`- or `count`-native ingredient); the recipe's OWN variant must not itself track inventory directly (§3's V1 invariant).

## 5. Unit safety and conversion

Every unit involved already has a `dimension` (`count`/`mass`/`volume`) and a `conversion_factor_to_base`. Recipe authoring rejects any component whose unit's dimension doesn't match its ingredient's own native unit's dimension — so by the time a sale is being settled, every stored component is already known-convertible. Consumption-time conversion (`apps/api/src/modules/inventory/sale-consumption.ts`) is a single ratio in bigint fixed-point (scale 1,000,000, matching every other quantity column in this schema):

```
consume(ingredient-native-unit) = recipe.quantity × sale_item.quantity × (recipe.unit.factor / ingredient.unit.factor)
```

e.g. a recipe of "180 g" cheese, an ingredient variant stocked in "kg" (factor 1000 vs. gram's factor 1), 2 pizzas sold → `180 × 2 × (1/1000) = 0.36` kg consumed. No cross-dimension conversion is ever attempted (Phase 5) — a mismatch is rejected at authoring time, and defensively re-checked (and rejected as `invalid_recipe_component`, HTTP 409) at consumption time in case an ingredient's own unit was changed after the recipe was saved.

## 6. Sale-triggered consumption

`postSaleConsumption` (`apps/api/src/modules/inventory/sale-consumption.ts`) — the exact same function and the exact same single `sale_consumption` movement `trySettleSale` already posted before this task — now additionally: for every sold line whose variant has an active recipe, expands it into extra ingredient-consumption lines (multiplied by the quantity sold, unit-converted per §5), appended to that same movement. A product with no recipe is completely unaffected — `recipeLines` is simply empty, and the function's output is byte-identical to before this task (Phase 28 backward compatibility, proven by the pre-existing `inventory-e2e.integration.test.ts` still passing unmodified). Before any of that, it also enforces the §3 V1 invariant as a defense-in-depth backstop — see §3, item 3, for that behavior in full.

This was a deliberate choice over posting a second, separate movement: reusing the same movement means recipe consumption inherits every guarantee already proven for `sale_consumption` movements, for free —

- **Atomicity (Phase 12)**: same DB transaction as the sale's own settlement (and the payment capture it's nested inside). A mid-recipe stock shortfall throws, which rolls back the *entire* settlement — no half-consumed recipe, no completed sale with a silently-failed inventory side effect.
- **Idempotency (Phase 16)**: the existing partial unique index `inventory_movements_sale_reference_uq` (`(company_id, reference_id) where reference_type='sale'`) already makes a second movement for the same sale a hard constraint violation — a retried settlement (a replayed payment callback, two racing workers) can never double-consume a recipe's ingredients, with zero new infrastructure.
- **Negative-stock policy (Phase 20)**: recipe lines are checked against the exact same `next < 0 or next < reserved` guard every other movement already enforces — no second, recipe-specific stock policy was introduced.
- **Traceability (Phase 13)**: each recipe-driven `inventory_movement_lines` row's previously-unused `metadata` jsonb column now carries `{source: 'recipe', recipe_id, recipe_component_id, sold_product_variant_id, sold_product_name_snapshot, sale_item_quantity, recipe_component_quantity, recipe_component_unit_of_measure_code}` — a direct (non-recipe) line's `metadata` stays `null`, exactly as before.
- **Aggregation across products (Phase 15)**: if two different products sold in the same sale share an ingredient (e.g. pizza and nachos both consume cheese), each contributes its own separate movement line — never silently merged into one aggregate number — matching this ledger's existing per-source-line granularity (a repeated variant across different sale lines already produced separate lines before this task).

## 7. Cancellation, refunds, and partial refunds (Phase 17–19)

- **Cancellation**: a sale can only ever be cancelled while `pending_payment` (`SalesService.cancelSale`) — before `postSaleConsumption` has run at all. There is nothing to reverse; recipe consumption is simply never triggered for a cancelled sale. No code change was needed here.
- **Refunds do NOT restock recipe ingredients — a deliberate V1 decision, not an oversight.** `RefundsService.completeRefund` → `postSaleReturn` already only restocks the *sold* variant's own line (when `restockDisposition='restock'`), never expands a recipe. Extending it to also restock ingredients would silently assume every ingredient is physically recoverable — true for an unopened bottle, false for cooked/prepared food (the exact case this feature targets: pizza, frappé, nachos). Rather than guess, this task leaves the existing restock-disposition logic completely untouched: refunding a recipe-based product's sale reverses payment/discount/reward effects as it already did, and restocks the sold variant's own stock if that variant separately tracks inventory and `restockDisposition='restock'` — but never touches the ingredients its recipe consumed. This applies uniformly to full and partial (line-level, via `refund_items`) refunds alike — one rule, not two.

## 8. Historical correctness (Phase 29)

Recipes are not versioned. Editing a recipe (or deleting it) only changes what a *future* sale consumes. A past sale's actual consumption is already an immutable fact, captured at posting time inside that sale's own `inventory_movement_lines.metadata` (recipe id, component id, and the exact quantity/unit used at that moment) — so there is nothing for a recipe version history to protect that isn't already protected by the movement ledger itself, which this codebase already treats as the one source of historical truth (movements are never rewritten, only reversed).

## 9. Variants, modifiers, combos, party consumables (Phase 22–25)

- **Variants**: handled natively — a recipe is already keyed per-variant (§2), so Pizza Chica/Mediana/Grande can each carry their own recipe with no special-casing.
- **Modifiers/extras**: confirmed absent from the catalog entirely (§1). Documented as a clean future extension point (an order-time "+extra queso" would need its own quantity delta added on top of the base recipe at consumption time) — not built in this task, per the brief's own instruction not to invent a modifier subsystem here.
- **Combos**: `product_type='kit'` remains exactly as unexploded as before this task — no combo/bundle resolution exists to interact with, so there is no double-consumption risk to guard against yet.
- **Party consumables**: a structurally distinct, untouched trigger path (an operator-pressed "deduct" button on a party reservation, §1) versus this feature's trigger (automatic, at sale settlement). They can never double-consume each other because they are wired to entirely different code paths, different tables, and — for products actually rung up through POS — party consumables were never involved in the first place.

## 10. Tenant/branch isolation & RBAC (Phase 30–31)

Every recipe query is scoped by `company_id` exactly like every other table in this schema (composite FKs, `where company_id=$1`). A recipe can never reference another company's variant — enforced both by application-layer validation (a clear `validation_error`, never a leaked cross-tenant existence check) and by the composite FK `(company_id, component_variant_id) → product_variants(company_id, id)` as a DB-level backstop. Consumption always posts against the sale's own `branch_id`'s single default inventory location, exactly as the pre-existing direct-consumption path already did — recipes introduce no second location-resolution rule. RBAC reuses `catalog.read`/`product.manage` (§4) — no new permission, no RBAC weakening.

## 11. Recipe cost and availability (Phase 10, 21) — deferred

**Cost**: not implemented in the admin UI in this pass. `product_variants.standardCost` is a manually curated, branch-independent field that *could* provide a rough recipe cost, but the more accurate `inventory_balances.averageUnitCost` is location-scoped and the recipe admin screen (inside the product edit dialog) has no branch context to resolve it against — fabricating a "recipe cost" from the wrong cost basis would be worse than not showing one. Deferred rather than guessed, per the brief's own "do not fabricate costs" instruction.

**"Can I make this?" availability** (limiting-ingredient calculation across all recipes and current stock): a real, useful, but secondary feature explicitly marked as such by the brief. Deferred to a future task rather than delaying or diluting the core consumption feature.

## 12. Known limitations

- No recipe cost display (§11).
- No "how many can I make" availability calculation (§11).
- No order-time modifiers/extras affecting recipe quantity (§9).
- No combo/kit recipe resolution (§9) — `kit` remains unexploded.
- Refunds never restock recipe ingredients, by deliberate design (§7) — this is a business decision, not a gap, but it means a refunded pizza's cheese/dough/etc. stay consumed.
- The reverse direct-stock/recipe guard (§3, item 2) is currently unreachable from this app's own Flutter UI, which has no `tracksInventory` toggle anywhere — it protects API-level integrity regardless, and is already correct the day a future screen exposes that toggle.

The direct-stock/recipe double-consumption ambiguity that TASK 16.32's own pre-push gate (TASK 16.32.1) flagged as an undocumented risk is resolved — see §3.

## 13. Deployment dependency: migration 0048 must precede recipe-aware traffic

`postSaleConsumption`'s recipe-lookup query (`select ... from product_recipes ...`) is **unconditional** for any sale with at least one resolved variant identity — not gated behind "does this sale involve a recipe." This means the API version containing recipe-aware sale settlement has a hard, load-bearing dependency: **migration `0048_add_product_recipes` must have already succeeded against the target database before that API version receives any sale-settlement traffic.** If it hasn't, `product_recipes` doesn't exist yet and *every* sale settlement — not just recipe-linked ones — fails with a "relation does not exist" error, not just recipe-specific requests.

Concretely, this means: **0048 succeeds, then the new recipe-aware API is promoted — never the reverse, and never promoted with 0048 in an unknown or failed state.**

This is stated as a requirement on the deployment *process*, not as something already guaranteed by this repository's current tooling. TASK 16.32.2's own read-only investigation explicitly found no evidence, in this repository, that a failed `db:migrate` step actually blocks the API from being promoted on DigitalOcean — no GitHub Actions workflow exists here to enforce it, and no `.do/app.yaml`-equivalent infra-as-code file exists to inspect. **Do not assume the current pipeline enforces this hard-block — TASK 16.32.2 found it NOT CONFIRMED, and that finding stands** until someone with access to the actual DigitalOcean App Platform job configuration verifies it directly. The correct fix for a deployment-ordering gap is deployment ordering itself (verifying the migration job's own success before promoting the app), never a code-level fallback that catches "relation does not exist" and pretends a product simply has no recipe — that would hide a failed migration instead of surfacing it, and was deliberately not done here.
