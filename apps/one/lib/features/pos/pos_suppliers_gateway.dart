/// TASK 14.4 (Wave 2, Part C.1): the Flutter side of `suppliers.routes.ts`
/// — real supplier records ("Proveedores"), COMPANY-scoped only, never
/// branch-scoped (see that file's own doc comment: a supplier relationship
/// is with the business, not one physical location). Styled after
/// `pos_customers_gateway.dart` (TASK 13.0) — this wave's assigned
/// structural template — and diverges only where the backend contract
/// itself does:
///   * No `version`/`If-Match` optimistic concurrency anywhere here —
///     `SupplierRow` carries no `version` field at all (see
///     `suppliers.types.ts`), unlike `PosCustomer`/`updateCustomer`.
///   * `GET /suppliers` returns the exact SAME full shape as
///     `GET /suppliers/{id}` (`supplierHttp` is reused for both) — so
///     there is no separate "list row is a stripped summary" type here,
///     unlike `PosCustomerSummary` (Part AB/W's privacy-driven split does
///     not apply to a supplier contact record).
///   * The backend accepts NO server-side text search — only
///     `status`/`cursor`/`limit` (see `suppliers.routes.ts`'s own
///     querystring schema) — so [PosSuppliersScreen] filters by name/
///     contact/phone/email locally, over already-fetched real pages,
///     never a fabricated query param.
library;

import '../../core/networking/api_client.dart';

