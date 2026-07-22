import { createHash, randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import type { AuthContext } from './auth.types.js';

interface TokenOptions {
  readonly audience: string;
  readonly issuer: string;
  readonly secret: string;
  readonly ttlSeconds: number;
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
}
