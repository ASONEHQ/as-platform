import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/errors/app_error.dart';
import '../../core/networking/api_client.dart';
import '../../design_system/components/as_components.dart';
import '../authentication/auth_models.dart';
import '../authentication/auth_state.dart';
import '../pos/pos_dashboard_gateway.dart';
import '../pos/pos_read_controller.dart';
import '../pos/pos_shell.dart';
import '../pos/pos_tokens.dart';

/// TASK 14.5A (final legacy parity correction) — real sales trend
/// (`vsAyer`) and birthday alerts (`generarAlertas()`'s cumpleaños-hoy
/// rule), the two remaining genuinely-real `renderDashboard()` figures
/// Wave 3 Phase 2 deliberately deferred (see `dashboard.types.ts`'s own
/// header comment).
///
/// The actual per-metric grid (`_Dashboard`/`_DashboardBody`) lives inside
/// `pos_shell.dart`, which this task is explicitly forbidden from
/// touching (owned by a sibling agent working in this same worktree).
/// Rather than silently dropping these two real fields, this screen
/// fetches the SAME `PosDashboardGateway.summary(...)` independently (a
/// deliberate, documented second request — never a fabricated or cached
/// copy of the pos_shell tab's own data) and renders them as a real,
/// always-visible top banner above `PosShell` — visible regardless of
/// which POS tab is active, matching how the legacy's own
/// `generarAlertas()` fed a single, always-visible alert list rather than
/// a per-tab one. Nothing here invents a metric, a trend, or an alert the
/// backend did not itself compute (same "no simulated metrics" rule
/// `_Dashboard` documents in `pos_shell.dart`).
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  PosReadController? controller;
  PosDashboardSummary? _bannerSummary;
  bool _bannerRequested = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    controller ??= PosReadController(PlatformScope.of(context).posReadGateway);
    _requestBannerSummary();
  }

  @override
  void dispose() {
    controller?.dispose();
    super.dispose();
  }

  /// Fetches once per screen instance — guarded by `_bannerRequested` so a
  /// later `didChangeDependencies` call (e.g. a theme/locale change) never
  /// re-fires the request. Best-effort only: a failure here never blocks
  /// or degrades the rest of the POS shell — it just means the banner
  /// stays absent, exactly like `_Dashboard`'s own failure state is
  /// scoped to its own tab, never the whole app.
  void _requestBannerSummary() {
    if (_bannerRequested) return;
    final auth = AuthScope.of(context);
    final current = auth.context;
    if (current == null) return;
    if (!current.permissions.contains('report.read')) return;
    _bannerRequested = true;
    final gateway = PlatformScope.of(context).posDashboardGateway;
    final today = _isoDate(DateTime.now());
    final branchId = current.companyWideAccess ? null : current.session.branchId;
    gateway
        .summary(date: today, branchId: branchId)
        .then((summary) {
          if (!mounted) return;
          setState(() => _bannerSummary = summary);
        })
        .catchError((Object _) {
          // Silently absent on failure — see this method's own doc comment.
        });
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
    final summary = _bannerSummary;
    return Column(
      children: [
        if (summary != null) _DashboardTopBanner(summary: summary),
        Expanded(
          child: PosShell(
            context: current,
            controller: controller!,
            salesGateway: PlatformScope.of(context).posSalesGateway,
            paymentsGateway: PlatformScope.of(context).posPaymentsGateway,
            cashGateway: PlatformScope.of(context).posCashGateway,
            refundsGateway: PlatformScope.of(context).posRefundsGateway,
            promotionsGateway: PlatformScope.of(context).posPromotionsGateway,
            customersGateway: PlatformScope.of(context).posCustomersGateway,
            membershipsGateway: PlatformScope.of(context).posMembershipsGateway,
            loyaltyGateway: PlatformScope.of(context).posLoyaltyGateway,
            rewardsGateway: PlatformScope.of(context).posRewardsGateway,
            partiesGateway: PlatformScope.of(context).posPartiesGateway,
            heldSalesGateway: PlatformScope.of(context).posHeldSalesGateway,
            purchasingGateway: PlatformScope.of(context).posPurchasingGateway,
            suppliersGateway: PlatformScope.of(context).posSuppliersGateway,
            reportsGateway: PlatformScope.of(context).posReportsGateway,
            accessGateway: PlatformScope.of(context).posAccessGateway,
            employeesGateway: PlatformScope.of(context).posEmployeesGateway,
            schedulesGateway: PlatformScope.of(context).posSchedulesGateway,
            timeClockGateway: PlatformScope.of(context).posTimeClockGateway,
            payrollGateway: PlatformScope.of(context).posPayrollGateway,
            dashboardGateway: PlatformScope.of(context).posDashboardGateway,
            settingsGateway: PlatformScope.of(context).posSettingsGateway,
            productVariantsGateway: PlatformScope.of(context).posProductVariantsGateway,
            assistantGateway: PlatformScope.of(context).posAssistantGateway,
            identityAdminGateway: PlatformScope.of(context).posIdentityAdminGateway,
            inventoryAdminGateway: PlatformScope.of(context).posInventoryAdminGateway,
            categoryAdminGateway: PlatformScope.of(context).posCategoryAdminGateway,
            brandAdminGateway: PlatformScope.of(context).posBrandAdminGateway,
            catalogAdminGateway: PlatformScope.of(context).posCatalogAdminGateway,
            branchAdminGateway: PlatformScope.of(context).posBranchAdminGateway,
            authGateway: PlatformScope.of(context).posAuthGateway,
            // TASK 15.1 Phase 5: real PIN/QR quick-switch session
            // hand-off — `AuthController.quickSwitchByPin`/
            // `quickSwitchByQr` already handle failure honestly (current
            // session/context left untouched, real error captured in
            // `auth.state.failure`, never a thrown exception) — see
            // `_adoptQuickSwitch` below for how this turns that into the
            // throw-on-failure/return-context-on-success contract
            // `_StaffQuickSwitchDialog` expects, exactly like
            // `onBranchSelected: auth.selectBranch` below reuses
            // `AuthController` directly without a new abstraction.
            onQuickSwitchByPin: (pin) =>
                _adoptQuickSwitch(auth, () => auth.quickSwitchByPin(pin)),
            onQuickSwitchByQr: (code) =>
                _adoptQuickSwitch(auth, () => auth.quickSwitchByQr(code)),
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
          ),
        ),
      ],
    );
  }
}

