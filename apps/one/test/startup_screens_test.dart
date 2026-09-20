import 'package:as_one/app/app.dart';
import 'package:as_one/core/config/app_config.dart';
import 'package:as_one/features/authentication/screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/auth_fakes.dart';

/// TASK 12.2F: the startup/login flow ported from `AS POS V1.html`'s
/// `#pos-splash` / `#modal-login.gate-activo` / `#aspos-wizard`.
void main() {
  AppConfig config({AsEnvironment environment = AsEnvironment.test}) =>
      AppConfig(
        environment: environment,
        apiBaseUrl: Uri.parse('https://api.test.asone.mx'),
        appName: 'AS ONE Test',
        telemetryEnabled: false,
      );

  Future<void> pumpLogin(
    WidgetTester tester, {
    AsEnvironment environment = AsEnvironment.test,
  }) async {
    // A generous desktop viewport: the login card (tabs + PIN keypad +
    // links) and the wizard preview (fields + logo mark + back link) are
    // both tall enough that the default 800x600 test surface clips the
    // bottom controls out of hit-test range.
    tester.view.physicalSize = const Size(1440, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final auth = testAuthController()..retry();
    await tester.pumpWidget(
      AsOneApp(
        config: config(environment: environment),
        authController: auth,
        telemetry: const NoopTelemetry(),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('Login gate visual fidelity (TASK 12.2F)', () {
    testWidgets('renders V1-matching branding, tabs, and AI badge', (
      tester,
    ) async {
      await pumpLogin(tester);
      expect(find.text('Iniciar sesión'), findsOneWidget);
      expect(find.text('CONTROLA. VENDE. CRECE.'), findsOneWidget);
      expect(find.text('Plataforma ACCESS GO · Acceso seguro'), findsOneWidget);
      // "Contraseña" labels both the tab and the active tab's field.
      expect(find.text('Contraseña'), findsNWidgets(2));
      expect(find.text('PIN'), findsOneWidget);
      expect(find.text('QR'), findsOneWidget);
      expect(find.text('Entrar'), findsOneWidget);
      expect(find.byKey(const Key('startup-login-close')), findsOneWidget);
      expect(find.byKey(const Key('startup-ai-fab')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('close button is a mandatory gate, not a dismiss control', (
      tester,
    ) async {
      await pumpLogin(tester);
      await tester.tap(find.byKey(const Key('startup-login-close')));
      await tester.pump();
      expect(
        find.text('Debes iniciar sesión para continuar'),
        findsOneWidget,
      );
      // Still on the login screen — the gate never actually closes.
      expect(find.text('Iniciar sesión'), findsOneWidget);
    });

    testWidgets('PIN and QR tabs render but are visually-inert', (
      tester,
    ) async {
      await pumpLogin(tester);
      await tester.tap(find.text('PIN'));
      await tester.pumpAndSettle();
      expect(find.text('Ingresa tu PIN de 4 dígitos'), findsOneWidget);
      await tester.tap(find.text('Entrar'));
      await tester.pump();
      expect(
        find.textContaining('estará disponible cuando su backend'),
        findsOneWidget,
      );

      await tester.tap(find.text('QR'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Escanea tu código QR personal'),
        findsOneWidget,
      );
    });

    testWidgets('admin-access and close-session links are inert notices', (
      tester,
    ) async {
      await pumpLogin(tester);
      await tester.tap(find.byKey(const Key('startup-no-account-link')));
      await tester.pump();
      expect(
        find.textContaining('Pide a tu administrador que te cree'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('startup-close-session-link')));
      await tester.pump();
      expect(
        find.text('No hay una sesión activa que cerrar.'),
        findsOneWidget,
      );
    });

    testWidgets('AI badge is present but inert', (tester) async {
      await pumpLogin(tester);
      await tester.tap(find.byKey(const Key('startup-ai-fab')));
      await tester.pump();
      expect(
        find.textContaining('El asistente estará disponible'),
        findsOneWidget,
      );
    });

    testWidgets(
      'real Contraseña submission still drives AuthController.login',
      (tester) async {
        await pumpLogin(tester);
        await tester.enterText(
          find.byKey(const Key('login-identifier')),
          'user@example.test',
        );
        await tester.enterText(
          find.byKey(const Key('login-password')),
          'password-1',
        );
        await tester.tap(find.text('Entrar'));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pos-topbar')), findsOneWidget);
      },
    );
  });

  group('ACCESS GO logo contrast (TASK 16.12A)', () {
    testWidgets(
      'splash renders the WHITE mark against the strong blue background',
      (tester) async {
        // Not pumpLogin/pumpAndSettle: the splash's own loading spinner is
        // an indeterminate animation that never settles.
        await tester.pumpWidget(const MaterialApp(home: BootstrapScreen()));
        await tester.pump();
        final logo = tester.widget<Image>(find.byType(Image).first);
        expect(
          (logo.image as AssetImage).assetName,
          'assets/branding/access_go_logo_white.png',
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'login card keeps the NORMAL (blue/cyan) mark on its light surface',
      (tester) async {
        await pumpLogin(tester);
        final logo = tester.widget<Image>(find.byType(Image).first);
        expect(
          (logo.image as AssetImage).assetName,
          'assets/branding/access_go_logo.png',
        );
      },
    );
  });

  group('First-run wizard preview gating (TASK 12.2F)', () {
    testWidgets('preview link is hidden in production', (tester) async {
      await pumpLogin(tester, environment: AsEnvironment.production);
      expect(
        find.byKey(const Key('dev-first-run-preview-link')),
        findsNothing,
      );
    });

    testWidgets('preview link is visible outside production', (
      tester,
    ) async {
      await pumpLogin(tester, environment: AsEnvironment.local);
      expect(
        find.byKey(const Key('dev-first-run-preview-link')),
        findsOneWidget,
      );
    });

    testWidgets(
      'preview is visual-only: matches V1 fields, defers activation, '
      'never authenticates',
      (tester) async {
        await pumpLogin(tester, environment: AsEnvironment.local);
        await tester.tap(
          find.byKey(const Key('dev-first-run-preview-link')),
        );
        await tester.pumpAndSettle();

        expect(find.text('¡Bienvenido a ACCESS GO!'), findsOneWidget);
        expect(find.byKey(const Key('wiz-clave')), findsOneWidget);
        expect(find.byKey(const Key('wiz-nombre-negocio')), findsOneWidget);
        expect(find.byKey(const Key('wiz-admin-nombre')), findsOneWidget);
        expect(find.byKey(const Key('wiz-admin-user')), findsOneWidget);
        expect(find.byKey(const Key('wiz-admin-pin')), findsOneWidget);
        expect(find.byKey(const Key('wiz-admin-pin2')), findsOneWidget);

        await tester.enterText(
          find.byKey(const Key('wiz-clave')),
          'ASPOS-TEST-TEST-TEST',
        );
        await tester.tap(find.text('Comenzar'));
        await tester.pump();
        expect(
          find.textContaining('Activación pendiente'),
          findsOneWidget,
        );
        // Never authenticates — no dashboard chrome appears.
        expect(find.byKey(const Key('pos-topbar')), findsNothing);

        await tester.tap(find.byKey(const Key('wiz-back-to-login')));
        await tester.pumpAndSettle();
        expect(find.text('Iniciar sesión'), findsOneWidget);
      },
    );
  });
}
