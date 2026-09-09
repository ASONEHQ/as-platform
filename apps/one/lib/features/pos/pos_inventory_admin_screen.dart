/// TASK 15.1 Phase 3: "Inventario — Administración" — the real, permissioned
/// admin UI for the six backend inventory capabilities
/// `docs/RC_RELEASE_INVENTORY.md`'s INVENTORY section found with zero
/// Flutter UI (manual movement drafts/adjustments + posting, reservations,
/// physical counts, reconciliation findings/repairs, movement reversal,
/// branch-to-branch transfers), plus locations (its own bonus finding).
///
/// A single top-level, `SegmentedButton`-tabbed screen — mirrors
/// `PosPeopleScreen`'s own exact shape (this task's assigned structural
/// template): one gateway (`pos_inventory_admin_gateway.dart`), one
/// `_XxxTab` `StatefulWidget` per sub-domain, the same file-private
/// `_Card`/`_Loading`/`_Empty`/`_Failure`/`_PermissionDenied`/`_StatusPill`/
/// `_DetailRow`/`_DialogButtons` redeclarations `pos_people_screen.dart`'s
/// own top doc comment explains (those shapes are private to that file and
/// cannot be imported).
///
/// NON-NEGOTIABLE ARCHITECTURAL PRINCIPLE (from the task spec): the
/// inventory ledger stays the single source of truth. This screen NEVER
/// lets an operator directly edit a stock number — every stock change goes
/// through one of the real, audited, permissioned backend operations: a
/// movement draft/adjustment (reason REQUIRED by this UI on every create/
/// line/cancel/reversal, even where the backend's own JSON schema leaves a
/// header-level `reason_code` technically optional — see
/// `_MovementFormDialog`'s own doc comment), a reconciliation repair
/// (reason required), a transfer (source/destination real locations,
/// receive-confirmed), or a count-apply (reason required at count
/// creation). There is no "set quantity to X" control anywhere in this
/// file.
///
/// On "who/when authorized it": `movementJson()`
/// (`inventory-drafts.service.ts`) genuinely returns no actor id for a
/// movement's create/submit/post/cancel — only real timestamps
/// (`created_at`/`posted_at`/`cancelled_at`). This UI shows exactly those
/// real timestamps and never fabricates a "posted by" name the backend
/// doesn't return (unlike transfers/counts, whose own JSON DOES carry real
/// `*_by` actor ids — shown here verbatim where present).
///
/// Permission gating: each tab is gated on its own `inventory.read`
/// (whole-tab `_PermissionDenied` if missing); every mutating action inside
/// stays visible but individually disabled+`Tooltip`'d with the exact
/// missing permission code, mirroring `PosPeopleScreen`'s own convention —
/// never hidden, never a looser/stricter rule than the backend route guard
/// it mirrors (see each action's own doc comment for the exact code).
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_inventory_admin_gateway.dart';
import 'pos_tokens.dart';

/// The public entry point — importable from `pos_shell.dart`'s eventual
/// `PosModule` switch case (wired in separately afterward per this task's
/// own constraints).
class PosInventoryAdminScreen extends StatefulWidget {
  const PosInventoryAdminScreen({required this.context, required this.gateway, super.key});

  final AuthenticatedContext context;
  final PosInventoryAdminGateway gateway;

  @override
  State<PosInventoryAdminScreen> createState() => _PosInventoryAdminScreenState();
}

enum _InventoryTab { movimientos, traspasos, conteos, reservas, ajustes, ubicaciones }

class _PosInventoryAdminScreenState extends State<PosInventoryAdminScreen> {
  _InventoryTab _tab = _InventoryTab.movimientos;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _InventoryHeader(tab: _tab, onTabChanged: (value) => setState(() => _tab = value)),
      switch (_tab) {
        _InventoryTab.movimientos => _MovimientosTab(context: widget.context, gateway: widget.gateway),
        _InventoryTab.traspasos => _TraspasosTab(context: widget.context, gateway: widget.gateway),
        _InventoryTab.conteos => _ConteosTab(context: widget.context, gateway: widget.gateway),
        _InventoryTab.reservas => _ReservasTab(context: widget.context, gateway: widget.gateway),
        _InventoryTab.ajustes => _AjustesTab(context: widget.context, gateway: widget.gateway),
        _InventoryTab.ubicaciones => _UbicacionesTab(context: widget.context, gateway: widget.gateway),
      },
    ],
  );
}

class _InventoryHeader extends StatelessWidget {
  const _InventoryHeader({required this.tab, required this.onTabChanged});
  final _InventoryTab tab;
  final ValueChanged<_InventoryTab> onTabChanged;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.start,
        runSpacing: 10,
        children: [
          SizedBox(
            width: 420,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Inventario — Administración',
                  style: TextStyle(color: palette.text, fontSize: 22, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Text(
                  'Movimientos, traspasos, conteos, reservas y reconciliación — datos reales del backend.',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          SegmentedButton<_InventoryTab>(
            key: const Key('pos-inventory-admin-tabs'),
            segments: const [
              ButtonSegment(value: _InventoryTab.movimientos, label: Text('Movimientos')),
              ButtonSegment(value: _InventoryTab.traspasos, label: Text('Traspasos')),
              ButtonSegment(value: _InventoryTab.conteos, label: Text('Conteos')),
              ButtonSegment(value: _InventoryTab.reservas, label: Text('Reservas')),
              ButtonSegment(value: _InventoryTab.ajustes, label: Text('Ajustes/Reconciliación')),
              ButtonSegment(value: _InventoryTab.ubicaciones, label: Text('Ubicaciones')),
            ],
            selected: {tab},
            onSelectionChanged: (value) => onTabChanged(value.first),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------
// Shared, file-private widgets/helpers — small redeclarations of
// `pos_people_screen.dart`'s own private shapes (see this file's own top
// doc comment for why).
// ---------------------------------------------------------------------

enum _ListPhase { loading, empty, ready, failure }

class _Card extends StatelessWidget {
  const _Card({required this.child, this.padding = const EdgeInsets.all(14), super.key});
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
        boxShadow: [BoxShadow(color: palette.text.withValues(alpha: .06), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: child,
    );
  }
}

class _StateBlock extends StatelessWidget {
  const _StateBlock({required this.icon, required this.title, required this.message, this.action});
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      child: SizedBox(
        height: 160,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 34, color: palette.blueDeep),
              const SizedBox(height: 10),
              Text(title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800)),
              const SizedBox(height: 5),
              Text(message, textAlign: TextAlign.center, style: TextStyle(color: palette.textSecondary)),
              if (action != null) ...[const SizedBox(height: 8), action!],
            ],
          ),
        ),
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();
  @override
  Widget build(BuildContext context) =>
      const _Card(child: SizedBox(height: 160, child: Center(child: CircularProgressIndicator())));
}

class _Empty extends StatelessWidget {
  const _Empty({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => _StateBlock(icon: Icons.inbox_outlined, title: 'Sin información', message: message);
}

class _PermissionDenied extends StatelessWidget {
  const _PermissionDenied({this.permission});
  final String? permission;
  @override
  Widget build(BuildContext context) => _StateBlock(
    icon: Icons.lock_outline,
    title: 'Acceso no autorizado',
    message: permission == null
        ? 'Tu sesión no incluye el permiso de lectura requerido.'
        : 'Tu sesión no incluye el permiso $permission requerido.',
  );
}

class _Failure extends StatelessWidget {
  const _Failure({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => _StateBlock(
    icon: Icons.error_outline,
    title: 'No fue posible cargar',
    message: message,
    action: TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Reintentar')),
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});
  final String label;

  static const _positive = {'active', 'draft', 'posted', 'applied', 'confirmed', 'received', 'resolved'};
  static const _negative = {'cancelled', 'rejected', 'expired', 'dismissed'};

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final color = _negative.contains(label)
        ? palette.textMuted
        : _positive.contains(label)
        ? palette.success
        : palette.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 170, child: Text(label, style: TextStyle(color: palette.textMuted, fontSize: 11))),
          Expanded(child: Text(value, style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class _DialogButtons extends StatelessWidget {
  const _DialogButtons({
    required this.busy,
    required this.onCancel,
    required this.onSave,
    this.saveKey,
    this.saveLabel = 'Guardar',
    this.saveEnabled = true,
    this.disabledTooltip = '',
  });
  final bool busy;
  final VoidCallback onCancel;
  final VoidCallback onSave;
  final Key? saveKey;
  final String saveLabel;
  final bool saveEnabled;
  final String disabledTooltip;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: onCancel,
            style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
            child: const Text('Cancelar'),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Tooltip(
            message: saveEnabled ? '' : disabledTooltip,
            child: FilledButton(
              key: saveKey,
              onPressed: busy || !saveEnabled ? null : onSave,
              style: FilledButton.styleFrom(backgroundColor: palette.action),
              child: busy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(saveLabel),
            ),
          ),
        ),
      ],
    );
  }
}

/// A small reusable "action button that requires a free-text reason" —
/// every mutating action in this file that the backend requires a
/// `reason_code` for (cancel/reverse/dismiss/acknowledge/repair/release)
/// opens exactly this, never a bare confirm with no reason captured. Mirrors
/// `pos_shell.dart`'s own established free-text `reason_code` convention —
/// the backend has no fixed enum for any of these reasons (see e.g.
/// `pos_shell.dart:11536`'s own doc comment on refund reasons).
class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.title, required this.actionLabel, this.actionKey, this.body});
  final String title;
  final String actionLabel;
  final Key? actionKey;
  final String? body;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _reasonController = TextEditingController();
  final _noteController = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _confirm() {
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'El motivo es obligatorio.');
      return;
    }
    final note = _noteController.text.trim();
    Navigator.of(context).pop((reasonCode: reason, note: note.isEmpty ? null : note));
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(widget.title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
              if (widget.body != null) ...[
                const SizedBox(height: 8),
                Text(widget.body!, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
              ],
              const SizedBox(height: 14),
              TextField(
                key: const Key('pos-inventory-reason-field'),
                controller: _reasonController,
                decoration: const InputDecoration(isDense: true, labelText: 'Motivo (obligatorio)'),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('pos-inventory-reason-note-field'),
                controller: _noteController,
                maxLines: 2,
                decoration: const InputDecoration(isDense: true, labelText: 'Nota (opcional)'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: TextStyle(color: palette.error, fontSize: 12)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(null),
                      style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                      child: const Text('Cerrar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      key: widget.actionKey,
                      onPressed: _confirm,
                      style: FilledButton.styleFrom(backgroundColor: palette.error),
                      child: Text(widget.actionLabel),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Opens an [_ReasonDialog] and returns the entered `(reasonCode, note)`,
/// or `null` if the user closed it without confirming.
Future<({String reasonCode, String? note})?> _promptReason(
  BuildContext context, {
  required String title,
  required String actionLabel,
  Key? actionKey,
  String? body,
}) => showDialog<({String reasonCode, String? note})>(
  context: context,
  builder: (dialogContext) => _ReasonDialog(title: title, actionLabel: actionLabel, actionKey: actionKey, body: body),
);

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

String _formatOptionalDateTime(DateTime? value) => value == null ? '—' : _formatDateTime(value);

String _shortId(String id) => id.length <= 8 ? id : '${id.substring(0, 8)}…';

const _quantityDecoration = InputDecoration(isDense: true, labelText: 'Cantidad');

// =======================================================================
// Movimientos — manual movement drafts/adjustments + posting + reversal.
// Gated by `inventory.read`; mutations by `inventory.adjust`/
// `inventory.approve`/`inventory.reverse`.
// =======================================================================

class _MovimientosTab extends StatefulWidget {
  const _MovimientosTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosInventoryAdminGateway gateway;

  @override
  State<_MovimientosTab> createState() => _MovimientosTabState();
}

class _MovimientosTabState extends State<_MovimientosTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosInventoryMovement> _items = const [];
  String? _errorMessage;
  String _query = '';
  String _statusFilter = 'all';

  bool get _canRead => widget.context.permissions.contains('inventory.read');
  bool get _canAdjust => widget.context.permissions.contains('inventory.adjust');
  String? get _branchId => widget.context.session.branchId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listMovements(
        branchId: _branchId,
        status: _statusFilter == 'all' ? null : _statusFilter,
      );
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar los movimientos.';
      });
    }
  }

  List<PosInventoryMovement> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items
        .where(
          (movement) =>
              movement.movementNumber.toLowerCase().contains(query) ||
              (movement.reasonCode?.toLowerCase().contains(query) ?? false) ||
              (movement.notes?.toLowerCase().contains(query) ?? false),
        )
        .toList(growable: false);
  }

  Future<void> _openNewForm() async {
    final branchId = _branchId;
    if (branchId == null || !_canAdjust) return;
    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _MovementFormDialog(gateway: widget.gateway, branchId: branchId),
    );
    if (created == true) unawaited(_load());
  }

  Future<void> _openDetail(PosInventoryMovement movement) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _MovementDetailDialog(
        movement: movement,
        gateway: widget.gateway,
        canAdjust: _canAdjust,
        canApprove: widget.context.permissions.contains('inventory.approve'),
        canReverse: widget.context.permissions.contains('inventory.reverse'),
      ),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'inventory.read');
    final newDisabledReason = !_canAdjust
        ? 'Se requiere el permiso inventory.adjust.'
        : (_branchId == null ? 'Selecciona una sucursal para registrar movimientos.' : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-movements-search'),
                onChanged: (value) => setState(() => _query = value),
                decoration: const InputDecoration(isDense: true, hintText: 'Buscar por folio, motivo o notas', prefixIcon: Icon(Icons.search)),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-movements-status-filter'),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todos')),
                  DropdownMenuItem(value: 'draft', child: Text('Borrador')),
                  DropdownMenuItem(value: 'pending', child: Text('Pendiente')),
                  DropdownMenuItem(value: 'posted', child: Text('Contabilizado')),
                  DropdownMenuItem(value: 'cancelled', child: Text('Cancelado')),
                  DropdownMenuItem(value: 'reversed', child: Text('Revertido')),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value ?? 'all');
                  unawaited(_load());
                },
              ),
            ),
            const SizedBox(width: 10),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-movements-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.add_box_outlined, size: 16),
                label: const Text('Nuevo movimiento'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay movimientos de inventario registrados.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los movimientos.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final movement in _visibleItems)
                _MovementRow(movement: movement, onTap: () => unawaited(_openDetail(movement))),
            ],
          ),
        },
      ],
    );
  }
}

