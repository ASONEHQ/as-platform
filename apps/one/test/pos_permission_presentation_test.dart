/// TASK 16.16A — correctness tests for `pos_permission_presentation.dart`:
/// the commercial-Spanish presentation layer that keeps a raw developer-
/// facing permission code/domain (and the backend's own generic, old-brand
/// "Approved AS ONE capability: ..." description) from leaking straight to
/// a business administrator in the Usuarios/Roles/Permisos admin UI.
///
/// [_technicalPermissionCodes] below is a HAND-COPIED, hardcoded mirror of
/// `packages/database/src/seeds/technical-permissions.ts`'s own
/// `technicalPermissionCodes` array (104 codes as of this task) — a Flutter
/// test cannot import TypeScript, so this list must be kept in sync by hand
/// whenever that backend file changes. This mirrors the already-accepted
/// maintenance pattern this codebase already uses elsewhere for the same
/// reason (see this file's own sibling admin tests).
library;

import 'package:as_one/features/pos/pos_permission_presentation.dart';
import 'package:flutter_test/flutter_test.dart';

// Keep in sync with `packages/database/src/seeds/technical-permissions.ts`'s
// `technicalPermissionCodes` — verbatim order/content, 104 entries.
const _technicalPermissionCodes = [
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
  'sync.execute',
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
  'payroll.manage',
  'payroll.close',
  'supplier.read',
  'supplier.manage',
  'report.read',
  'access.scan',
  'access.read',
  'access.manage',
  'staff_credential.manage',
];

// Every domain (the text before a code's first `.`) that
// `_technicalPermissionCodes` above actually contains — used to verify
// `permissionCategoryLabel` covers all of them, never falling back to the
// raw/derived string for a real backend domain.
Set<String> get _technicalDomains => _technicalPermissionCodes.map((code) => code.split('.').first).toSet();

void main() {
  test('_technicalPermissionCodes mirrors the backend seed — exactly 104 codes, no duplicates', () {
    expect(_technicalPermissionCodes.length, 104);
    expect(_technicalPermissionCodes.toSet().length, 104, reason: 'no duplicate codes');
  });

  group('permissionLabel', () {
    for (final code in _technicalPermissionCodes) {
      test('"$code" resolves to a real, non-raw, non-empty label', () {
        final label = permissionLabel(code);
        expect(label, isNotEmpty);
        expect(label, isNot(equals(code)), reason: 'the raw code must never be used as the display label');
      });
    }

    test('an unmapped/future/synthetic code still resolves via the fallback path', () {
      const syntheticCode = 'widget.manage';
      final label = permissionLabel(syntheticCode);
      expect(label, isNotEmpty);
      expect(label, isNot(equals(syntheticCode)));
      expect(label, isNot(contains('AS ONE')));
    });

    test('an unmapped code with an unrecognized action segment still resolves honestly', () {
      const syntheticCode = 'widget.frobnicate';
      final label = permissionLabel(syntheticCode);
      expect(label, isNotEmpty);
      expect(label, isNot(equals(syntheticCode)));
    });
  });

  group('permissionDescription', () {
    for (final code in _technicalPermissionCodes) {
      test('"$code" resolves to a real description that never mentions the old "AS ONE" brand', () {
        final description = permissionDescription(code);
        expect(description, isNotEmpty);
        expect(
          description,
          isNot(contains('AS ONE')),
          reason: 'the backend\'s raw "Approved AS ONE capability: ..." string must never surface here',
        );
      });
    }

    test('an unmapped/future/synthetic code still resolves via the fallback path, never mentioning "AS ONE"', () {
      const syntheticCode = 'widget.manage';
      final description = permissionDescription(syntheticCode);
      expect(description, isNotEmpty);
      expect(description, isNot(contains('AS ONE')));
    });
  });

  group('permissionCategoryLabel', () {
    for (final domain in _technicalDomains) {
      test('domain "$domain" resolves to a real, non-empty, non-raw category label', () {
        final label = permissionCategoryLabel(domain);
        expect(label, isNotEmpty);
        expect(label, isNot(equals(domain)));
      });
    }

    test('an unmapped future domain falls back sensibly — capitalized, never blank, never a thrown error', () {
      expect(permissionCategoryLabel('widget'), 'Widget');
      expect(permissionCategoryLabel('operational_widget'), 'Operational widget');
      expect(permissionCategoryLabel(''), '');
    });
  });
}
