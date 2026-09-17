/// TASK 16.7B — widget tests for the standalone `PosPrinterSettingsScreen`
/// ("Impresora de Tickets"): loading/saving the real effective
/// `receipts.paper_width_mm` company setting, permission-gating for an
/// actor without `company_settings.update` (read-only, never hidden), and
/// — the load-bearing requirement from the task spec — that "Imprimir
/// ticket de prueba" has ZERO financial/operational side effects: this
/// test double exposes only `PosSettingsGateway` (no sales/cash/inventory
/// gateway exists anywhere in this screen's dependency graph at all), so a
/// side effect on any of those is structurally impossible, not merely
/// untested. Mirrors `pos_receipt_branding_test.dart`'s own
/// `_RecordingSettingsGateway` fixture convention exactly.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_printer_settings_screen.dart';
import 'package:as_one/features/pos/pos_settings_gateway.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _readOnly = ['company_settings.read'];
const _readWrite = ['company_settings.read', 'company_settings.update'];

void main() {
  group('TASK 16.7B — load', () {
    testWidgets('renders the real backend default of 80mm for a never-configured company', (tester) async {
      // The real backend (`settings.catalog.ts`'s `receipts.paper_width_mm`,
      // `resolveDefault: constantDefault('80')`) returns `value: '80'`,
      // `source: 'default'` for a company that never set this key — never
      // an empty string. Seeded explicitly here rather than relying on
      // this fake's own generic (key-agnostic) empty-string fallback,
      // which does not simulate any specific key's real catalog default.
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.paper_width_mm': _defaultSeed('receipts.paper_width_mm', '80')},
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      final segmented = tester.widget<SegmentedButton<String>>(
        find.byKey(const Key('pos-printer-settings-paper-width')),
      );
      expect(segmented.selected, {'80'});
    });

    testWidgets('renders a real 58mm setting as selected', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.paper_width_mm': _seed('receipts.paper_width_mm', '58', version: 4)},
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      final segmented = tester.widget<SegmentedButton<String>>(
        find.byKey(const Key('pos-printer-settings-paper-width')),
      );
      expect(segmented.selected, {'58'});
    });

    testWidgets('no company_settings.read shows the honest permission state, never calls the gateway', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.textContaining('company_settings.read'), findsOneWidget);
      expect(gateway.effectiveCalls, 0);
    });
  });

  group('TASK 16.7B — save', () {
    testWidgets('selecting 58mm and saving calls setCompanySetting with the real loaded version', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.paper_width_mm': _seed('receipts.paper_width_mm', '80', version: 3)},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.text('58mm'));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-printer-settings-save')));
      await tester.pumpAndSettle();

      expect(gateway.setCalls, hasLength(1));
      expect(gateway.setCalls.single.key, 'receipts.paper_width_mm');
      expect(gateway.setCalls.single.value, '58');
      expect(gateway.setCalls.single.expectedVersion, 3);
      expect(find.text('Cambios guardados.'), findsOneWidget);
    });

    testWidgets('a 409 version_conflict surfaces an honest message and reloads — never a silent overwrite', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.paper_width_mm': _seed('receipts.paper_width_mm', '80', version: 1)},
        conflictOnKey: 'receipts.paper_width_mm',
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.text('58mm'));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-printer-settings-save')));
      await tester.pumpAndSettle();

      expect(find.textContaining('Otra sesión cambió'), findsOneWidget);
    });

    testWidgets('no company_settings.update disables Guardar and the segmented selector — read-only, never hidden', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      final button = tester.widget<FilledButton>(find.byKey(const Key('pos-printer-settings-save')));
      expect(button.onPressed, isNull);
      final segmented = tester.widget<SegmentedButton<String>>(
        find.byKey(const Key('pos-printer-settings-paper-width')),
      );
      expect(segmented.onSelectionChanged, isNull);
      expect(gateway.setCalls, isEmpty);
    });

    testWidgets('Guardar stays disabled until the paper width is actually changed', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.paper_width_mm': _seed('receipts.paper_width_mm', '80', version: 1)},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      final before = tester.widget<FilledButton>(find.byKey(const Key('pos-printer-settings-save')));
      expect(before.onPressed, isNull);

      await tester.tap(find.text('58mm'));
      await tester.pump();

      final after = tester.widget<FilledButton>(find.byKey(const Key('pos-printer-settings-save')));
      expect(after.onPressed, isNotNull);
    });
  });

  group('TASK 16.7B — test print has zero financial/operational side effects', () {
    testWidgets('tapping "Imprimir ticket de prueba" never calls a settings write, and touches only the print window', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.paper_width_mm': _seed('receipts.paper_width_mm', '80', version: 1)},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-printer-settings-print-test')));
      // On the Dart VM (this test), `openReceiptPrintWindow` is the
      // stub implementation (no `dart:js_interop`/`package:web` browser
      // available) and honestly returns `false` — never a fabricated
      // success — which this screen surfaces as a real, visible error
      // rather than a silent no-op. The real, load-bearing assertion is
      // that no setting was ever written and no gateway call happened as
      // a side effect of printing.
      await tester.pumpAndSettle();

      expect(gateway.setCalls, isEmpty);
      expect(
        find.textContaining('El navegador bloqueó la ventana de impresión'),
        findsOneWidget,
      );
    });
  });
}

