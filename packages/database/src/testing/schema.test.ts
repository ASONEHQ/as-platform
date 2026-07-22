import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  auditLog,
  branches,
  companyMemberships,
  companies,
  devices,
  idempotencyKeys,
  outboxEvents,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from '../schema/index.js';
import { technicalPermissionCodes } from '../seeds/technical-permissions.js';

const tableNames = [
  companies,
  branches,
  users,
  companyMemberships,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  devices,
  sessions,
  auditLog,
  outboxEvents,
  idempotencyKeys,
].map((table) => getTableConfig(table).name);

describe('database foundation schema', () => {
  it('defines only the approved foundation tables with snake_case names', () => {
    expect(tableNames).toEqual([
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
      'audit_log',
      'outbox_events',
      'idempotency_keys',
    ]);
    for (const table of tableNames) expect(table).toMatch(/^[a-z][a-z0-9_]*$/u);
  });

  it('uses tenant composite constraints for critical relationships and uniqueness', () => {
    const names = [
      branches,
      companyMemberships,
      roles,
      rolePermissions,
      userRoles,
      devices,
      sessions,
    ].flatMap((table) =>
      getTableConfig(table).uniqueConstraints.map((constraint) => constraint.name),
    );
    expect(names).toContain('branches_company_code_uq');
    expect(getTableConfig(users).uniqueConstraints.map((item) => item.name)).toContain(
      'users_normalized_email_uq',
    );
    expect(names).toContain('company_memberships_company_user_uq');
    expect(names).toContain('roles_company_code_uq');

    const assignmentIndexes = getTableConfig(userRoles).indexes.map((item) => item.config.name);
    expect(assignmentIndexes).toContain('user_roles_company_scope_uq');
    expect(assignmentIndexes).toContain('user_roles_branch_scope_uq');
  });

  it('binds roles and sessions to an explicit company membership', () => {
    const roleForeignKeys = getTableConfig(userRoles).foreignKeys.map((item) => item.getName());
    const sessionForeignKeys = getTableConfig(sessions).foreignKeys.map((item) => item.getName());
    expect(roleForeignKeys).toContain('user_roles_membership_scope_fk');
    expect(roleForeignKeys).toContain('user_roles_role_scope_fk');
    expect(roleForeignKeys).toContain('user_roles_branch_scope_fk');
    expect(sessionForeignKeys).toContain('sessions_membership_context_fk');
    expect(sessionForeignKeys).toContain('sessions_device_scope_fk');
  });

  it('defines durable uniqueness and numeric guards for control records', () => {
    const outboxConfig = getTableConfig(outboxEvents);
    const outboxChecks = outboxConfig.checks.map((constraint) => constraint.name);
    expect(outboxConfig.primaryKeys).toHaveLength(0);
    expect(outboxConfig.columns.find((column) => column.name === 'event_id')?.primary).toBe(true);
    expect(outboxChecks).toContain('outbox_events_attempts_ck');
    expect(outboxChecks).toContain('outbox_events_aggregate_version_ck');

    const idempotencyUniques = getTableConfig(idempotencyKeys).uniqueConstraints.map(
      (constraint) => constraint.name,
    );
    expect(idempotencyUniques).toContain('idempotency_keys_company_operation_key_uq');
  });

  it('keeps session tokens hashed and excludes plaintext token columns', () => {
    const columns = getTableConfig(sessions).columns.map((column) => column.name);
    expect(columns).toContain('token_hash');
    expect(columns).not.toContain('token');
    expect(columns).not.toContain('refresh_token');
  });

  it('models audit evidence and outbox payloads as append-only rows', () => {
    const auditColumns = getTableConfig(auditLog).columns.map((column) => column.name);
    const outboxColumns = getTableConfig(outboxEvents).columns.map((column) => column.name);
    expect(auditColumns).not.toContain('updated_at');
    expect(auditColumns).not.toContain('deleted_at');
    expect(outboxColumns).not.toContain('updated_at');
    expect(outboxColumns).not.toContain('deleted_at');
  });

  it('contains exactly the 52 approved permission definitions', () => {
    expect(technicalPermissionCodes).toHaveLength(52);
    expect(new Set(technicalPermissionCodes).size).toBe(52);
  });
});
