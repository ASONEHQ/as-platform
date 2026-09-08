/// TASK 14.5 (Wave 3, Phase 8), Item 1 -- "Ticket/receipt template config
/// (header/footer text)" (`docs/LEGACY_FUNCTIONAL_PARITY.md` §18, row
/// "Ticket/receipt template config"): a real, company-scoped settings
/// editor for the ALREADY-REAL `receipts.header_text`/
/// `receipts.footer_text` catalog entries (`settings.catalog.ts`) --
/// company/branch persistence and the full `GET .../settings/effective` /
/// `PUT .../settings/{key}` REST surface already existed before this task
/// (see `settings.routes.ts`); no backend or schema change was needed for
/// this screen. What was genuinely missing, and what this file closes, is
/// the FLUTTER side: no gateway or screen anywhere in `apps/one` ever
/// called the settings API, and `receipt_html.dart`/`refund_receipt_html
/// .dart` never rendered these two fields at all (both now accept
/// `headerText`/`footerText` -- see their own doc comments).
///
/// Deliberately a STANDALONE public file, not embedded in `pos_shell.dart`
/// -- mirrors `pos_suppliers_screen.dart`'s own exact rationale (that
/// file, TASK 14.4 Wave 2, is this screen's structural template): every
/// visual building block here is its own small private widget, styled
/// directly off the public [PosPalette] (`pos_tokens.dart`).
///
/// Scope decision (documented per this task's own instructions): this
/// screen edits the two text fields at COMPANY level only, via
/// `PUT /companies/{id}/settings/{key}` -- not branch level. The catalog
/// marks both keys `branchOverride: true`, so a per-branch override
/// already works through the exact same generic
/// `PUT /branches/{id}/settings/{key}` endpoint (`registerSettingsRoutes`
/// in `settings.routes.ts`) -- nothing about the backend or the resolution
/// mechanism (`settings.resolution.ts`) is company-only. Company-level was
/// chosen as the more natural default for THIS screen because a receipt
/// header/footer is normally one tenant-wide business identity (name/
/// slogan/return policy/tax disclaimer), not something that typically
/// varies location-to-location the way e.g. `operations.day_start_time`
/// legitimately does; a future per-branch override screen can reuse
/// [PosSettingsGateway] unchanged (it already accepts any company-scoped
/// key) by adding the equivalent `effectiveBranchSettings`/
/// `setBranchSetting` calls, which this gateway does not yet wrap (see
/// that file's own doc comment).
///
/// `receipts.show_company_tax_id` (also in the catalog, also
/// `branchOverride: true`) is DELIBERATELY NOT exposed on this screen:
/// nothing in `packages/database/src/schema/organizations.ts` (or
/// anywhere else in this codebase) stores a company tax ID at all, so
/// toggling this setting would have no observable effect on any receipt
/// today -- exposing a working-looking control for a field the platform
/// cannot yet render would be exactly the kind of fake-parity UI this
/// task's own Item 3 guidance says never to build. That toggle belongs
/// with a future CFDI/fiscal-data task (§11 "Facturación CFDI"), alongside
/// wherever a company tax ID first gets a real column.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_branding_screen.dart';
import 'pos_settings_gateway.dart';
import 'pos_tokens.dart';

const String _headerKey = 'receipts.header_text';
const String _footerKey = 'receipts.footer_text';
const int _maxLength = 500; // Mirrors `boundedString(500)` in settings.catalog.ts.

enum _BrandingPhase { loading, failure, ready }

/// The public "Marca del ticket" (receipt branding) screen. Constructed
/// with the real [AuthenticatedContext] and a real [PosSettingsGateway] --
/// see this file's header for the orchestrator wiring snippet this needs.
class PosReceiptBrandingScreen extends StatefulWidget {
  const PosReceiptBrandingScreen({required this.context, required this.settingsGateway, super.key});

  final AuthenticatedContext context;
  final PosSettingsGateway settingsGateway;

