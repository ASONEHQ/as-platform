import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { normalizeCurrencyCode, type ProductTaxCode } from '@asone/database';

import { computePartyQuote, nonBlank, nonNegativeInteger, nonNegativeMoney, type PartyQuoteBreakdown } from './parties.pricing.js';
import type { PartiesRepository } from './parties.repository.js';
import {
  PartyError,
  partyPackageTaxCodes,
  type PartyMutationContext,
  type PartyPackageIncludedConsumable,
  type PartyPackageRow,
  type PartyPackageStatus,
} from './parties.types.js';

function normalizeTaxCode(value: string): ProductTaxCode {
  if (!partyPackageTaxCodes.includes(value as (typeof partyPackageTaxCodes)[number]))
    throw new PartyError('validation_error', `tax_code must be one of: ${partyPackageTaxCodes.join(', ')}.`);
  return value as ProductTaxCode;
}

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}

function jsonObject(value: unknown, field: string): Readonly<Record<string, unknown>> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new PartyError('validation_error', `${field} must be a JSON object.`);
  return value as Readonly<Record<string, unknown>>;
}

/** TASK 16.20 (Part D4) / TASK 16.20A (Parts 2-3) — validates a
 * package's `included_consumables` plan. Shape/type validation happens
 * here, synchronously; real tenant-catalog FK ownership validation
 * happens in `validateIncludedConsumablesOwnership` below (async, needs
 * the repository) — TASK 16.20A escalates this from TASK 16.20's own
 * original "lightweight, non-FK-checked" design (a bogus `productId` is
 * now a real, clear, rejected error, never silently accepted). Also
 * rejects an accidental duplicate row for the exact same
 * `(kind, productId, productVariantId)` (or `(kind, productId, size)`
 * for a sock with no explicit variant) — Part 3's own "reject clearly"
 * option, chosen over silent merging so an operator's mistake is never
 * hidden. */
function parseIncludedConsumables(value: unknown, field: string): readonly PartyPackageIncludedConsumable[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new PartyError('validation_error', `${field} must be a JSON array.`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const label = `${field}[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new PartyError('validation_error', `${label} must be a JSON object.`);
    const record = entry as Record<string, unknown>;
    if (record.kind !== 'sock' && record.kind !== 'snack')
      throw new PartyError('validation_error', `${label}.kind must be "sock" or "snack".`);
    const entryLabel = nonBlank(String(record.label ?? ''), `${label}.label`, 200);
    if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity <= 0)
      throw new PartyError('validation_error', `${label}.quantity must be a positive number.`);
    if (record.productId !== undefined && typeof record.productId !== 'string')
      throw new PartyError('validation_error', `${label}.productId must be a string.`);
    if (record.productVariantId !== undefined && typeof record.productVariantId !== 'string')
      throw new PartyError('validation_error', `${label}.productVariantId must be a string.`);
    if (record.productVariantId !== undefined && record.productId === undefined)
      throw new PartyError('validation_error', `${label}.productVariantId requires productId.`);
    if (record.size !== undefined && typeof record.size !== 'string')
      throw new PartyError('validation_error', `${label}.size must be a string.`);

    const dedupeKey = `${record.kind}:${record.productId ?? ''}:${record.productVariantId ?? record.size ?? ''}`;
    if (record.productId !== undefined) {
      if (seen.has(dedupeKey))
        throw new PartyError(
          'validation_error',
          `${label} duplicates an earlier entry for the same product${record.productVariantId === undefined ? '' : '/variant'} — combine them into a single row instead.`,
        );
      seen.add(dedupeKey);
    }

    return {
      kind: record.kind,
      label: entryLabel,
      quantity: record.quantity,
      ...(typeof record.productId === 'string' ? { productId: record.productId } : {}),
      ...(typeof record.productVariantId === 'string' ? { productVariantId: record.productVariantId } : {}),
      ...(typeof record.size === 'string' ? { size: record.size } : {}),
    };
  });
}

/** TASK 16.20A (Part 2) — real, tenant-scoped FK validation for every
 * `included_consumables` entry that names a `productId`: the product
 * must actually exist in THIS company, and if `productVariantId` is
 * also given, it must actually belong to that product. Never a
 * duplicate "party product" catalog — always the real, shared
 * `products`/`product_variants` tables. */
async function validateIncludedConsumablesOwnership(
  repository: PartiesRepository,
  companyId: string,
  consumables: readonly PartyPackageIncludedConsumable[] | null,
): Promise<void> {
  if (consumables === null) return;
  for (const [index, entry] of consumables.entries()) {
    if (entry.productId === undefined) continue;
    const product = await repository.productForSnapshot(companyId, entry.productId);
    if (product === null)
      throw new PartyError('resource_not_found', `included_consumables[${String(index)}].productId does not exist in this company's catalog.`);
    if (entry.productVariantId !== undefined) {
      const owned = await repository.variantBelongsToProduct(companyId, entry.productId, entry.productVariantId);
      if (!owned)
        throw new PartyError(
          'resource_not_found',
          `included_consumables[${String(index)}].productVariantId does not belong to the given product.`,
        );
    }
  }
}

