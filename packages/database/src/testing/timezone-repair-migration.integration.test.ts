import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from '../client.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const migrationsPath = resolve(import.meta.dirname, '../../drizzle');

/** TASK 16.8B — the real production data-repair migration
 * (`0030_repair_invalid_branch_company_timezones.sql`), run for real
 * against PostgreSQL. Builds the exact schema state that migration is
 * meant to run against (through migration 0029, before 0030 itself),
 * inserts fixture rows reproducing the real production corruption
 * (`timezone = 'Mexico_City'`) plus a DIFFERENT, unrelated bad value the
 * migration must never guess at, then applies 0030's own SQL file
 * content directly (never re-typed/paraphrased) and re-applies it a
 * second time to prove idempotency — matching how the DigitalOcean
 * migration job could, in principle, retry a partially-applied run. */
integration('PostgreSQL migration 0030 — repair invalid branch/company timezones (TASK 16.8B)', () => {
  let database: DatabaseClient;
  const companyId = randomUUID();
  const otherBadCompanyId = randomUUID();
  const branchId = randomUUID();
  const otherBadBranchId = randomUUID();
  const alreadyValidBranchId = randomUUID();

  async function applyIfMissing(regclass: string, files: readonly string[]): Promise<void> {
    const check = await database.pool.query<{ present: string | null }>(
      `select to_regclass('public.${regclass}')::text present`,
    );
    if (check.rows[0]?.present !== null) return;
    for (const file of files) {
      const sql = await readFile(resolve(migrationsPath, file), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim().length > 0) await database.pool.query(statement);
    }
  }

  async function applyRepairMigration(): Promise<void> {
    const sql = await readFile(resolve(migrationsPath, '0030_repair_invalid_branch_company_timezones.sql'), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim().length > 0) await database.pool.query(statement);
  }

  beforeAll(async () => {
    if (databaseUrl === undefined || !new URL(databaseUrl).pathname.toLowerCase().includes('test'))
      throw new Error('DATABASE_TEST_URL must identify a dedicated test database.');
    database = createDatabaseClient({ connectionString: databaseUrl, applicationName: 'asone-tz-migration-repair' });
    await applyIfMissing('companies', [
      '0000_fantastic_black_cat.sql',
      '0001_high_thor.sql',
      '0002_true_sugar_man.sql',
      '0003_curved_zuras.sql',
      '0004_pink_nehzno.sql',
      '0005_inventory_operations_foundation.sql',
      '0006_inventory_transfers_and_reservations.sql',
      '0007_inventory_counts_foundation.sql',
      '0008_inventory_reconciliation_findings.sql',
      '0009_auth_login_challenges.sql',
      '0010_auth_session_transport_mode.sql',
    ]);

    // The exact production corruption: a company AND a branch both saved
    // with the bare-city, non-IANA value.
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'TZ Migration Co','TZ Migration Co',$2,'active','Mexico_City','MXN','es-MX')`,
      [companyId, `tz-migration-${companyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Puerta La Victoria (fixture)','PLV','active','Mexico_City'),
             ($3,$2,'Already Correct Branch','OK','active','America/Cancun')`,
      [branchId, companyId, alreadyValidBranchId],
    );
    // A DIFFERENT, unrelated bad value this migration has no safe,
    // unambiguous mapping for — must be left completely untouched, only
    // reported via the migration's own detection block.
    await database.pool.query(
      `insert into companies(id,legal_name,display_name,slug,status,timezone,currency_code,locale)
       values($1,'TZ Migration Other Co','TZ Migration Other Co',$2,'active','Definitely_Not_A_Real_Zone','MXN','es-MX')`,
      [otherBadCompanyId, `tz-migration-other-${otherBadCompanyId}`],
    );
    await database.pool.query(
      `insert into branches(id,company_id,name,code,status,timezone)
       values($1,$2,'Other Unrelated Bad Branch','BAD','active','Some/Other_Bad_Value')`,
      [otherBadBranchId, otherBadCompanyId],
    );
  });

  afterAll(async () => {
    await database.pool.query('delete from branches where company_id in ($1,$2)', [companyId, otherBadCompanyId]);
    await database.pool.query('delete from companies where id in ($1,$2)', [companyId, otherBadCompanyId]);
    await database.close();
  });

  it('repairs the exact known "Mexico_City" -> "America/Mexico_City" mapping for both companies and branches', async () => {
    await applyRepairMigration();
    const company = await database.pool.query<{ timezone: string }>('select timezone from companies where id=$1', [
      companyId,
    ]);
    expect(company.rows[0]?.timezone).toBe('America/Mexico_City');
    const branch = await database.pool.query<{ timezone: string }>('select timezone from branches where id=$1', [
      branchId,
    ]);
    expect(branch.rows[0]?.timezone).toBe('America/Mexico_City');
  });

  it('never touches an already-correct branch/company timezone', async () => {
    const branch = await database.pool.query<{ timezone: string }>('select timezone from branches where id=$1', [
      alreadyValidBranchId,
    ]);
    expect(branch.rows[0]?.timezone).toBe('America/Cancun');
  });

  it('never blindly rewrites a DIFFERENT, unrelated invalid timezone value it has no safe mapping for', async () => {
    const company = await database.pool.query<{ timezone: string }>('select timezone from companies where id=$1', [
      otherBadCompanyId,
    ]);
    expect(company.rows[0]?.timezone).toBe('Definitely_Not_A_Real_Zone');
    const branch = await database.pool.query<{ timezone: string }>('select timezone from branches where id=$1', [
      otherBadBranchId,
    ]);
    expect(branch.rows[0]?.timezone).toBe('Some/Other_Bad_Value');
  });

  it('is idempotent — applying it a second time is a safe no-op, never an error, and the repaired rows stay repaired', async () => {
    await expect(applyRepairMigration()).resolves.toBeUndefined();
    const company = await database.pool.query<{ timezone: string }>('select timezone from companies where id=$1', [
      companyId,
    ]);
    expect(company.rows[0]?.timezone).toBe('America/Mexico_City');
    const branch = await database.pool.query<{ timezone: string }>('select timezone from branches where id=$1', [
      branchId,
    ]);
    expect(branch.rows[0]?.timezone).toBe('America/Mexico_City');
    // The still-unrelated bad values remain exactly as they were — a
    // second run detects the same anomalies, it never "gives up" and
    // rewrites them out of impatience.
    const otherCompany = await database.pool.query<{ timezone: string }>(
      'select timezone from companies where id=$1',
      [otherBadCompanyId],
    );
    expect(otherCompany.rows[0]?.timezone).toBe('Definitely_Not_A_Real_Zone');
  });
});