/// TASK 15.1 Phase 5: adapts `AuthController.quickSwitchByPin`/
/// `quickSwitchByQr` — which never throw; a real, honest failure is
/// surfaced by leaving `AuthController.context` unchanged (retained,
/// same object reference) and setting `AuthController.state.failure` —
/// into the throw-on-failure/return-the-new-context-on-success contract
/// `PosShell.onQuickSwitchByPin`/`onQuickSwitchByQr` expect (matching
/// `_StaffQuickSwitchDialog`'s existing `try`/`on ApiException` shape, so
/// that dialog's success/failure UI needs no new branching). Success is
/// detected by `context` genuinely changing identity: `_acceptCredentials`
/// always builds a brand-new `AuthenticatedContext` from a fresh
/// `hydrate()` call, so a real adoption is never `identical` to the
/// pre-call context — while every honest-failure path (including the
/// CURRENT session itself having expired/been revoked mid-dialog)
/// re-emits the exact SAME retained context object, which this detects
/// without needing any new `AuthController` state.
Future<AuthenticatedContext> _adoptQuickSwitch(
  AuthController auth,
  Future<void> Function() call,
) async {
  final before = auth.context;
  await call();
  final after = auth.context;
  if (identical(after, before)) {
    final failure = auth.state.failure;
    throw failure == null
        ? const ApiException(
            AppFailure(
              AppErrorKind.unknown,
              'No fue posible completar el cambio de sesión.',
            ),
          )
        : ApiException(failure);
  }
  return after!;
}

/// Device-local "today" ('YYYY-MM-DD') — mirrors `pos_shell.dart`'s own
/// private `_isoDate` implementation exactly (that one is library-private
/// to `pos_shell.dart`, so this is a deliberate, faithful copy, not a
/// divergent one — same convention `pos_dashboard_gateway.dart`'s own
/// header comment documents for `PosDashboardCurrencyAmount`).
String _isoDate(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

class _DashboardTopBanner extends StatelessWidget {
  const _DashboardTopBanner({required this.summary});
  final PosDashboardSummary summary;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final hasTrend = summary.salesTrendVsYesterday.isNotEmpty;
    final hasBirthdays = summary.birthdaysToday.isNotEmpty;
    if (!hasTrend && !hasBirthdays) return const SizedBox.shrink();
    return Container(
      key: const Key('pos-dashboard-top-banner'),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: palette.background,
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Wrap(
        spacing: 10,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final entry in summary.salesTrendVsYesterday) _SalesTrendChip(entry: entry, palette: palette),
          if (hasBirthdays) _BirthdayAlertChip(customers: summary.birthdaysToday, palette: palette),
        ],
      ),
    );
  }
}

/// Real today-vs-yesterday percent change (TASK 14.5A / legacy `vsAyer`).
/// `pctChange == null` renders the legacy's own honest "Sin datos de
/// ayer" — never a fabricated 0%/arrow.
class _SalesTrendChip extends StatelessWidget {
  const _SalesTrendChip({required this.entry, required this.palette});
  final PosDashboardSalesTrendEntry entry;
  final PosPalette palette;

  @override
  Widget build(BuildContext context) {
    final pct = entry.pctChange;
    final label = pct == null
        ? 'Sin datos de ayer (${entry.currencyCode})'
        : '${pct > 0 ? '+' : ''}$pct% vs. ayer (${entry.currencyCode})';
    final color = pct == null
        ? palette.textMuted
        : pct >= 0
        ? palette.success
        : palette.error;
    final icon = pct == null
        ? Icons.remove
        : pct >= 0
        ? Icons.trending_up
        : Icons.trending_down;
    return Container(
      key: Key('pos-dashboard-sales-trend-${entry.currencyCode}'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 6),
          Text(label, style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

/// Real live birthday alert (TASK 14.5A / legacy `generarAlertas()`'s
/// cumpleaños-hoy rule) — real customer names, never a decorative/dead
/// placeholder.
class _BirthdayAlertChip extends StatelessWidget {
  const _BirthdayAlertChip({required this.customers, required this.palette});
  final List<PosDashboardBirthdayCustomer> customers;
  final PosPalette palette;

  @override
  Widget build(BuildContext context) {
    final names = customers.map((customer) => customer.displayName).join(', ');
    return Container(
      key: const Key('pos-dashboard-birthday-alert'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.warning.withValues(alpha: .12),
        border: Border.all(color: palette.warning),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cake_outlined, size: 15, color: palette.warning),
          const SizedBox(width: 6),
          Text(
            '${customers.length} cumpleaños hoy: $names',
            style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}
