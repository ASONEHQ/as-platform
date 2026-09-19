import { createDatabaseClient } from '../client.js';
import { syncSystemRolePermissions } from '../seeds/system-role-permissions.js';
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
  // TASK 16.10B — keeps every tenant's system-managed (is_system=true,
  // e.g. "Owner") role's permission set current with the catalogue above,
  // for tenants provisioned before a given permission existed. Never
  // touches a tenant's own custom roles. See this function's own doc
  // comment for the full incident/rationale.
  const granted = await syncSystemRolePermissions(client.db);
  process.stdout.write(`Granted ${String(granted)} new system-role permission(s) across existing tenants.\n`);
} finally {
  await client.close();
}
