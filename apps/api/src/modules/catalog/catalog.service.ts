import { createHash, randomUUID } from 'node:crypto';

import {
  assertCategoryParentIsAcyclic,
  CatalogDomainError,
  normalizeCatalogCode,
} from '@asone/database';

import type { CatalogRepository, CatalogSqlClient } from './catalog.repository.js';
import type {
  Brand,
  CatalogPage,
  CatalogStatus,
  Category,
  MutationContext,
} from './catalog.types.js';
import { CatalogApplicationError } from './catalog.types.js';

export interface CategoryCreate {
  readonly id?: string;
  readonly parentId?: string | null;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sortOrder?: number;
  readonly status?: CatalogStatus;
}
export interface CategoryPatch {
  readonly parentId?: string | null;
  readonly name?: string;
  readonly description?: string | null;
  readonly sortOrder?: number;
  readonly status?: CatalogStatus;
}
export interface BrandCreate {
  readonly id?: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: CatalogStatus;
}
export interface BrandPatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly status?: CatalogStatus;
}

function requestHash(value: Readonly<Record<string, unknown>>): string {
  const ordered = Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
function cleanText(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0)
    throw new CatalogApplicationError('invalid_input', `${field} cannot be blank.`, { field });
  return clean;
}
function optionalDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const clean = value.trim();
  return clean.length === 0 ? null : clean;
}
function applicationError(error: unknown): never {
  if (error instanceof CatalogDomainError) {
    throw new CatalogApplicationError(
      error.code === 'category_cycle_detected' ? 'category_cycle_detected' : 'invalid_input',
      error.message,
    );
  }
  throw error;
}

export class CatalogService {
  public constructor(private readonly repository: CatalogRepository) {}

  public listCategories(
    companyId: string,
    input: {
      readonly limit: number;
      readonly cursor?: string;
      readonly status?: CatalogStatus;
      readonly parentId?: string;
      readonly search?: string;
    },
  ): Promise<CatalogPage<Category>> {
    return this.repository.listCategories(companyId, input);
  }
  public listBrands(
    companyId: string,
    input: {
      readonly limit: number;
      readonly cursor?: string;
      readonly status?: CatalogStatus;
      readonly search?: string;
    },
  ): Promise<CatalogPage<Brand>> {
    return this.repository.listBrands(companyId, input);
  }
  public async category(companyId: string, id: string): Promise<Category> {
    const value = await this.repository.category(companyId, id);
    if (value === null)
      throw new CatalogApplicationError('resource_not_found', 'The category was not found.');
    return value;
  }

