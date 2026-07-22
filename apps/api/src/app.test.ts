import pino from 'pino';
import { describe, expect, it } from 'vitest';

import type { ApiConfig } from '@asone/config';

import { buildApp } from './app.js';
import type { InfrastructureDependencies, ReadinessResult } from './infrastructure/dependencies.js';

const config: ApiConfig = Object.freeze({
  apiHost: '127.0.0.1',
  apiPort: 3000,
  appName: 'asone-api-test',
  appVersion: '0.1.0-test',
  databaseUrl: 'postgresql://local:local@127.0.0.1:5432/test',
  logLevel: 'silent',
  nodeEnv: 'test',
  redisUrl: 'redis://127.0.0.1:6379',
});

function infrastructure(result: ReadinessResult): InfrastructureDependencies {
  return {
    checkReadiness: () => Promise.resolve(result),
    close: () => Promise.resolve(),
  };
}

describe('technical health routes', () => {
  it('reports general health and process liveness independently', async () => {
    const app = await buildApp({
      config,
      infrastructure: infrastructure({ postgres: 'available', redis: 'available' }),
      logger: pino({ level: 'silent' }),
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const live = await app.inject({ method: 'GET', url: '/live' });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ name: 'asone-api-test', status: 'ok', version: '0.1.0-test' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'alive' });
    await app.close();
  });

  it('reports not ready without exposing connection details', async () => {
    const app = await buildApp({
      config,
      infrastructure: infrastructure({ postgres: 'unavailable', redis: 'unavailable' }),
      logger: pino({ level: 'silent' }),
    });

    const response = await app.inject({ method: 'GET', url: '/ready' });
    const body = response.json<{
      readonly services: ReadinessResult;
      readonly status: 'not_ready' | 'ready';
    }>();

    expect(response.statusCode).toBe(503);
    expect(body).toEqual({
      services: { postgres: 'unavailable', redis: 'unavailable' },
      status: 'not_ready',
    });
    expect(JSON.stringify(body)).not.toContain('postgresql://');
    await app.close();
  });
});
