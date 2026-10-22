part of 'pos_people_screen.dart';

// ---------------------------------------------------------------------
// TASK 17.6 (Payroll V2) — the weekly payroll workspace.
//
// Every figure shown here is exactly what the backend calculated (and, for a
// closed week, froze): this app never recomputes a payroll amount, never
// sums money, and never turns a missing value into a made-up zero. The
// server also supplies the column totals ([PosPayrollCurrencyTotals]).
// ---------------------------------------------------------------------

enum _DetailPhase { loading, ready, failure }

String _kindLabel(String kind) => kind == 'deduction' ? 'Deducción' : 'Bono';

String _lineName(PosPayrollPeriodLine line, Map<String, String> employeeNames) =>
    line.employeeName ?? employeeNames[line.employeeId] ?? line.employeeId;

String _periodLabel(PosPayrollPeriod period) => '${period.periodStart} – ${period.periodEnd}';

/// Shows [message] as a transient notice (a blocked print window, etc.).
void _payrollNotice(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Opens the browser print window with [html]; says so honestly if the
/// browser blocked it (never pretends a document was produced).
void _printHtml(BuildContext context, String html) {
  final opened = openReceiptPrintWindow(html);
  if (!opened) {
    _payrollNotice(
      context,
      'El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.',
    );
  }
}

/// Asks for a mandatory reason (reopen / void). Returns the trimmed reason, or
/// `null` when cancelled.
Future<String?> _askReason(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  required Key fieldKey,
  required Key confirmKey,
}) {
  return showDialog<String>(
    context: context,
    builder: (dialogContext) => _PayrollReasonDialog(
      title: title,
      message: message,
      confirmLabel: confirmLabel,
      fieldKey: fieldKey,
      confirmKey: confirmKey,
    ),
  );
}

class _PayrollReasonDialog extends StatefulWidget {
  const _PayrollReasonDialog({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.fieldKey,
    required this.confirmKey,
  });
  final String title;
  final String message;
  final String confirmLabel;
  final Key fieldKey;
  final Key confirmKey;

  @override
  State<_PayrollReasonDialog> createState() => _PayrollReasonDialogState();
}

class _PayrollReasonDialogState extends State<_PayrollReasonDialog> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _confirm() {
    final reason = _controller.text.trim();
    if (reason.length < 3) {
      setState(() => _error = 'Escribe un motivo (mínimo 3 caracteres).');
      return;
    }
    Navigator.of(context).pop(reason);
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.message, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
            const SizedBox(height: 12),
            TextField(
              key: widget.fieldKey,
              controller: _controller,
              autofocus: true,
              maxLines: 2,
              maxLength: 500,
              decoration: InputDecoration(isDense: true, labelText: 'Motivo', errorText: _error),
              onChanged: (_) => setState(() => _error = null),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancelar')),
        FilledButton(key: widget.confirmKey, onPressed: _confirm, child: Text(widget.confirmLabel)),
      ],
    );
  }
}

/// The payroll WEEK workspace (opened from the period list, which is the
/// "Historial"): header (week, branch, status), the weekly table
/// (Empleado / Programado / Trabajado / Retardo / Extra / Base / Ajuste /
/// Total) with the server's own column totals, and the actions
/// Calcular · PDF de la semana · Cerrar nómina / Reabrir. Tapping an employee
/// opens their week in detail ([_PayrollEmployeeDetailDialog]). Every action
/// stays individually permission-gated (disabled + Tooltip naming the
/// permission), mirroring the backend guards.
class _PayrollPeriodDetailDialog extends StatefulWidget {
  const _PayrollPeriodDetailDialog({
    required this.period,
    required this.gateway,
    required this.employeeNames,
    required this.canManage,
    required this.canClose,
    required this.companyName,
    required this.branchLabel,
  });
  final PosPayrollPeriod period;
  final PosPayrollGateway gateway;
  final Map<String, String> employeeNames;
  final bool canManage;
  final bool canClose;
  final String companyName;
  final String branchLabel;

  @override
  State<_PayrollPeriodDetailDialog> createState() => _PayrollPeriodDetailDialogState();
}

class _PayrollPeriodDetailDialogState extends State<_PayrollPeriodDetailDialog> {
  _DetailPhase _phase = _DetailPhase.loading;
  late PosPayrollPeriod _period = widget.period;
  List<PosPayrollPeriodLine> _lines = const [];
  List<PosPayrollCurrencyTotals> _totals = const [];
  String? _errorMessage;
  bool _busy = false;
  bool _changed = false;

