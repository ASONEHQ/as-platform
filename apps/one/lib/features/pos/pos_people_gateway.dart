/// TASK 14.4 (Wave 2): the Flutter side of the "People" domain (Empleados/
/// Horarios/Checador/Nómina) — see `apps/api/src/modules/people/
/// people.types.ts` for the exact backend contract this mirrors. One file,
/// four small interface groups (`PosEmployeesGateway`/`PosSchedulesGateway`/
/// `PosTimeClockGateway`/`PosPayrollGateway`), matching the backend's own
/// choice to keep one shared `people` module rather than four separate
/// top-level modules — styled after `pos_customers_gateway.dart`/
/// `pos_held_sales_gateway.dart` (the most recent prior gateways of this
/// shape).
library;

import '../../core/networking/api_client.dart';

// ---------------------------------------------------------------------
// Empleados
// ---------------------------------------------------------------------

/// An `employees` row (`EmployeeRow`/`employeeHttp` in
/// `employees.routes.ts`) — the FULL record. [version] is the backend's
/// `bigint` sent over the wire as a numeric string (`value.version.
/// toString()`), parsed here as an [int] exactly like every other
/// strong-`If-Match` resource in this app (`PosCustomer.version`).
class PosEmployee {
  const PosEmployee({
    required this.id,
    required this.branchId,
    required this.code,
    required this.displayName,
    required this.phone,
    required this.email,
    required this.jobTitle,
    required this.status,
    required this.hireDate,
    required this.weeklySalary,
    required this.currencyCode,
    required this.userId,
    required this.notes,
    required this.deactivatedAt,
    required this.deactivatedBy,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosEmployee.fromJson(Map<String, Object?> json) => PosEmployee(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    code: json['code']! as String,
    displayName: json['display_name']! as String,
    phone: json['phone'] as String?,
    email: json['email'] as String?,
    jobTitle: json['job_title'] as String?,
    status: json['status']! as String,
    hireDate: json['hire_date'] as String?,
    weeklySalary: json['weekly_salary']! as String,
    currencyCode: json['currency_code']! as String,
    userId: json['user_id'] as String?,
    notes: json['notes'] as String?,
    deactivatedAt: json['deactivated_at'] == null ? null : DateTime.parse(json['deactivated_at']! as String),
    deactivatedBy: json['deactivated_by'] as String?,
    version: int.parse(json['version']! as String),
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String branchId;
  final String code;
  final String displayName;
  final String? phone;
  final String? email;
  final String? jobTitle;

  /// `active` | `inactive` (`employeeStatuses`) — never a project-invented
  /// 3rd state.
  final String status;

  /// `YYYY-MM-DD`, never parsed into a [DateTime] here (a plain calendar
  /// date has no time zone to guess) — mirrors `PosCustomer.birthDate`.
  final String? hireDate;
  final String weeklySalary;
  final String currencyCode;
  final String? userId;
  final String? notes;
  final DateTime? deactivatedAt;
  final String? deactivatedBy;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isActive => status == 'active';
}

class PosEmployeePage {
  const PosEmployeePage({required this.items, required this.nextCursor});
  final List<PosEmployee> items;
  final String? nextCursor;
}

/// `POST /api/v1/employees` body — every field `employees.routes.ts`
/// accepts. [id] lets the caller pre-generate a client-side id, exactly
/// like every other creation gateway in this app.
class PosEmployeeCreateInput {
  const PosEmployeeCreateInput({
    this.id,
    required this.branchId,
    required this.code,
    required this.displayName,
    this.phone,
    this.email,
    this.jobTitle,
    this.hireDate,
    required this.weeklySalary,
    required this.currencyCode,
    this.userId,
    this.notes,
  });

  final String? id;
  final String branchId;
  final String code;
  final String displayName;
  final String? phone;
  final String? email;
  final String? jobTitle;
  final String? hireDate;
  final String weeklySalary;
  final String currencyCode;
  final String? userId;
  final String? notes;

  Map<String, Object?> toJson() => {
    if (id != null) 'id': id,
    'branch_id': branchId,
    'code': code,
    'display_name': displayName,
    'phone': phone,
    'email': email,
    'job_title': jobTitle,
    'hire_date': hireDate,
    'weekly_salary': weeklySalary,
    'currency_code': currencyCode,
    'user_id': userId,
    'notes': notes,
  };
}

/// `PUT /api/v1/employees/{id}` body — every field is optional (a partial
/// update), matching the backend's own `UpdateEmployeeInput` exactly.
class PosEmployeeUpdateInput {
  const PosEmployeeUpdateInput({
    this.displayName,
    this.phone,
    this.email,
    this.jobTitle,
    this.hireDate,
    this.weeklySalary,
    this.currencyCode,
    this.userId,
    this.notes,
  });

  final String? displayName;
  final String? phone;
  final String? email;
  final String? jobTitle;
  final String? hireDate;
  final String? weeklySalary;
  final String? currencyCode;
  final String? userId;
  final String? notes;

  Map<String, Object?> toJson() => {
    if (displayName != null) 'display_name': displayName,
    if (phone != null) 'phone': phone,
    if (email != null) 'email': email,
    if (jobTitle != null) 'job_title': jobTitle,
    if (hireDate != null) 'hire_date': hireDate,
    if (weeklySalary != null) 'weekly_salary': weeklySalary,
    if (currencyCode != null) 'currency_code': currencyCode,
    if (userId != null) 'user_id': userId,
    if (notes != null) 'notes': notes,
  };
}

abstract interface class PosEmployeesGateway {
  /// `POST /api/v1/employees` (`employee.manage`).
  Future<PosEmployee> createEmployee(PosEmployeeCreateInput input);

  /// `GET /api/v1/employees` (`employee.read`) — cursor-paginated, exactly
  /// like `pos_customers_gateway.dart`'s `listCustomers`. The backend
  /// supports no free-text `search` param (see `employees.routes.ts`'s own
  /// querystring schema) — a caller that wants to filter by name must do
  /// so client-side over the real, already-fetched page, never a
  /// fabricated server-side search.
  Future<PosEmployeePage> listEmployees({String? cursor, int limit = 50, String? branchId, String? status});

  /// `GET /api/v1/employees/{id}` (`employee.read`).
  Future<PosEmployee> employee(String id);

  /// `PUT /api/v1/employees/{id}` (`employee.manage`) — [version] is the
  /// row's own already-fetched `version`, sent as the strong `If-Match`.
  Future<PosEmployee> updateEmployee(String id, PosEmployeeUpdateInput input, {required int version});

  /// `POST /api/v1/employees/{id}/deactivate` (`employee.manage`).
  Future<PosEmployee> deactivateEmployee(String id);

  /// `POST /api/v1/employees/{id}/reactivate` (`employee.manage`).
  Future<PosEmployee> reactivateEmployee(String id);
}

class ApiPosEmployeesGateway implements PosEmployeesGateway {
  const ApiPosEmployeesGateway(this._client);
  final ApiClient _client;

  static String _idempotencyKey() => 'one-employee-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosEmployee> createEmployee(PosEmployeeCreateInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/employees',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosEmployeePage> listEmployees({String? cursor, int limit = 50, String? branchId, String? status}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final path = Uri(path: '/api/v1/employees', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing employees list data.');
    }
    final meta = envelope['meta'];
    final page = meta is Map<String, Object?> ? meta['page'] : null;
    final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
    return PosEmployeePage(
      items: data.whereType<Map<String, Object?>>().map(PosEmployee.fromJson).toList(growable: false),
      nextCursor: nextCursor,
    );
  }

  @override
  Future<PosEmployee> employee(String id) async {
    final envelope = await _client.getJson('/api/v1/employees/$id');
    return _decode(envelope);
  }

  @override
  Future<PosEmployee> updateEmployee(String id, PosEmployeeUpdateInput input, {required int version}) async {
    final envelope = await _client.putJson('/api/v1/employees/$id', ifMatch: '"$version"', body: input.toJson());
    return _decode(envelope);
  }

  @override
  Future<PosEmployee> deactivateEmployee(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/employees/$id/deactivate',
      idempotencyKey: _idempotencyKey(),
    );
    return _decode(envelope);
  }

  @override
  Future<PosEmployee> reactivateEmployee(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/employees/$id/reactivate',
      idempotencyKey: _idempotencyKey(),
    );
    return _decode(envelope);
  }

  PosEmployee _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing employee data.');
    }
    return PosEmployee.fromJson(data);
  }
}

