import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { WorkerConfig } from '@asone/config';

import type { WorkerInfrastructure } from './infrastructure.js';
import { bootstrapWorker } from './worker.js';

const config: WorkerConfig = Object.freeze({
  appName: 'asone-worker-test',
  appVersion: '0.1.0-test',
  databaseUrl: 'postgresql://local:local@127.0.0.1:5432/test',
  logLevel: 'silent',
  nodeEnv: 'test',
  redisUrl: 'redis://127.0.0.1:6379',
});

describe('worker bootstrap', () => {
  it('checks readiness and closes without starting an infinite process', async () => {
    const check = vi.fn(() => Promise.resolve(true));
    const close = vi.fn(() => Promise.resolve());
    const infrastructure: WorkerInfrastructure = {
      check,
      close,
    };

    await bootstrapWorker({
      config,
      infrastructure,
      logger: pino({ level: 'silent' }),
      waitForShutdown: false,
    });

    expect(check).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
