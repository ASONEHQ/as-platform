/// TASK 14.5A -- legacy parity for `AS POS V1.html`'s
/// `cfgNegocioLogoSeleccionado()`/`aplicarBrandingNegocio()`: a real
/// operator picks a real image file, previews it, uploads it, and the
/// result is really persisted as the company's `branding.logo_url`
/// setting through `POST /companies/{id}/branding/logo`
/// (`branding.routes.ts`) -- the backend/schema half this task also adds
/// (`settings.catalog.ts`, `branding.storage.ts`/`.service.ts`/
/// `.routes.ts`). This file closes the FLUTTER side: no gateway or screen
/// anywhere in `apps/one` called that endpoint before this task.
///
/// Deliberately a STANDALONE public file, not embedded in `pos_shell.dart`
/// -- mirrors `pos_receipt_branding_screen.dart`'s own exact rationale
/// (itself modeled on `pos_suppliers_screen.dart`): every visual building
/// block here is its own small private widget, styled directly off the
/// public [PosPalette] (`pos_tokens.dart`). `pos_receipt_branding_screen
/// .dart` is this screen's own direct structural template (phase enum,
/// loading/failure/form states, `canRead`/`canManage` permission gating,
/// version-conflict recovery) -- this screen's own differences are all
/// about the underlying value being a picked image file instead of typed
/// text: an [ImagePicker] pick (`image_picker`, web-compatible -- see
/// `pubspec.yaml`'s own doc comment; `apps/one` targets Flutter Web only)
/// replaces the two `TextField`s, a live preview (`Image.memory` for the
/// just-picked bytes, `Image.network` for the already-persisted URL)
/// replaces the plain text display, and a distinct "Eliminar logo" action
/// exists because, unlike receipt text, there is no "type it back to
/// empty" gesture for an image.
///
/// Wiring note (explicitly out of scope here, per this task's own
/// instructions): this screen only UPLOADS/CLEARS `branding.logo_url` and
/// shows its own preview -- actually rendering that URL in the POS
/// topbar/printed receipts is a separate sibling task's job (see this
/// task's own "another agent will separately wire the logo" note), not
/// touched by this file.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_settings_gateway.dart';
import 'pos_tokens.dart';

const String _logoKey = 'branding.logo_url';

/// Mirrors `branding.validation.ts`'s own `ALLOWED_LOGO_CONTENT_TYPES` --
/// client-side validation is a fast, friendly first check only; the
/// backend's own signature-sniffing check
/// (`matchesLogoFileSignature`) stays the real authority and is never
/// duplicated here.
const List<String> _allowedContentTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/// Mirrors `branding.validation.ts`'s own `MAX_LOGO_BYTES`.
const int _maxLogoBytes = 2 * 1024 * 1024;

enum _BrandingPhase { loading, failure, ready }

/// The public "Logo del negocio" (business logo) screen. Constructed with
/// the real [AuthenticatedContext] and a real [PosSettingsGateway] -- see
/// `pos_receipt_branding_screen.dart` for this same wiring convention.
/// Picks one image file and returns it, or `null` if the operator
/// cancelled -- the real default (see [PosBrandingScreen.pickImage])
/// wraps a real [ImagePicker]; a test supplies a fake instead, since a
/// real [ImagePicker] pumps a real platform file-picker dialog no widget
/// test can drive.
typedef LogoFilePicker = Future<XFile?> Function();

class PosBrandingScreen extends StatefulWidget {
  const PosBrandingScreen({required this.context, required this.settingsGateway, this.pickImage, super.key});

  final AuthenticatedContext context;
  final PosSettingsGateway settingsGateway;

  /// Overridable only for tests -- production callers never pass this,
  /// matching this app's other screens' own "inject the real dependency,
  /// default to constructing it" convention.
  final LogoFilePicker? pickImage;

  @override
  State<PosBrandingScreen> createState() => _PosBrandingScreenState();
}

class _PosBrandingScreenState extends State<PosBrandingScreen> {
  _BrandingPhase _phase = _BrandingPhase.loading;
  String? _errorMessage;

  String _logoUrl = '';
  int _logoVersion = 1;

  Uint8List? _pickedBytes;
  String? _pickedFilename;
  String? _pickedContentType;
  String? _pickError;

