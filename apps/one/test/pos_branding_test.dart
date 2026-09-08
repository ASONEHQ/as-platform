/// TASK 14.5A — widget tests for the standalone `PosBrandingScreen`
/// ("Logo del negocio"): loading the real effective `branding.logo_url`
/// company setting, picking a real image file (via an injected
/// [LogoFilePicker] fake -- a real [ImagePicker] pumps a real platform
/// dialog no widget test can drive), uploading it with the correct
/// `If-Match` version, deleting it, honest 409 `version_conflict`
/// handling, client-side content-type/size rejection, and permission
/// gating for an actor without `company_settings.update` (read-only --
/// controls stay visible-but-disabled). Uses a real, in-memory recording
/// fake gateway -- never a mock framework -- mirroring
/// `pos_receipt_branding_test.dart`'s own `_RecordingSettingsGateway`
/// fixture convention (this screen's own structural template).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:as_one/features/authentication/auth_models.dart';
import 'package:as_one/features/pos/pos_branding_screen.dart';
import 'package:as_one/features/pos/pos_settings_gateway.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';

const _readOnly = ['company_settings.read'];
const _readWrite = ['company_settings.read', 'company_settings.update'];
const _logoKey = 'branding.logo_url';

// A real, valid, minimal 1x1 transparent PNG -- not just the 8-byte magic
// header this task's own backend signature check looks for, but bytes
// `Image.memory` can genuinely decode and render, so the "live preview"
// tests below exercise the real widget rather than tripping its
// [Image.memory] `errorBuilder` fallback.
final Uint8List _pngBytes = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

