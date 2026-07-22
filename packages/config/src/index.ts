import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

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
  return Object.freeze({
    ...toSharedConfig(value),
    apiHost: value.API_HOST,
    apiPort: value.API_PORT,
  });
}

export function loadWorkerConfig(environment: Environment = process.env): WorkerConfig {
  return toSharedConfig(sharedSchema.parse(environment));
}
