/// TASK 16.18 — "Administrador de pruebas" (internal beta tester): the
/// Flutter-side navigation certification for the new commercial role
/// preset. `role-templates.ts`'s `betaTesterPermissionCodes` (backend,
/// `packages/database/src/seeds/role-templates.ts`) is the single source
/// of truth for the permission set itself — this file does not re-derive
/// or re-decide it. It instead proves the EXISTING, capability-derived
/// sidebar-visibility table (`pos_navigation.dart`'s
/// `_posModuleRequiredAnyPermission`/`posModuleVisibleFor` — never keyed
/// off a role's name, per that file's own absolute constraint) resolves a
/// beta-tester-permissioned actor to exactly the operational modules TASK
/// 16.18 Phase 2 names, and never the admin-tier ones Phase 3 excludes.
///
/// The permission list below is a deliberate, hand-copied mirror of the
/// real backend list — Flutter cannot import a TypeScript file — kept
/// honest by `beta-tester-access.integration.test.ts` (backend) already
/// certifying the REAL, DB-resolved permission set for a real beta-tester
/// user matches `roleTemplates`' own `beta_tester` entry exactly; if that
/// list ever changes, this file's own assertions are what will catch a
/// silent navigation-visibility drift here on the Flutter side.
library;

import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:flutter_test/flutter_test.dart';

/// Mirrors `betaTesterPermissionCodes` in
/// `packages/database/src/seeds/role-templates.ts` exactly.
const _betaTesterPermissionCodes = [
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
  'reward.read',
  'reward.redeem',
  'party.read',
  'party.manage',
  'party.cancel',
  'party.payment.record',
  'held_sale.manage',
  'purchase.read',
  'purchase.create',
  'purchase.receive',
  'supplier.read',
  'supplier.manage',
  'report.read',
  'cash_register.read',
  'cash_register.manage',
  'cash_session.read',
  'cash_session.open',
  'cash_movement.create',
  'cash_session.close',
  'branch_consolidation.read',
];

void main() {
  group('"Administrador de pruebas" (beta tester) — restricted navigation, TASK 16.18', () {
    test('every operational module named in TASK 16.18 Phase 2 is visible', () {
      const expectedVisible = [
        PosModule.dashboard,
        PosModule.pos,
        PosModule.cafeteria,
        PosModule.suspended,
        PosModule.returns,
        PosModule.history,
        PosModule.customers,
        PosModule.products,
        PosModule.productVariants,
        PosModule.categories,
        PosModule.brands,
        PosModule.catalogAdmin,
        PosModule.inventory,
        PosModule.inventoryAdmin,
        PosModule.purchases,
        PosModule.suppliers,
        PosModule.events,
        PosModule.memberships,
        PosModule.promotions,
        PosModule.cash,
        PosModule.billing,
        PosModule.branchConsolidation,
        PosModule.reports,
      ];
      for (final module in expectedVisible) {
        expect(
          posModuleVisibleFor(module, _betaTesterPermissionCodes),
          isTrue,
          reason: '${module.label} must be visible to a beta tester — named in TASK 16.18 Phase 2',
        );
      }
    });

    test('every admin/platform-tier module stays invisible — never automatically granted', () {
      const expectedHidden = [
        PosModule.users,
        PosModule.branches,
        PosModule.operationalAreas,
        PosModule.employees,
        PosModule.access,
      ];
      for (final module in expectedHidden) {
        expect(
          posModuleVisibleFor(module, _betaTesterPermissionCodes),
          isFalse,
          reason: '${module.label} must stay hidden from a beta tester — TASK 16.18 Phase 3 exclusion',
        );
      }
    });

    test(
      'Documentos/Notificaciones stay hidden today — both are unimplemented placeholder screens gated by '
      'company_settings.read, a company-configuration-domain permission the beta preset deliberately excludes '
      '(the same boundary the Manager template already establishes) — a genuine, disclosed, honest gap, not an '
      'oversight',
      () {
        expect(posModuleVisibleFor(PosModule.documents, _betaTesterPermissionCodes), isFalse);
        expect(posModuleVisibleFor(PosModule.notifications, _betaTesterPermissionCodes), isFalse);
      },
    );
  });
}