class EmptyPosEmployeesGateway implements PosEmployeesGateway {
  const EmptyPosEmployeesGateway();

  @override
  Future<PosEmployee> createEmployee(PosEmployeeCreateInput input) =>
      Future.error(StateError('No employees gateway is configured.'));

  @override
  Future<PosEmployeePage> listEmployees({String? cursor, int limit = 50, String? branchId, String? status}) async =>
      const PosEmployeePage(items: [], nextCursor: null);

  @override
  Future<PosEmployee> employee(String id) => Future.error(StateError('No employees gateway is configured.'));

  @override
  Future<PosEmployee> updateEmployee(String id, PosEmployeeUpdateInput input, {required int version}) =>
      Future.error(StateError('No employees gateway is configured.'));

  @override
  Future<PosEmployee> deactivateEmployee(String id) =>
      Future.error(StateError('No employees gateway is configured.'));

  @override
  Future<PosEmployee> reactivateEmployee(String id) =>
      Future.error(StateError('No employees gateway is configured.'));
}

// ---------------------------------------------------------------------
// Horarios
// ---------------------------------------------------------------------

/// An `employee_schedules` row (`EmployeeScheduleRow`/`scheduleHttp` in
/// `schedules.routes.ts`). A day-off is `isDayOff=true` with BOTH times
/// `null` — never a fabricated `00:00`-`00:00` shift (mirrors the DB check
/// constraint the backend itself documents).
class PosEmployeeSchedule {
  const PosEmployeeSchedule({
    required this.id,
    required this.branchId,
    required this.employeeId,
    required this.workDate,
    required this.isDayOff,
    required this.scheduledStart,
    required this.scheduledEnd,
    required this.notes,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosEmployeeSchedule.fromJson(Map<String, Object?> json) => PosEmployeeSchedule(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    employeeId: json['employee_id']! as String,
    workDate: json['work_date']! as String,
    isDayOff: json['is_day_off']! as bool,
    scheduledStart: json['scheduled_start'] as String?,
    scheduledEnd: json['scheduled_end'] as String?,
    notes: json['notes'] as String?,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String branchId;
  final String employeeId;

  /// `YYYY-MM-DD`.
  final String workDate;
  final bool isDayOff;

  /// `HH:MM` or `HH:MM:SS`, exactly as the backend returns it.
  final String? scheduledStart;
  final String? scheduledEnd;
  final String? notes;
  final DateTime createdAt;
  final DateTime updatedAt;
}

/// `PUT /api/v1/schedules` body — a genuine upsert on `(employee,
/// work_date)`, see `schedules.service.ts`'s own doc comment. [id] lets a
/// caller target an already-known row explicitly; omitted on a fresh day.
class PosScheduleUpsertInput {
  const PosScheduleUpsertInput({
    this.id,
    required this.employeeId,
    required this.workDate,
    required this.isDayOff,
    this.scheduledStart,
    this.scheduledEnd,
    this.notes,
  });

  final String? id;
  final String employeeId;
  final String workDate;
  final bool isDayOff;
  final String? scheduledStart;
  final String? scheduledEnd;
  final String? notes;

  Map<String, Object?> toJson() => {
    if (id != null) 'id': id,
    'employee_id': employeeId,
    'work_date': workDate,
    'is_day_off': isDayOff,
    'scheduled_start': scheduledStart,
    'scheduled_end': scheduledEnd,
    'notes': notes,
  };
}

abstract interface class PosSchedulesGateway {
  /// `PUT /api/v1/schedules` (`schedule.manage`).
  Future<PosEmployeeSchedule> upsertSchedule(PosScheduleUpsertInput input);

  /// `GET /api/v1/schedules` (`schedule.read`) — every schedule row for one
  /// employee within `[dateFrom, dateTo]`, never a synthetic "empty day"
  /// row for a date with no schedule defined yet.
  Future<List<PosEmployeeSchedule>> listSchedules({
    required String employeeId,
    required String dateFrom,
    required String dateTo,
  });

  /// TASK 16.29 — `GET /api/v1/schedules/branch` (`schedule.read`) —
  /// every employee's schedule for one branch within `[dateFrom, dateTo]`
  /// in a single call, for the Horarios weekly MATRIX. Never a synthetic
  /// row for an employee/date with no schedule defined yet.
  Future<List<PosEmployeeSchedule>> listSchedulesForBranch({
    required String branchId,
    required String dateFrom,
    required String dateTo,
  });
}

class ApiPosSchedulesGateway implements PosSchedulesGateway {
  const ApiPosSchedulesGateway(this._client);
  final ApiClient _client;

  static String _idempotencyKey() => 'one-schedule-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosEmployeeSchedule> upsertSchedule(PosScheduleUpsertInput input) async {
    // `schedules.routes.ts`'s `PUT /api/v1/schedules` requires an
    // `Idempotency-Key` header but carries no `If-Match` at all (there is
    // no separate `version` field on this resource) — see
    // `api_client.dart`'s `putJson` doc comment for why this is the first
    // `PUT` caller to need it.
    final envelope = await _client.putJson(
      '/api/v1/schedules',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<List<PosEmployeeSchedule>> listSchedules({
    required String employeeId,
    required String dateFrom,
    required String dateTo,
  }) async {
    final query = <String, String>{'employee_id': employeeId, 'date_from': dateFrom, 'date_to': dateTo};
    final path = Uri(path: '/api/v1/schedules', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing schedules list data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosEmployeeSchedule.fromJson).toList(growable: false);
  }

  @override
  Future<List<PosEmployeeSchedule>> listSchedulesForBranch({
    required String branchId,
    required String dateFrom,
    required String dateTo,
  }) async {
    final query = <String, String>{'branch_id': branchId, 'date_from': dateFrom, 'date_to': dateTo};
    final path = Uri(path: '/api/v1/schedules/branch', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing schedules list data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosEmployeeSchedule.fromJson).toList(growable: false);
  }

  PosEmployeeSchedule _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing schedule data.');
    }
    return PosEmployeeSchedule.fromJson(data);
  }
}

class EmptyPosSchedulesGateway implements PosSchedulesGateway {
  const EmptyPosSchedulesGateway();

  @override
  Future<PosEmployeeSchedule> upsertSchedule(PosScheduleUpsertInput input) =>
      Future.error(StateError('No schedules gateway is configured.'));

  @override
  Future<List<PosEmployeeSchedule>> listSchedules({
    required String employeeId,
    required String dateFrom,
    required String dateTo,
  }) async => const [];

  @override
  Future<List<PosEmployeeSchedule>> listSchedulesForBranch({
    required String branchId,
    required String dateFrom,
    required String dateTo,
  }) async => const [];
}

// ---------------------------------------------------------------------
// Checador (time clock)
// ---------------------------------------------------------------------

/// A `time_clock_punches` row (`TimeClockPunchRow`/`punchHttp` in
/// `time-clock.routes.ts`).
class PosTimeClockPunch {
  const PosTimeClockPunch({
    required this.id,
    required this.branchId,
    required this.employeeId,
    required this.punchType,
    required this.occurredAt,
    required this.station,
    required this.method,
    required this.isCorrection,
    required this.correctionReason,
    required this.correctedPunchId,
    required this.createdAt,
  });

  factory PosTimeClockPunch.fromJson(Map<String, Object?> json) => PosTimeClockPunch(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    employeeId: json['employee_id']! as String,
    punchType: json['punch_type']! as String,
    occurredAt: DateTime.parse(json['occurred_at']! as String),
    station: json['station'] as String?,
    // TASK 16.28 — the real, stored source of this punch
    // (`timeClockPunchMethods`); every punch today is 'manual' (no
    // attendance terminal exists yet) — falls back to 'manual' only if
    // an older cached/test response predates this field, never invents
    // 'device'/'biometric'.
    method: (json['method'] as String?) ?? 'manual',
    isCorrection: json['is_correction']! as bool,
    correctionReason: json['correction_reason'] as String?,
    correctedPunchId: json['corrected_punch_id'] as String?,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String branchId;
  final String employeeId;

  /// `clock_in` | `clock_out` (`timeClockPunchTypes`).
  final String punchType;
  final DateTime occurredAt;
  final String? station;

  /// `manual` | `device` | `biometric` (`timeClockPunchMethods`).
  final String method;
  final bool isCorrection;
  final String? correctionReason;
  final String? correctedPunchId;
  final DateTime createdAt;
}

/// `POST /time-clock/corrections` body — mirrors `time-clock.routes.ts`'s
/// own required fields exactly: a correction NEVER edits or deletes the
/// original punch, it inserts a NEW row that references it via
/// [correctedPunchId] (`time-clock.service.ts`'s own doc comment) — the UI
/// language around this must say exactly that, never "editar"/"eliminar".
class PosTimeClockCorrectionInput {
  const PosTimeClockCorrectionInput({
    required this.employeeId,
    required this.punchType,
    required this.occurredAt,
    this.station,
    required this.correctionReason,
    required this.correctedPunchId,
  });

  final String employeeId;
  final String punchType;

  /// A full ISO-8601 timestamp — the one ordinary clock-in/out never
  /// accepts client-side (always `context.timestamp` server-side); only
  /// this correction path may submit one.
  final String occurredAt;
  final String? station;
  final String correctionReason;
  final String correctedPunchId;

  Map<String, Object?> toJson() => {
    'employee_id': employeeId,
    'punch_type': punchType,
    'occurred_at': occurredAt,
    'station': station,
    'correction_reason': correctionReason,
    'corrected_punch_id': correctedPunchId,
  };
}

abstract interface class PosTimeClockGateway {
  /// `POST /api/v1/time-clock/clock-in` (`attendance.read` minimum;
  /// self-service vs. `attendance.manage` is authorized server-side — see
  /// `time-clock.service.ts`'s own doc comment).
  Future<PosTimeClockPunch> clockIn({required String employeeId, String? station});

  /// `POST /api/v1/time-clock/clock-out` (same authorization shape as
  /// [clockIn]).
  Future<PosTimeClockPunch> clockOut({required String employeeId, String? station});

  /// `POST /api/v1/time-clock/corrections` (`attendance.manage` only).
  Future<PosTimeClockPunch> correctPunch(PosTimeClockCorrectionInput input);

  /// `GET /api/v1/time-clock/punches` (`attendance.read`).
  Future<List<PosTimeClockPunch>> listPunches({
    required String employeeId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  });

  /// TASK 16.29 — `GET /api/v1/time-clock/punches/branch`
  /// (`attendance.read`) — every employee's punches for one branch in a
  /// single call, for Checador's "Checadas de hoy"/"Historial de
  /// asistencia" panels.
  Future<List<PosTimeClockPunch>> listPunchesForBranch({
    required String branchId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  });
}

class ApiPosTimeClockGateway implements PosTimeClockGateway {
  const ApiPosTimeClockGateway(this._client);
  final ApiClient _client;

  static String _idempotencyKey() => 'one-time-clock-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosTimeClockPunch> clockIn({required String employeeId, String? station}) async {
    final envelope = await _client.postJson(
      '/api/v1/time-clock/clock-in',
      idempotencyKey: _idempotencyKey(),
      body: {'employee_id': employeeId, 'station': station},
    );
    return _decode(envelope);
  }

  @override
  Future<PosTimeClockPunch> clockOut({required String employeeId, String? station}) async {
    final envelope = await _client.postJson(
      '/api/v1/time-clock/clock-out',
      idempotencyKey: _idempotencyKey(),
      body: {'employee_id': employeeId, 'station': station},
    );
    return _decode(envelope);
  }

  @override
  Future<PosTimeClockPunch> correctPunch(PosTimeClockCorrectionInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/time-clock/corrections',
      idempotencyKey: _idempotencyKey(),
      body: input.toJson(),
    );
    return _decode(envelope);
  }

  @override
  Future<List<PosTimeClockPunch>> listPunches({
    required String employeeId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  }) async {
    final query = <String, String>{
      'employee_id': employeeId,
      'limit': '$limit',
      if (dateFrom != null) 'date_from': dateFrom,
      if (dateTo != null) 'date_to': dateTo,
    };
    final path = Uri(path: '/api/v1/time-clock/punches', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing time-clock punches list data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosTimeClockPunch.fromJson).toList(growable: false);
  }

  @override
  Future<List<PosTimeClockPunch>> listPunchesForBranch({
    required String branchId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  }) async {
    final query = <String, String>{
      'branch_id': branchId,
      'limit': '$limit',
      if (dateFrom != null) 'date_from': dateFrom,
      if (dateTo != null) 'date_to': dateTo,
    };
    final path = Uri(path: '/api/v1/time-clock/punches/branch', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing time-clock punches list data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosTimeClockPunch.fromJson).toList(growable: false);
  }

  PosTimeClockPunch _decode(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing time-clock punch data.');
    }
    return PosTimeClockPunch.fromJson(data);
  }
}

