// TASK 14.5 (Wave 3, Phase 4b/7 Item 8): real integration coverage for the
// quick-switch PIN/QR login mechanisms — mirrors
// `auth.browser.integration.test.ts`'s own boilerplate (env-gated,
// dedicated test database, real Postgres, real argon2id hashing) rather
// than mocking the repository, since the whole point of this suite is to
// prove the security properties (hashing, cross-tenant isolation, honest
// failure) hold against the real schema/constraints, not just against a
// hand-rolled in-memory double.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { hashPassword } from './auth.passwords.js';
import { PostgresAuthRepository } from './auth.repository.js';
import { AuthService, type TokenResult } from './auth.service.js';
import { AuthTokens } from './auth.tokens.js';
import type { AuthContext } from './auth.types.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://pin-qr-auth-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PIN/QR quick-switch login (real Postgres, real argon2id hashing)', () => {
  let database: DatabaseClient;
  let service: AuthService;

  // Company A: the "home" company for every scenario below.
  const companyAId = randomUUID();
  const cashierUserId = randomUUID();
  const cashierMembershipId = randomUUID();
  const managerUserId = randomUUID();
  const managerMembershipId = randomUUID();
  const branchAId = randomUUID();
  const deviceAId = randomUUID();

  // Company B: exists ONLY to prove cross-tenant isolation — a PIN/QR
  // enrolled for a Company A staff member must never authenticate a
  // Company B session, even when the code/digits happen to collide.
  const companyBId = randomUUID();
  const otherCompanyUserId = randomUUID();
  const otherCompanyMembershipId = randomUUID();
  const branchBId = randomUUID();

  let managerContext: AuthContext;
  let companyBContext: AuthContext;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-pin-qr-auth-test',
    });
    await ensureMigrations(database);

    const passwordHash = await hashPassword('Correct-password-1!');
    await database.pool.query(
      `insert into companies (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values ($1,'Pin Qr Co A','Pin Qr Co A',$2,'active','UTC','MXN','es-MX'),
              ($3,'Pin Qr Co B','Pin Qr Co B',$4,'active','UTC','MXN','es-MX')`,
      [companyAId, `pinqr-a-${companyAId}`, companyBId, `pinqr-b-${companyBId}`],
    );
    await database.pool.query(
      `insert into users (id,email,normalized_email,display_name,password_hash,status)
       values ($1,$2,$2,'Cashier',$5,'active'),
              ($3,$4,$4,'Manager',$5,'active'),
              ($6,$7,$7,'Other Company User',$5,'active')`,
      [
        cashierUserId,
        `pinqr-cashier-${cashierUserId}@example.test`,
        managerUserId,
        `pinqr-manager-${managerUserId}@example.test`,
        passwordHash,
        otherCompanyUserId,
        `pinqr-other-${otherCompanyUserId}@example.test`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships (id,company_id,user_id,status)
       values ($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$7,$8,'active')`,
      [
        cashierMembershipId,
        companyAId,
        cashierUserId,
        managerMembershipId,
        managerUserId,
        otherCompanyMembershipId,
        companyBId,
        otherCompanyUserId,
      ],
    );
    await database.pool.query(
      `insert into branches (id,company_id,code,name,status,timezone)
       values ($1,$2,'MAIN','Main','active','UTC'),($3,$4,'MAIN','Main','active','UTC')`,
      [branchAId, companyAId, branchBId, companyBId],
    );
    await database.pool.query(
      `insert into user_branch_access (id,company_id,membership_id,user_id,branch_id,status,is_default)
       values ($1,$2,$3,$4,$5,'active',true),
              ($6,$2,$7,$8,$5,'active',true),
              ($9,$10,$11,$12,$13,'active',true)`,
      [
        randomUUID(),
        companyAId,
        cashierMembershipId,
        cashierUserId,
        branchAId,
        randomUUID(),
        managerMembershipId,
        managerUserId,
        randomUUID(),
        companyBId,
        otherCompanyMembershipId,
        otherCompanyUserId,
        branchBId,
      ],
    );
    await database.pool.query(
      `insert into devices (id,company_id,branch_id,device_code,name,device_type,status)
       values ($1,$2,$3,'POS-A1','Register A1','pos','active')`,
      [deviceAId, companyAId, branchAId],
    );

    const tokens = new AuthTokens({
      audience: 'asone-pin-qr-auth-test',
      issuer: 'https://api.test.asone.mx',
      secret: 'test-secret-that-is-at-least-32-characters',
      ttlSeconds: 300,
    });
    service = new AuthService({
      repository: new PostgresAuthRepository(database),
      tokens,
      dummyPasswordHash: await hashPassword('constant-time-dummy-password'),
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3_600,
    });

    // The "already-authenticated device" the quick-switch endpoints
    // require: a real manager session on Company A's register, and a
    // real session on Company B, used to prove isolation.
    const managerLogin = await service.beginLogin({
      identifier: `pinqr-manager-${managerUserId}@example.test`,
      password: 'Correct-password-1!',
      companyId: companyAId,
      branchId: branchAId,
      deviceId: deviceAId,
      clientType: 'pos',
    });
    if ('outcome' in managerLogin) throw new Error('unexpected challenge');
    managerContext = managerLogin.context;

    const otherLogin = await service.beginLogin({
      identifier: `pinqr-other-${otherCompanyUserId}@example.test`,
      password: 'Correct-password-1!',
      companyId: companyBId,
      branchId: branchBId,
      clientType: 'pos',
    });
    if ('outcome' in otherLogin) throw new Error('unexpected challenge');
    companyBContext = otherLogin.context;
  });

  afterAll(async () => {
    await database.pool.query('delete from audit_log where company_id in ($1,$2)', [
      companyAId,
      companyBId,
    ]);
    await database.pool.query(
      `delete from session_refresh_tokens where session_id in (
         select id from sessions where company_id in ($1,$2))`,
      [companyAId, companyBId],
    );
    await database.pool.query('delete from sessions where company_id in ($1,$2)', [
      companyAId,
      companyBId,
    ]);
    await database.pool.query('delete from user_branch_access where company_id in ($1,$2)', [
      companyAId,
      companyBId,
    ]);
    await database.pool.query('delete from devices where company_id=$1', [companyAId]);
    await database.pool.query('delete from company_memberships where company_id in ($1,$2)', [
      companyAId,
      companyBId,
    ]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [
      companyAId,
      companyBId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyAId,
      companyBId,
    ]);
    await database.pool.query('delete from users where id in ($1,$2,$3)', [
      cashierUserId,
      managerUserId,
      otherCompanyUserId,
    ]);
    await database.close();
  });

  describe('PIN', () => {
    it('never stores the PIN in plaintext — the stored hash differs from the digits and looks like a real argon2id hash', async () => {
      await service.setStaffPin(managerContext, cashierMembershipId, '4471');
      const row = await database.pool.query<{ pin_hash: string }>(
        'select pin_hash from company_memberships where id=$1',
        [cashierMembershipId],
      );
      const hash = row.rows[0]?.pin_hash;
      expect(hash).toBeDefined();
      expect(hash).not.toBe('4471');
      expect(hash).toMatch(/^\$argon2id\$/u);
    });

    it('a correct PIN issues a REAL session for the resolved staff member via the same session path as password login', async () => {
      await service.setStaffPin(managerContext, cashierMembershipId, '1234');
      const result: TokenResult = await service.pinLogin(managerContext, '1234');
      expect(result.context.userId).toBe(cashierUserId);
      expect(result.context.membershipId).toBe(cashierMembershipId);
      expect(result.context.companyId).toBe(companyAId);
      // Real, persisted, queryable session row — not a client-only token.
      const row = await database.pool.query<{ user_id: string; status: string }>(
        'select user_id,status from sessions where id=$1',
        [result.context.sessionId],
      );
      expect(row.rows[0]).toMatchObject({ user_id: cashierUserId, status: 'active' });
    });

    it('an unknown/wrong PIN is rejected honestly, with no hint about which part was wrong', async () => {
      await service.setStaffPin(managerContext, cashierMembershipId, '5566');
      await expect(service.pinLogin(managerContext, '0000')).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    });

    it('cross-tenant isolation: a PIN enrolled for Company A never authenticates a Company B session', async () => {
      await service.setStaffPin(managerContext, cashierMembershipId, '9911');
      // The exact same digits, submitted against a real session already
      // scoped to Company B, must fail — company scope is taken only
      // from the caller's own session, never guessable/overridable.
      await expect(service.pinLogin(companyBContext, '9911')).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    });

    it('rejects assigning a PIN that is already in use by another staff member in the same company', async () => {
      await service.setStaffPin(managerContext, cashierMembershipId, '2468');
      await expect(
        service.setStaffPin(managerContext, managerMembershipId, '2468'),
      ).rejects.toMatchObject({ code: 'validation_error' });
    });

    it('clearing a PIN (pin=null) revokes it — it can no longer log in', async () => {
      await service.setStaffPin(managerContext, cashierMembershipId, '7777');
      await service.setStaffPin(managerContext, cashierMembershipId, null);
      const row = await database.pool.query<{ pin_hash: string | null }>(
        'select pin_hash from company_memberships where id=$1',
        [cashierMembershipId],
      );
      expect(row.rows[0]?.pin_hash).toBeNull();
      await expect(service.pinLogin(managerContext, '7777')).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    });
  });

  describe('QR', () => {
    it('never stores the QR secret in plaintext — the stored hash differs from the issued code and looks like a real argon2id hash', async () => {
      const issued = await service.issueStaffQrCredential(managerContext, cashierMembershipId);
      expect(issued.code).toMatch(/^POS-QR-/u);
      const row = await database.pool.query<{ qr_secret_hash: string }>(
        'select qr_secret_hash from company_memberships where id=$1',
        [cashierMembershipId],
      );
      const hash = row.rows[0]?.qr_secret_hash;
      expect(hash).toBeDefined();
      expect(hash).not.toBe(issued.code);
      expect(hash).toMatch(/^\$argon2id\$/u);
    });

    it('a correct QR code issues a REAL session for the resolved staff member via the same session path as password login', async () => {
      const issued = await service.issueStaffQrCredential(managerContext, cashierMembershipId);
      const result = await service.qrLogin(managerContext, issued.code);
      expect(result.context.userId).toBe(cashierUserId);
      expect(result.context.membershipId).toBe(cashierMembershipId);
      const row = await database.pool.query<{ user_id: string; status: string }>(
        'select user_id,status from sessions where id=$1',
        [result.context.sessionId],
      );
      expect(row.rows[0]).toMatchObject({ user_id: cashierUserId, status: 'active' });
    });

    it('an unknown/wrong QR code is rejected honestly', async () => {
      await service.issueStaffQrCredential(managerContext, cashierMembershipId);
      await expect(
        service.qrLogin(managerContext, 'POS-QR-not-a-real-issued-code'),
      ).rejects.toMatchObject({ code: 'invalid_credentials' });
    });

    it('cross-tenant isolation: a QR code issued for Company A never authenticates a Company B session', async () => {
      const issued = await service.issueStaffQrCredential(managerContext, cashierMembershipId);
      await expect(service.qrLogin(companyBContext, issued.code)).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    });

    it('an expired QR credential never matches, even though its hash is still stored', async () => {
      const issued = await service.issueStaffQrCredential(managerContext, cashierMembershipId);
      // Force the stored expiry into the past directly, exactly like an
      // integration test would simulate any other time-based expiry.
      await database.pool.query(
        `update company_memberships set qr_expires_at = now() - interval '1 day' where id=$1`,
        [cashierMembershipId],
      );
      await expect(service.qrLogin(managerContext, issued.code)).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    });

    it('revoking a QR credential clears both columns together and it can no longer log in', async () => {
      const issued = await service.issueStaffQrCredential(managerContext, cashierMembershipId);
      await service.revokeStaffQrCredential(managerContext, cashierMembershipId);
      const row = await database.pool.query<{
        qr_secret_hash: string | null;
        qr_expires_at: Date | null;
      }>('select qr_secret_hash,qr_expires_at from company_memberships where id=$1', [
        cashierMembershipId,
      ]);
      expect(row.rows[0]?.qr_secret_hash).toBeNull();
      expect(row.rows[0]?.qr_expires_at).toBeNull();
      await expect(service.qrLogin(managerContext, issued.code)).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    });
  });

  it('setStaffPin/issueStaffQrCredential on a membership outside the actor company is an honest 404, never a cross-tenant write', async () => {
    await expect(
      service.setStaffPin(managerContext, otherCompanyMembershipId, '1111'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      service.issueStaffQrCredential(managerContext, otherCompanyMembershipId),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const existing = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.company_memberships')::text present`,
  );
  const hasPinColumn = await database.pool.query<{ present: string | null }>(
    `select column_name from information_schema.columns
     where table_name='company_memberships' and column_name='pin_hash'`,
  );
  if (existing.rows[0]?.present !== null && hasPinColumn.rows.length > 0) return;
  const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');
  const journal = JSON.parse(
    await readFile(resolve(migrationsPath, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sql = await readFile(resolve(migrationsPath, `${entry.tag}.sql`), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) {
        try {
          await database.pool.query(statement);
        } catch (error) {
          // Tolerate re-applying a statement whose object already exists
          // (this suite may run after `auth.browser.integration.test.ts`'s
          // own partial `ensureMigrations` already created earlier tables).
          if (!(error instanceof Error) || !error.message.includes('already exists')) throw error;
        }
      }
  }
}