class _MovementRow extends StatelessWidget {
  const _MovementRow({required this.movement, required this.onTap});
  final PosInventoryMovement movement;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-movement-row-${movement.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(movement.movementNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      '${movement.movementType} · ${_formatDateTime(movement.occurredAt)}${movement.reasonCode == null ? '' : ' · ${movement.reasonCode}'}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              _StatusPill(label: movement.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

/// New-movement (header) dialog. `movement_type` is `opening_balance` |
/// `adjustment` (the only two `inventory-drafts.routes.ts` allows a caller
/// to create). [reasonController] is REQUIRED by this UI on every submit —
/// the backend's own header schema technically allows a `null`
/// `reason_code`, but this task's non-negotiable principle ("a draft/
/// adjustment with a required reason") governs the client-side rule here,
/// deliberately stricter than the bare route schema.
class _MovementFormDialog extends StatefulWidget {
  const _MovementFormDialog({required this.gateway, required this.branchId});
  final PosInventoryAdminGateway gateway;
  final String branchId;

  @override
  State<_MovementFormDialog> createState() => _MovementFormDialogState();
}

class _MovementFormDialogState extends State<_MovementFormDialog> {
  String _movementType = 'adjustment';
  final _reasonController = TextEditingController();
  final _sourceDocController = TextEditingController();
  final _notesController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    _sourceDocController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'El motivo es obligatorio para registrar un ajuste de inventario.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.createMovement(
        PosInventoryMovementHeaderInput(
          branchId: widget.branchId,
          movementType: _movementType,
          reasonCode: reason,
          sourceDocumentNumber: _sourceDocController.text.trim().isEmpty ? null : _sourceDocController.text.trim(),
          notes: _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible crear el movimiento.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Nuevo movimiento', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 4),
                Text(
                  'Un movimiento comienza como borrador: agrega líneas después de crearlo, luego envíalo y contabilízalo.',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const Key('pos-movement-form-type'),
                  initialValue: _movementType,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Tipo de movimiento'),
                  items: const [
                    DropdownMenuItem(value: 'adjustment', child: Text('Ajuste (merma, extravío, corrección)')),
                    DropdownMenuItem(value: 'opening_balance', child: Text('Saldo inicial')),
                  ],
                  onChanged: (value) => setState(() => _movementType = value ?? 'adjustment'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-movement-form-reason'),
                  controller: _reasonController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Motivo (obligatorio)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-movement-form-source-doc'),
                  controller: _sourceDocController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Documento de referencia (opcional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-movement-form-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-movement-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-movement-form-save'),
                  saveLabel: 'Crear borrador',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The movement detail view: header, real timestamps (never a fabricated
/// actor), lines, and every real transition (`addLine`/`deleteLine`/
/// `submit`/`post`/`cancel`/`reverse`) individually permission-gated.
class _MovementDetailDialog extends StatefulWidget {
  const _MovementDetailDialog({
    required this.movement,
    required this.gateway,
    required this.canAdjust,
    required this.canApprove,
    required this.canReverse,
  });
  final PosInventoryMovement movement;
  final PosInventoryAdminGateway gateway;
  final bool canAdjust;
  final bool canApprove;
  final bool canReverse;

  @override
  State<_MovementDetailDialog> createState() => _MovementDetailDialogState();
}

class _MovementDetailDialogState extends State<_MovementDetailDialog> {
  late PosInventoryMovement _movement = widget.movement;
  List<PosInventoryMovementLine> _lines = const [];
  bool _linesLoading = true;
  bool _busy = false;
  String? _error;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadLines());
  }

  Future<void> _loadLines() async {
    setState(() => _linesLoading = true);
    try {
      final lines = await widget.gateway.movementLines(_movement.id);
      if (!mounted) return;
      setState(() {
        _lines = lines;
        _linesLoading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _linesLoading = false);
    }
  }

  Future<void> _addLine() async {
    final input = await showDialog<PosInventoryMovementLineInput>(
      context: context,
      builder: (dialogContext) => _MovementLineFormDialog(gateway: widget.gateway, branchId: _movement.branchId),
    );
    if (input == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.gateway.addMovementLine(_movement.id, input, version: _movement.version);
      if (!mounted) return;
      setState(() {
        _lines = [..._lines, result.line];
        _busy = false;
        _changed = true;
      });
      unawaited(_refreshMovement());
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible agregar la línea.';
      });
    }
  }

  Future<void> _deleteLine(PosInventoryMovementLine line) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.deleteMovementLine(_movement.id, line.id, version: _movement.version);
      if (!mounted) return;
      setState(() {
        _lines = _lines.where((value) => value.id != line.id).toList(growable: false);
        _busy = false;
        _changed = true;
      });
      unawaited(_refreshMovement());
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible eliminar la línea.';
      });
    }
  }

  Future<void> _refreshMovement() async {
    try {
      final refreshed = await widget.gateway.movement(_movement.id);
      if (!mounted) return;
      setState(() => _movement = refreshed);
    } on Object {
      // The mutation itself already succeeded and the caller's own list
      // refresh (triggered by `_changed` on close) shows the real result —
      // this refetch failing just keeps the dialog's own copy stale.
    }
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.gateway.submitMovement(_movement.id, version: _movement.version);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _changed = true;
      });
      unawaited(_refreshAfter(result.version));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible enviar el movimiento.';
      });
    }
  }

  Future<void> _post() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.postMovement(_movement.id, version: _movement.version);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _changed = true;
      });
      unawaited(_refreshMovement());
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible contabilizar el movimiento.';
      });
    }
  }

  Future<void> _refreshAfter(int version) async {
    unawaited(_refreshMovement());
  }

  Future<void> _cancel() async {
    final reason = await _promptReason(
      context,
      title: 'Cancelar movimiento',
      actionLabel: 'Cancelar movimiento',
      actionKey: const Key('pos-movement-cancel-confirm'),
      body: 'El movimiento quedará marcado como cancelado de forma permanente.',
    );
    if (reason == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await widget.gateway.cancelMovement(
        _movement.id,
        version: _movement.version,
        reasonCode: reason.reasonCode,
        note: reason.note,
      );
      if (!mounted) return;
      setState(() {
        _movement = updated;
        _busy = false;
        _changed = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible cancelar el movimiento.';
      });
    }
  }

  Future<void> _reverse() async {
    final reason = await _promptReason(
      context,
      title: 'Revertir movimiento',
      actionLabel: 'Revertir movimiento',
      actionKey: const Key('pos-movement-reverse-confirm'),
      body: 'Se creará un nuevo movimiento de reversión real que anula el efecto en el saldo — el original nunca se edita.',
    );
    if (reason == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.reverseMovement(
        _movement.id,
        version: _movement.version,
        reasonCode: reason.reasonCode,
        note: reason.note,
      );
      if (!mounted) return;
      setState(() => _changed = true);
      unawaited(_refreshMovement());
      setState(() => _busy = false);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible revertir el movimiento.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final canAdjustHere = widget.canAdjust;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(_movement.movementNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                    ),
                    _StatusPill(label: _movement.status),
                  ],
                ),
                const SizedBox(height: 10),
                _DetailRow(label: 'Tipo', value: _movement.movementType),
                _DetailRow(label: 'Motivo', value: _movement.reasonCode ?? '—'),
                _DetailRow(label: 'Notas', value: _movement.notes ?? '—'),
                _DetailRow(label: 'Ocurrido', value: _formatDateTime(_movement.occurredAt)),
                _DetailRow(label: 'Creado', value: _formatDateTime(_movement.createdAt)),
                _DetailRow(label: 'Contabilizado', value: _formatOptionalDateTime(_movement.postedAt)),
                _DetailRow(label: 'Cancelado', value: _formatOptionalDateTime(_movement.cancelledAt)),
                _DetailRow(label: 'Revertido', value: _formatOptionalDateTime(_movement.reversedAt)),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Text('Líneas', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const Spacer(),
                    if (_movement.isEditable)
                      Tooltip(
                        message: canAdjustHere ? '' : 'Se requiere el permiso inventory.adjust.',
                        child: TextButton.icon(
                          key: const Key('pos-movement-detail-add-line'),
                          onPressed: canAdjustHere ? () => unawaited(_addLine()) : null,
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text('Agregar línea'),
                        ),
                      ),
                  ],
                ),
                if (_linesLoading) const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator()),
                if (!_linesLoading && _lines.isEmpty)
                  Text('Sin líneas todavía.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
                for (final line in _lines)
                  Padding(
                    key: Key('pos-movement-line-row-${line.id}'),
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${_shortId(line.productVariantId)} · ${line.quantity} ${line.unitOfMeasureCode}'
                            '${line.reasonCode == null ? '' : ' · ${line.reasonCode}'}',
                            style: TextStyle(color: palette.text, fontSize: 12),
                          ),
                        ),
                        if (_movement.isEditable)
                          Tooltip(
                            message: canAdjustHere ? '' : 'Se requiere el permiso inventory.adjust.',
                            child: IconButton(
                              key: Key('pos-movement-line-delete-${line.id}'),
                              onPressed: canAdjustHere ? () => unawaited(_deleteLine(line)) : null,
                              icon: const Icon(Icons.delete_outline, size: 18),
                            ),
                          ),
                      ],
                    ),
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-movement-detail-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (_movement.status == 'draft')
                      Tooltip(
                        message: canAdjustHere ? '' : 'Se requiere el permiso inventory.adjust.',
                        child: FilledButton(
                          key: const Key('pos-movement-detail-submit'),
                          onPressed: canAdjustHere && !_busy ? () => unawaited(_submit()) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.action),
                          child: const Text('Enviar'),
                        ),
                      ),
                    if (_movement.status == 'pending')
                      Tooltip(
                        message: widget.canApprove ? '' : 'Se requiere el permiso inventory.approve.',
                        child: FilledButton(
                          key: const Key('pos-movement-detail-post'),
                          onPressed: widget.canApprove && !_busy ? () => unawaited(_post()) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.success),
                          child: const Text('Aprobar y contabilizar'),
                        ),
                      ),
                    if (_movement.isEditable)
                      Tooltip(
                        message: canAdjustHere ? '' : 'Se requiere el permiso inventory.adjust.',
                        child: OutlinedButton(
                          key: const Key('pos-movement-detail-cancel'),
                          onPressed: canAdjustHere && !_busy ? () => unawaited(_cancel()) : null,
                          style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
                          child: const Text('Cancelar movimiento'),
                        ),
                      ),
                    if (_movement.isPosted)
                      Tooltip(
                        message: widget.canReverse ? '' : 'Se requiere el permiso inventory.reverse.',
                        child: OutlinedButton(
                          key: const Key('pos-movement-detail-reverse'),
                          onPressed: widget.canReverse && !_busy ? () => unawaited(_reverse()) : null,
                          style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
                          child: const Text('Revertir'),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => Navigator.of(context).pop(_changed),
                    child: const Text('Cerrar'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The add-line form — a variant picker sourced from REAL on-hand balances
/// at the movement's branch (never a fabricated product search), a
/// quantity, and a REQUIRED reason.
class _MovementLineFormDialog extends StatefulWidget {
  const _MovementLineFormDialog({required this.gateway, required this.branchId});
  final PosInventoryAdminGateway gateway;
  final String branchId;

  @override
  State<_MovementLineFormDialog> createState() => _MovementLineFormDialogState();
}

class _MovementLineFormDialogState extends State<_MovementLineFormDialog> {
  List<PosInventoryBalance> _balances = const [];
  bool _loadingBalances = true;
  PosInventoryBalance? _selected;
  final _quantityController = TextEditingController();
  final _reasonController = TextEditingController();
  bool _increase = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadBalances());
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadBalances() async {
    try {
      final page = await widget.gateway.listBalances(branchId: widget.branchId);
      if (!mounted) return;
      setState(() {
        _balances = page.items;
        _loadingBalances = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _loadingBalances = false);
    }
  }

  void _submit() {
    final selected = _selected;
    final quantity = _quantityController.text.trim();
    final reason = _reasonController.text.trim();
    if (selected == null) {
      setState(() => _error = 'Selecciona un producto con existencia real.');
      return;
    }
    if (quantity.isEmpty || double.tryParse(quantity) == null) {
      setState(() => _error = 'Ingresa una cantidad válida.');
      return;
    }
    if (reason.isEmpty) {
      setState(() => _error = 'El motivo de la línea es obligatorio.');
      return;
    }
    Navigator.of(context).pop(
      PosInventoryMovementLineInput(
        productVariantId: selected.productVariantId,
        quantity: quantity,
        unitOfMeasureCode: selected.unitOfMeasureCode,
        sourceLocationId: _increase ? null : selected.locationId,
        destinationLocationId: _increase ? selected.locationId : null,
        reasonCode: reason,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Agregar línea', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 14),
                if (_loadingBalances) const LinearProgressIndicator(),
                if (!_loadingBalances && _balances.isEmpty)
                  Text('No hay existencias registradas en esta sucursal todavía.', style: TextStyle(color: palette.textMuted, fontSize: 12)),
                if (!_loadingBalances && _balances.isNotEmpty)
                  DropdownButtonFormField<String>(
                    key: const Key('pos-movement-line-form-variant'),
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Producto'),
                    items: [
                      for (final balance in _balances)
                        DropdownMenuItem(value: balance.productVariantId, child: Text(balance.displayName, overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (value) => setState(() => _selected = _balances.firstWhere((balance) => balance.productVariantId == value)),
                  ),
                const SizedBox(height: 10),
                SegmentedButton<bool>(
                  key: const Key('pos-movement-line-form-direction'),
                  segments: const [
                    ButtonSegment(value: true, label: Text('Aumentar')),
                    ButtonSegment(value: false, label: Text('Disminuir')),
                  ],
                  selected: {_increase},
                  onSelectionChanged: (value) => setState(() => _increase = value.first),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-movement-line-form-quantity'),
                  controller: _quantityController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: _quantityDecoration,
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-movement-line-form-reason'),
                  controller: _reasonController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Motivo de la línea (obligatorio)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-movement-line-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: false,
                  onCancel: () => Navigator.of(context).pop(),
                  onSave: _submit,
                  saveKey: const Key('pos-movement-line-form-save'),
                  saveLabel: 'Agregar',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// =======================================================================
// Traspasos — branch-to-branch transfers. Gated by `inventory.read`;
// mutations by `inventory.transfer`/`inventory.approve`/`inventory.receive`.
// =======================================================================

class _TraspasosTab extends StatefulWidget {
  const _TraspasosTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosInventoryAdminGateway gateway;

  @override
  State<_TraspasosTab> createState() => _TraspasosTabState();
}

class _TraspasosTabState extends State<_TraspasosTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosInventoryTransfer> _items = const [];
  String? _errorMessage;
  String _query = '';
  String _statusFilter = 'all';

  bool get _canRead => widget.context.permissions.contains('inventory.read');
  bool get _canTransfer => widget.context.permissions.contains('inventory.transfer');
  bool get _canApprove => widget.context.permissions.contains('inventory.approve');
  bool get _canReceive => widget.context.permissions.contains('inventory.receive');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listTransfers(status: _statusFilter == 'all' ? null : _statusFilter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar los traspasos.';
      });
    }
  }

  List<PosInventoryTransfer> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items.where((transfer) => transfer.transferNumber.toLowerCase().contains(query)).toList(growable: false);
  }

  Future<void> _openNewForm() async {
    if (!_canTransfer) return;
    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _TransferFormDialog(gateway: widget.gateway, branches: widget.context.branches),
    );
    if (created == true) unawaited(_load());
  }

  Future<void> _openDetail(PosInventoryTransfer transfer) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _TransferDetailDialog(
        transfer: transfer,
        gateway: widget.gateway,
        canTransfer: _canTransfer,
        canApprove: _canApprove,
        canReceive: _canReceive,
      ),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'inventory.read');
    final newDisabledReason = _canTransfer ? '' : 'Se requiere el permiso inventory.transfer.';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-transfers-search'),
                onChanged: (value) => setState(() => _query = value),
                decoration: const InputDecoration(isDense: true, hintText: 'Buscar por folio', prefixIcon: Icon(Icons.search)),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-transfers-status-filter'),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todos')),
                  DropdownMenuItem(value: 'requested', child: Text('Solicitado')),
                  DropdownMenuItem(value: 'approved', child: Text('Aprobado')),
                  DropdownMenuItem(value: 'shipped', child: Text('Enviado')),
                  DropdownMenuItem(value: 'received', child: Text('Recibido')),
                  DropdownMenuItem(value: 'rejected', child: Text('Rechazado')),
                  DropdownMenuItem(value: 'cancelled', child: Text('Cancelado')),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value ?? 'all');
                  unawaited(_load());
                },
              ),
            ),
            const SizedBox(width: 10),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-transfers-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.compare_arrows_outlined, size: 16),
                label: const Text('Nuevo traspaso'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay traspasos entre sucursales registrados.'),
          _ListPhase.failure => _Failure(message: _errorMessage ?? 'No fue posible cargar los traspasos.', onRetry: () => unawaited(_load())),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final transfer in _visibleItems) _TransferRow(transfer: transfer, onTap: () => unawaited(_openDetail(transfer)))],
          ),
        },
      ],
    );
  }
}

