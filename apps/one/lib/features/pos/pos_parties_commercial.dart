part of 'pos_shell.dart';

// TASK 17.6 — Fiestas commercial flow widgets: saved quotations and the party
// payment ledger. Lives in its own file (shared private helpers through
// `part of`) so the already very large `pos_shell.dart` only gains the small
// wiring edits.

String _partyPaymentMethodLabel(String method) => switch (method) {
  'cash' => 'Efectivo',
  'card' => 'Tarjeta',
  'transfer' => 'Transferencia',
  _ => method,
};

/// Honest wording: card and transfer are only RECORDED by the operator — the
/// system neither charges the card nor verifies the transfer.
String _partyPaymentMethodHint(String method) => switch (method) {
  'card' => 'Tarjeta registrada: el sistema no procesa ni verifica el cobro.',
  'transfer' => 'Transferencia registrada: el sistema no verifica el depósito.',
  _ => 'Efectivo: se abona a la caja abierta de esta sucursal.',
};

String _savedQuoteStatusLabel(String status) => switch (status) {
  'draft' => 'Borrador',
  'converted' => 'Convertida en fiesta',
  'cancelled' => 'Cancelada',
  _ => status,
};

String _dateTimeLabel(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

/// One reason dialog shared by "cancel quote" and "void payment".
class _PartyReasonDialog extends StatefulWidget {
  const _PartyReasonDialog({
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
  State<_PartyReasonDialog> createState() => _PartyReasonDialogState();
}

class _PartyReasonDialogState extends State<_PartyReasonDialog> {
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
      setState(() => _error = 'Escribe el motivo (mínimo 3 caracteres).');
      return;
    }
    Navigator.of(context).pop(reason);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.message, style: const TextStyle(fontSize: 13)),
        const SizedBox(height: 10),
        TextField(
          key: widget.fieldKey,
          controller: _controller,
          autofocus: true,
          maxLength: 500,
          decoration: InputDecoration(isDense: true, labelText: 'Motivo', errorText: _error),
        ),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Volver')),
      FilledButton(key: widget.confirmKey, onPressed: _confirm, child: Text(widget.confirmLabel)),
    ],
  );
}

// --- Payment ledger ------------------------------------------------------------

/// The full payment history of a reservation, voided payments included and
/// visibly flagged — a payment is never silently removed from the list.
class _PartyPaymentHistory extends StatelessWidget {
  const _PartyPaymentHistory({required this.payments, required this.currency, required this.canVoid, required this.onVoid});

  final List<PosPartyPayment> payments;
  final String currency;
  final bool canVoid;
  final void Function(PosPartyPayment payment) onVoid;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    if (payments.isEmpty) {
      return Text(
        'Todavía no hay pagos registrados.',
        key: const Key('pos-fiestas-payments-empty'),
        style: TextStyle(color: palette.textMuted, fontSize: 12),
      );
    }
    final hasRecordedOnly = payments.any((payment) => payment.recordedOnly && !payment.isVoided);
    return Column(
      key: const Key('pos-fiestas-payments-history'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final payment in payments) ...[
          Container(
            key: Key('pos-fiestas-payment-row-${payment.id}'),
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              border: Border.all(color: palette.border),
              borderRadius: BorderRadius.circular(8),
              color: payment.isVoided ? palette.background : null,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_partyPaymentMethodLabel(payment.method)} · ${_paymentPurposeLabel(payment.purpose)}',
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                      ),
                    ),
                    Text(
                      _formatPartyMoney(payment.amount, currency),
                      style: TextStyle(
                        color: payment.isVoided ? palette.textMuted : palette.text,
                        fontWeight: FontWeight.w700,
                        decoration: payment.isVoided ? TextDecoration.lineThrough : null,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(_dateTimeLabel(payment.createdAt), style: TextStyle(color: palette.textMuted, fontSize: 11)),
                if (payment.reference != null)
                  Text('Referencia: ${payment.reference}', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                if (payment.notes != null) Text(payment.notes!, style: TextStyle(color: palette.textSecondary, fontSize: 12)),
                if (payment.isVoided)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Anulado${payment.voidReason == null ? '' : ': ${payment.voidReason}'}',
                      key: Key('pos-fiestas-payment-voided-${payment.id}'),
                      style: TextStyle(color: palette.error, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  )
                else if (canVoid)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      key: Key('pos-fiestas-payment-void-${payment.id}'),
                      onPressed: () => onVoid(payment),
                      style: TextButton.styleFrom(foregroundColor: palette.error, visualDensity: VisualDensity.compact),
                      child: const Text('Anular pago'),
                    ),
                  ),
              ],
            ),
          ),
        ],
        if (hasRecordedOnly)
          Text(
            'Los pagos con tarjeta o transferencia son registros del operador: el sistema no los procesa ni los verifica.',
            key: const Key('pos-fiestas-payments-recorded-note'),
            style: TextStyle(color: palette.textMuted, fontSize: 11),
          ),
      ],
    );
  }
}

