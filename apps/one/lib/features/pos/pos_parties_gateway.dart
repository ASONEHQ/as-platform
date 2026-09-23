import '../../core/networking/api_client.dart';
import 'pos_parties_models.dart';

/// TASK 14.3 (Wave 1, Part A): the Flutter API client for the "Fiestas"
/// domain — one method per real, already-tested route in
/// `apps/api/src/modules/parties/` (`party-rooms.routes.ts`,
/// `party-packages.routes.ts`, `party-reservations.routes.ts`). Styled
/// after `pos_customers_gateway.dart`/`pos_memberships_gateway.dart` —
/// same HTTP/error-handling/auth-header conventions, same
/// `ApiPos*Gateway`/`EmptyPos*Gateway` split.

/// Maps a party-domain [ApiException] to an honest, specific Spanish
/// message — never the generic/possibly-wrong shared text for a code
/// whose shared mapping means something else in another domain (e.g.
/// `resource_conflict` is refund-scoped in `core/errors/app_error.dart`).
/// [fallback] is used for a code this function doesn't special-case, and
/// otherwise defaults to the shared [ApiException.failure]'s own message.
/// A 409 `party_conflict` (room double-booking, recovery doc Capability
/// 2) always surfaces here — never silently retried, never replaced by a
/// generic failure message.
String posPartyErrorMessage(ApiException error, {String? fallback}) {
  switch (error.failure.code) {
    case 'party_conflict':
      return 'Ese salón ya tiene una reservación en un horario que se traslapa con la fecha y hora elegidas.';
    case 'invalid_reservation_state':
      return 'Esa reservación no puede cambiar a ese estado desde su estado actual.';
    case 'insufficient_inventory':
      return 'No hay inventario suficiente para descontar esas calcetas.';
    case 'inventory_location_not_found':
      return 'No se encontró una ubicación de inventario válida para esa talla.';
    // TASK 16.19 — capacity/eligibility are honest "this can't be booked
    // as requested" rejections, never a generic/misleading message.
    case 'capacity_exceeded':
      return 'El número de invitados excede el aforo del salón o del paquete seleccionado.';
    case 'package_room_not_eligible':
      return 'Este paquete no está disponible para el salón seleccionado.';
    // TASK 16.20 (Part L1) — honest, specific coupon rejections.
    case 'coupon_inactive':
      return 'Este cupón no está activo (puede estar desactivado, aún no vigente, o ya vencido).';
    case 'coupon_min_subtotal_not_met':
      return 'El subtotal de esta reservación no alcanza el mínimo requerido por el cupón.';
    case 'coupon_usage_limit_reached':
      return 'Este cupón ya alcanzó su límite de usos.';
    case 'resource_conflict':
      return fallback ?? 'La operación no se pudo completar porque el recurso está en un estado inesperado.';
    default:
      return fallback ?? error.failure.message;
  }
}

abstract interface class PosPartiesGateway {
  // --- Rooms (Salones) ---------------------------------------------------

  /// `POST /api/v1/party-rooms` (`party.manage`).
  Future<PosPartyRoom> createRoom(PosPartyRoomInput input);

  /// `GET /api/v1/party-rooms` (`party.read`).
  Future<PosPartyPage<PosPartyRoom>> listRooms({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
  });

  /// `GET /api/v1/party-rooms/{id}` (`party.read`).
  Future<PosPartyRoom> room(String id);

  /// `PATCH /api/v1/party-rooms/{id}` (`party.manage`) — [version] is the
  /// row's own already-fetched `version`, sent as the strong `If-Match`.
  Future<PosPartyRoom> updateRoom(String id, PosPartyRoomInput input, {required int version});

  // --- Packages (Paquetes) ------------------------------------------------

  /// `POST /api/v1/party-packages` (`party.manage`).
  Future<PosPartyPackage> createPackage(PosPartyPackageInput input);

  /// `GET /api/v1/party-packages` (`party.read`).
  Future<PosPartyPage<PosPartyPackage>> listPackages({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
  });

  /// `GET /api/v1/party-packages/{id}` (`party.read`).
  Future<PosPartyPackage> packageRow(String id);

