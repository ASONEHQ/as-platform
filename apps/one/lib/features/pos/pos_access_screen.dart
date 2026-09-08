/// TASK 14.4 (Wave 2, Part E): "Control de Acceso" — the REAL replacement
/// for the legacy's own fake ticket scanner (`docs/LEGACY_FUNCTIONAL_
/// PARITY.md`'s Accesos section: the legacy `accScan()` accepted ANY input
/// and fabricated a random customer name, always reporting success — never
/// counted as a "real mechanism" this app ports; see
/// `pos_access_gateway.dart`'s own doc comment for the full forensic
/// context). Every action here is a real, honest round trip to
/// `access.routes.ts`: a scan either genuinely changes the credential's
/// state (and shows exactly what changed) or is rejected with the exact,
/// specific reason the backend gives (never a generic error, never an
/// implied success that didn't happen).
///
/// A fast, gate-staff-facing workflow (this task's own explicit design
/// goal): the scan field is auto-focused, a physical barcode-scanner's
/// Enter keypress submits it, and the field always clears and refocuses
/// after every scan — success or failure — so the next scan needs no extra
/// clicks.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_access_gateway.dart';
import 'pos_tokens.dart';

class PosAccessScreen extends StatefulWidget {
  const PosAccessScreen({required this.context, required this.accessGateway, super.key});

  final AuthenticatedContext context;
  final PosAccessGateway accessGateway;

  @override
  State<PosAccessScreen> createState() => _PosAccessScreenState();
}

enum _ListPhase { loading, empty, ready, failure }

sealed class _ScanOutcome {
  const _ScanOutcome();
}

class _ScanSuccess extends _ScanOutcome {
  const _ScanSuccess(this.result);
  final PosAccessScanResult result;
}

class _ScanFailure extends _ScanOutcome {
  const _ScanFailure(this.message);
  final String message;
}

class _PosAccessScreenState extends State<PosAccessScreen> {
  final _scanController = TextEditingController();
  final _scanFocusNode = FocusNode();
  bool _scanning = false;
  _ScanOutcome? _lastOutcome;

  int? _occupancyCount;
  bool _occupancyLoading = false;
  String? _occupancyError;

  _ListPhase _insidePhase = _ListPhase.loading;
  List<PosAccessCredential> _insideItems = const [];
  String? _insideCursor;
  bool _insideLoadingMore = false;
  String? _insideError;
  String? _voidBusyId;

  _ListPhase _eventsPhase = _ListPhase.loading;
  List<PosAccessEvent> _eventsItems = const [];
  String? _eventsCursor;
  bool _eventsLoadingMore = false;
  String? _eventsError;

  final _issueSaleIdController = TextEditingController();
  final _issueCustomerIdController = TextEditingController();
  bool _issueAllowsReentry = false;
  bool _issuing = false;
  String? _issueError;
  PosAccessCredential? _issuedCredential;

  String? get _branchId => widget.context.currentBranch?.id;
  bool get _canScan => widget.context.permissions.contains('access.scan');
  bool get _canRead => widget.context.permissions.contains('access.read');
  bool get _canManage => widget.context.permissions.contains('access.manage');

  @override
  void initState() {
    super.initState();
    if (_branchId != null && _canRead) {
      unawaited(_loadOccupancy());
      unawaited(_loadInside());
      unawaited(_loadEvents());
    }
  }

  @override
  void dispose() {
    _scanController.dispose();
    _scanFocusNode.dispose();
    _issueSaleIdController.dispose();
    _issueCustomerIdController.dispose();
    super.dispose();
  }

  void _refreshAll() {
    unawaited(_loadOccupancy());
    unawaited(_loadInside());
    unawaited(_loadEvents());
  }

  Future<void> _loadOccupancy() async {
    final branchId = _branchId;
    if (branchId == null || !_canRead) return;
    setState(() {
      _occupancyLoading = true;
      _occupancyError = null;
    });
    try {
      final count = await widget.accessGateway.occupancy(branchId: branchId);
      if (!mounted) return;
      setState(() {
        _occupancyCount = count;
        _occupancyLoading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _occupancyLoading = false;
        _occupancyError = posAccessErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _occupancyLoading = false;
        _occupancyError = 'No fue posible obtener el aforo actual.';
      });
    }
  }