/// Voids ONE payment. The idempotency key is created once per dialog, so a
/// double tap or a retry after a timeout can never void (or compensate cash)
/// twice. A cash payment needs the open cash session that returns the money.
class _VoidPaymentDialog extends StatefulWidget {
  const _VoidPaymentDialog({
    required this.partiesGateway,
    required this.cashGateway,
    required this.reservationId,
    required this.branchId,
    required this.payment,
    required this.currency,
  });

  final PosPartiesGateway partiesGateway;
  final PosCashGateway cashGateway;
  final String reservationId;
  final String branchId;
  final PosPartyPayment payment;
  final String currency;

  @override
  State<_VoidPaymentDialog> createState() => _VoidPaymentDialogState();
}

class _VoidPaymentDialogState extends State<_VoidPaymentDialog> {
  final _reasonController = TextEditingController();
  final String _idempotencyKey = 'one-party-payment-void-${DateTime.now().toUtc().microsecondsSinceEpoch}';
  bool _loadingSession = false;
  PosCashSession? _session;
  bool _busy = false;
  String? _error;

  bool get _needsSession => widget.payment.method == 'cash';

  @override
  void initState() {
    super.initState();
    if (_needsSession) unawaited(_loadSession());
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadSession() async {
    setState(() => _loadingSession = true);
    try {
      final session = await widget.cashGateway.openSessionForBranch(widget.branchId);
      if (!mounted) return;
      setState(() {
        _session = session;
        _loadingSession = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _session = null;
        _loadingSession = false;
      });
    }
  }

  Future<void> _submit() async {
    final reason = _reasonController.text.trim();
    if (reason.length < 3) {
      setState(() => _error = 'Escribe el motivo (mínimo 3 caracteres).');
      return;
    }
    if (_needsSession && _session == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.partiesGateway.voidPayment(
        widget.reservationId,
        widget.payment.id,
        reason: reason,
        cashSessionId: _needsSession ? _session!.id : null,
        idempotencyKey: _idempotencyKey,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'No fue posible anular el pago.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final payment = widget.payment;
    return AlertDialog(
      title: const Text('Anular pago'),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${_partyPaymentMethodLabel(payment.method)} · ${_paymentPurposeLabel(payment.purpose)} por '
              '${_formatPartyMoney(payment.amount, widget.currency)}',
              style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
            ),
            const SizedBox(height: 6),
            Text(
              _needsSession
                  ? 'El pago se conserva en el historial como anulado y se registra una salida de caja compensatoria en la caja abierta.'
                  : 'El pago se conserva en el historial como anulado y deja de contar en el saldo. No se mueve efectivo.',
              style: TextStyle(color: palette.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 10),
            if (_needsSession && _loadingSession)
              const Center(child: CircularProgressIndicator())
            else if (_needsSession && _session == null)
              Text(
                'Abre la caja de esta sucursal para anular un pago en efectivo.',
                key: const Key('pos-fiestas-payment-void-no-session'),
                style: TextStyle(color: palette.error, fontSize: 12),
              )
            else
              TextField(
                key: const Key('pos-fiestas-payment-void-reason'),
                controller: _reasonController,
                maxLength: 500,
                decoration: const InputDecoration(isDense: true, labelText: 'Motivo de la anulación'),
              ),
            if (_error != null)
              Text(_error!, key: const Key('pos-fiestas-payment-void-error'), style: TextStyle(color: palette.error, fontSize: 12)),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: const Text('Volver')),
        FilledButton(
          key: const Key('pos-fiestas-payment-void-confirm'),
          onPressed: (_busy || (_needsSession && _session == null)) ? null : () => unawaited(_submit()),
          style: FilledButton.styleFrom(backgroundColor: palette.error),
          child: _busy
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Anular pago'),
        ),
      ],
    );
  }
}

// --- Saved quotations ---------------------------------------------------------

/// "Cotizaciones guardadas": the persisted quotes of this branch (newest
/// first) with print / edit / convert / cancel. A quote is a saved offer, not
/// a reservation: nothing here blocks a room or records money.
class _SavedQuotesPanel extends StatefulWidget {
  const _SavedQuotesPanel({
    required this.partiesGateway,
    required this.branchId,
    required this.canManage,
    required this.refreshToken,
    required this.onEdit,
    required this.onConvert,
  });

