import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';

import { createDatabaseClient } from '../client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('postgresql://')) {
  throw new Error('DATABASE_URL must be a PostgreSQL URL.');
}

const client = createDatabaseClient({
  connectionString: databaseUrl,
  applicationName: 'asone-migrate',
});
try {
  await migrate(client.db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
} finally {
  await client.close();
}
