import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '@asone/database';

import type {
  Brand,
  CatalogPage,
  CatalogStatus,
  Category,
  MutationContext,
} from './catalog.types.js';
import { CatalogApplicationError } from './catalog.types.js';

export interface CatalogSqlClient {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
}

interface QueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount: number | null;
}
interface CategoryRow {
  readonly id: string;
  readonly company_id: string;
  readonly parent_id: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sort_order: number;
  readonly status: CatalogStatus;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}
interface BrandRow {
  readonly id: string;
  readonly company_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: CatalogStatus;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}
interface IdempotencyRow {
  readonly request_hash: string;
  readonly response_body: CategoryRow | BrandRow | null;
}

const CATEGORY_COLUMNS =
  'id,company_id,parent_id,code,name,description,sort_order,status,version,created_at,updated_at,deleted_at';
const BRAND_COLUMNS =
  'id,company_id,code,name,description,status,version,created_at,updated_at,deleted_at';

function result<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}
function category(row: CategoryRow): Category {
  return {
    id: row.id,
    companyId: row.company_id,
    parentId: row.parent_id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    status: row.status,
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
function brand(row: BrandRow): Brand {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    version: BigInt(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
function pgConstraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { readonly constraint?: unknown }).constraint)
    : undefined;
}

export class CatalogRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async transaction<T>(callback: (client: CatalogSqlClient) => Promise<T>): Promise<T> {
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

  public async listCategories(
    companyId: string,
    input: {
      readonly limit: number;
      readonly cursor?: string;
      readonly status?: CatalogStatus;
      readonly parentId?: string;
      readonly search?: string;
    },
  ): Promise<CatalogPage<Category>> {
    const values: unknown[] = [companyId];
    const where = ['company_id=$1'];
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.parentId !== undefined) {
      values.push(input.parentId);
      where.push(`parent_id=$${String(values.length)}`);
    }
    if (input.search !== undefined) {
      values.push(`%${input.search}%`);
      where.push(`(name ilike $${String(values.length)} or code ilike $${String(values.length)})`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<CategoryRow>(
      await this.database.pool.query(
        `select ${CATEGORY_COLUMNS} from product_categories where ${where.join(' and ')}
	       order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(category);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async listBrands(
    companyId: string,
    input: {
      readonly limit: number;
      readonly cursor?: string;
      readonly status?: CatalogStatus;
      readonly search?: string;
    },
  ): Promise<CatalogPage<Brand>> {
    const values: unknown[] = [companyId];
    const where = ['company_id=$1'];
    if (input.status !== undefined) {
      values.push(input.status);
      where.push(`status=$${String(values.length)}`);
    }
    if (input.search !== undefined) {
      values.push(`%${input.search}%`);
      where.push(`(name ilike $${String(values.length)} or code ilike $${String(values.length)})`);
    }
    if (input.cursor !== undefined) {
      values.push(input.cursor);
      where.push(`id>$${String(values.length)}`);
    }
    values.push(input.limit + 1);
    const rows = result<BrandRow>(
      await this.database.pool.query(
        `select ${BRAND_COLUMNS} from brands where ${where.join(' and ')}
	       order by id asc limit $${String(values.length)}`,
        values,
      ),
    ).rows;
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(brand);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  public async category(
    companyId: string,
    id: string,
    client: CatalogSqlClient = this.database.pool,
  ): Promise<Category | null> {
    const row = result<CategoryRow>(
      await client.query(
        `select ${CATEGORY_COLUMNS} from product_categories where company_id=$1 and id=$2`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : category(row);
  }
  public async brand(
    companyId: string,
    id: string,
    client: CatalogSqlClient = this.database.pool,
  ): Promise<Brand | null> {
    const row = result<BrandRow>(
      await client.query(`select ${BRAND_COLUMNS} from brands where company_id=$1 and id=$2`, [
        companyId,
        id,
      ]),
    ).rows[0];
    return row === undefined ? null : brand(row);
  }
  public async lockCategory(
    client: CatalogSqlClient,
    companyId: string,
    id: string,
  ): Promise<Category | null> {
    const row = result<CategoryRow>(
      await client.query(
        `select ${CATEGORY_COLUMNS} from product_categories where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : category(row);
  }
  public async lockBrand(
    client: CatalogSqlClient,
    companyId: string,
    id: string,
  ): Promise<Brand | null> {
    const row = result<BrandRow>(
      await client.query(
        `select ${BRAND_COLUMNS} from brands where company_id=$1 and id=$2 for update`,
        [companyId, id],
      ),
    ).rows[0];
    return row === undefined ? null : brand(row);
  }

  public idempotent(
    client: CatalogSqlClient,
    context: MutationContext,
    operation: string,
    key: string,
    requestHash: string,
    resourceType: 'category',
    create: () => Promise<Category>,
  ): Promise<{ readonly value: Category; readonly replayed: boolean }>;
  public idempotent(
    client: CatalogSqlClient,
    context: MutationContext,
    operation: string,
    key: string,
    requestHash: string,
    resourceType: 'brand',
    create: () => Promise<Brand>,
  ): Promise<{ readonly value: Brand; readonly replayed: boolean }>;
  public async idempotent(
    client: CatalogSqlClient,
    context: MutationContext,
    operation: string,
    key: string,
    requestHash: string,
    resourceType: 'brand' | 'category',
    create: () => Promise<Brand | Category>,
  ): Promise<{ readonly value: Brand | Category; readonly replayed: boolean }> {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${context.companyId}:${operation}:${key}`,
    ]);
    const existing = result<IdempotencyRow>(
      await client.query(
        `select request_hash,response_body from idempotency_keys
       where company_id=$1 and operation=$2 and key=$3`,
        [context.companyId, operation, key],
      ),
    ).rows[0];
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash)
        throw new CatalogApplicationError(
          'idempotency_conflict',
          'The idempotency key was used with another request.',
        );
      if (existing.response_body === null)
        throw new CatalogApplicationError(
          'idempotency_conflict',
          'The idempotent operation is incomplete.',
        );
      return {
        value:
          resourceType === 'category'
            ? category(existing.response_body as CategoryRow)
            : brand(existing.response_body),
        replayed: true,
      };
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
    const stored =
      resourceType === 'category' ? this.categoryJson(value as Category) : this.brandJson(value);
    await client.query(
      `update idempotency_keys set response_status=201,response_body=$2::jsonb,
       resource_type=$3,resource_id=$4,completed_at=$5 where id=$1`,
      [id, JSON.stringify(stored), resourceType, value.id, context.timestamp],
    );
    return { value, replayed: false };
  }

  public async insertCategory(
    client: CatalogSqlClient,
    input: MutationContext & {
      readonly id: string;
      readonly parentId: string | null;
      readonly code: string;
      readonly normalizedCode: string;
      readonly name: string;
      readonly description: string | null;
      readonly sortOrder: number;
      readonly status: CatalogStatus;
    },
  ): Promise<Category> {
    const row = result<CategoryRow>(
      await client.query(
        `insert into product_categories
       (id,company_id,parent_id,code,normalized_code,name,description,sort_order,status,deleted_at,
        created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$12)
       returning ${CATEGORY_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.parentId,
          input.code,
          input.normalizedCode,
          input.name,
          input.description,
          input.sortOrder,
          input.status,
          input.status === 'retired' ? input.timestamp : null,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Category insertion did not return a row.');
    return category(row);
  }
  public async insertBrand(
    client: CatalogSqlClient,
    input: MutationContext & {
      readonly id: string;
      readonly code: string;
      readonly normalizedCode: string;
      readonly name: string;
      readonly description: string | null;
      readonly status: CatalogStatus;
    },
  ): Promise<Brand> {
    const row = result<BrandRow>(
      await client.query(
        `insert into brands
       (id,company_id,code,normalized_code,name,description,status,deleted_at,
        created_by,updated_by,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10) returning ${BRAND_COLUMNS}`,
        [
          input.id,
          input.companyId,
          input.code,
          input.normalizedCode,
          input.name,
          input.description,
          input.status,
          input.status === 'retired' ? input.timestamp : null,
          input.actorId,
          input.timestamp,
        ],
      ),
    ).rows[0];
    if (row === undefined) throw new Error('Brand insertion did not return a row.');
    return brand(row);
  }

  public async updateCategory(
    client: CatalogSqlClient,
    input: MutationContext & {
      readonly id: string;
      readonly expectedVersion: bigint;
      readonly parentId: string | null;
      readonly name: string;
      readonly description: string | null;
      readonly sortOrder: number;
      readonly status: CatalogStatus;
    },
  ): Promise<Category> {
    const row = result<CategoryRow>(
      await client.query(
        `update product_categories set parent_id=$4,name=$5,description=$6,sort_order=$7,status=$8,
       deleted_at=case when $8='retired' then $9::timestamptz else null end,updated_by=$10,updated_at=$9,version=version+1
       where company_id=$1 and id=$2 and version=$3 returning ${CATEGORY_COLUMNS}`,
        [
          input.companyId,
          input.id,
          input.expectedVersion.toString(),
          input.parentId,
          input.name,
          input.description,
          input.sortOrder,
          input.status,
          input.timestamp,
          input.actorId,
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new CatalogApplicationError('version_conflict', 'The category version changed.');
    return category(row);
  }
  public async updateBrand(
    client: CatalogSqlClient,
    input: MutationContext & {
      readonly id: string;
      readonly expectedVersion: bigint;
      readonly name: string;
      readonly description: string | null;
      readonly status: CatalogStatus;
    },
  ): Promise<Brand> {
    const row = result<BrandRow>(
      await client.query(
        `update brands set name=$4,description=$5,status=$6,
       deleted_at=case when $6='retired' then $7::timestamptz else null end,updated_by=$8,updated_at=$7,version=version+1
       where company_id=$1 and id=$2 and version=$3 returning ${BRAND_COLUMNS}`,
        [
          input.companyId,
          input.id,
          input.expectedVersion.toString(),
          input.name,
          input.description,
          input.status,
          input.timestamp,
          input.actorId,
        ],
      ),
    ).rows[0];
    if (row === undefined)
      throw new CatalogApplicationError('version_conflict', 'The brand version changed.');
    return brand(row);
  }
  public async hasActiveBrandProducts(
    client: CatalogSqlClient,
    companyId: string,
    brandId: string,
  ): Promise<boolean> {
    return (
      result<{ exists: boolean }>(
        await client.query(
          `select exists(select 1 from products where company_id=$1 and brand_id=$2
       and status<>'retired' and deleted_at is null) exists`,
          [companyId, brandId],
        ),
      ).rows[0]?.exists ?? false
    );
  }
  public async auditAndPublish(
    client: CatalogSqlClient,
    context: MutationContext,
    input: {
      readonly action: string;
      readonly resourceType: 'brand' | 'category';
      readonly resourceId: string;
      readonly eventType: string;
      readonly version: bigint;
      readonly payload: Readonly<Record<string, unknown>>;
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
  private categoryJson(value: Category): CategoryRow {
    return {
      id: value.id,
      company_id: value.companyId,
      parent_id: value.parentId,
      code: value.code,
      name: value.name,
      description: value.description,
      sort_order: value.sortOrder,
      status: value.status,
      version: value.version.toString(),
      created_at: value.createdAt,
      updated_at: value.updatedAt,
      deleted_at: value.deletedAt,
    };
  }
  private brandJson(value: Brand): BrandRow {
    return {
      id: value.id,
      company_id: value.companyId,
      code: value.code,
      name: value.name,
      description: value.description,
      status: value.status,
      version: value.version.toString(),
      created_at: value.createdAt,
      updated_at: value.updatedAt,
      deleted_at: value.deletedAt,
    };
  }
  private mapDatabaseError(error: unknown): unknown {
    switch (pgConstraint(error)) {
      case 'product_categories_company_code_uq':
        return new CatalogApplicationError(
          'duplicate_category_code',
          'The category code already exists.',
        );
      case 'brands_company_code_uq':
        return new CatalogApplicationError(
          'duplicate_brand_code',
          'The brand code already exists.',
        );
      default:
        return error;
    }
  }
}
