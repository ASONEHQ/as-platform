import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { CashRepository, CashTransaction } from '../cash/cash.repository.js';
import { CashError, type CashMutationContext, type CashSessionRow } from '../cash/cash.types.js';
import { postSaleReturn } from '../inventory/sale-return.js';
import type { PaymentRepository } from '../payments/payments.repository.js';
import type { PaymentMutationContext } from '../payments/payments.types.js';
import type { PaymentProvider } from '../payments/providers/payment-provider.js';
import { PaymentProviderError } from '../payments/providers/payment-provider.js';
import type { RefundsRepository, RefundableSaleItemRow } from './refunds.repository.js';
import {
  RefundError,
  type CreateRefundInput,
  type RefundableBalance,
  type RefundableLineBalance,
  type RefundItemDisposition,
  type RefundItemRow,
  type RefundMutationContext,
  type RefundRow,
} from './refunds.types.js';

// --- Exact decimal arithmetic (ADR-0001) — the identical algorithm
// `sales.service.ts` already established for computing a line's
// subtotal/tax from `unit_price` × `quantity` × `basis_points`, copied
// verbatim (not cross-imported — every module in this codebase keeps its
// own self-contained copy of this small helper set) so a partial return's
// reversal is computed by the *exact same arithmetic* that produced the
// original sale line, never a second, possibly-drifting implementation. --
const MONEY_SCALE = 10_000n; // numeric(19,4)
const QUANTITY_SCALE = 1_000_000n; // numeric(19,6)
const BASIS_POINT_SCALE = 10_000n;

function moneyUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(wholeDigits) * MONEY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function formatMoney(units: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / MONEY_SCALE;
  const fraction = (magnitude % MONEY_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}
/** Parses a decimal quantity string with no positivity constraint — used
 * for values that are legitimately zero (e.g. "already refunded so far"
 * before any refund exists). */
function parseQuantityUnits(value: string, field: string): bigint {
  const match = /^(\d{1,19})(?:\.(\d{1,6}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new RefundError('validation_error', `${field} is invalid.`);
  return BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
}
/** The same parse, plus the "must be a real positive quantity" check —
 * used for a *requested* quantity (sold, or being returned), which must
 * never be zero or negative. */
function quantityUnits(value: string, field: string): bigint {
  const units = parseQuantityUnits(value, field);
  if (units <= 0n) throw new RefundError('validation_error', `${field} must be greater than zero.`);
  return units;
}
function formatQuantity(units: bigint): string {
  const whole = units / QUANTITY_SCALE;
  const fraction = (units % QUANTITY_SCALE).toString().padStart(6, '0');
  return `${whole.toString()}.${fraction}`;
}
function multiplyMoneyByQuantity(amountUnits: bigint, qtyUnits: bigint): bigint {
  const numerator = amountUnits * qtyUnits;
  return (numerator + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
}
function applyBasisPoints(amountUnits: bigint, basisPoints: number): bigint {
  const numerator = amountUnits * BigInt(basisPoints);
  return (numerator + BASIS_POINT_SCALE / 2n) / BASIS_POINT_SCALE;
}
function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new RefundError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 500) throw new RefundError('validation_error', `${field} is too long.`);
  return clean;
}

interface LineReversal {
  saleItem: RefundableSaleItemRow;
  quantityUnits: bigint;
  quantity: string;
  subtotalUnits: bigint;
  taxUnits: bigint;
  disposition: RefundItemDisposition;
}

/** Computes one line's exact reversal from its *original* frozen
 * commercial snapshot (Part C/D) — `unitPrice` and `taxSnapshot.basis_points`
 * are never re-read from today's catalog, and the arithmetic is the exact
 * same `multiplyMoneyByQuantity`/`applyBasisPoints` pair that produced the
 * original line, so a full-quantity return reproduces the original line's
 * own `subtotal`/`tax_total` exactly (no rounding drift between "what was
 * charged" and "what is refunded"). */
function computeLineReversal(
  saleItem: RefundableSaleItemRow,
  requestedQuantity: string,
  isTracked: boolean,
): LineReversal {
  const qtyUnits = quantityUnits(requestedQuantity, `Quantity for "${saleItem.nameSnapshot}"`);
  const unitPriceUnits = moneyUnits(saleItem.unitPrice);
  const basisPoints = saleItem.taxSnapshot?.basis_points ?? 0;
  const subtotalUnits = multiplyMoneyByQuantity(unitPriceUnits, qtyUnits);
  const taxUnits = applyBasisPoints(subtotalUnits, basisPoints);
  return {
    saleItem,
    quantityUnits: qtyUnits,
    quantity: formatQuantity(qtyUnits),
    subtotalUnits,
    taxUnits,
    // Part I: no disposition-selection UI exists in this pass — every
    // line is server-derived `restock` (stock-tracked variant) or
    // `no_restock` (everything else, e.g. admissions/services).
    disposition: isTracked ? 'restock' : 'no_restock',
  };
}

function refundNumberFor(id: string): string {
  return `REF-${id.replaceAll('-', '').toLowerCase()}`;
}

export class RefundsService {
  public constructor(
    private readonly repository: RefundsRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly cashRepository: CashRepository,
    private readonly mercadoPagoProvider: PaymentProvider,
  ) {}

  // --- E081: refundable balance -------------------------------------------

  public async refundableBalance(
    companyId: string,
    branchIds: readonly string[],
    saleId: string,
  ): Promise<RefundableBalance> {
    const saleRow = await this.repository.saleForRead(companyId, branchIds, saleId);
    if (saleRow === null) throw new RefundError('resource_not_found', 'The sale was not found.');
    if (saleRow.status !== 'completed') {
      return {
        saleId,
        refundable: false,
        blockedReason: 'Only a completed sale can be refunded.',
        lines: [],
      };
    }
    const items = await this.repository.saleItemsForSale(companyId, saleId);
    if (items.length === 0) return { saleId, refundable: true, blockedReason: null, lines: [] };
    // A plain read outside any lock — an approximate-but-honest preview;
    // `createRefund` re-locks and re-checks this exact figure for real
    // inside its own transaction (Part L), so a stale preview can never
    // actually over-commit.
    const refunded = await this.repository.refundedQuantitiesForSaleItemsUnlocked(
      companyId,
      items.map((item) => item.id),
    );
    const lines: RefundableLineBalance[] = items.map((item) => {
      const soldUnits = quantityUnits(item.quantity, 'quantity');
      const refundedUnits = parseQuantityUnits(refunded.get(item.id) ?? '0', 'refunded quantity');
      const remainingUnits = soldUnits - (refunded.has(item.id) ? refundedUnits : 0n);
      return {
        saleItemId: item.id,
        nameSnapshot: item.nameSnapshot,
        soldQuantity: item.quantity,
        refundedQuantity: refunded.get(item.id) ?? '0.000000',
        refundableQuantity: formatQuantity(remainingUnits > 0n ? remainingUnits : 0n),
        unitPrice: item.unitPrice,
      };
    });
    return { saleId, refundable: true, blockedReason: null, lines };
  }

  // --- E082: create (+ self-approve-or-reject-outright) -------------------

  public async createRefund(
    context: RefundMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreateRefundInput,
  ): Promise<{ value: RefundRow; replayed: boolean }> {
    if (input.items.length === 0)
      throw new RefundError('validation_error', 'A refund must include at least one item.');
    if (input.items.length > 200) throw new RefundError('validation_error', 'Too many refund items.');
    const cleanReason = nonBlank(input.reasonCode, 'reason_code');
    const cleanNote =
      input.reasonNote === undefined || input.reasonNote.trim().length === 0
        ? null
        : nonBlank(input.reasonNote, 'reason_note');
    const normalizedItems = input.items.map((item, index) => ({
      saleItemId: item.saleItemId,
      quantity: item.quantity,
      index,
    }));
    const id = input.id ?? randomUUID();
    const requestHash = hash({
      saleId: input.saleId,
      reasonCode: cleanReason,
      reasonNote: cleanNote,
      items: normalizedItems.map(({ saleItemId, quantity }) => ({ saleItemId, quantity })),
      id: input.id ?? null,
    });
    // Part N: self-approve requires *both* permissions on the same actor;
    // an actor with only `refund.create` gets an honest, immediate
    // rejection — never a silently-stuck `pending_approval` row nobody in
    // this pass's UI can ever act on. See ADR-0015.
    if (!context.actorPermissions.includes('refund.approve'))
      throw new RefundError(
        'refund_approval_required',
        'This refund requires an actor authorized to approve refunds.',
      );
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'refund.create',
        key,
        requestHash,
        'refund',
        decodeRefund,
        async () => {
          const sale = await this.repository.lockSaleForRefund(client, context.companyId, branchIds, input.saleId);
          if (sale === null) throw new RefundError('resource_not_found', 'The sale was not found.');
          if (sale.status !== 'completed')
            throw new RefundError('sale_not_refundable', 'Only a completed sale can be refunded.');
          const saleItems = await this.repository.saleItemsForSale(context.companyId, sale.id);
          const saleItemById = new Map(saleItems.map((item) => [item.id, item]));
          for (const requested of normalizedItems)
            if (!saleItemById.has(requested.saleItemId))
              throw new RefundError(
                'validation_error',
                `items[${String(requested.index)}].sale_item_id does not belong to this sale.`,
              );
          const refundedBySaleItem = await this.repository.refundedQuantitiesForSaleItems(
            client,
            context.companyId,
            normalizedItems.map((item) => item.saleItemId),
          );
          const variantIds = [
            ...new Set(
              normalizedItems
                .map((requested) => saleItemById.get(requested.saleItemId)?.productVariantId ?? null)
                .filter((variantId): variantId is string => variantId !== null),
            ),
          ];
          const trackedVariantIds = await this.repository.trackedVariantIds(context.companyId, variantIds);

          let subtotalUnits = 0n;
          let taxUnits = 0n;
          const lines: LineReversal[] = [];
          for (const requested of normalizedItems) {
            const saleItem = saleItemById.get(requested.saleItemId);
            if (saleItem === undefined) continue; // unreachable — validated above.
            const soldUnits = quantityUnits(saleItem.quantity, 'quantity');
            const alreadyRefundedUnits = parseQuantityUnits(
              refundedBySaleItem.get(saleItem.id) ?? '0',
              'refunded quantity',
            );
            const remainingUnits = soldUnits - alreadyRefundedUnits;
            const requestedUnits = quantityUnits(
              requested.quantity,
              `items[${String(requested.index)}].quantity`,
            );
            // Part B/L: the durable, race-free cumulative-safety check —
            // `sale` was locked `for update` above, so no concurrent
            // refund attempt against this same sale can be mid-flight.
            if (requestedUnits > remainingUnits)
              throw new RefundError(
                'refund_limit_exceeded',
                `items[${String(requested.index)}] requests more than the remaining refundable quantity for "${saleItem.nameSnapshot}".`,
              );
            const isTracked = saleItem.productVariantId !== null && trackedVariantIds.has(saleItem.productVariantId);
            const line = computeLineReversal(saleItem, requested.quantity, isTracked);
            subtotalUnits += line.subtotalUnits;
            taxUnits += line.taxUnits;
            lines.push(line);
          }
          const totalUnits = subtotalUnits + taxUnits;
          if (totalUnits <= 0n)
            throw new RefundError('validation_error', 'The refund total must be greater than zero.');

          const capturedPayment = await this.repository.capturedPaymentForSale(context.companyId, sale.id);
          if (capturedPayment === null)
            throw new RefundError('sale_not_refundable', 'This sale has no captured payment to refund.');

          const created = await this.repository.insertRefund(client, {
            id,
            companyId: context.companyId,
            branchId: sale.branchId,
            saleId: sale.id,
            refundNumber: refundNumberFor(id),
            status: 'approved',
            refundMethod: capturedPayment.paymentMethod,
            reasonCode: cleanReason,
            reasonNote: cleanNote,
            currencyCode: sale.currencyCode,
            subtotal: formatMoney(subtotalUnits),
            taxTotal: formatMoney(taxUnits),
            total: formatMoney(totalUnits),
            occurredAt: context.timestamp,
            createdBy: context.actorId,
            approvedBy: context.actorId,
            deviceId: context.deviceId ?? null,
          });
          // Sequential, never `Promise.all` — every one of these shares the
          // same transaction `client`, and `pg` does not support two
          // concurrently in-flight queries on one connection (see
          // `sales.repository.ts`'s identical precedent).
          for (const line of lines) {
            await this.repository.insertRefundItem(client, {
              id: randomUUID(),
              companyId: context.companyId,
              branchId: sale.branchId,
              refundId: created.id,
              saleItemId: line.saleItem.id,
              quantity: line.quantity,
              subtotal: formatMoney(line.subtotalUnits),
              taxTotal: formatMoney(line.taxUnits),
              lineTotal: formatMoney(line.subtotalUnits + line.taxUnits),
              restockDisposition: line.disposition,
              timestamp: context.timestamp,
            });
          }
          await this.repository.auditAndPublish(client, context, {
            action: 'refund.approved',
            resourceType: 'refund',
            resourceId: created.id,
            eventType: 'refund.approved',
            branchId: created.branchId,
            version: created.version,
            payload: refundPayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async refund(companyId: string, branchIds: readonly string[], id: string): Promise<RefundRow> {
    const value = await this.repository.refund(companyId, branchIds, id);
    if (value === null) throw new RefundError('resource_not_found', 'The refund was not found.');
    return value;
  }

  public async refundItems(companyId: string, branchIds: readonly string[], id: string): Promise<RefundItemRow[]> {
    await this.refund(companyId, branchIds, id); // branch-authorization check, same pattern as sales.receiptOrganization.
    return this.repository.refundItems(companyId, id);
  }

  public listRefunds(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<RefundsRepository['listRefunds']>[2],
  ): ReturnType<RefundsRepository['listRefunds']> {
    return this.repository.listRefunds(companyId, branchIds, input);
  }

  // --- E086: completion — the one atomic effects boundary (Part F/M) -----

  /**
   * Commits every local effect of an already-`approved` refund inside one
   * database transaction: payment reversal (full refund of that payment
   * only — see below), the cash-out drawer movement (cash method only),
   * inventory restoration (stock-tracked lines only), audit/outbox. A
   * failure at any point rolls every one of them back together — no
   * allowed state has "refund completed but inventory not restored" or
   * "cash withdrawn but refund record missing" (Part M).
   *
   * Payment reversal: this codebase has never built split payments
   * (confirmed by inspection — `capturedPaymentForSale` is unambiguous),
   * so "reverse the original payment" only makes sense when this refund's
   * `total` equals that payment's full `amount` — a genuine full refund.
   * A partial refund leaves the original payment `captured` (it remains
   * historically true that amount was captured; only part of the sale is
   * being corrected) and reuses the exact same `PaymentRepository.updatePaymentStatus`
   * →`'reversed'` transition E080 already exposes standalone, just
   * invoked here, inline, inside this transaction instead of as a
   * separate caller-driven HTTP round trip.
   */
  public async completeRefund(
    context: RefundMutationContext,
    branchIds: readonly string[],
    key: string,
    refundId: string,
    input: { cashRegisterId?: string },
  ): Promise<{ value: RefundRow; replayed: boolean }> {
    const requestHash = hash({ refundId, cashRegisterId: input.cashRegisterId ?? null });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'refund.complete',
        key,
        requestHash,
        'refund',
        decodeRefund,
        async () => {
          const current = await this.repository.lockRefund(client, context.companyId, branchIds, refundId);
          if (current === null) throw new RefundError('resource_not_found', 'The refund was not found.');
          if (current.status !== 'approved')
            throw new RefundError('resource_conflict', 'Only an approved refund can be completed.');

          const capturedPayment = await this.repository.capturedPaymentForSale(context.companyId, current.saleId);
          if (capturedPayment === null)
            throw new RefundError('sale_not_refundable', 'This sale has no captured payment to refund.');
          const paymentRow = await this.paymentRepository.lockPayment(
            client,
            context.companyId,
            branchIds,
            capturedPayment.id,
          );
          if (paymentRow === null)
            throw new RefundError('resource_not_found', 'The original payment was not found.');
          if (paymentRow.status !== 'captured')
            throw new RefundError('payment_not_reversible', 'The original payment is no longer captured.');

          const isFullRefund = moneyUnits(current.total) === moneyUnits(paymentRow.amount);
          let cashSessionId: string | null = null;

          if (current.refundMethod === 'cash') {
            const cashContext: CashMutationContext = context;
            const session = await this.resolveOpenCashSession(
              client,
              context.companyId,
              current.branchId,
              input.cashRegisterId,
            );
            cashSessionId = session.id;
            await this.cashRepository.postRefundMovement(client, cashContext, {
              cashSessionId: session.id,
              branchId: current.branchId,
              amount: current.total,
              currencyCode: current.currencyCode,
              refundId: current.id,
              refundNumber: current.refundNumber,
            });
          } else if (current.refundMethod === 'card_terminal') {
            // Part E/X: never simulate a successful card refund. A
            // partial card refund is not supported in this pass — this
            // codebase persists no per-transaction identity to target a
            // partial provider refund at (see ADR-0015) — represented as
            // an honest, immediate rejection rather than a silent
            // wrong-amount attempt.
            if (!isFullRefund)
              throw new RefundError(
                'payment_not_reversible',
                'A partial refund of a card payment is not supported yet; refund the full captured amount.',
              );
            const attempts = await this.paymentRepository.attemptsForPayment(context.companyId, paymentRow.id);
            const approved = attempts.find((attempt) => attempt.status === 'approved');
            if (approved?.providerReference === null || approved?.providerReference === undefined)
              throw new RefundError(
                'payment_not_reversible',
                'No provider order reference was found for this card payment.',
              );
            try {
              await this.mercadoPagoProvider.refund(approved.providerReference, {});
            } catch (error) {
              if (error instanceof PaymentProviderError)
                throw new RefundError(
                  'payment_not_reversible',
                  `El reembolso con tarjeta requiere la configuración del proveedor de pago (${error.code}).`,
                );
              throw error;
            }
          }
          // card_manual/other: no drawer movement, no provider call — the
          // payment reversal fact below is this refund's only local
          // effect for those methods.

          if (isFullRefund) {
            const paymentContext: PaymentMutationContext = context;
            await this.paymentRepository.updatePaymentStatus(client, context.companyId, paymentRow.id, paymentRow.version, {
              status: 'reversed',
              reasonCode: current.reasonCode,
              timestamp: paymentContext.timestamp,
              reversedAt: paymentContext.timestamp,
            });
          }

          const [refundItems, saleItems] = await Promise.all([
            this.repository.refundItems(context.companyId, current.id),
            this.repository.saleItemsForSale(context.companyId, current.saleId),
          ]);
          const saleItemById = new Map(saleItems.map((item) => [item.id, item]));
          const returnLines = refundItems
            .filter((item) => item.restockDisposition === 'restock')
            .map((item) => {
              const saleItem = saleItemById.get(item.saleItemId);
              return {
                productVariantId: saleItem?.productVariantId ?? null,
                quantity: item.quantity,
                nameSnapshot: saleItem?.nameSnapshot ?? current.refundNumber,
              };
            });
          if (returnLines.length > 0) {
            await postSaleReturn(
              client,
              {
                companyId: context.companyId,
                actorId: context.actorId,
                correlationId: context.correlationId,
                timestamp: context.timestamp,
              },
              { id: current.id, branchId: current.branchId, refundNumber: current.refundNumber },
              returnLines,
            );
          }

          const completed = await this.repository.completeRefund(client, context.companyId, current.id, current.version, {
            paymentId: paymentRow.id,
            cashSessionId,
            completedAt: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'refund.completed',
            resourceType: 'refund',
            resourceId: completed.id,
            eventType: 'refund.completed',
            branchId: completed.branchId,
            version: completed.version,
            payload: refundPayload(completed),
          });
          return completed;
        },
      ),
    );
  }

  /** Mirrors `PaymentService.resolveOpenCashSession` exactly — copied,
   * not cross-imported, matching this codebase's established "each
   * module keeps its own small copy" discipline (see ADR-0014's own
   * precedent). Registers the current *open* session for the branch
   * performing the refund, never the original sale's own (possibly
   * long-closed) session — see ADR-0015 "Current vs original
   * CashSession". */
  private async resolveOpenCashSession(
    client: CashTransaction,
    companyId: string,
    branchId: string,
    cashRegisterId: string | undefined,
  ): Promise<CashSessionRow> {
    if (cashRegisterId !== undefined) {
      const registerRow = await this.cashRepository.lockRegister(client, companyId, cashRegisterId);
      if (registerRow?.branchId !== branchId)
        throw new CashError('resource_not_found', 'The register was not found.');
      const openSession = await this.cashRepository.openSessionForRegister(client, companyId, cashRegisterId);
      if (openSession === null)
        throw new CashError('cash_session_required', 'Open a cash session before completing a cash refund.');
      return openSession;
    }
    const openSessions = await this.cashRepository.openSessionsForBranch(client, companyId, branchId);
    if (openSessions.length === 0)
      throw new CashError('cash_session_required', 'Open a cash session before completing a cash refund.');
    const [singleSession] = openSessions;
    if (openSessions.length > 1 || singleSession === undefined)
      throw new CashError(
        'validation_error',
        'Multiple open cash sessions exist for this branch; specify cash_register_id.',
      );
    return singleSession;
  }
}

function refundPayload(value: RefundRow): Readonly<Record<string, unknown>> {
  return {
    refund_id: value.id,
    sale_id: value.saleId,
    branch_id: value.branchId,
    refund_number: value.refundNumber,
    status: value.status,
    refund_method: value.refundMethod,
    currency_code: value.currencyCode,
    total: value.total,
    version: value.version.toString(),
  };
}

function decodeRefund(raw: unknown): RefundRow {
  const value = raw as Omit<RefundRow, 'version' | 'createdAt' | 'updatedAt' | 'occurredAt' | 'completedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
    occurredAt: string;
    completedAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    occurredAt: new Date(value.occurredAt),
    completedAt: value.completedAt === null ? null : new Date(value.completedAt),
  };
}
