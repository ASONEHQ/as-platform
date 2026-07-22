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
           (id, company_id, user_id, membership_id, token_hash, status, expires_at)
           values ($1, $2, $3, $4, $5, 'active', now() + interval '1 hour')`,
          [randomUUID(), firstCompanyId, userId, otherMembershipId, 'a'.repeat(64)],
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
         values ($1, 'company.read', 'Read company', 'company')`,
        [permissionId],
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
});

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
