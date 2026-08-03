import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './auth.passwords.js';
import { AuthService } from './auth.service.js';
import { AuthTokens } from './auth.tokens.js';
import type {
  AuthContext,
  AuthMembership,
  AuthRepository,
  AuthUser,
  LoginChallenge,
  LoginChallengeCreation,
  RefreshLookup,
  SessionCreation,
} from './auth.types.js';

const userId = randomUUID();
const companyId = randomUUID();
const membershipId = randomUUID();
const branchId = randomUUID();
let passwordHash = '';
let dummyHash = '';

class FakeRepository implements AuthRepository {
  public user: AuthUser | null = {
    id: userId,
    email: 'operator@example.test',
    displayName: 'Operator',
    passwordHash: '',
    status: 'active',
  };
  public membershipStatus = 'active';
  public memberships: readonly AuthMembership[] = [
    { id: membershipId, companyId, companyName: 'Test', status: 'active' },
  ];
  public contextAllowed = true;
  public audits: string[] = [];
  public revoked = false;
  readonly #refresh = new Map<string, RefreshLookup>();
  readonly #sessions = new Map<string, AuthContext>();
  readonly #challenges = new Map<string, LoginChallenge>();

  public findUserByNormalizedEmail(): Promise<AuthUser | null> {
    return Promise.resolve(this.user);
  }
  public listActiveMemberships(): Promise<
    readonly { id: string; companyId: string; companyName: string; status: string }[]
  > {
    return Promise.resolve(this.membershipStatus === 'active' ? this.memberships : []);
  }
  public resolveContext(input: {
    userId: string;
    membershipId: string;
    companyId: string;
    branchId?: string | undefined;
    deviceId?: string | undefined;
  }): Promise<Omit<AuthContext, 'sessionId' | 'expiresAt'> | null> {
    if (!this.contextAllowed || (input.branchId !== undefined && input.branchId !== branchId))
      return Promise.resolve(null);
    return Promise.resolve({
      ...input,
      permissions: ['company.read'],
      permittedBranchIds: [branchId],
      companyWideAccess: false,
    });
  }
  public createSession(input: SessionCreation): Promise<string> {
    const sessionId = randomUUID();
    const context = {
      sessionId,
      userId: input.userId,
      membershipId: input.membershipId,
      companyId: input.companyId,
      ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      expiresAt: input.expiresAt,
      permissions: ['company.read'],
      permittedBranchIds: [branchId],
      companyWideAccess: input.companyWideAccess ?? false,
      transportMode: input.transportMode,
      tokenGeneration: input.tokenGeneration,
    };
    this.#sessions.set(sessionId, context);
    this.#refresh.set(input.tokenHash, {
      context,
      generation: 0,
      refreshExpiresAt: input.expiresAt,
      status: 'active',
      tokenStatus: 'active',
    });
    return Promise.resolve(sessionId);
  }
  public findRefreshToken(hash: string): Promise<RefreshLookup | null> {
    return Promise.resolve(this.#refresh.get(hash) ?? null);
  }
  public rotateRefreshToken(input: {
    sessionId: string;
    previousHash: string;
    nextHash: string;
    nextGeneration: number;
    expiresAt: Date;
  }): Promise<'rotated' | 'reused' | 'invalid'> {
    const previous = this.#refresh.get(input.previousHash);
    if (previous === undefined) return Promise.resolve('invalid');
    if (previous.tokenStatus !== 'active') {
      this.revoked = true;
      return Promise.resolve('reused');
    }
    this.#refresh.set(input.previousHash, { ...previous, tokenStatus: 'rotated' });
    this.#refresh.set(input.nextHash, {
      ...previous,
      generation: input.nextGeneration,
      tokenStatus: 'active',
    });
    return Promise.resolve('rotated');
  }
  public findSession(id: string): Promise<AuthContext | null> {
    return Promise.resolve(this.revoked ? null : (this.#sessions.get(id) ?? null));
  }
  public revokeSession(): Promise<boolean> {
    this.revoked = true;
    return Promise.resolve(true);
  }
  public revokeUserSessions(): Promise<number> {
    this.revoked = true;
    return Promise.resolve(1);
  }
  public getSafeIdentity(): Promise<Readonly<Record<string, unknown>>> {
    return Promise.resolve({ id: userId, email: 'operator@example.test' });
  }
  public audit(input: { action: string }): Promise<void> {
    this.audits.push(input.action);
    return Promise.resolve();
  }
  public createLoginChallenge(input: LoginChallengeCreation): Promise<void> {
    this.#challenges.set(input.tokenHash, {
      id: randomUUID(),
      userId: input.userId,
      eligibleCompanyIds: input.eligibleCompanyIds,
      clientType: input.clientType,
      ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      expiresAt: input.expiresAt,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 5,
    });
    return Promise.resolve();
  }
  public findLoginChallengeForUpdate(hash: string): Promise<LoginChallenge | null> {
    return Promise.resolve(this.#challenges.get(hash) ?? null);
  }
  public incrementChallengeAttempt(id: string, invalidate: boolean): Promise<void> {
    for (const [hash, challenge] of this.#challenges)
      if (challenge.id === id)
        this.#challenges.set(hash, {
          ...challenge,
          attemptCount: challenge.attemptCount + 1,
          status: invalidate ? 'invalidated' : challenge.status,
        });
    return Promise.resolve();
  }
  public consumeLoginChallenge(input: {
    challengeId: string;
    session: SessionCreation;
  }): Promise<{ readonly sessionId: string } | 'already_used'> {
    const entry = [...this.#challenges.entries()].find(([, item]) => item.id === input.challengeId);
    if (entry?.[1].status !== 'pending') return Promise.resolve('already_used');
    this.#challenges.set(entry[0], { ...entry[1], status: 'consumed' });
    return this.createSession(input.session).then((sessionId) => ({ sessionId }));
  }
}

