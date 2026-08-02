import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://integration-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL migrations', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    if (!new URL(integrationDatabaseUrl).pathname.toLowerCase().includes('test')) {
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    }
    client = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-db-test',
    });
    await migrate(client.db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => {
    await client.close();
  });

  it('executes the migration in a dedicated PostgreSQL test database', async () => {
    const result = await client.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    expect(result.rows.map((row) => row.table_name)).toContain('companies');
  });

  it('enforces company-relative branch codes', async () => {
    const connection = await client.pool.connect();
    const companyId = randomUUID();
    try {
      await connection.query('begin');
      await insertCompany(connection, companyId);
      await connection.query(
        `insert into branches (id, company_id, name, code, status, timezone)
         values ($1, $2, 'Test Branch', 'MAIN', 'active', 'UTC')`,
        [randomUUID(), companyId],
      );
      await expect(
        connection.query(
          `insert into branches (id, company_id, name, code, status, timezone)
           values ($1, $2, 'Duplicate', 'MAIN', 'active', 'UTC')`,
          [randomUUID(), companyId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces global identity and company membership constraints', async () => {
    const connection = await client.pool.connect();
    const firstCompanyId = randomUUID();
    const secondCompanyId = randomUUID();
    const userId = randomUUID();
    try {
      await connection.query('begin');
      await insertCompany(connection, firstCompanyId);
      await insertCompany(connection, secondCompanyId);
      await connection.query(
        `insert into users (id, email, normalized_email, display_name, status)
         values ($1, 'User@Example.test', 'user@example.test', 'User', 'active')`,
        [userId],
      );
      await connection.query('savepoint before_duplicate_email');
      await expect(
        connection.query(
          `insert into users (id, email, normalized_email, display_name, status)
           values ($1, 'USER@example.test', 'user@example.test', 'Other', 'active')`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await connection.query('rollback to savepoint before_duplicate_email');

      await connection.query(
        `insert into company_memberships (id, company_id, user_id, status)
         values ($1, $2, $3, 'active'), ($4, $5, $3, 'active')`,
        [randomUUID(), firstCompanyId, userId, randomUUID(), secondCompanyId],
      );
      await connection.query('savepoint before_duplicate_membership');
      await expect(
        connection.query(
          `insert into company_memberships (id, company_id, user_id, status)
           values ($1, $2, $3, 'active')`,
          [randomUUID(), firstCompanyId, userId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await connection.query('rollback to savepoint before_duplicate_membership');
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('rejects cross-company role, branch, and session membership contexts', async () => {
    const connection = await client.pool.connect();
    const firstCompanyId = randomUUID();
    const secondCompanyId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const otherMembershipId = randomUUID();
    const otherRoleId = randomUUID();
    const firstBranchId = randomUUID();
    const otherBranchId = randomUUID();
    try {
      await connection.query('begin');
      await insertCompany(connection, firstCompanyId);
      await insertCompany(connection, secondCompanyId);
      await connection.query(
        `insert into users (id, email, normalized_email, display_name, status)
         values ($1, 'scoped@example.test', 'scoped@example.test', 'Scoped User', 'active')`,
        [userId],
      );
      await connection.query(
        `insert into company_memberships (id, company_id, user_id, status)
         values ($1, $2, $3, 'active'), ($4, $5, $3, 'active')`,
        [membershipId, firstCompanyId, userId, otherMembershipId, secondCompanyId],
      );
      await connection.query(
        `insert into roles (id, company_id, name, code, status, is_system)
         values ($1, $2, 'Other Role', 'other-role', 'active', false)`,
        [otherRoleId, secondCompanyId],
      );
      await connection.query(
        `insert into branches (id, company_id, name, code, status, timezone)
         values ($1, $2, 'First Branch', 'FIRST', 'active', 'UTC'),
                ($3, $4, 'Other Branch', 'OTHER', 'active', 'UTC')`,
        [firstBranchId, firstCompanyId, otherBranchId, secondCompanyId],
      );
      await connection.query('savepoint before_cross_role');
      await expect(
        connection.query(
          `insert into user_roles (id, company_id, membership_id, role_id)
           values ($1, $2, $3, $4)`,
          [randomUUID(), firstCompanyId, membershipId, otherRoleId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await connection.query('rollback to savepoint before_cross_role');

      await connection.query('savepoint before_cross_branch');
      await expect(
        connection.query(
          `insert into user_roles (id, company_id, membership_id, role_id, branch_id)
           values ($1, $2, $3, $4, $5)`,
          [randomUUID(), secondCompanyId, otherMembershipId, otherRoleId, otherBranchId],
        ),
      ).resolves.toBeDefined();
      await connection.query('rollback to savepoint before_cross_branch');

      await connection.query('savepoint before_bad_branch');
      await expect(
        connection.query(
          `insert into user_roles (id, company_id, membership_id, role_id, branch_id)
           values ($1, $2, $3, $4, $5)`,
          [randomUUID(), secondCompanyId, otherMembershipId, otherRoleId, firstBranchId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await connection.query('rollback to savepoint before_bad_branch');

      await connection.query('savepoint before_bad_session');
      await expect(
        connection.query(
          `insert into sessions
           (id, company_id, user_id, membership_id, token_hash, status, expires_at, token_family_id)
           values ($1, $2, $3, $4, $5, 'active', now() + interval '1 hour', $6)`,
          [randomUUID(), firstCompanyId, userId, otherMembershipId, 'a'.repeat(64), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await connection.query('rollback to savepoint before_bad_session');
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces role, outbox, and idempotency constraints', async () => {
    const connection = await client.pool.connect();
    const companyId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const roleId = randomUUID();
    const permissionId = randomUUID();
    const eventId = randomUUID();
    try {
      await connection.query('begin');
      await insertCompany(connection, companyId);
      await connection.query(
        `insert into users (id, email, normalized_email, display_name, status)
         values ($1, 'roleuser@example.test', 'roleuser@example.test', 'Role User', 'active')`,
        [userId],
      );
      await connection.query(
        `insert into company_memberships (id, company_id, user_id, status)
         values ($1, $2, $3, 'active')`,
        [membershipId, companyId, userId],
      );

      await connection.query(
        `insert into roles (id, company_id, name, code, status, is_system)
         values ($1, $2, 'Operator', 'operator', 'active', false)`,
        [roleId, companyId],
      );
      await connection.query(
        `insert into permissions (id, code, description, domain)
         values ($1, $2, 'Read company', 'company')`,
        [permissionId, `migration.company_read_${permissionId.replaceAll('-', '')}`],
      );
      await connection.query(
        'insert into role_permissions (company_id, role_id, permission_id) values ($1, $2, $3)',
        [companyId, roleId, permissionId],
      );
      await connection.query('savepoint before_duplicate_role_permission');
      await expect(
        connection.query(
          'insert into role_permissions (company_id, role_id, permission_id) values ($1, $2, $3)',
          [companyId, roleId, permissionId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await connection.query('rollback to savepoint before_duplicate_role_permission');
      await connection.query(
        'insert into user_roles (id, company_id, membership_id, role_id) values ($1, $2, $3, $4)',
        [randomUUID(), companyId, membershipId, roleId],
      );
      await expect(
        connection.query(
          'insert into user_roles (id, company_id, membership_id, role_id) values ($1, $2, $3, $4)',
          [randomUUID(), companyId, membershipId, roleId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await connection.query('rollback');

      await connection.query('begin');
      await insertCompany(connection, companyId);
      await connection.query(
        `insert into outbox_events
         (event_id, company_id, event_type, schema_version, aggregate_type, aggregate_id,
          aggregate_version, payload, occurred_at, attempts)
         values ($1, $2, 'company.updated', 1, 'company', $2, 1, '{"id":"safe"}', now(), 0)`,
        [eventId, companyId],
      );
      await expect(
        connection.query(
          `insert into outbox_events
           (event_id, company_id, event_type, schema_version, aggregate_type, aggregate_id,
            aggregate_version, payload, occurred_at, attempts)
           values ($1, $2, 'company.updated', 1, 'company', $2, 1, '{"id":"safe"}', now(), 0)`,
          [eventId, companyId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await connection.query('rollback');

      await connection.query('begin');
      await insertCompany(connection, companyId);
      await connection.query(
        `insert into idempotency_keys
         (id, company_id, key, operation, request_hash, expires_at)
         values ($1, $2, 'key-1', 'test.operation', $3, now() + interval '1 hour')`,
        [randomUUID(), companyId, 'a'.repeat(64)],
      );
      await expect(
        connection.query(
          `insert into idempotency_keys
           (id, company_id, key, operation, request_hash, expires_at)
           values ($1, $2, 'key-1', 'test.operation', $3, now() + interval '1 hour')`,
          [randomUUID(), companyId, 'a'.repeat(64)],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await connection.query('rollback');

      await connection.query('begin');
      await insertCompany(connection, companyId);
      await expect(
        connection.query(
          `insert into outbox_events
           (event_id, company_id, event_type, schema_version, aggregate_type, aggregate_id,
            aggregate_version, payload, occurred_at, attempts)
           values ($1, $2, 'company.updated', 1, 'company', $2, 0, '{"id":"safe"}', now(), -1)`,
          [randomUUID(), companyId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces contextual sessions and hashed refresh generations', async () => {
    const connection = await client.pool.connect();
    const companyId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const sessionId = randomUUID();
    const tokenHash = 'a'.repeat(64);
    try {
      await connection.query('begin');
      await insertCompany(connection, companyId);
      await connection.query(
        `insert into users (id,email,normalized_email,display_name,status)
         values ($1,'session@example.test','session@example.test','Session User','active')`,
        [userId],
      );
      await connection.query(
        `insert into company_memberships (id,company_id,user_id,status)
         values ($1,$2,$3,'active')`,
        [membershipId, companyId, userId],
      );
      await connection.query(
        `insert into sessions
         (id,company_id,user_id,membership_id,token_hash,status,expires_at,token_family_id,token_generation)
         values ($1,$2,$3,$4,$5,'active',now()+interval '1 hour',$6,0)`,
        [sessionId, companyId, userId, membershipId, tokenHash, randomUUID()],
      );
      await connection.query(
        `insert into session_refresh_tokens
         (id,session_id,token_hash,generation,status,expires_at)
         values ($1,$2,$3,0,'active',now()+interval '1 hour')`,
        [randomUUID(), sessionId, tokenHash],
      );
      await connection.query('savepoint before_duplicate_generation');
      await expect(
        connection.query(
          `insert into session_refresh_tokens
           (id,session_id,token_hash,generation,status,expires_at)
           values ($1,$2,$3,0,'active',now()+interval '1 hour')`,
          [randomUUID(), sessionId, 'b'.repeat(64)],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await connection.query('rollback to savepoint before_duplicate_generation');
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces durable session transport without duplicating refresh-token state', async () => {
    const connection = await client.pool.connect();
    const companyId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const defaultSessionId = randomUUID();
    const bearerSessionId = randomUUID();
    const browserSessionId = randomUUID();
    try {
      await connection.query('begin');
      await insertCompany(connection, companyId);
      await connection.query(
        `insert into users (id,email,normalized_email,display_name,status)
         values ($1,'transport@example.test','transport@example.test','Transport User','active')`,
        [userId],
      );
      await connection.query(
        `insert into company_memberships (id,company_id,user_id,status)
         values ($1,$2,$3,'active')`,
        [membershipId, companyId, userId],
      );

      const insertSession = async (id: string, token: string, mode?: string): Promise<void> => {
        if (mode === undefined) {
          await connection.query(
            `insert into sessions
             (id,company_id,user_id,membership_id,token_hash,status,expires_at,token_family_id)
             values ($1,$2,$3,$4,$5,'active',now()+interval '1 hour',$6)`,
            [id, companyId, userId, membershipId, token, randomUUID()],
          );
          return;
        }
        await connection.query(
          `insert into sessions
           (id,company_id,user_id,membership_id,token_hash,status,transport_mode,expires_at,token_family_id)
           values ($1,$2,$3,$4,$5,'active',$6,now()+interval '1 hour',$7)`,
          [id, companyId, userId, membershipId, token, mode, randomUUID()],
        );
      };

      await insertSession(defaultSessionId, 'c'.repeat(64));
      await insertSession(bearerSessionId, 'd'.repeat(64), 'bearer');
      await insertSession(browserSessionId, 'e'.repeat(64), 'browser');

      const modes = await connection.query<{ id: string; transport_mode: string }>(
        'select id,transport_mode from sessions where id=any($1::uuid[]) order by id',
        [[defaultSessionId, bearerSessionId, browserSessionId]],
      );
      expect(new Map(modes.rows.map((row) => [row.id, row.transport_mode]))).toEqual(
        new Map([
          [defaultSessionId, 'bearer'],
          [bearerSessionId, 'bearer'],
          [browserSessionId, 'browser'],
        ]),
      );

      await expectConstraintViolation(
        connection,
        'invalid_transport',
        `insert into sessions
         (id,company_id,user_id,membership_id,token_hash,status,transport_mode,expires_at,token_family_id)
         values ($1,$2,$3,$4,$5,'active','cookie',now()+interval '1 hour',$6)`,
        [randomUUID(), companyId, userId, membershipId, 'f'.repeat(64), randomUUID()],
        '23514',
      );
      await expectConstraintViolation(
        connection,
        'null_transport',
        `insert into sessions
         (id,company_id,user_id,membership_id,token_hash,status,transport_mode,expires_at,token_family_id)
         values ($1,$2,$3,$4,$5,'active',null,now()+interval '1 hour',$6)`,
        [randomUUID(), companyId, userId, membershipId, '0'.repeat(64), randomUUID()],
        '23502',
      );

      await connection.query(
        `insert into session_refresh_tokens
         (id,session_id,token_hash,generation,status,expires_at)
         values ($1,$2,$3,0,'active',now()+interval '1 hour')`,
        [randomUUID(), browserSessionId, '1'.repeat(64)],
      );
      await connection.query(
        `update session_refresh_tokens set status='rotated',rotated_at=now()
         where session_id=$1 and generation=0`,
        [browserSessionId],
      );
      await connection.query(
        `insert into session_refresh_tokens
         (id,session_id,token_hash,generation,status,expires_at)
         values ($1,$2,$3,1,'active',now()+interval '1 hour')`,
        [randomUUID(), browserSessionId, '2'.repeat(64)],
      );
      await connection.query(
        `update sessions set status='revoked',revoked_at=now(),revocation_reason='test'
         where id=$1`,
        [browserSessionId],
      );
      const relation = await connection.query<{
        mode: string;
        session_status: string;
        token_status: string;
      }>(
        `select s.transport_mode mode,s.status session_status,t.status token_status
         from session_refresh_tokens t join sessions s on s.id=t.session_id
         where t.session_id=$1 and t.generation=1`,
        [browserSessionId],
      );
      expect(relation.rows[0]).toEqual({
        mode: 'browser',
        session_status: 'revoked',
        token_status: 'active',
      });

      const refreshColumns = await connection.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name='session_refresh_tokens'`,
      );
      expect(refreshColumns.rows.map((row) => row.column_name)).not.toContain('transport_mode');
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('backfills a pre-0010 session to bearer when the additive migration is applied', async () => {
    const connection = await client.pool.connect();
    const companyId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const sessionId = randomUUID();
    try {
      await connection.query('begin');
      await connection.query('alter table sessions drop constraint sessions_transport_mode_ck');
      await connection.query('alter table sessions drop column transport_mode');
      await insertCompany(connection, companyId);
      await connection.query(
        `insert into users (id,email,normalized_email,display_name,status)
         values ($1,'historical@example.test','historical@example.test','Historical User','active')`,
        [userId],
      );
      await connection.query(
        `insert into company_memberships (id,company_id,user_id,status)
         values ($1,$2,$3,'active')`,
        [membershipId, companyId, userId],
      );
      await connection.query(
        `insert into sessions
         (id,company_id,user_id,membership_id,token_hash,status,expires_at,token_family_id)
         values ($1,$2,$3,$4,$5,'active',now()+interval '1 hour',$6)`,
        [sessionId, companyId, userId, membershipId, '3'.repeat(64), randomUUID()],
      );

      await connection.query(
        `alter table sessions add column transport_mode text default 'bearer' not null`,
      );
      await connection.query(
        `alter table sessions add constraint sessions_transport_mode_ck
         check (transport_mode in ('browser','bearer'))`,
      );
      const result = await connection.query<{ transport_mode: string }>(
        'select transport_mode from sessions where id=$1',
        [sessionId],
      );
      expect(result.rows[0]?.transport_mode).toBe('bearer');
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });

  it('enforces scoped setting structure, lifecycle, and tenant ownership', async () => {
    const connection = await client.pool.connect();
    const firstCompanyId = randomUUID();
    const secondCompanyId = randomUUID();
    const firstBranchId = randomUUID();
    const secondBranchId = randomUUID();
    const userId = randomUUID();
    const companySettingId = randomUUID();
    try {
      await connection.query('begin');
      await insertCompany(connection, firstCompanyId);
      await insertCompany(connection, secondCompanyId);
      await connection.query(
        `insert into users (id, email, normalized_email, display_name, status)
         values ($1, 'settings@example.test', 'settings@example.test', 'Settings User', 'active')`,
        [userId],
      );
      await connection.query(
        `insert into branches (id, company_id, name, code, status, timezone)
         values ($1, $2, 'First Branch', 'FIRST', 'active', 'UTC'),
                ($3, $4, 'Second Branch', 'SECOND', 'active', 'UTC')`,
        [firstBranchId, firstCompanyId, secondBranchId, secondCompanyId],
      );

      await connection.query(
        `insert into company_settings
         (id, company_id, key, value, value_type, status, created_by, updated_by)
         values ($1, $2, 'business.locale', '"es-MX"'::jsonb, 'string', 'active', $3, $3)`,
        [companySettingId, firstCompanyId, userId],
      );
      const persistedDefault = await connection.query<{ version: string }>(
        'select version from company_settings where id = $1',
        [companySettingId],
      );
      expect(persistedDefault.rows[0]?.version).toBe('2');
      await connection.query(
        `insert into branch_settings
         (id, company_id, branch_id, key, value, value_type, status, version, created_by, updated_by)
         values ($1, $2, $3, 'ui.time_format', '"24h"'::jsonb, 'string', 'active', 2, $4, $4)`,
        [randomUUID(), firstCompanyId, firstBranchId, userId],
      );

      await expectConstraintViolation(
        connection,
        'settings_cross_tenant',
        `insert into branch_settings
         (id, company_id, branch_id, key, value, value_type, status, version, created_by, updated_by)
         values ($1, $2, $3, 'ui.date_format', '"DD/MM/YYYY"'::jsonb, 'string', 'active', 2, $4, $4)`,
        [randomUUID(), firstCompanyId, secondBranchId, userId],
        '23503',
      );
      await expectConstraintViolation(
        connection,
        'settings_version_one',
        `insert into company_settings
         (id, company_id, key, value, value_type, status, version, created_by, updated_by)
         values ($1, $2, 'ui.time_format', '"24h"'::jsonb, 'string', 'active', 1, $3, $3)`,
        [randomUUID(), firstCompanyId, userId],
        '23514',
      );
      await expectConstraintViolation(
        connection,
        'settings_active_deleted',
        `insert into company_settings
         (id, company_id, key, value, value_type, status, version, created_by, updated_by, deleted_at)
         values ($1, $2, 'ui.date_format', '"DD/MM/YYYY"'::jsonb, 'string', 'active', 2, $3, $3, now())`,
        [randomUUID(), firstCompanyId, userId],
        '23514',
      );
      await expectConstraintViolation(
        connection,
        'settings_retired_without_deleted',
        `insert into company_settings
         (id, company_id, key, value, value_type, status, version, created_by, updated_by)
         values ($1, $2, 'receipts.header_text', '""'::jsonb, 'string', 'retired', 2, $3, $3)`,
        [randomUUID(), firstCompanyId, userId],
        '23514',
      );
      await expectConstraintViolation(
        connection,
        'settings_secret',
        `insert into company_settings
         (id, company_id, key, value, value_type, status, is_secret, version, created_by, updated_by)
         values ($1, $2, 'receipts.footer_text', '""'::jsonb, 'string', 'active', true, 2, $3, $3)`,
        [randomUUID(), firstCompanyId, userId],
        '23514',
      );

      const incompatibleValues = [
        ['string', 'true'],
        ['boolean', '"true"'],
        ['integer', '1.5'],
      ] as const;
      for (const [valueType, value] of incompatibleValues) {
        await expectConstraintViolation(
          connection,
          `settings_bad_${valueType}`,
          `insert into company_settings
           (id, company_id, key, value, value_type, status, version, created_by, updated_by)
           values ($1, $2, $3, $4::jsonb, $5, 'active', 2, $6, $6)`,
          [randomUUID(), firstCompanyId, `test.${valueType}`, value, valueType, userId],
          '23514',
        );
      }
    } finally {
      await connection.query('rollback');
      connection.release();
    }
  });
});

async function expectConstraintViolation(
  connection: { query(query: string, values?: readonly unknown[]): Promise<unknown> },
  savepoint: string,
  query: string,
  values: readonly unknown[],
  code: string,
): Promise<void> {
  await connection.query(`savepoint ${savepoint}`);
  await expect(connection.query(query, values)).rejects.toMatchObject({ code });
  await connection.query(`rollback to savepoint ${savepoint}`);
}

async function insertCompany(
  connection: { query(query: string, values?: readonly unknown[]): Promise<unknown> },
  companyId: string,
): Promise<void> {
  await connection.query(
    `insert into companies (id, legal_name, display_name, slug, status, timezone, currency_code, locale)
     values ($1, 'Test Company', 'Test Company', $2, 'active', 'UTC', 'MXN', 'es-MX')`,
    [companyId, `test-${companyId}`],
  );
}
