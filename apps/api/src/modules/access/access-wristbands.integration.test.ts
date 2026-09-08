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
 * TASK 14.5 (Wave 3, Phase 3) — NFC wristband lifecycle recovery, real
 * end-to-end coverage. Mirrors `access.integration.test.ts`'s own exact
 * boilerplate (real Fastify app, real Postgres-backed `AccessService`/
 * `AccessRepository`, only the auth LAYER faked) — see that file's own
 * doc comment for the full reasoning. This file only exercises what is
 * genuinely NEW this wave: wristband activation (a `credentialKind=
 * 'wristband'` credential with a caller-supplied UID `code`), block
 * (reuses the existing `void` route/logic verbatim), unblock (the one
 * brand-new `unvoid` transition), lookup-by-code, and the fact that a
 * wristband-kind credential scans exactly like a ticket-kind one — plus
 * cross-tenant isolation and permission enforcement for every new route.
 *
 * Deliberately does NOT test any "extend" action — the legacy's own
 * `extenderPulsera()` was found, on forensic re-read, to be a pure UI
 * placeholder (a `prompt()` + toast that never persists the entered
 * duration anywhere, reading DOM ids — `pul-expira`/`pul-cliente`/
 * `pul-sucursal` — that don't even exist in the legacy's own modal
 * markup). Per this task's own instruction ("if the legacy's extend
 * turns out to be superficial/never-real, do not build it"), no expiry/
 * duration concept was added to the schema and no `extend` endpoint
 * exists — there is nothing real here to test.
 */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://access-wristbands-integration-disabled';
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

async function applyAlways(database: DatabaseClient, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const sql = await readFile(resolve(migrationsPath, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) {
        try {
          await database.pool.query(statement);
        } catch (error) {
          // Idempotent re-apply guard for a fresh test DB shared across
          // integration test files run in the same process — mirrors
          // `access.integration.test.ts`'s own `applyIfMissing` intent but
          // for an ALTER-style migration file (0026) that isn't its own
          // `CREATE TABLE`, so `to_regclass` can't gate it the same way.
          if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error;
        }
      }
  }
}

