import { v5 as uuidv5 } from 'uuid';

import type { Database } from '../client.js';
import { permissions } from '../schema/index.js';

const permissionNamespace = '80918c28-4b9a-4bbb-9fc7-0943c0d62d9d';

export const technicalPermissionCodes = [
  'company.read',
  'company.update',
  'company_settings.read',
  'company_settings.update',
  'branch.read',
  'branch.create',
  'branch.update',
  'branch_settings.read',
  'branch_settings.update',
  'user.read',
  'user.create',
  'user.update',
  'role.read',
  'role.create',
  'role.update',
  'role.assign',
  'permission.read',
  'branch_access.manage',
  'device.read',
  'device.register',
  'device.revoke',
  'cash_register.read',
  'cash_register.manage',
  'cash_session.read',
  'cash_session.open',
  'cash_movement.create',
  'cash_session.close',
  'catalog.read',
  'category.manage',
  'product.manage',
  'price.manage',
  'availability.manage',
  'inventory.read',
  'inventory_location.manage',
  'inventory.adjust',
  'inventory.count',
  'inventory.reverse',
  'sale.read',
  'sale.create',
  'sale.complete',
  'sale.cancel',
  'payment.read',
  'payment.create',
  'payment.reverse',
  'refund.read',
  'refund.create',
  'refund.approve',
  'refund.complete',
  'refund.cancel',
  'sync.execute',
  'audit.read',
  'recovery.read',
] as const;

export async function seedTechnicalPermissions(db: Database): Promise<number> {
  const values = technicalPermissionCodes.map((code) => ({
    id: uuidv5(code, permissionNamespace),
    code,
    domain: code.split('.')[0] ?? 'platform',
    description: `Approved AS ONE capability: ${code}`,
  }));
  const inserted = await db.insert(permissions).values(values).onConflictDoNothing().returning({
    id: permissions.id,
  });
  return inserted.length;
}