class _TransferRow extends StatelessWidget {
  const _TransferRow({required this.transfer, required this.onTap});
  final PosInventoryTransfer transfer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-transfer-row-${transfer.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(transfer.transferNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      '${_shortId(transfer.sourceBranchId)} → ${_shortId(transfer.destinationBranchId)} · ${_formatDateTime(transfer.requestedAt)}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              _StatusPill(label: transfer.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _TransferFormDialog extends StatefulWidget {
  const _TransferFormDialog({required this.gateway, required this.branches});
  final PosInventoryAdminGateway gateway;
  final List<BranchSummary> branches;

  @override
  State<_TransferFormDialog> createState() => _TransferFormDialogState();
}

class _TransferFormDialogState extends State<_TransferFormDialog> {
  String? _sourceBranchId;
  String? _destinationBranchId;
  List<PosInventoryLocation> _sourceLocations = const [];
  List<PosInventoryLocation> _destinationLocations = const [];
  List<PosInventoryBalance> _sourceBalances = const [];
  String? _sourceLocationId;
  String? _destinationLocationId;
  String? _transitLocationId;
  PosInventoryBalance? _selectedBalance;
  final _quantityController = TextEditingController();
  final _notesController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _sourceBranchId = widget.branches.where((branch) => branch.current).firstOrNull?.id ?? widget.branches.firstOrNull?.id;
    if (_sourceBranchId != null) unawaited(_loadSource(_sourceBranchId!));
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _loadSource(String branchId) async {
    try {
      final locations = await widget.gateway.listLocations(branchId: branchId);
      final balances = await widget.gateway.listBalances(branchId: branchId);
      if (!mounted) return;
      setState(() {
        _sourceLocations = locations.items;
        _sourceBalances = balances.items;
        _sourceLocationId = null;
        _transitLocationId = null;
        _selectedBalance = null;
      });
    } on Object {
      // Real, already-fetched dropdowns just stay empty on failure — no
      // fabricated fallback list.
    }
  }

  Future<void> _loadDestination(String branchId) async {
    try {
      final locations = await widget.gateway.listLocations(branchId: branchId);
      if (!mounted) return;
      setState(() {
        _destinationLocations = locations.items;
        _destinationLocationId = null;
      });
    } on Object {
      // See `_loadSource`'s own note.
    }
  }

  Future<void> _submit() async {
    final sourceBranch = _sourceBranchId;
    final destinationBranch = _destinationBranchId;
    final sourceLocation = _sourceLocationId;
    final destinationLocation = _destinationLocationId;
    final transitLocation = _transitLocationId;
    final balance = _selectedBalance;
    final quantity = _quantityController.text.trim();
    if (sourceBranch == null || destinationBranch == null || sourceBranch == destinationBranch) {
      setState(() => _error = 'Selecciona dos sucursales distintas.');
      return;
    }
    if (sourceLocation == null || destinationLocation == null || transitLocation == null) {
      setState(() => _error = 'Selecciona las tres ubicaciones (origen, destino y tránsito).');
      return;
    }
    if (balance == null) {
      setState(() => _error = 'Selecciona un producto con existencia real en la sucursal origen.');
      return;
    }
    if (quantity.isEmpty || double.tryParse(quantity) == null) {
      setState(() => _error = 'Ingresa una cantidad válida.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.createTransfer(
        PosInventoryTransferCreateInput(
          sourceBranchId: sourceBranch,
          destinationBranchId: destinationBranch,
          sourceLocationId: sourceLocation,
          destinationLocationId: destinationLocation,
          transitLocationId: transitLocation,
          notes: _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
          lines: [
            PosInventoryTransferLineInput(productVariantId: balance.productVariantId, quantity: quantity, unitOfMeasureCode: balance.unitOfMeasureCode),
          ],
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible crear el traspaso.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480, maxHeight: 680),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Nuevo traspaso', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const Key('pos-transfer-form-source-branch'),
                  initialValue: _sourceBranchId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Sucursal origen'),
                  items: [for (final branch in widget.branches) DropdownMenuItem(value: branch.id, child: Text(branch.name))],
                  onChanged: (value) {
                    setState(() => _sourceBranchId = value);
                    if (value != null) unawaited(_loadSource(value));
                  },
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('pos-transfer-form-destination-branch'),
                  initialValue: _destinationBranchId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Sucursal destino'),
                  items: [for (final branch in widget.branches) DropdownMenuItem(value: branch.id, child: Text(branch.name))],
                  onChanged: (value) {
                    setState(() => _destinationBranchId = value);
                    if (value != null) unawaited(_loadDestination(value));
                  },
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('pos-transfer-form-source-location'),
                  initialValue: _sourceLocationId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Ubicación origen'),
                  items: [for (final location in _sourceLocations) DropdownMenuItem(value: location.id, child: Text(location.name))],
                  onChanged: (value) => setState(() => _sourceLocationId = value),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('pos-transfer-form-transit-location'),
                  initialValue: _transitLocationId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Ubicación de tránsito'),
                  items: [for (final location in _sourceLocations) DropdownMenuItem(value: location.id, child: Text(location.name))],
                  onChanged: (value) => setState(() => _transitLocationId = value),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('pos-transfer-form-destination-location'),
                  initialValue: _destinationLocationId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Ubicación destino'),
                  items: [for (final location in _destinationLocations) DropdownMenuItem(value: location.id, child: Text(location.name))],
                  onChanged: (value) => setState(() => _destinationLocationId = value),
                ),
                const SizedBox(height: 10),
                if (_sourceBalances.isEmpty)
                  Text('No hay existencias registradas en la sucursal origen.', style: TextStyle(color: palette.textMuted, fontSize: 12))
                else
                  DropdownButtonFormField<String>(
                    key: const Key('pos-transfer-form-variant'),
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Producto'),
                    items: [
                      for (final balance in _sourceBalances)
                        DropdownMenuItem(value: balance.productVariantId, child: Text(balance.displayName, overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (value) => setState(() => _selectedBalance = _sourceBalances.firstWhere((balance) => balance.productVariantId == value)),
                  ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-transfer-form-quantity'),
                  controller: _quantityController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: _quantityDecoration,
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-transfer-form-notes'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Notas (opcional)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-transfer-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-transfer-form-save'),
                  saveLabel: 'Solicitar traspaso',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TransferDetailDialog extends StatefulWidget {
  const _TransferDetailDialog({
    required this.transfer,
    required this.gateway,
    required this.canTransfer,
    required this.canApprove,
    required this.canReceive,
  });
  final PosInventoryTransfer transfer;
  final PosInventoryAdminGateway gateway;
  final bool canTransfer;
  final bool canApprove;
  final bool canReceive;

  @override
  State<_TransferDetailDialog> createState() => _TransferDetailDialogState();
}

class _TransferDetailDialogState extends State<_TransferDetailDialog> {
  late PosInventoryTransfer _transfer = widget.transfer;
  bool _busy = false;
  String? _error;
  bool _changed = false;

  Future<void> _run(Future<PosInventoryTransfer> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await action();
      if (!mounted) return;
      setState(() {
        _transfer = updated;
        _busy = false;
        _changed = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible actualizar el traspaso.';
      });
    }
  }

  Future<void> _reject() async {
    final reason = await _promptReason(context, title: 'Rechazar traspaso', actionLabel: 'Rechazar', actionKey: const Key('pos-transfer-reject-confirm'));
    if (reason == null) return;
    await _run(
      () => widget.gateway.decideTransfer(
        _transfer.id,
        version: _transfer.version,
        decision: 'reject',
        reasonCode: reason.reasonCode,
        note: reason.note,
      ),
    );
  }

  Future<void> _cancel() async {
    final reason = await _promptReason(context, title: 'Cancelar traspaso', actionLabel: 'Cancelar traspaso', actionKey: const Key('pos-transfer-cancel-confirm'));
    if (reason == null) return;
    await _run(
      () => widget.gateway.cancelTransfer(_transfer.id, version: _transfer.version, reasonCode: reason.reasonCode, note: reason.note),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520, maxHeight: 680),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(_transfer.transferNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16))),
                    _StatusPill(label: _transfer.status),
                  ],
                ),
                const SizedBox(height: 10),
                _DetailRow(label: 'Sucursal origen', value: _shortId(_transfer.sourceBranchId)),
                _DetailRow(label: 'Sucursal destino', value: _shortId(_transfer.destinationBranchId)),
                _DetailRow(label: 'Solicitado', value: _formatDateTime(_transfer.requestedAt)),
                _DetailRow(label: 'Aprobado', value: _formatOptionalDateTime(_transfer.approvedAt)),
                _DetailRow(label: 'Enviado', value: _formatOptionalDateTime(_transfer.shippedAt)),
                _DetailRow(label: 'Recibido', value: _formatOptionalDateTime(_transfer.receivedAt)),
                _DetailRow(label: 'Notas', value: _transfer.notes ?? '—'),
                const SizedBox(height: 12),
                Text('Líneas', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                for (final line in _transfer.lines)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      '${_shortId(line.productVariantId)} · ${line.quantity} ${line.unitOfMeasureCode}'
                      '${line.shippedQuantity == null ? '' : ' · enviado ${line.shippedQuantity}'}'
                      '${line.receivedQuantity == null ? '' : ' · recibido ${line.receivedQuantity}'}',
                      style: TextStyle(color: palette.text, fontSize: 12),
                    ),
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-transfer-detail-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (_transfer.status == 'requested')
                      Tooltip(
                        message: widget.canApprove ? '' : 'Se requiere el permiso inventory.approve.',
                        child: FilledButton(
                          key: const Key('pos-transfer-detail-approve'),
                          onPressed: widget.canApprove && !_busy
                              ? () => unawaited(_run(() => widget.gateway.decideTransfer(_transfer.id, version: _transfer.version, decision: 'approve')))
                              : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.success),
                          child: const Text('Aprobar'),
                        ),
                      ),
                    if (_transfer.status == 'requested')
                      Tooltip(
                        message: widget.canApprove ? '' : 'Se requiere el permiso inventory.approve.',
                        child: OutlinedButton(
                          key: const Key('pos-transfer-detail-reject'),
                          onPressed: widget.canApprove && !_busy ? () => unawaited(_reject()) : null,
                          style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
                          child: const Text('Rechazar'),
                        ),
                      ),
                    if (_transfer.status == 'approved')
                      Tooltip(
                        message: widget.canTransfer ? '' : 'Se requiere el permiso inventory.transfer.',
                        child: FilledButton(
                          key: const Key('pos-transfer-detail-ship'),
                          onPressed: widget.canTransfer && !_busy ? () => unawaited(_run(() => widget.gateway.shipTransfer(_transfer.id, version: _transfer.version))) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.action),
                          child: const Text('Marcar enviado'),
                        ),
                      ),
                    if (_transfer.status == 'shipped')
                      Tooltip(
                        message: widget.canReceive ? '' : 'Se requiere el permiso inventory.receive.',
                        child: FilledButton(
                          key: const Key('pos-transfer-detail-receive'),
                          onPressed: widget.canReceive && !_busy ? () => unawaited(_run(() => widget.gateway.receiveTransfer(_transfer.id, version: _transfer.version))) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.success),
                          child: const Text('Confirmar recepción'),
                        ),
                      ),
                    if (_transfer.status == 'requested' || _transfer.status == 'approved')
                      Tooltip(
                        message: widget.canTransfer ? '' : 'Se requiere el permiso inventory.transfer.',
                        child: OutlinedButton(
                          key: const Key('pos-transfer-detail-cancel'),
                          onPressed: widget.canTransfer && !_busy ? () => unawaited(_cancel()) : null,
                          style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
                          child: const Text('Cancelar'),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => Navigator.of(context).pop(_changed), child: const Text('Cerrar'))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// =======================================================================
// Conteos — physical inventory counts. Gated by `inventory.read`;
// mutations by `inventory.count`/`inventory.approve`.
// =======================================================================

class _ConteosTab extends StatefulWidget {
  const _ConteosTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosInventoryAdminGateway gateway;

  @override
  State<_ConteosTab> createState() => _ConteosTabState();
}

class _ConteosTabState extends State<_ConteosTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosInventoryCount> _items = const [];
  String? _errorMessage;
  String _query = '';
  String _statusFilter = 'all';

  bool get _canRead => widget.context.permissions.contains('inventory.read');
  bool get _canCount => widget.context.permissions.contains('inventory.count');
  bool get _canApprove => widget.context.permissions.contains('inventory.approve');
  String? get _branchId => widget.context.session.branchId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listCounts(branchId: _branchId, status: _statusFilter == 'all' ? null : _statusFilter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar los conteos.';
      });
    }
  }

  List<PosInventoryCount> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items.where((count) => count.countNumber.toLowerCase().contains(query)).toList(growable: false);
  }

  Future<void> _openNewForm() async {
    final branchId = _branchId;
    if (branchId == null || !_canCount) return;
    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CountFormDialog(gateway: widget.gateway, branchId: branchId),
    );
    if (created == true) unawaited(_load());
  }

  Future<void> _openDetail(PosInventoryCount count) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _CountDetailDialog(count: count, gateway: widget.gateway, canCount: _canCount, canApprove: _canApprove),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'inventory.read');
    final newDisabledReason = !_canCount
        ? 'Se requiere el permiso inventory.count.'
        : (_branchId == null ? 'Selecciona una sucursal para iniciar un conteo.' : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-counts-search'),
                onChanged: (value) => setState(() => _query = value),
                decoration: const InputDecoration(isDense: true, hintText: 'Buscar por folio', prefixIcon: Icon(Icons.search)),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-counts-status-filter'),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todos')),
                  DropdownMenuItem(value: 'draft', child: Text('Borrador')),
                  DropdownMenuItem(value: 'counting', child: Text('Contando')),
                  DropdownMenuItem(value: 'submitted', child: Text('Enviado')),
                  DropdownMenuItem(value: 'approved', child: Text('Aprobado')),
                  DropdownMenuItem(value: 'applied', child: Text('Aplicado')),
                  DropdownMenuItem(value: 'cancelled', child: Text('Cancelado')),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value ?? 'all');
                  unawaited(_load());
                },
              ),
            ),
            const SizedBox(width: 10),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-counts-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.checklist_outlined, size: 16),
                label: const Text('Nuevo conteo'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay conteos físicos registrados.'),
          _ListPhase.failure => _Failure(message: _errorMessage ?? 'No fue posible cargar los conteos.', onRetry: () => unawaited(_load())),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final count in _visibleItems) _CountRow(count: count, onTap: () => unawaited(_openDetail(count)))],
          ),
        },
      ],
    );
  }
}

