import 'package:go_router/go_router.dart';

import '../core/telemetry/telemetry.dart';
import '../features/authentication/auth_models.dart';
import '../features/authentication/auth_state.dart';
import '../features/authentication/screens.dart';
import '../features/dashboard/dashboard_screen.dart';

GoRouter createRouter(
  AuthController auth,
  Telemetry telemetry, {
  String initialLocation = '/bootstrap',
}) => GoRouter(
  initialLocation: initialLocation,
  refreshListenable: auth,
  observers: [TelemetryRouteObserver(telemetry)],
  redirect: (context, state) {
    final route = state.matchedLocation;
    final phase = auth.phase;
    return switch (phase) {
      AuthPhase.bootstrapping => route == '/bootstrap' ? null : '/bootstrap',
      AuthPhase.unauthenticated ||
      AuthPhase.failure => route == '/login' ? null : '/login',
      AuthPhase.companySelectionRequired || AuthPhase.selectingCompany =>
        auth.hasChallenge || auth.context != null
            ? '/select-company'
            : '/login',
      AuthPhase.branchSelectionRequired || AuthPhase.selectingBranch =>
        auth.context != null ? '/select-branch' : '/login',
      AuthPhase.authenticated => route == '/dashboard' ? null : '/dashboard',
      AuthPhase.refreshing =>
        auth.context == null
            ? '/bootstrap'
            : route == '/dashboard'
            ? null
            : '/dashboard',
      AuthPhase.authenticating => '/bootstrap',
      AuthPhase.expired || AuthPhase.revoked => '/session-ended',
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
    GoRoute(
      path: '/session-ended',
      builder: (_, _) => const SessionEndedScreen(),
    ),
  ],
  errorBuilder: (_, _) => const UnavailableScreen(notFound: true),
);
