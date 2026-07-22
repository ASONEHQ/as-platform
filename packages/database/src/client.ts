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

export interface DatabaseClientOptions {
  readonly connectionString?: string;
  readonly pool?: Pool;
  readonly applicationName?: string;
  readonly connectionTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxConnections?: number;
}

export function createDatabaseClient(options: DatabaseClientOptions): DatabaseClient {
  if (options.pool === undefined && options.connectionString === undefined) {
    throw new Error('A PostgreSQL connection string or injected pool is required.');
  }

  const ownsPool = options.pool === undefined;
  const poolConfig: PoolConfig = {
    application_name: options.applicationName ?? 'asone',
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 2_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 10_000,
    max: options.maxConnections ?? 5,
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
