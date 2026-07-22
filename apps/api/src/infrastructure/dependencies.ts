import { createClient } from 'redis';

import { createDatabaseClient, type DatabaseClient } from '@asone/database';

export type ServiceStatus = 'available' | 'unavailable';

export interface ReadinessResult {
  readonly postgres: ServiceStatus;
  readonly redis: ServiceStatus;
}

export interface InfrastructureDependencies {
  readonly database?: DatabaseClient;
  checkReadiness(): Promise<ReadinessResult>;
  close(): Promise<void>;
}

export interface InfrastructureOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly connectionTimeoutMs?: number;
  readonly database?: DatabaseClient;
}

export function createInfrastructure(options: InfrastructureOptions): InfrastructureDependencies {
  const connectionTimeoutMs = options.connectionTimeoutMs ?? 2_000;
  const database =
    options.database ??
    createDatabaseClient({
      applicationName: 'asone-api',
      connectionString: options.databaseUrl,
      connectionTimeoutMs,
      maxConnections: 5,
    });
  const redis = createClient({
    url: options.redisUrl,
    socket: { connectTimeout: connectionTimeoutMs, reconnectStrategy: false },
  });
  redis.on('error', () => undefined);

  return {
    database,
    async checkReadiness(): Promise<ReadinessResult> {
      const [postgresResult, redisResult] = await Promise.allSettled([
        database.check(),
        (async () => {
          if (!redis.isOpen) await redis.connect();
          await redis.ping();
        })(),
      ]);

      return Object.freeze({
        postgres: postgresResult.status === 'fulfilled' ? 'available' : 'unavailable',
        redis: redisResult.status === 'fulfilled' ? 'available' : 'unavailable',
      });
    },
    async close(): Promise<void> {
      await Promise.allSettled([database.close(), redis.isOpen ? redis.quit() : Promise.resolve()]);
    },
  };
}
