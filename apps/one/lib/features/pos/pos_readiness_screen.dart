/// TASK 16.17 — "Configuración": the tenant readiness / go-live checklist.
///
/// Renders exactly what `GET /api/v1/readiness` reports — the backend is the
/// sole authority on what is ready, missing or optional; this screen only
/// presents it (copy and routing live in `pos_readiness_presentation.dart`,
/// and no widget here switches on a check code). Tenant-neutral by design:
/// every name shown (company, branch, products) comes from the response.
///
/// Standalone public file styled after `pos_branch_admin_screen.dart`: its
/// small card/header/loading/failure helpers are private copies rather than
/// imports from `pos_shell.dart`.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_navigation.dart';
import 'pos_readiness_gateway.dart';
import 'pos_readiness_presentation.dart';
import 'pos_tokens.dart';

enum _ReadinessPhase { loading, failure, ready }

class PosReadinessScreen extends StatefulWidget {
  const PosReadinessScreen({
    required this.context,
    required this.gateway,
    required this.onNavigate,
    super.key,
  });

  final AuthenticatedContext context;
  final PosReadinessGateway gateway;
  final void Function(PosModule module) onNavigate;

  @override
  State<PosReadinessScreen> createState() => _PosReadinessScreenState();
}

class _PosReadinessScreenState extends State<PosReadinessScreen> {
  _ReadinessPhase _phase = _ReadinessPhase.loading;
  PosTenantReadiness? _data;
  String? _errorMessage;
  String? _branchId;

  bool get _canRead => widget.context.permissions.contains('branch.read');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  // A missing `branch.read` never calls the gateway; `build` renders the
  // honest permission state by checking `_canRead` directly.
  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ReadinessPhase.loading;
      _errorMessage = null;
    });
    try {
      final data = await widget.gateway.readiness();
      if (!mounted) return;
      setState(() {
        _data = data;
        _phase = _ReadinessPhase.ready;
        final ids = data.branches.map((b) => b.branchId).toList(growable: false);
        if (_branchId == null || !ids.contains(_branchId)) {
          final current = widget.context.currentBranch?.id;
          _branchId = ids.isEmpty ? null : (current != null && ids.contains(current) ? current : ids.first);
        }
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ReadinessPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ReadinessPhase.failure;
        _errorMessage = 'No fue posible cargar el estado de la configuración.';
      });
    }
  }

  PosBranchReadiness? get _selectedBranch {
    final data = _data;
    if (data == null) return null;
    for (final branch in data.branches) {
      if (branch.branchId == _branchId) return branch;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Configuración',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-readiness-refresh'),
                tooltip: 'Actualizar',
                onPressed: _canRead ? () => unawaited(_load()) : null,
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Estado de la configuración de tu empresa: qué está listo y qué falta para vender.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _ReadinessPermissionState()
          else
            switch (_phase) {
              _ReadinessPhase.loading => const _ReadinessLoadingState(),
              _ReadinessPhase.failure => _ReadinessFailureState(
                message: _errorMessage ?? 'No fue posible cargar el estado de la configuración.',
                onRetry: () => unawaited(_load()),
              ),
              _ReadinessPhase.ready => _buildReady(_data!),
            },
        ],
      ),
    );
  }

  Widget _buildReady(PosTenantReadiness data) {
    final branch = _selectedBranch;
    final hasBranches = data.branches.isNotEmpty;
    final saleReady = branch?.stage('sale')?.ready == true;
    final checks = <PosReadinessCheck>[...data.companyChecks, ...?branch?.checks];
    final required = checks.where((c) => c.required).toList(growable: false);
    final optional = checks.where((c) => !c.required).toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (data.companyName.isNotEmpty || (branch?.name.isNotEmpty ?? false)) ...[
          Text(
            [data.companyName, if (branch != null) branch.name].where((v) => v.isNotEmpty).join(' · '),
            key: const Key('pos-readiness-scope'),
            style: TextStyle(color: PosPalette.of(context).textMuted, fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
        ],
        _ReadinessBanner(ready: saleReady),
        const SizedBox(height: 14),
        if (data.branches.length > 1) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              child: DropdownButtonFormField<String>(
                key: const Key('pos-readiness-branch-picker'),
                initialValue: _branchId,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Sucursal'),
                items: [
                  for (final b in data.branches)
                    DropdownMenuItem(
                      value: b.branchId,
                      child: Text(b.name.isEmpty ? b.code : b.name, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (value) => setState(() => _branchId = value),
              ),
            ),
          ),
          const SizedBox(height: 14),
        ],
        if (hasBranches && branch != null)
          _StageWrap(
            stages: [for (final key in posReadinessStageOrder) (key: key, ready: branch.stage(key)?.ready)],
          )
        else
          _StageWrap(stages: [(key: 'administration', ready: data.administrationReady)]),
        if (!hasBranches) ...[
          const SizedBox(height: 10),
          const _ReadinessNote(
            key: Key('pos-readiness-no-branches'),
            text:
                'Aún no hay sucursales. Crea la primera para ver el resto de los pasos: cajas, usuarios, productos y ventas.',
          ),
        ],
        const SizedBox(height: 18),
        if (required.isNotEmpty)
          _ChecklistSection(
            sectionKey: const Key('pos-readiness-section-required'),
            title: 'Requerido',
            checks: required,
            onNavigate: widget.onNavigate,
          ),
        if (optional.isNotEmpty)
          _ChecklistSection(
            sectionKey: const Key('pos-readiness-section-optional'),
            title: 'Opcional',
            checks: optional,
            onNavigate: widget.onNavigate,
          ),
      ],
    );
  }
}

