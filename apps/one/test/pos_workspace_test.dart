// TASK 16.16 — pure unit tests for `resolvePosStartRoute`/
// `isStaleSelectedRegister`, `pos_workspace.dart`'s own resolution logic.
// Extracted into its own file specifically so this behavior is testable
// without driving the entire `pos_shell.dart` POS shell — mirrors
// `pos_register_scope_test.dart`'s own precedent exactly (see that file's
// header comment).
import 'package:as_one/features/pos/pos_navigation.dart';
import 'package:as_one/features/pos/pos_workspace.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolvePosStartRoute', () {
    test('company-wide access always lands on Dashboard, regardless of permissions', () {
      expect(
        resolvePosStartRoute(companyWideAccess: true, permissions: const []),
        PosModule.dashboard,
      );
      expect(
        resolvePosStartRoute(
          companyWideAccess: true,
          permissions: const ['sale.create', 'cash_session.open'],
        ),
        PosModule.dashboard,
      );
    });

    test(
      'a purely operational actor (sale.create, no management-signal permission) '
      'lands directly on the POS workspace',
      () {
        expect(
          resolvePosStartRoute(
            companyWideAccess: false,
            permissions: const ['sale.create', 'catalog.read'],
          ),
          PosModule.pos,
        );
      },
    );

    test(
      'cash_session.open alone (no sale.create) also counts as the operational signal',
      () {
        expect(
          resolvePosStartRoute(
            companyWideAccess: false,
            permissions: const ['cash_session.open'],
          ),
          PosModule.pos,
        );
      },
    );

    test(
      'holding ANY management-signal permission alongside sale.create keeps '
      'the actor on Dashboard — never routes a manager straight to the till',
      () {
        for (final managementPermission in posManagementSignalPermissions) {
          expect(
            resolvePosStartRoute(
              companyWideAccess: false,
              permissions: ['sale.create', managementPermission],
            ),
            PosModule.dashboard,
            reason: 'management-signal permission: $managementPermission',
          );
        }
      },
    );

    test(
      'a purely management-tier actor (no sale.create/cash_session.open at all) lands on Dashboard',
      () {
        expect(
          resolvePosStartRoute(
            companyWideAccess: false,
            permissions: const ['report.read', 'user.read'],
          ),
          PosModule.dashboard,
        );
      },
    );

    test(
      'zero permissions at all (freshly created actor) safely defaults to Dashboard, never a dead end',
      () {
        expect(
          resolvePosStartRoute(companyWideAccess: false, permissions: const []),
          PosModule.dashboard,
        );
      },
    );

    // This task's own core constraint: never derive behavior from a role's
    // NAME or CODE — only from real permission codes. A synthetic actor
    // carrying a made-up role name attached to an operational permission
    // set must route identically to the same permission set attached to a
    // totally different (or absent) role name, because this resolver's
    // signature never even accepts a role name/code as an input in the
    // first place.
    test('routing is fully role-NAME-independent — only permissions/companyWideAccess matter', () {
      const operationalPermissions = ['sale.create'];
      const managerPermissions = ['sale.create', 'employee.read'];

      // Two "actors" with wildly different (fictitious) role names/codes
      // but the identical permission set must resolve identically —
      // proven here by the fact this function has no role-name parameter
      // to even diverge on, and by explicitly re-deriving the route twice
      // from equivalent-but-distinct list literals (never the same List
      // instance) to rule out any accidental identity-based shortcut.
      final routeForCashier = resolvePosStartRoute(
        companyWideAccess: false,
        permissions: List.of(operationalPermissions),
      );
      final routeForTaquillero = resolvePosStartRoute(
        companyWideAccess: false,
        permissions: List.of(operationalPermissions),
      );
      expect(routeForCashier, PosModule.pos);
      expect(routeForCashier, routeForTaquillero);

      final routeForGerente = resolvePosStartRoute(
        companyWideAccess: false,
        permissions: List.of(managerPermissions),
      );
      final routeForSupervisorDeSucursal = resolvePosStartRoute(
        companyWideAccess: false,
        permissions: List.of(managerPermissions),
      );
      expect(routeForGerente, PosModule.dashboard);
      expect(routeForGerente, routeForSupervisorDeSucursal);
    });
  });

  group('isStaleSelectedRegister', () {
    test('nothing selected is never stale', () {
      expect(
        isStaleSelectedRegister(
          selectedRegisterId: null,
          permittedRegisterIds: const ['reg-a'],
        ),
        isFalse,
      );
    });

    test('unrestricted scope (null permittedRegisterIds) never makes a selection stale', () {
      expect(
        isStaleSelectedRegister(
          selectedRegisterId: 'reg-a',
          permittedRegisterIds: null,
        ),
        isFalse,
      );
    });

    test('a selected register still present in the current permitted set is not stale', () {
      expect(
        isStaleSelectedRegister(
          selectedRegisterId: 'reg-a',
          permittedRegisterIds: const ['reg-a', 'reg-b'],
        ),
        isFalse,
      );
    });

    test('a selected register no longer present in a narrowed permitted set is stale', () {
      expect(
        isStaleSelectedRegister(
          selectedRegisterId: 'reg-a',
          permittedRegisterIds: const ['reg-b'],
        ),
        isTrue,
      );
    });

    test('a selected register dropped entirely (now zero permitted registers) is stale', () {
      expect(
        isStaleSelectedRegister(
          selectedRegisterId: 'reg-a',
          permittedRegisterIds: const [],
        ),
        isTrue,
      );
    });
  });
}
