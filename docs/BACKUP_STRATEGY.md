# AS ONE — Backup and Restore Strategy

## Protection model

Backups protect against infrastructure loss, operator error and logical
corruption. They do not replace replication, audit logs, migration discipline or
application-level invariants. PostgreSQL backups and WAL/PITR are the primary
transactional recovery mechanism.

## Backup catalog

| Asset | Method | Initial schedule | Initial retention | Restore requirement |
| --- | --- | --- | --- | --- |
| PostgreSQL | encrypted base backup plus continuous WAL/PITR | continuous WAL; daily base backup | 35 daily recovery days; 12 monthly recovery points | isolated restore and PITR |
| Object storage | versioning plus approved cross-location copy/replication | provider-continuous where available; daily inventory | 35 days; longer where legal/business policy requires | reconcile bytes, versions and PostgreSQL metadata |
| Deployment artifacts | immutable registry/release storage | every approved release | supported releases plus incident/legal hold | checksum and provenance verification |
| Configuration definitions | reviewed source and secret-manager metadata | every change | repository/manager history | reconstruct environment without secret disclosure |
| Redis | no authoritative backup requirement | none by default | none | recreate and warm from authority |
| Audit exports/legal holds | policy-controlled encrypted archive | policy-specific | policy-specific | restricted restore with chain of custody |

Retention values are initial engineering policy and may be extended by privacy,
tax, contractual or legal requirements. A shorter retention requires documented
risk acceptance and must still satisfy the DR objectives.

## Security and isolation

- Encrypt in transit and at rest with environment-scoped keys.
- Backup operators receive no unnecessary application administration access.
- Production backups are inaccessible from development and test credentials.
- Maintain at least one logically isolated recovery copy protected from routine
  deletion and compromised production credentials.
- Record backup identity, source, start/end, size, encryption key reference,
  checksum/provider integrity evidence and expiration.
- Never place credentials, plaintext secrets or production backup contents in
  source control, tickets or normal logs.
- Test data derived from production requires approved sanitization.

## Restore selection

Choose the newest recovery point that is demonstrably before the failure while
minimizing confirmed committed-data loss. For logical corruption, “latest” is
not automatically safe. The selected point includes UTC timestamp, WAL boundary,
backup identity, schema/migration state, known data-loss interval and approval.

## PostgreSQL restore runbook

1. Declare the incident or scheduled exercise and dedicated isolated target.
2. Verify backup inventory, encryption access and integrity evidence.
3. Restore the base backup and apply WAL to the approved boundary.
4. Keep application writes and external delivery disabled.
5. Verify PostgreSQL version, extensions, roles, migrations and constraints.
6. Validate tenant/company counts, branch ownership, recent critical records,
   exact financial/inventory quantities, audit and outbox continuity.
7. Run application compatibility, isolation and readiness checks.
8. Record measured RPO/RTO and discrepancies.
9. Destroy exercise data securely, or obtain independent approval before a
   production promotion.

## Object restore runbook

1. Establish affected object IDs, companies and version/time boundary from
   PostgreSQL metadata.
2. Restore into an isolated prefix/bucket when possible.
3. Verify checksum, content type, size, ownership scope and malware/quarantine
   policy before exposure.
4. Reconcile missing and orphaned objects without changing transactional
   ownership silently.
5. Promote only scoped verified versions; retain incident evidence.

## Validation controls

A backup job is successful only when it is complete, encrypted, catalogued and
inside freshness targets. A backup strategy is successful only when restores
are proven. Automated status alone is insufficient.

Restore validation includes:

- readable backup and WAL chain;
- checksum/provider integrity;
- migration history and schema consistency;
- tenant-safe foreign keys and uniqueness constraints;
- sample transaction/audit/outbox linkage;
- exact decimal preservation;
- no secrets in evidence;
- measured recovery point and elapsed recovery time.

## Failure and deletion policy

- Backup failure pages operations before the T0 RPO can be exceeded.
- A broken WAL chain is SEV-2 and becomes SEV-1 when no other T0 recovery point
  meets policy.
- Expired backups are deleted through provider lifecycle controls with auditable
  policy; active incidents and legal holds suspend deletion.
- Restore targets and temporary exports are destroyed after validation using
  approved provider controls.
- No operator manually deletes the last known good recovery point.

## Real tooling: `scripts/production/`

TASK 14.0 flagged this section as aspirational-only — the `backup-verify` /
`restore-validate` names below described a CLI that did not exist as
runnable code anywhere in the repo. TASK 14.1 replaced that with two real,
portable Node.js scripts (`.mjs`, run the same way on any host OS) that
orchestrate the real PostgreSQL client tools (`pg_dump`, `pg_restore`,
`psql`) — neither script reimplements dump/restore logic itself.

### `scripts/production/backup-db.mjs` — produce one backup

