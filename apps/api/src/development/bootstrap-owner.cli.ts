import { createDatabaseClient } from '@asone/database';

import {
  BootstrapInputError,
  DevelopmentOwnerBootstrap,
  validateBootstrapEnvironment,
} from './bootstrap-owner.service.js';

export async function runBootstrapOwner(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let database;
  try {
    const input = validateBootstrapEnvironment(environment);
    database = createDatabaseClient({
      connectionString: input.databaseUrl,
      applicationName: 'asone-development-owner-bootstrap',
    });
    const summary = await new DevelopmentOwnerBootstrap(database).run(input.password);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ success: false, error: error instanceof BootstrapInputError ? error.message : 'Bootstrap failed.' })}\n`,
    );
    return 1;
  } finally {
    await database?.close();
  }
}

if (process.argv[1]?.endsWith('bootstrap-owner.cli.ts') === true) {
  runBootstrapOwner()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
