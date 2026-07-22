import { Pool } from 'pg';
import { createClient } from 'redis';

export type ServiceStatus = 'available' | 'unavailable';

export interface ReadinessResult {
  readonly postgres: ServiceStatus;
  readonly redis: ServiceStatus;
}

export interface InfrastructureDependencies {
  checkReadiness(): Promise<ReadinessResult>;
  close(): Promise<void>;
}

export interface InfrastructureOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly connectionTimeoutMs?: number;
}

export function createInfrastructure(options: InfrastructureOptions): InfrastructureDependencies {
  const connectionTimeoutMs = options.connectionTimeoutMs ?? 2_000;
  const postgres = new Pool({
    connectionString: options.databaseUrl,
    connectionTimeoutMillis: connectionTimeoutMs,
    idleTimeoutMillis: 10_000,
    max: 5,
  });
  const redis = createClient({
    url: options.redisUrl,
    socket: { connectTimeout: connectionTimeoutMs, reconnectStrategy: false },
  });
  redis.on('error', () => undefined);

  return {
    async checkReadiness(): Promise<ReadinessResult> {
      const [postgresResult, redisResult] = await Promise.allSettled([
        postgres.query('SELECT 1'),
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
      await Promise.allSettled([postgres.end(), redis.isOpen ? redis.quit() : Promise.resolve()]);
    },
  };
}
