export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string | null;
  readonly status: string;
}

export interface AuthMembership {
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly status: string;
}

export interface AuthContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly companyId: string;
  readonly branchId?: string | undefined;
  readonly deviceId?: string | undefined;
  readonly expiresAt: Date;
  readonly transportMode?: TransportMode | undefined;
  readonly tokenGeneration?: number | undefined;
  readonly companyWideAccess?: boolean | undefined;
  readonly permissions: readonly string[];
  readonly permittedBranchIds: readonly string[];
}

export interface LoginInput {
  readonly identifier: string;
  readonly password: string;
  readonly companyId?: string | undefined;
  readonly branchId?: string | undefined;
  readonly deviceId?: string | undefined;
  readonly clientType?: ClientType | undefined;
  readonly transportMode?: TransportMode | undefined;
}

export type ClientType = 'browser' | 'mobile' | 'pos';
export type TransportMode = 'browser' | 'bearer';

// TASK 14.5 (Wave 3, Phase 4b/7 Item 8): quick-switch credential
// candidates for a company. A salted argon2id hash can never be looked
// up by value, so PIN/QR login resolves "which staff member" by scanning
// the small set of memberships in the CALLING SESSION's own company that
// opted into the credential (never across companies — see
// `AuthService#pinLogin`/`#qrLogin`) and verifying each hash in turn.
export interface PinLoginCandidate {
  readonly userId: string;
  readonly membership: AuthMembership;
  readonly pinHash: string;
}

export interface QrLoginCandidate {
  readonly userId: string;
  readonly membership: AuthMembership;
  readonly qrSecretHash: string;
  readonly qrExpiresAt: Date;
}

export interface LoginChallenge {
  readonly id: string;
  readonly userId: string;
  readonly eligibleCompanyIds: readonly string[];
  readonly clientType: ClientType;
  readonly deviceId?: string | undefined;
  readonly expiresAt: Date;
  readonly status: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
}

export interface LoginChallengeCreation {
  readonly userId: string;
  readonly tokenHash: string;
  readonly eligibleCompanyIds: readonly string[];
  readonly clientType: ClientType;
  readonly deviceId?: string | undefined;
  readonly expiresAt: Date;
  readonly requestId?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface SessionCreation extends Omit<
  AuthContext,
  'sessionId' | 'permissions' | 'permittedBranchIds'
> {
  readonly transportMode: TransportMode;
  readonly tokenGeneration: number;
  readonly tokenFamilyId: string;
  readonly tokenHash: string;
}

export interface RefreshLookup {
  readonly context: AuthContext;
  readonly generation: number;
  readonly refreshExpiresAt: Date;
  readonly status: string;
  readonly tokenStatus: string;
}

export interface AuthRepository {
  findUserByNormalizedEmail(email: string): Promise<AuthUser | null>;
  listActiveMemberships(userId: string): Promise<readonly AuthMembership[]>;
  resolveContext(input: {
    userId: string;
    membershipId: string;
    companyId: string;
    branchId?: string | undefined;
    deviceId?: string | undefined;
  }): Promise<Omit<AuthContext, 'sessionId' | 'expiresAt'> | null>;
  createSession(input: SessionCreation): Promise<string>;
  findRefreshToken(tokenHash: string): Promise<RefreshLookup | null>;
  rotateRefreshToken(input: {
    sessionId: string;
    previousHash: string;
    nextHash: string;
    nextGeneration: number;
    expiresAt: Date;
  }): Promise<'rotated' | 'reused' | 'invalid'>;
  findSession(sessionId: string): Promise<AuthContext | null>;
  revokeSession(sessionId: string, reason: string): Promise<boolean>;
  revokeUserSessions(userId: string, companyId: string, exceptSessionId?: string): Promise<number>;
  getSafeIdentity(userId: string): Promise<Readonly<Record<string, unknown>> | null>;
  audit(input: {
    companyId: string;
    branchId?: string | undefined;
    actorId: string;
    action: string;
    entityId?: string | undefined;
    requestId?: string | undefined;
    correlationId?: string | undefined;
    metadata?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<void>;
  createLoginChallenge?(input: LoginChallengeCreation): Promise<void>;
  findLoginChallengeForUpdate?(tokenHash: string): Promise<LoginChallenge | null>;
  incrementChallengeAttempt?(id: string, invalidate: boolean): Promise<void>;
  consumeLoginChallenge?(input: {
    challengeId: string;
    companyId: string;
    session: SessionCreation;
  }): Promise<{ readonly sessionId: string } | 'already_used'>;
  replaceCompanySession?(input: {
    currentSessionId: string;
    replacement: SessionCreation;
  }): Promise<string>;
  switchBranchSession?(input: {
    sessionId: string;
    branchId?: string | undefined;
    nextHash: string;
    nextGeneration: number;
    expiresAt: Date;
  }): Promise<'rotated' | 'invalid'>;
  // TASK 14.5 (Wave 3, Phase 4b): quick-switch PIN. Optional — like the
  // login-challenge/company-switch methods above — so any other
  // `AuthRepository` implementation (e.g. a hand-rolled test double) keeps
  // compiling unchanged until it opts in.
  listPinLoginCandidates?(companyId: string): Promise<readonly PinLoginCandidate[]>;
  setMembershipPin?(input: {
    companyId: string;
    membershipId: string;
    pinHash: string | null;
  }): Promise<boolean>;
  // TASK 14.5 (Wave 3, Phase 7 Item 8): quick-switch staff QR login.
  listQrLoginCandidates?(companyId: string): Promise<readonly QrLoginCandidate[]>;
  setMembershipQrCredential?(input: {
    companyId: string;
    membershipId: string;
    qrSecretHash: string | null;
    qrExpiresAt: Date | null;
  }): Promise<boolean>;
}
