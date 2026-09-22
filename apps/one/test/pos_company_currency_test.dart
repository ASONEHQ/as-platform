// TASK 16.17 (Part A) — the tenant currency in the client: parsing
// `currency_code` from `GET /context/companies`, the
// `AuthenticatedContext.companyCurrencyCode` getter, the optional
// `PosProductPriceInput.currencyCode`, and the sale/payment currency
// plumbing that replaced the hardcoded 'MXN'.
import 'dart:convert';

import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/core/storage/token_vault.dart';
import 'package:as_one/features/authentication/auth_gateway.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_catalog_admin_gateway.dart';
import 'package:as_one/features/pos/pos_payments_gateway.dart';
import 'package:as_one/features/pos/pos_sales_gateway.dart';
import 'package:as_one/features/pos/sale_session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  group('companyCurrencyCode', () {
    test('returns the current company currency when the backend sent it', () {
      final context = _context(const [
        CompanySummary(id: 'c-1', name: 'Empresa Generica QA', current: true, currencyCode: 'USD'),
      ]);
      expect(context.companyCurrencyCode, 'USD');
    });

    test('falls back to the legacy default only when the field is absent', () {
      final context = _context(const [CompanySummary(id: 'c-1', name: 'Empresa Generica QA', current: true)]);
      expect(context.currentCompany!.currencyCode, isNull);
      expect(context.companyCurrencyCode, 'MXN');
    });

    test('uses the CURRENT company, not another one in the list', () {
      final context = _context(const [
        CompanySummary(id: 'c-1', name: 'Otra Empresa', currencyCode: 'EUR'),
        CompanySummary(id: 'c-2', name: 'Empresa Generica QA', current: true, currencyCode: 'COP'),
      ]);
      expect(context.companyCurrencyCode, 'COP');
    });

    test('hydrate reads currency_code from /context/companies and tolerates its absence', () async {
      final withField = await _gateway(companyItem: {
        'company_id': 'company-id',
        'display_name': 'Empresa Generica QA',
        'current': true,
        'switch_permitted': true,
        'currency_code': 'USD',
      }).hydrate(_tokenSession);
      expect(withField.currentCompany!.currencyCode, 'USD');
      expect(withField.companyCurrencyCode, 'USD');

      final without = await _gateway(companyItem: {
        'company_id': 'company-id',
        'display_name': 'Empresa Generica QA',
        'current': true,
        'switch_permitted': true,
      }).hydrate(_tokenSession);
      expect(without.currentCompany!.currencyCode, isNull);
      expect(without.companyCurrencyCode, 'MXN');
    });
  });

  group('PosProductPriceInput', () {
    test('omits currency_code from the JSON body when null', () {
      final json = const PosProductPriceInput(amount: '12.5000').toJson();
      expect(json, {'amount': '12.5000'});
      expect(json.containsKey('currency_code'), isFalse);
    });

    test('sends currency_code only when a caller deliberately sets one', () {
      final json = const PosProductPriceInput(amount: '12.5000', currencyCode: 'USD', branchId: 'b-1').toJson();
      expect(json['currency_code'], 'USD');
      expect(json['branch_id'], 'b-1');
    });
  });

  group('sale currency', () {
    test('PosSaleCreated parses the sale own currency_code and tolerates its absence', () {
      final withCurrency = PosSaleCreated.fromJson(const {
        'id': 's-1',
        'sale_number': 'A-1',
        'status': 'pending_payment',
        'total': '10.0000',
        'currency_code': 'USD',
      });
      expect(withCurrency.currencyCode, 'USD');
      final without = PosSaleCreated.fromJson(const {
        'id': 's-1',
        'sale_number': 'A-1',
        'status': 'pending_payment',
        'total': '10.0000',
      });
      expect(without.currencyCode, isNull);
    });

    test('SaleSession starts in the tenant currency it is given (empty ticket totals)', () {
      final session = SaleSession(currencyCode: 'USD');
      expect(session.currencyCode, 'USD');
      expect(session.total.currencyCode, 'USD');
      expect(SaleSession().currencyCode, 'MXN'); // legacy default only
    });

    test('the card-terminal payment body carries the sale currency, never an assumed one', () async {
      late http.Request captured;
      final gateway = ApiPosPaymentsGateway(
        ApiClient(
          baseUrl: Uri.parse('https://api.test.asone.mx/'),
          transport: _FakeClient((request) {
            captured = request as http.Request;
            return _envelope({'id': 'pay-1', 'status': 'pending', 'attempts': <Object?>[]});
          }),
          readAccessToken: () => 'access-token',
          createCorrelationId: () => 'correlation-test',
        ),
        createIdempotencyKey: () => 'key-1',
      );
      await gateway.createCardTerminalPayment(
        saleId: 'sale-1',
        amount: '10.0000',
        terminalId: 't-1',
        currencyCode: 'USD',
      );
      final body = jsonDecode(captured.body) as Map<String, Object?>;
      expect(body['currency_code'], 'USD');
      expect(body['payment_method'], 'card_terminal');

      await gateway.createCardTerminalPayment(saleId: 'sale-1', amount: '10.0000', terminalId: 't-1');
      final bodyWithout = jsonDecode(captured.body) as Map<String, Object?>;
      expect(bodyWithout.containsKey('currency_code'), isFalse);
    });
  });
}

final _tokenSession = SessionContext(
  id: 'session-id',
  userId: 'user-id',
  companyId: 'company-id',
  branchId: 'branch-id',
  permittedBranchIds: const ['branch-id'],
  companyWideAccess: false,
  expiresAt: DateTime.utc(2099),
);

AuthenticatedContext _context(List<CompanySummary> companies) => AuthenticatedContext(
  session: _tokenSession,
  user: const UserSummary(id: 'user-id', displayName: 'Usuario QA', email: 'user@example.test'),
  companies: companies,
  branches: const [],
  companyWideAccess: false,
  permissions: const [],
);

ApiAuthGateway _gateway({required Map<String, Object?> companyItem}) {
  final vault = MemoryTokenVault()..replace('access-token');
  return ApiAuthGateway(
    client: ApiClient(
      baseUrl: Uri.parse('https://api.test.asone.mx/'),
      transport: _FakeClient((request) {
        final path = request.url.path;
        if (path.endsWith('/auth/session')) {
          return _envelope({
            'id': 'session-id',
            'company_id': 'company-id',
            'branch_id': 'branch-id',
            'permitted_branch_ids': ['branch-id'],
            'company_wide_access': false,
            'expires_at': '2099-01-01T00:00:00.000Z',
          });
        }
        if (path.endsWith('/auth/me')) {
          return _envelope({'id': 'user-id', 'display_name': 'Usuario QA', 'email': 'user@example.test'});
        }
        if (path.endsWith('/context/companies')) {
          return _envelope({
            'items': [companyItem],
          });
        }
        if (path.endsWith('/context/branches')) {
          return _envelope({'company_wide_access': false, 'items': <Object?>[]});
        }
        if (path.endsWith('/auth/permissions')) {
          return _envelope({'permissions': <Object?>[]});
        }
        return http.Response('not found', 404);
      }),
      readAccessToken: () => vault.accessToken,
      createCorrelationId: () => 'correlation-test',
    ),
    vault: vault,
    readCsrfToken: () => null,
  );
}

http.Response _envelope(Map<String, Object?> data) => http.Response(
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
