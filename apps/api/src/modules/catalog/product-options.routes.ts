import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey, parseIfMatch } from './catalog.schemas.js';
import { withProductCatalogErrors } from './product-catalog.http-errors.js';
import type {
  ProductMutationContext,
  ProductOptionRow,
  ProductOptionValueRow,
  ProductBarcodeRow,
  VariantStatus,
  BarcodeType,
} from './product-catalog.types.js';
import type { ProductOptionsService } from './product-options.service.js';

interface ValueParams {
  value_id: string;
}
interface BarcodeParams {
  barcode_id: string;
}
interface ProductParams {
  product_id: string;
}
interface OptionParams {
  option_id: string;
}
interface VariantParams {
  variant_id: string;
}
interface ListQuery {
  cursor?: string;
  limit?: number;
  status?: VariantStatus;
  search?: string;
}
interface NamedBody {
  id?: string;
  code: string;
  name: string;
  display_order?: number;
  status?: VariantStatus;
}
interface NamedPatch {
  name?: string;
  display_order?: number;
  status?: VariantStatus;
}
interface BarcodeBody {
  id?: string;
  barcode: string;
  barcode_type: BarcodeType;
  is_primary?: boolean;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const rejectUnknown = { not: {} } as const;
const response = { type: 'object', additionalProperties: true } as const;
const error = { type: 'object', additionalProperties: true } as const;
const errors = { 400: error, 401: error, 403: error, 404: error, 409: error } as const;
const valueParams = {
  type: 'object',
  additionalProperties: false,
  required: ['value_id'],
  properties: { value_id: uuid },
} as const;
const barcodeParams = {
  type: 'object',
  additionalProperties: false,
  required: ['barcode_id'],
  properties: { barcode_id: uuid },
} as const;
const productParams = {
  type: 'object',
  additionalProperties: false,
  required: ['product_id'],
  properties: { product_id: uuid },
} as const;
const optionParams = {
  type: 'object',
  additionalProperties: false,
  required: ['option_id'],
  properties: { option_id: uuid },
} as const;
const variantParams = {
  type: 'object',
  additionalProperties: false,
  required: ['variant_id'],
  properties: { variant_id: uuid },
} as const;
const listQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    status: { type: 'string', enum: ['active', 'inactive', 'retired'] },
    search: { type: 'string', minLength: 1, maxLength: 255 },
  },
} as const;
const namedBody = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['code', 'name'],
  properties: {
    id: uuid,
    code: { type: 'string', minLength: 1, maxLength: 255 },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    display_order: { type: 'integer', minimum: 0 },
    status: { type: 'string', enum: ['active', 'inactive'] },
  },
} as const;
const namedPatch = {
  type: 'object',
  additionalProperties: rejectUnknown,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    display_order: { type: 'integer', minimum: 0 },
    status: { type: 'string', enum: ['active', 'inactive', 'retired'] },
  },
} as const;
const barcodeBody = {
  type: 'object',
  additionalProperties: rejectUnknown,
  required: ['barcode', 'barcode_type'],
  properties: {
    id: uuid,
    barcode: { type: 'string', minLength: 1, maxLength: 512 },
    barcode_type: { type: 'string', enum: ['ean13', 'upca', 'code128', 'qr', 'internal'] },
    is_primary: { type: 'boolean' },
  },
} as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1 } },
} as const;
const ifMatchHeaders = {
  type: 'object',
  required: ['if-match'],
  properties: { 'if-match': { type: 'string' } },
} as const;