function packagePayload(value: PartyPackageRow): Readonly<Record<string, unknown>> {
  return {
    package_id: value.id,
    branch_id: value.branchId,
    code: value.code,
    status: value.status,
    price: value.price,
    version: value.version.toString(),
  };
}

export class PartyPackagesService {
  public constructor(private readonly repository: PartiesRepository) {}

  public async createPackage(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    input: {
      id?: string;
      branchId?: string;
      code: string;
      name: string;
      description?: string;
      price: string;
      currencyCode?: string;
      durationMinutes: number;
      childrenIncluded?: number;
      adultsIncluded?: number;
      childExtraCost?: string;
      adultExtraCost?: string;
      capacityMax?: number;
      extraHalfHourCost?: string;
      taxCode?: string;
      includes?: unknown;
      restrictions?: unknown;
      includedConsumables?: unknown;
    },
  ): Promise<{ value: PartyPackageRow; replayed: boolean }> {
    if (input.branchId !== undefined && !branchIds.includes(input.branchId))
      throw new PartyError('validation_error', 'The branch is not authorized for this actor.');
    const code = nonBlank(input.code, 'code', 64);
    const name = nonBlank(input.name, 'name', 160);
    const description = input.description === undefined ? null : nonBlank(input.description, 'description', 2000);
    const price = nonNegativeMoney(input.price, 'price');
    const currencyCode = normalizeCurrencyCode(input.currencyCode ?? 'MXN');
    const durationMinutes = nonNegativeInteger(input.durationMinutes, 'duration_minutes');
    if (durationMinutes <= 0) throw new PartyError('validation_error', 'duration_minutes must be greater than zero.');
    const childrenIncluded = nonNegativeInteger(input.childrenIncluded ?? 0, 'children_included');
    const adultsIncluded = nonNegativeInteger(input.adultsIncluded ?? 0, 'adults_included');
    const childExtraCost = nonNegativeMoney(input.childExtraCost ?? '0', 'child_extra_cost');
    const adultExtraCost = nonNegativeMoney(input.adultExtraCost ?? '0', 'adult_extra_cost');
    const capacityMax = input.capacityMax === undefined ? null : nonNegativeInteger(input.capacityMax, 'capacity_max');
    const extraHalfHourCost = nonNegativeMoney(input.extraHalfHourCost ?? '0', 'extra_half_hour_cost');
    const taxCode = normalizeTaxCode(input.taxCode ?? 'IVA_GENERAL');
    const includes = jsonObject(input.includes, 'includes');
    const restrictions = jsonObject(input.restrictions, 'restrictions');
    const includedConsumables = parseIncludedConsumables(input.includedConsumables, 'included_consumables');
    await validateIncludedConsumablesOwnership(this.repository, context.companyId, includedConsumables);
    const id = input.id ?? randomUUID();
    const requestHash = hash({
      branchId: input.branchId ?? null,
      code,
      name,
      price,
      durationMinutes,
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_package.create',
        key,
        requestHash,
        'party_package',
        decodePackage,
        async () => {
          const created = await this.repository.insertPackage(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId ?? null,
            code,
            name,
            description,
            price,
            currencyCode,
            durationMinutes,
            childrenIncluded,
            adultsIncluded,
            childExtraCost,
            adultExtraCost,
            capacityMax,
            extraHalfHourCost,
            taxCode,
            includes,
            restrictions,
            includedConsumables,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'party_package.created',
            resourceType: 'party_package',
            resourceId: created.id,
            eventType: 'party_package.created',
            branchId: created.branchId,
            version: created.version,
            payload: packagePayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async packageRow(companyId: string, branchIds: readonly string[], id: string): Promise<PartyPackageRow> {
    const value = await this.repository.packageRow(companyId, id);
    if (value === null || (value.branchId !== null && !branchIds.includes(value.branchId)))
      throw new PartyError('resource_not_found', 'The package was not found.');
    return value;
  }

  public listPackages(
    companyId: string,
    input: Parameters<PartiesRepository['listPackages']>[1],
  ): ReturnType<PartiesRepository['listPackages']> {
    return this.repository.listPackages(companyId, input);
  }

  public async updatePackage(
    context: PartyMutationContext,
    branchIds: readonly string[],
    id: string,
    expectedVersion: bigint,
    input: {
      name?: string;
      description?: string | null;
      status?: PartyPackageStatus;
      price?: string;
      durationMinutes?: number;
      childrenIncluded?: number;
      adultsIncluded?: number;
      childExtraCost?: string;
      adultExtraCost?: string;
      capacityMax?: number | null;
      extraHalfHourCost?: string;
      taxCode?: string;
      includes?: unknown;
      restrictions?: unknown;
      includedConsumables?: unknown;
    },
  ): Promise<PartyPackageRow> {
    const parsedIncludedConsumables =
      input.includedConsumables === undefined ? undefined : parseIncludedConsumables(input.includedConsumables, 'included_consumables');
    if (parsedIncludedConsumables !== undefined) {
      await validateIncludedConsumablesOwnership(this.repository, context.companyId, parsedIncludedConsumables);
    }
    return this.repository.transaction(async (client) => {
      const current = await this.repository.packageRow(context.companyId, id);
      if (current === null || (current.branchId !== null && !branchIds.includes(current.branchId)))
        throw new PartyError('resource_not_found', 'The package was not found.');
      const updated = await this.repository.updatePackage(client, context.companyId, id, expectedVersion, {
        ...(input.name === undefined ? {} : { name: nonBlank(input.name, 'name', 160) }),
        ...(input.description === undefined
          ? {}
          : { description: input.description === null ? null : nonBlank(input.description, 'description', 2000) }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.price === undefined ? {} : { price: nonNegativeMoney(input.price, 'price') }),
        ...(input.durationMinutes === undefined
          ? {}
          : { durationMinutes: nonNegativeInteger(input.durationMinutes, 'duration_minutes') }),
        ...(input.childrenIncluded === undefined
          ? {}
          : { childrenIncluded: nonNegativeInteger(input.childrenIncluded, 'children_included') }),
        ...(input.adultsIncluded === undefined
          ? {}
          : { adultsIncluded: nonNegativeInteger(input.adultsIncluded, 'adults_included') }),
        ...(input.childExtraCost === undefined ? {} : { childExtraCost: nonNegativeMoney(input.childExtraCost, 'child_extra_cost') }),
        ...(input.adultExtraCost === undefined ? {} : { adultExtraCost: nonNegativeMoney(input.adultExtraCost, 'adult_extra_cost') }),
        ...(input.capacityMax === undefined
          ? {}
          : { capacityMax: input.capacityMax === null ? null : nonNegativeInteger(input.capacityMax, 'capacity_max') }),
        ...(input.extraHalfHourCost === undefined
          ? {}
          : { extraHalfHourCost: nonNegativeMoney(input.extraHalfHourCost, 'extra_half_hour_cost') }),
        ...(input.taxCode === undefined ? {} : { taxCode: normalizeTaxCode(input.taxCode) }),
        ...(input.includes === undefined ? {} : { includes: jsonObject(input.includes, 'includes') }),
        ...(input.restrictions === undefined ? {} : { restrictions: jsonObject(input.restrictions, 'restrictions') }),
        ...(parsedIncludedConsumables === undefined ? {} : { includedConsumables: parsedIncludedConsumables }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'party_package.updated',
        resourceType: 'party_package',
        resourceId: updated.id,
        eventType: 'party_package.updated',
        branchId: updated.branchId,
        version: updated.version,
        payload: packagePayload(updated),
      });
      return updated;
    });
  }
}

function decodePackage(raw: unknown): PartyPackageRow {
  const value = raw as Omit<PartyPackageRow, 'version' | 'createdAt' | 'updatedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return { ...value, version: BigInt(value.version), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

export function packageQuoteInput(
  pkg: PartyPackageRow,
  input: { children: number; adults: number; extraHalfHours: number },
): PartyQuoteBreakdown {
  return computePartyQuote({
    price: pkg.price,
    childrenIncluded: pkg.childrenIncluded,
    adultsIncluded: pkg.adultsIncluded,
    childExtraCost: pkg.childExtraCost,
    adultExtraCost: pkg.adultExtraCost,
    extraHalfHourCost: pkg.extraHalfHourCost,
    children: input.children,
    adults: input.adults,
    extraHalfHours: input.extraHalfHours,
    taxCode: pkg.taxCode,
  });
}
