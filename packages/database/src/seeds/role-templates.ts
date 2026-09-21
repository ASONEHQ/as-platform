import { technicalPermissionCodes } from './technical-permissions.js';

/**
 * TASK 16.16 — "commercial role templates": a starter permission BUNDLE an
 * admin can pick when creating a new role, so a normal Cashier/Manager
 * doesn't require hand-picking permissions one at a time from the full
 * catalogue. This is deliberately NOT a new authorization concept:
 *
 *  - It is never persisted anywhere (no `roles.template_key` column, no
 *    template table) — a template only pre-fills the permission checklist
 *    at role-CREATION time, via the exact same existing `POST /roles` +
 *    `PUT /roles/{id}/permissions` endpoints TASK 15.1/14.0 already built.
 *    Once created, a template-sourced role is an ORDINARY custom role
 *    (`is_system=false`) — fully editable, fully deletable, never
 *    auto-widened by `syncSystemRolePermissions()` (that function only
 *    ever touches `is_system=true` roles — see its own doc comment), and
 *    subject to the exact same self-escalation guard
 *    (`AdministrationService.replaceRolePermissions`/`assignRole`) as any
 *    other role: an admin can never grant a template's permission set to
 *    anyone if the admin doesn't already hold every one of those
 *    permissions themselves.
 *  - It is never read by any authorization check, and never by any
 *    workspace/navigation-routing decision (TASK 16.16 §4 explicitly
 *    forbids deriving behavior from a role's name/label/template — see
 *    `pos_workspace.dart`'s own doc comment on the Flutter side). A
 *    template's `key`/`label` exist purely for the role-creation UI.
 *  - The three templates below are a deliberately generic STARTING POINT,
 *    not a fixed taxonomy every tenant must use — every code they
 *    reference is fully checked/uncheckable in the same picker before the
 *    role is even created, and the resulting role can be renamed, re-
 *    permissioned, or abandoned in favor of an entirely custom role at
 *    any time. Nothing in this file, or anywhere that reads it, ever
 *    hardcodes a business's own naming ("Cajero de Taquilla", "Cajero de
 *    Snacks", etc.) — those remain 100% operator-entered, same as
 *    `operational_areas.name` (TASK 16.15).
 */
export interface RoleTemplate {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly permissionCodes: readonly string[];
}

const administratorPermissionCodes: readonly string[] = technicalPermissionCodes;

/** Branch-level operational oversight: full day-to-day commerce (sales,
 * cash, inventory, catalog pricing, refunds/promotions, party/loyalty
 * programs, basic people-ops) plus TASK 16.15's own register/area
 * administration and branch consolidation — but never company settings,
 * user/role management, or device/sync administration. Can see (`user.
 * read`) but not create/edit user accounts or roles; `branch_access.
 * manage` is included so a Manager can grant/narrow their own team's
 * branch/register/area access day to day without needing an Owner for
 * every routine staffing change. */
const managerPermissionCodes: readonly string[] = [
  'branch.read',
  'branch_settings.read',
  'user.read',
  'branch_access.manage',
  'cash_register.read',
  'cash_register.manage',
  'cash_session.read',
  'cash_session.open',
  'cash_movement.create',
  'cash_session.close',
  'operational_area.read',
  'operational_area.manage',
  'branch_consolidation.read',
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
  'inventory.transfer',
  'inventory.receive',
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
  'promotion.read',
  'promotion.manage',
  'coupon.read',
  'coupon.manage',
  'discount.apply',
  'customer.read',
  'customer.create',
  'customer.update',
  'membership.read',
  'membership.manage',
  'membership.issue',
  'loyalty.read',
  'loyalty.manage',
  'loyalty.adjust',
  'reward.read',
  'reward.redeem',
  'reward.issue',
  'reward.revoke',
  'audit.read',
  'recovery.read',
  'party.read',
  'party.manage',
  'party.cancel',
  'party.payment.record',
  'held_sale.manage',
  'purchase.read',
  'purchase.create',
  'purchase.receive',
  'employee.read',
  'employee.manage',
  'schedule.read',
  'schedule.manage',
  'attendance.read',
  'attendance.manage',
  'payroll.read',
  'supplier.read',
  'supplier.manage',
  'report.read',
  'access.scan',
  'access.read',
  'access.manage',
  'staff_credential.manage',
];

/** Narrow, register-transactional only — exactly the surface a cashier
 * needs to open a session, ring up sales across every tender the backend
 * supports, look up/register a walk-up customer, redeem an already-issued
 * reward, hold/resume a cart, and close out at end of shift. Deliberately
 * excludes anything catalog/price/promotion/membership/inventory-admin,
 * any branch/area/register ADMINISTRATION (`cash_register.manage`), and
 * any user/role/company capability — an admin can always add more via the
 * same fully-editable permission picker this template only pre-fills.
 *
 * `cash_register.read` (list-only, TASK 16.16 live-certification finding)
 * IS included despite being a "register administration"-flavored code:
 * `GET /api/v1/cash-registers` requires it, and that endpoint is exactly
 * what TASK 16.15's own register-scope resolver (`_PosSaleState.
 * _loadRegisterScope`, `pos_register_scope.dart`'s `resolvePosRegisterScope`)
 * calls to learn which register(s) a narrowed cashier may auto-select or
 * choose from — without it, a register-scoped Cashier-template role could
 * open the POS screen but never have its sale correctly attributed to its
 * own register, silently degrading TASK 16.15's own multi-register
 * commercial guarantee for the exact narrow-scope-cashier case this
 * template exists for. This was caught live, not assumed. */
const cashierPermissionCodes: readonly string[] = [
  'cash_register.read',
  'cash_session.read',
  'cash_session.open',
  'cash_movement.create',
  'cash_session.close',
  'sale.read',
  'sale.create',
  'sale.complete',
  'payment.read',
  'payment.create',
  'refund.read',
  'refund.create',
  'customer.read',
  'customer.create',
  'catalog.read',
  'held_sale.manage',
  'reward.read',
  'reward.redeem',
  'discount.apply',
];

export const roleTemplates: readonly RoleTemplate[] = [
  {
    key: 'administrator',
    label: 'Administrador',
    description:
      'Acceso completo a todas las funciones del sistema — útil para un segundo administrador además del Owner. Sigue siendo un rol normal y editable, nunca el rol de sistema Owner.',
    permissionCodes: administratorPermissionCodes,
  },
  {
    key: 'manager',
    label: 'Gerente',
    description:
      'Operación diaria de una sucursal: ventas, caja, inventario, catálogo, promociones, clientes, personal y reportes. Sin acceso a configuración de la empresa ni administración de usuarios/roles.',
    permissionCodes: managerPermissionCodes,
  },
  {
    key: 'cashier',
    label: 'Cajero',
    description:
      'Solo lo necesario para operar una caja: abrir/cerrar turno, vender, cobrar, devolver, y atender clientes en el mostrador.',
    permissionCodes: cashierPermissionCodes,
  },
];