function context(
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
function named(value: ProductOptionRow | ProductOptionValueRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    ...('optionDefinitionId' in value ? { option_id: value.optionDefinitionId } : {}),
    product_id: value.productId,
    code: value.code,
    name: value.name,
    display_order: value.displayOrder,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function barcode(value: ProductBarcodeRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    product_variant_id: value.productVariantId,
    barcode: value.value,
    barcode_type: value.barcodeType,
    is_primary: value.isPrimary,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

export function registerProductOptionsRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: ProductOptionsService,
): void {
  app.get<{ Params: ProductParams; Querystring: ListQuery }>(
    '/api/v1/products/:product_id/options',
    {
      schema: {
        tags: ['catalog'],
        params: productParams,
        querystring: listQuery,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'catalog.read');
        const q = request.query;
        const page = await service.listOptions(auth.companyId, request.params.product_id, {
          limit: q.limit ?? 50,
          ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
          ...(q.status === undefined ? {} : { status: q.status }),
          ...(q.search === undefined ? {} : { search: q.search }),
        });
        return reply.send({
          data: page.items.map(named),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );
  app.post<{ Params: ProductParams; Body: NamedBody }>(
    '/api/v1/products/:product_id/options',
    {
      schema: {
        tags: ['catalog'],
        params: productParams,
        headers: idempotencyHeaders,
        body: namedBody,
        response: { 201: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const b = request.body;
        const result = await service.createOption(
          context(request, auth.companyId, auth.userId),
          request.params.product_id,
          idempotencyKey(request.headers['idempotency-key']),
          {
            code: b.code,
            name: b.name,
            ...(b.id === undefined ? {} : { id: b.id }),
            ...(b.display_order === undefined ? {} : { displayOrder: b.display_order }),
            ...(b.status === undefined ? {} : { status: b.status }),
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(named(result.value), request.requestContext));
      }),
  );
  app.patch<{ Params: OptionParams; Body: NamedPatch }>(
    '/api/v1/product-options/:option_id',
    {
      schema: {
        tags: ['catalog'],
        params: optionParams,
        headers: ifMatchHeaders,
        body: namedPatch,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const b = request.body;
        const value = await service.patchOption(
          context(request, auth.companyId, auth.userId),
          request.params.option_id,
          parseIfMatch(request.headers['if-match']),
          {
            ...(b.name === undefined ? {} : { name: b.name }),
            ...(b.display_order === undefined ? {} : { displayOrder: b.display_order }),
            ...(b.status === undefined ? {} : { status: b.status }),
          },
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(named(value), request.requestContext));
      }),
  );
  app.get<{ Params: OptionParams; Querystring: ListQuery }>(
    '/api/v1/product-options/:option_id/values',
    {
      schema: {
        tags: ['catalog'],
        params: optionParams,
        querystring: listQuery,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'catalog.read');
        const q = request.query;
        const page = await service.listValues(auth.companyId, request.params.option_id, {
          limit: q.limit ?? 50,
          ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
          ...(q.status === undefined ? {} : { status: q.status }),
          ...(q.search === undefined ? {} : { search: q.search }),
        });
        return reply.send({
          data: page.items.map(named),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );
  app.post<{ Params: OptionParams; Body: NamedBody }>(
    '/api/v1/product-options/:option_id/values',
    {
      schema: {
        tags: ['catalog'],
        params: optionParams,
        headers: idempotencyHeaders,
        body: namedBody,
        response: { 201: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const b = request.body;
        const result = await service.createValue(
          context(request, auth.companyId, auth.userId),
          request.params.option_id,
          idempotencyKey(request.headers['idempotency-key']),
          {
            code: b.code,
            name: b.name,
            ...(b.id === undefined ? {} : { id: b.id }),
            ...(b.display_order === undefined ? {} : { displayOrder: b.display_order }),
            ...(b.status === undefined ? {} : { status: b.status }),
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(named(result.value), request.requestContext));
      }),
  );
  app.patch<{ Params: ValueParams; Body: NamedPatch }>(
    '/api/v1/product-option-values/:value_id',
    {
      schema: {
        tags: ['catalog'],
        params: valueParams,
        headers: ifMatchHeaders,
        body: namedPatch,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const b = request.body;
        const value = await service.patchValue(
          context(request, auth.companyId, auth.userId),
          request.params.value_id,
          parseIfMatch(request.headers['if-match']),
          {
            ...(b.name === undefined ? {} : { name: b.name }),
            ...(b.display_order === undefined ? {} : { displayOrder: b.display_order }),
            ...(b.status === undefined ? {} : { status: b.status }),
          },
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(named(value), request.requestContext));
      }),
  );
  app.post<{ Params: VariantParams; Body: BarcodeBody }>(
    '/api/v1/product-variants/:variant_id/barcodes',
    {
      schema: {
        tags: ['catalog'],
        params: variantParams,
        headers: idempotencyHeaders,
        body: barcodeBody,
        response: { 201: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const b = request.body;
        const result = await service.createBarcode(
          context(request, auth.companyId, auth.userId),
          request.params.variant_id,
          idempotencyKey(request.headers['idempotency-key']),
          {
            barcode: b.barcode,
            barcodeType: b.barcode_type,
            ...(b.id === undefined ? {} : { id: b.id }),
            ...(b.is_primary === undefined ? {} : { isPrimary: b.is_primary }),
          },
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(barcode(result.value), request.requestContext));
      }),
  );
  app.delete<{ Params: BarcodeParams }>(
    '/api/v1/product-barcodes/:barcode_id',
    {
      schema: {
        tags: ['catalog'],
        params: barcodeParams,
        headers: ifMatchHeaders,
        response: { 200: response, ...errors },
      },
    },
    async (request, reply) =>
      withProductCatalogErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'product.manage');
        const value = await service.retireBarcode(
          context(request, auth.companyId, auth.userId),
          request.params.barcode_id,
          parseIfMatch(request.headers['if-match']),
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(barcode(value), request.requestContext));
      }),
  );
}
