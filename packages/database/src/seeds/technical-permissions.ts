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
  'inventory.cost.read',
  'inventory_location.manage',
  'inventory.adjust',
  'inventory.approve',
  'inventory.count',
  'inventory.reverse',
  'inventory.reservation.manage',
  'inventory.reconcile',
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
  // TASK 12.9 — the promotions/discounts/coupons engine. `promotion.*`/
  // `coupon.*` gate the admin management surface (list/create/edit/
  // activate); `discount.apply` gates the checkout-time manual-discount
  // action, deliberately separate from `promotion.manage`/`coupon.manage`
  // since a cashier authorized to apply a discount at the register is not
  // automatically someone who should be editing the promotions catalog
  // (mirrors `cash_movement.create` vs `cash_register.manage`'s own
  // separation — TASK 12.7).
  'promotion.read',
  'promotion.manage',
  'coupon.read',
  'coupon.manage',
  'discount.apply',
  // TASK 13.0 — Customers/Memberships/AS Rewards+ foundation. `customer.*`
  // gates the identity CRUD a cashier needs day-to-day (lookup + quick
  // registration); `membership.read`/`membership.manage`/`membership.issue`
  // mirror the `promotion.read/manage` shape (catalog-admin vs. read) plus
  // one more (`membership.issue`) for the checkout/renewal-time action,
  // deliberately separate from `membership.manage` the same way
  // `discount.apply` is kept separate from `promotion.manage`; `loyalty.
  // read`/`loyalty.manage`/`loyalty.adjust` mirror the same three-tier
  // shape, with `loyalty.adjust` kept separately permissioned as the
  // highest-risk manual ledger correction (Part Y explicitly requires
  // this separation).
  'customer.read',
  'customer.create',
  'customer.update',
  'membership.read',
  'membership.manage',
  'membership.issue',
  'loyalty.read',
  'loyalty.manage',
  'loyalty.adjust',
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
