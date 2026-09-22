/**
 * TASK 14.3 (Wave 1, Part A) — the "Fiestas" recovery domain. See
 * `docs/LEGACY_FIESTAS_RECOVERY.md` (behavioral spec) and
 * `packages/database/src/schema/parties.ts` (the already-migrated schema
 * this module reads/writes — never modified here).
 */

export const partyRoomStatuses = ['active', 'maintenance', 'out_of_service'] as const;
export type PartyRoomStatus = (typeof partyRoomStatuses)[number];

export const partyPackageStatuses = ['active', 'inactive'] as const;
export type PartyPackageStatus = (typeof partyPackageStatuses)[number];

/** Legacy's exact 5-state machine (recovery doc Capability 1/13):
 * `held` (Apartada) -> `pending_deposit` -> `confirmed` -> `completed`;
 * `cancelled` is reachable from any non-terminal state. Never a
 * project-invented 6th state. */
export const partyReservationStatuses = [
  'held',
  'pending_deposit',
  'confirmed',
  'completed',
  'cancelled',
] as const;
export type PartyReservationStatus = (typeof partyReservationStatuses)[number];

/** The allowed forward edges of the status machine, keyed by the
 * *current* status. `cancelled` is terminal (no edges out); `completed`
 * is terminal. Any transition not listed here is rejected as
 * `invalid_reservation_state`. */
export const partyReservationTransitions: Readonly<Record<PartyReservationStatus, readonly PartyReservationStatus[]>> = {
  held: ['pending_deposit', 'confirmed', 'cancelled'],
  pending_deposit: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const partyAccountStatuses = ['open', 'closed'] as const;
export type PartyAccountStatus = (typeof partyAccountStatuses)[number];

export const partyReservationPaymentPurposes = ['deposit', 'balance', 'additional'] as const;
export type PartyReservationPaymentPurpose = (typeof partyReservationPaymentPurposes)[number];

export const partyDocumentTypes = ['waiver', 'contract'] as const;
export type PartyDocumentType = (typeof partyDocumentTypes)[number];

export const partySockDeductionStatuses = ['pending', 'deducted', 'not_applicable'] as const;
export type PartySockDeductionStatus = (typeof partySockDeductionStatuses)[number];

export interface PartyRoomRow {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  name: string;
  status: PartyRoomStatus;
  capacityChildren: number | null;
  capacityAdults: number | null;
  capacityTotal: number | null;
  color: string | null;
  notes: string | null;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export const partyPackageTaxCodes = ['IVA_GENERAL', 'IVA_EXEMPT'] as const;
export type PartyPackageTaxCode = (typeof partyPackageTaxCodes)[number];

/** TASK 16.20 (Part D4) — one planned consumable entry inside a package's
 * `includedConsumables` array. `productId`/`productVariantId` are honest
 * hints only: `createReservation` re-resolves a real inventory variant at
 * booking time rather than trusting a stale package-level snapshot (a
 * package's catalog linkage can change after the package was configured).
 */
export interface PartyPackageIncludedConsumable {
  kind: 'sock' | 'snack';
  label: string;
  quantity: number;
  productId?: string;
  // TASK 16.20A (Part 2) — an explicit variant choice for a product that
  // has more than one real variant (e.g. sock sizes modeled as
  // `product_variants`, not separate products). Omitted/`undefined`
  // falls back to the exact same "resolve the product's own default
  // variant" behavior TASK 16.20 already had — this is purely additive,
  // never a required field. Validated (at package save time) to
  // actually belong to `productId`, in this same company — never
  // trusted blindly (Part 2's own "no raw UUID entry, tenant-scoped"
  // requirement, enforced server-side, not just by the Flutter picker).
  productVariantId?: string;
  size?: string;
}

export interface PartyPackageRow {
  id: string;
  companyId: string;
  branchId: string | null;
  code: string;
  name: string;
  description: string | null;
  status: PartyPackageStatus;
  price: string;
  currencyCode: string;
  durationMinutes: number;
  childrenIncluded: number;
  adultsIncluded: number;
  childExtraCost: string;
  adultExtraCost: string;
  capacityMax: number | null;
  extraHalfHourCost: string;
  taxCode: PartyPackageTaxCode;
  includes: Readonly<Record<string, unknown>> | null;
  restrictions: Readonly<Record<string, unknown>> | null;
  includedConsumables: readonly PartyPackageIncludedConsumable[] | null;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface PartyReservationRow {
  id: string;
  companyId: string;
  branchId: string;
  reservationNumber: string;
  customerId: string | null;
  customerDisplayName: string | null;
  customerPhone: string | null;
  celebrantName: string | null;
  celebrantAge: number | null;
  roomId: string;
  packageId: string;
  roomNameSnapshot: string | null;
  packageNameSnapshot: string | null;
  eventDate: string;
  startTime: string;
  endTime: string;
  childrenCount: number;
  adultsCount: number;
  sellerUserId: string | null;
  status: PartyReservationStatus;
  accountStatus: PartyAccountStatus;
  subtotalAmount: string | null;
  discountTotal: string;
  taxTotal: string;
  couponId: string | null;
  couponCodeSnapshot: string | null;
  quotedTotal: string;
  currencyCode: string;
  notes: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdBy: string;
  updatedBy: string;
  version: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface PartyReservationSnackRow {
  id: string;
  companyId: string;
  reservationId: string;
  productId: string | null;
  nameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: string;
  lineTotal: string;
  taxSnapshot: Readonly<Record<string, unknown>> | null;
  taxTotal: string;
  productVariantId: string | null;
  stockDeducted: PartySockDeductionStatus;
  stockDeductedAt: Date | null;
  issuedQuantity: string | null;
  includedInPackage: boolean;
  createdAt: Date;
}

export interface PartyReservationSockRow {
  id: string;
  companyId: string;
  reservationId: string;
  size: string;
  quantity: number;
  productVariantId: string | null;
  stockDeducted: PartySockDeductionStatus;
  stockDeductedAt: Date | null;
  issuedQuantity: number | null;
  includedInPackage: boolean;
  createdAt: Date;
}

export interface PartyReservationPaymentRow {
  id: string;
  companyId: string;
  branchId: string;
  reservationId: string;
  cashMovementId: string;
  purpose: PartyReservationPaymentPurpose;
  amountSnapshot: string;
  createdBy: string;
  createdAt: Date;
}

export interface PartyReservationDocumentRow {
  id: string;
  companyId: string;
  reservationId: string;
  documentType: PartyDocumentType;
  generatedBy: string;
  generatedAt: Date;
}

export interface PartyMutationContext {
  companyId: string;
  actorId: string;
  requestId: string;
  correlationId: string;
  timestamp: Date;
  deviceId?: string | undefined;
}

export type PartyErrorCode =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'resource_not_found'
  | 'resource_conflict'
  | 'version_conflict'
  | 'party_conflict'
  | 'invalid_reservation_state'
  | 'insufficient_inventory'
  | 'inventory_location_not_found'
  // TASK 16.19
  | 'capacity_exceeded'
  | 'package_room_not_eligible'
  // TASK 16.20 (Part L1)
  | 'coupon_inactive'
  | 'coupon_min_subtotal_not_met'
  | 'coupon_usage_limit_reached';

export class PartyError extends Error {
  constructor(
    readonly code: PartyErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'PartyError';
  }
}
