import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { CashRepository } from '../cash/cash.repository.js';
import { CashService } from '../cash/cash.service.js';
import type { CashMutationContext } from '../cash/cash.types.js';
import { registerAssistantRoutes } from './assistant.routes.js';
import { AssistantRepository } from './assistant.repository.js';
import { AssistantService } from './assistant.service.js';

/**
 * TASK 12.2 — real end-to-end coverage for the "Asistente" endpoint,
 * mirroring `reports.integration.test.ts`'s own established shape: a REAL
 * Fastify app wired to the REAL, Postgres-backed `AssistantService`/
 * `AssistantRepository` (only the auth LAYER is faked — the same mutable,
 * always-authenticated context pattern every other Wave 1/2 integration
 * test in this codebase already uses), driving genuine `app.inject()` HTTP
 * round trips so `requireAuthenticatedUser`/`requireBranchAccess` are
 * exercised for real.
 *
 * "Today" fixtures are anchored to the REAL current UTC calendar day
 * (never a hardcoded past date) — `assistant.repository.ts`'s own
 * `sales_today`/`open_parties_today` queries are genuinely live, so this
 * file computes its "in range" / "out of range" timestamps the same way,
 * relative to whenever the suite actually runs.
 */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://assistant-integration-disabled';
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

function utcMidnight(daysOffset: number): Date {
  const now = new Date();
  const truncated = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  truncated.setUTCDate(truncated.getUTCDate() + daysOffset);
  return truncated;
}
function todayIso(): string {
  return utcMidnight(0).toISOString().slice(0, 10);
}
function atHour(daysOffset: number, hour: number): Date {
  return new Date(utcMidnight(daysOffset).getTime() + hour * 60 * 60 * 1000);
}

