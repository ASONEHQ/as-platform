import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { hashPassword } from './auth.passwords.js';
import { PostgresAuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthTokens } from './auth.tokens.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://browser-auth-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL browser authentication and context engine', () => {
  let database: DatabaseClient;
  let service: AuthService;
  const userId = randomUUID();
  const companyId = randomUUID();
  const secondCompanyId = randomUUID();
  const membershipId = randomUUID();
  const secondMembershipId = randomUUID();
  const branchId = randomUUID();
  const secondBranchId = randomUUID();

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-browser-auth-test',
    });
    await ensureMigrations(database);
    const passwordHash = await hashPassword('Correct-password-1!');
    await database.pool.query(
      `insert into companies (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values ($1,'Auth One','Auth One',$2,'active','UTC','MXN','es-MX'),
              ($3,'Auth Two','Auth Two',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `auth-${companyId}`, secondCompanyId, `auth-${secondCompanyId}`],
    );
    await database.pool.query(
      `insert into users (id,email,normalized_email,display_name,password_hash,status)
       values ($1,$2,$2,'Auth User',$3,'active')`,
      [userId, `auth-${userId}@example.test`, passwordHash],
    );
    await database.pool.query(
      `insert into company_memberships (id,company_id,user_id,status)
       values ($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [membershipId, companyId, userId, secondMembershipId, secondCompanyId],
    );
    await database.pool.query(
      `insert into branches (id,company_id,code,name,status,timezone)
       values ($1,$2,'MAIN','Main','active','UTC'),($3,$4,'SECOND','Second','active','UTC')`,
      [branchId, companyId, secondBranchId, secondCompanyId],
    );
    await database.pool.query(
      `insert into user_branch_access (id,company_id,membership_id,user_id,branch_id,status,is_default)
       values ($1,$2,$3,$4,$5,'active',true),($6,$7,$8,$4,$9,'active',true)`,
      [
        randomUUID(),
        companyId,
        membershipId,
        userId,
        branchId,
        randomUUID(),
        secondCompanyId,
        secondMembershipId,
        secondBranchId,
      ],
    );
    const tokens = new AuthTokens({
      audience: 'asone-browser-auth-test',
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
  });

  afterAll(async () => {
    await database.pool.query('delete from audit_log where actor_id=$1', [userId]);
    await database.pool.query(
      'delete from session_refresh_tokens where session_id in (select id from sessions where user_id=$1)',
      [userId],
    );
    await database.pool.query('delete from sessions where user_id=$1', [userId]);
    await database.pool.query('delete from auth_login_challenges where user_id=$1', [userId]);
    await database.pool.query('delete from user_branch_access where user_id=$1', [userId]);
    await database.pool.query('delete from company_memberships where user_id=$1', [userId]);
    await database.pool.query('delete from branches where company_id in ($1,$2)', [
      companyId,
      secondCompanyId,
    ]);
    await database.pool.query('delete from companies where id in ($1,$2)', [
      companyId,
      secondCompanyId,
    ]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  it('persists explicit browser and bearer transport modes without plaintext challenge tokens', async () => {
    const browser = await service.beginLogin({
      identifier: `auth-${userId}@example.test`,
      password: 'Correct-password-1!',
      companyId,
      branchId,
      clientType: 'browser',
      transportMode: 'browser',
    });
    const bearer = await service.beginLogin({
      identifier: `auth-${userId}@example.test`,
      password: 'Correct-password-1!',
      companyId,
      branchId,
      clientType: 'mobile',
      transportMode: 'bearer',
    });
    if ('outcome' in browser || 'outcome' in bearer) throw new Error('unexpected challenge');
    const rows = await database.pool.query<{ transport_mode: string }>(
      'select transport_mode from sessions where id=any($1::uuid[]) order by transport_mode',
      [[browser.context.sessionId, bearer.context.sessionId]],
    );
    expect(rows.rows.map((row) => row.transport_mode)).toEqual(['bearer', 'browser']);
  });

  it('creates a hashed multi-company challenge and permits exactly one concurrent consumer', async () => {
    const pending = await service.beginLogin({
      identifier: `auth-${userId}@example.test`,
      password: 'Correct-password-1!',
      clientType: 'browser',
      transportMode: 'browser',
    });
    if (!('outcome' in pending)) throw new Error('expected company selection');
    const stored = await database.pool.query<{ token_hash: string; status: string }>(
      'select token_hash,status from auth_login_challenges where user_id=$1 order by created_at desc limit 1',
      [userId],
    );
    expect(stored.rows[0]).toMatchObject({ status: 'pending' });
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored.rows[0]?.token_hash).not.toBe(pending.challengeToken);
    const results = await Promise.allSettled([
      service.completeCompanySelection({
        challengeToken: pending.challengeToken,
        companyId,
        branchId,
        browserOriginApproved: true,
      }),
      service.completeCompanySelection({
        challengeToken: pending.challengeToken,
        companyId,
        branchId,
        browserOriginApproved: true,
      }),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const sessions = await database.pool.query<{ count: string }>(
      `select count(*)::text count from sessions s
       join auth_login_challenges ch on ch.selected_company_id=s.company_id
       where ch.token_hash=$1 and s.user_id=$2 and s.created_at>=ch.created_at`,
      [stored.rows[0]?.token_hash, userId],
    );
    expect(sessions.rows[0]?.count).toBe('1');
  });

  it('preserves browser transport while replacing company sessions atomically', async () => {
    const login = await service.login({
      identifier: `auth-${userId}@example.test`,
      password: 'Correct-password-1!',
      companyId,
      branchId,
      clientType: 'browser',
      transportMode: 'browser',
    });
    const switched = await service.switchCompany(login.context, secondCompanyId, secondBranchId);
    expect(switched.context).toMatchObject({
      companyId: secondCompanyId,
      transportMode: 'browser',
    });
    const rows = await database.pool.query<{ id: string; status: string; transport_mode: string }>(
      'select id,status,transport_mode from sessions where id=any($1::uuid[]) order by id',
      [[login.context.sessionId, switched.context.sessionId]],
    );
    expect(rows.rows.find((row) => row.id === login.context.sessionId)).toMatchObject({
      status: 'revoked',
      transport_mode: 'browser',
    });
    expect(rows.rows.find((row) => row.id === switched.context.sessionId)).toMatchObject({
      status: 'active',
      transport_mode: 'browser',
    });
  });

  it('rotates branch generation once and rejects the previous refresh generation', async () => {
    const login = await service.login({
      identifier: `auth-${userId}@example.test`,
      password: 'Correct-password-1!',
      companyId,
      branchId,
      clientType: 'mobile',
      transportMode: 'bearer',
    });
    const switched = await service.switchBranch(login.context, branchId);
    expect(switched.context).toMatchObject({ transportMode: 'bearer', tokenGeneration: 1 });
    await expect(service.refresh(login.refreshToken, 'bearer')).rejects.toMatchObject({
      code: 'refresh_token_reused',
    });
    const session = await database.pool.query<{ status: string; token_generation: number }>(
      'select status,token_generation from sessions where id=$1',
      [login.context.sessionId],
    );
    expect(session.rows[0]).toMatchObject({ status: 'revoked', token_generation: 1 });
  });
});

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const existing = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.auth_login_challenges')::text present`,
  );
  if (existing.rows[0]?.present !== null) return;
  const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');
  for (const entry of [
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
  ]) {
    const sql = await readFile(resolve(migrationsPath, entry), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
}
