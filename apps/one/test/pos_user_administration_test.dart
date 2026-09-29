/// TASK 15.1 (Phase 2) — widget tests for `PosUserAdministrationScreen`
/// ("Usuarios y permisos"): real-shaped user list rendering, creating a
/// user, activating/deactivating a membership (including the first-
/// activation password requirement), creating a role, assigning
/// permissions to a role (including the self-escalation-guard UI
/// behavior — a checkbox for a permission the acting session itself does
/// not hold stays disabled), and honest permission-denied read-only
/// rendering for an actor lacking `user.read`/`role.read`. Uses a real,
/// in-memory recording fake gateway — never a mock framework — mirroring
/// `pos_receipt_branding_test.dart`/`pos_people_test.dart`'s own
/// `_Recording*Gateway` fixture convention.
library;

import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_cash_gateway.dart';
import 'package:as_one/features/pos/pos_identity_admin_gateway.dart';
import 'package:as_one/features/pos/pos_operational_areas_gateway.dart';
import 'package:as_one/features/pos/pos_user_administration_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _ownerPermissions = [
  'user.read',
  'user.create',
  'user.update',
  'role.read',
  'role.create',
  'role.update',
  'role.permission.manage',
  'role.assign',
  'branch_access.manage',
  'permission.read',
  'sale.read',
];

