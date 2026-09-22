import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { ProductTaxCode } from '@asone/database';

import type { CashRepository } from '../cash/cash.repository.js';
import { CashError } from '../cash/cash.types.js';
import { postPartySockDeduction } from './party-sock-deduction.js';
import {
  assertWithinCapacity,
  computeLineTax,
  computePartyQuote,
  formatMoney,
  isRoomEligibleForPackage,
  moneyUnits,
  nonBlank,
  nonNegativeInteger,
  nonNegativeMoney,
  positiveMoney,
  resolveSnackTaxCode,
} from './parties.pricing.js';
import type { PartiesRepository, ReservationListFilter } from './parties.repository.js';
import {
  PartyError,
  partyReservationTransitions,
  type PartyMutationContext,
  type PartyPackageRow,
  type PartyReservationDocumentRow,
  type PartyReservationPaymentPurpose,
  type PartyReservationPaymentRow,
  type PartyReservationRow,
  type PartyReservationSnackRow,
  type PartyReservationSockRow,
  type PartyReservationStatus,
  type PartyRoomRow,
} from './parties.types.js';

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function reservationNumberFor(id: string): string {
  return `PARTY-${id.replaceAll('-', '').toLowerCase()}`;
}
function reservationPayload(value: PartyReservationRow): Readonly<Record<string, unknown>> {
  return {
    reservation_id: value.id,
    branch_id: value.branchId,
    reservation_number: value.reservationNumber,
    status: value.status,
    room_id: value.roomId,
    event_date: value.eventDate,
    quoted_total: value.quotedTotal,
    version: value.version.toString(),
  };
}
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/u;
function normalizeTime(value: string, field: string): string {
  const match = TIME_PATTERN.exec(value);
  const [, hours, minutes, seconds] = match ?? [];
  if (hours === undefined || minutes === undefined)
    throw new PartyError('validation_error', `${field} must be a valid HH:MM[:SS] time.`);
  return `${hours}:${minutes}:${seconds ?? '00'}`;
}
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
function normalizeDate(value: string, field: string): string {
  if (!DATE_PATTERN.exec(value)) throw new PartyError('validation_error', `${field} must be a valid YYYY-MM-DD date.`);
  return value;
}

export interface PartyReservationDetail {
  reservation: PartyReservationRow;
  snacks: readonly PartyReservationSnackRow[];
  socks: readonly PartyReservationSockRow[];
  paymentsSummary: { totalPaid: string; count: number };
  documentsSummary: { count: number; lastGeneratedAt: string | null; lastDocumentType: string | null };
}

export class PartyReservationsService {
  public constructor(
    private readonly repository: PartiesRepository,
    private readonly cashRepository: CashRepository,
  ) {}

  // --- Create ----------------------------------------------------------------

