import type { FastifyInstance, FastifyRequest } from 'fastify';

import { responseMeta, successResponse } from '../../http/response.js';
import { requireAuthenticatedUser, requireBranchAccess, requirePermission } from '../auth/auth.guards.js';
import type { AuthService } from '../auth/auth.service.js';
import { idempotencyKey } from '../catalog/catalog.schemas.js';
// TASK 12.5B: the receipt route composes a sale with its payments —
// exactly the same cross-module composition direction
// `payments.routes.ts`'s own nested `/sales/{id}/payments` route already
// uses in reverse (importing `SalesService`). Neither service imports the
// other's *service* — only this route layer depends on both.
import type { PaymentService } from '../payments/payments.service.js';
import type { PaymentAttemptRow, PaymentRow } from '../payments/payments.types.js';
import { withSaleErrors } from './sales.http-errors.js';
import type { SalesService } from './sales.service.js';
import type { SaleItemRow, SaleMutationContext, SaleRow, SaleStatus } from './sales.types.js';

interface Params {
  id: string;
}
// TASK 12.6 Part B (E075).
interface SaleListQuery {
  cursor?: string;
  limit?: number;
  branch_id?: string;
  status?: SaleStatus;
  occurred_from?: string;
  occurred_to?: string;
  created_by?: string;
  sale_number?: string;
  payment_method?: string;
  // TASK 13.0 — Part F/AA: Customer Detail's "recent sales".
  customer_id?: string;
}
interface SaleItemBody {
  product_id: string;
  quantity: string;
}
interface ManualDiscountBody {
  scope: 'line' | 'ticket';
  line_index?: number;
  type: 'percentage' | 'fixed_amount';
  value: string;
  reason_code: string;
}
interface SaleBody {
  id?: string;
  branch_id: string;
  currency_code?: string;
  device_id?: string;
  // TASK 13.0 — Part G/H: optional. Omitted entirely for "Venta sin
  // cliente" — a walk-in sale is not required to carry one.
  customer_id?: string;
  items: SaleItemBody[];
  coupon_codes?: string[];
  manual_discount?: ManualDiscountBody;
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
  actorPermissions?: readonly string[],
): SaleMutationContext {
  return {
    companyId,
    actorId,
    ...(actorPermissions === undefined ? {} : { actorPermissions }),
    requestId: request.requestContext.requestId,
    correlationId: request.requestContext.correlationId,
    timestamp: new Date(),
  };
}

function saleItemHttp(value: SaleItemRow): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    sale_id: value.saleId,
    line_number: value.lineNumber,
    product_id: value.productId,
    product_variant_id: value.productVariantId,
    product_version: value.productVersion === null ? null : Number(value.productVersion),
    sku_snapshot: value.skuSnapshot,
    name_snapshot: value.nameSnapshot,
    quantity: value.quantity,
    unit_price: value.unitPrice,
    subtotal: value.subtotal,
    discount_total: value.discountTotal,
    tax_total: value.taxTotal,
    line_total: value.lineTotal,
    tax_snapshot: value.taxSnapshot,
    created_at: value.createdAt.toISOString(),
  };
}
// TASK 12.8 Part Q: never a project-invented 6th `sales.status` value —
// see ADR-0015. `undefined` (the field omitted entirely) means the
// caller didn't compute it (e.g. the freshly-created-sale response
// right after `POST /sales`, where no refund could possibly exist yet);
// it is never fabricated as `'not_refunded'` in that case, to keep this
// helper honest about what was actually looked up.
type RefundState = 'not_refunded' | 'partially_refunded' | 'fully_refunded';

function saleHttp(
  value: SaleRow,
  items?: readonly SaleItemRow[],
  refundState?: RefundState,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    branch_id: value.branchId,
    cash_register_id: value.cashRegisterId,
    cash_session_id: value.cashSessionId,
    device_id: value.deviceId,
    // Part AB — the frozen snapshot, never today's mutable customer row.
    customer_id: value.customerId,
    customer_display_name: value.customerDisplayName,
    sale_number: value.saleNumber,
    status: value.status,
    currency_code: value.currencyCode,
    subtotal: value.subtotal,
    discount_total: value.discountTotal,
    tax_total: value.taxTotal,
    total: value.total,
    paid_total: value.paidTotal,
    change_total: value.changeTotal,
    occurred_at: value.occurredAt.toISOString(),
    completed_at: value.completedAt?.toISOString() ?? null,
    cancelled_at: value.cancelledAt?.toISOString() ?? null,
    cancelled_by: value.cancelledBy,
    reason_code: value.reasonCode,
    version: Number(value.version),
    created_at: value.createdAt.toISOString(),
    updated_at: value.updatedAt.toISOString(),
    ...(refundState === undefined ? {} : { refund_state: refundState }),
    ...(items === undefined ? {} : { items: items.map(saleItemHttp) }),
  };
}

