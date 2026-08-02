import 'package:as_one/app/app.dart';
import 'package:as_one/core/config/app_config.dart';
import 'package:as_one/core/telemetry/telemetry.dart';
import 'package:as_one/features/authentication/auth_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

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
    testWidgets('renders the login foundation at ${entry.key} size', (
      tester,
    ) async {
      tester.view.physicalSize = entry.value;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        AsOneApp(
          config: config,
          authController: AuthController(const AuthStatus.unauthenticated()),
          telemetry: const _NoopTelemetry(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Bienvenido'), findsOneWidget);
      expect(find.text('AS ONE'), findsWidgets);
      expect(
        find.text('You have pushed the button this many times:'),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'authenticated state redirects to the responsive dashboard shell',
    (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final auth = AuthController(const AuthStatus.unauthenticated());
      await tester.pumpWidget(
        AsOneApp(
          config: config,
          authController: auth,
          telemetry: const _NoopTelemetry(),
        ),
      );
      await tester.pumpAndSettle();
      auth.transition(const AuthStatus.authenticated());
      await tester.pumpAndSettle();
      expect(find.text('Centro de control'), findsOneWidget);
      expect(find.byIcon(Icons.space_dashboard_outlined), findsOneWidget);
    },
  );
}

class _NoopTelemetry implements Telemetry {
  const _NoopTelemetry();
  @override
  void recordEvent(String name, {Map<String, Object?> attributes = const {}}) {}
  @override
  void recordFailure(String operation, Object error) {}
}
