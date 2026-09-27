import { AppError } from '@asone/errors';

import { ProductRecipeError } from './product-recipes.types.js';

export function mapProductRecipeError(error: unknown): Error {
  if (!(error instanceof ProductRecipeError))
    return error instanceof Error ? error : new Error('Unknown error');
  if (error.code === 'resource_not_found')
    return new AppError({
      code: 'not_found',
      message: 'The resource was not found.',
      statusCode: 404,
    });
  return new AppError({
    code: error.code,
    message: error.message,
    statusCode: error.code === 'validation_error' ? 400 : 409,
  });
}

export async function withProductRecipeErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapProductRecipeError(error);
  }
}