/// A `suppliers` row (`SupplierRow`/`supplierHttp` in `suppliers.routes.ts`)
/// — the FULL record, returned identically by `POST /suppliers`,
/// `GET /suppliers`, `GET /suppliers/{id}`, `PATCH /suppliers/{id}`, and
/// `POST /suppliers/{id}/deactivate`.
class PosSupplier {
  const PosSupplier({
    required this.id,
    required this.name,
    required this.contactName,
    required this.phone,
    required this.email,
    required this.notes,
    required this.status,
    required this.createdBy,
    required this.updatedBy,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosSupplier.fromJson(Map<String, Object?> json) => PosSupplier(
    id: json['id']! as String,
    name: json['name']! as String,
    contactName: json['contact_name'] as String?,
    phone: json['phone'] as String?,
    email: json['email'] as String?,
    notes: json['notes'] as String?,
    status: json['status']! as String,
    createdBy: json['created_by']! as String,
    updatedBy: json['updated_by']! as String,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String name;
  final String? contactName;
  final String? phone;
  final String? email;
  final String? notes;

  /// `active` | `inactive` — never a hard delete (see
  /// `suppliers.routes.ts`'s own doc comment on `POST .../deactivate`).
  final String status;
  final String createdBy;
  final String updatedBy;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosSupplierPage {
  const PosSupplierPage({required this.items, required this.nextCursor});
  final List<PosSupplier> items;
  final String? nextCursor;
}

/// The create/update input both `POST /suppliers` and `PATCH /suppliers/{id}`
/// accept — only `name` is ever required (mirrors `PosCustomerInput`'s own
/// minimum-friction shape). `status` is only ever meaningful on an update
/// (creation always starts `active` server-side).
class PosSupplierInput {
  const PosSupplierInput({
    this.name,
    this.contactName,
    this.phone,
    this.email,
    this.notes,
    this.status,
  });

  final String? name;
  final String? contactName;
  final String? phone;
  final String? email;
  final String? notes;
  final String? status;

  Map<String, Object?> toJson() => {
    if (name != null) 'name': name,
    if (contactName != null) 'contact_name': contactName,
    if (phone != null) 'phone': phone,
    if (email != null) 'email': email,
    if (notes != null) 'notes': notes,
    if (status != null) 'status': status,
  };
}

/// Maps a 409 `resource_conflict` [ApiException] (from `createSupplier`/
/// `updateSupplier`) to an honest, short Spanish message plus the existing
/// supplier's id the backend's own `details` carried (`SupplierError`'s
/// own established `details` convention) — mirrors
/// `posCustomerConflictFrom`'s exact shape.
class PosSupplierConflict {
  const PosSupplierConflict({required this.message, required this.existingSupplierId});
  final String message;
  final String? existingSupplierId;
}

PosSupplierConflict? posSupplierConflictFrom(ApiException error) {
  if (error.failure.code != 'resource_conflict') return null;
  final existingId = error.details?['existing_supplier_id'];
  return PosSupplierConflict(
    message: 'Ya existe un proveedor con ese nombre.',
    existingSupplierId: existingId is String ? existingId : null,
  );
}

abstract interface class PosSuppliersGateway {
  /// `POST /api/v1/suppliers` (`supplier.manage`). Throws [ApiException]
  /// honestly on any rejection, including a 409 conflict — see
  /// [posSupplierConflictFrom] for how a caller should surface that one.
  Future<PosSupplier> createSupplier(PosSupplierInput input);

  /// `GET /api/v1/suppliers` (`supplier.read`) — company-scoped, no branch
  /// filter (there is none to send). `status` is the only server-side
  /// filter the backend accepts; free-text search is applied locally by
  /// the caller over the real fetched items.
  Future<PosSupplierPage> listSuppliers({String? cursor, int limit = 50, String? status});

  /// `GET /api/v1/suppliers/{id}` (`supplier.read`).
  Future<PosSupplier> supplier(String id);

  /// `PATCH /api/v1/suppliers/{id}` (`supplier.manage`) — no `If-Match`:
  /// see this file's own doc comment on why suppliers carry no `version`.
  Future<PosSupplier> updateSupplier(String id, PosSupplierInput input);

  /// `POST /api/v1/suppliers/{id}/deactivate` (`supplier.manage`) — never
  /// a hard delete; the backend itself treats this as a thin wrapper over
  /// `updateSupplier(id, {status: 'inactive'})`, never a second code path.
  Future<PosSupplier> deactivateSupplier(String id);
}

class ApiPosSuppliersGateway implements PosSuppliersGateway {
  const ApiPosSuppliersGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosSupplier> createSupplier(PosSupplierInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/suppliers',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosSupplierPage> listSuppliers({String? cursor, int limit = 50, String? status}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (status != null) 'status': status,
    };
    final path = Uri(path: '/api/v1/suppliers', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing suppliers list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosSupplierPage(
      items: data.whereType<Map<String, Object?>>().map(PosSupplier.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosSupplier> supplier(String id) async {
    final envelope = await _client.getJson('/api/v1/suppliers/$id');
    return _decode(envelope);
  }

  @override
  Future<PosSupplier> updateSupplier(String id, PosSupplierInput input) async {
    final envelope = await _client.patchJson('/api/v1/suppliers/$id', body: input.toJson());
    return _decode(envelope);
  }

  @override
  Future<PosSupplier> deactivateSupplier(String id) async {
    final envelope = await _client.postJson('/api/v1/suppliers/$id/deactivate');
    return _decode(envelope);
  }

  static String _idempotencyKey() => 'one-supplier-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosSupplier _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing supplier data.');
    }
    return PosSupplier.fromJson(data);
  }
}

class EmptyPosSuppliersGateway implements PosSuppliersGateway {
  const EmptyPosSuppliersGateway();

  @override
  Future<PosSupplier> createSupplier(PosSupplierInput input) =>
      Future.error(StateError('No suppliers gateway is configured.'));

  @override
  Future<PosSupplierPage> listSuppliers({String? cursor, int limit = 50, String? status}) async =>
      const PosSupplierPage(items: [], nextCursor: null);

  @override
  Future<PosSupplier> supplier(String id) => Future.error(StateError('No suppliers gateway is configured.'));

  @override
  Future<PosSupplier> updateSupplier(String id, PosSupplierInput input) =>
      Future.error(StateError('No suppliers gateway is configured.'));

  @override
  Future<PosSupplier> deactivateSupplier(String id) =>
      Future.error(StateError('No suppliers gateway is configured.'));
}