  final PosPartiesGateway partiesGateway;
  final String? branchId;
  final bool canManage;

  /// Changing this reloads the list (after the parent saved/updated a quote).
  final int refreshToken;
  final void Function(PosSavedPartyQuote quote) onEdit;
  final void Function(PosSavedPartyQuote quote) onConvert;

  @override
  State<_SavedQuotesPanel> createState() => _SavedQuotesPanelState();
}

class _SavedQuotesPanelState extends State<_SavedQuotesPanel> {
  bool _loading = true;
  String? _error;
  List<PosSavedPartyQuote> _quotes = const [];
  String? _busyId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant _SavedQuotesPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshToken != widget.refreshToken) unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final quotes = await widget.partiesGateway.listSavedQuotes(branchId: widget.branchId);
      if (!mounted) return;
      setState(() {
        _quotes = quotes;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = posPartyErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'No fue posible cargar las cotizaciones guardadas.';
      });
    }
  }

  Future<void> _print(PosSavedPartyQuote quote) async {
    setState(() => _busyId = quote.id);
    try {
      final html = await widget.partiesGateway.savedQuoteDocument(quote.id);
      if (!mounted) return;
      final opened = openReceiptPrintWindow(html);
      if (!opened) _showNotice(context, 'No fue posible abrir la ventana de impresión.');
    } on ApiException catch (error) {
      if (mounted) _showNotice(context, posPartyErrorMessage(error));
    } on Object {
      if (mounted) _showNotice(context, 'No fue posible generar la cotización.');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _cancel(PosSavedPartyQuote quote) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => _PartyReasonDialog(
        title: 'Cancelar cotización ${quote.quoteNumber}',
        message: 'La cotización se conserva como cancelada; no se borra.',
        confirmLabel: 'Cancelar cotización',
        fieldKey: const Key('pos-fiestas-saved-quote-cancel-reason'),
        confirmKey: const Key('pos-fiestas-saved-quote-cancel-confirm'),
      ),
    );
    if (reason == null || !mounted) return;
    setState(() => _busyId = quote.id);
    try {
      await widget.partiesGateway.cancelSavedQuote(quote.id, reason: reason);
      if (!mounted) return;
      _showNotice(context, 'Cotización cancelada.');
      await _load();
    } on ApiException catch (error) {
      if (mounted) _showNotice(context, posPartyErrorMessage(error));
    } on Object {
      if (mounted) _showNotice(context, 'No fue posible cancelar la cotización.');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _PosCard(
      key: const Key('pos-fiestas-saved-quotes'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Cotizaciones guardadas', style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 14)),
              ),
              IconButton(
                key: const Key('pos-fiestas-saved-quotes-refresh'),
                tooltip: 'Actualizar',
                onPressed: _loading ? null : () => unawaited(_load()),
                icon: const Icon(Icons.refresh, size: 18),
              ),
            ],
          ),
          const SizedBox(height: 4),
          if (_loading)
            const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Text(_error!, key: const Key('pos-fiestas-saved-quotes-error'), style: TextStyle(color: palette.error, fontSize: 12))
          else if (_quotes.isEmpty)
            Text(
              'Todavía no hay cotizaciones guardadas. Cotiza un paquete y usa "Guardar cotización".',
              key: const Key('pos-fiestas-saved-quotes-empty'),
              style: TextStyle(color: palette.textMuted, fontSize: 12),
            )
          else
            for (final quote in _quotes) _buildRow(palette, quote),
        ],
      ),
    );
  }

  Widget _buildRow(PosPalette palette, PosSavedPartyQuote quote) {
    final busy = _busyId == quote.id;
    final guests = '${quote.childrenCount} niños · ${quote.adultsCount} adultos'
        '${quote.extraHalfHours > 0 ? ' · ${quote.extraHalfHours} media(s) hora extra' : ''}';
    return Container(
      key: Key('pos-fiestas-saved-quote-${quote.id}'),
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(border: Border.all(color: palette.border), borderRadius: BorderRadius.circular(8)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(quote.quoteNumber, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 13)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: palette.background, borderRadius: BorderRadius.circular(10)),
                child: Text(
                  _savedQuoteStatusLabel(quote.status),
                  key: Key('pos-fiestas-saved-quote-status-${quote.id}'),
                  style: TextStyle(color: palette.textSecondary, fontSize: 11, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text('${quote.packageName} · $guests', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
          if (quote.customerDisplayName != null)
            Text('Cliente: ${quote.customerDisplayName}', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
          if (quote.eventDate != null)
            Text('Fecha: ${quote.eventDate}', style: TextStyle(color: palette.textSecondary, fontSize: 12)),
          const SizedBox(height: 4),
          Text(
            _formatPartyMoney(quote.totalAmount, quote.currencyCode),
            key: Key('pos-fiestas-saved-quote-total-${quote.id}'),
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 15),
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 4,
            runSpacing: 0,
            children: [
              TextButton.icon(
                key: Key('pos-fiestas-saved-quote-print-${quote.id}'),
                onPressed: busy ? null : () => unawaited(_print(quote)),
                icon: const Icon(Icons.print_outlined, size: 16),
                label: const Text('Imprimir / PDF'),
              ),
              if (widget.canManage && quote.isDraft) ...[
                TextButton.icon(
                  key: Key('pos-fiestas-saved-quote-edit-${quote.id}'),
                  onPressed: busy ? null : () => widget.onEdit(quote),
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: const Text('Editar'),
                ),
                TextButton.icon(
                  key: Key('pos-fiestas-saved-quote-convert-${quote.id}'),
                  onPressed: busy ? null : () => widget.onConvert(quote),
                  icon: const Icon(Icons.event_available_outlined, size: 16),
                  label: const Text('Convertir a reservación'),
                ),
                TextButton.icon(
                  key: Key('pos-fiestas-saved-quote-cancel-${quote.id}'),
                  onPressed: busy ? null : () => unawaited(_cancel(quote)),
                  style: TextButton.styleFrom(foregroundColor: palette.error),
                  icon: const Icon(Icons.cancel_outlined, size: 16),
                  label: const Text('Cancelar'),
                ),
              ],
            ],
          ),
          if (quote.status == 'cancelled' && quote.cancelReason != null)
            Text('Motivo: ${quote.cancelReason}', style: TextStyle(color: palette.textMuted, fontSize: 11)),
        ],
      ),
    );
  }
}
