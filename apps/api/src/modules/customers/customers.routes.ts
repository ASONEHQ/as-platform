import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withCustomerErrors } from './customers.http-errors.js';
import type { CustomersService } from './customers.service.js';
import type { CustomerMutationContext, CustomerQrTokenRow, CustomerRow } from './customers.types.js';

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
const ifMatchHeader = {
  type: 'object',
  required: ['if-match'],
  properties: { 'if-match': { type: 'string' } },
} as const;

function mutationContext(
  request: FastifyRequest,
  companyId: string,
  actorId: string,
  actorPermissions: readonly string[],
): CustomerMutationContext {
  return {
    companyId,
    actorId,
    actorPermissions,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}
function expectedVersionFrom(request: FastifyRequest): bigint {
  const ifMatch = request.headers['if-match'];
  return BigInt(typeof ifMatch === 'string' ? ifMatch.replaceAll('"', '') : '0');
}

// Part AB/W — never expose phone/email/birth date in a dense list row;
// only the detail read exposes the full contact record.
function customerSummaryHttp(value: CustomerRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    display_name: value.displayName,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
  };
}
function customerHttp(value: CustomerRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    first_name: value.firstName,
    last_name: value.lastName,
    display_name: value.displayName,
    email: value.email,
    phone: value.phone,
    birth_date: value.birthDate,
    status: value.status,
    notes: value.notes,
    created_by: value.createdBy,
    updated_by: value.updatedBy,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function qrTokenHttp(value: CustomerQrTokenRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    customer_id: value.customerId,
    token: value.token,
    status: value.status,
    created_at: value.createdAt.toISOString(),
  };
}

const createCustomerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['first_name'],
  properties: {
    first_name: { type: 'string', minLength: 1, maxLength: 120 },
    last_name: { type: 'string', maxLength: 120 },
    display_name: { type: 'string', maxLength: 200 },
    email: { type: 'string', maxLength: 254 },
    phone: { type: 'string', maxLength: 32 },
    birth_date: { type: 'string', format: 'date' },
    notes: { type: 'string', maxLength: 2000 },
  },
} as const;
const updateCustomerSchema = { ...createCustomerSchema, required: [], properties: {
  ...createCustomerSchema.properties,
  status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
} } as const;

export function registerCustomerRoutes(app: FastifyInstance, authentication: AuthService, service: CustomersService): void {
  // Part E — creation.
  app.post<{ Body: Record<string, unknown> }>(
    '/api/v1/customers',
    {
      schema: {
        tags: ['customers'],
        headers: idempotencyHeaders,
        body: createCustomerSchema,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCustomerErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'customer.create');
        const body = request.body as {
          first_name: string;
          last_name?: string;
          display_name?: string;
          email?: string;
          phone?: string;
          birth_date?: string;
          notes?: string;
        };
        const created = await service.createCustomer(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            firstName: body.first_name,
            ...(body.last_name === undefined ? {} : { lastName: body.last_name }),
            ...(body.display_name === undefined ? {} : { displayName: body.display_name }),
            ...(body.email === undefined ? {} : { email: body.email }),
            ...(body.phone === undefined ? {} : { phone: body.phone }),
            ...(body.birth_date === undefined ? {} : { birthDate: body.birth_date }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(customerHttp(created.value), request.requestContext));
      }),
  );

  // Part E — search/list. Never exposes phone/email in the list row
  // (Part AB) — only status/display name/id.
  app.get<{ Querystring: { cursor?: string; limit?: number; search?: string; status?: string } }>(
    '/api/v1/customers',
    {
      schema: {
        tags: ['customers'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            search: { type: 'string', maxLength: 200 },
            status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCustomerErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'customer.read');
        const query = request.query;
        const page = await service.listCustomers(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          {
            companyId: auth.companyId,
            limit: query.limit ?? 50,
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.search === undefined ? {} : { search: query.search }),
            ...(query.status === undefined ? {} : { status: query.status as CustomerRow['status'] }),
          },
        );
        return reply.send({
          data: page.items.map(customerSummaryHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.hasMore },
          },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/customers/:id',
    {
      schema: {
        tags: ['customers'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCustomerErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'customer.read');
        const value = await service.customer(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          request.params.id,
        );
        return reply.header('etag', `"${value.version.toString()}"`).send(successResponse(customerHttp(value), request.requestContext));
      }),
  );

  app.patch<{ Params: Params; Body: Record<string, unknown> }>(
    '/api/v1/customers/:id',
    {
      schema: {
        tags: ['customers'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: ifMatchHeader,
        body: updateCustomerSchema,
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCustomerErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'customer.update');
        const body = request.body as {
          first_name?: string;
          last_name?: string;
          display_name?: string;
          email?: string;
          phone?: string;
          birth_date?: string;
          status?: CustomerRow['status'];
          notes?: string;
        };
        const updated = await service.updateCustomer(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
          {
            ...(body.first_name === undefined ? {} : { firstName: body.first_name }),
            ...(body.last_name === undefined ? {} : { lastName: body.last_name }),
            ...(body.display_name === undefined ? {} : { displayName: body.display_name }),
            ...(body.email === undefined ? {} : { email: body.email }),
            ...(body.phone === undefined ? {} : { phone: body.phone }),
            ...(body.birth_date === undefined ? {} : { birthDate: body.birth_date }),
            ...(body.status === undefined ? {} : { status: body.status }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
            expectedVersion: expectedVersionFrom(request),
          },
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(customerHttp(updated), request.requestContext));
      }),
  );

  // Part U — QR identity.
  app.post<{ Params: Params }>(
    '/api/v1/customers/:id/qr-tokens',
    {
      schema: {
        tags: ['customers'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCustomerErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'customer.update');
        const issued = await service.issueQrToken(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
        );
        return reply.code(201).send(successResponse(qrTokenHttp(issued), request.requestContext));
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/customers/:id/qr-tokens/active',
    {
      schema: {
        tags: ['customers'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCustomerErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'customer.read');
        const active = await service.activeQrToken(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          request.params.id,
        );
        return reply.send(successResponse(active === null ? null : qrTokenHttp(active), request.requestContext));
      }),
  );

  app.post<{ Body: { token: string } }>(
    '/api/v1/customers/qr-tokens/resolve',
    {
      schema: {
        tags: ['customers'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: { type: 'string', minLength: 16, maxLength: 200 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withCustomerErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'customer.read');
        const resolved = await service.resolveQrToken(
          { companyId: auth.companyId, actorPermissions: auth.permissions },
          request.body.token,
        );
        return reply.send(successResponse(customerHttp(resolved), request.requestContext));
      }),
  );
}
