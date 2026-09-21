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
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles');

      await tester.tap(find.byKey(const Key('pos-roles-new')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pos-role-form-name')), 'Supervisor de sucursal');
      await tester.enterText(find.byKey(const Key('pos-role-form-code')), 'branch_supervisor');
      await tester.tap(find.byKey(const Key('pos-role-form-save')));
      await tester.pumpAndSettle();

      expect(gateway.createRoleCalls, hasLength(1));
      expect(gateway.createRoleCalls.single.name, 'Supervisor de sucursal');
      expect(gateway.createRoleCalls.single.code, 'branch_supervisor');
      expect(find.text('Supervisor de sucursal'), findsOneWidget);
    });

    testWidgets('sin role.create deja "Nuevo rol" deshabilitado', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(roles: const []);
      await _pump(tester, gateway: gateway, permissions: const ['role.read'], tab: 'Roles');

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
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles');

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
        final saleReadCheckbox = tester.widget<CheckboxListTile>(
          find.byKey(Key('pos-permission-checkbox-${saleReadPermission.id}')),
        );
        expect(saleReadCheckbox.value, isTrue, reason: 'sale.read is in the template AND the actor holds it');

        await tester.tap(find.byKey(const Key('pos-permission-domain-cash_session')));
        await tester.pumpAndSettle();
        final cashReadCheckbox = tester.widget<CheckboxListTile>(
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
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles');

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
        // No automatic permission dialog, and no permissions ever sent —
        // a truly empty role, exactly like the pre-TASK-16.16 flow.
        expect(find.byKey(const Key('pos-role-detail-save-permissions')), findsNothing);
        expect(gateway.replaceRolePermissionsCalls, isEmpty);
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
      await _pump(tester, gateway: gateway, permissions: [...(_ownerPermissions), 'sale.read'], tab: 'Roles');

      await tester.tap(find.byKey(Key('pos-role-row-${role.id}')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-permission-domain-sale')));
      await tester.pumpAndSettle();

      final grantable = tester.widget<CheckboxListTile>(find.byKey(Key('pos-permission-checkbox-${saleRead.id}')));
      expect(grantable.value, isTrue);
      expect(grantable.onChanged, isNotNull, reason: 'the actor holds sale.read, so it stays interactive');

      final ungrantable = tester.widget<CheckboxListTile>(find.byKey(Key('pos-permission-checkbox-${saleCreate.id}')));
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
      await _pump(tester, gateway: gateway, permissions: [...(_ownerPermissions), 'sale.read'], tab: 'Roles');

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
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles');

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
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles');

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

      expect(tester.takeException(), isNull);
      expect(find.textContaining('área area-missing'), findsOneWidget);
    });
  });

  group('Permisos — catálogo de solo lectura', () {
    testWidgets('agrupa el catálogo real por dominio', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(
        permissions: [_permission('p1', 'sale.read', 'sale'), _permission('p2', 'inventory.read', 'inventory')],
      );
      await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Permisos');

      expect(find.byKey(const Key('pos-permission-domain-sale')), findsOneWidget);
      expect(find.byKey(const Key('pos-permission-domain-inventory')), findsOneWidget);
      // Browse mode never renders an interactive checkbox.
      expect(find.byType(CheckboxListTile), findsNothing);
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
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Permisos');
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
        expect(find.text('Control de acceso'), findsOneWidget);
        // The raw code stays available only as a small, secondary,
        // clearly-labeled technical-detail affordance.
        expect(find.text('Código técnico: access.read'), findsOneWidget);
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
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Roles');

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
        await _pump(tester, gateway: gateway, permissions: _ownerPermissions, tab: 'Permisos');

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
      await _pump(tester, gateway: gateway, permissions: const [], tab: 'Roles');

      expect(find.textContaining('role.read'), findsOneWidget);
      expect(gateway.listRolesCalls, 0);
    });

    testWidgets('sin permission.read, la pestaña Permisos nunca llama al gateway', (tester) async {
      final gateway = _RecordingIdentityAdminGateway(permissions: [_permission('p1', 'sale.read', 'sale')]);
      await _pump(tester, gateway: gateway, permissions: const [], tab: 'Permisos');

      expect(find.textContaining('permission.read'), findsOneWidget);
      expect(gateway.listPermissionsCalls, 0);
    });
  });
}

PosUser _user(
  String id,
  String email,
  String displayName, {
  String identityStatus = 'active',
  String membershipStatus = 'active',
}) => PosUser(
  id: id,
  email: email,
  displayName: displayName,
  identityStatus: identityStatus,
  membershipStatus: membershipStatus,
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
  }) : _users = List.of(users),
       _roles = List.of(roles),
       _permissions = List.of(permissions),
       _rolePermissions = Map.of(rolePermissionsByRole),
       _userDetails = Map.of(userDetails),
       _grantableBranches = List.of(grantableBranches),
       _registerAccessByUser = Map.of(registerAccessByUser),
       _roleTemplates = List.of(roleTemplates);

  final List<PosUser> _users;
  final List<PosRole> _roles;
  final List<PosPermission> _permissions;
  final Map<String, List<PosRolePermissionAssignment>> _rolePermissions;
  final Map<String, PosUserDetail> _userDetails;
  final List<BranchSummary> _grantableBranches;
  final Map<String, List<PosRegisterAccessGrant>> _registerAccessByUser;
  final List<PosRoleTemplate> _roleTemplates;

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

  @override
  Future<List<PosUser>> listUsers() async {
    listUsersCalls++;
    return List.of(_users);
  }

  @override
  Future<PosUser> createUser({required String email, required String displayName}) async {
    createUserCalls.add((email: email, displayName: displayName));
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
}) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosUserAdministrationScreen(
            context: _context(permissions),
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