class _CountRow extends StatelessWidget {
  const _CountRow({required this.count, required this.onTap});
  final PosInventoryCount count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-count-row-${count.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(count.countNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text('${count.scopeType} · ${count.reasonCode}', style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                  ],
                ),
              ),
              _StatusPill(label: count.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _CountFormDialog extends StatefulWidget {
  const _CountFormDialog({required this.gateway, required this.branchId});
  final PosInventoryAdminGateway gateway;
  final String branchId;

  @override
  State<_CountFormDialog> createState() => _CountFormDialogState();
}

class _CountFormDialogState extends State<_CountFormDialog> {
  List<PosInventoryLocation> _locations = const [];
  String? _locationId;
  String _scopeType = 'all_balanced_variants';
  final _reasonController = TextEditingController();
  final _noteController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadLocations());
  }

  @override
  void dispose() {
    _reasonController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _loadLocations() async {
    try {
      final page = await widget.gateway.listLocations(branchId: widget.branchId, status: 'active');
      if (!mounted) return;
      setState(() => _locations = page.items);
    } on Object {
      // The location dropdown just stays empty on a real failure — no
      // fabricated fallback list.
    }
  }

  Future<void> _submit() async {
    final locationId = _locationId;
    final reason = _reasonController.text.trim();
    if (locationId == null) {
      setState(() => _error = 'Selecciona una ubicación real.');
      return;
    }
    if (reason.isEmpty) {
      setState(() => _error = 'El motivo del conteo es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.createCount(
        PosInventoryCountCreateInput(
          branchId: widget.branchId,
          locationId: locationId,
          scopeType: _scopeType,
          reasonCode: reason,
          note: _noteController.text.trim().isEmpty ? null : _noteController.text.trim(),
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible crear el conteo.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Nuevo conteo físico', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 4),
                Text(
                  'El conteo toma una fotografía del saldo esperado al iniciarlo; todo ajuste real se aplica solo al aprobar.',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const Key('pos-count-form-location'),
                  initialValue: _locationId,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Ubicación a contar'),
                  items: [for (final location in _locations) DropdownMenuItem(value: location.id, child: Text(location.name))],
                  onChanged: (value) => setState(() => _locationId = value),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: const Key('pos-count-form-scope'),
                  initialValue: _scopeType,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Alcance'),
                  items: const [
                    DropdownMenuItem(value: 'all_balanced_variants', child: Text('Todos los productos con saldo')),
                    DropdownMenuItem(value: 'explicit_variants', child: Text('Productos específicos (elegidos al iniciar)')),
                  ],
                  onChanged: (value) => setState(() => _scopeType = value ?? 'all_balanced_variants'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-count-form-reason'),
                  controller: _reasonController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Motivo (obligatorio)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-count-form-note'),
                  controller: _noteController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nota (opcional)'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-count-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-count-form-save'),
                  saveLabel: 'Crear conteo',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CountDetailDialog extends StatefulWidget {
  const _CountDetailDialog({required this.count, required this.gateway, required this.canCount, required this.canApprove});
  final PosInventoryCount count;
  final PosInventoryAdminGateway gateway;
  final bool canCount;
  final bool canApprove;

  @override
  State<_CountDetailDialog> createState() => _CountDetailDialogState();
}

class _CountDetailDialogState extends State<_CountDetailDialog> {
  late PosInventoryCount _count = widget.count;
  bool _busy = false;
  String? _error;
  bool _changed = false;
  final Map<String, TextEditingController> _lineControllers = {};

  TextEditingController _controllerFor(PosInventoryCountLine line) =>
      _lineControllers.putIfAbsent(line.productVariantId, () => TextEditingController(text: line.countedQuantity ?? ''));

  @override
  void dispose() {
    for (final controller in _lineControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final refreshed = await widget.gateway.count(_count.id);
      if (!mounted) return;
      setState(() => _count = refreshed);
    } on Object {
      // The mutation itself already succeeded; the caller's own list
      // refresh (via `_changed`) shows the real result regardless.
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _changed = true;
      });
      unawaited(_refresh());
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible actualizar el conteo.';
      });
    }
  }

  Future<void> _saveLine(PosInventoryCountLine line) async {
    final controller = _controllerFor(line);
    final value = controller.text.trim();
    if (value.isEmpty || double.tryParse(value) == null) {
      setState(() => _error = 'Ingresa una cantidad contada válida.');
      return;
    }
    await _run(
      () => widget.gateway.recordCountLine(
        _count.id,
        line.productVariantId,
        countedQuantity: value,
        unitOfMeasureCode: line.unitOfMeasureCode,
        version: _count.version,
      ),
    );
  }

  Future<void> _cancel() async {
    final reason = await _promptReason(context, title: 'Cancelar conteo', actionLabel: 'Cancelar conteo', actionKey: const Key('pos-count-cancel-confirm'));
    if (reason == null) return;
    await _run(() => widget.gateway.cancelCount(_count.id, version: _count.version, reasonCode: reason.reasonCode, note: reason.note));
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(_count.countNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16))),
                    _StatusPill(label: _count.status),
                  ],
                ),
                const SizedBox(height: 10),
                _DetailRow(label: 'Motivo', value: _count.reasonCode),
                _DetailRow(label: 'Alcance', value: _count.scopeType),
                _DetailRow(label: 'Iniciado', value: _formatOptionalDateTime(_count.startedAt)),
                _DetailRow(label: 'Enviado', value: _formatOptionalDateTime(_count.submittedAt)),
                _DetailRow(label: 'Aprobado', value: _formatOptionalDateTime(_count.approvedAt)),
                _DetailRow(label: 'Aplicado', value: _formatOptionalDateTime(_count.appliedAt)),
                if (_count.lineCount != null)
                  _DetailRow(
                    label: 'Líneas',
                    value: '${_count.lineCount} total · ${_count.uncountedLineCount ?? 0} sin contar · ${_count.discrepancyLineCount ?? 0} con diferencia',
                  ),
                const SizedBox(height: 12),
                if (_count.status == 'counting' || _count.lines.isNotEmpty) ...[
                  Text('Líneas del conteo', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  for (final line in _count.lines)
                    Padding(
                      key: Key('pos-count-line-row-${line.productVariantId}'),
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: Text(
                              '${_shortId(line.productVariantId)} · esperado ${line.expectedQuantity}',
                              style: TextStyle(color: palette.text, fontSize: 12),
                            ),
                          ),
                          if (_count.status == 'counting') ...[
                            SizedBox(
                              width: 100,
                              child: TextField(
                                key: Key('pos-count-line-input-${line.productVariantId}'),
                                controller: _controllerFor(line),
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                decoration: const InputDecoration(isDense: true, labelText: 'Contado'),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Tooltip(
                              message: widget.canCount ? '' : 'Se requiere el permiso inventory.count.',
                              child: IconButton(
                                key: Key('pos-count-line-save-${line.productVariantId}'),
                                onPressed: widget.canCount && !_busy ? () => unawaited(_saveLine(line)) : null,
                                icon: const Icon(Icons.save_outlined, size: 18),
                              ),
                            ),
                          ] else
                            Text(line.countedQuantity ?? '—', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                        ],
                      ),
                    ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-count-detail-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (_count.status == 'draft')
                      Tooltip(
                        message: widget.canCount ? '' : 'Se requiere el permiso inventory.count.',
                        child: FilledButton(
                          key: const Key('pos-count-detail-start'),
                          onPressed: widget.canCount && !_busy ? () => unawaited(_run(() => widget.gateway.startCount(_count.id, version: _count.version))) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.action),
                          child: const Text('Iniciar conteo'),
                        ),
                      ),
                    if (_count.status == 'counting')
                      Tooltip(
                        message: widget.canCount ? '' : 'Se requiere el permiso inventory.count.',
                        child: FilledButton(
                          key: const Key('pos-count-detail-submit'),
                          onPressed: widget.canCount && !_busy ? () => unawaited(_run(() => widget.gateway.submitCount(_count.id, version: _count.version))) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.action),
                          child: const Text('Enviar conteo'),
                        ),
                      ),
                    if (_count.status == 'submitted')
                      Tooltip(
                        message: widget.canApprove ? '' : 'Se requiere el permiso inventory.approve.',
                        child: FilledButton(
                          key: const Key('pos-count-detail-approve'),
                          onPressed: widget.canApprove && !_busy ? () => unawaited(_run(() => widget.gateway.approveCount(_count.id, version: _count.version))) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.success),
                          child: const Text('Aprobar'),
                        ),
                      ),
                    if (_count.status == 'approved')
                      Tooltip(
                        message: widget.canApprove ? '' : 'Se requiere el permiso inventory.approve.',
                        child: FilledButton(
                          key: const Key('pos-count-detail-apply'),
                          onPressed: widget.canApprove && !_busy ? () => unawaited(_run(() => widget.gateway.applyCount(_count.id, version: _count.version))) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.success),
                          child: const Text('Aplicar al inventario'),
                        ),
                      ),
                    if (_count.canCancel)
                      Tooltip(
                        message: widget.canCount ? '' : 'Se requiere el permiso inventory.count.',
                        child: OutlinedButton(
                          key: const Key('pos-count-detail-cancel'),
                          onPressed: widget.canCount && !_busy ? () => unawaited(_cancel()) : null,
                          style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
                          child: const Text('Cancelar conteo'),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => Navigator.of(context).pop(_changed), child: const Text('Cerrar'))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// =======================================================================
// Reservas — inventory reservations (holds against a real balance).
// Gated by `inventory.read`; mutations by `inventory.reservation.manage`.
// =======================================================================

class _ReservasTab extends StatefulWidget {
  const _ReservasTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosInventoryAdminGateway gateway;

  @override
  State<_ReservasTab> createState() => _ReservasTabState();
}

class _ReservasTabState extends State<_ReservasTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosInventoryReservation> _items = const [];
  String? _errorMessage;
  String _query = '';
  String _statusFilter = 'all';

  bool get _canRead => widget.context.permissions.contains('inventory.read');
  bool get _canManage => widget.context.permissions.contains('inventory.reservation.manage');
  String? get _branchId => widget.context.session.branchId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listReservations(branchId: _branchId, status: _statusFilter == 'all' ? null : _statusFilter);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar las reservas.';
      });
    }
  }

  List<PosInventoryReservation> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items
        .where((reservation) => reservation.reservationNumber.toLowerCase().contains(query) || reservation.ownerId.toLowerCase().contains(query))
        .toList(growable: false);
  }

  Future<void> _openNewForm() async {
    final branchId = _branchId;
    if (branchId == null || !_canManage) return;
    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _ReservationFormDialog(gateway: widget.gateway, branchId: branchId),
    );
    if (created == true) unawaited(_load());
  }

  Future<void> _openDetail(PosInventoryReservation reservation) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _ReservationDetailDialog(reservation: reservation, gateway: widget.gateway, canManage: _canManage),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'inventory.read');
    final newDisabledReason = !_canManage
        ? 'Se requiere el permiso inventory.reservation.manage.'
        : (_branchId == null ? 'Selecciona una sucursal para crear reservas.' : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-reservations-search'),
                onChanged: (value) => setState(() => _query = value),
                decoration: const InputDecoration(isDense: true, hintText: 'Buscar por folio o propietario', prefixIcon: Icon(Icons.search)),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-reservations-status-filter'),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todos')),
                  DropdownMenuItem(value: 'active', child: Text('Activa')),
                  DropdownMenuItem(value: 'confirmed', child: Text('Confirmada')),
                  DropdownMenuItem(value: 'released', child: Text('Liberada')),
                  DropdownMenuItem(value: 'expired', child: Text('Expirada')),
                  DropdownMenuItem(value: 'cancelled', child: Text('Cancelada')),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value ?? 'all');
                  unawaited(_load());
                },
              ),
            ),
            const SizedBox(width: 10),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-reservations-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.bookmark_add_outlined, size: 16),
                label: const Text('Nueva reserva'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay reservas de inventario registradas.'),
          _ListPhase.failure => _Failure(message: _errorMessage ?? 'No fue posible cargar las reservas.', onRetry: () => unawaited(_load())),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final reservation in _visibleItems) _ReservationRow(reservation: reservation, onTap: () => unawaited(_openDetail(reservation)))],
          ),
        },
      ],
    );
  }
}

