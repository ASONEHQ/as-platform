import 'package:flutter/material.dart';

import '../../core/widgets/responsive_scaffold.dart';
import '../../design_system/components/as_components.dart';
import '../../design_system/tokens/as_tokens.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});
  @override
  Widget build(BuildContext context) => AsResponsiveScaffold(
    title: 'AS ONE',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const AsPageHeader(
          title: 'Centro de control',
          description:
              'La información autorizada se conectará en una etapa posterior.',
          trailing: AsStatusBadge(label: 'Foundation'),
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
              children: const [
                AsCard(
                  child: AsEmptyState(
                    title: 'Resumen',
                    message: 'Sin datos conectados todavía.',
                    icon: Icons.insights_outlined,
                  ),
                ),
                AsCard(
                  child: AsEmptyState(
                    title: 'API',
                    message: 'Estado pendiente de integración.',
                    icon: Icons.cloud_outlined,
                  ),
                ),
                AsCard(
                  child: AsEmptyState(
                    title: 'Actividad',
                    message: 'No hay actividad para mostrar.',
                    icon: Icons.timeline_outlined,
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
