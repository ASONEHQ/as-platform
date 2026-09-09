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
import 'package:as_one/features/pos/pos_identity_admin_gateway.dart';
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
  }) : _users = List.of(users),
       _roles = List.of(roles),
       _permissions = List.of(permissions),
       _rolePermissions = Map.of(rolePermissionsByRole),
       _userDetails = Map.of(userDetails);

  final List<PosUser> _users;
  final List<PosRole> _roles;
  final List<PosPermission> _permissions;
  final Map<String, List<PosRolePermissionAssignment>> _rolePermissions;
  final Map<String, PosUserDetail> _userDetails;

  int listUsersCalls = 0;
  int listRolesCalls = 0;
  int listPermissionsCalls = 0;
  final List<({String email, String displayName})> createUserCalls = [];
  final List<({String userId, String status, String? password})> updateMembershipCalls = [];
  final List<({String name, String code, String? description})> createRoleCalls = [];
  final List<({String roleId, List<PosPermissionEffect> assignments})> replaceRolePermissionsCalls = [];
  final List<({String userId, String roleId, String? branchId})> assignRoleCalls = [];
  final List<({String userId, String assignmentId})> revokeRoleCalls = [];
  final List<({String userId, String branchId, String status, bool isDefault})> changeBranchAccessCalls = [];

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
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingIdentityAdminGateway gateway,
  required List<String> permissions,
  String tab = 'Usuarios',
}) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: PosUserAdministrationScreen(context: _context(permissions), gateway: gateway),
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
