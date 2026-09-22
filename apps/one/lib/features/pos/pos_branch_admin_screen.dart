/// TASK 15.1 (commercial admin UX closure) — "Sucursales" screen: a real
/// branch list (create + edit), closing the gap `docs/RC_RELEASE_INVENTORY
/// .md`'s TENANT section documented: `GET/POST /api/v1/companies/{id}/
/// branches` and `GET/PATCH /api/v1/branches/{id}` were real, permission-
/// gated, tenant-scoped, DB-backed backend capabilities with no Flutter
/// admin surface at all — `BranchSelectionScreen`
/// (`apps/one/lib/features/authentication/screens.dart`) only ever READS/
/// selects an already-existing branch at login time. A commercial park
/// owner opening a second location previously had no way to create one
/// from the product UI.
///
/// Structural template: `pos_suppliers_screen.dart`'s own list + "+ Nueva"
/// create/edit dialog + row-tap detail dialog shape (TASK 14.4, Wave 2) —
/// deliberately a STANDALONE public file, not embedded in `pos_shell.dart`
/// (another part of this same task wires this screen into
/// `pos_shell.dart`/`pos_navigation.dart` afterward, sequentially, to avoid
/// collisions — see this task's own constraints), so every visual building
/// block here is its own small private widget, styled directly off the
/// public [PosPalette] (`pos_tokens.dart`), matching `pos_suppliers_screen
/// .dart`'s exact rationale for staying standalone.
///
/// Diverges from `pos_suppliers_screen.dart` only where the real branch
/// contract itself does (see `pos_branch_admin_gateway.dart`'s own header):
///   * No search box and no status filter dropdown at the list level — the
///     `GET .../branches` route accepts no querystring filters at all
///     (unlike suppliers' `status`), so there is nothing honest to filter
///     by; the full permitted list is always shown.
///   * No "load more" — the list route returns every permitted branch in
///     one response, no pagination.
///   * No deactivate action in the detail dialog — there is no dedicated
///     deactivate endpoint for branches (unlike suppliers' own
///     `POST .../deactivate`); a status change (`active`/`inactive`/
///     `closed`) is just one more field on the same edit form, gated the
///     same as every other edit, on `branch.update`.
///   * Two distinct write permissions gate two distinct actions —
///     `branch.create` gates "Nueva sucursal", `branch.update` gates
///     "Editar" in the detail dialog — never a single combined permission
///     the way `supplier.manage` covers both create and edit.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/networking/api_client.dart';
import '../authentication/auth_models.dart';
import 'pos_branch_admin_gateway.dart';
import 'pos_tokens.dart';

enum _BranchListPhase { loading, empty, failure, ready }

/// TASK 16.8B — a curated, human-readable shortlist of real, valid IANA
/// timezone identifiers, presented as a searchable picker so an operator
/// never has to guess/type a raw zone string by hand (the production
/// incident this task fixes: a branch was saved with `"Mexico_City"`,
/// which looks plausible but is not a real IANA identifier — the real one
/// is `"America/Mexico_City"`). TASK 16.17: the field is now a strict
/// picker — free text can no longer be submitted; only a value chosen from
/// this list (or, when editing, the branch's own already-saved zone) is
/// accepted, so a non-IANA string can never reach the backend from this
/// form. The backend's `isValidIanaTimezone` check remains authoritative.
class _TimezoneOption {
  const _TimezoneOption(this.value, this.label);

  /// The canonical IANA identifier — exactly what gets persisted.
  final String value;

  /// A short, human-readable Spanish description shown in the picker.
  final String label;
}

