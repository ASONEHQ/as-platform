import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { postDirectPurchaseReceipt } from '../inventory/purchase-receipt.js';
import type { SuppliersRepository } from '../suppliers/suppliers.repository.js';
import type { PurchasingRepository } from './purchasing.repository.js';
import {
  PurchaseError,
  type CreateDirectPurchaseInput,
  type DirectPurchaseMovementSummary,
  type DirectPurchaseRow,
  type PurchaseMutationContext,
} from './purchasing.types.js';

// --- Exact decimal arithmetic (ADR-0001) — this module's own
// self-contained copy of the same scaled-BigInt helpers `refunds.service.ts`/
// `cash.service.ts`/`sales.service.ts` each keep independently (this
// codebase's established discipline: never a shared cross-module money
// utility, so no module can be silently broken by another module's
// unrelated change). Never floating-point money math anywhere in this
// file. ---
const MONEY_SCALE = 10_000n; // numeric(19,4) — matches direct_purchases.unit_cost/total_cost exactly.
const QUANTITY_SCALE = 1_000_000n; // numeric(19,6) — matches direct_purchases.quantity exactly.

function moneyUnits(value: string, field: string): bigint {
  const match = /^(\d{1,15})(?:\.(\d{1,4}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new PurchaseError('validation_error', `${field} is invalid.`);
  return BigInt(match[1]) * MONEY_SCALE + BigInt((match[2] ?? '').padEnd(4, '0'));
}
function formatMoney(units: bigint): string {
  const whole = units / MONEY_SCALE;
  const fraction = (units % MONEY_SCALE).toString().padStart(4, '0');
  return `${whole.toString()}.${fraction}`;
}
function quantityUnits(value: string, field: string): bigint {
  const match = /^(\d{1,13})(?:\.(\d{1,6}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new PurchaseError('validation_error', `${field} is invalid.`);
  const units = BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (units <= 0n) throw new PurchaseError('validation_error', `${field} must be greater than zero.`);
  return units;
}
function formatQuantity(units: bigint): string {
  const whole = units / QUANTITY_SCALE;
  const fraction = (units % QUANTITY_SCALE).toString().padStart(6, '0');
  return `${whole.toString()}.${fraction}`;
}
/** Same round-half-up algorithm `refunds.service.ts`'s own
 * `multiplyMoneyByQuantity` established for "a money amount times a
 * quantity" — reused verbatim (in spirit; this module keeps its own
 * copy) so `total_cost` is computed by the exact same arithmetic the
 * movement line's own `extended_cost` uses (`purchase-receipt.ts`'s
 * `extendedCostUnits`) — the two can never silently drift apart. */
function totalCostUnits(unitCostUnits: bigint, qtyUnits: bigint): bigint {
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
  if (clean.length > maxLength) throw new PurchaseError('validation_error', `${field} is too long.`);
  return clean;
}
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
const PURCHASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function directPurchasePayload(value: DirectPurchaseRow): Readonly<Record<string, unknown>> {
  return {
    direct_purchase_id: value.id,
    branch_id: value.branchId,
    supplier_name: value.supplierName,
    supplier_id: value.supplierId,
    product_variant_id: value.productVariantId,
    quantity: value.quantity,
    unit_cost: value.unitCost,
    currency_code: value.currencyCode,
    total_cost: value.totalCost,
    purchase_date: value.purchaseDate,
    inventory_movement_id: value.inventoryMovementId,
  };
}
function decodeDirectPurchase(raw: unknown): DirectPurchaseRow {
  const value = raw as Omit<DirectPurchaseRow, 'createdAt'> & { createdAt: string };
  return { ...value, createdAt: new Date(value.createdAt) };
}

export class PurchasingService {
  public constructor(
    private readonly repository: PurchasingRepository,
    // TASK 14.4 (Wave 2, Part C.2) — resolves an optional real supplierId
    // link (company-scoped; see `recordDirectPurchase`'s own doc comment).
    // Required, never optional: this codebase's own established
    // convention for a genuine cross-module collaborator (see
    // `SalesService`'s own multi-repository constructor) — never a
    // silently-degraded runtime path when it happens to be omitted.
    private readonly suppliersRepository: SuppliersRepository,
  ) {}

  /**
   * Records one direct purchase inside a single transaction: (1) validate
   * quantity/unit-cost/currency/date, compute `total_cost` with exact
   * BigInt-scaled money arithmetic; (1.5 — TASK 14.4 Wave 2) when
   * `supplierId` is provided, resolve the real supplier (must belong to
   * this SAME company; a cross-company or non-existent id is rejected as
   * `resource_not_found`) and require it to be `active` — a business
   * should not be able to record a NEW direct purchase against a supplier
   * it has already marked inactive, so an inactive supplier is rejected
   * outright as `supplier_inactive` (this wave's own documented decision;
   * see this module's own README-style comment in `purchasing.types.ts`
   * for the alternative considered and rejected). The supplier's CURRENT
   * real name is then frozen into `supplierName` at this exact moment —
   * any client-supplied `supplierName` is ignored when a real `supplierId`
   * is linked, since the two would otherwise silently diverge; when
   * `supplierId` is absent, `supplierName` behaves exactly as it always
   * has (free text or null), so no existing caller is affected; (2) post
   * the real `receipt` inventory movement via `postDirectPurchaseReceipt`
   * (which itself validates the product variant/branch location and
   * mutates `inventory_balances`); (3) insert the `direct_purchases` row
   * referencing the movement's own id; (4) audit + outbox. A failure at
   * any point rolls every one of these back together — see
   * `postDirectPurchaseReceipt`'s own doc comment for why an invalid
   * `product_variant_id` can never leave an orphaned movement OR an
   * orphaned direct-purchase row.
   */
  public async recordDirectPurchase(
    context: PurchaseMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreateDirectPurchaseInput,
  ): Promise<{ value: DirectPurchaseRow; replayed: boolean }> {
    const qtyUnits = quantityUnits(input.quantity, 'quantity');
    const costUnits = moneyUnits(input.unitCost, 'unit_cost');
    if (costUnits < 0n) throw new PurchaseError('validation_error', 'unit_cost must not be negative.');
    const cleanCurrency = input.currencyCode.trim().toUpperCase();
    if (!CURRENCY_CODE_PATTERN.test(cleanCurrency))
      throw new PurchaseError('validation_error', 'currency_code must be a 3-letter ISO code.');
    if (!PURCHASE_DATE_PATTERN.test(input.purchaseDate))
      throw new PurchaseError('validation_error', 'purchase_date must be a YYYY-MM-DD date.');
    const cleanNotes = nonBlankOptional(input.notes, 'notes', 2000);
    const quantity = formatQuantity(qtyUnits);
    const unitCost = formatMoney(costUnits);
    const totalCost = formatMoney(totalCostUnits(costUnits, qtyUnits));

    const supplierId = input.supplierId ?? null;
    let cleanSupplier: string | null;
    if (supplierId === null) {
      cleanSupplier = nonBlankOptional(input.supplierName, 'supplier_name', 500);
    } else {
      const supplier = await this.suppliersRepository.supplier(null, context.companyId, supplierId);
      if (supplier === null) throw new PurchaseError('resource_not_found', 'The supplier was not found.');
      if (supplier.status === 'inactive')
        throw new PurchaseError(
          'supplier_inactive',
          'Cannot record a new direct purchase against an inactive supplier.',
        );
      // Frozen snapshot from THIS moment forward — never re-derived live
      // on later reads (mirrors `sales.customer_display_name`'s own
      // established precedent). Any client-supplied `supplier_name` is
      // deliberately ignored when a real `supplierId` is linked.
      cleanSupplier = supplier.name;
    }

    const id = input.id ?? randomUUID();
    const requestHash = hash({
      branchId: input.branchId,
      supplierName: cleanSupplier,
      supplierId,
      productVariantId: input.productVariantId,
      quantity,
      unitCost,
      currencyCode: cleanCurrency,
      purchaseDate: input.purchaseDate,
      notes: cleanNotes,
      id: input.id ?? null,
    });

    if (!branchIds.includes(input.branchId))
      throw new PurchaseError('resource_not_found', 'The branch was not found.');

    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'direct_purchase.create',
        key,
        requestHash,
        'direct_purchase',
        decodeDirectPurchase,
        async () => {
          const posted = await postDirectPurchaseReceipt(
            client,
            {
              companyId: context.companyId,
              actorId: context.actorId,
              correlationId: context.correlationId,
              timestamp: context.timestamp,
            },
            { id, branchId: input.branchId },
            {
              productVariantId: input.productVariantId,
              quantity,
              unitCost,
              currencyCode: cleanCurrency,
            },
          );
          const row = await this.repository.insertDirectPurchase(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            supplierName: cleanSupplier,
            supplierId,
            productVariantId: input.productVariantId,
            quantity,
            unitCost,
            currencyCode: cleanCurrency,
            totalCost,
            purchaseDate: input.purchaseDate,
            notes: cleanNotes,
            inventoryMovementId: posted.movementId,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'direct_purchase.created',
            resourceType: 'direct_purchase',
            resourceId: row.id,
            eventType: 'direct_purchase.created',
            branchId: row.branchId,
            payload: directPurchasePayload(row),
          });
          return row;
        },
      ),
    );
  }

  public async directPurchase(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<DirectPurchaseRow> {
    const value = await this.repository.directPurchase(companyId, branchIds, id);
    if (value === null) throw new PurchaseError('resource_not_found', 'The direct purchase was not found.');
    return value;
  }

  /** Part — "ideally the resulting balance-after, if easily available": a
   * simple lookup/join, never a historical reconstruction — see
   * `PurchasingRepository.movementSummary`'s own doc comment. */
  public async movementSummary(
    companyId: string,
    value: DirectPurchaseRow,
  ): Promise<DirectPurchaseMovementSummary> {
    const summary = await this.repository.movementSummary(
      companyId,
      value.inventoryMovementId,
      value.productVariantId,
      value.branchId,
    );
    if (summary === null)
      // Unreachable in practice — `direct_purchases.inventory_movement_id`
      // is NOT NULL and `postDirectPurchaseReceipt` always posts it inside
      // the very same transaction that inserts this row — kept explicit
      // rather than silently returning a half-built response.
      throw new Error('The linked inventory movement was not found for this direct purchase.');
    return summary;
  }

  public listDirectPurchases(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<PurchasingRepository['listDirectPurchases']>[2],
  ): ReturnType<PurchasingRepository['listDirectPurchases']> {
    return this.repository.listDirectPurchases(companyId, branchIds, input);
  }
}