class _ReservationRow extends StatelessWidget {
  const _ReservationRow({required this.reservation, required this.onTap});
  final PosInventoryReservation reservation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-reservation-row-${reservation.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(reservation.reservationNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text('${reservation.ownerType} · ${reservation.ownerId}', style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                  ],
                ),
              ),
              _StatusPill(label: reservation.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReservationFormDialog extends StatefulWidget {
  const _ReservationFormDialog({required this.gateway, required this.branchId});
  final PosInventoryAdminGateway gateway;
  final String branchId;

  @override
  State<_ReservationFormDialog> createState() => _ReservationFormDialogState();
}

class _ReservationFormDialogState extends State<_ReservationFormDialog> {
  String _ownerType = 'pos_cart';
  final _ownerIdController = TextEditingController();
  List<PosInventoryBalance> _balances = const [];
  PosInventoryBalance? _selectedBalance;
  final _quantityController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadBalances());
  }

  @override
  void dispose() {
    _ownerIdController.dispose();
    _quantityController.dispose();
    super.dispose();
  }

  Future<void> _loadBalances() async {
    try {
      final page = await widget.gateway.listBalances(branchId: widget.branchId);
      if (!mounted) return;
      setState(() => _balances = page.items);
    } on Object {
      // The picker just stays empty on a real failure — no fabricated
      // fallback list.
    }
  }

