import 'package:as_one/app/app.dart';
import 'package:as_one/app/router.dart';
import 'package:as_one/core/errors/app_error.dart';
import 'package:as_one/core/networking/api_client.dart';
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
    expect(find.text('Iniciar sesión'), findsOneWidget);
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
    expect(find.text('Iniciar sesión'), findsOneWidget);
  });

  testWidgets(
    'production deep link to the dev first-run preview redirects to login',
    (tester) async {
      final auth = testAuthController()..retry();
      final router = createRouter(
        auth,
        const NoopTelemetry(),
        initialLocation: '/dev/first-run-preview',
      ); // environment defaults to production — no explicit bypass.
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
      expect(find.text('Iniciar sesión'), findsOneWidget);
      expect(find.text('¡Bienvenido a ACCESS GO!'), findsNothing);
    },
  );

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

  testWidgets(
    'TASK 17.7.3: a failed branch switch leaves the user on the dashboard with a dismissible notice, never on login',
    (tester) async {
      final gateway = FakeAuthGateway()
        ..switchBranchError = const ApiException(
          AppFailure(AppErrorKind.unavailable, 'sin conexión', code: 'api_unavailable'),
        );
      final auth = testAuthController(gateway)..retry();
      await auth.login(identifier: 'user@example.test', password: 'password-1');
      final router = createRouter(auth, const NoopTelemetry(), initialLocation: '/dashboard');
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
      expect(find.byKey(const Key('branch-switch-failure')), findsNothing);

      await auth.selectBranch('branch-id');
      await tester.pumpAndSettle();

      expect(gateway.switchBranchCalls, 1);
      expect(find.text('Iniciar sesión'), findsNothing);
      expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
      expect(find.byKey(const Key('branch-switch-failure')), findsOneWidget);

      await tester.tap(find.byKey(const Key('branch-switch-failure-dismiss')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('branch-switch-failure')), findsNothing);
    },
  );
}
