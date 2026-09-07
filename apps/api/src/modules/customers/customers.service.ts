import { createHash, randomUUID } from 'node:crypto';

import {
  type CustomersRepository,
  decodeCustomerCursor,
  encodeCustomerCursor,
} from './customers.repository.js';
import { normalizeEmail, normalizePhone } from './phone-normalization.js';
import {
  CustomerError,
  type CreateCustomerInput,
  type CustomerListPage,
  type CustomerMutationContext,
  type CustomerQrTokenRow,
  type CustomerRow,
  type CustomerSearchQuery,
  type UpdateCustomerInput,
} from './customers.types.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new CustomerError('validation_error', `The ${field} must not be blank.`);
  return trimmed;
}

function deriveDisplayName(firstName: string, lastName: string | null, explicit: string | undefined): string {
  if (explicit !== undefined && explicit.trim().length > 0) return explicit.trim();
  return [firstName, lastName ?? ''].join(' ').trim();
}

function requirePermission(context: CustomerMutationContext, permission: string): void {
  if (!context.actorPermissions.includes(permission))
    throw new CustomerError('validation_error', `This actor is not authorized (${permission}).`);
}

/** TASK 13.1A — `idempotent()`'s own persisted `response_body` is real
 * JSON: a prior `JSON.stringify(value)` already turned `createdAt`/
 * `updatedAt` into ISO strings and `version` into a decimal string,
 * since JSON has neither type. A REPLAYED call must reconstruct a real
 * `CustomerRow` from that shape — a bare `as CustomerRow` cast (this
 * call's previous shorthand) left those two fields STRINGS at runtime
 * despite their declared `Date` type, so the first `.toISOString()`
 * call downstream (`customerHttp`) would throw on any replayed
 * `POST /customers`. Mirrors `customer()`'s own DB-row reconstruction in
 * `customers.repository.ts` — `new Date(...)` is correct whether the
 * input is already a `Date` instance or an ISO string, so this is safe
 * to apply uniformly regardless of source. See ADR-0018 "Idempotent
 * replay decoding" (rewards) for the identical fix and reasoning; this
 * is the same class of bug, found and fixed here across every other
 * affected module (TASK 13.1A). */
