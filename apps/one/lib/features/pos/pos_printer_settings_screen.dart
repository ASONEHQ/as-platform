/// TASK 16.7B — "Sistema → Hardware / Impresora de Tickets" (task spec
/// items G/H/I): closes the receipt-printer readiness gap the forensic
/// audit found. The printing MECHANISM was already real end-to-end
/// (`receipt_html.dart`'s `buildReceiptHtml` → `receipt_print_web.dart`'s
/// `openReceiptPrintWindow`, a direct, deliberate port of the legacy's own
/// real `window.open` + `document.write` + `window.print()` pattern — see
/// ADR-0012). What was genuinely missing was any place for a tenant to
/// configure their own physical printer's paper width, and any way to
/// verify a freshly-connected printer BEFORE trusting it with a real sale.
///
/// Architecture decision (task spec item H): browser/OS print dialog,
/// letting the operator pick whatever ticketera is already installed as a
/// Windows printer. This is deliberately NOT a WebUSB/WebSerial direct
/// device connection and NOT a local native print-agent -- the task spec
/// itself names this exact "generate printable receipt -> browser/OS
/// print dialog -> select the installed ticketera" path as fully
/// acceptable for V1, and this codebase already committed to it in
/// ADR-0012 before this task existed. No printer model, VID/PID, IP, USB
/// port, or Windows printer name is ever hardcoded here or anywhere in
/// this screen -- the browser's own print dialog is where the operator
/// picks their actual hardware, exactly like `AS POS V1.html`'s real
/// `imprimirTicketActual()` always did. A future local print agent (for
/// silent/ESC-POS/auto-cut printing) can be added later without changing
/// this screen's own contract: it already only produces a self-contained
/// HTML document and hands it to `openReceiptPrintWindow` -- a future
/// agent-based path would simply be a second implementation of that same
/// narrow interface, not a rewrite of this screen.
///
/// Only the paper width (58mm/80mm -- a real hardware fact, not a
/// preference) is configurable here; nothing about "which physical
/// device" is a setting this platform can safely represent yet (per the
/// forensic audit: the legacy's own equivalent hardware-config screen was
/// 100% fake -- a hardcoded device list with a toast-only "Verificar"
/// button -- so this deliberately does not recreate that fiction).
///
/// Structural template: `pos_receipt_branding_screen.dart` (same
/// `PosSettingsGateway`-backed load/save shape, same private
/// loading/failure/form-state split).
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_settings_gateway.dart';
import 'pos_tokens.dart';
import 'receipt_print.dart';
import 'test_print_html.dart';

const String _paperWidthKey = 'receipts.paper_width_mm';
const String _headerKey = 'receipts.header_text';
const String _footerKey = 'receipts.footer_text';
const String _logoKey = 'branding.logo_url';

enum _PrinterSettingsPhase { loading, failure, ready }

class PosPrinterSettingsScreen extends StatefulWidget {
  const PosPrinterSettingsScreen({required this.context, required this.settingsGateway, super.key});

  final AuthenticatedContext context;
  final PosSettingsGateway settingsGateway;

  @override
  State<PosPrinterSettingsScreen> createState() => _PosPrinterSettingsScreenState();
}

class _PosPrinterSettingsScreenState extends State<PosPrinterSettingsScreen> {
  _PrinterSettingsPhase _phase = _PrinterSettingsPhase.loading;
  String? _errorMessage;

  String _paperWidth = '80';
  int _paperWidthVersion = 1;
  String? _headerText;
  String? _footerText;
  String? _logoUrl;
  bool _saving = false;
  String? _saveError;
  String? _saveSuccess;
  bool _dirty = false;
  bool _printingTest = false;
  String? _printError;

