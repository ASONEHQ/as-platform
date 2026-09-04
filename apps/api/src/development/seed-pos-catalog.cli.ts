import { createDatabaseClient } from '@asone/database';

import { PosCatalogSeed, PosCatalogSeedError, validateSeedEnvironment } from './seed-pos-catalog.service.js';

export async function runSeedPosCatalog(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let database;
  try {
    const input = validateSeedEnvironment(environment);
    database = createDatabaseClient({
      connectionString: input.databaseUrl,
      applicationName: 'asone-development-pos-catalog-seed',
    });
    const summary = await new PosCatalogSeed(database).run();
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ success: false, error: error instanceof PosCatalogSeedError ? error.message : 'POS catalog seed failed.' })}\n`,
    );
    return 1;
  } finally {
    await database?.close();
  }
}

if (process.argv[1]?.endsWith('seed-pos-catalog.cli.ts') === true) {
  runSeedPosCatalog()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
