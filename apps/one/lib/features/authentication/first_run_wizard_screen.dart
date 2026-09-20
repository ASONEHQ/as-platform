import 'package:flutter/material.dart';

import '../../design_system/tokens/as_tokens.dart';
import '../../design_system/tokens/as_typography.dart';
import 'startup_visuals.dart';

/// Visual-only preview of V1's first-run activation wizard
/// (`#aspos-wizard`) — TASK 12.2F.
///
/// There is no activation/licensing contract anywhere in this backend (no
/// `activation_key`/license table, no `/activation` endpoint — confirmed
/// by inspection before writing this screen). This screen therefore:
///   * is reachable ONLY from an explicit, non-production-gated link on
///     [LoginFoundationScreen] (never shown automatically, never part of
///     the real `AuthPhase` redirect chain);
///   * holds every field in local, ephemeral `TextEditingController` state
///     that is discarded when the screen is popped — nothing is persisted,
///     nothing is sent anywhere;
///   * never bypasses real authentication — "Comenzar" only surfaces a
///     notice that activation submission is deferred until a real backend
///     contract exists, per TASK 12.2F's explicit instruction not to
///     fabricate activation/licensing behavior.
class FirstRunWizardPreviewScreen extends StatefulWidget {
  const FirstRunWizardPreviewScreen({super.key});

  @override
  State<FirstRunWizardPreviewScreen> createState() =>
      _FirstRunWizardPreviewScreenState();
}

class _FirstRunWizardPreviewScreenState
    extends State<FirstRunWizardPreviewScreen> {
  final activationKey = TextEditingController();
  final businessName = TextEditingController();
  final adminName = TextEditingController();
  final adminUser = TextEditingController();
  final adminPin = TextEditingController();
  final adminPinConfirm = TextEditingController();

  @override
  void dispose() {
    activationKey.dispose();
    businessName.dispose();
    adminName.dispose();
    adminUser.dispose();
    adminPin.dispose();
    adminPinConfirm.dispose();
    super.dispose();
  }

  void _showDeferredNotice() => StartupToast.show(
    context,
    'Activación pendiente: aún no existe un contrato real de activación '
    'en el backend. Nada de lo capturado aquí se guarda ni se envía.',
    color: StartupColors.amber,
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    body: StartupBackground(
      child: Stack(
        children: [
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AsSpacing.x6),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: StartupCardEntrance(
                  child: Container(
                    padding: const EdgeInsets.all(28),
                    decoration: BoxDecoration(
                      color: StartupColors.cardSurface,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x73000000),
                          blurRadius: 80,
                          offset: Offset(0, 24),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: StartupColors.amber.withValues(
                                  alpha: .12,
                                ),
                                borderRadius: BorderRadius.circular(999),
                                border: Border.all(
                                  color: StartupColors.amber.withValues(
                                    alpha: .4,
                                  ),
                                ),
                              ),
                              child: const Text(
                                'VISTA PREVIA · NO CONECTADA',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: .5,
                                  color: StartupColors.amber,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        const Center(child: StartupLogoMark(size: 64)),
                        const SizedBox(height: 12),
                        Center(
                          child: Text(
                            '¡Bienvenido a ACCESS GO!',
                            style: AsTypography.heading.copyWith(
                              color: StartupColors.text,
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Center(
                          child: Text(
                            'Configura tu negocio en un minuto para empezar a '
                            'vender.',
                            textAlign: TextAlign.center,
                            style: AsTypography.body.copyWith(
                              color: StartupColors.textSecondary,
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        StartupField(
                          key: const Key('wiz-clave'),
                          label: 'Clave de activación *',
                          controller: activationKey,
                          hintText: 'ACCESSGO-XXXX-XXXX-XXXX',
                          textCapitalization: TextCapitalization.characters,
                        ),
                        Padding(
                          padding: const EdgeInsets.only(top: 4, bottom: 12),
                          child: Text(
                            'Te la entrega tu distribuidor al adquirir el '
                            'sistema.',
                            style: AsTypography.hint.copyWith(
                              color: StartupColors.textMuted,
                            ),
                          ),
                        ),
                        StartupField(
                          key: const Key('wiz-nombre-negocio'),
                          label: 'Nombre de tu negocio *',
                          controller: businessName,
                          hintText: 'Ej. Mi Negocio',
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'Logo (opcional)',
                          style: AsTypography.label.copyWith(
                            color: StartupColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Row(
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: StartupColors.border,
                                  width: 1.5,
                                ),
                                borderRadius: BorderRadius.circular(12),
                                color: StartupColors.fieldFill,
                              ),
                              child: const Text(
                                'Sin logo',
                                style: TextStyle(
                                  fontSize: 10,
                                  color: StartupColors.textMuted,
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: OutlinedButton.icon(
                                key: const Key('wiz-logo-input'),
                                onPressed: () => StartupToast.show(
                                  context,
                                  'La carga de logo estará disponible cuando '
                                  'la activación esté conectada.',
                                ),
                                icon: const Icon(
                                  Icons.upload_outlined,
                                  size: 16,
                                ),
                                label: const Text('Elegir imagen'),
                              ),
                            ),
                          ],
                        ),
                        Padding(
                          padding: const EdgeInsets.only(top: 14, bottom: 12),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.admin_panel_settings_outlined,
                                size: 16,
                                color: StartupColors.textSecondary,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'Cuenta del administrador',
                                style: AsTypography.body.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: StartupColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: StartupField(
                                key: const Key('wiz-admin-nombre'),
                                label: 'Tu nombre *',
                                controller: adminName,
                                hintText: 'Nombre completo',
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: StartupField(
                                key: const Key('wiz-admin-user'),
                                label: 'Usuario de acceso *',
                                controller: adminUser,
                                hintText: 'admin',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: StartupField(
                                key: const Key('wiz-admin-pin'),
                                label: 'PIN (4 dígitos) *',
                                controller: adminPin,
                                obscureText: true,
                                maxLength: 4,
                                keyboardType: TextInputType.number,
                                hintText: '••••',
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: StartupField(
                                key: const Key('wiz-admin-pin2'),
                                label: 'Confirmar PIN *',
                                controller: adminPinConfirm,
                                obscureText: true,
                                maxLength: 4,
                                keyboardType: TextInputType.number,
                                hintText: '••••',
                              ),
                            ),
                          ],
                        ),
                        Padding(
                          padding: const EdgeInsets.only(top: 4, bottom: 16),
                          child: Text(
                            'Con este PIN autorizarás las acciones de '
                            'administrador (editar productos, permisos, '
                            'nómina, etc.).',
                            style: AsTypography.hint.copyWith(
                              color: StartupColors.textMuted,
                            ),
                          ),
                        ),
                        StartupPrimaryButton(
                          label: 'Comenzar',
                          icon: Icons.rocket_launch_outlined,
                          onPressed: _showDeferredNotice,
                        ),
                        const SizedBox(height: 12),
                        Center(
                          child: TextButton(
                            key: const Key('wiz-back-to-login'),
                            onPressed: () => Navigator.of(context).maybePop(),
                            child: const Text('Volver a iniciar sesión'),
                          ),
                        ),
                      ],
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
