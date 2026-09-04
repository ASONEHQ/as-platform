import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import {
  requireAuthenticatedUser,
  requireBranchAccess,
  requirePermission,
} from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
import type { SalesService } from '../sales/sales.service.js';
import type { SaleItemRow, SaleRow } from '../sales/sales.types.js';
import { withPaymentErrors } from './payments.http-errors.js';
import type { PaymentService } from './payments.service.js';
import type {
  PaymentAttemptRow,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentMutationContext,
  PaymentRow,
  PaymentStatus,
  PaymentTerminalRow,
  TerminalStatus,
} from './payments.types.js';

interface Params {
  id: string;
}
interface TerminalListQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  status?: TerminalStatus;
}
interface TerminalBody {
  id?: string;
  branch_id: string;
  device_id: string;
  provider?: string;
  provider_terminal_id?: string;
  capabilities?: Readonly<Record<string, unknown>>;
}
interface PaymentListQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  status?: PaymentStatus;
  sale_id?: string;
}
interface PaymentBody {
  id?: string;
  branch_id: string;
  sale_id: string;
  payment_method: PaymentMethod;
  amount: string;
  currency_code: string;
  terminal_id?: string;
  metadata?: Readonly<Record<string, unknown>>;
}
interface SalePaymentBody {
  id?: string;
  payment_method: PaymentMethod;
  amount: string;
  currency_code: string;
  terminal_id?: string;
  metadata?: Readonly<Record<string, unknown>>;
}
interface CashPaymentBody {
  id?: string;
  tendered_amount: string;
  metadata?: Readonly<Record<string, unknown>>;
}
interface AttemptTransitionBody {
  status: PaymentAttemptStatus;
  provider_reference?: string;
  decline_reason?: string;
  metadata?: Readonly<Record<string, unknown>>;
}
interface ReasonBody {
  reason_code: string;
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
): PaymentMutationContext {
  return {
    companyId,
    actorId,
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}

function terminalHttp(value: PaymentTerminalRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    device_id: value.deviceId,
    provider: value.provider,
    provider_terminal_id: value.providerTerminalId,
    capabilities: value.capabilities,
    status: value.status,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function attemptHttp(value: PaymentAttemptRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    payment_id: value.paymentId,
    attempt_number: value.attemptNumber,
    terminal_id: value.terminalId,
    status: value.status,
    provider_reference: value.providerReference,
    decline_reason: value.declineReason,
    metadata: value.metadata,
    requested_at: value.requestedAt.toISOString(),
    responded_at: value.respondedAt?.toISOString() ?? null,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
  };
}
function paymentHttp(
  value: PaymentRow,
  attempts?: readonly PaymentAttemptRow[],
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    sale_id: value.saleId,
    payment_method: value.paymentMethod,
    amount: value.amount,
    currency_code: value.currencyCode,
    provider: value.provider,
    terminal_id: value.terminalId,
    status: value.status,
    reason_code: value.reasonCode,
    metadata: value.metadata,
    authorized_at: value.authorizedAt?.toISOString() ?? null,
    captured_at: value.capturedAt?.toISOString() ?? null,
    failed_at: value.failedAt?.toISOString() ?? null,
    reversed_at: value.reversedAt?.toISOString() ?? null,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    ...(attempts === undefined ? {} : { attempts: attempts.map(attemptHttp) }),
  };
}
// TASK 12.5A: a small, deliberately non-authoritative summary of the sale
// a cash payment just settled — enough for the completed-sale success
// state and for TASK 12.5B's future receipt (sale id/number/branch/
// timestamp/cashier/line items/subtotal/tax/total), never a second source
// of truth: every field here is read straight off `SaleRow`/`SaleItemRow`,
// the same rows `GET /sales/{id}` itself would return.
function saleItemReceiptHttp(value: SaleItemRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    line_number: value.lineNumber,
    product_id: value.productId,
    name_snapshot: value.nameSnapshot,
    quantity: value.quantity,
    unit_price: value.unitPrice,
    subtotal: value.subtotal,
    discount_total: value.discountTotal,
    tax_total: value.taxTotal,
    line_total: value.lineTotal,
  };
}
function saleReceiptHttp(
  value: SaleRow,
  items: readonly SaleItemRow[],
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    sale_number: value.saleNumber,
    status: value.status,
    currency_code: value.currencyCode,
    subtotal: value.subtotal,
    discount_total: value.discountTotal,
    tax_total: value.taxTotal,
    total: value.total,
    occurred_at: value.occurredAt.toISOString(),
    completed_at: value.completedAt?.toISOString() ?? null,
    // The actor who created the sale — the cashier who rang up this
    // ticket. No separate "cashier" concept exists yet (see ADR-0011).
    created_by: value.createdBy,
    items: items.map(saleItemReceiptHttp),
  };
}

