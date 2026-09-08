/**
 * TASK 14.3 (Wave 1, Part C) — "Compra Directa" (direct purchase / quick
 * restock). See `packages/database/src/schema/purchasing.ts`'s own doc
 * comment for the full forensic-recovery rationale: this is the ONE
 * purchasing-domain feature the legacy parity audit confirmed was
 * genuinely end-to-end — a manager records newly-arrived, already-paid-
 * for stock immediately, with a real inventory movement backing it, never
 * a formal Purchase Order workflow (deliberately out of scope — see
 * `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Compras section).
 */

export interface DirectPurchaseRow {
  id: string;
  companyId: string;
  branchId: string;
  supplierName: string | null;
  productVariantId: string;
  quantity: string;
  unitCost: string;
  currencyCode: string;
  totalCost: string;
  purchaseDate: string;
  notes: string | null;
  inventoryMovementId: string;
  createdBy: string;
  createdAt: Date;
}

export interface CreateDirectPurchaseInput {
  id?: string;
  branchId: string;
  supplierName?: string | null;
  productVariantId: string;
  quantity: string;
  unitCost: string;
  currencyCode: string;
  purchaseDate: string;
  notes?: string | null;
}

export interface PurchaseMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

/** The linked inventory movement's own identity/status, plus (Part —
 * "ideally the resulting balance-after, if easily available") the current
 * on-hand balance for this exact variant/branch — a simple point-in-time
 * lookup, not a historical "balance as of this movement" reconstruction
 * (deliberately not over-engineered — see this module's own routes/
 * service doc comments). */
export interface DirectPurchaseMovementSummary {
  movementId: string;
  movementNumber: string;
  status: string;
  postedAt: Date | null;
  currentQuantityOnHand: string | null;
}

export type PurchaseErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'product_variant_not_found'
  | 'inventory_location_not_found';

export class PurchaseError extends Error {
  constructor(
    readonly code: PurchaseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseError';
  }
}
