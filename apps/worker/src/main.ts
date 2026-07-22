import { pathToFileURL } from 'node:url';

import { loadWorkerConfig, type WorkerConfig } from '@asone/config';
import { createLogger } from '@asone/logger';

import { createWorkerInfrastructure } from './infrastructure.js';
import { bootstrapWorker } from './worker.js';

export async function startWorker(): Promise<void> {
  let config: WorkerConfig;
  try {
    config = loadWorkerConfig();
  } catch {
    process.stderr.write('Worker configuration is invalid.\n');
    process.exitCode = 1;
    return;
  }
  const logger = createLogger({
    environment: config.nodeEnv,
    level: config.logLevel,
    service: config.appName,
  });
  const infrastructure = createWorkerInfrastructure({
    databaseUrl: config.databaseUrl,
    redisUrl: config.redisUrl,
  });

  try {
    await bootstrapWorker({ config, infrastructure, logger, waitForShutdown: true });
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'worker startup failed');
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void startWorker();
}
