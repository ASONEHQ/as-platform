import { AppError, type InfrastructureErrorCode } from '@asone/errors';

import { HeldSaleCartError, type HeldSaleCartErrorCode } from './held-sales.types.js';

const statusCodeByCode: Readonly<Record<string, number>> = {
  resource_not_found: 404,
  validation_error: 400,
  idempotency_conflict: 409,
  invalid_cart_state: 409,
  forbidden: 403,
};

// This domain is not pre-reserved anywhere, and every one of its
// rejections is already fully expressed by an existing generic code —
// matching this codebase's own established "reuse a generic before
// inventing a new semantic one" convention (see TASK 13.0/13.1/14.3
// Part A's own precedent in `packages/errors/src/index.ts`).
// `invalid_cart_state` reuses `resource_conflict` (the same generic
// "wrong state for this action" code `catalog`/`inventory` already use);
// `forbidden` reuses `permission_denied` (identical to every other
// permission rejection in this codebase); `resource_not_found` is
// handled below exactly like `sales`/`cash`'s own mappers (never `error.
// code` passed straight through — always the shared `not_found`).
const infrastructureCodeByCode: Readonly<Record<HeldSaleCartErrorCode, InfrastructureErrorCode>> = {
  resource_not_found: 'not_found',
  validation_error: 'validation_error',
  idempotency_conflict: 'idempotency_conflict',
  invalid_cart_state: 'resource_conflict',
  forbidden: 'permission_denied',
};

export function mapHeldSaleCartError(error: unknown): Error {
  if (!(error instanceof HeldSaleCartError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = statusCodeByCode[error.code] ?? 409;
  return new AppError({ code: infrastructureCodeByCode[error.code], message: error.message, statusCode });
}

export async function withHeldSaleCartErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapHeldSaleCartError(error);
  }
}
