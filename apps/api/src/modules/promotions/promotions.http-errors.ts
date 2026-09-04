import { AppError } from '@asone/errors';

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
