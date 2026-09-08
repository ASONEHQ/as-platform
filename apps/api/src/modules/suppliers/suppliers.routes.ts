import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withSupplierErrors } from './suppliers.http-errors.js';
import type { SuppliersService } from './suppliers.service.js';
import type { SupplierMutationContext, SupplierRow } from './suppliers.types.js';

interface Params {
  id: string;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
} as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;

function mutationContext(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
): SupplierMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
    deviceId: request.requestContext.deviceId,
  };
}

function supplierHttp(value: SupplierRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    name: value.name,
    contact_name: value.contactName,
    phone: value.phone,
    email: value.email,
    notes: value.notes,
    status: value.status,
    created_by: value.createdBy,
    updated_by: value.updatedBy,
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}

const createSupplierSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    contact_name: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    phone: { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
    email: { anyOf: [{ type: 'string', maxLength: 254 }, { type: 'null' }] },
    notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
  },
} as const;
const updateSupplierSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    contact_name: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
    phone: { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
    email: { anyOf: [{ type: 'string', maxLength: 254 }, { type: 'null' }] },
    notes: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    status: { type: 'string', enum: ['active', 'inactive'] },
  },
} as const;

/**
 * "Proveedores" (TASK 14.4, Wave 2, Part C.1). Company-scoped ONLY — no
 * `requireBranchAccess` anywhere in this file, deliberately (see
 * `suppliers.types.ts`'s own doc comment): a supplier relationship is
 * with the business, not one physical location.
 */
export function registerSupplierRoutes(app: FastifyInstance, authentication: AuthService, service: SuppliersService): void {
  app.post<{
    Body: {
      id?: string;
      name: string;
      contact_name?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
    };
  }>(
    '/api/v1/suppliers',
    {
      schema: {
        tags: ['suppliers'],
        headers: idempotencyHeaders,
        body: createSupplierSchema,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSupplierErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'supplier.manage');
        const created = await service.createSupplier(
          mutationContext(request, auth.companyId, auth.userId),
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            name: request.body.name,
            ...(request.body.contact_name === undefined ? {} : { contactName: request.body.contact_name }),
            ...(request.body.phone === undefined ? {} : { phone: request.body.phone }),
            ...(request.body.email === undefined ? {} : { email: request.body.email }),
            ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(supplierHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { cursor?: string; limit?: number; status?: string } }>(
    '/api/v1/suppliers',
    {
      schema: {
        tags: ['suppliers'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            status: { type: 'string', enum: ['active', 'inactive'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSupplierErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'supplier.read');
        const query = request.query;
        const page = await service.listSuppliers(auth.companyId, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.status === undefined ? {} : { status: query.status as SupplierRow['status'] }),
        });
        return reply.send({
          data: page.items.map(supplierHttp),
          meta: { ...responseMeta(request.requestContext), page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null } },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/suppliers/:id',
    {
      schema: {
        tags: ['suppliers'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSupplierErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'supplier.read');
        const value = await service.supplier(auth.companyId, request.params.id);
        return reply.send(successResponse(supplierHttp(value), request.requestContext));
      }),
  );

  app.patch<{
    Params: Params;
    Body: {
      name?: string;
      contact_name?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      status?: 'active' | 'inactive';
    };
  }>(
    '/api/v1/suppliers/:id',
    {
      schema: {
        tags: ['suppliers'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: updateSupplierSchema,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSupplierErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'supplier.manage');
        const updated = await service.updateSupplier(
          mutationContext(request, auth.companyId, auth.userId),
          request.params.id,
          {
            ...(request.body.name === undefined ? {} : { name: request.body.name }),
            ...(request.body.contact_name === undefined ? {} : { contactName: request.body.contact_name }),
            ...(request.body.phone === undefined ? {} : { phone: request.body.phone }),
            ...(request.body.email === undefined ? {} : { email: request.body.email }),
            ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
            ...(request.body.status === undefined ? {} : { status: request.body.status }),
          },
        );
        return reply.send(successResponse(supplierHttp(updated), request.requestContext));
      }),
  );

  // Never a hard delete (per this wave's explicit instruction) — the only
  // "removal" a supplier ever gets, once a `direct_purchases` row may
  // reference it.
  app.post<{ Params: Params }>(
    '/api/v1/suppliers/:id/deactivate',
    {
      schema: {
        tags: ['suppliers'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSupplierErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'supplier.manage');
        const updated = await service.deactivateSupplier(
          mutationContext(request, auth.companyId, auth.userId),
          request.params.id,
        );
        return reply.send(successResponse(supplierHttp(updated), request.requestContext));
      }),
  );
}
