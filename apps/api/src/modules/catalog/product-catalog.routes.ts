import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey, parseIfMatch } from './catalog.schemas.js';
import { withProductCatalogErrors } from './product-catalog.http-errors.js';
import type { ProductCatalogService } from './product-catalog.service.js';
import type {
  BarcodeType,
  CreateProductInput,
  CreateVariantInput,
  ProductMutationContext,
  ProductRow,
  ProductStatus,
  ProductType,
  ProductVariantRow,
  UpdateProductInput,
  UpdateVariantInput,
  VariantStatus,
} from './product-catalog.types.js';

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
  barcode?: BarcodeBody;
}
interface ProductBody {
  id?: string;
  code: string;
  name: string;
  description?: string;
  product_type: ProductType;
  tracks_inventory?: boolean;
  status?: ProductStatus;
  category_id?: string;
  brand_id?: string;
  default_variant?: DefaultVariantBody;
}
interface ProductPatchBody {
  name?: string;
  description?: string | null;
  tracks_inventory?: boolean;
  status?: ProductStatus;
  category_id?: string | null;
  brand_id?: string | null;
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
    status: { type: 'string', enum: ['draft', 'active', 'inactive'] },
    category_id: uuid,
    brand_id: uuid,
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
    status: { type: 'string', enum: ['draft', 'active', 'inactive', 'retired'] },
    category_id: { anyOf: [uuid, { type: 'null' }] },
    brand_id: { anyOf: [uuid, { type: 'null' }] },
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
    is_default: value.isDefault,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function productHttp(
  value: ProductRow & { defaultVariant?: ProductVariantRow | null },
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
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    ...('defaultVariant' in value
      ? {
          default_variant:
            value.defaultVariant === null ? null : variantHttp(value.defaultVariant, showCost),
        }
      : {}),
  };
}

export function registerProductCatalogRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: ProductCatalogService,
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
          ...(body.category_id === undefined ? {} : { categoryId: body.category_id }),
          ...(body.brand_id === undefined ? {} : { brandId: body.brand_id }),
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

  app.get<{ Params: Params }>(
    '/api/v1/products/:id',
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
        const value = await service.product(context.companyId, request.params.id);
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
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.category_id === undefined ? {} : { categoryId: body.category_id }),
          ...(body.brand_id === undefined ? {} : { brandId: body.brand_id }),
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
