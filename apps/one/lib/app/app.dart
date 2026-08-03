import 'package:flutter/material.dart';

import '../core/config/app_config.dart';
import '../core/telemetry/telemetry.dart';
import '../design_system/theme/as_theme.dart';
import '../features/authentication/auth_state.dart';
import '../features/pos/pos_read_gateway.dart';
import 'router.dart';

class AsOneApp extends StatefulWidget {
  const AsOneApp({
    required this.config,
    required this.authController,
    required this.telemetry,
    this.posReadGateway = const EmptyPosReadGateway(),
    super.key,
  });

  final AppConfig config;
  final AuthController authController;
  final Telemetry telemetry;
  final PosReadGateway posReadGateway;

  @override
  State<AsOneApp> createState() => _AsOneAppState();
}

class _AsOneAppState extends State<AsOneApp> {
  late final router = createRouter(widget.authController, widget.telemetry);

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: widget.config.appName,
    debugShowCheckedModeBanner: false,
    theme: AsTheme.light(),
    routerConfig: router,
    builder: (context, child) => PlatformScope(
      posReadGateway: widget.posReadGateway,
      child: AuthScope(
        controller: widget.authController,
        child: child ?? const SizedBox.shrink(),
      ),
    ),
  );
}

class PlatformScope extends InheritedWidget {
  const PlatformScope({
    required this.posReadGateway,
    required super.child,
    super.key,
  });

  final PosReadGateway posReadGateway;

  static PlatformScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<PlatformScope>();
    assert(scope != null, 'PlatformScope is missing.');
    return scope!;
  }

  @override
  bool updateShouldNotify(PlatformScope oldWidget) =>
      posReadGateway != oldWidget.posReadGateway;
}

class AuthScope extends InheritedNotifier<AuthController> {
  const AuthScope({
    required AuthController controller,
    required super.child,
    super.key,
  }) : super(notifier: controller);

  static AuthController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AuthScope>();
    assert(scope != null, 'AuthScope is missing.');
    return scope!.notifier!;
  }
}