const _timezoneOptions = <_TimezoneOption>[
  // México.
  _TimezoneOption('America/Mexico_City', 'Ciudad de México, Querétaro, Guadalajara (Zona Centro)'),
  _TimezoneOption('America/Cancun', 'Cancún, Quintana Roo (Zona Sureste)'),
  _TimezoneOption('America/Merida', 'Mérida, Yucatán'),
  _TimezoneOption('America/Monterrey', 'Monterrey, Nuevo León'),
  _TimezoneOption('America/Chihuahua', 'Chihuahua'),
  _TimezoneOption('America/Hermosillo', 'Hermosillo, Sonora (sin horario de verano)'),
  _TimezoneOption('America/Mazatlan', 'Mazatlán, Sinaloa, Baja California Sur, Nayarit (Zona Pacífico)'),
  _TimezoneOption('America/Bahia_Banderas', 'Bahía de Banderas, Nayarit'),
  _TimezoneOption('America/Tijuana', 'Tijuana, Baja California (Zona Noroeste)'),
  _TimezoneOption('America/Matamoros', 'Matamoros, Tamaulipas'),
  _TimezoneOption('UTC', 'UTC (horario universal coordinado)'),
  // Resto de América (orden alfabético por identificador).
  _TimezoneOption('America/Argentina/Buenos_Aires', 'Buenos Aires, Argentina'),
  _TimezoneOption('America/Asuncion', 'Asunción, Paraguay'),
  _TimezoneOption('America/Bogota', 'Bogotá, Colombia'),
  _TimezoneOption('America/Caracas', 'Caracas, Venezuela'),
  _TimezoneOption('America/Chicago', 'Chicago, EE. UU. (hora central)'),
  _TimezoneOption('America/Costa_Rica', 'San José, Costa Rica'),
  _TimezoneOption('America/Denver', 'Denver, EE. UU. (hora de las montañas)'),
  _TimezoneOption('America/El_Salvador', 'San Salvador, El Salvador'),
  _TimezoneOption('America/Guatemala', 'Ciudad de Guatemala, Guatemala'),
  _TimezoneOption('America/Guayaquil', 'Guayaquil, Ecuador'),
  _TimezoneOption('America/Halifax', 'Halifax, Canadá (hora del Atlántico)'),
  _TimezoneOption('America/Havana', 'La Habana, Cuba'),
  _TimezoneOption('America/Jamaica', 'Kingston, Jamaica'),
  _TimezoneOption('America/La_Paz', 'La Paz, Bolivia'),
  _TimezoneOption('America/Lima', 'Lima, Perú'),
  _TimezoneOption('America/Los_Angeles', 'Los Ángeles, EE. UU. (hora del Pacífico)'),
  _TimezoneOption('America/Managua', 'Managua, Nicaragua'),
  _TimezoneOption('America/Montevideo', 'Montevideo, Uruguay'),
  _TimezoneOption('America/New_York', 'Nueva York, EE. UU. (hora del este)'),
  _TimezoneOption('America/Panama', 'Ciudad de Panamá, Panamá'),
  _TimezoneOption('America/Phoenix', 'Phoenix, EE. UU. (Arizona, sin horario de verano)'),
  _TimezoneOption('America/Puerto_Rico', 'San Juan, Puerto Rico'),
  _TimezoneOption('America/Santiago', 'Santiago, Chile'),
  _TimezoneOption('America/Santo_Domingo', 'Santo Domingo, República Dominicana'),
  _TimezoneOption('America/Sao_Paulo', 'São Paulo, Brasil'),
  _TimezoneOption('America/Tegucigalpa', 'Tegucigalpa, Honduras'),
  _TimezoneOption('America/Toronto', 'Toronto, Canadá'),
  _TimezoneOption('America/Vancouver', 'Vancouver, Canadá'),
  // Europa.
  _TimezoneOption('Europe/Amsterdam', 'Ámsterdam, Países Bajos'),
  _TimezoneOption('Europe/Athens', 'Atenas, Grecia'),
  _TimezoneOption('Europe/Berlin', 'Berlín, Alemania'),
  _TimezoneOption('Europe/Brussels', 'Bruselas, Bélgica'),
  _TimezoneOption('Europe/Dublin', 'Dublín, Irlanda'),
  _TimezoneOption('Europe/Helsinki', 'Helsinki, Finlandia'),
  _TimezoneOption('Europe/Istanbul', 'Estambul, Turquía'),
  _TimezoneOption('Europe/Lisbon', 'Lisboa, Portugal'),
  _TimezoneOption('Europe/London', 'Londres, Reino Unido'),
  _TimezoneOption('Europe/Madrid', 'Madrid, España'),
  _TimezoneOption('Europe/Moscow', 'Moscú, Rusia'),
  _TimezoneOption('Europe/Paris', 'París, Francia'),
  _TimezoneOption('Europe/Prague', 'Praga, República Checa'),
  _TimezoneOption('Europe/Rome', 'Roma, Italia'),
  _TimezoneOption('Europe/Stockholm', 'Estocolmo, Suecia'),
  _TimezoneOption('Europe/Vienna', 'Viena, Austria'),
  _TimezoneOption('Europe/Warsaw', 'Varsovia, Polonia'),
  _TimezoneOption('Europe/Zurich', 'Zúrich, Suiza'),
  // Asia.
  _TimezoneOption('Asia/Bangkok', 'Bangkok, Tailandia'),
  _TimezoneOption('Asia/Dubai', 'Dubái, Emiratos Árabes Unidos'),
  _TimezoneOption('Asia/Hong_Kong', 'Hong Kong'),
  _TimezoneOption('Asia/Jakarta', 'Yakarta, Indonesia'),
  _TimezoneOption('Asia/Jerusalem', 'Jerusalén, Israel'),
  _TimezoneOption('Asia/Kolkata', 'Calcuta / Nueva Delhi, India'),
  _TimezoneOption('Asia/Manila', 'Manila, Filipinas'),
  _TimezoneOption('Asia/Seoul', 'Seúl, Corea del Sur'),
  _TimezoneOption('Asia/Shanghai', 'Shanghái / Pekín, China'),
  _TimezoneOption('Asia/Singapore', 'Singapur'),
  _TimezoneOption('Asia/Tokyo', 'Tokio, Japón'),
  // África.
  _TimezoneOption('Africa/Cairo', 'El Cairo, Egipto'),
  _TimezoneOption('Africa/Johannesburg', 'Johannesburgo, Sudáfrica'),
  _TimezoneOption('Africa/Lagos', 'Lagos, Nigeria'),
  _TimezoneOption('Africa/Nairobi', 'Nairobi, Kenia'),
  // Oceanía.
  _TimezoneOption('Australia/Melbourne', 'Melbourne, Australia'),
  _TimezoneOption('Australia/Perth', 'Perth, Australia'),
  _TimezoneOption('Australia/Sydney', 'Sídney, Australia'),
  _TimezoneOption('Pacific/Auckland', 'Auckland, Nueva Zelanda'),
  _TimezoneOption('Pacific/Honolulu', 'Honolulu, Hawái'),
];