  @override
  State<PosReceiptBrandingScreen> createState() => _PosReceiptBrandingScreenState();
}

class _PosReceiptBrandingScreenState extends State<PosReceiptBrandingScreen> {
  _BrandingPhase _phase = _BrandingPhase.loading;
  String? _errorMessage;

  final _headerController = TextEditingController();
  final _footerController = TextEditingController();
  int _headerVersion = 1;
  int _footerVersion = 1;
  bool _saving = false;
  String? _saveError;
  String? _saveSuccess;
  bool _dirty = false;

  bool get _canRead => widget.context.permissions.contains('company_settings.read');
  bool get _canManage => widget.context.permissions.contains('company_settings.update');

  @override
  void initState() {
    super.initState();
    _headerController.addListener(_onEdited);
    _footerController.addListener(_onEdited);
    unawaited(_load());
  }

  @override
  void dispose() {
    _headerController.dispose();
    _footerController.dispose();
    super.dispose();
  }

  void _onEdited() {
    if (!_dirty) setState(() => _dirty = true);
  }

  // TASK 14.5 (Wave 3, Phase 8): [preserveSaveMessage] is set only by the
  // 409 `version_conflict` recovery path in [_save] -- a normal load
  // (initial open, or a manual "Actualizar" tap) always clears any
  // stale save banner, but the conflict reload's whole POINT is telling
  // the actor why their fields just changed out from under them, so
  // that specific message must survive this same reload that fetches
  // the fresh values, not be wiped by it. Deliberately keeps [_phase]
  // going through `loading` either way (never skips the spinner) -- only
  // the save banner text itself is preserved.
  Future<void> _load({bool preserveSaveMessage = false}) async {
    if (!_canRead) {
      setState(() => _phase = _BrandingPhase.failure);
      return;
    }
    final keptSaveError = preserveSaveMessage ? _saveError : null;
    setState(() {
      _phase = _BrandingPhase.loading;
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
        keys: const [_headerKey, _footerKey],
      );
      if (!mounted) return;
      final header = settings.where((s) => s.key == _headerKey).firstOrNull;
      final footer = settings.where((s) => s.key == _footerKey).firstOrNull;
      _headerController.value = TextEditingValue(text: header?.stringValue ?? '');
      _footerController.value = TextEditingValue(text: footer?.stringValue ?? '');
      setState(() {
        _headerVersion = header?.version ?? 1;
        _footerVersion = footer?.version ?? 1;
        _phase = _BrandingPhase.ready;
        _dirty = false;
        _saveError = keptSaveError;
        _saveSuccess = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _BrandingPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _BrandingPhase.failure;
        _errorMessage = 'No fue posible cargar la configuración del ticket.';
      });
    }
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
      final header = await widget.settingsGateway.setCompanySetting(
        companyId: companyId,
        key: _headerKey,
        value: _headerController.text,
        valueType: 'string',
        expectedVersion: _headerVersion,
      );
      final footer = await widget.settingsGateway.setCompanySetting(
        companyId: companyId,
        key: _footerKey,
        value: _footerController.text,
        valueType: 'string',
        expectedVersion: _footerVersion,
      );
      if (!mounted) return;
      setState(() {
        _headerVersion = header.version;
        _footerVersion = footer.version;
        _saving = false;
        _dirty = false;
        _saveSuccess = 'Cambios guardados.';
      });
    } on PosSettingVersionConflict {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saveError =
            'Otra sesión cambió esta configuración. Se recargaron los valores más recientes.';
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
                  'Marca del ticket',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              // RC certification (TASK 15.0, Phase 12 UX pass, finding
              // F2): `PosBrandingScreen` (the real logo upload/preview/
              // delete screen TASK 14.5A built) had zero navigation entry
              // point anywhere in the app -- confirmed by
              // `grep -rn "PosBrandingScreen(" apps/one/lib` returning no
              // call sites. This button is that entry point: it reuses
              // this screen's own `context`/`settingsGateway`, matching
              // `PosBrandingScreen`'s exact declared dependencies, so no
              // new gateway wiring was needed.
              TextButton.icon(
                key: const Key('pos-receipt-branding-open-logo'),
                onPressed: () => unawaited(
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => Scaffold(
                        appBar: AppBar(title: const Text('Logo del negocio')),
                        body: PosBrandingScreen(context: widget.context, settingsGateway: widget.settingsGateway),
                      ),
                    ),
                  ),
                ),
                icon: Icon(Icons.image_outlined, color: palette.action, size: 18),
                label: Text('Logo del negocio', style: TextStyle(color: palette.action, fontWeight: FontWeight.w700)),
              ),
              IconButton(
                key: const Key('pos-receipt-branding-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Texto de encabezado y pie de página que se imprime en cada ticket de venta y de reembolso. '
            'Usa "Logo del negocio" arriba para subir o quitar el logo que se imprime junto a este texto.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          switch (_phase) {
            _BrandingPhase.loading => const _BrandingLoadingState(),
            _BrandingPhase.failure => _BrandingFailureState(
              canRead: _canRead,
              message: _errorMessage,
              onRetry: () => unawaited(_load()),
            ),
            _BrandingPhase.ready => _BrandingForm(
              palette: palette,
              headerController: _headerController,
              footerController: _footerController,
              canManage: _canManage,
              saving: _saving,
              dirty: _dirty,
              saveError: _saveError,
              saveSuccess: _saveSuccess,
              onSave: () => unawaited(_save()),
            ),
          },
        ],
      ),
    );
  }
}

