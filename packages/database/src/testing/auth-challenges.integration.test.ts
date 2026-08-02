import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://integration-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL auth login challenge foundation', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-auth-challenge-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => client.close());

  it('applies 0000-0010 and retains the login challenge table', async () => {
    const table = await client.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'auth_login_challenges'`,
    );
    expect(table.rows).toEqual([{ table_name: 'auth_login_challenges' }]);
    const migrations = await client.pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(migrations.rows[0]?.count).toBe('11');
  });

  it('persists a valid pending challenge without plaintext token or floating columns', async () => {
    await withFixture(client, async (connection, fixture) => {
      const id = await insertPending(connection, fixture);
      const row = await connection.query<{
        status: string;
        attempt_count: number;
        max_attempts: number;
        version: number;
      }>(
        'select status,attempt_count,max_attempts,version from auth_login_challenges where id=$1',
        [id],
      );
      expect(row.rows[0]).toEqual({
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        version: 1,
      });
      const columns = await connection.query<{ column_name: string; data_type: string }>(
        `select column_name,data_type from information_schema.columns
         where table_schema='public' and table_name='auth_login_challenges'`,
      );
      expect(columns.rows.map((item) => item.column_name)).not.toContain('token');
      expect(columns.rows.map((item) => item.data_type)).not.toContain('real');
      expect(columns.rows.map((item) => item.data_type)).not.toContain('double precision');
    });
  });

  it('enforces token hash uniqueness, lowercase format, and exact length', async () => {
    await withFixture(client, async (connection, fixture) => {
      await insertPending(connection, fixture, { tokenHash: 'a'.repeat(64) });
      await rejectInsert(
        connection,
        fixture,
        'duplicate_hash',
        { tokenHash: 'a'.repeat(64) },
        '23505',
      );
      await rejectInsert(
        connection,
        fixture,
        'uppercase_hash',
        { tokenHash: 'A'.repeat(64) },
        '23514',
      );
      await rejectInsert(connection, fixture, 'short_hash', { tokenHash: 'a'.repeat(63) }, '23514');
    });
  });

  it('enforces status and lifecycle evidence', async () => {
    await withFixture(client, async (connection, fixture) => {
      await rejectInsert(connection, fixture, 'bad_status', { status: 'used' }, '23514');
      await rejectInsert(connection, fixture, 'consumed_missing', { status: 'consumed' }, '23514');
      await insertPending(connection, fixture, {
        status: 'consumed',
        selectedCompanyId: fixture.firstCompanyId,
        consumedAt: new Date(Date.now() + 1000),
      });
      await rejectInsert(
        connection,
        fixture,
        'invalidated_missing',
        { status: 'invalidated' },
        '23514',
      );
      await insertPending(connection, fixture, {
        status: 'invalidated',
        invalidatedAt: new Date(Date.now() + 1000),
      });
    });
  });

  it('enforces attempts, version, and expiration', async () => {
    await withFixture(client, async (connection, fixture) => {
      await rejectInsert(connection, fixture, 'negative_attempt', { attemptCount: -1 }, '23514');
      await rejectInsert(connection, fixture, 'too_many_attempts', { attemptCount: 6 }, '23514');
      await rejectInsert(connection, fixture, 'zero_max', { maxAttempts: 0 }, '23514');
      await rejectInsert(connection, fixture, 'zero_version', { version: 0 }, '23514');
      await rejectInsert(connection, fixture, 'bad_expiry', { expiresAt: new Date(0) }, '23514');
    });
  });

  it('accepts bounded JSON objects and rejects arrays', async () => {
    await withFixture(client, async (connection, fixture) => {
      await insertPending(connection, fixture, { metadata: { user_agent_family: 'test' } });
      await rejectInsert(connection, fixture, 'array_metadata', { metadata: [] }, '23514');
      await rejectInsert(
        connection,
        fixture,
        'large_metadata',
        { metadata: { value: 'x'.repeat(5000) } },
        '23514',
      );
    });
  });

  it('enforces user, selected company, device, and eligible-company references', async () => {
    await withFixture(client, async (connection, fixture) => {
      await rejectInsert(connection, { ...fixture, userId: randomUUID() }, 'bad_user', {}, '23503');
      const absentCompanyId = randomUUID();
      await rejectInsert(
        connection,
        fixture,
        'bad_company_fk',
        {
          status: 'consumed',
          selectedCompanyId: absentCompanyId,
          consumedAt: new Date(Date.now() + 1000),
          eligibleCompanyIds: [absentCompanyId],
        },
        '23503',
      );
      await rejectInsert(
        connection,
        fixture,
        'company_not_eligible',
        {
          status: 'consumed',
          selectedCompanyId: fixture.secondCompanyId,
          consumedAt: new Date(Date.now() + 1000),
          eligibleCompanyIds: [fixture.firstCompanyId],
        },
        '23514',
      );
      await rejectInsert(connection, fixture, 'bad_device', { deviceId: randomUUID() }, '23503');
    });
  });

  it('represents multiple eligible companies without creating a session', async () => {
    await withFixture(client, async (connection, fixture) => {
      const id = await insertPending(connection, fixture);
      const result = await connection.query<{ eligible_company_ids: string[] }>(
        'select eligible_company_ids from auth_login_challenges where id=$1',
        [id],
      );
      expect(result.rows[0]?.eligible_company_ids).toEqual([
        fixture.firstCompanyId,
        fixture.secondCompanyId,
      ]);
      const sessions = await connection.query<{ count: string }>(
        'select count(*)::text as count from sessions',
      );
      expect(sessions.rows[0]?.count).toBe('0');
    });
  });

  it('allows only one concurrent winner for a duplicate token hash', async () => {
    const first = await client.pool.connect();
    const second = await client.pool.connect();
    const fixture = await seedCommittedFixture(client);
    const tokenHash = 'f'.repeat(64);
    try {
      await first.query('begin');
      await second.query('begin');
      await insertPending(first, fixture, { tokenHash });
      const contender = insertPending(second, fixture, { tokenHash });
      await first.query('commit');
      await expect(contender).rejects.toMatchObject({ code: '23505' });
      await second.query('rollback');
    } finally {
      first.release();
      second.release();
      await cleanupFixture(client, fixture);
    }
  });

  it('uses the token lookup index and exposes cleanup indexes', async () => {
    await withFixture(client, async (connection, fixture) => {
      await insertPending(connection, fixture, { tokenHash: 'e'.repeat(64) });
      await connection.query('set local enable_seqscan = off');
      const plan = await connection.query<{ 'QUERY PLAN': string }>(
        `explain (format text) select id from auth_login_challenges where token_hash=$1`,
        ['e'.repeat(64)],
      );
      expect(plan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'auth_login_challenges_token_hash_uq',
      );
      const indexes = await connection.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname='public' and tablename='auth_login_challenges'`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          'auth_login_challenges_pending_expiry_idx',
          'auth_login_challenges_status_updated_idx',
          'auth_login_challenges_created_at_idx',
        ]),
      );
    });
  });

  it.each([
    [
      'has no plaintext token column',
      "select count(*)::text from information_schema.columns where table_name='auth_login_challenges' and column_name in ('token','refresh_token','access_token')",
      '0',
    ],
    [
      'stores the hash as required text',
      "select count(*)::text from information_schema.columns where table_name='auth_login_challenges' and column_name='token_hash' and data_type='text' and is_nullable='NO'",
      '1',
    ],
    [
      'stores eligible companies as uuid array',
      "select count(*)::text from information_schema.columns where table_name='auth_login_challenges' and column_name='eligible_company_ids' and data_type='ARRAY' and udt_name='_uuid'",
      '1',
    ],
    [
      'stores expiration as timestamptz',
      "select count(*)::text from information_schema.columns where table_name='auth_login_challenges' and column_name='expires_at' and data_type='timestamp with time zone'",
      '1',
    ],
    [
      'stores consumed evidence as timestamptz',
      "select count(*)::text from information_schema.columns where table_name='auth_login_challenges' and column_name='consumed_at' and data_type='timestamp with time zone'",
      '1',
    ],
    [
      'stores invalidation evidence as timestamptz',
      "select count(*)::text from information_schema.columns where table_name='auth_login_challenges' and column_name='invalidated_at' and data_type='timestamp with time zone'",
      '1',
    ],
    [
      'stores metadata as jsonb',
      "select count(*)::text from information_schema.columns where table_name='auth_login_challenges' and column_name='metadata' and data_type='jsonb'",
      '1',
    ],
    [
      'defines the user foreign key',
      "select count(*)::text from pg_constraint where conname='auth_login_challenges_user_id_users_id_fk' and contype='f'",
      '1',
    ],
    [
      'defines the selected-company foreign key',
      "select count(*)::text from pg_constraint where conname='auth_login_challenges_selected_company_id_companies_id_fk' and contype='f'",
      '1',
    ],
    [
      'defines the optional-device foreign key',
      "select count(*)::text from pg_constraint where conname='auth_login_challenges_device_id_devices_id_fk' and contype='f'",
      '1',
    ],
    [
      'defines the hash format check',
      "select count(*)::text from pg_constraint where conname='auth_login_challenges_token_hash_ck' and contype='c'",
      '1',
    ],
    [
      'defines the lifecycle check',
      "select count(*)::text from pg_constraint where conname='auth_login_challenges_lifecycle_ck' and contype='c'",
      '1',
    ],
    [
      'defines the attempts check',
      "select count(*)::text from pg_constraint where conname='auth_login_challenges_attempts_ck' and contype='c'",
      '1',
    ],
    [
      'defines the metadata check',
      "select count(*)::text from pg_constraint where conname='auth_login_challenges_metadata_ck' and contype='c'",
      '1',
    ],
    [
      'defines the pending-expiry partial index',
      "select count(*)::text from pg_indexes where tablename='auth_login_challenges' and indexname='auth_login_challenges_pending_expiry_idx' and indexdef ilike '%WHERE (status = ''pending''::text)%'",
      '1',
    ],
    [
      'defines the user-status index',
      "select count(*)::text from pg_indexes where tablename='auth_login_challenges' and indexname='auth_login_challenges_user_status_idx'",
      '1',
    ],
    [
      'defines the cleanup status index',
      "select count(*)::text from pg_indexes where tablename='auth_login_challenges' and indexname='auth_login_challenges_status_updated_idx'",
      '1',
    ],
    [
      'creates no triggers or custom functions',
      "select (select count(*) from pg_trigger where tgrelid='auth_login_challenges'::regclass and not tgisinternal)::text",
      '0',
    ],
  ])('%s', async (_name, query, expected) => {
    const result = await client.pool.query<{ count: string }>(query);
    expect(result.rows[0]?.count).toBe(expected);
  });
});

