import 'package:as_one/app/app.dart';
import 'package:as_one/app/router.dart';
import 'package:as_one/features/pos/pos_read_gateway.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/auth_fakes.dart';

void main() {
  testWidgets('unauthenticated deep link cannot open the dashboard', (
    tester,
  ) async {
    final auth = testAuthController()..retry();
    final router = createRouter(
      auth,
      const NoopTelemetry(),
      initialLocation: '/dashboard',
    );
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        builder: (_, child) => PlatformScope(
          posReadGateway: const EmptyPosReadGateway(),
          child: AuthScope(controller: auth, child: child!),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Bienvenido'), findsOneWidget);
    expect(find.byKey(const Key('pos-topbar')), findsNothing);
  });

  testWidgets('missing challenge cannot open company selection', (
    tester,
  ) async {
    final auth = testAuthController()..retry();
    final router = createRouter(
      auth,
      const NoopTelemetry(),
      initialLocation: '/select-company',
    );
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        builder: (_, child) => PlatformScope(
          posReadGateway: const EmptyPosReadGateway(),
          child: AuthScope(controller: auth, child: child!),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Bienvenido'), findsOneWidget);
  });

  testWidgets('authenticated user cannot return to login', (tester) async {
    final auth = testAuthController()..retry();
    await auth.login(identifier: 'user@example.test', password: 'password-1');
    final router = createRouter(
      auth,
      const NoopTelemetry(),
      initialLocation: '/login',
    );
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        builder: (_, child) => PlatformScope(
          posReadGateway: const EmptyPosReadGateway(),
          child: AuthScope(controller: auth, child: child!),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
    expect(find.text('Bienvenido'), findsNothing);
  });
}
