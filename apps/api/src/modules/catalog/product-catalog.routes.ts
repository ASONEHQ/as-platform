import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  imageFileExtension,
  isAllowedImageContentType,
  matchesImageFileSignature,
  type AllowedImageContentType,
} from '../../http/image-upload-validation.js';
import { responseMeta, successResponse } from '../../http/response.js';
import {
  requireAuthenticatedUser,
  requireBranchAccess,
  requirePermission,
} from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey, parseIfMatch } from './catalog.schemas.js';
import { withProductCatalogErrors } from './product-catalog.http-errors.js';
import type { ProductCatalogService } from './product-catalog.service.js';
import type {
  BarcodeType,
  CreateProductInput,
  CreateProductPriceInput,
  CreateVariantInput,
  ProductCardStyle,
  ProductIconKey,
  ProductMutationContext,
  ProductPriceRow,
  ProductRow,
  ProductStatus,
  ProductTaxCode,
  ProductType,
  ProductVariantRow,
  UpdateProductInput,
  UpdateVariantInput,
  VariantStatus,
} from './product-catalog.types.js';
import { productCardStyles, productIconKeys, productTaxCodes } from './product-catalog.types.js';
import type { ProductImageStorage } from './product-images.storage.js';

interface Params {
  id: string;
}
interface ProductParams {
  product_id: string;
}
interface ListQuery {
  cursor?: string;
  limit?: number;
  status?: ProductStatus;
  product_type?: ProductType;
  category_id?: string;
  brand_id?: string;
  search?: string;
  sku?: string;
  barcode?: string;
  branch_id?: string;
}
interface DetailQuery {
  branch_id?: string;
}
interface VariantListQuery {
  cursor?: string;
  limit?: number;
  status?: VariantStatus;
}
interface BarcodeBody {
  type: BarcodeType;
  value: string;
  is_primary?: boolean;
}
interface DefaultVariantBody {
  sku: string;
  name?: string;
  unit_of_measure_code: string;
  quantity_scale?: number;
  tracks_inventory?: boolean;
  standard_cost?: string;
  currency_code?: string;
  min_stock?: string;
  barcode?: BarcodeBody;
}
interface ProductBody {
  id?: string;
  code: string;
  name: string;
  description?: string;
  product_type: ProductType;
  tracks_inventory?: boolean;
  tax_code?: ProductTaxCode;
  status?: ProductStatus;
  category_id?: string;
  brand_id?: string;
  image_url?: string;
  icon_key?: ProductIconKey;
  card_style?: ProductCardStyle;
  card_color_hex?: string;
  is_featured?: boolean;
  preferred_supplier_id?: string;
  default_variant?: DefaultVariantBody;
}
interface ProductPatchBody {
  name?: string;
  description?: string | null;
  tracks_inventory?: boolean;
  tax_code?: ProductTaxCode;
  status?: ProductStatus;
  category_id?: string | null;
  brand_id?: string | null;
  image_url?: string | null;
  icon_key?: ProductIconKey | null;
  card_style?: ProductCardStyle;
  card_color_hex?: string | null;
  is_featured?: boolean;
  preferred_supplier_id?: string | null;
}
interface ProductPriceBody {
  id?: string;
  branch_id?: string;
  amount: string;
  currency_code: string;
  valid_from?: string;
  valid_until?: string;
}
interface VariantBody {
  id?: string;
  sku: string;
  name?: string;
  unit_of_measure_code: string;
  quantity_scale?: number;
  tracks_inventory?: boolean;
  standard_cost?: string;
  currency_code?: string;
  min_stock?: string;
  is_default?: boolean;
  status?: VariantStatus;
  option_value_ids?: [];
  barcode?: BarcodeBody;
}
interface VariantPatchBody {
  sku?: string;
  name?: string | null;
  unit_of_measure_code?: string;
  quantity_scale?: number;
  tracks_inventory?: boolean;
  standard_cost?: string;
  currency_code?: string;
  min_stock?: string | null;
  is_default?: boolean;
  status?: VariantStatus;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;
const rejectUnknown = { not: {} } as const;
const idParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: uuid },
} as const;
const productParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['product_id'],
  properties: { product_id: uuid },
} as const;
const barcodeSchema = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['type', 'value'],
  properties: {
    type: { type: 'string', enum: ['ean13', 'upca', 'code128', 'qr', 'internal'] },
    value: { type: 'string', minLength: 1, maxLength: 255 },
    is_primary: { type: 'boolean' },
  },
} as const;
// TASK 16.6 — `min_stock` matches `product_variants.min_stock`'s own
// `numeric(19, 6)` scale (packages/database/src/schema/catalog.ts), NOT
// `standard_cost`'s 4-decimal money pattern — a reorder-point quantity,
// not a currency amount.
const minStockPattern = '^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,6})?$';
const imageUrlSchema = { type: 'string', minLength: 1, maxLength: 2048, format: 'uri' } as const;
const cardColorHexSchema = { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } as const;
const defaultVariantSchema = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['sku', 'unit_of_measure_code'],
  properties: {
    sku: { type: 'string', minLength: 1, maxLength: 255 },
    name: { type: 'string', maxLength: 255 },
    unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
    quantity_scale: { type: 'integer', minimum: 0, maximum: 6 },
    tracks_inventory: { type: 'boolean' },
    standard_cost: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,4})?$' },
    currency_code: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    min_stock: { type: 'string', pattern: minStockPattern },
    barcode: barcodeSchema,
  },
} as const;
const productBodySchema = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['code', 'name', 'product_type'],
  properties: {
    id: uuid,
    code: { type: 'string', minLength: 1, maxLength: 255 },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    description: { type: 'string', maxLength: 2000 },
    product_type: { type: 'string', enum: ['simple', 'variable', 'kit', 'service'] },
    tracks_inventory: { type: 'boolean' },
    tax_code: { type: 'string', enum: productTaxCodes },
    status: { type: 'string', enum: ['draft', 'active', 'inactive'] },
    category_id: uuid,
    brand_id: uuid,
    image_url: imageUrlSchema,
    icon_key: { type: 'string', enum: productIconKeys },
    card_style: { type: 'string', enum: productCardStyles },
    card_color_hex: cardColorHexSchema,
    is_featured: { type: 'boolean' },
    preferred_supplier_id: uuid,
    default_variant: defaultVariantSchema,
  },
} as const;
const productPatchSchema = {
  type: 'object',
  additionalProperties: rejectUnknown,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    description: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    tracks_inventory: { type: 'boolean' },
    tax_code: { type: 'string', enum: productTaxCodes },
    status: { type: 'string', enum: ['draft', 'active', 'inactive', 'retired'] },
    category_id: { anyOf: [uuid, { type: 'null' }] },
    brand_id: { anyOf: [uuid, { type: 'null' }] },
    image_url: { anyOf: [imageUrlSchema, { type: 'null' }] },
    icon_key: { anyOf: [{ type: 'string', enum: productIconKeys }, { type: 'null' }] },
    card_style: { type: 'string', enum: productCardStyles },
    card_color_hex: { anyOf: [cardColorHexSchema, { type: 'null' }] },
    is_featured: { type: 'boolean' },
    preferred_supplier_id: { anyOf: [uuid, { type: 'null' }] },
  },
} as const;
const productPriceBodySchema = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['amount', 'currency_code'],
  properties: {
    id: uuid,
    branch_id: uuid,
    amount: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,4})?$' },
    currency_code: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    valid_from: { type: 'string', format: 'date-time' },
    valid_until: { type: 'string', format: 'date-time' },
  },
} as const;
const variantBodySchema = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['sku', 'unit_of_measure_code'],
  properties: {
    id: uuid,
    sku: { type: 'string', minLength: 1, maxLength: 255 },
    name: { type: 'string', maxLength: 255 },
    unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
    quantity_scale: { type: 'integer', minimum: 0, maximum: 6 },
    tracks_inventory: { type: 'boolean' },
    standard_cost: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,4})?$' },
    currency_code: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    min_stock: { type: 'string', pattern: minStockPattern },
    is_default: { type: 'boolean' },
    status: { type: 'string', enum: ['active', 'inactive'] },
    option_value_ids: { type: 'array', maxItems: 16, uniqueItems: true, items: uuid },
    barcode: barcodeSchema,
  },
} as const;
const variantPatchSchema = {
  type: 'object',
  additionalProperties: rejectUnknown,
  minProperties: 1,
  properties: {
    sku: { type: 'string', minLength: 1, maxLength: 255 },
    name: { anyOf: [{ type: 'string', maxLength: 255 }, { type: 'null' }] },
    unit_of_measure_code: { type: 'string', minLength: 1, maxLength: 32 },
    quantity_scale: { type: 'integer', minimum: 0, maximum: 6 },
    tracks_inventory: { type: 'boolean' },
    standard_cost: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,4})?$' },
    currency_code: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    min_stock: { anyOf: [{ type: 'string', pattern: minStockPattern }, { type: 'null' }] },
    is_default: { type: 'boolean' },
    status: { type: 'string', enum: ['active', 'inactive', 'retired'] },
  },
} as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;
const ifMatchHeaders = {
  type: 'object',
  required: ['if-match'],
  properties: { 'if-match': { type: 'string' } },
} as const;

