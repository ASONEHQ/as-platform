import { randomBytes, randomUUID } from 'node:crypto';

import { AppError } from '@asone/errors';

import { hashPassword, verifyPassword } from './auth.passwords.js';
import type { AuthTokens } from './auth.tokens.js';
import type {
  AuthContext,
  AuthMembership,
  AuthRepository,
  ClientType,
  LoginInput,
  TransportMode,
} from './auth.types.js';

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

export interface ChallengeResult {
  readonly outcome: 'company_selection_required';
  readonly challengeToken: string;
  readonly expiresAt: Date;
  readonly companies: readonly { readonly id: string; readonly name: string }[];
}

export interface BrowserBootstrapResult {
  readonly csrfToken: string;
  readonly csrfExpiresAt: Date;
}

export type LoginResult = TokenResult | ChallengeResult;

interface RequestEvidence {
  readonly requestId?: string | undefined;
  readonly correlationId?: string | undefined;
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

  public async login(input: LoginInput, evidence: RequestEvidence = {}): Promise<TokenResult> {
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
    return this.#createLoginSession(user.id, membership, input, evidence);
  }

  async #createLoginSession(
    userId: string,
    membership: AuthMembership,
    input: LoginInput,
    evidence: RequestEvidence = {},
  ): Promise<TokenResult> {
    const resolved = await this.#repository.resolveContext({
      userId,
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

    const transportMode = this.#transport(input.clientType, input.transportMode);
    const now = this.#now();
    const refreshExpiresAt = new Date(now.getTime() + this.#refreshTokenTtlSeconds * 1_000);
    const refreshToken = this.#tokens.createRefreshToken();
    const provisional = {
      ...resolved,
      transportMode,
      tokenGeneration: 0,
      expiresAt: refreshExpiresAt,
      sessionId: randomUUID(),
    };
    const sessionId = await this.#repository.createSession({
      ...resolved,
      transportMode,
      tokenGeneration: 0,
      expiresAt: refreshExpiresAt,
      tokenFamilyId: randomUUID(),
      tokenHash: this.#tokens.hashRefreshToken(refreshToken),
      userId,
    });
    const context = Object.freeze({ ...provisional, sessionId });
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.login_succeeded',
      entityId: sessionId,
      requestId: evidence.requestId,
      correlationId: evidence.correlationId,
    });
    return this.#tokenResult(context, refreshToken, refreshExpiresAt);
  }

  public async beginLogin(input: LoginInput, evidence: RequestEvidence = {}): Promise<LoginResult> {
    const normalizedEmail = input.identifier.trim().toLowerCase();
    const user = await this.#repository.findUserByNormalizedEmail(normalizedEmail);
    const passwordValid = await verifyPassword(
      user?.passwordHash ?? this.#dummyPasswordHash,
      input.password,
    );
    if (user === null || !passwordValid || user.status !== 'active' || user.passwordHash === null)
      throw authError('invalid_credentials');
    const memberships = await this.#repository.listActiveMemberships(user.id);
    if (input.companyId !== undefined || memberships.length === 1) {
      const membership = this.#selectMembership(memberships, input.companyId);
      return this.#createLoginSession(user.id, membership, input, evidence);
    }
    if (memberships.length === 0) throw authError('invalid_credentials');
    const clientType = input.clientType ?? 'pos';
    this.#transport(clientType, input.transportMode);
    if (this.#repository.createLoginChallenge === undefined)
      throw new Error('Login challenges are unavailable.');
    const challengeToken = this.#tokens.createChallengeToken();
    const expiresAt = new Date(this.#now().getTime() + 5 * 60 * 1_000);
    await this.#repository.createLoginChallenge({
      userId: user.id,
      tokenHash: this.#tokens.hashRefreshToken(challengeToken),
      eligibleCompanyIds: memberships.map((item) => item.companyId),
      clientType,
      deviceId: input.deviceId,
      expiresAt,
      requestId: evidence.requestId,
      correlationId: evidence.correlationId,
    });
    await Promise.all(
      memberships.map((membership) =>
        this.#repository.audit({
          companyId: membership.companyId,
          actorId: user.id,
          action: 'auth.company_selection_required',
          requestId: evidence.requestId,
          correlationId: evidence.correlationId,
          metadata: { eligible_company_count: memberships.length },
        }),
      ),
    );
    return Object.freeze({
      outcome: 'company_selection_required' as const,
      challengeToken,
      expiresAt,
      companies: memberships.map((item) => ({ id: item.companyId, name: item.companyName })),
    });
  }

  public async completeCompanySelection(input: {
    challengeToken: string;
    companyId: string;
    branchId?: string | undefined;
    browserOriginApproved?: boolean | undefined;
    requestId?: string | undefined;
    correlationId?: string | undefined;
  }): Promise<TokenResult> {
    const find = this.#repository.findLoginChallengeForUpdate?.bind(this.#repository);
    const consume = this.#repository.consumeLoginChallenge?.bind(this.#repository);
    if (find === undefined || consume === undefined)
      throw new Error('Login challenges unavailable.');
    const challenge = await find(this.#tokens.hashRefreshToken(input.challengeToken));
    if (challenge === null)
      throw new AppError({
        code: 'invalid_login_challenge',
        message: 'Invalid login challenge.',
        statusCode: 401,
      });
    if (challenge.status !== 'pending')
      throw new AppError({
        code: 'login_challenge_already_used',
        message: 'Login challenge already used.',
        statusCode: 409,
      });
    if (challenge.expiresAt <= this.#now())
      throw new AppError({
        code: 'login_challenge_expired',
        message: 'Login challenge expired.',
        statusCode: 401,
      });
    if (challenge.attemptCount >= challenge.maxAttempts)
      throw new AppError({
        code: 'login_challenge_already_used',
        message: 'Login challenge already used.',
        statusCode: 409,
      });
    if (challenge.clientType === 'browser' && input.browserOriginApproved !== true)
      throw new AppError({
        code: 'validation_error',
        message: 'Request origin is not allowed.',
        statusCode: 403,
      });
    const memberships = await this.#repository.listActiveMemberships(challenge.userId);
    const membership = memberships.find((item) => item.companyId === input.companyId);
    const invalid =
      !challenge.eligibleCompanyIds.includes(input.companyId) || membership === undefined;
    if (invalid) {
      const next = challenge.attemptCount + 1;
      await this.#repository.incrementChallengeAttempt?.(
        challenge.id,
        next >= challenge.maxAttempts,
      );
      throw new AppError({
        code: 'invalid_login_challenge',
        message: 'Invalid login challenge.',
        statusCode: 401,
      });
    }
    const resolved = await this.#repository.resolveContext({
      userId: challenge.userId,
      membershipId: membership.id,
      companyId: membership.companyId,
      branchId: input.branchId,
      deviceId: challenge.deviceId,
    });
    if (resolved === null) {
      const next = challenge.attemptCount + 1;
      await this.#repository.incrementChallengeAttempt?.(
        challenge.id,
        next >= challenge.maxAttempts,
      );
      throw new AppError({
        code: 'branch_access_denied',
        message: 'Branch access denied.',
        statusCode: 404,
      });
    }
    const transportMode = this.#transport(challenge.clientType);
    const refreshToken = this.#tokens.createRefreshToken();
    const expiresAt = new Date(this.#now().getTime() + this.#refreshTokenTtlSeconds * 1_000);
    const consumed = await consume({
      challengeId: challenge.id,
      companyId: input.companyId,
      session: {
        ...resolved,
        transportMode,
        tokenGeneration: 0,
        expiresAt,
        tokenFamilyId: randomUUID(),
        tokenHash: this.#tokens.hashRefreshToken(refreshToken),
      },
    });
    if (consumed === 'already_used')
      throw new AppError({
        code: 'login_challenge_already_used',
        message: 'Login challenge already used.',
        statusCode: 409,
      });
    const sessionId = consumed.sessionId;
    const context = Object.freeze({
      ...resolved,
      transportMode,
      tokenGeneration: 0,
      expiresAt,
      sessionId,
    });
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.company_selected',
      entityId: sessionId,
      requestId: input.requestId,
      correlationId: input.correlationId,
    });
    return this.#tokenResult(context, refreshToken, expiresAt);
  }

  public async refresh(
    refreshToken: string,
    expectedMode?: TransportMode,
    csrfToken?: string,
    evidence: RequestEvidence = {},
  ): Promise<TokenResult> {
    const tokenHash = this.#tokens.hashRefreshToken(refreshToken);
    const found = await this.#repository.findRefreshToken(tokenHash);
    if (found === null || found.refreshExpiresAt <= this.#now()) throw authError('session_expired');
    const storedMode = found.context.transportMode ?? 'bearer';
    if (expectedMode !== undefined && storedMode !== expectedMode)
      throw new AppError({
        code: 'validation_error',
        message: 'Refresh transport is invalid.',
        statusCode: 400,
      });
    if (
      storedMode === 'browser' &&
      (csrfToken === undefined ||
        !this.#tokens.verifyCsrfToken(
          csrfToken,
          found.context.sessionId,
          found.generation,
          this.#now(),
        ))
    )
      throw new AppError({
        code: 'validation_error',
        message: 'CSRF validation failed.',
        statusCode: 403,
      });

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
        action: 'auth.refresh_reuse_detected',
        entityId: found.context.sessionId,
        requestId: evidence.requestId,
        correlationId: evidence.correlationId,
      });
      throw new AppError({
        code: 'refresh_token_reused',
        message: 'Refresh token reuse was detected.',
        statusCode: 401,
      });
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
    if (outcome === 'reused') {
      await this.#repository.audit({
        companyId: found.context.companyId,
        branchId: found.context.branchId,
        actorId: found.context.userId,
        action: 'auth.refresh_reuse_detected',
        entityId: found.context.sessionId,
        requestId: evidence.requestId,
        correlationId: evidence.correlationId,
      });
      throw new AppError({
        code: 'refresh_token_reused',
        message: 'Refresh token reuse was detected.',
        statusCode: 401,
      });
    }
    if (outcome !== 'rotated') throw authError('session_expired');
    const context = Object.freeze({
      ...current,
      transportMode: storedMode,
      tokenGeneration: found.generation + 1,
      expiresAt: found.refreshExpiresAt,
      sessionId: found.context.sessionId,
    });
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.token_refreshed',
      entityId: context.sessionId,
      requestId: evidence.requestId,
      correlationId: evidence.correlationId,
    });
    return this.#tokenResult(context, nextToken, found.refreshExpiresAt);
  }

  public verifyCsrf(context: AuthContext, token: string | undefined): void {
    if (
      (context.transportMode ?? 'bearer') === 'browser' &&
      (token === undefined ||
        !this.#tokens.verifyCsrfToken(
          token,
          context.sessionId,
          context.tokenGeneration ?? 0,
          this.#now(),
        ))
    )
      throw new AppError({
        code: 'validation_error',
        message: 'CSRF validation failed.',
        statusCode: 403,
      });
  }

  public csrfToken(context: AuthContext): string | undefined {
    return (context.transportMode ?? 'bearer') === 'browser'
      ? this.#tokens.csrfToken(context.sessionId, context.tokenGeneration ?? 0, this.#now()).token
      : undefined;
  }

  public async bootstrapBrowser(refreshToken: string): Promise<BrowserBootstrapResult> {
    const found = await this.#repository.findRefreshToken(
      this.#tokens.hashRefreshToken(refreshToken),
    );
    if (found === null || found.refreshExpiresAt <= this.#now()) throw authError('session_expired');
    if ((found.context.transportMode ?? 'bearer') !== 'browser')
      throw new AppError({
        code: 'validation_error',
        message: 'Browser bootstrap transport is invalid.',
        statusCode: 400,
      });
    if (found.tokenStatus !== 'active')
      throw new AppError({
        code: 'refresh_token_reused',
        message: 'Refresh token reuse was detected.',
        statusCode: 401,
      });
    if (found.status !== 'active')
      throw new AppError({
        code: 'session_revoked',
        message: 'The session was revoked.',
        statusCode: 401,
      });
    if ((found.context.tokenGeneration ?? 0) !== found.generation)
      throw new AppError({
        code: 'refresh_token_reused',
        message: 'Refresh token generation is stale.',
        statusCode: 401,
      });
    const proof = this.#tokens.csrfToken(found.context.sessionId, found.generation, this.#now());
    return Object.freeze({ csrfToken: proof.token, csrfExpiresAt: proof.expiresAt });
  }

  public async switchCompany(
    current: AuthContext,
    companyId: string,
    branchId?: string,
    evidence: RequestEvidence = {},
  ): Promise<TokenResult> {
    const replace = this.#repository.replaceCompanySession?.bind(this.#repository);
    if (replace === undefined) throw new Error('Company switching unavailable.');
    const membership = (await this.#repository.listActiveMemberships(current.userId)).find(
      (item) => item.companyId === companyId,
    );
    if (membership === undefined)
      throw new AppError({
        code: 'company_access_denied',
        message: 'Company access denied.',
        statusCode: 404,
      });
    const resolved = await this.#repository.resolveContext({
      userId: current.userId,
      membershipId: membership.id,
      companyId,
      branchId,
    });
    if (resolved === null)
      throw new AppError({
        code: 'branch_access_denied',
        message: 'Branch access denied.',
        statusCode: 404,
      });
    const refreshToken = this.#tokens.createRefreshToken();
    const expiresAt = new Date(this.#now().getTime() + this.#refreshTokenTtlSeconds * 1_000);
    const sessionId = await replace({
      currentSessionId: current.sessionId,
      replacement: {
        ...resolved,
        transportMode: current.transportMode ?? 'bearer',
        tokenGeneration: 0,
        expiresAt,
        tokenFamilyId: randomUUID(),
        tokenHash: this.#tokens.hashRefreshToken(refreshToken),
      },
    });
    const context = Object.freeze({
      ...resolved,
      transportMode: current.transportMode ?? 'bearer',
      tokenGeneration: 0,
      expiresAt,
      sessionId,
    });
    await this.#repository.audit({
      companyId,
      branchId,
      actorId: current.userId,
      action: 'auth.company_switched',
      entityId: sessionId,
      metadata: { previous_company_id: current.companyId },
      requestId: evidence.requestId,
      correlationId: evidence.correlationId,
    });
    return this.#tokenResult(context, refreshToken, expiresAt);
  }

  public async switchBranch(
    current: AuthContext,
    branchId: string | undefined,
    evidence: RequestEvidence = {},
  ): Promise<TokenResult> {
    if (branchId === undefined && !(current.companyWideAccess ?? false))
      throw new AppError({
        code: 'branch_access_denied',
        message: 'Branch access denied.',
        statusCode: 404,
      });
    const resolved = await this.#repository.resolveContext({
      userId: current.userId,
      membershipId: current.membershipId,
      companyId: current.companyId,
      branchId,
      deviceId: current.deviceId,
    });
    if (resolved === null)
      throw new AppError({
        code: 'branch_access_denied',
        message: 'Branch access denied.',
        statusCode: 404,
      });
    const nextToken = this.#tokens.createRefreshToken();
    const outcome = await this.#repository.switchBranchSession?.({
      sessionId: current.sessionId,
      branchId,
      nextHash: this.#tokens.hashRefreshToken(nextToken),
      nextGeneration: (current.tokenGeneration ?? 0) + 1,
      expiresAt: current.expiresAt,
    });
    if (outcome !== 'rotated') throw authError('session_expired');
    const context = Object.freeze({
      ...resolved,
      transportMode: current.transportMode ?? 'bearer',
      tokenGeneration: (current.tokenGeneration ?? 0) + 1,
      expiresAt: current.expiresAt,
      sessionId: current.sessionId,
    });
    await this.#repository.audit({
      companyId: current.companyId,
      branchId,
      actorId: current.userId,
      action: 'auth.branch_switched',
      entityId: current.sessionId,
      requestId: evidence.requestId,
      correlationId: evidence.correlationId,
    });
    return this.#tokenResult(context, nextToken, current.expiresAt);
  }

  // TASK 14.5 (Wave 3, Phase 4b): "quick-switch" PIN login.
  //
  // SECURITY MODEL (read before touching this method):
  //   1. The caller must already hold a valid, currently-active session
  //      (`current: AuthContext`, resolved by `requireAuthenticatedUser`
  //      in `auth.routes.ts` from a real bearer/browser session — exactly
  //      like `switchCompany`/`switchBranch` above). This is deliberately
  //      NOT a bare anonymous "PIN is the whole login" front door like the
  //      legacy's own mechanism: a PIN alone can never authenticate a
  //      request that doesn't already carry a real, backend-issued
  //      session on an already-authenticated device.
  //   2. The company scope is taken ONLY from `current.companyId` — never
  //      from the request body — so a PIN can never be tried against a
  //      company the calling device/session isn't already inside. This is
  //      the load-bearing cross-tenant-isolation guarantee.
  //   3. The PIN is hashed with the exact same argon2id scheme as
  //      passwords (`auth.passwords.ts`) and is never compared in
  //      plaintext or logged. Because a salted hash can't be looked up by
  //      value, every active PIN-enrolled membership in that one company
  //      is checked in turn (`listPinLoginCandidates`) — company staff
  //      counts are small, so this stays cheap, and it is bounded by
  //      `current.companyId` alone, never scanning another tenant's rows.
  //   4. Failure is uniform and honest: an unknown/wrong PIN and "nobody
  //      in this company has a PIN configured" both raise the exact same
  //      `invalid_credentials` error password login uses — no hint about
  //      which part was wrong.
  //   5. On success this mints a REAL, independent session through the
  //      exact same `#createLoginSession` path password login uses —
  //      never a parallel/weaker session mechanism — scoped to the
  //      resolved staff member's own membership, but inheriting the
  //      calling session's branch/device/transport (so the new session
  //      stays pinned to the same physical terminal). It does NOT revoke
  //      the calling session — mirrors how an ordinary password login
  //      never revokes a user's other active sessions elsewhere; a caller
  //      that wants single-active-session-per-device semantics can call
  //      `/api/v1/auth/logout` on the prior token itself.
  public async pinLogin(
    current: AuthContext,
    pin: string,
    evidence: RequestEvidence = {},
  ): Promise<TokenResult> {
    const list = this.#repository.listPinLoginCandidates?.bind(this.#repository);
    if (list === undefined) throw new Error('PIN login is unavailable.');
    const candidates = await list(current.companyId);
    let matched: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (await verifyPassword(candidate.pinHash, pin)) {
        matched = candidate;
        break;
      }
    }
    if (matched === undefined) throw authError('invalid_credentials');
    return this.#createLoginSession(matched.userId, matched.membership, {
      identifier: '',
      password: '',
      companyId: current.companyId,
      branchId: current.branchId,
      deviceId: current.deviceId,
      clientType: (current.transportMode ?? 'bearer') === 'browser' ? 'browser' : 'pos',
      transportMode: current.transportMode,
    }, evidence);
  }

  // TASK 14.5 (Wave 3, Phase 7 Item 8): "quick-switch" staff QR login.
  // Same security model as `pinLogin` above (already-authenticated-device
  // gate, company scope taken only from `current`, uniform honest
  // failure, real session via the same `#createLoginSession` path) plus
  // one more guarantee specific to a QR credential: an expired credential
  // NEVER matches, even if the submitted code happens to verify against a
  // stale hash — `qrExpiresAt` is checked before the hash comparison, not
  // relied upon to have been pre-filtered by the repository.
  public async qrLogin(
    current: AuthContext,
    code: string,
    evidence: RequestEvidence = {},
  ): Promise<TokenResult> {
    const list = this.#repository.listQrLoginCandidates?.bind(this.#repository);
    if (list === undefined) throw new Error('QR login is unavailable.');
    const candidates = await list(current.companyId);
    const now = this.#now();
    let matched: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (candidate.qrExpiresAt <= now) continue;
      if (await verifyPassword(candidate.qrSecretHash, code)) {
        matched = candidate;
        break;
      }
    }
    if (matched === undefined) throw authError('invalid_credentials');
    return this.#createLoginSession(matched.userId, matched.membership, {
      identifier: '',
      password: '',
      companyId: current.companyId,
      branchId: current.branchId,
      deviceId: current.deviceId,
      clientType: (current.transportMode ?? 'bearer') === 'browser' ? 'browser' : 'pos',
      transportMode: current.transportMode,
    }, evidence);
  }

  // TASK 14.5 (Wave 3, Phase 4b): admin enrollment — assigns/rotates
  // (`pin` non-null) or clears (`pin` null) a staff member's own
  // quick-switch PIN. The caller's own permission (`staff_credential.
  // manage`) is checked by the route before this is ever called — see
  // `auth.routes.ts` — mirroring every other admin action in this
  // codebase (permission check lives at the route/guard layer, not
  // duplicated in the service).
  //
  // Uniqueness trade-off: a PIN is intentionally kept unique within a
  // company (two cashiers sharing one PIN would make `pinLogin` resolve
  // to whichever one happens to be checked first) but, because the
  // stored value is a salted hash, this can never be enforced with a
  // plain unique index — it is enforced here by re-verifying the
  // candidate PIN against every OTHER PIN-enrolled membership's hash
  // before writing. This is a best-effort, not airtight, guarantee: two
  // concurrent enrollment requests choosing the same PIN at the exact
  // same instant could both pass this check before either write commits
  // (a benign race, not a security hole — the practical blast radius is
  // "two staff members can now use the same PIN interchangeably", not
  // unauthorized access, and it is trivially fixed by re-issuing either
  // PIN). A real unique constraint is deliberately not attempted here —
  // it would require either a deterministic (weaker) hash or a
  // client-visible plaintext index, both worse than this trade-off.
  public async setStaffPin(actor: AuthContext, membershipId: string, pin: string | null): Promise<void> {
    const setPin = this.#repository.setMembershipPin?.bind(this.#repository);
    if (setPin === undefined) throw new Error('Staff PIN management is unavailable.');
    let pinHash: string | null = null;
    if (pin !== null) {
      const list = this.#repository.listPinLoginCandidates?.bind(this.#repository);
      const candidates = list === undefined ? [] : await list(actor.companyId);
      for (const candidate of candidates) {
        if (candidate.membership.id === membershipId) continue;
        if (await verifyPassword(candidate.pinHash, pin)) {
          throw new AppError({
            code: 'validation_error',
            message: 'This PIN is already assigned to another staff member.',
            statusCode: 409,
          });
        }
      }
      pinHash = await hashPassword(pin);
    }
    const affected = await setPin({ companyId: actor.companyId, membershipId, pinHash });
    if (!affected)
      throw new AppError({
        code: 'not_found',
        message: 'Staff membership not found.',
        statusCode: 404,
      });
    await this.#repository.audit({
      companyId: actor.companyId,
      actorId: actor.userId,
      action: pin === null ? 'auth.staff_pin_cleared' : 'auth.staff_pin_set',
      entityId: membershipId,
    });
  }

  // TASK 14.5 (Wave 3, Phase 7 Item 8): admin issuance — generates a
  // fresh, cryptographically random, opaque QR credential (never a
  // predictable/client-chosen string, unlike the legacy's own
  // timestamp-based `POS-<ts>` generator) for one staff membership,
  // hashes it the same way a password is hashed, and returns the
  // plaintext code exactly once so the caller can render it into an
  // actual QR image — it is never retrievable again afterward (only its
  // hash is stored). `ttlDays` bounds the credential's own lifetime
  // (default 90 days) so a lost/forgotten badge can't authenticate
  // forever; reissuing always rotates both the secret and the expiry.
  public async issueStaffQrCredential(
    actor: AuthContext,
    membershipId: string,
    ttlDays = 90,
  ): Promise<{ readonly code: string; readonly expiresAt: Date }> {
    const setQr = this.#repository.setMembershipQrCredential?.bind(this.#repository);
    if (setQr === undefined) throw new Error('Staff QR management is unavailable.');
    const code = `POS-QR-${randomBytes(24).toString('base64url')}`;
    const qrSecretHash = await hashPassword(code);
    const qrExpiresAt = new Date(this.#now().getTime() + ttlDays * 86_400_000);
    const affected = await setQr({
      companyId: actor.companyId,
      membershipId,
      qrSecretHash,
      qrExpiresAt,
    });
    if (!affected)
      throw new AppError({
        code: 'not_found',
        message: 'Staff membership not found.',
        statusCode: 404,
      });
    await this.#repository.audit({
      companyId: actor.companyId,
      actorId: actor.userId,
      action: 'auth.staff_qr_issued',
      entityId: membershipId,
    });
    return { code, expiresAt: qrExpiresAt };
  }

  public async revokeStaffQrCredential(actor: AuthContext, membershipId: string): Promise<void> {
    const setQr = this.#repository.setMembershipQrCredential?.bind(this.#repository);
    if (setQr === undefined) throw new Error('Staff QR management is unavailable.');
    const affected = await setQr({
      companyId: actor.companyId,
      membershipId,
      qrSecretHash: null,
      qrExpiresAt: null,
    });
    if (!affected)
      throw new AppError({
        code: 'not_found',
        message: 'Staff membership not found.',
        statusCode: 404,
      });
    await this.#repository.audit({
      companyId: actor.companyId,
      actorId: actor.userId,
      action: 'auth.staff_qr_revoked',
      entityId: membershipId,
    });
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

  public async logout(context: AuthContext, evidence: RequestEvidence = {}): Promise<void> {
    await this.#repository.revokeSession(context.sessionId, 'logout');
    await this.#repository.audit({
      companyId: context.companyId,
      branchId: context.branchId,
      actorId: context.userId,
      action: 'auth.logout',
      entityId: context.sessionId,
      requestId: evidence.requestId,
      correlationId: evidence.correlationId,
    });
  }

  public async logoutAll(
    context: AuthContext,
    exceptCurrent: boolean,
    evidence: RequestEvidence = {},
  ): Promise<number> {
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
      requestId: evidence.requestId,
      correlationId: evidence.correlationId,
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

  // TASK 16.15 — `permittedRegisterIds` absent (undefined/null) means "no
  // register-level narrowing configured" (§35 backward compatibility —
  // see `AuthContext.permittedRegisterIds`'s own doc comment), so this
  // ALWAYS passes in that case; only a non-null array actually narrows.
  // Call sites still call `requireBranchAccess` separately for the
  // register's own branch — this never substitutes for that check.
  public requireRegisterAccess(context: AuthContext, registerId: string): void {
    const scope = context.permittedRegisterIds;
    if (scope != null && !scope.includes(registerId))
      throw new AppError({
        code: 'register_scope_mismatch',
        message: 'Register scope is not authorized.',
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
        code: 'invalid_credentials',
        message: 'Invalid credentials.',
        statusCode: 401,
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

  #transport(clientType: ClientType = 'pos', requested?: TransportMode): TransportMode {
    const mapped: TransportMode = clientType === 'browser' ? 'browser' : 'bearer';
    if (requested !== undefined && requested !== mapped)
      throw new AppError({
        code: 'validation_error',
        message: 'Client transport is invalid.',
        statusCode: 422,
      });
    return mapped;
  }
}
