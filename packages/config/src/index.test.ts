import { describe, expect, it } from 'vitest';

import { loadApiConfig, loadWorkerConfig } from './index.js';

const validEnvironment = {
  NODE_ENV: 'test',
  APP_NAME: 'asone-test',
  APP_VERSION: '0.1.0-test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  AUTH_ACCESS_TOKEN_SECRET: 'test-secret-that-is-at-least-32-characters',
  AUTH_JWT_AUDIENCE: 'asone-api-test',
  AUTH_JWT_ISSUER: 'https://api.test.asone.mx',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/asone_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
} as const;

describe('configuration', () => {
  it('loads typed immutable API and worker configuration', () => {
    const api = loadApiConfig(validEnvironment);
    const worker = loadWorkerConfig(validEnvironment);

    expect(api.apiPort).toBe(3000);
    expect(api.authAccessTokenTtlSeconds).toBe(900);
    expect(api.authRefreshTokenTtlSeconds).toBe(2_592_000);
    expect(api.corsAllowedOrigins).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(api.openapiUiEnabled).toBe(false);
    expect(api.metricsEnabled).toBe(false);
    expect(api.requestBodyLimitBytes).toBe(1_048_576);
    expect(worker.nodeEnv).toBe('test');
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(worker)).toBe(true);
  });

  it('fails when required configuration is incomplete', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'test' })).toThrow();
  });

  it('rejects wildcard and malformed CORS origins', () => {
    expect(() => loadApiConfig({ ...validEnvironment, CORS_ALLOWED_ORIGINS: '*' })).toThrow();
    expect(() =>
      loadApiConfig({ ...validEnvironment, CORS_ALLOWED_ORIGINS: 'not-a-url' }),
    ).toThrow();
  });

  it('loads explicit security and observability settings', () => {
    const config = loadApiConfig({
      ...validEnvironment,
      METRICS_ENABLED: 'true',
      OPENAPI_UI_ENABLED: 'true',
      TRUST_PROXY: 'true',
    });

    expect(config.metricsEnabled).toBe(true);
    expect(config.openapiUiEnabled).toBe(true);
    expect(config.trustProxy).toBe(true);
  });

  // TASK 12.4B.1: the app must still boot with no Mercado Pago
  // configuration at all — "fail safely if configuration is missing"
  // means the specific provider call fails cleanly when invoked, not
  // that the whole process refuses to start.
  it('boots with no Mercado Pago configuration, leaving the credentials undefined', () => {
    const config = loadApiConfig(validEnvironment);
    expect(config.mercadoPagoAccessToken).toBeUndefined();
    expect(config.mercadoPagoWebhookSecret).toBeUndefined();
    expect(config.mercadoPagoApiBaseUrl).toBe('https://api.mercadopago.com');
  });

  it('loads explicit Mercado Pago configuration when provided', () => {
    const config = loadApiConfig({
      ...validEnvironment,
      MERCADO_PAGO_ACCESS_TOKEN: 'TEST-fixture-token',
      MERCADO_PAGO_WEBHOOK_SECRET: 'fixture-webhook-secret',
      MERCADO_PAGO_API_BASE_URL: 'https://sandbox.example.test',
    });
    expect(config.mercadoPagoAccessToken).toBe('TEST-fixture-token');
    expect(config.mercadoPagoWebhookSecret).toBe('fixture-webhook-secret');
    expect(config.mercadoPagoApiBaseUrl).toBe('https://sandbox.example.test');
  });

  // PRODUCTION_GAPS.md section K1: a placeholder or low-entropy
  // AUTH_ACCESS_TOKEN_SECRET must never be accepted in production, even
  // though it satisfies the plain `.min(32)` length check.
  it('rejects a placeholder or low-entropy AUTH_ACCESS_TOKEN_SECRET in production', () => {
    const productionEnvironment = {
      ...validEnvironment,
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://app.asone.mx',
    } as const;
    expect(() =>
      loadApiConfig({
        ...productionEnvironment,
        AUTH_ACCESS_TOKEN_SECRET: 'replace_me_replace_me_replace_me_replace_me',
      }),
    ).toThrow();
    expect(() =>
      loadApiConfig({
        ...productionEnvironment,
        AUTH_ACCESS_TOKEN_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).toThrow();
  });

  it('accepts a high-entropy AUTH_ACCESS_TOKEN_SECRET in production', () => {
    const config = loadApiConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://app.asone.mx',
      AUTH_ACCESS_TOKEN_SECRET: 'Qx7$kP2mLwZ9!vR4tBn8&hJ1cYs6@Fg3D',
      // Production also enforces the DB TLS policy (see the tests below) —
      // this fixture is only about the secret-strength check, so satisfy
      // that policy with sslmode=require to isolate what's under test.
      DATABASE_URL: 'postgresql://prod:prod@db.example.com:5432/asone_prod?sslmode=require',
    });
    expect(config.authAccessTokenSecret).toBe('Qx7$kP2mLwZ9!vR4tBn8&hJ1cYs6@Fg3D');
  });

  // PRODUCTION_GAPS.md section 5 / TASK 14.1 section C: a `DATABASE_URL`
  // with no TLS indication must never be accepted in production — TLS
  // previously depended entirely on an operator remembering to add
  // `sslmode=require` themselves, with nothing validating it.
  const productionEnvironment = {
    ...validEnvironment,
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://app.asone.mx',
    AUTH_ACCESS_TOKEN_SECRET: 'Qx7$kP2mLwZ9!vR4tBn8&hJ1cYs6@Fg3D',
  } as const;

  it('rejects a production DATABASE_URL with no TLS indication', () => {
    expect(() =>
      loadApiConfig({
        ...productionEnvironment,
        DATABASE_URL: 'postgresql://prod:prod@db.example.com:5432/asone_prod',
      }),
    ).toThrow();
  });

  it('rejects a production DATABASE_URL with sslmode=disable', () => {
    expect(() =>
      loadApiConfig({
        ...productionEnvironment,
        DATABASE_URL: 'postgresql://prod:prod@db.example.com:5432/asone_prod?sslmode=disable',
      }),
    ).toThrow();
  });

  it('accepts a production DATABASE_URL with sslmode=require or verify-full', () => {
    const requireConfig = loadApiConfig({
      ...productionEnvironment,
      DATABASE_URL: 'postgresql://prod:prod@db.example.com:5432/asone_prod?sslmode=require',
    });
    expect(requireConfig.databaseUrl).toContain('sslmode=require');

    const verifyFullConfig = loadApiConfig({
      ...productionEnvironment,
      DATABASE_URL: 'postgresql://prod:prod@db.example.com:5432/asone_prod?sslmode=verify-full',
    });
    expect(verifyFullConfig.databaseUrl).toContain('sslmode=verify-full');
  });

  it('accepts a production DATABASE_URL with no sslmode when TLS is externally terminated', () => {
    const config = loadApiConfig({
      ...productionEnvironment,
      DATABASE_URL: 'postgresql://prod:prod@127.0.0.1:5432/asone_prod',
      DATABASE_TLS_EXTERNALLY_TERMINATED: 'true',
    });
    expect(config.databaseTlsExternallyTerminated).toBe(true);
  });

  it('leaves dev/test DATABASE_URL validation completely unaffected by the TLS check', () => {
    const config = loadApiConfig(validEnvironment);
    expect(config.nodeEnv).toBe('test');
    expect(config.databaseUrl).toBe('postgresql://local:local@127.0.0.1:5432/asone_test');
    expect(config.databaseTlsExternallyTerminated).toBe(false);

    const worker = loadWorkerConfig(validEnvironment);
    expect(worker.databaseUrl).toBe('postgresql://local:local@127.0.0.1:5432/asone_test');
  });

  it('also enforces the production DB TLS policy for the worker config', () => {
    expect(() =>
      loadWorkerConfig({
        ...productionEnvironment,
        DATABASE_URL: 'postgresql://prod:prod@db.example.com:5432/asone_prod',
      }),
    ).toThrow();

    const worker = loadWorkerConfig({
      ...productionEnvironment,
      DATABASE_URL: 'postgresql://prod:prod@db.example.com:5432/asone_prod?sslmode=verify-full',
    });
    expect(worker.databaseUrl).toContain('sslmode=verify-full');
  });
});
