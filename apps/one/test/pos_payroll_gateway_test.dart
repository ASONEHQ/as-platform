// TASK 17.6 (Payroll V2) — the real HTTP gateway: routes, bodies, idempotency
// keys and decoding of the new employee-week/adjustment/total fields. Mirrors
// `pos_branch_consolidation_gateway_test.dart`'s fake-`http.BaseClient` convention.
import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/pos/pos_people_gateway.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test('period decodes lines (with the frozen identity + signed adjustment) and the server totals', () async {
    late http.BaseRequest captured;
    final gateway = _gateway((request) {
      captured = request;
      return _response({..._period, 'lines': [_line], 'totals': [_totals]});
    });
    final detail = await gateway.period('period-1');
    expect(captured.method, 'GET');
    expect(captured.url.path, '/api/v1/payroll-periods/period-1');
    final line = detail.lines.single;
    expect(line.employeeName, 'Ana Torres');
    expect(line.employeeCode, 'EMP-1');
    expect(line.jobTitle, 'Cajera');
    expect(line.snapshotAvailable, isTrue);
    expect(line.adjustmentAmount, '-50.5000');
    expect(line.totalAmount, '1440.1250');
    expect(detail.totals.single.currencyCode, 'MXN');
    expect(detail.totals.single.total, '1440.1250');
    expect(detail.totals.single.adjustment, '-50.5000');
  });

  test('a line from before Payroll V2 (no snapshot fields) decodes with honest defaults, never made-up values', () async {
    final gateway = _gateway((request) {
      final legacy = {..._line}
        ..remove('adjustment_amount')
        ..remove('employee_name')
        ..remove('employee_code')
        ..remove('job_title')
        ..remove('snapshot_available');
      return _response({..._period, 'lines': [legacy]});
    });
    final detail = await gateway.period('period-1');
    final line = detail.lines.single;
    expect(line.employeeName, isNull);
    expect(line.snapshotAvailable, isFalse);
    expect(line.adjustmentAmount, '0.0000');
    expect(detail.totals, isEmpty);
  });

  test('employeeDetail reads the frozen days and the adjustments (voided ones included)', () async {
    late http.BaseRequest captured;
    final gateway = _gateway((request) {
      captured = request;
      return _response({
        'period': _period,
        'line': _line,
        'days': [_day],
        'adjustments': [_adjustment, _voidedAdjustment],
      });
    });
    final detail = await gateway.employeeDetail(periodId: 'period-1', employeeId: 'employee-1');
    expect(captured.url.path, '/api/v1/payroll-periods/period-1/employees/employee-1');
    expect(detail.days.single.attendanceState, 'complete');
    expect(detail.days.single.firstInMinute, 552);
    expect(detail.days.single.lastOutMinute, 1050);
    expect(detail.adjustments, hasLength(2));
    expect(detail.adjustments.first.isVoided, isFalse);
    expect(detail.adjustments.last.isVoided, isTrue);
    expect(detail.adjustments.last.voidReason, 'Capturado por error');
  });

  test('createAdjustment posts the exact kind/amount/reason with the CALLER\'S idempotency key', () async {
    late http.BaseRequest captured;
    String? body;
    final gateway = _gateway((request) {
      captured = request;
      body = (request as http.Request).body;
      return _response({..._adjustment, 'line': _line}, status: 201);
    });
    final change = await gateway.createAdjustment(
      periodId: 'period-1',
      employeeId: 'employee-1',
      kind: 'deduction',
      amount: '50.5',
      reason: 'Faltante de caja',
      idempotencyKey: 'caller-key-123',
    );
    expect(captured.method, 'POST');
    expect(captured.url.path, '/api/v1/payroll-periods/period-1/adjustments');
    expect(captured.headers['idempotency-key'] ?? captured.headers['Idempotency-Key'], 'caller-key-123');
    expect(jsonDecode(body!), {
      'employee_id': 'employee-1',
      'kind': 'deduction',
      'amount': '50.5',
      'reason': 'Faltante de caja',
    });
    expect(change.adjustment.id, 'adj-1');
    expect(change.line.adjustmentAmount, '-50.5000');
  });

  test('voidAdjustment posts the reason to the void route (never a DELETE)', () async {
    late http.BaseRequest captured;
    String? body;
    final gateway = _gateway((request) {
      captured = request;
      body = (request as http.Request).body;
      return _response({..._voidedAdjustment, 'line': _line});
    });
    final change = await gateway.voidAdjustment(
      periodId: 'period-1',
      adjustmentId: 'adj-2',
      reason: 'Capturado por error',
      idempotencyKey: 'void-key-1',
    );
    expect(captured.method, 'POST');
    expect(captured.url.path, '/api/v1/payroll-periods/period-1/adjustments/adj-2/void');
    expect(jsonDecode(body!), {'reason': 'Capturado por error'});
    expect(change.adjustment.isVoided, isTrue);
  });

  test('reopen sends its mandatory reason', () async {
    late http.BaseRequest captured;
    String? body;
    final gateway = _gateway((request) {
      captured = request;
      body = (request as http.Request).body;
      return _response({..._period, 'status': 'draft', 'closed_at': null, 'closed_by': null});
    });
    final reopened = await gateway.reopen('period-1', reason: 'Se corrigió una checada');
    expect(captured.url.path, '/api/v1/payroll-periods/period-1/reopen');
    expect(jsonDecode(body!), {'reason': 'Se corrigió una checada'});
    expect(reopened.status, 'draft');
  });
}

