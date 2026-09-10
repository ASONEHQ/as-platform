import { z, ZodError } from 'zod';

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
  // PRODUCTION_GAPS.md section 5 / TASK 14.1 section C: an explicit,
  // documented escape hatch for the (real, common) case where TLS to
  // Postgres is terminated *outside* the `pg` driver entirely — e.g. a
  // Cloud SQL Auth Proxy or an `stunnel` sidecar that the app connects to
  // over a local socket/loopback address, with the sidecar itself carrying
  // the encrypted connection the rest of the way. In that architecture
  // `DATABASE_URL` correctly has no `sslmode` parameter, so
  // `validateProductionDatabaseTls` below would otherwise reject it. An
  // operator must set this explicitly to `true` to opt out of the
  // in-connection-string TLS requirement; it defaults to `false`, so the
  // default posture stays fail-closed.
  DATABASE_TLS_EXTERNALLY_TERMINATED: booleanSchema.default(false),
  // TASK 16.2D: a real DigitalOcean Managed Valkey/Redis cluster's own
  // connection URI uses `rediss://` (TLS required — confirmed via
  // DigitalOcean's own documentation: "all DigitalOcean database clusters
  // are encrypted with TLS/SSL", example format
  // `rediss://default:<password>@<host>:25061`), which the previous
  // `redis://`-only check rejected outright, causing every real managed-
  // Redis deployment to fail `loadApiConfig()` at boot with no visible
  // reason (see the `server.ts` diagnostic fix in the same commit). The
  // real `redis` npm client (v5) already resolves TLS automatically from
  // the `rediss://` scheme with no extra socket configuration needed
  // (`createClient({ url: ... })` in `infrastructure/dependencies.ts`) —
  // this was purely a schema gap, not a missing runtime capability.
  // `redis://` remains accepted unchanged for local/test loopback Redis,
  // which has no TLS.
  REDIS_URL: z
    .url()
    .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
      message: 'Invalid string: must start with "redis://" or "rediss://"',
    }),
  // TASK 16.3A — the PEM-encoded CA certificate content (never a file
  // path) `packages/database`'s `createDatabaseClient` should trust when
  // `DATABASE_URL`'s `sslmode` is `verify-ca`/`verify-full` — e.g.
  // DigitalOcean Managed PostgreSQL "Standard Edition"'s own downloadable
  // CA certificate. Optional: `sslmode=require` (the fail-closed-but-
  // unverified production default already enforced by
  // `validateProductionDatabaseTls` below) never uses it, and `verify-ca`/
  // `verify-full` still fall back to Node's default trusted root store
  // without it — this only ever WIDENS what a verifying connection can
  // trust, never weakens verification. Not a secret — a CA certificate is
  // public by design — but still never logged in full by this codebase's
  // own discipline of not echoing raw config values (see
  // `describeConfigError` below).
  DATABASE_SSL_CA_CERT: z.string().min(1).optional(),
});

// PRODUCTION_GAPS.md section K1: mirrors the placeholder/weak-secret
// rejection `validateBootstrapPassword` already applies to the dev-only
// `AS_DEV_BOOTSTRAP_PASSWORD` (see
// apps/api/src/development/bootstrap-owner.service.ts). Nothing equivalent
// previously existed for `AUTH_ACCESS_TOKEN_SECRET`, the real production
// auth/session secret — `.min(32)` alone accepts an obviously unsafe value
// such as 32 repeated characters or "replace_me_replace_me_replace_me...".
// Scoped to NODE_ENV === 'production' only, so local/test fixtures using a
// readable literal (see index.test.ts) are never affected.
const weakSecretPlaceholders = Object.freeze([
  'changeme',
  'change_me',
  'change-me',
  'replace_me',
  'replace-me',
  'placeholder',
  'example',
  'secret_here',
  'your_secret',
  'insert_secret',
  'local_only',
  'localhost',
  'todo',
]);

function isWeakProductionSecret(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  if (new Set(normalized).size < 4) return true;
  return weakSecretPlaceholders.some((placeholder) => normalized.includes(placeholder));
}

// PRODUCTION_GAPS.md section 5 / TASK 14.1 section C: previously nothing
// enforced TLS to Postgres in code — it depended entirely on an operator
// remembering to put `sslmode=require` (or equivalent) in `DATABASE_URL`
// themselves, undocumented and unvalidated. `sslmode=require`/`verify-ca`/
// `verify-full` all request an encrypted connection (see
// `sslOptionForMode` in packages/database/src/client.ts, which now
// actually threads the resulting `ssl` option into the real `pg.Pool`
// construction); `disable` (or no `sslmode` at all) does not. Same
// `.superRefine`, same `NODE_ENV === 'production'` scoping pattern as the
// `AUTH_ACCESS_TOKEN_SECRET` check immediately below — local/test fixtures
// using a loopback `DATABASE_URL` with no `sslmode` are never affected.
const tlsVerifiedSslModes = new Set(['require', 'verify-ca', 'verify-full']);

function extractSslModeFromDatabaseUrl(databaseUrl: string): string | undefined {
  try {
    return new URL(databaseUrl).searchParams.get('sslmode') ?? undefined;
  } catch {
    return undefined;
  }
}

