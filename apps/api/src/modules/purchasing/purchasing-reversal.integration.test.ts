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
import { registerPurchasingRoutes } from './purchasing.routes.js';
import { PurchasingRepository } from './purchasing.repository.js';
import { PurchasingService } from './purchasing.service.js';

/**
 * TASK 12.2 — real end-to-end coverage for `POST /api/v1/direct-purchases/
 * :id/reverse`, additive to `purchasing.integration.test.ts` (TASK 14.3)
 * — never a modification of that file. Confirms `PurchasingService.
 * reverseDirectPurchase` genuinely reuses the EXISTING generic
 * `InventoryReversalService` (never a parallel reversal implementation):
 * the resulting reversal movement, the flipped `status='reversed'` on the
 * original movement, and the real stock decrease all come straight from
 * that shared mechanism.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://purchasing-reversal-integration-disabled';
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

integration('PostgreSQL direct-purchase reversal (TASK 12.2)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const locationId = randomUUID();
  const trackedProductId = randomUUID();
  const trackedVariantId = randomUUID();

  const allPermissions = ['purchase.create', 'purchase.read', 'inventory.reverse'] as const;

  function baseContext(permissions: readonly string[] = allPermissions): AuthContext {
    return {
      sessionId: randomUUID(),
      userId,
      membershipId: randomUUID(),
      companyId,
      branchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [...permissions],
      permittedBranchIds: [branchId],
      transportMode: 'bearer',
    };
  }
  let authContext: AuthContext = baseContext();

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-purchasing-reversal-integration',
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
       values($1,'Purchasing Reversal Co','Purchasing Reversal Co',$2,'active','UTC','MXN','es-MX')`,
      [companyId, `purchasing-reversal-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone) values($1,$2,'Main','PRMAIN','active','UTC')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'Reversal Actor','active')`,
      [userId, `purchasing-reversal-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, userId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'PR-TRACKED','pr-tracked','PR Tracked','simple',true,'IVA_GENERAL','active',$3,$3)`,
      [trackedProductId, companyId, userId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'PR-TRACKED','pr-tracked','Variante','unit',0,true,5,'MXN',true,$4,'active',$5,$5)`,
      [trackedVariantId, companyId, trackedProductId, 'a'.repeat(64), userId],
    );
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4)`,
      [locationId, companyId, branchId, userId],
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
    const inventoryReversalService = new InventoryReversalService(new InventoryReversalRepository(database));
    registerPurchasingRoutes(
      app,
      authentication,
      new PurchasingService(new PurchasingRepository(database), suppliersRepository, inventoryReversalService),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId];
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
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId]]);
    await database.close();
  });

  function post(url: string, key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }
  function get(url: string): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({ method: 'GET', url, headers: { authorization: 'Bearer x' } });
  }
  async function balance(): Promise<string | null> {
    const row = await database.pool.query<{ quantity_on_hand: string }>(
      `select quantity_on_hand::text from inventory_balances
       where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4`,
      [companyId, branchId, locationId, trackedVariantId],
    );
    return row.rows[0]?.quantity_on_hand ?? null;
  }
  async function createDirectPurchase(quantity: string): Promise<{ id: string; inventoryMovementId: string }> {
    authContext = baseContext();
    const response = await post('/api/v1/direct-purchases', `dp-rev-create-${randomUUID()}`, {
      branch_id: branchId,
      product_variant_id: trackedVariantId,
      quantity,
      unit_cost: '4.0000',
      currency_code: 'MXN',
      purchase_date: '2026-04-01',
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { id: string; inventory_movement_id: string } }>().data;
    return { id: body.id, inventoryMovementId: body.inventory_movement_id };
  }

  it('reversing a direct purchase flips its movement to reversed and decreases stock back correctly', async () => {
    const before = await balance();
    const purchase = await createDirectPurchase('7');
    const afterPurchase = await balance();
    expect(Number(afterPurchase)).toBe(Number(before ?? '0') + 7);

    authContext = baseContext();
    const reversed = await post(`/api/v1/direct-purchases/${purchase.id}/reverse`, `dp-rev-1-${randomUUID()}`, {
      reason: 'Damaged goods returned to supplier',
    });
    expect(reversed.statusCode).toBe(200);
    const body = reversed.json<{ data: { inventory_movement: { status: string } } }>().data;
    expect(body.inventory_movement.status).toBe('reversed');

    const afterReversal = await balance();
    expect(Number(afterReversal)).toBe(Number(before ?? '0')); // back to where it started.

    const movementRow = await database.pool.query<{ status: string }>(
      `select status from inventory_movements where company_id=$1 and id=$2`,
      [companyId, purchase.inventoryMovementId],
    );
    expect(movementRow.rows[0]?.status).toBe('reversed');
  });

  it('reversing the same direct purchase twice is rejected by the existing reversal mechanism', async () => {
    const purchase = await createDirectPurchase('2');
    authContext = baseContext();
    const first = await post(`/api/v1/direct-purchases/${purchase.id}/reverse`, `dp-rev-twice-1-${randomUUID()}`, {
      reason: 'First reversal',
    });
    expect(first.statusCode).toBe(200);

    const second = await post(`/api/v1/direct-purchases/${purchase.id}/reverse`, `dp-rev-twice-2-${randomUUID()}`, {
      reason: 'Second attempt should fail',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('movement_already_reversed');
  });

  it('the list endpoint reflects a reversed status without a per-row movement lookup by the caller — regression for a real bug caught only by live browser verification, where the Historial table never showed the "Reversada" badge after a page reload because the list row omitted inventory_movement entirely', async () => {
    const purchase = await createDirectPurchase('3');
    authContext = baseContext();
    const reversed = await post(`/api/v1/direct-purchases/${purchase.id}/reverse`, `dp-rev-list-${randomUUID()}`, {
      reason: 'Regression coverage for list-row reversed status',
    });
    expect(reversed.statusCode).toBe(200);

    authContext = baseContext();
    const list = await get(`/api/v1/direct-purchases?branch_id=${branchId}&limit=50`);
    expect(list.statusCode).toBe(200);
    const body = list.json<{
      data: { id: string; inventory_movement?: { status: string; movement_number: string } }[];
    }>();
    const row = body.data.find((entry) => entry.id === purchase.id);
    expect(row?.inventory_movement?.status).toBe('reversed');
    expect(row?.inventory_movement?.movement_number).toBeTruthy();
  });

  it('reversal requires the inventory.reverse permission', async () => {
    const purchase = await createDirectPurchase('1');
    authContext = baseContext(['purchase.create', 'purchase.read']); // no inventory.reverse.
    const response = await post(`/api/v1/direct-purchases/${purchase.id}/reverse`, `dp-rev-noperm-${randomUUID()}`, {
      reason: 'Should be denied',
    });
    expect(response.statusCode).toBe(403);
  });
});
