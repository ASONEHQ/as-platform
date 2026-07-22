import { randomUUID } from 'node:crypto';

import { AppError } from '@asone/errors';

import { verifyPassword } from './auth.passwords.js';
import type { AuthTokens } from './auth.tokens.js';
import type { AuthContext, AuthMembership, AuthRepository, LoginInput } from './auth.types.js';

interface AuthServiceOptions {
  readonly repository: AuthRepository;
  readonly tokens: AuthTokens;
  readonly dummyPasswordHash: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly now?: () => Date;
}

export interface TokenResult {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly context: AuthContext;
}

function authError(code: 'invalid_credentials' | 'session_expired'): AppError {
  return new AppError({
    code,
    message: code === 'invalid_credentials' ? 'Invalid credentials.' : 'The session has expired.',
    statusCode: 401,
  });
}

export class AuthService {
  readonly #repository: AuthRepository;
  readonly #tokens: AuthTokens;
  readonly #dummyPasswordHash: string;
  readonly #accessTokenTtlSeconds: number;
  readonly #refreshTokenTtlSeconds: number;
  readonly #now: () => Date;

  public constructor(options: AuthServiceOptions) {
    this.#repository = options.repository;
    this.#tokens = options.tokens;
    this.#dummyPasswordHash = options.dummyPasswordHash;
    this.#accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.#refreshTokenTtlSeconds = options.refreshTokenTtlSeconds;
    this.#now = options.now ?? (() => new Date());
  }

