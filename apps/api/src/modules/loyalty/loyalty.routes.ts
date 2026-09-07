import type { FastifyInstance, FastifyRequest } from 'fastify';

import { successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import { withLoyaltyErrors } from './loyalty.http-errors.js';
import type { LoyaltyService } from './loyalty.service.js';
import type { LoyaltyLedgerEntryRow, LoyaltyMutationContext, LoyaltyProgramRow, LoyaltySummary } from './loyalty.types.js';

interface ProgramParams {
  id: string;
}
interface CustomerParams {
  customerId: string;
}

const errorSchema = { type: 'object', additionalProperties: true } as const;
const commonErrors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema } as const;
const responseSchema = { type: 'object', additionalProperties: true } as const;
const idempotencyHeaders = {
  type: 'object',
  required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;
const ifMatchHeader = { type: 'object', required: ['if-match'], properties: { 'if-match': { type: 'string' } } } as const;

function mutationContext(request: FastifyRequest, companyId: string, actorId: string, actorPermissions: readonly string[]): LoyaltyMutationContext {
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

function programHttp(value: LoyaltyProgramRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    name: value.name,
    active: value.active,
    unit_type: value.unitType,
    earn_quantity_per_sale: value.earnQuantityPerSale,
    minimum_sale_total: value.minimumSaleTotal,
    reward_threshold: value.rewardThreshold,
    reward_description: value.rewardDescription,
    reward_type: value.rewardType,
    reward_expiration_days: value.rewardExpirationDays,
    reward_repeatable: value.rewardRepeatable,
    version: Number(value.version),
  };
}
function ledgerEntryHttp(value: LoyaltyLedgerEntryRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    entry_type: value.entryType,
    quantity: value.quantity,
    unit_type: value.unitType,
    source_type: value.sourceType,
    reason: value.reason,
    occurred_at: value.occurredAt.toISOString(),
  };
}
function summaryHttp(value: LoyaltySummary): Readonly<Record<string, unknown>> {
  return {
    account: value.account === null ? null : { id: value.account.id, status: value.account.status },
    balances: value.balances.map((balance) => ({
      program_id: balance.programId,
      unit_type: balance.unitType,
      balance: balance.balance,
    })),
    ledger: value.ledger.map(ledgerEntryHttp),
  };
}

const programSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'unit_type'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    active: { type: 'boolean' },
    unit_type: { type: 'string', enum: ['stamp', 'point'] },
    earn_quantity_per_sale: { type: 'integer', minimum: 1 },
    minimum_sale_total: { type: 'string', pattern: '^\\d+(\\.\\d{1,4})?$' },
    reward_threshold: { type: 'integer', minimum: 1 },
    reward_description: { type: 'string', maxLength: 500 },
    reward_type: { type: 'string', enum: ['vip_pass'] },
    reward_expiration_days: { type: 'integer', minimum: 1 },
    reward_repeatable: { type: 'boolean' },
  },
} as const;

