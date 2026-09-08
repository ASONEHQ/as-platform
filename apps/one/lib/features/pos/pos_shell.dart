import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/networking/api_client.dart';
import '../../design_system/tokens/as_tokens.dart';
import '../authentication/auth_models.dart';
import '../authentication/startup_visuals.dart';
import 'money.dart';
import 'pos_access_gateway.dart';
import 'pos_access_screen.dart';
import 'pos_assistant_gateway.dart';
import 'pos_assistant_screen.dart';
import 'pos_auth_gateway.dart';
import 'pos_cash_gateway.dart';
import 'pos_customers_gateway.dart';
import 'pos_dashboard_gateway.dart';
import 'pos_held_sales_gateway.dart';
import 'pos_loyalty_gateway.dart';
import 'pos_memberships_gateway.dart';
import 'pos_models.dart';
import 'pos_navigation.dart';
import 'pos_parties_gateway.dart';
import 'pos_parties_models.dart';
import 'pos_payments_gateway.dart';
import 'pos_people_gateway.dart';
import 'pos_people_screen.dart';
import 'pos_product_variants_gateway.dart';
import 'pos_product_variants_screen.dart';
import 'pos_promotions_gateway.dart';
import 'pos_purchasing_gateway.dart';
import 'pos_read_controller.dart';
import 'pos_receipt.dart';
import 'pos_receipt_branding_screen.dart';
import 'pos_refunds_gateway.dart';
import 'pos_reports_gateway.dart';
import 'pos_reports_screen.dart';
import 'pos_rewards_gateway.dart';
import 'pos_sales_gateway.dart';
import 'pos_settings_gateway.dart';
import 'pos_suppliers_gateway.dart';
import 'pos_suppliers_screen.dart';
import 'pos_tokens.dart';
import 'receipt_html.dart';
import 'receipt_print.dart';
import 'refund_receipt_html.dart';
import 'sale_folio.dart';
import 'sale_session.dart';

class PosShell extends StatefulWidget {
  const PosShell({
    required this.context,
    required this.controller,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    required this.refundsGateway,
    required this.promotionsGateway,
    required this.customersGateway,
    required this.membershipsGateway,
    required this.loyaltyGateway,
    required this.rewardsGateway,
    required this.partiesGateway,
    this.heldSalesGateway = const EmptyPosHeldSalesGateway(),
    this.purchasingGateway = const EmptyPosPurchasingGateway(),
    this.suppliersGateway = const EmptyPosSuppliersGateway(),
    this.reportsGateway = const EmptyPosReportsGateway(),
    this.accessGateway = const EmptyPosAccessGateway(),
    this.employeesGateway = const EmptyPosEmployeesGateway(),
    this.schedulesGateway = const EmptyPosSchedulesGateway(),
    this.timeClockGateway = const EmptyPosTimeClockGateway(),
    this.payrollGateway = const EmptyPosPayrollGateway(),
    this.dashboardGateway = const EmptyPosDashboardGateway(),
    this.settingsGateway = const EmptyPosSettingsGateway(),
    this.productVariantsGateway = const EmptyPosProductVariantsGateway(),
    this.assistantGateway = const EmptyPosAssistantGateway(),
    // TASK 14.5 (Wave 3, Phase 4b/7 Item 8): real quick-switch PIN/QR
    // staff login — see `pos_auth_gateway.dart`.
    this.authGateway = const EmptyPosAuthGateway(),
    required this.onLogout,
    required this.onBranchSelected,
    super.key,
  });

  final AuthenticatedContext context;
  final PosReadController controller;
  // TASK 12.4A.1: the one write path the ticket has today — see
  // `pos_sales_gateway.dart` and `_submitSaleForPayment` below.
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  // TASK 12.7: cash register/session/movement/close/summary/history — see
  // `pos_cash_gateway.dart` and ADR-0014.
  final PosCashGateway cashGateway;
  // TASK 12.8: refund request/completion/history — see
  // `pos_refunds_gateway.dart` and ADR-0015.
  final PosRefundsGateway refundsGateway;
  // TASK 12.9: pricing-quote preview plus promotions/coupons admin
  // management — see `pos_promotions_gateway.dart` and ADR-0016.
  final PosPromotionsGateway promotionsGateway;
  // TASK 13.0: customer identity/membership/loyalty foundation — see
  // `pos_customers_gateway.dart`/`pos_memberships_gateway.dart`/
  // `pos_loyalty_gateway.dart` and ADR-0017.
  final PosCustomersGateway customersGateway;
  final PosMembershipsGateway membershipsGateway;
  final PosLoyaltyGateway loyaltyGateway;
  // TASK 13.1: reward entitlements/redemption, layered on the foundation
  // above — see `pos_rewards_gateway.dart` and ADR-0018.
  final PosRewardsGateway rewardsGateway;
  // TASK 14.3 Wave 1 Part A: "Fiestas" (party reservations) — see
  // `pos_parties_gateway.dart` and `docs/LEGACY_FIESTAS_RECOVERY.md`.
  final PosPartiesGateway partiesGateway;
  // TASK 14.3 Wave 1 Part B.1: suspend/list/resume/link-sale/discard a
  // held-sale cart — see `pos_held_sales_gateway.dart`.
  final PosHeldSalesGateway heldSalesGateway;
  // TASK 14.3 Wave 1 Part C: direct purchase / quick restock — see
  // `pos_purchasing_gateway.dart`.
  final PosPurchasingGateway purchasingGateway;
  // TASK 14.4 (Wave 2, Part C.1): real supplier directory — see
  // `pos_suppliers_gateway.dart`.
  final PosSuppliersGateway suppliersGateway;
  // TASK 14.4 (Wave 2, Part D): Report Center — see
  // `pos_reports_gateway.dart`.
  final PosReportsGateway reportsGateway;
  // TASK 14.4 (Wave 2, Part E): Control de Acceso — see
  // `pos_access_gateway.dart`.
  final PosAccessGateway accessGateway;
  // TASK 14.4 (Wave 2, Part B): Empleados/Horarios/Checador/Nómina — see
  // `pos_people_gateway.dart`.
  final PosEmployeesGateway employeesGateway;
  final PosSchedulesGateway schedulesGateway;
  final PosTimeClockGateway timeClockGateway;
  final PosPayrollGateway payrollGateway;
  // TASK 14.5 (Wave 3, Phase 2): Dashboard ("today at a glance") — see
  // `pos_dashboard_gateway.dart`.
  final PosDashboardGateway dashboardGateway;
  // TASK 14.5 (Wave 3, Phase 8): per-tenant receipt header/footer
  // branding — see `pos_settings_gateway.dart`.
  final PosSettingsGateway settingsGateway;
  // TASK 14.5 (Wave 3, Phase 7, Item 3): product variants admin — see
  // `pos_product_variants_gateway.dart`.
  final PosProductVariantsGateway productVariantsGateway;
  // TASK 14.5 (Wave 3, Phase 7, Item 6): real deterministic FAQ
  // assistant — see `pos_assistant_gateway.dart`.
  final PosAssistantGateway assistantGateway;
  final PosAuthGateway authGateway;
  final VoidCallback onLogout;
  // POS branch-context fix: `AuthController.selectBranch` — the exact
  // canonical session-branch switch the login-time
  // `BranchSelectionScreen` already uses, threaded down as a callback
  // (matching `onLogout`'s own pattern) rather than importing `AuthScope`
  // here, which would create a circular import
  // (`app.dart` → router → `dashboard_screen.dart` → `pos_shell.dart`).
  final Future<void> Function(String? branchId) onBranchSelected;

  @override
  State<PosShell> createState() => _PosShellState();
}

class _PosShellState extends State<PosShell> {
  PosModule selected = PosModule.dashboard;
  bool dark = false;
  // V1's `.sidebar` carries no `.expanded` class by default — the rail
  // starts collapsed until the hamburger toggles it.
  bool sidebarExpanded = false;
  // Mirrors `_expandirGrupoDe`: exactly one nav group is open at a time,
  // starting with whichever group contains the initially-active item.
  String? expandedGroup = PosModule.dashboard.group;

  // TASK 12.3B: `SaleSession` and `clienteMode` moved here from
  // `_PosSaleState` (where TASK 12.3/12.3A first put them). CLIENTE mode
  // now has to lock out the *entire* admin shell — sidebar, topbar, every
  // other module — not just swap a ticket panel inside the POS screen
  // (see `_ClienteLockedShell`), so the state has to live at the level
  // that actually owns the sidebar/topbar. A side effect: the ticket now
  // also survives navigating away from the POS module and back, since it
  // is no longer torn down whenever `_Content`'s `switch(module)` stops
  // building `_PosSale`.
  final saleSession = SaleSession();
  bool clienteMode = false;

  @override
  void dispose() {
    saleSession.dispose();
    super.dispose();
  }

  // POS branch-context fix: a session-branch switch (via the topbar
  // picker, or the in-POS branch-required prompt) flows back in as a
  // brand-new `widget.context` — this is the structural backstop that
  // guarantees a ticket never silently survives a branch change even if
  // some future call path reaches `onBranchSelected` without going
  // through the topbar's own confirm-before-switching guard. Also
  // re-triggers the branch-scoped catalog/inventory reload when the
  // branch actually changed while POS is the active module, so a stale
  // "Todas las sucursales" (or a different branch's) catalog/prices are
  // never retained.
  @override
  void didUpdateWidget(covariant PosShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    final branchChanged =
        widget.context.session.branchId != oldWidget.context.session.branchId;
    if (!branchChanged) return;
    saleSession.clearAll();
    if (selected == PosModule.pos) {
      // `refresh: true` is load-bearing here — `PosReadController.
      // loadProducts`/`loadBalances` are a no-op once their state has
      // already left `idle` (the "don't refetch on a bare re-navigation"
      // guard the admin Products/Inventory screens rely on for their own
      // unrelated tabs) — a real branch switch must force a genuine
      // re-fetch regardless, or a stale catalog/price set survives.
      widget.controller.loadProducts(
        branchId: widget.context.session.branchId,
        refresh: true,
      );
      widget.controller.loadBalances(
        branchId: widget.context.session.branchId,
        refresh: true,
      );
    }
  }

  // TASK 12.3A: CAJERO → CLIENTE is always allowed directly (matches V1's
  // own `cambiarModoPOS('cliente')`, which has no credential gate).
  void _enterClienteMode() => setState(() => clienteMode = true);

  // CLIENTE → CAJERO always requires authorization (V1's own
  // `cambiarModoPOS('cajero')` unconditionally calls `requiereEmpleado(...)`
  // when coming from `modo-cliente`) — see `_CajeroReturnAuthDialog` for
  // why this can't recreate V1's insecure local PIN comparison.
  Future<void> _requestCajeroReturn() async {
    final authorized = await showDialog<bool>(
      context: context,
      builder: (context) =>
          _CajeroReturnAuthDialog(permissions: widget.context.permissions),
    );
    // A cancelled or failed dialog resolves to `null`/`false` — CLIENTE
    // stays active either way. `saleSession` is never touched here, so
    // the ticket/totals are unaffected regardless of the outcome.
    if (authorized == true && mounted) {
      setState(() => clienteMode = false);
    }
  }

  void select(PosModule module) {
    setState(() {
      selected = module;
      expandedGroup = module.group;
    });
    if (module == PosModule.pos) {
      // TASK 12.3C: the POS sale screen resolves branch-specific price
      // overrides ahead of the company-wide default (same branch scope
      // already used for balances) — the admin Products screen below
      // deliberately stays company-wide, matching its existing behavior.
      widget.controller.loadProducts(branchId: widget.context.session.branchId);
      widget.controller.loadCategories();
      widget.controller.loadBalances(branchId: widget.context.session.branchId);
    } else if (module == PosModule.products) {
      widget.controller.loadProducts();
    } else if (module == PosModule.inventory) {
      widget.controller.loadBalances(branchId: widget.context.session.branchId);
    } else if (module == PosModule.users) {
      widget.controller.loadUsers();
    }
  }

  void _toggleGroup(String group) {
    setState(() => expandedGroup = expandedGroup == group ? null : group);
  }

  @override
  Widget build(BuildContext context) => Theme(
    data: dark ? PosTheme.dark() : PosTheme.light(),
    child: Builder(
      builder: (context) {
        // TASK 12.3B: CLIENTE mode is a dedicated locked surface, not a
        // navigation state inside the admin shell — when active, this is
        // the *only* thing built. No sidebar, no topbar, no `_Content`
        // switch exist anywhere in this subtree, so there is no admin
        // navigation control for a customer to reach, structurally, not
        // merely by hiding buttons. See `_ClienteLockedShell`.
        if (clienteMode) {
          return _ClienteLockedShell(
            context: widget.context,
            controller: widget.controller,
            saleSession: saleSession,
            salesGateway: widget.salesGateway,
            paymentsGateway: widget.paymentsGateway,
            rewardsGateway: widget.rewardsGateway,
            onRequestCajeroReturn: _requestCajeroReturn,
          );
        }
        final palette = PosPalette.of(context);
        return Scaffold(
          backgroundColor: palette.background,
          body: LayoutBuilder(
            builder: (context, constraints) {
              final rail = constraints.maxWidth >= 900;
              // Matches `toggleSidebar()`: one hamburger, two behaviors —
              // rail expand/collapse on desktop, drawer open on mobile.
              void toggleSidebar() {
                if (rail) {
                  setState(() => sidebarExpanded = !sidebarExpanded);
                } else {
                  _showMobileNavigation(context);
                }
              }

              return Row(
                children: [
                  if (rail)
                    _Sidebar(
                      selected: selected,
                      expanded: sidebarExpanded,
                      onSelected: select,
                      dark: dark,
                      onToggleDark: () => setState(() => dark = !dark),
                      expandedGroup: expandedGroup,
                      onToggleGroup: _toggleGroup,
                    ),
                  Expanded(
                    child: Column(
                      children: [
                        _Topbar(
                          context: widget.context,
                          onToggleSidebar: toggleSidebar,
                          onLogout: widget.onLogout,
                          saleSession: saleSession,
                          onBranchSelected: widget.onBranchSelected,
                        ),
                        Expanded(
                          child: _Content(
                            module: selected,
                            context: widget.context,
                            controller: widget.controller,
                            saleSession: saleSession,
                            salesGateway: widget.salesGateway,
                            paymentsGateway: widget.paymentsGateway,
                            cashGateway: widget.cashGateway,
                            refundsGateway: widget.refundsGateway,
                            promotionsGateway: widget.promotionsGateway,
                            customersGateway: widget.customersGateway,
                            membershipsGateway: widget.membershipsGateway,
                            loyaltyGateway: widget.loyaltyGateway,
                            rewardsGateway: widget.rewardsGateway,
                            partiesGateway: widget.partiesGateway,
                            heldSalesGateway: widget.heldSalesGateway,
                            purchasingGateway: widget.purchasingGateway,
                            suppliersGateway: widget.suppliersGateway,
                            reportsGateway: widget.reportsGateway,
                            accessGateway: widget.accessGateway,
                            employeesGateway: widget.employeesGateway,
                            schedulesGateway: widget.schedulesGateway,
                            timeClockGateway: widget.timeClockGateway,
                            payrollGateway: widget.payrollGateway,
                            dashboardGateway: widget.dashboardGateway,
                            settingsGateway: widget.settingsGateway,
                            productVariantsGateway: widget.productVariantsGateway,
                            assistantGateway: widget.assistantGateway,
                            authGateway: widget.authGateway,
                            onEnterCliente: _enterClienteMode,
                            onBranchSelected: widget.onBranchSelected,
                            onNavigateToModule: select,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        );
      },
    ),
  );

  Future<void> _showMobileNavigation(BuildContext context) async {
    // `showModalBottomSheet`'s content lives in its own route — calling
    // `setState` on this (the page beneath it) does not rebuild it, so
    // group expand/collapse needs its own `StatefulBuilder`-local state,
    // seeded from the shell's current group.
    var modalExpandedGroup = expandedGroup;
    var modalDark = dark;
    final module = await showModalBottomSheet<PosModule>(
      context: context,
      isScrollControlled: true,
      backgroundColor: PosPalette.of(context).surface,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) => SafeArea(
          child: SizedBox(
            height: MediaQuery.sizeOf(context).height * .88,
            child: _Sidebar(
              selected: selected,
              expanded: true,
              onSelected: Navigator.of(context).pop,
              dark: modalDark,
              onToggleDark: () {
                setState(() => dark = !dark);
                setModalState(() => modalDark = dark);
              },
              expandedGroup: modalExpandedGroup,
              onToggleGroup: (group) => setModalState(
                () => modalExpandedGroup = modalExpandedGroup == group
                    ? null
                    : group,
              ),
            ),
          ),
        ),
      ),
    );
    if (module != null) select(module);
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.selected,
    required this.expanded,
    required this.onSelected,
    required this.dark,
    required this.onToggleDark,
    required this.expandedGroup,
    required this.onToggleGroup,
  });

  final PosModule selected;
  final bool expanded;
  final ValueChanged<PosModule> onSelected;
  final bool dark;
  final VoidCallback onToggleDark;
  final String? expandedGroup;
  final ValueChanged<String> onToggleGroup;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // `.sidebar{transition:width .18s ease}` — rail↔expanded width change.
    return AnimatedContainer(
      key: const Key('pos-sidebar'),
      duration: AsMotion.resolve(context, AsMotion.sidebarWidth),
      curve: Curves.ease,
      width: expanded ? 224 : 68,
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(right: BorderSide(color: palette.border)),
      ),
      child: Column(
        children: [
          // Matches `.sb-brand`: the real `#sb-logo-img` mark (24px,
          // rounded 6px, no shadow — same 0.25 radius ratio as the login
          // modal's 72px treatment, just without its shadow), the
          // two-tone "AS+ POS" wordmark (`--purple2` / `--purple` / muted
          // "POS"), and — only when expanded — an inline online indicator
          // pushed to the right (`.sb-online{margin-left:auto}`), not a
          // footer element.
          Padding(
            padding: expanded
                ? const EdgeInsets.fromLTRB(14, 14, 12, 14)
                : const EdgeInsets.symmetric(vertical: 14),
            child: Row(
              mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
              children: [
                const StartupLogoMark(size: 24, shadow: false),
                if (expanded) ...[
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: 'AS',
                            style: TextStyle(
                              color: palette.blueDeep,
                              fontWeight: FontWeight.w800,
                              fontSize: 13,
                            ),
                          ),
                          TextSpan(
                            text: '+ ',
                            style: TextStyle(
                              color: palette.action,
                              fontWeight: FontWeight.w800,
                              fontSize: 13,
                            ),
                          ),
                          TextSpan(
                            text: 'POS',
                            style: TextStyle(
                              color: palette.textMuted,
                              fontWeight: FontWeight.w700,
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                  const Spacer(),
                  // `Flexible` + `FittedBox` guarantee this never overflows
                  // the 224px expanded rail even at the widest realistic
                  // font-metric variance — it just scales down slightly
                  // rather than throwing a hard layout error.
                  Flexible(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerRight,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              color: palette.success,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            'En línea',
                            style: TextStyle(
                              color: palette.textSecondary,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          Divider(height: 1, color: palette.border),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(8, 7, 8, 12),
              children: [
                for (final group in posNavigationGroups) ...[
                  _SidebarGroupHeader(
                    group: group,
                    expanded: expanded,
                    open: expandedGroup == group,
                    onTap: () => onToggleGroup(group),
                  ),
                  // Matches `.sb-group-body{transition:max-height .2s
                  // ease}` / `.collapsed{max-height:0}` — a single open
                  // group at a time, in both rail and expanded modes,
                  // animated open/closed rather than snapping instantly.
                  AnimatedSize(
                    duration: AsMotion.resolve(context, AsMotion.accordion),
                    curve: Curves.ease,
                    alignment: Alignment.topCenter,
                    child: Column(
                      children: expandedGroup == group
                          ? [
                              for (final module in PosModule.values.where(
                                (module) => module.group == group,
                              ))
                                _SidebarItem(
                                  module: module,
                                  selected: module == selected,
                                  expanded: expanded,
                                  onTap: () => onSelected(module),
                                ),
                            ]
                          : const [],
                    ),
                  ),
                ],
              ],
            ),
          ),
          // Matches `.sb-footer`: a moon icon, "Modo oscuro" label, and a
          // switch — the canonical location of the dark-mode control (not
          // the topbar). The whole row is one tap target (not just the
          // switch) so the control stays reachable at the collapsed/rail
          // width too, matching the topbar button's old width-independent
          // reachability.
          InkWell(
            key: const Key('pos-dark-mode-toggle'),
            onTap: onToggleDark,
            child: Container(
              padding: expanded
                  ? const EdgeInsets.all(14)
                  : const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: palette.border)),
              ),
              child: Row(
                mainAxisAlignment: expanded
                    ? MainAxisAlignment.start
                    : MainAxisAlignment.center,
                mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
                children: [
                  Icon(
                    Icons.dark_mode_outlined,
                    size: 18,
                    color: palette.textSecondary,
                  ),
                  if (expanded) ...[
                    const SizedBox(width: 8),
                    // `Flexible` + `FittedBox` (not `Expanded`) — same
                    // overflow-proofing pattern already used for the
                    // sidebar's online indicator: guarantees this can
                    // never overflow the row, scaling down slightly
                    // instead of throwing a hard layout error.
                    Flexible(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Modo oscuro',
                          style: TextStyle(
                            color: palette.textSecondary,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                    // `Flexible` (a Row gives non-flex children
                    // *unconstrained* width, so a bare `SizedBox`/
                    // `ConstrainedBox` here would still overflow — only
                    // `Flexible`/`Expanded` receive a share of the Row's
                    // *actual* available space) + `FittedBox` (not a bare
                    // `Transform.scale`, which repaints smaller but still
                    // reserves the Switch's full natural width).
                    Flexible(
                      child: IgnorePointer(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(
                            maxWidth: 38,
                            maxHeight: 24,
                          ),
                          child: FittedBox(
                            fit: BoxFit.contain,
                            alignment: Alignment.centerRight,
                            child: Switch(
                              key: const Key('pos-dark-mode-switch'),
                              value: dark,
                              onChanged: (_) {},
                              activeThumbColor: palette.action,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Matches `.sb-group-header`: its own icon, uppercase title (only when
/// expanded), and a chevron that rotates to indicate open/closed —
/// tappable in both rail and expanded modes, exactly like `.sb-item`.
class _SidebarGroupHeader extends StatelessWidget {
  const _SidebarGroupHeader({
    required this.group,
    required this.expanded,
    required this.open,
    required this.onTap,
  });

  final String group;
  final bool expanded;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Tooltip(
        message: expanded ? '' : group,
        child: Material(
          color: open ? palette.action : Colors.transparent,
          borderRadius: BorderRadius.circular(9),
          child: InkWell(
            key: Key('nav-group-$group'),
            onTap: onTap,
            borderRadius: BorderRadius.circular(9),
            child: SizedBox(
              height: 38,
              child: Row(
                mainAxisAlignment: expanded
                    ? MainAxisAlignment.start
                    : MainAxisAlignment.center,
                children: [
                  // `ConstrainedBox` (not `SizedBox`) so this can shrink
                  // below its steady-state width during the sidebar's own
                  // `.18s` width transition instead of overflowing at
                  // intermediate frames.
                  ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: expanded ? 43 : 40),
                    child: Icon(
                      posGroupIcon(group),
                      size: 20,
                      color: open ? Colors.white : palette.text,
                    ),
                  ),
                  if (expanded) ...[
                    Expanded(
                      child: Text(
                        group.toUpperCase(),
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: open ? Colors.white : palette.textSecondary,
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          letterSpacing: .4,
                        ),
                      ),
                    ),
                    AnimatedRotation(
                      turns: open ? 0 : -0.25,
                      duration: const Duration(milliseconds: 150),
                      child: Icon(
                        Icons.expand_more,
                        size: 16,
                        color: open ? Colors.white : palette.textSecondary,
                      ),
                    ),
                    const SizedBox(width: 4),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SidebarItem extends StatelessWidget {
  const _SidebarItem({
    required this.module,
    required this.selected,
    required this.expanded,
    required this.onTap,
  });

  final PosModule module;
  final bool selected;
  final bool expanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // Matches `.sb-item.active{background:var(--purple);color:#fff}` — a
    // solid accent fill with white text/icon, not a light tint.
    return Padding(
      padding: EdgeInsets.only(left: expanded ? 15 : 0, top: 1, bottom: 1),
      child: Tooltip(
        message: expanded ? '' : module.label,
        child: Material(
          color: selected ? palette.action : Colors.transparent,
          borderRadius: BorderRadius.circular(9),
          child: InkWell(
            key: Key('nav-${module.name}'),
            onTap: onTap,
            borderRadius: BorderRadius.circular(9),
            child: SizedBox(
              height: 40,
              child: Row(
                mainAxisAlignment: expanded
                    ? MainAxisAlignment.start
                    : MainAxisAlignment.center,
                children: [
                  // `ConstrainedBox` (not `SizedBox`) so this can shrink
                  // below its steady-state width during the sidebar's own
                  // `.18s` width transition instead of overflowing at
                  // intermediate frames.
                  ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: expanded ? 43 : 40),
                    child: Icon(
                      module.icon,
                      size: 20,
                      color: selected ? Colors.white : palette.textSecondary,
                    ),
                  ),
                  if (expanded)
                    Expanded(
                      child: Text(
                        module.label,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: selected
                              ? Colors.white
                              : palette.textSecondary,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Topbar extends StatelessWidget {
  const _Topbar({
    required this.context,
    required this.onToggleSidebar,
    required this.onLogout,
    required this.saleSession,
    required this.onBranchSelected,
  });

  final AuthenticatedContext context;
  final VoidCallback onToggleSidebar;
  final VoidCallback onLogout;
  // POS branch-context fix: needed only to decide whether switching
  // branch must ask for confirmation first (see `_handleBranchSelected`)
  // — this widget never reads ticket contents, only whether it is empty.
  final SaleSession saleSession;
  final Future<void> Function(String? branchId) onBranchSelected;

  /// The one place in this shell a session's operational branch actually
  /// changes — reused by both this topbar picker and the in-POS
  /// branch-required prompt (`_PosBranchRequired`), so there is exactly
  /// one branch-switch code path, never two competing ones. Asks first
  /// when the ticket is non-empty (never silently migrates a ticket to a
  /// different branch's catalog/prices — see `_PosShellState.
  /// didUpdateWidget`, which still clears it defensively either way).
  static Future<void> _handleBranchSelected(
    BuildContext context,
    SaleSession saleSession,
    Future<void> Function(String? branchId) onBranchSelected,
    String? branchId,
  ) async {
    if (saleSession.isNotEmpty) {
      final discard = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Cambiar de sucursal'),
          content: const Text(
            'El ticket actual pertenece a la sucursal en curso. Cambiar de '
            'sucursal vaciará este ticket. ¿Deseas continuar?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Vaciar y cambiar'),
            ),
          ],
        ),
      );
      if (discard != true) return;
      saleSession.clearAll();
    }
    await onBranchSelected(branchId);
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branch = this.context.currentBranch?.name ?? 'Todas las sucursales';
    final wide = MediaQuery.sizeOf(context).width >= 900;
    // The canonical `.topbar` carries no page title at all — this shell
    // keeps company/branch context (`_ContextLabel`) since AS ONE is
    // multi-tenant and V1 never had to represent that; everything else
    // matches `.topbar`'s actual children exactly.
    return Container(
      key: const Key('pos-topbar'),
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (wide) const _TopbarClock() else const SizedBox.shrink(),
          Row(
            children: [
              // Matches `.ham-btn`: 36px rounded-square (not the circular
              // `.tb-icon`), one hamburger for both rail toggle and the
              // mobile drawer.
              _HamburgerButton(onPressed: onToggleSidebar),
              const SizedBox(width: 10),
              const _TopbarBrandMark(),
              const SizedBox(width: 8),
              Container(width: 1, height: 28, color: palette.border),
              const SizedBox(width: 8),
              if (wide)
                Text(
                  'Manager',
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              const Spacer(),
              if (MediaQuery.sizeOf(context).width >= 600)
                // POS branch-context fix: the same chip V1 never had to
                // represent (AS ONE is multi-tenant) — now a real
                // `AuthController.selectBranch` switch, not just a
                // label. "Todas las sucursales" stays offered here
                // (only when `companyWideAccess`) because it remains a
                // valid *consolidated* context for dashboards/reports —
                // just not for Punto de Venta itself, which gates on
                // `currentBranch` separately (see `_PosBranchRequired`).
                PopupMenuButton<String?>(
                  key: const Key('pos-branch-switch'),
                  tooltip: 'Cambiar sucursal',
                  onSelected: (value) => _handleBranchSelected(
                    context,
                    saleSession,
                    onBranchSelected,
                    value,
                  ),
                  itemBuilder: (_) => [
                    if (this.context.companyWideAccess)
                      const PopupMenuItem<String?>(
                        value: null,
                        child: Text('Todas las sucursales'),
                      ),
                    for (final candidate in this.context.branches)
                      PopupMenuItem<String?>(
                        value: candidate.id,
                        child: Text(candidate.name),
                      ),
                  ],
                  child: _ContextLabel(
                    company: this.context.currentCompany?.name ?? 'AS ONE',
                    branch: branch,
                  ),
                ),
              const SizedBox(width: 8),
              _RoundAction(
                tooltip: 'Notificaciones',
                icon: Icons.notifications_outlined,
                onPressed: () => _showReadOnlyNotice(context),
              ),
              const SizedBox(width: 6),
              if (wide) ...[
                const _AiAssistantButton(),
                const SizedBox(width: 6),
              ],
              PopupMenuButton<String>(
                tooltip: 'Cuenta',
                onSelected: (value) {
                  if (value == 'logout') onLogout();
                },
                itemBuilder: (_) => [
                  PopupMenuItem(
                    enabled: false,
                    child: Text(this.context.user.email),
                  ),
                  const PopupMenuDivider(),
                  const PopupMenuItem(
                    value: 'logout',
                    child: Text('Cerrar sesión'),
                  ),
                ],
                // Matches `.avatar{background:linear-gradient(135deg,var(
                // --purple),var(--blue))}` — a gradient fill, not a flat
                // color.
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [palette.action, palette.blue],
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    _initials(this.context.user.displayName),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _initials(String value) {
    final parts = value.trim().split(RegExp(r'\s+'));
    return parts
        .take(2)
        .where((part) => part.isNotEmpty)
        .map((part) => part[0])
        .join();
  }
}

/// Matches `.ham-btn`: a 36px rounded-square (not the circular `.tb-icon`),
/// the single control for both rail expand/collapse and the mobile drawer.
class _HamburgerButton extends StatelessWidget {
  const _HamburgerButton({required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Tooltip(
      message: 'Alternar navegación',
      child: InkWell(
        key: const Key('pos-hamburger'),
        onTap: onPressed,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: palette.background,
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(10),
          ),
          alignment: Alignment.center,
          child: Icon(Icons.menu, size: 18, color: palette.text),
        ),
      ),
    );
  }
}

/// Matches `.logo-img{height:28px;width:auto}` — the same real `#sb-brand`
/// mark reused in the topbar, at its literal plain treatment: no
/// rounding, no shadow, natural aspect ratio.
class _TopbarBrandMark extends StatelessWidget {
  const _TopbarBrandMark();

  @override
  Widget build(BuildContext context) =>
      const StartupLogoMark(size: 28, rounded: false, shadow: false);
}

/// Matches `actualizarRelojTopbar()` — the exact same function drives
/// both `#topbar-clock-text` (`_TopbarClock`, CAJERO) and
/// `#pos-cliente-clock-text` (`_ClienteHeader`, CLIENTE) in V1, so the
/// format is written once here and reused, not duplicated. `es-MX`-style
/// formatting reproduced manually (no new package dependency).
String _formatClock(DateTime now) {
  const weekdays = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const months = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  final weekday = weekdays[now.weekday - 1];
  final day = now.day.toString().padLeft(2, '0');
  final month = months[now.month - 1];
  var hour12 = now.hour % 12;
  if (hour12 == 0) hour12 = 12;
  final minute = now.minute.toString().padLeft(2, '0');
  final second = now.second.toString().padLeft(2, '0');
  final period = now.hour < 12 ? 'a.m.' : 'p.m.';
  return '$weekday, $day $month ${now.year} · $hour12:$minute:$second $period';
}

/// A live-updating clock text driven by its own 1s `Timer` — shared by
/// `_TopbarClock` and `_ClienteHeader`'s clock, matching how V1 drives
/// both DOM nodes from the one `actualizarRelojTopbar()` function.
class _LiveClockText extends StatefulWidget {
  const _LiveClockText({required this.style});
  final TextStyle style;

  @override
  State<_LiveClockText> createState() => _LiveClockTextState();
}

class _LiveClockTextState extends State<_LiveClockText> {
  Timer? _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => setState(() => _now = DateTime.now()),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      Text(_formatClock(_now), style: widget.style);
}

class _TopbarClock extends StatelessWidget {
  const _TopbarClock();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return IgnorePointer(
      child: Row(
        key: const Key('pos-topbar-clock'),
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.schedule_outlined, size: 15, color: palette.action),
          const SizedBox(width: 7),
          _LiveClockText(
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Matches `.ai-topbtn`: a gradient pill with the assistant icon. Visually
/// present per spec but inert — no AI backend contract exists, so tapping
/// surfaces the shared read-only notice rather than opening anything.
class _AiAssistantButton extends StatelessWidget {
  const _AiAssistantButton();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: const Key('pos-ai-assistant-button'),
        onTap: () => _showReadOnlyNotice(context),
        borderRadius: BorderRadius.circular(20),
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [palette.action, palette.blue]),
            borderRadius: BorderRadius.circular(20),
          ),
          alignment: Alignment.center,
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.smart_toy_outlined, size: 16, color: Colors.white),
              SizedBox(width: 6),
              Text(
                'Asistente IA',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoundAction extends StatelessWidget {
  const _RoundAction({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.color,
    // TASK 14.3 (Wave 1, Part B.1): a real in-flight indicator for the
    // now-real "Suspender venta" action — never a fake instant success.
    this.busy = false,
    super.key,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final Color? color;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      icon: busy
          ? SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, color: color ?? palette.textSecondary),
            )
          : Icon(icon, size: 18),
      color: color ?? palette.textSecondary,
      style: IconButton.styleFrom(
        minimumSize: const Size.square(40),
        side: BorderSide(color: color ?? palette.border),
        backgroundColor: palette.surface,
      ),
    );
  }
}

/// A one-off SnackBar notice — the shared mechanism behind
/// `_showReadOnlyNotice` and the newer, more specific TASK 12.3 messages
/// (out-of-stock, Cobrar's "Disponible en TASK 12.4").
void _showNotice(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 2)),
    );
}

/// Shown when a visually-faithful V1 control (payment methods, suspend/
/// cancel, coupon, cash received…) is tapped. These controls are rendered
/// at full canonical fidelity but have no backing transaction capability
/// in this shell — see TASK 12.2C. (Cobrar has its own, more specific
/// TASK 12.3 message — see `_PosCobrarButton`.)
void _showReadOnlyNotice(BuildContext context) => _showNotice(
  context,
  'Modo de solo lectura: disponible cuando el punto de venta '
  'transaccional esté implementado.',
);

/// TASK 12.4B.1's own bounded-poll contract — Flutter never talks to
/// Mercado Pago, and there is still no WebSocket publisher (TASK 12.4A's
/// own finding), so this is the explicit interim mechanism: poll the AS
/// backend's own `GET /api/v1/payments/{id}` every [_paymentPollInterval]
/// until an attempt reaches a terminal state or [_paymentPollTimeout]
/// elapses, whichever comes first — never Mercado Pago itself, and never
/// unbounded.
const _paymentPollInterval = Duration(seconds: 2);
const _paymentPollTimeout = Duration(seconds: 90);
const _terminalAttemptStatuses = {
  'approved',
  'declined',
  'cancelled',
  'timed_out',
  'failed',
};

/// The exact, honest, backend-driven labels this task asks for — never a
/// fabricated one, and `'approved'` is the only status that ever earns
/// "Pago aprobado".
String _paymentStatusLabel(String attemptStatus) => switch (attemptStatus) {
  'created' || 'awaiting_terminal' => 'Esperando pago en terminal',
  'processing' => 'Procesando',
  'approved' => 'Pago aprobado',
  'declined' => 'Pago rechazado',
  'cancelled' => 'Cancelado',
  'timed_out' => 'Tiempo agotado',
  'failed' => 'Pago rechazado',
  _ => 'Procesando',
};

/// TASK 12.4A.1/12.4B.1: wires Cobrar (CAJERO) and the card-payment button
/// (CLIENTE) as far as the backend can honestly support — see
/// `docs/AS_POS_SALE_ENGINE.md`'s "Deferred: TASK 12.4" section, ADR-0009,
/// and ADR-0010. Creates a real, backend-priced [SaleSession] as a `sales`
/// row (server-authoritative price/tax, never a client-computed total),
/// then — only when this branch has a real, configured Mercado Pago Point
/// terminal — creates a `card_terminal` Payment for the sale's own
/// authoritative total and polls the backend for its authoritative
/// outcome, surfacing [onStatusUpdate] at each step. **Never** simulates a
/// terminal, a bank response, or an approved payment: "Pago aprobado" is
/// shown only after the backend itself reports the attempt `approved`.
/// With no terminal configured, stops honestly at "preparada para pago —
/// terminal no configurada", exactly as TASK 12.4A.1 left it.
/// TASK 13.0 (lifted to top-level in TASK 14.5 Wave 3 Phase 4a): "Buscar
/// cliente" — a small inline action in the cart/ticket area, mirroring
/// the coupon UX pattern exactly (ADR-0017 Part H). Attaching a customer
/// is never required and never blocks checkout speed — "Venta sin
/// cliente" stays the default/fast path. Lifted out of
/// `_TicketFooterState` so the F3 keyboard shortcut and the toolbar's
/// "Vincular cliente (F3)" button (`_PosSaleState`) can call the EXACT
/// same code path as the on-screen "Buscar cliente" row, rather than a
/// second, shortcut-only copy of this logic.
Future<void> openCustomerSelector(
  BuildContext context, {
  required SaleSession saleSession,
  required PosCustomersGateway customersGateway,
}) async {
  final selected = await showDialog<_CustomerSelectorResult>(
    context: context,
    builder: (dialogContext) => _CustomerSelectorDialog(customersGateway: customersGateway),
  );
  if (selected == null || !context.mounted) return;
  saleSession.setCustomer(customerId: selected.id, displayName: selected.displayName);
}

Future<void> _submitSaleForPayment(
  BuildContext context, {
  required SaleSession saleSession,
  required PosSalesGateway salesGateway,
  required PosPaymentsGateway paymentsGateway,
  required String? branchId,
  required ValueChanged<String?> onStatusUpdate,
  PosHeldSalesGateway heldSalesGateway = const EmptyPosHeldSalesGateway(),
}) async {
  if (saleSession.isEmpty) {
    _showNotice(context, 'Agrega al menos un producto al ticket.');
    return;
  }
  if (branchId == null) {
    _showNotice(context, 'Esta sesión no tiene una sucursal asignada.');
    return;
  }
  // TASK 14.3 (Wave 1, Part B.1): captured before any await resolves the
  // real sale/payment — see the `link-sale` call below, mirrored on
  // `customerDisplayName`'s own "capture before it can be cleared"
  // precedent in the cash path.
  final resumedHeldCartId = saleSession.resumedHeldCartId;
  try {
    final sale = await salesGateway.createSale(
      branchId: branchId,
      items: [
        for (final line in saleSession.lines)
          PosSaleLineRequest(
            productId: line.productId,
            quantity: line.quantityForApi,
          ),
      ],
      // TASK 12.9: the SAME coupon/manual-discount intent the last
      // successful quote already previewed — the backend independently
      // re-validates and re-derives the real amounts here, never trusting
      // that quote blindly (ADR-0016 D1/D10).
      couponCodes: saleSession.couponCodes,
      manualDiscount: saleSession.manualDiscount,
      // TASK 13.0: attaches whichever customer the cashier selected at
      // the ticket, if any (ADR-0017 D6) — `null` reproduces "Venta sin
      // cliente" exactly.
      customerId: saleSession.customerId,
      // TASK 13.2: the SAME reward-entitlement intent the last successful
      // quote already previewed — the backend independently re-validates
      // and only actually consumes it once the sale genuinely settles
      // (ADR-0019).
      rewardEntitlementId: saleSession.rewardEntitlementId,
      // TASK 14.3 (Wave 1, Part B.4).
      note: saleSession.note,
    );
    if (!context.mounted) return;

    final terminals = await paymentsGateway.terminalsForBranch(branchId);
    PosPaymentTerminal? terminal;
    for (final candidate in terminals) {
      if (candidate.provider == 'mercado_pago' &&
          (candidate.status == 'active' || candidate.status == 'assigned')) {
        terminal = candidate;
        break;
      }
    }
    if (terminal == null) {
      if (!context.mounted) return;
      _showNotice(
        context,
        'Venta ${sale.saleNumber} preparada para pago — '
        'terminal no configurada.',
      );
      return;
    }

    onStatusUpdate('Enviando a terminal');
    final created = await paymentsGateway.createCardTerminalPayment(
      saleId: sale.id,
      amount: sale.total,
      terminalId: terminal.id,
    );
    if (!context.mounted) return;
    var latestAttempt = created.latestAttempt;
    if (latestAttempt != null)
      onStatusUpdate(_paymentStatusLabel(latestAttempt.status));

    final deadline = DateTime.now().add(_paymentPollTimeout);
    while (latestAttempt == null ||
        !_terminalAttemptStatuses.contains(latestAttempt.status)) {
      if (DateTime.now().isAfter(deadline)) {
        onStatusUpdate(null);
        if (!context.mounted) return;
        _showNotice(
          context,
          'Tiempo agotado esperando el pago. Verifica el estado más tarde.',
        );
        return;
      }
      await Future<void>.delayed(_paymentPollInterval);
      if (!context.mounted) return;
      final status = await paymentsGateway.paymentStatus(created.id);
      if (!context.mounted) return;
      latestAttempt = status.latestAttempt;
      if (latestAttempt != null)
        onStatusUpdate(_paymentStatusLabel(latestAttempt.status));
    }

    onStatusUpdate(null);
    // TASK 14.3 (Wave 1, Part B.1): the resumed held cart's second
    // handshake call — only once the sale genuinely settled (see
    // `held-sales.routes.ts`'s own doc comment on `link-sale`). Best-
    // effort: a failure here never blocks or reverses the real, already-
    // approved sale/payment above.
    if (resumedHeldCartId != null && latestAttempt.status == 'approved') {
      try {
        await heldSalesGateway.linkSale(id: resumedHeldCartId, saleId: sale.id);
      } on Object {
        // Intentionally swallowed — see doc comment above.
      }
    }
    if (!context.mounted) return;
    _showNotice(
      context,
      latestAttempt.status == 'approved'
          ? 'Pago aprobado — venta ${sale.saleNumber}.'
          : 'Pago no completado (${_paymentStatusLabel(latestAttempt.status)}).',
    );
  } on ApiException catch (error) {
    onStatusUpdate(null);
    if (!context.mounted) return;
    _showNotice(context, error.failure.message);
  } on Object {
    onStatusUpdate(null);
    if (!context.mounted) return;
    _showNotice(context, 'No fue posible preparar la venta.');
  }
}

/// TASK 12.5A: the cash checkout path — creates a real, backend-priced
/// sale exactly like [_submitSaleForPayment] does for the card path
/// ("create/reuse authoritative Sale"), then opens [_CashPaymentDialog]
/// for the cashier to enter what was physically tendered and give the one
/// explicit "Confirmar pago en efectivo" action the task requires. No
/// terminal, no provider, no poll loop — a cash attempt settles inside
/// the one backend call the dialog itself makes (see ADR-0011).
///
/// `SaleSession` is cleared only after that call actually returns success
/// — never when the dialog is merely opened, and never on any failure
/// (sale creation failing, the cash confirmation itself failing, or the
/// cashier cancelling): the ticket must survive exactly as it was so the
/// cashier can simply try again, per the task's own "if backend fails, do
/// NOT clear the ticket" instruction.
Future<void> _submitCashSaleForPayment(
  BuildContext context, {
  required SaleSession saleSession,
  required PosSalesGateway salesGateway,
  required PosPaymentsGateway paymentsGateway,
  required String? branchId,
  required VoidCallback onDialogAboutToOpen,
  PosHeldSalesGateway heldSalesGateway = const EmptyPosHeldSalesGateway(),
}) async {
  if (saleSession.isEmpty) {
    _showNotice(context, 'Agrega al menos un producto al ticket.');
    return;
  }
  if (branchId == null) {
    _showNotice(context, 'Esta sesión no tiene una sucursal asignada.');
    return;
  }
  // TASK 14.3 (Wave 1, Part B.1): see the identical capture in
  // `_submitSaleForPayment`.
  final resumedHeldCartId = saleSession.resumedHeldCartId;
  final PosSaleCreated sale;
  try {
    sale = await salesGateway.createSale(
      branchId: branchId,
      items: [
        for (final line in saleSession.lines)
          PosSaleLineRequest(
            productId: line.productId,
            quantity: line.quantityForApi,
          ),
      ],
      // TASK 12.9: same rationale as `_submitSaleForPayment` above.
      couponCodes: saleSession.couponCodes,
      manualDiscount: saleSession.manualDiscount,
      // TASK 13.0: same rationale as `_submitSaleForPayment` above.
      customerId: saleSession.customerId,
      // TASK 13.2: same rationale as `_submitSaleForPayment` above.
      rewardEntitlementId: saleSession.rewardEntitlementId,
      // TASK 14.3 (Wave 1, Part B.4).
      note: saleSession.note,
    );
  } on ApiException catch (error) {
    if (!context.mounted) return;
    _showNotice(context, error.failure.message);
    return;
  } on Object {
    if (!context.mounted) return;
    _showNotice(context, 'No fue posible preparar la venta.');
    return;
  }
  if (!context.mounted) return;

  final Money totalDue;
  try {
    // The sale's own currency is always what its backend response
    // reports — every fixture/branch in this app is MXN today (see
    // `createCardTerminalPayment`'s identical hardcoded `'MXN'`).
    totalDue = Money.parse(sale.total, 'MXN');
  } on MoneyFormatException {
    if (!context.mounted) return;
    _showNotice(context, 'No fue posible calcular el total de la venta.');
    return;
  }

  // The Cobrar button's own busy/spinner state covers only the sale-
  // creation network call above — it must not keep spinning for however
  // long the cashier takes to type a tendered amount and confirm; the
  // dialog itself owns the spinner for its own, much shorter final
  // network call (see `_CashPaymentDialogState._confirm`).
  onDialogAboutToOpen();
  final result = await showDialog<PosCashPaymentResult>(
    context: context,
    builder: (dialogContext) => _CashPaymentDialog(
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      totalDue: totalDue,
      paymentsGateway: paymentsGateway,
    ),
  );
  // `null` means the cashier cancelled — the sale exists as an orphaned
  // `pending_payment` row (identical, pre-existing characteristic to the
  // card path's own "terminal no configurada"/timeout cases — see
  // ADR-0009), and the ticket is left completely untouched.
  if (result == null) return;
  if (!context.mounted) return;
  final change = Money.parse(result.changeAmount, 'MXN');
  final total = Money.parse(sale.total, 'MXN');
  // TASK 12.5B: the ticket resets the moment success is confirmed —
  // exactly TASK 12.5A's existing behavior — but the completed-sale
  // success/receipt experience stays on screen afterward, sourced from
  // the persisted Sale (never SaleSession, which is now empty), until
  // the cashier explicitly taps "Nueva venta" (see `_ReceiptSuccessDialog`
  // and ADR-0012).
  //
  // TASK 13.0: the attached customer's display name is captured BEFORE
  // `clearAll()` wipes it — `SaleSession` carries no customer field for
  // the receipt to read afterward, and the backend's own
  // `GET /sales/{id}/receipt` response carries none either (unlike
  // `GET /sales`) — see `buildReceiptHtml`'s own doc comment.
  final customerDisplayName = saleSession.customerDisplayName;
  final note = saleSession.note;
  // TASK 14.3 (Wave 1, Part B.1): the resumed held cart's second
  // handshake call — the cash payment above already genuinely settled
  // this sale. Best-effort: a failure here never reverses the real,
  // already-confirmed cash payment.
  if (resumedHeldCartId != null) {
    try {
      await heldSalesGateway.linkSale(id: resumedHeldCartId, saleId: sale.id);
    } on Object {
      // Intentionally swallowed — see doc comment above.
    }
  }
  saleSession.clearAll();
  if (!context.mounted) return;
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => _ReceiptSuccessDialog(
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      total: total,
      change: change,
      salesGateway: salesGateway,
      customerDisplayName: customerDisplayName,
      note: note,
    ),
  );
}

/// TASK 13.2 (ADR-0019 "Zero-total Sale design"): a reward benefit can
/// reduce a sale's own backend-computed total to exactly zero — no
/// payment method applies at all. Deliberately NOT a `"0.00"` cash tender
/// through [_submitCashSaleForPayment] (that would fabricate a
/// `payments` row and a `cash_movements` posting for money that never
/// moved); this instead creates the sale exactly like the cash/card paths
/// do, then calls the dedicated `zero-total-completion` endpoint, which is
/// also the one call that actually consumes the attached reward
/// entitlement. Same "never clear the ticket on any failure" contract as
/// [_submitCashSaleForPayment].
Future<void> _submitZeroTotalSale(
  BuildContext context, {
  required SaleSession saleSession,
  required PosSalesGateway salesGateway,
  required String? branchId,
  required VoidCallback onBeforeReceiptDialog,
  PosHeldSalesGateway heldSalesGateway = const EmptyPosHeldSalesGateway(),
}) async {
  if (saleSession.isEmpty) {
    _showNotice(context, 'Agrega al menos un producto al ticket.');
    return;
  }
  if (branchId == null) {
    _showNotice(context, 'Esta sesión no tiene una sucursal asignada.');
    return;
  }
  // TASK 14.3 (Wave 1, Part B.1): see the identical capture in
  // `_submitSaleForPayment`.
  final resumedHeldCartId = saleSession.resumedHeldCartId;
  final PosSaleCreated sale;
  try {
    sale = await salesGateway.createSale(
      branchId: branchId,
      items: [
        for (final line in saleSession.lines)
          PosSaleLineRequest(
            productId: line.productId,
            quantity: line.quantityForApi,
          ),
      ],
      couponCodes: saleSession.couponCodes,
      manualDiscount: saleSession.manualDiscount,
      customerId: saleSession.customerId,
      rewardEntitlementId: saleSession.rewardEntitlementId,
      // TASK 14.3 (Wave 1, Part B.4).
      note: saleSession.note,
    );
  } on ApiException catch (error) {
    if (!context.mounted) return;
    _showNotice(context, error.failure.message);
    return;
  } on Object {
    if (!context.mounted) return;
    _showNotice(context, 'No fue posible preparar la venta.');
    return;
  }
  if (!context.mounted) return;

  final PosSaleCreated completed;
  try {
    completed = await salesGateway.completeZeroTotalSale(sale.id);
  } on ApiException catch (error) {
    if (!context.mounted) return;
    // The sale itself was already created (`pending_payment`) — same
    // orphaned-row characteristic as every other checkout path's own
    // failure case (ADR-0009); the ticket is left completely untouched so
    // the cashier can see the honest rejection and retry.
    _showNotice(context, error.failure.message);
    return;
  } on Object {
    if (!context.mounted) return;
    _showNotice(context, 'No fue posible completar la venta.');
    return;
  }
  if (!context.mounted) return;

  final Money total;
  try {
    total = Money.parse(completed.total, 'MXN');
  } on MoneyFormatException {
    if (!context.mounted) return;
    _showNotice(context, 'No fue posible calcular el total de la venta.');
    return;
  }
  final customerDisplayName = saleSession.customerDisplayName;
  final note = saleSession.note;
  // TASK 14.3 (Wave 1, Part B.1): the resumed held cart's second
  // handshake call — the zero-total completion above already genuinely
  // settled this sale. Best-effort: a failure here never reverses it.
  if (resumedHeldCartId != null) {
    try {
      await heldSalesGateway.linkSale(id: resumedHeldCartId, saleId: completed.id);
    } on Object {
      // Intentionally swallowed — see doc comment above.
    }
  }
  saleSession.clearAll();
  if (!context.mounted) return;
  // Mirrors `_submitCashSaleForPayment`'s own `onDialogAboutToOpen`: the
  // Cobrar button's busy/spinner state covers only the two network calls
  // above, never however long the cashier leaves the completed-sale
  // dialog open — that dialog is modal on its own.
  onBeforeReceiptDialog();
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => _ReceiptSuccessDialog(
      saleId: completed.id,
      saleNumber: completed.saleNumber,
      total: total,
      change: Money.zero('MXN'),
      salesGateway: salesGateway,
      customerDisplayName: customerDisplayName,
      note: note,
    ),
  );
}

/// TASK 12.5B: the bundled AS+ mark, base64-encoded once and reused for
/// every receipt print — never a second copy of the asset on disk, and
/// never a raw filesystem path (see ADR-0012 "Branding"). A print-window
/// document is a separate browser document from the running app, so it
/// cannot simply reference a Flutter asset URL — the data URI embeds the
/// bytes directly, working identically regardless of how that popup
/// document's base URL behaves. `null` (never thrown) if the asset
/// somehow fails to load — a missing logo must never block printing.
String? _cachedReceiptLogoDataUri;
Future<String?> _receiptLogoDataUri() async {
  final cached = _cachedReceiptLogoDataUri;
  if (cached != null) return cached;
  try {
    final asset = await rootBundle.load('assets/branding/as_logo_mark.png');
    final uri =
        'data:image/png;base64,${base64Encode(asset.buffer.asUint8List())}';
    _cachedReceiptLogoDataUri = uri;
    return uri;
  } on Object {
    return null;
  }
}

/// TASK 12.5B: the completed-sale success/receipt experience — see
/// ADR-0012. [saleNumber]/[total]/[change] are already known the instant
/// this opens (straight from the backend's own cash-payment response,
/// never `SaleSession`), so "Venta completada", the folio, total, and
/// cambio show immediately; the full [PosReceipt] (business/cashier/line
/// items, needed for "Imprimir ticket") loads separately and can be
/// retried on its own if it fails — a receipt-fetch failure never implies
/// the sale itself failed, because it already, genuinely succeeded.
/// Dismissible only via the explicit "Nueva venta" button (no barrier tap,
/// no back gesture) — the task's own "do not auto-start a new sale until
/// the cashier chooses Nueva venta" applies to *this dialog* remaining on
/// screen, not to whether `SaleSession` was already reset (it was, by the
/// caller, before this ever opens).
class _ReceiptSuccessDialog extends StatefulWidget {
  const _ReceiptSuccessDialog({
    required this.saleId,
    required this.saleNumber,
    required this.total,
    required this.change,
    required this.salesGateway,
    this.customerDisplayName,
    this.note,
  });
  final String saleId;
  final String saleNumber;
  final Money total;
  final Money change;
  final PosSalesGateway salesGateway;
  // TASK 13.0: captured by the caller before `SaleSession.clearAll()` —
  // see `buildReceiptHtml`'s own doc comment for why this isn't read off
  // the receipt itself.
  final String? customerDisplayName;
  // TASK 14.3 (Wave 1, Part B.4): same "captured before clearAll(), never
  // read off the receipt" rationale as [customerDisplayName] above — the
  // backend's own receipt response carries no `note` field either.
  final String? note;

  @override
  State<_ReceiptSuccessDialog> createState() => _ReceiptSuccessDialogState();
}

class _ReceiptSuccessDialogState extends State<_ReceiptSuccessDialog> {
  PosReceipt? _receipt;
  bool _loadingReceipt = true;
  String? _receiptError;
  bool _printing = false;
  String? _printError;

  @override
  void initState() {
    super.initState();
    unawaited(_loadReceipt());
  }

  Future<void> _loadReceipt() async {
    setState(() {
      _loadingReceipt = true;
      _receiptError = null;
    });
    try {
      final receipt = await widget.salesGateway.receipt(widget.saleId);
      if (!mounted) return;
      setState(() {
        _receipt = receipt;
        _loadingReceipt = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingReceipt = false;
        _receiptError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loadingReceipt = false;
        _receiptError = 'No fue posible cargar el recibo completo.';
      });
    }
  }

  Future<void> _handlePrint() async {
    final receipt = _receipt;
    if (receipt == null || _printing) return;
    setState(() {
      _printing = true;
      _printError = null;
    });
    final logoDataUri = await _receiptLogoDataUri();
    // Printing failure/cancel must never undo or modify the already-
    // completed sale (see ADR-0012) — `buildReceiptHtml`/
    // `openReceiptPrintWindow` are pure/side-effect-free with respect to
    // backend state; only the browser's own print window is affected.
    final html = buildReceiptHtml(
      receipt: receipt,
      logoDataUri: logoDataUri,
      customerDisplayName: widget.customerDisplayName,
      note: widget.note,
    );
    final opened = openReceiptPrintWindow(html);
    if (!mounted) return;
    setState(() {
      _printing = false;
      _printError = opened
          ? null
          : 'El navegador bloqueó la ventana de impresión. Permite ventanas '
                'emergentes para imprimir.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return PopScope(
      canPop: false,
      child: Dialog(
        backgroundColor: palette.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(Icons.check_circle, color: palette.action, size: 22),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Venta completada',
                        style: TextStyle(
                          color: palette.text,
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                _CashSummaryRow(
                  label: 'Folio',
                  value: widget.saleNumber,
                  big: true,
                ),
                // TASK 13.0: a name only — never phone/email/birth date
                // (Part AB). Only shown when a customer was actually
                // attached; a walk-in sale renders exactly as before.
                if (widget.customerDisplayName != null) ...[
                  const SizedBox(height: 4),
                  _CashSummaryRow(
                    label: 'Cliente',
                    value: widget.customerDisplayName!,
                  ),
                ],
                // TASK 14.3 (Wave 1, Part B.4): a real, non-empty note
                // only — never an empty placeholder row.
                if (widget.note != null && widget.note!.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  _CashSummaryRow(label: 'Nota', value: widget.note!),
                ],
                const SizedBox(height: 6),
                _CashSummaryRow(label: 'Total', value: _money(widget.total)),
                const SizedBox(height: 4),
                _CashSummaryRow(
                  label: 'Cambio',
                  value: _money(widget.change),
                  emphasis: true,
                ),
                const SizedBox(height: 14),
                if (_loadingReceipt)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: palette.textSecondary,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Cargando recibo…',
                        style: TextStyle(
                          color: palette.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  )
                else if (_receiptError != null)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        _receiptError!,
                        style: const TextStyle(
                          color: Colors.redAccent,
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(height: 6),
                      OutlinedButton(
                        key: const Key('pos-receipt-retry'),
                        onPressed: _loadReceipt,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.textSecondary,
                          side: BorderSide(color: palette.border),
                        ),
                        child: const Text('Reintentar'),
                      ),
                    ],
                  )
                else if (_receipt != null)
                  _ReceiptDetail(receipt: _receipt!),
                if (_printError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _printError!,
                    style: const TextStyle(
                      color: Colors.redAccent,
                      fontSize: 12,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const Key('pos-receipt-print'),
                        onPressed: (_receipt == null || _printing)
                            ? null
                            : _handlePrint,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.textSecondary,
                          side: BorderSide(color: palette.border),
                        ),
                        icon: _printing
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.print_outlined, size: 16),
                        label: const Text('Imprimir ticket'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-receipt-new-sale'),
                        onPressed: () => Navigator.of(context).pop(),
                        style: FilledButton.styleFrom(
                          backgroundColor: palette.action,
                        ),
                        child: const Text('Nueva venta'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// TASK 12.5B: the on-screen receipt detail once [PosReceipt] has loaded —
/// item list, subtotal/IVA, and (for a cash sale) efectivo recibido, all
/// read straight off the fetched receipt, never re-derived from
/// `SaleSession`. A long item list scrolls inside its own bounded area
/// rather than growing the dialog without limit.
class _ReceiptDetail extends StatelessWidget {
  const _ReceiptDetail({required this.receipt});
  final PosReceipt receipt;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final sale = receipt.sale;
    final business = receipt.business;
    final cash = receipt.cashPayment;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Divider(color: palette.border, height: 20),
        if (business != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              business.branchName.isEmpty
                  ? business.companyName
                  : '${business.companyName} · ${business.branchName}',
              style: TextStyle(
                color: palette.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 120),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final item in receipt.items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.quantity == '1.000000'
                                ? item.nameSnapshot
                                : '${item.nameSnapshot} x${item.quantity}',
                            style: TextStyle(color: palette.text, fontSize: 12),
                          ),
                        ),
                        Text(
                          _money(
                            Money.parse(item.lineTotal, sale.currencyCode),
                          ),
                          style: TextStyle(
                            color: palette.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
        Divider(color: palette.border, height: 20),
        _CashSummaryRow(
          label: 'Subtotal',
          value: _money(Money.parse(sale.subtotal, sale.currencyCode)),
        ),
        // TASK 12.9: only ever shown for a real, nonzero
        // `sale.discount_total` — a legacy/undiscounted sale (ADR-0016
        // D14) renders exactly as before.
        if (Money.parse(sale.discountTotal, sale.currencyCode).isPositive) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(
            label: 'Descuento',
            value: '-${_money(Money.parse(sale.discountTotal, sale.currencyCode))}',
          ),
        ],
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'IVA',
          value: _money(Money.parse(sale.taxTotal, sale.currencyCode)),
        ),
        if (cash?.tenderedAmount != null) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(
            label: 'Efectivo recibido',
            value: _money(
              Money.parse(cash!.tenderedAmount!, cash.currencyCode),
            ),
          ),
        ],
      ],
    );
  }
}

/// TASK 12.5A: the mandatory confirmation gate — opening this dialog never
/// completes the sale by itself; only [_confirm] (bound to the explicit
/// "Confirmar pago en efectivo" button) ever calls the backend. Shows the
/// authoritative total, a numeric tendered-amount entry, and the live
/// computed change — client-side, for immediate feedback only; the
/// success value this dialog resolves with always carries the backend's
/// own authoritative `tendered_amount`/`change_amount` (see ADR-0011).
class _CashPaymentDialog extends StatefulWidget {
  const _CashPaymentDialog({
    required this.saleId,
    required this.saleNumber,
    required this.totalDue,
    required this.paymentsGateway,
  });
  final String saleId;
  final String saleNumber;
  final Money totalDue;
  final PosPaymentsGateway paymentsGateway;

  @override
  State<_CashPaymentDialog> createState() => _CashPaymentDialogState();
}

class _CashPaymentDialogState extends State<_CashPaymentDialog> {
  final _controller = TextEditingController();
  Money? _tendered;
  bool _busy = false;
  String? _errorMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String text) {
    setState(() {
      _errorMessage = null;
      final trimmed = text.trim();
      if (trimmed.isEmpty) {
        _tendered = null;
        return;
      }
      try {
        _tendered = Money.parse(trimmed, widget.totalDue.currencyCode);
      } on MoneyFormatException {
        _tendered = null;
      }
    });
  }

  /// `null` while nothing valid has been typed yet, or while the typed
  /// amount is still short of the total (see [_shortBy]) — a short tender
  /// is never treated as "zero change", it is simply not confirmable yet.
  Money? get _change {
    final tendered = _tendered;
    if (tendered == null) return null;
    final diff = tendered - widget.totalDue;
    return diff.isNegative ? null : diff;
  }

  Money? get _shortBy {
    final tendered = _tendered;
    if (tendered == null) return null;
    final diff = widget.totalDue - tendered;
    return diff.isNegative || diff.isZero ? null : diff;
  }

  bool get _canConfirm => !_busy && _change != null;

  Future<void> _confirm() async {
    final tendered = _tendered;
    if (!_canConfirm || tendered == null) return;
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final result = await widget.paymentsGateway.createCashPayment(
        saleId: widget.saleId,
        tenderedAmount: tendered.toApiString(),
      );
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible registrar el pago en efectivo.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final change = _change;
    final shortBy = _shortBy;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.payments_outlined,
                    color: palette.action,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Pago en efectivo — venta ${widget.saleNumber}',
                      style: TextStyle(
                        color: palette.text,
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _CashSummaryRow(
                label: 'Total',
                value: _money(widget.totalDue),
                big: true,
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('pos-cash-dialog-input'),
                controller: _controller,
                autofocus: true,
                enabled: !_busy,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                ],
                onChanged: _onChanged,
                onSubmitted: (_) => _confirm(),
                style: TextStyle(
                  color: palette.text,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
                decoration: InputDecoration(
                  isDense: true,
                  labelText: 'Efectivo recibido',
                  prefixText: r'$',
                  filled: true,
                  fillColor: palette.background,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 12,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              _CashSummaryRow(
                label: 'Cambio',
                value: change != null
                    ? _money(change)
                    : shortBy != null
                    ? 'Faltan ${_money(shortBy)}'
                    : '—',
                warn: shortBy != null,
                emphasis: change != null,
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMessage!,
                  style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                ),
              ],
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: palette.textSecondary,
                        side: BorderSide(color: palette.border),
                      ),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: FilledButton(
                      key: const Key('pos-cash-dialog-confirm'),
                      onPressed: _canConfirm ? _confirm : null,
                      style: FilledButton.styleFrom(
                        backgroundColor: palette.action,
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text('Confirmar pago en efectivo'),
                            ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CashSummaryRow extends StatelessWidget {
  const _CashSummaryRow({
    required this.label,
    required this.value,
    this.big = false,
    this.emphasis = false,
    this.warn = false,
  });
  final String label;
  final String value;
  final bool big;
  final bool emphasis;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final color = warn
        ? Colors.redAccent
        : (emphasis ? palette.action : palette.text);
    // TASK 12.5B.1 (real-browser QA: "RIGHT OVERFLOWED BY 1.1 PIXELS" on
    // this Row for a long sale-number value, and "FolioSALE-..." with no
    // visible gap): the previous `spaceBetween` Row laid out both `Text`
    // children at their unconstrained natural width. For a short value
    // that fits, `spaceBetween` pushes them to either edge with the
    // illusion of a gap; the moment label+value's combined natural width
    // reaches or exceeds the Row's available width (e.g. the full
    // canonical `SALE-<32-hex>` folio), `spaceBetween` has no free space
    // left to distribute — the two texts render flush against each other
    // (the "FolioSALE-..." bug) and the value overflows the Row's right
    // edge (the "1.1 pixels" bug). Both symptoms share this one cause.
    //
    // Fix: give the value its own bounded `Expanded` box, separated from
    // the label by a real, explicit gap (a layout `SizedBox`, never a
    // literal space character inside either string). A long value then
    // wraps onto additional lines within that bounded width instead of
    // overflowing — no `maxLines`/`overflow` clipping, so nothing is ever
    // hidden to silence the overflow. For a short value this renders
    // pixel-identical to the previous `spaceBetween` layout: right-aligned
    // text filling the remaining Row width.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w600,
            fontSize: big ? 13 : 12,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w800,
              fontSize: big ? 16 : 14,
            ),
          ),
        ),
      ],
    );
  }
}

class _ContextLabel extends StatelessWidget {
  const _ContextLabel({required this.company, required this.branch});
  final String company;
  final String branch;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: palette.background,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.storefront_outlined, size: 16, color: palette.blueDeep),
          const SizedBox(width: 7),
          Text(
            '$company · $branch',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

/// POS branch-context fix: shown in place of the ticket UI whenever
/// Punto de Venta is entered with no concrete operational branch
/// selected ("Todas las sucursales") — a real Sale must always belong to
/// exactly one authorized branch (see the `sales` table's own
/// branch-scoped foreign key, ADR-0009). Only ever offers
/// `context.branches` — the authenticated session's own real authorized
/// list, never an arbitrary or locally-fabricated id — and reuses the
/// exact same `onBranchSelected` (`AuthController.selectBranch`) the
/// topbar picker uses, so there is one branch-switch code path, never
/// two. The backend re-validates branch ownership/authorization on every
/// call regardless (defense in depth, unchanged).
class _PosBranchRequired extends StatefulWidget {
  const _PosBranchRequired({
    required this.context,
    required this.onBranchSelected,
  });
  final AuthenticatedContext context;
  final Future<void> Function(String? branchId) onBranchSelected;

  @override
  State<_PosBranchRequired> createState() => _PosBranchRequiredState();
}

class _PosBranchRequiredState extends State<_PosBranchRequired> {
  bool _selecting = false;

  Future<void> _select(String branchId) async {
    if (_selecting) return;
    setState(() => _selecting = true);
    try {
      await widget.onBranchSelected(branchId);
    } finally {
      if (mounted) setState(() => _selecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branches = widget.context.branches;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: _PosCard(
          padding: const EdgeInsets.all(20),
          child: Column(
            key: const Key('pos-branch-required'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(
                Icons.storefront_outlined,
                size: 34,
                color: palette.blueDeep,
              ),
              const SizedBox(height: 10),
              Text(
                'Selecciona una sucursal para operar el Punto de Venta',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: palette.text,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Una venta real siempre pertenece a una sucursal concreta. '
                '"Todas las sucursales" solo aplica a paneles y reportes '
                'consolidados.',
                textAlign: TextAlign.center,
                style: TextStyle(color: palette.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 16),
              if (branches.isEmpty)
                Text(
                  'Esta sesión no tiene sucursales autorizadas.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                )
              else
                for (final branch in branches)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: OutlinedButton(
                      key: Key('pos-branch-required-${branch.id}'),
                      onPressed: _selecting ? null : () => _select(branch.id),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: palette.text,
                        side: BorderSide(color: palette.border),
                        padding: const EdgeInsets.symmetric(
                          vertical: 12,
                          horizontal: 12,
                        ),
                        alignment: Alignment.centerLeft,
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.store_mall_directory_outlined,
                            size: 16,
                            color: palette.blueDeep,
                          ),
                          const SizedBox(width: 8),
                          Expanded(child: Text(branch.name)),
                          if (_selecting)
                            SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: palette.textSecondary,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({
    required this.module,
    required this.context,
    required this.controller,
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    required this.refundsGateway,
    required this.promotionsGateway,
    required this.customersGateway,
    required this.membershipsGateway,
    required this.loyaltyGateway,
    required this.rewardsGateway,
    required this.partiesGateway,
    required this.heldSalesGateway,
    required this.purchasingGateway,
    required this.suppliersGateway,
    required this.reportsGateway,
    required this.accessGateway,
    required this.employeesGateway,
    required this.schedulesGateway,
    required this.timeClockGateway,
    required this.payrollGateway,
    required this.dashboardGateway,
    required this.settingsGateway,
    required this.productVariantsGateway,
    required this.assistantGateway,
    required this.authGateway,
    required this.onEnterCliente,
    required this.onBranchSelected,
    required this.onNavigateToModule,
  });

  final PosModule module;
  final AuthenticatedContext context;
  final PosReadController controller;
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
  final PosRefundsGateway refundsGateway;
  // TASK 12.9: promotion/coupon quoting and admin management — see
  // `pos_promotions_gateway.dart` and ADR-0016.
  final PosPromotionsGateway promotionsGateway;
  // TASK 13.0: customer identity/membership/loyalty foundation — see
  // ADR-0017.
  final PosCustomersGateway customersGateway;
  final PosMembershipsGateway membershipsGateway;
  final PosLoyaltyGateway loyaltyGateway;
  // TASK 13.1: reward entitlements/redemption — see
  // `pos_rewards_gateway.dart` and ADR-0018.
  final PosRewardsGateway rewardsGateway;
  // TASK 14.3 Wave 1 Part A: "Fiestas" (party reservations) — see
  // `pos_parties_gateway.dart` and `docs/LEGACY_FIESTAS_RECOVERY.md`.
  final PosPartiesGateway partiesGateway;
  // TASK 14.3 Wave 1 Part B.1: suspend/list/resume/link-sale/discard a
  // held-sale cart — see `pos_held_sales_gateway.dart`.
  final PosHeldSalesGateway heldSalesGateway;
  // TASK 14.3 Wave 1 Part C: direct purchase / quick restock — see
  // `pos_purchasing_gateway.dart`.
  final PosPurchasingGateway purchasingGateway;
  // TASK 14.4 (Wave 2, Part C.1): real supplier directory — see
  // `pos_suppliers_gateway.dart`.
  final PosSuppliersGateway suppliersGateway;
  // TASK 14.4 (Wave 2, Part D): Report Center — see
  // `pos_reports_gateway.dart`.
  final PosReportsGateway reportsGateway;
  // TASK 14.4 (Wave 2, Part E): Control de Acceso — see
  // `pos_access_gateway.dart`.
  final PosAccessGateway accessGateway;
  // TASK 14.4 (Wave 2, Part B): Empleados/Horarios/Checador/Nómina — see
  // `pos_people_gateway.dart`.
  final PosEmployeesGateway employeesGateway;
  final PosSchedulesGateway schedulesGateway;
  final PosTimeClockGateway timeClockGateway;
  final PosPayrollGateway payrollGateway;
  // TASK 14.5 (Wave 3, Phase 2): Dashboard ("today at a glance") — see
  // `pos_dashboard_gateway.dart`.
  final PosDashboardGateway dashboardGateway;
  final PosSettingsGateway settingsGateway;
  final PosProductVariantsGateway productVariantsGateway;
  final PosAssistantGateway assistantGateway;
  final PosAuthGateway authGateway;
  final VoidCallback onEnterCliente;
  final Future<void> Function(String? branchId) onBranchSelected;
  // TASK 12.8: lets a refund dialog (Sale Detail → "Devolver /
  // Reembolsar") navigate straight to Caja after a `cash_session_required`
  // completion error, mirroring `select` in `_PosShellState` — never a
  // silently-opened session, just a real navigation to the existing Caja
  // screen so the cashier can open one themselves.
  final ValueChanged<PosModule> onNavigateToModule;

  @override
  Widget build(BuildContext context) {
    final padding = EdgeInsets.all(
      MediaQuery.sizeOf(context).width >= 900 ? 20 : 12,
    );
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) => ColoredBox(
        color: PosPalette.of(context).background,
        // The POS sale surface is a fixed, non-scrolling operational
        // workspace in the canonical reference (`.pos-layout{overflow:
        // hidden}`) — only its product grid scrolls internally. Every other
        // module keeps the shared scrollable admin-page pattern.
        child: module == PosModule.pos || module == PosModule.cafeteria
            ? Padding(
                padding: padding,
                // POS branch-context fix: "Todas las sucursales" stays a
                // valid consolidated view for dashboards/reports, but a
                // real Sale must always belong to one concrete
                // authorized branch — this is the entry gate, checked
                // before the cashier can build a ticket at all, not just
                // at Cobrar (the backend/checkout guard in
                // `_submitCashSaleForPayment`/`_submitSaleForPayment`
                // stays in place unchanged as defense in depth). Applies
                // identically to `PosModule.cafeteria` — TASK 14.5 (Wave
                // 3, Phase 6): "Acceso rápido" is the exact same real
                // sale surface, scoped to visual-tile categories, never a
                // second disconnected screen.
                child: this.context.currentBranch == null
                    ? _PosBranchRequired(
                        context: this.context,
                        onBranchSelected: onBranchSelected,
                      )
                    : _PosSale(
                        context: this.context,
                        controller: controller,
                        saleSession: saleSession,
                        salesGateway: salesGateway,
                        paymentsGateway: paymentsGateway,
                        cashGateway: cashGateway,
                        promotionsGateway: promotionsGateway,
                        customersGateway: customersGateway,
                        rewardsGateway: rewardsGateway,
                        heldSalesGateway: heldSalesGateway,
                        onEnterCliente: onEnterCliente,
                        visualTileOnly: module == PosModule.cafeteria,
                        authGateway: authGateway,
                      ),
              )
            : SingleChildScrollView(
                padding: padding,
                child: switch (module) {
                  // TASK 14.5 (Wave 3, Phase 2): the Dashboard ("today at
                  // a glance") — real, server-aggregated metrics; see
                  // `pos_dashboard_gateway.dart`.
                  PosModule.dashboard => _Dashboard(
                    context: this.context,
                    dashboardGateway: dashboardGateway,
                  ),
                  PosModule.products => _Products(
                    state: controller.products,
                    allowed: this.context.permissions.contains('catalog.read'),
                    onRefresh: () => controller.loadProducts(refresh: true),
                  ),
                  // TASK 14.5 (Wave 3, Phase 7, Item 3): Variantes — manage
                  // multiple real variants per product.
                  PosModule.productVariants => PosProductVariantsScreen(
                    context: this.context,
                    gateway: productVariantsGateway,
                  ),
                  PosModule.inventory => _Inventory(
                    state: controller.balances,
                    allowed: this.context.permissions.contains(
                      'inventory.read',
                    ),
                    onRefresh: () => controller.loadBalances(
                      branchId: this.context.session.branchId,
                      refresh: true,
                    ),
                    onOpenDirectPurchase: () => onNavigateToModule(PosModule.purchases),
                  ),
                  PosModule.users => _Users(
                    state: controller.users,
                    allowed: this.context.permissions.contains('user.read'),
                    onRefresh: () => controller.loadUsers(refresh: true),
                  ),
                  PosModule.history => _SalesHistory(
                    context: this.context,
                    salesGateway: salesGateway,
                    refundsGateway: refundsGateway,
                    onNavigateToCaja: () =>
                        onNavigateToModule(PosModule.cash),
                  ),
                  // TASK 12.7: the pre-reserved `PosModule.cash` slot
                  // ("Corte de Caja") — no second, parallel Caja entry was
                  // created (Part M). Keyed by branch so a branch switch
                  // always tears down and rebuilds this state from
                  // scratch — the structural guarantee behind ADR-0014
                  // §B8's "never carry an open session across branches".
                  PosModule.cash => _Caja(
                    key: ValueKey('caja-${this.context.session.branchId}'),
                    context: this.context,
                    cashGateway: cashGateway,
                  ),
                  // TASK 12.8: the pre-reserved `PosModule.returns` slot
                  // ("Devoluciones") — a real, backend-paginated global
                  // refund history (E084); a per-sale return history lives
                  // inside Sale Detail instead (same E084 endpoint, filtered
                  // by `sale_id` — never a second, duplicate list).
                  PosModule.returns => _Devoluciones(
                    context: this.context,
                    refundsGateway: refundsGateway,
                    salesGateway: salesGateway,
                    onNavigateToCaja: () =>
                        onNavigateToModule(PosModule.cash),
                  ),
                  // TASK 12.9: the pre-reserved `PosModule.promotions` slot
                  // ("Cupones / Promos") — minimum operational admin
                  // management (list/create/edit promotions and coupons),
                  // never a marketing analytics dashboard (ADR-0016 D15) —
                  // mirrors `PosModule.returns`/`PosModule.cash` exactly.
                  PosModule.promotions => _PromotionsAdmin(
                    context: this.context,
                    promotionsGateway: promotionsGateway,
                  ),
                  // TASK 13.0: the pre-reserved `PosModule.customers` slot
                  // ("Clientes") — customer directory (search/list/
                  // detail/create/edit); Membresías/Rewards/Ventas
                  // recientes live inside Customer Detail (see ADR-0017).
                  PosModule.customers => _CustomersAdmin(
                    context: this.context,
                    customersGateway: customersGateway,
                    membershipsGateway: membershipsGateway,
                    loyaltyGateway: loyaltyGateway,
                    rewardsGateway: rewardsGateway,
                    salesGateway: salesGateway,
                  ),
                  // TASK 13.0: the pre-reserved `PosModule.memberships`
                  // slot ("Membresías") — membership PLAN admin only; a
                  // customer's own issued memberships live in Customer
                  // Detail instead of a second, duplicate list here.
                  PosModule.memberships => _MembershipsAdmin(
                    context: this.context,
                    membershipsGateway: membershipsGateway,
                  ),
                  // TASK 14.3 Wave 1 Part A: the pre-reserved
                  // `PosModule.events` slot ("Fiestas") — real
                  // reservation Lista/Calendario/Cotizador/Ajustes, wired
                  // to the already-tested `apps/api/.../parties` module.
                  // See `docs/LEGACY_FIESTAS_RECOVERY.md`.
                  PosModule.events => _FiestasAdmin(
                    context: this.context,
                    controller: controller,
                    partiesGateway: partiesGateway,
                    customersGateway: customersGateway,
                    cashGateway: cashGateway,
                  ),
                  // TASK 14.3 Wave 1 Part B.1: the pre-reserved
                  // `PosModule.suspended` slot ("Ventas Suspendidas") —
                  // real, backend-persisted held-cart list/resume/discard.
                  PosModule.suspended => _HeldSales(
                    context: this.context,
                    controller: controller,
                    saleSession: saleSession,
                    heldSalesGateway: heldSalesGateway,
                    onNavigateToPos: () => onNavigateToModule(PosModule.pos),
                  ),
                  // TASK 14.3 Wave 1 Part C: the pre-reserved
                  // `PosModule.purchases` slot ("Compras") — "Compra
                  // Directa" (direct purchase / quick restock) form plus
                  // its real history.
                  PosModule.purchases => _DirectPurchases(
                    context: this.context,
                    controller: controller,
                    purchasingGateway: purchasingGateway,
                    suppliersGateway: suppliersGateway,
                  ),
                  // TASK 14.4 (Wave 2, Part C.1): the pre-reserved
                  // `PosModule.suppliers` slot ("Proveedores") — real
                  // supplier directory (list/create/edit/deactivate).
                  PosModule.suppliers => PosSuppliersScreen(
                    context: this.context,
                    suppliersGateway: suppliersGateway,
                  ),
                  // TASK 14.4 (Wave 2, Part D): the pre-reserved
                  // `PosModule.reports` slot ("Reportes") — real,
                  // server-aggregated Report Center.
                  PosModule.reports => PosReportsScreen(
                    context: this.context,
                    reportsGateway: reportsGateway,
                  ),
                  // TASK 14.4 (Wave 2, Part E): the pre-reserved
                  // `PosModule.access` slot ("Control Acceso") — real
                  // credential issue/scan/void and occupancy, replacing
                  // the legacy's own fake ticket scanner.
                  PosModule.access => PosAccessScreen(
                    context: this.context,
                    accessGateway: accessGateway,
                  ),
                  // TASK 14.4 (Wave 2, Part B): the pre-reserved
                  // `PosModule.employees` slot ("Empleados") —
                  // Empleados/Horarios/Checador/Nómina.
                  PosModule.employees => PosPeopleScreen(
                    context: this.context,
                    employeesGateway: employeesGateway,
                    schedulesGateway: schedulesGateway,
                    timeClockGateway: timeClockGateway,
                    payrollGateway: payrollGateway,
                  ),
                  // TASK 14.5 (Wave 3, Phase 8): Marca del Ticket —
                  // per-tenant receipt header/footer text.
                  PosModule.receiptBranding => PosReceiptBrandingScreen(
                    context: this.context,
                    settingsGateway: settingsGateway,
                  ),
                  // TASK 14.5 (Wave 3, Phase 7, Item 6): Asistente — real
                  // deterministic FAQ bot over live data.
                  PosModule.assistant => PosAssistantScreen(
                    context: this.context,
                    gateway: assistantGateway,
                  ),
                  _ => _ComingSoon(module: module),
                },
              ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.description,
    this.action,
  });
  final String title;
  final String description;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: palette.text,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  description,
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}

class _PosCard extends StatelessWidget {
  const _PosCard({
    required this.child,
    this.padding = const EdgeInsets.all(14),
    super.key,
  });
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: palette.text.withValues(alpha: .06),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: child,
    );
  }
}

// ---------------------------------------------------------------------
// TASK 14.5 (Wave 3, Phase 2) — Dashboard ("today at a glance"). The FIRST
// real metrics UI a user lands on by default (the pre-existing
// `_Dashboard` was explicitly context-only — "Sin métricas simuladas").
// Every number below comes straight off `pos_dashboard_gateway.dart`'s
// own typed `PosDashboardSummary`, which mirrors
// `dashboard.routes.ts`/`dashboard.types.ts` field-for-field — nothing
// here invents a metric, a trend/growth percentage, or a fabricated
// alert the backend did not actually compute (see this task's own
// instruction #4). A genuinely all-zero day renders real, honest zeros —
// the metric grid is never hidden behind a generic "empty" placeholder
// (mirrors `_ReportPanel`'s own documented choice in
// `pos_reports_screen.dart`: "a ready report is never 'empty' as a
// distinct phase"). The two sub-lists below the grid (today's parties,
// open cash sessions) DO have a legitimate empty state of their own
// (`_DashboardEmptyNote`) — a real "sin fiestas hoy"/"sin cajas
// abiertas" message, never a fabricated row.
// ---------------------------------------------------------------------

enum _DashboardPhase { loading, ready, failure }

/// Holds the header/branch-filter UI only. The real fetch lives in
/// `_DashboardBody` below, keyed by `date`+`branch` — mirrors
/// `PosReportsScreen`/`_ReportPanel`'s own established split in
/// `pos_reports_screen.dart` exactly: `_DashboardBody` is only ever
/// CONSTRUCTED (so its `initState`/load only ever RUNS) when the actor
/// actually has `report.read` — never fetched-then-hidden behind a
/// permission gate, and never re-fetched manually on a branch change (the
/// new key just tears down and rebuilds the body from scratch, the same
/// structural guarantee `_Caja` uses when keyed by branch).
class _Dashboard extends StatefulWidget {
  const _Dashboard({required this.context, required this.dashboardGateway});
  final AuthenticatedContext context;
  final PosDashboardGateway dashboardGateway;

  @override
  State<_Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<_Dashboard> {
  String? _branchFilter;
  late final String _today;

  @override
  void initState() {
    super.initState();
    // "Today" resolved once from the device's own local clock, exactly
    // like `PosReportsScreen`'s own established convention
    // (`_dateTo = DateTime(now.year, now.month, now.day)` in
    // `pos_reports_screen.dart`) — this codebase has no IANA per-branch
    // timezone conversion library anywhere (not in `pubspec.yaml`, not
    // used by any other Wave 1/2 screen, including Reports, the closest
    // precedent this task's own instructions point to), so inventing one
    // here for a single screen would be new, unproven infrastructure,
    // not a faithful port of an established pattern. Device-local time is
    // still a real wall-clock "today," never a naive UTC assumption.
    _today = _isoDate(DateTime.now());
  }

  /// Mirrors `_HeldSales`/`PosReportsScreen`'s own `_branchId` getter
  /// exactly: a branch-scoped session always reports its own single
  /// branch; a company-wide session defaults to a consolidated view
  /// (`null` = every branch the session permits) until the actor picks
  /// one from `_branchFilter`.
  String? get _branchId =>
      widget.context.companyWideAccess ? _branchFilter : widget.context.session.branchId;

  @override
  Widget build(BuildContext context) {
    final allowed = widget.context.permissions.contains('report.read');
    return Column(
      key: const Key('pos-dashboard'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Dashboard',
          description:
              'Resumen operativo real de hoy ($_today), calculado por el servidor. Sin métricas simuladas.',
          action: const _VisualDialogButton(),
        ),
        // Real company/branch context, mirroring `_ReportsHeader`'s own
        // icon+label row in `pos_reports_screen.dart` (extended with the
        // company name — a report is always reached from an already-known
        // company context in its own screen, but Dashboard is the very
        // first screen a session lands on, so it names both).
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          // `Wrap` (never `Row`) — a long company/branch name pair must
          // wrap onto a second line on a narrow viewport rather than
          // overflow it (this section header sits above content that
          // scrolls, so wrapping costs nothing).
          child: Wrap(
            spacing: 5,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Icon(Icons.apartment_outlined, size: 15, color: PosPalette.of(context).textMuted),
              Text(
                widget.context.currentCompany?.name ?? 'Sin empresa seleccionada',
                style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12.5),
              ),
              const SizedBox(width: 9),
              Icon(Icons.store_outlined, size: 15, color: PosPalette.of(context).textMuted),
              Text(
                widget.context.companyWideAccess
                    ? 'Todas las sucursales'
                    : (widget.context.currentBranch?.name ?? 'Sucursal actual'),
                style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12.5),
              ),
            ],
          ),
        ),
        if (widget.context.companyWideAccess)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: SizedBox(
              width: 260,
              child: DropdownButtonFormField<String?>(
                key: const Key('pos-dashboard-branch-selector'),
                initialValue: _branchFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Sucursal'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Todas las sucursales')),
                  for (final item in widget.context.branches)
                    DropdownMenuItem(value: item.id, child: Text(item.name)),
                ],
                onChanged: (value) => setState(() => _branchFilter = value),
              ),
            ),
          ),
        if (!allowed)
          const KeyedSubtree(key: Key('pos-dashboard-permission'), child: _PermissionState())
        else
          _DashboardBody(
            key: ValueKey('pos-dashboard-body-$_today-${_branchId ?? 'all'}'),
            date: _today,
            branchId: _branchId,
            dashboardGateway: widget.dashboardGateway,
          ),
      ],
    );
  }
}

class _DashboardBody extends StatefulWidget {
  const _DashboardBody({
    required this.date,
    required this.branchId,
    required this.dashboardGateway,
    super.key,
  });
  final String date;
  final String? branchId;
  final PosDashboardGateway dashboardGateway;

  @override
  State<_DashboardBody> createState() => _DashboardBodyState();
}

class _DashboardBodyState extends State<_DashboardBody> {
  _DashboardPhase _phase = _DashboardPhase.loading;
  PosDashboardSummary? _summary;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _phase = _DashboardPhase.loading;
      _errorMessage = null;
    });
    try {
      final summary = await widget.dashboardGateway.summary(date: widget.date, branchId: widget.branchId);
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _phase = _DashboardPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _DashboardPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _DashboardPhase.failure;
        _errorMessage = 'No fue posible cargar el dashboard.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Align(
        alignment: Alignment.centerRight,
        child: KeyedSubtree(
          key: const Key('pos-dashboard-refresh'),
          child: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
      ),
      const SizedBox(height: 8),
      switch (_phase) {
        _DashboardPhase.loading => const KeyedSubtree(
          key: Key('pos-dashboard-loading'),
          child: _LoadingState(),
        ),
        _DashboardPhase.failure => KeyedSubtree(
          key: const Key('pos-dashboard-failure'),
          child: _FailureState(
            message: _errorMessage ?? 'No fue posible cargar el dashboard.',
            onRetry: () => unawaited(_load()),
          ),
        ),
        _DashboardPhase.ready => _DashboardReady(summary: _summary!),
      },
    ],
  );
}

/// Right-aligned money, one line per currency actually present — never
/// summed across currencies, mirroring
/// `pos_reports_screen.dart`'s own `_formatAmountString` exactly
/// (this file's own single-currency `_formatMoney` deliberately omits
/// the currency code, which is wrong for a figure that could carry more
/// than one — see that helper's own doc comment).
String _formatDashboardMoney(String amount, String currencyCode) {
  final trimmed = amount.trim();
  final negative = trimmed.startsWith('-');
  final magnitude = negative ? trimmed.substring(1) : trimmed;
  try {
    final money = Money.parse(magnitude, currencyCode);
    return '${negative ? '-' : ''}${money.toDisplayString()} $currencyCode';
  } on MoneyFormatException {
    return '$amount $currencyCode';
  }
}

class _DashboardReady extends StatelessWidget {
  const _DashboardReady({required this.summary});
  final PosDashboardSummary summary;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // An empty amounts list means genuinely zero activity — shown as a
    // plain "0" (never a fabricated "$0.00" in a currency the backend
    // never actually returned; mirrors `pos_reports_screen.dart`'s own
    // `_ReportsMoneyList` choice to never guess a currency for an empty
    // range, adapted here to a single always-visible metric card instead
    // of a hidden section).
    final salesTotal = summary.salesGrossTotal.isEmpty
        ? '0'
        : summary.salesGrossTotal
              .map((entry) => _formatDashboardMoney(entry.amount, entry.currencyCode))
              .join('\n');
    final outstandingTotal = summary.outstandingPartyBalances.isEmpty
        ? '0'
        : summary.outstandingPartyBalances
              .map((entry) => _formatDashboardMoney(entry.amount, entry.currencyCode))
              .join('\n');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 1200
                ? 4
                : constraints.maxWidth >= 860
                ? 3
                : constraints.maxWidth >= 500
                ? 2
                : 1;
            return GridView.count(
              key: const Key('pos-dashboard-metrics-grid'),
              crossAxisCount: columns,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: columns == 1 ? 2.6 : 1.5,
              children: [
                _DashboardMetricCard(
                  key: const Key('pos-dashboard-metric-sales'),
                  icon: Icons.point_of_sale_outlined,
                  label: 'Ventas de hoy',
                  value: salesTotal,
                  caption: '${summary.salesTransactionCount} transacción(es)',
                ),
                _DashboardMetricCard(
                  key: const Key('pos-dashboard-metric-occupancy'),
                  icon: Icons.groups_outlined,
                  label: 'Ocupación actual',
                  value: '${summary.currentOccupancy}',
                  caption: 'personas dentro (en vivo)',
                ),
                _DashboardMetricCard(
                  key: const Key('pos-dashboard-metric-parties'),
                  icon: Icons.celebration_outlined,
                  label: 'Fiestas de hoy',
                  value: '${summary.partyReservationCount}',
                  caption: 'reservación(es)',
                ),
                _DashboardMetricCard(
                  key: const Key('pos-dashboard-metric-cash-sessions'),
                  icon: Icons.point_of_sale,
                  label: 'Cajas abiertas',
                  value: '${summary.openCashSessionCount}',
                  caption: 'sesión(es) de caja',
                ),
                _DashboardMetricCard(
                  key: const Key('pos-dashboard-metric-outstanding-balance'),
                  icon: Icons.receipt_long_outlined,
                  label: 'Saldo pendiente de fiestas',
                  value: outstandingTotal,
                  caption: 'reservaciones activas, no canceladas',
                ),
                _DashboardMetricCard(
                  key: const Key('pos-dashboard-metric-attendance'),
                  icon: Icons.badge_outlined,
                  label: 'Empleados en turno',
                  value: '${summary.clockedInEmployeeCount}',
                  caption: 'con entrada registrada hoy',
                ),
                _DashboardMetricCard(
                  key: const Key('pos-dashboard-metric-inventory-alerts'),
                  icon: Icons.inventory_2_outlined,
                  label: 'Variantes agotadas',
                  value: '${summary.outOfStockVariantCount}',
                  caption: 'inventario en vivo',
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 18),
        LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 860;
            final partiesCard = _DashboardListCard(
              key: const Key('pos-dashboard-parties-list'),
              title: 'Fiestas de hoy',
              child: summary.partyReservations.isEmpty
                  ? const _DashboardEmptyNote(
                      key: Key('pos-dashboard-parties-empty'),
                      message: 'Sin fiestas registradas hoy.',
                    )
                  : Column(
                      children: [
                        for (final reservation in summary.partyReservations)
                          _DashboardPartyRow(reservation: reservation),
                      ],
                    ),
            );
            final sessionsCard = _DashboardListCard(
              key: const Key('pos-dashboard-cash-sessions-list'),
              title: 'Cajas abiertas',
              child: summary.openCashSessions.isEmpty
                  ? const _DashboardEmptyNote(
                      key: Key('pos-dashboard-cash-sessions-empty'),
                      message: 'No hay cajas abiertas en este momento.',
                    )
                  : Column(
                      children: [
                        for (final session in summary.openCashSessions)
                          _DashboardCashSessionRow(session: session),
                      ],
                    ),
            );
            if (!wide) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [partiesCard, const SizedBox(height: 12), sessionsCard],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: partiesCard),
                const SizedBox(width: 12),
                Expanded(child: sessionsCard),
              ],
            );
          },
        ),
        const SizedBox(height: 4),
        Text(
          'La ocupación, el inventario agotado y las cajas abiertas son fotos en tiempo real '
          '(no filtradas por fecha); el saldo pendiente de fiestas es una cifra vigente para toda '
          'la empresa, no solo para hoy.',
          style: TextStyle(color: palette.textMuted, fontSize: 11.5),
        ),
      ],
    );
  }
}

class _DashboardMetricCard extends StatelessWidget {
  const _DashboardMetricCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.caption,
    super.key,
  });
  final IconData icon;
  final String label;
  final String value;
  final String caption;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: palette.blueDeep),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: palette.textSecondary, fontSize: 11.5, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(color: palette.text, fontSize: 22, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(caption, style: TextStyle(color: palette.textMuted, fontSize: 11)),
        ],
      ),
    );
  }
}

class _DashboardListCard extends StatelessWidget {
  const _DashboardListCard({required this.title, required this.child, super.key});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}

class _DashboardEmptyNote extends StatelessWidget {
  const _DashboardEmptyNote({required this.message, super.key});
  final String message;

  @override
  Widget build(BuildContext context) =>
      Text(message, style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12.5));
}

class _DashboardPartyRow extends StatelessWidget {
  const _DashboardPartyRow({required this.reservation});
  final PosDashboardPartyReservation reservation;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final who = reservation.celebrantName ?? reservation.customerDisplayName ?? 'Sin nombre registrado';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(Icons.cake_outlined, size: 16, color: palette.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(who, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                Text(
                  '${_hhmm(reservation.startTime)}–${_hhmm(reservation.endTime)} · ${reservation.roomName ?? 'Salón sin nombre'}',
                  style: TextStyle(color: palette.textMuted, fontSize: 11.5),
                ),
              ],
            ),
          ),
          Text(reservation.status, style: TextStyle(color: palette.textSecondary, fontSize: 11.5)),
        ],
      ),
    );
  }
}

class _DashboardCashSessionRow extends StatelessWidget {
  const _DashboardCashSessionRow({required this.session});
  final PosDashboardOpenCashSession session;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(Icons.point_of_sale, size: 16, color: palette.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  session.cashRegisterName ?? session.cashRegisterCode ?? 'Caja sin nombre',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                ),
                Text(
                  'Apertura ${_formatDashboardMoney(session.openingAmount, session.currencyCode)} · ${_formatClockTime(session.openedAt)}',
                  style: TextStyle(color: palette.textMuted, fontSize: 11.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Read-only "Punto de Venta" foundation: category strip, search, a product
/// grid reusing the same load/empty/error states as the other modules, and a
/// persistent ticket panel frame. No cart, pricing, or checkout behavior is
/// implemented — see docs/AS_POS_READ_ONLY_SHELL.md.
class _PosSale extends StatefulWidget {
  const _PosSale({
    required this.context,
    required this.controller,
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    required this.promotionsGateway,
    required this.customersGateway,
    required this.rewardsGateway,
    required this.heldSalesGateway,
    required this.onEnterCliente,
    // TASK 14.5 (Wave 3, Phase 6): `true` only when rendered for
    // `PosModule.cafeteria` ("Acceso rápido") — see
    // `_CategoryStrip.visualTileOnly`. Shares the exact same
    // `saleSession`/gateways as regular Punto de Venta (never a
    // disconnected second cart), only the category/product scope differs.
    this.visualTileOnly = false,
    this.authGateway = const EmptyPosAuthGateway(),
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  // TASK 12.3B: owned by `_PosShellState` now, not created here — CLIENTE
  // mode needs the exact same session to survive being rendered by an
  // entirely different widget (`_ClienteLockedShell`), not a copy scoped
  // to this screen.
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
  final PosPromotionsGateway promotionsGateway;
  // TASK 13.0: the CAJERO-only customer selector — see `_TicketFooter`.
  final PosCustomersGateway customersGateway;
  // TASK 13.1: the CAJERO-only reward lookup/redeem affordance — see
  // `_TicketFooter` and ADR-0018.
  final PosRewardsGateway rewardsGateway;
  // TASK 14.3 Wave 1 Part B.1: "Suspender venta" (F5) — see
  // `pos_held_sales_gateway.dart`.
  final PosHeldSalesGateway heldSalesGateway;
  final VoidCallback onEnterCliente;
  final bool visualTileOnly;
  final PosAuthGateway authGateway;

  @override
  State<_PosSale> createState() => _PosSaleState();
}

class _PosSaleState extends State<_PosSale> {
  String? selectedCategoryId;
  String query = '';
  final searchFocusNode = FocusNode(debugLabel: 'pos-sale-search');
  final _searchController = TextEditingController();
  bool _searchBusy = false;
  bool _suspendBusy = false;
  // TASK 14.5 (Wave 3, Phase 4a): lets the F8 shortcut invoke the EXACT
  // same `_handleTap()` the on-screen "Cobrar" button's `onPressed`
  // calls — see `_PosCobrarButton`'s own doc comment.
  final _cobrarButtonKey = GlobalKey<_PosCobrarButtonState>();

  @override
  void dispose() {
    searchFocusNode.dispose();
    _searchController.dispose();
    super.dispose();
  }

  // TASK 14.5 (Wave 3, Phase 4a): "is the cashier currently typing into a
  // text field?" — checked before F3/F5/F6/F8 act, per the task's own
  // explicit requirement that these register-style shortcuts must never
  // fire while focus is inside a `TextField`/`TextFormField`. Flutter's
  // `TextField`/`TextFormField` are both built on the same leaf
  // `EditableText`, which is exactly what ends up holding primary focus
  // while typing — checking for it (rather than e.g. `TextField` itself,
  // which never receives focus directly) is the standard way to detect
  // this from outside the field.
  bool _focusedOnTextField() {
    final focusedContext = FocusManager.instance.primaryFocus?.context;
    if (focusedContext == null) return false;
    if (focusedContext.widget is EditableText) return true;
    // `TextField`/`TextFormField` attach their `FocusNode` to an internal
    // `Focus` wrapper a few layers ABOVE the leaf `EditableText` (i.e.
    // `EditableText` is itself an ancestor of whatever context actually
    // owns primary focus while typing) — walking ancestors is the
    // correct, precisely-bounded direction (bounded by real nesting
    // depth, never by this screen's much larger subtree size). This is
    // also why a plain descendant search from the focused context would
    // be wrong: when NOTHING more specific has focus, primary focus falls
    // back to this screen's own outer, autofocused `Focus` (wrapping the
    // entire POS screen) — searching ITS descendants would find the
    // search field's `EditableText` too, even though it isn't the one
    // actually focused. Searching ancestors never has that false-positive
    // problem, because the search field's `EditableText` sits BELOW
    // (never above) that outer fallback `Focus` in the tree.
    var foundEditableText = false;
    focusedContext.visitAncestorElements((element) {
      if (element.widget is EditableText) {
        foundEditableText = true;
        return false;
      }
      return true;
    });
    return foundEditableText;
  }

  /// TASK 14.3 (Wave 1, Part B.2): a real cash-register keyboard-wedge-
  /// scanner UX — typing/scanning a value and pressing Enter first tries
  /// an EXACT barcode lookup through the already-working backend
  /// `GET /products?barcode=` filter (never a fake/random match — the
  /// exact fix for the legacy screen's own fake "adds a random item
  /// regardless of input" behavior). A hit adds the product directly (or
  /// opens the weight dialog for a `kg`/`g` product); a miss shows an
  /// honest "not found" notice and falls back to the plain name filter
  /// already driving the grid via [query].
  Future<void> _handleSearchSubmit(String value) async {
    final trimmed = value.trim();
    if (trimmed.isEmpty || _searchBusy) return;
    setState(() => _searchBusy = true);
    PosProduct? product;
    String? errorMessage;
    try {
      product = await widget.controller.lookupByBarcode(
        trimmed,
        branchId: widget.context.session.branchId,
      );
    } on ApiException catch (error) {
      errorMessage = error.failure.message;
    } on Object {
      errorMessage = 'No fue posible buscar por código de barras.';
    }
    if (!mounted) return;
    setState(() => _searchBusy = false);
    if (errorMessage != null) {
      _showNotice(context, errorMessage);
      return;
    }
    if (product == null) {
      _showNotice(context, 'No se encontró ningún producto con el código «$trimmed».');
      return;
    }
    final balances = widget.controller.balances.items;
    final block = posAddabilityBlock(product, balances);
    if (block != null) {
      _showNotice(context, _addabilityMessage(block));
      return;
    }
    if (posIsWeightBased(product)) {
      await _openWeightDialog(product);
    } else {
      widget.saleSession.addProduct(product, balances);
    }
    _searchController.clear();
    setState(() => query = '');
  }

  Future<void> _openWeightDialog(PosProduct product) async {
    final weight = await showDialog<String>(
      context: context,
      builder: (dialogContext) => _WeightEntryDialog(product: product),
    );
    if (weight == null || !mounted) return;
    final added = widget.saleSession.addWeightedProduct(
      product,
      weight,
      widget.controller.balances.items,
    );
    if (!added && mounted) {
      _showNotice(context, 'No fue posible agregar el peso capturado.');
    }
  }

  /// TASK 14.3 (Wave 1, Part B.1): "Suspender venta" (F5) — snapshots the
  /// current ticket's real product/quantity pairs server-side, then
  /// clears the on-screen cart. Mirrors — but never copies — the
  /// legacy's own visual suspend button; this one is real and
  /// server-persisted.
  Future<void> _handleSuspend() async {
    if (_suspendBusy) return;
    final saleSession = widget.saleSession;
    if (saleSession.isEmpty) {
      _showNotice(context, 'Agrega al menos un producto al ticket.');
      return;
    }
    final branchId = widget.context.session.branchId;
    if (branchId == null) {
      _showNotice(context, 'Esta sesión no tiene una sucursal asignada.');
      return;
    }
    if (!widget.context.permissions.contains('held_sale.manage')) {
      _showNotice(context, 'Tu sesión no incluye el permiso para suspender ventas.');
      return;
    }
    setState(() => _suspendBusy = true);
    try {
      await widget.heldSalesGateway.createCart(
        branchId: branchId,
        items: [
          for (final line in saleSession.lines)
            PosHeldSaleCartItemRequest(productId: line.productId, quantity: line.quantityForApi),
        ],
      );
      if (!mounted) return;
      saleSession.clearAll();
      _showNotice(context, 'Venta suspendida.');
    } on ApiException catch (error) {
      if (!mounted) return;
      _showNotice(context, error.failure.message);
    } on Object {
      if (!mounted) return;
      _showNotice(context, 'No fue posible suspender la venta.');
    } finally {
      if (mounted) setState(() => _suspendBusy = false);
    }
  }

  // TASK 14.5 (Wave 3, Phase 4a): "Cancelar venta" (F6) — the legacy's
  // `cancelarVentas()` cleared the in-progress cart (after a confirmation
  // + permission gate). The current platform has no server-side concept
  // of an in-progress, not-yet-submitted sale to "cancel" on the backend
  // — a `SaleSession` only ever becomes a real `sales` row at the moment
  // Cobrar succeeds (see `_submitSaleForPayment`/`_submitCashSaleForPayment`),
  // so there is nothing server-side to void yet. The real, honest
  // equivalent today is discarding the local, unsent cart — gated on
  // `sale.cancel` (mirrors `_HeldSales._canDiscard`'s own use of that same
  // permission) and behind a confirmation dialog so a stray keypress can
  // never silently lose a ticket in progress.
  bool get _canCancelSale => widget.context.permissions.contains('sale.cancel');

  Future<void> _handleCancelSale() async {
    if (!_canCancelSale) return;
    final saleSession = widget.saleSession;
    if (saleSession.isEmpty) {
      _showNotice(context, 'El ticket ya está vacío.');
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('pos-cancel-sale-dialog'),
        title: const Text('Cancelar venta'),
        content: const Text(
          'Se eliminarán todos los productos del ticket actual. Esta acción no se puede deshacer.',
        ),
        actions: [
          TextButton(
            key: const Key('pos-cancel-sale-keep'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Seguir vendiendo'),
          ),
          TextButton(
            key: const Key('pos-cancel-sale-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Cancelar venta'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    saleSession.clearAll();
    _showNotice(context, 'Venta cancelada.');
  }

  @override
  Widget build(BuildContext context) {
    final allowed = widget.context.permissions.contains('catalog.read');
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        // TASK 14.5 (Wave 3, Phase 4a): none of these register-style
        // shortcuts may fire while the cashier is typing into a text
        // field (search, cash received, coupon, note…) — mirrors the
        // task's own explicit requirement, and deliberately does NOT
        // reproduce the legacy's own bug of F5/F6/F8 firing mid-typing.
        // F2 is the sole exception: its whole job is moving focus INTO
        // the search field, so it must still work from any other field.
        if (event.logicalKey == LogicalKeyboardKey.f2) {
          searchFocusNode.requestFocus();
          return KeyEventResult.handled;
        }
        if (_focusedOnTextField()) return KeyEventResult.ignored;
        if (event.logicalKey == LogicalKeyboardKey.f3) {
          unawaited(
            openCustomerSelector(
              context,
              saleSession: widget.saleSession,
              customersGateway: widget.customersGateway,
            ),
          );
          return KeyEventResult.handled;
        }
        if (event.logicalKey == LogicalKeyboardKey.f5) {
          unawaited(_handleSuspend());
          return KeyEventResult.handled;
        }
        if (event.logicalKey == LogicalKeyboardKey.f6) {
          unawaited(_handleCancelSale());
          return KeyEventResult.handled;
        }
        if (event.logicalKey == LogicalKeyboardKey.f8) {
          unawaited(_cobrarButtonKey.currentState?._handleTap() ?? Future<void>.value());
          return KeyEventResult.handled;
        }
        if (event.logicalKey == LogicalKeyboardKey.escape) {
          searchFocusNode.requestFocus();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.only(bottom: 10),
            child: _PosReadOnlyBar(),
          ),
          Expanded(
            child: !allowed
                ? const _PermissionState()
                : _PosSaleBody(
                    controller: widget.controller,
                    saleSession: widget.saleSession,
                    salesGateway: widget.salesGateway,
                    paymentsGateway: widget.paymentsGateway,
                    cashGateway: widget.cashGateway,
                    promotionsGateway: widget.promotionsGateway,
                    customersGateway: widget.customersGateway,
                    rewardsGateway: widget.rewardsGateway,
                    heldSalesGateway: widget.heldSalesGateway,
                    branchId: widget.context.session.branchId,
                    permissions: widget.context.permissions,
                    selectedCategoryId: selectedCategoryId,
                    onSelectCategory: (id) =>
                        setState(() => selectedCategoryId = id),
                    query: query,
                    onQueryChanged: (value) => setState(() => query = value),
                    searchFocusNode: searchFocusNode,
                    searchController: _searchController,
                    onSearchSubmitted: _handleSearchSubmit,
                    searchBusy: _searchBusy,
                    onSuspend: _handleSuspend,
                    suspendBusy: _suspendBusy,
                    onEnterCliente: widget.onEnterCliente,
                    onOpenCustomerSelector: () => unawaited(
                      openCustomerSelector(
                        context,
                        saleSession: widget.saleSession,
                        customersGateway: widget.customersGateway,
                      ),
                    ),
                    canCancelSale: _canCancelSale,
                    onCancelSale: () => unawaited(_handleCancelSale()),
                    cobrarButtonKey: _cobrarButtonKey,
                    visualTileOnly: widget.visualTileOnly,
                    onQuickSwitch: () => unawaited(
                      showDialog<void>(
                        context: context,
                        builder: (dialogContext) =>
                            _StaffQuickSwitchDialog(authGateway: widget.authGateway),
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Compact read-only status strip. The canonical `#p-pos` screen carries no
/// page title or description — replicating that density means the shell's
/// own read-only disclosure has to fit in a single slim row instead of the
/// admin-page `_SectionHeader` treatment used by Dashboard/Products/etc.
class _PosReadOnlyBar extends StatelessWidget {
  const _PosReadOnlyBar();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Row(
      children: [
        Icon(Icons.visibility_outlined, size: 15, color: palette.textMuted),
        const SizedBox(width: 6),
        Text(
          'Punto de Venta · solo lectura',
          style: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w700,
            fontSize: 12,
          ),
        ),
        const Spacer(),
        const _VisualDialogButton(),
      ],
    );
  }
}

class _PosSaleBody extends StatelessWidget {
  const _PosSaleBody({
    required this.controller,
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    required this.promotionsGateway,
    required this.customersGateway,
    required this.rewardsGateway,
    required this.heldSalesGateway,
    required this.branchId,
    required this.permissions,
    required this.selectedCategoryId,
    required this.onSelectCategory,
    required this.query,
    required this.onQueryChanged,
    required this.searchFocusNode,
    required this.searchController,
    required this.onSearchSubmitted,
    required this.searchBusy,
    required this.onSuspend,
    required this.suspendBusy,
    required this.onEnterCliente,
    // TASK 14.5 (Wave 3, Phase 4a): F3/F6/F8 cashier keyboard shortcuts —
    // see `_PosSaleState.build`'s `Focus.onKeyEvent`. All three trigger
    // the EXACT same code path as their on-screen button counterparts.
    required this.onOpenCustomerSelector,
    required this.canCancelSale,
    required this.onCancelSale,
    this.cobrarButtonKey,
    // TASK 14.5 (Wave 3, Phase 6): `PosModule.cafeteria` ("Acceso
    // rápido") passes `true` — see `_CategoryStrip.visualTileOnly`.
    this.visualTileOnly = false,
    // TASK 14.5 (Wave 3, Phase 4b/7 Item 8): "Cambiar cajero" — opens
    // `_StaffQuickSwitchDialog` (real PIN/QR verification).
    required this.onQuickSwitch,
  });

  final PosReadController controller;
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
  final PosPromotionsGateway promotionsGateway;
  final PosCustomersGateway customersGateway;
  final PosRewardsGateway rewardsGateway;
  // TASK 14.3 Wave 1 Part B.1: threaded only so `_TicketPanel` can pass it
  // to a future held-carts affordance if needed — the real suspend call
  // itself is owned by `_PosSaleState._handleSuspend`.
  final PosHeldSalesGateway heldSalesGateway;
  final String? branchId;
  final List<String> permissions;
  final String? selectedCategoryId;
  final ValueChanged<String?> onSelectCategory;
  final String query;
  final ValueChanged<String> onQueryChanged;
  final FocusNode searchFocusNode;
  final TextEditingController searchController;
  final ValueChanged<String> onSearchSubmitted;
  final bool searchBusy;
  final VoidCallback onSuspend;
  final bool suspendBusy;
  final VoidCallback onEnterCliente;
  final VoidCallback onOpenCustomerSelector;
  final bool canCancelSale;
  final VoidCallback onCancelSale;
  final GlobalKey<_PosCobrarButtonState>? cobrarButtonKey;
  final bool visualTileOnly;
  final VoidCallback onQuickSwitch;

  @override
  Widget build(BuildContext context) {
    // Matches the canonical stacking order: mode switch, search + action
    // row, category row — `.pos-left{gap:8px}`. TASK 12.3B: this whole
    // toolbar (and everything below it) only ever renders in CAJERO mode
    // now — CLIENTE is a fully separate locked surface (see
    // `_ClienteLockedShell`), not a swapped-in panel inside this tree, so
    // there is no `clienteMode` branch left to carry here.
    final toolbar = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: _PosModeSwitch(onEnterCliente: onEnterCliente)),
            const SizedBox(width: 8),
            // TASK 14.5 (Wave 3, Phase 4b/7 Item 8): "Cambiar cajero" —
            // real PIN/QR quick-switch verification, gated only by the
            // terminal already holding an authenticated session (see
            // `pos_auth_gateway.dart`'s own security-model doc comment).
            Tooltip(
              message: 'Cambiar cajero (PIN/QR)',
              child: IconButton(
                key: const Key('pos-quick-switch-button'),
                onPressed: onQuickSwitch,
                icon: const Icon(Icons.badge_outlined),
                style: IconButton.styleFrom(
                  minimumSize: const Size.square(40),
                  side: BorderSide(color: PosPalette.of(context).border),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        _PosSearchRow(
          focusNode: searchFocusNode,
          controller: searchController,
          onChanged: onQueryChanged,
          onSubmitted: onSearchSubmitted,
          busy: searchBusy,
          onSuspend: onSuspend,
          suspendBusy: suspendBusy,
          onOpenCustomerSelector: onOpenCustomerSelector,
          canCancelSale: canCancelSale,
          onCancelSale: onCancelSale,
        ),
        const SizedBox(height: 8),
        _CategoryStrip(
          state: controller.categories,
          selected: selectedCategoryId,
          onSelected: onSelectCategory,
          visualTileOnly: visualTileOnly,
        ),
      ],
    );
    // The canonical `.prod-grid` scrolls on its own inside a fixed-height
    // workspace; it is not part of an outer page scroll.
    final catalog = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        toolbar,
        const SizedBox(height: 10),
        Expanded(
          child: _ReadState<PosProduct>(
            state: controller.products,
            emptyMessage: 'No hay productos disponibles.',
            onRetry: () => controller.loadProducts(refresh: true),
            ready: (items) => _PosProductGrid(
              items: _filter(
                items,
                selectedCategoryId,
                query,
                // TASK 14.5 (Wave 3, Phase 6): "Acceso rápido" restricts
                // "Todas" itself to only visual-tile categories' own
                // products, exactly like the legacy's own `posSeccion===
                // 'cafeteria'` scoping (never leaking the rest of the
                // catalog into this section, and never touching Punto de
                // Venta's own "Todas" — that keeps meaning literally
                // every product, unrestricted).
                visualTileOnly
                    ? controller.categories.items
                          .where((category) => category.visualTile)
                          .map((category) => category.id)
                          .toSet()
                    : null,
              ),
              balances: controller.balances.items,
              saleSession: saleSession,
            ),
          ),
        ),
      ],
    );
    final ticketSurface = _TicketPanel(
      saleSession: saleSession,
      salesGateway: salesGateway,
      paymentsGateway: paymentsGateway,
      cashGateway: cashGateway,
      promotionsGateway: promotionsGateway,
      customersGateway: customersGateway,
      rewardsGateway: rewardsGateway,
      heldSalesGateway: heldSalesGateway,
      branchId: branchId,
      permissions: permissions,
      cobrarButtonKey: cobrarButtonKey,
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 900;
        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: catalog),
              const SizedBox(width: 14),
              SizedBox(width: 400, child: ticketSurface),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: catalog),
            const SizedBox(height: 14),
            _TicketBar(saleSession: saleSession, ticketSurface: ticketSurface),
          ],
        );
      },
    );
  }

  static List<PosProduct> _filter(
    List<PosProduct> items,
    String? categoryId,
    String query, [
    // TASK 14.5 (Wave 3, Phase 6): non-null only for "Acceso rápido"
    // (`PosModule.cafeteria`) — restricts the unfiltered ("Todas") view
    // to just these categories' own products; `null` (regular Punto de
    // Venta) keeps "Todas" meaning literally every product, unchanged.
    Set<String>? restrictToCategoryIds,
  ]) {
    final normalized = query.trim().toLowerCase();
    return items
        .where((item) {
          final matchesCategory =
              categoryId == null || item.categoryId == categoryId;
          final matchesScope =
              categoryId != null ||
              restrictToCategoryIds == null ||
              restrictToCategoryIds.contains(item.categoryId);
          final matchesQuery =
              normalized.isEmpty ||
              '${item.code} ${item.name}'.toLowerCase().contains(normalized);
          return matchesCategory && matchesScope && matchesQuery;
        })
        .toList(growable: false);
  }
}

/// Matches `.pos-mode-switch`: a CAJERO/CLIENTE toggle. TASK 12.3B: this
/// toolbar only ever renders while CAJERO is active (CLIENTE is now a
/// fully separate locked surface — see `_ClienteLockedShell`), so CAJERO
/// is always the active side here; tapping CLIENTE hands off to
/// `_PosShellState._enterClienteMode`, which swaps the *entire* shell.
/// Matches V1 exactly: in CAJERO mode both `#posmodo-cajero` (active,
/// gradient) and `#posmodo-cliente` (inactive, bordered) render side by
/// side — `#posmodo-cliente` only hides once `body.modo-cliente` is
/// applied, i.e. after the swap already happened.
class _PosModeSwitch extends StatelessWidget {
  const _PosModeSwitch({required this.onEnterCliente});
  final VoidCallback onEnterCliente;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _ModeButton(
            modeKey: const Key('pos-mode-cajero'),
            active: true,
            icon: Icons.shield_outlined,
            label: 'CAJERO',
            // Already active — matches V1's own no-op when the current
            // mode's button is pressed again.
            onTap: () {},
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ModeButton(
            modeKey: const Key('pos-mode-cliente'),
            active: false,
            icon: Icons.person_outline,
            label: 'CLIENTE',
            onTap: onEnterCliente,
          ),
        ),
      ],
    );
  }
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({
    required this.modeKey,
    required this.active,
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final Key modeKey;
  final bool active;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return InkWell(
      key: modeKey,
      onTap: onTap,
      borderRadius: BorderRadius.circular(9),
      child: Container(
        height: 36,
        decoration: BoxDecoration(
          gradient: active
              ? LinearGradient(colors: [palette.action, palette.blue])
              : null,
          border: active ? null : Border.all(color: palette.border),
          borderRadius: BorderRadius.circular(9),
        ),
        child: Center(
          child: _PosModeLabel(
            icon: icon,
            label: label,
            color: active ? Colors.white : palette.textSecondary,
          ),
        ),
      ),
    );
  }
}

/// TASK 12.3A: the canonical CLIENTE→CAJERO gate. V1's own
/// `cambiarModoPOS('cajero')` unconditionally calls
/// `requiereEmpleado('PIN o contraseña para volver a modo Cajero:', ...)`,
/// which prompts for a PIN/password and validates it via
/// `confirmarPinEmpleado()` — a plain-text comparison against
/// `DB.usuarios` held entirely client-side in the browser. That is
/// exactly the insecure local-credential pattern this task explicitly
/// forbids recreating.
///
/// No real backend contract for this exists today (confirmed by
/// inspection: no PIN column/table anywhere in `packages/database`, no
/// elevation/step-up endpoint in `apps/api`, no "confirm current
/// password without replacing the session" call — every credentialed
/// endpoint mints a brand-new session, which would be a disproportionate
/// and unsafe side effect of a wrong guess here). So this dialog keeps
/// V1's canonical PIN-entry visual (title, message, masked input, that
/// input is intentionally not compared to anything — this app must never
/// store or compare a PIN client-side) and authorizes by re-affirming a
/// permission the *already-authenticated* session's real, backend-issued
/// permission list already carries: `sale.create`. That is not a new
/// credential check — it's the same honest "$0.00, not fabricated"
/// posture used everywhere else in this arc, applied to authorization
/// instead of pricing. A real PIN/step-up contract is a deferred backend
/// task — see docs/AS_POS_SALE_ENGINE.md.
///
/// TASK 12.3B polish: adds the canonical AS logo mark, a fade+scale
/// entrance (a `ScaleTransition` layered on top of `showDialog`'s own
/// default Material fade, driven by the same route `animation` — no new
/// custom route needed), Escape-to-cancel, and a visual numeric keypad
/// (`StartupPinKeypad`, the same component the login PIN tab already
/// uses) — V1's `#empleado-pin-input` is `type="password"`, so its global
/// on-screen keyboard (`#teclado-global-dock`) appears beside it in the
/// canonical HTML; this reproduces that keypad's *presence*, not a real
/// PIN comparison (the field is still never compared to anything — see
/// above). The previous in-dialog "requires a backend contract" caption
/// has been removed from this customer/staff-facing surface per this
/// task's "no developer/backend-contract text in production UI" rule —
/// the same explanation now lives only in this doc comment and in
/// docs/AS_POS_SALE_ENGINE.md.
class _CajeroReturnAuthDialog extends StatefulWidget {
  const _CajeroReturnAuthDialog({required this.permissions});
  final List<String> permissions;

  @override
  State<_CajeroReturnAuthDialog> createState() =>
      _CajeroReturnAuthDialogState();
}

class _CajeroReturnAuthDialogState extends State<_CajeroReturnAuthDialog> {
  final pinController = TextEditingController();
  String? error;

  @override
  void dispose() {
    pinController.dispose();
    super.dispose();
  }

  void _confirm() {
    final authorized = widget.permissions.contains('sale.create');
    if (!authorized) {
      setState(() => error = 'No tienes permiso para volver a modo Cajero.');
      return;
    }
    Navigator.of(context).pop(true);
  }

  void _appendDigit(String digit) {
    setState(() {
      pinController.text += digit;
      error = null;
    });
  }

  void _backspace() {
    if (pinController.text.isEmpty) return;
    setState(() {
      pinController.text = pinController.text.substring(
        0,
        pinController.text.length - 1,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final dialog = AlertDialog(
      key: const Key('pos-cajero-return-dialog'),
      title: const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          StartupLogoMark(size: 40, shadow: false),
          SizedBox(height: 10),
          Text('Volver a modo Cajero', textAlign: TextAlign.center),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Ingresa tu PIN o contraseña de empleado.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('pos-cajero-return-input'),
            controller: pinController,
            obscureText: true,
            autofocus: true,
            textAlign: TextAlign.center,
            decoration: const InputDecoration(
              isDense: true,
              hintText: 'PIN o contraseña',
            ),
            onSubmitted: (_) => _confirm(),
          ),
          const SizedBox(height: 14),
          // `AlertDialog` sizes its content by asking it for intrinsic
          // width *and* height; `StartupPinKeypad`'s `GridView.count(
          // shrinkWrap: true)` uses a `RenderShrinkWrappingViewport`,
          // which explicitly does not support intrinsic-dimension
          // queries on either axis. A `SizedBox` with *both* dimensions
          // pinned to exact values answers intrinsic queries from its own
          // tight constraints without ever asking its child — the
          // standard fix for this well-known Flutter/Material
          // combination (a `ConstrainedBox(maxWidth: ...)`, which is what
          // `StartupPinKeypad` uses internally, is not tight enough on
          // its own).
          Center(
            child: SizedBox(
              width: 220,
              height: 220,
              child: StartupPinKeypad(
                onDigit: _appendDigit,
                onBackspace: _backspace,
                onOk: _confirm,
              ),
            ),
          ),
          if (error != null) ...[
            const SizedBox(height: 10),
            Text(
              error!,
              key: const Key('pos-cajero-return-error'),
              textAlign: TextAlign.center,
              style: TextStyle(color: palette.error, fontSize: 12),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          key: const Key('pos-cajero-return-cancel'),
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          key: const Key('pos-cajero-return-confirm'),
          onPressed: _confirm,
          child: const Text('Confirmar'),
        ),
      ],
    );
    final routeAnimation = ModalRoute.of(context)?.animation;
    final entrance = routeAnimation == null
        ? dialog
        : ScaleTransition(
            scale: CurvedAnimation(
              parent: routeAnimation,
              curve: Curves.easeOut,
            ).drive(Tween(begin: .92, end: 1)),
            child: dialog,
          );
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.escape): () =>
            Navigator.of(context).pop(false),
      },
      child: entrance,
    );
  }
}

class _PosModeLabel extends StatelessWidget {
  const _PosModeLabel({
    required this.icon,
    required this.label,
    required this.color,
  });
  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 15, color: color),
      const SizedBox(width: 6),
      Text(
        label,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w800,
          fontSize: 12,
          letterSpacing: .3,
        ),
      ),
    ],
  );
}

/// TASK 14.5 (Wave 3, Phase 4b/7 Item 8): "Cambiar cajero" — a real PIN or
/// QR quick-switch verification, calling `PosAuthGateway.pinLogin`/
/// `qrLogin` (see that file's own security-model doc comment: both
/// require this terminal's OWN already-authenticated session, resolve
/// company scope only from it, and mint a real backend session on
/// success — this dialog never adopts that new session as the app's own
/// active one, a deliberately-scoped-out follow-up documented in
/// `pos_auth_gateway.dart`). Mirrors `_CajeroReturnAuthDialog`'s own
/// canonical PIN-entry chrome (logo, `StartupPinKeypad`, Escape-to-
/// cancel) and adds a second tab for the QR code, matching the legacy
/// login modal's own PIN/QR tab pair (`docs/LEGACY_FUNCTIONAL_PARITY.md`
/// §20) — never the legacy's own plaintext/master-bypass mechanism.
class _StaffQuickSwitchDialog extends StatefulWidget {
  const _StaffQuickSwitchDialog({required this.authGateway});
  final PosAuthGateway authGateway;

  @override
  State<_StaffQuickSwitchDialog> createState() => _StaffQuickSwitchDialogState();
}

class _StaffQuickSwitchDialogState extends State<_StaffQuickSwitchDialog> {
  bool _pinTab = true;
  final _pinController = TextEditingController();
  final _qrController = TextEditingController();
  bool _busy = false;
  String? _error;
  bool _verified = false;

  @override
  void dispose() {
    _pinController.dispose();
    _qrController.dispose();
    super.dispose();
  }

  Future<void> _submitPin() async {
    if (_pinController.text.isEmpty || _busy) return;
    await _submit(() => widget.authGateway.pinLogin(_pinController.text));
  }

  Future<void> _submitQr(String code) async {
    if (code.trim().isEmpty || _busy) return;
    await _submit(() => widget.authGateway.qrLogin(code.trim()));
  }

  Future<void> _submit(Future<void> Function() call) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await call();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _verified = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        // Honest, generic failure — no hint about which part was wrong,
        // mirroring `AuthService.pinLogin`/`qrLogin`'s own uniform
        // `invalid_credentials` error.
        _error = error.failure.message;
        _pinController.clear();
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible verificar el PIN o código QR.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.escape): () => Navigator.of(context).pop(),
      },
      child: AlertDialog(
        key: const Key('pos-quick-switch-dialog'),
        title: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            StartupLogoMark(size: 40, shadow: false),
            SizedBox(height: 10),
            Text('Cambiar cajero', textAlign: TextAlign.center),
          ],
        ),
        content: SizedBox(
          width: 300,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_verified) ...[
                Icon(Icons.verified_outlined, color: palette.success, size: 40),
                const SizedBox(height: 10),
                const Text(
                  'PIN/QR verificado por el servidor.',
                  key: Key('pos-quick-switch-verified'),
                  textAlign: TextAlign.center,
                ),
              ] else ...[
                Row(
                  children: [
                    Expanded(
                      child: _QuickSwitchTabButton(
                        label: 'PIN',
                        active: _pinTab,
                        onTap: () => setState(() {
                          _pinTab = true;
                          _error = null;
                        }),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _QuickSwitchTabButton(
                        label: 'Código QR',
                        active: !_pinTab,
                        onTap: () => setState(() {
                          _pinTab = false;
                          _error = null;
                        }),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                if (_pinTab) ...[
                  Text(
                    _pinController.text.replaceAll(RegExp('.'), '•').padRight(4, '_'),
                    style: const TextStyle(fontSize: 22, letterSpacing: 6),
                  ),
                  const SizedBox(height: 10),
                  StartupPinKeypad(
                    onDigit: (digit) => setState(() => _pinController.text += digit),
                    onBackspace: () => setState(
                      () => _pinController.text = _pinController.text.isEmpty
                          ? ''
                          : _pinController.text.substring(0, _pinController.text.length - 1),
                    ),
                    onOk: () => unawaited(_submitPin()),
                  ),
                ] else
                  TextField(
                    key: const Key('pos-quick-switch-qr-input'),
                    controller: _qrController,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'Escanea o escribe el código QR...',
                    ),
                    onSubmitted: (value) => unawaited(_submitQr(value)),
                  ),
                if (_busy) ...[
                  const SizedBox(height: 12),
                  const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-quick-switch-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            key: const Key('pos-quick-switch-close'),
            onPressed: () => Navigator.of(context).pop(),
            child: Text(_verified ? 'Cerrar' : 'Cancelar'),
          ),
        ],
      ),
    );
  }
}

class _QuickSwitchTabButton extends StatelessWidget {
  const _QuickSwitchTabButton({
    required this.label,
    required this.active,
    required this.onTap,
  });
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        backgroundColor: active ? palette.action : null,
        foregroundColor: active ? Colors.white : palette.textSecondary,
      ),
      child: Text(label),
    );
  }
}

/// Matches `#pos-toolbar-row`: the search input (with a barcode-scan
/// affordance) plus four circular actions (link customer, reprint,
/// suspend, cancel). TASK 14.5 (Wave 3, Phase 4a): "Vincular cliente
/// (F3)"/"Suspender venta (F5)"/"Cancelar venta (F6)" are now real,
/// mirroring the same keyboard shortcuts wired in `_PosSaleState`.
/// "Reimprimir ticket (F4)" stays a placeholder on THIS screen
/// deliberately — see its own `onPressed` doc comment below for why.
class _PosSearchRow extends StatelessWidget {
  const _PosSearchRow({
    required this.focusNode,
    required this.controller,
    required this.onChanged,
    required this.onSubmitted,
    required this.busy,
    required this.onSuspend,
    required this.suspendBusy,
    required this.onOpenCustomerSelector,
    required this.canCancelSale,
    required this.onCancelSale,
  });
  final FocusNode focusNode;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  // TASK 14.3 (Wave 1, Part B.2): Enter/scanner-submit — tries an exact
  // barcode lookup first (see `_PosSaleState._handleSearchSubmit`).
  final ValueChanged<String> onSubmitted;
  final bool busy;
  // TASK 14.3 (Wave 1, Part B.1): "Suspender venta" (F5) — now a real,
  // server-persisted suspend instead of the legacy read-only stub.
  final VoidCallback onSuspend;
  final bool suspendBusy;
  // TASK 14.5 (Wave 3, Phase 4a): "Vincular cliente" (F3) — calls the
  // exact same `openCustomerSelector` the ticket footer's own "Buscar
  // cliente" row calls.
  final VoidCallback onOpenCustomerSelector;
  // TASK 14.5 (Wave 3, Phase 4a): "Cancelar venta" (F6) — gated on
  // `sale.cancel`, mirroring the legacy's own `cancelarVentas` gate and
  // this codebase's existing `sale.cancel` precedent (`_HeldSales`'s
  // `_canDiscard`). Hidden-as-disabled rather than shown-then-403,
  // matching that same established pattern.
  final bool canCancelSale;
  final VoidCallback onCancelSale;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Row(
      children: [
        Expanded(
          child: TextField(
            key: const Key('pos-sale-search'),
            focusNode: focusNode,
            controller: controller,
            onChanged: onChanged,
            onSubmitted: onSubmitted,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Escanear código o buscar por nombre... (F2)',
              prefixIcon: busy
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : const Icon(Icons.search),
              suffixIcon: Icon(
                Icons.qr_code_scanner_outlined,
                size: 18,
                color: palette.textMuted,
              ),
            ),
          ),
        ),
        const SizedBox(width: 6),
        _RoundAction(
          key: const Key('pos-ticket-link-customer'),
          tooltip: 'Vincular cliente (F3)',
          icon: Icons.person_outline,
          onPressed: onOpenCustomerSelector,
        ),
        const SizedBox(width: 6),
        _RoundAction(
          tooltip: 'Reimprimir ticket (F4)',
          icon: Icons.print_outlined,
          // TASK 14.5 (Wave 3, Phase 4a): deliberately NOT wired to a real
          // reprint here, and F4 is deliberately NOT bound as a keyboard
          // shortcut on this screen. In the legacy, F4 opened a picker of
          // PAST tickets to reprint — this in-progress POS screen has no
          // completed sale of its own yet to reprint (there is nothing to
          // print until Cobrar succeeds). The real, working reprint action
          // already exists post-completion, in Sale Detail (Historial de
          // ventas → seleccionar venta → Reimprimir) — see
          // `_SaleDetailDialogState._print()`. This button stays a honest
          // pointer to that real location instead of a fake no-op.
          onPressed: () => _showNotice(
            context,
            'Para reimprimir un ticket ya cobrado, ve a Historial de ventas y abre su detalle.',
          ),
        ),
        const SizedBox(width: 6),
        _RoundAction(
          key: const Key('pos-ticket-suspend'),
          tooltip: 'Suspender venta (F5)',
          icon: Icons.pause_circle_outline,
          color: palette.warning,
          busy: suspendBusy,
          onPressed: suspendBusy ? null : onSuspend,
        ),
        const SizedBox(width: 6),
        _RoundAction(
          key: const Key('pos-ticket-cancel'),
          tooltip: 'Cancelar venta (F6)',
          icon: Icons.close,
          color: palette.error,
          onPressed: canCancelSale ? onCancelSale : null,
        ),
      ],
    );
  }
}

class _CategoryStrip extends StatelessWidget {
  const _CategoryStrip({
    required this.state,
    required this.selected,
    required this.onSelected,
    // TASK 14.5 (Wave 3, Phase 6): `PosModule.cafeteria` ("Acceso
    // rápido") passes `true` — the strip (and the "Todas" chip's own
    // scope) is restricted to only the categories a company opted into
    // `visualTile`. Regular Punto de Venta passes `false` (the default):
    // every active category shows, exactly as before this phase.
    this.visualTileOnly = false,
  });
  final PosReadState<PosCategory> state;
  final String? selected;
  final ValueChanged<String?> onSelected;
  final bool visualTileOnly;

  @override
  Widget build(BuildContext context) {
    final active = state.items
        .where(
          (category) =>
              category.status == 'active' && (!visualTileOnly || category.visualTile),
        )
        .toList(growable: false);
    if (visualTileOnly && active.isEmpty) {
      // Honest empty state — never a fabricated demo category. Mirrors
      // this codebase's own established convention (e.g. CLIENTE's
      // per-category empty state) rather than silently rendering nothing.
      return const Padding(
        key: Key('pos-cafeteria-empty'),
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Text(
          'Ninguna categoría está configurada como acceso rápido todavía.',
          style: TextStyle(fontSize: 12),
        ),
      );
    }
    return SizedBox(
      key: const Key('pos-category-strip'),
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: _CategoryChip(
              key: const Key('pos-category-all'),
              icon: Icons.grid_view_outlined,
              label: 'Todas',
              selected: selected == null,
              onSelected: () => onSelected(null),
            ),
          ),
          for (final category in active)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: _CategoryChip(
                key: Key('pos-category-${category.id}'),
                // The canonical `.cat` button carries a per-category icon
                // from `DB.categoriasPOS[].icon`; the real categories
                // endpoint has no icon field, so a uniform icon is used
                // rather than inventing a per-category mapping.
                icon: Icons.category_outlined,
                label: category.name,
                selected: selected == category.id,
                onSelected: () => onSelected(category.id),
                visualTile: category.visualTile,
              ),
            ),
        ],
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onSelected,
    // TASK 14.5 (Wave 3, Phase 6): a real, generic "visual/compact tile"
    // treatment — recovered from the legacy's own `estiloCafe` category
    // flag (forensically confirmed purely visual — see
    // `docs/LEGACY_FUNCTIONAL_PARITY.md` §1). Never hardcoded to coffee:
    // any company's own category (`PosCategory.visualTile`) renders this
    // way, wherever its chip appears — inside the dedicated "Acceso
    // rápido" section (`PosModule.cafeteria`) or in the regular Punto de
    // Venta strip.
    this.visualTile = false,
    super.key,
  });
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onSelected;
  final bool visualTile;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // The canonical `.cat` chip is always blue-tinted — border, fill, and
    // label — not neutral until selected; only the fill solidifies on
    // selection (`.cat.active{background:var(--blue)}`). A `visualTile`
    // category stays visually distinct even unselected — filled, bolder
    // border, a larger icon — mirroring the legacy's own always-on
    // (not selection-dependent) café-section styling.
    final filled = selected || visualTile;
    return ChoiceChip(
      key: visualTile ? Key('pos-category-chip-visual-${label.hashCode}') : null,
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: visualTile ? 18 : 14,
            color: filled ? Colors.white : palette.blueDeep,
          ),
          const SizedBox(width: 5),
          Text(label),
        ],
      ),
      selected: selected,
      onSelected: (_) => onSelected(),
      showCheckmark: false,
      labelStyle: TextStyle(
        color: filled ? Colors.white : palette.blueDeep,
        fontWeight: FontWeight.w700,
        fontSize: visualTile ? 13 : 12,
      ),
      backgroundColor: visualTile ? palette.blue : palette.blueTint,
      selectedColor: palette.blue,
      side: BorderSide(color: palette.blue, width: visualTile ? 2 : 1),
      padding: EdgeInsets.symmetric(horizontal: visualTile ? 10 : 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    );
  }
}

class _PosProductGrid extends StatelessWidget {
  const _PosProductGrid({
    required this.items,
    required this.balances,
    required this.saleSession,
  });
  final List<PosProduct> items;
  final List<PosInventoryBalance> balances;
  final SaleSession saleSession;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const _EmptyState(message: 'Sin productos en esta categoría.');
    }
    // Matches the canonical `.prod-grid{grid-template-columns:repeat(
    // auto-fill,minmax(120px,1fr))}` (100px under the 900px reference
    // breakpoint) — fluid tiling rather than fixed column steps.
    return LayoutBuilder(
      builder: (context, constraints) {
        final tileWidth = constraints.maxWidth >= 900 ? 120.0 : 100.0;
        return GridView.builder(
          gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: tileWidth,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            // TASK 12.3C: +12 over the canonical 160 to fit the new real
            // price caption without cramming the existing name/code lines.
            mainAxisExtent: 172,
          ),
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            // TASK 12.3C: one shared function (`posAddabilityBlock`) now
            // decides whether a tap adds the product — out of stock,
            // missing price, malformed price, and an unrateable tax code
            // all block the same way CAJERO and CLIENTE agree on.
            final block = posAddabilityBlock(item, balances);
            return _PosProductCard(
              item: item,
              block: block,
              onTap: block != null
                  ? () => _showNotice(context, _addabilityMessage(block))
                  // TASK 14.3 (Wave 1, Part B.3): a weight-based (`kg`/
                  // `g`) product opens the weight-entry dialog instead of
                  // adding 1 unit directly.
                  : posIsWeightBased(item)
                  ? () => _openWeightDialogFor(context, item, balances, saleSession)
                  : () => saleSession.addProduct(item, balances),
            );
          },
        );
      },
    );
  }
}

/// Shared by [_PosProductGrid] and [_PosSaleState]'s own barcode-hit path
/// — opens [_WeightEntryDialog] for a weight-based product and, once the
/// cashier confirms a weight, adds the real fractional-quantity line via
/// [SaleSession.addWeightedProduct].
Future<void> _openWeightDialogFor(
  BuildContext context,
  PosProduct product,
  List<PosInventoryBalance> balances,
  SaleSession saleSession,
) async {
  final weight = await showDialog<String>(
    context: context,
    builder: (dialogContext) => _WeightEntryDialog(product: product),
  );
  if (weight == null) return;
  final added = saleSession.addWeightedProduct(product, weight, balances);
  if (!added && context.mounted) {
    _showNotice(context, 'No fue posible agregar el peso capturado.');
  }
}

/// Matches `PosProduct.defaultVariantId` against inventory balances. See
/// `pos_models.dart`'s `posIsOutOfStock`/`posAddabilityBlock`.
String _addabilityMessage(PosAddabilityBlock block) => switch (block) {
  PosAddabilityBlock.outOfStock => 'Producto sin existencia.',
  PosAddabilityBlock.missingPrice =>
    'Este producto aún no tiene un precio asignado.',
  PosAddabilityBlock.malformedPrice =>
    'El precio de este producto no es válido.',
};

/// TASK 14.3 (Wave 1, Part B.3): the weight-entry dialog for a `kg`/`g`
/// product — the cashier types a weight and live-sees
/// `weight × unit_price = line total`, computed via [Money.
/// multiplyByDecimalQuantity] (this codebase's real fixed-point money
/// utility — never raw `double` arithmetic). Confirming pops the exact
/// weight decimal string for the caller to hand to
/// [SaleSession.addWeightedProduct]; cancelling pops `null`.
class _WeightEntryDialog extends StatefulWidget {
  const _WeightEntryDialog({required this.product});
  final PosProduct product;

  @override
  State<_WeightEntryDialog> createState() => _WeightEntryDialogState();
}

class _WeightEntryDialogState extends State<_WeightEntryDialog> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Money? get _unitPrice => widget.product.pricing.amount;

  /// `null` for empty/malformed/non-positive input — never a fabricated
  /// fallback value.
  Money? get _lineTotal {
    final unitPrice = _unitPrice;
    final raw = _controller.text.trim();
    if (unitPrice == null || raw.isEmpty) return null;
    try {
      return unitPrice.multiplyByDecimalQuantity(raw);
    } on MoneyFormatException {
      return null;
    }
  }

  bool get _isPositiveWeight {
    final raw = _controller.text.trim();
    if (raw.isEmpty) return false;
    final parsed = double.tryParse(raw);
    return parsed != null && parsed > 0;
  }

  void _confirm() {
    final raw = _controller.text.trim();
    if (!_isPositiveWeight || _lineTotal == null) {
      setState(() => _error = 'Captura un peso válido, mayor a cero.');
      return;
    }
    Navigator.of(context).pop<String>(raw);
  }

  @override
  Widget build(BuildContext context) {
    final unit = widget.product.unitOfMeasureCode ?? 'unit';
    final total = _lineTotal;
    return AlertDialog(
      title: Text('Pesar — ${widget.product.name}'),
      content: SizedBox(
        width: 320,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Precio: ${_unitPrice == null ? '—' : _money(_unitPrice!)}/$unit'),
            const SizedBox(height: 12),
            TextField(
              key: const Key('pos-weight-input'),
              controller: _controller,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: 'Peso ($unit)',
                errorText: _error,
                suffixText: unit,
              ),
              onChanged: (_) => setState(() => _error = null),
              onSubmitted: (_) => _confirm(),
            ),
            const SizedBox(height: 12),
            Text(
              'Total de la línea: ${total == null ? '—' : _money(total)}',
              key: const Key('pos-weight-line-total'),
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop<String>(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          key: const Key('pos-weight-confirm'),
          onPressed: _confirm,
          child: const Text('Agregar'),
        ),
      ],
    );
  }
}

class _PosProductCard extends StatelessWidget {
  const _PosProductCard({
    required this.item,
    required this.block,
    required this.onTap,
  });
  final PosProduct item;
  // TASK 12.3C: `null` means addable; any other value is why it is not
  // (see `pos_models.dart`'s `posAddabilityBlock`) — out of stock keeps
  // its own dedicated visual treatment below, matching the canonical
  // reference; a missing/malformed price reuses the same red-caption
  // convention, since the canonical HTML has no equivalent state to match.
  final PosAddabilityBlock? block;
  // TASK 12.3: adds the product to the shared ticket (or, when it cannot
  // be sold, surfaces a notice instead) — see `_PosProductGrid`.
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final outOfStock = block == PosAddabilityBlock.outOfStock;
    final blocked = block != null;
    // Matches the canonical `.prod` card: radius 14, subtle shadow, a bare
    // accent-colored icon (no circular badge), and a compact name.
    // TASK 12.3C: the reference's own `.prod-precio` now has a real value
    // to show, so the previously-empty price line is filled in instead of
    // staying invented-blank.
    //
    // Out-of-stock: the reference's pulsing red "AGOTADO" badge is
    // client-mode only (`body.modo-cliente .prod-agotado-badge`); this
    // shell has no client-facing mode, so it follows the cajero-mode
    // convention instead — full opacity, a small red stock indicator. A
    // missing/malformed price is surfaced the same way, since there is no
    // canonical equivalent to match either.
    return Material(
      key: Key('pos-product-${item.id}'),
      color: palette.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 16, 10, 12),
          decoration: BoxDecoration(
            border: Border.all(color: palette.border, width: 1.5),
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: .04),
                blurRadius: 4,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          alignment: Alignment.center,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.inventory_2_outlined, size: 34, color: palette.action),
              const SizedBox(height: 7),
              Text(
                item.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: palette.text,
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                _priceCaption(item.pricing),
                style: TextStyle(
                  color: item.pricing.isSellable
                      ? palette.action
                      : palette.textMuted,
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                outOfStock ? 'Sin existencia' : item.code,
                style: TextStyle(
                  color: blocked ? palette.error : palette.textMuted,
                  fontWeight: blocked ? FontWeight.w700 : FontWeight.w400,
                  fontSize: 9,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The small price caption shown on every product tile — TASK 12.3C. A
/// missing or malformed price is spelled out honestly rather than shown
/// as `$0.00` or left blank, matching this codebase's "never invent a
/// fallback" rule.
String _priceCaption(PosPricing pricing) => switch (pricing.status) {
  PosPricingStatus.valid || PosPricingStatus.free => _money(pricing.amount!),
  PosPricingStatus.missing => 'Sin precio',
  PosPricingStatus.malformed => 'Precio inválido',
};

class _TicketPanel extends StatelessWidget {
  const _TicketPanel({
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    required this.promotionsGateway,
    required this.customersGateway,
    required this.rewardsGateway,
    this.heldSalesGateway = const EmptyPosHeldSalesGateway(),
    required this.branchId,
    required this.permissions,
    this.cobrarButtonKey,
  });
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
  // TASK 12.9: coupon/manual-discount quoting — see
  // `pos_promotions_gateway.dart` and ADR-0016.
  final PosPromotionsGateway promotionsGateway;
  // TASK 13.0: the CAJERO-only customer selector — see `_TicketFooter`.
  final PosCustomersGateway customersGateway;
  // TASK 13.1: the CAJERO-only reward lookup/redeem affordance — see
  // `_TicketFooter` and ADR-0018.
  final PosRewardsGateway rewardsGateway;
  // TASK 14.3 (Wave 1, Part B.1): the resumed-held-cart `link-sale`
  // handshake — see `_TicketFooter`/`_PosCobrarButton`.
  final PosHeldSalesGateway heldSalesGateway;
  final String? branchId;
  final List<String> permissions;
  final GlobalKey<_PosCobrarButtonState>? cobrarButtonKey;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // Matches the canonical `.ticket`: radius 14, subtle shadow, a solid
    // accent `.t-head` fill, and a column-header row (Producto/Unidades/
    // Total) beneath it. TASK 12.3: the body/footer now render the real,
    // reactive `saleSession` — a single `ListenableBuilder` scopes the
    // rebuild to just this panel (not the product grid/search beside it).
    return ListenableBuilder(
      listenable: saleSession,
      builder: (context, _) => Container(
        key: const Key('pos-ticket-panel'),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border.all(color: palette.border),
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: .06),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            // `.t-head`: the canonical CSS fills it with a solid `--purple`;
            // rendered here as the same blue→cyan gradient V1 already uses
            // on `.cobrar-btn`/`.ai-topbtn`, per explicit spec (TASK 12.2C).
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [palette.action, palette.blue],
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 26,
                    height: 26,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .22),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.description_outlined,
                      color: Colors.white,
                      size: 14,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Ticket #1',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  const Spacer(),
                  _TicketHeaderAction(
                    key: const Key('pos-ticket-note-button'),
                    tooltip: saleSession.note == null ? 'Nota de venta' : 'Nota de venta (agregada)',
                    icon: saleSession.note == null ? Icons.notes_outlined : Icons.speaker_notes,
                    onPressed: () async {
                      final result = await showDialog<String>(
                        context: context,
                        builder: (dialogContext) => _NoteDialog(initialNote: saleSession.note),
                      );
                      if (result != null) saleSession.setNote(result);
                    },
                  ),
                  _TicketHeaderAction(
                    tooltip: 'Limpiar ticket',
                    icon: Icons.delete_outline,
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              color: palette.action.withValues(alpha: .85),
              child: Row(
                children: [
                  _TicketColumnLabel('Producto', flex: 3),
                  _TicketColumnLabel('Unidades', flex: 2, center: true),
                  _TicketColumnLabel('Total', flex: 2, alignRight: true),
                ],
              ),
            ),
            Expanded(
              child: saleSession.isEmpty
                  ? const _TicketEmptyState()
                  : _TicketLineList(saleSession: saleSession),
            ),
            _TicketFooter(
              saleSession: saleSession,
              salesGateway: salesGateway,
              paymentsGateway: paymentsGateway,
              cashGateway: cashGateway,
              promotionsGateway: promotionsGateway,
              customersGateway: customersGateway,
              rewardsGateway: rewardsGateway,
              heldSalesGateway: heldSalesGateway,
              branchId: branchId,
              permissions: permissions,
              cobrarButtonKey: cobrarButtonKey,
            ),
          ],
        ),
      ),
    );
  }
}

/// TASK 12.3 addendum: CLIENTE's read-only ticket preview. Observes the
/// exact same `SaleSession` as `_TicketPanel` (never a copy, never reset
/// on mode switch) but never lets the customer edit it — no quantity
/// steppers, no remove buttons, no coupon/cash/payment-method controls,
/// no administrative or cashier actions (per the CLIENTE business rule:
/// card payment only, nothing else). The single payable action is a
/// card-payment button, itself still inert — real terminal integration is
/// TASK 12.4 — and the full customer-facing screen (QR, Rewards+,
/// promotions, advertising) is TASK 12.3B; see docs/AS_POS_SALE_ENGINE.md.
class _ClienteTicketPreview extends StatelessWidget {
  const _ClienteTicketPreview({
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.rewardsGateway,
    required this.branchId,
  });
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosRewardsGateway rewardsGateway;
  final String? branchId;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return ListenableBuilder(
      listenable: saleSession,
      builder: (context, _) => Container(
        key: const Key('pos-cliente-ticket-preview'),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border.all(color: palette.border),
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: .06),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [palette.action, palette.blue],
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 26,
                    height: 26,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .22),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.description_outlined,
                      color: Colors.white,
                      size: 14,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Ticket #1',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  // No "Nota de venta"/"Limpiar ticket" here — those are
                  // cashier-only actions the CLIENTE surface must never
                  // expose.
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              color: palette.action.withValues(alpha: .85),
              child: Row(
                children: [
                  _TicketColumnLabel('Producto', flex: 3),
                  _TicketColumnLabel('Unidades', flex: 2, center: true),
                  _TicketColumnLabel('Total', flex: 2, alignRight: true),
                ],
              ),
            ),
            Expanded(
              child: saleSession.isEmpty
                  ? const _TicketEmptyState()
                  : _ClienteTicketLineList(lines: saleSession.lines),
            ),
            _ClienteTicketFooter(
              saleSession: saleSession,
              salesGateway: salesGateway,
              paymentsGateway: paymentsGateway,
              rewardsGateway: rewardsGateway,
              branchId: branchId,
            ),
          ],
        ),
      ),
    );
  }
}

class _ClienteTicketLineList extends StatelessWidget {
  const _ClienteTicketLineList({required this.lines});
  final List<SaleLine> lines;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return ListView.separated(
      key: const Key('pos-cliente-ticket-lines'),
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: lines.length,
      separatorBuilder: (context, index) =>
          Divider(height: 1, color: palette.border),
      itemBuilder: (context, index) {
        final line = lines[index];
        return Padding(
          key: Key('pos-cliente-ticket-line-${line.productId}'),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  line.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: palette.text,
                  ),
                ),
              ),
              SizedBox(
                width: 40,
                child: Text(
                  '${line.quantity}',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: palette.textSecondary,
                  ),
                ),
              ),
              SizedBox(
                width: 58,
                child: Text(
                  _money(line.subtotal),
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                    color: palette.text,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Subtotal/IVA/Total (the same `saleSession` totals CAJERO sees — never
/// recomputed separately) plus the single, still-inert card-payment
/// action. No coupon, no cash-received field, no Efectivo/Tarjeta/
/// Transfer grid: CLIENTE is card-only and never exposes cashier controls.
class _ClienteTicketFooter extends StatelessWidget {
  const _ClienteTicketFooter({
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.rewardsGateway,
    required this.branchId,
  });
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosRewardsGateway rewardsGateway;
  final String? branchId;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: palette.background,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // TASK 13.0 (Part AH): read-only — the CURRENT sale's own
          // already-attached customer name, if any (set by the cashier at
          // the CAJERO ticket before handing off to CLIENTE). No search,
          // no directory, no other customer's data — CLIENTE never gains
          // any new privacy surface here.
          if (saleSession.customerDisplayName != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                key: const Key('pos-cliente-ticket-customer'),
                children: [
                  Icon(Icons.person_outline, size: 14, color: palette.textSecondary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      saleSession.customerDisplayName!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: palette.textSecondary, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          // TASK 13.1 (Part W): the attached customer's OWN reward status
          // — display-only, mirroring the read-only customer name above
          // exactly (same "CLIENTE never gains a new privacy/action
          // surface" rule). No redeem button here: an actual redemption
          // always goes through the cashier-gated CAJERO path (Part V) —
          // see `_ClienteRewardStatus`'s own doc comment.
          if (saleSession.customerId != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _ClienteRewardStatus(
                rewardsGateway: rewardsGateway,
                customerId: saleSession.customerId!,
              ),
            ),
          // TASK 13.2: display-only "reward applied to THIS transaction"
          // indicator — distinct from `_ClienteRewardStatus` above (which
          // only ever shows a generic available-count, never tied to the
          // in-progress sale). No admin action, no directory, no history:
          // the same CLIENTE restraint as everything else in this footer.
          if (saleSession.rewardEntitlementId != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _ClienteAppliedRewardBanner(quote: saleSession.quote),
            ),
          _TicketTotalRow(
            label: 'Subtotal',
            value: _money(saleSession.displaySubtotal),
          ),
          if (saleSession.displayDiscountTotal.isPositive)
            _TicketTotalRow(
              label: 'Descuento',
              value: '-${_money(saleSession.displayDiscountTotal)}',
            ),
          _TicketTotalRow(
            label: 'IVA incluido',
            value: _money(saleSession.displayTaxTotal),
            muted: true,
          ),
          _TicketTotalRow(
            label: 'Total',
            value: _money(saleSession.displayTotal),
            big: true,
          ),
          const SizedBox(height: 8),
          _ClienteCardPaymentButton(
            saleSession: saleSession,
            salesGateway: salesGateway,
            paymentsGateway: paymentsGateway,
            branchId: branchId,
          ),
        ],
      ),
    );
  }
}

/// TASK 13.1 (Part W): CLIENTE's OWN read-only reward status — the
/// customer already attached to the in-progress transaction, and never
/// anyone/anything else: no directory, no other customer's data, no full
/// historical ledger (Customer Detail's own history stays a staff-only
/// surface — see `_CustomerDetailDialog`), and no manual issue/revoke
/// control ever renders here. Deliberately renders NO button at all — a
/// customer may SEE that a reward is available, but actually redeeming it
/// always goes through the cashier-gated CAJERO path (`_TicketFooter`'s
/// "Recompensas disponibles" affordance, gated on `reward.redeem`), never
/// a self-service action from this locked surface. A failed/empty lookup
/// renders nothing, matching this same file's "no empty-state clutter
/// outside Customer Detail" rule for the CAJERO reward affordance above.
class _ClienteRewardStatus extends StatefulWidget {
  const _ClienteRewardStatus({required this.rewardsGateway, required this.customerId});
  final PosRewardsGateway rewardsGateway;
  final String customerId;

  @override
  State<_ClienteRewardStatus> createState() => _ClienteRewardStatusState();
}

class _ClienteRewardStatusState extends State<_ClienteRewardStatus> {
  List<PosRewardEntitlement> _entitlements = const [];

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant _ClienteRewardStatus oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.customerId != oldWidget.customerId) unawaited(_load());
  }

  Future<void> _load() async {
    final customerId = widget.customerId;
    try {
      final entitlements = await widget.rewardsGateway.entitlementsForCustomer(customerId);
      if (!mounted || widget.customerId != customerId) return;
      setState(() => _entitlements = entitlements);
    } on Object {
      if (!mounted) return;
      setState(() => _entitlements = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    final available = _entitlements.where((entitlement) => entitlement.isAvailable).length;
    if (available == 0) return const SizedBox.shrink();
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-cliente-ticket-reward-status'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.success.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        children: [
          Icon(Icons.card_giftcard_outlined, size: 14, color: palette.success),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              available == 1 ? 'Tienes 1 recompensa disponible.' : 'Tienes $available recompensas disponibles.',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: palette.success, fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// TASK 13.2: CLIENTE's OWN read-only "reward applied to THIS sale"
/// indicator — distinct from [_ClienteRewardStatus] above (a generic
/// available-entitlements count that never reflects whether anything was
/// actually attached to the in-progress transaction). Renders only once
/// `SaleSession.rewardEntitlementId` is set AND a fresh quote confirms the
/// `'reward'`-sourced [PosAppliedDiscount] (never a fabricated amount
/// while a re-quote is still in flight) — the exact same "backend-derived,
/// display-only, no admin action" contract every other CLIENTE surface in
/// this file follows. The label reads the quote's own `'Recompensa'`,
/// never a hardcoded business name like "VIP Pass".
class _ClienteAppliedRewardBanner extends StatelessWidget {
  const _ClienteAppliedRewardBanner({required this.quote});
  final PosPricingQuote? quote;

  @override
  Widget build(BuildContext context) {
    final quote = this.quote;
    if (quote == null) {
      return const SizedBox.shrink();
    }
    final applied = quote.appliedRewards;
    if (applied.isEmpty) return const SizedBox.shrink();
    var total = Money.zero(quote.currencyCode);
    for (final entry in applied) {
      try {
        total = total + Money.parse(entry.amount, quote.currencyCode);
      } on MoneyFormatException {
        // A malformed single entry never blocks the whole banner.
      }
    }
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-cliente-applied-reward-banner'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.success.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        children: [
          Icon(Icons.card_giftcard, size: 14, color: palette.success),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              total.isPositive ? 'Recompensa aplicada — -${_money(total)}' : 'Recompensa aplicada',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: palette.success, fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// The one payable action CLIENTE mode shows — card payment only. TASK
/// 12.4A.1 wires it exactly like Cobrar: it creates a real, backend-priced
/// sale, honestly, then stops — real integrated-terminal processing is
/// still TASK 12.4B (see docs/AS_POS_SALE_ENGINE.md), which must start
/// from provider/device discovery and contract design, not from this
/// button. No approved payment is simulated and no provider transaction id
/// is fabricated here.
class _ClienteCardPaymentButton extends StatefulWidget {
  const _ClienteCardPaymentButton({
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.branchId,
  });
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final String? branchId;

  @override
  State<_ClienteCardPaymentButton> createState() =>
      _ClienteCardPaymentButtonState();
}

class _ClienteCardPaymentButtonState extends State<_ClienteCardPaymentButton> {
  bool _busy = false;
  String? _statusMessage;

  Future<void> _handleTap() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _statusMessage = null;
    });
    await _submitSaleForPayment(
      context,
      saleSession: widget.saleSession,
      salesGateway: widget.salesGateway,
      paymentsGateway: widget.paymentsGateway,
      branchId: widget.branchId,
      onStatusUpdate: (message) {
        if (mounted) setState(() => _statusMessage = message);
      },
    );
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [palette.action, palette.blue]),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          key: const Key('pos-cliente-card-payment'),
          borderRadius: BorderRadius.circular(12),
          onTap: _busy ? null : _handleTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (_busy)
                  const SizedBox(
                    width: 17,
                    height: 17,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                else
                  const Icon(
                    Icons.credit_card_outlined,
                    color: Colors.white,
                    size: 17,
                  ),
                const SizedBox(width: 8),
                // `Flexible` + `FittedBox` — same overflow-proofing
                // pattern used throughout this file (e.g. the sidebar's
                // "Modo oscuro" row): this label is longer than Cobrar's,
                // so it scales down slightly instead of overflowing at
                // the panel's narrower widths rather than a hard error.
                Flexible(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      _statusMessage ??
                          'Pagar con tarjeta — ${_money(widget.saleSession.displayTotal)}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// TASK 12.3B: the full canonical CLIENTE (self-service) surface.
///
/// Matches V1's actual architecture: CLIENTE is not a separate DOM/route
/// tree in the canonical HTML either — it's the same `.pos-layout` with
/// `body.modo-cliente` CSS swapping visibility. The Flutter equivalent
/// (a dedicated widget rendered instead of the admin `Scaffold`, not a
/// panel swapped in *inside* it) is deliberately *stronger* than V1's
/// CSS-only hiding: no sidebar/topbar/other-module widget exists
/// anywhere in this subtree at all, so there is nothing for a customer
/// to navigate to — see `_PosShellState.build()`.
///
/// Reuses `_ClienteTicketPreview` (unchanged since TASK 12.3) as the
/// ticket surface. One deliberate, already-approved deviation from raw
/// V1 fidelity carries forward here: V1's CLIENTE ticket is fully
/// editable; this one stays read-only, per the explicit "CLIENTE is
/// card-payment-only, never exposes cashier controls" business rule
/// introduced alongside TASK 12.3 — this task doesn't rescind that.
class _ClienteLockedShell extends StatelessWidget {
  const _ClienteLockedShell({
    required this.context,
    required this.controller,
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.rewardsGateway,
    required this.onRequestCajeroReturn,
  });

  final AuthenticatedContext context;
  final PosReadController controller;
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  // TASK 13.1 (Part W): the attached customer's OWN reward status,
  // display-only — see `_ClienteRewardStatus` and ADR-0018.
  final PosRewardsGateway rewardsGateway;
  final VoidCallback onRequestCajeroReturn;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) => Scaffold(
        key: const Key('pos-cliente-shell'),
        backgroundColor: palette.background,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth >= 900;
                final productColumn = _ClienteProductColumn(
                  controller: controller,
                  saleSession: saleSession,
                  onRequestCajeroReturn: onRequestCajeroReturn,
                  tileWidth: wide ? 120.0 : 100.0,
                );
                final ticket = _ClienteTicketPreview(
                  saleSession: saleSession,
                  salesGateway: salesGateway,
                  paymentsGateway: paymentsGateway,
                  rewardsGateway: rewardsGateway,
                  branchId: this.context.session.branchId,
                );
                if (wide) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(child: productColumn),
                      const SizedBox(width: 14),
                      SizedBox(width: 400, child: ticket),
                    ],
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: productColumn),
                    const SizedBox(height: 14),
                    _TicketBar(saleSession: saleSession, ticketSurface: ticket),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// The `.pos-left` column in CLIENTE mode: greeting header, jumpbar,
/// stacked per-category catalog, then the help/coupon bar — matching V1's
/// exact stacking order (`#pos-cliente-saludo` → `#pos-cliente-jumpbar` →
/// `#pos-prods` → `#pos-cliente-ayuda-bar`). No search field, no toolbar
/// icons, no single-select category tabs: all three are hidden in
/// `body.modo-cliente` and there is no CAJERO-only toolbar rendered here
/// at all — this is a genuinely separate composition, not the CAJERO
/// toolbar with pieces removed.
class _ClienteProductColumn extends StatelessWidget {
  const _ClienteProductColumn({
    required this.controller,
    required this.saleSession,
    required this.onRequestCajeroReturn,
    required this.tileWidth,
  });

  final PosReadController controller;
  final SaleSession saleSession;
  final VoidCallback onRequestCajeroReturn;
  final double tileWidth;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _ClienteHeader(onRequestCajeroReturn: onRequestCajeroReturn),
      const SizedBox(height: 8),
      Expanded(
        child: _ClienteStackedCatalog(
          controller: controller,
          saleSession: saleSession,
          tileWidth: tileWidth,
        ),
      ),
      const SizedBox(height: 8),
      const _ClienteAyudaBar(),
    ],
  );
}

/// `#pos-cliente-saludo` + `#pos-cajcli-switch`'s repurposed
/// `#posmodo-cajero` button: logo, generic greeting (V1's own copy is
/// static — "¡Hola! 👋" / "Selecciona lo que deseas", never personalized
/// to a customer name), a live clock (`actualizarRelojTopbar()`, shared
/// with the CAJERO topbar clock — see `_LiveClockText`), and "Volver a
/// cajero".
class _ClienteHeader extends StatelessWidget {
  const _ClienteHeader({required this.onRequestCajeroReturn});
  final VoidCallback onRequestCajeroReturn;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-cliente-header'),
      child: LayoutBuilder(
        builder: (context, constraints) {
          // The clock is a nice-to-have, not load-bearing — matching the
          // topbar's own `if (wide) const _TopbarClock()` pattern, it
          // drops out below a width where keeping it would force the
          // greeting text or the "Volver a cajero" button to overflow.
          final showClock = constraints.maxWidth >= 620;
          return Row(
            children: [
              const StartupLogoMark(size: 34, shadow: false),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '¡Hola! 👋',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: palette.text,
                      ),
                    ),
                    Text(
                      'Selecciona lo que deseas',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: palette.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (showClock)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Row(
                    key: const Key('pos-cliente-clock'),
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.schedule_outlined,
                        size: 13,
                        color: palette.action,
                      ),
                      const SizedBox(width: 6),
                      _LiveClockText(
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: palette.textSecondary,
                        ),
                      ),
                    ],
                  ),
                )
              else
                const SizedBox(width: 10),
              _ClienteVolverButton(onTap: onRequestCajeroReturn),
            ],
          );
        },
      ),
    );
  }
}

/// The repurposed `#posmodo-cajero` button — same key as CAJERO's own
/// mode-switch button (`pos-mode-cajero`), since V1 reuses the literal
/// same DOM element for both roles rather than showing two buttons; they
/// never coexist in the tree (CAJERO's toolbar isn't built while CLIENTE
/// is active, and vice versa), so sharing the key is safe and matches the
/// canonical behavior precisely. `flex:0 0 auto` in V1 (natural width,
/// not stretched) and recolored purple/`--purple` — no longer the
/// gradient-active treatment.
class _ClienteVolverButton extends StatelessWidget {
  const _ClienteVolverButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return InkWell(
      key: const Key('pos-mode-cajero'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(9),
      child: Container(
        height: 36,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border.all(color: palette.border),
          borderRadius: BorderRadius.circular(9),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.shield_outlined, size: 15, color: palette.action),
            const SizedBox(width: 6),
            Text(
              'Volver a cajero',
              style: TextStyle(
                color: palette.action,
                fontWeight: FontWeight.w800,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// `#pos-cliente-jumpbar` — one pill per active category; tapping
/// smooth-scrolls that category's sticky section header to the top,
/// matching `_scrollACategoriaCliente()`/`_scrollSuaveA()`'s 400ms
/// cubic ease-out (`Curves.easeOut` here — see `_clienteJumpToCategory`).
class _ClienteJumpbar extends StatelessWidget {
  const _ClienteJumpbar({required this.categories});
  final List<PosCategory> categories;

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) return const SizedBox.shrink();
    return SingleChildScrollView(
      key: const Key('pos-cliente-jumpbar'),
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final category in categories)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: _JumpbarPill(
                key: Key('pos-cliente-jump-${category.id}'),
                label: category.name,
                onTap: () => _clienteJumpToCategory(category.id),
              ),
            ),
        ],
      ),
    );
  }
}

class _JumpbarPill extends StatelessWidget {
  const _JumpbarPill({required this.label, required this.onTap, super.key});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Material(
      color: palette.blueTint,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          decoration: BoxDecoration(
            border: Border.all(color: palette.blue, width: 1.5),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: palette.blueDeep,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
        ),
      ),
    );
  }
}

/// Stable per-category `GlobalKey`s so the jumpbar can scroll a section
/// into view. `GlobalObjectKey('...$categoryId')` would *not* work here:
/// Dart string interpolation creates a new String object each call, and
/// `GlobalObjectKey` compares by identity, not value — so the header's
/// key and the jump target's key would never be `==`. A small cache
/// keyed by category id (bounded — a company's category list is small
/// and rarely changes within a session) gives both call sites the same
/// `GlobalKey` instance instead.
final _clienteSectionKeys = <String, GlobalKey>{};
GlobalKey _clienteSectionKey(String categoryId) =>
    _clienteSectionKeys.putIfAbsent(categoryId, GlobalKey.new);

void _clienteJumpToCategory(String categoryId) {
  final target = _clienteSectionKey(categoryId).currentContext;
  if (target == null) return;
  unawaited(
    Scrollable.ensureVisible(
      target,
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOut,
    ),
  );
}

/// `#pos-prods` in CLIENTE mode: products stacked into per-category
/// sticky sections (`renderPosClienteApilado()`), not the single flat,
/// single-category grid CAJERO shows. Loading/failure states are shared
/// with CAJERO's own `_ReadState`; the `empty`/`ready` distinction is
/// deliberately *not* used the same way here — see `_ClienteCategorySections`.
class _ClienteStackedCatalog extends StatelessWidget {
  const _ClienteStackedCatalog({
    required this.controller,
    required this.saleSession,
    required this.tileWidth,
  });
  final PosReadController controller;
  final SaleSession saleSession;
  final double tileWidth;

  @override
  Widget build(BuildContext context) {
    final categories = controller.categories.items
        .where((category) => category.status == 'active')
        .toList(growable: false);
    final phase = controller.products.phase;
    final Widget body;
    if (phase == PosReadPhase.idle || phase == PosReadPhase.loading) {
      body = const _LoadingState();
    } else if (phase == PosReadPhase.failure) {
      body = _FailureState(
        message:
            controller.products.message ??
            'No fue posible cargar la información.',
        onRetry: () => controller.loadProducts(refresh: true),
      );
    } else {
      // `ready` or `empty` — both preserve the canonical category
      // sections rather than collapsing to a single generic empty card:
      // V1 always renders every active category's sticky header, with an
      // honest "Sin productos en esta categoría" message for whichever
      // ones have no matching items, instead of hiding the whole catalog
      // structure. A product with no active category (or an inactive/
      // deleted category) simply isn't shown in any section — matching
      // V1's own `renderPosClienteApilado()`, which only ever iterates
      // active categories.
      body = _ClienteCategorySections(
        categories: categories,
        items: controller.products.items,
        balances: controller.balances.items,
        saleSession: saleSession,
        tileWidth: tileWidth,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (categories.isNotEmpty) ...[
          _ClienteJumpbar(categories: categories),
          const SizedBox(height: 6),
        ],
        Expanded(child: body),
      ],
    );
  }
}

class _ClienteCategorySections extends StatelessWidget {
  const _ClienteCategorySections({
    required this.categories,
    required this.items,
    required this.balances,
    required this.saleSession,
    required this.tileWidth,
  });
  final List<PosCategory> categories;
  final List<PosProduct> items;
  final List<PosInventoryBalance> balances;
  final SaleSession saleSession;
  final double tileWidth;

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) {
      return const _EmptyState(message: 'No hay categorías disponibles.');
    }
    return CustomScrollView(
      key: const Key('pos-cliente-catalog'),
      // Generous but bounded cache extent: keeps every section's sticky
      // header built (and its `GlobalKey.currentContext` non-null) even
      // before it's scrolled into view, so jumpbar taps can reach any
      // category immediately — see `_clienteJumpToCategory`. `cacheExtent`
      // is deprecated in favor of `scrollCacheExtent`, but the replacement
      // `ScrollCacheExtent` type is not actually exported by
      // `package:flutter/material.dart`/`rendering.dart` in this SDK
      // (confirmed by inspecting the vendored Flutter source — it's
      // declared `sealed` in `src/rendering/viewport.dart` but not part of
      // any public barrel file's export list yet), so the old parameter is
      // the only usable option today.
      // ignore: deprecated_member_use
      cacheExtent: 5000,
      slivers: [
        for (var i = 0; i < categories.length; i++) ...[
          SliverPersistentHeader(
            pinned: true,
            delegate: _ClienteSectionHeaderDelegate(
              sectionKey: _clienteSectionKey(categories[i].id),
              title: categories[i].name,
              showTopBorder: i > 0,
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            sliver: _sectionSliver(context, categories[i]),
          ),
        ],
      ],
    );
  }

  Widget _sectionSliver(BuildContext context, PosCategory category) {
    final palette = PosPalette.of(context);
    final categoryItems = items
        .where((item) => item.categoryId == category.id)
        .toList(growable: false);
    if (categoryItems.isEmpty) {
      // Matches `_renderSeccionProductos([])`'s exact copy — the same
      // "no products" string CAJERO's own empty category uses.
      return SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: Center(
            child: Text(
              'Sin productos en esta categoría',
              style: TextStyle(color: palette.textMuted, fontSize: 13),
            ),
          ),
        ),
      );
    }
    return SliverGrid(
      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: tileWidth,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        // TASK 12.3C: +12 over the canonical 160 to fit the new real
        // price caption without cramming the existing name/code lines.
        mainAxisExtent: 172,
      ),
      delegate: SliverChildBuilderDelegate((context, index) {
        final item = categoryItems[index];
        // TASK 12.3C: the exact same shared function CAJERO uses — see
        // `_PosProductGrid`.
        final block = posAddabilityBlock(item, balances);
        return _PosProductCard(
          item: item,
          block: block,
          onTap: block == null
              ? () => saleSession.addProduct(item, balances)
              : () => _showNotice(context, _addabilityMessage(block)),
        );
      }, childCount: categoryItems.length),
    );
  }
}

/// `.pos-cliente-seccion-titulo` — a sticky per-category title, 15/800,
/// with a top border except on the first section (`:first-child{border-
/// top:none}`).
class _ClienteSectionHeaderDelegate extends SliverPersistentHeaderDelegate {
  _ClienteSectionHeaderDelegate({
    required this.sectionKey,
    required this.title,
    required this.showTopBorder,
  });
  final GlobalKey sectionKey;
  final String title;
  final bool showTopBorder;

  @override
  double get minExtent => 40;
  @override
  double get maxExtent => 40;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final palette = PosPalette.of(context);
    return Container(
      key: sectionKey,
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: palette.background,
        border: showTopBorder
            ? Border(top: BorderSide(color: palette.border))
            : null,
      ),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w800,
          color: palette.text,
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _ClienteSectionHeaderDelegate oldDelegate) =>
      oldDelegate.title != title || oldDelegate.showTopBorder != showTopBorder;
}

/// `#pos-cliente-ayuda-bar` — the two-button help/coupon bar fixed at the
/// bottom of the CLIENTE product column. Neither destination has a real
/// backend contract (no staff-notification or coupon-validation
/// endpoint/table exists anywhere in AS Platform — confirmed by
/// inspection), so both surface an honest, customer-safe "not available
/// yet" message instead of V1's own fabricated staff-dispatch toast
/// ("🔔 Un miembro del equipo viene en camino a ayudarte" — a promise
/// this app cannot actually keep, since there is no real notification
/// mechanism behind it) or a faked coupon result.
class _ClienteAyudaBar extends StatelessWidget {
  const _ClienteAyudaBar();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-cliente-ayuda-bar'),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(14),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        children: [
          Expanded(
            child: _AyudaBarButton(
              buttonKey: const Key('pos-cliente-ayuda-button'),
              icon: Icons.headset_mic_outlined,
              title: '¿Necesitas ayuda?',
              subtitle: 'Toca aquí',
              onTap: () => _showNotice(
                context,
                'Esta función aún no está disponible. Por favor acércate '
                'con el personal.',
              ),
            ),
          ),
          Container(width: 1, color: palette.border),
          Expanded(
            child: _AyudaBarButton(
              buttonKey: const Key('pos-cliente-cupon-button'),
              icon: Icons.sell_outlined,
              title: 'Tengo un cupón',
              subtitle: 'Toca aquí para aplicar',
              onTap: () => showDialog<void>(
                context: context,
                builder: (context) => const _CuponClienteDialog(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AyudaBarButton extends StatelessWidget {
  const _AyudaBarButton({
    required this.buttonKey,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final Key buttonKey;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return InkWell(
      key: buttonKey,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Icon(icon, size: 20, color: palette.action),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: palette.action,
                    ),
                  ),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11.5, color: palette.textMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// `#modal-cupon-cliente` — the CLIENTE-only coupon entry flow, reached
/// only via "Tengo un cupón" (`_ClienteAyudaBar`). V1 validates coupons
/// entirely client-side against a local `DB.cupones` array; no such
/// endpoint/table exists in AS Platform (confirmed by inspection — no
/// coupon/discount table or route anywhere in `apps/api`/
/// `packages/database`). So this reproduces V1's visual flow (read-only
/// code display driven only by the on-screen keyboard — never the system
/// keyboard, matching `readonly` — plus the dedicated full-QWERTY
/// keyboard and "Aplicar cupón") but never accepts or rejects a code:
/// Aplicar always surfaces the same honest "not available yet" notice.
/// V1's success/collapse animation is not reproduced either, since that
/// would require simulating a fake acceptance — see
/// docs/AS_POS_SALE_ENGINE.md.
class _CuponClienteDialog extends StatefulWidget {
  const _CuponClienteDialog();

  @override
  State<_CuponClienteDialog> createState() => _CuponClienteDialogState();
}

class _CuponClienteDialogState extends State<_CuponClienteDialog> {
  final codeController = TextEditingController();
  String? feedback;

  @override
  void dispose() {
    codeController.dispose();
    super.dispose();
  }

  void _type(String char) {
    if (codeController.text.length >= 20) return;
    setState(() {
      codeController.text += char;
      feedback = null;
    });
  }

  void _backspace() {
    if (codeController.text.isEmpty) return;
    setState(() {
      codeController.text = codeController.text.substring(
        0,
        codeController.text.length - 1,
      );
    });
  }

  void _aplicar() {
    setState(
      () => feedback = 'La validación de cupones aún no está disponible.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      key: const Key('pos-cliente-cupon-dialog'),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Icon(Icons.sell_outlined, color: palette.text),
                  const SizedBox(width: 9),
                  const Expanded(
                    child: Text(
                      'Tengo un cupón',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('pos-cliente-cupon-close'),
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              Text(
                'Escribe el código de tu cupón',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: palette.textSecondary),
              ),
              const SizedBox(height: 14),
              TextField(
                key: const Key('pos-cliente-cupon-input'),
                controller: codeController,
                readOnly: true,
                textAlign: TextAlign.center,
                decoration: const InputDecoration(hintText: 'CÓDIGO'),
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 2,
                ),
              ),
              if (feedback != null) ...[
                const SizedBox(height: 12),
                Text(
                  feedback!,
                  key: const Key('pos-cliente-cupon-feedback'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: palette.textSecondary,
                  ),
                ),
              ],
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: const Key('pos-cliente-cupon-apply'),
                  onPressed: _aplicar,
                  icon: const Icon(Icons.check),
                  label: const Text('Aplicar cupón'),
                ),
              ),
              const SizedBox(height: 18),
              _CuponVirtualKeyboard(onKey: _type, onBackspace: _backspace),
            ],
          ),
        ),
      ),
    );
  }
}

/// `#teclado-virtual-cupon` — a dedicated, self-contained full-QWERTY
/// on-screen keyboard, distinct from `StartupPinKeypad`'s numeric-only
/// layout, so a touch-only kiosk can type a coupon code without ever
/// engaging a system keyboard — matching V1's own separate component.
///
/// TASK 12.3B.1: rows are fixed `Row`s, never a `Wrap` — V1's `.tv-fila`
/// rows are a rigid 10/10/9/8-key layout that never reflows regardless of
/// width; the previous `Wrap` implementation let keys spill onto the next
/// line whenever a row didn't fit (`9`/`0` onto their own line, `O`/`P`
/// likewise, `L` isolated alone), which is exactly the bug this fixes.
/// Instead, a `LayoutBuilder` computes one key size from the *widest* row
/// (10 keys) and applies it uniformly to every key — narrow viewports
/// scale the whole keyboard down proportionally, they never restructure
/// it. Centering shorter rows (9 and 8 keys) falls out for free: each
/// `Row` is `mainAxisSize: MainAxisSize.min` (sized to its own content),
/// and `Column`'s default `crossAxisAlignment.center` centers every row
/// against the widest one — matching V1's `.tv-fila{justify-content:
/// center}`.
class _CuponVirtualKeyboard extends StatelessWidget {
  const _CuponVirtualKeyboard({required this.onKey, required this.onBackspace});
  final ValueChanged<String> onKey;
  final VoidCallback onBackspace;

  static const _rows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ];
  static const _widestRowKeyCount = 10; // rows 1 and 2
  static const _spacing = 6.0;
  static const _maxKeySize = 34.0;
  static const _minKeySize = 22.0;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-cliente-cupon-keyboard'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: palette.background,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(18),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final fitKeySize =
              (constraints.maxWidth - (_widestRowKeyCount - 1) * _spacing) /
              _widestRowKeyCount;
          final keySize = fitKeySize.clamp(_minKeySize, _maxKeySize);
          final rowGap = keySize * (8 / _maxKeySize);
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var r = 0; r < _rows.length; r++) ...[
                if (r > 0) SizedBox(height: rowGap),
                _CuponKeyRow(
                  keys: _rows[r],
                  keySize: keySize,
                  spacing: _spacing,
                  onKey: onKey,
                  trailingBackspace: r == _rows.length - 1,
                  onBackspace: onBackspace,
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// One fixed, never-reflowing row of `_TvKey`s — the canonical row
/// structure lives entirely in the caller's `_rows` table; this widget
/// only lays out whatever list it's given, with a fixed gap between keys
/// (no gap after the last one, so `mainAxisSize.min` + the parent
/// `Column`'s centering produce a symmetrically-centered row).
class _CuponKeyRow extends StatelessWidget {
  const _CuponKeyRow({
    required this.keys,
    required this.keySize,
    required this.spacing,
    required this.onKey,
    required this.trailingBackspace,
    required this.onBackspace,
  });
  final List<String> keys;
  final double keySize;
  final double spacing;
  final ValueChanged<String> onKey;
  final bool trailingBackspace;
  final VoidCallback onBackspace;

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    for (final char in keys) {
      if (children.isNotEmpty) children.add(SizedBox(width: spacing));
      children.add(
        _TvKey(label: char, size: keySize, onTap: () => onKey(char)),
      );
    }
    if (trailingBackspace) {
      children.add(SizedBox(width: spacing));
      children.add(
        _TvKey(
          icon: Icons.backspace_outlined,
          size: keySize,
          danger: true,
          onTap: onBackspace,
        ),
      );
    }
    return Row(mainAxisSize: MainAxisSize.min, children: children);
  }
}

class _TvKey extends StatelessWidget {
  const _TvKey({
    this.label,
    this.icon,
    required this.onTap,
    required this.size,
    this.danger = false,
  });
  final String? label;
  final IconData? icon;
  final VoidCallback onTap;
  final double size;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final accent = danger ? palette.error : palette.action;
    return Material(
      color: palette.surface,
      shape: CircleBorder(side: BorderSide(color: accent, width: 2)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: size,
          height: size,
          child: Center(
            child: label != null
                ? Text(
                    label!,
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: size * (13 / 34),
                      color: palette.text,
                    ),
                  )
                : Icon(icon, size: size * (15 / 34), color: accent),
          ),
        ),
      ),
    );
  }
}

class _TicketHeaderAction extends StatelessWidget {
  const _TicketHeaderAction({
    required this.tooltip,
    required this.icon,
    this.onPressed,
    super.key,
  });
  final String tooltip;
  final IconData icon;
  // TASK 14.3 (Wave 1, Part B.4): a real handler when given (e.g. "Nota de
  // venta") — falls back to the pre-existing read-only stub for every
  // action this task doesn't touch (e.g. "Limpiar ticket").
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: tooltip,
    onPressed: onPressed ?? () => _showReadOnlyNotice(context),
    icon: Icon(icon, size: 16, color: Colors.white),
    padding: const EdgeInsets.all(4),
    constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
  );
}

/// TASK 14.3 (Wave 1, Part B.4): "Nota de venta" — a small text-entry
/// dialog bound to [SaleSession.note], threaded straight into
/// `POST /sales`'s own optional `note` field. Pre-fills with the current
/// note, if any; clearing the field and confirming removes it.
class _NoteDialog extends StatefulWidget {
  const _NoteDialog({required this.initialNote});
  final String? initialNote;

  @override
  State<_NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<_NoteDialog> {
  late final _controller = TextEditingController(text: widget.initialNote ?? '');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Nota de venta'),
    content: SizedBox(
      width: 360,
      child: TextField(
        key: const Key('pos-ticket-note-field'),
        controller: _controller,
        autofocus: true,
        maxLength: 2000,
        maxLines: 4,
        decoration: const InputDecoration(hintText: 'Ej. Sin bolsa, entregar en caja 2…'),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop<String?>(null),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        key: const Key('pos-ticket-note-save'),
        onPressed: () => Navigator.of(context).pop<String?>(_controller.text),
        child: const Text('Guardar'),
      ),
    ],
  );
}

/// Matches `.t-foot`: subtotal, coupon entry, IVA, the big total row,
/// payment-method selector, cash-received input, and the Cobrar bar.
/// TASK 12.3: Subtotal/IVA/Total are now the real, reactive
/// `saleSession` totals (kept centralized on `SaleSession` itself, not
/// recomputed here — see `sale_session.dart`) instead of a static
/// `$0.00`. Coupon, cash-received, and the payment-method grid remain
/// exactly as before: visually faithful but wired to
/// `_showReadOnlyNotice` — TASK 12.2C explicitly requires these stay
/// visible, not removed. Only Cobrar (payment itself) is out of scope
/// here — see `_PosCobrarButton`.
class _TicketFooter extends StatefulWidget {
  const _TicketFooter({
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    required this.promotionsGateway,
    required this.customersGateway,
    required this.rewardsGateway,
    this.heldSalesGateway = const EmptyPosHeldSalesGateway(),
    required this.branchId,
    required this.permissions,
    // TASK 14.5 (Wave 3, Phase 4a): see `_PosCobrarButton`'s own doc
    // comment — forwarded straight through to it.
    this.cobrarButtonKey,
  });
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
  final PosPromotionsGateway promotionsGateway;
  // TASK 13.0: "Buscar cliente"/"Nuevo cliente" — see
  // `_CustomerSelectorDialog` and ADR-0017 Part H/I.
  final PosCustomersGateway customersGateway;
  // TASK 13.1: the attached customer's reward lookup/redeem affordance —
  // see `_TicketRewardsDialog` and ADR-0018 Part V.
  final PosRewardsGateway rewardsGateway;
  // TASK 14.3 (Wave 1, Part B.1): the resumed-held-cart `link-sale`
  // handshake — see `_PosCobrarButton`.
  final PosHeldSalesGateway heldSalesGateway;
  final String? branchId;
  final List<String> permissions;
  final GlobalKey<_PosCobrarButtonState>? cobrarButtonKey;

  @override
  State<_TicketFooter> createState() => _TicketFooterState();
}

class _TicketFooterState extends State<_TicketFooter> {
  // TASK 12.5A: which method Cobrar acts on next. Efectivo is V1's own
  // default-active option (see `_PosPayGrid`'s original hardcoded
  // `active: true` on Efectivo, TASK 12.2C) — kept as the real default
  // here, not just a visual one.
  String _selectedMethod = 'cash';

  final _couponController = TextEditingController();
  bool _couponBusy = false;
  String? _couponError;

  // TASK 12.9: the automatic re-quote debounce — fires
  // `POST /sales/pricing-quotes` a short beat after the cart/coupon/
  // manual-discount state actually changes (ADR-0016: automatic
  // promotions apply without any coupon code, so this must fire on a
  // plain cart change too, not only when a coupon/discount is present).
  Timer? _quoteDebounce;
  String? _lastQuotedSignature;
  bool _quoting = false;

  // TASK 13.1 (Part V): the attached customer's own reward entitlements —
  // re-fetched whenever the attached customer changes (never on every
  // cart mutation, unlike the quote above). `_lastRewardsCustomerId`
  // tracks which customer this list actually belongs to, so a stale
  // fetch that resolves after the customer changed again is never
  // applied (mirrors `_fetchQuote`'s own staleness guard).
  List<PosRewardEntitlement> _rewardEntitlements = const [];
  String? _lastRewardsCustomerId;

  bool get _canReadReward => widget.permissions.contains('reward.read');
  bool get _canRedeemReward => widget.permissions.contains('reward.redeem');

  List<PosRewardEntitlement> get _availableRewards =>
      _rewardEntitlements.where((entitlement) => entitlement.isAvailable).toList(growable: false);

  @override
  void initState() {
    super.initState();
    widget.saleSession.addListener(_onSaleSessionChanged);
    _onSaleSessionChanged();
  }

  @override
  void dispose() {
    widget.saleSession.removeListener(_onSaleSessionChanged);
    _quoteDebounce?.cancel();
    _couponController.dispose();
    super.dispose();
  }

  String _cartSignature() {
    final saleSession = widget.saleSession;
    final lines = saleSession.lines.map((line) => '${line.productId}:${line.quantityForApi}').join(',');
    final coupons = saleSession.couponCodes.join(',');
    final manual = saleSession.manualDiscount?.toJson().toString() ?? '';
    // TASK 13.2: the attached reward entitlement is part of the same
    // pricing intent as coupons/manual discount — a change here must
    // invalidate the previous quote and trigger a fresh one exactly like
    // those do.
    final reward = saleSession.rewardEntitlementId ?? '';
    return '$lines|$coupons|$manual|$reward|${widget.branchId}';
  }

  void _onSaleSessionChanged() {
    final saleSession = widget.saleSession;
    // TASK 13.1 (Part V): the reward lookup depends only on which
    // customer is attached, never on the cart itself — checked
    // independently of the quote debounce below (which short-circuits on
    // an empty cart; a customer can be attached before any line exists).
    if (saleSession.customerId != _lastRewardsCustomerId) {
      unawaited(_loadRewards());
    }
    // Always cancel any pending timer first — including when the
    // signature already matches `_lastQuotedSignature` (e.g. a caller
    // just applied a fresh quote for exactly this state itself, as
    // `_applyCoupon`/`_openManualDiscountDialog` do) — otherwise a
    // still-pending timer from an earlier, now-superseded notification
    // would fire later and issue a redundant re-quote call.
    _quoteDebounce?.cancel();
    if (saleSession.isEmpty) {
      _lastQuotedSignature = null;
      return;
    }
    final signature = _cartSignature();
    if (signature == _lastQuotedSignature) return;
    _quoteDebounce = Timer(const Duration(milliseconds: 350), () {
      unawaited(_fetchQuote(signature));
    });
  }

  // TASK 13.1 (Part V): re-fetched on every attached-customer change —
  // never on a plain cart mutation. A permission-less actor, no attached
  // customer, or a failed lookup all resolve to the same empty list, so
  // the compact affordance below simply renders nothing rather than an
  // error banner cluttering the main checkout flow.
  Future<void> _loadRewards() async {
    final customerId = widget.saleSession.customerId;
    _lastRewardsCustomerId = customerId;
    if (customerId == null || !_canReadReward) {
      if (mounted) setState(() => _rewardEntitlements = const []);
      return;
    }
    try {
      final entitlements = await widget.rewardsGateway.entitlementsForCustomer(customerId);
      // The attached customer may have changed again while this call was
      // in flight — never apply a now-stale list to a different customer.
      if (!mounted || widget.saleSession.customerId != customerId) return;
      setState(() => _rewardEntitlements = entitlements);
    } on Object {
      if (!mounted) return;
      setState(() => _rewardEntitlements = const []);
    }
  }

  Future<void> _openRewardsDialog() async {
    final redeemed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _TicketRewardsDialog(
        rewardsGateway: widget.rewardsGateway,
        entitlements: _rewardEntitlements,
        canRedeem: _canRedeemReward,
        branchId: widget.branchId,
        // TASK 13.2: lets the cashier attach one of these SAME
        // entitlements to the current sale for pricing (ADR-0019) —
        // distinct from "Canjear" above, which stays the pre-existing
        // TASK 13.1 standalone redemption and is unchanged.
        appliedEntitlementId: widget.saleSession.rewardEntitlementId,
        onApply: _applyReward,
        onRemove: _removeReward,
      ),
    );
    if (redeemed == true) unawaited(_loadRewards());
  }

  /// TASK 13.2: previews [entitlement] as this ticket's reward benefit via
  /// the SAME quote endpoint the coupon flow already uses (mirrors
  /// [_applyCoupon] exactly) — only actually attaches it to [SaleSession]
  /// once the backend accepts it, so an invalid selection (wrong customer,
  /// already redeemed, expired, revoked, or a program with no configured
  /// benefit) never silently applies. Returns `null` on success or an
  /// honest, backend-driven message on rejection — the caller (the
  /// dialog) surfaces it, never a crash or a silently-ignored selection.
  Future<String?> _applyReward(PosRewardEntitlement entitlement) async {
    final saleSession = widget.saleSession;
    final branchId = widget.branchId;
    final customerId = saleSession.customerId;
    if (customerId == null) return 'Selecciona un cliente para esta venta primero.';
    if (branchId == null) return 'Esta sesión no tiene una sucursal asignada.';
    if (saleSession.isEmpty) return 'Agrega al menos un producto al ticket.';
    try {
      final quote = await widget.promotionsGateway.quote(
        branchId: branchId,
        items: [
          for (final line in saleSession.lines)
            PosPricingQuoteItem(productId: line.productId, quantity: line.quantityForApi),
        ],
        couponCodes: saleSession.couponCodes,
        manualDiscount: saleSession.manualDiscount,
        customerId: customerId,
        rewardEntitlementId: entitlement.id,
      );
      if (!mounted) return null;
      saleSession.setRewardEntitlement(entitlement.id);
      _lastQuotedSignature = _cartSignature();
      saleSession.setQuote(quote);
      return null;
    } on ApiException catch (error) {
      return error.failure.message;
    } on Object {
      return 'No fue posible aplicar la recompensa.';
    }
  }

  /// Deselects the currently-attached reward entitlement — a plain local
  /// state change (mirrors [_removeCoupon]); the next automatic re-quote
  /// (triggered by [SaleSession.clearRewardEntitlement] itself) reflects
  /// its removal.
  void _removeReward() => widget.saleSession.clearRewardEntitlement();

  Future<void> _fetchQuote(String signature) async {
    final saleSession = widget.saleSession;
    final branchId = widget.branchId;
    if (branchId == null || saleSession.isEmpty) return;
    if (mounted) setState(() => _quoting = true);
    try {
      final quote = await widget.promotionsGateway.quote(
        branchId: branchId,
        items: [
          for (final line in saleSession.lines)
            PosPricingQuoteItem(productId: line.productId, quantity: line.quantityForApi),
        ],
        couponCodes: saleSession.couponCodes,
        manualDiscount: saleSession.manualDiscount,
        // TASK 13.2: only ever sent together — `customerId` is omitted
        // here whenever no reward is attached, reproducing the exact
        // pre-TASK-13.2 request shape for the common "no reward" case.
        customerId: saleSession.rewardEntitlementId == null ? null : saleSession.customerId,
        rewardEntitlementId: saleSession.rewardEntitlementId,
      );
      if (!mounted) return;
      // The cart may have changed again while this call was in flight —
      // never apply a now-stale quote to a different cart (this
      // effectively re-triggers `_onSaleSessionChanged` for the newer
      // state, since `_lastQuotedSignature` is only updated on a match).
      if (_cartSignature() != signature) return;
      _lastQuotedSignature = signature;
      saleSession.setQuote(quote);
    } on Object {
      // A failed automatic re-quote must never fabricate a total or block
      // the ticket — it simply leaves the previous (or catalog-only)
      // display in place; the cashier can still retry via the coupon/
      // discount actions, and Cobrar always re-derives for real anyway.
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  Future<void> _applyCoupon() async {
    final code = _couponController.text.trim();
    if (code.isEmpty) return;
    final saleSession = widget.saleSession;
    final branchId = widget.branchId;
    if (branchId == null || saleSession.isEmpty) {
      setState(() => _couponError = 'Agrega al menos un producto al ticket.');
      return;
    }
    setState(() {
      _couponBusy = true;
      _couponError = null;
    });
    final candidateCodes = [...saleSession.couponCodes, code];
    try {
      final quote = await widget.promotionsGateway.quote(
        branchId: branchId,
        items: [
          for (final line in saleSession.lines)
            PosPricingQuoteItem(productId: line.productId, quantity: line.quantityForApi),
        ],
        couponCodes: candidateCodes,
        manualDiscount: saleSession.manualDiscount,
      );
      if (!mounted) return;
      final rejection = quote.rejectionFor(code);
      if (rejection != null) {
        setState(() {
          _couponBusy = false;
          _couponError = posCouponRejectionMessage(rejection.reason);
        });
        // The already-applied coupons/promotions may still be worth
        // refreshing from this same honest response — never silently
        // pretend the new code applied.
        _lastQuotedSignature = _cartSignature();
        saleSession.setQuote(quote);
        return;
      }
      _couponController.clear();
      saleSession.addCouponCode(code);
      _lastQuotedSignature = _cartSignature();
      saleSession.setQuote(quote);
      setState(() => _couponBusy = false);
      if (mounted) _showNotice(context, 'Cupón aplicado.');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _couponBusy = false;
        _couponError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _couponBusy = false;
        _couponError = 'No fue posible validar el cupón.';
      });
    }
  }

  void _removeCoupon(String code) => widget.saleSession.removeCouponCode(code);

  Future<void> _openManualDiscountDialog() async {
    final result = await showDialog<_ManualDiscountOutcome>(
      context: context,
      builder: (dialogContext) => _ManualDiscountDialog(
        saleSession: widget.saleSession,
        promotionsGateway: widget.promotionsGateway,
        branchId: widget.branchId,
      ),
    );
    if (result == null || !mounted) return;
    widget.saleSession.setManualDiscount(result.request);
    _lastQuotedSignature = _cartSignature();
    widget.saleSession.setQuote(result.quote);
  }

  void _removeCustomer() => widget.saleSession.clearCustomer();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final saleSession = widget.saleSession;
    final quote = saleSession.quote;
    final canApplyDiscount = widget.permissions.contains('discount.apply');
    // `.t-foot{border-top:1px solid var(--border)}` in the canonical CSS.
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: palette.background,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // TASK 13.0: the customer selector — "Venta sin cliente" is the
          // default/fast path (ADR-0017 Part H).
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _TicketCustomerRow(
              customerDisplayName: saleSession.customerDisplayName,
              onSelect: () => unawaited(
                openCustomerSelector(
                  context,
                  saleSession: widget.saleSession,
                  customersGateway: widget.customersGateway,
                ),
              ),
              onRemove: _removeCustomer,
            ),
          ),
          // TASK 13.1 (Part V): a compact, collapsed-by-default reward
          // affordance — only rendered once the attached customer has at
          // least one entitlement whose backend-computed
          // `effective_status` is `available`; never an empty-state
          // placeholder cluttering the main checkout flow (that honest-
          // empty-state requirement belongs to Customer Detail only, per
          // ADR-0018 Part U/V).
          if (_availableRewards.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  key: const Key('pos-ticket-rewards-open'),
                  onPressed: () => unawaited(_openRewardsDialog()),
                  icon: const Icon(Icons.card_giftcard_outlined, size: 15),
                  label: Text('Recompensas disponibles (${_availableRewards.length})'),
                  style: OutlinedButton.styleFrom(foregroundColor: palette.blueDeep, side: BorderSide(color: palette.border)),
                ),
              ),
            ),
          // TASK 12.9: automatic promotions surface on their own, no
          // coupon code required (ADR-0016) — the quote's own label,
          // never a hardcoded business name.
          if (quote != null && quote.appliedPromotions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _PromotionBanner(labels: quote.appliedPromotions.map((entry) => entry.label).toSet().toList()),
            ),
          if (saleSession.couponCodes.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final code in saleSession.couponCodes)
                    _CouponChip(code: code, onRemove: () => _removeCoupon(code)),
                ],
              ),
            ),
          // TASK 13.2: the reward entitlement attached to THIS sale, if
          // any — the quote's own `'reward'`-sourced label/amount (never a
          // hardcoded "VIP Pass"), removable exactly like a coupon chip.
          if (saleSession.rewardEntitlementId != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _RewardAppliedChip(
                appliedDiscounts: quote?.appliedRewards ?? const [],
                currencyCode: quote?.currencyCode,
                onRemove: _removeReward,
              ),
            ),
          _TicketTotalRow(
            label: 'Subtotal',
            value: _money(saleSession.displaySubtotal),
          ),
          // TASK 12.9: a subtle, honest "still computing" hint while the
          // automatic re-quote is in flight — the totals below simply
          // keep showing the last-known values until it resolves, never
          // a blocking spinner over the whole ticket.
          if (_quoting)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                'Actualizando precios…',
                key: const Key('pos-ticket-quoting-indicator'),
                style: TextStyle(color: palette.textMuted, fontSize: 10),
              ),
            ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pos-ticket-coupon-input'),
                  controller: _couponController,
                  enabled: !_couponBusy,
                  style: const TextStyle(fontSize: 12),
                  textCapitalization: TextCapitalization.characters,
                  onSubmitted: (_) => unawaited(_applyCoupon()),
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: '¿Tienes un cupón?',
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              OutlinedButton.icon(
                key: const Key('pos-ticket-coupon-apply'),
                onPressed: _couponBusy ? null : () => unawaited(_applyCoupon()),
                icon: _couponBusy
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.confirmation_num_outlined, size: 15),
                label: const Text('Aplicar'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: palette.textSecondary,
                  side: BorderSide(color: palette.border),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  textStyle: const TextStyle(fontSize: 12),
                ),
              ),
            ],
          ),
          if (_couponError != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                _couponError!,
                key: const Key('pos-ticket-coupon-error'),
                style: TextStyle(color: palette.error, fontSize: 11),
              ),
            ),
          const SizedBox(height: 4),
          if (saleSession.displayDiscountTotal.isPositive)
            _TicketTotalRow(
              label: 'Descuento',
              value: '-${_money(saleSession.displayDiscountTotal)}',
            ),
          _TicketTotalRow(
            label: 'IVA incluido',
            value: _money(saleSession.displayTaxTotal),
            muted: true,
          ),
          _TicketTotalRow(
            label: 'Total',
            value: _money(saleSession.displayTotal),
            big: true,
          ),
          const SizedBox(height: 6),
          _PosPayGrid(
            selectedMethod: _selectedMethod,
            onSelect: (method) => setState(() => _selectedMethod = method),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pos-ticket-cash-input'),
                  readOnly: true,
                  onTap: () => _showReadOnlyNotice(context),
                  style: const TextStyle(fontSize: 13),
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'Efectivo recibido (Enter)',
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 10,
                    ),
                  ),
                ),
              ),
              if (canApplyDiscount) ...[
                const SizedBox(width: 6),
                OutlinedButton.icon(
                  key: const Key('pos-ticket-manual-discount'),
                  onPressed: () => unawaited(_openManualDiscountDialog()),
                  icon: const Icon(Icons.sell_outlined, size: 15),
                  label: const Text('Desc.'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: palette.textSecondary,
                    side: BorderSide(color: palette.border),
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          _PosCobrarButton(
            key: widget.cobrarButtonKey,
            saleSession: saleSession,
            salesGateway: widget.salesGateway,
            paymentsGateway: widget.paymentsGateway,
            cashGateway: widget.cashGateway,
            heldSalesGateway: widget.heldSalesGateway,
            branchId: widget.branchId,
            selectedMethod: _selectedMethod,
          ),
        ],
      ),
    );
  }
}

/// TASK 12.9: "Promoción aplicada: <label>" — surfaces an automatic
/// promotion even when the cashier never typed a coupon code (ADR-0016).
class _PromotionBanner extends StatelessWidget {
  const _PromotionBanner({required this.labels});
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-ticket-promotion-banner'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: palette.action.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.local_offer_outlined, size: 14, color: palette.action),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Promoción aplicada: ${labels.join(', ')}',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: palette.action),
            ),
          ),
        ],
      ),
    );
  }
}

class _CouponChip extends StatelessWidget {
  const _CouponChip({required this.code, required this.onRemove});
  final String code;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: Key('pos-ticket-coupon-chip-$code'),
      padding: const EdgeInsets.only(left: 8, right: 2, top: 2, bottom: 2),
      decoration: BoxDecoration(
        color: palette.actionTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: palette.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.confirmation_num_outlined, size: 12, color: palette.action),
          const SizedBox(width: 4),
          Text(code, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: palette.text)),
          IconButton(
            key: Key('pos-ticket-coupon-remove-$code'),
            tooltip: 'Quitar cupón',
            onPressed: onRemove,
            icon: Icon(Icons.close, size: 13, color: palette.textMuted),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 22, minHeight: 22),
          ),
        ],
      ),
    );
  }
}

/// TASK 13.2: the reward entitlement currently attached to THIS sale —
/// mirrors [_CouponChip] exactly (same shape, same removable affordance),
/// but reads its label/amount straight off the quote's own `'reward'`-
/// sourced [PosAppliedDiscount] entries (never a hardcoded "VIP Pass"),
/// same as [_PromotionBanner]'s own "backend's own label, nothing
/// fabricated" rule. While no quote has confirmed the reward yet (e.g. the
/// cart just changed and a re-quote is still in flight), shows a plain
/// "Recompensa aplicada" placeholder rather than inventing an amount.
class _RewardAppliedChip extends StatelessWidget {
  const _RewardAppliedChip({
    required this.appliedDiscounts,
    required this.currencyCode,
    required this.onRemove,
  });
  final List<PosAppliedDiscount> appliedDiscounts;
  final String? currencyCode;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final currency = currencyCode;
    Money? total;
    if (currency != null && appliedDiscounts.isNotEmpty) {
      var sum = Money.zero(currency);
      for (final entry in appliedDiscounts) {
        try {
          sum = sum + Money.parse(entry.amount, currency);
        } on MoneyFormatException {
          // A malformed single entry never blocks the whole chip — falls
          // back to the plain label-only display below.
        }
      }
      total = sum;
    }
    final label = total == null ? 'Recompensa aplicada' : 'Recompensa aplicada · -${_money(total)}';
    return Container(
      key: const Key('pos-ticket-reward-chip'),
      padding: const EdgeInsets.only(left: 8, right: 2, top: 2, bottom: 2),
      decoration: BoxDecoration(
        color: palette.success.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: palette.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.card_giftcard_outlined, size: 12, color: palette.success),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: palette.text)),
          IconButton(
            key: const Key('pos-ticket-reward-chip-remove'),
            tooltip: 'Quitar recompensa',
            onPressed: onRemove,
            icon: Icon(Icons.close, size: 13, color: palette.textMuted),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 22, minHeight: 22),
          ),
        ],
      ),
    );
  }
}

/// TASK 12.9: the fixed, short "reason" list ADR-0016 asks for
/// (`{code, label}`) — `'other'` reveals a free-text field instead of
/// being submitted literally, so the backend's own `reason_code` is
/// always a real, specific reason, never the literal string "Otro".
const List<(String, String)> _manualDiscountReasons = [
  ('customer_dissatisfied', 'Cliente inconforme'),
  ('defective_product', 'Producto defectuoso'),
  ('courtesy', 'Cortesía'),
  ('other', 'Otro'),
];

/// What [_ManualDiscountDialog] resolves with on a confirmed discount —
/// both the exact request the cashier previewed AND the backend's own
/// preview quote for it, so the caller never has to re-derive or
/// re-fetch anything to display it immediately.
class _ManualDiscountOutcome {
  const _ManualDiscountOutcome(this.request, this.quote);
  final PosManualDiscountRequest request;
  final PosPricingQuote quote;
}

/// TASK 12.9: "Aplicar descuento" — a manual, authorized discount
/// (`discount.apply`, already gated before this dialog ever opens — see
/// `_TicketFooterState`). Ticket-scope only for this pass (ADR-0016/the
/// task's own v1 allowance: line-scope needs a "select this line" UI this
/// app doesn't have yet). Every amount shown here comes from a real
/// `POST /sales/pricing-quotes` preview — never computed locally — and
/// confirming only records the *request*; `Cobrar` still re-submits it for
/// the backend to independently re-validate (never trusted blindly).
class _ManualDiscountDialog extends StatefulWidget {
  const _ManualDiscountDialog({
    required this.saleSession,
    required this.promotionsGateway,
    required this.branchId,
  });
  final SaleSession saleSession;
  final PosPromotionsGateway promotionsGateway;
  final String? branchId;

  @override
  State<_ManualDiscountDialog> createState() => _ManualDiscountDialogState();
}

class _ManualDiscountDialogState extends State<_ManualDiscountDialog> {
  String _type = 'percentage';
  final _valueController = TextEditingController();
  String _reasonCode = _manualDiscountReasons.first.$1;
  final _customReasonController = TextEditingController();
  bool _busy = false;
  String? _error;
  PosPricingQuote? _preview;

  @override
  void dispose() {
    _valueController.dispose();
    _customReasonController.dispose();
    super.dispose();
  }

  String get _resolvedReasonCode =>
      _reasonCode == 'other' ? _customReasonController.text.trim() : _reasonCode;

  PosManualDiscountRequest? _buildRequest() {
    final rawValue = _valueController.text.trim();
    if (rawValue.isEmpty) return null;
    final reason = _resolvedReasonCode;
    if (reason.isEmpty) return null;
    if (_type == 'percentage') {
      final percent = double.tryParse(rawValue);
      if (percent == null || percent <= 0 || percent > 100) return null;
      final basisPoints = (percent * 100).round();
      return PosManualDiscountRequest(
        scope: 'ticket',
        type: 'percentage',
        value: '$basisPoints',
        reasonCode: reason,
      );
    }
    try {
      final amount = Money.parse(rawValue, widget.saleSession.quote?.currencyCode ?? 'MXN');
      if (!amount.isPositive) return null;
      return PosManualDiscountRequest(
        scope: 'ticket',
        type: 'fixed_amount',
        value: amount.toApiString(),
        reasonCode: reason,
      );
    } on MoneyFormatException {
      return null;
    }
  }

  Future<void> _fetchPreview() async {
    final branchId = widget.branchId;
    final request = _buildRequest();
    if (branchId == null) {
      setState(() => _error = 'Esta sesión no tiene una sucursal asignada.');
      return;
    }
    if (request == null) {
      setState(() => _error = 'Escribe un valor y una razón válidos.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _preview = null;
    });
    try {
      final quote = await widget.promotionsGateway.quote(
        branchId: branchId,
        items: [
          for (final line in widget.saleSession.lines)
            PosPricingQuoteItem(productId: line.productId, quantity: line.quantityForApi),
        ],
        couponCodes: widget.saleSession.couponCodes,
        manualDiscount: request,
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _preview = quote;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible calcular el descuento.';
      });
    }
  }

  void _confirm() {
    final request = _buildRequest();
    final preview = _preview;
    if (request == null || preview == null) return;
    Navigator.of(context).pop(_ManualDiscountOutcome(request, preview));
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final preview = _preview;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Aplicar descuento',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _DiscountTypeOption(
                      buttonKey: const Key('pos-manual-discount-percentage'),
                      label: 'Porcentaje',
                      active: _type == 'percentage',
                      onTap: () => setState(() {
                        _type = 'percentage';
                        _preview = null;
                      }),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _DiscountTypeOption(
                      buttonKey: const Key('pos-manual-discount-fixed'),
                      label: 'Monto fijo',
                      active: _type == 'fixed_amount',
                      onTap: () => setState(() {
                        _type = 'fixed_amount';
                        _preview = null;
                      }),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-manual-discount-value'),
                controller: _valueController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() => _preview = null),
                decoration: InputDecoration(
                  isDense: true,
                  labelText: _type == 'percentage' ? 'Porcentaje (%)' : 'Monto (\$)',
                ),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                key: const Key('pos-manual-discount-reason'),
                initialValue: _reasonCode,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Razón'),
                items: [
                  for (final reason in _manualDiscountReasons)
                    DropdownMenuItem(value: reason.$1, child: Text(reason.$2)),
                ],
                onChanged: (value) => setState(() {
                  _reasonCode = value ?? _manualDiscountReasons.first.$1;
                  _preview = null;
                }),
              ),
              if (_reasonCode == 'other') ...[
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-manual-discount-reason-custom'),
                  controller: _customReasonController,
                  onChanged: (_) => setState(() => _preview = null),
                  decoration: const InputDecoration(isDense: true, labelText: 'Especifica la razón'),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              if (preview != null) ...[
                const SizedBox(height: 12),
                _TicketTotalRow(label: 'Descuento', value: '-${_money(Money.parse(preview.discountTotal, preview.currencyCode))}'),
                _TicketTotalRow(label: 'Nuevo total', value: _money(Money.parse(preview.total, preview.currencyCode)), big: true),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: palette.textSecondary,
                        side: BorderSide(color: palette.border),
                      ),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: preview == null
                        ? FilledButton(
                            key: const Key('pos-manual-discount-preview'),
                            onPressed: _busy ? null : () => unawaited(_fetchPreview()),
                            style: FilledButton.styleFrom(backgroundColor: palette.action),
                            child: _busy
                                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                : const Text('Vista previa'),
                          )
                        : FilledButton(
                            key: const Key('pos-manual-discount-confirm'),
                            onPressed: _confirm,
                            style: FilledButton.styleFrom(backgroundColor: palette.action),
                            child: const Text('Aplicar'),
                          ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DiscountTypeOption extends StatelessWidget {
  const _DiscountTypeOption({
    required this.buttonKey,
    required this.label,
    required this.active,
    required this.onTap,
  });
  final Key buttonKey;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton(
      key: buttonKey,
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        backgroundColor: active ? palette.action : null,
        foregroundColor: active ? Colors.white : palette.textSecondary,
        side: BorderSide(color: active ? palette.action : palette.border),
      ),
      child: Text(label, style: const TextStyle(fontSize: 12)),
    );
  }
}

/// `\$${value.toStringAsFixed(2)}` — the one place ticket amounts are
/// formatted, so every total/line/Cobrar label stays consistent.
// TASK 12.3C: `Money.toDisplayString()` is exact fixed-point formatting
// (see money.dart) — no `num`/`double` ever reaches this function.
String _money(Money value) => '\$${value.toDisplayString()}';

class _TicketTotalRow extends StatelessWidget {
  const _TicketTotalRow({
    required this.label,
    required this.value,
    this.big = false,
    this.muted = false,
  });
  final String label;
  final String value;
  final bool big;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              color: big ? palette.text : palette.textSecondary,
              fontWeight: big ? FontWeight.w800 : FontWeight.w600,
              fontSize: big ? 15 : 12,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: big
                  ? palette.action
                  : muted
                  ? palette.textMuted
                  : palette.text,
              fontWeight: big ? FontWeight.w800 : FontWeight.w600,
              fontSize: big ? 15 : 12,
            ),
          ),
        ],
      ),
    );
  }
}

/// Matches `.pay-grid`: Efectivo/Tarjeta/Transfer, Efectivo selected by
/// default (V1's own initial state, `#po-ef.active`) — no payment method
/// is actually selectable here.
/// TASK 12.5A: a real Efectivo/Tarjeta choice (Efectivo still V1's own
/// default-active option) — Cobrar now honors [selectedMethod] instead of
/// always running the card path (see `_PosCobrarButtonState._handleTap`).
/// Transfer has no backend `payment_method` counterpart at all (see
/// `packages/database/src/schema/payments.ts`) and stays exactly as
/// inert as every V1-faithful control this shell has not implemented yet
/// (TASK 12.2C) — selecting it is a no-op notice, never a silent switch
/// to some other method.
class _PosPayGrid extends StatelessWidget {
  const _PosPayGrid({required this.selectedMethod, required this.onSelect});
  final String selectedMethod;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: _PayOption(
          key: const Key('pos-pay-cash'),
          icon: Icons.payments_outlined,
          label: 'Efectivo',
          active: selectedMethod == 'cash',
          onTap: () => onSelect('cash'),
        ),
      ),
      const SizedBox(width: 4),
      Expanded(
        child: _PayOption(
          key: const Key('pos-pay-card'),
          icon: Icons.credit_card_outlined,
          label: 'Tarjeta',
          active: selectedMethod == 'card',
          onTap: () => onSelect('card'),
        ),
      ),
      const SizedBox(width: 4),
      Expanded(
        child: _PayOption(
          icon: Icons.swap_horiz_outlined,
          label: 'Transfer',
          onTap: () => _showReadOnlyNotice(context),
        ),
      ),
    ],
  );
}

class _PayOption extends StatelessWidget {
  const _PayOption({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        decoration: BoxDecoration(
          color: active ? palette.action : palette.surface,
          border: Border.all(
            color: active ? palette.action : palette.border,
            width: 1.5,
          ),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 15,
              color: active ? Colors.white : palette.textMuted,
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                color: active ? Colors.white : palette.textMuted,
                fontWeight: FontWeight.w700,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// TASK 12.3's explicit read-only limit — payment itself is not
/// implemented — is now narrower after TASK 12.4A.1/TASK 12.4B.1/TASK
/// 12.5A: tapping Cobrar creates a real, backend-priced sale and, for
/// [selectedMethod] `'cash'`, completes it for real through
/// `_submitCashSaleForPayment`; every other method still only reaches
/// `_submitSaleForPayment`'s card/terminal path (unchanged — Mercado
/// Pago setup remains paused, see ADR-0010/ADR-0011).
class _PosCobrarButton extends StatefulWidget {
  const _PosCobrarButton({
    // TASK 14.5 (Wave 3, Phase 4a): threaded so `_PosSaleState` can hold a
    // `GlobalKey<_PosCobrarButtonState>` and invoke the EXACT same
    // `_handleTap()` the on-screen button's `onPressed` calls from the F8
    // keyboard shortcut — never a second, shortcut-only checkout path.
    super.key,
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    this.heldSalesGateway = const EmptyPosHeldSalesGateway(),
    required this.branchId,
    required this.selectedMethod,
  });
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
  final PosHeldSalesGateway heldSalesGateway;
  final String selectedMethod;
  final String? branchId;

  @override
  State<_PosCobrarButton> createState() => _PosCobrarButtonState();
}

class _PosCobrarButtonState extends State<_PosCobrarButton> {
  bool _busy = false;
  String? _statusMessage;

  Future<void> _handleTap() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _statusMessage = null;
    });
    // TASK 13.2 (ADR-0019): a reward benefit already reduced this ticket's
    // own backend-derived total to exactly zero — neither Efectivo nor
    // Tarjeta applies; a `$0` cash tender is never fabricated through the
    // cash UI for this case. Checked before either branch below, exactly
    // like the cash session check that already runs before the cash
    // path's own network call.
    if (widget.saleSession.isNotEmpty && widget.saleSession.displayTotal.isZero) {
      await _submitZeroTotalSale(
        context,
        saleSession: widget.saleSession,
        salesGateway: widget.salesGateway,
        branchId: widget.branchId,
        heldSalesGateway: widget.heldSalesGateway,
        onBeforeReceiptDialog: () {
          if (mounted) setState(() => _busy = false);
        },
      );
      if (mounted) setState(() => _busy = false);
      return;
    }
    if (widget.selectedMethod == 'cash') {
      // TASK 12.7 Part N: checked as early as possible — before the sale
      // is even created, not only discovered from the eventual
      // `cash_session_required` rejection at confirmation time (the
      // backend still independently enforces this regardless, per
      // ADR-0014 §B5 — this is defense in depth for a fast, honest UI
      // message, never the only guard).
      final branchId = widget.branchId;
      if (branchId != null) {
        PosCashSession? openSession;
        var checkFailed = false;
        try {
          openSession = await widget.cashGateway.openSessionForBranch(branchId);
        } on Object {
          checkFailed = true;
        }
        if (!mounted) return;
        if (checkFailed) {
          setState(() => _busy = false);
          _showNotice(
            context,
            'No fue posible verificar el estado de la caja.',
          );
          return;
        }
        if (openSession == null) {
          setState(() => _busy = false);
          _showNotice(
            context,
            'Abre la caja para comenzar a cobrar en efectivo.',
          );
          return;
        }
      }
      // TASK 12.5A: the honest cash path — no provider, no terminal, no
      // poll loop; see `_submitCashSaleForPayment`.
      await _submitCashSaleForPayment(
        context,
        saleSession: widget.saleSession,
        salesGateway: widget.salesGateway,
        paymentsGateway: widget.paymentsGateway,
        branchId: widget.branchId,
        heldSalesGateway: widget.heldSalesGateway,
        onDialogAboutToOpen: () {
          if (mounted) setState(() => _busy = false);
        },
      );
    } else {
      await _submitSaleForPayment(
        context,
        saleSession: widget.saleSession,
        salesGateway: widget.salesGateway,
        paymentsGateway: widget.paymentsGateway,
        branchId: widget.branchId,
        heldSalesGateway: widget.heldSalesGateway,
        onStatusUpdate: (message) {
          if (mounted) setState(() => _statusMessage = message);
        },
      );
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [palette.action, palette.blue]),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Material(
        type: MaterialType.transparency,
        // TASK 14.5 (Wave 3, Phase 4a): a real, discoverable hint for the
        // F8 keyboard shortcut — never a hidden/invisible binding.
        child: Tooltip(
          message: 'Cobrar (F8)',
          child: InkWell(
          key: const Key('pos-ticket-cobrar'),
          borderRadius: BorderRadius.circular(12),
          onTap: _busy ? null : _handleTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (_busy)
                  const SizedBox(
                    width: 17,
                    height: 17,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                else
                  const Icon(Icons.check, color: Colors.white, size: 17),
                const SizedBox(width: 8),
                // `Flexible` + `FittedBox` — TASK 12.4B.1's status labels
                // ("Esperando pago en terminal", etc.) run longer than the
                // static "Cobrar — $X.XX" this button showed before, so
                // it now needs the same overflow-proofing the CLIENTE
                // card-payment button already used for its own longer
                // label.
                Flexible(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      // While a Point payment is in flight, this replaces
                      // the static label with the honest, backend-driven
                      // state ("Enviando a terminal" / "Esperando pago en
                      // terminal" / "Procesando" / "Pago aprobado" / ...)
                      // — never a fabricated one.
                      _statusMessage ??
                          'Cobrar — ${_money(widget.saleSession.displayTotal)}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          ),
        ),
      ),
    );
  }
}

class _TicketColumnLabel extends StatelessWidget {
  const _TicketColumnLabel(
    this.label, {
    required this.flex,
    this.center = false,
    this.alignRight = false,
  });
  final String label;
  final int flex;
  final bool center;
  final bool alignRight;

  @override
  Widget build(BuildContext context) => Expanded(
    flex: flex,
    child: Text(
      label,
      textAlign: center
          ? TextAlign.center
          : alignRight
          ? TextAlign.right
          : TextAlign.left,
      style: const TextStyle(
        color: Colors.white,
        fontSize: 10,
        fontWeight: FontWeight.w700,
        letterSpacing: .4,
      ),
    ),
  );
}

/// The real ticket line list — TASK 12.3. Matches V1's own `.t-item` row
/// structure (`renderTicket()`): name + "sku · precio/u" on the left, a
/// minus/quantity/plus stepper matching `.qty-stepper`/`.tqty`, the line
/// subtotal right-aligned, and a trash button — the same four elements
/// V1's own ticket line renders, not a new layout.
class _TicketLineList extends StatelessWidget {
  const _TicketLineList({required this.saleSession});
  final SaleSession saleSession;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final lines = saleSession.lines;
    return ListView.separated(
      key: const Key('pos-ticket-lines'),
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: lines.length,
      separatorBuilder: (context, index) =>
          Divider(height: 1, color: palette.border),
      itemBuilder: (context, index) => _TicketLineRow(
        line: lines[index],
        saleSession: saleSession,
        lineIndex: index,
      ),
    );
  }
}

/// TASK 12.9: one applied-discount tag for a single ticket line, derived
/// purely from [SaleSession.quote] (never computed locally) — `null` when
/// no quote exists yet or this line's own quoted `discount_total` is zero.
class _LineDiscountBadge {
  const _LineDiscountBadge(this.label, this.amount);
  final String label;
  final Money amount;
}

_LineDiscountBadge? _lineDiscountBadgeFor(SaleSession saleSession, int lineIndex) {
  final quote = saleSession.quote;
  if (quote == null) return null;
  if (lineIndex < 0 || lineIndex >= quote.lines.length) return null;
  final quoteLine = quote.lines[lineIndex];
  final Money discount;
  try {
    discount = Money.parse(quoteLine.discountTotal, quote.currencyCode);
  } on MoneyFormatException {
    return null;
  }
  if (!discount.isPositive) return null;
  var label = 'DESC.';
  for (final applied in quote.appliedDiscounts) {
    if (applied.lineIndex != lineIndex) continue;
    label = switch (applied.sourceType) {
      'promotion' => 'PROMO',
      'coupon' => 'CUPÓN',
      'reward' => 'RECOMPENSA',
      _ => 'DESC.',
    };
    break;
  }
  return _LineDiscountBadge(label, discount);
}

class _TicketLineRow extends StatelessWidget {
  const _TicketLineRow({
    required this.line,
    required this.saleSession,
    required this.lineIndex,
  });
  final SaleLine line;
  final SaleSession saleSession;
  final int lineIndex;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final badge = _lineDiscountBadgeFor(saleSession, lineIndex);
    return Padding(
      key: Key('pos-ticket-line-${line.productId}'),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        line.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: palette.text,
                        ),
                      ),
                    ),
                    if (badge != null) ...[
                      const SizedBox(width: 5),
                      _DiscountBadgeChip(key: Key('pos-ticket-line-discount-${line.productId}'), badge: badge),
                    ],
                  ],
                ),
                Text(
                  // TASK 14.3 (Wave 1, Part B.3): a weight-based line
                  // shows its real unit (e.g. "/kg"), never the generic
                  // "/u" a per-kilogram price would misrepresent.
                  '${line.sku} · ${_money(line.unitPrice)}/${line.isWeightBased ? line.unitOfMeasureCode : 'u'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 10, color: palette.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          _QtyStepper(line: line, saleSession: saleSession),
          const SizedBox(width: 6),
          SizedBox(
            width: 58,
            child: Text(
              _money(line.subtotal),
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 13,
                color: palette.text,
              ),
            ),
          ),
          IconButton(
            key: Key('pos-ticket-remove-${line.productId}'),
            tooltip: 'Eliminar producto',
            onPressed: () => saleSession.removeLine(line.productId),
            icon: Icon(Icons.delete_outline, size: 16, color: palette.error),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          ),
        ],
      ),
    );
  }
}

/// TASK 12.9: a small "PROMO"/"CUPÓN"/"DESC." tag next to a discounted
/// line's name — the backend's own per-line `discount_total`/
/// `applied_discounts`, never a client-invented label.
class _DiscountBadgeChip extends StatelessWidget {
  const _DiscountBadgeChip({super.key, required this.badge});
  final _LineDiscountBadge badge;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: palette.action.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        badge.label,
        style: TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w800,
          color: palette.action,
          letterSpacing: .3,
        ),
      ),
    );
  }
}

/// Matches V1's `.qty-stepper`/`.tqty`: a minus button, the quantity, and
/// a plus button. TASK 14.3 (Wave 1, Part B.3): a weight-based line has
/// no meaningful "+1 unit" — it shows its real decimal weight instead
/// (e.g. `"2.350 kg"`), with no stepper buttons.
class _QtyStepper extends StatelessWidget {
  const _QtyStepper({required this.line, required this.saleSession});
  final SaleLine line;
  final SaleSession saleSession;

  @override
  Widget build(BuildContext context) {
    if (line.isWeightBased) {
      return SizedBox(
        key: Key('pos-ticket-qty-${line.productId}'),
        width: 62,
        child: Text(
          line.displayQuantity,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 12,
            color: PosPalette.of(context).text,
          ),
        ),
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _QtyButton(
          buttonKey: Key('pos-ticket-qty-minus-${line.productId}'),
          icon: Icons.remove,
          onTap: () => saleSession.decreaseQuantity(line.productId),
        ),
        SizedBox(
          width: 26,
          child: Text(
            '${line.quantity}',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 13,
              color: PosPalette.of(context).text,
            ),
          ),
        ),
        _QtyButton(
          buttonKey: Key('pos-ticket-qty-plus-${line.productId}'),
          icon: Icons.add,
          onTap: () => saleSession.increaseQuantity(line.productId),
        ),
      ],
    );
  }
}

class _QtyButton extends StatelessWidget {
  const _QtyButton({
    required this.buttonKey,
    required this.icon,
    required this.onTap,
  });
  final Key buttonKey;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Material(
      key: buttonKey,
      color: palette.background,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: palette.border),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 22,
          height: 22,
          child: Icon(icon, size: 13, color: palette.action),
        ),
      ),
    );
  }
}

class _TicketEmptyState extends StatelessWidget {
  const _TicketEmptyState();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // Matches the canonical `#t-body` default markup exactly: an 84px
    // `--purple3` circle with a shopping-bag glyph and two sparkle
    // accents, then "Selecciona productos para comenzar". The separate
    // read-only disclosure lives in `_PosReadOnlyBar`/the info dialog, not
    // here, so this can mirror V1's copy verbatim.
    //
    // `.t-body{flex:1;overflow-y:auto}` in the canonical CSS — the body
    // scrolls rather than overflowing when the ticket panel is short (a
    // real desktop browser viewport shorter than ~720px was overflowing
    // this by up to 20+ px before this fix).
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: _buildIllustration(palette),
        ),
      ),
    );
  }

  Widget _buildIllustration(PosPalette palette) => Center(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 84,
            height: 84,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  decoration: BoxDecoration(
                    color: palette.actionTint,
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Icon(
                    Icons.shopping_bag_outlined,
                    size: 38,
                    color: palette.action,
                  ),
                ),
                Positioned(
                  top: -6,
                  right: -4,
                  child: Icon(
                    Icons.auto_awesome,
                    size: 16,
                    color: palette.action,
                  ),
                ),
                Positioned(
                  bottom: 0,
                  left: -10,
                  child: Icon(
                    Icons.auto_awesome,
                    size: 12,
                    color: palette.action.withValues(alpha: .6),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'Selecciona productos\npara comenzar',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: palette.textMuted,
              fontSize: 13,
              height: 1.5,
            ),
          ),
        ],
      ),
    ),
  );
}

class _TicketBar extends StatelessWidget {
  const _TicketBar({required this.saleSession, required this.ticketSurface});
  final SaleSession saleSession;
  // TASK 12.3 addendum: opens whichever surface `_PosSaleBody` is
  // currently showing (the CAJERO panel or the CLIENTE preview) — the
  // narrow-layout bottom sheet never diverges from the wide layout.
  final Widget ticketSurface;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return ListenableBuilder(
      listenable: saleSession,
      builder: (context, _) => InkWell(
        key: const Key('pos-ticket-bar'),
        borderRadius: BorderRadius.circular(14),
        onTap: () => showModalBottomSheet<void>(
          context: context,
          backgroundColor: palette.surface,
          builder: (context) =>
              SafeArea(child: SizedBox(height: 640, child: ticketSurface)),
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: palette.surface,
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: .06),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            children: [
              Icon(Icons.receipt_long_outlined, color: palette.blueDeep),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  saleSession.isEmpty
                      ? 'Ticket (vacío)'
                      : 'Ticket · ${saleSession.totalUnits} '
                            '${saleSession.totalUnits == 1 ? 'artículo' : 'artículos'} · '
                            '${_money(saleSession.displayTotal)}',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: palette.text,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Icon(Icons.expand_less, color: palette.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

class _Products extends StatefulWidget {
  const _Products({
    required this.state,
    required this.allowed,
    required this.onRefresh,
  });
  final PosReadState<PosProduct> state;
  final bool allowed;
  final VoidCallback onRefresh;

  @override
  State<_Products> createState() => _ProductsState();
}

class _ProductsState extends State<_Products> {
  String query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.state.items
        .where(
          (item) => '${item.code} ${item.name}'.toLowerCase().contains(
            query.toLowerCase(),
          ),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Productos',
          description: 'Catálogo real en modo de solo lectura.',
          action: _ReadOnlyButton(onPressed: widget.onRefresh),
        ),
        TextField(
          key: const Key('pos-product-search'),
          onChanged: (value) => setState(() => query = value),
          decoration: const InputDecoration(
            hintText: 'Buscar producto o código',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        const SizedBox(height: 12),
        if (!widget.allowed)
          const _PermissionState()
        else
          _ReadState<PosProduct>(
            state: widget.state,
            emptyMessage: 'No hay productos disponibles.',
            onRetry: widget.onRefresh,
            ready: (_) => _ProductGrid(items: filtered),
          ),
      ],
    );
  }
}

class _ProductGrid extends StatelessWidget {
  const _ProductGrid({required this.items});
  final List<PosProduct> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const _EmptyState(message: 'Sin resultados para la búsqueda.');
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 1200
            ? 5
            : constraints.maxWidth >= 900
            ? 4
            : constraints.maxWidth >= 560
            ? 3
            : 2;
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          childAspectRatio: .98,
          children: items.map((item) => _ProductCard(item: item)).toList(),
        );
      },
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.item});
  final PosProduct item;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      padding: const EdgeInsets.all(10),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: palette.blueTint,
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.inventory_2_outlined, color: palette.blueDeep),
          ),
          const SizedBox(height: 9),
          Text(
            item.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: palette.text,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            item.code,
            style: TextStyle(color: palette.textMuted, fontSize: 10),
          ),
          const SizedBox(height: 7),
          _StatusChip(label: item.status),
        ],
      ),
    );
  }
}

class _Inventory extends StatelessWidget {
  const _Inventory({
    required this.state,
    required this.allowed,
    required this.onRefresh,
    required this.onOpenDirectPurchase,
  });
  final PosReadState<PosInventoryBalance> state;
  final bool allowed;
  final VoidCallback onRefresh;
  // TASK 14.3 (Wave 1, Part C): "Compra Directa" (direct purchase / quick
  // restock) — navigates to the real `PosModule.purchases` screen.
  final VoidCallback onOpenDirectPurchase;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _SectionHeader(
        title: 'Inventario',
        description:
            'Balances autorizados. Ningún control modifica existencias.',
        action: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            OutlinedButton.icon(
              key: const Key('pos-inventory-direct-purchase'),
              onPressed: onOpenDirectPurchase,
              icon: const Icon(Icons.add_shopping_cart_outlined, size: 17),
              label: const Text('Compra Directa'),
            ),
            const SizedBox(width: 8),
            _ReadOnlyButton(onPressed: onRefresh),
          ],
        ),
      ),
      if (!allowed)
        const _PermissionState()
      else
        _ReadState<PosInventoryBalance>(
          state: state,
          emptyMessage: 'No hay balances de inventario.',
          onRetry: onRefresh,
          ready: (items) => _InventoryTable(items: items),
        ),
    ],
  );
}

class _InventoryTable extends StatelessWidget {
  const _InventoryTable({required this.items});
  final List<PosInventoryBalance> items;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      padding: EdgeInsets.zero,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingTextStyle: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w800,
          ),
          columns: const [
            DataColumn(label: Text('Variante')),
            DataColumn(label: Text('Ubicación')),
            DataColumn(label: Text('Existencia'), numeric: true),
            DataColumn(label: Text('Reservado'), numeric: true),
            DataColumn(label: Text('En tránsito'), numeric: true),
          ],
          rows: items
              .map(
                (item) => DataRow(
                  cells: [
                    DataCell(Text(_compactId(item.variantId))),
                    DataCell(Text(_compactId(item.locationId))),
                    DataCell(Text(item.onHand)),
                    DataCell(Text(item.reserved)),
                    DataCell(Text(item.inTransit)),
                  ],
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}

// --- TASK 14.3 (Wave 1, Part B.1): Ventas Suspendidas ------------------

enum _HeldSalesPhase { loading, ready, empty, failure }

class _HeldSales extends StatefulWidget {
  const _HeldSales({
    required this.context,
    required this.controller,
    required this.saleSession,
    required this.heldSalesGateway,
    required this.onNavigateToPos,
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  final SaleSession saleSession;
  final PosHeldSalesGateway heldSalesGateway;
  final VoidCallback onNavigateToPos;

  @override
  State<_HeldSales> createState() => _HeldSalesState();
}

class _HeldSalesState extends State<_HeldSales> {
  _HeldSalesPhase _phase = _HeldSalesPhase.loading;
  List<PosHeldSaleCart> _items = const [];
  // TASK 14.4 (Wave 2, Part A.2) — one cursor per status, since the
  // backend's own `GET /held-sale-carts` querystring only ever accepts a
  // single `status` value (never an array — see `held-sales.routes.ts`'s
  // real query contract). Both `held` and `resuming` carts are fetched and
  // merged so a claimed (`resuming`) cart is never silently hidden.
  String? _heldCursor;
  String? _resumingCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  // Only one row's action may be in flight at a time — a real network
  // call, never a fake instant success.
  String? _busyCartId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  String? get _branchId => widget.context.companyWideAccess ? null : widget.context.session.branchId;

  Future<void> _load() async {
    setState(() {
      _phase = _HeldSalesPhase.loading;
      _errorMessage = null;
    });
    try {
      final results = await Future.wait([
        widget.heldSalesGateway.listCarts(
          filter: PosHeldSaleCartListFilter(status: 'held', branchId: _branchId),
        ),
        widget.heldSalesGateway.listCarts(
          filter: PosHeldSaleCartListFilter(status: 'resuming', branchId: _branchId),
        ),
      ]);
      if (!mounted) return;
      final held = results[0];
      final resuming = results[1];
      setState(() {
        _items = [...held.items, ...resuming.items];
        _heldCursor = held.nextCursor;
        _resumingCursor = resuming.nextCursor;
        _phase = _items.isEmpty ? _HeldSalesPhase.empty : _HeldSalesPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _HeldSalesPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _HeldSalesPhase.failure;
        _errorMessage = 'No fue posible cargar las ventas suspendidas.';
      });
    }
  }

  Future<void> _loadMore() async {
    final heldCursor = _heldCursor;
    final resumingCursor = _resumingCursor;
    if ((heldCursor == null && resumingCursor == null) || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final heldPage = heldCursor == null
          ? null
          : await widget.heldSalesGateway.listCarts(
              filter: PosHeldSaleCartListFilter(status: 'held', branchId: _branchId),
              cursor: heldCursor,
            );
      final resumingPage = resumingCursor == null
          ? null
          : await widget.heldSalesGateway.listCarts(
              filter: PosHeldSaleCartListFilter(status: 'resuming', branchId: _branchId),
              cursor: resumingCursor,
            );
      if (!mounted) return;
      setState(() {
        if (heldPage != null) {
          _items = [..._items, ...heldPage.items];
          _heldCursor = heldPage.nextCursor;
        }
        if (resumingPage != null) {
          _items = [..._items, ...resumingPage.items];
          _resumingCursor = resumingPage.nextCursor;
        }
        _loadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  /// Mirrors `held-sales.service.ts`'s own `discardCart` gate: the cart's
  /// own creator, or an actor with `sale.cancel`, may discard it — never
  /// shown as available when it would just 403.
  bool _canDiscard(PosHeldSaleCart cart) =>
      cart.createdBy == widget.context.session.userId ||
      widget.context.permissions.contains('sale.cancel');

  /// TASK 14.4 (Wave 2, Part A.3) — mirrors `held-sales.service.ts`'s own
  /// `releaseCart` gate EXACTLY: only the cart's own claimant, or an actor
  /// with `sale.cancel`, may release it — never looser, never stricter.
  bool _canRelease(PosHeldSaleCart cart) =>
      cart.claimedBy == widget.context.session.userId ||
      widget.context.permissions.contains('sale.cancel');

  Future<void> _resume(PosHeldSaleCart cart) async {
    if (_busyCartId != null) return;
    if (widget.saleSession.isNotEmpty) {
      _showNotice(context, 'Termina o suspende el ticket actual antes de restaurar otro.');
      return;
    }
    setState(() => _busyCartId = cart.id);
    try {
      if (widget.controller.products.phase == PosReadPhase.idle) {
        await widget.controller.loadProducts();
      }
      if (widget.controller.balances.phase == PosReadPhase.idle) {
        await widget.controller.loadBalances(branchId: widget.context.session.branchId);
      }
      // TASK 14.3: the real recovery call — hands back only the cart's
      // raw items; every price/name below is re-resolved fresh through
      // the currently-loaded catalog, never trusted from this response.
      final resumed = await widget.heldSalesGateway.resumeCart(cart.id);
      if (!mounted) return;
      final skipped = widget.saleSession.resumeFromHeldCart(
        cartId: resumed.id,
        items: resumed.items,
        products: widget.controller.products.items,
        balances: widget.controller.balances.items,
      );
      if (skipped.isNotEmpty) {
        _showNotice(
          context,
          '${skipped.length} artículo(s) de la venta suspendida ya no están disponibles y no se repusieron.',
        );
      }
      await _load();
      if (!mounted) return;
      widget.onNavigateToPos();
    } on ApiException catch (error) {
      if (!mounted) return;
      _showNotice(context, error.failure.message);
    } on Object {
      if (!mounted) return;
      _showNotice(context, 'No fue posible restaurar la venta suspendida.');
    } finally {
      if (mounted) setState(() => _busyCartId = null);
    }
  }

  /// TASK 14.4 (Wave 2, Part A.3) — "Liberar": the explicit, audited
  /// recovery action for an abandoned claim (`resuming -> held`), making
  /// the cart available to be claimed again. Follows the exact same
  /// `_busyCartId`-guard / confirmation-dialog / `ApiException`+`on Object`
  /// catch-pair shape as `_resume`/`_discard` above.
  Future<void> _release(PosHeldSaleCart cart) async {
    if (_busyCartId != null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Liberar venta suspendida'),
        content: Text(
          '¿Liberar la venta suspendida ${_compactId(cart.id)}'
          '${cart.label == null ? '' : ' («${cart.label}»)'}? '
          'Quedará disponible para que cualquier cajero autorizado la reclame de nuevo.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const Key('pos-held-sale-release-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Liberar'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busyCartId = cart.id);
    try {
      await widget.heldSalesGateway.releaseCart(cart.id);
      if (!mounted) return;
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      _showNotice(context, error.failure.message);
    } on Object {
      if (!mounted) return;
      _showNotice(context, 'No fue posible liberar la venta suspendida.');
    } finally {
      if (mounted) setState(() => _busyCartId = null);
    }
  }

  Future<void> _discard(PosHeldSaleCart cart) async {
    if (_busyCartId != null) return;
    // A real, slightly destructive action — confirmed explicitly, never
    // discarded on a single accidental tap.
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Descartar venta suspendida'),
        content: Text(
          '¿Descartar la venta suspendida ${_compactId(cart.id)}'
          '${cart.label == null ? '' : ' («${cart.label}»)'}? '
          'Esta acción no se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const Key('pos-held-sale-discard-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(backgroundColor: PosPalette.of(context).error),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busyCartId = cart.id);
    try {
      await widget.heldSalesGateway.discardCart(id: cart.id);
      if (!mounted) return;
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      _showNotice(context, error.failure.message);
    } on Object {
      if (!mounted) return;
      _showNotice(context, 'No fue posible descartar la venta suspendida.');
    } finally {
      if (mounted) setState(() => _busyCartId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final allowed = widget.context.permissions.contains('held_sale.manage');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Ventas Suspendidas',
          description: allowed && (_phase == _HeldSalesPhase.ready || _phase == _HeldSalesPhase.empty)
              ? '${_items.length} venta(s) suspendida(s) actualmente.'
              : 'Tickets pausados por un cajero, listos para restaurarse.',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (!allowed)
          const _PermissionState()
        else
          switch (_phase) {
            _HeldSalesPhase.loading => const _LoadingState(),
            _HeldSalesPhase.empty => const _EmptyState(message: 'No hay ventas suspendidas.'),
            _HeldSalesPhase.failure => _FailureState(
              message: _errorMessage ?? 'No fue posible cargar las ventas suspendidas.',
              onRetry: () => unawaited(_load()),
            ),
            _HeldSalesPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _HeldSalesTable(
                  items: _items,
                  busyCartId: _busyCartId,
                  canDiscard: _canDiscard,
                  canRelease: _canRelease,
                  onResume: _resume,
                  onRelease: _release,
                  onDiscard: _discard,
                ),
                if (_heldCursor != null || _resumingCursor != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: OutlinedButton.icon(
                        key: const Key('pos-held-sales-load-more'),
                        onPressed: _loadingMore ? null : () => unawaited(_loadMore()),
                        icon: _loadingMore
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.expand_more),
                        label: const Text('Cargar más'),
                      ),
                    ),
                  ),
              ],
            ),
          },
      ],
    );
  }
}

String _formatHeldSaleTimestamp(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

/// TASK 14.4 (Wave 2, Part A.2) — a held-sale cart's real status, rendered
/// distinctly for `held` (available) vs `resuming` (claimed by someone) —
/// mirrors `_StatusChip`'s own Container/pill styling exactly, but needs a
/// 3rd, non-boolean state the shared, file-wide `_StatusChip` doesn't
/// model (that widget only ever distinguishes "active" from everything
/// else). A `resuming` cart is never silently hidden or left
/// unexplained — the tooltip names who claimed it and since when.
class _HeldSaleStatusChip extends StatelessWidget {
  const _HeldSaleStatusChip({required this.cart});
  final PosHeldSaleCart cart;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final resuming = cart.isResuming;
    final color = resuming ? palette.warning : palette.success;
    final label = resuming ? 'reclamada' : 'disponible';
    return Tooltip(
      message: resuming
          ? 'Reclamada por ${cart.claimedBy ?? '—'} desde '
                '${cart.claimedAt == null ? '—' : _formatHeldSaleTimestamp(cart.claimedAt!)}.'
          : 'Disponible para restaurar.',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800),
        ),
      ),
    );
  }
}

class _HeldSalesTable extends StatelessWidget {
  const _HeldSalesTable({
    required this.items,
    required this.busyCartId,
    required this.canDiscard,
    required this.canRelease,
    required this.onResume,
    required this.onRelease,
    required this.onDiscard,
  });
  final List<PosHeldSaleCart> items;
  final String? busyCartId;
  final bool Function(PosHeldSaleCart) canDiscard;
  final bool Function(PosHeldSaleCart) canRelease;
  final ValueChanged<PosHeldSaleCart> onResume;
  final ValueChanged<PosHeldSaleCart> onRelease;
  final ValueChanged<PosHeldSaleCart> onDiscard;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      padding: EdgeInsets.zero,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingTextStyle: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w800),
          columns: const [
            DataColumn(label: Text('Ticket')),
            DataColumn(label: Text('Etiqueta')),
            DataColumn(label: Text('Artículos'), numeric: true),
            DataColumn(label: Text('Estado')),
            DataColumn(label: Text('Suspendida')),
            DataColumn(label: Text('Acciones')),
          ],
          rows: items.map((cart) {
            final busy = busyCartId == cart.id;
            final canDiscardThis = canDiscard(cart);
            final canReleaseThis = cart.isResuming && canRelease(cart);
            return DataRow(
              key: ValueKey('pos-held-sale-row-${cart.id}'),
              cells: [
                DataCell(Text(_compactId(cart.id))),
                DataCell(Text(cart.label ?? '—')),
                DataCell(Text('${cart.items.length}')),
                DataCell(_HeldSaleStatusChip(cart: cart)),
                DataCell(Text(_formatHeldSaleTimestamp(cart.createdAt))),
                DataCell(
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Tooltip(
                        message: cart.isHeld
                            ? 'Restaurar'
                            : 'Esta venta ya fue reclamada — solo una venta '
                                  'disponible (held) puede restaurarse.',
                        child: TextButton(
                          key: Key('pos-held-sale-resume-${cart.id}'),
                          onPressed: busy || !cart.isHeld ? null : () => onResume(cart),
                          child: busy
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Text('Restaurar'),
                        ),
                      ),
                      const SizedBox(width: 4),
                      // TASK 14.4 (Wave 2, Part A.3) — "Liberar", only for
                      // a `resuming` cart, gated by the exact same rule
                      // `held-sales.service.ts`'s own `releaseCart`
                      // enforces server-side: the cart's own claimant, or
                      // an actor with `sale.cancel`.
                      Tooltip(
                        message: !cart.isResuming
                            ? 'Solo una venta reclamada (en curso) puede liberarse.'
                            : canReleaseThis
                            ? 'Liberar'
                            : 'Solo quien reclamó esta venta, o un actor con '
                                  'permiso sale.cancel, puede liberarla.',
                        child: TextButton(
                          key: Key('pos-held-sale-release-${cart.id}'),
                          onPressed: busy || !canReleaseThis ? null : () => onRelease(cart),
                          child: const Text('Liberar'),
                        ),
                      ),
                      const SizedBox(width: 4),
                      Tooltip(
                        message: canDiscardThis
                            ? 'Descartar'
                            : 'Solo el cajero que suspendió esta venta, o un actor con '
                                  'permiso sale.cancel, puede descartarla.',
                        child: TextButton(
                          key: Key('pos-held-sale-discard-${cart.id}'),
                          onPressed: busy || !canDiscardThis ? null : () => onDiscard(cart),
                          style: TextButton.styleFrom(foregroundColor: palette.error),
                          child: const Text('Descartar'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }
}

// --- TASK 14.3 (Wave 1, Part C): Compra Directa / quick restock --------

enum _DirectPurchaseHistoryPhase { loading, ready, empty, failure }

class _DirectPurchases extends StatefulWidget {
  const _DirectPurchases({
    required this.context,
    required this.controller,
    required this.purchasingGateway,
    // TASK 14.4 (Wave 2, Part C.2): optional real-supplier picker for the
    // "Compra Directa" form — see `_DirectPurchaseForm`'s own doc comment.
    // Defaults to `EmptyPosSuppliersGateway` (an empty picker, never a
    // crash) so this stays additive for every existing call site that has
    // not yet threaded a real `PosSuppliersGateway` down from
    // `PosShell`/`_Content` — see this wave's own report for the exact
    // wiring the orchestrator still needs to apply centrally.
    this.suppliersGateway = const EmptyPosSuppliersGateway(),
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPurchasingGateway purchasingGateway;
  final PosSuppliersGateway suppliersGateway;

  @override
  State<_DirectPurchases> createState() => _DirectPurchasesState();
}

class _DirectPurchasesState extends State<_DirectPurchases> {
  _DirectPurchaseHistoryPhase _phase = _DirectPurchaseHistoryPhase.loading;
  List<PosDirectPurchase> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    if (widget.controller.products.phase == PosReadPhase.idle) {
      // Deferred to a microtask — `controller` is also observed by an
      // ancestor `AnimatedBuilder` (`_Content`) that is still mid-build
      // the very first time this screen mounts; calling
      // `notifyListeners()` synchronously here would try to rebuild that
      // ancestor while it is still building this same frame.
      unawaited(Future.microtask(() => widget.controller.loadProducts()));
    }
    unawaited(_load());
  }

  PosDirectPurchaseListFilter get _filter => PosDirectPurchaseListFilter(
    branchId: widget.context.companyWideAccess ? null : widget.context.session.branchId,
  );

  Future<void> _load() async {
    setState(() {
      _phase = _DirectPurchaseHistoryPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.purchasingGateway.listDirectPurchases(filter: _filter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _items.isEmpty ? _DirectPurchaseHistoryPhase.empty : _DirectPurchaseHistoryPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _DirectPurchaseHistoryPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _DirectPurchaseHistoryPhase.failure;
        _errorMessage = 'No fue posible cargar el historial de compras.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.purchasingGateway.listDirectPurchases(filter: _filter, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _loadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = widget.context.permissions.contains('purchase.create');
    final canRead = widget.context.permissions.contains('purchase.read');
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Compras',
          description: 'Compra Directa: registra existencia recién llegada y ya pagada.',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (canCreate)
          _DirectPurchaseForm(
            context: widget.context,
            controller: widget.controller,
            purchasingGateway: widget.purchasingGateway,
            suppliersGateway: widget.suppliersGateway,
            onCreated: () => unawaited(_load()),
          )
        else
          const _PermissionState(),
        const SizedBox(height: 20),
        Text(
          'Historial',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: palette.text),
        ),
        const SizedBox(height: 10),
        if (!canRead)
          const _PermissionState()
        else
          switch (_phase) {
            _DirectPurchaseHistoryPhase.loading => const _LoadingState(),
            _DirectPurchaseHistoryPhase.empty => const _EmptyState(
              message: 'No hay compras directas registradas.',
            ),
            _DirectPurchaseHistoryPhase.failure => _FailureState(
              message: _errorMessage ?? 'No fue posible cargar el historial de compras.',
              onRetry: () => unawaited(_load()),
            ),
            _DirectPurchaseHistoryPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _DirectPurchaseTable(items: _items),
                if (_nextCursor != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: OutlinedButton.icon(
                        key: const Key('pos-direct-purchases-load-more'),
                        onPressed: _loadingMore ? null : () => unawaited(_loadMore()),
                        icon: _loadingMore
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.expand_more),
                        label: const Text('Cargar más'),
                      ),
                    ),
                  ),
              ],
            ),
          },
      ],
    );
  }
}

/// The "Compra Directa" form itself — product/variant picker, quantity,
/// unit cost (live total = quantity × unit cost via the real
/// `Money.multiplyByDecimalQuantity` fixed-point utility), an optional
/// REAL supplier link (TASK 14.4 Wave 2 Part C.2 — a searchable picker
/// sourced from [suppliersGateway], alongside the pre-existing free-text
/// supplier name field) plus purchase date and notes. On success, shows
/// the REAL resulting stock level from the response (never a fabricated
/// confirmation) when the backend included one.
class _DirectPurchaseForm extends StatefulWidget {
  const _DirectPurchaseForm({
    required this.context,
    required this.controller,
    required this.purchasingGateway,
    required this.onCreated,
    this.suppliersGateway = const EmptyPosSuppliersGateway(),
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPurchasingGateway purchasingGateway;
  final VoidCallback onCreated;
  // TASK 14.4 (Wave 2, Part C.2): optional — defaults to an empty picker
  // (no options, never a crash) so every pre-existing call site that has
  // not yet threaded a real `PosSuppliersGateway` down keeps working
  // exactly as before (the free-text `_supplierController` field is
  // untouched either way).
  final PosSuppliersGateway suppliersGateway;

  @override
  State<_DirectPurchaseForm> createState() => _DirectPurchaseFormState();
}

class _DirectPurchaseFormState extends State<_DirectPurchaseForm> {
  PosProduct? _selectedProduct;
  final _quantityController = TextEditingController();
  final _unitCostController = TextEditingController();
  final _supplierController = TextEditingController();
  final _notesController = TextEditingController();
  DateTime _purchaseDate = DateTime.now();
  bool _submitting = false;
  String? _error;
  PosDirectPurchase? _lastCreated;
  // TASK 14.4 (Wave 2, Part C.2): the optional real supplier link — `null`
  // keeps the pre-existing free-text `_supplierController` behavior
  // completely unchanged; a non-null value freezes that supplier's
  // CURRENT real name server-side at write time (see
  // `CreateDirectPurchaseInput.supplierId`'s own doc comment) and
  // disables the free-text field in the UI so the two never compete.
  PosSupplier? _selectedSupplier;
  List<PosSupplier> _supplierOptions = const [];

  @override
  void initState() {
    super.initState();
    unawaited(_loadSuppliers());
  }

  Future<void> _loadSuppliers() async {
    try {
      final page = await widget.suppliersGateway.listSuppliers(status: 'active');
      if (!mounted) return;
      setState(() => _supplierOptions = page.items);
    } on Object {
      // Leaves the picker honestly empty on failure — the pre-existing
      // free-text field remains a complete fallback, never a fabricated
      // option list.
    }
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _unitCostController.dispose();
    _supplierController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Money? get _unitCostMoney {
    final raw = _unitCostController.text.trim();
    if (raw.isEmpty) return null;
    try {
      return Money.parse(raw, 'MXN');
    } on MoneyFormatException {
      return null;
    }
  }

  /// `null` for empty/malformed input — never a fabricated fallback.
  Money? get _lineTotal {
    final unitCost = _unitCostMoney;
    final quantity = _quantityController.text.trim();
    if (unitCost == null || quantity.isEmpty) return null;
    try {
      return unitCost.multiplyByDecimalQuantity(quantity);
    } on MoneyFormatException {
      return null;
    }
  }

  String _isoDate(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _purchaseDate,
      firstDate: DateTime(2000),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _purchaseDate = picked);
  }

  Future<void> _submit() async {
    final product = _selectedProduct;
    final variantId = product?.defaultVariantId;
    final branchId = widget.context.session.branchId;
    if (product == null || variantId == null) {
      setState(() => _error = 'Selecciona un producto.');
      return;
    }
    if (branchId == null) {
      setState(() => _error = 'Esta sesión no tiene una sucursal asignada.');
      return;
    }
    final quantity = _quantityController.text.trim();
    final parsedQuantity = double.tryParse(quantity);
    if (quantity.isEmpty || parsedQuantity == null || parsedQuantity <= 0) {
      setState(() => _error = 'Captura una cantidad válida, mayor a cero.');
      return;
    }
    final unitCost = _unitCostMoney;
    if (unitCost == null) {
      setState(() => _error = 'Captura un costo unitario válido.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final created = await widget.purchasingGateway.createDirectPurchase(
        branchId: branchId,
        // A selected real supplier takes over entirely — the backend
        // ignores `supplierName` whenever `supplierId` is set anyway (see
        // `CreateDirectPurchaseInput.supplierId`'s own doc comment), so
        // this never even sends the stale free-text alongside it.
        supplierName: _selectedSupplier != null
            ? null
            : (_supplierController.text.trim().isEmpty ? null : _supplierController.text.trim()),
        supplierId: _selectedSupplier?.id,
        productVariantId: variantId,
        quantity: quantity,
        unitCost: unitCost.toApiString(),
        currencyCode: 'MXN',
        purchaseDate: _isoDate(_purchaseDate),
        notes: _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _lastCreated = created;
        _selectedProduct = null;
        _selectedSupplier = null;
        _quantityController.clear();
        _unitCostController.clear();
        _supplierController.clear();
        _notesController.clear();
        _purchaseDate = DateTime.now();
      });
      widget.onCreated();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = 'No fue posible registrar la compra.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final products = widget.controller.products.items
        .where((product) => product.defaultVariantId != null)
        .toList(growable: false);
    final total = _lineTotal;
    final lastCreated = _lastCreated;
    return _PosCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (lastCreated != null) ...[
            Container(
              key: const Key('pos-direct-purchase-success'),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: palette.success.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                lastCreated.movement?.currentQuantityOnHand == null
                    ? 'Compra registrada.'
                    : 'Compra registrada. Existencia actual: '
                          '${lastCreated.movement!.currentQuantityOnHand}.',
              ),
            ),
            const SizedBox(height: 10),
          ],
          DropdownButtonFormField<PosProduct>(
            key: const Key('pos-direct-purchase-product'),
            initialValue: _selectedProduct,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Producto / variante'),
            items: [
              for (final product in products)
                DropdownMenuItem(
                  value: product,
                  child: Text('${product.name} (${product.sku ?? product.code})'),
                ),
            ],
            onChanged: (value) => setState(() => _selectedProduct = value),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pos-direct-purchase-quantity'),
                  controller: _quantityController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Cantidad'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  key: const Key('pos-direct-purchase-unit-cost'),
                  controller: _unitCostController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Costo unitario (MXN)'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // TASK 14.4 (Wave 2, Part C.2): an optional REAL supplier link,
          // alongside (never replacing) the pre-existing free-text field
          // below — a searchable picker over `PosSuppliersGateway.list()`.
          // Picking a real supplier here freezes ITS CURRENT name
          // server-side at write time (see `CreateDirectPurchaseInput.
          // supplierId`'s own doc comment) — the copy below says so
          // explicitly, and the free-text field is disabled while a real
          // supplier stays selected so the two never silently compete.
          Autocomplete<PosSupplier>(
            key: const Key('pos-direct-purchase-supplier-picker'),
            displayStringForOption: (supplier) => supplier.name,
            optionsBuilder: (textEditingValue) {
              final query = textEditingValue.text.trim().toLowerCase();
              if (query.isEmpty) return _supplierOptions;
              return _supplierOptions.where((supplier) => supplier.name.toLowerCase().contains(query));
            },
            onSelected: (supplier) => setState(() {
              _selectedSupplier = supplier;
              _supplierController.clear();
            }),
            fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) => TextField(
              key: const Key('pos-direct-purchase-supplier-search'),
              controller: controller,
              focusNode: focusNode,
              decoration: const InputDecoration(labelText: 'Proveedor registrado (opcional, buscar)'),
            ),
          ),
          if (_selectedSupplier != null) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: palette.actionTint, borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Se usará el nombre actual del proveedor «${_selectedSupplier!.name}» '
                      '(se congela al guardar la compra).',
                      key: const Key('pos-direct-purchase-supplier-selected'),
                      style: TextStyle(color: palette.textSecondary, fontSize: 12),
                    ),
                  ),
                  IconButton(
                    key: const Key('pos-direct-purchase-supplier-clear'),
                    tooltip: 'Quitar proveedor registrado',
                    icon: const Icon(Icons.close, size: 16),
                    onPressed: () => setState(() => _selectedSupplier = null),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          TextField(
            key: const Key('pos-direct-purchase-supplier'),
            controller: _supplierController,
            enabled: _selectedSupplier == null,
            decoration: InputDecoration(
              labelText: 'Proveedor (texto libre, opcional)',
              helperText: _selectedSupplier == null
                  ? null
                  : 'Deshabilitado: ya hay un proveedor registrado seleccionado arriba.',
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('pos-direct-purchase-date'),
            onPressed: _pickDate,
            icon: const Icon(Icons.calendar_today_outlined, size: 16),
            label: Text(_isoDate(_purchaseDate)),
          ),
          const SizedBox(height: 10),
          TextField(
            key: const Key('pos-direct-purchase-notes'),
            controller: _notesController,
            decoration: const InputDecoration(labelText: 'Notas (opcional)'),
            maxLines: 2,
          ),
          const SizedBox(height: 10),
          Text(
            'Total: ${total == null ? '—' : _money(total)}',
            key: const Key('pos-direct-purchase-total'),
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
          ),
          if (_error != null) ...[
            const SizedBox(height: 6),
            Text(_error!, style: TextStyle(color: palette.error)),
          ],
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              key: const Key('pos-direct-purchase-submit'),
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.check),
              label: const Text('Registrar compra'),
            ),
          ),
        ],
      ),
    );
  }
}

class _DirectPurchaseTable extends StatelessWidget {
  const _DirectPurchaseTable({required this.items});
  final List<PosDirectPurchase> items;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      padding: EdgeInsets.zero,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingTextStyle: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w800),
          columns: const [
            DataColumn(label: Text('Fecha')),
            DataColumn(label: Text('Variante')),
            DataColumn(label: Text('Proveedor')),
            DataColumn(label: Text('Cantidad'), numeric: true),
            DataColumn(label: Text('Costo unitario'), numeric: true),
            DataColumn(label: Text('Total'), numeric: true),
          ],
          rows: items
              .map(
                (item) => DataRow(
                  key: ValueKey('pos-direct-purchase-row-${item.id}'),
                  cells: [
                    DataCell(Text(item.purchaseDate)),
                    DataCell(Text(_compactId(item.productVariantId))),
                    DataCell(Text(item.supplierName ?? '—')),
                    DataCell(Text(item.quantity)),
                    DataCell(Text(_formatMoney(item.unitCost, item.currencyCode))),
                    DataCell(Text(_formatMoney(item.totalCost, item.currencyCode))),
                  ],
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}

class _Users extends StatelessWidget {
  const _Users({
    required this.state,
    required this.allowed,
    required this.onRefresh,
  });
  final PosReadState<PosUser> state;
  final bool allowed;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _SectionHeader(
        title: 'Usuarios',
        description: 'Identidades y memberships de la empresa, solo lectura.',
        action: _ReadOnlyButton(onPressed: onRefresh),
      ),
      if (!allowed)
        const _PermissionState()
      else
        _ReadState<PosUser>(
          state: state,
          emptyMessage: 'No hay usuarios disponibles.',
          onRetry: onRefresh,
          ready: (items) => Column(
            children: items.map((item) => _UserRow(item: item)).toList(),
          ),
        ),
    ],
  );
}

class _UserRow extends StatelessWidget {
  const _UserRow({required this.item});
  final PosUser item;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: _PosCard(
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: palette.action,
              child: Text(
                item.displayName.isEmpty
                    ? '?'
                    : item.displayName[0].toUpperCase(),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.displayName,
                    style: TextStyle(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    item.email,
                    style: TextStyle(
                      color: palette.textSecondary,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            _StatusChip(label: item.membershipStatus),
          ],
        ),
      ),
    );
  }
}

// TASK 12.6 Part C: Historial de ventas — real, backend-paginated sale
// history. Deliberately self-contained (its own gateway calls/loading
// state) rather than folded into `PosReadController`'s simpler
// load-once-and-refresh state machine: filters/pagination/detail here are
// genuinely interactive, closer to `_ReceiptSuccessDialogState`'s own
// pattern than to `_Products`/`_Inventory`'s read-once lists.
enum _SalesHistoryPhase { loading, ready, empty, failure }

class _SalesHistory extends StatefulWidget {
  const _SalesHistory({
    required this.context,
    required this.salesGateway,
    required this.refundsGateway,
    required this.onNavigateToCaja,
  });
  final AuthenticatedContext context;
  final PosSalesGateway salesGateway;
  final PosRefundsGateway refundsGateway;
  final VoidCallback onNavigateToCaja;

  @override
  State<_SalesHistory> createState() => _SalesHistoryState();
}

class _SalesHistoryState extends State<_SalesHistory> {
  _SalesHistoryPhase _phase = _SalesHistoryPhase.loading;
  List<PosSaleSummary> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;

  String _folioQuery = '';
  String? _statusFilter;
  String? _branchFilter;
  DateTime? _fromDate;
  DateTime? _toDate;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  PosSaleHistoryFilter get _filter => PosSaleHistoryFilter(
    branchId: _branchFilter,
    status: _statusFilter,
    occurredFrom: _fromDate,
    // Inclusive end-of-day: a manager picking "Hasta: 15 ago" expects
    // that whole day included, not excluded at midnight.
    occurredTo: _toDate == null ? null : _toDate!.add(const Duration(days: 1)),
    saleNumber: _folioQuery.trim().isEmpty ? null : _folioQuery.trim(),
  );

  Future<void> _load() async {
    setState(() {
      _phase = _SalesHistoryPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.salesGateway.listSales(filter: _filter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _items.isEmpty
            ? _SalesHistoryPhase.empty
            : _SalesHistoryPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _SalesHistoryPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _SalesHistoryPhase.failure;
        _errorMessage = 'No fue posible cargar el historial de ventas.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.salesGateway.listSales(
        filter: _filter,
        cursor: cursor,
      );
      if (!mounted) return;
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _loadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  void _applyFilters() {
    unawaited(_load());
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isFrom ? _fromDate : _toDate) ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _fromDate = picked;
      } else {
        _toDate = picked;
      }
    });
    _applyFilters();
  }

  Future<void> _openDetail(PosSaleSummary summary) async {
    final refunded = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _SaleDetailDialog(
        saleId: summary.id,
        saleNumber: summary.saleNumber,
        refundState: summary.refundState,
        customerDisplayName: summary.customerDisplayName,
        salesGateway: widget.salesGateway,
        refundsGateway: widget.refundsGateway,
        context: widget.context,
        onNavigateToCaja: widget.onNavigateToCaja,
      ),
    );
    // A completed refund changes this sale's own `refund_state` — reload
    // the list so the row's badge reflects it immediately, rather than
    // waiting for the next manual refresh (ADR-0015 D14).
    if (refunded == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final allowed = widget.context.permissions.contains('sale.read');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Historial de ventas',
          description:
              'Ventas reales registradas por el backend, de más reciente a más antigua.',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (!allowed)
          const _PermissionState()
        else ...[
          _SalesHistoryFilterBar(
            context: widget.context,
            folioQuery: _folioQuery,
            statusFilter: _statusFilter,
            branchFilter: _branchFilter,
            fromDate: _fromDate,
            toDate: _toDate,
            onFolioChanged: (value) {
              setState(() => _folioQuery = value);
              _applyFilters();
            },
            onStatusChanged: (value) {
              setState(() => _statusFilter = value);
              _applyFilters();
            },
            onBranchChanged: (value) {
              setState(() => _branchFilter = value);
              _applyFilters();
            },
            onPickFromDate: () => unawaited(_pickDate(isFrom: true)),
            onPickToDate: () => unawaited(_pickDate(isFrom: false)),
            onClearDates: () {
              setState(() {
                _fromDate = null;
                _toDate = null;
              });
              _applyFilters();
            },
          ),
          const SizedBox(height: 12),
          switch (_phase) {
            _SalesHistoryPhase.loading => const _LoadingState(),
            _SalesHistoryPhase.empty => const _EmptyState(
              message: 'No hay ventas que coincidan con los filtros actuales.',
            ),
            _SalesHistoryPhase.failure => _FailureState(
              message:
                  _errorMessage ??
                  'No fue posible cargar el historial de ventas.',
              onRetry: () => unawaited(_load()),
            ),
            _SalesHistoryPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _SalesHistoryTable(items: _items, onSelect: _openDetail),
                if (_nextCursor != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: OutlinedButton.icon(
                        key: const Key('pos-history-load-more'),
                        onPressed: _loadingMore
                            ? null
                            : () => unawaited(_loadMore()),
                        icon: _loadingMore
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.expand_more),
                        label: const Text('Cargar más'),
                      ),
                    ),
                  ),
              ],
            ),
          },
        ],
      ],
    );
  }
}

class _SalesHistoryFilterBar extends StatelessWidget {
  const _SalesHistoryFilterBar({
    required this.context,
    required this.folioQuery,
    required this.statusFilter,
    required this.branchFilter,
    required this.fromDate,
    required this.toDate,
    required this.onFolioChanged,
    required this.onStatusChanged,
    required this.onBranchChanged,
    required this.onPickFromDate,
    required this.onPickToDate,
    required this.onClearDates,
  });
  final AuthenticatedContext context;
  final String folioQuery;
  final String? statusFilter;
  final String? branchFilter;
  final DateTime? fromDate;
  final DateTime? toDate;
  final ValueChanged<String> onFolioChanged;
  final ValueChanged<String?> onStatusChanged;
  final ValueChanged<String?> onBranchChanged;
  final VoidCallback onPickFromDate;
  final VoidCallback onPickToDate;
  final VoidCallback onClearDates;

  static const _statuses = <String, String>{
    'pending_payment': 'Pendiente',
    'completed': 'Completada',
    'cancelled': 'Cancelada',
    'rejected': 'Rechazada',
  };

  String _formatDate(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}/${value.year}';

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        SizedBox(
          width: 220,
          child: TextField(
            key: const Key('pos-history-search'),
            onChanged: onFolioChanged,
            decoration: const InputDecoration(
              hintText: 'Buscar por folio',
              prefixIcon: Icon(Icons.search),
              isDense: true,
            ),
          ),
        ),
        SizedBox(
          width: 180,
          child: DropdownButtonFormField<String?>(
            key: const Key('pos-history-status'),
            initialValue: statusFilter,
            isExpanded: true,
            decoration: const InputDecoration(
              isDense: true,
              labelText: 'Estado',
            ),
            items: [
              const DropdownMenuItem(
                value: null,
                child: Text('Todos los estados'),
              ),
              for (final entry in _statuses.entries)
                DropdownMenuItem(value: entry.key, child: Text(entry.value)),
            ],
            onChanged: onStatusChanged,
          ),
        ),
        // POS operational branch context: "Todas las sucursales" is a
        // valid consolidated *reporting* scope here — this is history/
        // dashboard reading, never checkout — matching the exact
        // distinction already established for the topbar branch switcher.
        if (this.context.companyWideAccess)
          SizedBox(
            width: 200,
            child: DropdownButtonFormField<String?>(
              key: const Key('pos-history-branch'),
              initialValue: branchFilter,
              isExpanded: true,
              decoration: const InputDecoration(
                isDense: true,
                labelText: 'Sucursal',
              ),
              items: [
                const DropdownMenuItem(
                  value: null,
                  child: Text('Todas las sucursales'),
                ),
                for (final branch in this.context.branches)
                  DropdownMenuItem(value: branch.id, child: Text(branch.name)),
              ],
              onChanged: onBranchChanged,
            ),
          ),
        OutlinedButton.icon(
          key: const Key('pos-history-from-date'),
          onPressed: onPickFromDate,
          icon: const Icon(Icons.calendar_today_outlined, size: 15),
          label: Text(fromDate == null ? 'Desde' : _formatDate(fromDate!)),
        ),
        OutlinedButton.icon(
          key: const Key('pos-history-to-date'),
          onPressed: onPickToDate,
          icon: const Icon(Icons.calendar_today_outlined, size: 15),
          label: Text(toDate == null ? 'Hasta' : _formatDate(toDate!)),
        ),
        if (fromDate != null || toDate != null)
          TextButton(
            key: const Key('pos-history-clear-dates'),
            onPressed: onClearDates,
            child: Text(
              'Limpiar fechas',
              style: TextStyle(color: palette.textSecondary),
            ),
          ),
      ],
    );
  }
}

class _SalesHistoryTable extends StatelessWidget {
  const _SalesHistoryTable({required this.items, required this.onSelect});
  final List<PosSaleSummary> items;
  final ValueChanged<PosSaleSummary> onSelect;

  String _formatDateTime(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
  }

  String _methodLabel(List<String> methods) {
    if (methods.isEmpty) return '—';
    const labels = {
      'cash': 'Efectivo',
      'card_terminal': 'Tarjeta',
      'card_manual': 'Tarjeta (manual)',
    };
    return methods.map((method) => labels[method] ?? method).join(', ');
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      padding: EdgeInsets.zero,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingTextStyle: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w800,
          ),
          columns: const [
            DataColumn(label: Text('Folio')),
            DataColumn(label: Text('Fecha / hora')),
            DataColumn(label: Text('Sucursal')),
            DataColumn(label: Text('Cajero')),
            // TASK 13.0: a name only — never phone/email/birth date
            // (Part AA/AB); `—` for a walk-in sale.
            DataColumn(label: Text('Cliente')),
            DataColumn(label: Text('Estado')),
            DataColumn(label: Text('Método')),
            DataColumn(label: Text('Total'), numeric: true),
          ],
          rows: items
              .map(
                (item) => DataRow(
                  key: ValueKey('pos-history-row-${item.id}'),
                  onSelectChanged: (_) => onSelect(item),
                  cells: [
                    DataCell(Text(displaySaleFolio(item.saleNumber))),
                    DataCell(Text(_formatDateTime(item.occurredAt))),
                    DataCell(Text(item.branchName ?? '—')),
                    DataCell(Text(item.cashierName ?? '—')),
                    DataCell(Text(item.customerDisplayName ?? '—')),
                    DataCell(
                      _SaleStatusChip(
                        status: item.status,
                        refundState: item.refundState,
                      ),
                    ),
                    DataCell(Text(_methodLabel(item.paymentMethods))),
                    DataCell(
                      Text(_money(Money.parse(item.total, item.currencyCode))),
                    ),
                  ],
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}

/// C2: represents the canonical `SaleStatus` states honestly — never an
/// invented status, and `completed` is never visually confusable with
/// `pending_payment`. TASK 12.8: [refundState], when given, is composed
/// additively onto the same chip's label (e.g. "Completada · devolución
/// parcial") — the original [status] text is never hidden or replaced
/// (ADR-0015 D14); `not_refunded` (or `null`, for a caller that never
/// looked it up) adds nothing.
class _SaleStatusChip extends StatelessWidget {
  const _SaleStatusChip({required this.status, this.refundState});
  final String status;
  final String? refundState;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final (baseLabel, color) = switch (status) {
      'completed' => ('Completada', palette.success),
      'pending_payment' => ('Pendiente', palette.warning),
      'cancelled' => ('Cancelada', palette.error),
      'rejected' => ('Rechazada', palette.error),
      'draft' => ('Borrador', palette.textMuted),
      _ => (status, palette.textMuted),
    };
    final label = '$baseLabel${_refundStateSuffix(refundState)}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

/// C3/C4: a manager opening one sale — canonical folio/status/date/
/// branch/cashier, line items, totals, payment (cash tender/change where
/// applicable), and Imprimir ticket. Deliberately no Refund/Cancel/Void
/// button — explicitly out of scope for this task (see the task's own
/// "Do NOT add Refund / Cancel / Void buttons yet").
class _SaleDetailDialog extends StatefulWidget {
  const _SaleDetailDialog({
    required this.saleId,
    required this.saleNumber,
    required this.refundState,
    required this.salesGateway,
    required this.refundsGateway,
    required this.context,
    required this.onNavigateToCaja,
    this.customerDisplayName,
  });
  final String saleId;
  final String saleNumber;
  // TASK 12.8: the already-fetched Sales History list value — additive,
  // never a replacement for the sale's own `status` (ADR-0015 D14).
  final String refundState;
  final PosSalesGateway salesGateway;
  final PosRefundsGateway refundsGateway;
  final AuthenticatedContext context;
  final VoidCallback onNavigateToCaja;
  // TASK 13.0: the already-fetched Sales History row's own value — the
  // backend's own `GET /sales/{id}/receipt` response carries no customer
  // field at all (see `buildReceiptHtml`'s own doc comment), so this is
  // threaded from the list row instead.
  final String? customerDisplayName;

  @override
  State<_SaleDetailDialog> createState() => _SaleDetailDialogState();
}

class _SaleDetailDialogState extends State<_SaleDetailDialog> {
  PosReceipt? _receipt;
  bool _loading = true;
  String? _errorMessage;
  bool _printing = false;
  String? _printError;

  // TASK 12.8: E081's own eligibility answer — `null` while unresolved
  // (still loading, not attempted, or the actor lacks `refund.read`), in
  // which case the "Devolver / Reembolsar" action stays hidden rather
  // than guessing (ADR-0015 D6 Part 3: "never Flutter").
  PosRefundableBalance? _balance;
  bool _balanceLoading = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final receipt = await widget.salesGateway.receipt(widget.saleId);
      if (!mounted) return;
      setState(() {
        _receipt = receipt;
        _loading = false;
      });
      if (receipt.sale.status == 'completed') await _loadBalance();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'No fue posible cargar el detalle de la venta.';
      });
    }
  }

  // TASK 12.8: E081 — only ever called for a `refund.read`-holding actor
  // (mirrors every other module's own "check the permission before even
  // attempting the read" precedent, e.g. `_SalesHistoryState`/`_CajaState`
  // gating on `sale.read`/`cash_session.read`). A failure here never
  // blocks the rest of Sale Detail — the refund action simply stays
  // hidden, exactly as if the sale were reported non-refundable.
  Future<void> _loadBalance() async {
    if (!widget.context.permissions.contains('refund.read')) return;
    setState(() => _balanceLoading = true);
    try {
      final balance = await widget.refundsGateway.refundableBalance(
        widget.saleId,
      );
      if (!mounted) return;
      setState(() {
        _balance = balance;
        _balanceLoading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _balanceLoading = false);
    }
  }

  Future<void> _openRefundFlow() async {
    final receipt = _receipt;
    final balance = _balance;
    if (receipt == null || balance == null || !balance.refundable) return;
    final completed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _RefundFlowDialog(
        sale: receipt.sale,
        business: receipt.business,
        cashier: receipt.cashier,
        balance: balance,
        refundsGateway: widget.refundsGateway,
        actorContext: widget.context,
        onNavigateToCaja: widget.onNavigateToCaja,
      ),
    );
    if (!mounted) return;
    if (completed == true) {
      Navigator.of(context).pop(true);
      return;
    }
    // Even an approved-but-not-completed (e.g. card_terminal) refund
    // already reduces the remaining refundable quantity server-side —
    // refresh so the button/tooltip reflects it, never stale.
    await _loadBalance();
  }

  Future<void> _print() async {
    final receipt = _receipt;
    if (receipt == null || _printing) return;
    setState(() {
      _printing = true;
      _printError = null;
    });
    final logoDataUri = await _receiptLogoDataUri();
    // Reprint is read-only by construction: `buildReceiptHtml`/
    // `openReceiptPrintWindow` never call the backend — this only
    // re-renders data already fetched by the read-only `receipt()` call
    // above. It never creates a payment, posts inventory again, creates
    // another Sale, or alters status (see ADR-0012).
    final html = buildReceiptHtml(
      receipt: receipt,
      logoDataUri: logoDataUri,
      customerDisplayName: widget.customerDisplayName,
    );
    final opened = openReceiptPrintWindow(html);
    if (!mounted) return;
    setState(() {
      _printing = false;
      _printError = opened
          ? null
          : 'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para imprimir.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 560),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Detalle de venta',
                      style: TextStyle(
                        color: palette.text,
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('pos-history-detail-close'),
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Flexible(
                child: SingleChildScrollView(
                  child: _loading
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 40),
                          child: Center(child: CircularProgressIndicator()),
                        )
                      : _errorMessage != null
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              _errorMessage!,
                              style: const TextStyle(
                                color: Colors.redAccent,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 6),
                            OutlinedButton(
                              key: const Key('pos-history-detail-retry'),
                              onPressed: () => unawaited(_load()),
                              child: const Text('Reintentar'),
                            ),
                          ],
                        )
                      : _SaleDetailBody(
                          receipt: _receipt!,
                          refundState: widget.refundState,
                          customerDisplayName: widget.customerDisplayName,
                        ),
                ),
              ),
              if (_printError != null) ...[
                const SizedBox(height: 8),
                Text(
                  _printError!,
                  style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                ),
              ],
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    key: const Key('pos-history-detail-print'),
                    onPressed: (_receipt == null || _printing)
                        ? null
                        : () => unawaited(_print()),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: palette.textSecondary,
                      side: BorderSide(color: palette.border),
                    ),
                    icon: _printing
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.print_outlined, size: 16),
                    label: const Text('Imprimir ticket'),
                  ),
                  _refundActionWidget(),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // TASK 12.8: only ever rendered for an actor holding `refund.create`
  // (mirrors the existing `cash_movement.create`/`cash_session.close`
  // gating precedent in `_CajaOpenView`) — and even then, only once E081
  // has actually answered; a permission-less actor or an unresolved
  // balance never sees any refund control at all, not even a disabled
  // placeholder (ADR-0015 D6 Part 3, D13).
  Widget _refundActionWidget() {
    if (!widget.context.permissions.contains('refund.create')) {
      return const SizedBox.shrink();
    }
    if (_balanceLoading) {
      return const SizedBox(
        width: 16,
        height: 16,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }
    final balance = _balance;
    if (balance == null) return const SizedBox.shrink();
    if (!balance.refundable) {
      return Tooltip(
        message:
            balance.blockedReason ??
            'Esta venta no admite devoluciones en este momento.',
        child: OutlinedButton.icon(
          key: const Key('pos-history-detail-refund'),
          onPressed: null,
          icon: const Icon(Icons.assignment_return_outlined, size: 16),
          label: const Text('Devolver / Reembolsar'),
        ),
      );
    }
    return FilledButton.icon(
      key: const Key('pos-history-detail-refund'),
      onPressed: () => unawaited(_openRefundFlow()),
      icon: const Icon(Icons.assignment_return_outlined, size: 16),
      label: const Text('Devolver / Reembolsar'),
    );
  }
}

class _SaleDetailBody extends StatelessWidget {
  const _SaleDetailBody({required this.receipt, this.refundState, this.customerDisplayName});
  final PosReceipt receipt;
  final String? refundState;
  // TASK 13.0: threaded from the Sales History row (the receipt response
  // itself carries no customer field — see `buildReceiptHtml`'s own doc
  // comment). A name only — never phone/email/birth date (Part AB).
  final String? customerDisplayName;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final sale = receipt.sale;
    final business = receipt.business;
    final cashier = receipt.cashier;
    final cash = receipt.cashPayment;
    String two(int n) => n.toString().padLeft(2, '0');
    final occurred = (sale.completedAt ?? sale.occurredAt).toLocal();
    final formattedDate =
        '${two(occurred.day)}/${two(occurred.month)}/${occurred.year} ${two(occurred.hour)}:${two(occurred.minute)}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // VENTA
        Text(
          'VENTA',
          style: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w800,
            fontSize: 11,
          ),
        ),
        const SizedBox(height: 6),
        _CashSummaryRow(
          label: 'Folio',
          value: displaySaleFolio(sale.saleNumber),
          big: true,
        ),
        const SizedBox(height: 4),
        _CashSummaryRow(label: 'Fecha', value: formattedDate),
        if (business != null) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(
            label: 'Sucursal',
            value: business.branchName.isEmpty
                ? business.companyName
                : business.branchName,
          ),
        ],
        if (cashier != null) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(label: 'Cajero', value: cashier.displayName),
        ],
        if (customerDisplayName != null) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(label: 'Cliente', value: customerDisplayName!),
        ],
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'Estado',
          value: '${sale.status}${_refundStateSuffix(refundState)}',
        ),
        const SizedBox(height: 14),
        // PRODUCTOS
        Text(
          'PRODUCTOS',
          style: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w800,
            fontSize: 11,
          ),
        ),
        Divider(color: palette.border, height: 16),
        for (final item in receipt.items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    item.quantity == '1.000000'
                        ? item.nameSnapshot
                        : '${item.nameSnapshot} x${item.quantity}',
                    style: TextStyle(color: palette.text, fontSize: 12),
                  ),
                ),
                Text(
                  _money(Money.parse(item.lineTotal, sale.currencyCode)),
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 10),
        // TOTALES
        Divider(color: palette.border, height: 16),
        _CashSummaryRow(
          label: 'Subtotal',
          value: _money(Money.parse(sale.subtotal, sale.currencyCode)),
        ),
        // TASK 12.9: `sale.discount_total` is now real (previously always
        // `"0.0000"`) — surfaced honestly whenever it is nonzero, never
        // hidden (ADR-0016 D13).
        if (Money.parse(sale.discountTotal, sale.currencyCode).isPositive) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(
            label: 'Descuento',
            value: '-${_money(Money.parse(sale.discountTotal, sale.currencyCode))}',
          ),
        ],
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'IVA',
          value: _money(Money.parse(sale.taxTotal, sale.currencyCode)),
        ),
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'Total',
          value: _money(Money.parse(sale.total, sale.currencyCode)),
          big: true,
        ),
        const SizedBox(height: 14),
        // PAGO
        if (receipt.payments.isNotEmpty) ...[
          Text(
            'PAGO',
            style: TextStyle(
              color: palette.textSecondary,
              fontWeight: FontWeight.w800,
              fontSize: 11,
            ),
          ),
          Divider(color: palette.border, height: 16),
          for (final payment in receipt.payments) ...[
            _CashSummaryRow(
              label: 'Método',
              value: switch (payment.paymentMethod) {
                'cash' => 'Efectivo',
                'card_terminal' => 'Tarjeta',
                'card_manual' => 'Tarjeta (manual)',
                _ => payment.paymentMethod,
              },
            ),
            const SizedBox(height: 4),
            _CashSummaryRow(
              label: 'Monto aplicado',
              value: _money(Money.parse(payment.amount, payment.currencyCode)),
            ),
            if (payment == cash && cash?.tenderedAmount != null) ...[
              const SizedBox(height: 4),
              _CashSummaryRow(
                label: 'Efectivo recibido',
                value: _money(
                  Money.parse(cash!.tenderedAmount!, cash.currencyCode),
                ),
              ),
            ],
            if (payment == cash && cash?.changeAmount != null) ...[
              const SizedBox(height: 4),
              _CashSummaryRow(
                label: 'Cambio',
                value: _money(
                  Money.parse(cash!.changeAmount!, cash.currencyCode),
                ),
                emphasis: true,
              ),
            ],
            // Safe provider fields only when they actually exist (never
            // fabricated) — ADR-0010; always null while Mercado Pago
            // remains paused.
            if (payment.providerReference != null) ...[
              const SizedBox(height: 4),
              _CashSummaryRow(
                label: 'Referencia',
                value: payment.providerReference!,
              ),
            ],
            if (payment != receipt.payments.last)
              Divider(color: palette.border, height: 16),
          ],
        ] else
          Text(
            'Sin pagos registrados.',
            style: TextStyle(color: palette.textSecondary, fontSize: 12),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------
// TASK 12.8 — Returns/refunds (ADR-0015). "Devolver / Reembolsar" wizard
// (item/quantity selection → reason → E082 create → an honest
// pre-completion preview → E086 complete), the global Devoluciones
// history list (E084), and a refund detail view. Every number here is
// exactly what the backend returned — Dart never computes an
// authoritative refund total, tax split, or eligibility decision
// (ADR-0015 D5/D6).
// ---------------------------------------------------------------------

/// Parses the whole-unit integer portion of a canonical ADR-0001-style
/// quantity string (e.g. `"2.000000"` → `2`) — used only to bound/display
/// the refund item-selection stepper; every ticket line in this app is
/// already a whole-unit quantity in practice (`SaleLine.quantity` is
/// `int` — see `sale_session.dart`), and the backend remains the real
/// enforcer of the exact decimal value regardless (ADR-0015 D6).
int _wholeUnits(String decimal) {
  final trimmed = decimal.trim();
  final dot = trimmed.indexOf('.');
  final wholePart = dot == -1 ? trimmed : trimmed.substring(0, dot);
  return int.tryParse(wholePart) ?? 0;
}

/// A short, fixed set of sensible Spanish reason codes for a POS return —
/// stored verbatim as `reason_code` (the backend has no fixed enum to
/// match, ADR-0015 §17.1) — never a client-invented eligibility decision.
const Map<String, String> _refundReasonLabels = {
  'customer_changed_mind': 'Cliente cambió de opinión',
  'defective_product': 'Producto defectuoso',
  'billing_error': 'Error de cobro',
  'other': 'Otro',
};

enum _RefundStep { items, reason, result }

/// The "Devolver / Reembolsar" wizard, opened from Sale Detail once E081
/// has already reported `refundable: true`. Returns `true` from
/// `Navigator.pop` only once a refund actually reaches `completed` (so the
/// caller knows to reload the sale's own `refund_state` badge) — any
/// other outcome (closed early, created-but-not-completed) pops `false`.
class _RefundFlowDialog extends StatefulWidget {
  const _RefundFlowDialog({
    required this.sale,
    required this.business,
    required this.cashier,
    required this.balance,
    required this.refundsGateway,
    required this.actorContext,
    required this.onNavigateToCaja,
  });

  final PosReceiptSale sale;
  final PosReceiptBusiness? business;
  final PosReceiptCashier? cashier;
  final PosRefundableBalance balance;
  final PosRefundsGateway refundsGateway;
  final AuthenticatedContext actorContext;
  final VoidCallback onNavigateToCaja;

  @override
  State<_RefundFlowDialog> createState() => _RefundFlowDialogState();
}

class _RefundFlowDialogState extends State<_RefundFlowDialog> {
  _RefundStep _step = _RefundStep.items;
  final Map<String, int> _quantities = {};
  String _reasonCode = _refundReasonLabels.keys.first;
  final _noteController = TextEditingController();

  bool _creating = false;
  String? _createError;
  PosRefund? _createdRefund;

  bool _completing = false;
  String? _completeError;
  bool _cashSessionRequired = false;
  PosRefund? _completedRefund;

  bool _printing = false;
  String? _printError;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  bool get _hasSelection => _quantities.values.any((quantity) => quantity > 0);

  // Structural bound, not merely a validation message: the `+` stepper
  // below is disabled outright at the backend-reported
  // `refundable_quantity` — this app can never even construct a
  // request that asks for more (ADR-0015 D6/§Constraints).
  void _setQuantity(PosRefundableLine line, int quantity) {
    final bounded = quantity.clamp(0, _wholeUnits(line.refundableQuantity));
    setState(() {
      if (bounded <= 0) {
        _quantities.remove(line.saleItemId);
      } else {
        _quantities[line.saleItemId] = bounded;
      }
    });
  }

  void _goToReason() {
    if (!_hasSelection) return;
    setState(() => _step = _RefundStep.reason);
  }

  Future<void> _create() async {
    setState(() {
      _creating = true;
      _createError = null;
    });
    try {
      final refund = await widget.refundsGateway.createRefund(
        saleId: widget.sale.id,
        reasonCode: _reasonCode,
        reasonNote: _noteController.text.trim().isEmpty
            ? null
            : _noteController.text.trim(),
        items: [
          for (final entry in _quantities.entries)
            if (entry.value > 0)
              PosCreateRefundItem(
                saleItemId: entry.key,
                quantity: '${entry.value}.000000',
              ),
        ],
      );
      if (!mounted) return;
      setState(() {
        _createdRefund = refund;
        _creating = false;
        _step = _RefundStep.result;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _creating = false;
        // `refund_approval_required` lands here exactly like any other
        // rejection — an honest error, never a silent queue/retry
        // (ADR-0015 D7).
        _createError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _creating = false;
        _createError = 'No fue posible solicitar la devolución.';
      });
    }
  }

  Future<void> _complete() async {
    final refund = _createdRefund;
    if (refund == null) return;
    setState(() {
      _completing = true;
      _completeError = null;
      _cashSessionRequired = false;
    });
    try {
      final completed = await widget.refundsGateway.completeRefund(
        refundId: refund.id,
      );
      if (!mounted) return;
      setState(() {
        _completedRefund = completed;
        _completing = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      final sessionRequired = error.failure.code == 'cash_session_required';
      setState(() {
        _completing = false;
        _cashSessionRequired = sessionRequired;
        // The task's own exact honest copy — more specific than the
        // generic cash-sale `cash_session_required` message, since this
        // is a completion, not a checkout; never a silently-opened
        // session either way.
        _completeError = sessionRequired
            ? 'No hay una caja abierta. Abre una caja en Caja y Finanzas → '
                  'Corte de Caja antes de completar esta devolución en efectivo.'
            : error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _completing = false;
        _completeError = 'No fue posible completar la devolución.';
      });
    }
  }

  Future<void> _print() async {
    final refund = _completedRefund ?? _createdRefund;
    if (refund == null || _printing) return;
    setState(() {
      _printing = true;
      _printError = null;
    });
    final logoDataUri = await _receiptLogoDataUri();
    final lineInfo = <String, PosRefundableLine>{
      for (final line in widget.balance.lines) line.saleItemId: line,
    };
    // Read-only by construction, identical guarantee to the sale
    // receipt's own reprint: never calls the backend, never mutates
    // anything (ADR-0015 D17).
    final html = buildRefundReceiptHtml(
      refund: refund,
      sale: widget.sale,
      business: widget.business,
      cashier: widget.cashier,
      lineInfoBySaleItemId: lineInfo,
      logoDataUri: logoDataUri,
    );
    final opened = openReceiptPrintWindow(html);
    if (!mounted) return;
    setState(() {
      _printing = false;
      _printError = opened
          ? null
          : 'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para imprimir.';
    });
  }

  // Closes every dialog currently open on the root navigator (this refund
  // flow's own, plus the Sale Detail dialog underneath it — both were
  // pushed via `showDialog`'s default root navigator) in one call, then
  // switches to Caja — never a silently-opened session, just a real,
  // complete navigation to the existing "Abrir caja" flow the cashier
  // must use themselves.
  void _goToCaja() {
    Navigator.of(
      context,
      rootNavigator: true,
    ).popUntil((route) => route.isFirst);
    widget.onNavigateToCaja();
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460, maxHeight: 640),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Devolver / Reembolsar',
                      style: TextStyle(
                        color: palette.text,
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('pos-refund-close'),
                    onPressed: () =>
                        Navigator.of(context).pop(_completedRefund != null),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Flexible(
                child: SingleChildScrollView(
                  child: switch (_step) {
                    _RefundStep.items => _buildItemsStep(palette),
                    _RefundStep.reason => _buildReasonStep(palette),
                    _RefundStep.result => _buildResultStep(palette),
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildItemsStep(PosPalette palette) {
    final lines = widget.balance.lines
        .where((line) => _wholeUnits(line.refundableQuantity) > 0)
        .toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Selecciona los artículos y cantidades a devolver.',
          style: TextStyle(color: palette.textSecondary, fontSize: 12),
        ),
        const SizedBox(height: 10),
        if (lines.isEmpty)
          Text(
            'No quedan artículos disponibles para devolución.',
            style: TextStyle(color: palette.textSecondary),
          )
        else
          for (final line in lines)
            _RefundLineRow(
              line: line,
              currencyCode: widget.sale.currencyCode,
              quantity: _quantities[line.saleItemId] ?? 0,
              onChanged: (value) => _setQuantity(line, value),
            ),
        const SizedBox(height: 14),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton(
            key: const Key('pos-refund-continue'),
            onPressed: _hasSelection ? _goToReason : null,
            child: const Text('Continuar'),
          ),
        ),
      ],
    );
  }

  Widget _buildReasonStep(PosPalette palette) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'MOTIVO DE LA DEVOLUCIÓN',
          style: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w800,
            fontSize: 11,
          ),
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          key: const Key('pos-refund-reason'),
          initialValue: _reasonCode,
          isExpanded: true,
          decoration: const InputDecoration(isDense: true, labelText: 'Motivo'),
          items: [
            for (final entry in _refundReasonLabels.entries)
              DropdownMenuItem(value: entry.key, child: Text(entry.value)),
          ],
          onChanged: (value) =>
              setState(() => _reasonCode = value ?? _reasonCode),
        ),
        const SizedBox(height: 10),
        TextField(
          key: const Key('pos-refund-note'),
          controller: _noteController,
          decoration: const InputDecoration(labelText: 'Nota (opcional)'),
          maxLines: 2,
        ),
        if (_createError != null) ...[
          const SizedBox(height: 8),
          Text(
            _createError!,
            style: const TextStyle(color: Colors.redAccent, fontSize: 12),
          ),
        ],
        const SizedBox(height: 14),
        Row(
          children: [
            TextButton(
              onPressed: _creating
                  ? null
                  : () => setState(() => _step = _RefundStep.items),
              child: const Text('Atrás'),
            ),
            const Spacer(),
            FilledButton(
              key: const Key('pos-refund-request'),
              onPressed: _creating ? null : () => unawaited(_create()),
              child: _creating
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Solicitar devolución'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildResultStep(PosPalette palette) {
    final refund = _createdRefund;
    if (refund == null) return const SizedBox.shrink();
    final completed = _completedRefund;
    final canComplete = widget.actorContext.permissions.contains(
      'refund.complete',
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _CashSummaryRow(label: 'Folio', value: refund.refundNumber, big: true),
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'Total',
          value: _formatMoney(refund.total, refund.currencyCode),
          big: true,
        ),
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'Estado',
          value: (completed ?? refund).status,
        ),
        const SizedBox(height: 14),
        if (completed != null) ...[
          Row(
            children: [
              Icon(Icons.check_circle, color: palette.success, size: 18),
              const SizedBox(width: 6),
              Text(
                'Devolución completada.',
                style: TextStyle(
                  color: palette.success,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
        ] else if (refund.isCash) ...[
          // TASK 12.8: the E082 response's own computed total — never
          // recomputed client-side (ADR-0015 D5/D11: the drawer impact is
          // always the refund's own total, never the original tender).
          _PosCard(
            child: Text(
              'Efectivo a devolver: '
              '${_formatMoney(refund.total, refund.currencyCode)} — se '
              'descontará de la caja actualmente abierta.',
              style: TextStyle(color: palette.text, fontSize: 13),
            ),
          ),
          const SizedBox(height: 10),
          if (_completeError != null) ...[
            Text(
              _completeError!,
              style: const TextStyle(color: Colors.redAccent, fontSize: 12),
            ),
            const SizedBox(height: 8),
            if (_cashSessionRequired)
              OutlinedButton(
                key: const Key('pos-refund-go-caja'),
                onPressed: _goToCaja,
                child: const Text('Ir a Caja'),
              ),
            const SizedBox(height: 8),
          ],
          if (!canComplete)
            Text(
              'Tu sesión no incluye el permiso para completar devoluciones.',
              style: TextStyle(color: palette.textSecondary, fontSize: 12),
            )
          else
            FilledButton(
              key: const Key('pos-refund-complete'),
              onPressed: _completing ? null : () => unawaited(_complete()),
              child: _completing
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Completar devolución'),
            ),
        ] else if (refund.isCardTerminal) ...[
          // TASK 12.8: the task's own exact honest Spanish copy — never a
          // "complete" action that implies this will actually reverse
          // money on the card while Mercado Pago stays unconfigured
          // (ADR-0015 D15). The refund itself already exists (`approved`),
          // it simply is never attempted-and-faked here.
          _PosCard(
            child: Text(
              'El reembolso con tarjeta requiere la configuración del '
              'proveedor de pago.',
              style: TextStyle(
                color: palette.warning,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'La devolución quedó registrada como aprobada; no se '
            'intentará reversar el cobro con tarjeta desde aquí.',
            style: TextStyle(color: palette.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 10),
        ] else ...[
          Text(
            'Este método de reembolso no requiere una acción adicional aquí.',
            style: TextStyle(color: palette.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 10),
        ],
        if (_printError != null) ...[
          Text(
            _printError!,
            style: const TextStyle(color: Colors.redAccent, fontSize: 12),
          ),
          const SizedBox(height: 8),
        ],
        OutlinedButton.icon(
          key: const Key('pos-refund-print'),
          onPressed: _printing ? null : () => unawaited(_print()),
          icon: _printing
              ? const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.print_outlined, size: 16),
          label: const Text('Imprimir comprobante de devolución'),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            key: const Key('pos-refund-done'),
            onPressed: () => Navigator.of(context).pop(completed != null),
            child: const Text('Cerrar'),
          ),
        ),
      ],
    );
  }
}

class _RefundLineRow extends StatelessWidget {
  const _RefundLineRow({
    required this.line,
    required this.currencyCode,
    required this.quantity,
    required this.onChanged,
  });
  final PosRefundableLine line;
  final String currencyCode;
  final int quantity;
  final ValueChanged<int> onChanged;

  int get _maxUnits => _wholeUnits(line.refundableQuantity);

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.nameSnapshot,
                  style: TextStyle(
                    color: palette.text,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  'Vendido ${_wholeUnits(line.soldQuantity)} · Disponible '
                  '$_maxUnits · ${_formatMoney(line.unitPrice, currencyCode)}/u',
                  style: TextStyle(color: palette.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          IconButton(
            key: Key('pos-refund-qty-minus-${line.saleItemId}'),
            onPressed: quantity > 0 ? () => onChanged(quantity - 1) : null,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          SizedBox(
            width: 24,
            child: Center(
              child: Text(
                '$quantity',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ),
          IconButton(
            key: Key('pos-refund-qty-plus-${line.saleItemId}'),
            // Structural bound: this can never be tapped past the
            // backend-reported `refundable_quantity` (ADR-0015 D6).
            onPressed: quantity < _maxUnits
                ? () => onChanged(quantity + 1)
                : null,
            icon: const Icon(Icons.add_circle_outline),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------
// TASK 12.8 — Devoluciones (global refund history, `PosModule.returns`).
// Mirrors `_SalesHistory`'s own self-contained gateway-call/loading-state
// pattern exactly. `GET /api/v1/refunds?sale_id=...` (E084) is the same
// endpoint a Sale Detail's own "returns for this sale" would call — this
// screen is deliberately the global/cross-sale view only, never a second
// duplicate list (ADR-0015 D14).
// ---------------------------------------------------------------------

enum _DevolucionesPhase { loading, ready, empty, failure }

class _Devoluciones extends StatefulWidget {
  const _Devoluciones({
    required this.context,
    required this.refundsGateway,
    required this.salesGateway,
    required this.onNavigateToCaja,
  });
  final AuthenticatedContext context;
  final PosRefundsGateway refundsGateway;
  final PosSalesGateway salesGateway;
  final VoidCallback onNavigateToCaja;

  @override
  State<_Devoluciones> createState() => _DevolucionesState();
}

class _DevolucionesState extends State<_Devoluciones> {
  _DevolucionesPhase _phase = _DevolucionesPhase.loading;
  List<PosRefund> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  String? _statusFilter;
  String? _branchFilter;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  PosRefundListFilter get _filter =>
      PosRefundListFilter(branchId: _branchFilter, status: _statusFilter);

  Future<void> _load() async {
    setState(() {
      _phase = _DevolucionesPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.refundsGateway.listRefunds(filter: _filter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _items.isEmpty
            ? _DevolucionesPhase.empty
            : _DevolucionesPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _DevolucionesPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _DevolucionesPhase.failure;
        _errorMessage = 'No fue posible cargar el historial de devoluciones.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.refundsGateway.listRefunds(
        filter: _filter,
        cursor: cursor,
      );
      if (!mounted) return;
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _loadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  void _applyFilters() => unawaited(_load());

  Future<void> _openDetail(PosRefund refund) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _RefundDetailDialog(
        refundId: refund.id,
        refundsGateway: widget.refundsGateway,
        salesGateway: widget.salesGateway,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final allowed = widget.context.permissions.contains('refund.read');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Devoluciones',
          description:
              'Devoluciones y reembolsos reales registrados por el '
              'backend, de más reciente a más antigua.',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (!allowed)
          const _PermissionState()
        else ...[
          Wrap(
            spacing: 10,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 200,
                child: DropdownButtonFormField<String?>(
                  key: const Key('pos-refunds-status'),
                  initialValue: _statusFilter,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    isDense: true,
                    labelText: 'Estado',
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: null,
                      child: Text('Todos los estados'),
                    ),
                    DropdownMenuItem(
                      value: 'requested',
                      child: Text('Solicitada'),
                    ),
                    DropdownMenuItem(
                      value: 'approved',
                      child: Text('Aprobada'),
                    ),
                    DropdownMenuItem(
                      value: 'completed',
                      child: Text('Completada'),
                    ),
                    DropdownMenuItem(
                      value: 'rejected',
                      child: Text('Rechazada'),
                    ),
                    DropdownMenuItem(
                      value: 'cancelled',
                      child: Text('Cancelada'),
                    ),
                  ],
                  onChanged: (value) {
                    setState(() => _statusFilter = value);
                    _applyFilters();
                  },
                ),
              ),
              if (widget.context.companyWideAccess)
                SizedBox(
                  width: 200,
                  child: DropdownButtonFormField<String?>(
                    key: const Key('pos-refunds-branch'),
                    initialValue: _branchFilter,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Sucursal',
                    ),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('Todas las sucursales'),
                      ),
                      for (final branch in widget.context.branches)
                        DropdownMenuItem(
                          value: branch.id,
                          child: Text(branch.name),
                        ),
                    ],
                    onChanged: (value) {
                      setState(() => _branchFilter = value);
                      _applyFilters();
                    },
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          switch (_phase) {
            _DevolucionesPhase.loading => const _LoadingState(),
            _DevolucionesPhase.empty => const _EmptyState(
              message:
                  'No hay devoluciones que coincidan con los filtros actuales.',
            ),
            _DevolucionesPhase.failure => _FailureState(
              message:
                  _errorMessage ??
                  'No fue posible cargar el historial de devoluciones.',
              onRetry: () => unawaited(_load()),
            ),
            _DevolucionesPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _DevolucionesTable(items: _items, onSelect: _openDetail),
                if (_nextCursor != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: OutlinedButton.icon(
                        key: const Key('pos-refunds-load-more'),
                        onPressed: _loadingMore
                            ? null
                            : () => unawaited(_loadMore()),
                        icon: _loadingMore
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.expand_more),
                        label: const Text('Cargar más'),
                      ),
                    ),
                  ),
              ],
            ),
          },
        ],
      ],
    );
  }
}

class _DevolucionesTable extends StatelessWidget {
  const _DevolucionesTable({required this.items, required this.onSelect});
  final List<PosRefund> items;
  final ValueChanged<PosRefund> onSelect;

  String _formatDateTime(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
  }

  String _methodLabel(String method) => switch (method) {
    'cash' => 'Efectivo',
    'card_terminal' => 'Tarjeta',
    'card_manual' => 'Tarjeta (manual)',
    _ => method,
  };

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      padding: EdgeInsets.zero,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingTextStyle: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w800,
          ),
          columns: const [
            DataColumn(label: Text('Folio')),
            DataColumn(label: Text('Venta')),
            DataColumn(label: Text('Fecha / hora')),
            DataColumn(label: Text('Estado')),
            DataColumn(label: Text('Motivo')),
            DataColumn(label: Text('Método')),
            DataColumn(label: Text('Total'), numeric: true),
          ],
          rows: items
              .map(
                (item) => DataRow(
                  key: ValueKey('pos-refunds-row-${item.id}'),
                  onSelectChanged: (_) => onSelect(item),
                  cells: [
                    DataCell(Text(item.refundNumber)),
                    DataCell(Text(_compactId(item.saleId))),
                    DataCell(Text(_formatDateTime(item.occurredAt))),
                    DataCell(_RefundStatusChip(status: item.status)),
                    DataCell(Text(_refundReasonLabels[item.reasonCode] ?? item.reasonCode)),
                    DataCell(Text(_methodLabel(item.refundMethod))),
                    DataCell(
                      Text(_formatMoney(item.total, item.currencyCode)),
                    ),
                  ],
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}

/// Represents the canonical `RefundStatus` states honestly — never an
/// invented status (mirrors `_SaleStatusChip`'s own precedent).
class _RefundStatusChip extends StatelessWidget {
  const _RefundStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final (label, color) = switch (status) {
      'completed' => ('Completada', palette.success),
      'approved' => ('Aprobada', palette.action),
      'requested' => ('Solicitada', palette.warning),
      'pending_approval' => ('Pendiente de aprobación', palette.warning),
      'cancelled' => ('Cancelada', palette.error),
      'rejected' => ('Rechazada', palette.error),
      _ => (status, palette.textMuted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

/// A simple, sufficient refund detail view reached from the Devoluciones
/// global list (E083, plus a best-effort E081 re-fetch purely to join
/// each line's own name — `refund_items` itself stores no name snapshot,
/// see `refund_receipt_html.dart`'s own doc comment). No "view related
/// sale" pattern exists elsewhere in this app to mirror, so this stays
/// self-contained instead of reusing `_SaleDetailDialog` (ADR-0015 D14:
/// "a simple detail view/dialog... is sufficient").
class _RefundDetailDialog extends StatefulWidget {
  const _RefundDetailDialog({
    required this.refundId,
    required this.refundsGateway,
    required this.salesGateway,
  });
  final String refundId;
  final PosRefundsGateway refundsGateway;
  final PosSalesGateway salesGateway;

  @override
  State<_RefundDetailDialog> createState() => _RefundDetailDialogState();
}

class _RefundDetailDialogState extends State<_RefundDetailDialog> {
  PosRefund? _refund;
  PosReceipt? _saleReceipt;
  Map<String, PosRefundableLine> _lineInfo = const {};
  bool _loading = true;
  String? _errorMessage;
  bool _printing = false;
  String? _printError;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final refund = await widget.refundsGateway.refund(widget.refundId);
      PosReceipt? saleReceipt;
      try {
        saleReceipt = await widget.salesGateway.receipt(refund.saleId);
      } on Object {
        saleReceipt = null; // Best-effort — the refund itself still renders.
      }
      Map<String, PosRefundableLine> lineInfo = const {};
      try {
        final balance = await widget.refundsGateway.refundableBalance(
          refund.saleId,
        );
        lineInfo = {
          for (final line in balance.lines) line.saleItemId: line,
        };
      } on Object {
        lineInfo = const {}; // Best-effort — names fall back to "Artículo".
      }
      if (!mounted) return;
      setState(() {
        _refund = refund;
        _saleReceipt = saleReceipt;
        _lineInfo = lineInfo;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'No fue posible cargar el detalle de la devolución.';
      });
    }
  }

  Future<void> _print() async {
    final refund = _refund;
    final saleReceipt = _saleReceipt;
    if (refund == null || saleReceipt == null || _printing) return;
    setState(() {
      _printing = true;
      _printError = null;
    });
    final logoDataUri = await _receiptLogoDataUri();
    final html = buildRefundReceiptHtml(
      refund: refund,
      sale: saleReceipt.sale,
      business: saleReceipt.business,
      cashier: saleReceipt.cashier,
      lineInfoBySaleItemId: _lineInfo,
      logoDataUri: logoDataUri,
    );
    final opened = openReceiptPrintWindow(html);
    if (!mounted) return;
    setState(() {
      _printing = false;
      _printError = opened
          ? null
          : 'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para imprimir.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 560),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Detalle de devolución',
                      style: TextStyle(
                        color: palette.text,
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('pos-refunds-detail-close'),
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Flexible(
                child: SingleChildScrollView(
                  child: _loading
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 40),
                          child: Center(child: CircularProgressIndicator()),
                        )
                      : _errorMessage != null
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              _errorMessage!,
                              style: const TextStyle(
                                color: Colors.redAccent,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 6),
                            OutlinedButton(
                              key: const Key('pos-refunds-detail-retry'),
                              onPressed: () => unawaited(_load()),
                              child: const Text('Reintentar'),
                            ),
                          ],
                        )
                      : _RefundDetailBody(
                          refund: _refund!,
                          lineInfoBySaleItemId: _lineInfo,
                        ),
                ),
              ),
              if (_printError != null) ...[
                const SizedBox(height: 8),
                Text(
                  _printError!,
                  style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                ),
              ],
              const SizedBox(height: 14),
              OutlinedButton.icon(
                key: const Key('pos-refunds-detail-print'),
                onPressed: (_refund == null || _saleReceipt == null || _printing)
                    ? null
                    : () => unawaited(_print()),
                style: OutlinedButton.styleFrom(
                  foregroundColor: palette.textSecondary,
                  side: BorderSide(color: palette.border),
                ),
                icon: _printing
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.print_outlined, size: 16),
                label: const Text('Imprimir comprobante'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RefundDetailBody extends StatelessWidget {
  const _RefundDetailBody({
    required this.refund,
    required this.lineInfoBySaleItemId,
  });
  final PosRefund refund;
  final Map<String, PosRefundableLine> lineInfoBySaleItemId;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final items = refund.items ?? const <PosRefundItem>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _CashSummaryRow(label: 'Folio', value: refund.refundNumber, big: true),
        const SizedBox(height: 4),
        _CashSummaryRow(label: 'Estado', value: refund.status),
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'Motivo',
          value: _refundReasonLabels[refund.reasonCode] ?? refund.reasonCode,
        ),
        if (refund.reasonNote != null && refund.reasonNote!.isNotEmpty) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(label: 'Nota', value: refund.reasonNote!),
        ],
        const SizedBox(height: 14),
        Text(
          'ARTÍCULOS',
          style: TextStyle(
            color: palette.textSecondary,
            fontWeight: FontWeight.w800,
            fontSize: 11,
          ),
        ),
        Divider(color: palette.border, height: 16),
        for (final item in items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    lineInfoBySaleItemId[item.saleItemId]?.nameSnapshot ??
                        'Artículo',
                    style: TextStyle(color: palette.text, fontSize: 12),
                  ),
                ),
                Text(
                  _formatMoney(item.lineTotal, refund.currencyCode),
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 10),
        Divider(color: palette.border, height: 16),
        _CashSummaryRow(
          label: 'Subtotal',
          value: _formatMoney(refund.subtotal, refund.currencyCode),
        ),
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'IVA',
          value: _formatMoney(refund.taxTotal, refund.currencyCode),
        ),
        const SizedBox(height: 4),
        _CashSummaryRow(
          label: 'Total',
          value: _formatMoney(refund.total, refund.currencyCode),
          big: true,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------
// TASK 12.9 — Cupones / Promos admin (`PosModule.promotions`). Minimum
// operational management only (list/create/edit/activate) — never a
// marketing analytics/usage-ranking dashboard (ADR-0016 D15/Part U).
// Mirrors `_Devoluciones`'s own self-contained gateway-call/loading-state
// pattern. Never hardcodes a specific business promotion/coupon name —
// generic CRUD over whatever data the backend returns.
// ---------------------------------------------------------------------

String _formatShortDate(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year}';
}

enum _AdminListPhase { loading, ready, empty, failure }

class _PromotionsAdmin extends StatefulWidget {
  const _PromotionsAdmin({required this.context, required this.promotionsGateway});
  final AuthenticatedContext context;
  final PosPromotionsGateway promotionsGateway;

  @override
  State<_PromotionsAdmin> createState() => _PromotionsAdminState();
}

class _PromotionsAdminState extends State<_PromotionsAdmin> {
  String _tab = 'promotions';

  _AdminListPhase _promotionsPhase = _AdminListPhase.loading;
  List<PosPromotion> _promotions = const [];
  String? _promotionsNextCursor;
  bool _promotionsLoadingMore = false;
  String? _promotionsError;

  _AdminListPhase _couponsPhase = _AdminListPhase.loading;
  List<PosCoupon> _coupons = const [];
  String? _couponsNextCursor;
  bool _couponsLoadingMore = false;
  String? _couponsError;

  bool get _canReadPromotions => widget.context.permissions.contains('promotion.read');
  bool get _canManagePromotions => widget.context.permissions.contains('promotion.manage');
  bool get _canReadCoupons => widget.context.permissions.contains('coupon.read');
  bool get _canManageCoupons => widget.context.permissions.contains('coupon.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_loadPromotions());
    unawaited(_loadCoupons());
  }

  Future<void> _loadPromotions() async {
    if (!_canReadPromotions) return;
    setState(() {
      _promotionsPhase = _AdminListPhase.loading;
      _promotionsError = null;
    });
    try {
      final page = await widget.promotionsGateway.listPromotions();
      if (!mounted) return;
      setState(() {
        _promotions = page.items;
        _promotionsNextCursor = page.nextCursor;
        _promotionsPhase = _promotions.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _promotionsPhase = _AdminListPhase.failure;
        _promotionsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _promotionsPhase = _AdminListPhase.failure;
        _promotionsError = 'No fue posible cargar las promociones.';
      });
    }
  }

  Future<void> _loadMorePromotions() async {
    final cursor = _promotionsNextCursor;
    if (cursor == null || _promotionsLoadingMore) return;
    setState(() => _promotionsLoadingMore = true);
    try {
      final page = await widget.promotionsGateway.listPromotions(cursor: cursor);
      if (!mounted) return;
      setState(() {
        _promotions = [..._promotions, ...page.items];
        _promotionsNextCursor = page.nextCursor;
        _promotionsLoadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _promotionsLoadingMore = false);
    }
  }

  Future<void> _loadCoupons() async {
    if (!_canReadCoupons) return;
    setState(() {
      _couponsPhase = _AdminListPhase.loading;
      _couponsError = null;
    });
    try {
      final page = await widget.promotionsGateway.listCoupons();
      if (!mounted) return;
      setState(() {
        _coupons = page.items;
        _couponsNextCursor = page.nextCursor;
        _couponsPhase = _coupons.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _couponsPhase = _AdminListPhase.failure;
        _couponsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _couponsPhase = _AdminListPhase.failure;
        _couponsError = 'No fue posible cargar los cupones.';
      });
    }
  }

  Future<void> _loadMoreCoupons() async {
    final cursor = _couponsNextCursor;
    if (cursor == null || _couponsLoadingMore) return;
    setState(() => _couponsLoadingMore = true);
    try {
      final page = await widget.promotionsGateway.listCoupons(cursor: cursor);
      if (!mounted) return;
      setState(() {
        _coupons = [..._coupons, ...page.items];
        _couponsNextCursor = page.nextCursor;
        _couponsLoadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _couponsLoadingMore = false);
    }
  }

  Future<void> _openPromotionForm({PosPromotion? existing}) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) =>
          _PromotionFormDialog(promotionsGateway: widget.promotionsGateway, existing: existing),
    );
    if (saved == true) unawaited(_loadPromotions());
  }

  Future<void> _openCouponForm({PosCoupon? existing}) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CouponFormDialog(promotionsGateway: widget.promotionsGateway, existing: existing),
    );
    if (saved == true) unawaited(_loadCoupons());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Cupones / Promos',
          description: 'Promociones automáticas y cupones — administración mínima: '
              'listar, crear, editar y activar/desactivar.',
          action: _ReadOnlyButton(
            onPressed: () {
              unawaited(_loadPromotions());
              unawaited(_loadCoupons());
            },
          ),
        ),
        Row(
          children: [
            Expanded(
              child: _AdminTabButton(
                buttonKey: const Key('pos-promotions-tab-promotions'),
                label: 'Promociones',
                active: _tab == 'promotions',
                onTap: () => setState(() => _tab = 'promotions'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _AdminTabButton(
                buttonKey: const Key('pos-promotions-tab-coupons'),
                label: 'Cupones',
                active: _tab == 'coupons',
                onTap: () => setState(() => _tab = 'coupons'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (_tab == 'promotions') ...[
          if (_canManagePromotions)
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: FilledButton.icon(
                  key: const Key('pos-promotion-new'),
                  onPressed: () => unawaited(_openPromotionForm()),
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Nueva promoción'),
                ),
              ),
            ),
          if (!_canReadPromotions)
            const _PermissionState()
          else
            switch (_promotionsPhase) {
              _AdminListPhase.loading => const _LoadingState(),
              _AdminListPhase.empty => const _EmptyState(message: 'No hay promociones registradas.'),
              _AdminListPhase.failure => _FailureState(
                message: _promotionsError ?? 'No fue posible cargar las promociones.',
                onRetry: () => unawaited(_loadPromotions()),
              ),
              _AdminListPhase.ready => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final promotion in _promotions)
                    _PromotionRow(
                      promotion: promotion,
                      canManage: _canManagePromotions,
                      onEdit: () => unawaited(_openPromotionForm(existing: promotion)),
                    ),
                  if (_promotionsNextCursor != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Center(
                        child: OutlinedButton.icon(
                          key: const Key('pos-promotions-load-more'),
                          onPressed: _promotionsLoadingMore ? null : () => unawaited(_loadMorePromotions()),
                          icon: _promotionsLoadingMore
                              ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.expand_more),
                          label: const Text('Cargar más'),
                        ),
                      ),
                    ),
                ],
              ),
            },
        ] else ...[
          if (_canManageCoupons)
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: FilledButton.icon(
                  key: const Key('pos-coupon-new'),
                  onPressed: () => unawaited(_openCouponForm()),
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Nuevo cupón'),
                ),
              ),
            ),
          if (!_canReadCoupons)
            const _PermissionState()
          else
            switch (_couponsPhase) {
              _AdminListPhase.loading => const _LoadingState(),
              _AdminListPhase.empty => const _EmptyState(message: 'No hay cupones registrados.'),
              _AdminListPhase.failure => _FailureState(
                message: _couponsError ?? 'No fue posible cargar los cupones.',
                onRetry: () => unawaited(_loadCoupons()),
              ),
              _AdminListPhase.ready => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final coupon in _coupons)
                    _CouponRow(
                      coupon: coupon,
                      canManage: _canManageCoupons,
                      onEdit: () => unawaited(_openCouponForm(existing: coupon)),
                    ),
                  if (_couponsNextCursor != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Center(
                        child: OutlinedButton.icon(
                          key: const Key('pos-coupons-load-more'),
                          onPressed: _couponsLoadingMore ? null : () => unawaited(_loadMoreCoupons()),
                          icon: _couponsLoadingMore
                              ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.expand_more),
                          label: const Text('Cargar más'),
                        ),
                      ),
                    ),
                ],
              ),
            },
        ],
      ],
    );
  }
}

class _AdminTabButton extends StatelessWidget {
  const _AdminTabButton({
    required this.buttonKey,
    required this.label,
    required this.active,
    required this.onTap,
  });
  final Key buttonKey;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton(
      key: buttonKey,
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        backgroundColor: active ? palette.action : null,
        foregroundColor: active ? Colors.white : palette.textSecondary,
        side: BorderSide(color: active ? palette.action : palette.border),
      ),
      child: Text(label),
    );
  }
}

class _PromotionRow extends StatelessWidget {
  const _PromotionRow({required this.promotion, required this.canManage, required this.onEdit});
  final PosPromotion promotion;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final validity = [
      if (promotion.startsAt != null) 'Desde ${_formatShortDate(promotion.startsAt!)}',
      if (promotion.endsAt != null) 'Hasta ${_formatShortDate(promotion.endsAt!)}',
    ].join(' · ');
    return _PosCard(
      key: Key('pos-promotion-row-${promotion.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(promotion.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(promotion.benefitSummary, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                  if (validity.isNotEmpty)
                    Text(validity, style: TextStyle(color: palette.textMuted, fontSize: 11)),
                ],
              ),
            ),
            _StatusChip(label: promotion.active ? 'active' : 'inactive'),
            if (canManage)
              IconButton(
                key: Key('pos-promotion-edit-${promotion.id}'),
                tooltip: 'Editar promoción',
                onPressed: onEdit,
                icon: Icon(Icons.edit_outlined, size: 18, color: palette.blueDeep),
              ),
          ],
        ),
      ),
    );
  }
}

class _CouponRow extends StatelessWidget {
  const _CouponRow({required this.coupon, required this.canManage, required this.onEdit});
  final PosCoupon coupon;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final validity = [
      if (coupon.startsAt != null) 'Desde ${_formatShortDate(coupon.startsAt!)}',
      if (coupon.endsAt != null) 'Hasta ${_formatShortDate(coupon.endsAt!)}',
      // Only the configured limit, never a fabricated usage count (no GET
      // response exposes one today — ADR-0016 Part U).
      if (coupon.usageLimitTotal != null) 'Límite: ${coupon.usageLimitTotal}',
    ].join(' · ');
    return _PosCard(
      key: Key('pos-coupon-row-${coupon.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(coupon.code, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  const SizedBox(height: 2),
                  Text(coupon.benefitSummary, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                  if (validity.isNotEmpty)
                    Text(validity, style: TextStyle(color: palette.textMuted, fontSize: 11)),
                ],
              ),
            ),
            _StatusChip(label: coupon.active ? 'active' : 'inactive'),
            if (canManage)
              IconButton(
                key: Key('pos-coupon-edit-${coupon.id}'),
                tooltip: 'Editar cupón',
                onPressed: onEdit,
                icon: Icon(Icons.edit_outlined, size: 18, color: palette.blueDeep),
              ),
          ],
        ),
      ),
    );
  }
}

/// TASK 12.9: the shared create/edit form fields (name-or-code,
/// description, benefit type + conditional value, active toggle, optional
/// validity dates) — never anything beyond ADR-0016 Part U's "minimum
/// operational management" scope.
class _PromotionFormDialog extends StatefulWidget {
  const _PromotionFormDialog({required this.promotionsGateway, this.existing});
  final PosPromotionsGateway promotionsGateway;
  final PosPromotion? existing;

  @override
  State<_PromotionFormDialog> createState() => _PromotionFormDialogState();
}

class _PromotionFormDialogState extends State<_PromotionFormDialog> {
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _descriptionController = TextEditingController(text: widget.existing?.description ?? '');
  late String _benefitType = widget.existing?.benefitType ?? 'percentage';
  late final _percentController = TextEditingController(
    text: widget.existing?.benefitPercentageBasisPoints == null
        ? ''
        : (widget.existing!.benefitPercentageBasisPoints! / 100).toString(),
  );
  late final _fixedAmountController = TextEditingController(text: widget.existing?.benefitFixedAmount ?? '');
  late final _nxmBuyController =
      TextEditingController(text: widget.existing?.benefitNxmBuyQuantity?.toString() ?? '');
  late final _nxmPayController =
      TextEditingController(text: widget.existing?.benefitNxmPayQuantity?.toString() ?? '');
  late bool _active = widget.existing?.active ?? true;
  DateTime? _startsAt;
  DateTime? _endsAt;
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _startsAt = widget.existing?.startsAt;
    _endsAt = widget.existing?.endsAt;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _percentController.dispose();
    _fixedAmountController.dispose();
    _nxmBuyController.dispose();
    _nxmPayController.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isStart ? _startsAt : _endsAt) ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 5),
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startsAt = picked;
      } else {
        _endsAt = picked;
      }
    });
  }

  PosPromotionInput? _buildInput() {
    final name = _nameController.text.trim();
    if (name.isEmpty) return null;
    int? basisPoints;
    String? fixedAmount;
    int? nxmBuy;
    int? nxmPay;
    if (_benefitType == 'percentage') {
      final percent = double.tryParse(_percentController.text.trim());
      if (percent == null || percent <= 0 || percent > 100) return null;
      basisPoints = (percent * 100).round();
    } else if (_benefitType == 'fixed_amount' || _benefitType == 'fixed_price') {
      try {
        final amount = Money.parse(_fixedAmountController.text.trim(), 'MXN');
        if (!amount.isPositive) return null;
        fixedAmount = amount.toApiString();
      } on MoneyFormatException {
        return null;
      }
    } else if (_benefitType == 'quantity_nxm') {
      nxmBuy = int.tryParse(_nxmBuyController.text.trim());
      nxmPay = int.tryParse(_nxmPayController.text.trim());
      if (nxmBuy == null || nxmPay == null || nxmBuy <= 0 || nxmPay <= 0 || nxmPay >= nxmBuy) {
        return null;
      }
    }
    return PosPromotionInput(
      name: name,
      description: _descriptionController.text.trim().isEmpty ? null : _descriptionController.text.trim(),
      active: _active,
      startsAt: _startsAt,
      endsAt: _endsAt,
      benefitType: _benefitType,
      benefitPercentageBasisPoints: basisPoints,
      benefitFixedAmount: fixedAmount,
      benefitNxmBuyQuantity: nxmBuy,
      benefitNxmPayQuantity: nxmPay,
    );
  }

  Future<void> _submit() async {
    final input = _buildInput();
    if (input == null) {
      setState(() => _error = 'Revisa los campos del formulario.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_isEdit) {
        await widget.promotionsGateway.updatePromotion(widget.existing!.id, input, version: widget.existing!.version);
      } else {
        await widget.promotionsGateway.createPromotion(input);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar la promoción.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 620),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar promoción' : 'Nueva promoción',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-promotion-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _descriptionController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('pos-promotion-benefit-type'),
                  initialValue: _benefitType,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Tipo de beneficio'),
                  items: const [
                    DropdownMenuItem(value: 'percentage', child: Text('Porcentaje')),
                    DropdownMenuItem(value: 'fixed_amount', child: Text('Monto fijo')),
                    DropdownMenuItem(value: 'fixed_price', child: Text('Precio fijo')),
                    DropdownMenuItem(value: 'quantity_nxm', child: Text('Nxm (ej. 2x1)')),
                  ],
                  onChanged: (value) => setState(() => _benefitType = value ?? 'percentage'),
                ),
                const SizedBox(height: 10),
                if (_benefitType == 'percentage')
                  TextField(
                    key: const Key('pos-promotion-value-percentage'),
                    controller: _percentController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(isDense: true, labelText: 'Porcentaje (%)'),
                  ),
                if (_benefitType == 'fixed_amount' || _benefitType == 'fixed_price')
                  TextField(
                    key: const Key('pos-promotion-value-fixed'),
                    controller: _fixedAmountController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(isDense: true, labelText: 'Monto (\$)'),
                  ),
                if (_benefitType == 'quantity_nxm')
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('pos-promotion-nxm-buy'),
                          controller: _nxmBuyController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(isDense: true, labelText: 'Compra (N)'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          key: const Key('pos-promotion-nxm-pay'),
                          controller: _nxmPayController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(isDense: true, labelText: 'Paga (M)'),
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: 6),
                SwitchListTile(
                  key: const Key('pos-promotion-active'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Activa'),
                  value: _active,
                  onChanged: (value) => setState(() => _active = value),
                ),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-promotion-starts-at'),
                        onPressed: () => unawaited(_pickDate(isStart: true)),
                        child: Text(_startsAt == null ? 'Inicio (opcional)' : _formatShortDate(_startsAt!)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-promotion-ends-at'),
                        onPressed: () => unawaited(_pickDate(isStart: false)),
                        child: Text(_endsAt == null ? 'Fin (opcional)' : _formatShortDate(_endsAt!)),
                      ),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-promotion-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.textSecondary,
                          side: BorderSide(color: palette.border),
                        ),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-promotion-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// TASK 12.9: coupon create/edit — `code`/`benefit_type`/value are only
/// editable at creation (the backend's own `PUT /coupons/{id}` body never
/// accepts them, see `promotions.routes.ts`) — shown read-only while
/// editing rather than silently ignored.
class _CouponFormDialog extends StatefulWidget {
  const _CouponFormDialog({required this.promotionsGateway, this.existing});
  final PosPromotionsGateway promotionsGateway;
  final PosCoupon? existing;

  @override
  State<_CouponFormDialog> createState() => _CouponFormDialogState();
}

class _CouponFormDialogState extends State<_CouponFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _descriptionController = TextEditingController(text: widget.existing?.description ?? '');
  late String _benefitType = widget.existing?.benefitType ?? 'percentage';
  late final _percentController = TextEditingController(
    text: widget.existing?.benefitPercentageBasisPoints == null
        ? ''
        : (widget.existing!.benefitPercentageBasisPoints! / 100).toString(),
  );
  late final _fixedAmountController = TextEditingController(text: widget.existing?.benefitFixedAmount ?? '');
  late bool _active = widget.existing?.active ?? true;
  DateTime? _startsAt;
  DateTime? _endsAt;
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _startsAt = widget.existing?.startsAt;
    _endsAt = widget.existing?.endsAt;
  }

  @override
  void dispose() {
    _codeController.dispose();
    _descriptionController.dispose();
    _percentController.dispose();
    _fixedAmountController.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isStart ? _startsAt : _endsAt) ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 5),
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startsAt = picked;
      } else {
        _endsAt = picked;
      }
    });
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    if (_isEdit) {
      final input = PosCouponUpdateInput(
        description: _descriptionController.text.trim().isEmpty ? null : _descriptionController.text.trim(),
        active: _active,
        startsAt: _startsAt,
        endsAt: _endsAt,
      );
      try {
        await widget.promotionsGateway.updateCoupon(widget.existing!.id, input, version: widget.existing!.version);
        if (!mounted) return;
        Navigator.of(context).pop(true);
      } on ApiException catch (error) {
        if (!mounted) return;
        setState(() {
          _busy = false;
          _error = error.failure.message;
        });
      } on Object {
        if (!mounted) return;
        setState(() {
          _busy = false;
          _error = 'No fue posible guardar el cupón.';
        });
      }
      return;
    }
    final code = _codeController.text.trim();
    if (code.isEmpty) {
      setState(() {
        _busy = false;
        _error = 'Escribe un código.';
      });
      return;
    }
    int? basisPoints;
    String? fixedAmount;
    if (_benefitType == 'percentage') {
      final percent = double.tryParse(_percentController.text.trim());
      if (percent == null || percent <= 0 || percent > 100) {
        setState(() {
          _busy = false;
          _error = 'Porcentaje inválido.';
        });
        return;
      }
      basisPoints = (percent * 100).round();
    } else {
      try {
        final amount = Money.parse(_fixedAmountController.text.trim(), 'MXN');
        if (!amount.isPositive) {
          setState(() {
            _busy = false;
            _error = 'Monto inválido.';
          });
          return;
        }
        fixedAmount = amount.toApiString();
      } on MoneyFormatException {
        setState(() {
          _busy = false;
          _error = 'Monto inválido.';
        });
        return;
      }
    }
    final input = PosCouponInput(
      code: code,
      description: _descriptionController.text.trim().isEmpty ? null : _descriptionController.text.trim(),
      benefitType: _benefitType,
      benefitPercentageBasisPoints: basisPoints,
      benefitFixedAmount: fixedAmount,
      active: _active,
      startsAt: _startsAt,
      endsAt: _endsAt,
    );
    try {
      await widget.promotionsGateway.createCoupon(input);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar el cupón.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 620),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar cupón' : 'Nuevo cupón',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-coupon-code'),
                  controller: _codeController,
                  readOnly: _isEdit,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _descriptionController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
                ),
                const SizedBox(height: 10),
                if (_isEdit)
                  Text(
                    'Beneficio: ${widget.existing!.benefitSummary} (no editable)',
                    style: TextStyle(color: palette.textMuted, fontSize: 12),
                  )
                else ...[
                  DropdownButtonFormField<String>(
                    key: const Key('pos-coupon-benefit-type'),
                    initialValue: _benefitType,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Tipo de beneficio'),
                    items: const [
                      DropdownMenuItem(value: 'percentage', child: Text('Porcentaje')),
                      DropdownMenuItem(value: 'fixed_amount', child: Text('Monto fijo')),
                    ],
                    onChanged: (value) => setState(() => _benefitType = value ?? 'percentage'),
                  ),
                  const SizedBox(height: 10),
                  if (_benefitType == 'percentage')
                    TextField(
                      key: const Key('pos-coupon-value-percentage'),
                      controller: _percentController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(isDense: true, labelText: 'Porcentaje (%)'),
                    )
                  else
                    TextField(
                      key: const Key('pos-coupon-value-fixed'),
                      controller: _fixedAmountController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(isDense: true, labelText: 'Monto (\$)'),
                    ),
                ],
                const SizedBox(height: 6),
                SwitchListTile(
                  key: const Key('pos-coupon-active'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Activo'),
                  value: _active,
                  onChanged: (value) => setState(() => _active = value),
                ),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-coupon-starts-at'),
                        onPressed: () => unawaited(_pickDate(isStart: true)),
                        child: Text(_startsAt == null ? 'Inicio (opcional)' : _formatShortDate(_startsAt!)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-coupon-ends-at'),
                        onPressed: () => unawaited(_pickDate(isStart: false)),
                        child: Text(_endsAt == null ? 'Fin (opcional)' : _formatShortDate(_endsAt!)),
                      ),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-coupon-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.textSecondary,
                          side: BorderSide(color: palette.border),
                        ),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-coupon-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ComingSoon extends StatelessWidget {
  const _ComingSoon({required this.module});
  final PosModule module;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: module.label,
          description:
              'Módulo visible para preservar la navegación canónica de AS POS.',
        ),
        _PosCard(
          child: SizedBox(
            height: 260,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(module.icon, size: 46, color: palette.blueDeep),
                  const SizedBox(height: 14),
                  Text(
                    'Coming soon',
                    style: TextStyle(
                      color: palette.text,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    'Esta sección aún no tiene funcionalidad habilitada.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: palette.textSecondary),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ReadState<T> extends StatelessWidget {
  const _ReadState({
    required this.state,
    required this.emptyMessage,
    required this.onRetry,
    required this.ready,
  });
  final PosReadState<T> state;
  final String emptyMessage;
  final VoidCallback onRetry;
  final Widget Function(List<T>) ready;

  @override
  Widget build(BuildContext context) => switch (state.phase) {
    PosReadPhase.idle || PosReadPhase.loading => const _LoadingState(),
    PosReadPhase.empty => _EmptyState(message: emptyMessage),
    PosReadPhase.failure => _FailureState(
      message: state.message ?? 'No fue posible cargar la información.',
      onRetry: onRetry,
    ),
    PosReadPhase.ready => ready(state.items),
  };
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();
  @override
  Widget build(BuildContext context) => const _PosCard(
    child: SizedBox(
      height: 180,
      child: Center(child: CircularProgressIndicator()),
    ),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => _StateCard(
    icon: Icons.inbox_outlined,
    title: 'Sin información',
    message: message,
  );
}

class _PermissionState extends StatelessWidget {
  const _PermissionState();
  @override
  Widget build(BuildContext context) => const _StateCard(
    icon: Icons.lock_outline,
    title: 'Acceso no autorizado',
    message: 'Tu sesión no incluye el permiso de lectura requerido.',
  );
}

class _FailureState extends StatelessWidget {
  const _FailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => _StateCard(
    icon: Icons.error_outline,
    title: 'No fue posible cargar',
    message: message,
    action: TextButton.icon(
      onPressed: onRetry,
      icon: const Icon(Icons.refresh),
      label: const Text('Reintentar'),
    ),
  );
}

class _StateCard extends StatelessWidget {
  const _StateCard({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      child: SizedBox(
        height: 180,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 38, color: palette.blueDeep),
              const SizedBox(height: 10),
              Text(
                title,
                style: TextStyle(
                  color: palette.text,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                message,
                textAlign: TextAlign.center,
                style: TextStyle(color: palette.textSecondary),
              ),
              if (action != null) ...[const SizedBox(height: 8), action!],
            ],
          ),
        ),
      ),
    );
  }
}

class _ReadOnlyButton extends StatelessWidget {
  const _ReadOnlyButton({required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.refresh, size: 17),
      label: const Text('Actualizar'),
      style: OutlinedButton.styleFrom(
        foregroundColor: palette.blueDeep,
        side: BorderSide(color: palette.border),
        minimumSize: const Size(36, 36),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
      ),
    );
  }
}

class _VisualDialogButton extends StatelessWidget {
  const _VisualDialogButton();

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton.icon(
      key: const Key('pos-read-only-dialog'),
      onPressed: () => showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Row(
            children: [
              Icon(Icons.visibility_outlined),
              SizedBox(width: 9),
              Text('Modo de solo lectura'),
            ],
          ),
          content: const Text(
            'Esta base visual no permite ventas, pagos, cambios de inventario ni otras transacciones.',
          ),
          actions: [
            TextButton(
              onPressed: Navigator.of(context).pop,
              child: const Text('Entendido'),
            ),
          ],
        ),
      ),
      icon: const Icon(Icons.info_outline, size: 17),
      label: const Text('Solo lectura'),
      style: OutlinedButton.styleFrom(
        foregroundColor: palette.blueDeep,
        side: BorderSide(color: palette.border),
        minimumSize: const Size(36, 36),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final active = label == 'active';
    final color = active ? palette.success : palette.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

String _compactId(String value) =>
    value.length <= 12 ? value : '${value.substring(0, 8)}…';

/// TASK 12.8: composes a sale's derived `refund_state` (ADR-0015 D14)
/// onto an existing status label — additive only, e.g. "Completada ·
/// devolución parcial" — never a replacement for the real `status` value.
/// `not_refunded`/`null` (a caller that never looked it up) adds nothing.
String _refundStateSuffix(String? refundState) => switch (refundState) {
  'partially_refunded' => ' · devolución parcial',
  'fully_refunded' => ' · reembolsada',
  _ => '',
};

// ---------------------------------------------------------------------
// TASK 12.7 — Caja (cash register operations). Wired into the existing,
// pre-reserved `PosModule.cash` slot (Part M) — no second, parallel Caja
// entry. Every money figure shown here is exactly what the backend
// returned (Part H/I: "Flutter displays the backend result only") — this
// file never computes an expected-cash total or a closing difference
// itself. See `pos_cash_gateway.dart` and ADR-0014.
// ---------------------------------------------------------------------

String _formatMoney(String raw, String currencyCode) {
  final trimmed = raw.trim();
  final negative = trimmed.startsWith('-');
  final magnitude = negative ? trimmed.substring(1) : trimmed;
  try {
    final money = Money.parse(magnitude, currencyCode);
    return '${negative ? '-' : ''}\$${money.toDisplayString()}';
  } on MoneyFormatException {
    return raw;
  }
}

String _formatClockTime(DateTime value) {
  final local = value.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

String _formatCajaDate(DateTime value) {
  final local = value.toLocal();
  return '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}/${local.year} ${_formatClockTime(value)}';
}

enum _CajaTab { current, history }

class _Caja extends StatefulWidget {
  const _Caja({super.key, required this.context, required this.cashGateway});
  final AuthenticatedContext context;
  final PosCashGateway cashGateway;

  @override
  State<_Caja> createState() => _CajaState();
}

class _CajaState extends State<_Caja> {
  _CajaTab _tab = _CajaTab.current;

  @override
  Widget build(BuildContext context) {
    final canRead = widget.context.permissions.contains('cash_session.read');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Caja',
          description:
              'Apertura, movimientos y cierre de caja — datos reales del backend.',
          action: canRead
              ? SegmentedButton<_CajaTab>(
                  key: const Key('pos-caja-tabs'),
                  segments: const [
                    ButtonSegment(
                      value: _CajaTab.current,
                      label: Text('Caja actual'),
                    ),
                    ButtonSegment(
                      value: _CajaTab.history,
                      label: Text('Cortes de caja'),
                    ),
                  ],
                  selected: {_tab},
                  onSelectionChanged: (value) =>
                      setState(() => _tab = value.first),
                )
              : null,
        ),
        if (!canRead)
          const _PermissionState()
        else if (_tab == _CajaTab.current)
          _CajaCurrent(context: widget.context, cashGateway: widget.cashGateway)
        else
          _CutHistory(context: widget.context, cashGateway: widget.cashGateway),
      ],
    );
  }
}

enum _CajaPhase { loading, noRegister, closed, open, failure }

/// The current-drawer view (Part M's own mockup): closed state prompts
/// "Abrir caja"; open state shows the exact fields the mockup lists
/// (Caja/Sucursal/Cajero/Abierta/Fondo inicial/Efectivo esperado) plus
/// Entrada/Salida/Cerrar caja actions and the movement history below.
class _CajaCurrent extends StatefulWidget {
  const _CajaCurrent({required this.context, required this.cashGateway});
  final AuthenticatedContext context;
  final PosCashGateway cashGateway;

  @override
  State<_CajaCurrent> createState() => _CajaCurrentState();
}

class _CajaCurrentState extends State<_CajaCurrent> {
  _CajaPhase _phase = _CajaPhase.loading;
  List<PosCashRegister> _registers = const [];
  PosCashRegister? _selectedRegister;
  PosCashSession? _session;
  PosCashSessionSummary? _summary;
  List<PosCashMovement> _movements = const [];
  // TASK 14.4 (Wave 2, Part F.4) — owned the same way `_movements` is:
  // loaded alongside the session and passed down to `_CajaOpenView`,
  // refreshed after a new partial close is taken.
  List<PosCashSessionPartialClose> _partialCloses = const [];
  String? _errorMessage;

  String? get _branchId => widget.context.session.branchId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _phase = _CajaPhase.loading;
      _errorMessage = null;
    });
    final branchId = _branchId;
    if (branchId == null) {
      setState(() {
        _phase = _CajaPhase.failure;
        _errorMessage = 'Esta sesión no tiene una sucursal asignada.';
      });
      return;
    }
    try {
      final registers = await widget.cashGateway.registersForBranch(branchId);
      if (!mounted) return;
      if (registers.isEmpty) {
        setState(() {
          _registers = registers;
          _phase = _CajaPhase.noRegister;
        });
        return;
      }
      _selectedRegister ??= registers.first;
      final selected = registers.firstWhere(
        (candidate) => candidate.id == _selectedRegister!.id,
        orElse: () => registers.first,
      );
      setState(() {
        _registers = registers;
        _selectedRegister = selected;
      });
      await _loadSessionForSelectedRegister();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _CajaPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _CajaPhase.failure;
        _errorMessage = 'No fue posible cargar la caja.';
      });
    }
  }

  Future<void> _loadSessionForSelectedRegister() async {
    final register = _selectedRegister;
    if (register == null) return;
    try {
      final session = await widget.cashGateway.currentSession(register.id);
      if (!mounted) return;
      if (session == null) {
        setState(() {
          _session = null;
          _summary = null;
          _movements = const [];
          _partialCloses = const [];
          _phase = _CajaPhase.closed;
        });
        return;
      }
      final summary = await widget.cashGateway.summary(session.id);
      final movementsPage = await widget.cashGateway.listMovements(session.id);
      final partialCloses = await widget.cashGateway.listPartialCloses(session.id);
      if (!mounted) return;
      setState(() {
        _session = session;
        _summary = summary;
        _movements = movementsPage.items;
        _partialCloses = partialCloses;
        _phase = _CajaPhase.open;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _CajaPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _CajaPhase.failure;
        _errorMessage = 'No fue posible cargar la sesión de caja.';
      });
    }
  }

  Future<void> _openRegister() async {
    final register = _selectedRegister;
    if (register == null) return;
    final opened = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _OpenCajaDialog(
        registers: _registers,
        initialRegister: register,
        cashGateway: widget.cashGateway,
      ),
    );
    if (opened == true) await _load();
  }

  Future<void> _postMovement(String movementType) async {
    final session = _session;
    if (session == null) return;
    final posted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CashMovementDialog(
        cashSessionId: session.id,
        movementType: movementType,
        currencyCode: session.currencyCode,
        cashGateway: widget.cashGateway,
      ),
    );
    if (posted == true) await _loadSessionForSelectedRegister();
  }

  Future<void> _closeRegister() async {
    final session = _session;
    final summary = _summary;
    if (session == null || summary == null) return;
    final closed = await showDialog<PosCashSession>(
      context: context,
      builder: (dialogContext) => _CloseCajaDialog(
        cashSessionId: session.id,
        currencyCode: session.currencyCode,
        expectedCash: summary.expectedCash,
        cashGateway: widget.cashGateway,
      ),
    );
    if (closed == null) return;
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _CloseResultDialog(session: closed),
    );
    await _load();
  }

  /// TASK 14.4 (Wave 2, Part F.3) — "Corte parcial": a real mutation (a
  /// persisted, audited snapshot) that CRITICALLY never transitions the
  /// session to closed — only `_loadSessionForSelectedRegister` (not
  /// `_load`'s own register-list re-fetch, and never any `_phase` write to
  /// `_CajaPhase.closed`) runs afterward, and that call itself only ever
  /// reads `currentSession`, which still reports `status: 'open'`.
  Future<void> _postPartialClose() async {
    final session = _session;
    final currencyCode = session?.currencyCode;
    if (session == null || currencyCode == null) return;
    final snapshot = await showDialog<PosCashSessionPartialClose>(
      context: context,
      builder: (dialogContext) => _PartialCloseDialog(
        cashSessionId: session.id,
        currencyCode: currencyCode,
        cashGateway: widget.cashGateway,
      ),
    );
    if (snapshot == null) return;
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) =>
          _PartialCloseResultDialog(snapshot: snapshot, currencyCode: currencyCode),
    );
    // The session's own status is untouched by a partial close — this
    // just re-reads the (still-open) session plus the fresh movement and
    // partial-close lists, never `_load()`'s own "closed/no register"
    // re-evaluation.
    await _loadSessionForSelectedRegister();
  }

  @override
  Widget build(BuildContext context) {
    switch (_phase) {
      case _CajaPhase.loading:
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: Center(child: CircularProgressIndicator()),
        );
      case _CajaPhase.failure:
        return _FailureState(
          message: _errorMessage ?? 'No fue posible cargar la caja.',
          onRetry: () => unawaited(_load()),
        );
      case _CajaPhase.noRegister:
        return const _StateCard(
          icon: Icons.point_of_sale_outlined,
          title: 'Sin caja configurada',
          message:
              'Esta sucursal no tiene una caja registrada. Contacta a un '
              'administrador para configurarla.',
        );
      case _CajaPhase.closed:
        final canOpen = widget.context.permissions.contains(
          'cash_session.open',
        );
        return _PosCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Icon(Icons.lock_outline, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _selectedRegister?.name ?? 'Caja',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                  const _StatusChip(label: 'closed'),
                ],
              ),
              const SizedBox(height: 10),
              const Text('Abre la caja para comenzar a cobrar en efectivo.'),
              const SizedBox(height: 12),
              if (canOpen)
                FilledButton.icon(
                  key: const Key('pos-caja-open-button'),
                  onPressed: _openRegister,
                  icon: const Icon(Icons.lock_open_outlined),
                  label: const Text('Abrir caja'),
                )
              else
                Text(
                  'Tu sesión no incluye el permiso para abrir la caja.',
                  style: TextStyle(color: PosPalette.of(context).textSecondary),
                ),
            ],
          ),
        );
      case _CajaPhase.open:
        return _CajaOpenView(
          context: widget.context,
          register: _selectedRegister!,
          session: _session!,
          summary: _summary!,
          movements: _movements,
          partialCloses: _partialCloses,
          onCashIn: () => unawaited(_postMovement('cash_in')),
          onCashOut: () => unawaited(_postMovement('cash_out')),
          onClose: _closeRegister,
          onPartialClose: () => unawaited(_postPartialClose()),
          onRefresh: () => unawaited(_loadSessionForSelectedRegister()),
        );
    }
  }
}

class _CajaOpenView extends StatelessWidget {
  const _CajaOpenView({
    required this.context,
    required this.register,
    required this.session,
    required this.summary,
    required this.movements,
    required this.partialCloses,
    required this.onCashIn,
    required this.onCashOut,
    required this.onClose,
    required this.onPartialClose,
    required this.onRefresh,
  });

  final AuthenticatedContext context;
  final PosCashRegister register;
  final PosCashSession session;
  final PosCashSessionSummary summary;
  final List<PosCashMovement> movements;
  // TASK 14.4 (Wave 2, Part F.4) — this session's own persisted "Corte
  // parcial" snapshots; see this class's own doc comment for the
  // placement decision (a section here rather than a top-level `_Caja`
  // tab, since `GET .../partial-closes` is itself scoped to one session,
  // never a cross-session/branch listing).
  final List<PosCashSessionPartialClose> partialCloses;
  final VoidCallback onCashIn;
  final VoidCallback onCashOut;
  final VoidCallback onClose;
  final VoidCallback onPartialClose;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branchName = this.context.currentBranch?.name ?? '—';
    final cashierName = this.context.user.displayName;
    final canMovement = this.context.permissions.contains(
      'cash_movement.create',
    );
    final canClose = this.context.permissions.contains('cash_session.close');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _PosCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Icon(Icons.point_of_sale_outlined, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      register.name,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                  const _StatusChip(label: 'active'),
                  IconButton(
                    tooltip: 'Actualizar',
                    onPressed: onRefresh,
                    icon: const Icon(Icons.refresh),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              _CajaInfoRow(label: 'Sucursal', value: branchName),
              _CajaInfoRow(label: 'Cajero', value: cashierName),
              _CajaInfoRow(
                label: 'Abierta',
                value: _formatClockTime(session.openedAt),
              ),
              _CajaInfoRow(
                label: 'Fondo inicial',
                value: _formatMoney(
                  summary.openingAmount,
                  session.currencyCode,
                ),
              ),
              const Divider(height: 20),
              _CajaInfoRow(
                label: 'Ventas en efectivo',
                value:
                    '${_formatMoney(summary.cashSalesTotal, session.currencyCode)} '
                    '(${summary.cashSalesCount})',
              ),
              _CajaInfoRow(
                label: 'Entradas',
                value: _formatMoney(summary.cashInTotal, session.currencyCode),
              ),
              _CajaInfoRow(
                label: 'Salidas',
                value: _formatMoney(summary.cashOutTotal, session.currencyCode),
              ),
              // TASK 14.4 (Wave 2, Part F.2) — named breakdowns, each a
              // strict subset already folded into Entradas/Salidas above;
              // real numbers straight from the summary response, never
              // fabricated or recomputed here.
              _CajaInfoRow(
                label: 'Retiros',
                value: _formatMoney(summary.withdrawalTotal, session.currencyCode),
              ),
              _CajaInfoRow(
                label: 'Gastos',
                value: _formatMoney(summary.expenseTotal, session.currencyCode),
              ),
              _CajaInfoRow(
                label: 'Ingresos externos',
                value: _formatMoney(summary.externalIncomeTotal, session.currencyCode),
              ),
              const Divider(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Efectivo esperado',
                    style: TextStyle(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                    ),
                  ),
                  Text(
                    _formatMoney(summary.expectedCash, session.currencyCode),
                    style: TextStyle(
                      color: palette.action,
                      fontWeight: FontWeight.w800,
                      fontSize: 17,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (canMovement) ...[
                    OutlinedButton.icon(
                      key: const Key('pos-caja-cash-in'),
                      onPressed: onCashIn,
                      icon: const Icon(Icons.add_circle_outline),
                      label: const Text('Entrada de efectivo'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('pos-caja-cash-out'),
                      onPressed: onCashOut,
                      icon: const Icon(Icons.remove_circle_outline),
                      label: const Text('Salida de efectivo'),
                    ),
                  ],
                  // TASK 14.4 (Wave 2, Part F.3) — same permission the
                  // real `POST .../partial-close` route requires
                  // (`cash_movement.create`, confirmed in
                  // `cash.routes.ts`) — deliberately NOT
                  // `cash_session.close`, since a "Corte parcial" is a
                  // pure snapshot that never closes the session, so it
                  // must stay reachable to an operator who explicitly
                  // cannot close it.
                  if (canMovement)
                    OutlinedButton.icon(
                      key: const Key('pos-caja-partial-close-button'),
                      onPressed: onPartialClose,
                      icon: const Icon(Icons.receipt_long_outlined),
                      label: const Text('Corte parcial'),
                    ),
                  if (canClose)
                    FilledButton.icon(
                      key: const Key('pos-caja-close-button'),
                      onPressed: onClose,
                      icon: const Icon(Icons.lock_outline),
                      label: const Text('Cerrar caja'),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _PosCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Movimientos de esta sesión',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              if (movements.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'Sin movimientos todavía.',
                    style: TextStyle(color: palette.textSecondary),
                  ),
                )
              else
                for (final movement in movements)
                  _CajaMovementRow(
                    movement: movement,
                    currencyCode: session.currencyCode,
                  ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        // TASK 14.4 (Wave 2, Part F.4) — "Cortes parciales" of THIS
        // session; placed here (a section of the current-session view)
        // rather than a separate top-level `_Caja` tab, since
        // `GET .../partial-closes` is itself scoped to one
        // `cash_session_id` — there is no cross-session/branch listing
        // route to back a `_CutHistory`-shaped tab with.
        _PosCard(
          key: const Key('pos-caja-partial-closes'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Cortes parciales de esta sesión',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              if (partialCloses.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'Sin cortes parciales todavía.',
                    style: TextStyle(color: palette.textSecondary),
                  ),
                )
              else
                for (final snapshot in partialCloses)
                  _PartialCloseRow(snapshot: snapshot, currencyCode: session.currencyCode),
            ],
          ),
        ),
      ],
    );
  }
}

class _CajaInfoRow extends StatelessWidget {
  const _CajaInfoRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(color: palette.textSecondary, fontSize: 12),
          ),
          Text(
            value,
            style: TextStyle(
              color: palette.text,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

const _movementTypeLabels = <String, String>{
  'opening_float': 'Fondo inicial',
  'cash_sale': 'Venta en efectivo',
  'cash_in': 'Entrada de efectivo',
  'cash_out': 'Salida de efectivo',
};

/// TASK 14.4 (Wave 2, Part F.1) — display labels for
/// `posCashMovementCategories`, in the same order.
const _movementCategoryLabels = <String, String>{
  'withdrawal': 'Retiro',
  'expense': 'Gasto',
  'external_income': 'Ingreso externo',
  'other': 'Otro',
};

class _CajaMovementRow extends StatelessWidget {
  const _CajaMovementRow({required this.movement, required this.currencyCode});
  final PosCashMovement movement;
  final String currencyCode;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final negative = movement.movementType == 'cash_out';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(
            negative ? Icons.arrow_downward : Icons.arrow_upward,
            size: 15,
            color: negative ? palette.warning : palette.success,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  movement.category == null
                      ? (_movementTypeLabels[movement.movementType] ?? movement.movementType)
                      : '${_movementTypeLabels[movement.movementType] ?? movement.movementType} · '
                            '${_movementCategoryLabels[movement.category] ?? movement.category}',
                  style: TextStyle(
                    color: palette.text,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
                Text(
                  '${movement.reasonCode}${movement.note == null ? '' : ' — ${movement.note}'} · '
                  '${_formatClockTime(movement.occurredAt)}',
                  style: TextStyle(color: palette.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          Text(
            '${negative ? '-' : '+'}${_formatMoney(movement.amount, currencyCode)}',
            style: TextStyle(
              color: negative ? palette.warning : palette.success,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

/// TASK 14.4 (Wave 2, Part F.4) — one persisted "Corte parcial" snapshot
/// row, mirroring `_CajaMovementRow`'s own compact-row shape.
class _PartialCloseRow extends StatelessWidget {
  const _PartialCloseRow({required this.snapshot, required this.currencyCode});
  final PosCashSessionPartialClose snapshot;
  final String currencyCode;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      key: ValueKey('pos-caja-partial-close-row-${snapshot.id}'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(Icons.receipt_long_outlined, size: 15, color: palette.textSecondary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _formatCajaDate(snapshot.takenAt),
              style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 12),
            ),
          ),
          Text(
            'Esperado: ${_formatMoney(snapshot.expectedCash, currencyCode)}',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

/// Part C — the opening flow: Caja → Abrir caja → select branch/register
/// (branch is already fixed by the shell's own context; register is
/// selectable here since Part A requires supporting more than one per
/// branch architecturally) → enter Fondo inicial → confirm. Never seeds or
/// suggests an amount — the field starts empty.
class _OpenCajaDialog extends StatefulWidget {
  const _OpenCajaDialog({
    required this.registers,
    required this.initialRegister,
    required this.cashGateway,
  });
  final List<PosCashRegister> registers;
  final PosCashRegister initialRegister;
  final PosCashGateway cashGateway;

  @override
  State<_OpenCajaDialog> createState() => _OpenCajaDialogState();
}

class _OpenCajaDialogState extends State<_OpenCajaDialog> {
  late PosCashRegister _register = widget.initialRegister;
  final _amountController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final Money amount;
    try {
      amount = Money.parse(
        _amountController.text.trim().isEmpty
            ? '0'
            : _amountController.text.trim(),
        'MXN',
      );
    } on MoneyFormatException {
      setState(() => _error = 'Ingresa un fondo inicial válido.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.cashGateway.openSession(
        cashRegisterId: _register.id,
        openingAmount: amount.toApiString(),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible abrir la caja.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Apertura de caja'),
    content: SizedBox(
      width: 360,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.registers.length > 1)
            DropdownButtonFormField<PosCashRegister>(
              key: const Key('pos-caja-register-select'),
              initialValue: _register,
              decoration: const InputDecoration(labelText: 'Caja'),
              items: [
                for (final register in widget.registers)
                  DropdownMenuItem(value: register, child: Text(register.name)),
              ],
              onChanged: _busy
                  ? null
                  : (value) {
                      if (value != null) setState(() => _register = value);
                    },
            )
          else
            Text('Caja: ${_register.name}'),
          const SizedBox(height: 12),
          TextField(
            key: const Key('pos-caja-fondo-input'),
            controller: _amountController,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Fondo inicial',
              prefixText: r'$ ',
            ),
            autofocus: true,
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.of(context).pop(false),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        key: const Key('pos-caja-confirm-open'),
        onPressed: _busy ? null : _confirm,
        child: _busy
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Abrir caja'),
      ),
    ],
  );
}

/// Part G — manual cash in/out. Requires amount>0 (schema-level minimum)
/// and a reason; the backend independently re-validates both plus "session
/// is open" and "actor is authorized" — this dialog never assumes success.
class _CashMovementDialog extends StatefulWidget {
  const _CashMovementDialog({
    required this.cashSessionId,
    required this.movementType,
    required this.currencyCode,
    required this.cashGateway,
  });
  final String cashSessionId;
  final String movementType;
  final String currencyCode;
  final PosCashGateway cashGateway;

  @override
  State<_CashMovementDialog> createState() => _CashMovementDialogState();
}

class _CashMovementDialogState extends State<_CashMovementDialog> {
  final _amountController = TextEditingController();
  final _reasonController = TextEditingController();
  final _noteController = TextEditingController();
  // TASK 14.4 (Wave 2, Part F.1) — optional; `null` means "uncategorized",
  // a real, legitimate choice — never defaulted to `other` on the caller's
  // behalf.
  String? _category;
  bool _busy = false;
  String? _error;

  /// Mirrors `cash.types.ts`'s own `cashMovementCategoryDirection` rule
  /// EXACTLY: only a category valid for [_CashMovementDialog.movementType]
  /// is ever offered — the UI never even shows an invalid combination, let
  /// alone lets the caller submit one.
  List<String> get _availableCategories => [
    for (final category in posCashMovementCategories)
      if (posCashMovementCategoryDirection[category] == null ||
          posCashMovementCategoryDirection[category] == widget.movementType)
        category,
  ];

  @override
  void dispose() {
    _amountController.dispose();
    _reasonController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final Money amount;
    try {
      amount = Money.parse(_amountController.text.trim(), widget.currencyCode);
    } on MoneyFormatException {
      setState(() => _error = 'Ingresa un monto válido.');
      return;
    }
    if (!amount.isPositive) {
      setState(() => _error = 'El monto debe ser mayor a cero.');
      return;
    }
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'Ingresa un motivo.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.cashGateway.createMovement(
        cashSessionId: widget.cashSessionId,
        movementType: widget.movementType,
        amount: amount.toApiString(),
        reasonCode: reason,
        note: _noteController.text.trim().isEmpty
            ? null
            : _noteController.text.trim(),
        category: _category,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible registrar el movimiento.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isCashIn = widget.movementType == 'cash_in';
    return AlertDialog(
      title: Text(isCashIn ? 'Entrada de efectivo' : 'Salida de efectivo'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const Key('pos-caja-movement-amount'),
              controller: _amountController,
              enabled: !_busy,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Monto',
                prefixText: r'$ ',
              ),
              autofocus: true,
            ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('pos-caja-movement-reason'),
              controller: _reasonController,
              enabled: !_busy,
              decoration: const InputDecoration(labelText: 'Motivo'),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('pos-caja-movement-note'),
              controller: _noteController,
              enabled: !_busy,
              decoration: const InputDecoration(labelText: 'Nota (opcional)'),
            ),
            const SizedBox(height: 10),
            // TASK 14.4 (Wave 2, Part F.1) — only the categories valid for
            // this dialog's own `movementType` are ever offered, mirroring
            // the backend's own direction rule exactly.
            DropdownButtonFormField<String?>(
              key: const Key('pos-caja-movement-category'),
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Categoría (opcional)'),
              items: [
                const DropdownMenuItem(value: null, child: Text('Sin categoría')),
                for (final category in _availableCategories)
                  DropdownMenuItem(
                    value: category,
                    child: Text(_movementCategoryLabels[category] ?? category),
                  ),
              ],
              onChanged: _busy ? null : (value) => setState(() => _category = value),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          key: const Key('pos-caja-confirm-movement'),
          onPressed: _busy ? null : _confirm,
          child: _busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Confirmar'),
        ),
      ],
    );
  }
}

/// Part I/J — cash count and close. Shows the backend's own expected cash
/// (never recomputed here), takes the cashier's counted total, and offers
/// the optional Part J bills/coins breakdown AS POS V1 itself supports —
/// using it live-sums into "Efectivo contado" (mirroring V1's own
/// `calcTotalContado()`), same as V1's own UX. The backend alone computes
/// the difference; this dialog never submits one.
class _CloseCajaDialog extends StatefulWidget {
  const _CloseCajaDialog({
    required this.cashSessionId,
    required this.currencyCode,
    required this.expectedCash,
    required this.cashGateway,
  });
  final String cashSessionId;
  final String currencyCode;
  final String expectedCash;
  final PosCashGateway cashGateway;

  @override
  State<_CloseCajaDialog> createState() => _CloseCajaDialogState();
}

class _CloseCajaDialogState extends State<_CloseCajaDialog> {
  final _countedController = TextEditingController();
  bool _useDenominations = false;
  final Map<String, TextEditingController> _denominationControllers = {
    for (final value in canonicalCashDenominationsMXN)
      value: TextEditingController(),
  };
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _countedController.dispose();
    for (final controller in _denominationControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _recomputeFromDenominations() {
    Money total = Money.zero(widget.currencyCode);
    for (final entry in _denominationControllers.entries) {
      final quantity = int.tryParse(entry.value.text.trim()) ?? 0;
      if (quantity <= 0) continue;
      final Money denomination;
      try {
        denomination = Money.parse(entry.key, widget.currencyCode);
      } on MoneyFormatException {
        continue;
      }
      total = total + (denomination * quantity);
    }
    _countedController.text = total.toApiString();
    setState(() {});
  }

  Future<void> _confirm() async {
    final Money counted;
    try {
      counted = Money.parse(
        _countedController.text.trim().isEmpty
            ? '0'
            : _countedController.text.trim(),
        widget.currencyCode,
      );
    } on MoneyFormatException {
      setState(() => _error = 'Ingresa el efectivo contado.');
      return;
    }
    final denominationCounts = _useDenominations
        ? [
            for (final entry in _denominationControllers.entries)
              if ((int.tryParse(entry.value.text.trim()) ?? 0) > 0)
                PosCashDenominationCount(
                  value: entry.key,
                  quantity: int.parse(entry.value.text.trim()),
                ),
          ]
        : null;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final closed = await widget.cashGateway.closeSession(
        cashSessionId: widget.cashSessionId,
        declaredClosingAmount: counted.toApiString(),
        denominationCounts: denominationCounts,
      );
      if (!mounted) return;
      Navigator.of(context).pop(closed);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible cerrar la caja.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Cierre de caja — Arqueo'),
    content: SizedBox(
      width: 400,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _CajaInfoRow(
              label: 'Efectivo esperado',
              value: _formatMoney(widget.expectedCash, widget.currencyCode),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('pos-caja-counted-input'),
              controller: _countedController,
              enabled: !_busy && !_useDenominations,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Efectivo contado',
                prefixText: r'$ ',
              ),
            ),
            SwitchListTile(
              key: const Key('pos-caja-denominations-toggle'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Detalle de billetes y monedas'),
              value: _useDenominations,
              onChanged: _busy
                  ? null
                  : (value) {
                      setState(() => _useDenominations = value);
                      if (value) _recomputeFromDenominations();
                    },
            ),
            if (_useDenominations)
              for (final value in canonicalCashDenominationsMXN)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(_formatMoney(value, widget.currencyCode)),
                      ),
                      SizedBox(
                        width: 90,
                        child: TextField(
                          key: Key('pos-caja-denom-$value'),
                          controller: _denominationControllers[value],
                          enabled: !_busy,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            isDense: true,
                            hintText: '0',
                          ),
                          onChanged: (_) => _recomputeFromDenominations(),
                        ),
                      ),
                    ],
                  ),
                ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.of(context).pop(),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        key: const Key('pos-caja-confirm-close'),
        onPressed: _busy ? null : _confirm,
        child: _busy
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Cerrar caja'),
      ),
    ],
  );
}

/// Part I — the closed-session cut summary, showing the backend-computed
/// difference verbatim (never re-derived): zero, shortage (red), or
/// overage (amber) — matching AS POS V1's own three-state coloring.
class _CloseResultDialog extends StatelessWidget {
  const _CloseResultDialog({required this.session});
  final PosCashSession session;

  @override
  Widget build(BuildContext context) {
    final discrepancy = session.discrepancyAmount ?? '0';
    final isShortage = discrepancy.trim().startsWith('-');
    final isZero = Money.parse(
      isShortage ? discrepancy.trim().substring(1) : discrepancy.trim(),
      session.currencyCode,
    ).isZero;
    final color = isZero
        ? Colors.green
        : isShortage
        ? Colors.red
        : Colors.orange;
    final label = isZero
        ? 'Cuadrado'
        : isShortage
        ? 'Faltante'
        : 'Sobrante';
    return AlertDialog(
      title: const Text('Corte de caja'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _CajaInfoRow(
              label: 'Efectivo esperado',
              value: _formatMoney(
                session.expectedClosingAmount ?? '0',
                session.currencyCode,
              ),
            ),
            _CajaInfoRow(
              label: 'Efectivo contado',
              value: _formatMoney(
                session.declaredClosingAmount ?? '0',
                session.currencyCode,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: color.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    label,
                    style: TextStyle(color: color, fontWeight: FontWeight.w800),
                  ),
                  Text(
                    _formatMoney(discrepancy, session.currencyCode),
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Entendido'),
        ),
      ],
    );
  }
}

/// TASK 14.4 (Wave 2, Part F.3) — "Corte parcial" confirmation. Mirrors
/// `_CloseCajaDialog`'s general shape but simpler — no counted-cash entry,
/// since this is a pure, real-time snapshot of the backend's own
/// [PosCashGateway.summary], never a declared/counted total, and it never
/// closes the session.
class _PartialCloseDialog extends StatefulWidget {
  const _PartialCloseDialog({
    required this.cashSessionId,
    required this.currencyCode,
    required this.cashGateway,
  });
  final String cashSessionId;
  final String currencyCode;
  final PosCashGateway cashGateway;

  @override
  State<_PartialCloseDialog> createState() => _PartialCloseDialogState();
}

class _PartialCloseDialogState extends State<_PartialCloseDialog> {
  bool _busy = false;
  String? _error;

  Future<void> _confirm() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final snapshot = await widget.cashGateway.partialCloseSession(widget.cashSessionId);
      if (!mounted) return;
      Navigator.of(context).pop(snapshot);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible registrar el corte parcial.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Corte parcial'),
    content: SizedBox(
      width: 360,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Se registrará una foto (snapshot) del estado actual de la caja, '
            'sin cerrarla — la caja seguirá abierta.',
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.of(context).pop(),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        key: const Key('pos-caja-confirm-partial-close'),
        onPressed: _busy ? null : _confirm,
        child: _busy
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Registrar corte parcial'),
      ),
    ],
  );
}

/// TASK 14.4 (Wave 2, Part F.3) — shows the real, backend-returned
/// snapshot figures verbatim (never recomputed) — mirrors
/// `_CloseResultDialog`'s general shape, minus the discrepancy banner
/// (a partial close carries no declared/counted amount to compare
/// against). CRITICALLY never implies the session closed.
class _PartialCloseResultDialog extends StatelessWidget {
  const _PartialCloseResultDialog({required this.snapshot, required this.currencyCode});
  final PosCashSessionPartialClose snapshot;
  final String currencyCode;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Corte parcial registrado'),
    content: SizedBox(
      width: 360,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _CajaInfoRow(label: 'Registrado', value: _formatCajaDate(snapshot.takenAt)),
          _CajaInfoRow(
            label: 'Fondo inicial',
            value: _formatMoney(snapshot.openingAmount, currencyCode),
          ),
          _CajaInfoRow(
            label: 'Ventas en efectivo',
            value: _formatMoney(snapshot.cashSalesTotal, currencyCode),
          ),
          _CajaInfoRow(label: 'Entradas', value: _formatMoney(snapshot.cashInTotal, currencyCode)),
          _CajaInfoRow(label: 'Salidas', value: _formatMoney(snapshot.cashOutTotal, currencyCode)),
          const Divider(height: 20),
          _CajaInfoRow(
            label: 'Efectivo esperado',
            value: _formatMoney(snapshot.expectedCash, currencyCode),
          ),
          const SizedBox(height: 8),
          const Text(
            'La caja permanece abierta — este corte es solo una fotografía '
            'para historial/auditoría.',
          ),
        ],
      ),
    ),
    actions: [
      FilledButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Entendido'),
      ),
    ],
  );
}

/// Part L — cut history: server-side paginated/filtered, never
/// client-side loaded-all-then-filtered.
class _CutHistory extends StatefulWidget {
  const _CutHistory({required this.context, required this.cashGateway});
  final AuthenticatedContext context;
  final PosCashGateway cashGateway;

  @override
  State<_CutHistory> createState() => _CutHistoryState();
}

class _CutHistoryState extends State<_CutHistory> {
  bool _loading = true;
  List<PosCashSession> _items = const [];
  String? _nextCursor;
  String? _errorMessage;
  String? _statusFilter;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  PosCashSessionHistoryFilter get _filter => PosCashSessionHistoryFilter(
    branchId: widget.context.session.branchId,
    status: _statusFilter,
  );

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final page = await widget.cashGateway.listSessions(filter: _filter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'No fue posible cargar el historial de cortes.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null) return;
    try {
      final page = await widget.cashGateway.listSessions(
        filter: _filter,
        cursor: cursor,
      );
      if (!mounted) return;
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
      });
    } on Object {
      // Leave the already-loaded page intact; the "Cargar más" control
      // simply remains available to retry.
    }
  }

  Future<void> _openDetail(PosCashSession summary) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _CutDetailDialog(
        cashSessionId: summary.id,
        cashGateway: widget.cashGateway,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_errorMessage != null) {
      return _FailureState(
        message: _errorMessage!,
        onRetry: () => unawaited(_load()),
      );
    }
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Text('Estado:'),
            const SizedBox(width: 8),
            DropdownButton<String?>(
              key: const Key('pos-caja-history-status-filter'),
              value: _statusFilter,
              hint: const Text('Todos'),
              items: const [
                DropdownMenuItem(value: null, child: Text('Todos')),
                DropdownMenuItem(value: 'open', child: Text('Abierta')),
                DropdownMenuItem(value: 'closed', child: Text('Cerrada')),
              ],
              onChanged: (value) {
                setState(() => _statusFilter = value);
                unawaited(_load());
              },
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (_items.isEmpty)
          Text(
            'Sin cortes de caja registrados.',
            style: TextStyle(color: palette.textSecondary),
          )
        else
          for (final session in _items)
            _PosCard(
              child: InkWell(
                onTap: () => unawaited(_openDetail(session)),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _formatCajaDate(session.openedAt),
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          Text(
                            session.closedAt == null
                                ? 'Abierta'
                                : 'Cerrada — ${_formatCajaDate(session.closedAt!)}',
                            style: TextStyle(
                              color: palette.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (session.discrepancyAmount != null)
                      Text(
                        _formatMoney(
                          session.discrepancyAmount!,
                          session.currencyCode,
                        ),
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                    const SizedBox(width: 8),
                    _StatusChip(
                      label: session.status == 'closed' ? 'closed' : 'active',
                    ),
                  ],
                ),
              ),
            ),
        if (_nextCursor != null)
          Center(
            child: TextButton(
              onPressed: () => unawaited(_loadMore()),
              child: const Text('Cargar más'),
            ),
          ),
      ],
    );
  }
}

class _CutDetailDialog extends StatefulWidget {
  const _CutDetailDialog({
    required this.cashSessionId,
    required this.cashGateway,
  });
  final String cashSessionId;
  final PosCashGateway cashGateway;

  @override
  State<_CutDetailDialog> createState() => _CutDetailDialogState();
}

class _CutDetailDialogState extends State<_CutDetailDialog> {
  PosCashSessionSummary? _summary;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final summary = await widget.cashGateway.summary(widget.cashSessionId);
      if (!mounted) return;
      setState(() => _summary = summary);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _errorMessage = error.failure.message);
    } on Object {
      if (!mounted) return;
      setState(() => _errorMessage = 'No fue posible cargar el corte.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    return AlertDialog(
      title: const Text('Detalle de corte'),
      content: SizedBox(
        width: 380,
        child: summary == null
            ? SizedBox(
                height: 120,
                child: Center(
                  child: _errorMessage == null
                      ? const CircularProgressIndicator()
                      : Text(
                          _errorMessage!,
                          style: const TextStyle(color: Colors.red),
                        ),
                ),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _CajaInfoRow(
                    label: 'Apertura',
                    value: _formatCajaDate(summary.session.openedAt),
                  ),
                  if (summary.session.closedAt != null)
                    _CajaInfoRow(
                      label: 'Cierre',
                      value: _formatCajaDate(summary.session.closedAt!),
                    ),
                  _CajaInfoRow(
                    label: 'Fondo inicial',
                    value: _formatMoney(
                      summary.openingAmount,
                      summary.session.currencyCode,
                    ),
                  ),
                  _CajaInfoRow(
                    label: 'Ventas en efectivo',
                    value:
                        '${_formatMoney(summary.cashSalesTotal, summary.session.currencyCode)} '
                        '(${summary.cashSalesCount})',
                  ),
                  _CajaInfoRow(
                    label: 'Entradas',
                    value: _formatMoney(
                      summary.cashInTotal,
                      summary.session.currencyCode,
                    ),
                  ),
                  _CajaInfoRow(
                    label: 'Salidas',
                    value: _formatMoney(
                      summary.cashOutTotal,
                      summary.session.currencyCode,
                    ),
                  ),
                  const Divider(height: 20),
                  _CajaInfoRow(
                    label: 'Efectivo esperado',
                    value: _formatMoney(
                      summary.expectedCash,
                      summary.session.currencyCode,
                    ),
                  ),
                  if (summary.session.declaredClosingAmount != null)
                    _CajaInfoRow(
                      label: 'Efectivo contado',
                      value: _formatMoney(
                        summary.session.declaredClosingAmount!,
                        summary.session.currencyCode,
                      ),
                    ),
                  if (summary.session.discrepancyAmount != null)
                    _CajaInfoRow(
                      label: 'Diferencia',
                      value: _formatMoney(
                        summary.session.discrepancyAmount!,
                        summary.session.currencyCode,
                      ),
                    ),
                ],
              ),
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------
// TASK 13.0 — Customers (Clientes), Memberships (Membresías), and AS
// Rewards+ — see ADR-0017 and `pos_customers_gateway.dart`/
// `pos_memberships_gateway.dart`/`pos_loyalty_gateway.dart`. Mirrors the
// `_PromotionsAdmin`/`_Devoluciones` self-contained gateway-call/loading-
// state pattern exactly. No client-side promotion/membership/loyalty
// "engine" — every eligibility/validity/pricing decision comes from the
// backend response already fetched; this UI only renders what the
// backend returned (Part U/D11).
// ---------------------------------------------------------------------

/// The CAJERO ticket's own customer row — "Venta sin cliente" (the
/// default/fast path) or the attached customer's name plus a "Quitar"
/// action. Never a search field inline; tapping "Buscar cliente" opens
/// [_CustomerSelectorDialog] — mirrors the coupon input's own
/// button-opens-a-focused-flow shape (ADR-0017 Part H).
class _TicketCustomerRow extends StatelessWidget {
  const _TicketCustomerRow({
    required this.customerDisplayName,
    required this.onSelect,
    required this.onRemove,
  });
  final String? customerDisplayName;
  final VoidCallback onSelect;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final name = customerDisplayName;
    if (name == null) {
      return OutlinedButton.icon(
        key: const Key('pos-ticket-customer-select'),
        onPressed: onSelect,
        icon: const Icon(Icons.person_search_outlined, size: 15),
        label: const Text('Venta sin cliente · Buscar cliente'),
        style: OutlinedButton.styleFrom(
          foregroundColor: palette.textSecondary,
          side: BorderSide(color: palette.border),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          textStyle: const TextStyle(fontSize: 12),
          alignment: Alignment.centerLeft,
        ),
      );
    }
    return Container(
      key: const Key('pos-ticket-customer-attached'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.actionTint,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: palette.border),
      ),
      child: Row(
        children: [
          Icon(Icons.person_outline, size: 15, color: palette.blueDeep),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
          IconButton(
            key: const Key('pos-ticket-customer-remove'),
            tooltip: 'Quitar cliente',
            onPressed: onRemove,
            icon: Icon(Icons.close, size: 15, color: palette.textSecondary),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 26, minHeight: 26),
          ),
        ],
      ),
    );
  }
}

/// What [_CustomerSelectorDialog] resolves with — just enough for
/// [SaleSession.setCustomer] (ADR-0017 D6): never a full [PosCustomer],
/// since the ticket only ever needs the id and a display name.
class _CustomerSelectorResult {
  const _CustomerSelectorResult({required this.id, required this.displayName});
  final String id;
  final String displayName;
}

enum _CustomerSelectorPhase { idle, loading, ready, empty, failure }

/// "Buscar cliente" — search by phone/name/email via `GET /customers?
/// search=`, select → resolves with a [_CustomerSelectorResult]. Also
/// offers "Nuevo cliente" quick-registration inline (Part H/I). Never a
/// separate page — a focused dialog, mirroring the manual-discount flow's
/// own shape.
class _CustomerSelectorDialog extends StatefulWidget {
  const _CustomerSelectorDialog({required this.customersGateway});
  final PosCustomersGateway customersGateway;

  @override
  State<_CustomerSelectorDialog> createState() => _CustomerSelectorDialogState();
}

class _CustomerSelectorDialogState extends State<_CustomerSelectorDialog> {
  final _searchController = TextEditingController();
  _CustomerSelectorPhase _phase = _CustomerSelectorPhase.idle;
  List<PosCustomerSummary> _items = const [];
  String? _errorMessage;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    final query = value.trim();
    if (query.isEmpty) {
      setState(() {
        _phase = _CustomerSelectorPhase.idle;
        _items = const [];
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () => unawaited(_search(query)));
  }

  Future<void> _search(String query) async {
    setState(() {
      _phase = _CustomerSelectorPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.customersGateway.listCustomers(search: query);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _phase = _items.isEmpty ? _CustomerSelectorPhase.empty : _CustomerSelectorPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _CustomerSelectorPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _CustomerSelectorPhase.failure;
        _errorMessage = 'No fue posible buscar clientes.';
      });
    }
  }

  Future<void> _openQuickNewCustomer() async {
    final created = await showDialog<_CustomerSelectorResult>(
      context: context,
      builder: (dialogContext) => _QuickNewCustomerDialog(customersGateway: widget.customersGateway),
    );
    if (created == null || !mounted) return;
    Navigator.of(context).pop(created);
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 560),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Buscar cliente',
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-customer-selector-search'),
                controller: _searchController,
                autofocus: true,
                onChanged: _onQueryChanged,
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: 'Nombre, teléfono o correo',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                key: const Key('pos-customer-selector-new'),
                onPressed: () => unawaited(_openQuickNewCustomer()),
                icon: const Icon(Icons.person_add_alt_outlined, size: 16),
                label: const Text('Nuevo cliente'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: palette.blueDeep,
                  side: BorderSide(color: palette.border),
                ),
              ),
              const SizedBox(height: 10),
              Flexible(
                child: switch (_phase) {
                  _CustomerSelectorPhase.idle => const SizedBox.shrink(),
                  _CustomerSelectorPhase.loading => const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  _CustomerSelectorPhase.empty => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'Sin resultados para esta búsqueda.',
                      style: TextStyle(color: palette.textSecondary),
                    ),
                  ),
                  _CustomerSelectorPhase.failure => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      _errorMessage ?? 'No fue posible buscar clientes.',
                      style: TextStyle(color: palette.error),
                    ),
                  ),
                  _CustomerSelectorPhase.ready => ListView.separated(
                    shrinkWrap: true,
                    itemCount: _items.length,
                    separatorBuilder: (context, index) => Divider(height: 1, color: palette.border),
                    itemBuilder: (context, index) {
                      final item = _items[index];
                      return ListTile(
                        key: Key('pos-customer-selector-result-${item.id}'),
                        dense: true,
                        title: Text(item.displayName),
                        onTap: () => Navigator.of(context).pop(
                          _CustomerSelectorResult(id: item.id, displayName: item.displayName),
                        ),
                      );
                    },
                  ),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Nuevo cliente" quick-registration reached from [_CustomerSelectorDialog]
/// — minimal fields (first name required, phone/email optional, Part H/I).
/// A 409 conflict offers the existing customer instead of blindly
/// retrying/duplicating.
class _QuickNewCustomerDialog extends StatefulWidget {
  const _QuickNewCustomerDialog({required this.customersGateway});
  final PosCustomersGateway customersGateway;

  @override
  State<_QuickNewCustomerDialog> createState() => _QuickNewCustomerDialogState();
}

class _QuickNewCustomerDialogState extends State<_QuickNewCustomerDialog> {
  final _firstNameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _existingCustomerId;

  @override
  void dispose() {
    _firstNameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final firstName = _firstNameController.text.trim();
    if (firstName.isEmpty) {
      setState(() => _error = 'Escribe al menos el nombre del cliente.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _existingCustomerId = null;
    });
    final phone = _phoneController.text.trim();
    final email = _emailController.text.trim();
    try {
      final created = await widget.customersGateway.createCustomer(
        PosCustomerInput(
          firstName: firstName,
          phone: phone.isEmpty ? null : phone,
          email: email.isEmpty ? null : email,
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(_CustomerSelectorResult(id: created.id, displayName: created.displayName));
    } on ApiException catch (error) {
      if (!mounted) return;
      final conflict = posCustomerConflictFrom(error);
      setState(() {
        _busy = false;
        _error = conflict?.message ?? error.failure.message;
        _existingCustomerId = conflict?.existingCustomerId;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible registrar al cliente.';
      });
    }
  }

  Future<void> _useExistingCustomer() async {
    final id = _existingCustomerId;
    if (id == null) return;
    setState(() => _busy = true);
    try {
      final existing = await widget.customersGateway.customer(id);
      if (!mounted) return;
      Navigator.of(context).pop(_CustomerSelectorResult(id: existing.id, displayName: existing.displayName));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible abrir el cliente existente.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Nuevo cliente',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 14),
              TextField(
                key: const Key('pos-quick-customer-first-name'),
                controller: _firstNameController,
                decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-quick-customer-phone'),
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(isDense: true, labelText: 'Teléfono (opcional)'),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-quick-customer-email'),
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(isDense: true, labelText: 'Correo (opcional)'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-quick-customer-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              if (_existingCustomerId != null) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  key: const Key('pos-quick-customer-use-existing'),
                  onPressed: _busy ? null : () => unawaited(_useExistingCustomer()),
                  child: const Text('Usar cliente existente'),
                ),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: palette.textSecondary,
                        side: BorderSide(color: palette.border),
                      ),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-quick-customer-save'),
                      onPressed: _busy ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Registrar'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `PosModule.customers` ("Clientes") — the customer directory: search
/// box, cursor-paginated list (Part AE), tap a row to open Customer
/// Detail. Gated on `customer.read`/`customer.create`, matching the
/// promotions admin's own `_canRead*`/`_canManage*` pattern exactly.
class _CustomersAdmin extends StatefulWidget {
  const _CustomersAdmin({
    required this.context,
    required this.customersGateway,
    required this.membershipsGateway,
    required this.loyaltyGateway,
    required this.rewardsGateway,
    required this.salesGateway,
  });
  final AuthenticatedContext context;
  final PosCustomersGateway customersGateway;
  final PosMembershipsGateway membershipsGateway;
  final PosLoyaltyGateway loyaltyGateway;
  // TASK 13.1: reward entitlements — see `_CustomerDetailDialog`'s
  // Recompensas section and ADR-0018.
  final PosRewardsGateway rewardsGateway;
  final PosSalesGateway salesGateway;

  @override
  State<_CustomersAdmin> createState() => _CustomersAdminState();
}

class _CustomersAdminState extends State<_CustomersAdmin> {
  _AdminListPhase _phase = _AdminListPhase.loading;
  List<PosCustomerSummary> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  String _query = '';
  Timer? _debounce;

  bool get _canRead => widget.context.permissions.contains('customer.read');
  bool get _canCreate => widget.context.permissions.contains('customer.create');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.customersGateway.listCustomers(search: _query.trim().isEmpty ? null : _query.trim());
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _items.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar los clientes.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.customersGateway.listCustomers(
        search: _query.trim().isEmpty ? null : _query.trim(),
        cursor: cursor,
      );
      if (!mounted) return;
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _loadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  void _onQueryChanged(String value) {
    setState(() => _query = value);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => unawaited(_load()));
  }

  Future<void> _openNewCustomerForm() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CustomerFormDialog(customersGateway: widget.customersGateway),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosCustomerSummary summary) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CustomerDetailDialog(
        customerId: summary.id,
        context: widget.context,
        customersGateway: widget.customersGateway,
        membershipsGateway: widget.membershipsGateway,
        loyaltyGateway: widget.loyaltyGateway,
        rewardsGateway: widget.rewardsGateway,
        salesGateway: widget.salesGateway,
      ),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Clientes',
          description: 'Directorio de clientes — búsqueda, alta y edición mínima (ADR-0017).',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (!_canRead)
          const _PermissionState()
        else ...[
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pos-customers-search'),
                  onChanged: _onQueryChanged,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'Buscar por nombre, teléfono o correo',
                    prefixIcon: Icon(Icons.search),
                  ),
                ),
              ),
              if (_canCreate) ...[
                const SizedBox(width: 10),
                FilledButton.icon(
                  key: const Key('pos-customer-new'),
                  onPressed: () => unawaited(_openNewCustomerForm()),
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: const Icon(Icons.person_add_alt_outlined, size: 16),
                  label: const Text('Nuevo cliente'),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          switch (_phase) {
            _AdminListPhase.loading => const _LoadingState(),
            _AdminListPhase.empty => const _EmptyState(message: 'No hay clientes registrados.'),
            _AdminListPhase.failure => _FailureState(
              message: _errorMessage ?? 'No fue posible cargar los clientes.',
              onRetry: () => unawaited(_load()),
            ),
            _AdminListPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final item in _items)
                  _CustomerRow(customer: item, onTap: () => unawaited(_openDetail(item))),
                if (_nextCursor != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: OutlinedButton.icon(
                        key: const Key('pos-customers-load-more'),
                        onPressed: _loadingMore ? null : () => unawaited(_loadMore()),
                        icon: _loadingMore
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.expand_more),
                        label: const Text('Cargar más'),
                      ),
                    ),
                  ),
              ],
            ),
          },
        ],
      ],
    );
  }
}

class _CustomerRow extends StatelessWidget {
  const _CustomerRow({required this.customer, required this.onTap});
  final PosCustomerSummary customer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      key: Key('pos-customer-row-${customer.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  customer.displayName,
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
              _StatusChip(label: customer.status == 'active' ? 'active' : 'inactive'),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

/// New/edit customer — minimum friction: only `first_name` required
/// (Part E). A 409 conflict on create offers the existing customer
/// instead of retrying blindly (ADR-0017 D5).
class _CustomerFormDialog extends StatefulWidget {
  const _CustomerFormDialog({required this.customersGateway, this.existing});
  final PosCustomersGateway customersGateway;
  final PosCustomer? existing;

  @override
  State<_CustomerFormDialog> createState() => _CustomerFormDialogState();
}

class _CustomerFormDialogState extends State<_CustomerFormDialog> {
  late final _firstNameController = TextEditingController(text: widget.existing?.firstName ?? '');
  late final _lastNameController = TextEditingController(text: widget.existing?.lastName ?? '');
  late final _phoneController = TextEditingController(text: widget.existing?.phone ?? '');
  late final _emailController = TextEditingController(text: widget.existing?.email ?? '');
  late final _notesController = TextEditingController(text: widget.existing?.notes ?? '');
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;
  String? _existingCustomerId;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final firstName = _firstNameController.text.trim();
    if (firstName.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _existingCustomerId = null;
    });
    final lastName = _lastNameController.text.trim();
    final phone = _phoneController.text.trim();
    final email = _emailController.text.trim();
    final notes = _notesController.text.trim();
    final input = PosCustomerInput(
      firstName: firstName,
      lastName: lastName.isEmpty ? null : lastName,
      phone: phone.isEmpty ? null : phone,
      email: email.isEmpty ? null : email,
      notes: notes.isEmpty ? null : notes,
      status: _isEdit ? _status : null,
    );
    try {
      if (_isEdit) {
        await widget.customersGateway.updateCustomer(widget.existing!.id, input, version: widget.existing!.version);
      } else {
        await widget.customersGateway.createCustomer(input);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      final conflict = posCustomerConflictFrom(error);
      setState(() {
        _busy = false;
        _error = conflict?.message ?? error.failure.message;
        _existingCustomerId = conflict?.existingCustomerId;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar el cliente.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 640),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar cliente' : 'Nuevo cliente',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-customer-first-name'),
                  controller: _firstNameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-customer-last-name'),
                  controller: _lastNameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Apellido (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-customer-phone'),
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(isDense: true, labelText: 'Teléfono (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-customer-email'),
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(isDense: true, labelText: 'Correo (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-customer-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-customer-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activo')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactivo')),
                      DropdownMenuItem(value: 'archived', child: Text('Archivado')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-customer-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                if (_existingCustomerId != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Id del cliente existente: $_existingCustomerId',
                    key: const Key('pos-customer-existing-id'),
                    style: TextStyle(color: palette.textSecondary, fontSize: 11),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.textSecondary,
                          side: BorderSide(color: palette.border),
                        ),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-customer-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Customer Detail — Resumen/Membresías/Rewards/Ventas recientes, all in
/// one scrollable dialog (mirrors `_SaleDetailDialog`'s own shape: a
/// dialog, never a route). Every section fetches independently and only
/// shows data actually returned — no fake/placeholder section, and every
/// mutating action is gated on its own real permission (Part Y).
class _CustomerDetailDialog extends StatefulWidget {
  const _CustomerDetailDialog({
    required this.customerId,
    required this.context,
    required this.customersGateway,
    required this.membershipsGateway,
    required this.loyaltyGateway,
    required this.rewardsGateway,
    required this.salesGateway,
  });
  final String customerId;
  final AuthenticatedContext context;
  final PosCustomersGateway customersGateway;
  final PosMembershipsGateway membershipsGateway;
  final PosLoyaltyGateway loyaltyGateway;
  // TASK 13.1: reward entitlements (Recompensas) — see ADR-0018.
  final PosRewardsGateway rewardsGateway;
  final PosSalesGateway salesGateway;

  @override
  State<_CustomerDetailDialog> createState() => _CustomerDetailDialogState();
}

class _CustomerDetailDialogState extends State<_CustomerDetailDialog> {
  bool _loading = true;
  String? _errorMessage;
  PosCustomer? _customer;
  PosCustomerQrToken? _qrToken;
  bool _qrBusy = false;

  bool _membershipsLoaded = false;
  List<PosCustomerMembership> _memberships = const [];
  Map<String, PosMembershipPlan> _plansById = const {};
  List<PosMembershipPlan> _plans = const [];
  String? _membershipsError;

  bool _loyaltyLoaded = false;
  PosLoyaltySummary? _loyalty;
  Map<String, PosLoyaltyProgram> _programsById = const {};
  List<PosLoyaltyProgram> _programs = const [];
  String? _loyaltyError;

  bool _salesLoaded = false;
  List<PosSaleSummary> _sales = const [];
  String? _salesError;

  // TASK 13.1: reward entitlements (Recompensas) — see ADR-0018.
  bool _rewardsLoaded = false;
  List<PosRewardEntitlement> _rewards = const [];
  String? _rewardsError;

  // Whether the caller's own list should reload (e.g. after an edit
  // changes this customer's `display_name`/`status`).
  bool _changed = false;

  bool get _canReadCustomer => widget.context.permissions.contains('customer.read');
  bool get _canUpdateCustomer => widget.context.permissions.contains('customer.update');
  bool get _canReadMembership => widget.context.permissions.contains('membership.read');
  bool get _canIssueMembership => widget.context.permissions.contains('membership.issue');
  bool get _canManageMembership => widget.context.permissions.contains('membership.manage');
  bool get _canReadLoyalty => widget.context.permissions.contains('loyalty.read');
  bool get _canAdjustLoyalty => widget.context.permissions.contains('loyalty.adjust');
  bool get _canReadSales => widget.context.permissions.contains('sale.read');
  bool get _canReadReward => widget.context.permissions.contains('reward.read');
  bool get _canIssueReward => widget.context.permissions.contains('reward.issue');
  bool get _canRevokeReward => widget.context.permissions.contains('reward.revoke');

  @override
  void initState() {
    super.initState();
    unawaited(_loadCustomer());
    unawaited(_loadMemberships());
    unawaited(_loadLoyalty());
    unawaited(_loadSales());
    unawaited(_loadRewards());
  }

  Future<void> _loadCustomer() async {
    if (!_canReadCustomer) {
      setState(() {
        _loading = false;
        _errorMessage = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final customer = await widget.customersGateway.customer(widget.customerId);
      PosCustomerQrToken? token;
      try {
        token = await widget.customersGateway.activeQrToken(widget.customerId);
      } on Object {
        token = null;
      }
      if (!mounted) return;
      setState(() {
        _customer = customer;
        _qrToken = token;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'No fue posible cargar el cliente.';
      });
    }
  }

  Future<void> _loadMemberships() async {
    if (!_canReadMembership) {
      setState(() => _membershipsLoaded = true);
      return;
    }
    setState(() => _membershipsError = null);
    try {
      final memberships = await widget.membershipsGateway.membershipsForCustomer(widget.customerId);
      final plans = await widget.membershipsGateway.listPlans();
      if (!mounted) return;
      setState(() {
        _memberships = memberships;
        _plans = plans;
        _plansById = {for (final plan in plans) plan.id: plan};
        _membershipsLoaded = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _membershipsLoaded = true;
        _membershipsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _membershipsLoaded = true;
        _membershipsError = 'No fue posible cargar las membresías.';
      });
    }
  }

  Future<void> _loadLoyalty() async {
    if (!_canReadLoyalty) {
      setState(() => _loyaltyLoaded = true);
      return;
    }
    setState(() => _loyaltyError = null);
    try {
      final summary = await widget.loyaltyGateway.customerLoyalty(widget.customerId);
      final programs = await widget.loyaltyGateway.listPrograms();
      if (!mounted) return;
      setState(() {
        _loyalty = summary;
        _programs = programs;
        _programsById = {for (final program in programs) program.id: program};
        _loyaltyLoaded = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loyaltyLoaded = true;
        _loyaltyError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loyaltyLoaded = true;
        _loyaltyError = 'No fue posible cargar AS Rewards+.';
      });
    }
  }

  Future<void> _loadSales() async {
    if (!_canReadSales) {
      setState(() => _salesLoaded = true);
      return;
    }
    setState(() => _salesError = null);
    try {
      final page = await widget.salesGateway.listSales(
        filter: PosSaleHistoryFilter(customerId: widget.customerId),
      );
      if (!mounted) return;
      setState(() {
        _sales = page.items;
        _salesLoaded = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _salesLoaded = true;
        _salesError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _salesLoaded = true;
        _salesError = 'No fue posible cargar las ventas recientes.';
      });
    }
  }

  // TASK 13.1 (Part U): reward entitlements — backend truth only, exactly
  // like `_loadLoyalty`/`_loadMemberships` above; never derives
  // availability locally (ADR-0018).
  Future<void> _loadRewards() async {
    if (!_canReadReward) {
      setState(() => _rewardsLoaded = true);
      return;
    }
    setState(() => _rewardsError = null);
    try {
      final rewards = await widget.rewardsGateway.entitlementsForCustomer(widget.customerId);
      if (!mounted) return;
      setState(() {
        _rewards = rewards;
        _rewardsLoaded = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _rewardsLoaded = true;
        _rewardsError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _rewardsLoaded = true;
        _rewardsError = 'No fue posible cargar las recompensas.';
      });
    }
  }

  Future<void> _openEdit() async {
    final customer = _customer;
    if (customer == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CustomerFormDialog(customersGateway: widget.customersGateway, existing: customer),
    );
    if (saved != true || !mounted) return;
    _changed = true;
    unawaited(_loadCustomer());
  }

  Future<void> _issueOrRotateQr() async {
    setState(() => _qrBusy = true);
    try {
      final token = await widget.customersGateway.issueQrToken(widget.customerId);
      if (!mounted) return;
      setState(() {
        _qrToken = token;
        _qrBusy = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _qrBusy = false);
      _showNotice(context, error.failure.message);
    } on Object {
      if (!mounted) return;
      setState(() => _qrBusy = false);
      _showNotice(context, 'No fue posible generar el código QR.');
    }
  }

  Future<void> _openIssueMembership() async {
    final issued = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _IssueMembershipDialog(
        membershipsGateway: widget.membershipsGateway,
        customerId: widget.customerId,
        plans: _plans,
      ),
    );
    if (issued == true) unawaited(_loadMemberships());
  }

  Future<void> _renewMembership(PosCustomerMembership membership) async {
    try {
      await widget.membershipsGateway.renewMembership(membership.id);
      if (!mounted) return;
      _showNotice(context, 'Membresía renovada.');
      unawaited(_loadMemberships());
    } on ApiException catch (error) {
      if (!mounted) return;
      _showNotice(context, error.failure.message);
    } on Object {
      if (!mounted) return;
      _showNotice(context, 'No fue posible renovar la membresía.');
    }
  }

  Future<void> _openCancelMembership(PosCustomerMembership membership) async {
    final cancelled = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CancelMembershipDialog(
        membershipsGateway: widget.membershipsGateway,
        membership: membership,
      ),
    );
    if (cancelled == true) unawaited(_loadMemberships());
  }

  Future<void> _validateMembership(PosCustomerMembership membership) async {
    final branchId = widget.context.session.branchId;
    if (branchId == null) {
      _showNotice(context, 'Selecciona una sucursal para verificar la vigencia.');
      return;
    }
    try {
      final result = await widget.membershipsGateway.validate(customerId: widget.customerId, branchId: branchId);
      if (!mounted) return;
      _showNotice(
        context,
        result.valid ? 'Membresía vigente en esta sucursal.' : 'No vigente: ${result.reason ?? 'sin motivo informado'}.',
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      _showNotice(context, error.failure.message);
    } on Object {
      if (!mounted) return;
      _showNotice(context, 'No fue posible verificar la vigencia.');
    }
  }

  Future<void> _openAdjustLoyalty() async {
    final adjusted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _LoyaltyAdjustDialog(
        loyaltyGateway: widget.loyaltyGateway,
        customerId: widget.customerId,
        programs: _programs,
      ),
    );
    if (adjusted == true) unawaited(_loadLoyalty());
  }

  // TASK 13.1 (Part U): manual issuance — mirrors `_openIssueMembership`
  // exactly (never the automatic loyalty-threshold path, which happens
  // server-side — see `pos_rewards_gateway.dart`).
  Future<void> _openIssueReward() async {
    final issued = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _IssueRewardDialog(
        rewardsGateway: widget.rewardsGateway,
        customerId: widget.customerId,
        programs: _programs,
      ),
    );
    if (issued == true) unawaited(_loadRewards());
  }

  Future<void> _openRevokeReward(PosRewardEntitlement entitlement) async {
    final revoked = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _RevokeRewardDialog(
        rewardsGateway: widget.rewardsGateway,
        entitlement: entitlement,
      ),
    );
    if (revoked == true) unawaited(_loadRewards());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520, maxHeight: 680),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _customer?.displayName ?? 'Detalle de cliente',
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                    ),
                  ),
                  IconButton(
                    key: const Key('pos-customer-detail-close'),
                    onPressed: () => Navigator.of(context).pop(_changed),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Flexible(
                child: SingleChildScrollView(
                  child: !_canReadCustomer
                      ? const _PermissionState()
                      : _loading
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 40),
                          child: Center(child: CircularProgressIndicator()),
                        )
                      : _errorMessage != null
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(_errorMessage!, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
                            const SizedBox(height: 6),
                            OutlinedButton(
                              onPressed: () => unawaited(_loadCustomer()),
                              child: const Text('Reintentar'),
                            ),
                          ],
                        )
                      : _buildBody(palette),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody(PosPalette palette) {
    final customer = _customer!;
    Widget sectionTitle(String label) => Text(
      label,
      style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w800, fontSize: 11),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        sectionTitle('RESUMEN'),
        Divider(color: palette.border, height: 16),
        _CashSummaryRow(label: 'Nombre', value: customer.displayName, big: true),
        const SizedBox(height: 4),
        _CashSummaryRow(label: 'Estado', value: customer.status),
        if (customer.phone != null) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(label: 'Teléfono', value: customer.phone!),
        ],
        if (customer.email != null) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(label: 'Correo', value: customer.email!),
        ],
        if (customer.birthDate != null) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(label: 'Nacimiento', value: customer.birthDate!),
        ],
        if (customer.notes != null && customer.notes!.isNotEmpty) ...[
          const SizedBox(height: 4),
          _CashSummaryRow(label: 'Notas', value: customer.notes!),
        ],
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (_canUpdateCustomer)
              OutlinedButton.icon(
                key: const Key('pos-customer-detail-edit'),
                onPressed: () => unawaited(_openEdit()),
                icon: const Icon(Icons.edit_outlined, size: 15),
                label: const Text('Editar'),
                style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
              ),
            if (_canUpdateCustomer)
              OutlinedButton.icon(
                key: const Key('pos-customer-detail-qr'),
                onPressed: _qrBusy ? null : () => unawaited(_issueOrRotateQr()),
                icon: _qrBusy
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.qr_code_2_outlined, size: 15),
                label: Text(_qrToken == null ? 'Generar QR' : 'Rotar QR'),
                style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
              ),
          ],
        ),
        if (_qrToken != null) ...[
          const SizedBox(height: 8),
          // No QR-image-rendering package is a pre-existing dependency
          // (checked `pubspec.yaml` first, per the task's own constraint)
          // — the opaque token is shown as selectable text instead of a
          // cosmetic QR image; Wallet/QR-scanning integration remains
          // future work (ADR-0017 D17).
          SelectableText(
            _qrToken!.token,
            key: const Key('pos-customer-qr-token'),
            style: TextStyle(color: palette.text, fontFamily: 'monospace', fontSize: 11),
          ),
          Text(
            'Código de identificación del cliente (texto seleccionable). '
            'La integración con Wallet/escaneo QR es trabajo futuro.',
            style: TextStyle(color: palette.textMuted, fontSize: 10),
          ),
        ],
        const SizedBox(height: 16),
        sectionTitle('MEMBRESÍAS'),
        Divider(color: palette.border, height: 16),
        _buildMembershipsSection(palette),
        const SizedBox(height: 16),
        // TASK 13.0: the loyalty points/stamps ledger — renamed from the
        // bare "REWARDS" heading to "AS REWARDS+" (matching this same
        // file's own `_loyaltyError` copy: "No fue posible cargar AS
        // Rewards+.") now that TASK 13.1 adds a second, DISTINCT
        // "RECOMPENSAS" section right below for actual reward
        // entitlements — the two must never be visually or conceptually
        // conflated (ADR-0018 Part L/X's same "never conflate" rule,
        // applied here to two sections instead of two QR concepts).
        sectionTitle('AS REWARDS+'),
        Divider(color: palette.border, height: 16),
        _buildLoyaltySection(palette),
        const SizedBox(height: 16),
        sectionTitle('RECOMPENSAS'),
        Divider(color: palette.border, height: 16),
        _buildRewardsSection(palette),
        const SizedBox(height: 16),
        sectionTitle('VENTAS RECIENTES'),
        Divider(color: palette.border, height: 16),
        _buildSalesSection(palette),
      ],
    );
  }

  Widget _buildMembershipsSection(PosPalette palette) {
    if (!_canReadMembership) {
      return Text('Sin permiso para ver membresías.', style: TextStyle(color: palette.textMuted, fontSize: 12));
    }
    if (!_membershipsLoaded) {
      return const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2)));
    }
    if (_membershipsError != null) {
      return Text(_membershipsError!, style: TextStyle(color: palette.error, fontSize: 12));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_memberships.isEmpty)
          Text('Sin membresías registradas.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
        for (final membership in _memberships)
          Padding(
            key: Key('pos-customer-membership-${membership.id}'),
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _plansById[membership.membershipPlanId]?.name ?? membership.membershipNumber,
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 12),
                      ),
                      Text(
                        membership.expiresAt == null
                            ? 'Desde ${_formatShortDate(membership.startsAt)}'
                            : 'Vence ${_formatShortDate(membership.expiresAt!)}',
                        style: TextStyle(color: palette.textSecondary, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                _StatusChip(label: membership.status),
              ],
            ),
          ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (_canIssueMembership && _plans.isNotEmpty)
              OutlinedButton.icon(
                key: const Key('pos-customer-membership-issue'),
                onPressed: () => unawaited(_openIssueMembership()),
                icon: const Icon(Icons.add, size: 15),
                label: const Text('Agregar membresía'),
                style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
              ),
            for (final membership in _memberships)
              if (membership.status == 'active' || membership.status == 'expired')
                if (_canIssueMembership)
                  OutlinedButton(
                    key: Key('pos-customer-membership-renew-${membership.id}'),
                    onPressed: () => unawaited(_renewMembership(membership)),
                    style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                    child: const Text('Renovar'),
                  ),
            for (final membership in _memberships)
              if (membership.status == 'active' || membership.status == 'pending')
                if (_canManageMembership)
                  OutlinedButton(
                    key: Key('pos-customer-membership-cancel-${membership.id}'),
                    onPressed: () => unawaited(_openCancelMembership(membership)),
                    style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.border)),
                    child: const Text('Cancelar'),
                  ),
            for (final membership in _memberships)
              OutlinedButton(
                key: Key('pos-customer-membership-validate-${membership.id}'),
                onPressed: () => unawaited(_validateMembership(membership)),
                style: OutlinedButton.styleFrom(foregroundColor: palette.blueDeep, side: BorderSide(color: palette.border)),
                child: const Text('Verificar vigencia'),
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildLoyaltySection(PosPalette palette) {
    if (!_canReadLoyalty) {
      return Text('Sin permiso para ver AS Rewards+.', style: TextStyle(color: palette.textMuted, fontSize: 12));
    }
    if (!_loyaltyLoaded) {
      return const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2)));
    }
    if (_loyaltyError != null) {
      return Text(_loyaltyError!, style: TextStyle(color: palette.error, fontSize: 12));
    }
    final loyalty = _loyalty;
    // ADR-0017 D12 — `account: null` means "never earned/adjusted", an
    // honest empty state, never a fake zero-balance card.
    if (loyalty == null || !loyalty.hasAccount) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Sin actividad de rewards.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
          if (_canAdjustLoyalty) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                key: const Key('pos-customer-loyalty-adjust'),
                onPressed: () => unawaited(_openAdjustLoyalty()),
                icon: const Icon(Icons.tune, size: 15),
                label: const Text('Ajustar'),
                style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
              ),
            ),
          ],
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final balance in loyalty.balances)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    balance.programId == null ? 'General' : (_programsById[balance.programId]?.name ?? balance.programId!),
                    style: TextStyle(color: palette.text, fontSize: 12),
                  ),
                ),
                Text(
                  '${balance.balance} ${balance.unitType == 'stamp' ? 'sellos' : 'puntos'}',
                  style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700, fontSize: 12),
                ),
              ],
            ),
          ),
        if (loyalty.ledger.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text('Historial', style: TextStyle(color: palette.textMuted, fontSize: 10, fontWeight: FontWeight.w700)),
          for (final entry in loyalty.ledger.take(8))
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${_entryTypeLabel(entry.entryType)}${entry.reason == null ? '' : ' — ${entry.reason}'}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    '${entry.quantity > 0 ? '+' : ''}${entry.quantity}',
                    style: TextStyle(color: palette.textSecondary, fontSize: 11, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
        ],
        if (_canAdjustLoyalty) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('pos-customer-loyalty-adjust'),
              onPressed: () => unawaited(_openAdjustLoyalty()),
              icon: const Icon(Icons.tune, size: 15),
              label: const Text('Ajustar'),
              style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
            ),
          ),
        ],
      ],
    );
  }

  // TASK 13.1 (Part U): reward entitlements — Disponibles (redeemable
  // right now) plus Historial (redeemed/expired/revoked), clearly
  // separated. Every "is this redeemable" decision reads
  // `entitlement.effectiveStatus` straight from the backend response
  // already fetched — never recomputed from `status` plus a locally-
  // parsed `expiresAt` (ADR-0018 Part N). An empty list renders one
  // honest "No hay recompensas disponibles." line, never a fabricated
  // placeholder reward.
  Widget _buildRewardsSection(PosPalette palette) {
    if (!_canReadReward) {
      return Text('Sin permiso para ver recompensas.', style: TextStyle(color: palette.textMuted, fontSize: 12));
    }
    if (!_rewardsLoaded) {
      return const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2)));
    }
    if (_rewardsError != null) {
      return Text(_rewardsError!, style: TextStyle(color: palette.error, fontSize: 12));
    }
    final available = _rewards.where((entitlement) => entitlement.isAvailable).toList(growable: false);
    final history = _rewards.where((entitlement) => !entitlement.isAvailable).toList(growable: false);
    Widget rewardRow(PosRewardEntitlement entitlement, {bool showRevoke = false}) => Padding(
      key: Key('pos-customer-reward-${entitlement.id}'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _rewardTypeLabel(entitlement.rewardType),
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 12),
                ),
                Text(
                  entitlement.expiresAt == null
                      ? 'Emitida ${_formatShortDate(entitlement.issuedAt)}'
                      : 'Vence ${_formatShortDate(entitlement.expiresAt!)}',
                  style: TextStyle(color: palette.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          _RewardStatusChip(status: entitlement.effectiveStatus),
          if (showRevoke && _canRevokeReward) ...[
            const SizedBox(width: 8),
            OutlinedButton(
              key: Key('pos-customer-reward-revoke-${entitlement.id}'),
              onPressed: () => unawaited(_openRevokeReward(entitlement)),
              style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.border)),
              child: const Text('Revocar'),
            ),
          ],
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_rewards.isEmpty)
          Text('No hay recompensas disponibles.', style: TextStyle(color: palette.textMuted, fontSize: 12))
        else ...[
          if (available.isEmpty)
            Text('Sin recompensas disponibles actualmente.', style: TextStyle(color: palette.textMuted, fontSize: 12))
          else ...[
            Text('Disponibles', style: TextStyle(color: palette.textMuted, fontSize: 10, fontWeight: FontWeight.w700)),
            for (final entitlement in available) rewardRow(entitlement, showRevoke: true),
          ],
          if (history.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Historial', style: TextStyle(color: palette.textMuted, fontSize: 10, fontWeight: FontWeight.w700)),
            for (final entitlement in history) rewardRow(entitlement),
          ],
        ],
        if (_canIssueReward && _programs.isNotEmpty) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('pos-customer-reward-issue'),
              onPressed: () => unawaited(_openIssueReward()),
              icon: const Icon(Icons.add, size: 15),
              label: const Text('Agregar recompensa'),
              style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildSalesSection(PosPalette palette) {
    if (!_canReadSales) {
      return Text('Sin permiso para ver ventas.', style: TextStyle(color: palette.textMuted, fontSize: 12));
    }
    if (!_salesLoaded) {
      return const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2)));
    }
    if (_salesError != null) {
      return Text(_salesError!, style: TextStyle(color: palette.error, fontSize: 12));
    }
    if (_sales.isEmpty) {
      return Text('Sin ventas registradas.', style: TextStyle(color: palette.textMuted, fontSize: 12));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final sale in _sales)
          Padding(
            key: Key('pos-customer-sale-${sale.id}'),
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                Expanded(
                  child: Text(displaySaleFolio(sale.saleNumber), style: TextStyle(color: palette.text, fontSize: 12)),
                ),
                Text(
                  _money(Money.parse(sale.total, sale.currencyCode)),
                  style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700, fontSize: 12),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

String _entryTypeLabel(String entryType) => switch (entryType) {
  'earn' => 'Ganado',
  'redeem' => 'Canjeado',
  'adjustment' => 'Ajuste',
  'expiration' => 'Expiración',
  _ => entryType,
};

// ---------------------------------------------------------------------
// TASK 13.1 — Reward entitlements (Recompensas): Customer Detail's own
// Disponibles/Historial list, the CAJERO checkout redeem affordance
// (`_TicketFooter`/`_TicketRewardsDialog`), and CLIENTE's read-only
// status (`_ClienteRewardStatus`) — see `pos_rewards_gateway.dart` and
// ADR-0018. Every status shown anywhere in this section reads
// `effectiveStatus`, the backend's own live-computed value — never
// `status` plus a locally-parsed `expiresAt` (Part N).
// ---------------------------------------------------------------------

/// `RewardType` is currently always `vip_pass` — kept a plain string
/// lookup (never a closed Dart enum) so a future backend-added type
/// displays honestly without a Flutter release, matching
/// `_entryTypeLabel`'s own fallback-to-raw-value convention above.
String _rewardTypeLabel(String rewardType) => switch (rewardType) {
  'vip_pass' => 'Pase VIP',
  _ => rewardType,
};

/// `RewardEntitlementStatus`, in Spanish — the exact vocabulary this task
/// specifies (Disponible/Canjeado/Vencido/Revocado), consistent across
/// every reward surface in this file.
String _rewardStatusLabel(String effectiveStatus) => switch (effectiveStatus) {
  'available' => 'Disponible',
  'redeemed' => 'Canjeado',
  'expired' => 'Vencido',
  'revoked' => 'Revocado',
  _ => effectiveStatus,
};

class _RewardStatusChip extends StatelessWidget {
  const _RewardStatusChip({required this.status});

  /// The entitlement's `effectiveStatus` — never its raw `status`.
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final color = switch (status) {
      'available' => palette.success,
      'redeemed' => palette.blueDeep,
      'expired' => palette.warning,
      'revoked' => palette.error,
      _ => palette.textSecondary,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(
        _rewardStatusLabel(status),
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800),
      ),
    );
  }
}

/// `POST /customers/{customerId}/reward-entitlements` — MANUAL admin
/// issuance only (`reward.issue`), mirroring `_IssueMembershipDialog`
/// exactly. `reason_code` is required by the backend schema (`minLength:
/// 1`), so this dialog validates it the same way `_CancelMembershipDialog`
/// validates its own reason field.
class _IssueRewardDialog extends StatefulWidget {
  const _IssueRewardDialog({
    required this.rewardsGateway,
    required this.customerId,
    required this.programs,
  });
  final PosRewardsGateway rewardsGateway;
  final String customerId;
  final List<PosLoyaltyProgram> programs;

  @override
  State<_IssueRewardDialog> createState() => _IssueRewardDialogState();
}

class _IssueRewardDialogState extends State<_IssueRewardDialog> {
  late String? _programId = widget.programs.isEmpty ? null : widget.programs.first.id;
  final _reasonController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final programId = _programId;
    final reason = _reasonController.text.trim();
    if (programId == null) {
      setState(() => _error = 'Selecciona un programa.');
      return;
    }
    if (reason.isEmpty) {
      setState(() => _error = 'Escribe un motivo.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.rewardsGateway.issueManual(
        customerId: widget.customerId,
        loyaltyProgramId: programId,
        reasonCode: reason,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible emitir la recompensa.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Agregar recompensa',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                key: const Key('pos-issue-reward-program'),
                initialValue: _programId,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Programa'),
                items: [
                  for (final program in widget.programs)
                    DropdownMenuItem(value: program.id, child: Text(program.name)),
                ],
                onChanged: (value) => setState(() => _programId = value),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-issue-reward-reason'),
                controller: _reasonController,
                maxLines: 2,
                decoration: const InputDecoration(isDense: true, labelText: 'Motivo'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-issue-reward-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-issue-reward-save'),
                      onPressed: _busy ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Emitir'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `POST /reward-entitlements/{id}/revoke` — a manual remedy only
/// (`reward.revoke`), mirroring `_CancelMembershipDialog` exactly,
/// including its `If-Match`/`version` handling.
class _RevokeRewardDialog extends StatefulWidget {
  const _RevokeRewardDialog({required this.rewardsGateway, required this.entitlement});
  final PosRewardsGateway rewardsGateway;
  final PosRewardEntitlement entitlement;

  @override
  State<_RevokeRewardDialog> createState() => _RevokeRewardDialogState();
}

class _RevokeRewardDialogState extends State<_RevokeRewardDialog> {
  final _reasonController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'Escribe un motivo.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.rewardsGateway.revoke(
        widget.entitlement.id,
        reason: reason,
        version: widget.entitlement.version,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible revocar la recompensa.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Revocar recompensa',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 14),
              TextField(
                key: const Key('pos-revoke-reward-reason'),
                controller: _reasonController,
                maxLines: 2,
                decoration: const InputDecoration(isDense: true, labelText: 'Motivo'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-revoke-reward-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Regresar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-revoke-reward-confirm'),
                      onPressed: _busy ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(backgroundColor: palette.error),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Revocar recompensa'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// TASK 13.1 (Part V): the CAJERO checkout reward-lookup/redeem dialog —
/// opened from `_TicketFooter`'s compact "Recompensas disponibles"
/// affordance. Shows every entitlement already fetched for the attached
/// customer (available AND history, for context), but only ever renders
/// a "Canjear" action for a row whose `effectiveStatus` is `available`
/// AND [canRedeem] (`reward.redeem`) is true — mirrors `refund.create`'s
/// own "hide the control entirely for a permission-less actor, never a
/// disabled placeholder" precedent (see `_refundActionWidget` above).
/// Deliberately distinct from `_CustomerSelectorDialog`'s customer-QR
/// flow — never the same component, never a shared token concept (Part
/// L/X).
///
/// TASK 13.2: also the one place a cashier attaches an available
/// entitlement to the CURRENT sale for pricing (ADR-0019) — a separate
/// "Usar en esta venta"/"Quitar" affordance from "Canjear" above, which
/// stays the pre-existing TASK 13.1 standalone redemption, unchanged.
/// [onApply] does the real work (a quote preview via [_TicketFooterState.
/// _applyReward]) and returns an honest rejection message on failure,
/// which this dialog surfaces inline — never a crash, never a silently
/// ignored selection.
class _TicketRewardsDialog extends StatefulWidget {
  const _TicketRewardsDialog({
    required this.rewardsGateway,
    required this.entitlements,
    required this.canRedeem,
    required this.branchId,
    required this.appliedEntitlementId,
    required this.onApply,
    required this.onRemove,
  });
  final PosRewardsGateway rewardsGateway;
  final List<PosRewardEntitlement> entitlements;
  final bool canRedeem;
  final String? branchId;

  /// The entitlement id already attached to the current sale, if any —
  /// `null` for "no reward applied yet".
  final String? appliedEntitlementId;

  /// Previews+attaches [PosRewardEntitlement] to the current sale;
  /// returns `null` on success or a message to display on rejection.
  final Future<String?> Function(PosRewardEntitlement entitlement) onApply;

  /// Detaches whichever entitlement is currently applied.
  final VoidCallback onRemove;

  @override
  State<_TicketRewardsDialog> createState() => _TicketRewardsDialogState();
}

class _TicketRewardsDialogState extends State<_TicketRewardsDialog> {
  late List<PosRewardEntitlement> _entitlements = widget.entitlements;
  late String? _appliedEntitlementId = widget.appliedEntitlementId;
  String? _redeemBusyId;
  String? _applyBusyId;
  String? _error;
  bool _anyRedeemed = false;

  Future<void> _redeem(PosRewardEntitlement entitlement) async {
    setState(() {
      _redeemBusyId = entitlement.id;
      _error = null;
    });
    try {
      final updated = await widget.rewardsGateway.redeem(entitlement.id, branchId: widget.branchId);
      if (!mounted) return;
      setState(() {
        _entitlements = [
          for (final item in _entitlements) if (item.id == updated.id) updated else item,
        ];
        _redeemBusyId = null;
        _anyRedeemed = true;
      });
      _showNotice(context, 'Recompensa canjeada.');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _redeemBusyId = null;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _redeemBusyId = null;
        _error = 'No fue posible canjear la recompensa.';
      });
    }
  }

  Future<void> _apply(PosRewardEntitlement entitlement) async {
    setState(() {
      _applyBusyId = entitlement.id;
      _error = null;
    });
    final error = await widget.onApply(entitlement);
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _applyBusyId = null;
        _error = error;
      });
      return;
    }
    setState(() {
      _applyBusyId = null;
      _appliedEntitlementId = entitlement.id;
    });
    _showNotice(context, 'Recompensa aplicada a esta venta.');
  }

  void _remove() {
    widget.onRemove();
    setState(() => _appliedEntitlementId = null);
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 480),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Recompensas',
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                    ),
                  ),
                  IconButton(
                    key: const Key('pos-ticket-rewards-close'),
                    onPressed: () => Navigator.of(context).pop(_anyRedeemed),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: palette.error, fontSize: 12)),
                const SizedBox(height: 6),
              ],
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final entitlement in _entitlements)
                        Padding(
                          key: Key('pos-ticket-reward-${entitlement.id}'),
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          _rewardTypeLabel(entitlement.rewardType),
                                          style: TextStyle(
                                            color: palette.text,
                                            fontWeight: FontWeight.w700,
                                            fontSize: 12,
                                          ),
                                        ),
                                        Text(
                                          entitlement.expiresAt == null
                                              ? 'Emitida ${_formatShortDate(entitlement.issuedAt)}'
                                              : 'Vence ${_formatShortDate(entitlement.expiresAt!)}',
                                          style: TextStyle(color: palette.textSecondary, fontSize: 11),
                                        ),
                                      ],
                                    ),
                                  ),
                                  _RewardStatusChip(status: entitlement.effectiveStatus),
                                  if (entitlement.isAvailable && widget.canRedeem) ...[
                                    const SizedBox(width: 8),
                                    _redeemBusyId == entitlement.id
                                        ? const SizedBox(
                                            width: 16,
                                            height: 16,
                                            child: CircularProgressIndicator(strokeWidth: 2),
                                          )
                                        : OutlinedButton(
                                            key: Key('pos-ticket-reward-redeem-${entitlement.id}'),
                                            onPressed: () => unawaited(_redeem(entitlement)),
                                            style: OutlinedButton.styleFrom(
                                              foregroundColor: palette.action,
                                              side: BorderSide(color: palette.border),
                                            ),
                                            child: const Text('Canjear'),
                                          ),
                                  ],
                                ],
                              ),
                              // TASK 13.2: attaches this entitlement to the
                              // CURRENT sale for pricing — distinct from
                              // "Canjear" above (the pre-existing TASK 13.1
                              // standalone redemption). Only ever rendered
                              // for the same available+permitted rows.
                              if (entitlement.isAvailable && widget.canRedeem)
                                Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: _appliedEntitlementId == entitlement.id
                                      ? OutlinedButton.icon(
                                          key: Key('pos-ticket-reward-remove-${entitlement.id}'),
                                          onPressed: _remove,
                                          icon: Icon(Icons.check_circle, size: 14, color: palette.success),
                                          label: const Text('Aplicada a esta venta — Quitar'),
                                          style: OutlinedButton.styleFrom(
                                            foregroundColor: palette.success,
                                            side: BorderSide(color: palette.success),
                                          ),
                                        )
                                      : _applyBusyId == entitlement.id
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(strokeWidth: 2),
                                        )
                                      : OutlinedButton(
                                          key: Key('pos-ticket-reward-apply-${entitlement.id}'),
                                          onPressed: () => unawaited(_apply(entitlement)),
                                          style: OutlinedButton.styleFrom(
                                            foregroundColor: palette.success,
                                            side: BorderSide(color: palette.border),
                                          ),
                                          child: const Text('Usar en esta venta'),
                                        ),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Manual admin issuance only (ADR-0017 D9) — never the POS-purchase
/// path, which happens automatically server-side on payment settlement.
class _IssueMembershipDialog extends StatefulWidget {
  const _IssueMembershipDialog({
    required this.membershipsGateway,
    required this.customerId,
    required this.plans,
  });
  final PosMembershipsGateway membershipsGateway;
  final String customerId;
  final List<PosMembershipPlan> plans;

  @override
  State<_IssueMembershipDialog> createState() => _IssueMembershipDialogState();
}

class _IssueMembershipDialogState extends State<_IssueMembershipDialog> {
  late String? _selectedPlanId = widget.plans.where((plan) => plan.active).isEmpty
      ? null
      : widget.plans.firstWhere((plan) => plan.active).id;
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    final planId = _selectedPlanId;
    if (planId == null) {
      setState(() => _error = 'Selecciona un plan.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.membershipsGateway.issueMembership(customerId: widget.customerId, membershipPlanId: planId);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible emitir la membresía.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Agregar membresía',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                key: const Key('pos-issue-membership-plan'),
                initialValue: _selectedPlanId,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Plan'),
                items: [
                  for (final plan in widget.plans)
                    DropdownMenuItem(value: plan.id, child: Text(plan.name)),
                ],
                onChanged: (value) => setState(() => _selectedPlanId = value),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-issue-membership-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-issue-membership-save'),
                      onPressed: _busy ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Emitir'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `POST /customer-memberships/{id}/cancel` — a manual remedy only, never
/// automatic (ADR-0017 D20).
class _CancelMembershipDialog extends StatefulWidget {
  const _CancelMembershipDialog({required this.membershipsGateway, required this.membership});
  final PosMembershipsGateway membershipsGateway;
  final PosCustomerMembership membership;

  @override
  State<_CancelMembershipDialog> createState() => _CancelMembershipDialogState();
}

class _CancelMembershipDialogState extends State<_CancelMembershipDialog> {
  final _reasonController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'Escribe un motivo.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.membershipsGateway.cancelMembership(
        widget.membership.id,
        reason: reason,
        version: widget.membership.version,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible cancelar la membresía.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Cancelar membresía',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 14),
              TextField(
                key: const Key('pos-cancel-membership-reason'),
                controller: _reasonController,
                maxLines: 2,
                decoration: const InputDecoration(isDense: true, labelText: 'Motivo'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-cancel-membership-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Regresar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-cancel-membership-confirm'),
                      onPressed: _busy ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(backgroundColor: palette.error),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Cancelar membresía'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `POST /customers/{customerId}/loyalty/adjust` — gated by the caller on
/// `loyalty.adjust` SEPARATELY from `loyalty.manage` (Part Y). [quantity]
/// is signed — a correction is always a new ledger row, never an edit to
/// a prior one (ADR-0017 D13).
class _LoyaltyAdjustDialog extends StatefulWidget {
  const _LoyaltyAdjustDialog({
    required this.loyaltyGateway,
    required this.customerId,
    required this.programs,
  });
  final PosLoyaltyGateway loyaltyGateway;
  final String customerId;
  final List<PosLoyaltyProgram> programs;

  @override
  State<_LoyaltyAdjustDialog> createState() => _LoyaltyAdjustDialogState();
}

class _LoyaltyAdjustDialogState extends State<_LoyaltyAdjustDialog> {
  final _quantityController = TextEditingController();
  final _reasonController = TextEditingController();
  String _unitType = 'point';
  String? _programId;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _quantityController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final quantity = int.tryParse(_quantityController.text.trim());
    final reason = _reasonController.text.trim();
    if (quantity == null || quantity == 0 || reason.isEmpty) {
      setState(() => _error = 'Escribe una cantidad distinta de cero y un motivo.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.loyaltyGateway.adjustLoyalty(
        customerId: widget.customerId,
        quantity: quantity,
        unitType: _unitType,
        reason: reason,
        loyaltyProgramId: _programId,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible registrar el ajuste.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Ajustar rewards',
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
              ),
              const SizedBox(height: 14),
              TextField(
                key: const Key('pos-loyalty-adjust-quantity'),
                controller: _quantityController,
                keyboardType: const TextInputType.numberWithOptions(signed: true),
                decoration: const InputDecoration(isDense: true, labelText: 'Cantidad (+/-)'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                key: const Key('pos-loyalty-adjust-unit-type'),
                initialValue: _unitType,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Unidad'),
                items: const [
                  DropdownMenuItem(value: 'point', child: Text('Puntos')),
                  DropdownMenuItem(value: 'stamp', child: Text('Sellos')),
                ],
                onChanged: (value) => setState(() => _unitType = value ?? 'point'),
              ),
              if (widget.programs.isNotEmpty) ...[
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  key: const Key('pos-loyalty-adjust-program'),
                  initialValue: _programId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Programa (opcional)'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('General')),
                    for (final program in widget.programs)
                      DropdownMenuItem(value: program.id, child: Text(program.name)),
                  ],
                  onChanged: (value) => setState(() => _programId = value),
                ),
              ],
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-loyalty-adjust-reason'),
                controller: _reasonController,
                maxLines: 2,
                decoration: const InputDecoration(isDense: true, labelText: 'Motivo'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, key: const Key('pos-loyalty-adjust-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-loyalty-adjust-save'),
                      onPressed: _busy ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Guardar ajuste'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `PosModule.memberships` ("Membresías") — membership PLAN admin only
/// (list/create/edit); a customer's own issued memberships live in
/// Customer Detail instead of a second, duplicate list here.
class _MembershipsAdmin extends StatefulWidget {
  const _MembershipsAdmin({required this.context, required this.membershipsGateway});
  final AuthenticatedContext context;
  final PosMembershipsGateway membershipsGateway;

  @override
  State<_MembershipsAdmin> createState() => _MembershipsAdminState();
}

class _MembershipsAdminState extends State<_MembershipsAdmin> {
  _AdminListPhase _phase = _AdminListPhase.loading;
  List<PosMembershipPlan> _plans = const [];
  String? _errorMessage;

  bool get _canRead => widget.context.permissions.contains('membership.read');
  bool get _canManage => widget.context.permissions.contains('membership.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    try {
      final plans = await widget.membershipsGateway.listPlans();
      if (!mounted) return;
      setState(() {
        _plans = plans;
        _phase = _plans.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar los planes de membresía.';
      });
    }
  }

  Future<void> _openForm({PosMembershipPlan? existing}) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _MembershipPlanFormDialog(membershipsGateway: widget.membershipsGateway, existing: existing),
    );
    if (saved == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Membresías',
          description: 'Planes de membresía — administración mínima: listar, crear y editar (ADR-0017).',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (_canManage)
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: FilledButton.icon(
                key: const Key('pos-membership-plan-new'),
                onPressed: () => unawaited(_openForm()),
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Nuevo plan'),
              ),
            ),
          ),
        if (!_canRead)
          const _PermissionState()
        else
          switch (_phase) {
            _AdminListPhase.loading => const _LoadingState(),
            _AdminListPhase.empty => const _EmptyState(message: 'No hay planes de membresía registrados.'),
            _AdminListPhase.failure => _FailureState(
              message: _errorMessage ?? 'No fue posible cargar los planes de membresía.',
              onRetry: () => unawaited(_load()),
            ),
            _AdminListPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final plan in _plans)
                  _MembershipPlanRow(plan: plan, canManage: _canManage, onEdit: () => unawaited(_openForm(existing: plan))),
              ],
            ),
          },
      ],
    );
  }
}

class _MembershipPlanRow extends StatelessWidget {
  const _MembershipPlanRow({required this.plan, required this.canManage, required this.onEdit});
  final PosMembershipPlan plan;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final details = [
      if (plan.durationDays != null) '${plan.durationDays} días',
      if (plan.benefitDescription != null && plan.benefitDescription!.isNotEmpty) plan.benefitDescription!,
    ].join(' · ');
    return _PosCard(
      key: Key('pos-membership-plan-row-${plan.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(plan.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  if (details.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(details, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                  ],
                ],
              ),
            ),
            _StatusChip(label: plan.active ? 'active' : 'inactive'),
            if (canManage)
              IconButton(
                key: Key('pos-membership-plan-edit-${plan.id}'),
                tooltip: 'Editar plan',
                onPressed: onEdit,
                icon: Icon(Icons.edit_outlined, size: 18, color: palette.blueDeep),
              ),
          ],
        ),
      ),
    );
  }
}

/// `POST/PUT /membership-plans` — the minimal admin form (name, optional
/// description/duration/benefit description, active toggle). Product
/// linkage/branch eligibility stay backend-configured defaults here — no
/// product picker exists elsewhere in this app to safely reuse, and Part U
/// calls for minimum operational management, not a full catalog editor.
class _MembershipPlanFormDialog extends StatefulWidget {
  const _MembershipPlanFormDialog({required this.membershipsGateway, this.existing});
  final PosMembershipsGateway membershipsGateway;
  final PosMembershipPlan? existing;

  @override
  State<_MembershipPlanFormDialog> createState() => _MembershipPlanFormDialogState();
}

class _MembershipPlanFormDialogState extends State<_MembershipPlanFormDialog> {
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _descriptionController = TextEditingController(text: widget.existing?.description ?? '');
  late final _durationController = TextEditingController(text: widget.existing?.durationDays?.toString() ?? '');
  late final _benefitController = TextEditingController(text: widget.existing?.benefitDescription ?? '');
  late bool _active = widget.existing?.active ?? true;
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _durationController.dispose();
    _benefitController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    final durationText = _durationController.text.trim();
    final duration = durationText.isEmpty ? null : int.tryParse(durationText);
    if (durationText.isNotEmpty && duration == null) {
      setState(() => _error = 'La duración debe ser un número de días.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final description = _descriptionController.text.trim();
    final benefit = _benefitController.text.trim();
    final input = PosMembershipPlanInput(
      name: name,
      description: description.isEmpty ? null : description,
      active: _active,
      durationDays: duration,
      benefitDescription: benefit.isEmpty ? null : benefit,
    );
    try {
      if (_isEdit) {
        await widget.membershipsGateway.updatePlan(widget.existing!.id, input, version: widget.existing!.version);
      } else {
        await widget.membershipsGateway.createPlan(input);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar el plan.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 560),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar plan' : 'Nuevo plan',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-membership-plan-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-membership-plan-description'),
                  controller: _descriptionController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-membership-plan-duration'),
                  controller: _durationController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(isDense: true, labelText: 'Duración en días (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-membership-plan-benefit'),
                  controller: _benefitController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Beneficio (opcional)'),
                ),
                const SizedBox(height: 6),
                SwitchListTile(
                  key: const Key('pos-membership-plan-active'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Activo'),
                  value: _active,
                  onChanged: (value) => setState(() => _active = value),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-membership-plan-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-membership-plan-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// TASK 14.3 Wave 1 Part A: "Fiestas" (party reservations) — real Lista/
// Calendario/Cotizador/Ajustes wired to the already-tested
// `apps/api/src/modules/parties/` module (27/27 integration tests passing
// server-side). See `docs/LEGACY_FIESTAS_RECOVERY.md` for the legacy
// behavioral spec this UI is recognizably descended from, using this
// platform's own design system (never a redesign into a generic admin
// dashboard) — mirrors `_CustomersAdmin`/`_MembershipsAdmin`'s exact
// architecture: `_AdminListPhase`/`_PosCard`/`_SectionHeader`/
// `_LoadingState`/`_EmptyState`/`_PermissionState`/`_FailureState`/
// `_ReadOnlyButton` are all reused verbatim, never redefined.
// =============================================================================

String _partyStatusLabel(String status) => switch (status) {
  'held' => 'Apartada',
  'pending_deposit' => 'Pendiente de anticipo',
  'confirmed' => 'Confirmada',
  'completed' => 'Completada',
  'cancelled' => 'Cancelada',
  _ => status,
};

Color _partyStatusColor(PosPalette palette, String status) => switch (status) {
  'held' => palette.textMuted,
  'pending_deposit' => palette.warning,
  'confirmed' => palette.action,
  'completed' => palette.success,
  'cancelled' => palette.error,
  _ => palette.textMuted,
};

String _paymentPurposeLabel(String purpose) => switch (purpose) {
  'deposit' => 'Anticipo',
  'balance' => 'Liquidación',
  'additional' => 'Adicional',
  _ => purpose,
};

/// `HH:MM:SS` (or `HH:MM`) -> `HH:MM`, for display only — never re-parsed
/// from this truncated form.
String _hhmm(String value) => value.length >= 5 ? value.substring(0, 5) : value;

/// `YYYY-MM-DD`, matching every date the parties API sends/accepts exactly
/// — distinct from this file's other `_formatDate` (a display-only
/// dd/mm/yyyy helper scoped to a different class).
String _isoDate(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

String _formatPartyMoney(String amount, String currencyCode) {
  try {
    return '${Money.parse(amount, currencyCode).toDisplayString()} $currencyCode';
  } on MoneyFormatException {
    return '$amount $currencyCode';
  }
}

class _PartyStatusChip extends StatelessWidget {
  const _PartyStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final color = _partyStatusColor(palette, status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(_partyStatusLabel(status), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }
}

class _RoomStatusChip extends StatelessWidget {
  const _RoomStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final color = switch (status) {
      'active' => palette.success,
      'maintenance' => palette.warning,
      _ => palette.error,
    };
    final label = switch (status) {
      'active' => 'Activo',
      'maintenance' => 'Mantenimiento',
      _ => 'Fuera de servicio',
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }
}

class _PartyKpiChip extends StatelessWidget {
  const _PartyKpiChip({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: palette.actionTint, borderRadius: BorderRadius.circular(10)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(value, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 13)),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
        ],
      ),
    );
  }
}

class _QuoteLine extends StatelessWidget {
  const _QuoteLine({required this.label, required this.amount, required this.currency, this.emphasize = false});
  final String label;
  final String amount;
  final String currency;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: TextStyle(color: palette.textSecondary, fontWeight: emphasize ? FontWeight.w800 : FontWeight.w500)),
          ),
          Text(
            _formatPartyMoney(amount, currency),
            style: TextStyle(color: palette.text, fontWeight: emphasize ? FontWeight.w800 : FontWeight.w600, fontSize: emphasize ? 15 : 13),
          ),
        ],
      ),
    );
  }
}

enum _FiestasTab { lista, calendario, cotizador, ajustes }

/// `PosModule.events` ("Fiestas") — gated on `party.read`, matching every
/// other admin section's own "permission-less actor never sees real data,
/// sees an honest permission state" pattern exactly (`_CustomersAdmin`/
/// `_MembershipsAdmin`'s `_canRead`/`_PermissionState()`).
class _FiestasAdmin extends StatefulWidget {
  const _FiestasAdmin({
    required this.context,
    required this.controller,
    required this.partiesGateway,
    required this.customersGateway,
    required this.cashGateway,
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPartiesGateway partiesGateway;
  final PosCustomersGateway customersGateway;
  final PosCashGateway cashGateway;

  @override
  State<_FiestasAdmin> createState() => _FiestasAdminState();
}

class _FiestasAdminState extends State<_FiestasAdmin> {
  _FiestasTab _tab = _FiestasTab.lista;

  bool get _canRead => widget.context.permissions.contains('party.read');

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _SectionHeader(
        title: 'Fiestas',
        description: 'Reservaciones, calendario, cotizador y administración de salones/paquetes.',
        action: _canRead
            ? SegmentedButton<_FiestasTab>(
                key: const Key('pos-fiestas-tabs'),
                segments: const [
                  ButtonSegment(value: _FiestasTab.lista, label: Text('Lista')),
                  ButtonSegment(value: _FiestasTab.calendario, label: Text('Calendario')),
                  ButtonSegment(value: _FiestasTab.cotizador, label: Text('Cotizador')),
                  ButtonSegment(value: _FiestasTab.ajustes, label: Text('Ajustes')),
                ],
                selected: {_tab},
                onSelectionChanged: (value) => setState(() => _tab = value.first),
              )
            : null,
      ),
      if (!_canRead)
        const _PermissionState()
      else
        switch (_tab) {
          _FiestasTab.lista => _FiestasLista(
            context: widget.context,
            controller: widget.controller,
            partiesGateway: widget.partiesGateway,
            customersGateway: widget.customersGateway,
            cashGateway: widget.cashGateway,
          ),
          _FiestasTab.calendario => _FiestasCalendario(
            context: widget.context,
            controller: widget.controller,
            partiesGateway: widget.partiesGateway,
          ),
          _FiestasTab.cotizador => _FiestasCotizador(
            context: widget.context,
            controller: widget.controller,
            partiesGateway: widget.partiesGateway,
            customersGateway: widget.customersGateway,
          ),
          _FiestasTab.ajustes => _FiestasAjustes(context: widget.context, partiesGateway: widget.partiesGateway),
        },
    ],
  );
}

/// Lista — real, API-backed reservation list. KPIs are counted from the
/// real, currently-loaded page (never hardcoded sample numbers).
class _FiestasLista extends StatefulWidget {
  const _FiestasLista({
    required this.context,
    required this.controller,
    required this.partiesGateway,
    required this.customersGateway,
    required this.cashGateway,
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPartiesGateway partiesGateway;
  final PosCustomersGateway customersGateway;
  final PosCashGateway cashGateway;

  @override
  State<_FiestasLista> createState() => _FiestasListaState();
}

class _FiestasListaState extends State<_FiestasLista> {
  _AdminListPhase _phase = _AdminListPhase.loading;
  List<PosPartyReservation> _items = const [];
  String? _nextCursor;
  bool _loadingMore = false;
  String? _errorMessage;
  Map<String, PosPartyRoom> _roomsById = const {};
  Map<String, PosPartyPackage> _packagesById = const {};
  String? _statusFilter;
  String? _roomFilter;

  bool get _canRead => widget.context.permissions.contains('party.read');
  bool get _canManage => widget.context.permissions.contains('party.manage');
  String? get _branchId => widget.context.session.branchId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    try {
      final roomsPage = await widget.partiesGateway.listRooms(branchId: _branchId, limit: 100);
      final packagesPage = await widget.partiesGateway.listPackages(limit: 100);
      final page = await widget.partiesGateway.listReservations(
        branchId: _branchId,
        status: _statusFilter,
        roomId: _roomFilter,
        limit: 100,
      );
      if (!mounted) return;
      setState(() {
        _roomsById = {for (final room in roomsPage.items) room.id: room};
        _packagesById = {for (final pkg in packagesPage.items) pkg.id: pkg};
        _items = page.items;
        _nextCursor = page.nextCursor;
        _phase = _items.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar las reservaciones.';
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.partiesGateway.listReservations(
        branchId: _branchId,
        status: _statusFilter,
        roomId: _roomFilter,
        cursor: cursor,
        limit: 100,
      );
      if (!mounted) return;
      setState(() {
        _items = [..._items, ...page.items];
        _nextCursor = page.nextCursor;
        _loadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  Future<void> _openCreate() async {
    final branchId = _branchId;
    if (branchId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Esta sesión no tiene una sucursal asignada.')),
      );
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PartyReservationFormDialog(
        context: widget.context,
        controller: widget.controller,
        partiesGateway: widget.partiesGateway,
        customersGateway: widget.customersGateway,
        branchId: branchId,
      ),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosPartyReservation reservation) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PartyReservationDetailDialog(
        reservationId: reservation.id,
        context: widget.context,
        controller: widget.controller,
        partiesGateway: widget.partiesGateway,
        customersGateway: widget.customersGateway,
        cashGateway: widget.cashGateway,
      ),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final counts = <String, int>{
      for (final status in partyReservationStatuses) status: _items.where((item) => item.status == status).length,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [for (final status in partyReservationStatuses) _PartyKpiChip(label: _partyStatusLabel(status), value: '${counts[status] ?? 0}')],
              ),
            ),
            _ReadOnlyButton(onPressed: () => unawaited(_load())),
            if (_canManage) ...[
              const SizedBox(width: 8),
              FilledButton.icon(
                key: const Key('pos-fiestas-new-reservation'),
                onPressed: () => unawaited(_openCreate()),
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Nueva reservación'),
              ),
            ],
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String?>(
                key: const Key('pos-fiestas-filter-status'),
                initialValue: _statusFilter,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Todos')),
                  for (final status in partyReservationStatuses) DropdownMenuItem(value: status, child: Text(_partyStatusLabel(status))),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value);
                  unawaited(_load());
                },
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: DropdownButtonFormField<String?>(
                key: const Key('pos-fiestas-filter-room'),
                initialValue: _roomFilter,
                decoration: const InputDecoration(isDense: true, labelText: 'Salón'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Todos')),
                  for (final room in _roomsById.values) DropdownMenuItem(value: room.id, child: Text(room.name)),
                ],
                onChanged: (value) {
                  setState(() => _roomFilter = value);
                  unawaited(_load());
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (!_canRead)
          const _PermissionState()
        else
          switch (_phase) {
            _AdminListPhase.loading => const _LoadingState(),
            _AdminListPhase.empty => const _EmptyState(message: 'No hay reservaciones registradas.'),
            _AdminListPhase.failure => _FailureState(
              message: _errorMessage ?? 'No fue posible cargar las reservaciones.',
              onRetry: () => unawaited(_load()),
            ),
            _AdminListPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final item in _items)
                  _PartyReservationRow(
                    reservation: item,
                    room: _roomsById[item.roomId],
                    package: _packagesById[item.packageId],
                    onTap: () => unawaited(_openDetail(item)),
                  ),
                if (_nextCursor != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Center(
                      child: OutlinedButton.icon(
                        key: const Key('pos-fiestas-load-more'),
                        onPressed: _loadingMore ? null : () => unawaited(_loadMore()),
                        icon: _loadingMore
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.expand_more),
                        label: const Text('Cargar más'),
                      ),
                    ),
                  ),
              ],
            ),
          },
      ],
    );
  }
}

class _PartyReservationRow extends StatelessWidget {
  const _PartyReservationRow({required this.reservation, required this.room, required this.package, required this.onTap});
  final PosPartyReservation reservation;
  final PosPartyRoom? room;
  final PosPartyPackage? package;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final title = reservation.celebrantName?.isNotEmpty == true
        ? reservation.celebrantName!
        : (reservation.customerDisplayName ?? 'Sin festejado');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        key: Key('pos-fiestas-reservation-${reservation.id}'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: _PosCard(
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      '${reservation.eventDate} · ${_hhmm(reservation.startTime)}-${_hhmm(reservation.endTime)} · '
                      '${room?.name ?? 'Salón'} · ${package?.name ?? 'Paquete'}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                    if (reservation.customerDisplayName != null && reservation.celebrantName?.isNotEmpty == true)
                      Text(reservation.customerDisplayName!, style: TextStyle(color: palette.textMuted, fontSize: 11)),
                  ],
                ),
              ),
              Text(
                _formatPartyMoney(reservation.quotedTotal, reservation.currencyCode),
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 12),
              ),
              const SizedBox(width: 10),
              _PartyStatusChip(status: reservation.status),
            ],
          ),
        ),
      ),
    );
  }
}

enum _CalGranularity { month, week, day, list }

/// Calendario — Mes/Semana/Día/Lista sub-views of the SAME real data via
/// `GET /party-reservations/calendar`, grouped by day client-side (a
/// grouped-list rendering rather than a bespoke grid-calendar widget —
/// correctness/real-data over visual complexity, per task scope).
class _FiestasCalendario extends StatefulWidget {
  const _FiestasCalendario({required this.context, required this.controller, required this.partiesGateway});
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPartiesGateway partiesGateway;

  @override
  State<_FiestasCalendario> createState() => _FiestasCalendarioState();
}

class _FiestasCalendarioState extends State<_FiestasCalendario> {
  _CalGranularity _granularity = _CalGranularity.month;
  DateTime _anchor = DateTime.now();
  _AdminListPhase _phase = _AdminListPhase.loading;
  List<PosPartyCalendarEntry> _entries = const [];
  Map<String, PosPartyRoom> _roomsById = const {};
  String? _errorMessage;

  String? get _branchId => widget.context.session.branchId;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onControllerChanged);
    unawaited(Future.microtask(widget.controller.loadUsers));
    unawaited(_load());
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    super.dispose();
  }

  void _onControllerChanged() {
    if (mounted) setState(() {});
  }

  (DateTime, DateTime) _range() {
    switch (_granularity) {
      case _CalGranularity.month:
        final first = DateTime(_anchor.year, _anchor.month);
        final last = DateTime(_anchor.year, _anchor.month + 1, 0);
        return (first, last);
      case _CalGranularity.week:
        final start = _anchor.subtract(Duration(days: _anchor.weekday - 1));
        return (start, start.add(const Duration(days: 6)));
      case _CalGranularity.day:
        return (_anchor, _anchor);
      case _CalGranularity.list:
        return (_anchor, _anchor.add(const Duration(days: 30)));
    }
  }

  Future<void> _load() async {
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    final (from, to) = _range();
    try {
      final rooms = await widget.partiesGateway.listRooms(branchId: _branchId, limit: 100);
      final entries = await widget.partiesGateway.calendar(from: _isoDate(from), to: _isoDate(to), branchId: _branchId);
      if (!mounted) return;
      setState(() {
        _roomsById = {for (final room in rooms.items) room.id: room};
        _entries = entries;
        _phase = entries.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar el calendario.';
      });
    }
  }

  void _nav(int direction) {
    setState(() {
      _anchor = switch (_granularity) {
        _CalGranularity.month => DateTime(_anchor.year, _anchor.month + direction),
        _CalGranularity.week => _anchor.add(Duration(days: 7 * direction)),
        _CalGranularity.day => _anchor.add(Duration(days: direction)),
        _CalGranularity.list => _anchor.add(Duration(days: 30 * direction)),
      };
    });
    unawaited(_load());
  }

  String _sellerLabel(String? id) {
    if (id == null) return 'Sin vendedor';
    final user = widget.controller.users.items.where((u) => u.id == id).firstOrNull;
    return user?.displayName ?? id;
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final grouped = <String, List<PosPartyCalendarEntry>>{};
    for (final entry in _entries) {
      grouped.putIfAbsent(entry.eventDate, () => []).add(entry);
    }
    final sortedDates = grouped.keys.toList()..sort();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: SegmentedButton<_CalGranularity>(
                key: const Key('pos-fiestas-cal-granularity'),
                segments: const [
                  ButtonSegment(value: _CalGranularity.month, label: Text('Mes')),
                  ButtonSegment(value: _CalGranularity.week, label: Text('Semana')),
                  ButtonSegment(value: _CalGranularity.day, label: Text('Día')),
                  ButtonSegment(value: _CalGranularity.list, label: Text('Lista')),
                ],
                selected: {_granularity},
                onSelectionChanged: (value) {
                  setState(() => _granularity = value.first);
                  unawaited(_load());
                },
              ),
            ),
            IconButton(key: const Key('pos-fiestas-cal-prev'), onPressed: () => _nav(-1), icon: const Icon(Icons.chevron_left)),
            TextButton(
              key: const Key('pos-fiestas-cal-today'),
              onPressed: () {
                setState(() => _anchor = DateTime.now());
                unawaited(_load());
              },
              child: const Text('Hoy'),
            ),
            IconButton(key: const Key('pos-fiestas-cal-next'), onPressed: () => _nav(1), icon: const Icon(Icons.chevron_right)),
          ],
        ),
        const SizedBox(height: 10),
        switch (_phase) {
          _AdminListPhase.loading => const _LoadingState(),
          _AdminListPhase.empty => const _EmptyState(message: 'No hay reservaciones en este periodo.'),
          _AdminListPhase.failure => _FailureState(
            message: _errorMessage ?? 'No fue posible cargar el calendario.',
            onRetry: () => unawaited(_load()),
          ),
          _AdminListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final date in sortedDates) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Text(date, style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w800, fontSize: 12)),
                ),
                for (final entry in (grouped[date]!..sort((a, b) => a.startTime.compareTo(b.startTime))))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: _PosCard(
                      key: Key('pos-fiestas-cal-entry-${entry.id}'),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  entry.celebrantName?.isNotEmpty == true
                                      ? entry.celebrantName!
                                      : (entry.customerDisplayName ?? 'Sin festejado'),
                                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                                ),
                                Text(
                                  '${_hhmm(entry.startTime)}-${_hhmm(entry.endTime)} · ${_roomsById[entry.roomId]?.name ?? 'Salón'} · '
                                  '${_sellerLabel(entry.sellerUserId)}',
                                  style: TextStyle(color: palette.textSecondary, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          _PartyStatusChip(status: entry.status),
                        ],
                      ),
                    ),
                  ),
              ],
            ],
          ),
        },
      ],
    );
  }
}

/// Cotizador — a real quoting form, calling the real `.../quote` endpoint;
/// every displayed figure is exactly what the backend returned, never
/// client-computed. "Convertir a reservación" pre-fills the create-
/// reservation form with the chosen package/guest counts — never a
/// client-computed total.
class _FiestasCotizador extends StatefulWidget {
  const _FiestasCotizador({
    required this.context,
    required this.controller,
    required this.partiesGateway,
    required this.customersGateway,
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPartiesGateway partiesGateway;
  final PosCustomersGateway customersGateway;

  @override
  State<_FiestasCotizador> createState() => _FiestasCotizadorState();
}

class _FiestasCotizadorState extends State<_FiestasCotizador> {
  _AdminListPhase _phase = _AdminListPhase.loading;
  List<PosPartyPackage> _packages = const [];
  String? _errorMessage;
  String? _packageId;
  final _childrenController = TextEditingController(text: '0');
  final _adultsController = TextEditingController(text: '0');
  final _extraHalfHoursController = TextEditingController(text: '0');
  bool _quoting = false;
  String? _quoteError;
  PosPartyQuote? _quote;

  bool get _canManage => widget.context.permissions.contains('party.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _childrenController.dispose();
    _adultsController.dispose();
    _extraHalfHoursController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.partiesGateway.listPackages(status: 'active', limit: 100);
      if (!mounted) return;
      setState(() {
        _packages = page.items;
        _packageId = _packages.isEmpty ? null : _packages.first.id;
        _phase = _packages.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar los paquetes.';
      });
    }
  }

  Future<void> _quotePackage() async {
    final packageId = _packageId;
    if (packageId == null) return;
    final children = int.tryParse(_childrenController.text.trim()) ?? 0;
    final adults = int.tryParse(_adultsController.text.trim()) ?? 0;
    final extraHalfHours = int.tryParse(_extraHalfHoursController.text.trim()) ?? 0;
    setState(() {
      _quoting = true;
      _quoteError = null;
    });
    try {
      final quote = await widget.partiesGateway.quotePackage(packageId, children: children, adults: adults, extraHalfHours: extraHalfHours);
      if (!mounted) return;
      setState(() {
        _quote = quote;
        _quoting = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _quoting = false;
        _quoteError = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _quoting = false;
        _quoteError = 'No fue posible calcular la cotización.';
      });
    }
  }

  Future<void> _convertToReservation() async {
    final packageId = _packageId;
    final branchId = widget.context.session.branchId;
    if (packageId == null || branchId == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PartyReservationFormDialog(
        context: widget.context,
        controller: widget.controller,
        partiesGateway: widget.partiesGateway,
        customersGateway: widget.customersGateway,
        branchId: branchId,
        prefillPackageId: packageId,
        prefillChildren: int.tryParse(_childrenController.text.trim()),
        prefillAdults: int.tryParse(_adultsController.text.trim()),
        prefillExtraHalfHours: int.tryParse(_extraHalfHoursController.text.trim()),
      ),
    );
    if (saved == true && mounted) {
      _showNotice(context, 'Reservación creada.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        switch (_phase) {
          _AdminListPhase.loading => const _LoadingState(),
          _AdminListPhase.empty => const _EmptyState(message: 'No hay paquetes activos para cotizar.'),
          _AdminListPhase.failure => _FailureState(
            message: _errorMessage ?? 'No fue posible cargar los paquetes.',
            onRetry: () => unawaited(_load()),
          ),
          _AdminListPhase.ready => _PosCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownButtonFormField<String>(
                  key: const Key('pos-fiestas-quote-package'),
                  initialValue: _packageId,
                  decoration: const InputDecoration(isDense: true, labelText: 'Paquete'),
                  items: [for (final pkg in _packages) DropdownMenuItem(value: pkg.id, child: Text(pkg.name))],
                  onChanged: (value) => setState(() {
                    _packageId = value;
                    _quote = null;
                  }),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-quote-children'),
                        controller: _childrenController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Niños'),
                        onChanged: (_) => setState(() => _quote = null),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-quote-adults'),
                        controller: _adultsController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Adultos'),
                        onChanged: (_) => setState(() => _quote = null),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-quote-extra-time'),
                        controller: _extraHalfHoursController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Medias horas extra'),
                        onChanged: (_) => setState(() => _quote = null),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  key: const Key('pos-fiestas-quote-submit'),
                  onPressed: _quoting ? null : () => unawaited(_quotePackage()),
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: _quoting
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.calculate_outlined, size: 16),
                  label: const Text('Cotizar'),
                ),
                if (_quoteError != null) ...[
                  const SizedBox(height: 10),
                  Text(_quoteError!, key: const Key('pos-fiestas-quote-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                if (_quote != null) ...[
                  const SizedBox(height: 14),
                  Divider(color: palette.border),
                  const SizedBox(height: 10),
                  _QuoteLine(label: 'Base', amount: _quote!.base, currency: _quote!.currencyCode),
                  _QuoteLine(label: 'Niños extra', amount: _quote!.childrenExtra, currency: _quote!.currencyCode),
                  _QuoteLine(label: 'Adultos extra', amount: _quote!.adultsExtra, currency: _quote!.currencyCode),
                  _QuoteLine(label: 'Tiempo extra', amount: _quote!.timeExtra, currency: _quote!.currencyCode),
                  const SizedBox(height: 6),
                  _QuoteLine(label: 'Total', amount: _quote!.total, currency: _quote!.currencyCode, emphasize: true),
                  if (_canManage) ...[
                    const SizedBox(height: 14),
                    FilledButton.icon(
                      key: const Key('pos-fiestas-quote-convert'),
                      onPressed: () => unawaited(_convertToReservation()),
                      style: FilledButton.styleFrom(backgroundColor: palette.actionStrong),
                      icon: const Icon(Icons.event_available_outlined, size: 16),
                      label: const Text('Convertir a reservación'),
                    ),
                  ],
                ],
              ],
            ),
          ),
        },
      ],
    );
  }
}

enum _AjustesTab { salones, paquetes }

/// Ajustes — Salones/Paquetes admin CRUD, mirroring `_MembershipsAdmin`'s
/// exact list+create+edit shape.
class _FiestasAjustes extends StatefulWidget {
  const _FiestasAjustes({required this.context, required this.partiesGateway});
  final AuthenticatedContext context;
  final PosPartiesGateway partiesGateway;

  @override
  State<_FiestasAjustes> createState() => _FiestasAjustesState();
}

class _FiestasAjustesState extends State<_FiestasAjustes> {
  _AjustesTab _tab = _AjustesTab.salones;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: SegmentedButton<_AjustesTab>(
            key: const Key('pos-fiestas-ajustes-tabs'),
            segments: const [
              ButtonSegment(value: _AjustesTab.salones, label: Text('Salones')),
              ButtonSegment(value: _AjustesTab.paquetes, label: Text('Paquetes')),
            ],
            selected: {_tab},
            onSelectionChanged: (value) => setState(() => _tab = value.first),
          ),
        ),
      ),
      if (_tab == _AjustesTab.salones)
        _RoomsAdmin(context: widget.context, partiesGateway: widget.partiesGateway)
      else
        _PackagesAdmin(context: widget.context, partiesGateway: widget.partiesGateway),
    ],
  );
}

class _RoomsAdmin extends StatefulWidget {
  const _RoomsAdmin({required this.context, required this.partiesGateway});
  final AuthenticatedContext context;
  final PosPartiesGateway partiesGateway;

  @override
  State<_RoomsAdmin> createState() => _RoomsAdminState();
}

class _RoomsAdminState extends State<_RoomsAdmin> {
  _AdminListPhase _phase = _AdminListPhase.loading;
  List<PosPartyRoom> _rooms = const [];
  String? _errorMessage;

  bool get _canRead => widget.context.permissions.contains('party.read');
  bool get _canManage => widget.context.permissions.contains('party.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.partiesGateway.listRooms(limit: 100);
      if (!mounted) return;
      setState(() {
        _rooms = page.items;
        _phase = _rooms.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar los salones.';
      });
    }
  }

  Future<void> _openForm({PosPartyRoom? existing}) async {
    final branchId = existing?.branchId ?? widget.context.session.branchId;
    if (branchId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Esta sesión no tiene una sucursal asignada.')),
      );
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _RoomFormDialog(partiesGateway: widget.partiesGateway, branchId: branchId, existing: existing),
    );
    if (saved == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Salones',
          description: 'Salones de fiestas — capacidad y disponibilidad.',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (_canManage)
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: FilledButton.icon(
                key: const Key('pos-fiestas-room-new'),
                onPressed: () => unawaited(_openForm()),
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Nuevo salón'),
              ),
            ),
          ),
        if (!_canRead)
          const _PermissionState()
        else
          switch (_phase) {
            _AdminListPhase.loading => const _LoadingState(),
            _AdminListPhase.empty => const _EmptyState(message: 'No hay salones registrados.'),
            _AdminListPhase.failure => _FailureState(
              message: _errorMessage ?? 'No fue posible cargar los salones.',
              onRetry: () => unawaited(_load()),
            ),
            _AdminListPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [for (final room in _rooms) _RoomRow(room: room, canManage: _canManage, onEdit: () => unawaited(_openForm(existing: room)))],
            ),
          },
      ],
    );
  }
}

class _RoomRow extends StatelessWidget {
  const _RoomRow({required this.room, required this.canManage, required this.onEdit});
  final PosPartyRoom room;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final capacity = [
      if (room.capacityChildren != null) '${room.capacityChildren} niños',
      if (room.capacityAdults != null) '${room.capacityAdults} adultos',
      if (room.capacityTotal != null) '${room.capacityTotal} total',
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: _PosCard(
        key: Key('pos-fiestas-room-row-${room.id}'),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${room.name} (${room.code})', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  if (capacity.isNotEmpty) Text(capacity, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                ],
              ),
            ),
            _RoomStatusChip(status: room.status),
            if (canManage)
              IconButton(
                key: Key('pos-fiestas-room-edit-${room.id}'),
                tooltip: 'Editar salón',
                onPressed: onEdit,
                icon: Icon(Icons.edit_outlined, size: 18, color: palette.blueDeep),
              ),
          ],
        ),
      ),
    );
  }
}

/// `POST/PATCH /party-rooms/{id}` — note the real PATCH schema only ever
/// accepts `status`/`capacity_*`/`color`/`notes` (never `name`/`code`/
/// `branch_id`, immutable after creation) — the name/code are shown as
/// read-only on edit rather than as a misleadingly-editable field that
/// would silently not apply.
class _RoomFormDialog extends StatefulWidget {
  const _RoomFormDialog({required this.partiesGateway, required this.branchId, this.existing});
  final PosPartiesGateway partiesGateway;
  final String branchId;
  final PosPartyRoom? existing;

  @override
  State<_RoomFormDialog> createState() => _RoomFormDialogState();
}

class _RoomFormDialogState extends State<_RoomFormDialog> {
  late final _codeController = TextEditingController();
  late final _nameController = TextEditingController();
  late final _childrenController = TextEditingController(text: widget.existing?.capacityChildren?.toString() ?? '');
  late final _adultsController = TextEditingController(text: widget.existing?.capacityAdults?.toString() ?? '');
  late final _totalController = TextEditingController(text: widget.existing?.capacityTotal?.toString() ?? '');
  late final _notesController = TextEditingController(text: widget.existing?.notes ?? '');
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _childrenController.dispose();
    _adultsController.dispose();
    _totalController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    int? parseOrNull(String text) => text.trim().isEmpty ? null : int.tryParse(text.trim());
    final notes = _notesController.text.trim();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_isEdit) {
        await widget.partiesGateway.updateRoom(
          widget.existing!.id,
          PosPartyRoomInput(
            status: _status,
            capacityChildren: parseOrNull(_childrenController.text),
            capacityAdults: parseOrNull(_adultsController.text),
            capacityTotal: parseOrNull(_totalController.text),
            notes: notes.isEmpty ? null : notes,
          ),
          version: widget.existing!.version,
        );
      } else {
        final code = _codeController.text.trim();
        final name = _nameController.text.trim();
        if (code.isEmpty || name.isEmpty) {
          setState(() {
            _busy = false;
            _error = 'El código y el nombre son obligatorios.';
          });
          return;
        }
        await widget.partiesGateway.createRoom(
          PosPartyRoomInput(
            branchId: widget.branchId,
            code: code,
            name: name,
            capacityChildren: parseOrNull(_childrenController.text),
            capacityAdults: parseOrNull(_adultsController.text),
            capacityTotal: parseOrNull(_totalController.text),
            notes: notes.isEmpty ? null : notes,
          ),
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar el salón.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 620),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(_isEdit ? 'Editar salón' : 'Nuevo salón', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 14),
                if (_isEdit) ...[
                  Text(
                    '${widget.existing!.code} · ${widget.existing!.name}',
                    style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                ] else ...[
                  TextField(
                    key: const Key('pos-fiestas-room-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    key: const Key('pos-fiestas-room-name'),
                    controller: _nameController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                  ),
                  const SizedBox(height: 10),
                ],
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-room-capacity-children'),
                        controller: _childrenController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Cap. niños'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-room-capacity-adults'),
                        controller: _adultsController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Cap. adultos'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-fiestas-room-capacity-total'),
                  controller: _totalController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(isDense: true, labelText: 'Cap. total'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-fiestas-room-status'),
                    initialValue: _status,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: [for (final status in partyRoomStatuses) DropdownMenuItem(value: status, child: Text(status))],
                    onChanged: (value) => setState(() => _status = value ?? _status),
                  ),
                ],
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-fiestas-room-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-fiestas-room-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-fiestas-room-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PackagesAdmin extends StatefulWidget {
  const _PackagesAdmin({required this.context, required this.partiesGateway});
  final AuthenticatedContext context;
  final PosPartiesGateway partiesGateway;

  @override
  State<_PackagesAdmin> createState() => _PackagesAdminState();
}

class _PackagesAdminState extends State<_PackagesAdmin> {
  _AdminListPhase _phase = _AdminListPhase.loading;
  List<PosPartyPackage> _packages = const [];
  String? _errorMessage;

  bool get _canRead => widget.context.permissions.contains('party.read');
  bool get _canManage => widget.context.permissions.contains('party.manage');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.partiesGateway.listPackages(limit: 100);
      if (!mounted) return;
      setState(() {
        _packages = page.items;
        _phase = _packages.isEmpty ? _AdminListPhase.empty : _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar los paquetes.';
      });
    }
  }

  Future<void> _openForm({PosPartyPackage? existing}) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PackageFormDialog(
        partiesGateway: widget.partiesGateway,
        branchId: existing?.branchId ?? widget.context.session.branchId,
        existing: existing,
      ),
    );
    if (saved == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Paquetes',
          description: 'Paquetes de fiestas — precio, duración e incluye/restricciones.',
          action: _ReadOnlyButton(onPressed: () => unawaited(_load())),
        ),
        if (_canManage)
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: FilledButton.icon(
                key: const Key('pos-fiestas-package-new'),
                onPressed: () => unawaited(_openForm()),
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Nuevo paquete'),
              ),
            ),
          ),
        if (!_canRead)
          const _PermissionState()
        else
          switch (_phase) {
            _AdminListPhase.loading => const _LoadingState(),
            _AdminListPhase.empty => const _EmptyState(message: 'No hay paquetes registrados.'),
            _AdminListPhase.failure => _FailureState(
              message: _errorMessage ?? 'No fue posible cargar los paquetes.',
              onRetry: () => unawaited(_load()),
            ),
            _AdminListPhase.ready => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final pkg in _packages)
                  _PackageRow(package: pkg, canManage: _canManage, onEdit: () => unawaited(_openForm(existing: pkg))),
              ],
            ),
          },
      ],
    );
  }
}

class _PackageRow extends StatelessWidget {
  const _PackageRow({required this.package, required this.canManage, required this.onEdit});
  final PosPartyPackage package;
  final bool canManage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: _PosCard(
        key: Key('pos-fiestas-package-row-${package.id}'),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${package.name} (${package.code})', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  Text(
                    '${_formatPartyMoney(package.price, package.currencyCode)} · ${package.durationMinutes} min · '
                    '${package.childrenIncluded} niños / ${package.adultsIncluded} adultos incluidos',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12),
                  ),
                ],
              ),
            ),
            _StatusChip(label: package.status),
            if (canManage)
              IconButton(
                key: Key('pos-fiestas-package-edit-${package.id}'),
                tooltip: 'Editar paquete',
                onPressed: onEdit,
                icon: Icon(Icons.edit_outlined, size: 18, color: palette.blueDeep),
              ),
          ],
        ),
      ),
    );
  }
}

class _JsonTagRow {
  _JsonTagRow({String key = '', String value = ''})
    : keyController = TextEditingController(text: key),
      valueController = TextEditingController(text: value);
  final TextEditingController keyController;
  final TextEditingController valueController;
  void dispose() {
    keyController.dispose();
    valueController.dispose();
  }
}

/// `POST/PATCH /party-packages` — General (name/code/price/duration/
/// capacity), plus [_includeRows]/[_restrictionRows]: a simple key/value
/// tag editor over the real `includes`/`restrictions` JSON (recovery doc
/// Capability 5), never a raw-JSON textarea.
class _PackageFormDialog extends StatefulWidget {
  const _PackageFormDialog({required this.partiesGateway, required this.branchId, this.existing});
  final PosPartiesGateway partiesGateway;
  final String? branchId;
  final PosPartyPackage? existing;

  @override
  State<_PackageFormDialog> createState() => _PackageFormDialogState();
}

class _PackageFormDialogState extends State<_PackageFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _descriptionController = TextEditingController(text: widget.existing?.description ?? '');
  late final _priceController = TextEditingController(text: widget.existing?.price ?? '');
  late final _durationController = TextEditingController(text: widget.existing?.durationMinutes.toString() ?? '');
  late final _childrenIncludedController = TextEditingController(text: widget.existing?.childrenIncluded.toString() ?? '0');
  late final _adultsIncludedController = TextEditingController(text: widget.existing?.adultsIncluded.toString() ?? '0');
  late final _childExtraController = TextEditingController(text: widget.existing?.childExtraCost ?? '0');
  late final _adultExtraController = TextEditingController(text: widget.existing?.adultExtraCost ?? '0');
  late final _capacityMaxController = TextEditingController(text: widget.existing?.capacityMax?.toString() ?? '');
  late final _extraHalfHourController = TextEditingController(text: widget.existing?.extraHalfHourCost ?? '0');
  late String _status = widget.existing?.status ?? 'active';
  late final List<_JsonTagRow> _includeRows = _rowsFrom(widget.existing?.includes);
  late final List<_JsonTagRow> _restrictionRows = _rowsFrom(widget.existing?.restrictions);
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  static List<_JsonTagRow> _rowsFrom(Map<String, Object?>? map) {
    if (map == null || map.isEmpty) return [_JsonTagRow()];
    return [for (final entry in map.entries) _JsonTagRow(key: entry.key, value: '${entry.value}')];
  }

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _descriptionController.dispose();
    _priceController.dispose();
    _durationController.dispose();
    _childrenIncludedController.dispose();
    _adultsIncludedController.dispose();
    _childExtraController.dispose();
    _adultExtraController.dispose();
    _capacityMaxController.dispose();
    _extraHalfHourController.dispose();
    for (final row in _includeRows) row.dispose();
    for (final row in _restrictionRows) row.dispose();
    super.dispose();
  }

  Map<String, Object?>? _mapFrom(List<_JsonTagRow> rows) {
    final entries = <String, Object?>{};
    for (final row in rows) {
      final key = row.keyController.text.trim();
      if (key.isEmpty) continue;
      entries[key] = row.valueController.text.trim();
    }
    return entries.isEmpty ? null : entries;
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final price = _priceController.text.trim();
    final duration = int.tryParse(_durationController.text.trim());
    if (!_isEdit && _codeController.text.trim().isEmpty) {
      setState(() => _error = 'El código es obligatorio.');
      return;
    }
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    if (price.isEmpty) {
      setState(() => _error = 'El precio es obligatorio.');
      return;
    }
    if (duration == null || duration <= 0) {
      setState(() => _error = 'La duración debe ser un número de minutos mayor a cero.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    int? parseIntOrNull(String text) => text.trim().isEmpty ? null : int.tryParse(text.trim());
    String costOrZero(TextEditingController controller) => controller.text.trim().isEmpty ? '0' : controller.text.trim();
    final description = _descriptionController.text.trim();
    try {
      if (_isEdit) {
        await widget.partiesGateway.updatePackage(
          widget.existing!.id,
          PosPartyPackageInput(
            name: name,
            description: description.isEmpty ? null : description,
            status: _status,
            price: price,
            durationMinutes: duration,
            childrenIncluded: parseIntOrNull(_childrenIncludedController.text) ?? 0,
            adultsIncluded: parseIntOrNull(_adultsIncludedController.text) ?? 0,
            childExtraCost: costOrZero(_childExtraController),
            adultExtraCost: costOrZero(_adultExtraController),
            capacityMax: parseIntOrNull(_capacityMaxController.text),
            extraHalfHourCost: costOrZero(_extraHalfHourController),
            includes: _mapFrom(_includeRows),
            restrictions: _mapFrom(_restrictionRows),
          ),
          version: widget.existing!.version,
        );
      } else {
        await widget.partiesGateway.createPackage(
          PosPartyPackageInput(
            branchId: widget.branchId,
            code: _codeController.text.trim(),
            name: name,
            description: description.isEmpty ? null : description,
            price: price,
            durationMinutes: duration,
            childrenIncluded: parseIntOrNull(_childrenIncludedController.text) ?? 0,
            adultsIncluded: parseIntOrNull(_adultsIncludedController.text) ?? 0,
            childExtraCost: costOrZero(_childExtraController),
            adultExtraCost: costOrZero(_adultExtraController),
            capacityMax: parseIntOrNull(_capacityMaxController.text),
            extraHalfHourCost: costOrZero(_extraHalfHourController),
            includes: _mapFrom(_includeRows),
            restrictions: _mapFrom(_restrictionRows),
          ),
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar el paquete.';
      });
    }
  }

  Widget _tagEditor(String title, List<_JsonTagRow> rows, Key addKey) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700, fontSize: 12)),
        const SizedBox(height: 6),
        for (var i = 0; i < rows.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Expanded(child: TextField(controller: rows[i].keyController, decoration: const InputDecoration(isDense: true, hintText: 'Campo'))),
                const SizedBox(width: 6),
                Expanded(child: TextField(controller: rows[i].valueController, decoration: const InputDecoration(isDense: true, hintText: 'Valor'))),
                IconButton(
                  onPressed: () => setState(() {
                    rows[i].dispose();
                    rows.removeAt(i);
                    if (rows.isEmpty) rows.add(_JsonTagRow());
                  }),
                  icon: const Icon(Icons.remove_circle_outline, size: 18),
                ),
              ],
            ),
          ),
        TextButton.icon(
          key: addKey,
          onPressed: () => setState(() => rows.add(_JsonTagRow())),
          icon: const Icon(Icons.add, size: 16),
          label: const Text('Agregar campo'),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460, maxHeight: 680),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(_isEdit ? 'Editar paquete' : 'Nuevo paquete', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 10),
                Text('General', style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700, fontSize: 12)),
                const SizedBox(height: 8),
                if (!_isEdit) ...[
                  TextField(
                    key: const Key('pos-fiestas-package-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: const Key('pos-fiestas-package-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-fiestas-package-description'),
                  controller: _descriptionController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-price'),
                        controller: _priceController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(isDense: true, labelText: 'Precio'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-duration'),
                        controller: _durationController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Duración (min)'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-children-included'),
                        controller: _childrenIncludedController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Niños incluidos'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-adults-included'),
                        controller: _adultsIncludedController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Adultos incluidos'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-child-extra'),
                        controller: _childExtraController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(isDense: true, labelText: 'Costo niño extra'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-adult-extra'),
                        controller: _adultExtraController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(isDense: true, labelText: 'Costo adulto extra'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-capacity-max'),
                        controller: _capacityMaxController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Capacidad máxima (opcional)'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-package-extra-half-hour'),
                        controller: _extraHalfHourController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(isDense: true, labelText: 'Costo media hora extra'),
                      ),
                    ),
                  ],
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-fiestas-package-status'),
                    initialValue: _status,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: [for (final status in partyPackageStatuses) DropdownMenuItem(value: status, child: Text(status))],
                    onChanged: (value) => setState(() => _status = value ?? _status),
                  ),
                ],
                const SizedBox(height: 16),
                _tagEditor('Incluye', _includeRows, const Key('pos-fiestas-package-includes-add')),
                const SizedBox(height: 16),
                _tagEditor('Restricciones', _restrictionRows, const Key('pos-fiestas-package-restrictions-add')),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-fiestas-package-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-fiestas-package-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Create/Edit reservation — customer (via `_CustomerSelectorDialog`,
/// reused verbatim) or walk-in, room/package dropdowns filtered to the
/// branch/active status, seller from the real `PosReadController.users`
/// (the same real `user.read`-gated "list users" the Usuarios screen
/// itself uses — no bespoke staff-picker gateway needed). A 409
/// `party_conflict` surfaces via [posPartyErrorMessage] honestly, never
/// retried automatically.
class _PartyReservationFormDialog extends StatefulWidget {
  const _PartyReservationFormDialog({
    required this.context,
    required this.controller,
    required this.partiesGateway,
    required this.customersGateway,
    required this.branchId,
    this.existing,
    this.prefillPackageId,
    this.prefillChildren,
    this.prefillAdults,
    this.prefillExtraHalfHours,
  });
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPartiesGateway partiesGateway;
  final PosCustomersGateway customersGateway;
  final String branchId;
  final PosPartyReservation? existing;
  final String? prefillPackageId;
  final int? prefillChildren;
  final int? prefillAdults;
  final int? prefillExtraHalfHours;

  @override
  State<_PartyReservationFormDialog> createState() => _PartyReservationFormDialogState();
}

class _PartyReservationFormDialogState extends State<_PartyReservationFormDialog> {
  bool get _isEdit => widget.existing != null;

  late final _celebrantNameController = TextEditingController(text: widget.existing?.celebrantName ?? '');
  late final _celebrantAgeController = TextEditingController(text: widget.existing?.celebrantAge?.toString() ?? '');
  late final _childrenController = TextEditingController(
    text: widget.existing?.childrenCount.toString() ?? (widget.prefillChildren?.toString() ?? '0'),
  );
  late final _adultsController = TextEditingController(text: widget.prefillAdults?.toString() ?? '0');
  late final _extraHalfHoursController = TextEditingController(text: widget.prefillExtraHalfHours?.toString() ?? '0');
  late final _notesController = TextEditingController(text: widget.existing?.notes ?? '');

  String? _customerId;
  String? _customerDisplayName;
  String? _roomId;
  String? _packageId;
  DateTime? _eventDate;
  TimeOfDay? _startTime;
  TimeOfDay? _endTime;
  String? _sellerUserId;

  _AdminListPhase _loadPhase = _AdminListPhase.loading;
  List<PosPartyRoom> _rooms = const [];
  List<PosPartyPackage> _packages = const [];
  String? _loadError;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _customerId = widget.existing?.customerId;
    _customerDisplayName = widget.existing?.customerDisplayName;
    _roomId = widget.existing?.roomId;
    _packageId = widget.existing?.packageId ?? widget.prefillPackageId;
    final existing = widget.existing;
    if (existing != null) {
      final parts = existing.eventDate.split('-');
      if (parts.length == 3) {
        _eventDate = DateTime(int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]));
      }
      _startTime = _parseTimeOfDay(existing.startTime);
      _endTime = _parseTimeOfDay(existing.endTime);
      _sellerUserId = existing.sellerUserId;
    }
    widget.controller.addListener(_onControllerChanged);
    unawaited(Future.microtask(widget.controller.loadUsers));
    unawaited(_load());
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    _celebrantNameController.dispose();
    _celebrantAgeController.dispose();
    _childrenController.dispose();
    _adultsController.dispose();
    _extraHalfHoursController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _onControllerChanged() {
    if (mounted) setState(() {});
  }

  static TimeOfDay? _parseTimeOfDay(String value) {
    final parts = value.split(':');
    if (parts.length < 2) return null;
    final hour = int.tryParse(parts[0]);
    final minute = int.tryParse(parts[1]);
    if (hour == null || minute == null) return null;
    return TimeOfDay(hour: hour, minute: minute);
  }

  static String _formatTimeOfDay(TimeOfDay time) => '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';

  Future<void> _load() async {
    setState(() {
      _loadPhase = _AdminListPhase.loading;
      _loadError = null;
    });
    try {
      final roomsPage = await widget.partiesGateway.listRooms(branchId: widget.branchId, status: 'active', limit: 100);
      final packagesPage = await widget.partiesGateway.listPackages(status: 'active', limit: 100);
      if (!mounted) return;
      setState(() {
        _rooms = roomsPage.items;
        _packages = packagesPage.items;
        _loadPhase = _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loadPhase = _AdminListPhase.failure;
        _loadError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loadPhase = _AdminListPhase.failure;
        _loadError = 'No fue posible cargar salones y paquetes.';
      });
    }
  }

  Future<void> _pickCustomer() async {
    final selected = await showDialog<_CustomerSelectorResult>(
      context: context,
      builder: (dialogContext) => _CustomerSelectorDialog(customersGateway: widget.customersGateway),
    );
    if (selected == null || !mounted) return;
    setState(() {
      _customerId = selected.id;
      _customerDisplayName = selected.displayName;
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: _eventDate ?? now, firstDate: DateTime(now.year - 1), lastDate: DateTime(now.year + 3));
    if (picked != null) setState(() => _eventDate = picked);
  }

  Future<void> _pickStartTime() async {
    final picked = await showTimePicker(context: context, initialTime: _startTime ?? const TimeOfDay(hour: 12, minute: 0));
    if (picked != null) setState(() => _startTime = picked);
  }

  Future<void> _pickEndTime() async {
    final picked = await showTimePicker(context: context, initialTime: _endTime ?? const TimeOfDay(hour: 14, minute: 0));
    if (picked != null) setState(() => _endTime = picked);
  }

  Future<void> _submit() async {
    final roomId = _roomId;
    final packageId = _packageId;
    final eventDate = _eventDate;
    final startTime = _startTime;
    final endTime = _endTime;
    if (roomId == null || packageId == null || eventDate == null || startTime == null || endTime == null) {
      setState(() => _error = 'Selecciona salón, paquete, fecha y horario.');
      return;
    }
    final children = int.tryParse(_childrenController.text.trim()) ?? 0;
    final adults = int.tryParse(_adultsController.text.trim()) ?? 0;
    final extraHalfHours = int.tryParse(_extraHalfHoursController.text.trim()) ?? 0;
    final celebrantName = _celebrantNameController.text.trim();
    final celebrantAge = int.tryParse(_celebrantAgeController.text.trim());
    final notes = _notesController.text.trim();
    setState(() {
      _busy = true;
      _error = null;
    });
    // `branch_id` is create-only — the reservation PATCH schema never
    // accepts it (`additionalProperties: false`), so it must never be sent
    // on an edit.
    final input = PosPartyReservationInput(
      branchId: _isEdit ? null : widget.branchId,
      customerId: _customerId,
      celebrantName: celebrantName.isEmpty ? null : celebrantName,
      celebrantAge: celebrantAge,
      roomId: roomId,
      packageId: packageId,
      eventDate: _isoDate(eventDate),
      startTime: _formatTimeOfDay(startTime),
      endTime: _formatTimeOfDay(endTime),
      childrenCount: children,
      adultsCount: adults,
      extraHalfHours: extraHalfHours,
      sellerUserId: _sellerUserId,
      notes: notes.isEmpty ? null : notes,
    );
    try {
      if (_isEdit) {
        await widget.partiesGateway.updateReservation(widget.existing!.id, input, version: widget.existing!.version);
      } else {
        await widget.partiesGateway.createReservation(input);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar la reservación.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460, maxHeight: 700),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(_isEdit ? 'Editar reservación' : 'Nueva reservación', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: Text(_customerDisplayName ?? 'Sin cliente (walk-in)', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                    ),
                    TextButton(
                      key: const Key('pos-fiestas-reservation-pick-customer'),
                      onPressed: () => unawaited(_pickCustomer()),
                      child: Text(_customerId == null ? 'Buscar cliente' : 'Cambiar cliente'),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                TextField(
                  key: const Key('pos-fiestas-reservation-celebrant-name'),
                  controller: _celebrantNameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre del festejado (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-fiestas-reservation-celebrant-age'),
                  controller: _celebrantAgeController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(isDense: true, labelText: 'Edad del festejado (opcional)'),
                ),
                const SizedBox(height: 10),
                if (_loadPhase == _AdminListPhase.loading)
                  const Center(child: CircularProgressIndicator())
                else if (_loadPhase == _AdminListPhase.failure)
                  Text(_loadError ?? 'No fue posible cargar salones y paquetes.', style: TextStyle(color: palette.error, fontSize: 12))
                else ...[
                  DropdownButtonFormField<String>(
                    key: const Key('pos-fiestas-reservation-room'),
                    initialValue: _roomId,
                    decoration: const InputDecoration(isDense: true, labelText: 'Salón'),
                    items: [for (final room in _rooms) DropdownMenuItem(value: room.id, child: Text(room.name))],
                    onChanged: (value) => setState(() => _roomId = value),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-fiestas-reservation-package'),
                    initialValue: _packageId,
                    decoration: const InputDecoration(isDense: true, labelText: 'Paquete'),
                    items: [for (final pkg in _packages) DropdownMenuItem(value: pkg.id, child: Text(pkg.name))],
                    onChanged: (value) => setState(() => _packageId = value),
                  ),
                ],
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const Key('pos-fiestas-reservation-date'),
                        onPressed: () => unawaited(_pickDate()),
                        icon: const Icon(Icons.calendar_today_outlined, size: 15),
                        label: Text(_eventDate == null ? 'Fecha' : _isoDate(_eventDate!)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const Key('pos-fiestas-reservation-start-time'),
                        onPressed: () => unawaited(_pickStartTime()),
                        icon: const Icon(Icons.schedule_outlined, size: 15),
                        label: Text(_startTime == null ? 'Inicio' : _formatTimeOfDay(_startTime!)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const Key('pos-fiestas-reservation-end-time'),
                        onPressed: () => unawaited(_pickEndTime()),
                        icon: const Icon(Icons.schedule_outlined, size: 15),
                        label: Text(_endTime == null ? 'Fin' : _formatTimeOfDay(_endTime!)),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-reservation-children'),
                        controller: _childrenController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Niños'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-reservation-adults'),
                        controller: _adultsController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Adultos'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        key: const Key('pos-fiestas-reservation-extra-time'),
                        controller: _extraHalfHoursController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(isDense: true, labelText: 'Medias horas extra'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  key: const Key('pos-fiestas-reservation-seller'),
                  initialValue: _sellerUserId,
                  decoration: const InputDecoration(isDense: true, labelText: 'Vendedor (opcional)'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Sin vendedor asignado')),
                    for (final user in widget.controller.users.items) DropdownMenuItem(value: user.id, child: Text(user.displayName)),
                  ],
                  onChanged: (value) => setState(() => _sellerUserId = value),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-fiestas-reservation-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-fiestas-reservation-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-fiestas-reservation-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A required-reason confirmation, mirroring `_ManualDiscountDialog`'s
/// own focused-dialog shape — pops the reason string, or `null` on
/// "Volver" (never auto-confirms).
class _CancelReservationDialog extends StatefulWidget {
  const _CancelReservationDialog();

  @override
  State<_CancelReservationDialog> createState() => _CancelReservationDialogState();
}

class _CancelReservationDialogState extends State<_CancelReservationDialog> {
  final _reasonController = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Cancelar reservación', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 12),
              TextField(
                key: const Key('pos-fiestas-cancel-reason'),
                controller: _reasonController,
                maxLines: 2,
                decoration: const InputDecoration(isDense: true, labelText: 'Motivo de cancelación'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, key: const Key('pos-fiestas-cancel-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Volver'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-fiestas-cancel-confirm'),
                      onPressed: () {
                        final reason = _reasonController.text.trim();
                        if (reason.isEmpty) {
                          setState(() => _error = 'El motivo es obligatorio.');
                          return;
                        }
                        Navigator.of(context).pop(reason);
                      },
                      style: FilledButton.styleFrom(backgroundColor: palette.error),
                      child: const Text('Cancelar reservación'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A real "Registrar pago" action — looks up the branch's real open cash
/// session (`PosCashGateway.openSessionForBranch`, the same mechanism Caja
/// itself uses); with none open, this shows the same honest
/// `cash_session_required` story rather than a fake success or a made-up
/// session id.
class _RecordPaymentDialog extends StatefulWidget {
  const _RecordPaymentDialog({
    required this.partiesGateway,
    required this.cashGateway,
    required this.reservationId,
    required this.branchId,
  });
  final PosPartiesGateway partiesGateway;
  final PosCashGateway cashGateway;
  final String reservationId;
  final String branchId;

  @override
  State<_RecordPaymentDialog> createState() => _RecordPaymentDialogState();
}

class _RecordPaymentDialogState extends State<_RecordPaymentDialog> {
  final _amountController = TextEditingController();
  String _purpose = 'deposit';
  bool _loadingSession = true;
  PosCashSession? _session;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadSession());
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _loadSession() async {
    setState(() => _loadingSession = true);
    try {
      final session = await widget.cashGateway.openSessionForBranch(widget.branchId);
      if (!mounted) return;
      setState(() {
        _session = session;
        _loadingSession = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _session = null;
        _loadingSession = false;
      });
    }
  }

  Future<void> _submit() async {
    final session = _session;
    if (session == null) return;
    final amount = _amountController.text.trim();
    if (amount.isEmpty) {
      setState(() => _error = 'El monto es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.partiesGateway.recordPayment(widget.reservationId, purpose: _purpose, amount: amount, cashSessionId: session.id);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible registrar el pago.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Registrar pago', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 12),
              if (_loadingSession)
                const Center(child: CircularProgressIndicator())
              else if (_session == null)
                Text(
                  'Abre la caja de esta sucursal para poder registrar pagos.',
                  key: const Key('pos-fiestas-payment-no-session'),
                  style: TextStyle(color: palette.error, fontSize: 12),
                )
              else ...[
                DropdownButtonFormField<String>(
                  key: const Key('pos-fiestas-payment-purpose'),
                  initialValue: _purpose,
                  decoration: const InputDecoration(isDense: true, labelText: 'Tipo de pago'),
                  items: [for (final purpose in partyReservationPaymentPurposes) DropdownMenuItem(value: purpose, child: Text(_paymentPurposeLabel(purpose)))],
                  onChanged: (value) => setState(() => _purpose = value ?? _purpose),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-fiestas-payment-amount'),
                  controller: _amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(isDense: true, labelText: 'Monto'),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, key: const Key('pos-fiestas-payment-error'), style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: const Key('pos-fiestas-payment-save'),
                      onPressed: (_session == null || _busy) ? null : () => unawaited(_submit()),
                      style: FilledButton.styleFrom(backgroundColor: palette.action),
                      child: _busy
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Guardar'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SnacksSection extends StatefulWidget {
  const _SnacksSection({
    required this.reservationId,
    required this.partiesGateway,
    required this.snacks,
    required this.currencyCode,
    required this.canManage,
    required this.onChanged,
  });
  final String reservationId;
  final PosPartiesGateway partiesGateway;
  final List<PosPartySnack> snacks;
  final String currencyCode;
  final bool canManage;
  final VoidCallback onChanged;

  @override
  State<_SnacksSection> createState() => _SnacksSectionState();
}

class _SnacksSectionState extends State<_SnacksSection> {
  bool _adding = false;
  final _nameController = TextEditingController();
  final _priceController = TextEditingController();
  final _quantityController = TextEditingController(text: '1');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    _quantityController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final price = _priceController.text.trim();
    final quantity = _quantityController.text.trim();
    if (name.isEmpty || price.isEmpty || quantity.isEmpty) {
      setState(() => _error = 'Nombre, precio y cantidad son obligatorios.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.partiesGateway.addSnack(widget.reservationId, PosPartySnackInput(nameSnapshot: name, unitPriceSnapshot: price, quantity: quantity));
      if (!mounted) return;
      setState(() {
        _busy = false;
        _adding = false;
        _nameController.clear();
        _priceController.clear();
        _quantityController.text = '1';
      });
      widget.onChanged();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible agregar el snack.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.snacks.isEmpty)
          Text('Sin snacks agregados.', style: TextStyle(color: palette.textSecondary, fontSize: 12))
        else
          for (final snack in widget.snacks)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(child: Text('${snack.nameSnapshot} × ${snack.quantity}', style: TextStyle(color: palette.text, fontSize: 12))),
                  Text(_formatPartyMoney(snack.lineTotal, widget.currencyCode), style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                ],
              ),
            ),
        if (widget.canManage) ...[
          const SizedBox(height: 6),
          if (!_adding)
            TextButton.icon(
              key: const Key('pos-fiestas-snack-add-toggle'),
              onPressed: () => setState(() => _adding = true),
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Agregar snack'),
            )
          else ...[
            TextField(
              key: const Key('pos-fiestas-snack-name'),
              controller: _nameController,
              decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('pos-fiestas-snack-price'),
                    controller: _priceController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(isDense: true, labelText: 'Precio unitario'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    key: const Key('pos-fiestas-snack-quantity'),
                    controller: _quantityController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(isDense: true, labelText: 'Cantidad'),
                  ),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 6),
              Text(_error!, key: const Key('pos-fiestas-snack-error'), style: TextStyle(color: palette.error, fontSize: 12)),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton(onPressed: () => setState(() => _adding = false), child: const Text('Cancelar')),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('pos-fiestas-snack-save'),
                  onPressed: _busy ? null : () => unawaited(_submit()),
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  child: _busy
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Guardar'),
                ),
              ],
            ),
          ],
        ],
      ],
    );
  }
}

class _SocksSection extends StatefulWidget {
  const _SocksSection({
    required this.reservationId,
    required this.partiesGateway,
    required this.socks,
    required this.canManage,
    required this.onChanged,
  });
  final String reservationId;
  final PosPartiesGateway partiesGateway;
  final List<PosPartySock> socks;
  final bool canManage;
  final VoidCallback onChanged;

  @override
  State<_SocksSection> createState() => _SocksSectionState();
}

class _SocksSectionState extends State<_SocksSection> {
  bool _adding = false;
  final _sizeController = TextEditingController();
  final _quantityController = TextEditingController(text: '1');
  final _variantController = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _deductingId;

  @override
  void dispose() {
    _sizeController.dispose();
    _quantityController.dispose();
    _variantController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final size = _sizeController.text.trim();
    final quantity = int.tryParse(_quantityController.text.trim());
    if (size.isEmpty || quantity == null || quantity <= 0) {
      setState(() => _error = 'Talla y cantidad son obligatorias.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final variantId = _variantController.text.trim();
    try {
      await widget.partiesGateway.addSock(widget.reservationId, PosPartySockInput(size: size, quantity: quantity, productVariantId: variantId.isEmpty ? null : variantId));
      if (!mounted) return;
      setState(() {
        _busy = false;
        _adding = false;
        _sizeController.clear();
        _quantityController.text = '1';
        _variantController.clear();
      });
      widget.onChanged();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible agregar la calceta.';
      });
    }
  }

  Future<void> _deduct(PosPartySock sock) async {
    setState(() => _deductingId = sock.id);
    try {
      await widget.partiesGateway.deductSock(widget.reservationId, sock.id);
      if (!mounted) return;
      setState(() => _deductingId = null);
      widget.onChanged();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _deductingId = null);
      _showNotice(context, posPartyErrorMessage(error));
    } on Object {
      if (!mounted) return;
      setState(() => _deductingId = null);
      _showNotice(context, 'No fue posible descontar el inventario.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.socks.isEmpty)
          Text('Sin calcetas agregadas.', style: TextStyle(color: palette.textSecondary, fontSize: 12))
        else
          for (final sock in widget.socks)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(child: Text('Talla ${sock.size} × ${sock.quantity}', style: TextStyle(color: palette.text, fontSize: 12))),
                  Text(
                    switch (sock.stockDeducted) {
                      'deducted' => 'Descontado',
                      'not_applicable' => 'No aplica',
                      _ => 'Pendiente',
                    },
                    style: TextStyle(color: palette.textSecondary, fontSize: 11),
                  ),
                  if (widget.canManage && sock.canDeduct) ...[
                    const SizedBox(width: 8),
                    TextButton(
                      key: Key('pos-fiestas-sock-deduct-${sock.id}'),
                      onPressed: _deductingId == sock.id ? null : () => unawaited(_deduct(sock)),
                      child: _deductingId == sock.id
                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Descontar stock'),
                    ),
                  ],
                ],
              ),
            ),
        if (widget.canManage) ...[
          const SizedBox(height: 6),
          if (!_adding)
            TextButton.icon(
              key: const Key('pos-fiestas-sock-add-toggle'),
              onPressed: () => setState(() => _adding = true),
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Agregar calceta'),
            )
          else ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('pos-fiestas-sock-size'),
                    controller: _sizeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Talla'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    key: const Key('pos-fiestas-sock-quantity'),
                    controller: _quantityController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(isDense: true, labelText: 'Cantidad'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            TextField(
              key: const Key('pos-fiestas-sock-variant'),
              controller: _variantController,
              decoration: const InputDecoration(isDense: true, labelText: 'ID de variante de inventario (opcional)'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 6),
              Text(_error!, key: const Key('pos-fiestas-sock-error'), style: TextStyle(color: palette.error, fontSize: 12)),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton(onPressed: () => setState(() => _adding = false), child: const Text('Cancelar')),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('pos-fiestas-sock-save'),
                  onPressed: _busy ? null : () => unawaited(_submit()),
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  child: _busy
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Guardar'),
                ),
              ],
            ),
          ],
        ],
      ],
    );
  }
}

class _DocumentsSection extends StatelessWidget {
  const _DocumentsSection({required this.busy, required this.error, required this.onGenerate});
  final bool busy;
  final String? error;
  final void Function(String type) onGenerate;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('pos-fiestas-doc-contract'),
                onPressed: busy ? null : () => onGenerate('contract'),
                icon: const Icon(Icons.description_outlined, size: 16),
                label: const Text('Generar Contrato'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('pos-fiestas-doc-waiver'),
                onPressed: busy ? null : () => onGenerate('waiver'),
                icon: const Icon(Icons.gavel_outlined, size: 16),
                label: const Text('Generar Deslinde'),
              ),
            ),
          ],
        ),
        if (busy) ...[const SizedBox(height: 8), const Center(child: CircularProgressIndicator())],
        if (error != null) ...[
          const SizedBox(height: 8),
          Text(error!, key: const Key('pos-fiestas-doc-error'), style: TextStyle(color: palette.error, fontSize: 12)),
        ],
      ],
    );
  }
}

enum _PartyDetailTab { snacks, socks, documents }

/// Reservation Detail — status transition restricted to
/// `partyReservationTransitions`'s real allowed edges (never an invalid
/// jump), financial section backed by the real balance endpoint, Cancel
/// gated on `party.cancel` and never hiding a `hasPriorPayments: true`
/// response.
class _PartyReservationDetailDialog extends StatefulWidget {
  const _PartyReservationDetailDialog({
    required this.reservationId,
    required this.context,
    required this.controller,
    required this.partiesGateway,
    required this.customersGateway,
    required this.cashGateway,
  });
  final String reservationId;
  final AuthenticatedContext context;
  final PosReadController controller;
  final PosPartiesGateway partiesGateway;
  final PosCustomersGateway customersGateway;
  final PosCashGateway cashGateway;

  @override
  State<_PartyReservationDetailDialog> createState() => _PartyReservationDetailDialogState();
}

class _PartyReservationDetailDialogState extends State<_PartyReservationDetailDialog> {
  _AdminListPhase _phase = _AdminListPhase.loading;
  PosPartyReservationDetail? _detail;
  PosPartyBalance? _balance;
  PosPartyRoom? _room;
  PosPartyPackage? _package;
  String? _errorMessage;
  bool _changed = false;
  _PartyDetailTab _tab = _PartyDetailTab.snacks;
  bool _statusBusy = false;
  String? _statusError;
  String? _pendingStatus;
  bool _cancelled = false;
  bool? _cancelHasPriorPayments;
  String? _cancelTotalPaid;
  String? _docError;
  bool _docBusy = false;

  bool get _canManage => widget.context.permissions.contains('party.manage');
  bool get _canCancel => widget.context.permissions.contains('party.cancel');
  bool get _canRecordPayment => widget.context.permissions.contains('party.payment.record');

  @override
  void initState() {
    super.initState();
    unawaited(Future.microtask(widget.controller.loadUsers));
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _phase = _AdminListPhase.loading;
      _errorMessage = null;
    });
    try {
      final detail = await widget.partiesGateway.reservationDetail(widget.reservationId);
      final balance = await widget.partiesGateway.balance(widget.reservationId);
      PosPartyRoom? room;
      PosPartyPackage? package;
      try {
        room = await widget.partiesGateway.room(detail.reservation.roomId);
      } on Object {
        room = null;
      }
      try {
        package = await widget.partiesGateway.packageRow(detail.reservation.packageId);
      } on Object {
        package = null;
      }
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _balance = balance;
        _room = room;
        _package = package;
        _pendingStatus = null;
        _phase = _AdminListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _AdminListPhase.failure;
        _errorMessage = 'No fue posible cargar la reservación.';
      });
    }
  }

  PosPartyReservationDetail _withReservation(PosPartyReservationDetail detail, PosPartyReservation reservation) => PosPartyReservationDetail(
    reservation: reservation,
    snacks: detail.snacks,
    socks: detail.socks,
    paymentsTotalPaid: detail.paymentsTotalPaid,
    paymentsCount: detail.paymentsCount,
    documentsCount: detail.documentsCount,
    documentsLastGeneratedAt: detail.documentsLastGeneratedAt,
    documentsLastDocumentType: detail.documentsLastDocumentType,
  );

  Future<void> _changeStatus() async {
    final detail = _detail;
    final newStatus = _pendingStatus;
    if (detail == null || newStatus == null) return;
    setState(() {
      _statusBusy = true;
      _statusError = null;
    });
    try {
      final updated = await widget.partiesGateway.transitionStatus(widget.reservationId, newStatus, version: detail.reservation.version);
      if (!mounted) return;
      _changed = true;
      setState(() {
        _detail = _withReservation(detail, updated);
        _pendingStatus = null;
        _statusBusy = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _statusBusy = false;
        _statusError = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _statusBusy = false;
        _statusError = 'No fue posible cambiar el estado.';
      });
    }
  }

  Future<void> _cancel() async {
    final detail = _detail;
    if (detail == null) return;
    final reason = await showDialog<String>(context: context, builder: (dialogContext) => const _CancelReservationDialog());
    if (reason == null || !mounted) return;
    try {
      final result = await widget.partiesGateway.cancelReservation(widget.reservationId, reasonCode: reason, version: detail.reservation.version);
      if (!mounted) return;
      _changed = true;
      setState(() {
        _detail = _withReservation(detail, result.reservation);
        _cancelled = true;
        _cancelHasPriorPayments = result.hasPriorPayments;
        _cancelTotalPaid = result.totalPaid;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      _showNotice(context, posPartyErrorMessage(error));
    } on Object {
      if (!mounted) return;
      _showNotice(context, 'No fue posible cancelar la reservación.');
    }
  }

  Future<void> _editReservation() async {
    final detail = _detail;
    if (detail == null) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PartyReservationFormDialog(
        context: widget.context,
        controller: widget.controller,
        partiesGateway: widget.partiesGateway,
        customersGateway: widget.customersGateway,
        branchId: detail.reservation.branchId,
        existing: detail.reservation,
      ),
    );
    if (saved == true && mounted) {
      _changed = true;
      unawaited(_load());
    }
  }

  Future<void> _recordPayment() async {
    final branchId = _detail?.reservation.branchId;
    if (branchId == null) return;
    final recorded = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _RecordPaymentDialog(
        partiesGateway: widget.partiesGateway,
        cashGateway: widget.cashGateway,
        reservationId: widget.reservationId,
        branchId: branchId,
      ),
    );
    if (recorded == true && mounted) {
      _changed = true;
      unawaited(_load());
    }
  }

  Future<void> _generateDocument(String type) async {
    setState(() {
      _docBusy = true;
      _docError = null;
    });
    try {
      final html = await widget.partiesGateway.generateDocument(widget.reservationId, type);
      if (!mounted) return;
      final opened = openReceiptPrintWindow(html);
      setState(() {
        _docBusy = false;
        _docError = opened ? null : 'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para ver el documento.';
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _docBusy = false;
        _docError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _docBusy = false;
        _docError = 'No fue posible generar el documento.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 760),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text('Reservación', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16))),
                  IconButton(
                    key: const Key('pos-fiestas-detail-close'),
                    onPressed: () => Navigator.of(context).pop(_changed),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              Flexible(
                child: SingleChildScrollView(
                  child: switch (_phase) {
                    _AdminListPhase.loading => const _LoadingState(),
                    _AdminListPhase.empty => const _EmptyState(message: 'No hay información de esta reservación.'),
                    _AdminListPhase.failure => _FailureState(
                      message: _errorMessage ?? 'No fue posible cargar la reservación.',
                      onRetry: () => unawaited(_load()),
                    ),
                    _AdminListPhase.ready => _buildReady(palette),
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildReady(PosPalette palette) {
    final detail = _detail!;
    final reservation = detail.reservation;
    final allowedNext = partyReservationTransitions[reservation.status] ?? const <String>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    reservation.celebrantName?.isNotEmpty == true
                        ? reservation.celebrantName!
                        : (reservation.customerDisplayName ?? 'Sin festejado'),
                    style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 15),
                  ),
                  const SizedBox(height: 2),
                  Text('Folio ${reservation.reservationNumber}', style: TextStyle(color: palette.textMuted, fontSize: 11)),
                ],
              ),
            ),
            if (_canManage)
              TextButton.icon(
                key: const Key('pos-fiestas-detail-edit'),
                onPressed: () => unawaited(_editReservation()),
                icon: const Icon(Icons.edit_outlined, size: 16),
                label: const Text('Editar'),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 12,
          runSpacing: 4,
          children: [
            Text('${reservation.eventDate} · ${_hhmm(reservation.startTime)}-${_hhmm(reservation.endTime)}', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
            Text(_room?.name ?? 'Salón', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
            Text(_package?.name ?? 'Paquete', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
            Text('${reservation.childrenCount} niños', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
          ],
        ),
        if (reservation.customerDisplayName != null) ...[
          const SizedBox(height: 4),
          Text('Cliente: ${reservation.customerDisplayName}', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
        ],
        const SizedBox(height: 10),
        Row(
          children: [
            _PartyStatusChip(status: reservation.status),
            const Spacer(),
            if (_canManage && allowedNext.isNotEmpty) ...[
              SizedBox(
                width: 180,
                child: DropdownButtonFormField<String>(
                  key: const Key('pos-fiestas-detail-status-select'),
                  initialValue: _pendingStatus,
                  decoration: const InputDecoration(isDense: true, labelText: 'Cambiar a'),
                  items: [for (final status in allowedNext) DropdownMenuItem(value: status, child: Text(_partyStatusLabel(status)))],
                  onChanged: (value) => setState(() => _pendingStatus = value),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                key: const Key('pos-fiestas-detail-status-submit'),
                onPressed: (_pendingStatus == null || _statusBusy) ? null : () => unawaited(_changeStatus()),
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                child: _statusBusy
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Aplicar'),
              ),
            ],
          ],
        ),
        if (_statusError != null) ...[
          const SizedBox(height: 6),
          Text(_statusError!, key: const Key('pos-fiestas-detail-status-error'), style: TextStyle(color: palette.error, fontSize: 12)),
        ],
        const SizedBox(height: 14),
        Divider(color: palette.border),
        const SizedBox(height: 10),
        Text('Finanzas', style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w700, fontSize: 12)),
        const SizedBox(height: 6),
        if (_balance != null) ...[
          _QuoteLine(label: 'Total cotizado', amount: _balance!.quotedTotal, currency: reservation.currencyCode),
          _QuoteLine(label: 'Pagado', amount: _balance!.totalPaid, currency: reservation.currencyCode),
          _QuoteLine(label: 'Saldo pendiente', amount: _balance!.outstandingBalance, currency: reservation.currencyCode, emphasize: true),
        ],
        if (_canRecordPayment) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('pos-fiestas-detail-record-payment'),
              onPressed: () => unawaited(_recordPayment()),
              icon: const Icon(Icons.payments_outlined, size: 16),
              label: const Text('Registrar pago'),
            ),
          ),
        ],
        if (_cancelled) ...[
          const SizedBox(height: 10),
          Container(
            key: const Key('pos-fiestas-detail-cancel-banner'),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: palette.error.withValues(alpha: .08), borderRadius: BorderRadius.circular(10)),
            child: Text(
              _cancelHasPriorPayments == true
                  ? 'Reservación cancelada. Tenía pagos previos por ${_formatPartyMoney(_cancelTotalPaid ?? '0', reservation.currencyCode)} — '
                        'el reembolso debe gestionarse por separado.'
                  : 'Reservación cancelada.',
              style: TextStyle(color: palette.error, fontSize: 12),
            ),
          ),
        ],
        const SizedBox(height: 14),
        Divider(color: palette.border),
        const SizedBox(height: 10),
        SegmentedButton<_PartyDetailTab>(
          key: const Key('pos-fiestas-detail-tabs'),
          segments: const [
            ButtonSegment(value: _PartyDetailTab.snacks, label: Text('Snacks')),
            ButtonSegment(value: _PartyDetailTab.socks, label: Text('Calcetas')),
            ButtonSegment(value: _PartyDetailTab.documents, label: Text('Documentos')),
          ],
          selected: {_tab},
          onSelectionChanged: (value) => setState(() => _tab = value.first),
        ),
        const SizedBox(height: 10),
        switch (_tab) {
          _PartyDetailTab.snacks => _SnacksSection(
            reservationId: widget.reservationId,
            partiesGateway: widget.partiesGateway,
            snacks: detail.snacks,
            currencyCode: reservation.currencyCode,
            canManage: _canManage,
            onChanged: () => unawaited(_load()),
          ),
          _PartyDetailTab.socks => _SocksSection(
            reservationId: widget.reservationId,
            partiesGateway: widget.partiesGateway,
            socks: detail.socks,
            canManage: _canManage,
            onChanged: () => unawaited(_load()),
          ),
          _PartyDetailTab.documents => _DocumentsSection(busy: _docBusy, error: _docError, onGenerate: _generateDocument),
        },
        if (_canCancel && reservation.status != 'cancelled' && reservation.status != 'completed') ...[
          const SizedBox(height: 14),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('pos-fiestas-detail-cancel'),
              onPressed: () => unawaited(_cancel()),
              style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
              icon: const Icon(Icons.cancel_outlined, size: 16),
              label: const Text('Cancelar reservación'),
            ),
          ),
        ],
      ],
    );
  }
}