function fixture(repository = new FakeRepository()): {
  repository: FakeRepository;
  service: AuthService;
  tokens: AuthTokens;
} {
  repository.user = repository.user === null ? null : { ...repository.user, passwordHash };
  const tokens = new AuthTokens({
    audience: 'test-api',
    issuer: 'https://test.asone.mx',
    secret: 'test-secret-that-is-at-least-32-characters',
    ttlSeconds: 60,
  });
  return {
    repository,
    tokens,
    service: new AuthService({
      repository,
      tokens,
      dummyPasswordHash: dummyHash,
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 3_600,
    }),
  };
}

beforeAll(async () => {
  passwordHash = await hashPassword('Correct-password-1!');
  dummyHash = await hashPassword('dummy-password');
});

describe('authentication foundation', () => {
  it('binds CSRF proofs to session, generation, mode, and a short expiry', () => {
    const { tokens } = fixture();
    const issuedAt = new Date('2026-08-02T12:00:00.000Z');
    const proof = tokens.csrfToken('session-one', 3, issuedAt);
    expect(tokens.verifyCsrfToken(proof.token, 'session-one', 3, issuedAt)).toBe(true);
    expect(tokens.verifyCsrfToken(proof.token, 'session-two', 3, issuedAt)).toBe(false);
    expect(tokens.verifyCsrfToken(proof.token, 'session-one', 4, issuedAt)).toBe(false);
    expect(
      tokens.verifyCsrfToken(proof.token, 'session-one', 3, new Date('2026-08-02T12:02:01Z')),
    ).toBe(false);
  });

  it('hashes and verifies passwords with Argon2id', async () => {
    expect(passwordHash).toContain('$argon2id$');
    await expect(verifyPassword(passwordHash, 'Correct-password-1!')).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns the same safe error for unknown email and wrong password', async () => {
    const wrong = fixture();
    await expect(
      wrong.service.login({ identifier: 'operator@example.test', password: 'wrong-password' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    const missingRepo = new FakeRepository();
    missingRepo.user = null;
    await expect(
      fixture(missingRepo).service.login({
        identifier: 'missing@example.test',
        password: 'wrong-password',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('rejects inactive users and memberships', async () => {
    const inactiveUser = fixture();
    if (inactiveUser.repository.user === null) throw new Error('fixture user missing');
    inactiveUser.repository.user = { ...inactiveUser.repository.user, status: 'disabled' };
    await expect(
      inactiveUser.service.login({
        identifier: 'operator@example.test',
        password: 'Correct-password-1!',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    const inactiveMembership = fixture();
    inactiveMembership.repository.membershipStatus = 'disabled';
    await expect(
      inactiveMembership.service.login({
        identifier: 'operator@example.test',
        password: 'Correct-password-1!',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('establishes a tenant and branch validated session', async () => {
    const { service } = fixture();
    const result = await service.login({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
      branchId,
    });
    expect(result.accessToken).not.toBe(result.refreshToken);
    expect(result.context).toMatchObject({ companyId, branchId, membershipId, userId });
    await expect(service.authenticate(result.accessToken)).resolves.toMatchObject({
      sessionId: result.context.sessionId,
    });
  });

  it('creates and consumes a one-use browser company-selection challenge', async () => {
    const repository = new FakeRepository();
    const otherCompanyId = randomUUID();
    repository.memberships = [
      ...repository.memberships,
      { id: randomUUID(), companyId: otherCompanyId, companyName: 'Other', status: 'active' },
    ];
    const { service } = fixture(repository);
    const challenge = await service.beginLogin({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      clientType: 'browser',
      transportMode: 'browser',
    });
    expect(challenge).toMatchObject({ outcome: 'company_selection_required' });
    if (!('outcome' in challenge)) throw new Error('expected challenge');
    await expect(
      service.completeCompanySelection({
        challengeToken: challenge.challengeToken,
        companyId,
        browserOriginApproved: false,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    const selected = await service.completeCompanySelection({
      challengeToken: challenge.challengeToken,
      companyId,
      branchId,
      browserOriginApproved: true,
    });
    expect(selected.context).toMatchObject({ companyId, branchId, transportMode: 'browser' });
    expect(service.csrfToken(selected.context)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    await expect(
      service.completeCompanySelection({
        challengeToken: challenge.challengeToken,
        companyId,
        browserOriginApproved: true,
      }),
    ).rejects.toMatchObject({ code: 'login_challenge_already_used' });
  });

  it('binds browser refresh to its generation CSRF token and stored mode', async () => {
    const { service } = fixture();
    const login = await service.beginLogin({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
      clientType: 'browser',
      transportMode: 'browser',
    });
    if ('outcome' in login) throw new Error('unexpected challenge');
    await expect(service.refresh(login.refreshToken, 'bearer')).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(service.refresh(login.refreshToken, 'browser')).rejects.toMatchObject({
      code: 'validation_error',
    });
    const refreshed = await service.refresh(
      login.refreshToken,
      'browser',
      service.csrfToken(login.context),
    );
    expect(refreshed.context.tokenGeneration).toBe(1);
    expect(service.csrfToken(refreshed.context)).not.toBe(service.csrfToken(login.context));
  });

  it('bootstraps a browser CSRF proof without rotating refresh state', async () => {
    const { service } = fixture();
    const login = await service.beginLogin({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
      clientType: 'browser',
      transportMode: 'browser',
    });
    if ('outcome' in login) throw new Error('unexpected challenge');
    const [first, second] = await Promise.all([
      service.bootstrapBrowser(login.refreshToken),
      service.bootstrapBrowser(login.refreshToken),
    ]);
    expect(first.csrfToken).toBe(second.csrfToken);
    expect(first.csrfExpiresAt.getTime()).toBeGreaterThan(Date.now());
    const refreshed = await service.refresh(login.refreshToken, 'browser', first.csrfToken);
    expect(refreshed.context.tokenGeneration).toBe(1);
    await expect(
      service.refresh(refreshed.refreshToken, 'browser', first.csrfToken),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects an unauthorized branch or revoked device context', async () => {
    const invalidBranch = fixture();
    await expect(
      invalidBranch.service.login({
        identifier: 'operator@example.test',
        password: 'Correct-password-1!',
        companyId,
        branchId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'branch_scope_mismatch' });
    const invalidDevice = fixture();
    invalidDevice.repository.contextAllowed = false;
    await expect(
      invalidDevice.service.login({
        identifier: 'operator@example.test',
        password: 'Correct-password-1!',
        companyId,
        deviceId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'device_revoked' });
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const { repository, service } = fixture();
    const login = await service.login({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
    });
    const rotated = await service.refresh(login.refreshToken);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    await expect(service.refresh(login.refreshToken)).rejects.toMatchObject({
      code: 'refresh_token_reused',
    });
    expect(repository.revoked).toBe(true);
    expect(repository.audits).toContain('auth.refresh_reuse_detected');
  });

  it('revokes logout and logout-all sessions', async () => {
    const one = fixture();
    const login = await one.service.login({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
    });
    await one.service.logout(login.context);
    expect(one.repository.revoked).toBe(true);
    const all = fixture();
    const second = await all.service.login({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
    });
    await expect(all.service.logoutAll(second.context, false)).resolves.toBe(1);
  });

  it('enforces permissions and branch access', async () => {
    const { service } = fixture();
    const login = await service.login({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
    });
    expect(() => {
      service.requirePermission(login.context, 'company.read');
    }).not.toThrow();
    expect(() => {
      service.requirePermission(login.context, 'company.update');
    }).toThrow(expect.objectContaining({ code: 'permission_denied' }));
    expect(() => {
      service.requireBranchAccess(login.context, randomUUID());
    }).toThrow(expect.objectContaining({ code: 'branch_scope_mismatch' }));
  });

  it('rejects expired access tokens', async () => {
    const repository = new FakeRepository();
    if (repository.user === null) throw new Error('fixture user missing');
    repository.user = { ...repository.user, passwordHash };
    const expiredTokens = new AuthTokens({
      audience: 'test-api',
      issuer: 'https://test.asone.mx',
      secret: 'test-secret-that-is-at-least-32-characters',
      ttlSeconds: -1,
    });
    const service = new AuthService({
      repository,
      tokens: expiredTokens,
      dummyPasswordHash: dummyHash,
      accessTokenTtlSeconds: 60,
      refreshTokenTtlSeconds: 3_600,
    });
    const result = await service.login({
      identifier: 'operator@example.test',
      password: 'Correct-password-1!',
      companyId,
    });
    await expect(service.authenticate(result.accessToken)).rejects.toMatchObject({
      code: 'session_expired',
    });
  });
});
