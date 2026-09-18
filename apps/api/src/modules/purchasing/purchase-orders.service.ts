import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { postPurchaseOrderReceipt } from '../inventory/purchase-order-receipt.js';
import type { SuppliersRepository } from '../suppliers/suppliers.repository.js';
import type { PurchaseOrdersRepository } from './purchase-orders.repository.js';
import {
  PurchaseOrderError,
  type CreatePurchaseOrderInput,
  type PurchaseOrderMovementSummary,
  type PurchaseOrderMutationContext,
  type PurchaseOrderRow,
  type ReceivePurchaseOrderLineInput,
} from './purchase-orders.types.js';

// --- Exact decimal arithmetic (ADR-0001) — this module's own
// self-contained copy, exactly mirroring `purchasing.service.ts`'s own
// established discipline: never a shared cross-module money utility, so
// no module can be silently broken by another module's unrelated
// change. Never floating-point money math anywhere in this file. ---
const MONEY_SCALE = 10_000n; // numeric(19,4) — matches purchase_order_lines.unit_cost/line_total exactly.
const QUANTITY_SCALE = 1_000_000n; // numeric(19,6) — matches purchase_order_lines.ordered_quantity exactly.

function moneyUnits(value: string, field: string): bigint {
  const match = /^(\d{1,15})(?:\.(\d{1,4}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new PurchaseOrderError('validation_error', `${field} is invalid.`);
  return BigInt(match[1]) * MONEY_SCALE + BigInt((match[2] ?? '').padEnd(4, '0'));
}
function formatMoney(units: bigint): string {
  const whole = units / MONEY_SCALE;
  const fraction = (units % MONEY_SCALE).toString().padStart(4, '0');
  return `${whole.toString()}.${fraction}`;
}
function quantityUnits(value: string, field: string): bigint {
  const match = /^(\d{1,13})(?:\.(\d{1,6}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new PurchaseOrderError('validation_error', `${field} is invalid.`);
  const units = BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (units <= 0n) throw new PurchaseOrderError('validation_error', `${field} must be greater than zero.`);
  return units;
}
function formatQuantity(units: bigint): string {
  const whole = units / QUANTITY_SCALE;
  const fraction = (units % QUANTITY_SCALE).toString().padStart(6, '0');
  return `${whole.toString()}.${fraction}`;
}
/** Same round-half-up algorithm `purchasing.service.ts`'s own
 * `totalCostUnits`/`purchase-receipt.ts`'s `extendedCostUnits` use — a
 * money amount times a quantity must round consistently everywhere it is
 * computed. */
function lineTotalUnits(unitCostUnits: bigint, qtyUnits: bigint): bigint {
  const numerator = unitCostUnits * qtyUnits;
  return (numerator + QUANTITY_SCALE / 2n) / QUANTITY_SCALE;
}
function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function nonBlankOptional(value: string | null | undefined, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const clean = value.trim();
  if (clean.length === 0) return null;
  if (clean.length > maxLength) throw new PurchaseOrderError('validation_error', `${field} is too long.`);
  return clean;
}
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function purchaseOrderPayload(value: PurchaseOrderRow): Readonly<Record<string, unknown>> {
  return {
    purchase_order_id: value.id,
    order_number: value.orderNumber,
    branch_id: value.branchId,
    status: value.status,
    supplier_name: value.supplierName,
    supplier_id: value.supplierId,
    order_date: value.orderDate,
    currency_code: value.currencyCode,
    total_cost: value.totalCost,
    receipt_movement_id: value.receiptMovementId,
    line_count: value.lines.length,
  };
}
function decodePurchaseOrder(raw: unknown): PurchaseOrderRow {
  const value = raw as Omit<PurchaseOrderRow, 'submittedAt' | 'receivedAt' | 'cancelledAt' | 'createdAt' | 'updatedAt' | 'version'> & {
    submittedAt: string | null;
    receivedAt: string | null;
    cancelledAt: string | null;
    createdAt: string;
    updatedAt: string;
    version: string | number | bigint;
  };
  return {
    ...value,
    submittedAt: value.submittedAt === null ? null : new Date(value.submittedAt),
    receivedAt: value.receivedAt === null ? null : new Date(value.receivedAt),
    cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    version: BigInt(value.version),
  };
}
function mergeCancellationNotes(existing: string | null, reason: string | null): string | null {
  if (reason === null) return existing;
  const line = `Cancellation reason: ${reason}`;
  return existing === null || existing.length === 0 ? line : `${existing}\n${line}`;
}

const CANCELLABLE_STATUSES = new Set(['draft', 'submitted', 'partially_received']);

export class PurchaseOrdersService {
  public constructor(
    private readonly repository: PurchaseOrdersRepository,
    // Required, never optional — same established convention
    // `PurchasingService`'s own constructor follows (see that class's own
    // doc comment): only used when a request actually links a real
    // `supplier_id`.
    private readonly suppliersRepository: SuppliersRepository,
  ) {}

  /**
   * Creates a draft purchase order with all of its lines inside a single
   * transaction: (1) validate branch/currency/dates/lines, reject an
   * empty `lines` array (`purchase_order_empty_lines`) or a duplicate
   * `product_variant_id` within the submitted array
   * (`purchase_order_duplicate_variant`); (2) validate each line's
   * `product_variant_id` resolves to a real, stock-tracked variant in
   * THIS company up front — `purchase_order_product_variant_not_found`/
   * `purchase_order_non_tracked_variant` — since a draft PO for a
   * nonexistent product is never useful, unlike a direct purchase (which
   * only discovers this at the moment it posts real stock); (3) when
   * `supplierId` is provided, resolve/require-active it and freeze its
   * CURRENT name into `supplierName`, exactly mirroring
   * `PurchasingService.recordDirectPurchase`'s own established supplier-
   * linkage behavior (frozen snapshot, cross-company/inactive rejected);
   * (4) compute each line's `line_total` and the PO's own `total_cost`
   * server-side with exact BigInt-scaled money arithmetic — never
   * client-supplied; (5) insert the PO + lines; (6) audit + outbox. No
   * inventory effect whatsoever — a draft PO never touches stock.
   */
  public async createPurchaseOrder(
    context: PurchaseOrderMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreatePurchaseOrderInput,
  ): Promise<{ value: PurchaseOrderRow; replayed: boolean }> {
    if (input.lines.length === 0)
      throw new PurchaseOrderError('purchase_order_empty_lines', 'A purchase order must have at least one line.');
    const seenVariants = new Set<string>();
    for (const line of input.lines) {
      if (seenVariants.has(line.productVariantId))
        throw new PurchaseOrderError(
          'purchase_order_duplicate_variant',
          'The same product_variant_id was submitted more than once.',
        );
      seenVariants.add(line.productVariantId);
    }
    if (!branchIds.includes(input.branchId))
      throw new PurchaseOrderError('resource_not_found', 'The branch was not found.');

    for (const line of input.lines) {
      const variant = await this.repository.productVariant(context.companyId, line.productVariantId);
      if (variant === null)
        throw new PurchaseOrderError(
          'purchase_order_product_variant_not_found',
          'A product variant on this purchase order was not found.',
        );
      if (!variant.tracksInventory)
        throw new PurchaseOrderError(
          'purchase_order_non_tracked_variant',
          'A product variant on this purchase order does not track inventory.',
        );
    }

    const cleanCurrency = input.currencyCode.trim().toUpperCase();
    if (!CURRENCY_CODE_PATTERN.test(cleanCurrency))
      throw new PurchaseOrderError('validation_error', 'currency_code must be a 3-letter ISO code.');
    if (!DATE_PATTERN.test(input.orderDate))
      throw new PurchaseOrderError('validation_error', 'order_date must be a YYYY-MM-DD date.');
    if (input.expectedDate !== null && input.expectedDate !== undefined && !DATE_PATTERN.test(input.expectedDate))
      throw new PurchaseOrderError('validation_error', 'expected_date must be a YYYY-MM-DD date.');
    const cleanNotes = nonBlankOptional(input.notes, 'notes', 2000);

    const supplierId = input.supplierId ?? null;
    let cleanSupplier: string | null;
    if (supplierId === null) {
      cleanSupplier = nonBlankOptional(input.supplierName, 'supplier_name', 500);
    } else {
      const supplier = await this.suppliersRepository.supplier(null, context.companyId, supplierId);
      if (supplier === null)
        throw new PurchaseOrderError('purchase_order_supplier_not_found', 'The supplier was not found.');
      if (supplier.status === 'inactive')
        throw new PurchaseOrderError(
          'purchase_order_supplier_inactive',
          'Cannot create a new purchase order against an inactive supplier.',
        );
      cleanSupplier = supplier.name;
    }

    let totalUnits = 0n;
    const lines = input.lines.map((line) => {
      const orderedUnits = quantityUnits(line.orderedQuantity, 'ordered_quantity');
      const unitCostUnits = moneyUnits(line.unitCost, 'unit_cost');
      if (unitCostUnits < 0n) throw new PurchaseOrderError('validation_error', 'unit_cost must not be negative.');
      const lineTotal = lineTotalUnits(unitCostUnits, orderedUnits);
      totalUnits += lineTotal;
      return {
        productVariantId: line.productVariantId,
        orderedQuantity: formatQuantity(orderedUnits),
        unitCost: formatMoney(unitCostUnits),
        lineTotal: formatMoney(lineTotal),
        notes: nonBlankOptional(line.notes, 'lines[].notes', 2000),
      };
    });

    const id = input.id ?? randomUUID();
    const orderNumber = `PO-${id.replaceAll('-', '').toLowerCase()}`;
    const requestHash = hash({
      branchId: input.branchId,
      supplierName: cleanSupplier,
      supplierId,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate ?? null,
      currencyCode: cleanCurrency,
      notes: cleanNotes,
      lines,
      id: input.id ?? null,
    });

    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'purchase_order.create',
        key,
        requestHash,
        'purchase_order',
        decodePurchaseOrder,
        async () => {
          const row = await this.repository.insertPurchaseOrder(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            orderNumber,
            supplierName: cleanSupplier,
            supplierId,
            orderDate: input.orderDate,
            expectedDate: input.expectedDate ?? null,
            currencyCode: cleanCurrency,
            totalCost: formatMoney(totalUnits),
            notes: cleanNotes,
            createdBy: context.actorId,
            timestamp: context.timestamp,
            lines,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'purchase_order.created',
            resourceType: 'purchase_order',
            resourceId: row.id,
            eventType: 'purchase_order.created',
            branchId: row.branchId,
            payload: purchaseOrderPayload(row),
          });
          return row;
        },
      ),
    );
  }

  public async purchaseOrder(companyId: string, branchIds: readonly string[], id: string): Promise<PurchaseOrderRow> {
    const value = await this.repository.purchaseOrder(companyId, branchIds, id);
    if (value === null) throw new PurchaseOrderError('purchase_order_not_found', 'The purchase order was not found.');
    return value;
  }

  public listPurchaseOrders(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<PurchaseOrdersRepository['listPurchaseOrders']>[2],
  ): ReturnType<PurchaseOrdersRepository['listPurchaseOrders']> {
    return this.repository.listPurchaseOrders(companyId, branchIds, input);
  }

  public async submitPurchaseOrder(
    context: PurchaseOrderMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
  ): Promise<{ value: PurchaseOrderRow; replayed: boolean }> {
    const requestHash = hash({ id, operation: 'submit' });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'purchase_order.submit',
        key,
        requestHash,
        'purchase_order',
        decodePurchaseOrder,
        async () => {
          const current = await this.repository.purchaseOrderForUpdate(client, context.companyId, branchIds, id);
          if (current === null)
            throw new PurchaseOrderError('purchase_order_not_found', 'The purchase order was not found.');
          if (current.status !== 'draft')
            throw new PurchaseOrderError(
              'purchase_order_invalid_transition',
              'Only a draft purchase order can be submitted.',
            );
          const row = await this.repository.submitPurchaseOrder(client, context, id);
          await this.repository.auditAndPublish(client, context, {
            action: 'purchase_order.submitted',
            resourceType: 'purchase_order',
            resourceId: row.id,
            eventType: 'purchase_order.submitted',
            branchId: row.branchId,
            payload: purchaseOrderPayload(row),
          });
          return row;
        },
      ),
    );
  }

  /**
   * Receives a `submitted` purchase order — see `purchase-order-receipt.
   * ts`'s own doc comment and `packages/database/src/schema/purchasing.ts`'s
   * `purchaseOrders` doc comment for why this is deliberately the ONLY
   * receiving event a PO ever gets: valid ONLY from `status='submitted'`
   * (never from `partially_received`, which — by this design — is
   * terminal and can only be cancelled afterward). A line omitted from
   * [input.lines] is treated as `received_quantity=0` for this event and
   * is simply not included in the posted movement's lines. Rejects
   * `purchase_order_over_receipt` when any line's requested quantity
   * exceeds its own `ordered_quantity`, and `purchase_order_empty_receipt`
   * when every line ends up with 0 received quantity — both roll back the
   * whole attempt (the same atomicity `postPurchaseOrderReceipt`'s own doc
   * comment describes). Final status is `received` when EVERY line's
   * `received_quantity` now equals its `ordered_quantity`, else
   * `partially_received`.
   */
  public async receivePurchaseOrder(
    context: PurchaseOrderMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
    input: { lines: readonly ReceivePurchaseOrderLineInput[] },
  ): Promise<{ value: PurchaseOrderRow; replayed: boolean }> {
    if (input.lines.length === 0)
      throw new PurchaseOrderError('purchase_order_empty_receipt', 'At least one line must be received.');
    const requestHash = hash({
      id,
      operation: 'receive',
      lines: [...input.lines]
        .map((line) => ({ lineId: line.purchaseOrderLineId, quantity: line.receivedQuantity }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId)),
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'purchase_order.receive',
        key,
        requestHash,
        'purchase_order',
        decodePurchaseOrder,
        async () => {
          const current = await this.repository.purchaseOrderForUpdate(client, context.companyId, branchIds, id);
          if (current === null)
            throw new PurchaseOrderError('purchase_order_not_found', 'The purchase order was not found.');
          // Deliberately `submitted` ONLY — see this method's own doc
          // comment for why `partially_received` is never eligible again.
          if (current.status !== 'submitted')
            throw new PurchaseOrderError(
              'purchase_order_invalid_transition',
              'Only a submitted purchase order can be received.',
            );

          const byLineId = new Map(current.lines.map((line) => [line.id, line]));
          const requestedByLineId = new Map<string, bigint>();
          for (const entry of input.lines) {
            const line = byLineId.get(entry.purchaseOrderLineId);
            if (line === undefined)
              throw new PurchaseOrderError(
                'validation_error',
                'purchase_order_line_id does not belong to this purchase order.',
              );
            const qtyUnits = quantityUnits(entry.receivedQuantity, 'received_quantity');
            const orderedUnits = quantityUnits(line.orderedQuantity, 'ordered_quantity');
            if (qtyUnits > orderedUnits)
              throw new PurchaseOrderError(
                'purchase_order_over_receipt',
                'received_quantity cannot exceed a line’s ordered_quantity.',
              );
            requestedByLineId.set(line.id, (requestedByLineId.get(line.id) ?? 0n) + qtyUnits);
          }
          if (requestedByLineId.size === 0)
            throw new PurchaseOrderError('purchase_order_empty_receipt', 'At least one line must be received.');

          const postingItems = current.lines
            .filter((line) => requestedByLineId.has(line.id))
            .map((line) => ({
              productVariantId: line.productVariantId,
              quantity: formatQuantity(requestedByLineId.get(line.id) ?? 0n),
              unitCost: line.unitCost,
              currencyCode: current.currencyCode,
            }));

          const posted = await postPurchaseOrderReceipt(
            client,
            {
              companyId: context.companyId,
              actorId: context.actorId,
              correlationId: context.correlationId,
              timestamp: context.timestamp,
            },
            { id: current.id, branchId: current.branchId },
            postingItems,
          );

          let allFull = true;
          for (const line of current.lines) {
            const ordered = quantityUnits(line.orderedQuantity, 'ordered_quantity');
            const added = requestedByLineId.get(line.id) ?? 0n;
            if (added !== ordered) allFull = false;
          }
          const finalStatus: 'received' | 'partially_received' = allFull ? 'received' : 'partially_received';

          const lineUpdates = [...requestedByLineId.entries()].map(([lineId, qtyUnits]) => ({
            purchaseOrderLineId: lineId,
            receivedQuantity: formatQuantity(qtyUnits),
          }));

          const row = await this.repository.applyReceipt(
            client,
            context,
            id,
            finalStatus,
            posted.movementId,
            lineUpdates,
          );
          await this.repository.auditAndPublish(client, context, {
            action: 'purchase_order.received',
            resourceType: 'purchase_order',
            resourceId: row.id,
            eventType: 'purchase_order.received',
            branchId: row.branchId,
            payload: {
              ...purchaseOrderPayload(row),
              inventory_movement_id: posted.movementId,
              lines_received: lineUpdates,
            },
          });
          return row;
        },
      ),
    );
  }

  /**
   * Cancels a purchase order — valid from `draft`, `submitted`, or
   * `partially_received`; rejects `received`→cancel and an already-
   * `cancelled`→cancel as `purchase_order_invalid_transition`. NEVER
   * touches inventory/stock in any way — if the PO was
   * `partially_received`, its already-posted receipt movement and the
   * stock it added are completely untouched; only the PO's own status
   * changes (see this method's own test coverage for the explicit
   * "stock unchanged by cancel" assertion).
   */
  public async cancelPurchaseOrder(
    context: PurchaseOrderMutationContext,
    branchIds: readonly string[],
    id: string,
    key: string,
    reason: string | null | undefined,
  ): Promise<{ value: PurchaseOrderRow; replayed: boolean }> {
    const cleanReason = nonBlankOptional(reason, 'reason', 2000);
    const requestHash = hash({ id, operation: 'cancel', reason: cleanReason });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'purchase_order.cancel',
        key,
        requestHash,
        'purchase_order',
        decodePurchaseOrder,
        async () => {
          const current = await this.repository.purchaseOrderForUpdate(client, context.companyId, branchIds, id);
          if (current === null)
            throw new PurchaseOrderError('purchase_order_not_found', 'The purchase order was not found.');
          if (!CANCELLABLE_STATUSES.has(current.status))
            throw new PurchaseOrderError(
              'purchase_order_invalid_transition',
              'This purchase order cannot be cancelled from its current status.',
            );
          const mergedNotes = mergeCancellationNotes(current.notes, cleanReason);
          const row = await this.repository.cancelPurchaseOrder(client, context, id, mergedNotes);
          await this.repository.auditAndPublish(client, context, {
            action: 'purchase_order.cancelled',
            resourceType: 'purchase_order',
            resourceId: row.id,
            eventType: 'purchase_order.cancelled',
            branchId: row.branchId,
            payload: { ...purchaseOrderPayload(row), cancellation_reason: cleanReason },
          });
          return row;
        },
      ),
    );
  }

  public async movementSummary(
    companyId: string,
    value: PurchaseOrderRow,
  ): Promise<PurchaseOrderMovementSummary | undefined> {
    if (value.receiptMovementId === null) return undefined;
    const summary = await this.repository.movementSummary(
      companyId,
      value.branchId,
      value.receiptMovementId,
      value.lines.map((line) => line.productVariantId),
    );
    if (summary === null)
      // Unreachable in practice — `receiptMovementId` is only ever set by
      // `applyReceipt` inside the very same transaction that
      // `postPurchaseOrderReceipt` posts it in.
      throw new Error('The linked inventory movement was not found for this purchase order.');
    return summary;
  }
}