  bool _saving = false;
  bool _deleting = false;
  String? _actionError;
  String? _actionSuccess;

  late final LogoFilePicker _pickImageImpl =
      widget.pickImage ?? (() => ImagePicker().pickImage(source: ImageSource.gallery));

  bool get _canRead => widget.context.permissions.contains('company_settings.read');
  bool get _canManage => widget.context.permissions.contains('company_settings.update');
  bool get _hasPersistedLogo => _logoUrl.isNotEmpty;
  bool get _hasPickedLogo => _pickedBytes != null;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  // TASK 14.5A: [preserveActionMessage] is set only by the 409
  // `version_conflict` recovery path in [_upload]/[_delete] -- a normal
  // load (initial open, or a manual refresh tap) always clears any stale
  // action banner, but the conflict reload's whole POINT is telling the
  // operator why the logo just changed out from under them, so that
  // specific message must survive this same reload that fetches the
  // fresh version, not be wiped by it. Mirrors
  // `pos_receipt_branding_screen.dart`'s own `preserveSaveMessage`.
  Future<void> _load({bool preserveActionMessage = false}) async {
    if (!_canRead) {
      setState(() => _phase = _BrandingPhase.failure);
      return;
    }
    final keptActionError = preserveActionMessage ? _actionError : null;
    setState(() {
      _phase = _BrandingPhase.loading;
      _errorMessage = null;
      if (!preserveActionMessage) {
        _actionError = null;
        _actionSuccess = null;
      }
    });
    try {
      final companyId = widget.context.session.companyId;
      final settings = await widget.settingsGateway.effectiveCompanySettings(
        companyId: companyId,
        keys: const [_logoKey],
      );
      if (!mounted) return;
      final logo = settings.where((s) => s.key == _logoKey).firstOrNull;
      setState(() {
        _logoUrl = logo?.stringValue ?? '';
        _logoVersion = logo?.version ?? 1;
        _phase = _BrandingPhase.ready;
        _pickedBytes = null;
        _pickedFilename = null;
        _pickedContentType = null;
        _pickError = null;
        _actionError = keptActionError;
        _actionSuccess = null;
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
        _errorMessage = 'No fue posible cargar el logo del negocio.';
      });
    }
  }

