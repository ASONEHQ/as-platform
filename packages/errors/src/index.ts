export const infrastructureErrorCodes = [
  'configuration_error',
  'service_unavailable',
  'internal_error',
] as const;

export type InfrastructureErrorCode = (typeof infrastructureErrorCodes)[number];

export interface AppErrorOptions {
  readonly code: InfrastructureErrorCode;
  readonly statusCode: number;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  public readonly code: InfrastructureErrorCode;
  public readonly statusCode: number;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

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
