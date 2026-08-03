import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';
import { AppError } from '@asone/errors';

import type { AuthService } from '../auth/auth.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AdminRepository } from './shared/admin.repository.js';
import { AdministrationService } from './shared/admin.service.js';
import type { AdminActor } from './shared/admin.types.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../../../../packages/database/drizzle');

const allPermissions = [
  'company.read',
  'company.update',
  'branch.read',
  'branch.create',
  'branch.update',
  'user.read',
  'user.create',
  'user.update',
  'role.read',
  'role.create',
  'role.update',
  'role.permission.manage',
  'role.assign',
  'permission.read',
  'branch_access.manage',
  'device.read',
  'device.register',
  'device.revoke',
] as const;

interface TenantFixture {
  readonly companyId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly branchId: string;
  readonly actor: AdminActor;
}

integration('PostgreSQL administration foundation', () => {
  let database: DatabaseClient;
  let service: AdministrationService;

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      applicationName: 'asone-administration-integration',
      connectionString: databaseUrl,
    });
    await ensureMigrations(database);
    const authorization = {
      requirePermission(context: AuthContext, permission: string): void {
        if (!context.permissions.includes(permission))
          throw new AppError({
            code: 'permission_denied',
            message: 'Permission denied.',
            statusCode: 403,
          });
      },
      requireBranchAccess(context: AuthContext, branchId: string): void {
        if (!context.permittedBranchIds.includes(branchId))
          throw new AppError({
            code: 'branch_scope_mismatch',
            message: 'Branch denied.',
            statusCode: 403,
          });
      },
    } as unknown as AuthService;
    service = new AdministrationService(new AdminRepository(database), authorization);
  });

  beforeEach(async () => {
    await database.pool.query(
      `truncate table session_refresh_tokens,sessions,user_branch_access,user_roles,role_permissions,
       permissions,roles,devices,company_memberships,users,branches,outbox_events,audit_log,
       idempotency_keys,companies cascade`,
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it('isolates companies and branches and ignores client tenant data', async () => {
    const first = await tenantFixture(database, 'first');
    const second = await tenantFixture(database, 'second');
    expect(await service.currentCompany(first.actor)).toMatchObject({ id: first.companyId });
    await expect(service.branch(first.actor, second.branchId)).rejects.toMatchObject({
      code: 'branch_scope_mismatch',
    });
    const created = await service.createBranch(first.actor, {
      code: 'NEW',
      name: 'New',
      timezone: 'UTC',
      address: { company_id: second.companyId },
    });
    expect(created).toMatchObject({ company_id: first.companyId });
    expect(await service.listBranches(first.actor)).toHaveLength(1);
  });

  it('discovers only active companies and authoritative branch scope', async () => {
    const tenant = await tenantFixture(database, 'context');
    const eligibleCompanyId = randomUUID();
    const inactiveCompanyId = randomUUID();
    await database.pool.query(
      `insert into companies (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values ($1,'Eligible','Eligible',$2,'active','UTC','MXN','es-MX'),
              ($3,'Inactive','Inactive',$4,'suspended','UTC','MXN','es-MX')`,
      [
        eligibleCompanyId,
        `eligible-${eligibleCompanyId}`,
        inactiveCompanyId,
        `inactive-${inactiveCompanyId}`,
      ],
    );
    await database.pool.query(
      `insert into company_memberships (id,company_id,user_id,status)
       values ($1,$2,$3,'active'),($4,$5,$3,'active')`,
      [randomUUID(), eligibleCompanyId, tenant.userId, randomUUID(), inactiveCompanyId],
    );
    const companies = await service.contextCompanies(tenant.actor);
    expect(companies).toEqual([
      expect.objectContaining({ company_id: tenant.companyId, current: true }),
      expect.objectContaining({ company_id: eligibleCompanyId, current: false }),
    ]);
    expect(companies.every((company) => company.switch_permitted === true)).toBe(true);

    const restricted = await service.contextBranches(tenant.actor);
    expect(restricted).toMatchObject({
      companyId: tenant.companyId,
      companyWideAccess: false,
      items: [expect.objectContaining({ branch_id: tenant.branchId, current: true })],
    });
    const corporate = await service.contextBranches({
      ...tenant.actor,
      context: {
        ...tenant.actor.context,
        branchId: undefined,
        companyWideAccess: true,
        permittedBranchIds: [],
      },
    });
    expect(corporate.companyWideAccess).toBe(true);
    expect(corporate.items).toHaveLength(1);
    const empty = await service.contextBranches({
      ...tenant.actor,
      context: {
        ...tenant.actor.context,
        branchId: undefined,
        companyWideAccess: false,
        permittedBranchIds: [],
      },
    });
    expect(empty).toMatchObject({ companyWideAccess: false, items: [] });
  });

  it('creates and reads company memberships with safe role and branch includes', async () => {
    const tenant = await tenantFixture(database, 'members');
    const created = await service.createUser(tenant.actor, {
      displayName: 'Invited User',
      email: 'invited@example.test',
    });
    const userId = String(created.id);
    await database.pool.query(
      `update company_memberships set status='active' where company_id=$1 and user_id=$2`,
      [tenant.companyId, userId],
    );
    const role = await service.createRole(tenant.actor, { code: 'operator', name: 'Operator' });
    await service.assignRole(tenant.actor, userId, { roleId: String(role.id) });
    await service.changeBranchAccess(tenant.actor, userId, tenant.branchId, {
      isDefault: true,
      status: 'active',
    });
    const detail = await service.userDetail(tenant.actor, userId, ['roles', 'branches']);
    expect(detail).not.toHaveProperty('password_hash');
    expect(detail.roles).toEqual([expect.objectContaining({ status: 'active' })]);
    expect(detail.branch_access).toEqual([
      expect.objectContaining({ branch_id: tenant.branchId, is_default: true }),
    ]);
    const other = await tenantFixture(database, 'other-members');
    await expect(service.userDetail(other.actor, userId, [])).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('revokes company sessions and refresh tokens when membership is suspended', async () => {
    const tenant = await tenantFixture(database, 'suspension');
    const sessionId = await insertSession(database, tenant);
    await service.updateMembership(tenant.actor, tenant.userId, 'suspended');
    await expect(sessionStates(database, sessionId)).resolves.toEqual({
      refresh: 'revoked',
      session: 'revoked',
    });
  });

  it('protects system roles and atomically applies allow and deny permissions', async () => {
    const tenant = await tenantFixture(database, 'permissions');
    const role = await service.createRole(tenant.actor, { code: 'manager', name: 'Manager' });
    const allowId = randomUUID();
    const denyId = randomUUID();
    await database.pool.query(
      `insert into permissions (id,code,description,domain) values
       ($1,'company.read','Read company','company'),($2,'company.update','Update company','company')`,
      [allowId, denyId],
    );
    await service.replaceRolePermissions(tenant.actor, String(role.id), [
      { effect: 'allow', permissionId: allowId },
      { effect: 'deny', permissionId: denyId },
    ]);
    expect(await service.rolePermissions(tenant.actor, String(role.id))).toEqual([
      expect.objectContaining({ effect: 'allow' }),
      expect.objectContaining({ effect: 'deny' }),
    ]);
    await expect(
      service.replaceRolePermissions(tenant.actor, String(role.id), [
        { effect: 'allow', permissionId: allowId },
        { effect: 'deny', permissionId: allowId },
      ]),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await database.pool.query(`update roles set is_system=true where id=$1`, [role.id]);
    await expect(
      service.updateRole(tenant.actor, String(role.id), { name: 'Unsafe' }),
    ).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('assigns, rejects duplicates, revokes, and reactivates membership roles', async () => {
    const tenant = await tenantFixture(database, 'assignments');
    const role = await service.createRole(tenant.actor, { code: 'cashier', name: 'Cashier' });
    const assignment = await service.assignRole(tenant.actor, tenant.userId, {
      roleId: String(role.id),
    });
    await expect(
      service.assignRole(tenant.actor, tenant.userId, { roleId: String(role.id) }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await service.revokeRoleAssignment(tenant.actor, tenant.userId, String(assignment.id));
    const revokedAssignments = await service.listRoleAssignments(tenant.actor, tenant.userId);
    expect(revokedAssignments[0]?.status).toBe('revoked');
    expect(revokedAssignments[0]?.revoked_at).toBeInstanceOf(Date);
    const reactivated = await service.assignRole(tenant.actor, tenant.userId, {
      roleId: String(role.id),
    });
    expect(reactivated).toMatchObject({ id: assignment.id, reactivated: true });
  });

  it('grants one default branch and logically revokes branch sessions idempotently', async () => {
    const tenant = await tenantFixture(database, 'access');
    const secondBranchId = await insertBranch(database, tenant.companyId, 'SECOND');
    const actor = withBranches(tenant.actor, [tenant.branchId, secondBranchId]);
    await service.changeBranchAccess(actor, tenant.userId, tenant.branchId, {
      isDefault: true,
      status: 'active',
    });
    await service.changeBranchAccess(actor, tenant.userId, secondBranchId, {
      isDefault: true,
      status: 'active',
    });
    const defaults = await database.pool.query<{ count: string }>(
      `select count(*)::text count from user_branch_access where company_id=$1 and is_default and status='active'`,
      [tenant.companyId],
    );
    expect(defaults.rows[0]?.count).toBe('1');
    const sessionId = await insertSession(database, tenant, secondBranchId);
    await service.revokeBranchAccess(actor, tenant.userId, secondBranchId);
    await service.revokeBranchAccess(actor, tenant.userId, secondBranchId);
    await expect(sessionStates(database, sessionId)).resolves.toEqual({
      refresh: 'revoked',
      session: 'revoked',
    });
  });

  it('isolates devices and revokes device sessions and refresh tokens idempotently', async () => {
    const first = await tenantFixture(database, 'devices-first');
    const second = await tenantFixture(database, 'devices-second');
    const firstDevice = await service.registerDevice(first.actor, {
      branchId: first.branchId,
      deviceCode: 'POS-01',
      deviceType: 'pos',
      name: 'POS One',
      publicKey: 'public-but-not-returned',
    });
    await service.registerDevice(second.actor, {
      branchId: second.branchId,
      deviceCode: 'POS-01',
      deviceType: 'pos',
      name: 'Other POS',
    });
    expect(firstDevice).not.toHaveProperty('public_key');
    await expect(
      service.registerDevice(first.actor, {
        branchId: first.branchId,
        deviceCode: 'POS-01',
        deviceType: 'pos',
        name: 'Duplicate',
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(service.device(second.actor, String(firstDevice.id))).rejects.toMatchObject({
      code: 'not_found',
    });
    const sessionId = await insertSession(database, first, first.branchId, String(firstDevice.id));
    const revoked = await service.revokeDevice(
      first.actor,
      String(firstDevice.id),
      'security',
      'Lost device',
    );
    expect(revoked.status).toBe('revoked');
    expect(revoked.revoked_at).toBeInstanceOf(Date);
    await service.revokeDevice(first.actor, String(firstDevice.id), 'security');
    await expect(sessionStates(database, sessionId)).resolves.toEqual({
      refresh: 'revoked',
      session: 'revoked',
    });
  });

  it('commits audit and outbox metadata and leaves neither after a failed mutation', async () => {
    const tenant = await tenantFixture(database, 'audit');
    const role = await service.createRole(tenant.actor, { code: 'audited', name: 'Audited' });
    const audit = await database.pool.query<{
      action: string;
      actor_id: string;
      company_id: string;
      correlation_id: string;
      entity_id: string;
      request_id: string;
    }>(
      `select action,actor_id,company_id,correlation_id,entity_id,request_id from audit_log where entity_id=$1`,
      [role.id],
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'role.created',
      actor_id: tenant.userId,
      company_id: tenant.companyId,
      correlation_id: tenant.actor.correlationId,
      entity_id: role.id,
      request_id: tenant.actor.requestId,
    });
    expect(
      (
        await database.pool.query<{ count: string }>(
          `select count(*)::text count from outbox_events where aggregate_id=$1`,
          [role.id],
        )
      ).rows[0]?.count,
    ).toBe('1');
  });
});

async function ensureMigrations(database: DatabaseClient): Promise<void> {
  const existing = await database.pool.query<{ present: string | null }>(
    `select to_regclass('public.companies')::text present`,
  );
  if (existing.rows[0]?.present !== null) return;
  for (const name of [
    '0000_fantastic_black_cat.sql',
    '0001_high_thor.sql',
    '0002_true_sugar_man.sql',
  ]) {
    const sql = await readFile(resolve(migrationsPath, name), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }
}

async function tenantFixture(database: DatabaseClient, slug: string): Promise<TenantFixture> {
  const companyId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const branchId = randomUUID();
  await database.pool.query(
    `insert into companies (id,legal_name,display_name,slug,status,timezone,currency_code,locale)
     values ($1,$2,$2,$3,'active','UTC','MXN','es-MX')`,
    [companyId, `Company ${slug}`, `${slug}-${companyId}`],
  );
  await database.pool.query(
    `insert into users (id,email,normalized_email,display_name,status)
     values ($1,$2,$2,$3,'active')`,
    [userId, `${slug}-${userId}@example.test`, `User ${slug}`],
  );
  await database.pool.query(
    `insert into company_memberships (id,company_id,user_id,status) values ($1,$2,$3,'active')`,
    [membershipId, companyId, userId],
  );
  await database.pool.query(
    `insert into branches (id,company_id,code,name,status,timezone) values ($1,$2,'MAIN','Main','active','UTC')`,
    [branchId, companyId],
  );
  return {
    actor: {
      context: {
        branchId,
        companyId,
        expiresAt: new Date(Date.now() + 60_000),
        membershipId,
        permissions: [...allPermissions],
        permittedBranchIds: [branchId],
        sessionId: randomUUID(),
        userId,
      },
      correlationId: `correlation-${slug}`,
      requestId: `request-${slug}`,
    },
    branchId,
    companyId,
    membershipId,
    userId,
  };
}

async function insertBranch(
  database: DatabaseClient,
  companyId: string,
  code: string,
): Promise<string> {
  const branchId = randomUUID();
  await database.pool.query(
    `insert into branches (id,company_id,code,name,status,timezone) values ($1,$2,$3,$3,'active','UTC')`,
    [branchId, companyId, code],
  );
  return branchId;
}

function withBranches(actor: AdminActor, permittedBranchIds: readonly string[]): AdminActor {
  return { ...actor, context: { ...actor.context, permittedBranchIds } };
}

async function insertSession(
  database: DatabaseClient,
  tenant: TenantFixture,
  branchId = tenant.branchId,
  deviceId?: string,
): Promise<string> {
  const sessionId = randomUUID();
  const hash = randomUUID().replaceAll('-', '').repeat(2);
  await database.pool.query(
    `insert into sessions
     (id,company_id,user_id,membership_id,branch_id,device_id,token_hash,status,expires_at,token_family_id)
     values ($1,$2,$3,$4,$5,$6,$7,'active',now()+interval '1 hour',$8)`,
    [
      sessionId,
      tenant.companyId,
      tenant.userId,
      tenant.membershipId,
      branchId,
      deviceId ?? null,
      hash,
      randomUUID(),
    ],
  );
  await database.pool.query(
    `insert into session_refresh_tokens (id,session_id,token_hash,generation,status,expires_at)
     values ($1,$2,$3,0,'active',now()+interval '1 hour')`,
    [randomUUID(), sessionId, hash],
  );
  return sessionId;
}

async function sessionStates(
  database: DatabaseClient,
  sessionId: string,
): Promise<{ refresh: string; session: string }> {
  const result = await database.pool.query<{ refresh: string; session: string }>(
    `select s.status session,t.status refresh from sessions s
     join session_refresh_tokens t on t.session_id=s.id where s.id=$1`,
    [sessionId],
  );
  const state = result.rows[0];
  if (state === undefined) throw new Error('Expected session state.');
  return state;
}
