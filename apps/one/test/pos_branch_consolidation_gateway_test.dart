// TASK 16.15 — mirrors `auth_gateway_test.dart`'s own fake-`http.BaseClient`
// gateway-test convention.
import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/pos/pos_branch_consolidation_gateway.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  test('consolidation sends the real date querystring and decodes every field', () async {
    late http.BaseRequest captured;
    final gateway = _gateway((request) {
      captured = request;
      return _response(_fixtureData());
    });
    final result = await gateway.consolidation('branch-1', date: '2026-09-21');
    expect(captured.url.path, '/api/v1/branches/branch-1/consolidation');
    expect(captured.url.queryParameters['date'], '2026-09-21');
    expect(result.branchId, 'branch-1');
    expect(result.businessDate, '2026-09-21');
    expect(result.registers, hasLength(2));
    expect(result.registers.first.status, PosBranchConsolidationRegisterStatus.closed);
    expect(result.registers.last.status, PosBranchConsolidationRegisterStatus.noSession);
    expect(result.areas.single.operationalAreaName, 'Taquilla');
    expect(result.totals.cashDifferenceTotal, '0.00');
  });

  test('omitting date sends no date querystring param', () async {
    late http.BaseRequest captured;
    final gateway = _gateway((request) {
      captured = request;
      return _response(_fixtureData());
    });
    await gateway.consolidation('branch-1');
    expect(captured.url.queryParameters, isNot(contains('date')));
  });

  // TASK 16.15's own critical correctness requirement — see
  // `pos_branch_consolidation_gateway.dart`'s header doc comment: a
  // branch-wide `cash_difference_total` of exactly zero must never be
  // treated as "nothing to see here". This test asserts the gateway
  // decodes the per-register discrepancy counts HONESTLY, independent of
  // whatever the net total reads, so no UI built on top of this model can
  // accidentally lose that signal at the parsing layer.
  test(
    'decodes a non-zero discrepantRegisterCount even when cashDifferenceTotal nets to exactly zero',
    () async {
      final gateway = _gateway((_) => _response(_fixtureNetZeroButDiscrepantData()));
      final result = await gateway.consolidation('branch-1');
      expect(result.totals.cashDifferenceTotal, '0.00');
      expect(result.totals.discrepantRegisterCount, 2);
      expect(result.totals.hasAnyDiscrepancy, isTrue);
      // The two registers that actually carry the real, non-cancelling
      // individual discrepancies must still be visible on each row.
      final over = result.registers.firstWhere((r) => r.registerId == 'register-over');
      final under = result.registers.firstWhere((r) => r.registerId == 'register-under');
      expect(over.discrepancyAmount, '50.00');
      expect(over.hasCashDiscrepancy, isTrue);
      expect(under.discrepancyAmount, '-50.00');
      expect(under.hasCashDiscrepancy, isTrue);
    },
  );

  test('EmptyPosBranchConsolidationGateway throws honestly, never fabricates data', () async {
    const gateway = EmptyPosBranchConsolidationGateway();
    await expectLater(gateway.consolidation('branch-1'), throwsA(isA<StateError>()));
  });
}

Map<String, Object?> _fixtureData() => {
  'branch_id': 'branch-1',
  'business_date': '2026-09-21',
  'window_start': '2026-09-21T06:00:00.000Z',
  'window_end': '2026-09-22T06:00:00.000Z',
  'registers': [
    {
      'register_id': 'register-1',
      'register_code': 'CAJA-1',
      'register_name': 'Caja 1',
      'operational_area_id': 'area-1',
      'status': 'closed',
      'cash_session_id': 'session-1',
      'opened_at': '2026-09-21T08:00:00.000Z',
      'closed_at': '2026-09-21T20:00:00.000Z',
      'opening_amount': '1000.00',
      'cash_sales_total': '500.00',
      'cash_in_total': '0.00',
      'cash_out_total': '0.00',
      'expected_cash': '1500.00',
      'counted_cash': '1500.00',
      'discrepancy_amount': '0.00',
      'payment_method_totals': [
        {'method': 'cash', 'gross_sales_total': '500.00', 'refunds_total': '0.00', 'net_total': '500.00', 'ticket_count': 5},
      ],
      'card_reconciliation': null,
    },
    {
      'register_id': 'register-2',
      'register_code': 'CAJA-2',
      'register_name': 'Caja 2',
      'operational_area_id': null,
      'status': 'no_session',
      'cash_session_id': null,
      'opened_at': null,
      'closed_at': null,
      'opening_amount': null,
      'cash_sales_total': null,
      'cash_in_total': null,
      'cash_out_total': null,
      'expected_cash': null,
      'counted_cash': null,
      'discrepancy_amount': null,
      'payment_method_totals': [],
      'card_reconciliation': null,
    },
  ],
  'areas': [
    {'operational_area_id': 'area-1', 'operational_area_name': 'Taquilla', 'cash_sales_total': '500.00', 'register_count': 1},
  ],
  'totals': {
    'cash_opening_total': '1000.00',
    'cash_sales_total': '500.00',
    'cash_in_total': '0.00',
    'cash_out_total': '0.00',
    'expected_cash_total': '1500.00',
    'counted_cash_total': '1500.00',
    'cash_difference_total': '0.00',
    'payment_method_totals': [],
    'card_system_net_total': '0.00',
    'card_terminal_total': '0.00',
    'card_difference_total': '0.00',
    'open_register_count': 0,
    'closing_register_count': 0,
    'closed_register_count': 1,
    'no_session_register_count': 1,
    'discrepant_register_count': 0,
    'card_pending_or_discrepant_register_count': 0,
  },
};