  Future<void> _submit() async {
    final ownerId = _ownerIdController.text.trim();
    final balance = _selectedBalance;
    final quantity = _quantityController.text.trim();
    if (ownerId.isEmpty) {
      setState(() => _error = 'El id del propietario es obligatorio.');
      return;
    }
    if (balance == null) {
      setState(() => _error = 'Selecciona un producto con existencia real.');
      return;
    }
    if (quantity.isEmpty || double.tryParse(quantity) == null) {
      setState(() => _error = 'Ingresa una cantidad válida.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.gateway.createReservation(
        PosInventoryReservationCreateInput(
          branchId: widget.branchId,
          ownerType: _ownerType,
          ownerId: ownerId,
          lines: [
            PosInventoryReservationLineInput(
              locationId: balance.locationId,
              productVariantId: balance.productVariantId,
              quantity: quantity,
              unitOfMeasureCode: balance.unitOfMeasureCode,
            ),
          ],
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible crear la reserva.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Nueva reserva', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const Key('pos-reservation-form-owner-type'),
                  initialValue: _ownerType,
                  isExpanded: true,
                  decoration: const InputDecoration(isDense: true, labelText: 'Tipo de propietario'),
                  items: const [
                    DropdownMenuItem(value: 'pos_cart', child: Text('Carrito de venta')),
                    DropdownMenuItem(value: 'event', child: Text('Evento')),
                    DropdownMenuItem(value: 'booking', child: Text('Reservación')),
                    DropdownMenuItem(value: 'order', child: Text('Pedido')),
                  ],
                  onChanged: (value) => setState(() => _ownerType = value ?? 'pos_cart'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-reservation-form-owner-id'),
                  controller: _ownerIdController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Id del propietario'),
                ),
                const SizedBox(height: 10),
                if (_balances.isEmpty)
                  Text('No hay existencias registradas en esta sucursal todavía.', style: TextStyle(color: palette.textMuted, fontSize: 12))
                else
                  DropdownButtonFormField<String>(
                    key: const Key('pos-reservation-form-variant'),
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Producto'),
                    items: [
                      for (final balance in _balances)
                        DropdownMenuItem(value: balance.productVariantId, child: Text(balance.displayName, overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (value) => setState(() => _selectedBalance = _balances.firstWhere((balance) => balance.productVariantId == value)),
                  ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-reservation-form-quantity'),
                  controller: _quantityController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: _quantityDecoration,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-reservation-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-reservation-form-save'),
                  saveLabel: 'Reservar',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReservationDetailDialog extends StatefulWidget {
  const _ReservationDetailDialog({required this.reservation, required this.gateway, required this.canManage});
  final PosInventoryReservation reservation;
  final PosInventoryAdminGateway gateway;
  final bool canManage;

  @override
  State<_ReservationDetailDialog> createState() => _ReservationDetailDialogState();
}

class _ReservationDetailDialogState extends State<_ReservationDetailDialog> {
  late PosInventoryReservation _reservation = widget.reservation;
  bool _busy = false;
  String? _error;
  bool _changed = false;

  Future<void> _run(Future<PosInventoryReservation> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await action();
      if (!mounted) return;
      setState(() {
        _reservation = updated;
        _busy = false;
        _changed = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible actualizar la reserva.';
      });
    }
  }

  Future<void> _release(String action, String title) async {
    final reason = await _promptReason(context, title: title, actionLabel: title, actionKey: const Key('pos-reservation-release-confirm'));
    if (reason == null) return;
    await _run(
      () => widget.gateway.releaseReservation(
        _reservation.id,
        version: _reservation.version,
        action: action,
        reasonCode: reason.reasonCode,
        note: reason.note,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480, maxHeight: 680),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(_reservation.reservationNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16))),
                    _StatusPill(label: _reservation.status),
                  ],
                ),
                const SizedBox(height: 10),
                _DetailRow(label: 'Propietario', value: '${_reservation.ownerType} · ${_reservation.ownerId}'),
                _DetailRow(label: 'Creada', value: _formatDateTime(_reservation.createdAt)),
                _DetailRow(label: 'Expira', value: _formatOptionalDateTime(_reservation.expiresAt)),
                _DetailRow(label: 'Confirmada', value: _formatOptionalDateTime(_reservation.confirmedAt)),
                _DetailRow(label: 'Liberada', value: _formatOptionalDateTime(_reservation.releasedAt)),
                const SizedBox(height: 12),
                Text('Líneas', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                for (final line in _reservation.lines)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text('${_shortId(line.productVariantId)} · ${line.quantity} ${line.unitOfMeasureCode}', style: TextStyle(color: palette.text, fontSize: 12)),
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-reservation-detail-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (_reservation.status == 'active')
                      Tooltip(
                        message: widget.canManage ? '' : 'Se requiere el permiso inventory.reservation.manage.',
                        child: FilledButton(
                          key: const Key('pos-reservation-detail-confirm'),
                          onPressed: widget.canManage && !_busy ? () => unawaited(_run(() => widget.gateway.confirmReservation(_reservation.id, version: _reservation.version))) : null,
                          style: FilledButton.styleFrom(backgroundColor: palette.success),
                          child: const Text('Confirmar'),
                        ),
                      ),
                    if (_reservation.isOpen)
                      Tooltip(
                        message: widget.canManage ? '' : 'Se requiere el permiso inventory.reservation.manage.',
                        child: OutlinedButton(
                          key: const Key('pos-reservation-detail-release'),
                          onPressed: widget.canManage && !_busy ? () => unawaited(_release('release', 'Liberar reserva')) : null,
                          style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
                          child: const Text('Liberar'),
                        ),
                      ),
                    if (_reservation.isOpen)
                      Tooltip(
                        message: widget.canManage ? '' : 'Se requiere el permiso inventory.reservation.manage.',
                        child: OutlinedButton(
                          key: const Key('pos-reservation-detail-cancel'),
                          onPressed: widget.canManage && !_busy ? () => unawaited(_release('cancel', 'Cancelar reserva')) : null,
                          style: OutlinedButton.styleFrom(foregroundColor: palette.error, side: BorderSide(color: palette.error)),
                          child: const Text('Cancelar'),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => Navigator.of(context).pop(_changed), child: const Text('Cerrar'))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// =======================================================================
// Ajustes/Reconciliación — reconciliation findings + repairs. Gated by
// `inventory.reconcile`; a repair ALSO requires `inventory.approve` (the
// backend enforces both codes on the same route — see
// `pos_inventory_admin_gateway.dart`'s own doc comment on `repairFinding`).
// =======================================================================

const _repairStrategies = [
  ('rebuild_on_hand_projection', 'Reconstruir proyección de saldo disponible'),
  ('rebuild_reserved_projection', 'Reconstruir proyección de reservado'),
  ('rebuild_in_transit_projection', 'Reconstruir proyección en tránsito'),
  ('restore_last_movement', 'Restaurar referencia al último movimiento'),
  ('create_missing_balance', 'Crear saldo faltante'),
];

class _AjustesTab extends StatefulWidget {
  const _AjustesTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosInventoryAdminGateway gateway;

  @override
  State<_AjustesTab> createState() => _AjustesTabState();
}

class _AjustesTabState extends State<_AjustesTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosInventoryReconciliationFinding> _items = const [];
  String? _errorMessage;
  String _statusFilter = 'open';
  String _severityFilter = 'all';

  bool get _canRead => widget.context.permissions.contains('inventory.reconcile');
  bool get _canApprove => widget.context.permissions.contains('inventory.approve');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listFindings(
        status: _statusFilter == 'all' ? null : _statusFilter,
        severity: _severityFilter == 'all' ? null : _severityFilter,
      );
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _phase = _items.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar los hallazgos de reconciliación.';
      });
    }
  }

  Future<void> _openDetail(PosInventoryReconciliationFinding finding) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _FindingDetailDialog(findingId: finding.id, gateway: widget.gateway, canReconcile: _canRead, canApprove: _canApprove),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    if (!_canRead) return const _PermissionDenied(permission: 'inventory.reconcile');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-findings-status-filter'),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todos')),
                  DropdownMenuItem(value: 'open', child: Text('Abiertos')),
                  DropdownMenuItem(value: 'acknowledged', child: Text('Reconocidos')),
                  DropdownMenuItem(value: 'resolved', child: Text('Resueltos')),
                  DropdownMenuItem(value: 'dismissed', child: Text('Descartados')),
                ],
                onChanged: (value) {
                  setState(() => _statusFilter = value ?? 'open');
                  unawaited(_load());
                },
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 170,
              child: DropdownButtonFormField<String>(
                key: const Key('pos-findings-severity-filter'),
                initialValue: _severityFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'Severidad'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Todas')),
                  DropdownMenuItem(value: 'critical', child: Text('Crítica')),
                  DropdownMenuItem(value: 'warning', child: Text('Advertencia')),
                  DropdownMenuItem(value: 'info', child: Text('Informativa')),
                ],
                onChanged: (value) {
                  setState(() => _severityFilter = value ?? 'all');
                  unawaited(_load());
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay hallazgos de reconciliación en este filtro.'),
          _ListPhase.failure => _Failure(
            message: _errorMessage ?? 'No fue posible cargar los hallazgos de reconciliación.',
            onRetry: () => unawaited(_load()),
          ),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final finding in _items) _FindingRow(finding: finding, onTap: () => unawaited(_openDetail(finding)))],
          ),
        },
      ],
    );
  }
}

