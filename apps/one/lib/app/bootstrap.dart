import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/config/app_config.dart';
import '../core/telemetry/telemetry.dart';
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
  runApp(
    AsOneApp(
      config: config,
      authController: AuthController(const AuthStatus.unauthenticated()),
      telemetry: telemetry,
    ),
  );
}
