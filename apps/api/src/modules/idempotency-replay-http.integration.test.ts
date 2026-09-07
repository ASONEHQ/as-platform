import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from './auth/auth.types.js';
import type { AuthService } from './auth/auth.service.js';
import { CatalogRepository } from './catalog/catalog.repository.js';
import { registerCatalogRoutes } from './catalog/catalog.routes.js';
import { CatalogService } from './catalog/catalog.service.js';
import { CustomersRepository } from './customers/customers.repository.js';
import { registerCustomerRoutes } from './customers/customers.routes.js';
import { CustomersService } from './customers/customers.service.js';
import { LoyaltyRepository } from './loyalty/loyalty.repository.js';
import { registerLoyaltyRoutes } from './loyalty/loyalty.routes.js';
import { LoyaltyService } from './loyalty/loyalty.service.js';
import { MembershipsRepository } from './memberships/memberships.repository.js';
import { registerMembershipRoutes } from './memberships/memberships.routes.js';
import { MembershipsService } from './memberships/memberships.service.js';
import { PromotionsRepository } from './promotions/promotions.repository.js';
import { registerPromotionRoutes } from './promotions/promotions.routes.js';
import { PromotionsService } from './promotions/promotions.service.js';

/** TASK 13.1A — real HTTP idempotency-replay regression coverage.
 *
 * TASK 13.1's own Real Local QA walkthrough (a script hitting the REAL
 * running dev server, not a mock) found a genuine, previously invisible
 * bug: `idempotent()`'s persisted `response_body` is real JSON — every
 * `Date` field on a replay is actually an ISO STRING, not a `Date`
 * instance, despite the row type's own declaration. `RewardsService` was
 * fixed with a real decoder during TASK 13.1; this task (13.1A) is the
 * forensic sweep across every OTHER module's `idempotent()` call site,
 * fixing every genuinely affected one (`customers`, `loyalty`,
 * `memberships`, `promotions`, and `catalog`'s category/brand creation —
 * a fifth site this sweep discovered that wasn't in the original four
 * named) and leaving every already-correct decoder (`sales`, `payments`,
 * `refunds`, `cash`, `product-catalog`, `product-options`, `inventory`,
 * `reservation`) untouched. See ADR-0018 §"Idempotent replay decoding"
 * for the full rationale.
 *
 * The bug is architecturally invisible to a SERVICE-level test (calling
 * `service.createX(...)` directly and inspecting `.status`/`.id` never
 * exercises `.toISOString()`) — it only manifests at the HTTP boundary,
 * where the route's own `xHttp()` mapper calls `.toISOString()` on what
 * it believes is a `Date`. This file therefore boots a REAL Fastify app
 * with REAL, database-backed services (only the auth LAYER is faked —
 * a fixed, always-authenticated context, mirroring
 * `settings.routes.integration.test.ts`'s own established pattern for
 * this exact kind of full-stack-minus-auth test) and drives genuine
 * `app.inject()` HTTP round-trips: create, then replay with the SAME
 * idempotency key, and assert the replay is a clean 200/201 — never the
 * 500 this bug used to produce — with well-formed ISO date strings in
 * the response and no duplicate row created. */

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://idempotency-replay-http-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../packages/database/drizzle');

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

const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

