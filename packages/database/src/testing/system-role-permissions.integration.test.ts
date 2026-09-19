import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { syncSystemRolePermissions } from '../seeds/system-role-permissions.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../drizzle');

/**
 * TASK 16.10B — real, Postgres-backed proof of the production incident
 * (an existing tenant's Owner role never received `purchase.receive`
 * after TASK 16.10 introduced it) AND of the fix: `syncSystemRolePermissions`
 * genuinely reproduces the exact upgrade scenario — an `is_system=true`
 * role created BEFORE a new `permissions` row exists, then that new row
 * is inserted (simulating a real deploy's `seedTechnicalPermissions`
 * step), then the sync function runs (simulating the same deploy's next
 * line) — and confirms a CUSTOM role never gains anything, the sync is
 * idempotent, a brand-new tenant's already-complete Owner role is left
 * alone, and no cross-tenant leakage occurs.
 */
integration('PostgreSQL system role permission upgrade sync (TASK 16.10B)', () => {
  let database: DatabaseClient;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  const ownerRoleAId = randomUUID();
  const ownerRoleBId = randomUUID();
  const customRoleId = randomUUID();
  const userId = randomUUID();

  // A permission that exists from the start (both roles already have it,
  // reproducing "the pre-upgrade baseline").
  const oldPermissionId = randomUUID();
  const oldPermissionCode = `test.old_permission_${oldPermissionId.slice(0, 8)}`;
  // The "newly introduced" permission — inserted AFTER both roles already
  // exist, exactly like `purchase.receive` was added after INFLAPARK's
  // Owner role was already provisioned.
  const newPermissionId = randomUUID();
  const newPermissionCode = `test.new_permission_${newPermissionId.slice(0, 8)}`;

  async function applyIfMissing(regclass: string, files: readonly string[]): Promise<void> {
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

  async function rolePermissionCodes(roleId: string): Promise<string[]> {
    const rows = await database.pool.query<{ code: string }>(
      `select p.code from role_permissions rp join permissions p on p.id = rp.permission_id
       where rp.role_id = $1 order by p.code`,
      [roleId],
    );
    return rows.rows.map((row) => row.code);
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-system-role-sync' });
    await applyIfMissing('companies', [
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

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Sync Co A','Sync Co A',$2,'active','UTC','MXN','es-MX'),
             ($3,'Sync Co B','Sync Co B',$4,'active','UTC','MXN','es-MX')`,
      [companyAId, `sync-co-a-${companyAId}`, companyBId, `sync-co-b-${companyBId}`],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'Sync Actor','active')`,
      [userId, `sync-${userId}@example.test`],
    );

    // The "old" permission exists from before either role was created —
    // both a system role and a custom role are granted it, reproducing a
    // real pre-upgrade baseline (a custom role legitimately holding SOME
    // permissions the tenant configured themselves).
    await database.pool.query(
      `insert into permissions(id,code,description,domain) values($1,$2,'Old permission (fixture).','test')`,
      [oldPermissionId, oldPermissionCode],
    );

    // Company A's system-managed Owner role — created BEFORE the new
    // permission exists, exactly like INFLAPARK's real Owner role.
    await database.pool.query(
      `insert into roles(id,company_id,name,code,description,status,is_system)
       values($1,$2,'Owner','owner','Full-authority owner role.','active',true)`,
      [ownerRoleAId, companyAId],
    );
    // Company A's tenant-created custom role — e.g. a "Cajero" role the
    // tenant deliberately scoped to ONLY the old permission.
    await database.pool.query(
      `insert into roles(id,company_id,name,code,description,status,is_system)
       values($1,$2,'Cajero','cajero','Tenant-configured cashier role.','active',false)`,
      [customRoleId, companyAId],
    );
    // Company B's OWN system-managed Owner role — a second tenant, to
    // prove no cross-tenant leakage.
    await database.pool.query(
      `insert into roles(id,company_id,name,code,description,status,is_system)
       values($1,$2,'Owner','owner','Full-authority owner role.','active',true)`,
      [ownerRoleBId, companyBId],
    );

    for (const [roleId, companyId] of [
      [ownerRoleAId, companyAId],
      [customRoleId, companyAId],
      [ownerRoleBId, companyBId],
    ] as const) {
      await database.pool.query(
        `insert into role_permissions(company_id,role_id,permission_id,effect) values($1,$2,$3,'allow')`,
        [companyId, roleId, oldPermissionId],
      );
    }

    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [randomUUID(), companyAId, userId],
    );
  });

  afterAll(async () => {
    const companyIds = [companyAId, companyBId];
    // `syncSystemRolePermissions` is deliberately global (every tenant's
    // system role, not just these two fixture companies) — so it may
    // have granted these fixture permission ids to OTHER pre-existing
    // `is_system=true` roles left over from unrelated test suites in this
    // shared test database. Clean up by `permission_id` FIRST (catches
    // every grant anywhere), not just by `company_id`, or the final
    // `permissions` delete below would fail its own foreign key.
    await database.pool.query('delete from role_permissions where permission_id=any($1::uuid[])', [
      [oldPermissionId, newPermissionId],
    ]);
    // Separately: `syncSystemRolePermissions` also granted the FULL
    // pre-existing permission catalogue (every real production
    // permission code already seeded into this shared test database) to
    // these fixture system roles, via the same cross join — clean those
    // up too, by company, before the roles themselves can be deleted.
    await database.pool.query('delete from role_permissions where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from roles where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from permissions where id=any($1::uuid[])', [
      [oldPermissionId, newPermissionId],
    ]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from users where id=$1', [userId]);
    await database.close();
  });

  it('reproduces the real production gap: an existing system role does not have a permission introduced after it was created', async () => {
    const before = await rolePermissionCodes(ownerRoleAId);
    expect(before).toEqual([oldPermissionCode]);
    expect(before).not.toContain(newPermissionCode);
  });

  it('upgrades every existing system role once the new permission is introduced and synced — the full production deploy sequence', async () => {
    // Step 1 of a real deploy: `seedTechnicalPermissions`'s own insert,
    // reproduced directly here (the new canonical permission is added).
    await database.pool.query(
      `insert into permissions(id,code,description,domain) values($1,$2,'New permission (fixture).','test')`,
      [newPermissionId, newPermissionCode],
    );

    // Step 2 of a real deploy: this task's own new sync step.
    const granted = await syncSystemRolePermissions(database.db);
    expect(granted).toBeGreaterThan(0);

    // Company A's Owner role — the exact production scenario — now has
    // the new permission, without losing the old one.
    const ownerACodes = await rolePermissionCodes(ownerRoleAId);
    expect(ownerACodes).toContain(oldPermissionCode);
    expect(ownerACodes).toContain(newPermissionCode);

    // Company B's OWN, separate Owner role also received it — the sync
    // is genuinely tenant-agnostic, not a one-off fix for one company.
    const ownerBCodes = await rolePermissionCodes(ownerRoleBId);
    expect(ownerBCodes).toContain(newPermissionCode);
  });

  it('never widens a tenant-configured custom role', async () => {
    const customCodes = await rolePermissionCodes(customRoleId);
    expect(customCodes).toEqual([oldPermissionCode]);
    expect(customCodes).not.toContain(newPermissionCode);
  });

  it('is idempotent — a second sync run grants nothing further', async () => {
    const before = await rolePermissionCodes(ownerRoleAId);
    const grantedAgain = await syncSystemRolePermissions(database.db);
    expect(grantedAgain).toBe(0);
    const after = await rolePermissionCodes(ownerRoleAId);
    expect(after).toEqual(before);
  });

  it('never duplicates or errors on a role that already holds every permission (the fresh-tenant case)', async () => {
    // A brand-new tenant's Owner role, provisioned via
    // `ProductionOwnerProvisioner` AFTER `newPermissionCode` already
    // exists, is granted the complete set at creation time — running the
    // sync immediately afterward must be a true no-op for it.
    const freshCompanyId = randomUUID();
    const freshRoleId = randomUUID();
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'Fresh Co','Fresh Co',$2,'active','UTC','MXN','es-MX')`,
      [freshCompanyId, `sync-fresh-${freshCompanyId}`],
    );
    await database.pool.query(
      `insert into roles(id,company_id,name,code,description,status,is_system)
       values($1,$2,'Owner','owner','Full-authority owner role.','active',true)`,
      [freshRoleId, freshCompanyId],
    );
    const allPermissionIds = await database.pool.query<{ id: string }>('select id from permissions');
    for (const row of allPermissionIds.rows)
      await database.pool.query(
        `insert into role_permissions(company_id,role_id,permission_id,effect) values($1,$2,$3,'allow')`,
        [freshCompanyId, freshRoleId, row.id],
      );

    const granted = await syncSystemRolePermissions(database.db);
    expect(granted).toBe(0);

    await database.pool.query('delete from role_permissions where company_id=$1', [freshCompanyId]);
    await database.pool.query('delete from roles where company_id=$1', [freshCompanyId]);
    await database.pool.query('delete from companies where id=$1', [freshCompanyId]);
  });
});