export function registerPaymentRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: PaymentService,
  salesService: SalesService,
): void {
  // --- Terminals ---------------------------------------------------------

  app.post<{ Body: TerminalBody }>(
    '/api/v1/payment-terminals',
    {
      schema: {
        tags: ['payments'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'device_id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            device_id: { type: 'string', format: 'uuid' },
            provider: { type: 'string', minLength: 1, maxLength: 200 },
            provider_terminal_id: { type: 'string', minLength: 1, maxLength: 200 },
            capabilities: { type: 'object' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'device.register');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createTerminal(
          mutationContext(request, auth.companyId, auth.userId),
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            deviceId: request.body.device_id,
            ...(request.body.provider === undefined ? {} : { provider: request.body.provider }),
            ...(request.body.provider_terminal_id === undefined
              ? {}
              : { providerTerminalId: request.body.provider_terminal_id }),
            ...(request.body.capabilities === undefined
              ? {}
              : { capabilities: request.body.capabilities }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(terminalHttp(created.value), request.requestContext));
      }),
  );

  app.get<{ Querystring: TerminalListQuery }>(
    '/api/v1/payment-terminals',
    {
      schema: {
        tags: ['payments'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['unassigned', 'assigned', 'active', 'disabled'] },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'device.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listTerminals(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
        });
        return reply.send({
          data: page.items.map(terminalHttp),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/payment-terminals/:id',
    {
      schema: {
        tags: ['payments'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'device.read');
        const value = await service.terminal(auth.companyId, request.params.id);
        requireBranchAccess(authentication, auth, value.branchId);
        return reply
          .header('etag', `"${value.version.toString()}"`)
          .send(successResponse(terminalHttp(value), request.requestContext));
      }),
  );

  // --- Payments ------------------------------------------------------------

  app.post<{ Body: PaymentBody }>(
    '/api/v1/payments',
    {
      schema: {
        tags: ['payments'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'sale_id', 'payment_method', 'amount', 'currency_code'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            sale_id: { type: 'string', format: 'uuid' },
            payment_method: {
              type: 'string',
              enum: ['cash', 'card_terminal', 'card_manual', 'other'],
            },
            amount: { type: 'string', pattern: '^\\d{1,15}(\\.\\d{1,4})?$' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            terminal_id: { type: 'string', format: 'uuid' },
            metadata: { type: 'object' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.create');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        const created = await service.createPayment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            saleId: request.body.sale_id,
            paymentMethod: request.body.payment_method,
            amount: request.body.amount,
            currencyCode: request.body.currency_code,
            ...(request.body.terminal_id === undefined
              ? {}
              : { terminalId: request.body.terminal_id }),
            ...(request.body.metadata === undefined ? {} : { metadata: request.body.metadata }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.payment.version.toString()}"`)
          .send(
            successResponse(
              paymentHttp(created.value.payment, [created.value.attempt]),
              request.requestContext,
            ),
          );
      }),
  );

  // E078: `POST /sales/{id}/payments` — the canonical nested shape
  // (docs/API_CONTRACTS.md §16). `sale_id` comes from the URL, not the
  // body; this handler resolves the sale first (via `SalesService`,
  // which itself enforces branch access — a 404 here means "not found or
  // not yours," never a silent cross-branch leak) so the caller never has
  // to separately supply `branch_id` at all — it is taken from the sale's
  // own real branch, the same value the database's own triple FK would
  // require. The flat `POST /api/v1/payments` above is kept, unchanged in
  // shape apart from `sale_id` becoming required (TASK 12.4A.1) — no
  // migration path is needed between the two: both were always thin
  // wrappers over the identical `PaymentService.createPayment`, so a
  // caller of either produces the exact same payment record.
  app.post<{ Params: { sale_id: string }; Body: SalePaymentBody }>(
    '/api/v1/sales/:sale_id/payments',
    {
      schema: {
        tags: ['payments'],
        params: {
          type: 'object',
          required: ['sale_id'],
          properties: { sale_id: { type: 'string', format: 'uuid' } },
        },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['payment_method', 'amount', 'currency_code'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            payment_method: {
              type: 'string',
              enum: ['cash', 'card_terminal', 'card_manual', 'other'],
            },
            amount: { type: 'string', pattern: '^\\d{1,15}(\\.\\d{1,4})?$' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            terminal_id: { type: 'string', format: 'uuid' },
            metadata: { type: 'object' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.create');
        const { sale: owningSale } = await salesService.sale(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.sale_id,
        );
        const created = await service.createPayment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: owningSale.branchId,
            saleId: owningSale.id,
            paymentMethod: request.body.payment_method,
            amount: request.body.amount,
            currencyCode: request.body.currency_code,
            ...(request.body.terminal_id === undefined
              ? {}
              : { terminalId: request.body.terminal_id }),
            ...(request.body.metadata === undefined ? {} : { metadata: request.body.metadata }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.payment.version.toString()}"`)
          .send(
            successResponse(
              paymentHttp(created.value.payment, [created.value.attempt]),
              request.requestContext,
            ),
          );
      }),
  );

  // TASK 12.5A: cash checkout — see ADR-0011. Deliberately a *separate*
  // resource from `POST /sales/{sale_id}/payments` above rather than a new
  // `payment_method` branch of that same body shape: the two have
  // genuinely different input contracts. The generic route takes a
  // caller-supplied `amount` (safe today only because every existing
  // caller — Mercado Pago dispatch — always charges the sale's full total
  // on its first and only attempt); cash instead takes what the cashier
  // physically counted (`tendered_amount`) and the server alone computes
  // the amount actually applied to the sale and the change owed — a shape
  // the generic route cannot express without either trusting a
  // client-supplied amount for cash too (forbidden by this task) or
  // growing an optional `tendered_amount` field that only means something
  // for one `payment_method`. This still delegates into the exact same
  // `payments`/`payment_attempts` tables and state machine — see
  // `PaymentService.createCashPayment`.
  app.post<{ Params: { sale_id: string }; Body: CashPaymentBody }>(
    '/api/v1/sales/:sale_id/cash-payments',
    {
      schema: {
        tags: ['payments'],
        params: {
          type: 'object',
          required: ['sale_id'],
          properties: { sale_id: { type: 'string', format: 'uuid' } },
        },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tendered_amount'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            tendered_amount: { type: 'string', pattern: '^\\d{1,15}(\\.\\d{1,4})?$' },
            metadata: { type: 'object' },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.create');
        const created = await service.createCashPayment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            saleId: request.params.sale_id,
            tenderedAmount: request.body.tendered_amount,
            ...(request.body.metadata === undefined ? {} : { metadata: request.body.metadata }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        // Receipt-ready line items are an immutable, already-committed
        // read of the very sale this payment just settled — fetched
        // after the transaction, never inside it (see `SalesService.sale`).
        const { items } = await salesService.sale(
          auth.companyId,
          auth.permittedBranchIds,
          created.value.sale.id,
        );
        return reply
          .code(201)
          .header('etag', `"${created.value.payment.version.toString()}"`)
          .send(
            successResponse(
              {
                ...paymentHttp(created.value.payment, [created.value.attempt]),
                tendered_amount: created.value.tenderedAmount,
                change_amount: created.value.changeAmount,
                sale: saleReceiptHttp(created.value.sale, items),
              },
              request.requestContext,
            ),
          );
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/payments/:id',
    {
      schema: {
        tags: ['payments'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.read');
        const { payment, attempts } = await service.payment(
          auth.companyId,
          auth.permittedBranchIds,
          request.params.id,
        );
        return reply
          .header('etag', `"${payment.version.toString()}"`)
          .send(successResponse(paymentHttp(payment, attempts), request.requestContext));
      }),
  );

  app.get<{ Querystring: PaymentListQuery }>(
    '/api/v1/payments',
    {
      schema: {
        tags: ['payments'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['pending', 'authorized', 'captured', 'failed', 'reversed'],
            },
            sale_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listPayments(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.sale_id === undefined ? {} : { saleId: query.sale_id }),
        });
        return reply.send({
          data: page.items.map((item) => paymentHttp(item)),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.post<{ Params: Params }>(
    '/api/v1/payments/:id/attempts',
    {
      schema: {
        tags: ['payments'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.create');
        const created = await service.retryAttempt(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.version.toString()}"`)
          .send(successResponse(attemptHttp(created.value), request.requestContext));
      }),
  );

  app.post<{ Params: Params; Body: AttemptTransitionBody }>(
    '/api/v1/payment-attempts/:id/transitions',
    {
      schema: {
        tags: ['payments'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: [
                'awaiting_terminal',
                'processing',
                'approved',
                'declined',
                'cancelled',
                'timed_out',
                'failed',
              ],
            },
            provider_reference: { type: 'string', minLength: 1, maxLength: 200 },
            decline_reason: { type: 'string', minLength: 1, maxLength: 200 },
            metadata: { type: 'object' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.create');
        const updated = await service.transitionAttempt(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          {
            status: request.body.status,
            ...(request.body.provider_reference === undefined
              ? {}
              : { providerReference: request.body.provider_reference }),
            ...(request.body.decline_reason === undefined
              ? {}
              : { declineReason: request.body.decline_reason }),
            ...(request.body.metadata === undefined ? {} : { metadata: request.body.metadata }),
          },
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${updated.value.version.toString()}"`)
          .send(successResponse(attemptHttp(updated.value), request.requestContext));
      }),
  );

  app.post<{ Params: Params; Body: ReasonBody }>(
    '/api/v1/payments/:id/cancellations',
    {
      schema: {
        tags: ['payments'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: { reason_code: { type: 'string', minLength: 1, maxLength: 200 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.create');
        const updated = await service.cancelPayment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          request.body.reason_code,
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${updated.value.version.toString()}"`)
          .send(successResponse(paymentHttp(updated.value), request.requestContext));
      }),
  );

  app.post<{ Params: Params; Body: ReasonBody }>(
    '/api/v1/payments/:id/reversals',
    {
      schema: {
        tags: ['payments'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason_code'],
          properties: { reason_code: { type: 'string', minLength: 1, maxLength: 200 } },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withPaymentErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'payment.reverse');
        const updated = await service.reversePayment(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          request.body.reason_code,
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${updated.value.version.toString()}"`)
          .send(successResponse(paymentHttp(updated.value), request.requestContext));
      }),
  );
}
