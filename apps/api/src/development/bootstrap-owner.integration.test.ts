import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseClient,
  type DatabaseClient,
  seedTechnicalPermissions,
} from '@asone/database';
import { verifyPassword } from '../modules/auth/auth.passwords.js';
import { DevelopmentOwnerBootstrap, ownerPermissionCodes } from './bootstrap-owner.service.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integrationDatabaseUrl = databaseUrl ?? 'postgresql://owner-bootstrap-test-disabled';
const integration = databaseUrl === undefined ? describe.skip : describe;
const ephemeralPassword = `Owner#${randomUUID()}Aa1!`;

integration('PostgreSQL development owner bootstrap', () => {
  let database: DatabaseClient;

  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl);
    if (!parsed.pathname.toLowerCase().includes('test')) {
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    }
    database = createDatabaseClient({
      connectionString: integrationDatabaseUrl,
      applicationName: 'asone-owner-bootstrap-test',
    });
    await ensureMigrations(database);
  });

  beforeEach(async () => {
    await database.pool.query('truncate table companies,users,permissions cascade');
    await seedTechnicalPermissions(database.db);
  });

  afterAll(async () => database.close());

  it('creates the complete owner identity and repeats without duplicates', async () => {
    const service = new DevelopmentOwnerBootstrap(database);
    const first = await service.run(ephemeralPassword);
    const idsBefore = await identityIds(database);
    const second = await service.run(ephemeralPassword);
    const idsAfter = await identityIds(database);

    expect(first).toEqual({
      company: 'created',
      branches: 6,
      user: 'created',
      roleAssignment: 'created',
      permissions: ownerPermissionCodes.length,
      success: true,
    });
    expect(second).toMatchObject({
      company: 'existing',
      branches: 6,
      user: 'existing',
      roleAssignment: 'existing',
      success: true,
    });
    expect(idsAfter).toEqual(idsBefore);

    const counts = await database.pool.query<{
      branches: string;
      memberships: string;
      role_assignments: string;
      branch_access: string;
      role_permissions: string;
    }>(
      `select
        (select count(*) from branches)::text branches,
        (select count(*) from company_memberships)::text memberships,
        (select count(*) from user_roles where branch_id is null and status='active')::text role_assignments,
        (select count(*) from user_branch_access where status='active')::text branch_access,
        (select count(*) from role_permissions where effect='allow')::text role_permissions`,
    );
    expect(counts.rows[0]).toEqual({
      branches: '6',
      memberships: '1',
      role_assignments: '1',
      branch_access: '6',
      role_permissions: String(ownerPermissionCodes.length),
    });
    const user = await database.pool.query<{
      display_name: string;
      password_hash: string;
      status: string;
    }>(
      `select display_name,password_hash,status from users where normalized_email='ceo@inflapark.local'`,
    );
    expect(user.rows[0]).toMatchObject({
      display_name: 'Bryant Aguilera Sánchez',
      status: 'active',
    });
    const persistedUser = user.rows[0];
    expect(persistedUser).toBeDefined();
    if (!persistedUser) throw new Error('Expected bootstrapped owner user.');
    expect(await verifyPassword(persistedUser.password_hash, ephemeralPassword)).toBe(true);
    expect(JSON.stringify(first)).not.toContain(ephemeralPassword);
    expect(JSON.stringify(first)).not.toContain('password_hash');
  });

  it('grants exactly the permissions a normal CAJERO cash checkout requires (TASK 12.5A/12.5B)', async () => {
    // Real-browser-QA regression: the owner role must include `sale.create`
    // (create the Sale), `payment.create` (confirm the cash payment via
    // `POST /sales/{sale_id}/cash-payments`), and `sale.read` (the receipt
    // dialog's `GET /sales/{sale_id}/receipt` immediately after). This
    // asserts the canonical list itself, not just its length, so a future
    // accidental removal of one of these specific codes fails loudly
    // instead of silently passing a length-only check.
    expect(ownerPermissionCodes).toEqual(
      expect.arrayContaining(['sale.create', 'sale.read', 'payment.create']),
    );

    await new DevelopmentOwnerBootstrap(database).run(ephemeralPassword);
    const granted = await database.pool.query<{ code: string }>(
      `select p.code from role_permissions rp
       join roles r on r.id=rp.role_id and r.company_id=rp.company_id
       join permissions p on p.id=rp.permission_id
       where r.code='owner' and rp.effect='allow'
       order by p.code`,
    );
    const codes = granted.rows.map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['sale.create', 'sale.read', 'payment.create']));
  });

  it('reconciles an existing owner role that predates a new permission, additively and idempotently', async () => {
    // Simulates the exact real-world state this fix repaired: an owner
    // role bootstrapped by an older `ownerPermissionCodes` list that did
    // not yet include `payment.create`/`sale.read`. Reconciliation must
    // add the missing grants on rerun without touching any pre-existing
    // permission, without creating a duplicate role/membership/user_roles
    // row, and without requiring the row to be inserted by hand.
    await new DevelopmentOwnerBootstrap(database).run(ephemeralPassword);
    const beforeRow = await database.pool.query<{
      role_id: string;
      company_id: string;
      permission_id: string;
    }>(
      `select rp.role_id, rp.company_id, rp.permission_id
       from role_permissions rp
       join roles r on r.id=rp.role_id and r.company_id=rp.company_id
       join permissions p on p.id=rp.permission_id
       where r.code='owner' and p.code in ('payment.create','sale.read')`,
    );
    expect(beforeRow.rows).toHaveLength(2);

    // Roll back to the "pre-fix" state: revoke exactly the two new grants,
    // leaving every other owner permission untouched — mirrors how the
    // real local Owner role looked before this session's bootstrap rerun.
    for (const row of beforeRow.rows) {
      await database.pool.query(
        `delete from role_permissions where role_id=$1 and company_id=$2 and permission_id=$3`,
        [row.role_id, row.company_id, row.permission_id],
      );
    }
    const idsBeforeRerun = await identityIds(database);
    const preRerunCount = await database.pool.query<{ count: string }>(
      `select count(*)::text from role_permissions where effect='allow'`,
    );
    expect(Number(preRerunCount.rows[0]?.count)).toBe(ownerPermissionCodes.length - 2);

    const summary = await new DevelopmentOwnerBootstrap(database).run(ephemeralPassword);
    const idsAfterRerun = await identityIds(database);

    expect(summary).toMatchObject({
      company: 'existing',
      user: 'existing',
      roleAssignment: 'existing',
      permissions: ownerPermissionCodes.length,
      success: true,
    });
    // Same company/user/membership/role identity — reconciliation never
    // recreates or duplicates the identity, only repairs its grants.
    expect(idsAfterRerun).toEqual(idsBeforeRerun);

    const afterRerun = await database.pool.query<{ code: string }>(
      `select p.code from role_permissions rp
       join roles r on r.id=rp.role_id and r.company_id=rp.company_id
       join permissions p on p.id=rp.permission_id
       where r.code='owner' and rp.effect='allow'
       order by p.code`,
    );
    const codesAfterRerun = afterRerun.rows.map((row) => row.code);
    expect(codesAfterRerun).toEqual([...ownerPermissionCodes].sort());
    expect(codesAfterRerun).toHaveLength(ownerPermissionCodes.length);
  });

  it('exposes six active branches and derives company-wide authorization', async () => {
    await new DevelopmentOwnerBootstrap(database).run(ephemeralPassword);
    const scope = await database.pool.query<{
      branch_count: string;
      company_wide: boolean;
      default_count: string;
    }>(
      `select
        (select count(*) from branches b join companies c on c.id=b.company_id
          where c.slug='inflapark-group' and b.status='active')::text branch_count,
        exists(select 1 from user_roles ur join roles r on r.id=ur.role_id and r.company_id=ur.company_id
          where r.code='owner' and ur.branch_id is null and ur.status='active') company_wide,
        (select count(*) from user_branch_access where status='active' and is_default)::text default_count`,
    );
    expect(scope.rows[0]).toEqual({
      branch_count: '6',
      company_wide: true,
      default_count: '1',
    });
  });

  it('rolls back every identity write when an approved permission is missing', async () => {
    await database.pool.query(`delete from permissions where code='audit.read'`);
    await expect(new DevelopmentOwnerBootstrap(database).run(ephemeralPassword)).rejects.toThrow(
      'Required approved permissions are missing',
    );
    const result = await database.pool.query<{
      companies: string;
      users: string;
      audit: string;
    }>(
      `select
        (select count(*) from companies)::text companies,
        (select count(*) from users)::text users,
        (select count(*) from audit_log)::text audit`,
    );
    expect(result.rows[0]).toEqual({ companies: '0', users: '0', audit: '0' });
  });
});

async function identityIds(database: DatabaseClient): Promise<Readonly<Record<string, string>>> {
  const result = await database.pool.query<{
    company_id: string;
    membership_id: string;
    role_id: string;
    user_id: string;
  }>(
    `select c.id company_id,u.id user_id,m.id membership_id,r.id role_id
     from companies c join company_memberships m on m.company_id=c.id
     join users u on u.id=m.user_id join roles r on r.company_id=c.id
     where c.slug='inflapark-group' and u.normalized_email='ceo@inflapark.local' and r.code='owner'`,
  );
  const identity = result.rows[0];
  if (!identity) throw new Error('Expected bootstrapped identity.');
  return identity;
}

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const existing = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.companies')::text present`,
  );
  if (existing.rows[0]?.present !== null) return;
  const migrationsPath = resolve(import.meta.dirname, '../../../../packages/database/drizzle');
  for (const name of [
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
    await database.pool.query(await readFile(resolve(migrationsPath, name), 'utf8'));
  }
}
