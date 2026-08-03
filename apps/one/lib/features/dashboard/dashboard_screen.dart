import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../design_system/components/as_components.dart';
import '../pos/pos_read_controller.dart';
import '../pos/pos_shell.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  PosReadController? controller;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    controller ??= PosReadController(PlatformScope.of(context).posReadGateway);
  }

  @override
  void dispose() {
    controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final current = auth.context;
    if (current == null) {
      return const Scaffold(
        body: Center(child: AsLoadingIndicator(label: 'Actualizando sesión')),
      );
    }
    return PosShell(
      context: current,
      controller: controller!,
      onLogout: auth.logout,
    );
  }
}
