import { createDatabaseClient } from '../client.js';
import { seedTechnicalPermissions } from '../seeds/technical-permissions.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('postgresql://')) {
  throw new Error('DATABASE_URL must be a PostgreSQL URL.');
}

const client = createDatabaseClient({
  connectionString: databaseUrl,
  applicationName: 'asone-seed',
  // TASK 16.3A — see `@asone/config`'s `DATABASE_SSL_CA_CERT` doc comment;
  // this script bypasses `@asone/config` entirely (reads `DATABASE_URL`
  // directly above), so it reads this one directly too.
  sslRootCert: process.env.DATABASE_SSL_CA_CERT,
});
try {
  const count = await seedTechnicalPermissions(client.db);
  process.stdout.write(`Inserted ${String(count)} approved permission definitions.\n`);
} finally {
  await client.close();
}
