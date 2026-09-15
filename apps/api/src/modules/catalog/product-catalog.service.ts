import { createHash, randomUUID } from 'node:crypto';

import {
  CatalogDomainError,
  generateOptionSignature,
  normalizeBarcode,
  normalizeCatalogCode,
  normalizeCurrencyCode,
  normalizeMoneyAmount,
  normalizeProductTaxCode,
  normalizeSku,
  validateBarcode,
  validateProductVariantState,
} from '@asone/database';

import type { ProductCatalogRepository } from './product-catalog.repository.js';
import type { ProductImageStorage } from './product-images.storage.js';
import type {
  CreateBarcodeInput,
  CreateProductInput,
  CreateProductPriceInput,
  CreateVariantInput,
  ProductCardStyle,
  ProductDetail,
  ProductExportFilters,
  ProductExportRow,
  ProductFilters,
  ProductIconKey,
  ProductMutationContext,
  ProductPage,
  ProductPriceRow,
  ProductRow,
  ProductVariantPage,
  ProductVariantRow,
  UpdateProductInput,
  UpdateVariantInput,
} from './product-catalog.types.js';
import { ProductCatalogError, productIconKeys } from './product-catalog.types.js';

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
// TASK 16.6 — `min_stock` (legacy "Stock mínimo" parity) is a decimal
// like `standardCost`, but matches this column's own `numeric(19, 6)`
// scale (packages/database/src/schema/catalog.ts) rather than
// `standardCost`'s 4-decimal money scale — a reorder-point quantity, not
// a currency amount.
function stockAmount(value: string): string {
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(value))
    throw new ProductCatalogError(
      'validation_error',
      'min_stock must be a non-negative decimal with at most six decimals.',
    );
  const [matchedWhole, fraction = ''] = value.split('.');
  const whole = matchedWhole ?? '0';
  return `${whole}.${fraction.padEnd(6, '0')}`;
}
// TASK 16.6 — `icon_key` is enum-validated at the route's JSON schema
// (see product-catalog.routes.ts) the same way `status`/`product_type`
// already are; this is the service-layer normalizer that mirrors
// `normalizedTaxCode()`'s own belt-and-suspenders pattern just below it
// for every other enum-like field in this file.
function validatedIconKey(value: string): ProductIconKey {
  if (!(productIconKeys as readonly string[]).includes(value))
    throw new ProductCatalogError('validation_error', 'icon_key is not a recognized product icon.');
  return value as ProductIconKey;
}
// TASK 16.6 — mirrors the legacy's own `mpColorSetModo()` 3-mode system
// (see `productCardStyles`'s own doc comment in product-catalog.types.ts)
// exactly at the DB level via `products_card_color_hex_ck`; re-asserted
// here so a caller gets a real 400 rather than a raw 500 from a
// constraint violation.
function hexColor(value: string): string {
  const result = value.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(result))
    throw new ProductCatalogError(
      'validation_error',
      'card_color_hex must be a 6-digit hex color, e.g. #6B3FA0.',
    );
  return result.toUpperCase();
}
function assertCardAppearance(cardStyle: ProductCardStyle, cardColorHex: string | null): void {
  if (cardStyle !== 'default' && cardColorHex === null)
    throw new ProductCatalogError(
      'validation_error',
      'card_color_hex is required when card_style is not "default".',
    );
}
// TASK 16.6 — see `CreateProductInput.imageUrl`'s own doc comment: this
// field is ONLY ever an already-hosted external http(s) reference the
// server stores as-is and NEVER fetches itself (no SSRF surface); a real
// uploaded photo goes through the dedicated multipart image endpoint
// instead, which never accepts this field as raw client input.
function externalImageUrl(value: string): string {
  const result = value.trim();
  if (result.length > 2048)
    throw new ProductCatalogError('validation_error', 'image_url must be at most 2048 characters.');
  if (!/^https?:\/\//i.test(result))
    throw new ProductCatalogError('validation_error', 'image_url must be an absolute http(s) URL.');
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
function normalizedTaxCode(value: string): ProductRow['taxCode'] {
  try {
    return normalizeProductTaxCode(value);
  } catch (error) {
    mapDomain(error);
  }
}
// TASK 12.3C: dedicated normalizers for `product_prices.amount`/
// `currency_code` — deliberately separate from the pre-existing local
// `money()`/`currency()` above (which validate `standard_cost`, an
// unrelated field with its own established call sites) rather than
// refactoring those in place.
function priceAmount(value: string): string {
  try {
    return normalizeMoneyAmount(value);
  } catch (error) {
    mapDomain(error);
  }
}
function priceCurrency(value: string): string {
  try {
    return normalizeCurrencyCode(value.trim().toUpperCase());
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
function decodePrice(raw: unknown): ProductPriceRow {
  const value = raw as Omit<
    ProductPriceRow,
    'version' | 'createdAt' | 'updatedAt' | 'validFrom' | 'validUntil'
  > & {
    version: string;
    createdAt: string;
    updatedAt: string;
    validFrom: string;
    validUntil: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    validFrom: new Date(value.validFrom),
    validUntil: value.validUntil === null ? null : new Date(value.validUntil),
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

// TASK 14.5 (Wave 3, Phase 7, Item 1) — mirrors `reports.service.ts`'s own
// private `csvEscape`/`csvRow` helper pair verbatim (that file's own doc
// comment explains the RFC 4180 quoting rule); duplicated here rather than
// imported so the catalog module never depends on the reports module for
// something this small.
function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
function csvRow(values: readonly string[]): string {
  return values.map(csvEscape).join(',') + '\r\n';
}
function buildProductExportCsv(rows: readonly ProductExportRow[]): string {
  let csv = csvRow([
    'id',
    'code',
    'name',
    'product_type',
    'tracks_inventory',
    'tax_code',
    'status',
    'category_id',
    'category_name',
    'brand_id',
    'brand_name',
    'default_sku',
    'default_cost',
    'default_currency_code',
    'created_at',
    'updated_at',
  ]);
  for (const row of rows) {
    csv += csvRow([
      row.id,
      row.code,
      row.name,
      row.productType,
      String(row.tracksInventory),
      row.taxCode,
      row.status,
      row.categoryId ?? '',
      row.categoryName ?? '',
      row.brandId ?? '',
      row.brandName ?? '',
      row.defaultSku ?? '',
      row.defaultCost ?? '',
      row.defaultCurrencyCode ?? '',
      row.createdAt.toISOString(),
      row.updatedAt.toISOString(),
    ]);
  }
  return csv;
}

export class ProductCatalogService {
  // TASK 16.6 — `imageStorage` is optional, mirroring
  // `branding.storage.ts`'s own established "optional external
  // dependency" pattern (see register-plugins.ts): when the `MINIO_*`
  // env vars aren't present, the two image routes are simply never
  // registered rather than the whole app failing to boot, and this
  // service never touches the object store from any other code path.
  public constructor(
    private readonly repository: ProductCatalogRepository,
    private readonly imageStorage?: ProductImageStorage,
  ) {}

  public listProducts(companyId: string, input: ProductFilters): Promise<ProductPage> {
    return this.repository.listProducts(companyId, {
      ...input,
      ...(input.sku === undefined ? {} : { sku: normalizedSku(input.sku) }),
      ...(input.barcode === undefined ? {} : { barcode: input.barcode.normalize('NFKC').trim() }),
    });
  }

  // TASK 14.5 (Wave 3, Phase 7, Item 1): a real CSV export of the live
  // company catalog — the honest port of AS POS V1's own genuine
  // `simularImport()`-adjacent-but-real CSV Blob download (that legacy
  // export itself was real, unlike the import beside it — see
  // `docs/LEGACY_FUNCTIONAL_PARITY.md` §3). Never paginated, never
  // aggregated — every matching product is one CSV row.
  public async exportCsv(companyId: string, input: ProductExportFilters): Promise<string> {
    const rows = await this.repository.exportRows(companyId, input);
    return buildProductExportCsv(rows);
  }

  public async product(
    companyId: string,
    id: string,
    branchId: string | null = null,
  ): Promise<ProductDetail> {
    const value = await this.repository.product(companyId, id, branchId);
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
      taxCode: normalizedTaxCode(input.taxCode ?? 'IVA_GENERAL'),
      status: input.status,
      categoryId: input.categoryId ?? null,
      brandId: input.brandId ?? null,
      imageUrl: input.imageUrl === undefined ? null : externalImageUrl(input.imageUrl),
      iconKey: input.iconKey === undefined ? null : validatedIconKey(input.iconKey),
      cardStyle: input.cardStyle ?? 'default',
      cardColorHex: input.cardColorHex === undefined ? null : hexColor(input.cardColorHex),
      isFeatured: input.isFeatured ?? false,
      preferredSupplierId: input.preferredSupplierId ?? null,
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
              minStock:
                input.defaultVariant.minStock === undefined
                  ? null
                  : stockAmount(input.defaultVariant.minStock),
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
    assertCardAppearance(normalized.cardStyle, normalized.cardColorHex);
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
            normalized.preferredSupplierId,
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
          // A freshly created product has no price yet — price creation
          // is a separate, explicit follow-up call (`createProductPrice`),
          // never fabricated here.
          const detail = { ...created, defaultVariant, effectivePrice: null };
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

  // TASK 16.6 (Productos/Catálogo legacy parity) — "Duplicar"
  // (`AS POS V1.html:1202,6279-6290`, confirmed genuinely functional:
  // `Object.assign({},p,{id:uid(),nombre:p.nombre+" (copia)"...})`). The
  // legacy could get away with a literal in-memory clone because it had
  // no real uniqueness constraints; this schema enforces a real
  // `products_company_code_uq`/`product_variants_company_sku_active_uq`,
  // so a byte-for-byte duplicate is never valid here. Instead this
  // derives a new, guaranteed-unique `code`/`sku` (a short numeric
  // suffix, retried on a real 409 collision — bounded, no infinite
  // loop) and delegates entirely to the already-real, already-validated,
  // already-idempotent `createProduct` — never a second, divergent
  // insert path. The new product starts as `draft` regardless of the
  // source's own status (mirrors this schema's own "a product cannot be
  // created retired" rule and avoids silently activating a duplicate
  // the operator hasn't reviewed yet); every other real field (category,
  // brand, tax code, tracks-inventory, image/icon/card appearance,
  // featured flag, preferred supplier, default variant's unit/cost/
  // currency) is copied — matching the legacy's own real intent of
  // "start from an exact copy," just landing in `draft` for a real
  // review step the legacy never had (and never enforced) either.
  public async duplicateProduct(
    context: ProductMutationContext,
    sourceId: string,
  ): Promise<{ value: ProductDetail; replayed: boolean }> {
    const source = await this.repository.product(context.companyId, sourceId, null);
    if (source === null)
      throw new ProductCatalogError('resource_not_found', 'The product was not found.');
    const MAX_ATTEMPTS = 20;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const suffix = attempt === 1 ? '-copia' : `-copia-${String(attempt)}`;
      // Built via conditional spread, never `x ?? undefined`, so an
      // explicit `undefined` is never assigned to an optional key — this
      // file's `tsconfig` enables `exactOptionalPropertyTypes`, under
      // which those are NOT equivalent to omitting the key.
      const input: CreateProductInput = {
        code: `${source.code}${suffix}`,
        name: `${source.name} (copia)`,
        productType: source.productType,
        tracksInventory: source.tracksInventory,
        taxCode: source.taxCode,
        status: 'draft',
        cardStyle: source.cardStyle,
        isFeatured: source.isFeatured,
        ...(source.description === null ? {} : { description: source.description }),
        ...(source.categoryId === null ? {} : { categoryId: source.categoryId }),
        ...(source.brandId === null ? {} : { brandId: source.brandId }),
        ...(source.imageUrl === null ? {} : { imageUrl: source.imageUrl }),
        ...(source.iconKey === null ? {} : { iconKey: source.iconKey }),
        ...(source.cardColorHex === null ? {} : { cardColorHex: source.cardColorHex }),
        ...(source.preferredSupplierId === null
          ? {}
          : { preferredSupplierId: source.preferredSupplierId }),
        ...(source.defaultVariant === null
          ? {}
          : {
              defaultVariant: {
                sku: `${source.defaultVariant.sku}${suffix.toUpperCase()}`,
                unitOfMeasureCode: source.defaultVariant.unitOfMeasureCode,
                quantityScale: source.defaultVariant.quantityScale,
                tracksInventory: source.defaultVariant.tracksInventory,
                standardCost: source.defaultVariant.standardCost,
                currencyCode: source.defaultVariant.currencyCode,
                ...(source.defaultVariant.name === null
                  ? {}
                  : { name: source.defaultVariant.name }),
                ...(source.defaultVariant.minStock === null
                  ? {}
                  : { minStock: source.defaultVariant.minStock }),
              },
            }),
      };
      try {
        // A fresh idempotency key per attempt — this is a brand-new
        // logical creation each time (not a retry of the SAME request),
        // so replaying the prior attempt's key would incorrectly return
        // the prior (colliding, never-committed) attempt's cached
        // response instead of actually creating anything.
        return await this.createProduct(
          context,
          `duplicate-${sourceId}-${String(attempt)}-${randomUUID()}`,
          input,
        );
      } catch (error) {
        const isCodeOrSkuCollision =
          error instanceof ProductCatalogError &&
          (error.code === 'duplicate_product_code' || error.code === 'duplicate_sku');
        if (!isCodeOrSkuCollision || attempt === MAX_ATTEMPTS) throw error;
      }
    }
    throw new ProductCatalogError(
      'validation_error',
      'Could not generate a unique code for the duplicated product.',
    );
  }

  // TASK 16.6 (Productos/Catálogo legacy parity, `AS POS V1.html`'s
  // Extras tab, `cargarImagenProducto()`) — the real-photo-upload half
  // of the legacy's genuinely functional image management (the OTHER
  // half, pasting an external URL, is `imageUrl` on
  // `createProduct`/`patchProduct` above). Mirrors
  // `BrandingService.uploadLogo()`'s own orchestration exactly: upload
  // the real bytes to object storage FIRST, then persist the resulting
  // URL through the normal CAS-guarded product-update path
  // (`patchProduct`, never a second, divergent write) — best-effort
  // cleanup of the just-uploaded object if that commit fails, so a
  // rejected request (most commonly a stale `If-Match`) never leaves an
  // orphaned file behind.
  public async uploadProductImage(
    context: ProductMutationContext,
    id: string,
    expectedVersion: bigint,
    file: { readonly buffer: Buffer; readonly contentType: string; readonly extension: string },
  ): Promise<ProductRow> {
    if (this.imageStorage === undefined)
      throw new ProductCatalogError('validation_error', 'Product image storage is not configured.');
    const uploaded = await this.imageStorage.uploadImage(
      context.companyId,
      file.buffer,
      file.contentType,
      file.extension,
    );
    try {
      return await this.patchProduct(context, id, expectedVersion, { imageUrl: uploaded.url });
    } catch (error) {
      await this.imageStorage.deleteObjectBestEffort(uploaded.key);
      throw error;
    }
  }

  // Clears `image_url` back to `null` through the same CAS-guarded
  // `patchProduct` path, then best-effort deletes the previously-stored
  // object. The current URL is read BEFORE the mutation (so the delete
  // can proceed even though the row no longer carries it afterward),
  // exactly like `BrandingService.deleteLogo()`; if the mutation itself
  // fails (e.g. a stale `If-Match`), nothing is deleted.
  public async deleteProductImage(
    context: ProductMutationContext,
    id: string,
    expectedVersion: bigint,
  ): Promise<ProductRow> {
    if (this.imageStorage === undefined)
      throw new ProductCatalogError('validation_error', 'Product image storage is not configured.');
    const before = await this.product(context.companyId, id, null);
    const updated = await this.patchProduct(context, id, expectedVersion, { imageUrl: null });
    if (before.imageUrl !== null) {
      const key = this.imageStorage.keyFromUrl(before.imageUrl);
      if (key !== undefined) await this.imageStorage.deleteObjectBestEffort(key);
    }
    return updated;
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
        taxCode: patch.taxCode === undefined ? current.taxCode : normalizedTaxCode(patch.taxCode),
        status: patch.status ?? current.status,
        categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
        brandId: patch.brandId === undefined ? current.brandId : patch.brandId,
        imageUrl:
          patch.imageUrl === undefined
            ? current.imageUrl
            : patch.imageUrl === null
              ? null
              : externalImageUrl(patch.imageUrl),
        iconKey:
          patch.iconKey === undefined
            ? current.iconKey
            : patch.iconKey === null
              ? null
              : validatedIconKey(patch.iconKey),
        cardStyle: patch.cardStyle ?? current.cardStyle,
        cardColorHex:
          patch.cardColorHex === undefined
            ? current.cardColorHex
            : patch.cardColorHex === null
              ? null
              : hexColor(patch.cardColorHex),
        isFeatured: patch.isFeatured ?? current.isFeatured,
        preferredSupplierId:
          patch.preferredSupplierId === undefined
            ? current.preferredSupplierId
            : patch.preferredSupplierId,
      };
      if ((next.productType === 'service' || next.productType === 'kit') && next.tracksInventory)
        throw new ProductCatalogError(
          'invalid_product_state',
          'Service and kit products cannot track inventory.',
        );
      assertCardAppearance(next.cardStyle, next.cardColorHex);
      await this.repository.validateReferences(
        client,
        context.companyId,
        next.categoryId,
        next.brandId,
        next.preferredSupplierId,
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
      minStock: input.minStock === undefined ? null : stockAmount(input.minStock),
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
        minStock:
          patch.minStock === undefined
            ? current.minStock
            : patch.minStock === null
              ? null
              : stockAmount(patch.minStock),
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

  /**
   * TASK 12.3C, E058-equivalent: creates one effective-dated price for a
   * product. The backend is the sole authority — the caller supplies an
   * amount/currency/optional validity window, never a pre-computed total;
   * `price.manage` is required (see routes), matching every other
   * catalog-mutation permission in this module. Idempotent, same pattern
   * as `createProduct`/`createVariant`.
   */
  public createProductPrice(
    context: ProductMutationContext,
    productId: string,
    key: string,
    input: CreateProductPriceInput,
  ): Promise<{ value: ProductPriceRow; replayed: boolean }> {
    const normalized = {
      id: input.id ?? randomUUID(),
      productId,
      branchId: input.branchId ?? null,
      priceType: 'standard',
      amount: priceAmount(input.amount),
      currencyCode: priceCurrency(input.currencyCode),
      validFrom: input.validFrom ?? context.timestamp,
      validUntil: input.validUntil ?? null,
    };
    if (normalized.validUntil !== null && normalized.validUntil <= normalized.validFrom)
      throw new ProductCatalogError(
        'validation_error',
        'valid_until must be after valid_from when provided.',
      );
    const requestHash = hash({ ...normalized, id: input.id ?? null });
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'product_price.create',
        key,
        requestHash,
        'product_price',
        decodePrice,
        async () => {
          const product = await this.repository.lockProduct(client, context.companyId, productId);
          if (product === null)
            throw new ProductCatalogError('resource_not_found', 'The product was not found.');
          if (normalized.branchId !== null)
            await this.repository.validateBranch(client, context.companyId, normalized.branchId);
          const created = await this.repository.insertProductPrice(client, {
            ...context,
            ...normalized,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'price.created',
            resourceType: 'product_price',
            resourceId: created.id,
            eventType: 'product.price_changed',
            version: created.version,
            payload: {
              product_price_id: created.id,
              product_id: created.productId,
              branch_id: created.branchId,
              price_type: created.priceType,
              amount: created.amount,
              currency_code: created.currencyCode,
              status: created.status,
              version: created.version.toString(),
            },
          });
          return created;
        },
      ),
    );
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