const _period = <String, Object?>{
  'id': 'period-1',
  'branch_id': 'branch-1',
  'period_start': '2026-09-01',
  'period_end': '2026-09-07',
  'status': 'draft',
  'closed_at': null,
  'closed_by': null,
  'created_at': '2026-09-01T00:00:00.000Z',
  'updated_at': '2026-09-01T00:00:00.000Z',
};

const _line = <String, Object?>{
  'id': 'line-1',
  'employee_id': 'employee-1',
  'scheduled_minutes': 2400,
  'worked_minutes': 2350,
  'late_minutes': 15,
  'overtime_minutes': 0,
  'base_salary_snapshot': '1500.0000',
  'deduction_amount': '9.3750',
  'bonus_amount': '0.0000',
  'total_amount': '1440.1250',
  'currency_code': 'MXN',
  'computed_at': '2026-09-07T00:00:00.000Z',
  'computed_by': 'user-1',
  'adjustment_amount': '-50.5000',
  'employee_name': 'Ana Torres',
  'employee_code': 'EMP-1',
  'job_title': 'Cajera',
  'snapshot_available': true,
};

const _totals = <String, Object?>{
  'currency_code': 'MXN',
  'employee_count': 1,
  'base_salary': '1500.0000',
  'deduction': '9.3750',
  'bonus': '0.0000',
  'adjustment': '-50.5000',
  'total': '1440.1250',
};

const _day = <String, Object?>{
  'work_date': '2026-09-01',
  'scheduled_start': '09:00:00',
  'scheduled_end': '17:00:00',
  'is_day_off': false,
  'scheduled_minutes': 480,
  'worked_minutes': 498,
  'late_minutes': 2,
  'overtime_minutes': 30,
  'first_in_minute': 552,
  'last_out_minute': 1050,
  'attendance_state': 'complete',
};

const _adjustment = <String, Object?>{
  'id': 'adj-1',
  'payroll_period_id': 'period-1',
  'employee_id': 'employee-1',
  'kind': 'deduction',
  'amount': '50.5000',
  'currency_code': 'MXN',
  'reason': 'Faltante de caja',
  'created_by': 'user-1',
  'created_at': '2026-09-06T00:00:00.000Z',
  'voided_at': null,
  'voided_by': null,
  'void_reason': null,
};

const _voidedAdjustment = <String, Object?>{
  'id': 'adj-2',
  'payroll_period_id': 'period-1',
  'employee_id': 'employee-1',
  'kind': 'bonus',
  'amount': '200.0000',
  'currency_code': 'MXN',
  'reason': 'Bono',
  'created_by': 'user-1',
  'created_at': '2026-09-06T00:00:00.000Z',
  'voided_at': '2026-09-07T00:00:00.000Z',
  'voided_by': 'user-1',
  'void_reason': 'Capturado por error',
};

ApiPosPayrollGateway _gateway(http.Response Function(http.BaseRequest request) handler) => ApiPosPayrollGateway(
  ApiClient(
    baseUrl: Uri.parse('https://api.test.asone.mx/'),
    transport: _FakeClient(handler),
    readAccessToken: () => 'access-token',
    createCorrelationId: () => 'correlation-test',
  ),
);

http.Response _response(Map<String, Object?> data, {int status = 200}) => http.Response(
  jsonEncode({
    'data': data,
    'meta': {'request_id': 'request', 'correlation_id': 'correlation'},
  }),
  status,
  headers: const {'content-type': 'application/json'},
);

class _FakeClient extends http.BaseClient {
  _FakeClient(this.handler);
  final http.Response Function(http.BaseRequest request) handler;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = handler(request);
    return http.StreamedResponse(Stream.value(response.bodyBytes), response.statusCode, headers: response.headers);
  }
}
