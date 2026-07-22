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
    expect(worker.nodeEnv).toBe('test');
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(worker)).toBe(true);
  });

  it('fails when required configuration is incomplete', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'test' })).toThrow();
  });
});
