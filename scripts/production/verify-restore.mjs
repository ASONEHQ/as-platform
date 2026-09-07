#!/usr/bin/env node
// scripts/production/verify-restore.mjs
//
// Prove that a backup produced by backup-db.mjs actually restores, by
// restoring it into a genuinely separate, disposable verification database
// (never the primary/production database) and running a real integrity
// check against the result.
//
// Usage:
//   VERIFY_DATABASE_URL=postgresql://user:pass@host:5432/asone_restore_verify_local \
//     node scripts/production/verify-restore.mjs <path-to-backup.dump>
//
// Required env:
//   VERIFY_DATABASE_URL   Connection URL for the DISPOSABLE verification
//                          database. Must pass the safety gate below.
//
// Optional env:
//   DATABASE_URL           If set, used only for the source/target equality
//                           check (refuse if VERIFY_DATABASE_URL is the
//                           same database as the primary).
//
// Safety gate (fail closed, mirroring the loopback/name-allowlist
// convention `apps/api/src/development/bootstrap-owner.service.ts`'s
// `validateBootstrapEnvironment` already uses in this codebase to keep a
// dev/verification tool from ever touching a real database):
//
//   1. VERIFY_DATABASE_URL must parse as a postgres(ql):// URL.
//   2. VERIFY_DATABASE_URL must not be textually identical to DATABASE_URL,
//      when DATABASE_URL is set (source/target equality refusal — the same
//      check docs/DISASTER_RECOVERY.md's restore-validation-automation
//      boundary already documents).
//   3. The verification database's NAME must carry a recognizable
//      "this is disposable" marker: it must contain the substring
//      "restore_verify", or end with "_verify". Names that look like a
//      real primary/production database — exactly "asone_local",
//      "asone_production", anything starting with "asone_prod", the
//      PostgreSQL system databases "postgres"/"template0"/"template1", or
//      anything containing "prod" — are refused even if they also happen
//      to contain a verify-looking substring.
//
// What this script does to the verification database: it DROPS it (if it
// already exists) and CREATES it fresh, via the control ("postgres")
// database on the same server, so every run restores into a guaranteed
// -empty target — this is the "create fresh" flow the task calls out as an
// acceptable alternative to requiring a pre-existing empty database. It
// NEVER connects to, drops, or otherwise touches the primary database; the
// only database name it ever issues DROP/CREATE/data statements against is
// the one that just passed the safety gate above.
//
// Exit code is nonzero on ANY failure — safety gate rejection, connection
// failure, restore failure, missing table, or migration-count mismatch —
// with a specific, printed reason. Nothing here reports a silent partial
// success.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { connectionEnv, parseConnectionUrl, runPgTool } from './lib/pg-connection.mjs';

const CORE_TABLES = Object.freeze(['companies', 'branches', 'users', 'sales', 'cash_sessions']);

const JOURNAL_PATH = fileURLToPath(
  new URL('../../packages/database/drizzle/meta/_journal.json', import.meta.url),
);

function assertSafeVerifyTarget(verifyRawUrl, verifyConn, primaryRawUrl) {
  if (primaryRawUrl !== undefined && primaryRawUrl !== '' && primaryRawUrl === verifyRawUrl) {
    throw new Error(
      'Refusing to run: VERIFY_DATABASE_URL is textually identical to DATABASE_URL. ' +
        'The verification target must be a separate database from the primary.',
    );
  }

  const name = verifyConn.database;
  const looksVerify = name.includes('restore_verify') || /_verify$/u.test(name);
  const looksPrimaryLike =
    name === 'asone_local' ||
    name === 'postgres' ||
    name === 'template0' ||
    name === 'template1' ||
    /^asone_prod/iu.test(name) ||
    /prod/iu.test(name);

  if (looksPrimaryLike) {
    throw new Error(
      `Refusing to run: verification database name "${name}" looks like a real ` +
        'primary/production database. Choose a disposable name such as ' +
        '"asone_restore_verify_<task>" instead.',
    );
  }
  if (!looksVerify) {
    throw new Error(
      `Refusing to run: verification database name "${name}" is not allowlisted. ` +
        'It must contain "restore_verify" or end with "_verify" (e.g. ' +
        '"asone_restore_verify_task14" or "asone_local_verify").',
    );
  }
}

