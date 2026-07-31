export type InventoryReservationStatus =
  'active' | 'confirmed' | 'released' | 'expired' | 'cancelled';

export type InventoryReservationOwnerType = 'pos_cart' | 'event' | 'booking' | 'order';

export interface InventoryReservationLine {
  id: string;
  lineNumber: number;
  locationId: string;
  productVariantId: string;
  reservedQuantity: string;
  consumedQuantity: string;
  releasedQuantity: string;
  unitOfMeasureCode: string;
}

export interface InventoryReservation {
  id: string;
  companyId: string;
  branchId: string;
  reservationNumber: string;
  ownerType: InventoryReservationOwnerType;
  ownerId: string;
  status: InventoryReservationStatus;
  expiresAt: Date | null;
  confirmedAt: Date | null;
  releasedAt: Date | null;
  expiredAt: Date | null;
  cancelledAt: Date | null;
  createdBy: string;
  confirmedBy: string | null;
  releasedBy: string | null;
  expiredBy: string | null;
  cancelledBy: string | null;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
  confirmationMovementId: string | null;
  lines: readonly InventoryReservationLine[];
}

export type InventoryReservationErrorCode =
  | 'idempotency_conflict'
  | 'insufficient_inventory'
  | 'inventory_balance_conflict'
  | 'reservation_already_completed'
  | 'reservation_expired'
  | 'resource_not_found'
  | 'validation_error'
  | 'version_conflict';

export class InventoryReservationError extends Error {
  public constructor(
    public readonly code: InventoryReservationErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'InventoryReservationError';
  }
}