class EmptyPosTimeClockGateway implements PosTimeClockGateway {
  const EmptyPosTimeClockGateway();

  @override
  Future<PosTimeClockPunch> clockIn({required String employeeId, String? station}) =>
      Future.error(StateError('No time-clock gateway is configured.'));

  @override
  Future<PosTimeClockPunch> clockOut({required String employeeId, String? station}) =>
      Future.error(StateError('No time-clock gateway is configured.'));

  @override
  Future<PosTimeClockPunch> correctPunch(PosTimeClockCorrectionInput input) =>
      Future.error(StateError('No time-clock gateway is configured.'));

  @override
  Future<List<PosTimeClockPunch>> listPunches({
    required String employeeId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  }) async => const [];

  @override
  Future<List<PosTimeClockPunch>> listPunchesForBranch({
    required String branchId,
    String? dateFrom,
    String? dateTo,
    int limit = 100,
  }) async => const [];
}

// ---------------------------------------------------------------------
// Nómina (payroll)
// ---------------------------------------------------------------------

/// A `payroll_periods` row (`PayrollPeriodRow`/`periodHttp` in
/// `payroll.routes.ts`).
class PosPayrollPeriod {
  const PosPayrollPeriod({
    required this.id,
    required this.branchId,
    required this.periodStart,
    required this.periodEnd,
    required this.status,
    required this.closedAt,
    required this.closedBy,
    required this.createdAt,
    required this.updatedAt,
  });

