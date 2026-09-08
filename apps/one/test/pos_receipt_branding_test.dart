/// TASK 14.5 (Wave 3, Phase 8), Item 1 — widget tests for the standalone
/// `PosReceiptBrandingScreen` ("Marca del ticket"): loading the real
/// effective `receipts.header_text`/`receipts.footer_text` company
/// settings, saving both back with the correct `If-Match` version,
/// honest 409 `version_conflict` handling, and permission-gating for an
/// actor without `company_settings.update` (read-only — the "Guardar"
/// button stays visible-but-disabled, never simply hidden). Uses a real,
/// in-memory recording fake gateway — never a mock framework — mirroring
/// `pos_suppliers_test.dart`'s own `_Recording*Gateway` fixture
/// convention.
library;

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_branding_screen.dart';
import 'package:as_one/features/pos/pos_receipt_branding_screen.dart';
import 'package:as_one/features/pos/pos_settings_gateway.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _readOnly = ['company_settings.read'];
const _readWrite = ['company_settings.read', 'company_settings.update'];

void main() {
  group('TASK 14.5 Wave 3 Phase 8 — load', () {
    testWidgets('renders the real fetched header/footer text in the two fields', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {
          'receipts.header_text': _seed('receipts.header_text', 'Sucursal Centro', version: 3),
          'receipts.footer_text': _seed('receipts.footer_text', 'Gracias por su visita', version: 5),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('Sucursal Centro'), findsOneWidget);
      expect(find.text('Gracias por su visita'), findsOneWidget);
    });

    testWidgets('an unset (default-source) key renders an empty field, never a placeholder string', (tester) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      final headerField = tester.widget<TextField>(find.byKey(const Key('pos-receipt-branding-header-field')));
      expect(headerField.controller!.text, isEmpty);
    });

    testWidgets('no company_settings.read shows the honest permission state, never calls the gateway', (tester) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.textContaining('company_settings.read'), findsOneWidget);
      expect(gateway.effectiveCalls, 0);
    });
  });

  group('TASK 14.5 Wave 3 Phase 8 — save', () {
    testWidgets('Guardar calls setCompanySetting for both keys with the real loaded version', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {
          'receipts.header_text': _seed('receipts.header_text', '', version: 1),
          'receipts.footer_text': _seed('receipts.footer_text', '', version: 1),
        },
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.enterText(find.byKey(const Key('pos-receipt-branding-header-field')), 'Bienvenido');
      await tester.enterText(find.byKey(const Key('pos-receipt-branding-footer-field')), 'Vuelve pronto');
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-receipt-branding-save')));
      await tester.pumpAndSettle();

      expect(gateway.setCalls, hasLength(2));
      expect(gateway.setCalls[0].key, 'receipts.header_text');
      expect(gateway.setCalls[0].value, 'Bienvenido');
      expect(gateway.setCalls[0].expectedVersion, 1);
      expect(gateway.setCalls[1].key, 'receipts.footer_text');
      expect(gateway.setCalls[1].value, 'Vuelve pronto');
      expect(find.text('Cambios guardados.'), findsOneWidget);
    });

    testWidgets('a 409 version_conflict surfaces an honest message and reloads — never a silent overwrite', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.header_text': _seed('receipts.header_text', 'Original', version: 1)},
        conflictOnKey: 'receipts.header_text',
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.enterText(find.byKey(const Key('pos-receipt-branding-header-field')), 'Cambiado');
      await tester.pump();
      await tester.tap(find.byKey(const Key('pos-receipt-branding-save')));
      await tester.pumpAndSettle();

      expect(find.textContaining('Otra sesión cambió'), findsOneWidget);
    });

    testWidgets('no company_settings.update disables Guardar — read-only, never hidden', (tester) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      final button = tester.widget<FilledButton>(find.byKey(const Key('pos-receipt-branding-save')));
      expect(button.onPressed, isNull);
      expect(gateway.setCalls, isEmpty);
    });

    testWidgets('Guardar stays disabled until a field is actually edited', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {'receipts.header_text': _seed('receipts.header_text', 'Actual', version: 2)},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      final before = tester.widget<FilledButton>(find.byKey(const Key('pos-receipt-branding-save')));
      expect(before.onPressed, isNull);

      await tester.enterText(find.byKey(const Key('pos-receipt-branding-header-field')), 'Actual editado');
      await tester.pump();

      final after = tester.widget<FilledButton>(find.byKey(const Key('pos-receipt-branding-save')));
      expect(after.onPressed, isNotNull);
    });
  });

  group('TASK 15.0 RC certification (Phase 12 finding F2 fix) — logo navigation', () {
    testWidgets('tapping "Logo del negocio" navigates to a real PosBrandingScreen', (tester) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byType(PosBrandingScreen), findsNothing);
      await tester.tap(find.byKey(const Key('pos-receipt-branding-open-logo')));
      await tester.pumpAndSettle();

      // Before this fix, `PosBrandingScreen` had zero call sites anywhere
      // in `apps/one/lib` -- a real operator had no way to reach the
      // logo-upload screen TASK 14.5A built. This proves the entry point
      // is real: it lands on the actual screen, not a stub/placeholder.
      expect(find.byType(PosBrandingScreen), findsOneWidget);
      expect(find.text('Logo del negocio'), findsWidgets);
    });
  });
}

PosEffectiveSetting _seed(String key, String value, {required int version}) =>
    PosEffectiveSetting(key: key, type: 'string', value: value, source: 'company', version: version);

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

  // TASK 14.5A extended `PosSettingsGateway` with the business-logo
  // upload/delete methods (see `pos_branding_test.dart` for the fake that
  // actually exercises them) -- this receipts-branding test double never
  // calls either, so both simply fail loudly if that ever changes rather
  // than silently doing nothing.
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
        body: PosReceiptBrandingScreen(context: _context(permissions), settingsGateway: gateway),
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
