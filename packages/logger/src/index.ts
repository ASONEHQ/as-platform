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
  'request.headers.cookie',
  'req.headers.cookie',
  'query',
  'request.query',
  'req.query',
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
      serializers: {
        err: pino.stdSerializers.err,
        req(request: { readonly method?: unknown; readonly url?: unknown }) {
          return {
            method: typeof request.method === 'string' ? request.method : undefined,
            path: typeof request.url === 'string' ? request.url.split('?', 1)[0] : undefined,
          };
        },
        res(response: { readonly statusCode?: unknown }) {
          return {
            status: typeof response.statusCode === 'number' ? response.statusCode : undefined,
          };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    options.destination,
  );
}