  factory PosPayrollPeriod.fromJson(Map<String, Object?> json) => PosPayrollPeriod(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    periodStart: json['period_start']! as String,
    periodEnd: json['period_end']! as String,
    status: json['status']! as String,
    closedAt: json['closed_at'] == null ? null : DateTime.parse(json['closed_at']! as String),
    closedBy: json['closed_by'] as String?,
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
  );

  final String id;
  final String branchId;

  /// `YYYY-MM-DD`.
  final String periodStart;
  final String periodEnd;

  /// `draft` | `closed` (`payrollPeriodStatuses`).
  final String status;
  final DateTime? closedAt;
  final String? closedBy;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isClosed => status == 'closed';
}

/// A `payroll_period_lines` row (`PayrollPeriodLineRow`/`lineHttp` in
/// `payroll.routes.ts`) — every figure here is exactly what the backend
/// computed (`PayrollService.calculate`/`computePayrollLine`); this app
/// never recomputes or re-derives a payroll figure client-side.
class PosPayrollPeriodLine {
  const PosPayrollPeriodLine({
    required this.id,
    required this.employeeId,
    required this.scheduledMinutes,
    required this.workedMinutes,
    required this.lateMinutes,
    required this.overtimeMinutes,
    required this.baseSalarySnapshot,
    required this.deductionAmount,
    required this.bonusAmount,
    required this.totalAmount,
    required this.currencyCode,
    required this.computedAt,
    required this.computedBy,
  });

