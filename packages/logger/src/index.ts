import pino, { type DestinationStream, type Logger, type LevelWithSilent } from 'pino';

export const sensitivePaths = Object.freeze([
  'authorization',
  'cookie',
  'password',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'api_key',
  'database_url',
  'redis_url',
  'headers.authorization',
  'request.headers.authorization',
  'req.headers.authorization',
]);

export interface LoggerOptions {
  readonly service: string;
  readonly level: LevelWithSilent;
  readonly environment: 'development' | 'test' | 'production';
  readonly destination?: DestinationStream;
  readonly base?: Readonly<Record<string, unknown>>;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      base: { service: options.service, ...options.base },
      level: options.level,
      redact: { censor: '[Redacted]', paths: [...sensitivePaths] },
      serializers: { err: pino.stdSerializers.err },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    options.destination,
  );
}
