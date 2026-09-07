import { createDatabaseClient } from '@asone/database';

import { PosCatalogSeedError } from './seed-pos-catalog.service.js';
import { LoyaltyRewardsSeed, validateSeedEnvironment } from './seed-loyalty-rewards.service.js';

export async function runSeedLoyaltyRewards(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let database;
  try {
    const input = validateSeedEnvironment(environment);
    database = createDatabaseClient({
      connectionString: input.databaseUrl,
      applicationName: 'asone-development-loyalty-rewards-seed',
    });
    const summary = await new LoyaltyRewardsSeed(database).run();
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ success: false, error: error instanceof PosCatalogSeedError ? error.message : 'Loyalty rewards seed failed.' })}\n`,
    );
    return 1;
  } finally {
    await database?.close();
  }
}

if (process.argv[1]?.endsWith('seed-loyalty-rewards.cli.ts') === true) {
  runSeedLoyaltyRewards()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
