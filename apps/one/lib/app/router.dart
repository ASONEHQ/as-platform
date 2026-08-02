import 'package:go_router/go_router.dart';

import '../core/telemetry/telemetry.dart';
import '../features/authentication/auth_state.dart';
import '../features/authentication/screens.dart';
import '../features/dashboard/dashboard_screen.dart';

GoRouter createRouter(AuthController auth, Telemetry telemetry) => GoRouter(
  initialLocation: '/bootstrap',
  refreshListenable: auth,
  observers: [TelemetryRouteObserver(telemetry)],
  redirect: (context, state) {
    final route = state.matchedLocation;
    final status = auth.status;
    if (route == '/bootstrap') return null;
    return switch (status.phase) {
      AuthPhase.unauthenticated ||
      AuthPhase.failure => route == '/login' ? null : '/login',
      AuthPhase.companySelectionRequired => '/select-company',
      AuthPhase.branchSelectionRequired => '/select-branch',
      AuthPhase.authenticated ||
      AuthPhase.refreshing => route == '/login' ? '/dashboard' : null,
      AuthPhase.authenticating => '/bootstrap',
      AuthPhase.expired || AuthPhase.revoked => '/login',
      AuthPhase.unavailable => '/unavailable',
    };
  },
  routes: [
    GoRoute(path: '/bootstrap', builder: (_, _) => const BootstrapScreen()),
    GoRoute(path: '/login', builder: (_, _) => const LoginFoundationScreen()),
    GoRoute(
      path: '/select-company',
      builder: (_, _) => const CompanySelectionScreen(),
    ),
    GoRoute(
      path: '/select-branch',
      builder: (_, _) => const BranchSelectionScreen(),
    ),
    GoRoute(path: '/dashboard', builder: (_, _) => const DashboardScreen()),
    GoRoute(path: '/unavailable', builder: (_, _) => const UnavailableScreen()),
  ],
  errorBuilder: (_, _) => const UnavailableScreen(notFound: true),
);