interface Fixture {
  userId: string;
  firstCompanyId: string;
  secondCompanyId: string;
}

interface ChallengeOverrides {
  tokenHash?: string;
  status?: string;
  eligibleCompanyIds?: string[];
  selectedCompanyId?: string;
  deviceId?: string;
  attemptCount?: number;
  maxAttempts?: number;
  expiresAt?: Date;
  consumedAt?: Date;
  invalidatedAt?: Date;
  metadata?: unknown;
  version?: number;
}

async function withFixture(
  database: DatabaseClient,
  callback: (connection: PoolClient, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const connection = await database.pool.connect();
  try {
    await connection.query('begin');
    const fixture = await seedFixture(connection);
    await callback(connection, fixture);
  } finally {
    await connection.query('rollback');
    connection.release();
  }
}

async function seedFixture(connection: PoolClient): Promise<Fixture> {
  const fixture = {
    userId: randomUUID(),
    firstCompanyId: randomUUID(),
    secondCompanyId: randomUUID(),
  };
  for (const id of [fixture.firstCompanyId, fixture.secondCompanyId])
    await connection.query(
      `insert into companies (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values ($1,'Test','Test',$2,'active','UTC','MXN','es-MX')`,
      [id, `auth-${id}`],
    );
  await connection.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,'Auth Test','active')`,
    [fixture.userId, `${fixture.userId}@example.test`],
  );
  return fixture;
}

async function seedCommittedFixture(database: DatabaseClient): Promise<Fixture> {
  const connection = await database.pool.connect();
  try {
    const fixture = await seedFixture(connection);
    return fixture;
  } finally {
    connection.release();
  }
}

async function cleanupFixture(database: DatabaseClient, fixture: Fixture): Promise<void> {
  await database.pool.query('delete from auth_login_challenges where user_id=$1', [fixture.userId]);
  await database.pool.query('delete from users where id=$1', [fixture.userId]);
  await database.pool.query('delete from companies where id=any($1::uuid[])', [
    [fixture.firstCompanyId, fixture.secondCompanyId],
  ]);
}

async function insertPending(
  connection: PoolClient,
  fixture: Fixture,
  overrides: ChallengeOverrides = {},
): Promise<string> {
  const id = randomUUID();
  await connection.query(
    `insert into auth_login_challenges
     (id,user_id,token_hash,status,eligible_company_ids,selected_company_id,device_id,
      client_type,attempt_count,max_attempts,expires_at,consumed_at,invalidated_at,metadata,version)
     values ($1,$2,$3,$4,$5,$6,$7,'browser',$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      fixture.userId,
      overrides.tokenHash ?? randomUUID().replaceAll('-', '').repeat(2),
      overrides.status ?? 'pending',
      overrides.eligibleCompanyIds ?? [fixture.firstCompanyId, fixture.secondCompanyId],
      overrides.selectedCompanyId ?? null,
      overrides.deviceId ?? null,
      overrides.attemptCount ?? 0,
      overrides.maxAttempts ?? 5,
      overrides.expiresAt ?? new Date(Date.now() + 300_000),
      overrides.consumedAt ?? null,
      overrides.invalidatedAt ?? null,
      overrides.metadata === undefined ? null : JSON.stringify(overrides.metadata),
      overrides.version ?? 1,
    ],
  );
  return id;
}

async function rejectInsert(
  connection: PoolClient,
  fixture: Fixture,
  savepoint: string,
  overrides: ChallengeOverrides,
  code: string,
): Promise<void> {
  await connection.query(`savepoint ${savepoint}`);
  await expect(insertPending(connection, fixture, overrides)).rejects.toMatchObject({ code });
  await connection.query(`rollback to savepoint ${savepoint}`);
}
