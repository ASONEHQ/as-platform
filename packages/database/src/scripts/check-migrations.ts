import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationDirectory = resolve(import.meta.dirname, '../../drizzle');
const sqlFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();

if (sqlFiles.length === 0) throw new Error('No versioned SQL migration was found.');

let combinedSource = '';
for (const file of sqlFiles) {
  const source = await readFile(resolve(migrationDirectory, file), 'utf8');
  combinedSource += source;
  const forbidden = [/\bdrop\s+table\b/iu, /\bdrop\s+column\b/iu, /postgresql:\/\//iu];
  if (forbidden.some((pattern) => pattern.test(source))) {
    throw new Error(`Migration ${file} contains a destructive statement or secret-like URL.`);
  }
}

for (const required of [
  'companies',
  'branches',
  'users',
  'company_memberships',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'devices',
  'sessions',
  'session_refresh_tokens',
  'audit_log',
  'outbox_events',
  'idempotency_keys',
]) {
  if (!combinedSource.includes(`"${required}"`)) {
    throw new Error(`Migration history does not contain required table ${required}.`);
  }
}

for (const requiredConstraint of [
  'users_normalized_email_uq',
  'company_memberships_company_user_uq',
  'user_roles_membership_scope_fk',
  'user_roles_role_scope_fk',
  'user_roles_branch_scope_fk',
  'sessions_membership_context_fk',
  'sessions_device_scope_fk',
  'sessions_branch_scope_fk',
  'session_refresh_tokens_hash_uq',
  'session_refresh_tokens_session_generation_uq',
]) {
  if (!combinedSource.includes(`"${requiredConstraint}"`)) {
    throw new Error(
      `Migration history does not contain required constraint ${requiredConstraint}.`,
    );
  }
}

process.stdout.write(`Validated ${String(sqlFiles.length)} migration file(s) statically.\n`);