  public async createReservation(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    input: {
      id?: string;
      branchId: string;
      customerId?: string;
      celebrantName?: string;
      celebrantAge?: number;
      roomId: string;
      packageId: string;
      eventDate: string;
      startTime: string;
      endTime: string;
      childrenCount?: number;
      adultsCount?: number;
      extraHalfHours?: number;
      sellerUserId?: string;
      notes?: string;
    },
  ): Promise<{ value: PartyReservationRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new PartyError('validation_error', 'The branch is not authorized for this actor.');
    const eventDate = normalizeDate(input.eventDate, 'event_date');
    const startTime = normalizeTime(input.startTime, 'start_time');
    const endTime = normalizeTime(input.endTime, 'end_time');
    if (endTime <= startTime) throw new PartyError('validation_error', 'end_time must be after start_time.');
    const childrenCount = nonNegativeInteger(input.childrenCount ?? 0, 'children_count');
    const adultsCount = nonNegativeInteger(input.adultsCount ?? 0, 'adults_count');
    const extraHalfHours = nonNegativeInteger(input.extraHalfHours ?? 0, 'extra_half_hours');
    const celebrantName = input.celebrantName === undefined ? null : nonBlank(input.celebrantName, 'celebrant_name', 200);
    const celebrantAge =
      input.celebrantAge === undefined ? null : nonNegativeInteger(input.celebrantAge, 'celebrant_age');
    const notes = input.notes === undefined ? null : nonBlank(input.notes, 'notes', 2000);
    const id = input.id ?? randomUUID();
    const requestHash = hash({
      branchId: input.branchId,
      customerId: input.customerId ?? null,
      roomId: input.roomId,
      packageId: input.packageId,
      eventDate,
      startTime,
      endTime,
      childrenCount,
      adultsCount,
      extraHalfHours,
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_reservation.create',
        key,
        requestHash,
        'party_reservation',
        decodeReservation,
        async () => {
          // Real party.room lookup, scoped to this exact branch — a
          // room/branch mismatch is an honest 404, never a raw FK
          // violation (recovery doc: rooms are branch-scoped entities).
          const room = await this.repository.lockRoom(client, context.companyId, input.roomId);
          if (room === null || room.branchId !== input.branchId)
            throw new PartyError('resource_not_found', 'The room was not found in this branch.');

          const pkg = await this.repository.packageRow(context.companyId, input.packageId);
          if (pkg === null || (pkg.branchId !== null && pkg.branchId !== input.branchId))
            throw new PartyError('resource_not_found', 'The package was not found for this branch.');
          if (!isRoomEligibleForPackage(pkg.restrictions, input.roomId))
            throw new PartyError('package_room_not_eligible', 'This package is not available in the selected room.');
          assertWithinCapacity({
            roomCapacityTotal: room.capacityTotal,
            roomCapacityChildren: room.capacityChildren,
            roomCapacityAdults: room.capacityAdults,
            packageCapacityMax: pkg.capacityMax,
            children: childrenCount,
            adults: adultsCount,
          });

          let customerDisplayName: string | null = null;
          let customerPhone: string | null = null;
          if (input.customerId !== undefined) {
            const customer = await this.repository.customerForSnapshot(context.companyId, input.customerId);
            if (customer === null) throw new PartyError('resource_not_found', 'The customer was not found.');
            customerDisplayName = customer.displayName;
            customerPhone = customer.phone;
          }

          await this.rejectRoomConflict(client, context.companyId, input.roomId, eventDate, startTime, endTime);

          const quote = computePartyQuote({
            price: pkg.price,
            childrenIncluded: pkg.childrenIncluded,
            adultsIncluded: pkg.adultsIncluded,
            childExtraCost: pkg.childExtraCost,
            adultExtraCost: pkg.adultExtraCost,
            extraHalfHourCost: pkg.extraHalfHourCost,
            children: childrenCount,
            adults: adultsCount,
            extraHalfHours,
            taxCode: pkg.taxCode,
          });

          const created = await this.repository.insertReservation(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            reservationNumber: reservationNumberFor(id),
            customerId: input.customerId ?? null,
            customerDisplayName,
            customerPhone,
            celebrantName,
            celebrantAge,
            roomId: input.roomId,
            packageId: input.packageId,
            roomNameSnapshot: room.name,
            packageNameSnapshot: pkg.name,
            eventDate,
            startTime,
            endTime,
            childrenCount,
            adultsCount,
            sellerUserId: input.sellerUserId ?? null,
            subtotalAmount: quote.subtotal,
            discountTotal: quote.discountTotal,
            taxTotal: quote.taxTotal,
            quotedTotal: quote.total,
            currencyCode: pkg.currencyCode,
            notes,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'party_reservation.created',
            resourceType: 'party_reservation',
            resourceId: created.id,
            eventType: 'party_reservation.created',
            branchId: created.branchId,
            version: created.version,
            payload: reservationPayload(created),
          });
          return created;
        },
      ),
    );
  }

  /** Race-free ONLY because the caller already holds `lockRoom`'s `FOR
   * UPDATE` on the same room, inside the same transaction (see
   * `parties.repository.ts`'s own doc comment on `lockRoom`). The real,
   * database-enforced `party_reservations_room_time_excl` GIST exclusion
   * constraint remains the last-line guarantee — a `23P01` raised by the
   * subsequent insert/update is translated to this exact same
   * `party_conflict` error by `PartiesRepository.mapDatabaseError`. */
  private async rejectRoomConflict(
    client: Parameters<PartiesRepository['overlappingReservations']>[0],
    companyId: string,
    roomId: string,
    eventDate: string,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ): Promise<void> {
    const conflicts = await this.repository.overlappingReservations(
      client,
      companyId,
      roomId,
      eventDate,
      startTime,
      endTime,
      excludeId,
    );
    const conflict = conflicts[0];
    if (conflict !== undefined)
      throw new PartyError(
        'party_conflict',
        `This room is already booked for an overlapping time on ${eventDate} (reservation ${conflict.reservationNumber}).`,
      );
  }

  // --- Read --------------------------------------------------------------------

  public async reservation(companyId: string, branchIds: readonly string[], id: string): Promise<PartyReservationRow> {
    const value = await this.repository.reservation(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new PartyError('resource_not_found', 'The reservation was not found.');
    return value;
  }

  public async reservationDetail(companyId: string, branchIds: readonly string[], id: string): Promise<PartyReservationDetail> {
    const reservationRow = await this.reservation(companyId, branchIds, id);
    const [snacks, socks, payments, documents] = await Promise.all([
      this.repository.listSnacks(companyId, reservationRow.id),
      this.repository.listSocks(companyId, reservationRow.id),
      this.repository.paymentsForReservation(companyId, reservationRow.id),
      this.repository.documentsSummary(companyId, reservationRow.id),
    ]);
    let paidUnits = 0n;
    for (const line of payments) paidUnits += moneyUnits(line.amountSnapshot);
    return {
      reservation: reservationRow,
      snacks,
      socks,
      paymentsSummary: { totalPaid: formatMoney(paidUnits), count: payments.length },
      documentsSummary: {
        count: documents.count,
        lastGeneratedAt: documents.lastGeneratedAt === null ? null : documents.lastGeneratedAt.toISOString(),
        lastDocumentType: documents.lastDocumentType,
      },
    };
  }

  public listReservations(
    companyId: string,
    branchIds: readonly string[],
    input: ReservationListFilter,
  ): ReturnType<PartiesRepository['listReservations']> {
    return this.repository.listReservations(companyId, branchIds, input);
  }

  public calendar(
    companyId: string,
    branchIds: readonly string[],
    input: ReservationListFilter,
  ): ReturnType<PartiesRepository['listReservations']> {
    return this.repository.listReservations(companyId, branchIds, input);
  }

  // --- Edit ----------------------------------------------------------------------

  public async updateReservation(
    context: PartyMutationContext,
    branchIds: readonly string[],
    id: string,
    expectedVersion: bigint,
    input: {
      customerId?: string | null;
      celebrantName?: string | null;
      celebrantAge?: number | null;
      roomId?: string;
      packageId?: string;
      eventDate?: string;
      startTime?: string;
      endTime?: string;
      childrenCount?: number;
      adultsCount?: number;
      extraHalfHours?: number;
      sellerUserId?: string | null;
      notes?: string | null;
    },
  ): Promise<PartyReservationRow> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockReservation(client, context.companyId, id);
      if (current === null || !branchIds.includes(current.branchId))
        throw new PartyError('resource_not_found', 'The reservation was not found.');
      if (current.status === 'completed' || current.status === 'cancelled')
        throw new PartyError('invalid_reservation_state', `A ${current.status} reservation cannot be edited.`);

      const roomId = input.roomId ?? current.roomId;
      const eventDate = input.eventDate === undefined ? current.eventDate : normalizeDate(input.eventDate, 'event_date');
      const startTime = input.startTime === undefined ? current.startTime : normalizeTime(input.startTime, 'start_time');
      const endTime = input.endTime === undefined ? current.endTime : normalizeTime(input.endTime, 'end_time');
      if (endTime <= startTime) throw new PartyError('validation_error', 'end_time must be after start_time.');

      const roomOrTimeChanged =
        roomId !== current.roomId || eventDate !== current.eventDate || startTime !== current.startTime || endTime !== current.endTime;
      const roomChanged = roomId !== current.roomId;
      let room: PartyRoomRow | null = null;
      if (roomOrTimeChanged) {
        room = await this.repository.lockRoom(client, context.companyId, roomId);
        if (room === null || room.branchId !== current.branchId)
          throw new PartyError('resource_not_found', 'The room was not found in this branch.');
        await this.rejectRoomConflict(client, context.companyId, roomId, eventDate, startTime, endTime, current.id);
      }

      let customerId: string | null | undefined;
      let customerDisplayName: string | null | undefined;
      let customerPhone: string | null | undefined;
      if (input.customerId !== undefined) {
        if (input.customerId === null) {
          customerId = null;
          customerDisplayName = null;
          customerPhone = null;
        } else {
          const customer = await this.repository.customerForSnapshot(context.companyId, input.customerId);
          if (customer === null) throw new PartyError('resource_not_found', 'The customer was not found.');
          customerId = input.customerId;
          customerDisplayName = customer.displayName;
          customerPhone = customer.phone;
        }
      }

      const requestedPackageId = input.packageId;
      const packageChanged = requestedPackageId !== undefined && requestedPackageId !== current.packageId;
      let pkg: PartyPackageRow | null = null;
      if (requestedPackageId !== undefined && packageChanged) {
        pkg = await this.repository.packageRow(context.companyId, requestedPackageId);
        if (pkg === null || (pkg.branchId !== null && pkg.branchId !== current.branchId))
          throw new PartyError('resource_not_found', 'The package was not found for this branch.');
      }

      const childrenCount = input.childrenCount === undefined ? current.childrenCount : nonNegativeInteger(input.childrenCount, 'children_count');
      // TASK 16.19 — before this task `adultsCount` was never persisted,
      // so an edit that didn't explicitly resend it had no real "current"
      // value to fall back to and silently recomputed the quote as if
      // adults=0. Now mirrors `childrenCount`'s own established fallback
      // exactly.
      const adultsCount = input.adultsCount === undefined ? current.adultsCount : nonNegativeInteger(input.adultsCount, 'adults_count');
      const recomputeQuote =
        packageChanged || input.childrenCount !== undefined || input.adultsCount !== undefined || input.extraHalfHours !== undefined;
      let quotedTotal: string | undefined;
      let subtotalAmount: string | undefined;
      let discountTotal: string | undefined;
      let taxTotal: string | undefined;
      let quotePackageForCapacity: PartyPackageRow | null = pkg;
      if (recomputeQuote) {
        const quotePackage = pkg ?? (await this.repository.packageRow(context.companyId, current.packageId));
        if (quotePackage === null) throw new PartyError('resource_not_found', 'The package was not found.');
        quotePackageForCapacity = quotePackage;
        const quote = computePartyQuote({
          price: quotePackage.price,
          childrenIncluded: quotePackage.childrenIncluded,
          adultsIncluded: quotePackage.adultsIncluded,
          childExtraCost: quotePackage.childExtraCost,
          adultExtraCost: quotePackage.adultExtraCost,
          extraHalfHourCost: quotePackage.extraHalfHourCost,
          children: childrenCount,
          adults: adultsCount,
          extraHalfHours: input.extraHalfHours === undefined ? 0 : nonNegativeInteger(input.extraHalfHours, 'extra_half_hours'),
          taxCode: quotePackage.taxCode,
        });
        quotedTotal = quote.total;
        subtotalAmount = quote.subtotal;
        discountTotal = quote.discountTotal;
        taxTotal = quote.taxTotal;
      }

      // TASK 16.19 — re-enforce capacity/eligibility on ANY edit that
      // changes what would be checked at creation time: a new room, a new
      // package, or a changed guest count against the (possibly unchanged)
      // room/package. Reads whichever room/package row is already in hand
      // from the checks above rather than re-fetching redundantly.
      if (roomOrTimeChanged || packageChanged || input.childrenCount !== undefined || input.adultsCount !== undefined) {
        const capacityRoom = room ?? (await this.repository.room(context.companyId, roomId));
        if (capacityRoom === null) throw new PartyError('resource_not_found', 'The room was not found.');
        const capacityPackage =
          quotePackageForCapacity ?? (await this.repository.packageRow(context.companyId, current.packageId));
        if (capacityPackage === null) throw new PartyError('resource_not_found', 'The package was not found.');
        if (roomChanged && !isRoomEligibleForPackage(capacityPackage.restrictions, roomId))
          throw new PartyError('package_room_not_eligible', 'This package is not available in the selected room.');
        assertWithinCapacity({
          roomCapacityTotal: capacityRoom.capacityTotal,
          roomCapacityChildren: capacityRoom.capacityChildren,
          roomCapacityAdults: capacityRoom.capacityAdults,
          packageCapacityMax: capacityPackage.capacityMax,
          children: childrenCount,
          adults: adultsCount,
        });
      }

      const updated = await this.repository.updateReservation(client, context.companyId, id, expectedVersion, {
        ...(customerId === undefined ? {} : { customerId }),
        ...(customerDisplayName === undefined ? {} : { customerDisplayName }),
        ...(customerPhone === undefined ? {} : { customerPhone }),
        ...(input.celebrantName === undefined ? {} : { celebrantName: input.celebrantName }),
        ...(input.celebrantAge === undefined
          ? {}
          : { celebrantAge: input.celebrantAge === null ? null : nonNegativeInteger(input.celebrantAge, 'celebrant_age') }),
        ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
        ...(room === null ? {} : { roomNameSnapshot: room.name }),
        ...(input.packageId === undefined ? {} : { packageId: input.packageId }),
        ...(pkg === null ? {} : { packageNameSnapshot: pkg.name }),
        ...(input.eventDate === undefined ? {} : { eventDate }),
        ...(input.startTime === undefined ? {} : { startTime }),
        ...(input.endTime === undefined ? {} : { endTime }),
        ...(input.childrenCount === undefined ? {} : { childrenCount }),
        ...(input.adultsCount === undefined ? {} : { adultsCount }),
        ...(input.sellerUserId === undefined ? {} : { sellerUserId: input.sellerUserId }),
        ...(subtotalAmount === undefined ? {} : { subtotalAmount }),
        ...(discountTotal === undefined ? {} : { discountTotal }),
        ...(taxTotal === undefined ? {} : { taxTotal }),
        ...(quotedTotal === undefined ? {} : { quotedTotal }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'party_reservation.updated',
        resourceType: 'party_reservation',
        resourceId: updated.id,
        eventType: 'party_reservation.updated',
        branchId: updated.branchId,
        version: updated.version,
        payload: reservationPayload(updated),
      });
      return updated;
    });
  }

  // --- Status transitions --------------------------------------------------------

  public async transitionStatus(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    expectedVersion: bigint,
    status: PartyReservationStatus,
  ): Promise<{ value: PartyReservationRow; replayed: boolean }> {
    const requestHash = hash({ id, expectedVersion: expectedVersion.toString(), status });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_reservation.status_transition',
        key,
        requestHash,
        'party_reservation',
        decodeReservation,
        async () => {
          const current = await this.repository.lockReservation(client, context.companyId, id);
          if (current === null || !branchIds.includes(current.branchId))
            throw new PartyError('resource_not_found', 'The reservation was not found.');
          if (status === 'cancelled')
            throw new PartyError(
              'invalid_reservation_state',
              'Use POST /party-reservations/{id}/cancellations to cancel a reservation.',
            );
          const allowed = partyReservationTransitions[current.status];
          if (!allowed.includes(status))
            throw new PartyError(
              'invalid_reservation_state',
              `Cannot transition a reservation from "${current.status}" to "${status}".`,
            );
          const updated = await this.repository.transitionStatus(client, context.companyId, id, expectedVersion, status, {
            updatedBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'party_reservation.status_changed',
            resourceType: 'party_reservation',
            resourceId: updated.id,
            eventType: 'party_reservation.status_changed',
            branchId: updated.branchId,
            version: updated.version,
            payload: { ...reservationPayload(updated), previous_status: current.status },
          });
          return updated;
        },
      ),
    );
  }

  // --- Cancel ----------------------------------------------------------------------

  public async cancelReservation(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    expectedVersion: bigint,
    input: { reasonCode: string },
  ): Promise<{ value: { reservation: PartyReservationRow; hasPriorPayments: boolean; totalPaid: string }; replayed: boolean }> {
    const reasonCode = nonBlank(input.reasonCode, 'reason_code', 200);
    const requestHash = hash({ id, expectedVersion: expectedVersion.toString(), reasonCode });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_reservation.cancel',
        key,
        requestHash,
        'party_reservation',
        decodeCancelResult,
        async () => {
          const current = await this.repository.lockReservation(client, context.companyId, id);
          if (current === null || !branchIds.includes(current.branchId))
            throw new PartyError('resource_not_found', 'The reservation was not found.');
          if (current.status === 'completed' || current.status === 'cancelled')
            throw new PartyError('invalid_reservation_state', `A ${current.status} reservation cannot be cancelled.`);

          // Recovery doc Capability 8: the legacy product never had
          // refund-on-cancellation logic at all — this is an HONEST
          // surface of "prior payments exist," never an automatic
          // refund/cash-out. A manager handles any actual refund
          // separately via the real `POST /cash-sessions/{id}/movements`
          // (`cash_out`) endpoint.
          const payments = await this.repository.paymentsForReservation(context.companyId, current.id);
          let paidUnits = 0n;
          for (const line of payments) paidUnits += moneyUnits(line.amountSnapshot);
          const totalPaid = formatMoney(paidUnits);
          const hasPriorPayments = paidUnits > 0n;

          const cancelled = await this.repository.cancelReservation(client, context.companyId, id, expectedVersion, {
            cancelledBy: context.actorId,
            cancelledAt: context.timestamp,
            cancellationReason: reasonCode,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'party_reservation.cancelled',
            resourceType: 'party_reservation',
            resourceId: cancelled.id,
            eventType: 'party_reservation.cancelled',
            branchId: cancelled.branchId,
            version: cancelled.version,
            payload: { ...reservationPayload(cancelled), cancellation_reason: reasonCode, has_prior_payments: hasPriorPayments, total_paid: totalPaid },
          });
          return { id: cancelled.id, reservation: cancelled, hasPriorPayments, totalPaid };
        },
      ),
    );
  }

  // --- Snacks ------------------------------------------------------------------------

  public async addSnack(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    input: { productId?: string; nameSnapshot?: string; unitPriceSnapshot?: string; quantity: string },
  ): Promise<PartyReservationSnackRow> {
    return this.repository.transaction(async (client) => {
      const reservationRow = await this.reservation(context.companyId, branchIds, reservationId);
      let nameSnapshot: string;
      let unitPriceSnapshot: string;
      let productTaxCode: ProductTaxCode | null = null;
      if (input.productId !== undefined) {
        const product = await this.repository.productForSnapshot(context.companyId, input.productId);
        if (product === null) throw new PartyError('resource_not_found', 'The product was not found.');
        nameSnapshot = product.name;
        unitPriceSnapshot = nonNegativeMoney(product.price, 'unit_price_snapshot');
        productTaxCode = product.taxCode as ProductTaxCode;
      } else {
        if (input.nameSnapshot === undefined || input.unitPriceSnapshot === undefined)
          throw new PartyError('validation_error', 'name_snapshot and unit_price_snapshot are required for a custom snack.');
        nameSnapshot = nonBlank(input.nameSnapshot, 'name_snapshot', 200);
        unitPriceSnapshot = nonNegativeMoney(input.unitPriceSnapshot, 'unit_price_snapshot');
      }
      const quantityMatch = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.exec(input.quantity);
      if (quantityMatch === null || Number(input.quantity) <= 0)
        throw new PartyError('validation_error', 'quantity must be a positive decimal.');
      const subtotalUnits = (moneyUnits(unitPriceSnapshot) * BigInt(Math.round(Number(input.quantity) * 1_000_000))) / 1_000_000n;
      // TASK 16.19 — a snack line is taxed like any other sellable line
      // (see `party_reservation_snacks.tax_snapshot`'s own doc comment):
      // the linked product's own real tax code, or this reservation's own
      // package tax code as the honest default for a custom, catalog-less
      // snack — resolved from the reservation's package here rather than
      // trusting a client-submitted rate.
      const pkg = await this.repository.packageRow(context.companyId, reservationRow.packageId);
      if (pkg === null) throw new PartyError('resource_not_found', 'The package was not found.');
      const taxCode = resolveSnackTaxCode(productTaxCode, pkg.taxCode);
      const { taxTotal, taxSnapshot } = computeLineTax(unitPriceSnapshot, input.quantity, taxCode);
      const lineTotalUnits = subtotalUnits + moneyUnits(taxTotal);
      const created = await this.repository.insertSnack(client, {
        id: randomUUID(),
        companyId: context.companyId,
        reservationId: reservationRow.id,
        productId: input.productId ?? null,
        nameSnapshot,
        unitPriceSnapshot,
        quantity: input.quantity,
        lineTotal: formatMoney(lineTotalUnits),
        taxSnapshot,
        taxTotal,
        timestamp: context.timestamp,
      });
      await this.repository.audit(client, context, {
        action: 'party_reservation.snack_added',
        resourceType: 'party_reservation_snack',
        resourceId: created.id,
        payload: { reservation_id: reservationRow.id, name_snapshot: created.nameSnapshot, line_total: created.lineTotal },
      });
      return created;
    });
  }

  public async listSnacks(companyId: string, branchIds: readonly string[], reservationId: string): Promise<readonly PartyReservationSnackRow[]> {
    await this.reservation(companyId, branchIds, reservationId);
    return this.repository.listSnacks(companyId, reservationId);
  }

  // --- Socks -------------------------------------------------------------------------

  public async addSock(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    input: { size: string; quantity: number; productVariantId?: string },
  ): Promise<PartyReservationSockRow> {
    return this.repository.transaction(async (client) => {
      const reservationRow = await this.reservation(context.companyId, branchIds, reservationId);
      const size = nonBlank(input.size, 'size', 20);
      const quantity = nonNegativeInteger(input.quantity, 'quantity');
      if (quantity <= 0) throw new PartyError('validation_error', 'quantity must be greater than zero.');
      const created = await this.repository.insertSock(client, {
        id: randomUUID(),
        companyId: context.companyId,
        reservationId: reservationRow.id,
        size,
        quantity,
        productVariantId: input.productVariantId ?? null,
        timestamp: context.timestamp,
      });
      await this.repository.audit(client, context, {
        action: 'party_reservation.sock_added',
        resourceType: 'party_reservation_sock',
        resourceId: created.id,
        payload: { reservation_id: reservationRow.id, size: created.size, quantity: created.quantity },
      });
      return created;
    });
  }

  public async listSocks(companyId: string, branchIds: readonly string[], reservationId: string): Promise<readonly PartyReservationSockRow[]> {
    await this.reservation(companyId, branchIds, reservationId);
    return this.repository.listSocks(companyId, reservationId);
  }

  /** Recovery doc Capability 11 — real, one-way, guarded stock deduction
   * (mirrors legacy `descontarCalcetasFiesta()`'s "ya fueron descontadas"
   * guard, done for real this time). Idempotent via the row lock: only a
   * sock row still `stockDeducted='pending'` (checked AFTER the lock is
   * held, so a concurrent double-call serializes and the loser sees
   * `'deducted'` and is rejected) is ever posted. */
  public async deductSock(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    sockId: string,
  ): Promise<PartyReservationSockRow> {
    return this.repository.transaction(async (client) => {
      const reservationRow = await this.reservation(context.companyId, branchIds, reservationId);
      const sockRow = await this.repository.lockSock(client, context.companyId, reservationRow.id, sockId);
      if (sockRow === null) throw new PartyError('resource_not_found', 'The sock line was not found.');
      if (sockRow.productVariantId === null)
        throw new PartyError('validation_error', 'This sock line has no inventory variant to deduct.');
      if (sockRow.stockDeducted === 'not_applicable')
        throw new PartyError('resource_conflict', 'This sock line is not stock-tracked.');
      if (sockRow.stockDeducted === 'deducted')
        throw new PartyError('resource_conflict', 'This sock line was already deducted.');

      await postPartySockDeduction(
        client,
        { companyId: context.companyId, actorId: context.actorId, correlationId: context.correlationId, timestamp: context.timestamp },
        { id: reservationRow.id, branchId: reservationRow.branchId, reservationNumber: reservationRow.reservationNumber },
        { id: sockRow.id, productVariantId: sockRow.productVariantId, quantity: sockRow.quantity, size: sockRow.size },
      );
      const updated = await this.repository.markSockDeducted(client, context.companyId, sockRow.id, context.timestamp);
      return updated;
    });
  }

  // --- Payments / balance --------------------------------------------------------------

  public async recordPayment(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    reservationId: string,
    input: { purpose: PartyReservationPaymentPurpose; amount: string; cashSessionId: string },
  ): Promise<{ value: PartyReservationPaymentRow; replayed: boolean }> {
    const amount = positiveMoney(input.amount, 'amount');
    const requestHash = hash({ reservationId, purpose: input.purpose, amount, cashSessionId: input.cashSessionId });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_reservation_payment.create',
        key,
        requestHash,
        'party_reservation_payment',
        decodePayment,
        async () => {
          const reservationRow = await this.repository.lockReservation(client, context.companyId, reservationId);
          if (reservationRow === null || !branchIds.includes(reservationRow.branchId))
            throw new PartyError('resource_not_found', 'The reservation was not found.');
          if (reservationRow.status === 'cancelled')
            throw new PartyError('invalid_reservation_state', 'A cancelled reservation cannot receive a payment.');

          // Mirrors `PaymentService`/`RefundsService`'s own established
          // pattern for posting a cash movement inside ANOTHER module's
          // transaction: `CashService.createMovement` cannot be called
          // here directly (it opens its OWN separate connection/
          // transaction and has no `reference_type`/`reference_id`
          // parameters at all), which would both break atomicity with the
          // `party_reservation_payments` insert below AND silently drop
          // the reference — so this validates the session exactly the
          // way `CashService.createMovement` itself does (locked, right
          // branch, `open`), then calls the SAME real, already-proven
          // `CashRepository.insertMovement` primitive every cash-in/out
          // ultimately posts through, inside this shared transaction.
          // This is the ONLY money-movement logic in this whole module
          // (see the task's own explicit instruction) — `cash_in` +
          // `reference_type='party_reservation'` mirrors the thin-link
          // pattern `cash_sale`/`cash_refund` already established.
          const sessionRow = await this.cashRepository.lockSession(client, context.companyId, input.cashSessionId);
          if (sessionRow?.branchId !== reservationRow.branchId)
            throw new CashError('resource_not_found', 'The session was not found.');
          if (sessionRow.status !== 'open') throw new CashError('cash_session_closed', 'The session is not open.');
          const movement = await this.cashRepository.insertMovement(client, {
            id: randomUUID(),
            companyId: context.companyId,
            branchId: reservationRow.branchId,
            cashSessionId: sessionRow.id,
            movementType: 'cash_in',
            amount,
            currencyCode: sessionRow.currencyCode,
            reasonCode: `party_${input.purpose}`,
            note: reservationRow.reservationNumber,
            referenceType: 'party_reservation',
            referenceId: reservationRow.id,
            occurredAt: context.timestamp,
            createdBy: context.actorId,
            deviceId: context.deviceId ?? null,
          });

          const created = await this.repository.insertPayment(client, {
            id: randomUUID(),
            companyId: context.companyId,
            branchId: reservationRow.branchId,
            reservationId: reservationRow.id,
            cashMovementId: movement.id,
            purpose: input.purpose,
            amountSnapshot: amount,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.audit(client, context, {
            action: 'party_reservation.payment_recorded',
            resourceType: 'party_reservation_payment',
            resourceId: created.id,
            payload: {
              reservation_id: reservationRow.id,
              cash_movement_id: movement.id,
              purpose: created.purpose,
              amount: created.amountSnapshot,
            },
          });
          return created;
        },
      ),
    );
  }

  public async balance(
    companyId: string,
    branchIds: readonly string[],
    reservationId: string,
  ): Promise<{
    subtotalAmount: string | null;
    discountTotal: string;
    taxTotal: string;
    quotedTotal: string;
    totalPaid: string;
    outstandingBalance: string;
  }> {
    const reservationRow = await this.reservation(companyId, branchIds, reservationId);
    const payments = await this.repository.paymentsForReservation(companyId, reservationRow.id);
    let paidUnits = 0n;
    for (const line of payments) paidUnits += moneyUnits(line.amountSnapshot);
    const totalUnits = moneyUnits(reservationRow.quotedTotal);
    return {
      subtotalAmount: reservationRow.subtotalAmount,
      discountTotal: reservationRow.discountTotal,
      taxTotal: reservationRow.taxTotal,
      quotedTotal: reservationRow.quotedTotal,
      totalPaid: formatMoney(paidUnits),
      outstandingBalance: formatMoney(totalUnits - paidUnits),
    };
  }

  // --- Documents -----------------------------------------------------------------------

  public async generateDocument(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    documentType: 'waiver' | 'contract',
  ): Promise<{ html: string; document: PartyReservationDocumentRow }> {
    const reservationRow = await this.reservation(context.companyId, branchIds, reservationId);
    const [pkg, room, organization] = await Promise.all([
      this.repository.packageRow(context.companyId, reservationRow.packageId),
      this.repository.room(context.companyId, reservationRow.roomId),
      this.repository.organizationForReservation(context.companyId, reservationRow.id),
    ]);
    const document = await this.repository.transaction((client) =>
      this.repository.insertDocumentAudit(client, {
        id: randomUUID(),
        companyId: context.companyId,
        reservationId: reservationRow.id,
        documentType,
        generatedBy: context.actorId,
        timestamp: context.timestamp,
      }),
    );
    const html = renderPartyDocumentHtml(documentType, reservationRow, pkg, room, organization);
    return { html, document };
  }
}