  static const _manageTooltip = 'Se requiere el permiso payroll.manage.';
  static const _closeTooltip = 'Se requiere el permiso payroll.close.';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  void _apply(PosPayrollPeriodDetail detail) {
    _period = detail.period;
    _lines = detail.lines;
    _totals = detail.totals;
  }

  Future<void> _load() async {
    setState(() {
      _phase = _DetailPhase.loading;
      _errorMessage = null;
    });
    try {
      final detail = await widget.gateway.period(_period.id);
      if (!mounted) return;
      setState(() {
        _apply(detail);
        _phase = _DetailPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _errorMessage = 'No fue posible cargar el periodo.';
      });
    }
  }

  Future<void> _calculate() async {
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final detail = await widget.gateway.calculate(_period.id);
      if (!mounted) return;
      setState(() {
        _apply(detail);
        _busy = false;
        _changed = true;
        _phase = _DetailPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible calcular la nómina.';
      });
    }
  }

  Future<void> _close() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cerrar nómina de esta semana'),
        content: Text(
          'Se congelará lo que ves en pantalla para ${_lines.length} '
          '${_lines.length == 1 ? 'empleado' : 'empleados'}: horas, ajustes y totales. '
          'Una nómina cerrada ya no se recalcula ni acepta ajustes; reabrirla exige un motivo y queda '
          'registrado en la bitácora.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancelar')),
          FilledButton(
            key: const Key('pos-payroll-close-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Cerrar nómina'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final updated = await widget.gateway.close(_period.id);
      if (!mounted) return;
      setState(() {
        _period = updated;
        _busy = false;
        _changed = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible cerrar el periodo.';
      });
    }
  }

  Future<void> _reopen() async {
    final reason = await _askReason(
      context,
      title: 'Reabrir nómina',
      message:
          'Reabrir regresa la semana a borrador para poder corregirla y recalcularla. Escribe por qué; el motivo '
          'queda registrado de forma independiente al cierre.',
      confirmLabel: 'Reabrir nómina',
      fieldKey: const Key('pos-payroll-reopen-reason'),
      confirmKey: const Key('pos-payroll-reopen-confirm'),
    );
    if (reason == null) return;
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      final updated = await widget.gateway.reopen(_period.id, reason: reason);
      if (!mounted) return;
      setState(() {
        _period = updated;
        _busy = false;
        _changed = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible reabrir el periodo.';
      });
    }
  }

  Future<void> _openEmployee(PosPayrollPeriodLine line) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _PayrollEmployeeDetailDialog(
        period: _period,
        line: line,
        fallbackName: widget.employeeNames[line.employeeId],
        gateway: widget.gateway,
        canManage: widget.canManage,
        companyName: widget.companyName,
        branchLabel: widget.branchLabel,
      ),
    );
    if (changed == true) {
      _changed = true;
      unawaited(_load());
    }
  }

  void _printWeek() {
    final closed = _period.isClosed;
    final rows = [
      for (final line in _lines)
        PayrollWeeklyRow(
          employee: _lineName(line, widget.employeeNames),
          scheduled: payrollMinutesLabel(line.scheduledMinutes),
          worked: payrollMinutesLabel(line.workedMinutes),
          late: payrollMinutesLabel(line.lateMinutes),
          extra: payrollMinutesLabel(line.overtimeMinutes),
          base: _formatMoney(line.baseSalarySnapshot, line.currencyCode),
          adjustment: _formatMoney(line.adjustmentAmount, line.currencyCode),
          total: _formatMoney(line.totalAmount, line.currencyCode),
        ),
    ];
    final totals = [
      for (final item in _totals)
        PayrollWeeklyTotals(
          label: 'Total ${item.currencyCode} · ${item.employeeCount} ${item.employeeCount == 1 ? 'empleado' : 'empleados'}',
          base: _formatMoney(item.baseSalary, item.currencyCode),
          adjustment: _formatMoney(item.adjustment, item.currencyCode),
          total: _formatMoney(item.total, item.currencyCode),
        ),
    ];
    _printHtml(
      context,
      buildPayrollWeeklyHtml(
        companyName: widget.companyName,
        branchLabel: widget.branchLabel,
        periodLabel: _periodLabel(_period),
        closed: closed,
        closedAt: _period.closedAt,
        generatedAt: DateTime.now(),
        rows: rows,
        totals: totals,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final hasLines = _lines.isNotEmpty;
    final calculatedAt = hasLines
        ? _lines.map((line) => line.computedAt).reduce((a, b) => a.isAfter(b) ? a : b)
        : null;
    return Dialog(
      key: const Key('pos-payroll-workspace'),
      backgroundColor: palette.surface,
      insetPadding: const EdgeInsets.all(16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1000, maxHeight: 760),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Nómina · ${_periodLabel(_period)}',
                            style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            [
                              widget.branchLabel,
                              if (_period.isClosed && _period.closedAt != null)
                                'Cerrada el ${_formatDateTime(_period.closedAt!)}'
                              else if (calculatedAt != null)
                                'Calculada el ${_formatDateTime(calculatedAt)}'
                              else
                                'Sin calcular',
                            ].join(' · '),
                            key: const Key('pos-payroll-subtitle'),
                            style: TextStyle(color: palette.textSecondary, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    _StatusPill(label: _period.status),
                    const SizedBox(width: 8),
                    TextButton.icon(
                      key: const Key('pos-payroll-history'),
                      onPressed: () => Navigator.of(context).pop(_changed),
                      icon: const Icon(Icons.history, size: 16),
                      label: const Text('Historial'),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                if (_phase == _DetailPhase.loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_phase == _DetailPhase.failure)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(_errorMessage ?? 'No fue posible cargar el periodo.', style: TextStyle(color: palette.error)),
                  )
                else if (!hasLines)
                  Text(
                    _period.isClosed
                        ? 'Esta nómina se cerró sin empleados calculados.'
                        : 'Este periodo aún no ha sido calculado. Calcula la nómina para ver a cada empleado.',
                    key: const Key('pos-payroll-empty'),
                    style: TextStyle(color: palette.textSecondary, fontSize: 12),
                  )
                else
                  _PayrollWeeklyTable(
                    lines: _lines,
                    totals: _totals,
                    employeeNames: widget.employeeNames,
                    onOpen: (line) => unawaited(_openEmployee(line)),
                  ),
                if (_lines.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Las horas extra se muestran como información de asistencia. No generan un pago automático.',
                    key: const Key('pos-payroll-overtime-note'),
                    style: TextStyle(color: palette.textMuted, fontSize: 11),
                  ),
                ],
                if (_errorMessage != null && _phase == _DetailPhase.ready) ...[
                  const SizedBox(height: 10),
                  Text(
                    _errorMessage!,
                    key: const Key('pos-payroll-detail-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    if (!_period.isClosed)
                      Tooltip(
                        message: widget.canManage ? '' : _manageTooltip,
                        child: FilledButton.icon(
                          key: const Key('pos-payroll-calculate'),
                          onPressed: _busy || !widget.canManage ? null : () => unawaited(_calculate()),
                          style: FilledButton.styleFrom(backgroundColor: palette.action),
                          icon: const Icon(Icons.calculate_outlined, size: 16),
                          label: const Text('Calcular'),
                        ),
                      ),
                    Tooltip(
                      message: hasLines ? '' : 'Calcula la nómina para poder imprimirla.',
                      child: OutlinedButton.icon(
                        key: const Key('pos-payroll-print-week'),
                        onPressed: _busy || !hasLines ? null : _printWeek,
                        icon: const Icon(Icons.picture_as_pdf_outlined, size: 16),
                        label: const Text('PDF de la semana'),
                      ),
                    ),
                    if (!_period.isClosed)
                      Tooltip(
                        message: !widget.canClose
                            ? _closeTooltip
                            : (hasLines ? '' : 'Calcula la nómina antes de cerrarla.'),
                        child: OutlinedButton.icon(
                          key: const Key('pos-payroll-close'),
                          onPressed: _busy || !widget.canClose || !hasLines ? null : () => unawaited(_close()),
                          icon: const Icon(Icons.lock_clock_outlined, size: 16),
                          label: const Text('Cerrar nómina de esta semana'),
                        ),
                      ),
                    if (_period.isClosed)
                      Tooltip(
                        message: widget.canClose ? '' : _closeTooltip,
                        child: OutlinedButton.icon(
                          key: const Key('pos-payroll-reopen'),
                          onPressed: _busy || !widget.canClose ? null : () => unawaited(_reopen()),
                          icon: const Icon(Icons.lock_open_outlined, size: 16),
                          label: const Text('Reabrir'),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    key: const Key('pos-payroll-workspace-close'),
                    onPressed: () => Navigator.of(context).pop(_changed),
                    child: const Text('Cerrar ventana'),
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

/// The weekly table. Horizontally scrollable below ~760px so a phone never
/// clips a column; a tap anywhere on an employee row opens their week.
class _PayrollWeeklyTable extends StatelessWidget {
  const _PayrollWeeklyTable({
    required this.lines,
    required this.totals,
    required this.employeeNames,
    required this.onOpen,
  });
  final List<PosPayrollPeriodLine> lines;
  final List<PosPayrollCurrencyTotals> totals;
  final Map<String, String> employeeNames;
  final ValueChanged<PosPayrollPeriodLine> onOpen;

  static const _headers = ['Empleado', 'Programado', 'Trabajado', 'Retardo', 'Extra', 'Base', 'Ajuste', 'Total'];

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    Widget cell(
      String text, {
      bool header = false,
      bool right = true,
      Color? color,
      bool bold = false,
      Key? key,
      VoidCallback? onTap,
    }) {
      final label = Text(
        text,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        textAlign: right ? TextAlign.right : TextAlign.left,
        style: TextStyle(
          color: color ?? (header ? palette.textMuted : palette.text),
          fontSize: header ? 10.5 : 12,
          fontWeight: header || bold ? FontWeight.w800 : FontWeight.w500,
        ),
      );
      final padded = Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10), child: label);
      if (onTap != null) return InkWell(key: key, onTap: onTap, child: padded);
      return key == null ? padded : KeyedSubtree(key: key, child: padded);
    }

    final rows = <TableRow>[
      TableRow(
        decoration: BoxDecoration(color: palette.background),
        children: [for (var i = 0; i < _headers.length; i++) cell(_headers[i], header: true, right: i > 0)],
      ),
      for (final line in lines)
        TableRow(
          decoration: BoxDecoration(border: Border(bottom: BorderSide(color: palette.border))),
          children: [
            cell(
              _lineName(line, employeeNames),
              right: false,
              bold: true,
              key: Key('pos-payroll-line-row-${line.id}'),
              onTap: () => onOpen(line),
            ),
            cell(payrollMinutesLabel(line.scheduledMinutes), onTap: () => onOpen(line)),
            cell(payrollMinutesLabel(line.workedMinutes), onTap: () => onOpen(line)),
            cell(
              payrollMinutesLabel(line.lateMinutes),
              color: line.lateMinutes > 0 ? palette.warning : null,
              onTap: () => onOpen(line),
            ),
            cell(payrollMinutesLabel(line.overtimeMinutes), onTap: () => onOpen(line)),
            cell(_formatMoney(line.baseSalarySnapshot, line.currencyCode), onTap: () => onOpen(line)),
            cell(
              _formatMoney(line.adjustmentAmount, line.currencyCode),
              color: line.adjustmentAmount.startsWith('-') ? palette.error : null,
              onTap: () => onOpen(line),
            ),
            cell(_formatMoney(line.totalAmount, line.currencyCode), bold: true, onTap: () => onOpen(line)),
          ],
        ),
      for (final item in totals)
        TableRow(
          decoration: BoxDecoration(border: Border(top: BorderSide(color: palette.text, width: 1.5))),
          children: [
            cell(
              'Total ${item.currencyCode} · ${item.employeeCount} ${item.employeeCount == 1 ? 'empleado' : 'empleados'}',
              right: false,
              bold: true,
              key: Key('pos-payroll-totals-${item.currencyCode}'),
            ),
            cell(''),
            cell(''),
            cell(''),
            cell(''),
            cell(_formatMoney(item.baseSalary, item.currencyCode), bold: true),
            cell(_formatMoney(item.adjustment, item.currencyCode), bold: true),
            cell(_formatMoney(item.total, item.currencyCode), bold: true),
          ],
        ),
    ];
    return _Card(
      key: const Key('pos-payroll-table'),
      padding: EdgeInsets.zero,
      child: LayoutBuilder(
        builder: (context, constraints) {
          const minWidth = 760.0;
          final width = constraints.maxWidth < minWidth ? minWidth : constraints.maxWidth;
          return SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: width,
              child: Table(
                columnWidths: const {
                  0: FlexColumnWidth(2.4),
                  1: FlexColumnWidth(1.1),
                  2: FlexColumnWidth(1.1),
                  3: FlexColumnWidth(1),
                  4: FlexColumnWidth(1),
                  5: FlexColumnWidth(1.2),
                  6: FlexColumnWidth(1.2),
                  7: FlexColumnWidth(1.3),
                },
                defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                children: rows,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// One employee's week in detail: the frozen daily breakdown, the money
/// summary, the manual adjustments (add / void) and the printable receipt.
class _PayrollEmployeeDetailDialog extends StatefulWidget {
  const _PayrollEmployeeDetailDialog({
    required this.period,
    required this.line,
    required this.fallbackName,
    required this.gateway,
    required this.canManage,
    required this.companyName,
    required this.branchLabel,
  });
  final PosPayrollPeriod period;
  final PosPayrollPeriodLine line;
  final String? fallbackName;
  final PosPayrollGateway gateway;
  final bool canManage;
  final String companyName;
  final String branchLabel;

  @override
  State<_PayrollEmployeeDetailDialog> createState() => _PayrollEmployeeDetailDialogState();
}

class _PayrollEmployeeDetailDialogState extends State<_PayrollEmployeeDetailDialog> {
  _DetailPhase _phase = _DetailPhase.loading;
  late PosPayrollPeriodLine _line = widget.line;

  /// Only a period calculated before overtime stopped being paid automatically
  /// (TASK 17.6.1) can still carry overtime money; it is shown, labeled as such.
  bool get _hasLegacyOvertimePay => (double.tryParse(_line.bonusAmount) ?? 0) > 0;
  List<PosPayrollDay> _days = const [];
  List<PosPayrollAdjustment> _adjustments = const [];
  String? _errorMessage;
  bool _busy = false;
  bool _changed = false;

  bool get _editable => widget.canManage && !widget.period.isClosed;

  String get _employeeName => _line.employeeName ?? widget.fallbackName ?? _line.employeeId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _phase = _DetailPhase.loading;
      _errorMessage = null;
    });
    try {
      final detail = await widget.gateway.employeeDetail(
        periodId: widget.period.id,
        employeeId: widget.line.employeeId,
      );
      if (!mounted) return;
      setState(() {
        _line = detail.line;
        _days = detail.days;
        _adjustments = detail.adjustments;
        _phase = _DetailPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _DetailPhase.failure;
        _errorMessage = 'No fue posible cargar el detalle del empleado.';
      });
    }
  }

  Future<void> _addAdjustment() async {
    final change = await showDialog<PosPayrollAdjustmentChange>(
      context: context,
      builder: (dialogContext) => _PayrollAdjustmentDialog(
        gateway: widget.gateway,
        periodId: widget.period.id,
        employeeId: widget.line.employeeId,
        employeeName: _employeeName,
      ),
    );
    if (change == null || !mounted) return;
    _changed = true;
    await _load();
  }

  Future<void> _voidAdjustment(PosPayrollAdjustment adjustment) async {
    final reason = await _askReason(
      context,
      title: 'Anular ajuste',
      message:
          'El ajuste no se borra: queda marcado como anulado con tu motivo y el total se recalcula. '
          '${_kindLabel(adjustment.kind)} de ${_formatMoney(adjustment.amount, adjustment.currencyCode)}.',
      confirmLabel: 'Anular ajuste',
      fieldKey: const Key('pos-payroll-void-reason'),
      confirmKey: const Key('pos-payroll-void-confirm'),
    );
    if (reason == null) return;
    setState(() {
      _busy = true;
      _errorMessage = null;
    });
    try {
      await widget.gateway.voidAdjustment(
        periodId: widget.period.id,
        adjustmentId: adjustment.id,
        reason: reason,
        idempotencyKey: 'one-payroll-void-${DateTime.now().toUtc().microsecondsSinceEpoch}',
      );
      if (!mounted) return;
      _changed = true;
      setState(() => _busy = false);
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _errorMessage = 'No fue posible anular el ajuste.';
      });
    }
  }

  void _printReceipt() {
    final period = widget.period;
    final currency = _line.currencyCode;
    final active = _adjustments.where((item) => !item.isVoided);
    _printHtml(
      context,
      buildPayrollReceiptHtml(
        companyName: widget.companyName,
        branchLabel: widget.branchLabel,
        employeeName: _employeeName,
        employeeCode: _line.employeeCode,
        jobTitle: _line.jobTitle,
        periodLabel: _periodLabel(period),
        closed: period.isClosed,
        closedAt: period.closedAt,
        generatedAt: DateTime.now(),
        days: [
          for (final day in _days)
            PayrollReceiptDay(
              date: day.workDate,
              schedule: payrollScheduleLabel(start: day.scheduledStart, end: day.scheduledEnd, isDayOff: day.isDayOff),
              entry: payrollClockLabel(day.firstInMinute),
              exit: payrollClockLabel(day.lastOutMinute),
              worked: payrollMinutesLabel(day.workedMinutes),
              late: payrollMinutesLabel(day.lateMinutes),
              extra: payrollMinutesLabel(day.overtimeMinutes),
              state: payrollAttendanceLabel(day.attendanceState),
            ),
        ],
        summary: [
          MapEntry('Sueldo base', _formatMoney(_line.baseSalarySnapshot, currency)),
          MapEntry('Descuento por retardos', _formatMoney(_line.deductionAmount, currency)),
          MapEntry('Tiempo extra (solo asistencia)', payrollMinutesLabel(_line.overtimeMinutes)),
          if (_hasLegacyOvertimePay) MapEntry('Pago por tiempo extra (cálculo anterior)', _formatMoney(_line.bonusAmount, currency)),
          MapEntry('Ajustes manuales', _formatMoney(_line.adjustmentAmount, currency)),
          MapEntry('Total', _formatMoney(_line.totalAmount, currency)),
        ],
        adjustments: [
          for (final item in active)
            PayrollReceiptAdjustment(
              kind: _kindLabel(item.kind),
              reason: item.reason,
              amount: '${item.isDeduction ? '-' : '+'}${_formatMoney(item.amount, item.currencyCode)}',
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final currency = _line.currencyCode;
    final details = [
      if (_line.employeeCode != null && _line.employeeCode!.isNotEmpty) 'Código ${_line.employeeCode}',
      if (_line.jobTitle != null && _line.jobTitle!.isNotEmpty) _line.jobTitle!,
    ].join(' · ');
    return Dialog(
      key: const Key('pos-payroll-employee-dialog'),
      backgroundColor: palette.surface,
      insetPadding: const EdgeInsets.all(16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 880, maxHeight: 760),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _employeeName,
                            key: const Key('pos-payroll-employee-name'),
                            style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                          ),
                          Text(
                            [if (details.isNotEmpty) details, 'Semana ${_periodLabel(widget.period)}'].join(' · '),
                            style: TextStyle(color: palette.textSecondary, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    _StatusPill(label: widget.period.status),
                  ],
                ),
                if (!_line.snapshotAvailable) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Esta nómina se calculó antes del registro histórico de empleados: nombre y puesto son los actuales.',
                    key: const Key('pos-payroll-no-snapshot'),
                    style: TextStyle(color: palette.warning, fontSize: 11),
                  ),
                ],
                const SizedBox(height: 14),
                if (_phase == _DetailPhase.loading)
                  const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: CircularProgressIndicator()))
                else if (_phase == _DetailPhase.failure)
                  Text(_errorMessage ?? 'No fue posible cargar el detalle.', style: TextStyle(color: palette.error))
                else ...[
                  const _DetailSectionHeader(label: 'Asistencia de la semana'),
                  _PayrollDaysTable(days: _days),
                  const _DetailSectionHeader(label: 'Resumen'),
                  _DetailRow(label: 'Sueldo base', value: _formatMoney(_line.baseSalarySnapshot, currency)),
                  _DetailRow(
                    label: 'Descuento por retardos (${payrollMinutesLabel(_line.lateMinutes)})',
                    value: _formatMoney(_line.deductionAmount, currency),
                  ),
                  KeyedSubtree(
                    key: const Key('pos-payroll-detail-overtime'),
                    child: _DetailRow(label: 'Tiempo extra (solo asistencia)', value: payrollMinutesLabel(_line.overtimeMinutes)),
                  ),
                  // Only a period calculated before TASK 17.6.1 can carry money
                  // here; new calculations never turn overtime into pay.
                  if (_hasLegacyOvertimePay)
                    KeyedSubtree(
                      key: const Key('pos-payroll-detail-legacy-overtime-pay'),
                      child: _DetailRow(label: 'Pago por tiempo extra (cálculo anterior)', value: _formatMoney(_line.bonusAmount, currency)),
                    ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      'Las horas extra se muestran como información de asistencia. No generan un pago automático.',
                      key: const Key('pos-payroll-detail-overtime-note'),
                      style: TextStyle(color: palette.textMuted, fontSize: 11),
                    ),
                  ),
                  _DetailRow(label: 'Ajustes manuales', value: _formatMoney(_line.adjustmentAmount, currency)),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 170,
                          child: Text('Total', style: TextStyle(color: palette.text, fontSize: 12, fontWeight: FontWeight.w800)),
                        ),
                        Text(
                          _formatMoney(_line.totalAmount, currency),
                          key: const Key('pos-payroll-summary-total'),
                          style: TextStyle(color: palette.text, fontSize: 15, fontWeight: FontWeight.w800),
                        ),
                      ],
                    ),
                  ),
                  const _DetailSectionHeader(label: 'Ajustes manuales'),
                  if (_adjustments.isEmpty)
                    Text(
                      'Sin ajustes manuales en esta semana.',
                      key: const Key('pos-payroll-no-adjustments'),
                      style: TextStyle(color: palette.textSecondary, fontSize: 12),
                    )
                  else
                    for (final adjustment in _adjustments)
                      _PayrollAdjustmentRow(
                        adjustment: adjustment,
                        canVoid: _editable && !_busy,
                        onVoid: () => unawaited(_voidAdjustment(adjustment)),
                      ),
                ],
                if (_errorMessage != null && _phase == _DetailPhase.ready) ...[
                  const SizedBox(height: 10),
                  Text(_errorMessage!, key: const Key('pos-payroll-employee-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    Tooltip(
                      message: _editable
                          ? ''
                          : (widget.period.isClosed
                                ? 'La nómina está cerrada: ya no acepta ajustes.'
                                : 'Se requiere el permiso payroll.manage.'),
                      child: FilledButton.icon(
                        key: const Key('pos-payroll-add-adjustment'),
                        onPressed: _editable && !_busy && _phase == _DetailPhase.ready ? () => unawaited(_addAdjustment()) : null,
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        icon: const Icon(Icons.add, size: 16),
                        label: const Text('Agregar ajuste'),
                      ),
                    ),
                    OutlinedButton.icon(
                      key: const Key('pos-payroll-print-receipt'),
                      onPressed: _phase == _DetailPhase.ready ? _printReceipt : null,
                      icon: const Icon(Icons.receipt_long_outlined, size: 16),
                      label: const Text('Recibo / PDF'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Center(
                  child: TextButton(
                    key: const Key('pos-payroll-employee-close'),
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

/// The 7 (or N) days of the payroll week, straight from the backend's frozen
/// per-day breakdown. A day with no punch shows `—`, never an invented time.
class _PayrollDaysTable extends StatelessWidget {
  const _PayrollDaysTable({required this.days});
  final List<PosPayrollDay> days;

  static const _headers = ['Fecha', 'Horario', 'Entrada', 'Salida', 'Trabajado', 'Retardo', 'Extra', 'Estado'];

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (days.isEmpty) {
      return Text(
        'Esta semana no tiene desglose diario (se calculó antes del registro histórico). Vuelve a calcular la nómina '
        'mientras siga en borrador para generarlo.',
        key: const Key('pos-payroll-no-days'),
        style: TextStyle(color: palette.textSecondary, fontSize: 12),
      );
    }
    Widget cell(String text, {bool header = false, bool right = false, Color? color, Key? key}) => Padding(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Text(
        text,
        textAlign: right ? TextAlign.right : TextAlign.left,
        style: TextStyle(
          color: color ?? (header ? palette.textMuted : palette.text),
          fontSize: header ? 10.5 : 12,
          fontWeight: header ? FontWeight.w800 : FontWeight.w500,
        ),
      ),
    );
    Color? stateColor(String state) => switch (state) {
      'missing_clock_out' || 'missing_clock_in' => palette.warning,
      'complete' => palette.success,
      _ => null,
    };
    return _Card(
      key: const Key('pos-payroll-days-table'),
      padding: EdgeInsets.zero,
      child: LayoutBuilder(
        builder: (context, constraints) {
          const minWidth = 720.0;
          final width = constraints.maxWidth < minWidth ? minWidth : constraints.maxWidth;
          return SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: width,
              child: Table(
                columnWidths: const {
                  0: FlexColumnWidth(1.3),
                  1: FlexColumnWidth(1.5),
                  2: FlexColumnWidth(1),
                  3: FlexColumnWidth(1),
                  4: FlexColumnWidth(1.1),
                  5: FlexColumnWidth(1),
                  6: FlexColumnWidth(1),
                  7: FlexColumnWidth(1.8),
                },
                children: [
                  TableRow(
                    decoration: BoxDecoration(color: palette.background),
                    children: [
                      for (var i = 0; i < _headers.length; i++) cell(_headers[i], header: true, right: i >= 2 && i <= 6),
                    ],
                  ),
                  for (final day in days)
                    TableRow(
                      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: palette.border))),
                      children: [
                        cell(day.workDate, key: Key('pos-payroll-day-row-${day.workDate}')),
                        cell(payrollScheduleLabel(start: day.scheduledStart, end: day.scheduledEnd, isDayOff: day.isDayOff)),
                        cell(payrollClockLabel(day.firstInMinute), right: true),
                        cell(payrollClockLabel(day.lastOutMinute), right: true),
                        cell(payrollMinutesLabel(day.workedMinutes), right: true),
                        cell(
                          payrollMinutesLabel(day.lateMinutes),
                          right: true,
                          color: day.lateMinutes > 0 ? palette.warning : null,
                        ),
                        cell(payrollMinutesLabel(day.overtimeMinutes), right: true),
                        cell(payrollAttendanceLabel(day.attendanceState), color: stateColor(day.attendanceState)),
                      ],
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PayrollAdjustmentRow extends StatelessWidget {
  const _PayrollAdjustmentRow({required this.adjustment, required this.canVoid, required this.onVoid});
  final PosPayrollAdjustment adjustment;
  final bool canVoid;
  final VoidCallback onVoid;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final voided = adjustment.isVoided;
    final sign = adjustment.isDeduction ? '-' : '+';
    final amount = '$sign${_formatMoney(adjustment.amount, adjustment.currencyCode)}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: _Card(
        key: Key('pos-payroll-adjustment-row-${adjustment.id}'),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        _kindLabel(adjustment.kind),
                        style: TextStyle(
                          color: voided ? palette.textMuted : palette.text,
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                          decoration: voided ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        amount,
                        style: TextStyle(
                          color: voided
                              ? palette.textMuted
                              : (adjustment.isDeduction ? palette.error : palette.success),
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                          decoration: voided ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      if (voided) ...[
                        const SizedBox(width: 8),
                        Text(
                          'ANULADO',
                          key: Key('pos-payroll-adjustment-voided-${adjustment.id}'),
                          style: TextStyle(color: palette.warning, fontWeight: FontWeight.w800, fontSize: 10),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(adjustment.reason, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                  Text(
                    voided
                        ? 'Anulado el ${_formatDateTime(adjustment.voidedAt!)}: ${adjustment.voidReason ?? ''}'
                        : 'Registrado el ${_formatDateTime(adjustment.createdAt)}',
                    style: TextStyle(color: palette.textMuted, fontSize: 10.5),
                  ),
                ],
              ),
            ),
            if (!voided)
              TextButton(
                key: Key('pos-payroll-adjustment-void-${adjustment.id}'),
                onPressed: canVoid ? onVoid : null,
                child: const Text('Anular'),
              ),
          ],
        ),
      ),
    );
  }
}

/// Add a manual adjustment: kind (Bono / Deducción), a positive amount and a
/// mandatory reason. The idempotency key is created ONCE when the dialog
/// opens, so a double click or a retry after a lost response can never record
/// the adjustment twice.
class _PayrollAdjustmentDialog extends StatefulWidget {
  const _PayrollAdjustmentDialog({
    required this.gateway,
    required this.periodId,
    required this.employeeId,
    required this.employeeName,
  });
  final PosPayrollGateway gateway;
  final String periodId;
  final String employeeId;
  final String employeeName;

  @override
  State<_PayrollAdjustmentDialog> createState() => _PayrollAdjustmentDialogState();
}

class _PayrollAdjustmentDialogState extends State<_PayrollAdjustmentDialog> {
  final _amountController = TextEditingController();
  final _reasonController = TextEditingController();
  final String _idempotencyKey = 'one-payroll-adj-${DateTime.now().toUtc().microsecondsSinceEpoch}';
  String _kind = 'bonus';
  bool _busy = false;
  String? _error;

  static final RegExp _amountPattern = RegExp(r'^\d{1,15}(\.\d{1,4})?$');

  @override
  void dispose() {
    _amountController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final amount = _amountController.text.trim();
    final reason = _reasonController.text.trim();
    if (!_amountPattern.hasMatch(amount) || double.tryParse(amount) == 0) {
      setState(() => _error = 'Captura un monto mayor a cero (hasta 4 decimales).');
      return;
    }
    if (reason.length < 3) {
      setState(() => _error = 'Escribe el motivo del ajuste (mínimo 3 caracteres).');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final change = await widget.gateway.createAdjustment(
        periodId: widget.periodId,
        employeeId: widget.employeeId,
        kind: _kind,
        amount: amount,
        reason: reason,
        idempotencyKey: _idempotencyKey,
      );
      if (!mounted) return;
      Navigator.of(context).pop(change);
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
        _error = 'No fue posible registrar el ajuste.';
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
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 520),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Ajuste de nómina',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                Text(widget.employeeName, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                const SizedBox(height: 14),
                SegmentedButton<String>(
                  key: const Key('pos-payroll-adjustment-kind'),
                  segments: const [
                    ButtonSegment(value: 'bonus', label: Text('Bono (+)')),
                    ButtonSegment(value: 'deduction', label: Text('Deducción (-)')),
                  ],
                  selected: {_kind},
                  onSelectionChanged: (selection) => setState(() => _kind = selection.first),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('pos-payroll-adjustment-amount'),
                  controller: _amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(isDense: true, labelText: 'Monto', prefixText: '\$ '),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-payroll-adjustment-reason'),
                  controller: _reasonController,
                  maxLines: 2,
                  maxLength: 500,
                  decoration: const InputDecoration(isDense: true, labelText: 'Motivo'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 6),
                  Text(_error!, key: const Key('pos-payroll-adjustment-error'), style: TextStyle(color: palette.error, fontSize: 12)),
                ],
                const SizedBox(height: 14),
                _DialogButtons(
                  busy: _busy,
                  onCancel: () => Navigator.of(context).pop(),
                  onSave: () => unawaited(_submit()),
                  saveKey: const Key('pos-payroll-adjustment-save'),
                  saveLabel: 'Registrar ajuste',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