void main() {
  group('Usuarios — list and create', () {
    testWidgets('renders the real fetched users list', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(
        users: [_user('u1', 'ana@inflapark.test', 'Ana Cajero'), _user('u2', 'bob@inflapark.test', 'Bob Gerente')],
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      expect(find.text('Ana Cajero'), findsOneWidget);
      expect(find.text('ana@inflapark.test'), findsOneWidget);
      expect(find.text('Bob Gerente'), findsOneWidget);
      expect(gateway.listUsersCalls, 1);
    });

    testWidgets('Nuevo usuario calls createUser with the entered email/name', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(users: const []);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(const Key('pos-users-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-user-form-email')), 'nuevo@inflapark.test');
      await tester.enterText(find.byKey(const Key('pos-user-form-name')), 'Nuevo Empleado');
      await tester.tap(find.byKey(const Key('pos-user-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createUserCalls, hasLength(1));
      expect(gateway.createUserCalls.single.email, 'nuevo@inflapark.test');
      expect(gateway.createUserCalls.single.displayName, 'Nuevo Empleado');
      expect(find.text('Nuevo Empleado'), findsOneWidget);
    });

    testWidgets('sin user.create deja "Nuevo usuario" deshabilitado, nunca oculto', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(users: const []);
      await _pump(tester, gateway: gateway, permissions: const ['user.read']);

      final button = tester.widget<FilledButton>(find.byKey(const Key('pos-users-new')));
      expect(button.onPressed, isNull);
    });

    // TASK 17.3 — "Nuevo usuario" now presents role + branches together
    // (the "Acceso" section) instead of forcing a create-then-open-detail-
    // then-assign-role-then-grant-each-branch sequence. These calls are
    // the exact same `assignRole`/`changeBranchAccess` endpoints the
    // detail dialog's own "Asignar rol"/"Otorgar acceso a sucursal"
    // dialogs already use — this only sequences them.
    testWidgets(
      'Nuevo usuario con rol y una sucursal específica asigna el rol para esa sucursal y le otorga acceso',
      (tester) async {
        final role = _role('r1', 'Cajero', 'cashier');
        final gateway = _RecordingIdentityAdminGateway(users: const [], roles: [role]);
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

        await tester.tap(find.byKey(const Key('pos-users-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-user-form-email')), 'nueva@inflapark.test');
        await tester.enterText(find.byKey(const Key('pos-user-form-name')), 'Nueva Cajera');
        await tester.tap(find.byKey(const Key('pos-user-form-role')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cajero').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-1')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-user-form-save')));
        await tester.pumpAndSettle();

        expect(gateway.createUserCalls, hasLength(1));
        expect(gateway.assignRoleCalls, hasLength(1));
        expect(gateway.assignRoleCalls.single.roleId, role.id);
        expect(gateway.assignRoleCalls.single.branchId, 'branch-1');
        expect(gateway.changeBranchAccessCalls, hasLength(1));
        expect(gateway.changeBranchAccessCalls.single.branchId, 'branch-1');
        expect(gateway.changeBranchAccessCalls.single.isDefault, isTrue);
      },
    );

    testWidgets(
      'Nuevo usuario con "Todas las sucursales" asigna el rol de alcance compañía (branchId nulo) sin otorgar accesos individuales',
      (tester) async {
        final role = _role('r1', 'Gerente Regional', 'regional-manager');
        final gateway = _RecordingIdentityAdminGateway(users: const [], roles: [role]);
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

        await tester.tap(find.byKey(const Key('pos-users-new')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('pos-user-form-email')), 'regional@inflapark.test');
        await tester.enterText(find.byKey(const Key('pos-user-form-name')), 'Regional');
        await tester.tap(find.byKey(const Key('pos-user-form-role')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Gerente Regional').last);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-user-form-all-branches')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-user-form-save')));
        await tester.pumpAndSettle();

        expect(gateway.assignRoleCalls, hasLength(1));
        expect(gateway.assignRoleCalls.single.roleId, role.id);
        expect(gateway.assignRoleCalls.single.branchId, isNull);
        expect(gateway.changeBranchAccessCalls, isEmpty);
      },
    );

    testWidgets('Nuevo usuario sin rol seleccionado no hace ninguna llamada de acceso — igual que antes', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(users: const [], roles: [role]);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(const Key('pos-users-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-user-form-email')), 'sinrol@inflapark.test');
      await tester.enterText(find.byKey(const Key('pos-user-form-name')), 'Sin Rol');
      await tester.tap(find.byKey(const Key('pos-user-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createUserCalls, hasLength(1));
      expect(gateway.assignRoleCalls, isEmpty);
      expect(gateway.changeBranchAccessCalls, isEmpty);
    });

    testWidgets('sin role.assign, "Nuevo usuario" nunca muestra el selector de Rol', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(users: const [], roles: [role]);
      await _pump(
        tester,
        gateway: gateway,
        permissions: const ['user.read', 'user.create', 'branch_access.manage'],
      );

      await tester.tap(find.byKey(const Key('pos-users-new')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-user-form-role')), findsNothing);
    });
  });

  group('Usuarios — creación multi-sucursal resiliente (TASK 17.3.2)', () {
    Future<void> openFormAndFillGeneral(WidgetTester tester, {required String email, required String name}) async {
      await tester.tap(find.byKey(const Key('pos-users-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-user-form-email')), email);
      await tester.enterText(find.byKey(const Key('pos-user-form-name')), name);
    }

    Future<void> selectRole(WidgetTester tester, String roleName) async {
      await tester.tap(find.byKey(const Key('pos-user-form-role')));
      await tester.pumpAndSettle();
      await tester.tap(find.text(roleName).last);
      await tester.pumpAndSettle();
    }

    Future<void> save(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('pos-user-form-save')));
      await tester.pumpAndSettle();
    }

    testWidgets('todas las sucursales seleccionadas tienen éxito — sin diálogo de resumen', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(users: const [], roles: [role]);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await openFormAndFillGeneral(tester, email: 'multi@inflapark.test', name: 'Multi Sucursal');
      await selectRole(tester, 'Cajero');
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-1')));
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-2')));
      await tester.pumpAndSettle();
      await save(tester);

      expect(gateway.createUserCalls, hasLength(1));
      expect(gateway.assignRoleCalls.map((c) => c.branchId).toSet(), {'branch-1', 'branch-2'});
      expect(gateway.changeBranchAccessCalls.map((c) => c.branchId).toSet(), {'branch-1', 'branch-2'});
      // Full success keeps the normal, silent flow — no summary dialog,
      // the new user simply appears in the refreshed list.
      expect(find.byKey(const Key('pos-user-form-summary-title')), findsNothing);
      expect(find.text('Multi Sucursal'), findsOneWidget);
    });

    testWidgets('una falla en la sucursal intermedia no detiene el procesamiento de la siguiente', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(
        users: const [],
        roles: [role],
        assignRoleFailuresByBranchId: {
          'branch-2': const ApiException(AppFailure(AppErrorKind.validation, 'Sucursal temporalmente no disponible.')),
        },
      );
      await _pump(
        tester,
        gateway: gateway,
        permissions: _ownerPermissions,
        context: _contextWithThreeBranches(_ownerPermissions),
      );

      await openFormAndFillGeneral(tester, email: 'tres@inflapark.test', name: 'Tres Sucursales');
      await selectRole(tester, 'Cajero');
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-1')));
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-2')));
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-3')));
      await tester.pumpAndSettle();
      await save(tester);

      // Every selected branch was attempted — branch-3 must not have been
      // skipped just because branch-2 failed.
      expect(gateway.assignRoleCalls.map((c) => c.branchId).toList(), ['branch-1', 'branch-2', 'branch-3']);
      // branch-2's own changeBranchAccess is never attempted since its
      // role assignment itself failed.
      expect(gateway.changeBranchAccessCalls.map((c) => c.branchId).toSet(), {'branch-1', 'branch-3'});

      expect(find.byKey(const Key('pos-user-form-summary-title')), findsOneWidget);
      expect(find.textContaining('Sucursal Centro — configurado'), findsOneWidget);
      expect(find.textContaining('Sucursal Norte — no se pudo configurar'), findsOneWidget);
      expect(find.textContaining('Sucursal Sur — configurado'), findsOneWidget);
      // The real backend message is shown, never a raw UUID as the label.
      expect(find.text('Sucursal temporalmente no disponible.'), findsOneWidget);
      expect(find.textContaining('branch-2'), findsNothing);
    });

    testWidgets('rol asignado pero acceso de sucursal fallido se reporta como parcial, nunca como éxito', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(
        users: const [],
        roles: [role],
        changeBranchAccessFailuresByBranchId: {
          'branch-1': const ApiException(AppFailure(AppErrorKind.validation, 'No fue posible otorgar el acceso.')),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await openFormAndFillGeneral(tester, email: 'parcial@inflapark.test', name: 'Parcial');
      await selectRole(tester, 'Cajero');
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-1')));
      await tester.pumpAndSettle();
      await save(tester);

      expect(gateway.assignRoleCalls, hasLength(1));
      expect(gateway.changeBranchAccessCalls, hasLength(1));
      expect(find.byKey(const Key('pos-user-form-summary-title')), findsOneWidget);
      expect(find.textContaining('Sucursal Centro — rol asignado; no se pudo completar el acceso'), findsOneWidget);
    });

    testWidgets('una falla en la primera sucursal no detiene el procesamiento de las siguientes', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(
        users: const [],
        roles: [role],
        assignRoleFailuresByBranchId: {
          'branch-1': const ApiException(AppFailure(AppErrorKind.validation, 'Rechazado.')),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await openFormAndFillGeneral(tester, email: 'primera@inflapark.test', name: 'Primera Falla');
      await selectRole(tester, 'Cajero');
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-1')));
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-2')));
      await tester.pumpAndSettle();
      await save(tester);

      expect(gateway.assignRoleCalls.map((c) => c.branchId).toList(), ['branch-1', 'branch-2']);
      expect(gateway.changeBranchAccessCalls.map((c) => c.branchId).toList(), ['branch-2']);
      expect(find.textContaining('Sucursal Centro — no se pudo configurar'), findsOneWidget);
      expect(find.textContaining('Sucursal Norte — configurado'), findsOneWidget);
    });

    testWidgets('si la creación base del usuario falla, no se intenta ninguna configuración de sucursal', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(
        users: const [],
        roles: [role],
        createUserFailure: const ApiException(AppFailure(AppErrorKind.validation, 'El correo ya está en uso.')),
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await openFormAndFillGeneral(tester, email: 'duplicado@inflapark.test', name: 'Duplicado');
      await selectRole(tester, 'Cajero');
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-1')));
      await tester.pumpAndSettle();
      await save(tester);

      expect(gateway.createUserCalls, hasLength(1));
      expect(gateway.assignRoleCalls, isEmpty);
      expect(gateway.changeBranchAccessCalls, isEmpty);
      expect(find.text('El correo ya está en uso.'), findsOneWidget);
      // The create dialog itself stays open — nothing was created, so
      // there is nothing to review.
      expect(find.byKey(const Key('pos-user-form-email')), findsOneWidget);
    });

    testWidgets('"Revisar usuario" desde el resumen abre la ficha del usuario recién creado', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(
        users: const [],
        roles: [role],
        changeBranchAccessFailuresByBranchId: {
          'branch-1': const ApiException(AppFailure(AppErrorKind.validation, 'No fue posible otorgar el acceso.')),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await openFormAndFillGeneral(tester, email: 'revisar@inflapark.test', name: 'Revisar');
      await selectRole(tester, 'Cajero');
      await tester.tap(find.byKey(const Key('pos-user-form-branch-branch-1')));
      await tester.pumpAndSettle();
      await save(tester);

      await tester.tap(find.byKey(const Key('pos-user-form-summary-review')));
      await tester.pumpAndSettle();

      // The existing user detail flow opened — reusing it, not a new
      // administration surface.
      expect(find.byKey(const Key('pos-user-detail-save-status')), findsOneWidget);
    });
  });

  group('Usuarios — activar/desactivar', () {
    testWidgets('activar un usuario pending por primera vez exige contraseña', (tester) async {
      final user = _user('u1', 'pendiente@inflapark.test', 'Pendiente', identityStatus: 'pending', membershipStatus: 'invited');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();

      // The dropdown already defaults to "active" for a pending/invited user
      // — saving without a password must fail honestly, never silently
      // activate without one (`AdministrationService.updateMembership`'s
      // own real first-activation rule).
      await tester.tap(find.byKey(const Key('pos-user-detail-save-status')));
      await tester.pumpAndSettle();
      expect(find.textContaining('contraseña'), findsOneWidget);
      expect(gateway.updateMembershipCalls, isEmpty);

      await tester.enterText(find.byKey(const Key('pos-user-detail-password-field')), 'Cor##recta1');
      await tester.tap(find.byKey(const Key('pos-user-detail-save-status')));
      await tester.pumpAndSettle();

      expect(gateway.updateMembershipCalls, hasLength(1));
      expect(gateway.updateMembershipCalls.single.userId, user.id);
      expect(gateway.updateMembershipCalls.single.status, 'active');
      expect(gateway.updateMembershipCalls.single.password, 'Cor##recta1');
    });

    testWidgets('desactivar (suspender) un usuario activo no envía contraseña', (tester) async {
      final user = _user('u2', 'activo@inflapark.test', 'Activo', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-user-detail-membership-status')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Suspendido').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-user-detail-save-status')));
      await tester.pumpAndSettle();

      expect(gateway.updateMembershipCalls, hasLength(1));
      expect(gateway.updateMembershipCalls.single.status, 'suspended');
      expect(gateway.updateMembershipCalls.single.password, isNull);
    });

    testWidgets('sin user.update, el estado de membresía queda deshabilitado', (tester) async {
      final user = _user('u3', 'activo2@inflapark.test', 'Activo Dos', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: const ['user.read']);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();

      final dropdown = tester.widget<DropdownButtonFormField<String>>(
        find.byKey(const Key('pos-user-detail-membership-status')),
      );
      expect(dropdown.onChanged, isNull);
      final saveButton = tester.widget<FilledButton>(find.byKey(const Key('pos-user-detail-save-status')));
      expect(saveButton.onPressed, isNull);
    });
  });

  group('Roles — creación', () {
    testWidgets('Nuevo rol calls createRole with the entered name/code/description', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(roles: const []);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      await tester.tap(find.byKey(const Key('pos-roles-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-role-form-name')), 'Supervisor de sucursal');
      await tester.enterText(find.byKey(const Key('pos-role-form-code')), 'branch_supervisor');
      await tester.tap(find.byKey(const Key('pos-role-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createRoleCalls, hasLength(1));
      expect(gateway.createRoleCalls.single.name, 'Supervisor de sucursal');
      expect(gateway.createRoleCalls.single.code, 'branch_supervisor');
      // TASK 16.31 — creating a role now selects it in the master/detail
      // view, so its name legitimately appears twice: the left-pane
      // card/right-pane header AND the now-editable "Nombre" field's own
      // pre-filled value.
      expect(find.text('Supervisor de sucursal'), findsAtLeastNWidgets(1));
      expect(find.byKey(const Key('pos-role-detail-name')), findsOneWidget);
    });

    testWidgets('sin role.create deja "Nuevo rol" deshabilitado', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(roles: const []);
      await _pump(tester, gateway: gateway, permissions: const ['role.read'], tab: 'Roles y permisos');

      final button = tester.widget<FilledButton>(find.byKey(const Key('pos-roles-new')));
      expect(button.onPressed, isNull);
    });
  });

  // TASK 16.16 — role templates: a static, non-persisted starter permission
  // bundle catalogue (`GET /api/v1/role-templates`) that only ever pre-fills
  // the "Nuevo rol" flow — never persisted, never branched on afterward.
  group('Roles — creación desde plantilla (TASK 16.16)', () {
    final roleReadPermission = _permission('p-role-read', 'role.read', 'role');
    final roleCreatePermission = _permission('p-role-create', 'role.create', 'role');
    final saleReadPermission = _permission('p-sale-read', 'sale.read', 'sale');
    // The acting owner fixture (`_ownerPermissions`) deliberately does NOT
    // hold this one — proves a template's pre-checked set is filtered to
    // what the actor actually holds, never silently submitted as a grant
    // that would 403.
    final cashSessionReadPermission = _permission('p-cash-read', 'cash_session.read', 'cash_session');

    List<PosRoleTemplate> templates() => const [
      PosRoleTemplate(
        key: 'administrator',
        label: 'Administrador',
        description: 'El catálogo completo de permisos.',
        permissionCodes: ['role.read', 'role.create'],
      ),
      PosRoleTemplate(
        key: 'manager',
        label: 'Gerente',
        description: 'Operación diaria de sucursal.',
        permissionCodes: ['sale.read', 'cash_session.read'],
      ),
      PosRoleTemplate(
        key: 'cashier',
        label: 'Cajero',
        description: 'Ventas de mostrador.',
        permissionCodes: ['sale.read'],
      ),
    ];

    testWidgets(
      'creando un rol desde la plantilla Gerente pre-marca exactamente sus permisos que el actor '
      'también posee — nunca uno que el actor no tiene',
      (tester) async {
        final gateway = _RecordingIdentityAdminGateway(
          roles: const [],
          permissions: [roleReadPermission, roleCreatePermission, saleReadPermission, cashSessionReadPermission],
          roleTemplates: templates(),
        );
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

        await tester.tap(find.byKey(const Key('pos-roles-new')));
        await tester.pumpAndSettle();

        expect(gateway.listRoleTemplatesCalls, 1);
        await tester.tap(find.byKey(const Key('pos-role-form-template')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Gerente').last);
        await tester.pumpAndSettle();

        // Pre-fills the name with the template's own label, but stays
        // fully editable — a business can rename it freely.
        expect(find.widgetWithText(TextField, 'Gerente'), findsOneWidget);
        await tester.enterText(find.byKey(const Key('pos-role-form-name')), 'Gerente de Taquilla');
        await tester.enterText(find.byKey(const Key('pos-role-form-code')), 'branch_manager');
        await tester.tap(find.byKey(const Key('pos-role-form-save')));
        await tester.pumpAndSettle();

        expect(gateway.createRoleCalls, hasLength(1));
        expect(gateway.createRoleCalls.single.name, 'Gerente de Taquilla');
        expect(gateway.createRoleCalls.single.code, 'branch_manager');

        // The SAME `_RoleDetailDialog`/`_PermissionPicker` flow a manual
        // edit uses opens immediately, pre-checked.
        expect(find.byKey(const Key('pos-role-detail-save-permissions')), findsOneWidget);

        await tester.tap(find.byKey(const Key('pos-permission-domain-sale')));
        await tester.pumpAndSettle();
        final saleReadCheckbox = tester.widget<Switch>(
          find.byKey(Key('pos-permission-checkbox-${saleReadPermission.id}')),
        );
        expect(saleReadCheckbox.value, isTrue, reason: 'sale.read is in the template AND the actor holds it');

        await tester.tap(find.byKey(const Key('pos-permission-domain-cash_session')));
        await tester.pumpAndSettle();
        final cashReadCheckbox = tester.widget<Switch>(
          find.byKey(Key('pos-permission-checkbox-${cashSessionReadPermission.id}')),
        );
        expect(
          cashReadCheckbox.value,
          isFalse,
          reason: 'cash_session.read is in the template but the actor does not hold it — never pre-checked',
        );
        expect(cashReadCheckbox.onChanged, isNull, reason: 'and never offered as a grantable choice either');

        // Fully editable from here — explicitly saving submits exactly the
        // pre-checked (actor-held) set, never a silent auto-save. Scrolled
        // into view first — the two expanded domain groups above push the
        // save button below the dialog's scrollable fold.
        await tester.ensureVisible(find.byKey(const Key('pos-role-detail-save-permissions')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-role-detail-save-permissions')));
        await tester.pumpAndSettle();
        expect(gateway.replaceRolePermissionsCalls, hasLength(1));
        expect(
          gateway.replaceRolePermissionsCalls.single.assignments.map((a) => a.permissionId),
          [saleReadPermission.id],
        );
      },
    );

    testWidgets(
      '"Personalizado / en blanco" (la opción por defecto) sigue creando un rol totalmente vacío, '
      'exactamente como antes de esta tarea',
      (tester) async {
        final gateway = _RecordingIdentityAdminGateway(
          roles: const [],
          permissions: [roleReadPermission, roleCreatePermission, saleReadPermission],
          roleTemplates: templates(),
        );
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

        await tester.tap(find.byKey(const Key('pos-roles-new')));
        await tester.pumpAndSettle();

        // The template dropdown is offered (templates loaded successfully)
        // but deliberately never touched — "Personalizado / en blanco" is
        // its own default value, not merely the absence of a picker.
        expect(find.byKey(const Key('pos-role-form-template')), findsOneWidget);
        expect(find.text('Personalizado / en blanco'), findsOneWidget);

        await tester.enterText(find.byKey(const Key('pos-role-form-name')), 'Rol a la medida');
        await tester.enterText(find.byKey(const Key('pos-role-form-code')), 'custom_role');
        await tester.tap(find.byKey(const Key('pos-role-form-save')));
        await tester.pumpAndSettle();

        expect(gateway.createRoleCalls, hasLength(1));
        expect(gateway.createRoleCalls.single.name, 'Rol a la medida');
        // TASK 16.31 — the new role now selects itself in the master/
        // detail view (so its own permission picker section IS visible —
        // that's the point of master/detail), but with NO template codes
        // this time, nothing was ever pre-checked or auto-submitted — a
        // truly empty role, exactly like the pre-TASK-16.16 flow's own
        // substantive guarantee.
        expect(gateway.replaceRolePermissionsCalls, isEmpty);
      },
    );

    // TASK 16.18 — "Administrador de pruebas" (internal beta tester): this
    // template is purely data-driven, exactly like Administrador/Gerente/
    // Cajero above — the real backend's `GET /api/v1/role-templates` now
    // additionally returns it (once the Owner's own backend/DB carries the
    // new `beta_tester` entry from `role-templates.ts`), and this SAME
    // picker widget renders it with zero Flutter code changes. This test
    // proves that data-driven behavior with a LOCAL fixture template,
    // mirroring the real one's label/description — it does not re-prove
    // the permission-filtering mechanics the "Gerente" test above already
    // covers generically for any template.
    testWidgets(
      '"Administrador de pruebas" appears as a normal, human-readable commercial role option — the Owner never '
      'hand-picks permission codes to use it',
      (tester) async {
        const betaLabel = 'Administrador de pruebas';
        const betaDescription =
            'Acceso operativo amplio para un probador interno de confianza: ventas, caja, inventario, catálogo, '
            'compras, proveedores, clientes, fiestas, membresías, cupones/promociones y reportes. Sin acceso a '
            'configuración de la empresa, administración de usuarios/roles, sucursales, dispositivos, personal/'
            'nómina ni auditoría. El Owner sigue decidiendo a qué sucursales y cajas tiene acceso.';
        final gateway = _RecordingIdentityAdminGateway(
          roles: const [],
          permissions: [roleReadPermission, roleCreatePermission, saleReadPermission],
          roleTemplates: [
            ...templates(),
            const PosRoleTemplate(
              key: 'beta_tester',
              label: betaLabel,
              description: betaDescription,
              permissionCodes: ['sale.read'],
            ),
          ],
        );
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

        await tester.tap(find.byKey(const Key('pos-roles-new')));
        await tester.pumpAndSettle();

        // Selectable from the SAME dropdown as every other template — no
        // separate "beta mode" UI, no raw permission-code checklist to
        // fill in before it can even be picked.
        await tester.tap(find.byKey(const Key('pos-role-form-template')));
        await tester.pumpAndSettle();
        expect(find.text(betaLabel), findsWidgets);
        await tester.tap(find.byKey(const Key('pos-role-form-template-beta_tester')));
        await tester.pumpAndSettle();

        // A real, human-readable Spanish description is shown — never a
        // bare list of permission codes, WITHIN THE CREATE-ROLE DIALOG
        // itself. (TASK 16.31.3 made the background master/detail's own
        // default catalog-browse pane show every real code's "Código
        // técnico" caption unconditionally now — a real, intentional
        // density change, not a leak from this dialog — so the search is
        // scoped to the open `Dialog` to keep proving what this test
        // actually asserts.)
        expect(find.text(betaDescription), findsOneWidget);
        expect(
          find.descendant(of: find.byType(Dialog), matching: find.textContaining('sale.read')),
          findsNothing,
        );

        // The name field is pre-filled with the template's own label,
        // exactly like every other template — still fully editable.
        expect(find.widgetWithText(TextField, betaLabel), findsOneWidget);
      },
    );
  });

  group('Roles — asignación de permisos y el guardia contra auto-escalación', () {
    testWidgets('un permiso que el propio actor no tiene queda deshabilitado, con tooltip', (tester) async {
      final role = _role('r1', 'Cajero', 'cashier');
      final saleRead = _permission('p-sale-read', 'sale.read', 'sale');
      final saleCreate = _permission('p-sale-create', 'sale.create', 'sale');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [role],
        permissions: [saleRead, saleCreate],
        rolePermissionsByRole: {
          role.id: [_assignment(saleRead)],
        },
      );
      // The acting session holds sale.read but NOT sale.create.
      await _pump(tester, gateway: gateway, permissions: [...(_ownerPermissions), 'sale.read'], tab: 'Roles y permisos');

      await tester.tap(find.byKey(Key('pos-role-row-${role.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-permission-domain-sale')));
      await tester.pumpAndSettle();

      final grantable = tester.widget<Switch>(find.byKey(Key('pos-permission-checkbox-${saleRead.id}')));
      expect(grantable.value, isTrue);
      expect(grantable.onChanged, isNotNull, reason: 'the actor holds sale.read, so it stays interactive');

      final ungrantable = tester.widget<Switch>(find.byKey(Key('pos-permission-checkbox-${saleCreate.id}')));
      expect(ungrantable.value, isFalse);
      expect(
        ungrantable.onChanged,
        isNull,
        reason: 'the actor does not hold sale.create — the UI must not offer to silently grant it',
      );
      final tooltip = tester.widget<Tooltip>(
        find.ancestor(of: find.byKey(Key('pos-permission-checkbox-${saleCreate.id}')), matching: find.byType(Tooltip)),
      );
      expect(tooltip.message, contains('sale.create'));
    });

    testWidgets('guardar permisos envía el conjunto completo — replace semantics', (tester) async {
      final role = _role('r2', 'Cajero', 'cashier');
      final saleRead = _permission('p-sale-read', 'sale.read', 'sale');
      final saleCreate = _permission('p-sale-create', 'sale.create', 'sale');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [role],
        permissions: [saleRead, saleCreate],
        rolePermissionsByRole: {
          role.id: [_assignment(saleRead)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: [...(_ownerPermissions), 'sale.read'], tab: 'Roles y permisos');

      await tester.tap(find.byKey(Key('pos-role-row-${role.id}')));
      await tester.pumpAndSettle();

      // Save stays disabled until the (already-loaded) set actually changes.
      final beforeToggle = tester.widget<FilledButton>(find.byKey(const Key('pos-role-detail-save-permissions')));
      expect(beforeToggle.onPressed, isNull);

      await tester.tap(find.byKey(const Key('pos-permission-domain-sale')));
      await tester.pumpAndSettle();
      // Uncheck the one permission the actor legitimately holds and the
      // role already had — a real, honest restriction, allowed even though
      // it goes through the same guard (unchecking is always permitted).
      await tester.tap(find.byKey(Key('pos-permission-checkbox-${saleRead.id}')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-role-detail-save-permissions')));
      await tester.pumpAndSettle();

      expect(gateway.replaceRolePermissionsCalls, hasLength(1));
      final sentIds = gateway.replaceRolePermissionsCalls.single.assignments.map((a) => a.permissionId).toSet();
      expect(sentIds, isEmpty, reason: 'sale.read was unchecked and sale.create was never grantable');
    });

    // TASK 16.16A Phase 7 — "Cajero / 12 permisos" style summary, computed
    // from the same `rolePermissions()` call the picker below already
    // makes (never a new/extra network call).
    testWidgets('el encabezado del detalle de rol muestra un resumen "código · N permisos"', (tester) async {
      final role = _role('r3', 'Cajero', 'cashier');
      final saleRead = _permission('p-sale-read', 'sale.read', 'sale');
      final saleCreate = _permission('p-sale-create', 'sale.create', 'sale');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [role],
        permissions: [saleRead, saleCreate],
        rolePermissionsByRole: {
          role.id: [_assignment(saleRead), _assignment(saleCreate)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      await tester.tap(find.byKey(Key('pos-role-row-${role.id}')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-role-detail-summary')), findsOneWidget);
      expect(find.text('cashier · 2 permisos'), findsOneWidget);
    });

    testWidgets('el resumen usa singular "permiso" cuando el rol tiene exactamente uno', (tester) async {
      final role = _role('r4', 'Auditor', 'auditor');
      final auditRead = _permission('p-audit-read', 'audit.read', 'audit');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [role],
        permissions: [auditRead],
        rolePermissionsByRole: {
          role.id: [_assignment(auditRead)],
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      await tester.tap(find.byKey(Key('pos-role-row-${role.id}')));
      await tester.pumpAndSettle();

      expect(find.text('auditor · 1 permiso'), findsOneWidget);
    });
  });

  group('Usuarios — acceso a sucursales (TASK 16.5: corrección del bootstrap circular)', () {
    testWidgets('"Otorgar acceso" muestra sucursales frescas del gateway, incluso una que no está en la sesión cacheada', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      // `_context` (below) only knows about branch-1/branch-2 — `plv` is a
      // branch created AFTER that cached session snapshot, exactly
      // mirroring the real reported bug (first Owner creates PLV, then
      // "Otorgar acceso" showed nothing because the dialog used to read
      // `AuthenticatedContext.branches` instead of fetching fresh).
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
        grantableBranches: const [
          BranchSummary(id: 'plv', code: 'PLV', name: 'Puerta La Victoria', timezone: 'America/Mexico_City'),
        ],
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);
      await tester.tap(find.byKey(const Key('pos-user-detail-grant-branch-access')));
      await tester.pumpAndSettle();

      expect(gateway.listGrantableBranchesCalls, 1);
      expect(gateway.listGrantableBranchesLastCompanyId, 'company-id');
      expect(find.text('Puerta La Victoria'), findsOneWidget);
      expect(find.text('No hay sucursales disponibles en tu sesión.'), findsNothing);
    });

    testWidgets('otorgar acceso a la sucursal recién descubierta llama a changeBranchAccess y refresca el detalle', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
        grantableBranches: const [
          BranchSummary(id: 'plv', code: 'PLV', name: 'Puerta La Victoria', timezone: 'America/Mexico_City'),
        ],
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);
      await tester.tap(find.byKey(const Key('pos-user-detail-grant-branch-access')));
      await tester.pumpAndSettle();
      // A single grantable branch is already pre-selected by the dialog's
      // own `initState` — no dropdown interaction needed to submit it.
      await tester.tap(find.byKey(const Key('pos-grant-branch-access-save')));
      await tester.pumpAndSettle();

      expect(gateway.changeBranchAccessCalls, hasLength(1));
      expect(gateway.changeBranchAccessCalls.single.userId, user.id);
      expect(gateway.changeBranchAccessCalls.single.branchId, 'plv');
      expect(gateway.changeBranchAccessCalls.single.status, 'active');
      expect(find.text('Puerta La Victoria (PLV)'), findsOneWidget);
    });

    testWidgets('sin sucursales otorgables reales, el diálogo sigue mostrando el mensaje honesto de vacío', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);
      await tester.tap(find.byKey(const Key('pos-user-detail-grant-branch-access')));
      await tester.pumpAndSettle();

      expect(find.text('No hay sucursales disponibles en tu sesión.'), findsOneWidget);
    });

    testWidgets('un actor con rol activo de alcance completo y sin accesos explícitos ve "Todas las sucursales", no "Sin acceso"', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final ownerRole = _role('r-owner', 'Owner', 'owner');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {
          user.id: PosUserDetail(
            user: user,
            roles: [
              PosUserRoleAssignment(
                id: 'assignment-1',
                roleId: ownerRole.id,
                roleCode: ownerRole.code,
                roleName: ownerRole.name,
                branchId: null,
                status: 'active',
              ),
            ],
            branchAccess: const [],
          ),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);

      expect(find.text('Todas las sucursales (por rol de alcance completo).'), findsOneWidget);
      expect(find.text('Sin acceso a sucursales.'), findsNothing);
    });

    // TASK 16.16A Phase 7 — "Roles asignados"/"Acceso a sucursales" now
    // carry a short explanatory subtitle, matching "Acceso a caja/área"'s
    // own established tone/length.
    testWidgets('"Roles asignados" y "Acceso a sucursales" muestran un subtítulo explicativo', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);

      expect(
        find.text('Un rol define qué puede hacer este usuario: el conjunto de permisos activados para él.'),
        findsOneWidget,
      );
      expect(
        find.text('Controla en qué sucursales puede trabajar este usuario, además del alcance que ya le da su rol.'),
        findsOneWidget,
      );
    });
  });

  // TASK 16.16A Phase 7 — a register/area access grant row used to print
  // the raw `operationalAreaId`/`cashRegisterId` UUID unconditionally. It
  // now resolves to a real name using the same `areasGateway`/`cashGateway`
  // `_GrantRegisterAccessDialog` already uses for its own pickers, falling
  // back to the raw id only when that resolution genuinely fails.
  group('Usuarios — acceso a caja/área muestra nombres resueltos, no UUIDs crudos (TASK 16.16A)', () {
    testWidgets('una fila resuelve un área a "área Nombre (CÓDIGO)" cuando el gateway tiene el dato', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final grant = PosRegisterAccessGrant(
        id: 'grant-1',
        branchId: 'branch-1',
        operationalAreaId: 'area-1',
        cashRegisterId: null,
        status: 'active',
        userId: user.id,
      );
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
        registerAccessByUser: {user.id: [grant]},
      );
      final areasGateway = _StubAreasGateway([
        PosOperationalArea(
          id: 'area-1',
          branchId: 'branch-1',
          code: 'ZONA-A',
          name: 'Zona A',
          status: 'active',
          version: 1,
          createdAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        ),
      ]);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, areasGateway: areasGateway);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);

      expect(find.textContaining('área Zona A (ZONA-A)'), findsOneWidget);
      expect(find.textContaining('área area-1'), findsNothing);
    });

    testWidgets('una fila resuelve una caja a "caja Nombre (CÓDIGO)" cuando el gateway tiene el dato', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final grant = PosRegisterAccessGrant(
        id: 'grant-1',
        branchId: 'branch-1',
        operationalAreaId: null,
        cashRegisterId: 'register-1',
        status: 'active',
        userId: user.id,
      );
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
        registerAccessByUser: {user.id: [grant]},
      );
      final cashGateway = _StubCashGateway([
        const PosCashRegister(
          id: 'register-1',
          branchId: 'branch-1',
          code: 'CAJA-1',
          name: 'Caja 1',
          status: 'active',
        ),
      ]);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, cashGateway: cashGateway);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);

      expect(find.textContaining('caja Caja 1 (CAJA-1)'), findsOneWidget);
      expect(find.textContaining('caja register-1'), findsNothing);
    });

    testWidgets('sin datos del gateway de áreas/cajas (los defaults Empty...), la fila cae honestamente al id crudo, sin romperse', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final grant = PosRegisterAccessGrant(
        id: 'grant-1',
        branchId: 'branch-1',
        operationalAreaId: 'area-missing',
        cashRegisterId: null,
        status: 'active',
        userId: user.id,
      );
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
        registerAccessByUser: {user.id: [grant]},
      );
      // Deliberately no `areasGateway`/`cashGateway` passed — the screen's
      // own default `Empty...` gateways.
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);

      expect(tester.takeException(), isNull);
      expect(find.textContaining('área area-missing'), findsOneWidget);
    });
  });

  group('Usuarios — Datos/Acceso/Permisos (TASK 17.4.1)', () {
    testWidgets('la ficha abre en Datos por defecto, mostrando estado de la cuenta', (tester) async {
      final user = _user('u1', 'owner@inflapark.test', 'Owner', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();

      expect(find.text('Estado de la cuenta'), findsOneWidget);
      // Acceso/Permisos content is not yet on screen until selected.
      expect(find.text('Roles asignados'), findsNothing);
      expect(find.text('Permisos efectivos'), findsNothing);
    });

    testWidgets('Permisos muestra los permisos efectivos reales del rol activo, con etiqueta comercial — nunca el código crudo', (
      tester,
    ) async {
      final role = _role('r-cashier', 'Cajero', 'cashier');
      final saleRead = _permission('p-sale-read', 'sale.read', 'sale');
      final user = _user('u1', 'cajero@inflapark.test', 'Cajero', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        roles: [role],
        permissions: [saleRead],
        rolePermissionsByRole: {
          role.id: [_assignment(saleRead)],
        },
        userDetails: {
          user.id: PosUserDetail(
            user: user,
            roles: [
              PosUserRoleAssignment(
                id: 'assignment-1',
                roleId: role.id,
                roleCode: role.code,
                roleName: role.name,
                branchId: null,
                status: 'active',
              ),
            ],
            branchAccess: const [],
          ),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(of: find.byKey(const Key('pos-user-detail-tabs')), matching: find.text('Permisos')),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-user-permisos-list')), findsOneWidget);
      expect(find.text('Consultar ventas'), findsOneWidget);
      expect(find.text('sale.read'), findsNothing);
      // Never a per-user override control — no schema for one exists.
      expect(find.byType(Switch), findsNothing);
      expect(find.byType(Checkbox), findsNothing);
    });

    testWidgets('sin staff_credential.manage, la sección PIN de acceso no aparece', (tester) async {
      final user = _user('u1', 'cajero@inflapark.test', 'Cajero', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions); // no staff_credential.manage.

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);

      expect(find.text('PIN de acceso'), findsNothing);
      expect(find.byKey(const Key('pos-user-pin-set')), findsNothing);
    });

    testWidgets('con staff_credential.manage, actualizar el PIN llama al endpoint real — nunca muestra ni retiene el PIN anterior', (
      tester,
    ) async {
      final user = _user('u1', 'cajero@inflapark.test', 'Cajero', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(
        tester,
        gateway: gateway,
        permissions: [..._ownerPermissions, 'staff_credential.manage'],
      );

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);

      expect(find.text('PIN de acceso'), findsOneWidget);
      // The section never claims to know/show an existing PIN — only a
      // masked placeholder, never a real value.
      expect(find.text('••••'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('pos-user-pin-set')));
      await tester.tap(find.byKey(const Key('pos-user-pin-set')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-user-pin-input')), '4321');
      await tester.tap(find.byKey(const Key('pos-user-pin-confirm')));
      await tester.pumpAndSettle();

      expect(gateway.setStaffPinCalls, hasLength(1));
      expect(gateway.setStaffPinCalls.single.membershipId, 'membership-u1');
      expect(gateway.setStaffPinCalls.single.pin, '4321');
      // The PIN dialog itself is gone — nothing keeps the typed value
      // around anywhere the UI could re-display it.
      expect(find.byKey(const Key('pos-user-pin-input')), findsNothing);
    });

    testWidgets('un PIN con formato inválido se rechaza antes de llamar al backend', (tester) async {
      final user = _user('u1', 'cajero@inflapark.test', 'Cajero', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(
        tester,
        gateway: gateway,
        permissions: [..._ownerPermissions, 'staff_credential.manage'],
      );

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);
      await tester.ensureVisible(find.byKey(const Key('pos-user-pin-set')));
      await tester.tap(find.byKey(const Key('pos-user-pin-set')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-user-pin-input')), '12');
      await tester.tap(find.byKey(const Key('pos-user-pin-confirm')));
      await tester.pumpAndSettle();

      expect(gateway.setStaffPinCalls, isEmpty);
      expect(find.textContaining('4 y 8 dígitos'), findsOneWidget);
    });

    testWidgets('quitar el PIN llama al endpoint real de eliminación', (tester) async {
      final user = _user('u1', 'cajero@inflapark.test', 'Cajero', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(
        tester,
        gateway: gateway,
        permissions: [..._ownerPermissions, 'staff_credential.manage'],
      );

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);
      await tester.ensureVisible(find.byKey(const Key('pos-user-pin-clear')));
      await tester.tap(find.byKey(const Key('pos-user-pin-clear')));
      await tester.pumpAndSettle();

      expect(gateway.clearStaffPinCalls, ['membership-u1']);
    });

    testWidgets('un rechazo real del backend al actualizar el PIN se muestra honestamente, nunca un falso éxito', (tester) async {
      final user = _user('u1', 'cajero@inflapark.test', 'Cajero', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      )..staffPinFailure = const ApiException(AppFailure(AppErrorKind.authorization, 'No autorizado.'));
      await _pump(
        tester,
        gateway: gateway,
        permissions: [..._ownerPermissions, 'staff_credential.manage'],
      );

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await _selectAccesoTab(tester);
      await tester.ensureVisible(find.byKey(const Key('pos-user-pin-set')));
      await tester.tap(find.byKey(const Key('pos-user-pin-set')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-user-pin-input')), '123456');
      await tester.tap(find.byKey(const Key('pos-user-pin-confirm')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-user-pin-error')), findsOneWidget);
      expect(find.text('No autorizado.'), findsOneWidget);
    });

    testWidgets('Permisos muestra un estado honesto de vacío cuando el usuario no tiene rol activo', (tester) async {
      final user = _user('u1', 'sinrol@inflapark.test', 'Sin Rol', identityStatus: 'active', membershipStatus: 'active');
      final gateway = _RecordingIdentityAdminGateway(
        users: [user],
        userDetails: {user.id: PosUserDetail(user: user, roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      await tester.tap(find.byKey(Key('pos-user-row-${user.id}')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(of: find.byKey(const Key('pos-user-detail-tabs')), matching: find.text('Permisos')),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-user-permisos-empty')), findsOneWidget);
    });
  });

  group('Permisos — catálogo de solo lectura', () {
    testWidgets('agrupa el catálogo real por dominio', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(
        permissions: [_permission('p1', 'sale.read', 'sale'), _permission('p2', 'inventory.read', 'inventory')],
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      expect(find.byKey(const Key('pos-permission-domain-sale')), findsOneWidget);
      expect(find.byKey(const Key('pos-permission-domain-inventory')), findsOneWidget);
      // Browse mode never renders an interactive switch.
      expect(find.byType(Switch), findsNothing);
    });
  });

  // TASK 16.16A — the permission catalogue UI used to render the raw
  // developer-facing code as the row's PRIMARY text and the backend's own
  // generic "Approved AS ONE capability: ..." string (leaking the old
  // brand name) as its subtitle. Both are now commercial-Spanish
  // (`pos_permission_presentation.dart`); the raw code survives only as a
  // small, clearly-secondary "Código técnico: ..." caption.
  group('Permisos — presentación comercial (TASK 16.16A)', () {
    testWidgets(
      'una fila de permiso usa la etiqueta comercial como texto principal — nunca el código crudo ni la '
      'descripción cruda del backend ("Approved AS ONE capability: ...")',
      (tester) async {
        final gateway = _RecordingIdentityAdminGateway(
          permissions: [
            PosPermission(
              id: 'p-access-read',
              code: 'access.read',
              description: 'Approved AS ONE capability: access.read',
              domain: 'access',
            ),
          ],
        );
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');
        await tester.tap(find.byKey(const Key('pos-permission-domain-access')));
        await tester.pumpAndSettle();

        // The commercial label is the PRIMARY text.
        expect(find.text('Consultar accesos'), findsOneWidget);
        // The raw code is never the primary/leading text anymore.
        expect(find.text('access.read'), findsNothing);
        // The backend's own raw description — carrying the old "AS ONE"
        // brand name — must never reach the widget tree.
        expect(find.textContaining('Approved AS ONE capability'), findsNothing);
        expect(find.textContaining('AS ONE'), findsNothing);
        // The commercial category label replaces the raw domain string.
        // TASK 16.31.3 — compact section headings now render uppercase
        // (matching the visual reference's "VENTAS"/"CATÁLOGO" style).
        expect(find.text('CONTROL DE ACCESO'), findsOneWidget);
        // TASK 16.31.5 — the raw code no longer consumes its own
        // permanently-visible line (the density this task asks for);
        // it stays reachable in the SAME hover/long-press Tooltip as the
        // commercial description, never as always-visible text.
        expect(find.text('Código técnico: access.read'), findsNothing);
        final tooltip = tester.widget<Tooltip>(
          find.ancestor(
            of: find.byKey(const Key('pos-permission-row-p-access-read')),
            matching: find.byType(Tooltip),
          ),
        );
        expect(tooltip.message, contains('Código técnico: access.read'));
      },
    );

    testWidgets(
      'el mismo catálogo se muestra igual en el picker editable de un rol (Roles → detalle de rol)',
      (tester) async {
        final role = _role('r-perm-picker', 'Cajero', 'cashier');
        final permission = PosPermission(
          id: 'p-refund-read',
          code: 'refund.read',
          description: 'Approved AS ONE capability: refund.read',
          domain: 'refund',
        );
        final gateway = _RecordingIdentityAdminGateway(
          roles: [role],
          permissions: [permission],
          rolePermissionsByRole: {role.id: const []},
        );
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

        await tester.tap(find.byKey(Key('pos-role-row-${role.id}')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('pos-permission-domain-refund')));
        await tester.pumpAndSettle();

        expect(find.text('Consultar reembolsos'), findsOneWidget);
        expect(find.text('refund.read'), findsNothing);
        expect(find.textContaining('AS ONE'), findsNothing);
      },
    );

    testWidgets(
      'un dominio con muchos permisos no revienta el layout en un viewport de escritorio normal',
      (tester) async {
        final permissions = [
          for (var i = 0; i < 40; i++) _permission('p-sale-$i', 'sale.action_$i', 'sale'),
        ];
        final gateway = _RecordingIdentityAdminGateway(permissions: permissions);
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

        await tester.tap(find.byKey(const Key('pos-permission-domain-sale')));
        await tester.pumpAndSettle();

        // No exception thrown by `pumpAndSettle` above means the long,
        // scrollable list rendered without overflow — the real assertion
        // here is simply that this reaches this line at all.
        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-permission-row-p-sale-0')), findsOneWidget);
      },
    );
  });

  group('Permission-denied — solo lectura honesta', () {
    testWidgets('sin user.read, la pestaña Usuarios nunca llama al gateway', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(users: [_user('u1', 'a@b.test', 'A')]);
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.textContaining('user.read'), findsOneWidget);
      expect(gateway.listUsersCalls, 0);
    });

    testWidgets('sin role.read, la pestaña Roles nunca llama al gateway', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(roles: [_role('r1', 'Owner', 'owner')]);
      await _pump(tester, gateway: gateway, permissions: const [], tab: 'Roles y permisos');

      expect(find.textContaining('role.read'), findsOneWidget);
      expect(gateway.listRolesCalls, 0);
    });

    testWidgets('sin permission.read, la pestaña Permisos nunca llama al gateway', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(permissions: [_permission('p1', 'sale.read', 'sale')]);
      await _pump(tester, gateway: gateway, permissions: const [], tab: 'Roles y permisos');

      expect(find.textContaining('permission.read'), findsOneWidget);
      expect(gateway.listPermissionsCalls, 0);
    });
  });

  // TASK 16.31 — the Usuarios card grid's own real enrichment (role
  // badge/branch scope/permission count), KPI strip, and role filter.
  group('Usuarios — tarjetas enriquecidas y KPIs (TASK 16.31)', () {
    testWidgets('el KPI strip muestra totales reales, y rol/sucursal/permisos se resuelven en la tarjeta', (
      tester,
    ) async {
      final role = _role('role-1', 'Gerente', 'manager');
      final salePermission = _permission('perm-1', 'sale.read', 'sale');
      final refundPermission = _permission('perm-2', 'refund.read', 'refund');
      final u1 = _user('u1', 'ana@inflapark.test', 'Ana Cajero');
      final u2 = _user('u2', 'bob@inflapark.test', 'Bob Sin Rol');
      final gateway = _RecordingIdentityAdminGateway(
        users: [u1, u2],
        roles: [role],
        rolePermissionsByRole: {
          role.id: [_assignment(salePermission), _assignment(refundPermission)],
        },
        userDetails: {
          u1.id: PosUserDetail(
            user: u1,
            roles: [
              PosUserRoleAssignment(id: 'a1', roleId: role.id, roleCode: role.code, roleName: role.name, branchId: null, status: 'active'),
            ],
            branchAccess: const [],
          ),
          u2.id: PosUserDetail(user: u2, roles: const [], branchAccess: const []),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);

      expect(tester.widget<Text>(find.byKey(const Key('pos-users-kpi-total'))).data, '2');
      expect(tester.widget<Text>(find.byKey(const Key('pos-users-kpi-active'))).data, '2');
      // Enrichment resolves asynchronously — settle once more before
      // reading the role-derived KPIs/card content.
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const Key('pos-users-kpi-roles-in-use'))).data, '1');
      expect(tester.widget<Text>(find.byKey(const Key('pos-users-kpi-without-role'))).data, '1');

      // Ana: real role name, "Todas las sucursales" (branchId: null on
      // her own assignment), and a real 2-permission count.
      expect(find.text('Gerente'), findsWidgets);
      expect(find.text('Todas las sucursales'), findsOneWidget);
      expect(find.text('2 permisos'), findsOneWidget);
      // Bob: honestly "Sin rol" — never a fabricated role.
      expect(find.text('Sin rol'), findsOneWidget);
    });

    testWidgets('el filtro de rol solo muestra usuarios con ese rol asignado', (tester) async {
      final manager = _role('role-mgr', 'Gerente', 'manager');
      final cashier = _role('role-csh', 'Cajero', 'cashier');
      final u1 = _user('u1', 'ana@inflapark.test', 'Ana Gerente');
      final u2 = _user('u2', 'bob@inflapark.test', 'Bob Cajero');
      final gateway = _RecordingIdentityAdminGateway(
        users: [u1, u2],
        roles: [manager, cashier],
        userDetails: {
          u1.id: PosUserDetail(
            user: u1,
            roles: [
              PosUserRoleAssignment(
                id: 'a1',
                roleId: manager.id,
                roleCode: manager.code,
                roleName: manager.name,
                branchId: 'branch-1',
                status: 'active',
              ),
            ],
            branchAccess: const [],
          ),
          u2.id: PosUserDetail(
            user: u2,
            roles: [
              PosUserRoleAssignment(
                id: 'a2',
                roleId: cashier.id,
                roleCode: cashier.code,
                roleName: cashier.name,
                branchId: 'branch-1',
                status: 'active',
              ),
            ],
            branchAccess: const [],
          ),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-users-role-filter')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cajero').last);
      await tester.pumpAndSettle();

      expect(find.text('Ana Gerente'), findsNothing);
      expect(find.text('Bob Cajero'), findsOneWidget);
    });
  });

  // TASK 16.31 — the Roles master/detail: selecting a role updates the
  // right pane in place (no modal), a protected role shows "Protegido"
  // and never a close button in the embedded pane, and the default
  // (nothing selected) right pane is the full permission catalog.
  group('Roles — maestro/detalle (TASK 16.31)', () {
    testWidgets('seleccionar un rol en la lista actualiza el panel derecho sin abrir un diálogo', (tester) async {
      final roleA = _role('role-a', 'Gerente', 'manager');
      final roleB = _role('role-b', 'Cajero', 'cashier');
      final gateway = _RecordingIdentityAdminGateway(roles: [roleA, roleB]);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      // Nothing selected yet — the default catalog-browse pane shows.
      expect(find.text('Selecciona un rol para ver o editar sus permisos'), findsOneWidget);
      expect(find.byKey(const Key('pos-role-detail-close')), findsNothing);

      await tester.tap(find.byKey(const Key('pos-role-row-role-a')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-role-detail-name')), findsOneWidget);
      // No modal route was pushed — the close button never renders in
      // the embedded pane (there's nothing to pop back to).
      expect(find.byKey(const Key('pos-role-detail-close')), findsNothing);

      await tester.tap(find.byKey(const Key('pos-role-row-role-b')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byKey(const Key('pos-role-detail-name'))).controller!.text,
        'Cajero',
      );
    });

    testWidgets('un rol protegido (is_system) muestra "Protegido" y sus campos quedan de solo lectura', (
      tester,
    ) async {
      final systemRole = _role('role-owner', 'Owner', 'owner', isSystem: true);
      final gateway = _RecordingIdentityAdminGateway(roles: [systemRole]);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      expect(find.text('Protegido'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pos-role-row-role-owner')));
      await tester.pumpAndSettle();

      final nameField = tester.widget<TextField>(find.byKey(const Key('pos-role-detail-name')));
      expect(nameField.enabled, isFalse);
    });
  });

  // TASK 16.31 (Phase 23/29) — responsive/no-overflow at a narrow width
  // for both the Usuarios card grid and the Roles master/detail (which
  // must stack list-then-detail rather than crush a two-column row).
  group('Responsive (TASK 16.31)', () {
    testWidgets('la cuadrícula de Usuarios no revienta en un viewport angosto', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(
        users: [_user('u1', 'ana@inflapark.test', 'Ana Cajero'), _user('u2', 'bob@inflapark.test', 'Bob Gerente')],
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('pos-users-grid')), findsOneWidget);
    });

    // TASK 17.4.2 §17/§23 — the user detail dialog's Datos/Acceso/Permisos
    // tabs and the "PIN de acceso" section (TASK 17.4.1) must all stay
    // reachable at true phone width, with no overflow anywhere in the
    // dialog.
    testWidgets(
      'TASK 17.4.2 §17 — a 390x844 la ficha de usuario (Datos/Acceso/Permisos/PIN) no revienta y sigue siendo alcanzable',
      (tester) async {
        final user = _user('u1', 'cajero@inflapark.test', 'Cajero Móvil', identityStatus: 'active', membershipStatus: 'active');
        final role = _role('r-cashier', 'Cajero', 'cashier');
        final saleRead = _permission('p-sale-read', 'sale.read', 'sale');
        final gateway = _RecordingIdentityAdminGateway(
          users: [user],
          roles: [role],
          permissions: [saleRead],
          rolePermissionsByRole: {role.id: [_assignment(saleRead)]},
          userDetails: {
            user.id: PosUserDetail(
              user: user,
              roles: [
                PosUserRoleAssignment(
                  id: 'assignment-1',
                  roleId: role.id,
                  roleCode: role.code,
                  roleName: role.name,
                  branchId: null,
                  status: 'active',
                ),
              ],
              branchAccess: const [],
            ),
          },
        );
        await _pump(tester, gateway: gateway, permissions: [..._ownerPermissions, 'staff_credential.manage']);
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pos-users-grid')), findsOneWidget);
        expect(tester.takeException(), isNull);

        final userRow = find.byKey(Key('pos-user-row-${user.id}'));
        await tester.ensureVisible(userRow);
        await tester.tap(userRow);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final tabs = find.byKey(const Key('pos-user-detail-tabs'));
        expect(tabs, findsOneWidget);
        expect(find.text('Estado de la cuenta'), findsOneWidget);

        await tester.tap(find.descendant(of: tabs, matching: find.text('Acceso')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final pinButton = find.byKey(const Key('pos-user-pin-set'));
        await tester.ensureVisible(pinButton);
        expect(pinButton, findsOneWidget);
        expect(tester.takeException(), isNull);

        final permisosTab = find.descendant(of: tabs, matching: find.text('Permisos'));
        await tester.ensureVisible(permisosTab);
        await tester.tap(permisosTab);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-user-permisos-list')), findsOneWidget);
        expect(find.text('Consultar ventas'), findsOneWidget);
      },
    );

    testWidgets('el maestro/detalle de Roles se apila (lista, luego detalle) en un viewport angosto', (tester) async {
      final role = _role('role-a', 'Gerente', 'manager');
      final gateway = _RecordingIdentityAdminGateway(roles: [role]);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('pos-role-row-role-a')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('pos-role-detail-name')), findsOneWidget);
    });

    // TASK 17.5 §12/§31 — the new read-only "Otorgado"/"No otorgado" pill
    // (replacing a disabled `Switch` for a protected role) must not
    // overflow at true phone width either.
    testWidgets('el pill de solo lectura de un rol protegido no revienta en un viewport angosto', (tester) async {
      final systemRole = _role('role-owner', 'Owner', 'owner', isSystem: true);
      final permission = _permission('p-sale-read', 'sale.read', 'sale');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [systemRole],
        permissions: [permission],
        rolePermissionsByRole: {systemRole.id: [_assignment(permission)]},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-role-row-role-owner')));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Otorgado'), findsOneWidget);
    });

    for (final size in [const Size(1440, 900), const Size(1365, 768)]) {
      testWidgets('el maestro/detalle de Roles no revienta en un escritorio de ${size.width.toInt()}x${size.height.toInt()}', (
        tester,
      ) async {
        final role = _role(
          'role-a',
          'Gerente',
          'manager',
        );
        final permissions = [for (var i = 0; i < 24; i++) _permission('p-$i', 'sale.action_$i', 'sale')];
        final gateway = _RecordingIdentityAdminGateway(
          roles: [role],
          permissions: permissions,
          rolePermissionsByRole: {role.id: [for (final p in permissions.take(6)) _assignment(p)]},
        );
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pos-role-row-role-a')));
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.byKey(const Key('pos-permission-checkbox-p-0')), findsOneWidget);
      });
    }
  });

  // TASK 16.31.3 (Phase 5/6/16) — the primary requested change: no
  // accordion, no tap-to-expand required to see what a role grants.
  group('Densidad de permisos (TASK 16.31.3)', () {
    testWidgets('los permisos son visibles de inmediato, sin tocar el dominio para expandirlo', (tester) async {
      final role = _role('role-a', 'Gerente', 'manager');
      final permission = _permission('p-sale-read', 'sale.read', 'sale');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [role],
        permissions: [permission],
        rolePermissionsByRole: {role.id: [_assignment(permission)]},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      await tester.tap(find.byKey(const Key('pos-role-row-role-a')));
      await tester.pumpAndSettle();

      // No tap on `pos-permission-domain-sale` anywhere in this test —
      // the switch and its label are already in the tree.
      expect(find.text('Consultar ventas'), findsOneWidget);
      expect(find.byKey(const Key('pos-permission-checkbox-p-sale-read')), findsOneWidget);
      expect(find.byType(Switch), findsOneWidget);
    });

    testWidgets('Buscar permiso filtra el catálogo por etiqueta o código, sin llamar al backend de nuevo', (
      tester,
    ) async {
      final permissions = [
        _permission('p-sale-read', 'sale.read', 'sale'),
        _permission('p-inv-read', 'inventory.read', 'inventory'),
        // Filler so the catalogue crosses the "worth searching" size —
        // the search field is deliberately omitted for a tiny custom
        // role's own handful of permissions.
        for (var i = 0; i < 8; i++) _permission('p-filler-$i', 'report.action_$i', 'report'),
      ];
      final gateway = _RecordingIdentityAdminGateway(permissions: permissions);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      expect(gateway.listPermissionsCalls, 1);
      await tester.enterText(find.byKey(const Key('pos-permission-search')), 'inventory');
      await tester.pumpAndSettle();

      expect(find.text('Consultar inventario'), findsOneWidget);
      expect(find.text('Consultar ventas'), findsNothing);
      // A pure client-side filter over the already-loaded catalogue —
      // never a second real fetch.
      expect(gateway.listPermissionsCalls, 1);
    });
  });

  // TASK 16.31.5 — the final visual polish over the same real data: the
  // technical code no longer consumes a permanently-visible second
  // line, switches replace checkboxes, and everything above still
  // behaves (interactivity, RBAC, protected-role read-only state).
  group('Pulido final de permisos (TASK 16.31.5)', () {
    testWidgets('el código técnico nunca se renderiza como texto permanente — solo dentro del tooltip', (
      tester,
    ) async {
      final permissions = [
        _permission('p-sale-read', 'sale.read', 'sale'),
        _permission('p-inv-read', 'inventory.read', 'inventory'),
      ];
      final gateway = _RecordingIdentityAdminGateway(permissions: permissions);
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      for (final permission in permissions) {
        expect(find.text('Código técnico: ${permission.code}'), findsNothing);
        final tooltip = tester.widget<Tooltip>(
          find.ancestor(
            of: find.byKey(Key('pos-permission-row-${permission.id}')),
            matching: find.byType(Tooltip),
          ),
        );
        expect(tooltip.message, contains('Código técnico: ${permission.code}'));
      }
    });

    testWidgets('un permiso otorgable sigue siendo interactivo, y uno protegido/no otorgable queda de solo lectura', (
      tester,
    ) async {
      final role = _role('role-a', 'Cajero', 'cashier');
      final saleRead = _permission('p-sale-read', 'sale.read', 'sale');
      final saleCreate = _permission('p-sale-create', 'sale.create', 'sale');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [role],
        permissions: [saleRead, saleCreate],
        rolePermissionsByRole: {role.id: [_assignment(saleRead)]},
      );
      // Holds sale.read but not sale.create.
      await _pump(tester, gateway: gateway, permissions: [...(_ownerPermissions), 'sale.read'], tab: 'Roles y permisos');

      await tester.tap(find.byKey(Key('pos-role-row-${role.id}')));
      await tester.pumpAndSettle();

      final grantable = tester.widget<Switch>(find.byKey(Key('pos-permission-checkbox-${saleRead.id}')));
      expect(grantable.value, isTrue);
      expect(grantable.onChanged, isNotNull);

      final ungrantable = tester.widget<Switch>(find.byKey(Key('pos-permission-checkbox-${saleCreate.id}')));
      expect(ungrantable.value, isFalse);
      expect(ungrantable.onChanged, isNull);

      await tester.tap(find.byKey(Key('pos-permission-checkbox-${saleRead.id}')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Switch>(find.byKey(Key('pos-permission-checkbox-${saleRead.id}'))).value,
        isFalse,
        reason: 'a granted switch the actor holds itself can still be toggled off',
      );
    });

    // TASK 17.5 §12 — a disabled `Switch(value: true)` read visually close
    // to "disabled and absent" (production review finding); a protected
    // role's permissions now render as an unmistakable read-only
    // "Otorgado"/"No otorgado" pill instead, never an editable `Switch`
    // (which would misleadingly imply the row could ever be toggled).
    testWidgets('un rol protegido muestra sus permisos como "Otorgado" de solo lectura, nunca un switch', (
      tester,
    ) async {
      final systemRole = _role('role-owner', 'Owner', 'owner', isSystem: true);
      final grantedPermission = _permission('p-sale-read', 'sale.read', 'sale');
      final ungrantedPermission = _permission('p-sale-create', 'sale.create', 'sale');
      final gateway = _RecordingIdentityAdminGateway(
        roles: [systemRole],
        permissions: [grantedPermission, ungrantedPermission],
        rolePermissionsByRole: {systemRole.id: [_assignment(grantedPermission)]},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles y permisos');

      await tester.tap(find.byKey(const Key('pos-role-row-role-owner')));
      await tester.pumpAndSettle();

      expect(find.text('Protegido'), findsWidgets);
      expect(find.byKey(const Key('pos-permission-checkbox-p-sale-read')), findsNothing);
      expect(find.byKey(const Key('pos-permission-checkbox-p-sale-create')), findsNothing);
      expect(find.text('Otorgado'), findsOneWidget);
      expect(find.text('No otorgado'), findsOneWidget);
    });
  });

  // TASK 16.31 (Phase 13/14/15/16) — Sesión actual: only real
  // `AuthenticatedContext` data, no fabricated login time/device/IP, and
  // no quick-user-switching affordance (the backend capability exists
  // but this app never adopts a switched session as its own — see
  // docs/USERS_EMPLOYEES_UX.md).
  group('Sesión actual (TASK 16.31)', () {
    testWidgets('muestra el usuario real, su rol resuelto, alcance de sucursal, y sus permisos como chips', (
      tester,
    ) async {
      final role = _role('role-1', 'Dueña', 'owner');
      final gateway = _RecordingIdentityAdminGateway(
        userDetails: {
          'user-id': PosUserDetail(
            user: _user('user-id', 'owner@example.test', 'Dueña AS'),
            roles: [
              PosUserRoleAssignment(id: 'a1', roleId: role.id, roleCode: role.code, roleName: role.name, branchId: null, status: 'active'),
            ],
            branchAccess: const [],
          ),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Sesión actual');

      expect(find.text('Dueña AS'), findsOneWidget);
      expect(find.text('owner@example.test'), findsOneWidget);
      expect(find.text('Todas las sucursales'), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.text('Dueña'), findsOneWidget);
      for (final code in _ownerPermissions) {
        expect(find.byKey(Key('pos-session-permission-chip-$code')), findsOneWidget);
      }
    });

    testWidgets('nunca muestra hora de entrada, equipo, IP, cambiar contraseña, ni cambiar usuario rápido', (
      tester,
    ) async {
      final gateway = _RecordingIdentityAdminGateway(
        userDetails: {'user-id': PosUserDetail(user: _user('user-id', 'owner@example.test', 'Dueña AS'), roles: const [], branchAccess: const [])},
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Sesión actual');
      await tester.pumpAndSettle();

      expect(find.textContaining('Hora de entrada'), findsNothing);
      expect(find.textContaining('Equipo'), findsNothing);
      expect(find.textContaining('IP'), findsNothing);
      expect(find.textContaining('Cambiar contraseña'), findsNothing);
      expect(find.textContaining('usuario rápido'), findsNothing);
    });

    testWidgets('Cerrar sesión llama al callback real cuando está disponible, y queda deshabilitado si no', (
      tester,
    ) async {
      var loggedOut = false;
      final gateway = _RecordingIdentityAdminGateway(
        userDetails: {'user-id': PosUserDetail(user: _user('user-id', 'owner@example.test', 'Dueña AS'), roles: const [], branchAccess: const [])},
      );
      tester.view.physicalSize = const Size(1400, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: PosUserAdministrationScreen(
                context: _context(_ownerPermissions),
                gateway: gateway,
                onLogout: () => loggedOut = true,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sesión actual'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('pos-session-logout')));
      await tester.pumpAndSettle();
      expect(loggedOut, isTrue);
    });
  });
}

PosUser _user(
  String id,
  String email,
  String displayName, {
  String identityStatus = 'active',
  String membershipStatus = 'active',
  // TASK 17.4.1 — real responses always carry `membership_id`; defaulted
  // here (rather than left null) so every existing call site keeps
  // exercising the PIN-section's real "membership id present" path,
  // matching production. `null` remains overridable for a dedicated test
  // of the (never expected in practice) absent case.
  String? membershipId,
}) => PosUser(
  id: id,
  email: email,
  displayName: displayName,
  identityStatus: identityStatus,
  membershipStatus: membershipStatus,
  membershipId: membershipId ?? 'membership-$id',
);

PosRole _role(String id, String name, String code, {bool isSystem = false, String status = 'active'}) => PosRole(
  id: id,
  name: name,
  code: code,
  description: null,
  status: status,
  isSystem: isSystem,
  createdAt: null,
  updatedAt: null,
);

PosPermission _permission(String id, String code, String domain) =>
    PosPermission(id: id, code: code, description: 'Descripción de $code', domain: domain);

PosRolePermissionAssignment _assignment(PosPermission permission) => PosRolePermissionAssignment(
  permissionId: permission.id,
  code: permission.code,
  description: permission.description,
  domain: permission.domain,
  effect: 'allow',
);

class _RecordingIdentityAdminGateway implements PosIdentityAdminGateway {
  _RecordingIdentityAdminGateway({
    List<PosUser> users = const [],
    List<PosRole> roles = const [],
    List<PosPermission> permissions = const [],
    Map<String, List<PosRolePermissionAssignment>> rolePermissionsByRole = const {},
    Map<String, PosUserDetail> userDetails = const {},
    List<BranchSummary> grantableBranches = const [],
    Map<String, List<PosRegisterAccessGrant>> registerAccessByUser = const {},
    List<PosRoleTemplate> roleTemplates = const [],
    // TASK 17.3.2 — per-branch failure injection for the resilient
    // multi-branch user-creation orchestration tests: keyed by branchId
    // (`null` = the company-wide/"Todas las sucursales" call), so a test
    // can make exactly one selected branch's assignRole/changeBranchAccess
    // call fail while every other branch still succeeds, proving every
    // selected branch is genuinely attempted independently.
    ApiException? createUserFailure,
    Map<String?, ApiException> assignRoleFailuresByBranchId = const {},
    Map<String?, ApiException> changeBranchAccessFailuresByBranchId = const {},
  }) : _users = List.of(users),
       _roles = List.of(roles),
       _permissions = List.of(permissions),
       _rolePermissions = Map.of(rolePermissionsByRole),
       _userDetails = Map.of(userDetails),
       _grantableBranches = List.of(grantableBranches),
       _registerAccessByUser = Map.of(registerAccessByUser),
       _roleTemplates = List.of(roleTemplates),
       _createUserFailure = createUserFailure,
       _assignRoleFailuresByBranchId = Map.of(assignRoleFailuresByBranchId),
       _changeBranchAccessFailuresByBranchId = Map.of(changeBranchAccessFailuresByBranchId);

  final List<PosUser> _users;
  final List<PosRole> _roles;
  final List<PosPermission> _permissions;
  final Map<String, List<PosRolePermissionAssignment>> _rolePermissions;
  final Map<String, PosUserDetail> _userDetails;
  final List<BranchSummary> _grantableBranches;
  final Map<String, List<PosRegisterAccessGrant>> _registerAccessByUser;
  final List<PosRoleTemplate> _roleTemplates;
  final ApiException? _createUserFailure;
  final Map<String?, ApiException> _assignRoleFailuresByBranchId;
  final Map<String?, ApiException> _changeBranchAccessFailuresByBranchId;

  int listUsersCalls = 0;
  int listRolesCalls = 0;
  int listPermissionsCalls = 0;
  int listRoleTemplatesCalls = 0;
  final List<({String email, String displayName})> createUserCalls = [];
  final List<({String userId, String status, String? password})> updateMembershipCalls = [];
  final List<({String name, String code, String? description})> createRoleCalls = [];
  final List<({String roleId, List<PosPermissionEffect> assignments})> replaceRolePermissionsCalls = [];
  final List<({String userId, String roleId, String? branchId})> assignRoleCalls = [];
  final List<({String userId, String assignmentId})> revokeRoleCalls = [];
  final List<({String userId, String branchId, String status, bool isDefault})> changeBranchAccessCalls = [];
  int listGrantableBranchesCalls = 0;
  String? listGrantableBranchesLastCompanyId;
  final List<({String userId, String branchId, String? operationalAreaId, String? cashRegisterId})>
  grantRegisterAccessCalls = [];
  final List<({String userId, String id})> revokeRegisterAccessCalls = [];
  final List<({String membershipId, String pin})> setStaffPinCalls = [];
  final List<String> clearStaffPinCalls = [];
  ApiException? staffPinFailure;

  @override
  Future<List<PosUser>> listUsers() async {
    listUsersCalls++;
    return List.of(_users);
  }

  @override
  Future<PosUser> createUser({required String email, required String displayName}) async {
    createUserCalls.add((email: email, displayName: displayName));
    final failure = _createUserFailure;
    if (failure != null) throw failure;
    final user = PosUser(
      id: 'new-user-${createUserCalls.length}',
      email: email,
      displayName: displayName,
      identityStatus: 'pending',
      membershipStatus: 'invited',
    );
    _users.add(user);
    _userDetails[user.id] = PosUserDetail(user: user, roles: const [], branchAccess: const []);
    return user;
  }

  @override
  Future<PosUserDetail> userDetail(String userId) async {
    final detail = _userDetails[userId];
    if (detail == null) throw StateError('No detail seeded for $userId in this test fixture.');
    return detail;
  }

  @override
  Future<void> updateMembership(String userId, String membershipStatus, {String? password}) async {
    updateMembershipCalls.add((userId: userId, status: membershipStatus, password: password));
    final index = _users.indexWhere((user) => user.id == userId);
    if (index < 0) return;
    final current = _users[index];
    final becomesActiveFirstTime = current.identityStatus == 'pending' && membershipStatus == 'active';
    final updated = PosUser(
      id: current.id,
      email: current.email,
      displayName: current.displayName,
      identityStatus: becomesActiveFirstTime ? 'active' : current.identityStatus,
      membershipStatus: membershipStatus,
    );
    _users[index] = updated;
    final detail = _userDetails[userId];
    _userDetails[userId] = PosUserDetail(
      user: updated,
      roles: detail?.roles ?? const [],
      branchAccess: detail?.branchAccess ?? const [],
    );
  }

  @override
  Future<List<PosRole>> listRoles() async {
    listRolesCalls++;
    return List.of(_roles);
  }

  @override
  Future<PosRole> createRole({required String name, required String code, String? description}) async {
    createRoleCalls.add((name: name, code: code, description: description));
    final role = PosRole(
      id: 'new-role-${createRoleCalls.length}',
      name: name,
      code: code,
      description: description,
      status: 'active',
      isSystem: false,
      createdAt: null,
      updatedAt: null,
    );
    _roles.add(role);
    _rolePermissions[role.id] = const [];
    return role;
  }

  @override
  Future<PosRole> role(String roleId) async => _roles.firstWhere((role) => role.id == roleId);

  @override
  Future<List<PosRoleTemplate>> listRoleTemplates() async {
    listRoleTemplatesCalls++;
    return List.of(_roleTemplates);
  }

  @override
  Future<PosRole> updateRole(String roleId, {String? name, String? description, String? status}) async {
    final index = _roles.indexWhere((role) => role.id == roleId);
    final current = _roles[index];
    final updated = PosRole(
      id: current.id,
      name: name ?? current.name,
      code: current.code,
      description: description ?? current.description,
      status: status ?? current.status,
      isSystem: current.isSystem,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    );
    _roles[index] = updated;
    return updated;
  }

  @override
  Future<List<PosRolePermissionAssignment>> rolePermissions(String roleId) async =>
      List.of(_rolePermissions[roleId] ?? const []);

  @override
  Future<List<PosRolePermissionAssignment>> replaceRolePermissions(
    String roleId,
    List<PosPermissionEffect> assignments,
  ) async {
    replaceRolePermissionsCalls.add((roleId: roleId, assignments: List.of(assignments)));
    final result = [
      for (final assignment in assignments)
        _assignment(_permissions.firstWhere((permission) => permission.id == assignment.permissionId)),
    ];
    _rolePermissions[roleId] = result;
    return result;
  }

  @override
  Future<List<PosPermission>> listPermissions() async {
    listPermissionsCalls++;
    return List.of(_permissions);
  }

  @override
  Future<void> assignRole(String userId, {required String roleId, String? branchId}) async {
    assignRoleCalls.add((userId: userId, roleId: roleId, branchId: branchId));
    final failure = _assignRoleFailuresByBranchId[branchId];
    if (failure != null) throw failure;
    final role = _roles.firstWhere((role) => role.id == roleId);
    final assignment = PosUserRoleAssignment(
      id: 'assignment-${assignRoleCalls.length}',
      roleId: roleId,
      roleCode: role.code,
      roleName: role.name,
      branchId: branchId,
      status: 'active',
    );
    final detail = _userDetails[userId];
    if (detail != null) {
      _userDetails[userId] = PosUserDetail(
        user: detail.user,
        roles: [...detail.roles, assignment],
        branchAccess: detail.branchAccess,
      );
    }
  }

  @override
  Future<void> revokeRoleAssignment(String userId, String assignmentId) async {
    revokeRoleCalls.add((userId: userId, assignmentId: assignmentId));
    final detail = _userDetails[userId];
    if (detail == null) return;
    _userDetails[userId] = PosUserDetail(
      user: detail.user,
      roles: [
        for (final assignment in detail.roles)
          if (assignment.id == assignmentId)
            PosUserRoleAssignment(
              id: assignment.id,
              roleId: assignment.roleId,
              roleCode: assignment.roleCode,
              roleName: assignment.roleName,
              branchId: assignment.branchId,
              status: 'revoked',
            )
          else
            assignment,
      ],
      branchAccess: detail.branchAccess,
    );
  }

  @override
  Future<void> changeBranchAccess(
    String userId,
    String branchId, {
    required String status,
    required bool isDefault,
  }) async {
    changeBranchAccessCalls.add((userId: userId, branchId: branchId, status: status, isDefault: isDefault));
    final failure = _changeBranchAccessFailuresByBranchId[branchId];
    if (failure != null) throw failure;
    final detail = _userDetails[userId];
    if (detail == null) return;
    final existingIndex = detail.branchAccess.indexWhere((access) => access.branchId == branchId);
    final access = PosUserBranchAccess(
      id: existingIndex >= 0 ? detail.branchAccess[existingIndex].id : 'access-$branchId',
      branchId: branchId,
      status: status,
      isDefault: isDefault,
    );
    final updatedList = List.of(detail.branchAccess);
    if (existingIndex >= 0) {
      updatedList[existingIndex] = access;
    } else {
      updatedList.add(access);
    }
    _userDetails[userId] = PosUserDetail(user: detail.user, roles: detail.roles, branchAccess: updatedList);
  }

  @override
  Future<void> revokeBranchAccess(String userId, String branchId) async {
    final detail = _userDetails[userId];
    if (detail == null) return;
    _userDetails[userId] = PosUserDetail(
      user: detail.user,
      roles: detail.roles,
      branchAccess: [
        for (final access in detail.branchAccess)
          if (access.branchId == branchId)
            PosUserBranchAccess(id: access.id, branchId: access.branchId, status: 'revoked', isDefault: false)
          else
            access,
      ],
    );
  }

  @override
  Future<List<BranchSummary>> listGrantableBranches(String companyId) async {
    listGrantableBranchesCalls++;
    listGrantableBranchesLastCompanyId = companyId;
    return List.of(_grantableBranches);
  }

  @override
  Future<PosRegisterAccessGrant> grantRegisterAccess(
    String userId, {
    required String branchId,
    String? operationalAreaId,
    String? cashRegisterId,
  }) async {
    grantRegisterAccessCalls.add((
      userId: userId,
      branchId: branchId,
      operationalAreaId: operationalAreaId,
      cashRegisterId: cashRegisterId,
    ));
    final grant = PosRegisterAccessGrant(
      id: 'grant-${grantRegisterAccessCalls.length}',
      branchId: branchId,
      operationalAreaId: operationalAreaId,
      cashRegisterId: cashRegisterId,
      status: 'active',
      userId: userId,
    );
    _registerAccessByUser[userId] = [...?_registerAccessByUser[userId], grant];
    return grant;
  }

  @override
  Future<List<PosRegisterAccessGrant>> listRegisterAccess(String userId) async =>
      List.of(_registerAccessByUser[userId] ?? const []);

  @override
  Future<void> revokeRegisterAccess(String userId, String id) async {
    revokeRegisterAccessCalls.add((userId: userId, id: id));
    final existing = _registerAccessByUser[userId];
    if (existing == null) return;
    _registerAccessByUser[userId] = [
      for (final grant in existing)
        if (grant.id == id)
          PosRegisterAccessGrant(
            id: grant.id,
            branchId: grant.branchId,
            operationalAreaId: grant.operationalAreaId,
            cashRegisterId: grant.cashRegisterId,
            status: 'revoked',
            userId: grant.userId,
          )
        else
          grant,
    ];
  }

  @override
  Future<void> setStaffPin(String membershipId, String pin) async {
    setStaffPinCalls.add((membershipId: membershipId, pin: pin));
    final failure = staffPinFailure;
    if (failure != null) throw failure;
  }

  @override
  Future<void> clearStaffPin(String membershipId) async {
    clearStaffPinCalls.add(membershipId);
    final failure = staffPinFailure;
    if (failure != null) throw failure;
  }
}

// TASK 17.4.1 §11 — the user detail dialog now organizes into Datos/
// Acceso/Permisos tabs (default: Datos); every test below that needs
// role/branch/register-access content must switch to Acceso first,
// mirroring `pos_inventory_admin_test.dart`'s own established
// `find.descendant(of: find.byKey(tabsKey), matching: find.text(label))`
// tab-selection convention.
Future<void> _selectAccesoTab(WidgetTester tester) async {
  await tester.tap(
    find.descendant(of: find.byKey(const Key('pos-user-detail-tabs')), matching: find.text('Acceso')),
  );
  await tester.pumpAndSettle();
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingIdentityAdminGateway gateway,
  required List<String> permissions,
  String tab = 'Usuarios',
  // TASK 16.16A — optional, additive: only the register/area access-grant
  // name-resolution tests pass real fakes here; every other existing
  // caller keeps working unmodified against the screen's own `Empty...`
  // defaults, exactly like before this task.
  PosOperationalAreasGateway areasGateway = const EmptyPosOperationalAreasGateway(),
  PosCashGateway cashGateway = const EmptyPosCashGateway(),
  // TASK 17.3.2 — optional context override, additive: only the
  // multi-branch resilient-creation tests (which need a 3rd branch to
  // prove a "middle branch" case) pass one; every other existing caller
  // keeps building its context from `_context(permissions)` unchanged.
  AuthenticatedContext? context,
}) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosUserAdministrationScreen(
            context: context ?? _context(permissions),
            gateway: gateway,
            areasGateway: areasGateway,
            cashGateway: cashGateway,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (tab != 'Usuarios') {
    await tester.tap(find.text(tab));
    await tester.pumpAndSettle();
  }
}

// TASK 16.16A — minimal read-only fakes for the register/area access-grant
// name-resolution tests, extending the real `Empty...` gateways (never
// implementing the full interface by hand) and overriding only the one
// method each test actually needs — `_RecordingAreasGateway`/
// `_RecordingCashGateway` in `pos_operational_areas_screen_test.dart` is
// this codebase's own fuller-featured version of the same fixture
// convention for a screen that needs to WRITE through these gateways;
// this file only ever reads through them.
class _StubAreasGateway extends EmptyPosOperationalAreasGateway {
  const _StubAreasGateway(this._areas);
  final List<PosOperationalArea> _areas;

  @override
  Future<PosOperationalAreaPage> listAreas({String? branchId, String? status, String? cursor, int limit = 50}) async {
    final filtered = branchId == null ? _areas : _areas.where((area) => area.branchId == branchId).toList();
    return PosOperationalAreaPage(items: filtered, nextCursor: null);
  }
}

class _StubCashGateway extends EmptyPosCashGateway {
  const _StubCashGateway(this._registers);
  final List<PosCashRegister> _registers;

  @override
  Future<List<PosCashRegister>> registersForBranch(String branchId, {String? operationalAreaId}) async =>
      _registers.where((register) => register.branchId == branchId).toList();
}

AuthenticatedContext _context(List<String> permissions) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-1',
    permittedBranchIds: const ['branch-1', 'branch-2'],
    companyWideAccess: true,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Dueña AS', email: 'owner@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(id: 'branch-1', code: 'CENTRO', name: 'Sucursal Centro', timezone: 'America/Mexico_City', current: true),
    BranchSummary(id: 'branch-2', code: 'NORTE', name: 'Sucursal Norte', timezone: 'America/Mexico_City'),
  ],
  companyWideAccess: true,
  permissions: permissions,
);

// TASK 17.3.2 — a 3-branch variant, needed only to prove a genuine
// "middle branch" case (branch 1 succeeds, branch 2 fails, branch 3 is
// still attempted) in the resilient multi-branch creation tests below.
AuthenticatedContext _contextWithThreeBranches(List<String> permissions) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-1',
    permittedBranchIds: const ['branch-1', 'branch-2', 'branch-3'],
    companyWideAccess: true,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Dueña AS', email: 'owner@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(id: 'branch-1', code: 'CENTRO', name: 'Sucursal Centro', timezone: 'America/Mexico_City', current: true),
    BranchSummary(id: 'branch-2', code: 'NORTE', name: 'Sucursal Norte', timezone: 'America/Mexico_City'),
    BranchSummary(id: 'branch-3', code: 'SUR', name: 'Sucursal Sur', timezone: 'America/Mexico_City'),
  ],
  companyWideAccess: true,
  permissions: permissions,
);
