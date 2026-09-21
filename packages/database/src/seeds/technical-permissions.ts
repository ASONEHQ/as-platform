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
  // TASK 14.0 (launch-blocker fix): `AdministrationService.
  // replaceRolePermissions` (`PUT /roles/{id}/permissions` — the ONLY way
  // to actually attach permissions to a role through the real product,
  // e.g. building a genuine minimal-permission Cashier role for launch)
  // has required this exact code since it was written, but it was never
  // added here — only to `admin.integration.test.ts`'s own hand-rolled,
  // already-drifted fixture permission list, which inserts permissions
  // directly and never goes through this seed. The result: in every real
  // environment that boots from this seed (dev, staging, production),
  // NO user — not even a company's own owner — could ever set a role's
  // permissions via the API; the permission row to grant simply never
  // existed. Added here, in its natural position beside its sibling
  // `role.*` codes, so `db:seed` (and `bootstrap-owner.service.ts`'s own
  // owner grant, updated alongside this) both cover it going forward.
  'role.permission.manage',
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
  // TASK 16.15 — "operational area" (`operational_areas` — a generic,
  // tenant-configured grouping of registers within a branch, e.g.
  // Taquilla/Cafetería/Eventos for one tenant, Admissions/Food/Events for
  // another; never a fixed set). Mirrors `cash_register.read`/
  // `cash_register.manage`'s own read-vs-manage split exactly — a genuinely
  // new record type, not an existing permission's semantics stretched to
  // fit.
  'operational_area.read',
  'operational_area.manage',
  // TASK 16.15 — "Consolidado de sucursal": a read-only, branch-wide
  // aggregation across every register/area a tenant authorizes the actor
  // to see (never a financial transaction of its own — see
  // `BranchConsolidationService`'s own doc comment). Deliberately separate
  // from `cash_session.read` (which already lets a cashier see their OWN
  // session) — a cashier restricted to one register must never
  // automatically gain visibility into the whole branch's cash position
  // just because they can read their own drawer.
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
  // TASK 15.0 RC certification: `inventory-transfers.routes.ts` has always
  // required these two codes (create/ship/cancel a transfer =
  // `inventory.transfer`, receive one = `inventory.receive`, deliberately
  // separate — see that file's own comment), but neither was ever added to
  // this seed. Since `role_permissions.permission_id` is FK-constrained to
  // `permissions.id` and this seed is the only source of `permissions`
  // rows, no role in any real environment could ever be granted either
  // code — every transfer create/ship/receive/cancel call 403'd for every
  // user, unconditionally. Real correctness fix, not a new capability: the
  // transfer backend/schema/atomicity were already fully real and correct
  // (TASK 15.0 Phase 1 inventory), only the permission catalog was
  // incomplete.
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
  // TASK 13.1 — Reward entitlements/redemption/VIP Pass engine. `reward.
  // read` is the cashier's own day-to-day lookup (Customer Detail/POS
  // reward status); `reward.redeem` is the checkout-time consuming
  // action; `reward.issue`/`reward.revoke` are admin-only (manual grant,
  // fraud/correction) — a cashier gets `read`+`redeem` only, mirroring
  // `discount.apply`/`membership.issue`'s own established "separate the
  // checkout action from the admin action" shape.
  'reward.read',
  'reward.redeem',
  'reward.issue',
  'reward.revoke',
  'sync.execute',
  'audit.read',
  'recovery.read',
  // TASK 14.3 (Wave 1, Part A.13) — the Fiestas/party-reservations
  // domain. `party.read` is the day-to-day view (list/calendar/detail);
  // `party.manage` covers create/edit of reservations, rooms, and
  // packages (kept as one code, mirroring `catalog.read`'s own
  // deliberately-coarse precedent, rather than splitting rooms/packages/
  // reservations into three separate manage codes with no evidence any
  // real park needs that granularity yet); `party.cancel` is separated
  // out because cancelling a reservation with existing payment history
  // is a materially higher-risk action than an ordinary edit — mirroring
  // `sale.cancel`'s own separation from `sale.create`; `party.payment.
  // record` gates recording a deposit/balance/additional payment against
  // a reservation, deliberately separate from `party.manage` the same
  // way `discount.apply`/`membership.issue`/`reward.redeem` are each
  // kept separate from their own domain's `*.manage` code (see this
  // seed file's own established precedent above). Legacy defined
  // `verFiestas`/`gestionarFiestas` but never actually enforced them
  // anywhere in code (see `docs/LEGACY_FIESTAS_RECOVERY.md` Capability
  // 13) — these four are real, server-enforced from day one.
  'party.read',
  'party.manage',
  'party.cancel',
  'party.payment.record',
  // TASK 14.3 (Wave 1, Part B.1) — suspended/held sales. Deliberately
  // its own code rather than reusing `sale.create`: holding/resuming a
  // cart is a distinct cashier action a business may want to permit or
  // withhold independently of who can ring up a sale at all.
  'held_sale.manage',
  // TASK 14.3 (Wave 1, Part C) — "Compra Directa" quick restock,
  // recovered from `docs/LEGACY_FUNCTIONAL_PARITY.md`'s Compras section.
  // Deliberately separate from `inventory.adjust`: receiving newly
  // arrived, paid-for stock is a different real-world authorization than
  // an arbitrary stock-count correction, mirroring this file's own
  // established `cash_movement.create` vs. `cash_register.manage`
  // separation (TASK 12.7).
  'purchase.read',
  'purchase.create',
  // TASK 12.2 — the formal Purchase Order workflow. `purchase.receive`
  // gates `POST /api/v1/purchase-orders/:id/receive` — the one action
  // that actually posts real stock (a receipt inventory movement),
  // deliberately separate from `purchase.create` (which gates
  // create/submit/cancel — paperwork actions with no inventory effect)
  // the same way this file's own established `cash_movement.create` vs.
  // `cash_register.manage` and `inventory.transfer` vs. `inventory.
  // receive` separations already keep "receiving real stock" as its own,
  // more sensitive permission from the surrounding create/manage action.
  'purchase.receive',
  // TASK 14.4 (Wave 2, Part B) — the People domain (Planilla/Horarios/
  // Checador/Nómina). `payroll.close` is deliberately separate from
  // `payroll.manage` — closing a period is a materially higher-risk,
  // harder-to-undo action than an ordinary edit, mirroring this file's
  // own established `refund.approve`/`role.permission.manage`-style
  // separation of a sensitive terminal action from routine management.
  'employee.read',
  'employee.manage',
  'schedule.read',
  'schedule.manage',
  'attendance.read',
  'attendance.manage',
  'payroll.read',
  'payroll.manage',
  'payroll.close',
  // TASK 14.4 (Wave 2, Part C) — suppliers.
  'supplier.read',
  'supplier.manage',
  // TASK 14.4 (Wave 2, Part D) — reports/BI. Deliberately one coarse
  // `report.read` code covering every report tab (sales/financial/
  // inventory/customers/employees/parties/access) — mirrors
  // `catalog.read`'s own precedent for a broad, low-risk read surface;
  // each underlying report still only returns what the actor's other
  // real permissions/branch access already allow it to see.
  'report.read',
  // TASK 14.4 (Wave 2, Part E) — access/occupancy. `access.scan` is the
  // day-to-day gate-staff action (issuing/scanning); `access.manage` is
  // reserved for administrative actions (voiding a credential).
  // TASK 14.5 (Wave 3, Phase 3) reuses these same three codes for the NFC
  // wristband lifecycle (a wristband is just another `credential_kind`)
  // rather than introducing new ones: `access.scan` also gates wristband
  // "activate" (mirrors ticket issuance), `access.manage` also gates
  // "block"/"unblock" (mirrors void/its new reverse), `access.read` also
  // gates wristband lookup-by-code/history. No genuine gap was found.
  'access.scan',
  'access.read',
  'access.manage',
  // TASK 14.5 (Wave 3, Phase 4b/7 Item 8) — real quick-switch PIN/QR staff
  // login, recovered from `docs/LEGACY_FUNCTIONAL_PARITY.md` §20's plaintext,
  // hardcoded-master-bypass PIN/QR mechanisms (deliberately NOT recreated
  // as-is). One coarse code covers assigning/rotating/revoking a staff
  // member's own PIN and QR credential — a genuinely new, security-relevant
  // surface, so it is deliberately its own code rather than folded into
  // `employee.manage` (which governs payroll/schedule data, not login
  // credentials) or `user.update` (which governs the global user profile,
  // not this company-scoped quick-switch mechanism).
  'staff_credential.manage',
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