  public async login(input: LoginInput): Promise<TokenResult> {
    const normalizedEmail = input.identifier.trim().toLowerCase();
    const user = await this.#repository.findUserByNormalizedEmail(normalizedEmail);
    const passwordValid = await verifyPassword(
      user?.passwordHash ?? this.#dummyPasswordHash,
      input.password,
    );
    if (user === null || !passwordValid || user.status !== 'active' || user.passwordHash === null) {
      throw authError('invalid_credentials');
    }

    const memberships = await this.#repository.listActiveMemberships(user.id);
    const membership = this.#selectMembership(memberships, input.companyId);
    const resolved = await this.#repository.resolveContext({
      userId: user.id,
      membershipId: membership.id,
      companyId: membership.companyId,
      branchId: input.branchId,
      deviceId: input.deviceId,
    });
    if (resolved === null) {
      throw new AppError({
        code: input.deviceId === undefined ? 'branch_scope_mismatch' : 'device_revoked',
        message: 'The requested authentication context is not available.',
        statusCode: 403,
      });
    }

    const now = this.#now();
    const refreshExpiresAt = new Date(now.getTime() + this.#refreshTokenTtlSeconds * 1_000);
    const refreshToken = this.#tokens.createRefreshToken();
    const provisional = { ...resolved, expiresAt: refreshExpiresAt, sessionId: randomUUID() };
    const sessionId = await this.#repository.createSession({
      ...resolved,
      expiresAt: refreshExpiresAt,
      tokenFamilyId: randomUUID(),
      tokenHash: this.#tokens.hashRefreshToken(refreshToken),
      userId: user.id,
    });
    const context = Object.freeze({ ...provisional, sessionId });
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.login.succeeded',
      entityId: sessionId,
    });
    return this.#tokenResult(context, refreshToken, refreshExpiresAt);
  }

  public async refresh(refreshToken: string): Promise<TokenResult> {
    const tokenHash = this.#tokens.hashRefreshToken(refreshToken);
    const found = await this.#repository.findRefreshToken(tokenHash);
    if (found === null || found.refreshExpiresAt <= this.#now()) throw authError('session_expired');

    if (found.tokenStatus !== 'active' || found.status !== 'active') {
      await this.#repository.rotateRefreshToken({
        sessionId: found.context.sessionId,
        previousHash: tokenHash,
        nextHash: tokenHash,
        nextGeneration: found.generation,
        expiresAt: found.refreshExpiresAt,
      });
      await this.#repository.audit({
        companyId: found.context.companyId,
        branchId: found.context.branchId,
        actorId: found.context.userId,
        action: 'auth.refresh.reuse_detected',
        entityId: found.context.sessionId,
      });
      throw authError('session_expired');
    }

    const current = await this.#repository.resolveContext({
      userId: found.context.userId,
      membershipId: found.context.membershipId,
      companyId: found.context.companyId,
      branchId: found.context.branchId,
      deviceId: found.context.deviceId,
    });
    if (current === null) {
      await this.#repository.revokeSession(found.context.sessionId, 'context_invalid');
      throw authError('session_expired');
    }

    const nextToken = this.#tokens.createRefreshToken();
    const outcome = await this.#repository.rotateRefreshToken({
      sessionId: found.context.sessionId,
      previousHash: tokenHash,
      nextHash: this.#tokens.hashRefreshToken(nextToken),
      nextGeneration: found.generation + 1,
      expiresAt: found.refreshExpiresAt,
    });
    if (outcome !== 'rotated') throw authError('session_expired');
    const context = Object.freeze({
      ...current,
      expiresAt: found.refreshExpiresAt,
      sessionId: found.context.sessionId,
    });
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.refresh.rotated',
      entityId: context.sessionId,
    });
    return this.#tokenResult(context, nextToken, found.refreshExpiresAt);
  }

  public async authenticate(accessToken: string): Promise<AuthContext> {
    let claims: { sessionId: string; userId: string };
    try {
      claims = await this.#tokens.verifyAccessToken(accessToken);
    } catch {
      throw authError('session_expired');
    }
    const session = await this.#repository.findSession(claims.sessionId);
    if (session?.userId !== claims.userId || session.expiresAt <= this.#now()) {
      throw authError('session_expired');
    }
    return session;
  }

  public async logout(context: AuthContext): Promise<void> {
    await this.#repository.revokeSession(context.sessionId, 'logout');
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.logout',
      entityId: context.sessionId,
    });
  }

  public async logoutAll(context: AuthContext, exceptCurrent: boolean): Promise<number> {
    const count = await this.#repository.revokeUserSessions(
      context.userId,
      context.companyId,
      exceptCurrent ? context.sessionId : undefined,
    );
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.logout_all',
      entityId: context.sessionId,
      metadata: { revoked_count: count },
    });
    return count;
  }

  public getIdentity(userId: string): Promise<Readonly<Record<string, unknown>> | null> {
    return this.#repository.getSafeIdentity(userId);
  }

  public requirePermission(context: AuthContext, permission: string): void {
    if (!context.permissions.includes(permission))
      throw new AppError({
        code: 'permission_denied',
        message: 'Permission denied.',
        statusCode: 403,
      });
  }

  public requireBranchAccess(context: AuthContext, branchId: string): void {
    if (!context.permittedBranchIds.includes(branchId))
      throw new AppError({
        code: 'branch_scope_mismatch',
        message: 'Branch scope is not authorized.',
        statusCode: 403,
      });
  }

  #selectMembership(
    memberships: readonly AuthMembership[],
    requestedCompanyId?: string,
  ): AuthMembership {
    const selected =
      requestedCompanyId === undefined
        ? memberships.length === 1
          ? memberships[0]
          : undefined
        : memberships.find((item) => item.companyId === requestedCompanyId);
    if (selected === undefined)
      throw new AppError({
        code: 'company_scope_mismatch',
        message: 'A valid company context is required.',
        statusCode: 403,
      });
    return selected;
  }

  async #tokenResult(
    context: AuthContext,
    refreshToken: string,
    refreshTokenExpiresAt: Date,
  ): Promise<TokenResult> {
    return Object.freeze({
      accessToken: await this.#tokens.signAccessToken(context),
      accessTokenExpiresAt: new Date(this.#now().getTime() + this.#accessTokenTtlSeconds * 1_000),
      refreshToken,
      refreshTokenExpiresAt,
      context,
    });
  }
}