  factory PosPayrollPeriodLine.fromJson(Map<String, Object?> json) => PosPayrollPeriodLine(
    id: json['id']! as String,
    employeeId: json['employee_id']! as String,
    scheduledMinutes: json['scheduled_minutes']! as int,
    workedMinutes: json['worked_minutes']! as int,
    lateMinutes: json['late_minutes']! as int,
    overtimeMinutes: json['overtime_minutes']! as int,
    baseSalarySnapshot: json['base_salary_snapshot']! as String,
    deductionAmount: json['deduction_amount']! as String,
    bonusAmount: json['bonus_amount']! as String,
    totalAmount: json['total_amount']! as String,
    currencyCode: json['currency_code']! as String,
    computedAt: DateTime.parse(json['computed_at']! as String),
    computedBy: json['computed_by']! as String,
  );

  final String id;
  final String employeeId;
  final int scheduledMinutes;
  final int workedMinutes;
  final int lateMinutes;
  final int overtimeMinutes;
  final String baseSalarySnapshot;
  final String deductionAmount;
  final String bonusAmount;
  final String totalAmount;
  final String currencyCode;
  final DateTime computedAt;
  final String computedBy;
}

class PosPayrollPeriodDetail {
  const PosPayrollPeriodDetail({required this.period, required this.lines});
  final PosPayrollPeriod period;
  final List<PosPayrollPeriodLine> lines;