  /// `PATCH /api/v1/party-packages/{id}` (`party.manage`).
  Future<PosPartyPackage> updatePackage(String id, PosPartyPackageInput input, {required int version});

  /// `POST /api/v1/party-packages/{id}/quote` (`party.read`) — the
  /// Cotizador's ONE source of truth for a computed breakdown; a pure
  /// read, never persists anything server-side either.
  Future<PosPartyQuote> quotePackage(String id, {int children = 0, int adults = 0, int extraHalfHours = 0});

  // --- Reservations --------------------------------------------------------

  /// `POST /api/v1/party-reservations` (`party.manage`). A 409
  /// `party_conflict` surfaces honestly via [posPartyErrorMessage] — never
  /// silently retried.
  Future<PosPartyReservation> createReservation(PosPartyReservationInput input);

  /// `GET /api/v1/party-reservations` (`party.read`).
  Future<PosPartyPage<PosPartyReservation>> listReservations({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
    String? roomId,
    String? customerId,
    String? sellerUserId,
    String? eventDateFrom,
    String? eventDateTo,
  });

  /// `GET /api/v1/party-reservations/calendar` (`party.read`) — the exact
  /// same underlying data as [listReservations], reduced to the
  /// calendar's own projection; every Calendario sub-view (Mes/Semana/Día/
  /// Lista) reads from this one call over a different date range.
  ///
  /// TASK 16.22 — `limit`'s default must not exceed the route's own
  /// querystring schema maximum (`party-reservations.routes.ts`'s shared
  /// `listQuerystring.limit`, capped at 100); a higher client default was
  /// live-caught rejecting every calendar load with a 400 `validation_error`
  /// before a single reservation could ever render.
  Future<List<PosPartyCalendarEntry>> calendar({
    required String from,
    required String to,
    int limit = 100,
    String? branchId,
    String? status,
    String? roomId,
    String? sellerUserId,
  });

  /// `GET /api/v1/party-reservations/availability` (`party.read`) — TASK
  /// 16.22: given a package/date/start-time (+ optional guest counts/
  /// extra half-hours), returns every ELIGIBLE room's live availability
  /// (conflict/capacity-checked, backend-authoritative), plus the real
  /// computed `end_time`. The Cotizador's live room picker; never trusted
  /// as the actual booking gate — [createReservation] independently
  /// re-validates before ever committing.
  Future<PosPartyRoomAvailabilityResult> availableRooms({
    required String branchId,
    required String packageId,
    required String eventDate,
    required String startTime,
    int? children,
    int? adults,
    int? extraHalfHours,
    String? excludeReservationId,
  });

  /// `GET /api/v1/party-reservations/{id}` (`party.read`).
  Future<PosPartyReservationDetail> reservationDetail(String id);

  /// `PATCH /api/v1/party-reservations/{id}` (`party.manage`).
  Future<PosPartyReservation> updateReservation(String id, PosPartyReservationInput input, {required int version});

  /// `POST /api/v1/party-reservations/{id}/status` (`party.manage`) — the
  /// caller must only ever offer a `newStatus` present in
  /// `partyReservationTransitions[current]` (see `pos_parties_models.dart`)
  /// so an invalid jump is never even attempted.
  Future<PosPartyReservation> transitionStatus(String id, String newStatus, {required int version});

  /// `POST /api/v1/party-reservations/{id}/cancellations`
  /// (`party.cancel`) — [reasonCode] is required by the backend schema.
  Future<PosPartyCancellationResult> cancelReservation(String id, {required String reasonCode, required int version});

  // --- Coupon (TASK 16.20 Part L1) ------------------------------------------

  /// `POST /api/v1/party-reservations/{id}/coupon` (`party.manage`) —
  /// applies a real, backend-validated coupon from the platform's own
  /// coupons catalog; recomputes discount/tax/total server-side.
  Future<PosPartyReservation> applyCoupon(String reservationId, String code);

  /// `DELETE /api/v1/party-reservations/{id}/coupon` (`party.manage`).
  Future<PosPartyReservation> removeCoupon(String reservationId);

  // --- Snacks --------------------------------------------------------------

  /// `POST /api/v1/party-reservations/{id}/snacks` (`party.manage`).
  Future<PosPartySnack> addSnack(String reservationId, PosPartySnackInput input);

