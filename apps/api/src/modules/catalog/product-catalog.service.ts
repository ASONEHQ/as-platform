import { createHash, randomUUID } from 'node:crypto';

import {
  CatalogDomainError,
  generateOptionSignature,
  normalizeBarcode,
  normalizeCatalogCode,
  normalizeSku,
  validateBarcode,
  validateProductVariantState,
} from '@asone/database';

import type { ProductCatalogRepository } from './product-catalog.repository.js';
import type {
  CreateBarcodeInput,
  CreateProductInput,
  CreateVariantInput,
  ProductDetail,
  ProductFilters,
  ProductMutationContext,
  ProductPage,
  ProductRow,
  ProductVariantPage,
  ProductVariantRow,
  UpdateProductInput,
  UpdateVariantInput,
} from './product-catalog.types.js';
import { ProductCatalogError } from './product-catalog.types.js';

function clean(value: string, field: string): string {
  const result = value.trim();
  if (result.length === 0)
    throw new ProductCatalogError('validation_error', `${field} cannot be blank.`);
  return result;
}
function nullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const result = value.trim();
  return result.length === 0 ? null : result;
}
function money(value: string): string {
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(value))
    throw new ProductCatalogError(
      'validation_error',
      'standard_cost must be a non-negative decimal with at most four decimals.',
    );
  const [matchedWhole, fraction = ''] = value.split('.');
  const whole = matchedWhole ?? '0';
  return `${whole}.${fraction.padEnd(4, '0')}`;
}
function currency(value: string): string {
  const result = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result))
    throw new ProductCatalogError('validation_error', 'currency_code must be ISO 4217.');
  return result;
}
function hash(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function mapDomain(error: unknown): never {
  if (error instanceof CatalogDomainError) {
    throw new ProductCatalogError(
      error.code === 'invalid_product_state' ? 'invalid_product_state' : 'validation_error',
      error.message,
    );
  }
  throw error;
}
function normalizeCode(value: string): string {
  try {
    return normalizeCatalogCode(value);
  } catch (error) {
    mapDomain(error);
  }
}
function normalizedSku(value: string): string {
  try {
    return normalizeSku(value);
  } catch (error) {
    mapDomain(error);
  }
}
function normalizedBarcode(input: CreateBarcodeInput): string {
  try {
    validateBarcode(input.type, input.value);
    return normalizeBarcode(input.type, input.value);
  } catch (error) {
    mapDomain(error);
  }
}
function assertState(product: ProductRow, variants: readonly ProductVariantRow[]): void {
  try {
    validateProductVariantState({
      productId: product.id,
      productType: product.productType,
      productStatus: product.status,
      tracksInventory: product.tracksInventory,
      variants,
    });
  } catch (error) {
    mapDomain(error);
  }
}
function decodeVariant(raw: unknown): ProductVariantRow {
  const value = raw as Omit<ProductVariantRow, 'version' | 'createdAt' | 'updatedAt'> & {
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
function decodeProduct(raw: unknown): ProductDetail {
  const value = raw as Omit<
    ProductDetail,
    'version' | 'createdAt' | 'updatedAt' | 'defaultVariant'
  > & {
    version: string;
    createdAt: string;
    updatedAt: string;
    defaultVariant: unknown;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    defaultVariant: value.defaultVariant === null ? null : decodeVariant(value.defaultVariant),
  };
}

export class ProductCatalogService {
  public constructor(private readonly repository: ProductCatalogRepository) {}

  public listProducts(companyId: string, input: ProductFilters): Promise<ProductPage> {
    return this.repository.listProducts(companyId, {
      ...input,
      ...(input.sku === undefined ? {} : { sku: normalizedSku(input.sku) }),
      ...(input.barcode === undefined ? {} : { barcode: input.barcode.normalize('NFKC').trim() }),
    });
  }

  public async product(companyId: string, id: string): Promise<ProductDetail> {
    const value = await this.repository.product(companyId, id);
    if (value === null)
      throw new ProductCatalogError('resource_not_found', 'The product was not found.');
    return value;
  }

  public async listVariants(
    companyId: string,
    productId: string,
    input: { limit: number; cursor?: string; status?: ProductVariantRow['status'] },
  ): Promise<ProductVariantPage> {
    const value = await this.repository.listVariants(companyId, productId, input);
    if (value === null)
      throw new ProductCatalogError('resource_not_found', 'The product was not found.');
    return value;
  }

  public async variant(companyId: string, id: string): Promise<ProductVariantRow> {
    const value = await this.repository.variant(companyId, id);
    if (value === null)
      throw new ProductCatalogError('resource_not_found', 'The product variant was not found.');
    return value;
  }

  public createProduct(
    context: ProductMutationContext,
    key: string,
    input: CreateProductInput,
  ): Promise<{ value: ProductDetail; replayed: boolean }> {
    const id = input.id ?? randomUUID();
    const code = clean(input.code, 'code');
    const description = nullable(input.description);
    const normalized = {
      id,
      code,
      normalizedCode: normalizeCode(code),
      name: clean(input.name, 'name'),
      description,
      productType: input.productType,
      tracksInventory:
        input.productType === 'service' || input.productType === 'kit'
          ? false
          : input.tracksInventory,
      status: input.status,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      defaultVariant:
        input.defaultVariant === undefined
          ? null
          : {
              id: randomUUID(),
              sku: clean(input.defaultVariant.sku, 'sku'),
              normalizedSku: normalizedSku(input.defaultVariant.sku),
              name: nullable(input.defaultVariant.name),
              unitOfMeasureCode: clean(
                input.defaultVariant.unitOfMeasureCode,
                'unit_of_measure_code',
              ).toLowerCase(),
              quantityScale: input.defaultVariant.quantityScale,
              tracksInventory:
                input.productType === 'service' || input.productType === 'kit'
                  ? false
                  : (input.defaultVariant.tracksInventory ?? input.tracksInventory),
              standardCost: money(input.defaultVariant.standardCost),
              currencyCode: currency(input.defaultVariant.currencyCode),
              barcode:
                input.defaultVariant.barcode === undefined
                  ? null
                  : {
                      ...input.defaultVariant.barcode,
                      value: clean(input.defaultVariant.barcode.value, 'barcode.value'),
                      normalizedValue: normalizedBarcode(input.defaultVariant.barcode),
                    },
            },
    };
    const requestHash = hash({
      ...normalized,
      id: input.id ?? null,
      defaultVariant:
        normalized.defaultVariant === null ? null : { ...normalized.defaultVariant, id: undefined },
    });
    if (
      (normalized.productType === 'service' || normalized.productType === 'kit') &&
      (input.tracksInventory || input.defaultVariant?.tracksInventory)
    )
      throw new ProductCatalogError(
        'invalid_product_state',
        'Service and kit products and variants cannot track inventory.',
      );
    if (normalized.status === 'retired')
      throw new ProductCatalogError(
        'invalid_product_state',
        'A product cannot be created retired.',
      );
    if (normalized.productType !== 'variable' && normalized.defaultVariant === null)
      throw new ProductCatalogError(
        'invalid_product_state',
        'Simple, service, and kit products require a default variant.',
      );
    if (
      normalized.productType === 'variable' &&
      normalized.status === 'active' &&
      normalized.defaultVariant === null
    )
      throw new ProductCatalogError(
        'invalid_product_state',
        'An active variable product requires an active default variant.',
      );
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'product.create',
        key,
        requestHash,
        'product',
        decodeProduct,
        async () => {
          await this.repository.validateReferences(
            client,
            context.companyId,
            normalized.categoryId,
            normalized.brandId,
          );
          const created = await this.repository.insertProduct(client, {
            ...context,
            ...normalized,
          });
          let defaultVariant: ProductVariantRow | null = null;
          if (normalized.defaultVariant !== null) {
            await this.repository.validateUnit(
              client,
              normalized.defaultVariant.unitOfMeasureCode,
              normalized.defaultVariant.quantityScale,
            );
            defaultVariant = await this.repository.insertVariant(client, {
              ...context,
              ...normalized.defaultVariant,
              productId: created.id,
              isDefault: true,
              optionSignature: generateOptionSignature([]),
              status: 'active',
            });
            if (normalized.defaultVariant.barcode !== null)
              await this.repository.insertBarcode(
                client,
                context,
                defaultVariant.id,
                normalized.defaultVariant.barcode,
              );
            await this.repository.auditAndPublish(client, context, {
              action: 'variant.created',
              resourceType: 'product_variant',
              resourceId: defaultVariant.id,
              eventType: 'product_variant.updated',
              version: defaultVariant.version,
              payload: this.variantPayload(defaultVariant),
            });
          }
          const detail = { ...created, defaultVariant };
          assertState(created, defaultVariant === null ? [] : [defaultVariant]);
          await this.repository.auditAndPublish(client, context, {
            action: 'product.created',
            resourceType: 'product',
            resourceId: created.id,
            eventType: 'product.created',
            version: created.version,
            payload: this.productPayload(created),
          });
          return detail;
        },
      ),
    );
  }

  public patchProduct(
    context: ProductMutationContext,
    id: string,
    expectedVersion: bigint,
    patch: UpdateProductInput,
  ): Promise<ProductRow> {
    if (Object.keys(patch).length === 0)
      throw new ProductCatalogError('validation_error', 'At least one field is required.');
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockProduct(client, context.companyId, id);
      if (current === null)
        throw new ProductCatalogError('resource_not_found', 'The product was not found.');
      if (current.version !== expectedVersion)
        throw new ProductCatalogError('version_conflict', 'The product version changed.');
      const next: ProductRow = {
        ...current,
        name: patch.name === undefined ? current.name : clean(patch.name, 'name'),
        description:
          patch.description === undefined ? current.description : nullable(patch.description),
        tracksInventory: patch.tracksInventory ?? current.tracksInventory,
        status: patch.status ?? current.status,
        categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
        brandId: patch.brandId === undefined ? current.brandId : patch.brandId,
      };
      if ((next.productType === 'service' || next.productType === 'kit') && next.tracksInventory)
        throw new ProductCatalogError(
          'invalid_product_state',
          'Service and kit products cannot track inventory.',
        );
      await this.repository.validateReferences(
        client,
        context.companyId,
        next.categoryId,
        next.brandId,
      );
      const variants = await this.repository.variantsForState(client, context.companyId, id);
      assertState(next, variants);
      const updated = await this.repository.updateProduct(client, {
        ...context,
        ...next,
        normalizedCode: normalizeCode(next.code),
        expectedVersion,
      });
      await this.repository.auditAndPublish(client, context, {
        action: updated.status === 'retired' ? 'product.retired' : 'product.updated',
        resourceType: 'product',
        resourceId: updated.id,
        eventType: 'product.updated',
        version: updated.version,
        payload: this.productPayload(updated),
      });
      return updated;
    });
  }

  public createVariant(
    context: ProductMutationContext,
    productId: string,
    key: string,
    input: CreateVariantInput,
  ): Promise<{ value: ProductVariantRow; replayed: boolean }> {
    const optionValueIds = [...input.optionValueIds].sort();
    const normalized = {
      id: input.id ?? randomUUID(),
      productId,
      sku: clean(input.sku, 'sku'),
      normalizedSku: normalizedSku(input.sku),
      name: nullable(input.name),
      unitOfMeasureCode: clean(input.unitOfMeasureCode, 'unit_of_measure_code').toLowerCase(),
      quantityScale: input.quantityScale,
      tracksInventory: input.tracksInventory,
      standardCost: money(input.standardCost),
      currencyCode: currency(input.currencyCode),
      isDefault: input.isDefault,
      status: input.status,
      optionValueIds,
      barcode:
        input.barcode === undefined
          ? null
          : {
              ...input.barcode,
              value: clean(input.barcode.value, 'barcode.value'),
              normalizedValue: normalizedBarcode(input.barcode),
            },
    };
    const requestHash = hash({ ...normalized, id: input.id ?? null });
    if (normalized.status === 'retired')
      throw new ProductCatalogError(
        'invalid_variant_state',
        'A variant cannot be created retired.',
      );
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'product_variant.create',
        key,
        requestHash,
        'product_variant',
        decodeVariant,
        async () => {
          const product = await this.repository.lockProduct(client, context.companyId, productId);
          if (product === null)
            throw new ProductCatalogError('resource_not_found', 'The product was not found.');
          if (product.productType !== 'variable' && optionValueIds.length > 0)
            throw new ProductCatalogError(
              'invalid_product_state',
              'Only variable products may use option values.',
            );
          if (
            (product.productType === 'service' || product.productType === 'kit') &&
            normalized.tracksInventory
          )
            throw new ProductCatalogError(
              'invalid_variant_state',
              'Service and kit variants cannot track inventory.',
            );
          await this.repository.validateUnit(
            client,
            normalized.unitOfMeasureCode,
            normalized.quantityScale,
          );
          const mappings = await this.repository.resolveOptionValues(
            client,
            context.companyId,
            productId,
            optionValueIds,
          );
          const optionSignature = generateOptionSignature(mappings);
          const created = await this.repository.insertVariant(client, {
            ...context,
            ...normalized,
            optionSignature,
            tracksInventory:
              product.productType === 'service' || product.productType === 'kit'
                ? false
                : (normalized.tracksInventory ?? product.tracksInventory),
          });
          await this.repository.insertVariantOptionMappings(
            client,
            context.companyId,
            productId,
            created.id,
            mappings,
            context.timestamp,
          );
          const variants = await this.repository.variantsForState(
            client,
            context.companyId,
            productId,
          );
          assertState(product, variants);
          if (normalized.barcode !== null)
            await this.repository.insertBarcode(client, context, created.id, normalized.barcode);
          await this.repository.auditAndPublish(client, context, {
            action: 'variant.created',
            resourceType: 'product_variant',
            resourceId: created.id,
            eventType: 'product_variant.updated',
            version: created.version,
            payload: this.variantPayload(created),
          });
          return created;
        },
      ),
    );
  }

  public patchVariant(
    context: ProductMutationContext,
    id: string,
    expectedVersion: bigint,
    patch: UpdateVariantInput,
  ): Promise<ProductVariantRow> {
    if (Object.keys(patch).length === 0)
      throw new ProductCatalogError('validation_error', 'At least one field is required.');
    return this.repository.transaction(async (client) => {
      const productId = await this.repository.variantProductId(client, context.companyId, id);
      if (productId === null)
        throw new ProductCatalogError('resource_not_found', 'The product variant was not found.');
      const product = await this.repository.lockProduct(client, context.companyId, productId);
      if (product === null)
        throw new ProductCatalogError('resource_not_found', 'The product was not found.');
      const current = await this.repository.lockVariant(client, context.companyId, id);
      if (current === null)
        throw new ProductCatalogError('resource_not_found', 'The product variant was not found.');
      if (current.version !== expectedVersion)
        throw new ProductCatalogError('version_conflict', 'The variant version changed.');
      const next: ProductVariantRow = {
        ...current,
        sku: patch.sku === undefined ? current.sku : clean(patch.sku, 'sku'),
        name: patch.name === undefined ? current.name : nullable(patch.name),
        unitOfMeasureCode:
          patch.unitOfMeasureCode === undefined
            ? current.unitOfMeasureCode
            : clean(patch.unitOfMeasureCode, 'unit_of_measure_code').toLowerCase(),
        quantityScale: patch.quantityScale ?? current.quantityScale,
        tracksInventory: patch.tracksInventory ?? current.tracksInventory,
        standardCost:
          patch.standardCost === undefined ? current.standardCost : money(patch.standardCost),
        currencyCode:
          patch.currencyCode === undefined ? current.currencyCode : currency(patch.currencyCode),
        isDefault: patch.isDefault ?? current.isDefault,
        status: patch.status ?? current.status,
      };
      if (
        (product.productType === 'service' || product.productType === 'kit') &&
        next.tracksInventory
      )
        throw new ProductCatalogError(
          'invalid_variant_state',
          'Service and kit variants cannot track inventory.',
        );
      if (next.status === 'retired') next.isDefault = false;
      await this.repository.validateUnit(client, next.unitOfMeasureCode, next.quantityScale);
      const variants = (
        await this.repository.variantsForState(client, context.companyId, product.id)
      ).map((item) => (item.id === id ? next : item));
      assertState(product, variants);
      const updated = await this.repository.updateVariant(client, {
        ...context,
        ...next,
        normalizedSku: normalizedSku(next.sku),
        expectedVersion,
      });
      await this.repository.auditAndPublish(client, context, {
        action: updated.status === 'retired' ? 'variant.retired' : 'variant.updated',
        resourceType: 'product_variant',
        resourceId: updated.id,
        eventType: 'product_variant.updated',
        version: updated.version,
        payload: this.variantPayload(updated),
      });
      return updated;
    });
  }

  private productPayload(value: ProductRow): Readonly<Record<string, unknown>> {
    return {
      product_id: value.id,
      category_id: value.categoryId,
      brand_id: value.brandId,
      code: value.code,
      product_type: value.productType,
      tracks_inventory: value.tracksInventory,
      status: value.status,
      version: value.version.toString(),
    };
  }

  private variantPayload(value: ProductVariantRow): Readonly<Record<string, unknown>> {
    return {
      product_variant_id: value.id,
      product_id: value.productId,
      sku: value.sku,
      unit_of_measure_code: value.unitOfMeasureCode,
      tracks_inventory: value.tracksInventory,
      is_default: value.isDefault,
      status: value.status,
      version: value.version.toString(),
    };
  }
}