  Future<void> _pickImage() async {
    if (!_canManage || _saving) return;
    setState(() {
      _pickError = null;
      _actionError = null;
      _actionSuccess = null;
    });
    try {
      final picked = await _pickImageImpl();
      if (picked == null) return; // Operator cancelled the file dialog.
      final bytes = await picked.readAsBytes();
      final contentType = picked.mimeType ?? _guessContentType(picked.name);
      if (contentType == null || !_allowedContentTypes.contains(contentType)) {
        setState(() {
          _pickError = 'Formato no soportado. Usa PNG, JPEG, WEBP o SVG.';
        });
        return;
      }
      if (bytes.length > _maxLogoBytes) {
        setState(() {
          _pickError = 'La imagen supera el tamaño máximo de 2 MB.';
        });
        return;
      }
      if (!mounted) return;
      setState(() {
        _pickedBytes = bytes;
        _pickedFilename = picked.name;
        _pickedContentType = contentType;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _pickError = 'No fue posible abrir el selector de imágenes.');
    }
  }

  Future<void> _upload() async {
    final bytes = _pickedBytes;
    final contentType = _pickedContentType;
    if (!_canManage || _saving || bytes == null || contentType == null) return;
    setState(() {
      _saving = true;
      _actionError = null;
      _actionSuccess = null;
    });
    try {
      final companyId = widget.context.session.companyId;
      final result = await widget.settingsGateway.uploadCompanyLogo(
        companyId: companyId,
        bytes: bytes,
        filename: _pickedFilename ?? 'logo',
        contentType: contentType,
        expectedVersion: _logoVersion,
      );
      if (!mounted) return;
      setState(() {
        _logoUrl = result.stringValue ?? '';
        _logoVersion = result.version;
        _saving = false;
        _pickedBytes = null;
        _pickedFilename = null;
        _pickedContentType = null;
        _actionSuccess = 'Logo actualizado.';
      });
    } on PosSettingVersionConflict {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _actionError = 'Otra sesión cambió el logo. Se recargó el valor más reciente.';
      });
      unawaited(_load(preserveActionMessage: true));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _actionError = _uploadErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _actionError = 'No fue posible subir el logo.';
      });
    }
  }

  Future<void> _delete() async {
    if (!_canManage || _deleting || !_hasPersistedLogo) return;
    setState(() {
      _deleting = true;
      _actionError = null;
      _actionSuccess = null;
    });
    try {
      final companyId = widget.context.session.companyId;
      final result = await widget.settingsGateway.deleteCompanyLogo(
        companyId: companyId,
        expectedVersion: _logoVersion,
      );
      if (!mounted) return;
      setState(() {
        _logoUrl = result.stringValue ?? '';
        _logoVersion = result.version;
        _deleting = false;
        _actionSuccess = 'Logo eliminado.';
      });
    } on PosSettingVersionConflict {
      if (!mounted) return;
      setState(() {
        _deleting = false;
        _actionError = 'Otra sesión cambió el logo. Se recargó el valor más reciente.';
      });
      unawaited(_load(preserveActionMessage: true));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _deleting = false;
        _actionError = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _deleting = false;
        _actionError = 'No fue posible eliminar el logo.';
      });
    }
  }

  void _cancelPick() {
    setState(() {
      _pickedBytes = null;
      _pickedFilename = null;
      _pickedContentType = null;
      _pickError = null;
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
                  'Logo del negocio',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-branding-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Imagen que se usa como marca del negocio en el punto de venta y en los tickets.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          switch (_phase) {
            _BrandingPhase.loading => const _LoadingState(),
            _BrandingPhase.failure => _FailureState(
              canRead: _canRead,
              message: _errorMessage,
              onRetry: () => unawaited(_load()),
            ),
            _BrandingPhase.ready => _LogoForm(
              palette: palette,
              canManage: _canManage,
              persistedLogoUrl: _logoUrl,
              pickedBytes: _pickedBytes,
              pickError: _pickError,
              saving: _saving,
              deleting: _deleting,
              actionError: _actionError,
              actionSuccess: _actionSuccess,
              onPick: () => unawaited(_pickImage()),
              onCancelPick: _cancelPick,
              onUpload: _hasPickedLogo ? () => unawaited(_upload()) : null,
              onDelete: _hasPersistedLogo ? () => unawaited(_delete()) : null,
            ),
          },
        ],
      ),
    );
  }
}

