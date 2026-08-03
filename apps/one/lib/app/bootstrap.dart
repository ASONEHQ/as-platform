import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/config/app_config.dart';
import '../core/networking/api_client.dart';
import '../core/networking/http_client_factory.dart';
import '../core/storage/token_vault.dart';
import '../core/telemetry/telemetry.dart';
import '../features/authentication/auth_gateway.dart';
import '../features/authentication/auth_state.dart';
import 'app.dart';

void bootstrap() {
  WidgetsFlutterBinding.ensureInitialized();
  final config = AppConfig.fromEnvironment();
  final telemetry = SafeTelemetry(config.environment);
  FlutterError.onError = (details) {
    telemetry.recordFailure('flutter.framework', details.exception);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    telemetry.recordFailure('flutter.unhandled', error);
    return true;
  };
  telemetry.recordEvent('app.start');
  final vault = MemoryTokenVault();
  late final AuthController authController;
  final api = ApiClient(
    baseUrl: config.apiBaseUrl,
    transport: createPlatformHttpClient(),
    readAccessToken: () => vault.accessToken,
    createCorrelationId: () =>
        'one-${DateTime.now().toUtc().microsecondsSinceEpoch}',
  );
  final gateway = ApiAuthGateway(
    client: api,
    vault: vault,
    readCsrfToken: () => authController.csrfToken,
  );
  authController = AuthController(gateway, vault, telemetry);
  api.onUnauthorized = authController.refresh;
  runApp(
    AsOneApp(
      config: config,
      authController: authController,
      telemetry: telemetry,
    ),
  );
  authController.bootstrapSession();
}
