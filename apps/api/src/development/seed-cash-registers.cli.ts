import { createDatabaseClient } from '@asone/database';

import { PosCatalogSeedError } from './seed-pos-catalog.service.js';
import { CashRegisterSeed, validateSeedEnvironment } from './seed-cash-registers.service.js';

export async function runSeedCashRegisters(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let database;
  try {
    const input = validateSeedEnvironment(environment);
    database = createDatabaseClient({
      connectionString: input.databaseUrl,
      applicationName: 'asone-development-cash-register-seed',
    });
    const summary = await new CashRegisterSeed(database).run();
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ success: false, error: error instanceof PosCatalogSeedError ? error.message : 'Cash register seed failed.' })}\n`,
    );
    return 1;
  } finally {
    await database?.close();
  }
}

if (process.argv[1]?.endsWith('seed-cash-registers.cli.ts') === true) {
  runSeedCashRegisters()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