// --- Sales history (TASK 12.6 Part B) ----------------------------------

/** A list row is deliberately a *summary*, never the full receipt/item
 * history (see the task's own "do not embed full receipt/item history
 * into every list row") — `SalesRepository.listSummaries`'s batched
 * branch/cashier/item-count/payment-method lookup, composed onto the
 * base sale row `saleHttp` already knows how to render. */
function saleSummaryHttp(
  value: SaleRow,
  summary: { branchName: string | null; cashierName: string | null; itemCount: number; paymentMethods: string[] },
  // TASK 12.8 Part Q: `'not_refunded'` here is a real default, not a
  // fabricated one — unlike `saleHttp`'s `refundState`, every list row
  // always has a batched `refundStatesForSales` lookup behind it (see the
  // `GET /sales` handler below), so "the batch found nothing for this
  // sale id" and "this sale genuinely has zero refunds" are the same
  // fact. Composed into the label client-side (e.g. "Completada ·
  // devolución parcial") — `status` itself is never overwritten, so the
  // original value is never hidden.
  refundState: RefundState,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    sale_number: value.saleNumber,
    status: value.status,
    currency_code: value.currencyCode,
    branch_id: value.branchId,
    branch_name: summary.branchName,
    cashier_id: value.createdBy,
    cashier_name: summary.cashierName,
    // Part AA — displayed where attached, never re-derived from today's
    // (possibly since-edited) customer record.
    customer_id: value.customerId,
    customer_display_name: value.customerDisplayName,
    occurred_at: value.occurredAt.toISOString(),
    completed_at: value.completedAt?.toISOString() ?? null,
    item_count: summary.itemCount,
    subtotal: value.subtotal,
    tax_total: value.taxTotal,
    total: value.total,
    payment_methods: summary.paymentMethods,
    refund_state: refundState,
  };
}

// --- Receipt (TASK 12.5B) --------------------------------------------

/** A receipt line is a *curated* subset of `saleItemHttp`'s fuller shape
 * above — a purchase receipt shows what a customer needs (name, qty,
 * price, line total), not internal bookkeeping fields like
 * `product_version`/`tax_snapshot`. Every value is read straight off the
 * immutable `sale_items` snapshot columns TASK 12.4A.1 already froze at
 * sale-creation time — never re-resolved from the live catalog, so a
 * later product rename or price change never changes a past receipt
 * (see ADR-0012). */
function receiptItemHttp(value: SaleItemRow): Readonly<Record<string, unknown>> {
  return {
    line_number: value.lineNumber,
    name_snapshot: value.nameSnapshot,
    sku_snapshot: value.skuSnapshot,
    quantity: value.quantity,
    unit_price: value.unitPrice,
    discount_total: value.discountTotal,
    tax_total: value.taxTotal,
    line_total: value.lineTotal,
  };
}

/** TASK 12.5B: metadata.tendered_amount/change_amount are only ever
 * written by `PaymentService.createCashPayment` (TASK 12.5A) — never
 * trusted for any other `payment_method`, so this reads `null` for
 * anything but a genuine cash payment even if `metadata` happens to
 * carry an unrelated key of the same name (defense in depth: it never
 * legitimately would). */
function cashMetadataAmount(value: PaymentRow, key: 'tendered_amount' | 'change_amount'): string | null {
  if (value.paymentMethod !== 'cash') return null;
  const raw = value.metadata?.[key];
  return typeof raw === 'string' ? raw : null;
}

/** TASK 12.5B: a receipt-safe payment line. Deliberately excludes
 * anything ADR-0008/ADR-0010 already forbid storing at all (PAN, CVV,
 * track data, Access Token, webhook secret — none of these columns
 * exist on `payments`/`payment_attempts` in the first place, so there is
 * nothing to accidentally leak here) — `provider`/`terminal_id` and the
 * latest attempt's own `provider_reference` are the *only* provider-safe
 * fields ADR-0010 already documents as safe to expose to Flutter.
 * `latestAttempt` is `undefined` for a `cash` payment (never fetched —
 * see the route below) and populated only for `card_terminal`, so this
 * never fabricates card data while Mercado Pago remains unconfigured —
 * it simply reflects whatever a real captured payment actually has. */