void main() {
  group('TASK 14.5A — load', () {
    testWidgets('renders the persisted logo preview when a URL is already set', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {_logoKey: _seed('http://127.0.0.1:9000/asone-branding/logos/c1/a.png', version: 4)},
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.byKey(const Key('pos-branding-preview-persisted')), findsOneWidget);
      expect(find.byKey(const Key('pos-branding-delete')), findsOneWidget);
    });

    testWidgets('an unset (default-source) key renders the empty-preview state, never a broken image', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      expect(find.text('Sin logo configurado'), findsOneWidget);
      expect(find.byKey(const Key('pos-branding-delete')), findsNothing);
    });

    testWidgets('no company_settings.read shows the honest permission state, never calls the gateway', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(tester, gateway: gateway, permissions: const []);

      expect(find.textContaining('company_settings.read'), findsOneWidget);
      expect(gateway.effectiveCalls, 0);
    });

    testWidgets('no company_settings.update disables pick/upload/delete, never hides them', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {_logoKey: _seed('http://127.0.0.1:9000/asone-branding/logos/c1/a.png', version: 2)},
      );
      await _pump(tester, gateway: gateway, permissions: _readOnly);

      final pick = tester.widget<OutlinedButton>(find.byKey(const Key('pos-branding-pick')));
      final delete = tester.widget<OutlinedButton>(find.byKey(const Key('pos-branding-delete')));
      expect(pick.onPressed, isNull);
      expect(delete.onPressed, isNull);
      expect(find.textContaining('company_settings.update'), findsOneWidget);
    });
  });

  group('TASK 14.5A — pick + upload', () {
    testWidgets('picking a valid PNG shows a live preview and an enabled upload button', (tester) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(
        tester,
        gateway: gateway,
        permissions: _readWrite,
        pickImage: () async => XFile.fromData(_pngBytes, name: 'logo.png', mimeType: 'image/png'),
      );

      await tester.tap(find.byKey(const Key('pos-branding-pick')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pos-branding-preview-picked')), findsOneWidget);
      final upload = tester.widget<FilledButton>(find.byKey(const Key('pos-branding-upload')));
      expect(upload.onPressed, isNotNull);
    });

    testWidgets('uploading calls the gateway with the picked bytes and the current If-Match version', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(seed: {_logoKey: _seed('', version: 6)});
      await _pump(
        tester,
        gateway: gateway,
        permissions: _readWrite,
        pickImage: () async => XFile.fromData(_pngBytes, name: 'logo.png', mimeType: 'image/png'),
      );

      await tester.tap(find.byKey(const Key('pos-branding-pick')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branding-upload')));
      await tester.pumpAndSettle();

      expect(gateway.uploadCalls, hasLength(1));
      expect(gateway.uploadCalls.single.expectedVersion, 6);
      expect(gateway.uploadCalls.single.bytes, _pngBytes);
      expect(gateway.uploadCalls.single.contentType, 'image/png');
      expect(find.text('Logo actualizado.'), findsOneWidget);
      expect(find.byKey(const Key('pos-branding-preview-persisted')), findsOneWidget);
    });

    testWidgets('a 409 version_conflict on upload reloads and shows an honest recovery message', (
      tester,
    ) async {
      final gateway = _RecordingSettingsGateway(
        seed: {_logoKey: _seed('', version: 1)},
        conflictOnUpload: true,
      );
      await _pump(
        tester,
        gateway: gateway,
        permissions: _readWrite,
        pickImage: () async => XFile.fromData(_pngBytes, name: 'logo.png', mimeType: 'image/png'),
      );

      await tester.tap(find.byKey(const Key('pos-branding-pick')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pos-branding-upload')));
      await tester.pumpAndSettle();

      expect(find.textContaining('Otra sesión cambió el logo'), findsOneWidget);
    });

    testWidgets('rejects an unsupported content type client-side, never calling the gateway', (tester) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      await _pump(
        tester,
        gateway: gateway,
        permissions: _readWrite,
        pickImage: () async =>
            XFile.fromData(Uint8List.fromList([1, 2, 3]), name: 'logo.pdf', mimeType: 'application/pdf'),
      );

      await tester.tap(find.byKey(const Key('pos-branding-pick')));
      await tester.pumpAndSettle();

      expect(find.textContaining('Formato no soportado'), findsOneWidget);
      expect(find.byKey(const Key('pos-branding-upload')), findsNothing);
      expect(gateway.uploadCalls, isEmpty);
    });

    testWidgets('rejects an oversized file client-side, never calling the gateway', (tester) async {
      final gateway = _RecordingSettingsGateway(seed: const {});
      final oversized = Uint8List(2 * 1024 * 1024 + 1);
      await _pump(
        tester,
        gateway: gateway,
        permissions: _readWrite,
        pickImage: () async => XFile.fromData(oversized, name: 'logo.png', mimeType: 'image/png'),
      );

      await tester.tap(find.byKey(const Key('pos-branding-pick')));
      await tester.pumpAndSettle();

      expect(find.textContaining('supera el tamaño máximo'), findsOneWidget);
      expect(find.byKey(const Key('pos-branding-upload')), findsNothing);
      expect(gateway.uploadCalls, isEmpty);
    });
  });

  group('TASK 14.5A — delete', () {
    testWidgets('deleting clears the preview back to the empty state', (tester) async {
      final gateway = _RecordingSettingsGateway(
        seed: {_logoKey: _seed('http://127.0.0.1:9000/asone-branding/logos/c1/a.png', version: 3)},
      );
      await _pump(tester, gateway: gateway, permissions: _readWrite);

      await tester.tap(find.byKey(const Key('pos-branding-delete')));
      await tester.pumpAndSettle();

      expect(gateway.deleteCalls, hasLength(1));
      expect(gateway.deleteCalls.single, 3);
      expect(find.text('Logo eliminado.'), findsOneWidget);
      expect(find.text('Sin logo configurado'), findsOneWidget);
      expect(find.byKey(const Key('pos-branding-delete')), findsNothing);
    });
  });
}

PosEffectiveSetting _seed(String url, {required int version}) =>
    PosEffectiveSetting(key: _logoKey, type: 'string', value: url, source: url.isEmpty ? 'default' : 'company', version: version);

class _UploadCall {
  const _UploadCall({required this.bytes, required this.contentType, required this.expectedVersion});
  final List<int> bytes;
  final String contentType;
  final int expectedVersion;
}

class _RecordingSettingsGateway implements PosSettingsGateway {
  _RecordingSettingsGateway({required Map<String, PosEffectiveSetting> seed, this.conflictOnUpload = false})
    : _settings = Map.of(seed);

  final Map<String, PosEffectiveSetting> _settings;
  final bool conflictOnUpload;
  int effectiveCalls = 0;
  final List<_UploadCall> uploadCalls = [];
  final List<int> deleteCalls = [];

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
  }) => throw UnimplementedError('Not exercised by this test double.');

  @override
  Future<PosEffectiveSetting> uploadCompanyLogo({
    required String companyId,
    required List<int> bytes,
    required String filename,
    required String contentType,
    required int expectedVersion,
  }) async {
    uploadCalls.add(_UploadCall(bytes: bytes, contentType: contentType, expectedVersion: expectedVersion));
    if (conflictOnUpload) throw const PosSettingVersionConflict(_logoKey);
    final updated = PosEffectiveSetting(
      key: _logoKey,
      type: 'string',
      value: 'http://127.0.0.1:9000/asone-branding/logos/c1/uploaded.png',
      source: 'company',
      version: expectedVersion + 1,
    );
    _settings[_logoKey] = updated;
    return updated;
  }

  @override
  Future<PosEffectiveSetting> deleteCompanyLogo({required String companyId, required int expectedVersion}) async {
    deleteCalls.add(expectedVersion);
    final updated = PosEffectiveSetting(key: _logoKey, type: 'string', value: '', source: 'default', version: expectedVersion + 1);
    _settings[_logoKey] = updated;
    return updated;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _RecordingSettingsGateway gateway,
  required List<String> permissions,
  LogoFilePicker? pickImage,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PosBrandingScreen(context: _context(permissions), settingsGateway: gateway, pickImage: pickImage),
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
