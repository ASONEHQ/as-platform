/// TASK 15.1 (commercial admin UX closure) — the Flutter side of the
/// ALREADY-REAL branch admin surface
/// (`apps/api/src/modules/admin/branches/branches.routes.ts`, backed by
/// `AdministrationService.listBranches`/`createBranch`/`branch`/
/// `updateBranch` in `apps/api/src/modules/admin/shared/admin.service.ts`):
/// `GET/POST /api/v1/companies/{company_id}/branches` and
/// `GET/PATCH /api/v1/branches/{branch_id}`. Before this file, the only
/// Flutter caller anywhere of either route was `BranchSelectionScreen`
/// (`apps/one/lib/features/authentication/screens.dart`), which only reads
/// the branches already embedded in `AuthenticatedContext.branches` at
/// login time — no gateway ever called these routes directly, and there
/// was no way to create or edit a branch from the app at all (see
/// `docs/RC_RELEASE_INVENTORY.md`'s TENANT section).
///
/// Styled after `pos_suppliers_gateway.dart` (abstract interface + `Api...`/
/// `Empty...` implementations, `PosX` model class with `fromJson`) with the
/// divergences the real contract itself requires:
///   * The list route has no pagination at all (`listBranches` in
///     `admin.service.ts` returns every permitted branch in one shot, no
///     `cursor`/`limit` querystring) — so [PosBranchAdminGateway.listBranches]
///     returns a plain `List<PosBranch>`, never a `...Page` wrapper, and its
///     response envelope shape is `{ data: { items: [...] } }` (the route's
///     own `successResponse({ items: ... })`), not `{ data: [...] }` the way
///     `GET /suppliers` is.
///   * A branch carries no `version` field at all (`updateBranch` in
///     `admin.service.ts` does a plain `coalesce(...)` update, and the
///     `PATCH /branches/{id}` route schema requires no `If-Match`) — mirrors
///     `pos_suppliers_gateway.dart`'s own versionless PATCH, never
///     `pos_category_admin_gateway.dart`'s optimistic-concurrency shape.
///   * `code`/`name`/`timezone` are all required on create
///     (`createBranch`'s own required `values` shape) but all optional on
///     update, exactly mirroring `branches.routes.ts`'s own two body
///     schemas.
///   * The backend also accepts an optional `address` object on both create
///     and update (`branches.routes.ts`'s own `address: { type: 'object' }`,
///     free-form, no sub-schema). This gateway/screen deliberately does NOT
///     expose an address editor — there is no established convention
///     anywhere in this app for editing an arbitrary JSON object (no
///     address sub-form, no address display, on any existing screen), and
///     `address` is optional on both routes, so omitting it keeps this a
///     real, honest, working create/edit flow rather than a half-built
///     control for a field with no clear UI shape yet — a future task can
///     add it without touching this gateway's contract (both `toJson`
///     shapes already simply omit any field left `null`).
library;

import '../../core/networking/api_client.dart';

/// A `branches` row (`branch(...)`/`listBranches(...)` in
/// `admin.service.ts`) — the FULL record, returned identically by
/// `POST .../branches`, `GET .../branches`, `GET /branches/{id}`, and
/// `PATCH /branches/{id}`.
class PosBranch {
  const PosBranch({
    required this.id,
    required this.companyId,
    required this.code,
    required this.name,
    required this.status,
    required this.timezone,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosBranch.fromJson(Map<String, Object?> json) => PosBranch(
    id: json['id']! as String,
    companyId: json['company_id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    status: json['status']! as String,
    timezone: json['timezone']! as String,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String companyId;
  final String code;
  final String name;

  /// `active` | `inactive` | `closed` (`branches_status_ck` in
  /// `packages/database/src/schema/organizations.ts`).
  final String status;
  final String timezone;
  final DateTime createdAt;
  final DateTime updatedAt;
}

/// The create/update input both `POST .../branches` and
/// `PATCH /branches/{id}` accept — `code`/`name`/`timezone` are only
/// backend-required on create (`branches.routes.ts`'s own create body
/// schema); the caller-side form is responsible for enforcing that before
/// calling [PosBranchAdminGateway.createBranch]. `status` is only ever
/// meaningful on an update (creation always starts `active` server-side —
/// see `createBranch`'s own hardcoded `'active'` insert).
class PosBranchInput {
  const PosBranchInput({this.code, this.name, this.timezone, this.status});

  final String? code;
  final String? name;
  final String? timezone;
  final String? status;

  Map<String, Object?> toJson() => {
    if (code != null) 'code': code,
    if (name != null) 'name': name,
    if (timezone != null) 'timezone': timezone,
    if (status != null) 'status': status,
  };
}

abstract interface class PosBranchAdminGateway {
  /// `GET /api/v1/companies/{companyId}/branches` (`branch.read`) —
  /// company-scoped, already filtered server-side to the actor's own
  /// permitted branches; no client-side filtering needed or possible (no
  /// server-side filter param exists on this route at all).
  Future<List<PosBranch>> listBranches({required String companyId});

  /// `POST /api/v1/companies/{companyId}/branches` (`branch.create`).
  /// Throws [ApiException] honestly on any rejection.
  Future<PosBranch> createBranch({required String companyId, required PosBranchInput input});

  /// `GET /api/v1/branches/{branchId}` (`branch.read`).
  Future<PosBranch> branch(String branchId);

  /// `PATCH /api/v1/branches/{branchId}` (`branch.update`) — no `If-Match`:
  /// see this file's own doc comment on why branches carry no `version`.
  Future<PosBranch> updateBranch(String branchId, PosBranchInput input);
}

class ApiPosBranchAdminGateway implements PosBranchAdminGateway {
  const ApiPosBranchAdminGateway(this._client);

  final ApiClient _client;

  @override
  Future<List<PosBranch>> listBranches({required String companyId}) async {
    final envelope = await _client.getJson('/api/v1/companies/$companyId/branches');
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing branches list data.');
    }
    final items = data['items'];
    if (items is! List<Object?>) {
      throw const FormatException('Missing branches list data.');
    }
    return items.whereType<Map<String, Object?>>().map(PosBranch.fromJson).toList(growable: false);
  }

  @override
  Future<PosBranch> createBranch({required String companyId, required PosBranchInput input}) async {
    final envelope = await _client.postJson(
      '/api/v1/companies/$companyId/branches',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosBranch> branch(String branchId) async {
    final envelope = await _client.getJson('/api/v1/branches/$branchId');
    return _decode(envelope);
  }

  @override
  Future<PosBranch> updateBranch(String branchId, PosBranchInput input) async {
    final envelope = await _client.patchJson('/api/v1/branches/$branchId', body: input.toJson());
    return _decode(envelope);
  }

  static String _idempotencyKey() => 'one-branch-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosBranch _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing branch data.');
    }
    return PosBranch.fromJson(data);
  }
}

class EmptyPosBranchAdminGateway implements PosBranchAdminGateway {
  const EmptyPosBranchAdminGateway();

  @override
  Future<List<PosBranch>> listBranches({required String companyId}) async => const [];

  @override
  Future<PosBranch> createBranch({required String companyId, required PosBranchInput input}) =>
      Future.error(StateError('No branch admin gateway is configured.'));

  @override
  Future<PosBranch> branch(String branchId) =>
      Future.error(StateError('No branch admin gateway is configured.'));

  @override
  Future<PosBranch> updateBranch(String branchId, PosBranchInput input) =>
      Future.error(StateError('No branch admin gateway is configured.'));
}
