import { createHash, randomUUID } from 'node:crypto';

import {
  CatalogDomainError,
  normalizeBarcode,
  normalizeCatalogCode,
  validateBarcode,
} from '@asone/database';

import type { ProductCatalogRepository } from './product-catalog.repository.js';
import type {
  BarcodeType,
  ProductBarcodeRow,
  ProductMutationContext,
  ProductOptionRow,
  ProductOptionValueRow,
  VariantStatus,
} from './product-catalog.types.js';
import { ProductCatalogError } from './product-catalog.types.js';

interface CreateNamed {
  id?: string;
  code: string;
  name: string;
  displayOrder?: number;
  status?: VariantStatus;
}
interface PatchNamed {
  name?: string;
  displayOrder?: number;
  status?: VariantStatus;
}
interface CreateBarcode {
  id?: string;
  barcode: string;
  barcodeType: BarcodeType;
  isPrimary?: boolean;
}

function clean(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0)
    throw new ProductCatalogError('validation_error', `${field} cannot be blank.`);
  return normalized;
}
function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function code(value: string): string {
  try {
    return normalizeCatalogCode(value);
  } catch (error) {
    if (error instanceof CatalogDomainError)
      throw new ProductCatalogError('validation_error', error.message);
    throw error;
  }
}
function decodeOption(raw: unknown): ProductOptionRow {
  const value = raw as ProductOptionRow & { version: string; createdAt: string; updatedAt: string };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}
function decodeValue(raw: unknown): ProductOptionValueRow {
  const value = raw as ProductOptionValueRow & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}