/// Two registers individually off by +$50/-$50 — nets to exactly $0.00
/// branch-wide, but `discrepant_register_count` must still read 2.
Map<String, Object?> _fixtureNetZeroButDiscrepantData() => {
  'branch_id': 'branch-1',
  'business_date': '2026-09-21',
  'window_start': '2026-09-21T06:00:00.000Z',
  'window_end': '2026-09-22T06:00:00.000Z',
  'registers': [
    {
      'register_id': 'register-over',
      'register_code': 'CAJA-1',
      'register_name': 'Caja 1',
      'operational_area_id': null,
      'status': 'closed',
      'cash_session_id': 'session-over',
      'opened_at': '2026-09-21T08:00:00.000Z',
      'closed_at': '2026-09-21T20:00:00.000Z',
      'opening_amount': '1000.00',
      'cash_sales_total': '500.00',
      'cash_in_total': '0.00',
      'cash_out_total': '0.00',
      'expected_cash': '1500.00',
      'counted_cash': '1550.00',
      'discrepancy_amount': '50.00',
      'payment_method_totals': [],
      'card_reconciliation': null,
    },
    {
      'register_id': 'register-under',
      'register_code': 'CAJA-2',
      'register_name': 'Caja 2',
      'operational_area_id': null,
      'status': 'closed',
      'cash_session_id': 'session-under',
      'opened_at': '2026-09-21T08:00:00.000Z',
      'closed_at': '2026-09-21T20:00:00.000Z',
      'opening_amount': '1000.00',
      'cash_sales_total': '500.00',
      'cash_in_total': '0.00',
      'cash_out_total': '0.00',
      'expected_cash': '1500.00',
      'counted_cash': '1450.00',
      'discrepancy_amount': '-50.00',
      'payment_method_totals': [],
      'card_reconciliation': null,
    },
  ],
  'areas': [],
  'totals': {
    'cash_opening_total': '2000.00',
    'cash_sales_total': '1000.00',
    'cash_in_total': '0.00',
    'cash_out_total': '0.00',
    'expected_cash_total': '3000.00',
    'counted_cash_total': '3000.00',
    // The net-zero headline number this whole test exists to not be fooled
    // by.
    'cash_difference_total': '0.00',
    'payment_method_totals': [],
    'card_system_net_total': '0.00',
    'card_terminal_total': '0.00',
    'card_difference_total': '0.00',
    'open_register_count': 0,
    'closing_register_count': 0,
    'closed_register_count': 2,
    'no_session_register_count': 0,
    'discrepant_register_count': 2,
    'card_pending_or_discrepant_register_count': 0,
  },
};

ApiPosBranchConsolidationGateway _gateway(
  http.Response Function(http.BaseRequest request) handler,
) => ApiPosBranchConsolidationGateway(
  ApiClient(
    baseUrl: Uri.parse('https://api.test.asone.mx/'),
    transport: _FakeClient(handler),
    readAccessToken: () => 'access-token',
    createCorrelationId: () => 'correlation-test',
  ),
);

http.Response _response(Map<String, Object?> data) => http.Response(
  jsonEncode({
    'data': data,
    'meta': {'request_id': 'request', 'correlation_id': 'correlation'},
  }),
  200,
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