/// The public "Sucursales" module screen. Constructed with the real
/// [AuthenticatedContext] and a real [PosBranchAdminGateway].
class PosBranchAdminScreen extends StatefulWidget {
  const PosBranchAdminScreen({required this.context, required this.branchAdminGateway, super.key});

  final AuthenticatedContext context;
  final PosBranchAdminGateway branchAdminGateway;

  @override
  State<PosBranchAdminScreen> createState() => _PosBranchAdminScreenState();
}

class _PosBranchAdminScreenState extends State<PosBranchAdminScreen> {
  _BranchListPhase _phase = _BranchListPhase.loading;
  List<PosBranch> _items = const [];
  String? _errorMessage;

  bool get _canRead => widget.context.permissions.contains('branch.read');
  bool get _canCreate => widget.context.permissions.contains('branch.create');
  bool get _canUpdate => widget.context.permissions.contains('branch.update');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  // Mirrors `pos_suppliers_screen.dart`'s own `_load` guard exactly: a
  // missing `branch.read` never calls the gateway at all, and `build`
  // renders the honest [_BranchPermissionState] by checking `_canRead`
  // directly rather than through `_phase`.
  Future<void> _load() async {
    if (!_canRead) return;
    setState(() {
      _phase = _BranchListPhase.loading;
      _errorMessage = null;
    });
    try {
      final items = await widget.branchAdminGateway.listBranches(companyId: widget.context.session.companyId);
      if (!mounted) return;
      setState(() {
        _items = items;
        _phase = items.isEmpty ? _BranchListPhase.empty : _BranchListPhase.ready;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _phase = _BranchListPhase.failure;
        _errorMessage = error.failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _phase = _BranchListPhase.failure;
        _errorMessage = 'No fue posible cargar las sucursales.';
      });
    }
  }