integration('Real HTTP idempotency-replay regression (TASK 13.1A)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-idempotency-replay-http-test',
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

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Replay Co','Replay Co',$2,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `idem-replay-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Replay Main','RMAIN','active','America/Mexico_City')`,
      [branchId, companyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Replay Actor','active')`,
      [userId, `idem-replay-${userId}@example.test`],
    );
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyId, userId],
    );

    const authContext: AuthContext = {
      sessionId: randomUUID(),
      userId,
      membershipId: randomUUID(),
      companyId,
      branchId,
      expiresAt: new Date(Date.now() + 60_000),
      companyWideAccess: true,
      permissions: [
        'customer.create',
        'loyalty.manage',
        'loyalty.adjust',
        'membership.manage',
        'promotion.manage',
        'category.manage',
      ],
      permittedBranchIds: [branchId],
    };
    const authentication = {
      authenticate: vi.fn(() => Promise.resolve(authContext)),
      requirePermission: vi.fn((_context: AuthContext, permission: string) => {
        if (!authContext.permissions.includes(permission))
          throw new AppError({ code: 'permission_denied', message: 'Permission denied.', statusCode: 403 });
      }),
      requireBranchAccess: vi.fn(() => undefined),
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
      // A genuine crash (the very bug this file exists to catch) must
      // surface as a real, visible 500 — never swallowed or reshaped —
      // so a regression here fails the test loudly.
      return reply.code(500).send({ error: { code: 'internal_error', message: (error as Error).message } });
    });

    registerCustomerRoutes(app, authentication, new CustomersService(new CustomersRepository(database)));
    registerLoyaltyRoutes(app, authentication, new LoyaltyService(new LoyaltyRepository(database)));
    registerMembershipRoutes(app, authentication, new MembershipsService(new MembershipsRepository(database)));
    registerPromotionRoutes(app, authentication, new PromotionsService(new PromotionsRepository(database)));
    registerCatalogRoutes(app, authentication, new CatalogService(new CatalogRepository(database)));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.pool.query('delete from product_categories where company_id=$1', [companyId]);
    await database.pool.query('delete from coupons where company_id=$1', [companyId]);
    await database.pool.query('delete from promotions where company_id=$1', [companyId]);
    await database.pool.query('delete from customer_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from membership_plans where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_ledger where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_accounts where company_id=$1', [companyId]);
    await database.pool.query('delete from loyalty_programs where company_id=$1', [companyId]);
    await database.pool.query('delete from customers where company_id=$1', [companyId]);
    await database.pool.query('delete from idempotency_keys where company_id=$1', [companyId]);
    await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
    await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id=$1', [companyId]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  it('CUSTOMERS: POST /customers replays the same idempotency key as a clean 200-shaped success — never a 500 — with real ISO dates and no duplicate row', async () => {
    const key = `cust-replay-${randomUUID()}`;
    const payload = { first_name: 'Idem', last_name: 'Replay' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ data: { id: string; created_at: string; updated_at: string } }>().data;
    expect(firstBody.created_at).toMatch(isoDate);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(replay.statusCode).toBe(201); // NOT 500 — this is the exact regression this file guards.
    const replayBody = replay.json<{ data: { id: string; created_at: string; updated_at: string } }>().data;
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.created_at).toBe(firstBody.created_at);
    expect(replayBody.created_at).toMatch(isoDate);

    const rows = await database.pool.query<{ count: string }>(
      `select count(*)::text count from customers where company_id=$1 and first_name='Idem'`,
      [companyId],
    );
    expect(rows.rows[0]?.count).toBe('1'); // exactly one row — never duplicated by the replay.
  });

  it('LOYALTY: POST /customers/{id}/loyalty/adjust replays cleanly — never a 500 — with a real ISO occurred_at and no duplicate ledger row', async () => {
    // `POST /loyalty-programs`'s own response (`programHttp`) carries no
    // Date field at all — it was never actually exposed to this bug at
    // the HTTP boundary, even before TASK 13.1A's decoder fix. The
    // manual ledger ADJUSTMENT endpoint is the genuinely vulnerable one:
    // `ledgerEntryHttp` calls `.toISOString()` on `occurredAt`.
    const customer = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer x', 'idempotency-key': `loyalty-adjust-cust-${randomUUID()}`, 'content-type': 'application/json' },
      payload: { first_name: 'LoyaltyAdjustTarget' },
    });
    expect(customer.statusCode).toBe(201);
    const customerId = customer.json<{ data: { id: string } }>().data.id;

    const key = `loyalty-adjust-replay-${randomUUID()}`;
    const payload = { quantity: 3, unit_type: 'stamp', reason: 'Idem replay adjustment' };
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/loyalty/adjust`,
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ data: { id: string; occurred_at: string } }>().data;
    expect(firstBody.occurred_at).toMatch(isoDate);

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerId}/loyalty/adjust`,
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(replay.statusCode).toBe(201); // NOT 500 — this is the exact regression this file guards.
    const replayBody = replay.json<{ data: { id: string; occurred_at: string } }>().data;
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.occurred_at).toBe(firstBody.occurred_at);
    expect(replayBody.occurred_at).toMatch(isoDate);

    const rows = await database.pool.query<{ count: string }>(
      `select count(*)::text count from loyalty_ledger where company_id=$1 and reason='Idem replay adjustment'`,
      [companyId],
    );
    expect(rows.rows[0]?.count).toBe('1'); // exactly one ledger row — never double-earned/double-adjusted by the replay.
  });

  it('MEMBERSHIPS: POST /membership-plans replays cleanly — never a 500 — with real ISO dates and no duplicate row', async () => {
    const key = `membership-replay-${randomUUID()}`;
    const payload = { name: 'Idem Replay Plan' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/membership-plans',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ data: { id: string; created_at: string } }>().data;
    expect(firstBody.created_at).toMatch(isoDate);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/membership-plans',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    const replayBody = replay.json<{ data: { id: string; created_at: string } }>().data;
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.created_at).toBe(firstBody.created_at);

    const rows = await database.pool.query<{ count: string }>(
      `select count(*)::text count from membership_plans where company_id=$1 and name='Idem Replay Plan'`,
      [companyId],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('PROMOTIONS: POST /promotions replays cleanly — never a 500 — with real ISO dates (including the nullable starts_at/ends_at) and no duplicate row', async () => {
    const key = `promotion-replay-${randomUUID()}`;
    const payload = {
      name: 'Idem Replay Promotion',
      benefit_type: 'percentage',
      benefit_percentage_basis_points: 1000,
      // Deliberately set — PromotionRow.startsAt/endsAt are the NULLABLE
      // Date fields this bug class most easily hides in; a program that
      // never exercises them wouldn't actually prove the fix.
      starts_at: '2026-01-01T00:00:00.000Z',
      ends_at: '2026-12-31T00:00:00.000Z',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/promotions',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ data: { id: string; created_at: string; starts_at: string; ends_at: string } }>().data;
    expect(firstBody.created_at).toMatch(isoDate);
    expect(firstBody.starts_at).toMatch(isoDate);
    expect(firstBody.ends_at).toMatch(isoDate);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/promotions',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    const replayBody = replay.json<{ data: { id: string; created_at: string; starts_at: string; ends_at: string } }>().data;
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.created_at).toBe(firstBody.created_at);
    expect(replayBody.starts_at).toBe(firstBody.starts_at);
    expect(replayBody.ends_at).toBe(firstBody.ends_at);

    const rows = await database.pool.query<{ count: string }>(
      `select count(*)::text count from promotions where company_id=$1 and name='Idem Replay Promotion'`,
      [companyId],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('CATALOG: POST /categories replays cleanly — never a 500 — with real ISO dates and no duplicate row (TASK 13.1A discovered this fifth affected site)', async () => {
    const key = `category-replay-${randomUUID()}`;
    const payload = { code: 'IDEM-REPLAY', name: 'Idem Replay Category' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{ data: { id: string; created_at: string; updated_at: string } }>().data;
    expect(firstBody.created_at).toMatch(isoDate);
    expect(firstBody.updated_at).toMatch(isoDate);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload,
    });
    expect(replay.statusCode).toBe(201); // NOT 500 — this is exactly the bug found via TASK 13.1's own Real Local QA.
    const replayBody = replay.json<{ data: { id: string; created_at: string; updated_at: string } }>().data;
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.created_at).toBe(firstBody.created_at);
    expect(replayBody.updated_at).toBe(firstBody.updated_at);

    const rows = await database.pool.query<{ count: string }>(
      `select count(*)::text count from product_categories where company_id=$1 and code='IDEM-REPLAY'`,
      [companyId],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('a DIFFERENT idempotency key with a DIFFERENT request body is a genuine new mutation, never treated as a replay', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer x', 'idempotency-key': `cust-distinct-a-${randomUUID()}`, 'content-type': 'application/json' },
      payload: { first_name: 'DistinctA' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer x', 'idempotency-key': `cust-distinct-b-${randomUUID()}`, 'content-type': 'application/json' },
      payload: { first_name: 'DistinctB' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json<{ data: { id: string } }>().data.id).not.toBe(second.json<{ data: { id: string } }>().data.id);
  });

  it('the SAME idempotency key with a genuinely DIFFERENT request body is a deterministic conflict, never silently replayed', async () => {
    const key = `cust-conflict-${randomUUID()}`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: { first_name: 'ConflictOriginal' },
    });
    expect(first.statusCode).toBe(201);
    const conflicting = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: { first_name: 'ConflictDifferent' },
    });
    // This codebase's actual, consistent convention (every `idempotent()`
    // implementation checked in this task) rejects a hash mismatch as
    // `validation_error` / 400 — "The idempotency key was used with
    // another request." — never a dedicated `idempotency_conflict`/409
    // code (no such code exists in `packages/errors`). Asserting the
    // REAL behavior here, not an invented one.
    expect(conflicting.statusCode).toBe(400);
    expect(conflicting.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });
});