  /// `GET /api/v1/party-reservations/{id}/snacks` (`party.read`).
  Future<List<PosPartySnack>> listSnacks(String reservationId);

  /// `POST /api/v1/party-reservations/{id}/snacks/{snackId}/deduct`
  /// (`party.manage`) — TASK 16.20, the snack/drink mirror of [deductSock]:
  /// a real, one-way stock deduction, backend-guarded against
  /// double-deduction. [issuedQuantity] overrides the planned quantity
  /// (e.g. the package included 25, only 20 were actually handed out);
  /// omit to issue exactly the planned amount.
  Future<PosPartySnack> deductSnack(String reservationId, String snackId, {String? issuedQuantity});

  /// `POST /api/v1/party-reservations/{id}/snacks/{snackId}/correct`
  /// (`party.manage`) — TASK 16.20A: a real, compensating-ledger
  /// correction for an already-delivered snack line. [correctedQuantity]
  /// is the ACTUAL correct amount (never a delta) — the backend computes
  /// the real delta itself, from its own fresh, locked read, which is
  /// what makes an identical retry safely idempotent.
  Future<PosPartySnack> correctSnack(String reservationId, String snackId, {required String correctedQuantity});

  // --- Socks -----------------------------------------------------------------

  /// `POST /api/v1/party-reservations/{id}/socks` (`party.manage`).
  Future<PosPartySock> addSock(String reservationId, PosPartySockInput input);

  /// `GET /api/v1/party-reservations/{id}/socks` (`party.read`).
  Future<List<PosPartySock>> listSocks(String reservationId);

  /// `POST /api/v1/party-reservations/{id}/socks/{sockId}/deduct`
  /// (`party.manage`) — a real, one-way stock deduction (recovery doc
  /// Capability 11); the backend itself guards against double-deduction.
  /// [issuedQuantity] overrides the planned quantity (TASK 16.20 — e.g. a
  /// package included 25 socks, only 23 children attended); omit to issue
  /// exactly the planned amount (pre-16.20 behavior).
  Future<PosPartySock> deductSock(String reservationId, String sockId, {int? issuedQuantity});

  /// `POST /api/v1/party-reservations/{id}/socks/{sockId}/correct`
  /// (`party.manage`) — TASK 16.20A: the sock mirror of [correctSnack].
  Future<PosPartySock> correctSock(String reservationId, String sockId, {required int correctedQuantity});

  // --- Payments / balance ------------------------------------------------------

  /// `POST /api/v1/party-reservations/{id}/payments`
  /// (`party.payment.record`).
  Future<PosPartyPayment> recordPayment(
    String reservationId, {
    required String purpose,
    required String amount,
    required String cashSessionId,
  });

  /// `GET /api/v1/party-reservations/{id}/balance` (`party.read`).
  Future<PosPartyBalance> balance(String reservationId);

  // --- Documents -----------------------------------------------------------------

  /// `GET /api/v1/party-reservations/{id}/documents/{type}` (`party.read`)
  /// — [type] is `waiver` | `contract`. Returns the real, server-generated
  /// HTML document as text (never JSON) — the caller displays/prints it,
  /// e.g. via `openReceiptPrintWindow` (`receipt_print.dart`).
  Future<String> generateDocument(String reservationId, String type);
}

class ApiPosPartiesGateway implements PosPartiesGateway {
  const ApiPosPartiesGateway(this._client);

  final ApiClient _client;

