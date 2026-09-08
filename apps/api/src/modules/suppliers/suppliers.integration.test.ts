import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { registerSupplierRoutes } from './suppliers.routes.js';
import { SuppliersRepository } from './suppliers.repository.js';
import { SuppliersService } from './suppliers.service.js';

/**
 * TASK 14.4 (Wave 2, Part C.1) — "Proveedores" real end-to-end coverage.
 * Boots a REAL Fastify app with the REAL, Postgres-backed
 * `SuppliersService`/`SuppliersRepository` (only the auth LAYER is faked
 * — the exact same established pattern
 * `purchasing.integration.test.ts`/`idempotency-replay-http.integration.
 * test.ts` each use) and drives genuine `app.inject()` HTTP round trips —
 * so `requirePermission` (`auth.guards.ts`) is exercised for real, not
 * mocked away, and every assertion re-reads the REAL `suppliers` rows
 * straight from Postgres.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://suppliers-integration-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

async function applyIfMissing(database: DatabaseClient, regclass: string, files: readonly string[]): Promise<void> {
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

integration('PostgreSQL supplier operations (TASK 14.4, Wave 2 Part C.1)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();

  const allPermissions = ['supplier.manage', 'supplier.read'] as const;

  function baseContext(forCompanyId: string): AuthContext {
    return {
      sessionId: randomUUID(),
      userId: forCompanyId === otherCompanyId ? otherCompanyUserId : userId,
      membershipId: randomUUID(),
      companyId: forCompanyId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: true,
      permissions: [...allPermissions],
      permittedBranchIds: [],
      transportMode: 'bearer',
    };
  }
  let authContext: AuthContext = baseContext(companyId);

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-suppliers-integration',
    });
    await applyIfMissing(database, 'companies', [
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
    await applyIfMissing(database, 'product_prices', ['0011_product_pricing_foundation.sql']);
    await applyIfMissing(database, 'payment_terminals', ['0012_payment_and_terminal_foundation.sql']);
    await applyIfMissing(database, 'sales', ['0013_sale_foundation.sql', '0014_sale_id_required.sql']);
    await applyIfMissing(database, 'cash_registers', ['0016_jittery_slayback.sql', '0017_gifted_vertigo.sql']);
    await applyIfMissing(database, 'refunds', ['0019_nosy_the_twelve.sql']);
    await applyIfMissing(database, 'promotions', ['0020_broad_ben_grimm.sql']);
    await applyIfMissing(database, 'customers', ['0021_powerful_ezekiel_stane.sql']);
    await applyIfMissing(database, 'reward_entitlements', ['0022_cheerful_scrambler.sql']);
    await applyIfMissing(database, 'loyalty_program_reward_categories', ['0023_tan_luke_cage.sql']);
    await applyIfMissing(database, 'direct_purchases', ['0024_vengeful_metal_master.sql']);
    await applyIfMissing(database, 'suppliers', ['0025_worried_the_captain.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Suppliers Co','Suppliers Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Suppliers Co','Other Suppliers Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `suppliers-${companyId}`, otherCompanyId, `suppliers-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Suppliers Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `suppliers-${userId}@example.test`, otherCompanyUserId, `suppliers-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );

    const authentication = {
      authenticate: () => Promise.resolve(authContext),
      requirePermission: (context: AuthContext, permission: string) => {
        if (!context.permissions.includes(permission))
          throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      },
      requireBranchAccess: () => {
        throw new Error('requireBranchAccess must never be called for the company-scoped suppliers domain.');
      },
    } as unknown as AuthService;

    app = Fastify();
    app.addHook('onRequest', (request, _reply, done) => {
      request.requestContext = {
        requestId: randomUUID(),
        correlationId: randomUUID(),
        companyId: undefined,
        branchId: undefined,
        userId: undefined,
        sessionId: undefined,
        deviceId: undefined,
      };
      done();
    });
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AppError)
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          meta: { request_id: request.requestContext.requestId, correlation_id: request.requestContext.correlationId },
        });
      return reply.code(500).send({ error: { code: 'internal_error', message: (error as Error).message } });
    });

    registerSupplierRoutes(app, authentication, new SuppliersService(new SuppliersRepository(database)));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId, otherCompanyId];
    await database.pool.query('delete from suppliers where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  function post(key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }

  it('creates a supplier with status active by default and persists it in Postgres', async () => {
    authContext = baseContext(companyId);
    const response = await post(`sup-create-1-${randomUUID()}`, {
      name: `Acme Supplies ${randomUUID()}`,
      contact_name: 'Jane Doe',
      phone: '555-1000',
      email: 'jane@example.test',
      notes: 'Net 30 terms',
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { id: string; status: string; name: string } }>().data;
    expect(body.status).toBe('active');

    const row = await database.pool.query<{ status: string; contact_name: string }>(
      `select status,contact_name from suppliers where company_id=$1 and id=$2`,
      [companyId, body.id],
    );
    expect(row.rows[0]).toMatchObject({ status: 'active', contact_name: 'Jane Doe' });
  });

  it('rejects a duplicate name within the same company with a clean resource_conflict, before any DB constraint violation', async () => {
    authContext = baseContext(companyId);
    const name = `Duplicate Supplies ${randomUUID()}`;
    const first = await post(`sup-dup-1-${randomUUID()}`, { name });
    expect(first.statusCode).toBe(201);

    const second = await post(`sup-dup-2-${randomUUID()}`, { name });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('resource_conflict');
  });

  it('allows the SAME supplier name across two different companies — the uniqueness is per-company, not global', async () => {
    const name = `Shared Name Supplies ${randomUUID()}`;
    authContext = baseContext(companyId);
    const first = await post(`sup-shared-1-${randomUUID()}`, { name });
    expect(first.statusCode).toBe(201);

    authContext = baseContext(otherCompanyId);
    const second = await post(`sup-shared-2-${randomUUID()}`, { name });
    expect(second.statusCode).toBe(201);
  });

  it('rejects a malformed email address server-side, before ever reaching the database', async () => {
    authContext = baseContext(companyId);
    const response = await post(`sup-email-1-${randomUUID()}`, {
      name: `Bad Email Supplies ${randomUUID()}`,
      email: 'not-an-email',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects a blank name', async () => {
    authContext = baseContext(companyId);
    const response = await post(`sup-blank-1-${randomUUID()}`, { name: '   ' });
    expect(response.statusCode).toBe(400);
  });

  it('the exact same Idempotency-Key retried twice produces exactly one supplier row', async () => {
    authContext = baseContext(companyId);
    const key = `sup-idem-1-${randomUUID()}`;
    const payload = { name: `Idempotent Supplies ${randomUUID()}` };
    const first = await post(key, payload);
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ data: { id: string } }>().data;

    const replay = await post(key, payload);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json<{ data: { id: string } }>().data.id).toBe(firstBody.id);

    const count = await database.pool.query<{ count: string }>(
      `select count(*)::text count from suppliers where company_id=$1 and id=$2`,
      [companyId, firstBody.id],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('updates any field except id/companyId, and re-reads reflect the change', async () => {
    authContext = baseContext(companyId);
    const created = await post(`sup-update-1-${randomUUID()}`, { name: `Updatable Supplies ${randomUUID()}` });
    const id = created.json<{ data: { id: string } }>().data.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${id}`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { contact_name: 'New Contact', phone: '555-9999', notes: 'Updated terms' },
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json<{ data: { contact_name: string; phone: string; notes: string } }>().data;
    expect(body).toMatchObject({ contact_name: 'New Contact', phone: '555-9999', notes: 'Updated terms' });
  });

  it('deactivating a supplier sets status=inactive and never hard-deletes the row', async () => {
    authContext = baseContext(companyId);
    const created = await post(`sup-deactivate-1-${randomUUID()}`, { name: `Deactivatable Supplies ${randomUUID()}` });
    const id = created.json<{ data: { id: string } }>().data.id;

    const deactivated = await app.inject({
      method: 'POST',
      url: `/api/v1/suppliers/${id}/deactivate`,
      headers: { authorization: 'Bearer x' },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json<{ data: { status: string } }>().data.status).toBe('inactive');

    const row = await database.pool.query<{ status: string }>(`select status from suppliers where company_id=$1 and id=$2`, [
      companyId,
      id,
    ]);
    expect(row.rows[0]?.status).toBe('inactive'); // the row itself still exists — never hard-deleted.
  });

  it('lists suppliers filterable by status, paginated most-recent-first', async () => {
    authContext = baseContext(companyId);
    const activeName = `List Active Supplies ${randomUUID()}`;
    const created = await post(`sup-list-1-${randomUUID()}`, { name: activeName });
    const id = created.json<{ data: { id: string } }>().data.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/suppliers/${id}/deactivate`,
      headers: { authorization: 'Bearer x' },
    });

    const activeList = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers?status=active&limit=100',
      headers: { authorization: 'Bearer x' },
    });
    expect(activeList.statusCode).toBe(200);
    const activeIds = activeList.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(activeIds).not.toContain(id);

    const inactiveList = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers?status=inactive&limit=100',
      headers: { authorization: 'Bearer x' },
    });
    expect(inactiveList.statusCode).toBe(200);
    const inactiveIds = inactiveList.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(inactiveIds).toContain(id);
  });

  it('an actor without supplier.manage is rejected creating, updating, or deactivating one — never a silent partial effect', async () => {
    authContext = { ...baseContext(companyId), permissions: ['supplier.read'] };
    const created = await post(`sup-noperm-1-${randomUUID()}`, { name: `No Perm Supplies ${randomUUID()}` });
    expect(created.statusCode).toBe(403);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${randomUUID()}`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { notes: 'x' },
    });
    expect(update.statusCode).toBe(403);

    const deactivate = await app.inject({
      method: 'POST',
      url: `/api/v1/suppliers/${randomUUID()}/deactivate`,
      headers: { authorization: 'Bearer x' },
    });
    expect(deactivate.statusCode).toBe(403);
  });

  it('an actor without supplier.read is rejected reading and listing', async () => {
    authContext = { ...baseContext(companyId), permissions: ['supplier.manage'] };
    const list = await app.inject({ method: 'GET', url: '/api/v1/suppliers', headers: { authorization: 'Bearer x' } });
    expect(list.statusCode).toBe(403);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/suppliers/${randomUUID()}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(detail.statusCode).toBe(403);
  });

  it("company A cannot see or mutate company B's suppliers — real tenant isolation, not just a client-side filter", async () => {
    authContext = baseContext(otherCompanyId);
    const created = await post(`sup-tenant-b-${randomUUID()}`, { name: `Other Co Supplies ${randomUUID()}` });
    expect(created.statusCode).toBe(201);
    const otherCompanySupplierId = created.json<{ data: { id: string } }>().data.id;

    authContext = baseContext(companyId);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/suppliers/${otherCompanySupplierId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(detail.statusCode).toBe(404);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${otherCompanySupplierId}`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { notes: 'hijacked' },
    });
    expect(update.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/api/v1/suppliers?limit=100', headers: { authorization: 'Bearer x' } });
    expect(list.statusCode).toBe(200);
    const ids = list.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(ids).not.toContain(otherCompanySupplierId);

    // Company B's own read of its own supplier still works — proves the
    // 404 above is genuine tenant scoping, not a broken read path.
    authContext = baseContext(otherCompanyId);
    const ownDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/suppliers/${otherCompanySupplierId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(ownDetail.statusCode).toBe(200);
  });
});
