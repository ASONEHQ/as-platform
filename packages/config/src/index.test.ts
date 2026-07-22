import { describe, expect, it } from 'vitest';

import { loadApiConfig, loadWorkerConfig } from './index.js';

const validEnvironment = {
  NODE_ENV: 'test',
  APP_NAME: 'asone-test',
  APP_VERSION: '0.1.0-test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/asone_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
} as const;

describe('configuration', () => {
  it('loads typed immutable API and worker configuration', () => {
    const api = loadApiConfig(validEnvironment);
    const worker = loadWorkerConfig(validEnvironment);

    expect(api.apiPort).toBe(3000);
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
});