function receiptPaymentHttp(
  value: PaymentRow,
  latestAttempt?: PaymentAttemptRow,
): Readonly<Record<string, unknown>> {
  return {
    id: value.id,
    payment_method: value.paymentMethod,
    status: value.status,
    amount: value.amount,
    currency_code: value.currencyCode,
    captured_at: value.capturedAt?.toISOString() ?? null,
    tendered_amount: cashMetadataAmount(value, 'tendered_amount'),
    change_amount: cashMetadataAmount(value, 'change_amount'),
    provider: value.provider,
    terminal_id: value.terminalId,
    provider_reference: latestAttempt?.providerReference ?? null,
  };
}

function receiptHttp(input: {
  sale: SaleRow;
  items: readonly SaleItemRow[];
  organization: {
    companyName: string;
    branchName: string;
    branchAddress: Readonly<Record<string, unknown>> | null;
    cashierId: string;
    cashierName: string;
  } | null;
  payments: readonly Readonly<Record<string, unknown>>[];
}): Readonly<Record<string, unknown>> {
  const { sale, items, organization, payments } = input;
  return {
    sale: {
      id: sale.id,
      sale_number: sale.saleNumber,
      status: sale.status,
      currency_code: sale.currencyCode,
      branch_id: sale.branchId,
      occurred_at: sale.occurredAt.toISOString(),
      completed_at: sale.completedAt?.toISOString() ?? null,
      subtotal: sale.subtotal,
      discount_total: sale.discountTotal,
      tax_total: sale.taxTotal,
      total: sale.total,
    },
    business:
      organization === null
        ? null
        : {
            company_name: organization.companyName,
            branch_name: organization.branchName,
            branch_address: organization.branchAddress,
          },
    cashier:
      organization === null
        ? null
        : { id: organization.cashierId, display_name: organization.cashierName },
    items: items.map(receiptItemHttp),
    payments,
  };
}

