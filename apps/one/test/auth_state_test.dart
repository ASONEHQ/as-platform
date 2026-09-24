import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/authentication/auth_state.dart';
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

  // TASK 16.23E — a reactive refresh (the one `ApiClient.onUnauthorized`
  // fires mid-session on a real 401, NOT the bootstrap-time one the two
  // tests above already cover) used to leave the controller silently
  // stuck at its prior phase on failure: the stale token was never
  // cleared and the router never redirected to `/login`, so every
  // subsequent authenticated screen repeated the same 401→refresh→
  // failure cycle for the rest of the session. Reproduces the exact
  // production shape: a session that was genuinely authenticated first,
  // then a later reactive refresh fails with a code `_handleFailure`
  // does not special-case (`validation_error` — e.g. a transport-mode
  // mismatch on the backend), which must still move the controller out
  // of `authenticated` so the app can recover.
  test(
    'a reactive refresh failure after a real 401 does not leave the session silently stuck',
    () async {
      final gateway = FakeAuthGateway();
      final controller = testAuthController(gateway);
      await controller.bootstrapSession();
      expect(controller.phase, AuthPhase.authenticated);

      gateway.refreshError = const ApiException(
        AppFailure(
          AppErrorKind.validation,
          'Refresh transport is invalid.',
          code: 'validation_error',
        ),
      );
      await expectLater(controller.refresh(), throwsA(isA<ApiException>()));

      expect(controller.phase, AuthPhase.failure);
      expect(controller.state.failure?.code, 'validation_error');
    },
  );

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

  // TASK 15.1 Phase 5: real PIN/QR quick-switch session hand-off.
  group('quickSwitchByPin/quickSwitchByQr', () {
    Future<AuthController> loggedIn(FakeAuthGateway gateway) async {
      final controller = testAuthController(gateway)..retry();
      await controller.login(
        identifier: 'user@example.test',
        password: 'password-1',
      );
      expect(controller.phase, AuthPhase.authenticated);
      return controller;
    }

    test('a valid PIN genuinely adopts a different staff session', () async {
      final gateway = FakeAuthGateway();
      final controller = await loggedIn(gateway);
      final before = controller.context;

      final newSession = SessionContext(
        id: 'session-cashier-2',
        userId: 'user-cashier-2',
        companyId: testSession.companyId,
        branchId: testSession.branchId,
        permittedBranchIds: testSession.permittedBranchIds,
        companyWideAccess: false,
        expiresAt: testSession.expiresAt,
      );
      gateway.switchByPinCredentials = SessionCredentials(
        accessToken: 'access-token-cashier-2',
        csrfToken: 'csrf-token-cashier-2',
        session: newSession,
      );
      gateway.hydrated = AuthenticatedContext(
        session: newSession,
        user: const UserSummary(
          id: 'user-cashier-2',
          displayName: 'Cajero Dos',
          email: 'cajero2@example.test',
        ),
        companies: testContext.companies,
        branches: testContext.branches,
        companyWideAccess: false,
        permissions: const ['sale.create'],
      );

      await controller.quickSwitchByPin('4321');

      expect(gateway.switchByPinCalls, 1);
      expect(gateway.lastPin, '4321');
      expect(controller.phase, AuthPhase.authenticated);
      expect(controller.context, isNot(same(before)));
      expect(controller.context?.user.displayName, 'Cajero Dos');
      expect(controller.context?.user.id, 'user-cashier-2');
      expect(controller.csrfToken, 'csrf-token-cashier-2');
    });

    test(
      'an invalid PIN surfaces the honest, uniform invalid_credentials '
      'denial and leaves the current session/context completely unchanged',
      () async {
        final gateway = FakeAuthGateway()
          ..switchByPinError = const ApiException(
            AppFailure(
              AppErrorKind.authentication,
              'Los datos de acceso no son válidos.',
              code: 'invalid_credentials',
            ),
            statusCode: 401,
          );
        final controller = await loggedIn(gateway);
        final before = controller.context;

        await controller.quickSwitchByPin('0000');

        // Never silently logged out and never left half-switched: same
        // phase, same context object, vault/csrf untouched.
        expect(controller.phase, AuthPhase.authenticated);
        expect(controller.context, same(before));
        expect(controller.csrfToken, 'csrf-token');
        expect(controller.state.failure?.code, 'invalid_credentials');
      },
    );

    test('a valid QR genuinely adopts a different staff session', () async {
      final gateway = FakeAuthGateway();
      final controller = await loggedIn(gateway);
      final before = controller.context;

      final newSession = SessionContext(
        id: 'session-cashier-3',
        userId: 'user-cashier-3',
        companyId: testSession.companyId,
        branchId: testSession.branchId,
        permittedBranchIds: testSession.permittedBranchIds,
        companyWideAccess: false,
        expiresAt: testSession.expiresAt,
      );
      gateway.switchByQrCredentials = SessionCredentials(
        accessToken: 'access-token-cashier-3',
        csrfToken: 'csrf-token-cashier-3',
        session: newSession,
      );
      gateway.hydrated = AuthenticatedContext(
        session: newSession,
        user: const UserSummary(
          id: 'user-cashier-3',
          displayName: 'Cajero Tres',
          email: 'cajero3@example.test',
        ),
        companies: testContext.companies,
        branches: testContext.branches,
        companyWideAccess: false,
        permissions: const ['sale.create'],
      );

      await controller.quickSwitchByQr('POS-QR-real-code');

      expect(gateway.switchByQrCalls, 1);
      expect(gateway.lastQrCode, 'POS-QR-real-code');
      expect(controller.phase, AuthPhase.authenticated);
      expect(controller.context, isNot(same(before)));
      expect(controller.context?.user.displayName, 'Cajero Tres');
    });

    test(
      'an invalid QR surfaces the honest denial and leaves the current '
      'session/context completely unchanged',
      () async {
        final gateway = FakeAuthGateway()
          ..switchByQrError = const ApiException(
            AppFailure(
              AppErrorKind.authentication,
              'Los datos de acceso no son válidos.',
              code: 'invalid_credentials',
            ),
            statusCode: 401,
          );
        final controller = await loggedIn(gateway);
        final before = controller.context;

        await controller.quickSwitchByQr('bad-code');

        expect(controller.phase, AuthPhase.authenticated);
        expect(controller.context, same(before));
        expect(controller.state.failure?.code, 'invalid_credentials');
      },
    );

    test(
      'a deactivated/unpermitted staff member gets the exact same uniform '
      'invalid_credentials denial as a plain wrong PIN — never a hint '
      'about which part was wrong (AuthService.pinLogin\'s own security '
      'model: matched == undefined always throws authError('
      '\'invalid_credentials\'), whether no PIN matched at all or the '
      'matched membership is no longer active)',
      () async {
        final gateway = FakeAuthGateway()
          ..switchByPinError = ApiException(
            AppFailure.fromCode('invalid_credentials'),
            statusCode: 401,
          );
        final controller = await loggedIn(gateway);
        final before = controller.context;

        await controller.quickSwitchByPin('1111');

        expect(controller.phase, AuthPhase.authenticated);
        expect(controller.context, same(before));
        expect(controller.state.failure?.code, 'invalid_credentials');
        // The honest, generic message — no "usuario desactivado" or any
        // other specific hint.
        expect(
          controller.state.failure?.message,
          'Los datos de acceso no son válidos.',
        );
      },
    );

    test(
      'a resolved staff member without access to this branch is a real, '
      'honest 403 (auth.repository.ts resolveContext returning null -> '
      'auth.service.ts #createLoginSession throwing device_revoked/'
      'branch_scope_mismatch) — handled as an ordinary denial, current '
      'session/context left completely unchanged, never a fabricated '
      'branch-selection prompt',
      () async {
        final gateway = FakeAuthGateway()
          ..switchByPinError = const ApiException(
            AppFailure(
              AppErrorKind.unknown,
              'No fue posible completar la solicitud.',
            ),
            statusCode: 403,
          );
        final controller = await loggedIn(gateway);
        final before = controller.context;

        await controller.quickSwitchByPin('5555');

        expect(controller.phase, AuthPhase.authenticated);
        expect(controller.context, same(before));
        expect(controller.state.failure, isNotNull);
      },
    );

    test(
      'CONFIRMED real behavior: when the newly-adopted session genuinely '
      'has no branch of its own (branchId null, no company-wide access) '
      '— e.g. a company-wide terminal quick-switching to a branch-scoped '
      'employee — _acceptCredentials falls through to '
      'branchSelectionRequired, exactly like a fresh login would',
      () async {
        final gateway = FakeAuthGateway();
        final controller = await loggedIn(gateway);

        final newSession = SessionContext(
          id: 'session-branchless',
          userId: 'user-branchless',
          companyId: testSession.companyId,
          permittedBranchIds: const ['branch-id', 'branch-id-2'],
          companyWideAccess: false,
          expiresAt: testSession.expiresAt,
        );
        gateway.switchByPinCredentials = SessionCredentials(
          accessToken: 'access-token-branchless',
          csrfToken: 'csrf-token-branchless',
          session: newSession,
        );
        gateway.hydrated = AuthenticatedContext(
          session: newSession,
          user: const UserSummary(
            id: 'user-branchless',
            displayName: 'Cajero Multi-Sucursal',
            email: 'multi@example.test',
          ),
          companies: testContext.companies,
          branches: const [
            BranchSummary(
              id: 'branch-id',
              code: 'CENTRO',
              name: 'Sucursal Centro',
              timezone: 'America/Mexico_City',
            ),
            BranchSummary(
              id: 'branch-id-2',
              code: 'NORTE',
              name: 'Sucursal Norte',
              timezone: 'America/Mexico_City',
            ),
          ],
          companyWideAccess: false,
          permissions: const ['sale.create'],
        );

        await controller.quickSwitchByPin('7777');

        expect(controller.phase, AuthPhase.branchSelectionRequired);
        expect(controller.context?.user.displayName, 'Cajero Multi-Sucursal');
        expect(controller.state.selectionBranches, hasLength(2));
      },
    );

    test(
      'an expired/revoked CURRENT terminal session surfaces as a real '
      'auth phase transition, not a crash — vault/csrf are cleared '
      'exactly like any other expired-session recovery in this class',
      () async {
        final gateway = FakeAuthGateway()
          ..switchByPinError = const ApiException(
            AppFailure(
              AppErrorKind.authentication,
              'safe',
              code: 'session_expired',
            ),
          );
        final controller = await loggedIn(gateway);

        await controller.quickSwitchByPin('9999');

        expect(controller.phase, AuthPhase.expired);
        expect(controller.csrfToken, isNull);
      },
    );

    test('quickSwitchByPin/Qr are no-ops when not currently authenticated '
        '(mirrors switchCompany\'s own guard)', () async {
      final controller = testAuthController();
      expect(controller.phase, AuthPhase.bootstrapping);
      await controller.quickSwitchByPin('1234');
      expect(controller.phase, AuthPhase.bootstrapping);
      await controller.quickSwitchByQr('code');
      expect(controller.phase, AuthPhase.bootstrapping);
    });
  });
}
