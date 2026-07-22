import type { Logger } from 'pino';

import type { WorkerConfig } from '@asone/config';

import type { WorkerInfrastructure } from './infrastructure.js';

export interface BootstrapWorkerOptions {
  readonly config: WorkerConfig;
  readonly infrastructure: WorkerInfrastructure;
  readonly logger: Logger;
  readonly waitForShutdown?: boolean;
}

function waitForSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => {
      resolve('SIGINT');
    });
    process.once('SIGTERM', () => {
      resolve('SIGTERM');
    });
  });
}

export async function bootstrapWorker(options: BootstrapWorkerOptions): Promise<void> {
  const ready = await options.infrastructure.check();
  if (!ready) {
    options.logger.error('worker dependencies are unavailable');
    await options.infrastructure.close();
    throw new Error('Worker dependencies are unavailable.');
  }

  options.logger.info(
    { app_version: options.config.appVersion },
    'worker bootstrap ready; no processing is configured',
  );

  if (options.waitForShutdown === true) {
    const signal = await waitForSignal();
    options.logger.info({ signal }, 'worker shutdown started');
  }

  await options.infrastructure.close();
  options.logger.info('worker shutdown complete');
}
