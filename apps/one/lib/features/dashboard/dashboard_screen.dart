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
      salesGateway: PlatformScope.of(context).posSalesGateway,
      paymentsGateway: PlatformScope.of(context).posPaymentsGateway,
      cashGateway: PlatformScope.of(context).posCashGateway,
      refundsGateway: PlatformScope.of(context).posRefundsGateway,
      onLogout: auth.logout,
      // TASK: POS branch-context fix — the exact same canonical
      // session-branch switch the login-time `BranchSelectionScreen`
      // already uses (`AuthController.selectBranch`), threaded down as a
      // callback rather than importing `AuthScope` into `pos_shell.dart`
      // — matches how `onLogout` is already passed, keeps the POS shell
      // decoupled from the auth-state layer, and avoids a circular
      // import (`app.dart` → router → `dashboard_screen.dart` →
      // `pos_shell.dart`).
      onBranchSelected: auth.selectBranch,
    );
  }
}