  bool get _canRead => widget.context.permissions.contains('company_settings.read');
  bool get _canManage => widget.context.permissions.contains('company_settings.update');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load({bool preserveSaveMessage = false}) async {
    if (!_canRead) {
      setState(() => _phase = _PrinterSettingsPhase.failure);
      return;
    }
    final keptSaveError = preserveSaveMessage ? _saveError : null;
    setState(() {
      _phase = _PrinterSettingsPhase.loading;
      _errorMessage = null;
      if (!preserveSaveMessage) {
        _saveError = null;
        _saveSuccess = null;
      }
    });
    try {
      final companyId = widget.context.session.companyId;
      final settings = await widget.settingsGateway.effectiveCompanySettings(
        companyId: companyId,
        keys: const [_paperWidthKey, _headerKey, _footerKey, _logoKey],
      );
      if (!mounted) return;
      final paperWidth = settings.where((s) => s.key == _paperWidthKey).firstOrNull;
      final header = settings.where((s) => s.key == _headerKey).firstOrNull;
      final footer = settings.where((s) => s.key == _footerKey).firstOrNull;
      final logo = settings.where((s) => s.key == _logoKey).firstOrNull;
      setState(() {
        _paperWidth = paperWidth?.stringValue ?? '80';
        _paperWidthVersion = paperWidth?.version ?? 1;
        _headerText = header?.stringValue;
        _footerText = footer?.stringValue;
        final logoUrl = logo?.stringValue;
        _logoUrl = (logoUrl == null || logoUrl.isEmpty) ? null : logoUrl;
        _phase = _PrinterSettingsPhase.ready;
        _dirty = false;
        _saveError = keptSaveError;
        _saveSuccess = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _PrinterSettingsPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _PrinterSettingsPhase.failure;
        _errorMessage = 'No fue posible cargar la configuración de la impresora.';
      });
    }
  }

  void _selectPaperWidth(String value) {
    if (value == _paperWidth) return;
    setState(() {
      _paperWidth = value;
      _dirty = true;
    });
  }

  Future<void> _save() async {
    if (!_canManage || _saving) return;
    setState(() {
      _saving = true;
      _saveError = null;
      _saveSuccess = null;
    });
    final companyId = widget.context.session.companyId;
    try {
      final saved = await widget.settingsGateway.setCompanySetting(
        companyId: companyId,
        key: _paperWidthKey,
        value: _paperWidth,
        valueType: 'string',
        expectedVersion: _paperWidthVersion,
      );
      if (!mounted) return;
      setState(() {
        _paperWidthVersion = saved.version;
        _saving = false;
        _dirty = false;
        _saveSuccess = 'Cambios guardados.';
      });
    } on PosSettingVersionConflict {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saveError = 'Otra sesión cambió esta configuración. Se recargaron los valores más recientes.';
      });
      unawaited(_load(preserveSaveMessage: true));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saveError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saveError = 'No fue posible guardar los cambios.';
      });
    }
  }

  // TASK 16.7B (item I): zero financial/operational side effects by
  // construction -- this handler never calls `salesGateway`, `cashGateway`,
  // or any inventory-affecting endpoint (it has no reference to any of
  // them at all), never generates a real sale folio, and
  // `openReceiptPrintWindow` only ever opens a new, separate browser tab
  // and writes static HTML into it -- there is nothing here that could
  // reach the backend even by accident.
  Future<void> _printTest() async {
    if (_printingTest) return;
    setState(() {
      _printingTest = true;
      _printError = null;
    });
    final html = buildTestPrintHtml(
      businessName: widget.context.currentCompany?.name ?? 'AS ONE POS',
      branchName: widget.context.currentBranch?.name ?? '',
      cashierName: widget.context.user.displayName,
      paperWidthMm: double.tryParse(_paperWidth) ?? 80,
      logoDataUri: _logoUrl,
      headerText: _headerText,
      footerText: _footerText,
    );
    final opened = openReceiptPrintWindow(html);
    if (!mounted) return;
    setState(() {
      _printingTest = false;
      _printError = opened
          ? null
          : 'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para imprimir.';
    });
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
                  'Impresora de Tickets',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-printer-settings-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Configura el ancho de papel de tu ticketera térmica e imprime un ticket de prueba antes de '
            'usarla con ventas reales. La impresión usa el diálogo de impresión del navegador -- selecciona '
            'ahí la impresora ya instalada en Windows.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          switch (_phase) {
            _PrinterSettingsPhase.loading => const _PrinterSettingsLoadingState(),
            _PrinterSettingsPhase.failure => _PrinterSettingsFailureState(
              canRead: _canRead,
              message: _errorMessage,
              onRetry: () => unawaited(_load()),
            ),
            _PrinterSettingsPhase.ready => _PrinterSettingsForm(
              palette: palette,
              paperWidth: _paperWidth,
              onSelectPaperWidth: _selectPaperWidth,
              canManage: _canManage,
              saving: _saving,
              dirty: _dirty,
              saveError: _saveError,
              saveSuccess: _saveSuccess,
              onSave: () => unawaited(_save()),
              printingTest: _printingTest,
              printError: _printError,
              onPrintTest: () => unawaited(_printTest()),
            ),
          },
        ],
      ),
    );
  }
}