```
DATABASE_URL=postgresql://user:pass@host:5432/dbname \
  node scripts/production/backup-db.mjs [--out-dir <dir>]
```

(equivalently, from the repo root: `pnpm backup:db -- --out-dir <dir>`)

- Required env: `DATABASE_URL`.
- `--out-dir` defaults to `./backups` (gitignored — see root `.gitignore`;
  never point this at a path that could be committed).
- Shells out to `pg_dump --format=custom` (`-Fc`, `pg_restore`-compatible,
  supports selective/parallel restore) against the URL. The password is
  passed to `pg_dump` via `PGPASSWORD`, never as a CLI argument — it is
  never printed by this script, in any output, at any point.
- Output file name embeds an explicit UTC timestamp, e.g.
  `asone-backup-2026-09-15T03-00-00Z.dump` — every run gets its own file;
  nothing is silently overwritten.
- On any failure (nonzero `pg_dump` exit, or a 0-byte output file despite a
  zero exit code) it prints the `pg_dump` stderr, deletes the partial file,
  and exits nonzero. A `pg_dump` binary missing from `PATH` is reported with
  a clear message rather than a stack trace.
- On success it prints a manifest to stdout: file path, size, database name,
  a redacted connection string (password replaced with `****`), UTC
  timestamp and duration — never the raw `DATABASE_URL`.

This script's job stops at "one correct local backup file." It does not
rotate/retain old backups, upload anywhere, or encrypt the output — see
"Operator recommendations" below for what covers those.

### `scripts/production/verify-restore.mjs` — prove a backup restores

```
VERIFY_DATABASE_URL=postgresql://user:pass@host:5432/asone_restore_verify_<task> \
  node scripts/production/verify-restore.mjs <path-to-backup.dump>
```

(equivalently: `pnpm verify:restore -- <path-to-backup.dump>`)

- Required env: `VERIFY_DATABASE_URL`, pointing at a **separate, disposable**
  verification database — never the primary/production database.
- Optional env: `DATABASE_URL` — when set, used only so the script can
  refuse to run if `VERIFY_DATABASE_URL` is textually identical to it.
- **Safety gate** (fail-closed, mirroring the loopback/name-allowlist
  convention `apps/api/src/development/bootstrap-owner.service.ts`'s
  `validateBootstrapEnvironment` already uses in this codebase): the
  verification database's name must contain `restore_verify` or end with
  `_verify`; names that look like a real primary/production database
  (`asone_local`, anything starting `asone_prod`, containing `prod`, or the
  PostgreSQL system databases) are refused even if they also match the
  verify pattern. `VERIFY_DATABASE_URL == DATABASE_URL` is refused outright.
- Once the target passes the gate, the script `DROP DATABASE IF EXISTS ...
  WITH (FORCE)` then `CREATE DATABASE ...` for that verification database
  only (via the `postgres` maintenance database on the same server), so
  every run restores into a guaranteed-empty target. It never issues a
  DROP/CREATE/data statement against any database that did not just pass
  the safety gate — the primary database is never touched.
- Restores the file with `pg_restore --no-owner --no-privileges
  --exit-on-error`.
- Runs a real integrity check against the restored database: the migration
  journal table (`drizzle.__drizzle_migrations`) row count must match the
  authoritative count read live from
  `packages/database/drizzle/meta/_journal.json` (24 entries as of this
  writing — the script re-reads the file, so it stays correct as migrations
  are added); the core tables `companies`, `branches`, `users`, `sales` and
  `cash_sessions` must exist and be queryable; row counts for each are
  printed so an operator can eyeball "this looks like real data."
- Exits nonzero with a specific, printed reason on any failure (safety-gate
  rejection, restore failure, missing table, migration-count mismatch). On
  success it leaves the verification database in place for inspection —
  the operator drops it when done (never reuse it as a real database).

### Operator recommendations (not automated by these scripts)

- **Schedule**: run `backup-db.mjs` on a cron (or equivalent) matching the
  backup catalog above; a daily base backup is the current baseline.
- **Retention**: rotate/prune old `.dump` files per the retention column in
  the backup catalog above (e.g. a small wrapper script or your scheduler's
  own retention policy) — `backup-db.mjs` intentionally does not delete
  anything itself.
- **Offsite copy**: upload each `.dump` file to your approved
  cloud-storage/cross-location target (e.g. `rclone copy`) immediately after
  a successful backup, before the local copy is ever pruned.
- **At-rest encryption**: encrypt the `.dump` file (or the storage/bucket it
  lands in) per the "Security and isolation" section above — this script
  produces a plaintext custom-format dump; encryption is the operator's
  responsibility, not the script's.
- **Restore drills**: run `verify-restore.mjs` against the latest backup on
  the cadence in `docs/DISASTER_RECOVERY.md`'s exercises table, and record
  its printed report as evidence.