function databaseUrlRequestsTls(databaseUrl: string): boolean {
  const mode = extractSslModeFromDatabaseUrl(databaseUrl);
  return mode !== undefined && tlsVerifiedSslModes.has(mode);
}

function validateProductionDatabaseTls(
  value: {
    readonly NODE_ENV: z.infer<typeof environmentSchema>;
    readonly DATABASE_URL: string;
    readonly DATABASE_TLS_EXTERNALLY_TERMINATED: boolean;
  },
  context: z.RefinementCtx,
): void {
  if (value.NODE_ENV !== 'production') return;
  if (value.DATABASE_TLS_EXTERNALLY_TERMINATED) return;
  if (databaseUrlRequestsTls(value.DATABASE_URL)) return;
  context.addIssue({
    code: 'custom',
    path: ['DATABASE_URL'],
    message:
      'DATABASE_URL must request TLS in production: add sslmode=require, sslmode=verify-ca, ' +
      'or sslmode=verify-full to the connection string. If TLS is already terminated outside ' +
      'the Postgres driver (e.g. a Cloud SQL Auth Proxy or stunnel sidecar), set ' +
      'DATABASE_TLS_EXTERNALLY_TERMINATED=true instead.',
  });
}

// Applies the production DB-TLS check to the shared schema alone (used by
// `loadWorkerConfig` — the worker opens its own Postgres pool and must be
// held to the exact same policy as the API, see
// apps/worker/src/infrastructure.ts). `sharedSchema` itself stays a plain
// `ZodObject` (not wrapped in `.superRefine`) so `apiSchema` below can still
// `.extend()` it.
const sharedSchemaWithProductionChecks = sharedSchema.superRefine(validateProductionDatabaseTls);

const apiSchema = sharedSchema
  .extend({
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
    // TASK 12.4B.1: Mercado Pago Point provider credentials. Deliberately
    // optional — the app must still boot in any environment that has no
    // provider configured yet (local dev, CI, a company that hasn't set up
    // Point). The specific provider call fails cleanly and explicitly
    // (`PaymentProviderError('not_configured', ...)`) only when actually
    // invoked without them — see providers/mercado-pago.provider.ts. Never
    // a secret with a baked-in default.
    MERCADO_PAGO_ACCESS_TOKEN: z.string().trim().min(1).optional(),
    MERCADO_PAGO_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
    MERCADO_PAGO_API_BASE_URL: z.url().default('https://api.mercadopago.com'),
  })
  .superRefine((value, context) => {
    validateProductionDatabaseTls(value, context);
    if (value.NODE_ENV === 'production' && isWeakProductionSecret(value.AUTH_ACCESS_TOKEN_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_ACCESS_TOKEN_SECRET'],
        message:
          'AUTH_ACCESS_TOKEN_SECRET must not be a low-entropy or placeholder value in production.',
      });
    }
  });

export interface SharedConfig {
  readonly nodeEnv: z.infer<typeof environmentSchema>;
  readonly appName: string;
  readonly appVersion: string;
  readonly logLevel: z.infer<typeof logLevelSchema>;
  readonly databaseUrl: string;
  readonly databaseTlsExternallyTerminated: boolean;
  readonly databaseSslCaCert: string | undefined;
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
  readonly mercadoPagoAccessToken: string | undefined;
  readonly mercadoPagoWebhookSecret: string | undefined;
  readonly mercadoPagoApiBaseUrl: string;
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
    databaseTlsExternallyTerminated: value.DATABASE_TLS_EXTERNALLY_TERMINATED,
    databaseSslCaCert: value.DATABASE_SSL_CA_CERT,
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
    mercadoPagoAccessToken: value.MERCADO_PAGO_ACCESS_TOKEN,
    mercadoPagoWebhookSecret: value.MERCADO_PAGO_WEBHOOK_SECRET,
    mercadoPagoApiBaseUrl: value.MERCADO_PAGO_API_BASE_URL,
  });
}

export function loadWorkerConfig(environment: Environment = process.env): WorkerConfig {
  return toSharedConfig(sharedSchemaWithProductionChecks.parse(environment));
}

// TASK 16.2D: `loadApiConfig`/`loadWorkerConfig` throwing a bare, opaque
// "configuration is invalid" (see `server.ts`) left a real production
// startup failure with zero visible reason — an operator had no way to
// tell "REDIS_URL has the wrong scheme" from "AUTH_ACCESS_TOKEN_SECRET is
// too weak" from any other real cause without a local repro. This helper
// is the one, single, centrally-owned place allowed to decide what's safe
// to surface: every `ZodIssue.message` in this file is deliberately
// written to describe a *constraint* ("must start with...", "must have
// >=32 characters", "must request TLS...") and never to echo the actual
// received value back — confirmed for every issue shape this schema can
// produce (built-in `too_small`/`invalid_format`/`invalid_type` messages
// included, which do not include the received value either). Returns
// `undefined` for any error that is not a real `ZodError` (an unexpected
// throw from somewhere else), so the caller can fall back to the fully
// generic message rather than guessing at an unfamiliar error shape.
// NEVER extend this to print `issue.input`/`issue.received` or any other
// field a future Zod version might add that could carry the actual value.
export function describeConfigError(error: unknown): readonly string[] | undefined {
  if (!(error instanceof ZodError)) return undefined;
  return Object.freeze(error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
}
