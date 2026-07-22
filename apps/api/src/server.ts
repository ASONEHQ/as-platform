import { pathToFileURL } from 'node:url';

import { loadApiConfig, type ApiConfig } from '@asone/config';
import { createLogger } from '@asone/logger';

import { buildApp } from './app.js';
import { createInfrastructure } from './infrastructure/dependencies.js';

export async function startServer(): Promise<void> {
  let config: ApiConfig;
  try {
    config = loadApiConfig();
  } catch {
    process.stderr.write('API configuration is invalid.\n');
    process.exitCode = 1;
    return;
  }
  const logger = createLogger({
    environment: config.nodeEnv,
    level: config.logLevel,
    service: config.appName,
  });
  const infrastructure = createInfrastructure({
    databaseUrl: config.databaseUrl,
    redisUrl: config.redisUrl,
  });
  const app = await buildApp({ config, infrastructure, logger });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'server shutdown started');
    await app.close();
    await infrastructure.close();
    logger.info('server shutdown complete');
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.apiHost, port: config.apiPort });
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'server startup failed');
    await infrastructure.close();
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void startServer();
}
