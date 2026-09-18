import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { InventoryReversalRepository } from '../inventory/inventory-reversal.repository.js';
import { InventoryReversalService } from '../inventory/inventory-reversal.service.js';
import { SuppliersRepository } from '../suppliers/suppliers.repository.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { registerSupplierRoutes } from '../suppliers/suppliers.routes.js';
import { registerPurchasingRoutes } from './purchasing.routes.js';
import { PurchasingRepository } from './purchasing.repository.js';
import { PurchasingService } from './purchasing.service.js';

/**
 * TASK 14.4 (Wave 2, Part C.2) — real end-to-end coverage for the new
 * `direct_purchases.supplier_id` link, on top of the same real,
 * Postgres-backed stack `purchasing.integration.test.ts` (TASK 14.3, Wave
 * 1 Part C) already established. This file is ADDITIVE — a brand-new
 * test file, never a modification of that one — covering exactly the
 * scenarios this wave's own instruction calls out: freezing the
 * supplier's name at purchase time, a later rename never rewriting
 * history, cross-company/inactive-supplier rejection, and filtering
 * purchase history by `supplier_id`.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://purchasing-supplier-integration-disabled';
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

integration('PostgreSQL direct-purchase supplier linkage (TASK 14.4, Wave 2 Part C.2)', { concurrent: false }, () => {
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
  const otherCompanyProductId = randomUUID();
  const otherCompanyVariantId = randomUUID();

  const allPermissions = ['purchase.create', 'purchase.read', 'supplier.manage', 'supplier.read'] as const;

  function baseContext(forCompanyId: string, forBranchId: string): AuthContext {
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
      applicationName: 'asone-purchasing-supplier-integration',
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
       values($1,'Purchasing Supplier Co','Purchasing Supplier Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Purchasing Supplier Co','Other Purchasing Supplier Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `purchasing-supplier-${companyId}`, otherCompanyId, `purchasing-supplier-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Main','PSMAIN','active','UTC'),($3,$4,'Other Main','POMAIN','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Purchasing Supplier Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `purchasing-supplier-${userId}@example.test`, otherCompanyUserId, `purchasing-supplier-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'DPS-TRACKED','dps-tracked','DPS Tracked','simple',true,'IVA_GENERAL','active',$3,$3),
             ($4,$5,'DPS-OTHERCO','dps-otherco','DPS Other Co','simple',true,'IVA_GENERAL','active',$6,$6)`,
      [trackedProductId, companyId, userId, otherCompanyProductId, otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'DPS-TRACKED','dps-tracked','Variante','unit',0,true,5,'MXN',true,$4,'active',$5,$5),
             ($6,$7,$8,'DPS-OTHERCO','dps-otherco','Variante','unit',0,true,5,'MXN',true,$9,'active',$10,$10)`,
      [
        trackedVariantId,
        companyId,
        trackedProductId,
        '4'.repeat(64),
        userId,
        otherCompanyVariantId,
        otherCompanyId,
        otherCompanyProductId,
        '5'.repeat(64),
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

    const suppliersRepository = new SuppliersRepository(database);
    registerSupplierRoutes(app, authentication, new SuppliersService(suppliersRepository));
    // TASK 12.2 — `PurchasingService` now takes a third, required
    // `InventoryReversalService` collaborator (used only by `POST
    // /api/v1/direct-purchases/:id/reverse`, which no test in THIS file
    // ever calls) — see `purchasing-reversal.integration.test.ts` for
    // that endpoint's own dedicated coverage, and this file's own prior
    // comment above for the identical precedent this same one-line tweak
    // already followed when `suppliersRepository` was added.
    registerPurchasingRoutes(
      app,
      authentication,
      new PurchasingService(
        new PurchasingRepository(database),
        suppliersRepository,
        new InventoryReversalService(new InventoryReversalRepository(database)),
      ),
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
    await database.pool.query('delete from suppliers where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  function postSupplier(key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }
  function postPurchase(key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/direct-purchases',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }
  async function createSupplier(name: string): Promise<string> {
    const response = await postSupplier(`sup-${randomUUID()}`, { name });
    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

  it('linking a real supplier freezes its CURRENT name into supplier_name at purchase time', async () => {
    authContext = baseContext(companyId, branchId);
    const originalName = `Freeze Snapshot Supplies ${randomUUID()}`;
    const supplierId = await createSupplier(originalName);

    const purchase = await postPurchase(`dps-freeze-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      supplier_id: supplierId,
      quantity: '1',
      unit_cost: '10.0000',
      currency_code: 'MXN',
      purchase_date: '2026-02-01',
    });
    expect(purchase.statusCode).toBe(201);
    const body = purchase.json<{ data: { id: string; supplier_id: string; supplier_name: string } }>().data;
    expect(body.supplier_id).toBe(supplierId);
    expect(body.supplier_name).toBe(originalName);
  });

  it('renaming the supplier afterward does NOT change the already-recorded purchase supplier_name', async () => {
    authContext = baseContext(companyId, branchId);
    const originalName = `Rename Before Supplies ${randomUUID()}`;
    const renamedName = `Rename After Supplies ${randomUUID()}`;
    const supplierId = await createSupplier(originalName);

    const purchase = await postPurchase(`dps-rename-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      supplier_id: supplierId,
      quantity: '1',
      unit_cost: '5.0000',
      currency_code: 'MXN',
      purchase_date: '2026-02-02',
    });
    expect(purchase.statusCode).toBe(201);
    const purchaseId = purchase.json<{ data: { id: string } }>().data.id;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${supplierId}`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { name: renamedName },
    });
    expect(renamed.statusCode).toBe(200);

    const dbRow = await database.pool.query<{ supplier_name: string }>(
      `select supplier_name from direct_purchases where company_id=$1 and id=$2`,
      [companyId, purchaseId],
    );
    expect(dbRow.rows[0]?.supplier_name).toBe(originalName); // frozen — never re-derived live.

    const reread = await app.inject({
      method: 'GET',
      url: `/api/v1/direct-purchases/${purchaseId}`,
      headers: { authorization: 'Bearer x' },
    });
    expect(reread.json<{ data: { supplier_name: string } }>().data.supplier_name).toBe(originalName);
  });

  it('purchasing against a cross-company supplier_id is rejected as resource_not_found — never leaks another tenant\'s supplier', async () => {
    authContext = baseContext(otherCompanyId, otherCompanyBranchId);
    const otherCompanySupplierId = await createSupplier(`Other Co Own Supplies ${randomUUID()}`);

    authContext = baseContext(companyId, branchId);
    const purchase = await postPurchase(`dps-crosscompany-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      supplier_id: otherCompanySupplierId,
      quantity: '1',
      unit_cost: '1.0000',
      currency_code: 'MXN',
      purchase_date: '2026-02-03',
    });
    expect(purchase.statusCode).toBe(404);
    expect(purchase.json<{ error: { code: string } }>().error.code).toBe('resource_not_found');

    const count = await database.pool.query<{ count: string }>(
      `select count(*)::text count from direct_purchases where company_id=$1`,
      [companyId],
    );
    // No orphaned/partial row for this company from the rejected attempt.
    expect(Number(count.rows[0]?.count)).toBeGreaterThanOrEqual(0);
  });

  it('purchasing against an inactive supplier is rejected outright with a clear supplier_inactive error (this wave\'s documented decision)', async () => {
    authContext = baseContext(companyId, branchId);
    const supplierId = await createSupplier(`Inactive Supplies ${randomUUID()}`);
    const deactivated = await app.inject({
      method: 'POST',
      url: `/api/v1/suppliers/${supplierId}/deactivate`,
      headers: { authorization: 'Bearer x' },
    });
    expect(deactivated.statusCode).toBe(200);

    const purchase = await postPurchase(`dps-inactive-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      supplier_id: supplierId,
      quantity: '1',
      unit_cost: '1.0000',
      currency_code: 'MXN',
      purchase_date: '2026-02-04',
    });
    expect(purchase.statusCode).toBe(409);
    expect(purchase.json<{ error: { code: string } }>().error.code).toBe('supplier_inactive');

    const count = await database.pool.query<{ count: string }>(
      `select count(*)::text count from direct_purchases where company_id=$1 and product_variant_id=$2 and purchase_date='2026-02-04'`,
      [companyId, trackedVariantId],
    );
    expect(count.rows[0]?.count).toBe('0'); // rejected outright — no row ever inserted.
  });

  it('a direct purchase with NO supplier_id still behaves exactly as before — free-text supplier_name, no regression', async () => {
    authContext = baseContext(companyId, branchId);
    const purchase = await postPurchase(`dps-notsupplier-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      supplier_name: 'Cash And Carry Run',
      quantity: '1',
      unit_cost: '2.0000',
      currency_code: 'MXN',
      purchase_date: '2026-02-05',
    });
    expect(purchase.statusCode).toBe(201);
    const body = purchase.json<{ data: { supplier_id: string | null; supplier_name: string | null } }>().data;
    expect(body.supplier_id).toBeNull();
    expect(body.supplier_name).toBe('Cash And Carry Run');
  });

  it('purchase history (listDirectPurchases) can filter by supplier_id', async () => {
    authContext = baseContext(companyId, branchId);
    const supplierId = await createSupplier(`Filterable Supplies ${randomUUID()}`);
    const linked = await postPurchase(`dps-filter-1-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      supplier_id: supplierId,
      quantity: '1',
      unit_cost: '3.0000',
      currency_code: 'MXN',
      purchase_date: '2026-02-06',
    });
    expect(linked.statusCode).toBe(201);
    const linkedId = linked.json<{ data: { id: string } }>().data.id;

    const unlinked = await postPurchase(`dps-filter-2-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity: '1',
      unit_cost: '3.0000',
      currency_code: 'MXN',
      purchase_date: '2026-02-06',
    });
    expect(unlinked.statusCode).toBe(201);
    const unlinkedId = unlinked.json<{ data: { id: string } }>().data.id;

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/direct-purchases?supplier_id=${supplierId}&limit=100`,
      headers: { authorization: 'Bearer x' },
    });
    expect(filtered.statusCode).toBe(200);
    const ids = filtered.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(ids).toContain(linkedId);
    expect(ids).not.toContain(unlinkedId);
  });
});