class _ReadinessBanner extends StatelessWidget {
  const _ReadinessBanner({required this.ready});
  final bool ready;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final color = ready ? palette.success : palette.warning;
    return Container(
      key: Key(ready ? 'pos-readiness-banner-ready' : 'pos-readiness-banner-pending'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: .5)),
      ),
      child: Row(
        children: [
          Icon(ready ? Icons.check_circle : Icons.warning_amber_rounded, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              ready ? 'Tu sucursal está lista para vender.' : 'Aún faltan pasos para poder vender.',
              style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

class _StageWrap extends StatelessWidget {
  const _StageWrap({required this.stages});
  final List<({String key, bool? ready})> stages;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 10,
    runSpacing: 10,
    children: [for (final stage in stages) _StageChip(stageKey: stage.key, ready: stage.ready)],
  );
}

class _StageChip extends StatelessWidget {
  const _StageChip({required this.stageKey, required this.ready});
  final String stageKey;
  final bool? ready;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final (color, icon, state) = switch (ready) {
      true => (palette.success, Icons.check_circle, 'Listo'),
      false => (palette.warning, Icons.schedule, 'Pendiente'),
      null => (palette.textMuted, Icons.remove_circle_outline, 'No aplica'),
    };
    final hint = posReadinessStageHint(stageKey);
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 180, maxWidth: 260),
      child: Container(
        key: Key('pos-readiness-stage-$stageKey'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: .6)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16, color: color),
                const SizedBox(width: 6),
                Text(state, style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              posReadinessStageLabel(stageKey),
              style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
            ),
            if (hint.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(hint, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
            ],
          ],
        ),
      ),
    );
  }
}

class _ReadinessNote extends StatelessWidget {
  const _ReadinessNote({required this.text, super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Text(text, style: TextStyle(color: palette.textSecondary, fontSize: 12));
  }
}

class _ChecklistSection extends StatelessWidget {
  const _ChecklistSection({
    required this.sectionKey,
    required this.title,
    required this.checks,
    required this.onNavigate,
  });
  final Key sectionKey;
  final String title;
  final List<PosReadinessCheck> checks;
  final void Function(PosModule module) onNavigate;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Column(
      key: sectionKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text(title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 15)),
        ),
        for (final check in checks) _CheckRow(check: check, onNavigate: onNavigate),
        const SizedBox(height: 10),
      ],
    );
  }
}

class _CheckRow extends StatelessWidget {
  const _CheckRow({required this.check, required this.onNavigate});
  final PosReadinessCheck check;
  final void Function(PosModule module) onNavigate;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final (icon, color) = switch (check.status) {
      PosReadinessStatus.ok => (Icons.check_circle, palette.success),
      PosReadinessStatus.missing => (Icons.error, palette.error),
      PosReadinessStatus.warning => (Icons.warning, palette.warning),
      PosReadinessStatus.optionalMissing => (Icons.info, palette.textMuted),
      PosReadinessStatus.notApplicable => (Icons.remove_circle_outline, palette.textMuted),
    };
    final dim = check.status == PosReadinessStatus.notApplicable;
    final detail = posReadinessCheckDetail(
      code: check.code,
      status: check.status,
      count: check.count,
      required: check.required,
    );
    final actionable =
        check.status == PosReadinessStatus.missing ||
        check.status == PosReadinessStatus.warning ||
        check.status == PosReadinessStatus.optionalMissing;
    final module = actionable ? posReadinessSurfaceModule(check.surface) : null;
    return Card(
      key: Key('pos-readiness-row-${check.code}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: palette.border)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: color),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    posReadinessCheckTitle(check.code),
                    style: TextStyle(
                      color: dim ? palette.textMuted : palette.text,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  if (detail.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      style: TextStyle(color: dim ? palette.textMuted : palette.textSecondary, fontSize: 12),
                    ),
                  ],
                  if (check.items.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    for (final item in check.items)
                      Padding(
                        padding: const EdgeInsets.only(left: 4, bottom: 2),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('•  ', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                            Expanded(child: Text(item.label, style: TextStyle(color: palette.text, fontSize: 12))),
                          ],
                        ),
                      ),
                  ],
                  if (module != null) ...[
                    const SizedBox(height: 6),
                    TextButton(
                      key: Key('pos-readiness-cta-${check.code}'),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: const Size(0, 32),
                        alignment: Alignment.centerLeft,
                        foregroundColor: palette.action,
                      ),
                      onPressed: () => onNavigate(module),
                      child: Text(posReadinessSurfaceCta(check.surface)),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReadinessLoadingState extends StatelessWidget {
  const _ReadinessLoadingState();
  @override
  Widget build(BuildContext context) =>
      const Padding(padding: EdgeInsets.symmetric(vertical: 40), child: Center(child: CircularProgressIndicator()));
}

class _ReadinessFailureState extends StatelessWidget {
  const _ReadinessFailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Center(
        child: Column(
          children: [
            Text(message, style: TextStyle(color: palette.error, fontSize: 13), textAlign: TextAlign.center),
            const SizedBox(height: 10),
            OutlinedButton(key: const Key('pos-readiness-retry'), onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}

class _ReadinessPermissionState extends StatelessWidget {
  const _ReadinessPermissionState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.lock_outline, color: palette.textMuted, size: 28),
            const SizedBox(height: 8),
            Text(
              'Tu sesión no incluye el permiso de lectura requerido (branch.read).',
              key: const Key('pos-readiness-permission-denied'),
              style: TextStyle(color: palette.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
