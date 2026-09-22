import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, roleTemplates, seedTechnicalPermissions, type DatabaseClient } from '@asone/database';

import { AuthService } from '../auth/auth.service.js';
import { PostgresAuthRepository } from '../auth/auth.repository.js';
import { AuthTokens } from '../auth/auth.tokens.js';
import { AdminRepository } from './shared/admin.repository.js';
import { AdministrationService } from './shared/admin.service.js';
import type { AdminActor } from './shared/admin.types.js';

/** TASK 16.18 — "Administrador de pruebas" (internal beta tester): the safe
 * commercial pattern that lets an Owner grant a trusted internal tester
 * their OWN real login, broad operational visibility, and a hard boundary
 * against tenant/platform-compromising capabilities and self-escalation —
 * built entirely on the EXISTING role/permission/branch/register
 * architecture (TASK 16.5/16.15/16.16), never a parallel authorization
 * system.
 *
 * This file certifies exactly what is NEW in this task:
 *   1. the "beta_tester" template's real, DB-resolved effective permission
 *      set (never merely the static template file — see
 *      `role-templates.test.ts` for that layer);
 *   2. branch/register scope enforcement for a beta-tester-permissioned
 *      user, reusing `user_branch_access`/`user_register_access` exactly
 *      like any other role (never a beta-specific scope mechanism);
 *   3. the three centrally-fixed Owner/system-role protections
 *      (`assignRole`/`revokeRoleAssignment`/`updateMembership` now all
 *      refuse to touch an `is_system` role or its holder);
 *   4. self-escalation protection for the beta tester specifically;
 *   5. immediate lockout on deactivation.
 *
 * Deliberately does NOT re-prove ground `admin.integration.test.ts`
 * already covers generically (self-escalation via `role.assign`/
 * `role.permission.manage`, tenant isolation, audit/outbox commit
 * behavior) or `workspace-scope.integration.test.ts` already covers
 * generically (register-scope intersection mechanics, stale-grant
 * handling, live-freshness on `resolveContext`). */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('Beta tester access — "Administrador de pruebas" (TASK 16.18)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let authRepository: PostgresAuthRepository;
  let authService: AuthService;
  let administration: AdministrationService;

  const companyId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  const registerA1Id = randomUUID();
  const registerA2Id = randomUUID();

  const ownerUserId = randomUUID();
  let betaUserId: string;
  let ownerMembershipId: string;
  let betaMembershipId: string;
  let ownerRoleId: string;
  let betaRoleId: string;

  let ownerActor: AdminActor;

  const betaTemplate = roleTemplates.find((template) => template.key === 'beta_tester');
  if (betaTemplate === undefined) throw new Error('beta_tester template missing from role-templates.ts');

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({
      connectionString: databaseUrl,
      applicationName: 'asone-beta-tester-access-integration',
    });
    authRepository = new PostgresAuthRepository(database);
    authService = new AuthService({
      repository: authRepository,
      tokens: new AuthTokens({
        audience: 'asone-beta-tester-test',
        issuer: 'https://api.test.asone.mx',
        secret: 'test-secret-that-is-at-least-32-characters',
        ttlSeconds: 300,
      }),
      dummyPasswordHash: 'x'.repeat(60),
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3_600,
    });
    administration = new AdministrationService(new AdminRepository(database), authService);

    // Self-contained on purpose — this suite must not assume some OTHER
    // test file already seeded (and, critically, never later truncated)
    // the approved permission catalogue in the shared test database.
    // `seedTechnicalPermissions` is the same idempotent (`ON CONFLICT DO
    // NOTHING`) function the real `db:seed` step runs in every
    // environment — safe to call unconditionally here regardless of
    // what state other integration suites left the table in.
    await seedTechnicalPermissions(database.db);

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'QA Beta Co','QA Beta Co',$2,'active','America/Mexico_City','MXN','es-MX')`,
      [companyId, `qa-beta-co-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Branch A','BRA','active','America/Mexico_City'),
             ($3,$2,'Branch B','BRB','active','America/Mexico_City')`,
      [branchAId, companyId, branchBId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'QA Owner','active')`,
      [ownerUserId, `owner-${ownerUserId}@example.test`],
    );
    ownerMembershipId = randomUUID();
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [ownerMembershipId, companyId, ownerUserId],
    );
    await database.pool.query(
      `insert into cash_registers(id,company_id,branch_id,code,normalized_code,name,status,created_by,updated_by,version)
       values($1,$2,$3,'REG-A1','reg-a1','Register 1','active',$5,$5,1),
             ($4,$2,$3,'REG-A2','reg-a2','Register 2','active',$5,$5,1)`,
      [registerA1Id, companyId, branchAId, registerA2Id, ownerUserId],
    );
    ownerRoleId = randomUUID();
    await database.pool.query(
      `insert into roles(id,company_id,name,code,status,is_system) values($1,$2,'Owner','owner','active',true)`,
      [ownerRoleId, companyId],
    );
    await database.pool.query(
      `insert into role_permissions(company_id,role_id,permission_id,effect) select $1,$2,id,'allow' from permissions`,
      [companyId, ownerRoleId],
    );
    // Owner: company-wide (branch_id null).
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,null,'active')`,
      [randomUUID(), companyId, ownerMembershipId, ownerRoleId],
    );
    const ownerPermissions = await database.pool.query<{ code: string }>(`select code from permissions`);
    ownerActor = {
      context: {
        userId: ownerUserId,
        membershipId: ownerMembershipId,
        companyId,
        branchId: undefined,
        sessionId: 'qa-owner-session',
        expiresAt: new Date(Date.now() + 60_000),
        permissions: ownerPermissions.rows.map((row) => row.code),
        permittedBranchIds: [branchAId, branchBId],
        permittedRegisterIds: null,
        companyWideAccess: true,
      },
      requestId: 'qa-request',
      correlationId: 'qa-correlation',
    };
  });

  afterAll(async () => {
    await database.pool.query('delete from outbox_events where company_id=$1', [companyId]);
    await database.pool.query('delete from audit_log where company_id=$1', [companyId]);
    await database.pool.query('delete from user_register_access where company_id=$1', [companyId]);
    await database.pool.query('delete from user_roles where company_id=$1', [companyId]);
    await database.pool.query('delete from role_permissions where company_id=$1', [companyId]);
    await database.pool.query('delete from roles where company_id=$1', [companyId]);
    await database.pool.query('delete from user_branch_access where company_id=$1', [companyId]);
    await database.pool.query('delete from cash_registers where company_id=$1', [companyId]);
    await database.pool.query('delete from company_memberships where company_id=$1', [companyId]);
    await database.pool.query('delete from branches where company_id=$1', [companyId]);
    await database.pool.query('delete from companies where id=$1', [companyId]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [[ownerUserId, betaUserId]]);
    await database.close();
  });

  it(
    'the Owner creates a beta tester through the REAL commercial flow — Nuevo usuario → role template → ' +
      'branch access → activate — never a hardcoded/parallel mechanism',
    async () => {
      // Step 1: "Nuevo usuario" — email/name only, invited, no password yet.
      const created = await administration.createUser(ownerActor, {
        email: `beta.tester-${randomUUID()}@example.test`,
        displayName: 'QA Beta Tester',
      });
      betaUserId = String(created.id);
      betaMembershipId = String(created.membership_id);

      // Step 2: activate with a real password (the existing, only password-
      // provisioning mechanism this codebase has — TASK 16.18 Phase 9).
      // `assignRole`/`changeBranchAccess` both require an already-active
      // membership (see their own "The membership is not active." guard),
      // so — matching the real backend's own required order — activation
      // happens before role/branch assignment, not after.
      await administration.updateMembership(ownerActor, betaUserId, 'active', 'Cor-recto-Batalla-9!');

      // Step 3: the Owner creates a role FROM the "beta_tester" template —
      // the exact real `POST /roles` + `PUT /roles/{id}/permissions` flow
      // the Flutter role-creation dialog already drives (TASK 16.16).
      const role = await administration.createRole(ownerActor, {
        name: betaTemplate.label,
        code: 'beta_tester',
        description: betaTemplate.description,
      });
      betaRoleId = String(role.id);
      const permissionRows = await database.pool.query<{ id: string }>(
        `select id from permissions where code = any($1::text[])`,
        [betaTemplate.permissionCodes],
      );
      expect(permissionRows.rows.length).toBe(betaTemplate.permissionCodes.length);
      await administration.replaceRolePermissions(
        ownerActor,
        betaRoleId,
        permissionRows.rows.map((row) => ({ permissionId: row.id, effect: 'allow' as const })),
      );

      // Step 4: assign the role, scoped to Branch A only (never company-wide).
      await administration.assignRole(ownerActor, betaUserId, {
        roleId: betaRoleId,
        branchId: branchAId,
      });

      // Step 5: grant explicit branch access to Branch A only — the Owner
      // decides scope, never the tester (TASK 16.18 Phase 6).
      await administration.changeBranchAccess(ownerActor, betaUserId, branchAId, {
        status: 'active',
        isDefault: true,
      });

      const detail = await administration.userDetail(ownerActor, betaUserId, ['roles', 'branches']);
      expect(detail.identity_status).toBe('active');
      expect(detail.membership_status).toBe('active');
    },
  );

  it("the beta tester's REAL resolved permission set is exactly the beta_tester template — fail-closed, never widened", async () => {
    const resolved = await authRepository.resolveContext({
      userId: betaUserId,
      membershipId: betaMembershipId,
      companyId,
      branchId: branchAId,
    });
    expect(resolved).not.toBeNull();
    expect([...(resolved?.permissions ?? [])].sort()).toEqual([...betaTemplate.permissionCodes].sort());
  });

  it('the beta tester never receives ANY tenant/platform-compromising permission, even after resolution through real roles/role_permissions', async () => {
    const resolved = await authRepository.resolveContext({
      userId: betaUserId,
      membershipId: betaMembershipId,
      companyId,
      branchId: branchAId,
    });
    const forbidden = [
      'company.update',
      'company_settings.update',
      'user.create',
      'user.update',
      'role.create',
      'role.update',
      'role.permission.manage',
      'role.assign',
      'branch_access.manage',
      'device.register',
      'device.revoke',
      'branch.create',
      'branch.update',
    ];
    for (const code of forbidden) expect(resolved?.permissions ?? []).not.toContain(code);
  });

  it('branch scope is enforced: the beta tester resolves to Branch A only — never Branch B', async () => {
    const resolved = await authRepository.resolveContext({
      userId: betaUserId,
      membershipId: betaMembershipId,
      companyId,
    });
    expect(resolved?.permittedBranchIds).toEqual([branchAId]);
    expect(resolved?.companyWideAccess).toBe(false);
  });

  it('a direct-ID request for the unauthorized branch (Branch B) is rejected server-side, not merely hidden in the UI', async () => {
    const resolved = await authRepository.resolveContext({
      userId: betaUserId,
      membershipId: betaMembershipId,
      companyId,
    });
    expect(resolved).not.toBeNull();
    const fullContext = { ...resolved!, sessionId: 'qa-beta-session', expiresAt: new Date(Date.now() + 60_000) };
    expect(() => authService.requireBranchAccess(fullContext, branchBId)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
    // Branch A, the one it actually holds, is never rejected.
    expect(() => authService.requireBranchAccess(fullContext, branchAId)).not.toThrow();
  });

  it(
    'register scope reuses the exact TASK 16.15 semantics: no register grant means unrestricted within the allowed ' +
      'branch (broad QA access), a real grant narrows it — never a beta-specific scope mechanism',
    async () => {
      const beforeGrant = await authRepository.resolveContext({
        userId: betaUserId,
        membershipId: betaMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(beforeGrant?.permittedRegisterIds).toBeNull();

      await administration.grantRegisterAccess(ownerActor, betaUserId, branchAId, {
        cashRegisterId: registerA1Id,
      });
      const afterGrant = await authRepository.resolveContext({
        userId: betaUserId,
        membershipId: betaMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(afterGrant?.permittedRegisterIds).toEqual([registerA1Id]);
      expect(afterGrant?.permittedRegisterIds).not.toContain(registerA2Id);

      // Clean up so later tests see the pre-narrowed (unrestricted) state.
      const registerAccessRows = await administration.listRegisterAccess(ownerActor, betaUserId);
      for (const row of registerAccessRows) await administration.revokeRegisterAccess(ownerActor, String(row.id));
    },
  );

  it('the beta tester cannot open user/role administration at all — every admin.service.ts capability is denied server-side', async () => {
    const resolved = await authRepository.resolveContext({
      userId: betaUserId,
      membershipId: betaMembershipId,
      companyId,
      branchId: branchAId,
    });
    const betaActor: AdminActor = {
      context: { ...resolved!, sessionId: 'qa-beta-session', expiresAt: new Date(Date.now() + 60_000) },
      requestId: 'qa-request',
      correlationId: 'qa-correlation',
    };
    await expect(administration.listUsers(betaActor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      administration.createUser(betaActor, { email: 'puppet@example.test', displayName: 'Puppet' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(administration.listRoles(betaActor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      administration.assignRole(betaActor, betaUserId, { roleId: betaRoleId }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      administration.changeBranchAccess(betaActor, betaUserId, branchBId, { status: 'active', isDefault: false }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      administration.updateMembership(betaActor, betaUserId, 'suspended'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it(
    'self-escalation is blocked: even a HYPOTHETICAL actor who holds role.assign cannot assign the beta tester ' +
      '(or themselves) a role carrying more than the beta_tester permission set already grants',
    async () => {
      // A stronger role — Manager-tier — carrying `inventory.approve` plus
      // `branch_access.manage`, a permission the beta_tester template never
      // grants (see role-templates.test.ts's own dedicated exclusion test).
      const strongerRole = await administration.createRole(ownerActor, {
        name: 'Stronger Than Beta',
        code: 'stronger-than-beta',
      });
      const strongerPermissionRows = await database.pool.query<{ id: string }>(
        `select id from permissions where code = any($1::text[])`,
        [['inventory.read', 'branch_access.manage']],
      );
      await administration.replaceRolePermissions(
        ownerActor,
        String(strongerRole.id),
        strongerPermissionRows.rows.map((row) => ({ permissionId: row.id, effect: 'allow' as const })),
      );
      // An actor limited to EXACTLY the beta_tester permission set, plus
      // `role.assign` itself (the minimum needed to even attempt the
      // escalation) — mirrors `admin.integration.test.ts`'s own
      // established self-escalation-guard test shape.
      const resolved = await authRepository.resolveContext({
        userId: betaUserId,
        membershipId: betaMembershipId,
        companyId,
        branchId: branchAId,
      });
      const limitedBetaAssigner: AdminActor = {
        context: {
          ...resolved!,
          permissions: [...(resolved?.permissions ?? []), 'role.assign'],
          sessionId: 'qa-beta-session',
          expiresAt: new Date(Date.now() + 60_000),
        },
        requestId: 'qa-request',
        correlationId: 'qa-correlation',
      };
      await expect(
        administration.assignRole(limitedBetaAssigner, betaUserId, { roleId: String(strongerRole.id) }),
      ).rejects.toMatchObject({ code: 'permission_denied', statusCode: 403 });
      // Cleanup.
      await database.pool.query('delete from role_permissions where role_id=$1', [strongerRole.id]);
      await database.pool.query('delete from roles where id=$1', [strongerRole.id]);
    },
  );

  it('the beta tester cannot become Owner: assignRole refuses to attach the is_system Owner role through this endpoint, even to an actor holding every permission it grants', async () => {
    await expect(
      administration.assignRole(ownerActor, betaUserId, { roleId: ownerRoleId }),
    ).rejects.toMatchObject({ code: 'permission_denied', statusCode: 403 });
  });

  it('the Owner cannot be demoted: revokeRoleAssignment refuses to revoke an is_system role assignment through this endpoint', async () => {
    const ownerAssignments = await administration.listRoleAssignments(ownerActor, ownerUserId);
    const ownerAssignment = ownerAssignments.find((row) => row.role_code === 'owner');
    expect(ownerAssignment).toBeDefined();
    await expect(
      administration.revokeRoleAssignment(ownerActor, ownerUserId, String(ownerAssignment!.id)),
    ).rejects.toMatchObject({ code: 'permission_denied', statusCode: 403 });
    // The assignment is provably untouched — still active.
    const stillActive = await administration.listRoleAssignments(ownerActor, ownerUserId);
    expect(stillActive.find((row) => row.role_code === 'owner')?.status).toBe('active');
  });

  it('the Owner cannot be disabled: updateMembership refuses to suspend/disable a user holding an is_system role', async () => {
    await expect(
      administration.updateMembership(ownerActor, ownerUserId, 'suspended'),
    ).rejects.toMatchObject({ code: 'permission_denied', statusCode: 403 });
    await expect(
      administration.updateMembership(ownerActor, ownerUserId, 'disabled'),
    ).rejects.toMatchObject({ code: 'permission_denied', statusCode: 403 });
    // Untouched — still an active membership.
    const detail = await administration.userDetail(ownerActor, ownerUserId, []);
    expect(detail.membership_status).toBe('active');
  });

  it('cannot bypass Owner protection by targeting the Owner role/user via a different, unrelated actor who happens to hold full permissions', async () => {
    // A second "Administrador"-tier actor (full permission set, but
    // is_system=false) — exactly the population TASK 16.18 §1 forensic
    // audit found could otherwise reach the Owner role via `assignRole`
    // before this task's central fix.
    const secondAdminUserId = randomUUID();
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'QA Second Admin','active')`,
      [secondAdminUserId, `second-admin-${secondAdminUserId}@example.test`],
    );
    const secondAdminMembershipId = randomUUID();
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values($1,$2,$3,'active')`,
      [secondAdminMembershipId, companyId, secondAdminUserId],
    );
    const administratorTemplate = roleTemplates.find((template) => template.key === 'administrator');
    if (administratorTemplate === undefined) throw new Error('administrator template missing');
    const adminRole = await administration.createRole(ownerActor, {
      name: 'Administrador',
      code: 'administrator-2',
    });
    const adminPermissionRows = await database.pool.query<{ id: string }>(
      `select id from permissions where code = any($1::text[])`,
      [administratorTemplate.permissionCodes],
    );
    await administration.replaceRolePermissions(
      ownerActor,
      String(adminRole.id),
      adminPermissionRows.rows.map((row) => ({ permissionId: row.id, effect: 'allow' as const })),
    );
    await administration.assignRole(ownerActor, secondAdminUserId, { roleId: String(adminRole.id) });
    const secondAdminResolved = await authRepository.resolveContext({
      userId: secondAdminUserId,
      membershipId: secondAdminMembershipId,
      companyId,
    });
    const secondAdminActor: AdminActor = {
      context: { ...secondAdminResolved!, sessionId: 'qa-second-admin', expiresAt: new Date(Date.now() + 60_000) },
      requestId: 'qa-request',
      correlationId: 'qa-correlation',
    };
    // Even holding literally every permission the Owner role grants (the
    // Administrator template IS the full catalogue), this actor still
    // cannot attach the is_system Owner role to themselves.
    await expect(
      administration.assignRole(secondAdminActor, secondAdminUserId, { roleId: ownerRoleId }),
    ).rejects.toMatchObject({ code: 'permission_denied', statusCode: 403 });

    await database.pool.query('delete from user_roles where membership_id=$1', [secondAdminMembershipId]);
    await database.pool.query('delete from role_permissions where role_id=$1', [adminRole.id]);
    await database.pool.query('delete from roles where id=$1', [adminRole.id]);
    await database.pool.query('delete from company_memberships where id=$1', [secondAdminMembershipId]);
    await database.pool.query('delete from users where id=$1', [secondAdminUserId]);
  });

  it(
    'deactivation is immediate and server-side: once the Owner suspends the beta tester, the very next resolveContext ' +
      'call fails closed — no in-Flutter-only revocation, no lingering token-based access',
    async () => {
      await administration.updateMembership(ownerActor, betaUserId, 'suspended');
      const resolved = await authRepository.resolveContext({
        userId: betaUserId,
        membershipId: betaMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect(resolved).toBeNull();
      // The Owner's own account is completely unaffected by deactivating
      // someone else.
      const ownerStillResolves = await authRepository.resolveContext({
        userId: ownerUserId,
        membershipId: ownerMembershipId,
        companyId,
      });
      expect(ownerStillResolves).not.toBeNull();
      expect(ownerStillResolves?.companyWideAccess).toBe(true);
      // Reactivating restores exactly the same permission set (no drift,
      // no silent widening/narrowing merely from a suspend/reactivate
      // cycle).
      await administration.updateMembership(ownerActor, betaUserId, 'active');
      const reactivated = await authRepository.resolveContext({
        userId: betaUserId,
        membershipId: betaMembershipId,
        companyId,
        branchId: branchAId,
      });
      expect([...(reactivated?.permissions ?? [])].sort()).toEqual([...betaTemplate.permissionCodes].sort());
    },
  );

  it('every admin mutation the Owner performed while setting up the beta tester is attributed to the Owner\'s own user id in the audit log — never fabricated, never anonymous', async () => {
    const auditRows = await database.pool.query<{ actor_id: string; action: string }>(
      `select actor_id, action from audit_log where company_id=$1 and entity_id=$2 order by occurred_at`,
      [companyId, betaUserId],
    );
    expect(auditRows.rows.length).toBeGreaterThan(0);
    for (const row of auditRows.rows) expect(row.actor_id).toBe(ownerUserId);
  });
});