integration('Assistant deterministic FAQ matcher (TASK 12.2)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;
  let cashService: CashService;

  const companyId = randomUUID();
  const branchId = randomUUID(); // permitted branch.
  const excludedBranchId = randomUUID(); // same company, NOT in permittedBranchIds.
  const userId = randomUUID();

  function baseContext(forPermittedBranchIds: readonly string[]): AuthContext {
    return {
      sessionId: randomUUID(),
      userId,
      membershipId: randomUUID(),
      companyId,
      branchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: false,
      permissions: [],
      permittedBranchIds: forPermittedBranchIds,
      transportMode: 'bearer',
    };
  }
  let authContext: AuthContext = baseContext([branchId]);

  let registerId: string;
  let sessionId: string;

  function cashContext(timestamp: Date): CashMutationContext {
    return { companyId, actorId: userId, requestId: randomUUID(), correlationId: randomUUID(), timestamp };
  }

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: integrationDatabaseUrl, applicationName: 'asone-assistant-integration' });

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
    // `party_reservations`/`party_rooms`/`party_packages` are created in
    // this same migration file (alongside `direct_purchases`) — see
    // `reports.integration.test.ts`'s own identical `applyIfMissing` call.
    await applyIfMissing(database, 'direct_purchases', ['0024_vengeful_metal_master.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Assistant Co','Assistant Co',$2,'active','UTC','MXN','es-MX')`,
      [companyId, `assistant-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Assistant Main','AMAIN','active','UTC'),($3,$2,'Assistant Excluded','AEXCL','active','UTC')`,
      [branchId, companyId, excludedBranchId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Assistant Actor','active')`,
      [userId, `assistant-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, userId],
    );

    // --- Sales (sales_today) -------------------------------------------
    async function insertSale(input: {
      id: string;
      forBranchId: string;
      number: string;
      total: string;
      completedAt: Date;
    }): Promise<void> {
      await database.pool.query(
        `insert into sales(id,company_id,branch_id,sale_number,status,currency_code,subtotal,tax_total,total,completed_at,created_by)
         values($1,$2,$3,$4,'completed','MXN',$5,'0.0000',$5,$6,$7)`,
        [input.id, companyId, input.forBranchId, input.number, input.total, input.completedAt, userId],
      );
    }
    // Two completed sales TODAY, permitted branch — the known fixture.
    await insertSale({ id: randomUUID(), forBranchId: branchId, number: 'AS-0001', total: '100.0000', completedAt: atHour(0, 9) });
    await insertSale({ id: randomUUID(), forBranchId: branchId, number: 'AS-0002', total: '50.0000', completedAt: atHour(0, 14) });
    // Yesterday — must NOT be counted.
    await insertSale({ id: randomUUID(), forBranchId: branchId, number: 'AS-0003', total: '200.0000', completedAt: atHour(-1, 9) });
    // Today, but the EXCLUDED branch — must NOT be counted for an actor
    // whose permittedBranchIds is just [branchId].
    await insertSale({
      id: randomUUID(),
      forBranchId: excludedBranchId,
      number: 'AS-0004',
      total: '999.0000',
      completedAt: atHour(0, 9),
    });

    // --- Cash (register_status), via the REAL CashService flow ----------
    const cashRepository = new CashRepository(database);
    cashService = new CashService(cashRepository);
    const registerResult = await cashService.createRegister(cashContext(atHour(0, 8)), [branchId], `reg-${randomUUID()}`, {
      branchId,
      code: `AS-REG-${randomUUID()}`,
      name: 'Assistant Register',
    });
    registerId = registerResult.value.id;
    const sessionResult = await cashService.openSession(cashContext(atHour(0, 8)), [branchId], `sess-${randomUUID()}`, {
      cashRegisterId: registerId,
      openingAmount: '100.0000',
    });
    sessionId = sessionResult.value.id;

    // --- Inventory (low_stock_count) ------------------------------------
    const lowStockProductId = randomUUID();
    const lowStockVariantId = randomUUID();
    const healthyProductId = randomUUID();
    const healthyVariantId = randomUUID();
    const excludedLowStockProductId = randomUUID();
    const excludedLowStockVariantId = randomUUID();
    const locationId = randomUUID();
    const excludedLocationId = randomUUID();
    async function insertVariant(productId: string, variantId: string, sku: string): Promise<void> {
      const normalizedSku = sku.toLowerCase();
      await database.pool.query(
        `insert into products(id,company_id,code,normalized_code,name,product_type,tracks_inventory,tax_code,status,created_by,updated_by)
         values($1,$2,$3,$4,$3,'simple',true,'IVA_GENERAL','active',$5,$5)`,
        [productId, companyId, sku, normalizedSku, userId],
      );
      await database.pool.query(
        `insert into product_variants
         (id,company_id,product_id,sku,normalized_sku,name,unit_of_measure_code,quantity_scale,tracks_inventory,standard_cost,currency_code,is_default,option_signature,status,created_by,updated_by)
         values($1,$2,$3,$4,$5,'Variante','unit',0,true,5,'MXN',true,$6,'active',$7,$7)`,
        [variantId, companyId, productId, sku, normalizedSku, randomUUID().replace(/-/g, '').padEnd(64, '0'), userId],
      );
    }
    await insertVariant(lowStockProductId, lowStockVariantId, 'AS-LOW');
    await insertVariant(healthyProductId, healthyVariantId, 'AS-HEALTHY');
    await insertVariant(excludedLowStockProductId, excludedLowStockVariantId, 'AS-EXCL-LOW');
    await database.pool.query(
      `insert into inventory_locations (id,company_id,branch_id,code,normalized_code,name,location_type,status,allows_receiving,allows_issuing,is_default,created_by,updated_by)
       values($1,$2,$3,'MAIN','main','Main','main','active',true,true,true,$4,$4),
             ($5,$2,$6,'MAIN','main','Main','main','active',true,true,true,$4,$4)`,
      [locationId, companyId, branchId, userId, excludedLocationId, excludedBranchId],
    );
    // Low stock: on_hand - reserved <= 0 (permitted branch) — counted.
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,'5.000000','5.000000','5.0000','MXN')`,
      [randomUUID(), companyId, branchId, locationId, lowStockVariantId],
    );
    // Healthy: on_hand - reserved > 0 (permitted branch) — NOT counted.
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,'20.000000','2.000000','5.0000','MXN')`,
      [randomUUID(), companyId, branchId, locationId, healthyVariantId],
    );
    // Low stock at the EXCLUDED branch — must NOT be counted for an actor
    // scoped to [branchId] only.
    await database.pool.query(
      `insert into inventory_balances(id,company_id,branch_id,inventory_location_id,product_variant_id,quantity_on_hand,quantity_reserved,average_unit_cost,currency_code)
       values($1,$2,$3,$4,$5,'1.000000','1.000000','5.0000','MXN')`,
      [randomUUID(), companyId, excludedBranchId, excludedLocationId, excludedLowStockVariantId],
    );

    // --- Parties (open_parties_today) ------------------------------------
    const roomId = randomUUID();
    const excludedRoomId = randomUUID();
    const packageId = randomUUID();
    const excludedPackageId = randomUUID();
    await database.pool.query(
      `insert into party_rooms(id,company_id,branch_id,code,name,status,created_by,updated_by)
       values($1,$2,$3,'ROOM-A','Room A','active',$4,$4),($5,$2,$6,'ROOM-B','Room B','active',$4,$4)`,
      [roomId, companyId, branchId, userId, excludedRoomId, excludedBranchId],
    );
    await database.pool.query(
      `insert into party_packages(id,company_id,branch_id,code,name,status,price,currency_code,duration_minutes,created_by,updated_by)
       values($1,$2,$3,'PKG-A','Package A','active','500.0000','MXN',60,$4,$4),
             ($5,$2,$6,'PKG-B','Package B','active','500.0000','MXN',60,$4,$4)`,
      [packageId, companyId, branchId, userId, excludedPackageId, excludedBranchId],
    );
    // Today, confirmed, permitted branch — counted.
    await database.pool.query(
      `insert into party_reservations(id,company_id,branch_id,reservation_number,room_id,package_id,event_date,start_time,end_time,status,quoted_total,currency_code,created_by,updated_by)
       values($1,$2,$3,'PR-0001',$4,$5,$6,'10:00','11:00','confirmed','500.0000','MXN',$7,$7)`,
      [randomUUID(), companyId, branchId, roomId, packageId, todayIso(), userId],
    );
    // Today, CANCELLED, permitted branch — must NOT be counted.
    await database.pool.query(
      `insert into party_reservations(id,company_id,branch_id,reservation_number,room_id,package_id,event_date,start_time,end_time,status,quoted_total,currency_code,cancelled_at,cancelled_by,cancellation_reason,created_by,updated_by)
       values($1,$2,$3,'PR-0002',$4,$5,$6,'12:00','13:00','cancelled','500.0000','MXN',now(),$7,'test cancel',$7,$7)`,
      [randomUUID(), companyId, branchId, roomId, packageId, todayIso(), userId],
    );
    // Today, confirmed, EXCLUDED branch — must NOT be counted for an
    // actor scoped to [branchId] only.
    await database.pool.query(
      `insert into party_reservations(id,company_id,branch_id,reservation_number,room_id,package_id,event_date,start_time,end_time,status,quoted_total,currency_code,created_by,updated_by)
       values($1,$2,$3,'PR-0003',$4,$5,$6,'10:00','11:00','confirmed','500.0000','MXN',$7,$7)`,
      [randomUUID(), companyId, excludedBranchId, excludedRoomId, excludedPackageId, todayIso(), userId],
    );

    const authentication = {
      authenticate: () => Promise.resolve(authContext),
      requirePermission: () => {
        /* not used by this module's routes — kept only to satisfy the
         * AuthService shape this test fakes. */
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
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
      return reply.code(statusCode).send({ error: { code: 'internal_error', message: (error as Error).message } });
    });

    registerAssistantRoutes(app, authentication, new AssistantService(new AssistantRepository(database)));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.pool.query('delete from party_reservations where company_id=$1', [companyId]);
    await database.pool.query('delete from party_packages where company_id=$1', [companyId]);
    await database.pool.query('delete from party_rooms where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_balances where company_id=$1', [companyId]);
    await database.pool.query('delete from inventory_locations where company_id=$1', [companyId]);
    await database.pool.query('delete from product_variants where company_id=$1', [companyId]);
    await database.pool.query('delete from products where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_movements where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_sessions where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_registers where company_id=$1', [companyId]);
    await database.pool.query('delete from sales where company_id=$1', [companyId]);
    await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
    await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
    await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id=$1', [companyId]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  function post(body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({ method: 'POST', url: '/api/v1/assistant/query', headers: { authorization: 'Bearer x' }, payload: body });
  }

  it('(a) sales_today: real completed-sale count/total for today, excluding yesterday and the excluded branch', async () => {
    authContext = baseContext([branchId]);
    const response = await post({ question: '¿Cuántas ventas hubo hoy?' });
    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: { intent: string; answer_text: string; data: Record<string, unknown> } }>().data;
    expect(data.intent).toBe('sales_today');
    expect(data.data.transaction_count).toBe(2); // AS-0001 + AS-0002 only.
    expect(data.data.gross_totals).toEqual([{ currency_code: 'MXN', amount: '150.0000' }]); // 100 + 50.
    expect(data.answer_text).toContain('2 ventas');
    expect(data.answer_text).toContain('150.0000 MXN');
  });

  it('(b) register_status: affirmative while a session is open, honest negative once it is closed', async () => {
    authContext = baseContext([branchId]);
    const openResponse = await post({ question: '¿Está abierta la caja?' });
    const openData = openResponse.json<{ data: { intent: string; answer_text: string; data: Record<string, unknown> } }>().data;
    expect(openData.intent).toBe('register_status');
    expect(openData.data.is_open).toBe(true);
    expect(openData.answer_text).toContain('Sí');

    await cashService.closeSession(cashContext(atHour(0, 20)), [branchId], `close-${randomUUID()}`, sessionId, {
      declaredClosingAmount: '100.0000',
    });

    const closedResponse = await post({ question: '¿Está abierta la caja?' });
    const closedData = closedResponse.json<{ data: { data: Record<string, unknown>; answer_text: string } }>().data;
    expect(closedData.data.is_open).toBe(false);
    expect(closedData.answer_text).toContain('No');
  });

  it('(c) low_stock_count: a genuinely depleted row is counted, a healthy row is not', async () => {
    authContext = baseContext([branchId]);
    const response = await post({ question: '¿Qué productos están agotados?' });
    const data = response.json<{ data: { intent: string; data: Record<string, unknown> } }>().data;
    expect(data.intent).toBe('low_stock_count');
    expect(data.data.low_stock_variant_count).toBe(1); // only the low-stock variant.
  });

  it('(d) open_parties_today: a confirmed reservation for today is counted, a cancelled one is not', async () => {
    authContext = baseContext([branchId]);
    const response = await post({ question: '¿Hay fiestas hoy?' });
    const data = response.json<{ data: { intent: string; data: Record<string, unknown> } }>().data;
    expect(data.intent).toBe('open_parties_today');
    expect(data.data.open_parties_today_count).toBe(1); // only PR-0001.
  });

  it('(e) an unmatched question returns the honest unknown intent, never a guessed one', async () => {
    authContext = baseContext([branchId]);
    const response = await post({ question: '¿Cuál es el sentido de la vida?' });
    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: { intent: string; answer_text: string; data: unknown } }>().data;
    expect(data.intent).toBe('unknown');
    expect(data.data).toBeNull();
    expect(data.answer_text).toContain('No tengo una respuesta preparada');
  });

  it('(f) branch scoping: a same-company excluded-branch fixture never leaks into any answer', async () => {
    // permittedBranchIds is just [branchId] — excludedBranchId's real
    // AS-0004 sale (999.0000), low-stock row, and party reservation must
    // never appear in any of these answers.
    authContext = baseContext([branchId]);
    const sales = await post({ question: 'ventas de hoy' });
    expect(sales.json<{ data: { data: { gross_totals: unknown[] } } }>().data.data.gross_totals).toEqual([
      { currency_code: 'MXN', amount: '150.0000' },
    ]);
    const lowStock = await post({ question: 'stock bajo' });
    expect(lowStock.json<{ data: { data: { low_stock_variant_count: number } } }>().data.data.low_stock_variant_count).toBe(1);
    const parties = await post({ question: 'fiestas hoy' });
    expect(parties.json<{ data: { data: { open_parties_today_count: number } } }>().data.data.open_parties_today_count).toBe(1);

    // An actor whose permittedBranchIds DOES include the excluded branch
    // sees strictly more — proving the exclusion above was real scoping,
    // not a broken query.
    authContext = baseContext([branchId, excludedBranchId]);
    const widerSales = await post({ question: 'ventas de hoy' });
    expect(widerSales.json<{ data: { data: { gross_totals: unknown[] } } }>().data.data.gross_totals).toEqual([
      { currency_code: 'MXN', amount: '1149.0000' }, // 150 + 999.
    ]);
  });

  it('(g) an unauthenticated request is rejected', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/query',
      payload: { question: 'ventas de hoy' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('a missing/empty question is rejected as a real validation error, never silently accepted', async () => {
    authContext = baseContext([branchId]);
    const missing = await post({});
    expect(missing.statusCode).toBe(400);
    const blank = await post({ question: '   ' });
    expect(blank.statusCode).toBe(400);
  });

  it('an unpermitted branch_id is rejected via the real requireBranchAccess check', async () => {
    authContext = baseContext([branchId]);
    const response = await post({ question: 'ventas de hoy', branch_id: excludedBranchId });
    expect(response.statusCode).toBe(403);
  });
});
