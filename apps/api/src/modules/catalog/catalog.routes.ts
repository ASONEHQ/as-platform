import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '@asone/errors';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { withCatalogErrors } from './catalog.http-errors.js';
import {
  brandCreateSchema,
  brandListResponseSchema,
  brandPatchSchema,
  brandResponseSchema,
  categoryCreateSchema,
  categoryListQuerySchema,
  categoryListResponseSchema,
  categoryPatchSchema,
  categoryResponseSchema,
  idParamSchema,
  idempotencyKey,
  listQuerySchema,
  parseIfMatch,
} from './catalog.schemas.js';
import type {
  BrandCreate,
  BrandPatch,
  CategoryCreate,
  CategoryPatch,
  CatalogService,
} from './catalog.service.js';
import type { Brand, CatalogStatus, Category, MutationContext } from './catalog.types.js';

interface ListQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly status?: CatalogStatus;
  readonly search?: string;
}
interface CategoryListQuery extends ListQuery {
  readonly parent_id?: string;
}
interface Params {
  readonly id: string;
}
interface CategoryBody {
  readonly id?: string;
  readonly parent_id?: string | null;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sort_order?: number;
  readonly status?: CatalogStatus;
}
interface CategoryPatchBody {
  readonly parent_id?: string | null;
  readonly name?: string;
  readonly description?: string | null;
  readonly sort_order?: number;
  readonly status?: CatalogStatus;
}
interface BrandBody {
  readonly id?: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: CatalogStatus;
}
interface BrandPatchBody {
  readonly name?: string;
  readonly description?: string | null;
  readonly status?: CatalogStatus;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;
function rejectUnknownBody(body: object, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new AppError({
      code: 'validation_error',
      message: 'The request contains an unknown field.',
      statusCode: 400,
    });
}
function mutationContext(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
): MutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}
function categoryHttp(value: Category): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    parent_id: value.parentId,
    code: value.code,
    name: value.name,
    description: value.description,
    sort_order: value.sortOrder,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    deleted_at: value.deletedAt?.toISOString() ?? null,
  };
}
function brandHttp(value: Brand): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    description: value.description,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    deleted_at: value.deletedAt?.toISOString() ?? null,
  };
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: CatalogService,
): void {
  app.get<{ Querystring: CategoryListQuery }>(
    '/api/v1/categories',
    {
      schema: {
        tags: ['catalog'],
        querystring: categoryListQuerySchema,
        response: { 200: categoryListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const page = await service.listCategories(context.companyId, {
          limit: request.query.limit ?? 50,
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
          ...(request.query.parent_id === undefined ? {} : { parentId: request.query.parent_id }),
          ...(request.query.search === undefined ? {} : { search: request.query.search }),
        });
        return reply.send({
          data: page.items.map(categoryHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );
  app.post<{ Body: CategoryBody }>(
    '/api/v1/categories',
    {
      schema: {
        tags: ['catalog'],
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: { 'idempotency-key': { type: 'string' } },
        },
        body: categoryCreateSchema,
        response: { 201: categoryResponseSchema, ...commonErrors },
      },
      preValidation: (request, _reply, done) => {
        try {
          rejectUnknownBody(request.body, [
            'id',
            'parent_id',
            'code',
            'name',
            'description',
            'sort_order',
            'status',
          ]);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    },
    async (request, reply) =>
      withCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'category.manage');
        const input: CategoryCreate = {
          code: request.body.code,
          name: request.body.name,
          ...(request.body.id === undefined ? {} : { id: request.body.id }),
          ...(request.body.parent_id === undefined ? {} : { parentId: request.body.parent_id }),
          ...(request.body.description === undefined
            ? {}
            : { description: request.body.description }),
          ...(request.body.sort_order === undefined ? {} : { sortOrder: request.body.sort_order }),
          ...(request.body.status === undefined ? {} : { status: request.body.status }),
        };
        const result = await service.createCategory(
          mutationContext(request, context.companyId, context.userId),
          idempotencyKey(request.headers['idempotency-key']),
          input,
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(categoryHttp(result.value), request.requestContext));
      }),
  );
  app.get<{ Params: Params }>(
    '/api/v1/categories/:id',
    {
      schema: {
        tags: ['catalog'],
        params: idParamSchema,
        response: { 200: categoryResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const value = await service.category(context.companyId, request.params.id);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(categoryHttp(value), request.requestContext));
      }),
  );
  app.patch<{ Params: Params; Body: CategoryPatchBody }>(
    '/api/v1/categories/:id',
    {
      schema: {
        tags: ['catalog'],
        params: idParamSchema,
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        body: categoryPatchSchema,
        response: { 200: categoryResponseSchema, ...commonErrors },
      },
      preValidation: (request, _reply, done) => {
        try {
          rejectUnknownBody(request.body, [
            'parent_id',
            'name',
            'description',
            'sort_order',
            'status',
          ]);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    },
    async (request, reply) =>
      withCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'category.manage');
        const body = request.body;
        const patch: CategoryPatch = {
          ...(body.parent_id === undefined ? {} : { parentId: body.parent_id }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.sort_order === undefined ? {} : { sortOrder: body.sort_order }),
          ...(body.status === undefined ? {} : { status: body.status }),
        };
        const value = await service.patchCategory(
          mutationContext(request, context.companyId, context.userId),
          request.params.id,
          parseIfMatch(request.headers['if-match']),
          patch,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(categoryHttp(value), request.requestContext));
      }),
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/v1/brands',
    {
      schema: {
        tags: ['catalog'],
        querystring: listQuerySchema,
        response: { 200: brandListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'catalog.read');
        const page = await service.listBrands(context.companyId, {
          limit: request.query.limit ?? 50,
          ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
          ...(request.query.status === undefined ? {} : { status: request.query.status }),
          ...(request.query.search === undefined ? {} : { search: request.query.search }),
        });
        return reply.send({
          data: page.items.map(brandHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );
  app.post<{ Body: BrandBody }>(
    '/api/v1/brands',
    {
      schema: {
        tags: ['catalog'],
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: { 'idempotency-key': { type: 'string' } },
        },
        body: brandCreateSchema,
        response: { 201: brandResponseSchema, ...commonErrors },
      },
      preValidation: (request, _reply, done) => {
        try {
          rejectUnknownBody(request.body, ['id', 'code', 'name', 'description', 'status']);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    },
    async (request, reply) =>
      withCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'product.manage');
        const body = request.body;
        const input: BrandCreate = {
          code: body.code,
          name: body.name,
          ...(body.id === undefined ? {} : { id: body.id }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.status === undefined ? {} : { status: body.status }),
        };
        const result = await service.createBrand(
          mutationContext(request, context.companyId, context.userId),
          idempotencyKey(request.headers['idempotency-key']),
          input,
        );
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${result.value.version.toString()}"`)
          .send(successResponse(brandHttp(result.value), request.requestContext));
      }),
  );
  app.patch<{ Params: Params; Body: BrandPatchBody }>(
    '/api/v1/brands/:id',
    {
      schema: {
        tags: ['catalog'],
        params: idParamSchema,
        headers: {
          type: 'object',
          required: ['if-match'],
          properties: { 'if-match': { type: 'string' } },
        },
        body: brandPatchSchema,
        response: { 200: brandResponseSchema, ...commonErrors },
      },
      preValidation: (request, _reply, done) => {
        try {
          rejectUnknownBody(request.body, ['name', 'description', 'status']);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    },
    async (request, reply) =>
      withCatalogErrors(async () => {
        const context = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, context, 'product.manage');
        const body = request.body;
        const patch: BrandPatch = {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.status === undefined ? {} : { status: body.status }),
        };
        const value = await service.patchBrand(
          mutationContext(request, context.companyId, context.userId),
          request.params.id,
          parseIfMatch(request.headers['if-match']),
          patch,
        );
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(brandHttp(value), request.requestContext));
      }),
  );
}
