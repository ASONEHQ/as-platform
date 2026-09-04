import { AppError } from '@asone/errors';

import { MembershipError } from './memberships.types.js';

const membershipErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
  membership_plan_inactive: 409,
  membership_not_active: 409,
};

export function mapMembershipError(error: unknown): Error {
  if (!(error instanceof MembershipError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = membershipErrorStatus[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withMembershipErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapMembershipError(error);
  }
}
