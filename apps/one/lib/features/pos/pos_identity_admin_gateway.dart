/// TASK 15.1 (Phase 2) — the Flutter side of the "Users / Roles /
/// Permissions admin" surface (`docs/RC_RELEASE_INVENTORY.md`'s TENANT
/// section, "Users / Roles / Permissions admin" row): before this file, the
/// real backend (`apps/api/src/modules/admin/identity/identity.routes.ts`,
/// `AdministrationService` in `apps/api/src/modules/admin/shared/
/// admin.service.ts`) had ZERO Flutter caller for anything beyond the
/// read-only `GET /api/v1/users` list (`PosReadGateway.users()`, backing
/// `pos_shell.dart`'s view-only `_Users` widget) — a real park owner could
/// not create a user, create/edit a role, assign role permissions, or grant
/// branch access without the CLI/API/SQL. This gateway closes that gap for
/// every other identity-admin endpoint the backend already exposes.
///
/// Deliberately its OWN gateway file, not folded into `pos_read_gateway.dart`
/// (whose `PosReadGateway.users()`/`PosUser` stay untouched and are reused
/// here unmodified — see the `PosUser` import below) or into
/// `pos_people_gateway.dart` (a different domain: Empleados/Horarios/
/// Checador/Nómina, not identity/access) — mirrors this codebase's own
/// precedent of one gateway file per cohesive backend module (e.g.
/// `pos_suppliers_gateway.dart`, `pos_promotions_gateway.dart`).
///
/// Model/method shapes mirror `identity.routes.ts` and `admin.service.ts`
/// (lines ~226-710) exactly — every field name matches the wire contract
/// (snake_case JSON keys decoded into camelCase Dart fields), and every
/// method's doc comment cites the exact route + permission code it calls,
/// mirroring `pos_people_gateway.dart`'s own citation style.
///
/// Branch scope for role assignment: callers pass branches from the acting
/// admin's own already-loaded `AuthenticatedContext.branches`, exactly like
/// `pos_receipt_branding_screen.dart` and other screens already do for
/// branch-scoped pickers.
///
/// TASK 16.5 exception — [listGrantableBranches]: the "Otorgar acceso a
/// sucursal" branch picker used to reuse that same cached
/// `AuthenticatedContext.branches` too, which is populated only once, at
/// login/token-refresh (`auth_gateway.dart`'s `hydrate`, the single call
/// site — `auth_state.dart`). That caused a real production bootstrap bug:
/// a brand-new company's first Owner creates their first branch
/// (`PosBranchAdminScreen`, which fetches fresh on every load and correctly
/// showed it), then opens "Otorgar acceso" and finds the branch missing —
/// the picker was still showing the stale snapshot from before that branch
/// existed. [listGrantableBranches] instead calls
/// `GET /api/v1/companies/{company_id}/branches` FRESH, every time the
/// grant dialog opens — mirroring exactly what `PosBranchAdminScreen`
/// already does, and matching what the backend's own `changeBranchAccess`
/// mutation already allows unconditionally (granting access to any branch
/// in the actor's own company, regardless of the actor's own current
/// branch scope — see `admin.service.ts`'s own doc comment on
/// `listBranches`/`changeBranchAccess`).
library;

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart' show BranchSummary;
import 'pos_models.dart' show PosUser;

export 'pos_models.dart' show PosUser;

// ---------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------