function decodeReservation(raw: unknown): PartyReservationRow {
  const value = raw as Omit<PartyReservationRow, 'version' | 'createdAt' | 'updatedAt' | 'cancelledAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
    cancelledAt: string | null;
  };
  return {
    ...value,
    version: BigInt(value.version),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt),
  };
}
function decodeCancelResult(raw: unknown): { id: string; reservation: PartyReservationRow; hasPriorPayments: boolean; totalPaid: string } {
  const value = raw as { id: string; reservation: unknown; hasPriorPayments: boolean; totalPaid: string };
  return { ...value, reservation: decodeReservation(value.reservation) };
}
function decodePayment(raw: unknown): PartyReservationPaymentRow {
  const value = raw as Omit<PartyReservationPaymentRow, 'createdAt'> & { createdAt: string };
  return { ...value, createdAt: new Date(value.createdAt) };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Recovery doc Capability 9 — a real, printable HTML document (mirrors
 * the legacy's own `generarHtmlCaratulaFiesta()`/`generarHtmlContratoFiesta()`
 * in spirit: real reservation data interpolated into a real template) —
 * NEVER stored (see `party_reservation_documents`' own doc comment: this
 * is regenerated fresh on every call, exactly like `GET /sales/{id}/receipt`
 * never stores a rendered receipt). Uses whatever company/branch
 * letterhead data is actually available — nothing park-specific is
 * hardcoded.
 *
 * TASK 16.19 — two changes from the TASK 14.3 original:
 *  1. Spanish copy (Phase 37: "Use Spanish customer-facing copy") — the
 *     original template was English, which no real Spanish-speaking
 *     tenant (the whole reason this domain exists) could actually hand a
 *     customer.
 *  2. Room/package NAME now prefers the reservation's own frozen
 *     `roomNameSnapshot`/`packageNameSnapshot` (falling back to the live
 *     `room`/`pkg` join only for a reservation booked before that
 *     snapshot existed) — closes the "an already-issued contract must
 *     not silently mutate" requirement TASK 14.3 did not yet satisfy (a
 *     room rename or package edit used to silently change the text of
 *     every past reservation's contract).
 *  The 15-clause legacy contract (`docs/LEGACY_FUNCTIONAL_PARITY.md`'s
 *  TASK 16.19 section has the full forensic inventory) is intentionally
 *  NOT reproduced verbatim here — it is Querétaro-jurisdiction,
 *  INFLAPARK-shaped legal boilerplate, and this file must stay tenant-
 *  neutral (this task's own absolute constraint: never hardcode a
 *  tenant's own legal text into shared code). The clause set below is a
 *  genuinely generic, real set of party-venue service terms, still
 *  honest about what this system does and does not do (Phase 22: no
 *  e-signature claim). A tenant needing its own jurisdiction-specific
 *  legal text is a disclosed follow-up (no "edit my contract terms"
 *  admin surface exists yet — see this task's final report). */
function renderPartyDocumentHtml(
  documentType: 'waiver' | 'contract',
  reservation: PartyReservationRow,
  pkg: PartyPackageRow | null,
  room: PartyRoomRow | null,
  organization: { companyName: string; branchName: string; branchAddress: Readonly<Record<string, unknown>> | null } | null,
): string {
  const title = documentType === 'contract' ? 'Contrato de Prestación de Servicios' : 'Deslinde de Responsabilidad';
  const businessName = organization === null ? 'Negocio' : organization.companyName;
  const branchName = organization === null ? '' : organization.branchName;
  const customerName = reservation.customerDisplayName ?? 'Cliente de mostrador';
  const celebrant = reservation.celebrantName ?? 'N/D';
  const roomName = reservation.roomNameSnapshot ?? room?.name ?? 'N/D';
  const packageName = reservation.packageNameSnapshot ?? pkg?.name ?? 'N/D';
  const clauses =
    documentType === 'contract'
      ? [
          'El cliente acepta la fecha, horario, salón y paquete del evento descritos en este documento.',
          'Un anticipo asegura la reservación; el saldo restante debe liquidarse a más tardar el día del evento.',
          'Las cancelaciones se rigen por la política de cancelación de este negocio; cualquier reembolso de cantidades ya pagadas lo autoriza y gestiona un responsable del negocio de forma manual, nunca automática.',
          'El negocio no se hace responsable de objetos personales perdidos o dañados durante el evento.',
          'Invitados adicionales, refrigerios o extras no incluidos en el paquete descrito se cobran como cargos adicionales al momento del servicio.',
          'El número de invitados no debe exceder el aforo autorizado para el salón y paquete reservados.',
        ]
      : [
          'El firmante reconoce los riesgos inherentes a las actividades del área de juegos/eventos para todos los asistentes.',
          'El firmante libera al negocio de responsabilidad por lesiones derivadas del uso ordinario de las instalaciones, salvo negligencia grave del negocio.',
          'El firmante se compromete a que todos los asistentes seguirán las reglas de seguridad publicadas y las instrucciones del personal en todo momento.',
        ];
  const clauseItems = clauses.map((clause) => `<li>${escapeHtml(clause)}</li>`).join('');
  const money = (value: string) => `${escapeHtml(reservation.currencyCode)} ${escapeHtml(value)}`;
  const breakdownRows =
    documentType === 'contract' && reservation.subtotalAmount !== null
      ? `<tr><th>Subtotal</th><td>${money(reservation.subtotalAmount)}</td><th>Impuestos</th><td>${money(reservation.taxTotal)}</td></tr>`
      : '';
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${escapeHtml(title)} - ${escapeHtml(reservation.reservationNumber)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:2rem;color:#111;}
h1{font-size:1.4rem;margin-bottom:0;}
h2{font-size:1rem;color:#555;margin-top:0;}
table{width:100%;border-collapse:collapse;margin:1rem 0;}
td,th{border:1px solid #ccc;padding:0.4rem 0.6rem;text-align:left;font-size:0.9rem;}
ol{font-size:0.85rem;line-height:1.4;}
.total{font-weight:bold;font-size:1.1rem;}
</style>
</head>
<body>
<h1>${escapeHtml(businessName)}</h1>
<h2>${escapeHtml(branchName)}</h2>
<h2>${escapeHtml(title)} - Reservación ${escapeHtml(reservation.reservationNumber)}</h2>
<table>
<tr><th>Cliente</th><td>${escapeHtml(customerName)}</td><th>Festejado(a)</th><td>${escapeHtml(celebrant)}${
    reservation.celebrantAge === null ? '' : ` (${String(reservation.celebrantAge)} años)`
  }</td></tr>
<tr><th>Fecha del evento</th><td>${escapeHtml(reservation.eventDate)}</td><th>Horario</th><td>${escapeHtml(reservation.startTime)} - ${escapeHtml(reservation.endTime)}</td></tr>
<tr><th>Salón</th><td>${escapeHtml(roomName)}</td><th>Paquete</th><td>${escapeHtml(packageName)}</td></tr>
<tr><th>Niños</th><td>${String(reservation.childrenCount)}</td><th>Adultos</th><td>${String(reservation.adultsCount)}</td></tr>
${breakdownRows}
<tr><th colspan="1">Total</th><td class="total" colspan="3">${money(reservation.quotedTotal)}</td></tr>
</table>
${reservation.notes === null ? '' : `<p><strong>Notas:</strong> ${escapeHtml(reservation.notes)}</p>`}
<ol>${clauseItems}</ol>
<p>Generado el ${new Date().toISOString()}</p>
</body>
</html>`;
}