  Future<void> _loadInside() async {
    final branchId = _branchId;
    if (branchId == null || !_canRead) return;
    setState(() {
      _insidePhase = _ListPhase.loading;
      _insideError = null;
    });
    try {
      final page = await widget.accessGateway.currentlyInside(branchId: branchId);
      if (!mounted) return;
      setState(() {
        _insideItems = page.items;
        _insideCursor = page.nextCursor;
        _insidePhase = _insideItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _insidePhase = _ListPhase.failure;
        _insideError = posAccessErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _insidePhase = _ListPhase.failure;
        _insideError = 'No fue posible cargar quién está dentro.';
      });
    }
  }

  Future<void> _loadMoreInside() async {
    final branchId = _branchId;
    final cursor = _insideCursor;
    if (branchId == null || cursor == null || _insideLoadingMore) return;
    setState(() => _insideLoadingMore = true);
    try {
      final page = await widget.accessGateway.currentlyInside(branchId: branchId, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _insideItems = [..._insideItems, ...page.items];
        _insideCursor = page.nextCursor;
        _insideLoadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _insideLoadingMore = false);
    }
  }

  Future<void> _loadEvents() async {
    final branchId = _branchId;
    if (branchId == null || !_canRead) return;
    setState(() {
      _eventsPhase = _ListPhase.loading;
      _eventsError = null;
    });
    try {
      final page = await widget.accessGateway.listEvents(branchId: branchId);
      if (!mounted) return;
      setState(() {
        _eventsItems = page.items;
        _eventsCursor = page.nextCursor;
        _eventsPhase = _eventsItems.isEmpty ? _ListPhase.empty : _ListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _eventsPhase = _ListPhase.failure;
        _eventsError = posAccessErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _eventsPhase = _ListPhase.failure;
        _eventsError = 'No fue posible cargar el historial de eventos.';
      });
    }
  }

  Future<void> _loadMoreEvents() async {
    final branchId = _branchId;
    final cursor = _eventsCursor;
    if (branchId == null || cursor == null || _eventsLoadingMore) return;
    setState(() => _eventsLoadingMore = true);
    try {
      final page = await widget.accessGateway.listEvents(branchId: branchId, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _eventsItems = [..._eventsItems, ...page.items];
        _eventsCursor = page.nextCursor;
        _eventsLoadingMore = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() => _eventsLoadingMore = false);
    }
  }

