import { AppError } from '@asone/errors';

import { CatalogApplicationError } from './catalog.types.js';

export function mapCatalogError(error: unknown): Error {
  if (!(error instanceof CatalogApplicationError))
    return error instanceof Error ? error : new Error('Unknown error');
  const details = error.details === undefined ? {} : { details: error.details };
  switch (error.code) {
    case 'invalid_input':
      return new AppError({
        code: 'validation_error',
        message: error.message,
        statusCode: 400,
        ...details,
      });
    case 'resource_not_found':
      return new AppError({
        code: 'not_found',
        message: 'The resource was not found.',
        statusCode: 404,
      });
    case 'version_conflict':
      return new AppError({
        code: 'version_conflict',
        message: error.message,
        statusCode: 409,
        ...details,
      });
    case 'idempotency_conflict':
    case 'duplicate_category_code':
    case 'category_cycle_detected':
    case 'duplicate_brand_code':
    case 'product_has_active_dependencies':
      return new AppError({
        code: error.code,
        message: error.message,
        statusCode: 409,
        ...details,
      });
  }
}
export async function withCatalogErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapCatalogError(error);
  }
}
