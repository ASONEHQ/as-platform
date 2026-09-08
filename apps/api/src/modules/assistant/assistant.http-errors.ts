import { AppError } from '@asone/errors';

import { AssistantError } from './assistant.types.js';

// Mirrors `reports.http-errors.ts`'s own established shape exactly:
// `validation_error` is already a member of `InfrastructureErrorCode`
// (packages/errors) — this domain reuses that existing generic code
// rather than inventing a new one (see `assistant.types.ts`'s own doc
// comment).
const assistantErrorStatus: Readonly<Record<string, number>> = {
  validation_error: 400,
};

export function mapAssistantError(error: unknown): Error {
  if (!(error instanceof AssistantError)) return error instanceof Error ? error : new Error('Unknown error');
  const statusCode = assistantErrorStatus[error.code] ?? 400;
  return new AppError({ code: error.code, message: error.message, statusCode });
}

export async function withAssistantErrors<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    throw mapAssistantError(error);
  }
}