class _BrandingLoadingState extends StatelessWidget {
  const _BrandingLoadingState();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _BrandingFailureState extends StatelessWidget {
  const _BrandingFailureState({required this.canRead, required this.message, required this.onRetry});
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
                ? (message ?? 'No fue posible cargar la configuración del ticket.')
                : 'Tu sesión no incluye el permiso company_settings.read.',
            style: TextStyle(color: palette.error, fontSize: 13),
          ),
          if (canRead) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const Key('pos-receipt-branding-retry'),
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

class _BrandingForm extends StatelessWidget {
  const _BrandingForm({
    required this.palette,
    required this.headerController,
    required this.footerController,
    required this.canManage,
    required this.saving,
    required this.dirty,
    required this.saveError,
    required this.saveSuccess,
    required this.onSave,
  });

  final PosPalette palette;
  final TextEditingController headerController;
  final TextEditingController footerController;
  final bool canManage;
  final bool saving;
  final bool dirty;
  final String? saveError;
  final String? saveSuccess;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: palette.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: palette.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Encabezado',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            'Se imprime debajo del nombre y la sucursal, antes del detalle de la venta.',
            style: TextStyle(color: palette.textMuted, fontSize: 11),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('pos-receipt-branding-header-field'),
            controller: headerController,
            enabled: canManage && !saving,
            maxLength: _maxLength,
            maxLines: 3,
            minLines: 1,
            decoration: const InputDecoration(
              isDense: true,
              hintText: 'Ej. "Sucursal Centro" o un lema del negocio',
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'Pie de página',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            'Se imprime al final del ticket, antes de "¡Gracias por tu compra!".',
            style: TextStyle(color: palette.textMuted, fontSize: 11),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('pos-receipt-branding-footer-field'),
            controller: footerController,
            enabled: canManage && !saving,
            maxLength: _maxLength,
            maxLines: 4,
            minLines: 1,
            decoration: const InputDecoration(
              isDense: true,
              hintText: 'Ej. política de devoluciones, redes sociales, horario',
            ),
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
              key: const Key('pos-receipt-branding-save'),
              onPressed: canManage && !saving && dirty ? onSave : null,
              style: FilledButton.styleFrom(backgroundColor: palette.action),
              icon: saving
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.save_outlined, size: 16),
              label: const Text('Guardar'),
            ),
          ),
        ],
      ),
    );
  }
}
