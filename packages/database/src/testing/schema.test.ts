import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  authLoginChallenges,
  auditLog,
  brands,
  branchSettings,
  branches,
  companyMemberships,
  companySettings,
  companies,
  devices,
  idempotencyKeys,
  inventoryBalances,
  inventoryCountLines,
  inventoryCounts,
  inventoryLocations,
  inventoryMovementLines,
  inventoryMovements,
  inventoryReconciliationFindings,
  inventoryReconciliationFindingSeverities,
  inventoryReconciliationFindingStatuses,
  inventoryReconciliationFindingTypes,
  inventoryReservationLines,
  inventoryReservations,
  inventoryTransferLines,
  inventoryTransfers,
  productBarcodes,
  productCategories,
  productOptionDefinitions,
  productOptionValues,
  products,
  productVariantOptionValues,
  productVariants,
  outboxEvents,
  permissions,
  rolePermissions,
  roles,
  sessions,
  sessionRefreshTokens,
  userRoles,
  users,
  unitsOfMeasure,
} from '../schema/index.js';
import { technicalPermissionCodes } from '../seeds/technical-permissions.js';

const tableNames = [
  authLoginChallenges,
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
  sessionRefreshTokens,
  auditLog,
  outboxEvents,
  idempotencyKeys,
  companySettings,
  branchSettings,
  productCategories,
  brands,
  unitsOfMeasure,
  products,
  productOptionDefinitions,
  productOptionValues,
  productVariants,
  productVariantOptionValues,
  productBarcodes,
  inventoryLocations,
  inventoryBalances,
  inventoryMovements,
  inventoryMovementLines,
  inventoryReconciliationFindings,
  inventoryTransfers,
  inventoryTransferLines,
  inventoryReservations,
  inventoryReservationLines,
  inventoryCounts,
  inventoryCountLines,
].map((table) => getTableConfig(table).name);

