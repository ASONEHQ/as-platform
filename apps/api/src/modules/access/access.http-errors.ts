import { AppError, type InfrastructureErrorCode } from '@asone/errors';

import { AccessError, type AccessErrorCode } from './access.types.js';

/**
 * This task explicitly forbids editing `packages/errors/src/index.ts`
 * directly — every `AppError` constructed below therefore uses an
 * INFRASTRUCTURE code that ALREADY exists in that file's
 * `infrastructureErrorCodes` list (reusing generics, exactly the
 * restraint `held-sales.http-errors.ts`/`purchasing.http-errors.ts`
 * already document for their own domains), never a brand-new literal —
 * inventing one here would fail to typecheck against `InfrastructureErrorCode`
 * and this task requires a clean `typecheck` pass.
 *
 * The six scan-specific rejections this domain's own instructions name
 * (`credential_not_found`, `credential_void`, `wrong_branch`,
 * `already_inside`, `not_inside`, `reentry_not_allowed`) plus
 * `credential_currently_inside` (the void-while-inside rejection) ARE
 * genuinely distinct semantic concepts a generic code alone can't carry —
 * mirroring TASK 13.0/13.1's own "these are genuinely new semantic
 * concepts a generic code cannot express" precedent for adding brand-new
 * infra codes. TASK 14.5 (Wave 3) adds two more of the same real kind:
 * `credential_not_void` (the "unblock" rejection — the reverse of
 * `credential_void`) and `code_already_in_use` (a client-supplied
 * wristband UID collision). Since this task's own constraints prevent
 * adding them directly, they are carried in full, honestly, in TWO places
 * every caller can already rely on: (a) `error.message`, always the exact
 * specific sentence for the specific rejection, and (b) `error.details.
 * reason`, the exact `AccessErrorCode` string itself (e.g.
 * `"already_inside"`), so a client can already branch on the specific
 * reason today via `details.reason` without waiting on a
 * `packages/errors` change. See this module's own final task report for
 * the exact 9-entry snippet recommended for `infrastructureErrorCodes` —
 * adding it later is a strict, additive upgrade: once added, this
 * mapping only needs `code: error.code` swapped in for the reused
 * generic below, `details` dropped, nothing else.
 */
const accessErrorStatus: Readonly<Record<AccessErrorCode, number>> = {
  validation_error: 400,
  idempotency_conflict: 409,
  resource_not_found: 404,
  credential_not_found: 404,
  credential_void: 409,
  wrong_branch: 409,
  already_inside: 409,
  not_inside: 409,
  reentry_not_allowed: 409,
  credential_currently_inside: 409,
  // TASK 14.5 (Wave 3) additions — see `access.types.ts`'s own doc
  // comment on `AccessErrorCode` for the full reasoning on each.
  credential_not_void: 409,
  code_already_in_use: 409,
};

const accessErrorInfraCode: Readonly<Record<AccessErrorCode, InfrastructureErrorCode>> = {
  validation_error: 'validation_error',
  idempotency_conflict: 'idempotency_conflict',
  resource_not_found: 'not_found',
  credential_not_found: 'not_found',
  credential_void: 'resource_conflict',
  wrong_branch: 'resource_conflict',
  already_inside: 'resource_conflict',
  not_inside: 'resource_conflict',
  reentry_not_allowed: 'resource_conflict',
  credential_currently_inside: 'resource_conflict',
  credential_not_void: 'resource_conflict',
  code_already_in_use: 'resource_conflict',
};

// These are the only 9 codes that ever carry the specific-reason detail
// (see this file's own top doc comment) — every other code's own message
// is already fully specific on its own.
const specificReasonCodes = new Set<AccessErrorCode>([
  'credential_not_found',
  'credential_void',
  'wrong_branch',
  'already_inside',
  'not_inside',
  'reentry_not_allowed',
  'credential_currently_inside',
  'credential_not_void',
  'code_already_in_use',
]);

export function mapAccessError(error: unknown): Error {
  if (!(error instanceof AccessError)) return error instanceof Error ? error : new Error('Unknown error');
  return new AppError({
    code: accessErrorInfraCode[error.code],
    message: error.message,
    statusCode: accessErrorStatus[error.code],
    ...(specificReasonCodes.has(error.code) ? { details: { reason: error.code } } : {}),
  });
}

export async function withAccessErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapAccessError(error);
  }
}
