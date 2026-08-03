import 'dart:async';

import 'package:as_one/core/storage/token_vault.dart';
import 'package:as_one/core/telemetry/telemetry.dart';
import 'package:as_one/features/authentication/auth_gateway.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/authentication/auth_state.dart';

final testSession = SessionContext(
  id: 'session-id',
  userId: 'user-id',
  companyId: 'company-id',
  permittedBranchIds: ['branch-id'],
  companyWideAccess: false,
  expiresAt: _future,
  branchId: 'branch-id',
);

final _future = DateTime.utc(2099);

final testContext = AuthenticatedContext(
  session: testSession,
  user: const UserSummary(
    id: 'user-id',
    displayName: 'Usuario AS',
    email: 'user@example.test',
  ),
  companies: const [
    CompanySummary(id: 'company-id', name: 'Empresa AS', current: true),
  ],
  branches: const [
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: false,
  permissions: const ['company.read'],
);

class FakeAuthGateway implements AuthGateway {
  final credentials = SessionCredentials(
    accessToken: 'access-token',
    csrfToken: 'csrf-token',
    session: testSession,
  );
  late LoginOutcome loginOutcome = LoginAuthenticated(credentials);
  AuthenticatedContext hydrated = testContext;
  Object? bootstrapError;
  Object? refreshError;
  Completer<LoginOutcome>? loginCompleter;
  int refreshCalls = 0;
  int logoutCalls = 0;

  @override
  Future<BrowserBootstrap> bootstrapBrowser() async {
    if (bootstrapError case final error?) throw error;
    return BrowserBootstrap(csrfToken: 'bootstrap-csrf', expiresAt: _future);
  }

  @override
  Future<LoginOutcome> login({
    required String identifier,
    required String password,
  }) async => loginCompleter?.future ?? loginOutcome;

  @override
  Future<SessionCredentials> completeCompanySelection({
    required String challengeToken,
    required String companyId,
    String? branchId,
  }) async => credentials;

  @override
  Future<SessionCredentials> switchBranch(String? branchId) async =>
      credentials;

  @override
  Future<SessionCredentials> switchCompany(
    String companyId, {
    String? branchId,
  }) async => credentials;

  @override
  Future<SessionCredentials> refresh(String csrfToken) async {
    refreshCalls++;
    if (refreshError case final error?) throw error;
    return credentials;
  }

  @override
  Future<AuthenticatedContext> hydrate(SessionContext session) async =>
      hydrated;

  @override
  Future<void> logout() async {
    logoutCalls++;
  }
}

class NoopTelemetry implements Telemetry {
  const NoopTelemetry();
  @override
  void recordEvent(String name, {Map<String, Object?> attributes = const {}}) {}
  @override
  void recordFailure(String operation, Object error) {}
}

AuthController testAuthController([FakeAuthGateway? gateway]) => AuthController(
  gateway ?? FakeAuthGateway(),
  MemoryTokenVault(),
  const NoopTelemetry(),
);
