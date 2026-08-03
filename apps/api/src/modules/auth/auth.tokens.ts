import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import type { AuthContext } from './auth.types.js';

interface TokenOptions {
  readonly audience: string;
  readonly issuer: string;
  readonly secret: string;
  readonly ttlSeconds: number;
}

interface CsrfPayload {
  readonly exp: number;
  readonly gen: number;
  readonly iat: number;
  readonly mode: string;
  readonly sid: string;
}

export class AuthTokens {
  readonly #audience: string;
  readonly #issuer: string;
  readonly #secret: Uint8Array;
  readonly #ttlSeconds: number;

  public constructor(options: TokenOptions) {
    this.#audience = options.audience;
    this.#issuer = options.issuer;
    this.#secret = new TextEncoder().encode(options.secret);
    this.#ttlSeconds = options.ttlSeconds;
  }

  public async signAccessToken(context: AuthContext): Promise<string> {
    return new SignJWT({
      cid: context.companyId,
      mid: context.membershipId,
      ...(context.branchId === undefined ? {} : { bid: context.branchId }),
      ...(context.deviceId === undefined ? {} : { did: context.deviceId }),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(context.userId)
      .setJti(context.sessionId)
      .setIssuer(this.#issuer)
      .setAudience(this.#audience)
      .setIssuedAt()
      .setExpirationTime(`${String(this.#ttlSeconds)}s`)
      .sign(this.#secret);
  }

  public async verifyAccessToken(token: string): Promise<{ sessionId: string; userId: string }> {
    const result = await jwtVerify(token, this.#secret, {
      algorithms: ['HS256'],
      audience: this.#audience,
      issuer: this.#issuer,
      typ: 'JWT',
    });
    if (result.payload.sub === undefined || result.payload.jti === undefined)
      throw new Error('claims');
    return { sessionId: result.payload.jti, userId: result.payload.sub };
  }

  public createRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  public hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  public createChallengeToken(): string {
    return randomBytes(32).toString('base64url');
  }

  public csrfToken(
    sessionId: string,
    generation: number,
    issuedAt = new Date(),
    ttlSeconds = 120,
  ): { readonly expiresAt: Date; readonly token: string } {
    const issued = Math.floor(issuedAt.getTime() / 1_000);
    const expiresAt = new Date((issued + ttlSeconds) * 1_000);
    const encoded = Buffer.from(
      JSON.stringify({
        exp: issued + ttlSeconds,
        gen: generation,
        iat: issued,
        mode: 'browser',
        sid: sessionId,
      }),
      'utf8',
    ).toString('base64url');
    const signature = createHmac('sha256', this.#secret)
      .update(encoded, 'utf8')
      .digest('base64url');
    return { expiresAt, token: `${encoded}.${signature}` };
  }

  public verifyCsrfToken(
    token: string,
    sessionId: string,
    generation: number,
    now = new Date(),
  ): boolean {
    const [encoded, signature, extra] = token.split('.');
    if (encoded === undefined || signature === undefined || extra !== undefined) return false;
    const expected = Buffer.from(
      createHmac('sha256', this.#secret).update(encoded, 'utf8').digest('base64url'),
    );
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CsrfPayload;
      const current = Math.floor(now.getTime() / 1_000);
      return (
        payload.sid === sessionId &&
        payload.gen === generation &&
        payload.mode === 'browser' &&
        Number.isInteger(payload.iat) &&
        Number.isInteger(payload.exp) &&
        payload.iat <= current &&
        payload.exp > current &&
        payload.exp - payload.iat <= 120
      );
    } catch {
      return false;
    }
  }
}