PosEffectiveSetting _seed(String key, String value, {required int version}) =>
    PosEffectiveSetting(key: key, type: 'string', value: value, source: 'company', version: version);

/// A real, never-configured-by-this-company value — `source: 'default'`,
/// exactly what `GET .../settings/effective` returns for a key resolved
/// from the catalog's own `resolveDefault`, never `'company'`.
PosEffectiveSetting _defaultSeed(String key, String value) =>
    PosEffectiveSetting(key: key, type: 'string', value: value, source: 'default', version: 1);

class _SetCall {
  const _SetCall({required this.key, required this.value, required this.expectedVersion});
  final String key;
  final Object value;
  final int expectedVersion;
}

class _RecordingSettingsGateway implements PosSettingsGateway {
  _RecordingSettingsGateway({required Map<String, PosEffectiveSetting> seed, this.conflictOnKey})
    : _settings = Map.of(seed);

  final Map<String, PosEffectiveSetting> _settings;
  final String? conflictOnKey;
  int effectiveCalls = 0;
  final List<_SetCall> setCalls = [];

  @override
  Future<List<PosEffectiveSetting>> effectiveCompanySettings({
    required String companyId,
    List<String>? keys,
  }) async {
    effectiveCalls++;
    final requested = keys ?? _settings.keys.toList(growable: false);
    return [
      for (final key in requested)
        _settings[key] ?? PosEffectiveSetting(key: key, type: 'string', value: '', source: 'default', version: 1),
    ];
  }

  @override
  Future<PosEffectiveSetting> setCompanySetting({
    required String companyId,
    required String key,
    required Object value,
    required String valueType,
    required int expectedVersion,
  }) async {
    setCalls.add(_SetCall(key: key, value: value, expectedVersion: expectedVersion));
    if (key == conflictOnKey) {
      throw PosSettingVersionConflict(key);
    }
    final updated = PosEffectiveSetting(
      key: key,
      type: valueType,
      value: value,
      source: 'company',
      version: expectedVersion + 1,
    );
    _settings[key] = updated;
    return updated;
  }

  @override
  Future<PosEffectiveSetting> uploadCompanyLogo({
    required String companyId,
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) => throw UnimplementedError('uploadCompanyLogo is not exercised by this test double.');

  @override
  Future<PosEffectiveSetting> deleteCompanyLogo({
    required String companyId,
    required int expectedVersion,
  }) => throw UnimplementedError('deleteCompanyLogo is not exercised by this test double.');
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingSettingsGateway gateway,
  required List<String> permissions,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PosPrinterSettingsScreen(context: _context(permissions), settingsGateway: gateway),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

AuthenticatedContext _context(List<String> permissions) => AuthenticatedContext(
  session: SessionContext(
    id: 'session-id',
    userId: 'user-id',
    companyId: 'company-id',
    branchId: 'branch-id',
    permittedBranchIds: const ['branch-id'],
    companyWideAccess: false,
    expiresAt: DateTime.utc(2099),
  ),
  user: const UserSummary(id: 'user-id', displayName: 'Usuario AS', email: 'user@example.test'),
  companies: const [CompanySummary(id: 'company-id', name: 'Empresa AS', current: true)],
  branches: const [
    BranchSummary(
      id: 'branch-id',
      code: 'CENTRO',
      name: 'Sucursal Centro',
      timezone: 'America/Mexico_City',
      current: true,
    ),
  ],
  companyWideAccess: false,
  permissions: permissions,
);
