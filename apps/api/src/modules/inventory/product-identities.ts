/// TASK 17.2 — shared, read-model-only product-variant identity resolver
/// for the inventory admin surfaces (movement/transfer/count/reservation
/// lines, and the balances list). Every one of those tables stores only
/// `product_variant_id` — never a name/SKU snapshot — so a human-readable
/// "what is this line about" requires the exact same batched join
/// `ProductRecipeRepository.ingredientIdentities`
/// (`apps/api/src/modules/catalog/product-recipes.repository.ts`) already
/// established for recipe-ingredient identity: resolved fresh from the
/// live catalog on every read, never persisted, never a per-row N+1 —
/// callers pass every variant id from an already-fetched page/detail in
/// one batch. A renamed product/variant is reflected immediately; this is
/// a deliberate, pre-existing trade-off already accepted for recipes (see
/// docs/PRODUCT_RECIPES.md) and is not a new one introduced here.
export interface ProductVariantIdentity {
  /** The variant's own name if set, else the parent product's name —
   * mirrors `ProductRecipeRepository`'s exact `coalesce(nullif(btrim(...
   * )), ...)` rule so the SAME variant is described identically whether
   * seen through the recipe picker or the inventory ledger. */
  readonly name: string;
  readonly sku: string;
  readonly unitOfMeasureCode: string;
  /** TASK 17.1.3 — whether this variant may be sold DIRECTLY at POS.
   * `false` is the canonical "Insumo" / ingredient case (e.g. "Masa
   * Pizza"): real, inventory-tracked, never a fabricated classification —
   * see `docs/SELLABILITY.md`. */
  readonly isSellable: boolean;
}

interface IdentityRow {
  variant_id: string;
  sku: string;
  name: string | null;
  unit_of_measure_code: string;
  is_sellable: boolean;
}
interface Executor {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}
interface QueryResult<T> {
  rows: readonly T[];
}
function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

/** Batched, company-scoped lookup — `undefined` entries in the returned
 * map (a variant id with no matching row, e.g. a retired/deleted variant
 * in old history) are the caller's responsibility to handle honestly
 * (never fabricate a name for one). */
export async function resolveProductVariantIdentities(
  executor: Executor,
  companyId: string,
  variantIds: readonly string[],
): Promise<Map<string, ProductVariantIdentity>> {
  if (variantIds.length === 0) return new Map();
  const rows = result<IdentityRow>(
    await executor.query(
      `select v.id as variant_id, v.sku, v.unit_of_measure_code, v.is_sellable,
              coalesce(nullif(btrim(v.name), ''), p.name) as name
       from product_variants v
       join products p on p.company_id = v.company_id and p.id = v.product_id
       where v.company_id = $1 and v.id = any($2::uuid[])`,
      [companyId, [...new Set(variantIds)]],
    ),
  ).rows;
  return new Map(
    rows.map((row) => [
      row.variant_id,
      {
        name: row.name ?? row.sku,
        sku: row.sku,
        unitOfMeasureCode: row.unit_of_measure_code,
        isSellable: row.is_sellable,
      },
    ]),
  );
}
