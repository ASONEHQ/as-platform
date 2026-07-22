import { Pool } from 'pg';
import { createClient } from 'redis';

export interface WorkerInfrastructure {
  check(): Promise<boolean>;
  close(): Promise<void>;
}

export function createWorkerInfrastructure(options: {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly connectionTimeoutMs?: number;
}): WorkerInfrastructure {
  const connectionTimeoutMs = options.connectionTimeoutMs ?? 2_000;
  const postgres = new Pool({
    connectionString: options.databaseUrl,
    connectionTimeoutMillis: connectionTimeoutMs,
    idleTimeoutMillis: 10_000,
    max: 2,
  });
  const redis = createClient({
    url: options.redisUrl,
    socket: { connectTimeout: connectionTimeoutMs, reconnectStrategy: false },
  });
  redis.on('error', () => undefined);

  return {
    async check(): Promise<boolean> {
      const results = await Promise.allSettled([
        postgres.query('SELECT 1'),
        (async () => {
          if (!redis.isOpen) await redis.connect();
          await redis.ping();
        })(),
      ]);
      return results.every((result) => result.status === 'fulfilled');
    },
    async close(): Promise<void> {
      await Promise.allSettled([postgres.end(), redis.isOpen ? redis.quit() : Promise.resolve()]);
    },
  };
}