  /// The real scan action. Always clears and refocuses the scan field
  /// afterward — success or failure — so the next scan needs no extra
  /// clicks (this task's own explicit fast-workflow requirement).
  Future<void> _scan() async {
    final branchId = _branchId;
    final code = _scanController.text.trim();
    if (branchId == null || code.isEmpty || _scanning || !_canScan) return;
    setState(() => _scanning = true);
    try {
      final result = await widget.accessGateway.scan(branchId: branchId, code: code);
      if (!mounted) return;
      setState(() {
        _lastOutcome = _ScanSuccess(result);
        _scanning = false;
      });
      // A real state change just happened — refresh the authoritative
      // server-side occupancy/currently-inside/events so nothing on screen
      // drifts from what the gate just did.
      _refreshAll();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _lastOutcome = _ScanFailure(posAccessErrorMessage(error));
        _scanning = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _lastOutcome = const _ScanFailure('No fue posible registrar el escaneo.');
        _scanning = false;
      });
    }
    _scanController.clear();
    if (mounted) FocusScope.of(context).requestFocus(_scanFocusNode);
  }

  Future<void> _submitIssue() async {
    final branchId = _branchId;
    final saleId = _issueSaleIdController.text.trim();
    if (branchId == null || saleId.isEmpty || _issuing || !_canScan) return;
    setState(() {
      _issuing = true;
      _issueError = null;
    });
    try {
      final customerId = _issueCustomerIdController.text.trim();
      final credential = await widget.accessGateway.issueCredential(
        branchId: branchId,
        saleId: saleId,
        customerId: customerId.isEmpty ? null : customerId,
        allowsReentry: _issueAllowsReentry,
      );
      if (!mounted) return;
      setState(() {
        _issuedCredential = credential;
        _issuing = false;
        _issueSaleIdController.clear();
        _issueCustomerIdController.clear();
        _issueAllowsReentry = false;
      });
      _showAccessNotice(context, 'Pase ${credential.code} emitido.');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _issuing = false;
        _issueError = posAccessErrorMessage(error);
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _issuing = false;
        _issueError = 'No fue posible emitir el pase.';
      });
    }
  }

  /// Mirrors `AccessService.voidCredential`'s own real "cannot void while
  /// inside" rule (`credential_currently_inside`) — every credential
  /// offered here comes straight from the "currently inside" list, so this
  /// is exactly the honest rejection path the backend enforces, never a
  /// silently-forced implicit exit.
  Future<void> _voidCredential(PosAccessCredential credential) async {
    if (_voidBusyId != null || !_canManage) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Anular pase de acceso'),
        content: Text(
          '¿Anular el pase ${credential.code}? Esta acción no se puede deshacer.'
          '${credential.currentlyInside ? ' Este pase está actualmente DENTRO — el servidor '
                'rechazará la anulación hasta que se registre una salida.' : ''}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const Key('pos-access-void-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(backgroundColor: PosPalette.of(context).error),
            child: const Text('Anular'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _voidBusyId = credential.id);
    try {
      await widget.accessGateway.voidCredential(credential.id);
      if (!mounted) return;
      _showAccessNotice(context, 'Pase ${credential.code} anulado.');
      await _loadInside();
    } on ApiException catch (error) {
      if (!mounted) return;
      _showAccessNotice(context, posAccessErrorMessage(error));
    } on Object {
      if (!mounted) return;
      _showAccessNotice(context, 'No fue posible anular el pase.');
    } finally {
      if (mounted) setState(() => _voidBusyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_branchId == null) {
      return const _AccessBranchRequired();
    }
    return Column(
      key: const Key('pos-access-screen'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _AccessSectionHeader(
          title: 'Control de Acceso',
          description:
              'Registro real de entradas y salidas por pase — reemplaza el '
              'escáner de la versión anterior, que aceptaba cualquier '
              'código y siempre reportaba éxito.',
          action: _AccessRefreshButton(onPressed: _refreshAll),
        ),
        if (!_canRead)
          const _AccessPermissionState(
            message: 'Tu sesión no incluye el permiso access.read requerido.',
          )
        else
          _AccessOccupancyCard(
            count: _occupancyCount,
            loading: _occupancyLoading,
            error: _occupancyError,
          ),
        const SizedBox(height: 16),
        if (!_canScan)
          const _AccessPermissionState(
            message: 'Tu sesión no incluye el permiso access.scan requerido para escanear o emitir pases.',
          )
        else
          _buildScannerCard(),
        const SizedBox(height: 16),
        _buildInsideSection(),
        const SizedBox(height: 16),
        _buildEventsSection(),
      ],
    );
  }

  Widget _buildScannerCard() {
    final palette = PosPalette.of(context);
    return _AccessCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Escanear pase',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pos-access-scan-field'),
                  controller: _scanController,
                  focusNode: _scanFocusNode,
                  autofocus: true,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => unawaited(_scan()),
                  decoration: const InputDecoration(
                    hintText: 'Código del pase (o escanea aquí)',
                    prefixIcon: Icon(Icons.qr_code_scanner_outlined),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              FilledButton(
                key: const Key('pos-access-scan-submit'),
                onPressed: _scanning ? null : () => unawaited(_scan()),
                child: _scanning
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Registrar'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _ScanResultPanel(outcome: _lastOutcome),
          const SizedBox(height: 18),
          Divider(color: palette.border),
          const SizedBox(height: 10),
          Text(
            'Emitir nuevo pase',
            style: TextStyle(color: palette.text, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 3),
          Text(
            'Vincula el pase con una venta real ya pagada (sale_id).',
            style: TextStyle(color: palette.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  key: const Key('pos-access-issue-sale-id'),
                  controller: _issueSaleIdController,
                  decoration: const InputDecoration(hintText: 'ID de la venta (sale_id)'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  key: const Key('pos-access-issue-customer-id'),
                  controller: _issueCustomerIdController,
                  decoration: const InputDecoration(hintText: 'ID de cliente (opcional)'),
                ),
              ),
            ],
          ),
          Row(
            children: [
              Checkbox(
                key: const Key('pos-access-issue-allows-reentry'),
                value: _issueAllowsReentry,
                onChanged: (value) => setState(() => _issueAllowsReentry = value ?? false),
              ),
              const Expanded(child: Text('Permite reingreso (pase multiuso)')),
              FilledButton(
                key: const Key('pos-access-issue-submit'),
                onPressed: _issuing ? null : () => unawaited(_submitIssue()),
                child: _issuing
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Emitir pase'),
              ),
            ],
          ),
          if (_issueError != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                _issueError!,
                key: const Key('pos-access-issue-error'),
                style: TextStyle(color: palette.error, fontWeight: FontWeight.w600),
              ),
            ),
          if (_issuedCredential != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'Pase emitido: ${_issuedCredential!.code}',
                key: const Key('pos-access-issue-result'),
                style: TextStyle(color: palette.success, fontWeight: FontWeight.w700),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildInsideSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _AccessSectionHeader(
          title: 'Actualmente dentro',
          description: _canRead && (_insidePhase == _ListPhase.ready || _insidePhase == _ListPhase.empty)
              ? '${_insideItems.length} pase(s) actualmente dentro (mostrados).'
              : 'Quién está dentro ahora mismo, según el servidor.',
          action: _AccessRefreshButton(onPressed: () => unawaited(_loadInside())),
        ),
        if (!_canRead)
          const _AccessPermissionState(
            message: 'Tu sesión no incluye el permiso access.read requerido.',
          )
        else
          switch (_insidePhase) {
            _ListPhase.loading => const _AccessLoadingState(),
            _ListPhase.empty => const _AccessEmptyState(message: 'No hay nadie registrado como dentro.'),
            _ListPhase.failure => _AccessFailureState(
              message: _insideError ?? 'No fue posible cargar quién está dentro.',
              onRetry: () => unawaited(_loadInside()),
            ),
            _ListPhase.ready => _AccessCard(
              child: Column(
                key: const Key('pos-access-inside-list'),
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final credential in _insideItems)
                    _InsideRow(
                      key: ValueKey('pos-access-inside-row-${credential.id}'),
                      credential: credential,
                      canManage: _canManage,
                      busy: _voidBusyId == credential.id,
                      onVoid: () => unawaited(_voidCredential(credential)),
                    ),
                  if (_insideCursor != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Center(
                        child: TextButton.icon(
                          key: const Key('pos-access-inside-load-more'),
                          onPressed: _insideLoadingMore ? null : () => unawaited(_loadMoreInside()),
                          icon: _insideLoadingMore
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.expand_more),
                          label: const Text('Cargar más'),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          },
      ],
    );
  }

  Widget _buildEventsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _AccessSectionHeader(
          title: 'Eventos recientes',
          description: 'Historial inmutable de entradas y salidas — solo lectura.',
          action: _AccessRefreshButton(onPressed: () => unawaited(_loadEvents())),
        ),
        if (!_canRead)
          const _AccessPermissionState(
            message: 'Tu sesión no incluye el permiso access.read requerido.',
          )
        else
          switch (_eventsPhase) {
            _ListPhase.loading => const _AccessLoadingState(),
            _ListPhase.empty => const _AccessEmptyState(message: 'Todavía no hay eventos registrados.'),
            _ListPhase.failure => _AccessFailureState(
              message: _eventsError ?? 'No fue posible cargar el historial de eventos.',
              onRetry: () => unawaited(_loadEvents()),
            ),
            _ListPhase.ready => _AccessCard(
              child: Column(
                key: const Key('pos-access-events-list'),
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final event in _eventsItems)
                    _EventRow(key: ValueKey('pos-access-event-row-${event.id}'), event: event),
                  if (_eventsCursor != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Center(
                        child: TextButton.icon(
                          key: const Key('pos-access-events-load-more'),
                          onPressed: _eventsLoadingMore ? null : () => unawaited(_loadMoreEvents()),
                          icon: _eventsLoadingMore
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.expand_more),
                          label: const Text('Cargar más'),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          },
      ],
    );
  }
}

void _showAccessNotice(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 2)));
}

