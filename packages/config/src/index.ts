import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const booleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');
const optionalBooleanSchema = z.enum(['true', 'false']).optional();
const corsOriginsSchema = z
  .string()
  .default('http://localhost:3000,http://127.0.0.1:3000')
  .transform((value, context) => {
    const origins = [
      ...new Set(
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    ];
    if (origins.some((origin) => origin === '*' || !URL.canParse(origin))) {
      context.addIssue({ code: 'custom', message: 'CORS origins must be explicit URLs.' });
      return z.NEVER;
    }
    return Object.freeze(origins);
  });

const sharedSchema = z.object({
  NODE_ENV: environmentSchema,
  APP_NAME: z.string().trim().min(1),
  APP_VERSION: z.string().trim().min(1),
  LOG_LEVEL: logLevelSchema,
  DATABASE_URL: z.url().startsWith('postgresql://'),
  REDIS_URL: z.url().startsWith('redis://'),
});

const apiSchema = sharedSchema.extend({
  API_HOST: z.string().trim().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  AUTH_JWT_AUDIENCE: z.string().trim().min(1),
  AUTH_JWT_ISSUER: z.string().trim().min(1),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(10),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3_600)
    .max(31_536_000)
    .default(2_592_000),
  CORS_ALLOWED_ORIGINS: corsOriginsSchema,
  KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(72_000),
  METRICS_ENABLED: optionalBooleanSchema,
  OPENAPI_UI_ENABLED: optionalBooleanSchema,
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  TRUST_PROXY: booleanSchema.default(false),
});

export interface SharedConfig {
  readonly nodeEnv: z.infer<typeof environmentSchema>;
  readonly appName: string;
  readonly appVersion: string;
  readonly logLevel: z.infer<typeof logLevelSchema>;
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

export interface ApiConfig extends SharedConfig {
  readonly apiHost: string;
  readonly apiPort: number;
  readonly authAccessTokenSecret: string;
  readonly authAccessTokenTtlSeconds: number;
  readonly authJwtAudience: string;
  readonly authJwtIssuer: string;
  readonly authLoginRateLimitMax: number;
  readonly authLoginRateLimitWindowMs: number;
  readonly authRefreshTokenTtlSeconds: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly keepAliveTimeoutMs: number;
  readonly metricsEnabled: boolean;
  readonly openapiUiEnabled: boolean;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly requestBodyLimitBytes: number;
  readonly requestTimeoutMs: number;
  readonly trustProxy: boolean;
}

export type WorkerConfig = SharedConfig;

type Environment = Readonly<Record<string, string | undefined>>;

function toSharedConfig(value: z.infer<typeof sharedSchema>): SharedConfig {
  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    appName: value.APP_NAME,
    appVersion: value.APP_VERSION,
    logLevel: value.LOG_LEVEL,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
  });
}

export function loadApiConfig(environment: Environment = process.env): ApiConfig {
  const value = apiSchema.parse(environment);
  const isDevelopment = value.NODE_ENV === 'development';
  return Object.freeze({
    ...toSharedConfig(value),
    apiHost: value.API_HOST,
    apiPort: value.API_PORT,
    authAccessTokenSecret: value.AUTH_ACCESS_TOKEN_SECRET,
    authAccessTokenTtlSeconds: value.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    authJwtAudience: value.AUTH_JWT_AUDIENCE,
    authJwtIssuer: value.AUTH_JWT_ISSUER,
    authLoginRateLimitMax: value.AUTH_LOGIN_RATE_LIMIT_MAX,
    authLoginRateLimitWindowMs: value.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
    authRefreshTokenTtlSeconds: value.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    corsAllowedOrigins: value.CORS_ALLOWED_ORIGINS,
    keepAliveTimeoutMs: value.KEEP_ALIVE_TIMEOUT_MS,
    metricsEnabled:
      value.METRICS_ENABLED === undefined ? isDevelopment : value.METRICS_ENABLED === 'true',
    openapiUiEnabled:
      value.OPENAPI_UI_ENABLED === undefined ? isDevelopment : value.OPENAPI_UI_ENABLED === 'true',
    rateLimitMax: value.RATE_LIMIT_MAX,
    rateLimitWindowMs: value.RATE_LIMIT_WINDOW_MS,
    requestBodyLimitBytes: value.REQUEST_BODY_LIMIT_BYTES,
    requestTimeoutMs: value.REQUEST_TIMEOUT_MS,
    trustProxy: value.TRUST_PROXY,
  });
}

export function loadWorkerConfig(environment: Environment = process.env): WorkerConfig {
  return toSharedConfig(sharedSchema.parse(environment));
}
