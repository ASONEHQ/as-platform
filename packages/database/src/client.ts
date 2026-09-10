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
  /**
   * TASK 16.3A — the PEM-encoded CA certificate content (not a file path)
   * to trust when `sslMode`/`sslmode` is `verify-ca` or `verify-full`. This
   * is how a DigitalOcean Managed PostgreSQL "Standard Edition" cluster's
   * downloadable CA certificate (Control Panel → cluster → Connection
   * Details → "Download CA certificate") gets threaded through to `pg`'s
   * `ssl.ca` option. Read from `DATABASE_SSL_CA_CERT` by every direct
   * caller of this module (never read from `process.env` inside this file
   * itself — matches this module's existing all-explicit-options design).
   * Ignored for `require`/`disable` — see `sslOptionForMode` below. Never
   * a secret: a CA certificate is public by design, safe to log, and
   * intentionally NOT treated as sensitive anywhere this is threaded
   * through.
   */
  // `| undefined` in addition to `?:` (not just one or the other) so every
  // caller that threads a config value straight through — most already
  // typed `string | undefined` themselves, since the certificate is
  // genuinely optional — can pass it directly without a conditional-spread
  // dance, without `exactOptionalPropertyTypes` rejecting the assignment.
  readonly sslRootCert?: string | undefined;
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
 * TASK 16.3A root-cause fix. `pg`'s own `ConnectionParameters` constructor
 * (`lib/connection-parameters.js`) does this, unconditionally, whenever a
 * `connectionString` is present:
 *
 *   if (config.connectionString) {
 *     config = Object.assign({}, config, parse(config.connectionString))
 *   }
 *
 * — i.e. it RE-PARSES `connectionString` via `pg-connection-string` and
 * merges the result OVER whatever `config` (our own explicit options,
 * `ssl` included) already had. `pg-connection-string` (as of 2.x) sets
 * `config.ssl = {}` on the parsed result whenever the URL has a `sslmode`
 * query param AT ALL (`sslcert`/`sslkey`/`sslrootcert` too) — and for
 * `sslmode=require`/`verify-ca` specifically, it deliberately leaves that
 * `{}` untouched rather than mapping it to `{ rejectUnauthorized: false }`
 * (a documented, intentional hardening: recent `pg-connection-string`
 * treats `require`/`prefer`/`verify-ca` as aliases for `verify-full` unless
 * `uselibpqcompat=true` is also set — confirmed via the library's own
 * `deprecatedSslModeWarning` message and source). An empty `{}` ssl option
 * means "use Node's default `tls` verification" — i.e. full certificate
 * chain + hostname verification — which is exactly why our own explicit
 * `sslOptionForMode('require') = { rejectUnauthorized: false }` below was
 * being silently discarded and replaced with full verification, causing
 * `SELF_SIGNED_CERT_IN_CHAIN` against DigitalOcean's managed Postgres
 * certificate. Confirmed empirically: constructing a real `pg.Client` with
 * both `connectionString` (carrying `?sslmode=require`) and an explicit
 * `ssl: { rejectUnauthorized: false }` resolves `client.connectionParameters
 * .ssl` to `{}`, not our explicit value, for `require`, `verify-ca`, AND
 * `verify-full` alike.
 *
 * The fix: strip every ssl-related query parameter from the connection
 * string handed to `pg.Pool`/`pg.Client` before construction, so
 * `pg-connection-string`'s `parse()` never sets `config.ssl` on its
 * returned object at all — `Object.assign` then has nothing ssl-related to
 * merge in, and our own explicitly-computed `ssl` option (below) survives
 * untouched. Every other connection field (host/port/user/password/
 * database) is still correctly re-derived from the (ssl-param-stripped)
 * connection string exactly as before — only the ssl-related params are
 * removed, and only from what `pg` itself re-parses; `sslMode`/
 * `sslRootCert` are computed from the ORIGINAL, unstripped string via
 * `extractSslModeFromConnectionString` above, so nothing about what we
 * derive changes. Uses `URL`/`URLSearchParams` (never string splitting/
 * regex) specifically so a percent-encoded password survives unmodified —
 * confirmed empirically, including a password containing both `@` and `:`.
 */
const SSL_QUERY_PARAM_NAMES = Object.freeze(['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']);

function connectionStringWithoutSslParams(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    // Malformed connection string — let `pg` raise the real error at
    // connect time rather than duplicating URL validation here.
    return connectionString;
  }
  for (const name of SSL_QUERY_PARAM_NAMES) parsed.searchParams.delete(name);
  return parsed.toString();
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
 *  - `verify-ca`/`verify-full` -> `{ rejectUnauthorized: true }`, plus
 *    `ca: sslRootCert` when a CA certificate was supplied — encrypted and
 *    certificate-verified against that CA (DigitalOcean Standard Edition's
 *    downloadable CA, for example). Without a CA supplied, verification
 *    falls back to Node's default trusted root store, which is still a
 *    real verification (never silently downgraded to skip verification —
 *    that would defeat the entire purpose of choosing `verify-ca`/
 *    `verify-full` over `require`).
 *  - unset                   -> `undefined` (no change from today's
 *    behaviour; dev/test loopback Postgres is unaffected).
 */
function sslOptionForMode(
  mode: DatabaseSslMode | undefined,
  sslRootCert: string | undefined,
): PoolConfig['ssl'] {
  switch (mode) {
    case undefined:
      return undefined;
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return sslRootCert === undefined
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: true, ca: sslRootCert };
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
    // Stripped of ssl-related query params so `pg`'s own internal re-parse
    // of this string (see `connectionStringWithoutSslParams`'s own doc
    // comment) can never overwrite the explicit `ssl` option below — the
    // root cause of TASK 16.3A's `SELF_SIGNED_CERT_IN_CHAIN` failure.
    connectionString:
      options.connectionString === undefined
        ? undefined
        : connectionStringWithoutSslParams(options.connectionString),
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 2_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 10_000,
    max: options.maxConnections ?? 5,
    ssl: sslOptionForMode(sslMode, options.sslRootCert),
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