  factory PosPayrollPeriodDetail.fromJson(Map<String, Object?> json) {
    final rawLines = json['lines'];
    return PosPayrollPeriodDetail(
      period: PosPayrollPeriod.fromJson(json),
      lines: rawLines is List<Object?>
          ? rawLines.whereType<Map<String, Object?>>().map(PosPayrollPeriodLine.fromJson).toList(growable: false)
          : const [],
    );
  }
}

abstract interface class PosPayrollGateway {
  /// `POST /api/v1/payroll-periods` (`payroll.manage`).
  Future<PosPayrollPeriod> createPeriod({required String branchId, required String periodStart, required String periodEnd});

  /// `GET /api/v1/payroll-periods/{id}` (`payroll.read`) — the period plus
  /// its currently-computed lines (empty until `calculate` first runs).
  Future<PosPayrollPeriodDetail> period(String id);

  /// `GET /api/v1/payroll-periods` (`payroll.read`).
  Future<List<PosPayrollPeriod>> listPeriods({String? branchId, String? status, int limit = 50});

  /// `POST /api/v1/payroll-periods/{id}/calculate` (`payroll.manage`) —
  /// re-runnable while `draft` (replaces the period's lines wholesale);
  /// rejected with `payroll_period_closed` once `closed`.
  Future<PosPayrollPeriodDetail> calculate(String id);