function decodeBarcode(raw: unknown): ProductBarcodeRow {
  const value = raw as ProductBarcodeRow & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export class ProductOptionsService {
  public constructor(private readonly repository: ProductCatalogRepository) {}

  public async listOptions(
    companyId: string,
    productId: string,
    input: { limit: number; cursor?: string; status?: VariantStatus; search?: string },
  ): Promise<{ items: ProductOptionRow[]; nextCursor: string | null }> {
    const page = await this.repository.listOptions(companyId, productId, input);
    if (page === null)
      throw new ProductCatalogError('resource_not_found', 'The product was not found.');
    return page;
  }

  public async listValues(
    companyId: string,
    optionId: string,
    input: { limit: number; cursor?: string; status?: VariantStatus; search?: string },
  ): Promise<{ items: ProductOptionValueRow[]; nextCursor: string | null }> {
    const page = await this.repository.listOptionValues(companyId, optionId, input);
    if (page === null)
      throw new ProductCatalogError('resource_not_found', 'The option was not found.');
    return page;
  }

  public createOption(
    context: ProductMutationContext,
    productId: string,
    key: string,
    input: CreateNamed,
  ): Promise<{ value: ProductOptionRow; replayed: boolean }> {
    const normalized = {
      id: input.id ?? null,
      code: clean(input.code, 'code'),
      normalizedCode: code(input.code),
      name: clean(input.name, 'name'),
      displayOrder: input.displayOrder ?? 0,
      status: input.status ?? 'active',
    };
    if (normalized.status === 'retired')
      throw new ProductCatalogError('invalid_option_state', 'An option cannot be created retired.');
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'product_option.create',
        key,
        fingerprint(normalized),
        'product_option',
        decodeOption,
        async () => {
          const product = await this.repository.lockProduct(client, context.companyId, productId);
          if (product === null)
            throw new ProductCatalogError('resource_not_found', 'The product was not found.');
          if (product.productType !== 'variable' || product.status === 'retired')
            throw new ProductCatalogError(
              'invalid_product_state',
              'Options require an available variable product.',
            );
          const value = await this.repository.insertOption(client, {
            ...context,
            ...normalized,
            id: input.id ?? randomUUID(),
            productId,
          });
          await this.publish(client, context, value, 'product_option.created');
          return value;
        },
      ),
    );
  }

  public patchOption(
    context: ProductMutationContext,
    id: string,
    expectedVersion: bigint,
    patch: PatchNamed,
  ): Promise<ProductOptionRow> {
    if (Object.keys(patch).length === 0)
      throw new ProductCatalogError('validation_error', 'At least one field is required.');
    return this.repository.transaction(async (client) => {
      const lookup = await this.repository.option(client, context.companyId, id, false);
      if (lookup === null)
        throw new ProductCatalogError('resource_not_found', 'The option was not found.');
      const product = await this.repository.lockProduct(
        client,
        context.companyId,
        lookup.productId,
      );
      if (product === null)
        throw new ProductCatalogError('resource_not_found', 'The product was not found.');
      const current = await this.repository.option(client, context.companyId, id);
      if (current === null)
        throw new ProductCatalogError('resource_not_found', 'The option was not found.');
      if (current.version !== expectedVersion)
        throw new ProductCatalogError('version_conflict', 'The option version changed.');
      const next = {
        ...current,
        name: patch.name === undefined ? current.name : clean(patch.name, 'name'),
        displayOrder: patch.displayOrder ?? current.displayOrder,
        status: patch.status ?? current.status,
      };
      if (
        next.status === 'retired' &&
        (await this.repository.hasActiveOptionDependency(client, context.companyId, {
          optionId: id,
        }))
      )
        throw new ProductCatalogError(
          'invalid_option_state',
          'Active variants depend on this option.',
        );
      const value = await this.repository.updateOption(client, {
        ...context,
        ...next,
        expectedVersion,
      });
      await this.publish(
        client,
        context,
        value,
        value.status === 'retired' ? 'product_option.retired' : 'product_option.updated',
      );
      return value;
    });
  }

  public createValue(
    context: ProductMutationContext,
    optionId: string,
    key: string,
    input: CreateNamed,
  ): Promise<{ value: ProductOptionValueRow; replayed: boolean }> {
    const normalized = {
      id: input.id ?? null,
      code: clean(input.code, 'code'),
      normalizedCode: code(input.code),
      name: clean(input.name, 'name'),
      displayOrder: input.displayOrder ?? 0,
      status: input.status ?? 'active',
    };
    if (normalized.status === 'retired')
      throw new ProductCatalogError(
        'invalid_option_value_state',
        'An option value cannot be created retired.',
      );
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'product_option_value.create',
        key,
        fingerprint(normalized),
        'product_option_value',
        decodeValue,
        async () => {
          const lookup = await this.repository.option(client, context.companyId, optionId, false);
          if (lookup === null)
            throw new ProductCatalogError('resource_not_found', 'The option was not found.');
          const product = await this.repository.lockProduct(
            client,
            context.companyId,
            lookup.productId,
          );
          if (product === null)
            throw new ProductCatalogError('resource_not_found', 'The product was not found.');
          const parent = await this.repository.option(client, context.companyId, optionId);
          if (parent === null)
            throw new ProductCatalogError('resource_not_found', 'The option was not found.');
          if (parent.status === 'retired')
            throw new ProductCatalogError('invalid_option_state', 'The option is retired.');
          const value = await this.repository.insertOptionValue(client, {
            ...context,
            ...normalized,
            id: input.id ?? randomUUID(),
            productId: parent.productId,
            optionDefinitionId: parent.id,
          });
          await this.publishValue(client, context, value, 'product_option_value.created');
          return value;
        },
      ),
    );
  }

  public patchValue(
    context: ProductMutationContext,
    id: string,
    expectedVersion: bigint,
    patch: PatchNamed,
  ): Promise<ProductOptionValueRow> {
    if (Object.keys(patch).length === 0)
      throw new ProductCatalogError('validation_error', 'At least one field is required.');
    return this.repository.transaction(async (client) => {
      const lookup = await this.repository.optionValue(client, context.companyId, id, false);
      if (lookup === null)
        throw new ProductCatalogError('resource_not_found', 'The option value was not found.');
      const product = await this.repository.lockProduct(
        client,
        context.companyId,
        lookup.productId,
      );
      if (product === null)
        throw new ProductCatalogError('resource_not_found', 'The product was not found.');
      const parent = await this.repository.option(
        client,
        context.companyId,
        lookup.optionDefinitionId,
      );
      if (parent === null)
        throw new ProductCatalogError('resource_not_found', 'The option was not found.');
      const current = await this.repository.optionValue(client, context.companyId, id);
      if (current === null)
        throw new ProductCatalogError('resource_not_found', 'The option value was not found.');
      if (current.version !== expectedVersion)
        throw new ProductCatalogError('version_conflict', 'The option value version changed.');
      const next = {
        ...current,
        name: patch.name === undefined ? current.name : clean(patch.name, 'name'),
        displayOrder: patch.displayOrder ?? current.displayOrder,
        status: patch.status ?? current.status,
      };
      if (
        next.status === 'retired' &&
        (await this.repository.hasActiveOptionDependency(client, context.companyId, {
          valueId: id,
        }))
      )
        throw new ProductCatalogError(
          'invalid_option_value_state',
          'Active variants depend on this option value.',
        );
      const value = await this.repository.updateOptionValue(client, {
        ...context,
        ...next,
        expectedVersion,
      });
      await this.publishValue(
        client,
        context,
        value,
        value.status === 'retired'
          ? 'product_option_value.retired'
          : 'product_option_value.updated',
      );
      return value;
    });
  }

  public createBarcode(
    context: ProductMutationContext,
    variantId: string,
    key: string,
    input: CreateBarcode,
  ): Promise<{ value: ProductBarcodeRow; replayed: boolean }> {
    const value = clean(input.barcode, 'barcode');
    try {
      validateBarcode(input.barcodeType, value);
    } catch (error) {
      if (error instanceof CatalogDomainError)
        throw new ProductCatalogError('validation_error', error.message);
      throw error;
    }
    const normalized = {
      id: input.id ?? null,
      barcode: value,
      barcodeType: input.barcodeType,
      normalizedValue: normalizeBarcode(input.barcodeType, value),
      isPrimary: input.isPrimary ?? false,
    };
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'product_barcode.create',
        key,
        fingerprint(normalized),
        'product_barcode',
        decodeBarcode,
        async () => {
          const productId = await this.repository.variantProductId(
            client,
            context.companyId,
            variantId,
          );
          if (productId === null)
            throw new ProductCatalogError('resource_not_found', 'The variant was not found.');
          const product = await this.repository.lockProduct(client, context.companyId, productId);
          if (product === null)
            throw new ProductCatalogError('resource_not_found', 'The product was not found.');
          const variant = await this.repository.lockVariant(client, context.companyId, variantId);
          if (variant === null || variant.status === 'retired')
            throw new ProductCatalogError('resource_not_found', 'The variant was not found.');
          const barcode = await this.repository.createBarcode(client, context, variantId, {
            ...normalized,
            id: input.id ?? randomUUID(),
            type: input.barcodeType,
            value,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'product_barcode.created',
            resourceType: 'product_barcode',
            resourceId: barcode.id,
            eventType: 'product_variant.updated',
            version: barcode.version,
            payload: this.barcodePayload(barcode),
          });
          return barcode;
        },
      ),
    );
  }

  public retireBarcode(
    context: ProductMutationContext,
    id: string,
    expectedVersion: bigint,
  ): Promise<ProductBarcodeRow> {
    return this.repository.transaction(async (client) => {
      const lookup = await this.repository.barcode(client, context.companyId, id, false);
      if (lookup === null)
        throw new ProductCatalogError('resource_not_found', 'The barcode was not found.');
      const productId = await this.repository.variantProductId(
        client,
        context.companyId,
        lookup.productVariantId,
      );
      if (productId === null)
        throw new ProductCatalogError('resource_not_found', 'The variant was not found.');
      const product = await this.repository.lockProduct(client, context.companyId, productId);
      if (product === null)
        throw new ProductCatalogError('resource_not_found', 'The product was not found.');
      const variant = await this.repository.lockVariant(
        client,
        context.companyId,
        lookup.productVariantId,
      );
      if (variant === null)
        throw new ProductCatalogError('resource_not_found', 'The variant was not found.');
      const current = await this.repository.barcode(client, context.companyId, id);
      if (current === null)
        throw new ProductCatalogError('resource_not_found', 'The barcode was not found.');
      if (current.version !== expectedVersion)
        throw new ProductCatalogError('version_conflict', 'The barcode version changed.');
      const value = await this.repository.retireBarcode(client, context, current, expectedVersion);
      await this.repository.auditAndPublish(client, context, {
        action: 'product_barcode.retired',
        resourceType: 'product_barcode',
        resourceId: value.id,
        eventType: 'product_variant.updated',
        version: value.version,
        payload: this.barcodePayload(value),
      });
      return value;
    });
  }

  private publish(
    client: Parameters<ProductCatalogRepository['auditAndPublish']>[0],
    context: ProductMutationContext,
    value: ProductOptionRow,
    action: string,
  ): Promise<void> {
    return this.repository.auditAndPublish(client, context, {
      action,
      resourceType: 'product_option',
      resourceId: value.id,
      eventType: 'product.updated',
      version: value.version,
      payload: {
        product_id: value.productId,
        option_id: value.id,
        status: value.status,
        version: value.version.toString(),
      },
    });
  }
  private publishValue(
    client: Parameters<ProductCatalogRepository['auditAndPublish']>[0],
    context: ProductMutationContext,
    value: ProductOptionValueRow,
    action: string,
  ): Promise<void> {
    return this.repository.auditAndPublish(client, context, {
      action,
      resourceType: 'product_option_value',
      resourceId: value.id,
      eventType: 'product.updated',
      version: value.version,
      payload: {
        product_id: value.productId,
        option_id: value.optionDefinitionId,
        value_id: value.id,
        status: value.status,
        version: value.version.toString(),
      },
    });
  }
  private barcodePayload(value: ProductBarcodeRow): Readonly<Record<string, unknown>> {
    return {
      barcode_id: value.id,
      product_variant_id: value.productVariantId,
      barcode_type: value.barcodeType,
      is_primary: value.isPrimary,
      status: value.status,
      version: value.version.toString(),
    };
  }
}
