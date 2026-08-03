import 'package:as_one/app/app.dart';
import 'package:as_one/core/config/app_config.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/auth_fakes.dart';

void main() {
  final config = AppConfig(
    environment: AsEnvironment.test,
    apiBaseUrl: Uri(scheme: 'https', host: 'api.test.asone.mx'),
    appName: 'AS ONE Test',
    telemetryEnabled: false,
  );
  const viewports = <String, Size>{
    'mobile': Size(390, 844),
    'tablet': Size(820, 1180),
    'desktop': Size(1440, 900),
  };

  for (final entry in viewports.entries) {
    testWidgets('renders real login controls at ${entry.key} size', (
      tester,
    ) async {
      tester.view.physicalSize = entry.value;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final auth = testAuthController()..retry();
      await tester.pumpWidget(
        AsOneApp(
          config: config,
          authController: auth,
          telemetry: const NoopTelemetry(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Bienvenido'), findsOneWidget);
      expect(find.byKey(const Key('login-identifier')), findsOneWidget);
      expect(find.text('Continuar'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('authenticated state redirects to the real context shell', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final auth = testAuthController()..retry();
    await auth.login(identifier: 'user@example.test', password: 'password-1');
    await tester.pumpWidget(
      AsOneApp(
        config: config,
        authController: auth,
        telemetry: const NoopTelemetry(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Centro de control'), findsOneWidget);
    expect(find.text('Sucursal Centro'), findsWidgets);
    expect(find.text('Conectado'), findsOneWidget);
  });
}
