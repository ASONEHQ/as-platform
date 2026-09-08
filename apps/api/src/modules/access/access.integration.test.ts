import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { registerAccessRoutes } from './access.routes.js';
import { AccessRepository } from './access.repository.js';
import { AccessService } from './access.service.js';

/**
 * TASK 14.4 (Wave 2, Part E) — Access/Occupancy real end-to-end coverage.
 *
 * Boots a REAL Fastify app with the REAL, Postgres-backed
 * `AccessService`/`AccessRepository` (only the auth LAYER is faked — a
 * mutable, always-authenticated context whose `permissions`/
 * `permittedBranchIds`/`companyId` each test can vary, the exact
 * established pattern `purchasing.integration.test.ts`/
 * `idempotency-replay-http.integration.test.ts` already use for this kind
 * of full-stack-minus-auth test), driving genuine `app.inject()` HTTP
 * round trips — so `requirePermission`/`requireBranchAccess`
 * (`auth.guards.ts`) are exercised for real, and every assertion re-reads
 * the REAL `access_credentials`/`access_events` rows straight from
 * Postgres, never trusting the value handed back by the mutating call
 * itself.
 *
 * Running against a real, restartable Postgres instance (never an
 * in-process fake, and nothing held in memory between one call and the
 * next anywhere in this module) is itself the proof of "restart safety" —
 * mirrored from `held-sales.integration.test.ts`'s own identical
 * reasoning — so no dedicated "survives a restart" test exists separately
 * from every other assertion here re-reading straight from the database.
 */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://access-integration-disabled';
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

