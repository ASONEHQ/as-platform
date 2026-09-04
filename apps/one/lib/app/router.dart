import 'package:go_router/go_router.dart';

import '../core/config/app_config.dart';
import '../core/telemetry/telemetry.dart';
import '../features/authentication/auth_models.dart';
import '../features/authentication/auth_state.dart';
import '../features/authentication/first_run_wizard_screen.dart';
import '../features/authentication/screens.dart';
import '../features/dashboard/dashboard_screen.dart';

/// A path prefix reachable regardless of [AuthPhase] — but only ever
/// linked to from the UI when [AsEnvironment] isn't production (see
/// `LoginFoundationScreen`). This is plain routing plumbing, not a real
/// auth phase: it never appears in the `AuthPhase` switch below except as
/// an explicit bypass of the forced-redirect-to-login guard, and it never
/// grants access to `/dashboard` or any authenticated route.
const _devPreviewPathPrefix = '/dev/';

GoRouter createRouter(
  AuthController auth,
  Telemetry telemetry, {
  String initialLocation = '/bootstrap',
  AsEnvironment environment = AsEnvironment.production,
}) => GoRouter(
  initialLocation: initialLocation,
  refreshListenable: auth,
  observers: [TelemetryRouteObserver(telemetry)],
  redirect: (context, state) {
    final route = state.matchedLocation;
    if (environment != AsEnvironment.production &&
        route.startsWith(_devPreviewPathPrefix)) {
      return null;
    }
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
      path: '/dev/first-run-preview',
      builder: (_, _) => const FirstRunWizardPreviewScreen(),
    ),
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