  /// `POST /api/v1/payroll-periods/{id}/close` (`payroll.close`) — makes
  /// the period's lines permanently immutable.
  Future<PosPayrollPeriod> close(String id);

  /// `POST /api/v1/payroll-periods/{id}/reopen` (`payroll.close`) — its own
  /// distinct, separately-audited action, never a silent flip of `close`.
  Future<PosPayrollPeriod> reopen(String id);
}

class ApiPosPayrollGateway implements PosPayrollGateway {
  const ApiPosPayrollGateway(this._client);
  final ApiClient _client;

  static String _idempotencyKey() => 'one-payroll-${DateTime.now().toUtc().microsecondsSinceEpoch}';

  @override
  Future<PosPayrollPeriod> createPeriod({
    required String branchId,
    required String periodStart,
    required String periodEnd,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/payroll-periods',
      idempotencyKey: _idempotencyKey(),
      body: {'branch_id': branchId, 'period_start': periodStart, 'period_end': periodEnd},
    );
    return _decodePeriod(envelope);
  }

  @override
  Future<PosPayrollPeriodDetail> period(String id) async {
    final envelope = await _client.getJson('/api/v1/payroll-periods/$id');
    return _decodeDetail(envelope);
  }

  @override
  Future<List<PosPayrollPeriod>> listPeriods({String? branchId, String? status, int limit = 50}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final path = Uri(path: '/api/v1/payroll-periods', queryParameters: query).toString();
    final envelope = await _client.getJson(path);
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing payroll periods list data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosPayrollPeriod.fromJson).toList(growable: false);
  }

  @override
  Future<PosPayrollPeriodDetail> calculate(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/payroll-periods/$id/calculate',
      idempotencyKey: _idempotencyKey(),
    );
    return _decodeDetail(envelope);
  }

  @override
  Future<PosPayrollPeriod> close(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/payroll-periods/$id/close',
      idempotencyKey: _idempotencyKey(),
    );
    return _decodePeriod(envelope);
  }

  @override
  Future<PosPayrollPeriod> reopen(String id) async {
    final envelope = await _client.postJson(
      '/api/v1/payroll-periods/$id/reopen',
      idempotencyKey: _idempotencyKey(),
    );
    return _decodePeriod(envelope);
  }

  PosPayrollPeriod _decodePeriod(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing payroll period data.');
    }
    return PosPayrollPeriod.fromJson(data);
  }

  PosPayrollPeriodDetail _decodeDetail(Map<String, Object?> envelope) {
    final data = envelope['data'];
    if (data is! Map<String, Object?>) {
      throw const FormatException('Missing payroll period data.');
    }
    return PosPayrollPeriodDetail.fromJson(data);
  }
}

class EmptyPosPayrollGateway implements PosPayrollGateway {
  const EmptyPosPayrollGateway();

  @override
  Future<PosPayrollPeriod> createPeriod({
    required String branchId,
    required String periodStart,
    required String periodEnd,
  }) => Future.error(StateError('No payroll gateway is configured.'));

  @override
  Future<PosPayrollPeriodDetail> period(String id) =>
      Future.error(StateError('No payroll gateway is configured.'));

  @override
  Future<List<PosPayrollPeriod>> listPeriods({String? branchId, String? status, int limit = 50}) async => const [];

  @override
  Future<PosPayrollPeriodDetail> calculate(String id) =>
      Future.error(StateError('No payroll gateway is configured.'));

  @override
  Future<PosPayrollPeriod> close(String id) => Future.error(StateError('No payroll gateway is configured.'));

  @override
  Future<PosPayrollPeriod> reopen(String id) => Future.error(StateError('No payroll gateway is configured.'));
}
