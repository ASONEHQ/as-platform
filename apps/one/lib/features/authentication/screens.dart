import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app.dart';
import '../../core/config/app_config.dart';
import '../../design_system/components/as_components.dart';
import '../../design_system/tokens/as_tokens.dart';
import '../../design_system/tokens/as_typography.dart';
import 'auth_models.dart';
import 'startup_visuals.dart';

/// The splash state — ported from V1's `#pos-splash`: the same deep-blue
/// radial gradient, the official ACCESS GO mark (TASK 16.12), and a
/// letter-spaced "PUNTO DE VENTA" label, with a light fade/scale entrance
/// (TASK 12.2F).
class BootstrapScreen extends StatefulWidget {
  const BootstrapScreen({super.key});

  @override
  State<BootstrapScreen> createState() => _BootstrapScreenState();
}

class _BootstrapScreenState extends State<BootstrapScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController controller = AnimationController(
    vsync: this,
    duration: AsMotion.slow,
  );

  @override
  void initState() {
    super.initState();
    controller.forward();
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reducedMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final logo = const StartupLogoMark(size: 96);
    final label = const Text('PUNTO DE VENTA', style: _splashTextStyle);
    return Scaffold(
      body: StartupBackground(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              reducedMotion
                  ? logo
                  : ScaleTransition(
                      scale: Tween(begin: 0.9, end: 1.0).animate(
                        CurvedAnimation(
                          parent: controller,
                          curve: Curves.easeOutBack,
                        ),
                      ),
                      child: FadeTransition(opacity: controller, child: logo),
                    ),
              const SizedBox(height: AsSpacing.x5),
              reducedMotion
                  ? label
                  : FadeTransition(opacity: controller, child: label),
              const SizedBox(height: AsSpacing.x8),
              Semantics(
                liveRegion: true,
                label: 'Restaurando sesión segura',
                child: const SizedBox.square(
                  dimension: 28,
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    valueColor: AlwaysStoppedAnimation(Colors.white70),
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

/// `.splash-text{font-weight:600;font-size:24px;letter-spacing:8px;
/// color:rgba(255,255,255,.9)}` — exact literal from V1's `#pos-splash`.
const _splashTextStyle = TextStyle(
  fontFamily: AsTypography.family,
  color: Color(0xE6FFFFFF),
  fontSize: 24,
  fontWeight: FontWeight.w600,
  letterSpacing: 8,
);

enum _LoginTab { password, pin, qr }

/// The mandatory sign-in gate — ported from V1's
/// `#modal-login.gate-activo`: centered card over the same deep-blue
/// background, "Iniciar sesión" header, ACCESS GO branding, Contraseña/PIN/QR
/// tabs. Only the Contraseña tab is real (it drives the existing
/// `AuthController.login`); PIN and QR are visually faithful but inert —
/// there is no PIN/QR authentication contract on the backend (TASK 12.2F).
class LoginFoundationScreen extends StatefulWidget {
  const LoginFoundationScreen({super.key});

  @override
  State<LoginFoundationScreen> createState() => _LoginFoundationScreenState();
}

class _LoginFoundationScreenState extends State<LoginFoundationScreen> {
  final identifier = TextEditingController();
  final password = TextEditingController();
  final qrCode = TextEditingController();
  String? localError;
  _LoginTab tab = _LoginTab.password;
  String pinBuffer = '';

  @override
  void dispose() {
    identifier.dispose();
    password.dispose();
    qrCode.dispose();
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

  void _handleEntrarPressed() {
    switch (tab) {
      case _LoginTab.password:
        submit();
      case _LoginTab.pin:
      case _LoginTab.qr:
        StartupToast.show(
          context,
          'Este método de acceso estará disponible cuando su backend esté '
          'conectado.',
        );
    }
  }

  // Matches V1's `cerrarModalLoginSiPosible()`: while the login gate is
  // mandatory (always true in this app — there is no dismissible,
  // non-gated login route), closing is blocked with the same notice.
  void _showGateNotice() => StartupToast.show(
    context,
    'Debes iniciar sesión para continuar',
    color: StartupColors.amber,
  );

  // Matches V1's `avisoSinCuenta()` exactly — in V1 this link was never a
  // real self-service flow either, just an informational toast.
  void _showNoAccountNotice() => StartupToast.show(
    context,
    'Pide a tu administrador que te cree un usuario en Configuración › '
    'Usuarios.',
    color: StartupColors.amber,
  );

  // There is no session to close on this screen (it only renders while
  // unauthenticated) — kept visible for fidelity, but honestly inert
  // rather than wired to `AuthController.logout()`.
  void _showNoSessionNotice() =>
      StartupToast.show(context, 'No hay una sesión activa que cerrar.');

  void _pinDigit(String digit) {
    if (pinBuffer.length >= 4) return;
    setState(() => pinBuffer += digit);
  }

  void _pinBackspace() {
    if (pinBuffer.isEmpty) return;
    setState(() => pinBuffer = pinBuffer.substring(0, pinBuffer.length - 1));
  }

  void _pinOk() {
    setState(() => pinBuffer = '');
    StartupToast.show(
      context,
      'El acceso con PIN estará disponible cuando su backend esté conectado.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final loading = auth.phase == AuthPhase.authenticating;
    final error = localError ?? auth.state.failure?.message;
    return Scaffold(
      body: StartupBackground(
        child: Stack(
          children: [
            Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AsSpacing.x6),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: AutofillGroup(
                    child: StartupCardEntrance(
                      child: Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: StartupColors.cardSurface,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: StartupColors.border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                const Icon(
                                  Icons.login,
                                  size: 18,
                                  color: StartupColors.text,
                                ),
                                const SizedBox(width: 9),
                                const Expanded(
                                  child: Text(
                                    'Iniciar sesión',
                                    style: AsTypography.title,
                                  ),
                                ),
                                StartupCloseButton(onPressed: _showGateNotice),
                              ],
                            ),
                            const SizedBox(height: 20),
                            Center(
                              child: Column(
                                children: [
                                  // TASK 16.12 — the official ACCESS GO
                                  // logo already contains its own wordmark
                                  // ("access go"), so the previous
                                  // separately hand-styled "AS+ PUNTO DE
                                  // VENTA+" text is removed rather than
                                  // relabeled — showing both would
                                  // duplicate the product name.
                                  Image.asset(
                                    'assets/branding/access_go_logo.png',
                                    height: 56,
                                    fit: BoxFit.contain,
                                    semanticLabel: 'ACCESS GO',
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    'CONTROLA. VENDE. CRECE.',
                                    style: AsTypography.caption.copyWith(
                                      color: StartupColors.textMuted,
                                      letterSpacing: .5,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    'Plataforma ACCESS GO · Acceso seguro',
                                    style: AsTypography.body.copyWith(
                                      color: StartupColors.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 18),
                            StartupTabBar(
                              labels: const ['Contraseña', 'PIN', 'QR'],
                              icons: const [
                                Icons.key_outlined,
                                Icons.dialpad,
                                Icons.qr_code_2,
                              ],
                              selected: tab.index,
                              onChanged: (i) =>
                                  setState(() => tab = _LoginTab.values[i]),
                            ),
                            const SizedBox(height: 16),
                            // `.tab-pane.active{animation:pgFade .15s ease}`
                            // — a fade+4px-slide-up on tab switch.
                            AnimatedSwitcher(
                              duration: AsMotion.resolve(
                                context,
                                AsMotion.tabFade,
                              ),
                              transitionBuilder: (child, animation) =>
                                  FadeTransition(
                                    opacity: animation,
                                    child: SlideTransition(
                                      position:
                                          Tween(
                                            begin: const Offset(0, .02),
                                            end: Offset.zero,
                                          ).animate(
                                            CurvedAnimation(
                                              parent: animation,
                                              curve: Curves.ease,
                                            ),
                                          ),
                                      child: child,
                                    ),
                                  ),
                              child: KeyedSubtree(
                                key: ValueKey(tab),
                                child: switch (tab) {
                                  _LoginTab.password => _passwordTab(loading),
                                  _LoginTab.pin => _pinTab(),
                                  _LoginTab.qr => _qrTab(),
                                },
                              ),
                            ),
                            if (error != null && tab == _LoginTab.password) ...[
                              const SizedBox(height: 12),
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 8,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFEE2E2),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Semantics(
                                  liveRegion: true,
                                  child: Text(
                                    error,
                                    key: const Key('login-error'),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: StartupColors.red,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(height: 16),
                            StartupPrimaryButton(
                              label: loading ? 'Validando…' : 'Entrar',
                              loading: loading,
                              onPressed: loading ? null : _handleEntrarPressed,
                            ),
                            const SizedBox(height: 14),
                            Center(
                              child: TextButton(
                                key: const Key('startup-no-account-link'),
                                onPressed: _showNoAccountNotice,
                                child: const Text.rich(
                                  TextSpan(
                                    children: [
                                      TextSpan(
                                        text: '¿No tienes cuenta? ',
                                        style: TextStyle(
                                          color: StartupColors.textSecondary,
                                          fontSize: 12,
                                        ),
                                      ),
                                      TextSpan(
                                        text: 'Pide acceso a tu administrador',
                                        style: TextStyle(
                                          color: StartupColors.purple,
                                          fontWeight: FontWeight.w700,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            Center(
                              child: TextButton.icon(
                                key: const Key('startup-close-session-link'),
                                onPressed: _showNoSessionNotice,
                                icon: const Icon(
                                  Icons.logout,
                                  size: 14,
                                  color: StartupColors.textMuted,
                                ),
                                label: const Text(
                                  'Cerrar sesión',
                                  style: TextStyle(
                                    color: StartupColors.textMuted,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                            if (PlatformScope.of(context).environment !=
                                AsEnvironment.production) ...[
                              const SizedBox(height: 4),
                              Center(
                                child: TextButton(
                                  key: const Key('dev-first-run-preview-link'),
                                  onPressed: () =>
                                      context.push('/dev/first-run-preview'),
                                  child: const Text(
                                    'Vista previa: primer uso (dev)',
                                    style: TextStyle(
                                      color: StartupColors.textMuted,
                                      fontSize: 11,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const Positioned(left: 24, bottom: 24, child: StartupAiBadge()),
          ],
        ),
      ),
    );
  }

  Widget _passwordTab(bool loading) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      StartupField(
        fieldKey: const Key('login-identifier'),
        label: 'Usuario',
        controller: identifier,
        hintText: 'usuario',
        autofillHints: const [AutofillHints.username],
        enabled: !loading,
      ),
      const SizedBox(height: 12),
      StartupPasswordField(
        fieldKey: const Key('login-password'),
        label: 'Contraseña',
        controller: password,
        enabled: !loading,
        onSubmitted: (_) => submit(),
      ),
    ],
  );

  Widget _pinTab() => Column(
    children: [
      const Text(
        'Ingresa tu PIN de 4 dígitos',
        style: TextStyle(fontSize: 13, color: StartupColors.textSecondary),
      ),
      const SizedBox(height: 12),
      StartupPinDots(filled: pinBuffer.length),
      const SizedBox(height: 16),
      StartupPinKeypad(
        onDigit: _pinDigit,
        onBackspace: _pinBackspace,
        onOk: _pinOk,
      ),
    ],
  );

  Widget _qrTab() => Column(
    children: [
      const StartupQrFrame(),
      const SizedBox(height: 12),
      const Text(
        'Escanea tu código QR personal\ncon el lector de la caja',
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 12, color: StartupColors.textSecondary),
      ),
      const SizedBox(height: 12),
      StartupField(
        label: 'Código',
        controller: qrCode,
        hintText: 'O escribe el código QR...',
        onSubmitted: (_) => StartupToast.show(
          context,
          'El acceso por QR estará disponible cuando su backend esté '
          'conectado.',
        ),
      ),
    ],
  );
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
      title: notFound ? 'Página no encontrada' : 'ACCESS GO no está disponible',
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