class _FindingRow extends StatelessWidget {
  const _FindingRow({required this.finding, required this.onTap});
  final PosInventoryReconciliationFinding finding;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-finding-row-${finding.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(finding.findingType, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      '${finding.severity} · detectado ${_formatDateTime(finding.firstDetectedAt)} · ${finding.occurrenceCount}x',
                      style: TextStyle(color: palette.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              _StatusPill(label: finding.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _FindingDetailDialog extends StatefulWidget {
  const _FindingDetailDialog({required this.findingId, required this.gateway, required this.canReconcile, required this.canApprove});
  final String findingId;
  final PosInventoryAdminGateway gateway;
  final bool canReconcile;
  final bool canApprove;

  @override
  State<_FindingDetailDialog> createState() => _FindingDetailDialogState();
}

class _FindingDetailDialogState extends State<_FindingDetailDialog> {
  PosInventoryReconciliationFinding? _finding;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  bool _changed = false;
  String _strategy = _repairStrategies.first.$1;
  PosInventoryRepairPreview? _preview;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final finding = await widget.gateway.finding(widget.findingId);
      if (!mounted) return;
      setState(() {
        _finding = finding;
        _loading = false;
        _preview = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'No fue posible cargar el hallazgo.';
      });
    }
  }

  Future<void> _acknowledge() async {
    final finding = _finding;
    if (finding == null) return;
    final reason = await _promptReason(context, title: 'Reconocer hallazgo', actionLabel: 'Reconocer', actionKey: const Key('pos-finding-acknowledge-confirm'));
    if (reason == null) return;
    await _runReasoned((version) => widget.gateway.acknowledgeFinding(finding.id, version: version, reasonCode: reason.reasonCode, note: reason.note));
  }

  Future<void> _dismiss() async {
    final finding = _finding;
    if (finding == null) return;
    final reason = await _promptReason(context, title: 'Descartar hallazgo', actionLabel: 'Descartar', actionKey: const Key('pos-finding-dismiss-confirm'));
    if (reason == null) return;
    await _runReasoned((version) => widget.gateway.dismissFinding(finding.id, version: version, reasonCode: reason.reasonCode, note: reason.note));
  }

  Future<void> _runReasoned(Future<PosInventoryReconciliationFinding> Function(int version) action) async {
    final finding = _finding;
    if (finding == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await action(finding.version);
      if (!mounted) return;
      setState(() {
        _finding = updated;
        _busy = false;
        _changed = true;
        _preview = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible actualizar el hallazgo.';
      });
    }
  }

  Future<void> _previewRepair() async {
    final finding = _finding;
    final fingerprint = finding?.fingerprint;
    if (finding == null || fingerprint == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final preview = await widget.gateway.previewRepair(finding.id, version: finding.version, strategy: _strategy, expectedFingerprint: fingerprint);
      if (!mounted) return;
      setState(() {
        _preview = preview;
        _busy = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible generar la vista previa de la reparación.';
      });
    }
  }

  Future<void> _confirmRepair() async {
    final finding = _finding;
    final fingerprint = finding?.fingerprint;
    final preview = _preview;
    if (finding == null || fingerprint == null || preview == null || !preview.repairable) return;
    final reason = await _promptReason(
      context,
      title: 'Confirmar reparación',
      actionLabel: 'Reparar',
      actionKey: const Key('pos-finding-repair-confirm'),
      body: 'Esto aplica exactamente la vista previa generada — la reparación queda registrada con tu motivo.',
    );
    if (reason == null) return;
    await _runReasoned(
      (version) => widget.gateway.repairFinding(
        finding.id,
        version: version,
        strategy: preview.strategy,
        expectedFingerprint: fingerprint,
        previewFingerprint: preview.previewFingerprint,
        previewExpiresAt: preview.previewExpiresAt,
        reasonCode: reason.reasonCode,
        note: reason.note,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final finding = _finding;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 760),
          child: _loading || finding == null
              ? const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()))
              : SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text(finding.findingType, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16))),
                          _StatusPill(label: finding.status),
                        ],
                      ),
                      const SizedBox(height: 10),
                      _DetailRow(label: 'Severidad', value: finding.severity),
                      _DetailRow(label: 'Sucursal', value: finding.branchId == null ? '—' : _shortId(finding.branchId!)),
                      _DetailRow(label: 'Producto', value: finding.productVariantId == null ? '—' : _shortId(finding.productVariantId!)),
                      _DetailRow(label: 'Primera detección', value: _formatDateTime(finding.firstDetectedAt)),
                      _DetailRow(label: 'Última detección', value: _formatDateTime(finding.lastDetectedAt)),
                      _DetailRow(label: 'Ocurrencias', value: '${finding.occurrenceCount}'),
                      _DetailRow(label: 'Reconocido', value: _formatOptionalDateTime(finding.acknowledgedAt)),
                      _DetailRow(label: 'Resuelto', value: _formatOptionalDateTime(finding.resolvedAt)),
                      _DetailRow(label: 'Descartado', value: _formatOptionalDateTime(finding.dismissedAt)),
                      if (finding.expectedSummary != null) ...[
                        const SizedBox(height: 8),
                        Text('Esperado: ${finding.expectedSummary}', style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                      ],
                      if (finding.actualSummary != null)
                        Text('Real: ${finding.actualSummary}', style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                      if (finding.isOpen && finding.fingerprint != null) ...[
                        const SizedBox(height: 14),
                        Text('Reparación', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                        const SizedBox(height: 6),
                        DropdownButtonFormField<String>(
                          key: const Key('pos-finding-detail-repair-strategy'),
                          initialValue: _strategy,
                          isExpanded: true,
                          decoration: const InputDecoration(isDense: true, labelText: 'Estrategia'),
                          items: [for (final strategy in _repairStrategies) DropdownMenuItem(value: strategy.$1, child: Text(strategy.$2, overflow: TextOverflow.ellipsis))],
                          onChanged: (value) => setState(() {
                            _strategy = value ?? _repairStrategies.first.$1;
                            _preview = null;
                          }),
                        ),
                        const SizedBox(height: 8),
                        Tooltip(
                          message: widget.canReconcile ? '' : 'Se requiere el permiso inventory.reconcile.',
                          child: OutlinedButton(
                            key: const Key('pos-finding-detail-preview'),
                            onPressed: widget.canReconcile && !_busy ? () => unawaited(_previewRepair()) : null,
                            child: const Text('Vista previa de la reparación'),
                          ),
                        ),
                        if (_preview != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            _preview!.repairable ? 'Reparable' : 'No reparable con esta estrategia',
                            style: TextStyle(color: _preview!.repairable ? palette.success : palette.error, fontWeight: FontWeight.w700, fontSize: 12),
                          ),
                          for (final warning in _preview!.warnings)
                            Text('⚠ $warning', style: TextStyle(color: palette.warning, fontSize: 11)),
                        ],
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 10),
                        Text(_error!, key: const Key('pos-finding-detail-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                      ],
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          if (finding.status == 'open')
                            Tooltip(
                              message: widget.canReconcile ? '' : 'Se requiere el permiso inventory.reconcile.',
                              child: FilledButton(
                                key: const Key('pos-finding-detail-acknowledge'),
                                onPressed: widget.canReconcile && !_busy ? () => unawaited(_acknowledge()) : null,
                                style: FilledButton.styleFrom(backgroundColor: palette.action),
                                child: const Text('Reconocer'),
                              ),
                            ),
                          if (finding.isOpen)
                            Tooltip(
                              message: widget.canReconcile ? '' : 'Se requiere el permiso inventory.reconcile.',
                              child: OutlinedButton(
                                key: const Key('pos-finding-detail-dismiss'),
                                onPressed: widget.canReconcile && !_busy ? () => unawaited(_dismiss()) : null,
                                style: OutlinedButton.styleFrom(foregroundColor: palette.textSecondary, side: BorderSide(color: palette.border)),
                                child: const Text('Descartar'),
                              ),
                            ),
                          if (finding.isOpen && _preview?.repairable == true)
                            Tooltip(
                              message: widget.canReconcile && widget.canApprove
                                  ? ''
                                  : 'Se requieren los permisos inventory.reconcile e inventory.approve.',
                              child: FilledButton(
                                key: const Key('pos-finding-detail-repair-confirm'),
                                onPressed: widget.canReconcile && widget.canApprove && !_busy ? () => unawaited(_confirmRepair()) : null,
                                style: FilledButton.styleFrom(backgroundColor: palette.success),
                                child: const Text('Confirmar reparación'),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => Navigator.of(context).pop(_changed), child: const Text('Cerrar'))),
                    ],
                  ),
                ),
        ),
      ),
    );
  }
}

