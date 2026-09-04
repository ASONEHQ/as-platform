/** §21.2's exact 5-state machine — never a project-invented name. This
 * pass reaches `pending_payment`, `completed`, and `cancelled` only;
 * `draft` and `rejected` stay structurally valid but unexercised (see
 * ADR-0009 — creation lands directly in `pending_payment`, and a
 * validation failure throws cleanly with no row created rather than
 * persisting a `rejected` sale). */
export type SaleStatus = 'draft' | 'pending_payment' | 'completed' | 'cancelled' | 'rejected';
export const saleStatuses: readonly SaleStatus[] = [
  'draft',
  'pending_payment',
  'completed',
  'cancelled',
  'rejected',
];

export interface SaleRow {
  id: string;
  companyId: string;
  branchId: string;
  cashRegisterId: string | null;
  cashSessionId: string | null;
  deviceId: string | null;
  syncOperationId: string | null;
  saleNumber: string;
  status: SaleStatus;
  currencyCode: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  paidTotal: string;
  changeTotal: string;
  occurredAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  reasonCode: string | null;
  createdBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaleItemRow {
  id: string;
  companyId: string;
  branchId: string;
  saleId: string;
  lineNumber: number;
  productId: string | null;
  productVariantId: string | null;
  productVersion: bigint | null;
  skuSnapshot: string | null;
  nameSnapshot: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  lineTotal: string;
  taxSnapshot: Readonly<Record<string, unknown>> | null;
  createdAt: Date;
}

/** What Flutter's `SaleSession`/`SaleLine` can actually supply today
 * (`productId` + `quantity` — no variant, no price, no tax): the backend
 * independently resolves everything else. See ADR-0009 "Server money
 * authority." */
export interface CreateSaleLineInput {
  productId: string;
  quantity: string;
}

export interface CreateSaleInput {
  id?: string;
  branchId: string;
  /** Defaults to the first resolved line's own price currency when
   * omitted — every line must still agree (see ADR-0009). */
  currencyCode?: string;
  deviceId?: string;
  items: readonly CreateSaleLineInput[];
}

export interface SaleMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
}

export type SaleErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'version_conflict'
  | 'invalid_sale_state'
  | 'product_not_found'
  | 'product_not_active'
  | 'price_not_found'
  | 'currency_mismatch';

export class SaleError extends Error {
  constructor(
    readonly code: SaleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaleError';
  }
}
