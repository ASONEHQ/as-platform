import 'package:flutter/material.dart';

import '../authentication/auth_models.dart';
import 'pos_models.dart';
import 'pos_navigation.dart';
import 'pos_read_controller.dart';
import 'pos_tokens.dart';

class PosShell extends StatefulWidget {
  const PosShell({
    required this.context,
    required this.controller,
    required this.onLogout,
    super.key,
  });

  final AuthenticatedContext context;
  final PosReadController controller;
  final VoidCallback onLogout;

  @override
  State<PosShell> createState() => _PosShellState();
}

class _PosShellState extends State<PosShell> {
  PosModule selected = PosModule.dashboard;
  bool dark = false;

  void select(PosModule module) {
    setState(() => selected = module);
    if (module == PosModule.products) {
      widget.controller.loadProducts();
    } else if (module == PosModule.inventory) {
      widget.controller.loadBalances(branchId: widget.context.session.branchId);
    } else if (module == PosModule.users) {
      widget.controller.loadUsers();
    }
  }

  @override
  Widget build(BuildContext context) => Theme(
    data: dark ? PosTheme.dark() : PosTheme.light(),
    child: Builder(
      builder: (context) {
        final palette = PosPalette.of(context);
        return Scaffold(
          backgroundColor: palette.background,
          body: LayoutBuilder(
            builder: (context, constraints) {
              final wide = constraints.maxWidth >= 1200;
              final rail = constraints.maxWidth >= 900;
              return Row(
                children: [
                  if (rail)
                    _Sidebar(
                      selected: selected,
                      expanded: wide,
                      onSelected: select,
                    ),
                  Expanded(
                    child: Column(
                      children: [
                        _Topbar(
                          title: selected.label,
                          context: widget.context,
                          dark: dark,
                          showMenu: !rail,
                          onToggleDark: () => setState(() => dark = !dark),
                          onOpenMenu: () => _showMobileNavigation(context),
                          onLogout: widget.onLogout,
                        ),
                        Expanded(
                          child: _Content(
                            module: selected,
                            context: widget.context,
                            controller: widget.controller,
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
    final module = await showModalBottomSheet<PosModule>(
      context: context,
      isScrollControlled: true,
      backgroundColor: PosPalette.of(context).surface,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .88,
          child: _Sidebar(
            selected: selected,
            expanded: true,
            onSelected: Navigator.of(context).pop,
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
  });

  final PosModule selected;
  final bool expanded;
  final ValueChanged<PosModule> onSelected;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-sidebar'),
      width: expanded ? 224 : 72,
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(right: BorderSide(color: palette.border)),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 70,
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [palette.action, palette.blue],
                      ),
                      borderRadius: BorderRadius.circular(11),
                    ),
                    alignment: Alignment.center,
                    child: const Text(
                      'AS',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  if (expanded) ...[
                    const SizedBox(width: 9),
                    Text(
                      'AS POS',
                      style: TextStyle(
                        color: palette.text,
                        fontWeight: FontWeight.w800,
                        fontSize: 17,
                        letterSpacing: .4,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          Divider(height: 1, color: palette.border),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(8, 7, 8, 12),
              children: [
                for (final group in posNavigationGroups) ...[
                  if (expanded)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 13, 8, 5),
                      child: Text(
                        group.toUpperCase(),
                        style: TextStyle(
                          color: palette.textSecondary,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: .5,
                        ),
                      ),
                    ),
                  for (final module in PosModule.values.where(
                    (module) => module.group == group,
                  ))
                    _SidebarItem(
                      module: module,
                      selected: module == selected,
                      expanded: expanded,
                      onTap: () => onSelected(module),
                    ),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(11),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: palette.success,
                    shape: BoxShape.circle,
                  ),
                ),
                if (expanded) ...[
                  const SizedBox(width: 8),
                  Text(
                    'Sesión conectada',
                    style: TextStyle(
                      color: palette.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Tooltip(
        message: expanded ? '' : module.label,
        child: Material(
          color: selected ? palette.blueTint : Colors.transparent,
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
                  SizedBox(
                    width: expanded ? 43 : 40,
                    child: Icon(
                      module.icon,
                      size: 20,
                      color: selected
                          ? palette.blueDeep
                          : palette.textSecondary,
                    ),
                  ),
                  if (expanded)
                    Expanded(
                      child: Text(
                        module.label,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: selected
                              ? palette.blueDeep
                              : palette.textSecondary,
                          fontSize: 12,
                          fontWeight: selected
                              ? FontWeight.w800
                              : FontWeight.w600,
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
    required this.title,
    required this.context,
    required this.dark,
    required this.showMenu,
    required this.onToggleDark,
    required this.onOpenMenu,
    required this.onLogout,
  });

  final String title;
  final AuthenticatedContext context;
  final bool dark;
  final bool showMenu;
  final VoidCallback onToggleDark;
  final VoidCallback onOpenMenu;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branch = this.context.currentBranch?.name ?? 'Todas las sucursales';
    return Container(
      key: const Key('pos-topbar'),
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Row(
        children: [
          if (showMenu)
            _RoundAction(
              tooltip: 'Abrir navegación',
              icon: Icons.menu,
              onPressed: onOpenMenu,
            ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              title,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: palette.text,
                fontWeight: FontWeight.w800,
                fontSize: 15,
              ),
            ),
          ),
          const Spacer(),
          if (MediaQuery.sizeOf(context).width >= 600)
            _ContextLabel(
              company: this.context.currentCompany?.name ?? 'AS ONE',
              branch: branch,
            ),
          const SizedBox(width: 8),
          _RoundAction(
            tooltip: dark ? 'Usar tema claro' : 'Usar tema oscuro',
            icon: dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
            onPressed: onToggleDark,
          ),
          const SizedBox(width: 6),
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
            child: CircleAvatar(
              radius: 20,
              backgroundColor: palette.action,
              child: Text(
                _initials(this.context.user.displayName),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                ),
              ),
            ),
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

class _RoundAction extends StatelessWidget {
  const _RoundAction({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      icon: Icon(icon, size: 18),
      color: palette.textSecondary,
      style: IconButton.styleFrom(
        minimumSize: const Size.square(40),
        side: BorderSide(color: palette.border),
        backgroundColor: palette.surface,
      ),
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

class _Content extends StatelessWidget {
  const _Content({
    required this.module,
    required this.context,
    required this.controller,
  });

  final PosModule module;
  final AuthenticatedContext context;
  final PosReadController controller;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) => ColoredBox(
      color: PosPalette.of(context).background,
      child: SingleChildScrollView(
        padding: EdgeInsets.all(
          MediaQuery.sizeOf(context).width >= 900 ? 20 : 12,
        ),
        child: switch (module) {
          PosModule.dashboard => _Dashboard(context: this.context),
          PosModule.products => _Products(
            state: controller.products,
            allowed: this.context.permissions.contains('catalog.read'),
            onRefresh: () => controller.loadProducts(refresh: true),
          ),
          PosModule.inventory => _Inventory(
            state: controller.balances,
            allowed: this.context.permissions.contains('inventory.read'),
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
          _ => _ComingSoon(module: module),
        },
      ),
    ),
  );
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