  Future<void> _openNewBranchForm() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BranchFormDialog(
        companyId: widget.context.session.companyId,
        branchAdminGateway: widget.branchAdminGateway,
      ),
    );
    if (saved == true) unawaited(_load());
  }

  Future<void> _openDetail(PosBranch branch) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BranchDetailDialog(
        branch: branch,
        canUpdate: _canUpdate,
        companyId: widget.context.session.companyId,
        branchAdminGateway: widget.branchAdminGateway,
      ),
    );
    if (changed == true) unawaited(_load());
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
                  'Sucursales',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 20),
                ),
              ),
              IconButton(
                key: const Key('pos-branch-admin-refresh'),
                tooltip: 'Actualizar',
                onPressed: () => unawaited(_load()),
                icon: Icon(Icons.refresh, color: palette.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Sucursales de la empresa — alta y edición.',
            style: TextStyle(color: palette.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (!_canRead)
            const _BranchPermissionState()
          else ...[
            Align(
              alignment: Alignment.centerRight,
              child: Tooltip(
                message: _canCreate ? 'Nueva sucursal' : 'Tu sesión no incluye el permiso branch.create.',
                child: FilledButton.icon(
                  key: const Key('pos-branch-admin-new'),
                  onPressed: _canCreate ? () => unawaited(_openNewBranchForm()) : null,
                  style: FilledButton.styleFrom(backgroundColor: palette.action),
                  icon: const Icon(Icons.add_business_outlined, size: 16),
                  label: const Text('Nueva'),
                ),
              ),
            ),
            const SizedBox(height: 14),
            switch (_phase) {
              _BranchListPhase.loading => const _BranchLoadingState(),
              _BranchListPhase.empty => const _BranchEmptyState(),
              _BranchListPhase.failure => _BranchFailureState(
                message: _errorMessage ?? 'No fue posible cargar las sucursales.',
                onRetry: () => unawaited(_load()),
              ),
              _BranchListPhase.ready => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final branch in _items)
                    _BranchRow(branch: branch, onTap: () => unawaited(_openDetail(branch))),
                ],
              ),
            },
          ],
        ],
      ),
    );
  }
}