function mutationContext(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
): ProductMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}
function hasCostPermission(permissions: readonly string[]): boolean {
  return permissions.includes('inventory.cost.read');
}
function variantHttp(
  value: ProductVariantRow,
  showCost: boolean,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    product_id: value.productId,
    sku: value.sku,
    name: value.name,
    unit_of_measure_code: value.unitOfMeasureCode,
    quantity_scale: value.quantityScale,
    tracks_inventory: value.tracksInventory,
    ...(showCost ? { standard_cost: value.standardCost, currency_code: value.currencyCode } : {}),
    min_stock: value.minStock,
    is_default: value.isDefault,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
// TASK 12.3C: `amount`/`currency_code` pass through as the exact decimal
// string / ISO 4217 code already returned by the repository — never
// coerced to a JS number (ADR-0001, docs/API_CONTRACTS.md §3/§8.3).
function priceHttp(value: ProductPriceRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    product_id: value.productId,
    price_type: value.priceType,
    amount: value.amount,
    currency_code: value.currencyCode,
    valid_from: value.validFrom.toISOString(),
    valid_until: value.validUntil === null ? null : value.validUntil.toISOString(),
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function productHttp(
  value: ProductRow & {
    defaultVariant?: ProductVariantRow | null;
    effectivePrice?: ProductPriceRow | null;
  },
  showCost: boolean,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    category_id: value.categoryId,
    brand_id: value.brandId,
    code: value.code,
    name: value.name,
    description: value.description,
    product_type: value.productType,
    tracks_inventory: value.tracksInventory,
    tax_code: value.taxCode,
    status: value.status,
    image_url: value.imageUrl,
    icon_key: value.iconKey,
    card_style: value.cardStyle,
    card_color_hex: value.cardColorHex,
    is_featured: value.isFeatured,
    preferred_supplier_id: value.preferredSupplierId,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    ...('defaultVariant' in value
      ? {
          default_variant:
            value.defaultVariant === null ? null : variantHttp(value.defaultVariant, showCost),
        }
      : {}),
    // `null` is honest ("no active price exists yet") and must stay
    // distinguishable from a genuinely free `"0.0000"` price — never
    // silently coerced to zero.
    ...('effectivePrice' in value
      ? { effective_price: value.effectivePrice === null ? null : priceHttp(value.effectivePrice) }
      : {}),
  };
}

// TASK 16.6 — real photo upload for a product's Extras tab, mirroring
// `branding.routes.ts`'s own `readLogoFile`/error-mapping pattern
// exactly (same magic-byte sniffing, same Fastify error-code mapping),
// generalized onto `../../http/image-upload-validation.js` rather than
// hand-copied.
const PRODUCT_IMAGE_ROUTE_BODY_LIMIT_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

function isFileTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}
function isNotMultipartError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'FST_INVALID_MULTIPART_CONTENT_TYPE'
  );
}
function oversizedImageError(): AppError {
  return new AppError({
    code: 'payload_too_large',
    message: `The product image exceeds the maximum size of ${String(MAX_IMAGE_BYTES)} bytes.`,
    statusCode: 413,
  });
}
function unsupportedImageTypeError(message: string): AppError {
  return new AppError({ code: 'unsupported_media_type', message, statusCode: 415 });
}
interface ReadProductImageFileResult {
  readonly buffer: Buffer;
  readonly contentType: AllowedImageContentType;
  readonly extension: string;
}
async function readProductImageFile(request: FastifyRequest): Promise<ReadProductImageFileResult> {
  const file = await request
    .file({ limits: { fileSize: MAX_IMAGE_BYTES } })
    .catch((error: unknown) => {
      if (isFileTooLargeError(error)) throw oversizedImageError();
      if (isNotMultipartError(error))
        throw new AppError({
          code: 'validation_error',
          message: 'The request must be a multipart/form-data upload.',
          statusCode: 400,
        });
      throw error;
    });
  if (file === undefined)
    throw new AppError({
      code: 'validation_error',
      message: 'A product image file is required.',
      statusCode: 400,
    });
  const declared = file.mimetype.toLowerCase();
  if (!isAllowedImageContentType(declared))
    throw unsupportedImageTypeError(
      `The image content type must be one of: ${ALLOWED_IMAGE_CONTENT_TYPES.join(', ')}.`,
    );
  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (error) {
    if (isFileTooLargeError(error)) throw oversizedImageError();
    throw error;
  }
  if (buffer.length > MAX_IMAGE_BYTES) throw oversizedImageError();
  if (!matchesImageFileSignature(declared, buffer))
    throw unsupportedImageTypeError(
      'The uploaded file does not match its declared image content type.',
    );
  return { buffer, contentType: declared, extension: imageFileExtension(declared) };
}