  public createCategory(
    context: MutationContext,
    key: string,
    input: CategoryCreate,
  ): Promise<{ readonly value: Category; readonly replayed: boolean }> {
    let normalizedCode: string;
    try {
      normalizedCode = normalizeCatalogCode(input.code);
    } catch (error) {
      applicationError(error);
    }
    const normalizedRequest = {
      id: input.id ?? null,
      parentId: input.parentId ?? null,
      code: cleanText(input.code, 'code'),
      normalizedCode,
      name: cleanText(input.name, 'name'),
      description: optionalDescription(input.description),
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? 'active',
    };
    const normalized = { ...normalizedRequest, id: input.id ?? randomUUID() };
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'category.create',
        key,
        requestHash(normalizedRequest),
        'category',
        async () => {
          await this.validateParent(client, context.companyId, normalized.id, normalized.parentId);
          const value = await this.repository.insertCategory(client, { ...context, ...normalized });
          await this.repository.auditAndPublish(client, context, {
            action: 'category.created',
            resourceType: 'category',
            resourceId: value.id,
            eventType: 'category.created',
            version: value.version,
            payload: this.categoryPayload(value),
          });
          return value;
        },
      ),
    );
  }

  public patchCategory(
    context: MutationContext,
    id: string,
    expectedVersion: bigint,
    patch: CategoryPatch,
  ): Promise<Category> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockCategory(client, context.companyId, id);
      if (current === null)
        throw new CatalogApplicationError('resource_not_found', 'The category was not found.');
      if (current.version !== expectedVersion)
        throw new CatalogApplicationError('version_conflict', 'The category version changed.');
      if (current.status === 'retired')
        throw new CatalogApplicationError('invalid_input', 'A retired category cannot be changed.');
      const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
      await this.validateParent(client, context.companyId, id, parentId);
      const status = patch.status ?? current.status;
      const value = await this.repository.updateCategory(client, {
        ...context,
        id,
        expectedVersion,
        parentId,
        name: patch.name === undefined ? current.name : cleanText(patch.name, 'name'),
        description:
          patch.description === undefined
            ? current.description
            : optionalDescription(patch.description),
        sortOrder: patch.sortOrder ?? current.sortOrder,
        status,
      });
      const retired = status === 'retired';
      await this.repository.auditAndPublish(client, context, {
        action: retired ? 'category.retired' : 'category.updated',
        resourceType: 'category',
        resourceId: id,
        eventType: 'category.updated',
        version: value.version,
        payload: { ...this.categoryPayload(value), changed_fields: Object.keys(patch) },
      });
      return value;
    });
  }

  public createBrand(
    context: MutationContext,
    key: string,
    input: BrandCreate,
  ): Promise<{ readonly value: Brand; readonly replayed: boolean }> {
    let normalizedCode: string;
    try {
      normalizedCode = normalizeCatalogCode(input.code);
    } catch (error) {
      applicationError(error);
    }
    const normalizedRequest = {
      id: input.id ?? null,
      code: cleanText(input.code, 'code'),
      normalizedCode,
      name: cleanText(input.name, 'name'),
      description: optionalDescription(input.description),
      status: input.status ?? 'active',
    };
    const normalized = { ...normalizedRequest, id: input.id ?? randomUUID() };
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'brand.create',
        key,
        requestHash(normalizedRequest),
        'brand',
        async () => {
          const value = await this.repository.insertBrand(client, { ...context, ...normalized });
          await this.repository.auditAndPublish(client, context, {
            action: 'brand.created',
            resourceType: 'brand',
            resourceId: value.id,
            eventType: 'brand.created',
            version: value.version,
            payload: this.brandPayload(value),
          });
          return value;
        },
      ),
    );
  }

  public patchBrand(
    context: MutationContext,
    id: string,
    expectedVersion: bigint,
    patch: BrandPatch,
  ): Promise<Brand> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockBrand(client, context.companyId, id);
      if (current === null)
        throw new CatalogApplicationError('resource_not_found', 'The brand was not found.');
      if (current.version !== expectedVersion)
        throw new CatalogApplicationError('version_conflict', 'The brand version changed.');
      if (current.status === 'retired')
        throw new CatalogApplicationError('invalid_input', 'A retired brand cannot be changed.');
      const status = patch.status ?? current.status;
      if (
        status === 'retired' &&
        (await this.repository.hasActiveBrandProducts(client, context.companyId, id))
      )
        throw new CatalogApplicationError(
          'product_has_active_dependencies',
          'The brand has active product dependencies.',
        );
      const value = await this.repository.updateBrand(client, {
        ...context,
        id,
        expectedVersion,
        name: patch.name === undefined ? current.name : cleanText(patch.name, 'name'),
        description:
          patch.description === undefined
            ? current.description
            : optionalDescription(patch.description),
        status,
      });
      const retired = status === 'retired';
      await this.repository.auditAndPublish(client, context, {
        action: retired ? 'brand.retired' : 'brand.updated',
        resourceType: 'brand',
        resourceId: id,
        eventType: retired ? 'brand.retired' : 'brand.updated',
        version: value.version,
        payload: { ...this.brandPayload(value), changed_fields: Object.keys(patch) },
      });
      return value;
    });
  }

  private async validateParent(
    client: CatalogSqlClient,
    companyId: string,
    categoryId: string,
    parentId: string | null,
  ): Promise<void> {
    try {
      await assertCategoryParentIsAcyclic(categoryId, parentId, async (id) => {
        const parent = await this.repository.lockCategory(client, companyId, id);
        if (parent === null)
          throw new CatalogApplicationError(
            'resource_not_found',
            'The parent category was not found.',
          );
        return { id: parent.id, parentId: parent.parentId };
      });
    } catch (error) {
      applicationError(error);
    }
  }
  private categoryPayload(value: Category): Readonly<Record<string, unknown>> {
    return {
      category_id: value.id,
      parent_id: value.parentId,
      code: value.code,
      name: value.name,
      status: value.status,
      version: value.version.toString(),
    };
  }
  private brandPayload(value: Brand): Readonly<Record<string, unknown>> {
    return {
      brand_id: value.id,
      code: value.code,
      name: value.name,
      status: value.status,
      version: value.version.toString(),
      ...(value.deletedAt === null ? {} : { retired_at: value.deletedAt.toISOString() }),
    };
  }
}
