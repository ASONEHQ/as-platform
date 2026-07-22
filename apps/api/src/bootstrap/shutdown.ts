import type { Logger } from 'pino';

export interface ShutdownOptions {
  readonly close: () => Promise<void>;
  readonly logger: Logger;
  readonly timeoutMs: number;
}

export interface ShutdownController {
  readonly shutdown: (reason: string, exitCode?: number) => Promise<void>;
  readonly dispose: () => void;
}

export function installShutdownHandlers(options: ShutdownOptions): ShutdownController {
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (reason: string, exitCode = 0): Promise<void> => {
    shutdownPromise ??= (async () => {
      options.logger.info({ reason }, 'server shutdown started');
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          options.close(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error('Graceful shutdown timed out.'));
            }, options.timeoutMs);
            timer.unref();
          }),
        ]);
        options.logger.info('server shutdown complete');
      } catch (error: unknown) {
        options.logger.fatal({ err: error }, 'server shutdown failed');
        process.exitCode = 1;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (exitCode !== 0) process.exitCode = exitCode;
      }
    })();
    return shutdownPromise;
  };

  const onSigint = (): void => {
    void shutdown('SIGINT');
  };
  const onSigterm = (): void => {
    void shutdown('SIGTERM');
  };
  const onUnhandledRejection = (reason: unknown): void => {
    options.logger.fatal({ err: reason }, 'unhandled rejection');
    void shutdown('unhandledRejection', 1);
  };
  const onUncaughtException = (error: Error): void => {
    options.logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException', 1);
  };

  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  process.once('unhandledRejection', onUnhandledRejection);
  process.once('uncaughtException', onUncaughtException);

  return Object.freeze({
    shutdown,
    dispose(): void {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.removeListener('unhandledRejection', onUnhandledRejection);
      process.removeListener('uncaughtException', onUncaughtException);
    },
  });
}
