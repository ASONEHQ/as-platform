import 'package:flutter/material.dart';

import '../../design_system/components/as_components.dart';
import '../../design_system/tokens/as_tokens.dart';

class AsResponsiveScaffold extends StatelessWidget {
  const AsResponsiveScaffold({
    required this.title,
    required this.child,
    super.key,
  });
  final String title;
  final Widget child;

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
                    padding: const EdgeInsets.symmetric(
                      horizontal: AsSpacing.x6,
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
                        Text(
                          title,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const Spacer(),
                        const AsContextChip(label: 'Seleccionar contexto'),
                        const SizedBox(width: AsSpacing.x3),
                        const Tooltip(
                          message: 'Control de sesión',
                          child: CircleAvatar(
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
