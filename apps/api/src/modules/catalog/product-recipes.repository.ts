import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type {
  ProductRecipeComponentInput,
  ProductRecipeComponentRow,
  ProductRecipeMutationContext,
  ProductRecipeRow,
  ProductRecipeTransaction,
} from './product-recipes.types.js';
import { ProductRecipeError } from './product-recipes.types.js';

interface QueryResult<T> {
  readonly rows: readonly T[];
}
interface RecipeDb {
  id: string;
  company_id: string;
  product_variant_id: string;
  is_active: boolean;
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface ComponentDb {
  id: string;
  company_id: string;
  recipe_id: string;
  component_variant_id: string;
  quantity: string;
  unit_of_measure_code: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}
interface Executor {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface IngredientVariant {
  id: string;
  unitOfMeasureCode: string;
  unitOfMeasureDimension: string;
  tracksInventory: boolean;
  status: string;
}
export interface UnitOfMeasureRow {
  code: string;
  dimension: string;
  status: string;
}
export interface RecipeHeader {
  id: string;
  isActive: boolean;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

const RECIPE_COLUMNS = 'id,company_id,product_variant_id,is_active,version,created_at,updated_at';
const COMPONENT_COLUMNS =
  'id,company_id,recipe_id,component_variant_id,quantity,unit_of_measure_code,created_at,updated_at';

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function recipe(row: RecipeDb, components: ProductRecipeComponentRow[]): ProductRecipeRow {
  return {
    id: row.id,
    companyId: row.company_id,
    productVariantId: row.product_variant_id,
    isActive: row.is_active,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    components,
  };
}
interface IngredientIdentity {
  name: string | null;
  sku: string | null;
}

function component(row: ComponentDb, identity: IngredientIdentity): ProductRecipeComponentRow {
  return {
    id: row.id,
    companyId: row.company_id,
    recipeId: row.recipe_id,
    componentVariantId: row.component_variant_id,
    quantity: row.quantity,
    unitOfMeasureCode: row.unit_of_measure_code,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ingredientName: identity.name,
    ingredientSku: identity.sku,
  };
}
const unresolvedIdentity: IngredientIdentity = { name: null, sku: null };
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export class ProductRecipeRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(
    callback: (client: ProductRecipeTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const value = await callback(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw this.mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async idempotent<T>(
    client: ProductRecipeTransaction,
    context: ProductRecipeMutationContext,
    operation: string,
    key: string,
    requestHash: string,
    resourceType: string,
    decode: (value: unknown) => T,
    create: () => Promise<T & { id: string }>,
  ): Promise<{ value: T; replayed: boolean }> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${operation}:${key}`,
    ]);
    const existing = result<IdempotencyDb>(
      await client.query(
        `select request_hash,response_body from idempotency_keys
         where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash || existing.response_body === null)
        throw new ProductRecipeError(
          'idempotency_conflict',
          'The idempotency key was used with another request.',
        );
      return { value: decode(existing.response_body), replayed: true };
    }
    const id = randomUUID();
    await client.query(
      `insert into idempotency_keys
       (id,company_id,key,operation,request_hash,expires_at,created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        context.companyId,
        key,
        operation,
        requestHash,
        new Date(context.timestamp.getTime() + 86_400_000),
        context.timestamp,
      ],
    );
    const value = await create();
    await client.query(
      `update idempotency_keys set response_status=200,response_body=$2::jsonb,
       resource_type=$3,resource_id=$4,completed_at=$5 where id=$1`,
      [id, JSON.stringify(value, jsonValue), resourceType, value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: ProductRecipeTransaction,
    context: ProductRecipeMutationContext,
    input: {
      action: string;
      resourceType: 'product_recipe';
      resourceId: string;
      eventType: string;
      version: bigint;
      payload: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await client.query(
      `insert into audit_log
       (id,company_id,actor_type,actor_id,action,entity_type,entity_id,request_id,correlation_id,metadata,occurred_at)
       values ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        randomUUID(),
        context.companyId,
        context.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        context.requestId,
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
    await client.query(
      `insert into outbox_events
       (event_id,company_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,
        correlation_id,payload,occurred_at)
       values ($1,$2,$3,1,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        randomUUID(),
        context.companyId,
        input.eventType,
        input.resourceType,
        input.resourceId,
        input.version.toString(),
        context.correlationId,
        JSON.stringify(input.payload),
        context.timestamp,
      ],
    );
  }

  // ---- reads (non-transactional; GET route) ----

  public async variantExists(companyId: string, variantId: string): Promise<boolean> {
    return (
      result<{ exists: boolean }>(
        await this.database.pool.query(
          'select exists(select 1 from product_variants where company_id=$1 and id=$2) exists',
          [companyId, variantId],
        ),
      ).rows[0]?.exists ?? false
    );
  }

  public async recipeByVariant(
    companyId: string,
    variantId: string,
  ): Promise<ProductRecipeRow | null> {
    const row = result<RecipeDb>(
      await this.database.pool.query(
        `select ${RECIPE_COLUMNS} from product_recipes where company_id=$1 and product_variant_id=$2`,
        [companyId, variantId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    const components = await this.componentsForRecipe(this.database.pool, companyId, row.id);
    return recipe(row, components);
  }

  // ---- mutation-time lookups/writes (within a transaction) ----

  public async lockVariant(
    client: ProductRecipeTransaction,
    companyId: string,
    variantId: string,
  ): Promise<{ id: string; tracksInventory: boolean } | null> {
    const row = result<{ id: string; tracks_inventory: boolean }>(
      await client.query(
        'select id, tracks_inventory from product_variants where company_id=$1 and id=$2 for update',
        [companyId, variantId],
      ),
    ).rows[0];
    return row === undefined ? null : { id: row.id, tracksInventory: row.tracks_inventory };
  }

  public async lockRecipeByVariant(
    client: ProductRecipeTransaction,
    companyId: string,
    variantId: string,
  ): Promise<ProductRecipeRow | null> {
    const row = result<RecipeDb>(
      await client.query(
        `select ${RECIPE_COLUMNS} from product_recipes
         where company_id=$1 and product_variant_id=$2 for update`,
        [companyId, variantId],
      ),
    ).rows[0];
    if (row === undefined) return null;
    const components = await this.componentsForRecipe(client, companyId, row.id);
    return recipe(row, components);
  }

  public async ingredientVariants(
    client: ProductRecipeTransaction,
    companyId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, IngredientVariant>> {
    if (variantIds.length === 0) return new Map();
    const rows = result<{
      id: string;
      unit_of_measure_code: string;
      unit_of_measure_dimension: string;
      tracks_inventory: boolean;
      status: string;
    }>(
      await client.query(
        `select v.id, v.unit_of_measure_code, u.dimension as unit_of_measure_dimension,
                v.tracks_inventory, v.status
         from product_variants v
         join units_of_measure u on u.code = v.unit_of_measure_code
         where v.company_id=$1 and v.id = any($2::uuid[])`,
        [companyId, variantIds],
      ),
    ).rows;
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          unitOfMeasureCode: row.unit_of_measure_code,
          unitOfMeasureDimension: row.unit_of_measure_dimension,
          tracksInventory: row.tracks_inventory,
          status: row.status,
        },
      ]),
    );
  }

  public async unitsOfMeasure(
    client: ProductRecipeTransaction,
    codes: readonly string[],
  ): Promise<Map<string, UnitOfMeasureRow>> {
    if (codes.length === 0) return new Map();
    const rows = result<{ code: string; dimension: string; status: string }>(
      await client.query('select code, dimension, status from units_of_measure where code = any($1::text[])', [
        codes,
      ]),
    ).rows;
    return new Map(rows.map((row) => [row.code, row]));
  }

  public async upsertRecipe(
    client: ProductRecipeTransaction,
    context: ProductRecipeMutationContext,
    input: { productVariantId: string; isActive: boolean; existing: ProductRecipeRow | null },
  ): Promise<RecipeHeader> {
    if (input.existing === null) {
      const id = randomUUID();
      const row = result<RecipeDb>(
        await client.query(
          `insert into product_recipes
           (id,company_id,product_variant_id,is_active,version,created_at,updated_at,created_by,updated_by)
           values ($1,$2,$3,$4,1,$5,$5,$6,$6) returning ${RECIPE_COLUMNS}`,
          [
            id,
            context.companyId,
            input.productVariantId,
            input.isActive,
            context.timestamp,
            context.actorId,
          ],
        ),
      ).rows[0];
      if (row === undefined) throw new Error('Recipe insertion failed.');
      return {
        id: row.id,
        isActive: row.is_active,
        version: BigInt(row.version),
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    }
    const row = result<RecipeDb>(
      await client.query(
        `update product_recipes set is_active=$4, updated_by=$5, updated_at=$6, version=version+1
         where company_id=$1 and id=$2 and version=$3 returning ${RECIPE_COLUMNS}`,
        [
          context.companyId,
          input.existing.id,
          input.existing.version.toString(),
          input.isActive,
          context.actorId,
          context.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new ProductRecipeError('version_conflict', 'The recipe version changed.');
    return {
      id: row.id,
      isActive: row.is_active,
      version: BigInt(row.version),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  public async replaceComponents(
    client: ProductRecipeTransaction,
    context: ProductRecipeMutationContext,
    recipeId: string,
    components: readonly ProductRecipeComponentInput[],
  ): Promise<ProductRecipeComponentRow[]> {
    await client.query(
      'delete from product_recipe_components where company_id=$1 and recipe_id=$2',
      [context.companyId, recipeId],
    );
    const inserted: ComponentDb[] = [];
    for (const item of components) {
      const row = result<ComponentDb>(
        await client.query(
          `insert into product_recipe_components
           (id,company_id,recipe_id,component_variant_id,quantity,unit_of_measure_code,
            created_at,updated_at,created_by,updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8) returning ${COMPONENT_COLUMNS}`,
          [
            randomUUID(),
            context.companyId,
            recipeId,
            item.componentVariantId,
            item.quantity,
            item.unitOfMeasureCode,
            context.timestamp,
            context.actorId,
          ],
        ),
      ).rows[0];
      if (row === undefined) throw new Error('Recipe component insertion failed.');
      inserted.push(row);
    }
    // TASK 16.32.9 — enriched once, batched, after every row is inserted —
    // so a saved recipe's PUT response already carries real ingredient
    // names/SKUs immediately, with no extra round-trip needed to see them.
    return this.withIdentities(client, context.companyId, inserted);
  }

  public async deleteRecipe(
    client: ProductRecipeTransaction,
    companyId: string,
    recipeId: string,
  ): Promise<void> {
    await client.query(
      'delete from product_recipe_components where company_id=$1 and recipe_id=$2',
      [companyId, recipeId],
    );
    await client.query('delete from product_recipes where company_id=$1 and id=$2', [
      companyId,
      recipeId,
    ]);
  }

  private async componentsForRecipe(
    executor: Executor,
    companyId: string,
    recipeId: string,
  ): Promise<ProductRecipeComponentRow[]> {
    const rows = result<ComponentDb>(
      await executor.query(
        `select ${COMPONENT_COLUMNS} from product_recipe_components
         where company_id=$1 and recipe_id=$2 order by created_at asc, id asc`,
        [companyId, recipeId],
      ),
    ).rows;
    return this.withIdentities(executor, companyId, rows);
  }

  // TASK 16.32.9 — resolves each component's real, human-facing ingredient
  // identity (name/SKU) from the CURRENT catalog, in one batched query per
  // recipe (never per-component — no N+1). Deliberately a read-model join,
  // never a persisted column on `product_recipe_components`: the recipe
  // keeps storing only the stable `component_variant_id` reference, and
  // this always reflects the catalog's current state, including for a
  // variant later marked inactive (no `status` filter here at all) — only
  // a variant that no longer exists (unreachable given
  // `product_recipe_components_variant_scope_fk`) resolves to `null`.
  private async withIdentities(
    executor: Executor,
    companyId: string,
    rows: readonly ComponentDb[],
  ): Promise<ProductRecipeComponentRow[]> {
    const identities = await this.ingredientIdentities(
      executor,
      companyId,
      rows.map((row) => row.component_variant_id),
    );
    return rows.map((row) =>
      component(row, identities.get(row.component_variant_id) ?? unresolvedIdentity),
    );
  }

  private async ingredientIdentities(
    executor: Executor,
    companyId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, IngredientIdentity>> {
    if (variantIds.length === 0) return new Map();
    const rows = result<{ variant_id: string; sku: string; name: string | null }>(
      await executor.query(
        `select v.id as variant_id, v.sku,
                coalesce(nullif(btrim(v.name), ''), p.name) as name
         from product_variants v
         join products p on p.company_id = v.company_id and p.id = v.product_id
         where v.company_id=$1 and v.id = any($2::uuid[])`,
        [companyId, [...new Set(variantIds)]],
      ),
    ).rows;
    return new Map(rows.map((row) => [row.variant_id, { name: row.name, sku: row.sku }]));
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'product_recipe_components_recipe_variant_uq':
        return new ProductRecipeError(
          'validation_error',
          'Duplicate ingredient in the recipe components.',
        );
      case 'product_recipes_company_variant_uq':
        return new ProductRecipeError(
          'version_conflict',
          'The recipe was created concurrently; retry the request.',
        );
      default:
        return error;
    }
  }
}