class _PrinterSettingsLoadingState extends StatelessWidget {
  const _PrinterSettingsLoadingState();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _PrinterSettingsFailureState extends StatelessWidget {
  const _PrinterSettingsFailureState({required this.canRead, required this.message, required this.onRetry});
  final bool canRead;
  final String? message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: palette.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: palette.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            canRead
                ? (message ?? 'No fue posible cargar la configuración de la impresora.')
                : 'Tu sesión no incluye el permiso company_settings.read.',
            style: TextStyle(color: palette.error, fontSize: 13),
          ),
          if (canRead) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const Key('pos-printer-settings-retry'),
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Reintentar'),
            ),
          ],
        ],
      ),
    );
  }
}

class _PrinterSettingsForm extends StatelessWidget {
  const _PrinterSettingsForm({
    required this.palette,
    required this.paperWidth,
    required this.onSelectPaperWidth,
    required this.canManage,
    required this.saving,
    required this.dirty,
    required this.saveError,
    required this.saveSuccess,
    required this.onSave,
    required this.printingTest,
    required this.printError,
    required this.onPrintTest,
  });

  final PosPalette palette;
  final String paperWidth;
  final ValueChanged<String> onSelectPaperWidth;
  final bool canManage;
  final bool saving;
  final bool dirty;
  final String? saveError;
  final String? saveSuccess;
  final VoidCallback onSave;
  final bool printingTest;
  final String? printError;
  final VoidCallback onPrintTest;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: palette.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: palette.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Ancho de papel',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            'Debe coincidir con el rollo de papel de tu ticketera térmica.',
            style: TextStyle(color: palette.textMuted, fontSize: 11),
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            key: const Key('pos-printer-settings-paper-width'),
            segments: const [
              ButtonSegment(value: '58', label: Text('58mm')),
              ButtonSegment(value: '80', label: Text('80mm')),
            ],
            selected: {paperWidth},
            onSelectionChanged: canManage ? (value) => onSelectPaperWidth(value.first) : null,
          ),
          const SizedBox(height: 14),
          if (!canManage)
            Text(
              'Tu sesión no incluye el permiso company_settings.update -- solo lectura.',
              style: TextStyle(color: palette.textMuted, fontSize: 12),
            ),
          if (saveError != null) ...[
            const SizedBox(height: 4),
            Text(saveError!, style: TextStyle(color: palette.error, fontSize: 12)),
          ],
          if (saveSuccess != null && saveError == null) ...[
            const SizedBox(height: 4),
            Text(saveSuccess!, style: TextStyle(color: palette.success, fontSize: 12)),
          ],
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              key: const Key('pos-printer-settings-save'),
              onPressed: canManage && !saving && dirty ? onSave : null,
              style: FilledButton.styleFrom(backgroundColor: palette.action),
              icon: saving
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save_outlined, size: 16),
              label: const Text('Guardar'),
            ),
          ),
          const SizedBox(height: 18),
          Divider(color: palette.border),
          const SizedBox(height: 14),
          Text(
            'Ticket de prueba',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            'Imprime un ticket claramente marcado como prueba -- no crea ninguna venta, no descuenta '
            'inventario y no afecta la caja. Úsalo para comprobar ancho, tipografía, logo y márgenes antes '
            'de una venta real.',
            style: TextStyle(color: palette.textMuted, fontSize: 11),
          ),
          const SizedBox(height: 10),
          if (printError != null) ...[
            Text(printError!, style: TextStyle(color: palette.error, fontSize: 12)),
            const SizedBox(height: 6),
          ],
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('pos-printer-settings-print-test'),
              onPressed: printingTest ? null : onPrintTest,
              icon: printingTest
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.print_outlined, size: 16),
              label: const Text('Imprimir ticket de prueba'),
            ),
          ),
        ],
      ),
    );
  }
}
