/// TASK 16.15 — "Consolidado de sucursal": a real, read-only Manager/Owner
/// screen over `GET /api/v1/branches/{id}/consolidation`, gated by
/// `branch_consolidation.read`. Shows the branch's own day-so-far roll-up
/// across every cash register/operational area — never a mutation of any
/// kind (no create/edit/close action lives here; those stay in "Corte de
/// Caja"/"Mi caja").
///
/// CRITICAL correctness point this screen exists to honor (see
/// `pos_branch_consolidation_gateway.dart`'s own header doc comment): a
/// branch-wide cash difference of exactly `$0.00` does NOT mean every
/// register is fine — two registers can individually be `+$X` and `-$X`
/// and net to zero. [_DiscrepancyBanner] below is ALWAYS rendered (never
/// conditionally hidden behind a "looks clean" branch total) and reads
/// [PosBranchConsolidationTotals.discrepantRegisterCount]/
/// [PosBranchConsolidationTotals.cardPendingOrDiscrepantRegisterCount]
/// directly, never derived from the branch-wide totals.
///
/// Structural template: `pos_branch_admin_screen.dart`'s standalone-file/
/// permission-gated-list shape, adapted for a single-resource read (no
/// list/pagination) with a date picker instead of a create action.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'money.dart';
import 'pos_branch_consolidation_gateway.dart';
import 'pos_cash_gateway.dart';
import 'pos_tokens.dart';

enum _ConsolidationPhase { loading, failure, ready }

String _isoDate(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

// Mirrors `pos_shell.dart`'s own private `_formatMoney` exactly (that one
// is library-private to `pos_shell.dart`, so this is a deliberate, faithful
// copy, not a divergent one — same convention `pos_dashboard_gateway.dart`'s
// own header comment documents): `Money.parse` throws on a negative amount
// by design (ADR-0001's `Money` type is never negative), so the sign is
// stripped before parsing and reapplied BEFORE the `$`, giving `-$50.00`,
// never `$-50.00`. A discrepancy/difference figure is the one legitimately
// signed amount this screen displays.
String _money(String? amount, {String fallback = '—'}) {
  if (amount == null) return fallback;
  final trimmed = amount.trim();
  final negative = trimmed.startsWith('-');
  final magnitude = negative ? trimmed.substring(1) : trimmed;
  try {
    final money = Money.parse(magnitude, 'MXN');
    return '${negative ? '-' : ''}\$${money.toDisplayString()}';
  } on MoneyFormatException {
    return amount;
  }
}

String _registerStatusLabel(PosBranchConsolidationRegisterStatus status) => switch (status) {
  // TASK 16.15's own explicit requirement: a register with no activity
  // today must render distinctly from a discrepant/closed register.
  PosBranchConsolidationRegisterStatus.noSession => 'Sin actividad hoy',
  PosBranchConsolidationRegisterStatus.open => 'Abierta',
  PosBranchConsolidationRegisterStatus.closing => 'Cerrando',
  PosBranchConsolidationRegisterStatus.closed => 'Cerrada',
  PosBranchConsolidationRegisterStatus.unknown => 'Desconocido',
};

Color _registerStatusColor(PosPalette palette, PosBranchConsolidationRegisterStatus status) => switch (status) {
  PosBranchConsolidationRegisterStatus.noSession => palette.textMuted,
  PosBranchConsolidationRegisterStatus.open => palette.success,
  PosBranchConsolidationRegisterStatus.closing => palette.warning,
  PosBranchConsolidationRegisterStatus.closed => palette.blue,
  PosBranchConsolidationRegisterStatus.unknown => palette.textMuted,
};

String _cardReconciliationStatusLabel(PosCashCardReconciliationStatus status) => switch (status) {
  PosCashCardReconciliationStatus.notApplicable => 'No aplica',
  PosCashCardReconciliationStatus.pending => 'Pendiente de conciliar',
  PosCashCardReconciliationStatus.reconciled => 'Conciliado',
  PosCashCardReconciliationStatus.discrepancy => 'Diferencia',
};

/// The public "Consolidado de sucursal" module screen. Constructed with the
/// real [AuthenticatedContext] and a real [PosBranchConsolidationGateway] —
/// e.g. `PosBranchConsolidationScreen(context: this.context, gateway:
/// branchConsolidationGateway)`.
class PosBranchConsolidationScreen extends StatefulWidget {
  const PosBranchConsolidationScreen({required this.context, required this.gateway, super.key});

  final AuthenticatedContext context;
  final PosBranchConsolidationGateway gateway;

  @override
  State<PosBranchConsolidationScreen> createState() => _PosBranchConsolidationScreenState();
}

class _PosBranchConsolidationScreenState extends State<PosBranchConsolidationScreen> {
  _ConsolidationPhase _phase = _ConsolidationPhase.loading;
  PosBranchConsolidationResult? _result;
  String? _errorMessage;
  DateTime _selectedDate = DateTime.now();

  bool get _canRead => widget.context.permissions.contains('branch_consolidation.read');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant PosBranchConsolidationScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.context.session.branchId != oldWidget.context.session.branchId) {
      unawaited(_load());
    }
  }

  Future<void> _load() async {
    if (!_canRead) return;
    final branchId = widget.context.session.branchId;
    if (branchId == null) return;
    setState(() {
      _phase = _ConsolidationPhase.loading;
      _errorMessage = null;
    });
    try {
      final result = await widget.gateway.consolidation(branchId, date: _isoDate(_selectedDate));
      if (!mounted) return;
      setState(() {
        _result = result;
        _phase = _ConsolidationPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _ConsolidationPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _ConsolidationPhase.failure;
        _errorMessage = 'No fue posible cargar el consolidado de la sucursal.';
      });
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (picked == null) return;
    setState(() => _selectedDate = picked);
    unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branchId = widget.context.session.branchId;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Consolidado de Sucursal',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              OutlinedButton.icon(
                key: const Key('pos-branch-consolidation-date'),
                onPressed: () => unawaited(_pickDate()),
                icon: const Icon(Icons.calendar_today_outlined, size: 14),
                label: Text(_isoDate(_selectedDate)),
              ),
              const SizedBox(width: 8),
              IconButton(
                key: const Key('pos-branch-consolidation-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Vista de solo lectura — corte por caja/área para el día seleccionado.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _ConsolidationPermissionState()
          else if (branchId == null)
            const _ConsolidationNoBranchState()
          else
            Expanded(
              child: switch (_phase) {
                _ConsolidationPhase.loading => const _ConsolidationLoadingState(),
                _ConsolidationPhase.failure => _ConsolidationFailureState(
                  message: _errorMessage ?? 'No fue posible cargar el consolidado de la sucursal.',
                  onRetry: () => unawaited(_load()),
                ),
                _ConsolidationPhase.ready => _result == null
                    ? const _ConsolidationLoadingState()
                    : _ConsolidationBody(result: _result!),
              },
            ),
        ],
      ),
    );
  }
}

