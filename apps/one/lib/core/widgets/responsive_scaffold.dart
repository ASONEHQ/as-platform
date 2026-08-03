import 'package:flutter/material.dart';

import '../../design_system/components/as_components.dart';
import '../../design_system/tokens/as_tokens.dart';
import '../../features/authentication/auth_models.dart';

class AsResponsiveScaffold extends StatelessWidget {
  const AsResponsiveScaffold({
    required this.title,
    required this.child,
    required this.contextLabel,
    required this.userLabel,
    required this.companies,
    required this.branches,
    required this.companyWideAccess,
    required this.onCompanySelected,
    required this.onBranchSelected,
    required this.onLogout,
    super.key,
  });

  final String title;
  final Widget child;
  final String contextLabel;
  final String userLabel;
  final List<CompanySummary> companies;
  final List<BranchSummary> branches;
  final bool companyWideAccess;
  final ValueChanged<String> onCompanySelected;
  final ValueChanged<String?> onBranchSelected;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final desktop = constraints.maxWidth >= AsBreakpoints.desktop;
      final tablet = constraints.maxWidth >= AsBreakpoints.tablet;
      final navigation = _Navigation(compact: !desktop);
      return Scaffold(
        drawer: tablet ? null : const Drawer(child: _Navigation()),
        body: Row(
          children: [
            if (tablet) navigation,
            Expanded(
              child: Column(
                children: [
                  Container(
                    height: 72,
                    padding: EdgeInsets.symmetric(
                      horizontal: tablet ? AsSpacing.x6 : AsSpacing.x3,
                    ),
                    decoration: const BoxDecoration(
                      color: AsColors.surface,
                      border: Border(
                        bottom: BorderSide(color: AsColors.border),
                      ),
                    ),
                    child: Row(
                      children: [
                        if (!tablet)
                          Builder(
                            builder: (context) => IconButton(
                              tooltip: 'Abrir navegación',
                              onPressed: Scaffold.of(context).openDrawer,
                              icon: const Icon(Icons.menu_rounded),
                            ),
                          ),
                        if (tablet || constraints.maxWidth >= 520)
                          Flexible(
                            child: Text(
                              title,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                          ),
                        const Spacer(),
                        PopupMenuButton<String?>(
                          tooltip: 'Cambiar sucursal',
                          onSelected: onBranchSelected,
                          itemBuilder: (_) => [
                            if (companyWideAccess)
                              const PopupMenuItem<String?>(
                                value: null,
                                child: Text('Todas las sucursales'),
                              ),
                            ...branches.map(
                              (branch) => PopupMenuItem<String?>(
                                value: branch.id,
                                child: Text(branch.name),
                              ),
                            ),
                          ],
                          child: AsContextChip(label: contextLabel),
                        ),
                        const SizedBox(width: AsSpacing.x3),
                        PopupMenuButton<String>(
                          tooltip: 'Cuenta y empresa',
                          onSelected: (value) => value == '__logout__'
                              ? onLogout()
                              : onCompanySelected(value),
                          itemBuilder: (_) => [
                            PopupMenuItem<String>(
                              enabled: false,
                              child: Text(userLabel),
                            ),
                            ...companies
                                .where(
                                  (company) =>
                                      company.switchPermitted &&
                                      !company.current,
                                )
                                .map(
                                  (company) => PopupMenuItem<String>(
                                    value: company.id,
                                    child: Text('Cambiar a ${company.name}'),
                                  ),
                                ),
                            const PopupMenuDivider(),
                            const PopupMenuItem<String>(
                              value: '__logout__',
                              child: Text('Cerrar sesión'),
                            ),
                          ],
                          child: const CircleAvatar(
                            child: Icon(Icons.person_outline_rounded),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: EdgeInsets.all(
                        desktop ? AsSpacing.x8 : AsSpacing.x5,
                      ),
                      child: child,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}

class _Navigation extends StatelessWidget {
  const _Navigation({this.compact = false});
  final bool compact;

  @override
  Widget build(BuildContext context) => Container(
    width: compact ? 88 : 248,
    color: AsColors.primaryDark,
    padding: const EdgeInsets.symmetric(
      horizontal: AsSpacing.x4,
      vertical: AsSpacing.x6,
    ),
    child: Column(
      crossAxisAlignment: compact
          ? CrossAxisAlignment.center
          : CrossAxisAlignment.start,
      children: [
        AsAppLogo(compact: compact, onDark: true),
        const SizedBox(height: AsSpacing.x10),
        _NavItem(
          icon: Icons.space_dashboard_outlined,
          label: 'Inicio',
          compact: compact,
          selected: true,
        ),
        _NavItem(
          icon: Icons.analytics_outlined,
          label: 'Operación',
          compact: compact,
        ),
        _NavItem(
          icon: Icons.settings_outlined,
          label: 'Configuración',
          compact: compact,
        ),
        const Spacer(),
        _NavItem(
          icon: Icons.help_outline_rounded,
          label: 'Ayuda',
          compact: compact,
        ),
      ],
    ),
  );
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.compact,
    this.selected = false,
  });
  final IconData icon;
  final String label;
  final bool compact;
  final bool selected;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    label: label,
    child: Container(
      margin: const EdgeInsets.only(bottom: AsSpacing.x2),
      decoration: BoxDecoration(
        color: selected
            ? Colors.white.withValues(alpha: .12)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(AsRadius.medium),
      ),
      child: ListTile(
        dense: compact,
        leading: Icon(icon, color: Colors.white),
        title: compact
            ? null
            : Text(
                label,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
      ),
    ),
  );
}
