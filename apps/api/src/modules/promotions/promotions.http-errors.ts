import { AppError } from '@asone/errors';

import { mapRewardError } from '../rewards/rewards.http-errors.js';
import { RewardError } from '../rewards/rewards.types.js';
import { PromotionError } from './promotions.types.js';

const promotionErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
  resource_not_found: 404,
  resource_conflict: 409,
  version_conflict: 409,
  coupon_not_found: 404,
  coupon_inactive: 409,
  coupon_not_started: 409,
  coupon_expired: 409,
  coupon_branch_not_eligible: 409,
  coupon_usage_exhausted: 409,
  coupon_cart_not_eligible: 409,
  discount_not_authorized: 403,
  discount_invalid: 400,
};

export function mapPromotionError(error: unknown): Error {
  // TASK 13.2 — `quote()` now optionally resolves a reward benefit via
  // `RewardsService.resolveCheckoutBenefit`, which throws its OWN
  // `RewardError` codes (`reward_expired`/`reward_already_redeemed`/
  // etc.) — checked FIRST so those specific reasons reach the caller
  // (Part O "eligibility errors surface clearly"), never collapsed into
  // this module's own generic 409 default.
  if (error instanceof RewardError) return mapRewardError(error);
  if (!(error instanceof PromotionError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = promotionErrorStatus[error.code] ?? 409;
  if (statusCode === 404)
    return new AppError({ code: 'not_found', message: 'The resource was not found.', statusCode: 404 });
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withPromotionErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapPromotionError(error);
  }
}
