import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * TASK 17.6.1 — the number of migrations the journal declares. Integration
 * tests that assert "all migrations were applied" compare against this
 * instead of a hard-coded count that goes stale each time a migration is
 * added (it had drifted from 34 to 53).
 */
export function journalMigrationCount(): number {
  const journal = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  return journal.entries.length;
}