class _ConsolidationBody extends StatelessWidget {
  const _ConsolidationBody({required this.result});
  final PosBranchConsolidationResult result;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ALWAYS rendered, regardless of what `totals.cashDifferenceTotal`
          // reads — see this file's own header doc comment.
          _DiscrepancyBanner(totals: result.totals),
          const SizedBox(height: 12),
          _TotalsSummaryCard(totals: result.totals),
          const SizedBox(height: 16),
          if (result.areas.isNotEmpty) ...[
            _SectionLabel('Por área operativa'),
            const SizedBox(height: 8),
            for (final area in result.areas) _AreaSummaryRow(area: area),
            const SizedBox(height: 16),
          ],
          _SectionLabel('Por caja'),
          const SizedBox(height: 8),
          if (result.registers.isEmpty)
            const _ConsolidationEmptyRegistersState()
          else
            for (final register in result.registers) _RegisterRow(register: register),
        ],
      ),
    );
  }
}

/// The one always-visible discrepancy signal — see this file's own header
/// doc comment for why it must never be gated on the branch-wide totals.
class _DiscrepancyBanner extends StatelessWidget {
  const _DiscrepancyBanner({required this.totals});
  final PosBranchConsolidationTotals totals;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final hasIssues = totals.hasAnyDiscrepancy;
    final color = hasIssues ? palette.error : palette.success;
    final icon = hasIssues ? Icons.error_outline : Icons.check_circle_outline;
    final message = hasIssues
        ? '${totals.discrepantRegisterCount} caja(s) con diferencia de efectivo · '
              '${totals.cardPendingOrDiscrepantRegisterCount} con tarjeta pendiente/diferencia'
        : 'Sin cajas con diferencia de efectivo ni de tarjeta reportadas hoy';
    return Container(
      key: const Key('pos-branch-consolidation-discrepancy-banner'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: .35)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13)),
          ),
        ],
      ),
    );
  }
}