export function registerLoyaltyRoutes(app: FastifyInstance, authentication: AuthService, service: LoyaltyService): void {
  app.post<{ Body: Record<string, unknown> }>(
    '/api/v1/loyalty-programs',
    { schema: { tags: ['loyalty'], headers: idempotencyHeaders, body: programSchema, response: { 201: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withLoyaltyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'loyalty.manage');
        const body = request.body as {
          id?: string;
          name: string;
          active?: boolean;
          unit_type: 'stamp' | 'point';
          earn_quantity_per_sale?: number;
          minimum_sale_total?: string;
          reward_threshold?: number;
          reward_description?: string;
          reward_type?: 'vip_pass';
          reward_expiration_days?: number;
          reward_repeatable?: boolean;
        };
        const created = await service.createProgram(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(body.id === undefined ? {} : { id: body.id }),
            name: body.name,
            ...(body.active === undefined ? {} : { active: body.active }),
            unitType: body.unit_type,
            ...(body.earn_quantity_per_sale === undefined ? {} : { earnQuantityPerSale: body.earn_quantity_per_sale }),
            ...(body.minimum_sale_total === undefined ? {} : { minimumSaleTotal: body.minimum_sale_total }),
            ...(body.reward_threshold === undefined ? {} : { rewardThreshold: body.reward_threshold }),
            ...(body.reward_description === undefined ? {} : { rewardDescription: body.reward_description }),
            ...(body.reward_type === undefined ? {} : { rewardType: body.reward_type }),
            ...(body.reward_expiration_days === undefined ? {} : { rewardExpirationDays: body.reward_expiration_days }),
            ...(body.reward_repeatable === undefined ? {} : { rewardRepeatable: body.reward_repeatable }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(programHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: { active?: boolean } }>(
    '/api/v1/loyalty-programs',
    {
      schema: {
        tags: ['loyalty'],
        querystring: { type: 'object', additionalProperties: false, properties: { active: { type: 'boolean' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withLoyaltyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'loyalty.read');
        const rows = await service.listPrograms({ companyId: auth.companyId, actorPermissions: auth.permissions }, request.query.active ?? null);
        return reply.send(successResponse(rows.map(programHttp), request.requestContext));
      }),
  );

  app.put<{ Params: ProgramParams; Body: Record<string, unknown> }>(
    '/api/v1/loyalty-programs/:id',
    {
      schema: {
        tags: ['loyalty'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: ifMatchHeader,
        body: { ...programSchema, required: [] },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withLoyaltyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'loyalty.manage');
        const body = request.body as Partial<{
          name: string;
          active: boolean;
          unit_type: 'stamp' | 'point';
          earn_quantity_per_sale: number;
          minimum_sale_total: string;
          reward_threshold: number;
          reward_description: string;
          reward_type: 'vip_pass';
          reward_expiration_days: number;
          reward_repeatable: boolean;
        }>;
        const updated = await service.updateProgram(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          request.params.id,
          expectedVersionFrom(request),
          {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.active === undefined ? {} : { active: body.active }),
            ...(body.unit_type === undefined ? {} : { unitType: body.unit_type }),
            ...(body.earn_quantity_per_sale === undefined ? {} : { earnQuantityPerSale: body.earn_quantity_per_sale }),
            ...(body.minimum_sale_total === undefined ? {} : { minimumSaleTotal: body.minimum_sale_total }),
            ...(body.reward_threshold === undefined ? {} : { rewardThreshold: body.reward_threshold }),
            ...(body.reward_description === undefined ? {} : { rewardDescription: body.reward_description }),
            ...(body.reward_type === undefined ? {} : { rewardType: body.reward_type }),
            ...(body.reward_expiration_days === undefined ? {} : { rewardExpirationDays: body.reward_expiration_days }),
            ...(body.reward_repeatable === undefined ? {} : { rewardRepeatable: body.reward_repeatable }),
          },
        );
        return reply.header('etag', `"${updated.version.toString()}"`).send(successResponse(programHttp(updated), request.requestContext));
      }),
  );

  // Part AG — customer-facing summary: account/balances/ledger, backend
  // truth only.
  app.get<{ Params: CustomerParams }>(
    '/api/v1/customers/:customerId/loyalty',
    { schema: { tags: ['loyalty'], params: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } } }, response: { 200: responseSchema, ...commonErrors } } },
    async (request, reply) =>
      withLoyaltyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'loyalty.read');
        const summary = await service.summary({ companyId: auth.companyId, actorPermissions: auth.permissions }, request.params.customerId);
        return reply.send(successResponse(summaryHttp(summary), request.requestContext));
      }),
  );

  // Separately permissioned (Part Y) — a high-risk manual correction.
  app.post<{ Params: CustomerParams; Body: { quantity: number; unit_type: 'stamp' | 'point'; reason: string; loyalty_program_id?: string } }>(
    '/api/v1/customers/:customerId/loyalty/adjust',
    {
      schema: {
        tags: ['loyalty'],
        params: { type: 'object', required: ['customerId'], properties: { customerId: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['quantity', 'unit_type', 'reason'],
          properties: {
            quantity: { type: 'integer' },
            unit_type: { type: 'string', enum: ['stamp', 'point'] },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
            loyalty_program_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withLoyaltyErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'loyalty.adjust');
        const created = await service.adjust(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          idempotencyKey(request.headers['idempotency-key']),
          {
            customerId: request.params.customerId,
            quantity: request.body.quantity,
            unitType: request.body.unit_type,
            reason: request.body.reason,
            ...(request.body.loyalty_program_id === undefined ? {} : { loyaltyProgramId: request.body.loyalty_program_id }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply.code(201).send(successResponse(ledgerEntryHttp(created.value), request.requestContext));
      }),
  );
}
