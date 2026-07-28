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
  'inventory_transfers',
  'inventory_transfer_lines',
  'inventory_reservations',
  'inventory_reservation_lines',
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
  'product_categories_parent_scope_fk',
  'products_category_scope_fk',
  'products_brand_scope_fk',
  'product_option_values_definition_scope_fk',
  'product_variant_option_values_variant_scope_fk',
  'product_variant_option_values_value_scope_fk',
  'product_variants_company_sku_active_uq',
  'product_variants_product_default_active_uq',
  'product_variants_product_option_signature_active_uq',
  'product_barcodes_company_barcode_active_uq',
  'product_barcodes_variant_primary_active_uq',
  'inventory_locations_branch_scope_fk',
  'inventory_locations_company_branch_code_active_uq',
  'inventory_locations_company_branch_default_active_uq',
  'inventory_balances_location_scope_fk',
  'inventory_balances_variant_scope_fk',
  'inventory_movements_reversal_of_scope_fk',
  'inventory_movement_lines_movement_scope_fk',
  'inventory_movement_lines_variant_scope_fk',
  'inventory_movement_lines_source_scope_fk',
  'inventory_movement_lines_destination_scope_fk',
  'inventory_transfers_source_location_scope_fk',
  'inventory_transfers_destination_location_scope_fk',
  'inventory_transfers_transit_location_scope_fk',
  'inventory_transfers_shipment_movement_scope_fk',
  'inventory_transfers_receipt_movement_scope_fk',
  'inventory_transfer_lines_transfer_scope_fk',
  'inventory_transfer_lines_variant_scope_fk',
  'inventory_reservations_branch_scope_fk',
  'inventory_reservation_lines_reservation_scope_fk',
  'inventory_reservation_lines_location_scope_fk',
  'inventory_reservation_lines_variant_scope_fk',
]) {
  if (!combinedSource.includes(`"${requiredConstraint}"`)) {
    throw new Error(
      `Migration history does not contain required constraint ${requiredConstraint}.`,
    );
  }
}

process.stdout.write(`Validated ${String(sqlFiles.length)} migration file(s) statically.\n`);