describe('database foundation schema', () => {
  it('records exactly eleven migrations ending in session transport mode', () => {
    const journal = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries).toHaveLength(11);
    expect(journal.entries.map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(journal.entries.at(-1)?.tag).toBe('0010_auth_session_transport_mode');
  });

  it('keeps migration 0010 additive and limited to the session transport column', () => {
    const migration = readFileSync(
      resolve(import.meta.dirname, '../../drizzle/0010_auth_session_transport_mode.sql'),
      'utf8',
    );
    expect(migration.match(/add column/giu)).toHaveLength(1);
    expect(migration.match(/add constraint/giu)).toHaveLength(1);
    expect(migration).toContain(`ADD COLUMN "transport_mode" text DEFAULT 'bearer' NOT NULL`);
    expect(migration).toContain(`CHECK ("sessions"."transport_mode" in ('browser', 'bearer'))`);
    expect(migration).not.toMatch(
      /\b(drop|truncate|delete|update|create trigger|create function)\b/iu,
    );
    expect(migration).not.toContain('session_refresh_tokens');
  });
  it('defines only the approved foundation tables with snake_case names', () => {
    expect(tableNames).toEqual([
      'auth_login_challenges',
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
      'company_settings',
      'branch_settings',
      'product_categories',
      'brands',
      'units_of_measure',
      'products',
      'product_option_definitions',
      'product_option_values',
      'product_variants',
      'product_variant_option_values',
      'product_barcodes',
      'inventory_locations',
      'inventory_balances',
      'inventory_movements',
      'inventory_movement_lines',
      'inventory_reconciliation_findings',
      'inventory_transfers',
      'inventory_transfer_lines',
      'inventory_reservations',
      'inventory_reservation_lines',
      'inventory_counts',
      'inventory_count_lines',
    ]);
    for (const table of tableNames) expect(table).toMatch(/^[a-z][a-z0-9_]*$/u);
  });

  it('defines the login challenge physical security boundary', () => {
    const config = getTableConfig(authLoginChallenges);
    const columns = config.columns.map((column) => column.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'user_id',
        'token_hash',
        'eligible_company_ids',
        'selected_company_id',
        'device_id',
        'client_type',
        'attempt_count',
        'max_attempts',
        'expires_at',
        'consumed_at',
        'invalidated_at',
        'metadata',
        'version',
      ]),
    );
    expect(columns).not.toContain('token');
    expect(columns).not.toContain('password');
    expect(config.uniqueConstraints.map((item) => item.name)).toContain(
      'auth_login_challenges_token_hash_uq',
    );
    expect(config.foreignKeys).toHaveLength(3);
    expect(config.checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'auth_login_challenges_token_hash_ck',
        'auth_login_challenges_status_ck',
        'auth_login_challenges_attempts_ck',
        'auth_login_challenges_expiry_ck',
        'auth_login_challenges_lifecycle_ck',
        'auth_login_challenges_metadata_ck',
      ]),
    );
    expect(config.indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        'auth_login_challenges_user_status_idx',
        'auth_login_challenges_pending_expiry_idx',
        'auth_login_challenges_created_at_idx',
      ]),
    );
    for (const column of config.columns) {
      expect(column.getSQLType()).not.toBe('real');
      expect(column.getSQLType()).not.toBe('double precision');
    }
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
    const sessionConfig = getTableConfig(sessions);
    const columns = sessionConfig.columns.map((column) => column.name);
    expect(columns).toContain('token_hash');
    expect(columns).toContain('transport_mode');
    expect(columns).not.toContain('token');
    expect(columns).not.toContain('refresh_token');
    const transportMode = sessionConfig.columns.find((column) => column.name === 'transport_mode');
    expect(transportMode?.getSQLType()).toBe('text');
    expect(transportMode?.notNull).toBe(true);
    expect(transportMode?.hasDefault).toBe(true);
    expect(transportMode?.default).toBe('bearer');
    expect(sessionConfig.checks.map((constraint) => constraint.name)).toContain(
      'sessions_transport_mode_ck',
    );
    const refreshColumns = getTableConfig(sessionRefreshTokens).columns.map(
      (column) => column.name,
    );
    expect(refreshColumns).toContain('token_hash');
    expect(refreshColumns).not.toContain('transport_mode');
    expect(refreshColumns).not.toContain('token');
    expect(refreshColumns).not.toContain('refresh_token');
  });

  it('models audit evidence and outbox payloads as append-only rows', () => {
    const auditColumns = getTableConfig(auditLog).columns.map((column) => column.name);
    const outboxColumns = getTableConfig(outboxEvents).columns.map((column) => column.name);
    expect(auditColumns).not.toContain('updated_at');
    expect(auditColumns).not.toContain('deleted_at');
    expect(outboxColumns).not.toContain('updated_at');
    expect(outboxColumns).not.toContain('deleted_at');
  });

  it('contains exactly the 56 approved permission definitions', () => {
    expect(technicalPermissionCodes).toHaveLength(56);
    expect(new Set(technicalPermissionCodes).size).toBe(56);
    expect(technicalPermissionCodes).toContain('inventory.cost.read');
    expect(technicalPermissionCodes).toContain('inventory.approve');
    expect(technicalPermissionCodes).toContain('inventory.reservation.manage');
    expect(technicalPermissionCodes).toContain('inventory.reconcile');
  });

  it('defines scoped settings ownership, uniqueness, and structural checks', () => {
    const companyConfig = getTableConfig(companySettings);
    const branchConfig = getTableConfig(branchSettings);

    expect(companyConfig.columns.find((column) => column.name === 'id')?.primary).toBe(true);
    expect(branchConfig.columns.find((column) => column.name === 'id')?.primary).toBe(true);
    expect(companyConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      'company_settings_company_key_uq',
    );
    expect(branchConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      'branch_settings_company_branch_key_uq',
    );
    expect(branchConfig.foreignKeys.map((foreignKey) => foreignKey.getName())).toContain(
      'branch_settings_branch_scope_fk',
    );
    expect(companyConfig.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'company_settings_company_id_companies_id_fk',
        'company_settings_created_by_users_id_fk',
        'company_settings_updated_by_users_id_fk',
      ]),
    );
    expect(branchConfig.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'branch_settings_company_id_companies_id_fk',
        'branch_settings_created_by_users_id_fk',
        'branch_settings_updated_by_users_id_fk',
        'branch_settings_branch_scope_fk',
      ]),
    );

    for (const config of [companyConfig, branchConfig]) {
      const checks = config.checks.map((constraint) => constraint.name);
      expect(checks).toEqual(
        expect.arrayContaining([
          `${config.name}_key_nonblank_ck`,
          `${config.name}_value_type_ck`,
          `${config.name}_status_ck`,
          `${config.name}_version_ck`,
          `${config.name}_not_secret_ck`,
          `${config.name}_retirement_ck`,
          `${config.name}_value_structure_ck`,
        ]),
      );
      expect(config.columns.find((column) => column.name === 'value')?.dataType).toBe('json');
      expect(config.columns.find((column) => column.name === 'version')?.hasDefault).toBe(true);
      expect(config.columns.find((column) => column.name === 'is_secret')?.default).toBe(false);
      expect(config.columns.find((column) => column.name === 'created_by')?.notNull).toBe(true);
      expect(config.columns.find((column) => column.name === 'updated_by')?.notNull).toBe(true);
    }
  });

  it('defines tenant-safe catalog relationships and concurrency-sensitive indexes', () => {
    expect(getTableConfig(productCategories).foreignKeys.map((item) => item.getName())).toContain(
      'product_categories_parent_scope_fk',
    );
    expect(getTableConfig(products).foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining(['products_category_scope_fk', 'products_brand_scope_fk']),
    );
    expect(getTableConfig(productOptionValues).foreignKeys.map((item) => item.getName())).toContain(
      'product_option_values_definition_scope_fk',
    );
    expect(
      getTableConfig(productVariantOptionValues).foreignKeys.map((item) => item.getName()),
    ).toEqual(
      expect.arrayContaining([
        'product_variant_option_values_variant_scope_fk',
        'product_variant_option_values_definition_scope_fk',
        'product_variant_option_values_value_scope_fk',
      ]),
    );
    expect(getTableConfig(productVariants).indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        'product_variants_company_sku_active_uq',
        'product_variants_product_default_active_uq',
        'product_variants_product_option_signature_active_uq',
      ]),
    );
    expect(getTableConfig(productBarcodes).indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        'product_barcodes_company_barcode_active_uq',
        'product_barcodes_variant_primary_active_uq',
      ]),
    );
    expect(
      getTableConfig(unitsOfMeasure).columns.find((item) => item.name === 'code')?.primary,
    ).toBe(true);
  });

  it('defines the inventory physical foundation with tenant-safe constraints', () => {
    const locations = getTableConfig(inventoryLocations);
    const balances = getTableConfig(inventoryBalances);
    const movements = getTableConfig(inventoryMovements);
    const lines = getTableConfig(inventoryMovementLines);

    expect(locations.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_locations_branch_scope_fk',
        'inventory_locations_created_by_membership_fk',
        'inventory_locations_updated_by_membership_fk',
      ]),
    );
    expect(locations.indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        'inventory_locations_company_branch_code_active_uq',
        'inventory_locations_company_branch_default_active_uq',
      ]),
    );
    expect(balances.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_balances_location_scope_fk',
        'inventory_balances_variant_scope_fk',
        'inventory_balances_last_movement_scope_fk',
      ]),
    );
    expect(movements.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_movements_branch_scope_fk',
        'inventory_movements_reversal_of_scope_fk',
        'inventory_movements_reversed_by_scope_fk',
      ]),
    );
    expect(lines.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_movement_lines_movement_scope_fk',
        'inventory_movement_lines_variant_scope_fk',
        'inventory_movement_lines_source_scope_fk',
        'inventory_movement_lines_destination_scope_fk',
        'inventory_movement_lines_unit_of_measure_code_units_of_measure_code_fk',
      ]),
    );
    expect(balances.columns.find((item) => item.name === 'quantity_available')).toBeUndefined();
    expect(balances.columns.find((item) => item.name === 'quantity_on_hand')?.dataType).toBe(
      'string',
    );
    expect(lines.columns.find((item) => item.name === 'quantity')?.dataType).toBe('string');
  });

  it('defines tenant-safe transfer and reservation physical foundations', () => {
    const transfers = getTableConfig(inventoryTransfers);
    const transferLines = getTableConfig(inventoryTransferLines);
    const reservations = getTableConfig(inventoryReservations);
    const reservationLines = getTableConfig(inventoryReservationLines);

    expect(transfers.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_transfers_source_branch_scope_fk',
        'inventory_transfers_destination_branch_scope_fk',
        'inventory_transfers_source_location_scope_fk',
        'inventory_transfers_destination_location_scope_fk',
        'inventory_transfers_transit_location_scope_fk',
        'inventory_transfers_shipment_movement_scope_fk',
        'inventory_transfers_receipt_movement_scope_fk',
      ]),
    );
    expect(transferLines.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_transfer_lines_transfer_scope_fk',
        'inventory_transfer_lines_variant_scope_fk',
      ]),
    );
    expect(reservations.foreignKeys.map((item) => item.getName())).toContain(
      'inventory_reservations_branch_scope_fk',
    );
    expect(reservationLines.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_reservation_lines_reservation_scope_fk',
        'inventory_reservation_lines_variant_scope_fk',
        'inventory_reservation_lines_location_scope_fk',
      ]),
    );
    expect(
      reservationLines.columns.find((item) => item.name === 'remaining_quantity'),
    ).toBeUndefined();
    for (const column of [
      ...transferLines.columns.filter((item) => item.name.endsWith('_quantity')),
      ...reservationLines.columns.filter((item) => item.name.endsWith('_quantity')),
    ])
      expect(column.dataType).toBe('string');
  });

  it('defines the reconciliation finding lifecycle and tenant-safe physical foundation', () => {
    const findings = getTableConfig(inventoryReconciliationFindings);

    expect(inventoryReconciliationFindingTypes).toHaveLength(14);
    expect(inventoryReconciliationFindingSeverities).toEqual(['info', 'warning', 'critical']);
    expect(inventoryReconciliationFindingStatuses).toEqual([
      'open',
      'acknowledged',
      'resolved',
      'dismissed',
    ]);
    expect(findings.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'identity_key',
        'fingerprint_sha256',
        'detector_version',
        'expected_summary',
        'actual_summary',
        'evidence',
        'occurrence_count',
        'version',
      ]),
    );
    expect(findings.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'inventory_reconciliation_findings_branch_scope_fk',
        'inventory_reconciliation_findings_location_scope_fk',
        'inventory_reconciliation_findings_branch_location_scope_fk',
        'inventory_reconciliation_findings_variant_scope_fk',
        'inventory_reconciliation_findings_acknowledged_by_membership_fk',
        'inventory_reconciliation_findings_resolved_by_membership_fk',
        'inventory_reconciliation_findings_dismissed_by_membership_fk',
      ]),
    );
    expect(findings.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'inventory_reconciliation_findings_active_identity_uq',
        'inventory_reconciliation_findings_company_status_severity_idx',
        'inventory_reconciliation_findings_company_type_status_idx',
        'inventory_reconciliation_findings_open_critical_idx',
      ]),
    );
    expect(findings.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'inventory_reconciliation_findings_type_ck',
        'inventory_reconciliation_findings_severity_ck',
        'inventory_reconciliation_findings_status_ck',
        'inventory_reconciliation_findings_fingerprint_ck',
        'inventory_reconciliation_findings_lifecycle_ck',
        'inventory_reconciliation_findings_expected_summary_ck',
      ]),
    );
    for (const column of findings.columns) expect(column.dataType).not.toBe('number');
  });

  it('defines the durable count physical foundation and domain lock', () => {
    const counts = getTableConfig(inventoryCounts);
    const lines = getTableConfig(inventoryCountLines);

    expect(counts.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_counts_branch_scope_fk',
        'inventory_counts_location_scope_fk',
        'inventory_counts_application_movement_scope_fk',
        'inventory_counts_started_by_membership_fk',
        'inventory_counts_submitted_by_membership_fk',
        'inventory_counts_approved_by_membership_fk',
        'inventory_counts_applied_by_membership_fk',
        'inventory_counts_cancelled_by_membership_fk',
      ]),
    );
    expect(counts.indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        'inventory_counts_active_location_uq',
        'inventory_counts_lock_expiry_idx',
        'inventory_counts_location_status_idx',
      ]),
    );
    expect(lines.foreignKeys.map((item) => item.getName())).toEqual(
      expect.arrayContaining([
        'inventory_count_lines_count_scope_fk',
        'inventory_count_lines_variant_scope_fk',
        'inventory_count_lines_baseline_movement_scope_fk',
        'inventory_count_lines_counted_by_membership_fk',
        'inventory_count_lines_unit_of_measure_code_units_of_measure_code_fk',
      ]),
    );
    expect(lines.indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        'inventory_count_lines_incomplete_idx',
        'inventory_count_lines_baseline_movement_idx',
      ]),
    );
    expect(lines.columns.find((item) => item.name === 'difference_quantity')).toBeUndefined();
    expect(lines.columns.find((item) => item.name === 'expected_quantity')?.dataType).toBe(
      'string',
    );
    expect(lines.columns.find((item) => item.name === 'counted_quantity')?.dataType).toBe('string');
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