function decodeCustomer(value: unknown): CustomerRow {
  const row = value as Omit<CustomerRow, 'version' | 'createdAt' | 'updatedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return {
    ...row,
    version: BigInt(row.version),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export class CustomersService {
  public constructor(private readonly repository: CustomersRepository) {}

  /** Part C — normalizes email/phone against the company's own explicit
   * `customers.default_country_code` setting; never guesses. Exposed
   * (not private) so `CustomersService.updateCustomer` and a future
   * quick-registration helper can reuse the exact same logic. */
  public async normalizeIdentity(
    companyId: string,
    email: string | undefined,
    phone: string | undefined,
  ): Promise<{
    email: string | null;
    normalizedEmail: string | null;
    phone: string | null;
    normalizedPhone: string | null;
    phoneCountryCode: string | null;
  }> {
    const trimmedEmail = email?.trim() ?? '';
    const normalizedEmail = trimmedEmail.length === 0 ? null : normalizeEmail(trimmedEmail);
    if (trimmedEmail.length > 0 && normalizedEmail === null)
      throw new CustomerError('validation_error', 'The email address is not valid.');
    const trimmedPhone = phone?.trim() ?? '';
    if (trimmedPhone.length === 0)
      return {
        email: trimmedEmail.length === 0 ? null : trimmedEmail,
        normalizedEmail,
        phone: null,
        normalizedPhone: null,
        phoneCountryCode: null,
      };
    const defaultCountry = await this.repository.defaultCountryCode(companyId);
    const { normalizedPhone, countryCode } = normalizePhone(trimmedPhone, defaultCountry);
    return {
      email: trimmedEmail.length === 0 ? null : trimmedEmail,
      normalizedEmail,
      phone: trimmedPhone,
      normalizedPhone,
      phoneCountryCode: countryCode,
    };
  }

  /** Part D — the pre-insert conflict check. Never merges; returns an
   * explicit, actionable conflict (Part I: "offer/select existing"). */
  private async assertNoConflict(
    companyId: string,
    normalizedEmail: string | null,
    normalizedPhone: string | null,
    excludeCustomerId: string | null,
  ): Promise<void> {
    const [byEmail, byPhone] = await Promise.all([
      normalizedEmail === null ? null : this.repository.customerByNormalizedEmail(null, companyId, normalizedEmail),
      normalizedPhone === null ? null : this.repository.customerByNormalizedPhone(null, companyId, normalizedPhone),
    ]);
    const emailMatch = byEmail !== null && byEmail.id !== excludeCustomerId ? byEmail : null;
    const phoneMatch = byPhone !== null && byPhone.id !== excludeCustomerId ? byPhone : null;
    if (emailMatch !== null && phoneMatch !== null && emailMatch.id !== phoneMatch.id) {
      throw new CustomerError(
        'customer_identity_conflict',
        'The email and phone number belong to two different existing customers.',
        { email_customer_id: emailMatch.id, phone_customer_id: phoneMatch.id },
      );
    }
    if (emailMatch !== null) {
      throw new CustomerError('resource_conflict', 'A customer with this email already exists.', {
        existing_customer_id: emailMatch.id,
      });
    }
    if (phoneMatch !== null) {
      throw new CustomerError('resource_conflict', 'A customer with this phone number already exists.', {
        existing_customer_id: phoneMatch.id,
      });
    }
  }

  public async createCustomer(
    context: CustomerMutationContext,
    key: string,
    input: CreateCustomerInput,
  ): Promise<{ value: CustomerRow; replayed: boolean }> {
    requirePermission(context, 'customer.create');
    const firstName = nonBlank(input.firstName, 'first name');
    const lastName = input.lastName?.trim() === undefined || input.lastName.trim().length === 0
      ? null
      : input.lastName.trim();
    const displayName = nonBlank(deriveDisplayName(firstName, lastName, input.displayName), 'display name');
    const identity = await this.normalizeIdentity(context.companyId, input.email, input.phone);
    if (input.birthDate !== undefined && Number.isNaN(new Date(input.birthDate).getTime()))
      throw new CustomerError('validation_error', 'The birth date is not valid.');
    const id = randomUUID();
    // The hash must be stable across a genuine retry of the SAME logical
    // request — `id` is server-generated fresh every call (no client-
    // supplied id exists for a customer), so it must never be part of the
    // hash; only `input` (the caller's own request body) is.
    const requestHash = hash(input);
    return this.repository.transaction(async (client) => {
      await this.assertNoConflict(context.companyId, identity.normalizedEmail, identity.normalizedPhone, null);
      return this.repository.idempotent(
        client,
        context,
        'customer.create',
        key,
        requestHash,
        decodeCustomer,
        async () => {
          const created = await this.repository.insertCustomer(client, {
            id,
            companyId: context.companyId,
            firstName,
            lastName,
            displayName,
            email: identity.email,
            normalizedEmail: identity.normalizedEmail,
            phone: identity.phone,
            normalizedPhone: identity.normalizedPhone,
            phoneCountryCode: identity.phoneCountryCode,
            birthDate: input.birthDate ?? null,
            notes: input.notes?.trim() === undefined || input.notes.trim().length === 0 ? null : input.notes.trim(),
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'customer.created',
            resourceType: 'customer',
            resourceId: created.id,
            eventType: 'customer.created',
            version: created.version,
            payload: { customer_id: created.id, status: created.status },
          });
          return created;
        },
      );
    });
  }

  public async updateCustomer(
    context: CustomerMutationContext,
    id: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerRow> {
    requirePermission(context, 'customer.update');
    return this.repository.transaction(async (client) => {
      const current = await this.repository.customer(client, context.companyId, id);
      if (current === null) throw new CustomerError('resource_not_found', 'The customer was not found.');
      let identity: {
        email: string | null;
        normalizedEmail: string | null;
        phone: string | null;
        normalizedPhone: string | null;
        phoneCountryCode: string | null;
      } | null = null;
      if (input.email !== undefined || input.phone !== undefined) {
        identity = await this.normalizeIdentity(
          context.companyId,
          input.email ?? current.email ?? undefined,
          input.phone ?? current.phone ?? undefined,
        );
        await this.assertNoConflict(context.companyId, identity.normalizedEmail, identity.normalizedPhone, id);
      }
      const firstName = input.firstName === undefined ? undefined : nonBlank(input.firstName, 'first name');
      const lastName =
        input.lastName === undefined ? undefined : input.lastName.trim().length === 0 ? null : input.lastName.trim();
      const displayName =
        input.displayName !== undefined
          ? nonBlank(input.displayName, 'display name')
          : firstName !== undefined || lastName !== undefined
            ? deriveDisplayName(firstName ?? current.firstName, lastName ?? current.lastName, undefined)
            : undefined;
      if (input.birthDate !== undefined && Number.isNaN(new Date(input.birthDate).getTime()))
        throw new CustomerError('validation_error', 'The birth date is not valid.');
      const updated = await this.repository.updateCustomer(client, context.companyId, id, input.expectedVersion, {
        ...(firstName === undefined ? {} : { firstName }),
        ...(lastName === undefined ? {} : { lastName }),
        ...(displayName === undefined ? {} : { displayName }),
        ...(identity === null
          ? {}
          : {
              email: identity.email,
              normalizedEmail: identity.normalizedEmail,
              phone: identity.phone,
              normalizedPhone: identity.normalizedPhone,
              phoneCountryCode: identity.phoneCountryCode,
            }),
        ...(input.birthDate === undefined ? {} : { birthDate: input.birthDate }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.notes === undefined
          ? {}
          : { notes: input.notes.trim().length === 0 ? null : input.notes.trim() }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'customer.updated',
        resourceType: 'customer',
        resourceId: updated.id,
        eventType: 'customer.updated',
        version: updated.version,
        payload: { customer_id: updated.id, status: updated.status },
      });
      return updated;
    });
  }

  public async customer(context: { companyId: string; actorPermissions: readonly string[] }, id: string): Promise<CustomerRow> {
    requirePermission(context as CustomerMutationContext, 'customer.read');
    const row = await this.repository.customer(null, context.companyId, id);
    if (row === null) throw new CustomerError('resource_not_found', 'The customer was not found.');
    return row;
  }

  public async listCustomers(
    context: { companyId: string; actorPermissions: readonly string[] },
    query: CustomerSearchQuery,
  ): Promise<CustomerListPage> {
    requirePermission(context as CustomerMutationContext, 'customer.read');
    const limit = Math.min(Math.max(query.limit, 1), 100);
    const cursor = query.cursor === undefined || query.cursor.length === 0 ? null : decodeCustomerCursor(query.cursor);
    const rows = await this.repository.listCustomers(context.companyId, {
      search: query.search === undefined || query.search.trim().length === 0 ? null : query.search,
      status: query.status ?? null,
      cursor,
      limit,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor: hasMore && last !== undefined ? encodeCustomerCursor(last.createdAt, last.id) : null,
    };
  }

  // --- QR identity (Part U) ---------------------------------------------

  public async issueQrToken(
    context: CustomerMutationContext,
    customerId: string,
  ): Promise<CustomerQrTokenRow> {
    requirePermission(context, 'customer.update');
    return this.repository.transaction(async (client) => {
      const found = await this.repository.customer(client, context.companyId, customerId);
      if (found === null) throw new CustomerError('resource_not_found', 'The customer was not found.');
      const issued = await this.repository.issueQrToken(client, context.companyId, customerId, context.timestamp);
      await this.repository.auditAndPublish(client, context, {
        action: 'customer.qr_token.issued',
        resourceType: 'customer_qr_token',
        resourceId: issued.id,
        eventType: 'customer.qr_token.issued',
        version: 1n,
        // Part U/W — the token itself never rides in an audit/outbox
        // payload; it is a bearer-style presentation credential, and this
        // trail only needs to prove WHEN a rotation happened, not WHAT the
        // new value is.
        payload: { customer_id: customerId },
      });
      return issued;
    });
  }

  public async activeQrToken(
    context: { companyId: string; actorPermissions: readonly string[] },
    customerId: string,
  ): Promise<CustomerQrTokenRow | null> {
    requirePermission(context as CustomerMutationContext, 'customer.read');
    const found = await this.repository.customer(null, context.companyId, customerId);
    if (found === null) throw new CustomerError('resource_not_found', 'The customer was not found.');
    return this.repository.activeQrTokenForCustomer(context.companyId, customerId);
  }

  /** Server-side resolution of a scanned/presented QR token — Part U: "not
   * authentication for sensitive account actions", so the caller (route
   * layer) must still separately authorize whatever it does with the
   * resolved customer id. Rejects a token that resolves to a DIFFERENT
   * company than the caller's own authenticated context — a QR token is
   * never trusted to imply tenant scope by itself. */
  public async resolveQrToken(
    context: { companyId: string; actorPermissions: readonly string[] },
    token: string,
  ): Promise<CustomerRow> {
    requirePermission(context as CustomerMutationContext, 'customer.read');
    const resolved = await this.repository.customerByQrToken(token);
    if (resolved === null) throw new CustomerError('qr_token_invalid', 'The QR token is not valid.');
    if (resolved.status !== 'active' || resolved.companyId !== context.companyId)
      throw new CustomerError('qr_token_invalid', 'The QR token is not valid.');
    const found = await this.repository.customer(null, context.companyId, resolved.customerId);
    if (found === null) throw new CustomerError('qr_token_invalid', 'The QR token is not valid.');
    return found;
  }
}
