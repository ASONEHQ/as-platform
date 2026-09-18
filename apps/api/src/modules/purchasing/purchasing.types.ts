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
  /** TASK 14.4 (Wave 2, Part C.2) — an optional real link to a `suppliers`
   * row. `supplierName` remains the frozen, historical snapshot at
   * purchase time (mirrors `sales.customer_display_name`'s own
   * established precedent) — see `PurchasingService.recordDirectPurchase`'s
   * own doc comment for exactly when/how it is populated. */
  supplierId: string | null;
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
  /** The linked movement's `status` ('posted'/'reversed'/…) and
   * `movement_number`, populated only by `listDirectPurchases`'s own cheap
   * correlated-subquery lookup — so the Historial list can render a
   * "Reversada" badge without an N+1 round-trip per row. Both `null` for
   * `find`/`insert`, which attach a FULL `DirectPurchaseMovementSummary`
   * separately via `movementSummary()` instead (see
   * `purchasing.routes.ts`'s `directPurchaseHttp`). */
  movementStatus: string | null;
  movementNumber: string | null;
}

export interface CreateDirectPurchaseInput {
  id?: string;
  branchId: string;
  supplierName?: string | null;
  /** When provided, must resolve to a real, active, SAME-company supplier
   * — `supplierName` is then derived from that supplier's current real
   * name at write time and any client-supplied `supplierName` above is
   * ignored (see `PurchasingService.recordDirectPurchase`). Nullable/
   * optional — a purchase may still have no real supplier linked. */
  supplierId?: string | null;
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
  | 'inventory_location_not_found'
  // TASK 14.4 (Wave 2, Part C.2) — genuinely new semantic concept a
  // generic code cannot express: the caller linked a real supplierId that
  // resolves fine (same company) but is `status='inactive'`. A business
  // should not be able to record a NEW direct purchase against a supplier
  // it has already marked inactive — see `recordDirectPurchase`'s own doc
  // comment for the full reasoning. NOT YET a member of
  // `packages/errors`'s `InfrastructureErrorCode` union as of this wave —
  // see this module's own `purchasing.http-errors.ts` for the temporary
  // cast this requires until the orchestrator applies that central patch.
  | 'supplier_inactive';

export class PurchaseError extends Error {
  constructor(
    readonly code: PurchaseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseError';
  }
}
