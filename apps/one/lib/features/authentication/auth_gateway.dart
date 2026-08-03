import '../../core/networking/api_client.dart';
import '../../core/storage/token_vault.dart';
import 'auth_models.dart';

abstract interface class AuthGateway {
  Future<BrowserBootstrap> bootstrapBrowser();
  Future<LoginOutcome> login({
    required String identifier,
    required String password,
  });
  Future<SessionCredentials> completeCompanySelection({
    required String challengeToken,
    required String companyId,
    String? branchId,
  });
  Future<SessionCredentials> switchCompany(
    String companyId, {
    String? branchId,
  });
  Future<SessionCredentials> switchBranch(String? branchId);
  Future<SessionCredentials> refresh(String csrfToken);
  Future<AuthenticatedContext> hydrate(SessionContext session);
  Future<void> logout();
}

class ApiAuthGateway implements AuthGateway {
  ApiAuthGateway({
    required this.client,
    required this.vault,
    required this.readCsrfToken,
  });

  final ApiClient client;
  final MemoryTokenVault vault;
  final String? Function() readCsrfToken;

  @override
  Future<BrowserBootstrap> bootstrapBrowser() async {
    final data = _data(
      await client.postJson(
        'api/v1/auth/browser-bootstrap',
        authenticated: false,
      ),
    );
    if (_string(data, 'result') != 'csrf_ready' ||
        _string(data, 'transport_mode') != 'browser') {
      throw const FormatException('Unexpected bootstrap response.');
    }
    return BrowserBootstrap(
      csrfToken: _string(data, 'csrf_token'),
      expiresAt: _date(data, 'csrf_expires_at'),
    );
  }

  @override
  Future<LoginOutcome> login({
    required String identifier,
    required String password,
  }) async {
    final data = _data(
      await client.postJson(
        'api/v1/auth/login',
        authenticated: false,
        body: {
          'identifier': identifier,
          'password': password,
          'client_type': 'browser',
          'transport_mode': 'browser',
        },
      ),
    );
    return switch (_string(data, 'result')) {
      'authenticated' => LoginAuthenticated(_credentials(data)),
      'company_selection_required' => LoginCompanySelection(
        challengeToken: _string(data, 'challenge_token'),
        expiresAt: _date(data, 'expires_at'),
        companies: _list(data, 'companies')
            .map(
              (value) => CompanySummary(
                id: _string(value, 'id'),
                name: _string(value, 'name'),
              ),
            )
            .toList(growable: false),
      ),
      _ => throw const FormatException('Unexpected login response.'),
    };
  }

  @override
  Future<SessionCredentials> completeCompanySelection({
    required String challengeToken,
    required String companyId,
    String? branchId,
  }) async => _credentials(
    _data(
      await client.postJson(
        'api/v1/auth/company-selections',
        authenticated: false,
        body: {
          'challenge_token': challengeToken,
          'company_id': companyId,
          'branch_id': ?branchId,
        },
      ),
    ),
  );

  @override
  Future<SessionCredentials> switchCompany(
    String companyId, {
    String? branchId,
  }) async => _credentials(
    _data(
      await client.postJson(
        'api/v1/auth/company-switches',
        csrfToken: _requiredCsrf(),
        body: {'company_id': companyId, 'branch_id': ?branchId},
      ),
    ),
  );

  @override
  Future<SessionCredentials> switchBranch(String? branchId) async =>
      _credentials(
        _data(
          await client.postJson(
            'api/v1/auth/branch-switches',
            csrfToken: _requiredCsrf(),
            body: {'branch_id': branchId},
          ),
        ),
      );

  @override
  Future<SessionCredentials> refresh(String csrfToken) async => _credentials(
    _data(
      await client.postJson(
        'api/v1/auth/refresh',
        csrfToken: csrfToken,
        authenticated: false,
      ),
    ),
  );

