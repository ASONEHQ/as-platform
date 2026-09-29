import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

import { AuthService } from './auth.service.js';
import { PostgresAuthRepository } from './auth.repository.js';
import { AuthTokens } from './auth.tokens.js';
import type { AuthContext } from './auth.types.js';

/** TASK 17.3 — certifies the exact multi-branch/multi-tenant authorization
 * matrix the task's own audit was asked to prove, using the task's own
 * actor names: Company A (branches A1/A2/A3) + Company B (branch B1),
 * OWNER_A/MANAGER_A1/REGIONAL_A/CASHIER_A2/OWNER_B. This is deliberately
 * NOT a duplicate of `workspace-scope.integration.test.ts` (TASK 16.16's
 * own generic User A/User B/Manager/Owner register-scope suite, which
 * already covers register-level narrowing and a 2-branch cross-branch
 * case) — this file's own value is the 3-branch company with a REGIONAL
 * actor holding exactly two of three branches (not all, not one), and the
 * exact named scenario set TASK 17.3 §22-24 asks to be proven:
 *   - OWNER_A sees every Company A branch, never Company B's.
 *   - MANAGER_A1 sees only A1; a crafted request for A2 or B1 is rejected
 *     by the real enforcement point (`AuthService.requireBranchAccess`),
 *     never merely "the UI didn't offer it".
 *   - REGIONAL_A can switch between A1 and A2 but never reach A3.
 *   - CASHIER_A2 cannot use A1.
 *   - OWNER_B cannot resolve into Company A at all, even supplying real
 *     Company A ids (the same crafted-companyId tamper technique
 *     `workspace-scope.integration.test.ts`'s own §28 tenant-isolation
 *     test already established).
 * Branch access here is granted the same way the real admin UI's
 * `_UserFormDialog`/`_AssignRoleDialog` do it — a branch-scoped `user_roles`
 * row per granted branch, `branch_id is null` for a company-wide grant —
 * never a second, invented authorization model. */
const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function asAuthContext(resolved: Omit<AuthContext, 'sessionId' | 'expiresAt'>): AuthContext {
  return { ...resolved, sessionId: 'qa-session', expiresAt: new Date(Date.now() + 60_000) };
}

