import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { SuppliersRepository } from './suppliers.repository.js';
import { decodeSupplierCursor, encodeSupplierCursor } from './suppliers.repository.js';
import {
  SupplierError,
  type CreateSupplierInput,
  type SupplierListPage,
  type SupplierMutationContext,
  type SupplierRow,
  type SupplierStatus,
  type UpdateSupplierInput,
} from './suppliers.types.js';

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}
function nonBlank(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new SupplierError('validation_error', `The ${field} must not be blank.`);
  if (trimmed.length > maxLength) throw new SupplierError('validation_error', `The ${field} is too long.`);
  return trimmed;
}
function nonBlankOptional(value: string | null | undefined, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const clean = value.trim();
  if (clean.length === 0) return null;
  if (clean.length > maxLength) throw new SupplierError('validation_error', `The ${field} is too long.`);
  return clean;
}
// Same format the database's own `suppliers_email_format_ck` check
// constraint enforces (`packages/database/src/schema/suppliers.ts`) —
// validated server-side FIRST so a malformed email is rejected with a
// clean `validation_error`, never surfaced as a raw constraint-violation
// error from Postgres.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
function normalizeEmail(value: string | null | undefined): string | null {
  const clean = nonBlankOptional(value, 'email', 254);
  if (clean === null) return null;
  if (!EMAIL_PATTERN.test(clean)) throw new SupplierError('validation_error', 'The email address is not valid.');
  return clean;
}

function supplierPayload(value: SupplierRow): Readonly<Record<string, unknown>> {
  return {
    supplier_id: value.id,
    name: value.name,
    status: value.status,
  };
}
function decodeSupplier(raw: unknown): SupplierRow {
  const value = raw as Omit<SupplierRow, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
  return { ...value, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

export class SuppliersService {
  public constructor(private readonly repository: SuppliersRepository) {}

  /**
   * Creates one supplier inside a single transaction: (1) validate
   * name/email, (2) a pre-insert conflict check against the same
   * `(company_id, name)` pair `suppliers_company_name_uq` itself enforces
   * — so a duplicate name gets a clean, actionable `resource_conflict`
   * BEFORE ever reaching the database's own constraint, never a bare
   * constraint-violation error (Part — "return a clear conflict error
   * before hitting the DB unique constraint"). The database constraint
   * remains the real backstop for a genuine concurrent race between two
   * requests (`SuppliersRepository.mapDatabaseError`).
   */
  public async createSupplier(
    context: SupplierMutationContext,
    key: string,
    input: CreateSupplierInput,
  ): Promise<{ value: SupplierRow; replayed: boolean }> {
    const name = nonBlank(input.name, 'name', 200);
    const contactName = nonBlankOptional(input.contactName, 'contact name', 200);
    const phone = nonBlankOptional(input.phone, 'phone', 32);
    const email = normalizeEmail(input.email);
    const notes = nonBlankOptional(input.notes, 'notes', 2000);
    const id = input.id ?? randomUUID();
    const requestHash = hash({
      name,
      contactName,
      phone,
      email,
      notes,
      id: input.id ?? null,
    });
    return this.repository.transaction(async (client) =>
      this.repository.idempotent(
        client,
        context,
        'supplier.create',
        key,
        requestHash,
        'supplier',
        decodeSupplier,
        async () => {
          // The conflict pre-check must live INSIDE this `create()`
          // closure, never before the `idempotent()` call above — `create`
          // only ever runs for a genuinely NEW idempotency key (see
          // `SuppliersRepository.idempotent`'s own doc comment); a REPLAY
          // of an already-succeeded create returns the cached response
          // without re-running this closure at all. Running this check
          // unconditionally before `idempotent()` (this file's own first,
          // incorrect draft) would re-find the row the FIRST call just
          // inserted on every replay and reject it as a false conflict —
          // caught by this module's own idempotency-replay integration
          // test.
          const existing = await this.repository.supplierByName(client, context.companyId, name);
          if (existing !== null)
            throw new SupplierError('resource_conflict', 'A supplier with this name already exists.', {
              existing_supplier_id: existing.id,
            });
          const created = await this.repository.insertSupplier(client, {
            id,
            companyId: context.companyId,
            name,
            contactName,
            phone,
            email,
            notes,
            createdBy: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'supplier.created',
            resourceType: 'supplier',
            resourceId: created.id,
            eventType: 'supplier.created',
            payload: supplierPayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async supplier(companyId: string, id: string): Promise<SupplierRow> {
    const value = await this.repository.supplier(null, companyId, id);
    if (value === null) throw new SupplierError('resource_not_found', 'The supplier was not found.');
    return value;
  }

  public async listSuppliers(
    companyId: string,
    input: { limit: number; cursor?: string; status?: SupplierStatus },
  ): Promise<SupplierListPage> {
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const cursor = input.cursor === undefined ? null : decodeSupplierCursor(input.cursor);
    const rows = await this.repository.listSuppliers(companyId, {
      status: input.status ?? null,
      cursor,
      limit,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeSupplierCursor(last.createdAt, last.id) : null,
    };
  }

  /** Update — any field except `id`/`companyId`, per this wave's explicit
   * instruction. A name change is re-checked against the exact same
   * conflict rule `createSupplier` applies (excluding this supplier's own
   * row), so renaming a supplier onto an existing one's name is rejected
   * exactly like creating a duplicate would be. */
  public async updateSupplier(
    context: SupplierMutationContext,
    id: string,
    input: UpdateSupplierInput,
  ): Promise<SupplierRow> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.supplier(client, context.companyId, id);
      if (current === null) throw new SupplierError('resource_not_found', 'The supplier was not found.');
      const name = input.name === undefined ? undefined : nonBlank(input.name, 'name', 200);
      if (name !== undefined && name !== current.name) {
        const existing = await this.repository.supplierByName(client, context.companyId, name);
        if (existing !== null && existing.id !== id)
          throw new SupplierError('resource_conflict', 'A supplier with this name already exists.', {
            existing_supplier_id: existing.id,
          });
      }
      const updated = await this.repository.updateSupplier(client, context.companyId, id, {
        ...(name === undefined ? {} : { name }),
        ...(input.contactName === undefined ? {} : { contactName: nonBlankOptional(input.contactName, 'contact name', 200) }),
        ...(input.phone === undefined ? {} : { phone: nonBlankOptional(input.phone, 'phone', 32) }),
        ...(input.email === undefined ? {} : { email: normalizeEmail(input.email) }),
        ...(input.notes === undefined ? {} : { notes: nonBlankOptional(input.notes, 'notes', 2000) }),
        ...(input.status === undefined ? {} : { status: input.status }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'supplier.updated',
        resourceType: 'supplier',
        resourceId: updated.id,
        eventType: 'supplier.updated',
        payload: supplierPayload(updated),
      });
      return updated;
    });
  }

  /** Never a hard delete — once any `direct_purchases` row may reference
   * a supplier, deactivation is the only "removal" (per this wave's
   * explicit instruction). A thin, single-purpose wrapper over
   * `updateSupplier`'s exact same code path, never a second one. */
  public async deactivateSupplier(context: SupplierMutationContext, id: string): Promise<SupplierRow> {
    return this.updateSupplier(context, id, { status: 'inactive' });
  }
}
