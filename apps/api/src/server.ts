import { pathToFileURL } from 'node:url';

import { describeConfigError, loadApiConfig, type ApiConfig } from '@asone/config';
import { createLogger } from '@asone/logger';

import { buildApp } from './app.js';
import { installShutdownHandlers } from './bootstrap/shutdown.js';
import { createInfrastructure } from './infrastructure/dependencies.js';

export async function startServer(): Promise<void> {
  let config: ApiConfig;
  try {
    config = loadApiConfig();
  } catch (error: unknown) {
    // TASK 16.2D: `describeConfigError` is the one place allowed to decide
    // what's safe to print — every line it can produce names only a
    // config KEY plus a sanitized constraint description, never a raw
    // env var value (see that function's own doc comment for the exact
    // guarantee). A `describeConfigError` `undefined` result means the
    // thrown error wasn't a real validation error at all (unexpected
    // shape) — fall back to the fully generic message rather than risk
    // printing anything about an error shape this code doesn't recognize.
    const issues = describeConfigError(error);
    if (issues === undefined) {
      process.stderr.write('API configuration is invalid.\n');
    } else {
      process.stderr.write('API configuration is invalid:\n');
      for (const issue of issues) process.stderr.write(`  - ${issue}\n`);
    }
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
