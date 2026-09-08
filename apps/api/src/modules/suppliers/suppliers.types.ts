/**
 * TASK 14.4 (Wave 2, Part C.1) — real supplier records ("Proveedores"),
 * recovered from `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Compras/Proveedores
 * section — a real, if shallow, CRUD contact list in the legacy product
 * (unlike the legacy's own formal Purchase Order workflow — its own
 * `saveCompra()` discarded entered line items, so that workflow is
 * deliberately NOT rebuilt here; see
 * `packages/database/src/schema/purchasing.ts`'s own doc comment).
 *
 * Company-scoped ONLY, never branch-scoped — a supplier relationship is
 * with the business, not one physical location — see
 * `packages/database/src/schema/suppliers.ts`. Mirrors
 * `purchasing.types.ts`'s own shape file-for-file (this wave's assigned
 * template) wherever the two domains are structurally alike; diverges
 * only where the schema itself does (no branch dimension here at all, and
 * a real update/deactivate lifecycle a direct purchase never has).
 */

export const supplierStatuses = ['active', 'inactive'] as const;
export type SupplierStatus = (typeof supplierStatuses)[number];

export interface SupplierRow {
  id: string;
  companyId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: SupplierStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupplierInput {
  id?: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

/** Any field except `id`/`companyId` — per this wave's explicit
 * instruction. `status` is included here too (so a reactivation is just
 * `PATCH { status: 'active' }`); the dedicated `deactivate` action
 * (`SuppliersService.deactivateSupplier`) is a thin, deliberately
 * single-purpose convenience wrapper over the exact same underlying
 * update, never a second code path. */
export interface UpdateSupplierInput {
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  status?: SupplierStatus;
}

export interface SupplierMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

export interface SupplierListPage {
  items: readonly SupplierRow[];
  nextCursor: string | null;
}

export type SupplierErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'resource_conflict';

export class SupplierError extends Error {
  constructor(
    readonly code: SupplierErrorCode,
    message: string,
    /** A name-conflict error carries the existing supplier's id, mirroring
     * `CustomerError`'s own established `details` convention — never a
     * bare message the caller has to parse. */
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'SupplierError';
  }
}
