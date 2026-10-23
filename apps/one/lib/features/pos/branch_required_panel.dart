/// TASK 17.7.3 — one honest, actionable state for an OPERATIONAL screen
/// (current cash session, schedules, time clock …) opened while the session
/// is in the aggregate "Todas las sucursales" context.
///
/// There are two very different situations and they must not look alike:
///
///  * the user CAN use one or more branches but has not chosen one → say so
///    and offer the choice right here (this is not a misconfigured account);
///  * the user genuinely has NO accessible branch → that is an access problem
///    to take to an administrator.
///
/// Choosing a branch is session/UI context only: it never grants access (the
/// server re-checks the branch on every request) and the list below is only
/// what the backend already authorized for this session.
library;

import 'package:flutter/material.dart';

import '../authentication/auth_models.dart';
import 'pos_tokens.dart';

class BranchRequiredPanel extends StatefulWidget {
  const BranchRequiredPanel({
    required this.context,
    required this.message,
    this.onBranchSelected,
    super.key,
  });

  final AuthenticatedContext context;

  /// What the user is trying to do, e.g. "Selecciona una sucursal para
  /// consultar la caja actual."
  final String message;

  /// The shell's one branch-switch path. When absent the panel can only point
  /// at the top-bar selector.
  final Future<void> Function(String? branchId)? onBranchSelected;

  @override
  State<BranchRequiredPanel> createState() => _BranchRequiredPanelState();
}

class _BranchRequiredPanelState extends State<BranchRequiredPanel> {
  String? _selecting;
  String? _error;

  Future<void> _select(String branchId) async {
    final callback = widget.onBranchSelected;
    if (callback == null || _selecting != null) return;
    setState(() {
      _selecting = branchId;
      _error = null;
    });
    try {
      await callback(branchId);
    } on Object {
      if (mounted) {
        setState(() => _error = 'No fue posible cambiar de sucursal. Inténtalo de nuevo.');
      }
    } finally {
      if (mounted) setState(() => _selecting = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branches = widget.context.branches;
    final hasAccess = branches.isNotEmpty;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: Container(
          key: Key(hasAccess ? 'branch-required' : 'branch-required-none'),
          margin: const EdgeInsets.symmetric(vertical: 24),
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: palette.surface,
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(hasAccess ? Icons.storefront_outlined : Icons.lock_outline, size: 34, color: palette.blueDeep),
              const SizedBox(height: 10),
              Text(
                hasAccess ? widget.message : 'Tu usuario no tiene una sucursal autorizada.',
                textAlign: TextAlign.center,
                style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 15),
              ),
              const SizedBox(height: 6),
              Text(
                hasAccess
                    ? 'Esta pantalla trabaja con una sucursal concreta. "Todas las sucursales" solo aplica a paneles y reportes consolidados.'
                    : 'Pide a un administrador que te asigne una sucursal para poder usar esta pantalla.',
                textAlign: TextAlign.center,
                style: TextStyle(color: palette.textSecondary, fontSize: 12),
              ),
              if (hasAccess) ...[
                const SizedBox(height: 16),
                if (widget.onBranchSelected == null)
                  Text(
                    'Elige la sucursal en el selector de la barra superior.',
                    key: const Key('branch-required-hint'),
                    textAlign: TextAlign.center,
                    style: TextStyle(color: palette.textMuted, fontSize: 12),
                  )
                else
                  for (final branch in branches)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: OutlinedButton.icon(
                        key: Key('branch-required-${branch.id}'),
                        onPressed: _selecting == null ? () => _select(branch.id) : null,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.text,
                          side: BorderSide(color: palette.border),
                          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 12),
                        ),
                        icon: _selecting == branch.id
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.store_outlined, size: 16),
                        label: Text(branch.name, overflow: TextOverflow.ellipsis),
                      ),
                    ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 4),
                Text(_error!, key: const Key('branch-required-error'), textAlign: TextAlign.center, style: TextStyle(color: palette.error, fontSize: 12)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
