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
import { registerPurchaseOrdersRoutes } from './purchase-orders.routes.js';
import { PurchaseOrdersRepository } from './purchase-orders.repository.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';

/**
 * TASK 12.2 — the formal Purchase Order workflow's real, Postgres-backed
 * end-to-end coverage. Boots a REAL Fastify app with the REAL
 * `PurchaseOrdersService`/`PurchaseOrdersRepository` (only the auth
 * LAYER is faked — the same established pattern
 * `purchasing.integration.test.ts` already uses) and drives genuine
 * `app.inject()` HTTP round trips.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://purchase-orders-integration-disabled';
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
/** Companion to `applyIfMissing` for the ALTER-only migrations
 * (0026-0029) that add a column to an already-existing table rather than
 * creating a new one — `to_regclass` cannot detect "has this migration
 * already run" for those, so this checks `information_schema.columns`
 * instead. */
async function applyColumnIfMissing(
  database: DatabaseClient,
  table: string,
  column: string,
  files: readonly string[],
): Promise<void> {
  const check = await database.pool.query<{ present: number }>(
    `select 1 present from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column],
  );
  if (check.rows.length > 0) return;
  for (const file of files) {
    const sql = await readFile(resolve(migrationsPath, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
}

integration('PostgreSQL purchase order operations (TASK 12.2)', { concurrent: false }, () => {
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
  const variantAId = randomUUID();
  const variantAProductId = randomUUID();
  const variantBId = randomUUID();
  const variantBProductId = randomUUID();
  const untrackedVariantId = randomUUID();
  const untrackedProductId = randomUUID();
  const otherCompanyVariantId = randomUUID();
  const otherCompanyProductId = randomUUID();
  const activeSupplierId = randomUUID();
  const inactiveSupplierId = randomUUID();
  const otherCompanySupplierId = randomUUID();

  const allPermissions = ['purchase.create', 'purchase.read', 'purchase.receive'] as const;

  function baseContext(forCompanyId: string, forBranchId: string, permissions: readonly string[] = allPermissions): AuthContext {
    return {
      sessionId: randomUUID(),
      userId: forCompanyId === otherCompanyId ? otherCompanyUserId : userId,
      membershipId: randomUUID(),
      companyId: forCompanyId,
      branchId: forBranchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [...permissions],
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
      applicationName: 'asone-purchase-orders-integration',
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
    await applyColumnIfMissing(database, 'access_credentials', 'credential_kind', ['0026_hesitant_speed.sql']);
    await applyColumnIfMissing(database, 'company_memberships', 'pin_hash', ['0027_quiet_strong_guy.sql']);
    await applyColumnIfMissing(database, 'product_categories', 'is_visual_tile', ['0028_crazy_nightcrawler.sql']);
    await applyColumnIfMissing(database, 'product_variants', 'min_stock', ['0029_productive_bushwacker.sql']);
    // TASK 12.2 — the new `purchase_orders`/`purchase_order_lines` tables
    // this task's own migration adds.
    await applyIfMissing(database, 'purchase_orders', ['0031_burly_nomad.sql']);
    // TASK 16.10A — the `product_name_snapshot`/`variant_name_snapshot`/
    // `sku_snapshot` columns this task's own migration adds to the
    // already-existing `purchase_order_lines` table.
    await applyColumnIfMissing(database, 'purchase_order_lines', 'product_name_snapshot', [
      '0032_absurd_liz_osborn.sql',
    ]);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'PO Co','PO Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other PO Co','Other PO Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `po-${companyId}`, otherCompanyId, `po-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'PO Main','POMAIN','active','UTC'),($3,$4,'Other Co Main','POOMAIN','active','UTC')`,
      [branchId, companyId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'PO Actor','active'),($3,$4,$4,'Other Co Actor','active')`,
      [userId, `po-${userId}@example.test`, otherCompanyUserId, `po-${otherCompanyUserId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [randomUUID(), companyId, userId, randomUUID(), otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into products
       (id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
       values($1,$2,'PO-A','po-a','PO A','simple',true,'IVA_GENERAL','active',$3,$3),
             ($4,$2,'PO-B','po-b','PO B','simple',true,'IVA_GENERAL','active',$3,$3),
             ($5,$2,'PO-UNTRACKED','po-untracked','PO Untracked','simple',false,'IVA_EXEMPT','active',$3,$3),
             ($6,$7,'PO-OTHERCO','po-otherco','PO Other Co','simple',true,'IVA_GENERAL','active',$8,$8)`,
      [variantAProductId, companyId, userId, variantBProductId, untrackedProductId, otherCompanyProductId, otherCompanyId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into product_variants
       (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
       values($1,$2,$3,'PO-A','po-a','Variante','unit',0,true,5,'MXN',true,$4,'active',$5,$5),
             ($6,$2,$7,'PO-B','po-b','Variante','unit',0,true,5,'MXN',true,$8,'active',$5,$5),
             ($9,$2,$10,'PO-UNTRACKED','po-untracked','Variante','unit',0,false,5,'MXN',true,$11,'active',$5,$5),
             ($12,$13,$14,'PO-OTHERCO','po-otherco','Variante','unit',0,true,5,'MXN',true,$15,'active',$16,$16)`,
      [
        variantAId, companyId, variantAProductId, '6'.repeat(64), userId,
        variantBId, variantBProductId, '7'.repeat(64),
        untrackedVariantId, untrackedProductId, '8'.repeat(64),
        otherCompanyVariantId, otherCompanyId, otherCompanyProductId, '9'.repeat(64), otherCompanyUserId,
      ],
    );
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4),
             ($5,$6,$7,'MAIN','main','Main','main','active',true,true,true,$8,$8)`,
      [locationId, companyId, branchId, userId, otherCompanyLocationId, otherCompanyId, otherCompanyBranchId, otherCompanyUserId],
    );
    await database.pool.query(
      `insert into suppliers(id,company_id,name,status,created_by,updated_by)
       values($1,$2,$3,'active',$4,$4),($5,$2,$6,'inactive',$4,$4),($7,$8,$9,'active',$10,$10)`,
      [
        activeSupplierId, companyId, `Active Supplier ${activeSupplierId}`, userId,
        inactiveSupplierId, `Inactive Supplier ${inactiveSupplierId}`,
        otherCompanySupplierId, otherCompanyId, `Other Co Supplier ${otherCompanySupplierId}`, otherCompanyUserId,
      ],
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
    registerPurchaseOrdersRoutes(
      app,
      authentication,
      new PurchaseOrdersService(new PurchaseOrdersRepository(database), suppliersRepository),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId, otherCompanyId];
    await database.pool.query('delete from purchase_order_lines where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from purchase_orders where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_movement_lines where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_balances where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_movements where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from inventory_locations where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from suppliers where company_id=any($1::uuid[])', [ids]);
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
  async function balance(variantId: string): Promise<string | null> {
    const row = await database.pool.query<{ quantity_on_hand: string }>(
      `select quantity_on_hand::text from inventory_balances
       where company_id=$1 and branch_id=$2 and inventory_location_id=$3 and product_variant_id=$4`,
      [companyId, branchId, locationId, variantId],
    );
    return row.rows[0]?.quantity_on_hand ?? null;
  }
  function twoLinePayload(): Record<string, unknown> {
    return {
      branch_id: branchId,
      order_date: '2026-03-01',
      currency_code: 'MXN',
      lines: [
        { product_variant_id: variantAId, ordered_quantity: '10', unit_cost: '5.0000' },
        { product_variant_id: variantBId, ordered_quantity: '4', unit_cost: '2.5000' },
      ],
    };
  }
  async function createDraft(): Promise<{ id: string; lines: { id: string; product_variant_id: string; ordered_quantity: string }[] }> {
    authContext = baseContext(companyId, branchId);
    const response = await post('/api/v1/purchase-orders', `po-create-${randomUUID()}`, twoLinePayload());
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { id: string; lines: { id: string; product_variant_id: string; ordered_quantity: string }[] } }>().data;
    return { id: body.id, lines: body.lines };
  }
  async function createAndSubmit(): Promise<{ id: string; lines: { id: string; product_variant_id: string; ordered_quantity: string }[] }> {
    const draft = await createDraft();
    const submitted = await post(`/api/v1/purchase-orders/${draft.id}/submit`, `po-submit-${randomUUID()}`, {});
    expect(submitted.statusCode).toBe(200);
    return draft;
  }

  it('creates a draft PO with 2+ lines with no stock effect', async () => {
    const beforeA = await balance(variantAId);
    const beforeB = await balance(variantBId);
    const draft = await createDraft();
    expect(draft.lines).toHaveLength(2);
    const detail = await get(`/api/v1/purchase-orders/${draft.id}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json<{ data: { status: string; total_cost: string } }>().data;
    expect(body.status).toBe('draft');
    expect(body.total_cost).toBe('60.0000'); // 10*5 + 4*2.5
    expect(await balance(variantAId)).toBe(beforeA);
    expect(await balance(variantBId)).toBe(beforeB);
  });

  it('freezes a human-readable product_name/variant_name/sku on each line at creation time, and never re-derives it live from a later catalog rename (TASK 16.10A)', async () => {
    const draft = await createDraft();
    const detail = await get(`/api/v1/purchase-orders/${draft.id}`);
    expect(detail.statusCode).toBe(200);
    const before = detail.json<{
      data: { lines: { product_variant_id: string; product_name: string; variant_name: string | null; sku: string | null }[] };
    }>().data;
    const lineA = before.lines.find((line) => line.product_variant_id === variantAId);
    expect(lineA?.product_name).toBe('PO A');
    expect(lineA?.variant_name).toBe('Variante');
    expect(lineA?.sku).toBe('PO-A');

    // Rename the product AFTER the PO line was created — the frozen
    // snapshot must not change, exactly mirroring `sale_items.name_snapshot`'s
    // own established "never re-derived live" guarantee.
    await database.pool.query(`update products set name='PO A (renamed)' where id=$1`, [variantAProductId]);
    const after = await get(`/api/v1/purchase-orders/${draft.id}`);
    const afterBody = after.json<{
      data: { lines: { product_variant_id: string; product_name: string }[] };
    }>().data;
    expect(afterBody.lines.find((line) => line.product_variant_id === variantAId)?.product_name).toBe('PO A');
  });

  it('rejects an empty lines array and a duplicate variant within the same request', async () => {
    authContext = baseContext(companyId, branchId);
    const empty = await post('/api/v1/purchase-orders', `po-empty-${randomUUID()}`, {
      branch_id: branchId,
      order_date: '2026-03-01',
      currency_code: 'MXN',
      lines: [],
    });
    expect(empty.statusCode).toBe(400);

    const duplicate = await post('/api/v1/purchase-orders', `po-dup-${randomUUID()}`, {
      branch_id: branchId,
      order_date: '2026-03-01',
      currency_code: 'MXN',
      lines: [
        { product_variant_id: variantAId, ordered_quantity: '1', unit_cost: '1.0000' },
        { product_variant_id: variantAId, ordered_quantity: '2', unit_cost: '1.0000' },
      ],
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe('purchase_order_duplicate_variant');
  });

  it('submits a draft PO; submitting twice is rejected with purchase_order_invalid_transition', async () => {
    const draft = await createDraft();
    const first = await post(`/api/v1/purchase-orders/${draft.id}/submit`, `po-sub-1-${randomUUID()}`, {});
    expect(first.statusCode).toBe(200);
    expect(first.json<{ data: { status: string } }>().data.status).toBe('submitted');

    const second = await post(`/api/v1/purchase-orders/${draft.id}/submit`, `po-sub-2-${randomUUID()}`, {});
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('purchase_order_invalid_transition');
  });

  it('fully receiving a submitted PO posts one movement with N lines, marks it received, and is idempotent', async () => {
    const order = await createAndSubmit();
    const beforeA = await balance(order.lines[0]?.product_variant_id ?? '');
    const beforeB = await balance(order.lines[1]?.product_variant_id ?? '');

    const key = `po-receive-full-${randomUUID()}`;
    const receiveBody = {
      lines: order.lines.map((line) => ({ purchase_order_line_id: line.id, received_quantity: line.ordered_quantity })),
    };
    const first = await post(`/api/v1/purchase-orders/${order.id}/receive`, key, receiveBody);
    expect(first.statusCode).toBe(200);
    const body = first.json<{
      data: { status: string; receipt_movement_id: string; lines: { received_quantity: string; ordered_quantity: string }[] };
    }>().data;
    expect(body.status).toBe('received');
    expect(body.receipt_movement_id).not.toBeNull();
    for (const line of body.lines) expect(line.received_quantity).toBe(line.ordered_quantity);

    const movementRows = await database.pool.query<{ count: string }>(
      `select count(*)::text count from inventory_movements where company_id=$1 and id=$2`,
      [companyId, body.receipt_movement_id],
    );
    expect(movementRows.rows[0]?.count).toBe('1');
    const lineRows = await database.pool.query<{ count: string }>(
      `select count(*)::text count from inventory_movement_lines where company_id=$1 and inventory_movement_id=$2`,
      [companyId, body.receipt_movement_id],
    );
    expect(lineRows.rows[0]?.count).toBe('2');

    const afterA = await balance(order.lines[0]?.product_variant_id ?? '');
    const afterB = await balance(order.lines[1]?.product_variant_id ?? '');
    expect(Number(afterA)).toBe(Number(beforeA ?? '0') + 10);
    expect(Number(afterB)).toBe(Number(beforeB ?? '0') + 4);

    // Idempotency-key replay — exactly one movement, no double-post.
    const replay = await post(`/api/v1/purchase-orders/${order.id}/receive`, key, receiveBody);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    const movementRowsAfterReplay = await database.pool.query<{ count: string }>(
      `select count(*)::text count from inventory_movements where company_id=$1 and reference_type='purchase_order' and reference_id=$2`,
      [companyId, order.id],
    );
    expect(movementRowsAfterReplay.rows[0]?.count).toBe('1');
    const afterReplayA = await balance(order.lines[0]?.product_variant_id ?? '');
    expect(afterReplayA).toBe(afterA); // unchanged by the replay.
  });

  it('partially receiving a submitted PO (one line omitted) sets partially_received and only credits what was actually received; a second receive call is rejected', async () => {
    const order = await createAndSubmit();
    const firstLine = order.lines[0];
    if (firstLine === undefined) throw new Error('expected at least one line');
    const beforeFirst = await balance(firstLine.product_variant_id);
    const secondLine = order.lines[1];
    if (secondLine === undefined) throw new Error('expected a second line');
    const beforeSecond = await balance(secondLine.product_variant_id);

    const response = await post(`/api/v1/purchase-orders/${order.id}/receive`, `po-receive-partial-${randomUUID()}`, {
      lines: [{ purchase_order_line_id: firstLine.id, received_quantity: '3' }], // less than ordered (10), second line omitted entirely.
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { status: string } }>().data;
    expect(body.status).toBe('partially_received');

    const afterFirst = await balance(firstLine.product_variant_id);
    expect(Number(afterFirst)).toBe(Number(beforeFirst ?? '0') + 3);
    const afterSecond = await balance(secondLine.product_variant_id);
    expect(afterSecond).toBe(beforeSecond); // the omitted line received nothing.

    const secondCall = await post(`/api/v1/purchase-orders/${order.id}/receive`, `po-receive-partial-2-${randomUUID()}`, {
      lines: [{ purchase_order_line_id: secondLine.id, received_quantity: secondLine.ordered_quantity }],
    });
    expect(secondCall.statusCode).toBe(409);
    expect(secondCall.json<{ error: { code: string } }>().error.code).toBe('purchase_order_invalid_transition');
  });

  it('receiving more than a line’s ordered_quantity is rejected with purchase_order_over_receipt and rolls back the whole request', async () => {
    const order = await createAndSubmit();
    const firstLine = order.lines[0];
    if (firstLine === undefined) throw new Error('expected at least one line');
    const secondLine = order.lines[1];
    if (secondLine === undefined) throw new Error('expected a second line');
    const beforeFirst = await balance(firstLine.product_variant_id);
    const beforeSecond = await balance(secondLine.product_variant_id);

    const response = await post(`/api/v1/purchase-orders/${order.id}/receive`, `po-over-${randomUUID()}`, {
      lines: [
        { purchase_order_line_id: firstLine.id, received_quantity: '1' },
        { purchase_order_line_id: secondLine.id, received_quantity: '999' }, // exceeds ordered_quantity (4).
      ],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('purchase_order_over_receipt');

    // Whole request rolled back — neither line's stock moved, not even the valid first line.
    expect(await balance(firstLine.product_variant_id)).toBe(beforeFirst);
    expect(await balance(secondLine.product_variant_id)).toBe(beforeSecond);
    const detail = await get(`/api/v1/purchase-orders/${order.id}`);
    expect(detail.json<{ data: { status: string } }>().data.status).toBe('submitted');
  });

  it('cancels a draft PO with no stock effect', async () => {
    const draft = await createDraft();
    const response = await post(`/api/v1/purchase-orders/${draft.id}/cancel`, `po-cancel-draft-${randomUUID()}`, {
      reason: 'No longer needed',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { status: string; notes: string | null } }>().data;
    expect(body.status).toBe('cancelled');
    expect(body.notes).toContain('No longer needed');
  });

  it('cancels a partially_received PO — the stock already received stays completely untouched', async () => {
    const order = await createAndSubmit();
    const firstLine = order.lines[0];
    if (firstLine === undefined) throw new Error('expected at least one line');
    const received = await post(`/api/v1/purchase-orders/${order.id}/receive`, `po-cancel-pr-receive-${randomUUID()}`, {
      lines: [{ purchase_order_line_id: firstLine.id, received_quantity: '2' }],
    });
    expect(received.statusCode).toBe(200);
    expect(received.json<{ data: { status: string } }>().data.status).toBe('partially_received');
    const afterReceive = await balance(firstLine.product_variant_id);

    const cancelled = await post(`/api/v1/purchase-orders/${order.id}/cancel`, `po-cancel-pr-${randomUUID()}`, {
      reason: 'Vendor could not fulfill the rest',
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ data: { status: string } }>().data.status).toBe('cancelled');

    const afterCancel = await balance(firstLine.product_variant_id);
    expect(afterCancel).toBe(afterReceive); // untouched by cancel.
  });

  it('cancelling a received PO is rejected with purchase_order_invalid_transition', async () => {
    const order = await createAndSubmit();
    const receiveBody = {
      lines: order.lines.map((line) => ({ purchase_order_line_id: line.id, received_quantity: line.ordered_quantity })),
    };
    const received = await post(`/api/v1/purchase-orders/${order.id}/receive`, `po-full-then-cancel-${randomUUID()}`, receiveBody);
    expect(received.statusCode).toBe(200);
    expect(received.json<{ data: { status: string } }>().data.status).toBe('received');

    const cancelled = await post(`/api/v1/purchase-orders/${order.id}/cancel`, `po-cancel-received-${randomUUID()}`, { reason: 'too late' });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json<{ error: { code: string } }>().error.code).toBe('purchase_order_invalid_transition');
  });

  it('linking a real, active supplier freezes its CURRENT name into supplier_name', async () => {
    authContext = baseContext(companyId, branchId);
    const response = await post('/api/v1/purchase-orders', `po-supplier-1-${randomUUID()}`, {
      ...twoLinePayload(),
      supplier_id: activeSupplierId,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { supplier_id: string; supplier_name: string } }>().data;
    expect(body.supplier_id).toBe(activeSupplierId);
    expect(body.supplier_name).toBe(`Active Supplier ${activeSupplierId}`);
  });

  it('creating a PO against an inactive supplier is rejected with purchase_order_supplier_inactive', async () => {
    authContext = baseContext(companyId, branchId);
    const response = await post('/api/v1/purchase-orders', `po-supplier-inactive-${randomUUID()}`, {
      ...twoLinePayload(),
      supplier_id: inactiveSupplierId,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('purchase_order_supplier_inactive');
  });

  it('creating a PO against a cross-company supplier_id is rejected with purchase_order_supplier_not_found', async () => {
    authContext = baseContext(companyId, branchId);
    const response = await post('/api/v1/purchase-orders', `po-supplier-cross-${randomUUID()}`, {
      ...twoLinePayload(),
      supplier_id: otherCompanySupplierId,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('purchase_order_supplier_not_found');
  });

  it('company A cannot see company B\'s purchase orders', async () => {
    authContext = baseContext(otherCompanyId, otherCompanyBranchId);
    const created = await post('/api/v1/purchase-orders', `po-tenant-b-${randomUUID()}`, {
      branch_id: otherCompanyBranchId,
      order_date: '2026-03-05',
      currency_code: 'MXN',
      lines: [{ product_variant_id: otherCompanyVariantId, ordered_quantity: '1', unit_cost: '1.0000' }],
    });
    expect(created.statusCode).toBe(201);
    const otherId = created.json<{ data: { id: string } }>().data.id;

    authContext = baseContext(companyId, branchId);
    const detail = await get(`/api/v1/purchase-orders/${otherId}`);
    expect(detail.statusCode).toBe(404);
    const list = await get('/api/v1/purchase-orders');
    expect(list.statusCode).toBe(200);
    const ids = list.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(ids).not.toContain(otherId);
  });

  it('permission enforcement: purchase.create/purchase.read/purchase.receive each 403 when missing', async () => {
    authContext = baseContext(companyId, branchId, ['purchase.read', 'purchase.receive']);
    const createDenied = await post('/api/v1/purchase-orders', `po-noperm-create-${randomUUID()}`, twoLinePayload());
    expect(createDenied.statusCode).toBe(403);

    authContext = baseContext(companyId, branchId, ['purchase.create', 'purchase.receive']);
    const readDenied = await get('/api/v1/purchase-orders');
    expect(readDenied.statusCode).toBe(403);

    authContext = baseContext(companyId, branchId, ['purchase.create', 'purchase.read']);
    const draft = await createDraft();
    authContext = baseContext(companyId, branchId, ['purchase.create', 'purchase.read']);
    const submitted = await post(`/api/v1/purchase-orders/${draft.id}/submit`, `po-permsub-${randomUUID()}`, {});
    expect(submitted.statusCode).toBe(200);
    authContext = baseContext(companyId, branchId, ['purchase.create', 'purchase.read']); // no purchase.receive.
    const receiveDenied = await post(`/api/v1/purchase-orders/${draft.id}/receive`, `po-noperm-receive-${randomUUID()}`, {
      lines: [{ purchase_order_line_id: draft.lines[0]?.id ?? '', received_quantity: '1' }],
    });
    expect(receiveDenied.statusCode).toBe(403);
  });
});
