#!/usr/bin/env node
// scripts/production/backup-db.mjs
//
// Produce one correct, timestamped local PostgreSQL backup by shelling out
// to the real `pg_dump` (custom format, -Fc — the format `pg_restore`
// consumes and that supports selective/parallel restore). This script does
// not implement any dump logic itself, does not rotate/retain old backups,
// does not upload anywhere, and does not encrypt the output — see
// docs/BACKUP_STRATEGY.md for the operator recommendations that cover
// retention, offsite copy and at-rest encryption.
//
// Usage:
//   DATABASE_URL=postgresql://user:pass@host:5432/dbname \
//     node scripts/production/backup-db.mjs [--out-dir <dir>]
//
// Required env:
//   DATABASE_URL   PostgreSQL connection URL of the database to back up.
//
// Options:
//   --out-dir <dir>   Directory to write the backup file into.
//                      Default: ./backups (create it with --out-dir if you
//                      want it elsewhere; make sure the path is
//                      gitignored — see the repo root .gitignore).
//
// Exit code is nonzero on ANY failure (pg_dump not found, pg_dump exited
// nonzero, or the output file came out empty). On failure this script
// deletes whatever partial output file it produced — it never leaves a
// broken file that could be mistaken for a good backup.
//
// The DATABASE_URL's password is never printed. It is passed to pg_dump
// via the PGPASSWORD environment variable, never as a CLI argument, so it
// also never appears in this process's own argv / process listing.
//
// Alongside the .dump file, this script writes a `<file>.manifest.json`
// sidecar in the exact BackupManifest shape the repo's ALREADY-EXISTING
// `pnpm --filter @asone/api ops backup-verify --manifest <path>` command
// expects (see apps/api/src/operations/backup-verification.service.ts —
// format_version 1, backup_file, checksum_sha256, created_at, backup_type
// 'logical' — a pg_dump custom-format dump is a logical backup, not a
// filesystem-level base backup). Without this, that already-built,
// already-tested verification command had nothing real to verify against;
// this closes exactly that gap rather than inventing a second, disconnected
// verification story.

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { connectionEnv, formatBytes, parseConnectionUrl, runPgTool, utcTimestampForFilename } from './lib/pg-connection.mjs';

async function main() {
  const { values } = parseArgs({
    options: {
      'out-dir': { type: 'string', default: 'backups' },
    },
  });

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    console.error('DATABASE_URL is required (a PostgreSQL connection URL).');
    process.exitCode = 1;
    return;
  }

  let conn;
  try {
    conn = parseConnectionUrl(databaseUrl, 'DATABASE_URL');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const outDir = resolve(process.cwd(), values['out-dir']);
  await mkdir(outDir, { recursive: true });

  const timestamp = utcTimestampForFilename();
  const fileName = `asone-backup-${timestamp}.dump`;
  const outFile = resolve(outDir, fileName);

  const args = [
    '--format=custom',
    '--file', outFile,
    '--host', conn.host,
    '--port', conn.port,
    '--username', conn.user,
    '--no-password',
    conn.database,
  ];

  console.log(`Backing up ${conn.redacted} ...`);
  const startedAt = process.hrtime.bigint();

  let result;
  try {
    result = await runPgTool('pg_dump', args, connectionEnv(conn));
  } catch (error) {
    console.error(`pg_dump could not be run: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  if (result.code !== 0) {
    console.error(`pg_dump failed with exit code ${String(result.code)}.`);
    if (result.stderr.trim() !== '') {
      console.error('--- pg_dump stderr ---');
      console.error(result.stderr.trim());
    }
    await deletePartialFile(outFile);
    process.exitCode = 1;
    return;
  }

  // pg_dump exited 0, but confirm the file is real before calling it good —
  // never trust a zero exit code alone as proof of a usable backup.
  let fileStat;
  try {
    fileStat = await stat(outFile);
  } catch {
    console.error(
      `pg_dump reported success but the output file is missing: ${outFile}`,
    );
    process.exitCode = 1;
    return;
  }
  if (fileStat.size === 0) {
    console.error('pg_dump reported success but produced an empty (0-byte) file. Discarding it.');
    await deletePartialFile(outFile);
    process.exitCode = 1;
    return;
  }

  // Checksum the finished file and write the manifest.json sidecar —
  // computed AFTER pg_dump exits and the file is confirmed nonempty, so
  // the checksum always describes the real, final bytes on disk.
  const checksumSha256 = createHash('sha256').update(await readFile(outFile)).digest('hex');
  const manifestFile = `${outFile}.manifest.json`;
  const createdAtIso = new Date().toISOString();
  const manifest = {
    format_version: 1,
    backup_file: outFile,
    checksum_sha256: checksumSha256,
    created_at: createdAtIso,
    backup_type: 'logical',
  };
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('Backup succeeded.');
  console.log('--- manifest ---');
  console.log(`file:      ${outFile}`);
  console.log(`manifest:  ${manifestFile}`);
  console.log(`size:      ${formatBytes(fileStat.size)} (${String(fileStat.size)} bytes)`);
  console.log(`database:  ${conn.database}`);
  console.log(`source:    ${conn.redacted}`);
  console.log(`checksum:  sha256:${checksumSha256}`);
  console.log(`timestamp: ${timestamp}`);
  console.log(`duration:  ${durationMs.toFixed(0)} ms`);
  console.log(`format:    custom (-Fc, pg_restore-compatible)`);
  console.log('');
  console.log(
    `Verify this backup any time with: pnpm --filter @asone/api ops backup-verify --manifest ${manifestFile}`,
  );
}

async function deletePartialFile(path) {
  try {
    await unlink(path);
    console.error(`Deleted partial/failed output file: ${path}`);
  } catch {
    // Nothing to clean up (e.g. pg_dump never created it) — fine.
  }
}

await main();
