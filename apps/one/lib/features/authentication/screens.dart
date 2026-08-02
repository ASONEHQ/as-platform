import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../design_system/components/as_components.dart';
import '../../design_system/tokens/as_tokens.dart';

class BootstrapScreen extends StatefulWidget {
  const BootstrapScreen({super.key});
  @override
  State<BootstrapScreen> createState() => _BootstrapScreenState();
}

class _BootstrapScreenState extends State<BootstrapScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.go('/login');
    });
  }

  @override
  Widget build(BuildContext context) => const Scaffold(
    backgroundColor: AsColors.primaryDark,
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AsAppLogo(onDark: true),
          SizedBox(height: AsSpacing.x8),
          AsLoadingIndicator(label: 'Preparando AS ONE'),
        ],
      ),
    ),
  );
}

class LoginFoundationScreen extends StatelessWidget {
  const LoginFoundationScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
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
                          'La conexión segura se habilitará en TASK 10.4.',
                        ),
                        const SizedBox(height: AsSpacing.x6),
                        const AsTextField(
                          label: 'Correo electrónico',
                          keyboardType: TextInputType.emailAddress,
                        ),
                        const SizedBox(height: AsSpacing.x4),
                        const AsPasswordField(label: 'Contraseña'),
                        const SizedBox(height: AsSpacing.x6),
                        const AsPrimaryButton(
                          label: 'Continuar',
                          onPressed: null,
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

class CompanySelectionScreen extends StatelessWidget {
  const CompanySelectionScreen({super.key});
  @override
  Widget build(BuildContext context) => const _SelectionFoundation(
    title: 'Selecciona una empresa',
    message:
        'Las empresas autorizadas aparecerán después de validar tu sesión.',
  );
}

class BranchSelectionScreen extends StatelessWidget {
  const BranchSelectionScreen({super.key});
  @override
  Widget build(BuildContext context) => const _SelectionFoundation(
    title: 'Selecciona una sucursal',
    message:
        'El acceso por sucursal se resolverá exclusivamente desde el servidor.',
  );
}

class _SelectionFoundation extends StatelessWidget {
  const _SelectionFoundation({required this.title, required this.message});
  final String title;
  final String message;
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(AsSpacing.x6),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: AsCard(
            child: SizedBox(
              height: 300,
              child: AsEmptyState(
                title: title,
                message: message,
                icon: Icons.apartment_rounded,
              ),
            ),
          ),
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
          : 'Vuelve a intentarlo en unos momentos.',
    ),
  );
}
