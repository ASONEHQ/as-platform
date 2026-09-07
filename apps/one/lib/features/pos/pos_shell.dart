import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/networking/api_client.dart';
import '../../design_system/tokens/as_tokens.dart';
import '../authentication/auth_models.dart';
import '../authentication/startup_visuals.dart';
import 'money.dart';
import 'pos_cash_gateway.dart';
import 'pos_customers_gateway.dart';
import 'pos_loyalty_gateway.dart';
import 'pos_memberships_gateway.dart';
import 'pos_models.dart';
import 'pos_navigation.dart';
import 'pos_payments_gateway.dart';
import 'pos_promotions_gateway.dart';
import 'pos_read_controller.dart';
import 'pos_receipt.dart';
import 'pos_refunds_gateway.dart';
import 'pos_rewards_gateway.dart';
import 'pos_sales_gateway.dart';
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
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      icon: Icon(icon, size: 18),
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
Future<void> _submitSaleForPayment(
  BuildContext context, {
  required SaleSession saleSession,
  required PosSalesGateway salesGateway,
  required PosPaymentsGateway paymentsGateway,
  required String? branchId,
  required ValueChanged<String?> onStatusUpdate,
}) async {
  if (saleSession.isEmpty) {
    _showNotice(context, 'Agrega al menos un producto al ticket.');
    return;
  }
  if (branchId == null) {
    _showNotice(context, 'Esta sesión no tiene una sucursal asignada.');
    return;
  }
  try {
    final sale = await salesGateway.createSale(
      branchId: branchId,
      items: [
        for (final line in saleSession.lines)
          PosSaleLineRequest(
            productId: line.productId,
            quantity: line.quantity.toString(),
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
}) async {
  if (saleSession.isEmpty) {
    _showNotice(context, 'Agrega al menos un producto al ticket.');
    return;
  }
  if (branchId == null) {
    _showNotice(context, 'Esta sesión no tiene una sucursal asignada.');
    return;
  }
  final PosSaleCreated sale;
  try {
    sale = await salesGateway.createSale(
      branchId: branchId,
      items: [
        for (final line in saleSession.lines)
          PosSaleLineRequest(
            productId: line.productId,
            quantity: line.quantity.toString(),
          ),
      ],
      // TASK 12.9: same rationale as `_submitSaleForPayment` above.
      couponCodes: saleSession.couponCodes,
      manualDiscount: saleSession.manualDiscount,
      // TASK 13.0: same rationale as `_submitSaleForPayment` above.
      customerId: saleSession.customerId,
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
  saleSession.clearAll();
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
        child: module == PosModule.pos
            ? Padding(
                padding: padding,
                // POS branch-context fix: "Todas las sucursales" stays a
                // valid consolidated view for dashboards/reports, but a
                // real Sale must always belong to one concrete
                // authorized branch — this is the entry gate, checked
                // before the cashier can build a ticket at all, not just
                // at Cobrar (the backend/checkout guard in
                // `_submitCashSaleForPayment`/`_submitSaleForPayment`
                // stays in place unchanged as defense in depth).
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
                        onEnterCliente: onEnterCliente,
                      ),
              )
            : SingleChildScrollView(
                padding: padding,
                child: switch (module) {
                  PosModule.dashboard => _Dashboard(context: this.context),
                  PosModule.products => _Products(
                    state: controller.products,
                    allowed: this.context.permissions.contains('catalog.read'),
                    onRefresh: () => controller.loadProducts(refresh: true),
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

class _Dashboard extends StatelessWidget {
  const _Dashboard({required this.context});
  final AuthenticatedContext context;

  @override
  Widget build(BuildContext context) {
    final company = this.context.currentCompany;
    final branch = this.context.currentBranch;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: 'Dashboard',
          description:
              'Contexto operativo real de la sesión. Sin métricas simuladas.',
          action: const _VisualDialogButton(),
        ),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 1100
                ? 3
                : constraints.maxWidth >= 620
                ? 2
                : 1;
            return GridView.count(
              crossAxisCount: columns,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: columns == 1 ? 2.6 : 1.8,
              children: [
                _ContextCard(
                  icon: Icons.apartment_outlined,
                  label: 'Empresa actual',
                  value: company?.name ?? 'Sin empresa seleccionada',
                ),
                _ContextCard(
                  icon: Icons.store_outlined,
                  label: 'Sucursal actual',
                  value: branch?.name ?? 'Acceso corporativo',
                ),
                _ContextCard(
                  icon: Icons.person_outline,
                  label: 'Usuario',
                  value: this.context.user.displayName,
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 18),
        _Directory(
          title: 'Compañías autorizadas',
          children: this.context.companies
              .map((item) => '${item.name}${item.current ? ' · Actual' : ''}')
              .toList(),
        ),
        const SizedBox(height: 12),
        _Directory(
          title: 'Sucursales autorizadas',
          children: this.context.branches
              .map(
                (item) =>
                    '${item.code} · ${item.name}${item.current ? ' · Actual' : ''}',
              )
              .toList(),
        ),
      ],
    );
  }
}

class _ContextCard extends StatelessWidget {
  const _ContextCard({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: palette.blueDeep),
          const SizedBox(height: 10),
          Text(
            label,
            style: TextStyle(color: palette.textSecondary, fontSize: 11),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: palette.text,
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _Directory extends StatelessWidget {
  const _Directory({required this.title, required this.children});
  final String title;
  final List<String> children;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 9),
          if (children.isEmpty)
            Text(
              'Sin registros autorizados.',
              style: TextStyle(color: palette.textMuted),
            )
          else
            for (final value in children)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Icon(
                      Icons.check_circle_outline,
                      size: 17,
                      color: palette.success,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        value,
                        style: TextStyle(color: palette.textSecondary),
                      ),
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
    required this.onEnterCliente,
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
  final VoidCallback onEnterCliente;

  @override
  State<_PosSale> createState() => _PosSaleState();
}

class _PosSaleState extends State<_PosSale> {
  String? selectedCategoryId;
  String query = '';
  final searchFocusNode = FocusNode(debugLabel: 'pos-sale-search');

  @override
  void dispose() {
    searchFocusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final allowed = widget.context.permissions.contains('catalog.read');
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is KeyDownEvent &&
            event.logicalKey == LogicalKeyboardKey.f2) {
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
                    branchId: widget.context.session.branchId,
                    permissions: widget.context.permissions,
                    selectedCategoryId: selectedCategoryId,
                    onSelectCategory: (id) =>
                        setState(() => selectedCategoryId = id),
                    query: query,
                    onQueryChanged: (value) => setState(() => query = value),
                    searchFocusNode: searchFocusNode,
                    onEnterCliente: widget.onEnterCliente,
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
    required this.branchId,
    required this.permissions,
    required this.selectedCategoryId,
    required this.onSelectCategory,
    required this.query,
    required this.onQueryChanged,
    required this.searchFocusNode,
    required this.onEnterCliente,
  });

  final PosReadController controller;
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
  final PosPromotionsGateway promotionsGateway;
  final PosCustomersGateway customersGateway;
  final PosRewardsGateway rewardsGateway;
  final String? branchId;
  final List<String> permissions;
  final String? selectedCategoryId;
  final ValueChanged<String?> onSelectCategory;
  final String query;
  final ValueChanged<String> onQueryChanged;
  final FocusNode searchFocusNode;
  final VoidCallback onEnterCliente;

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
        _PosModeSwitch(onEnterCliente: onEnterCliente),
        const SizedBox(height: 8),
        _PosSearchRow(focusNode: searchFocusNode, onChanged: onQueryChanged),
        const SizedBox(height: 8),
        _CategoryStrip(
          state: controller.categories,
          selected: selectedCategoryId,
          onSelected: onSelectCategory,
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
              items: _filter(items, selectedCategoryId, query),
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
      branchId: branchId,
      permissions: permissions,
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
    String query,
  ) {
    final normalized = query.trim().toLowerCase();
    return items
        .where((item) {
          final matchesCategory =
              categoryId == null || item.categoryId == categoryId;
          final matchesQuery =
              normalized.isEmpty ||
              '${item.code} ${item.name}'.toLowerCase().contains(normalized);
          return matchesCategory && matchesQuery;
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

/// Matches `#pos-toolbar-row`: the search input (with a barcode-scan
/// affordance) plus four circular actions (link customer, reprint,
/// suspend, cancel). The search field stays fully functional; the actions
/// are visually faithful, disabled placeholders — none of suspend, cancel,
/// reprint, or customer linking exist as capabilities in this shell.
class _PosSearchRow extends StatelessWidget {
  const _PosSearchRow({required this.focusNode, required this.onChanged});
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Row(
      children: [
        Expanded(
          child: TextField(
            key: const Key('pos-sale-search'),
            focusNode: focusNode,
            onChanged: onChanged,
            decoration: InputDecoration(
              hintText: 'Escanear código o buscar por nombre... (F2)',
              prefixIcon: const Icon(Icons.search),
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
          tooltip: 'Vincular cliente (F3)',
          icon: Icons.person_outline,
          onPressed: () => _showReadOnlyNotice(context),
        ),
        const SizedBox(width: 6),
        _RoundAction(
          tooltip: 'Reimprimir ticket (F4)',
          icon: Icons.print_outlined,
          onPressed: () => _showReadOnlyNotice(context),
        ),
        const SizedBox(width: 6),
        _RoundAction(
          tooltip: 'Suspender venta (F5)',
          icon: Icons.pause_circle_outline,
          color: palette.warning,
          onPressed: () => _showReadOnlyNotice(context),
        ),
        const SizedBox(width: 6),
        _RoundAction(
          tooltip: 'Cancelar venta (F6)',
          icon: Icons.close,
          color: palette.error,
          onPressed: () => _showReadOnlyNotice(context),
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
  });
  final PosReadState<PosCategory> state;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    final active = state.items
        .where((category) => category.status == 'active')
        .toList(growable: false);
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
    super.key,
  });
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // The canonical `.cat` chip is always blue-tinted — border, fill, and
    // label — not neutral until selected; only the fill solidifies on
    // selection (`.cat.active{background:var(--blue)}`).
    return ChoiceChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: selected ? Colors.white : palette.blueDeep,
          ),
          const SizedBox(width: 5),
          Text(label),
        ],
      ),
      selected: selected,
      onSelected: (_) => onSelected(),
      showCheckmark: false,
      labelStyle: TextStyle(
        color: selected ? Colors.white : palette.blueDeep,
        fontWeight: FontWeight.w700,
        fontSize: 12,
      ),
      backgroundColor: palette.blueTint,
      selectedColor: palette.blue,
      side: BorderSide(color: palette.blue),
      padding: const EdgeInsets.symmetric(horizontal: 6),
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
              onTap: block == null
                  ? () => saleSession.addProduct(item, balances)
                  : () => _showNotice(context, _addabilityMessage(block)),
            );
          },
        );
      },
    );
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
    required this.branchId,
    required this.permissions,
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
  final String? branchId;
  final List<String> permissions;

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
                    tooltip: 'Nota de venta',
                    icon: Icons.notes_outlined,
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
              branchId: branchId,
              permissions: permissions,
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
  const _TicketHeaderAction({required this.tooltip, required this.icon});
  final String tooltip;
  final IconData icon;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: tooltip,
    onPressed: () => _showReadOnlyNotice(context),
    icon: Icon(icon, size: 16, color: Colors.white),
    padding: const EdgeInsets.all(4),
    constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
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
    required this.branchId,
    required this.permissions,
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
  final String? branchId;
  final List<String> permissions;

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
    final lines = saleSession.lines.map((line) => '${line.productId}:${line.quantity}').join(',');
    final coupons = saleSession.couponCodes.join(',');
    final manual = saleSession.manualDiscount?.toJson().toString() ?? '';
    return '$lines|$coupons|$manual|${widget.branchId}';
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
      ),
    );
    if (redeemed == true) unawaited(_loadRewards());
  }

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
            PosPricingQuoteItem(productId: line.productId, quantity: line.quantity.toString()),
        ],
        couponCodes: saleSession.couponCodes,
        manualDiscount: saleSession.manualDiscount,
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
            PosPricingQuoteItem(productId: line.productId, quantity: line.quantity.toString()),
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

  // TASK 13.0: "Buscar cliente" — a small inline action in the cart/
  // ticket area, mirroring the coupon UX pattern exactly (ADR-0017 Part
  // H). Attaching a customer is never required and never blocks checkout
  // speed — "Venta sin cliente" stays the default/fast path.
  Future<void> _openCustomerSelector() async {
    final selected = await showDialog<_CustomerSelectorResult>(
      context: context,
      builder: (dialogContext) => _CustomerSelectorDialog(customersGateway: widget.customersGateway),
    );
    if (selected == null || !mounted) return;
    widget.saleSession.setCustomer(customerId: selected.id, displayName: selected.displayName);
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
              onSelect: () => unawaited(_openCustomerSelector()),
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
            saleSession: saleSession,
            salesGateway: widget.salesGateway,
            paymentsGateway: widget.paymentsGateway,
            cashGateway: widget.cashGateway,
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
            PosPricingQuoteItem(productId: line.productId, quantity: line.quantity.toString()),
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
    required this.saleSession,
    required this.salesGateway,
    required this.paymentsGateway,
    required this.cashGateway,
    required this.branchId,
    required this.selectedMethod,
  });
  final SaleSession saleSession;
  final PosSalesGateway salesGateway;
  final PosPaymentsGateway paymentsGateway;
  final PosCashGateway cashGateway;
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
                  '${line.sku} · ${_money(line.unitPrice)}/u',
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
/// a plus button.
class _QtyStepper extends StatelessWidget {
  const _QtyStepper({required this.line, required this.saleSession});
  final SaleLine line;
  final SaleSession saleSession;

  @override
  Widget build(BuildContext context) => Row(
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
  });
  final PosReadState<PosInventoryBalance> state;
  final bool allowed;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _SectionHeader(
        title: 'Inventario',
        description:
            'Balances autorizados. Ningún control modifica existencias.',
        action: _ReadOnlyButton(onPressed: onRefresh),
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
          _phase = _CajaPhase.closed;
        });
        return;
      }
      final summary = await widget.cashGateway.summary(session.id);
      final movementsPage = await widget.cashGateway.listMovements(session.id);
      if (!mounted) return;
      setState(() {
        _session = session;
        _summary = summary;
        _movements = movementsPage.items;
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
          onCashIn: () => unawaited(_postMovement('cash_in')),
          onCashOut: () => unawaited(_postMovement('cash_out')),
          onClose: _closeRegister,
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
    required this.onCashIn,
    required this.onCashOut,
    required this.onClose,
    required this.onRefresh,
  });

  final AuthenticatedContext context;
  final PosCashRegister register;
  final PosCashSession session;
  final PosCashSessionSummary summary;
  final List<PosCashMovement> movements;
  final VoidCallback onCashIn;
  final VoidCallback onCashOut;
  final VoidCallback onClose;
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
                  _movementTypeLabels[movement.movementType] ??
                      movement.movementType,
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
  bool _busy = false;
  String? _error;

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
class _TicketRewardsDialog extends StatefulWidget {
  const _TicketRewardsDialog({
    required this.rewardsGateway,
    required this.entitlements,
    required this.canRedeem,
    required this.branchId,
  });
  final PosRewardsGateway rewardsGateway;
  final List<PosRewardEntitlement> entitlements;
  final bool canRedeem;
  final String? branchId;

  @override
  State<_TicketRewardsDialog> createState() => _TicketRewardsDialogState();
}

class _TicketRewardsDialogState extends State<_TicketRewardsDialog> {
  late List<PosRewardEntitlement> _entitlements = widget.entitlements;
  String? _busyId;
  String? _error;
  bool _anyRedeemed = false;

  Future<void> _redeem(PosRewardEntitlement entitlement) async {
    setState(() {
      _busyId = entitlement.id;
      _error = null;
    });
    try {
      final updated = await widget.rewardsGateway.redeem(entitlement.id, branchId: widget.branchId);
      if (!mounted) return;
      setState(() {
        _entitlements = [
          for (final item in _entitlements) if (item.id == updated.id) updated else item,
        ];
        _busyId = null;
        _anyRedeemed = true;
      });
      _showNotice(context, 'Recompensa canjeada.');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busyId = null;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busyId = null;
        _error = 'No fue posible canjear la recompensa.';
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
                              if (entitlement.isAvailable && widget.canRedeem) ...[
                                const SizedBox(width: 8),
                                _busyId == entitlement.id
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