/// A `roles` row (`roles_status_ck`: `active` | `inactive` | `retired` —
/// `packages/database/src/schema/identity.ts:139`). [createdAt]/[updatedAt]
/// are `null` right after [PosIdentityAdminGateway.createRole] (the backend's
/// own `createRole` response omits them — `admin.service.ts:421-428`); every
/// other call site populates them from a real row.
class PosRole {
  const PosRole({
    required this.id,
    required this.name,
    required this.code,
    required this.description,
    required this.status,
    required this.isSystem,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosRole.fromJson(Map<String, Object?> json) => PosRole(
    id: json['id']! as String,
    name: json['name']! as String,
    code: json['code']! as String,
    description: json['description'] as String?,
    status: json['status']! as String,
    isSystem: json['is_system']! as bool,
    createdAt: json['created_at'] == null ? null : DateTime.parse(json['created_at']! as String),
    updatedAt: json['updated_at'] == null ? null : DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String name;
  final String code;
  final String? description;

  /// `active` | `inactive` | `retired`.
  final String status;

  /// A seeded/system role — `AdministrationService.updateRole`/
  /// `replaceRolePermissions` both 403 `permission_denied` server-side for
  /// these (`admin.service.ts:462-467,522-527`); the UI mirrors this by
  /// disabling every edit control rather than only relying on that 403.
  final bool isSystem;
  final DateTime? createdAt;
  final DateTime? updatedAt;
}

/// A `permissions` row joined with `role_permissions.effect` for one role
/// (`GET /api/v1/roles/{id}/permissions`'s implicit shape — actually served
/// via `rolePermissions`, folded into the `PUT .../permissions` response —
/// see `admin.service.ts:483-493`).
class PosRolePermissionAssignment {
  const PosRolePermissionAssignment({
    required this.permissionId,
    required this.code,
    required this.description,
    required this.domain,
    required this.effect,
  });

  factory PosRolePermissionAssignment.fromJson(Map<String, Object?> json) => PosRolePermissionAssignment(
    permissionId: json['id']! as String,
    code: json['code']! as String,
    description: json['description'] as String?,
    domain: json['domain']! as String,
    effect: json['effect']! as String,
  );

  final String permissionId;
  final String code;
  final String? description;
  final String domain;

  /// `allow` | `deny` (`role_permissions.effect` — `PUT .../permissions`'s
  /// own body shape, `identity.routes.ts:185-215`). This screen only ever
  /// offers `allow` — there is no UI surface that would construct a `deny`
  /// row (the picker's checkbox is a real allow/not-present toggle, never a
  /// three-state allow/deny/unset control), matching every real role this
  /// backend seeds today (see `technical-permissions.ts`; no seeded role
  /// data uses `deny`).
  final String effect;
}

/// `PUT /api/v1/roles/{id}/permissions` body entry.
class PosPermissionEffect {
  const PosPermissionEffect({required this.permissionId, this.effect = 'allow'});
  final String permissionId;
  final String effect;

  Map<String, Object?> toJson() => {'permission_id': permissionId, 'effect': effect};
}

// ---------------------------------------------------------------------
// Permissions (the server-authoritative catalog)
// ---------------------------------------------------------------------

/// A `permissions` row (`GET /api/v1/permissions`, `permission.read`) — the
/// full, real, dot-namespaced catalog (`packages/database/src/seeds/
/// technical-permissions.ts`), never a client-invented list.
class PosPermission {
  const PosPermission({required this.id, required this.code, required this.description, required this.domain});

  factory PosPermission.fromJson(Map<String, Object?> json) => PosPermission(
    id: json['id']! as String,
    code: json['code']! as String,
    description: json['description'] as String?,
    domain: json['domain']! as String,
  );

  final String id;

  /// Dot-namespaced, e.g. `sale.create`, `inventory.transfer` — the exact
  /// string `AuthenticatedContext.permissions` also carries for the acting
  /// session, so the two are directly comparable (see `_PermissionPicker`'s
  /// self-escalation guard in `pos_user_administration_screen.dart`).
  final String code;
  final String? description;
  final String domain;
}

// ---------------------------------------------------------------------
// Users — role assignments / branch access (nested under a user)
// ---------------------------------------------------------------------

/// A `user_roles` row as returned by `userDetail`'s `roles` include
/// (`admin.service.ts:577-591`) — `role_code`/`role_name` come from the
/// joined `roles` row, so this is always fully-named, never a bare id the
/// UI would have to resolve separately.
class PosUserRoleAssignment {
  const PosUserRoleAssignment({
    required this.id,
    required this.roleId,
    required this.roleCode,
    required this.roleName,
    required this.branchId,
    required this.status,
  });

  factory PosUserRoleAssignment.fromJson(Map<String, Object?> json) => PosUserRoleAssignment(
    id: json['id']! as String,
    roleId: json['role_id']! as String,
    roleCode: json['role_code']! as String,
    roleName: json['role_name']! as String,
    branchId: json['branch_id'] as String?,
    status: json['status']! as String,
  );

  final String id;
  final String roleId;
  final String roleCode;
  final String roleName;

  /// `null` means company-wide (every branch), matching
  /// `assignRole`'s own optional `branchId` (`admin.service.ts:593-690`).
  final String? branchId;

  /// `active` | `revoked` (`user_roles_status_ck`).
  final String status;
}

/// A `user_branch_access` row as returned by `userDetail`'s `branches`
/// include (`admin.service.ts:248-253`).
class PosUserBranchAccess {
  const PosUserBranchAccess({
    required this.id,
    required this.branchId,
    required this.status,
    required this.isDefault,
  });

  factory PosUserBranchAccess.fromJson(Map<String, Object?> json) => PosUserBranchAccess(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    status: json['status']! as String,
    isDefault: json['is_default']! as bool,
  );

  final String id;
  final String branchId;

  /// `active` | `revoked` (`user_branch_access_status_ck`).
  final String status;
  final bool isDefault;
}

/// `GET /api/v1/users/{id}?include=roles,branches` — the base [PosUser]
/// row plus its role assignments and branch access, decoded together since
/// the backend returns them as one flattened object (`admin.service.ts:
/// 234-255`).
class PosUserDetail {
  const PosUserDetail({required this.user, required this.roles, required this.branchAccess});

  factory PosUserDetail.fromJson(Map<String, Object?> json) {
    final rawRoles = json['roles'];
    final rawBranches = json['branch_access'];
    return PosUserDetail(
      user: PosUser.fromJson(json),
      roles: rawRoles is List<Object?>
          ? rawRoles.whereType<Map<String, Object?>>().map(PosUserRoleAssignment.fromJson).toList(growable: false)
          : const [],
      branchAccess: rawBranches is List<Object?>
          ? rawBranches.whereType<Map<String, Object?>>().map(PosUserBranchAccess.fromJson).toList(growable: false)
          : const [],
    );
  }

  final PosUser user;
  final List<PosUserRoleAssignment> roles;
  final List<PosUserBranchAccess> branchAccess;
}

// ---------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------

/// TASK 16.15 — a `user_register_access` row: narrows a user's already-
/// granted branch access down to either "every register in one
/// operational area" ([operationalAreaId] non-null) or "one specific
/// register" ([cashRegisterId] non-null) within [branchId]. Exactly one of
/// the two is ever non-null, mirroring the backend's own required-XOR
/// validation. Tolerant of the two slightly different response shapes the
/// backend actually returns (`POST .../register-access`'s own
/// `{id, membership_id, user_id, branch_id, operational_area_id,
/// cash_register_id, status}` vs. `GET .../register-access`'s list row
/// `{id, branch_id, operational_area_id, cash_register_id, status,
/// created_at, revoked_at}`) — [membershipId]/[userId]/[createdAt]/
/// [revokedAt] are simply `null` whenever a given response omits them.
class PosRegisterAccessGrant {
  const PosRegisterAccessGrant({
    required this.id,
    required this.branchId,
    required this.operationalAreaId,
    required this.cashRegisterId,
    required this.status,
    this.membershipId,
    this.userId,
    this.createdAt,
    this.revokedAt,
  });

  factory PosRegisterAccessGrant.fromJson(Map<String, Object?> json) => PosRegisterAccessGrant(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    operationalAreaId: json['operational_area_id'] as String?,
    cashRegisterId: json['cash_register_id'] as String?,
    status: json['status'] as String? ?? 'active',
    membershipId: json['membership_id'] as String?,
    userId: json['user_id'] as String?,
    createdAt: json['created_at'] as String?,
    revokedAt: json['revoked_at'] as String?,
  );

  final String id;
  final String branchId;

  /// Non-null exactly when [cashRegisterId] is null — "every register in
  /// this operational area".
  final String? operationalAreaId;

  /// Non-null exactly when [operationalAreaId] is null — "this one
  /// specific register".
  final String? cashRegisterId;

  /// `active` | `revoked`.
  final String status;
  final String? membershipId;
  final String? userId;
  final String? createdAt;
  final String? revokedAt;
}

abstract interface class PosIdentityAdminGateway {
  /// `GET /api/v1/users` (`user.read`). The backend accepts no free-text
  /// search querystring (`identity.routes.ts:13-25` reads no
  /// `request.query`) — a caller that wants to filter by name/email must do
  /// so client-side over this real, already-fetched list, never a
  /// fabricated server-side search (mirrors `pos_people_gateway.dart`'s own
  /// documented precedent for `listEmployees`).
  Future<List<PosUser>> listUsers();

  /// `POST /api/v1/users` (`user.create`) — creates the `users`+
  /// `company_memberships` rows in `pending`/`invited` state
  /// (`admin.service.ts:257-292`); the new hire cannot log in until a
  /// first-activation `PATCH` (see [updateMembership]) sets a real
  /// password.
  Future<PosUser> createUser({required String email, required String displayName});

  /// `GET /api/v1/users/{id}?include=roles,branches` (`user.read`).
  Future<PosUserDetail> userDetail(String userId);

  /// `PATCH /api/v1/users/{id}` (`user.update`) — [membershipStatus] must be
  /// one of `active`/`suspended`/`disabled` (never `invited`, which is only
  /// ever set by [createUser]). [password] is REQUIRED the first time a
  /// still-`pending` identity is activated (`admin.service.ts:320-347`'s own
  /// documented rule) and ignored otherwise; never sent unless the caller is
  /// performing that first activation.
  Future<void> updateMembership(String userId, String membershipStatus, {String? password});

  /// `GET /api/v1/roles` (`role.read`).
  Future<List<PosRole>> listRoles();

  /// `POST /api/v1/roles` (`role.create`). [code] is the role's own stable
  /// identifier (distinct from [name], the display label) — the backend
  /// enforces no particular format itself, but every seeded role in this
  /// codebase uses a short `snake_case` code (e.g. `owner`, `cashier`).
  Future<PosRole> createRole({required String name, required String code, String? description});

  /// `GET /api/v1/roles/{id}` (`role.read`).
  Future<PosRole> role(String roleId);

  /// `PATCH /api/v1/roles/{id}` (`role.update`) — every field optional
  /// (partial update). 403s `permission_denied` server-side for a system
  /// role (`admin.service.ts:462-467`).
  Future<PosRole> updateRole(String roleId, {String? name, String? description, String? status});

  /// `GET /api/v1/roles/{id}/permissions` (`role.read`) — a real,
  /// non-mutating read of a role's currently-persisted permissions. TASK
  /// 15.1 (Phase 2) launch-blocker fix: this route did not exist before this
  /// task (the only prior caller of `AdministrationService.rolePermissions`
  /// was the `PUT .../permissions` handler itself, AFTER already replacing
  /// the role's permissions) — with `PUT` being pure replace-semantics (see
  /// [replaceRolePermissions]'s own doc comment), there was no safe way for
  /// any client to discover a role's existing permissions before editing
  /// them. Added here as a minimal, additive `GET` wired to the same
  /// already-permissioned, already-tested service method — see
  /// `identity.routes.ts`'s own doc comment on the route for the full
  /// citation.
  Future<List<PosRolePermissionAssignment>> rolePermissions(String roleId);

  /// `PUT /api/v1/roles/{id}/permissions` (`role.permission.manage`) —
  /// REPLACE semantics: [assignments] must be the FULL desired permission
  /// set for the role, not a delta (`admin.service.ts:495-550` deletes every
  /// existing `role_permissions` row for the role first, then re-inserts
  /// exactly [assignments]). A caller that wants to add one permission to an
  /// existing role must first fetch [rolePermissions] and include every
  /// already-granted id. 403s `permission_denied` server-side for a system
  /// role. Returns the role's real post-write permission list.
  Future<List<PosRolePermissionAssignment>> replaceRolePermissions(
    String roleId,
    List<PosPermissionEffect> assignments,
  );

  /// `GET /api/v1/permissions` (`permission.read`) — the full,
  /// server-authoritative catalog.
  Future<List<PosPermission>> listPermissions();

  /// `POST /api/v1/users/{id}/roles` (`role.assign`). [branchId] omitted
  /// means company-wide (every branch); a 409 `validation_error` is a real
  /// possible outcome when the exact (role, branch) pair is already
  /// actively assigned (`admin.service.ts:642-647`) — callers surface this
  /// honestly via [ApiException], never silently swallow it.
  Future<void> assignRole(String userId, {required String roleId, String? branchId});

  /// `DELETE /api/v1/users/{userId}/roles/{assignmentId}` (`role.assign`).
  Future<void> revokeRoleAssignment(String userId, String assignmentId);

  /// `PUT /api/v1/users/{userId}/branch-access/{branchId}`
  /// (`branch_access.manage`) — a genuine upsert (`admin.service.ts:
  /// 692-777`): creates the row if none exists yet for this (user, branch),
  /// otherwise updates the existing one in place.
  Future<void> changeBranchAccess(String userId, String branchId, {required String status, required bool isDefault});

  /// `DELETE /api/v1/users/{userId}/branch-access/{branchId}`
  /// (`branch_access.manage`).
  Future<void> revokeBranchAccess(String userId, String branchId);

  /// `GET /api/v1/companies/{companyId}/branches` (`branch.read`) — see this
  /// file's own header doc comment for why this exists and is deliberately
  /// fetched fresh on every call, never cached. Populates the "Otorgar
  /// acceso a sucursal" branch picker. `current`/`isDefault` on the
  /// returned [BranchSummary]s are always `false` — this listing is not
  /// session-context-aware and neither field is read by that picker.
  Future<List<BranchSummary>> listGrantableBranches(String companyId);

  /// `POST /api/v1/users/{userId}/register-access` (`branch_access.manage`
  /// — the SAME existing permission the branch-access methods above
  /// already use, never a new one) — TASK 16.15: narrows a user's already-
  /// granted branch access down to specific register(s)/area(s) within
  /// [branchId]. Exactly one of [operationalAreaId]/[cashRegisterId] must
  /// be provided (never both, never neither); the backend independently
  /// re-validates that exact XOR and throws [ApiException] honestly
  /// otherwise. "Presence narrows, absence means unrestricted": a user with
  /// ZERO grant rows for a branch they already have branch-level access to
  /// is UNRESTRICTED within it (can use any register) — this call only
  /// ever narrows, never widens or replaces that default.
  Future<PosRegisterAccessGrant> grantRegisterAccess(
    String userId, {
    required String branchId,
    String? operationalAreaId,
    String? cashRegisterId,
  });

  /// `GET /api/v1/users/{userId}/register-access` (`branch_access.manage`)
  /// — every current grant for this user, across every branch.
  Future<List<PosRegisterAccessGrant>> listRegisterAccess(String userId);

  /// `DELETE /api/v1/users/{userId}/register-access/{id}`
  /// (`branch_access.manage`) — revokes one grant, narrowing the user back
  /// TOWARD unrestricted (never the reverse: revoking every grant for a
  /// branch returns that user to fully unrestricted within it, not to "no
  /// access" — branch-level access itself is managed separately by
  /// [changeBranchAccess]/[revokeBranchAccess] above).
  Future<void> revokeRegisterAccess(String userId, String id);
}

class ApiPosIdentityAdminGateway implements PosIdentityAdminGateway {
  const ApiPosIdentityAdminGateway(this._client);
  final ApiClient _client;

  @override
  Future<List<PosUser>> listUsers() async =>
      _items(await _client.getJson('/api/v1/users')).map(PosUser.fromJson).toList(growable: false);

  @override
  Future<PosUser> createUser({required String email, required String displayName}) async {
    final envelope = await _client.postJson(
      '/api/v1/users',
      body: {'email': email, 'display_name': displayName},
    );
    return PosUser.fromJson(_map(envelope));
  }

  @override
  Future<PosUserDetail> userDetail(String userId) async {
    final envelope = await _client.getJson('/api/v1/users/$userId?include=roles,branches');
    return PosUserDetail.fromJson(_map(envelope));
  }

  @override
  Future<void> updateMembership(String userId, String membershipStatus, {String? password}) async {
    await _client.patchJson(
      '/api/v1/users/$userId',
      body: {'membership_status': membershipStatus, if (password != null) 'password': password},
    );
  }

  @override
  Future<List<PosRole>> listRoles() async =>
      _items(await _client.getJson('/api/v1/roles')).map(PosRole.fromJson).toList(growable: false);

  @override
  Future<PosRole> createRole({required String name, required String code, String? description}) async {
    final envelope = await _client.postJson(
      '/api/v1/roles',
      body: {'name': name, 'code': code, if (description != null) 'description': description},
    );
    return PosRole.fromJson(_map(envelope));
  }

  @override
  Future<PosRole> role(String roleId) async {
    final envelope = await _client.getJson('/api/v1/roles/$roleId');
    return PosRole.fromJson(_map(envelope));
  }

  @override
  Future<PosRole> updateRole(String roleId, {String? name, String? description, String? status}) async {
    final envelope = await _client.patchJson(
      '/api/v1/roles/$roleId',
      body: {
        if (name != null) 'name': name,
        if (description != null) 'description': description,
        if (status != null) 'status': status,
      },
    );
    return PosRole.fromJson(_map(envelope));
  }

  @override
  Future<List<PosRolePermissionAssignment>> rolePermissions(String roleId) async {
    final envelope = await _client.getJson('/api/v1/roles/$roleId/permissions');
    return _items(envelope).map(PosRolePermissionAssignment.fromJson).toList(growable: false);
  }

  @override
  Future<List<PosRolePermissionAssignment>> replaceRolePermissions(
    String roleId,
    List<PosPermissionEffect> assignments,
  ) async {
    final envelope = await _client.putJson(
      '/api/v1/roles/$roleId/permissions',
      body: {'permissions': assignments.map((item) => item.toJson()).toList(growable: false)},
    );
    return _items(envelope).map(PosRolePermissionAssignment.fromJson).toList(growable: false);
  }

  @override
  Future<List<PosPermission>> listPermissions() async =>
      _items(await _client.getJson('/api/v1/permissions')).map(PosPermission.fromJson).toList(growable: false);

  @override
  Future<void> assignRole(String userId, {required String roleId, String? branchId}) async {
    await _client.postJson(
      '/api/v1/users/$userId/roles',
      body: {'role_id': roleId, if (branchId != null) 'branch_id': branchId},
    );
  }

  @override
  Future<void> revokeRoleAssignment(String userId, String assignmentId) async {
    await _client.deleteJson('/api/v1/users/$userId/roles/$assignmentId');
  }

  @override
  Future<void> changeBranchAccess(
    String userId,
    String branchId, {
    required String status,
    required bool isDefault,
  }) async {
    await _client.putJson(
      '/api/v1/users/$userId/branch-access/$branchId',
      body: {'status': status, 'is_default': isDefault},
    );
  }

  @override
  Future<void> revokeBranchAccess(String userId, String branchId) async {
    await _client.deleteJson('/api/v1/users/$userId/branch-access/$branchId');
  }

  @override
  Future<List<BranchSummary>> listGrantableBranches(String companyId) async {
    final envelope = await _client.getJson('/api/v1/companies/$companyId/branches');
    return _items(envelope)
        // `changeBranchAccess` itself 404s for an inactive branch
        // (`admin.service.ts`: `select ... from branches where ... and
        // status='active'`) — filtered here too so the picker never offers
        // a branch that would fail on submit.
        .where((item) => item['status'] == 'active')
        .map(
          (item) => BranchSummary(
            id: item['id']! as String,
            code: item['code']! as String,
            name: item['name']! as String,
            timezone: item['timezone']! as String,
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<PosRegisterAccessGrant> grantRegisterAccess(
    String userId, {
    required String branchId,
    String? operationalAreaId,
    String? cashRegisterId,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/users/$userId/register-access',
      body: {
        'branch_id': branchId,
        if (operationalAreaId != null) 'operational_area_id': operationalAreaId,
        if (cashRegisterId != null) 'cash_register_id': cashRegisterId,
      },
    );
    return PosRegisterAccessGrant.fromJson(_map(envelope));
  }

  @override
  Future<List<PosRegisterAccessGrant>> listRegisterAccess(String userId) async =>
      _items(await _client.getJson('/api/v1/users/$userId/register-access'))
          .map(PosRegisterAccessGrant.fromJson)
          .toList(growable: false);

  @override
  Future<void> revokeRegisterAccess(String userId, String id) async {
    await _client.deleteJson('/api/v1/users/$userId/register-access/$id');
  }

  Map<String, Object?> _map(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing data object.');
    }
    return data;
  }

  List<Map<String, Object?>> _items(Map<String, Object?> envelope) {
    final data = envelope['data'];
    final raw = data is List<Object?>
        ? data
        : data is Map<String, Object?> && data['items'] is List<Object?>
        ? data['items']! as List<Object?>
        : throw const FormatException('Missing data items.');
    return raw
        .map((item) => item is Map<String, Object?> ? item : throw const FormatException('Invalid data item.'))
        .toList(growable: false);
  }
}

class EmptyPosIdentityAdminGateway implements PosIdentityAdminGateway {
  const EmptyPosIdentityAdminGateway();

  @override
  Future<List<PosUser>> listUsers() async => const [];

  @override
  Future<PosUser> createUser({required String email, required String displayName}) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<PosUserDetail> userDetail(String userId) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<void> updateMembership(String userId, String membershipStatus, {String? password}) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<List<PosRole>> listRoles() async => const [];

  @override
  Future<PosRole> createRole({required String name, required String code, String? description}) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<PosRole> role(String roleId) => Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<PosRole> updateRole(String roleId, {String? name, String? description, String? status}) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<List<PosRolePermissionAssignment>> rolePermissions(String roleId) async => const [];

  @override
  Future<List<PosRolePermissionAssignment>> replaceRolePermissions(
    String roleId,
    List<PosPermissionEffect> assignments,
  ) => Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<List<PosPermission>> listPermissions() async => const [];

  @override
  Future<void> assignRole(String userId, {required String roleId, String? branchId}) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<void> revokeRoleAssignment(String userId, String assignmentId) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<void> changeBranchAccess(String userId, String branchId, {required String status, required bool isDefault}) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<void> revokeBranchAccess(String userId, String branchId) =>
      Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<List<BranchSummary>> listGrantableBranches(String companyId) async => const [];

  @override
  Future<PosRegisterAccessGrant> grantRegisterAccess(
    String userId, {
    required String branchId,
    String? operationalAreaId,
    String? cashRegisterId,
  }) => Future.error(StateError('No identity admin gateway is configured.'));

  @override
  Future<List<PosRegisterAccessGrant>> listRegisterAccess(String userId) async => const [];

  @override
  Future<void> revokeRegisterAccess(String userId, String id) =>
      Future.error(StateError('No identity admin gateway is configured.'));
}