class _TotalsSummaryCard extends StatelessWidget {
  const _TotalsSummaryCard({required this.totals});
  final PosBranchConsolidationTotals totals;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      key: const Key('pos-branch-consolidation-totals'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: palette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 20,
            runSpacing: 10,
            children: [
              _TotalsStat(label: 'Apertura', value: _money(totals.cashOpeningTotal)),
              _TotalsStat(label: 'Ventas efectivo', value: _money(totals.cashSalesTotal)),
              _TotalsStat(label: 'Entradas', value: _money(totals.cashInTotal)),
              _TotalsStat(label: 'Salidas', value: _money(totals.cashOutTotal)),
              _TotalsStat(label: 'Esperado', value: _money(totals.expectedCashTotal)),
              _TotalsStat(label: 'Contado', value: _money(totals.countedCashTotal)),
              _TotalsStat(
                label: 'Diferencia de efectivo',
                value: _money(totals.cashDifferenceTotal),
                emphasize: true,
              ),
              _TotalsStat(label: 'Tarjeta (sistema)', value: _money(totals.cardSystemNetTotal)),
              _TotalsStat(label: 'Tarjeta (terminal)', value: _money(totals.cardTerminalTotal)),
              _TotalsStat(label: 'Diferencia de tarjeta', value: _money(totals.cardDifferenceTotal), emphasize: true),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              _CountChip(label: 'Abiertas', count: totals.openRegisterCount, palette: palette),
              _CountChip(label: 'Cerrando', count: totals.closingRegisterCount, palette: palette),
              _CountChip(label: 'Cerradas', count: totals.closedRegisterCount, palette: palette),
              _CountChip(label: 'Sin actividad', count: totals.noSessionRegisterCount, palette: palette),
              _CountChip(
                label: 'Con diferencia',
                count: totals.discrepantRegisterCount,
                palette: palette,
                warn: totals.discrepantRegisterCount > 0,
              ),
              _CountChip(
                label: 'Tarjeta pendiente/diferencia',
                count: totals.cardPendingOrDiscrepantRegisterCount,
                palette: palette,
                warn: totals.cardPendingOrDiscrepantRegisterCount > 0,
              ),
            ],
          ),
          if (totals.paymentMethodTotals.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 16,
              runSpacing: 6,
              children: [
                for (final line in totals.paymentMethodTotals)
                  Text(
                    '${posPaymentMethodLabel(line.method)}: ${_money(line.netTotal)} (${line.ticketCount})',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _TotalsStat extends StatelessWidget {
  const _TotalsStat({required this.label, required this.value, this.emphasize = false});
  final String label;
  final String value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return SizedBox(
      width: 150,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: palette.textSecondary, fontSize: 11)),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: palette.text,
              fontSize: emphasize ? 15 : 13,
              fontWeight: emphasize ? FontWeight.w800 : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.label, required this.count, required this.palette, this.warn = false});
  final String label;
  final int count;
  final PosPalette palette;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final color = warn ? palette.error : palette.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: (warn ? palette.error : palette.textMuted).withValues(alpha: .12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text('$label: $count', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Text(text, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 14));
  }
}

class _AreaSummaryRow extends StatelessWidget {
  const _AreaSummaryRow({required this.area});
  final PosBranchConsolidationAreaSummary area;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    // `null` — "Sin área": a genuine, fully-functional unassigned group,
    // never a fabricated area name.
    final label = area.operationalAreaName ?? 'Sin área';
    return Card(
      key: Key('pos-branch-consolidation-area-${area.operationalAreaId ?? 'none'}'),
      margin: const EdgeInsets.only(bottom: 6),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: palette.border)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Text(label, style: TextStyle(color: palette.text, fontWeight: FontWeight.w600, fontSize: 13)),
            ),
            Text(
              '${area.registerCount} caja(s)',
              style: TextStyle(color: palette.textSecondary, fontSize: 12),
            ),
            const SizedBox(width: 14),
            Text(
              _money(area.cashSalesTotal),
              style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _RegisterRow extends StatelessWidget {
  const _RegisterRow({required this.register});
  final PosBranchConsolidationRegister register;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final statusColor = _registerStatusColor(palette, register.status);
    return Card(
      key: Key('pos-branch-consolidation-register-${register.registerId}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: palette.border)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => showDialog<void>(
          context: context,
          builder: (dialogContext) => _RegisterDetailDialog(register: register),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${register.registerName} (${register.registerCode})',
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      _registerStatusLabel(register.status),
                      style: TextStyle(color: statusColor, fontWeight: FontWeight.w700, fontSize: 11),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
                ],
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 14,
                runSpacing: 4,
                children: [
                  Text(
                    'Ventas: ${_money(register.cashSalesTotal)}',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12),
                  ),
                  Text(
                    'Esperado: ${_money(register.expectedCash)}',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12),
                  ),
                  Text(
                    'Contado: ${_money(register.countedCash)}',
                    style: TextStyle(color: palette.textSecondary, fontSize: 12),
                  ),
                  Text(
                    'Diferencia: ${_money(register.discrepancyAmount)}',
                    key: Key('pos-branch-consolidation-register-${register.registerId}-difference'),
                    style: TextStyle(
                      color: register.hasCashDiscrepancy ? palette.error : palette.textSecondary,
                      fontWeight: register.hasCashDiscrepancy ? FontWeight.w800 : FontWeight.normal,
                      fontSize: 12,
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

class _RegisterDetailDialog extends StatelessWidget {
  const _RegisterDetailDialog({required this.register});
  final PosBranchConsolidationRegister register;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final reconciliation = register.cardReconciliation;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460, maxHeight: 560),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '${register.registerName} (${register.registerCode})',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 4),
                Text(
                  _registerStatusLabel(register.status),
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
                const SizedBox(height: 14),
                _DetailField(label: 'Apertura', value: _money(register.openingAmount)),
                _DetailField(label: 'Ventas en efectivo', value: _money(register.cashSalesTotal)),
                _DetailField(label: 'Entradas', value: _money(register.cashInTotal)),
                _DetailField(label: 'Salidas', value: _money(register.cashOutTotal)),
                _DetailField(label: 'Esperado', value: _money(register.expectedCash)),
                _DetailField(label: 'Contado', value: _money(register.countedCash)),
                _DetailField(label: 'Diferencia', value: _money(register.discrepancyAmount)),
                if (register.paymentMethodTotals.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text('Métodos de pago', style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13)),
                  const SizedBox(height: 6),
                  for (final line in register.paymentMethodTotals)
                    _DetailField(
                      label: posPaymentMethodLabel(line.method),
                      value: '${_money(line.netTotal)} (${line.ticketCount})',
                    ),
                ],
                if (reconciliation != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Conciliación de tarjetas',
                    style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                  const SizedBox(height: 6),
                  _DetailField(label: 'Estado', value: _cardReconciliationStatusLabel(reconciliation.status)),
                  _DetailField(label: 'Sistema (neto)', value: _money(reconciliation.systemNetTotal)),
                  _DetailField(label: 'Terminal', value: _money(reconciliation.terminalTotal)),
                  _DetailField(label: 'Diferencia', value: _money(reconciliation.difference)),
                ],
                const SizedBox(height: 16),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    key: const Key('pos-branch-consolidation-register-detail-close'),
                    onPressed: () => Navigator.of(context).pop(),
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

class _DetailField extends StatelessWidget {
  const _DetailField({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 150,
            child: Text(label, style: TextStyle(color: palette.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value, style: TextStyle(color: palette.text, fontSize: 13))),
        ],
      ),
    );
  }
}

class _ConsolidationLoadingState extends StatelessWidget {
  const _ConsolidationLoadingState();
  @override
  Widget build(BuildContext context) => const Center(child: CircularProgressIndicator());
}

class _ConsolidationFailureState extends StatelessWidget {
  const _ConsolidationFailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, style: TextStyle(color: palette.error, fontSize: 13)),
          const SizedBox(height: 10),
          OutlinedButton(onPressed: onRetry, child: const Text('Reintentar')),
        ],
      ),
    );
  }
}

class _ConsolidationEmptyRegistersState extends StatelessWidget {
  const _ConsolidationEmptyRegistersState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Center(
        child: Text('Esta sucursal no tiene cajas registradas.', style: TextStyle(color: palette.textMuted, fontSize: 13)),
      ),
    );
  }
}

class _ConsolidationNoBranchState extends StatelessWidget {
  const _ConsolidationNoBranchState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Expanded(
      child: Center(
        child: Text(
          'Selecciona una sucursal para ver su consolidado.',
          style: TextStyle(color: palette.textMuted, fontSize: 13),
        ),
      ),
    );
  }
}

class _ConsolidationPermissionState extends StatelessWidget {
  const _ConsolidationPermissionState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Expanded(
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.lock_outline, color: palette.textMuted, size: 28),
            const SizedBox(height: 8),
            Text(
              'Tu sesión no incluye el permiso de lectura requerido (branch_consolidation.read).',
              style: TextStyle(color: palette.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
