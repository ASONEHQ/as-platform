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
  readonly permissions: readonly string[];
  readonly permittedBranchIds: readonly string[];
}

export interface LoginInput {
  readonly identifier: string;
  readonly password: string;
  readonly companyId?: string | undefined;
  readonly branchId?: string | undefined;
  readonly deviceId?: string | undefined;
}

export interface SessionCreation extends Omit<
  AuthContext,
  'sessionId' | 'permissions' | 'permittedBranchIds'
> {
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
    metadata?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<void>;
}