export function registerSaleRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  service: SalesService,
  paymentService: PaymentService,
): void {
  app.post<{ Body: SaleBody }>(
    '/api/v1/sales',
    {
      schema: {
        tags: ['sales'],
        headers: idempotencyHeaders,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['branch_id', 'items'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            branch_id: { type: 'string', format: 'uuid' },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            device_id: { type: 'string', format: 'uuid' },
            customer_id: { type: 'string', format: 'uuid' },
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['product_id', 'quantity'],
                properties: {
                  product_id: { type: 'string', format: 'uuid' },
                  quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' },
                },
              },
            },
            // TASK 12.9 — client submits intent only; the backend
            // independently re-derives every discount amount through the
            // exact same pricing engine the standalone quote endpoint
            // uses (never trusts a client-submitted total — Part X).
            coupon_codes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 5 },
            manual_discount: {
              type: 'object',
              additionalProperties: false,
              required: ['scope', 'type', 'value', 'reason_code'],
              properties: {
                scope: { type: 'string', enum: ['line', 'ticket'] },
                line_index: { type: 'integer', minimum: 0 },
                type: { type: 'string', enum: ['percentage', 'fixed_amount'] },
                value: { type: 'string', minLength: 1, maxLength: 20 },
                reason_code: { type: 'string', minLength: 1, maxLength: 200 },
              },
            },
          },
        },
        response: { 201: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSaleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'sale.create');
        requireBranchAccess(authentication, auth, request.body.branch_id);
        // A manual discount is a distinct, separately-authorized action
        // (Part K/L) — gated independently of `sale.create`, never
        // silently accepted from just any actor who can start a sale.
        if (request.body.manual_discount !== undefined) requirePermission(authentication, auth, 'discount.apply');
        // No `device_id` in the request body falls back to the
        // authenticated session's own bound device, when it has one (see
        // sales.ts's schema doc — most CAJERO sessions today are an
        // unbound browser session, so this is commonly still undefined).
        const deviceId = request.body.device_id ?? auth.deviceId;
        const manualDiscount = request.body.manual_discount;
        const created = await service.createSale(
          mutationContext(request, auth.companyId, auth.userId, auth.permissions),
          auth.permittedBranchIds,
          idempotencyKey(request.headers['idempotency-key']),
          {
            ...(request.body.id === undefined ? {} : { id: request.body.id }),
            branchId: request.body.branch_id,
            ...(request.body.currency_code === undefined ? {} : { currencyCode: request.body.currency_code }),
            ...(deviceId === undefined ? {} : { deviceId }),
            ...(request.body.customer_id === undefined ? {} : { customerId: request.body.customer_id }),
            items: request.body.items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
            ...(request.body.coupon_codes === undefined ? {} : { couponCodes: request.body.coupon_codes }),
            ...(manualDiscount === undefined
              ? {}
              : {
                  manualDiscount: {
                    scope: manualDiscount.scope,
                    ...(manualDiscount.line_index === undefined ? {} : { lineIndex: manualDiscount.line_index }),
                    type: manualDiscount.type,
                    value: manualDiscount.value,
                    reasonCode: manualDiscount.reason_code,
                  },
                }),
          },
        );
        if (created.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .code(201)
          .header('etag', `"${created.value.sale.version.toString()}"`)
          .send(
            successResponse(
              saleHttp(created.value.sale, created.value.items),
              request.requestContext,
            ),
          );
      }),
  );

  // TASK 12.6 Part B (E075): stable sale history. `branch_id` here filters
  // *within* the caller's own authorized branches (`requireBranchAccess`
  // rejects one that isn't) — a company-wide user may omit it to see
  // every authorized branch at once (see `sales.service.ts`'s own doc
  // comment); a branch-scoped CAJERO/manager's `auth.permittedBranchIds`
  // already limits results to their one operational branch either way.
  // `register`/`session`/`device` from the aspirational E075 contract
  // text are deliberately not exposed: cash-register/session domains
  // don't exist yet (out of this task's scope) and would be meaningless
  // filters today; `device_id` exists but is rarely populated by the
  // current browser-session CAJERO flow (see sales.ts's own doc comment)
  // and isn't part of this task's own requested filter list.
  app.get<{ Querystring: SaleListQuery }>(
    '/api/v1/sales',
    {
      schema: {
        tags: ['sales'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            branch_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['draft', 'pending_payment', 'completed', 'cancelled', 'rejected'],
            },
            occurred_from: { type: 'string', format: 'date-time' },
            occurred_to: { type: 'string', format: 'date-time' },
            created_by: { type: 'string', format: 'uuid' },
            sale_number: { type: 'string', minLength: 1, maxLength: 64 },
            payment_method: {
              type: 'string',
              enum: ['cash', 'card_terminal', 'card_manual', 'other'],
            },
            customer_id: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSaleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'sale.read');
        const query = request.query;
        if (query.branch_id !== undefined) requireBranchAccess(authentication, auth, query.branch_id);
        const page = await service.listSales(auth.companyId, auth.permittedBranchIds, {
          limit: query.limit ?? 50,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.occurred_from === undefined ? {} : { occurredFrom: new Date(query.occurred_from) }),
          ...(query.occurred_to === undefined ? {} : { occurredTo: new Date(query.occurred_to) }),
          ...(query.created_by === undefined ? {} : { createdBy: query.created_by }),
          ...(query.sale_number === undefined ? {} : { saleNumber: query.sale_number }),
          ...(query.payment_method === undefined ? {} : { paymentMethod: query.payment_method }),
          ...(query.customer_id === undefined ? {} : { customerId: query.customer_id }),
        });
        const saleIds = page.items.map((item) => item.id);
        const [summaries, refundStates] = await Promise.all([
          service.listSummaries(auth.companyId, saleIds),
          service.refundStatesForSales(auth.companyId, saleIds),
        ]);
        return reply.send({
          data: page.items.map((item) =>
            saleSummaryHttp(
              item,
              summaries.get(item.id) ?? { branchName: null, cashierName: null, itemCount: 0, paymentMethods: [] },
              refundStates.get(item.id) ?? 'not_refunded',
            ),
          ),
          meta: {
            ...responseMeta(request.requestContext),
            page: { next_cursor: page.nextCursor, has_more: page.nextCursor !== null },
          },
        });
      }),
  );

  app.get<{ Params: Params }>(
    '/api/v1/sales/:id',
    {
      schema: {
        tags: ['sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSaleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'sale.read');
        const { sale, items } = await service.sale(auth.companyId, auth.permittedBranchIds, request.params.id);
        const refundStates = await service.refundStatesForSales(auth.companyId, [sale.id]);
        return reply
          .header('etag', `"${sale.version.toString()}"`)
          .send(
            successResponse(
              saleHttp(sale, items, refundStates.get(sale.id) ?? 'not_refunded'),
              request.requestContext,
            ),
          );
      }),
  );

  // TASK 12.5B: the canonical receipt — read-only, composed entirely from
  // already-persisted, already-immutable data (see ADR-0012). No status
  // gate: exactly like `GET /sales/{id}` above, a receipt for a
  // `pending_payment` or `cancelled` sale is truthfully returned (its
  // `payments` array simply reflects reality — typically empty), never
  // rejected — the caller decides how to present a non-`completed` sale;
  // this endpoint never lies about one by refusing to show it. Retrieving
  // it never mutates the sale, creates a payment, or touches inventory —
  // reprint is just calling this again.
  app.get<{ Params: Params }>(
    '/api/v1/sales/:id/receipt',
    {
      schema: {
        tags: ['sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSaleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'sale.read');
        const { sale, items } = await service.sale(auth.companyId, auth.permittedBranchIds, request.params.id);
        const organization = await service.receiptOrganization(auth.companyId, sale.id);
        const { items: paymentRows } = await paymentService.listPayments(auth.companyId, auth.permittedBranchIds, {
          saleId: sale.id,
          limit: 50,
        });
        const payments = await Promise.all(
          paymentRows.map(async (payment) => {
            // The safe `provider_reference` field only ever exists for a
            // `card_terminal` attempt (ADR-0010) — cash never fetches
            // attempts at all, so it can never surface one, and a real
            // card payment only ever shows its own real reference, never
            // a fabricated one (Mercado Pago remains paused/unconfigured
            // today, so this branch is simply unexercised in practice).
            if (payment.paymentMethod !== 'card_terminal') return receiptPaymentHttp(payment);
            const { attempts } = await paymentService.payment(auth.companyId, auth.permittedBranchIds, payment.id);
            return receiptPaymentHttp(payment, attempts.at(-1));
          }),
        );
        return reply
          .header('etag', `"${sale.version.toString()}"`)
          .send(
            successResponse(
              receiptHttp({ sale, items, organization, payments }),
              request.requestContext,
            ),
          );
      }),
  );

  // TASK 12.9 Part V: "Sale Detail should show exactly which commercial
  // adjustments were applied" — the immutable, itemized breakdown of
  // every promotion/coupon/manual discount actually applied at sale
  // creation (see ADR-0016 D13). Same permission/authorization as every
  // other sale-detail read; a pure read, never mutates anything.
  app.get<{ Params: Params }>(
    '/api/v1/sales/:id/discounts',
    {
      schema: {
        tags: ['sales'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        response: { 200: responseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      withSaleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'sale.read');
        const discounts = await service.saleDiscounts(auth.companyId, auth.permittedBranchIds, request.params.id);
        return reply.send(
          successResponse(
            discounts.map((entry) => ({
              id: entry.id,
              sale_item_id: entry.saleItemId,
              source_type: entry.sourceType,
              source_id: entry.sourceId,
              label: entry.labelSnapshot,
              reason_code: entry.reasonCode,
              amount: entry.amount,
              basis_points: entry.basisPoints,
            })),
            request.requestContext,
          ),
        );
      }),
  );

  app.post<{ Params: Params; Body: ReasonBody }>(
    '/api/v1/sales/:id/cancellations',
    {
      schema: {
        tags: ['sales'],
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
      withSaleErrors(async () => {
        const auth = await requireAuthenticatedUser(request, authentication);
        requirePermission(authentication, auth, 'sale.cancel');
        const updated = await service.cancelSale(
          mutationContext(request, auth.companyId, auth.userId),
          auth.permittedBranchIds,
          request.params.id,
          idempotencyKey(request.headers['idempotency-key']),
          request.body.reason_code,
        );
        if (updated.replayed) reply.header('idempotency-replayed', 'true');
        return reply
          .header('etag', `"${updated.value.version.toString()}"`)
          .send(successResponse(saleHttp(updated.value), request.requestContext));
      }),
  );
}