integration('PostgreSQL access/occupancy (TASK 14.4, Wave 2 Part E)', { concurrent: false }, () => {
  let app: FastifyInstance;
  let database: DatabaseClient;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const userId = randomUUID();
  const otherCompanyUserId = randomUUID();

  const allPermissions = ['access.scan', 'access.read', 'access.manage'] as const;

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

  /** Direct SQL insertion of an already-`completed` (paid) sale —
   * mirrors `cash.integration.test.ts`'s/`refunds.integration.test.ts`'s
   * own identical established pattern for a test fixture sale that is
   * not itself under test (this module never re-tests `SalesService`'s
   * own pricing/creation logic — it only needs a REAL, real-shape,
   * genuinely-paid sale row to issue a credential against). */
  async function insertCompletedSale(forCompanyId: string, forBranchId: string, actorId: string): Promise<string> {
    const id = randomUUID();
    await database.pool.query(
      `insert into sales (id,company_id,branch_id,sale_number,status,currency_code,subtotal,discount_total,tax_total,total,paid_total,occurred_at,completed_at,created_by,created_at,updated_at)
       values ($1,$2,$3,$4,'completed','MXN','29.0000','0.0000','0.0000','29.0000','29.0000',now(),now(),$5,now(),now())`,
      [id, forCompanyId, forBranchId, `SALE-${id.replaceAll('-', '')}`, actorId],
    );
    return id;
  }
  async function insertPendingSale(forCompanyId: string, forBranchId: string, actorId: string): Promise<string> {
    const id = randomUUID();
    await database.pool.query(
      `insert into sales (id,company_id,branch_id,sale_number,status,currency_code,subtotal,discount_total,tax_total,total,paid_total,occurred_at,created_by,created_at,updated_at)
       values ($1,$2,$3,$4,'pending_payment','MXN','29.0000','0.0000','0.0000','29.0000','0.0000',now(),$5,now(),now())`,
      [id, forCompanyId, forBranchId, `SALE-${id.replaceAll('-', '')}`, actorId],
    );
    return id;
  }

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-access-integration',
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
    await applyIfMissing(database, 'access_credentials', ['0025_worried_the_captain.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Access Co','Access Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Access Co','Other Access Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `access-${companyId}`, otherCompanyId, `access-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Access Main','AMAIN','active','UTC'),
             ($3,$2,'Access Second','ASECOND','active','UTC'),
             ($4,$5,'Access Other Co','AOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Access Cashier','active'),($3,$4,$4,'Access Other Co User','active')`,
      [userId, `access-${userId}@example.test`, otherCompanyUserId, `access-${otherCompanyUserId}@example.test`],
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
          error: { code: error.code, message: error.message, details: error.details },
          meta: { request_id: request.requestContext.requestId, correlation_id: request.requestContext.correlationId },
        });
      return reply.code(500).send({ error: { code: 'internal_error', message: (error as Error).message } });
    });

    const salesRepository = new SalesRepository(database);
    registerAccessRoutes(app, authentication, new AccessService(new AccessRepository(database), salesRepository));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const ids = [companyId, otherCompanyId];
    await database.pool.query('delete from access_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from access_credentials where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from sales where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from idempotency_keys where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from outbox_events where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from audit_log where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [ids]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[userId, otherCompanyUserId]]);
    await database.close();
  });

  function issue(key: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/access-credentials',
      headers: { authorization: 'Bearer x', 'idempotency-key': key, 'content-type': 'application/json' },
      payload: body,
    });
  }
  function scan(body: Record<string, unknown>): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/access-credentials/scan',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: body,
    });
  }
  function voidCredential(id: string, key: string): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/access-credentials/${id}/void`,
      headers: { authorization: 'Bearer x', 'idempotency-key': key },
    });
  }
  function occupancy(forBranchId: string): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'GET',
      url: `/api/v1/access-credentials/occupancy?branch_id=${forBranchId}`,
      headers: { authorization: 'Bearer x' },
    });
  }

  async function issueCredentialForNewSale(forBranchId = branchId): Promise<string> {
    const saleId = await insertCompletedSale(companyId, forBranchId, userId);
    const response = await issue(`ac-issue-${randomUUID()}`, { branch_id: forBranchId, sale_id: saleId });
    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string; code: string } }>().data.code;
  }

  // --- Issuance --------------------------------------------------------------

  describe('issuance', () => {
    it('issues a real credential against a real, already-completed sale', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`ac-issue-basic-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      expect(response.statusCode).toBe(201);
      const body = response.json<{ data: { id: string; code: string; sale_id: string; status: string; currently_inside: boolean } }>().data;
      expect(body.sale_id).toBe(saleId);
      expect(body.status).toBe('issued');
      expect(body.currently_inside).toBe(false);
      expect(body.code.length).toBeGreaterThan(0);

      const dbRow = await database.pool.query<{ sale_id: string; status: string }>(
        `select sale_id,status from access_credentials where company_id=$1 and id=$2`,
        [companyId, body.id],
      );
      expect(dbRow.rows[0]).toMatchObject({ sale_id: saleId, status: 'issued' });
    });

    it('rejects issuance against a sale that is not completed/paid', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertPendingSale(companyId, branchId, userId);
      const response = await issue(`ac-issue-pending-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
    });

    it('rejects issuance against an unknown sale id', async () => {
      authContext = baseContext(companyId, branchId);
      const response = await issue(`ac-issue-unknown-${randomUUID()}`, { branch_id: branchId, sale_id: randomUUID() });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
    });

    it('rejects issuance when the sale belongs to a different branch than requested', async () => {
      authContext = baseContext(companyId, branchId, [...allPermissions]);
      authContext = { ...authContext, permittedBranchIds: [branchId, otherBranchId] };
      const saleId = await insertCompletedSale(companyId, otherBranchId, userId);
      const response = await issue(`ac-issue-wrongbranch-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
    });

    it('the exact same Idempotency-Key retried twice issues exactly one credential', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const key = `ac-issue-idem-${randomUUID()}`;
      const first = await issue(key, { branch_id: branchId, sale_id: saleId });
      const second = await issue(key, { branch_id: branchId, sale_id: saleId });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect(first.json<{ data: { id: string } }>().data.id).toBe(second.json<{ data: { id: string } }>().data.id);
      const count = await database.pool.query<{ n: string }>(
        `select count(*)::text n from access_credentials where company_id=$1 and sale_id=$2`,
        [companyId, saleId],
      );
      expect(count.rows[0]?.n).toBe('1');
    });

    it('requires access.scan to issue', async () => {
      authContext = baseContext(companyId, branchId, ['access.read']);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`ac-issue-noperm-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Scan: entry/exit, tenant isolation, branch, re-entry -------------------

  describe('scan', () => {
    it('a valid entry scan flips currently_inside and records exactly one entry event', async () => {
      authContext = baseContext(companyId, branchId);
      const code = await issueCredentialForNewSale();
      const response = await scan({ branch_id: branchId, code });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { credential: { currently_inside: boolean }; event: { event_type: string } } }>().data;
      expect(body.credential.currently_inside).toBe(true);
      expect(body.event.event_type).toBe('entry');

      const events = await database.pool.query<{ event_type: string }>(
        `select event_type from access_events where company_id=$1 and credential_id=(select id from access_credentials where company_id=$1 and code=$2)`,
        [companyId, code],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.event_type).toBe('entry');
    });

    it('rejects an unknown code with credential_not_found', async () => {
      authContext = baseContext(companyId, branchId);
      const response = await scan({ branch_id: branchId, code: `AC-${randomUUID()}` });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'credential_not_found',
      );
    });

    it('a credential issued by another company is completely invisible to this company\'s scan (credential_not_found, never cross-tenant)', async () => {
      const otherSaleId = await insertCompletedSale(otherCompanyId, otherCompanyBranchId, otherCompanyUserId);
      authContext = baseContext(otherCompanyId, otherCompanyBranchId);
      const issued = await issue(`ac-otherco-${randomUUID()}`, { branch_id: otherCompanyBranchId, sale_id: otherSaleId });
      expect(issued.statusCode).toBe(201);
      const otherCode = issued.json<{ data: { code: string } }>().data.code;

      authContext = baseContext(companyId, branchId);
      const response = await scan({ branch_id: branchId, code: otherCode });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'credential_not_found',
      );
    });

    it('rejects a scan at the wrong branch (wrong_branch)', async () => {
      authContext = baseContext(companyId, branchId);
      const code = await issueCredentialForNewSale(branchId);
      authContext = { ...baseContext(companyId, otherBranchId), permittedBranchIds: [otherBranchId] };
      const response = await scan({ branch_id: otherBranchId, code });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'wrong_branch',
      );
    });

    it('a second, explicit entry attempt on an already-inside credential is rejected by the CAS guard itself (already_inside)', async () => {
      // The single `/scan` endpoint always INFERS direction from the
      // credential's own current state (see `AccessService.scan`'s own
      // doc comment) — a solo, non-racing caller scanning the same code
      // twice in a row therefore always alternates entry/exit correctly
      // and can never reproduce "a second entry while already inside" by
      // itself; that specific race is only ever real under genuine
      // concurrency (see the dedicated "concurrency" describe block
      // below, which exercises it through the real HTTP layer with two
      // truly simultaneous requests). This test instead exercises the
      // exact same underlying CAS guard `AccessRepository.markEntry`
      // itself relies on — two EXPLICIT entry attempts against the same
      // already-inside credential — directly at the repository layer,
      // the deterministic way to prove "duplicate entry-scan rejection"
      // without depending on scheduling luck.
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-already-inside-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const credentialId = issued.json<{ data: { id: string; code: string } }>().data.id;
      const code = issued.json<{ data: { id: string; code: string } }>().data.code;
      const first = await scan({ branch_id: branchId, code });
      expect(first.statusCode).toBe(200);
      const repository = new AccessRepository(database);
      await repository.transaction(async (client) => {
        const explicitSecondEntry = await repository.markEntry(client, companyId, credentialId, branchId);
        expect(explicitSecondEntry).toBeNull();
      });
    });

    it('a valid exit scan flips currently_inside back and records exactly one exit event', async () => {
      authContext = baseContext(companyId, branchId);
      const code = await issueCredentialForNewSale();
      await scan({ branch_id: branchId, code });
      const response = await scan({ branch_id: branchId, code });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { credential: { currently_inside: boolean }; event: { event_type: string } } }>().data;
      expect(body.credential.currently_inside).toBe(false);
      expect(body.event.event_type).toBe('exit');

      const events = await database.pool.query<{ event_type: string }>(
        `select event_type from access_events where company_id=$1 and credential_id=(select id from access_credentials where company_id=$1 and code=$2) order by occurred_at asc`,
        [companyId, code],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(['entry', 'exit']);
    });

    it('after a real entry+exit cycle, a further scan on this single-use credential never produces a negative occupancy count (rejected outright, never silently decremented)', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-notinside-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const code = issued.json<{ data: { code: string } }>().data.code;
      await scan({ branch_id: branchId, code }); // entry
      await scan({ branch_id: branchId, code }); // exit — occupancy back to baseline for this credential.
      const before = await occupancy(branchId);
      const beforeCount = before.json<{ data: { count: number } }>().data.count;
      // Currently outside, so the next scan is inferred as another ENTRY
      // attempt — rejected (`reentry_not_allowed`, this single-use
      // credential's own documented policy), never silently touching
      // `currently_inside` and never producing a negative count. The
      // genuine `not_inside` rejection code (an EXIT attempt landing on a
      // credential that is already outside) is exercised for real by the
      // concurrent-exit race in the "concurrency" block below — the
      // single inferring `/scan` endpoint can only ever originate an
      // exit attempt when the row's own read said `currently_inside=
      // true`, so a solo, non-racing call can never manufacture that
      // rejection on its own.
      const third = await scan({ branch_id: branchId, code });
      expect(third.statusCode).toBe(409);
      expect(third.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'reentry_not_allowed',
      );
      const after = await occupancy(branchId);
      expect(after.json<{ data: { count: number } }>().data.count).toBeGreaterThanOrEqual(0);
      expect(after.json<{ data: { count: number } }>().data.count).toBe(beforeCount);
    });

    it('single-use (allows_reentry=false, the default) rejects a second entry after a completed exit (reentry_not_allowed)', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-singleuse-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const code = issued.json<{ data: { code: string; allows_reentry: boolean } }>().data;
      expect(code.allows_reentry).toBe(false);
      await scan({ branch_id: branchId, code: code.code }); // entry
      await scan({ branch_id: branchId, code: code.code }); // exit
      const secondEntry = await scan({ branch_id: branchId, code: code.code });
      expect(secondEntry.statusCode).toBe(409);
      expect(
        secondEntry.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason,
      ).toBe('reentry_not_allowed');
    });

    it('multi-use (allows_reentry=true) allows entry→exit→entry→exit indefinitely', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-multiuse-${randomUUID()}`, {
        branch_id: branchId,
        sale_id: saleId,
        allows_reentry: true,
      });
      const code = issued.json<{ data: { code: string } }>().data.code;
      const first = await scan({ branch_id: branchId, code }); // entry
      expect(first.statusCode).toBe(200);
      const second = await scan({ branch_id: branchId, code }); // exit
      expect(second.statusCode).toBe(200);
      const third = await scan({ branch_id: branchId, code }); // entry again — allowed.
      expect(third.statusCode).toBe(200);
      expect(third.json<{ data: { event: { event_type: string } } }>().data.event.event_type).toBe('entry');
      const fourth = await scan({ branch_id: branchId, code }); // exit again — allowed.
      expect(fourth.statusCode).toBe(200);
      expect(fourth.json<{ data: { event: { event_type: string } } }>().data.event.event_type).toBe('exit');

      const events = await database.pool.query<{ event_type: string }>(
        `select event_type from access_events where company_id=$1 and credential_id=(select id from access_credentials where company_id=$1 and code=$2) order by occurred_at asc`,
        [companyId, code],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(['entry', 'exit', 'entry', 'exit']);
    });

    it('a voided credential is rejected with credential_void', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-void-scan-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const body = issued.json<{ data: { id: string; code: string } }>().data;
      const voided = await voidCredential(body.id, `ac-void-scan-key-${randomUUID()}`);
      expect(voided.statusCode).toBe(200);
      const response = await scan({ branch_id: branchId, code: body.code });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'credential_void',
      );
    });

    it('requires access.scan to scan', async () => {
      authContext = baseContext(companyId, branchId);
      const code = await issueCredentialForNewSale();
      authContext = baseContext(companyId, branchId, ['access.read']);
      const response = await scan({ branch_id: branchId, code });
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Occupancy ---------------------------------------------------------------

  describe('occupancy', () => {
    it('increases by exactly one on entry and decreases by exactly one on exit — never a separately-drifting counter', async () => {
      authContext = baseContext(companyId, otherBranchId);
      authContext = { ...authContext, permittedBranchIds: [otherBranchId] };
      const before = await occupancy(otherBranchId);
      const baseline = before.json<{ data: { count: number } }>().data.count;

      const saleId = await insertCompletedSale(companyId, otherBranchId, userId);
      const issued = await issue(`ac-occ-${randomUUID()}`, { branch_id: otherBranchId, sale_id: saleId });
      const code = issued.json<{ data: { code: string } }>().data.code;

      await scan({ branch_id: otherBranchId, code });
      const afterEntry = await occupancy(otherBranchId);
      expect(afterEntry.json<{ data: { count: number } }>().data.count).toBe(baseline + 1);

      await scan({ branch_id: otherBranchId, code });
      const afterExit = await occupancy(otherBranchId);
      expect(afterExit.json<{ data: { count: number } }>().data.count).toBe(baseline);
    });

    it('requires access.read to read occupancy', async () => {
      authContext = baseContext(companyId, branchId, ['access.scan']);
      const response = await occupancy(branchId);
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Void --------------------------------------------------------------------

  describe('void', () => {
    it('voids an issued, not-currently-inside credential', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-void-ok-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const id = issued.json<{ data: { id: string } }>().data.id;
      const response = await voidCredential(id, `ac-void-ok-key-${randomUUID()}`);
      expect(response.statusCode).toBe(200);
      const dbRow = await database.pool.query<{ status: string; voided_by: string }>(
        `select status,voided_by from access_credentials where company_id=$1 and id=$2`,
        [companyId, id],
      );
      expect(dbRow.rows[0]).toMatchObject({ status: 'void', voided_by: userId });
    });

    it('rejects voiding a currently-inside credential, asking for a real exit first', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-void-inside-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const body = issued.json<{ data: { id: string; code: string } }>().data;
      await scan({ branch_id: branchId, code: body.code }); // entry — now inside.
      const response = await voidCredential(body.id, `ac-void-inside-key-${randomUUID()}`);
      expect(response.statusCode).toBe(409);
      expect(
        response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason,
      ).toBe('credential_currently_inside');
    });

    it('requires access.manage to void (access.scan alone is not enough)', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-void-noperm-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const id = issued.json<{ data: { id: string } }>().data.id;
      authContext = baseContext(companyId, branchId, ['access.scan']);
      const response = await voidCredential(id, `ac-void-noperm-key-${randomUUID()}`);
      expect(response.statusCode).toBe(403);
    });

    it('the exact same Idempotency-Key retried twice voids exactly once', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-void-idem-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const id = issued.json<{ data: { id: string } }>().data.id;
      const key = `ac-void-idem-key-${randomUUID()}`;
      const first = await voidCredential(id, key);
      const second = await voidCredential(id, key);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.headers['idempotency-replayed']).toBe('true');
    });
  });

  // --- Concurrency: the real CAS guarantee --------------------------------------

  describe('concurrency', () => {
    it('two simultaneous entry-scan requests for the SAME code: exactly one succeeds, the other gets a clean already_inside, and exactly one entry event exists', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-race-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const body = issued.json<{ data: { id: string; code: string } }>().data;

      const [first, second] = await Promise.allSettled([
        scan({ branch_id: branchId, code: body.code }),
        scan({ branch_id: branchId, code: body.code }),
      ]);
      const responses = [first, second].map((settled) => {
        if (settled.status !== 'fulfilled') throw settled.reason;
        return settled.value;
      });
      const statusCodes = responses.map((r) => r.statusCode).sort();
      // Exactly one 200 (the winner) and exactly one 409 (already_inside) —
      // never two 200s (a duplicate entry) and never two 409s (a real
      // deadlock/failure on both sides).
      expect(statusCodes).toEqual([200, 409]);
      const loser = responses.find((r) => r.statusCode === 409);
      expect(loser?.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'already_inside',
      );

      const dbRow = await database.pool.query<{ currently_inside: string }>(
        `select currently_inside from access_credentials where company_id=$1 and id=$2`,
        [companyId, body.id],
      );
      expect(dbRow.rows[0]?.currently_inside).toBe('true');

      const events = await database.pool.query<{ event_type: string }>(
        `select event_type from access_events where company_id=$1 and credential_id=$2`,
        [companyId, body.id],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.event_type).toBe('entry');
    });

    it('two simultaneous exit-scan requests for the SAME (currently-inside) code: exactly one succeeds, the other gets a clean not_inside, and exactly one exit event exists', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const issued = await issue(`ac-race-exit-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      const body = issued.json<{ data: { id: string; code: string } }>().data;
      const entered = await scan({ branch_id: branchId, code: body.code });
      expect(entered.statusCode).toBe(200);

      const [first, second] = await Promise.allSettled([
        scan({ branch_id: branchId, code: body.code }),
        scan({ branch_id: branchId, code: body.code }),
      ]);
      const responses = [first, second].map((settled) => {
        if (settled.status !== 'fulfilled') throw settled.reason;
        return settled.value;
      });
      const statusCodes = responses.map((r) => r.statusCode).sort();
      expect(statusCodes).toEqual([200, 409]);
      const loser = responses.find((r) => r.statusCode === 409);
      expect(loser?.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'not_inside',
      );

      const dbRow = await database.pool.query<{ currently_inside: string }>(
        `select currently_inside from access_credentials where company_id=$1 and id=$2`,
        [companyId, body.id],
      );
      expect(dbRow.rows[0]?.currently_inside).toBe('false');

      const events = await database.pool.query<{ event_type: string }>(
        `select event_type from access_events where company_id=$1 and credential_id=$2 order by occurred_at asc`,
        [companyId, body.id],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(['entry', 'exit']);
    });
  });
});
