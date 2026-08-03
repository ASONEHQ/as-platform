import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/auth_fakes.dart';

void main() {
  test('login hydrates one authoritative authenticated state', () async {
    final controller = testAuthController();
    controller.retry();
    await controller.login(
      identifier: 'user@example.test',
      password: 'password-1',
    );
    expect(controller.phase, AuthPhase.authenticated);
    expect(controller.context?.user.displayName, 'Usuario AS');
    expect(controller.csrfToken, 'csrf-token');
  });

  test('bootstrap serializes concurrent refresh callers', () async {
    final gateway = FakeAuthGateway();
    final controller = testAuthController(gateway);
    await controller.bootstrapSession();
    await Future.wait([
      controller.refresh(),
      controller.refresh(),
      controller.refresh(),
    ]);
    expect(controller.phase, AuthPhase.authenticated);
    expect(gateway.refreshCalls, 2);
  });

  test('maps revoked refresh to explicit revoked state', () async {
    final gateway = FakeAuthGateway()
      ..refreshError = const ApiException(
        AppFailure(
          AppErrorKind.authentication,
          'safe',
          code: 'session_revoked',
        ),
      );
    final controller = testAuthController(gateway);
    await controller.bootstrapSession();
    expect(controller.phase, AuthPhase.revoked);
  });

  test('keeps a company challenge only in memory and completes it', () async {
    final gateway = FakeAuthGateway()
      ..loginOutcome = LoginCompanySelection(
        challengeToken: 'challenge-token',
        expiresAt: DateTime.utc(2099),
        companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS')],
      );
    final controller = testAuthController(gateway)..retry();
    await controller.login(
      identifier: 'user@example.test',
      password: 'password-1',
    );
    expect(controller.phase, AuthPhase.companySelectionRequired);
    expect(controller.hasChallenge, isTrue);
    await controller.selectCompany('company-id');
    expect(controller.phase, AuthPhase.authenticated);
    expect(controller.hasChallenge, isFalse);
  });

  test(
    'requires explicit branch selection without company-wide access',
    () async {
      final gateway = FakeAuthGateway()
        ..hydrated = AuthenticatedContext(
          session: SessionContext(
            id: testSession.id,
            userId: testSession.userId,
            companyId: testSession.companyId,
            permittedBranchIds: testSession.permittedBranchIds,
            companyWideAccess: false,
            expiresAt: testSession.expiresAt,
          ),
          user: testContext.user,
          companies: testContext.companies,
          branches: testContext.branches,
          companyWideAccess: false,
          permissions: testContext.permissions,
        );
      final controller = testAuthController(gateway)..retry();
      await controller.login(
        identifier: 'user@example.test',
        password: 'password-1',
      );
      expect(controller.phase, AuthPhase.branchSelectionRequired);
      expect(controller.state.selectionBranches, hasLength(1));
    },
  );

  test('logout clears all in-memory session state', () async {
    final gateway = FakeAuthGateway();
    final controller = testAuthController(gateway)..retry();
    await controller.login(
      identifier: 'user@example.test',
      password: 'password-1',
    );
    await controller.logout();
    expect(controller.phase, AuthPhase.unauthenticated);
    expect(controller.context, isNull);
    expect(controller.csrfToken, isNull);
    expect(gateway.logoutCalls, 1);
  });
}
