import { AppError } from '@asone/errors';

import { RewardError } from './rewards.types.js';

const rewardErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  permission_denied: 403,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
  reward_not_available: 409,
  reward_expired: 409,
  reward_already_redeemed: 409,
  reward_already_revoked: 409,
  reward_branch_not_eligible: 409,
  reward_token_invalid: 404,
};

export function mapRewardError(error: unknown): Error {
  if (!(error instanceof RewardError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = rewardErrorStatus[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withRewardErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapRewardError(error);
  }
}
