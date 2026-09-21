/// TASK 16.15 — the Flutter side of `operational-areas.routes.ts`
/// (`GET/POST /api/v1/operational-areas`, `GET/PUT /api/v1/operational-
/// areas/{id}`), gated by `operational_area.read`/`operational_area.manage`.
///
/// An "operational area" is a TENANT-DEFINED grouping of cash registers
/// (e.g. one tenant's own "Admisiones/Alimentos/Eventos", another's
/// "Taquilla/Cafetería/Eventos") — [PosOperationalArea.name]/[code] are
/// always operator-entered data read straight off the backend response;
/// nothing in this file (or any caller of it) may ever hardcode a
/// tenant-specific area name.
///
/// Styled after `pos_category_admin_gateway.dart` (abstract interface +
/// `Api...`/`Empty...` implementations, `PosX`/`PosXPage` model classes
/// with `fromJson`, real `version`/`If-Match` optimistic concurrency,
/// cursor-paginated list) — the two backend contracts are structurally
/// identical (`operational_area.manage` mirrors `category.manage` exactly,
/// down to the same `PUT .../{id}` + `if-match` shape), so this gateway
/// mirrors that one's exact conventions rather than inventing new ones.
/// Diverges only where the real contract itself does:
///   * `branch_id` is required on create and present on every row (an
///     operational area always belongs to exactly one branch) — a category
///     has no such scoping.
///   * The list route accepts an optional `branch_id` filter (categories'
///     own list route does not) — see [PosOperationalAreasGateway.
///     listAreas]'s own doc comment.
///   * `POST` requires `Idempotency-Key` (ADR-0005) exactly like every
///     other creation route in this app; `PUT` requires `If-Match` carrying
///     the row's own [PosOperationalArea.version] (optimistic concurrency)
///     — mirrors `pos_category_admin_gateway.dart`'s exact split.
library;

import '../../core/networking/api_client.dart';

/// An `operational_areas` row — the FULL record, returned identically by
/// `GET /operational-areas`, `POST /operational-areas`, `GET
/// /operational-areas/{id}`, and `PUT /operational-areas/{id}`.
class PosOperationalArea {
  const PosOperationalArea({
    required this.id,
    required this.branchId,
    required this.code,
    required this.name,
    required this.status,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosOperationalArea.fromJson(Map<String, Object?> json) => PosOperationalArea(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    status: json['status']! as String,
    version: json['version']! as int,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String branchId;
  final String code;

  /// Operator-entered display label — e.g. "Taquilla", "Admisiones",
  /// "Snacks" for one tenant, something entirely different for another.
  /// Never hardcode a specific value anywhere a caller consumes this.
  final String name;

  /// `active` | `inactive` (`operational_areas_status_ck`).
  final String status;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
}

class PosOperationalAreaPage {
  const PosOperationalAreaPage({required this.items, required this.nextCursor});
  final List<PosOperationalArea> items;
  final String? nextCursor;
}

/// The create/update input both `POST /operational-areas` and
/// `PUT /operational-areas/{id}` accept. `branchId`/`code`/`name` are only
/// backend-required on create (`operational-areas.routes.ts`'s own create
/// body schema requires all three; the update body schema accepts only
/// `name`/`status`) — the caller-side form is responsible for enforcing
/// that before calling [PosOperationalAreasGateway.createArea]. `code` is
/// never sent on an update — the update route schema has no such property
/// at all, exactly like `pos_category_admin_gateway.dart`'s own
/// immutable-`code`-after-creation convention.
class PosOperationalAreaInput {
  const PosOperationalAreaInput({this.branchId, this.code, this.name, this.status});

  final String? branchId;
  final String? code;
  final String? name;

  /// `active` | `inactive`.
  final String? status;

  Map<String, Object?> toJson() => {
    if (branchId != null) 'branch_id': branchId,
    if (code != null) 'code': code,
    if (name != null) 'name': name,
    if (status != null) 'status': status,
  };
}

abstract interface class PosOperationalAreasGateway {
  /// `GET /api/v1/operational-areas` (`operational_area.read`). [branchId]
  /// is an honest server-side filter (unlike `pos_category_admin_gateway
  /// .dart`'s `listCategories`, which has none) — omit it to see every
  /// operational area across every branch this caller can read.
  Future<PosOperationalAreaPage> listAreas({
    String? branchId,
    String? status,
    String? cursor,
    int limit = 50,
  });

  /// `POST /api/v1/operational-areas` (`operational_area.manage`) —
  /// requires `Idempotency-Key` (ADR-0005); throws [ApiException] honestly
  /// on any rejection.
  Future<PosOperationalArea> createArea(PosOperationalAreaInput input);

  /// `GET /api/v1/operational-areas/{id}` (`operational_area.read`).
  Future<PosOperationalArea> area(String id);

  /// `PUT /api/v1/operational-areas/{id}` (`operational_area.manage`) —
  /// requires `If-Match` carrying the area's own current [version]
  /// (optimistic concurrency); throws [ApiException] honestly, including a
  /// 409 on a stale version.
  Future<PosOperationalArea> updateArea(String id, int version, PosOperationalAreaInput input);
}

class ApiPosOperationalAreasGateway implements PosOperationalAreasGateway {
  const ApiPosOperationalAreasGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosOperationalAreaPage> listAreas({
    String? branchId,
    String? status,
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final path = Uri(path: '/api/v1/operational-areas', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing operational areas list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosOperationalAreaPage(
      items: data.whereType<Map<String, Object?>>().map(PosOperationalArea.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosOperationalArea> createArea(PosOperationalAreaInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/operational-areas',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosOperationalArea> area(String id) async {
    final envelope = await _client.getJson('/api/v1/operational-areas/$id');
    return _decode(envelope);
  }

  @override
  Future<PosOperationalArea> updateArea(String id, int version, PosOperationalAreaInput input) async {
    final envelope = await _client.putJson(
      '/api/v1/operational-areas/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  static String _idempotencyKey() =>
      'one-operational-area-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosOperationalArea _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing operational area data.');
    }
    return PosOperationalArea.fromJson(data);
  }
}

class EmptyPosOperationalAreasGateway implements PosOperationalAreasGateway {
  const EmptyPosOperationalAreasGateway();

  @override
  Future<PosOperationalAreaPage> listAreas({
    String? branchId,
    String? status,
    String? cursor,
    int limit = 50,
  }) async => const PosOperationalAreaPage(items: [], nextCursor: null);

  @override
  Future<PosOperationalArea> createArea(PosOperationalAreaInput input) =>
      Future.error(StateError('No operational areas gateway is configured.'));

  @override
  Future<PosOperationalArea> area(String id) =>
      Future.error(StateError('No operational areas gateway is configured.'));

  @override
  Future<PosOperationalArea> updateArea(String id, int version, PosOperationalAreaInput input) =>
      Future.error(StateError('No operational areas gateway is configured.'));
}