/// Best-effort content-type guess from a filename extension, used only
/// when [XFile.mimeType] comes back `null` (some platforms/browsers omit
/// it) -- the backend's own signature check is the real authority
/// regardless of what this guesses.
String? _guessContentType(String filename) {
  final lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

/// Turns a rejected upload's real backend status into an honest,
/// specific Spanish message -- `AppFailure.fromCode` has no dedicated
/// entry for `unsupported_media_type`/`payload_too_large` (both fall
/// through to its generic fallback text), so this builds the specific
/// message from the real HTTP status this task's own backend returns
/// (415/413) instead of showing something misleadingly generic.
String _uploadErrorMessage(ApiException error) {
  switch (error.statusCode) {
    case 415:
      return 'Ese archivo no es una imagen válida (PNG, JPEG, WEBP o SVG).';
    case 413:
      return 'La imagen supera el tamaño máximo de 2 MB.';
    case 409:
      return 'Otra sesión cambió el logo. Se recargó el valor más reciente.';
    default:
      return error.failure.message;
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _FailureState extends StatelessWidget {
  const _FailureState({required this.canRead, required this.message, required this.onRetry});
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
                ? (message ?? 'No fue posible cargar el logo del negocio.')
                : 'Tu sesión no incluye el permiso company_settings.read.',
            style: TextStyle(color: palette.error, fontSize: 13),
          ),
          if (canRead) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const Key('pos-branding-retry'),
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

class _LogoForm extends StatelessWidget {
  const _LogoForm({
    required this.palette,
    required this.canManage,
    required this.persistedLogoUrl,
    required this.pickedBytes,
    required this.pickError,
    required this.saving,
    required this.deleting,
    required this.actionError,
    required this.actionSuccess,
    required this.onPick,
    required this.onCancelPick,
    required this.onUpload,
    required this.onDelete,
  });

  final PosPalette palette;
  final bool canManage;
  final String persistedLogoUrl;
  final Uint8List? pickedBytes;
  final String? pickError;
  final bool saving;
  final bool deleting;
  final String? actionError;
  final String? actionSuccess;
  final VoidCallback onPick;
  final VoidCallback onCancelPick;
  final VoidCallback? onUpload;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final busy = saving || deleting;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: palette.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: palette.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Vista previa',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
          ),
          const SizedBox(height: 8),
          _LogoPreview(palette: palette, pickedBytes: pickedBytes, persistedLogoUrl: persistedLogoUrl),
          const SizedBox(height: 14),
          if (pickError != null) ...[
            Text(pickError!, style: TextStyle(color: palette.error, fontSize: 12)),
            const SizedBox(height: 8),
          ],
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                key: const Key('pos-branding-pick'),
                onPressed: canManage && !busy ? onPick : null,
                icon: const Icon(Icons.image_outlined, size: 16),
                label: Text(pickedBytes == null ? 'Elegir imagen' : 'Elegir otra imagen'),
              ),
              if (pickedBytes != null)
                TextButton(
                  key: const Key('pos-branding-cancel-pick'),
                  onPressed: busy ? null : onCancelPick,
                  child: const Text('Cancelar selección'),
                ),
              if (pickedBytes != null)
                FilledButton.icon(
                  key: const Key('pos-branding-upload'),
                  onPressed: canManage && !busy ? onUpload : null,
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: saving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.upload_outlined, size: 16),
                  label: const Text('Subir logo'),
                ),
              if (persistedLogoUrl.isNotEmpty)
                OutlinedButton.icon(
                  key: const Key('pos-branding-delete'),
                  onPressed: canManage && !busy ? onDelete : null,
                  style: OutlinedButton.styleFrom(foregroundColor: palette.error),
                  icon: deleting
                      ? SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2, color: palette.error),
                        )
                      : const Icon(Icons.delete_outline, size: 16),
                  label: const Text('Eliminar logo'),
                ),
            ],
          ),
          if (!canManage) ...[
            const SizedBox(height: 10),
            Text(
              'Tu sesión no incluye el permiso company_settings.update -- solo lectura.',
              style: TextStyle(color: palette.textMuted, fontSize: 12),
            ),
          ],
          if (actionError != null) ...[
            const SizedBox(height: 10),
            Text(actionError!, style: TextStyle(color: palette.error, fontSize: 12)),
          ],
          if (actionSuccess != null && actionError == null) ...[
            const SizedBox(height: 10),
            Text(actionSuccess!, style: TextStyle(color: palette.success, fontSize: 12)),
          ],
        ],
      ),
    );
  }
}

class _LogoPreview extends StatelessWidget {
  const _LogoPreview({required this.palette, required this.pickedBytes, required this.persistedLogoUrl});

  final PosPalette palette;
  final Uint8List? pickedBytes;
  final String persistedLogoUrl;

  @override
  Widget build(BuildContext context) {
    final bytes = pickedBytes;
    Widget image;
    if (bytes != null) {
      image = Image.memory(
        bytes,
        key: const Key('pos-branding-preview-picked'),
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) => _EmptyPreview(palette: palette),
      );
    } else if (persistedLogoUrl.isNotEmpty) {
      image = Image.network(
        persistedLogoUrl,
        key: const Key('pos-branding-preview-persisted'),
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) => _EmptyPreview(palette: palette),
      );
    } else {
      image = _EmptyPreview(palette: palette);
    }
    return Container(
      key: const Key('pos-branding-preview'),
      height: 120,
      width: double.infinity,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: palette.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: palette.border),
      ),
      child: Padding(padding: const EdgeInsets.all(10), child: image),
    );
  }
}

class _EmptyPreview extends StatelessWidget {
  const _EmptyPreview({required this.palette});
  final PosPalette palette;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(Icons.image_not_supported_outlined, color: palette.textMuted, size: 28),
      const SizedBox(height: 6),
      Text('Sin logo configurado', style: TextStyle(color: palette.textMuted, fontSize: 12)),
    ],
  );
}