String _formatAccessDateTime(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

class _AccessCard extends StatelessWidget {
  const _AccessCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(color: palette.text.withValues(alpha: .06), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: child,
    );
  }
}

class _AccessSectionHeader extends StatelessWidget {
  const _AccessSectionHeader({required this.title, required this.description, this.action});
  final String title;
  final String description;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(color: palette.text, fontSize: 20, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 3),
                Text(description, style: TextStyle(color: palette.textSecondary)),
              ],
            ),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class _AccessRefreshButton extends StatelessWidget {
  const _AccessRefreshButton({required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.refresh, size: 17),
      label: const Text('Actualizar'),
      style: OutlinedButton.styleFrom(
        foregroundColor: palette.blueDeep,
        side: BorderSide(color: palette.border),
        minimumSize: const Size(36, 36),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
      ),
    );
  }
}

class _AccessStateCard extends StatelessWidget {
  const _AccessStateCard({required this.icon, required this.title, required this.message, this.action});
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _AccessCard(
      child: SizedBox(
        height: 150,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 34, color: palette.blueDeep),
              const SizedBox(height: 8),
              Text(title, style: TextStyle(color: palette.text, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(message, textAlign: TextAlign.center, style: TextStyle(color: palette.textSecondary)),
              if (action != null) ...[const SizedBox(height: 6), action!],
            ],
          ),
        ),
      ),
    );
  }
}