  @override
  Future<PosPartyRoom> createRoom(PosPartyRoomInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/party-rooms',
      idempotencyKey: _idempotencyKey('room'),
      body: input.toJson(),
    );
    return _decodeRoom(envelope);
  }

  @override
  Future<PosPartyPage<PosPartyRoom>> listRooms({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final path = Uri(path: '/api/v1/party-rooms', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    return _decodePage(envelope, PosPartyRoom.fromJson);
  }

  @override
  Future<PosPartyRoom> room(String id) async {
    final envelope = await _client.getJson('/api/v1/party-rooms/$id');
    return _decodeRoom(envelope);
  }

  @override
  Future<PosPartyRoom> updateRoom(String id, PosPartyRoomInput input, {required int version}) async {
    final envelope = await _client.patchJson(
      '/api/v1/party-rooms/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodeRoom(envelope);
  }

  @override
  Future<PosPartyPackage> createPackage(PosPartyPackageInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/party-packages',
      idempotencyKey: _idempotencyKey('package'),
      body: input.toJson(),
    );
    return _decodePackage(envelope);
  }

  @override
  Future<PosPartyPage<PosPartyPackage>> listPackages({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final path = Uri(path: '/api/v1/party-packages', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    return _decodePage(envelope, PosPartyPackage.fromJson);
  }

  @override
  Future<PosPartyPackage> packageRow(String id) async {
    final envelope = await _client.getJson('/api/v1/party-packages/$id');
    return _decodePackage(envelope);
  }

  @override
  Future<PosPartyPackage> updatePackage(String id, PosPartyPackageInput input, {required int version}) async {
    final envelope = await _client.patchJson(
      '/api/v1/party-packages/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodePackage(envelope);
  }

  @override
  Future<PosPartyQuote> quotePackage(String id, {int children = 0, int adults = 0, int extraHalfHours = 0}) async {
    final envelope = await _client.postJson(
      '/api/v1/party-packages/$id/quote',
      body: {'children': children, 'adults': adults, 'extra_half_hours': extraHalfHours},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing quote data.');
    }
    return PosPartyQuote.fromJson(data);
  }

  @override
  Future<PosPartyReservation> createReservation(PosPartyReservationInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations',
      idempotencyKey: _idempotencyKey('reservation'),
      body: input.toJson(),
    );
    return _decodeReservation(envelope);
  }

  @override
  Future<PosPartyPage<PosPartyReservation>> listReservations({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
    String? roomId,
    String? customerId,
    String? sellerUserId,
    String? eventDateFrom,
    String? eventDateTo,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
      if (roomId != null) 'room_id': roomId,
      if (customerId != null) 'customer_id': customerId,
      if (sellerUserId != null) 'seller_user_id': sellerUserId,
      if (eventDateFrom != null) 'event_date_from': eventDateFrom,
      if (eventDateTo != null) 'event_date_to': eventDateTo,
    };
    final path = Uri(path: '/api/v1/party-reservations', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    return _decodePage(envelope, PosPartyReservation.fromJson);
  }

  @override
  Future<List<PosPartyCalendarEntry>> calendar({
    required String from,
    required String to,
    int limit = 100,
    String? branchId,
    String? status,
    String? roomId,
    String? sellerUserId,
  }) async {
    final query = <String, String>{
      'from': from,
      'to': to,
      'limit': '$limit',
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
      if (roomId != null) 'room_id': roomId,
      if (sellerUserId != null) 'seller_user_id': sellerUserId,
    };
    final path = Uri(path: '/api/v1/party-reservations/calendar', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing calendar data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosPartyCalendarEntry.fromJson).toList(growable: false);
  }

  @override
  Future<PosPartyRoomAvailabilityResult> availableRooms({
    required String branchId,
    required String packageId,
    required String eventDate,
    required String startTime,
    int? children,
    int? adults,
    int? extraHalfHours,
    String? excludeReservationId,
  }) async {
    final query = <String, String>{
      'branch_id': branchId,
      'package_id': packageId,
      'event_date': eventDate,
      'start_time': startTime,
      if (children != null) 'children': '$children',
      if (adults != null) 'adults': '$adults',
      if (extraHalfHours != null) 'extra_half_hours': '$extraHalfHours',
      if (excludeReservationId != null) 'exclude_reservation_id': excludeReservationId,
    };
    final path = Uri(path: '/api/v1/party-reservations/availability', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing availability data.');
    }
    return PosPartyRoomAvailabilityResult.fromJson(data);
  }

  @override
  Future<PosPartyReservationDetail> reservationDetail(String id) async {
    final envelope = await _client.getJson('/api/v1/party-reservations/$id');
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing reservation data.');
    }
    return PosPartyReservationDetail.fromJson(data);
  }

  @override
  Future<PosPartyReservation> updateReservation(String id, PosPartyReservationInput input, {required int version}) async {
    final envelope = await _client.patchJson(
      '/api/v1/party-reservations/$id',
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    return _decodeReservation(envelope);
  }

  @override
  Future<PosPartyReservation> transitionStatus(String id, String newStatus, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$id/status',
      idempotencyKey: _idempotencyKey('status'),
      ifMatch: '"$version"',
      body: {'status': newStatus},
    );
    return _decodeReservation(envelope);
  }

  @override
  Future<PosPartyCancellationResult> cancelReservation(String id, {required String reasonCode, required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$id/cancellations',
      idempotencyKey: _idempotencyKey('cancel'),
      ifMatch: '"$version"',
      body: {'reason_code': reasonCode},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing cancellation data.');
    }
    return PosPartyCancellationResult.fromJson(data);
  }

  @override
  Future<PosPartyReservation> applyCoupon(String reservationId, String code) async {
    final envelope = await _client.postJson('/api/v1/party-reservations/$reservationId/coupon', body: {'code': code});
    return _decodeReservation(envelope);
  }

  @override
  Future<PosPartyReservation> removeCoupon(String reservationId) async {
    final envelope = await _client.deleteJson('/api/v1/party-reservations/$reservationId/coupon');
    return _decodeReservation(envelope);
  }

  @override
  Future<PosPartySnack> addSnack(String reservationId, PosPartySnackInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$reservationId/snacks',
      body: input.toJson(),
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing snack data.');
    }
    return PosPartySnack.fromJson(data);
  }

  @override
  Future<List<PosPartySnack>> listSnacks(String reservationId) async {
    final envelope = await _client.getJson('/api/v1/party-reservations/$reservationId/snacks');
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing snacks data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosPartySnack.fromJson).toList(growable: false);
  }

  @override
  Future<PosPartySnack> deductSnack(String reservationId, String snackId, {String? issuedQuantity}) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$reservationId/snacks/$snackId/deduct',
      body: issuedQuantity == null ? const {} : {'issued_quantity': issuedQuantity},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing snack data.');
    }
    return PosPartySnack.fromJson(data);
  }

  @override
  Future<PosPartySnack> correctSnack(String reservationId, String snackId, {required String correctedQuantity}) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$reservationId/snacks/$snackId/correct',
      body: {'corrected_quantity': correctedQuantity},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing snack data.');
    }
    return PosPartySnack.fromJson(data);
  }

  @override
  Future<PosPartySock> addSock(String reservationId, PosPartySockInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$reservationId/socks',
      body: input.toJson(),
    );
    return _decodeSock(envelope);
  }

  @override
  Future<List<PosPartySock>> listSocks(String reservationId) async {
    final envelope = await _client.getJson('/api/v1/party-reservations/$reservationId/socks');
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing socks data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosPartySock.fromJson).toList(growable: false);
  }

  @override
  Future<PosPartySock> deductSock(String reservationId, String sockId, {int? issuedQuantity}) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$reservationId/socks/$sockId/deduct',
      body: issuedQuantity == null ? const {} : {'issued_quantity': issuedQuantity},
    );
    return _decodeSock(envelope);
  }

  @override
  Future<PosPartySock> correctSock(String reservationId, String sockId, {required int correctedQuantity}) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$reservationId/socks/$sockId/correct',
      body: {'corrected_quantity': correctedQuantity},
    );
    return _decodeSock(envelope);
  }

  @override
  Future<PosPartyPayment> recordPayment(
    String reservationId, {
    required String purpose,
    required String amount,
    required String cashSessionId,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/party-reservations/$reservationId/payments',
      idempotencyKey: _idempotencyKey('payment'),
      body: {'purpose': purpose, 'amount': amount, 'cash_session_id': cashSessionId},
    );
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing payment data.');
    }
    return PosPartyPayment.fromJson(data);
  }

  @override
  Future<PosPartyBalance> balance(String reservationId) async {
    final envelope = await _client.getJson('/api/v1/party-reservations/$reservationId/balance');
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing balance data.');
    }
    return PosPartyBalance.fromJson(data);
  }

  @override
  Future<String> generateDocument(String reservationId, String type) =>
      _client.getText('/api/v1/party-reservations/$reservationId/documents/$type');

  static String _idempotencyKey(String kind) => 'one-party-$kind-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  PosPartyRoom _decodeRoom(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing room data.');
    }
    return PosPartyRoom.fromJson(data);
  }

  PosPartyPackage _decodePackage(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing package data.');
    }
    return PosPartyPackage.fromJson(data);
  }

  PosPartyReservation _decodeReservation(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing reservation data.');
    }
    return PosPartyReservation.fromJson(data);
  }

  PosPartySock _decodeSock(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing sock data.');
    }
    return PosPartySock.fromJson(data);
  }

  PosPartyPage<T> _decodePage<T>(Map<String, Object?> envelope, T Function(Map<String, Object?>) fromJson) {
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing page data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosPartyPage<T>(
      items: data.whereType<Map<String, Object?>>().map(fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }
}

class EmptyPosPartiesGateway implements PosPartiesGateway {
  const EmptyPosPartiesGateway();

  @override
  Future<PosPartyRoom> createRoom(PosPartyRoomInput input) => Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyPage<PosPartyRoom>> listRooms({String? cursor, int limit = 50, String? branchId, String? status}) async =>
      const PosPartyPage(items: [], nextCursor: null);

  @override
  Future<PosPartyRoom> room(String id) => Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyRoom> updateRoom(String id, PosPartyRoomInput input, {required int version}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyPackage> createPackage(PosPartyPackageInput input) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyPage<PosPartyPackage>> listPackages({String? cursor, int limit = 50, String? branchId, String? status}) async =>
      const PosPartyPage(items: [], nextCursor: null);

  @override
  Future<PosPartyPackage> packageRow(String id) => Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyPackage> updatePackage(String id, PosPartyPackageInput input, {required int version}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyQuote> quotePackage(String id, {int children = 0, int adults = 0, int extraHalfHours = 0}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyReservation> createReservation(PosPartyReservationInput input) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyPage<PosPartyReservation>> listReservations({
    String? cursor,
    int limit = 50,
    String? branchId,
    String? status,
    String? roomId,
    String? customerId,
    String? sellerUserId,
    String? eventDateFrom,
    String? eventDateTo,
  }) async => const PosPartyPage(items: [], nextCursor: null);

  @override
  Future<List<PosPartyCalendarEntry>> calendar({
    required String from,
    required String to,
    int limit = 100,
    String? branchId,
    String? status,
    String? roomId,
    String? sellerUserId,
  }) async => const [];

  @override
  Future<PosPartyRoomAvailabilityResult> availableRooms({
    required String branchId,
    required String packageId,
    required String eventDate,
    required String startTime,
    int? children,
    int? adults,
    int? extraHalfHours,
    String? excludeReservationId,
  }) => Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyReservationDetail> reservationDetail(String id) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyReservation> updateReservation(String id, PosPartyReservationInput input, {required int version}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyReservation> transitionStatus(String id, String newStatus, {required int version}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyCancellationResult> cancelReservation(String id, {required String reasonCode, required int version}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyReservation> applyCoupon(String reservationId, String code) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyReservation> removeCoupon(String reservationId) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartySnack> addSnack(String reservationId, PosPartySnackInput input) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<List<PosPartySnack>> listSnacks(String reservationId) async => const [];

  @override
  Future<PosPartySnack> deductSnack(String reservationId, String snackId, {String? issuedQuantity}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartySnack> correctSnack(String reservationId, String snackId, {required String correctedQuantity}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartySock> addSock(String reservationId, PosPartySockInput input) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<List<PosPartySock>> listSocks(String reservationId) async => const [];

  @override
  Future<PosPartySock> deductSock(String reservationId, String sockId, {int? issuedQuantity}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartySock> correctSock(String reservationId, String sockId, {required int correctedQuantity}) =>
      Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyPayment> recordPayment(
    String reservationId, {
    required String purpose,
    required String amount,
    required String cashSessionId,
  }) => Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<PosPartyBalance> balance(String reservationId) => Future.error(StateError('No parties gateway is configured.'));

  @override
  Future<String> generateDocument(String reservationId, String type) =>
      Future.error(StateError('No parties gateway is configured.'));
}
