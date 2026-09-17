import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, seedTechnicalPermissions, type DatabaseClient } from '@asone/database';

import { verifyPassword } from '../modules/auth/auth.passwords.js';
import { ProductionOwnerProvisioner } from './production-owner.service.js';
import { ProvisioningInputError, type ProvisionOwnerInput } from './production-owner.types.js';

/** TASK 14.1 Part E.12 — automated tests for the production-safe
 * first-tenant provisioning mechanism. Exercises the real service
 * against real Postgres (never a mock), the same discipline every other
 * integration test in this codebase already follows. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';

integration('PostgreSQL production owner provisioning (TASK 14.1)', () => {
  let database: DatabaseClient;
  let provisioner: ProductionOwnerProvisioner;

  beforeAll(() => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      applicationName: 'asone-production-owner-provisioning-integration',
      connectionString: databaseUrl,
    });
    provisioner = new ProductionOwnerProvisioner(database);
  });

  beforeEach(async () => {
    await database.pool.query(
      `truncate table session_refresh_tokens,sessions,user_branch_access,user_roles,role_permissions,
       permissions,roles,devices,company_memberships,users,branches,outbox_events,audit_log,
       idempotency_keys,companies cascade`,
    );
    // The REAL seed, not a hand-rolled fixture list — this proves the
    // provisioner works against the actual permission catalogue a real
    // deployment's `db:seed` step produces (Part E.9).
    await seedTechnicalPermissions(database.db);
  });

  afterAll(async () => {
    await database.close();
  });

  function baseInput(overrides: Partial<ProvisionOwnerInput> = {}): ProvisionOwnerInput {
    return {
      companyLegalName: 'Mi Tienda de Prueba S.A. de C.V.',
      companySlug: `mi-tienda-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerDisplayName: 'Ana Propietaria',
      ownerEmail: `ana-${Date.now().toString()}@example.test`,
      ownerPassword: STRONG_PASSWORD,
      ...overrides,
    };
  }

  it('provisions a company, owner, role, full permission grant, and no branch when none is requested', async () => {
    const input = baseInput();
    const summary = await provisioner.run(input);
    expect(summary.success).toBe(true);
    expect(summary.companySlug).toBe(input.companySlug);
    expect(summary.branchId).toBeNull();
    expect(summary.permissionsGranted).toBeGreaterThan(0);

    const [company] = await database.pool
      .query<{ slug: string; status: string }>('select slug, status from companies where id=$1', [summary.companyId])
      .then((r) => r.rows);
    expect(company).toMatchObject({ slug: input.companySlug, status: 'active' });

    const [user] = await database.pool
      .query<{ status: string; password_hash: string }>('select status, password_hash from users where id=$1', [
        summary.ownerUserId,
      ])
      .then((r) => r.rows);
    expect(user?.status).toBe('active');
    expect(await verifyPassword(user?.password_hash ?? '', STRONG_PASSWORD)).toBe(true);

    const grantedCount = await database.pool
      .query<{ count: string }>('select count(*)::text as count from role_permissions where role_id=$1', [
        summary.roleId,
      ])
      .then((r) => Number(r.rows[0]?.count ?? '0'));
    expect(grantedCount).toBe(summary.permissionsGranted);

    const roleAssignment = await database.pool
      .query<{ branch_id: string | null }>('select branch_id from user_roles where role_id=$1', [summary.roleId])
      .then((r) => r.rows[0]);
    expect(roleAssignment?.branch_id).toBeNull();
  });

  it('optionally creates the first branch and grants the owner default branch access', async () => {
    const input = baseInput({ branchName: 'Sucursal Centro', branchCode: 'CTR' });
    const summary = await provisioner.run(input);
    expect(summary.branchId).not.toBeNull();

    const [branch] = await database.pool
      .query<{ name: string; code: string }>('select name, code from branches where id=$1', [summary.branchId])
      .then((r) => r.rows);
    expect(branch).toMatchObject({ name: 'Sucursal Centro', code: 'CTR' });

    const [access] = await database.pool
      .query<{ is_default: boolean }>('select is_default from user_branch_access where branch_id=$1', [
        summary.branchId,
      ])
      .then((r) => r.rows);
    expect(access?.is_default).toBe(true);
  });

  it('refuses when only a branch name or only a branch code is supplied', async () => {
    await expect(provisioner.run(baseInput({ branchName: 'Sucursal Centro' }))).rejects.toBeInstanceOf(
      ProvisioningInputError,
    );
    await expect(provisioner.run(baseInput({ branchCode: 'CTR' }))).rejects.toBeInstanceOf(ProvisioningInputError);
  });

  // TASK 16.8B — this CLI is the OTHER place (besides `AdministrationService`'s
  // own HTTP routes) a real production company/branch timezone can be
  // persisted, at first-tenant provisioning time. Same production
  // incident, same fix: `--company-timezone`/`--branch-timezone` must be
  // rejected outright, never silently written, if not a real IANA zone.
  it('refuses an explicit, invalid company timezone rather than silently persisting it', async () => {
    await expect(
      provisioner.run(baseInput({ companyTimezone: 'Mexico_City' })),
    ).rejects.toBeInstanceOf(ProvisioningInputError);
  });

  it('accepts a real, explicit IANA company timezone and persists it exactly', async () => {
    const input = baseInput({ companyTimezone: 'America/Cancun' });
    const summary = await provisioner.run(input);
    const [company] = await database.pool
      .query<{ timezone: string }>('select timezone from companies where id=$1', [summary.companyId])
      .then((r) => r.rows);
    expect(company?.timezone).toBe('America/Cancun');
  });

  it('refuses an explicit, invalid branch timezone rather than silently persisting it', async () => {
    await expect(
      provisioner.run(
        baseInput({ branchName: 'Sucursal Norte', branchCode: 'NTE', branchTimezone: 'Mexico_City' }),
      ),
    ).rejects.toBeInstanceOf(ProvisioningInputError);
  });

  it('an omitted branch timezone still defaults to the (validated) company timezone, never a fake/placeholder value', async () => {
    const input = baseInput({
      companyTimezone: 'America/Tijuana',
      branchName: 'Sucursal Frontera',
      branchCode: 'FRT',
    });
    const summary = await provisioner.run(input);
    const [branch] = await database.pool
      .query<{ timezone: string }>('select timezone from branches where id=$1', [summary.branchId])
      .then((r) => r.rows);
    expect(branch?.timezone).toBe('America/Tijuana');
  });

  it('refuses a weak/placeholder password with the same production policy AdministrationService.updateMembership enforces', async () => {
    await expect(provisioner.run(baseInput({ ownerPassword: 'password123' }))).rejects.toThrow(
      /at least 12 characters/u,
    );
  });

  it('refuses an invalid company slug rather than silently normalizing it into something else', async () => {
    await expect(provisioner.run(baseInput({ companySlug: 'Not A Valid Slug!' }))).rejects.toBeInstanceOf(
      ProvisioningInputError,
    );
  });

  it('refuses outright — never silently upserts — when the company slug already exists (D1)', async () => {
    const input = baseInput();
    await provisioner.run(input);
    await expect(provisioner.run(input)).rejects.toThrow(/already exists/u);
    // Confirm no second company/user was created as a side effect of the
    // rejected second attempt.
    const companyCount = await database.pool
      .query<{ count: string }>('select count(*)::text as count from companies where slug=$1', [input.companySlug])
      .then((r) => Number(r.rows[0]?.count ?? '0'));
    expect(companyCount).toBe(1);
  });

  it('refuses when the permission catalogue is empty, before writing anything', async () => {
    await database.pool.query('delete from role_permissions');
    await database.pool.query('delete from permissions');
    const input = baseInput();
    await expect(provisioner.run(input)).rejects.toThrow(/permission catalogue is empty/u);
    const companyCount = await database.pool
      .query<{ count: string }>('select count(*)::text as count from companies where slug=$1', [input.companySlug])
      .then((r) => Number(r.rows[0]?.count ?? '0'));
    expect(companyCount).toBe(0);
  });

  it('writes an auditable production.owner_provisioned fact with no password in its metadata', async () => {
    const input = baseInput();
    const summary = await provisioner.run(input);
    const [entry] = await database.pool
      .query<{ action: string; metadata: Record<string, unknown> }>(
        'select action, metadata from audit_log where company_id=$1',
        [summary.companyId],
      )
      .then((r) => r.rows);
    expect(entry?.action).toBe('production.owner_provisioned');
    expect(JSON.stringify(entry?.metadata)).not.toMatch(/Correct-Horse-Battery/u);
  });

  it('rejects a malformed owner email rather than silently accepting it', async () => {
    await expect(provisioner.run(baseInput({ ownerEmail: 'not-an-email' }))).rejects.toBeInstanceOf(
      ProvisioningInputError,
    );
  });
});