export function registerProductCatalogRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: ProductCatalogService,
  // TASK 16.6 — optional, mirroring `register-plugins.ts`'s own
  // established "optional external dependency" pattern for branding:
  // when `undefined` (the `MINIO_*` env vars aren't provisioned), the
  // two image routes below are simply never registered, a real 404
  // rather than a runtime failure.
  imageStorage?: ProductImageStorage,
): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/products',
    {
      schema: {
        tags: ['catalog'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            status: { type: 'string', enum: ['draft', 'active', 'inactive', 'retired'] },
            product_type: { type: 'string', enum: ['simple', 'variable', 'kit', 'service'] },
            category_id: uuid,
            brand_id: uuid,
            search: { type: 'string', minLength: 1, maxLength: 255 },
            sku: { type: 'string', minLength: 1, maxLength: 255 },
            barcode: { type: 'string', minLength: 1, maxLength: 255 },
            branch_id: uuid,
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const query = request.query;
        // ADR-0006: a caller may narrow to one of their own authorized
        // branches (validated here) to resolve that branch's price
        // override; they can never widen scope this way.
        if (query.branch_id !== undefined)
          requireBranchAccess(authentication, context, query.branch_id);
        const page = await service.listProducts(context.companyId, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.product_type === undefined ? {} : { productType: query.product_type }),
          ...(query.category_id === undefined ? {} : { categoryId: query.category_id }),
          ...(query.brand_id === undefined ? {} : { brandId: query.brand_id }),
          ...(query.search === undefined ? {} : { search: query.search }),
          ...(query.sku === undefined ? {} : { sku: query.sku }),
          ...(query.barcode === undefined ? {} : { barcode: query.barcode }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
        });
        return reply.send({
          data: page.items.map((item) => productHttp(item, hasCostPermission(context.permissions))),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  // TASK 14.5 (Wave 3, Phase 7, Item 1): GET /api/v1/products/export.csv —
  // a real CSV Blob-equivalent dump of the live company catalog, gated by
  // the same `catalog.read` permission as the list route above (this is a
  // read, not a mutation). Registered as a literal path — Fastify's radix
  // router always prefers a literal segment ("export.csv") over the
  // parametric `/api/v1/products/:id` route below regardless of
  // registration order, so no route ever shadows the other.
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/products/export.csv',
    {
      schema: {
        tags: ['catalog'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['draft', 'active', 'inactive', 'retired'] },
            product_type: { type: 'string', enum: ['simple', 'variable', 'kit', 'service'] },
            category_id: uuid,
            brand_id: uuid,
            search: { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
        response: { ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const query = request.query;
        const csv = await service.exportCsv(context.companyId, {
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.product_type === undefined ? {} : { productType: query.product_type }),
          ...(query.category_id === undefined ? {} : { categoryId: query.category_id }),
          ...(query.brand_id === undefined ? {} : { brandId: query.brand_id }),
          ...(query.search === undefined ? {} : { search: query.search }),
        });
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="product-catalog-export.csv"')
          .send(csv);
      }),
  );

  app.post<{ Body: ProductBody }>(
    '/api/v1/products',
    {
      schema: {
        tags: ['catalog'],
        headers: idempotencyHeaders,
        body: productBodySchema,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'product.manage');
        const body = request.body;
        const defaultVariant =
          body.default_variant === undefined
            ? undefined
            : {
                sku: body.default_variant.sku,
                unitOfMeasureCode: body.default_variant.unit_of_measure_code,
                quantityScale: body.default_variant.quantity_scale ?? 0,
                standardCost: body.default_variant.standard_cost ?? '0.0000',
                currencyCode: body.default_variant.currency_code ?? 'MXN',
                ...(body.default_variant.name === undefined
                  ? {}
                  : { name: body.default_variant.name }),
                ...(body.default_variant.tracks_inventory === undefined
                  ? {}
                  : { tracksInventory: body.default_variant.tracks_inventory }),
                ...(body.default_variant.min_stock === undefined
                  ? {}
                  : { minStock: body.default_variant.min_stock }),
                ...(body.default_variant.barcode === undefined
                  ? {}
                  : {
                      barcode: {
                        type: body.default_variant.barcode.type,
                        value: body.default_variant.barcode.value,
                        isPrimary: body.default_variant.barcode.is_primary ?? true,
                      },
                    }),
              };
        const input: CreateProductInput = {
          code: body.code,
          name: body.name,
          productType: body.product_type,
          tracksInventory: body.tracks_inventory ?? false,
          status: body.status ?? 'draft',
          ...(body.id === undefined ? {} : { id: body.id }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.tax_code === undefined ? {} : { taxCode: body.tax_code }),
          ...(body.category_id === undefined ? {} : { categoryId: body.category_id }),
          ...(body.brand_id === undefined ? {} : { brandId: body.brand_id }),
          ...(body.image_url === undefined ? {} : { imageUrl: body.image_url }),
          ...(body.icon_key === undefined ? {} : { iconKey: body.icon_key }),
          ...(body.card_style === undefined ? {} : { cardStyle: body.card_style }),
          ...(body.card_color_hex === undefined ? {} : { cardColorHex: body.card_color_hex }),
          ...(body.is_featured === undefined ? {} : { isFeatured: body.is_featured }),
          ...(body.preferred_supplier_id === undefined
            ? {}
            : { preferredSupplierId: body.preferred_supplier_id }),
          ...(defaultVariant === undefined ? {} : { defaultVariant }),
        };
        const created = await service.createProduct(
          mutationContext(request, context.companyId, context.userId),
          idempotencyKey(request.headers['idempotency-key']),
          input,
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(
            successResponse(
              productHttp(created.value, hasCostPermission(context.permissions)),
              request.requestContext,
            ),
          );
      }),
  );

  // TASK 16.6 (Productos/Catálogo legacy parity) — "Duplicar"
  // (`AS POS V1.html:1202,6279-6290`). No request body: everything the
  // duplicate needs comes from the source product itself, resolved and
  // validated entirely server-side in `service.duplicateProduct`. Gated
  // by the SAME `product.manage` permission as every other product
  // mutation in this module — a real 201 with the new product's full
  // representation, exactly like `POST /api/v1/products`.
  app.post<{ Params: Params }>(
    '/api/v1/products/:id/duplicate',
    {
      schema: {
        tags: ['catalog'],
        params: idParamsSchema,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'product.manage');
        const created = await service.duplicateProduct(
          mutationContext(request, context.companyId, context.userId),
          request.params.id,
        );
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(
            successResponse(
              productHttp(created.value, hasCostPermission(context.permissions)),
              request.requestContext,
            ),
          );
      }),
  );

  app.get<{ Params: Params; Querystring: DetailQuery }>(
    '/api/v1/products/:id',
    {
      schema: {
        tags: ['catalog'],
        params: idParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { branch_id: uuid },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const branchId = request.query.branch_id;
        if (branchId !== undefined) requireBranchAccess(authentication, context, branchId);
        const value = await service.product(context.companyId, request.params.id, branchId ?? null);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(
            successResponse(
              productHttp(value, hasCostPermission(context.permissions)),
              request.requestContext,
            ),
          );
      }),
  );

  app.patch<{ Params: Params; Body: ProductPatchBody }>(
    '/api/v1/products/:id',
    {
      schema: {
        tags: ['catalog'],
        params: idParamsSchema,
        headers: ifMatchHeaders,
        body: productPatchSchema,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'product.manage');
        const body = request.body;
        const patch: UpdateProductInput = {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.tracks_inventory === undefined
            ? {}
            : { tracksInventory: body.tracks_inventory }),
          ...(body.tax_code === undefined ? {} : { taxCode: body.tax_code }),
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.category_id === undefined ? {} : { categoryId: body.category_id }),
          ...(body.brand_id === undefined ? {} : { brandId: body.brand_id }),
          ...(body.image_url === undefined ? {} : { imageUrl: body.image_url }),
          ...(body.icon_key === undefined ? {} : { iconKey: body.icon_key }),
          ...(body.card_style === undefined ? {} : { cardStyle: body.card_style }),
          ...(body.card_color_hex === undefined ? {} : { cardColorHex: body.card_color_hex }),
          ...(body.is_featured === undefined ? {} : { isFeatured: body.is_featured }),
          ...(body.preferred_supplier_id === undefined
            ? {}
            : { preferredSupplierId: body.preferred_supplier_id }),
        };
        const value = await service.patchProduct(
          mutationContext(request, context.companyId, context.userId),
          request.params.id,
          parseIfMatch(request.headers['if-match']),
          patch,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(
            successResponse(
              productHttp(value, hasCostPermission(context.permissions)),
              request.requestContext,
            ),
          );
      }),
  );

  // TASK 16.6 (Productos/Catálogo legacy parity, `AS POS V1.html`'s
  // Extras tab, `cargarImagenProducto()`) — real multipart photo upload/
  // removal, only registered when the platform's object storage is
  // actually configured (see `imageStorage`'s own doc comment above).
  // Same `product.manage` permission and `If-Match`/CAS semantics as
  // every other product mutation in this module.
  if (imageStorage !== undefined) {
    app.post<{ Params: Params }>(
      '/api/v1/products/:id/image',
      {
        bodyLimit: PRODUCT_IMAGE_ROUTE_BODY_LIMIT_BYTES,
        schema: {
          tags: ['catalog'],
          summary: 'Upload a product image',
          consumes: ['multipart/form-data'],
          params: idParamsSchema,
          headers: ifMatchHeaders,
          response: { 200: responseSchema, ...commonErrors, 413: errorSchema, 415: errorSchema },
        },
      },
      async (request, reply) =>
        withProductCatalogErrors(async () => {
          const context = await requireAuthenticatedUser(request, authentication);
          requirePermission(authentication, context, 'product.manage');
          const expectedVersion = parseIfMatch(request.headers['if-match']);
          const file = await readProductImageFile(request);
          const value = await service.uploadProductImage(
            mutationContext(request, context.companyId, context.userId),
            request.params.id,
            expectedVersion,
            file,
          );
          return reply
            .header('etag', `"${value.version.toString()}"`)
            .send(
              successResponse(
                productHttp(value, hasCostPermission(context.permissions)),
                request.requestContext,
              ),
            );
        }),
    );

    app.delete<{ Params: Params }>(
      '/api/v1/products/:id/image',
      {
        schema: {
          tags: ['catalog'],
          summary: 'Remove a product image',
          params: idParamsSchema,
          headers: ifMatchHeaders,
          response: { 200: responseSchema, ...commonErrors },
        },
      },
      async (request, reply) =>
        withProductCatalogErrors(async () => {
          const context = await requireAuthenticatedUser(request, authentication);
          requirePermission(authentication, context, 'product.manage');
          const expectedVersion = parseIfMatch(request.headers['if-match']);
          const value = await service.deleteProductImage(
            mutationContext(request, context.companyId, context.userId),
            request.params.id,
            expectedVersion,
          );
          return reply
            .header('etag', `"${value.version.toString()}"`)
            .send(
              successResponse(
                productHttp(value, hasCostPermission(context.permissions)),
                request.requestContext,
              ),
            );
        }),
    );
  }

  app.get<{ Params: ProductParams; Querystring: VariantListQuery }>(
    '/api/v1/products/:product_id/variants',
    {
      schema: {
        tags: ['catalog'],
        params: productParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            status: { type: 'string', enum: ['active', 'inactive', 'retired'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const page = await service.listVariants(context.companyId, request.params.product_id, {
          limit: request.query.limit ?? 50,
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
        });
        return reply.send({
          data: page.items.map((item) => variantHttp(item, hasCostPermission(context.permissions))),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.post<{ Params: ProductParams; Body: VariantBody }>(
    '/api/v1/products/:product_id/variants',
    {
      schema: {
        tags: ['catalog'],
        params: productParamsSchema,
        headers: idempotencyHeaders,
        body: variantBodySchema,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'product.manage');
        const body = request.body;
        const input: CreateVariantInput = {
          sku: body.sku,
          unitOfMeasureCode: body.unit_of_measure_code,
          quantityScale: body.quantity_scale ?? 0,
          standardCost: body.standard_cost ?? '0.0000',
          currencyCode: body.currency_code ?? 'MXN',
          isDefault: body.is_default ?? false,
          status: body.status ?? 'active',
          optionValueIds: body.option_value_ids ?? [],
          ...(body.id === undefined ? {} : { id: body.id }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.tracks_inventory === undefined
            ? {}
            : { tracksInventory: body.tracks_inventory }),
          ...(body.min_stock === undefined ? {} : { minStock: body.min_stock }),
          ...(body.barcode === undefined
            ? {}
            : {
                barcode: {
                  type: body.barcode.type,
                  value: body.barcode.value,
                  isPrimary: body.barcode.is_primary ?? true,
                },
              }),
        };
        const created = await service.createVariant(
          mutationContext(request, context.companyId, context.userId),
          request.params.product_id,
          idempotencyKey(request.headers['idempotency-key']),
          input,
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(
            successResponse(
              variantHttp(created.value, hasCostPermission(context.permissions)),
              request.requestContext,
            ),
          );
      }),
  );

  // TASK 12.3C, E058-equivalent: creates one effective-dated product
  // price. `price.manage` — a real permission already seeded in
  // packages/database/src/seeds/technical-permissions.ts, previously
  // unused by any route — not a new one invented for this task.
  app.post<{ Params: ProductParams; Body: ProductPriceBody }>(
    '/api/v1/products/:product_id/prices',
    {
      schema: {
        tags: ['catalog'],
        params: productParamsSchema,
        headers: idempotencyHeaders,
        body: productPriceBodySchema,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'price.manage');
        const body = request.body;
        if (body.branch_id !== undefined)
          requireBranchAccess(authentication, context, body.branch_id);
        const input: CreateProductPriceInput = {
          amount: body.amount,
          currencyCode: body.currency_code,
          ...(body.id === undefined ? {} : { id: body.id }),
          ...(body.branch_id === undefined ? {} : { branchId: body.branch_id }),
          ...(body.valid_from === undefined ? {} : { validFrom: new Date(body.valid_from) }),
          ...(body.valid_until === undefined ? {} : { validUntil: new Date(body.valid_until) }),
        };
        const created = await service.createProductPrice(
          mutationContext(request, context.companyId, context.userId),
          request.params.product_id,
          idempotencyKey(request.headers['idempotency-key']),
          input,
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(priceHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/product-variants/:id',
    {
      schema: {
        tags: ['catalog'],
        params: idParamsSchema,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const value = await service.variant(context.companyId, request.params.id);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(
            successResponse(
              variantHttp(value, hasCostPermission(context.permissions)),
              request.requestContext,
            ),
          );
      }),
  );

  app.patch<{ Params: Params; Body: VariantPatchBody }>(
    '/api/v1/product-variants/:id',
    {
      schema: {
        tags: ['catalog'],
        params: idParamsSchema,
        headers: ifMatchHeaders,
        body: variantPatchSchema,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'product.manage');
        const body = request.body;
        const patch: UpdateVariantInput = {
          ...(body.sku === undefined ? {} : { sku: body.sku }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.unit_of_measure_code === undefined
            ? {}
            : { unitOfMeasureCode: body.unit_of_measure_code }),
          ...(body.quantity_scale === undefined ? {} : { quantityScale: body.quantity_scale }),
          ...(body.tracks_inventory === undefined
            ? {}
            : { tracksInventory: body.tracks_inventory }),
          ...(body.standard_cost === undefined ? {} : { standardCost: body.standard_cost }),
          ...(body.currency_code === undefined ? {} : { currencyCode: body.currency_code }),
          ...(body.min_stock === undefined ? {} : { minStock: body.min_stock }),
          ...(body.is_default === undefined ? {} : { isDefault: body.is_default }),
          ...(body.status === undefined ? {} : { status: body.status }),
        };
        const value = await service.patchVariant(
          mutationContext(request, context.companyId, context.userId),
          request.params.id,
          parseIfMatch(request.headers['if-match']),
          patch,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(
            successResponse(
              variantHttp(value, hasCostPermission(context.permissions)),
              request.requestContext,
            ),
          );
      }),
  );
}
