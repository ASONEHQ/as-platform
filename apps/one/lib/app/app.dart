import 'package:flutter/material.dart';

import '../core/config/app_config.dart';
import '../core/telemetry/telemetry.dart';
import '../design_system/theme/as_theme.dart';
import '../features/authentication/auth_state.dart';
import 'router.dart';

class AsOneApp extends StatefulWidget {
  const AsOneApp({
    required this.config,
    required this.authController,
    required this.telemetry,
    super.key,
  });

  final AppConfig config;
  final AuthController authController;
  final Telemetry telemetry;

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
  );
}