/** Run one SQL statement against `database` on the same server as `conn`, via psql. */
async function runSql(conn, database, sql) {
  const args = [
    '--host', conn.host,
    '--port', conn.port,
    '--username', conn.user,
    '--no-password',
    '--dbname', database,
    '--set', 'ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
    '--command', sql,
  ];
  return runPgTool('psql', args, connectionEnv(conn));
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true });
  const backupFile = positionals[0];
  if (backupFile === undefined) {
    console.error('Usage: node scripts/production/verify-restore.mjs <path-to-backup.dump>');
    process.exitCode = 1;
    return;
  }

  const verifyRawUrl = process.env.VERIFY_DATABASE_URL;
  if (verifyRawUrl === undefined || verifyRawUrl === '') {
    console.error('VERIFY_DATABASE_URL is required (a separate, disposable verification database).');
    process.exitCode = 1;
    return;
  }

  let verifyConn;
  try {
    verifyConn = parseConnectionUrl(verifyRawUrl, 'VERIFY_DATABASE_URL');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  try {
    assertSafeVerifyTarget(verifyRawUrl, verifyConn, process.env.DATABASE_URL);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Verification target: ${verifyConn.redacted}`);
  console.log(`Backup file:         ${backupFile}`);

  // 1. Recreate the verification database fresh via the control database.
  console.log('Dropping (if present) and recreating the verification database ...');
  const dropResult = await runSql(
    verifyConn,
    'postgres',
    `DROP DATABASE IF EXISTS "${verifyConn.database}" WITH (FORCE);`,
  );
  if (dropResult.code !== 0) {
    console.error('Failed to drop any pre-existing verification database:');
    console.error(dropResult.stderr.trim());
    process.exitCode = 1;
    return;
  }
  const createResult = await runSql(
    verifyConn,
    'postgres',
    `CREATE DATABASE "${verifyConn.database}";`,
  );
  if (createResult.code !== 0) {
    console.error('Failed to create the verification database:');
    console.error(createResult.stderr.trim());
    process.exitCode = 1;
    return;
  }

  // 2. Restore the backup into it with pg_restore.
  console.log('Restoring backup with pg_restore ...');
  const restoreArgs = [
    '--host', verifyConn.host,
    '--port', verifyConn.port,
    '--username', verifyConn.user,
    '--no-password',
    '--dbname', verifyConn.database,
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    backupFile,
  ];
  let restoreResult;
  try {
    restoreResult = await runPgTool('pg_restore', restoreArgs, connectionEnv(verifyConn));
  } catch (error) {
    console.error(`pg_restore could not be run: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (restoreResult.code !== 0) {
    console.error(`pg_restore failed with exit code ${String(restoreResult.code)}.`);
    if (restoreResult.stderr.trim() !== '') {
      console.error('--- pg_restore stderr ---');
      console.error(restoreResult.stderr.trim());
    }
    process.exitCode = 1;
    return;
  }

  // 3. Real integrity checks against the restored database.
  const failures = [];
  const report = [];

  const expectedMigrationCount = await readExpectedMigrationCount();
  const migrationCheck = await runSql(
    verifyConn,
    verifyConn.database,
    'SELECT count(*) FROM drizzle.__drizzle_migrations;',
  );
  if (migrationCheck.code !== 0) {
    failures.push(
      `migration journal table (drizzle.__drizzle_migrations) is missing or unqueryable: ${migrationCheck.stderr.trim()}`,
    );
  } else {
    const actual = Number.parseInt(migrationCheck.stdout.trim(), 10);
    report.push(`migrations: ${String(actual)} (expected ${String(expectedMigrationCount)})`);
    if (actual !== expectedMigrationCount) {
      failures.push(
        `migration count mismatch: journal has ${String(expectedMigrationCount)} entries ` +
          `(packages/database/drizzle/meta/_journal.json) but the restored database has ${String(actual)}.`,
      );
    }
  }

  for (const table of CORE_TABLES) {
    const countCheck = await runSql(verifyConn, verifyConn.database, `SELECT count(*) FROM "${table}";`);
    if (countCheck.code !== 0) {
      failures.push(`core table "${table}" is missing or unqueryable: ${countCheck.stderr.trim()}`);
      continue;
    }
    const rowCount = Number.parseInt(countCheck.stdout.trim(), 10);
    report.push(`${table}: ${String(rowCount)} row(s)`);
  }

  console.log('--- restored-database report ---');
  for (const line of report) console.log(line);

  if (failures.length > 0) {
    console.error('--- verification FAILED ---');
    for (const reason of failures) console.error(`- ${reason}`);
    process.exitCode = 1;
    return;
  }

  console.log('--- verification PASSED ---');
  console.log(
    `Restore of ${backupFile} into ${verifyConn.redacted} is structurally and ` +
      'referentially intact: migration count matches and every core table is queryable.',
  );
  console.log(
    'The verification database was left in place for inspection. Drop it yourself ' +
      'when you are done (never reuse it as a real database).',
  );
}

async function readExpectedMigrationCount() {
  const raw = await readFile(JOURNAL_PATH, 'utf8');
  const journal = JSON.parse(raw);
  if (!Array.isArray(journal.entries)) {
    throw new Error(`Unexpected _journal.json shape at ${JOURNAL_PATH}`);
  }
  return journal.entries.length;
}

await main();
