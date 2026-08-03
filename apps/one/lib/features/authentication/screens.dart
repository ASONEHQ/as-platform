import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../design_system/components/as_components.dart';
import '../../design_system/tokens/as_tokens.dart';
import 'auth_models.dart';

class BootstrapScreen extends StatelessWidget {
  const BootstrapScreen({super.key});

  @override
  Widget build(BuildContext context) => const Scaffold(
    backgroundColor: AsColors.primaryDark,
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AsAppLogo(onDark: true),
          SizedBox(height: AsSpacing.x8),
          AsLoadingIndicator(label: 'Restaurando sesión segura'),
        ],
      ),
    ),
  );
}

class LoginFoundationScreen extends StatefulWidget {
  const LoginFoundationScreen({super.key});

  @override
  State<LoginFoundationScreen> createState() => _LoginFoundationScreenState();
}

class _LoginFoundationScreenState extends State<LoginFoundationScreen> {
  final identifier = TextEditingController();
  final password = TextEditingController();
  String? localError;

  @override
  void dispose() {
    identifier.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final email = identifier.text.trim();
    if (email.length < 3 || password.text.length < 8) {
      setState(
        () => localError = 'Ingresa un correo y una contraseña válidos.',
      );
      return;
    }
    setState(() => localError = null);
    final auth = AuthScope.of(context);
    await auth.login(identifier: email, password: password.text);
    if (mounted && auth.phase == AuthPhase.failure) password.clear();
  }

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final loading = auth.phase == AuthPhase.authenticating;
    final error = localError ?? auth.state.failure?.message;
    return Scaffold(
      body: Row(
        children: [
          if (MediaQuery.sizeOf(context).width >= AsBreakpoints.tablet)
            Expanded(
              child: Container(
                color: AsColors.primaryDark,
                padding: const EdgeInsets.all(AsSpacing.x12),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    AsAppLogo(onDark: true),
                    SizedBox(height: AsSpacing.x8),
                    Text(
                      'Una plataforma. Toda tu operación.',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 42,
                        fontWeight: FontWeight.w700,
                        height: 1.08,
                      ),
                    ),
                    SizedBox(height: AsSpacing.x4),
                    Text(
                      'Contexto, control e inteligencia para negocios de experiencias.',
                      style: TextStyle(
                        color: Color(0xFFDCEAFF),
                        fontSize: 18,
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          Expanded(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AsSpacing.x6),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: AutofillGroup(
                    child: AsCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const AsAppLogo(),
                          const SizedBox(height: AsSpacing.x8),
                          Text(
                            'Bienvenido',
                            style: Theme.of(context).textTheme.headlineMedium
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: AsSpacing.x2),
                          const Text(
                            'Accede de forma segura a tu espacio de trabajo.',
                          ),
                          const SizedBox(height: AsSpacing.x6),
                          AsTextField(
                            key: const Key('login-identifier'),
                            label: 'Correo electrónico',
                            controller: identifier,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.username],
                            enabled: !loading,
                          ),
                          const SizedBox(height: AsSpacing.x4),
                          AsPasswordField(
                            key: const Key('login-password'),
                            label: 'Contraseña',
                            controller: password,
                            enabled: !loading,
                            onSubmitted: (_) => submit(),
                          ),
                          if (error != null) ...[
                            const SizedBox(height: AsSpacing.x4),
                            Semantics(
                              liveRegion: true,
                              child: Text(
                                error,
                                key: const Key('login-error'),
                                style: const TextStyle(color: AsColors.error),
                              ),
                            ),
                          ],
                          const SizedBox(height: AsSpacing.x6),
                          AsPrimaryButton(
                            label: loading ? 'Validando…' : 'Continuar',
                            onPressed: loading ? null : submit,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class CompanySelectionScreen extends StatelessWidget {
  const CompanySelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final companies = auth.state.selectionCompanies;
    final loading = auth.phase == AuthPhase.selectingCompany;
    return _SelectionScreen(
      title: 'Selecciona una empresa',
      description:
          'Continúa únicamente con una empresa autorizada por tu cuenta.',
      emptyMessage: 'No hay empresas elegibles para esta sesión.',
      loading: loading,
      items: companies
          .map(
            (company) => _SelectionItem(
              key: Key('company-${company.id}'),
              title: company.name,
              subtitle: 'Empresa autorizada',
              icon: Icons.apartment_rounded,
              onSelected: () => auth.selectCompany(company.id),
            ),
          )
          .toList(growable: false),
      onCancel: auth.retry,
    );
  }
}

class BranchSelectionScreen extends StatelessWidget {
  const BranchSelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final current = auth.context;
    final loading = auth.phase == AuthPhase.selectingBranch;
    final items = <Widget>[
      if (current?.companyWideAccess ?? false)
        _SelectionItem(
          key: const Key('branch-corporate'),
          title: 'Todas las sucursales',
          subtitle: 'Contexto corporativo autorizado',
          icon: Icons.hub_outlined,
          onSelected: () => auth.selectBranch(null),
        ),
      ...?current?.branches.map(
        (branch) => _SelectionItem(
          key: Key('branch-${branch.id}'),
          title: branch.name,
          subtitle: '${branch.code} · ${branch.timezone}',
          icon: Icons.store_mall_directory_outlined,
          onSelected: () => auth.selectBranch(branch.id),
        ),
      ),
    ];
    return _SelectionScreen(
      title: 'Selecciona una sucursal',
      description: 'Tu alcance se obtiene directamente desde el servidor.',
      emptyMessage: 'No tienes sucursales activas disponibles.',
      loading: loading,
      items: items,
      onCancel: auth.logout,
    );
  }
}

class _SelectionScreen extends StatelessWidget {
  const _SelectionScreen({
    required this.title,
    required this.description,
    required this.emptyMessage,
    required this.loading,
    required this.items,
    required this.onCancel,
  });
  final String title;
  final String description;
  final String emptyMessage;
  final bool loading;
  final List<Widget> items;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AsSpacing.x6),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: AsCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const AsAppLogo(),
                const SizedBox(height: AsSpacing.x8),
                Text(title, style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: AsSpacing.x2),
                Text(description),
                const SizedBox(height: AsSpacing.x6),
                if (loading)
                  const Padding(
                    padding: EdgeInsets.all(AsSpacing.x8),
                    child: AsLoadingIndicator(label: 'Actualizando contexto'),
                  )
                else if (items.isEmpty)
                  SizedBox(
                    height: 220,
                    child: AsEmptyState(
                      title: 'Sin opciones disponibles',
                      message: emptyMessage,
                      icon: Icons.domain_disabled_outlined,
                    ),
                  )
                else
                  FocusTraversalGroup(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: items,
                    ),
                  ),
                const SizedBox(height: AsSpacing.x4),
                AsSecondaryButton(
                  label: 'Volver al inicio',
                  onPressed: onCancel,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _SelectionItem extends StatelessWidget {
  const _SelectionItem({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onSelected,
    super.key,
  });
  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AsSpacing.x3),
    child: Semantics(
      button: true,
      label: '$title, $subtitle',
      child: OutlinedButton(
        onPressed: onSelected,
        style: OutlinedButton.styleFrom(
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.all(AsSpacing.x4),
        ),
        child: Row(
          children: [
            Icon(icon),
            const SizedBox(width: AsSpacing.x4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(subtitle),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_rounded),
          ],
        ),
      ),
    ),
  );
}

class UnavailableScreen extends StatelessWidget {
  const UnavailableScreen({this.notFound = false, super.key});
  final bool notFound;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: AsErrorState(
      title: notFound ? 'Página no encontrada' : 'AS ONE no está disponible',
      message: notFound
          ? 'La dirección solicitada no existe.'
          : 'No pudimos conectar con la plataforma. Vuelve a intentarlo.',
      onRetry: notFound ? null : AuthScope.of(context).retry,
    ),
  );
}

class SessionEndedScreen extends StatelessWidget {
  const SessionEndedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final revoked = auth.phase == AuthPhase.revoked;
    return Scaffold(
      body: AsErrorState(
        title: revoked ? 'Sesión cerrada por seguridad' : 'Tu sesión terminó',
        message:
            auth.state.failure?.message ??
            'Inicia sesión nuevamente para continuar.',
        onRetry: auth.retry,
      ),
    );
  }
}
