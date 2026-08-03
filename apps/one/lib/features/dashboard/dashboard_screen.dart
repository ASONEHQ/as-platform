import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/widgets/responsive_scaffold.dart';
import '../../design_system/components/as_components.dart';
import '../../design_system/tokens/as_tokens.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final current = auth.context;
    if (current == null) {
      return const Scaffold(
        body: Center(child: AsLoadingIndicator(label: 'Actualizando sesión')),
      );
    }
    final company = current.currentCompany;
    final branch = current.currentBranch;
    return AsResponsiveScaffold(
      title: company?.name ?? 'AS ONE',
      contextLabel: branch?.name ?? 'Todas las sucursales',
      userLabel: current.user.displayName,
      companies: current.companies,
      branches: current.branches,
      companyWideAccess: current.companyWideAccess,
      onCompanySelected: auth.switchCompany,
      onBranchSelected: auth.selectBranch,
      onLogout: auth.logout,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AsPageHeader(
            title: 'Centro de control',
            description: 'Sesión activa para ${current.user.displayName}.',
            trailing: const AsStatusBadge(label: 'Conectado'),
          ),
          const SizedBox(height: AsSpacing.x8),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= AsBreakpoints.desktop
                  ? 3
                  : constraints.maxWidth >= AsBreakpoints.mobile
                  ? 2
                  : 1;
              return GridView.count(
                crossAxisCount: columns,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: AsSpacing.x4,
                mainAxisSpacing: AsSpacing.x4,
                childAspectRatio: 1.65,
                children: [
                  AsCard(
                    child: AsEmptyState(
                      title: company?.name ?? 'Empresa actual',
                      message: branch?.name ?? 'Contexto corporativo',
                      icon: Icons.apartment_outlined,
                    ),
                  ),
                  const AsCard(
                    child: AsEmptyState(
                      title: 'API disponible',
                      message: 'La sesión y el contexto están sincronizados.',
                      icon: Icons.cloud_done_outlined,
                    ),
                  ),
                  AsCard(
                    child: AsEmptyState(
                      title: 'Permisos activos',
                      message:
                          '${current.permissions.length} capacidades autorizadas.',
                      icon: Icons.verified_user_outlined,
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
