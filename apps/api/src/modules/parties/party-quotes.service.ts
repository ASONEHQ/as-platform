import { createHash, randomUUID } from 'node:crypto';

import { ivaBasisPointsForTaxCode } from '@asone/database';

import { renderPartyQuoteHtml } from './party-quotes.document.js';
import { computePartyQuote, nonBlank, nonNegativeInteger } from './parties.pricing.js';
import type { PartiesRepository, PartyTransaction } from './parties.repository.js';
import {
  PartyError,
  type PartyMutationContext,
  type PartyPackageRow,
  type PartyQuoteBreakdownSnapshot,
  type PartyQuotePackageSnapshot,
  type PartyQuoteRow,
  type PartyQuoteStatus,
} from './parties.types.js';

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}

/** Human folio derived from the id (unique per company at the DB level). */
function quoteNumberFor(id: string): string {
  return `COT-${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`;
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
  if (!DATE_PATTERN.test(value)) throw new PartyError('validation_error', `${field} must be a valid YYYY-MM-DD date.`);
  return value;
}

/** The package terms that price a quote, frozen as-is. */
function snapshotOf(pkg: PartyPackageRow): PartyQuotePackageSnapshot {
  return {
    package_id: pkg.id,
    package_code: pkg.code,
    package_name: pkg.name,
    package_version: pkg.version.toString(),
    description: pkg.description,
    currency_code: pkg.currencyCode,
    price: pkg.price,
    child_extra_cost: pkg.childExtraCost,
    adult_extra_cost: pkg.adultExtraCost,
    extra_half_hour_cost: pkg.extraHalfHourCost,
    children_included: pkg.childrenIncluded,
    adults_included: pkg.adultsIncluded,
    duration_minutes: pkg.durationMinutes,
    tax_code: pkg.taxCode,
    tax_basis_points: ivaBasisPointsForTaxCode(pkg.taxCode),
    includes: pkg.includes,
    included_consumables: pkg.includedConsumables,
  };
}

interface PricedQuote {
  packageSnapshot: PartyQuotePackageSnapshot;
  subtotalAmount: string;
  discountTotal: string;
  taxTotal: string;
  totalAmount: string;
  breakdown: PartyQuoteBreakdownSnapshot;
}

function priceFrom(pkg: PartyPackageRow, children: number, adults: number, extraHalfHours: number): PricedQuote {
  const breakdown = computePartyQuote({
    price: pkg.price,
    childrenIncluded: pkg.childrenIncluded,
    adultsIncluded: pkg.adultsIncluded,
    childExtraCost: pkg.childExtraCost,
    adultExtraCost: pkg.adultExtraCost,
    extraHalfHourCost: pkg.extraHalfHourCost,
    children,
    adults,
    extraHalfHours,
    taxCode: pkg.taxCode,
  });
  return {
    packageSnapshot: snapshotOf(pkg),
    subtotalAmount: breakdown.subtotal,
    discountTotal: breakdown.discountTotal,
    taxTotal: breakdown.taxTotal,
    totalAmount: breakdown.total,
    breakdown: {
      base: breakdown.base,
      children_extra: breakdown.childrenExtra,
      adults_extra: breakdown.adultsExtra,
      time_extra: breakdown.timeExtra,
    },
  };
}