class _BranchRow extends StatelessWidget {
  const _BranchRow({required this.branch, required this.onTap});
  final PosBranch branch;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Card(
      key: Key('pos-branch-admin-row-${branch.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: palette.border)),
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
                    Text(
                      branch.name,
                      style: TextStyle(color: palette.text, fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${branch.code} · ${branch.timezone}',
                      style: TextStyle(color: palette.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              _BranchStatusChip(status: branch.status),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, size: 18, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _BranchStatusChip extends StatelessWidget {
  const _BranchStatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final active = status == 'active';
    final color = active ? palette.success : palette.textMuted;
    final label = switch (status) {
      'active' => 'Activa',
      'inactive' => 'Inactiva',
      'closed' => 'Cerrada',
      _ => status,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }
}

/// New/edit branch dialog — `código`/`nombre`/`zona horaria` are required
/// on create (mirroring `branches.routes.ts`'s own create body schema);
/// `estado` only appears when editing an existing branch (creation always
/// starts `active` server-side, per `createBranch`'s own hardcoded insert).
class _BranchFormDialog extends StatefulWidget {
  const _BranchFormDialog({required this.companyId, required this.branchAdminGateway, this.existing});
  final String companyId;
  final PosBranchAdminGateway branchAdminGateway;
  final PosBranch? existing;

  @override
  State<_BranchFormDialog> createState() => _BranchFormDialogState();
}

class _BranchFormDialogState extends State<_BranchFormDialog> {
  late final _codeController = TextEditingController(text: widget.existing?.code ?? '');
  late final _nameController = TextEditingController(text: widget.existing?.name ?? '');
  late final _timezoneController = TextEditingController(text: widget.existing?.timezone ?? '');
  // TASK 16.8B — `Autocomplete`'s own `RawAutocomplete` asserts that
  // `textEditingController` and `focusNode` are either both supplied or
  // both omitted; supplying the controller (so `_submit()` keeps reading
  // the exact same field it always has) requires supplying this too.
  final _timezoneFocusNode = FocusNode();
  late String _status = widget.existing?.status ?? 'active';
  bool _busy = false;
  String? _error;
  String? _timezoneError;

  bool get _isEdit => widget.existing != null;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _timezoneController.dispose();
    _timezoneFocusNode.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    final name = _nameController.text.trim();
    final timezone = _timezoneController.text.trim();
    if (code.isEmpty || name.isEmpty || timezone.isEmpty) {
      setState(() => _error = 'Código, nombre y zona horaria son obligatorios.');
      return;
    }
    // TASK 16.17 — only a value picked from the list (or, when editing, the
    // branch's own already-saved zone) may be submitted: free text such as
    // "Mexico_City" is blocked here, before any gateway call.
    final timezoneAllowed =
        _timezoneOptions.any((option) => option.value == timezone) ||
        (_isEdit && timezone == widget.existing!.timezone);
    if (!timezoneAllowed) {
      setState(() {
        _error = null;
        _timezoneError = 'Elige una zona horaria de la lista.';
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _timezoneError = null;
    });
    final input = PosBranchInput(
      code: code,
      name: name,
      timezone: timezone,
      status: _isEdit ? _status : null,
    );
    try {
      if (_isEdit) {
        await widget.branchAdminGateway.updateBranch(widget.existing!.id, input);
      } else {
        await widget.branchAdminGateway.createBranch(companyId: widget.companyId, input: input);
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
        _error = 'No fue posible guardar la sucursal.';
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
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 560),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _isEdit ? 'Editar sucursal' : 'Nueva sucursal',
                  style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('pos-branch-admin-form-code'),
                  controller: _codeController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Código'),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const Key('pos-branch-admin-form-name'),
                  controller: _nameController,
                  decoration: const InputDecoration(isDense: true, labelText: 'Nombre'),
                ),
                const SizedBox(height: 10),
                // TASK 16.8B — a searchable picker over a curated list of
                // real, valid IANA identifiers (`_timezoneOptions`), so an
                // operator can find "Ciudad de México" and get the real
                // `America/Mexico_City` written into the field instead of
                // guessing a raw zone string by hand. `textEditingController:
                // _timezoneController` keeps this the exact same underlying
                // field `_submit()` already reads from — typing a real IANA
                // value directly (this is a commercial multi-tenant
                // platform; not every real tenant's timezone is in this
                // shortlist) still works exactly as before. The backend's
                // own `isValidIanaTimezone` check remains the sole
                // authority regardless of what this picker suggests.
                Autocomplete<_TimezoneOption>(
                  key: const Key('pos-branch-admin-form-timezone-picker'),
                  textEditingController: _timezoneController,
                  focusNode: _timezoneFocusNode,
                  displayStringForOption: (option) => option.value,
                  onSelected: (_) {
                    if (_timezoneError != null) setState(() => _timezoneError = null);
                  },
                  optionsBuilder: (textEditingValue) {
                    final query = textEditingValue.text.trim().toLowerCase();
                    if (query.isEmpty) return _timezoneOptions;
                    return _timezoneOptions.where(
                      (option) =>
                          option.value.toLowerCase().contains(query) ||
                          option.label.toLowerCase().contains(query),
                    );
                  },
                  optionsViewBuilder: (context, onSelected, options) {
                    final list = options.toList(growable: false);
                    return Align(
                      alignment: Alignment.topLeft,
                      child: Material(
                        elevation: 4,
                        borderRadius: BorderRadius.circular(8),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 260, maxWidth: 380),
                          child: ListView.builder(
                            padding: EdgeInsets.zero,
                            shrinkWrap: true,
                            itemCount: list.length,
                            itemBuilder: (context, index) {
                              final option = list[index];
                              return ListTile(
                                key: Key('pos-branch-admin-form-timezone-option-${option.value}'),
                                dense: true,
                                title: Text(option.label),
                                subtitle: Text(option.value, style: const TextStyle(fontSize: 11)),
                                onTap: () => onSelected(option),
                              );
                            },
                          ),
                        ),
                      ),
                    );
                  },
                  fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) => TextField(
                    key: const Key('pos-branch-admin-form-timezone'),
                    controller: controller,
                    focusNode: focusNode,
                    onChanged: (_) {
                      if (_timezoneError != null) setState(() => _timezoneError = null);
                    },
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Zona horaria',
                      hintText: 'Busca por ciudad, ej. Ciudad de México',
                    ),
                  ),
                ),
                if (_timezoneError != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    _timezoneError!,
                    key: const Key('pos-branch-admin-form-timezone-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                if (_isEdit) ...[
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    key: const Key('pos-branch-admin-form-status'),
                    initialValue: _status,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, labelText: 'Estado'),
                    items: const [
                      DropdownMenuItem(value: 'active', child: Text('Activa')),
                      DropdownMenuItem(value: 'inactive', child: Text('Inactiva')),
                      DropdownMenuItem(value: 'closed', child: Text('Cerrada')),
                    ],
                    onChanged: (value) => setState(() => _status = value ?? 'active'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    key: const Key('pos-branch-admin-form-error'),
                    style: TextStyle(color: palette.error, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('pos-branch-admin-form-cancel'),
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: palette.textSecondary,
                          side: BorderSide(color: palette.border),
                        ),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        key: const Key('pos-branch-admin-form-save'),
                        onPressed: _busy ? null : () => unawaited(_submit()),
                        style: FilledButton.styleFrom(backgroundColor: palette.action),
                        child: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Guardar'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Branch detail — the full record plus a single Editar action, gated on
/// the real `branch.update` permission (never merely hidden by a
/// client-side guess — stays visible-but-disabled with a [Tooltip]
/// explaining why, mirroring `pos_suppliers_screen.dart`'s
/// `_SupplierDetailDialog` own established disabled+[Tooltip] pattern).
class _BranchDetailDialog extends StatefulWidget {
  const _BranchDetailDialog({
    required this.branch,
    required this.canUpdate,
    required this.companyId,
    required this.branchAdminGateway,
  });
  final PosBranch branch;
  final bool canUpdate;
  final String companyId;
  final PosBranchAdminGateway branchAdminGateway;

  @override
  State<_BranchDetailDialog> createState() => _BranchDetailDialogState();
}

class _BranchDetailDialogState extends State<_BranchDetailDialog> {
  late PosBranch _branch = widget.branch;
  bool _changed = false;

  Future<void> _edit() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _BranchFormDialog(
        companyId: widget.companyId,
        branchAdminGateway: widget.branchAdminGateway,
        existing: _branch,
      ),
    );
    if (saved != true || !mounted) return;
    setState(() => _changed = true);
    try {
      final refreshed = await widget.branchAdminGateway.branch(_branch.id);
      if (!mounted) return;
      setState(() => _branch = refreshed);
    } on Object {
      // The edit itself already succeeded — a failed refresh here just
      // means the dialog keeps showing the pre-edit snapshot; the caller
      // still reloads the real list on close via `_changed`, mirroring
      // `pos_suppliers_screen.dart`'s `_SupplierDetailDialog._edit`.
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    final branch = _branch;
    return Dialog(
      backgroundColor: palette.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440, maxHeight: 480),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        branch.name,
                        key: const Key('pos-branch-admin-detail-name'),
                        style: TextStyle(color: palette.text, fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                    ),
                    _BranchStatusChip(status: branch.status),
                  ],
                ),
                const SizedBox(height: 14),
                _BranchDetailField(label: 'Código', value: branch.code),
                _BranchDetailField(label: 'Zona horaria', value: branch.timezone),
                const SizedBox(height: 4),
                Text(
                  'Creada ${_formatTimestamp(branch.createdAt)} · Actualizada ${_formatTimestamp(branch.updatedAt)}',
                  style: TextStyle(color: palette.textMuted, fontSize: 11),
                ),
                const SizedBox(height: 16),
                Tooltip(
                  message: widget.canUpdate ? 'Editar sucursal' : 'Tu sesión no incluye el permiso branch.update.',
                  child: OutlinedButton.icon(
                    key: const Key('pos-branch-admin-detail-edit'),
                    onPressed: widget.canUpdate ? () => unawaited(_edit()) : null,
                    icon: const Icon(Icons.edit_outlined, size: 16),
                    label: const Text('Editar'),
                  ),
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    key: const Key('pos-branch-admin-detail-close'),
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

class _BranchDetailField extends StatelessWidget {
  const _BranchDetailField({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(label, style: TextStyle(color: palette.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value, style: TextStyle(color: palette.text, fontSize: 13))),
        ],
      ),
    );
  }
}

class _BranchLoadingState extends StatelessWidget {
  const _BranchLoadingState();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 40),
    child: Center(child: CircularProgressIndicator()),
  );
}

class _BranchEmptyState extends StatelessWidget {
  const _BranchEmptyState();
  @override
  Widget build(BuildContext context) {
    final palette = PosPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Center(
        child: Text('No hay sucursales registradas.', style: TextStyle(color: palette.textMuted, fontSize: 13)),
      ),
    );
  }
}

class _BranchFailureState extends StatelessWidget {
  const _BranchFailureState({required this.message, required this.onRetry});
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
            Text(message, style: TextStyle(color: palette.error, fontSize: 13)),
            const SizedBox(height: 10),
            OutlinedButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}

class _BranchPermissionState extends StatelessWidget {
  const _BranchPermissionState();
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
              style: TextStyle(color: palette.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

String _formatTimestamp(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}
