import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type {
  CreateBarcodeInput,
  ProductCatalogTransaction,
  ProductDetail,
  ProductFilters,
  ProductMutationContext,
  ProductPage,
  ProductRow,
  ProductVariantPage,
  ProductVariantRow,
} from './product-catalog.types.js';
import { ProductCatalogError } from './product-catalog.types.js';

interface QueryResult<T> {
  readonly rows: readonly T[];
}
interface ProductDb {
  id: string;
  company_id: string;
  category_id: string | null;
  brand_id: string | null;
  code: string;
  name: string;
  description: string | null;
  product_type: ProductRow['productType'];
  tracks_inventory: boolean;
  status: ProductRow['status'];
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface VariantDb {
  id: string;
  company_id: string;
  product_id: string;
  sku: string;
  name: string | null;
  unit_of_measure_code: string;
  quantity_scale: number;
  tracks_inventory: boolean;
  standard_cost: string;
  currency_code: string;
  is_default: boolean;
  status: ProductVariantRow['status'];
  version: string;
  created_at: Date | string;
  updated_at: Date | string;
}
interface IdempotencyDb {
  request_hash: string;
  response_body: unknown;
}

const PRODUCT_COLUMNS =
  'id,company_id,category_id,brand_id,code,name,description,product_type,tracks_inventory,status,version,created_at,updated_at';
const VARIANT_COLUMNS =
  'id,company_id,product_id,sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,status,version,created_at,updated_at';

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function product(row: ProductDb): ProductRow {
  return {
    id: row.id,
    companyId: row.company_id,
    categoryId: row.category_id,
    brandId: row.brand_id,
    code: row.code,
    name: row.name,
    description: row.description,
    productType: row.product_type,
    tracksInventory: row.tracks_inventory,
    status: row.status,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function variant(row: VariantDb): ProductVariantRow {
  return {
    id: row.id,
    companyId: row.company_id,
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    unitOfMeasureCode: row.unit_of_measure_code,
    quantityScale: row.quantity_scale,
    tracksInventory: row.tracks_inventory,
    standardCost: row.standard_cost,
    currencyCode: row.currency_code,
    isDefault: row.is_default,
    status: row.status,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function constraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined;
}
function jsonValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export class ProductCatalogRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(
    callback: (client: ProductCatalogTransaction) => Promise<T>,
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

  public async listProducts(companyId: string, input: ProductFilters): Promise<ProductPage> {
    const values: unknown[] = [companyId];
    const where = ['p.company_id=$1'];
    const add = (value: unknown): string => {
      values.push(value);
      return `$${String(values.length)}`;
    };
    if (input.status !== undefined) where.push(`p.status=${add(input.status)}`);
    if (input.productType !== undefined) where.push(`p.product_type=${add(input.productType)}`);
    if (input.categoryId !== undefined) where.push(`p.category_id=${add(input.categoryId)}`);
    if (input.brandId !== undefined) where.push(`p.brand_id=${add(input.brandId)}`);
    if (input.search !== undefined) {
      const parameter = add(`%${input.search}%`);
      where.push(`(p.name ilike ${parameter} or p.code ilike ${parameter})`);
    }
    if (input.sku !== undefined) {
      const parameter = add(input.sku);
      where.push(
        `exists(select 1 from product_variants v where v.company_id=p.company_id and v.product_id=p.id and v.normalized_sku=${parameter} and v.status<>'retired')`,
      );
    }
    if (input.barcode !== undefined) {
      const parameter = add(input.barcode);
      where.push(
        `exists(select 1 from product_variants v join product_barcodes b on b.company_id=v.company_id and b.product_variant_id=v.id where v.company_id=p.company_id and v.product_id=p.id and (b.normalized_barcode=${parameter} or b.normalized_barcode=lower(${parameter})) and b.status<>'retired')`,
      );
    }
    if (input.cursor !== undefined) where.push(`p.id>${add(input.cursor)}`);
    values.push(input.limit + 1);
    const rows = result<ProductDb>(
      await this.database.pool.query(
        `select ${PRODUCT_COLUMNS.split(',')
          .map((column) => `p.${column}`)
          .join(',')}
         from products p where ${where.join(' and ')}
         order by p.id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(product);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async product(companyId: string, id: string): Promise<ProductDetail | null> {
    const row = result<ProductDb>(
      await this.database.pool.query(
        `select ${PRODUCT_COLUMNS} from products where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    if (row === undefined) return null;
    const defaultVariant = result<VariantDb>(
      await this.database.pool.query(
        `select ${VARIANT_COLUMNS} from product_variants
         where company_id=$1 and product_id=$2 and is_default=true and status<>'retired'`,
        [companyId, id],
      ),
    ).rows[0];
    return {
      ...product(row),
      defaultVariant: defaultVariant === undefined ? null : variant(defaultVariant),
    };
  }

  public async listVariants(
    companyId: string,
    productId: string,
    input: { limit: number; cursor?: string; status?: ProductVariantRow['status'] },
  ): Promise<ProductVariantPage | null> {
    if (!(await this.productExists(companyId, productId))) return null;
    const values: unknown[] = [companyId, productId];
    const where = ['company_id=$1', 'product_id=$2'];
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<VariantDb>(
      await this.database.pool.query(
        `select ${VARIANT_COLUMNS} from product_variants where ${where.join(' and ')}
         order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(variant);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async variant(companyId: string, id: string): Promise<ProductVariantRow | null> {
    const row = result<VariantDb>(
      await this.database.pool.query(
        `select ${VARIANT_COLUMNS} from product_variants where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : variant(row);
  }

  public async variantProductId(
    client: ProductCatalogTransaction,
    companyId: string,
    id: string,
  ): Promise<string | null> {
    return (
      result<{ product_id: string }>(
        await client.query(
          'select product_id from product_variants where company_id=$1 and id=$2',
          [companyId, id],
        ),
      ).rows[0]?.product_id ?? null
    );
  }

  public async lockProduct(
    client: ProductCatalogTransaction,
    companyId: string,
    id: string,
  ): Promise<ProductRow | null> {
    const row = result<ProductDb>(
      await client.query(
        `select ${PRODUCT_COLUMNS} from products where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : product(row);
  }

  public async lockVariant(
    client: ProductCatalogTransaction,
    companyId: string,
    id: string,
  ): Promise<ProductVariantRow | null> {
    const row = result<VariantDb>(
      await client.query(
        `select ${VARIANT_COLUMNS} from product_variants where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : variant(row);
  }

  public async validateReferences(
    client: ProductCatalogTransaction,
    companyId: string,
    categoryId: string | null,
    brandId: string | null,
  ): Promise<void> {
    if (categoryId !== null) {
      const found = result<{ id: string }>(
        await client.query(
          `select id from product_categories where company_id=$1 and id=$2 and status='active' and deleted_at is null for update`,
          [companyId, categoryId],
        ),
      ).rows[0];
      if (found === undefined)
        throw new ProductCatalogError(
          'validation_error',
          'The category is not active or does not exist.',
        );
    }
    if (brandId !== null) {
      const found = result<{ id: string }>(
        await client.query(
          `select id from brands where company_id=$1 and id=$2 and status='active' and deleted_at is null for update`,
          [companyId, brandId],
        ),
      ).rows[0];
      if (found === undefined)
        throw new ProductCatalogError(
          'validation_error',
          'The brand is not active or does not exist.',
        );
    }
  }

  public async validateUnit(
    client: ProductCatalogTransaction,
    code: string,
    quantityScale: number,
  ): Promise<void> {
    const found = result<{ quantity_scale: number }>(
      await client.query(
        `select quantity_scale from units_of_measure where code=$1 and status='active'`,
        [code],
      ),
    ).rows[0];
    if (found === undefined || quantityScale > found.quantity_scale)
      throw new ProductCatalogError(
        'validation_error',
        'The unit of measure is invalid for the requested quantity scale.',
      );
  }

  public async insertProduct(
    client: ProductCatalogTransaction,
    input: ProductMutationContext & {
      id: string;
      categoryId: string | null;
      brandId: string | null;
      code: string;
      normalizedCode: string;
      name: string;
      description: string | null;
      productType: ProductRow['productType'];
      tracksInventory: boolean;
      status: ProductRow['status'];
    },
  ): Promise<ProductRow> {
    const row = result<ProductDb>(
      await client.query(
        `insert into products
         (id,company_id,category_id,brand_id,code,normalized_code,name,description,product_type,
          tracks_inventory,status,deleted_at,created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$14)
         returning ${PRODUCT_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.categoryId,
          input.brandId,
          input.code,
          input.normalizedCode,
          input.name,
          input.description,
          input.productType,
          input.tracksInventory,
          input.status,
          input.status === 'retired' ? input.timestamp : null,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Product insertion did not return a row.');
    return product(row);
  }

  public async updateProduct(
    client: ProductCatalogTransaction,
    input: ProductMutationContext &
      ProductRow & { expectedVersion: bigint; normalizedCode: string },
  ): Promise<ProductRow> {
    const row = result<ProductDb>(
      await client.query(
        `update products set category_id=$4,brand_id=$5,code=$6,normalized_code=$7,name=$8,
         description=$9,product_type=$10,tracks_inventory=$11,status=$12,
         deleted_at=case when $12='retired' then $13::timestamptz else null end,
         updated_by=$14,updated_at=$13,version=version+1
         where company_id=$1 and id=$2 and version=$3 returning ${PRODUCT_COLUMNS}`,
        [
          input.companyId,
          input.id,
          input.expectedVersion.toString(),
          input.categoryId,
          input.brandId,
          input.code,
          input.normalizedCode,
          input.name,
          input.description,
          input.productType,
          input.tracksInventory,
          input.status,
          input.timestamp,
          input.actorId,
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new ProductCatalogError('version_conflict', 'The product version changed.');
    return product(row);
  }

  public async insertVariant(
    client: ProductCatalogTransaction,
    input: ProductMutationContext & {
      id: string;
      productId: string;
      sku: string;
      normalizedSku: string;
      name: string | null;
      unitOfMeasureCode: string;
      quantityScale: number;
      tracksInventory: boolean;
      standardCost: string;
      currencyCode: string;
      isDefault: boolean;
      optionSignature: string;
      status: ProductVariantRow['status'];
    },
  ): Promise<ProductVariantRow> {
    const row = result<VariantDb>(
      await client.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,
          tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,deleted_at,
          created_by,updated_by,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17,$17)
         returning ${VARIANT_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.productId,
          input.sku,
          input.normalizedSku,
          input.name,
          input.unitOfMeasureCode,
          input.quantityScale,
          input.tracksInventory,
          input.standardCost,
          input.currencyCode,
          input.isDefault,
          input.optionSignature,
          input.status,
          input.status === 'retired' ? input.timestamp : null,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Variant insertion did not return a row.');
    return variant(row);
  }

  public async updateVariant(
    client: ProductCatalogTransaction,
    input: ProductMutationContext &
      ProductVariantRow & {
        expectedVersion: bigint;
        normalizedSku: string;
      },
  ): Promise<ProductVariantRow> {
    const row = result<VariantDb>(
      await client.query(
        `update product_variants set sku=$4,normalized_sku=$5,name=$6,unit_of_measure_code=$7,
         quantity_scale=$8,tracks_inventory=$9,standard_cost=$10,currency_code=$11,is_default=$12,
         status=$13,deleted_at=case when $13='retired' then $14::timestamptz else null end,
         updated_by=$15,updated_at=$14,version=version+1
         where company_id=$1 and id=$2 and version=$3 returning ${VARIANT_COLUMNS}`,
        [
          input.companyId,
          input.id,
          input.expectedVersion.toString(),
          input.sku,
          input.normalizedSku,
          input.name,
          input.unitOfMeasureCode,
          input.quantityScale,
          input.tracksInventory,
          input.standardCost,
          input.currencyCode,
          input.status === 'retired' ? false : input.isDefault,
          input.status,
          input.timestamp,
          input.actorId,
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new ProductCatalogError('version_conflict', 'The variant version changed.');
    return variant(row);
  }

  public async insertBarcode(
    client: ProductCatalogTransaction,
    context: ProductMutationContext,
    variantId: string,
    input: CreateBarcodeInput & { normalizedValue: string },
  ): Promise<void> {
    await client.query(
      `insert into product_barcodes
       (id,company_id,product_variant_id,barcode_type,barcode,normalized_barcode,is_primary,status,
        created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8,$9,$9)`,
      [
        randomUUID(),
        context.companyId,
        variantId,
        input.type,
        input.value,
        input.normalizedValue,
        input.isPrimary,
        context.actorId,
        context.timestamp,
      ],
    );
  }

  public async variantsForState(
    client: ProductCatalogTransaction,
    companyId: string,
    productId: string,
  ): Promise<ProductVariantRow[]> {
    return result<VariantDb>(
      await client.query(
        `select ${VARIANT_COLUMNS} from product_variants
         where company_id=$1 and product_id=$2 order by id for update`,
        [companyId, productId],
      ),
    ).rows.map(variant);
  }

  public async idempotent<T>(
    client: ProductCatalogTransaction,
    context: ProductMutationContext,
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
        throw new ProductCatalogError(
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
      `update idempotency_keys set response_status=201,response_body=$2::jsonb,
       resource_type=$3,resource_id=$4,completed_at=$5 where id=$1`,
      [id, JSON.stringify(value, jsonValue), resourceType, value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async auditAndPublish(
    client: ProductCatalogTransaction,
    context: ProductMutationContext,
    input: {
      action: string;
      resourceType: 'product' | 'product_variant';
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

  private async productExists(companyId: string, id: string): Promise<boolean> {
    return (
      result<{ exists: boolean }>(
        await this.database.pool.query(
          'select exists(select 1 from products where company_id=$1 and id=$2) exists',
          [companyId, id],
        ),
      ).rows[0]?.exists ?? false
    );
  }

  private mapDatabaseError(error: unknown): unknown {
    switch (constraint(error)) {
      case 'products_company_code_uq':
        return new ProductCatalogError(
          'duplicate_product_code',
          'The product code already exists.',
        );
      case 'product_variants_company_sku_active_uq':
        return new ProductCatalogError('duplicate_sku', 'The SKU already exists.');
      case 'product_barcodes_company_barcode_active_uq':
        return new ProductCatalogError('duplicate_barcode', 'The barcode already exists.');
      case 'product_variants_product_option_signature_active_uq':
        return new ProductCatalogError(
          'option_combination_conflict',
          'An active variant already uses this option combination.',
        );
      case 'product_variants_product_default_active_uq':
        return new ProductCatalogError(
          'invalid_variant_state',
          'The product already has an active default variant.',
        );
      default:
        return error;
    }
  }
}
