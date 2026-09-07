import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { type Pool, Pool as PostgresPool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type TransactionCallback<T> = (transaction: DatabaseTransaction) => Promise<T>;

export interface DatabaseClient {
  readonly db: Database;
  readonly pool: Pool;
  transaction<T>(callback: TransactionCallback<T>): Promise<T>;
  check(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The subset of Postgres `sslmode` values this driver layer understands and
 * actively translates into `pg`'s own `ssl` pool option (see
 * `sslOptionForMode` below and docs/PRODUCTION_ENVIRONMENT.md's "Database
 * TLS policy" section). `allow`/`prefer` are deliberately not supported —
 * they are rarely used operationally and would require hand-rolled
 * opportunistic-TLS negotiation `pg` does not provide out of the box.
 */
export type DatabaseSslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

export interface DatabaseClientOptions {
  readonly connectionString?: string;
  readonly pool?: Pool;
  readonly applicationName?: string;
  readonly connectionTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxConnections?: number;
  /**
   * Explicit override for the TLS mode `pg` should negotiate with. When
   * omitted, this is derived automatically from the `sslmode` query
   * parameter on `connectionString` (the standard `node-postgres`
   * convention) — most callers never need to set this directly.
   */
  readonly sslMode?: DatabaseSslMode;
}

function extractSslModeFromConnectionString(
  connectionString: string | undefined,
): DatabaseSslMode | undefined {
  if (connectionString === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return undefined;
  }
  const raw = parsed.searchParams.get('sslmode');
  return raw === 'disable' || raw === 'require' || raw === 'verify-ca' || raw === 'verify-full'
    ? raw
    : undefined;
}

/**
 * Translates a `sslmode` value into `pg`'s own `ssl` pool option so the
 * driver actually negotiates TLS, rather than relying on `pg`'s own
 * (undocumented, easy to forget) connection-string parsing. Mirrors the
 * standard `node-postgres` pattern:
 *  - `disable`               -> `false` (no TLS)
 *  - `require`               -> `{ rejectUnauthorized: false }` — encrypted,
 *    but certificate verification is skipped. This is the documented escape
 *    hatch: an operator explicitly opts into it (by using `require` instead
 *    of `verify-full`/`verify-ca`) only when a managed Postgres provider's
 *    server certificate is not in Node's default CA bundle.
 *  - `verify-ca`/`verify-full` -> `{ rejectUnauthorized: true }` — encrypted
 *    and certificate-verified. The safe default whenever the provider's CA
 *    certificate is available.
 *  - unset                   -> `undefined` (no change from today's
 *    behaviour; dev/test loopback Postgres is unaffected).
 */
function sslOptionForMode(mode: DatabaseSslMode | undefined): PoolConfig['ssl'] {
  switch (mode) {
    case undefined:
      return undefined;
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
  }
}

export function createDatabaseClient(options: DatabaseClientOptions): DatabaseClient {
  if (options.pool === undefined && options.connectionString === undefined) {
    throw new Error('A PostgreSQL connection string or injected pool is required.');
  }

  const ownsPool = options.pool === undefined;
  const sslMode = options.sslMode ?? extractSslModeFromConnectionString(options.connectionString);
  const poolConfig: PoolConfig = {
    application_name: options.applicationName ?? 'asone',
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 2_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 10_000,
    max: options.maxConnections ?? 5,
    ssl: sslOptionForMode(sslMode),
  };
  const pool = options.pool ?? new PostgresPool(poolConfig);
  const db = drizzle(pool, { schema });

  return Object.freeze({
    db,
    pool,
    transaction: <T>(callback: TransactionCallback<T>): Promise<T> => db.transaction(callback),
    async check(): Promise<void> {
      await pool.query('SELECT 1');
    },
    async close(): Promise<void> {
      if (ownsPool) await pool.end();
    },
  });
}