// =======================================================================
// Ubicaciones — inventory locations. Gated by `inventory.read`; mutations
// by `inventory_location.manage`.
// =======================================================================

const _locationTypes = [
  ('main', 'Principal'),
  ('sales_floor', 'Piso de venta'),
  ('cafeteria', 'Cafetería'),
  ('event_storage', 'Almacén de eventos'),
  ('damaged', 'Dañado'),
  ('returns', 'Devoluciones'),
  ('transit', 'Tránsito'),
  ('virtual', 'Virtual'),
];

class _UbicacionesTab extends StatefulWidget {
  const _UbicacionesTab({required this.context, required this.gateway});
  final AuthenticatedContext context;
  final PosInventoryAdminGateway gateway;

  @override
  State<_UbicacionesTab> createState() => _UbicacionesTabState();
}

class _UbicacionesTabState extends State<_UbicacionesTab> {
  _ListPhase _phase = _ListPhase.loading;
  List<PosInventoryLocation> _items = const [];
  String? _errorMessage;
  String _query = '';

  bool get _canRead => widget.context.permissions.contains('inventory.read');
  bool get _canManage => widget.context.permissions.contains('inventory_location.manage');
  String? get _branchId => widget.context.session.branchId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _ListPhase.loading;
      _errorMessage = null;
    });
    try {
      final page = await widget.gateway.listLocations(branchId: _branchId);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _phase = _visibleItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ListPhase.failure;
        _errorMessage = 'No fue posible cargar las ubicaciones.';
      });
    }
  }

  List<PosInventoryLocation> get _visibleItems {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items.where((location) => location.name.toLowerCase().contains(query) || location.code.toLowerCase().contains(query)).toList(growable: false);
  }

  Future<void> _openNewForm() async {
    final branchId = _branchId;
    if (branchId == null || !_canManage) return;
    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _LocationFormDialog(gateway: widget.gateway, branchId: branchId),
    );
    if (created == true) unawaited(_load());
  }

  Future<void> _openEdit(PosInventoryLocation location) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _LocationFormDialog(gateway: widget.gateway, branchId: location.branchId, existing: location, canManage: _canManage),
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (!_canRead) return const _PermissionDenied(permission: 'inventory.read');
    final newDisabledReason = !_canManage
        ? 'Se requiere el permiso inventory_location.manage.'
        : (_branchId == null ? 'Selecciona una sucursal para crear ubicaciones.' : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('pos-locations-search'),
                onChanged: (value) => setState(() => _query = value),
                decoration: const InputDecoration(isDense: true, hintText: 'Buscar por nombre o código', prefixIcon: Icon(Icons.search)),
              ),
            ),
            const SizedBox(width: 10),
            Tooltip(
              message: newDisabledReason,
              child: FilledButton.icon(
                key: const Key('pos-locations-new'),
                onPressed: newDisabledReason.isEmpty ? () => unawaited(_openNewForm()) : null,
                style: FilledButton.styleFrom(backgroundColor: palette.action),
                icon: const Icon(Icons.add_location_alt_outlined, size: 16),
                label: const Text('Nueva ubicación'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        switch (_phase) {
          _ListPhase.loading => const _Loading(),
          _ListPhase.empty => const _Empty(message: 'No hay ubicaciones de inventario registradas en esta sucursal.'),
          _ListPhase.failure => _Failure(message: _errorMessage ?? 'No fue posible cargar las ubicaciones.', onRetry: () => unawaited(_load())),
          _ListPhase.ready => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final location in _visibleItems) _LocationRow(location: location, onTap: () => unawaited(_openEdit(location)))],
          ),
        },
      ],
    );
  }
}

class _LocationRow extends StatelessWidget {
  const _LocationRow({required this.location, required this.onTap});
  final PosInventoryLocation location;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _Card(
      key: Key('pos-location-row-${location.id}'),
      padding: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(location.name, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text('${location.code} · ${location.locationType}', style: TextStyle(color: palette.textSecondary, fontSize: 11)),
                  ],
                ),
              ),
              if (location.isDefault)
                Padding(padding: const EdgeInsets.only(right: 8), child: Icon(Icons.star, size: 14, color: palette.warning)),
              _StatusPill(label: location.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _LocationFormDialog extends StatefulWidget {
  const _LocationFormDialog({required this.gateway, required this.branchId, this.existing, this.canManage = true});
  final PosInventoryAdminGateway gateway;
  final String branchId;
  final PosInventoryLocation? existing;
  final bool canManage;

  @override
  State<_LocationFormDialog> createState() => _LocationFormDialogState();
}

class _LocationFormDialogState extends State<_LocationFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _descriptionController = TextEditingController(text: widget.existing?.description ?? '');
  late String _locationType = widget.existing?.locationType ?? _locationTypes.first.$1;
  late String _status = widget.existing?.status ?? 'active';
  late bool _allowsReceiving = widget.existing?.allowsReceiving ?? true;
  late bool _allowsIssuing = widget.existing?.allowsIssuing ?? true;
  late bool _isDefault = widget.existing?.isDefault ?? false;
  bool _busy = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    final name = _nameController.text.trim();
    if (!_isEdit && code.isEmpty) {
      setState(() => _error = 'El código es obligatorio.');
      return;
    }
    if (name.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final description = _descriptionController.text.trim();
    try {
      if (_isEdit) {
        await widget.gateway.updateLocation(
          widget.existing!.id,
          PosInventoryLocationPatchInput(
            name: name,
            description: description.isEmpty ? null : description,
            status: _status,
            allowsReceiving: _allowsReceiving,
            allowsIssuing: _allowsIssuing,
            isDefault: _isDefault,
          ),
          version: widget.existing!.version,
        );
      } else {
        await widget.gateway.createLocation(
          PosInventoryLocationCreateInput(
            branchId: widget.branchId,
            code: code,
            name: name,
            locationType: _locationType,
            description: description.isEmpty ? null : description,
            allowsReceiving: _allowsReceiving,
            allowsIssuing: _allowsIssuing,
            isDefault: _isDefault,
          ),
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible guardar la ubicación.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 640),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(_isEdit ? 'Editar ubicación' : 'Nueva ubicación', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 14),
                if (!_isEdit) ...[
                  TextField(
                    key: const Key('pos-location-form-code'),
                    controller: _codeController,
                    decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-location-form-type'),
                    initialValue: _locationType,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Tipo'),
                    items: [for (final type in _locationTypes) DropdownMenuItem(value: type.$1, child: Text(type.$2))],
                    onChanged: (value) => setState(() => _locationType = value ?? _locationTypes.first.$1),
                  ),
                  const SizedBox(height: 10),
                ],
                TextField(
                  key: const Key('pos-location-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-location-form-description'),
                  controller: _descriptionController,
                  maxLines: 2,
                  decoration: const InputDecoration(isDense: true, labelText: 'Descripción (opcional)'),
                ),
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-location-form-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activa')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactiva')),
                      DropdownMenuItem(value: 'retired', child: Text('Retirada')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                CheckboxListTile(
                  key: const Key('pos-location-form-allows-receiving'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _allowsReceiving,
                  title: const Text('Permite recibir mercancía', style: TextStyle(fontSize: 12)),
                  onChanged: (value) => setState(() => _allowsReceiving = value ?? true),
                ),
                CheckboxListTile(
                  key: const Key('pos-location-form-allows-issuing'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _allowsIssuing,
                  title: const Text('Permite emitir mercancía', style: TextStyle(fontSize: 12)),
                  onChanged: (value) => setState(() => _allowsIssuing = value ?? true),
                ),
                CheckboxListTile(
                  key: const Key('pos-location-form-is-default'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _isDefault,
                  title: const Text('Ubicación predeterminada de la sucursal', style: TextStyle(fontSize: 12)),
                  onChanged: (value) => setState(() => _isDefault = value ?? false),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, key: const Key('pos-location-form-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(false),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-location-form-save'),
                  saveLabel: 'Guardar',
                  saveEnabled: widget.canManage,
                  disabledTooltip: 'Se requiere el permiso inventory_location.manage.',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
