import { createClient } from 'redis';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

export interface WorkerInfrastructure {
  check(): Promise<boolean>;
  close(): Promise<void>;
}

export function createWorkerInfrastructure(options: {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly connectionTimeoutMs?: number;
  readonly database?: DatabaseClient;
}): WorkerInfrastructure {
  const connectionTimeoutMs = options.connectionTimeoutMs ?? 2_000;
  const database =
    options.database ??
    createDatabaseClient({
      applicationName: 'asone-worker',
      connectionString: options.databaseUrl,
      connectionTimeoutMs,
      maxConnections: 2,
    });
  const redis = createClient({
    url: options.redisUrl,
    socket: { connectTimeout: connectionTimeoutMs, reconnectStrategy: false },
  });
  redis.on('error', () => undefined);

  return {
    async check(): Promise<boolean> {
      const results = await Promise.allSettled([
        database.check(),
        (async () => {
          if (!redis.isOpen) await redis.connect();
          await redis.ping();
        })(),
      ]);
      return results.every((result) => result.status === 'fulfilled');
    },
    async close(): Promise<void> {
      await Promise.allSettled([database.close(), redis.isOpen ? redis.quit() : Promise.resolve()]);
    },
  };
}