/** Idempotent replays come back as stored JSON: revive Dates and the bigint. */
export function decodeQuote(raw: unknown): PartyQuoteRow {
  const value = raw as Omit<PartyQuoteRow, 'convertedAt' | 'cancelledAt' | 'createdAt' | 'updatedAt' | 'version'> & {
    convertedAt: string | null;
    cancelledAt: string | null;
    createdAt: string;
    updatedAt: string;
    version: string;
  };
  return {
    ...value,
    convertedAt: value.convertedAt === null ? null : new Date(value.convertedAt),
    cancelledAt: value.cancelledAt === null ? null : new Date(value.cancelledAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    version: BigInt(value.version),
  };
}

function quotePayload(value: PartyQuoteRow): Readonly<Record<string, unknown>> {
  return {
    quote_id: value.id,
    quote_number: value.quoteNumber,
    branch_id: value.branchId,
    status: value.status,
    package_id: value.packageId,
    total_amount: value.totalAmount,
    currency_code: value.currencyCode,
    version: value.version.toString(),
  };
}

export interface CreatePartyQuoteInput {
  branchId: string;
  packageId: string;
  childrenCount?: number;
  adultsCount?: number;
  extraHalfHours?: number;
  customerId?: string;
  roomId?: string;
  eventDate?: string;
  startTime?: string;
  notes?: string;
}

export interface UpdatePartyQuoteInput {
  packageId?: string;
  childrenCount?: number;
  adultsCount?: number;
  extraHalfHours?: number;
  customerId?: string | null;
  roomId?: string | null;
  eventDate?: string | null;
  startTime?: string | null;
  notes?: string | null;
}

/**
 * TASK 17.6 — saved party quotations. A quote is NEVER a reservation: it blocks
 * no room and records no payment. It freezes what was quoted (the package terms
 * and the computed amounts) so a later package price change cannot rewrite it.
 * Editing a DRAFT re-prices ONLY when a pricing input (package/guests/extra
 * time) actually changes; editing notes/customer/date leaves the frozen
 * amounts untouched. Conversion into a reservation is explicit and lives in
 * `PartyReservationsService.createReservation` (`quote_id`), atomic with the
 * reservation insert so a quote can never convert twice.
 */
export class PartyQuotesService {
  public constructor(private readonly repository: PartiesRepository) {}

  public async createQuote(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    input: CreatePartyQuoteInput,
  ): Promise<{ value: PartyQuoteRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new PartyError('validation_error', 'The branch is not authorized for this actor.');
    const childrenCount = nonNegativeInteger(input.childrenCount ?? 0, 'children_count');
    const adultsCount = nonNegativeInteger(input.adultsCount ?? 0, 'adults_count');
    const extraHalfHours = nonNegativeInteger(input.extraHalfHours ?? 0, 'extra_half_hours');
    const eventDate = input.eventDate === undefined ? null : normalizeDate(input.eventDate, 'event_date');
    const startTime = input.startTime === undefined ? null : normalizeTime(input.startTime, 'start_time');
    const notes = input.notes === undefined ? null : nonBlank(input.notes, 'notes', 2000);
    const id = randomUUID();
    const requestHash = hash({
      branchId: input.branchId,
      packageId: input.packageId,
      childrenCount,
      adultsCount,
      extraHalfHours,
      customerId: input.customerId ?? null,
      roomId: input.roomId ?? null,
      eventDate,
      startTime,
      notes,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_quote.create',
        key,
        requestHash,
        'party_quote',
        decodeQuote,
        async () => {
          const pkg = await this.packageFor(context.companyId, input.packageId, input.branchId);
          const customer = await this.customerSnapshot(context.companyId, input.customerId);
          await this.assertRoom(context.companyId, input.roomId, input.branchId);
          const priced = priceFrom(pkg, childrenCount, adultsCount, extraHalfHours);
          const created = await this.repository.insertQuote(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            quoteNumber: quoteNumberFor(id),
            customerId: input.customerId ?? null,
            customerDisplayName: customer?.displayName ?? null,
            customerPhone: customer?.phone ?? null,
            sellerUserId: context.actorId,
            packageId: pkg.id,
            packageSnapshot: priced.packageSnapshot,
            childrenCount,
            adultsCount,
            extraHalfHours,
            currencyCode: pkg.currencyCode,
            subtotalAmount: priced.subtotalAmount,
            discountTotal: priced.discountTotal,
            taxTotal: priced.taxTotal,
            totalAmount: priced.totalAmount,
            breakdown: priced.breakdown,
            roomId: input.roomId ?? null,
            eventDate,
            startTime,
            notes,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'party_quote.created',
            resourceType: 'party_quote',
            resourceId: created.id,
            eventType: 'party_quote.created',
            branchId: created.branchId,
            version: created.version,
            payload: quotePayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async quote(companyId: string, branchIds: readonly string[], id: string): Promise<PartyQuoteRow> {
    const row = await this.repository.quote(companyId, id);
    if (row === null || !branchIds.includes(row.branchId))
      throw new PartyError('resource_not_found', 'The quote was not found.');
    return row;
  }

  public listQuotes(
    companyId: string,
    branchIds: readonly string[],
    filter: { branchId?: string; status?: PartyQuoteStatus; customerId?: string; limit: number; cursor?: string },
  ): Promise<{ items: PartyQuoteRow[]; nextCursor: string | null }> {
    return this.repository.listQuotes(companyId, branchIds, filter);
  }

  public async updateQuote(
    context: PartyMutationContext,
    branchIds: readonly string[],
    id: string,
    expectedVersion: bigint,
    input: UpdatePartyQuoteInput,
  ): Promise<PartyQuoteRow> {
    return this.repository.transaction(async (client) => {
      const current = await this.lockedQuote(client, context.companyId, branchIds, id);
      if (current.status !== 'draft')
        throw new PartyError('quote_not_editable', 'Only a draft quote can be edited.');
      if (current.version !== expectedVersion)
        throw new PartyError('version_conflict', 'The quote was changed by someone else; reload it.');

      const patch: Record<string, unknown> = {};
      const packageId = input.packageId ?? current.packageId;
      const childrenCount =
        input.childrenCount === undefined ? current.childrenCount : nonNegativeInteger(input.childrenCount, 'children_count');
      const adultsCount =
        input.adultsCount === undefined ? current.adultsCount : nonNegativeInteger(input.adultsCount, 'adults_count');
      const extraHalfHours =
        input.extraHalfHours === undefined ? current.extraHalfHours : nonNegativeInteger(input.extraHalfHours, 'extra_half_hours');
      const pricingChanged =
        packageId !== current.packageId ||
        childrenCount !== current.childrenCount ||
        adultsCount !== current.adultsCount ||
        extraHalfHours !== current.extraHalfHours;
      if (pricingChanged) {
        // A pricing input changed: re-price from the package AS IT IS NOW and
        // re-freeze. (Anything else leaves the frozen amounts untouched.)
        const pkg = await this.packageFor(context.companyId, packageId, current.branchId);
        const priced = priceFrom(pkg, childrenCount, adultsCount, extraHalfHours);
        Object.assign(patch, {
          packageId: pkg.id,
          packageSnapshot: priced.packageSnapshot,
          childrenCount,
          adultsCount,
          extraHalfHours,
          currencyCode: pkg.currencyCode,
          subtotalAmount: priced.subtotalAmount,
          discountTotal: priced.discountTotal,
          taxTotal: priced.taxTotal,
          totalAmount: priced.totalAmount,
          breakdown: priced.breakdown,
        });
      }
      if (input.customerId !== undefined) {
        const customer = await this.customerSnapshot(context.companyId, input.customerId ?? undefined);
        Object.assign(patch, {
          customerId: input.customerId,
          customerDisplayName: customer?.displayName ?? null,
          customerPhone: customer?.phone ?? null,
        });
      }
      if (input.roomId !== undefined) {
        await this.assertRoom(context.companyId, input.roomId ?? undefined, current.branchId);
        patch.roomId = input.roomId;
      }
      if (input.eventDate !== undefined)
        patch.eventDate = input.eventDate === null ? null : normalizeDate(input.eventDate, 'event_date');
      if (input.startTime !== undefined)
        patch.startTime = input.startTime === null ? null : normalizeTime(input.startTime, 'start_time');
      if (input.notes !== undefined) patch.notes = input.notes === null ? null : nonBlank(input.notes, 'notes', 2000);
      if (Object.keys(patch).length === 0) return current;

      const updated = await this.repository.updateQuote(client, context.companyId, id, patch, context.actorId, context.timestamp);
      await this.repository.auditAndPublish(client, context, {
        action: 'party_quote.updated',
        resourceType: 'party_quote',
        resourceId: updated.id,
        eventType: 'party_quote.updated',
        branchId: updated.branchId,
        version: updated.version,
        payload: { ...quotePayload(updated), repriced: pricingChanged },
      });
      return updated;
    });
  }

  public async cancelQuote(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    id: string,
    rawReason: string,
  ): Promise<{ value: PartyQuoteRow; replayed: boolean }> {
    const reason = nonBlank(rawReason, 'reason', 500);
    if (reason.length < 3) throw new PartyError('validation_error', 'reason must be at least 3 characters.');
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_quote.cancel',
        key,
        hash({ id, reason }),
        'party_quote',
        decodeQuote,
        async () => {
          const current = await this.lockedQuote(client, context.companyId, branchIds, id);
          if (current.status !== 'draft')
            throw new PartyError('quote_not_editable', 'Only a draft quote can be cancelled.');
          const cancelled = await this.repository.cancelQuote(client, context.companyId, id, {
            actorId: context.actorId,
            reason,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'party_quote.cancelled',
            resourceType: 'party_quote',
            resourceId: cancelled.id,
            eventType: 'party_quote.cancelled',
            branchId: cancelled.branchId,
            version: cancelled.version,
            payload: { ...quotePayload(cancelled), reason },
          });
          return cancelled;
        },
      ),
    );
  }

  /** Printable HTML of the SAVED quote (frozen snapshot + frozen amounts). */
  public async document(
    context: PartyMutationContext,
    branchIds: readonly string[],
    id: string,
  ): Promise<string> {
    const row = await this.quote(context.companyId, branchIds, id);
    const [organization, sellerName, room] = await Promise.all([
      this.repository.organizationForBranch(context.companyId, row.branchId),
      row.sellerUserId === null ? Promise.resolve(null) : this.repository.memberDisplayName(context.companyId, row.sellerUserId),
      row.roomId === null ? Promise.resolve(null) : this.repository.room(context.companyId, row.roomId),
    ]);
    if (organization === null) throw new PartyError('resource_not_found', 'The branch was not found.');
    await this.repository.transaction((client) =>
      this.repository.audit(client, context, {
        action: 'party_quote.document_generated',
        resourceType: 'party_quote',
        resourceId: row.id,
        payload: { quote_number: row.quoteNumber, status: row.status },
      }),
    );
    return renderPartyQuoteHtml({
      quote: row,
      companyName: organization.companyName,
      branchName: organization.branchName,
      sellerName,
      roomName: room?.name ?? null,
      generatedAt: context.timestamp,
    });
  }

  // --- helpers ----------------------------------------------------------------------

  private async lockedQuote(
    client: PartyTransaction,
    companyId: string,
    branchIds: readonly string[],
    id: string,
  ): Promise<PartyQuoteRow> {
    const row = await this.repository.lockQuote(client, companyId, id);
    if (row === null || !branchIds.includes(row.branchId))
      throw new PartyError('resource_not_found', 'The quote was not found.');
    return row;
  }

  private async packageFor(companyId: string, packageId: string, branchId: string): Promise<PartyPackageRow> {
    const pkg = await this.repository.packageRow(companyId, packageId);
    if (pkg === null || (pkg.branchId !== null && pkg.branchId !== branchId))
      throw new PartyError('resource_not_found', 'The package was not found for this branch.');
    return pkg;
  }

  private async customerSnapshot(
    companyId: string,
    customerId: string | undefined,
  ): Promise<{ displayName: string; phone: string | null } | null> {
    if (customerId === undefined) return null;
    const customer = await this.repository.customerForSnapshot(companyId, customerId);
    if (customer === null) throw new PartyError('resource_not_found', 'The customer was not found.');
    return customer;
  }

  private async assertRoom(companyId: string, roomId: string | undefined, branchId: string): Promise<void> {
    if (roomId === undefined) return;
    const room = await this.repository.room(companyId, roomId);
    if (room?.branchId !== branchId)
      throw new PartyError('resource_not_found', 'The room was not found in this branch.');
  }
}
