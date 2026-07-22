import { pathToFileURL } from 'node:url';

import { loadApiConfig, type ApiConfig } from '@asone/config';
import { createLogger } from '@asone/logger';

import { buildApp } from './app.js';
import { installShutdownHandlers } from './bootstrap/shutdown.js';
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
  const shutdown = installShutdownHandlers({
    close: async () => {
      await app.close();
      await infrastructure.close();
      await new Promise<void>((resolve, reject) => {
        logger.flush((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    },
    logger,
    timeoutMs: config.requestTimeoutMs + 5_000,
  });

  try {
    await app.listen({ host: config.apiHost, port: config.apiPort });
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'server startup failed');
    await shutdown.shutdown('startup failure', 1);
  } finally {
    if (process.exitCode === 1) shutdown.dispose();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void startServer();
}
