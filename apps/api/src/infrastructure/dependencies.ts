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
  /** TASK 16.3A — see `@asone/config`'s `DATABASE_SSL_CA_CERT` doc comment. */
  readonly databaseSslCaCert?: string | undefined;
}

export function createInfrastructure(options: InfrastructureOptions): InfrastructureDependencies {
  const connectionTimeoutMs = options.connectionTimeoutMs ?? 2_000;
  const database =
    options.database ??
    createDatabaseClient({
      applicationName: 'asone-api',
      connectionString: options.databaseUrl,
      connectionTimeoutMs,
      sslRootCert: options.databaseSslCaCert,
      // RC 15.0 Phase 11 (Performance/Scale Smoke) fix: was hard-coded to
      // 5. Proven too small by a real, reproducible measurement — 6
      // concurrent real `POST /api/v1/sales` requests (simulating 6
      // simultaneous cashiers, well inside this same phase's own "2-10
      // simultaneous cashiers" target) against a live server already
      // returned 4/6 real `500 internal_error` responses, every failure
      // landing at ~2.05s — exactly `connectionTimeoutMs` (2s) above, i.e.
      // requests genuinely timing out waiting for a pooled connection, not
      // a slow query. 5 concurrent requests against the same unmodified
      // server never failed this way. 20 gives headroom above this
      // phase's own stated ceiling (10 simultaneous cashiers) for the
      // handful of extra connections idempotency checks, background
      // reporting queries, and the dashboard genuinely need at the same
      // moment — re-verified in docs/RC_PERFORMANCE_SMOKE.md by rerunning
      // the identical 6- and 10-cashier bursts against this exact change.
      maxConnections: 20,
    });
  const redis = createClient({
    url: options.redisUrl,
    socket: { connectTimeout: connectionTimeoutMs, reconnectStrategy: false },
  });
  redis.on('error', () => undefined);
  // RC 15.0 Phase 14 (Observability) fix: `pg.Pool` (unlike the `redis`
  // client just above) had no `'error'` listener at all. node-postgres's
  // own documented contract is that an *idle* pooled client erroring (a
  // dropped connection, a DB-side restart) emits `'error'` on the Pool --
  // with zero listeners, Node treats that as an unhandled EventEmitter
  // error and throws, which `bootstrap/shutdown.ts`'s global
  // `uncaughtException` handler then catches, logs at `fatal`, and turns
  // into a full process shutdown/exit(1). That IS loud (never silent —
  // logged with full `err` detail, see shutdown.ts) and IS recoverable
  // (systemd `Restart=on-failure`, docs/OBSERVABILITY_AND_SUPERVISION.md
  // §3.4), but it needlessly restarts the *entire* API process for a
  // single idle connection the pool would otherwise evict and replace on
  // its own. Mirrors the existing Redis line immediately above: a bare
  // no-op listener is enough to stop the throw — `pg.Pool` already retires
  // the broken client and opens a fresh one for the next query without any
  // extra handling. See docs/RC_OBSERVABILITY.md item 8.
  database.pool.on('error', () => undefined);

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