integration('PostgreSQL NFC wristbands (TASK 14.5, Wave 3, Phase 3)', { concurrent: false }, () => {
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

  async function insertCompletedSale(forCompanyId: string, forBranchId: string, actorId: string): Promise<string> {
    const id = randomUUID();
    await database.pool.query(
      `insert into sales (id,company_id,branch_id,sale_number,status,currency_code,subtotal,discount_total,tax_total,total,paid_total,occurred_at,completed_at,created_by,created_at,updated_at)
       values ($1,$2,$3,$4,'completed','MXN','29.0000','0.0000','0.0000','29.0000','29.0000',now(),now(),$5,now(),now())`,
      [id, forCompanyId, forBranchId, `SALE-${id.replaceAll('-', '')}`, actorId],
    );
    return id;
  }

  function wristbandUid(): string {
    // A fresh, honest, non-tenant-specific fixture UID per test — never a
    // hardcoded literal reused across assertions (would risk a false
    // "duplicate" signal between tests sharing one database).
    return `TEST-UID-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  }

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-access-wristbands-integration',
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
    // 0026 only ADDs a column/constraint to the already-existing
    // `access_credentials` table — `to_regclass`-gating on that table's
    // own presence (like every guard above) would skip it whenever
    // 0025 already ran, so it needs its own idempotent apply.
    await applyAlways(database, ['0026_hesitant_speed.sql']);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Wristband Co','Wristband Co',$2,'active','UTC','MXN','es-MX'),
             ($3,'Other Wristband Co','Other Wristband Co',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `wristband-${companyId}`, otherCompanyId, `wristband-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Wristband Main','WMAIN','active','UTC'),
             ($3,$2,'Wristband Second','WSECOND','active','UTC'),
             ($4,$5,'Wristband Other Co','WOTHER','active','UTC')`,
      [branchId, companyId, otherBranchId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Wristband Cashier','active'),($3,$4,$4,'Wristband Other Co User','active')`,
      [userId, `wristband-${userId}@example.test`, otherCompanyUserId, `wristband-${otherCompanyUserId}@example.test`],
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
  function unvoidCredential(id: string, key: string): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'POST',
      url: `/api/v1/access-credentials/${id}/unvoid`,
      headers: { authorization: 'Bearer x', 'idempotency-key': key },
    });
  }
  function byCode(code: string): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'GET',
      url: `/api/v1/access-credentials/by-code?code=${encodeURIComponent(code)}`,
      headers: { authorization: 'Bearer x' },
    });
  }

  async function activateWristband(
    forBranchId = branchId,
    code = wristbandUid(),
  ): Promise<{ id: string; code: string }> {
    const saleId = await insertCompletedSale(companyId, forBranchId, userId);
    const response = await issue(`wb-activate-${randomUUID()}`, {
      branch_id: forBranchId,
      sale_id: saleId,
      credential_kind: 'wristband',
      code,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { id: string; code: string; credential_kind: string } }>().data;
    expect(body.credential_kind).toBe('wristband');
    return { id: body.id, code: body.code };
  }

  // --- Activate ----------------------------------------------------------

  describe('activate', () => {
    it('activates a real wristband credential with a caller-supplied UID against a real, paid sale', async () => {
      authContext = baseContext(companyId, branchId);
      const code = wristbandUid();
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`wb-activate-basic-${randomUUID()}`, {
        branch_id: branchId,
        sale_id: saleId,
        credential_kind: 'wristband',
        code,
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{
        data: { id: string; code: string; credential_kind: string; sale_id: string; status: string };
      }>().data;
      expect(body.code).toBe(code);
      expect(body.credential_kind).toBe('wristband');
      expect(body.sale_id).toBe(saleId);
      expect(body.status).toBe('issued');

      const dbRow = await database.pool.query<{ code: string; credential_kind: string }>(
        `select code,credential_kind from access_credentials where company_id=$1 and id=$2`,
        [companyId, body.id],
      );
      expect(dbRow.rows[0]).toMatchObject({ code, credential_kind: 'wristband' });
    });

    it('a plain ticket issuance (no credential_kind) still defaults to credential_kind=ticket with a server-generated code', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`wb-ticket-default-${randomUUID()}`, { branch_id: branchId, sale_id: saleId });
      expect(response.statusCode).toBe(201);
      const body = response.json<{ data: { credential_kind: string; code: string } }>().data;
      expect(body.credential_kind).toBe('ticket');
      expect(body.code.startsWith('AC-')).toBe(true);
    });

    it('rejects wristband activation without a code', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`wb-activate-nocode-${randomUUID()}`, {
        branch_id: branchId,
        sale_id: saleId,
        credential_kind: 'wristband',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
    });

    it('rejects a ticket issuance that also supplies a code — tickets are always server-generated', async () => {
      authContext = baseContext(companyId, branchId);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`wb-ticket-with-code-${randomUUID()}`, {
        branch_id: branchId,
        sale_id: saleId,
        code: 'SHOULD-NOT-BE-ALLOWED',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
    });

    it('rejects activating a wristband whose UID is already in use by another credential (honest, never silently retried with a different code)', async () => {
      authContext = baseContext(companyId, branchId);
      const code = wristbandUid();
      await activateWristband(branchId, code);
      const secondSaleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`wb-duplicate-${randomUUID()}`, {
        branch_id: branchId,
        sale_id: secondSaleId,
        credential_kind: 'wristband',
        code,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'code_already_in_use',
      );
    });

    it('rejects wristband activation against a sale that is not completed/paid — reuses the exact same real-sale validation as a ticket', async () => {
      authContext = baseContext(companyId, branchId);
      const id = randomUUID();
      await database.pool.query(
        `insert into sales (id,company_id,branch_id,sale_number,status,currency_code,subtotal,discount_total,tax_total,total,paid_total,occurred_at,created_by,created_at,updated_at)
         values ($1,$2,$3,$4,'pending_payment','MXN','29.0000','0.0000','0.0000','29.0000','0.0000',now(),$5,now(),now())`,
        [id, companyId, branchId, `SALE-${id.replaceAll('-', '')}`, userId],
      );
      const response = await issue(`wb-activate-pending-${randomUUID()}`, {
        branch_id: branchId,
        sale_id: id,
        credential_kind: 'wristband',
        code: wristbandUid(),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('validation_error');
    });

    it('requires access.scan to activate a wristband, exactly like ticket issuance', async () => {
      authContext = baseContext(companyId, branchId, ['access.read']);
      const saleId = await insertCompletedSale(companyId, branchId, userId);
      const response = await issue(`wb-activate-noperm-${randomUUID()}`, {
        branch_id: branchId,
        sale_id: saleId,
        credential_kind: 'wristband',
        code: wristbandUid(),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Scans exactly like a ticket ----------------------------------------

  describe('a wristband scans exactly like a ticket', () => {
    it('a valid entry then exit scan on a wristband flips currently_inside and records real entry/exit events', async () => {
      authContext = baseContext(companyId, branchId);
      const { code } = await activateWristband();
      const entry = await scan({ branch_id: branchId, code });
      expect(entry.statusCode).toBe(200);
      expect(entry.json<{ data: { event: { event_type: string } } }>().data.event.event_type).toBe('entry');

      const exit = await scan({ branch_id: branchId, code });
      expect(exit.statusCode).toBe(200);
      expect(exit.json<{ data: { event: { event_type: string } } }>().data.event.event_type).toBe('exit');

      const events = await database.pool.query<{ event_type: string }>(
        `select event_type from access_events where company_id=$1 and credential_id=(select id from access_credentials where company_id=$1 and code=$2) order by occurred_at asc`,
        [companyId, code],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(['entry', 'exit']);
    });

    it('single-use by default: a second entry after a completed exit is reentry_not_allowed, same as a ticket', async () => {
      authContext = baseContext(companyId, branchId);
      const { code } = await activateWristband();
      await scan({ branch_id: branchId, code });
      await scan({ branch_id: branchId, code });
      const third = await scan({ branch_id: branchId, code });
      expect(third.statusCode).toBe(409);
      expect(third.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'reentry_not_allowed',
      );
    });

    it('a blocked (voided) wristband is rejected on scan with credential_void, same as a voided ticket', async () => {
      authContext = baseContext(companyId, branchId);
      const { id, code } = await activateWristband();
      const blocked = await voidCredential(id, `wb-block-scan-${randomUUID()}`);
      expect(blocked.statusCode).toBe(200);
      const response = await scan({ branch_id: branchId, code });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'credential_void',
      );
    });
  });

  // --- Block (reuses void) -------------------------------------------------

  describe('block (reuses the existing void action verbatim)', () => {
    it('blocks an issued, not-currently-inside wristband', async () => {
      authContext = baseContext(companyId, branchId);
      const { id } = await activateWristband();
      const response = await voidCredential(id, `wb-block-ok-${randomUUID()}`);
      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: { status: string } }>().data.status).toBe('void');
      const dbRow = await database.pool.query<{ status: string }>(
        `select status from access_credentials where company_id=$1 and id=$2`,
        [companyId, id],
      );
      expect(dbRow.rows[0]?.status).toBe('void');
    });

    it('rejects blocking a currently-inside wristband, asking for a real exit first — same real policy as a ticket', async () => {
      authContext = baseContext(companyId, branchId);
      const { id, code } = await activateWristband();
      await scan({ branch_id: branchId, code });
      const response = await voidCredential(id, `wb-block-inside-${randomUUID()}`);
      expect(response.statusCode).toBe(409);
      expect(
        response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason,
      ).toBe('credential_currently_inside');
    });

    it('requires access.manage to block a wristband (access.scan alone is not enough)', async () => {
      authContext = baseContext(companyId, branchId);
      const { id } = await activateWristband();
      authContext = baseContext(companyId, branchId, ['access.scan']);
      const response = await voidCredential(id, `wb-block-noperm-${randomUUID()}`);
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Unblock (the one genuinely new transition) ---------------------------

  describe('unblock (the one genuinely new lifecycle transition this wave adds)', () => {
    it('reactivates a blocked wristband back to issued, clearing voided_at/voided_by for real', async () => {
      authContext = baseContext(companyId, branchId);
      const { id, code } = await activateWristband();
      const blocked = await voidCredential(id, `wb-unblock-setup-${randomUUID()}`);
      expect(blocked.statusCode).toBe(200);

      const response = await unvoidCredential(id, `wb-unblock-ok-${randomUUID()}`);
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { status: string; voided_at: string | null; voided_by: string | null } }>().data;
      expect(body.status).toBe('issued');
      expect(body.voided_at).toBeNull();
      expect(body.voided_by).toBeNull();

      const dbRow = await database.pool.query<{ status: string; voided_at: string | null; voided_by: string | null }>(
        `select status,voided_at,voided_by from access_credentials where company_id=$1 and id=$2`,
        [companyId, id],
      );
      expect(dbRow.rows[0]).toMatchObject({ status: 'issued', voided_at: null, voided_by: null });

      // Real proof it works again — an unblocked wristband can scan in.
      const entry = await scan({ branch_id: branchId, code });
      expect(entry.statusCode).toBe(200);
      expect(entry.json<{ data: { event: { event_type: string } } }>().data.event.event_type).toBe('entry');
    });

    it('rejects unblocking a wristband that is not currently blocked/voided (credential_not_void)', async () => {
      authContext = baseContext(companyId, branchId);
      const { id } = await activateWristband();
      const response = await unvoidCredential(id, `wb-unblock-notvoid-${randomUUID()}`);
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string; details?: { reason: string } } }>().error.details?.reason).toBe(
        'credential_not_void',
      );
    });

    it('requires access.manage to unblock (access.scan alone is not enough)', async () => {
      authContext = baseContext(companyId, branchId);
      const { id } = await activateWristband();
      await voidCredential(id, `wb-unblock-noperm-setup-${randomUUID()}`);
      authContext = baseContext(companyId, branchId, ['access.scan']);
      const response = await unvoidCredential(id, `wb-unblock-noperm-${randomUUID()}`);
      expect(response.statusCode).toBe(403);
    });

    it('the exact same Idempotency-Key retried twice unblocks exactly once', async () => {
      authContext = baseContext(companyId, branchId);
      const { id } = await activateWristband();
      await voidCredential(id, `wb-unblock-idem-setup-${randomUUID()}`);
      const key = `wb-unblock-idem-${randomUUID()}`;
      const first = await unvoidCredential(id, key);
      const second = await unvoidCredential(id, key);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.headers['idempotency-replayed']).toBe('true');
    });
  });

  // --- Lookup by code / history ---------------------------------------------

  describe('lookup by code and history', () => {
    it('finds a wristband by its own UID and reports its current status', async () => {
      authContext = baseContext(companyId, branchId);
      const { id, code } = await activateWristband();
      const response = await byCode(code);
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { id: string; code: string; credential_kind: string; status: string } }>().data;
      expect(body.id).toBe(id);
      expect(body.code).toBe(code);
      expect(body.credential_kind).toBe('wristband');
      expect(body.status).toBe('issued');
    });

    it('an unknown code is honestly resource_not_found (never a fabricated match)', async () => {
      authContext = baseContext(companyId, branchId);
      const response = await byCode(`UNKNOWN-${randomUUID()}`);
      expect(response.statusCode).toBe(404);
    });

    it('a wristband from another company is completely invisible to this lookup (resource_not_found, never cross-tenant)', async () => {
      const otherSaleId = await insertCompletedSale(otherCompanyId, otherCompanyBranchId, otherCompanyUserId);
      authContext = baseContext(otherCompanyId, otherCompanyBranchId);
      const code = wristbandUid();
      const issued = await issue(`wb-otherco-${randomUUID()}`, {
        branch_id: otherCompanyBranchId,
        sale_id: otherSaleId,
        credential_kind: 'wristband',
        code,
      });
      expect(issued.statusCode).toBe(201);

      authContext = baseContext(companyId, branchId);
      const response = await byCode(code);
      expect(response.statusCode).toBe(404);
    });

    it('requires access.read to look up a wristband by code', async () => {
      authContext = baseContext(companyId, branchId);
      const { code } = await activateWristband();
      authContext = baseContext(companyId, branchId, ['access.scan']);
      const response = await byCode(code);
      expect(response.statusCode).toBe(403);
    });

    it('the event history for one wristband (via ?credential_id=) shows exactly its own entry/exit trail, never another credential\'s', async () => {
      authContext = baseContext(companyId, branchId);
      const first = await activateWristband();
      const second = await activateWristband();
      await scan({ branch_id: branchId, code: first.code }); // entry on first only.

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/access-events?credential_id=${first.id}`,
        headers: { authorization: 'Bearer x' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ data: { credential_id: string; event_type: string }[] }>().data;
      expect(body.length).toBeGreaterThan(0);
      for (const event of body) expect(event.credential_id).toBe(first.id);
      expect(body.some((event) => event.credential_id === second.id)).toBe(false);
    });
  });
});
