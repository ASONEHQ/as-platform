import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { SalesRepository } from '../sales/sales.repository.js';
import { SalesService } from '../sales/sales.service.js';
import { mapCustomerError } from './customers.http-errors.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';
import { type CustomerError } from './customers.types.js';

/** TASK 13.0 — Customers foundation. Genuinely new domain (see ADR-0017);
 * nothing pre-existing to reconcile against. Covers Part AK's CUSTOMERS
 * and SALE LINK matrices. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

integration('PostgreSQL customers foundation (TASK 13.0)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let customers: CustomersService;
  let sales: SalesService;
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const productId = randomUUID();
  const context = {
    companyId,
    actorId: userId,
    actorPermissions: ['customer.read', 'customer.create', 'customer.update', 'sale.create'],
    requestId: 'cust-request',
    correlationId: 'cust-correlation',
    timestamp: new Date('2026-09-04T20:00:00.000Z'),
  };

  async function applyIfMissing(regclass: string, files: readonly string[]): Promise<void> {
    const check = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.${regclass}')::text present`,
    );
    if (check.rows[0]?.present !== null) return;
    for (const file of files) {
      const sql = await readFile(resolve(migrationsPath, file), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-customers-integration' });
    await applyIfMissing('companies', [
      '0000_fantastic_black_cat.sql',
      '0001_high_thor.sql',
      '0002_true_sugar_man.sql',
      '0003_curved_zuras.sql',
      '0004_pink_nehzno.sql',
      '0005_inventory_operations_foundation.sql',
      '0006_inventory_transfers_and_reservations.sql',
      '0007_inventory_counts_foundation.sql',
      '0008_inventory_reconciliation_findings.sql',
      '0009_auth_login_challenges.sql',
      '0010_auth_session_transport_mode.sql',
    ]);
    await applyIfMissing('product_prices', ['0011_product_pricing_foundation.sql']);
    await applyIfMissing('payment_terminals', ['0012_payment_and_terminal_foundation.sql']);
    await applyIfMissing('sales', ['0013_sale_foundation.sql', '0014_sale_id_required.sql']);
    await applyIfMissing('cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    await applyIfMissing('refunds', ['0019_nosy_the_twelve.sql']);
    await applyIfMissing('promotions', ['0020_broad_ben_grimm.sql']);
    await applyIfMissing('customers', ['0021_powerful_ezekiel_stane.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Cust Co','Cust Co',$2,'active','America/Mexico_City','MXN','es-MX'),
             ($3,'Other Co','Other Co',$4,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `cust-${companyId}`, otherCompanyId, `cust-other-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Cust Main','CMAIN','active','America/Mexico_City')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Cust Cashier','active'),($3,$4,$4,'Other Cashier','active')`,
      [userId, `cust-${userId}@example.test`, otherCompanyUserId, `cust-other-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'CUST-GENERAL','cust-general','Cust Product','simple',false,'IVA_GENERAL','active',$3,$3)`,
      [productId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_prices (id,company_id,product_id,amount,currency_code,status,created_by,updated_by)
       values($1,$2,$3,'50.0000','MXN','active',$4,$4)`,
      [randomUUID(), companyId, productId, userId],
    );
    // Part C — explicit company config, never a hardcoded default: this
    // is what lets a bare 10-digit local number normalize to E.164 below.
    await database.pool.query(
      `insert into company_settings (id,company_id,key,value,value_type,status,created_by,updated_by)
       values ($1,$2,'customers.default_country_code','"MX"'::jsonb,'string','active',$3,$3)`,
      [randomUUID(), companyId, userId],
    );

    const customersRepository = new CustomersRepository(database);
    customers = new CustomersService(customersRepository);
    const salesRepository = new SalesRepository(database);
    sales = new SalesService(salesRepository, undefined, customersRepository);
  });

  afterEach(async () => {
    await database.pool.query('delete from sale_items where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from sales where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from customer_qr_tokens where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from customers where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from idempotency_keys where company_id in ($1,$2)', [companyId, otherCompanyId]);
  });

  afterAll(async () => {
    await database.pool.query('delete from outbox_events where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from company_settings where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from product_prices where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherCompanyId]);
    await database.pool.query('delete from users where id in ($1,$2)', [userId, otherCompanyUserId]);
    await database.close();
  });

  describe('create / read / update / search', () => {
    it('creates a customer with the minimum required field (first name only)', async () => {
      const created = await customers.createCustomer(context, 'cust-create-min', { firstName: 'Ana' });
      expect(created.value.firstName).toBe('Ana');
      expect(created.value.displayName).toBe('Ana');
      expect(created.value.status).toBe('active');
      expect(created.value.email).toBeNull();
      expect(created.value.phone).toBeNull();
    });

    // TASK 16.23A — a pre-launch audit found this service's own local
    // requirePermission threw 'validation_error' (mapped to HTTP 400),
    // contradicting every customers route's own declared 403 response
    // and the identical, correctly-403 pattern every other permission
    // check in this codebase uses. Never a security bypass — the action
    // was always blocked — but a real status-code/contract bug.
    it('an actor missing customer.create is rejected with a real 403, not 400', async () => {
      const restricted = { ...context, actorPermissions: ['customer.read'] };
      const attempt = customers.createCustomer(restricted, 'cust-create-denied', { firstName: 'Denied' });
      await expect(attempt).rejects.toMatchObject({ code: 'permission_denied' });
      try {
        await customers.createCustomer(restricted, 'cust-create-denied-2', { firstName: 'Denied' });
        expect.unreachable('expected createCustomer to throw');
      } catch (error) {
        expect((mapCustomerError(error) as { statusCode?: number }).statusCode).toBe(403);
      }
    });

    it('reads a customer back by id', async () => {
      const created = await customers.createCustomer(context, 'cust-create-read', { firstName: 'Beto', lastName: 'Torres' });
      const read = await customers.customer(context, created.value.id);
      expect(read.displayName).toBe('Beto Torres');
    });

    it('updates a customer with optimistic version checking', async () => {
      const created = await customers.createCustomer(context, 'cust-create-update', { firstName: 'Carla' });
      const updated = await customers.updateCustomer(context, created.value.id, {
        notes: 'Prefers window seating',
        expectedVersion: created.value.version,
      });
      expect(updated.notes).toBe('Prefers window seating');
      expect(updated.version).toBe(created.value.version + 1n);
      await expect(
        customers.updateCustomer(context, created.value.id, {
          notes: 'stale write',
          expectedVersion: created.value.version, // now stale
        }),
      ).rejects.toMatchObject({ code: 'version_conflict' });
    });

    it('searches by display name substring and by exact normalized phone', async () => {
      await customers.createCustomer(context, 'cust-search-1', { firstName: 'Diego', lastName: 'Flores', phone: '+52 442 555 1111' });
      await customers.createCustomer(context, 'cust-search-2', { firstName: 'Elena', lastName: 'Ruiz' });
      const byName = await customers.listCustomers(context, { companyId, search: 'Diego', limit: 10 });
      expect(byName.items.map((c) => c.displayName)).toEqual(['Diego Flores']);
      const byPhone = await customers.listCustomers(context, { companyId, search: '+524425551111', limit: 10 });
      expect(byPhone.items.map((c) => c.displayName)).toEqual(['Diego Flores']);
    });

    it('archives rather than destructively deletes — status transitions to archived, the row remains readable', async () => {
      const created = await customers.createCustomer(context, 'cust-archive-1', { firstName: 'Fabian' });
      const archived = await customers.updateCustomer(context, created.value.id, {
        status: 'archived',
        expectedVersion: created.value.version,
      });
      expect(archived.status).toBe('archived');
      const stillReadable = await customers.customer(context, created.value.id);
      expect(stillReadable.id).toBe(created.value.id);
    });

    it('tenant isolation: a customer created under one company is invisible to another', async () => {
      const created = await customers.createCustomer(context, 'cust-tenant-1', { firstName: 'Gilberto' });
      const otherContext = { ...context, companyId: otherCompanyId };
      await expect(customers.customer(otherContext, created.value.id)).rejects.toMatchObject({
        code: 'resource_not_found',
      });
    });
  });

  describe('email/phone normalization and duplicate/conflict policy (Part C/D)', () => {
    it('normalizes email to lowercase+trimmed for storage and dedup', async () => {
      const created = await customers.createCustomer(context, 'cust-norm-email-1', {
        firstName: 'Hugo',
        email: '  Hugo.Ramirez@Example.COM  ',
      });
      expect(created.value.normalizedEmail).toBe('hugo.ramirez@example.com');
    });

    it('rejects creating a second customer with the same normalized email', async () => {
      await customers.createCustomer(context, 'cust-dup-email-1a', { firstName: 'Irma', email: 'irma@example.test' });
      await expect(
        customers.createCustomer(context, 'cust-dup-email-1b', { firstName: 'Irma Two', email: 'IRMA@Example.test' }),
      ).rejects.toMatchObject({ code: 'resource_conflict' });
    });

    it('rejects creating a second customer with the same normalized phone', async () => {
      await customers.createCustomer(context, 'cust-dup-phone-1a', { firstName: 'Javier', phone: '+52 442 777 2222' });
      await expect(
        customers.createCustomer(context, 'cust-dup-phone-1b', { firstName: 'Javier Two', phone: '442-777-2222' }),
      ).rejects.toMatchObject({ code: 'resource_conflict' });
    });

    it('a different company may reuse the same email/phone — dedup is company-scoped', async () => {
      await customers.createCustomer(context, 'cust-scope-email-1', { firstName: 'Karla', email: 'shared@example.test' });
      const otherContext = { ...context, companyId: otherCompanyId, actorId: otherCompanyUserId };
      await expect(
        customers.createCustomer(otherContext, 'cust-scope-email-2', { firstName: 'Karla Other', email: 'shared@example.test' }),
      ).resolves.toBeDefined();
    });

    it('conflicting identity: email matches one existing customer, phone matches a DIFFERENT one — explicit conflict, no merge', async () => {
      const first = await customers.createCustomer(context, 'cust-conflict-1a', { firstName: 'Luis', email: 'luis@example.test' });
      const second = await customers.createCustomer(context, 'cust-conflict-1b', { firstName: 'Mario', phone: '+52 442 888 3333' });
      await expect(
        customers.createCustomer(context, 'cust-conflict-1c', {
          firstName: 'Confused',
          email: 'luis@example.test',
          phone: '442-888-3333',
        }),
      ).rejects.toMatchObject({ code: 'customer_identity_conflict' });
      void first;
      void second;
    });

    it('concurrent duplicate creation: two simultaneous requests for the same email — exactly one succeeds', async () => {
      const email = 'concurrent@example.test';
      const attempts = await Promise.allSettled([
        customers.createCustomer(context, 'cust-concurrent-1a', { firstName: 'Nadia', email }),
        customers.createCustomer(context, 'cust-concurrent-1b', { firstName: 'Nadia Two', email }),
      ]);
      const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
      const rejected = attempts.filter((a) => a.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejection = rejected[0];
      if (rejection?.status !== 'rejected') throw new Error('Expected a rejection.');
      // Whichever of the two loses the race is rejected as a duplicate —
      // `resource_conflict` regardless of whether the SERVICE pre-check or
      // the DATABASE unique constraint is what actually caught it (a race
      // can have either win); `customer_identity_conflict` is reserved for
      // the distinct "email and phone point to two different existing
      // customers" cross-match case, covered separately above.
      expect((rejection.reason as CustomerError).code).toBe('resource_conflict');
    });

    it('idempotency: retrying the exact same request under the same key replays the original row, never a duplicate', async () => {
      const first = await customers.createCustomer(context, 'cust-idempotent-SAME-KEY', { firstName: 'Olga' });
      const replay = await customers.createCustomer(context, 'cust-idempotent-SAME-KEY', { firstName: 'Olga' });
      expect(replay.replayed).toBe(true);
      expect(replay.value.id).toBe(first.value.id);
      const count = await database.pool.query<{ n: number }>('select count(*)::int as n from customers where company_id=$1 and first_name=$2', [
        companyId,
        'Olga',
      ]);
      expect(count.rows[0]?.n).toBe(1);
    });
  });

  describe('QR identity (Part U)', () => {
    it('issues an opaque token that never contains raw email/phone/name, and rotation revokes the prior one', async () => {
      const created = await customers.createCustomer(context, 'cust-qr-1', {
        firstName: 'Olivia',
        email: 'olivia@example.test',
        phone: '+52 442 999 4444',
      });
      const first = await customers.issueQrToken(context, created.value.id);
      expect(first.token).not.toMatch(/olivia/iu);
      expect(first.token).not.toMatch(/example\.test/iu);
      expect(first.token).not.toMatch(/4444/u);
      expect(first.token.length).toBeGreaterThanOrEqual(16);
      const second = await customers.issueQrToken(context, created.value.id);
      expect(second.token).not.toBe(first.token);
      const active = await customers.activeQrToken(context, created.value.id);
      expect(active?.id).toBe(second.id);
      const resolved = await customers.resolveQrToken(context, second.token);
      expect(resolved.id).toBe(created.value.id);
      await expect(customers.resolveQrToken(context, first.token)).rejects.toMatchObject({
        code: 'qr_token_invalid',
      });
    });

    it('a token never resolves across a different company', async () => {
      const created = await customers.createCustomer(context, 'cust-qr-2', { firstName: 'Pablo' });
      const issued = await customers.issueQrToken(context, created.value.id);
      const otherContext = { ...context, companyId: otherCompanyId };
      await expect(customers.resolveQrToken(otherContext, issued.token)).rejects.toMatchObject({
        code: 'qr_token_invalid',
      });
    });
  });

  describe('Sale link (Part G/H) and receipt snapshot (Part AB)', () => {
    it('a walk-in sale (no customer) continues to work exactly as before', async () => {
      const created = await sales.createSale(context, [branchId], 'cust-sale-walkin-1', {
        branchId,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.customerId).toBeNull();
      expect(created.value.sale.customerDisplayName).toBeNull();
    });

    it('a sale with a customer attaches the id and snapshots the display name at that moment', async () => {
      const customer = await customers.createCustomer(context, 'cust-sale-attach-1', { firstName: 'Quiroga' });
      const created = await sales.createSale(context, [branchId], 'cust-sale-attach-1-sale', {
        branchId,
        customerId: customer.value.id,
        items: [{ productId, quantity: '1' }],
      });
      expect(created.value.sale.customerId).toBe(customer.value.id);
      expect(created.value.sale.customerDisplayName).toBe('Quiroga');
    });

    it('a customer id from a different company is rejected outright, never silently attached', async () => {
      const otherContext = { ...context, companyId: otherCompanyId, actorId: otherCompanyUserId };
      const otherCustomer = await customers.createCustomer(otherContext, 'cust-sale-wrongco-1', { firstName: 'Renata' });
      await expect(
        sales.createSale(context, [branchId], 'cust-sale-wrongco-1-sale', {
          branchId,
          customerId: otherCustomer.value.id,
          items: [{ productId, quantity: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });

    it('a later customer name edit never rewrites a prior sale\'s frozen display-name snapshot', async () => {
      const customer = await customers.createCustomer(context, 'cust-sale-snapshot-1', { firstName: 'Sofia' });
      const created = await sales.createSale(context, [branchId], 'cust-sale-snapshot-1-sale', {
        branchId,
        customerId: customer.value.id,
        items: [{ productId, quantity: '1' }],
      });
      await customers.updateCustomer(context, customer.value.id, {
        firstName: 'Sofia Renamed',
        displayName: 'Sofia Renamed',
        expectedVersion: customer.value.version,
      });
      const reread = await sales.sale(companyId, [branchId], created.value.sale.id);
      expect(reread.sale.customerDisplayName).toBe('Sofia');
    });
  });
});
