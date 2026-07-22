export const infrastructureErrorCodes = [
  'configuration_error',
  'authentication_required',
  'invalid_credentials',
  'session_expired',
  'permission_denied',
  'company_scope_mismatch',
  'branch_scope_mismatch',
  'device_revoked',
  'validation_error',
  'not_found',
  'method_not_allowed',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limit_exceeded',
  'service_unavailable',
  'internal_error',
] as const;

export type InfrastructureErrorCode = (typeof infrastructureErrorCodes)[number];

export interface AppErrorOptions {
  readonly code: InfrastructureErrorCode;
  readonly statusCode: number;
  readonly message: string;
  readonly details?: readonly unknown[] | Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  public readonly code: InfrastructureErrorCode;
  public readonly statusCode: number;
  public readonly details: readonly unknown[] | Readonly<Record<string, unknown>> | undefined;

  public constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }

  public toPublicResponse(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    });
  }
}
