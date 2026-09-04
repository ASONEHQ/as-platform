import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { ivaBasisPointsForTaxCode, normalizeCurrencyCode } from '@asone/database';

import type { SalesRepository } from './sales.repository.js';
import {
  SaleError,
  type CreateSaleInput,
  type SaleItemRow,
  type SaleMutationContext,
  type SaleRow,
} from './sales.types.js';

// --- Exact decimal arithmetic (ADR-0001: never a JS `number` for money) --
// No shared money-arithmetic helper exists anywhere in this backend yet
// (confirmed by inspection before writing this): every prior module only
// ever *stored*/*compared* pre-computed decimal strings, never multiplied
// one by a quantity or a tax rate server-side. This mirrors, deliberately,
// the exact same `BigInt`-at-scale algorithm Flutter's own `Money`
// already uses (`apps/one/lib/features/pos/money.dart`:
// `multiplyByRateBasisPoints`, round-half-up) — ADR-0001 asks for
// deterministic totals *across* runtimes, so the two independent
// implementations compute identically, not merely similarly.
const MONEY_SCALE = 10_000n; // numeric(19,4)
const QUANTITY_SCALE = 1_000_000n; // numeric(19,6)
const BASIS_POINT_SCALE = 10_000n; // 10000bp = 100%

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
// Same `numeric(19,6)` wire shape already established by
// `inventory-posting.service.ts`'s `inventoryDecimal` — matched
// deliberately rather than cross-imported, so this module stays
// self-contained the same way `payments.service.ts`'s own local
// `amount()`/`currency()` wrappers do.
function quantityUnits(value: string, field: string): bigint {
  const match = /^(\d{1,19})(?:\.(\d{1,6}))?$/u.exec(value);
  if (match?.[1] === undefined) throw new SaleError('validation_error', `${field} is invalid.`);
  const units = BigInt(match[1]) * QUANTITY_SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (units <= 0n) throw new SaleError('validation_error', `${field} must be greater than zero.`);
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
function currency(value: string): string {
  try {
    return normalizeCurrencyCode(value.trim().toUpperCase());
  } catch (error) {
    throw new SaleError('validation_error', error instanceof Error ? error.message : 'Invalid currency code.');
  }
}
function nonBlank(value: string, field: string): string {
  const clean = value.trim();
  if (clean.length === 0) throw new SaleError('validation_error', `${field} cannot be blank.`);
  if (clean.length > 200) throw new SaleError('validation_error', `${field} is too long.`);
  return clean;
}

interface LineComputation {
  lineNumber: number;
  productId: string;
  productVariantId: string | null;
  productVersion: bigint;
  skuSnapshot: string | null;
  nameSnapshot: string;
  quantity: string;
  unitPrice: string;
  subtotalUnits: bigint;
  taxUnits: bigint;
  taxCode: string;
  basisPoints: number;
}

export class SalesService {
  public constructor(private readonly repository: SalesRepository) {}

  /**
   * Creates a Sale directly in `pending_payment` (§21.2's
   * `draft → pending_payment: payment required` collapsed into one atomic
   * step — see ADR-0009) from a raw `{product_id, quantity}[]` ticket.
   * Never trusts a client-submitted price, tax, or total: every line's
   * price and tax classification is independently re-resolved from the
   * backend's own `products`/`product_prices` inside this same
   * transaction, and the sale's `subtotal`/`tax_total`/`total` are
   * computed here, not accepted as input at all (`CreateSaleInput` has no
   * such fields — a tampered client total has nothing to tamper).
   */
  public async createSale(
    context: SaleMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreateSaleInput,
  ): Promise<{ value: { sale: SaleRow; items: SaleItemRow[] }; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new SaleError('validation_error', 'The branch is not authorized for this actor.');
    if (input.items.length === 0)
      throw new SaleError('validation_error', 'A sale must have at least one item.');
    if (input.items.length > 200) throw new SaleError('validation_error', 'Too many sale items.');
    const parsedItems = input.items.map((item, index) => {
      if (typeof item.productId !== 'string' || item.productId.trim().length === 0)
        throw new SaleError('validation_error', `items[${String(index)}].product_id is required.`);
      const units = quantityUnits(item.quantity, `items[${String(index)}].quantity`);
      return { productId: item.productId, quantityUnits: units, quantity: formatQuantity(units) };
    });
    const requestedCurrency = input.currencyCode === undefined ? null : currency(input.currencyCode);
    const normalized = {
      id: input.id ?? randomUUID(),
      branchId: input.branchId,
      deviceId: input.deviceId ?? null,
      items: parsedItems,
    };
    const requestHash = hash({
      branchId: normalized.branchId,
      deviceId: normalized.deviceId,
      currencyCode: requestedCurrency,
      items: normalized.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'sale.create',
        key,
        requestHash,
        'sale',
        decodeSaleWithItems,
        async () => {
          const productIds = [...new Set(normalized.items.map((item) => item.productId))];
          const resolved = await this.repository.resolveProductLines(
            client,
            context.companyId,
            normalized.branchId,
            productIds,
          );
          let currencyCode = requestedCurrency;
          let subtotalUnits = 0n;
          let taxUnits = 0n;
          const lines: LineComputation[] = [];
          normalized.items.forEach((item, index) => {
            const product = resolved.get(item.productId);
            if (product === undefined)
              throw new SaleError('product_not_found', `items[${String(index)}].product_id was not found.`);
            if (product.status !== 'active')
              throw new SaleError(
                'product_not_active',
                `items[${String(index)}].product_id is not active.`,
              );
            if (product.price === null)
              throw new SaleError(
                'price_not_found',
                `items[${String(index)}].product_id has no active price.`,
              );
            if (currencyCode === null) currencyCode = product.price.currencyCode;
            else if (currencyCode !== product.price.currencyCode)
              throw new SaleError(
                'currency_mismatch',
                `items[${String(index)}].product_id's price currency does not match the sale's currency.`,
              );
            const unitPriceUnits = moneyUnits(product.price.amount);
            const lineSubtotalUnits = multiplyMoneyByQuantity(unitPriceUnits, item.quantityUnits);
            const basisPoints = ivaBasisPointsForTaxCode(product.taxCode);
            const lineTaxUnits = applyBasisPoints(lineSubtotalUnits, basisPoints);
            subtotalUnits += lineSubtotalUnits;
            taxUnits += lineTaxUnits;
            lines.push({
              lineNumber: index + 1,
              productId: product.productId,
              productVariantId: product.variantId,
              productVersion: product.productVersion,
              skuSnapshot: product.skuSnapshot,
              nameSnapshot: product.name,
              quantity: item.quantity,
              unitPrice: product.price.amount,
              subtotalUnits: lineSubtotalUnits,
              taxUnits: lineTaxUnits,
              taxCode: product.taxCode,
              basisPoints,
            });
          });
          if (currencyCode === null)
            throw new SaleError('validation_error', 'Could not resolve a currency for this sale.');
          const totalUnits = subtotalUnits + taxUnits;
          const createdSale = await this.repository.insertSale(client, {
            ...context,
            id: normalized.id,
            branchId: normalized.branchId,
            deviceId: normalized.deviceId,
            saleNumber: `SALE-${normalized.id.replaceAll('-', '').toLowerCase()}`,
            currencyCode,
            subtotal: formatMoney(subtotalUnits),
            discountTotal: '0.0000',
            taxTotal: formatMoney(taxUnits),
            total: formatMoney(totalUnits),
          });
          // Every line writes to a distinct `(sale_id, line_number)` row
          // with no dependency on any sibling line, so these run
          // concurrently on the one transaction connection rather than a
          // sequential loop.
          const items: SaleItemRow[] = await Promise.all(
            lines.map((line) =>
              this.repository.insertSaleItem(client, {
                id: randomUUID(),
                companyId: context.companyId,
                branchId: normalized.branchId,
                saleId: createdSale.id,
                lineNumber: line.lineNumber,
                productId: line.productId,
                productVariantId: line.productVariantId,
                productVersion: line.productVersion,
                skuSnapshot: line.skuSnapshot,
                nameSnapshot: line.nameSnapshot,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                subtotal: formatMoney(line.subtotalUnits),
                taxTotal: formatMoney(line.taxUnits),
                lineTotal: formatMoney(line.subtotalUnits + line.taxUnits),
                taxSnapshot: { tax_code: line.taxCode, basis_points: line.basisPoints },
                timestamp: context.timestamp,
              }),
            ),
          );
          await this.repository.auditAndPublish(client, context, {
            action: 'sale.created',
            resourceType: 'sale',
            resourceId: createdSale.id,
            eventType: 'sale.created',
            version: createdSale.version,
            payload: salePayload(createdSale),
          });
          return { id: createdSale.id, sale: createdSale, items };
        },
      ),
    );
  }

  /** TASK 12.6 Part B (E075): a thin passthrough — `branchIds` (the
   * caller's own authorized-branch list) is *always* passed to the
   * repository, which intersects it with any explicit `branch_id` filter
   * the caller also supplied; there is no way to query outside it. See
   * `sales.routes.ts` for how `branch_id`/`occurred_from`/`occurred_to`
   * are themselves validated at the HTTP boundary. */
  public listSales(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<SalesRepository['listSales']>[2],
  ): ReturnType<SalesRepository['listSales']> {
    return this.repository.listSales(companyId, branchIds, input);
  }

  public listSummaries(
    companyId: string,
    saleIds: readonly string[],
  ): ReturnType<SalesRepository['listSummaries']> {
    return this.repository.listSummaries(companyId, saleIds);
  }

  public async sale(
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<{ sale: SaleRow; items: SaleItemRow[] }> {
    const value = await this.repository.sale(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new SaleError('resource_not_found', 'The sale was not found.');
    const items = await this.repository.saleItems(companyId, id);
    return { sale: value, items };
  }

  /** TASK 12.5B: the receipt's business/branch/cashier names — see
   * `SalesRepository.receiptOrganization`. Branch authorization is
   * already enforced by the caller's own prior `sale()` call
   * (`sales.routes.ts`'s receipt route always calls `sale()` first); this
   * is a thin passthrough, not a second authorization point. */
  public receiptOrganization(
    companyId: string,
    saleId: string,
  ): ReturnType<SalesRepository['receiptOrganization']> {
    return this.repository.receiptOrganization(companyId, saleId);
  }

  /** Cancellation is only ever allowed from `pending_payment` — this
   * guarantees no payment has captured against the sale yet, since a
   * captured payment already drives the sale to `completed` (see
   * `PaymentService.transitionAttempt`'s settlement coordination), and
   * §21.2 has no `completed → cancelled` edge. */
  public async cancelSale(
    context: SaleMutationContext,
    branchIds: readonly string[],
    saleId: string,
    key: string,
    reasonCode: string,
  ): Promise<{ value: SaleRow; replayed: boolean }> {
    const cleanReason = nonBlank(reasonCode, 'reason_code');
    const requestHash = hash({ saleId, reasonCode: cleanReason });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'sale.cancel',
        key,
        requestHash,
        'sale',
        decodeSale,
        async () => {
          const current = await this.repository.lockSale(client, context.companyId, branchIds, saleId);
          if (current === null) throw new SaleError('resource_not_found', 'The sale was not found.');
          if (current.status !== 'pending_payment')
            throw new SaleError(
              'invalid_sale_state',
              'Only a sale awaiting payment can be cancelled.',
            );
          const updated = await this.repository.updateSaleStatus(
            client,
            context.companyId,
            saleId,
            current.version,
            {
              status: 'cancelled',
              timestamp: context.timestamp,
              cancelledAt: context.timestamp,
              cancelledBy: context.actorId,
              reasonCode: cleanReason,
            },
          );
          await this.repository.auditAndPublish(client, context, {
            action: 'sale.cancelled',
            resourceType: 'sale',
            resourceId: updated.id,
            eventType: 'sale.cancelled',
            version: updated.version,
            payload: salePayload(updated),
          });
          return updated;
        },
      ),
    );
  }
}

function salePayload(value: SaleRow): Readonly<Record<string, unknown>> {
  return {
    sale_id: value.id,
    branch_id: value.branchId,
    sale_number: value.saleNumber,
    status: value.status,
    currency_code: value.currencyCode,
    total: value.total,
    version: value.version.toString(),
  };
}

function decodeSale(raw: unknown): SaleRow {
  const value = raw as Omit<
    SaleRow,
    'version' | 'createdAt' | 'updatedAt' | 'occurredAt' | 'completedAt' | 'cancelledAt'
  > & {
    version: string;
    createdAt: string;
    updatedAt: string;
    occurredAt: string;
    completedAt: string | null;
    cancelledAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    occurredAt: new Date(value.occurredAt),
    completedAt: value.completedAt === null ? null : new Date(value.completedAt),
    cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt),
  };
}
function decodeSaleItem(raw: unknown): SaleItemRow {
  const value = raw as Omit<SaleItemRow, 'productVersion' | 'createdAt'> & {
    productVersion: string | null;
    createdAt: string;
  };
  return {
    ...value,
    productVersion: value.productVersion === null ? null : BigInt(value.productVersion),
    createdAt: new Date(value.createdAt),
  };
}
function decodeSaleWithItems(raw: unknown): { sale: SaleRow; items: SaleItemRow[] } {
  const value = raw as { sale: unknown; items: unknown[] };
  return { sale: decodeSale(value.sale), items: value.items.map(decodeSaleItem) };
}
