// scripts/production/lib/pg-connection.mjs
//
// Shared helpers for the production backup/verify scripts. Parses a
// PostgreSQL connection URL into its parts, redacts the password for
// anything that gets printed, and provides a thin `spawn`-based runner for
// shelling out to the real `pg_dump` / `pg_restore` / `psql` CLI tools.
//
// Nothing here reimplements dump/restore/query logic — it only builds argv
// arrays and env for the real PostgreSQL client binaries and reports their
// exit status honestly.

import { spawn } from 'node:child_process';

/**
 * @typedef {object} ParsedConnection
 * @property {string} host
 * @property {string} port
 * @property {string} user
 * @property {string} password
 * @property {string} database
 * @property {string | undefined} sslmode
 * @property {string} redacted a printable form with the password replaced by "****"
 */

/**
 * Parse a `postgres://` / `postgresql://` connection URL.
 *
 * @param {string} rawUrl
 * @param {string} label used only in error messages (e.g. "DATABASE_URL")
 * @returns {ParsedConnection}
 */
export function parseConnectionUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${label} must use the postgres:// or postgresql:// scheme.`);
  }
  const host = url.hostname;
  if (host === '') {
    throw new Error(`${label} must include a host.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  if (database === '') {
    throw new Error(`${label} must include a database name.`);
  }
  const port = url.port === '' ? '5432' : url.port;
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode') ?? undefined;
  const redacted = `postgresql://${user}:****@${host}:${port}/${database}${sslmode !== undefined ? `?sslmode=${sslmode}` : ''}`;
  return Object.freeze({ host, port, user, password, database, sslmode, redacted });
}

/**
 * Build the env for a child `pg_dump`/`pg_restore`/`psql` process: the
 * caller's own env, plus PGPASSWORD (and PGSSLMODE, if the URL declared
 * one) — never the raw connection URL. This is what keeps the password out
 * of argv (and therefore out of process listings) while still keeping it
 * out of anything we print ourselves.
 *
 * @param {ParsedConnection} conn
 */
export function connectionEnv(conn) {
  const env = { ...process.env, PGPASSWORD: conn.password };
  if (conn.sslmode !== undefined) env.PGSSLMODE = conn.sslmode;
  return env;
}

/**
 * Run a PostgreSQL client binary (`pg_dump`, `pg_restore`, `psql`, ...) and
 * resolve with its exit status. Never throws on a nonzero exit code —
 * callers decide what a failure means for them — but does throw a clear,
 * friendly error if the binary itself could not be started (e.g. not
 * installed / not on PATH).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runPgTool(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        rejectPromise(
          new Error(
            `'${command}' was not found on PATH. Install the PostgreSQL client tools ` +
              `(matching the target server's major version) and ensure '${command}' is ` +
              'reachable, then retry.',
          ),
        );
        return;
      }
      rejectPromise(error);
    });
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Format a byte count as a human-readable string (e.g. "12.3 MB"). */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

/** UTC timestamp formatted for a filename, e.g. "2026-09-15T03-00-00Z". */
export function utcTimestampForFilename(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/u, 'Z').replace(/:/gu, '-');
}