integration('PostgreSQL multi-branch authorization matrix (TASK 17.3)', { concurrent: false }, () => {
  let database: DatabaseClient;
  let authRepository: PostgresAuthRepository;
  let authService: AuthService;

  const companyAId = randomUUID();
  const companyBId = randomUUID();
  const a1Id = randomUUID();
  const a2Id = randomUUID();
  const a3Id = randomUUID();
  const b1Id = randomUUID();

  const ownerAUserId = randomUUID();
  const managerA1UserId = randomUUID();
  const regionalAUserId = randomUUID();
  const cashierA2UserId = randomUUID();
  const ownerBUserId = randomUUID();

  let ownerAMembershipId: string;
  let managerA1MembershipId: string;
  let regionalAMembershipId: string;
  let cashierA2MembershipId: string;
  let ownerBMembershipId: string;

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-multi-branch-auth-integration' });
    authRepository = new PostgresAuthRepository(database);
    authService = new AuthService({
      repository: authRepository,
      tokens: new AuthTokens({
        audience: 'asone-multi-branch-auth-test',
        issuer: 'https://api.test.asone.mx',
        secret: 'test-secret-that-is-at-least-32-characters',
        ttlSeconds: 300,
      }),
      dummyPasswordHash: 'x'.repeat(60),
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3_600,
    });

    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'QA Company A','QA Company A',$2,'active','America/Mexico_City','MXN','es-MX'),
             ($3,'QA Company B','QA Company B',$4,'active','America/Mexico_City','MXN','es-MX')`,
      [companyAId, `qa-company-a-${companyAId}`, companyBId, `qa-company-b-${companyBId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'A1','A1','active','America/Mexico_City'),
             ($3,$2,'A2','A2','active','America/Mexico_City'),
             ($4,$2,'A3','A3','active','America/Mexico_City'),
             ($5,$6,'B1','B1','active','America/Mexico_City')`,
      [a1Id, companyAId, a2Id, a3Id, b1Id, companyBId],
    );
    await database.pool.query(
      `insert into users(id,email,normalized_email,display_name,status)
       values($1,$2,$2,'QA Owner A','active'),($3,$4,$4,'QA Manager A1','active'),
             ($5,$6,$6,'QA Regional A','active'),($7,$8,$8,'QA Cashier A2','active'),
             ($9,$10,$10,'QA Owner B','active')`,
      [
        ownerAUserId,
        `owner-a-${ownerAUserId}@example.test`,
        managerA1UserId,
        `manager-a1-${managerA1UserId}@example.test`,
        regionalAUserId,
        `regional-a-${regionalAUserId}@example.test`,
        cashierA2UserId,
        `cashier-a2-${cashierA2UserId}@example.test`,
        ownerBUserId,
        `owner-b-${ownerBUserId}@example.test`,
      ],
    );
    ownerAMembershipId = randomUUID();
    managerA1MembershipId = randomUUID();
    regionalAMembershipId = randomUUID();
    cashierA2MembershipId = randomUUID();
    ownerBMembershipId = randomUUID();
    await database.pool.query(
      `insert into company_memberships(id,company_id,user_id,status) values
        ($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$2,$7,'active'),($8,$2,$9,'active'),($10,$11,$12,'active')`,
      [
        ownerAMembershipId,
        companyAId,
        ownerAUserId,
        managerA1MembershipId,
        managerA1UserId,
        regionalAMembershipId,
        regionalAUserId,
        cashierA2MembershipId,
        cashierA2UserId,
        ownerBMembershipId,
        companyBId,
        ownerBUserId,
      ],
    );

    const ownerARoleId = randomUUID();
    const managerA1RoleId = randomUUID();
    const regionalARoleId = randomUUID();
    const cashierA2RoleId = randomUUID();
    const ownerBRoleId = randomUUID();
    await database.pool.query(
      `insert into roles(id,company_id,name,code,status,is_system) values
        ($1,$2,'Owner','owner','active',true),
        ($3,$2,'Gerente Sucursal','manager','active',false),
        ($4,$2,'Gerente Regional','regional_manager','active',false),
        ($5,$2,'Cajero','cashier','active',false),
        ($6,$7,'Owner','owner','active',true)`,
      [ownerARoleId, companyAId, managerA1RoleId, regionalARoleId, cashierA2RoleId, ownerBRoleId, companyBId],
    );

    // OWNER_A — company-wide (branch_id null): sees every Company A branch.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,null,'active')`,
      [randomUUID(), companyAId, ownerAMembershipId, ownerARoleId],
    );
    // MANAGER_A1 — scoped to A1 only.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,$5,'active')`,
      [randomUUID(), companyAId, managerA1MembershipId, managerA1RoleId, a1Id],
    );
    // REGIONAL_A — scoped to A1 and A2 (two rows), never A3.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values
        ($1,$2,$3,$4,$5,'active'),($6,$2,$3,$4,$7,'active')`,
      [randomUUID(), companyAId, regionalAMembershipId, regionalARoleId, a1Id, randomUUID(), a2Id],
    );
    // CASHIER_A2 — scoped to A2 only.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,$5,'active')`,
      [randomUUID(), companyAId, cashierA2MembershipId, cashierA2RoleId, a2Id],
    );
    // OWNER_B — company-wide within Company B only.
    await database.pool.query(
      `insert into user_roles(id,company_id,membership_id,role_id,branch_id,status) values($1,$2,$3,$4,null,'active')`,
      [randomUUID(), companyBId, ownerBMembershipId, ownerBRoleId],
    );
  });

  afterAll(async () => {
    const companyIds = [companyAId, companyBId];
    await database.pool.query('delete from user_roles where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from roles where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from company_memberships where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from branches where company_id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from companies where id=any($1::uuid[])', [companyIds]);
    await database.pool.query('delete from users where id=any($1::uuid[])', [
      [ownerAUserId, managerA1UserId, regionalAUserId, cashierA2UserId, ownerBUserId],
    ]);
    await database.close();
  });

  it('OWNER_A sees A1/A2/A3 and never B1', async () => {
    const owner = await authRepository.resolveContext({ userId: ownerAUserId, membershipId: ownerAMembershipId, companyId: companyAId });
    expect(owner?.companyWideAccess).toBe(true);
    expect([...(owner?.permittedBranchIds ?? [])].sort()).toEqual([a1Id, a2Id, a3Id].sort());
    expect(owner?.permittedBranchIds).not.toContain(b1Id);
  });

  it('MANAGER_A1 sees only A1 — a crafted request for A2 or B1 is rejected by the real enforcement point', async () => {
    const manager = await authRepository.resolveContext({
      userId: managerA1UserId,
      membershipId: managerA1MembershipId,
      companyId: companyAId,
      branchId: a1Id,
    });
    expect(manager?.permittedBranchIds).toEqual([a1Id]);
    if (manager === null) throw new Error('unreachable');
    const context = asAuthContext(manager);
    expect(() => {
      authService.requireBranchAccess(context, a1Id);
    }).not.toThrow();
    expect(() => {
      authService.requireBranchAccess(context, a2Id);
    }).toThrow(expect.objectContaining({ code: 'branch_scope_mismatch', statusCode: 403 }));
    expect(() => {
      authService.requireBranchAccess(context, b1Id);
    }).toThrow(expect.objectContaining({ code: 'branch_scope_mismatch' }));
    // Even resolving directly against B1 (simulating a crafted branch
    // switch request) must fail, not merely be unauthorized once resolved.
    const crossBranch = await authRepository.resolveContext({
      userId: managerA1UserId,
      membershipId: managerA1MembershipId,
      companyId: companyAId,
      branchId: b1Id,
    });
    expect(crossBranch).toBeNull();
  });

  it('REGIONAL_A can switch between A1 and A2 but can never reach A3', async () => {
    const regional = await authRepository.resolveContext({
      userId: regionalAUserId,
      membershipId: regionalAMembershipId,
      companyId: companyAId,
      branchId: a1Id,
    });
    expect([...(regional?.permittedBranchIds ?? [])].sort()).toEqual([a1Id, a2Id].sort());
    if (regional === null) throw new Error('unreachable');
    const context = asAuthContext(regional);
    expect(() => {
      authService.requireBranchAccess(context, a1Id);
    }).not.toThrow();
    expect(() => {
      authService.requireBranchAccess(context, a2Id);
    }).not.toThrow();
    expect(() => {
      authService.requireBranchAccess(context, a3Id);
    }).toThrow(expect.objectContaining({ code: 'branch_scope_mismatch' }));

    // The actual branch-switch resolution (re-authorization, not a client
    // flag) succeeds for A2, fails for A3.
    const switchedToA2 = await authRepository.resolveContext({
      userId: regionalAUserId,
      membershipId: regionalAMembershipId,
      companyId: companyAId,
      branchId: a2Id,
    });
    expect(switchedToA2?.permittedBranchIds).toContain(a2Id);
    const switchedToA3 = await authRepository.resolveContext({
      userId: regionalAUserId,
      membershipId: regionalAMembershipId,
      companyId: companyAId,
      branchId: a3Id,
    });
    expect(switchedToA3).toBeNull();
  });

  it('CASHIER_A2 cannot use A1', async () => {
    const cashier = await authRepository.resolveContext({
      userId: cashierA2UserId,
      membershipId: cashierA2MembershipId,
      companyId: companyAId,
      branchId: a2Id,
    });
    expect(cashier?.permittedBranchIds).toEqual([a2Id]);
    if (cashier === null) throw new Error('unreachable');
    const cashierContext = asAuthContext(cashier);
    expect(() => {
      authService.requireBranchAccess(cashierContext, a1Id);
    }).toThrow(expect.objectContaining({ code: 'branch_scope_mismatch' }));
    const crossBranch = await authRepository.resolveContext({
      userId: cashierA2UserId,
      membershipId: cashierA2MembershipId,
      companyId: companyAId,
      branchId: a1Id,
    });
    expect(crossBranch).toBeNull();
  });

  it('OWNER_B cannot see any Company A branch, even supplying real Company A ids directly', async () => {
    const ownerB = await authRepository.resolveContext({ userId: ownerBUserId, membershipId: ownerBMembershipId, companyId: companyBId });
    expect(ownerB?.permittedBranchIds).toEqual([b1Id]);
    expect(ownerB?.permittedBranchIds).not.toContain(a1Id);

    // Crafted tamper: OWNER_B's real user id + real membership id, but
    // Company A's id — the same technique `workspace-scope.integration.
    // test.ts`'s own §28 tenant-isolation test already established. Must
    // resolve to nothing, never leak Company A's existence.
    const tampered = await authRepository.resolveContext({
      userId: ownerBUserId,
      membershipId: ownerBMembershipId,
      companyId: companyAId,
      branchId: a1Id,
    });
    expect(tampered).toBeNull();

    // Crafted tamper: OWNER_B's real user id paired with OWNER_A's real
    // membership id — a stolen/guessed membership id must still fail,
    // since `resolveContext`'s own membership lookup requires
    // `m.user_id = input.userId` to match too.
    const stolenMembership = await authRepository.resolveContext({
      userId: ownerBUserId,
      membershipId: ownerAMembershipId,
      companyId: companyAId,
      branchId: a1Id,
    });
    expect(stolenMembership).toBeNull();
  });
});
