import type { AuthContext } from '../../auth/auth.types.js';

export interface AdminActor {
  readonly context: AuthContext;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface PageInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
