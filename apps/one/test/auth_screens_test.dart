import 'dart:async';

import 'package:as_one/app/app.dart';
import 'package:as_one/core/config/app_config.dart';
import 'package:as_one/features/authentication/auth_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/auth_fakes.dart';

void main() {
  final config = AppConfig(
    environment: AsEnvironment.test,
    apiBaseUrl: Uri.parse('https://api.test.asone.mx'),
    appName: 'AS ONE Test',
    telemetryEnabled: false,
  );

  testWidgets(
    'validates login, toggles password visibility and shows loading',
    (tester) async {
      final gateway = FakeAuthGateway()
        ..loginCompleter = Completer<LoginOutcome>();
      final auth = testAuthController(gateway)..retry();
      await tester.pumpWidget(
        AsOneApp(
          config: config,
          authController: auth,
          telemetry: const NoopTelemetry(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continuar'));
      await tester.pump();
      expect(
        find.text('Ingresa un correo y una contraseña válidos.'),
        findsOneWidget,
      );
      expect(find.byTooltip('Mostrar contraseña'), findsOneWidget);
      await tester.tap(find.byTooltip('Mostrar contraseña'));
      await tester.pump();
      expect(find.byTooltip('Ocultar contraseña'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('login-identifier')),
        'user@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('login-password')),
        'password-1',
      );
      await tester.tap(find.text('Continuar'));
      await tester.pump();
      expect(find.text('Validando…'), findsOneWidget);
      gateway.loginCompleter!.complete(gateway.loginOutcome);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
    },
  );

  testWidgets('renders and activates server-provided company choices', (
    tester,
  ) async {
    final gateway = FakeAuthGateway()
      ..loginOutcome = LoginCompanySelection(
        challengeToken: 'challenge-token',
        expiresAt: DateTime.utc(2099),
        companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS')],
      );
    final auth = testAuthController(gateway)..retry();
    await auth.login(identifier: 'user@example.test', password: 'password-1');
    await tester.pumpWidget(
      AsOneApp(
        config: config,
        authController: auth,
        telemetry: const NoopTelemetry(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Selecciona una empresa'), findsOneWidget);
    expect(find.text('Empresa AS'), findsOneWidget);
    await tester.tap(find.text('Empresa AS'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
  });

  testWidgets(
    'renders explicit branch choices and no inferred corporate option',
    (tester) async {
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
      final auth = testAuthController(gateway)..retry();
      await auth.login(identifier: 'user@example.test', password: 'password-1');
      await tester.pumpWidget(
        AsOneApp(
          config: config,
          authController: auth,
          telemetry: const NoopTelemetry(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Selecciona una sucursal'), findsOneWidget);
      expect(find.text('Sucursal Centro'), findsOneWidget);
      expect(find.text('Todas las sucursales'), findsNothing);
    },
  );

  testWidgets('logout is accessible from the authenticated shell', (
    tester,
  ) async {
    final gateway = FakeAuthGateway();
    final auth = testAuthController(gateway)..retry();
    await auth.login(identifier: 'user@example.test', password: 'password-1');
    await tester.pumpWidget(
      AsOneApp(
        config: config,
        authController: auth,
        telemetry: const NoopTelemetry(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Cuenta'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cerrar sesión'));
    await tester.pumpAndSettle();
    expect(find.text('Bienvenido'), findsOneWidget);
    expect(gateway.logoutCalls, 1);
  });
}
