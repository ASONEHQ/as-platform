import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { ivaBasisPointsForTaxCode, type ProductTaxCode } from '@asone/database';

import type { CashRepository } from '../cash/cash.repository.js';
import { CashError } from '../cash/cash.types.js';
import { postPartySnackCorrection, postPartySnackDeduction } from './party-snack-deduction.js';
import { postPartySockCorrection, postPartySockDeduction } from './party-sock-deduction.js';
import {
  assertWithinCapacity,
  capacityViolation,
  computeEndTime,
  computeLineTax,
  computePartyQuote,
  formatMoney,
  isRoomEligibleForPackage,
  moneyUnits,
  nonBlank,
  nonNegativeInteger,
  nonNegativeMoney,
  parseQuantityUnits,
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

/** TASK 16.20A — exact BigInt fixed-point QUANTITY arithmetic (scale
 * 1_000_000n, matching `inventory_balances`/`party_reservation_snacks.
 * quantity` exactly — see `party-snack-deduction.ts`'s own identical
 * module-local copy), used only to compute a correction's signed delta
 * as a decimal string. A module-local copy, matching this codebase's
 * own established "no cross-module pricing/quantity-math import"
 * discipline (`parties.pricing.ts`'s own header comment). */
const QUANTITY_SCALE = 1_000_000n;
function decimalQuantityUnits(value: string): bigint {
  const [whole = '', fraction = ''] = value.split('.');
  const wholeDigits = whole.length === 0 ? '0' : whole;
  const fractionDigits = fraction.padEnd(6, '0').slice(0, 6);
  return BigInt(wholeDigits) * QUANTITY_SCALE + BigInt(fractionDigits.length === 0 ? '0' : fractionDigits);
}
function formatDecimalQuantity(units: bigint): string {
  const whole = units / QUANTITY_SCALE;
  const fraction = (units % QUANTITY_SCALE).toString().padStart(6, '0');
  return `${whole.toString()}.${fraction}`;
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
          // TASK 16.20 (Part D4/E) — auto-populate the PLANNED
          // socks/snacks from the package's own `includedConsumables`, at
          // booking time, inside this exact same transaction. This never
          // moves inventory by itself — `insertSock`/`insertSnack` only
          // ever write a `pending`/`not_applicable` row; the one real
          // consumption moment is the operator's later explicit
          // `deductSock`/`deductSnack` call. A reservation/quote must
          // never consume stock merely by existing (Part D3).
          if (pkg.includedConsumables !== null) {
            for (const entry of pkg.includedConsumables) {
              if (entry.quantity <= 0) continue;
              if (entry.kind === 'sock') {
                const variant = await this.resolveConsumableVariant(context.companyId, entry.productId, entry.productVariantId);
                await this.repository.insertSock(client, {
                  id: randomUUID(),
                  companyId: context.companyId,
                  reservationId: created.id,
                  size: nonBlank(entry.size ?? entry.label, 'size', 20),
                  quantity: Math.trunc(entry.quantity),
                  productVariantId: variant?.variantId ?? null,
                  includedInPackage: true,
                  timestamp: context.timestamp,
                });
              } else {
                const resolved = await this.resolveSnackInventory(context.companyId, entry.productId, entry.productVariantId);
                await this.repository.insertSnack(client, {
                  id: randomUUID(),
                  companyId: context.companyId,
                  reservationId: created.id,
                  productId: entry.productId ?? null,
                  nameSnapshot: nonBlank(entry.label, 'name_snapshot', 200),
                  // An included consumable is already priced into the
                  // package total (Part D5: "if complimentary, no
                  // fabricated charge") — never a second, separate charge
                  // for the same item.
                  unitPriceSnapshot: '0.0000',
                  quantity: String(entry.quantity),
                  lineTotal: '0.0000',
                  taxSnapshot: null,
                  taxTotal: '0.0000',
                  productVariantId: resolved.productVariantId,
                  stockDeducted: resolved.stockDeducted,
                  includedInPackage: true,
                  timestamp: context.timestamp,
                });
              }
            }
          }

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

  // --- Room availability preview (TASK 16.22) ---------------------------------

  /**
   * The genuine gap this task's own forensic audit found: the legacy
   * Cotizador's central commercial value was showing, LIVE, which rooms
   * were actually available (conflict-free AND within capacity) for a
   * given package/date/time — `POST /party-packages/:id/quote` never
   * accepted a room or a date/time at all, so an operator had no way to
   * know a room was even bookable before quoting one. This is a pure,
   * read-only PREVIEW — never a booking action, never a hold on the
   * room — reusing the exact same authoritative pieces `createReservation`
   * itself uses (`isRoomEligibleForPackage`, `capacityViolation`,
   * `overlappingReservationsUnlocked`/`overlappingReservations`), so the
   * Cotizador's preview and the real booking gate can never silently
   * diverge (Phase 41 "one authoritative availability engine"). Mirrors
   * legacy's own `cotizadorSalonesCompatibles`/`cotizadorActualizar`
   * filtering — only rooms genuinely ELIGIBLE for this package are
   * returned at all (an ineligible room is never shown as "unavailable
   * for another reason"), each with a real conflict/capacity reason —
   * but, unlike legacy, correctly branch-scoped (legacy's own forensic
   * audit found it offered every active room across every branch once a
   * package had no explicit room list configured — a real legacy bug,
   * intentionally not reproduced here).
   *
   * `createReservation`/`updateReservation` NEVER trust this preview —
   * they independently re-run the real, row-locked conflict/capacity/
   * eligibility checks inside their own transaction before ever
   * committing (Phase 28/29 "revalidate on conversion"/"concurrent
   * booking"), with the database's own `party_reservations_room_time_excl`
   * GIST exclusion constraint as the unconditional last-line guarantee
   * regardless of what this preview reported a moment earlier.
   */
  public async availableRooms(
    context: { companyId: string },
    branchIds: readonly string[],
    input: {
      branchId: string;
      packageId: string;
      eventDate: string;
      startTime: string;
      children?: number;
      adults?: number;
      extraHalfHours?: number;
      excludeReservationId?: string;
    },
  ): Promise<{
    eventDate: string;
    startTime: string;
    endTime: string;
    rooms: readonly {
      room: PartyRoomRow;
      available: boolean;
      reason: 'conflict' | 'capacity' | null;
      conflictingReservationNumber: string | null;
    }[];
  }> {
    if (!branchIds.includes(input.branchId))
      throw new PartyError('validation_error', 'The branch is not authorized for this actor.');
    const eventDate = normalizeDate(input.eventDate, 'event_date');
    const startTime = normalizeTime(input.startTime, 'start_time');
    const children = nonNegativeInteger(input.children ?? 0, 'children');
    const adults = nonNegativeInteger(input.adults ?? 0, 'adults');
    const extraHalfHours = nonNegativeInteger(input.extraHalfHours ?? 0, 'extra_half_hours');

    const pkg = await this.repository.packageRow(context.companyId, input.packageId);
    if (pkg === null || (pkg.branchId !== null && pkg.branchId !== input.branchId))
      throw new PartyError('resource_not_found', 'The package was not found for this branch.');
    const endTime = computeEndTime(startTime, pkg.durationMinutes, extraHalfHours);

    const { items: branchRooms } = await this.repository.listRooms(context.companyId, branchIds, {
      limit: 200,
      branchId: input.branchId,
      status: 'active',
    });
    const eligibleRooms = branchRooms.filter((room) => isRoomEligibleForPackage(pkg.restrictions, room.id));

    const rooms: {
      room: PartyRoomRow;
      available: boolean;
      reason: 'conflict' | 'capacity' | null;
      conflictingReservationNumber: string | null;
    }[] = [];
    for (const room of eligibleRooms) {
      const violation = capacityViolation({
        roomCapacityTotal: room.capacityTotal,
        roomCapacityChildren: room.capacityChildren,
        roomCapacityAdults: room.capacityAdults,
        packageCapacityMax: pkg.capacityMax,
        children,
        adults,
      });
      if (violation !== null) {
        rooms.push({ room, available: false, reason: 'capacity', conflictingReservationNumber: null });
        continue;
      }
      const conflicts = await this.repository.overlappingReservationsUnlocked(
        context.companyId,
        room.id,
        eventDate,
        startTime,
        endTime,
        input.excludeReservationId,
      );
      const conflict = conflicts[0];
      rooms.push({
        room,
        available: conflict === undefined,
        reason: conflict === undefined ? null : 'conflict',
        conflictingReservationNumber: conflict?.reservationNumber ?? null,
      });
    }

    return { eventDate, startTime, endTime, rooms };
  }

  /** TASK 16.20 — shared by `createReservation`'s auto-population and
   * `addSnack`: resolves a snack's real default inventory-tracked variant
   * (mirrors `SalesRepository.resolveProductLines`'s own default-variant
   * pattern). No `productId` (a genuinely custom snack) or a product that
   * doesn't track inventory both honestly resolve to `not_applicable` —
   * never a `pending` deduction that could never actually post. */
  private async resolveSnackInventory(
    companyId: string,
    productId: string | undefined,
    explicitVariantId?: string,
  ): Promise<{ productVariantId: string | null; stockDeducted: 'pending' | 'not_applicable' }> {
    if (productId === undefined) return { productVariantId: null, stockDeducted: 'not_applicable' };
    const variant = await this.resolveConsumableVariant(companyId, productId, explicitVariantId);
    return variant === null
      ? { productVariantId: null, stockDeducted: 'not_applicable' }
      : { productVariantId: variant.variantId, stockDeducted: 'pending' };
  }

  /** TASK 16.20A (Part 2) — shared by both sock and snack resolution: an
   * EXPLICIT `productVariantId` (a package's own configured variant
   * choice — see `specificVariantForInventory`'s own doc comment for why
   * this is re-resolved live, never trusted from a stale snapshot) takes
   * priority; omitted falls back to the product's own default variant,
   * exactly matching TASK 16.20's original behavior unchanged. */
  private async resolveConsumableVariant(
    companyId: string,
    productId: string | undefined,
    explicitVariantId: string | undefined,
  ): Promise<{ variantId: string; tracksInventory: boolean } | null> {
    if (productId === undefined) return null;
    if (explicitVariantId !== undefined) return this.repository.specificVariantForInventory(companyId, productId, explicitVariantId);
    return this.repository.productVariantForInventory(companyId, productId);
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
          // TASK 16.20 (Part L1) — releases the coupon's redemption slot
          // (ADR-0016's own "reserved at creation, released on
          // cancellation" window, mirrored from sales). The reservation's
          // own `discountTotal`/`couponCodeSnapshot` remain as historical
          // record — only the SLOT is freed for reuse, never rewriting
          // what this cancelled reservation actually was.
          await this.repository.deletePartyCouponRedemption(client, context.companyId, id);
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

  // --- Coupons (TASK 16.20 Part L1) -----------------------------------------------

  /** Resolves the TASK 16.19-disclosed gap: "determine whether the
   * existing promotion engine can safely apply to party packages." It
   * cannot — `evaluatePricing` is scoped to catalog products/categories, a
   * concept party packages don't have. What CAN be shared safely,
   * unmodified, is the platform's real `coupons` catalog itself
   * (percentage/fixed-amount, date window, min subtotal, usage limit) —
   * exactly what this method applies, backend-authoritative, never a
   * client-submitted discount. Concurrency-safe via a locked coupon row +
   * a redemption count in `party_reservation_coupon_redemptions`, inside
   * the SAME transaction — mirrors `PromotionsService.redeemCoupon`'s own
   * discipline for sales, applied to the party-specific redemption table
   * (see that table's own doc comment for why it's separate).
   */
  public async applyCoupon(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    input: { code: string },
  ): Promise<PartyReservationRow> {
    const normalizedCode = input.code.trim().toUpperCase();
    if (normalizedCode.length === 0) throw new PartyError('validation_error', 'code cannot be blank.');
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockReservation(client, context.companyId, reservationId);
      if (current === null || !branchIds.includes(current.branchId))
        throw new PartyError('resource_not_found', 'The reservation was not found.');
      if (current.status === 'completed' || current.status === 'cancelled')
        throw new PartyError('invalid_reservation_state', `A ${current.status} reservation cannot be modified.`);
      if (current.couponId !== null) throw new PartyError('resource_conflict', 'This reservation already has a coupon applied.');
      if (current.subtotalAmount === null)
        throw new PartyError('validation_error', 'This reservation has no priced subtotal to discount.');

      const coupon = await this.repository.lockCouponByNormalizedCode(client, context.companyId, normalizedCode);
      if (coupon === null) throw new PartyError('resource_not_found', 'The coupon was not found.');
      if (!coupon.active) throw new PartyError('coupon_inactive', 'This coupon is not active.');
      if (coupon.startsAt !== null && context.timestamp < coupon.startsAt)
        throw new PartyError('coupon_inactive', 'This coupon is not active yet.');
      if (coupon.endsAt !== null && context.timestamp > coupon.endsAt)
        throw new PartyError('coupon_inactive', 'This coupon has expired.');

      const subtotalUnits = moneyUnits(current.subtotalAmount, 'subtotal_amount');
      if (coupon.minSubtotal !== null && subtotalUnits < moneyUnits(coupon.minSubtotal, 'min_subtotal'))
        throw new PartyError('coupon_min_subtotal_not_met', `This coupon requires a subtotal of at least ${coupon.minSubtotal}.`);

      if (coupon.usageLimitTotal !== null) {
        const used = await this.repository.partyCouponRedemptionCount(client, context.companyId, coupon.id);
        if (used >= coupon.usageLimitTotal)
          throw new PartyError('coupon_usage_limit_reached', 'This coupon has reached its usage limit.');
      }

      const rawDiscountUnits =
        coupon.benefitType === 'percentage'
          ? (subtotalUnits * BigInt(coupon.benefitPercentageBasisPoints ?? 0) + 5_000n) / 10_000n
          : moneyUnits(coupon.benefitFixedAmount ?? '0', 'benefit_fixed_amount');
      // Never a discount larger than the subtotal itself — no negative total.
      const discountUnits = rawDiscountUnits > subtotalUnits ? subtotalUnits : rawDiscountUnits;

      const pkg = await this.repository.packageRow(context.companyId, current.packageId);
      if (pkg === null) throw new PartyError('resource_not_found', 'The package was not found.');
      const basisPoints = BigInt(ivaBasisPointsForTaxCode(pkg.taxCode));
      const discountedBaseUnits = subtotalUnits - discountUnits;
      const taxUnits = (discountedBaseUnits * basisPoints + 5_000n) / 10_000n;
      const totalUnits = discountedBaseUnits + taxUnits;

      await this.repository.insertPartyCouponRedemption(client, {
        id: randomUUID(),
        companyId: context.companyId,
        branchId: current.branchId,
        reservationId: current.id,
        couponId: coupon.id,
        amount: formatMoney(discountUnits),
        timestamp: context.timestamp,
      });
      const updated = await this.repository.updateReservation(client, context.companyId, current.id, current.version, {
        discountTotal: formatMoney(discountUnits),
        taxTotal: formatMoney(taxUnits),
        quotedTotal: formatMoney(totalUnits),
        couponId: coupon.id,
        couponCodeSnapshot: normalizedCode,
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.audit(client, context, {
        action: 'party_reservation.coupon_applied',
        resourceType: 'party_reservation',
        resourceId: updated.id,
        payload: { reservation_id: updated.id, coupon_code: normalizedCode, discount_total: updated.discountTotal, quoted_total: updated.quotedTotal },
      });
      return updated;
    });
  }

  /** The inverse of [applyCoupon] — releases the redemption slot and
   * recomputes the reservation back to its undiscounted total, using the
   * SAME `computePartyQuote`-shaped math (subtotal unchanged, tax
   * recomputed against the full subtotal again). Never leaves a
   * reservation in an inconsistent discount/tax/total state. */
  public async removeCoupon(context: PartyMutationContext, branchIds: readonly string[], reservationId: string): Promise<PartyReservationRow> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockReservation(client, context.companyId, reservationId);
      if (current === null || !branchIds.includes(current.branchId))
        throw new PartyError('resource_not_found', 'The reservation was not found.');
      if (current.status === 'completed' || current.status === 'cancelled')
        throw new PartyError('invalid_reservation_state', `A ${current.status} reservation cannot be modified.`);
      if (current.couponId === null) throw new PartyError('resource_conflict', 'This reservation has no coupon applied.');
      if (current.subtotalAmount === null)
        throw new PartyError('validation_error', 'This reservation has no priced subtotal.');

      await this.repository.deletePartyCouponRedemption(client, context.companyId, current.id);

      const pkg = await this.repository.packageRow(context.companyId, current.packageId);
      if (pkg === null) throw new PartyError('resource_not_found', 'The package was not found.');
      const subtotalUnits = moneyUnits(current.subtotalAmount, 'subtotal_amount');
      const basisPoints = BigInt(ivaBasisPointsForTaxCode(pkg.taxCode));
      const taxUnits = (subtotalUnits * basisPoints + 5_000n) / 10_000n;
      const totalUnits = subtotalUnits + taxUnits;

      const updated = await this.repository.updateReservation(client, context.companyId, current.id, current.version, {
        discountTotal: formatMoney(0n),
        taxTotal: formatMoney(taxUnits),
        quotedTotal: formatMoney(totalUnits),
        couponId: null,
        couponCodeSnapshot: null,
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.audit(client, context, {
        action: 'party_reservation.coupon_removed',
        resourceType: 'party_reservation',
        resourceId: updated.id,
        payload: { reservation_id: updated.id, quoted_total: updated.quotedTotal },
      });
      return updated;
    });
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
      // TASK 16.23A — was a float round-trip (`BigInt(Math.round(Number(
      // input.quantity) * 1_000_000))`), an ADR-0001 violation found by a
      // pre-launch audit; now the same exact regex-based parse
      // `computeLineTax` below already uses.
      const quantityUnits = parseQuantityUnits(input.quantity, 'quantity');
      const subtotalUnits = (moneyUnits(unitPriceSnapshot) * quantityUnits) / 1_000_000n;
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
      // TASK 16.20 — a snack an OPERATOR explicitly adds (as opposed to
      // one auto-populated from the package's `includedConsumables`) is
      // real, additional, and never `includedInPackage`. If it resolves
      // to a real inventory-tracked variant, it becomes stock-deductible
      // exactly like a sock line already is.
      const resolved = await this.resolveSnackInventory(context.companyId, input.productId);
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
        productVariantId: resolved.productVariantId,
        stockDeducted: resolved.stockDeducted,
        includedInPackage: false,
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
        includedInPackage: false,
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
   * `'deducted'` and is rejected) is ever posted.
   *
   * TASK 16.20 (Part D4) — `issuedQuantity` is the real amount an
   * operator is actually handing out, independently of the row's own
   * PLANNED `quantity` (e.g. a package included 25 but only 23 children
   * attended) — defaults to the planned quantity when omitted, exactly
   * preserving pre-16.20 callers' behavior. Extra socks beyond the plan
   * are a SEPARATE `addSock` row (Part D5 — traceable, never folded into
   * this one row's own history). */
  public async deductSock(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    sockId: string,
    input?: { issuedQuantity?: number },
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
      const issuedQuantity =
        input?.issuedQuantity === undefined ? sockRow.quantity : nonNegativeInteger(input.issuedQuantity, 'issued_quantity');
      if (issuedQuantity <= 0) throw new PartyError('validation_error', 'issued_quantity must be greater than zero.');

      await postPartySockDeduction(
        client,
        { companyId: context.companyId, actorId: context.actorId, correlationId: context.correlationId, timestamp: context.timestamp },
        { id: reservationRow.id, branchId: reservationRow.branchId, reservationNumber: reservationRow.reservationNumber },
        { id: sockRow.id, productVariantId: sockRow.productVariantId, quantity: issuedQuantity, size: sockRow.size },
      );
      const updated = await this.repository.markSockDeducted(client, context.companyId, sockRow.id, issuedQuantity, context.timestamp);
      await this.repository.audit(client, context, {
        action: 'party_reservation.sock_deducted',
        resourceType: 'party_reservation_sock',
        resourceId: updated.id,
        payload: { reservation_id: reservationRow.id, planned_quantity: sockRow.quantity, issued_quantity: issuedQuantity },
      });
      return updated;
    });
  }

  /** TASK 16.20 (Part E) — the snack/drink mirror of `deductSock`, closing
   * the confirmed gap that snacks never posted a real inventory movement
   * at all (`docs/LEGACY_FUNCTIONAL_PARITY.md`, catalog/inventory audit).
   * Same guard/idempotency shape; `issuedQuantity` defaults to the row's
   * own planned `quantity` (a decimal string, matching the snack's own
   * quantity scale). */
  public async deductSnack(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    snackId: string,
    input?: { issuedQuantity?: string },
  ): Promise<PartyReservationSnackRow> {
    return this.repository.transaction(async (client) => {
      const reservationRow = await this.reservation(context.companyId, branchIds, reservationId);
      const snackRow = await this.repository.lockSnack(client, context.companyId, reservationRow.id, snackId);
      if (snackRow === null) throw new PartyError('resource_not_found', 'The snack line was not found.');
      if (snackRow.productVariantId === null)
        throw new PartyError('validation_error', 'This snack line has no inventory variant to deduct.');
      if (snackRow.stockDeducted === 'not_applicable')
        throw new PartyError('resource_conflict', 'This snack line is not stock-tracked.');
      if (snackRow.stockDeducted === 'deducted')
        throw new PartyError('resource_conflict', 'This snack line was already deducted.');
      let issuedQuantity = snackRow.quantity;
      if (input?.issuedQuantity !== undefined) {
        const match = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.exec(input.issuedQuantity);
        if (match === null || Number(input.issuedQuantity) <= 0)
          throw new PartyError('validation_error', 'issued_quantity must be a positive decimal.');
        issuedQuantity = input.issuedQuantity;
      }

      await postPartySnackDeduction(
        client,
        { companyId: context.companyId, actorId: context.actorId, correlationId: context.correlationId, timestamp: context.timestamp },
        { id: reservationRow.id, branchId: reservationRow.branchId, reservationNumber: reservationRow.reservationNumber },
        { id: snackRow.id, productVariantId: snackRow.productVariantId, quantity: issuedQuantity, nameSnapshot: snackRow.nameSnapshot },
      );
      const updated = await this.repository.markSnackDeducted(client, context.companyId, snackRow.id, issuedQuantity, context.timestamp);
      await this.repository.audit(client, context, {
        action: 'party_reservation.snack_deducted',
        resourceType: 'party_reservation_snack',
        resourceId: updated.id,
        payload: { reservation_id: reservationRow.id, planned_quantity: snackRow.quantity, issued_quantity: issuedQuantity },
      });
      return updated;
    });
  }

  /** TASK 16.20A (Parts 7-17) — a real, party-specific, safe correction
   * workflow for an already-issued sock line, operator-facing (never
   * requiring the generic inventory-reversal API), reusing the
   * platform's own real compensating-ledger discipline underneath
   * (`postPartySockCorrection` — see its own doc comment). The
   * ORIGINAL `issue` movement is never edited, deleted, or reversed —
   * only a NEW delta movement is posted, and only `issued_quantity` on
   * this row is updated to reflect the current truth.
   *
   * **Idempotency** (Part 16): the delta is computed from a FRESH,
   * row-locked read of `issuedQuantity` — never a client-submitted
   * delta — so an identical retried request (same `correctedQuantity`)
   * recomputes `delta=0` and is a safe, harmless no-op (no second
   * movement). **Concurrency** (Part 17): the row lock serializes two
   * concurrent corrections of the same line — the second one always
   * computes its delta against the FIRST one's already-committed
   * result, never a stale value.
   *
   * **Financial safety** (Part 13): this method touches ONLY
   * `issuedQuantity` + inventory — it never touches `quantity`
   * (the billed/planned amount), `unitPriceSnapshot`, or `lineTotal`.
   * A physical-quantity correction is never, by itself, a commercial/
   * billing action. */
  public async correctSock(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    sockId: string,
    input: { correctedQuantity: number },
  ): Promise<PartyReservationSockRow> {
    const correctedQuantity = nonNegativeInteger(input.correctedQuantity, 'corrected_quantity');
    if (correctedQuantity <= 0) throw new PartyError('validation_error', 'corrected_quantity must be greater than zero.');
    return this.repository.transaction(async (client) => {
      const reservationRow = await this.reservation(context.companyId, branchIds, reservationId);
      const sockRow = await this.repository.lockSock(client, context.companyId, reservationRow.id, sockId);
      if (sockRow === null) throw new PartyError('resource_not_found', 'The sock line was not found.');
      if (sockRow.productVariantId === null)
        throw new PartyError('validation_error', 'This sock line has no inventory variant to correct.');
      if (sockRow.stockDeducted !== 'deducted' || sockRow.issuedQuantity === null)
        throw new PartyError('resource_conflict', 'This sock line has not been delivered yet — nothing to correct.');

      const delta = correctedQuantity - sockRow.issuedQuantity;
      if (delta === 0) return sockRow; // Naturally idempotent — nothing to correct, no movement posted.

      await postPartySockCorrection(
        client,
        { companyId: context.companyId, actorId: context.actorId, correlationId: context.correlationId, timestamp: context.timestamp },
        { id: reservationRow.id, branchId: reservationRow.branchId, reservationNumber: reservationRow.reservationNumber },
        { id: sockRow.id, productVariantId: sockRow.productVariantId, size: sockRow.size },
        delta,
      );
      const updated = await this.repository.markSockCorrected(client, context.companyId, sockRow.id, correctedQuantity);
      await this.repository.audit(client, context, {
        action: 'party_reservation.sock_corrected',
        resourceType: 'party_reservation_sock',
        resourceId: updated.id,
        payload: {
          reservation_id: reservationRow.id,
          previous_issued_quantity: sockRow.issuedQuantity,
          corrected_quantity: correctedQuantity,
          delta,
        },
      });
      return updated;
    });
  }

  /** TASK 16.20A — the snack mirror of `correctSock`; see that method's
   * own doc comment for the full idempotency/concurrency/financial-
   * safety rationale, identical here. */
  public async correctSnack(
    context: PartyMutationContext,
    branchIds: readonly string[],
    reservationId: string,
    snackId: string,
    input: { correctedQuantity: string },
  ): Promise<PartyReservationSnackRow> {
    const match = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.exec(input.correctedQuantity);
    if (match === null || Number(input.correctedQuantity) <= 0)
      throw new PartyError('validation_error', 'corrected_quantity must be a positive decimal.');
    return this.repository.transaction(async (client) => {
      const reservationRow = await this.reservation(context.companyId, branchIds, reservationId);
      const snackRow = await this.repository.lockSnack(client, context.companyId, reservationRow.id, snackId);
      if (snackRow === null) throw new PartyError('resource_not_found', 'The snack line was not found.');
      if (snackRow.productVariantId === null)
        throw new PartyError('validation_error', 'This snack line has no inventory variant to correct.');
      if (snackRow.stockDeducted !== 'deducted' || snackRow.issuedQuantity === null)
        throw new PartyError('resource_conflict', 'This snack line has not been delivered yet — nothing to correct.');

      const deltaUnits = decimalQuantityUnits(input.correctedQuantity) - decimalQuantityUnits(snackRow.issuedQuantity);
      if (deltaUnits === 0n) return snackRow; // Naturally idempotent.
      const deltaText = `${deltaUnits < 0n ? '-' : ''}${formatDecimalQuantity(deltaUnits < 0n ? -deltaUnits : deltaUnits)}`;

      await postPartySnackCorrection(
        client,
        { companyId: context.companyId, actorId: context.actorId, correlationId: context.correlationId, timestamp: context.timestamp },
        { id: reservationRow.id, branchId: reservationRow.branchId, reservationNumber: reservationRow.reservationNumber },
        { id: snackRow.id, productVariantId: snackRow.productVariantId, nameSnapshot: snackRow.nameSnapshot },
        deltaText,
      );
      const updated = await this.repository.markSnackCorrected(client, context.companyId, snackRow.id, input.correctedQuantity);
      await this.repository.audit(client, context, {
        action: 'party_reservation.snack_corrected',
        resourceType: 'party_reservation_snack',
        resourceId: updated.id,
        payload: {
          reservation_id: reservationRow.id,
          previous_issued_quantity: snackRow.issuedQuantity,
          corrected_quantity: input.correctedQuantity,
          delta: deltaText,
        },
      });
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

  /** TASK 16.20 (Part P) — resolves the TASK 16.19-disclosed gap: real
   * tenant-configurable contract/waiver legal text, via the platform's own
   * company/branch settings architecture (`parties.contract_terms`/
   * `parties.waiver_terms`), with real version/snapshot behavior so an
   * already-generated document's wording never silently changes on a
   * later reprint — see `earliestDocumentTermsSnapshot`'s own doc comment
   * for exactly how. The rendered HTML itself is still NEVER stored
   * (regenerated fresh every call, unchanged from TASK 14.3).
   */
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
    const existingSnapshot = await this.repository.earliestDocumentTermsSnapshot(context.companyId, reservationRow.id, documentType);
    const clauses = existingSnapshot ?? (await this.resolveDocumentClauses(context.companyId, reservationRow.branchId, documentType));
    const document = await this.repository.transaction((client) =>
      this.repository.insertDocumentAudit(client, {
        id: randomUUID(),
        companyId: context.companyId,
        reservationId: reservationRow.id,
        documentType,
        generatedBy: context.actorId,
        termsSnapshot: clauses,
        timestamp: context.timestamp,
      }),
    );
    const html = renderPartyDocumentHtml(documentType, reservationRow, pkg, room, organization, clauses);
    return { html, document };
  }

  /** A tenant's own configured text (one clause per non-blank line) when
   * set, else the platform's generic, tenant-neutral default clause set —
   * never a hardcoded tenant's own legal text in shared code (this
   * task's own absolute constraint). */
  private async resolveDocumentClauses(companyId: string, branchId: string, documentType: 'waiver' | 'contract'): Promise<readonly string[]> {
    const key = documentType === 'contract' ? 'parties.contract_terms' : 'parties.waiver_terms';
    const configured = await this.repository.resolveTenantTextSetting(companyId, branchId, key);
    if (configured !== null) {
      const lines = configured.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
      if (lines.length > 0) return lines;
    }
    return documentType === 'contract' ? DEFAULT_CONTRACT_CLAUSES : DEFAULT_WAIVER_CLAUSES;
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
 *  admin surface existed at the time — TASK 16.20 Part P closes that: see
 *  `PartyReservationsService.resolveDocumentClauses`/`parties.contract_
 *  terms`/`parties.waiver_terms`. The clause sets below remain the
 *  platform's own generic, tenant-neutral DEFAULT for a tenant that
 *  hasn't configured its own — never a specific tenant's own legal text
 *  in shared code. */
const DEFAULT_CONTRACT_CLAUSES: readonly string[] = [
  'El cliente acepta la fecha, horario, salón y paquete del evento descritos en este documento.',
  'Un anticipo asegura la reservación; el saldo restante debe liquidarse a más tardar el día del evento.',
  'Las cancelaciones se rigen por la política de cancelación de este negocio; cualquier reembolso de cantidades ya pagadas lo autoriza y gestiona un responsable del negocio de forma manual, nunca automática.',
  'El negocio no se hace responsable de objetos personales perdidos o dañados durante el evento.',
  'Invitados adicionales, refrigerios o extras no incluidos en el paquete descrito se cobran como cargos adicionales al momento del servicio.',
  'El número de invitados no debe exceder el aforo autorizado para el salón y paquete reservados.',
];
const DEFAULT_WAIVER_CLAUSES: readonly string[] = [
  'El firmante reconoce los riesgos inherentes a las actividades del área de juegos/eventos para todos los asistentes.',
  'El firmante libera al negocio de responsabilidad por lesiones derivadas del uso ordinario de las instalaciones, salvo negligencia grave del negocio.',
  'El firmante se compromete a que todos los asistentes seguirán las reglas de seguridad publicadas y las instrucciones del personal en todo momento.',
];

function renderPartyDocumentHtml(
  documentType: 'waiver' | 'contract',
  reservation: PartyReservationRow,
  pkg: PartyPackageRow | null,
  room: PartyRoomRow | null,
  organization: { companyName: string; branchName: string; branchAddress: Readonly<Record<string, unknown>> | null } | null,
  clauses: readonly string[],
): string {
  const title = documentType === 'contract' ? 'Contrato de Prestación de Servicios' : 'Deslinde de Responsabilidad';
  const businessName = organization === null ? 'Negocio' : organization.companyName;
  const branchName = organization === null ? '' : organization.branchName;
  const customerName = reservation.customerDisplayName ?? 'Cliente de mostrador';
  const celebrant = reservation.celebrantName ?? 'N/D';
  const roomName = reservation.roomNameSnapshot ?? room?.name ?? 'N/D';
  const packageName = reservation.packageNameSnapshot ?? pkg?.name ?? 'N/D';
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