class _AccessLoadingState extends StatelessWidget {
  const _AccessLoadingState();
  @override
  Widget build(BuildContext context) => const _AccessCard(
    child: SizedBox(height: 150, child: Center(child: CircularProgressIndicator())),
  );
}

class _AccessEmptyState extends StatelessWidget {
  const _AccessEmptyState({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) =>
      _AccessStateCard(icon: Icons.inbox_outlined, title: 'Sin información', message: message);
}

class _AccessFailureState extends StatelessWidget {
  const _AccessFailureState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => _AccessStateCard(
    icon: Icons.error_outline,
    title: 'No fue posible cargar',
    message: message,
    action: TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Reintentar')),
  );
}

class _AccessPermissionState extends StatelessWidget {
  const _AccessPermissionState({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) =>
      _AccessStateCard(icon: Icons.lock_outline, title: 'Acceso no autorizado', message: message);
}

class _AccessBranchRequired extends StatelessWidget {
  const _AccessBranchRequired();
  @override
  Widget build(BuildContext context) => _AccessStateCard(
    icon: Icons.store_mall_directory_outlined,
    title: 'Selecciona una sucursal',
    message: 'El Control de Acceso trabaja sobre una sucursal concreta — '
        'selecciona una desde la barra superior para continuar.',
  );
}

class _AccessOccupancyCard extends StatelessWidget {
  const _AccessOccupancyCard({required this.count, required this.loading, required this.error});
  final int? count;
  final bool loading;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return _AccessCard(
      child: Row(
        children: [
          Icon(Icons.groups_outlined, size: 34, color: palette.blueDeep),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Aforo actual',
                  style: TextStyle(color: palette.textSecondary, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                if (loading && count == null)
                  const SizedBox(
                    height: 30,
                    width: 30,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else if (error != null && count == null)
                  Text(
                    error!,
                    key: const Key('pos-access-occupancy-error'),
                    style: TextStyle(color: palette.error, fontWeight: FontWeight.w600),
                  )
                else
                  Text(
                    '${count ?? 0}',
                    key: const Key('pos-access-occupancy-count'),
                    style: TextStyle(color: palette.text, fontSize: 34, fontWeight: FontWeight.w800),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ScanResultPanel extends StatelessWidget {
  const _ScanResultPanel({required this.outcome});
  final _ScanOutcome? outcome;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final outcome = this.outcome;
    if (outcome == null) {
      return Container(
        key: const Key('pos-access-scan-result'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: palette.actionTint,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: palette.border),
        ),
        child: Row(
          children: [
            Icon(Icons.qr_code_scanner_outlined, color: palette.textMuted),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Escanea o escribe un código para registrar la entrada o salida.',
                style: TextStyle(color: palette.textSecondary),
              ),
            ),
          ],
        ),
      );
    }
    if (outcome is _ScanSuccess) {
      final credential = outcome.result.credential;
      final event = outcome.result.event;
      final isEntry = event.isEntry;
      return Container(
        key: const Key('pos-access-scan-result'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: palette.success.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: palette.success),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(isEntry ? Icons.login : Icons.logout, color: palette.success, size: 30),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isEntry ? 'Entrada registrada' : 'Salida registrada',
                    key: const Key('pos-access-scan-success-label'),
                    style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 18),
                  ),
                  const SizedBox(height: 4),
                  Text('Pase: ${credential.code}', style: TextStyle(color: palette.textSecondary)),
                  if (credential.customerId != null)
                    Text('Cliente: ${credential.customerId}', style: TextStyle(color: palette.textSecondary)),
                  if (credential.saleId != null)
                    Text('Venta: ${credential.saleId}', style: TextStyle(color: palette.textSecondary)),
                  Text(
                    _formatAccessDateTime(event.occurredAt),
                    style: TextStyle(color: palette.textMuted, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }
    final failure = outcome as _ScanFailure;
    return Container(
      key: const Key('pos-access-scan-result'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: palette.error.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: palette.error),
      ),
      child: Row(
        children: [
          Icon(Icons.block, color: palette.error, size: 30),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              failure.message,
              key: const Key('pos-access-scan-error'),
              style: TextStyle(color: palette.error, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _InsideRow extends StatelessWidget {
  const _InsideRow({
    required this.credential,
    required this.canManage,
    required this.busy,
    required this.onVoid,
    super.key,
  });
  final PosAccessCredential credential;
  final bool canManage;
  final bool busy;
  final VoidCallback onVoid;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(Icons.badge_outlined, color: palette.blueDeep, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(credential.code, style: TextStyle(color: palette.text, fontWeight: FontWeight.w700)),
                Text(
                  credential.customerId != null
                      ? 'Cliente: ${credential.customerId}'
                      : credential.saleId != null
                      ? 'Venta: ${credential.saleId}'
                      : 'Sin cliente asociado',
                  style: TextStyle(color: palette.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          Text(
            _formatAccessDateTime(credential.issuedAt),
            style: TextStyle(color: palette.textMuted, fontSize: 12),
          ),
          const SizedBox(width: 10),
          Tooltip(
            message: !canManage
                ? 'Requiere el permiso access.manage.'
                : 'Anular — el servidor rechazará la anulación mientras este '
                      'pase siga marcado como dentro.',
            child: TextButton(
              key: Key('pos-access-void-${credential.id}'),
              onPressed: canManage && !busy ? onVoid : null,
              style: TextButton.styleFrom(foregroundColor: palette.error),
              child: busy
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Anular'),
            ),
          ),
        ],
      ),
    );
  }
}

class _EventRow extends StatelessWidget {
  const _EventRow({required this.event, super.key});
  final PosAccessEvent event;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final isEntry = event.isEntry;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(
            isEntry ? Icons.login : Icons.logout,
            color: isEntry ? palette.success : palette.warning,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              isEntry ? 'Entrada' : 'Salida',
              style: TextStyle(color: palette.text, fontWeight: FontWeight.w700),
            ),
          ),
          Text(
            _formatAccessDateTime(event.occurredAt),
            style: TextStyle(color: palette.textMuted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
