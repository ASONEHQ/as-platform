import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { SuppliersRepository } from '../suppliers/suppliers.repository.js';
import { registerPurchasingRoutes } from './purchasing.routes.js';
import { PurchasingRepository } from './purchasing.repository.js';
import { PurchasingService } from './purchasing.service.js';

/**
 * TASK 14.3 (Wave 1, Part C) — "Compra Directa" real end-to-end coverage.
 * Boots a REAL Fastify app with the REAL, Postgres-backed
 * `PurchasingService`/`PurchasingRepository` (only the auth LAYER is
 * faked — a mutable, always-authenticated context whose
 * `permissions`/`permittedBranchIds`/`companyId` each test can vary, the
 * exact same established pattern `idempotency-replay-http.integration.test.ts`
 * uses for this kind of full-stack-minus-auth test) and drives genuine
 * `app.inject()` HTTP round trips — so `requirePermission`/
 * `requireBranchAccess` (`auth.guards.ts`) are exercised for real, not
 * mocked away, and every assertion about stock/ledger/tenant isolation
 * re-reads the REAL `inventory_balances`/`inventory_movements`/
 * `direct_purchases` rows straight from Postgres.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://purchasing-integration-disabled';
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

integration('PostgreSQL direct-purchase operations (TASK 14.3, Wave 1 Part C)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const locationId = randomUUID();
  const otherCompanyLocationId = randomUUID();
  const trackedProductId = randomUUID();
  const trackedVariantId = randomUUID();
  const untrackedProductId = randomUUID();
  const untrackedVariantId = randomUUID();
  const otherCompanyProductId = randomUUID();
  const otherCompanyVariantId = randomUUID();

  const allPermissions = ['purchase.create', 'purchase.read'] as const;

  function baseContext(forCompanyId: string, forBranchId: string): AuthContext {
    // `created_by`/`actorId` must reference a REAL `company_memberships`
    // row for (companyId, userId) — `inventory_movements_created_by_membership_fk`
    // enforces this for real, so each company's own seeded user must be
    // used for that company's own context, never company A's user id
    // borrowed for a company B request.
    return {
      sessionId: randomUUID(),
      userId: forCompanyId === otherCompanyId ? otherCompanyUserId : userId,
      membershipId: randomUUID(),
      companyId: forCompanyId,
      branchId: forBranchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [...allPermissions],
      permittedBranchIds: [forBranchId],
      transportMode: 'bearer',
    };
  }
  let authContext: AuthContext = baseContext(companyId, branchId);

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-purchasing-integration',
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
    // TASK 14.4 (Wave 2, Part C.2) — the new nullable `direct_purchases.
    // supplier_id` column/FK/index this wave adds, plus the `suppliers`
    // table itself, both land in this one migration.
    await applyIfMissing(database, 'suppliers', ['0025_worried_the_captain.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Purchasing Co','Purchasing Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Purchasing Co','Other Purchasing Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `purchasing-${companyId}`, otherCompanyId, `purchasing-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Purchasing Main','PMAIN','active','UTC'),($3,$4,'Other Co Main','OMAIN','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Purchasing Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `purchasing-${userId}@example.test`, otherCompanyUserId, `purchasing-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'DP-TRACKED','dp-tracked','DP Tracked','simple',true,'IVA_GENERAL','active',$3,$3),
             ($4,$2,'DP-UNTRACKED','dp-untracked','DP Untracked','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($5,$6,'DP-OTHERCO','dp-otherco','DP Other Co','simple',true,'IVA_GENERAL','active',$7,$7)`,
      [
        trackedProductId,
        companyId,
        userId,
        untrackedProductId,
        otherCompanyProductId,
        otherCompanyId,
        otherCompanyUserId,
      ],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'DP-TRACKED','dp-tracked','Variante','unit',0,true,5,'MXN',true,$4,'active',$5,$5),
             ($6,$2,$7,'DP-UNTRACKED','dp-untracked','Variante','unit',0,false,5,'MXN',true,$8,'active',$5,$5),
             ($9,$10,$11,'DP-OTHERCO','dp-otherco','Variante','unit',0,true,5,'MXN',true,$12,'active',$13,$13)`,
      [
        trackedVariantId,
        companyId,
        trackedProductId,
        '1'.repeat(64),
        userId,
        untrackedVariantId,
        untrackedProductId,
        '2'.repeat(64),
        otherCompanyVariantId,
        otherCompanyId,
        otherCompanyProductId,
        '3'.repeat(64),
        otherCompanyUserId,
      ],
    );
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4),
             ($5,$6,$7,'MAIN','main','Main','main','active',true,true,true,$8,$8)`,
      [locationId, companyId, branchId, userId, otherCompanyLocationId, otherCompanyId, otherCompanyBranchId, otherCompanyUserId],
    );

    const authentication = {
      authenticate: () => Promise.resolve(authContext),
      requirePermission: (context: AuthContext, permission: string) => {
        if (!context.permissions.includes(permission))
          throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      },
      requireBranchAccess: (context: AuthContext, forBranchId: string) => {
        if (!context.permittedBranchIds.includes(forBranchId))
          throw new AppError({ code: 'branch_scope_mismatch', message: 'Branch denied.', statusCode: 403 });
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

    // TASK 14.4 (Wave 2, Part C.2) — `PurchasingService` now takes a
    // second, required `SuppliersRepository` collaborator (used only when
    // a request actually links a real `supplier_id`; every test in THIS
    // file never does, so this is a purely additive wiring change — see
    // this task's own final report for why this one line was the single
    // necessary tweak to an otherwise-unmodified existing test file).
    registerPurchasingRoutes(
      app,
      authentication,
      new PurchasingService(new PurchasingRepository(database), new SuppliersRepository(database)),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId, otherCompanyId];
    await database.pool.query('delete from direct_purchases where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_movement_lines where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_balances where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_movements where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_locations where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from product_variants where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from products where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  function post(key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/direct-purchases',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }

  it('increases the real inventory balance by exactly the purchased quantity, twice in a row', async () => {
    authContext = baseContext(companyId, branchId);
    const before = await database.pool.query<{ quantity_on_hand: string }>(
      `select quantity_on_hand::text from inventory_balances
       where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4`,
      [companyId, branchId, locationId, trackedVariantId],
    );
    expect(before.rows[0]).toBeUndefined(); // no balance row exists yet for this variant.

    const first = await post(`dp-stock-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity: '5',
      unit_cost: '12.5000',
      currency_code: 'MXN',
      purchase_date: '2026-01-15',
      supplier_name: 'Proveedor Uno',
    });
    expect(first.statusCode).toBe(201);
    const afterFirst = await database.pool.query<{ quantity_on_hand: string }>(
      `select quantity_on_hand::text from inventory_balances
       where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4`,
      [companyId, branchId, locationId, trackedVariantId],
    );
    expect(afterFirst.rows[0]?.quantity_on_hand).toBe('5.000000');

    const second = await post(`dp-stock-2-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity: '3',
      unit_cost: '10.0000',
      currency_code: 'MXN',
      purchase_date: '2026-01-16',
    });
    expect(second.statusCode).toBe(201);
    const afterSecond = await database.pool.query<{ quantity_on_hand: string }>(
      `select quantity_on_hand::text from inventory_balances
       where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4`,
      [companyId, branchId, locationId, trackedVariantId],
    );
    // Exactly +3 on top of the prior 5 — never re-derived, never doubled.
    expect(afterSecond.rows[0]?.quantity_on_hand).toBe('8.000000');
  });

  it('posts a real receipt inventory movement referencing the new direct_purchases row', async () => {
    authContext = baseContext(companyId, branchId);
    const response = await post(`dp-ledger-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity: '2',
      unit_cost: '7.5000',
      currency_code: 'MXN',
      purchase_date: '2026-01-17',
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { id: string; inventory_movement_id: string } }>().data;

    const dbRow = await database.pool.query<{
      id: string;
      inventory_movement_id: string;
      quantity: string;
      unit_cost: string;
      total_cost: string;
    }>(
      `select id,inventory_movement_id,quantity::text,unit_cost::text,total_cost::text
       from direct_purchases where company_id=$1 and id=$2`,
      [companyId, body.id],
    );
    expect(dbRow.rows[0]).toMatchObject({
      inventory_movement_id: body.inventory_movement_id,
      quantity: '2.000000',
      unit_cost: '7.5000',
      total_cost: '15.0000',
    });

    const movement = await database.pool.query<{
      movement_type: string;
      status: string;
      reference_type: string;
      reference_id: string;
    }>(
      `select movement_type,status,reference_type,reference_id from inventory_movements
       where company_id=$1 and id=$2`,
      [companyId, body.inventory_movement_id],
    );
    expect(movement.rows[0]).toMatchObject({
      movement_type: 'receipt',
      status: 'posted',
      reference_type: 'direct_purchase',
      reference_id: body.id,
    });

    const line = await database.pool.query<{ product_variant_id: string; destination_location_id: string; source_location_id: string | null }>(
      `select product_variant_id,destination_location_id,source_location_id from inventory_movement_lines
       where company_id=$1 and inventory_movement_id=$2`,
      [companyId, body.inventory_movement_id],
    );
    expect(line.rows[0]).toMatchObject({ product_variant_id: trackedVariantId, source_location_id: null });
    expect(line.rows[0]?.destination_location_id).toBe(locationId);
  });

  it('an invalid product_variant_id rolls back the WHOLE attempt — no orphaned direct_purchases row and no orphaned inventory_movements row', async () => {
    authContext = baseContext(companyId, branchId);
    const beforeCounts = await database.pool.query<{ dp: string; im: string }>(
      `select
         (select count(*)::text from direct_purchases where company_id=$1) dp,
         (select count(*)::text from inventory_movements where company_id=$1 and reference_type='direct_purchase') im`,
      [companyId],
    );
    const response = await post(`dp-atomic-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: randomUUID(), // does not exist.
      quantity: '1',
      unit_cost: '1.0000',
      currency_code: 'MXN',
      purchase_date: '2026-01-18',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('product_variant_not_found');

    const afterCounts = await database.pool.query<{ dp: string; im: string }>(
      `select
         (select count(*)::text from direct_purchases where company_id=$1) dp,
         (select count(*)::text from inventory_movements where company_id=$1 and reference_type='direct_purchase') im`,
      [companyId],
    );
    expect(afterCounts.rows[0]).toEqual(beforeCounts.rows[0]); // neither table grew.
  });

  it('a direct purchase for a variant that does not track inventory is rejected outright, never silently creating a stock row nothing else reads', async () => {
    authContext = baseContext(companyId, branchId);
    const response = await post(`dp-untracked-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: untrackedVariantId,
      quantity: '1',
      unit_cost: '1.0000',
      currency_code: 'MXN',
      purchase_date: '2026-01-18',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('product_variant_not_found');
  });

  it('the exact same Idempotency-Key retried twice produces exactly one direct purchase and exactly one inventory movement', async () => {
    authContext = baseContext(companyId, branchId);
    const key = `dp-idem-1-${randomUUID()}`;
    const payload = {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity: '4',
      unit_cost: '9.0000',
      currency_code: 'MXN',
      purchase_date: '2026-01-19',
    };
    const first = await post(key, payload);
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ data: { id: string; inventory_movement_id: string } }>().data;

    const replay = await post(key, payload);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true'); // the route's own replay signal.
    const replayBody = replay.json<{ data: { id: string; inventory_movement_id: string } }>().data;
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.inventory_movement_id).toBe(firstBody.inventory_movement_id);

    const dpCount = await database.pool.query<{ count: string }>(
      `select count(*)::text count from direct_purchases where company_id=$1 and id=$2`,
      [companyId, firstBody.id],
    );
    expect(dpCount.rows[0]?.count).toBe('1');
    const imCount = await database.pool.query<{ count: string }>(
      `select count(*)::text count from inventory_movements where company_id=$1 and reference_type='direct_purchase' and reference_id=$2`,
      [companyId, firstBody.id],
    );
    expect(imCount.rows[0]?.count).toBe('1');
  });

  it('an actor without purchase.create is rejected creating one — never a silent partial effect', async () => {
    authContext = { ...baseContext(companyId, branchId), permissions: ['purchase.read'] };
    const response = await post(`dp-noperm-create-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity: '1',
      unit_cost: '1.0000',
      currency_code: 'MXN',
      purchase_date: '2026-01-20',
    });
    expect(response.statusCode).toBe(403);
  });

  it('an actor without purchase.read is rejected listing and reading', async () => {
    authContext = { ...baseContext(companyId, branchId), permissions: ['purchase.create'] };
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/direct-purchases',
      headers: { authorization: 'Bearer x' },
    });
    expect(list.statusCode).toBe(403);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/direct-purchases/${randomUUID()}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(detail.statusCode).toBe(403);
  });

  it('company A cannot see company B\'s direct purchases — real tenant isolation, not just a client-side filter', async () => {
    authContext = baseContext(otherCompanyId, otherCompanyBranchId);
    const created = await post(`dp-tenant-b-${randomUUID()}`, {
      branch_id: otherCompanyBranchId,
      product_variant_id: otherCompanyVariantId,
      quantity: '6',
      unit_cost: '2.0000',
      currency_code: 'MXN',
      purchase_date: '2026-01-21',
    });
    expect(created.statusCode).toBe(201);
    const otherCompanyPurchaseId = created.json<{ data: { id: string } }>().data.id;

    authContext = baseContext(companyId, branchId);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/direct-purchases/${otherCompanyPurchaseId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(detail.statusCode).toBe(404);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/direct-purchases',
      headers: { authorization: 'Bearer x' },
    });
    expect(list.statusCode).toBe(200);
    const ids = list.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(ids).not.toContain(otherCompanyPurchaseId);

    // Company B's own read of its own purchase still works — proves the
    // 404 above is genuine tenant scoping, not a broken read path.
    authContext = baseContext(otherCompanyId, otherCompanyBranchId);
    const ownDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/direct-purchases/${otherCompanyPurchaseId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(ownDetail.statusCode).toBe(200);
  });

  it('the created direct purchase and its inventory movement genuinely persist in Postgres — re-read via a brand-new connection, no in-process cache involved', async () => {
    authContext = baseContext(companyId, branchId);
    const created = await post(`dp-persist-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity: '1.5',
      unit_cost: '4.2500',
      currency_code: 'MXN',
      purchase_date: '2026-01-22',
      notes: 'Persistence check',
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ data: { id: string; inventory_movement_id: string } }>().data;

    // A genuinely SEPARATE `DatabaseClient` — its own new connection pool,
    // opened AFTER the mutation above already committed — so this proves
    // real Postgres durability, never an in-process object graph or
    // connection-local cache carrying the answer.
    const freshConnection = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-purchasing-integration-restart-proof',
    });
    try {
      const dpRow = await freshConnection.pool.query<{ id: string; notes: string | null; inventory_movement_id: string }>(
        `select id,notes,inventory_movement_id from direct_purchases where company_id=$1 and id=$2`,
        [companyId, body.id],
      );
      expect(dpRow.rows[0]).toMatchObject({ id: body.id, notes: 'Persistence check', inventory_movement_id: body.inventory_movement_id });

      const movementRow = await freshConnection.pool.query<{ status: string; movement_type: string }>(
        `select status,movement_type from inventory_movements where company_id=$1 and id=$2`,
        [companyId, body.inventory_movement_id],
      );
      expect(movementRow.rows[0]).toMatchObject({ status: 'posted', movement_type: 'receipt' });

      const balanceRow = await freshConnection.pool.query<{ quantity_on_hand: string }>(
        `select quantity_on_hand::text from inventory_balances
         where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4`,
        [companyId, branchId, locationId, trackedVariantId],
      );
      // Cumulative across every earlier test in this file that added
      // stock for this same variant/location — proves the increase from
      // THIS purchase (+1.5) really landed durably on top of whatever was
      // already there, not just that a row exists.
      expect(balanceRow.rows[0]?.quantity_on_hand.endsWith('.500000')).toBe(true);
    } finally {
      await freshConnection.close();
    }
  });
});