  @override
  Future<AuthenticatedContext> hydrate(SessionContext tokenSession) async {
    final sessionData = _data(
      await client.getJson('api/v1/auth/session', retryAfterRefresh: false),
    );
    final userData = _data(await client.getJson('api/v1/auth/me'));
    final companyData = _data(await client.getJson('api/v1/context/companies'));
    final branchData = _data(await client.getJson('api/v1/context/branches'));
    final permissionData = _data(
      await client.getJson('api/v1/auth/permissions'),
    );
    final companies = _list(companyData, 'items')
        .map(
          (value) => CompanySummary(
            id: _string(value, 'company_id'),
            name: _string(value, 'display_name'),
            current: _boolean(value, 'current'),
            switchPermitted: _boolean(value, 'switch_permitted'),
          ),
        )
        .toList(growable: false);
    final branches = _list(branchData, 'items')
        .map(
          (value) => BranchSummary(
            id: _string(value, 'branch_id'),
            code: _string(value, 'code'),
            name: _string(value, 'name'),
            timezone: _string(value, 'timezone'),
            current: _boolean(value, 'current'),
            isDefault: _boolean(value, 'is_default'),
          ),
        )
        .toList(growable: false);
    final branchId = _nullableString(sessionData, 'branch_id');
    final session = SessionContext(
      id: _string(sessionData, 'id'),
      userId: tokenSession.userId,
      companyId: _string(sessionData, 'company_id'),
      branchId: branchId,
      permittedBranchIds: _stringList(sessionData, 'permitted_branch_ids'),
      companyWideAccess: _boolean(sessionData, 'company_wide_access'),
      expiresAt: _date(sessionData, 'expires_at'),
    );
    return AuthenticatedContext(
      session: session,
      user: UserSummary(
        id: _string(userData, 'id'),
        displayName: _string(userData, 'display_name'),
        email: _string(userData, 'email'),
      ),
      companies: companies,
      branches: branches,
      companyWideAccess: _boolean(branchData, 'company_wide_access'),
      permissions: _stringList(permissionData, 'permissions'),
    );
  }

  @override
  Future<void> logout() async {
    await client.postJson('api/v1/auth/logout', csrfToken: _requiredCsrf());
  }

  String _requiredCsrf() {
    final value = readCsrfToken();
    if (value == null) throw const FormatException('Missing CSRF token.');
    return value;
  }

  SessionCredentials _credentials(Map<String, Object?> data) {
    if (_string(data, 'result') != 'authenticated') {
      throw const FormatException('Unexpected authentication response.');
    }
    final sessionData = _map(data, 'session');
    final credentials = SessionCredentials(
      accessToken: _string(data, 'access_token'),
      csrfToken: _string(data, 'csrf_token'),
      session: SessionContext(
        id: _string(sessionData, 'id'),
        userId: _string(sessionData, 'user_id'),
        companyId: _string(sessionData, 'company_id'),
        branchId: _nullableString(sessionData, 'branch_id'),
        permittedBranchIds: _stringList(sessionData, 'permitted_branch_ids'),
        companyWideAccess: _boolean(sessionData, 'company_wide_access'),
        expiresAt: _date(data, 'expires_at'),
      ),
    );
    vault.replace(credentials.accessToken);
    return credentials;
  }
}

Map<String, Object?> _data(Map<String, Object?> envelope) =>
    _map(envelope, 'data');

Map<String, Object?> _map(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is Map<String, Object?>) return value;
  throw FormatException('Missing object: $key');
}

List<Map<String, Object?>> _list(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is! List<Object?>) throw FormatException('Missing list: $key');
  return value
      .map((item) {
        if (item is Map<String, Object?>) return item;
        throw FormatException('Invalid list item: $key');
      })
      .toList(growable: false);
}

String _string(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Missing string: $key');
}

String? _nullableString(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value == null) return null;
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Invalid string: $key');
}

bool _boolean(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is bool) return value;
  throw FormatException('Missing boolean: $key');
}

DateTime _date(Map<String, Object?> source, String key) {
  final value = DateTime.tryParse(_string(source, key));
  if (value == null) throw FormatException('Invalid date: $key');
  return value.toUtc();
}

List<String> _stringList(Map<String, Object?> source, String key) {
  final value = source[key];
  if (value is! List<Object?> || value.any((item) => item is! String)) {
    throw FormatException('Invalid string list: $key');
  }
  return value.cast<String>().toList(growable: false);
}
