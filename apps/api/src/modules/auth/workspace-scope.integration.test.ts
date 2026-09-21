import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, roleTemplates, syncSystemRolePermissions, type DatabaseClient } from '@asone/database';

import { AdministrationService } from '../admin/shared/admin.service.js';
import { AdminRepository } from '../admin/shared/admin.repository.js';
import { AuthService } from './auth.service.js';
import { PostgresAuthRepository } from './auth.repository.js';
import { AuthTokens } from './auth.tokens.js';
import type { AuthContext } from './auth.types.js';

/** `resolveContext` intentionally returns `Omit<AuthContext, 'sessionId' |
 * 'expiresAt'>` (neither is ever resolved from the DB — see its own
 * interface doc comment); `AuthService.requireRegisterAccess` takes a full
 * `AuthContext`, so every direct-tampering assertion below re-attaches two
 * harmless placeholder values, exactly like `branch-consolidation.
 * integration.test.ts`'s own precedent for exercising this guard. */
function asAuthContext(resolved: Omit<AuthContext, 'sessionId' | 'expiresAt'>): AuthContext {
  return { ...resolved, sessionId: 'qa-session', expiresAt: new Date(Date.now() + 60_000) };
}

/** TASK 16.16 — certifies the register/branch scope intersection and
 * custom-role safety guarantees the "commercial workspace" feature is
 * built on. Deliberately does NOT re-prove ground TASK 16.15's own
 * `branch-consolidation.integration.test.ts` already covers (the
 * register-scoped SQL query itself, the branch-consolidation read model);
 * this file is scoped to what TASK 16.16 §7/§8/§11 specifically asks for:
 * generic User A / User B / Manager / Owner register isolation (named
 * exactly as the task's own spec, never a tenant-specific label), branch-
 * scope intersection (a register grant can never widen a branch
 * restriction), a dedicated regression test for a STALE register grant
 * pointing at a branch the membership no longer has any access to, custom-
 * role-from-template safety under `syncSystemRolePermissions()`, and that
 * a register-scope change is reflected on the very next `resolveContext`
 * call with no session/logout involved (TASK 16.10B's own live-freshness
 * guarantee, exercised here specifically for `permittedRegisterIds`). */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('PostgreSQL workspace/register-branch scope (TASK 16.16)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let authRepository: PostgresAuthRepository;
  let authService: AuthService;
  let administration: AdministrationService;

  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  const otherCompanyBranchId = randomUUID();
  const registerA1Id = randomUUID();
  const registerA2Id = randomUUID();
  const registerBId = randomUUID();

  const ownerUserId = randomUUID();
  const managerUserId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  let ownerMembershipId: string;
  let managerMembershipId: string;
  let userAMembershipId: string;
  let userBMembershipId: string;

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-workspace-scope-integration' });
    authRepository = new PostgresAuthRepository(database);
    authService = new AuthService({
      repository: authRepository,
      tokens: new AuthTokens({
        audience: 'asone-workspace-scope-test',
        issuer: 'https://api.test.asone.mx',
        secret: 'test-secret-that-is-at-least-32-characters',
        ttlSeconds: 300,
      }),
      dummyPasswordHash: 'x'.repeat(60),
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3_600,
    });
    administration = new AdministrationService(new AdminRepository(database), authService);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'QA Park','QA Park',$2,'active','America/Mexico_City','MXN','es-MX'),
             ($3,'QA Other Park','QA Other Park',$4,'active','UTC','MXN','es-MX')`,
      [companyId, `qa-park-${companyId}`, otherCompanyId, `qa-other-park-${otherCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Branch A','BRA','active','America/Mexico_City'),
             ($3,$2,'Branch B','BRB','active','America/Mexico_City'),
             ($4,$5,'Other Co Branch','OTHERBR','active','UTC')`,
      [branchAId, companyId, branchBId, otherCompanyBranchId, otherCompanyId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'QA Owner','active'),($3,$4,$4,'QA Manager','active'),
             ($5,$6,$6,'QA User A','active'),($7,$8,$8,'QA User B','active')`,
      [
        ownerUserId,
        `owner-${ownerUserId}@example.test`,
        managerUserId,
        `manager-${managerUserId}@example.test`,
        userAId,
        `user-a-${userAId}@example.test`,
        userBId,
        `user-b-${userBId}@example.test`,
      ],
    );
    ownerMembershipId = randomUUID();
    managerMembershipId = randomUUID();
    userAMembershipId = randomUUID();
    userBMembershipId = randomUUID();
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status)
       values($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$2,$7,'active'),($8,$2,$9,'active')`,
      [
        ownerMembershipId,
        companyId,
        ownerUserId,
        managerMembershipId,
        managerUserId,
        userAMembershipId,
        userAId,
        userBMembershipId,
        userBId,
      ],
    );

    await database.pool.query(
      `insert into cash_registers(id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by,version)
       values($1,$2,$3,'REG-A1','reg-a1','Register 1','active',$7,$7,1),
             ($4,$2,$3,'REG-A2','reg-a2','Register 2','active',$7,$7,1),
             ($5,$2,$6,'REG-B1','reg-b1','Register B1','active',$7,$7,1)`,
      [registerA1Id, companyId, branchAId, registerA2Id, registerBId, branchBId, ownerUserId],
    );

    const ownerRoleId = randomUUID();
    const managerRoleId = randomUUID();
    const cashierRoleId = randomUUID();
    // TASK 16.16 §2/§11 — the "Cashier" role below is created FROM the
    // Cashier template's own permission set, exactly the way the real
    // admin UI would (template → POST /roles → PUT /roles/{id}/
    // permissions) — proving a template-sourced role is an ordinary,
    // fully custom (`is_system=false`) role like any other, not a special
    // case. A generic code, deliberately never "cashier_snacks" or
    // anything tenant-specific.
    const cashierTemplate = roleTemplates.find((template) => template.key === 'cashier');
    if (cashierTemplate === undefined) throw new Error('cashier template missing');
    await database.pool.query(
      `insert into roles(id,company_id,name,code,status,is_system)
       values($1,$2,'Owner','owner','active',true),
             ($3,$2,'Manager','manager','active',false),
             ($4,$2,'Register Operator','register_operator','active',false)`,
      [ownerRoleId, companyId, managerRoleId, cashierRoleId],
    );
    const permissionRows = await database.pool.query<{ id: string; code: string }>(
      `select id,code from permissions where code = any($1::text[])`,
      [cashierTemplate.permissionCodes],
    );
    if (permissionRows.rows.length !== cashierTemplate.permissionCodes.length)
      throw new Error('Cashier template references a permission code missing from the seeded catalogue.');
    await database.pool.query(
      `insert into role_permissions(company_id,role_id,permission_id,effect)
       select $1,$2,id,'allow' from permissions where code = any($3::text[])`,
      [companyId, cashierRoleId, cashierTemplate.permissionCodes],
    );
    await database.pool.query(
      `insert into role_permissions(company_id,role_id,permission_id,effect)
       select $1,$2,id,'allow' from permissions where code in
       ('cash_register.read','cash_register.manage','cash_session.read','cash_session.open','cash_movement.create',
        'cash_session.close','branch_access.manage','sale.create','sale.read','branch.read')`,
      [companyId, managerRoleId],
    );
    // Owner: company-wide (branch_id null), every permission.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,null,'active')`,
      [randomUUID(), companyId, ownerMembershipId, ownerRoleId],
    );
    await database.pool.query(
      `insert into role_permissions(company_id,role_id,permission_id,effect) select $1,$2,id,'allow' from permissions`,
      [companyId, ownerRoleId],
    );
    // Manager: branch-scoped to BOTH branches (two rows).
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values
        ($1,$2,$3,$4,$5,'active'),($6,$2,$3,$4,$7,'active')`,
      [randomUUID(), companyId, managerMembershipId, managerRoleId, branchAId, randomUUID(), branchBId],
    );
    // User A / User B: branch-scoped to Branch A only.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values
        ($1,$2,$3,$4,$5,'active'),($6,$2,$7,$4,$5,'active')`,
      [randomUUID(), companyId, userAMembershipId, cashierRoleId, branchAId, randomUUID(), userBMembershipId],
    );

    // user_branch_access rows (a real membership needs at least an
    // implicit or explicit branch grant for `permittedBranchIds` to
    // include it — the `user_roles` branch scoping above already grants
    // this per `resolveContext`'s own query, which unions `user_roles`
    // and `user_branch_access` — no separate `user_branch_access` insert
    // is required here since every membership above already has a
    // branch-scoped `user_roles` row for exactly the branch(es) intended).

    // Register-level narrowing: User A → Register 1 only, User B →
    // Register 2 only, Manager → both (direct grants for both registers).
    await database.pool.query(
      `insert into user_register_access(id,company_id,membership_id,user_id,branch_id,cash_register_id,status) values
        ($1,$2,$3,$4,$5,$6,'active')`,
      [randomUUID(), companyId, userAMembershipId, userAId, branchAId, registerA1Id],
    );
    await database.pool.query(
      `insert into user_register_access(id,company_id,membership_id,user_id,branch_id,cash_register_id,status) values
        ($1,$2,$3,$4,$5,$6,'active')`,
      [randomUUID(), companyId, userBMembershipId, userBId, branchAId, registerA2Id],
    );
    await database.pool.query(
      `insert into user_register_access(id,company_id,membership_id,user_id,branch_id,cash_register_id,status) values
        ($1,$2,$3,$4,$5,$6,'active'),($7,$2,$3,$4,$8,$9,'active')`,
      [randomUUID(), companyId, managerMembershipId, managerUserId, branchAId, registerA1Id, randomUUID(), branchAId, registerA2Id],
    );
  });

  afterAll(async () => {
    const companyIds = [companyId, otherCompanyId];
    await database.pool.query('delete from user_register_access where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from user_roles where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from role_permissions where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from roles where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from cash_registers where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[ownerUserId, managerUserId, userAId, userBId]]);
    await database.close();
  });

  describe('§7 — multi-register user: User A / User B / Manager / Owner', () => {
    it('User A resolves to exactly Register 1; User B resolves to exactly Register 2', async () => {
      const userA = await authRepository.resolveContext({
        userId: userAId,
        membershipId: userAMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(userA?.permittedRegisterIds).toEqual([registerA1Id]);

      const userB = await authRepository.resolveContext({
        userId: userBId,
        membershipId: userBMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(userB?.permittedRegisterIds).toEqual([registerA2Id]);
    });

    it('Manager resolves to both registers; Owner is unrestricted (null)', async () => {
      const manager = await authRepository.resolveContext({
        userId: managerUserId,
        membershipId: managerMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect([...(manager?.permittedRegisterIds ?? [])].sort()).toEqual([registerA1Id, registerA2Id].sort());

      const owner = await authRepository.resolveContext({ userId: ownerUserId, membershipId: ownerMembershipId, companyId });
      expect(owner?.permittedRegisterIds ?? null).toBeNull();
    });

    it('direct API-level tampering: User A is rejected for Register 2 by the actual enforcement point, even supplying its id directly', async () => {
      const userA = await authRepository.resolveContext({
        userId: userAId,
        membershipId: userAMembershipId,
        companyId,
        branchId: branchAId,
      });
      if (userA === null) throw new Error('unreachable');
      const context = asAuthContext(userA);
      expect(() => authService.requireRegisterAccess(context, registerA2Id)).toThrow(
        expect.objectContaining({ code: 'register_scope_mismatch', statusCode: 403 }),
      );
      // Its own register is still fine — the guard isn't blanket-rejecting.
      expect(() => authService.requireRegisterAccess(context, registerA1Id)).not.toThrow();
    });

    it('direct API-level tampering: User B is rejected for Register 1', async () => {
      const userB = await authRepository.resolveContext({
        userId: userBId,
        membershipId: userBMembershipId,
        companyId,
        branchId: branchAId,
      });
      if (userB === null) throw new Error('unreachable');
      expect(() => authService.requireRegisterAccess(asAuthContext(userB), registerA1Id)).toThrow(
        expect.objectContaining({ code: 'register_scope_mismatch' }),
      );
    });

    it('Manager and Owner are never rejected for either register', async () => {
      const manager = await authRepository.resolveContext({
        userId: managerUserId,
        membershipId: managerMembershipId,
        companyId,
        branchId: branchAId,
      });
      const owner = await authRepository.resolveContext({ userId: ownerUserId, membershipId: ownerMembershipId, companyId });
      if (manager === null || owner === null) throw new Error('unreachable');
      const managerContext = asAuthContext(manager);
      const ownerContext = asAuthContext(owner);
      for (const registerId of [registerA1Id, registerA2Id]) {
        expect(() => authService.requireRegisterAccess(managerContext, registerId)).not.toThrow();
        expect(() => authService.requireRegisterAccess(ownerContext, registerId)).not.toThrow();
      }
    });
  });

  describe('§8 — cross-branch: a register grant never overrides a branch restriction', () => {
    it('User A (Branch A only) never resolves Branch B in permittedBranchIds, regardless of any register grant', async () => {
      const userA = await authRepository.resolveContext({
        userId: userAId,
        membershipId: userAMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(userA?.permittedBranchIds).toEqual([branchAId]);
    });

    it('Manager sees both branches; Owner sees every active branch', async () => {
      const manager = await authRepository.resolveContext({
        userId: managerUserId,
        membershipId: managerMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect([...(manager?.permittedBranchIds ?? [])].sort()).toEqual([branchAId, branchBId].sort());

      const owner = await authRepository.resolveContext({ userId: ownerUserId, membershipId: ownerMembershipId, companyId });
      // Every active branch in THIS company — never `otherCompanyBranchId`,
      // which belongs to a different tenant entirely.
      expect([...(owner?.permittedBranchIds ?? [])].sort()).toEqual([branchAId, branchBId].sort());
      expect(owner?.permittedBranchIds).not.toContain(otherCompanyBranchId);
    });

    it('regression: a stale register grant for a branch the membership no longer has ANY access to grants no usable access', async () => {
      // A brand-new membership, granted Branch A access AND a register
      // grant for Branch A — then the branch-level `user_roles` row is
      // revoked (simulating an admin later removing branch access) while
      // the OLD `user_register_access` row is deliberately left behind,
      // untouched — exactly the "stale/orphan grant" scenario TASK 16.16
      // §8 calls out.
      const staleUserId = randomUUID();
      const staleMembershipId = randomUUID();
      const staleUserRoleId = randomUUID();
      await database.pool.query(
        `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'QA Stale Grant','active')`,
        [staleUserId, `stale-${staleUserId}@example.test`],
      );
      await database.pool.query(
        `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
        [staleMembershipId, companyId, staleUserId],
      );
      const registerOperatorRole = await database.pool.query<{ id: string }>(
        `select id from roles where company_id=$1 and code='register_operator'`,
        [companyId],
      );
      const roleId = registerOperatorRole.rows[0]?.id;
      if (roleId === undefined) throw new Error('unreachable');
      await database.pool.query(
        `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,$5,'active')`,
        [staleUserRoleId, companyId, staleMembershipId, roleId, branchAId],
      );
      await database.pool.query(
        `insert into user_register_access(id,company_id,membership_id,user_id,branch_id,cash_register_id,status) values($1,$2,$3,$4,$5,$6,'active')`,
        [randomUUID(), companyId, staleMembershipId, staleUserId, branchAId, registerA1Id],
      );

      // Sanity: before revocation, this membership genuinely resolves the
      // register — proving the grant really was live, not a no-op fixture.
      const before = await authRepository.resolveContext({
        userId: staleUserId,
        membershipId: staleMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(before?.permittedRegisterIds).toEqual([registerA1Id]);
      expect(before?.permittedBranchIds).toEqual([branchAId]);

      // Revoke Branch A access itself — the `user_register_access` row is
      // deliberately left active/untouched (the realistic "orphan" case:
      // an admin revoked branch access but the narrower register grant
      // was never separately cleaned up).
      await database.pool.query(
        `update user_roles set status='revoked', revoked_at=now() where id=$1`,
        [staleUserRoleId],
      );

      const after = await authRepository.resolveContext({
        userId: staleUserId,
        membershipId: staleMembershipId,
        companyId,
      });
      // No branch access at all now.
      expect(after?.permittedBranchIds).toEqual([]);
      // And critically: the stale register_access row grants NO usable
      // register — `permittedRegisterIds` is either null (no branches to
      // even search within) or an empty array; either way, Register 1
      // must never appear.
      expect(after?.permittedRegisterIds ?? []).not.toContain(registerA1Id);

      // Belt-and-suspenders: even asking for Branch A explicitly (the
      // branch the stale grant still names) is rejected outright, because
      // the membership no longer has ANY access to that branch —
      // `resolveContext` returns `null` for an unauthorized explicit
      // branch, exactly like requesting a branch never granted at all.
      const explicitBranchA = await authRepository.resolveContext({
        userId: staleUserId,
        membershipId: staleMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(explicitBranchA).toBeNull();

      await database.pool.query('delete from user_register_access where membership_id=$1', [staleMembershipId]);
      await database.pool.query('delete from user_roles where id=$1', [staleUserRoleId]);
      await database.pool.query('delete from company_memberships where id=$1', [staleMembershipId]);
      await database.pool.query('delete from users where id=$1', [staleUserId]);
    });
  });

  describe('§11 — permission/scope changes reflected correctly, live, on the very next request', () => {
    it('narrowing a previously-unrestricted membership takes effect on the next resolveContext call — no logout, no cache', async () => {
      const freshUserId = randomUUID();
      const freshMembershipId = randomUUID();
      await database.pool.query(
        `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'QA Fresh Grant','active')`,
        [freshUserId, `fresh-${freshUserId}@example.test`],
      );
      await database.pool.query(
        `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
        [freshMembershipId, companyId, freshUserId],
      );
      const registerOperatorRole = await database.pool.query<{ id: string }>(
        `select id from roles where company_id=$1 and code='register_operator'`,
        [companyId],
      );
      const roleId = registerOperatorRole.rows[0]?.id;
      if (roleId === undefined) throw new Error('unreachable');
      await database.pool.query(
        `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,$5,'active')`,
        [randomUUID(), companyId, freshMembershipId, roleId, branchAId],
      );

      const beforeGrant = await authRepository.resolveContext({
        userId: freshUserId,
        membershipId: freshMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(beforeGrant?.permittedRegisterIds ?? null).toBeNull(); // unrestricted — zero grant rows.

      const grantId = randomUUID();
      await database.pool.query(
        `insert into user_register_access(id,company_id,membership_id,user_id,branch_id,cash_register_id,status) values($1,$2,$3,$4,$5,$6,'active')`,
        [grantId, companyId, freshMembershipId, freshUserId, branchAId, registerA1Id],
      );

      const afterGrant = await authRepository.resolveContext({
        userId: freshUserId,
        membershipId: freshMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(afterGrant?.permittedRegisterIds).toEqual([registerA1Id]); // narrowed immediately.

      await database.pool.query(`update user_register_access set status='revoked', revoked_at=now() where id=$1`, [grantId]);

      const afterRevoke = await authRepository.resolveContext({
        userId: freshUserId,
        membershipId: freshMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(afterRevoke?.permittedRegisterIds ?? null).toBeNull(); // back to unrestricted immediately.

      await database.pool.query('delete from user_register_access where membership_id=$1', [freshMembershipId]);
      await database.pool.query('delete from user_roles where membership_id=$1', [freshMembershipId]);
      await database.pool.query('delete from company_memberships where id=$1', [freshMembershipId]);
      await database.pool.query('delete from users where id=$1', [freshUserId]);
    });
  });

  describe('§2/§11 — custom-role-from-template safety', () => {
    it('the template-sourced "Register Operator" role never auto-widens when a brand-new permission is introduced — syncSystemRolePermissions only ever touches is_system roles', async () => {
      const newPermissionCode = `qa_workspace_test.x${randomUUID().replaceAll('-', '')}`;
      const newPermissionId = randomUUID();
      await database.pool.query(
        `insert into permissions(id,code,description,domain) values($1,$2,'QA-only synthetic permission for this test.','qa_workspace_test')`,
        [newPermissionId, newPermissionCode],
      );

      const before = await database.pool.query<{ code: string }>(
        `select p.code from role_permissions rp join permissions p on p.id=rp.permission_id
         join roles r on r.id=rp.role_id where r.company_id=$1 and r.code='register_operator' and p.code=$2`,
        [companyId, newPermissionCode],
      );
      expect(before.rows).toHaveLength(0);

      await syncSystemRolePermissions(database.db);

      const after = await database.pool.query<{ code: string }>(
        `select p.code from role_permissions rp join permissions p on p.id=rp.permission_id
         join roles r on r.id=rp.role_id where r.company_id=$1 and r.code='register_operator' and p.code=$2`,
        [companyId, newPermissionCode],
      );
      expect(after.rows).toHaveLength(0); // still never granted — a custom role is never auto-widened.

      const ownerAfter = await database.pool.query<{ code: string }>(
        `select p.code from role_permissions rp join permissions p on p.id=rp.permission_id
         join roles r on r.id=rp.role_id where r.company_id=$1 and r.code='owner' and p.code=$2`,
        [companyId, newPermissionCode],
      );
      expect(ownerAfter.rows).toHaveLength(1); // the is_system Owner role DOES pick it up.

      await database.pool.query('delete from role_permissions where permission_id=$1', [newPermissionId]);
      await database.pool.query('delete from permissions where id=$1', [newPermissionId]);
    });

    it('the self-escalation guard rejects granting the Manager role permissions the acting admin does not itself hold', async () => {
      const managerRole = await database.pool.query<{ id: string }>(`select id from roles where company_id=$1 and code='manager'`, [
        companyId,
      ]);
      const permission = await database.pool.query<{ id: string }>(`select id from permissions where code='company.update'`);
      const managerRoleId = managerRole.rows[0]?.id;
      const permissionId = permission.rows[0]?.id;
      if (managerRoleId === undefined || permissionId === undefined) throw new Error('unreachable');

      // User A's own permission set (the Cashier/Register Operator
      // template) never includes `company.update` — so acting as User A,
      // trying to grant the Manager role that permission must be refused.
      const userAContext = {
        userId: userAId,
        membershipId: userAMembershipId,
        companyId,
        branchId: branchAId,
        sessionId: 'qa-session',
        expiresAt: new Date(Date.now() + 60_000),
        permissions: ['cash_session.open', 'sale.create'],
        permittedBranchIds: [branchAId],
      };
      await expect(
        administration.replaceRolePermissions(
          { context: userAContext, requestId: 'qa-req', correlationId: 'qa-corr' },
          managerRoleId,
          [{ permissionId, effect: 'allow' }],
        ),
      ).rejects.toMatchObject({ code: 'permission_denied' });
    });
  });

  describe('§28/§31 — tenant isolation', () => {
    it('another tenant cannot resolve any of this tenant\'s register/branch scope, even with the exact ids', async () => {
      const otherUserId = randomUUID();
      const otherMembershipId = randomUUID();
      await database.pool.query(
        `insert into users(id,email,normalized_email,display_name,status) values($1,$2,$2,'QA Other Tenant User','active')`,
        [otherUserId, `other-${otherUserId}@example.test`],
      );
      await database.pool.query(
        `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
        [otherMembershipId, otherCompanyId, otherUserId],
      );
      // Same membership id namespace, wrong company — must resolve to
      // nothing, never leak Branch A/Register 1's existence.
      const crossTenant = await authRepository.resolveContext({
        userId: userAId,
        membershipId: userAMembershipId,
        companyId: otherCompanyId,
        branchId: branchAId,
      });
      expect(crossTenant).toBeNull();

      await database.pool.query('delete from company_memberships where id=$1', [otherMembershipId]);
      await database.pool.query('delete from users where id=$1', [otherUserId]);
    });
  });
});
